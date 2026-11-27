// -----------------------------------------------------------------------------
// The app on the REAL moving clock (performance.now, Date.now, setTimeout)
// sped up 60 times, against a real local HTTP server playing Ontario 511 with
// the documented answers: the rounds really start at the interval (measured
// on the method that decides), the two requests are 7 s apart, never more
// than 10 calls in a minute, the timers stay bounded. A second server answers
// "Invalid Key": one call, then none.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { Ontario511App } from '../src/app.js';
import { QUOTA_CALLS, QUOTA_WINDOW, REQUEST_GAP } from '../src/constants.js';
import { createMemoryStore } from '../src/store.js';
import { measurePeriod, realClock, spyOn } from './kit/clock.mjs';
import { HOME, KEY, MINUTE, list } from './helpers/setup.js';

const SPEED = 60;
const REFRESH = 10;

async function serve(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

function start(t, { base, clock, config }) {
  const gladys = createFakeGladys({ selector: 'ontario-511', config });
  const quiet = () => {};
  const sent = [];
  const app = new Ontario511App({
    gladys,
    logger: { info: quiet, warn: quiet, error: quiet, debug: quiet },
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    store: createMemoryStore(),
    fetchImpl: (url, init) => {
      sent.push(clock.monotonic());
      return fetch(url, {
        ...init,
        signal: AbortSignal.any([init.signal, AbortSignal.timeout(5000)]),
      });
    },
    apiBase: base,
  });
  // Cleanup in t.after: a failing or hanging assertion never leaves the app alive.
  t.after(async () => {
    await app.stop();
    clock.close();
  });
  return { gladys, app, sent };
}

test('real clock x60: one round per interval, requests 7 s apart, the quota kept', async (t) => {
  const clock = realClock({ speed: SPEED });
  const requests = [];
  const base = await serve(t, (req, res) => {
    requests.push({ at: clock.monotonic(), url: req.url, ua: req.headers['user-agent'] });
    const events = req.url.startsWith('/api/v2/get/event?');
    res.writeHead(200, { 'content-type': 'application/json', date: new Date().toUTCString() });
    res.end(JSON.stringify(list(events ? 'events' : 'conditions')));
  });
  const config = {
    ...HOME,
    zone2_latitude: 46.31,
    zone2_longitude: -79.46,
    refresh_minutes: REFRESH,
  };
  const { gladys, app, sent } = start(t, { base, clock, config });
  await gladys.connect();
  const spy = spyOn(app, 'round', clock);
  t.after(() => spy.restore());
  await app.start(config);
  const gaps = await measurePeriod(spy, { count: 3, period: REFRESH * MINUTE });
  assert.equal(gaps.length, 2);
  await app.stop();
  assert.ok(requests.length >= 4, `${requests.length} requests`);
  for (let i = 1; i < sent.length; i += 1) {
    assert.ok(
      sent[i] - sent[i - 1] >= 0.9 * REQUEST_GAP,
      `gap ${Math.round(sent[i] - sent[i - 1])} ms`,
    );
  }
  for (const [i, at] of sent.entries()) {
    const inMinute = sent.slice(i).filter((s) => s - at < QUOTA_WINDOW).length;
    assert.ok(inMinute < QUOTA_CALLS, `${inMinute} calls in a minute`);
  }
  assert.match(requests[0].ua, /^gladys-ontario-511\//);
  assert.match(
    requests[0].url,
    /^\/api\/v2\/get\/event\?key=TESTKEY-0123456789abcdef&format=json&lang=en$/,
  );
  assert.match(requests[1].url, /^\/api\/v3\/get\/roadconditions\?/);
  assert.ok(clock.timersSet < 40, `${clock.timersSet} timers`);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('real clock x60: "Invalid Key" is one call, then nothing for hours', async (t) => {
  // Faster still: two simulated hours in 6 real seconds.
  const clock = realClock({ speed: 1200 });
  let calls = 0;
  const base = await serve(t, (req, res) => {
    calls += 1;
    res.writeHead(400, {
      'content-type': 'application/json; charset=utf-8',
      date: new Date().toUTCString(),
    });
    res.end('{"Message":"Invalid Key"}');
  });
  const config = { ...HOME, refresh_minutes: REFRESH };
  const { gladys, app } = start(t, { base, clock, config });
  await gladys.connect();
  await app.start(config);
  // Two hours simulated (6 real seconds).
  await clock.sleep(120 * MINUTE);
  assert.equal(calls, 1);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /refused the developer key/);
  assert.ok(!JSON.stringify(gladys.fake.connectionStatuses).includes(KEY));
});
