/* ===== data/modules/concussionCannon.js —— 震荡炮（攻击） =====
 * 与火炮相似：敌方单体直射（countMode single×1），但单体数值比火炮低，
 * 代价换来的机制是【爆炸范围】——命中主目标时对其所在队列（视觉顺序）前后各
 * blast_range 个位置内的存活单位同时造成同额范围伤害（走引擎 blast_range 词条）。
 * 数值说明：【占位预填】单体 damage 逐级递增且整体低于同级的火炮；blast_range/冷却/能耗由用户人工调校。
 */
export default {
  id: 'concussionCannon',
  nameKey: 'module.concussionCannon', // i18n -> 震荡炮 / Concussion Cannon
  name: '震荡炮',
  icon: 'assets/img/震荡炮.svg',
  category: 'attack',
  target: {
    kinds: ['enemy'],
    countMode: 'single',
    maxCount: 1,
  },
  effects: {
    type: ['projectile'], // 特殊钩子标记（机制）
    damage: 9,            // Lv1 占位：单体数值低于同级火炮
    blast_range: 3,       // 爆炸范围：队列前后各 1 个位置的存活单位同时受伤害
    cooldown_ticks: 30,   // 各级沿用 Lv1（如需随级变请在 levels 覆盖）
    energy_cost: 8,
  },
  maxLevel: 16,
  levels: [
    { level: 2, effects: { damage: 11 } },
    { level: 3, effects: { damage: 13 } },
    { level: 4, effects: { damage: 15 } },
    { level: 5, effects: { damage: 18 } },
    { level: 6, effects: { damage: 21 } },
    { level: 7, effects: { damage: 24 } },
    { level: 8, effects: { damage: 27 } },
    { level: 9, effects: { damage: 30 } },
    { level: 10, effects: { damage: 34 } },
    { level: 11, effects: { damage: 38 } },
    { level: 12, effects: { damage: 42 } },
    { level: 13, effects: { damage: 46 } },
    { level: 14, effects: { damage: 51 } },
    { level: 15, effects: { damage: 56 } },
    { level: 16, effects: { damage: 61 } },
  ],
};
