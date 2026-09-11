/* ===== data/modules/function/shieldBattery.js —— 护盾电池（功能 · 常驻增幅器） =====
 * 功能：【常驻自身增幅】提高**自身护盾系数**，代价是**削减自身能量上限**。
 *   - **无冷却、无持续、无能量消耗**：不激活、不判定、每 tick 什么都不做（不进“激活-触发”流程）。
 *   - 装上即永久生效（停用即失效、单位阵亡随单位消失），属**自身常驻静态加成**路径（与增幅器三件同族）。
 *   - 词条（下划线 + **无 `_target` 后缀** = 自身词条，命名铁律同 `shield_cap_bonus`）：
 *       `shield_coeff_add`  —— 自身**护盾系数加性**加成（+0.1 → 护盾系数 1.0→1.1）。
 *                             落地：`ship.js syncStaticCoeffs` 写入既有 `ship.coeffMods`
 *                             （来源 key＝模块实例 id，与结算阶段 `applyCoeffOp` 同一张表、
 *                              同一撤销入口 `clearAllSourceMods`），由既有 `coeff(ship,'shield')` 求和；
 *                             护盾系数参与**模块护盾池容量**（`modulePoolCapOf`）→ 系数变化后同步
 *                             `recalcDerived`（与 `applyCoeffOp` 同一条重算路径）。
 *       `energy_cap_bonus`  —— 自身**能量上限**加成（**取负值＝常驻削减**）。落地：`ship.js syncHullCaps`
 *                             （`energyCap = 基准 + Σ常驻 + Σ目标级叠加`，天然支持负值）。
 *                             ★ **当前值钳制**：上限下降时 `energy = min(energy, energyCap)`
 *                             （`syncHullCaps` 内统一做，不会出现当前值高于上限）。
 *   - `type: ['passive']`：**常驻被动**标签——引擎据标签跳过“激活-触发”流程；UI 据同一标签把该行标为
 *     状态型（成本列「状态型」），生效判据由 `moduleEffective` 给出（「生效中 / 已停用」）。
 *   - `target: {}`：无命中目标（自身词条无需目标，也不出现在目标选择器中）。
 *   - 分类＝**功能**：本模块是“自身常驻增幅（含负面代价）”，与强辐线圈/船体装甲同族；其效果
 *     **不再是** `shield_cap_bonus`（旧版护盾容量词条），故不再归护盾类。
 *   - **不产生战报**（常驻增幅无激活事件）。
 * 数值说明：【占位预填】由用户逐级人工调校。
 */
export default {
  id: 'shieldBattery',
  nameKey: 'module.shieldBattery', // i18n -> 护盾电池 / Shield Battery
  name: '护盾电池',
  icon: 'assets/img/护盾电池.svg',
  category: 'function',
  // 常驻被动：无命中目标（自身词条不需要目标）
  target: {},
  effects: {
    type: ['passive'], // 常驻被动（无激活/冷却/持续/耗能）：引擎跳过“激活-触发”流程
    shield_coeff_add: 0.1,   // Lv1 占位：自身护盾系数 +0.1
    energy_cap_bonus: -100,  // Lv1 占位：自身能量上限 −100（常驻削减）
  },
  maxLevel: 16,
  levels: [
    { level: 5, effects: { shield_coeff_add: 0.15, energy_cap_bonus: -160 } },
    { level: 10, effects: { shield_coeff_add: 0.2, energy_cap_bonus: -220 } },
    { level: 16, effects: { shield_coeff_add: 0.3, energy_cap_bonus: -300 } },
  ],
};
