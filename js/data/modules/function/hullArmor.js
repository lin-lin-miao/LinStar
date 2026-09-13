/* ===== data/modules/function/hullArmor.js —— 船体装甲（功能 · 常驻增幅器） =====
 * 功能：【常驻自身增幅】提高**自身血量（血量上限）**。
 *   - **无冷却、无持续、无能量消耗**：不激活、不判定、每 tick 什么都不做（不进“激活-触发”流程）。
 *   - 装上即永久生效（停用即失效、单位阵亡随单位消失），属**静态加成/派生重算**路径——
 *     落地口径：`ship.js syncSelfStatics`（`基准 + Σ自身常驻词条 ×类别系数 + Σ目标级叠加`）；
 *     由 `installModule`（装上即生效）与战斗内启停（`battle.js recomputeCap`）触发重算，
 *     **不产生任何逐 tick 数值变化**（Pass1 零数值变化铁律）。
 *   - 词条：`hp_cap_bonus` —— 自身**血量上限**加成（下划线 + **无 `_target` 后缀** = 自身词条，
 *     命名铁律同 `shield_cap_bonus`）。
 *   - **上限提升不补当前血量**（与护盾“只加容量、不白送盾量”同一口径：`hp = min(hp, hpMax)` 只做钳制）；
 *     满血只在**登场**时由 `fillHullVitals` 统一给予（与满盾同体例）。
 *   - `type: ['passive']`：**常驻被动**标签——引擎据标签跳过“激活-触发”流程；UI 据此把该行标为
 *     状态型（成本列「状态型」），生效判据由 `moduleEffective` 给出（「生效中 / 已停用」）。
 *   - `target: {}`：无命中目标（自身词条无需目标）。
 *   - 分类＝**功能**：血量上限属自身常驻增幅，既有分类中无“装甲/船体”类，`function`（功能类自身增益，
 *     同「单枪匹马/固若金汤」）为其归属；数值按**功能系数**（`coeff(ship,'function')`）缩放。
 *   - ⚠ 本词条**不得**与 `duration_ticks` 搭配（时长型不属常驻，见 ship.js 常驻判据）；
 *     也不得写成 `hp_cap_target`（那是“指向目标、单次一次性、会被撤销”的目标级上限词条）。
 *   - **不产生战报**（常驻增幅无激活事件）。
 * 数值说明：【占位预填】由用户逐级人工调校。
 */
export default {
  id: 'hullArmor',
  nameKey: 'module.hullArmor', // i18n -> 船体装甲 / Hull Armor
  name: '船体装甲',
  icon: 'assets/img/船体装甲.svg',
  category: 'function',
  // 常驻被动：无命中目标（自身词条不需要目标）
  target: {},
  effects: {
    type: ['passive'], // 常驻被动（无激活/冷却/持续/耗能）：引擎跳过“激活-触发”流程
    hp_cap_bonus: 1000,  // Lv1 占位：自身血量上限 +60
  },
  maxLevel: 16,
  levels: [
    { level: 5, effects: { hp_cap_bonus: 100 } },
    { level: 10, effects: { hp_cap_bonus: 160 } },
    { level: 16, effects: { hp_cap_bonus: 260 } },
  ],
};
