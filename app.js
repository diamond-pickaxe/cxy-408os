(() => {
'use strict';
const D=window.OFFLINE_DATA,S=window.OFFLINE_SEED,KEY='408-offline-v1'+(location.search.includes('test=1')?'-test':'');
const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels=['未做','掌握','不熟','不会'],subjects=D.knowledge.map(k=>k.name),byId=new Map(D.questions.map(q=>[q.id,q])),kp=new Map();
function walk(nodes,subject,path=[],ids=[]){for(const n of nodes){kp.set(n.id,{name:n.name,subject,path:[...path,n.name],ids:[...ids,n.id],children:n.children||[]});if(n.children)walk(n.children,subject,[...path,n.name],[...ids,n.id])}}
for(const n of D.knowledge)walk([n],n.name);
const parser=new DOMParser();
for(const q of D.questions){q.tags=(q.knowledgePointIds||String(q.knowledgeTagsId||'').split(',')).map(Number).map(id=>kp.get(id)).filter(Boolean);q.subject=q.tags[0]?.subject||({65:'计算机组成原理',700:'数据结构'}[q.id])||'';q.plain=parser.parseFromString(q.questionHtml,'text/html').body.textContent.replace(/\s+/g,' ').trim()}
function initial(){return {version:1,mastery:{...S.mastery},notes:{...S.notes},collections:structuredClone(S.collections),attempts:{...S.attempts},history:{},answers:{},lastId:null,updatedAt:null,migration:S.migration}}
let state,loadError=false;try{state=JSON.parse(localStorage.getItem(KEY)||'null')||initial()}catch{state=initial();loadError=true}
let view='overview',list=false,collection=null,current=null,queue=[],selected=null,revealed=false;
let session=null,mediaObserver=null;
const sessionAnswers=new Map();
function syncHierarchy(){
 const subject=D.knowledge.find(n=>n.name===$('subject').value),oldChapter=$('chapter').value,oldSection=$('knowledge').value;
 const chapters=subject?.children||[];
 $('chapter').replaceChildren(new Option('全部章节',''),...chapters.map(n=>new Option(n.name,String(n.id))));
 $('chapter').value=chapters.some(n=>String(n.id)===oldChapter)?oldChapter:'';
 $('chapter').disabled=!subject;
 const sections=chapters.find(n=>String(n.id)===$('chapter').value)?.children||[];
 $('knowledge').replaceChildren(new Option('全部小节',''),...sections.map(n=>new Option(n.name,String(n.id))));
 $('knowledge').value=sections.some(n=>String(n.id)===oldSection)?oldSection:'';
 $('knowledge').disabled=!$('chapter').value||!sections.length;
}
function resetFilters(){for(const id of ['subject','year','type','chapter','knowledge','mastery','search'])$(id).value='';syncHierarchy()}
function scopeName(){return [$('subject').value,kp.get(Number($('chapter').value))?.name,kp.get(Number($('knowledge').value))?.name].filter(Boolean).join(' / ')||'全部真题'}
function changeFilter(){session=null;render()}
function save(){state.updatedAt=new Date().toISOString();try{localStorage.setItem(KEY,JSON.stringify(state));$('saveStatus').textContent='已保存 · '+new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}catch{toast('浏览器存储已满或不可用，请立即导出备份。');$('saveStatus').textContent='保存失败，请导出备份'}}
let toastTimer;function toast(t){$('toast').textContent=t;$('toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').style.display='none',3500)}
function level(q){return Number(state.mastery[q.id]||0)}
function matches(q){const subj=$('subject').value,year=$('year').value,type=$('type').value,master=$('mastery').value,k=Number($('knowledge').value||$('chapter').value),s=$('search').value.trim().toLowerCase();return (!subj||q.subject===subj)&&(!year||q.year===Number(year))&&(!type||(type==='1'?q.questionType===1:q.questionType!==1))&&(master===''||level(q)===Number(master))&&(!k||q.tags.some(t=>t.ids.includes(k)))&&(!s||(q.plain+' '+q.tags.map(t=>t.path.join(' ')).join(' ')+' '+(state.notes[q.id]||'')+' '+q.year+' '+q.questionIndex).toLowerCase().includes(s))}
function filtered(){let arr=D.questions.filter(matches);if(view==='review')arr=arr.filter(q=>[2,3].includes(level(q)));if(view==='collections'&&collection)arr=arr.filter(q=>collection.ids.includes(q.id));return arr.sort((a,b)=>b.year-a.year||a.questionIndex-b.questionIndex)}
function metrics(){const done=D.questions.filter(q=>level(q)>0).length,mastered=D.questions.filter(q=>level(q)===1).length,weak=D.questions.filter(q=>level(q)>1).length;const cards=[['历年真题',D.questions.length,'18 套完整试卷 · 已存入本机'],['已经做过',done,Math.round(done/846*100)+'% 的真题已有掌握标记'],['已经掌握',mastered,'知识一点点成为自己的'],['需要复习',weak,'不熟与不会的题目，集中再练']];$('stats').innerHTML=cards.map(([a,b,c])=>`<div class="stat"><small>${a}</small><strong>${b}</strong><span>${c}</span></div>`).join('')}
function subjectStats(){return '<div class="subject-stats">'+subjects.map(s=>{const qs=D.questions.filter(q=>q.subject===s),done=qs.filter(q=>level(q)>0).length;return `<div class="subject-card"><b>${s}</b><p>${done} / ${qs.length} 题已做</p><progress max="${qs.length}" value="${done}"></progress></div>`}).join('')+'</div>'}
function row(q){return `<button class="question-row" data-q="${q.id}"><span class="q-label">${q.year} · 第 ${q.questionIndex} 题</span><span class="q-text">${esc(q.plain)}</span><span class="pill l${level(q)}">${labels[level(q)]}</span></button>`}
function render(){mediaObserver?.disconnect();if(session){renderSession();return}metrics();renderDirectory();$('continue').hidden=false;$('random').hidden=false;const titles={overview:'你的真题地图',review:'把薄弱的地方，练扎实',collections:collection?collection.name:'为下次复习，留一道题',notes:'你的思考，值得留下',statistics:'看见每一步积累'};$('pageTitle').textContent=titles[view];$('subtitle').textContent={overview:'每一个色块都是一道题，点开就能继续。',review:'这里汇集当前标记为“不熟”和“不会”的题目。',collections:'收藏需要复习的题目，也可以新建自己的收藏夹。',notes:'你的笔记和思考，都保存在这里。',statistics:'已做题数按当前掌握标记统计。'}[view];document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));const arr=filtered();$('viewHint').textContent=`${scopeName()} · ${arr.length} 道题`;$('continue').textContent=`开刷（${arr.length}） →`;$('continue').disabled=!arr.length;$('scopeBanner').hidden=!hasFilter();$('scopeText').textContent=scopeName();$('scopeCount').textContent=arr.length+' 道题';$('stats').hidden=view!=='statistics';$('toggleList').hidden=!['overview','review'].includes(view);$('toggleList').textContent=list?'地图视图':'列表视图';
if(view==='collections'&&!collection){$('content').innerHTML='<div class="collection-grid">'+state.collections.map(c=>`<button class="collection-card" data-collection="${c.id}">☆<strong>${esc(c.name)}</strong><span>${c.ids.length} 道题 · 点击复习</span></button>`).join('')+(state.collections.length?'':'<div class="empty">还没有收藏夹，刷题时点击“笔记 / 收藏”即可新建。</div>')+'</div>';return}
if(view==='notes'){$('content').innerHTML=Object.entries(state.notes).filter(([id,t])=>t.trim()&&byId.has(Number(id))&&matches(byId.get(Number(id)))).map(([id,t])=>{const q=byId.get(Number(id));return `<button class="note-card" data-q="${id}"><span>${q.year} 年 · 第 ${q.questionIndex} 题 · ${esc(q.subject)}</span><p>${esc(t)}</p></button>`}).join('')||'<div class="empty">当前筛选下还没有笔记。</div>';return}
if(view==='statistics'){const counts=labels.map((_,i)=>D.questions.filter(q=>level(q)===i).length);$('content').innerHTML=`<div class="info-panel"><h2>当前掌握情况</h2><div class="legend">${counts.map((n,i)=>`<span><i class="l${i}"></i>${labels[i]} ${n} 题</span>`).join('')}</div>${subjectStats()}<h3>原站迁移记录</h3><p>已迁移 ${S.migration.marked} 道掌握标记、${S.collections.length} 个收藏夹（共 ${S.collections.reduce((n,c)=>n+c.ids.length,0)} 条收藏关系）和 ${Object.keys(S.notes).length} 篇个人笔记。<br>迁移时间：${esc(new Date(S.migration.capturedAt).toLocaleString('zh-CN'))}。<br>${esc(S.migration.historyNote)}</p><p>原站首页统计快照：最近90天做题 ${S.migration.studyDays} 天，连续 ${S.migration.streak} 天。离线后的逐次答题与掌握历史会继续保存在本机。</p><h3>本地学习</h3><p>已记录 ${Object.values(state.history).reduce((n,h)=>n+h.length,0)} 条本地操作；${Object.keys(state.notes).filter(id=>state.notes[id].trim()).length} 篇笔记。换浏览器或电脑前，请先点击右上角“备份学习记录”。</p></div>`;return}
if(view==='collections'||list){$('content').innerHTML=(collection?'<button class="back" id="backCollections">← 全部收藏夹</button>':'')+'<div class="list-panel">'+(arr.map(row).join('')||'<div class="empty">当前筛选下没有题目。</div>')+'</div>';return}
const visible=new Set(arr.map(q=>q.id));let h='<div class="map-panel"><div class="subject-tabs">'+subjects.map((s,i)=>`<button data-subject="${esc(s)}" class="subject-${i} ${$('subject').value===s?'active':''}">${s}</button>`).join('')+subjects.map((s,i)=>`<button data-subject="${esc(s)}" class="subject-${i} short-subject">${['DS','CO','OS','CN'][i]}</button>`).join('')+'</div><div class="map-scroll"><div class="map"><div class="map-head"><span>年份</span><div class="map-labels"><span>第 1 题</span><span>第 12 题</span><span>第 23 题</span><span>第 33 题</span><span>第 41—47 题</span></div></div>';for(let y=2026;y>=2009;y--){if($('year').value&&Number($('year').value)!==y)continue;h+=`<div class="map-row"><button class="map-year" data-year="${y}">${y}</button><div class="cells">`;for(const q of D.questions.filter(q=>q.year===y).sort((a,b)=>a.questionIndex-b.questionIndex)){h+=`<button class="cell l${level(q)} ${hasFilter()?(visible.has(q.id)?'in-scope':'out'):''} subject-${subjects.indexOf(q.subject)} ${state.notes[q.id]?'is-note':''}" data-q="${q.id}" ${visible.has(q.id)?'':'disabled'} title="${y} 年 第 ${q.questionIndex} 题 · ${esc(q.subject)} · ${labels[level(q)]}" aria-label="${y}年第${q.questionIndex}题，${labels[level(q)]}"></button>`}h+='</div></div>'}h+='</div></div><div class="legend">'+labels.map((l,i)=>`<span><i class="l${i}"></i>${l}</span>`).join('')+'<span>白点 · 有个人笔记</span><span>蓝框 · 当前筛选范围</span></div>'+ `<div class="migration-note">已接上你原站的学习进度：${S.migration.marked} 道题有掌握标记，${Object.keys(S.notes).length} 篇笔记已带过来。点击色块即可继续刷题。</div></div>`;$('content').innerHTML=h}
function hasFilter(){return ['subject','chapter','knowledge','year','type','mastery','search'].some(id=>$(id).value!=='')}
function selectKnowledge(id){
 const node=kp.get(id);if(!node)return;
 session=null;view='overview';collection=null;list=false;
 $('subject').value=node.subject;$('year').value='';syncHierarchy();
 $('chapter').value=node.ids.length>1?String(node.ids[1]):'';syncHierarchy();
 $('knowledge').value=node.ids.length>2?String(node.ids[2]):'';render();
}
function renderDirectory(){
 const selectedId=Number($('knowledge').value||$('chapter').value)||D.knowledge.find(n=>n.name===$('subject').value)?.id;
 const query=$('directorySearch').value.trim().toLowerCase();
 function branch(n,depth){
  const children=(n.children||[]).map(c=>branch(c,depth+1)).join('');
  if(query&&!n.name.toLowerCase().includes(query)&&!children)return '';
  const chosen=n.id===selectedId,active=kp.get(selectedId)?.ids.includes(n.id);
  const qs=D.questions.filter(q=>depth===0?q.subject===n.name:q.tags.some(t=>t.ids.includes(n.id))),marked=qs.map(level).filter(Boolean),status=marked.length?Math.max(...marked):0;
  const button=`<button data-knowledge="${n.id}" aria-pressed="${chosen}" class="tree-label ${chosen?'selected':''}">${depth===0?'<span class="tree-icon">▦</span>':''}${esc(n.name)}${depth>0?`<i class="tree-dot l${status}"></i>`:''}</button>`;
  return n.children?.length?`<details class="tree-branch depth-${depth}" ${depth===0||active||query?'open':''}><summary><span class="tree-arrow">▸</span>${button}</summary><div class="tree-children">${children}</div></details>`:`<div class="tree-leaf">${button}</div>`;
 }
 $('directoryTree').innerHTML=D.knowledge.map(n=>branch(n,0)).join('')||'<p class="empty">没有匹配的知识点</p>';
}
function startYear(year){resetFilters();$('year').value=String(year);view='overview';collection=null;startSession(D.questions.filter(q=>q.year===year),year+' 年整卷')}
function startSession(questions=filtered(),title=scopeName()){
 if(!questions.length)return toast('当前筛选下没有题目');
 clearTimeout(searchTimer);
 session={ids:questions.slice().sort((a,b)=>a.year-b.year||a.questionIndex-b.questionIndex).map(q=>q.id),title,type:'',scroll:0};
 sessionAnswers.clear();render();window.scrollTo(0,0);
}
function sessionQuestions(){return session.ids.map(id=>byId.get(id)).filter(q=>!session.type||(session.type==='1'?q.questionType===1:q.questionType!==1))}
function media(q,field,title){return `<div class="session-media" data-media="${q.id}" data-field="${field}" data-title="${title}"></div>`}
function renderSession(){
 mediaObserver?.disconnect();$('stats').hidden=true;$('scopeBanner').hidden=true;
 $('pageTitle').textContent=session.title;$('subtitle').textContent='范围内的题目已全部列出，向下滚动连续刷题。';
 $('continue').hidden=true;$('toggleList').hidden=true;$('random').hidden=true;
 const arr=sessionQuestions();$('viewHint').textContent=`本次 ${arr.length} 道题`;
 $('content').innerHTML=`<div class="session-toolbar"><button id="backMap">← 返回总览</button><div class="session-types">${[['','全部题型'],['1','选择题'],['2','非选择题']].map(([v,t])=>`<button data-session-type="${v}" aria-pressed="${session.type===v}" class="${session.type===v?'active':''}">${t}</button>`).join('')}</div></div><div class="exercise-layout"><div class="exercise-list">${arr.map((q,i)=>{
 const a=sessionAnswers.get(q.id),isRevealed=!!a?.revealed;
 return `<article class="exercise-card" id="exercise-${q.id}" data-exercise="${q.id}"><div class="exercise-meta"><span class="year-tag">${q.year}</span><span>第${q.questionIndex}题</span><span class="score-tag">${q.score}分</span><button data-edit="${q.id}" title="笔记、收藏及历史">☆ 更多</button></div>${media(q,'questionHtml','题目正文')}${q.questionType===1?`<div class="answer-choices">${['A','B','C','D'].map(c=>`<button data-session-choice="${c}" class="${a?.selected===c?'selected':''}">${c}</button>`).join('')}</div>`:''}<div class="exercise-actions"><button data-session-answer class="primary">${isRevealed?'收起答案':'✓ 答案'}</button><button data-edit="${q.id}">✎ 笔记 / 收藏</button><span class="session-result" role="status">${a?.result||''}</span></div><section class="session-solution" ${isRevealed?'':'hidden'}>${isRevealed?`<h3>答案</h3>${media(q,'answerHtml','答案')}<h3>解析</h3>${media(q,'analysisHtml','解析')}`:''}</section><div class="session-marks">${[1,2,3,0].map(n=>`<button data-session-level="${n}" class="mark m${n} ${level(q)===n?'current':''}" aria-pressed="${level(q)===n}">${['↺ 未做','✓ 掌握','⊙ 不熟','× 不会'][n]}</button>`).join('')}</div><span class="session-note">${state.notes[q.id]?'✎ '+esc(state.notes[q.id]):''}</span></article>`;
 }).join('')||'<div class="empty">当前题型没有题目，可以切换其他题型。</div>'}</div><nav class="question-rail" aria-label="本次题目导航">${arr.map((q,i)=>`<button data-jump="${q.id}" title="${q.year}年第${q.questionIndex}题">${i+1}</button>`).join('')}</nav></div>`;
 observeMedia();
}
function observeMedia(){
 mediaObserver?.disconnect();
 mediaObserver=new IntersectionObserver(entries=>{for(const entry of entries){const host=entry.target;
  if(entry.isIntersecting&&!host.querySelector('iframe')){const q=byId.get(Number(host.dataset.media)),f=document.createElement('iframe');f.title=host.dataset.title;f.setAttribute('sandbox','allow-same-origin');host.append(f);frame(f,q[host.dataset.field]);}
  else if(!entry.isIntersecting&&host.querySelector('iframe')){host.style.minHeight=host.offsetHeight+'px';host.replaceChildren()}
 }},{rootMargin:'650px 0px'});
 document.querySelectorAll('.session-media').forEach(e=>mediaObserver.observe(e));
}
function syncSessionMarks(){document.querySelectorAll('[data-exercise]').forEach(card=>{const q=byId.get(Number(card.dataset.exercise));card.querySelectorAll('[data-session-level]').forEach(b=>{b.classList.toggle('current',Number(b.dataset.sessionLevel)===level(q));b.setAttribute('aria-pressed',String(Number(b.dataset.sessionLevel)===level(q)))});card.querySelector('.session-note').textContent=state.notes[q.id]?'✎ '+state.notes[q.id]:''})}
function handleSessionClick(e){
 if(e.target.closest('#backMap')){session=null;$('continue').hidden=false;$('random').hidden=false;render();window.scrollTo(0,0);return}
 const type=e.target.closest('[data-session-type]');if(type){session.type=type.dataset.sessionType;renderSession();window.scrollTo(0,0);return}
 const jump=e.target.closest('[data-jump]');if(jump){$('exercise-'+jump.dataset.jump)?.scrollIntoView({block:'start'});return}
 const card=e.target.closest('[data-exercise]');if(!card)return;const q=byId.get(Number(card.dataset.exercise));
 const edit=e.target.closest('[data-edit]');if(edit){showQuestion(q.id);return}
 const chosen=e.target.closest('[data-session-choice]');
 let a=sessionAnswers.get(q.id);if(!a){a={selected:null,revealed:false,recorded:false};sessionAnswers.set(q.id,a)}
 if(chosen){if(a.recorded)return toast('本次答案已记录，可重新开刷再练');a.selected=chosen.dataset.sessionChoice;card.querySelectorAll('[data-session-choice]').forEach(b=>b.classList.toggle('selected',b===chosen));return}
 const mark=e.target.closest('[data-session-level]');if(mark){const n=Number(mark.dataset.sessionLevel);state.mastery[q.id]=n;(state.history[q.id]??=[]).push({type:'mastery',level:n,at:new Date().toISOString()});state.lastId=q.id;save();syncSessionMarks();return}
 if(e.target.closest('[data-session-answer]')){
  a.revealed=!a.revealed;const solution=card.querySelector('.session-solution');solution.hidden=!a.revealed;
  e.target.closest('button').textContent=a.revealed?'收起答案':'✓ 答案';
  if(a.revealed){solution.innerHTML=`<h3>答案</h3>${media(q,'answerHtml','答案')}<h3>解析</h3>${media(q,'analysisHtml','解析')}`;
   if(a.selected&&!a.recorded){const correct=String(q.answer).toUpperCase().split('||').map(x=>x.trim()).includes(a.selected),at=new Date().toISOString();state.answers[q.id]={answer:a.selected,correct,at};(state.history[q.id]??=[]).push({type:'answer',answer:a.selected,correct,at});a.result=correct?'答对了':'本次选择 '+a.selected+'，参考答案 '+q.answer;a.recorded=true;card.querySelector('.session-result').textContent=a.result;state.lastId=q.id;save()}
  }else solution.replaceChildren();observeMedia();
 }
}
function math(doc){if(!window.katex)return;const tree=doc.createTreeWalker(doc.body,NodeFilter.SHOW_TEXT),nodes=[];let n;while(n=tree.nextNode())if(!n.parentElement.closest('script,style,pre,code,.katex,math'))nodes.push(n);const rx=/(?<!\\)\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\)\$([^\n$]+?)\$/g;for(const node of nodes){const text=node.textContent;rx.lastIndex=0;const ms=[...text.matchAll(rx)];if(!ms.length)continue;const f=doc.createDocumentFragment();let end=0;for(const m of ms){f.append(text.slice(end,m.index));const span=doc.createElement('span');try{span.innerHTML=window.katex.renderToString(m[1]||m[2]||m[3]||m[4],{throwOnError:false,displayMode:!!(m[1]||m[2]),trust:false,strict:false})}catch{span.textContent=m[0]}f.append(span);end=m.index+m[0].length}f.append(text.slice(end));node.replaceWith(f)}}
function frame(id,raw){const doc=parser.parseFromString(raw||'<p>原站未提供这部分内容。</p>','text/html');doc.querySelectorAll('script,link,iframe,base,meta,object,embed,form').forEach(e=>e.remove());for(const e of doc.querySelectorAll('*'))for(const a of [...e.attributes]){if(a.name.startsWith('on')||a.name==='srcdoc'||a.name==='srcset')e.removeAttribute(a.name);if(['src','href','xlink:href','poster'].includes(a.name)&&a.value&&!a.value.startsWith('data:')&&!a.value.startsWith('#'))e.removeAttribute(a.name)}math(doc);const style=`html{background:white;color:#273b31;font:15px/1.9 "Segoe UI","Microsoft YaHei",sans-serif}body{margin:0;padding:4px 2px 10px;overflow-wrap:anywhere}p{margin:8px 0}img,svg{max-width:100%;height:auto}svg{max-height:600px}table{border-collapse:collapse;max-width:100%;margin:12px 0}td,th{border:1px solid #dce5db;padding:7px 12px}pre{white-space:pre-wrap;background:#f3f6f1;padding:12px;border-radius:7px;font-size:12px}code{font-family:Consolas,monospace}.option{display:flex;gap:10px;margin:9px 0;padding:7px 12px;background:#f7f9f5;border-radius:6px}.opt-label{font-weight:600}.katex-display{overflow-x:auto;overflow-y:hidden}a{pointer-events:none}`;const f=typeof id==='string'?$(id):id;f.onload=()=>{const b=f.contentDocument?.body;if(!b)return;const resize=()=>{f.style.height=Math.max(35,b.offsetHeight)+8+'px'};resize();new ResizeObserver(resize).observe(b);b.querySelectorAll('img').forEach(img=>img.addEventListener('load',resize))};f.srcdoc=`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'"><style>${window.OFFLINE_KATEX_CSS||''}\n${style}</style>${doc.head.innerHTML}</head><body>${doc.body.innerHTML}</body></html>`}
function showQuestion(id,newQueue=true){const q=byId.get(Number(id));if(!q)return;if(newQueue){queue=(session?sessionQuestions():filtered()).map(q=>q.id);if(!queue.includes(q.id))queue=[q.id]}current=q;state.lastId=q.id;selected=null;revealed=false;$('questionMeta').textContent=`${q.subject} · ${q.questionType===1?'选择题':'综合题'} · ${q.score} 分`;$('questionTitle').textContent=`${q.year} 年 · 第 ${q.questionIndex} 题`;$('questionTags').textContent=q.tags.map(t=>t.name).join(' / ');$('solution').hidden=true;$('answerResult').textContent='';$('checkAnswer').textContent='查看答案与解析';$('note').value=state.notes[q.id]||'';$('noteStatus').textContent='输入后自动保存在本地';$('study').showModal();frame('questionFrame',q.questionHtml);$('answerChoices').innerHTML=q.questionType===1?['A','B','C','D'].map(a=>`<button data-choice="${a}" aria-label="选择 ${a}">${a}</button>`).join(''):'';updateQuestionState();$('study').querySelector('.study-body').scrollTop=0;save()}
function updateQuestionState(){if(!current)return;const id=current.id,l=level(current);$('favorite').textContent=state.collections.some(c=>c.ids.includes(id))?'★ 已收藏':'☆ 收藏';document.querySelectorAll('#markButtons button').forEach(b=>b.classList.toggle('current',Number(b.dataset.level)===l));$('markStatus').textContent='当前：'+labels[l]+(S.mastery[id]!==undefined?' · 已保留原站迁移记录':'');const h=state.history[id]||[];$('history').innerHTML=`<p>原站迁移时：${labels[S.mastery[id]||0]}${state.attempts[id]?'；页面显示第 '+state.attempts[id]+' 次刷题':''}。原站逐次历史暂未导出。</p>`+h.slice().reverse().map(e=>`<p>${esc(new Date(e.at).toLocaleString('zh-CN'))} · ${e.type==='answer'?`选择 ${esc(e.answer)} · ${e.correct?'答对':'答错'}`:labels[e.level]}</p>`).join('');const i=queue.indexOf(id);$('position').textContent=(i+1)+' / '+queue.length;$('prev').disabled=i<=0;$('next').disabled=i>=queue.length-1}
function event(e){const a=state.history[current.id]||(state.history[current.id]=[]);a.push({...e,at:new Date().toISOString()})}
function backup(){const payload={format:'408-offline-progress',exportedAt:new Date().toISOString(),state};const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));a.download='408学习记录-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('学习记录备份已导出')}

