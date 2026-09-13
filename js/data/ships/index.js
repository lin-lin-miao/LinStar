/* ===== data/ships/index.js —— 船型注册表 + 等级解析（唯一口径） =====
 * 体例与 `data/modules.js`（模块注册表）保持一致：**一个单位一个文件**，本文件只做聚合与解析。
 *   · 船型定义文件：`data/ships/<单位 id>.js`（文件名 ＝ 单位 id）；
 *   · `SHIPS`：id → 船型定义（**顶层字段即 Lv1 基准值**，与模块数据文件同一体例）；
 *   · `getShip(id)`：按 id 取船型定义（未知返回 null，调用方自负兜底）；
 *   · `resolveShipAtLevel(defOrId, level)`：**等级解析唯一口径** —— 把船型定义按等级合并出
 *     该等级的完整配置（返回**新对象**，不修改原定义）。
 *
 * ★ 等级模型（与模块等级模型 `entities/module.js resolveModuleCfg` **完全同构**）：
 *   · `maxLevel`：最大可用等级（缺省取 `levels` 最高等级 +1，至少 1）；
 *   · `levels[]`：**逐级绝对表**，每项 `{ level, ...该级覆写的任意条目 }`；
 *   · **未填字段回退上一级**（实现＝按等级**升序**依次深合并：数组/原始值直接覆盖，
 *     普通对象递归合并 → 任何未填条目自然沿用上一级，最终以顶层 Lv1 兜底）；
 *   · **可覆写的条目**：船型**任意条目** —— `base.*`（hp/shieldCap/energyCap/energyRegen/cargoCap/oreCap）、
 *     `coefficients.*`（attack/shield/function/transport/mining/drone…）、`slots`、`nameKey`、
 *     `icon`，以及将来新增的任何字段（解析器不做字段白名单，故天然可扩展）。
 *   · 实例默认等级 ＝ 1；`createShip(..., level)` 在建单位时用本函数解析一次，
 *     之后的护盾池/常驻加成等**全部派生都基于该实例基准值**（见 `entities/ship.js`）。
 * ★ 引擎与 UI 同口径：引擎建单位（`createShip`）与 UI 预演/展示都应调用本函数，
 *   不要各自手写等级合并。
 */
import { deepMerge, deepClone } from '../../core/utils.js';
import combat from './combat.js';
import transport from './transport.js';
import mining from './mining.js';
import drone from './drone.js';

/** 船型注册表（id → 船型定义；顺序＝默认展示顺序） */
export const SHIPS = {
  combat,     // 战斗舰：主要战斗单位
  transport,  // 运输舰：主要运输单位（M2 上场）
  mining,     // 采矿船：主要采矿单位（M2 上场）
  drone,      // 通用无人机：召唤模块临时召唤的单位模板（种类差异由 summon.attrs 覆写）
};

/** 船型 id 列表（默认展示顺序；UI 遍历用） */
export const SHIP_IDS = Object.keys(SHIPS);

/** 按 id 取船型定义（未知 → null） */
export function getShip(id) {
  return SHIPS[id] || null;
}

/** 依 `id` 或定义对象取定义（兼容两种入参，便于调用方按 id 解析） */
function defOf(defOrId) {
  return typeof defOrId === 'string' ? SHIPS[defOrId] || null : defOrId || null;
}

/** 船型最大可用等级：优先 `def.maxLevel`；否则按 `levels` 最高等级 +1（至少 1）
 *  （与 `entities/module.js moduleMaxLevel` 同一体例） */
export function shipMaxLevel(defOrId) {
  const def = defOf(defOrId);
  if (def && def.maxLevel) return def.maxLevel;
  let m = 1;
  for (const e of (def && def.levels) || []) {
    const l = e.level | 0;
    if (l + 1 > m) m = l + 1;
  }
  return m;
}

/** ★ 等级解析唯一口径：把船型定义按指定等级合并成该等级的完整配置（返回新对象，不改原定义）。
 *  · `level` 先钳到 [1, shipMaxLevel]；
 *  · 按等级**升序**依次深合并所有 `level <= 目标等级` 的条目（未填字段递归回退上一级）；
 *  · 输出里**不含 `levels`**（已解析完，避免调用方误用未解析的等级表）。
 *  用法：`resolveShipAtLevel('combat', 5)` 或 `resolveShipAtLevel(SHIPS.combat, 5)`。 */
export function resolveShipAtLevel(defOrId, level = 1) {
  const def = defOf(defOrId);
  if (!def) return null;
  const lv = Math.min(shipMaxLevel(def), Math.max(1, level | 0));
  const out = deepClone(def);
  const table = Array.isArray(def.levels) ? def.levels.slice() : [];
  table.sort((a, b) => (a.level | 0) - (b.level | 0)); // 升序 → 逐级回退（后一级覆盖前一级）
  for (const e of table) {
    if ((e.level | 0) > lv) continue;
    const patch = { ...e };
    delete patch.level; // `level` 只是“该条目的等级标注”，不进配置
    deepMerge(out, patch);
  }
  delete out.levels; // 解析结果不再携带等级表（该等级的数值已全部落到顶层）
  return out;
}

/** 该船型可选的等级列表（1..maxLevel；UI 下拉用） */
export function shipLevels(defOrId) {
  const out = [];
  for (let l = 1; l <= shipMaxLevel(defOrId); l += 1) out.push(l);
  return out;
}

export default SHIPS;
