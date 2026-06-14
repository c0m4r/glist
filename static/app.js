/* glist frontend */
"use strict";

const PLATFORMS = [
  { id: "steam",             label: "Steam",        icon: "🟦" },
  { id: "gog",               label: "GOG",          icon: "🟪" },
  { id: "ea",                label: "EA",           icon: "🟥" },
  { id: "ubisoft",           label: "Ubisoft",      icon: "🟦" },
  { id: "epic",              label: "Epic",         icon: "⬛" },
  { id: "physical-original", label: "Physical box", icon: "📦" },
  { id: "physical-cdaction", label: "CD-Action",    icon: "💿" },
];
const PLATFORM_LABEL = Object.fromEntries(PLATFORMS.map(p => [p.id, p.label]));

// brand logos for the YouTube / Google search buttons in the detail view
const ICON_YOUTUBE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#FF0000" d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.38.5A3.02 3.02 0 0 0 .5 6.19C0 8.07 0 12 0 12s0 3.93.5 5.81a3.02 3.02 0 0 0 2.12 2.14c1.88.5 9.38.5 9.38.5s7.5 0 9.38-.5a3.02 3.02 0 0 0 2.12-2.14C24 15.93 24 12 24 12s0-3.93-.5-5.81z"/><path fill="#fff" d="M9.55 15.57V8.43L15.82 12l-6.27 3.57z"/></svg>`;
const ICON_GOOGLE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`;

// store search pages, used for "Find on …" links in the detail view
const STORE_SEARCH = {
  gog:     t => `https://www.gog.com/en/games?query=${encodeURIComponent(t)}`,
  epic:    t => `https://store.epicgames.com/en-US/browse?q=${encodeURIComponent(t)}&sortBy=relevancy&sortDir=DESC`,
  ea:      t => `https://www.ea.com/search?q=${encodeURIComponent(t)}`,
  ubisoft: t => `https://store.ubisoft.com/us/search?q=${encodeURIComponent(t)}`,
};

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

let games = [];
let activeFilter = "all";
let librarySearch = "";
let pickedResult = null;   // search result awaiting platform choice
let pickedPlatform = null;
let currentDetailId = null;   // game shown in the detail modal

/* ---------------- API ---------------- */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function loadGames() {
  games = await api("/api/games");
  render();
}

async function uploadCover(file) {
  const res = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data.url;
}

/* ---------------- rendering ---------------- */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function visibleGames() {
  const q = librarySearch.toLowerCase();
  return games.filter(g =>
    (activeFilter === "all" || g.platform === activeFilter) &&
    (!q || g.title.toLowerCase().includes(q)));
}

