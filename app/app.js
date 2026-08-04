/* ============================================================
 * 造物 · Atelier — 前端 SPA app.js
 * API 适配：优先连接后端（/api/health 探活），连不上自动降级
 * 为「浏览器内引擎」模式（同一份 shared/engine.js + localStorage），
 * 保证 GitHub Pages 静态托管也能体验完整循环。
 * ============================================================ */
'use strict';

var App = { mode: null, state: null, view: 'workbench', currentWork: null };

/* ---------------- API 适配层 ---------------- */
var Api = {
  serverOk: false,
  local: null,
  init: function () {
    var self = this;
    return fetch('/api/health').then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.ok) { self.serverOk = true; return self.get('/api/state'); }
        throw new Error('no server');
      })
      .catch(function () {
        self.serverOk = false;
        var saved = null;
        try { saved = JSON.parse(localStorage.getItem('zaowu-state')); } catch (e) {}
        self.local = new ZaowuEngine.Atelier(saved || ZaowuSeed());
        return self.local.getState();
      });
  },
  get: function (url) { return fetch(url).then(function (r) { return r.json(); }); },
  save: function () { if (!this.serverOk) localStorage.setItem('zaowu-state', JSON.stringify(this.local.getState())); },
  action: function (name, body) {
    var self = this;
    if (this.serverOk) {
      return fetch('/api/action/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (!j.ok) throw new Error(j.error); return self.get('/api/state'); });
    }
    return new Promise(function (resolve, reject) {
      try {
        var fn = self.local[name];
        if (typeof fn !== 'function') throw new Error('未知动作 ' + name);
        var args = {
          confirmProposal: [body.pid], rejectProposal: [body.pid, body.reason],
          createManualTopic: [body.title, body.tags], assemble: [body.wid],
          addParagraph: [body.wid, body.text, body.kind], citeAsset: [body.wid, body.pid, body.assetRef],
          confirmAI: [body.wid, body.pid], submitCheck: [body.wid],
          handleCheck: [body.wid, body.cid, body.action, body.reason],
          finalize: [body.wid], publish: [body.wid], retro: [body.wid], shelve: [body.wid, body.reason],
          quickNote: [body.text], archiveNotes: [],
          submitTip: [body.reader, body.content, body.scope], revokeMaterial: [body.cardId],
          addSignal: [body.from, body.text, body.tags],
          submitBug: [body.reader, body.wid, body.quote, body.type, body.evidence],
          adjudicateBug: [body.bid, body.verdict, body.note], reset: []
        }[name] || [];
        if (name === 'reset') { self.local = new ZaowuEngine.Atelier(ZaowuSeed()); self.save(); resolve(self.local.getState()); return; }
        fn.apply(self.local, args);
        self.save();
        resolve(self.local.getState());
      } catch (e) { reject(e); }
    });
  }
};

/* ---------------- 工具 ---------------- */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function toast(msg, err) {
  var t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(t._h); t._h = setTimeout(function () { t.className = 'toast'; }, err ? 4200 : 2600);
}
var SL = { idea: '选题确认', drafting: '起草中', self_check: '自检中', finalized: '已定稿', published: '已发布', retro: '复盘中', archived: '已归档', shelved: '已搁置' };
function badge(st) { return '<span class="badge b-' + st + '">' + SL[st] + '</span>'; }
function confBadge(c) { var m = { high: ['b-hi', '高置信'], medium: ['b-md', '中置信'], low: ['b-lo', '低置信'] }[c] || ['b-lo', c]; return '<span class="badge ' + m[0] + '">' + m[1] + '</span>'; }
function workById(id) { return App.state.works.find(function (w) { return w.id === id; }); }

/* ---------------- 行为封装 ---------------- */
function act(name, body, okMsg) {
  Api.action(name, body).then(function (st) {
    App.state = st;
    if (okMsg) toast(okMsg);
    render();
  }).catch(function (e) { toast('⛔ ' + e.message, true); });
}

/* ---------------- 路由 ---------------- */
function route() {
  var h = location.hash.replace('#', '') || 'workbench';
  if (h.indexOf('work/') === 0) { App.view = 'workbench'; App.currentWork = h.slice(5); }
  else { App.view = h; App.currentWork = null; }
  document.querySelectorAll('.topbar .nav').forEach(function (a) { a.classList.toggle('on', a.dataset.view === App.view); });
  render();
}

/* ---------------- 渲染 ---------------- */
function render() {
  var v = document.getElementById('view');
  if (App.view === 'shop') v.innerHTML = renderShop();
  else if (App.view === 'vault') v.innerHTML = renderVault();
  else v.innerHTML = App.currentWork ? renderWorkDetail(workById(App.currentWork)) : renderWorkbench();
}

