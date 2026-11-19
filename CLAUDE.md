# CLAUDE.md

Planner: an offline iPhone study planner (timetable/scheduler, tasks, notes, flashcards). Plain ES modules, no build step, no dependencies, no test runner. Hosted on GitHub Pages from `main`; merging to `main` deploys.

## Keep token use low
- Read this map first, then open only the files a change touches. Use `grep -n` to find a function before reading a whole file.
- Most files are under 470 lines; `store.js` (~680) and `scheduler.js` (~480) are the big ones.
- Update this file when you add a file, a data field or a convention.

## Map
| File | Owns |
| --- | --- |
| `index.html`, `js/app.js` | Shell, tab bar (Today, Week, Study, Tasks, Notes), screen switching, update prompt |
| `js/store.js` | `state` (tasks, subjects, topics, notes, blocks, settings…), all saving via `db.js`, `commit()` re-plans after every change. `DEFAULT_SETTINGS` lists every setting. Backup/restore + `validateBackup` |
| `js/scheduler.js` | Pure `plan(data, now)` over 5 weeks → `{blocks, overflow, weeks, atRisk}`. `atRisk` = tasks that don't fit before their deadline |
| `js/dates.js` | Date keys (`YYYY-MM-DD`), minutes-of-day helpers, `shortDate`, `formatMinutes` |
| `js/ui.js` | `h()`, `esc()`, `openSheet()` (stackable bottom sheets), `toast()`, swipe |
| `js/task-ui.js` | Task row, add/edit task sheet, "Not enough time" (overbooked) sheet |
| `js/block-ui.js`, `js/drag.js` | Timed day rows, long-press menu, drag/reorder |
| `js/ics.js` | Calendar (.ics) export: blocks with alerts, deadlines as all-day events with reminders |
| `js/notes-format.js` | Note text format: light Markdown, task links, flashcards (`splitCards`/`joinCards`/`flashcards`), blanks, quiz items, answer checking |
| `js/screens/*.js` | One file per screen or sheet: `today`, `week`, `day-view`, `study`, `tasks`, `notes`, `review`, `quiz`, `focus`, `habits`, `stats`, `settings`, `search`, `schedule`, `spare`, `lists` |
| `css/app.css` | All styles; tokens on `:root` (`--accent`, `--text`, `--text-2`, `--divider`, `--surface`, `--surface-2`, `--shadow`, `--radius`, `--radius-lg`, `--s1..`). Lists (`.rows`) render as rounded cards; "Refresh (0.9)" section at the end overrides older rules |
| `sw.js` | Offline cache. **New file → add to `FILES`. Any release → bump `CACHE`** (`planner-vN`) |

## Data formats (keep backwards compatible: old backups must still load)
- Notes are plain text. Flashcards live at the end of a note as lines: `Q: …` / `A: …`, and fill-in-the-blank `C: sentence with {hidden words}` (a `C:` line only counts if it has `{…}`).
- Spaced repetition is per **topic** (`store.rateTopic`, steps `REVIEW_STEPS` = 1, 3, 7, 14, 30 days), not per card.
- Tasks: `deadline` (date key), `dateMode` `'due'` (finish by) or `'on'` (that exact day, optional `atTime`), `type` `'task'|'exam'`, `duration` minutes.

## Conventions
- UI copy: plain, friendly, British date format (`en-GB`), no jargon. Sentence case.
- New setting → add to `DEFAULT_SETTINGS` with a default; settings merge over defaults on load.
- Subject colour on a row: add class `tinted` and `style="--sc:<colour>"`; CSS washes the row in that colour (`--tint` %) with a solid left edge.
- Release: bump `VERSION` in `js/screens/settings.js`, `CACHE` in `sw.js`, and add a line to `README.md`.
- Testing: no test suite. Check pure logic with `node --input-type=module` importing the module, and the UI headless with Playwright, serving repo files via `page.route` for `http://app.test/` (no server needed). Use an iPhone-sized viewport (390×844).
- The owner merges nothing by hand: Claude opens a PR, tests it, and merges it itself.
