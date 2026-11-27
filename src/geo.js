// -----------------------------------------------------------------------------
// Geometry of a watch zone: the points and lines of an Ontario 511 item (its
// latitude and longitude, a secondary point, an encoded polyline) and the
// exact distance from the zone center to them. Ontario 511 has no filter by
// area: every item of the province travels, and the circle is applied here.
// -----------------------------------------------------------------------------

import { MAX_POINTS, MAX_POLYLINE_CHARS } from './constants.js';

const EARTH_KM = 6371.0088;
const RAD = Math.PI / 180;

/**
 * A point `[lon, lat]` from two numbers, or `null`: not finite, out of range,
 * or exactly 0, 0 (a missing position written as zeros, never a place).
 */
export function readPoint(lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null;
  return [lon, lat];
}

/**
 * A Google encoded polyline (precision 1e5) as `[[lon, lat], ...]`, or `null`
 * when it is not one (a character out of the alphabet, a value cut short, a
 * point out of range). Bounded: past MAX_POINTS points the rest is ignored.
 */
export function decodePolyline(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_POLYLINE_CHARS) {
    return null;
  }
  const points = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (index >= text.length) return null;
      const byte = text.charCodeAt(index) - 63;
      index += 1;
      if (byte < 0 || byte > 63) return null;
      result |= (byte & 0x1f) << shift;
      shift += 5;
      if (byte < 0x20) break;
      // More than 6 chunks cannot be a coordinate of the earth.
      if (shift > 30) return null;
    }
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < text.length && points.length < MAX_POINTS) {
    const dLat = next();
    if (dLat === null) return null;
    const dLon = next();
    if (dLon === null) return null;
    lat += dLat;
    lon += dLon;
    const point = readPoint(lat / 1e5, lon / 1e5);
    if (!point) return null;
    points.push(point);
  }
  return points.length > 0 ? points : null;
}

/**
 * The lines of an item: each readable encoded polyline (a string or a list
 * of them), else the main point joined to the secondary one when there is
 * one. `null` when nothing places the item.
 */
export function readLines({ point, secondary, polylines }) {
  const lines = [];
  let count = 0;
  for (const encoded of polylines) {
    if (count >= MAX_POINTS) break;
    const line = decodePolyline(encoded);
    if (!line) continue;
    const kept = line.slice(0, MAX_POINTS - count);
    count += kept.length;
    lines.push(kept);
  }
  if (point) lines.push(secondary ? [point, secondary] : [point]);
  else if (secondary) lines.push([secondary]);
  return lines.length > 0 ? lines : null;
}

/**
 * The distance in km from the zone center to the nearest point of the
 * geometry (segments included). Each point is placed on an azimuthal
 * equidistant plane centered on the zone (great-circle distance and bearing
 * from the center): exact for the points themselves; between two points of a
 * line, the straight segment of that plane is a close approximation.
 */
export function distanceKm(center, lines) {
  const lat0 = center.latitude * RAD;
  const lon0 = center.longitude * RAD;
  const sin0 = Math.sin(lat0);
  const cos0 = Math.cos(lat0);
  const project = ([lon, lat]) => {
    const phi = lat * RAD;
    const dLon = lon * RAD - lon0;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const h = Math.sin((phi - lat0) / 2) ** 2 + cos0 * cosPhi * Math.sin(dLon / 2) ** 2;
    const d = 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
    const bearing = Math.atan2(
      Math.sin(dLon) * cosPhi,
      cos0 * sinPhi - sin0 * cosPhi * Math.cos(dLon),
    );
    return [d * Math.sin(bearing), d * Math.cos(bearing)];
  };
  let best = Infinity;
  for (const line of lines) {
    let previous = null;
    for (const pair of line) {
      const point = project(pair);
      best = Math.min(best, Math.hypot(point[0], point[1]));
      if (previous) best = Math.min(best, segmentDistance(previous, point));
      previous = point;
    }
  }
  return best;
}

/** Distance from the origin to the segment a-b. */
function segmentDistance(a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  if (length === 0) return Math.hypot(a[0], a[1]);
  const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / length));
  return Math.hypot(a[0] + t * dx, a[1] + t * dy);
}
