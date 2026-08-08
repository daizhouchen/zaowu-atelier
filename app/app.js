/* ============================================================
 * 造物 · Atelier — 前端 SPA app.js v0.2
 * API 适配：优先后端（/api/health 探活），连不上自动降级为
 * 浏览器内引擎（同一份 shared/engine.js + localStorage）。
 * AI 双链路：后端配 live.json 时走真实大模型（/api/ai/:task），
 * 否则规则引擎降级 —— 所有 AI 产物带来源角标（铁律②诚实标注）。
 * ============================================================ */
'use strict';

var App = {
  mode: null, ai: { on: false, model: null }, state: null,
  view: 'workbench', currentWork: null, currentRead: null, currentBeta: null, currentReader: null,
  editing: null, paraTool: null, diffSnap: null, drawerTab: 'bundle', vaultResults: null, vaultQuery: '',
  betaAs: null, betaSel: {}
};

/* ---------------- API 适配层 ---------------- */
/* 降级模式下每个动作 → 引擎方法参数映射（与 server.js ACTIONS 一一对应） */
var ARGMAP = {
  confirmProposal: function (b) { return [b.pid]; }, rejectProposal: function (b) { return [b.pid, b.reason]; },
  createManualTopic: function (b) { return [b.title, b.tags]; }, assemble: function (b) { return [b.wid]; },
  addParagraph: function (b) { return [b.wid, b.text, b.kind]; },
  updateParagraph: function (b) { return [b.wid, b.pid, b.text]; },
  deleteParagraph: function (b) { return [b.wid, b.pid]; }, renameWork: function (b) { return [b.wid, b.title]; },
  citeAsset: function (b) { return [b.wid, b.pid, b.assetRef]; },
  confirmAI: function (b) { return [b.wid, b.pid]; }, submitCheck: function (b) { return [b.wid]; },
  handleCheck: function (b) { return [b.wid, b.cid, b.action, b.reason]; },
  finalize: function (b) { return [b.wid]; }, publish: function (b) { return [b.wid]; },
  retro: function (b) { return [b.wid]; }, shelve: function (b) { return [b.wid, b.reason]; },
  quickNote: function (b) { return [b.text]; }, archiveNotes: function () { return []; },
  betaRecommend: function (b) { return [b.wid]; },
  openBeta: function (b) { return [b.wid, b.readers, b.hours]; }, closeBeta: function (b) { return [b.wid]; },
  handleBetaItem: function (b) { return [b.wid, b.itemId, b.action, b.reason]; },
  reviseDone: function (b) { return [b.wid]; },
  titleForge: function (b) { return [b.wid]; }, chooseTitle: function (b) { return [b.wid, b.title]; },
  askParagraph: function (b) { return [b.wid, b.pid]; }, rephrase: function (b) { return [b.wid, b.pid]; },
  applyRephrase: function (b) { return [b.wid, b.pid, b.text]; }, factCheck: function (b) { return [b.wid, b.pid]; },
  searchVault: function (b) { return [b.query]; }, requestAuth: function (b) { return [b.cardId]; },
  setWindowPublic: function (b) { return [b.wid, b.isPublic]; },
  submitTip: function (b) { return [b.reader, b.content, b.scope]; }, revokeMaterial: function (b) { return [b.cardId]; },
  addSignal: function (b) { return [b.from, b.text, b.tags]; },
  submitBug: function (b) { return [b.reader, b.wid, b.quote, b.type, b.evidence]; },
  adjudicateBug: function (b) { return [b.bid, b.verdict, b.note]; },
  submitBetaFeedback: function (b) { return [b.reader, b.wid, b.pid, b.type, b.note]; },
  voteDoubt: function (b) { return [b.reader, b.wid, b.checkId, b.vote]; },
  followWork: function (b) { return [b.reader, b.wid]; }, applyBeta: function (b) { return [b.reader, b.tags]; },
  respondAuth: function (b) { return [b.reqId, b.agree, b.scope]; },
  readerView: function (b) { return [b.name]; }, relations: function () { return []; }
};

