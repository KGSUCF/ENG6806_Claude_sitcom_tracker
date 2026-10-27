# Sitcom Tracker

A personal sitcom discovery tool, built as a static web page for GitHub Pages
(ENG 6806 class project). It will let you:

- record the shows you have seen, quickly, without rating every one;
- optionally rate shows;
- answer a short taste survey; and
- get recommendations for shows you might enjoy.

**Status:** Stage 1 (planning). The web page has not been built yet.

## Ground rules

- Plain HTML, CSS, and JavaScript. `index.html` sits at the repository root.
  No frameworks, no build step: GitHub Pages serves the files exactly as committed.
- `catalog.json` is the **only** working dataset, and the page treats it as read-only.
- Personal data (viewing history, ratings, survey answers) is kept separate from
  the catalog. It is stored in the browser and never written into `catalog.json`.
- Show IDs are never changed. Old IDs are translated through `id_aliases`.
- Show facts are never invented. Uncertainty and source labels in the catalog
  are shown or respected, not hidden.

## Dataset

### Files

| File | Role |
|---|---|
| `catalog.json` | **Working dataset** (version 3.0.0, built 2026-10-26, 304 shows). The page loads this file. |
| `Claudesitcoms.json` | Reference snapshot (version 2.0, 300 shows). It was one of the inputs reconciled into `catalog.json`. It is **not** loaded by the page and not merged into anything. |

Note: `catalog.json` lists an input file that was also called `catalog.json`
(a 211-show ChatGPT version). That older file is not in this repository. The
current `catalog.json` is the reconciled result.

### Top-level sections of `catalog.json`

| Section | What it holds |
|---|---|
| `meta` | Scope, version, policies (missing values, qualification rules), field notes, known limits, licensing notes |
| `vocabulary` | Allowed tag values with definitions for 10 categories: `format`, `structure`, `content`, `setting`, `themes`, `audience`, `cast`, `devices`, `humor`, `tone` |
| `shows` | 304 show records (described below) |
| `views` | Ready-made lists of show IDs: `all_catalog_records` (304), `documented_selection` (165, the default recommendation pool), `reputation_review_candidates` (139) |
| `id_aliases` | 515 entries mapping any former ID (older slugs, IMDb IDs) to the current canonical show ID |
| `people` | 1,140 creators and stars referenced by ID from shows |
| `franchises` | 26 groupings of related shows |
| `sources` | 701 source records referenced by `source_ids` |
| `legacy_chatgpt_taxonomy` | An older tag scheme, kept for reference only |
| `normalization_log` | 37 recorded corrections (old value, new value, source) |
| `quality_report` | Summary of open review items |
| `validation_schema` | A JSON Schema describing the file's structure |

### Useful fields on each show

- Identity and display: `id`, `title`, `alternate_titles`, `years` (`start`/`end`),
  `premiere_date`, `end_date`, `status`, `seasons`, `runtime_minutes`, `networks`,
  `country`, `kind` (sitcom / dramedy / sketch), `medium` (live-action / animated / puppet)
- Relationships: `spinoff_of`, `based_on` (each `{title, show_id}`; `show_id` may be
  null when the parent is not in the catalog), `franchise`, `creators`, `stars`
- Taste matching: `tags` (controlled vocabulary). `format`, `structure`, and
  `content` are single values; the other categories are lists.
- Recognition: `qualification.status`, `awards`, `labels`, `reception_snapshots`
- Caveats: `quality_issues`, `scope_exception`, `field_provenance`, `source_claims`
- Convenience: `derived.premiere_decade`, `derived.calendar_span_years_inclusive`

### Rules from the catalog that this project follows

- Use `views.documented_selection` as the default recommendation pool, and all
  records for marking shows as seen or rated. The user may choose to include
  the review candidates.
- Recognition (awards, acclaim) must **not** raise a personal match score.
- Shows already watched are excluded from recommendations, whatever their reputation.
- `editorial_tag_weights` and `legacy_annotation` are off by default and are not used for scoring.
- A missing tag means "not annotated", not "absent". An empty list is not proof of absence.
  A missing end year does not mean the show is still running; check `status`.
- Tags and content labels are editorial interpretations, not official ratings.

### Limitations

- A curated set of 304 shows, not every sitcom. Mostly US (266) and UK (30);
  about half premiered in the 1980s or 1990s.
- Many facts are imported and marked as not independently verified;
  `quality_report.factual_audit_complete` is `false`.
- Statuses are snapshots ("running" may already be out of date).
- 139 shows are flagged `needs_reputation_evidence`; 12 have revival/entity boundary reviews.
- For some shows `seasons` is lower than the number of `season_records`, because
  `seasons` only counts seasons that premiered by the build date (documented in `field_provenance`).
- The file is about 4 MB, which is fine for one fetch on page load.

### Integrity check (Stage 1)

Checked with a one-off script; no changes were made to the data.

- 304 shows, 304 unique IDs, matching `meta.show_count`. No duplicate titles or IMDb IDs.
- Every `id_aliases` target exists, and every show's `legacy_ids` are in `id_aliases`.
  All 300 IDs from `Claudesitcoms.json` resolve through the aliases.
- All references resolve: `spinoff_of`/`based_on` show IDs, `franchise`, franchise
  member lists, `creators`/`stars` to `people`, and every `source_id(s)` to `sources`.
- `views`: all IDs exist; `documented_selection` and `reputation_review_candidates`
  do not overlap and together equal all 304 shows.
- Every tag value appears in `vocabulary`.
- The whole file validates against its own `validation_schema`.

### Licensing and attribution

Sources have different terms (see `meta.source_reuse`). TVmaze-derived fields
require attribution and ShareAlike compliance, so the page will include a
credit line. No blanket license is claimed for the dataset.

## Proposed file structure

```
index.html          page structure (repository root, required by GitHub Pages)
style.css           styling
app.js              JavaScript (may be split into a few files later if it grows)
catalog.json        working dataset (read-only)
Claudesitcoms.json  reference snapshot (not loaded)
README.md           this file
```

## Planned stages

Each stage is a small, separate set of commits. Later features are not started early.

1. **Inspect and plan** – review the catalog, check integrity, write this README.
2. **Page skeleton** – `index.html`, `style.css`, `app.js`; load `catalog.json` and show a basic list.
3. **Browse and search** – search by title; filter by decade, kind, medium, country.
4. **Viewing history** – mark shows as seen quickly (for example, a checklist by decade
   or search), saved in the browser's `localStorage`, separate from the catalog.
5. **Optional ratings** – a simple scale on any seen show; never required.
6. **Taste survey** – a few questions mapped to catalog tags.
7. **Recommendations** – score unseen shows from `documented_selection` against ratings
   and survey answers, and explain each suggestion.
8. **Export/import and polish** – save/load the personal profile as a separate JSON file
   (applying `id_aliases` on import), accessibility checks, and GitHub Pages deployment.

## How development works

- Changes are made one stage at a time, in small steps.
- Claude makes, commits, and pushes each change on the working branch, then summarizes
  what changed and how to check it. The project owner reviews the result on GitHub.
- Commit messages are short and describe one change (for example, "Add page skeleton").
- To test locally, serve the folder instead of opening the file directly, because
  browsers block `fetch()` of local files:

  ```
  python3 -m http.server 8000
  ```

  Then open <http://localhost:8000>.

## Existing code

There is no existing application code. The repository contains only the two JSON
files, which are kept as they are.
