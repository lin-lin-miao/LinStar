/* ===== data/starfields/h2.js —— 星域配置：难度 H2（★ 数值全占位） =====
 * 定位：难度阶梯**中档**（半径更大、星区更多、巡逻更密、持续时间更长）。
 * 体例与字段含义见 `data/starfields/h1.js` 文件头（三档完全同构；本文件不重复长注释）。
 * ★ **纯数据、可 JSON 序列化**（不写函数/循环引用；自检做 JSON 往返比对）。
 * ★ 数值说明：**【占位预填 · 待用户调校】**。
 */
export default {
  id: 'h2',
  nameKey: 'starfield.h2', // i18n -> H2 / H2
  radius: 3, // 【占位预填】
  durationTicks: 5400, // 【占位预填】20tps ⇒ 4.5 分钟
  seed: null, // null＝由界面随机/手输

  sectorTypes: {
    star: { enabled: true, count: { min: 1, max: 1 } }, // 中心恒星固定 1 个
    planet: { enabled: true, count: { min: 3, max: 6 }, npcListIds: ['patrolLight'] }, // 【占位预填】
    mineral: { enabled: true, count: { min: 2, max: 5 }, npcListIds: ['patrolLight'] }, // 【占位预填】中档起矿物区有轻巡逻
    empty: { enabled: true, count: { min: 2, max: 8 } }, // 【占位预填】
    stargate: { enabled: true, count: { min: 1, max: 3 }, npcListIds: [] }, // 【占位预填】
  },

  // ★ 玩家单位列表（我方初始编队；与 NPC 列表 `units[]` 同构；`[]`＝不给初始编队。字段含义见 `h1.js`）
  playerUnits: [],

  sideRules: {
    playerEntryTypeId: 'stargate',
    npcSide: 'enemy', // 【占位】
    allyNpcListIds: [],
    neutralSectorTypeIds: [],
    mirror: true,
  },

  specialEffects: [], // 【占位 · 待开发】
};
