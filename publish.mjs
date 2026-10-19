import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';

const root = dirname(fileURLToPath(import.meta.url));
const protectedRoot = resolve('D:/desktop/文档/secret').toLowerCase();
function safePath(name) {
  const path = resolve(root, name);
  if (path.toLowerCase() === protectedRoot || path.toLowerCase().startsWith(protectedRoot + sep) || !path.startsWith(root + sep)) throw Error('Protected/outside path');
  return path;
}
const { version, displayName } = JSON.parse(await readFile(safePath('package.json'), 'utf8'));
const repoName = 'yu-daguan-local';
const tag = `v${version}`;
const trustedRoot = root.replaceAll('\\', '/');
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${trustedRoot}`, ...args], { cwd: root, encoding: 'utf8', windowsHide: true, env: { ...process.env, GCM_INTERACTIVE: 'never', GIT_TERMINAL_PROMPT: '0' } }).trim();
const auth = spawnSync('git', ['-c', `safe.directory=${trustedRoot}`, 'credential', 'fill'], { cwd: root, input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', windowsHide: true, env: { ...process.env, GCM_INTERACTIVE: 'never', GIT_TERMINAL_PROMPT: '0' } });
if (auth.status !== 0) throw Error('GitHub 登录不可用，请先在本机登录 GitHub。');
const credential = Object.fromEntries(auth.stdout.trim().split('\n').map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)]; }));
const headers = { Authorization: `Bearer ${credential.password}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': repoName };
async function api(path, method = 'GET', payload) {
  const response = await fetch(`https://api.github.com${path}`, { method, headers: { ...headers, ...(payload ? { 'Content-Type': 'application/json' } : {}) }, body: payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(30000) });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw Error(`GitHub ${response.status}: ${data?.message || 'request failed'}`);
  return data;
}
const profile = await api('/user');
const repositoryPath = `/repos/${profile.login}/${repoName}`;
const packageFiles = [`yu-daguan-local-${tag}.zip`, `yu-daguan-local-${tag}.html`, 'SHA256SUMS.txt'];
const assets = await Promise.all(packageFiles.map(async name => ({ name, content: await readFile(safePath(`dist/${tag}/${name}`)) })));
const sums = assets.find(a => a.name === 'SHA256SUMS.txt').content.toString('utf8');
for (const asset of assets.filter(a => a.name !== 'SHA256SUMS.txt')) {
  if (!sums.includes(`${createHash('sha256').update(asset.content).digest('hex')}  ${asset.name}`)) throw Error(`Asset checksum mismatch: ${asset.name}`);
}
const revision = git('rev-parse', 'HEAD');
if (git('status', '--porcelain')) throw Error('请先提交全部源码变更后再发布。');
const seedBox = { window: {} };
runInNewContext(await readFile(safePath('seed.js'), 'utf8'), seedBox);
for (const field of ['mastery', 'notes', 'attempts', 'collections']) if (Object.keys(seedBox.window.OFFLINE_SEED[field]).length) throw Error('发布初始化数据中含有个人记录，已停止。');
for (const commit of git('rev-list', 'HEAD').split('\n')) {
  const publishedFiles = git('ls-tree', '-r', '--name-only', commit);
  if (/^(?:user-.*\.json|\.private\/|原站学习记录备份\.json)/m.test(publishedFiles)) throw Error('待发布历史包含个人文件，已停止。');
  const historicalSeed = { window: {} };
  runInNewContext(git('show', `${commit}:seed.js`), historicalSeed);
  for (const field of ['mastery', 'notes', 'attempts', 'collections']) if (Object.keys(historicalSeed.window.OFFLINE_SEED[field]).length) throw Error('待发布历史中含有个人记录，已停止。');
}
let repository;
const existing = await fetch(`https://api.github.com${repositoryPath}`, { headers, signal: AbortSignal.timeout(15000) });
if (existing.status === 404) repository = await api('/user/repos', 'POST', { name: repoName, description: `${displayName}：408 真题离线练习、知识点筛选及本地学习记录`, private: true, has_issues: true, has_wiki: false, auto_init: false });
else {
  if (!existing.ok) throw Error(`无法检查仓库：${existing.status}`);
  repository = await existing.json();
  let remote = ''; try { remote = git('remote', 'get-url', 'origin'); } catch {}
  if (remote !== repository.clone_url) throw Error('同名仓库已存在，且不是当前项目的远端；已停止以避免修改其他项目。');
}
if (!repository.private) throw Error('当前发布流程面向私有仓库。');
const remotes = git('remote').split('\n');
if (!remotes.includes('origin')) git('remote', 'add', 'origin', repository.clone_url);
git('push', '-u', 'origin', 'main');
console.log(`源码已推送：${repository.html_url}`);
let release = (await api(`${repositoryPath}/releases?per_page=100`)).find(item => item.tag_name === tag);
if (release) {
  if (!release.draft) throw Error('该版本已发布；请使用新的版本号。');
} else release = await api(`${repositoryPath}/releases`, 'POST', {
  tag_name: tag, target_commitish: revision, name: `${displayName} ${tag}`, draft: true, prerelease: false,
  body: `# ${displayName} ${tag}\n\n下载并解压 ZIP，双击“${displayName}.html”即可离线使用。\n\n- 2009—2026 年 18 套试卷、846 道题，题目、答案、解析、图片和公式字体均已内置。\n- 科目、章、小节三级目录选择与范围高亮，开刷后连续显示全部筛选题目。\n- 点击年份直接整卷练习，保留选择题和非选择题筛选。\n- 掌握标记、笔记、收藏、本地学习历史与备份恢复。\n- 不预置任何个人学习记录，支持导入自己的备份。\n\n建议固定使用同一个浏览器与打开方式；切换前导出记录，在新环境导入。\n\n附件提供便携 ZIP、单文件 HTML 和 SHA-256 校验文件。此版本尚未包含多设备自动同步。\n\n源码提交：${revision}`
});
for (const asset of assets) {
  const digest = `sha256:${createHash('sha256').update(asset.content).digest('hex')}`;
  let existingAsset = release.assets?.find(a => a.name === asset.name);
  if (!existingAsset) {
    const identical = release.assets?.find(a => a.digest === digest && a.size === asset.content.length);
    if (identical) existingAsset = await api(`${repositoryPath}/releases/assets/${identical.id}`, 'PATCH', { name: asset.name, label: asset.name.endsWith('.html') ? `${displayName}.html` : asset.name });
  }
  if (existingAsset?.digest === digest && existingAsset.size === asset.content.length) continue;
  // Only replace generated attachments on this unpublished draft; local originals remain available.
  if (existingAsset) await api(`${repositoryPath}/releases/assets/${existingAsset.id}`, 'DELETE');
  const upload = new URL(release.upload_url.replace(/\{.*$/, ''));
  upload.searchParams.set('name', asset.name);
  if (asset.name.endsWith('.html')) upload.searchParams.set('label', `${displayName}.html`);
  const response = await fetch(upload, { method: 'POST', headers: { ...headers, 'Content-Type': asset.name.endsWith('.zip') ? 'application/zip' : asset.name.endsWith('.html') ? 'text/html' : 'text/plain', 'Content-Length': String(asset.content.length) }, body: asset.content, signal: AbortSignal.timeout(180000) });
  const result = await response.json();
  if (!response.ok) throw Error(`上传失败 ${asset.name}: ${result.message}`);
  console.log(`附件已上传：${asset.name} (${result.size} bytes)`);
}
const complete = await api(`${repositoryPath}/releases/${release.id}`);
for (const asset of assets) {
  const remote = complete.assets.find(a => a.name === asset.name);
  if (!remote || remote.size !== asset.content.length) throw Error(`Release 附件校验失败：${asset.name}`);
  const expected = `sha256:${createHash('sha256').update(asset.content).digest('hex')}`;
  if (remote.digest && remote.digest !== expected) throw Error(`Release 附件哈希不一致：${asset.name}`);
}
const published = await api(`${repositoryPath}/releases/${release.id}`, 'PATCH', { draft: false, make_latest: 'true', target_commitish: revision, body: release.body.replace(/源码提交：[a-f0-9]+/, `源码提交：${revision}`) });
const result = { repository: repository.html_url, private: repository.private, release: published.html_url, version, commit: revision, assets: complete.assets.map(a => ({ name: a.name, size: a.size, download: a.browser_download_url, digest: a.digest })) };
await writeFile(safePath('release-result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
