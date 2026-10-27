// Sitcom Tracker: page behavior.
// Loads catalog.json (read-only), shows it with search and filters, and lets
// you record what you've seen and how much you liked it. That personal data
// lives in your profile (see profile.js), never in the catalog.

const UNDO_LIMIT = 50;

const state = {
  catalog: null,        // the parsed catalog.json, plus a showsById lookup
  profile: null,        // your personal data
  mode: "browse",       // "browse" (cards), "history" (compact checklist), or "recommend"
  undoStack: [],        // recent changes: { label, before: [[id, entry or null], ...] }
  pendingImport: null,  // a validated import waiting for Replace/Merge/Cancel
  rec: null,            // the last recommendation result (kept until you press Refresh)
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

function showTitle(id) {
  return state.catalog.showsById.get(id).title;
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

function choiceButton({ action, id, value, pressed, label, meaning, className }) {
  return el("button", {
    type: "button",
    className,
    dataset: { action, id, value },
    ariaPressed: String(pressed),
    title: meaning,
  }, el("span", { className: "choice-label" }, label), el("span", { className: "choice-meaning" }, meaning));
}

function makeStatusButtons(show) {
  const status = getStatus(state.profile, show.id);
  const group = el("div", { className: "choice-group status-group", role: "group", ariaLabel: `Have you seen ${show.title}?` });
  for (const [value, { label, meaning }] of Object.entries(STATUSES)) {
    group.append(choiceButton({ action: "status", id: show.id, value, pressed: status === value, label, meaning, className: `choice status-${value}` }));
  }
  return group;
}

function makeRatingButtons(show) {
  const status = getStatus(state.profile, show.id);
  const rating = getRating(state.profile, show.id);
  const group = el("div", { className: "choice-group rating-group", role: "group", ariaLabel: `Did you enjoy ${show.title}? (optional)` });
  for (const [value, { label, meaning }] of Object.entries(RATINGS)) {
    group.append(choiceButton({ action: "rate", id: show.id, value, pressed: rating === value, label, meaning, className: `choice rate-${value}` }));
  }
  // "Seen with no rating", for shows watched too long ago to judge.
  group.append(choiceButton({
    action: "rate", id: show.id, value: "none", pressed: status === "seen" && !rating,
    label: "Can't judge", meaning: "Seen, too long ago", className: "choice rate-none",
  }));
  return group;
}

function makeShowCard(show) {
  const details = [formatYears(show), capitalize(show.kind), capitalize(show.medium), show.country.join(", ")];
  return el("li", { className: "show-card", dataset: { id: show.id } },
    el("h3", { className: "show-title" }, show.title),
    el("p", { className: "show-meta" }, details.join(" · ")),
    el("p", { className: "group-label" }, "Seen it?"),
    makeStatusButtons(show),
    el("p", { className: "group-label" }, "Did you enjoy it? (optional)"),
    makeRatingButtons(show),
  );
}

// One compact line in the Quick history checklist.
function makeHistoryRow(show, idPrefix = "seen") {
  const status = getStatus(state.profile, show.id);
  const rating = getRating(state.profile, show.id);
  const checkboxId = `${idPrefix}-${show.id}`;
  return el("li", { className: `history-row status-${status}`, dataset: { id: show.id } },
    el("input", { type: "checkbox", id: checkboxId, checked: status === "seen", dataset: { action: "toggle-seen", id: show.id } }),
    el("label", { htmlFor: checkboxId },
      el("span", { className: "history-title" }, show.title),
      el("span", { className: "history-year" }, ` ${show.years.start ?? ""}`),
    ),
    rating ? el("span", { className: `badge badge-${rating}`, title: RATINGS[rating].meaning }, RATINGS[rating].label) : null,
    el("button", {
      type: "button",
      className: "not-seen-toggle",
      dataset: { action: "toggle-not-seen", id: show.id },
      ariaPressed: String(status === "not_seen"),
      ariaLabel: `Not seen: ${show.title}`,
    }, "Not seen"),
  );
}

// --- Recommendations --------------------------------------------------------

function ratingPhrase(rating) {
  return { yes: "you liked", meh: "you rated Meh", no: "you didn't like" }[rating];
}

// "you liked Cheers, Taxi; you didn't like Soap" for the rated shows behind a feature.
function examplesText(examples) {
  const groups = [];
  for (const rating of ["yes", "meh", "no"]) {
    const titles = examples.filter((e) => e.rating === rating).map((e) => showTitle(e.id));
    if (titles.length === 0) continue;
    const shown = titles.slice(0, 3).join(", ") + (titles.length > 3 ? ` and ${titles.length - 3} more` : "");
    groups.push(`${ratingPhrase(rating)} ${shown}`);
  }
  return groups.join("; ");
}

function statusNote(item) {
  const now = getStatus(state.profile, item.show.id);
  if (now !== item.status) {
    const rating = getRating(state.profile, item.show.id);
    const recorded = rating ? `Seen, rated ${RATINGS[rating].label}` : STATUSES[now].label;
    return el("p", { className: "rec-status rec-status-changed" }, `Now recorded as ${recorded}. Press "Refresh recommendations" to update the list.`);
  }
  return item.status === "not_seen"
    ? el("p", { className: "rec-status" }, "You marked this Not seen.")
    : el("p", { className: "rec-status rec-status-unknown" }, "Unknown: you haven't said whether you've seen this, so it may not be new to you.");
}

function makePickCard(item) {
  const { show } = item;
  const why = explain(item, state.rec.prefs, state.catalog);
  const reasons = el("ul", { className: "reasons" },
    ...why.positives.map((f) => el("li", { className: "reason-plus", title: f.definition },
      el("strong", {}, `+ ${f.label}`), ` (${examplesText(f.examples)})`)),
    ...why.negatives.map((f) => el("li", { className: "reason-minus", title: f.definition },
      el("strong", {}, `− ${f.label}`), ` counts against it (${examplesText(f.examples)})`)),
  );
  const total = item.contributions.reduce((sum, c) => sum + c.lean, 0);
  const breakdown = el("details", { className: "score-details" },
    el("summary", {}, `Score ${item.score.toFixed(3)}: how it was computed`),
    el("p", {}, `Sum of feature leans ${total.toFixed(3)} ÷ ${item.featureCount} features = ${item.score.toFixed(3)}. ` +
      `${why.unmatched} feature(s) appear in none of your rated shows and count as 0.`),
    el("ul", {}, ...[...item.contributions].sort((a, b) => b.lean - a.lean).map((c) =>
      el("li", {}, `${describeFeature(c.feature, state.catalog).label}: ${c.lean >= 0 ? "+" : ""}${c.lean.toFixed(3)}`))),
  );
  return el("li", { className: "rec-card show-card", dataset: { id: show.id, kind: "pick" } },
    el("h4", { className: "show-title" }, show.title, el("span", { className: "years" }, ` ${formatYears(show)}`)),
    statusNote(item),
    el("p", { className: "group-label" }, "Why it's suggested"),
    reasons,
    el("p", { className: "eligibility" }, eligibilityReason(show)),
    breakdown,
    el("p", { className: "group-label" }, "Seen it?"),
    makeStatusButtons(show),
    el("p", { className: "group-label" }, "Did you enjoy it? (optional)"),
    makeRatingButtons(show),
  );
}

function makeDiscoveryRow(item) {
  const row = makeHistoryRow(item.show, "discover");
  row.dataset.kind = "discovery";
  if (state.rec.evidence.enough) {
    const top = explain(item, state.rec.prefs, state.catalog).positives[0];
    if (top) row.querySelector("label").append(el("span", { className: "discovery-reason" }, `Shares ${top.label.toLowerCase()}`));
  }
  return row;
}

function computeRecommendations() {
  state.rec = recommend(state.catalog, state.profile, {
    includeUnknown: $("#opt-include-unknown").checked,
    includeReviewCandidates: $("#opt-include-candidates").checked,
  });
}

function renderRecommendations() {
  const rec = state.rec;
  const { counts, evidence } = rec;
  const poolName = $("#opt-include-candidates").checked
    ? "the catalog's documented selection plus the shows still needing reputation evidence"
    : "the catalog's documented selection (shows with recorded award, recognition, or audience-score evidence)";
  $("#rec-pool").textContent = `Eligible pool: ${counts.pool} shows from ${poolName}. ` +
    `You've seen ${counts.seen} of them (always excluded), marked ${counts.notSeen} Not seen, and ${counts.unknown} are Unknown. ` +
    "Every eligible show is scored.";

  const messages = [];
  if (!evidence.enough) {
    messages.push(el("p", {}, el("strong", {}, "Not enough evidence for personal picks yet. "),
      `You've rated ${evidence.rated} show(s), ${evidence.liked} with Yes. Picks need at least ${MIN_RATED} ratings, including at least ${MIN_LIKED} Yes. ` +
      "Without that, any ranking would be guesswork."));
    messages.push(el("p", {}, "Next step: rate a few shows you remember well, then come back. ",
      el("button", { type: "button", className: "button-secondary", dataset: { gotoMode: "browse" } }, "Browse & rate"), " ",
      el("button", { type: "button", className: "button-secondary", dataset: { gotoMode: "history" } }, "Quick history")));
  } else {
    if (evidence.rough) {
      messages.push(el("p", {}, `Based on only ${evidence.rated} ratings, so treat these as rough suggestions. More ratings, including Meh and No, will sharpen them.`));
    }
    if (rec.picks.length < PICK_LIMIT && !$("#opt-include-unknown").checked) {
      messages.push(el("p", {}, `Only ${rec.picks.length} eligible show(s) marked Not seen have a positive score. ` +
        'Mark more shows Not seen (the discovery list below helps), or tick "Also include shows I haven\'t marked yet" above.'));
    } else if (rec.picks.length === 0) {
      messages.push(el("p", {}, "No unseen eligible show has a positive score from your ratings."));
    }
  }
  $("#rec-evidence").replaceChildren(...messages);
  $("#rec-evidence").hidden = messages.length === 0;

  $("#rec-picks").replaceChildren(...rec.picks.map(makePickCard));
  $("#rec-discovery").replaceChildren(...rec.discovery.map(makeDiscoveryRow));
  $("#discovery").querySelector("summary h3").textContent =
    `Discovery list: ${rec.discovery.length} show(s) to sort into Seen or Not seen${evidence.enough ? "" : " (not personalized yet, in premiere order)"}`;
  if (!evidence.enough || rec.picks.length < PICK_LIMIT) $("#discovery").open = true;
}

// --- Filtering ------------------------------------------------------------

function currentFilters() {
  return {
    text: $("#search").value.trim().toLowerCase(),
    decade: $("#filter-decade").value,
    kind: $("#filter-kind").value,
    medium: $("#filter-medium").value,
    history: $("#filter-history").value,
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

  const status = getStatus(state.profile, show.id);
  const rating = getRating(state.profile, show.id);
  switch (filters.history) {
    case "": return true;
    case "seen-unrated": return status === "seen" && !rating;
    case "yes": case "meh": case "no": return rating === filters.history;
    default: return status === filters.history;
  }
}

function visibleShows() {
  const filters = currentFilters();
  return state.catalog.shows.filter((show) => matchesFilters(show, filters));
}

function renderList() {
  if (state.mode === "recommend") {
    renderRecommendations();
    return;
  }
  const visible = visibleShows();
  const browse = state.mode === "browse";
  $("#shows").hidden = !browse;
  $("#history").hidden = browse;
  $("#browse-help").hidden = !browse;
  $("#history-help").hidden = browse;
  $(browse ? "#shows" : "#history").replaceChildren(...visible.map(browse ? makeShowCard : makeHistoryRow));
  $(browse ? "#history" : "#shows").replaceChildren();
  $("#empty-state").hidden = visible.length > 0;
  renderSummary(visible);
}

// Re-draw just one show (card or row) and put keyboard focus back on the same control.
function renderShow(id) {
  const show = state.catalog.showsById.get(id);
  for (const old of document.querySelectorAll(`main [data-id="${CSS.escape(id)}"]:is(li)`)) {
    const focused = document.activeElement;
    const focusKey = old.contains(focused) ? `[data-action="${focused.dataset.action}"]${focused.dataset.value ? `[data-value="${focused.dataset.value}"]` : ""}` : null;
    const item = state.rec && [...state.rec.picks, ...state.rec.discovery].find((i) => i.show.id === id);
    let fresh;
    if (old.dataset.kind === "pick") fresh = makePickCard(item);
    else if (old.dataset.kind === "discovery") fresh = makeDiscoveryRow(item);
    else fresh = old.classList.contains("history-row") ? makeHistoryRow(show) : makeShowCard(show);
    old.replaceWith(fresh);
    if (focusKey) fresh.querySelector(focusKey)?.focus();
  }
}

function renderSummary(visible = visibleShows()) {
  const total = state.catalog.shows.length;
  const c = countEntries(state.profile);
  const unknown = total - c.seen - c.not_seen;

  const showing = visible.length === total ? `Showing all ${total} shows.` : `Showing ${visible.length} of ${total} shows.`;
  const history = c.seen + c.not_seen === 0
    ? "You haven't recorded any shows yet."
    : `Seen ${c.seen} (${c.rated} rated: ${c.yes} Yes, ${c.meh} Meh, ${c.no} No; ${c.seen - c.rated} with no rating) · Not seen ${c.not_seen} · Unknown ${unknown}.`;
  $("#summary").textContent = `${showing} ${history}`;

  if (state.mode === "history") {
    const unknownHere = visible.filter((show) => getStatus(state.profile, show.id) === "unknown").length;
    const bulk = $("#bulk-not-seen");
    bulk.textContent = `Mark the ${unknownHere} Unknown show${unknownHere === 1 ? "" : "s"} in this list as Not seen`;
    bulk.disabled = unknownHere === 0;
  }
}

// Fill a <select> with the distinct values found in the catalog.
function fillSelect(select, values, labelFor = capitalize) {
  for (const value of values) select.append(el("option", { value }, labelFor(value)));
}

function distinct(values) {
  return [...new Set(values)].sort();
}

// --- Changing history and ratings -------------------------------------------

// Apply a list of changes [{ id, status, rating }] as one undoable step.
function applyChanges(changes, label) {
  const before = changes.map(({ id }) => [id, state.profile.shows[id] ? { ...state.profile.shows[id] } : null]);
  state.undoStack.push({ label, before });
  if (state.undoStack.length > UNDO_LIMIT) state.undoStack.shift();

  for (const { id, status, rating } of changes) setEntry(state.profile, id, status, rating);
  persist();
  if (changes.length === 1) renderShow(changes[0].id);
  else renderList();
  renderSummary();
  showUndo(label);
}

function undo() {
  const step = state.undoStack.pop();
  if (!step) return;
  for (const [id, entry] of step.before) {
    if (entry) state.profile.shows[id] = entry;
    else delete state.profile.shows[id];
  }
  persist();
  renderList();
  showUndo(`Undone: ${step.label}`, true);
}

function showUndo(message, afterUndo = false) {
  $("#undo-bar").hidden = false;
  const remaining = state.undoStack.length;
  $("#undo-message").textContent = afterUndo && remaining > 0 ? `${message} (${remaining} more step${remaining === 1 ? "" : "s"} can be undone)` : message;
  $("#undo-button").disabled = remaining === 0;
}

// Ask before a status change would remove a rating, instead of dropping it silently.
async function changeStatus(id, newStatus) {
  const rating = getRating(state.profile, id);
  if (rating && newStatus !== "seen") {
    const ok = await confirmChoice({
      title: `Remove your rating for ${showTitle(id)}?`,
      text: `You rated it "${RATINGS[rating].label} – ${RATINGS[rating].meaning}". A rating means you've seen the show, so marking it ${STATUSES[newStatus].label} will remove that rating.`,
      confirm: `Remove rating and mark ${STATUSES[newStatus].label}`,
      cancel: "Keep it as Seen",
    });
    if (!ok) {
      renderShow(id); // put a checkbox back the way it was
      return;
    }
  }
  if (newStatus === getStatus(state.profile, id) && !(rating && newStatus !== "seen")) return;
  // Moving to Seen keeps an existing rating.
  applyChanges([{ id, status: newStatus, rating: newStatus === "seen" ? rating : null }], `${showTitle(id)}: ${STATUSES[newStatus].label}`);
}

function changeRating(id, value) {
  const current = getRating(state.profile, id);
  // "none", or pressing the current rating again, leaves the show Seen with no rating.
  const rating = value === "none" || value === current ? null : value;
  if (rating === current && getStatus(state.profile, id) === "seen") return;
  const label = rating ? `${showTitle(id)}: rated ${RATINGS[rating].label}` : `${showTitle(id)}: Seen, no rating`;
  applyChanges([{ id, status: "seen", rating }], label);
}

async function markVisibleUnknownNotSeen() {
  const ids = visibleShows().filter((show) => getStatus(state.profile, show.id) === "unknown").map((show) => show.id);
  if (ids.length === 0) return;
  const ok = await confirmChoice({
    title: `Mark ${ids.length} show${ids.length === 1 ? "" : "s"} as Not seen?`,
    text: "Every show in the current list that is still Unknown will be marked Not seen. Shows you've marked Seen or Not seen are not touched. You can undo this.",
    confirm: "Mark them Not seen",
    cancel: "Cancel",
  });
  if (ok) applyChanges(ids.map((id) => ({ id, status: "not_seen", rating: null })), `${ids.length} show${ids.length === 1 ? "" : "s"} marked Not seen`);
}

function persist() {
  if (!saveStoredProfile(state.profile)) {
    showNotice("Your change could not be saved in this browser's storage. Export a backup so you don't lose it.");
  }
}

// --- Dialog and notices -----------------------------------------------------

// Show the confirmation dialog and resolve to true (confirm) or false.
function confirmChoice({ title, text, confirm, cancel }) {
  const dialog = $("#confirm-dialog");
  $("#confirm-title").textContent = title;
  $("#confirm-text").textContent = text;
  $("#confirm-yes").textContent = confirm;
  $("#confirm-no").textContent = cancel;
  const returnFocus = document.activeElement;
  dialog.returnValue = "cancel";
  dialog.showModal();
  $("#confirm-no").focus();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue === "confirm");
      returnFocus?.focus();
    }, { once: true });
  });
}

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
  const incoming = countEntries(result.profile);
  const currentTotal = Object.keys(state.profile.shows).length;
  const incomingTotal = Object.keys(result.profile.shows).length;
  const conflicts = Object.entries(result.profile.shows)
    .filter(([id, entry]) => id in state.profile.shows && JSON.stringify(state.profile.shows[id]) !== JSON.stringify(entry)).length;

  preview.replaceChildren(
    el("p", {}, el("strong", {}, `"${file.name}" looks good: ${incoming.seen} Seen (${incoming.rated} rated), ${incoming.not_seen} Not seen.`)),
    result.warnings.length ? el("ul", {}, ...result.warnings.map((w) => el("li", {}, w))) : null,
    el("p", {}, "Choose how to use it. Nothing changes until you pick one:"),
    el("ul", {},
      el("li", {}, el("strong", {}, "Replace: "), `your current ${currentTotal} recorded show(s) are removed and the ${incomingTotal} from the file are used instead.`),
      el("li", {}, el("strong", {}, "Merge: "), `shows from the file are added to yours. Where both record the same show differently (${conflicts} show(s)), the file's entry wins. Your other shows stay.`),
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
    state.undoStack = []; // earlier undo steps no longer match the data
    $("#undo-bar").hidden = true;
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

function setMode(mode) {
  state.mode = mode;
  for (const tab of document.querySelectorAll(".mode-tab")) {
    tab.setAttribute("aria-pressed", String(tab.dataset.mode === mode));
  }
  $("#catalog-view").hidden = mode === "recommend";
  $("#recommend-view").hidden = mode !== "recommend";
  if (mode === "recommend") computeRecommendations();
  renderList();
}

function wireEvents() {
  $("#filters").addEventListener("input", renderList);
  $("#filters").addEventListener("submit", (event) => event.preventDefault());
  // A reset changes the fields after this event fires, so re-render on the next tick.
  $("#filters").addEventListener("reset", () => setTimeout(renderList));
  $("#empty-clear").addEventListener("click", () => $("#filters").reset());

  for (const tab of document.querySelectorAll(".mode-tab")) {
    tab.addEventListener("click", () => setMode(tab.dataset.mode));
  }

  // One set of handlers serves the cards, checklist rows, and recommendations.
  $("main").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action], button[data-goto-mode]");
    if (!button) return;
    const { action, id, value, gotoMode } = button.dataset;
    if (gotoMode) setMode(gotoMode);
    else if (action === "status") changeStatus(id, value);
    else if (action === "rate") changeRating(id, value);
    else if (action === "toggle-not-seen") changeStatus(id, getStatus(state.profile, id) === "not_seen" ? "unknown" : "not_seen");
  });
  $("main").addEventListener("change", (event) => {
    const box = event.target.closest('input[data-action="toggle-seen"]');
    if (box) changeStatus(box.dataset.id, box.checked ? "seen" : "unknown");
  });
  $("#rec-refresh").addEventListener("click", () => {
    computeRecommendations();
    renderRecommendations();
  });
  for (const option of ["#opt-include-unknown", "#opt-include-candidates"]) {
    $(option).addEventListener("change", () => {
      computeRecommendations();
      renderRecommendations();
    });
  }
  $("#bulk-not-seen").addEventListener("click", markVisibleUnknownNotSeen);
  $("#undo-button").addEventListener("click", undo);

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
