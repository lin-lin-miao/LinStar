/* ===== data/sectorTypes/planet.js —— 星球星区（基础类型 · 环绕） =====
 * 定位（设计文档 §3/§4）：产出**星球(货物)** 的常规星区（货物以实体形式落在星区里，可被装载光束装载）。
 * 体例：**一类型一文件**，`id` 与文件名一致；聚合与查表见 `data/sectorTypes/index.js`。
 * ★ 位置：`placement {mode:'ring'}` ＝**圆内任意格**（由 A-5 用种子确定）；亦支持可选约束
 *   `{mode:'ring', minRadius, maxRadius}`（本类型暂未使用 ⇒ 省略字段即“全环带”）。
 * ★ 数值说明：**【占位预填 · 待用户调校】**（数量/储量/货物参数全为占位；`mapColor` 只存 CSS 变量名）。
 */
export default {
  id: 'planet',
  nameKey: 'sectorType.planet', // i18n -> 星球星区 / Planet Sector
  kind: 'basic',
  placement: { mode: 'ring' }, // 圆内任意格（可选 minRadius/maxRadius 约束，本类型未启用）
  count: { min: 2, max: 5 }, // 默认数量范围【占位预填】（星域配置可覆写）
  content: {
    ore: { min: 200, max: 1200 }, // 星区储量区间【占位预填】（星球区矿少一些）
    cargos: {
      // 星球(货物)【占位预填】：`templates` 为空 ⇒ A-5 从全部货物类型里按种子抽取（非空时只从列出的类型抽）
      enabled: true,
      templates: [],
      count: { min: 1, max: 3 }, // 每个星球星区生成的货物件数区间
      tonsRange: { min: 5, max: 60 },
      levelRange: { min: 1, max: 3 },
    },
    structures: [],
  },
  npcListId: 'patrolLight', // 默认驻守：轻型巡逻队（星域配置可覆写为其它列表或 null）
  specialEffect: null,
  // ★★ **贴图字段（预留 · 本轮为空）**：`texture` ＝ 贴图/图标资源路径（相对仓库根，如 `assets/img/planet.svg`）；
  //   · **有值** ⇒ 地图格子与（后续 C-2）侧栏**渲染该贴图**；
  //   · **为空（null）** ⇒ **回退**为「类型色（`mapColor`）＋ 标记（`marker`）」的既有呈现。
  //   ★ 本轮**不新增任何图片文件、不自绘**：后续美术提供星球贴图后，把路径填到本字段即可（**无需改代码**）。
  texture: null,
  fill: false, // 填充类型标记：**非**「剩余格位填充类型」（唯一 `fill:true` 者见 `empty.js`）
  mapColor: '--sector-planet',
  marker: '●',
};
