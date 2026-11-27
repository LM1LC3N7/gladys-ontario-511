// -----------------------------------------------------------------------------
// The app on the virtual clock against a scripted Ontario 511: pace and quota,
// pauses, the developer key (missing, refused, retried), restart, status,
// publication per resource and the scene trigger.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAUSE_MAX,
  QUOTA_CALLS,
  QUOTA_WINDOW,
  REFRESH_MAX,
  REQUEST_GAP,
  REQUEST_TIMEOUT,
} from '../src/constants.js';
import { createMemoryStore } from '../src/store.js';
import {
  CAPTURED_AT,
  F,
  HOME,
  HOUR,
  KEY,
  MINUTE,
  SECOND,
  THREE_ZONES,
  createApi,
  event,
  invalidKey,
  json,
  layerOf,
  list,
  published,
  real,
  segment,
  setup,
} from './helpers/setup.js';

const INTERVAL = 15 * MINUTE;
/** The gap and a margin: the virtual clock moves 1 µs per read. */
const GAP = REQUEST_GAP + 100;
const status = (fake) => fake.connectionStatus;

/** The most calls seen in any window of QUOTA_WINDOW. */
function busiestMinute(calls) {
  let most = 0;
  for (const [i, call] of calls.entries()) {
    const inWindow = calls.slice(i).filter((c) => c.at - call.at < QUOTA_WINDOW).length;
    most = Math.max(most, inWindow);
  }
  return most;
}

test('the first round reads both resources, 7 s apart, and publishes counts and summary', async () => {
  const { fake, begin, api, wait } = await setup();
  await begin();
  assert.equal(api.calls.length, 1);
  await wait(GAP);
  assert.deepEqual(
    api.calls.map((c) => layerOf(c.url)),
    ['events', 'conditions'],
  );
  assert.ok(api.calls[1].at - api.calls[0].at >= REQUEST_GAP);
  assert.deepEqual(published(fake, F(1, 'events')), [4]);
  assert.deepEqual(published(fake, F(1, 'incidents')), [1]);
  assert.deepEqual(published(fake, F(1, 'roadwork')), [2]);
  assert.deepEqual(published(fake, F(1, 'closures')), [1]);
  assert.deepEqual(published(fake, F(1, 'winter_segments')), [1]);
  const [text] = published(fake, F(1, 'summary'));
  assert.match(text, /^4 events \(1 closure\) · QEW both directions: all lanes closed/);
  const summaryState = fake.states.find((s) => s.device_feature_external_id === F(1, 'summary'));
  assert.equal(summaryState.state, undefined, 'a text, never a number');
  assert.equal(status(fake).connected, true);
  assert.equal(
    status(fake).message.en,
    'Home: 4 event(s): 1 incident(s), 2 roadwork, 1 closure(s), read Nov 27, 10:00 ET; 1 segment(s) in winter conditions. Next read Nov 27, 10:15 ET.',
  );
  assert.match(status(fake).message.fr, /^Home : 4 événement\(s\) : 1 incident\(s\)/);
});

