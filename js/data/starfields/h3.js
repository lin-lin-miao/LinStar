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
  durationTicks: 12000, // 【占位预填】20tps ⇒ 6 分钟
  seed: null, // null＝由界面随机/手输

  // ★ M3d 迭代 2：**单船费用**（每派出一艘收一次：派遣 n 艘 ⇒ 扣 n ×；损毁不返还；逐档递增）【占位预填 · 待用户调校】
  deployCost: { energy: 1500, ore: 800, alloy: 600, rare: 60 },
  // ★ M3d 迭代 2：**激活星域的激活费倍数**（激活一次性扣 `activateUnits × deployCost` —— **固定部分**；
  //   ★ 迭代 3：随行单位另按同一费率函数收派遣费，界面**合并成一个总价**显示；
  //   允许零单位激活；不占出战名额）
  activateUnits: 2, // 【占位预填】
  // ★ M3d 迭代 3：**超出「出战上限（费率分界）」部分的加价费率**（上限不再拦截、只加价）
  //   （口径/公式/取整见 `h1.js` 同名段与 `systems/expedition.js` 的 `dispatchPriceOf`）【占位预填 · 待用户调校】
  overQuota: { exponent: 1.5, offset: 1 }, // 超出部分总价 ＝ 单船费 × (m + 1) ^ 1.5
  // ★ M3d：难度描述词条键（面板只读它；文案在 i18n）
  descKey: 'starfield.h3.desc',
  // ★ M3d：结束演出（变白）**每环 tick 数**（中心恒星起、按到中心距离环逐环变白）【占位预填 · 待用户调校】
  collapseRingTicks: 20,

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
