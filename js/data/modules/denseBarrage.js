/* ===== data/modules/denseBarrage.js —— 密集弹幕（攻击, C05） =====
 * 敌方单体伤害；但伤害随“当前场上敌方存活数”提升——
 * type 钩子 ramp_by_enemy_count：单发伤害 = 基础 damage + ramp_per_hit × 当前敌方存活数，
 * 有 max_damage 则封顶（不随命中次数累积；敌方阵亡越多单发越低）。
 * 满级 16（一般模块默认满级 16）。
 * 数值说明：【占位预填】——damage=基础单发、ramp_per_hit=每名敌方提供的增量、max_damage=封顶，
 * cooldown_ticks/energy_cost 各级沿用 Lv1。待用户逐级人工调校。
 */
export default {
  id: 'denseBarrage',
  nameKey: 'module.denseBarrage', // i18n -> 密集弹幕 / Dense Barrage
  name: '密集弹幕',
  icon: 'assets/img/密集弹幕.svg',
  category: 'attack',
  target: {
    kinds: ['enemy'],
    countMode: 'single', // 单体
    maxCount: 1,
  },
  effects: {
    type: ['projectile', 'ramp_by_enemy_count'], // 伤害随场上敌方存活数提升（封顶 max_damage）
    damage: 6,          // Lv1 占位：基础单发伤害
    ramp_per_hit: 2,    // Lv1 占位：每名敌方提供的增量
    max_damage: 30,     // Lv1 占位：封顶
    cooldown_ticks: 20, // 各级沿用 Lv1
    energy_cost: 4,     // 各级沿用 Lv1
  },
  maxLevel: 16,
  levels: [
    { level: 2, effects: { damage: 7, ramp_per_hit: 5, max_damage: 36 } },
    { level: 3, effects: { damage: 8, ramp_per_hit: 5, max_damage: 46 } },
    { level: 4, effects: { damage: 9, ramp_per_hit: 5, max_damage: 56 } },
    { level: 5, effects: { damage: 10, ramp_per_hit: 8, max_damage: 70 } },
    { level: 6, effects: { damage: 12, ramp_per_hit: 8, max_damage: 84 } },
    { level: 7, effects: { damage: 14, ramp_per_hit: 8, max_damage: 100 } },
    { level: 8, effects: { damage: 16, ramp_per_hit: 12, max_damage: 116 } },
    { level: 9, effects: { damage: 18, ramp_per_hit: 12, max_damage: 140 } },
    { level: 10, effects: { damage: 21, ramp_per_hit: 15, max_damage: 164 } },
    { level: 11, effects: { damage: 24, ramp_per_hit: 18, max_damage: 192 } },
    { level: 12, effects: { damage: 27, ramp_per_hit: 20, max_damage: 224 } },
    { level: 13, effects: { damage: 30, ramp_per_hit: 22, max_damage: 260 } },
    { level: 14, effects: { damage: 34, ramp_per_hit: 24, max_damage: 300 } },
    { level: 15, effects: { damage: 38, ramp_per_hit: 26, max_damage: 340 } },
    { level: 16, effects: { damage: 42, ramp_per_hit: 28, max_damage: 380 } },
  ],
};
