import { icon } from '../icons.js';
import { esc, h, openSheet, toast, confirmSheet } from '../ui.js';
import * as store from '../store.js';
import { state } from '../store.js';

export function openListManager() {
  openSheet({
    title: 'Lists',
    build(body) {
      const draw = () => {
        body.innerHTML = `
          <div class="rows-wrap"></div>
          <form class="new-list">
            <input class="input" name="name" placeholder="New list name" aria-label="New list name" autocomplete="off">
            <button class="text-button primary" type="submit">Add</button>
          </form>
          <p class="fineprint">Deleting a list keeps its tasks. They move to "No list", or back to the inbox if they have no deadline.</p>`;
        const wrap = body.querySelector('.rows-wrap');
        if (!state.lists.length) wrap.append(h('<p class="empty">No lists yet.</p>'));
        for (const l of state.lists) {
          const row = h(`
            <div class="list-edit">
              <input class="input" value="${esc(l.name)}" aria-label="List name">
              <button class="icon-button" aria-label="Delete ${esc(l.name)}">${icon('trash', 20)}</button>
            </div>`);
          const input = row.querySelector('input');
          input.addEventListener('change', () => store.renameList(l.id, input.value));
          row.querySelector('button').addEventListener('click', async () => {
            const n = state.tasks.filter((t) => t.listId === l.id && !t.completed).length;
            if (n && !(await confirmSheet({ title: 'Delete list?', message: `"${l.name}" has ${n} open task${n === 1 ? '' : 's'}. ${n === 1 ? 'It' : 'They'} will be kept, without a list.`, confirm: 'Delete list' }))) return;
            await store.deleteList(l.id);
            toast(`Deleted "${l.name}"`);
            draw();
          });
          wrap.append(row);
        }
        body.querySelector('form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const name = e.target.name.value.trim();
          if (!name) return;
          await store.addList(name);
          draw();
          body.querySelector('form input').focus();
        });
      };
      draw();
    },
  });
}
