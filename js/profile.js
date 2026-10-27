// Personal profile: your viewing history and ratings, kept separate from catalog.json.
// The profile lives in the browser's localStorage and can be exported to a
// JSON backup file. Nothing here ever writes to the catalog.
//
// Version 4 data model. Each show you have recorded gets one entry:
//   shows: { "cheers-1982": { status: "seen", rating: "yes" },
//            "taxi-1978":   { status: "seen" },             // seen, no rating
//            "soap-1977":   { status: "not_seen" } }
//   survey: { "animation": "more", "camera": "neutral" }    // optional answers
//   adjustments: { "humor:cringe": "less", "audience:adult": "ignore" }
// A show with no entry has status "unknown". A rating always means "seen".
// Adjustments are your corrections to the recommender ("more", "less", "ignore");
// they never change the catalog's tags.
// Versions 1 (ratings only), 2 (no survey), and 3 (no adjustments) are still read.

const PROFILE_FORMAT = "sitcom-tracker-profile";
const PROFILE_VERSION = 4;
const SUPPORTED_VERSIONS = [1, 2, 3, 4];
const ADJUSTMENTS = ["more", "less", "ignore"];

// The survey questions come from survey.js (a <script> in the browser, require in Node).
const SURVEY = typeof SURVEY_QUESTIONS !== "undefined" ? { SURVEY_QUESTIONS, surveyOption } : require("./survey.js");
const STORAGE_KEY = "sitcomTracker.profile";

const STATUSES = {
  unknown: { label: "Unknown", meaning: "Not recorded yet" },
  seen: { label: "Seen", meaning: "I've watched it" },
  not_seen: { label: "Not seen", meaning: "I haven't watched it" },
};

// The three optional enjoyment ratings and what they mean.
const RATINGS = {
  yes: { label: "Yes", meaning: "I liked it" },
  meh: { label: "Meh", meaning: "It was okay" },
  no: { label: "No", meaning: "I didn't like it" },
};

function emptyProfile() {
  return { format: PROFILE_FORMAT, version: PROFILE_VERSION, shows: {}, survey: {}, adjustments: {} };
}

function getStatus(profile, id) {
  return profile.shows[id]?.status ?? "unknown";
}

function getRating(profile, id) {
  return profile.shows[id]?.rating ?? null;
}

// Store one show's entry, keeping the rules in one place:
// a rating marks the show Seen, and Unknown with no rating means "no entry".
function setEntry(profile, id, status, rating = null) {
  if (rating) status = "seen";
  if (status === "unknown") {
    delete profile.shows[id];
  } else {
    profile.shows[id] = rating ? { status, rating } : { status };
  }
}

// Translate any show ID (current or former) to the catalog's current ID,
// using the catalog's id_aliases table. Returns null for unknown IDs.
function resolveShowId(id, catalog) {
  if (typeof id !== "string") return null;
  const canonical = catalog.id_aliases[id] ?? id;
  return catalog.showsById.has(canonical) ? canonical : null;
}

// Turn the entries of a version 1 or 2 file into a list of
// [rawId, status, rating] rows, or a string describing what is wrong.
function readEntries(data) {
  if (data.version === 1) {
    if (!isPlainObject(data.ratings)) return "The backup has no \"ratings\" object.";
    // Version 1 only recorded ratings, and every rating means the show was seen.
    return Object.entries(data.ratings).map(([id, rating]) => [id, "seen", rating]);
  }
  if (!isPlainObject(data.shows)) return "The backup has no \"shows\" object.";
  return Object.entries(data.shows).map(([id, entry]) =>
    isPlainObject(entry) ? [id, entry.status, entry.rating ?? null] : [id, undefined, null]);
}

