/* ============================================================
 * 造物 · Atelier — 前端 SPA app.js v2
 * API 适配：优先后端（/api/health 探活），连不上自动降级为
 * 浏览器内引擎（同一份 shared/engine.js + localStorage）。
 * ============================================================ */
'use strict';

var App = { mode: null, state: null, view: 'workbench', currentWork: null, currentRead: null, editing: null };

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
          addParagraph: [body.wid, body.text, body.kind],
          updateParagraph: [body.wid, body.pid, body.text],
          deleteParagraph: [body.wid, body.pid], renameWork: [body.wid, body.title],
          citeAsset: [body.wid, body.pid, body.assetRef],
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
  clearTimeout(t._h); t._h = setTimeout(function () { t.className = 'toast'; }, err ? 4600 : 2600);
}
var SL = { idea: '选题确认', drafting: '起草中', self_check: '自检中', finalized: '已定稿', published: '已发布', retro: '复盘中', archived: '已归档', shelved: '已搁置' };
function badge(st) { return '<span class="badge b-' + st + '">' + SL[st] + '</span>'; }
function confBadge(c) { var m = { high: ['b-hi', '高置信'], medium: ['b-md', '中置信'], low: ['b-lo', '低置信'] }[c] || ['b-lo', c]; return '<span class="badge ' + m[0] + '">' + m[1] + '</span>'; }
function workById(id) { return App.state.works.find(function (w) { return w.id === id; }); }

/* ---------------- 模态框 ---------------- */
var Modal = {
  show: function (opt) {
    var fields = (opt.fields || []).map(function (f) {
      var input = f.type === 'textarea'
        ? '<textarea id="m-f-' + f.id + '" placeholder="' + esc(f.placeholder || '') + '">' + esc(f.value || '') + '</textarea>'
        : f.type === 'select'
          ? '<select id="m-f-' + f.id + '">' + f.options.map(function (o) { return '<option>' + esc(o) + '</option>'; }).join('') + '</select>'
          : '<input id="m-f-' + f.id + '" placeholder="' + esc(f.placeholder || '') + '" value="' + esc(f.value || '') + '">';
      return '<label class="f">' + esc(f.label) + '</label>' + input;
    }).join('');
    document.getElementById('modal-root').innerHTML =
      '<div class="modal-mask" onclick="if(event.target===this)Modal.close()">' +
      '<div class="modal"><h3>' + esc(opt.title) + '</h3>' +
      (opt.sub ? '<div class="msub">' + esc(opt.sub) + '</div>' : '') + fields +
      '<div class="mfoot"><button onclick="Modal.close()">取消</button>' +
      '<button class="' + (opt.danger ? 'danger' : 'pri') + '" id="m-ok">' + esc(opt.okText || '确认') + '</button></div></div></div>';
    Modal._confirm = opt.onConfirm;
    document.getElementById('m-ok').onclick = function () {
      var vals = {};
      (opt.fields || []).forEach(function (f) {
        var el = document.getElementById('m-f-' + f.id);
        vals[f.id] = el ? el.value.trim() : '';
        if (f.required && !vals[f.id]) { toast(f.label + '为必填', true); throw new Error('required'); }
      });
      try { Modal._confirm(vals); } catch (e) { if (e.message === 'required') return; throw e; }
      Modal.close();
    };
    var first = document.querySelector('.modal input, .modal textarea');
    if (first) first.focus();
  },
  close: function () { document.getElementById('modal-root').innerHTML = ''; }
};

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
  if (h.indexOf('work/') === 0) { App.view = 'workbench'; App.currentWork = h.slice(5); App.currentRead = null; }
  else if (h.indexOf('read/') === 0) { App.view = 'read'; App.currentRead = h.slice(5); App.currentWork = null; }
  else { App.view = h; App.currentWork = null; App.currentRead = null; }
  App.editing = null;
  document.querySelectorAll('.topbar .nav').forEach(function (a) { a.classList.toggle('on', a.dataset.view === App.view); });
  render();
}

function render() {
  var v = document.getElementById('view');
  var html = App.view === 'shop' ? renderShop()
    : App.view === 'vault' ? renderVault()
    : App.view === 'read' ? renderRead(workById(App.currentRead))
    : (App.currentWork ? renderWorkDetail(workById(App.currentWork)) : renderWorkbench());
  v.innerHTML = '<div class="view-anim">' + html + '</div>';
}

