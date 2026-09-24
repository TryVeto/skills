import { markdown } from "./markdown.js";
const $ = id => document.getElementById(id);
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
const STORAGE = "skills.launcher.v1";
let preferences;
try { preferences = JSON.parse(localStorage.getItem(STORAGE) || "{}"); } catch { preferences = {}; }
if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) preferences = {};
preferences.shortcuts ||= {};
let skills = [], examples = [], visible = [], selected = null, current = null, request = 0, toastTimer, copying = false;
let keys = new Map();
const metaKey = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
$("focus-search").textContent = metaKey + " K";
function save() {
  try { localStorage.setItem(STORAGE, JSON.stringify(preferences)); }
  catch { toast("Preferences could not be saved in this browser."); }
}
function toast(message) { clearTimeout(toastTimer); $("toast").textContent = message; $("toast").hidden = false; toastTimer = setTimeout(() => $("toast").hidden = true, 2400); }
function assignKeys() {
  keys = new Map();
  const used = new Set();
  // User choices win over supplied defaults, which stay stable across sorting/filtering.
  for (const item of skills.filter(x => Object.hasOwn(preferences.shortcuts, x.id)).concat(skills.filter(x => !Object.hasOwn(preferences.shortcuts, x.id)))) {
    const key = String(preferences.shortcuts[item.id] ?? item.shortcut ?? "").toLowerCase();
    if (/^[a-z0-9]$/.test(key) && !used.has(key)) { keys.set(item.id, key); used.add(key); }
  }
}
const normalize = s => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
function rank(item, query) {
  if (!query) return 1;
  const name = normalize(item.name + " " + (item.label || "") + " " + item.folder), haystack = name + " " + normalize(item.description + " " + item.source + " " + (item.group || ""));
  const words = query.split(/\s+/).filter(Boolean);
  if (!words.every(word => haystack.includes(word))) return 0;
  return name.startsWith(query) ? 100 : name.includes(query) ? 80 : words.every(word => name.includes(word)) ? 60 : 20;
}
function copyIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(svg.namespaceURI, "path"); p.setAttribute("d", "M9 8V4h11v13h-4M4 8h12v13H4z"); svg.append(p); return svg;
}
function render() {
  const query = normalize($("find").value.trim());
  const groups = new Map();
  for (const item of skills) groups.set(item.group || "", Math.min(groups.get(item.group || "") ?? Infinity, item.order ?? 1000000));
  const compare = (a, b) => {
    if (query) return b.rank - a.rank || a.item.name.localeCompare(b.item.name);
    const ga = a.item.group || "", gb = b.item.group || "";
    return (groups.get(ga) - groups.get(gb)) || ga.localeCompare(gb) ||
      Number(keys.has(b.item.id)) - Number(keys.has(a.item.id)) ||
      (a.item.order ?? 1000000) - (b.item.order ?? 1000000) || a.item.name.localeCompare(b.item.name);
  };
  visible = skills.map(item => ({ item, rank: rank(item, query) }))
    .filter(x => x.rank && (!preferences.pinnedOnly || keys.has(x.item.id)))
    .sort(compare)
    .map(x => x.item);
  if (!visible.some(x => x.id === selected)) selected = visible[0]?.id || null;
  $("results").replaceChildren();
  let previousPinned = true, previousGroup = null;
  for (const item of visible) {
    const pinned = keys.has(item.id);
    const group = item.group || "";
    if (!query && group !== previousGroup) {
      if (previousGroup !== null) $("results").append(el("hr", undefined, "group-rule"));
      if (group) $("results").append(el("h2", group, "group-heading"));
    } else if (!query && !group && !pinned && previousPinned && $("results").children.length) {
      $("results").append(el("hr", undefined, "group-rule"));
    }
    previousGroup = group;
    previousPinned = pinned;
    const row = el("div", undefined, "skill-row"); row.dataset.id = item.id;
    const open = el("button", undefined, "open-row"); open.type = "button";
    open.setAttribute("aria-label", "Open " + item.name); open.title = item.description || item.name;
    const key = el("span", keys.get(item.id)?.toUpperCase() || "", "shortcut" + (pinned ? "" : " blank")); key.setAttribute("aria-hidden", "true");
    open.append(key, el("span", item.label || item.name, "label"));
    open.addEventListener("click", () => { selected = item.id; openSkill(item.id); });
    open.addEventListener("focus", () => select(item.id, false));
    const copy = el("button", undefined, "copy-row"); copy.append(copyIcon()); copy.setAttribute("aria-label", "Copy " + item.name); copy.title = "Copy skill" + (pinned ? " · " + keys.get(item.id).toUpperCase() : "");
    copy.addEventListener("click", () => { select(item.id, false); copySkill(item.id); });
    row.append(open, copy); $("results").append(row);
  }
  if (!visible.length) {
    const empty = el("div", query ? "No skills match “" + $("find").value.trim() + "”." : preferences.pinnedOnly ? "No pinned skills. Open a skill and assign a shortcut." : "No skills found. Add your skill folders in config.local.json, then refresh.", "empty");
    if (query || preferences.pinnedOnly) {
      const clear = el("button", "Show all skills"); clear.onclick = () => { $("find").value = ""; preferences.pinnedOnly = false; save(); render(); $("find").focus(); }; empty.append(clear);
    }
    $("results").append(empty);
  }
  $("count").textContent = visible.length + (visible.length === 1 ? " skill" : " skills");
  select(selected, false);
}
function select(id, scroll = true) {
  selected = id;
  for (const row of $("results").querySelectorAll(".skill-row")) {
    const active = row.dataset.id === selected; row.classList.toggle("selected", active);
    if (active && scroll) row.scrollIntoView({ block: "nearest" });
  }
  const item = skills.find(x => x.id === id);
  $("selection").textContent = item ? item.name + ". Enter to open." : "";
}
async function json(url) {
  const response = await fetch(url, { cache: "no-store" });
  const result = await response.json();
  if (!response.ok) { const error = Error(result.error || "Could not load skills."); error.status = response.status; throw error; }
  return result;
}
async function load() {
  $("load-error").hidden = true;
  try {
    const result = await json("/api/skills");
    skills = result.skills; examples = result.examples || [];
    $("examples-link").hidden = !examples.length; assignKeys(); render();
    $("warnings").textContent = result.warnings.join("\n");
    const review = result.review_url;
    let safe = false;
    try { const url = new URL(review); safe = url.protocol === "http:" && ["localhost", "127.0.0.1", "skills.localhost"].includes(url.hostname); } catch {}
    $("review").hidden = !safe;
    if (safe) $("review").href = review;
    if (location.pathname.startsWith("/skill/")) await route();
    else if (new URLSearchParams(location.search).has("examples")) showExamples();
  } catch (error) {
    $("load-error").replaceChildren(el("span", error.message + " "));
    const retry = el("button", "Try again"); retry.onclick = load; $("load-error").append(retry); $("load-error").hidden = false;
    if (!skills.length) $("results").replaceChildren(el("p", "Your files have not been changed.", "empty"));
  }
}
function link(target, title, image) {
  if (image) return el("span", title ? "[Image: " + title + "]" : "[Image]");
  if (target.startsWith("#")) {
    const a = el("a", title); a.href = target;
    a.onclick = e => { e.preventDefault(); document.getElementById(target.slice(1))?.scrollIntoView(); };
    return a;
  }
  try {
    const url = new URL(target);
    if (["https:", "http:"].includes(url.protocol)) {
      const a = el("a", title); a.href = url.href; a.target = "_blank"; a.rel = "noopener noreferrer"; return a;
    }
    return el("span", title);
  } catch {}
  if (!current || target.startsWith("/") || target.includes("\\") || /^[a-z]+:/i.test(target)) return el("span", title);
  const base = new URL("http://skill.invalid/" + current.file);
  const url = new URL(target, base), file = decodeURIComponent(url.pathname.slice(1));
  if (!/\.(md|txt)$/i.test(file)) return el("span", title);
  const a = el("a", title); a.href = "/skill/" + current.id + "?file=" + encodeURIComponent(file) + url.hash;
  a.onclick = event => { event.preventDefault(); navigate(a.getAttribute("href")); };
  return a;
}
function safeExampleLink(url, text, cls = "") {
  try {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    const a = el("a", text, cls); a.href = u.href; a.target = "_blank"; a.rel = "noopener noreferrer"; return a;
  } catch { return null; }
}
function showExamples() {
  request++; current = null; $("launcher").hidden = true; $("reader").hidden = true;
  $("examples-page")?.remove();
  const page = el("main", undefined, "reader-shell examples-page"); page.id = "examples-page";
  const nav = el("header", undefined, "reader-nav"), back = el("a", "← Skills", "text-button"); back.href = "/"; nav.append(back);
  const article = el("article", undefined, "reader-article");
  article.append(el("h1", "Skill examples"), el("p", "Small examples to try, compare, and review.", "example-intro"));
  if (!examples.length) article.append(el("p", "No examples have been added yet.", "small"));
  examples.forEach((example, index) => {
    const section = el("section", undefined, "example-section");
    section.append(el("h2", (index + 1) + ". " + example.title), el("p", example.description));
    const actions = el("div", undefined, "example-actions");
    const primary = safeExampleLink(example.url, example.kind === "video" ? "Watch example ↗" : "Try example ↗", "primary");
    if (primary) actions.append(primary);
    const compare = safeExampleLink(example.control_url, "Without the skill ↗"); if (compare) actions.append(compare);
    section.append(actions);
    const detail = el("details", undefined, "details"); detail.append(el("summary", "Brief & test record"));
    if (example.note) detail.append(el("p", example.note, "small"));
    if (example.brief) detail.append(el("p", example.brief));
    const notes = safeExampleLink(example.notes_url, "Read first-return notes ↗"); if (notes) detail.append(notes);
    const review = safeExampleLink(example.review_url, "Open review & feedback ↗"); if (review) detail.append(el("br"), review);
    section.append(detail); article.append(section);
  });
  article.append(el("p", "Examples are starting points for evaluation. Read the brief and test record for what was checked and what remains uncertain.", "small"));
  page.append(nav, article); document.body.append(page); document.title = "Examples · Skills"; window.scrollTo(0,0);
}
function showLauncher(focus = true) {
  $("examples-page")?.remove();
  request++; current = null; $("reader").hidden = true; $("launcher").hidden = false; document.title = "Skills"; render();
  if (focus) $("launcher").focus({ preventScroll: true });
}
function navigate(url) { history.pushState({ skills: true }, "", url); route(); }
function openSkill(id) { navigate("/skill/" + encodeURIComponent(id)); }
async function route() {
  if (new URLSearchParams(location.search).has("examples")) { showExamples(); return; }
  $("examples-page")?.remove();
  const match = location.pathname.match(/^\/skill\/([a-f0-9]{20})$/);
  if (!match) { showLauncher(); return; }
  if (!skills.some(item => item.id === match[1])) {
    history.replaceState({}, "", "/"); showLauncher();
    toast("That skill is no longer in this library."); return;
  }
  const token = ++request, file = new URLSearchParams(location.search).get("file") || "SKILL.md";
  current = null;
  $("launcher").hidden = true; $("reader").hidden = false; $("reader-title").textContent = "Loading…";
  $("description").textContent = ""; $("document").replaceChildren(); $("copy").disabled = true; document.querySelector(".reader-article>.details").hidden = true;
  try {
    const doc = await json("/api/skill/" + match[1] + "?file=" + encodeURIComponent(file));
    if (token !== request) return;
    current = doc; selected = doc.id; document.title = doc.name + " · Skills";
    $("reader-title").textContent = doc.name; $("description").textContent = doc.description;
    $("description").hidden = !doc.description;
    $("document").replaceChildren(markdown(doc.body, link, true));
    $("copy").textContent = file === "SKILL.md" ? "Copy skill" : "Copy document";
    $("copy").disabled = false;
    document.querySelector(".reader-article>.details").hidden = false;
    $("source-info").replaceChildren(el("p", doc.source), el("p", doc.path), el("p", "SHA-256"), el("code", doc.sha256));
    $("download").href = "/api/skill/" + doc.id + "?download=1";
    renderShortcuts(); window.scrollTo(0, 0); $("reader-title").focus({ preventScroll: true });
    if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
  } catch (error) {
    if (token !== request) return;
    if (error.status === 404) {
      try {
        const latest = await json("/api/skills");
        if (token !== request) return;
        skills = latest.skills; assignKeys();
        if (!skills.some(item => item.id === match[1])) {
          history.replaceState({}, "", "/"); showLauncher();
          toast("That skill is no longer in this library."); return;
        }
      } catch { /* Keep the original document error and retry available. */ }
    }
    $("description").hidden = true;
    $("reader-title").textContent = "Couldn’t open this skill"; $("document").append(el("p", error.message));
    const retry = el("button", "Try again"); retry.onclick = route; $("document").append(retry);
  }
}
function renderShortcuts() {
  const select = $("shortcut"); select.replaceChildren(el("option", "None")); select.firstChild.value = "";
  for (const key of "abcdefghijklmnopqrstuvwxyz0123456789") {
    const owner = skills.find(x => keys.get(x.id) === key && x.id !== current.id);
    const option = el("option", key.toUpperCase() + (owner ? " — " + owner.name : "")); option.value = key; option.disabled = !!owner; select.append(option);
  }
  select.value = keys.get(current.id) || "";
}
async function copySkill(id, doc = null) {
  if (copying) return;
  copying = true;
  try {
    const source = doc || await json("/api/skill/" + id);
    try {
      await navigator.clipboard.writeText(source.text);
      toast("Copied " + source.name);
    } catch {
      $("manual-text").value = source.text; $("manual").showModal(); $("manual-text").focus(); $("manual-text").select();
    }
  } catch (error) { toast(error.message); }
  finally { copying = false; }
}
$("find").addEventListener("input", render);
$("focus-search").onclick = () => $("find").focus();
$("back").onclick = () => navigate("/");
$("copy").onclick = () => current && copySkill(current.id, current);
$("shortcut").onchange = () => {
  if (!current) return;
  preferences.shortcuts[current.id] = $("shortcut").value; save(); assignKeys(); render(); toast($("shortcut").value ? "Shortcut saved" : "Shortcut removed");
};
$("options").onclick = () => { $("keys-enabled").checked = preferences.keysEnabled !== false; $("pinned-only").checked = !!preferences.pinnedOnly; $("settings").showModal(); };
$("keys-enabled").onchange = () => { preferences.keysEnabled = $("keys-enabled").checked; save(); };
$("pinned-only").onchange = () => { preferences.pinnedOnly = $("pinned-only").checked; save(); render(); };
$("refresh").onclick = async () => { $("settings").close(); await load(); };
$("select-all").onclick = () => { $("manual-text").focus(); $("manual-text").select(); };
for (const close of document.querySelectorAll(".close")) close.onclick = () => close.closest("dialog").close();
window.addEventListener("popstate", route);
document.addEventListener("keydown", event => {
  if (event.isComposing || event.repeat || document.querySelector("dialog[open]")) return;
  if ($("examples-page")) {
    if (event.key === "Escape") { event.preventDefault(); navigate("/"); }
    else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); navigate("/"); $("find").focus(); }
    return;
  }
  const editing = event.target.closest("input,textarea,select,[contenteditable=true]");
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (!$("reader").hidden) { history.pushState({}, "", "/"); showLauncher(false); }
    $("find").focus(); $("find").select(); return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    if (!$("reader").hidden) navigate("/");
    else if ($("find").value) { $("find").value = ""; render(); $("find").focus(); }
    else { $("find").blur(); $("launcher").focus(); }
    return;
  }
  if (!$("reader").hidden) {
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "c" && !editing && current) { event.preventDefault(); copySkill(current.id, current); }
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === "/" && !editing) { event.preventDefault(); $("find").focus(); return; }
  if (["ArrowDown", "ArrowUp"].includes(event.key) && (!editing || event.target === $("find"))) {
    event.preventDefault(); const at = visible.findIndex(x => x.id === selected);
    const next = Math.max(0, Math.min(visible.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)));
    if (visible[next]) select(visible[next].id); return;
  }
  // Native Enter on buttons/links keeps its meaning; search/body opens the selected row.
  if (event.key === "Enter" && selected && (event.target === $("find") || !event.target.closest("button,a,summary,input,textarea,select"))) {
    event.preventDefault(); openSkill(selected); return;
  }
  if (editing || preferences.keysEnabled === false || event.shiftKey) return;
  const item = skills.find(x => keys.get(x.id) === event.key.toLowerCase());
  if (item) {
    event.preventDefault(); $("find").value = "";
    if (preferences.pinnedOnly && !keys.has(item.id)) preferences.pinnedOnly = false;
    selected = item.id; render(); select(item.id); $("launcher").focus({ preventScroll: true }); copySkill(item.id);
  }
});
await load();
