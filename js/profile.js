// Personal profile: your ratings, kept separate from catalog.json.
// The profile lives in the browser's localStorage and can be exported to a
// JSON backup file. Nothing here ever writes to the catalog.

const PROFILE_FORMAT = "sitcom-tracker-profile";
const PROFILE_VERSION = 1;
const STORAGE_KEY = "sitcomTracker.profile";

// The three optional enjoyment ratings and what they mean.
const RATINGS = {
  yes: { label: "Yes", meaning: "I liked it" },
  meh: { label: "Meh", meaning: "It was okay" },
  no: { label: "No", meaning: "I didn't like it" },
};

function emptyProfile() {
  return { format: PROFILE_FORMAT, version: PROFILE_VERSION, ratings: {} };
}

// Translate any show ID (current or former) to the catalog's current ID,
// using the catalog's id_aliases table. Returns null for unknown IDs.
function resolveShowId(id, catalog) {
  if (typeof id !== "string") return null;
  const canonical = catalog.id_aliases[id] ?? id;
  return catalog.showsById.has(canonical) ? canonical : null;
}

// Check a parsed JSON object (from storage or an import file) before using it.
// Returns { ok, errors, warnings, profile }. The input is never modified, and
// nothing is saved here: the caller decides what to do with the result.
function validateProfileData(data, catalog) {
  const errors = [];
  const warnings = [];

  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, errors: ["The file does not contain a JSON object."], warnings };
  }
  if (data.format !== PROFILE_FORMAT) {
    errors.push(`This is not a Sitcom Tracker backup (expected format "${PROFILE_FORMAT}").`);
  }
  if (data.version !== PROFILE_VERSION) {
    errors.push(`Unsupported backup version: ${JSON.stringify(data.version)}. This page reads version ${PROFILE_VERSION}.`);
  }
  if (data.ratings === null || typeof data.ratings !== "object" || Array.isArray(data.ratings)) {
    errors.push("The backup has no \"ratings\" object.");
  }
  if (errors.length > 0) return { ok: false, errors, warnings };

  const profile = emptyProfile();
  const unknownIds = [];
  const badValues = [];
  let renamed = 0;

  for (const [rawId, rating] of Object.entries(data.ratings)) {
    if (!(rating in RATINGS)) {
      badValues.push(rawId);
      continue;
    }
    const id = resolveShowId(rawId, catalog);
    if (id === null) {
      unknownIds.push(rawId);
      continue;
    }
    if (id !== rawId) renamed++;
    profile.ratings[id] = rating;
  }

  if (renamed > 0) warnings.push(`${renamed} former show ID(s) were translated to current IDs.`);
  if (unknownIds.length > 0) warnings.push(`${unknownIds.length} show ID(s) are not in this catalog and will be skipped: ${unknownIds.slice(0, 5).join(", ")}${unknownIds.length > 5 ? ", …" : ""}`);
  if (badValues.length > 0) warnings.push(`${badValues.length} rating(s) had an unrecognized value and will be skipped.`);

  return { ok: true, errors, warnings, profile };
}

// Combine two profiles. Ratings from `incoming` win where both have one.
function mergeProfiles(current, incoming) {
  const merged = emptyProfile();
  Object.assign(merged.ratings, current.ratings, incoming.ratings);
  return merged;
}

// --- Browser storage ------------------------------------------------------
// localStorage can be unavailable (private windows, blocked site data), so
// every access is wrapped in try/catch and reports success or failure.

function loadStoredProfile(catalog) {
  let text;
  try {
    text = localStorage.getItem(STORAGE_KEY);
  } catch {
    return { profile: emptyProfile(), problem: "Browser storage is unavailable, so ratings will not be kept after you leave. Export a backup to keep them." };
  }
  if (text === null) return { profile: emptyProfile(), problem: null };

  try {
    const result = validateProfileData(JSON.parse(text), catalog);
    if (result.ok) return { profile: result.profile, problem: null };
  } catch {
    // Fall through to the message below.
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
    ratings: { ...profile.ratings },
  };
}
