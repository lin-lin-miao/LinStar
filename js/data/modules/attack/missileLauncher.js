/* ===== data/modules/missileLauncher.js —— 导弹发射器（攻击） =====
 * 功能：召唤一枚【导弹】。与火箭类似：召唤时按发射器模块目标锁定【固定目标】且不可再改。
 *   差别在于导弹成本更高、装载特殊模组"导弹弹头"，命中时对目标产生【爆炸伤害】——
 *   同时伤及其所在队列（视觉顺序）中、前后各 blast_range 个位置内的存活单位。
 *   - effects.summon.bind_target:true → 发射时锁定目标（导弹不可改目标，包括相邻爆炸也锁定）。
 *   - 导弹复用通用 'drone' 模板；attrs.nameKey 显示为"导弹"；图标用 导弹.svg。
 * 数值说明：【占位预填】成本(能耗/冷却)高于火箭、爆炸范围/伤害由用户逐级人工调校。
 */
export default {
  id: 'missileLauncher',
  nameKey: 'module.missileLauncher', // i18n -> 导弹发射器
  name: '导弹发射器',
  icon: 'assets/img/导弹.svg',
  category: 'attack',
  target: { kinds: ['enemy'], countMode: 'single', maxCount: 1 }, // 发射时解析并锁定单一目标
  effects: {
    type: ['summon','cool_first'],               // 召唤钩子
    summon: {
      type: 'drone',                // 复用通用召唤模板
      bind_target: true,            // 导弹锁定发射器目标，召唤后不可改
      modules: [{ moduleId: 'missileWarhead' }], // 携带"导弹弹头"（等级=召唤模块等级）
      attrs: {
        nameKey: 'ship.missile',    // 显示名 -> 导弹
        icon: 'assets/img/导弹.svg',
        base: { hp: 25, shieldCap: 0, energyCap: 120, energyRegen: 6 },
      },
      lifespan_ticks: 400,          // 保险存活上限（通常引信先到即爆炸自毁）
      maxSummoned: 1000,
      temp: true,
    },
    cooldown_ticks: 220,            // 导弹发射间隔(tick)占位：高于火箭
    energy_cost: 60,                // 每次召唤能耗占位：高于火箭
  },
  maxLevel: 16,
  levels: [
    { level: 5, effects: { summon: { lifespan_ticks: 420 }, cooldown_ticks: 200, energy_cost: 54 } },
    { level: 10, effects: { summon: { lifespan_ticks: 440 }, cooldown_ticks: 180, energy_cost: 48 } },
    { level: 16, effects: { summon: { lifespan_ticks: 460 }, cooldown_ticks: 160, energy_cost: 42 } },
  ],
};
