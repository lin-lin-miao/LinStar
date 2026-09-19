/* ===== data/ships/combat.js —— 战斗舰（船型静态配置 · 支持等级） =====
 * 字段说明（中文）：
 *   id            唯一标识（引擎内部引用，勿改）
 *   nameKey       显示名词条 key（i18n 中的词条，如 ship.combat）
 *   slots         模块槽数量（该船可安装的模块总数，**可逐级覆写**）
 *   base.hp       基础血量（生命值上限）
 *   base.shieldCap  基础护盾上限（模块可在此基础上叠加）
 *   base.energyCap  能量上限（能量池容量）
 *   base.energyRegen 基础能量回复（每秒回复量）
 *   coefficients  船类系数：该船对"某类模块"效果的加成乘数
 *                 （作用于效果量乘区：伤害/回复/产出等，不影响冷却与能耗）
 *   maxLevel      最大可用等级
 *   levels[]      **逐级绝对表**（与模块等级模型**完全同构**）：
 *                 · 每项 `{ level, ...该级覆写的任意条目 }`；
 *                 · **未填字段回退上一级**（递归向上，最终以 Lv1/顶层兜底）；
 *                 · 可覆写**任意条目**：base.* / coefficients.* / slots / nameKey / icon …
 *                 · Lv1 数值写在**顶层**（本文件上方字段），`levels` 只写 Lv≥2 的差异
 *                   （与模块数据文件同一体例；顶层即 Lv1 基准）。
 * ★ 解析口径唯一：`js/data/ships/index.js` 的 `resolveShipAtLevel(def, level)`
 *   （引擎建单位与 UI 展示都从它取值，见 `entities/ship.js createShip`）。
 * 数值说明：【占位预填】由用户逐级人工调校（Lv1 与拆分前完全一致）。
 */
export default {
  id: 'combat',             // 唯一标识（战斗舰）
  nameKey: 'ship.combat',   // 名称词条 key（i18n -> 战斗舰 / Combat Ship）
  role: 'combat',           // ★ 单位定位：'combat'=战斗单位 / 'logistics'=后勤单位 —— 决定战斗界面把该单位
                            //   显示在【战斗单位栏】还是【后勤单位栏】；编队条目的 `role` 可覆盖本值，
                            //   且本条目**与其它条目一样可逐级覆写**（见文件头等级说明）。
  slots: 3,                 // Lv1 可装模块数
  /* ★ **航行引擎冷却的基准时长**（星区间移动；【占位预填 · 待用户调校】）：
   *   · 只作用于**跨星区移动**：`cd = max(1, round(navCdTicks ÷ 航行系数 × (1 + 时间系数)))`
   *     —— 即“**本值 ÷ 航行系数**”，航行系数越大 ⇒ 冷却越短（见 `systems/starfield.js`）；
   *   · **不影响任何战斗数值**；本条目**可逐级覆写**（写在 `levels[]` 里即可，与 `slots`/`base.*` 同体例）；
   *   · 默认 200t（10 秒 @20tps）；缺省/非法值 ⇒ 按 `systems/starfield.js` 的同一默认值处理。 */
  navCdTicks: 200,          // 【占位预填】Lv1 航行引擎冷却基准（tick）
  /* ★ **引擎充能每 tick 的能量代价**（星区间移动；【占位预填 · 待用户调校】）：
   *   · 「始终充能」口径下，单位**处于充能中**（尚未充满）时每 tick 由星域容器扣本值
   *     （**扣得起 ⇒ 扣并推进 1 tick；扣不起 ⇒ 不扣、不推进**）；**充满后零耗能**；
   *   · **不影响任何战斗数值**；本条目**可逐级覆写**（与 `slots`/`navCdTicks` 同体例）；
   *   · 唯一读口径＝`entities/ship.js navEnergyPerTickOf(ship)`（UI 与容器都只读它）；
   *   · 缺省/非法值 ⇒ 回落 `NAV_ENERGY_DEFAULT_PER_TICK`（该默认值**只在一处定义**，见 `entities/ship.js`）。 */
  navEnergyPerTick: 1,      // 【占位预填】Lv1 充能能耗 / tick
  base: {
    hp: 120,                // 血量上限
    shieldCap: 50,          // 基础护盾上限
    energyCap: 1000,        // 能量上限
    energyRegen: 20,        // 基础能量回复 / 秒
    cargoCap: 0,            // 货舱容量（本体，**不受系数影响**，直接相加；0 → UI 隐藏该条）
    oreCap: 0,              // 矿物容量（本体；同上。模块的 cargo_cap_bonus/ore_cap_bonus 另行按系数叠加）
  },
  coefficients: {
    attack: 1,              // 攻击类模块效果系数
    shield: 1,              // 护盾类模块效果系数
    function: 1,            // 功能类模块效果系数
    transport: 0.5,         // 运输类模块效果系数
    mining: 0.5,            // 采矿类模块效果系数
    // ★ **航行系数**（星区间移动；【占位预填 · 待用户调校】）：与上面的类别系数**同族同链** ——
    //   读口径＝既有 `coeff(ship, 'nav')`（`(基准 + Σ加性) × Π乘性`），模块词条 `nav_coeff_add`
    //   经 `_coeff_add` 后缀规则自动并入同一张表；**只影响跨星区移动的冷却**，不参与任何战斗数值。
    nav: 1,
  },
  maxLevel: 16,
  levels: [
    // —— 占位：逐级只写差异，未写的条目沿用上一级 ——
    { level: 5, slots: 5, base: { hp: 180, shieldCap: 80, energyCap: 1200, energyRegen: 24 } },
    { level: 10, slots: 7, base: { hp: 260, shieldCap: 120, energyCap: 1500, energyRegen: 30 } },
    {
      level: 16, slots: 10, base: { hp: 380, shieldCap: 180, energyCap: 1900, energyRegen: 40 },
      coefficients: { attack: 1.1 }, // 占位示例：类别系数同样可逐级覆写
    },
  ],
};
