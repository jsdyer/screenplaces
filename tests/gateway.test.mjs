import test from "node:test";
import assert from "node:assert/strict";
import {
  screenplacesRoute,
  screenplacesNormalize,
  screenplacesApiHandle,
} from "../services/gateway.mjs";
class DB {
  constructor() {
    this.cache = new Map();
    this.budget = new Map();
    this.salts = new Map();
    this.statements = [];
  }
  prepare(sql) {
    const db = this;
    db.statements.push(sql);
    return {
      values: [],
      bind(...v) {
        this.values = v;
        return this;
      },
      async first(field) {
        const v = this.values;
        if (sql.startsWith("SELECT payload")) {
          const p = db.cache.get(v[0]);
          return p && p.expiry > v[1] ? p.payload : null;
        }
        if (sql.startsWith("SELECT expiry")) {
          const x = db.budget.get(v[0]);
          return x && x.expiry > v[1] ? x.expiry : null;
        }
        if (sql.startsWith("SELECT hits")) {
          const x = db.budget.get(v[0]);
          return x && x.expiry > v[1] ? x.hits : null;
        }
        if (sql.startsWith("SELECT secret")) return db.salts.get(v[0]);
        if (sql.startsWith("INSERT INTO screenplaces_budget")) {
          let row = db.budget.get(v[0]);
          row = {
            hits: row && row.expiry > v[2] ? row.hits + 1 : 1,
            expiry: v[1],
          };
          db.budget.set(v[0], row);
          return row;
        }
        return null;
      },
      async run() {
        const v = this.values;
        if (sql.startsWith("INSERT OR IGNORE INTO screenplaces_salts")) {
          if (!db.salts.has(v[0])) db.salts.set(v[0], v[1]);
        }
        if (sql.startsWith("INSERT INTO screenplaces_cache"))
          db.cache.set(v[0], { payload: v[1], expiry: v[2] });
        if (sql.startsWith("INSERT INTO screenplaces_budget"))
          db.budget.set(v[0], { hits: 1, expiry: v[1] });
        if (sql.startsWith("DELETE FROM screenplaces_budget"))
          for (const [k, x] of db.budget)
            if (x.expiry <= v[0]) db.budget.delete(k);
        if (sql.startsWith("DELETE FROM screenplaces_salts"))
          for (const k of db.salts.keys()) if (k < v[0]) db.salts.delete(k);
        return {};
      },
    };
  }
  async batch(stmts) {
    return Promise.all(stmts.map((s) => s.run()));
  }
}
const req = (id = "Q2744", extra = {}) =>
  new Request("https://example.test/api/screenplaces/title?wikidata=" + id, {
    headers: {
      Origin: "https://coolcode.ca",
      "CF-Connecting-IP": "192.0.2.5",
      ...extra,
    },
  });
const payload = {
  tv_results: [
    {
      id: 4087,
      name: "The X-Files",
      overview: "An overview",
      poster_path: "/abc.jpg",
      vote_average: 8.4,
      vote_count: 100,
      first_air_date: "1993-09-10",
    },
  ],
};
test("only fixed route, strict QID and single known parameter accepted", () => {
  assert.ok(
    screenplacesRoute(new URL(req().url)).target.startsWith(
      "https://api.themoviedb.org/",
    ),
  );
  for (const url of [
    "?wikidata=Q0",
    "?wikidata=https://evil",
    "?wikidata=Q1&url=x",
    "?wikidata=Q1&wikidata=Q2",
  ])
    assert.throws(() =>
      screenplacesRoute(new URL("https://x/api/screenplaces/title" + url)),
    );
});
test("normalization constrains image host, identity and optional ratings", () => {
  const d = screenplacesNormalize(payload);
  assert.equal(d.type, "tv");
  assert.equal(d.poster_url, "https://image.tmdb.org/t/p/w342/abc.jpg");
  assert.equal(
    screenplacesNormalize({
      movie_results: [
        { id: 2, title: "x", poster_path: "https://evil", vote_average: 99 },
      ],
    }).poster_url,
    null,
  );
  assert.equal(screenplacesNormalize({}), null);
});
test("validates origin and missing configuration without upstream calls", async () => {
  assert.equal(
    (
      await screenplacesApiHandle(
        req("Q1", { Origin: "https://evil.test" }),
        {},
        {},
      )
    ).status,
    403,
  );
  assert.equal((await screenplacesApiHandle(req(), {}, {})).status, 503);
});
test("TMDb lookup is cached, uses manual redirect and does not disclose secret", async () => {
  const db = new DB(),
    old = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, opts) => {
    calls++;
    assert.equal(opts.redirect, "manual");
    assert.equal(opts.headers.Authorization, "Bearer PRIVATE");
    return new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const env = { DB: db, TMDB_READ_ACCESS_TOKEN: "PRIVATE" },
      first = await screenplacesApiHandle(req(), env, {}),
      second = await screenplacesApiHandle(req(), env, {});
    assert.equal(first.body.data.id, 4087);
    assert.equal(second.body.data.id, 4087);
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(first).includes("PRIVATE"));
    assert.ok(![...db.budget.keys()].some((k) => k.includes("192.0.2.5")));
    assert.ok(
      db.statements.includes(
        "DELETE FROM screenplaces_cache WHERE id IN (SELECT id FROM screenplaces_cache ORDER BY expiry DESC LIMIT -1 OFFSET 5000)",
      ),
    );
  } finally {
    globalThis.fetch = old;
  }
});
test("redirect and HTML provider responses are rejected", async () => {
  const old = globalThis.fetch;
  try {
    for (const response of [
      () =>
        new Response("", {
          status: 302,
          headers: { Location: "https://evil.test/" },
        }),
      () =>
        new Response("<html>", { headers: { "Content-Type": "text/html" } }),
    ]) {
      globalThis.fetch = async () => response();
      assert.equal(
        (
          await screenplacesApiHandle(
            req(),
            { DB: new DB(), TMDB_READ_ACCESS_TOKEN: "x" },
            {},
          )
        ).status,
        502,
      );
    }
  } finally {
    globalThis.fetch = old;
  }
});
test("429 sets shared cooldown, preventing second fetch and cleans expired budgets first", async () => {
  const db = new DB(),
    old = globalThis.fetch;
  let calls = 0;
  db.budget.set("old", { expiry: 1, hits: 10 });
  globalThis.fetch = async () => {
    calls++;
    return new Response("", { status: 429, headers: { "Retry-After": "120" } });
  };
  try {
    const env = { DB: db, TMDB_READ_ACCESS_TOKEN: "x" };
    assert.equal((await screenplacesApiHandle(req(), env, {})).status, 429);
    assert.equal((await screenplacesApiHandle(req("Q2"), env, {})).status, 429);
    assert.equal(calls, 1);
    assert.ok(!db.budget.has("old"));
  } finally {
    globalThis.fetch = old;
  }
});
