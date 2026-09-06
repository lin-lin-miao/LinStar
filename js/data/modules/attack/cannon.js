/* ===== data/modules/cannon.js —— 火炮（攻击） =====
 * 目标改为敌方单体 single×1（用户定稿，M2 重做）。
 * 满级 16（一般模块默认满级 16）。
 * 数值说明：目前为【占位预填】——damage 逐级递增，cooldown_ticks/energy_cost 沿用 Lv1，
 * 未经人工逐级调校，后续由用户调整（会覆盖此前的半成品 Lv2/Lv3 草稿）。
 * levels 只写“与上一级的差异”，留空 = 继承上一级。
 */
export default {
  id: 'cannon',
  nameKey: 'module.cannon', // i18n -> 火炮 / Cannon
  name: '火炮',
  icon: 'assets/img/火炮.svg',
  category: 'attack',
  target: {
    kinds: ['enemy'],
    countMode: 'single', // 用户定稿：单体
    maxCount: 1,
  },
  effects: {
    type: ['projectile'], // 特殊钩子标记（机制）
    damage: 14,           // Lv1 占位
    cooldown_ticks: 20,   // 各级沿用 Lv1（如需随级变请在 levels 覆盖）
    energy_cost: 6,
  },
  maxLevel: 16,
  levels: [
    { level: 2, effects: { damage: 17 } },
    { level: 3, effects: { damage: 20 } },
    { level: 4, effects: { damage: 23 } },
    { level: 5, effects: { damage: 26 } },
    { level: 6, effects: { damage: 30 } },
    { level: 7, effects: { damage: 34 } },
    { level: 8, effects: { damage: 38 } },
    { level: 9, effects: { damage: 42 } },
    { level: 10, effects: { damage: 46 } },
    { level: 11, effects: { damage: 51 } },
    { level: 12, effects: { damage: 56 } },
    { level: 13, effects: { damage: 61 } },
    { level: 14, effects: { damage: 66 } },
    { level: 15, effects: { damage: 72 } },
    { level: 16, effects: { damage: 78 } },
  ],
};
