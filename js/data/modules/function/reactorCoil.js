/* ===== data/modules/function/reactorCoil.js —— 强辐线圈（功能 · C24 反应堆增幅 · 常驻增幅器） =====
 * ★ 显示名：中文「强辐线圈」/ 英文「Strong Radiation Coil」（`id`/文件名/词条均不变）。
 * 功能：【常驻自身增幅】提高**自身能量上限**与**能量恢复速度**。
 *   - **无冷却、无持续、无能量消耗**：不激活、不判定、每 tick 什么都不做（不进“激活-触发”流程）。
 *   - 装上即永久生效（停用即失效、单位阵亡随单位消失），属**静态加成/派生重算**路径——
 *     落地口径：`ship.js syncSelfStatics`（`基准 + Σ自身常驻词条 ×类别系数 + Σ目标级叠加`）；
 *     由 `installModule`（装上即生效）与战斗内启停（`battle.js recomputeCap`）触发重算，
 *     **不产生任何逐 tick 数值变化**（Pass1 零数值变化铁律）。
 *   - 词条（下划线 + **无 `_target` 后缀** = 自身词条，命名铁律同 `shield_cap_bonus`）：
 *       `energy_cap_bonus`   —— 自身能量上限加成；
 *       `energy_regen_bonus` —— 自身能量恢复加成（单位：**每秒**，与船型 `base.energyRegen` 同口径）。
 *   - `type: ['passive']`：**常驻被动**标签——引擎据标签跳过“激活-触发”流程；
 *     UI 据同一标签把该行标为状态型（成本列显示「状态型」），并由 `moduleEffective` 给出
 *     「生效中 / 已停用」判据（UI 不自算）。
 *   - `target: {}`：无命中目标（自身词条无需目标；也保证不会被目标解析/可行性判定影响）。
 *   - ⚠ 本词条**不得**与 `duration_ticks` 搭配（时长型不属常驻，见 ship.js 常驻判据）；
 *     也不得写成 `energy_cap_target`（那是“指向目标、单次一次性、会被撤销”的目标级上限词条）。
 *   - **不产生战报**（常驻增幅无激活事件）。
 * 数值说明：【占位预填】由用户逐级人工调校。
 */
export default {
  id: 'reactorCoil',
  nameKey: 'module.reactorCoil', // i18n -> 强辐线圈 / Strong Radiation Coil
  name: '强辐线圈',
  category: 'function',
  icon: 'assets/img/强辐线圈.svg',
  // 常驻被动：无命中目标（自身词条不需要目标）
  target: {},
  effects: {
    type: ['passive'], // 常驻被动（无激活/冷却/持续/耗能）：引擎跳过“激活-触发”流程
    energy_cap_bonus: 200,   // Lv1 占位：自身能量上限 +200
    energy_regen_bonus: 3,   // Lv1 占位：自身能量恢复 +3/秒
  },
  maxLevel: 16,
  levels: [
    { level: 5, effects: { energy_cap_bonus: 300, energy_regen_bonus: 5 } },
    { level: 10, effects: { energy_cap_bonus: 450, energy_regen_bonus: 8 } },
    { level: 16, effects: { energy_cap_bonus: 700, energy_regen_bonus: 12 } },
  ],
};
