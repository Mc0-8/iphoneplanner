// Screens that arrive in later phases (see the plan's Roadmap).

import { esc } from '../ui.js';

export function placeholder(title, line) {
  return {
    addLabel: null,
    render(el) {
      el.innerHTML = `
        <header class="header"><div><h1>${esc(title)}</h1></div></header>
        <p class="empty">${esc(line)}</p>`;
    },
  };
}
