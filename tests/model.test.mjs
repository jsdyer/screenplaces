import test from "node:test";
import assert from "node:assert/strict";
import {
  filterRecords,
  groupPlaces,
  liveQuery,
  normalizeLive,
  readSaved,
  safeApiBase,
  validateCatalogue,
  validateRegion,
} from "../web/model.mjs";
const rows = [
  {
    id: "Q1@Q2",
    work_id: "Q1",
    title: "Example <script>",
    place_id: "Q2",
    place: "City",
    lat: 49,
    lon: -123,
    year: 1999,
    type: "movie",
    region: "west",
    precision: "city",
  },
  {
    id: "Q3@Q4",
    work_id: "Q3",
    title: "A television show",
    place_id: "Q4",
    place: "Venue",
    lat: 44,
    lon: -63,
    year: 2001,
    type: "tv",
    region: "east",
    precision: "venue",
  },
];
test("composes region, precision, decade and literal search filters", () => {
  assert.equal(filterRecords(rows, { query: "<script>" }).length, 1);
  assert.equal(
    filterRecords(rows, { precision: "venue", type: "tv", decade: "2000" })[0]
      .id,
    "Q3@Q4",
  );
  assert.equal(
    filterRecords(rows, { region: "east", decade: "1990" }).length,
    0,
  );
});
test("groups multiple productions at one place without losing statements", () => {
  const g = groupPlaces([...rows, { ...rows[0], id: "Q5@Q2", work_id: "Q5" }]);
  assert.equal(g.length, 2);
  assert.equal(g[0].records.length, 2);
});
test("query strictly limits arbitrary places and rejects SPARQL injection", () => {
  assert.ok(liveQuery("Q99999").includes("wd:Q99999"));
  assert.throws(() => liveQuery("Q1} UNION {"));
  assert.throws(() => liveQuery("Q1", 10001));
});
test("live results keep unknown precision and distinguish missing from truncated", () => {
  const payload = {
    results: {
      bindings: [
        {
          work: { value: "http://www.wikidata.org/entity/Q1" },
          place: { value: "http://www.wikidata.org/entity/Q2" },
          coord: { value: "Point(-63 44)" },
          workLabel: { value: "A" },
        },
      ],
    },
  };
  assert.equal(
    normalizeLive(payload, "Q2", "Place")[0].precision,
    "unclassified",
  );
  assert.throws(() => normalizeLive(payload, "Q2", "Place", 1));
  assert.throws(() => normalizeLive({}, "Q2", "Place"));
});
test("saved entries reconstruct fixed source URLs, reject invalid coordinates and handle corruption", () => {
  const a = readSaved(
    JSON.stringify([{ ...rows[0], source_url: "javascript:bad" }]),
  );
  assert.equal(a[0].source_url, "https://www.wikidata.org/wiki/Q1#P915");
  assert.deepEqual(readSaved("bad"), []);
  assert.equal(readSaved(JSON.stringify([{ ...rows[0], lat: 100 }])).length, 0);
});
test("snapshot validation accepts new region, preserves source date and rejects invalid coordinates", () => {
  const d = {
    schema: "screenplaces.v1",
    fetched_at: "2026-11-20T00:00:00Z",
    regions: [{ id: "new" }],
    records: [{ ...rows[0], region: "new" }],
  };
  assert.equal(validateCatalogue(d).records.length, 1);
  assert.throws(() =>
    validateCatalogue({ ...d, records: [{ ...rows[0], lat: 99 }] }),
  );
  assert.throws(() => safeApiBase("http://example.test"));
});

test("partitioned manifests allow honest empty regions and require consistent file counts", () => {
  const region = {
    id: "truro",
    records: 0,
    productions: 0,
    places: 0,
    records_url: "./data/regions/truro-aabbcc.json",
  };
  const m = {
    schema: "screenplaces.v2",
    fetched_at: "2026-11-25T00:00:00Z",
    total_records: 0,
    regions: [region],
  };
  assert.equal(validateCatalogue(m).regions.length, 1);
  assert.deepEqual(
    validateRegion(
      {
        schema: "screenplaces.region.v1",
        fetched_at: m.fetched_at,
        region: "truro",
        records: [],
      },
      region,
      m,
    ),
    [],
  );
  assert.throws(() => validateCatalogue({ ...m, total_records: 1 }));
  assert.throws(() =>
    validateCatalogue({
      ...m,
      regions: [{ ...region, records_url: "https://other.test/data.json" }],
    }),
  );
  assert.throws(() =>
    validateRegion(
      {
        schema: "screenplaces.region.v1",
        fetched_at: "2020-01-01T00:00:00Z",
        region: "truro",
        records: [],
      },
      region,
      m,
    ),
  );
});
