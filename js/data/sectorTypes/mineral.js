/* ===== data/sectorTypes/mineral.js —— 矿物区（基础类型 · 环绕） =====
 * 定位（设计文档 §3/§4）：**星区储量高**的资源星区（采矿激光/创世纪等在此产出最多），默认无货物。
 * 体例：**一类型一文件**，`id` 与文件名一致；聚合与查表见 `data/sectorTypes/index.js`。
 * ★ 数值说明：**【占位预填 · 待用户调校】**；`mapColor` 只存 **CSS 变量名**（色值在 `css/base.css :root`）。
 */
export default {
  id: 'mineral',
  nameKey: 'sectorType.mineral', // i18n -> 矿物区 / Mineral Field
  kind: 'basic',
  placement: { mode: 'ring' },
  count: { min: 1, max: 4 }, // 默认数量范围【占位预填】（星域配置可覆写）
  content: {
    ore: { min: 800, max: 2500 }, // ★ 矿物区储量最高【占位预填】
    cargos: {
      enabled: false, // 矿物区默认不出「星球(货物)」【占位口径】
      templates: [],
      count: { min: 0, max: 0 },
      tonsRange: { min: 5, max: 60 },
      levelRange: { min: 1, max: 1 },
    },
    structures: [],
  },
  // ★ 默认 NPC 列表**可配置多个**（`npcListIds: string[]`；生成时按种子随机抽一个；`[]`＝无单位）
  npcListIds: [], // 默认无驻守（由星域配置按难度覆写，例如 H2/H3 派重巡逻）
  specialEffect: null,
  texture: null, // ★ 贴图字段（预留）：非空 ⇒ 渲染贴图；为空 ⇒ 回退「类型色 + marker」（本轮不新增图片文件）
  fill: false, // 填充类型标记：**非**「剩余格位填充类型」（唯一 `fill:true` 者见 `empty.js`）
  mapColor: '--sector-mineral',
  marker: '◆',
};
