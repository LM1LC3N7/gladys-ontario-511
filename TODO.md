# TODO

## Before announcing

- [ ] Get a developer key (511on.ca, Developers) and check the module against the real API: the field names and types
      of both resources, the size of the province-wide answers, what `lang=fr` translates (descriptions, conditions),
      the Unix times in seconds, the encoded polylines of the road conditions (a string or a list).
- [ ] Install it on a real Gladys 5.3+ and create a zone: device creation, the counters and the summary in the
      dashboard, the scene trigger in the scene editor.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store (after the first release: the store
      validator needs the GHCR image).
- [ ] Store keywords kept out of the manifest: Ontario 511, 511on.ca, MTO, road closures, traffic, roadwork, winter
      road conditions, fermetures, travaux, état des routes.

## To confirm over time on the live API

- [ ] The throttling answer of Ontario 511 (undocumented): a 429 is assumed, any other status pauses as unexpected.
- [ ] The winter condition words in French (`lang=fr`): the classifier knows the English vocabulary of 511on.ca and
      the usual French words; an unknown word is never counted.
- [ ] How long road condition reports stay listed out of season (24 h freshness used).
- [ ] Whether the `constructionprojects` resource is worth a third call (long-term projects; roadwork events already
      cover the lane closures).

## Decisions

- **Version 0.1.0** set by hand in package.json, package-lock.json, the manifest and its `docker_image`
  (`ghcr.io/lm1lc3n7/gladys-ontario-511:0.1.0`).
- **SDK `^0.16.1`**, the latest published (2026-11-27, checked on the npm registry): no change needed for a
  read-only device integration.
- **Source**: the Ontario 511 developer API only (https://511on.ca/developers/doc, read on 2026-11-27), with the
  user's developer key; data under the Open Government Licence – Ontario (Developer's Access Agreement). No key was
  available: the fixtures are built from the documented samples, and the refusal (HTTP 400 `{"Message":"Invalid
Key"}`, XML without a JSON Accept) was seen live from the VM without a key.
- **Structure from gladys-quebec-511 and gladys-drivebc** (same author, same shape: zones, pace, pauses, /data,
  status, scene trigger), with two province-wide resources in place of boxes (the API has no area filter).
- **Quota "Ten calls every 60 seconds"**: two calls per round for every zone, 7 s between two starts (at most 9 in
  any minute, test button included); interval 10 to 120 minutes, 15 by default.
- **Pauses**: 429 2 min doubled, 5xx and other statuses 5 min doubled, all bounded to 6 h, kept in /data. The pause
  starts in `request()` with the answer (review r1): a late answer of an older round holds the next request, and a
  429/5xx of the winter conditions keeps its pause and its level after the events were read; the doubling starts over
  only when both resources were read without a pause asked.
- **Key refusal** = HTTP 400 whose message is exactly "Invalid Key" (JSON or XML), on the events only. It stops
  every read; /data keeps 8 bits of a salted fingerprint (never the key; a brute force over 8 bits finds many keys);
  the full fingerprint stays in memory, so a new key typed while running is always tried. The test button tries once
  per press (background, paced, never during a pause). A 401/403/other 400 is never a refusal (paused as
  unexpected). The winter conditions refused alone while the events read: skipped, spaced from the interval up to
  1 h, never a pause.
- **"In effect"**: listed and started (StartDate ≤ server time); an unknown start is in effect; the planned end is
  not used (a listed event is still there). Reference time: the server `Date` within a day of the local clock; no
  `Date`: the local clock after 2026-11-01; otherwise nothing counted.
- **Closures** = `EventType` "closures" or `IsFullClosure` true (only an explicit `true`).
- **Winter**: words of the report (snow, ice, slush, frost, drifting, and their French forms) = winter; only bare /
  dry / wet = bare; else unknown. Only reports updated within 24 h count; no current known report in a zone: the
  count is not published (unknown, never 0).
- **Ids**: `ID`, else `Organization:SourceId`; an event without either, or without a place, is skipped; more than
  half skipped: the resource is refused (format change), nothing published.
- **One device per zone, id = the slot** (`zone:1..3`); no `location: true` (the house location is sensitive).
- **No widget, no scene action** in 0.1.0; scene events fresh within 2 h, at most 20 per zone and per read.
- **Language**: English by default; it also picks `lang` for the Ontario 511 texts (one call per resource, never
  both languages).
- **Lessons of waves 1-2 applied**: no timer armed on an infinite or huge delay (every delay clamped, tested); an
  unknown value never published as 0; tests fail fast (`until` with a limit, `t.after` cleanups); a round that throws
  re-arms the next one at the interval.
- **Review r1 (d16290c)**: a round of a newer configuration never waits for an older one still publishing or
  saving (each request checks its generation, so the old one sends nothing more); an empty list of events for the
  whole province is an outage, not 0; a start present but unreadable makes the event unreadable; another language
  reads at once; the exact OGL-Ontario statement in the docs, the README and the configuration intro; store name
  "Ontario 511 (unofficial)"; the reviewer's 29 mutants added to `scripts/mutants.json`.

## Next patch

- Review minors: see `_lots/lot25/reviews/ontario-511-r2.md` (5 gardes sans test, StartDate 0 ou décimal, 200 illisible sans pause, étranglement non documenté).
