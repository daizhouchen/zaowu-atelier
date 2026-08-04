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

  var STATES = ['idea', 'drafting', 'self_check', 'finalized', 'published', 'retro', 'archived', 'shelved'];
  var STATE_LABEL = { idea: '选题确认', drafting: '起草中', self_check: '自检中', finalized: '已定稿', published: '已发布', retro: '复盘中', archived: '已归档', shelved: '已搁置' };
  var OVERGENERAL = ['这不是', '所有人都', '所有人', '必然', '一定', '本质上', '重新定价', '我们必须'];

  function now() { return new Date().toISOString().slice(0, 16).replace('T', ' '); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function Atelier(seed) {
    this.s = clone(seed);
  }

  Atelier.prototype._id = function (prefix) {
    if (!this.s.counters[prefix]) { /* 首次生成：从已有资产最大编号续号，避免与种子数据撞号 */
      var max = 0;
      ['works', 'materialCards', 'demandSignals', 'topicBacklog', 'checkRuleBank', 'knowledgeBase', 'materialBank', 'bugReports', 'proposals'].forEach(function (k) {
        (this.s[k] || []).forEach(function (x) {
          if (x.id && x.id.indexOf(prefix + '-') === 0) {
            var n = parseInt(x.id.slice(prefix.length + 1), 10);
            if (!isNaN(n) && n > max) max = n;
          }
        }, this);
      }, this);
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
    s.works.forEach(function (w) {
      if (w.status === 'self_check' && w.checks.some(function (c) { return c.action === null; }))
        cards.push({ type: '待处理自检', title: w.title, ref: '未处理 ' + w.checks.filter(function (c) { return c.action === null; }).length + ' 条 · 处理完毕才可定稿', wid: w.id });
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
    ['idea', 'drafting', 'self_check', 'finalized', 'published', 'archived'].forEach(function (k) { lanes[k] = []; });
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
      window: s.works.filter(function (w) { return ['idea', 'drafting', 'self_check'].indexOf(w.status) >= 0; })[0] || null
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
  Atelier.prototype.submitTip = function (reader, content, scope) {
    var tags = [];
    ['转行', '手艺', '远程办公', '算法', '中年', '副业', '辞职', '收入'].forEach(function (t) { if (content.indexOf(t) >= 0) tags.push(t); });
    if (!tags.length) tags = ['见闻'];
    var fields = {
      time: (content.match(/(20\d{2})\s*年/) || [])[1] || '未提及',
      person: (content.match(/从(.{1,12})到(.{1,12})[，。]/) || []).slice(1, 3).join(' → ') || '待补充',
      conflict: content.length > 30 ? content.slice(0, 30) + '…' : content,
      detail: /地址|工作室|公司|门店/.test(content) ? '含可验证细节' : '暂无可验证细节'
    };
    var card = {
      id: this._id('MC'), provider: reader, content: content, fields: fields,
      license: { scope: scope, status: 'active' }, tags: tags, ts: now(), status: 'available'
    };
    this.s.materialCards.unshift(card);
    this.log('Writeback', '报料入库 ' + card.id + '（@' + reader + ' · 授权：' + scope + '）· 结构化萃取完成：' + JSON.stringify(fields), true);
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
    if (['drafting', 'self_check'].indexOf(w.status) < 0) throw new Error('当前状态不可编辑：' + w.status);
    var maxN = 0;
    w.paragraphs.forEach(function (x) { var n = parseInt(String(x.id).slice(1), 10); if (!isNaN(n) && n > maxN) maxN = n; });
    var p = { id: 'P' + (maxN + 1), text: text, kind: kind || 'user', citations: [] };
    w.paragraphs.push(p);
    return p;
  };

  Atelier.prototype.updateParagraph = function (wid, pid, text) {
    var w = this._work(wid);
    if (['drafting', 'self_check'].indexOf(w.status) < 0) throw new Error('当前状态不可编辑：' + w.status);
    var p = w.paragraphs.find(function (x) { return x.id === pid; });
    if (!p) throw new Error('段落不存在');
    if (!String(text).trim()) throw new Error('段落不能为空');
    p.text = String(text).trim();
    if (p.kind === 'ai' && p.confirmed) { /* 铁律②：AI 段被改动后须重新过目 */
      p.confirmed = false; p.kind = 'ai';
      this.log('Writeback', w.id + ' · 段落 ' + pid + ' 被修改，AI 段转正状态已回退（须重新过目）', true);
    }
    return p;
  };

  Atelier.prototype.deleteParagraph = function (wid, pid) {
    var w = this._work(wid);
    if (['drafting', 'self_check'].indexOf(w.status) < 0) throw new Error('当前状态不可编辑：' + w.status);
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

  /* ---------- 阶段③：自检（C1/C2/C4 + 规则库注入） ---------- */
  Atelier.prototype.submitCheck = function (wid) {
    var w = this._work(wid), self = this;
    if (w.status !== 'drafting') throw new Error('仅起草中可提交自检');
    if (!w.paragraphs.length) throw new Error('草稿为空');
    w.status = 'self_check'; w.timeline.self_check = now();
    w.checks = [];
    var citedCount = w.paragraphs.filter(function (p) { return p.citations.length; }).length;

    w.paragraphs.forEach(function (p) {
      // C2 论据缺失：含数据但段落无引用锚点
      if (/\d{2,}/.test(p.text) && !p.citations.length) {
        w.checks.push(self._checkItem(w, p, 'C2', '数据无来源', '出现数字「' + (p.text.match(/\d{2,}[^，。]*/) || [''])[0].slice(0, 18) + '」但该段落未登记任何引用锚点。', 'high', '补来源并登记引用，或改为模糊表述'));
      }
      // C4 风格漂移：命中禁用表达
      self.s.styleProfile.banned.forEach(function (b) {
        if (p.text.indexOf(b) >= 0)
          w.checks.push(self._checkItem(w, p, 'C4', '风格漂移 · 禁用表达', '命中风格档案禁用表达「' + b + '」（说教句式）。', 'medium', '删去该句式，直接陈述'));
      });
      // 规则库注入（捉虫衍生规则等）
      self.s.checkRuleBank.forEach(function (r) {
        if (r.keywords && r.keywords.every(function (k) { return p.text.indexOf(k) >= 0; })) {
          r.hits = (r.hits || 0) + 1;
          w.checks.push(self._checkItem(w, p, 'C2', '规则库命中 ' + r.id, r.rule, 'high', '按规则核对后登记引用源', r.id));
        }
      });
    });
    // C1 逻辑漏洞：全称结论但全文引用支撑不足
    w.paragraphs.forEach(function (p) {
      OVERGENERAL.forEach(function (k) {
        if (p.text.indexOf(k) >= 0 && citedCount < 2)
          w.checks.push(self._checkItem(w, p, 'C1', '以偏概全', '由少量案例直接推出普遍结论「' + k + '…」，全文引用支撑仅 ' + citedCount + ' 处。', citedCount === 0 ? 'high' : 'medium', '补同类案例，或将结论降格为个体经验'));
      });
    });

    this.log('Assemble', '自检《' + w.title + '》：' + w.checks.length + ' 条意见（C1/C2/C4）· 全部带锚点 · 注入规则库 ' + this.s.checkRuleBank.length + ' 条', true);
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
  };

  /* ---------- 定稿 → 发布 ---------- */
  Atelier.prototype.finalize = function (wid) {
    var w = this._work(wid);
    if (w.status !== 'self_check') throw new Error('仅自检中可定稿');
    var pending = w.checks.filter(function (c) { return c.action === null; });
    if (pending.length) throw new Error('尚有 ' + pending.length + ' 条自检意见未处理（状态机前置条件）');
    var aiPending = w.paragraphs.filter(function (p) { return p.kind === 'ai'; });
    if (aiPending.length) throw new Error('存在 ' + aiPending.length + ' 处未转正 AI 段落（诚实标注硬规则）');
    w.status = 'finalized'; w.timeline.finalized = now();
    w.declaration = this._declaration(w);
    return w;
  };

  Atelier.prototype._declaration = function (w) {
    var aiCount = w.paragraphs.filter(function (p) { return p.confirmed; }).length;
    var d = '本文由 ' + this.s.creator.name + ' 撰写';
    d += aiCount ? '，AI 参与 ' + aiCount + ' 处段落起草（均已逐段过目转正）' : '，AI 未参与正文撰写';
    d += '。自检 ' + w.checks.length + ' 条意见：采纳 ' + w.checks.filter(function (c) { return c.action === 'accept'; }).length + ' / 驳回 ' + w.checks.filter(function (c) { return c.action === 'reject'; }).length + '。';
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
    this.log('Writeback', '发布《' + w.title + '》· 署名核验通过（' + w.credits.length + ' 位报料人被实际引用）· 捉虫入口开放 · 诚实标注声明生成', true);
    return w;
  };

  /* ---------- 复盘 → 归档 ---------- */
  Atelier.prototype.retro = function (wid) {
    var w = this._work(wid), s = this.s;
    if (w.status !== 'published') throw new Error('仅已发布可复盘');
    w.status = 'retro'; w.timeline.retro = now();
    var newSignals = [];
    w.retro = {
      assetInventory: '消耗素材 ' + w.credits.length + ' 张 · 新增自检规则 ' + (w.checks.length ? Math.max(1, Math.round(w.checks.length / 3)) : 0) + ' 条候选 · 登记锚点 ' + w.paragraphs.reduce(function (a, p) { return a + p.citations.length; }, 0) + ' 个',
      pipelineNote: w.skipped.length ? '跳过阶段：' + w.skipped.join(',') + '（后果将在后续数据中对照）' : '流水线完整执行，未跳阶段',
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

  return { Atelier: Atelier, STATES: STATES, STATE_LABEL: STATE_LABEL };
});
