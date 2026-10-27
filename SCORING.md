# How recommendations are scored

Scoring version: **survey-1** (code: `js/recommend.js`). It is the earlier
**baseline-1** method plus optional taste-survey answers (section 4).

The method is deliberately simple so you can check every number yourself.
It uses only your own ratings, your optional survey answers, and documented catalog tags. It produces a
ranking with reasons, not a prediction or a "match percentage".

## 1. Which shows are eligible

| Rule | Why |
|---|---|
| Start from `views.documented_selection` (165 shows) | The catalog's `default_recommendation_advice` names this as the default pool: shows with documented award recognition, a sourced recognition snapshot, or a historical audience-score threshold. |
| Optionally add `views.reputation_review_candidates` (139 shows) | The catalog says users may explicitly include these. They are off by default and labeled when included. |
| Never include a show you marked **Seen** | Whether or not you rated it. |
| Top picks use shows you marked **Not seen** | Only you can say a show is new to you. |
| Optionally include **Unknown** shows in top picks | Off by default. Each such pick is labeled "Unknown: you haven't said whether you've seen this". |

Reputation decides eligibility only. Awards, labels such as `critics-favorite`, and
reception scores are **not** used in the score (the catalog's
`recognition_should_increase_personal_match_score` is `false`).

Every eligible show is scored; nothing is sampled.

## 2. Features

Each show is described by these catalog fields, written as `category:value`:

- `kind` (sitcom, dramedy, sketch) and `medium` (live-action, animated, puppet)
- `tags.humor`, `tags.tone`, `tags.setting`, `tags.themes`, `tags.devices`,
  `tags.cast`, `tags.format`, `tags.structure`, `tags.audience`, `tags.content`

All values come from the catalog's controlled `vocabulary`. `format:not-applicable`
is skipped because it is a placeholder, not a description.

**Not used:** `editorial_tag_weights` (unreviewed estimates, off by default per the
catalog), `legacy_annotation` (an older, unmerged taxonomy), `labels`, `awards`,
`qualification`, reception snapshots, country, networks, people, and franchises.

## 3. Learning a "lean" for each feature

| Your rating | Weight |
|---|---|
| Yes (I liked it) | +1 |
| Meh (It was okay) | −0.25 |
| No (I didn't like it) | −1 |
| Seen with no rating, Not seen, Unknown | not used for learning |

For each feature, add up the weights of the rated shows that have it, then divide
by (number of those shows + 2):

```
lean(feature) = sum of weights / (rated shows with the feature + 2)
```

The "+ 2" keeps a feature seen in just one show from counting as much as one
seen in many. Example: you liked 3 shows with `setting:workplace` and rated 1 No:
(1 + 1 + 1 − 1) / (4 + 2) = 0.333.

## 4. Taste-survey answers (added in survey-1)

The eight survey questions are defined in `js/survey.js`. Each answer names a few
features and a direction (+1 or −1). Neutral answers ("No preference", "It depends")
name no features and change nothing, exactly like skipping the question.

```
survey lean(feature) = direction × 0.2
lean(feature) = rating lean + survey lean
```

Ratings stay in charge: one Yes rating alone moves a feature by 1 / (1 + 2) = 0.33,
more than a survey answer's 0.2, and a feature backed by several ratings moves further.
Example: you answered "Single-camera" (+0.2) but rated two single-camera shows No:
(−1 − 1) / (2 + 2) + 0.2 = −0.3, so the ratings win.

| Question | Features it nudges |
|---|---|
| Animated sitcoms | `medium:animated` |
| Filming style | `format:multi-cam`, `format:single-cam` (one up, the other down) |
| Where a sitcom is set | home: `setting:home`, `themes:family`; work: `setting:workplace`, `themes:coworkers` |
| Warm, heartfelt shows | `tone:warm`, `tone:heartfelt` |
| Cringe humor | `humor:cringe` |
| Dark or edgy humor | `humor:dark`, `tone:edgy` |
| Absurd or surreal humor | `humor:absurdist`, `humor:surreal` |
| Adult content | `content:mature`, `content:suggestive`, `content:crude` |

## 5. Scoring a candidate

```
score(show) = sum of lean(feature) over the show's features / number of features
```

Features that appear in none of your rated shows count as 0. Dividing by the number
of features stops shows with long tag lists from winning just by having more tags.

Ties are broken by title, then ID, so the same data always gives the same order.

Top picks must have a score above 0: a show that only resembles things you
didn't like is not presented as a recommendation.

## 6. Explanations

Each pick lists the three features adding the most to its score and up to two
features taking away from it, each with the rated shows and survey answers behind it.
"Score details" shows the full sum and every feature's lean (split into its rating and
survey parts), so the explanation and the score always match.

## 7. Too little evidence

Personal picks need either **3 ratings including at least 1 Yes**, or **3 survey
answers that express a preference**. Below that, the page says so and suggests rating
a few shows or taking the survey. Picks that rest on the survey rather than ratings are
labeled that way. With fewer than 10 ratings, picks are labeled as rough.

## 8. Discovery list

Up to 50 eligible shows whose status is still **Unknown**, ranked by the same score
(or in premiere order when there is too little evidence). Its purpose is to help you
record shows you've already seen, which improves the picks.

## Known limits of the baseline

- **Common features dominate.** Features found in many shows (for example
  `audience:adult` or `content:mild`) gather evidence fastest, so they often appear
  as top reasons even when they are probably not why you liked a show.
- **Shared features are not causes.** If you liked three shows set in a bar, that
  may be a coincidence; the method cannot tell.
- **Tags are editorial.** The catalog marks them as provisional interpretations, not
  episode audits. A missing tag means "not annotated", but here it simply counts as 0.
- **No sense of quality within a feature.** Two workplace comedies are treated alike
  apart from their other tags.

## Checking it

`node tests/recommend-tests.js` runs fixed example profiles (made-up viewers in
`tests/example-profiles.js`) and checks that seen shows are excluded, the whole pool
is ranked, results are repeatable, likes and dislikes move results in the expected
direction, Meh has less influence, and reputation does not affect scores.

`tests/baseline-results.txt` stores the baseline-1 top 10 for each example profile. A
test checks that the current code, with survey answers ignored, still reproduces it exactly.

## Survey-1 compared with baseline-1

`node tests/compare-with-baseline.js` (saved in `tests/survey-comparison.txt`) runs the
same five example profiles, now with survey answers, against the baseline:

- **Profiles with 6–8 ratings** (warm-family, cringe-satire, workplace-classics): 9 of
  10 picks stay the same; one show enters and one leaves. Animation: all 10 stay.
  Features the survey asked for usually appear in the same or one more pick, but not
  always (warm-family asked for home settings and went from 8 to 7 picks with
  `setting:home`, because other nudged features reordered the list).
- **Sparse profile** (1 rating): baseline-1 gave no picks. With three preference answers
  it now gets 10 picks, all multi-camera as asked, clearly labeled as resting on the survey.

Tradeoffs:
- The survey mostly helps people with few ratings, which is its purpose. For people who
  have rated several shows, it changes little, by design.
- Survey-based picks are broad: many shows share a format or tone, so ties and
  near-ties are common and the order among them says little.
- A different list is not automatically a better one. These checks show the survey does
  what it says (nudges, outweighed by ratings, neutral does nothing); whether the picks
  are better can only be judged by a real viewer.
