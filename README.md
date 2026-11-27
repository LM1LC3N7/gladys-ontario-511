# gladys-ontario-511

Unofficial [Gladys Assistant](https://gladysassistant.com) integration for **Ontario 511**: incidents, roadwork,
closures and winter road conditions on the Ontario road network, read from the Ontario 511 developer API of the
Ministry of Transportation of Ontario with a free developer key.

> This integration is not an official source. Before you drive, check [Ontario 511](https://511on.ca/) itself.

Source: Ontario 511, Ministry of Transportation of Ontario, data under the Open Government Licence – Ontario. Not
endorsed by Ontario 511, the ministry or the Government of Ontario.

- Up to three watch zones (a circle of 1 to 200 km, optionally limited to some roads), one Gladys device each:
  events in effect, incidents, roadwork, closures, segments in winter conditions (counters) and a summary (text,
  English or French; the Ontario 511 texts are asked in the same language).
- A scene trigger "New Ontario 511 event in a zone" (filters: zone, event type).
- Ontario 511 allows "Ten calls every 60 seconds": two calls per round for all zones (events, road conditions), 7 s
  apart, every 10 to 120 minutes (15 by default); pauses after a 429, a 5xx or another unexpected status, kept across
  restarts.
- A key refused ("Invalid Key") stops every read, across restarts, until the key is changed or the test button is
  pressed (one try per press); the key never reaches the logs, the status nor `/data`.
- **Never tested with a real key**: written from the official documentation (https://511on.ca/developers/doc) and the
  refusal 511on.ca gives without a key; the tests use a fake server built from the documented samples.
- Ontario only: the manifest declares `countries: ["CA"]` (Gladys 5.3.0 or later).

User documentation: [English](docs/en.md), [français](docs/fr.md).

## Development

```bash
npm install
npm test               # node --test (virtual clock, scripted API; two tests on a sped-up real clock)
npm run lint
npm run format:check
node scripts/cover.mjs cover.png
node scripts/mutants.mjs   # every mutant of scripts/mutants.json must be killed
```

Tests never reach the Internet: answers built from the documented samples are in `test/fixtures/`, and the real-clock
tests serve them from a local HTTP server.

## License

Apache-2.0, see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
