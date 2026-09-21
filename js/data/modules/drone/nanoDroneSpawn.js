/* ===== data/modules/drone/nanoDroneSpawn.js —— 纳米无人机（召唤 · 无人机类） =====
 * 功能：召唤一个【纳米无人机】临时单位，自带**两个**与召唤模块**同等级**的模块：
 *   **「火炮」`attack/cannon` ×1** ＋ **「纳米无人机」`nanoDroneSpawn` ×1（＝本模块自身）** ——
 *   即召唤出的纳米无人机**自己也能继续召唤**（**允许链式/递归召唤**，用户口径）。
 * 来源：`无人机模块设定.md`「纳米无人机：搭载1个火炮模块，与自身的纳米无人机模块（可继续召唤），
 *   无护盾，血量50，能量恢复20，能量上限500，存活时间＝本模块冷却时间×2（预写数值在属性即可：
 *   占位冷却200 ⇒ `lifespan_ticks 400`，调整冷却时需同步改该值）。」
 * 无人机船舰数据模型统一用 `data/ships.js` 的通用 `'drone'` 模板；本模块经 `effects.summon` 设定种类：
 *   - 图标：**本模块未写 `icon`**（无 SVG 素材）⇒ 模块筹码走「名称首字」降级（“纳”）、召唤单位降级 ▲；
 *   - 携带模组 `modules`：**两条**（火炮 + 本模块自身），等级＝召唤模块等级、`force` 安装不受槽限；
 *     同一 `moduleId` 写两条/自引用都走**同一条** `installModule(..., force=true)` 路径 ⇒
 *     **每次召唤都为新单位新建独立实例**（自引用不会复用、也不会冲突）；
 *   - `attrs.base` 覆写三围（**无护盾**：`shieldCap: 0`）；`temp:true` + `lifespan_ticks` 到期自动死亡；
 *   - `maxSummoned`＝在场存活上限（**按 `summonMod === inst.moduleId` 分模块计数** ⇒ 见下“链式召唤”）。
 * ★ **链式/递归召唤的引擎层结论（未加任何额外限制）**：
 *   ① 子体自带的 `nanoDroneSpawn` 是**独立实例**（独立冷却/能量），等级＝父实例等级；
 *   ② 在场上限判据 `doSummon`：`n = 本阵营存活且 summonMod === inst.moduleId 的单位数`，
 *      达 `maxSummoned` 即**不再召唤**。由于**父实例与所有子体实例的 `moduleId` 完全相同**
 *      （都是 `'nanoDroneSpawn'`）⇒ 它们**共用同一个计数** ⇒ **每阵营纳米无人机总存活数硬性 ≤
 *      `maxSummoned`**（Lv1＝2 / Lv5＝3 / Lv10＝4 / Lv16＝5），**不可能无限增长**；
 *   ③ 另有**三重自然约束**：`cool_first`＋`cooldown_ticks 200`（每个实例每 200t 至多召 1 架）、
 *      `temp:true`＋`lifespan_ticks 400`（每架 400t 后自动死亡移出场景）、`energy_cost 50`（每次扣能）；
 *   ④ Pass1 的**行动名单是 tick 起始快照**（`battle.js`：`pass1Units`；注释“召唤新增由 pendOf 惰性
 *      创建、**下 tick 才开始行动**”）⇒ 本 tick 新召出的纳米无人机**本 tick 不会行动**，
 *      不存在“同 tick 内连锁爆炸式召唤”；
 *  ⑤ 结论：链式召唤**只能维持/回补**这个上限内的种群（子体阵亡/到期后由仍在场的同族补召），
 *      **不会失控**；`maxSummoned` 是最硬的闸门，故**不需要新增任何防递归限制**。
 * 定位 `role`：**未写 `attrs.role`** ⇒ 沿用通用无人机模板的 `combat`（文档未指定定位）。
 * ★ 数值来源标注（逐条）：
 *   · 【用户给定】`base.hp 50`、`base.shieldCap 0`（**无护盾**）、`base.energyRegen 20`、
 *     `base.energyCap 500`、`lifespan_ticks 400`（＝**冷却 200 × 2**）；
 *   · 【占位预填 · 待用户调校】`cooldown_ticks 200`、`energy_cost 50`、
 *     `maxSummoned 2/3/4/5`（Lv1/Lv5/Lv10/Lv16）；
 *   · 逐级表：**只放大占位项 `maxSummoned`**；用户给定数值（hp 50 / 无盾 / 回能 20 / 上限 500 /
 *     存在 400t）**各级保持不变**（与其它无人机同一口径：给定值不随级漂移）。
 * ⚠ **联动提醒**：`lifespan_ticks = 冷却 × 2` 是**预写死的数值**（用户口径：不做运行时联动计算）
 *   ⇒ **若后续调整 `cooldown_ticks`，必须同步手工改本文件的 `lifespan_ticks`**（两处都在本文件内）。
 * 数值说明：【占位预填 · 待用户调校】（用户给定的五项除外）。
 */
export default {
  id: 'nanoDroneSpawn',
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
  nameKey: 'module.nanoDroneSpawn', // i18n -> 纳米无人机（未显式命名时作为召唤单位显示名）
  name: '纳米无人机',
  category: 'drone',
  target: {}, // 召唤类：无命中目标（走 summon 执行）
  effects: {
    type: ['summon', 'cool_first'], // 召唤钩子；cool_first＝部署即进入冷却（开场不会立刻召唤）
    summon: {
      type: 'drone', // 通用无人机模板
      // 携带：**火炮 ×1** ＋ **本模块自身 ×1**（可继续召唤；两条都逐条 force 安装成独立实例）
      modules: [{ moduleId: 'cannon' }, { moduleId: 'nanoDroneSpawn' }],
      attrs: {
        // 【用户给定】hp 50 / 无护盾(shieldCap 0) / energyRegen 20 / energyCap 500
        base: { hp: 50, shieldCap: 0, energyCap: 500, energyRegen: 20 },
      },
      // 【用户给定】＝冷却 200 × 2（预写数值；调整冷却需同步改本值），仅 temp:true 生效
      lifespan_ticks: 400,
      maxSummoned: 5, // 在场存活上限【占位预填】（链式召唤与父实例共用此上限）
      temp: true,     // 临时单位：到期自动死亡 + 阵亡直接移出场景
    },
    cooldown_ticks: 200, // 每次补召间隔【占位预填，各级沿用 Lv1；改它须同步改上面的 lifespan_ticks】
    energy_cost: 50,     // 每次召唤能耗【占位预填，各级沿用 Lv1】
  },
  maxLevel: 16,
  levels: [
    // 逐级**占位**：**只**放大 maxSummoned；用户给定数值（hp/无盾/回能/上限/存在时间）各级不变
    { level: 5, effects: { summon: { attrs: { base: { hp: 50, shieldCap: 0, energyCap: 500, energyRegen: 20 } }, lifespan_ticks: 400, maxSummoned: 5 } } },
    { level: 10, effects: { summon: { attrs: { base: { hp: 50, shieldCap: 0, energyCap: 500, energyRegen: 20 } }, lifespan_ticks: 400, maxSummoned: 5 } } },
    { level: 16, effects: { summon: { attrs: { base: { hp: 50, shieldCap: 0, energyCap: 500, energyRegen: 20 } }, lifespan_ticks: 400, maxSummoned: 5 } } },
  ],
};
