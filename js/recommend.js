// Recommendations: a simple, deterministic scoring method you can inspect.
// See SCORING.md for a plain-language description.
//
// 1. Each show is described by "features": its catalog tags (humor, tone,
//    setting, themes, devices, cast, format, structure, audience, content)
//    plus its kind and medium.
// 2. Your ratings teach a "lean" for each feature: shows you liked push the
//    feature up, shows you didn't like push it down, Meh nudges it down a little.
//    Taste-survey answers add a smaller nudge to the features they name.
// 3. A candidate's score is the average lean of its features.
// Awards and reputation decide which shows are eligible, never the score.

const SCORING_VERSION = "survey-1";

// The survey questions come from survey.js (a <script> in the browser, require in Node).
const SURVEY_DEFS = typeof SURVEY_QUESTIONS !== "undefined" ? { surveyOption, countSurveyPreferences } : require("./survey.js");

// How much one rating moves the lean of each feature of that show.
const RATING_WEIGHTS = { yes: 1, meh: -0.25, no: -1 };

// Leans are divided by (number of rated shows with the feature + SHRINKAGE),
// so a feature backed by one show counts for less than one backed by many.
const SHRINKAGE = 2;

// How far one survey answer moves each feature it names. One Yes rating moves a
// feature by 1 / (1 + 2) = 0.33, so a single rated show outweighs a survey answer.
const SURVEY_STRENGTH = 0.2;

// Minimum evidence before personal recommendations are shown.
const MIN_RATED = 3;
const MIN_LIKED = 1;
const MIN_SURVEY_PREFERENCES = 3; // non-neutral answers that can stand in for ratings
const FEW_RATINGS = 10; // below this, results are labeled as rough

const PICK_LIMIT = 10;
const DISCOVERY_LIMIT = 50;

// Tag categories used for scoring, in display order.
const FEATURE_CATEGORIES = ["humor", "tone", "setting", "themes", "devices", "cast", "format", "structure", "audience", "content"];

// "Not applicable" is a placeholder, not a description of the show.
const IGNORED_FEATURES = new Set(["format:not-applicable"]);

const CATEGORY_LABELS = {
  kind: "Kind", medium: "Medium", humor: "Humor", tone: "Tone", setting: "Setting",
  themes: "Theme", devices: "Device", cast: "Cast", format: "Format",
  structure: "Structure", audience: "Audience", content: "Content",
};

// What each qualification status means, for explaining eligibility.
const QUALIFICATION_LABELS = {
  documented_award_recognition: "documented award recognition",
  sourced_recognition_snapshot: "a sourced recognition snapshot (award, ratings rank, or critics score)",
  audience_snapshot_threshold: "a historical audience-score threshold",
  needs_reputation_evidence: "still needs reputation evidence",
};

// All scoring features of a show, as "category:value" keys.
function showFeatures(show) {
  const features = [`kind:${show.kind}`, `medium:${show.medium}`];
  for (const category of FEATURE_CATEGORIES) {
    const value = show.tags[category];
    for (const v of Array.isArray(value) ? value : [value]) {
      if (v) features.push(`${category}:${v}`);
    }
  }
  return features.filter((f) => !IGNORED_FEATURES.has(f));
}

// Human-readable name and definition of a feature, from the catalog vocabulary.
function describeFeature(feature, catalog) {
  const [category, value] = feature.split(":");
  return {
    category,
    label: `${CATEGORY_LABELS[category] ?? category}: ${value.replaceAll("-", " ")}`,
    definition: catalog.vocabulary[category]?.[value] ?? "",
  };
}

// Learn a lean for every feature that appears in a rated show or a survey answer.
// Returns a Map: feature -> { lean, ratingLean, surveyLean, examples: [{ id, rating }],
//                             answers: [{ questionId, label, direction }] }
// With useSurvey false, survey answers are ignored (the baseline-1 method).
function learnPreferences(profile, catalog, useSurvey = true) {
  const totals = new Map();
  for (const [id, entry] of Object.entries(profile.shows)) {
    if (!entry.rating) continue;
    const show = catalog.showsById.get(id);
    if (!show) continue;
    for (const feature of showFeatures(show)) {
      if (!totals.has(feature)) totals.set(feature, { sum: 0, examples: [] });
      const t = totals.get(feature);
      t.sum += RATING_WEIGHTS[entry.rating];
      t.examples.push({ id, rating: entry.rating });
    }
  }
  const prefs = new Map();
  for (const [feature, { sum, examples }] of totals) {
    const ratingLean = sum / (examples.length + SHRINKAGE);
    prefs.set(feature, { lean: ratingLean, ratingLean, surveyLean: 0, examples, answers: [] });
  }
  if (!useSurvey) return prefs;

  for (const [questionId, value] of Object.entries(profile.survey ?? {})) {
    const option = SURVEY_DEFS.surveyOption(questionId, value);
    if (!option) continue;
    for (const [feature, direction] of Object.entries(option.effects)) {
      if (!prefs.has(feature)) prefs.set(feature, { lean: 0, ratingLean: 0, surveyLean: 0, examples: [], answers: [] });
      const pref = prefs.get(feature);
      pref.surveyLean += direction * SURVEY_STRENGTH;
      pref.lean = pref.ratingLean + pref.surveyLean;
      pref.answers.push({ questionId, label: option.label, direction });
    }
  }
  return prefs;
}