/* ===== 工作台 ===== */
function renderWorkbench() {
  var s = App.state;
  var desk = [], proposals = s.proposals.filter(function (p) { return p.status === 'open'; });
  proposals.forEach(function (p) {
    desk.push('<div class="dcard t-prop"><b>📋 选题提议 · ' + esc(p.title) + '</b>' +
      '<span>需求分 ' + p.demandScore + ' · 素材充足度 ' + p.materialReadiness + ' · 触发依据 ' + p.evidenceRefs.length + ' 条</span>' +
      '<span class="ref">' + esc(p.rationale) + '</span>' +
      '<div class="rowline"><button class="pri sm" onclick="confirmProp(\'' + p.id + '\')">确认开写</button><button class="sm" onclick="rejectP(\'' + p.id + '\')">否决</button></div></div>');
  });
  s.works.forEach(function (w) {
    if (w.status === 'self_check' && w.checks.some(function (c) { return c.action === null; }))
      desk.push('<div class="dcard t-check"><b>⚠️ 待处理自检 · ' + esc(w.title) + '</b><span>未处理 ' + w.checks.filter(function (c) { return c.action === null; }).length + ' 条 · 处理完毕才可定稿</span><div class="rowline"><button class="pri sm" onclick="location.hash=\'work/' + w.id + '\'">去处理</button></div></div>');
    if (w.status === 'published')
      desk.push('<div class="dcard t-retro"><b>📈 复盘到期 · ' + esc(w.title) + '</b><span>发布后复盘：资产清点 + 档案归档（不可变）</span><div class="rowline"><button class="pri sm" onclick="location.hash=\'work/' + w.id + '\'">去复盘</button></div></div>');
  });
  s.bugReports.filter(function (b) { return b.status === 'open'; }).forEach(function (b) {
    desk.push('<div class="dcard t-bug"><b>🐛 捉虫待裁决 · @' + esc(b.reader) + '</b><span>' + esc(b.type) + ' · 「' + esc(b.quote).slice(0, 30) + (b.quote.length > 30 ? '…' : '') + '」</span><div class="rowline"><button class="pri sm" onclick="judge(\'' + b.id + '\',\'confirmed\')">确认</button><button class="sm" onclick="judge(\'' + b.id + '\',\'rejected\')">驳回</button></div></div>');
  });
  if (s.noteInbox.length >= 1)
    desk.push('<div class="dcard t-note"><b>🗒 速记收集箱 · ' + s.noteInbox.length + ' 条</b><span>归档后自动分类，并关联未完成选题库</span><div class="rowline"><button class="sm" onclick="act(\'archiveNotes\',{},\'速记已归档（看编排日志）\')">立即归档</button></div></div>');
  if (!desk.length) desk.push('<div class="empty" style="grid-column:1/-1;background:var(--card);border:1px dashed var(--line-2);border-radius:12px"><span class="ei">🍵</span>今日案头清爽 —— 没有待办。<br>去小铺看看读者动向，或在下边开个新题。</div>');

  var lanes = ['idea', 'drafting', 'self_check', 'finalized', 'published', 'archived'];
  var kanban = lanes.map(function (st) {
    var ws = s.works.filter(function (w) { return w.status === st; });
    return '<div class="lane"><h4>' + SL[st] + '<span class="cnt">' + ws.length + '</span></h4>' + (ws.map(function (w) {
      var meta = w.status === 'self_check' ? '⚠ ' + w.checks.filter(function (c) { return !c.action; }).length + ' 条待处理' : (w.paragraphs.length ? w.paragraphs.length + ' 段正文' : '待起草');
      return '<div class="wk" onclick="location.hash=\'work/' + w.id + '\'"><b>' + esc(w.title) + '</b><span class="wm">' + meta + '</span></div>';
    }).join('') || '<div class="lane-empty">空</div>') + '</div>';
  }).join('');
  var shelved = s.works.filter(function (w) { return w.status === 'shelved'; });

  return '<div class="pagehead"><div class="kicker">WORKBENCH · 创作者工作台</div><h1 class="serif">今日案头与流水线</h1>' +
    '<div class="sub">引擎归集待办，创作者做决定。铁律②：所有状态跃迁由你显式触发，AI 只有提议权。</div></div>' +
    '<h2 class="sec"><span class="no">①</span>今日案头 <small>每张卡带触发依据 · 案头不执行状态跃迁</small></h2>' +
    '<div class="desk">' + desk.join('') + '</div>' +
    '<h2 class="sec"><span class="no">②</span>流水线看板 <small>泳道即作品状态机 · 点击卡片进入</small></h2>' +
    '<div class="kanban">' + kanban + '</div>' +
    (shelved.length ? '<div class="card" style="margin-top:12px"><b>🗂 搁置区</b> <span class="hint">（候选区，不是垃圾箱——可被新报料复活）</span><br>' + shelved.map(function (w) { return esc(w.title) + ' <span class="hint">（' + esc(w.shelveReason || '') + '）</span>'; }).join('、') + '</div>' : '') +
    '<div class="grid cols2" style="margin-top:18px">' +
      '<div class="card"><h3>✍️ 手动建题</h3><label class="f">标题</label><input id="mt-title" placeholder="例：为什么我们越来越难说不知道"><label class="f">标签（逗号分隔，用于资产匹配）</label><input id="mt-tags" placeholder="例：远程办公,算法"><div class="rowline"><button class="pri" onclick="manualTopic()">建题并进入起草（自动装配）</button></div></div>' +
      '<div class="card"><h3>🗒 碎片速记</h3><label class="f">一句话、一个链接、一个念头</label><textarea id="qn-text" placeholder="例：转行的人最常说的一句话是「每一块钱都看得见来路」"></textarea><div class="rowline"><button onclick="quickNote()">进收集箱</button><span class="hint">想法变资产的门槛 = 一句话</span></div></div>' +
    '</div>';
}

