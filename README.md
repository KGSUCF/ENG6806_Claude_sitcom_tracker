# Sitcom Tracker

A personal sitcom discovery tool, built as a static web page for GitHub Pages
(ENG 6806 class project). It will let you:

- record the shows you have seen, quickly, without rating every one;
- optionally rate shows;
- answer a short taste survey; and
- get recommendations for shows you might enjoy.

**Status:** Stage 2 complete: a working tracker with search, filters, optional ratings, and backups.

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
require attribution and ShareAlike compliance, so the page footer includes a
credit line. No blanket license is claimed for the dataset.

## File structure

```
index.html          page structure (repository root, required by GitHub Pages)
style.css           styling (cozy TV theme, light and dark)
js/profile.js       personal data: browser storage, backup export/import, validation
js/app.js           page behavior: loading the catalog, search, filters, ratings
catalog.json        working dataset (read-only)
Claudesitcoms.json  reference snapshot (not loaded)
.gitignore          keeps exported personal backups out of the repository
README.md           this file
```

## Stages

The work follows a set of prepared prompts, one stage at a time.
Later features are not started early.

1. **Inspect and plan**: review the catalog, check integrity, write this README. *(done)*
2. **First working tracker**: search, decade/kind/medium filters, optional Yes/Meh/No
   ratings, browser storage, versioned backup export/import. *(done)*
3. **Viewing history**: Seen / Not seen / Unknown, separate from ratings, with a
   quick checklist mode and undo.
4. **Recommendations**: transparent, deterministic scoring with explanations.
5. **Taste survey**: about eight optional questions that adjust recommendations.
6. **Inspect assumptions**: "What your ratings suggest", with More/Less/Ignore controls.
7. **Revision through a branch and pull request**, based on real use of the page.

## Using the tracker

- **Search** matches show titles and recorded alternate titles.
- **Filters**: premiere decade (`derived.premiere_decade`), kind (sitcom, dramedy,
  sketch), medium (live-action, animated, puppet), and your own rating.
- **Ratings** are optional: **Yes** = I liked it, **Meh** = It was okay,
  **No** = I didn't like it. Press a rating again, or press **Clear**, to remove it.
- **Saving**: ratings are saved in this browser's `localStorage` (key
  `sitcomTracker.profile`) and survive a refresh. Clearing site data erases them,
  so export a backup now and then.
- **Export** downloads `sitcom-tracker-backup-YYYY-MM-DD.json`.
- **Import** checks the file first and changes nothing until you choose:
  - *Replace*: your current data is swapped for the file's data.
  - *Merge*: the file's ratings are added; where both rate the same show, the file wins.
  Former show IDs are translated with `id_aliases`; unknown IDs and invalid values are
  skipped and listed.

### Backup format (version 1)

```json
{
  "format": "sitcom-tracker-profile",
  "version": 1,
  "exported_at": "2026-10-27T12:00:00.000Z",
  "catalog_version": "3.0.0",
  "ratings": { "cheers-1982": "yes", "taxi-1978": "meh" }
}
```

## Previewing locally

Browsers refuse to let a page opened straight from disk (`file://…`) load
`catalog.json`, so serve the folder with a tiny local web server. With Python
installed, run this in the repository folder:

```
python3 -m http.server 8000
```

Then open <http://localhost:8000>. (On Windows, use `py -m http.server 8000`.)
Press Ctrl+C in the terminal to stop the server. If the catalog cannot load, the
page shows an error message with a "Try again" button instead of a blank list.

## How development works

- Changes are made one stage at a time, in small steps.
- Claude makes, commits, and pushes each change on the working branch, then summarizes
  what changed and how to check it. The project owner reviews the result on GitHub.
- Commit messages are short and describe one change.

## Existing code

The original repository had no application code, only the two JSON files, which are kept as they are. All application code (`index.html`, `style.css`, `js/`) was written for this project.
