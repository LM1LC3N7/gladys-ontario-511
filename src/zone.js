// -----------------------------------------------------------------------------
// What a zone sees in a read: the events in effect now (server time) and the
// winter road condition segments, inside its circle and, when the user named
// roads, on one of them. Events sorted closures first, then incidents, then
// by distance; counted; summed up in a short text in the user's language.
// -----------------------------------------------------------------------------

import { MAX_COUNT, SUMMARY_MAX } from './constants.js';
import { roadKey } from './config.js';
import { distanceKm } from './geo.js';
import { directionLabel, t, typeLabel } from './i18n.js';
import { inEffect, isClosure, isCurrent } from './ontario511.js';

const TYPE_RANK = { accidentsAndIncidents: 0, closures: 1, roadwork: 2, other: 3 };

const onRoads = (wanted, road) => wanted.size === 0 || wanted.has(roadKey(road));

/**
 * The events of a zone: `[{ event, distanceKm }]`, sorted. `at` is the
 * reference time (the server `Date`).
 */
export function matchEvents(zone, events, at) {
  const wanted = new Set(zone.roads.map(roadKey));
  const matches = [];
  const seen = new Set();
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    if (!inEffect(event, at)) continue;
    if (!onRoads(wanted, event.road)) continue;
    const distance = distanceKm(zone, event.lines);
    if (!(distance <= zone.radiusKm)) continue;
    matches.push({ event, distanceKm: distance });
  }
  matches.sort(
    (a, b) =>
      Number(isClosure(b.event)) - Number(isClosure(a.event)) ||
      TYPE_RANK[a.event.type] - TYPE_RANK[b.event.type] ||
      a.distanceKm - b.distanceKm ||
      (a.event.id < b.event.id ? -1 : 1),
  );
  return matches;
}

/**
 * The condition segments of a zone: `[{ segment, distanceKm, current }]`,
 * winter first. `current` says whether the report is recent enough to count.
 */
export function matchConditions(zone, segments, at) {
  const wanted = new Set(zone.roads.map(roadKey));
  const matches = [];
  for (const segment of segments) {
    if (!onRoads(wanted, segment.road)) continue;
    const distance = distanceKm(zone, segment.lines);
    if (!(distance <= zone.radiusKm)) continue;
    matches.push({ segment, distanceKm: distance, current: isCurrent(segment, at) });
  }
  const rank = (m) => (m.current ? { winter: 0, bare: 2, unknown: 1 }[m.segment.state] : 3);
  matches.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.distanceKm - b.distanceKm ||
      (a.segment.road < b.segment.road ? -1 : a.segment.road > b.segment.road ? 1 : 0),
  );
  return matches;
}

const bound = (n) => Math.min(n, MAX_COUNT);

export function eventCounts(matches) {
  const of = (type) => bound(matches.filter((m) => m.event.type === type).length);
  return {
    events: bound(matches.length),
    incidents: of('accidentsAndIncidents'),
    roadwork: of('roadwork'),
    closures: bound(matches.filter((m) => isClosure(m.event)).length),
  };
}

/**
 * The segments in winter conditions, or `null` when unknown: no segment of
 * the zone has a current report Ontario 511 words as bare or winter (out of
 * season, every report old or unknown). Never 0 for "unknown".
 */
export function winterCount(matches) {
  const known = matches.filter((m) => m.current && m.segment.state !== 'unknown');
  if (known.length === 0) return null;
  return bound(known.filter((m) => m.segment.state === 'winter').length);
}

export function formatKm(km, language) {
  const rounded = km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
  return `${String(rounded).replace('.', language === 'fr' ? ',' : '.')} km`;
}

/** One line per event: "HWY 401 Eastbound: closed, incident, 3 km". */
export function describeEvent(match, language) {
  const { event } = match;
  const sep = language === 'fr' ? ' : ' : ': ';
  const where = [event.road || '?', directionLabel(language, event.direction)]
    .filter(Boolean)
    .join(' ');
  const parts = [];
  if (event.fullClosure) parts.push(t(language, 'allLanesClosed'));
  parts.push(typeLabel(language, event.type));
  return `${[...where].slice(0, 80).join('')}${sep}${parts.join(', ')}, ${formatKm(match.distanceKm, language)}`;
}

/** One line per winter segment: "HWY 11 (North Bay to Powassan): Snow packed, Poor". */
export function describeSegment(match, language) {
  const { segment } = match;
  const sep = language === 'fr' ? ' : ' : ': ';
  const where = segment.location
    ? `${segment.road || '?'} (${[...segment.location].slice(0, 80).join('')})`
    : segment.road || '?';
  let text = `${where}${sep}${segment.conditions.join(', ')}`;
  if (segment.visibility) text += `, ${t(language, 'visibility', { text: segment.visibility })}`;
  return text;
}

/**
 * The summary text of a zone, bounded to SUMMARY_MAX characters. `events` or
 * `conditions` is null when that resource could not be read (said in the text).
 */
export function summary(events, conditions, language) {
  let head;
  if (events === null) head = [t(language, 'eventsUnread')];
  else {
    const c = eventCounts(events);
    head = [
      c.events === 0 ? t(language, 'noEvent') : t(language, 'eventCount', c),
      ...events.map((m) => describeEvent(m, language)),
    ];
  }
  let tail;
  if (conditions === null) tail = [t(language, 'conditionsUnread')];
  else {
    const winter = winterCount(conditions);
    if (winter === null) tail = [t(language, 'noCurrentReport')];
    else if (winter > 0) {
      tail = [
        t(language, 'winterCount', { count: winter }),
        ...conditions
          .filter((m) => m.current && m.segment.state === 'winter')
          .map((m) => describeSegment(m, language)),
      ];
    } else tail = [t(language, 'roadsBare')];
  }
  // The events first, then the conditions: each list cut with "N more" when long.
  return fit(head, tail, language);
}

function fit(head, tail, language) {
  const cut = (list, room) => {
    const [first, ...items] = list;
    let text = first;
    let shown = 0;
    for (const item of items) {
      const rest = items.length - shown - 1;
      const more = rest > 0 ? ` · ${t(language, 'more', { count: rest })}` : '';
      if ([...`${text} · ${item}${more}`].length > room) break;
      text += ` · ${item}`;
      shown += 1;
    }
    const rest = items.length - shown;
    if (rest > 0) text += ` · ${t(language, 'more', { count: rest })}`;
    return text;
  };
  const tailText = cut(tail, Math.floor(SUMMARY_MAX / 3));
  const headText = cut(head, SUMMARY_MAX - [...tailText].length - 3);
  return [...`${headText} · ${tailText}`].slice(0, SUMMARY_MAX).join('');
}
