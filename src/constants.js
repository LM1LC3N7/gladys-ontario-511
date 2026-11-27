// -----------------------------------------------------------------------------
// The fixed values of the integration: the Ontario 511 developer API, its
// pace, the bounds of what is read, and the keys shared with the manifest.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/**
 * The Ontario 511 developer API (Ministry of Transportation of Ontario),
 * https://511on.ca/developers/doc: a free developer key in the `key` query
 * parameter, "Ten calls every 60 seconds".
 */
export const API_BASE = 'https://511on.ca';

/** The two resources read: events (incidents, roadwork, closures) and winter road conditions. */
export const LAYERS = Object.freeze({
  EVENTS: '/api/v2/get/event',
  CONDITIONS: '/api/v3/get/roadconditions',
});

/** An honest User-Agent naming the integration, never a browser's. */
export const USER_AGENT = `gladys-ontario-511/${pkg.version} (+https://github.com/LM1LC3N7/gladys-ontario-511)`;

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

/**
 * "Throttling is enabled. Ten calls every 60 seconds." One request at a time,
 * 7 s at least between the starts of two: never more than 9 in any minute,
 * whatever starts them (rounds, the test button).
 */
export const REQUEST_GAP = 7 * SECOND;
/** The documented quota, checked by the tests against the gap. */
export const QUOTA_CALLS = 10;
export const QUOTA_WINDOW = 60 * SECOND;
/** One request never lasts longer (connection, answer and body). */
export const REQUEST_TIMEOUT = 30 * SECOND;
/** A body larger than this is cut before it is read in full. */
export const MAX_BODY_BYTES = 16 * 1024 * 1024;
/** Items read per resource: past this, the answer is refused (never a partial count). */
export const MAX_ITEMS = 10000;
/** Points read per geometry; the rest of a longer line is ignored. */
export const MAX_POINTS = 5000;
/** Encoded polyline characters read per geometry (bounded decoding). */
export const MAX_POLYLINE_CHARS = 100000;

/** The read interval, in minutes (config `refresh_minutes`). */
export const REFRESH_DEFAULT = 15;
export const REFRESH_MIN = 10;
export const REFRESH_MAX = 120;

/** Pauses after a 429 (rate limit), a 5xx or another status, doubled each time, bounded. */
export const PAUSE_429_FIRST = 2 * MINUTE;
export const PAUSE_5XX_FIRST = 5 * MINUTE;
export const PAUSE_MIN = MINUTE;
export const PAUSE_MAX = 6 * HOUR;
/** The winter conditions refused alone (4xx while events read): spaced, at most 1 h. */
export const SECONDARY_SKIP_MAX = HOUR;

/** `getConfig()` failing on a connection: retried forever, spaced out. */
export const CONFIG_RETRY_FIRST = 5 * SECOND;
export const CONFIG_RETRY_MAX = 5 * MINUTE;

/** An event reported, updated or started longer ago is never announced as new. */
export const FRESH_EVENT = 2 * HOUR;
/** A winter road condition report older than this is not a current one. */
export const CONDITION_FRESH = 24 * HOUR;
/** Zone data older than this is said stale in the status. */
export const STALE_AFTER = 2 * HOUR;
/** Event ids remembered per zone (scene trigger), and for how long. */
export const SEEN_MAX = 2000;
export const SEEN_KEEP = 14 * 24 * HOUR;
/** Scene events fired per zone and per read, at most. */
export const SCENE_EVENTS_PER_READ = 20;

/** Watch zones (one Gladys device each). */
export const ZONE_SLOTS = [1, 2, 3];
export const RADIUS_DEFAULT = 20;
export const RADIUS_MIN = 1;
export const RADIUS_MAX = 200;
export const ROADS_MAX = 10;
export const ROAD_NAME_MAX = 40;
export const ZONE_NAME_MAX = 60;
/**
 * The envelope a zone center must be in: Ontario and its borders (Ontario 511
 * holds nothing elsewhere).
 */
export const ON_ENVELOPE = { minLat: 41.5, maxLat: 57, minLon: -95.5, maxLon: -74 };

/** The developer key: printable ASCII, no space; never shown, logged or kept in /data. */
export const KEY_MIN = 8;
export const KEY_MAX = 128;

/** Counts are bounded: never more than a resource can return. */
export const MAX_COUNT = MAX_ITEMS;
/** The summary text published on the zone device, in characters. */
export const SUMMARY_MAX = 600;
/** The texts handed to a scene (the core accepts 1000 characters). */
export const SCENE_TEXT_MAX = 900;

export const DEVICE_TYPE = 'zone';
export const FEATURES = Object.freeze({
  EVENTS: 'events',
  INCIDENTS: 'incidents',
  ROADWORK: 'roadwork',
  CLOSURES: 'closures',
  WINTER: 'winter_segments',
  SUMMARY: 'summary',
});

export const ACTIONS = Object.freeze({ TEST: 'test' });
export const SCENE_TRIGGER = 'new_event';

/** The documented `EventType` values ("roadwork, closures or accidentsAndIncidents"). */
export const EVENT_TYPES = Object.freeze(['accidentsAndIncidents', 'closures', 'roadwork']);

/** The time zone of the source (Ontario, Eastern time). */
export const TIME_ZONE = 'America/Toronto';

export const STATE_FILE = '/data/ontario-511-state.json';
