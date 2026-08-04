/* ============================================================
 * 造物 · Atelier — 后端 server.js
 * Express REST：把 shared/engine.js 的编排逻辑暴露为 API，
 * 每次写操作落盘 data.json（文件持久化，demo 级别）。
 * 启动：cd server && npm install && npm start → http://localhost:8787
 * ============================================================ */
const path = require('path');
const fs = require('fs');
const express = require('express');
const { Atelier } = require('../shared/engine.js');
const makeSeed = require('../shared/seed.js');

const PORT = process.env.PORT || 8787;
const DATA_FILE = path.join(__dirname, 'data.json');

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
app.get('/api/health', (req, res) => res.json({ ok: true, mode: 'server', engine: 'shared/engine.js' }));
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
  // 读者 · 共创
  submitTip: (b) => atelier.submitTip(b.reader, b.content, b.scope),
  revokeMaterial: (b) => atelier.revokeMaterial(b.cardId),
  addSignal: (b) => atelier.addSignal(b.from, b.text, b.tags),
  submitBug: (b) => atelier.submitBug(b.reader, b.wid, b.quote, b.type, b.evidence),
  adjudicateBug: (b) => atelier.adjudicateBug(b.bid, b.verdict, b.note),
  reset: () => { atelier = new Atelier(makeSeed()); return { ok: true }; }
};

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
