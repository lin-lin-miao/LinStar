/* ===== data/modules/transport/navThruster.js —— 航行推进器（运输 · 常驻增幅器） =====
 * 功能：【常驻自身增幅】提高**自身航行系数**（单位 `coefficients.nav`；与「矿物压缩」/「护盾电池」
 *   **同体例**：**无冷却、无持续、无耗能、不激活**——装上即生效、停用即失效、单位阵亡随单位消失、
 *   **不产生战报**）。
 *   · 词条（下划线 + **无 `_target` 后缀** = 自身词条，命名铁律同 `shield_coeff_add`）：
 *       `nav_coeff_add` —— 自身**航行系数加性**加成（Lv1 `+0.1` → 航行系数 1.0 → 1.1）。
 *   · ★ **可移动性与本模块无关**：任何单位**默认可移动**（`coefficients.nav` 缺省 1 ＝基础航行能力）；
 *     本模块只是**加成**——引擎的路径/冷却/排队链路里**没有任何“必须装某模块才能移动”的判据**。
 *   · **落地（识别与撤销，零特判）**：`ship.js syncStaticCoeffs` 按既有 **`_coeff_add` 后缀规则**
 *     自动识别本词条 ⇒ 写入既有 `ship.coeffMods`（来源 key ＝模块实例 id、类别 ＝`nav`），
 *     与结算阶段 `applyCoeffOp` **同一张表、同一撤销入口 `clearAllSourceMods`**
 *     ⇒ 引擎侧**不需要为该模块写任何特判**，也**不改动既有家族行为**（`_coeff_add` 后缀规则一字未改）。
 *   · ★ **读口径与其它类别系数完全一致**：`ship.js navCoeffOf(ship)` 即既有 `coeff(ship, 'nav')`
 *     ＝ `(coefficients.nav + Σ加性) × Π乘性`——**不再有任何“纯加性特例”**（用户口径：
 *     航行系数并入 `coefficients` 集合、与模块效果系数**同族同链**）；详情页也因此在
 *     「单位系数」区**自动成行**（`Object.keys(ship.coefficients)`，无需 UI 特判）。
 *   · ⚠ 既有家族口径提醒：**同一模块实例的多个 `*_coeff_add` 词条会互相覆盖**
 *     （`setCoeffMod` 的 key ＝模块实例 id，一条记录只存一个类别）——本模块**只带一个**该类词条，不受影响。
 *   · 影响面：**只有星域容器**（`systems/starfield.js`）用它按
 *     `cd = max(1, round(navCdTicks ÷ navCoeff × (1 + timeCoeff)))` 计算**航行引擎冷却**
 *     （`navCdTicks` ＝船型配置的冷却基准，默认 200t＝10s）；
 *     **战斗数值链不读它**（不改伤害/护盾/血量/能量/既定系数）⇒ 装上/启停即时生效、不逐 tick、
 *     不破坏 **Pass1 零数值变化**铁律；既有单星区玩法（`LS.drill()`）**不读不写** ⇒ 零回归。
 *   - `type: ['passive', 'undeactivatable']`：**常驻被动**标签——引擎据标签跳过“激活-触发”流程；
 *     UI 据同一标签把该行标为状态型（生效判据 `moduleEffective` ＝模块启用中）。
 *   - `target: {}`：无命中目标（自身词条无需目标，也不出现在目标选择器中）。
 *   - 分类＝**运输**：本仓没有“航行/机动”类别，取**最贴近航行/运输**的既有类别
 *     （引擎**不按分类判断该词条**——分类只影响详情页分组/配色等呈现口径）。
 *   - 无 `icon`：暂无对应 SVG 素材 → 走既有降级（显示名称首字「航」）；素材就位后补 `icon` 即可。
 * 数值说明：【占位预填 · 待用户调校】——**逐级递增**（等级越高越快，绝对值写法、单调不降）：
 *   Lv1 `+0.1` / Lv2 `+0.2` / Lv3 `+0.35` / Lv4 `+0.5`；Lv5 及以上沿用最高已定义档（`+0.5`）。
 *   正式数值由用户逐级人工调校。
 */
export default {
  id: 'navThruster',
  nameKey: 'module.navThruster', // i18n -> 航行推进器 / Nav Thruster
  name: '航行推进器',
  category: 'transport', // 贴近“航行/运输”的既有类别（引擎不按分类判断本条词条）
  // 常驻被动：无命中目标（自身词条不需要目标）
  target: {},
  effects: {
    type: ['passive', 'undeactivatable'], // 常驻被动（无激活/冷却/持续/耗能）：引擎跳过“激活-触发”流程
    nav_coeff_add: 0.1, // 【占位预填】Lv1：自身航行系数 +0.1（默认冷却基准 200t → 182t）
  },
  maxLevel: 16,
  levels: [
    // 【占位预填】逐级递增（绝对值写法；越大越快，单调不降）
    { level: 2, effects: { nav_coeff_add: 0.2 } },
    { level: 3, effects: { nav_coeff_add: 0.35 } },
    { level: 4, effects: { nav_coeff_add: 0.5 } },
  ],
};
