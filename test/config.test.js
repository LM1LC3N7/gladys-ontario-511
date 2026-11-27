import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, readKey, readNumber, readRoads, roadKey } from '../src/config.js';
import { configErrors } from '../src/i18n.js';
import { KEY } from './helpers/setup.js';

test('numbers are strict: blank is absent (never 0), only plain decimals', () => {
  assert.equal(readNumber(''), null);
  assert.equal(readNumber('   '), null);
  assert.equal(readNumber(null), null);
  assert.equal(readNumber(undefined), null);
  assert.equal(readNumber(' 43.6532 '), 43.6532);
  assert.equal(readNumber('-79.38'), -79.38);
  assert.equal(readNumber(12), 12);
  for (const bad of ['1e3', '0x10', '12,5', 'abc', '1.2.3', Infinity, NaN, true, {}]) {
    assert.ok(Number.isNaN(readNumber(bad)), String(bad));
  }
});

test('zone 1 is required; an empty zone 2 or 3 is off; a half-filled one is an error', () => {
  const none = normalizeConfig({ api_key: KEY });
  assert.deepEqual(none.zones, []);
  assert.deepEqual(none.errors, [{ slot: 1, field: 'zone1_latitude', code: 'required' }]);

  const config = normalizeConfig({
    api_key: KEY,
    zone1_latitude: '43.65',
    zone1_longitude: '-79.38',
    zone2_latitude: '46.3',
  });
  assert.deepEqual(
    config.zones.map((z) => z.slot),
    [1],
  );
  assert.deepEqual(config.errors, [{ slot: 2, field: 'zone2_longitude', code: 'required' }]);
  assert.equal(config.zones[0].radiusKm, 20, 'default radius');
  assert.equal(config.refreshMinutes, 15);
  assert.equal(config.language, 'en');
  assert.equal(config.key, KEY);
});

test('a zone outside Ontario, a radius out of bounds, a bad interval are refused', () => {
  const config = normalizeConfig({
    api_key: KEY,
    zone1_latitude: 45.5,
    zone1_longitude: -73.56,
    zone2_latitude: 43.65,
    zone2_longitude: -79.38,
    zone2_radius_km: 201,
    zone3_latitude: 43.65,
    zone3_longitude: -79.38,
    zone3_radius_km: '0',
    refresh_minutes: '9',
    language: 'de',
  });
  assert.deepEqual(config.zones, []);
  assert.deepEqual(
    config.errors.map((e) => `${e.field}:${e.code}`),
    [
      'refresh_minutes:refresh',
      'zone1_latitude:outside_on',
      'zone2_radius_km:radius',
      'zone3_radius_km:radius',
    ],
  );
  assert.equal(config.refreshMinutes, 15);
  assert.equal(config.language, 'en');
  assert.equal(normalizeConfig({ refresh_minutes: 10.5 }).errors[0].code, 'refresh');
  assert.equal(normalizeConfig({ refresh_minutes: 121 }).errors[0].code, 'refresh');
  assert.equal(normalizeConfig({ refresh_minutes: '10' }).refreshMinutes, 10);
});

test('the developer key: shape checked only, blank is no key, never echoed in errors', () => {
  assert.deepEqual(readKey(''), { key: null });
  assert.deepEqual(readKey(undefined), { key: null });
  assert.deepEqual(readKey(`  ${KEY}  `), { key: KEY });
  for (const bad of [
    'short',
    'with space inside',
    'clé-accentuée-123',
    'a'.repeat(129),
    12345678,
  ]) {
    assert.deepEqual(readKey(bad), { error: 'key_invalid' }, String(bad));
  }
  assert.deepEqual(readKey('abc\r\ndefghij'), { error: 'key_invalid' });
  const secret = 'bad key with spaces';
  const config = normalizeConfig({ api_key: secret, zone1_latitude: 43.6, zone1_longitude: -79.4 });
  assert.equal(config.key, null);
  const text = JSON.stringify([config.errors, configErrors(config.errors)]);
  assert.ok(text.includes('api_key'));
  assert.ok(!text.includes(secret));
});

test('road names: "401", "Hwy 401", "HWY 401" and "Highway 401" are one road; bounded', () => {
  for (const name of ['401', 'Hwy 401', 'HWY 401', 'Highway 401', ' highway  401 ', 'Hwy. 401']) {
    assert.equal(roadKey(name), '401', name);
  }
  assert.equal(roadKey('QEW'), 'qew');
  assert.equal(roadKey('HWY 11'), '11');
  assert.equal(roadKey('Bay St'), 'bayst');
  assert.equal(roadKey('Autoroute 417'), '417');
  assert.deepEqual(readRoads('401, Hwy 401; QEW'), { roads: ['401', 'QEW'] });
  assert.deepEqual(readRoads(''), { roads: [] });
  assert.deepEqual(readRoads('a\u0007b'), { error: 'roads_invalid' });
  assert.deepEqual(readRoads('x'.repeat(41)), { error: 'roads_invalid' });
  assert.deepEqual(readRoads('1,2,3,4,5,6,7,8,9,10,11'), { error: 'roads_too_many' });
});

test('a name with a control character is refused, by field only', () => {
  const config = normalizeConfig({
    api_key: KEY,
    zone1_latitude: 43.6,
    zone1_longitude: -79.4,
    zone1_name: 'Ho\u0000me',
  });
  assert.deepEqual(config.errors, [{ slot: 1, field: 'zone1_name', code: 'name_invalid' }]);
  const errors = configErrors(config.errors);
  assert.match(errors.en, /^Field zone1_name is invalid/);
  assert.match(errors.fr, /^Le champ zone1_name est invalide/);
  // The coordinates of the home are never echoed.
  assert.ok(!JSON.stringify(errors).includes('43.6'));
});
