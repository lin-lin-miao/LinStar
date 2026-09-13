/* ===== data/modules/mining/miningLaser.js —— 采矿激光（采矿 · M4 经济循环） =====
 * 功能：每次激活从**星区矿物储量**中开采一定量矿物，装入本舰**矿物仓**（`hull.ore`）。
 *   - **主动模块**（占位冷却/耗能，见下）：走既有“激活—冷却”流程，结算步骤 3 统一扣能量。
 *   - **无目标**（`target: {}`）：本模块**不进入目标选择链**（引擎按“自身词条”处理）：
 *     `ore_gain` 无 `_target` 后缀 ⇒ 效果作用于**模块所属自身**，不解析任何目标、不干扰全队策略。
 *   - 词条 `ore_gain`：**一次激活的采矿量**；实际采集量 = `ore_gain × coeff(ship,'mining')`
 *     （与矿物容量 `oreCapacityOf` 的缩放类别**同一口径**：乘**采矿系数**，不是模块自身类别系数 —— 当前二者同值）。
 *   - **容量截断**：采集请求被本舰**剩余矿物容量**（`oreCapacityOf − oreLoadOf`，再扣本 tick 已认领量）截断。
 *   - **剩余容量为 0 → 不激活**（不耗能、不进冷却）：判据落在引擎既有 `canImpact()` 的同一出口
 *     （与“无可生效目标不激活”完全同体例）。
 *   - **星区储量为 0 → 全部采矿模块不激活**（同一判据）。
 *   - **结算时序**：Pass1 只记“采集请求”（零数值变化）；**结算步骤 3b** 统一按比例分配 → 入 `hull.ore` → 扣减星区储量；
 *     本 tick 采集后同 tick 阵亡者：先入库、再由唯一判死出口 `onDeath` **全额返还**星区储量（净效果＝储量不变）。
 *   - **战报（低频聚合）**：**仅在实际入库量 > 0** 时记 1 条 `battle.log.miningGain`
 *     （`{owner}的{module}：采集 {n} 点矿物`，`n`＝**实际**入库量）。聚合边界＝**按模块实例**聚合成一条
 *     （同一实例本 tick 至多激活 1 次；条数上限＝本 tick 实际入库的“单位×模块实例”对数），
 *     叠加本模块自身冷却（下级 20t）限频 ⇒ 不会刷屏（符合 战报日志开发要点.md §3 低频聚合规范）。
 *   - 无 `icon`：暂无对应 SVG 素材 → 走既有降级（显示名称首字「采」）；素材就位后补 `icon` 即可。
 * 数值说明：【占位预填】由用户逐级人工调校（`ore_gain` 为 Lv1/Lv5/Lv10/Lv16 四档锚点，中间等级沿用上一档）。
 */
export default {
  id: 'miningLaser',
  nameKey: 'module.miningLaser', // i18n -> 采矿激光 / Mining Laser
  name: '采矿激光',
  category: 'mining',
  // ★ 无目标：`kinds` 缺省 ⇒ 候选池为空、不进入目标选择链（自身词条，作用于本舰矿物仓）
  target: {},
  effects: {
    // 无特殊钩子标签（`type` 省略）：既不是 weapon（无 damage），也不走召唤/控制/时长类分支
    ore_gain: 30,        // Lv1 占位：每次激活的采矿量（× 采矿系数后取整）
    cooldown_ticks: 20,  // Lv1 占位：激活后冷却（各级沿用 Lv1，如需随级变请在 levels 覆盖）
    energy_cost: 8,      // Lv1 占位：每次激活耗能
  },
  maxLevel: 16,
  levels: [
    { level: 5, effects: { ore_gain: 60 } },
    { level: 10, effects: { ore_gain: 110 } },
    { level: 16, effects: { ore_gain: 180 } },
  ],
};
