/* ===== data/modules/dualLaser.js —— 双向激光（攻击, C04） =====
 * 可指定两个敌方目标（multi，maxCount 2）；与激光类似为逐击增伤(ramp_per_hit)武器，
 * 单目标基础伤害比激光稍低，但成长属性高于激光。
 * type 钩子 `ramp_full`：仅当“目标选择的两个槽位都有目标”才逐击增伤；
 *   只命中 1 个目标时不成长、伤害维持基础。
 * 从基础 damage 起涨封顶 max_damage；目标组改变/能量不足 → 清零回到基础。
 * 满级 16（一般模块默认满级 16）。
 * 数值说明：【占位预填】——damage/ramp_per_hit/max_damage 待用户逐级人工调校；
 * cooldown_ticks/energy_cost 各级沿用 Lv1。
 */
export default {
  id: 'dualLaser',
  /* ★ M3 基地侧字段【占位预填 · 待用户调校】——M3a 只铺字段，读取逻辑属 M3b（船坞）/ M3e（研究站）。
   * · `levels[]` 仍是【战斗数值】的唯一逐级表（由 entities/module.js 解析 effects/target）；
   *   下列基地侧字段自带**独立逐级表**（数组项 { level, ... }，未列出该等级则沿用上一项）；
   * · 缺省即视为「无消耗 / 无门槛」：installCost / removeCost / upgradeCost / scienceCost 缺失＝免费，
   *   blueprint 缺失＝无需蓝图；资源键见 data/resources.js（缺失键视为 0）。 */
  installCost: { energy: 0, ore: 0, alloy: 0, rare: 0 },
  removeCost: { energy: 0, ore: 0, alloy: 0, rare: 0 },
  upgradeCost: [{ level: 2, cost: { energy: 0, ore: 0, alloy: 0, rare: 0 } }],
  blueprint: [{ level: 1, count: 0 }],
  scienceCost: [{ level: 2, cost: { science: 0 } }],
  nameKey: 'module.dualLaser', // i18n -> 双向激光 / Twin Laser
  icon: 'assets/img/双向激光.svg',
  name: '双向激光',
  category: 'attack',
  target: {
    kinds: ['enemy'],
    countMode: 'multi', // 可手动指定两个目标
    maxCount: 2,
  },
  effects: {
    type: ['beam', 'ramp_full'], // ramp_full：两目标都命中才逐击增伤
    damage: 1,          // Lv1 占位：每目标初始伤害（略低于激光）
    ramp_per_hit: 2,    // Lv1 占位：每击增量（高于激光）
    max_damage: 26,     // Lv1 占位：逐击封顶（高于激光同档）
    cooldown_ticks: 15, // 各级沿用 Lv1
    energy_cost: 8,     // 双光束（各级沿用 Lv1）
  },
  maxLevel: 16,
  levels: [
    { level: 2, effects: { damage: 2, ramp_per_hit: 2, max_damage: 28 } },
    { level: 3, effects: { damage: 3, ramp_per_hit: 2, max_damage: 35 } },
    { level: 4, effects: { damage: 4, ramp_per_hit: 3, max_damage: 43 } },
    { level: 5, effects: { damage: 5, ramp_per_hit: 3, max_damage: 55 } },
    { level: 6, effects: { damage: 6, ramp_per_hit: 4, max_damage: 68 } },
    { level: 7, effects: { damage: 7, ramp_per_hit: 4, max_damage: 80 } },
    { level: 8, effects: { damage: 8, ramp_per_hit: 5, max_damage: 92 } },
    { level: 9, effects: { damage: 9, ramp_per_hit: 5, max_damage: 105 } },
    { level: 10, effects: { damage: 11, ramp_per_hit: 6, max_damage: 120 } },
    { level: 11, effects: { damage: 13, ramp_per_hit: 7, max_damage: 140 } },
    { level: 12, effects: { damage: 15, ramp_per_hit: 8, max_damage: 150 } },
    { level: 13, effects: { damage: 17, ramp_per_hit: 8, max_damage: 170 } },
    { level: 14, effects: { damage: 19, ramp_per_hit: 9, max_damage: 185 } },
    { level: 15, effects: { damage: 22, ramp_per_hit: 10, max_damage: 210 } },
    { level: 16, effects: { damage: 25, ramp_per_hit: 11, max_damage: 220 } },
  ],
};
