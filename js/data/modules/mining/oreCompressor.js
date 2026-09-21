/* ===== data/modules/mining/oreCompressor.js —— 矿物压缩（采矿 · 常驻增幅器） =====
 * 功能：【常驻自身增幅】提高**自身采矿系数**（与「护盾电池」**同体例**：无冷却、无持续、无耗能）。
 *   - **无冷却、无持续、无能量消耗**：不激活、不判定、每 tick 什么都不做（不进“激活-触发”流程）。
 *   - 装上即永久生效（停用即失效、单位阵亡随单位消失），属**自身常驻静态加成**路径（与增幅器同族）。
 *   - 词条（下划线 + **无 `_target` 后缀** = 自身词条，命名铁律同 `shield_coeff_add`）：
 *       `mining_coeff_add` —— 自身**采矿系数加性**加成（+0.1 → 采矿系数 1.0 → 1.1）。
 *         落地：`ship.js syncStaticCoeffs` 写入既有 `ship.coeffMods`（来源 key＝模块实例 id，
 *               与结算阶段 `applyCoeffOp` 同一张表、同一撤销入口 `clearAllSourceMods`），
 *               由既有 `coeff(ship,'mining')` 求和；词条→类别映射表＝`battle.js COEFF_ADD`
 *               （本词条由既有的 `_coeff_add` 后缀规则**自动识别**，无需为该模块写任何特判）。
 *         ★ 影响面（**全部是按需读取，无任何缓存派生值** ⇒ **不需要派生重算 `recalcDerived`**）：
 *             ① 矿物容量模块部分 `oreCapacityOf`（`ore_cap_bonus × coeff(ship,'mining')`）；
 *             ② 采矿激光实采量 `round(ore_gain × coeff(ship,'mining'))`。
 *           （只有 `shield` 类别参与 `modulePoolCapOf` 的池容量缓存 → 才需要 `recalcDerived`；
 *             采矿系数不参与任何缓存，装上/启停**即时生效、零重算、不逐 tick**。）
 *   - `type: ['passive']`：**常驻被动**标签——引擎据标签跳过“激活-触发”流程；UI 据同一标签把该行标为
 *     状态型（成本列「状态型」），生效判据由 `moduleEffective` 给出（「生效中 / 已停用」）。
 *   - `target: {}`：无命中目标（自身词条无需目标，也不出现在目标选择器中）。
 *   - 分类＝**采矿**（与采矿激光/矿舱同族：只影响采矿口径，与攻击/护盾系数无关）。
 *   - **不产生战报**（常驻增幅无激活事件）。
 *   - 无 `icon`：暂无对应 SVG 素材 → 走既有降级（显示名称首字「矿」）；素材就位后补 `icon` 即可。
 * 数值说明：【占位预填】与「护盾电池」同量级，由用户逐级人工调校。
 */
export default {
  id: 'oreCompressor',
  /* ★ M3 基地侧字段【占位预填 · 待用户调校】——M3a 只铺字段，读取逻辑属 M3b（船坞）/ M3e（研究站）。
   * · `levels[]` 仍是【战斗数值】的唯一逐级表（由 entities/module.js 解析 effects/target）；
   *   下列基地侧字段自带**独立逐级表**（数组项 { level, ... }，未列出该等级则沿用上一项）；
   * · 缺省即视为「无消耗 / 无门槛」：installCost / removeCost / upgradeCost / scienceCost 缺失＝免费，
   *   blueprint 缺失＝无需蓝图；资源键见 data/resources.js（缺失键视为 0）。 */
  installCost: { energy: 0, ore: 0, alloy: 0, rare: 0 },
  removeCost: { energy: 0, ore: 0, alloy: 0, rare: 0 },
  upgradeCost: [{ level: 2, cost: { energy: 0, ore: 0, alloy: 0, rare: 0 } }],
  blueprint: [{ level: 1, count: 0 }],
  scienceCost: [{ level: 2, cost: { science: 0 } }],
  nameKey: 'module.oreCompressor', // i18n -> 矿物压缩 / Ore Compressor
  name: '矿物压缩',
  category: 'mining',
  // 常驻被动：无命中目标（自身词条不需要目标）
  target: {},
  effects: {
    type: ['passive', 'undeactivatable'], // 常驻被动（无激活/冷却/持续/耗能）：引擎跳过“激活-触发”流程
    mining_coeff_add: 0.1, // Lv1 占位：自身采矿系数 +0.1（作用于矿物容量模块部分与采矿激光实采量）
  },
  maxLevel: 16,
  levels: [
    { level: 5, effects: { mining_coeff_add: 0.15 } },
    { level: 10, effects: { mining_coeff_add: 0.2 } },
    { level: 16, effects: { mining_coeff_add: 0.3 } },
  ],
};
