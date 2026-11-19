// Flashcards: one big card at a time. Tap to flip, then "Got it" or "Missed it" (or swipe right / left).
// Each card sits in box 1, 2 or 3 (store.cardBox). Box 1 cards come first. Got it → up a box, Missed it → box 1.
// The first run's score suggests a review rating, like Quiz me.

import { esc, openSheet, toast } from '../ui.js';
import * as store from '../store.js';
import { state, flashcards } from '../store.js';
import { renderInline } from '../notes-format.js';
import { clozeHTML } from './notes.js';
import { confetti } from '../celebrate.js';

const RATING = (pct) => (pct >= 0.9 ? 'easy' : pct >= 0.6 ? 'ok' : 'hard');
const LABEL = { easy: 'Easy', ok: 'OK', hard: 'Hard' };
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Every card of these topics, with the topic it belongs to. */
export function cardsFor(topicIds) {
  return topicIds.flatMap((id) => {
    const t = state.topics.find((x) => x.id === id);
    if (!t) return [];
    return state.notes.filter((n) => n.topicId === id).sort((a, b) => a.createdAt - b.createdAt)
      .flatMap((n) => flashcards(n.text)).map((card) => ({ card, topic: t }));
  });
}

/** Box counts over several topics: [box 1, box 2, box 3]. */
export function countsFor(topicIds) {
  const n = [0, 0, 0];
  for (const { card, topic } of cardsFor(topicIds)) n[store.cardBox(topic, card) - 1]++;
  return n;
}

/** A small three-part bar showing how many cards are in each box. `labels` adds the numbers underneath. */
export function boxBar(counts, { labels = false } = {}) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return '';
  const name = `${counts[0]} in box 1, ${counts[1]} in box 2, ${counts[2]} in box 3`;
  return `<span class="boxbar${labels ? ' big' : ''}" role="img" aria-label="${name}">
    <span class="boxbar-track">${counts.map((n, i) => (n ? `<span class="b${i + 1}" style="flex:${n}"></span>` : '')).join('')}</span>
    ${labels ? `<span class="boxbar-keys num">${counts.map((n, i) => `<span><i class="b${i + 1}"></i>Box ${i + 1}: ${n}</span>`).join('')}</span>` : ''}
  </span>`;
}

/**
 * @param topicIds topics whose cards are shown
 * @param onDone(rating, right, total) from a review: the end screen hands the score back.
 */
