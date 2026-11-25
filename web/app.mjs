import {
  PRECISION,
  validateCatalogue,
  filterRecords,
  groupPlaces,
  liveQuery,
  normalizeLive,
  readSaved,
  safeApiBase,
} from "./model.mjs";
const $ = (s) => document.querySelector(s),
  key = "coolcode:screenplaces:saved";
const state = {
  catalogue: null,
  config: null,
  saved: [],
  custom: [],
  map: null,
  markers: [],
  shown: 40,
  place: "",
  liveRequest: 0,
  detailRequest: 0,
};
try {
  state.saved = readSaved(localStorage.getItem(key));
} catch {}
function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
function link(text, url) {
  const a = el("a", text);
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  return a;
}
function status(text, error = false) {
  $("#status").textContent = text;
  $("#status").classList.toggle("error", error);
}
async function json(url, timeout = 25000) {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    referrerPolicy: "no-referrer",
  });
  if (!r.ok)
    throw new Error(`The source returned HTTP ${r.status}. Try again later.`);
  const d = await r.json();
  if (d.error)
    throw new Error(
      d.error.message ||
        d.error.info ||
        "The source could not complete this request.",
    );
  return d;
}
function rows() {
  return $("#region").value === "custom"
    ? state.custom
    : state.catalogue?.records || [];
}
function active() {
  return filterRecords(rows(), {
    region: $("#region").value,
    query: $("#query").value,
    precision: $("#precision").value,
    type: $("#type").value,
    decade: $("#decade").value,
    place: state.place,
  });
}
function persist() {
  try {
    localStorage.setItem(key, JSON.stringify(state.saved));
  } catch {
    status(
      "Your outing is available in this tab, but browser storage is unavailable. Export it before closing.",
      true,
    );
  }
  renderSaved();
  render();
}
function renderSaved() {
  const list = $("#saved-list");
  list.replaceChildren();
  $("#saved-count").textContent = state.saved.length;
  $("#export").disabled = !state.saved.length;
  $("#clear").disabled = !state.saved.length;
  for (const p of state.saved) {
    const li = el("li");
    li.append(
      el("strong", p.title),
      el(
        "div",
        `${p.place} · ${PRECISION[p.precision] || "Check precision"}`,
        "muted",
      ),
    );
    const actions = el("div", undefined, "saved-actions");
    actions.append(link("Location source", p.source_url));
    const remove = el("button", "Remove", "quiet");
    remove.setAttribute("aria-label", `Remove ${p.title} at ${p.place}`);
    remove.onclick = () => {
      state.saved = state.saved.filter((x) => x.id !== p.id);
      persist();
    };
    actions.append(remove);
    li.append(actions);
    list.append(li);
  }
  if (!state.saved.length)
    list.append(
      el("p", "Save a production and its recorded location to begin.", "muted"),
    );
}
function initMap() {
  if (!globalThis.L) return;
  state.map = L.map("map", { scrollWheelZoom: false }).setView(
    [49.2608, -123.1139],
    10,
  );
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  }).addTo(state.map);
}
function mapPlaces(records) {
  if (!state.map) return;
  state.markers.forEach((m) => m.remove());
  state.markers = [];
  const places = groupPlaces(records);
  for (const p of places) {
    const popup = el("div");
    popup.append(
      el("strong", p.name),
      el(
        "p",
        `${p.records.length} production-location records · ${PRECISION[p.precision]}`,
      ),
    );
    const b = el("button", "Show this place");
    b.onclick = () => {
      state.place = p.id;
      state.shown = 40;
      render();
    };
    popup.append(b);
    const m = L.circleMarker([p.lat, p.lon], {
      radius: p.precision === "venue" ? 8 : 10,
      color: p.precision === "venue" ? "#7351a1" : "#b47b49",
      fillColor: p.precision === "venue" ? "#7351a1" : "#fff8ed",
      fillOpacity: 0.85,
      weight: 2,
      dashArray: p.precision === "venue" ? undefined : "3 3",
    })
      .addTo(state.map)
      .bindPopup(popup);
    state.markers.push(m);
  }
}
function focusMap(record) {
  state.map?.setView(
    [record.lat, record.lon],
    record.precision === "venue" ? 15 : 11,
  );
  const card = document.querySelector(`[data-id="${record.id}"]`);
  card?.classList.add("selected");
}
function render() {
  if (!state.catalogue) return;
  const data = active();
  $("#production-count").textContent = new Set(data.map((r) => r.work_id)).size;
  $("#place-count").textContent = new Set(data.map((r) => r.place_id)).size;
  $("#venue-count").textContent = data.filter(
    (r) => r.precision === "venue",
  ).length;
  $("#count").textContent = `${data.length} records`;
  const target = $("#results");
  target.replaceChildren();
  $("#place-filter").hidden = !state.place;
  if (state.place) {
    const p = data[0];
    $("#place-filter").replaceChildren(
      el("span", `Map filter: ${p?.place || state.place} `),
    );
    const clear = el("button", "Clear map filter", "quiet");
    clear.onclick = () => {
      state.place = "";
      render();
    };
    $("#place-filter").append(clear);
  }
  for (const r of data.slice(0, state.shown)) {
    const card = el(
      "article",
      undefined,
      "card " + (r.precision === "venue" ? "venue" : ""),
    );
    card.dataset.id = r.id;
    card.append(
      el("h3", r.title),
      el(
        "p",
        `${r.type === "tv" ? "Television" : r.type === "movie" ? "Film" : "Type not identified"}${r.year ? " · " + r.year : " · Release year unavailable"}`,
        "meta",
      ),
      el("div", PRECISION[r.precision], "precision"),
    );
    const place = el("p");
    place.append(link(r.place, r.location_url));
    place.className = "place-link";
    card.append(place);
    if (r.precision === "city" || r.precision === "area")
      card.append(
        el(
          "p",
          "This statement identifies the city or area, not an individual filming site.",
          "muted",
        ),
      );
    const actions = el("div", undefined, "actions"),
      map = el("button", "Map", "secondary"),
      details = el("button", "Film details", "secondary"),
      saved = state.saved.some((p) => p.id === r.id),
      save = el("button", saved ? "Saved" : "Save location");
    map.onclick = () => focusMap(r);
    details.onclick = () => showDetails(r);
    save.disabled = saved;
    save.onclick = () => {
      if (state.saved.length >= 200) {
        status(
          "Your outing has 200 records. Export or remove some before adding more.",
          true,
        );
        return;
      }
      state.saved.push(r);
      persist();
    };
    actions.append(map, details, save, link("Filming statement", r.source_url));
    card.append(actions);
    target.append(card);
  }
  if (!data.length)
    target.append(
      el(
        "p",
        "No records match these filters. Try another collection, remove a filter or search another Wikidata place.",
        "empty",
      ),
    );
  $("#more").hidden = data.length <= state.shown;
  mapPlaces(data);
}
function resetFilters() {
  for (const id of ["query", "precision", "type", "decade"])
    $("#" + id).value = "";
  state.place = "";
  state.shown = 40;
  render();
}
async function showDetails(record) {
  const request = ++state.detailRequest,
    dialog = $("#details"),
    body = $("#details-content");
  body.replaceChildren(
    el("h2", record.title),
    el("p", "Loading optional TMDb details…"),
  );
  dialog.showModal();
  try {
    const result = await json(
      safeApiBase(state.config.api_base) +
        `/api/screenplaces/title?wikidata=${record.work_id}`,
    );
    if (request !== state.detailRequest) return;
    body.replaceChildren(el("h2", record.title));
    if (!result.data) {
      body.append(
        el(
          "p",
          "No linked film or television entry was found in TMDb. The Wikidata filming statement is still available.",
        ),
        link("Open filming statement", record.source_url),
      );
      return;
    }
    const d = result.data;
    if (
      typeof d.poster_url === "string" &&
      /^https:\/\/image\.tmdb\.org\/t\/p\/w342\/[\w-]+\.(jpg|png|webp)$/.test(
        d.poster_url,
      )
    ) {
      const img = el("img");
      img.src = d.poster_url;
      img.alt = `Poster for ${d.title}`;
      img.className = "poster";
      img.referrerPolicy = "no-referrer";
      body.append(img);
    }
    body.append(el("p", d.overview || "No overview is available."));
    if (d.rating_count > 0 && Number.isFinite(d.rating))
      body.append(
        el(
          "p",
          `${d.rating.toFixed(1)} / 10 · ${Number(d.rating_count).toLocaleString()} TMDb user ratings`,
          "rating",
        ),
      );
    if (d.release_date)
      body.append(el("p", `TMDb release date: ${d.release_date}`));
    if (/^https:\/\/www\.themoviedb\.org\/(movie|tv)\/\d+$/.test(d.tmdb_url))
      body.append(link("View this title on TMDb", d.tmdb_url));
    body.append(
      el(
        "p",
        "Posters and ratings describe the production. Filming locations come from the linked Wikidata statement.",
        "muted",
      ),
    );
  } catch (e) {
    if (request !== state.detailRequest) return;
    body.replaceChildren(
      el("h2", record.title),
      el("p", `Film details are temporarily unavailable. ${e.message}`),
      link("Open filming statement", record.source_url),
    );
  }
}
$("#close-details").onclick = () => {
  $("#details").close();
  state.detailRequest++;
};
$("#details").addEventListener("cancel", () => state.detailRequest++);
$("#region").onchange = () => {
  resetFilters();
  const region = state.catalogue.regions.find(
    (r) => r.id === $("#region").value,
  );
  if (region)
    state.map?.setView(region.center, region.id === "vancouver" ? 10 : 11);
  updateSource();
};
for (const name of ["query", "precision", "type", "decade"])
  $("#" + name).addEventListener(name === "query" ? "input" : "change", () => {
    state.shown = 40;
    render();
  });
