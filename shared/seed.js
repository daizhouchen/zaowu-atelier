/* ============================================================
 * 造物 · Atelier — 种子数据 seed.js
 * 「老周」小铺的初始状态：让 demo 开箱即有内容可看，
 * 同时留出可交互空间（开放提议、待裁决捉虫、可报料主题）。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZaowuSeed = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return function makeSeed() {
    return {
      creator: { name: '老周', shopName: '老周的小铺', bio: '职场观察 · 非虚构 · 不定期更新。这间铺子的每篇文章，都有读者参与创作。' },
      counters: {},
      styleProfile: {
        id: 'SP-001',
        banned: ['我们必须认识到', '大家应该', '不难发现', '众所周知'],
        habits: ['短句优先', '引语开场', '克制形容词', '结尾留白不说教']
      },
      knowledgeBase: [
        { id: 'KB-001', title: '2026 灵活就业研究报告摘要', summary: '灵活就业人口规模、结构与小微经营占比。', tags: ['转行', '收入', '手艺'] },
        { id: 'KB-002', title: '远程办公效率研究合集', summary: '混合办公对产出与幸福感的影响 meta 分析。', tags: ['远程办公'] }
      ],
      materialBank: [
        { id: 'MB-001', text: '在县城开五金店的表哥说：网上学不会的活，才轮得到我们。', tags: ['手艺', '中年'], from: '手动收藏' }
      ],
      noteInbox: [],
      topicBacklog: [
        { id: 'TB-001', title: '手艺经济：慢生意的账本', reason: '素材不足，等真实案例', tags: ['手艺', '收入'], shelvedAt: '2025-11-02 10:00', status: 'shelved' },
        { id: 'TB-002', title: '县城中年', reason: '缺少亲历者报料', tags: ['中年'], shelvedAt: '2026-04-18 10:00', status: 'shelved' }
      ],
      checkRuleBank: [
        { id: 'CR-001', rule: '涉及「收入」数据须核对统计口径与年份', source: '捉虫 BG-000（历史）', keywords: ['收入'], hits: 3 },
        { id: 'CR-002', rule: '负样本：亲历叙事类文章中单一案例可作引子（老周认为可接受）', source: '驳回', keywords: null, hits: 0, negative: true }
      ],
      materialCards: [
        {
          id: 'MC-001', provider: '小鹿',
          content: '我去年从大厂转行做手艺人，开了间木工坊。收入降了四成，但每一块钱都看得见来路。这段经历你可以写。',
          fields: { time: '2025', person: '互联网增长 → 木工坊主理人', conflict: '收入降四成 vs 每一块钱看得见来路', detail: '含可验证细节' },
          license: { scope: '具名引用', status: 'active' }, tags: ['转行', '手艺', '收入'], ts: '2026-07-28 09:00', status: 'available'
        },
        {
          id: 'MC-002', provider: '阿树',
          content: '我把辞职信写成了三行诗，第二天就去摆摊卖手冲咖啡了。',
          fields: { time: '未提及', person: '待补充', conflict: '辞职与摆摊的落差', detail: '暂无可验证细节' },
          license: { scope: '仅背景参考', status: 'revoked' }, tags: ['转行', '辞职'], ts: '2026-07-20 09:00', status: 'available'
        }
      ],
      demandSignals: [
        { id: 'DS-001', from: '青梧', text: '想看真实的大厂转行故事，别是成功学那种。', tags: ['转行'], ts: '2026-07-22 10:00' },
        { id: 'DS-002', from: '麦子', text: '转行之后收入到底怎么样？想看点实在的。', tags: ['转行', '收入'], ts: '2026-07-24 10:00' },
        { id: 'DS-003', from: '白桦', text: '手艺人真的能养活自己吗，求写。', tags: ['手艺', '收入'], ts: '2026-07-25 10:00' },
        { id: 'DS-004', from: '阿澈', text: '远程办公久了会不会丧失社交能力？', tags: ['远程办公'], ts: '2026-07-26 10:00' }
      ],
      bugReports: [],
      proposals: [],
      works: [
        {
          id: 'W-001', title: '远程办公三年，我后悔了', status: 'drafting', tags: ['远程办公'],
          proposalId: null, topicOrigin: { title: '远程办公三年，我后悔了', rationale: '创作者手动建题', evidenceRefs: [] },
          paragraphs: [], bundle: [], checks: [], skipped: [], credits: [], revisions: [],
          timeline: { idea: '2026-08-01 10:00', drafting: '2026-08-01 10:00' }, declaration: '', retro: null
        }
      ],
      logs: [
        { ts: '2026-08-05 09:00', kind: 'Writeback', detail: '种子数据载入：造物 · Atelier demo 开张，欢迎来到老周的小铺。', valid: true }
      ]
    };
  };
});
