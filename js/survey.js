// The optional taste survey: eight questions, each tied to catalog features.
// Every answer either nudges some features up (+1), down (-1), or does nothing
// (the neutral answer). The size of a nudge is SURVEY_STRENGTH in recommend.js,
// which is smaller than the effect of rating a single show.
//
// Questions use only features that appear in the catalog's vocabulary and in
// a reasonable number of eligible shows. Example shows in the help text have
// the matching tags in catalog.json.

const SURVEY_QUESTIONS = [
  {
    id: "animation",
    text: "How do you feel about animated sitcoms?",
    options: [
      { value: "more", label: "I enjoy them", effects: { "medium:animated": 1 } },
      { value: "neutral", label: "No preference / it depends", effects: {} },
      { value: "less", label: "I'd rather skip them", effects: { "medium:animated": -1 } },
    ],
  },
  {
    id: "camera",
    text: "Which filming style do you prefer?",
    help: "Multi-camera shows are filmed on a stage set, often with audience laughter (Cheers, Friends). Single-camera shows are filmed more like movies (The Office (US), Parks and Recreation).",
    options: [
      { value: "multi", label: "Multi-camera", effects: { "format:multi-cam": 1, "format:single-cam": -1 } },
      { value: "neutral", label: "No preference", effects: {} },
      { value: "single", label: "Single-camera", effects: { "format:single-cam": 1, "format:multi-cam": -1 } },
    ],
  },
  {
    id: "setting",
    text: "Where do you most like a sitcom to be set?",
    options: [
      { value: "home", label: "At home, with a family", effects: { "setting:home": 1, "themes:family": 1 } },
      { value: "neutral", label: "Either / it depends", effects: {} },
      { value: "work", label: "At work, with coworkers", effects: { "setting:workplace": 1, "themes:coworkers": 1 } },
    ],
  },
  {
    id: "warmth",
    text: "Warm, heartfelt shows where the characters genuinely care about each other?",
    options: [
      { value: "more", label: "More of that, please", effects: { "tone:warm": 1, "tone:heartfelt": 1 } },
      { value: "neutral", label: "No preference / it depends", effects: {} },
      { value: "less", label: "Too sweet for me", effects: { "tone:warm": -1, "tone:heartfelt": -1 } },
    ],
  },
  {
    id: "cringe",
    text: "Awkward, cringe-inducing humor?",
    options: [
      { value: "more", label: "I love squirming", effects: { "humor:cringe": 1 } },
      { value: "neutral", label: "No preference / it depends", effects: {} },
      { value: "less", label: "I can't watch it", effects: { "humor:cringe": -1 } },
    ],
  },
  {
    id: "dark",
    text: "Dark or edgy humor (bleak or taboo subjects, pushing boundaries)?",
    options: [
      { value: "more", label: "Yes, the darker the better", effects: { "humor:dark": 1, "tone:edgy": 1 } },
      { value: "neutral", label: "No preference / it depends", effects: {} },
      { value: "less", label: "I prefer lighter shows", effects: { "humor:dark": -1, "tone:edgy": -1 } },
    ],
  },
  {
    id: "absurd",
    text: "Absurd or surreal humor (ridiculous situations played straight)?",
    options: [
      { value: "more", label: "The sillier the better", effects: { "humor:absurdist": 1, "humor:surreal": 1 } },
      { value: "neutral", label: "No preference / it depends", effects: {} },
      { value: "less", label: "I like it grounded", effects: { "humor:absurdist": -1, "humor:surreal": -1 } },
    ],
  },
  {
    id: "adult",
    text: "Adult content: crude jokes, frequent sexual humor, cable-level language?",
    help: "Based on the catalog's editorial content labels, which are impressions, not official ratings.",
    options: [
      { value: "more", label: "Bring it on", effects: { "content:mature": 1, "content:suggestive": 1, "content:crude": 1 } },
      { value: "neutral", label: "Fine either way", effects: {} },
      { value: "less", label: "I'd rather avoid it", effects: { "content:mature": -1, "content:suggestive": -1, "content:crude": -1 } },
    ],
  },
];

// Look up the chosen option for a question, or null.
function surveyOption(questionId, value) {
  const question = SURVEY_QUESTIONS.find((q) => q.id === questionId);
  return question?.options.find((o) => o.value === value) ?? null;
}

// Number of answers that actually express a preference (not neutral).
function countSurveyPreferences(answers) {
  return Object.entries(answers).filter(([id, value]) => {
    const option = surveyOption(id, value);
    return option && Object.keys(option.effects).length > 0;
  }).length;
}

if (typeof module !== "undefined") {
  module.exports = { SURVEY_QUESTIONS, surveyOption, countSurveyPreferences };
}
