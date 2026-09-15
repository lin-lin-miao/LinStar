/* ===== data/modules/transport/cargoRepair.js —— 货物维修（运输 · 主动 · 消耗整件已入舱货物修血） =====
 * 功能：**消耗自身货舱里的一整件货物**（实体销毁、不返还星区），按下述口径修复**单体友方（含自身）**的生命。
 *   - **分类＝运输**：`category:'transport'`（代表色**亮黄**），文件在 `data/modules/transport/`（目录与分类一致）。
 *   - **主动模块**：有 `cooldown_ticks`（冷却）与 `energy_cost`（自身消耗）。
 *   - **目标**：`{ kinds:['ally','self'], countMode:'single', maxCount:1 }` ——
 *     **“友方（同阵营其它存活）+ 自身”**：`ally` 桶排除自身、`self` 桶为自身，两桶任一允许即可选
 *     （既有 `moduleTargetList`/`candList` 同源口径，**未新造选择器**）。
 *     ★ **自身没有隐式优先级**（目标选择口径修正后）：`self` 与 `ally` **同源同序**，自身只出现在它的
 *     **自然位置**——**队列中轮到自身时结果才是自身**；己方只剩自身/自身排在队首时自然选中自身
 *     （本模块**不带** `prefer_self`）。玩家可用详情页目标按钮改指他人。与「矿物维修」`oreRepair` **完全同体例**。
 *   - ★ **只消耗“已装载完成（已入舱）”的货物**（用户口径）：只从 `cargoListOf(ship)` 里选 ——
 *     **在装（锁定中、尚未入舱）的货物不在该清单内** ⇒ 天然不可被消耗；引擎另有防御性判据 `cargo._loadBy`。
 *   - ★ **新词条 `hp_per_ton`**（每吨货物回复的生命值；**逐级递增**，见 levels）：
 *       `回血量 = Math.round(所消耗货物.tons × hp_per_ton)`
 *     · **计算与取整在 Pass1 记账时一次完成并冻结**（体例同 `cargoLoadNeedTicks`/`ore_gain`：
 *       随意图写进 `__pending`，结算阶段**不重算**⇒ 本 tick 内系数/吨位变化不改动已记量）；
 *     · **不乘任何类别系数**：实现方式＝本词条**不进**引擎量值词条表 `AMOUNT`（`hp_per_ton` 不是目标级量值词条，
 *       而是**派生回血量的系数项**），回血量算好后走既有目标级 `hpDeltas`（＝既有 `hp_target` 同一条路径）
 *       ⇒ 通用路径里的 `词条值 × 类别系数` 缩放**根本不适用于它**；**对既有模块零影响**（新词条此前无人使用，
 *       引擎只在带 `cargo_repair` 标签的模块分支里读取它）。
 *   - ★ **选择口径＝吨位最小优先（同吨位 ⇒ 货舱列表顺序，即先入舱者先被消耗）**（用户口径，确定性）：
 *     实现＝在已入舱清单上取 `tons` 最小者、并列时取数组靠前者（**只读选取**，不写任何状态）。
 *   - ★ **三条门控**（Pass1 唯一门控出口 `canImpact` + 既有成本门控，**零数值变化**）：
 *       ① **自身无已入舱货物** → 不激活、不耗能、不进冷却；
 *       ② **能量不足**（`energy_cost`）→ 同上（`ctx.avail`，与既有能量门控同一处）；
 *       ③ **目标满血**（`hp >= hpMax`）→ 不激活、不耗能、不进冷却（沿用既有 `canImpact` 通用量值循环里
 *          `hp_target` 的 `atCap` 判据：`t.hull.hp >= t.hull.hpMax`；全满 ⇒ 无可影响目标）。
 *   - ★ **结算统一落地（新增 3d-4 + 复用步骤 4c）**：Pass1 只记意图（**零数值变化**）：
 *       · **货物销毁** → `__pending.cargoRepairs` → **结算步骤 3d-4**（位置：3d-3 货物传输**之后**、
 *         步骤 4（含全部判死）**之前**）：把该实体移出 `ship.cargos` 并 `hull.cargo` 相应减少
 *         （与实体清单同写同源、**不返还星区**）；**幂等**判据＝该实体是否仍在 `ship.cargos` 内
 *         （不在 ⇒ 跳过，绝不重复扣吨位）；同一步写非数值标记 `inst._cargoPaid/_cargoPaidTick` 供 4c 成句。
 *       · **回血** → 走既有**步骤 4c `applyHpTo`**（正值按 `hpMax` 截断、**不受受伤减免**），
 *         与既有 `hp_target` 同一条路径（Pass1 已把冻结好的量写进目标 pending 的 `hpDeltas`）。
 *       · **顺序＝先扣货物（3d-4）、后回血（4c）**（3d 恒在步骤 4 之前）——与「矿物维修」的
 *         “同 tick 先扣矿（3d-1）、后回血（4c）”**完全同口径**；两者成对同 tick，不存在只扣不回。
 *   - ★ **低频战报**（`battle.log.cargoRepair`）：仅**实际回血 > 0**（`applyHpTo` 前后差值 ⇒ 天然含 hpMax 截断）
 *     **且本 tick 确实销毁了货物**（`inst._cargoPaidTick === 本 tick`）时 1 条、每模块每 tick ≤ 1 条，
 *     成句在**步骤 4c 回血落地处**（与数值同批）：
 *     `{owner}的{module}：消耗 {cargo}，修复 {target} {amount} 点生命`。
 * 数值说明：【占位预填】由用户逐级人工调校（`hp_per_ton`：每吨货物换回的生命点数）。
 *   · ★ **同 tick 货物预留**：选中后即登记进**每 tick 全局集合** `cargoClaimedTick`（货物链三处——
 *     传输/维修/强化——共用，先到先得）⇒ 同一件货物在一个 tick 内只会被**搬运/消耗/强化其中一种**。
 *   **不写 `icon`**：暂不新增美术资源 → 走既有「名称首字」降级（“货”）。
 */
export default {
  id: 'cargoRepair',
  nameKey: 'module.cargoRepair', // i18n -> 货物维修 / Cargo Repair
  name: '货物维修',
  category: 'transport',
  target: { kinds: ['ally', 'self'], countMode: 'single', maxCount: 1 },
  effects: {
    // ★ `cargo_repair`＝**货物换血能力标签**（行为开关；引擎按标签识别，**不硬编码模块 id**）
    type: ['cargo_repair'],
    cooldown_ticks: 60, // 修复间隔（各级沿用 Lv1）
    energy_cost: 60,    // Lv1 占位：自身消耗能量
    hp_per_ton: 10,      // Lv1 占位：**每吨货物**回复的生命值（回血量 = round(货物吨位 × 本值)）
  },
  maxLevel: 16,
  levels: [
    { level: 5, effects: { energy_cost: 90, hp_per_ton: 20 } },
    { level: 10, effects: { energy_cost: 130, hp_per_ton: 30 } },
    { level: 16, effects: { energy_cost: 180, hp_per_ton: 50 } },
  ],
};
