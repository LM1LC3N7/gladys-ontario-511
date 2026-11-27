# Third-party notices

## Ontario 511: Ministry of Transportation of Ontario

The integration reads, at run time and with the user's own developer key, the Ontario 511 developer API
(https://511on.ca/api/v2/get/event and https://511on.ca/api/v3/get/roadconditions, documented on
https://511on.ca/developers/doc). The Developer's Access Agreement (https://511on.ca/developers/resources, read on
2026-11-27) states: "Unless otherwise specified, Ontario 511 data made available through the Developer Resource Area
is provided under the Open Government License", that is the Open Government Licence – Ontario
(https://www.ontario.ca/page/open-government-licence-ontario). The agreement encourages acknowledging the source with
a link to https://511on.ca and asks to pass on its disclaimer: the data is provided "as is" and "as available",
without warranty.

Attribution:

> Contains information licensed under the Open Government Licence – Ontario. Source: Ontario 511, Ministry of
> Transportation of Ontario (https://511on.ca).

Changes: the integration keeps the items inside the user's zones, counts them and writes a short summary. The Ontario
511 logo is not used. The integration is not endorsed by Ontario 511, the Ministry of Transportation or the Government
of Ontario.

The test fixtures `test/fixtures/events.json` and `test/fixtures/roadconditions.json` are built from the field names
and samples of the documentation pages (positions and times changed); they are not captures of the API. No code of
the ministry is used: the client is written from the documentation and the observed refusal of a missing key.

## Google encoded polyline

`src/geo.js` decodes the "Encoded Polyline Algorithm Format" as published by Google
(https://developers.google.com/maps/documentation/utilities/polylinealgorithm); the decoder is written from that
description, no library is copied.

## gladys-testkit

`test/kit/clock.mjs` is copied from gladys-testkit (Apache-2.0, same author as this repository).

## npm dependencies

The only runtime dependency is `@gladysassistant/integration-sdk` (Apache-2.0); its license ships in
`node_modules/@gladysassistant/integration-sdk/LICENSE` of the image.
