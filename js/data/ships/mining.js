/* ===== data/ships/mining.js —— 采矿船（船型静态配置 · 支持等级） =====
 * 结构与等级模型见 `data/ships/combat.js` 头注释（四级船型文件体例完全一致）。
 * 系数已按用户修正 D3（mining=1）；数值说明：【占位预填】由用户逐级人工调校（Lv1 与拆分前完全一致）。
 */
export default {
  id: 'mining',             // 唯一标识（采矿船）
  nameKey: 'ship.mining',   // 名称词条 key（i18n -> 采矿船 / Mining Ship）
  role: 'logistics',        // ★ 单位定位：采矿船默认＝后勤单位（编队条目的 `role` 可覆盖；本条目可逐级覆写）
  slots: 3,                 // Lv1 可装模块数
  base: {
    hp: 120,                // 血量上限
    shieldCap: 50,          // 基础护盾上限
    energyCap: 100,         // 能量上限
    energyRegen: 5,         // 基础能量回复 / 秒
    cargoCap: 0,            // 货舱容量（本体，占位；采矿船默认不载货 → 0 → UI 隐藏该条）
    oreCap: 600,            // 矿物容量（本体，**不受系数影响**，占位；模块 ore_cap_bonus 另行按采矿系数叠加）
  },
  coefficients: {
    attack: 0.5,            // 攻击类模块效果系数
    shield: 1,              // 护盾类模块效果系数
    function: 1,            // 功能类模块效果系数
    transport: 0.5,         // 运输类模块效果系数（★ 货物容量用本系数缩放模块部分）
    mining: 1,              // 采矿类模块效果系数（★ 矿物容量 = 本体 + Σ(模块 ore_cap_bonus × 本系数)）
  },
  maxLevel: 16,
  levels: [
    // —— 占位：采矿类系数随级提升；本体矿物容量同样逐级覆写 ——
    { level: 5, slots: 4, base: { hp: 170, shieldCap: 70, energyCap: 130, energyRegen: 6, oreCap: 900 }, coefficients: { mining: 1.1 } },
    { level: 10, slots: 5, base: { hp: 240, shieldCap: 100, energyCap: 170, energyRegen: 8, oreCap: 1400 }, coefficients: { mining: 1.3 } },
    { level: 16, slots: 6, base: { hp: 340, shieldCap: 140, energyCap: 220, energyRegen: 11, oreCap: 2000 }, coefficients: { mining: 1.6 } },
  ],
};
