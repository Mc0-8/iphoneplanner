// The 15-minute review: go through each topic's notes and flashcards, then rate it Easy / OK / Hard.

import { icon } from '../icons.js';
import { esc, h, openSheet, toast } from '../ui.js';
import * as store from '../store.js';
import { state, flashcards, REVIEW_STEPS } from '../store.js';
import { shortDate, addDays, todayKey } from '../dates.js';

export function openReview(topicIds) {
  const queue = topicIds.map((id) => state.topics.find((t) => t.id === id)).filter(Boolean);
  if (!queue.length) { toast('Nothing to review.'); return; }
  let i = 0;
  const rated = [];

  openSheet({
    title: 'Review',
    full: true,
    build(body, close) {
      const draw = () => {
        const t = queue[i];
        const subject = store.subjectById(t.subjectId);
        const notes = state.notes.filter((n) => n.topicId === t.id).sort((a, b) => a.createdAt - b.createdAt);
        const cards = notes.flatMap((n) => flashcards(n.text));
        const plain = notes.map((n) => n.text.split('\n').filter((l) => !/^\s*[QA]\s*[:.)]/i.test(l)).join('\n').trim()).filter(Boolean);
        const nextFor = (r) => {
          const step = r === 'hard' ? 0 : Math.min(REVIEW_STEPS.length - 1, t.step + (r === 'easy' ? 2 : 1));
          return shortDate(addDays(todayKey(), REVIEW_STEPS[step]));
        };

        body.innerHTML = `
          <p class="review-count num">${i + 1} of ${queue.length}</p>
          <h3 class="review-title">${subject ? `<span class="dot" style="background:${subject.colour}"></span>` : ''}${esc(t.name)}</h3>
          <p class="fineprint" style="margin-top:2px">${[subject?.name, t.lastReviewed ? `last reviewed ${shortDate(t.lastReviewed).toLowerCase()}` : 'first review'].filter(Boolean).map(esc).join(' · ')}</p>
          ${plain.length ? `<div class="review-notes">${plain.map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}</div>` : ''}
          ${cards.length ? `<div class="cards">${cards.map((c, j) => `
            <button type="button" class="card" data-card="${j}" aria-expanded="false">
              <span class="q">${esc(c.q)}</span>
              <span class="a" hidden>${esc(c.a)}</span>
              <span class="reveal">Tap to show answer</span>
            </button>`).join('')}</div>` : ''}
          ${!plain.length && !cards.length ? '<p class="empty">This topic has no notes.</p>' : ''}
          <div class="rate">
            <p class="fineprint">How well did you know it?</p>
            <div class="rate-buttons">
              ${[['hard', 'Hard'], ['ok', 'OK'], ['easy', 'Easy']].map(([r, l]) => `
                <button type="button" class="rate-btn" data-r="${r}"><strong>${l}</strong><span>${esc(nextFor(r))}</span></button>`).join('')}
            </div>
          </div>`;

        body.querySelectorAll('.card').forEach((c) => c.addEventListener('click', () => {
          const open = c.getAttribute('aria-expanded') === 'true';
          c.setAttribute('aria-expanded', !open);
          c.querySelector('.a').hidden = open;
          c.querySelector('.reveal').hidden = !open;
        }));
        body.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', async () => {
          await store.rateTopic(t.id, b.dataset.r);
          rated.push(t.name);
          i++;
          if (i < queue.length) { draw(); body.scrollTop = 0; return; }
          close();
          toast(`Reviewed ${rated.length} topic${rated.length === 1 ? '' : 's'}`);
        }));
      };
      draw();
    },
  });
}
