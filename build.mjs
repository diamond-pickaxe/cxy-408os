import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = dirname(fileURLToPath(import.meta.url));
const blocked = resolve('D:/desktop/文档/secret').toLowerCase();
function path(name) {
  const file = resolve(root, name);
  if (file.toLowerCase() === blocked || file.toLowerCase().startsWith(blocked + sep) || !file.startsWith(root + sep)) throw Error('Protected/outside path');
  return file;
}
const read = name => readFile(path(name), 'utf8');
const manifest = JSON.parse(await read('manifest.json'));
if (manifest.downloaded !== 846 || manifest.missing.length) throw Error('Incomplete question backup');

// Distributable builds always start without any personal study data.
const seed = {
  mastery: {}, notes: {}, attempts: {}, collections: [],
  migration: { capturedAt: manifest.downloadedAt, marked: 0, studyDays: 0, streak: 0, historyNote: '未预置个人学习记录。可导入自己的备份，或从现在开始记录本地学习进度。' }
};
await writeFile(path('seed.js'), 'window.OFFLINE_SEED=' + JSON.stringify(seed).replace(/</g, '\\u003c') + ';');
let html = await read('index.html');
html = html.replace('<link rel="stylesheet" href="app.css">', '<style>' + await read('app.css') + '</style>');
for (const file of ['data.js', 'seed.js', 'vendor.js', 'app.js']) {
  const content = await read(file);
  html = html.replace('<script src="' + file + '"></script>', () => '<script>' + content.replace(/<\/script/gi, '<\\/script') + '</script>');
}
await writeFile(path('宇的大观本地版.html'), html);
const box = { window: {} };
runInNewContext(await read('data.js'), box);
const data = box.window.OFFLINE_DATA;
const report = { questionCount: data.questions.length, yearCount: new Set(data.questions.map(q => q.year)).size, initialPersonalRecords: 0, externalResourceAttributes: [], missing: manifest.missing };
for (const question of data.questions) for (const field of ['questionHtml', 'answerHtml', 'analysisHtml']) {
  if (!question[field]) throw Error(`Missing ${field} for question ${question.id}`);
  for (const match of question[field].matchAll(/\b(?:src|poster|xlink:href)\s*=\s*["'](?!data:|#)([^"']+)["']/g)) report.externalResourceAttributes.push({ id: question.id, field, url: match[1] });
}
await writeFile(path('verification.json'), JSON.stringify(report, null, 2));
if (report.externalResourceAttributes.length) throw Error('External question resources remain');
console.log(`已生成不含个人记录的单文件离线版：${Buffer.byteLength(html)} bytes，${data.questions.length} 道题`);
