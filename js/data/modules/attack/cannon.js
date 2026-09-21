/* ===== data/modules/cannon.js —— 火炮（攻击） =====
 * 目标改为敌方单体 single×1（用户定稿，M2 重做）。
 * 满级 16（一般模块默认满级 16）。
 * 数值说明：目前为【占位预填】——damage 逐级递增，cooldown_ticks/energy_cost 沿用 Lv1，
 * 未经人工逐级调校，后续由用户调整（会覆盖此前的半成品 Lv2/Lv3 草稿）。
 * levels 只写“与上一级的差异”，留空 = 继承上一级。
 */
export default {
  id: 'cannon',
  /* ★ M3 基地侧字段【占位预填 · 待用户调校】——M3a 只铺字段，读取逻辑属 M3b（船坞）/ M3e（研究站）。
   * · `levels[]` 仍是【战斗数值】的唯一逐级表（由 entities/module.js 解析 effects/target）；
   *   下列基地侧字段自带**独立逐级表**（数组项 { level, ... }，未列出该等级则沿用上一项）；
   * · 缺省即视为「无消耗 / 无门槛」：installCost / removeCost / upgradeCost / scienceCost 缺失＝免费，
   *   blueprint 缺失＝无需蓝图；资源键见 data/resources.js（缺失键视为 0）。 */
  /* ★ M3b 真实费用（【占位预填 · 待用户调校】；结构由 tools/patch-m3b-costs.mjs 生成 —— 只调数值即可）
     —— 下列各表**均按模块等级**给出：装配 / 拆下 / 升级 / 研究 费用与**蓝图门槛**逐级不同。 */
  installCost: [
    { level: 1, cost: { energy: 120, ore: 30, alloy: 60, rare: 0 } },
    { level: 2, cost: { energy: 162, ore: 41, alloy: 81, rare: 0 } },
    { level: 3, cost: { energy: 219, ore: 55, alloy: 109, rare: 0 } },
    { level: 4, cost: { energy: 295, ore: 74, alloy: 148, rare: 0 } },
    { level: 5, cost: { energy: 399, ore: 100, alloy: 199, rare: 0 } },
    { level: 6, cost: { energy: 538, ore: 135, alloy: 269, rare: 0 } },
    { level: 7, cost: { energy: 726, ore: 182, alloy: 363, rare: 0 } },
    { level: 8, cost: { energy: 981, ore: 245, alloy: 490, rare: 0 } },
    { level: 9, cost: { energy: 1324, ore: 331, alloy: 662, rare: 2 } },
    { level: 10, cost: { energy: 1787, ore: 447, alloy: 894, rare: 3 } },
    { level: 11, cost: { energy: 2413, ore: 603, alloy: 1206, rare: 4 } },
    { level: 12, cost: { energy: 3257, ore: 814, alloy: 1629, rare: 5 } },
    { level: 13, cost: { energy: 4397, ore: 1099, alloy: 2199, rare: 8 } },
    { level: 14, cost: { energy: 5936, ore: 1484, alloy: 2968, rare: 11 } },
    { level: 15, cost: { energy: 8014, ore: 2004, alloy: 4007, rare: 15 } },
    { level: 16, cost: { energy: 10819, ore: 2705, alloy: 5410, rare: 21 } },
  ],
  removeCost: [
    { level: 1, cost: { energy: 30, ore: 8, alloy: 15, rare: 0 } },
    { level: 2, cost: { energy: 41, ore: 10, alloy: 20, rare: 0 } },
    { level: 3, cost: { energy: 55, ore: 14, alloy: 27, rare: 0 } },
    { level: 4, cost: { energy: 74, ore: 19, alloy: 37, rare: 0 } },
    { level: 5, cost: { energy: 100, ore: 25, alloy: 50, rare: 0 } },
    { level: 6, cost: { energy: 135, ore: 34, alloy: 67, rare: 0 } },
    { level: 7, cost: { energy: 182, ore: 46, alloy: 91, rare: 0 } },
    { level: 8, cost: { energy: 245, ore: 61, alloy: 123, rare: 0 } },
    { level: 9, cost: { energy: 331, ore: 83, alloy: 166, rare: 1 } },
    { level: 10, cost: { energy: 447, ore: 112, alloy: 224, rare: 1 } },
    { level: 11, cost: { energy: 603, ore: 151, alloy: 302, rare: 1 } },
    { level: 12, cost: { energy: 814, ore: 204, alloy: 407, rare: 1 } },
    { level: 13, cost: { energy: 1099, ore: 275, alloy: 550, rare: 2 } },
    { level: 14, cost: { energy: 1484, ore: 371, alloy: 742, rare: 3 } },
    { level: 15, cost: { energy: 2004, ore: 501, alloy: 1002, rare: 4 } },
    { level: 16, cost: { energy: 2705, ore: 676, alloy: 1353, rare: 5 } },
  ],
  upgradeCost: [
    { level: 2, cost: { energy: 97, ore: 25, alloy: 49, rare: 0 } },
    { level: 3, cost: { energy: 131, ore: 33, alloy: 65, rare: 0 } },
    { level: 4, cost: { energy: 177, ore: 44, alloy: 89, rare: 0 } },
    { level: 5, cost: { energy: 239, ore: 60, alloy: 119, rare: 0 } },
    { level: 6, cost: { energy: 323, ore: 81, alloy: 161, rare: 0 } },
    { level: 7, cost: { energy: 436, ore: 109, alloy: 218, rare: 0 } },
    { level: 8, cost: { energy: 589, ore: 147, alloy: 294, rare: 0 } },
    { level: 9, cost: { energy: 794, ore: 199, alloy: 397, rare: 1 } },
    { level: 10, cost: { energy: 1072, ore: 268, alloy: 536, rare: 2 } },
    { level: 11, cost: { energy: 1448, ore: 362, alloy: 724, rare: 2 } },
    { level: 12, cost: { energy: 1954, ore: 488, alloy: 977, rare: 3 } },
    { level: 13, cost: { energy: 2638, ore: 659, alloy: 1319, rare: 5 } },
    { level: 14, cost: { energy: 3562, ore: 890, alloy: 1781, rare: 7 } },
    { level: 15, cost: { energy: 4808, ore: 1202, alloy: 2404, rare: 9 } },
    { level: 16, cost: { energy: 6491, ore: 1623, alloy: 3246, rare: 13 } },
  ],
  blueprint: [{ level: 1, count: 0 }, { level: 5, count: 1 }, { level: 10, count: 3 }, { level: 16, count: 6 }],
  scienceCost: [
    { level: 1, cost: { science: 6 } },
    { level: 2, cost: { science: 8 } },
    { level: 3, cost: { science: 11 } },
    { level: 4, cost: { science: 15 } },
    { level: 5, cost: { science: 20 } },
    { level: 6, cost: { science: 27 } },
    { level: 7, cost: { science: 36 } },
    { level: 8, cost: { science: 49 } },
    { level: 9, cost: { science: 66 } },
    { level: 10, cost: { science: 89 } },
    { level: 11, cost: { science: 121 } },
    { level: 12, cost: { science: 163 } },
    { level: 13, cost: { science: 220 } },
    { level: 14, cost: { science: 297 } },
    { level: 15, cost: { science: 401 } },
    { level: 16, cost: { science: 541 } },
  ],
  nameKey: 'module.cannon', // i18n -> 火炮 / Cannon
  name: '火炮',
  icon: 'assets/img/火炮.svg',
  category: 'attack',
  target: {
    kinds: ['enemy'],
    countMode: 'single', // 用户定稿：单体
    maxCount: 1,
  },
  effects: {
    type: ['projectile'], // 特殊钩子标记（机制）
    damage: 18,           // Lv1 占位
    cooldown_ticks: 20,   // 各级沿用 Lv1（如需随级变请在 levels 覆盖）
    energy_cost: 15,
  },
  maxLevel: 16,
  levels: [
    { level: 2, effects: { damage: 21 } },
    { level: 3, effects: { damage: 26 } },
    { level: 4, effects: { damage: 32 } },
    { level: 5, effects: { damage: 39 } },
    { level: 6, effects: { damage: 47 } },
    { level: 7, effects: { damage: 56 } },
    { level: 8, effects: { damage: 66 } },
    { level: 9, effects: { damage: 77 } },
    { level: 10, effects: { damage: 89 } },
    { level: 11, effects: { damage: 102 } },
    { level: 12, effects: { damage: 116 } },
    { level: 13, effects: { damage: 131 } },
    { level: 14, effects: { damage: 147 } },
    { level: 15, effects: { damage: 164 } },
    { level: 16, effects: { damage: 182 } },
  ],
};