function confirmProp(pid) {
  var p = App.state.proposals.find(function (x) { return x.id === pid; });
  Modal.show({
    title: '确认开写《' + (p ? p.title : '') + '》？',
    sub: '确认后引擎立即执行装配：按优先级组装风格档案、素材卡、伏笔与知识库（未授权素材会被硬规则拦截）。',
    okText: '确认，开始装配',
    onConfirm: function () { act('confirmProposal', { pid: pid }, '已确认选题，装配完成 → 进入起草'); location.hash = 'workbench'; }
  });
}
function rejectP(pid) {
  Modal.show({
    title: '否决这条提议',
    sub: '否决理由会写回引擎偏好，同类提议降权——被否决的提议同样沉淀为资产（铁律③）。',
    fields: [{ id: 'reason', label: '否决理由', type: 'textarea', placeholder: '例：与上篇选题重复，换个角度再提', required: true }],
    okText: '否决并写回', danger: true,
    onConfirm: function (v) { act('rejectProposal', { pid: pid, reason: v.reason }, '已否决，理由写回资产库'); }
  });
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
  act('quickNote', { text: t }, '已进收集箱（可随时归档）');
}
function judge(bid, verdict) {
  if (verdict === 'confirmed') {
    Modal.show({
      title: '确认这条捉虫？',
      sub: '确认后将：① 在作品上留下修订痕迹 ② 捉虫人上贡献者墙 ③ 提取关键词写入自检规则库（下一篇自动拦截同类错误）。',
      okText: '确认，写回规则库',
      onConfirm: function () { act('adjudicateBug', { bid: bid, verdict: verdict, note: '' }, '已确认：修订痕迹 + 贡献者墙 + 自检规则已写回'); }
    });
  } else {
    Modal.show({
      title: '驳回这条捉虫',
      sub: '驳回记录保留但不公示，理由将回复捉虫人。',
      fields: [{ id: 'note', label: '驳回理由', type: 'textarea', placeholder: '例：原文口径无误，见统计局 2025 年鉴', required: true }],
      okText: '驳回', danger: true,
      onConfirm: function (v) { act('adjudicateBug', { bid: bid, verdict: verdict, note: v.note }, '已驳回，记录保留不公示'); }
    });
  }
}

/* ===== 作品详情 ===== */
var STEP_ORDER = ['idea', 'drafting', 'self_check', 'finalized', 'published', 'retro', 'archived'];
function stepperHtml(w) {
  if (w.status === 'shelved') return '<div class="stepper"><span class="st cur">已搁置 · 回未完成选题库</span></div>';
  var idx = STEP_ORDER.indexOf(w.status);
  return '<div class="stepper">' + STEP_ORDER.map(function (st, i) {
    return '<span class="st ' + (i < idx ? 'done' : i === idx ? 'cur' : '') + '">' + (i < idx ? '✓ ' : '') + SL[st] + '</span>';
  }).join('') + '</div>';
}

