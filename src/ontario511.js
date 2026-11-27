// -----------------------------------------------------------------------------
// The Ontario 511 developer API: one GET of a resource for the whole province
// (the API has no filter by area), read with an honest User-Agent, an
// explicit JSON Accept, a bounded time and a bounded body (cut before it is
// read in full), then each item read strictly into a small object. Nothing
// here retries, waits or keeps state: the app paces the requests (one at a
// time, 7 s apart) and decides.
//
// Format, as documented on https://511on.ca/developers/doc and
// https://511on.ca/help/endpoint/event, .../roadconditions (read 2026-11-27):
// a JSON array; dates are "Unix time" (10-digit samples: seconds); events
// carry `ID`, `RoadwayName`, `EventType` (roadwork, closures or
// accidentsAndIncidents), `IsFullClosure`, `Latitude`/`Longitude` and an
// optional secondary point and `EncodedPolyline`; road conditions carry
// `RoadwayName`, `LocationDescription`, `Condition` (a list of texts),
// `Visibility`, `Drifting`, `EncodedPolyline` (a string in the table, a list
// in the sample: both read) and `LastUpdated`. `lang=en|fr` picks the
// language of the texts.
//
// Checked live without a key (2026-11-27): every path answers HTTP 400 with
// `{"Message":"Invalid Key"}` (`<Error><Message>Invalid Key</Message></Error>`
// without a JSON Accept). The throttling answer is not documented: a 429 is
// read as a rate limit, any other status as unexpected.
//
// The key travels in the query string, as the API asks: the URL is never
// logged, shown or kept.
// -----------------------------------------------------------------------------

import {
  API_BASE,
  CONDITION_FRESH,
  EVENT_TYPES,
  MAX_BODY_BYTES,
  MAX_ITEMS,
  MINUTE,
  REQUEST_TIMEOUT,
  USER_AGENT,
} from './constants.js';
import { readLines, readPoint } from './geo.js';

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const TEXT_MAX = 2000;
/** The earliest and latest Unix time believed (seconds). */
const UNIX_MIN = Date.UTC(2000, 0, 1) / 1000;
const UNIX_MAX = Date.UTC(2100, 0, 1) / 1000;
const REFUSAL_BODY_MAX = 4096;

/** The URL of a resource for the whole province, in the language asked. */
export function resourceUrl(path, key, language, base = API_BASE) {
  const params = new URLSearchParams({
    key,
    format: 'json',
    lang: language === 'fr' ? 'fr' : 'en',
  });
  return `${base}${path}?${params}`;
}

/**
 * One GET. Resolves `{ ok: true, json, serverDate }` or `{ ok: false, kind,
 * status?, retryAfter?, serverDate }`, `kind` among `network`, `timeout`,
 * `key` (400 "Invalid Key"), `rate` (429), `server` (5xx), `http` (other
 * status), `format`, `too_big`. Never throws; never says the URL.
 */
export async function getJson(url, { fetchImpl = fetch, timers = globalThis, signal } = {}) {
  const controller = new AbortController();
  // A stop of the app cuts the request at once (never left open 30 s).
  if (signal?.aborted) controller.abort();
  signal?.addEventListener?.('abort', () => controller.abort(), { once: true });
  let timedOut = false;
  const timer = timers.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT);
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      redirect: 'error',
      signal: controller.signal,
    });
  } catch {
    timers.clearTimeout(timer);
    return { ok: false, kind: timedOut ? 'timeout' : 'network', serverDate: null };
  }
  const serverDate = readHttpDate(response.headers.get('date'));
  try {
    if (response.status === 429) {
      return {
        ok: false,
        kind: 'rate',
        status: 429,
        retryAfter: readRetryAfter(response.headers.get('retry-after'), serverDate),
        serverDate,
      };
    }
    if (response.status >= 500) {
      return {
        ok: false,
        kind: 'server',
        status: response.status,
        retryAfter: readRetryAfter(response.headers.get('retry-after'), serverDate),
        serverDate,
      };
    }
    if (response.status === 400 && (await isKeyRefusal(response))) {
      return { ok: false, kind: 'key', status: 400, serverDate };
    }
    if (response.status !== 200) {
      return { ok: false, kind: 'http', status: response.status, serverDate };
    }
    const type = response.headers.get('content-type') ?? '';
    if (!/\bjson\b/i.test(type)) return { ok: false, kind: 'format', status: 200, serverDate };
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return { ok: false, kind: 'too_big', status: 200, serverDate };
    }
    const text = await readBounded(response);
    if (text === null) return { ok: false, kind: 'too_big', status: 200, serverDate };
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, kind: 'format', status: 200, serverDate };
    }
    return { ok: true, json, serverDate };
  } catch {
    return { ok: false, kind: timedOut ? 'timeout' : 'network', serverDate };
  } finally {
    timers.clearTimeout(timer);
    // A body left unread is released, never kept open.
    response.body?.cancel?.().catch?.(() => {});
  }
}

