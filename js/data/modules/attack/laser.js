/* ===== data/modules/laser.js —— 激光（攻击, C03） =====
 * 可逐渐增加伤害的武器：持续命中同一目标时，每次成功激活 +ramp_per_hit，
 * 从基础 damage 起涨、封顶 max_damage；切换目标/失去目标/模块能量不足 → 成长清零回到基础。
 * 满级 16（一般模块默认满级 16）。
 * 数值说明：【占位预填】——damage=初始伤害、ramp_per_hit=每击增量、max_damage=封顶，
 * cooldown_ticks=4(激光高频)、energy_cost 各级沿用 Lv1。待用户逐级人工调校。
 * levels 只写“与上一级的差异”，留空 = 继承上一级。
 */
export default {
  id: 'laser',
  nameKey: 'module.laser', // i18n -> 激光 / Laser
  name: '激光',
  icon: 'assets/img/激光.svg',
  category: 'attack',
  target: {
    kinds: ['enemy'],
    countMode: 'single',
    maxCount: 1,
  },
  effects: {
    type: ['beam'], // 特殊钩子标记（机制）
    damage: 2,          // Lv1 占位：初始单发伤害
    ramp_per_hit: 1,    // Lv1 占位：每击增量
    max_damage: 45,     // Lv1 占位：逐击增长封顶
    cooldown_ticks: 15,  // 高频（各级沿用 Lv1，如需随级变请在 levels 覆盖）
    energy_cost: 10,
  },
  maxLevel: 16,
  levels: [
    { level: 2, effects: { damage: 4, ramp_per_hit: 1, max_damage: 50 } },
    { level: 3, effects: { damage: 6, ramp_per_hit: 2, max_damage: 65 } },
    { level: 4, effects: { damage: 9, ramp_per_hit: 2, max_damage: 80 } },
    { level: 5, effects: { damage: 12, ramp_per_hit: 3, max_damage: 95 } },
    { level: 6, effects: { damage: 16, ramp_per_hit: 3, max_damage: 115 } },
    { level: 7, effects: { damage: 20, ramp_per_hit: 4, max_damage: 140 } },
    { level: 8, effects: { damage: 25, ramp_per_hit: 4, max_damage: 165 } },
    { level: 9, effects: { damage: 30, ramp_per_hit: 5, max_damage: 190 } },
    { level: 10, effects: { damage: 36, ramp_per_hit: 5, max_damage: 220 } },
    { level: 11, effects: { damage: 42, ramp_per_hit: 6, max_damage: 255 } },
    { level: 12, effects: { damage: 49, ramp_per_hit: 6, max_damage: 290 } },
    { level: 13, effects: { damage: 56, ramp_per_hit: 7, max_damage: 325 } },
    { level: 14, effects: { damage: 74, ramp_per_hit: 7, max_damage: 365 } },
    { level: 15, effects: { damage: 92, ramp_per_hit: 8, max_damage: 410 } },
    { level: 16, effects: { damage: 101, ramp_per_hit: 8, max_damage: 455 } },
  ],
};
