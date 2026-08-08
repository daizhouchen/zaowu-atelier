/* ============================================================
 * 造物 · Atelier — LLM 任务模板 prompts.js
 * 7 个有名字、有约束的 AI 任务（PRD §5.3 反护栏：不提供自由 prompt）。
 * buildMessages(task, body, state) → OpenAI 兼容 messages
 * parseOutput(task, raw) → 强 schema 校验后的结构化产物（失败即抛错 → 回退规则引擎）
 * 锚点校验（铁律①）在 engine._validateAIChecks 二次执行，这里只保证形状合法。
 * ============================================================ */
'use strict';

function jsonOnly(schema) {
  return '你只能输出一个 JSON 对象，不要输出任何其它文字、解释或 markdown 代码块。JSON 形状：' + schema;
}

function paraList(w) {
  return w.paragraphs.map(function (p) { return '[' + p.id + '] ' + p.text; }).join('\n');
}

function styleBrief(s) {
  var sp = s.styleProfile || {};
  return '写作习惯：' + (sp.habits || []).join('；') + '。禁用表达：' + (sp.banned || []).join('、') + '。';
}

function findWork(state, wid) {
  var w = (state.works || []).find(function (x) { return x.id === wid; });
  if (!w) throw new Error('作品不存在：' + wid);
  return w;
}

function findPara(w, pid) {
  var p = w.paragraphs.find(function (x) { return x.id === pid; });
  if (!p) throw new Error('段落不存在：' + pid);
  return p;
}

var BUILDERS = {

  /* 编辑器合写：按装配包+风格档案起草一段 */
  draftSection: function (b, s) {
    var w = findWork(s, b.wid);
    var mats = (w.bundle || []).filter(function (x) { return x.type === '素材卡'; }).map(function (x) {
      var m = s.materialCards.find(function (mc) { return mc.id === x.ref; });
      return m ? '素材（@' + m.provider + '，授权 ' + m.license.scope + '）：' + m.content : '';
    }).filter(Boolean);
    var sigs = s.demandSignals.filter(function (d) { return d.tags.some(function (t) { return w.tags.indexOf(t) >= 0; }); }).slice(0, 3)
      .map(function (d) { return '读者@' + d.from + '：' + d.text; });
    return [
      { role: 'system', content: '你是创作者「' + s.creator.name + '」的合写助手。' + styleBrief(s) + '只写一个中文段落（80–160 字），必须扎根于给定素材，不得虚构素材里没有的事实。' + jsonOnly('{"text":"段落正文"}') },
      { role: 'user', content: '作品《' + w.title + '》（主题：' + w.tags.join('/') + '）。\n已有正文：\n' + (paraList(w) || '（尚无段落）') + '\n\n可用素材：\n' + (mats.join('\n') || '（无）') + '\n\n读者想看：\n' + (sigs.join('\n') || '（无）') + '\n\n请续写下一段' + (b.hint ? '（创作者提示：' + b.hint + '）' : '') + '。' }
    ];
  },

  /* 全文自检 C1–C5：quote 必须逐字命中原文 */
  selfCheck: function (b, s) {
    var w = findWork(s, b.wid);
    var rules = (s.checkRuleBank || []).filter(function (r) { return !r.negative; }).map(function (r) { return r.id + '：' + r.rule; });
    return [
      { role: 'system', content: '你是严格的中文稿件自检引擎。逐段检查以下问题类别：C1 逻辑漏洞（以偏概全/因果倒置）、C2 论据缺失（数据或断言无来源）、C3 自我矛盾、C4 风格漂移（' + styleBrief(s) + '）、C5 事实存疑。每条意见的 quote 字段必须是所在段落原文的逐字子串（否则会被丢弃）。最多 6 条，宁缺毋滥。' + jsonOnly('{"items":[{"pid":"P1","category":"C1|C2|C3|C4|C5","issue":"≤14字问题名","desc":"≤60字说明","quote":"原文逐字子串","confidence":"high|medium|low","suggestion":"≤40字建议"}]}') },
      { role: 'user', content: '《' + w.title + '》全文：\n' + paraList(w) + '\n\n自检规则库（历史捉虫沉淀，命中须报）：\n' + (rules.join('\n') || '（空）') }
    ];
  },

  /* 段落级 · 问一问：仅 C1/C2 */
  askParagraph: function (b, s) {
    var w = findWork(s, b.wid), p = findPara(w, b.pid);
    return [
      { role: 'system', content: '你是稿件自检引擎，只检查单个段落的 C1 逻辑漏洞与 C2 论据缺失，最多 3 条。quote 必须是段落原文逐字子串。' + jsonOnly('{"items":[{"pid":"' + p.id + '","category":"C1|C2","issue":"≤14字","desc":"≤60字","quote":"逐字子串","confidence":"high|medium|low","suggestion":"≤40字"}]}') },
      { role: 'user', content: '段落 [' + p.id + ']：' + p.text }
    ];
  },

  /* 段落级 · 换个说法：按风格档案重写 2 候选 */
  rephrase: function (b, s) {
    var w = findWork(s, b.wid), p = findPara(w, b.pid);
    return [
      { role: 'system', content: '你是创作者「' + s.creator.name + '」的风格重写引擎。' + styleBrief(s) + '把给定段落重写为 2 个候选：候选一短句化，候选二结论前置。保留全部事实，不新增事实。' + jsonOnly('{"candidates":["候选一","候选二"]}') },
      { role: 'user', content: '待重写段落（出自《' + w.title + '》）：' + p.text }
    ];
  },

  /* 段落级 · 核一核：只报不改 */
  factCheck: function (b, s) {
    var w = findWork(s, b.wid), p = findPara(w, b.pid);
    var kb = (s.knowledgeBase || []).map(function (k) { return k.id + '《' + k.title + '》：' + k.summary; });
    var cb = (s.citationBank || []).filter(function (c) { return c.usedBy.indexOf(w.id) >= 0; }).map(function (c) { return c.id + ' ' + c.url + '（' + (c.fresh === 'stale' ? '已知过时' : '有效') + '）'; });
    return [
      { role: 'system', content: '你是事实核对引擎。找出段落中的数据/事实断言，对照给定资料判定：可佐证 / 有出入 / 无依据。只报结论，不改写原文，最多 5 条。' + jsonOnly('{"findings":[{"claim":"≤30字断言","verdict":"可佐证|有出入|无依据","basis":"≤50字依据（引用资料编号）"}]}') },
      { role: 'user', content: '段落：' + p.text + '\n\n知识库：\n' + (kb.join('\n') || '（空）') + '\n\n本篇引用源：\n' + (cb.join('\n') || '（空）') }
    ];
  },

  /* 读者报料结构化萃取 */
  extractTip: function (b) {
    if (!b.content) throw new Error('报料内容为空');
    return [
      { role: 'system', content: '你是素材结构化引擎。把读者口语化报料萃取为素材卡要素，并生成最多 3 条补充追问（读者可答可不答）。tags 从内容提炼 1–3 个中文短词。' + jsonOnly('{"fields":{"time":"时间或未提及","person":"人物/身份变化","conflict":"核心冲突点≤30字","detail":"含可验证细节|暂无可验证细节"},"tags":["标签"],"questions":["追问"]}') },
      { role: 'user', content: '读者报料原文：' + b.content }
    ];
  },

  /* 标题工坊：5 候选，每个带依据 */
  titleForge: function (b, s) {
    var w = findWork(s, b.wid);
    var sigs = s.demandSignals.filter(function (d) { return d.tags.some(function (t) { return w.tags.indexOf(t) >= 0; }); }).slice(0, 4)
      .map(function (d) { return '@' + d.from + '：' + d.text; });
    return [
      { role: 'system', content: '你是标题工坊。基于全文与读者需求信号生成 5 个中文标题候选，每个附一句依据（为什么这批读者会点开）。风格克制，不做标题党。' + jsonOnly('{"candidates":[{"title":"≤28字","why":"≤40字依据"}]}') },
      { role: 'user', content: '现标题：《' + w.title + '》\n全文：\n' + paraList(w) + '\n\n需求信号：\n' + (sigs.join('\n') || '（无）') }
    ];
  }
};

