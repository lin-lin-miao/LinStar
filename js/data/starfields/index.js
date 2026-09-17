/* ===== data/starfields/index.js —— 星域配置注册表（一难度/玩法一文件 · 只做聚合） =====
 * 体例与 `data/ships/index.js`、`data/cargos/index.js`、`data/sectorTypes/index.js`、
 * `data/npcLists/index.js` **完全一致**：
 *   · 配置文件：`data/starfields/<id>.js`（**文件名 ＝ id**；难度＝`h1`…`hn`，玩法＝玩法名）；
 *   · `STARFIELDS`：id → 星域配置（顺序＝默认展示顺序：**由易到难**）；
 *   · `STARFIELD_IDS`：id 列表（UI/遍历用，顺序同上）；
 *   · `getStarfield(id)`：按 id 取星域配置（未知返回 null，调用方自负兜底）。
 *
 * ★ 设计文档对应：§2「星域配置文件（一种难度/玩法一个文件）」、§10 A-4。
 *   · **命名规则**：难度＝`H1`…`Hn`（一档一文件，`h1.js` ⇒ `id:'h1'`）；特定玩法＝玩法名（后续追加）。
 *   · 单文件字段：`id` / `nameKey` / `radius` / `durationTicks` / `seed`（可选）/ `sectorTypes`（类型开关 +
 *     各类型数量区间 + 默认 NPC 列表覆写）/ `sideRules`（敌我分布占位）/ `specialEffects`（占位）。
 *   · **数值一律占位预填、待用户调校**（见各文件注释）。
 * ★ **导出/导入一致性（用户口径 + C-3 前置）**：星域配置对象是**纯数据**（可 `JSON.parse(JSON.stringify(x))`
 *   往返、不含函数/循环引用）⇒ 导出文件与内置配置文件**同一格式**；`data/starfieldData.js` 的
 *   `selfCheck()` 会逐份做 **JSON 往返 + 引用存在性** 校验（只读，不改数据）。
 * ★ 本文件不做任何校验/生成：**生成器（配置 + 种子 ⇒ 星域初始状态）属步骤 A-5**（`data/starfield.js`）。
 */
import h1 from './h1.js';
import h2 from './h2.js';
import h3 from './h3.js';

/** 星域配置注册表（id → 配置；顺序＝默认展示顺序：由易到难） */
export const STARFIELDS = {
  h1, // 难度 H1（入门）【数值占位预填】
  h2, // 难度 H2（中档）【数值占位预填】
  h3, // 难度 H3（高档）【数值占位预填】
};

/** 星域配置 id 列表（默认展示顺序；UI 遍历用） */
export const STARFIELD_IDS = Object.keys(STARFIELDS);

/** 按 id 取星域配置（未知 → null） */
export function getStarfield(id) {
  return STARFIELDS[id] || null;
}

export default STARFIELDS;
