/* ===== data/modules/transport/loadingBeam.js —— 装载光束（运输 · 货物装载） =====
 * 功能：把**星区里的货物**装进本舰**货舱**（占用货物容量），装载完成后货物**永久**变为
 *   「一次装好」（`loadTicks` 改写为 `CARGO_FAST_LOAD_TICKS`＝20t，见 `data/cargo.js`）。
 *   - **主动模块**（占位耗能 `energy_cost`），**无自身冷却**（不写 `cooldown_ticks` ⇒ 取缺省
 *     1 tick/次判定）：真正的“忙/闲”判据＝**本模块当前是否正在装载**（每模块实例**同一时刻至多
 *     1 件**在装）⇒ 装载期间**不再重复扣能量**。
 *   - **无目标**（`target: {}`）：本模块**不进入目标选择链**（引擎按“自身词条”处理，
 *     与采矿激光 `ore_gain` 完全同体例）；装载对象是**星区货物**，不是战斗单位。
 *   - ★ **行为标签 `cargo_loader`**（`type` 数组）＝**装载能力的唯一开关**：引擎据此把本模块
 *     识别为“装载器”（**不按模块 id 硬编码**）——具备装载能力、无需目标、并进入装载门控。
 *   - ★ **数值词条 `cargo_load`**＝**装载速度加成**（本模块贡献的速度项，见下）。
 *     **标签管“能不能装”、词条管“多快”**：二者解耦 ⇒ 将来任何模块只要带该标签即具备装载能力，
 *     词条值可以逐级变化（也可为 0＝无速度加成）。
 *   - ★ **装载时间（用户口径）**：`需求 tick = round(货物装载时间 ÷ 速度)`，**下限 1t**；
 *        速度 = `1 + 本词条值 + (coeff(拥有者,'transport') − 1)`
 *             = 1 + 0.1 + 1 − 1 = **1.1**（Lv1 占位、运输系数 1）⇒ 300t 货物 ⇒ `round(300/1.1) = 273t`（≈13.7s）。
 *     取整与下限的**唯一实现位置**＝引擎 `systems/battle.js` 的 `cargoLoadNeedTicks()`（Pass1 裁决获胜时
 *     按 tick 起始快照算好一次、随意图一起记入 `__pending`，故本 tick 内系数变化不改动已记需求）。
 *   - ★ **同一 tick 争抢同一件货物 ⇒ 装载速度高者先认领**（用户口径）：本 tick 全部装载器的认领申请
 *     由引擎 `resolveLoadClaims()` **跨阵营统一按装载速度从高到低**排序裁决，同一件货物**只有一个赢家**；
 *     **同速**按**固定遍历序**（allies → enemies、组内既定顺序）先到先得 ⇒ 确定、可复现；
 *     败者**不激活**（不耗能、不进冷却）并继续尝试下一件；速度口径与上面公式**同一函数**（不另算第二套）。
 *   - ★ **结算时序（★ 统一落地）**：Pass1 **只记意图**（`__pending.cargoLoadOps`，**零数值变化**）；
 *     锁定货物 / 进度推进 / 完成入舱 全部在**结算阶段**统一落地（见引擎文件头「结算步骤 5」）。
 *   - **解锁条件**：本模块被**停用**、或**拥有者阵亡** ⇒ **立即解锁货物、进度归零**（下次从头开始），
 *     **已消耗能量不退**；拥有者在本 tick 死亡时**不完成装载**（完成判定恒在全部判死之后）。
 *   - **单位阵亡返还**：已装载的货物**全额返还星区**（同一 id、**追加到星区列表末尾**——队列式
 *     前出后入、**不恢复初始顺序**；幂等）。
 *   - **不产生战报**（本轮口径；低频事件如需播报再定）。
 *   - 无 `icon`：暂无对应 SVG 素材 → 走既有降级（显示名称首字「装」）；素材就位后补 `icon` 即可。
 * 数值说明：【占位预填】由用户逐级人工调校（`cargo_load` 为 Lv1/Lv5/Lv10/Lv16 四档锚点，中间等级沿用上一档）。
 */
export default {
  id: 'loadingBeam',
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
  nameKey: 'module.loadingBeam', // i18n -> 装载光束 / Loading Beam
  name: '装载光束',
  category: 'transport',
  // ★ 无目标：`kinds` 缺省 ⇒ 候选池为空、不进入目标选择链（作用于“星区货物 → 本舰货舱”）
  target: {},
  effects: {
    // ★ `cargo_loader`＝装载能力标签（行为开关；引擎按标签识别，不硬编码模块 id）
    type: ['cargo_loader'],
    cargo_load: 0.1,     // Lv1 占位：装载速度加成（速度 = 1 + 本值 + (运输系数 − 1)）
    energy_cost: 20,     // Lv1 占位：每次“开始装载”耗能（装载期间不再重复扣；停用/阵亡不退）
  },
  maxLevel: 16,
  levels: [
    { level: 5, effects: { cargo_load: 0.2 } },
    { level: 10, effects: { cargo_load: 0.35 } },
    { level: 16, effects: { cargo_load: 0.5 } },
  ],
};
