/* ===== data/modules/transport/cargoHold.js —— 货舱（运输 · 常驻增幅器） =====
 * 功能：【常驻自身增幅】提高**自身货物容量**（词条 `cargo_cap_bonus`）。
 *   - **无冷却、无持续、无能量消耗**：不激活、不判定、每 tick 什么都不做（不进“激活-触发”流程），
 *     与「船体装甲 / 强辐线圈」等常驻增幅器**同一体例**。
 *   - 落地口径＝`ship.js` 的**货舱容量唯一口径** `cargoCapacityOf` / `cargoCapPartsOf`：
 *        货物容量 = 本体容量（船型 `base.cargoCap`，**不受系数影响、直接相加**）
 *                 + Σ(**每个来源分别** `cargo_cap_bonus` × `coeff(ship,'transport')`) → **取整**（Math.round）
 *     —— 模块部分**按运输类系数缩放**（不是模块自身类别系数）；常驻判据与 `hp_cap_bonus` 完全同源
 *     （模块**启用中** 且 **无 `duration_ticks`** → 生效；装/拆/启停即变，**不逐 tick**）。
 *   - `type: ['passive']`：**常驻被动**标签——引擎据标签跳过“激活-触发”流程；UI 据此把该行标为
 *     状态型（成本列「状态型」），生效判据由 `moduleEffective` 给出。
 *   - `target: {}`：无命中目标（自身词条无需目标）。
 *   - ⚠ 本词条**不得**与 `duration_ticks` 搭配（时长型不属常驻，见 ship.js 常驻判据）；
 *     也不得写成 `cargo_cap_target`（目标级词条不属本路径）。
 *   - 对应开发清单 **C25 货舱**（运输类：运输量/容量提升）。
 *   - **不产生战报**（常驻增幅无激活事件）。
 *   - 无 `icon`：暂无对应 SVG 素材 → 走既有降级（显示名称首字「货」）；素材就位后补 `icon` 即可。
 * 数值说明：【占位预填】由用户逐级人工调校。
 */
export default {
  id: 'cargoHold',
  nameKey: 'module.cargoHold', // i18n -> 货舱 / Cargo Hold
  name: '货舱',
  category: 'transport',
  // 常驻被动：无命中目标（自身词条不需要目标）
  target: {},
  effects: {
    type: ['passive'], // 常驻被动（无激活/冷却/持续/耗能）：引擎跳过“激活-触发”流程
    cargo_cap_bonus: 120, // Lv1 占位：自身货物容量 +120（× 本船运输系数后计入总量）
  },
  maxLevel: 16,
  levels: [
    { level: 5, effects: { cargo_cap_bonus: 240 } },
    { level: 10, effects: { cargo_cap_bonus: 420 } },
    { level: 16, effects: { cargo_cap_bonus: 700 } },
  ],
};
