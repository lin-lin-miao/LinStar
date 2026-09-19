/* ===== data/starfields/h3.js —— 星域配置：难度 H3（★ 数值全占位） =====
 * 定位：难度阶梯**高档**（半径最大、星区最多、重巡逻驻守、持续时间最长）。
 * 体例与字段含义见 `data/starfields/h1.js` 文件头（三档完全同构；本文件不重复长注释）。
 * ★ **纯数据、可 JSON 序列化**（不写函数/循环引用；自检做 JSON 往返比对）。
 * ★ 数值说明：**【占位预填 · 待用户调校】**。
 */
export default {
  id: 'h3',
  nameKey: 'starfield.h3', // i18n -> H3 / H3
  radius: 4, // 【占位预填】
  durationTicks: 7200, // 【占位预填】20tps ⇒ 6 分钟
  seed: null, // null＝由界面随机/手输

  sectorTypes: {
    star: { enabled: true, count: { min: 1, max: 1 } }, // 中心恒星固定 1 个
    planet: { enabled: true, count: { min: 4, max: 8 }, npcListIds: ['patrolHeavy'] }, // 【占位预填】重巡逻驻守
    mineral: { enabled: true, count: { min: 3, max: 7 }, npcListIds: ['patrolHeavy'] }, // 【占位预填】
    empty: { enabled: true, count: { min: 3, max: 12 } }, // 【占位预填】
    stargate: { enabled: true, count: { min: 2, max: 4 }, npcListIds: [] }, // 【占位预填】最多四方位各一个
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