function renderWorkDetail(w) {
  if (!w) return '<div class="card">作品不存在。<a href="#workbench">返回看板</a></div>';
  var h = '<div class="doc-head"><div class="crumb"><a href="#workbench">← 返回看板</a><span>/</span>' + badge(w.status) + '<span class="hint">' + esc(w.id) + '</span></div>' +
    '<h1 class="serif">' + esc(w.title) + ' <button class="sm ghost" onclick="renameTitle(\'' + w.id + '\')" title="重命名">✎</button></h1>' +
    '<div class="origin">📌 ' + esc((w.topicOrigin && w.topicOrigin.rationale) || '') + '</div>' + stepperHtml(w) + '</div>';

  /* 起草编辑区 */
  if (w.status === 'drafting' || w.status === 'self_check') {
    var paras = w.paragraphs.map(function (p) {
      var cls = 'para' + (p.kind === 'ai' ? ' ai' : '') + (App.editing === p.id ? ' editing' : '');
      var lab = p.kind === 'ai' ? '<span class="plabel">AI 段落 · 待过目转正</span>' : '';
      var cites = p.citations.map(function (c) { return '<span class="cite">🔗 ' + esc(c.asset) + ' @' + esc(c.anchor) + '</span>'; }).join('');
      var tools = '<span class="ptools"><button class="sm ghost" onclick="startEdit(\'' + w.id + '\',\'' + p.id + '\')">✎ 编辑</button><button class="sm ghost" onclick="delPara(\'' + w.id + '\',\'' + p.id + '\')">删</button></span>';
      var body = App.editing === p.id
        ? '<textarea id="pe-' + p.id + '">' + esc(p.text) + '</textarea><div class="rowline"><button class="pri sm" onclick="savePara(\'' + w.id + '\',\'' + p.id + '\')">保存</button><button class="sm" onclick="cancelEdit()">取消</button>' + (p.kind === 'ai' ? '<span class="hint">改动 AI 段落后将重新标为待过目</span>' : '') + '</div>'
        : esc(p.text) + cites;
      var aiBtn = (p.kind === 'ai' && App.editing !== p.id) ? '<div class="rowline"><button class="sm" onclick="act(\'confirmAI\',{wid:\'' + w.id + '\',pid:\'' + p.id + '\'},\'已过目转正（authorship 底账记录）\')">👁 过目转正</button><span class="hint">铁律②：AI 起草 ≠ AI 署名，须逐段过目</span></div>' : '';
      return '<div class="' + cls + '">' + lab + (App.editing === p.id ? '' : tools) + body + aiBtn + '</div>';
    }).join('');

    var bundle = w.bundle.map(function (b) {
      var citeBtn = (b.status === 'ok' && b.type === '素材卡') ? '<button class="sm pri" onclick="citeTo(\'' + w.id + '\',\'' + b.ref + '\')">引用</button>' : '';
      return '<div class="asset"><div class="arow"><b>' + esc(b.type) + ' · ' + esc(b.ref) + '</b>' + citeBtn + '</div><div class="why">' + esc(b.why) + '</div><div class="lic">优先级 ' + b.pri + ' · 已授权 ✓</div></div>';
    }).join('');
    var blocked = (w.blockedBundle || []).map(function (b) {
      return '<div class="asset"><b>' + esc(b.type) + ' · ' + esc(b.ref) + '</b><div class="why">' + esc(b.why) + '</div><div class="blocked">✗ 硬规则拦截：未授权素材不装配</div></div>';
    }).join('');

    h += '<h2 class="sec"><span class="no">②</span>起草 <small>AI 段落带色标须过目转正 · 右侧为本篇装配包</small></h2>' +
      '<div class="editor-area"><div class="editor">' + (paras || '<div class="empty"><span class="ei">🖋</span>正文为空。写第一段，或让引擎起草一个带数据的背景段<br>（演示 AI 色标、自检命中与定稿拦截）。</div>') +
      '<label class="f">新增段落</label><textarea id="np-text" placeholder="正文从这里继续……"></textarea>' +
      '<div class="rowline"><button class="pri" onclick="addPara(\'' + w.id + '\',\'user\')">写入正文</button>' +
      '<button onclick="addPara(\'' + w.id + '\',\'ai\')">🤖 让引擎起草背景段</button>' +
      (w.status === 'drafting' ? '<button onclick="act(\'submitCheck\',{wid:\'' + w.id + '\'},\'自检完成，看下方报告\')">提交自检 →</button>' : '') +
      '<button class="danger" onclick="shelveW(\'' + w.id + '\')">搁置</button></div>' +
      '<div class="hint">引用玩法：点右侧素材卡「引用」→ 锚点自动登记到最近段落，署名核验的源头。</div>' +
      '</div><div class="drawer"><h4>🧰 资产抽屉 · 本篇装配包</h4>' + (bundle || '<div class="hint">空</div>') + (blocked ? '<h4 style="margin-top:12px">🚫 被拦截</h4>' + blocked : '') + '<div class="hint" style="margin-top:10px">授权是硬门槛：未授权素材即使语义相关也不装配（Contract 校验）。</div></div></div>';
  }

  /* 自检报告 */
  if (w.checks && w.checks.length && ['self_check', 'finalized', 'published', 'retro', 'archived'].indexOf(w.status) >= 0) {
    var items = w.checks.map(function (c) {
      var acts = c.action ? '<span class="badge ' + (c.action === 'accept' ? 'b-ok' : c.action === 'reject' ? 'b-blocked' : 'b-md') + '">' + { accept: '已采纳', reject: '已驳回', hold: '存疑' }[c.action] + '</span>' + (c.reason ? ' <span class="hint">理由：' + esc(c.reason) + '</span>' : '')
        : '<button class="sm pri" onclick="act(\'handleCheck\',{wid:\'' + w.id + '\',cid:\'' + c.id + '\',action:\'accept\'},\'已采纳，记入修订归因\')">采纳</button> ' +
          '<button class="sm" onclick="rejectCheck(\'' + w.id + '\',\'' + c.id + '\')">驳回（理由→负样本）</button>';
      return '<div class="ci"><div class="chead"><span class="badge b-' + c.category.toLowerCase() + '">' + c.category + '</span>' + confBadge(c.confidence) + (c.ruleRef ? '<span class="badge b-rule">规则库 ' + esc(c.ruleRef) + '</span>' : '') + '</div>' +
        '<b>' + esc(c.issue) + '</b><div class="quote">「' + esc(c.anchor.quote) + '」</div><div>' + esc(c.desc) + '</div>' +
        '<div class="cite-line">锚点：' + esc(c.anchor.p) + ' ｜ 建议：' + esc(c.suggestion) + '</div><div class="rowline">' + acts + '</div></div>';
    }).join('');
    var pending = w.checks.filter(function (c) { return !c.action; }).length;
    h += '<h2 class="sec"><span class="no">③</span>自检报告 <small>C1 逻辑 / C2 论据 / C4 风格 + 规则库注入 · 每条带原文锚点 · ' + (pending ? '未处理 ' + pending + ' 条' : '全部处理完毕 ✓') + '</small></h2>' + items +
      (w.status === 'self_check' ? '<div class="rowline"><button class="pri" onclick="act(\'finalize\',{wid:\'' + w.id + '\'},\'已定稿：创作方式声明自动生成\')">定稿 →</button><span class="hint">前置条件：自检全量处理 + 无未转正 AI 段落（引擎强制校验）</span></div>' : '');
  }

  if (w.status === 'finalized') {
    h += '<div class="card"><h3>📄 创作方式声明 <span class="hint">系统生成 · 不可删改</span></h3><p>' + esc(w.declaration) + '</p><div class="rowline"><button class="pri" onclick="act(\'publish\',{wid:\'' + w.id + '\'},\'已发布：署名核验完成，捉虫入口开放\')">发布 →</button></div></div>';
  }
  if (w.status === 'published' || w.status === 'retro') {
    h += '<div class="card"><h3>📮 已发布</h3><p>' + esc(w.declaration || '') + '</p><p>署名区：' + (w.credits.length ? w.credits.map(function (c) { return '<b>' + esc(c.name) + '</b>（' + esc(c.scope) + '，引用 ' + c.count + ' 处，锚点核验 ✓）'; }).join('、') : '无素材引用') + '</p>' +
      '<div class="rowline"><a href="#read/' + w.id + '"><button>📖 阅读页预览</button></a>' + (w.status === 'published' ? '<button class="pri" onclick="act(\'retro\',{wid:\'' + w.id + '\'},\'复盘完成：创作档案归档定型（不可变）\')">复盘并归档 →</button>' : '') + '</div></div>';
  }
  if (w.status === 'archived' && w.archive) {
    h += '<div class="card"><h3>📜 创作档案 <span class="hint">不可变</span></h3><p class="hint">装配 ' + w.archive.bundleSize + ' 项 ｜ 自检 ' + w.archive.checkReport.length + ' 条 ｜ 修订 ' + w.archive.revisions.length + ' 处 ｜ 归档于 ' + esc(w.archive.archivedAt) + '</p><a href="#shop"><button>在小铺看诞生档案</button></a></div>';
  }
  return h;
}