var Api = {
  serverOk: false,
  local: null,
  init: function () {
    var self = this;
    return fetch('/api/health').then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.ok) {
          self.serverOk = true;
          App.ai = { on: !!j.ai, model: j.aiModel || null };
          return self.get('/api/state');
        }
        throw new Error('no server');
      })
      .catch(function () {
        self.serverOk = false;
        App.ai = { on: false, model: null };
        var saved = null;
        try { saved = JSON.parse(localStorage.getItem('zaowu-state')); } catch (e) {}
        self.local = new ZaowuEngine.Atelier(saved || ZaowuSeed());
        return self.local.getState();
      });
  },
  get: function (url) { return fetch(url).then(function (r) { return r.json(); }); },
  save: function () { if (!this.serverOk) localStorage.setItem('zaowu-state', JSON.stringify(this.local.getState())); },
  /* 统一动作：返回引擎方法产物（data），并同步刷新 App.state */
  call: function (name, body) {
    var self = this;
    if (this.serverOk) {
      return fetch('/api/action/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j.ok) throw new Error(j.error || '动作失败');
          return self.get('/api/state').then(function (st) { App.state = st; return j.data; });
        });
    }
    return new Promise(function (resolve, reject) {
      try {
        if (name === 'reset') { self.local = new ZaowuEngine.Atelier(ZaowuSeed()); self.save(); App.state = self.local.getState(); resolve({ ok: true }); return; }
        var fn = self.local[name];
        if (typeof fn !== 'function') throw new Error('未知动作 ' + name);
        var out = fn.apply(self.local, (ARGMAP[name] || function () { return []; })(body || {}));
        self.save(); App.state = self.local.getState();
        resolve(out);
      } catch (e) { reject(e); }
    });
  },
  /* AI 任务：后端有 live.json 走真实大模型代理，否则规则引擎降级（同构返回 + by 标注） */
  ai: function (task, body) {
    var self = this, b = body || {};
    if (this.serverOk) {
      return fetch('/api/ai/' + task, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j.ok) throw new Error(j.error || 'AI 任务失败');
          return self.get('/api/state').then(function (st) { App.state = st; return j.data; });
        });
    }
    return new Promise(function (resolve, reject) {
      try {
        var L = self.local, data;
        switch (task) {
          case 'draftSection': data = { paragraph: L.addParagraph(b.wid, '（规则引擎草段）围绕本篇装配包中的素材续写：把亲历者的细节放在段首，让数据只作旁证——这一段等待创作者亲笔改写。', 'ai'), by: 'rules' }; break;
          case 'selfCheck': data = { checks: L.submitCheck(b.wid), by: 'rules' }; break;
          case 'askParagraph': data = { items: L.askParagraph(b.wid, b.pid), by: 'rules' }; break;
          case 'rephrase': data = { candidates: L.rephrase(b.wid, b.pid), by: 'rules' }; break;
          case 'factCheck': data = { findings: L.factCheck(b.wid, b.pid), by: 'rules' }; break;
          case 'extractTip': data = { card: L.submitTip(b.reader, b.content, b.scope), by: 'rules' }; break;
          case 'titleForge': data = { candidates: L.titleForge(b.wid), by: 'rules' }; break;
          default: throw new Error('未知 AI 任务 ' + task);
        }
        self.save(); App.state = L.getState();
        resolve(data);
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
var SL = { idea: '选题确认', drafting: '起草中', self_check: '自检中', beta: '内测中', revising: '修改回环', finalized: '已定稿', published: '已发布', retro: '复盘中', archived: '已归档', shelved: '已搁置' };
function badge(st) { return '<span class="badge b-' + st + '">' + SL[st] + '</span>'; }
function confBadge(c) { var m = { high: ['b-hi', '高置信'], medium: ['b-md', '中置信'], low: ['b-lo', '低置信'] }[c] || ['b-lo', c]; return '<span class="badge ' + m[0] + '">' + m[1] + '</span>'; }
/* AI 产物来源角标：铁律② —— 大模型 / 规则引擎 必须区分呈现 */
function aiTag(by) {
  return by === 'llm'
    ? '<span class="badge b-ai">✦ 大模型生成</span>'
    : '<span class="badge b-rules">规则引擎生成' + (App.ai.on ? '' : ' · 本地部署可启用真实 AI') + '</span>';
}
function workById(id) { return App.state.works.find(function (w) { return w.id === id; }); }
/* 只读计算视图：临时引擎实例（构造时深拷贝 state，绝不写回） */
function ro() { return new ZaowuEngine.Atelier(App.state); }
function roundOf(wid) {
  var rs = (App.state.betaRounds || []).filter(function (r) { return r.wid === wid; });
  return rs.length ? rs[rs.length - 1] : null;
}
function hoursLeft(openedAt, hours) {
  var t = new Date(String(openedAt).replace(' ', 'T')).getTime();
  if (isNaN(t)) return null;
  return Math.round((t + hours * 3600e3 - Date.now()) / 3600e3);
}
function readerLink(name) { return '<a class="rlink" href="#reader/' + encodeURIComponent(name) + '">@' + esc(name) + '</a>'; }

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
  html: function (title, bodyHtml) {
    document.getElementById('modal-root').innerHTML =
      '<div class="modal-mask" onclick="if(event.target===this)Modal.close()">' +
      '<div class="modal wide"><h3>' + esc(title) + '</h3>' + bodyHtml +
      '<div class="mfoot"><button onclick="Modal.close()">关闭</button></div></div></div>';
  },
  close: function () { document.getElementById('modal-root').innerHTML = ''; }
};

/* ---------------- 行为封装 ---------------- */
function act(name, body, okMsg) {
  Api.call(name, body).then(function () {
    if (okMsg) toast(okMsg);
    render();
  }).catch(function (e) { toast('⛔ ' + e.message, true); });
}
/* AI 任务封装：按钮加载态 + 来源角标提示 */
function actAI(task, body, okMsg) {
  toast((App.ai.on ? '✦ 大模型思考中…' : '规则引擎运算中…'));
  return Api.ai(task, body).then(function (data) {
    if (okMsg) toast(okMsg + (data.by === 'llm' ? '（✦ 大模型生成）' : '（规则引擎生成）'));
    render();
    return data;
  }).catch(function (e) { toast('⛔ ' + e.message, true); throw e; });
}

/* ---------------- 路由 ---------------- */
function route() {
  var h = location.hash.replace('#', '') || 'workbench';
  App.currentWork = App.currentRead = App.currentBeta = App.currentReader = null;
  if (h.indexOf('work/') === 0) { App.view = 'workbench'; App.currentWork = h.slice(5); }
  else if (h.indexOf('read/') === 0) { App.view = 'read'; App.currentRead = h.slice(5); }
  else if (h.indexOf('beta/') === 0) { App.view = 'beta'; App.currentBeta = h.slice(5); }
  else if (h.indexOf('reader/') === 0) { App.view = 'reader'; App.currentReader = decodeURIComponent(h.slice(7)); }
  else { App.view = h; }
  App.editing = null; App.paraTool = null; App.diffSnap = null; App.vaultResults = null; App.betaSel = {};
  document.querySelectorAll('.topbar .nav').forEach(function (a) { a.classList.toggle('on', a.dataset.view === App.view); });
  render();
}

function render() {
  var v = document.getElementById('view');
  var html = App.view === 'shop' ? renderShop()
    : App.view === 'vault' ? renderVault()
    : App.view === 'read' ? renderRead(workById(App.currentRead))
    : App.view === 'beta' ? renderBeta(workById(App.currentBeta))
    : App.view === 'reader' ? renderReader(App.currentReader)
    : App.view === 'relations' ? renderRelations()
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
      desk.push('<div class="dcard t-check"><b>⚠️ 待处理自检 · ' + esc(w.title) + '</b><span>未处理 ' + w.checks.filter(function (c) { return c.action === null; }).length + ' 条 · 处理完毕才可定稿/内测</span><div class="rowline"><button class="pri sm" onclick="location.hash=\'work/' + w.id + '\'">去处理</button></div></div>');
    if (w.status === 'beta') {
      var r = roundOf(w.id);
      if (r && r.status === 'open') {
        var responded = {}; r.feedbacks.forEach(function (f) { responded[f.reader] = 1; });
        var doneAll = r.readers.every(function (n) { return responded[n]; });
        var left = hoursLeft(r.openedAt, r.hours);
        desk.push('<div class="dcard t-beta"><b>' + (doneAll ? '📬 内测收齐 · ' : '⏳ 内测进行中 · ') + esc(w.title) + '</b><span>首读者 ' + Object.keys(responded).length + '/' + r.readers.length + ' 已反馈 · ' + r.feedbacks.length + ' 条标注' + (left != null ? ' · 窗口剩余 ' + Math.max(0, left) + 'h' : '') + (doneAll ? ' · 可关窗聚合' : '') + '</span><div class="rowline"><button class="pri sm" onclick="location.hash=\'work/' + w.id + '\'">去控制台</button></div></div>');
      }
      if (r && r.status === 'closed' && r.report && r.report.items.some(function (i) { return !i.action; }))
        desk.push('<div class="dcard t-beta"><b>📮 内测反馈待处理 · ' + esc(w.title) + '</b><span>聚合报告 ' + r.report.items.filter(function (i) { return !i.action; }).length + ' 条待逐条处理（采纳 → 修改回环）</span><div class="rowline"><button class="pri sm" onclick="location.hash=\'work/' + w.id + '\'">去处理</button></div></div>');
    }
    if (w.status === 'revising')
      desk.push('<div class="dcard t-beta"><b>🔧 修改回环 · ' + esc(w.title) + '</b><span>按已采纳的内测反馈修改后，提交增量自检（只扫变更段）</span><div class="rowline"><button class="pri sm" onclick="location.hash=\'work/' + w.id + '\'">去修改</button></div></div>');
    if (w.status === 'published')
      desk.push('<div class="dcard t-retro"><b>📈 复盘到期 · ' + esc(w.title) + '</b><span>发布满 7 天提醒 · 资产清点 + 档案归档（不可变）</span><div class="rowline"><button class="pri sm" onclick="location.hash=\'work/' + w.id + '\'">去复盘</button></div></div>');
  });
  s.bugReports.filter(function (b) { return b.status === 'open'; }).forEach(function (b) {
    desk.push('<div class="dcard t-bug"><b>🐛 捉虫待裁决 · @' + esc(b.reader) + '</b><span>' + esc(b.type) + ' · 「' + esc(b.quote).slice(0, 30) + (b.quote.length > 30 ? '…' : '') + '」</span><div class="rowline"><button class="pri sm" onclick="judge(\'' + b.id + '\',\'confirmed\')">确认</button><button class="sm" onclick="judge(\'' + b.id + '\',\'rejected\')">驳回</button></div></div>');
  });
  if (s.noteInbox.length >= 1)
    desk.push('<div class="dcard t-note"><b>🗒 速记收集箱 · ' + s.noteInbox.length + ' 条</b><span>归档后自动分类，并关联未完成选题库</span><div class="rowline"><button class="sm" onclick="act(\'archiveNotes\',{},\'速记已归档（看编排日志）\')">立即归档</button></div></div>');
  if (!desk.length) desk.push('<div class="empty" style="grid-column:1/-1;background:var(--card);border:1px dashed var(--line-2);border-radius:12px"><span class="ei">🍵</span>今日案头清爽 —— 没有待办。<br>去小铺看看读者动向，或在下边开个新题。</div>');

  var lanes = ['idea', 'drafting', 'self_check', 'beta', 'revising', 'finalized', 'published', 'archived'];
  var kanban = lanes.map(function (st) {
    var ws = s.works.filter(function (w) { return w.status === st; });
    return '<div class="lane"><h4>' + SL[st] + '<span class="cnt">' + ws.length + '</span></h4>' + (ws.map(function (w) {
      var meta;
      if (w.status === 'self_check') meta = '⚠ ' + w.checks.filter(function (c) { return !c.action; }).length + ' 条待处理';
      else if (w.status === 'beta') {
        var r = roundOf(w.id);
        meta = r ? (r.status === 'open' ? '⏳ ' + r.feedbacks.length + ' 条标注 · 剩 ' + Math.max(0, hoursLeft(r.openedAt, r.hours) || 0) + 'h' : '📮 报告待处理') : '内测';
      }
      else if (w.status === 'revising') meta = '🔧 采纳反馈修改中';
      else meta = (w.paragraphs.length ? w.paragraphs.length + ' 段正文' : '待起草');
      return '<div class="wk" onclick="location.hash=\'work/' + w.id + '\'"><b>' + esc(w.title) + '</b><span class="wm">' + meta + '</span></div>';
    }).join('') || '<div class="lane-empty">空</div>') + '</div>';
  }).join('');
  var shelved = s.works.filter(function (w) { return w.status === 'shelved'; });

  return '<div class="pagehead"><div class="kicker">WORKBENCH · 创作者工作台</div><h1 class="serif">今日案头与流水线</h1>' +
    '<div class="sub">引擎归集待办，创作者做决定。铁律②：所有状态跃迁由你显式触发，AI 只有提议权。</div></div>' +
    '<h2 class="sec"><span class="no">①</span>今日案头 <small>每张卡带触发依据 · 案头不执行状态跃迁</small></h2>' +
    '<div class="desk">' + desk.join('') + '</div>' +
    '<h2 class="sec"><span class="no">②</span>流水线看板 <small>完整 10 态状态机 · beta 内测与 revising 修改回环已入泳道</small></h2>' +
    '<div class="kanban k8">' + kanban + '</div>' +
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
  Api.call('createManualTopic', { title: t, tags: tags }).then(function () {
    toast('已建题并完成装配');
    location.hash = 'work/' + App.state.works[0].id;
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
      sub: '确认后将：① 在作品上留下修订痕迹 ② 捉虫人上贡献者墙 ③ 提取关键词写入自检规则库 ④ 数据过时类 → 引用管家把同源引用标记「已知过时」。',
      okText: '确认，写回规则库',
      onConfirm: function () { act('adjudicateBug', { bid: bid, verdict: verdict, note: '' }, '已确认：修订痕迹 + 贡献者墙 + 规则库/引用管家已写回'); }
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
var STEP_ORDER = ['idea', 'drafting', 'self_check', 'beta', 'revising', 'finalized', 'published', 'retro', 'archived'];
function stepperHtml(w) {
  if (w.status === 'shelved') return '<div class="stepper"><span class="st cur">已搁置 · 回未完成选题库</span></div>';
  var idx = STEP_ORDER.indexOf(w.status);
  return '<div class="stepper">' + STEP_ORDER.map(function (st, i) {
    var skipped = (st === 'beta' || st === 'revising') && i < idx && !roundOf(w.id);
    return '<span class="st ' + (i < idx ? (skipped ? 'skip' : 'done') : i === idx ? 'cur' : '') + '">' + (i < idx && !skipped ? '✓ ' : '') + SL[st] + (skipped ? '（跳过）' : '') + '</span>';
  }).join('') + '</div>';
}

var EDITABLE_UI = ['drafting', 'self_check', 'revising'];

function renderWorkDetail(w) {
  if (!w) return '<div class="card">作品不存在。<a href="#workbench">返回看板</a></div>';
  var s = App.state;
  var round = roundOf(w.id);
  var h = '<div class="doc-head"><div class="crumb"><a href="#workbench">← 返回看板</a><span>/</span>' + badge(w.status) + '<span class="hint">' + esc(w.id) + '</span>' +
    (['idea', 'drafting', 'self_check', 'beta', 'revising'].indexOf(w.status) >= 0 ? '<span class="hint">｜ 橱窗公示 <button class="sm ghost" onclick="act(\'setWindowPublic\',{wid:\'' + w.id + '\',isPublic:' + (w.windowPublic === false ? 'true' : 'false') + '},\'橱窗公示已' + (w.windowPublic === false ? '开启' : '关闭') + '\')">' + (w.windowPublic === false ? '已关 · 点击开启' : '开 · 点击关闭') + '</button></span>' : '') +
    '</div>' +
    '<h1 class="serif">' + esc(w.title) + ' <button class="sm ghost" onclick="renameTitle(\'' + w.id + '\')" title="重命名">✎</button></h1>' +
    '<div class="origin">📌 ' + esc((w.topicOrigin && w.topicOrigin.rationale) || '') + '</div>' + stepperHtml(w) + '</div>';

  /* 引用管家提醒条：本篇引用的源被捉虫标「已知过时」 */
  var stale = (s.citationBank || []).filter(function (c) { return c.fresh === 'stale' && c.usedBy.indexOf(w.id) >= 0; });
  if (stale.length && w.status !== 'archived')
    h += '<div class="alertbar">⚠️ 引用管家提醒：本篇引用源 ' + stale.map(function (c) { return c.id + '（' + esc(c.url.slice(0, 40)) + '…）'; }).join('、') + ' 已被捉虫标记「已知过时」，请核对相关数据。</div>';

  /* 起草编辑区（drafting / self_check / revising 可编辑） */
  if (EDITABLE_UI.indexOf(w.status) >= 0) {
    var heat = (round && round.report && round.report.heat) || {};
    var paras = w.paragraphs.map(function (p) {
      var cls = 'para' + (p.kind === 'ai' ? ' ai' : '') + (App.editing === p.id ? ' editing' : '');
      var lab = p.kind === 'ai' ? '<span class="plabel">AI 段落 · 待过目转正</span>' : '';
      var heatTag = heat[p.id] ? '<span class="heat" title="内测标注热力">🔥 内测标注 ' + heat[p.id] + ' 条</span>' : '';
      var cites = p.citations.map(function (c) { return '<span class="cite">🔗 ' + esc(c.asset) + ' @' + esc(c.anchor) + '</span>'; }).join('');
      var tools = '<span class="ptools">' +
        '<button class="sm ghost" onclick="paraAsk(\'' + w.id + '\',\'' + p.id + '\')" title="单段即时自检 C1/C2">❓问一问</button>' +
        '<button class="sm ghost" onclick="paraRephrase(\'' + w.id + '\',\'' + p.id + '\')" title="按风格档案重写 2 候选">✍换个说法</button>' +
        '<button class="sm ghost" onclick="paraFact(\'' + w.id + '\',\'' + p.id + '\')" title="对照引用源库与知识库，只报不改">✔核一核</button>' +
        '<button class="sm ghost" onclick="startEdit(\'' + w.id + '\',\'' + p.id + '\')">✎ 编辑</button><button class="sm ghost" onclick="delPara(\'' + w.id + '\',\'' + p.id + '\')">删</button></span>';
      var body = App.editing === p.id
        ? '<textarea id="pe-' + p.id + '">' + esc(p.text) + '</textarea><div class="rowline"><button class="pri sm" onclick="savePara(\'' + w.id + '\',\'' + p.id + '\')">保存</button><button class="sm" onclick="cancelEdit()">取消</button>' + (p.kind === 'ai' ? '<span class="hint">改动 AI 段落后将重新标为待过目</span>' : '') + '</div>'
        : esc(p.text) + cites + heatTag;
      var aiBtn = (p.kind === 'ai' && App.editing !== p.id) ? '<div class="rowline"><button class="sm" onclick="act(\'confirmAI\',{wid:\'' + w.id + '\',pid:\'' + p.id + '\'},\'已过目转正（authorship 底账记录）\')">👁 过目转正</button><span class="hint">铁律②：AI 起草 ≠ AI 署名，须逐段过目</span></div>' : '';
      var toolPanel = (App.paraTool && App.paraTool.pid === p.id) ? paraToolHtml(w, p) : '';
      return '<div class="' + cls + '">' + lab + (App.editing === p.id ? '' : tools) + body + aiBtn + toolPanel + '</div>';
    }).join('');

    var drawer = renderDrawer(w);

    h += '<h2 class="sec"><span class="no">②</span>' + (w.status === 'revising' ? '修改回环 · 按内测反馈修订' : '起草') + ' <small>段落悬停出三动作（问一问 / 换个说法 / 核一核）· AI 段落带色标须过目转正</small></h2>' +
      '<div class="editor-area"><div class="editor">' + (paras || '<div class="empty"><span class="ei">🖋</span>正文为空。写第一段，或让引擎起草一个带数据的背景段<br>（演示 AI 色标、自检命中与定稿拦截）。</div>') +
      '<label class="f">新增段落</label><textarea id="np-text" placeholder="正文从这里继续……（粘贴 URL 会被引用管家自动登记为引用源）"></textarea>' +
      '<div class="rowline"><button class="pri" onclick="addPara(\'' + w.id + '\')">写入正文</button>' +
      '<button onclick="aiDraft(\'' + w.id + '\')">' + (App.ai.on ? '✦ 让大模型起草背景段' : '🤖 让引擎起草背景段') + '</button>' +
      (w.status === 'drafting' ? '<button onclick="doSelfCheck(\'' + w.id + '\')">提交自检 →</button>' : '') +
      (w.status === 'revising' ? '<button class="pri" onclick="act(\'reviseDone\',{wid:\'' + w.id + '\'},\'增量自检完成：只扫了变更段（已驳回项不重复报）\')">修改完成 · 提交增量自检 →</button>' : '') +
      '<button class="danger" onclick="shelveW(\'' + w.id + '\')">搁置</button></div>' +
      '<div class="hint">引用玩法：点右侧素材卡「引用」→ 锚点自动登记到最近段落，署名核验的源头。</div>' +
      '</div>' + drawer + '</div>';
  }

  /* 修改回环：待落实的采纳项清单 */
  if (w.status === 'revising' && round && round.report) {
    var todo = round.report.items.filter(function (i) { return i.action === 'accept' || i.action === 'gold'; });
    h += '<div class="card beta-card"><h3>🔧 本轮已采纳的内测反馈（修改依据）</h3>' + todo.map(function (i) {
      return '<div class="bi"><span class="badge b-beta">' + esc(i.type) + '</span>' + (i.action === 'gold' ? '<span class="badge b-gold">💎 极有价值</span>' : '') + (i.strong ? '<span class="badge b-strong">⚡ 共识 ' + i.count + '/' + round.report.total + '</span>' : '<span class="hint">' + i.count + '/' + round.report.total + ' 人</span>') + ' 段落 ' + esc(i.pid) + (i.notes.length ? '<div class="hint">' + i.notes.map(esc).join('；') + '</div>' : '') + '</div>';
    }).join('') + '<div class="hint">改完正文后点上方「修改完成 · 提交增量自检」——只扫变更段，已驳回项不重复报。</div></div>';
  }

  /* 自检报告 */
  if (w.checks && w.checks.length && ['self_check', 'beta', 'revising', 'finalized', 'published', 'retro', 'archived'].indexOf(w.status) >= 0) {
    var items = w.checks.map(function (c) {
      var acts = c.action ? '<span class="badge ' + (c.action === 'accept' ? 'b-ok' : c.action === 'reject' ? 'b-blocked' : 'b-md') + '">' + { accept: '已采纳', reject: '已驳回', hold: '存疑' }[c.action] + '</span>' + (c.reason ? ' <span class="hint">理由：' + esc(c.reason) + '</span>' : '')
        : '<button class="sm pri" onclick="act(\'handleCheck\',{wid:\'' + w.id + '\',cid:\'' + c.id + '\',action:\'accept\'},\'已采纳，记入修订归因\')">采纳</button> ' +
          '<button class="sm" onclick="rejectCheck(\'' + w.id + '\',\'' + c.id + '\')">驳回（理由→负样本）</button> ' +
          '<button class="sm" onclick="act(\'handleCheck\',{wid:\'' + w.id + '\',cid:\'' + c.id + '\',action:\'hold\'},\'已标存疑 → 内测窗口交首读者投票众裁\')">存疑（交内测投票）</button>';
      return '<div class="ci"><div class="chead"><span class="badge b-' + c.category.toLowerCase() + '">' + c.category + '</span>' + confBadge(c.confidence) + (c.ruleRef ? '<span class="badge b-rule">规则库 ' + esc(c.ruleRef) + '</span>' : '') + aiTag(c.source === 'llm' ? 'llm' : 'rules') + '</div>' +
        '<b>' + esc(c.issue) + '</b><div class="quote">「' + esc(c.anchor.quote) + '」</div><div>' + esc(c.desc) + '</div>' +
        '<div class="cite-line">锚点：' + esc(c.anchor.p) + (c.suggestion ? ' ｜ 建议：' + esc(c.suggestion) : '') + '</div><div class="rowline">' + acts + '</div></div>';
    }).join('');
    var pending = w.checks.filter(function (c) { return !c.action; }).length;
    h += '<h2 class="sec"><span class="no">③</span>自检报告 <small>C1-C5 逐段扫描 · 每条带原文锚点（无法命中原文的 AI 意见整条丢弃）· ' + (pending ? '未处理 ' + pending + ' 条' : '全部处理完毕 ✓') + '</small></h2>' + items +
      (w.status === 'self_check' && !pending ? '<div class="rowline"><button class="pri" onclick="act(\'finalize\',{wid:\'' + w.id + '\'},\'已定稿：创作方式声明自动生成 → 标题工坊开启\')">直接定稿 →</button><span class="hint">也可先开内测（推荐）——跳过内测将记入 skipped_stages，复盘时与捉虫量对照归因</span></div>' : '');
  }

  /* 内测面板（自检全处理完 → 可开内测） */
  if (w.status === 'self_check' && w.checks.length && !w.checks.some(function (c) { return !c.action; })) {
    h += renderBetaOpenPanel(w);
  }
  if (w.status === 'beta' && round) {
    h += round.status === 'open' ? renderBetaConsole(w, round) : (round.report ? renderBetaReport(w, round) : '');
  }
  if (round && round.report && ['revising', 'self_check', 'finalized', 'published', 'retro', 'archived'].indexOf(w.status) >= 0 && w.status !== 'beta') {
    h += renderBetaReport(w, round, true);
  }

  if (w.status === 'finalized') {
    h += '<div class="card"><h3>📄 创作方式声明 <span class="hint">系统生成 · 不可删改</span></h3><p>' + esc(w.declaration) + '</p></div>' + renderTitleForge(w) +
      '<div class="card"><div class="rowline"><button class="pri" onclick="act(\'publish\',{wid:\'' + w.id + '\'},\'已发布：署名核验完成，捉虫入口开放，追更读者已收到推送\')">发布 →</button><span class="hint">发布前可先过标题工坊——候选与选择都会写入标题实验记录</span></div></div>';
  }
  if (w.status === 'published' || w.status === 'retro') {
    h += '<div class="card"><h3>📮 已发布</h3><p>' + esc(w.declaration || '') + '</p><p>署名区：' + (w.credits.length ? w.credits.map(function (c) { return '<b>' + esc(c.name) + '</b>（' + esc(c.scope) + '，引用 ' + c.count + ' 处，锚点核验 ✓）'; }).join('、') : '无素材引用') + '</p>' +
      '<div class="rowline"><a href="#read/' + w.id + '"><button>📖 阅读页预览</button></a>' + (w.status === 'published' ? '<button class="pri" onclick="act(\'retro\',{wid:\'' + w.id + '\'},\'复盘完成：创作档案归档定型（不可变）\')">复盘并归档 →</button>' : '') + '</div></div>';
  }
  if (w.status === 'archived' && w.archive) {
    h += '<div class="card"><h3>📜 创作档案 <span class="hint">不可变</span></h3><p class="hint">装配 ' + w.archive.bundleSize + ' 项 ｜ 自检 ' + w.archive.checkReport.length + ' 条 ｜ 修订 ' + w.archive.revisions.length + ' 处 ｜ 归档于 ' + esc(w.archive.archivedAt) + '</p><a href="#read/' + w.id + '"><button>看阅读页诞生档案</button></a></div>';
  }

  /* 版本对照（自检前后 / 内测前后 4 类快照） */
  var snaps = (s.versionSnapshots || []).filter(function (v) { return v.wid === w.id; });
  if (snaps.length) h += renderVersions(w, snaps);
  return h;
}

/* ===== 段落级三动作（问一问 / 换个说法 / 核一核） ===== */
function paraToolHtml(w, p) {
  var t = App.paraTool;
  var kindName = { ask: '❓ 问一问 · 单段即时自检（C1/C2）', rephrase: '✍ 换个说法 · 按风格档案重写', fact: '✔ 核一核 · 事实比对（只报不改）' }[t.kind];
  var body = '';
  if (t.kind === 'ask') {
    var items = t.data.items || [];
    body = items.length ? items.map(function (c) {
      return '<div class="ti"><span class="badge b-' + c.category.toLowerCase() + '">' + c.category + '</span>' + confBadge(c.confidence) + ' <b>' + esc(c.issue) + '</b><div class="quote">「' + esc(c.anchor.quote) + '」</div><div>' + esc(c.desc) + '</div>' + (c.suggestion ? '<div class="hint">建议：' + esc(c.suggestion) + '</div>' : '') + '</div>';
    }).join('') : '<div class="ti hint">本段未发现 C1/C2 问题 —— 逻辑与论据锚点均通过。</div>';
  } else if (t.kind === 'rephrase') {
    var cands = t.data.candidates || [];
    App._rephraseCands = cands;
    body = cands.map(function (c, i) {
      return '<div class="tcand">' + esc(c) + '<div class="rowline"><button class="pri sm" onclick="applyRephrase(\'' + w.id + '\',\'' + p.id + '\',' + i + ')">采用此候选</button><span class="hint">采用后转 AI 色标，须重新过目转正</span></div></div>';
    }).join('');
  } else {
    var fs = t.data.findings || [];
    body = fs.map(function (f) {
      var vb = f.verdict === '有出入' ? 'b-blocked' : f.verdict === '无依据' ? 'b-md' : 'b-ok';
      return '<div class="ti"><span class="badge ' + vb + '">' + esc(f.verdict) + '</span> <b>' + esc(f.claim) + '</b><div class="hint">' + esc(f.basis) + '</div></div>';
    }).join('');
  }
  return '<div class="toolpanel"><div class="tphead"><b>' + kindName + '</b>' + aiTag(t.data.by) + '<span class="sp"></span><button class="sm ghost" onclick="closeParaTool()">收起 ▴</button></div>' + body + '</div>';
}
function closeParaTool() { App.paraTool = null; render(); }
function paraAsk(wid, pid) {
  actAI('askParagraph', { wid: wid, pid: pid }).then(function (d) { App.paraTool = { pid: pid, kind: 'ask', data: d }; render(); });
}
function paraRephrase(wid, pid) {
  actAI('rephrase', { wid: wid, pid: pid }).then(function (d) { App.paraTool = { pid: pid, kind: 'rephrase', data: d }; render(); });
}
function paraFact(wid, pid) {
  actAI('factCheck', { wid: wid, pid: pid }).then(function (d) { App.paraTool = { pid: pid, kind: 'fact', data: d }; render(); });
}
function applyRephrase(wid, pid, idx) {
  var text = (App._rephraseCands || [])[idx];
  if (!text) return;
  act('applyRephrase', { wid: wid, pid: pid, text: text }, '已采用候选 · 段落转为 AI 色标，定稿前须过目转正');
}

/* ===== 资产抽屉（装配包 + 全库检索） ===== */
function renderDrawer(w) {
  var tab = App.drawerTab;
  var head = '<div class="dtabs"><button class="dtab' + (tab === 'bundle' ? ' on' : '') + '" onclick="App.drawerTab=\'bundle\';render()">📦 装配包</button>' +
    '<button class="dtab' + (tab === 'search' ? ' on' : '') + '" onclick="App.drawerTab=\'search\';render()">🔍 全库检索</button></div>';
  var body;
  if (tab === 'bundle') {
    var lastPid = w.paragraphs.length ? w.paragraphs[w.paragraphs.length - 1].id : null;
    var items = (w.bundle || []).map(function (b) {
      var citeBtn = (b.type === '素材卡' && b.status === 'ok' && lastPid) ? '<button class="sm" onclick="citeTo(\'' + w.id + '\',\'' + lastPid + '\',\'' + b.ref + '\')">引用→' + lastPid + '</button>' : '';
      return '<div class="asset"><b>' + esc(b.type) + '</b> <span class="hint">' + esc(b.ref) + '</span>' + (b.detail ? '<div class="hint">' + b.detail.map(esc).join('<br>') + '</div>' : '') + '<div class="hint">' + esc(b.why) + '</div>' + citeBtn + '</div>';
    }).join('');
    var blocked = (w.blockedBundle || []).map(function (b) {
      return '<div class="asset dim"><b>' + esc(b.type) + '</b> <span class="hint">' + esc(b.ref) + '</span><div><span class="badge b-blocked">引用被阻断</span></div><div class="hint">' + esc(b.why) + '</div><button class="sm" onclick="act(\'requestAuth\',{cardId:\'' + b.ref + '\'},\'授权请求已发送给报料人（读者端同意后自动解锁）\')">发起授权请求</button></div>';
    }).join('');
    body = items + blocked + (!items && !blocked ? '<div class="hint">装配包为空。</div>' : '');
  } else {
    body = '<input id="vq" placeholder="跨素材/信号/档案/引用检索…" value="' + esc(App.vaultQuery) + '" onkeydown="if(event.key===\'Enter\')doVaultSearch()">' +
      '<div class="rowline"><button class="pri sm" onclick="doVaultSearch()">检索</button><span class="hint">未授权素材可见但引用被阻断，可一键发起授权</span></div>' +
      (App.vaultResults == null ? '<div class="hint">全库检索：素材卡 / 需求信号 / 知识库 / 素材库 / 搁置选题 / 引用源 / 创作档案。</div>'
        : (App.vaultResults.length ? App.vaultResults.map(function (r) {
          var authBtn = (r.kind === '素材卡' && !r.usable) ? '<button class="sm" onclick="act(\'requestAuth\',{cardId:\'' + r.id + '\'},\'授权请求已发送\')">发起授权请求</button>' : '';
          return '<div class="asset' + (r.usable ? '' : ' dim') + '"><span class="badge b-md">' + esc(r.kind) + '</span> <b>' + esc(r.text) + '</b><div class="hint">' + esc(r.meta) + (r.usable ? '' : ' · 引用被阻断') + '</div>' + authBtn + '</div>';
        }).join('') : '<div class="hint">「' + esc(App.vaultQuery) + '」无命中。</div>'));
  }
  return '<div class="drawer">' + head + '<div class="dbody">' + body + '</div></div>';
}
function doVaultSearch() {
  var el = document.getElementById('vq');
  var q = el ? el.value.trim() : '';
  if (!q) return toast('先输入关键词', true);
  App.vaultQuery = q;
  Api.call('searchVault', { query: q }).then(function (res) {
    App.vaultResults = res;
    render();
    var el2 = document.getElementById('vq');
    if (el2) { el2.value = q; el2.focus(); }
  }).catch(function (e) { toast('⛔ ' + e.message, true); });
}

/* ===== 内测：开测面板 / 控制台 / 聚合报告 ===== */
function renderBetaOpenPanel(w) {
  var recs = ro().betaRecommend(w.id);
  var rows = recs.map(function (r, i) {
    return '<label class="brec"><input type="checkbox" data-reader="' + esc(r.name) + '"' + (i < 3 ? ' checked' : '') + '> <b>@' + esc(r.name) + '</b> <span class="hint">' + esc(r.why) + (r.topical ? ' · 主题匹配 ✓' : '') + '</span></label>';
  }).join('');
  return '<div class="card beta-card"><h3>🧪 开启内测（§5.5 检查清单已通过 ✓）</h3>' +
    '<div class="hint">首读者按「主题匹配 + 反馈质量分」排序推荐 · 勾选 1~8 位：</div>' +
    '<div id="beta-recs">' + rows + '</div>' +
    '<label class="f">窗口时长</label><select id="beta-hours"><option value="24">24 小时</option><option value="48" selected>48 小时</option><option value="72">72 小时</option></select>' +
    '<div class="rowline"><button class="pri" onclick="doOpenBeta(\'' + w.id + '\')">开启内测 →（自动存「内测前」快照）</button>' +
    '<span class="hint">前置校验：自检全处理 ✓ · 无未转正 AI 段 ✓</span></div></div>';
}
function doOpenBeta(wid) {
  var readers = [];
  document.querySelectorAll('#beta-recs input:checked').forEach(function (el) { readers.push(el.dataset.reader); });
  if (!readers.length) return toast('至少勾选 1 位首读者', true);
  var hours = parseInt(document.getElementById('beta-hours').value, 10) || 48;
  act('openBeta', { wid: wid, readers: readers, hours: hours }, '内测窗口已开启 · 首读者 ' + readers.length + ' 位 · 预读页带盲水印');
}

function renderBetaConsole(w, r) {
  var responded = {}; r.feedbacks.forEach(function (f) { responded[f.reader] = 1; });
  r.doubts.forEach(function (d) { Object.keys(d.votes).forEach(function (n) { responded[n] = 1; }); });
  var left = hoursLeft(r.openedAt, r.hours);
  var readerBadges = r.readers.map(function (n) {
    return '<span class="badge ' + (responded[n] ? 'b-ok' : 'b-md') + '">' + (responded[n] ? '✓ ' : '⏳ ') + '@' + esc(n) + '</span>';
  }).join(' ');
  var stream = r.feedbacks.slice().sort(function (a, b) { return a.ts < b.ts ? 1 : -1; }).map(function (f) {
    return '<div class="bf"><span class="badge b-beta">' + esc(f.type) + '</span> ' + readerLink(f.reader) + ' · ' + esc(f.pid) + '<span class="hint"> ' + esc(f.ts) + '</span>' + (f.note ? '<div class="hint">「' + esc(f.note) + '」</div>' : '') + '</div>';
  }).join('') || '<div class="hint">还没有标注进来 —— 把预读页链接发给首读者。</div>';
  var doubts = r.doubts.length ? '<div class="bsub"><b>存疑众裁</b>' + r.doubts.map(function (d) {
    var agree = Object.keys(d.votes).filter(function (n) { return d.votes[n] === 'agree'; }).length;
    return '<div class="hint">' + esc(d.checkId) + ' · ' + esc(d.issue) + ' —— 已投 ' + Object.keys(d.votes).length + '/' + r.readers.length + '（同意 ' + agree + '）</div>';
  }).join('') + '</div>' : '';
  return '<h2 class="sec"><span class="no">④</span>内测控制台 <small>第 ' + r.round + ' 轮 · 窗口 ' + r.hours + 'h · ' + (left != null ? '剩余 ' + Math.max(0, left) + 'h' : '') + '</small></h2>' +
    '<div class="card beta-card"><div class="rowline">' + readerBadges + '</div>' + doubts +
    '<h3>📡 实时反馈流（' + r.feedbacks.length + ' 条）</h3><div class="bstream">' + stream + '</div>' +
    '<div class="rowline"><a href="#beta/' + w.id + '"><button>👁 以首读者身份进预读页</button></a>' +
    '<button class="pri" onclick="act(\'closeBeta\',{wid:\'' + w.id + '\'},\'窗口已关闭：热力 + 共识 + 存疑众裁聚合完成（未反馈者质量分 −2）\')">关闭窗口 · 聚合报告 →</button>' +
    '<span class="hint">提前关窗也可以 —— 聚合按已反馈数据计算</span></div></div>';
}

function renderBetaReport(w, r, readonly) {
  var rep = r.report;
  var heatRow = w.paragraphs.map(function (p) {
    var n = rep.heat[p.id] || 0;
    return '<div class="heatcell' + (n ? ' hot' : '') + '">' + esc(p.id) + '<b>' + n + '</b></div>';
  }).join('');
  var items = rep.items.map(function (i) {
    var acts;
    if (i.action) {
      acts = '<span class="badge ' + (i.action === 'reject' ? 'b-blocked' : i.action === 'gold' ? 'b-gold' : 'b-ok') + '">' + { accept: '已采纳（+3）', gold: '💎 极有价值（+5）', reject: '已驳回' }[i.action] + '</span>' + (i.reason ? ' <span class="hint">' + esc(i.reason) + '</span>' : '');
    } else if (!readonly) {
      acts = '<button class="sm pri" onclick="act(\'handleBetaItem\',{wid:\'' + w.id + '\',itemId:\'' + i.id + '\',action:\'accept\'},\'已采纳 → 进入修改回环（revising），反馈人质量分 +3\')">采纳（+3）</button> ' +
        '<button class="sm" onclick="act(\'handleBetaItem\',{wid:\'' + w.id + '\',itemId:\'' + i.id + '\',action:\'gold\'},\'已标极有价值 → 进入修改回环，反馈人质量分 +5\')">💎 极有价值（+5）</button> ' +
        '<button class="sm" onclick="rejectBetaItem(\'' + w.id + '\',\'' + i.id + '\')">驳回（附理由）</button>';
    } else acts = '<span class="hint">报告只读</span>';
    return '<div class="bi">' + (i.strong ? '<span class="badge b-strong">⚡ 强信号 · ≥60% 共识</span>' : '') + '<span class="badge b-beta">' + esc(i.type) + '</span> ' +
      '<b>' + esc(i.pid) + '</b> <span class="hint">' + i.count + '/' + rep.total + ' 人：' + i.readers.map(function (n) { return '@' + esc(n); }).join('、') + '</span>' +
      (i.notes.length ? '<div class="hint">' + i.notes.map(esc).join('<br>') + '</div>' : '') +
      '<div class="rowline">' + acts + '</div></div>';
  }).join('');
  var doubts = rep.doubts && rep.doubts.length ? '<div class="bsub"><b>存疑众裁结果</b>' + rep.doubts.map(function (d) {
    return '<div class="hint">' + esc(d.checkId) + '「' + esc(d.issue) + '」：同意 ' + d.agree + '/' + d.total + ' → <b>' + esc(d.verdict) + '</b></div>';
  }).join('') + '</div>' : '';
  return '<h2 class="sec"><span class="no">' + (readonly ? '⑤' : '④') + '</span>内测聚合报告 <small>第 ' + r.round + ' 轮 · ' + rep.total + ' 位首读者 · ' + r.feedbacks.length + ' 条标注</small></h2>' +
    '<div class="card beta-card"><div class="hint" style="margin-bottom:6px">段落热力（标注密度）：</div><div class="rowline">' + heatRow + '</div>' +
    '<h3>聚合项（同段同类型合并 · ≥60% 标强信号）</h3>' + (items || '<div class="hint">无聚合项。</div>') + doubts + '</div>';
}
function rejectBetaItem(wid, itemId) {
  Modal.show({
    title: '驳回这条内测反馈',
    sub: '驳回理由会写入档案并回复首读者 —— 驳回不计质量分，但连续被忽略的读者会进入沉睡提醒。',
    fields: [{ id: 'reason', label: '驳回理由', type: 'textarea', placeholder: '例：这里的数据口径已在正文注释中说明', required: true }],
    okText: '驳回并回复', danger: true,
    onConfirm: function (v) { act('handleBetaItem', { wid: wid, itemId: itemId, action: 'reject', reason: v.reason }, '已驳回，理由写入档案'); }
  });
}

/* ===== 标题工坊 ===== */
function renderTitleForge(w) {
  if (w.titleCandidates && w.titleCandidates.length) {
    var cands = w.titleCandidates.map(function (c, i) {
      return '<div class="tc"><b>「' + esc(c.title) + '」</b>' + aiTag(c.by) + '<div class="hint">依据：' + esc(c.why) + '</div><div class="rowline"><button class="pri sm" onclick="chooseTitle(\'' + w.id + '\',' + i + ')">选定此标题</button></div></div>';
    }).join('');
    return '<div class="card"><h3>🏷 标题工坊 <small>5 候选各带依据 · 选定权在你（铁律②）</small></h3>' + cands +
      '<div class="rowline"><button onclick="chooseTitleKeep(\'' + w.id + '\')">保留原题「' + esc(w.title) + '」</button><span class="hint">候选集与最终选择都会写入标题实验记录</span></div></div>';
  }
  return '<div class="card"><h3>🏷 标题工坊</h3><div class="rowline"><button class="pri" onclick="doTitleForge(\'' + w.id + '\')">' + (App.ai.on ? '✦ 让大模型生成 5 个候选标题' : '生成 5 个候选标题（规则引擎）') + '</button><span class="hint">每个候选带依据；选定写入 titleLog + 创作档案</span></div></div>';
}
function doTitleForge(wid) { actAI('titleForge', { wid: wid }, '标题候选已生成'); }
function chooseTitle(wid, idx) {
  var w = workById(wid);
  var c = w && w.titleCandidates && w.titleCandidates[idx];
  if (!c) return;
  act('chooseTitle', { wid: wid, title: c.title }, '已选定「' + c.title + '」· 候选集写入标题实验记录');
}
function chooseTitleKeep(wid) {
  var w = workById(wid);
  if (!w) return;
  act('chooseTitle', { wid: wid, title: w.title }, '保留原题，候选集写入标题实验记录');
}

/* ===== 版本对照（快照 diff + 归因） ===== */
function renderVersions(w, snaps) {
  var tabs = snaps.map(function (s) {
    return '<button class="dtab' + (App.diffSnap === s.id ? ' on' : '') + '" onclick="App.diffSnap=App.diffSnap===\'' + s.id + '\'?null:\'' + s.id + '\';render()">' + esc(s.label) + ' · ' + esc(s.id) + '</button>';
  }).join('');
  var diffHtml = '';
  var cur = snaps.find(function (s) { return s.id === App.diffSnap; });
  if (cur) {
    var oldMap = {}; cur.paragraphs.forEach(function (p) { oldMap[p.id] = p; });
    var seen = {};
    var rows = w.paragraphs.map(function (p) {
      seen[p.id] = 1;
      var old = oldMap[p.id];
      if (!old) return '<div class="dp add"><span class="dtag">新增</span><b>' + esc(p.id) + '</b><div class="new">' + esc(p.text) + '</div></div>';
      if (old.text === p.text) return '';
      var attr = w.revisions.filter(function (r) { return (r.note || '').indexOf(p.id) >= 0; }).map(function (r) {
        var src = r.betaItem ? '内测标注 ' + r.betaItem : r.checkId ? '自检 ' + r.checkId : r.bugId ? '捉虫 ' + r.bugId : '修订';
        return '<span class="badge b-rule">' + esc(src) + '</span>';
      }).join(' ');
      return '<div class="dp mod"><span class="dtag">修改</span><b>' + esc(p.id) + '</b> ' + attr + '<div class="old">' + esc(old.text) + '</div><div class="new">' + esc(p.text) + '</div></div>';
    });
    var dels = cur.paragraphs.filter(function (p) { return !seen[p.id]; }).map(function (p) {
      return '<div class="dp del"><span class="dtag">删除</span><b>' + esc(p.id) + '</b><div class="old">' + esc(p.text) + '</div></div>';
    });
    var changed = rows.filter(Boolean).concat(dels);
    diffHtml = '<div class="diffbox"><div class="hint">快照「' + esc(cur.label) + '」（' + esc(cur.ts) + '） vs 当前正文：</div>' +
      (changed.length ? changed.join('') : '<div class="hint">两处完全一致。</div>') + '</div>';
  }
  return '<h2 class="sec"><span class="no">⑥</span>版本对照 <small>自检前后 / 内测前后 自动快照 · 逐段 diff + 归因</small></h2>' +
    '<div class="card"><div class="dtabs">' + tabs + '</div>' + diffHtml + '</div>';
}

/* ===== 编辑动作 ===== */
function renameTitle(wid) {
  var w = workById(wid);
  Modal.show({
    title: '重命名作品',
    fields: [{ id: 'title', label: '新标题', value: w.title, required: true }],
    okText: '保存', onConfirm: function (v) { act('renameWork', { wid: wid, title: v.title }, '已重命名'); }
  });
}
function startEdit(wid, pid) { App.editing = pid; render(); }
function cancelEdit() { App.editing = null; render(); }
function savePara(wid, pid) {
  var el = document.getElementById('pe-' + pid);
  act('updateParagraph', { wid: wid, pid: pid, text: el.value }, '段落已保存（URL 自动登记引用源）');
  App.editing = null;
}
function delPara(wid, pid) {
  Modal.show({ title: '删除段落 ' + pid + '？', sub: '删除会留在版本快照与编排日志中，可随时回查。', okText: '删除', danger: true, onConfirm: function () { act('deleteParagraph', { wid: wid, pid: pid }, '段落已删除'); } });
}
function addPara(wid) {
  var el = document.getElementById('np-text');
  var t = el ? el.value.trim() : '';
  if (!t) return toast('先写一段正文', true);
  act('addParagraph', { wid: wid, text: t, kind: 'user' }, '已写入正文');
}
function aiDraft(wid) { actAI('draftSection', { wid: wid }, 'AI 草段已插入（带色标，须过目转正）'); }
function doSelfCheck(wid) { actAI('selfCheck', { wid: wid }, '自检完成：逐段扫描，锚点无法命中的意见已整条丢弃'); }
function citeTo(wid, pid, assetRef) { act('citeAsset', { wid: wid, pid: pid, assetRef: assetRef }, '已引用 → 锚点登记，署名区同步'); }
function rejectCheck(wid, cid) {
  Modal.show({
    title: '驳回这条自检意见',
    sub: '驳回理由写回规则库作负样本 —— 同类误报以后降权（复利机制）。',
    fields: [{ id: 'reason', label: '驳回理由', type: 'textarea', placeholder: '例：亲历叙事类文章，单一案例可作引子', required: true }],
    okText: '驳回并写回', danger: true,
    onConfirm: function (v) { act('handleCheck', { wid: wid, cid: cid, action: 'reject', reason: v.reason }, '已驳回，理由写回规则库作负样本'); }
  });
}
function shelveW(wid) {
  Modal.show({
    title: '搁置这篇作品',
    sub: '写入未完成选题库（含理由）—— 是候选区不是垃圾箱，新报料命中伏笔时可复活。',
    fields: [{ id: 'reason', label: '搁置理由', type: 'textarea', placeholder: '例：素材不足，等第二个亲历者', required: true }],
    okText: '搁置', danger: true,
    onConfirm: function (v) { act('shelve', { wid: wid, reason: v.reason }, '已搁置 → 未完成选题库'); }
  });
}

/* ===== 小铺（橱窗 / 报料 / 追更 / 首读者申请） ===== */
function renderShop() {
  var s = App.state;
  var published = s.works.filter(function (w) { return ['published', 'retro', 'archived'].indexOf(w.status) >= 0; });
  var windowWorks = s.works.filter(function (w) { return ['idea', 'drafting', 'self_check', 'beta', 'revising'].indexOf(w.status) >= 0 && w.windowPublic !== false; });
  var pool = s.betaPool.filter(function (r) { return !r.removed; });

  var ww = windowWorks.map(function (w) {
    var r = roundOf(w.id);
    var stage = SL[w.status] + (w.status === 'beta' && r && r.status === 'open' ? ' · 首读者反馈中（剩 ' + Math.max(0, hoursLeft(r.openedAt, r.hours) || 0) + 'h）' : '');
    var betaBtn = (w.status === 'beta' && r && r.status === 'open') ? '<a href="#beta/' + w.id + '"><button class="pri sm">📖 进预读页（首读者）</button></a>' : '';
    return '<div class="wwork"><b class="serif">《' + esc(w.title) + '》</b> ' + badge(w.status) +
      '<div class="hint">选题方向：' + (w.tags.length ? w.tags.map(esc).join(' · ') : '未定') + ' ｜ 当前阶段：' + stage + '</div>' +
      '<div class="hint">『' + esc((w.topicOrigin && w.topicOrigin.rationale || '').slice(0, 60)) + '』</div>' +
      '<div class="rowline"><button class="sm" onclick="followW(\'' + w.id + '\')">🔔 追更</button><button class="sm" onclick="wantSignal(\'' + w.id + '\')">💡 投一票想看</button><button class="sm" onclick="tipFor(\'' + esc(w.title) + '\')">📮 针对性报料</button>' + betaBtn + '</div></div>';
  }).join('') || '<div class="hint">当前没有在制公示的作品（公示范围由创作者逐篇控制）。</div>';

  var works = published.map(function (w) {
    return '<div class="wk2"><a href="#read/' + w.id + '"><b class="serif">《' + esc(w.title) + '》</b></a> ' + badge(w.status) +
      '<div class="hint">' + (w.credits && w.credits.length ? '署名：' + w.credits.map(function (c) { return esc(c.name); }).join('、') : '无素材引用') + ' · ' + esc(w.publishedAt || '') + '</div></div>';
  }).join('') || '<div class="hint">还没有已发布作品。</div>';

  var wall = {};
  s.materialCards.filter(function (m) { return m.status === 'used'; }).forEach(function (m) { wall[m.provider] = (wall[m.provider] || 0) + 1; });
  var wallHtml = Object.keys(wall).map(function (n) { return readerLink(n) + ' <span class="hint">素材被采用 ' + wall[n] + ' 次</span>'; }).join('<br>') || '<div class="hint">暂无。</div>';

  var poolHtml = pool.map(function (r) {
    var sc = (s.readerScores[r.name] && s.readerScores[r.name].score) || 0;
    return readerLink(r.name) + ' <span class="hint">' + (r.tags || []).map(esc).join('/') + ' · 质量分 ' + sc + '</span>';
  }).join('<br>');

  return '<div class="pagehead"><div class="kicker">SHOP · ' + esc(s.creator.shopName) + '</div><h1 class="serif">' + esc(s.creator.bio) + '</h1>' +
    '<div class="sub">读者报料 → 署名引用 → 首读者内测 → 贡献可见。每一次参与都被记录。</div></div>' +
    '<div class="stats"><div class="stat"><b>' + published.length + '</b><span>已发布</span></div>' +
    '<div class="stat"><b>' + s.materialCards.length + '</b><span>报料入库（采用 ' + s.materialCards.filter(function (m) { return m.status === 'used'; }).length + '）</span></div>' +
    '<div class="stat"><b>' + s.checkRuleBank.length + '</b><span>自检规则库</span></div>' +
    '<div class="stat"><b>' + pool.length + '</b><span>首读者资格池</span></div></div>' +
    '<h2 class="sec"><span class="no">①</span>工坊橱窗 <small>在制公示 · 可追更 / 投票 / 针对性报料</small></h2><div class="card">' + ww + '</div>' +
    '<h2 class="sec"><span class="no">②</span>已发布作品</h2><div class="card">' + works + '</div>' +
    '<div class="grid cols2">' +
    '<div class="card"><h3>📮 我要报料 <small>结构化萃取 ' + aiTag('rules') + '</small></h3>' +
    '<label class="f">你的称呼</label><input id="tip-reader" placeholder="例：小鹿">' +
    '<label class="f">你的故事 / 见闻（口语即可）</label><textarea id="tip-content" placeholder="例：我去年从大厂转行做手艺人，收入降了四成，但每一块钱都看得见来路。"></textarea>' +
    '<label class="f">授权范围</label><select id="tip-scope"><option>具名引用</option><option>匿名引用</option><option>仅背景参考</option></select>' +
    '<div class="rowline"><button class="pri" onclick="submitTip()">提交报料</button><span class="hint">可随时撤回授权；追问可答可不答</span></div></div>' +
    '<div class="card"><h3>🧪 首读者资格池（' + pool.length + ' 人）</h3>' + poolHtml +
    '<div class="rowline" style="margin-top:8px"><button onclick="applyBetaModal()">申请成为首读者</button><span class="hint">内测开放时按主题匹配 + 质量分推荐</span></div>' +
    '<h3 style="margin-top:12px">🧱 贡献者墙</h3>' + wallHtml + '</div></div>';
}
function submitTip() {
  var reader = document.getElementById('tip-reader').value.trim();
  var content = document.getElementById('tip-content').value.trim();
  var scope = document.getElementById('tip-scope').value;
  if (!reader || !content) return toast('称呼和内容都要填', true);
  actAI('extractTip', { reader: reader, content: content, scope: scope }, '报料已入库（结构化萃取完成）');
}
function followW(wid) {
  Modal.show({
    title: '追更这篇在制作品',
    sub: '发布时你会收到通知「你追的选题发布了」。',
    fields: [{ id: 'name', label: '你的称呼', required: true }],
    okText: '追更', onConfirm: function (v) { act('followWork', { reader: v.name, wid: wid }, '已追更 · 发布时通知你'); }
  });
}
function wantSignal(wid) {
  var w = workById(wid);
  Modal.show({
    title: '投一票「想看」',
    sub: '你的投票会入库为需求信号（T2 新来源），影响这篇与同主题选题的优先级。',
    fields: [
      { id: 'name', label: '你的称呼', required: true },
      { id: 'text', label: '想看点什么（可选）', type: 'textarea', placeholder: '例：想看具体一单的拆账' }
    ],
    okText: '投票入库', onConfirm: function (v) { act('addSignal', { from: v.name, text: (v.text || '想看这篇'), tags: w.tags }, '已入库为需求信号'); }
  });
}
function tipFor(title) {
  var el = document.getElementById('tip-content');
  if (el) { el.value = '关于《' + title + '》，我补充一个亲历细节：'; el.focus(); el.scrollIntoView({ behavior: 'smooth' }); }
}
function applyBetaModal() {
  Modal.show({
    title: '申请首读者资格',
    sub: '入池后，同主题作品开内测时你会被优先推荐。连续 2 次窗口内不反馈会移出池（可重新申请）。',
    fields: [
      { id: 'name', label: '你的称呼', required: true },
      { id: 'tags', label: '感兴趣的主题（逗号分隔）', placeholder: '例：转行,手艺,收入' }
    ],
    okText: '申请入池', onConfirm: function (v) {
      var tags = v.tags.split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean);
      act('applyBeta', { reader: v.name, tags: tags }, '已入首读者资格池');
    }
  });
}

/* ===== 阅读页（参考来源区 + 诞生档案完整版） ===== */
function renderRead(w) {
  if (!w) return '<div class="card">作品不存在。<a href="#shop">返回小铺</a></div>';
  if (['published', 'retro', 'archived'].indexOf(w.status) < 0) return '<div class="card">《' + esc(w.title) + '》尚未发布（当前：' + SL[w.status] + '）。<a href="#workbench">返回工作台</a></div>';
  var s = App.state;
  var r = roundOf(w.id);
  var paras = w.paragraphs.map(function (p) {
    return '<p class="rp">' + esc(p.text) + (p.citations.length ? '<span class="cite-line">引用：' + p.citations.map(function (c) { return esc(c.asset); }).join('、') + '</span>' : '') + '</p>';
  }).join('');
  var cites = (s.citationBank || []).filter(function (c) { return c.usedBy.indexOf(w.id) >= 0; });
  var citeHtml = cites.length ? cites.map(function (c) {
    return '<div class="asset' + (c.fresh === 'stale' ? ' dim' : '') + '"><b>' + esc(c.id) + '</b> <span class="hint">' + esc(c.url) + '</span>' +
      (c.fresh === 'stale' ? '<div><span class="badge b-blocked">已知过时（捉虫 ' + esc(c.staleBy || '') + '）</span></div>' : '<div><span class="badge b-ok">有效</span></div>') + '</div>';
  }).join('') : '<div class="hint">本篇无外部引用源登记。</div>';
  var betaReaders = r ? r.readers.map(readerLink).join('、') : null;
  var betaStat = r && r.report ? '内测第 ' + r.round + ' 轮 · ' + r.report.total + ' 位首读者 · ' + r.feedbacks.length + ' 条标注 · 采纳 ' + r.report.items.filter(function (i) { return i.action === 'accept' || i.action === 'gold'; }).length + ' 项（含强信号 ' + r.report.items.filter(function (i) { return i.strong; }).length + ' 条）' : '本篇未经内测' + (w.skipped.indexOf('beta') >= 0 ? '（skipped_stages 记录在档）' : '');
  var revRows = (w.revisions || []).map(function (rv) {
    var src = rv.betaItem ? '内测标注' : rv.checkId ? '自检采纳' : rv.bugId ? '读者捉虫' : '修订';
    return '<div class="asset"><span class="badge b-rule">' + esc(src) + '</span> ' + esc(rv.note) + (rv.by ? ' <span class="hint">—— ' + esc(rv.by) + '</span>' : '') + '</div>';
  }).join('') || '<div class="hint">无修订记录。</div>';
  var evi = (w.topicOrigin && w.topicOrigin.evidenceRefs || []).map(function (e) { return '<span class="badge b-md">' + esc(e) + '</span>'; }).join(' ');

  return '<div class="read-page"><div class="read-doc">' +
    '<div class="crumb"><a href="#shop">← 返回小铺</a></div>' +
    '<h1 class="serif">' + esc(w.title) + '</h1>' +
    '<div class="hint">' + esc(s.creator.name) + ' · ' + esc(w.publishedAt || '') + '</div>' +
    paras +
    '<div class="card"><h3>✍️ 署名区（引用锚点核验 ✓）</h3>' + (w.credits.length ? w.credits.map(function (c) { return '<div class="asset">' + readerLink(c.name.slice(1)) + ' <span class="hint">' + esc(c.scope) + ' · 引用 ' + c.count + ' 处</span></div>'; }).join('') : '<div class="hint">本篇未引用读者素材。</div>') + '</div>' +
    '<div class="card"><h3>🔗 参考来源 <small>引用管家自动登记 · 时效状态实时同步</small></h3>' + citeHtml + '</div>' +
    '<div class="card"><h3>📖 诞生档案 <small>铁律③：一切留痕一切沉淀</small></h3>' +
      '<b>选题源起</b><div class="hint">' + esc((w.topicOrigin && w.topicOrigin.rationale) || '') + '</div><div class="rowline">' + (evi || '<span class="hint">手动建题，无资产引用</span>') + '</div>' +
      '<b>参与者</b><div class="hint">署名：' + (w.credits.length ? w.credits.map(function (c) { return esc(c.name); }).join('、') : '无') + (betaReaders ? ' ｜ 首读者：' + betaReaders : '') + '</div>' +
      '<b>装配</b><div class="hint">' + (w.bundle || []).map(function (b) { return esc(b.type) + '(' + esc(b.ref) + ')'; }).join('、') + '</div>' +
      '<b>质量机制</b><div class="hint">自检 ' + w.checks.length + ' 条（采纳 ' + w.checks.filter(function (c) { return c.action === 'accept'; }).length + ' / 驳回 ' + w.checks.filter(function (c) { return c.action === 'reject'; }).length + '）· ' + betaStat + '</div>' +
      '<b>修订记录（逐条归因）</b>' + revRows +
      '<b>创作方式声明</b> <span class="badge b-rule">系统生成 · 不可删</span><div class="hint">' + esc(w.declaration || '') + '</div>' +
    '</div>' +
    (w.status === 'published' ? '<div class="card"><h3>🐛 捉虫（附证据）</h3>' +
      '<label class="f">你的称呼</label><input id="bug-reader" placeholder="例：青梧">' +
      '<label class="f">原文引用</label><input id="bug-quote" placeholder="粘贴有问题的原文">' +
      '<label class="f">问题类型</label><select id="bug-type"><option>数据待核</option><option>数据过时</option><option>事实错误</option><option>表述歧义</option></select>' +
      '<label class="f">你的证据</label><textarea id="bug-evidence" placeholder="例：按统计局 2025 年鉴口径，应为约 38%"></textarea>' +
      '<div class="rowline"><button class="pri" onclick="submitBugF(\'' + w.id + '\')">提交捉虫</button><span class="hint">确认 → 修订痕迹 + 贡献者墙 + 规则库复利</span></div></div>' : '') +
    '</div></div>';
}
function submitBugF(wid) {
  var reader = document.getElementById('bug-reader').value.trim();
  var quote = document.getElementById('bug-quote').value.trim();
  var type = document.getElementById('bug-type').value;
  var evidence = document.getElementById('bug-evidence').value.trim();
  if (!reader || !quote || !evidence) return toast('称呼、原文引用与证据都要填', true);
  act('submitBug', { reader: reader, wid: wid, quote: quote, type: type, evidence: evidence }, '捉虫已提交，等待创作者裁决');
}

/* ===== 预读页（首读者身份 · 五类标注 · 盲水印） ===== */
function renderBeta(w) {
  if (!w) return '<div class="card">作品不存在。<a href="#shop">返回小铺</a></div>';
  var r = roundOf(w.id);
  if (w.status !== 'beta' || !r || r.status !== 'open')
    return '<div class="card"><h3>📖 预读页</h3><div class="hint">《' + esc(w.title) + '》当前没有开放的内测窗口' + (r && r.status === 'closed' ? '（上一轮已关闭，聚合报告见作品详情）' : '') + '。</div><a href="#workbench"><button>返回工作台</button></a></div>';
  if (!App.betaAs || r.readers.indexOf(App.betaAs) < 0) App.betaAs = r.readers[0];
  var left = hoursLeft(r.openedAt, r.hours);
  var idSel = r.readers.map(function (n) { return '<option' + (n === App.betaAs ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('');
  var paras = w.paragraphs.map(function (p) {
    var mine = r.feedbacks.filter(function (f) { return f.reader === App.betaAs && f.pid === p.id; }).map(function (f) {
      return '<span class="badge b-beta">' + esc(f.type) + '</span>';
    }).join(' ');
    var btns = ZaowuEngine.BETA_TYPES.filter(function (t) { return t !== '存疑投票'; }).map(function (t) {
      return '<button class="sm ghost" onclick="betaMark(\'' + w.id + '\',\'' + p.id + '\',\'' + t + '\')">' + esc(t) + '</button>';
    }).join('');
    return '<div class="bpara"><p>' + esc(p.text) + '</p><div class="rowline"><span class="hint">' + esc(p.id) + '</span> ' + btns + mine + '</div></div>';
  }).join('');
  var doubts = r.doubts.length ? '<div class="card"><h3>⚖️ 存疑众裁（自检存疑项交首读者投票）</h3>' + r.doubts.map(function (d) {
    var my = d.votes[App.betaAs];
    var agree = Object.keys(d.votes).filter(function (n) { return d.votes[n] === 'agree'; }).length;
    return '<div class="bi"><b>' + esc(d.checkId) + '</b>：' + esc(d.issue) + ' <span class="hint">（当前 同意 ' + agree + '/' + Object.keys(d.votes).length + ' 票）</span>' +
      (my ? '<span class="badge b-ok">你已投：' + (my === 'agree' ? '同意意见' : '不同意') + '</span>'
        : '<div class="rowline"><button class="sm pri" onclick="act(\'voteDoubt\',{reader:\'' + esc(App.betaAs) + '\',wid:\'' + w.id + '\',checkId:\'' + d.checkId + '\',vote:\'agree\'},\'已投：同意意见\')">同意意见</button><button class="sm" onclick="act(\'voteDoubt\',{reader:\'' + esc(App.betaAs) + '\',wid:\'' + w.id + '\',checkId:\'' + d.checkId + '\',vote:\'disagree\'},\'已投：不同意\')">不同意</button></div>') + '</div>';
  }).join('') + '</div>' : '';
  return '<div class="read-page beta-read"><div class="watermark">预读稿 · 仅限 @' + esc(App.betaAs) + ' · 请勿外传</div><div class="read-doc">' +
    '<div class="crumb"><a href="#shop">← 返回小铺</a><span class="hint">｜ 内测第 ' + r.round + ' 轮 · 窗口剩 ' + Math.max(0, left || 0) + 'h</span></div>' +
    '<h1 class="serif">' + esc(w.title) + ' <span class="badge b-beta">预读稿</span></h1>' +
    '<div class="rowline"><label class="f" style="margin:0">以谁的身份阅读：</label><select onchange="App.betaAs=this.value;render()">' + idSel + '</select>' +
    '<span class="hint">五类标注：读不下去 / 不相信（须附理由）/ 想要更多 / 存疑投票 / 自由批注 —— 关窗时按质量计分校准</span></div>' +
    paras + doubts + '</div></div>';
}
function betaMark(wid, pid, type) {
  var needNote = type === '不相信' || type === '自由批注';
  Modal.show({
    title: '对 ' + pid + ' 标注「' + type + '」',
    fields: needNote ? [{ id: 'note', label: type === '不相信' ? '不相信的理由（必填）' : '你的批注', type: 'textarea', required: type === '不相信' }] : [],
    okText: '提交标注',
    onConfirm: function (v) { act('submitBetaFeedback', { reader: App.betaAs, wid: wid, pid: pid, type: type, note: (v && v.note) || '' }, '标注已记录（关窗聚合时计入）'); }
  });
}

/* ===== 读者个人贡献页 + 分享卡 ===== */
function renderReader(name) {
  var v;
  try { v = ro().readerView(name); } catch (e) { return '<div class="card">读者不存在。</div>'; }
  var tips = v.tips.map(function (m) {
    return '<div class="asset"><b>' + esc(m.id) + '</b> ' + (m.status === 'used' ? '<span class="badge b-ok">已被采用</span>' : '<span class="badge b-md">等待匹配</span>') +
      (m.extractedBy === 'llm' ? aiTag('llm') : '') + '<div class="hint">' + esc(m.content.slice(0, 50)) + '</div>' +
      '<div class="rowline"><button class="sm ghost" onclick="act(\'revokeMaterial\',{cardId:\'' + m.id + '\'},\'授权已撤回 · 引擎停止装配\')">撤回授权</button><span class="hint">授权：' + esc(m.license.scope) + '</span></div></div>';
  }).join('') || '<div class="hint">还没有报料。</div>';
  var betas = v.betas.map(function (b) {
    return '<div class="asset"><a href="#read/' + b.wid + '"><b>《' + esc(b.title) + '》</b></a> <span class="hint">第 ' + b.round + ' 轮 · 标注 ' + b.marks + ' 条 · 被采纳 ' + b.adopted + ' 项</span></div>';
  }).join('') || '<div class="hint">还没有首读记录。</div>';
  var bugs = v.bugs.map(function (b) {
    return '<div class="asset"><b>' + esc(b.id) + '</b> ' + (b.verdict === 'confirmed' ? '<span class="badge b-ok">已确认 → 上贡献者墙</span>' : b.status === 'open' ? '<span class="badge b-md">待裁决</span>' : '<span class="badge b-lo">已驳回</span>') + '<div class="hint">' + esc(b.type) + ' · 「' + esc(b.quote).slice(0, 40) + '」</div></div>';
  }).join('') || '<div class="hint">还没有捉虫。</div>';
  var credits = v.credits.map(function (c) {
    return '<div class="asset">《' + esc(c.title) + '》<span class="hint">' + esc(c.scope) + ' · 引用 ' + c.count + ' 处</span></div>';
  }).join('') || '<div class="hint">还没有署名。</div>';
  var auth = v.authRequests.map(function (r) {
    return '<div class="asset"><b>' + esc(r.id) + '</b> · 素材 ' + esc(r.cardId) + ' 申请授权' +
      '<div class="rowline"><button class="sm pri" onclick="act(\'respondAuth\',{reqId:\'' + r.id + '\',agree:true,scope:\'具名引用\'},\'已同意（具名）→ 素材解锁\')">同意（具名）</button>' +
      '<button class="sm" onclick="act(\'respondAuth\',{reqId:\'' + r.id + '\',agree:true,scope:\'匿名引用\'},\'已同意（匿名）→ 素材解锁\')">同意（匿名）</button>' +
      '<button class="sm" onclick="act(\'respondAuth\',{reqId:\'' + r.id + '\',agree:false},\'已婉拒，记录留存\')">婉拒</button></div></div>';
  }).join('');
  var hist = (v.score.history || []).map(function (x) { return '<div class="hint">' + esc(x.ts) + ' ' + (x.delta > 0 ? '+' : '') + x.delta + '（' + esc(x.why) + '）</div>'; }).join('');
  return '<div class="pagehead"><div class="kicker">READER · 个人贡献页</div><h1 class="serif">@' + esc(name) + '</h1>' +
    '<div class="sub">首读质量分 <b>' + v.score.score + '</b> · ' + (v.inPool ? '<span class="badge b-ok">在首读者资格池</span>' : '<span class="badge b-md">不在资格池</span>') + ' · 未反馈 ' + v.score.miss + ' 次</div></div>' +
    (auth ? '<div class="card"><h3>⏳ 待你响应的授权请求</h3>' + auth + '</div>' : '') +
    '<div class="grid cols2">' +
    '<div class="card"><h3>📮 我的报料（' + v.tips.length + '）</h3>' + tips + '</div>' +
    '<div class="card"><h3>🧪 我的首读（' + v.betas.length + '）</h3>' + betas + '</div>' +
    '<div class="card"><h3>🐛 我的捉虫（' + v.bugs.length + '）</h3>' + bugs + '</div>' +
    '<div class="card"><h3>✍️ 署名合集（' + v.credits.length + '）</h3>' + credits +
      (v.credits.length ? '<div class="rowline"><button class="pri" onclick="shareCard(\'' + esc(name) + '\')">🖼 生成分享卡</button><span class="hint">「我的故事被写进了《…》」</span></div>' : '') +
      '<h3 style="margin-top:10px">质量分明细</h3>' + hist + '</div></div>';
}
function shareCard(name) {
  var v = ro().readerView(name);
  var cv = document.createElement('canvas');
  cv.width = 640; cv.height = 800;
  var ctx = cv.getContext('2d');
  ctx.fillStyle = '#26221B'; ctx.fillRect(0, 0, 640, 800);
  ctx.fillStyle = '#F5F0E6'; ctx.fillRect(24, 24, 592, 752);
  ctx.fillStyle = '#B4512A'; ctx.fillRect(24, 24, 592, 10);
  ctx.fillStyle = '#26221B';
  ctx.font = '900 44px "Noto Serif SC", serif';
  ctx.fillText('@' + name, 56, 120);
  ctx.font = '500 22px "Noto Sans SC", sans-serif';
  ctx.fillStyle = '#B4512A';
  var first = v.credits[0];
  ctx.fillText('我的故事被写进了', 56, 180);
  ctx.fillStyle = '#26221B';
  ctx.font = '900 30px "Noto Serif SC", serif';
  ctx.fillText('《' + (first ? first.title : (v.betas[0] ? v.betas[0].title : '老周的小铺')) + '》', 56, 226);
  ctx.font = '400 20px "Noto Sans SC", sans-serif';
  ctx.fillStyle = '#5B5346';
  var rows = [
    '报料 ' + v.tips.length + ' 条（被采用 ' + v.tips.filter(function (m) { return m.status === 'used'; }).length + '）',
    '首读 ' + v.betas.length + ' 轮 · 标注被采纳 ' + v.betas.reduce(function (a, b) { return a + b.adopted; }, 0) + ' 项',
    '捉虫 ' + v.bugs.length + ' 条（确认 ' + v.bugs.filter(function (b) { return b.verdict === 'confirmed'; }).length + '）',
    '署名引用 ' + v.credits.reduce(function (a, c) { return a + c.count; }, 0) + ' 处'
  ];
  rows.forEach(function (t, i) { ctx.fillText('· ' + t, 56, 300 + i * 44); });
  ctx.fillStyle = '#B4512A';
  ctx.font = '700 24px "Noto Sans SC", sans-serif';
  ctx.fillText('首读质量分 ' + v.score.score, 56, 520);
  ctx.fillStyle = '#8A8072';
  ctx.font = '400 16px "Noto Sans SC", sans-serif';
  ctx.fillText('造物 · Atelier ｜ 每一次参与都被记录', 56, 700);
  ctx.fillText('三铁律：无引用不调用 · AI 有提议权没有决定权 · 一切留痕一切沉淀', 56, 730);
  var url = cv.toDataURL('image/png');
  Modal.html('分享卡 · @' + name, '<div style="text-align:center"><img src="' + url + '" style="max-width:320px;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.25)"></div>' +
    '<div class="mfoot" style="justify-content:center"><a download="zaowu-card-' + encodeURIComponent(name) + '.png" href="' + url + '"><button class="pri">下载 PNG</button></a></div>');
}

/* ===== 读者关系台 ===== */
function waitHours(ts) {
  var t = new Date(String(ts).replace(' ', 'T')).getTime();
  if (isNaN(t)) return null;
  return Math.round((Date.now() - t) / 3600e3);
}
function renderRelations() {
  var rel = ro().relations();
  var rows = rel.readers.map(function (r) {
    var scCls = r.score > 0 ? 'b-ok' : r.score < 0 ? 'b-blocked' : 'b-md';
    return '<tr><td>' + readerLink(r.name) + (r.inPool ? ' <span class="badge b-beta">资格池</span>' : '') + '</td><td>' + r.tips + '</td><td>' + r.tipsUsed + '</td><td>' + r.betas + '</td><td>' + r.adopted + '</td><td>' + r.bugs + '</td><td>' + r.bugsConfirmed + '</td><td><span class="badge ' + scCls + '">' + (r.score > 0 ? '+' : '') + r.score + '</span></td></tr>';
  }).join('');
  var queue = rel.queue.map(function (q) {
    var h = waitHours(q.ts);
    var over = h != null && h >= 72;
    return '<div class="asset' + (over ? ' overdue' : '') + '"><b>' + esc(q.kind) + '</b> · ' + readerLink(q.who) + ' · ' + esc(q.what) +
      (h != null ? '<span class="hint"> 已等待 ' + h + 'h</span>' : '') + (over ? '<span class="badge b-blocked">超 72h · 优先回应</span>' : '') + '</div>';
  }).join('') || '<div class="hint">待回应队列清爽。</div>';
  var invite = rel.invite.map(function (r) {
    return '<div class="asset">' + readerLink(r.name) + '<div class="hint">' + esc(r.why) + '</div><div class="rowline"><button class="sm pri" onclick="inviteBeta(\'' + esc(r.name) + '\')">邀请入池</button></div></div>';
  }).join('') || '<div class="hint">暂无新的邀请建议。</div>';
  var sleeping = rel.sleeping.map(function (r) {
    return '<div class="asset">' + readerLink(r.name) + ' <span class="hint">连续 ' + r.miss + ' 次窗口未反馈 —— 建议先私下问一句，再决定是否移出池</span></div>';
  }).join('') || '<div class="hint">没有沉睡读者。</div>';
  return '<div class="pagehead"><div class="kicker">RELATIONS · 读者关系台</div><h1 class="serif">贡献总账与回应纪律</h1>' +
    '<div class="sub">按读者聚合贡献与质量分 · 待回应超 72h 高亮 · 邀请建议带证据引用。</div></div>' +
    '<div class="card"><h3>📒 贡献总账</h3><table class="mtx"><thead><tr><th>读者</th><th>报料</th><th>被采用</th><th>首读</th><th>被采纳</th><th>捉虫</th><th>确认</th><th>质量分</th></tr></thead><tbody>' + (rows || '<tr><td colspan="8" class="hint">暂无读者数据</td></tr>') + '</tbody></table></div>' +
    '<div class="grid cols2">' +
    '<div class="card"><h3>⏳ 待回应队列</h3>' + queue + '</div>' +
    '<div class="card"><h3>💌 首读者邀请建议（带证据）</h3>' + invite + '<h3 style="margin-top:12px">😴 沉睡提醒</h3>' + sleeping + '</div></div>';
}
function inviteBeta(name) {
  Modal.show({
    title: '邀请 @' + name + ' 入首读者资格池',
    fields: [{ id: 'tags', label: '建议主题标签（逗号分隔）', placeholder: '例：转行,收入' }],
    okText: '邀请入池', onConfirm: function (v) {
      var tags = v.tags.split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean);
      act('applyBeta', { reader: name, tags: tags }, '@' + name + ' 已入资格池');
    }
  });
}

/* ===== 资产库 ===== */
function renderVault() {
  var s = App.state;
  function list(arr, fn, empty) { return arr.length ? arr.map(fn).join('') : '<div class="hint">' + (empty || '暂无。') + '</div>'; }
  var mc = list(s.materialCards, function (m) {
    return '<div class="asset' + (m.license.status === 'active' ? '' : ' dim') + '"><b>' + esc(m.id) + '</b> ' + readerLink(m.provider) +
      (m.status === 'used' ? '<span class="badge b-ok">已采用</span>' : '') +
      (m.license.status === 'active' ? '<span class="badge b-lo">' + esc(m.license.scope) + '</span>' : '<span class="badge b-blocked">授权 ' + esc(m.license.status) + '</span>') +
      (m.extractedBy === 'llm' ? aiTag('llm') : '') + '<div class="hint">' + esc(m.content.slice(0, 50)) + '</div></div>';
  });
  var cb = list(s.citationBank, function (c) {
    return '<div class="asset' + (c.fresh === 'stale' ? ' dim' : '') + '"><b>' + esc(c.id) + '</b> <span class="hint">' + esc(c.url.slice(0, 46)) + '…</span>' +
      (c.fresh === 'stale' ? '<span class="badge b-blocked">已知过时</span>' : '<span class="badge b-ok">有效</span>') +
      '<div class="hint">被引用：' + (c.usedBy.length ? c.usedBy.join('、') : '暂无') + '</div></div>';
  });
  var tl = list(s.titleLog, function (t) {
    var w = s.works.find(function (x) { return x.id === t.wid; });
    return '<div class="asset"><b>' + esc(t.id) + '</b> →「' + esc(t.chosen) + '」<div class="hint">候选 ' + t.candidates.length + ' 个 · 《' + esc(w ? w.title : t.wid) + '》· ' + esc(t.ts) + '</div></div>';
  });
  var vs = list(s.versionSnapshots, function (v) {
    return '<div class="asset"><b>' + esc(v.id) + '</b> ' + esc(v.label) + ' <span class="hint">' + esc(v.wid) + ' · ' + v.paragraphs.length + ' 段 · ' + esc(v.ts) + '</span></div>';
  });
  var pool = list(s.betaPool, function (r) {
    var sc = (s.readerScores[r.name] && s.readerScores[r.name].score) || 0;
    return '<div class="asset' + (r.removed ? ' dim' : '') + '">' + readerLink(r.name) + ' <span class="hint">' + (r.tags || []).map(esc).join('/') + '</span> <span class="badge ' + (sc > 0 ? 'b-ok' : sc < 0 ? 'b-blocked' : 'b-md') + '">分 ' + sc + '</span>' + (r.removed ? '<span class="badge b-blocked">已移出</span>' : '') + '</div>';
  });
  var br = list(s.betaRounds, function (r) {
    return '<div class="asset"><b>' + esc(r.id) + '</b> ' + esc(r.wid) + ' 第 ' + r.round + ' 轮 <span class="badge ' + (r.status === 'open' ? 'b-beta' : 'b-lo') + '">' + (r.status === 'open' ? '开放中' : '已关闭') + '</span> <span class="hint">' + r.feedbacks.length + ' 条标注 · ' + r.readers.length + ' 位首读者</span></div>';
  });
  var ar = list(s.authRequests, function (r) {
    return '<div class="asset"><b>' + esc(r.id) + '</b> · 素材 ' + esc(r.cardId) + ' · @' + esc(r.provider) + ' <span class="badge ' + (r.status === 'pending' ? 'b-md' : r.status === 'granted' ? 'b-ok' : 'b-lo') + '">' + { pending: '待响应', granted: '已同意', declined: '已婉拒' }[r.status] + '</span></div>';
  }, '暂无授权请求。');
  var logs = list(s.logs.slice(0, 30), function (l) {
    return '<div class="logrow' + (l.valid ? '' : ' bad') + '"><span class="hint">' + esc(l.ts) + '</span><span class="badge b-md">' + esc(l.kind) + '</span>' + esc(l.detail) + '</div>';
  });
  var rows = [
    ['素材卡', s.materialCards.length, '装配 / 引用署名 / 贡献者墙 / 全库检索'],
    ['需求信号', s.demandSignals.length, 'T1/T2 触发 / 橱窗投票入库 / 标题工坊依据'],
    ['风格档案', 1, '每次装配必装 / 换个说法约束'],
    ['自检规则库', s.checkRuleBank.length, '自检注入 / 捉虫复利 / 驳回负样本'],
    ['知识库', s.knowledgeBase.length, '装配 / 核一核查对'],
    ['引用源库', s.citationBank.length, 'C2 自检 / 阅读页参考来源 / 捉虫过时回写'],
    ['首读质量分', Object.keys(s.readerScores).length, '内测推荐排序 / 关系台总账 / 资格池进出'],
    ['版本快照', s.versionSnapshots.length, '版本对照 diff / 增量自检基线'],
    ['标题实验记录', s.titleLog.length, '标题工坊积累 / 创作档案'],
    ['内测轮次', s.betaRounds.length, '聚合报告 / 下篇需求信号 / 诞生档案']
  ];
  var mtx = rows.map(function (r) { return '<tr><td><b>' + r[0] + '</b></td><td>' + r[1] + '</td><td class="hint">' + r[2] + '</td></tr>'; }).join('');
  return '<div class="pagehead"><div class="kicker">VAULT · 资产库</div><h1 class="serif">一切留痕，一切沉淀</h1>' +
    '<div class="sub">铁律③ —— 每类资产至少两个消费方；被否决、被搁置、被驳回的同样入库。</div></div>' +
    '<div class="grid cols2">' +
    '<div><div class="card"><h3>🧱 素材卡（' + s.materialCards.length + '）</h3>' + mc + '</div>' +
    '<div class="card"><h3>🔗 引用源库（' + s.citationBank.length + '）<small>引用管家</small></h3>' + cb + '</div>' +
    '<div class="card"><h3>🏷 标题实验记录（' + s.titleLog.length + '）</h3>' + tl + '</div>' +
    '<div class="card"><h3>📸 版本快照（' + s.versionSnapshots.length + '）</h3>' + vs + '</div></div>' +
    '<div><div class="card"><h3>🧪 首读者资格池（' + s.betaPool.length + '）</h3>' + pool + '</div>' +
    '<div class="card"><h3>📮 内测轮次（' + s.betaRounds.length + '）</h3>' + br + '</div>' +
    '<div class="card"><h3>🔐 授权请求（' + s.authRequests.length + '）</h3>' + ar + '</div>' +
    '<div class="card"><h3>🪵 编排日志（最近 30 条）</h3><div class="logbox">' + logs + '</div></div></div></div>' +
    '<div class="card"><h3>♻️ 资产利用矩阵 <small>§7.2 准入：每类资产 ≥2 消费方</small></h3><table class="mtx"><thead><tr><th>资产</th><th>存量</th><th>消费方</th></tr></thead><tbody>' + mtx + '</tbody></table></div>';
}

/* ===== 启动 ===== */
Api.init().then(function (st) {
  App.state = st;
  var m = document.getElementById('mode-badge');
  if (Api.serverOk) {
    m.textContent = App.ai.on ? '后端模式 · ✦ 大模型链路（' + App.ai.model + '）' : '后端模式 · AI 规则引擎降级';
    m.className = 'mode' + (App.ai.on ? ' ai' : '');
  } else {
    m.textContent = '浏览器模式 · AI 规则引擎降级';
  }
  document.getElementById('btn-reset').onclick = function () {
    Modal.show({
      title: '恢复初始种子数据？',
      sub: '所有演示交互与新增数据将回到初始状态（编排日志一并重置）。',
      okText: '恢复', danger: true,
      onConfirm: function () { Api.call('reset', {}).then(function () { toast('已恢复初始数据'); render(); }); }
    });
  };
  window.addEventListener('hashchange', route);
  route();
}).catch(function (e) {
  document.getElementById('view').innerHTML = '<div class="card">启动失败：' + esc(e.message) + '</div>';
});
