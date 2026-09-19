/* ===== data/starfields/h1.js —— 星域配置：难度 H1（★ 数值全占位） =====
 * 定位（设计文档 §2/§4/§5）：**一种难度/玩法＝一个星域配置文件**；本文件＝**难度阶梯 H1**（入门档）。
 * 体例：**一文件一难度**（`id` 与文件名一致 ⇒ `h1.js` ⇒ `id:'h1'`），聚合与查表见 `data/starfields/index.js`。
 * ★ **纯数据、可 JSON 序列化**（C-3 的导出文件与内置配置同格式 ⇒ **不写函数、不写循环引用**；
 *   自带校验 `selfCheck()` 会做 `JSON.parse(JSON.stringify(x))` 往返比对）。
 * ★ 字段结构（三档一致）：
 *   `id` / `nameKey`（i18n `starfield.<id>`）/ **`radius`**（星域半径；编码不设上限，仅由配置决定）
 *   / **`durationTicks`**（星域自身持续时间；随 tick 递减、归零 ⇒ 全部星区停止并进入结算）
 *   / **`seed`**（可选默认种子；`null` ⇒ 由「星域配置界面」随机生成后写入，界面可覆写）
 *   / **`sectorTypes`**（**类型开关 + 各类型数量最小/最大值 + 默认 NPC 列表覆写**；
 *     键＝既有星区类型 id（`data/sectorTypes/`），**逐类型可只写要覆写的那几项**）
 *   / ★ **`playerUnits`**（**玩家单位列表**：我方初始编队，与 NPC 列表 `units[]` **同构** ——
 *     `[{ shipId, count, level?, modules?:[{moduleId,level?}] }]`；阵营恒为**我方**；
 *     进入星域时按 `sideRules.playerEntryTypeId` 生成在**星门星区**，无星门 ⇒ `#1` 号星区；
 *     `[]`＝不给初始编队）
 *   / **`sideRules`**（敌我分布规则【占位 · 玩法层用】）/ **`specialEffects`**（特殊效果【占位 · 待开发】）。
 * ★ 数值说明：**【占位预填 · 待用户调校】** —— 半径 2 / 持续 3600t（20tps ⇒ 3 分钟）/ 各类型数量区间
 *   与 NPC 列表分配全部为占位。
 */
export default {
  id: 'h1',
  nameKey: 'starfield.h1', // i18n -> H1 / H1（难度阶梯名，两语言同串）
  radius: 2, // 【占位预填】星域半径（方形网格中「到中心欧氏距离 ≤ R」⇒ 近似圆形；H2=3、H3=4）
  durationTicks: 3600, // 【占位预填】星域持续时间（tick）；20tps ⇒ 3 分钟
  seed: null, // 可选默认种子（null＝由星域配置界面随机生成/手输；**种子只在界面输入**）

  /* ★ 各类型星区开关 + 数量区间（可覆写类型默认值；未写到的条目自动沿用类型定义 `data/sectorTypes/`）
   * ★ 占位数值已按**该半径的格位数**粗校（`radius:2` ⇒ 到中心欧氏距离 ≤2 的格位约 13 个）：
   *   本档各类型**数量上限之和 = 1+4+3+3+2 = 13** ⇒ 恰好在容量内（不保证每档都填满）【占位预填】
   * ★ NPC 列表覆写＝**数组 `npcListIds`**（可配多个；生成时按种子在该集合内随机抽一个；
   *   `[]`＝无单位；兼容读取既有单值 `npcListId`） */
  sectorTypes: {
    star: { enabled: true, count: { min: 1, max: 1 } }, // 中心恒星：固定 1 个（口径，非占位）
    planet: { enabled: true, count: { min: 2, max: 4 }, npcListIds: ['patrolLight'] }, // 【占位预填】
    mineral: { enabled: true, count: { min: 1, max: 3 }, npcListIds: [] }, // 【占位预填】入门档矿物区无驻守
    empty: { enabled: true, count: { min: 0, max: 3 } }, // 【占位预填】允许 0 个（上限按格位容量收窄）
    stargate: { enabled: true, count: { min: 1, max: 2 }, npcListIds: [] }, // 【占位预填】玩家进出用，无 NPC
  },

  /* ★ **玩家单位列表**（我方初始编队；纯数据、可 JSON 往返、与 NPC 列表 `units[]` **同构**）：
   *   每条＝`{ shipId, count, level?, modules?:[{moduleId,level?}] }`（`count` 固定值；
   *   如需随机数量可写 `countRange:[min,max]`，由 `systems/starfield.js` 用**独立子流** `fork('playerUnits')` 抽）。
   *   · **阵营**＝**我方**（`side:'ally'`）；**入场星区**＝`sideRules.playerEntryTypeId` 指到的类型
   *     （缺省回退：**第一个启用的 `placement.mode === 'edges'` 类型**，仍无 ⇒ `#1` 号星区）。
   *   · 本轮默认空 ＝ **不给初始编队**（零回归：星域行为与改造前一致；由界面「玩家单位列表」编辑后生效）。 */
  playerUnits: [],

  /* ★ 敌我分布规则【占位 · 玩法层用】（设计文档 §2-6：按玩法决定；默认难度阶梯模式含星门处理） */
  sideRules: {
    playerEntryTypeId: 'stargate', // 玩家单位从「星门星区」进场（默认模式口径；引用既有星区类型 id）
    npcSide: 'enemy', // NPC 默认敌对【占位】（'enemy' | 'ally'，后续玩法可覆写）
    allyNpcListIds: [], // 友方援军 NPC 列表【占位】空＝无
    neutralSectorTypeIds: [], // 中立星区类型【占位】空＝本轮不区分中立
    mirror: true, // 镜像对等【占位】：敌我规则同源（同一列表可分别作敌/友用）
  },

  /* ★ 星区特殊效果【占位 · 待开发】（设计文档 §2-7）：本轮恒空数组，仅留字段位 */
  specialEffects: [],
};
