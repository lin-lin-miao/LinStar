/* ===== data/modules/regenShield.js —— 再生护盾（护盾·自身） =====
 * 数值人工设定；levels 只写“与上一级的差异”，留空 = 继承上一级。
 */
export default {
  id: 'regenShield',
  nameKey: 'module.regenShield', // i18n -> 再生护盾 / Regenerative Shield
  glyph: '盾',
  category: 'shield',
  target: {
    kinds: ['self'],
    countMode: 'single',
    maxCount: 1,
  },
  effects: {
    type: [],
    shield_cap_bonus: 500, // 被动：提升自身护盾上限（安装即生效）
    shield_gain: 30,       // 每次激活为自身恢复护盾（乘船类护盾系数）
    cooldown_ticks: 5,
    energy_cost: 10,
  },
  maxLevel: 1, // 待用户填高阶等级后递增
  levels: [],
};
