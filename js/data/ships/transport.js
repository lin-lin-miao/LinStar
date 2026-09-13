/* ===== data/ships/transport.js —— 运输舰（船型静态配置 · 支持等级） =====
 * 结构与等级模型见 `data/ships/combat.js` 头注释（四级船型文件体例完全一致）：
 *   · Lv1 数值写在**顶层**，`levels[]` 只写 Lv≥2 的差异（未填字段递归回退上一级）；
 *   · `slots` / `base.*` / `coefficients.*` / `nameKey` / `icon` 等**任意条目**均可逐级覆写。
 * 数值说明：【占位预填】由用户逐级人工调校（Lv1 与拆分前完全一致）。
 */
export default {
  id: 'transport',           // 唯一标识（运输舰）
  nameKey: 'ship.transport', // 名称词条 key（i18n -> 运输舰 / Transport Ship）
  role: 'logistics',         // ★ 单位定位：运输舰默认＝后勤单位（编队条目的 `role` 可覆盖；本条目可逐级覆写）
  slots: 3,                  // Lv1 可装模块数
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
    shield: 1,               // 护盾类模块效果系数
    function: 1,             // 功能类模块效果系数
    transport: 1,            // 运输类模块效果系数（★ 货物容量 = 本体 + Σ(模块 cargo_cap_bonus × 本系数)）
    mining: 0.5,             // 采矿类模块效果系数（★ 矿物容量用本系数缩放模块部分）
  },
  maxLevel: 16,
  levels: [
    // —— 占位：运输类系数随级提升，体现“逐级覆写系数”能力；本体货舱容量同样逐级覆写 ——
    { level: 5, slots: 4, base: { hp: 170, shieldCap: 70, energyCap: 130, energyRegen: 6, cargoCap: 900 }, coefficients: { transport: 1.1 } },
    { level: 10, slots: 5, base: { hp: 240, shieldCap: 100, energyCap: 170, energyRegen: 8, cargoCap: 1400 }, coefficients: { transport: 1.25 } },
    { level: 16, slots: 6, base: { hp: 340, shieldCap: 140, energyCap: 220, energyRegen: 11, cargoCap: 2000 }, coefficients: { transport: 1.5 } },
  ],
};
