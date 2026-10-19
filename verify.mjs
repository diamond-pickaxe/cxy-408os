import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const root = dirname(fileURLToPath(import.meta.url));
const blocked = resolve('D:/desktop/文档/secret').toLowerCase();
function path(name) {
  const file = resolve(root, name);
  if (file.toLowerCase() === blocked || file.toLowerCase().startsWith(blocked + sep) || !file.startsWith(root + sep)) throw Error('Protected/outside path');
  return file;
}
const read = name => readFile(path(name), 'utf8');
const box = { window: {} };
runInNewContext(await read('data.js'), box);
runInNewContext(await read('seed.js'), box);
const data = box.window.OFFLINE_DATA, seed = box.window.OFFLINE_SEED;
assert.equal(data.questions.length, 846);
assert.equal(new Set(data.questions.map(q => q.id)).size, 846);
for (let year = 2009; year <= 2026; year++) assert.equal(data.questions.filter(q => q.year === year).length, 47);
for (const question of data.questions) {
  assert.equal(question.id, 47 * (question.year - 2009) + question.questionIndex);
  for (const field of ['questionHtml', 'answerHtml', 'analysisHtml']) {
    assert.ok(question[field].includes('<body'));
    assert.ok(!/<script\b/i.test(question[field]));
    assert.ok(!/\b(?:src|poster|xlink:href)\s*=\s*["'](?!data:|#)/i.test(question[field]));
    assert.ok(!/url\(\s*["']?(?:https?:|\/\/)/i.test(question[field]));
  }
  assert.ok(!Object.hasOwn(question, 'currentMastery'));
  assert.ok(!Object.hasOwn(question, 'masteryHistory'));
  assert.ok(!Object.hasOwn(question, 'isCollected'));
}
for (const field of ['mastery', 'notes', 'attempts', 'collections']) assert.equal(Object.keys(seed[field]).length, 0, `Release seed includes personal data: ${field}`);
assert.equal(seed.migration.marked, 0);
const vendor = await read('vendor.js');
assert.ok(!/url\(\s*["']?(?:https?:|\/\/|\/assets)/i.test(vendor));
const html = await read('宇的大观本地版.html');
assert.ok(!/<script\b[^>]*\bsrc\s*=/i.test(html));
assert.ok(!/<link\b/i.test(html.slice(0, html.indexOf('<body>'))));
assert.ok(html.includes("connect-src 'none'"));
const embedded = html.match(/window\.OFFLINE_SEED=(\{.*?\});<\/script>/s);
assert.ok(embedded, 'Embedded release seed not found');
const embeddedSeed = JSON.parse(embedded[1]);
for (const field of ['mastery', 'notes', 'attempts', 'collections']) assert.equal(Object.keys(embeddedSeed[field]).length, 0, `HTML includes personal data: ${field}`);
const result = { passed: true, questionTriples: 846, resourcesEmbedded: true, formulaFontsEmbedded: true, standalone: true, personalRecordsIncluded: false, htmlBytes: Buffer.byteLength(html), sha256: createHash('sha256').update(html).digest('hex'), checkedAt: new Date().toISOString() };
await writeFile(path('offline-check.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
