// -----------------------------------------------------------------------------
// The app against the SDK's fake Gladys, a scripted Ontario 511 API and a
// virtual clock (gladys-testkit `testClock`: each clock read moves 1 µs,
// timers fire only through `advance`). The API answers through a
// `world(url, api, call)` function: a JSON body (200), a Response, 'timeout'
// (never answers), 'network' (refused), or a promise of one of them (a slow
// answer). `layerOf` tells which resource a URL asks for.
//
// No real key exists for the tests (none is published, and none is needed to
// learn the format): the answers are built from the documented samples
// (test/fixtures), the refusal is the one 511on.ca gives without a key.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { Ontario511App } from '../../src/app.js';
import { normalizeConfig } from '../../src/config.js';
import { buildDevices } from '../../src/devices.js';
import { createMemoryStore } from '../../src/store.js';
import { settle, testClock } from '../kit/clock.mjs';

export const SELECTOR = 'ontario-511';
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
/** Answers built from the documented samples, around Toronto. */
export const EVENTS_FIXTURE = fixture('events.json');
export const CONDITIONS_FIXTURE = fixture('roadconditions.json');

/** The time of the answers (their `Date` header). */
export const CAPTURED_AT = Date.parse(EVENTS_FIXTURE.date);

/** A test key: never a real one. */
export const KEY = 'TESTKEY-0123456789abcdef';

export const HOME = {
  api_key: KEY,
  zone1_name: 'Home',
  zone1_latitude: 43.6532,
  zone1_longitude: -79.3832,
  zone1_radius_km: 30,
};
export const THREE_ZONES = {
  ...HOME,
  zone2_latitude: 46.3091,
  zone2_longitude: -79.4608,
  zone2_radius_km: 40,
  zone3_latitude: 43.25,
  zone3_longitude: -79.87,
};

export const F = (slot, key) => `ext:${SELECTOR}:zone:${slot}:${key}`;

/** `events` or `conditions` from an API URL. */
export function layerOf(url) {
  const path = new URL(url).pathname;
  return path === '/api/v2/get/event'
    ? 'events'
    : path === '/api/v3/get/roadconditions'
      ? 'conditions'
      : null;
}

/** A copy of a fixture body, changed by `edit`. */
export function list(layer, edit = (items) => items) {
  return edit(structuredClone((layer === 'events' ? EVENTS_FIXTURE : CONDITIONS_FIXTURE).body));
}

/** The default world: the documented answer of the resource asked. */
export const real = (url) => list(layerOf(url));

/** An incident at the Home center, in effect at the capture time (seconds). */
export function event(id, over = {}) {
  const at = CAPTURED_AT / 1000;
  return {
    ID: id,
    SourceId: String(id),
    Organization: 'MTO',
    RoadwayName: 'HWY 401',
    DirectionOfTravel: 'Eastbound',
    Description: `Test event ${id}.`,
    Reported: at - 600,
    LastUpdated: at - 300,
    StartDate: at - 600,
    PlannedEndDate: at + 3600,
    LanesAffected: '1 Right Lane(s)',
    Latitude: 43.654,
    Longitude: -79.384,
    LatitudeSecondary: null,
    LongitudeSecondary: null,
    EventType: 'accidentsAndIncidents',
    EventSubType: null,
    IsFullClosure: false,
    Severity: 'Unknown',
    Comment: null,
    EncodedPolyline: null,
    Restrictions: { Width: null, Height: null, Length: null, Weight: null, Speed: null },
    Recurrence: '',
    RecurrenceSchedules: '',
    LinkId: null,
    Impact: null,
    ...over,
  };
}

/** A condition segment through the Home center, reported at the capture time. */
export function segment(over = {}) {
  return {
    LocationDescription: 'From Yonge St to Bay St',
    Condition: ['Snow covered'],
    Visibility: 'Good',
    Drifting: null,
    Region: 'Central',
    RoadwayName: '401',
    // (43.65, -79.39) to (43.66, -79.37)
    EncodedPolyline: 'okliGnzpcNo}@_|B',
    LastUpdated: CAPTURED_AT / 1000 - 600,
    ...over,
  };
}

export function json(body, { status = 200, date, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(date === null ? {} : { date: new Date(date).toUTCString() }),
      ...headers,
    },
  });
}

/** The refusal of 511on.ca for a bad or missing key (seen live, 2026-11-27). */
export const invalidKey = (date) =>
  json({ Message: 'Invalid Key' }, { status: 400, date: date ?? CAPTURED_AT });

const abortable = (signal, kind) =>
  new Promise((_, reject) => {
    if (kind === 'network') reject(new TypeError('fetch failed'));
    signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });

/** A scripted Ontario 511: every request is recorded with the virtual time. */
export function createApi(world = real) {
  const api = { world, calls: [], open: 0, peak: 0, clock: null };
  api.fetch = async (url, init) => {
    const call = { url: String(url), init, at: api.clock.elapsed, wall: api.clock.wall() };
    api.calls.push(call);
    api.open += 1;
    api.peak = Math.max(api.peak, api.open);
    try {
      const answer = await api.world(call.url, api, call);
      if (answer === 'timeout' || answer === 'network')
        return await abortable(init?.signal, answer);
      if (answer instanceof Response) return answer;
      return json(answer, { date: api.clock.wall() });
    } finally {
      api.open -= 1;
    }
  };
  return api;
}

/** The devices of a configuration as created by the user in Gladys. */
export function createdDevices(config) {
  const gladys = createFakeGladys({ selector: SELECTOR });
  return buildDevices(gladys, normalizeConfig(config));
}

export async function setup({
  config = HOME,
  devices,
  store = createMemoryStore(),
  api = createApi(),
  created = true,
  start = CAPTURED_AT,
  wall = { offset: 0 },
} = {}) {
  const gladys = createFakeGladys({
    selector: SELECTOR,
    config,
    devices: devices ?? (created ? createdDevices(config) : []),
  });
  await gladys.connect();
  const clock = testClock({ start });
  clock.wall = () => clock.now() + wall.offset;
  api.clock = clock;
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  const app = new Ontario511App({
    gladys,
    logger: { lines, info: log, warn: log, error: log, debug: log },
    now: () => clock.wall(),
    monotonic: clock.monotonic,
    timers: clock.timers,
    store,
    fetchImpl: api.fetch,
  });
  const wait = async (ms) => {
    await clock.advance(ms);
    await settle(10);
  };
  const begin = async (cfg = config) => {
    await app.start(cfg);
    await wait(0);
  };
  /** Advances until `predicate()` holds, failing (never hanging) past `limit` virtual ms. */
  const until = async (predicate, { step = SECOND, limit = HOUR } = {}) => {
    for (let spent = 0; spent <= limit; spent += step) {
      if (predicate()) return;
      await wait(step);
    }
    throw new Error(`until: not reached within ${limit} ms`);
  };
  return { app, gladys, fake: gladys.fake, clock, store, api, wait, begin, until, lines, wall };
}

/** The values published for a feature, in order. */
export const published = (fake, id) =>
  fake.states
    .filter((s) => s.device_feature_external_id === id)
    .map((s) => (s.text !== undefined ? s.text : s.state));