function renameTitle(wid) {
  var w = workById(wid);
  Modal.show({
    title: '重命名作品',
    sub: '标题改动会记入编排日志（铁律③：一切留痕）。',
    fields: [{ id: 'title', label: '新标题', value: w.title, required: true }],
    okText: '保存标题',
    onConfirm: function (v) { act('renameWork', { wid: wid, title: v.title }, '标题已更新'); }
  });
}
function startEdit(wid, pid) { App.editing = pid; render(); var el = document.getElementById('pe-' + pid); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }
function cancelEdit() { App.editing = null; render(); }
function savePara(wid, pid) {
  var el = document.getElementById('pe-' + pid);
  var text = el ? el.value.trim() : '';
  if (!text) return toast('段落内容不能为空', true);
  App.editing = null;
  act('updateParagraph', { wid: wid, pid: pid, text: text }, '段落已更新');
}
function delPara(wid, pid) {
  Modal.show({
    title: '删除这一段？',
    sub: '删除动作会记入编排日志；引用锚点将随段落一并移除。',
    okText: '删除', danger: true,
    onConfirm: function () { act('deleteParagraph', { wid: wid, pid: pid }, '段落已删除（日志留痕）'); }
  });
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
  Modal.show({
    title: '驳回这条自检意见',
    sub: '理由将写回规则库作负样本——同类误报下次自动降权。这也是资产（铁律③）。',
    fields: [{ id: 'reason', label: '驳回理由', type: 'textarea', placeholder: '例：亲历叙事类文章，单一案例可作引子', required: true }],
    okText: '驳回并写回', danger: true,
    onConfirm: function (v) { act('handleCheck', { wid: wid, cid: cid, action: 'reject', reason: v.reason }, '已驳回：理由写回自检规则库（负样本）'); }
  });
}
function shelveW(wid) {
  Modal.show({
    title: '搁置这篇？',
    sub: '搁置不是删除：标题、理由与已有段落写入未完成选题库，未来可被新报料 / 速记自动复活。',
    fields: [{ id: 'reason', label: '搁置理由', type: 'textarea', placeholder: '例：素材不足，等真实案例', required: true }],
    okText: '搁置并入库', danger: true,
    onConfirm: function (v) { act('shelve', { wid: wid, reason: v.reason }, '已搁置，回未完成选题库'); location.hash = 'workbench'; }
  });
}

