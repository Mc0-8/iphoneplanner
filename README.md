# Planner

A calm planner and to-do app for iPhone. It's a web app that you add to your home screen, and it works offline. All data stays on your phone.

This build covers **all four phases** of the plan.

- **Phase 1:** tasks, lists, inbox, light and dark themes, offline support, backup and restore.
- **Phase 2:** the scheduler (spreads tasks and study evenly, splits big tasks, daily limit, fixed commitments, days off), the study planner (weekly hours per subject, exam boost, streak), the Today list with a moving "now" line, the end-of-day check-in, and a Week calendar you can swipe through 5 weeks.

- **Phase 3:** hold and drag blocks to reorder them or move them to another day (they get pinned), a long-press menu (edit, pin/unpin, move to tomorrow, delete or skip), "Re-spread" for a week, swipe left to delete a task, and a zoomed day view from the Week tab.
- **Phase 4:** notes with topics and Q:/A: flashcards, spaced-repetition reviews (1, 3, 7, 14, 30 days) planned as 15-minute blocks, focus mode with a timer and optional Pomodoro, planned vs actual time, habits, grades with a "what do I need" calculator, stats, search, repeating tasks, and a Sunday summary of the week ahead.

## Put it on your iPhone

1. Push this folder to a **public** GitHub repository.
2. On GitHub, open **Settings → Pages**. Under "Build and deployment", choose **Deploy from a branch**, then pick the `main` branch and the `/ (root)` folder, and save.
3. After a minute or so, the app is live at `https://<your-username>.github.io/<repo-name>/`.
4. Open that link in **Safari** on your iPhone, tap **Share**, then **Add to Home Screen**.

When a change is pushed to GitHub, the app downloads it in the background and shows **"A new version is ready — Update"**. You can also use **Settings → Check for updates**. Your data is kept.

## Run it on your Mac

```sh
cd planner
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Files

| Path | What it does |
| --- | --- |
| `index.html` | App shell |
| `manifest.json` | Home-screen name, icon and colours |
| `sw.js` | Offline cache. Add any new file to `FILES` and bump `CACHE`. |
| `css/app.css` | All styles and design tokens |
| `js/app.js` | Tab bar, screen switching, add button |
| `js/store.js` | App data and saving; re-plans after every change |
| `js/scheduler.js` | The scheduling rules (pure function, no UI) |
| `js/block-ui.js` | Rows for the timed day list, the now line, long-press menu, drag to reorder |
| `js/drag.js` | Long-press and drag handling (touch and mouse) |
| `js/screens/notes.js`, `review.js` | Notes tab, topics, the review flow |
| `js/screens/focus.js` | Focus mode and timer |
| `js/screens/habits.js`, `stats.js` | Habits, stats and grades |
| `js/screens/search.js` | Search across notes and tasks |
| `js/db.js` | IndexedDB storage |
| `js/task-ui.js` | Task rows and the add/edit sheet |
| `js/screens/` | One file per screen or sheet |
| `fonts/`, `icons/` | Bricolage Grotesque, IBM Plex Sans (SIL OFL), app icons |
| `js/icons.js` | Phosphor Icons (MIT) |