/* ===== 工作台 ===== */
function renderWorkbench() {
  var s = App.state;
  var desk = [], proposals = s.proposals.filter(function (p) { return p.status === 'open'; });
  proposals.forEach(function (p) {
    desk.push('<div class="dcard"><b>📋 选题提议 · ' + esc(p.title) + '</b><span>需求分 ' + p.demandScore + ' · 素材充足度 ' + p.materialReadiness + ' · evidence ' + p.evidenceRefs.length + ' 条</span><span class="ref">' + esc(p.rationale) + '</span><div class="rowline"><button class="pri sm" onclick="act(\'confirmProposal\',{pid:\'' + p.id + '\'},\'已确认选题，进入起草（装配完成）\');location.hash=\'workbench\'">确认开写</button><button class="sm" onclick="rejectP(\'' + p.id + '\')">否决</button></div></div>');
  });
  s.works.forEach(function (w) {
    if (w.status === 'self_check' && w.checks.some(function (c) { return c.action === null; }))
      desk.push('<div class="dcard"><b>⚠️ 待处理自检 · ' + esc(w.title) + '</b><span>未处理 ' + w.checks.filter(function (c) { return c.action === null; }).length + ' 条 · 处理完毕才可定稿</span><div class="rowline"><button class="pri sm" onclick="location.hash=\'work/' + w.id + '\'">去处理</button></div></div>');
    if (w.status === 'published')
      desk.push('<div class="dcard"><b>📈 复盘到期 · ' + esc(w.title) + '</b><span>发布后复盘：资产清点 + 档案归档（不可变）</span><div class="rowline"><button class="pri sm" onclick="location.hash=\'work/' + w.id + '\'">去复盘</button></div></div>');
  });
  s.bugReports.filter(function (b) { return b.status === 'open'; }).forEach(function (b) {
    desk.push('<div class="dcard"><b>🐛 捉虫待裁决</b><span>@' + esc(b.reader) + ' · ' + esc(b.type) + ' · 「' + esc(b.quote).slice(0, 24) + '…」</span><div class="rowline"><button class="pri sm" onclick="judge(\'' + b.id + '\',\'confirmed\')">确认</button><button class="sm" onclick="judge(\'' + b.id + '\',\'rejected\')">驳回</button></div></div>');
  });
  if (s.noteInbox.length >= 1)
    desk.push('<div class="dcard"><b>🗒 速记收集箱 · ' + s.noteInbox.length + ' 条</b><span>归档后自动分类并关联搁置选题</span><div class="rowline"><button class="sm" onclick="act(\'archiveNotes\',{},\'速记已归档（看编排日志）\')">立即归档</button></div></div>');
  if (!desk.length) desk.push('<div class="dcard"><b>今日案头 · 清爽</b><span>没有待办。去小铺看看读者动向，或开个新题。</span></div>');

  var lanes = ['idea', 'drafting', 'self_check', 'finalized', 'published', 'archived'];
  var kanban = lanes.map(function (st) {
    var ws = s.works.filter(function (w) { return w.status === st; });
    return '<div class="lane"><h4>' + SL[st] + ' · ' + ws.length + '</h4>' + (ws.map(function (w) {
      return '<div class="wk" onclick="location.hash=\'work/' + w.id + '\'"><b>' + esc(w.title) + '</b>' + (w.status === 'self_check' ? '⚠ ' + w.checks.filter(function (c) { return !c.action; }).length + ' 条待处理' : '') + '</div>';
    }).join('') || '<div class="hint" style="padding:4px">空</div>') + '</div>';
  }).join('');
  var shelved = s.works.filter(function (w) { return w.status === 'shelved'; });

  var openProp = proposals.length;

  return '<h2 class="serif"><span class="no">①</span>今日案头 <small>引擎归集的待办（' + openProp + ' 个开放提议）· 每张卡带触发依据 · 案头不执行状态跃迁</small></h2>' +
    '<div class="desk">' + desk.join('') + '</div>' +
    '<h2 class="serif"><span class="no">②</span>流水线看板 <small>泳道 = 作品状态机 · 点击卡片进入作品</small></h2>' +
    '<div class="kanban">' + kanban + '</div>' +
    (shelved.length ? '<div class="card" style="margin-top:10px"><b>🗂 搁置区</b>（候选区，不是垃圾箱）：' + shelved.map(function (w) { return esc(w.title) + '（' + esc(w.shelveReason || '') + '）'; }).join('、') + '</div>' : '') +
    '<div class="grid cols2" style="margin-top:14px">' +
      '<div class="card"><h3>✍️ 手动建题</h3><label class="f">标题</label><input id="mt-title" placeholder="例：为什么我们越来越难说不知道"><label class="f">标签（逗号分隔，用于资产匹配）</label><input id="mt-tags" placeholder="例：远程办公,算法"><div class="rowline"><button class="pri" onclick="manualTopic()">建题并进入起草（自动装配）</button></div><div class="hint">铁律②：状态跃迁由创作者显式触发。</div></div>' +
      '<div class="card"><h3>🗒 碎片速记</h3><label class="f">一句话、一个链接、一个念头</label><textarea id="qn-text" placeholder="例：转行的人最常说的一句话是"每一块钱都看得见来路""></textarea><div class="rowline"><button onclick="quickNote()">进收集箱</button></div><div class="hint">速记是资产飞轮的毛细血管：想法变资产的门槛 = 一句话。</div></div>' +
    '</div>';
}

