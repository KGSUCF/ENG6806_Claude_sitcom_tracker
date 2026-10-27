// Compare the current method's top picks with the baseline-1 method, using the
// same fixed example profiles. Run from the repository folder with:
//   node tests/compare-with-baseline.js
// Changes in the list are only differences, not proof of improvement.

const S = require("../js/survey.js");
const { examples, results, baseline, shareWith } = require("./recommend-tests.js");

// Features each profile's survey answers pushed up or down.
function surveyFeatures(answers) {
  const features = {};
  for (const [id, value] of Object.entries(answers)) {
    Object.assign(features, S.surveyOption(id, value)?.effects ?? {});
  }
  return features;
}

// The example profiles have no adjustments, so the current method gives the
// survey-1 results here.
console.log("Comparing survey-1 with baseline-1 (same profiles; baseline ignores survey answers)");
for (const ex of examples) {
  const before = baseline[ex.name].picks;
  const after = results[ex.name].picks;
  const beforeIds = before.map((p) => p.show.id);
  const afterIds = after.map((p) => p.show.id);

  console.log(`\n== ${ex.name}`);
  if (before.length === 0) {
    console.log(`   baseline: no picks (not enough rating evidence)`);
  }
  const kept = afterIds.filter((id) => beforeIds.includes(id)).length;
  console.log(`   top ${after.length}: ${kept} kept from the baseline top ${before.length}`);
  const entered = after.filter((p) => !beforeIds.includes(p.show.id)).map((p) => p.show.title);
  const left = before.filter((p) => !afterIds.includes(p.show.id)).map((p) => p.show.title);
  if (entered.length) console.log(`   new:     ${entered.join(", ")}`);
  if (left.length) console.log(`   dropped: ${left.join(", ")}`);

  for (const [feature, direction] of Object.entries(surveyFeatures(ex.survey))) {
    const b = shareWith(before, feature);
    const a = shareWith(after, feature);
    console.log(`   ${direction > 0 ? "asked more" : "asked less"} ${feature.padEnd(20)} picks with it: ${b} -> ${a}`);
  }
}
