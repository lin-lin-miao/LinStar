/* ===== data/cargos/index.js —— 货物类型注册表 + 等级解析（唯一口径） =====
 * 体例与 `data/ships/index.js`（船型注册表）、`data/modules.js`（模块注册表）**保持一致**：
 * **一物一文件**，本文件只做聚合与解析。
 *   · 货物定义文件：`data/cargos/<类型 id>.js`（文件名 ＝ 类型 id）；
 *   · `CARGOS`：id → 货物定义（**顶层字段即 Lv1 基准值**，与模块/船型数据文件同一体例）；
 *   · `getCargo(id)`：按 id 取货物定义（未知返回 null，调用方自负兜底）；
 *   · `resolveCargoAtLevel(defOrId, level)`：**等级解析唯一口径** —— 把货物定义按等级合并出
 *     该等级的完整配置（返回**新对象**，不修改原定义）。
 *
 * ★ 等级模型（与模块 `entities/module.js resolveModuleCfg`、船型 `ships/index.js resolveShipAtLevel`
 *   **完全同构**）：
 *   · `maxLevel`：最大可用等级（缺省取 `levels` 最高等级 +1，至少 1）；
 *   · `levels[]`：**逐级绝对表**，每项 `{ level, ...该级覆写的任意条目 }`；
 *   · **未填字段回退上一级**（实现＝按等级**升序**依次深合并：数组/原始值直接覆盖，
 *     普通对象递归合并 → 任何未填条目自然沿用上一级，最终以顶层 Lv1 兜底）；
 *   · **可覆写的条目**：货物**任意条目** —— `tons`/`loadTicks`/`bonus`/`name`/`nameKey`/
 *     `colorKey` 等（解析器不做字段白名单，故天然可扩展）；
 *   · 输出里**不含 `levels`**（已解析完，避免调用方误用未解析的等级表）。
 * ★ 引擎与 UI 同口径：**实例只在创建/规范化时解析一次**（`systems/battle.js normalizeSectorCargos`），
 *   编队界面展示装载时间等派生值也必须调用本函数，**不要各自手写等级合并**。
 * ★ 类型色：货物定义只给 **`colorKey`（CSS 变量名）**，色值一律登记在 `css/base.css :root`
 *   （`--cat-*`）——**货物文件内不硬编码色值**。
 */
import { deepMerge, deepClone } from '../../core/utils.js';
import none from './none.js';
import weaponPart from './weaponPart.js';
import fieldComponent from './fieldComponent.js';
import functionDevice from './functionDevice.js';
import droneDebris from './droneDebris.js';
import miningRig from './miningRig.js';
import freightBlueprint from './freightBlueprint.js';

/** 货物类型注册表（id → 货物定义；顺序＝默认展示顺序：None 在前，其后按模块类别序） */
export const CARGOS = {
  none,              // 无：**默认类型 / 兜底**（灰）
  weaponPart,        // 武器零件：攻击类色
  fieldComponent,    // 力场组件：护盾类色
  functionDevice,    // 功能设备：功能类色
  droneDebris,       // 机骸碎片：无人机类色（棕色）
  miningRig,         // 采矿器械：采矿类色（紫）
  freightBlueprint,  // 货运蓝图：运输类色（亮黄）
};

/** 类型 id 列表（默认展示顺序；UI 下拉/遍历用） */
export const CARGO_IDS = Object.keys(CARGOS);

/** 按 id 取货物定义（未知 → null） */
export function getCargo(id) {
  return CARGOS[id] || null;
}

/** 依 `id` 或定义对象取定义（兼容两种入参，便于调用方按 id 解析） */
function defOf(defOrId) {
  return typeof defOrId === 'string' ? CARGOS[defOrId] || null : defOrId || null;
}

/** 货物最大可用等级：优先 `def.maxLevel`；否则按 `levels` 最高等级 +1（至少 1）
 *  （与 `ships/index.js shipMaxLevel`、`entities/module.js moduleMaxLevel` 同一体例） */
export function cargoMaxLevel(defOrId) {
  const def = defOf(defOrId);
  if (def && def.maxLevel) return def.maxLevel;
  let m = 1;
  for (const e of (def && def.levels) || []) {
    const l = e.level | 0;
    if (l + 1 > m) m = l + 1;
  }
  return m;
}

/** ★ 等级解析唯一口径：把货物定义按指定等级合并成该等级的完整配置（返回新对象，不改原定义）。
 *  · `level` 先钳到 [1, cargoMaxLevel]；
 *  · 按等级**升序**依次深合并所有 `level <= 目标等级` 的条目（未填字段递归回退上一级）；
 *  · 输出里**不含 `levels`**（已解析完，避免调用方误用未解析的等级表）。
 *  用法：`resolveCargoAtLevel('weaponPart', 5)` 或 `resolveCargoAtLevel(CARGOS.weaponPart, 5)`。 */
export function resolveCargoAtLevel(defOrId, level = 1) {
  const def = defOf(defOrId);
  if (!def) return null;
  const lv = Math.min(cargoMaxLevel(def), Math.max(1, level | 0));
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
  out.level = lv;    // 解析结果显式带上生效等级（实例/展示都用它）
  return out;
}

/** 该货物可选的等级列表（1..maxLevel；UI 校验/展示用） */
export function cargoLevels(defOrId) {
  const out = [];
  for (let l = 1; l <= cargoMaxLevel(defOrId); l += 1) out.push(l);
  return out;
}

export default CARGOS;
