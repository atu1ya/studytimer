/**
 * The task line and its three optional steps.
 * @module ui/task
 */

import { getState, setTask, setSubs } from '../state.js';

/** @type {HTMLInputElement} */
let input;
/** @type {HTMLElement} */
let list;
/** @type {Array<{box: HTMLInputElement, text: HTMLInputElement, row: HTMLElement}>} */
const rows = [];

/**
 * @param {{input: HTMLInputElement, list: HTMLElement}} els
 */
export function init(els) {
  input = els.input;
  list = els.list;

  input.value = getState().task;
  const commit = () => setTask(input.value);
  input.addEventListener('input', commit);
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { commit(); input.blur(); }
  });

  buildRows();
}

function buildRows() {
  const subs = getState().subs;
  const frag = document.createDocumentFragment();

  subs.forEach((sub, i) => {
    const row = document.createElement('li');
    row.className = 'step';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'step__box';
    box.id = `step-${i}`;
    box.checked = sub.done;

    const text = document.createElement('input');
    text.type = 'text';
    text.className = 'step__text';
    text.maxLength = 90;
    text.value = sub.text;
    text.placeholder = 'Add a step';
    text.setAttribute('aria-label', `Step ${i + 1}`);

    const label = document.createElement('label');
    label.className = 'step__label';
    label.htmlFor = box.id;
    label.append(box);
    label.append(Object.assign(document.createElement('span'), { className: 'step__tick' }));

    const save = () => {
      const next = getState().subs.map((s, idx) =>
        idx === i ? { text: text.value, done: box.checked } : s
      );
      setSubs(next);
      row.classList.toggle('is-done', box.checked);
    };

    box.addEventListener('change', save);
    text.addEventListener('input', save);
    text.addEventListener('keydown', (e) => { if (e.key === 'Enter') text.blur(); });

    row.classList.toggle('is-done', sub.done);
    row.append(label, text);
    rows.push({ box, text, row });
    frag.append(row);
  });

  list.replaceChildren(frag);
}
