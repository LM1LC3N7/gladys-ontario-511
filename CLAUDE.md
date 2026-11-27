# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

## Commands

```bash
npm install
npm test                                  # node --test --test-timeout=60000
node --test test/app.test.js              # one file
node --test --test-name-pattern "429"     # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/app.js                        Ontario511App: rounds (2 resources), pace (7 s gap, pauses), key refusal, status, scene trigger
src/ontario511.js                 one bounded GET of the Ontario 511 API, "Invalid Key", strict reading of events and conditions
src/zone.js                       what a zone sees: events in effect, winter segments, in the circle, on the roads; summary
src/geo.js                        points, encoded polylines, distance to a point or a line
src/config.js                     strict reading of the configuration (manifest `config_schema`), key shape
src/devices.js                    one read-only device per zone (id = slot)
src/i18n.js                       every text, English and French
src/store.js                      /data state (last attempt, pause, refused key fingerprint, events seen), never overwritten if unreadable
gladys-assistant-integration.json manifest: name, config_schema, actions, scene trigger, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, fake Gladys of the SDK, virtual clock (test/kit), fixtures from the documented samples
scripts/cover.mjs                 generates cover.png (800x534), plain Node
scripts/mutants.mjs, mutants.json mutation run: the unmutated suite first, then each mutant must fail it
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

Rules kept by the code: Ontario 511 allows ten calls every 60 seconds: one request at a time, 7 s between two starts
(at most 9 a minute), two requests a round (events, road conditions) for the whole province, shared by the zones;
10 min at least between rounds, never sooner (restart, reconnection, unchanged configuration, Discovery); 429/5xx/
other status pause kept in /data; "Invalid Key" on the events stops every read until the key changes (8-bit salted
fingerprint in /data, the test button tries once per press); the key travels only in the query string, never logged;
"in effect" and "current report" judged against the `Date` header; each resource published on its own, nothing for a
failed read, an unknown winter count never published.

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (serial, cloud id, MAC), never a label. Gladys keys
  devices, their history, scenes and dashboards on them: changing one creates a
  new device and orphans the old one. The same goes for every key users store:
  manifest `config_schema`, `actions`, widget and scene keys, feature keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log tokens, passwords or API keys.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand (0.1.0 was set by hand once, see TODO.md). `test/manifest.test.js`
  checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. A field the
  older cores do not know needs a higher `gladys_version` minimum
  (`categories`: 4.86.0; `widgets`, `scene_triggers`, `scene_actions`,
  `type: "provider"`: 5.1.0; `countries`: 5.3.0). `test/manifest.test.js` ties the manifest to the
  code (defaults, action, scene and widget handlers): change both sides
  together.
- **User-facing text** is bilingual (English and French): action messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