/* ---------- 输出解析与 schema 校验 ---------- */
function extractJSON(raw) {
  var t = String(raw || '').trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  var i = t.indexOf('{'), j = t.lastIndexOf('}');
  if (i < 0 || j <= i) throw new Error('输出中无 JSON 对象');
  return JSON.parse(t.slice(i, j + 1));
}

function isCheckItem(x) {
  return x && typeof x.pid === 'string' && typeof x.quote === 'string' && typeof x.issue === 'string'
    && ['C1', 'C2', 'C3', 'C4', 'C5'].indexOf(x.category) >= 0;
}

var PARSERS = {
  draftSection: function (o) {
    if (!o.text || typeof o.text !== 'string' || o.text.trim().length < 20) throw new Error('text 缺失或过短');
    return { text: o.text.trim().slice(0, 500) };
  },
  selfCheck: function (o) {
    var items = (o.items || []).filter(isCheckItem).slice(0, 8);
    return { items: items };
  },
  askParagraph: function (o) {
    var items = (o.items || []).filter(function (x) { return isCheckItem(x) && (x.category === 'C1' || x.category === 'C2'); }).slice(0, 3);
    return { items: items };
  },
  rephrase: function (o) {
    var c = (o.candidates || []).map(function (t) { return String(t).trim(); }).filter(function (t) { return t.length >= 10; }).slice(0, 2);
    if (!c.length) throw new Error('无有效候选');
    return { candidates: c };
  },
  factCheck: function (o) {
    var f = (o.findings || []).filter(function (x) { return x && x.claim && ['可佐证', '有出入', '无依据'].indexOf(x.verdict) >= 0; }).slice(0, 5);
    if (!f.length) throw new Error('无有效结论');
    return { findings: f };
  },
  extractTip: function (o) {
    if (!o.fields || !o.fields.conflict) throw new Error('fields 缺失');
    return { fields: { time: String(o.fields.time || '未提及'), person: String(o.fields.person || '待补充'), conflict: String(o.fields.conflict).slice(0, 40), detail: String(o.fields.detail || '暂无可验证细节') }, tags: (o.tags || []).map(String).slice(0, 3), questions: (o.questions || []).map(String).slice(0, 3) };
  },
  titleForge: function (o) {
    var c = (o.candidates || []).filter(function (x) { return x && x.title; }).map(function (x) { return { title: String(x.title).slice(0, 40), why: String(x.why || '').slice(0, 60) }; }).slice(0, 5);
    if (c.length < 2) throw new Error('候选不足');
    return { candidates: c };
  }
};

module.exports = {
  TASKS: Object.keys(BUILDERS),
  buildMessages: function (task, body, state) {
    if (!BUILDERS[task]) throw new Error('未知 AI 任务：' + task);
    return BUILDERS[task](body || {}, state);
  },
  parseOutput: function (task, raw) {
    if (!PARSERS[task]) throw new Error('未知 AI 任务：' + task);
    return PARSERS[task](extractJSON(raw));
  }
};
