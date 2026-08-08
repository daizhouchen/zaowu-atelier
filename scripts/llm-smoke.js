/* ============================================================
 * 造物 · Atelier — LLM 连通性与 schema 自测 llm-smoke.js
 * 运行：node zaowu/scripts/llm-smoke.js
 * ① 连通性：live.json 模型发最小请求
 * ② schema：对 7 个 AI 任务逐个走「模板 → 大模型 → parseOutput」断言可解析
 * ============================================================ */
'use strict';
const path = require('path');
const prompts = require('../server/prompts.js');
const makeSeed = require('../shared/seed.js');

let cfg;
try { cfg = require(path.join(__dirname, '../server/live.json')); }
catch (e) { console.error('[llm-smoke] 未找到 server/live.json —— 无 Key 时产品走降级链路，本脚本仅用于真实链路自测'); process.exit(1); }

const model = cfg.model || cfg.draftModel;

async function chat(messages) {
  const res = await fetch(cfg.baseUrl.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
    body: JSON.stringify({ model, messages, temperature: 0.4, max_tokens: 1200 }),
    signal: AbortSignal.timeout(Number(cfg.timeoutMs) || 60000)
  });
  const j = await res.json();
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + JSON.stringify(j).slice(0, 160));
  return j.choices[0].message.content || '';
}

(async () => {
  let pass = 0, total = 0;
  /* ① 连通性 */
  total++;
  try {
    const t0 = Date.now();
    const out = await chat([{ role: 'user', content: '连通性测试：只回复两个字「正常」' }]);
    console.log('✓ 连通 ' + model + '：「' + out.trim().slice(0, 20) + '」（' + (Date.now() - t0) + 'ms）');
    pass++;
  } catch (e) { console.log('✗ 连通 ' + model + '：' + e.message); }

  /* ② 7 个任务的模板 + 解析闭环（对种子态 W-002 / MC 报料样例执行） */
  const state = makeSeed();
  const cases = {
    draftSection: { wid: 'W-002' },
    selfCheck: { wid: 'W-002' },
    askParagraph: { wid: 'W-002', pid: 'P3' },
    rephrase: { wid: 'W-002', pid: 'P1' },
    factCheck: { wid: 'W-002', pid: 'P1' },
    extractTip: { content: '我在县城开了三年打印店，去年开始帮人修旧照片，收入翻了一倍，这事你可以写。' },
    titleForge: { wid: 'W-002' }
  };
  for (const task of prompts.TASKS) {
    total++;
    const t0 = Date.now();
    try {
      const messages = prompts.buildMessages(task, cases[task], state);
      const out = prompts.parseOutput(task, await chat(messages));
      console.log('✓ ' + task + '：schema 解析通过 → ' + JSON.stringify(out).slice(0, 100) + '…（' + (Date.now() - t0) + 'ms）');
      pass++;
    } catch (e) { console.log('✗ ' + task + '：' + e.message); }
  }
  console.log('[llm-smoke] ' + pass + '/' + total + ' 通过');
  process.exit(pass === total ? 0 : 1);
})();
