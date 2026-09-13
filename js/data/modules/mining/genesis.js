/* ===== data/modules/mining/genesis.js —— 创世纪（采矿 · 星区储量加法增幅） =====
 * 功能：【主动】按**加法**提升**星区矿物储量**（词条 `sector_ore_add`），**无目标**（不进目标选择链）。
 *   - 词条 `sector_ore_add`：**星区储量绝对增量**（+100 ⇒ 当前剩余储量 +100）。
 *     ★ **实际增量乘采矿系数并取整**：`round(词条值 × coeff(拥有者,'mining'))` —— 与**采矿激光实采量**
 *       （`round(ore_gain × coeff(ship,'mining'))`）、**矿舱容量模块部分**同一口径；取值时机＝
 *       **Pass1 记账时**（与采矿激光**同口径、同位置**）⇒ tick 内的系数变化不影响已记好的意图量。
 *     ⚠ 作用对象＝**星区**（战场全局），既非「自身词条」也非「目标词条」：无 `_target` 后缀、
 *       也不作用于模块所属单位；按模块拥有者记账（战报/UI 归属用 `ownerOf(inst)`）。
 *   - **混合冷却口径（★ 用户确认，务必按此实现）**：本模块要生效必须**同时**满足
 *       ① 模块实例自身冷却已就绪（`cooldown_ticks`，与普通模块完全一致）；
 *       ② **星区侧对「本模块」的冷却已结束**（星区只接受一次触发）—— 参与判据＝模块带独立词条
 *          **`sector_cd_ticks`**（**按词条识别、不硬编码模块 id**），时长＝**该词条值**（不再取 `cooldown_ticks`）。
 *     两把冷却**互相独立、各自计时**；各模块在星区上的冷却也**各自独立**（key ＝ 模块 id）。
 *     门控落在 Pass1 **唯一门控出口** `canImpact`：不满足 → **不激活、不耗能、不进冷却**（沿用既有口径）。
 *   - **同一 tick 多个单位携带同一模块**：按固定结算顺序（我方 → 敌方）**只接受第一个**，
 *     其余本 tick 不激活（星区“只接受一次触发”）——见 `battle.js sectorClaimedTick`。
 *   - **结算统一落地**：Pass1 只记意图（`__pending.sectorOps`，**零数值变化**）；
 *     **结算步骤 3c** 统一落地：**先加法、后乘法**（加法求和后一次性加入）→ 星区储量**不封顶**；
 *     星区冷却在同一步写入（`sectorCdUntil`，绝对到期 tick 模型、无逐 tick 递减）。
 *   - 分类＝**采矿**；**战报**＝每模块每次激活至多 1 条 `battle.log.sectorOreAdd`
 *     (`{owner}的{module}：星区矿物 +{n}`，`n`＝该条实际增量，仅增量 > 0 时记；低频关键事件)。
 *   - 无 `icon`：暂无对应 SVG 素材 → 走既有降级（显示名称首字「创」）；素材就位后补 `icon` 即可。
 * 数值说明：【占位预填】＋100 为 **Lv1 基准**、逐级递增占位，由用户逐级人工调校。
 */
export default {
  id: 'genesis',
  nameKey: 'module.genesis', // i18n -> 创世纪 / Genesis
  name: '创世纪',
  category: 'mining',
  // ★ 无目标：`kinds` 缺省 ⇒ 候选池为空、不进入目标选择链（星区词条，作用于星区储量）
  target: {},
  effects: {
    // 无特殊钩子标签（`type` 省略）：既不是 weapon（无 damage），也不走召唤/控制/时长类分支
    sector_ore_add: 100, // Lv1 占位：星区剩余矿物储量 +100（**再乘采矿系数并取整**；无上限）
    cooldown_ticks: 60,  // Lv1 占位：**实例自身**冷却（各级沿用 Lv1）
    sector_cd_ticks: 60, // Lv1 占位：**星区侧**冷却（独立词条；带它即参与星区冷却；各级沿用 Lv1）
    energy_cost: 25,     // Lv1 占位：每次激活耗能
  },
  maxLevel: 16,
  levels: [
    { level: 5, effects: { sector_ore_add: 200 } },
    { level: 10, effects: { sector_ore_add: 350 } },
    { level: 16, effects: { sector_ore_add: 600 } },
  ],
};
