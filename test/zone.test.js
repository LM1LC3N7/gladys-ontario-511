import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUMMARY_MAX } from '../src/constants.js';
import { normalizeConfig } from '../src/config.js';
import { readCondition, readEvent } from '../src/ontario511.js';
import { eventCounts, matchConditions, matchEvents, summary, winterCount } from '../src/zone.js';
import {
  CAPTURED_AT,
  CONDITIONS_FIXTURE,
  EVENTS_FIXTURE,
  HOME,
  event,
  segment,
} from './helpers/setup.js';

const zoneOf = (over = {}) => normalizeConfig({ ...HOME, ...over }).zones[0];
const events = EVENTS_FIXTURE.body.map(readEvent);
const segments = CONDITIONS_FIXTURE.body.map(readCondition);

test('the events of a zone: in effect, in the circle, sorted closures first, then incidents', () => {
  const matches = matchEvents(zoneOf(), events, CAPTURED_AT);
  assert.deepEqual(
    matches.map((m) => m.event.id),
    ['2002', '2001', 'Toronto:T-55', '1963'],
  );
  assert.deepEqual(eventCounts(matches), { events: 4, incidents: 1, roadwork: 2, closures: 1 });
  // The planned HWY 400 closure (starts in 3 days) and North Bay are not there.
  assert.ok(!matches.some((m) => ['2003', '2004'].includes(m.event.id)));
  // A smaller circle, a road filter.
  assert.equal(matchEvents(zoneOf({ zone1_radius_km: 5 }), events, CAPTURED_AT).length, 1);
  const on401 = matchEvents(zoneOf({ zone1_roads: 'Highway 401' }), events, CAPTURED_AT);
  assert.deepEqual(
    on401.map((m) => m.event.id),
    ['2001', '1963'],
  );
  // Every lane blocked is a closure, whatever the type.
  const blocked = [readEvent(event(8, { EventType: 'roadwork', IsFullClosure: true }))];
  assert.equal(eventCounts(matchEvents(zoneOf(), blocked, CAPTURED_AT)).closures, 1);
  // The same id twice is counted once.
  const twice = [readEvent(event(7)), readEvent(event(7))];
  assert.equal(matchEvents(zoneOf(), twice, CAPTURED_AT).length, 1);
});

test('winter segments: counted only on current reports; unknown is null, never 0', () => {
  const zone = zoneOf();
  const matches = matchConditions(zone, segments, CAPTURED_AT);
  assert.deepEqual(
    matches.map((m) => [m.segment.road, m.current, m.segment.state]),
    [
      ['401', true, 'winter'],
      ['QEW', true, 'bare'],
    ],
  );
  assert.equal(winterCount(matches), 1);
  // Only bare: 0, a known 0.
  const bare = matchConditions(
    zone,
    [readCondition(segment({ Condition: ['Bare and dry road'] }))],
    CAPTURED_AT,
  );
  assert.equal(winterCount(bare), 0);
  // Only old reports, or only unknown words, or nothing: unknown.
  const old = readCondition(segment({ LastUpdated: CAPTURED_AT / 1000 - 2 * 86400 }));
  assert.equal(winterCount(matchConditions(zone, [old], CAPTURED_AT)), null);
  const unknown = readCondition(segment({ Condition: ['No Report'] }));
  assert.equal(winterCount(matchConditions(zone, [unknown], CAPTURED_AT)), null);
  assert.equal(winterCount([]), null);
  // An old winter report is not counted as winter.
  const oldWinter = readCondition(segment({ LastUpdated: CAPTURED_AT / 1000 - 2 * 86400 }));
  const fresh = readCondition(segment({ Condition: ['Bare and dry road'] }));
  assert.equal(winterCount(matchConditions(zone, [oldWinter, fresh], CAPTURED_AT)), 0);
});

test('the summary: events then conditions, in the language asked, bounded', () => {
  const zone = zoneOf();
  const e = matchEvents(zone, events, CAPTURED_AT);
  const c = matchConditions(zone, segments, CAPTURED_AT);
  const en = summary(e, c, 'en');
  assert.match(
    en,
    /^4 events \(1 closure\) · QEW both directions: all lanes closed, closure, 8\.7 km · /,
  );
  assert.match(
    en,
    / · Winter conditions on 1 segment · 401 \(From Hwy 427 to Hwy 404\): Partly snow covered, visibility Fair$/,
  );
  const fr = summary(e, c, 'fr');
  assert.match(
    fr,
    /^4 événements \(1 fermeture\) · QEW deux directions : toutes voies fermées, fermeture, 8,7 km/,
  );
  assert.equal(summary([], null, 'en'), 'No event · Winter road conditions not read');
  assert.equal(
    summary(null, [], 'fr'),
    "Événements non lus · Aucun rapport récent sur l'état des routes en hiver dans la zone",
  );
  const many = Array.from({ length: 200 }, (_, i) =>
    readEvent(event(i + 1, { RoadwayName: `Road ${'x'.repeat(30)} ${i}` })),
  );
  const long = summary(matchEvents(zone, many, CAPTURED_AT), c, 'en');
  assert.ok([...long].length <= SUMMARY_MAX);
  assert.match(long, /\d+ more · Winter conditions on 1 segment/);
});
