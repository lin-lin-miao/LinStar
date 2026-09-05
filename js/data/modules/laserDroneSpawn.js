/* ===== data/modules/laserDroneSpawn.js —— 激光无人机（召唤 · 无人机类, C38） =====
 * 功能：召唤一个【激光无人机】临时单位。该无人机自带一枚与召唤模块同等级的"激光"模块。
 * 无人机船舰数据模型统一用 data/ships.js 的通用 'drone' 模板，本模块经 effects.summon 设定其
 * 具体种类：
 *   - 图标 = 本模块 icon（无 icon 则召唤单位降级为 ▲）
 *   - 携带模组 modules（等级=召唤模块等级，不受槽限）
 *   - attrs 按船型模板结构对通用无人机做"全条目"覆写（缺省沿用模板）：
 *       nameKey?        可选：为召唤单位显式指定名称词条；不填则显示名覆写为所属召唤模块名
 *       base{hp,shieldCap,energyCap,energyRegen}
 *       coefficients{...}
 *   - 召唤单位三围等属性可在 levels 中按级调整（cooldown/energy 沿用 Lv1）。
 * 数值说明：【占位预填】待用户逐级人工调校。
 */
export default {
  id: 'laserDroneSpawn',
  nameKey: 'module.laserDroneSpawn', // i18n -> 激光无人机（未显式命名时作为召唤单位显示名）
  name: '激光无人机',
  icon: 'assets/img/激光无人机.svg',   // 召唤单位图标随本模块 icon；删除此字段则单位降级 ▲
  category: 'drone',
  target: {}, // 召唤类：无命中目标（走 summon 执行）
  effects: {
    type: ['summon'], // 召唤钩子
    summon: {
      type: 'drone',                   // 通用无人机模板
      modules: [{ moduleId: 'laser' }], // 携带的模组（等级=召唤模块等级，不受槽限）
      attrs: {                         // 覆写通用模板三围（缺省沿用模板）
        base: { hp: 30, shieldCap: 10, energyCap: 120, energyRegen: 12 },
      },
      lifespan_ticks: 200,             // 存在时间(tick)，仅 temp:true(临时单位)时生效；当前 temp:false → 忽略，永久作战至死亡
      maxSummoned: 2,                  // 占位：存活上限 2
      temp: true,                     
    },
    cooldown_ticks: 150, // 每次补召间隔（占位，各级沿用 Lv1）
    energy_cost: 50,     // 每次召唤能耗（占位，各级沿用 Lv1）
  },
  maxLevel: 16,
  levels: [
    { level: 5, effects: { summon: { attrs: { base: { hp: 34, shieldCap: 12, energyCap: 130, energyRegen: 13 } }, lifespan_ticks: 220, maxSummoned: 3 } } },
    { level: 10, effects: { summon: { attrs: { base: { hp: 40, shieldCap: 14, energyCap: 140, energyRegen: 14 } }, lifespan_ticks: 250, maxSummoned: 4 } } },
    { level: 16, effects: { summon: { attrs: { base: { hp: 48, shieldCap: 18, energyCap: 160, energyRegen: 16 } }, lifespan_ticks: 300, maxSummoned: 5 } } },
  ],
};
