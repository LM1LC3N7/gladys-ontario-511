// -----------------------------------------------------------------------------
// The reading of the Ontario 511 API: one bounded GET, the refusal of the key
// as 511on.ca gives it, the documented fields read strictly, the polylines.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_BODY_BYTES, REQUEST_TIMEOUT } from '../src/constants.js';
import { decodePolyline, readPoint } from '../src/geo.js';
import {
  classify,
  getJson,
  inEffect,
  isCurrent,
  readCondition,
  readEvent,
  readList,
  readRetryAfter,
  readUnix,
  resourceUrl,
} from '../src/ontario511.js';
import { testClock } from './kit/clock.mjs';
import {
  CAPTURED_AT,
  CONDITIONS_FIXTURE,
  EVENTS_FIXTURE,
  KEY,
  event,
  json,
} from './helpers/setup.js';

const answer = (response) => async () => response;

test('the URL: the documented path, key, format json, language', () => {
  const url = new URL(resourceUrl('/api/v2/get/event', KEY, 'fr'));
  assert.equal(url.origin + url.pathname, 'https://511on.ca/api/v2/get/event');
  assert.equal(url.searchParams.get('key'), KEY);
  assert.equal(url.searchParams.get('format'), 'json');
  assert.equal(url.searchParams.get('lang'), 'fr');
  assert.equal(new URL(resourceUrl('/x', 'a&b=c', 'de')).searchParams.get('key'), 'a&b=c');
  assert.equal(new URL(resourceUrl('/x', KEY, 'de')).searchParams.get('lang'), 'en');
});

test('"Invalid Key" (JSON and XML, as 511on.ca answers) is a refusal of the key; any other 400 is not', async () => {
  const refused = await getJson('u', {
    fetchImpl: answer(json({ Message: 'Invalid Key' }, { status: 400, date: CAPTURED_AT })),
  });
  assert.equal(refused.kind, 'key');
  const xml = await getJson('u', {
    fetchImpl: answer(
      new Response('<Error><Message>Invalid Key</Message></Error>', {
        status: 400,
        headers: { 'content-type': 'application/xml' },
      }),
    ),
  });
  assert.equal(xml.kind, 'key');
  for (const body of [
    { Message: 'Bad request' },
    { message: 'Invalid Key' },
    'Invalid Key',
    { Message: 'Invalid Key for this resource, see the documentation' },
  ]) {
    const other = await getJson('u', { fetchImpl: answer(json(body, { status: 400 })) });
    assert.equal(other.kind, 'http', JSON.stringify(body));
  }
  // 401 / 403: never a refusal of the key.
  for (const status of [401, 403]) {
    const other = await getJson('u', {
      fetchImpl: answer(json({ Message: 'Invalid Key' }, { status })),
    });
    assert.equal(other.kind, 'http');
  }
  // A huge 400 body is not read to the end, and not a refusal.
  const big = await getJson('u', {
    fetchImpl: answer(new Response('x'.repeat(10000), { status: 400 })),
  });
  assert.equal(big.kind, 'http');
});

test('429, 5xx, Retry-After; content type, size and JSON checked', async () => {
  const rate = await getJson('u', {
    fetchImpl: answer(
      json({}, { status: 429, date: CAPTURED_AT, headers: { 'retry-after': '90' } }),
    ),
  });
  assert.deepEqual([rate.kind, rate.retryAfter, rate.serverDate], ['rate', 90000, CAPTURED_AT]);
  const server = await getJson('u', { fetchImpl: answer(json({}, { status: 503 })) });
  assert.equal(server.kind, 'server');
  const html = await getJson('u', {
    fetchImpl: answer(new Response('<html/>', { headers: { 'content-type': 'text/html' } })),
  });
  assert.equal(html.kind, 'format');
  // A JSON-looking body served as a page (a proxy, a portal) is not the API.
  const page = await getJson('u', {
    fetchImpl: answer(new Response('[]', { headers: { 'content-type': 'text/html' } })),
  });
  assert.equal(page.kind, 'format');
  const broken = await getJson('u', {
    fetchImpl: answer(new Response('[{', { headers: { 'content-type': 'application/json' } })),
  });
  assert.equal(broken.kind, 'format');
  const declared = await getJson('u', {
    fetchImpl: answer(
      new Response('[]', {
        headers: {
          'content-type': 'application/json',
          'content-length': String(MAX_BODY_BYTES + 1),
        },
      }),
    ),
  });
  assert.equal(declared.kind, 'too_big');
  // A body without a length, cut while it streams.
  let pulled = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulled += 1;
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
  });
  const streamed = await getJson('u', {
    fetchImpl: answer(new Response(stream, { headers: { 'content-type': 'application/json' } })),
  });
  assert.equal(streamed.kind, 'too_big');
  assert.ok(pulled <= MAX_BODY_BYTES / (1024 * 1024) + 3, `${pulled} chunks read`);
  const ok = await getJson('u', { fetchImpl: answer(json([1], { date: CAPTURED_AT })) });
  assert.deepEqual([ok.ok, ok.json, ok.serverDate], [true, [1], CAPTURED_AT]);
  assert.equal(readRetryAfter('Fri, 27 Nov 2026 15:02:00 GMT', CAPTURED_AT), 120000);
  assert.equal(readRetryAfter('soon', CAPTURED_AT), null);
});