function rejectP(pid) {
  var r = prompt('否决理由（写回引擎偏好，同类提议降权）：');
  if (r === null) return;
  act('rejectProposal', { pid: pid, reason: r || '无理由' }, '已否决，理由已写回资产库');
}
function manualTopic() {
  var t = document.getElementById('mt-title').value.trim();
  if (!t) return toast('先写个标题', true);
  var tags = document.getElementById('mt-tags').value.split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean);
  Api.action('createManualTopic', { title: t, tags: tags }).then(function (st) {
    App.state = st; toast('已建题并完成装配');
    location.hash = 'work/' + st.works[0].id;
  }).catch(function (e) { toast('⛔ ' + e.message, true); });
}
function quickNote() {
  var t = document.getElementById('qn-text').value.trim();
  if (!t) return toast('写点什么再存', true);
  act('quickNote', { text: t }, '已进收集箱（满 1 条即可归档）');
}
function judge(bid, verdict) {
  var note = verdict === 'rejected' ? prompt('驳回理由（将回复捉虫人）：') || '无理由' : '';
  act('adjudicateBug', { bid: bid, verdict: verdict, note: note },
    verdict === 'confirmed' ? '已确认：修订痕迹 + 贡献者墙 + 自检规则已写回' : '已驳回，记录保留不公示');
}