$("#more").onclick = () => {
  state.shown += 40;
  render();
};
$("#reset").onclick = resetFilters;
function updateSource() {
  if ($("#region").value === "custom") {
    status(
      `Live lookup for ${state.customName} · Retrieved ${state.customFetched} · Exact Wikidata place only.`,
    );
    return;
  }
  const r = state.catalogue.regions.find((x) => x.id === $("#region").value);
  status(
    `${r?.name || "All regions"} · Wikidata captured ${new Date(state.catalogue.fetched_at).toLocaleString()} · Incomplete community-contributed coverage.`,
  );
}
$("#place-form").onsubmit = async (e) => {
  e.preventDefault();
  const q = $("#place-query").value.trim();
  if (!q) return;
  const holder = $("#place-options");
  holder.replaceChildren();
  status("Searching Wikidata places…");
  try {
    const data = await json(
      "https://www.wikidata.org/w/api.php?" +
        new URLSearchParams({
          action: "wbsearchentities",
          search: q,
          language: "en",
          format: "json",
          origin: "*",
          type: "item",
          limit: "8",
        }),
    );
    if (!Array.isArray(data.search) || !data.search.length) {
      status("No places found. Try a different name.", true);
      return;
    }
    for (const item of data.search) {
      if (!/^Q\d+$/.test(item.id)) continue;
      const b = el(
        "button",
        `${item.label || item.id}${item.description ? " — " + item.description : ""}`,
      );
      b.onclick = () => explorePlace(item.id, item.label || item.id);
      holder.append(b);
    }
    status(
      "Choose the intended place. Names can refer to several different Wikidata items.",
    );
  } catch (e) {
    status(e.message, true);
  }
};
async function explorePlace(qid, label) {
  const request = ++state.liveRequest;
  status(
    `Looking up filming statements for ${label}. This can take a few moments…`,
  );
  try {
    const payload = await json(
      "https://query.wikidata.org/sparql?" +
        new URLSearchParams({
          query: liveQuery(qid, state.config.result_limit),
          format: "json",
        }),
      75000,
    );
    if (request !== state.liveRequest) return;
    state.custom = normalizeLive(
      payload,
      qid,
      label,
      state.config.result_limit,
    );
    state.customName = label;
    state.customFetched = new Date().toLocaleString();
    let option = $('#region option[value="custom"]');
    if (!option) {
      option = new Option(label, "custom");
      $("#region").add(option);
    }
    option.textContent = label + " (live)";
    $("#region").value = "custom";
    $("#place-options").replaceChildren();
    resetFilters();
    updateSource();
    if (state.custom[0])
      state.map?.setView([state.custom[0].lat, state.custom[0].lon], 11);
  } catch (e) {
    if (request === state.liveRequest)
      status(
        `Could not load ${label}. ${e.message} The saved catalogue is unchanged.`,
        true,
      );
  }
}
$("#clear").onclick = () => {
  if (confirm("Clear the saved outing from this browser?")) {
    state.saved = [];
    persist();
  }
};
$("#export").onclick = () => {
  const blob = new Blob(
      [
        JSON.stringify(
          {
            application: "Screen Places",
            exported_at: new Date().toISOString(),
            source_capture: state.catalogue.fetched_at,
            locations: state.saved,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
    url = URL.createObjectURL(blob),
    a = el("a");
  a.href = url;
  a.download = "screenplaces-outing.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
async function init() {
  renderSaved();
  try {
    const [config, data] = await Promise.all([
      json("./config.json"),
      json("./data/catalogue.json"),
    ]);
    state.config = config;
    state.catalogue = validateCatalogue(data);
    for (const r of data.regions) $("#region").add(new Option(r.name, r.id));
    const decades = [
      ...new Set(
        data.records
          .filter((r) => r.year)
          .map((r) => Math.floor(r.year / 10) * 10),
      ),
    ].sort((a, b) => b - a);
    for (const d of decades) $("#decade").add(new Option(d + "s", String(d)));
    $("#coverage").textContent =
      data.regions
        .map(
          (r) =>
            `${r.name}: ${r.productions} productions across ${new Set(data.records.filter((p) => p.region === r.id).map((p) => p.place_id)).size} recorded places`,
        )
        .join(". ") + ". ";
    initMap();
    render();
    updateSource();
  } catch (e) {
    status(`Could not load the catalogue: ${e.message}`, true);
  }
}
init();
