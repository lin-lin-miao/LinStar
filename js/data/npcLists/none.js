/* ===== data/npcLists/none.js —— NPC 列表：无单位（空列表） =====
 * 用途：**明确的“该星区不放单位”**（与 `npcListId: null` 等价语义，但作为**可引用的列表 id** 存在
 *   ⇒ 星域配置里可显式写 `npcListId:'none'`，比 null 更直观、便于导出/导入对拍）。
 * 体例：**一列表一文件**，`id` 与文件名一致；聚合与查表见 `data/npcLists/index.js`。
 * ★ 结构（与其它列表完全同构，便于统一消费）：`id` / `nameKey` / `units[]`（本文件恒空）/ `side`（占位）。
 * ★ `units[]` 每条＝**一批同类单位**：`{ shipId, count | countRange:[min,max], level?, modules:[{moduleId,level?}] }`
 *   · `shipId` ⇒ 既有船型注册表 `data/ships/`（`SHIPS` / `SHIP_IDS`）；
 *   · `modules[].moduleId` ⇒ 既有模块注册表 `data/modules.js`（`MODULES`）；
 *   · **存在性 + 槽位数 + picker 校验**统一在 `data/starfieldData.js` 的 `selfCheck()`（只读）。
 * ★ 数值说明：本文件无任何数值（空列表）。
 */
export default {
  id: 'none',
  nameKey: 'npcList.none', // i18n -> 无单位 / No Units
  units: [], // ★ 空 ⇒ 该星区生成时不放任何单位
  side: null, // 【占位】敌我分布属**星域配置/玩法层**（`starfields/<id>.js` 的 `sideRules`），列表内不写死阵营
};