/* ===== 小铺 ===== */
function renderShop() {
  var s = App.state, c = s.creator;
  var used = s.materialCards.filter(function (m) { return m.status === 'used'; }).length;
  var published = s.works.filter(function (w) { return ['published', 'retro', 'archived'].indexOf(w.status) >= 0; });
  var inProgress = s.works.filter(function (w) { return ['idea', 'drafting', 'self_check'].indexOf(w.status) >= 0; })[0];

  var works = published.map(function (w) {
    var first = w.paragraphs.length ? w.paragraphs[0].text : '';
    var excerpt = esc(first.length > 84 ? first.slice(0, 84) + '…' : first);
    var bugCount = s.bugReports.filter(function (b) { return (b.wid || b.workId) === w.id; }).length;
    var fixCount = (w.revisions || []).filter(function (r) { return r.bugId; }).length;
    return '<a class="article" href="#read/' + w.id + '"><div class="ameta">发布于 ' + esc(w.publishedAt || w.timeline.published || '') + ' ｜ ' + esc(w.id) + ' ｜ ' + w.paragraphs.length + ' 段</div>' +
      '<h3 class="serif">' + esc(w.title) + '</h3>' +
      (excerpt ? '<div class="excerpt">' + excerpt + '</div>' : '') +
      '<div class="ameta" style="margin-top:10px">✍️ 共创 ' + ((w.credits && w.credits.length) ? w.credits.map(function (x) { return '@' + esc(x.name); }).join(' ') : '无素材引用') +
      (fixCount ? ' ｜ 📝 修订 ' + fixCount + ' 处' : '') + (bugCount ? ' ｜ 🐛 捉虫 ' + bugCount + ' 起' : '') + '</div>' +
      '<div class="readmore">阅读全文 →</div></a>';
  }).join('');

  var wallTips = {}, wallBugs = {};
  s.materialCards.filter(function (m) { return m.status === 'used'; }).forEach(function (m) { wallTips[m.provider] = (wallTips[m.provider] || 0) + 1; });
  s.bugReports.filter(function (b) { return b.verdict === 'confirmed'; }).forEach(function (b) { wallBugs[b.reader] = (wallBugs[b.reader] || 0) + 1; });
  var tipRows = Object.keys(wallTips).map(function (k) { return '<div class="wrow"><span>@' + esc(k) + '</span><span class="c">采用 ' + wallTips[k] + ' 次</span></div>'; }).join('') || '<div class="hint" style="padding:8px 0">还没有被采用的报料——来当第一个。</div>';
  var bugRows = Object.keys(wallBugs).map(function (k) { return '<div class="wrow"><span>@' + esc(k) + '</span><span class="c">确认 ' + wallBugs[k] + ' 次</span></div>'; }).join('') || '<div class="hint" style="padding:8px 0">暂无确认的捉虫。</div>';

  var myCards = s.materialCards.map(function (m) {
    var stBadge = m.license.status !== 'active' ? '<span class="badge b-blocked">已撤回</span>' : '<span class="badge ' + (m.status === 'used' ? 'b-ok' : 'b-md') + '">' + (m.status === 'used' ? '已采用' : m.status === 'in_use' ? '创作中' : '等待匹配') + '</span>';
    return '<div class="asset"><div class="arow"><b>' + esc(m.id) + ' · @' + esc(m.provider) + '</b>' + stBadge + '</div><div class="why">' + esc(m.content) + '</div><div class="' + (m.license.status === 'active' ? 'lic' : 'blocked') + '">授权：' + esc(m.license.scope) + '</div>' +
      (m.license.status === 'active' ? '<div class="rowline"><button class="sm danger" onclick="revokeM(\'' + m.id + '\')">撤回授权</button></div>' : '') + '</div>';
  }).join('');

  return '<div class="shophead"><div class="kicker">SHOP · 读者共创的小铺</div><h1 class="serif">' + esc(c.shopName) + '</h1><p class="bio">' + esc(c.bio) + '</p>' +
    '<div class="stats"><div><b>' + published.length + '</b><span>已发布作品</span></div><div><b>' + s.materialCards.length + '</b><span>读者报料</span></div><div><b>' + used + '</b><span>已采用</span></div><div><b>' + s.checkRuleBank.filter(function (r) { return !r.negative; }).length + '</b><span>自检规则</span></div><div><b>' + s.demandSignals.length + '</b><span>需求信号</span></div></div></div>' +
    (inProgress ? '<div class="window-card"><b>🪟 工坊橱窗 · 在制公示</b> <span class="hint">（创作者选择公开，投票只是信号，写不写由创作者决定）</span><br>下一篇方向：<b class="serif">' + esc(inProgress.title) + '</b> · 当前阶段：' + SL[inProgress.status] +
      '<div class="rowline"><button class="sm" onclick="wantSignal(\'' + esc(inProgress.tags[0] || '') + '\')">🗳 投一票想看（入需求信号）</button></div></div>' : '') +
    '<h2 class="sec"><span class="no">①</span>作品陈列 <small>每篇附诞生档案 · 共创署名 · 修订痕迹 · 捉虫入口</small></h2>' + (works || '<div class="empty" style="background:var(--card);border:1px dashed var(--line-2);border-radius:12px"><span class="ei">🕮</span>还没有已发布作品——去工作台跑一遍流水线吧。</div>') +
    '<div class="grid cols2"><div class="card"><h3>📮 我有故事 / 线索（报料）</h3>' +
      '<label class="f">你的昵称</label><input id="tip-reader" placeholder="例：小鹿">' +
      '<label class="f">你的故事 / 线索</label><textarea id="tip-content" placeholder="例：我去年从大厂转行做手艺人，收入降了四成，但每一块钱都看得见来路。&#10;引擎将结构化萃取并匹配需求信号——也许下一篇就是写你。"></textarea>' +
      '<label class="f">授权范围（硬规则 · 法务级显式勾选）</label><select id="tip-scope"><option>具名引用</option><option>须匿名化</option><option>仅作背景参考不直接引用</option></select>' +
      '<div class="rowline"><button class="pri" onclick="submitTip()">提交报料</button></div>' +
      '<div class="hint">可撤回；撤回后引擎立即停配，已发布不追溯。被采用将获文末署名 + 贡献者墙。</div></div>' +
    '<div class="card"><h3>📦 素材卡与授权管理</h3>' + (myCards || '<div class="hint">暂无</div>') + '</div></div>' +
    '<h2 class="sec"><span class="no">②</span>贡献者墙 <small>排名货币 = 被采用的贡献，不是活跃度</small></h2>' +
    '<div class="wall"><div class="card"><h3>📮 报料上榜</h3>' + tipRows + '</div><div class="card"><h3>🐛 捉虫达人</h3>' + bugRows + '</div></div>';
}

