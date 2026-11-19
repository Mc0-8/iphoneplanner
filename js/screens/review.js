// The 15-minute review: go through each topic's notes, flip through its flashcards, then rate it Easy / OK / Hard.

import { icon } from '../icons.js';
import { esc, h, openSheet, toast } from '../ui.js';
import * as store from '../store.js';
import { state, flashcards, REVIEW_STEPS } from '../store.js';
import { splitCards, joinCards, toggleTodo } from '../notes-format.js';
import { noteBodyHTML, wireNoteBody } from './notes.js';
import { openQuiz } from './quiz.js';
import { openFlashcards, boxBar, countsFor } from './flip.js';
import { confetti } from '../celebrate.js';
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
        const quizNote = quiz ? `<span class="fineprint">${quiz.from}: ${quiz.right} of ${quiz.total} right</span>` : '';
        const nextFor = (r) => {
          const step = r === 'hard' ? 0 : Math.min(REVIEW_STEPS.length - 1, t.step + (r === 'easy' ? 2 : 1));
          return shortDate(addDays(todayKey(), REVIEW_STEPS[step]));
        };

        body.innerHTML = `
          <p class="review-count num">${i + 1} of ${queue.length}</p>
          <h3 class="review-title">${subject ? `<span class="dot" style="background:${subject.colour}"></span>` : ''}${esc(t.name)}</h3>
          <p class="fineprint" style="margin-top:2px">${[subject?.name, t.lastReviewed ? `last reviewed ${shortDate(t.lastReviewed).toLowerCase()}` : 'first review'].filter(Boolean).map(esc).join(' · ')}</p>
          ${plain.length ? `<div class="review-notes">${parts.map((p, j) => `<div class="note-body" data-n="${j}">${noteBodyHTML(p.body)}</div>`).join('')}</div>` : ''}
          ${cards.length ? `<div class="flip-start${subject ? ' tinted' : ''}"${subject ? ` style="--sc:${subject.colour}"` : ''}>
            <button type="button" class="quiz-btn wide" data-flip>Flip through ${cards.length} card${cards.length === 1 ? '' : 's'}</button>
            ${boxBar(countsFor([t.id]), { labels: true })}
          </div>
          <div class="review-tools"><button type="button" class="text-button primary" data-quiz>Quiz me instead</button>${quizNote}</div>` : ''}
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
        body.querySelector('[data-flip]')?.addEventListener('click', () => openFlashcards([t.id], {
          onDone: (rating, right, total) => { quiz = { rating, right, total, from: 'Cards' }; draw(); },
        }));
        body.querySelector('[data-quiz]')?.addEventListener('click', () => openQuiz([t.id], {
          onDone: (rating, right, total) => { quiz = { rating, right, total, from: 'Quiz' }; draw(); },
        }));
        body.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', async () => {
          await store.rateTopic(t.id, b.dataset.r);
          rated.push(t.name);
          quiz = null;
          i++;
          if (i < queue.length) { draw(); body.scrollTop = 0; return; }
          close();
          toast(`Reviewed ${rated.length} topic${rated.length === 1 ? '' : 's'}`);
          confetti();
        }));
      };
      draw();
    },
  });
}