test('the request: honest User-Agent, JSON Accept, no redirect; cut at 30 s; never throws', async () => {
  let init;
  await getJson('u', {
    fetchImpl: async (url, i) => {
      init = i;
      return json([]);
    },
  });
  assert.match(
    init.headers['User-Agent'],
    /^gladys-ontario-511\/\d+\.\d+\.\d+ \(\+https:\/\/github\.com\/LM1LC3N7\/gladys-ontario-511\)$/,
  );
  assert.equal(init.headers.Accept, 'application/json');
  assert.equal(init.redirect, 'error');
  assert.equal(init.method, 'GET');
  const clock = testClock();
  const pending = getJson('u', {
    timers: clock.timers,
    fetchImpl: (url, i) =>
      new Promise((_, reject) =>
        i.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
      ),
  });
  await clock.advance(REQUEST_TIMEOUT);
  assert.equal((await pending).kind, 'timeout');
  const refused = await getJson('u', {
    fetchImpl: async () => {
      throw new TypeError('fetch failed https://511on.ca/?key=SECRET');
    },
  });
  assert.deepEqual(refused, { ok: false, kind: 'network', serverDate: null });
});

test('Unix times: integer seconds, plausible; anything else unknown (never 0)', () => {
  assert.equal(readUnix(1744084740), 1744084740000);
  for (const bad of [null, undefined, '1744084740', 1744084740.5, 0, -1, 1744084740000, NaN]) {
    assert.equal(readUnix(bad), null, String(bad));
  }
});