// Is "category:value" a feature the recommender can use with this catalog?
function isKnownFeature(feature, catalog) {
  if (typeof feature !== "string") return false;
  const [category, value] = feature.split(":");
  if (category === "kind" || category === "medium") return catalog.shows.some((show) => show[category] === value);
  return Boolean(catalog.vocabulary[category]?.[value]);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Check a parsed JSON object (from storage or an import file) before using it.
// Returns { ok, errors, warnings, profile, sourceVersion }. The input is never
// modified, and nothing is saved here: the caller decides what to do.
function validateProfileData(data, catalog) {
  const warnings = [];
  if (!isPlainObject(data)) {
    return { ok: false, errors: ["The file does not contain a JSON object."], warnings };
  }

  const errors = [];
  if (data.format !== PROFILE_FORMAT) {
    errors.push(`This is not a Sitcom Tracker backup (expected format "${PROFILE_FORMAT}").`);
  }
  if (!SUPPORTED_VERSIONS.includes(data.version)) {
    errors.push(`Unsupported backup version: ${JSON.stringify(data.version)}. This page reads versions ${SUPPORTED_VERSIONS.join(" and ")}.`);
  }
  if (errors.length > 0) return { ok: false, errors, warnings };

  const rows = readEntries(data);
  if (typeof rows === "string") return { ok: false, errors: [rows], warnings };

  const profile = emptyProfile();
  const unknownIds = [];
  const invalid = [];
  let renamed = 0;

  for (const [rawId, status, rating] of rows) {
    const validStatus = status === "seen" || status === "not_seen";
    const validRating = rating === null || rating in RATINGS;
    // A rating on a show marked Not seen contradicts itself, so it is not guessed at.
    if (!validStatus || !validRating || (rating && status !== "seen")) {
      invalid.push(rawId);
      continue;
    }
    const id = resolveShowId(rawId, catalog);
    if (id === null) {
      unknownIds.push(rawId);
      continue;
    }
    if (id !== rawId) renamed++;
    setEntry(profile, id, status, rating);
  }

  // Survey answers exist from version 3. Unknown questions or answers are skipped.
  let skippedAnswers = 0;
  if (data.version >= 3 && data.survey !== undefined) {
    if (!isPlainObject(data.survey)) return { ok: false, errors: ["The backup's \"survey\" is not an object."], warnings };
    for (const [questionId, value] of Object.entries(data.survey)) {
      if (SURVEY.surveyOption(questionId, value)) profile.survey[questionId] = value;
      else skippedAnswers++;
    }
  }

  // Adjustments exist from version 4. Unknown features or values are skipped.
  let skippedAdjustments = 0;
  if (data.version >= 4 && data.adjustments !== undefined) {
    if (!isPlainObject(data.adjustments)) return { ok: false, errors: ["The backup's \"adjustments\" is not an object."], warnings };
    for (const [feature, value] of Object.entries(data.adjustments)) {
      if (isKnownFeature(feature, catalog) && ADJUSTMENTS.includes(value)) profile.adjustments[feature] = value;
      else skippedAdjustments++;
    }
  }

  if (data.version === 1) warnings.push("This is a version 1 backup (ratings only). Each rated show will be recorded as Seen with its rating.");
  if (data.version === 2) warnings.push("This is a version 2 backup, from before the taste survey. It has no survey answers.");
  if (data.version === 3) warnings.push("This is a version 3 backup, from before recommendation adjustments. It has none.");
  if (skippedAdjustments > 0) warnings.push(`${skippedAdjustments} recommendation adjustment(s) didn't match this catalog's features and will be skipped.`);
  if (skippedAnswers > 0) warnings.push(`${skippedAnswers} survey answer(s) didn't match the current questions and will be skipped.`);
  if (renamed > 0) warnings.push(`${renamed} former show ID(s) were translated to current IDs.`);
  if (unknownIds.length > 0) warnings.push(`${unknownIds.length} show ID(s) are not in this catalog and will be skipped: ${listSome(unknownIds)}`);
  if (invalid.length > 0) warnings.push(`${invalid.length} entr${invalid.length === 1 ? "y has" : "ies have"} an unrecognized or contradictory value and will be skipped: ${listSome(invalid)}`);

  return { ok: true, errors, warnings, profile, sourceVersion: data.version };
}

function listSome(items) {
  return items.slice(0, 5).join(", ") + (items.length > 5 ? ", …" : "");
}

// Combine two profiles. Where both have an entry for a show, an answer to a
// survey question, or an adjustment for a feature, `incoming` wins.
function mergeProfiles(current, incoming) {
  const merged = emptyProfile();
  Object.assign(merged.shows, structuredClone(current.shows), structuredClone(incoming.shows));
  Object.assign(merged.survey, current.survey, incoming.survey);
  Object.assign(merged.adjustments, current.adjustments, incoming.adjustments);
  return merged;
}

function countEntries(profile) {
  const counts = { seen: 0, not_seen: 0, rated: 0, yes: 0, meh: 0, no: 0 };
  for (const entry of Object.values(profile.shows)) {
    counts[entry.status]++;
    if (entry.rating) {
      counts.rated++;
      counts[entry.rating]++;
    }
  }
  return counts;
}

// --- Browser storage ------------------------------------------------------
// localStorage can be unavailable (private windows, blocked site data), so
// every access is wrapped in try/catch and reports success or failure.

function loadStoredProfile(catalog) {
  let text;
  try {
    text = localStorage.getItem(STORAGE_KEY);
  } catch {
    return { profile: emptyProfile(), problem: "Browser storage is unavailable, so your history will not be kept after you leave. Export a backup to keep it." };
  }
  if (text === null) return { profile: emptyProfile(), problem: null };

  let result = null;
  try {
    result = validateProfileData(JSON.parse(text), catalog);
  } catch {
    // Not JSON; handled below.
  }

  if (result?.ok) {
    if (result.sourceVersion !== PROFILE_VERSION) {
      // Upgrade once: keep the old text as a safety copy, then save the new format.
      try {
        localStorage.setItem(`${STORAGE_KEY}.v${result.sourceVersion}-backup`, text);
      } catch {
        // The upgraded data is still used for this visit.
      }
      saveStoredProfile(result.profile);
    }
    return { profile: result.profile, problem: null };
  }

  // Keep a copy of the unreadable data before anything overwrites it.
  try {
    localStorage.setItem(STORAGE_KEY + ".unreadable", text);
  } catch {
    // Nothing more we can do.
  }
  return { profile: emptyProfile(), problem: `Saved data in this browser could not be read, so the tracker started empty. A copy was kept in browser storage under "${STORAGE_KEY}.unreadable".` };
}

function saveStoredProfile(profile) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    return true;
  } catch {
    return false;
  }
}

// The object written to a backup file.
function makeBackup(profile, catalog) {
  return {
    format: PROFILE_FORMAT,
    version: PROFILE_VERSION,
    exported_at: new Date().toISOString(),
    catalog_version: catalog.meta.version,
    shows: structuredClone(profile.shows),
    survey: { ...profile.survey },
    adjustments: { ...profile.adjustments },
  };
}

// Let Node.js test scripts use these functions too (ignored by browsers).
if (typeof module !== "undefined") {
  module.exports = {
    PROFILE_VERSION, STATUSES, RATINGS, ADJUSTMENTS, emptyProfile, isKnownFeature, getStatus, getRating, setEntry,
    resolveShowId, validateProfileData, mergeProfiles, countEntries, makeBackup,
  };
}
