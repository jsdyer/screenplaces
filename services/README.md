# Optional film-details gateway

`gateway.mjs` exports `screenplacesApiHandle(request, env, ctx)` returning `{status, body, headers}` for the existing CoolCode Worker. Root can inline its source after removing `export` keywords; all internal helpers have the `spApi` prefix. Dispatch `/api/screenplaces/` to this handler before the shared `apiRoute` planner.

Required bindings: existing `DB` (D1), `TMDB_READ_ACCESS_TOKEN` (Secret).

GET `/api/screenplaces/title?wikidata=Q2744` uses TMDb's documented `/3/find/{external_id}?external_source=wikidata_id` endpoint. Responses contain `{fetched_at,data}`, where data is null if TMDb has no movie/series match. Successful details include title, overview, poster_url, rating, rating_count, release_date, tmdb_url and type. This supplements Wikidata and never establishes a filming location.

The gateway permits only fixed provider URLs and one validated Wikidata ID. It bounds provider response size, request timeout, uncached per-client calls (40/hour), all uncached calls (2000/day) and caches found titles 24 hours. Unmatched IDs are cached one hour. Expired records and prior-day salts are removed before quota checks. The cache is capped at 5,000 entries. Client identifiers use a random rotating daily salt; raw addresses and stable hashes are never stored. A provider 429 establishes a shared bounded cooldown. Redirects are not followed. Browser origin must be `https://coolcode.ca` when present. No provider credential appears in output/logs/browser assets.
