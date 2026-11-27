# Ontario 511 (road events and winter road conditions)

Unofficial integration. It reads the **Ontario 511** developer API of the Ministry of Transportation of Ontario
(MTO): **events** (incidents, roadwork, closures) and **winter road conditions** of the provincial network. It needs
a free **developer key** of Ontario 511.

> This integration is not an official source. Before you drive, check [Ontario 511](https://511on.ca/) itself. The
> data may lag behind the road, and the integration may miss an event or a change of conditions.

Source: Ontario 511, Ministry of Transportation of Ontario, data provided under the Open Government Licence – Ontario
(https://www.ontario.ca/page/open-government-licence-ontario), as stated by the Ontario 511 Developer's Access
Agreement. The data is provided "as is" and "as available", without warranty. The integration does not change the
data; it filters it by zone and sums it up. It is not endorsed by Ontario 511, the Ministry of Transportation or the
Government of Ontario.

**Never tested with a real key**: no key was available while writing it. Every request and every answer follows the
official documentation (https://511on.ca/developers/doc and the pages of each endpoint, read on 2026-11-27) and the
refusal 511on.ca gives to a missing or wrong key (seen live: HTTP 400 `{"Message":"Invalid Key"}`). The tests run
against a fake server built from the documented samples. Please report any surprise on the forum.

## Getting a developer key

1. Create an account on [511on.ca](https://511on.ca/) and open the developer area
   ([511on.ca/developers/doc](https://511on.ca/developers/doc)).
2. Ask for a key. The ministry asks for an organization name and contact, the intended use (here: "home automation,
   personal use in Gladys Assistant, no redistribution") and the third parties that receive the data (none).
3. Paste the key in the **Developer key** field of the configuration. Gladys keeps it in its database, never shows it
   again, and the integration sends it only to 511on.ca, in the query string as the API asks. It is never written to
   the logs, the status or `/data`.

## What you get

Up to **three watch zones**, each one a Gladys device. A zone is a circle around a point (1 to 200 km), optionally
limited to some roads ("401, QEW, 400").

Each zone device has:

| Feature                       | Type    | Meaning                                                                                 |
| ----------------------------- | ------- | --------------------------------------------------------------------------------------- |
| Events in effect              | counter | Every event listed by Ontario 511 and started, inside the zone                          |
| Incidents                     | counter | Those of type "accidents and incidents"                                                 |
| Roadwork                      | counter | Those of type "roadwork"                                                                |
| Closures                      | counter | Those of type "closures", or with every lane blocked (`IsFullClosure`)                  |
| Segments in winter conditions | counter | Road segments inside the zone whose current report says snow, ice or slush              |
| Summary                       | text    | The events (closures first, then incidents, then by distance), then the winter segments |

The summary and the device names are written in the language chosen in the configuration (English by default, or
French); the integration asks Ontario 511 for its texts in that language (`lang=en` or `lang=fr`). Road names stay
as Ontario 511 writes them.

**In effect** means: listed by Ontario 511 and started, compared with the time of the Ontario 511 server (`Date`
header of its answer). An event whose start is in the future (a planned closure) is not counted until it starts. An
event still listed after its planned end is still counted (the end was a plan). Recurring events ("All days:
23:59-05:00") count for as long as Ontario 511 lists them: the schedule is a text, shown in the scene variables. An
event whose start is unknown counts as in effect. Without a `Date` header, the clock of Gladys is used, when it is
plausible. A `Date` more than a day away from the clock of Gladys (one of the two is wrong), or no `Date` with an
implausible clock: nothing is counted, and the status says so.

**Winter conditions**: each road condition report lists its conditions as words ("Bare and dry road", "Partly snow
covered", "Snow packed", "Ice covered"…). A report with snow, ice, slush, frost or drifting snow is a winter one; a
report made only of bare, dry or wet road is bare; any other word ("No Report", "Closed"…) is unknown and counted
neither way. Only **current** reports count: updated within 24 hours of the server time. When no segment of the zone
has a current, known report (out of season, every report old), the count is **not published** (it stays unknown,
never 0) and the summary says "No current winter road report in the zone".

**Nothing rather than 0**: an answer that is not a list (an error page), a list where more than half of the entries
cannot be read, or a list over 10,000 entries, is never published as 0. Each of the two resources stands alone: when
one fails, its own features keep their last value, the status says why, and the other one is still published. The
summary says "Events not read" or "Winter road conditions not read" for the one that failed.

## Scene trigger: "New Ontario 511 event in a zone"

Fired when an event in effect appears in a zone for the first time and was reported, updated or started within the
last 2 hours (server time). Filters: zone, event type (incident, closure, roadwork, other). Variables: road,
direction, description, comment, impact on traffic, lanes affected, severity, all lanes closed (yes/no), closure
(yes/no), start and planned end (UTC, ISO 8601), distance from the zone center (km), Ontario 511 event id.

It is not fired by the first read of a zone, nor after you move a zone (new center, radius or roads): that read only
learns what is already there. It is not fired when no time can be believed (see above). At most 20 events per zone
and per read: the others come with the next read (when still within 2 hours).

## Configuration

1. **Developer key** (required).
2. **Language**: English or French.
3. **Read interval**: 10 to 120 minutes (15 by default).
4. **Zone 1** (required), zones 2 and 3 (optional, left empty to turn them off): a name, the latitude and longitude of
   the center (decimal degrees, inside Ontario), the radius in km (20 by default), and optionally the roads to keep,
   separated by commas ("401, QEW, 400"; "Hwy 401" or "Highway 401" work too).

A refused field is named in the status (the value you typed is not repeated there).

The button **Show the last read / try the key again** tells what the last read of each zone gave and when the next
comes; it does not read Ontario 511. Only while Ontario 511 refuses the key does it read: one try per press (see
below).

## The developer key refused

When Ontario 511 answers "Invalid Key" to the events, the integration stops every read at once: no automatic try,
not at the next interval, not after a restart. The status says so. A short fingerprint of the refused key (8 bits of
a salted hash, never the key) is kept in `/data` so that a restart does not send it again. Reads start again when:

- you save another key in the configuration (a new key is tried: at once while Gladys runs, at the interval
  after a restart, see the 1 in 256 case below);
- or you press the test button: one try per press, in the background, paced like any other request (7 seconds after
  the previous one at least), never during a pause; a press while a try runs does nothing. A success lifts the
  refusal and the reads go on at the interval.

Because the fingerprint is that short, a new key typed while Gladys was stopped has a 1 in 256 chance to look like
the refused one: then the status says the key is refused, and one press of the button tries it.

Only the documented refusal counts: HTTP 400 with the message "Invalid Key". A 401, a 403, another 400, a page that
cannot be read are never a refusal of the key: they pause the reads like a server error (below). When only the winter
conditions are refused while the events are read with the same key, the events go on and the conditions are asked
again later: at the next read, then every 30 minutes, then every hour at most; the reads are never paused for that.

## Pace and courtesy toward Ontario 511

Ontario 511 publishes its limit: "Throttling is enabled. Ten calls every 60 seconds." The integration stays below:

- Two calls per round (events, then winter road conditions), whatever the number of zones: Ontario 511 has no filter
  by area, so each resource is read once for the whole province and shared by the zones. One call at a time, 7
  seconds at least between the starts of two: at most 9 calls in any minute, test button included.
- A round every interval, 10 minutes at least, measured from the start of the previous round.
- No read sooner after a restart, a reconnection to Gladys, a configuration saved unchanged, or a Discovery (the
  time of the last attempt is kept in `/data`, and in memory); moving a zone or saving another key reads at once, 7
  seconds after the last call.
- When `/data` cannot tell the last attempt (unreadable file, a date in the future, a `/data` that cannot be written
  or does not answer within 2 seconds), the first read waits 10 minutes after the start, and the status says so; an
  unreadable `/data` is read again every 10 seconds, and what it holds (pause, refused key, events already seen)
  comes back once it reads.
- After a **429** ("too many requests", for instance when the same key is used elsewhere), every read pauses for 2
  minutes, then 4, 8… up to 6 hours; after a server error (**5xx**) or another unexpected status (401, 403, 404, a
  400 other than "Invalid Key"), for 5 minutes, then 10, 20… up to 6 hours; a `Retry-After` longer than that is
  honored, up to 6 hours. The pause is kept in `/data` across restarts; the doubling starts over after a successful
  read.
- User-Agent `gladys-ontario-511/<version> (+https://github.com/LM1LC3N7/gladys-ontario-511)`.
- An answer is cut after 30 seconds or 16 MB.

Ontario 511 does not say how often it updates its data ("real-time"); the integration does not read more often than
every 10 minutes.

## Status

The Configuration screen shows, for each zone, the counts of the last read and its time (Eastern time), or, for each
resource that failed, why and the time of its last data. Data older than 2 hours is said stale. The integration is
shown connected when the last read of at least one resource succeeded less than 2 hours ago, and the key is not
refused.

## Privacy

The coordinates of your zones stay in the Gladys configuration: Ontario 511 receives no position (the whole province
is read). The `/data` file holds the time of the last attempt, the pause, the 8-bit fingerprint of a refused key, and
per zone the ids of the events already seen with a salted fingerprint of the zone, not its coordinates.

## Limits

- Ontario only (the zone center must be in Ontario; data near the borders is included).
- Never tested with a real key, nor by a user in Ontario (see above). The throttling answer of Ontario 511 is not
  documented: a 429 is assumed.
- The construction projects resource (long-term projects) and the cameras are not read in this version.
