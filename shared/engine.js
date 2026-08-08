/* ============================================================
 * 造物 · Atelier — 产品核心引擎 engine.js
 * 单一事实来源：浏览器端与 Node 后端共用同一份编排逻辑。
 * 实现 PRD §4 流水线状态机、§4.2 触发器 T1/T2、§4.3 资产装配、
 * §4.4 自检（MVP: C1/C2/C4 + 规则库注入）、§6 读者参与（报料/捉虫/撤回）、
 * §7.3 引擎四动作（Trigger/Assemble/Propose/Writeback）与 Contract 校验。
 * 三铁律：①无引用不调用 ②AI 有提议权没有决定权 ③一切留痕一切沉淀
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZaowuEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STATES = ['idea', 'drafting', 'self_check', 'beta', 'revising', 'finalized', 'published', 'retro', 'archived', 'shelved'];
  var STATE_LABEL = { idea: '选题确认', drafting: '起草中', self_check: '自检中', beta: '内测中', revising: '修改中', finalized: '已定稿', published: '已发布', retro: '复盘中', archived: '已归档', shelved: '已搁置' };
  var EDITABLE = ['drafting', 'self_check', 'revising'];
  var BETA_TYPES = ['读不下去', '不相信', '想要更多', '存疑投票', '自由批注'];
  var OVERGENERAL = ['这不是', '所有人都', '所有人', '必然', '一定', '本质上', '重新定价', '我们必须'];

  function now() { return new Date().toISOString().slice(0, 16).replace('T', ' '); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function Atelier(seed) {
    this.s = clone(seed);
    /* v0.2 新增资产：对旧持久化状态做默认值补全，保证升级后可直接加载 */
    var s = this.s;
    if (!s.betaRounds) s.betaRounds = [];
    if (!s.betaPool) s.betaPool = [];
    if (!s.readerScores) s.readerScores = {};
    if (!s.citationBank) s.citationBank = [];
    if (!s.titleLog) s.titleLog = [];
    if (!s.versionSnapshots) s.versionSnapshots = [];
    if (!s.authRequests) s.authRequests = [];
    if (!s.followers) s.followers = [];
  }

  Atelier.prototype._id = function (prefix) {
    if (!this.s.counters[prefix]) { /* 首次生成：从已有资产最大编号续号，避免与种子数据撞号 */
      var max = 0, self = this;
      function scan(x) {
        if (x && x.id && x.id.indexOf(prefix + '-') === 0) {
          var n = parseInt(x.id.slice(prefix.length + 1), 10);
          if (!isNaN(n) && n > max) max = n;
        }
      }
      ['works', 'materialCards', 'demandSignals', 'topicBacklog', 'checkRuleBank', 'knowledgeBase', 'materialBank', 'bugReports', 'proposals',
        'betaRounds', 'citationBank', 'titleLog', 'versionSnapshots', 'authRequests'].forEach(function (k) {
        (self.s[k] || []).forEach(scan);
      });
      /* 嵌套资产：作品自检项 / 内测标注 */
      this.s.works.forEach(function (w) { (w.checks || []).forEach(scan); });
      this.s.betaRounds.forEach(function (r) { (r.feedbacks || []).forEach(scan); });
      this.s.counters[prefix] = max;
    }
    this.s.counters[prefix] = this.s.counters[prefix] + 1;
    return prefix + '-' + String(this.s.counters[prefix]).padStart(3, '0');
  };

  Atelier.prototype.log = function (kind, detail, valid) {
    this.s.logs.unshift({ ts: now(), kind: kind, detail: detail, valid: valid !== false });
    if (this.s.logs.length > 200) this.s.logs.length = 200;
  };

  /* ---------- 读取视图 ---------- */
  Atelier.prototype.getState = function () { return this.s; };

  Atelier.prototype.desk = function () {
    var cards = [], s = this.s;
    s.proposals.filter(function (p) { return p.status === 'open'; }).forEach(function (p) {
      cards.push({ type: '选题提议', title: p.title, ref: '依据：' + p.evidenceRefs.length + ' 条资产引用（锚点已核验）', pid: p.id });
    });
    var self = this;
    s.works.forEach(function (w) {
      if (w.status === 'self_check' && w.checks.some(function (c) { return c.action === null; }))
        cards.push({ type: '待处理自检', title: w.title, ref: '未处理 ' + w.checks.filter(function (c) { return c.action === null; }).length + ' 条 · 处理完毕才可定稿', wid: w.id });
      if (w.status === 'beta') {
        var r = self._round(w.id);
        if (r && r.status === 'open') {
          var responded = {}; r.feedbacks.forEach(function (f) { responded[f.reader] = 1; });
          var doneAll = r.readers.every(function (n) { return responded[n]; });
          cards.push({ type: doneAll ? '内测收齐' : '内测进行中', title: w.title, ref: '首读者 ' + Object.keys(responded).length + '/' + r.readers.length + ' 已反馈 · ' + r.feedbacks.length + ' 条标注' + (doneAll ? ' · 可关闭窗口聚合' : ''), wid: w.id });
        }
        if (r && r.status === 'closed' && r.report.items.some(function (i) { return !i.action; }))
          cards.push({ type: '内测反馈待处理', title: w.title, ref: '聚合报告 ' + r.report.items.filter(function (i) { return !i.action; }).length + ' 条待逐条处理（采纳 → 修改回环）', wid: w.id });
      }
      if (w.status === 'published')
        cards.push({ type: '复盘到期', title: w.title, ref: '发布满 7 天提醒 · 资产清点 + 档案归档（不可变）', wid: w.id });
    });
    s.bugReports.filter(function (b) { return b.status === 'open'; }).forEach(function (b) {
      cards.push({ type: '捉虫待裁决', title: '@' + b.reader + ' · ' + b.type, ref: '附证据 · 确认后写入自检规则库', bid: b.id });
    });
    if (s.noteInbox.length >= 3) cards.push({ type: '速记待归档', title: s.noteInbox.length + ' 条速记积压', ref: '归档后自动关联搁置选题', act: 'archiveNotes' });
    return cards.slice(0, 5);
  };

  Atelier.prototype.kanban = function () {
    var lanes = {};
    ['idea', 'drafting', 'self_check', 'beta', 'revising', 'finalized', 'published', 'archived'].forEach(function (k) { lanes[k] = []; });
    this.s.works.forEach(function (w) { if (lanes[w.status]) lanes[w.status].push(w); });
    return { lanes: lanes, shelved: this.s.works.filter(function (w) { return w.status === 'shelved'; }) };
  };

  Atelier.prototype.shopView = function () {
    var s = this.s;
    var published = s.works.filter(function (w) { return w.status === 'published' || w.status === 'retro' || w.status === 'archived'; });
    var wall = { tips: {}, bugs: {} };
    s.materialCards.filter(function (m) { return m.status === 'used'; }).forEach(function (m) { wall.tips[m.provider] = (wall.tips[m.provider] || 0) + 1; });
    s.bugReports.filter(function (b) { return b.verdict === 'confirmed'; }).forEach(function (b) { wall.bugs[b.reader] = (wall.bugs[b.reader] || 0) + 1; });
    return {
      creator: s.creator,
      stats: { published: published.length, tips: s.materialCards.length, tipsUsed: s.materialCards.filter(function (m) { return m.status === 'used'; }).length, rules: s.checkRuleBank.length },
      works: published,
      wall: wall,
      window: s.works.filter(function (w) { return ['idea', 'drafting', 'self_check', 'beta', 'revising'].indexOf(w.status) >= 0 && w.windowPublic !== false; })[0] || null
    };
  };

  /* ---------- Contract 校验层 ---------- */
  Atelier.prototype._resolveRef = function (ref) {
    var s = this.s, parts = ref.split(':'), id = parts[1] || ref;
    if (parts[0] === 'MC') return s.materialCards.some(function (m) { return m.id === id; });
    if (parts[0] === 'DS') return s.demandSignals.some(function (d) { return d.id === id; });
    if (parts[0] === 'TB') return s.topicBacklog.some(function (t) { return t.id === id; });
    if (parts[0] === 'KB') return s.knowledgeBase.some(function (k) { return k.id === id; });
    if (parts[0] === 'MB') return s.materialBank.some(function (k) { return k.id === id; });
    if (parts[0] === 'CB') return s.citationBank.some(function (c) { return c.id === id; });
    return false;
  };

  Atelier.prototype._contractProposal = function (p) {
    var self = this;
    if (!p.evidenceRefs || p.evidenceRefs.length < 1) return 'evidence_refs=0，违反铁律①「无引用不调用」';
    for (var i = 0; i < p.evidenceRefs.length; i++)
      if (!self._resolveRef(p.evidenceRefs[i])) return '锚点不存在：' + p.evidenceRefs[i];
    return null;
  };

  /* ---------- 引擎动作一：Propose（含 Contract，失败即丢弃） ---------- */
  Atelier.prototype._propose = function (draft) {
    var fail = this._contractProposal(draft);
    if (fail) {
      this.log('Propose', '候选提议「' + draft.title + '」丢弃 · ' + fail, false);
      return null;
    }
    draft.id = this._id('TP'); draft.status = 'open'; draft.ts = now();
    this.s.proposals.unshift(draft);
    this.log('Propose', '生成选题提议 ' + draft.id + '《' + draft.title + '》· evidence_refs=' + draft.evidenceRefs.length + ' · Contract 校验通过', true);
    return draft;
  };

  Atelier.prototype.rejectProposal = function (pid, reason) {
    var p = this.s.proposals.find(function (x) { return x.id === pid; });
    if (!p) return;
    p.status = 'rejected';
    this.log('Writeback', '否决提议 ' + pid + ' · 理由写回引擎偏好：' + (reason || '未填写'), true);
  };

  /* ---------- 引擎动作二：Trigger T1/T2 ---------- */
  Atelier.prototype._runTriggers = function (materialCard) {
    var self = this.s, refs = [], tags = materialCard.tags;
    var matched = self.demandSignals.filter(function (d) { return d.tags.some(function (t) { return tags.indexOf(t) >= 0; }); });
    var clusters = {};
    matched.forEach(function (d) { d.tags.forEach(function (t) { if (tags.indexOf(t) >= 0) clusters[t] = (clusters[t] || 0) + 1; }); });
    var hotTag = null, max = 0;
    Object.keys(clusters).forEach(function (t) { if (clusters[t] > max) { max = clusters[t]; hotTag = t; } });

    refs.push('MC:' + materialCard.id);
    matched.slice(0, 3).forEach(function (d) { refs.push('DS:' + d.id); });
    var backlogHit = self.topicBacklog.find(function (t) { return t.tags.some(function (x) { return tags.indexOf(x) >= 0; }); });
    if (backlogHit) refs.push('TB:' + backlogHit.id);

    if (refs.length >= 2) {
      this.log('Trigger', 'T1/T2 命中：新报料 ' + materialCard.id + ' × 需求信号 ' + matched.length + ' 条' + (backlogHit ? ' × 搁置选题 ' + backlogHit.title : ''), true);
      var title = backlogHit ? backlogHit.title : '关于「' + (hotTag || tags[0] || '新话题') + '」的一篇观察';
      this._propose({
        title: title,
        rationale: '新报料刚入库' + (matched.length >= 3 ? '，且同主题需求信号已聚成 ' + matched.length + ' 条' : '') + (backlogHit ? '；与搁置选题《' + backlogHit.title + '》的伏笔匹配' : '') + '——现在写的时机到了。',
        evidenceRefs: refs,
        demandScore: Math.min(100, 40 + matched.length * 15),
        materialReadiness: Math.min(100, 50 + matched.length * 10),
        tags: tags, fromCard: materialCard.id, backlogId: backlogHit ? backlogHit.id : null
      });
    } else {
      this.log('Trigger', 'T1 报料入库 ' + materialCard.id + ' · 信号不足（匹配 ' + matched.length + ' 条 < 2），不生成提议，素材留库等待', true);
    }
  };

  /* ---------- 读者动作：报料（含结构化萃取 + 授权） ---------- */
  Atelier.prototype.submitTip = function (reader, content, scope, aiExtract) {
    var tags, fields, questions = [];
    if (aiExtract && aiExtract.fields) {
      fields = aiExtract.fields;
      tags = (aiExtract.tags && aiExtract.tags.length) ? aiExtract.tags : ['见闻'];
      questions = (aiExtract.questions || []).slice(0, 3);
    } else {
      tags = [];
      ['转行', '手艺', '远程办公', '算法', '中年', '副业', '辞职', '收入'].forEach(function (t) { if (content.indexOf(t) >= 0) tags.push(t); });
      if (!tags.length) tags = ['见闻'];
      fields = {
        time: (content.match(/(20\d{2})\s*年/) || [])[1] || '未提及',
        person: (content.match(/从(.{1,12})到(.{1,12})[，。]/) || []).slice(1, 3).join(' → ') || '待补充',
        conflict: content.length > 30 ? content.slice(0, 30) + '…' : content,
        detail: /地址|工作室|公司|门店/.test(content) ? '含可验证细节' : '暂无可验证细节'
      };
      if (fields.detail === '暂无可验证细节') questions.push('方便补一个可验证的细节吗（如地点/时间段）？');
      if (fields.time === '未提及') questions.push('这段经历大致发生在哪一年？');
    }
    var card = {
      id: this._id('MC'), provider: reader, content: content, fields: fields, questions: questions,
      extractedBy: (aiExtract && aiExtract.fields) ? 'llm' : 'rules',
      license: { scope: scope, status: 'active' }, tags: tags, ts: now(), status: 'available'
    };
    this.s.materialCards.unshift(card);
    this.log('Writeback', '报料入库 ' + card.id + '（@' + reader + ' · 授权：' + scope + '）· ' + (card.extractedBy === 'llm' ? '大模型' : '规则引擎') + '结构化萃取完成' + (questions.length ? ' · 追问 ' + questions.length + ' 条（可答可不答）' : ''), true);
    this._runTriggers(card);
    return card;
  };

  Atelier.prototype.revokeMaterial = function (cardId) {
    var c = this.s.materialCards.find(function (m) { return m.id === cardId; });
    if (!c) return;
    c.license.status = 'revoked';
    this.log('Writeback', '素材卡 ' + cardId + ' 授权撤回 · 引擎立即停止装配（已发布不追溯）', true);
  };

  Atelier.prototype.addSignal = function (from, text, tags) {
    var d = { id: this._id('DS'), from: from, text: text, tags: tags || [], ts: now() };
    this.s.demandSignals.unshift(d);
    this.log('Writeback', '需求信号 ' + d.id + ' 入库（@' + from + '）', true);
    return d;
  };

  /* ---------- 创作者动作：选题 → 作品 ---------- */
  Atelier.prototype.confirmProposal = function (pid) {
    var p = this.s.proposals.find(function (x) { return x.id === pid; });
    if (!p || p.status !== 'open') throw new Error('提议不存在或已处理');
    p.status = 'confirmed';
    var w = {
      id: this._id('W'), title: p.title, status: 'drafting', tags: p.tags || [],
      proposalId: p.id, topicOrigin: p, paragraphs: [], bundle: [], checks: [],
      skipped: [], credits: [], revisions: [], timeline: { idea: now(), drafting: now() },
      declaration: '', retro: null
    };
    if (p.backlogId) {
      var bl = this.s.topicBacklog.find(function (t) { return t.id === p.backlogId; });
      if (bl) bl.status = 'revived';
    }
    this.s.works.unshift(w);
    this.assemble(w.id);
    this.log('Writeback', '选题确认：提议 ' + pid + ' → 新建作品 ' + w.id + '《' + w.title + '》（状态 drafting，创作者显式触发 ✓）', true);
    return w;
  };

  Atelier.prototype.createManualTopic = function (title, tags) {
    var w = {
      id: this._id('W'), title: title, status: 'drafting', tags: tags || [],
      proposalId: null, topicOrigin: { title: title, rationale: '创作者手动建题（无提议来源，档案如实记录）', evidenceRefs: [] },
      paragraphs: [], bundle: [], checks: [], skipped: [], credits: [], revisions: [],
      timeline: { idea: now(), drafting: now() }, declaration: '', retro: null
    };
    this.s.works.unshift(w);
    this.assemble(w.id);
    return w;
  };

  Atelier.prototype.shelve = function (wid, reason) {
    var w = this._work(wid);
    w.status = 'shelved'; w.shelveReason = reason || '暂无';
    this.s.topicBacklog.unshift({ id: this._id('TB'), title: w.title, reason: w.shelveReason, tags: w.tags, shelvedAt: now(), status: 'shelved', sourceWork: w.id });
    this.log('Writeback', '作品 ' + wid + ' 搁置 → 写入未完成选题库（含理由，可被 T4 复活）', true);
  };

  /* ---------- 引擎动作三：Assemble（6 级优先级 + 授权硬门槛） ---------- */
  Atelier.prototype.assemble = function (wid) {
    var w = this._work(wid), s = this.s, bundle = [], blocked = [];
    bundle.push({ pri: 1, type: '风格档案', ref: 'SP-001', why: '必装 · 用词/句长/禁用表达', status: 'ok' });
    s.materialCards.forEach(function (m) {
      var hit = m.tags.some(function (t) { return w.tags.indexOf(t) >= 0; });
      if (!hit) return;
      if (m.license.status !== 'active') { blocked.push({ pri: 2, type: '素材卡', ref: m.id, why: '主题匹配 · 未授权（' + m.license.status + '）', status: 'blocked' }); return; }
      bundle.push({ pri: 2, type: '素材卡', ref: m.id, why: '主题匹配 · 授权：' + m.license.scope, status: 'ok' });
    });
    s.topicBacklog.forEach(function (t) {
      if (t.status !== 'shelved') return;
      if (t.tags.some(function (x) { return w.tags.indexOf(x) >= 0; }))
        bundle.push({ pri: 3, type: '创作伏笔', ref: t.id, why: '搁置选题《' + t.title + '》的未展开论点，本篇可承接', status: 'ok' });
    });
    var signals = s.demandSignals.filter(function (d) { return d.tags.some(function (t) { return w.tags.indexOf(t) >= 0; }); }).slice(0, 3);
    if (signals.length) bundle.push({ pri: 4, type: '需求信号 ×' + signals.length, ref: signals.map(function (d) { return d.id; }).join(','), why: '校准读者想看什么', status: 'ok', detail: signals.map(function (d) { return '@' + d.from + '：' + d.text; }) });
    s.knowledgeBase.forEach(function (k) {
      if (k.tags.some(function (t) { return w.tags.indexOf(t) >= 0; }))
        bundle.push({ pri: 5, type: '知识库', ref: k.id, why: k.title, status: 'ok' });
    });
    bundle.sort(function (a, b) { return a.pri - b.pri; });
    w.bundle = bundle;
    this.log('Assemble', '装配《' + w.title + '》上下文包：' + bundle.length + ' 项' + (blocked.length ? ' · 拦截 ' + blocked.length + ' 项未授权素材：' + blocked.map(function (b) { return b.ref; }).join(',') : '') + ' · 授权硬门槛校验通过', true);
    w.blockedBundle = blocked;
    return { bundle: bundle, blocked: blocked };
  };

  /* ---------- 起草 ---------- */
  Atelier.prototype._work = function (wid) {
    var w = this.s.works.find(function (x) { return x.id === wid; });
    if (!w) throw new Error('作品不存在：' + wid);
    return w;
  };

  Atelier.prototype.addParagraph = function (wid, text, kind) {
    var w = this._work(wid);
    if (EDITABLE.indexOf(w.status) < 0) throw new Error('当前状态不可编辑：' + w.status);
    var maxN = 0;
    w.paragraphs.forEach(function (x) { var n = parseInt(String(x.id).slice(1), 10); if (!isNaN(n) && n > maxN) maxN = n; });
    var p = { id: 'P' + (maxN + 1), text: text, kind: kind || 'user', citations: [] };
    w.paragraphs.push(p);
    this._registerCitations(w, p);
    return p;
  };

  Atelier.prototype.updateParagraph = function (wid, pid, text) {
    var w = this._work(wid);
    if (EDITABLE.indexOf(w.status) < 0) throw new Error('当前状态不可编辑：' + w.status);
    var p = w.paragraphs.find(function (x) { return x.id === pid; });
    if (!p) throw new Error('段落不存在');
    if (!String(text).trim()) throw new Error('段落不能为空');
    p.text = String(text).trim();
    this._registerCitations(w, p);
    if (p.kind === 'ai' && p.confirmed) { /* 铁律②：AI 段被改动后须重新过目 */
      p.confirmed = false; p.kind = 'ai';
      this.log('Writeback', w.id + ' · 段落 ' + pid + ' 被修改，AI 段转正状态已回退（须重新过目）', true);
    }
    return p;
  };

  Atelier.prototype.deleteParagraph = function (wid, pid) {
    var w = this._work(wid);
    if (EDITABLE.indexOf(w.status) < 0) throw new Error('当前状态不可编辑：' + w.status);
    var idx = w.paragraphs.findIndex(function (x) { return x.id === pid; });
    if (idx < 0) throw new Error('段落不存在');
    var removed = w.paragraphs.splice(idx, 1)[0];
    this.log('Writeback', w.id + ' · 删除段落 ' + pid + '（' + removed.text.slice(0, 20) + '…）', true);
    return removed;
  };

  Atelier.prototype.renameWork = function (wid, title) {
    var w = this._work(wid);
    if (['archived'].indexOf(w.status) >= 0) throw new Error('已归档作品不可改名');
    if (!String(title).trim()) throw new Error('标题不能为空');
    w.title = String(title).trim();
    return w;
  };

  /* ---------- 引用管家 CitationKeeper（v0.2）：正文 URL 自动登记引用源库 ---------- */
  Atelier.prototype._registerCitations = function (w, p) {
    var self = this;
    var urls = String(p.text).match(/https?:\/\/[^\s，。」）)\]、]+/g) || [];
    urls.forEach(function (u) {
      var c = self.s.citationBank.find(function (x) { return x.url === u; });
      if (!c) {
        c = { id: self._id('CB'), url: u, ts: now(), fresh: 'valid', usedBy: [] };
        self.s.citationBank.push(c);
        self.log('Writeback', '引用管家：登记新引用源 ' + c.id + '（' + u.slice(0, 44) + '）→ 引用源库', true);
      }
      if (c.usedBy.indexOf(w.id) < 0) c.usedBy.push(w.id);
      if (!p.citations.some(function (x) { return x.asset === 'CB:' + c.id; }))
        p.citations.push({ asset: 'CB:' + c.id, anchor: 'A-' + w.id + '-' + p.id });
    });
  };

  /* ---------- 版本对照（v0.2）：关键节点自动存快照 ---------- */
  Atelier.prototype._snapshot = function (w, label) {
    this.s.versionSnapshots.push({ id: this._id('VS'), wid: w.id, label: label, ts: now(), paragraphs: clone(w.paragraphs) });
    var mine = this.s.versionSnapshots.filter(function (v) { return v.wid === w.id; });
    while (mine.length > 12) { var drop = mine.shift(); this.s.versionSnapshots.splice(this.s.versionSnapshots.indexOf(drop), 1); }
  };

  Atelier.prototype.citeAsset = function (wid, pid, assetRef) {
    var w = this._work(wid), p = w.paragraphs.find(function (x) { return x.id === pid; });
    if (!p) throw new Error('段落不存在');
    if (assetRef.slice(0, 2) === 'MC') {
      var c = this.s.materialCards.find(function (m) { return m.id === assetRef; });
      if (!c) throw new Error('素材不存在');
      if (c.license.status !== 'active') { this.log('Assemble', '引用拦截：' + assetRef + ' 未授权，拖入被系统阻断（硬规则）', false); throw new Error('未授权素材不可引用（硬规则）'); }
      c.status = 'in_use';
    }
    var anchor = 'A-' + w.id + '-' + pid;
    p.citations.push({ asset: assetRef, anchor: anchor });
    this.log('Writeback', '拖入即引用：' + assetRef + ' → 《' + w.title + '》' + pid + ' · 锚点 ' + anchor + ' 登记 · 署名区同步', true);
    return anchor;
  };

  Atelier.prototype.confirmAI = function (wid, pid) {
    var w = this._work(wid), p = w.paragraphs.find(function (x) { return x.id === pid; });
    if (!p) throw new Error('段落不存在');
    if (p.kind !== 'ai') throw new Error('非 AI 段落');
    p.kind = 'user'; p.confirmed = true;
    this.log('Writeback', '过目转正：《' + w.title + '》' + pid + ' AI 段落经创作者确认转正（authorship 底账记录）', true);
  };

  /* ---------- 阶段③：自检（大模型意见注入 + 规则库兜底，锦点强校验） ---------- */
  Atelier.prototype._scanChecks = function (w, paras, opts) {
    opts = opts || {};
    var self = this, out = [];
    var citedCount = w.paragraphs.filter(function (p) { return p.citations.length; }).length;
    var skip = opts.skipMap || {};
    function push(item) { if (!skip[item.category + '|' + item.issue]) out.push(item); }
    paras.forEach(function (p) {
      // C2 论据缺失：含数据但段落无引用锚点
      if (/\d{2,}/.test(p.text) && !p.citations.length)
        push(self._checkItem(w, p, 'C2', '数据无来源', '出现数字「' + (p.text.match(/\d{2,}[^，。]*/) || [''])[0].slice(0, 18) + '」但该段落未登记任何引用锚点。', 'high', '补来源并登记引用，或改为模糊表述'));
      if (!opts.c12Only) {
        // C4 风格漂移：命中禁用表达
        self.s.styleProfile.banned.forEach(function (b) {
          if (p.text.indexOf(b) >= 0)
            push(self._checkItem(w, p, 'C4', '风格漂移 · 禁用表达', '命中风格档案禁用表达「' + b + '」（说教句式）。', 'medium', '删去该句式，直接陈述'));
        });
      }
      // 规则库注入（捉虫衍生规则等）：无论真实/降级链路都执行，复利机制不依赖大模型
      self.s.checkRuleBank.forEach(function (r) {
        if (r.keywords && r.keywords.every(function (k) { return p.text.indexOf(k) >= 0; })) {
          r.hits = (r.hits || 0) + 1;
          push(self._checkItem(w, p, 'C2', '规则库命中 ' + r.id, r.rule, 'high', '按规则核对后登记引用源', r.id));
        }
      });
      // C1 逻辑漏洞：全称结论但全文引用支撑不足
      OVERGENERAL.forEach(function (k) {
        if (p.text.indexOf(k) >= 0 && citedCount < 2)
          push(self._checkItem(w, p, 'C1', '以偏概全', '由少量案例直接推出普遍结论「' + k + '…」，全文引用支撑仅 ' + citedCount + ' 处。', citedCount === 0 ? 'high' : 'medium', '补同类案例，或将结论降格为个体经验'));
      });
    });
    return out;
  };

  Atelier.prototype._validateAIChecks = function (w, items) {
    var self = this, valid = [], dropped = 0;
    (items || []).forEach(function (it) {
      var p = w.paragraphs.find(function (x) { return x.id === it.pid; });
      var q = String(it.quote || '').trim();
      if (!p || !q || p.text.indexOf(q) < 0 || ['C1', 'C2', 'C3', 'C4', 'C5'].indexOf(it.category) < 0) { dropped++; return; }
      var c = self._checkItem(w, p, it.category, String(it.issue || '待定义').slice(0, 30), String(it.desc || '').slice(0, 120), ['high', 'medium', 'low'].indexOf(it.confidence) >= 0 ? it.confidence : 'medium', it.suggestion ? String(it.suggestion).slice(0, 80) : null);
      c.anchor.quote = q.slice(0, 60);
      c.source = 'llm';
      valid.push(c);
    });
    if (dropped) this.log('Propose', 'AI 自检 ' + dropped + ' 条意见锚点无法命中原文 → 整条丢弃（铁律①无引用不调用）', false);
    return valid;
  };

  Atelier.prototype.submitCheck = function (wid, aiItems) {
    var w = this._work(wid);
    if (w.status !== 'drafting') throw new Error('仅起草中可提交自检');
    if (!w.paragraphs.length) throw new Error('草稿为空');
    this._snapshot(w, '自检前');
    w.status = 'self_check'; w.timeline.self_check = now();
    var valid = this._validateAIChecks(w, aiItems);
    if (valid.length) {
      // 大模型意见为主，规则库命中仍叠加（捉虫复利不依赖模型）
      var ruleOnly = this._scanChecks(w, w.paragraphs, {}).filter(function (c) { return c.ruleRef; });
      w.checks = valid.concat(ruleOnly);
      this.log('Assemble', '自检《' + w.title + '》：大模型 ' + valid.length + ' 条（锚点强校验通过）+ 规则库 ' + ruleOnly.length + ' 条 · 快照已存', true);
    } else {
      w.checks = this._scanChecks(w, w.paragraphs, {});
      this.log('Assemble', '自检《' + w.title + '》：' + w.checks.length + ' 条意见（C1/C2/C4 规则引擎）· 全部带锚点 · 注入规则库 ' + this.s.checkRuleBank.length + ' 条', true);
    }
    return w.checks;
  };

  Atelier.prototype._checkItem = function (w, p, category, issue, desc, confidence, suggestion, ruleRef) {
    return {
      id: this._id('CK'), category: category, issue: issue,
      anchor: { p: p.id, quote: p.text.slice(0, 60) + (p.text.length > 60 ? '…' : '') },
      desc: desc, confidence: confidence, suggestion: suggestion,
      ruleRef: ruleRef || null, action: null, reason: null
    };
  };

  Atelier.prototype.handleCheck = function (wid, cid, action, reason) {
    var w = this._work(wid), c = w.checks.find(function (x) { return x.id === cid; });
    if (!c) throw new Error('自检项不存在');
    c.action = action; c.reason = reason || '';
    if (action === 'reject') {
      this.log('Writeback', '自检驳回 ' + cid + '（' + c.category + '）· 理由「' + c.reason + '」写回规则库作负样本，同类误报降权', true);
      this.s.checkRuleBank.push({ id: this._id('CR'), rule: '负样本：' + c.issue + ' —— 创作者认为可接受（' + c.reason + '）', source: '驳回', keywords: null, hits: 0, negative: true });
    }
    if (action === 'accept') {
      w.revisions.push({ checkId: cid, note: '采纳 ' + c.category + '：' + c.issue });
    }
    if (action === 'hold') {
      this.log('Writeback', '自检项 ' + cid + ' 标记存疑 → 留到内测窗口交首读者投票众裁', true);
    }
  };

  /* ---------- 阶段④：内测（beta）—— 首读者体系 ---------- */
  Atelier.prototype._round = function (wid) {
    var rounds = this.s.betaRounds.filter(function (r) { return r.wid === wid; });
    return rounds.length ? rounds[rounds.length - 1] : null;
  };

  Atelier.prototype.betaRecommend = function (wid) {
    var w = this._work(wid), s = this.s;
    return s.betaPool.filter(function (r) { return !r.removed; }).map(function (r) {
      var score = (s.readerScores[r.name] && s.readerScores[r.name].score) || 0;
      var topical = (r.tags || []).some(function (t) { return w.tags.indexOf(t) >= 0; });
      return { name: r.name, score: score, topical: topical, why: (topical ? '主题匹配（' + r.tags.join('/') + '）' : '长期首读') + ' · 反馈质量分 ' + score, rank: (topical ? 100 : 0) + score };
    }).sort(function (a, b) { return b.rank - a.rank; });
  };

  Atelier.prototype.openBeta = function (wid, readers, hours) {
    var w = this._work(wid);
    if (w.status !== 'self_check') throw new Error('仅自检完成后可开启内测');
    var pending = w.checks.filter(function (c) { return c.action === null; });
    if (pending.length) throw new Error('尚有 ' + pending.length + ' 条自检意见未处理（内测前检查清单）');
    var aiPending = w.paragraphs.filter(function (p) { return p.kind === 'ai'; });
    if (aiPending.length) throw new Error('存在 ' + aiPending.length + ' 处未转正 AI 段落（内测前检查清单）');
    if (!readers || readers.length < 1) throw new Error('至少选定 1 位首读者');
    if (readers.length > 8) throw new Error('首读者上限 8 人');
    this._snapshot(w, '内测前');
    var round = {
      id: this._id('BR'), wid: wid, round: this.s.betaRounds.filter(function (r) { return r.wid === wid; }).length + 1,
      readers: readers.slice(), hours: hours || 48, openedAt: now(), status: 'open',
      feedbacks: [], doubts: w.checks.filter(function (c) { return c.action === 'hold'; }).map(function (c) { return { checkId: c.id, issue: c.issue, votes: {} }; }),
      report: null
    };
    this.s.betaRounds.push(round);
    w.status = 'beta'; w.timeline.beta = now();
    this.log('Writeback', '《' + w.title + '》开启内测第 ' + round.round + ' 轮：首读者 ' + readers.map(function (n) { return '@' + n; }).join('、') + ' · 窗口 ' + round.hours + 'h · 存疑项 ' + round.doubts.length + ' 条交付投票 · 预读页带盲水印', true);
    return round;
  };

  Atelier.prototype.submitBetaFeedback = function (reader, wid, pid, type, note) {
    var w = this._work(wid), r = this._round(wid);
    if (!r || r.status !== 'open') throw new Error('内测窗口未开启或已关闭');
    if (r.readers.indexOf(reader) < 0) throw new Error('@' + reader + ' 不在本轮首读者名单');
    if (BETA_TYPES.indexOf(type) < 0) throw new Error('标注类型无效');
    if (type !== '存疑投票' && !w.paragraphs.some(function (p) { return p.id === pid; })) throw new Error('段落不存在');
    if (type === '不相信' && !String(note || '').trim()) throw new Error('「不相信」需附一句理由');
    var f = { id: this._id('BF'), reader: reader, pid: pid, type: type, note: note || '', ts: now() };
    r.feedbacks.push(f);
    this.log('Writeback', '内测标注：@' + reader + ' 在 ' + pid + ' 打标「' + type + '」' + (note ? '（' + String(note).slice(0, 24) + '）' : ''), true);
    return f;
  };

  Atelier.prototype.voteDoubt = function (reader, wid, checkId, vote) {
    var r = this._round(wid);
    if (!r || r.status !== 'open') throw new Error('内测窗口未开启或已关闭');
    if (r.readers.indexOf(reader) < 0) throw new Error('不在本轮首读者名单');
    var d = r.doubts.find(function (x) { return x.checkId === checkId; });
    if (!d) throw new Error('存疑项不存在');
    d.votes[reader] = vote === 'agree' ? 'agree' : 'disagree';
    this.log('Writeback', '存疑投票：@' + reader + ' 对 ' + checkId + ' 投「' + (vote === 'agree' ? '同意意见' : '不同意') + '」', true);
    return d;
  };

  Atelier.prototype._score = function (reader, delta, why) {
    var sc = this.s.readerScores[reader] || (this.s.readerScores[reader] = { score: 0, miss: 0, history: [] });
    sc.score += delta;
    sc.history.unshift({ ts: now(), delta: delta, why: why });
    if (sc.history.length > 20) sc.history.length = 20;
    this.log('Writeback', '首读者质量分：@' + reader + ' ' + (delta > 0 ? '+' : '') + delta + '（' + why + '）→ 当前 ' + sc.score, true);
  };

  Atelier.prototype.closeBeta = function (wid) {
    var w = this._work(wid), r = this._round(wid), self = this;
    if (w.status !== 'beta' || !r || r.status !== 'open') throw new Error('当前无开放的内测窗口');
    r.status = 'closed'; r.closedAt = now();
    /* 聚合：段落热力 + 共识项（≥60% 同段同类）+ 存疑投票结果 */
    var groups = {};
    r.feedbacks.forEach(function (f) {
      if (f.type === '存疑投票') return;
      var key = f.pid + '|' + f.type;
      (groups[key] = groups[key] || { pid: f.pid, type: f.type, readers: [], notes: [] });
      if (groups[key].readers.indexOf(f.reader) < 0) groups[key].readers.push(f.reader);
      if (f.note) groups[key].notes.push('@' + f.reader + '：' + f.note);
    });
    var total = r.readers.length;
    var items = Object.keys(groups).map(function (k) {
      var g = groups[k];
      return { id: 'BI-' + k.replace('|', '-'), pid: g.pid, type: g.type, count: g.readers.length, readers: g.readers, notes: g.notes, strong: g.readers.length / total >= 0.6, action: null, reason: null };
    }).sort(function (a, b) { return b.count - a.count; });
    var heat = {};
    r.feedbacks.forEach(function (f) { if (f.pid) heat[f.pid] = (heat[f.pid] || 0) + 1; });
    var doubtResults = r.doubts.map(function (d) {
      var agree = Object.keys(d.votes).filter(function (n) { return d.votes[n] === 'agree'; }).length;
      return { checkId: d.checkId, issue: d.issue, agree: agree, total: Object.keys(d.votes).length, verdict: agree * 2 > Object.keys(d.votes).length ? '首读者倾向同意意见' : '首读者倾向不成立' };
    });
    r.report = { items: items, heat: heat, doubts: doubtResults, total: total, closedAt: r.closedAt };
    /* 质量分：窗口内未反馈 −2，连续 2 次移出资格池 */
    var responded = {}; r.feedbacks.forEach(function (f) { responded[f.reader] = 1; });
    r.doubts.forEach(function (d) { Object.keys(d.votes).forEach(function (n) { responded[n] = 1; }); });
    r.readers.forEach(function (n) {
      var sc = self.s.readerScores[n] || (self.s.readerScores[n] = { score: 0, miss: 0, history: [] });
      if (!responded[n]) {
        self._score(n, -2, '内测窗口内未反馈');
        sc.miss = (sc.miss || 0) + 1;
        if (sc.miss >= 2) {
          var pr = self.s.betaPool.find(function (x) { return x.name === n; });
          if (pr && !pr.removed) { pr.removed = true; self.log('Writeback', '@' + n + ' 连续 2 次未反馈 → 移出首读者资格池（可重新申请）', true); }
        }
      } else { sc.miss = 0; }
    });
    this.log('Assemble', '内测窗口关闭《' + w.title + '》：' + r.feedbacks.length + ' 条标注聚合为 ' + items.length + ' 项（强信号 ' + items.filter(function (i) { return i.strong; }).length + ' 项 ≥60% 共识）· 存疑众裁 ' + doubtResults.length + ' 条', true);
    return r.report;
  };

  Atelier.prototype.handleBetaItem = function (wid, itemId, action, reason) {
    var w = this._work(wid), r = this._round(wid), self = this;
    if (!r || !r.report) throw new Error('聚合报告不存在');
    var it = r.report.items.find(function (x) { return x.id === itemId; });
    if (!it) throw new Error('反馈项不存在');
    it.action = action; it.reason = reason || '';
    if (action === 'accept' || action === 'gold') {
      if (w.status === 'beta') { w.status = 'revising'; w.timeline.revising = now(); this._snapshot(w, '修改前'); }
      w.revisions.push({ betaItem: itemId, note: '采纳内测反馈「' + it.type + '」（' + it.pid + '，' + it.count + '/' + r.report.total + ' 人标注）', by: it.readers.join('、') });
      it.readers.forEach(function (n) { self._score(n, action === 'gold' ? 5 : 3, action === 'gold' ? '反馈被标「极有价值」' : '反馈被采纳'); });
      this.log('Writeback', '内测反馈 ' + itemId + ' ' + (action === 'gold' ? '标「极有价值」采纳' : '采纳') + ' → 进入修改回环（revising）', true);
    } else {
      this.log('Writeback', '内测反馈 ' + itemId + ' 驳回 · 理由「' + it.reason + '」写入档案', true);
    }
    /* 全部处理完且无采纳 → 直接回 self_check 可定稿 */
    if (w.status === 'beta' && r.report.items.every(function (x) { return x.action; })) {
      w.status = 'self_check';
      this.log('Writeback', '《' + w.title + '》内测反馈全部处理完毕（无采纳项）→ 回自检完成态，可定稿', true);
    }
    return it;
  };

  Atelier.prototype.reviseDone = function (wid) {
    var w = this._work(wid), self = this;
    if (w.status !== 'revising') throw new Error('仅修改中可提交增量自检');
    var pre = this.s.versionSnapshots.filter(function (v) { return v.wid === wid && v.label === '修改前'; }).pop();
    var changed = w.paragraphs.filter(function (p) {
      var old = pre && pre.paragraphs.find(function (x) { return x.id === p.id; });
      return !old || old.text !== p.text;
    });
    this._snapshot(w, '修改后');
    /* 增量自检：只扫变更段 · 历史已驳回项不重复报 */
    var skipMap = {};
    w.checks.forEach(function (c) { if (c.action === 'reject') skipMap[c.category + '|' + c.issue] = 1; });
    var delta = this._scanChecks(w, changed, { skipMap: skipMap });
    w.checks = w.checks.concat(delta);
    w.status = 'self_check';
    this.log('Assemble', '增量自检《' + w.title + '》：扫描变更段 ' + changed.length + ' 个 → 新增意见 ' + delta.length + ' 条（已驳回项不重复报）· 快照已存', true);
    return delta;
  };

  /* ---------- 定稿 → 发布 ---------- */
  Atelier.prototype.finalize = function (wid) {
    var w = this._work(wid);
    if (['self_check', 'revising'].indexOf(w.status) < 0) throw new Error('仅自检/修改完成后可定稿');
    var pending = w.checks.filter(function (c) { return c.action === null; });
    if (pending.length) throw new Error('尚有 ' + pending.length + ' 条自检意见未处理（状态机前置条件）');
    var aiPending = w.paragraphs.filter(function (p) { return p.kind === 'ai'; });
    if (aiPending.length) throw new Error('存在 ' + aiPending.length + ' 处未转正 AI 段落（诚实标注硬规则）');
    if (!this._round(wid)) {
      w.skipped.push('beta');
      this.log('Writeback', '《' + w.title + '》跳过内测直接定稿 · skipped_stages 记录在档，复盘时将与捉虫量对照归因', true);
    }
    w.status = 'finalized'; w.timeline.finalized = now();
    w.declaration = this._declaration(w);
    /* 标题工坊（v0.2）：定稿触发，生成 5 候选待创作者选定 */
    w.titleCandidates = null;
    return w;
  };

  /* ---------- 标题工坊（v0.2） ---------- */
  Atelier.prototype.titleForge = function (wid, aiCandidates) {
    var w = this._work(wid), s = this.s;
    if (w.status !== 'finalized') throw new Error('仅定稿后可进标题工坊');
    var cands;
    if (aiCandidates && aiCandidates.length >= 2) {
      cands = aiCandidates.slice(0, 5).map(function (c) { return { title: String(c.title || '').slice(0, 40), why: String(c.why || '').slice(0, 60), by: 'llm' }; }).filter(function (c) { return c.title; });
    } else {
      var sig = s.demandSignals.filter(function (d) { return d.tags.some(function (t) { return w.tags.indexOf(t) >= 0; }); });
      var hook = sig.length ? sig[0].text.slice(0, 14) : '';
      cands = [
        { title: w.title, why: '原题 · 保留创作者手感', by: 'rules' },
        { title: w.title.split('：')[0].split('，')[0] + '：一本账算给你看', why: '具象化 · 命中「想看实在的」需求信号' + (sig.length ? '（' + sig.length + ' 条）' : ''), by: 'rules' },
        { title: '关于' + (w.tags[0] || '这件事') + '，读者问得最多的一个问题', why: '提问式 · 呼应需求信号' + (hook ? '「' + hook + '…」' : ''), by: 'rules' },
        { title: w.title.replace(/：.*/, '') + '：' + (w.tags.slice(0, 2).join('与') || '一次重新定价'), why: '关键词前置 · 适合 newsletter 分发', by: 'rules' },
        { title: '「' + ((w.paragraphs[0] || {}).text || '').slice(0, 16) + '…」', why: '首句引语式 · 命中风格档案「引语开场」习惯', by: 'rules' }
      ];
    }
    w.titleCandidates = cands;
    this.log('Propose', '标题工坊：《' + w.title + '》生成 ' + cands.length + ' 个候选（' + (cands[0].by === 'llm' ? '大模型' : '规则引擎') + '），每个带依据 · 选定权在创作者（铁律②）', true);
    return cands;
  };

  Atelier.prototype.chooseTitle = function (wid, title) {
    var w = this._work(wid);
    if (w.status !== 'finalized') throw new Error('仅定稿后可选定标题');
    var old = w.title;
    w.title = String(title).trim() || old;
    this.s.titleLog.push({ id: this._id('TL'), wid: wid, candidates: w.titleCandidates || [], chosen: w.title, ts: now() });
    w.titleCandidates = null;
    this.log('Writeback', '标题选定「' + w.title + '》' + (old !== w.title ? '（原「' + old + '》）' : '') + ' · 候选集+选择写入标题实验记录，长期积累「我的读者吃哪套标题」', true);
    return w;
  };

  Atelier.prototype._declaration = function (w) {
    var aiCount = w.paragraphs.filter(function (p) { return p.confirmed; }).length;
    var d = '本文由 ' + this.s.creator.name + ' 撰写';
    d += aiCount ? '，AI 参与 ' + aiCount + ' 处段落起草（均已逐段过目转正）' : '，AI 未参与正文撰写';
    d += '。自检 ' + w.checks.length + ' 条意见：采纳 ' + w.checks.filter(function (c) { return c.action === 'accept'; }).length + ' / 驳回 ' + w.checks.filter(function (c) { return c.action === 'reject'; }).length + '。';
    var r = this._round(w.id);
    if (r && r.report) d += '经 ' + r.readers.length + ' 位首读者内测（' + r.feedbacks.length + ' 条标注，采纳 ' + r.report.items.filter(function (i) { return i.action === 'accept' || i.action === 'gold'; }).length + ' 项）。';
    else if (w.skipped.indexOf('beta') >= 0) d += '本篇未经内测。';
    return d;
  };

  Atelier.prototype.publish = function (wid) {
    var w = this._work(wid), self = this;
    if (w.status !== 'finalized') throw new Error('仅定稿可发布');
    // 署名核验：只署实际被引用的素材
    var cited = {};
    w.paragraphs.forEach(function (p) { p.citations.forEach(function (c) { cited[c.asset] = (cited[c.asset] || 0) + 1; }); });
    w.credits = Object.keys(cited).map(function (ref) {
      var m = self.s.materialCards.find(function (x) { return x.id === ref; });
      return m ? { ref: ref, name: '@' + m.provider, scope: m.license.scope, count: cited[ref] } : null;
    }).filter(Boolean);
    w.creditsVerified = true;
    w.status = 'published'; w.timeline.published = now(); w.publishedAt = now();
    Object.keys(cited).forEach(function (ref) {
      var m = self.s.materialCards.find(function (x) { return x.id === ref; });
      if (m) m.status = 'used';
    });
    /* 追更推送：橱窗追更过本篇方向的读者入通知日志 */
    var fans = this.s.followers.filter(function (f) { return f.wid === wid; });
    if (fans.length) this.log('Writeback', '发布推送：' + fans.map(function (f) { return '@' + f.reader; }).join('、') + ' 的追更通知已发出（「你追的选题发布了」）', true);
    this.log('Writeback', '发布《' + w.title + '》· 署名核验通过（' + w.credits.length + ' 位报料人被实际引用）· 捉虫入口开放 · 诚实标注声明生成', true);
    return w;
  };

  /* ---------- 复盘 → 归档 ---------- */
  Atelier.prototype.retro = function (wid) {
    var w = this._work(wid), s = this.s;
    if (w.status !== 'published') throw new Error('仅已发布可复盘');
    w.status = 'retro'; w.timeline.retro = now();
    var newSignals = [];
    var r = this._round(wid);
    var betaNote = '本篇未经内测，无对照数据';
    if (r && r.report) {
      var hotPid = Object.keys(r.report.heat).sort(function (a, b) { return r.report.heat[b] - r.report.heat[a]; })[0];
      betaNote = hotPid ? '内测标注最密段落 ' + hotPid + '（' + r.report.heat[hotPid] + ' 条）—— 正式读者流失断点对照的基准已建立' : '内测无段落级标注';
      /* 下篇信号：「想要更多」标注直接生成需求信号 */
      r.feedbacks.filter(function (f) { return f.type === '想要更多'; }).forEach(function (f) {
        var d = { id: null, from: f.reader, text: '内测「想要更多」：' + w.title + ' · ' + f.pid + (f.note ? '（' + f.note + '）' : ''), tags: w.tags, ts: now() };
        newSignals.push(d);
      });
    }
    var self = this;
    newSignals.forEach(function (d) { d.id = self._id('DS'); s.demandSignals.unshift(d); });
    w.retro = {
      assetInventory: '消耗素材 ' + w.credits.length + ' 张 · 新增自检规则 ' + (w.checks.length ? Math.max(1, Math.round(w.checks.length / 3)) : 0) + ' 条候选 · 登记锚点 ' + w.paragraphs.reduce(function (a, p) { return a + p.citations.length; }, 0) + ' 个' + (newSignals.length ? ' · 内测衍生需求信号 ' + newSignals.length + ' 条' : ''),
      pipelineNote: w.skipped.length ? '跳过阶段：' + w.skipped.join(',') + '（后果将在后续数据中对照）' : '流水线完整执行，未跳阶段',
      betaCompare: betaNote,
      nextSignals: newSignals
    };
    w.archive = {
      workId: w.id, title: w.title, topicOrigin: w.topicOrigin, bundleSize: w.bundle.length,
      checkReport: w.checks, revisions: w.revisions, declaration: w.declaration,
      credits: w.credits, timeline: w.timeline, retro: w.retro, archivedAt: now()
    };
    w.status = 'archived'; w.timeline.archived = now();
    this.log('Writeback', '复盘归档《' + w.title + '》→ 创作档案定型（不可变）· ' + w.retro.assetInventory, true);
    return w;
  };

  /* ---------- 速记 ---------- */
  Atelier.prototype.quickNote = function (text) {
    var n = { id: this._id('NT'), text: text, ts: now(), status: 'inbox' };
    this.s.noteInbox.push(n);
    return n;
  };

  Atelier.prototype.archiveNotes = function () {
    var self = this, archived = [];
    this.s.noteInbox.forEach(function (n) {
      n.status = 'archived';
      var matchBacklog = self.s.topicBacklog.find(function (t) { return t.status === 'shelved' && t.tags.some(function (tag) { return n.text.indexOf(tag) >= 0; }); });
      if (matchBacklog) { n.linked = matchBacklog.id; archived.push('「' + n.text.slice(0, 20) + '」→ 关联搁置选题《' + matchBacklog.title + '》'); }
      else { self.s.materialBank.push({ id: self._id('MB'), text: n.text, tags: [], from: '速记归档' }); archived.push('「' + n.text.slice(0, 20) + '」→ 素材库'); }
    });
    this.s.noteInbox = [];
    this.log('Writeback', '速记归档 ' + archived.length + ' 条：' + archived.join('；'), true);
    return archived;
  };

  /* ---------- 读者动作：捉虫 ---------- */
  Atelier.prototype.submitBug = function (reader, wid, quote, type, evidence) {
    var w = this._work(wid);
    if (w.status !== 'published') throw new Error('仅已发布作品可捉虫');
    var b = { id: this._id('BG'), reader: reader, workId: wid, quote: quote, type: type, evidence: evidence, status: 'open', verdict: null, ts: now() };
    this.s.bugReports.unshift(b);
    this.log('Trigger', '捉虫提交 ' + b.id + '（@' + reader + ' · ' + type + '）等待创作者裁决', true);
    return b;
  };

  Atelier.prototype.adjudicateBug = function (bid, verdict, note) {
    var b = this.s.bugReports.find(function (x) { return x.id === bid; });
    if (!b) throw new Error('捉虫不存在');
    b.status = 'closed'; b.verdict = verdict; b.note = note || '';
    var w = this._work(b.workId);
    if (verdict === 'confirmed') {
      w.revisions.push({ bugId: bid, ts: now(), note: '经 @' + b.reader + ' 指正修订（' + b.type + '）：' + b.quote.slice(0, 40), by: b.reader });
      var rule = { id: this._id('CR'), rule: '涉及「' + b.type + '」须核对：' + b.quote.slice(0, 30), source: '捉虫 ' + bid, keywords: this._keywordsOf(b), hits: 0 };
      this.s.checkRuleBank.push(rule);
      /* 引用管家回写：「数据过时」确认 → 本篇引用源标「已知过时」，其它引用同源的作品受提醒 */
      if (b.type === '数据过时' || b.type === '数据待核') {
        var self2 = this;
        this.s.citationBank.filter(function (c) { return c.usedBy.indexOf(w.id) >= 0; }).forEach(function (c) {
          c.fresh = 'stale'; c.staleBy = bid;
          var others = c.usedBy.filter(function (x) { return x !== w.id; });
          self2.log('Writeback', '引用源 ' + c.id + ' 标「已知过时」（捉虫 ' + bid + '）' + (others.length ? ' · 同源引用作品 ' + others.join('、') + ' 已提醒' : ''), true);
        });
      }
      this.log('Writeback', '捉虫 ' + bid + ' 确认 → ① 修订痕迹写入原文 ② 贡献者墙 +1（@' + b.reader + '）③ 生成自检规则 ' + rule.id + '——未来同类错误自动拦截', true);
    } else {
      this.log('Writeback', '捉虫 ' + bid + ' 驳回 · 理由已回复捉虫人，记录保留不公示', true);
    }
    return b;
  };

  Atelier.prototype._keywordsOf = function (b) {
    var ks = [];
    ['收入', '数据', '年份', '转行', '手艺', '远程', '算法'].forEach(function (k) { if (b.quote.indexOf(k) >= 0) ks.push(k); });
    return ks.length ? ks : null;
  };

  /* ---------- 段落级三动作（降级链路：规则引擎）—— 能力收敛在有名字有约束的动作里，不提供自由 prompt ---------- */
  Atelier.prototype.askParagraph = function (wid, pid, aiItems) {
    var w = this._work(wid);
    var p = w.paragraphs.find(function (x) { return x.id === pid; });
    if (!p) throw new Error('段落不存在');
    var items;
    if (aiItems && aiItems.length) {
      items = this._validateAIChecks(w, aiItems).filter(function (c) { return c.anchor.p === pid && (c.category === 'C1' || c.category === 'C2'); });
    } else {
      items = this._scanChecks(w, [p], { c12Only: true }).filter(function (c) { return c.category === 'C1' || c.category === 'C2'; });
    }
    this.log('Assemble', '问一问：' + w.id + ' · ' + pid + ' 单段即时自检（C1/C2）→ ' + items.length + ' 条意见（' + (aiItems && aiItems.length ? '大模型' : '规则引擎') + '，不入正式报告）', true);
    return items;
  };

  Atelier.prototype.rephrase = function (wid, pid, aiCands) {
    var w = this._work(wid);
    var p = w.paragraphs.find(function (x) { return x.id === pid; });
    if (!p) throw new Error('段落不存在');
    var cands;
    if (aiCands && aiCands.length >= 1) {
      cands = aiCands.slice(0, 2).map(function (t) { return String(t).trim(); }).filter(Boolean);
    } else {
      var t = p.text;
      var short = t.split(/[。？！]/).filter(Boolean);
      cands = [
        short.length > 1 ? short[0] + '。' + short.slice(1).join('。').slice(0, 60) + (t.length > 80 ? '…（短句化重组）' : '') : t.slice(0, 40) + '——这件事本身就是答案。',
        '换个说法：' + (short[short.length - 1] || t).trim() + '。' + (short.length > 1 ? short[0] + '。' : '') + '（倒序重组 · 结论前置）'
      ];
    }
    this.log('Propose', '换个说法：' + w.id + ' · ' + pid + ' 按风格档案重写 → ' + cands.length + ' 候选（' + (aiCands && aiCands.length ? '大模型' : '规则引擎') + '）· 采用即转 AI 色标需过目', true);
    return cands;
  };

  Atelier.prototype.applyRephrase = function (wid, pid, text) {
    var w = this._work(wid);
    if (EDITABLE.indexOf(w.status) < 0) throw new Error('当前状态不可编辑：' + w.status);
    var p = w.paragraphs.find(function (x) { return x.id === pid; });
    if (!p) throw new Error('段落不存在');
    p.text = String(text).trim();
    p.kind = 'ai'; p.confirmed = false;
    this._registerCitations(w, p);
    this.log('Writeback', '采用重写候选：' + w.id + ' · ' + pid + ' 转为 AI 色标段，定稿前须过目转正（诚实标注）', true);
    return p;
  };

  Atelier.prototype.factCheck = function (wid, pid, aiFindings) {
    var w = this._work(wid);
    var p = w.paragraphs.find(function (x) { return x.id === pid; });
    if (!p) throw new Error('段落不存在');
    var findings;
    if (aiFindings && aiFindings.length) {
      findings = aiFindings.slice(0, 5).map(function (f) { return { claim: String(f.claim || '').slice(0, 40), verdict: ['有出入', '无依据', '可佐证'].indexOf(f.verdict) >= 0 ? f.verdict : '无依据', basis: String(f.basis || '').slice(0, 60) }; });
    } else {
      findings = [];
      var s = this.s;
      var nums = p.text.match(/\d{2,}[^，。]{0,12}/g) || [];
      nums.forEach(function (n) {
        var kb = s.knowledgeBase.find(function (k) { return k.tags.some(function (t) { return w.tags.indexOf(t) >= 0; }); });
        var cb = s.citationBank.find(function (c) { return c.usedBy.indexOf(w.id) >= 0; });
        if (cb && cb.fresh === 'stale') findings.push({ claim: n, verdict: '有出入', basis: '本篇引用源 ' + cb.id + ' 已标「已知过时」' });
        else if (kb) findings.push({ claim: n, verdict: '可佐证', basis: '知识库 ' + kb.id + '《' + kb.title + '》可比对' });
        else findings.push({ claim: n, verdict: '无依据', basis: '知识库/引用源库均无可比对条目' });
      });
      if (!findings.length) findings.push({ claim: '（本段无数据断言）', verdict: '可佐证', basis: '无需核对' });
    }
    this.log('Assemble', '核一核：' + w.id + ' · ' + pid + ' 事实比对 → ' + findings.length + ' 条结论（只报不改，' + (aiFindings && aiFindings.length ? '大模型' : '规则引擎') + '）', true);
    return findings;
  };

  /* ---------- 全库检索 + 授权请求（v0.2） ---------- */
  Atelier.prototype.searchVault = function (query) {
    var q = String(query || '').trim(), s = this.s;
    if (!q) return [];
    var hit = function (t) { return String(t || '').indexOf(q) >= 0; };
    var out = [];
    s.materialCards.forEach(function (m) { if (hit(m.content) || m.tags.some(hit)) out.push({ kind: '素材卡', id: m.id, text: m.content.slice(0, 60), meta: '@' + m.provider + ' · ' + (m.license.status === 'active' ? '授权：' + m.license.scope : '已撤回/待授权'), usable: m.license.status === 'active' }); });
    s.demandSignals.forEach(function (d) { if (hit(d.text) || d.tags.some(hit)) out.push({ kind: '需求信号', id: d.id, text: d.text.slice(0, 60), meta: '@' + d.from, usable: true }); });
    s.knowledgeBase.forEach(function (k) { if (hit(k.title) || hit(k.summary) || k.tags.some(hit)) out.push({ kind: '知识库', id: k.id, text: k.title, meta: k.summary.slice(0, 40), usable: true }); });
    s.materialBank.forEach(function (m) { if (hit(m.text)) out.push({ kind: '素材库', id: m.id, text: m.text.slice(0, 60), meta: m.from, usable: true }); });
    s.topicBacklog.forEach(function (t) { if (hit(t.title) || t.tags.some(hit)) out.push({ kind: '搁置选题', id: t.id, text: t.title, meta: t.reason, usable: true }); });
    s.citationBank.forEach(function (c) { if (hit(c.url)) out.push({ kind: '引用源', id: c.id, text: c.url.slice(0, 60), meta: c.fresh === 'stale' ? '已知过时' : '有效', usable: true }); });
    s.works.filter(function (w) { return w.archive; }).forEach(function (w) { if (hit(w.title)) out.push({ kind: '创作档案', id: w.id, text: w.title, meta: '已归档 · 可回查', usable: true }); });
    this.log('Assemble', '全库检索「' + q + '」→ ' + out.length + ' 条命中（未授权素材可见但引用被阻断）', true);
    return out.slice(0, 20);
  };

  Atelier.prototype.requestAuth = function (cardId) {
    var c = this.s.materialCards.find(function (m) { return m.id === cardId; });
    if (!c) throw new Error('素材不存在');
    if (c.license.status === 'active') throw new Error('该素材已授权，无需请求');
    if (this.s.authRequests.some(function (r) { return r.cardId === cardId && r.status === 'pending'; })) throw new Error('已有待处理的授权请求');
    var req = { id: this._id('AR'), cardId: cardId, provider: c.provider, ts: now(), status: 'pending' };
    this.s.authRequests.push(req);
    this.log('Writeback', '授权请求 ' + req.id + ' 已发送给 @' + c.provider + '（素材 ' + cardId + '）· 读者同意后自动解锁', true);
    return req;
  };

  Atelier.prototype.respondAuth = function (reqId, agree, scope) {
    var r = this.s.authRequests.find(function (x) { return x.id === reqId; });
    if (!r || r.status !== 'pending') throw new Error('授权请求不存在或已处理');
    var c = this.s.materialCards.find(function (m) { return m.id === r.cardId; });
    r.status = agree ? 'granted' : 'declined'; r.respondedAt = now();
    if (agree && c) {
      c.license.status = 'active';
      if (scope) c.license.scope = scope;
      this.log('Writeback', '@' + r.provider + ' 同意授权请求 ' + reqId + ' → 素材 ' + r.cardId + ' 解锁（' + c.license.scope + '），引擎恢复可装配', true);
    } else {
      this.log('Writeback', '@' + r.provider + ' 婉拒授权请求 ' + reqId + ' · 素材保持不可用，请求记录留存', true);
    }
    return r;
  };

  /* ---------- 读者侧：追更 / 首读资格申请 / 橱窗控制 ---------- */
  Atelier.prototype.followWork = function (reader, wid) {
    var w = this._work(wid);
    if (this.s.followers.some(function (f) { return f.reader === reader && f.wid === wid; })) throw new Error('已在追更名单');
    this.s.followers.push({ reader: reader, wid: wid, ts: now() });
    this.log('Writeback', '@' + reader + ' 追更《' + w.title + '》· 发布时将推送通知', true);
    return { ok: true };
  };

  Atelier.prototype.applyBeta = function (reader, tags) {
    var pool = this.s.betaPool;
    var ex = pool.find(function (r) { return r.name === reader; });
    if (ex && !ex.removed) throw new Error('已在首读者资格池');
    if (ex) { ex.removed = false; if (this.s.readerScores[reader]) this.s.readerScores[reader].miss = 0; }
    else pool.push({ name: reader, tags: tags || [], joinedAt: now() });
    this.log('Writeback', '@' + reader + ' ' + (ex ? '重新申请' : '申请') + '首读者资格 · 已入资格池（创作者开内测时按主题匹配+质量分推荐）', true);
    return { ok: true };
  };

  Atelier.prototype.setWindowPublic = function (wid, isPublic) {
    var w = this._work(wid);
    w.windowPublic = !!isPublic;
    this.log('Writeback', '《' + w.title + '》橱窗公示' + (isPublic ? '开启' : '关闭') + '（公示范围由创作者逐篇控制）', true);
    return w;
  };

  /* ---------- 读者个人贡献视图 + 读者关系台（v0.2） ---------- */
  Atelier.prototype.readerView = function (name) {
    var s = this.s, self = this;
    var tips = s.materialCards.filter(function (m) { return m.provider === name; });
    var bugs = s.bugReports.filter(function (b) { return b.reader === name; });
    var betas = [];
    s.betaRounds.forEach(function (r) {
      if (r.readers.indexOf(name) < 0) return;
      var w = s.works.find(function (x) { return x.id === r.wid; });
      var mine = r.feedbacks.filter(function (f) { return f.reader === name; });
      var adopted = r.report ? r.report.items.filter(function (i) { return (i.action === 'accept' || i.action === 'gold') && i.readers.indexOf(name) >= 0; }).length : 0;
      betas.push({ wid: r.wid, title: w ? w.title : r.wid, round: r.round, marks: mine.length, adopted: adopted, status: r.status });
    });
    var credits = [];
    s.works.forEach(function (w) {
      (w.credits || []).forEach(function (c) { if (c.name === '@' + name) credits.push({ wid: w.id, title: w.title, scope: c.scope, count: c.count }); });
    });
    var score = s.readerScores[name] || { score: 0, miss: 0, history: [] };
    var inPool = s.betaPool.some(function (r) { return r.name === name && !r.removed; });
    return { name: name, tips: tips, bugs: bugs, betas: betas, credits: credits, score: score, inPool: inPool, authRequests: s.authRequests.filter(function (r) { return r.provider === name && r.status === 'pending'; }) };
  };

  Atelier.prototype.relations = function () {
    var s = this.s, byReader = {};
    function R(n) { return byReader[n] || (byReader[n] = { name: n, tips: 0, tipsUsed: 0, betas: 0, adopted: 0, bugs: 0, bugsConfirmed: 0, score: (s.readerScores[n] && s.readerScores[n].score) || 0, inPool: s.betaPool.some(function (r) { return r.name === n && !r.removed; }) }); }
    s.materialCards.forEach(function (m) { var r = R(m.provider); r.tips++; if (m.status === 'used') r.tipsUsed++; });
    s.bugReports.forEach(function (b) { var r = R(b.reader); r.bugs++; if (b.verdict === 'confirmed') r.bugsConfirmed++; });
    s.betaRounds.forEach(function (br) {
      br.readers.forEach(function (n) { R(n).betas++; });
      if (br.report) br.report.items.forEach(function (i) { if (i.action === 'accept' || i.action === 'gold') i.readers.forEach(function (n) { R(n).adopted++; }); });
    });
    s.demandSignals.forEach(function (d) { R(d.from); });
    /* 待回应队列：未处理报料（等待匹配不算）、待裁决捉虫、待响应授权 */
    var queue = [];
    s.bugReports.filter(function (b) { return b.status === 'open'; }).forEach(function (b) { queue.push({ kind: '捉虫待裁决', who: b.reader, what: b.type + '「' + b.quote.slice(0, 20) + '」', ts: b.ts }); });
    s.authRequests.filter(function (r) { return r.status === 'pending'; }).forEach(function (r) { queue.push({ kind: '授权请求待读者响应', who: r.provider, what: '素材 ' + r.cardId, ts: r.ts }); });
    /* 沉睡提醒 + 邀请建议 */
    var sleeping = Object.keys(s.readerScores).filter(function (n) { return s.readerScores[n].miss >= 1; }).map(function (n) { return { name: n, miss: s.readerScores[n].miss }; });
    var invite = Object.keys(byReader).map(function (n) { return byReader[n]; })
      .filter(function (r) { return !r.inPool && (r.tipsUsed >= 1 || r.bugsConfirmed >= 1); })
      .map(function (r) { return { name: r.name, why: (r.tipsUsed ? '报料被采用 ' + r.tipsUsed + ' 次' : '') + (r.bugsConfirmed ? (r.tipsUsed ? ' · ' : '') + '捉虫确认 ' + r.bugsConfirmed + ' 次' : '') + '（带证据引用）' }; });
    return { readers: Object.keys(byReader).map(function (n) { return byReader[n]; }).sort(function (a, b) { return b.score - a.score; }), queue: queue, sleeping: sleeping, invite: invite };
  };

  return { Atelier: Atelier, STATES: STATES, STATE_LABEL: STATE_LABEL, BETA_TYPES: BETA_TYPES };
});
