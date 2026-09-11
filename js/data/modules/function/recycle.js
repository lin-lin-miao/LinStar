/* ===== data/modules/function/recycle.js —— 回收利用（功能 · 常驻被动 · 按阵亡数回血） =====
 * 功能：**当场上有单位阵亡时（无论敌我）恢复自身生命值**。
 *   - 统计口径：**全场（双方合计）**的阵亡数、**排除召唤/临时单位**（判据 `summonMod || isSummon`，
 *     与 `soloConditionHolds` 的“召唤物不计入”**同一判据**）。
 *   - 时序口径：**按“上一 tick”的阵亡数结算** —— 各判死点（结算阶段）经唯一出口 `battle.js onDeath()`
 *     累加 `deathsThisTick`，**tick 收尾**提交为 `lastTickDeaths`；Pass1 **只读该快照**（本 tick 内恒定）
 *     → 同一 tick 内不存在“死→回血”反馈环，与遍历顺序无关、双方**镜像对等**；
 *     本 tick 新发生的阵亡要到**下一 tick** 才计入（严格“上一 tick”语义）。
 *   - 恢复量 ＝ `hp_regen_per_death × 模块类别系数 × 上一 tick 阵亡数`（乘类别系数，与其它自身词条一致）。
 *   - 落地：回血属**数值修改** → Pass1 只记 `__pending.hpDeltas`（`regen:true`），**结算步骤 4c** 与
 *     `hp_target` **同批** `applyHpTo` 落地（**与既有护盾/血量同一步骤**）：**真实 hp 恢复**、
 *     钳制到 `hpMax` 不超额、正值不乘受伤减免；`0 阵亡` → **不记任何账**（本 tick 零数值变化、无战报）。
 *   - 无冷却、无持续、无能量消耗：`type: ['passive']`（与三件增幅器同族的常驻被动）——装上即生效、
 *     停用即失效。**不触发激活**，故不消耗能量、不进冷却，符合“无需冷却/耗能”的机制口径。
 *   - 战报：仅当**实际回血 > 0**（可能被 `hpMax` 钳制为 0）时，每 tick 每模块至多 1 条
 *     `battle.log.recycleRegen`（带模块拥有者 + 上一 tick 阵亡数 + 实际回血），**天然低频**（必须有阵亡）。
 *   - `target: {}`：无命中目标（自身词条无需目标，也不出现在目标选择器中）。
 *   - 分类＝**功能**。
 * 数值说明：【占位预填】由用户逐级人工调校。
 */
export default {
  id: 'recycle',
  nameKey: 'module.recycle', // i18n -> 回收利用 / Recycling
  name: '回收利用',
  category: 'function',
  // 常驻被动：无命中目标（自身词条不需要目标）
  target: {},
  effects: {
    type: ['passive'],        // 常驻被动（无激活/冷却/持续/耗能）：引擎跳过“激活-触发”流程
    hp_regen_per_death: 50,   // Lv1 占位：上一 tick 每有 1 个非召唤单位阵亡，自身恢复 20 点生命
  },
  maxLevel: 16,
  levels: [
    { level: 5, effects: { hp_regen_per_death: 35 } },
    { level: 10, effects: { hp_regen_per_death: 55 } },
    { level: 16, effects: { hp_regen_per_death: 90 } },
  ],
};
