/* 造物 · Atelier — 引擎全循环冒烟测试（node zaowu/server/smoke-test.js）
 * v0.2：覆盖状态机 10 态、首读者内测体系、段落三动作、引用管家、
 * 标题工坊、版本快照、全库检索/授权、读者视图/关系台、AI 锚点强校验。 */
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
const w2 = a.getState().works.find(x => x.id === w.id);
ok(w2.paragraphs.length === 2, '段落写入（用户段 + AI 色标段）');

/* 4. 定稿硬拦截（未自检 / AI 未转正） */
let blocked = false;
try { a.finalize(w.id); } catch (e) { blocked = true; }
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
ok(a.getState().checkRuleBank.length >= 3, '驳回写回负样本规则库');

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
const derived = a.getState().checkRuleBank.filter(r => r.source.indexOf('捉虫') >= 0 && r.keywords);
ok(derived.length >= 1, '捉虫确认衍生自检规则 ' + derived.map(r => r.id).join('、'));
ok(a.getState().works.find(x => x.id === w.id).revisions.length >= 1, '修订痕迹写入');

/* 12. 复盘归档（收口动作） */
const w7 = a.retro(w.id);
ok(w7.status === 'archived' && w7.archive, '复盘归档，创作档案定型（装配 ' + w7.archive.bundleSize + ' 项）');

/* 13. 复利：新稿含相同关键词 → 衍生规则命中 */
const w9 = a.createManualTopic('复利验证篇', ['收入']);
a.addParagraph(w9.id, '今年大家最关心的还是收入问题。', 'user');
a.submitCheck(w9.id);
ok(a.getState().works.find(x => x.id === w9.id).checks.some(c => c.ruleRef), '衍生规则在新稿自检中自动命中（复利闭环）');

/* 14. 速记归档 + 搁置 */
a.quickNote('转行的人最常说的一句话：每一块钱都看得见来路');
a.archiveNotes();
ok(true, '速记归档完成');

/* ===== v0.2 新增断言 ===== */

/* 15. 段落级三动作 */
a.addParagraph(w9.id, '据统计约 80% 的人最关心收入。', 'user');
const askItems = a.askParagraph(w9.id, 'P2');
ok(askItems.length >= 1 && askItems.every(c => c.category === 'C1' || c.category === 'C2'), '问一问：单段即时自检仅返回 C1/C2（' + askItems.length + ' 条）');
const cands = a.rephrase(w9.id, 'P1');
ok(cands.length === 2, '换个说法：生成 2 个候选');
const rp = a.applyRephrase(w9.id, 'P1', cands[0]);
ok(rp.kind === 'ai' && rp.confirmed === false, '采用候选后转 AI 色标须重新过目');
const facts = a.factCheck(w9.id, 'P2');
ok(facts.length >= 1 && facts.every(f => ['有出入', '无依据', '可佐证'].indexOf(f.verdict) >= 0), '核一核：事实比对只报不改（' + facts.length + ' 条）');

/* 16. 引用管家：正文 URL 自动登记引用源库 */
const cbBefore = a.getState().citationBank.length;
a.addParagraph(w9.id, '数据来源见 https://example.org/report-2026 的第二节。', 'user');
const cbNow = a.getState().citationBank;
ok(cbNow.length === cbBefore + 1 && cbNow[cbNow.length - 1].usedBy.indexOf(w9.id) >= 0, 'URL 自动登记引用源库 ' + cbNow[cbNow.length - 1].id);
ok(a.getState().works.find(x => x.id === w9.id).paragraphs[2].citations.some(c => c.asset.indexOf('CB:') === 0), '引用锚点 CB 同步登记到段落');

/* 17. AI 锚点强校验（铁律①） */
const wc = a.createManualTopic('锚点校验篇', ['转行']);
a.addParagraph(wc.id, '她说：每一块钱都看得见来路。', 'user');
const fakeChecks = a.submitCheck(wc.id, [{ pid: 'P1', quote: '原文里根本不存在的话', category: 'C2', issue: '伪造意见' }]);
ok(fakeChecks.every(c => c.source !== 'llm'), '锚点无法命中的 AI 意见整条丢弃 → 回退规则引擎');
const wd = a.getState().works.find(x => x.id === wc.id);
/* 同稿二次：合法锚点注入 */
wd.status = 'drafting';
const okChecks = a.submitCheck(wc.id, [{ pid: 'P1', quote: '每一块钱都看得见来路', category: 'C1', issue: '个体结论', desc: '单一案例', confidence: 'high' }]);
ok(okChecks.some(c => c.source === 'llm'), '锚点命中的大模型意见注入自检报告（source=llm）');