/* ===== 作品详情 ===== */
function renderWorkDetail(w) {
  if (!w) return '<div class="card">作品不存在。<a href="#workbench">返回看板</a></div>';
  var h = '<div class="rowline"><a href="#workbench">← 返回看板</a>' + badge(w.status) + '<b style="font-size:18px">' + esc(w.title) + '</b><span class="hint">' + esc((w.topicOrigin && w.topicOrigin.rationale) || '') + '</span></div>';

  /* 起草编辑区 */
  if (w.status === 'drafting' || w.status === 'self_check') {
    var paras = w.paragraphs.map(function (p) {
      var cls = 'para' + (p.kind === 'ai' ? ' ai' : '');
      var lab = p.kind === 'ai' ? '<span class="plabel">AI 段落 · 待过目转正' + (p.confirmed ? '' : '') + '</span>' : '';
      var cites = p.citations.map(function (c) { return '<span class="cite">🔗 ' + esc(c.asset) + ' @' + esc(c.anchor) + '</span>'; }).join('');
      var aiBtn = p.kind === 'ai' ? ' <button class="sm" onclick="act(\'confirmAI\',{wid:\'' + w.id + '\',pid:\'' + p.id + '\'},\'已过目转正（authorship 底账记录）\')">过目转正</button>' : '';
      return '<div class="' + cls + '">' + lab + esc(p.text) + cites + aiBtn + '</div>';
    }).join('');

    var bundle = w.bundle.map(function (b) {
      var citeBtn = (b.status === 'ok' && b.type === '素材卡') ? ' <button class="sm pri" onclick="citeTo(\'' + w.id + '\',\'' + b.ref + '\')">引用</button>' : '';
      return '<div class="asset"><b>' + esc(b.type) + ' · ' + esc(b.ref) + '</b><div class="why">' + esc(b.why) + '</div><div class="lic">优先级 ' + b.pri + ' ✓</div>' + citeBtn + '</div>';
    }).join('');
    var blocked = (w.blockedBundle || []).map(function (b) {
      return '<div class="asset"><b>' + esc(b.type) + ' · ' + esc(b.ref) + '</b><div class="why">' + esc(b.why) + '</div><div class="blocked">✗ 硬规则拦截：未授权素材不装配</div></div>';
    }).join('');

    h += '<h2 class="serif"><span class="no">②</span>起草 <small>骨架模式 · AI 段落带色标须过目转正 · 右侧为本篇装配包</small></h2>' +
      '<div class="editor-area"><div class="editor">' + (paras || '<div class="hint">正文为空。写第一段，或让引擎起草一个带数据的背景段（演示色标与自检）。</div>') +
      '<label class="f">新增段落</label><textarea id="np-text"></textarea>' +
      '<div class="rowline"><button class="pri" onclick="addPara(\'' + w.id + '\',\'user\')">写入正文</button>' +
      '<button onclick="addPara(\'' + w.id + '\',\'ai\')">让引擎起草背景段（AI·色标）</button>' +
      (w.status === 'drafting' ? '<button onclick="act(\'submitCheck\',{wid:\'' + w.id + '\'},\'自检完成，看报告\')">提交自检 →</button>' : '') +
      '<button class="danger" onclick="shelveW(\'' + w.id + '\')">搁置</button></div>' +
      '<div class="hint">引用玩法：点右侧素材卡「引用」→ 挂到最近新增段落，锚点自动登记（署名核验的源头）。</div>' +
      '</div><div class="drawer"><h4>资产抽屉 · 本篇装配包</h4>' + (bundle || '<div class="hint">空</div>') + (blocked ? '<h4 style="margin-top:10px">被拦截</h4>' + blocked : '') + '<div class="hint" style="margin-top:8px">授权是硬门槛：未授权素材即使语义相关也不装配（Contract 校验）。</div></div></div>';
  }

  /* 自检报告 */
  if (w.checks && w.checks.length && (w.status === 'self_check' || w.status === 'finalized' || w.status === 'published' || w.status === 'archived')) {
    var items = w.checks.map(function (c) {
      var acts = c.action ? '<span class="badge ' + (c.action === 'accept' ? 'b-ok' : c.action === 'reject' ? 'b-blocked' : 'b-md') + '">' + { accept: '已采纳', reject: '已驳回', hold: '存疑' }[c.action] + '</span>' + (c.reason ? ' <span class="hint">理由：' + esc(c.reason) + '</span>' : '')
        : '<button class="sm pri" onclick="act(\'handleCheck\',{wid:\'' + w.id + '\',cid:\'' + c.id + '\',action:\'accept\'},\'已采纳，记入修订归因\')">采纳</button> ' +
          '<button class="sm" onclick="rejectCheck(\'' + w.id + '\',\'' + c.id + '\')">驳回（附理由→负样本）</button>';
      return '<div class="ci"><span class="badge b-' + c.category.toLowerCase() + '">' + c.category + '</span>' + confBadge(c.confidence) + '<b>' + esc(c.issue) + '</b><div class="quote">' + esc(c.anchor.quote) + '</div><div>' + esc(c.desc) + '</div><div class="cite-line">锚点：' + esc(c.anchor.p) + ' ｜ 建议：' + esc(c.suggestion) + (c.ruleRef ? ' ｜ 规则库：' + esc(c.ruleRef) : '') + '</div><div class="rowline">' + acts + '</div></div>';
    }).join('');
    var pending = w.checks.filter(function (c) { return !c.action; }).length;
    h += '<h2 class="serif"><span class="no">③</span>自检报告 <small>C1 逻辑 / C2 论据 / C4 风格 + 规则库注入 · 每条带锚点 · ' + (pending ? '未处理 ' + pending + ' 条' : '全部处理完毕 ✓') + '</small></h2>' + items +
      (w.status === 'self_check' ? '<div class="rowline"><button class="pri" onclick="act(\'finalize\',{wid:\'' + w.id + '\'},\'已定稿：创作方式声明自动生成\')">定稿 →</button><span class="hint">前置条件：自检全量处理 + 无未转正 AI 段落（引擎强制校验）</span></div>' : '');
  }

  /* 定稿后 */
  if (w.status === 'finalized') {
    h += '<div class="card"><h3>创作方式声明（系统生成 · 不可删改）</h3><p>' + esc(w.declaration) + '</p><div class="rowline"><button class="pri" onclick="act(\'publish\',{wid:\'' + w.id + '\'},\'已发布：署名核验完成，捉虫入口开放\')">发布 →</button></div></div>';
  }
  if (w.status === 'published') {
    h += '<div class="card"><h3>已发布 📮</h3><p>' + esc(w.declaration || '') + '</p><p>署名区：' + (w.credits.length ? w.credits.map(function (c) { return '<b>' + esc(c.name) + '</b>（' + esc(c.scope) + '，引用 ' + c.count + ' 处，锚点核验 ✓）'; }).join('、') : '无素材引用') + '</p><div class="rowline"><button class="pri" onclick="act(\'retro\',{wid:\'' + w.id + '\'},\'复盘完成：创作档案归档定型（不可变）\')">复盘并归档 →</button><a href="#shop"><button>去小铺看呈现</button></a></div></div>';
  }
  if (w.status === 'archived' && w.archive) {
    h += '<div class="card"><h3>创作档案（不可变）</h3><p class="hint">装配 ' + w.archive.bundleSize + ' 项 ｜ 自检 ' + w.archive.checkReport.length + ' 条 ｜ 修订 ' + w.archive.revisions.length + ' 处 ｜ 归档于 ' + esc(w.archive.archivedAt) + '</p><a href="#shop"><button>在小铺看诞生档案</button></a></div>';
  }
  return h;
}

