/* ===== data/sectorTypes/stargate.js —— 星门星区（**特殊类型**之一） =====
 * 定位（设计文档 §0/§3）：**星门属于「特殊星区类型」**，**随机生成在星域的「最上、最下、最左、最右」
 *   四个方位**；默认（难度阶梯模式）用于**玩家单位进出**（本轮先落配置；跨区移动/入场属后续轮次）。
 * 体例：**一类型一文件**（特殊类型继续按此体例新增），`id` 与文件名一致；
 *   聚合与查表见 `data/sectorTypes/index.js`。
 * ★ 位置规则（用户口径 · 引擎/A-5 按 `placement` 驱动、**不硬编码类型 id**）：
 *   `placement: { mode:'edges', edges:['top','bottom','left','right'] }`
 *   —— **四个方位随机**（具体取哪几个方位、各几个 ⇒ 由 A-5 依 `count` 区间 + 种子确定）。
 * ★ 数值说明：**【占位预填 · 待用户调校】**；`mapColor` 只存 **CSS 变量名**（色值在 `css/base.css :root`）。
 */
export default {
  id: 'stargate',
  nameKey: 'sectorType.stargate', // i18n -> 星门星区 / Stargate Sector
  kind: 'special', // ★ 特殊星区类型
  // ★ **四方位边缘随机**（mode:'edges' + edges 四方位；A-5 只按本字段生成，不认类型 id）
  placement: { mode: 'edges', edges: ['top', 'bottom', 'left', 'right'] },
  count: { min: 1, max: 4 }, // 默认数量范围【占位预填】（星域配置可覆写；四个方位各至多 1 个 ⇒ 上限建议 ≤ 4）
  content: {
    ore: { min: 0, max: 0 }, // 星门区默认无储量【占位口径】
    cargos: {
      enabled: false,
      templates: [],
      count: { min: 0, max: 0 },
      tonsRange: { min: 0, max: 0 },
      levelRange: { min: 1, max: 1 },
    },
    structures: [], // 星门本体暂用 `specialEffect`/地图标记表达；结构体【占位 · 待开发】
  },
  npcListId: null, // 默认无 NPC（玩家进出用）；如需守卫由星域配置覆写
  specialEffect: null, // 特殊效果【占位 · 待开发】
  texture: null, // ★ 贴图字段（预留）：非空 ⇒ 渲染贴图；为空 ⇒ 回退「类型色 + marker」（本轮不新增图片文件）
  fill: false, // 填充类型标记：**非**「剩余格位填充类型」（唯一 `fill:true` 者见 `empty.js`）
  mapColor: '--sector-stargate',
  marker: '◈',
};