test('an event of the documented sample is read; id, place, closure, times', () => {
  const sample = EVENTS_FIXTURE.body[0];
  const e = readEvent(sample);
  assert.equal(e.id, '1963');
  assert.equal(e.type, 'roadwork');
  assert.equal(e.road, 'HWY 401');
  assert.equal(e.direction, 'Eastbound');
  assert.equal(e.fullClosure, false);
  assert.deepEqual(e.lines, [[[-79.668724, 43.63599]]]);
  assert.equal(e.start, sample.StartDate * 1000);
  // A missing ID falls back on Organization:SourceId; neither: not read.
  assert.equal(
    readEvent(event(null, { Organization: 'Toronto', SourceId: 'T-1' })).id,
    'Toronto:T-1',
  );
  assert.equal(readEvent(event(null, { SourceId: null })), null);
  assert.equal(readEvent(event(-4, { SourceId: null })), null);
  // A start there but unreadable (milliseconds, a text): not read, never counted at once.
  assert.equal(readEvent(event(1, { StartDate: CAPTURED_AT })), null);
  assert.equal(readEvent(event(1, { StartDate: '1744084740' })), null);
  assert.notEqual(readEvent(event(1, { StartDate: null })), null);
  // No place: not read. 0, 0 is not a place.
  assert.equal(readEvent(event(1, { Latitude: null, Longitude: null })), null);
  assert.equal(readEvent(event(1, { Latitude: 0, Longitude: 0 })), null);
  // A secondary point makes a segment; a polyline is a line.
  const two = readEvent(event(1, { LatitudeSecondary: 43.7, LongitudeSecondary: -79.4 }));
  assert.deepEqual(two.lines, [
    [
      [-79.384, 43.654],
      [-79.4, 43.7],
    ],
  ]);
  const poly = readEvent(event(1, { EncodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' }));
  assert.equal(poly.lines.length, 2);
  // A broken polyline is ignored; the point still places the event.
  assert.equal(readEvent(event(1, { EncodedPolyline: '\u0001\u0002' })).lines.length, 1);
  // Only an explicit true is a full closure.
  assert.equal(readEvent(event(1, { IsFullClosure: 'true' })).fullClosure, false);
  assert.equal(readEvent(event(1, { IsFullClosure: true })).fullClosure, true);
  assert.equal(readEvent(event(1, { EventType: 'parade' })).type, 'other');
  // Control bytes and HTML breaks never reach a text.
  assert.equal(readEvent(event(1, { Description: 'a\u0000b<br/>c' })).description, 'a b c');
});

test('in effect: listed and started; a planned start is not; an unknown start is', () => {
  const at = CAPTURED_AT;
  assert.equal(inEffect(readEvent(event(1)), at), true);
  assert.equal(inEffect(readEvent(event(1, { StartDate: at / 1000 + 60 })), at), false);
  assert.equal(inEffect(readEvent(event(1, { StartDate: null })), at), true);
  // Past its planned end, still listed: still there.
  assert.equal(inEffect(readEvent(event(1, { PlannedEndDate: at / 1000 - 60 })), at), true);
});

test('the Google polyline: the reference example, broken ones refused, bounded', () => {
  assert.deepEqual(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [
    [-120.2, 38.5],
    [-120.95, 40.7],
    [-126.453, 43.252],
  ]);
  assert.equal(decodePolyline(''), null);
  assert.equal(decodePolyline('_p~iF'), null, 'a latitude without its longitude');
  assert.equal(decodePolyline('_p~iF~ps|U_'), null, 'cut short');
  assert.equal(decodePolyline(' '), null, 'out of the alphabet');
  assert.equal(decodePolyline('~~~~~~~~~~~~~~?'), null, 'too long a value');
  assert.equal(decodePolyline(42), null);
  // 6000 points of 0.00001 steps: the first 5000 only.
  assert.equal(decodePolyline(`_p~iF~ps|U${'AA'.repeat(5999)}`).length, 5000);
  assert.equal(readPoint(91, 0), null);
  assert.equal(readPoint(43, '79'), null);
});

test('winter conditions: snow, ice, slush, drifting are winter; bare only is bare; the rest unknown', () => {
  assert.equal(classify(['Partly snow covered'], ''), 'winter');
  assert.equal(classify(['Bare and wet road', 'Ice covered'], ''), 'winter');
  assert.equal(classify(['Slushy'], ''), 'winter');
  assert.equal(classify(['Bare and dry road'], 'Yes'), 'winter');
  assert.equal(classify(['Chaussée partiellement enneigée'], ''), 'winter');
  assert.equal(classify(['Bare and dry road'], 'No'), 'bare');
  assert.equal(classify(['Bare and wet road', 'Bare and dry road'], null), 'bare');
  assert.equal(classify(['Chaussée sèche'], ''), 'bare');
  assert.equal(classify(['No Report'], ''), 'unknown');
  assert.equal(classify(['Closed'], ''), 'unknown');
  assert.equal(classify(['Bare and dry road', 'Spring thaw'], ''), 'unknown');
  assert.equal(classify([], ''), 'unknown');
});

test('a road condition of the documented samples is read; current within 24 h of the server time', () => {
  const [toronto, qew, , kenora] = CONDITIONS_FIXTURE.body.map(readCondition);
  assert.equal(toronto.state, 'winter');
  assert.equal(toronto.road, '401');
  assert.equal(toronto.lines[0].length, 3);
  assert.equal(qew.state, 'bare');
  assert.equal(qew.lines.length, 1, 'a list of polylines');
  assert.equal(isCurrent(toronto, CAPTURED_AT), true);
  assert.equal(isCurrent(kenora, CAPTURED_AT), false, 'the 2020 sample is not current');
  assert.equal(isCurrent({ updated: null }, CAPTURED_AT), false);
  assert.equal(isCurrent({ updated: CAPTURED_AT + 10 * 60000 }, CAPTURED_AT), false, 'future');
  assert.equal(isCurrent({ updated: CAPTURED_AT - 25 * 3600000 }, CAPTURED_AT), false);
  // Without a polyline nothing places a segment.
  assert.equal(readCondition({ ...CONDITIONS_FIXTURE.body[0], EncodedPolyline: null }), null);
  assert.deepEqual(
    readCondition({ ...CONDITIONS_FIXTURE.body[0], Condition: 'Snow packed' }).conditions,
    ['Snow packed'],
  );
});

test('a list: not a list is refused; mostly unreadable is never "nothing"; bounded', () => {
  assert.equal(readList({ Message: 'x' }, readEvent), null);
  assert.deepEqual(readList([], readEvent), { items: [], skipped: 0 });
  const mostly = readList([event(1), {}, {}], readEvent);
  assert.deepEqual(mostly, { unreadable: true, skipped: 2 });
  const some = readList([event(1), event(2), {}], readEvent);
  assert.equal(some.items.length, 2);
  assert.equal(some.skipped, 1);
  assert.deepEqual(readList(new Array(10001).fill(0), readEvent), { tooMany: true });
});
