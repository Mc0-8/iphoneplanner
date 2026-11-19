// Light / dark / automatic theme.

const media = matchMedia('(prefers-color-scheme: dark)');
let current = 'auto';

export function applyTheme(choice) {
  current = choice || 'auto';
  try { localStorage.setItem('planner-theme', current); } catch { /* private mode */ }
  const dark = current === 'dark' || (current === 'auto' && media.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#0F0E0D' : '#F3EFE9');
}

media.addEventListener('change', () => { if (current === 'auto') applyTheme('auto'); });
