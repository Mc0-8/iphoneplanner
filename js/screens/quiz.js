// Quiz mode: ask a topic's flashcards one at a time, as typed answers or multiple choice.
// Fill-in-the-blank cards give one question per blank. The score suggests a review rating.

import { esc, openSheet, toast } from '../ui.js';
import * as store from '../store.js';
import { state, flashcards } from '../store.js';
import { quizItems, checkAnswer, normalizeAnswer, renderInline } from '../notes-format.js';

const RATING = (pct) => (pct >= 0.9 ? 'easy' : pct >= 0.6 ? 'ok' : 'hard');
const LABEL = { easy: 'Easy', ok: 'OK', hard: 'Hard' };
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const cardsOf = (topicIds) => state.notes.filter((n) => topicIds.includes(n.topicId))
  .sort((a, b) => a.createdAt - b.createdAt).flatMap((n) => flashcards(n.text));

/** Number of quiz questions the topics would give (0 means no quiz). */
export const quizCount = (topicIds) => quizItems(cardsOf(topicIds)).length;

/**
 * @param topicIds topics whose cards are asked
 * @param onDone(rating, right, total) when given (from a review), the end screen hands the result back
 *   instead of offering to save it as the review.
 */
export function openQuiz(topicIds, { onDone } = {}) {
  const all = quizItems(cardsOf(topicIds));
  if (!all.length) { toast('Add flashcards to this topic first'); return; }
  const topics = topicIds.map((id) => state.topics.find((t) => t.id === id)).filter(Boolean);
  // Wrong choices for multiple choice come from these cards plus the rest of the subject's cards.
  const subjects = new Set(topics.map((t) => t.subjectId));
  const poolTopics = state.topics.filter((t) => subjects.has(t.subjectId)).map((t) => t.id);
  const pool = quizItems(cardsOf([...new Set([...topicIds, ...poolTopics])]));
  const inline = (s) => renderInline(s, { taskById: (id) => state.tasks.find((x) => x.id === id), inert: true })
    .replace(/_{4}/g, '<span class="quiz-blank" aria-label="blank"></span>');

  let mode = state.settings.quizMode === 'choice' ? 'choice' : 'type';
  let items, i, right, missed, first = null; // the first full run's score sets the rating

  openSheet({
    title: 'Quiz',
    full: true,
    build(body, close) {
      const start = (list) => { items = shuffle([...list]); i = 0; right = 0; missed = []; ask(); };

      const intro = () => {
        body.innerHTML = `
          <p class="review-count num">${all.length} question${all.length === 1 ? '' : 's'}</p>
          <h3 class="review-title">${esc(topics.map((t) => t.name).join(', ') || 'Quiz')}</h3>
          <div class="field" style="margin-top:20px">
            <span class="label">How to answer</span>
            <div class="segmented" data-mode>
              <button type="button" data-v="type" aria-pressed="${mode === 'type'}">Type it</button>
              <button type="button" data-v="choice" aria-pressed="${mode === 'choice'}">Multiple choice</button>
            </div>
          </div>
          <button type="button" class="quiz-btn wide" data-quiz-start>Start</button>`;
        body.querySelectorAll('[data-mode] button').forEach((b) => b.addEventListener('click', () => {
          mode = b.dataset.v;
          body.querySelectorAll('[data-mode] button').forEach((x) => x.setAttribute('aria-pressed', x === b));
          store.updateSettings({ quizMode: mode });
        }));
        body.querySelector('[data-quiz-start]').addEventListener('click', () => start(all));
      };

      const choicesFor = (it) => {
        const key = normalizeAnswer(it.answer);
        const seen = new Set([key]);
        const wrong = [];
        // Same kind of card first (blanks with blanks), then any.
        for (const pass of [true, false]) {
          if (!pass && wrong.length >= 2) break; // enough of the same kind: don't mix in odd ones
          for (const p of shuffle([...pool])) {
            const k = normalizeAnswer(p.answer);
            if (wrong.length >= 3 || seen.has(k) || (pass && p.cloze !== it.cloze)) continue;
            seen.add(k); wrong.push(p.answer);
          }
        }
        return wrong.length ? shuffle([it.answer, ...wrong]) : null;
      };

      const ask = () => {
        const it = items[i];
        const choices = mode === 'choice' ? choicesFor(it) : null;
        body.innerHTML = `
          <p class="review-count num">${i + 1} of ${items.length}</p>
          <p class="quiz-prompt">${inline(it.prompt)}</p>
          ${choices ? `<div class="quiz-choices">${choices.map((c, j) => `<button type="button" class="quiz-choice" data-c="${j}">${inline(c)}</button>`).join('')}</div>`
            : `<form class="quiz-type">
                <input class="input" data-answer autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" placeholder="${it.cloze ? 'Missing word' : 'Your answer'}" aria-label="Your answer">
                <button type="submit" class="quiz-btn">Check</button>
              </form>
              ${mode === 'choice' ? '<p class="fineprint">Not enough other answers for choices, so type this one.</p>' : ''}`}
          <div class="quiz-result" aria-live="polite"></div>`;
        const result = body.querySelector('.quiz-result');
        const next = () => { i++; if (i < items.length) ask(); else finish(); body.scrollTop = 0; };
        const show = (ok, extra = '') => {
          if (ok) right++; else missed.push(it);
          result.innerHTML = `
            <p class="quiz-verdict ${ok ? 'ok' : 'no'}">${ok ? 'Right' : 'Not quite'}</p>
            ${ok && !extra ? '' : `<p class="quiz-answer">${extra || `Answer: <strong>${inline(it.answer)}</strong>`}</p>`}
            <div class="quiz-next">
              ${!ok && !choices ? '<button type="button" class="text-button" data-mine>I was right</button>' : ''}
              <button type="button" class="quiz-btn" data-next>${i + 1 < items.length ? 'Next' : 'See score'}</button>
            </div>`;
          result.querySelector('[data-mine]')?.addEventListener('click', () => { right++; missed.pop(); next(); });
          const nb = result.querySelector('[data-next]');
          nb.addEventListener('click', next);
          nb.focus({ preventScroll: true });
        };

        if (choices) {
          body.querySelectorAll('.quiz-choice').forEach((b) => b.addEventListener('click', () => {
            const ok = choices[b.dataset.c] === it.answer;
            body.querySelectorAll('.quiz-choice').forEach((x) => {
              x.disabled = true;
              if (choices[x.dataset.c] === it.answer) x.classList.add('right');
            });
            if (!ok) b.classList.add('wrong');
            show(ok);
          }));
        } else {
          const form = body.querySelector('form');
          const input = form.querySelector('input');
          setTimeout(() => input.focus(), 60);
          form.addEventListener('submit', (e) => {
            e.preventDefault();
            if (input.disabled) return;
            const v = checkAnswer(input.value, it.answer);
            input.disabled = true;
            form.querySelector('button').hidden = true;
            show(v !== 'wrong', v === 'close' ? `Close enough. Exact answer: <strong>${inline(it.answer)}</strong>` : '');
          });
        }
      };

      const finish = () => {
        const total = items.length;
        if (!first) first = { right, total };
        const rating = RATING(first.right / first.total);
        body.innerHTML = `
          <p class="review-count">Done</p>
          <h3 class="review-title num">${right} of ${total} right</h3>
          <p class="fineprint">${first.total !== total ? `First try: ${first.right} of ${first.total}. ` : ''}That suggests <strong>${LABEL[rating]}</strong> for this topic's review.</p>
          ${onDone ? `<button type="button" class="quiz-btn wide" data-back>Back to review</button>`
            : topics.length === 1 ? `<div class="rate"><p class="fineprint">Count this as today's review?</p><div class="rate-buttons">
                ${['hard', 'ok', 'easy'].map((r) => `<button type="button" class="rate-btn${r === rating ? ' suggested' : ''}" data-r="${r}"><strong>${LABEL[r]}</strong></button>`).join('')}
              </div></div>` : ''}
          ${missed.length ? `<button type="button" class="text-button primary" data-again>Practise the ${missed.length} I missed</button>` : ''}
          ${!onDone ? '<button type="button" class="text-button" data-close-quiz>Not now</button>' : ''}`;
        body.querySelector('[data-back]')?.addEventListener('click', () => { close(); onDone(rating, first.right, first.total); });
        body.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', async () => {
          await store.rateTopic(topics[0].id, b.dataset.r);
          close();
          toast(`Reviewed ${topics[0].name}`);
        }));
        body.querySelector('[data-again]')?.addEventListener('click', () => { const m = missed; start(m); });
        body.querySelector('[data-close-quiz]')?.addEventListener('click', close);
      };

      intro();
    },
  });
}
