/* ===== data/modules/transport/cargoTransfer.js —— 货物传输（运输 · 主动 · 把整件已入舱货物送给友方） =====
 * 功能：把自身货舱里**一整件已装载完成的货物**原样传输给**单体友方**（实体搬运：同一 `id`/`tons`/`level`/
 *   `loadTicks` 一并过去，**不是**按吨位换算的数值转移）。
 *   - **分类＝运输**：`category:'transport'`（代表色**亮黄**），文件在 `data/modules/transport/`（目录与分类一致）。
 *   - **主动模块**（走既有“激活-触发”流程）：有 `cooldown_ticks`（冷却）与 `energy_cost`（自身消耗）。
 *   - **目标**：`kinds:['ally']` + `countMode:'single'` + `maxCount:1` —— **单体、仅友方**，
 *     既有 `ally` 桶＝“同阵营其它存活单位”（`battle.js moduleTargetList` 已排除自身）⇒ **天然排除自身**，
 *     与「矿物输送」`oreTransfer` **完全同体例**（复用既有目标优先级链，不新造选择器）。
 *     ★ **无可用目标 → 不激活**（目标池为空 ⇒ `maybeActivate` 直接返回，不耗能、不进冷却）。
 *   - ★ **只搬运“已装载完成（已入舱）”的货物**（用户口径）：被搬运物只从 `cargoListOf(ship)` 里选 ——
 *     **在装（锁定中、尚未入舱）的货物根本不在该清单内** ⇒ 天然不可被传输；引擎另有一道防御性判据
 *     `cargo._loadBy`（在装货物恒带锁定索引）⇒ **双保险**。
 *   - ★ **选择口径＝货舱列表顺序第一件（FIFO：先入舱者先转出）**（确定性规则，见下“选择口径”）。
 *   - ★ **三条门控**（全部落在 Pass1 唯一门控出口 `canImpact`，**零数值变化**）：
 *       ① **自身无已入舱货物** → 不激活、不耗能、不进冷却；
 *       ② **目标剩余货舱 < 所选货物吨位**（含目标剩余货舱为 0）→ 不激活、不耗能、不进冷却
 *          （唯一读口径 `cargoRoomOf(target)`＝货物容量 − 已用 − 在装预留）；
 *       ③ **能量不足**（`energy_cost`）→ 不激活、不耗能、不进冷却（与既有能量门控同一处 `ctx.avail`）。
 *   - ★ **选择口径（FIFO）**：与「货物维修」的“吨位最小优先”**不同**，本模块按**货舱列表顺序取第一件**
 *     （即 `ship.cargos` 数组首位＝最早入舱者）。理由：传输是**搬运**而非**消耗**，用户的意图是“把货挪给谁”，
 *     按入舱先后（FIFO）最直观、也最可预期；两者都是**确定性**口径（数组顺序可复现，且选取**只读**、不写状态）。
 *     ⚠ 若用户希望两模块统一为“吨位最小优先”，只需改本模块的选择函数调用（引擎一处），数值不受影响。
 *   - ★ **结算统一落地（新增 3d-3，唯一落地/搬运点）**：Pass1 只记意图（`__pending.cargoTransfers`，
 *     **零数值变化**），实际搬运落在**结算步骤 3d-3**（位置：3d-2 矿物输送**之后**、3d-4 货物维修消耗
 *     **之前**；整段 3d 都在步骤 4（含全部判死）**之前**）：
 *       · **成对原子**：一条记录＝一次「自身货舱 −整件 / 目标货舱 +整件」，**同一实体**先出后入，
 *         不存在只出不入/只入不出的中间态；
 *       · `hull.cargo`（数值口径 `cargoLoadOf`）与**实体清单**（`cargoListOf`）**同写同源** ⇒ 不会漂移；
 *       · **不修改 `loadTicks`**（用户口径：传输保留原特性，含“已装好”的 20t）；
 *       · 落地时按**当前剩余货舱再钳一次**（防御性复核）：**装不下则整件不转**（确定性规则——
 *         转移是**整件原子**的，不存在“转一半”；该情形在 Pass1 已被门控挡住，正常不会发生）；
 *       · 施放方与目标在本步骤恒存活（判死都在其后）⇒ 与“谁先谁后死”无关。
 *   - ★ **确定性与镜像对等**：被搬运物由**本单位自己的货舱**在 Pass1 按固定顺序选定，一次一条记录 ⇒
 *     **与全局遍历顺序无关**；双方阵营互换后规则完全对称（同一条规则只认“本单位已入舱货物的第一件”）。
 *   - ★ **同 tick 货物预留**：选中后即登记进**每 tick 全局集合** `cargoClaimedTick`（货物链三处——
 *     传输/维修/强化——共用，先到先得，收集顺序＝固定结算顺序 allies → enemies）⇒ 同一件货物在一个
 *     tick 内只会被**搬运/消耗/强化其中一种**（同单位多模块也不会选中同一件），可复现、不互相踩踏。
 *   - ★ **低频战报**（`battle.log.cargoTransfer`）：**仅实际搬运成功时 1 条**、每模块每 tick ≤ 1 条
 *     （单目标单件 ⇒ 天然至多一条），成句在**落地处**（步骤 3d-3，与数值同批）：
 *     `{owner}的{module}：把 {cargo} 传输给 {target}`。
 * 数值说明：【占位预填】由用户逐级人工调校。
 *   · 本模块**无数值效果词条**（搬运“整件”，不做吨位换算）⇒ 逐级表只调**周期/耗能**：
 *     `cooldown_ticks` 逐级略降、`energy_cost` 恒定（若希望“越高越贵/越快”，直接在 levels 里改即可）。
 *   · **不写 `icon`**：暂不新增美术资源 → 走既有「名称首字」降级（“货”）。
 */
export default {
  id: 'cargoTransfer',
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
  nameKey: 'module.cargoTransfer', // i18n -> 货物传输 / Cargo Transfer
  name: '货物传输',
  category: 'transport',
  // 单体 · 仅友方（既有 `ally` 分支已排除自身：同阵营其它存活单位）
  target: { kinds: ['ally'], countMode: 'single', maxCount: 1 },
  effects: {
    // ★ `cargo_transfer`＝**货物搬运能力标签**（行为开关；引擎按标签识别，**不硬编码模块 id**）
    type: ['cargo_transfer'],
    cooldown_ticks: 60, // Lv1 占位：冷却（tick）
    energy_cost: 60,     // Lv1 占位：自身消耗能量
  },
  maxLevel: 16,
  levels: [
    { level: 5, effects: { cooldown_ticks: 55, energy_cost: 60 } },
    { level: 10, effects: { cooldown_ticks: 50, energy_cost: 60 } },
    { level: 16, effects: { cooldown_ticks: 45, energy_cost: 60 } },
  ],
};