/* ===== 阅读页 ===== */
function renderRead(w) {
  if (!w) return '<div class="card">作品不存在。<a href="#shop">返回小铺</a></div>';
  if (['published', 'retro', 'archived'].indexOf(w.status) < 0)
    return '<div class="card">《' + esc(w.title) + '》尚未发布（当前：' + SL[w.status] + '），暂无阅读页。<a href="#workbench">返回工作台</a></div>';
  var s = App.state;
  var byline = s.creator.name || s.creator.shopName;
  var paras = w.paragraphs.map(function (p) {
    var marks = p.citations.map(function (c) {
      var m = s.materialCards.find(function (x) { return x.id === c.asset.split(':').pop(); });
      return '<span class="rmark" title="🔗 ' + esc(c.asset) + ' @' + esc(c.anchor) + ' · 署名核验 ✓">' + (m ? '@' + esc(m.provider) : '素材') + '</span>';
    }).join('');
    return '<p>' + esc(p.text) + marks + '</p>';
  }).join('');
  var creditsLine = (w.credits && w.credits.length)
    ? w.credits.map(function (c) { return '<div class="crow"><b>@' + esc(c.name) + '</b><span>' + esc(c.scope) + ' · 引用 ' + c.count + ' 处 · 锚点核验 ✓</span></div>'; }).join('')
    : '<div class="hint">本篇无读者素材引用。</div>';
  var checkStat = w.checks && w.checks.length ? '自检 ' + w.checks.length + ' 条：采纳 ' + w.checks.filter(function (x) { return x.action === 'accept'; }).length + ' / 驳回 ' + w.checks.filter(function (x) { return x.action === 'reject'; }).length : '—';
  var fixes = (w.revisions || []).filter(function (r) { return r.bugId; }).map(function (r) {
    return '<div class="fix"><span class="tag">修订</span>' + esc(r.ts) + ' 经 @' + esc(r.by) + ' 指正：' + esc(r.note) + ' —— 该纠错已写入自检规则库。</div>';
  }).join('');

  return '<div class="reader"><a class="rback" href="#shop">← 返回小铺</a>' +
    '<div class="rtitle"><div class="rkicker">' + esc(s.creator.shopName) + ' · ' + esc(w.id) + '</div>' +
    '<h1 class="serif">' + esc(w.title) + '</h1>' +
    '<div class="rmeta">文 / ' + esc(byline) + ' ｜ 发布于 ' + esc(w.publishedAt || w.timeline.published || '') + '</div></div>' +
    '<div class="rbody">' + paras + '</div>' +
    '<div class="rdiv">◇ ◇ ◇</div>' +
    '<div class="rsec"><h4>✍️ 本篇共创</h4>' + creditsLine + '</div>' +
    '<div class="rsec"><h4>📜 诞生档案 <span class="hint">创作档案公开字段投影 · 带锚点不可编造</span></h4><div class="arch"><div class="ab">' +
      '<div class="row"><div class="k">选题源起</div><div>' + esc((w.topicOrigin && w.topicOrigin.rationale) || '手动建题') + '</div></div>' +
      '<div class="row"><div class="k">装配</div><div>上下文包 ' + (w.bundle ? w.bundle.length : 0) + ' 项' + ((w.blockedBundle || []).length ? '，拦截未授权素材 ' + w.blockedBundle.length + ' 项' : '') + '</div></div>' +
      '<div class="row"><div class="k">质量机制</div><div>' + checkStat + '</div></div>' +
      '<div class="row"><div class="k">创作方式</div><div>' + esc(w.declaration || '') + '</div></div>' +
    '</div></div></div>' +
    (fixes ? '<div class="rsec"><h4>📝 修订痕迹</h4>' + fixes + '</div>' : '') +
    '<div class="rsec rbug"><h4>🐛 发现错误？捉虫 <span class="hint">确认后永久提高质量下限，捉虫人上贡献者墙</span></h4>' +
      '<div class="grid cols2"><div><label class="f">你的昵称</label><input id="bg-reader-' + w.id + '" placeholder="例：石头"></div>' +
      '<div><label class="f">类型</label><select id="bg-type-' + w.id + '"><option>事实错误</option><option>数据过时</option><option>引用有误</option><option>错别字</option></select></div></div>' +
      '<label class="f">原文引用</label><input id="bg-quote-' + w.id + '" placeholder="选中觉得有误的原文">' +
      '<label class="f">证据（链接/说明）</label><input id="bg-ev-' + w.id + '" placeholder="https://…">' +
      '<div class="rowline"><button class="pri" onclick="submitBug(\'' + w.id + '\')">提交捉虫</button></div></div>' +
  '</div>';
}

