// Sitcom Tracker: page behavior.
// Loads catalog.json (read-only), shows it with search and filters, and lets
// you rate shows. Ratings live in your profile (see profile.js), never in the catalog.

const state = {
  catalog: null,   // the parsed catalog.json, plus a showsById lookup
  profile: null,   // your personal data
  pendingImport: null, // a validated import waiting for Replace/Merge/Cancel
};

const $ = (selector) => document.querySelector(selector);

// Small helper for building elements: el("p", { className: "x" }, "text", child)
// Text is always added as text, never as HTML.
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("aria") || key === "role") node.setAttribute(key.replace(/^aria/, "aria-").toLowerCase(), value);
    else node[key] = value;
  }
  node.append(...children.filter((child) => child !== null && child !== undefined));
  return node;
}

// --- Show display ---------------------------------------------------------

// A missing end year does not mean the show is running (see the catalog's
// missing_value_policy), so in that case we show its status instead.
function formatYears(show) {
  const start = show.years.start ?? "?";
  return show.years.end ? `${start}–${show.years.end}` : `${start}– (${show.status})`;
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function makeRatingButtons(show) {
  const current = state.profile.ratings[show.id];
  const group = el("div", { className: "rating-group", role: "group", ariaLabel: `Your rating for ${show.title}` });
  for (const [value, { label, meaning }] of Object.entries(RATINGS)) {
    group.append(el("button", {
      type: "button",
      className: `rate rate-${value}`,
      dataset: { action: "rate", id: show.id, rating: value },
      ariaPressed: String(current === value),
      title: meaning,
    }, el("span", { className: "rate-label" }, label), el("span", { className: "rate-meaning" }, meaning)));
  }
  group.append(el("button", {
    type: "button",
    className: "rate-clear",
    dataset: { action: "clear", id: show.id },
    disabled: !current,
    ariaLabel: `Clear rating for ${show.title}`,
  }, "Clear"));
  return group;
}

function makeShowCard(show) {
  const details = [formatYears(show), capitalize(show.kind), capitalize(show.medium), show.country.join(", ")];
  return el("li", { className: "show-card", dataset: { id: show.id } },
    el("h3", { className: "show-title" }, show.title),
    el("p", { className: "show-meta" }, details.join(" · ")),
    makeRatingButtons(show),
  );
}

// --- Filtering ------------------------------------------------------------

function currentFilters() {
  return {
    text: $("#search").value.trim().toLowerCase(),
    decade: $("#filter-decade").value,
    kind: $("#filter-kind").value,
    medium: $("#filter-medium").value,
    rating: $("#filter-rating").value,
  };
}

function matchesFilters(show, filters) {
  if (filters.text) {
    const titles = [show.title, ...show.alternate_titles].map((t) => t.toLowerCase());
    if (!titles.some((t) => t.includes(filters.text))) return false;
  }
  if (filters.decade && show.derived.premiere_decade !== filters.decade) return false;
  if (filters.kind && show.kind !== filters.kind) return false;
  if (filters.medium && show.medium !== filters.medium) return false;

  const rating = state.profile.ratings[show.id];
  if (filters.rating === "rated" && !rating) return false;
  if (filters.rating === "unrated" && rating) return false;
  if (filters.rating in RATINGS && rating !== filters.rating) return false;
  return true;
}

function renderList() {
  const filters = currentFilters();
  const visible = state.catalog.shows.filter((show) => matchesFilters(show, filters));
  $("#shows").replaceChildren(...visible.map(makeShowCard));
  $("#empty-state").hidden = visible.length > 0;
  renderSummary(visible.length);
}

function renderSummary(visibleCount = document.querySelectorAll("#shows .show-card").length) {
  const total = state.catalog.shows.length;
  const counts = { yes: 0, meh: 0, no: 0 };
  for (const rating of Object.values(state.profile.ratings)) counts[rating]++;
  const rated = counts.yes + counts.meh + counts.no;

  const showing = visibleCount === total ? `Showing all ${total} shows.` : `Showing ${visibleCount} of ${total} shows.`;
  const ratedText = rated === 0
    ? "You haven't rated any shows yet. Ratings are optional."
    : `You've rated ${rated}: ${counts.yes} Yes, ${counts.meh} Meh, ${counts.no} No.`;
  $("#summary").textContent = `${showing} ${ratedText}`;
}

// Fill a <select> with the distinct values found in the catalog.
function fillSelect(select, values, labelFor = capitalize) {
  for (const value of values) {
    select.append(el("option", { value }, labelFor(value)));
  }
}

function distinct(values) {
  return [...new Set(values)].sort();
}

// --- Rating changes -------------------------------------------------------

function setRating(id, rating) {
  if (rating) state.profile.ratings[id] = rating;
  else delete state.profile.ratings[id];
  persist();

  // Update just this card so keyboard focus stays where it is.
  const card = document.querySelector(`.show-card[data-id="${CSS.escape(id)}"]`);
  if (card) {
    const show = state.catalog.showsById.get(id);
    card.querySelector(".rating-group").replaceWith(makeRatingButtons(show));
    const focusTarget = card.querySelector(rating ? `[data-rating="${rating}"]` : ".rate");
    focusTarget?.focus();
  }
  renderSummary();
}

function persist() {
  if (!saveStoredProfile(state.profile)) {
    showNotice("Your change could not be saved in this browser's storage. Export a backup so you don't lose it.");
  }
}

// --- Notices --------------------------------------------------------------

function showNotice(message, { retry = false } = {}) {
  const notice = $("#notice");
  notice.replaceChildren(el("p", {}, message));
  if (retry) {
    notice.append(el("button", { type: "button", onclick: () => location.reload() }, "Try again"));
  }
  notice.hidden = false;
}

// --- Export and import ----------------------------------------------------

function exportBackup() {
  const backup = makeBackup(state.profile, state.catalog);
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const link = el("a", {
    href: URL.createObjectURL(blob),
    download: `sitcom-tracker-backup-${backup.exported_at.slice(0, 10)}.json`,
  });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

async function handleImportFile(file) {
  const preview = $("#import-preview");
  preview.hidden = false;
  state.pendingImport = null;

  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    preview.replaceChildren(el("p", { className: "error" }, `"${file.name}" is not valid JSON. Nothing was changed.`));
    return;
  }

  const result = validateProfileData(data, state.catalog);
  if (!result.ok) {
    preview.replaceChildren(
      el("p", { className: "error" }, `"${file.name}" can't be imported. Nothing was changed.`),
      el("ul", {}, ...result.errors.map((e) => el("li", {}, e))),
    );
    return;
  }

  state.pendingImport = result.profile;
  const incoming = Object.keys(result.profile.ratings).length;
  const current = Object.keys(state.profile.ratings).length;
  const conflicts = Object.keys(result.profile.ratings)
    .filter((id) => id in state.profile.ratings && state.profile.ratings[id] !== result.profile.ratings[id]).length;

  preview.replaceChildren(
    el("p", {}, el("strong", {}, `"${file.name}" looks good: ${incoming} rating(s) found.`)),
    result.warnings.length ? el("ul", {}, ...result.warnings.map((w) => el("li", {}, w))) : null,
    el("p", {}, "Choose how to use it. Nothing changes until you pick one:"),
    el("ul", {},
      el("li", {}, el("strong", {}, "Replace: "), `your current ${current} rating(s) are removed and the ${incoming} from the file are used instead.`),
      el("li", {}, el("strong", {}, "Merge: "), `ratings from the file are added to yours. Where both have a different rating for the same show (${conflicts} show(s)), the file's rating wins. Your other ratings stay.`),
    ),
    el("div", { className: "data-actions" },
      el("button", { type: "button", dataset: { importMode: "replace" } }, "Replace my data"),
      el("button", { type: "button", dataset: { importMode: "merge" } }, "Merge into my data"),
      el("button", { type: "button", className: "button-secondary", dataset: { importMode: "cancel" } }, "Cancel"),
    ),
  );
}

function finishImport(mode) {
  const preview = $("#import-preview");
  if (mode !== "cancel" && state.pendingImport) {
    state.profile = mode === "replace" ? state.pendingImport : mergeProfiles(state.profile, state.pendingImport);
    persist();
    renderList();
    preview.replaceChildren(el("p", {}, mode === "replace" ? "Import complete: your data was replaced." : "Import complete: the backup was merged into your data."));
  } else {
    preview.replaceChildren(el("p", {}, "Import cancelled. Nothing was changed."));
  }
  state.pendingImport = null;
  $("#import-file").value = "";
}

// --- Start-up -------------------------------------------------------------

function wireEvents() {
  $("#filters").addEventListener("input", renderList);
  $("#filters").addEventListener("submit", (event) => event.preventDefault());
  // A reset changes the fields after this event fires, so re-render on the next tick.
  $("#filters").addEventListener("reset", () => setTimeout(renderList));
  $("#empty-clear").addEventListener("click", () => $("#filters").reset());

  $("#shows").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const { action, id, rating } = button.dataset;
    if (action === "rate") {
      // Pressing the current rating again clears it.
      setRating(id, state.profile.ratings[id] === rating ? null : rating);
    } else if (action === "clear") {
      setRating(id, null);
    }
  });

  $("#export-button").addEventListener("click", exportBackup);
  $("#import-file").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) handleImportFile(file);
  });
  $("#import-preview").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-import-mode]");
    if (button) finishImport(button.dataset.importMode);
  });
}

async function start() {
  try {
    const response = await fetch("catalog.json");
    if (!response.ok) throw new Error(`the server answered HTTP ${response.status}`);
    state.catalog = await response.json();
    if (!Array.isArray(state.catalog.shows)) throw new Error("the file has no shows list");
  } catch (error) {
    // The usual cause is opening index.html straight from disk: browsers
    // block fetch() for file:// pages, so a local web server is needed.
    $("#summary").textContent = "The catalog could not be loaded.";
    showNotice(
      `Could not load catalog.json (${error.message}). If you opened index.html directly from your computer, ` +
      "start a local web server instead (see the README).",
      { retry: true },
    );
    return;
  }

  state.catalog.showsById = new Map(state.catalog.shows.map((show) => [show.id, show]));

  const { profile, problem } = loadStoredProfile(state.catalog);
  state.profile = profile;
  if (problem) showNotice(problem);

  const shows = state.catalog.shows;
  fillSelect($("#filter-decade"), distinct(shows.map((s) => s.derived.premiere_decade)), (d) => d);
  fillSelect($("#filter-kind"), distinct(shows.map((s) => s.kind)));
  fillSelect($("#filter-medium"), distinct(shows.map((s) => s.medium)));

  wireEvents();
  renderList();
}

start();
