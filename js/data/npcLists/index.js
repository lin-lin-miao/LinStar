/* ===== data/npcLists/index.js —— NPC 列表注册表（一列表一文件 · 只做聚合） =====
 * 体例与 `data/ships/index.js`、`data/cargos/index.js`、`data/sectorTypes/index.js` 一致：
 *   · 列表定义文件：`data/npcLists/<列表 id>.js`（**文件名 ＝ 列表 id**）；
 *   · `NPC_LISTS`：id → 列表定义（顺序＝默认展示顺序）；
 *   · `NPC_LIST_IDS`：id 列表（UI/遍历用，顺序同上）；
 *   · `getNpcList(id)`：按 id 取列表定义（未知返回 null，调用方自负兜底）。
 *
 * ★ 设计文档对应：§2-5「NPC 列表定义：**单位种类与数量**（单位配置：种类 id、数量或数量区间、等级、
 *   携带模块等）—— 供各星区类型引用」；§10 A-3。
 * ★ 单列表字段结构（**纯数据、可 JSON 序列化**）：
 *   `id` / `nameKey`（i18n `npcList.<id>`）/ `units[]` / `side`（占位）
 *   · `units[]` 每条＝**一批同类单位**：
 *       `{ shipId, count | countRange:[min,max], level?, modules?:[{ moduleId, level? }] }`
 *       —— `count` 与 `countRange` **二选一**（都缺省 ⇒ 视为 `count:1`，由 A-5 统一归一）；
 *   · `shipId` **必须引用既有船型注册表** `data/ships/`；`modules[].moduleId` **必须引用既有
 *     模块注册表** `data/modules.js`，且**不得引用 `picker:false`** 的内部/专属模块；
 *   · **敌我分布不在本层**：`side` 恒为占位 `null` —— 阵营由**星域配置/玩法层**
 *     （`data/starfields/<id>.js` 的 `sideRules`）决定，同一列表可被不同玩法分别当敌/友使用。
 * ★ 校验（只读、不改数据）：`data/starfieldData.js` 的 `selfCheck()` 会核对**存在性 / 槽位数 / picker**；
 *   本文件不做任何判断，只做聚合。
 */
import none from './none.js';
import patrolLight from './patrolLight.js';
import patrolHeavy from './patrolHeavy.js';

/** NPC 列表注册表（id → 列表定义；顺序＝默认展示顺序：空 → 轻 → 重） */
export const NPC_LISTS = {
  none,         // 无单位（空列表）
  patrolLight,  // 轻型巡逻队【占位预填】
  patrolHeavy,  // 重型巡逻队【占位预填】
};

/** NPC 列表 id 列表（默认展示顺序；UI 遍历用） */
export const NPC_LIST_IDS = Object.keys(NPC_LISTS);

/** 按 id 取 NPC 列表定义（未知 → null） */
export function getNpcList(id) {
  return NPC_LISTS[id] || null;
}

export default NPC_LISTS;
