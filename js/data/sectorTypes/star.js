/* ===== data/sectorTypes/star.js —— 恒星星区（基础类型 · 中心 · 可参战） =====
 * 定位（设计文档 §3/§5）：**中心 `(0,0)` 的恒星星区** —— 布局锚点、**可参战**（有单位就能打）。
 * 体例：**一类型一文件**，`id` 与文件名一致；聚合与查表见 `data/sectorTypes/index.js`。
 * ★ 本类型不接受星域配置改数量（中心恒为 1 个）：`count {1,1}` ＋ `placement {mode:'center'}`
 *   ⇒ A-5 生成器据此固定放在中心；其它类型一律 `{mode:'ring'}` 环绕。
 * ★ 数值说明：**【占位预填 · 待用户调校】**（`content.*` 全部为占位；`mapColor` 只存**CSS 变量名**，
 *   色值唯一定义在 `css/base.css :root` ⇒ **本文件不写色值**）。
 */
export default {
  id: 'star',
  nameKey: 'sectorType.star', // i18n -> 恒星星区 / Star Sector
  kind: 'basic', // 'basic' 基础类型 | 'special' 特殊类型
  // ★ **生成位置规则**（A-5 使用；本类型＝**星域中心**，唯一一个 center）
  placement: { mode: 'center' },
  // ★ 默认数量范围（**可在星域配置 `sectorTypes[id].count` 内覆写**）；中心恒 1 个
  count: { min: 1, max: 1 },
  // ★ **初始内容**（逐星区生成用；全部【占位预填 · 待用户调校】）
  content: {
    ore: { min: 2000, max: 4000 }, // 星区储量（矿物）区间【占位预填】
    cargos: {
      // 星球(货物) 生成参数【占位预填】：empty 型为模板 id 数组（引用 `data/cargos/`），A-5 用种子抽取
      enabled: false,
      templates: [],
      count: { min: 0, max: 0 },
      tonsRange: { min: 5, max: 60 },
      levelRange: { min: 1, max: 1 },
    },
    structures: [], // 特殊结构【占位 · 待开发】：本轮恒空数组（纯数据、JSON 可序列化）
  },
  // ★ 默认 NPC 列表**可配置多个**（`npcListIds: string[]`；生成时按种子随机抽一个；`[]`＝无单位）
  npcListIds: [], // 默认 NPC 列表引用（空数组＝该类型默认无单位；引用见 `data/npcLists/`）
  specialEffect: null, // 特殊效果【占位 · 待开发】（本轮恒 null）
  texture: null, // ★ 贴图字段（预留）：非空 ⇒ 渲染贴图；为空 ⇒ 回退「类型色 + marker」（本轮不新增图片文件）
  fill: false, // 填充类型标记：**非**「剩余格位填充类型」（唯一 `fill:true` 者见 `empty.js`）
  mapColor: '--sector-star', // ★ 只存 CSS 变量名（色值在 `css/base.css :root`）
  marker: '★', // 地图标记符号【占位】（语言无关字符）
};