function addPara(wid, kind) {
  var text = document.getElementById('np-text').value.trim();
  if (!text && kind === 'user') return toast('先写点内容', true);
  if (kind === 'ai') text = '据公开数据，2025 年灵活就业人口已超过 20000 万，其中相当比例流向手艺与服务类小微经营。这不是逃离，更像一次重新定价。';
  act('addParagraph', { wid: wid, text: text, kind: kind }, kind === 'ai' ? 'AI 段落已插入（色标，定稿前须过目转正）' : '已写入正文');
}
function citeTo(wid, assetRef) {
  var w = workById(wid);
  var p = w.paragraphs[w.paragraphs.length - 1];
  if (!p) return toast('先写一段正文，再引用素材', true);
  act('citeAsset', { wid: wid, pid: p.id, assetRef: assetRef }, '引用锚点已登记 → 署名区同步（' + p.id + '）');
}
function rejectCheck(wid, cid) {
  var r = prompt('驳回理由（写回规则库作负样本，同类误报降权）：');
  if (r === null) return;
  act('handleCheck', { wid: wid, cid: cid, action: 'reject', reason: r || '无理由' }, '已驳回：理由写回自检规则库（负样本）');
}
function shelveW(wid) {
  var r = prompt('搁置理由（写入未完成选题库，可被 T4 复活）：') || '暂缓';
  act('shelve', { wid: wid, reason: r }, '已搁置，回未完成选题库');
  location.hash = 'workbench';
}