for(let y=2026;y>=2009;y--)$('year').add(new Option(y+' 年',y));
syncHierarchy();
for(const id of ['subject','chapter','knowledge'])$(id).onchange=()=>{syncHierarchy();changeFilter()};
$('year').onchange=()=>{$('year').value?startYear(Number($('year').value)):changeFilter()};
for(const id of ['type','mastery'])$(id).onchange=changeFilter;
let searchTimer;$('search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(changeFilter,200)};
$('nav').onclick=e=>{const b=e.target.closest('[data-view]');if(b){session=null;view=b.dataset.view;collection=null;render()}};
$('reset').onclick=()=>{session=null;resetFilters();render()};
$('clearScope').onclick=$('reset').onclick;
$('toggleList').onclick=()=>{list=!list;render()};
$('content').onclick=e=>{
 if(session){handleSessionClick(e);return}
 const q=e.target.closest('[data-q]');if(q&&!q.disabled){showQuestion(q.dataset.q);return}
 const c=e.target.closest('[data-collection]');if(c){collection=state.collections.find(x=>String(x.id)===c.dataset.collection);render();return}
 const y=e.target.closest('[data-year]');if(y){startYear(Number(y.dataset.year));return}
 const subject=e.target.closest('[data-subject]');if(subject){selectKnowledge(D.knowledge.find(n=>n.name===subject.dataset.subject).id);return}
 if(e.target.id==='backCollections'){collection=null;render()}
};
$('continue').onclick=()=>startSession();$('scopeStart').onclick=()=>startSession();
$('random').onclick=()=>{const a=filtered();if(a.length)showQuestion(a[Math.floor(Math.random()*a.length)].id);else toast('当前筛选下没有题目')};
$('openDirectory').onclick=()=>{if(window.innerWidth>900){$('directory').show();document.body.classList.remove('directory-collapsed')}else{$('directory').close();$('directory').showModal()}renderDirectory()};
$('closeDirectory').onclick=()=>{$('directory').close();document.body.classList.add('directory-collapsed')};
$('directorySearch').oninput=renderDirectory;
$('directoryTree').onclick=e=>{const b=e.target.closest('[data-knowledge]');if(b){selectKnowledge(Number(b.dataset.knowledge));if(window.innerWidth<=900)$('directory').close()}};
$('closeStudy').onclick=()=>{$('study').close()};$('study').addEventListener('close',()=>{if(session)syncSessionMarks();else render()});for(const [id,offset] of [['prev',-1],['next',1]])$(id).onclick=()=>{const i=queue.indexOf(current.id)+offset;if(i>=0&&i<queue.length)showQuestion(queue[i],false)};
$('answerChoices').onclick=e=>{const b=e.target.closest('[data-choice]');if(!b)return;selected=b.dataset.choice;document.querySelectorAll('#answerChoices [data-choice]').forEach(b=>b.classList.toggle('selected',b.dataset.choice===selected))};
$('checkAnswer').onclick=()=>{if(revealed)return;$('solution').hidden=false;frame('answerFrame',current.answerHtml||esc(current.answer));frame('analysisFrame',current.analysisHtml);if(selected){const correct=String(current.answer).toUpperCase().split('||').map(x=>x.trim()).includes(selected);$('answerResult').textContent=correct?'答对了':'本次选择 '+selected+'，参考答案 '+current.answer;$('answerResult').className=correct?'correct':'incorrect';state.answers[current.id]={answer:selected,correct,at:new Date().toISOString()};event({type:'answer',answer:selected,correct});save();updateQuestionState()}revealed=true;$('checkAnswer').textContent='答案与解析已展开'};
$('markButtons').onclick=e=>{const b=e.target.closest('[data-level]');if(!b)return;const n=Number(b.dataset.level);state.mastery[current.id]=n;event({type:'mastery',level:n});save();updateQuestionState();toast('已标记：'+labels[n])};
$('note').oninput=()=>{if(!current)return;state.notes[current.id]=$('note').value;save();$('noteStatus').textContent='笔记已保存在本地'};
function collectionChecks(){$('collectionChecks').innerHTML=state.collections.map(c=>`<label><input type="checkbox" data-cid="${c.id}" ${c.ids.includes(current.id)?'checked':''}>${esc(c.name)} (${c.ids.length})</label>`).join('')}
$('favorite').onclick=()=>{collectionChecks();$('collectionsDialog').showModal()};$('collectionChecks').onchange=e=>{const c=state.collections.find(c=>String(c.id)===e.target.dataset.cid);if(!c)return;c.ids=c.ids.filter(id=>id!==current.id);if(e.target.checked)c.ids.push(current.id);save();updateQuestionState()};$('createCollection').onclick=()=>{const name=$('newCollectionName').value.trim();if(!name)return;state.collections.push({id:'local-'+Date.now(),name,ids:[current.id]});$('newCollectionName').value='';save();collectionChecks();updateQuestionState()};$('doneCollections').onclick=()=>$('collectionsDialog').close();
$('export').onclick=backup;$('import').onclick=()=>$('importFile').click();$('importFile').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>10*1024*1024)throw Error('备份文件过大');const p=JSON.parse(await f.text()),s=p.state;if(p.format!=='408-offline-progress'||s?.version!==1||!s.mastery||!s.notes||!Array.isArray(s.collections))throw Error('不是有效的408学习记录备份');for(const [id,l]of Object.entries(s.mastery))if(!byId.has(Number(id))||![0,1,2,3].includes(l))throw Error('掌握标记格式错误');for(const [id,t]of Object.entries(s.notes))if(!byId.has(Number(id))||typeof t!=='string')throw Error('笔记格式错误');for(const c of s.collections)if(typeof c.name!=='string'||!Array.isArray(c.ids)||c.ids.some(id=>!byId.has(id)))throw Error('收藏夹格式错误');if(!confirm('将载入这份备份。当前记录会先保留一份自动备份，是否继续？'))return;localStorage.setItem(KEY+'-before-import',JSON.stringify(state));state={...initial(),...s};save();render();toast('学习记录已导入')}catch(err){toast('导入失败：'+err.message)}finally{e.target.value=''}};
document.addEventListener('keydown',e=>{if(!$('study').open||$('collectionsDialog').open||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;if(e.key==='ArrowRight')$('next').click();if(e.key==='ArrowLeft')$('prev').click();if(['a','b','c','d'].includes(e.key.toLowerCase()))document.querySelector(`#answerChoices [data-choice="${e.key.toUpperCase()}"]`)?.click()});
if(window.innerWidth>900)$('directory').show();const wideScreen=matchMedia('(min-width:901px)');wideScreen.addEventListener('change',e=>{$('directory').close();document.body.classList.remove('directory-collapsed');if(e.matches)$('directory').show()});
$('backupDate').textContent='题库备份于 '+new Date(D.manifest.downloadedAt).toLocaleDateString('zh-CN');render();save();if(loadError)toast('浏览器中的记录无法读取，已载入原站迁移备份。请导入最近备份以恢复后续进度。');
})();
