/* ============================================================
 * 造物 · Atelier — 后端 server.js
 * Express REST：把 shared/engine.js 的编排逻辑暴露为 API，
 * 每次写操作落盘 data.json（文件持久化）。
 * AI 代理：POST /api/ai/:task —— 读取 live.json（不入库），
 * prompt 模板 → 大模型 → 强 schema 解析 → 引擎锚点校验注入；
 * 任一环节失败自动回退规则引擎（降级链路），保证无 Key 也全功能可用。
 * 启动：cd server && npm install && npm start → http://localhost:8787
 * ============================================================ */
const path = require('path');
const fs = require('fs');
const express = require('express');
const { Atelier } = require('../shared/engine.js');
const makeSeed = require('../shared/seed.js');
const prompts = require('./prompts.js');

const PORT = process.env.PORT || 8787;
const DATA_FILE = path.join(__dirname, 'data.json');

/* ---------- LLM 配置（live.json 本地私有，绝不上传） ---------- */
let live = null;
try {
  live = JSON.parse(fs.readFileSync(path.join(__dirname, 'live.json'), 'utf-8'));
  console.log('[zaowu] live.json 已加载 · 真实大模型链路启用（' + (live.model || live.draftModel) + '）');
} catch (e) { console.log('[zaowu] 未配置 live.json · AI 走规则引擎降级链路'); }

async function callLLM(messages) {
  const model = live.model || live.draftModel;
  const res = await fetch(live.baseUrl.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + live.apiKey },
    body: JSON.stringify({ model, messages, temperature: 0.4, max_tokens: 1200 }),
    signal: AbortSignal.timeout(Number(live.timeoutMs) || 60000)
  });
  const j = await res.json();
  if (!res.ok) throw new Error('LLM HTTP ' + res.status + '：' + JSON.stringify(j).slice(0, 120));
  return j.choices[0].message.content || '';
}

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (e) { console.warn('[zaowu] data.json 损坏，回退种子数据：', e.message); }
  return makeSeed();
}

