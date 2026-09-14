/* ===== data/modules/mining/slagMissileLauncher.js —— 矿渣导弹发生器（采矿 · 召唤矿渣导弹） =====
 * 功能：消耗**自身携带的矿物**，召唤一枚【矿渣导弹】。结构与既有「欧米茄导弹发射器」
 *   （`omegaMissileLauncher`）**完全相同**，差异只在“成本来源”与“弹头模块/数值”（占位预填）：
 *   · **分类＝采矿**：`category:'mining'`（用户口径：矿渣系＝采矿类，代表色**紫**），
 *     文件亦在 `data/modules/mining/`（**目录与分类一致**，已由用户移动并就位）。
 *     ★ **分类改为采矿不会让本模块的任何数值变化**：本模块**没有任何按类别系数缩放的词条** ——
 *       `ore_cost`（成本词条，与 `energy_cost` 同体例，按**词条原值**扣除）、`cooldown_ticks`、
 *       `summon` 各项**都不乘系数**；弹头伤害走**弹头自身类别**（`slagMissileWarhead` 仍为**攻击类**）
 *       并乘**召唤单位**的攻击系数，与本模块分类**无关**。
 *   · **不消耗能量、只消耗矿物**：
 *       - ★ **不写** `energy_cost`（＝无需能量）→ 引擎能量门控（`ctx.avail < cost`，`cost = 0`）
 *         **恒不拦它**，也不会占用同单位其它模块的能量预算；
 *       - ★ **新增自身词条 `ore_cost`** ＝**一次施放消耗的携带矿物量**（从**自身** `hull.ore` 扣，
 *         唯一读口径 `oreLoadOf`）。门控与既有能量成本**完全同体例**：携带不足 → **不激活、
 *         不扣矿物、不进冷却**；门控落在 **Pass1**（召唤型模块的成本门控与能量门控同一处，见
 *         `battle.js maybeActivate` 的“成本门控”与 `doSummon` 内的复核），
 *         ⚠ 召唤型模块按既有设计**不进入 `canImpact`**（无目标级判定），故其成本门控就在该处；
 *         **扣减在结算阶段统一落地**（结算步骤 3d，Pass1 零数值变化）。
 *   · **召唤参数与欧米茄完全相同**：`lifespan_ticks: 500`、`maxSummoned: 2`、
 *     **不写** `bind_target`（不锁定目标 → 每次激活按正常目标链重新解析）、
 *     **不写** `projectile`（不是弹体类单位、不被打 `isProjectile`），模板复用通用 `drone`。
 *   · **携带模组**＝「矿渣导弹爆炸」（`slagMissileWarhead`，等级＝本模块等级）。
 *   · **召唤物系数继承**：沿用既有唯一口径 —— 召唤瞬间**按召唤者当期系数快照**继承（`drone` 等
 *     全部类别），此后不再同步；本模块未做任何特殊处理。
 *   - **图标已接线**：`icon: 'assets/img/矿渣导弹发射器.svg'`（紫色矿渣系）、
 *     `summon.attrs.icon: 'assets/img/矿渣导弹.svg'`（召唤单位图标），与欧米茄同体例；
 *     两个素材文件**已就位**（`assets/img/矿渣导弹.svg`、`assets/img/矿渣导弹发射器.svg`）。
 *     ⚠ 降级行为（若素材缺失/路径失效）——**不会抛异常、也不会留破图**：
 *       · 召唤单位：`unitIcon` 带 `error` 监听 → 回退 ▲；
 *       · 模块筹码：`moduleGlyphEl` 亦已具备 `error` 回退 → 就地替换为**与“无 `icon`”完全一致**的
 *         「名称首字」节点（“矿”），不残留破图占位。
 *   - 召唤/命中/爆炸战报走既有链路（`battle.log.summon`；命中/爆炸/溅射由 `applyHit` 成句），**无需新键**。
 *   - 召唤计时：`cool_first` 使其“部署即进入冷却”，开场不会立刻发射（与欧米茄一致）。
 * 数值说明：【占位预填】冷却/耗矿/召唤三围/存活时长由用户逐级人工调校。
 *   `ore_cost` 取与欧米茄 `energy_cost: 750` 相当的量级（矿物本身还需采矿获得，故略低）；
 *   逐级小幅递增（矿渣导弹的“矿耗”越高＝等级越高）。
 */
export default {
  id: 'slagMissileLauncher',
  nameKey: 'module.slagMissileLauncher', // i18n -> 矿渣导弹发生器 / Slag Missile Launcher
  name: '矿渣导弹发生器',
  icon: 'assets/img/矿渣导弹.svg', // ★ 紫色矿渣系（与采矿类代表色 #B06BFF 同色）
  category: 'mining',
  // 召唤类模块：**无命中目标**（走 summon 执行；引擎对“无 `bind_target`/`per_target` 的召唤模块”
  // 不解析模块目标，只做成本/冷却/在场上限门控 —— 与欧米茄/既有 laserDroneSpawn 同一体例）。
  target: { kinds: ['enemy'], countMode: 'single', maxCount: 1, exclude: ['projectile'] },
  effects: {
    // 机制标签列表（引擎按标签识别、不按模块 id 硬编码）：
    //   summon     = 召唤钩子（激活时按 effects.summon 补召一个临时单位）
    //   cool_first = 部署即进入冷却（以 cooldown_ticks 起算，开场不会立刻召唤一枚）
    type: ['summon', 'cool_first'],
    summon: {
      type: 'drone',                  // 复用通用召唤模板（种类差异由下方 attrs/modules 覆写）
      // bind_target：★ **不写** —— 导弹召唤后不锁定目标（每次激活按正常目标链重新解析）
      // projectile：★ **不写** —— 不是弹体类单位（不被打 isProjectile 标签、不被发射器 exclude 排除）
      modules: [{ moduleId: 'slagMissileWarhead' }], // 携带「矿渣导弹爆炸」（等级=本模块等级）
      attrs: {
        nameKey: 'ship.slagMissile',  // 显示名 -> 矿渣导弹
        icon: 'assets/img/矿渣导弹.svg', // ★ 召唤单位图标（紫色矿渣系；由 `unitIcon` 读取）
        base: { hp: 50, shieldCap: 600, energyCap: 160, energyRegen: 8 }, // 占位：与欧米茄同三围
      },
      lifespan_ticks: 500,            // 保险存活上限（通常引信先到即引爆自毁）
      maxSummoned: 2,                 // ★ 同阵营本模块在场存活上限 2（复用既有召唤上限机制）
      temp: true,                     // 临时单位：到期自动死亡、阵亡/到期直接移出场景
    },
    // cooldown_ticks：召唤间隔（与欧米茄同值占位）
    cooldown_ticks: 600,
    // ★ energy_cost：**不写** —— 本模块无需能量（不会被能量门控拦截，也不占同单位能量预算）
    // ★ ore_cost＝一次施放消耗的**自身携带矿物**（结算步骤 3d 统一扣除；不足则不激活）
    ore_cost: 500,                    // Lv1 占位：每次召唤消耗的携带矿物量
  },
  maxLevel: 16,
  levels: [
    { level: 5, effects: { summon: { attrs: { base: { shieldCap: 700 } }, lifespan_ticks: 520 }, ore_cost: 550 } },
    { level: 10, effects: { summon: { attrs: { base: { shieldCap: 800 } }, lifespan_ticks: 540 }, ore_cost: 600 } },
    { level: 16, effects: { summon: { attrs: { base: { shieldCap: 1000 } }, lifespan_ticks: 560 }, ore_cost: 650 } },
  ],
};
