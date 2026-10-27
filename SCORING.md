# How recommendations are scored

Scoring version: **baseline-1** (code: `js/recommend.js`).

The method is deliberately simple so you can check every number yourself.
It uses only your own ratings and documented catalog tags. It produces a
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

## 4. Scoring a candidate

```
score(show) = sum of lean(feature) over the show's features / number of features
```

Features that appear in none of your rated shows count as 0. Dividing by the number
of features stops shows with long tag lists from winning just by having more tags.

Ties are broken by title, then ID, so the same data always gives the same order.

Top picks must have a score above 0: a show that only resembles things you
didn't like is not presented as a recommendation.

## 5. Explanations

Each pick lists the three features adding the most to its score and up to two
features taking away from it, each with the rated shows behind it. "Score details"
shows the full sum and every feature's lean, so the explanation and the score always
match.

## 6. Too little evidence

Personal picks need at least **3 ratings including at least 1 Yes**. Below that,
the page says so and suggests rating a few shows. With fewer than 10 ratings, picks
are labeled as rough.

## 7. Discovery list

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

`tests/baseline-results.txt` stores this version's top 10 for each example profile so
later versions can be compared against it.
