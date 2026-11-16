# Planner

A calm planner and to-do app for iPhone. It's a web app that you add to your home screen, and it works offline. All data stays on your phone.

This build is **phase 1** of the plan: tasks, lists, an inbox, the Today view, light and dark themes, offline support, and backup and restore. The scheduler, study planner, drag and drop, and notes come in later phases.

## Put it on your iPhone

1. Push this folder to a **public** GitHub repository.
2. On GitHub, open **Settings → Pages**. Under "Build and deployment", choose **Deploy from a branch**, then pick the `main` branch and the `/ (root)` folder, and save.
3. After a minute or so, the app is live at `https://<your-username>.github.io/<repo-name>/`.
4. Open that link in **Safari** on your iPhone, tap **Share**, then **Add to Home Screen**.

When you push a change to GitHub, the app picks it up the next time you open it (sometimes you need to open it twice).

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
| `js/store.js` | App data and saving |
| `js/db.js` | IndexedDB storage |
| `js/task-ui.js` | Task rows and the add/edit sheet |
| `js/screens/` | One file per screen (Today, Tasks, Settings, Lists) |
| `fonts/`, `icons/` | Bricolage Grotesque, IBM Plex Sans (SIL OFL), app icons |
| `js/icons.js` | Phosphor Icons (MIT) |