// Score one show: the average lean of its features (unknown features count as 0).
function scoreShow(show, prefs) {
  const features = showFeatures(show);
  const contributions = features.map((feature) => ({ feature, lean: prefs.get(feature)?.lean ?? 0 }));
  const total = contributions.reduce((sum, c) => sum + c.lean, 0);
  return { score: total / features.length, featureCount: features.length, contributions };
}

// Higher score first; ties broken by title, then ID, so results never shuffle.
function compareScored(a, b) {
  return b.score - a.score || a.show.title.localeCompare(b.show.title, "en") || a.show.id.localeCompare(b.show.id);
}

function summarizeEvidence(profile, useSurvey = true) {
  let rated = 0;
  let liked = 0;
  for (const entry of Object.values(profile.shows)) {
    if (entry.rating) rated++;
    if (entry.rating === "yes") liked++;
  }
  const surveyPreferences = useSurvey ? SURVEY_DEFS.countSurveyPreferences(profile.survey ?? {}) : 0;
  const fromRatings = rated >= MIN_RATED && liked >= MIN_LIKED;
  const fromSurvey = surveyPreferences >= MIN_SURVEY_PREFERENCES;
  const enough = fromRatings || fromSurvey;
  return {
    rated, liked, surveyPreferences, enough,
    surveyOnly: enough && !fromRatings, // picks rest mainly on broad survey answers
    rough: enough && rated < FEW_RATINGS,
  };
}

// Build recommendations.
// options.includeUnknown: also consider shows whose status is Unknown.
// options.includeReviewCandidates: widen the pool beyond the catalog's default.
// options.useSurvey: false reproduces the baseline-1 results (ratings only).
function recommend(catalog, profile, options = {}) {
  const useSurvey = options.useSurvey ?? true;
  const evidence = summarizeEvidence(profile, useSurvey);
  const prefs = learnPreferences(profile, catalog, useSurvey);

  const poolIds = new Set(catalog.views.documented_selection.show_ids);
  if (options.includeReviewCandidates) {
    for (const id of catalog.views.reputation_review_candidates.show_ids) poolIds.add(id);
  }

  // Every eligible show is scored; nothing is sampled.
  const scored = [];
  const counts = { pool: poolIds.size, seen: 0, notSeen: 0, unknown: 0 };
  for (const show of catalog.shows) {
    if (!poolIds.has(show.id)) continue;
    const status = profile.shows[show.id]?.status ?? "unknown";
    if (status === "seen") {
      counts.seen++;
      continue; // seen shows are never recommended, rated or not
    }
    if (status === "not_seen") counts.notSeen++;
    else counts.unknown++;
    scored.push({ show, status, ...scoreShow(show, prefs) });
  }
  scored.sort(compareScored);

  // Top picks need positive evidence: a negative score is not a recommendation.
  const picks = evidence.enough
    ? scored.filter((s) => s.score > 0 && (s.status === "not_seen" || options.includeUnknown)).slice(0, PICK_LIMIT)
    : [];

  // The discovery list helps you find shows you've already seen. It uses
  // Unknown shows only, ranked by score when there is enough evidence and in
  // catalog (premiere) order otherwise.
  const pickIds = new Set(picks.map((p) => p.show.id));
  const unknownShows = scored.filter((s) => s.status === "unknown" && !pickIds.has(s.show.id));
  const discovery = (evidence.enough ? unknownShows : unknownShows.sort((a, b) => catalog.shows.indexOf(a.show) - catalog.shows.indexOf(b.show)))
    .slice(0, DISCOVERY_LIMIT);

  return { version: useSurvey ? SCORING_VERSION : "baseline-1", evidence, prefs, counts, picks, discovery, eligibleNotSeen: scored.filter((s) => s.status === "not_seen" && s.score > 0).length };
}

// Reasons that come straight from the score: the features adding the most,
// and the feature taking away the most, with the rated shows behind each.
function explain(scoredShow, prefs, catalog) {
  const withEvidence = scoredShow.contributions.filter((c) => prefs.has(c.feature));
  const describe = (c) => ({
    ...describeFeature(c.feature, catalog),
    lean: c.lean,
    examples: prefs.get(c.feature).examples,
    answers: prefs.get(c.feature).answers,
  });
  const positives = withEvidence.filter((c) => c.lean > 0).sort((a, b) => b.lean - a.lean || a.feature.localeCompare(b.feature)).slice(0, 3).map(describe);
  const negatives = withEvidence.filter((c) => c.lean < 0).sort((a, b) => a.lean - b.lean || a.feature.localeCompare(b.feature)).slice(0, 2).map(describe);
  return { positives, negatives, unmatched: scoredShow.featureCount - withEvidence.length };
}

function eligibilityReason(show) {
  const status = show.qualification.status;
  if (status === "needs_reputation_evidence") {
    return "Included because you chose to add shows that still need reputation evidence.";
  }
  return `In the catalog's default recommendation pool because of ${QUALIFICATION_LABELS[status] ?? status}. This makes it eligible; it does not raise its score.`;
}

if (typeof module !== "undefined") {
  module.exports = {
    SCORING_VERSION, RATING_WEIGHTS, SHRINKAGE, SURVEY_STRENGTH, MIN_RATED, MIN_LIKED, MIN_SURVEY_PREFERENCES, PICK_LIMIT, DISCOVERY_LIMIT,
    showFeatures, describeFeature, learnPreferences, scoreShow, recommend, explain, eligibilityReason,
  };
}
