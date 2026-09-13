/* ===== data/modules/mining/oreHold.js —— 矿舱（采矿 · 常驻增幅器） =====
 * 功能：【常驻自身增幅】提高**自身矿物容量**（词条 `ore_cap_bonus`）。
 *   - **无冷却、无持续、无能量消耗**：不激活、不判定、每 tick 什么都不做（不进“激活-触发”流程），
 *     与「货舱 / 船体装甲」等常驻增幅器**同一体例**。
 *   - 落地口径＝`ship.js` 的**矿物容量唯一口径** `oreCapacityOf` / `oreCapPartsOf`：
 *        矿物容量 = 本体容量（船型 `base.oreCap`，**不受系数影响、直接相加**）
 *                 + Σ(**每个来源分别** `ore_cap_bonus` × `coeff(ship,'mining')`) → **取整**（Math.round）
 *     —— 模块部分**按采矿类系数缩放**（不是模块自身类别系数）；常驻判据与 `hp_cap_bonus` 完全同源
 *     （模块**启用中** 且 **无 `duration_ticks`** → 生效；装/拆/启停即变，**不逐 tick**）。
 *   - `type: ['passive']`：**常驻被动**标签（引擎跳过“激活-触发”流程；UI 标为状态型）。
 *   - `target: {}`：无命中目标。
 *   - ⚠ 本词条**不得**与 `duration_ticks` 搭配（时长型不属常驻）；也不得写成 `ore_cap_target`。
 *   - 对应开发清单 **C34「采矿载货强化」语义**（采矿类，M4）；载体命名取更直观的「矿舱」。
 *   - **不产生战报**（常驻增幅无激活事件）。
 *   - 无 `icon`：暂无对应 SVG 素材 → 走既有降级（显示名称首字「矿」）；素材就位后补 `icon` 即可。
 * 数值说明：【占位预填】由用户逐级人工调校。
 */
export default {
  id: 'oreHold',
  nameKey: 'module.oreHold', // i18n -> 矿舱 / Ore Hold
  name: '矿舱',
  category: 'mining',
  // 常驻被动：无命中目标（自身词条不需要目标）
  target: {},
  effects: {
    type: ['passive'], // 常驻被动（无激活/冷却/持续/耗能）：引擎跳过“激活-触发”流程
    ore_cap_bonus: 120, // Lv1 占位：自身矿物容量 +120（× 本船采矿系数后计入总量）
  },
  maxLevel: 16,
  levels: [
    { level: 5, effects: { ore_cap_bonus: 240 } },
    { level: 10, effects: { ore_cap_bonus: 420 } },
    { level: 16, effects: { ore_cap_bonus: 700 } },
  ],
};
