/* ===== data/modules/heavyCannon.js —— 大型火炮（攻击, C02） =====
 * 与火炮类似但可同时命中多个敌方目标（multi）；单目标伤害比火炮低。
 * 满级 16（一般模块默认满级 16）。
 * 数值说明：【占位预填】——damage 为每次激活对每个命中目标造成的伤害(占位，待用户逐级调)；
 * cooldown_ticks 沿用火炮(20)；energy_cost 较高(每激活消耗一次)；maxCount 目标数上限占位 3。
 * levels 只写“与上一级的差异”，留空 = 继承上一级。
 */
export default {
  id: 'heavyCannon',
  nameKey: 'module.heavyCannon', // i18n -> 大型火炮 / Heavy Cannon
  name: '大型火炮',
  icon: 'assets/img/大型火炮.svg',
  category: 'attack',
  target: {
    kinds: ['enemy'],
    countMode: 'multi', // 同时命中多个敌方目标
    maxCount: 2,
  },
  effects: {
    type: ['projectile'], // 特殊钩子标记（机制）
    damage: 10,            // Lv1 占位：单目标伤害，低于火炮(14)
    cooldown_ticks: 20,   // 各级沿用 Lv1（如需随级变请在 levels 覆盖）
    energy_cost: 8,
  },
  maxLevel: 16,
  levels: [
    { level: 2, effects: { damage: 13 } },
    { level: 3, target: { maxCount: 3 }, effects: { damage: 15 } },
    { level: 4, effects: { damage: 18 } },
    { level: 5, effects: { damage: 21 } },
    { level: 6, target: { maxCount: 4 }, effects: { damage: 24 } },
    { level: 7, effects: { damage: 27 } },
    { level: 8, effects: { damage: 30 } },
    { level: 9, effects: { damage: 34 } },
    { level: 10, effects: { damage: 38 } },
    { level: 11, effects: { damage: 42 } },
    { level: 12, target: { maxCount: 5 }, effects: { damage: 46 } },
    { level: 13, effects: { damage: 50 } },
    { level: 14, effects: { damage: 54 } },
    { level: 15, effects: { damage: 60 } },
    { level: 16, effects: { damage: 68 } },
  ],
};
