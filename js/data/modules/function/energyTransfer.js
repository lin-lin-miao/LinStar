/* ===== data/modules/function/energyTransfer.js —— 能量输送（功能 · 主动 · 消耗自身能量给友方加能量） =====
 * 功能：**消耗自身能量 → 增加目标能量**。
 *   - **主动模块**（走既有“激活-触发”流程）：有 `cooldown_ticks`（冷却）与 `energy_cost`（自身消耗）。
 *   - **目标**：`kinds: ['ally']` + `countMode:'single'` + `maxCount:1` —— **单体、仅友方**。
 *     ★ 既有选择器的 `ally` 分支即 `同阵营其它存活单位`（`battle.js moduleTargetList`：
 *       `sameSide.filter(u => u.alive && u.id !== ship.id)`）→ **天然排除自身**，无需引擎改动。
 *       复用既有**目标优先级链**（强制目标 > 模块手动目标 > 船 targetId > 自动粘性 > 全队策略）与
 *       手动目标机制（详情页可点选友方单位）；潜行过滤/锁定等既有规则照常适用。
 *     ★ **无可用目标 → 不激活**（既有 `moduleTargetList` 返回空 → `maybeActivate` 直接返回，
 *       **不耗能、不进冷却**，与 EMP/火炮等既有模块完全同一路径）。
 *   - **自身消耗**：既有 `energy_cost` + `payEnergy`（Pass1 只记账，扣减单位内运行计数 `ctx.avail` 做门控）；
 *     **能量不足 → 不激活**（`ctx.avail = min(energyCap, tick 起始能量 + 本 tick 回充) < energy_cost` → 直接返回，
 *      不耗能、不进冷却，沿用既有规则）。
 *   - **目标增加**：既有**目标级量值词条** `energy_target`（**正值＝给目标加能量**）；
 *     Pass1 只记 `__pending.energyDeltas`，由**结算步骤 3** 既有能量统一落地
 *     （回充 → 模块消耗 → `energy_target` 增量）→ 用既有 `applyEnergyTo` **钳到目标能量上限**、不超额。
 *     目标级量值同样按**施放方类别系数**缩放（`× coeff(ship,'function')`），与其它量值词条同口径。
 *   - ★ **可行性口径（既有）**：`canImpact` 对**正的目标级量值词条**要求“至少一个目标未满”
 *     （`energy_target > 0` → 目标能量 ≥ 上限则**本次不激活**：不耗能、不进冷却）。
 *     即**目标能量已满时不会白耗自身能量**；目标未满时照常输送，超出部分由上限钳掉。
 *   - **不产生战报**：`energy_target` 量值在结算步骤 3 落地时**既无战报也无统计**（与既有
 *     「电磁脉冲」等目标级量值同一口径）；为避免“同一词条两套口径”，本模块不新增战报键。
 *     （如后续需要，可按 `战报日志开发要点.md` 的低频体例在结算步骤 3 成句：
 *      `{actor}的{module}向{target}输送了 {amount} 点能量`，仅当实际增加量 > 0 时记一条。）
 * 数值说明：【占位预填】由用户逐级人工调校。
 *   `energy_cost` 取 ≈输送量的 60%（体现“输送有损耗”）；`cooldown_ticks` 随等级小幅缩短。
 */
export default {
  id: 'energyTransfer',
  nameKey: 'module.energyTransfer', // i18n -> 能量输送 / Energy Transfer
  name: '能量输送',
  category: 'function',
  // 单体 · 仅友方（既有 `ally` 分支已排除自身：同阵营其它存活单位）
  target: { kinds: ['ally'], countMode: 'single', maxCount: 1 },
  effects: {
    cooldown_ticks: 60, // Lv1 占位：冷却（tick）
    energy_cost: 60,     // Lv1 占位：自身消耗能量
    energy_target: 30,  // Lv1 占位：给目标增加的能量（钳到目标能量上限）
  },
  maxLevel: 16,
  levels: [
    { level: 5, effects: { cooldown_ticks: 110, energy_cost: 150, energy_target: 250 } },
    { level: 10, effects: { cooldown_ticks: 100, energy_cost: 240, energy_target: 400 } },
    { level: 16, effects: { cooldown_ticks: 90, energy_cost: 360, energy_target: 600 } },
  ],
};
