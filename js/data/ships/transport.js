/* ===== data/ships/transport.js —— 运输舰（船型静态配置 · 支持等级） =====
 * 结构与等级模型见 `data/ships/combat.js` 头注释（四级船型文件体例完全一致）：
 *   · Lv1 数值写在**顶层**，`levels[]` 只写 Lv≥2 的差异（未填字段递归回退上一级）；
 *   · `slots` / `base.*` / `coefficients.*` / `nameKey` / `icon` 等**任意条目**均可逐级覆写。
 * 数值说明：【占位预填】由用户逐级人工调校（Lv1 与拆分前完全一致）。
 */
export default {
  id: 'transport',           // 唯一标识（运输舰）
  nameKey: 'ship.transport', // 名称词条 key（i18n -> 运输舰 / Transport Ship）
  /* ★ M3 基地侧字段【占位预填 · 待用户调校】——M3a 只铺字段，读取逻辑属 M3b（船坞）。
   * · `levels[]` 仍是【战斗数值】的唯一逐级表（解析口径 resolveShipAtLevel）；
   *   下列基地侧字段是**基地数值**：`upgradeCost` 自带逐级表（数组项 { level, cost }，
   *   未列出的等级沿用上一项；逐级解析属 M3b）；
   * · `buildable`  可否在船坞建造；`buildCost` 建造消耗；
   * · `slotGrowth` 槽位成长规则（基础槽位＝既有 `slots`：每 `every` 级 +`add`、最多 +`max`）；
   * · 缺省即视为「无消耗」；资源键见 data/resources.js（缺失键视为 0）。 */
  buildable: true,
  buildCost: { energy: 0, ore: 0, alloy: 0, rare: 0 },
  upgradeCost: [{ level: 2, cost: { energy: 0, ore: 0, alloy: 0, rare: 0 } }],
  slotGrowth: { every: 2, add: 1, max: 2 },
  /* ★ `unlockByLevel` 逐级**后续特性 / 特殊条件**的解锁条件（用户口径：**不由货物决定**）——M3b 为空数组＝无条件；非空 ⇒ 视为"条件尚未实装"、引擎保守拒绝建造。 */
  unlockByLevel: [], // 【占位预填 · 待用户调校】
  role: 'logistics',         // ★ 单位定位：运输舰默认＝后勤单位（编队条目的 `role` 可覆盖；本条目可逐级覆写）
  slots: 3,                  // Lv1 可装模块数
  /* ★ **航行引擎冷却的基准时长**（星区间移动；【占位预填 · 待用户调校】）：口径见 `data/ships/combat.js`
   *   的同一字段说明 —— `cd = max(1, round(navCdTicks ÷ 航行系数 × (1 + 时间系数)))`，不影响任何战斗数值；
   *   本条目**可逐级覆写**。 */
  navCdTicks: 200,           // 【占位预填】Lv1 航行引擎冷却基准（tick）；运输舰后续可按玩法调高/调低
  /* ★ **引擎充能每 tick 的能量代价**（星区间移动；【占位预填 · 待用户调校】）：口径见
   *   `data/ships/combat.js` 的同一字段说明 —— 充能中每 tick 扣本值、扣得起才推进冷却，充满后零耗能；
   *   本条目**可逐级覆写**。 */
  navEnergyPerTick: 1,       // 【占位预填】Lv1 充能能耗 / tick
  base: {
    hp: 120,                 // 血量上限
    shieldCap: 50,           // 基础护盾上限
    energyCap: 100,          // 能量上限
    energyRegen: 5,          // 基础能量回复 / 秒
    cargoCap: 600,           // 货舱容量（本体，**不受系数影响**，占位预填；模块 cargo_cap_bonus 另行按运输系数叠加）
    oreCap: 0,               // 矿物容量（本体，占位；运输舰默认不载矿 → 0 → UI 隐藏该条）
  },
  coefficients: {
    attack: 0.5,             // 攻击类模块效果系数
    shield: 0.8,               // 护盾类模块效果系数
    function: 1,             // 功能类模块效果系数
    transport: 1,            // 运输类模块效果系数（★ 货物容量 = 本体 + Σ(模块 cargo_cap_bonus × 本系数)）
    mining: 0.5,             // 采矿类模块效果系数（★ 矿物容量用本系数缩放模块部分）
    nav: 1,                  // ★ 航行系数（与上面的类别系数**同族同链**；只影响跨星区移动冷却）
  },
  maxLevel: 16,
  levels: [
    // —— 占位：运输类系数随级提升，体现“逐级覆写系数”能力；本体货舱容量同样逐级覆写 ——
    { level: 5, slots: 4, base: { hp: 170, shieldCap: 70, energyCap: 130, energyRegen: 6, cargoCap: 900 }, coefficients: { transport: 1.1 } },
    { level: 10, slots: 5, base: { hp: 240, shieldCap: 100, energyCap: 170, energyRegen: 8, cargoCap: 1400 }, coefficients: { transport: 1.25 } },
    { level: 16, slots: 6, base: { hp: 340, shieldCap: 140, energyCap: 220, energyRegen: 11, cargoCap: 2000 }, coefficients: { transport: 1.5 } },
  ],
};
