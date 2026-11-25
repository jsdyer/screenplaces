export const PRECISION = {
  venue: "Recorded venue / site",
  city: "City-level record",
  area: "Area-level record",
  unclassified: "Precision unclassified",
};
function validateRecords(records) {
  if (!Array.isArray(records)) throw new Error("Missing location records.");
  for (const r of records) {
    if (
      !/^Q\d+@Q\d+$/.test(r.id) ||
      typeof r.title !== "string" ||
      !Number.isFinite(r.lat) ||
      !Number.isFinite(r.lon) ||
      Math.abs(r.lat) > 90 ||
      Math.abs(r.lon) > 180 ||
      !PRECISION[r.precision]
    )
      throw new Error("A location record is invalid.");
  }
  return records;
}
export function validateCatalogue(data) {
  if (
    !data ||
    !["screenplaces.v1", "screenplaces.v2"].includes(data.schema) ||
    !Array.isArray(data.regions) ||
    !Number.isFinite(Date.parse(data.fetched_at))
  )
    throw new Error("The location catalogue is not valid.");
  if (data.schema === "screenplaces.v1") validateRecords(data.records);
  else {
    const ids = new Set();
    for (const r of data.regions) {
      if (
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(r.id) ||
        ids.has(r.id) ||
        !/^\.\/data\/regions\/[a-z0-9-]+\.json$/.test(r.records_url) ||
        !Number.isInteger(r.records) ||
        r.records < 0 ||
        !Number.isInteger(r.productions) ||
        r.productions < 0 ||
        !Number.isInteger(r.places) ||
        r.places < 0
      )
        throw new Error("A regional capture entry is invalid.");
      ids.add(r.id);
    }
    if (
      !ids.size ||
      data.total_records !== data.regions.reduce((n, r) => n + r.records, 0)
    )
      throw new Error("Regional capture counts do not match.");
  }
  return data;
}
export function validateRegion(data, region, manifest) {
  if (
    !data ||
    data.schema !== "screenplaces.region.v1" ||
    data.region !== region.id ||
    data.fetched_at !== manifest.fetched_at
  )
    throw new Error(
      "The region and catalogue capture dates do not match. Reload this page to get the current capture.",
    );
  const rows = validateRecords(data.records);
  if (
    rows.length !== region.records ||
    rows.some((r) => r.region !== region.id)
  )
    throw new Error("The regional capture is incomplete.");
  return rows;
}
export function filterRecords(
  rows,
  {
    region = "",
    query = "",
    precision = "",
    type = "",
    decade = "",
    place = "",
  } = {},
) {
  const q = query.trim().toLocaleLowerCase();
  return rows.filter(
    (r) =>
      (!region || r.region === region) &&
      (!q || (r.title + " " + r.place).toLocaleLowerCase().includes(q)) &&
      (!precision || r.precision === precision) &&
      (!type || r.type === type) &&
      (!decade ||
        (r.year && Math.floor(r.year / 10) * 10 === Number(decade))) &&
      (!place || r.place_id === place),
  );
}
export function groupPlaces(records) {
  const map = new Map();
  for (const r of records) {
    if (!map.has(r.place_id))
      map.set(r.place_id, {
        id: r.place_id,
        name: r.place,
        lat: r.lat,
        lon: r.lon,
        precision: r.precision,
        records: [],
      });
    map.get(r.place_id).records.push(r);
  }
  return [...map.values()];
}
export function liveQuery(qid, limit = 2000) {
  if (!/^Q[1-9]\d{0,11}$/.test(qid))
    throw new Error("Choose a valid Wikidata place.");
  if (!Number.isInteger(limit) || limit < 10 || limit > 10000)
    throw new Error("Invalid query limit.");
  return `SELECT DISTINCT ?work ?workLabel ?place ?placeLabel ?coord ?tmdbMovie ?tmdbTV WHERE { BIND(wd:${qid} AS ?place) ?work wdt:P915 ?place . ?place wdt:P625 ?coord . OPTIONAL { ?work wdt:P4947 ?tmdbMovie } OPTIONAL { ?work wdt:P4983 ?tmdbTV } SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul,fr" } } LIMIT ${limit}`;
}
export function normalizeLive(payload, qid, label, limit = 2000) {
  const bindings = payload?.results?.bindings;
  if (!Array.isArray(bindings))
    throw new Error("Wikidata returned an unexpected result.");
  if (bindings.length >= limit)
    throw new Error(
      "This place has more records than the query limit. Choose a smaller place.",
    );
  const rows = new Map();
  for (const b of bindings) {
    const work = b.work?.value?.split("/").at(-1),
      place = b.place?.value?.split("/").at(-1),
      match = /^Point\((-?[\d.]+) (-?[\d.]+)\)$/.exec(b.coord?.value || "");
    if (!/^Q\d+$/.test(work) || place !== qid || !match) continue;
    const lon = Number(match[1]),
      lat = Number(match[2]);
    if (Math.abs(lon) > 180 || Math.abs(lat) > 90) continue;
    rows.set(`${work}@${place}`, {
      id: `${work}@${place}`,
      work_id: work,
      title: b.workLabel?.value || work,
      place_id: place,
      place: b.placeLabel?.value || label,
      lat,
      lon,
      year: null,
      type: b.tmdbTV ? "tv" : b.tmdbMovie ? "movie" : "unknown",
      region: "custom",
      precision: "unclassified",
      source_url: `https://www.wikidata.org/wiki/${work}#P915`,
      location_url: `https://www.wikidata.org/wiki/${place}`,
    });
  }
  return [...rows.values()].sort((a, b) => a.title.localeCompare(b.title));
}
export function readSaved(raw) {
  try {
    const rows = JSON.parse(raw || "[]");
    if (!Array.isArray(rows)) return [];
    return rows
      .slice(0, 200)
      .filter(
        (r) =>
          r &&
          /^Q\d+@Q\d+$/.test(r.id) &&
          /^Q\d+$/.test(r.work_id) &&
          /^Q\d+$/.test(r.place_id) &&
          typeof r.title === "string" &&
          Number.isFinite(r.lat) &&
          Number.isFinite(r.lon) &&
          Math.abs(r.lat) <= 90 &&
          Math.abs(r.lon) <= 180,
      )
      .map((r) => ({
        ...r,
        source_url: `https://www.wikidata.org/wiki/${r.work_id}#P915`,
        location_url: `https://www.wikidata.org/wiki/${r.place_id}`,
      }));
  } catch {
    return [];
  }
}
export function safeApiBase(value) {
  const u = new URL(value);
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash)
    throw new Error("Film-details endpoint must use HTTPS.");
  return u.href.replace(/\/$/, "");
}
