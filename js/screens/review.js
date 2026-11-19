// The 15-minute review: go through each topic's notes and flashcards, then rate it Easy / OK / Hard.

import { icon } from '../icons.js';
import { esc, h, openSheet, toast } from '../ui.js';
import * as store from '../store.js';
import { state, flashcards, REVIEW_STEPS } from '../store.js';
import { splitCards, joinCards, toggleTodo, renderInline } from '../notes-format.js';
import { noteBodyHTML, wireNoteBody, clozeHTML } from './notes.js';
import { openQuiz } from './quiz.js';
import { shortDate, addDays, todayKey } from '../dates.js';

export function openReview(topicIds) {
  const queue = topicIds.map((id) => state.topics.find((t) => t.id === id)).filter(Boolean);
  if (!queue.length) { toast('Nothing to review.'); return; }
  let i = 0;
  const rated = [];
  let quiz = null; // the quiz result for the topic on screen

  openSheet({
    title: 'Review',
    full: true,
    build(body, close) {
      const draw = () => {
        const t = queue[i];
        const subject = store.subjectById(t.subjectId);
        const notes = state.notes.filter((n) => n.topicId === t.id).sort((a, b) => a.createdAt - b.createdAt);
        const cards = notes.flatMap((n) => flashcards(n.text));
        const parts = notes.map((n) => ({ n, ...splitCards(n.text) })).filter((p) => p.body);
        const plain = parts.map((p) => p.body);
        const inlineOpts = { taskById: (id) => state.tasks.find((x) => x.id === id), inert: true };
        const inline = (s) => renderInline(s, inlineOpts);
        const quizNote = quiz ? `<span class="fineprint">Quiz: ${quiz.right} of ${quiz.total} right</span>` : '';
        const nextFor = (r) => {
          const step = r === 'hard' ? 0 : Math.min(REVIEW_STEPS.length - 1, t.step + (r === 'easy' ? 2 : 1));
          return shortDate(addDays(todayKey(), REVIEW_STEPS[step]));
        };

        body.innerHTML = `
          <p class="review-count num">${i + 1} of ${queue.length}</p>
          <h3 class="review-title">${subject ? `<span class="dot" style="background:${subject.colour}"></span>` : ''}${esc(t.name)}</h3>
          <p class="fineprint" style="margin-top:2px">${[subject?.name, t.lastReviewed ? `last reviewed ${shortDate(t.lastReviewed).toLowerCase()}` : 'first review'].filter(Boolean).map(esc).join(' · ')}</p>
          ${plain.length ? `<div class="review-notes">${parts.map((p, j) => `<div class="note-body" data-n="${j}">${noteBodyHTML(p.body)}</div>`).join('')}</div>` : ''}
          ${cards.length ? `<div class="review-tools"><button type="button" class="text-button primary" data-quiz>Quiz me on these cards</button>${quizNote}</div>
          <div class="cards">${cards.map((c, j) => c.type === 'cloze' ? `
            <button type="button" class="card" data-card="${j}" aria-expanded="false">
              <span class="q">${clozeHTML(c.q, inlineOpts, true)}</span>
              <span class="reveal">Tap to show the blanks</span>
            </button>` : `
            <button type="button" class="card" data-card="${j}" aria-expanded="false">
              <span class="q">${inline(c.q)}</span>
              <span class="a" hidden>${inline(c.a)}</span>
              <span class="reveal">Tap to show answer</span>
            </button>`).join('')}</div>` : ''}
          ${!plain.length && !cards.length ? '<p class="empty">This topic has no notes.</p>' : ''}
          <div class="rate">
            <p class="fineprint">How well did you know it?</p>
            <div class="rate-buttons">
              ${[['hard', 'Hard'], ['ok', 'OK'], ['easy', 'Easy']].map(([r, l]) => `
                <button type="button" class="rate-btn${quiz?.rating === r ? ' suggested' : ''}" data-r="${r}"><strong>${l}</strong><span>${esc(nextFor(r))}</span></button>`).join('')}
            </div>
          </div>`;

        body.querySelectorAll('.review-notes [data-n]').forEach((el) => {
          const p = parts[el.dataset.n];
          wireNoteBody(el, (line) => {
            p.body = toggleTodo(p.body, line);
            p.n = { ...p.n, text: joinCards(p.body, p.cards) };
            store.saveNote({ ...p.n, topicName: t.name });
            el.innerHTML = noteBodyHTML(p.body);
          });
        });
        body.querySelectorAll('.card').forEach((c) => c.addEventListener('click', () => {
          const open = c.getAttribute('aria-expanded') === 'true';
          c.setAttribute('aria-expanded', !open);
          c.querySelector('.a')?.toggleAttribute('hidden', open);
          c.querySelectorAll('.blank').forEach((b) => b.classList.toggle('hidden-blank', open));
          c.querySelector('.reveal').hidden = !open;
        }));
        body.querySelector('[data-quiz]')?.addEventListener('click', () => openQuiz([t.id], {
          onDone: (rating, right, total) => { quiz = { rating, right, total }; draw(); },
        }));
        body.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', async () => {
          await store.rateTopic(t.id, b.dataset.r);
          rated.push(t.name);
          quiz = null;
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
