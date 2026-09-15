/* ===== data/modules/mining/oreRepair.js —— 矿物维修（采矿 · 主动） =====
 * 功能：消耗**自身携带矿物**（词条 `ore_cost`）修复**单体友方（含自身）**的生命（词条 `hp_target`）。
 * 分类＝**采矿**（`category:'mining'`，文件在 `data/modules/mining/`）：
 *   - 采矿类代表色＝**紫**（`.module-chip.mining` → `var(--cat-mining)`）；
 *   - ★ 本模块的两个词条**都不乘任何类别系数**：
 *       · `hp_target` —— 靠 `type` 标签 **`exact_amount`**（见下）锁定为“词条原值”；
 *       · `ore_cost`   —— 属**成本**词条（与 `energy_cost` 同体例），本来就按**词条原值**扣除。
 *     故**分类改为采矿不会让本模块的任何数值变化**（不乘采矿系数）。
 * 目标：`{ kinds: ['ally','self'], countMode:'single', maxCount:1 }` ——
 *   **“友方（同阵营其它存活单位）+ 自身”**：`ally` 桶＝同阵营其它存活（排除自身）、`self` 桶＝自身，
 *   两桶**任一允许即可选**（既有 `moduleTargetList`/`candList` 同源口径，**未新造选择器**）。
 *   候选池＝**己方单位数组的自然顺序**（受潜行/role 过滤，同既有判据）；`single` 取优先级链首位。
 *   ★ **自身没有隐式优先级**（目标选择口径修正后）：`self` 与 `ally` **同源同序**，自身只出现在它的
 *     **自然位置**——**队列中轮到自身时结果才是自身**；己方只剩自身/自身排在队首时自然选中自身。
 *     （只有带 `prefer_self` 标签的模块才会把自身提到最前；本模块**不带**该标签，可用详情页目标按钮手动改指他人。）
 * 门控（Pass1，零数值变化；全部在**唯一门控出口** `canImpact` + 成本门控块）：
 *   ① 自身携带矿物 < `ore_cost` → 不激活、不扣矿、不耗能、不进冷却（单位内预算 `ctx.oreAvail`）；
 *   ② 能量 < `energy_cost` → 同上（`ctx.avail`，与既有能量门控同一处）；
 *   ③ 目标**已满血** → 按既有 `hp_target` 体例不激活（`canImpact` 通用量值循环的 `atCap`：
 *      `t.hull.hp >= t.hull.hpMax` ⇒ 全部目标都满 → 无可影响目标 → 不激活、不扣矿、不耗能）。
 * 结算统一落地（Pass1 只记意图）：
 *   - 矿物扣减 → **结算步骤 3d-1**（`__pending.oreSpends` → `settleOreSpends`，读口径 `oreLoadOf`）；
 *   - 回血     → **结算步骤 4c**（`__pending.hpDeltas` → 既有血量落地，与既有 `hp_target` 同路径）；
 *   - 全序 3d 在步骤 4 **之前** ⇒ 本模块天然“**同 tick 先扣矿、后回血**”。
 * 战报（★ **已实现**，用户确认要）：**低频 1 条** `battle.log.oreRepair` =
 *   `{owner}的{module}：消耗 {n} 点矿物，修复 {target} {amount} 点生命`
 *   · 触发：**实际回血量 > 0**（`applyHpTo` 前后差值 ⇒ 天然含 hpMax 截断）**且**本 tick 该实例确实支付了矿物
 *     （判据取自“本 tick 实际发生的事实”，不按模块 id/词条名硬编码）；
 *   · `n`＝**实际扣矿量**（步骤 3d-1 写入实例的 `_orePaidAmt`，非词条值）；`amount`＝**实际回血量**；
 *   · 每模块每 tick ≤ 1 条；成句在**步骤 4c 回血落地处**（与数值同批，3d 恒在其前 ⇒ 扣矿量已就绪）。
 * 图标：**无对应 SVG 素材 → 不写 `icon`**，走既有「名称首字」降级（“矿”）；
 *   （筹码缺图回退见 `battleView.moduleGlyphEl` 的 `error` 监听：写了 `icon` 而素材失效时同样回退首字。）
 * 数值说明：【占位预填】由用户逐级人工调校。
 */
export default {
  id: 'oreRepair',
  nameKey: 'module.oreRepair', // i18n -> 矿物维修 / Ore Repair
  name: '矿物维修',
  category: 'mining',
  target: { kinds: ['ally', 'self'], countMode: 'single', maxCount: 1 },
  effects: {
    // `exact_amount`＝**量值按词条原值**（目标级量值词条一律**不乘任何系数**，1:1 口径）；
    //   引擎按**标签**识别、不按模块 id 硬编码；未带该标签的既有模块数值**一字不变**。
    type: ['exact_amount'],
    cooldown_ticks: 60,     // 修复间隔（各级沿用 Lv1）
    energy_cost: 60,        // 每次修复的能量消耗（耗能）
    ore_cost: 30,           // Lv1 占位：每次修复消耗的**自身携带矿物**（结算步骤 3d-1 扣除）
    hp_target: 60,          // Lv1 占位：给目标恢复的生命（**词条原值**，不乘任何系数）
  },
  maxLevel: 16,
  levels: [
    { level: 5, effects: { energy_cost: 90, ore_cost: 55, hp_target: 110 } },
    { level: 10, effects: { energy_cost: 130, ore_cost: 90, hp_target: 180 } },
    { level: 16, effects: { energy_cost: 180, ore_cost: 140, hp_target: 280 } },
  ],
};
