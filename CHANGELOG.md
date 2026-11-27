# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Up to three watch zones in Ontario, each one a Gladys device: events in effect, incidents, roadwork, closures,
  road segments in winter conditions and a summary, from the Ontario 511 developer API (free developer key, Open
  Government Licence – Ontario).
- Scene trigger "New Ontario 511 event in a zone", filtered by zone and event type.
- A button that shows the last read of each zone and the next one, and tries a refused key again (one try per press).
- Courtesy toward Ontario 511 ("Ten calls every 60 seconds"): two calls per round for all zones, one at a time, 7 s
  apart, every 10 minutes at least; pauses after a 429, a 5xx or another unexpected status, kept across restarts; no
  read sooner than the interval after a restart.
- A refused key ("Invalid Key") stops every read until the key changes, kept in `/data` as an 8-bit salted
  fingerprint; the key itself never reaches the logs, the status or `/data`.
- Each resource published on its own: a failed one keeps its last values (never 0) and the status says why; an
  unknown winter count (no current report) is not published.
- The statement of the Open Government Licence – Ontario in the documentation and the configuration screen.
- Store: `countries: ["CA"]` (the integration serves Ontario only), so `gladys_version` is `>=5.3.0`.
