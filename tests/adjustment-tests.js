// Checks for "What your ratings suggest" patterns and More/Less/Ignore adjustments.
// Run from the repository folder with:  node tests/adjustment-tests.js
// These tests are for development only; the web page does not load them.

const assert = require("node:assert/strict");
const P = require("../js/profile.js");
const R = require("../js/recommend.js");
const { catalog, examples, buildProfile } = require("./recommend-tests.js");

// Two extra made-up viewers for this stage.
const contradictory = {
  name: "contradictory",
  description: "Likes some multi-camera workplace and friends sitcoms but dislikes very similar ones.",
  ratings: {
    "cheers-1982": "yes",
    "frasier-1993": "yes",
    "seinfeld-1989": "yes",
    "night-court-1984": "no",
    "wings-1990": "no",
    "mad-about-you-1992": "no",
    "the-office-2005": "yes",
    "parks-and-recreation-2009": "no",
  },
  seen: [],
  survey: {},
};
const fewRatings = {
  name: "few-ratings",
  description: "Only two ratings.",
  ratings: { "cheers-1982": "yes", "taxi-1978": "yes" },
  seen: [],
  survey: {},
};

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const ids = (r) => r.picks.map((p) => p.show.id);

test("example IDs exist", () => {
  for (const ex of [contradictory, fewRatings]) for (const id of Object.keys(ex.ratings)) assert.ok(catalog.showsById.has(id), id);
});

test("patterns need at least two rated shows per feature, and at most eight are shown", () => {
  for (const ex of [...examples, contradictory, fewRatings]) {
    const patterns = R.suggestPatterns(buildProfile(ex), catalog);
    assert.ok(patterns.length <= R.PATTERN_LIMIT);
    for (const p of patterns) assert.ok(p.supporting.length + p.conflicting.length >= R.PATTERN_MIN_EXAMPLES);
  }
});

test("a contradictory profile gets patterns marked mixed, with the conflicting ratings listed", () => {
  const patterns = R.suggestPatterns(buildProfile(contradictory), catalog);
  const mixed = patterns.filter((p) => p.confidence === "mixed");
  assert.ok(mixed.length > 0);
  for (const p of mixed) assert.ok(p.conflicting.length > 0);
});

test("a profile with two ratings only gets slight patterns", () => {
  const patterns = R.suggestPatterns(buildProfile(fewRatings), catalog);
  assert.ok(patterns.length > 0);
  for (const p of patterns) assert.equal(p.confidence, "slight");
});

test("patterns come from ratings only, not survey answers or adjustments", () => {
  const ex = examples[1];
  const plain = buildProfile({ ...ex, survey: {} });
  const extra = buildProfile(ex);
  extra.adjustments = { "humor:cringe": "less" };
  assert.deepEqual(R.suggestPatterns(extra, catalog), R.suggestPatterns(plain, catalog));
});

test("with no adjustments, results equal the survey-1 method", () => {
  for (const ex of examples) {
    const p = buildProfile(ex);
    assert.deepEqual(ids(R.recommend(catalog, p)), ids(R.recommend(catalog, p, { useAdjustments: false })));
  }
});

test("Ignore removes a feature from scores and explanations", () => {
  const p = buildProfile(examples[1]);
  p.adjustments = { "audience:adult": "ignore" };
  const r = R.recommend(catalog, p);
  for (const pick of r.picks) {
    assert.ok(!pick.contributions.some((c) => c.feature === "audience:adult"));
    const why = R.explain(pick, r.prefs, catalog);
    assert.ok(![...why.positives, ...why.negatives].some((f) => f.label === "Audience: adult"));
  }
});

test("More of this makes a feature count for a show; Less makes it count against", () => {
  const p = buildProfile(examples[0]); // warm-family dislikes edgy shows
  p.adjustments = { "tone:edgy": "more", "tone:wholesome": "less" };
  const prefs = R.learnPreferences(p, catalog);
  assert.ok(prefs.get("tone:edgy").lean >= R.ADJUST_STRENGTH);
  assert.ok(prefs.get("tone:wholesome").lean <= -R.ADJUST_STRENGTH);
});

test("More of this raises picks with that feature", () => {
  const p = buildProfile(examples[2]); // workplace-classics
  const count = (r) => r.picks.filter((pick) => R.showFeatures(pick.show).includes("medium:animated")).length;
  const before = count(R.recommend(catalog, p));
  p.adjustments = { "medium:animated": "more" };
  assert.ok(count(R.recommend(catalog, p)) > before);
});

test("adjustments never change the catalog or the rest of the profile", () => {
  const catalogBefore = JSON.stringify(catalog.shows);
  const p = buildProfile(examples[3]);
  const showsBefore = JSON.stringify(p.shows);
  const surveyBefore = JSON.stringify(p.survey);
  p.adjustments = { "medium:animated": "ignore", "humor:absurdist": "less" };
  R.recommend(catalog, p);
  R.suggestPatterns(p, catalog);
  assert.equal(JSON.stringify(catalog.shows), catalogBefore);
  assert.equal(JSON.stringify(p.shows), showsBefore);
  assert.equal(JSON.stringify(p.survey), surveyBefore);
});

test("adjustments round-trip through a backup; unknown features are skipped", () => {
  const p = P.emptyProfile();
  p.adjustments = { "humor:cringe": "less", "medium:animated": "ignore" };
  const backup = JSON.parse(JSON.stringify(P.makeBackup(p, catalog)));
  backup.adjustments["humor:not-a-tag"] = "more";
  backup.adjustments["tone:warm"] = "maybe";
  const r = P.validateProfileData(backup, catalog);
  assert.deepEqual(r.profile.adjustments, { "humor:cringe": "less", "medium:animated": "ignore" });
  assert.ok(r.warnings.some((w) => w.includes("2 recommendation adjustment")));
});

test("older backups import with no adjustments", () => {
  const v3 = P.validateProfileData({ format: "sitcom-tracker-profile", version: 3, shows: {}, survey: { animation: "more" } }, catalog);
  assert.deepEqual(v3.profile.adjustments, {});
  assert.equal(v3.profile.version, 4);
});

console.log(`\n${passed} adjustment tests passed.\n`);

// Report: patterns for the two new profiles, and what one adjustment changes.
for (const ex of [contradictory, fewRatings]) {
  console.log(`== ${ex.name}: ${ex.description}`);
  for (const p of R.suggestPatterns(buildProfile(ex), catalog)) {
    const titles = (list) => list.map((e) => `${catalog.showsById.get(e.id).title} (${e.rating})`).join(", ") || "none";
    console.log(`   [${p.confidence}] ${p.positive ? "likes" : "dislikes"} ${p.label}  lean ${p.lean.toFixed(3)}`);
    console.log(`       supporting: ${titles(p.supporting)}`);
    console.log(`       conflicting: ${titles(p.conflicting)}`);
  }
  console.log("");
}

const demo = buildProfile(examples[1]);
const before = R.recommend(catalog, demo);
demo.adjustments = { "audience:adult": "ignore", "format:single-cam": "ignore" };
const after = R.recommend(catalog, demo);
console.log("== cringe-satire, ignoring audience:adult and format:single-cam (shared by all its picks)");
console.log(`   before: ${before.picks.map((p) => p.show.title).join(", ")}`);
console.log(`   after:  ${after.picks.map((p) => p.show.title).join(", ")}`);
console.log(`   top reasons before: ${R.explain(before.picks[0], before.prefs, catalog).positives.map((f) => f.label).join(", ")}`);
console.log(`   top reasons after:  ${R.explain(after.picks[0], after.prefs, catalog).positives.map((f) => f.label).join(", ")}`);
