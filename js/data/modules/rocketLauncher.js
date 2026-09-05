/* ===== data/modules/rocketLauncher.js —— 火箭发射器（攻击 · C06） =====
 * 功能：召唤一枚【一次性火箭】。火箭在召唤瞬间锁定发射器模块的当前目标为【固定目标】，
 * 之后不可再更改（即使该目标阵亡也不切换、不会另选其他目标）；仅当发射器有可用目标时才召唤。
 *   - effects.summon.bind_target:true → 引擎按发射器模块目标解析出锁定目标并绑定给召唤体。
 *   - 火箭携带一枚与本模块同等级的 自毁弹药(rocketWarhead)，引信结束后命中并自毁。
 *   - 召唤体船型复用通用 'drone' 模板，attrs.nameKey 令其显示为"火箭"。
 * 数值说明：【占位预填】冷却/能耗/火箭存活时长由用户逐级人工调校。
 */
export default {
  id: 'rocketLauncher',
  nameKey: 'module.rocketLauncher', // i18n -> 火箭发射器
  name: '火箭发射器',
  icon: 'assets/img/火箭发射器.svg',
  category: 'attack',
  target: { kinds: ['enemy'], countMode: 'multi', maxCount: 1 }, // 用于在召唤时解析锁定目标
  effects: {
    type: ['summon', 'per_target'], // per_target：召唤数量 = 当前解析到的目标数（每目标一枚，各自锁定目标）
    summon: {
      type: 'drone',                // 复用通用召唤模板
      bind_target: true,            // 火箭锁定发射器当前目标，召唤后不可改
      modules: [{ moduleId: 'rocketWarhead' }], // 携带一次性弹药（等级=召唤模块等级）
      attrs: {
        nameKey: 'ship.rocket',     // 显示名 -> 火箭
        icon: 'assets/img/火箭.svg',
        base: { hp: 20, shieldCap: 0, energyCap: 100, energyRegen: 5 },
      },
      lifespan_ticks: 400,          // 保险存活上限（通常引信先到即自毁）
      // maxSummoned: 100,               // 占位：同阵营同时在空火箭上限 2
      temp: true,
    },
    cooldown_ticks: 150,            // 火箭发射间隔(tick)占位（各级沿用 Lv1）
    energy_cost: 40,                // 每次召唤能耗占位（各级沿用 Lv1）
  },
  maxLevel: 16,
  levels: [
    { level: 5, target: { maxCount: 2 }, effects: { summon: { lifespan_ticks: 420}, cooldown_ticks: 140, energy_cost: 36 } },
    { level: 10, target: { maxCount: 3 }, effects: { summon: { lifespan_ticks: 440}, cooldown_ticks: 125, energy_cost: 30 } },
    { level: 16, target: { maxCount: 4 }, effects: { summon: { lifespan_ticks: 460}, cooldown_ticks: 110, energy_cost: 24 } },
  ],
};
