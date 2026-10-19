import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const blocked = resolve('D:/desktop/文档/secret').toLowerCase();
function safePath(name) {
  const file = resolve(root, name);
  if (file.toLowerCase() === blocked || file.toLowerCase().startsWith(blocked + sep) || !file.startsWith(root + sep)) throw Error('Protected/outside path');
  return file;
}
const [html, script, dataScript, seedScript] = await Promise.all(['index.html', 'app.js', 'data.js', 'seed.js'].map(name => readFile(safePath(name), 'utf8')));
const dataBox = { window: {} };
runInNewContext(dataScript, dataBox);
runInNewContext(seedScript, dataBox);
const windows = [];
function boot(saved) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:4188/', runScripts: 'outside-only', virtualConsole: console });
  const { window } = dom;
  windows.push(window);
  window.structuredClone = structuredClone;
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.matchMedia = () => ({ matches: true, addEventListener() {} });
  window.IntersectionObserver = class { observe() {} disconnect() {} };
  window.ResizeObserver = class { observe() {} disconnect() {} };
  window.HTMLDialogElement.prototype.show = function () { this.open = true; };
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  window.OFFLINE_DATA = structuredClone(dataBox.window.OFFLINE_DATA);
  window.OFFLINE_SEED = structuredClone(dataBox.window.OFFLINE_SEED);
  if (saved) window.localStorage.setItem('408-offline-v1', saved);
  window.eval(script);
  return { window, document: window.document, errors };
}
const app = boot();
const $ = id => app.document.getElementById(id);
const click = selector => { const el = app.document.querySelector(selector); assert.ok(el, selector); el.click(); };
const select = (id, value) => { $(id).value = value; $(id).dispatchEvent(new app.window.Event('change')); };
const scopeIds = () => [...app.document.querySelectorAll('.in-scope')].map(e => Number(e.dataset.q)).sort((a, b) => a - b);
const sessionIds = () => [...app.document.querySelectorAll('[data-exercise]')].map(e => Number(e.dataset.exercise)).sort((a, b) => a - b);
const savedState = () => JSON.parse(app.window.localStorage.getItem('408-offline-v1'));

test('release starts with 846 questions and no personal records', () => {
  assert.equal(app.document.title, '宇的大观本地版');
  assert.equal(app.document.querySelectorAll('.cell').length, 846);
  assert.equal(Object.keys(savedState().mastery).length, 0);
  assert.equal(Object.keys(savedState().notes).length, 0);
  assert.deepEqual(savedState().collections, []);
  assert.equal(app.errors.length, 0);
});

test('subject, chapter and subsection include the expected descendant questions', () => {
  click('[data-knowledge="1"]');
  assert.equal(scopeIds().length, 233);
  click('[data-knowledge="4"]');
  assert.deepEqual(scopeIds(), [42, 183, 229, 323, 330, 331, 511, 565, 659, 660, 706, 800, 801]);
  const chapter = scopeIds();
  $('continue').click();
  assert.deepEqual(sessionIds(), chapter);
  click('#backMap');
  click('[data-knowledge="5"]');
  assert.deepEqual(scopeIds(), [229, 659, 800]);
  const section = scopeIds();
  $('continue').click();
  assert.deepEqual(sessionIds(), section);
  click('#backMap');
  click('[data-knowledge="46"]');
  assert.equal($('chapter').value, '');
  assert.equal($('knowledge').value, '');
  assert.equal(scopeIds().length, 235);
});

test('type filter and start use the same exact question scope', () => {
  click('[data-knowledge="4"]');
  select('type', '1');
  const choices = scopeIds();
  assert.deepEqual(choices, [330, 331, 565, 659, 660, 706, 800, 801]);
  $('continue').click();
  assert.deepEqual(sessionIds(), choices);
  click('#backMap');
  select('type', '2');
  assert.equal(scopeIds().length, 5);
});

