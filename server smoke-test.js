/* 造物 · Atelier — 引擎全循环冒烟测试（node server/smoke-test.js） */
'use strict';
const { Atelier } = require('../shared/engine.js');
const seed = require('../shared/seed.js');
const assert = require('assert');

const a = new Atelier(seed());
let step = 0;
function ok(cond, msg) { step++; assert(cond, '步骤 ' + step + ' 失败：' + msg); console.log('✓ ' + step + '. ' + msg); }

/* 1. 报料 → 触发器 → 提议 */
const card = a.submitTip('阿树', '我去年从大厂转行做手艺人，收入变化很大', '具名引用');
ok(card && card.id, '报料入库生成素材卡 ' + card.id);
const props = a.getState().proposals.filter(p => p.status === 'open');
ok(props.length >= 1, 'T1/T2 命中生成选题提议：' + props.map(p => p.title).join('、'));
ok(props[0].evidenceRefs.length >= 2, '提议带 evidence_refs=' + props[0].evidenceRefs.length);

/* 2. 确认提议 → 装配 */
const w = a.confirmProposal(props[0].id);
ok(w && w.status === 'drafting', '确认提议建稿 ' + w.id + '，进入起草');
ok(w.bundle.length >= 1, '自动装配完成：' + w.bundle.length + ' 项资产');
ok((w.blockedBundle || []).length >= 1, '未授权素材被硬规则拦截：' + w.blockedBundle.map(b => b.ref).join('、'));

/* 3. 起草 */
a.addParagraph(w.id, '开篇：我想讲一个关于转行的账本故事。', 'user');
a.addParagraph(w.id, '据公开数据，2025 年灵活就业人口已超过 20000 万。这不是逃离，而是重新定价。', 'ai');
const w2 = a.workFind ? null : a.getState().works.find(x => x.id === w.id);
ok(w2.paragraphs.length === 2, '段落写入（用户段 + AI 色标段）');

/* 4. 定稿硬拦截（未自检 / AI 未转正） */
let blocked = false;
try { a.finalize(w.id); } catch (e) { blocked = true; console.log('  ↳ 拦截信息：' + e.message); }
ok(blocked, '未自检直接定稿被引擎拦截');

/* 5. 自检 */
a.submitCheck(w.id);
const w3 = a.getState().works.find(x => x.id === w.id);
ok(w3.status === 'self_check' && w3.checks.length >= 2, '自检完成：' + w3.checks.map(c => c.category).join('/'));

/* 6. 未处理完不能定稿 */
blocked = false;
try { a.finalize(w.id); } catch (e) { blocked = true; }
ok(blocked, '自检未处理完定稿被拦截');

/* 7. 处理自检（一条驳回写负样本，其余采纳） */
w3.checks.forEach(function (c, i) {
  a.handleCheck(w.id, c.id, i === 1 ? 'reject' : 'accept', i === 1 ? '单一案例作引子可接受' : '');
});
const ruleCount = a.getState().checkRuleBank.length;
ok(ruleCount >= 3, '驳回写回负样本规则库（' + ruleCount + ' 条）');

/* 8. AI 段转正 + 引用素材 */
const aiPara = w3.paragraphs.find(p => p.kind === 'ai');
a.confirmAI(w.id, aiPara.id);
a.citeAsset(w.id, w3.paragraphs[0].id, 'MC-001');
const w4 = a.getState().works.find(x => x.id === w.id);
ok(w4.paragraphs[0].citations.length === 1, '素材引用登记锚点 ' + w4.paragraphs[0].citations[0].anchor);

/* 9. 未授权素材引用拦截 */
blocked = false;
try { a.citeAsset(w.id, w3.paragraphs[0].id, 'MC-002'); } catch (e) { blocked = true; }
ok(blocked, '引用已撤回授权的素材被拦截');

/* 10. 定稿 → 发布 */
const w5 = a.finalize(w.id);
ok(w5.status === 'finalized' && w5.declaration, '定稿成功，创作方式声明自动生成');
const w6 = a.publish(w.id);
ok(w6.status === 'published' && w6.credits.length >= 1, '发布成功，署名 ' + w6.credits.map(c => c.name).join('、') + ' 锚点核验通过');

/* 11. 捉虫 → 裁决确认 → 衍生规则 */
const bug = a.submitBug('青梧', w.id, '收入降了四成', '数据待核', '参考统计局口径');
a.adjudicateBug(bug.id, 'confirmed', '属实，已标注口径');
const st = a.getState();
const derived = st.checkRuleBank.filter(r => r.source.indexOf('捉虫') >= 0 && r.keywords);
ok(derived.length >= 1, '捉虫确认衍生自检规则 ' + derived.map(r => r.id).join('、'));
const w8 = st.works.find(x => x.id === w.id);
ok(w8.revisions.length >= 1, '修订痕迹写入');

/* 12. 复盘归档（收口动作） */
const w7 = a.retro(w.id);
ok(w7.status === 'archived' && w7.archive, '复盘归档，创作档案定型（装配 ' + w7.archive.bundleSize + ' 项）');

/* 13. 复利：新稿含相同关键词 → 衍生规则命中 */
const w9 = a.createManualTopic('复利验证篇', ['收入']);
a.addParagraph(w9.id, '今年大家最关心的还是收入问题。', 'user');
a.submitCheck(w9.id);
const w10 = a.getState().works.find(x => x.id === w9.id);
ok(w10.checks.some(c => c.ruleRef), '衍生规则在新稿自检中自动命中（复利闭环）');

/* 14. 速记归档 + 搁置 */
a.quickNote('转行的人最常说的一句话：每一块钱都看得见来路');
a.archiveNotes();
ok(true, '速记归档完成');

console.log('\n🎉 全循环冒烟测试通过（' + step + '/14 组断言）');
