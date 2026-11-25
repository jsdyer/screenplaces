# Screen Places

Explore documented filming locations across Canadian regions, starting with Vancouver and Halifax, distinguish city-level statements from recorded venues, and save a personal location outing. Live application: https://coolcode.ca/screenplaces/.

<!-- coolcode:guide -->
Search for a production such as The X-Files, then inspect the precision label before planning a visit. A city-level record only establishes that Wikidata associates the production with that city; choose recorded venues/sites for more specific leads and inspect each filming statement's references.
Use **Pictures of this place** on a result to open Commons Lens with that record’s coordinates prefilled. Commons Lens waits for you to submit before requesting media.
<!-- /coolcode:guide -->

## What works

- Search the downloaded catalogue by production or location, filter by region, film/TV, release decade and precision.
- Interactive map groups productions at each recorded place; select a marker to filter the list.
- Venue/site records are distinguished from city/area reference points. Campuses, parks and studios can still cover large areas.
- Save up to 200 production-location records locally and export a JSON outing.
- Optional TMDb posters, overview and user rating are requested only when opening film details.
- Explore another arbitrary Wikidata place using text search and a bounded live query. This finds statements against that exact place; it does not automatically search all its suburbs.

## Source and coverage

The checked-in `web/data/catalogue.json` is a small manifest of real Wikidata P915 filming-location captures for the configured geographic boxes. Its versioned regional files in `web/data/regions/` load only when selected. The build verifies their counts and capture timestamps. It is not a complete database of all films or TV productions. Collections cover British Columbia, Nova Scotia, other Atlantic provinces, Ontario/Quebec and Prairie cities. Coverage varies substantially; the interface derives every count from the source capture. Some checked regions have zero records, which is shown as a coverage gap rather than evidence that nothing was filmed there.

Wikidata P625 provides reference coordinates. P577 provides the earliest listed release date when available. Available P4947/P4983 identifiers distinguish movies from television; unknown types remain labelled unknown. A filming location is not the same as the fictional story setting. Some Wikidata statements have no attached references; the linked source lets readers inspect them. The snapshot time is the actual collection time, not a film release date. Titles prefer English, then available multilingual/French labels. Saved records retain their own capture date when known; older saved records without a date remain undated.

Data: Wikidata structured data under CC0. Map: OpenStreetMap contributors. Leaflet 1.9.4 is vendored with BSD-2-Clause licence. Optional TMDb metadata/images are attributed with its approved logo and required notice; its developer API terms apply. TMDb ratings describe the production, not the reliability of the filming-location claim.

## Privacy and credentials

Catalogue filtering happens locally. Place search goes directly to Wikidata and selecting a result queries WDQS. Map tiles go to OpenStreetMap. Film-detail requests send a production's Wikidata ID to the CoolCode Worker and TMDb; poster images load from TMDb. API credentials never enter the browser.

Saved outings use `coolcode:screenplaces:saved`. Clear them in the interface to remove them. There are no user accounts or server-side saved lists. The optional gateway rate limiter uses daily salted client identifiers and discards expired counters; it does not store raw IP addresses.

The existing CoolCode Worker needs Secret `TMDB_READ_ACCESS_TOKEN` and the existing `DB` binding. `services/gateway.mjs` is the reviewed handler source; integration instructions are in `services/README.md`. The default API URL is configured in `web/config.json`. If this gateway has not been deployed, the catalogue, map, filtering, source links and saved outing still work; only optional film details display an unavailable message.

## Expand or customize

Edit `web/config.json`:

- `regions` contains a unique `id`, display `name`, selector `group`, reference `place_id`, map `center` as `[latitude,longitude]`, and geographic `bounds` as `[west,south,east,north]`.
- To add another region, append a configuration entry (for example Victoria) with verified coordinates, then refresh. No source-code list length needs changing.
- `precision` contains reviewed Wikidata place IDs grouped as `city`, `area` or `venue`. New unreviewed places are labelled `unclassified`; they are never silently called exact sites.
- `allow_empty: true` is only set for explicitly reviewed regions with no current Wikidata coverage. Other regions fail collection on an unexpected empty result, preserving the last good publication.
- `result_limit` defaults to 4000 rows per region. The collector fails rather than silently publish a truncated result; increase this limit or narrow a bounding box after reviewing a failure.
- `api_base` is the HTTPS origin of the Worker that implements the optional film-detail handler.

Changing map defaults or the API URL needs a normal code push. Changing region coverage or precision labels needs a collection run followed by publication:

```sh
python3 scripts/refresh.py
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -v
python3 scripts/build.py
```

Review the snapshot diff and commit the source configuration and snapshot together. `refresh.py` collects all configured regions and release dates into memory, validates the result, then writes versioned regional files and atomically switches the manifest only after they exist. Failed staging preserves the previous manifest and its referenced files. Any failed collection preserves the previous publication. Historical saved outings retain their own labels/coordinates when coverage changes.

## Schedules and publication

GitHub Actions **Browser tool · Check and publish** checks every main push/PR and deploys successful main builds using Pages. Normal builds are offline. The same workflow refreshes source data each Thursday at 09:30 UTC; manually select **Run workflow → refresh: true** to refresh now. A refresh commits only the validated manifest and regional captures, tests the application, then deploys it in the same run because commits made with GITHUB_TOKEN do not start another workflow.

The separate `schedule-guard.yml` allowlists this collector and itself. It is inactivity protection, not proof of source freshness. Watchdog integration should dispatch `pages.yml` with `{"refresh":true}` and probe `/screenplaces/data/catalogue.json` → `fetched_at`; a 10-day tolerance accommodates the weekly schedule. This round's shared inventory changes are coordinated by the parent integration task.

A failing collection does not advance `fetched_at` or deploy a replacement. Pages remains on its previous successful build. Configure Settings → Pages → GitHub Actions. The canonical path is `/screenplaces/`; no CNAME is used.

## Development

Python 3.12+ and Node 24+; no frontend package installation. `dist/` is generated and ignored. The Node tests cover filters, live-query boundaries, persistence and the gateway. Python tests cover the builder, source normalization and scheduled workflow guard. `tests/browser_smoke.py` runs in CI with mocked external requests to exercise filters, map data, film details, persistence and mobile layout.

## Integration scope

This implementation only changes the new Screen Places repository. `tool.json` is ready for catalogue import. The shared Worker module needs the reviewed handler inserted and deployed, while hub/README/sitemap/watchdog registration is tracked by the release owner.
