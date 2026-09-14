/* ===== data/modules/mining/oreTransfer.js —— 矿石输送（采矿 · 主动 · 把自身矿物 1:1 送给友方） =====
 * 功能：**把自身携带的矿物 1:1 输送给目标**（自身扣多少、目标就加多少）。
 *   - **分类＝采矿**：`category:'mining'`（用户口径：矿石系＝采矿类，代表色**紫**），
 *     文件亦在 `data/modules/mining/`（**目录与分类一致**，已由用户移动并就位）。
 *     ★ **分类改为采矿不会让本模块的任何数值变化**：本模块与目标相关的数值只有 `ore_target`，
 *       而该词条**已按用户口径锁定为 1:1、不乘任何系数**（见下，引擎单独成支）⇒ 分类与其数值无关；
 *       `energy_cost`/`cooldown_ticks` 属成本/计时，按**词条原值**，同样不乘系数。
 *   - **主动模块**（走既有“激活-触发”流程）：有 `cooldown_ticks`（冷却）与 `energy_cost`（自身消耗）。
 *   - **目标**：`kinds: ['ally']` + `countMode:'single'` + `maxCount:1` —— **单体、仅友方**。
 *     ★ 既有选择器的 `ally` 分支即 `同阵营其它存活单位`（`battle.js moduleTargetList`：
 *       `sameSide.filter(u => u.alive && u.id !== ship.id)`）→ **天然排除自身**，无需引擎改动；
 *       复用既有**目标优先级链**（强制目标 > 模块手动目标 > 船 targetId > 自动粘性 > 全队策略）。
 *     ★ **无可用目标 → 不激活**（`moduleTargetList` 返回空 → `maybeActivate` 直接返回，不耗能、不进冷却）。
 *   - **自身消耗（能量）**：既有 `energy_cost` + `payEnergy` + 单位内运行计数 `ctx.avail` 门控
 *     → **能量不足 → 不激活、不耗能、不进冷却**（沿用既有规则）。
 *   - **矿物 1:1 转移**：★ **新增目标级量值词条 `ore_target`**（正值＝给目标增加矿物；已登记进
 *     引擎**量值词条表 `AMOUNT`**，与 `energy_target` 同族同表）。**1:1、不乘任何系数**
 *     （既不乘施放方类别系数、也不乘目标任何系数）—— 引擎在量值落地处对本词条**单独成支**，
 *     不走 `fx[k] * co` 那条按类别系数缩放的通用路径。
 *   - ★ 三条门控（全部落在 Pass1 唯一门控出口 `canImpact`，**零数值变化**）：
 *       ① **自身携带矿物不足**（`< ore_target`）→ 不激活、不耗能、不进冷却（与能量不足同体例）；
 *       ② **目标剩余矿物容量为 0（已满）**→ 不激活、不耗能（沿用既有“存在可影响目标”口径，
 *          目标剩余容量的唯一读口径＝`oreCapacityOf(target) − oreLoadOf(target)`，即既有 `oreRoomOf`）；
 *       ③ 目标容量不足但 > 0 → **照常激活**，实际输送量按
 *          `min(词条值, 自身剩余携带, 目标剩余容量)` **截断**、按**实际输送量**结算。
 *   - **结算统一落地**：Pass1 只记意图（`__pending.oreTransfers`，**零数值变化**），实际转移落在
 *     **结算步骤 3d**（“矿物支出统一落地”：3d-1 消耗 → 3d-2 1:1 输送）——
 *     位置在 3b 采矿入库 / 3c 星区词条**之后**、步骤 4 护盾血量（含全部判死）**之前**：
 *       · 与 3b/3c **互不影响**（3b 只动“本舰矿物仓”，3c 只动“星区储量”，3d 只在两舰之间搬运矿物）；
 *       · 转移**成对且不重复计数**：一条记录＝一次「自身 −N、目标 +N」，同一记录内同额、原子执行；
 *       · 截断量读 **Pass1 快照**（自身携带量／目标剩余容量）+ 单位内运行计数 `ctx.oreAvail`
 *         ⇒ 与遍历顺序无关、镜像对等。
 *   - **低频战报**（`battle.log.oreTransfer`）：★ 仅在**实际输送量 > 0** 时记 1 条，
 *     `n`＝**实际**转移量（非请求量/词条值）、每模块每 tick 至多 1 条，
 *     成句在**结算步骤 3d-2 的落地处**（与数值同批）：`{owner}的{module}：输送 {n} 点矿物给 {target}`。
 * 数值说明：【占位预填】由用户逐级人工调校。
 *   `energy_cost`/`cooldown_ticks` 与「能量输送」同比例占位；`ore_target` 为矿物量（远大于同级的能量量）。
 *   **不写 `icon`**：暂不新增美术资源 → 走既有「名称首字」降级。
 */
export default {
  id: 'oreTransfer',
  nameKey: 'module.oreTransfer', // i18n -> 矿物输送 / Ore Transfer
  name: '矿物输送',
  // icon：★ 不写（暂无对应 SVG 素材）→ 走既有「名称首字」降级（“矿”）
  category: 'mining',
  // 单体 · 仅友方（既有 `ally` 分支已排除自身：同阵营其它存活单位）
  target: { kinds: ['ally'], countMode: 'single', maxCount: 1 },
  effects: {
    cooldown_ticks: 60, // Lv1 占位：冷却（tick）
    energy_cost: 60,     // Lv1 占位：自身消耗能量
    ore_target: 50,      // Lv1 占位：输送给目标的矿物量（**1:1、不乘任何系数**；按目标剩余容量截断）
  },
  maxLevel: 16,
  levels: [
    { level: 5, effects: { cooldown_ticks: 110, energy_cost: 150, ore_target: 90 } },
    { level: 10, effects: { cooldown_ticks: 100, energy_cost: 240, ore_target: 150 } },
    { level: 16, effects: { cooldown_ticks: 90, energy_cost: 360, ore_target: 240 } },
  ],
};