/* ===== 小铺 ===== */
function renderShop() {
  var s = App.state, c = s.creator;
  var used = s.materialCards.filter(function (m) { return m.status === 'used'; }).length;
  var published = s.works.filter(function (w) { return ['published', 'retro', 'archived'].indexOf(w.status) >= 0; });
  var inProgress = s.works.filter(function (w) { return ['idea', 'drafting', 'self_check'].indexOf(w.status) >= 0; })[0];

  var works = published.map(function (w) {
    var excerpt = w.paragraphs.length ? esc(w.paragraphs[0].text).slice(0, 90) + '…' : '（demo：正文略）';
    var fixes = (w.revisions || []).filter(function (r) { return r.bugId; }).map(function (r) {
      return '<div class="fix"><span class="tag">修订</span>' + esc(r.ts) + ' 经 @' + esc(r.by) + ' 指正：' + esc(r.note) + '<b>该纠错已写入自检规则库，未来同类错误自动拦截。</b></div>';
    }).join('');
    var checkStat = w.checks ? '自检 ' + w.checks.length + ' 条：采纳 ' + w.checks.filter(function (x) { return x.action === 'accept'; }).length + ' / 驳回 ' + w.checks.filter(function (x) { return x.action === 'reject'; }).length : '—';
    return '<div class="card"><h3>' + esc(w.title) + '</h3><div class="hint">发布于 ' + esc(w.publishedAt || w.timeline.published || '') + '</div><p>' + excerpt + '</p>' +
      '<div class="credits">✍️ <b>本篇共创</b>：' + (w.credits && w.credits.length ? '素材由 ' + w.credits.map(function (x) { return '<b>' + esc(x.name) + '</b>（' + esc(x.scope) + '）'; }).join('、') + ' 报料 · 署名经引用锚点核验' : '本篇无读者素材引用') + '</div>' +
      '<div class="arch"><div class="ah">📜 诞生档案（创作档案公开字段投影 · 带锚点不可编造）</div><div class="ab">' +
        '<div class="row"><div class="k">选题源起</div><div>' + esc((w.topicOrigin && w.topicOrigin.rationale) || '手动建题') + '</div></div>' +
        '<div class="row"><div class="k">装配</div><div>上下文包 ' + (w.bundle ? w.bundle.length : 0) + ' 项' + ((w.blockedBundle || []).length ? '，拦截未授权素材 ' + w.blockedBundle.length + ' 项' : '') + '</div></div>' +
        '<div class="row"><div class="k">质量机制</div><div>' + checkStat + '</div></div>' +
        '<div class="row"><div class="k">创作方式</div><div>' + esc(w.declaration || '') + '</div></div>' +
      '</div></div>' + fixes +
      '<details style="font-size:13px"><summary>🐛 发现错误？捉虫（确认后永久提高质量下限）</summary><div style="padding:8px 0">' +
        '<label class="f">你的昵称</label><input id="bg-reader-' + w.id + '" placeholder="例：石头">' +
        '<label class="f">原文引用</label><input id="bg-quote-' + w.id + '" placeholder="选中觉得有误的原文">' +
        '<label class="f">类型</label><select id="bg-type-' + w.id + '"><option>事实错误</option><option>数据过时</option><option>引用有误</option><option>错别字</option></select>' +
        '<label class="f">证据（链接/说明）</label><input id="bg-ev-' + w.id + '" placeholder="https://…">' +
        '<div class="rowline"><button class="pri" onclick="submitBug(\'' + w.id + '\')">提交捉虫</button></div></div></details>' +
      '</div>';
  }).join('');

  var wallTips = {}, wallBugs = {};
  s.materialCards.filter(function (m) { return m.status === 'used'; }).forEach(function (m) { wallTips[m.provider] = (wallTips[m.provider] || 0) + 1; });
  s.bugReports.filter(function (b) { return b.verdict === 'confirmed'; }).forEach(function (b) { wallBugs[b.reader] = (wallBugs[b.reader] || 0) + 1; });
  var tipRows = Object.keys(wallTips).map(function (k) { return '<div class="wrow"><span>@' + esc(k) + '</span><span class="c">采用 ' + wallTips[k] + ' 次</span></div>'; }).join('') || '<div class="hint">暂无</div>';
  var bugRows = Object.keys(wallBugs).map(function (k) { return '<div class="wrow"><span>@' + esc(k) + '</span><span class="c">确认 ' + wallBugs[k] + ' 次</span></div>'; }).join('') || '<div class="hint">暂无</div>';

  var myCards = s.materialCards.map(function (m) {
    return '<div class="asset"><b>' + esc(m.id) + ' · @' + esc(m.provider) + ' · ' + esc(m.license.scope) + ' <span class="badge ' + (m.license.status === 'active' ? 'b-ok' : 'b-blocked') + '">' + (m.license.status === 'active' ? m.status === 'used' ? '已采用' : m.status === 'in_use' ? '创作中' : '等待匹配' : '已撤回') + '</span></b><div class="why">' + esc(m.content).slice(0, 60) + '…</div>' + (m.license.status === 'active' ? '<button class="sm danger" onclick="act(\'revokeMaterial\',{cardId:\'' + m.id + '\'},\'已撤回：引擎立即停止装配（已发布不追溯）\')">撤回授权</button>' : '') + '</div>';
  }).join('');

  return '<div class="shophead"><h1 class="serif">' + esc(c.shopName) + '</h1><p class="hint">' + esc(c.bio) + '</p>' +
    '<div class="stats"><div><b>' + published.length + '</b><span>已发布作品</span></div><div><b>' + s.materialCards.length + '</b><span>读者报料</span></div><div><b>' + used + '</b><span>已采用</span></div><div><b>' + s.checkRuleBank.filter(function (r) { return !r.negative; }).length + '</b><span>自检规则（含捉虫衍生）</span></div><div><b>' + s.demandSignals.length + '</b><span>需求信号</span></div></div></div>' +
    (inProgress ? '<div class="card" style="border-style:dashed;border-color:var(--amber)"><b>🪟 工坊橱窗 · 在制公示</b>（创作者选择公开）<br>下一篇方向：<b>' + esc(inProgress.title) + '</b> · 当前阶段：' + SL[inProgress.status] + '<div class="rowline"><button class="sm" onclick="wantSignal(\'' + esc(inProgress.tags[0] || '') + '\')">🗳 投一票想看（入需求信号）</button></div><div class="hint">投票与报料是信号，写不写由创作者决定（铁律②同样约束读者侧）。</div></div>' : '') +
    '<h2 class="serif"><span class="no">①</span>作品陈列 <small>每篇附诞生档案 / 共创署名 / 修订痕迹 / 捉虫入口</small></h2>' + (works || '<div class="card hint">还没有已发布作品——去工作台跑一遍流水线吧。</div>') +
    '<div class="grid cols2"><div class="card"><h3>📮 我有故事/线索（报料）</h3>' +
      '<label class="f">你的昵称</label><input id="tip-reader" placeholder="例：小鹿">' +
      '<label class="f">你的故事/线索（引擎将结构化萃取并匹配需求信号）</label><textarea id="tip-content" placeholder="例：我去年从大厂转行做手艺人，收入降了四成，但每一块钱都看得见来路。"></textarea>' +
      '<label class="f">授权范围（硬规则 · 法务级显式勾选）</label><select id="tip-scope"><option>具名引用</option><option>须匿名化</option><option>仅作背景参考不直接引用</option></select>' +
      '<div class="rowline"><button class="pri" onclick="submitTip()">提交报料</button></div>' +
      '<div class="hint">可撤回；撤回后引擎立即停配，已发布不追溯。被采用将获文末署名 + 贡献者墙。</div></div>' +
    '<div class="card"><h3>📦 素材卡与授权管理</h3>' + (myCards || '<div class="hint">暂无</div>') + '</div></div>' +
    '<h2 class="serif"><span class="no">②</span>贡献者墙 <small>排名货币 = 被采用的贡献，不是活跃度</small></h2>' +
    '<div class="wall"><div class="card"><h4>📮 报料上榜</h4>' + tipRows + '</div><div class="card"><h4>🐛 捉虫达人</h4>' + bugRows + '</div></div>';
}

