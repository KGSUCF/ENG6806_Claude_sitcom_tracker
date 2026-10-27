// Sitcom Tracker: page behavior.
// Loads catalog.json (read-only), shows it with search and filters, and lets
// you record what you've seen and how much you liked it. That personal data
// lives in your profile (see profile.js), never in the catalog.

const UNDO_LIMIT = 50;

const state = {
  catalog: null,        // the parsed catalog.json, plus a showsById lookup
  profile: null,        // your personal data
  mode: "browse",       // "browse" (cards), "history" (checklist), "survey", or "recommend"
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

// "you liked Cheers, Taxi; you didn't like Soap; survey: “I love squirming”"
// for the ratings and survey answers behind a feature.
function examplesText(examples, answers = []) {
  const groups = [];
  for (const rating of ["yes", "meh", "no"]) {
    const titles = examples.filter((e) => e.rating === rating).map((e) => showTitle(e.id));
    if (titles.length === 0) continue;
    const shown = titles.slice(0, 3).join(", ") + (titles.length > 3 ? ` and ${titles.length - 3} more` : "");
    groups.push(`${ratingPhrase(rating)} ${shown}`);
  }
  for (const answer of answers) groups.push(`your survey answer “${answer.label}”`);
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

const ADJUSTMENT_LABELS = { more: "More of this", less: "Less of this", ignore: "Ignore this feature" };

// The evidence behind a feature, including your own adjustment.
function reasonText(f) {
  const parts = [examplesText(f.examples, f.answers)];
  if (f.adjustment === "more") parts.push("you asked for more of this");
  if (f.adjustment === "less") parts.push("you asked for less of this");
  return parts.filter(Boolean).join("; ");
}

function makePickCard(item) {
  const { show } = item;
  const why = explain(item, state.rec.prefs, state.catalog);
  const reasons = el("ul", { className: "reasons" },
    ...why.positives.map((f) => el("li", { className: "reason-plus", title: f.definition },
      el("strong", {}, `+ ${f.label}`), ` (${reasonText(f)})`)),
    ...why.negatives.map((f) => el("li", { className: "reason-minus", title: f.definition },
      el("strong", {}, `− ${f.label}`), ` counts against it (${reasonText(f)})`)),
  );
  const ignored = showFeatures(show).filter((feature) => state.rec.prefs.get(feature)?.ignored)
    .map((feature) => describeFeature(feature, state.catalog).label);
  const total = item.contributions.reduce((sum, c) => sum + c.lean, 0);
  const breakdown = el("details", { className: "score-details" },
    el("summary", {}, `Score ${item.score.toFixed(3)}: how it was computed`),
    el("p", {}, `Sum of feature leans ${total.toFixed(3)} ÷ ${item.featureCount} features = ${item.score.toFixed(3)}. ` +
      `${why.unmatched} feature(s) appear in none of your rated shows or survey answers and count as 0.`),
    el("ul", {}, ...[...item.contributions].sort((a, b) => b.lean - a.lean).map((c) => {
      const pref = state.rec.prefs.get(c.feature);
      const parts = [];
      if (pref?.surveyLean) parts.push(`ratings ${signed(pref.ratingLean)}, survey ${signed(pref.surveyLean)}`);
      if (pref?.adjustment) parts.push(`${ADJUSTMENT_LABELS[pref.adjustment]}; before adjusting ${signed(pref.unadjustedLean)}`);
      return el("li", {}, `${describeFeature(c.feature, state.catalog).label}: ${signed(c.lean)}${parts.length ? ` (${parts.join("; ")})` : ""}`);
    })),
    ignored.length ? el("p", {}, `Ignored at your request, so not counted: ${ignored.join(", ")}.`) : null,
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

function signed(number) {
  return `${number >= 0 ? "+" : ""}${number.toFixed(3)}`;
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

  const answered = Object.keys(state.profile.survey).length;
  $("#rec-survey").textContent = answered === 0
    ? "Taste survey: not answered (optional)."
    : `Taste survey: ${answered} of ${SURVEY_QUESTIONS.length} questions answered, ${evidence.surveyPreferences} with a preference. Survey answers count for less than ratings.`;

  const messages = [];
  if (!evidence.enough) {
    messages.push(el("p", {}, el("strong", {}, "Not enough evidence for personal picks yet. "),
      `You've rated ${evidence.rated} show(s), ${evidence.liked} with Yes, and given ${evidence.surveyPreferences} survey preference(s). ` +
      `Picks need at least ${MIN_RATED} ratings including at least ${MIN_LIKED} Yes, or at least ${MIN_SURVEY_PREFERENCES} survey answers that express a preference. ` +
      "Without that, any ranking would be guesswork."));
    messages.push(el("p", {}, "Next step: rate a few shows you remember well, or answer the taste survey, then come back. ",
      el("button", { type: "button", className: "button-secondary", dataset: { gotoMode: "browse" } }, "Browse & rate"), " ",
      el("button", { type: "button", className: "button-secondary", dataset: { gotoMode: "history" } }, "Quick history"), " ",
      el("button", { type: "button", className: "button-secondary", dataset: { gotoMode: "survey" } }, "Taste survey")));
  } else {
    if (evidence.surveyOnly) {
      messages.push(el("p", {}, el("strong", {}, "These picks rest mainly on your survey answers. "),
        `You've rated only ${evidence.rated} show(s), so the ranking comes from broad preferences. Rating a few shows will make it more personal.`));
    } else if (evidence.rough) {
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

  renderPatterns();
  $("#rec-picks").replaceChildren(...rec.picks.map(makePickCard));
  $("#rec-discovery").replaceChildren(...rec.discovery.map(makeDiscoveryRow));
  $("#discovery").querySelector("summary h3").textContent =
    `Discovery list: ${rec.discovery.length} show(s) to sort into Seen or Not seen${evidence.enough ? "" : " (not personalized yet, in premiere order)"}`;
  if (!evidence.enough || rec.picks.length < PICK_LIMIT) $("#discovery").open = true;
}

// --- What your ratings suggest -----------------------------------------------

function patternClaim(p) {
  const name = el("strong", {}, p.label);
  if (p.confidence === "mixed") return ["Mixed signals about ", name, ": your ratings point both ways."];
  const enjoy = { slight: "You might enjoy", some: "You seem to enjoy", consistent: "You fairly consistently enjoy" };
  const lower = { slight: "You might be less keen on", some: "You seem to rate lower", consistent: "You fairly consistently rate lower" };
  return [p.positive ? enjoy[p.confidence] : lower[p.confidence], " shows with ", name, "."];
}

function adjustmentButtons(feature, label) {
  const current = state.profile.adjustments[feature] ?? "learned";
  const choices = { learned: "As learned", ...ADJUSTMENT_LABELS };
  return el("div", { className: "choice-group adjust-group", role: "group", ariaLabel: `How to use ${label} in recommendations` },
    ...Object.entries(choices).map(([value, text]) => el("button", {
      type: "button",
      className: `choice adjust-${value}`,
      dataset: { adjustFeature: feature, adjustValue: value },
      ariaPressed: String(current === value),
    }, el("span", { className: "choice-label" }, text))));
}

function scoringNow(feature) {
  const pref = state.rec.prefs.get(feature);
  if (!pref) return "Not used in scoring yet.";
  if (pref.ignored) return "Ignored in scoring at your request.";
  const before = pref.adjustment ? ` (before your adjustment: ${signed(pref.unadjustedLean)})` : "";
  return `Lean used in scoring now: ${signed(pref.lean)}${before}.`;
}

function renderPatterns() {
  const patterns = suggestPatterns(state.profile, state.catalog);
  const shown = new Set(patterns.map((p) => p.feature));
  const items = patterns.map((p) => {
    const rated = p.supporting.length + p.conflicting.length;
    return el("li", { className: `pattern pattern-${p.confidence}` },
      el("p", { className: "pattern-claim" }, ...patternClaim(p)),
      p.definition ? el("p", { className: "pattern-definition" }, `Catalog definition: ${p.definition}`) : null,
      el("p", {}, `Based on ${rated} rated show${rated === 1 ? "" : "s"} with this feature.`),
      el("p", {}, el("strong", {}, "Supporting: "), examplesText(p.supporting) || "none"),
      el("p", {}, el("strong", {}, "Conflicting: "), p.conflicting.length ? examplesText(p.conflicting) : "none so far"),
      adjustmentButtons(p.feature, p.label),
      el("p", { className: "pattern-effect" }, scoringNow(p.feature)),
    );
  });
  $("#pattern-list").replaceChildren(...items);
  if (items.length === 0) {
    $("#pattern-list").append(el("li", { className: "pattern" }, "No patterns yet: a feature needs at least two rated shows before it appears here. Rate a few more shows you remember well."));
  }

  // Adjustments for features not in the list above, so they can still be changed or removed.
  const others = Object.keys(state.profile.adjustments).filter((f) => !shown.has(f)).sort();
  $("#other-adjustments").replaceChildren(...(others.length === 0 ? [] : [
    el("h4", {}, "Your other adjustments"),
    el("ul", { className: "pattern-list" }, ...others.map((feature) => {
      const { label } = describeFeature(feature, state.catalog);
      return el("li", { className: "pattern" },
        el("p", { className: "pattern-claim" }, el("strong", {}, label)),
        adjustmentButtons(feature, label),
        el("p", { className: "pattern-effect" }, scoringNow(feature)));
    })),
  ]));
  $("#clear-adjustments").disabled = Object.keys(state.profile.adjustments).length === 0;
}

// Change one adjustment, re-score, and say what changed in the top picks.
function setAdjustment(feature, value) {
  const before = state.rec.picks.map((p) => p.show);
  if (value === "learned") delete state.profile.adjustments[feature];
  else state.profile.adjustments[feature] = value;
  persist();
  computeRecommendations();
  renderRecommendations();

  const { label } = describeFeature(feature, state.catalog);
  const action = value === "learned" ? `${label} back to As learned` : `${ADJUSTMENT_LABELS[value]}: ${label}`;
  $("#adjust-effect").textContent = `${action}. ${describePickChanges(before, state.rec.picks.map((p) => p.show))}`;
  document.querySelector(`[data-adjust-feature="${CSS.escape(feature)}"][data-adjust-value="${value}"]`)?.focus();
}

function describePickChanges(before, after) {
  const beforeIds = new Set(before.map((s) => s.id));
  const afterIds = new Set(after.map((s) => s.id));
  const added = after.filter((s) => !beforeIds.has(s.id)).map((s) => s.title);
  const dropped = before.filter((s) => !afterIds.has(s.id)).map((s) => s.title);
  if (added.length === 0 && dropped.length === 0) return "Top picks: same shows (scores and order may have changed).";
  return `Top picks: ${added.length} new (${added.join(", ") || "none"}); ${dropped.length} dropped (${dropped.join(", ") || "none"}).`;
}

async function clearAdjustments() {
  const ok = await confirmChoice({
    title: "Clear all adjustments?",
    text: "Every feature goes back to As learned. Your viewing history, ratings, and survey answers stay exactly as they are.",
    confirm: "Clear adjustments",
    cancel: "Keep them",
  });
  if (!ok) return;
  const before = state.rec.picks.map((p) => p.show);
  state.profile.adjustments = {};
  persist();
  computeRecommendations();
  renderRecommendations();
  $("#adjust-effect").textContent = `All adjustments cleared. ${describePickChanges(before, state.rec.picks.map((p) => p.show))}`;
}

// --- Taste survey -------------------------------------------------------------

function renderSurvey() {
  const answers = state.profile.survey;
  const fieldsets = SURVEY_QUESTIONS.map((q, index) => el("fieldset", { className: "panel survey-question" },
    el("legend", {}, `${index + 1}. ${q.text}`),
    q.help ? el("p", { className: "survey-help" }, q.help) : null,
    el("div", { className: "survey-options" }, ...q.options.map((o) => el("label", { className: "survey-option" },
      el("input", { type: "radio", name: `survey-${q.id}`, value: o.value, checked: answers[q.id] === o.value, dataset: { question: q.id } }),
      ` ${o.label}`))),
    el("button", { type: "button", className: "button-secondary survey-clear", dataset: { clearQuestion: q.id }, disabled: !(q.id in answers) }, "Skip / clear this answer"),
  ));
  $("#survey-form").replaceChildren(...fieldsets);
  renderSurveyProgress();
}

function renderSurveyProgress() {
  const answered = Object.keys(state.profile.survey).length;
  const preferences = countSurveyPreferences(state.profile.survey);
  $("#survey-progress").textContent = answered === 0
    ? `No answers yet. All ${SURVEY_QUESTIONS.length} questions are optional.`
    : `${answered} of ${SURVEY_QUESTIONS.length} answered (${preferences} with a preference, ${answered - preferences} neutral).`;
  $("#survey-reset").disabled = answered === 0;
}

function setSurveyAnswer(questionId, value) {
  if (value === null) delete state.profile.survey[questionId];
  else state.profile.survey[questionId] = value;
  persist();
  const clear = document.querySelector(`[data-clear-question="${questionId}"]`);
  if (clear) clear.disabled = value === null;
  if (value === null) {
    for (const radio of document.querySelectorAll(`input[name="survey-${questionId}"]`)) radio.checked = false;
  }
  renderSurveyProgress();
}

async function resetSurvey() {
  const ok = await confirmChoice({
    title: "Reset all survey answers?",
    text: "Your survey answers will be cleared. Your viewing history and ratings stay exactly as they are.",
    confirm: "Reset survey answers",
    cancel: "Keep my answers",
  });
  if (!ok) return;
  state.profile.survey = {};
  persist();
  renderSurvey();
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

// Premiere date when the catalog has one, otherwise the start year
// ("1995" sorts before "1995-03-01", so it counts as the start of that year).
function premiereKey(show) {
  return show.premiere_date ?? String(show.years.start ?? "");
}

// Title for alphabetical order, without a leading "The", "A", or "An".
function sortTitle(show) {
  return show.title.replace(/^(the|a|an)\s+/i, "");
}

const SORTERS = {
  newest: (a, b) => premiereKey(b).localeCompare(premiereKey(a)) || a.title.localeCompare(b.title, "en"),
  oldest: (a, b) => premiereKey(a).localeCompare(premiereKey(b)) || a.title.localeCompare(b.title, "en"),
  title: (a, b) => sortTitle(a).localeCompare(sortTitle(b), "en", { sensitivity: "base", numeric: true }) || a.id.localeCompare(b.id),
};

// Shows matching the filters, in the chosen order. Sorting a copy leaves the
// catalog's own order untouched.
function visibleShows() {
  const filters = currentFilters();
  const sorter = SORTERS[$("#sort-order").value] ?? SORTERS.newest;
  return state.catalog.shows.filter((show) => matchesFilters(show, filters)).sort(sorter);
}

function renderList() {
  if (state.mode === "survey") {
    renderSurvey();
    return;
  }
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
    el("p", {}, el("strong", {}, `"${file.name}" looks good: ${incoming.seen} Seen (${incoming.rated} rated), ${incoming.not_seen} Not seen, ` +
      `${Object.keys(result.profile.survey).length} survey answer(s), ${Object.keys(result.profile.adjustments).length} adjustment(s).`)),
    el("ul", { hidden: result.warnings.length === 0 }, ...result.warnings.map((w) => el("li", {}, w))),
    el("p", {}, "Choose how to use it. Nothing changes until you pick one:"),
    el("ul", {},
      el("li", {}, el("strong", {}, "Replace: "), `your current ${currentTotal} recorded show(s), survey answers, and adjustments are removed, and the ${incomingTotal} show(s), survey answers, and adjustments from the file are used instead.`),
      el("li", {}, el("strong", {}, "Merge: "), `shows, survey answers, and adjustments from the file are added to yours. Where both record the same show differently (${conflicts} show(s)), answer the same question, or adjust the same feature, the file wins. Everything else of yours stays.`),
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
  $("#catalog-view").hidden = mode === "recommend" || mode === "survey";
  $("#recommend-view").hidden = mode !== "recommend";
  $("#survey-view").hidden = mode !== "survey";
  if (mode === "survey") {
    renderSurvey();
    return;
  }
  if (mode === "recommend") computeRecommendations();
  renderList();
}

function wireEvents() {
  $("#filters").addEventListener("input", renderList);
  $("#filters").addEventListener("submit", (event) => event.preventDefault());
  // A reset changes the fields after this event fires, so re-render on the next tick.
  $("#filters").addEventListener("reset", () => setTimeout(renderList));
  $("#empty-clear").addEventListener("click", () => $("#filters").reset());
  $("#sort-order").addEventListener("change", renderList);

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
  $("#survey-form").addEventListener("change", (event) => {
    const radio = event.target.closest("input[data-question]");
    if (radio) setSurveyAnswer(radio.dataset.question, radio.value);
  });
  $("#survey-form").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-clear-question]");
    if (button) setSurveyAnswer(button.dataset.clearQuestion, null);
  });
  $("#survey-form").addEventListener("submit", (event) => event.preventDefault());
  $("#survey-reset").addEventListener("click", resetSurvey);
  $("#patterns").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-adjust-feature]");
    if (button) setAdjustment(button.dataset.adjustFeature, button.dataset.adjustValue);
  });
  $("#clear-adjustments").addEventListener("click", clearAdjustments);
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