/**
 * Whether a 400 is the refusal of the key: the message "Invalid Key", as JSON
 * (`{"Message":"Invalid Key"}`) or XML. Any other 400 is an unexpected answer.
 */
async function isKeyRefusal(response) {
  const text = await readBounded(response, REFUSAL_BODY_MAX).catch(() => null);
  if (text === null) return false;
  let message = null;
  try {
    const json = JSON.parse(text);
    if (json && typeof json === 'object' && !Array.isArray(json)) {
      message = typeof json.Message === 'string' ? json.Message : null;
    }
  } catch {
    const match = /^\s*<Error>\s*<Message>([^<]{1,100})<\/Message>\s*<\/Error>\s*$/.exec(text);
    message = match ? match[1] : null;
  }
  return message !== null && /^\s*invalid key\s*\.?\s*$/i.test(message);
}

/** The body as text, or `null` past `max` bytes (the rest never read). */
async function readBounded(response, max = MAX_BODY_BYTES) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

/** An HTTP date (`Fri, 27 Nov 2026 11:16:45 GMT`) in ms, or `null`. */
export function readHttpDate(value) {
  if (
    typeof value !== 'string' ||
    !/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value.trim())
  ) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** `Retry-After` in ms (seconds or an HTTP date read against the server's). */
export function readRetryAfter(value, serverDate) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (/^\d{1,6}$/.test(text)) return Number(text) * 1000;
  const at = readHttpDate(text);
  if (at !== null && serverDate !== null) return Math.max(0, at - serverDate);
  return null;
}

/** A "Unix time" of the API (seconds) in ms, or `null` (absent, not an integer, implausible). */
export function readUnix(value) {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < UNIX_MIN || value > UNIX_MAX) return null;
  return value * 1000;
}

/** A text from the source, bounded, without control bytes; `''` when absent. */
export function readString(value, max = TEXT_MAX) {
  if (typeof value !== 'string') return '';
  const clean = value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [...clean].slice(0, max).join('');
}

/** The polylines of an item: a string, or a list of strings (bounded). */
function polylinesOf(value) {
  if (typeof value === 'string') return value ? [value] : [];
  if (Array.isArray(value)) {
    return value.slice(0, 50).filter((item) => typeof item === 'string' && item);
  }
  return [];
}

/**
 * The id of an event: its `ID` (a positive integer), else, when missing,
 * `Organization:SourceId`; `null` when neither.
 */
function eventId(raw) {
  if (Number.isSafeInteger(raw.ID) && raw.ID > 0) return String(raw.ID);
  const org = readString(raw.Organization, 40);
  const source = readString(raw.SourceId, 80);
  if (org && source) return `${org}:${source}`;
  return null;
}

/** One event, or `null` when it lacks what identifies or places it. */
export function readEvent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = eventId(raw);
  if (!id) return null;
  const lines = readLines({
    point: readPoint(raw.Latitude, raw.Longitude),
    secondary: readPoint(raw.LatitudeSecondary, raw.LongitudeSecondary),
    polylines: polylinesOf(raw.EncodedPolyline),
  });
  if (!lines) return null;
  return {
    id,
    type: EVENT_TYPES.includes(raw.EventType) ? raw.EventType : 'other',
    subtype: readString(raw.EventSubType, 80),
    road: readString(raw.RoadwayName, 120),
    direction: readString(raw.DirectionOfTravel, 40),
    description: readString(raw.Description),
    comment: readString(raw.Comment),
    impact: readString(raw.Impact, 500),
    lanes: readString(raw.LanesAffected, 120),
    severity: readString(raw.Severity, 40),
    // Only an explicit `true` is a full closure; absent or anything else is not said.
    fullClosure: raw.IsFullClosure === true,
    reported: readUnix(raw.Reported),
    updated: readUnix(raw.LastUpdated),
    start: readUnix(raw.StartDate),
    plannedEnd: readUnix(raw.PlannedEndDate),
    lines,
  };
}