function submitTip() {
  var reader = document.getElementById('tip-reader').value.trim();
  var content = document.getElementById('tip-content').value.trim();
  var scope = document.getElementById('tip-scope').value;
  if (!reader || !content) return toast('昵称和故事都要填', true);
  act('submitTip', { reader: reader, content: content, scope: scope }, '报料入库：结构化萃取完成 → 触发器 T1/T2 已运行（看工作台案头与编排日志）');
}
function submitBug(wid) {
  var reader = document.getElementById('bg-reader-' + wid).value.trim();
  var quote = document.getElementById('bg-quote-' + wid).value.trim();
  var type = document.getElementById('bg-type-' + wid).value;
  var evidence = document.getElementById('bg-ev-' + wid).value.trim();
  if (!reader || !quote) return toast('昵称和原文引用必填', true);
  act('submitBug', { reader: reader, wid: wid, quote: quote, type: type, evidence: evidence }, '捉虫已提交，等待创作者裁决（工作台案头可见）');
}
function wantSignal(tag) {
  var name = prompt('你的昵称：') || '匿名读者';
  act('addSignal', { from: name, text: '投了一票想看（橱窗）', tags: tag ? [tag] : [] }, '已作为需求信号入库（T2 聚类原料）');
}

/* ===== 资产库 ===== */
function renderVault() {
  var s = App.state;
  var row = function (nm, ct) { return '<div class="assetrow"><span class="nm">' + nm + '</span><span class="ct">' + ct + '</span></div>'; };
  var cv = '<div class="vault"><div class="vh">🗄 创作者资产库</div>' +
    row('风格档案 SP-001', '禁用表达 ' + s.styleProfile.banned.length + ' 条') +
    row('知识库', s.knowledgeBase.length + ' 条') +
    row('素材库', s.materialBank.length + ' 条') +
    row('速记收集箱', s.noteInbox.length + ' 条待归档') +
    row('未完成选题库', s.topicBacklog.length + ' 个') +
    row('自检规则库', s.checkRuleBank.length + ' 条 · 累计命中 ' + s.checkRuleBank.reduce(function (a, r) { return a + (r.hits || 0); }, 0) + ' 次') +
    '</div>';
  var rv = '<div class="vault"><div class="vh">👥 读者资产库</div>' +
    row('素材卡', s.materialCards.length + ' 张 · 采用 ' + s.materialCards.filter(function (m) { return m.status === 'used'; }).length) +
    row('需求信号', s.demandSignals.length + ' 条') +
    row('捉虫记录', s.bugReports.length + ' 起 · 确认 ' + s.bugReports.filter(function (b) { return b.verdict === 'confirmed'; }).length) +
    '</div>';
  var av = '<div class="vault"><div class="vh">📜 创作档案（归档后不可变）</div>' +
    (s.works.filter(function (w) { return w.archive; }).map(function (w) { return row(esc(w.id) + ' ' + esc(w.title), '装配 ' + w.archive.bundleSize + ' 项 · 自检 ' + w.archive.checkReport.length + ' 条'); }).join('') || row('暂无归档', '跑完一轮流水线即有')) +
    '</div>';

  var logs = s.logs.slice(0, 40).map(function (l) {
    return '<div><span class="t">' + esc(l.ts.slice(5)) + '</span> <span class="' + l.kind + '">[' + l.kind + ']</span> ' + esc(l.detail) + (l.valid === false ? ' <span class="fail">✗</span>' : '') + '</div>';
  }).join('');

  var rules = s.checkRuleBank.map(function (r) { return '<div class="assetrow"><span class="nm">' + esc(r.id) + ' · ' + esc(r.rule) + '</span><span class="ct">' + esc(r.source) + ' · 命中 ' + (r.hits || 0) + '</span></div>'; }).join('');
  var cards = s.materialCards.map(function (m) {
    return '<div class="asset"><b>' + esc(m.id) + ' @' + esc(m.provider) + '</b><div class="why">萃取：' + esc(m.fields.person) + ' ｜ 冲突点：' + esc(m.fields.conflict) + '</div><div class="' + (m.license.status === 'active' ? 'lic' : 'blocked') + '">授权：' + esc(m.license.scope) + ' · ' + m.license.status + ' ｜ 状态：' + m.status + '</div></div>';
  }).join('');

  return '<h2 class="serif"><span class="no">①</span>三资产库 <small>一切留痕，一切沉淀：每个阶段的产出物（含被否决的）都写回这里</small></h2>' +
    '<div class="grid cols3">' + cv + rv + av + '</div>' +
    '<div class="grid cols2" style="margin-top:12px"><div class="card"><h3>📇 素材卡（结构化萃取结果）</h3>' + (cards || '<div class="hint">暂无</div>') + '</div>' +
    '<div class="card"><h3>🛡 自检规则库（捉虫与驳回的复利）</h3><div class="vault" style="border:none">' + rules + '</div></div></div>' +
    '<h2 class="serif"><span class="no">②</span>资产利用矩阵 <small>任何资产至少两个消费方，否则不引入（PRD §7.2）</small></h2>' +
    '<table class="mtx"><tr><th style="text-align:left">资产</th><th>选题</th><th>起草装配</th><th>自检</th><th>发布/小铺</th><th>复盘</th></tr>' +
    '<tr><td class="l">风格档案</td><td class="dash">—</td><td class="m">●必装</td><td class="m">●C4基准</td><td class="dash">—</td><td class="dash">—</td></tr>' +
    '<tr><td class="l">素材卡</td><td class="m">●T1触发</td><td class="m">●优先级2</td><td class="dash">—</td><td class="m">●署名核验</td><td class="o">○清点</td></tr>' +
    '<tr><td class="l">需求信号</td><td class="m">●T2触发</td><td class="m">●优先级4</td><td class="dash">—</td><td class="o">○橱窗投票</td><td class="m">●下篇信号</td></tr>' +
    '<tr><td class="l">未完成选题库</td><td class="m">●复活匹配</td><td class="o">○伏笔</td><td class="dash">—</td><td class="dash">—</td><td class="m">●搁置写入</td></tr>' +
    '<tr><td class="l">自检规则库</td><td class="dash">—</td><td class="dash">—</td><td class="m">●注入+负样本</td><td class="dash">—</td><td class="o">○拦截统计</td></tr>' +
    '<tr><td class="l">捉虫记录</td><td class="dash">—</td><td class="dash">—</td><td class="m">●衍生规则</td><td class="m">●修订痕迹</td><td class="dash">—</td></tr>' +
    '<tr><td class="l">创作档案</td><td class="o">○源起</td><td class="dash">—</td><td class="dash">—</td><td class="m">●诞生档案页</td><td class="m">●归档定型</td></tr></table>' +
    '<h2 class="serif"><span class="no">③</span>编排日志 <small>引擎四动作（Trigger/Assemble/Propose/Writeback）全程可审计 · Contract 校验失败也记录</small></h2>' +
    '<div class="log">' + logs + '</div>' +
    '<div class="card" style="margin-top:12px"><b>引擎校验层（Contract）</b>：① 锚点存在性（evidence_refs 真实可解析）② 授权校验（装配不含未授权素材）③ 配额校验。校验失败 → 丢弃 + 记日志，不降级呈现。</div>';
}

/* ---------------- 启动 ---------------- */
window.addEventListener('hashchange', route);
document.getElementById('btn-reset').addEventListener('click', function () {
  if (!confirm('重置为种子数据？当前 demo 进度将清空。')) return;
  act('reset', {}, '已重置为种子数据');
});

Api.init().then(function (st) {
  App.state = st;
  var mb = document.getElementById('mode-badge');
  if (Api.serverOk) { mb.textContent = '后端模式 · Express + data.json'; mb.className = 'mode server'; }
  else { mb.textContent = '浏览器模式 · 同引擎 + localStorage'; mb.className = 'mode browser'; }
  route();
}).catch(function (e) {
  document.getElementById('view').innerHTML = '<div class="card">启动失败：' + esc(e.message) + '</div>';
});
