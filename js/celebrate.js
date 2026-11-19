// Little celebrations: a confetti burst for big moments. Skipped when the phone asks for reduced motion.

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Confetti falls from the top of the screen for about 1.6 seconds. */
export function confetti(colours) {
  if (reduced() || document.querySelector('.confetti')) return;
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim() || '#E0714A';
  const palette = colours?.length ? [...colours, accent] : [accent, '#6B8F71', '#4F6D8F', '#C29A3B', '#8A5A7A', '#3F8A8A'];
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  canvas.setAttribute('aria-hidden', 'true');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth, h = window.innerHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); return; }
  ctx.scale(dpr, dpr);
  const bits = Array.from({ length: 90 }, (_, i) => ({
    x: w / 2 + (Math.random() - 0.5) * 120,
    y: h * 0.35,
    vx: (Math.random() - 0.5) * 16,
    vy: -9 - Math.random() * 11,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.4,
    s: 5 + Math.random() * 5,
    c: palette[i % palette.length],
  }));
  const start = performance.now();
  const frame = (now) => {
    const t = now - start;
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = t > 1100 ? Math.max(0, 1 - (t - 1100) / 500) : 1;
    for (const b of bits) {
      b.vy += 0.32; b.vx *= 0.985; b.x += b.vx; b.y += b.vy; b.r += b.vr;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r);
      ctx.fillStyle = b.c; ctx.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2);
      ctx.restore();
    }
    if (t < 1600) requestAnimationFrame(frame); else canvas.remove();
  };
  requestAnimationFrame(frame);
}

/** The store announces big moments with a 'planner:celebrate' event. */
export function listen() {
  window.addEventListener('planner:celebrate', (e) => confetti(e.detail?.colours));
}

/** A small pop on the tick circle the moment something is ticked off (not when unticking). */
export function enableTickPop() {
  document.addEventListener('click', (e) => {
    const check = e.target.closest?.('.check');
    if (!check) return;
    const row = check.closest('.row, .trow');
    if (!row || row.classList.contains('done')) return;
    const span = check.querySelector('span');
    if (!span) return;
    span.classList.remove('pop'); void span.offsetWidth; span.classList.add('pop');
    setTimeout(() => span.classList.remove('pop'), 600);
  }, true);
}
