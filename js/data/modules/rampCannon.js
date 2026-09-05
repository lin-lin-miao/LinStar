/* ===== data/modules/rampCannon.js —— rampCannon（攻击·逐步伤害测试） =====
 * 数值人工设定；levels 只写“与上一级的差异”，留空 = 继承上一级。
 * 现数值：damage5 / max_damage120 / ramp_per_hit1 / cd5 / 能5（用户现值）。
 */
export default {
  id: 'rampCannon',
  nameKey: 'module.cannon', // 复用火炮名
  glyph: '炮',
  category: 'attack',
  target: {
    kinds: ['enemy'],
    countMode: 'single',
    maxCount: 1,
  },
  effects: {
    type: [],
    damage: 5,
    max_damage: 120,
    ramp_per_hit: 1,
    cooldown_ticks: 5,
    energy_cost: 5,
  },
  maxLevel: 1, // 待用户填高阶等级后递增
  levels: [],
};
