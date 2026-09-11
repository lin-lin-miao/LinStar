/* ===== data/modules/function/omegaMissileLauncher.js —— 欧米茄导弹发射器（功能 · 召唤欧米茄导弹） =====
 * 功能：召唤一枚【欧米茄导弹】（C22「欧米茄火箭」）。与既有「导弹发射器」结构相同，差异如下
 *   （**全部复用既有词条/标签与机制，不新增任何词条**）：
 *   · **分类＝功能性**：`category:'function'`，文件在 `data/modules/function/`。
 *   · **冷却与能耗明显更高**：`cooldown_ticks`/`energy_cost` 占位值高于普通导弹发射器。
 *   · **不锁定目标**（★ 关键差异）：**不写** `effects.summon.bind_target` ——
 *     引擎 `maybeActivate` 的召唤分支据此走 `doSummon(ship, inst, fx, null, false, ctx)`
 *     （`bind_target` 缺省 → `boundId = null`），于是 `doSummon` 内
 *       · **不写** `u.lockTargetId`、**不写** `u.targetId`（无“弹体锁定”那套）；
 *       · 改走“非锁定分支”：继承发射方自动策略 `u.policy`，并把发射方**当前解析目标**
 *         写给召唤体**攻击类携带模组**的**自动粘性** `inner._stick = [parentTarget.id]`。
 *     因此导弹携带的「欧米茄导弹爆炸」**每次激活都按既有正常目标链重新解析目标**
 *     （优先级链见《模块字段说明.md》§3：强制目标 > 模块手动目标 > 优先自己 > 船 `targetId`
 *      > **自动粘性** > 全队策略）——目标阵亡/潜行即自动改选，**不会**像火箭/导弹那样“锁定后永不改”。
 *   · **不是弹体类单位**：**不写** `effects.summon.projectile` —— 召唤体**不被打** `isProjectile` 标签，
 *     故不会被其它发射器 `target.exclude:['projectile']` 排除（可被敌方当作普通单位攻击）。
 *     （`projectile` 标签只决定“能否被 exclude 排除”，与目标锁定无关；锁定只由 `bind_target` 决定。）
 *   · **`maxSummoned: 2`**：复用既有召唤上限机制（`doSummon` 按**所属召唤模块**统计在场存活数，
 *     不同召唤模块即使复用同一船型也互不挤占；未达上限且冷却结束即补召）。
 *   · **召唤物带护盾**：`attrs.base.shieldCap` 覆写召唤模板基础护盾上限，沿用既有**独立护盾池 +
 *     登场满盾**规则（`doSummon` 末尾 `fillShieldPools` 把本体池补满）。
 *   - **召唤单位模板按既有体例复用通用 `drone` 模板**（《模块字段说明.md》§2.5：「无人机统一用通用
 *     `drone` 模板」；`data/ships.js` 头注释亦明确「勿在此按种类堆叠多个船型」）——种类差异全部由
 *     `effects.summon` 的 `attrs`（nameKey/icon/base/coefficients）与 `modules` 覆写设定。
 *   - 携带模组「欧米茄导弹爆炸」（等级＝召唤模块等级，不受该单位 `slots` 上限约束）。
 *   - 召唤/爆炸战报走既有链路（`battle.log.summon`；命中/爆炸/溅射由 `applyHit` 成句），**无需新键**。
 *   - 召唤计时：与既有召唤模块一致，召唤后进入冷却（`cool_first` 使其“部署即进入冷却”，开场不会立刻发射）。
 * 数值说明：【占位预填】冷却/能耗/召唤三围/存活时长由用户逐级人工调校。
 */
export default {
  id: 'omegaMissileLauncher',
  nameKey: 'module.omegaMissileLauncher', // i18n -> 欧米茄导弹发射器 / Omega Missile Launcher
  name: '欧米茄导弹发射器',
  icon: 'assets/img/欧米茄导弹.svg',
  category: 'function',
  // 召唤类模块：**无命中目标**（走 summon 执行；引擎对“无 `bind_target`/`per_target` 的召唤模块”
  // 不解析模块目标，只做能量/冷却/在场上限门控 —— 与既有 laserDroneSpawn 同一体例）。
  target: {},
  effects: {
    // 机制标签列表（可多个；引擎按标签识别、不按模块 id 硬编码）：
    //   summon     = 召唤钩子（激活时按 effects.summon 补召一个临时单位）
    //   cool_first = 部署即进入冷却（以 cooldown_ticks 起算，开场不会立刻召唤一枚）
    type: ['summon', 'cool_first'],
    summon: {
      type: 'drone',                  // 复用通用召唤模板（种类差异由下方 attrs/modules 覆写）
      // bind_target：★ **不写** —— 导弹召唤后不锁定目标（每次激活按正常目标链重新解析）
      // projectile：★ **不写** —— 不是弹体类单位（不被打 isProjectile 标签、不被发射器 exclude 排除）
      modules: [{ moduleId: 'omegaMissileWarhead' }], // 携带「欧米茄导弹爆炸」（等级=召唤模块等级）
      attrs: {
        nameKey: 'ship.omegaMissile', // 显示名 -> 欧米茄导弹
        icon: 'assets/img/欧米茄导弹.svg',
        base: { hp: 50, shieldCap: 600, energyCap: 160, energyRegen: 8 }, // 占位：带一定护盾量
      },
      lifespan_ticks: 500,            // 保险存活上限（通常引信先到即引爆自毁）
      maxSummoned: 2,                 // ★ 同阵营本模块在场存活上限 2（复用既有召唤上限机制）
      temp: true,                     // 临时单位：到期自动死亡、阵亡/到期直接移出场景
    },
    cooldown_ticks: 600,              // Lv1 占位：召唤间隔（明显高于普通导弹发射器）
    energy_cost: 750,                 // Lv1 占位：每次召唤能耗（明显高于普通导弹发射器）
  },
  maxLevel: 16,
  levels: [
    { level: 5, effects: { summon: { attrs: { base: { shieldCap: 700 } }, lifespan_ticks: 520 }, energy_cost: 800 } },
    { level: 10, effects: { summon: { attrs: { base: { shieldCap: 800 } }, lifespan_ticks: 540 }, energy_cost: 860 } },
    { level: 16, effects: { summon: { attrs: { base: { shieldCap: 1000 } }, lifespan_ticks: 560 }, energy_cost: 950 } },
  ],
};
