/* ===== data/sectorTypes/empty.js —— 空区（基础类型 · 环绕 · **允许完全空**） =====
 * 定位（设计文档 §0「允许空星区」/§3）：**什么都不产出**的星区（储量 0、无货物、默认无单位）
 *   —— 用于把地图撑开、作为将来「移动/航行」的中转与缓冲；**星区本身仍照常走 tick**（静默空转）。
 * 体例：**一类型一文件**，`id` 与文件名一致；聚合与查表见 `data/sectorTypes/index.js`。
 * ★ 数值说明：**【占位预填 · 待用户调校】**（数量区间为占位；储量/货物**恒 0/false**＝空区口径）。
 */
export default {
  id: 'empty',
  nameKey: 'sectorType.empty', // i18n -> 空区 / Empty Space
  kind: 'basic',
  placement: { mode: 'ring' },
  count: { min: 0, max: 6 }, // ★ 允许 0 ⇒ **可以不生成空区**；上限为占位【占位预填】
  content: {
    ore: { min: 0, max: 0 }, // ★ 空区＝无储量（业务口径，不是占位）
    cargos: {
      enabled: false, // ★ 空区＝无星球(货物)
      templates: [],
      count: { min: 0, max: 0 },
      tonsRange: { min: 0, max: 0 },
      levelRange: { min: 1, max: 1 },
    },
    structures: [],
  },
  npcListId: null, // ★ 空区＝默认无单位（可由星域配置覆写，如把伏击队伍放进空区）
  specialEffect: null,
  // ★★ **填充类型标记（用户口径）**：`fill:true` ＝「**该类型是「剩余格位」的填充类型**」——
  //   生成器（`data/starfield.js`）在类型数量分配完成后，把**圆内所有没被任何类型占到的格位**
  //   一律补为本类型 ⇒ **星区总数恒 ＝ `layout.cells`**（半径 2 ⇒ 13 个星区，地图无空洞）。
  //   · **全仓只允许一个 `fill:true`**（由 `data/starfieldData.js selfCheck()` 的
  //     「恰有一个填充类型」项强制）；其余类型写 `fill:false`（或不写）。
  //   · 引擎**不硬编码类型 id**：哪个类型负责填充完全由本字段决定（换成别的类型同样生效）。
  //   · 该类型 `count{min,max}` 照旧按区间抽数（＝**显式生成**的空区）；**最终数量 ＝ 区间抽数 ＋ 补位数**，
  //     生成结果 `counts[<id>]` 里分别给 `requested`（区间抽数）/ `filled`（补位数）/ `placed`（合计）。
  fill: true, // ★ 唯一填充类型（见上方说明）
  texture: null, // ★ 贴图字段（预留）：非空 ⇒ 渲染贴图；为空 ⇒ 回退「类型色 + marker」（本轮不新增图片文件）
  mapColor: '--sector-empty',
  marker: '·',
};