test('one request per resource for every zone; the key only in the query string', async () => {
  const { begin, api, wait, fake } = await setup({ config: { ...THREE_ZONES, language: 'fr' } });
  await begin();
  await wait(GAP);
  assert.equal(api.calls.length, 2, 'two requests a round, whatever the number of zones');
  const url = new URL(api.calls[0].url);
  assert.equal(url.origin + url.pathname, 'https://511on.ca/api/v2/get/event');
  assert.equal(url.searchParams.get('key'), KEY);
  assert.equal(url.searchParams.get('lang'), 'fr');
  assert.equal(new URL(api.calls[1].url).pathname, '/api/v3/get/roadconditions');
  const headers = api.calls[0].init.headers;
  assert.ok(!JSON.stringify(headers).includes(KEY));
  assert.match(headers['User-Agent'], /^gladys-ontario-511\//);
  // North Bay zone: the HWY 11 roadwork and its winter segment.
  assert.deepEqual(published(fake, F(2, 'roadwork')), [1]);
  assert.deepEqual(published(fake, F(2, 'winter_segments')), [1]);
  assert.match(
    published(fake, F(2, 'summary'))[0],
    /^1 événement · HWY 11 direction nord : travaux/,
  );
});

test('a zone not created in Gladys is read but nothing is published for it', async () => {
  const { fake, begin, api, wait } = await setup({ created: false });
  await begin();
  await wait(GAP);
  assert.equal(api.calls.length, 2);
  assert.equal(fake.states.length, 0);
  assert.equal(fake.discoveredDevices.length, 1);
});

test('the period: rounds at 0, the interval, twice the interval; Discovery and the button never read', async () => {
  const { begin, api, wait, fake, app } = await setup();
  await begin();
  await wait(INTERVAL - 1);
  assert.equal(api.calls.length, 2, 'never before the interval');
  await wait(1);
  assert.equal(api.calls.length, 3);
  await wait(INTERVAL);
  assert.deepEqual(
    api.calls.filter((c) => layerOf(c.url) === 'events').map((c) => Math.round(c.at)),
    [0, INTERVAL, 2 * INTERVAL],
  );
  await fake.scanRequest();
  const answer = app.testConnection();
  assert.match(answer.en, /^Home: 4 event\(s\)/);
  await wait(INTERVAL - 1);
  assert.equal(api.calls.length, 6);
});

test('the quota: never more than 10 calls in any minute, whatever the saves and presses', async () => {
  // A refused key, pressed again and again, then accepted; zones moved in a row.
  let refuse = true;
  const api = createApi((url, a) => (refuse ? invalidKey(a.clock.wall()) : real(url)));
  const { begin, api: calls, wait, app } = await setup({ api });
  await begin();
  for (let i = 0; i < 40; i += 1) {
    app.testConnection();
    await wait(SECOND);
  }
  refuse = false;
  await wait(20 * SECOND);
  app.testConnection();
  await wait(20 * SECOND);
  for (let i = 0; i < 20; i += 1) {
    await app.start({ ...HOME, zone1_latitude: 43.6 + i / 100 });
    await wait(2 * SECOND);
  }
  await wait(2 * HOUR);
  assert.ok(calls.calls.length > 20, `${calls.calls.length} calls`);
  const most = busiestMinute(calls.calls);
  assert.ok(most <= QUOTA_CALLS - 1, `${most} calls in a minute`);
  for (let i = 1; i < calls.calls.length; i += 1) {
    assert.ok(calls.calls[i].at - calls.calls[i - 1].at >= REQUEST_GAP - 1);
  }
  assert.equal(calls.peak, 1, 'never two requests at once');
});

test('the interval is 10 min at least, 120 at most; refused values fall back to 15', async () => {
  const { begin, api, wait, fake } = await setup({ config: { ...HOME, refresh_minutes: 5 } });
  await begin();
  await wait(INTERVAL - 1);
  assert.equal(api.calls.length, 2);
  await wait(1);
  assert.equal(api.calls.length, 3);
  assert.match(
    status(fake).message.en,
    /refresh_minutes must be a whole number of minutes between 10 and 120/,
  );
  const ten = await setup({ config: { ...HOME, refresh_minutes: 10 } });
  await ten.begin();
  await ten.wait(10 * MINUTE);
  assert.equal(ten.api.calls.length, 3);
});

test('a restart never reads sooner than the interval (time of the last attempt in /data)', async () => {
  const store = createMemoryStore();
  const first = await setup({ store });
  await first.begin();
  assert.ok(store.data.lastAttemptAt > 0, 'written before the read');
  await first.wait(GAP);
  await first.app.stop();

  const second = await setup({ store, start: CAPTURED_AT + MINUTE });
  await second.begin();
  assert.equal(second.api.calls.length, 0);
  assert.equal(second.fake.states.length, 0, 'nothing stale published at start');
  assert.match(status(second.fake).message.en, /Home: no read yet\. Next read Nov 27, 10:15 ET\./);
  await second.wait(14 * MINUTE - 1);
  assert.equal(second.api.calls.length, 0);
  await second.wait(10);
  assert.equal(second.api.calls.length, 1);
});

test('a date of /data in the future, or an unreadable /data: the first read waits 10 min', async () => {
  const future = await setup({ store: createMemoryStore({ lastAttemptAt: CAPTURED_AT + HOUR }) });
  await future.begin();
  assert.equal(future.api.calls.length, 0);
  assert.match(status(future.fake).message.en, /the first read waits 10 min after the start/);
  await future.wait(10 * MINUTE - 10);
  assert.equal(future.api.calls.length, 0);
  await future.wait(20);
  assert.equal(future.api.calls.length, 1);

  const store = createMemoryStore(undefined, { status: 'unreadable' });
  const broken = await setup({ store });
  await broken.begin();
  assert.equal(broken.api.calls.length, 0);
  assert.match(status(broken.fake).message.en, /unreadable: left untouched/);
  await broken.wait(10 * MINUTE + GAP);
  assert.equal(broken.api.calls.length, 2);
  assert.equal(store.saves, 0, 'never overwritten');
  await broken.app.stop();
});

test('a configuration saved unchanged reads no sooner; a moved zone or a new key reads at once', async () => {
  const { begin, api, wait, app } = await setup();
  await begin();
  await wait(MINUTE);
  await app.start({ ...HOME });
  await wait(0);
  assert.equal(api.calls.length, 2, 'unchanged: no read');
  await app.start({ ...HOME, zone1_latitude: 43.7 });
  await wait(GAP);
  assert.equal(api.calls.length, 4, 'moved: read at once');
  await app.start({ ...HOME, zone1_latitude: 43.7, api_key: 'OTHERKEY-123456' });
  await wait(GAP);
  assert.equal(api.calls.length, 5, 'new key: read at once, 7 s after the last call');
  assert.equal(new URL(api.calls[4].url).searchParams.get('key'), 'OTHERKEY-123456');
});

test('no key: nothing read, the status says how to get one; a malformed key is named, never shown', async () => {
  const { begin, api, wait, fake } = await setup({ config: { ...HOME, api_key: '' } });
  await begin();
  await wait(HOUR);
  assert.equal(api.calls.length, 0);
  assert.equal(status(fake).connected, false);
  assert.match(status(fake).message.en, /^No developer key: request a free one on 511on\.ca/);
  assert.match(status(fake).message.fr, /^Aucune clé de développeur/);
  const secret = 'not a key at all';
  const bad = await setup({ config: { ...HOME, api_key: secret } });
  await bad.begin();
  await bad.wait(HOUR);
  assert.equal(bad.api.calls.length, 0);
  assert.match(status(bad.fake).message.en, /Field api_key cannot be a developer key/);
  assert.ok(!JSON.stringify([bad.fake.connectionStatuses, bad.lines]).includes(secret));
});

test('a refused key: one call, then nothing until changed; kept in /data as 8 bits, never the key', async () => {
  const api = createApi((url, a) => invalidKey(a.clock.wall()));
  const store = createMemoryStore();
  const { begin, wait, fake, lines, app } = await setup({ api, store });
  await begin();
  await wait(GAP);
  assert.equal(api.calls.length, 1, 'the conditions are not asked with a refused key');
  await wait(24 * HOUR);
  assert.equal(api.calls.length, 1, 'no automatic try');
  assert.equal(status(fake).connected, false);
  assert.match(
    status(fake).message.en,
    /^Ontario 511 refused the developer key \(Invalid Key\): nothing is read until the key is changed or the test button is pressed/,
  );
  assert.doesNotMatch(status(fake).message.en, /Next read/);
  assert.match(store.data.refusedKey, /^[0-9a-f]{2}$/);
  const everything = JSON.stringify([store.data, fake.connectionStatuses, lines, fake.states]);
  assert.ok(!everything.includes(KEY), 'the key is nowhere');
  assert.ok(!everything.includes(KEY.slice(0, 8)));
  await app.stop();

  // A restart with the same key: still no try.
  const again = await setup({ api, store, start: api.clock.wall() });
  await again.begin();
  await again.wait(24 * HOUR);
  assert.equal(api.calls.length, 1);
  assert.match(status(again.fake).message.en, /refused the developer key/);
  await again.app.stop();

  // A new key is always tried.
  const other = await setup({
    api: createApi(real),
    store,
    config: { ...HOME, api_key: 'NEWKEY-abcdef123' },
    start: api.clock.wall(),
  });
  await other.begin();
  await other.wait(GAP);
  assert.equal(other.api.calls.length, 2);
  assert.equal(status(other.fake).connected, true);
  assert.equal(store.data.refusedKey, undefined, 'lifted by a success');
});

test('a refused key saved again unchanged is not sent again (memory of this process)', async () => {
  const api = createApi((url, a) => invalidKey(a.clock.wall()));
  const store = createMemoryStore();
  const { begin, wait, app } = await setup({ api, store });
  await begin();
  await wait(GAP);
  assert.equal(api.calls.length, 1);
  // Even with /data forgetting it (a refusal of 8 bits is not the only guard).
  delete store.data.refusedKey;
  app.persisted.refusedKey = '__';
  await app.start({ ...HOME });
  await wait(INTERVAL * 2);
  assert.equal(api.calls.length, 1);
});

test('a refusal found in /data once it reads again stops the reads; a try leaves no timer', async () => {
  const salt = '0123456789abcdef0123456789abcdef';
  const refusedKey = createHash('sha256')
    .update(JSON.stringify(['key', salt, KEY]))
    .digest('hex')
    .slice(0, 2);
  const boot = async () => {
    const store = createMemoryStore({ salt, refusedKey, lastAttemptAt: CAPTURED_AT - HOUR });
    const load = store.load.bind(store);
    let broken = true;
    store.load = () => (broken ? { status: 'unreadable', data: {} } : load());
    const api = createApi((url, a) => invalidKey(a.clock.wall()));
    const run = await setup({ api, store });
    await run.begin();
    broken = false;
    await run.wait(15 * SECOND);
    assert.match(status(run.fake).message.en, /refused the developer key/);
    return run;
  };
  // The round armed for 10 min after the start is not run.
  const first = await boot();
  await first.wait(15 * MINUTE);
  assert.equal(first.api.calls.length, 0);
  await first.app.stop();
  // A try before that round, refused again, clears it: no timer left.
  const second = await boot();
  assert.match(second.app.testConnection().en, /tried again now/);
  await second.wait(GAP);
  assert.equal(second.api.calls.length, 1);
  assert.equal(second.clock.pending, 0, 'refused again: no timer left');
  await second.wait(HOUR);
  assert.equal(second.api.calls.length, 1);
});

test('the refusal fingerprint is truncated: a brute force over it finds many keys, not one', async () => {
  const api = createApi((url, a) => invalidKey(a.clock.wall()));
  // A fixed salt: the test is the same on every run.
  const store = createMemoryStore({ salt: 'fedcba9876543210fedcba9876543210' });
  const { begin, wait, app } = await setup({ api, store });
  await begin();
  await wait(0);
  const matching = [];
  for (let i = 0; i < 5000; i += 1) {
    if (app.keyPrint(`CANDIDATE-${i}`).slice(0, 2) === store.data.refusedKey) matching.push(i);
  }
  assert.ok(matching.length >= 5, `${matching.length} candidates share the 8 bits`);
});

test('the test button tries a refused key once per press; a success lifts the refusal', async () => {
  let refuse = true;
  const api = createApi(async (url, a) => {
    await new Promise((resolve) => a.clock.timers.setTimeout(resolve, 2 * SECOND));
    return refuse ? invalidKey(a.clock.wall()) : real(url);
  });
  const { begin, wait, fake, app, store } = await setup({ api });
  await begin();
  await wait(5 * SECOND);
  assert.equal(api.calls.length, 1);
  assert.equal(
    app.testConnection().en,
    'The developer key is tried again now (one read); the status will tell the result.',
  );
  assert.match(app.testConnection().en, /already under way/);
  await wait(10 * SECOND);
  assert.equal(api.calls.length, 2, 'one press, one try; the second press while it ran: none');
  assert.ok(api.calls[1].at - api.calls[0].at >= REQUEST_GAP);
  refuse = false;
  app.testConnection();
  await wait(20 * SECOND);
  assert.equal(api.calls.length, 4);
  assert.equal(status(fake).connected, true);
  assert.equal(store.data.refusedKey, undefined);
  assert.match(app.testConnection().en, /^Home: 4 event\(s\)/, 'no more a try');
  await wait(INTERVAL);
  assert.equal(api.calls.length, 6, 'the period goes on');
});

test('the test button never tries a refused key during a pause', async () => {
  const api = createApi((url, a) => invalidKey(a.clock.wall()));
  const { begin, wait, app, clock } = await setup({ api });
  await begin();
  await wait(GAP);
  assert.equal(api.calls.length, 1);
  app.pauseUntilMono = clock.monotonic() + 10 * MINUTE;
  assert.match(app.testConnection().en, /reads paused until/);
  await wait(GAP);
  assert.equal(api.calls.length, 1);
  await wait(10 * MINUTE);
  assert.match(app.testConnection().en, /tried again now/);
  await wait(GAP);
  assert.equal(api.calls.length, 2);
});

test('a 401 or 403 on the events is never a refusal of the key: spaced out, then read again', async () => {
  let answer = (a) => json({ Message: 'Forbidden' }, { status: 403, date: a.clock.wall() });
  const api = createApi((url, a) => answer(a));
  const { begin, wait, fake, store } = await setup({ api });
  await begin();
  assert.match(
    status(fake).message.en,
    /Unexpected answer from Ontario 511 \(HTTP 403\): reads paused/,
  );
  assert.equal(store.data.refusedKey, undefined);
  assert.equal(store.data.pause.levelHttp, 1);
  answer = (a) => json(list('events'), { date: a.clock.wall() });
  await wait(INTERVAL + GAP);
  assert.equal(api.calls.length, 3);
  assert.deepEqual(published(fake, F(1, 'events')), [4]);
});

test('the winter conditions refused alone (400 Invalid Key): events published, spaced up to 1 h, no pause', async () => {
  const api = createApi((url, a) =>
    layerOf(url) === 'conditions' ? invalidKey(a.clock.wall()) : real(url),
  );
  const { begin, wait, fake, store } = await setup({ api });
  await begin();
  await wait(GAP);
  assert.deepEqual(published(fake, F(1, 'events')), [4]);
  assert.deepEqual(published(fake, F(1, 'winter_segments')), []);
  assert.match(published(fake, F(1, 'summary'))[0], / · Winter road conditions not read$/);
  assert.equal(store.data.refusedKey, undefined, 'never a refusal of the key');
  assert.equal(store.data.pause, undefined, 'no pause');
  assert.equal(status(fake).connected, true);
  assert.match(status(fake).message.en, /winter conditions: Ontario 511 refused the developer key/);
  await wait(4 * HOUR);
  const asked = api.calls
    .filter((c) => layerOf(c.url) === 'conditions')
    .map((c) => Math.round(c.at / MINUTE));
  assert.equal(
    api.calls.filter((c) => layerOf(c.url) === 'events').length,
    17,
    'events every round',
  );
  // 0, then 15 (level 1), then 45 (30 min), then every hour.
  assert.deepEqual(asked, [0, 15, 45, 105, 165, 225]);
  assert.match(status(fake).message.en, /not asked this round|refused the developer key/i);
});

test('a 429 pauses every read (2 min, doubled), kept in /data across a restart', async () => {
  let limited = true;
  const api = createApi((url, a) =>
    limited ? json({ Message: 'Too many' }, { status: 429, date: a.clock.wall() }) : real(url),
  );
  const store = createMemoryStore();
  const { begin, wait, fake, app } = await setup({ api, store });
  await begin();
  await wait(MINUTE);
  assert.equal(api.calls.length, 1, 'the other resource is not asked during the pause');
  assert.equal(status(fake).connected, false);
  assert.match(
    status(fake).message.en,
    /^Ontario 511 asked to slow down \(429\): reads paused until Nov 27, 10:02 ET\./,
  );
  assert.match(status(fake).message.en, /winter conditions: not read \(pause\), no data yet/);
  assert.ok(store.data.pause.until > CAPTURED_AT);
  await wait(INTERVAL - MINUTE);
  assert.equal(api.calls.length, 2, 'retried at the next round');
  assert.equal(store.data.pause.level429, 2);
  await app.stop();

  // Restart during the pause: still paused.
  const second = await setup({ api, store, start: api.clock.wall() });
  await second.begin();
  assert.equal(api.calls.length, 2);
  limited = false;
  // The pause (4 min) ends before the interval: the restart reads at the interval.
  await second.wait(INTERVAL + GAP);
  assert.equal(api.calls.length, 4);
  assert.equal(status(second.fake).connected, true);
  assert.equal(store.data.pause.level429, 0, 'a success resets the doubling');
});

test('a 5xx pauses for 5 min (doubled); Retry-After is honored, bounded to 6 h', async () => {
  let answer = (a) => json({ error: 'x' }, { status: 503, date: a.clock.wall() });
  const api = createApi((url, a) => answer(a));
  const { begin, wait, fake } = await setup({ api });
  await begin();
  assert.match(
    status(fake).message.en,
    /Ontario 511 server error \(HTTP 503\): reads paused until Nov 27, 10:05 ET/,
  );
  await wait(INTERVAL);
  assert.equal(api.calls.length, 2);
  answer = (a) =>
    json({}, { status: 429, date: a.clock.wall(), headers: { 'retry-after': String(100 * 3600) } });
  await wait(INTERVAL);
  assert.equal(api.calls.length, 3, 'answered 429 with a 100 h Retry-After');
  await wait(6 * HOUR - 10);
  assert.equal(api.calls.length, 3);
  await wait(20);
  assert.equal(api.calls.length, 4, 'six hours at most');
});

test('one resource failing: its features are not published (never 0), the other one is', async () => {
  let fail = 'conditions';
  const api = createApi((url) => (layerOf(url) === fail ? 'network' : real(url)));
  const { begin, wait, fake } = await setup({ api });
  await begin();
  await wait(GAP);
  assert.deepEqual(published(fake, F(1, 'events')), [4]);
  assert.deepEqual(published(fake, F(1, 'winter_segments')), []);
  assert.match(
    status(fake).message.en,
    /winter conditions: Ontario 511 could not be reached, no data yet/,
  );
  fail = 'events';
  await wait(INTERVAL);
  assert.deepEqual(published(fake, F(1, 'events')), [4], 'nothing for the failed events');
  assert.deepEqual(published(fake, F(1, 'winter_segments')), [1]);
  assert.match(
    published(fake, F(1, 'summary'))[1],
    /^Events not read · Winter conditions on 1 segment/,
  );
  assert.match(
    status(fake).message.en,
    /events: Ontario 511 could not be reached, last data Nov 27, 10:00 ET, nothing published since/,
  );
  fail = 'both';
  const all = createApi(() => 'network');
  const down = await setup({ api: all });
  await down.begin();
  await down.wait(GAP);
  assert.equal(down.fake.states.length, 0);
  assert.equal(status(down.fake).connected, false);
});

test('a request that never answers is cut at 30 s and the other resource goes on', async () => {
  const api = createApi((url) => (layerOf(url) === 'events' ? 'timeout' : real(url)));
  const { begin, wait, fake } = await setup({ api });
  await begin();
  await wait(REQUEST_TIMEOUT);
  await wait(0);
  assert.equal(api.calls.length, 2);
  assert.deepEqual(published(fake, F(1, 'winter_segments')), [1]);
  assert.match(status(fake).message.en, /events: Ontario 511 did not answer in time/);
});

test('winter count unknown (no current report) is never published, never 0', async () => {
  const api = createApi((url) =>
    layerOf(url) === 'conditions'
      ? [
          segment({ LastUpdated: CAPTURED_AT / 1000 - 3 * 86400 }),
          segment({ Condition: ['No Report'] }),
        ]
      : real(url),
  );
  const { begin, wait, fake } = await setup({ api });
  await begin();
  await wait(GAP);
  assert.deepEqual(published(fake, F(1, 'winter_segments')), []);
  assert.match(
    published(fake, F(1, 'summary'))[0],
    / · No current winter road report in the zone$/,
  );
  assert.match(status(fake).message.en, /no current winter road report/);
  // Bare roads: a real 0.
  const bare = await setup({
    api: createApi((url) =>
      layerOf(url) === 'conditions' ? [segment({ Condition: ['Bare and dry road'] })] : real(url),
    ),
  });
  await bare.begin();
  await bare.wait(GAP);
  assert.deepEqual(published(bare.fake, F(1, 'winter_segments')), [0]);
});

test('an answer that is not a list, or mostly unreadable, publishes nothing and pauses nothing', async () => {
  const api = createApi((url) =>
    layerOf(url) === 'events' ? { Message: 'odd' } : [{}, {}, segment()],
  );
  const { begin, wait, fake, store } = await setup({ api });
  await begin();
  await wait(GAP);
  assert.equal(fake.states.length, 0);
  assert.equal(store.data.pause, undefined);
  assert.match(status(fake).message.en, /events: Ontario 511 answer not readable/);
  assert.match(
    status(fake).message.en,
    /winter conditions: Ontario 511 sends items that cannot be read/,
  );
});

test('no believable time (Date more than a day off, local clock lost): nothing counted', async () => {
  const api = createApi((url, a) => json(real(url), { date: a.clock.wall() + 3 * 24 * HOUR }));
  const { begin, wait, fake } = await setup({ api });
  await begin();
  await wait(GAP);
  assert.equal(fake.states.length, 0);
  assert.match(status(fake).message.en, /no believable time/i);
  // No Date at all and a plausible local clock: the local clock.
  const noDate = await setup({ api: createApi((url) => json(real(url), { date: null })) });
  await noDate.begin();
  await noDate.wait(GAP);
  assert.deepEqual(published(noDate.fake, F(1, 'events')), [4]);
});

test('the scene trigger: the first read learns, a new fresh event fires once, an old one never', async () => {
  let extra = [];
  const api = createApi((url) =>
    layerOf(url) === 'events' ? [...list('events'), ...extra] : real(url),
  );
  const { begin, wait, fake } = await setup({ api });
  await begin();
  await wait(GAP);
  assert.equal(fake.sceneEvents.length, 0, 'the first read only learns');
  const at = CAPTURED_AT / 1000;
  extra = [
    event(9001, {
      EventType: 'closures',
      IsFullClosure: true,
      Reported: at + 800,
      LastUpdated: at + 850,
      StartDate: at + 800,
    }),
    event(9002, { Reported: at - 5 * 3600, LastUpdated: at - 4 * 3600, StartDate: at - 5 * 3600 }),
  ];
  await wait(INTERVAL);
  assert.equal(fake.sceneEvents.length, 1);
  const [scene] = fake.sceneEvents;
  assert.equal(scene.key ?? scene.trigger, 'new_event');
  const data = scene.data ?? scene.payload ?? scene;
  assert.equal(data.event_id, '9001');
  assert.equal(data.event_type, 'closures');
  assert.equal(data.full_closure, true);
  assert.equal(data.closure, true);
  assert.equal(data.device, 'ext:ontario-511:zone:1');
  assert.ok(!JSON.stringify(fake.sceneEvents).includes(KEY));
  await wait(INTERVAL);
  assert.equal(fake.sceneEvents.length, 1, 'once');
});

test('getConfig() failing on a connection is retried, spaced out, forever; then it starts', async () => {
  const { app, gladys, fake, wait, api } = await setup();
  const original = gladys.getConfig.bind(gladys);
  let failures = 4;
  gladys.getConfig = async () => {
    if (failures > 0) {
      failures -= 1;
      throw new Error('Gladys busy');
    }
    return original();
  };
  const connected = app.connected();
  await wait(0);
  assert.equal(status(fake).connected, false);
  assert.match(status(fake).message.en, /next try in 5 s/);
  await wait(5 * SECOND);
  assert.match(status(fake).message.en, /next try in 10 s/);
  await wait(10 * SECOND);
  await wait(20 * SECOND);
  assert.match(status(fake).message.en, /next try in 40 s/);
  assert.equal(api.calls.length, 0);
  await wait(40 * SECOND);
  await connected;
  await wait(GAP);
  assert.equal(api.calls.length, 2);
  assert.equal(status(fake).connected, true);
});

test('a disconnection stops the config retries and the reads; a reconnection never reads sooner', async () => {
  const { app, gladys, wait, api } = await setup();
  let calls = 0;
  gladys.getConfig = async () => {
    calls += 1;
    throw new Error('down');
  };
  app.connected();
  await wait(0);
  await app.disconnected();
  await wait(HOUR);
  assert.equal(calls, 1);
  delete gladys.getConfig;
  await app.connected();
  await wait(GAP);
  assert.equal(api.calls.length, 2);
  await app.disconnected();
  await app.connected();
  await wait(GAP);
  assert.equal(api.calls.length, 2, 'a reconnection is not a read');
  await wait(INTERVAL);
  assert.equal(api.calls.length, 4);
});

test('a stop cuts the request in flight, leaves no timer, and nothing is asked after it', async () => {
  const api = createApi(() => 'timeout');
  const { begin, app, clock, wait } = await setup({ api });
  await begin();
  assert.equal(api.calls.length, 1);
  await app.stop();
  await wait(0);
  assert.equal(clock.pending, 0, 'no timer left');
  await wait(10 * HOUR);
  assert.equal(api.calls.length, 1);
});

test('a round that throws is never the last: the next one comes at the interval', async () => {
  const { begin, app, api, wait, lines } = await setup();
  const original = app.onZoneRead.bind(app);
  let throws = 1;
  app.onZoneRead = async (...args) => {
    if (throws > 0) {
      throws -= 1;
      throw new TypeError('boom');
    }
    return original(...args);
  };
  await begin();
  await wait(GAP);
  assert.ok(lines.some((l) => /Read failed \(TypeError\); next read at the interval/.test(l)));
  await wait(INTERVAL + GAP);
  assert.equal(api.calls.length, 4);
});

test('no timer is ever armed for an infinite or huge time', async () => {
  const { begin, app, clock, wait } = await setup({
    store: createMemoryStore({ pause: { until: Number.MAX_VALUE, kind: 'rate' } }),
  });
  const delays = [];
  const original = clock.timers.setTimeout;
  clock.timers.setTimeout = (fn, ms, ...args) => {
    delays.push(ms);
    return original(fn, ms, ...args);
  };
  await begin();
  await wait(INTERVAL);
  app.scheduleCycle(Infinity, app.gen);
  app.scheduleCycle(NaN, app.gen);
  app.sleep(Infinity);
  await wait(0);
  assert.ok(delays.length > 3);
  for (const ms of delays) {
    assert.ok(Number.isFinite(ms) && ms >= 0 && ms <= PAUSE_MAX + REFRESH_MAX * MINUTE, String(ms));
  }
  await app.stop();
});

test('the key never reaches a log, the status, /data or a scene, whatever happens', async () => {
  const worlds = [
    (url, a) => invalidKey(a.clock.wall()),
    () => 'network',
    () => 'timeout',
    (url, a) => json({}, { status: 500, date: a.clock.wall() }),
    (url) => real(url),
  ];
  for (const world of worlds) {
    const store = createMemoryStore();
    const { begin, wait, fake, lines, app } = await setup({ api: createApi(world), store });
    await begin();
    await wait(2 * INTERVAL);
    app.testConnection();
    await wait(INTERVAL);
    const text = JSON.stringify([
      lines,
      fake.connectionStatuses,
      store.data,
      fake.sceneEvents,
      fake.states,
    ]);
    assert.ok(!text.includes(KEY), world.toString());
    await app.stop();
  }
});

// --- Review r1 -----------------------------------------------------------------

test('the gap itself keeps the quota: ceil(60 s / gap) calls at most, 9 < 10 (literal numbers)', () => {
  assert.ok(Math.ceil(60000 / REQUEST_GAP) <= 9, `${REQUEST_GAP} ms allows 10 calls a minute`);
  assert.equal(QUOTA_CALLS, 10);
  assert.equal(QUOTA_WINDOW, 60000);
});

test('the quota saturated: zones moved every 3 s, then a refused key pressed every second', async () => {
  const { begin, api, wait, app } = await setup();
  await begin();
  for (let i = 0; i < 30; i += 1) {
    await app.start({ ...HOME, zone1_latitude: 43.6 + i / 1000 });
    await wait(3 * SECOND);
  }
  const moved = api.calls.length;
  assert.ok(moved >= 12, `${moved} calls in 90 s: the gap is the only limit`);
  const most = busiestMinute(api.calls);
  assert.ok(most >= 8 && most <= 9, `${most} calls in a minute`);

  const refused = createApi((url, a) => invalidKey(a.clock.wall()));
  const second = await setup({ api: refused });
  await second.begin();
  for (let i = 0; i < 90; i += 1) {
    second.app.testConnection();
    await second.wait(SECOND);
  }
  const pressed = busiestMinute(refused.calls);
  assert.ok(pressed >= 8 && pressed <= 9, `${pressed} calls in a minute`);
  assert.equal(refused.peak, 1);
});

test('a zone moved while the round publishes slowly: a new round starts, the cycle goes on', async () => {
  const { begin, api, wait, app, gladys, clock } = await setup();
  const publish = gladys.publishStates.bind(gladys);
  gladys.publishStates = async (states) => {
    await new Promise((resolve) => clock.timers.setTimeout(resolve, 3 * SECOND));
    return publish(states);
  };
  await begin();
  await wait(GAP + 500);
  assert.equal(api.calls.length, 2);
  await app.start({ ...HOME, zone1_latitude: 43.7 });
  await wait(GAP);
  assert.equal(api.calls.length, 3, 'a new round, 7 s after the last call');
  await wait(GAP + 5 * SECOND);
  assert.equal(api.calls.length, 4);
  assert.ok(app.cycleTimer !== null, 'the next round is armed');
  await wait(INTERVAL);
  assert.equal(api.calls.length, 6);
});

test('a zone moved while /data is slow at the start of a round: a new round starts', async () => {
  const store = createMemoryStore();
  const { begin, api, wait, app, clock } = await setup({ store });
  await begin();
  await wait(GAP);
  assert.equal(api.calls.length, 2);
  // From now on, every save of /data hangs 3 s (bounded to 2 s by the app).
  store.hold = new Promise((resolve) => clock.timers.setTimeout(resolve, 3 * SECOND));
  await app.start({ ...HOME, zone1_latitude: 43.7 });
  await wait(SECOND);
  assert.equal(api.calls.length, 2, 'the round waits for /data');
  await app.start({ ...HOME, zone1_latitude: 43.8 });
  // The last call was at 7 s: the new round calls at 14 s (gap).
  await wait(7 * SECOND);
  assert.equal(api.calls.length, 3, 'a new round, not the old one waited for');
  assert.equal(new URL(api.calls[2].url).pathname, '/api/v2/get/event');
  await wait(GAP);
  assert.equal(api.calls.length, 4);
  await wait(INTERVAL);
  assert.equal(api.calls.length, 6, 'the cycle goes on');
});

test('a 429 on the winter conditions pauses every read with its Retry-After, kept in /data', async () => {
  let conditions = (a) =>
    json({}, { status: 429, date: a.clock.wall(), headers: { 'retry-after': '10800' } });
  const api = createApi((url, a) => (layerOf(url) === 'conditions' ? conditions(a) : real(url)));
  const store = createMemoryStore();
  const { begin, wait, fake, app } = await setup({ api, store });
  await begin();
  await wait(GAP);
  assert.equal(api.calls.length, 2);
  assert.deepEqual(published(fake, F(1, 'events')), [4], 'the events read are published');
  assert.ok(app.pausedFor() > 2.9 * HOUR, 'paused for the Retry-After');
  assert.equal(store.data.pause.kind, 'rate');
  assert.ok(store.data.pause.until >= CAPTURED_AT + 3 * HOUR);
  assert.match(
    status(fake).message.en,
    /asked to slow down \(429\): reads paused until Nov 27, 13:00 ET/,
  );
  await app.stop();
  // A restart during the pause: still paused, then a 503 on the conditions doubles its own level.
  conditions = (a) => json({}, { status: 503, date: a.clock.wall() });
  const second = await setup({ api, store, start: api.clock.wall() });
  await second.begin();
  await second.wait(3 * HOUR - MINUTE);
  assert.equal(api.calls.length, 2);
  await second.wait(MINUTE + GAP);
  assert.equal(api.calls.length, 4);
  assert.equal(store.data.pause.level5xx, 1);
  assert.equal(store.data.pause.kind, 'server');
  await second.wait(INTERVAL + GAP);
  assert.equal(api.calls.length, 6);
  assert.equal(store.data.pause.level5xx, 2, 'doubled, not erased by the events read');
});

test('an empty list of events for the whole province is not "no event": nothing published', async () => {
  const api = createApi((url) => (layerOf(url) === 'events' ? [] : real(url)));
  const { begin, wait, fake, store } = await setup({ api });
  await begin();
  await wait(GAP);
  assert.deepEqual(published(fake, F(1, 'events')), []);
  assert.deepEqual(published(fake, F(1, 'closures')), []);
  assert.deepEqual(published(fake, F(1, 'winter_segments')), [1]);
  assert.match(published(fake, F(1, 'summary'))[0], /^Events not read · /);
  assert.match(
    status(fake).message.en,
    /events: Ontario 511 sends an empty list of events for the whole province/,
  );
  assert.equal(store.data.pause, undefined, 'no pause');
});

test('a pause asked by a late answer of an older round holds the request of the new one', async () => {
  const api = createApi(async (url, a) => {
    await new Promise((resolve) => a.clock.timers.setTimeout(resolve, 10 * SECOND));
    return json({}, { status: 429, date: a.clock.wall() });
  });
  const { begin, wait, app } = await setup({ api });
  await begin();
  await wait(SECOND);
  await app.start({ ...HOME, zone1_latitude: 43.7 });
  await wait(30 * SECOND);
  assert.equal(api.calls.length, 1, 'the new round sends nothing during the pause');
  assert.ok(app.pausedFor() > 0);
});

test('one request at a time: a slow answer holds the next one past the gap', async () => {
  const api = createApi(async (url, a) => {
    if (layerOf(url) === 'events') {
      await new Promise((resolve) => a.clock.timers.setTimeout(resolve, 20 * SECOND));
    }
    return real(url);
  });
  const { begin, wait } = await setup({ api });
  await begin();
  await wait(30 * SECOND);
  assert.equal(api.calls.length, 2);
  assert.ok(api.calls[1].at >= 20 * SECOND, `${api.calls[1].at}`);
  assert.equal(api.peak, 1);
});

test('no Date and a local clock lost (before November 2026): nothing counted', async () => {
  const api = createApi((url) => json(real(url), { date: null }));
  const { begin, wait, fake } = await setup({ api, start: Date.UTC(2026, 9, 1) });
  await begin();
  await wait(GAP);
  assert.equal(fake.states.length, 0);
  assert.match(status(fake).message.en, /no believable time/i);
});

test('getConfig() failing for long: the retry is spaced up to 5 min, never more', async () => {
  const { app, gladys, fake, wait } = await setup();
  gladys.getConfig = async () => {
    throw new Error('down');
  };
  app.connected();
  const seen = new Set();
  for (let i = 0; i < 40; i += 1) {
    await wait(MINUTE);
    seen.add(status(fake).message.en.match(/next try in (\d+) s/)[1]);
  }
  assert.ok(seen.has('300'));
  for (const seconds of seen) assert.ok(Number(seconds) <= 300, seconds);
  await app.disconnected();
});

test('timerDelay: finite, 0 to 8 h, the fallback for anything else', async () => {
  const { timerDelay } = await import('../src/app.js');
  assert.equal(timerDelay(-5, 1), 0);
  assert.equal(timerDelay(1000, 1), 1000);
  assert.equal(timerDelay(100 * HOUR, 1), PAUSE_MAX + REFRESH_MAX * MINUTE);
  assert.equal(timerDelay(Infinity, 7), 7);
  assert.equal(timerDelay(NaN, 7), 7);
});

test('another language reads at once, and the texts are asked in it', async () => {
  const { begin, api, wait, app, fake } = await setup();
  await begin();
  await wait(MINUTE);
  await app.start({ ...HOME, language: 'fr' });
  await wait(GAP);
  assert.equal(api.calls.length, 4, 'read at once');
  assert.equal(new URL(api.calls[2].url).searchParams.get('lang'), 'fr');
  assert.match(published(fake, F(1, 'summary')).at(-1), /^4 événements/);
});

test('a 403 of the winter conditions alone never pauses the events', async () => {
  const api = createApi((url, a) =>
    layerOf(url) === 'conditions'
      ? json({ Message: 'Forbidden' }, { status: 403, date: a.clock.wall() })
      : real(url),
  );
  const { begin, wait, fake, store, app } = await setup({ api });
  await begin();
  await wait(GAP);
  assert.equal(app.pausedFor(), 0);
  assert.equal(store.data.pause, undefined);
  await wait(2 * INTERVAL);
  assert.equal(
    api.calls.filter((c) => layerOf(c.url) === 'events').length,
    3,
    'events every round',
  );
  assert.deepEqual(published(fake, F(1, 'events')), [4, 4, 4]);
  assert.match(status(fake).message.en, /winter conditions: /);
});