function render() {
  const list = visibleGames();
  const grid = $("#grid");
  grid.innerHTML = list.map(g => `
    <article class="card" data-id="${g.id}">
      <span class="card-badge p-${g.platform}">${esc(PLATFORM_LABEL[g.platform] || g.platform)}</span>
      ${g.cover
        ? `<img class="card-cover" loading="lazy" src="${esc(g.cover)}" alt=""
             onerror="this.outerHTML='<div class=\\'card-cover-fallback\\'>${esc(g.title).replace(/'/g, "\\'")}</div>'">`
        : `<div class="card-cover-fallback">${esc(g.title)}</div>`}
      <div class="card-info"><div class="card-title" title="${esc(g.title)}">${esc(g.title)}</div></div>
    </article>`).join("");

  $("#empty").classList.toggle("hidden", games.length > 0);
  $("#count-all").textContent = games.length ? `· ${games.length}` : "";

  // per-platform counts on chips
  $$("#filters .chip").forEach(chip => {
    const p = chip.dataset.platform;
    if (p === "all") return;
    const n = games.filter(g => g.platform === p).length;
    const base = chip.textContent.replace(/\s*·.*$/, "");
    chip.textContent = n ? `${base} · ${n}` : base;
  });
}

/* ---------------- modals ---------------- */
function openModal(id) { $("#" + id).classList.remove("hidden"); }
function closeModal(id) { $("#" + id).classList.add("hidden"); }

document.addEventListener("click", e => {
  const closer = e.target.closest("[data-close]");
  if (closer) closeModal(closer.dataset.close);
  if (e.target.classList.contains("modal-backdrop")) e.target.classList.add("hidden");
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") $$(".modal-backdrop").forEach(m => m.classList.add("hidden"));
  if (!$("#detail-modal").classList.contains("hidden")) {
    if (e.key === "ArrowLeft") navDetail(-1);
    if (e.key === "ArrowRight") navDetail(1);
  }
});

function navDetail(dir) {
  const list = visibleGames();
  const idx = list.findIndex(x => x.id === currentDetailId);
  const target = idx === -1 ? null : list[idx + dir];
  if (target) showDetail(target);
}
$("#nav-prev").addEventListener("click", () => navDetail(-1));
$("#nav-next").addEventListener("click", () => navDetail(1));

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), 2600);
}

/* ---------------- platform pickers ---------------- */
function buildPlatformPickers() {
  $$('[data-role="platform-pick"]').forEach(box => {
    box.innerHTML = PLATFORMS.map(p =>
      `<button type="button" class="pbtn" data-p="${p.id}">${p.icon} ${p.label}</button>`).join("");
    box.addEventListener("click", e => {
      const btn = e.target.closest(".pbtn");
      if (!btn) return;
      box.querySelectorAll(".pbtn").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      box.dataset.selected = btn.dataset.p;
      if (box.closest("#platform-modal")) {
        pickedPlatform = btn.dataset.p;
        $("#confirm-add").disabled = false;
      }
    });
  });
}

function resetPicker(box) {
  box.querySelectorAll(".pbtn").forEach(b => b.classList.remove("selected"));
  delete box.dataset.selected;
}

/* ---------------- add via search ---------------- */
let searchTimer = null;
$("#api-search").addEventListener("input", e => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length < 2) {
    $("#api-results").innerHTML = "";
    $("#api-status").textContent = "Type at least 2 characters to search.";
    return;
  }
  $("#api-status").textContent = "Searching…";
  searchTimer = setTimeout(() => runApiSearch(q), 350);
});

async function runApiSearch(q) {
  try {
    const results = await api("/api/search?q=" + encodeURIComponent(q));
    const owned = new Set(games.filter(g => g.steam_appid).map(g => g.steam_appid));
    $("#api-status").textContent = results.length ? `${results.length} result(s)` : "No results found.";
    $("#api-results").innerHTML = results.map(r => `
      <li data-appid="${r.appid}" data-title="${esc(r.title)}" data-cover="${esc(r.cover)}" data-hero="${esc(r.hero)}">
        <img loading="lazy" src="${esc(r.thumb)}" alt="">
        <span class="r-title">${esc(r.title)}</span>
        ${owned.has(r.appid) ? '<span class="owned-tag">IN LIBRARY</span>' : ""}
      </li>`).join("");
  } catch (err) {
    $("#api-status").textContent = "Search failed: " + err.message;
  }
}

$("#api-results").addEventListener("click", e => {
  const li = e.target.closest("li");
  if (!li) return;
  pickedResult = {
    steam_appid: Number(li.dataset.appid),
    title: li.dataset.title,
    cover: li.dataset.cover,
    hero: li.dataset.hero,
  };
  pickedPlatform = null;
  $("#confirm-add").disabled = true;
  $("#picked-game").innerHTML =
    `<img src="${esc(pickedResult.hero)}" alt=""><span class="r-title">${esc(pickedResult.title)}</span>`;
  resetPicker($("#platform-modal [data-role='platform-pick']"));
  closeModal("add-modal");
  openModal("platform-modal");
});

$("#confirm-add").addEventListener("click", async () => {
  if (!pickedResult || !pickedPlatform) return;
  const btn = $("#confirm-add");
  btn.disabled = true;
  btn.textContent = "Adding…";
  try {
    // enrich with steam details (description, genres, release date…)
    let details = {};
    try { details = await api("/api/details?appid=" + pickedResult.steam_appid); } catch { /* optional */ }
    await api("/api/games", {
      method: "POST",
      body: JSON.stringify({ ...pickedResult, ...details, platform: pickedPlatform }),
    });
    closeModal("platform-modal");
    toast(`Added “${pickedResult.title}” (${PLATFORM_LABEL[pickedPlatform]})`);
    await loadGames();
  } catch (err) {
    toast("Error: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Add to library";
  }
});

/* ---------------- manual add ---------------- */
$("#manual-form").addEventListener("submit", async e => {
  e.preventDefault();
  const form = e.target;
  const picker = form.querySelector("[data-role='platform-pick']");
  const platform = picker.dataset.selected;
  if (!platform) { toast("Pick a platform first"); return; }
  const fd = new FormData(form);
  try {
    let cover = fd.get("cover");
    const file = fd.get("cover_file");
    if (file && file.size > 0) cover = await uploadCover(file);
    await api("/api/games", {
      method: "POST",
      body: JSON.stringify({
        title: fd.get("title"),
        cover,
        release_date: fd.get("release_date"),
        developer: fd.get("developer"),
        description: fd.get("description"),
        platform,
      }),
    });
    toast(`Added “${fd.get("title")}”`);
    form.reset();
    resetPicker(picker);
    closeModal("add-modal");
    await loadGames();
  } catch (err) {
    toast("Error: " + err.message);
  }
});

/* ---------------- detail view ---------------- */
$("#grid").addEventListener("click", e => {
  const card = e.target.closest(".card");
  if (!card) return;
  const g = games.find(x => x.id === Number(card.dataset.id));
  if (g) showDetail(g);
});

function showDetail(g) {
  currentDetailId = g.id;
  const list = visibleGames();
  const idx = list.findIndex(x => x.id === g.id);
  $("#nav-prev").classList.toggle("hidden", idx <= 0);
  $("#nav-next").classList.toggle("hidden", idx === -1 || idx >= list.length - 1);

  const meta = [
    `<span class="tag platform-tag">${esc(PLATFORM_LABEL[g.platform])}</span>`,
    ...(g.genres ? g.genres.split(",").map(x => `<span class="tag">${esc(x.trim())}</span>`) : []),
  ].join("");
  const kv = [
    g.release_date && `<div><span>Released:</span>${esc(g.release_date)}</div>`,
    g.developer && `<div><span>Developer:</span>${esc(g.developer)}</div>`,
    g.publisher && `<div><span>Publisher:</span>${esc(g.publisher)}</div>`,
    g.added_at && `<div><span>Added:</span>${esc(g.added_at.split(" ")[0])}</div>`,
  ].filter(Boolean).join("");

  $("#detail-body").innerHTML = `
    ${g.hero ? `<img class="detail-hero" src="${esc(g.hero)}" alt="" onerror="this.remove()">` : ""}
    <div class="detail-content ${g.hero ? "" : "no-hero"}">
      <h2>${esc(g.title)}</h2>
      <div class="detail-meta">${meta}</div>
      ${g.description ? `<p class="detail-desc">${esc(g.description)}</p>` : ""}
      ${kv ? `<div class="detail-kv">${kv}</div>` : ""}
      <details class="detail-platform-edit">
        <summary>Change platform</summary>
        <div class="platform-pick" id="detail-picker"></div>
      </details>
      <div class="detail-actions">
        ${g.steam_appid ? `<a class="btn" href="https://store.steampowered.com/app/${g.steam_appid}" target="_blank" rel="noopener" style="text-decoration:none">Steam page ↗</a>` : ""}
        ${STORE_SEARCH[g.platform] ? `<a class="btn" href="${esc(STORE_SEARCH[g.platform](g.title))}" target="_blank" rel="noopener" style="text-decoration:none">Find on ${esc(PLATFORM_LABEL[g.platform])} ↗</a>` : ""}
        <a class="icon-link" href="https://www.youtube.com/results?search_query=${encodeURIComponent(g.title + " game")}" target="_blank" rel="noopener" title="Search on YouTube" aria-label="Search on YouTube">${ICON_YOUTUBE}</a>
        <a class="icon-link" href="https://www.google.com/search?q=${encodeURIComponent(g.title + " game")}" target="_blank" rel="noopener" title="Search on Google" aria-label="Search on Google">${ICON_GOOGLE}</a>
        <button class="btn" id="btn-cover">Upload cover</button>
        <input type="file" id="cover-input" accept="image/jpeg,image/png,image/gif,image/webp" hidden>
        <button class="btn btn-danger" id="btn-delete">Remove from library</button>
      </div>
    </div>`;

  const picker = $("#detail-picker");
  picker.innerHTML = PLATFORMS.map(p =>
    `<button type="button" class="pbtn ${p.id === g.platform ? "selected" : ""}" data-p="${p.id}">${p.icon} ${p.label}</button>`).join("");
  picker.addEventListener("click", async e => {
    const btn = e.target.closest(".pbtn");
    if (!btn || btn.dataset.p === g.platform) return;
    try {
      await api(`/api/games/${g.id}`, { method: "PUT", body: JSON.stringify({ platform: btn.dataset.p }) });
      toast(`Moved to ${PLATFORM_LABEL[btn.dataset.p]}`);
      closeModal("detail-modal");
      await loadGames();
    } catch (err) { toast("Error: " + err.message); }
  });

  const coverInput = $("#cover-input");
  $("#btn-cover").addEventListener("click", () => coverInput.click());
  coverInput.addEventListener("change", async () => {
    const file = coverInput.files[0];
    if (!file) return;
    try {
      const url = await uploadCover(file);
      await api(`/api/games/${g.id}`, { method: "PUT", body: JSON.stringify({ cover: url }) });
      toast("Cover updated");
      closeModal("detail-modal");
      await loadGames();
    } catch (err) { toast("Error: " + err.message); }
  });

  $("#btn-delete").addEventListener("click", async () => {
    if (!confirm(`Remove “${g.title}” from your library?`)) return;
    try {
      await api(`/api/games/${g.id}`, { method: "DELETE" });
      toast(`Removed “${g.title}”`);
      closeModal("detail-modal");
      await loadGames();
    } catch (err) { toast("Error: " + err.message); }
  });

  openModal("detail-modal");
}

/* ---------------- filters & library search ---------------- */
$("#filters").addEventListener("click", e => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  $$("#filters .chip").forEach(c => c.classList.remove("active"));
  chip.classList.add("active");
  activeFilter = chip.dataset.platform;
  render();
});

$("#library-search").addEventListener("input", e => {
  librarySearch = e.target.value.trim();
  render();
});

/* ---------------- theme switcher ---------------- */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem("glist-theme", t);
  document.querySelector('meta[name="theme-color"]')
    .setAttribute("content", t === "light" ? "#eef2f9" : "#0b0f1a");
}

$("#btn-theme").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  if (!document.startViewTransition) {
    document.documentElement.classList.add("theme-anim");
    applyTheme(next);
    setTimeout(() => document.documentElement.classList.remove("theme-anim"), 500);
    return;
  }
  // circular reveal sweeping out from the toggle button
  const r = $("#btn-theme").getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const radius = Math.hypot(Math.max(cx, innerWidth - cx), Math.max(cy, innerHeight - cy));
  document.startViewTransition(() => applyTheme(next)).ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${cx}px ${cy}px)`, `circle(${radius}px at ${cx}px ${cy}px)`] },
      { duration: 550, easing: "cubic-bezier(.4,0,.2,1)", pseudoElement: "::view-transition-new(root)" });
  });
});

/* ---------------- add modal & tabs ---------------- */
$("#btn-add").addEventListener("click", () => {
  openModal("add-modal");
  $("#api-search").focus();
});

$$(".tab").forEach(tab => tab.addEventListener("click", () => {
  $$(".tab").forEach(t => t.classList.remove("active"));
  tab.classList.add("active");
  $$(".tab-panel").forEach(p => p.classList.add("hidden"));
  $("#" + tab.dataset.tab).classList.remove("hidden");
}));

/* ---------------- init ---------------- */
buildPlatformPickers();
loadGames().then(() => {
  // deep links: #g<id> opens a game's details, #add opens the add dialog
  const m = location.hash.match(/^#g(\d+)$/);
  if (m) {
    const g = games.find(x => x.id === Number(m[1]));
    if (g) showDetail(g);
  } else if (location.hash === "#add") {
    openModal("add-modal");
  } else if (location.hash === "#manual") {
    openModal("add-modal");
    $('[data-tab="tab-manual"]').click();
  }
}).catch(err => toast("Failed to load library: " + err.message));
