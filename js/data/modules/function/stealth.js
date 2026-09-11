/* ===== data/modules/function/stealth.js —— 潜行（功能 · 不可被选为主要攻击目标） =====
 * 机制（对照《模块字段说明.md》，**全部复用既有词条/标签，不新增伤害体系、不改任何数值**）：
 *  · **作用**：使**作用集合内**的单位**不能成为主要攻击目标**（其它单位的目标解析一律跳过它）；
 *      · **仍会受到溅射影响**：`blast_range` 波及与 `applyHit` 侧**不做任何潜行过滤/减免**；
 *      · **仍受“目标锁定”影响**：激活瞬间**已锁定**的目标照常有效 ——
 *        `lockTargetId`（一次性火箭/导弹弹体）与 `lock_target_on_activate` 的锁定集合 `inst._lockIds`
 *        在解析链中**直接返回、豁免潜行过滤**（潜行是“事后生效”，不推翻既有锁定）；
 *      · **不影响友方/自身**：只挡“把对方当敌人打”，支援类模块解析到潜行单位（友军或自己）照常。
 *  · **目标**：**自身单体** —— `kinds:['self']` + `countMode:'single'`（既有选择器表达方式，
 *    引擎不硬编码模块 id）；故“作用集合”＝自身（见 `effectSetOf`）。
 *  · **持续性模块**：由 `duration_ticks > 0` 判定（★ **不要**写 `'duration'` 标签，那不是合法标签）；
 *    持续期结束是唯一的自动撤销时机（到期 / 停用 / 携带者阵亡 / 移出场景 / 重新激活前统一 `releaseStealth`）。
 *  · **激活后清空能量上限**：复用词条 `energy_cap_target: -1000000`（**大负值占位＝把上限压到 0**，
 *    与电磁脉冲同口径：引擎按目标基准重算后 clamp 至 0，当前能量随之 clamp 到 0）——
 *    即“开启潜行＝把自己的能量系统压死”的取舍；作用对象为**自身**（本模块选择器即自身）。
 *  · **新特殊 `type` 标签 `stealth`**（引擎按标签识别、**不按模块 id 硬编码**）：激活后在**结算阶段**
 *    （Pass2 结算步骤 2，与 `capOps`/`coeffOps`/`timeOps` 同批、先于伤害结算）对作用集合内的单位
 *    **添加结构标记**（`ship.stealthMods` + 派生 `ship.isStealth`，唯一读口径 `isStealthed`），
 *    **只改“能不能被选为主要目标”这一结构状态，不改任何数值**；Pass1 只记账（`__pending.stealthOps`），
 *    目标解析读 tick 起始快照 `u._stealthTick` → 从**下一 tick 的目标解析**起体现。
 *  · **战报（低频聚合）**：不逐次激活播报、不逐单位播报（标记类不做高频播报）；仅“从无→有”记 1 条
 *    「{owner}的{module}生效：{n}个单位进入潜行」、“从有→无”记 1 条
 *    「{owner}的{module}潜行结束：{n}个单位」（效果结束类一律带**模块拥有者**；同 tick 到期并重新激活整体静默）。
 * 数值说明：【占位预填】duration_ticks / cooldown_ticks / energy_cost 由用户逐级人工调校。
 */
export default {
  id: 'stealth',
  nameKey: 'module.stealth', // i18n -> 潜行 / Stealth
  name: '潜行',
  category: 'function',
  target: { kinds: ['self'], countMode: 'single', maxCount: 1 }, // 自身单体（增益对象＝自己）
  effects: {
    // 机制标签列表（可多个；引擎按标签识别、不按模块 id 硬编码）。
    // 是否持续型一律由 `duration_ticks > 0` 判定（`'duration'` 不是合法标签）。
    type: ['stealth'],            // ★ 新标签：潜行（不可被选为主要攻击目标；仍受溅射/仍受锁定影响）
    energy_cap_target: -1000000,  // 复用：大负值占位＝把**自身**能量上限压到 0（“清空”，与 EMP 同口径）
    duration_ticks: 100,          // Lv1 占位：持续 5s
    cooldown_ticks: 300,          // Lv1 占位：持续结束后冷却 15s
    energy_cost: 200,             // Lv1 占位：每次开启耗能
  },
  maxLevel: 16,
  levels: [
    { level: 5, effects: { duration_ticks: 140, cooldown_ticks: 280, energy_cost: 260 } },
    { level: 10, effects: { duration_ticks: 180, cooldown_ticks: 260, energy_cost: 320 } },
    { level: 16, effects: { duration_ticks: 240, cooldown_ticks: 240, energy_cost: 400 } },
  ],
};