/**
 * Whether an event is in effect at `at` (the server time): listed by the
 * API and started. A start in the future is a planned event, not counted;
 * an unknown start is in effect. The planned end is a plan: an event still
 * listed after it is still there.
 */
export function inEffect(event, at) {
  return event.start === null || event.start <= at;
}

/** A closure: the type "closures", or every lane blocked. */
export const isClosure = (event) => event.type === 'closures' || event.fullClosure;

// The words of a road surface report, in English and French (the vocabulary
// of 511on.ca: "Bare and dry road", "Partly snow covered", "Snow packed",
// "Ice covered", "Slushy"...). Winter words win over bare words ("wet snow").
const WINTER =
  /snow|\bice\b|\bicy\b|slush|frost|drift|neig|glac|verglas|gadoue|fondante|poudrerie|givr/i;
const BARE = /\bbare\b|\bdry\b|\bwet\b|s[eè]che|mouill[eé]|d[eé]gag[eé]/i;

/**
 * The state of a condition report: `winter` (snow, ice, slush, drifting),
 * `bare` (bare, dry or wet only) or `unknown` (no report, an unknown word,
 * a closed road). An unknown report is never counted either way.
 */
export function classify(conditions, drifting) {
  if (conditions.length === 0) return 'unknown';
  if (/^(yes|oui|true)$/i.test(drifting)) return 'winter';
  if (conditions.some((text) => WINTER.test(text))) return 'winter';
  if (conditions.every((text) => BARE.test(text))) return 'bare';
  return 'unknown';
}

/** One road condition segment, or `null` when nothing places it. */
export function readCondition(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const lines = readLines({
    point: null,
    secondary: null,
    polylines: polylinesOf(raw.EncodedPolyline),
  });
  if (!lines) return null;
  let list = [];
  if (Array.isArray(raw.Condition)) list = raw.Condition.slice(0, 10);
  else if (typeof raw.Condition === 'string') list = [raw.Condition];
  const conditions = list.map((text) => readString(text, 120)).filter(Boolean);
  const drifting = readString(raw.Drifting, 20);
  return {
    road: readString(raw.RoadwayName, 120),
    location: readString(raw.LocationDescription, 300),
    region: readString(raw.Region, 80),
    conditions,
    visibility: readString(raw.Visibility, 40),
    drifting,
    state: classify(conditions, drifting),
    updated: readUnix(raw.LastUpdated),
    lines,
  };
}

/**
 * Whether a condition report is current at `at`: updated within 24 h of the
 * server time (and not more than 5 min after it). An undated report is not.
 */
export function isCurrent(segment, at) {
  return (
    segment.updated !== null &&
    segment.updated <= at + 5 * MINUTE &&
    at - segment.updated <= CONDITION_FRESH
  );
}

/**
 * A resource answer: `{ items, skipped }`, `{ unreadable }` when more than
 * half of its items cannot be read (never "nothing"), `{ tooMany }` past
 * MAX_ITEMS, or `null` when it is not a list (an error object, a page...).
 */
export function readList(json, readItem) {
  if (!Array.isArray(json)) return null;
  if (json.length > MAX_ITEMS) return { tooMany: true };
  const items = [];
  let skipped = 0;
  for (const raw of json) {
    const item = readItem(raw);
    if (item) items.push(item);
    else skipped += 1;
  }
  // A list made mostly of items that cannot be read is not "nothing": the
  // format changed, or the answer is broken. Never published as 0.
  if (json.length > 0 && skipped * 2 > json.length) return { unreadable: true, skipped };
  return { items, skipped };
}