test('year click clears an old scope and opens all 47 questions; types yield 40 and 7', () => {
  select('mastery', '3');
  $('search').value = 'a search that does not match';
  click('[data-year="2026"]');
  assert.deepEqual(sessionIds(), Array.from({ length: 47 }, (_, i) => 800 + i));
  for (const id of ['subject', 'chapter', 'knowledge', 'mastery', 'type', 'search']) assert.equal($(id).value, '');
  click('[data-session-type="1"]');
  assert.equal(sessionIds().length, 40);
  click('[data-session-type="2"]');
  assert.equal(sessionIds().length, 7);
  click('[data-session-type=""]');
  assert.equal(sessionIds().length, 47);
});

test('answers, marks and notes persist without removing questions from an active session', () => {
  click('[data-exercise="800"] [data-session-choice="A"]');
  click('[data-exercise="800"] [data-session-answer]');
  assert.equal(savedState().answers[800].correct, true);
  assert.equal(savedState().history[800].filter(e => e.type === 'answer').length, 1);
  click('[data-exercise="800"] [data-session-answer]');
  click('[data-exercise="800"] [data-session-answer]');
  assert.equal(savedState().history[800].filter(e => e.type === 'answer').length, 1);
  click('[data-exercise="800"] [data-session-level="2"]');
  assert.equal(savedState().mastery[800], 2);
  click('[data-exercise="800"] [data-edit]');
  $('note').value = '离线升级后保留的测试笔记';
  $('note').dispatchEvent(new app.window.Event('input'));
  $('closeStudy').click();
  assert.equal(sessionIds().length, 47);
  assert.match(app.document.querySelector('[data-exercise="800"] .session-note').textContent, /测试笔记/);
  assert.equal(app.document.querySelector('[data-exercise="800"] [data-session-level="2"]').getAttribute('aria-pressed'), 'true');
});

test('restart preserves the latest local state and does not reapply the original seed', () => {
  const restarted = boot(app.window.localStorage.getItem('408-offline-v1'));
  const state = JSON.parse(restarted.window.localStorage.getItem('408-offline-v1'));
  assert.equal(state.mastery[800], 2);
  assert.equal(state.notes[800], '离线升级后保留的测试笔记');
  assert.equal(state.answers[800].correct, true);
  assert.equal(restarted.errors.length, 0);
});

test('exported progress can be imported with an automatic copy of the previous state', async () => {
  let exported;
  app.window.Blob = Blob;
  app.window.URL.createObjectURL = blob => { exported = blob; return 'blob:test-backup'; };
  app.window.URL.revokeObjectURL = () => {};
  app.window.HTMLAnchorElement.prototype.click = function () {};
  app.window.confirm = () => true;
  $('export').click();
  const payload = JSON.parse(await exported.text());
  assert.equal(payload.format, '408-offline-progress');
  assert.equal(payload.state.mastery[800], 2);
  click('[data-exercise="800"] [data-session-level="3"]');
  const input = $('importFile');
  Object.defineProperty(input, 'files', { configurable: true, value: [{ size: exported.size, text: () => exported.text() }] });
  await input.onchange({ target: input });
  assert.equal(savedState().mastery[800], 2);
  assert.equal(savedState().notes[800], '离线升级后保留的测试笔记');
  assert.equal(JSON.parse(app.window.localStorage.getItem('408-offline-v1-before-import')).mastery[800], 3);
});

test('an empty selection cannot start; reset restores all 846 questions', () => {
  click('#backMap');
  $('reset').click();
  $('search').value = 'no-result-unique-5c79d3';
  select('type', '1');
  assert.equal(scopeIds().length, 0);
  assert.equal($('continue').disabled, true);
  $('reset').click();
  assert.equal(app.document.querySelectorAll('.cell:not(.out)').length, 846);
  assert.equal($('continue').disabled, false);
});

after(() => { for (const window of windows) window.close(); });
