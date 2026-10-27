// Checks and a readable report for the recommendation scoring.
// Run from the repository folder with:
//   node tests/recommend-tests.js            (checks + report)
//   node tests/recommend-tests.js --report   (report only, e.g. to save a baseline)
// These tests are for development only; the web page does not load them.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const P = require("../js/profile.js");
const R = require("../js/recommend.js");
const examples = require("./example-profiles.js");

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "catalog.json"), "utf8"));
catalog.showsById = new Map(catalog.shows.map((show) => [show.id, show]));

// Turn an example into a real profile: rated and seen shows as given,
// every other show Not seen.
function buildProfile(example) {
  const profile = P.emptyProfile();
  for (const show of catalog.shows) P.setEntry(profile, show.id, "not_seen");
  for (const id of example.seen) P.setEntry(profile, id, "seen");
  for (const [id, rating] of Object.entries(example.ratings)) P.setEntry(profile, id, "seen", rating);
  return profile;
}

function shareWith(picks, feature) {
  return picks.filter((p) => R.showFeatures(p.show).includes(feature)).length;
}

const results = Object.fromEntries(examples.map((ex) => [ex.name, R.recommend(catalog, buildProfile(ex))]));

function runChecks() {
  let passed = 0;
  const test = (name, fn) => {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  };

  test("every example ID exists in the catalog", () => {
    for (const ex of examples) {
      for (const id of [...Object.keys(ex.ratings), ...ex.seen]) assert.ok(catalog.showsById.has(id), id);
    }
  });

  test("no Seen show is ever recommended or listed for discovery", () => {
    for (const ex of examples) {
      const seen = new Set([...Object.keys(ex.ratings), ...ex.seen]);
      const r = results[ex.name];
      for (const item of [...r.picks, ...r.discovery]) assert.ok(!seen.has(item.show.id), `${ex.name}: ${item.show.id}`);
    }
  });

  test("only shows in the eligible pool are recommended", () => {
    const pool = new Set(catalog.views.documented_selection.show_ids);
    for (const r of Object.values(results)) for (const p of r.picks) assert.ok(pool.has(p.show.id));
  });

  test("the whole pool is ranked, not a sample", () => {
    const r = results["warm-family"];
    assert.equal(r.counts.seen + r.counts.notSeen + r.counts.unknown, catalog.views.documented_selection.show_ids.length);
  });

  test("results are deterministic", () => {
    for (const ex of examples) {
      const again = R.recommend(catalog, buildProfile(ex));
      assert.deepEqual(again.picks.map((p) => p.show.id), results[ex.name].picks.map((p) => p.show.id));
    }
  });

  test("picks have positive scores and are in score order", () => {
    for (const r of Object.values(results)) {
      r.picks.forEach((p, i) => {
        assert.ok(p.score > 0);
        if (i > 0) assert.ok(r.picks[i - 1].score >= p.score);
      });
    }
  });

  test("a single rating is not enough evidence", () => {
    const r = results.sparse;
    assert.equal(r.evidence.enough, false);
    assert.equal(r.picks.length, 0);
    assert.ok(r.discovery.length > 0 || r.counts.unknown === 0);
  });

  test("warm-family picks lean warmer and less cynical than cringe-satire picks", () => {
    const warm = results["warm-family"].picks;
    const cringe = results["cringe-satire"].picks;
    assert.ok(shareWith(warm, "tone:warm") > shareWith(cringe, "tone:warm"));
    assert.ok(shareWith(cringe, "tone:cynical") > shareWith(warm, "tone:cynical"));
  });

  test("animation fan gets more animated picks than the others", () => {
    const animated = shareWith(results.animation.picks, "medium:animated");
    for (const name of ["warm-family", "cringe-satire", "workplace-classics"]) {
      assert.ok(animated > shareWith(results[name].picks, "medium:animated"), name);
    }
  });

  test("workplace fan gets more workplace picks than the warm-family fan", () => {
    assert.ok(shareWith(results["workplace-classics"].picks, "setting:workplace") > shareWith(results["warm-family"].picks, "setting:workplace"));
  });

  test("a liked feature raises a lean and a disliked one lowers it", () => {
    const prefs = R.learnPreferences(buildProfile(examples[1]), catalog);
    assert.ok(prefs.get("humor:cringe").lean > 0);
    assert.ok(prefs.get("tone:wholesome").lean < 0);
  });

  test("Meh moves a lean less than Yes or No", () => {
    const one = (rating) => {
      const p = P.emptyProfile();
      P.setEntry(p, "cheers-1982", "seen", rating);
      return Math.abs(R.learnPreferences(p, catalog).get("setting:bar-restaurant").lean);
    };
    assert.ok(one("meh") < one("yes"));
    assert.ok(one("meh") < one("no"));
  });

  test("reputation does not change the score", () => {
    const show = structuredClone(catalog.showsById.get("frasier-1993"));
    const prefs = R.learnPreferences(buildProfile(examples[2]), catalog);
    const before = R.scoreShow(show, prefs).score;
    show.awards = [];
    show.labels = [];
    show.qualification.status = "needs_reputation_evidence";
    assert.equal(R.scoreShow(show, prefs).score, before);
  });

  console.log(`\n${passed} recommendation tests passed.\n`);
}

function printReport() {
  console.log(`Scoring version: ${R.SCORING_VERSION}`);
  for (const ex of examples) {
    const r = results[ex.name];
    console.log(`\n== ${ex.name}: ${ex.description}`);
    console.log(`   evidence: ${r.evidence.rated} rated, ${r.evidence.liked} liked${r.evidence.enough ? "" : " (not enough for picks)"}`);
    r.picks.forEach((p, i) => {
      const why = R.explain(p, r.prefs, catalog).positives.map((f) => f.label).join(", ");
      console.log(`   ${String(i + 1).padStart(2)}. ${p.show.title.padEnd(36)} ${p.score.toFixed(3)}  ${why}`);
    });
    if (!r.evidence.enough) {
      console.log(`   discovery list starts: ${r.discovery.slice(0, 5).map((d) => d.show.title).join(", ")}`);
    }
  }
}

if (!process.argv.includes("--report")) runChecks();
printReport();