let atelier = new Atelier(load());
const save = () => fs.writeFile(DATA_FILE, JSON.stringify(atelier.getState(), null, 2), (e) => { if (e) console.error('[zaowu] 持久化失败', e); });

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => { res.header('Access-Control-Allow-Origin', '*'); res.header('Access-Control-Allow-Headers', 'Content-Type'); res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS'); if (req.method === 'OPTIONS') return res.sendStatus(204); next(); });

/* 读接口 */
app.get('/api/health', (req, res) => res.json({ ok: true, mode: 'server', engine: 'shared/engine.js', ai: !!live, aiModel: live ? (live.model || live.draftModel) : null }));
app.get('/api/state', (req, res) => res.json(atelier.getState()));
app.get('/api/desk', (req, res) => res.json(atelier.desk()));
app.get('/api/kanban', (req, res) => res.json(atelier.kanban()));
app.get('/api/shop', (req, res) => res.json(atelier.shopView()));

/* 写接口：统一 POST /api/action */
const ACTIONS = {
  // 创作者 · 流水线
  confirmProposal: (b) => atelier.confirmProposal(b.pid),
  rejectProposal: (b) => atelier.rejectProposal(b.pid, b.reason),
  createManualTopic: (b) => atelier.createManualTopic(b.title, b.tags),
  assemble: (b) => atelier.assemble(b.wid),
  addParagraph: (b) => atelier.addParagraph(b.wid, b.text, b.kind),
  updateParagraph: (b) => atelier.updateParagraph(b.wid, b.pid, b.text),
  deleteParagraph: (b) => atelier.deleteParagraph(b.wid, b.pid),
  renameWork: (b) => atelier.renameWork(b.wid, b.title),
  citeAsset: (b) => atelier.citeAsset(b.wid, b.pid, b.assetRef),
  confirmAI: (b) => atelier.confirmAI(b.wid, b.pid),
  submitCheck: (b) => atelier.submitCheck(b.wid),
  handleCheck: (b) => atelier.handleCheck(b.wid, b.cid, b.action, b.reason),
  finalize: (b) => atelier.finalize(b.wid),
  publish: (b) => atelier.publish(b.wid),
  retro: (b) => atelier.retro(b.wid),
  shelve: (b) => atelier.shelve(b.wid, b.reason),
  quickNote: (b) => atelier.quickNote(b.text),
  archiveNotes: () => atelier.archiveNotes(),
  // 创作者 · 内测体系（批次 B）
  betaRecommend: (b) => atelier.betaRecommend(b.wid),
  openBeta: (b) => atelier.openBeta(b.wid, b.readers, b.hours),
  closeBeta: (b) => atelier.closeBeta(b.wid),
  handleBetaItem: (b) => atelier.handleBetaItem(b.wid, b.itemId, b.action, b.reason),
  reviseDone: (b) => atelier.reviseDone(b.wid),
  // 创作者 · 辅助功能族（批次 C）
  titleForge: (b) => atelier.titleForge(b.wid, b.aiCandidates),
  chooseTitle: (b) => atelier.chooseTitle(b.wid, b.title),
  askParagraph: (b) => atelier.askParagraph(b.wid, b.pid, b.aiItems),
  rephrase: (b) => atelier.rephrase(b.wid, b.pid, b.aiCands),
  applyRephrase: (b) => atelier.applyRephrase(b.wid, b.pid, b.text),
  factCheck: (b) => atelier.factCheck(b.wid, b.pid, b.aiFindings),
  searchVault: (b) => atelier.searchVault(b.query),
  requestAuth: (b) => atelier.requestAuth(b.cardId),
  setWindowPublic: (b) => atelier.setWindowPublic(b.wid, b.isPublic),
  // 读者 · 共创
  submitTip: (b) => atelier.submitTip(b.reader, b.content, b.scope, b.aiExtract),
  revokeMaterial: (b) => atelier.revokeMaterial(b.cardId),
  addSignal: (b) => atelier.addSignal(b.from, b.text, b.tags),
  submitBug: (b) => atelier.submitBug(b.reader, b.wid, b.quote, b.type, b.evidence),
  adjudicateBug: (b) => atelier.adjudicateBug(b.bid, b.verdict, b.note),
  // 读者 · 内测/关系（批次 B/D）
  submitBetaFeedback: (b) => atelier.submitBetaFeedback(b.reader, b.wid, b.pid, b.type, b.note),
  voteDoubt: (b) => atelier.voteDoubt(b.reader, b.wid, b.checkId, b.vote),
  followWork: (b) => atelier.followWork(b.reader, b.wid),
  applyBeta: (b) => atelier.applyBeta(b.reader, b.tags),
  respondAuth: (b) => atelier.respondAuth(b.reqId, b.agree, b.scope),
  readerView: (b) => atelier.readerView(b.name),
  relations: () => atelier.relations(),
  reset: () => { atelier = new Atelier(makeSeed()); return { ok: true }; }
};

/* ---------- AI 代理：模板 → LLM → schema 解析 → 引擎注入（锚点强校验） ---------- */
const AI_APPLY = {
  draftSection: (b, out) => {
    const p = atelier.addParagraph(b.wid, out.text, 'ai');
    atelier.log('Propose', b.wid + ' · 大模型起草段落 ' + p.id + '（扎根装配包，待过目转正）', true);
    return { paragraph: p, by: 'llm' };
  },
  selfCheck: (b, out) => ({ checks: atelier.submitCheck(b.wid, out.items), by: 'llm' }),
  askParagraph: (b, out) => ({ items: atelier.askParagraph(b.wid, b.pid, out.items), by: 'llm' }),
  rephrase: (b, out) => ({ candidates: atelier.rephrase(b.wid, b.pid, out.candidates), by: 'llm' }),
  factCheck: (b, out) => ({ findings: atelier.factCheck(b.wid, b.pid, out.findings), by: 'llm' }),
  extractTip: (b, out) => ({ card: atelier.submitTip(b.reader, b.content, b.scope, out), by: 'llm' }),
  titleForge: (b, out) => ({ candidates: atelier.titleForge(b.wid, out.candidates), by: 'llm' })
};
/* 各 task 的降级执行（规则引擎），保证无 Key / LLM 失败时同构返回 */
const AI_FALLBACK = {
  draftSection: (b) => {
    const p = atelier.addParagraph(b.wid, '（规则引擎草段）围绕本篇装配包中的素材续写：把亲历者的细节放在段首，让数据只作旁证——这一段等待创作者亲笔改写。', 'ai');
    return { paragraph: p, by: 'rules' };
  },
  selfCheck: (b) => ({ checks: atelier.submitCheck(b.wid), by: 'rules' }),
  askParagraph: (b) => ({ items: atelier.askParagraph(b.wid, b.pid), by: 'rules' }),
  rephrase: (b) => ({ candidates: atelier.rephrase(b.wid, b.pid), by: 'rules' }),
  factCheck: (b) => ({ findings: atelier.factCheck(b.wid, b.pid), by: 'rules' }),
  extractTip: (b) => ({ card: atelier.submitTip(b.reader, b.content, b.scope), by: 'rules' }),
  titleForge: (b) => ({ candidates: atelier.titleForge(b.wid), by: 'rules' })
};

app.post('/api/ai/:task', async (req, res) => {
  const task = req.params.task, b = req.body || {};
  if (!AI_APPLY[task]) return res.status(404).json({ error: '未知 AI 任务：' + task });
  try {
    let out = null;
    if (live) {
      try {
        const messages = prompts.buildMessages(task, b, atelier.getState());
        out = prompts.parseOutput(task, await callLLM(messages));
      } catch (e) {
        atelier.log('Propose', 'AI 任务 ' + task + ' 大模型链路失败（' + String(e.message).slice(0, 60) + '）→ 回退规则引擎', false);
        out = null;
      }
    }
    const data = out ? AI_APPLY[task](b, out) : AI_FALLBACK[task](b);
    save();
    res.json({ ok: true, data });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/action/:name', (req, res) => {
  const fn = ACTIONS[req.params.name];
  if (!fn) return res.status(404).json({ error: '未知动作：' + req.params.name });
  try {
    const out = fn(req.body || {});
    save();
    res.json({ ok: true, data: out });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/* 静态托管：本地全栈体验入口 http://localhost:8787 */
app.use('/app', express.static(path.join(__dirname, '..', 'app')));
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));
app.use('/proto', express.static(path.join(__dirname, '..', 'proto')));
app.use('/', express.static(path.join(__dirname, '..'), { index: 'index.html' }));

app.listen(PORT, () => console.log('[zaowu] 造物后端已启动：http://localhost:' + PORT + '（前端 /app，引擎 shared/engine.js，持久化 data.json）'));
