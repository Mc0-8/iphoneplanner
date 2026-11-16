import { icon } from '../icons.js';
import { esc, openSheet, toast, confirmSheet } from '../ui.js';
import * as store from '../store.js';
import { state } from '../store.js';
import { applyTheme } from '../theme.js';
import { todayKey, formatMinutes } from '../dates.js';

export const VERSION = '0.1.0 · phase 1';

export function openSettings() {
  openSheet({
    title: 'Settings',
    full: true,
    build(body) {
      const theme = state.settings.theme;
      body.innerHTML = `
        <section class="group">
          <h3>Appearance</h3>
          <div class="setting">
            <span>Theme</span>
            <div class="segmented" data-seg="theme">
              ${[['light', 'Light'], ['dark', 'Dark'], ['auto', 'Automatic']].map(([v, l]) =>
                `<button type="button" data-v="${v}" aria-pressed="${theme === v}">${l}</button>`).join('')}
            </div>
          </div>
        </section>

        <section class="group">
          <h3>Tasks</h3>
          <label class="setting" for="default-duration">
            <span>Default time needed</span>
            <select id="default-duration" class="select num" style="width:auto">
              ${[15, 30, 45, 60, 90].map((m) => `<option value="${m}" ${state.settings.defaultDuration === m ? 'selected' : ''}>${formatMinutes(m)}</option>`).join('')}
            </select>
          </label>
        </section>

        <section class="group">
          <h3>Data</h3>
          <button class="setting" data-backup>
            <span>Back up<span class="hint">Save all your data as one file, e.g. to iCloud Drive</span></span>${icon('download', 22)}
          </button>
          <button class="setting" data-restore>
            <span>Restore<span class="hint">Replace everything with a backup file</span></span>${icon('upload', 22)}
          </button>
          <input type="file" accept="application/json,.json" hidden data-file>
          <p class="fineprint">Your data is stored only on this phone. Back up now and then, so nothing is lost if Safari's data is cleared or you change phones.</p>
        </section>

        <p class="fineprint num">Planner ${esc(VERSION)}</p>`;

      body.querySelectorAll('[data-seg="theme"] button').forEach((b) => b.addEventListener('click', async () => {
        body.querySelectorAll('[data-seg="theme"] button').forEach((x) => x.setAttribute('aria-pressed', x === b));
        await store.updateSettings({ theme: b.dataset.v });
        applyTheme(b.dataset.v);
      }));

      body.querySelector('#default-duration').addEventListener('change', (e) =>
        store.updateSettings({ defaultDuration: Number(e.target.value) }));

      body.querySelector('[data-backup]').addEventListener('click', backup);

      const file = body.querySelector('[data-file]');
      body.querySelector('[data-restore]').addEventListener('click', () => file.click());
      file.addEventListener('change', async () => {
        const f = file.files[0];
        file.value = '';
        if (!f) return;
        try {
          const json = JSON.parse(await f.text());
          const n = Array.isArray(json?.data?.tasks) ? json.data.tasks.length : 0;
          const ok = await confirmSheet({ title: 'Restore backup?', message: `This replaces everything in the app with the backup (${n} task${n === 1 ? '' : 's'}). It can't be undone.`, confirm: 'Restore' });
          if (!ok) return;
          await store.importData(json);
          applyTheme(state.settings.theme);
          toast('Backup restored');
        } catch (err) {
          toast(err.message.includes('Planner') ? err.message : 'That file could not be read.');
        }
      });
    },
  });
}

async function backup() {
  const name = `planner-backup-${todayKey()}.json`;
  const blob = new Blob([JSON.stringify(store.exportData(), null, 2)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Planner backup' });
      return;
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Backup saved');
}