export function openFlashcards(topicIds, { onDone } = {}) {
  const all = cardsFor(topicIds);
  if (!all.length) { toast('Add flashcards to this topic first'); return; }
  const topics = topicIds.map((id) => state.topics.find((t) => t.id === id)).filter(Boolean);
  const inlineOpts = { taskById: (id) => state.tasks.find((x) => x.id === id), inert: true };
  const inline = (s) => renderInline(s, inlineOpts);
  const colour = (t) => store.subjectById(t.subjectId)?.colour;

  let deck, i, right, missed, first = null; // the first full run's score sets the rating

  openSheet({
    title: topics.length === 1 ? topics[0].name : 'Flashcards',
    full: true,
    build(body, close) {
      body.classList.add('flip-body');
      if (colour(topics[0])) body.style.setProperty('--bx', colour(topics[0]));

      // Box 1 first, then 2, then 3; shuffled inside each box.
      const start = (cards) => {
        const byBox = [[], [], []];
        for (const x of cards) byBox[store.cardBox(x.topic, x.card) - 1].push(x);
        deck = byBox.flatMap(shuffle);
        i = 0; right = 0; missed = [];
        show();
      };

      const counts = () => {
        const n = [0, 0, 0];
        for (const x of all) n[store.cardBox(x.topic, x.card) - 1]++;
        return n;
      };

      const show = () => {
        const { card, topic } = deck[i];
        const box = store.cardBox(topic, card);
        const sc = colour(topic);
        const cloze = card.type === 'cloze';
        const n = counts();
        body.innerHTML = `
          <div class="flip-top">
            <span class="review-count num">${i + 1} of ${deck.length}</span>
            <span class="flip-boxes num" aria-label="Cards per box"><span class="fbox-label">Boxes</span>${n.map((x, j) => `<span class="fbox b${j + 1}${j + 1 === box ? ' here' : ''}" data-box="${j + 1}">${x}</span>`).join('')}</span>
          </div>
          <div class="flip-progress"><span style="width:${(i / deck.length) * 100}%"></span></div>
          <div class="flip-stage">
            <button type="button" class="flip-card${sc ? ' tinted' : ''}"${sc ? ` style="--sc:${sc}"` : ''} aria-label="Card. Tap to flip" aria-pressed="false">
              <span class="flip-inner">
                <span class="flip-face front">
                  <span class="flip-label">${cloze ? 'Fill in the blanks' : 'Question'} · Box ${box}</span>
                  <span class="flip-text${cloze ? ' cloze' : ''}">${cloze ? clozeHTML(card.q, inlineOpts, true) : inline(card.q)}</span>
                  <span class="flip-hint">Tap to flip</span>
                </span>
                <span class="flip-face back">
                  <span class="flip-label">Answer${topics.length > 1 ? ` · ${esc(topic.name)}` : ''}</span>
                  <span class="flip-text${cloze ? ' cloze' : ''}">${cloze ? clozeHTML(card.q, inlineOpts) : inline(card.a)}</span>
                  ${cloze ? '' : `<span class="flip-ask">${inline(card.q)}</span>`}
                </span>
              </span>
              <span class="flip-stamp got">Got it</span>
              <span class="flip-stamp miss">Missed it</span>
            </button>
          </div>
          <div class="flip-actions" aria-hidden="true">
            <button type="button" class="flip-btn miss" data-ans="0" disabled><span aria-hidden="true">✕</span> Missed it</button>
            <button type="button" class="flip-btn got" data-ans="1" disabled><span aria-hidden="true">✓</span> Got it</button>
          </div>
          <p class="fineprint flip-tip">${i === 0 && !first ? 'Swipe right if you got it, left if you missed it.' : '&nbsp;'}</p>`;
        wire();
      };

      const wire = () => {
        const cardEl = body.querySelector('.flip-card');
        const actions = body.querySelector('.flip-actions');
        let flipped = false, busy = false;

        const flip = () => {
          if (busy) return;
          flipped = !flipped;
          cardEl.classList.toggle('flipped', flipped);
          cardEl.setAttribute('aria-pressed', flipped);
          if (flipped) {
            actions.classList.add('ready');
            actions.removeAttribute('aria-hidden');
            actions.querySelectorAll('button').forEach((b) => { b.disabled = false; });
          }
        };

        const answer = async (got) => {
          if (busy) return;
          busy = true;
          const { card, topic } = deck[i];
          cardEl.classList.add(got ? 'out-right' : 'out-left');
          const box = await store.rateCard(topic.id, card, got);
          if (got) right++; else missed.push(deck[i]);
          const fbox = body.querySelector(`.fbox[data-box="${box}"]`);
          if (fbox) { fbox.classList.remove('bump'); void fbox.offsetWidth; fbox.classList.add('bump'); }
          setTimeout(() => {
            if (!body.isConnected) return;
            i++;
            if (i < deck.length) show(); else finish();
          }, reduced() ? 0 : 260);
        };

        // Tap flips; a sideways drag (once flipped) answers.
        let x0 = null, y0 = 0, dx = 0, dragging = false;
        cardEl.addEventListener('pointerdown', (e) => { if (busy) return; x0 = e.clientX; y0 = e.clientY; dx = 0; dragging = false; });
        cardEl.addEventListener('pointermove', (e) => {
          if (x0 === null || !flipped) return;
          dx = e.clientX - x0;
          if (!dragging && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(e.clientY - y0)) { dragging = true; cardEl.setPointerCapture?.(e.pointerId); cardEl.classList.add('dragging'); }
          if (!dragging) return;
          cardEl.style.setProperty('--dx', `${dx}px`);
          cardEl.classList.toggle('lean-right', dx > 40);
          cardEl.classList.toggle('lean-left', dx < -40);
        });
        const end = () => {
          if (x0 === null) return;
          x0 = null;
          if (!dragging) return;
          cardEl.classList.remove('dragging', 'lean-right', 'lean-left');
          if (Math.abs(dx) > 90) { answer(dx > 0); return; }
          cardEl.style.setProperty('--dx', '0px');
        };
        cardEl.addEventListener('pointerup', end);
        cardEl.addEventListener('pointercancel', end);
        cardEl.addEventListener('click', (e) => {
          if (dragging) { e.preventDefault(); dragging = false; return; }
          flip();
        });
        actions.querySelectorAll('[data-ans]').forEach((b) => b.addEventListener('click', () => answer(b.dataset.ans === '1')));
      };

      const finish = () => {
        const total = deck.length;
        const firstRun = !first;
        if (!first) first = { right, total };
        const rating = RATING(first.right / first.total);
        const n = counts();
        body.innerHTML = `
          <p class="review-count">Done</p>
          <h3 class="review-title num">${right} of ${total} right</h3>
          <p class="fineprint">${right === total ? 'Every card. Nice work!' : `${missed.length} card${missed.length === 1 ? '' : 's'} went back to box 1.`}</p>
          <div class="box-summary">
            ${n.map((x, j) => `<div class="box-tile b${j + 1}"><span class="box-n num">${x}</span><span class="box-name">Box ${j + 1}</span><span class="box-what">${['Still learning', 'Getting there', 'Know it'][j]}</span></div>`).join('')}
          </div>
          ${missed.length ? `<button type="button" class="quiz-btn wide" data-again>Go again on the ${missed.length} I missed</button>` : ''}
          <p class="fineprint">${first.total !== total ? `First try: ${first.right} of ${first.total}. ` : ''}That suggests <strong>${LABEL[rating]}</strong> for this topic's review.</p>
          ${onDone ? `<button type="button" class="${missed.length ? 'text-button primary' : 'quiz-btn wide'}" data-back>Back to review</button>`
            : topics.length === 1 ? `<div class="rate"><p class="fineprint">Count this as today's review?</p><div class="rate-buttons">
                ${['hard', 'ok', 'easy'].map((r) => `<button type="button" class="rate-btn${r === rating ? ' suggested' : ''}" data-r="${r}"><strong>${LABEL[r]}</strong></button>`).join('')}
              </div></div>` : ''}
          ${!onDone ? '<button type="button" class="text-button" data-close-flip>Not now</button>' : ''}`;
        if (firstRun && right === total) confetti(topics.map(colour).filter(Boolean));
        body.querySelector('[data-back]')?.addEventListener('click', () => { close(); onDone(rating, first.right, first.total); });
        body.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', async () => {
          await store.rateTopic(topics[0].id, b.dataset.r);
          close();
          toast(`Reviewed ${topics[0].name}`);
        }));
        body.querySelector('[data-again]')?.addEventListener('click', () => start(missed));
        body.querySelector('[data-close-flip]')?.addEventListener('click', close);
      };

      start(all);
    },
  });
}