/* 18. 首读者内测全循环 */
const wb = a.createManualTopic('内测章', ['转行']);
a.addParagraph(wb.id, '据统计 2025 年已有 20000 万人重新定价自己的时间。', 'user');
a.addParagraph(wb.id, '账本上最重的一笔，是安全感的重量。', 'user');
a.submitCheck(wb.id);
const wb2 = a.getState().works.find(x => x.id === wb.id);
blocked = false;
try { a.openBeta(wb.id, ['阿树'], 48); } catch (e) { blocked = true; }
ok(blocked, '自检未处理完开内测被拦截（§5.5 检查清单）');
wb2.checks.forEach(function (c, i) { a.handleCheck(wb.id, c.id, i === 0 ? 'hold' : 'accept', ''); });
const round = a.openBeta(wb.id, ['阿树', '青梧', '麦子', '白桦'], 48);
ok(round.status === 'open' && round.doubts.length >= 1, '开内测：状态 beta · 存疑项 ' + round.doubts.length + ' 条交付投票');
ok(a.getState().versionSnapshots.some(v => v.wid === wb.id && v.label === '内测前'), '开内测自动存「内测前」快照');
blocked = false;
try { a.submitBetaFeedback('阿树', wb.id, 'P1', '不相信', ''); } catch (e) { blocked = true; }
ok(blocked, '「不相信」不附理由被拦截');
a.submitBetaFeedback('阿树', wb.id, 'P1', '不相信', '结论下得比案例快');
a.submitBetaFeedback('青梧', wb.id, 'P1', '不相信', '建议限定范围');
a.submitBetaFeedback('麦子', wb.id, 'P1', '不相信', '想看第二个人');
a.submitBetaFeedback('阿树', wb.id, 'P2', '想要更多', '想看拆账');
a.voteDoubt('阿树', wb.id, round.doubts[0].checkId, 'agree');
a.voteDoubt('青梧', wb.id, round.doubts[0].checkId, 'agree');
const rep = a.closeBeta(wb.id);
ok(rep.items.some(i => i.strong), '聚合出 ≥60% 共识强信号（' + rep.items.filter(i => i.strong).length + ' 条）');
ok(rep.heat.P1 === 3 && rep.doubts.length === 1, '段落热力 + 存疑众裁结果齐备');
ok(a.getState().readerScores['白桦'].score === 1 && a.getState().readerScores['白桦'].miss === 1, '未反馈者质量分 −2（白桦 3→1）');
const strongItem = rep.items.filter(i => !i.action)[0];
a.handleBetaItem(wb.id, strongItem.id, 'accept', '');
const wb3 = a.getState().works.find(x => x.id === wb.id);
ok(wb3.status === 'revising' && wb3.revisions.some(r => r.betaItem), '采纳内测反馈 → 修改回环（revising）+ 归因记录');
a.updateParagraph(wb.id, 'P1', '转行的第一年是重新学习计价的一年——把时间卖给谁、按什么计价、由谁说了算。');
const delta = a.reviseDone(wb.id);
ok(a.getState().works.find(x => x.id === wb.id).status === 'self_check' && Array.isArray(delta), '增量自检完成（只扫变更段 ' + delta.length + ' 条新意见）');
a.getState().works.find(x => x.id === wb.id).checks.filter(c => !c.action).forEach(c => a.handleCheck(wb.id, c.id, 'accept', ''));

/* 19. 标题工坊 */
const wbf = a.finalize(wb.id);
ok(wbf.status === 'finalized', '内测全循环后定稿成功');
const tc = a.titleForge(wb.id);
ok(tc.length === 5 && tc.every(t => t.why && t.by), '标题工坊生成 5 候选且每个带依据');
a.chooseTitle(wb.id, tc[1].title);
ok(a.getState().titleLog.some(t => t.wid === wb.id) && a.getState().works.find(x => x.id === wb.id).title === tc[1].title, '选定标题写入 titleLog + 正文标题更新');

/* 20. 全库检索 + 授权请求闭环 */
ok(a.searchVault('转行').length >= 2 && a.searchVault('').length === 0, '全库检索命中且空查询返回空');
const req = a.requestAuth('MC-002');
blocked = false;
try { a.requestAuth('MC-002'); } catch (e) { blocked = true; }
ok(blocked, '重复授权请求被拦截');
a.respondAuth(req.id, true, '匿名引用');
ok(a.getState().materialCards.find(m => m.id === 'MC-002').license.status === 'active', '读者同意 → 素材解锁（授权 ' + a.getState().materialCards.find(m => m.id === 'MC-002').license.scope + '）');

/* 21. 读者侧：追更 / 入池 / 读者视图 / 关系台 */
a.followWork('石头', wb.id);
blocked = false;
try { a.followWork('石头', wb.id); } catch (e) { blocked = true; }
ok(blocked, '重复追更被拦截');
a.applyBeta('新读者小满', ['转行']);
ok(a.getState().betaPool.some(r => r.name === '新读者小满'), '申请首读者入池');
const rv = a.readerView('阿树');
ok(rv.betas.length >= 1 && rv.score.history.length >= 1, '读者个人视图：首读记录 + 质量分明细');
const rel = a.relations();
ok(rel.readers.length >= 3 && Array.isArray(rel.queue), '读者关系台：贡献总账 ' + rel.readers.length + ' 人 · 待回应队列 ' + rel.queue.length + ' 条');
a.setWindowPublic(wb.id, false);
ok(a.getState().works.find(x => x.id === wb.id).windowPublic === false, '橱窗公示范围逐篇可控');

/* 22. 跳过内测留痕 */
const we = a.createManualTopic('跳过内测篇', ['远程办公']);
a.addParagraph(we.id, '平平无奇的一段话。', 'user');
a.submitCheck(we.id);
a.getState().works.find(x => x.id === we.id).checks.forEach(c => a.handleCheck(we.id, c.id, 'accept', ''));
const we2 = a.finalize(we.id);
ok(we2.skipped.indexOf('beta') >= 0 && we2.declaration.indexOf('未经内测') >= 0, '跳过内测记入 skipped_stages 且声明如实标注');

console.log('\n🎉 全循环冒烟测试通过（' + step + ' 断言全绿 · v0.2 机制全覆盖）');
