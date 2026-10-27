// Checks for personal-profile rules and backup migration.
// Run from the repository folder with:  node tests/profile-tests.js
// These tests are for development only; the web page does not load them.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const P = require("../js/profile.js");

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "catalog.json"), "utf8"));
catalog.showsById = new Map(catalog.shows.map((show) => [show.id, show]));

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

test("a new profile has every show Unknown", () => {
  const p = P.emptyProfile();
  assert.equal(P.getStatus(p, "cheers-1982"), "unknown");
  assert.equal(P.getRating(p, "cheers-1982"), null);
});

test("giving a rating marks the show Seen", () => {
  const p = P.emptyProfile();
  P.setEntry(p, "cheers-1982", "unknown", "yes");
  assert.deepEqual(p.shows["cheers-1982"], { status: "seen", rating: "yes" });
});

test("Seen does not require a rating (too long ago to judge)", () => {
  const p = P.emptyProfile();
  P.setEntry(p, "taxi-1978", "seen");
  assert.deepEqual(p.shows["taxi-1978"], { status: "seen" });
});

test("Not seen is stored and stays distinct from Unknown", () => {
  const p = P.emptyProfile();
  P.setEntry(p, "soap-1977", "not_seen");
  assert.equal(P.getStatus(p, "soap-1977"), "not_seen");
  P.setEntry(p, "soap-1977", "unknown");
  assert.equal(P.getStatus(p, "soap-1977"), "unknown");
  assert.equal("soap-1977" in p.shows, false);
});

test("a version 1 backup migrates: every rating becomes Seen + rating", () => {
  const v1 = { format: "sitcom-tracker-profile", version: 1, ratings: { "cheers-1982": "yes", "taxi-1978": "meh", "soap-1977": "no" } };
  const r = P.validateProfileData(v1, catalog);
  assert.equal(r.ok, true);
  assert.equal(r.sourceVersion, 1);
  assert.deepEqual(r.profile.shows, {
    "cheers-1982": { status: "seen", rating: "yes" },
    "taxi-1978": { status: "seen", rating: "meh" },
    "soap-1977": { status: "seen", rating: "no" },
  });
  assert.equal(r.profile.version, P.PROFILE_VERSION);
});

test("former IDs are translated with id_aliases", () => {
  const v1 = { format: "sitcom-tracker-profile", version: 1, ratings: { tt0083399: "yes" } };
  const r = P.validateProfileData(v1, catalog);
  assert.deepEqual(r.profile.shows, { "cheers-1982": { status: "seen", rating: "yes" } });
});

test("a version 2 backup round-trips through export", () => {
  const p = P.emptyProfile();
  P.setEntry(p, "cheers-1982", "seen", "yes");
  P.setEntry(p, "taxi-1978", "seen");
  P.setEntry(p, "soap-1977", "not_seen");
  const backup = JSON.parse(JSON.stringify(P.makeBackup(p, catalog)));
  const r = P.validateProfileData(backup, catalog);
  assert.equal(r.ok, true);
  assert.deepEqual(r.profile.shows, p.shows);
});

test("contradictory or unknown entries are skipped and reported, not guessed", () => {
  const v2 = {
    format: "sitcom-tracker-profile", version: 2, shows: {
      "cheers-1982": { status: "not_seen", rating: "yes" }, // contradiction
      "taxi-1978": { status: "maybe" },                     // bad status
      "made-up-show": { status: "seen" },                   // not in catalog
      "soap-1977": { status: "seen", rating: "no" },        // fine
    },
  };
  const r = P.validateProfileData(v2, catalog);
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.profile.shows), ["soap-1977"]);
  assert.ok(r.warnings.some((w) => w.includes("not in this catalog")));
  assert.ok(r.warnings.some((w) => w.includes("contradictory")));
});

test("wrong format or version is rejected without a profile", () => {
  assert.equal(P.validateProfileData({ format: "other", version: 2, shows: {} }, catalog).ok, false);
  assert.equal(P.validateProfileData({ format: "sitcom-tracker-profile", version: 99, shows: {} }, catalog).ok, false);
  assert.equal(P.validateProfileData([], catalog).ok, false);
});

test("merge keeps both sides and lets the imported entry win on conflicts", () => {
  const a = P.emptyProfile();
  P.setEntry(a, "cheers-1982", "seen", "yes");
  P.setEntry(a, "taxi-1978", "not_seen");
  const b = P.emptyProfile();
  P.setEntry(b, "taxi-1978", "seen", "meh");
  P.setEntry(b, "soap-1977", "seen");
  const m = P.mergeProfiles(a, b);
  assert.deepEqual(m.shows, {
    "cheers-1982": { status: "seen", rating: "yes" },
    "taxi-1978": { status: "seen", rating: "meh" },
    "soap-1977": { status: "seen" },
  });
});

test("counts separate seen, rated, and not seen", () => {
  const p = P.emptyProfile();
  P.setEntry(p, "cheers-1982", "seen", "yes");
  P.setEntry(p, "taxi-1978", "seen");
  P.setEntry(p, "soap-1977", "not_seen");
  assert.deepEqual(P.countEntries(p), { seen: 2, not_seen: 1, rated: 1, yes: 1, meh: 0, no: 0 });
});

test("a version 3 backup round-trips survey answers", () => {
  const p = P.emptyProfile();
  P.setEntry(p, "cheers-1982", "seen", "yes");
  p.survey = { animation: "more", camera: "neutral" };
  const r = P.validateProfileData(JSON.parse(JSON.stringify(P.makeBackup(p, catalog))), catalog);
  assert.equal(r.ok, true);
  assert.deepEqual(r.profile.survey, { animation: "more", camera: "neutral" });
  assert.deepEqual(r.profile.shows, p.shows);
});

test("version 1 and 2 backups import with an empty survey", () => {
  const v1 = P.validateProfileData({ format: "sitcom-tracker-profile", version: 1, ratings: { "cheers-1982": "yes" } }, catalog);
  const v2 = P.validateProfileData({ format: "sitcom-tracker-profile", version: 2, shows: { "taxi-1978": { status: "seen" } } }, catalog);
  assert.deepEqual(v1.profile.survey, {});
  assert.deepEqual(v2.profile.survey, {});
  assert.equal(v2.profile.version, 3);
});

test("unknown survey questions or answers are skipped and reported", () => {
  const r = P.validateProfileData({
    format: "sitcom-tracker-profile", version: 3, shows: {},
    survey: { animation: "more", camera: "sideways", "made-up": "more" },
  }, catalog);
  assert.deepEqual(r.profile.survey, { animation: "more" });
  assert.ok(r.warnings.some((w) => w.includes("2 survey answer")));
});

test("merge combines survey answers, imported answers winning", () => {
  const a = P.emptyProfile();
  a.survey = { animation: "more", cringe: "less" };
  const b = P.emptyProfile();
  b.survey = { cringe: "more" };
  assert.deepEqual(P.mergeProfiles(a, b).survey, { animation: "more", cringe: "more" });
});

console.log(`\n${passed} profile tests passed.`);
