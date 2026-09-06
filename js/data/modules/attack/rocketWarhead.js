/* ===== data/modules/rocketWarhead.js —— 自毁弹药（内部 · 一次性 · 随 火箭发射器 携带） =====
 * 功能：火箭发射器召唤出的火箭所携带的"一次性弹药"模块。
 *   - type 含 cool_first：部署即进入冷却（以 cooldown_ticks 为"引信"），到点才引爆（不会先触发一次）。
 *   - 引爆时：对【锁定目标】造成 damage 大量伤害；随后 self_destruct_damage（负值）扣除自身全部生命
 *     令火箭自毁。锁定目标即使已阵亡也照常引爆（自毁词条始终触发）。
 *   - self_destruct_damage 为数值词条：对所属单位自身血量"正加负减"（与 hp_target 同套语义，可致死）。
 * picker:false → 内部模块，不进入演练编队的可选项。
 * 数值说明：【占位预填】damage/引信由用户逐级人工调校。
 */
export default {
  id: 'rocketWarhead',
  nameKey: 'module.rocketWarhead', // i18n -> 火箭爆炸（内部，通常只作为火箭的携带模组出现）
  name: '火箭爆炸',
  icon: 'assets/img/爆炸.svg',
  picker: false,                    // 不出现在演练编队可选模块清单
  category: 'attack',
  target: { kinds: ['enemy'], countMode: 'single', maxCount: 1 },
  effects: {
    type: ['cool_first'],         // cool_first：部署即进入冷却（引信倒计时），不先触发；到点引爆并自毁
    damage: 120,                   // Lv1 占位：命中锁定目标的大量伤害
    self_destruct_damage: -1000000, // 触发后扣除自身全部生命（自毁）；占位大负值保证死亡
    cooldown_ticks: 60,            // 引信时长(tick)占位：部署后 3s 引爆
    energy_cost: 0,                // 自毁不耗能
  },
  maxLevel: 16,
  levels: [
    { level: 2, effects: { damage: 150 } },
    { level: 3, effects: { damage: 180 } },
    { level: 4, effects: { damage: 220 } },
    { level: 5, effects: { damage: 260, cooldown_ticks: 55 } },
    { level: 6, effects: { damage: 310 } },
    { level: 7, effects: { damage: 360 } },
    { level: 8, effects: { damage: 420 } },
    { level: 9, effects: { damage: 480 } },
    { level: 10, effects: { damage: 560, cooldown_ticks: 50 } },
    { level: 11, effects: { damage: 640 } },
    { level: 12, effects: { damage: 730 } },
    { level: 13, effects: { damage: 820 } },
    { level: 14, effects: { damage: 940 } },
    { level: 15, effects: { damage: 1060 } },
    { level: 16, effects: { damage: 1200, cooldown_ticks: 45 } },
  ],
};