function submitTip() {
  var reader = document.getElementById('tip-reader').value.trim();
  var content = document.getElementById('tip-content').value.trim();
  var scope = document.getElementById('tip-scope').value;
  if (!reader || !content) return toast('昵称和故事都要填', true);
  act('submitTip', { reader: reader, content: content, scope: scope }, '报料入库：结构化萃取完成 → 触发器 T1/T2 已运行（看工作台案头）');
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
  Modal.show({
    title: '投一票想看',
    sub: '你的投票将作为需求信号入库，参与下一篇选题的聚类（T2）。',
    fields: [{ id: 'name', label: '你的昵称', placeholder: '匿名读者' }],
    okText: '投票',
    onConfirm: function (v) { act('addSignal', { from: v.name || '匿名读者', text: '投了一票想看（橱窗）', tags: tag ? [tag] : [] }, '已作为需求信号入库（T2 聚类原料）'); }
  });
}
function revokeM(cardId) {
  Modal.show({
    title: '撤回这张素材卡的授权？',
    sub: '撤回后引擎立即停止装配该素材（含在制作品）；已发布作品不追溯。',
    okText: '撤回授权', danger: true,
    onConfirm: function () { act('revokeMaterial', { cardId: cardId }, '已撤回：引擎立即停止装配（已发布不追溯）'); }
  });
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
    return '<div><span class="t">' + esc(l.ts.slice(5)) + '</span><span class="' + l.kind + '">[' + l.kind + ']</span> ' + esc(l.detail) + (l.valid === false ? ' <span class="fail">✗</span>' : '') + '</div>';
  }).join('');

  var rules = s.checkRuleBank.map(function (r) { return '<div class="assetrow"><span class="nm">' + esc(r.id) + ' · ' + esc(r.rule) + (r.negative ? ' <span class="badge b-lo">负样本</span>' : '') + '</span><span class="ct">' + esc(r.source) + ' · 命中 ' + (r.hits || 0) + '</span></div>'; }).join('');
  var cards = s.materialCards.map(function (m) {
    return '<div class="asset"><div class="arow"><b>' + esc(m.id) + ' @' + esc(m.provider) + '</b><span class="badge ' + (m.license.status === 'active' ? 'b-ok' : 'b-blocked') + '">' + (m.license.status === 'active' ? m.license.scope : '已撤回') + '</span></div><div class="why">萃取：' + esc(m.fields.person) + ' ｜ 冲突点：' + esc(m.fields.conflict) + '</div></div>';
  }).join('');

  return '<div class="pagehead"><div class="kicker">VAULT · 三资产库</div><h1 class="serif">一切留痕，一切沉淀</h1>' +
    '<div class="sub">每个阶段的产出物——包括被否决的提议与被驳回的意见——都写回这里，成为下一篇的原料。</div></div>' +
    '<div class="grid cols3">' + cv + rv + av + '</div>' +
    '<div class="grid cols2" style="margin-top:14px"><div class="card"><h3>📇 素材卡（结构化萃取结果）</h3>' + (cards || '<div class="hint">暂无</div>') + '</div>' +
    '<div class="card"><h3>🛡 自检规则库（捉虫与驳回的复利）</h3><div class="vault" style="border:none;box-shadow:none">' + rules + '</div></div></div>' +
    '<h2 class="sec"><span class="no">②</span>资产利用矩阵 <small>任何资产至少两个消费方，否则不引入（PRD §7.2）</small></h2>' +
    '<table class="mtx"><tr><th style="text-align:left">资产</th><th>选题</th><th>起草装配</th><th>自检</th><th>发布/小铺</th><th>复盘</th></tr>' +
    '<tr><td class="l">风格档案</td><td class="dash">—</td><td class="m">●必装</td><td class="m">●C4基准</td><td class="dash">—</td><td class="dash">—</td></tr>' +
    '<tr><td class="l">素材卡</td><td class="m">●T1触发</td><td class="m">●优先级2</td><td class="dash">—</td><td class="m">●署名核验</td><td class="o">○清点</td></tr>' +
    '<tr><td class="l">需求信号</td><td class="m">●T2触发</td><td class="m">●优先级4</td><td class="dash">—</td><td class="o">○橱窗投票</td><td class="m">●下篇信号</td></tr>' +
    '<tr><td class="l">未完成选题库</td><td class="m">●复活匹配</td><td class="o">○伏笔</td><td class="dash">—</td><td class="dash">—</td><td class="m">●搁置写入</td></tr>' +
    '<tr><td class="l">自检规则库</td><td class="dash">—</td><td class="dash">—</td><td class="m">●注入+负样本</td><td class="dash">—</td><td class="o">○拦截统计</td></tr>' +
    '<tr><td class="l">捉虫记录</td><td class="dash">—</td><td class="dash">—</td><td class="m">●衍生规则</td><td class="m">●修订痕迹</td><td class="dash">—</td></tr>' +
    '<tr><td class="l">创作档案</td><td class="o">○源起</td><td class="dash">—</td><td class="dash">—</td><td class="m">●诞生档案页</td><td class="m">●归档定型</td></tr></table>' +
    '<h2 class="sec"><span class="no">③</span>编排日志 <small>引擎四动作（Trigger / Assemble / Propose / Writeback）全程可审计 · Contract 校验失败也记录</small></h2>' +
    '<div class="log">' + logs + '</div>' +
    '<div class="card" style="margin-top:14px"><b>引擎校验层（Contract）</b>：① 锚点存在性（evidence_refs 真实可解析）② 授权校验（装配不含未授权素材）③ 配额校验。校验失败 → 丢弃 + 记日志，不降级呈现。</div>';
}

/* ---------------- 启动 ---------------- */
window.addEventListener('hashchange', route);
document.getElementById('btn-reset').addEventListener('click', function () {
  Modal.show({
    title: '恢复初始数据？',
    sub: '当前内容将被清空，回到「老周的小铺」初始状态。',
    okText: '恢复', danger: true,
    onConfirm: function () { act('reset', {}, '已恢复初始数据'); }
  });
});

document.getElementById('view').innerHTML = '<div class="loading"><div class="spinner"></div><div>正在打开工坊…</div></div>';
Api.init().then(function (st) {
  App.state = st;
  var mb = document.getElementById('mode-badge');
  if (Api.serverOk) { mb.textContent = '后端模式 · Express + data.json'; mb.className = 'mode server'; }
  else { mb.textContent = '浏览器模式 · 同引擎 + localStorage'; mb.className = 'mode browser'; }
  route();
}).catch(function (e) {
  document.getElementById('view').innerHTML = '<div class="card">启动失败：' + esc(e.message) + '</div>';
});
