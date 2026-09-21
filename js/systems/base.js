/* ===== systems/base.js —— 主基地：**状态与规则的唯一来源**（M3a：状态骨架 + 资源账户） =====
 * 定位（主基地框架说明 §7）：
 *   · **基地状态唯一来源**＝本模块的内存对象 `baseState`（M3 **不持久化**，刷新即重置）；
 *   · 界面（`ui/baseView.js`）**只读** `snapshot()`，**不自算**资源与上限；
 *   · ★★ **本文件不持有任何数值**：全部消耗 / 耗时 / 门槛 / 效果都写在**各自的配置文件**里
 *     （建筑→`data/baseBuildings/<id>.js`；船型→`data/ships/<id>.js`；模块→`data/modules/<类别>/<模块>.js`；
 *     货物→`data/cargos/*.js`；初始额度→`data/baseConfig.js`）。本文件只实现**规则与校验**，
 *     且一切阈值都**从配置读出**（自检第 ⑤ 项用"配置值 ± 1 的边界断言"来证明这一点）。
 *
 * ★ 范围（M3a 骨架 + M3b 船坞）：
 *   · 已实装（M3a）：基地状态对象、五资源账户（校验 / 扣减 / **按上限截断的增加** / 只读快照）、
 *     **资源容量上限口径**（`capsOf()` / `remainingCapOf()`，来源＝配置）；
 *   · 已实装（M3b）：**船坞**——舰队**配置条目**（新建 / 编辑＝克隆 / 重命名 / 删除）、**建造**（扣资源 + 数量 +1）、
 *     **拆解**（按船坞比例返还）、**舰队容量**口径、蓝图门槛校验（模块 `blueprint`）；
 *   · **未实现（刻意留白）**：指挥中心升级与出战上限逻辑（M3c）、星门出征 / 返回（M3d）、研究推进（M3e）。
 *     这些一律留到后续步骤，本文件**不脑补**其逻辑（`out` 字段只做登记，出征扣减/归还属 M3d）。
 *
 * ★★ M3b 核心模型（用户口径）：**基地舰队 ＝ "抽象配置条目 + 数量"**，**不是逐艘实例**：
 *     `fleetConfigs[]` 每条 ＝ `{ id, name, shipId, level, modules[], count, out }`
 *       · `count` ＝ **拥有总数**；`out` ＝ **出征中数量**；
 *       · **相同配置合并**：`shipId + level + modules`（**模块顺序敏感**，与战斗侧模块激活顺序一致）相同
 *         ⇒ 视为同一条配置，**不再另建**（`createFleetConfig` 返回既有条目并标 `merged: true`）；
 *       · **已建造的配置不可修改**：要改只能**新建配置** —— `cloneFleetConfig` ＝"编辑"（以现有条目为模板
 *         克隆成**新条目**，原条目**原样保留**）；
 *       · **删除条件**：`count === 0 && out === 0`（只要有船（含在外）就拒删）；
 *       · **出征不从 `count` 里扣**：`count` 保留、`out` 增加（返回 ⇒ `out` 减；损毁 ⇒ 两者同步减，属 M3d）；
 *         界面显示「N 艘（在外 M）」，可用（未出征）数 ＝ `count − out`；
 *       · **容量**：`Σcount ≤ 船坞该等级 effect.fleetCapacity`（**船坞等级＝舰队总容量**；
 *         指挥中心等级＝出战上限，两者独立、互不换算，后者属 M3c）；
 *       · **拆解**：只能拆**未出征**的部分（`count − out`）；返还 ＝
 *         `每资源 floor(该配置单艘累计花费 × 艘数 × 船坞该等级 effect.scrapRefundRatio)`，**不足 1 不返还**。
 *
 * ★ 状态形状（M3b）：
 *   {
 *     stateVersion: <baseConfig.stateVersion>,   // M3b 起为 2（形状变更：`ships[]` ⇒ `fleetConfigs[]`）
 *     resources:   { <资源键>: 数量 },            // 五资源账户（基地级；与战斗内的矿物/货物不是同一层）
 *     buildings:   { <建筑 id>: { level } },      // 建筑等级（初始值读 baseConfig.initialBuildingLevel）
 *     fleetConfigs: [ { id, name, shipId, level, modules: [{ moduleId, level }], count, out } ],
 *       ★ **数组顺序 ＝ 列表显示顺序**（M3b 迭代 2 · B-3）：排序**不改形状**、不加 `order` 字段
 *         （⇒ 无需 `stateVersion` 迁移、顺序天然持久化）；`snapshot().fleet.configs` 按该顺序输出。
 *       ★ `modules[]` **允许同一 `moduleId` 重复**（每条各自 `level`），唯一上限＝该船型该等级的槽位数。
 *     fleetSeq:    0,                            // 配置 id 分配序号（删除后**不回收** ⇒ 不重号、可复现）
 *     blueprints:  {},                           // 蓝图＝门槛（{ moduleId: 数量 }；M3e 填充，本步只读）
 *     cargoStore:  [],                           // 研究站货物库（M3e 填充）
 *     research:    { slots, active },             // slots 读研究站配置效果；active＝进行中的研究（M3e）
 *   }
 *   ★ **上限不进状态**：资源上限、舰队容量、拆解比例**全部由配置派生**（改配置即改口径）。
 *   ★ M3a 的 `ships[]` 容器**已按用户口径移除**（迁移为 `fleetConfigs[]`），**不留兼容死字段**。
 *
 * ★ 资源 API 的**契约**（体例同 `systems/battle.js` 的"记账/落地"分离，这里是最小版）：
 *   · `canAfford(cost)`  ⇒ boolean；
 *   · `reasonOf(cost)`   ⇒ **缺哪个资源**：`null`（够）或 `{ resource, need, have }`；
 *   · `spend(cost)`      ⇒ `{ ok:true, spent }` / `{ ok:false, reason }`；★ **失败时状态零改动**；
 *   · `gain(gains)`      ⇒ `{ ok:true, gained, overflow }`（**按上限截断**；`overflow` ＝ 未获得的溢出量）
 *                          / `{ ok:false, reason }`（非法入参；**状态零改动**）；
 *   · `capsOf()`         ⇒ **上限只读快照**；`remainingCapOf(key)` ⇒ 该资源**还能加多少**；
 *   · `resourcesOf()`    ⇒ **只读快照**（新对象，改它不影响账户）。
 *   cost / gains 的键＝`data/resources.js` 的资源键；**未知键或非法值 ⇒ 拒绝执行**（不静默吞掉）；
 *   `null` / `undefined` ⇒ 视为空（零消耗）。
 *
 * ★ 舰队（M3b）API 的**契约**（一律"**先校验、后落地**"⇒ 失败时**状态零改动**）：
 *   · 只读：`fleetCapacityOf()` / `fleetTotal()` / `fleetOut()` / `fleetRemainingCap()` /
 *     `listFleetConfigs()`（含每条配置的造价、拆解预览、槽位与能力标记；**UI 直接渲染，不自算**）；
 *   · 干跑：`previewFleetSpec({shipId, level, modules})` ⇒ 校验 + 造价 + 槽位（**不改状态**，供新建/编辑表单）；
 *   · 配置：`createFleetConfig({name?, shipId, level, modules?})`（同配置**合并**、重名**自动 #N**）、
 *     `cloneFleetConfig(id, patch?)`（＝"编辑"⇒**新建条目**）、`renameFleetConfig(id, name)`、
 *     `deleteFleetConfig(id)`（**仅** `count === 0 && out === 0`）、`setFleetOut(id, n)`（M3d 预留 / 调试）；
 *   · 建造：`buildCostOf(id)`（该配置**单艘**造价）、`canBuild(id, n)`、`build(id, n)`；
 *   · 拆解：`scrapRefundOf(id, n)`（只读预览）、`scrap(id, n)`（只拆未出征的部分）；
 *   · 统计：`fleetStats()` ⇒ `{ capacity, total, out, remaining, scrapRefundRatio }`。
 *   失败一律返回 `{ ok:false, reason:{ code, ...参数 } }`；`code` 清单见 `FLEET_REASON_CODES`
 *   （**每个 code 都有成对的 i18n 词条** `base.reason.<code>`，界面据此显示禁用原因）。
 *   ★ 数值全部来自配置：船型 `buildCost` / `upgradeCost` / `slots` / `unlockByLevel`、
 *     模块 `installCost` / `blueprint`、船坞 `effect.fleetCapacity` / `effect.scrapRefundRatio`。
 */
import { i18n } from '../i18n/index.js';
import { BASE_CONFIG } from '../data/baseConfig.js';
import { RESOURCE_KEYS, RESOURCE_LIST, isResourceKey, getResource } from '../data/resources.js';
import {
  BASE_BUILDINGS,
  BASE_BUILDING_IDS,
  BASE_LIST_ITEMS,
  BASE_LIST_ITEM_IDS,
  getBaseBuilding,
  getBaseListItem,
} from '../data/baseBuildings/index.js';
import { MODULES, CATEGORY_ORDER } from '../data/modules.js';
import { SHIPS, SHIP_IDS, shipMaxLevel, shipLevels, resolveShipAtLevel } from '../data/ships/index.js';
import { moduleMaxLevel } from '../entities/module.js';

/** 自检 detail 最多列几条（避免控制台刷屏；体例同 `data/starfieldData.js`） */
const MAX_DETAIL = 5;
const head = (list) => (list.length > MAX_DETAIL ? `${list.slice(0, MAX_DETAIL).join('；')} …（共 ${list.length} 条）` : list.join('；'));
const jsonEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---------- 配置读取（唯一口径；**只读，不缓存、不改配置**） ---------- */

/** 把等级夹到该建筑配置 `levels[]` 的真实区间（**区间来自配置**，代码不写死等级上下限） */
export function clampBuildingLevel(defOrId, level) {
  const def = typeof defOrId === 'string' ? getBaseBuilding(defOrId) : defOrId;
  const levels = (def && def.levels) || [];
  if (!levels.length) return 0;
  const min = levels[0].level;
  const max = levels[levels.length - 1].level;
  const n = Number.isFinite(level) ? Math.floor(level) : min;
  return Math.min(max, Math.max(min, n));
}

/** 取该建筑在指定等级生效的 `levels[]` 条目（**逐级回退**：取 level ≤ 目标等级的最深一项） */
function levelEntryOf(defOrId, level) {
  const def = typeof defOrId === 'string' ? getBaseBuilding(defOrId) : defOrId;
  const levels = (def && def.levels) || [];
  const want = clampBuildingLevel(def, level);
  let out = null;
  for (const e of levels) {
    if (e && Number.isFinite(e.level) && e.level <= want) out = e;
  }
  return out || levels[0] || null;
}

/** ★ 建筑该等级的**消耗**（只读；缺失 ⇒ `{}`＝无消耗）。**数值一律来自配置**。 */
export function buildingCostOf(id, level) {
  const e = levelEntryOf(id, level);
  return e && e.cost && typeof e.cost === 'object' ? e.cost : {};
}

/** ★ 建筑该等级的**效果字段**（只读；缺失 ⇒ `{}`）。例如指挥中心 `{ maxFleet }`、研究站 `{ researchSlots }`。 */
export function buildingEffectOf(id, level) {
  const e = levelEntryOf(id, level);
  return e && e.effect && typeof e.effect === 'object' ? e.effect : {};
}

/** 建筑初始等级（读 `baseConfig.initialBuildingLevel` 并夹到该建筑配置区间内） */
function initialLevelOf(def) {
  return clampBuildingLevel(def, BASE_CONFIG.initialBuildingLevel);
}

/** 研究位数量：读研究站该等级的效果字段（**代码不写死研究位数**；缺字段 ⇒ 0） */
function researchSlotsOf(level) {
  const v = buildingEffectOf('researchStation', level).researchSlots;
  return Number.isFinite(v) ? v : 0;
}

/* ---------- 资源工具（纯函数；**不触碰状态**） ---------- */

/** 初始资源额度：读 `baseConfig.initialResources`（**只认已注册资源键**；缺键 ⇒ 0，
 *  该 0 只是**结构性缺省值**，不是玩法数值） */
function initialResources() {
  const src = BASE_CONFIG.initialResources || {};
  const out = {};
  for (const k of RESOURCE_KEYS) {
    const v = src[k];
    out[k] = Number.isFinite(v) ? v : 0;
  }
  return out;
}

/** ★ 单个上限值的**回落口径**（唯一实现）：非有限数 / 负数 ⇒ 0（＝**不提升**，不报错）。
 *  说明：这是**结构性回落**（不是玩法数值）；自检 ⑧ 专门断言"非法上限 ⇒ 回落 0 且行为可预期"。 */
function capValue(v) {
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

/** ★★ **上限口径的唯一实现**（纯函数；参数全部注入 ⇒ 自检可传"篡改过的配置副本"证明
 *  **上限完全随配置变**、代码里没有任何硬编码上限）：
 *      上限[k] ＝ initialCaps[k] ＋ Σ_{建筑} 该建筑**该等级** `effect.resourceCap[k]`
 *  · 建筑等级取 `levelsOf[id]`（缺省 0 ⇒ 不生效）；等级项沿用"逐级回退"（取 level ≤ 目标的最深一项）；
 *  · `effect.resourceCap` 缺失 / 非对象 / 键缺失 / 非法值 ⇒ 一律按 0 计（＝不提升）。 */
function capsFromConfig(initialCaps, buildings, levelsOf) {
  const out = {};
  for (const k of RESOURCE_KEYS) out[k] = capValue(initialCaps ? initialCaps[k] : 0);
  for (const id of Object.keys(buildings || {})) {
    const def = buildings[id];
    const levels = def && def.levels;
    if (!Array.isArray(levels)) continue;
    const want = levelsOf && Number.isFinite(levelsOf[id]) ? levelsOf[id] : 0;
    let entry = null;
    for (const e of levels) {
      if (e && Number.isFinite(e.level) && e.level <= want) entry = e;
    }
    const bonus = entry && entry.effect && typeof entry.effect === 'object' ? entry.effect.resourceCap : null;
    if (!bonus || typeof bonus !== 'object' || Array.isArray(bonus)) continue;
    for (const k of RESOURCE_KEYS) out[k] += capValue(bonus[k]);
  }
  return out;
}

/** 当前各建筑等级表（id → level；只读派生，不缓存） */
function currentLevels() {
  const out = {};
  for (const id of BASE_BUILDING_IDS) out[id] = buildingLevelOf(id);
  return out;
}

/** ★ **资源上限**（只读快照；来源＝配置：`baseConfig.initialResourceCaps` ＋ 建筑 `effect.resourceCap`） */
export function capsOf() {
  return capsFromConfig(BASE_CONFIG.initialResourceCaps, BASE_BUILDINGS, currentLevels());
}

/** ★ 某资源**还能再加多少**（只读）：`max(0, 上限 − 当前值)`；
 *  未知资源键 ⇒ 0（不存在的资源没有容量）。 */
export function remainingCapOf(key) {
  if (!isResourceKey(key)) return 0;
  const cap = capsFromConfig(BASE_CONFIG.initialResourceCaps, BASE_BUILDINGS, currentLevels())[key];
  const cur = Number.isFinite(baseState.resources[key]) ? baseState.resources[key] : 0;
  return Math.max(0, cap - cur);
}

/** ★ cost / gains 归一：`null` / `undefined` ⇒ `{}`（零）；
 *  返回 `null` 表示**非法**（未知资源键 / 非有限数 / 负数）—— 调用方据此拒绝执行且**不改状态**。 */
function normalizeAmounts(amounts) {
  if (amounts === null || amounts === undefined) return {};
  if (typeof amounts !== 'object' || Array.isArray(amounts)) return null;
  const out = {};
  for (const [k, v] of Object.entries(amounts)) {
    if (!isResourceKey(k)) return null;
    if (!Number.isFinite(v) || v < 0) return null;
    out[k] = v;
  }
  return out;
}

/* ---------- 舰队（M3b）：配置读取与纯工具（**数值一律来自配置，代码零硬编码**） ---------- */

/** ★ 舰队相关**失败原因码**（唯一清单）：每个 code 都有成对的 i18n 词条 `base.reason.<code>`，
 *  界面据此显示"为什么按钮是灰的"（自检 ⑥ 逐语言核对成对存在）。 */
export const FLEET_REASON_CODES = [
  'badSpec', 'unknownShip', 'notBuildable', 'unlockNotImplemented', 'badLevel', 'slotOverflow',
  'unknownModule', 'moduleNotPickable', 'badModuleLevel', 'blueprintMissing',
  'badCount', 'badCost', 'capacityFull', 'notAffordable', 'unknown', 'notEmpty', 'notEnoughIdle', 'badName', 'badOut',
  'badOrder', 'edgeMove',
  // ★ 模块槽位编辑（二级弹窗的确认 / 添加 / 移除，见 `applyModuleSlotIn`）
  'badAction', 'noTarget', 'slotsFull',
];

/** 去掉条目里的 `level` 标注（用于"整条即资源表"的写法 `{ level, energy, ore, ... }`） */
function withoutLevel(entry) {
  const rest = { ...entry };
  delete rest.level;
  return rest;
}

/** 逐级取值（**只认配置**；两种形状都吃）：
 *  · 数组＝逐级表：项 `{ level, count | cost | value | ...自由字段 }`；取 `level ≤ 目标` 的**最深一项**
 *    （未列出的等级**沿用上一项**，与船型 / 模块等级模型同体例）；无任何项 ⇒ 用 `opts.empty`；
 *  · 对象 / 数字＝**无逐级表**（所有等级同值）。
 *  `count`（蓝图）与 `cost`（升级消耗）两种既有写法都识别，其余字段整体返回。 */
function perLevelValueOf(raw, level, opts = {}) {
  if (Array.isArray(raw)) {
    const lv = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
    let hit = null;
    for (const e of raw) {
      if (!e || typeof e !== 'object') continue;
      if (!Number.isFinite(e.level) || e.level > lv) continue;
      hit = e;
    }
    if (!hit) return opts.empty;
    if (hit.count !== undefined) return hit.count;
    if (hit.cost !== undefined) return hit.cost;
    if (hit.value !== undefined) return hit.value;
    return withoutLevel(hit);
  }
  return raw === undefined ? opts.empty : raw;
}

/** 成本归一：**只认已注册资源键**，且只保留正有限数（缺键 / 0 / 非法 ⇒ 不计入） */
function costOf(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const k of RESOURCE_KEYS) {
    const v = raw[k];
    if (Number.isFinite(v) && v > 0) out[k] = v;
  }
  return out;
}

/** 成本累加（就地加到 `acc`；返回 `acc`） */
function addCost(acc, extra) {
  for (const k of RESOURCE_KEYS) {
    const v = extra[k];
    if (Number.isFinite(v) && v > 0) acc[k] = (acc[k] || 0) + v;
  }
  return acc;
}

/** 成本缩放（**只用于批量预览 / 建造**：`n` 倍的整份成本） */
function scaleCost(raw, n) {
  const out = {};
  const times = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  for (const k of RESOURCE_KEYS) {
    const v = raw[k];
    if (Number.isFinite(v) && v > 0 && times > 0) out[k] = v * times;
  }
  return out;
}

/** 船型定义取值（**兼容 id 字符串与定义对象** —— 与 `resolveShipAtLevel` / `clampBuildingLevel` 同体例；
 *  传对象 ⇒ 自检可注入"篡改过的定义"，证明累计口径真的读配置） */
function shipDefOf(defOrId) {
  return typeof defOrId === 'string' ? SHIPS[defOrId] || null : defOrId || null;
}

/** 模块定义取值（同上口径） */
function moduleDefOf(defOrId) {
  return typeof defOrId === 'string' ? MODULES[defOrId] || null : defOrId || null;
}

/** ★ 该船型该等级的**槽位数**（唯一口径 ＝ 既有 `resolveShipAtLevel(...).slots`）。
 *  ★★ 与战斗侧**完全同口径**（`entities/ship.js` 的 `ship.slots`、`ui/setupView.js` 的槽位校验、
 *     `systems/battle.js` 的注入校验、`data/npcLists/*` 的生成校验都读它）
 *     ⇒ 基地**绝不会造出"战斗装不下"**的配置。
 *  ★ `slotGrowth`（每 `every` 级 +`add`、上限 +`max`）的定位：它是**成长规则的配置描述**，
 *     本函数**不把它叠加**到槽位数上 —— 配置的 `levels[].slots` 已是**该等级的绝对值**，再叠加会越过
 *     战斗侧容量（自检 ⑨ 会核对 `slotGrowth` 的形状合法性、以及"每级槽位 ≥ Lv1 基础槽位"的单调性）。 */
export function shipSlotsOf(shipIdOrDef, level) {
  const res = resolveShipAtLevel(shipIdOrDef, level);
  const n = res && Number.isFinite(res.slots) ? res.slots : 0;
  return Math.max(0, Math.floor(n));
}

/** ★★ 建 **LvN** 的**单艘船型造价** ＝ `buildCost` ＋ Σ`upgradeCost`（**只累加 `level ≤ N` 的升级条目**）。
 *  · 逐级读配置：条目 `{ level, cost }` 与 `{ level, 资源键… }` 两种写法都吃；
 *  · **不硬编码任何数值 / 公式常量**：`level ≤ 1` 的条目不参与累加（那是建造基准、不是升级），
 *    该边界来自条目自身的 `level`，并由自检 ⑪ 用"注入的定义"逐级对拍证明。 */
export function shipBuildCostAtLevel(shipIdOrDef, level) {
  const def = shipDefOf(shipIdOrDef);
  if (!def) return {};
  const lv = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
  const out = costOf(def.buildCost);
  const table = Array.isArray(def.upgradeCost) ? def.upgradeCost : [];
  for (const e of table) {
    if (!e || typeof e !== 'object') continue;
    if (!Number.isFinite(e.level) || e.level > lv || e.level <= 1) continue;
    addCost(out, costOf(e.cost !== undefined ? e.cost : withoutLevel(e)));
  }
  return out;
}

/** ★ 模块**装配消耗**（该模块**该等级**的 `installCost`；数组 ⇒ 按逐级表，对象 ⇒ 各级同值；缺 ⇒ 免费）
 *  ★ 口径（用户裁决）：**编辑 / 新建配置本身不消耗资源**；造价只在**建造**时才扣。 */
export function moduleInstallCostOf(moduleIdOrDef, level) {
  const def = moduleDefOf(moduleIdOrDef);
  if (!def) return {};
  return costOf(perLevelValueOf(def.installCost, level, { empty: {} }));
}

/** ★ 模块**蓝图门槛**（该模块该等级所需蓝图数量；**门槛、不消耗**；缺 ⇒ 0 ＝无门槛）
 *  · 配置写法＝`blueprint: [{ level, count }]`（逐级表；未列出的等级沿用上一项）。 */
export function moduleBlueprintReqOf(moduleIdOrDef, level) {
  const def = moduleDefOf(moduleIdOrDef);
  if (!def) return 0;
  const v = perLevelValueOf(def.blueprint, level, { empty: 0 });
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** ★ 船型**解锁口径**（`unlockByLevel`；用户口径：**高等级建造的解锁条件不由货物决定**）：
 *  · 缺省 / 空数组 ⇒ **无条件，通过**；
 *  · **非空** ⇒ "条件尚未实装" ⇒ **保守拒绝建造**（`unlockNotImplemented`）。
 *    理由：宁可挡住，也**绝不静默忽略**用户写下的未知条件（M4 实装条件后再放开）。 */
export function unlockOkOf(shipIdOrDef, level) {
  const def = shipDefOf(shipIdOrDef);
  const list = def ? def.unlockByLevel : undefined;
  if (list === undefined || list === null) return { ok: true };
  if (Array.isArray(list) && list.length === 0) return { ok: true };
  return { ok: false, reason: { code: 'unlockNotImplemented', shipId: (def && def.id) || null, level } };
}

/** ★ 可装配模块清单（**玩家可选**；口径＝既有约定 `picker !== false`，与 `ui/setupView.js` 一致）：
 *  顺序＝类别顺序 `CATEGORY_ORDER`（配置）→ 注册表顺序（**确定性**）。 */
export function installableModuleIds() {
  const out = [];
  for (const cat of CATEGORY_ORDER) {
    for (const id of Object.keys(MODULES)) {
      const def = MODULES[id];
      if (!def || def.picker === false) continue;
      if (def.category !== cat) continue;
      out.push(id);
    }
  }
  // 兜底：类别字段缺失 / 未列入 CATEGORY_ORDER 的模块也**不丢**（顺序仍确定）
  for (const id of Object.keys(MODULES)) {
    const def = MODULES[id];
    if (!def || def.picker === false) continue;
    if (CATEGORY_ORDER.includes(def.category)) continue;
    out.push(id);
  }
  return out;
}

/** 模块清单归一（`{ moduleId, level }`；字符串元素等价 `{ moduleId, level: 1 }`；非法 ⇒ `null`） */
function normalizeModules(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const m of raw) {
    const spec = m && typeof m === 'object' ? m : { moduleId: m };
    const moduleId = spec.moduleId !== undefined ? spec.moduleId : spec.id;
    if (typeof moduleId !== 'string' || !moduleId) return null;
    const lv = Number.isFinite(spec.level) ? Math.max(1, Math.floor(spec.level)) : 1;
    out.push({ moduleId, level: lv });
  }
  return out;
}

/** ★ 配置**同一性键**（＝"是否同一条配置 / 是否合并"的唯一判据）：
 *  `shipId + level + **排序后的模块多重集**`。
 *  · **多重集** ⇒ 重复模块可表达、可区分：`[A,A]` ≠ `[A]`、`[A@1,A@2]` ≠ `[A@1,A@1]`；
 *  · **排序** ⇒ 同一性 / 合并**对装配顺序不敏感**：`[A,B]` ≡ `[B,A]`（同一多重集 ⇒ 同一条配置 ⇒ 合并）；
 *  · 排序口径 ＝ 按 `moduleId@level` 字符串的**字典序**（`Array.prototype.sort` 默认序）——
 *    **确定性**：不含时间 / 随机 / 语言相关比较；
 *  · 条目里**仍保留装配顺序**（`modules[]` 原样存放；合并时沿用**既有条目**的顺序，不重排玩家的配置）。
 *  ★ 分隔符选用：模块 id 是简单标识符（不含 `@` 与 `,`）；等级为整数 ⇒ `id@lv` 拼接**无歧义**。 */
function identityKeyOf(shipId, level, modules) {
  const lv = Number.isFinite(level) ? Math.floor(level) : 0;
  const parts = (modules || []).map(
    (m) => `${String(m.moduleId)}@${Number.isFinite(m.level) ? Math.floor(m.level) : 1}`
  );
  parts.sort();
  return `${String(shipId)}@${lv}|${parts.join(',')}`;
}

/** ★ 模块**筹码描述**（**渲染层只读**；含**空槽位占位**）—— 舰队表格行与弹窗草稿**共用同一构造器**：
 *  · 长度 ＝ `max(槽位数, 已装模块数)`（槽位不足时以模块数为准，界面仍能显示全部已装项）；
 *  · 每项**键名固定**（空槽也有全部键，值取中性值 ⇒ 界面永不读到 `undefined`）：
 *    `{ empty, moduleId, level, maxLevel, category, nameKey, icon }`；
 *  · `maxLevel` ＝ 该模块**该等级可选上限**（弹窗的模块等级下拉据此生成，界面**不自算**）。
 *  界面据此渲染既有类名 `.module-chip.<category>` / `.module-lv` 与空槽 `.module-slot-empty`。 */
function chipsOf(modules, slots, opts = {}) {
  const modOf = opts.moduleDefOf || moduleDefOf;
  const out = (modules || []).map((m) => {
    const def = modOf(m.moduleId);
    const maxLv = def ? moduleMaxLevel(def) : 1;
    return {
      empty: false,
      moduleId: m.moduleId,
      level: Number.isFinite(m.level) ? Math.floor(m.level) : 1,
      maxLevel: Number.isFinite(maxLv) && maxLv > 0 ? Math.floor(maxLv) : 1,
      category: def && def.category ? def.category : '',
      nameKey: def ? def.nameKey || null : null,
      icon: def && def.icon ? def.icon : null,
    };
  });
  const total = Math.max(Number.isFinite(slots) ? Math.max(0, Math.floor(slots)) : 0, out.length);
  while (out.length < total) {
    out.push({ empty: true, moduleId: null, level: 0, maxLevel: 0, category: '', nameKey: null, icon: null });
  }
  return out;
}

/* ---------- 状态：创建 / 单例 / 重置 ---------- */

/** ★ 创建一份**全新的基地状态**（纯函数：不改任何已有对象，也不写单例） */
export function createBaseState() {
  const buildings = {};
  for (const id of BASE_BUILDING_IDS) {
    const def = BASE_BUILDINGS[id];
    buildings[id] = { level: initialLevelOf(def) };
  }
  const researchLevel = buildings.researchStation ? buildings.researchStation.level : 0;
  return {
    stateVersion: BASE_CONFIG.stateVersion,
    resources: initialResources(),
    buildings,
    // ★ M3b：舰队**配置条目**（抽象配置 + 数量）＋ id 分配序号（删除不回收 ⇒ 不重号、可复现）
    fleetConfigs: [],
    fleetSeq: 0,
    blueprints: {},   // M3e：{ moduleId: 数量 }（门槛、不消耗；M3b 只读它做蓝图门槛校验）
    cargoStore: [],   // M3e：研究站货物库（按类型 + 等级堆叠）
    research: { slots: researchSlotsOf(researchLevel), active: null },
  };
}

/** ★★ **基地状态唯一实例**（M3 不持久化；刷新即重置。界面只读它的快照） */
export const baseState = createBaseState();

/** ★ 重置基地（**仅调试用**；就地改写单例字段 ⇒ 保持对象引用不变，控制台持有的引用照样有效） */
export function resetBaseState() {
  const fresh = createBaseState();
  for (const k of Object.keys(baseState)) delete baseState[k];
  Object.assign(baseState, fresh);
  return baseState;
}

/* ---------- 资源账户 API（对**单例**操作；内部另有 state 参数版供自检隔离使用） ---------- */

/** 缺哪个资源（`null` ＝ 都够） */
function reasonOfIn(state, cost) {
  const c = normalizeAmounts(cost);
  if (c === null) return { code: 'badCost' };
  for (const k of RESOURCE_KEYS) {
    const need = c[k] || 0;
    if (need > 0 && state.resources[k] < need) return { resource: k, need, have: state.resources[k] };
  }
  return null;
}

/** 校验（纯查询，**不改状态**） */
function canAffordIn(state, cost) {
  return reasonOfIn(state, cost) === null;
}

/** 扣减：**先校验、后落地** ⇒ 不足时**状态逐字段不变**（返回 `{ ok:false, reason }`） */
function spendIn(state, cost) {
  const c = normalizeAmounts(cost);
  if (c === null) return { ok: false, reason: { code: 'badCost' } };
  const reason = reasonOfIn(state, c);
  if (reason) return { ok: false, reason };
  const spent = {};
  for (const k of RESOURCE_KEYS) {
    const n = c[k] || 0;
    if (n > 0) {
      state.resources[k] -= n;
      spent[k] = n;
    }
  }
  return { ok: true, spent };
}

/** 增加（唯一入账口径：**逐键精确相加**，但**按上限截断**——超出部分不获得并计入 `overflow`）
 *  @param caps 可选：显式上限表（**只给自检用**，用于注入"篡改过的上限"证明口径随配置变）；
 *              缺省 ⇒ 读配置（`capsFromConfig`）。
 *  ★ 截断口径：`take = min(请求量, 上限 − 当前值)`；`take` 为 0 的资源**不出现在 `gained` 里**，
 *    被拒收的量出现在 `overflow` 里（`overflow` 为空对象 ⇒ 全部入账成功）。 */
function gainIn(state, gains, caps) {
  const g = normalizeAmounts(gains);
  if (g === null) return { ok: false, reason: { code: 'badGain' } };
  const cap = caps && typeof caps === 'object' ? caps : capsFromConfig(BASE_CONFIG.initialResourceCaps, BASE_BUILDINGS, currentLevels());
  const gained = {};
  const overflow = {};
  for (const k of RESOURCE_KEYS) {
    const n = g[k] || 0;
    if (n <= 0) continue;
    const cur = Number.isFinite(state.resources[k]) ? state.resources[k] : 0;
    const room = Math.max(0, capValue(cap[k]) - cur);
    const take = Math.min(n, room);
    if (take > 0) {
      state.resources[k] = cur + take;
      gained[k] = take;
    }
    if (n - take > 0) overflow[k] = n - take;
  }
  return { ok: true, gained, overflow };
}

/** 够不够付这笔消耗 */
export function canAfford(cost) {
  return canAffordIn(baseState, cost);
}

/** **缺哪个资源**：`null`（够）或 `{ resource, need, have }`；cost 非法 ⇒ `{ code:'badCost' }` */
export function reasonOf(cost) {
  return reasonOfIn(baseState, cost);
}

/** 扣减资源：成功 `{ ok:true, spent }`；不足 / 非法 ⇒ `{ ok:false, reason }` 且**状态零改动** */
export function spend(cost) {
  return spendIn(baseState, cost);
}

/** 增加资源：成功 `{ ok:true, gained, overflow }`（**按上限截断**，超出部分不获得）；
 *  非法 ⇒ `{ ok:false, reason }` 且**状态零改动**。 */
export function gain(gains) {
  return gainIn(baseState, gains);
}

/** ★ **只读快照**（新对象；改它不影响账户） */
export function resourcesOf() {
  return { ...baseState.resources };
}

/* ---------- 舰队（M3b）：状态 API（一律"先校验、后落地" ⇒ 失败时状态零改动） ---------- */

/** 状态内的建筑等级（未知 ⇒ 0） */
function stateLevelOf(state, id) {
  const b = state.buildings ? state.buildings[id] : null;
  return b && Number.isFinite(b.level) ? b.level : 0;
}

/** ★ **舰队总容量**（读船坞该等级 `effect.fleetCapacity`；缺 / 非法 / ≤0 ⇒ 0 ＝一艘也建不了）
 *  ★ 口径：**船坞等级 ＝ 舰队总容量**；**指挥中心等级 ＝ 出战上限**（两者独立、互不换算，后者属 M3c）。 */
function fleetCapacityIn(state) {
  const v = buildingEffectOf('shipyard', stateLevelOf(state, 'shipyard')).fleetCapacity;
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** ★ **拆解返还比例**（读船坞该等级 `effect.scrapRefundRatio`；夹到 [0,1]；缺 / 非法 ⇒ 0 ＝不返还） */
function scrapRatioIn(state) {
  const v = buildingEffectOf('shipyard', stateLevelOf(state, 'shipyard')).scrapRefundRatio;
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/** 舰队**拥有总数** Σ`count` */
function fleetTotalIn(state) {
  let n = 0;
  for (const c of state.fleetConfigs || []) n += Number.isFinite(c.count) ? c.count : 0;
  return n;
}

/** 舰队**在外总数** Σ`out` */
function fleetOutIn(state) {
  let n = 0;
  for (const c of state.fleetConfigs || []) n += Number.isFinite(c.out) ? c.out : 0;
  return n;
}

/** 舰队**剩余容量** ＝ `max(0, 容量 − 拥有总数)` */
function fleetRemainingCapIn(state) {
  return Math.max(0, fleetCapacityIn(state) - fleetTotalIn(state));
}

/** 按 id 取配置条目（返回内部对象引用；**只读 API 不外泄它**） */
function findFleetConfigIn(state, id) {
  for (const c of state.fleetConfigs || []) if (c && c.id === id) return c;
  return null;
}

/** 下一个配置 id（序号单调递增、删除**不回收** ⇒ 不重号且可复现） */
function nextFleetIdIn(state) {
  state.fleetSeq = (Number.isFinite(state.fleetSeq) ? state.fleetSeq : 0) + 1;
  return `fc${state.fleetSeq}`;
}

/** ★ **配置默认名**（用户口径 A-3：**必须走 i18n 模板，绝不硬编码**）：
 *  取 `base.fleet.defaultName`（zh/en **成对**，参数 `{ship}` ＝ 该船型的 i18n 名称）；
 *  模板缺失（`??key`）⇒ 退化为船型名本身（**仍然不是**船型 id 字面量）。
 *  ★ 这是一条**词条驱动的显示名**：同一份草稿在 zh / en 下生成不同文本（自检 ㉓ 逐语言断言）。
 *  ★ 时点口径：默认名在**创建那一刻**物化进状态（此后切语言**不改**已建条目名，符合"状态里存的是名字本身"）。 */
function defaultFleetNameOf(nameKey, shipId) {
  const ship = nameKey && i18n.has(nameKey) ? i18n.t(nameKey) : String(shipId === undefined || shipId === null ? '' : shipId);
  const text = i18n.t('base.fleet.defaultName', { ship });
  return text && !text.startsWith('??') ? text : ship;
}

/** ★ 命名去重：`wanted` 未被占用 ⇒ 原样；被占用 ⇒ 去掉末尾 `#N` 后再依次试 `#2`、`#3`… 取第一个空位。
 *  · **确定性**：`taken` 是有限集合 ⇒ 必然终止，且**不依赖时间 / 随机**；
 *  · "去尾 `#N`"让**克隆链不会越滚越长**（`A#2` 再克隆 ⇒ `A#3`，而不是 `A#2#2`）。 */
function uniqueFleetNameIn(state, wanted, exceptId) {
  const base = typeof wanted === 'string' && wanted.trim() ? wanted.trim() : '';
  const taken = new Set((state.fleetConfigs || []).filter((c) => c && c.id !== exceptId).map((c) => c.name));
  if (base && !taken.has(base)) return base;
  const stem = base.replace(/#\d+$/, '').trim() || base || 'fleet';
  let n = 2;
  while (taken.has(`${stem}#${n}`)) n += 1;
  return `${stem}#${n}`;
}

/** ★ 成本按比例**向下取整**：先按 1e-6 精度消掉浮点误差再取整
 *  （例：`0.6 × 10` 在浮点下是 `5.999…`，不消误差会少返 1）。1e-6 是**数值稳定性常量**，不是玩法数值。 */
function floorScaled(x) {
  return Math.floor(Math.round(x * 1e6) / 1e6);
}

/**
 * ★★ 舰队配置规格的**只读校验 + 预览**（**不改任何状态**）—— 新建 / 编辑 / 干跑**共用同一口径**。
 * @param spec `{ name?, shipId, level?, modules? }`
 * @param opts `{ shipDefOf?, moduleDefOf?, blueprintReqOf? }` —— ★ **仅自检注入用**（证明校验真的读配置）
 * @returns `{ ok:true, shipId, level, maxLevel, slots, modules, cost, nameKey }` /
 *          `{ ok:false, reason:{ code, ...参数 } }`
 *   · `cost` ＝ **单艘累计造价**（船型 LvN 造价 ＋ Σ各模块装配消耗）——**只算账、不扣资源**；
 *   · 校验顺序：①形状 ②船型存在 ③等级合法 ④可建造 ⑤解锁条件 ⑥模块形状 ⑦槽位 ⑧模块存在 / 可装配 /
 *     等级上限 / **蓝图门槛**。 */
function validateFleetSpecIn(state, spec, opts = {}) {
  const modOf = opts.moduleDefOf || moduleDefOf;
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    return { ok: false, reason: { code: 'badSpec' }, chips: [], slots: 0, maxLevel: 0, iconShip: iconShipOf(null, 1) };
  }
  const shipOf = opts.shipDefOf || shipDefOf;
  const def = shipOf(spec.shipId);
  const modules = normalizeModules(spec.modules);
  // ★ `chips`：**每次都给出**（含空槽位占位）—— 弹窗草稿即使暂时不合法也能照常渲染模块筹码
  const chips = (slots) => chipsOf(modules === null ? [] : modules, slots, { moduleDefOf: modOf });
  if (!def) {
    return {
      ok: false, reason: { code: 'unknownShip', shipId: spec.shipId === undefined ? null : String(spec.shipId) },
      chips: chips(0), slots: 0, maxLevel: 0, iconShip: iconShipOf(null, 1),
    };
  }
  const maxLevel = shipMaxLevel(def);
  const rawLevel = spec.level === undefined || spec.level === null ? 1 : spec.level;
  if (!Number.isInteger(rawLevel) || rawLevel < 1 || rawLevel > maxLevel) {
    return {
      ok: false, reason: { code: 'badLevel', level: Number.isFinite(rawLevel) ? rawLevel : null, maxLevel },
      chips: chips(0), slots: 0, maxLevel, iconShip: iconShipOf(def, 1),
    };
  }
  const slots = shipSlotsOf(def, rawLevel);
  const iconShip = iconShipOf(def, rawLevel); // ★ 弹窗标题的单位图标：与列表**同源同口径**
  if (def.buildable === false) {
    return { ok: false, reason: { code: 'notBuildable', shipId: String(def.id) }, chips: chips(slots), slots, maxLevel, iconShip };
  }
  const unlock = unlockOkOf(def, rawLevel);
  if (!unlock.ok) return { ok: false, reason: unlock.reason, chips: chips(slots), slots, maxLevel, iconShip };
  if (modules === null) return { ok: false, reason: { code: 'badSpec' }, chips: [], slots, maxLevel, iconShip };
  // ★ 重复模块**合法**（同一 `moduleId` 可在一条配置里出现多次）：唯一的上限是**槽位数**
  if (modules.length > slots) {
    return { ok: false, reason: { code: 'slotOverflow', need: modules.length, slots }, chips: chips(slots), slots, maxLevel, iconShip };
  }
  const reqOf = opts.blueprintReqOf || moduleBlueprintReqOf;
  const owned = state.blueprints || {};
  const cost = shipBuildCostAtLevel(def, rawLevel);
  for (const m of modules) {
    const mdef = modOf(m.moduleId);
    const fail = (reason) => ({ ok: false, reason, chips: chips(slots), slots, maxLevel, iconShip });
    if (!mdef) return fail({ code: 'unknownModule', moduleId: m.moduleId });
    if (mdef.picker === false) return fail({ code: 'moduleNotPickable', moduleId: m.moduleId });
    const mMax = moduleMaxLevel(mdef);
    if (m.level > mMax) return fail({ code: 'badModuleLevel', moduleId: m.moduleId, level: m.level, maxLevel: mMax });
    const need = reqOf(mdef, m.level);
    const have = Number.isFinite(owned[m.moduleId]) ? owned[m.moduleId] : 0;
    if (need > have) return fail({ code: 'blueprintMissing', moduleId: m.moduleId, level: m.level, need, have });
    // ★ 造价按**该模块该等级**的 `installCost` 取（逐级表；重复模块**各算一份**）
    addCost(cost, moduleInstallCostOf(mdef, m.level));
  }
  return {
    ok: true, shipId: String(def.id), level: rawLevel, maxLevel, slots, modules, cost,
    nameKey: def.nameKey, chips: chips(slots), iconShip,
  };
}

/** 某条配置的**单艘累计造价**（船型 LvN 造价 ＋ Σ各模块装配消耗）。
 *  ★ 不走"能否装配"的校验：**已建成的配置即使在后来失去蓝图门槛，也照样能按原造价拆解**。 */
function costOfConfigIn(state, cfg, opts = {}) {
  const shipOf = opts.shipDefOf || shipDefOf;
  const modOf = opts.moduleDefOf || moduleDefOf;
  const cost = shipBuildCostAtLevel(shipOf(cfg.shipId), cfg.level);
  for (const m of cfg.modules || []) addCost(cost, moduleInstallCostOf(modOf(m.moduleId), m.level));
  void state;
  return cost;
}

/** ★ 拆解返还（**只读；不改状态**）：每资源 `floor(单艘累计花费 × 艘数 × 船坞比例)`，**不足 1 不返还**。
 *  @param opts.costOf ★ **仅自检注入用**（注入"看得见取整"的成本 ⇒ 证明比例与向下取整真的生效） */
function refundWith(state, cfg, n, opts = {}) {
  const ratio = scrapRatioIn(state);
  const one = opts.costOf ? opts.costOf(cfg) : costOfConfigIn(state, cfg, opts);
  const times = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  const out = {};
  for (const k of RESOURCE_KEYS) {
    const v = one[k];
    if (!Number.isFinite(v) || v <= 0 || times <= 0) continue;
    const r = floorScaled(v * times * ratio);
    if (r > 0) out[k] = r; // ★ 不足 1 不返还
  }
  return out;
}

/** ★ 建造前校验（**不改状态**）：`{ok:true, cost, capacity, used}` / `{ok:false, reason}` */
function canBuildIn(state, id, n = 1, opts = {}) {
  const cfg = findFleetConfigIn(state, id);
  if (!cfg) return { ok: false, reason: { code: 'unknown', id: id === undefined ? null : String(id) } };
  if (!Number.isInteger(n) || n <= 0) return { ok: false, reason: { code: 'badCount', n: Number.isFinite(n) ? n : null } };
  const def = (opts.shipDefOf || shipDefOf)(cfg.shipId);
  if (!def) return { ok: false, reason: { code: 'unknownShip', shipId: String(cfg.shipId) } };
  if (def.buildable === false) return { ok: false, reason: { code: 'notBuildable', shipId: String(cfg.shipId) } };
  const unlock = unlockOkOf(def, cfg.level);
  if (!unlock.ok) return { ok: false, reason: unlock.reason };
  const capacity = fleetCapacityIn(state);
  const used = fleetTotalIn(state);
  if (used + n > capacity) {
    return { ok: false, reason: { code: 'capacityFull', need: n, capacity, used, remaining: Math.max(0, capacity - used) } };
  }
  const cost = scaleCost(costOfConfigIn(state, cfg, opts), n);
  const short = reasonOfIn(state, cost);
  // `short` ＝ `{ resource, need, have }`；成本本身非法时是 `{ code:'badCost' }` ⇒ **原样上报**（不覆盖 code）
  if (short) return { ok: false, reason: short.code ? short : { code: 'notAffordable', ...short } };
  return { ok: true, cost, capacity, used, count: cfg.count };
}

/** ★ **建造**：扣资源 ⇒ `count += n`（`out` 不变；**先校验、后落地**，失败 ⇒ 状态零改动） */
function buildIn(state, id, n = 1, opts = {}) {
  const pre = canBuildIn(state, id, n, opts);
  if (!pre.ok) return { ok: false, reason: pre.reason };
  const paid = spendIn(state, pre.cost);
  if (!paid.ok) return { ok: false, reason: paid.reason }; // 双保险：预校验过了仍失败 ⇒ 不落地
  const cfg = findFleetConfigIn(state, id);
  cfg.count += n;
  return { ok: true, id, built: n, spent: paid.spent, count: cfg.count, capacity: pre.capacity };
}

/** ★ 拆解前校验（**不改状态**）：**只能拆未出征的部分** `count − out` */
function canScrapIn(state, id, n = 1, opts = {}) {
  const cfg = findFleetConfigIn(state, id);
  if (!cfg) return { ok: false, reason: { code: 'unknown', id: id === undefined ? null : String(id) } };
  if (!Number.isInteger(n) || n <= 0) return { ok: false, reason: { code: 'badCount', n: Number.isFinite(n) ? n : null } };
  const idle = Math.max(0, cfg.count - cfg.out);
  if (n > idle) return { ok: false, reason: { code: 'notEnoughIdle', n, idle, out: cfg.out, count: cfg.count } };
  return { ok: true, refund: refundWith(state, cfg, n, opts), ratio: scrapRatioIn(state) };
}

/** ★ **拆解**：`count -= n`（`out` 不变）＋ 按比例返还资源。
 *  返还**走既有 `gainIn`** ⇒ 仍受**资源上限**截断，被拒收的部分在 `overflow` 返回；
 *  **先校验、后落地**：任何失败 ⇒ 状态零改动（返还入账失败会回滚数量）。 */
function scrapIn(state, id, n = 1, opts = {}) {
  const pre = canScrapIn(state, id, n, opts);
  if (!pre.ok) return { ok: false, reason: pre.reason };
  const cfg = findFleetConfigIn(state, id);
  cfg.count -= n;
  const paid = gainIn(state, pre.refund);
  if (!paid.ok) {
    cfg.count += n; // 极端兜底：返还入账失败 ⇒ 回滚，保持"失败即零改动"
    return { ok: false, reason: paid.reason };
  }
  return { ok: true, id, scrapped: n, refund: paid.gained, overflow: paid.overflow, count: cfg.count };
}

/** ★ **新建配置**：同配置（同 `shipId + level + modules`）⇒ **合并**（返回既有条目、`merged:true`）；
 *  重名 ⇒ **自动追加 `#N`**（`renamed:true`）。
 *  ★★ M3b 迭代 2（用户口径 B-2：「只改名称却被合并 ⇒ 新名称未应用」）——**最终规则**：
 *   · **合并时以草稿的显式新名为准**：草稿名非空 ⇒ 按同一套唯一性规则（`#N`）解析后**更新既有条目名**，
 *     既有条目的 `count` / `out` **原样保留**（数量与在外不受改名影响）；
 *   · 草稿名**留空** ⇒ 视为"未指定" ⇒ **保留既有条目名**（不churn、不追加 `#N`）；
 *   · 名字与既有条目**相同** ⇒ 名称零变化（`nameChanged:false`，也不会被误判成重名而追加 `#N`）；
 *   · 草稿与既有条目**逐字段完全相同**（含名称） ⇒ 照旧合并、**不产生新条目 / 空条目**；
 *   · 未命中既有条目（例如同时改了船型 / 等级 / 模块） ⇒ 走"新建条目"分支（编辑＝另存为新配置时，
 *     原条目**原样保留**，见 `cloneFleetConfigIn`）。 */
function createFleetConfigIn(state, spec, opts = {}) {
  const v = validateFleetSpecIn(state, spec, opts);
  if (!v.ok) return { ok: false, reason: v.reason };
  const wanted = spec && typeof spec.name === 'string' ? spec.name.trim() : '';
  const key = identityKeyOf(v.shipId, v.level, v.modules);
  for (const c of state.fleetConfigs || []) {
    if (identityKeyOf(c.shipId, c.level, c.modules) === key) {
      const before = c.name;
      if (wanted) c.name = uniqueFleetNameIn(state, wanted, c.id); // ★ 显式新名 ⇒ 覆盖（同名前不会变成 #2）
      return {
        ok: true, id: c.id, name: c.name, merged: true,
        renamed: wanted !== '' && c.name !== wanted,
        nameChanged: c.name !== before,
      };
    }
  }
  const fallback = defaultFleetNameOf(v.nameKey, v.shipId); // ★ i18n 默认名（不硬编码）
  const name = uniqueFleetNameIn(state, wanted || fallback, null);
  const id = nextFleetIdIn(state);
  state.fleetConfigs.push({
    id,
    name,
    shipId: v.shipId,
    level: v.level,
    modules: v.modules.map((m) => ({ ...m })),
    count: 0,
    out: 0,
  });
  return { ok: true, id, name, merged: false, renamed: name !== (wanted || fallback), nameChanged: true };
}

/** ★ **编辑 ＝ 克隆为新配置**（原条目**原样保留**、`count/out` 不动；新条目从 `count = out = 0` 起）。
 *  `patch` 可覆写 `{ name, shipId, level, modules }`（表单里改船型 / 等级 / 模块后"另存为新配置"）。 */
function cloneFleetConfigIn(state, id, patch = {}, opts = {}) {
  const src = findFleetConfigIn(state, id);
  if (!src) return { ok: false, reason: { code: 'unknown', id: id === undefined ? null : String(id) } };
  const p = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  const spec = {
    name: p.name !== undefined ? p.name : src.name,
    shipId: p.shipId !== undefined ? p.shipId : src.shipId,
    level: p.level !== undefined ? p.level : src.level,
    modules: p.modules !== undefined ? p.modules : (src.modules || []).map((m) => ({ ...m })),
  };
  const r = createFleetConfigIn(state, spec, opts);
  if (r.ok) r.clonedFrom = src.id;
  return r;
}

/** ★ **重命名**（走同一套"去重 ⇒ `#N`"口径；空名 ⇒ `badName`） */
function renameFleetConfigIn(state, id, name) {
  const cfg = findFleetConfigIn(state, id);
  if (!cfg) return { ok: false, reason: { code: 'unknown', id: id === undefined ? null : String(id) } };
  if (typeof name !== 'string' || !name.trim()) return { ok: false, reason: { code: 'badName' } };
  const next = uniqueFleetNameIn(state, name, id);
  cfg.name = next;
  return { ok: true, id, name: next, renamed: next !== name.trim() };
}

/** ★★ **配置排序**（用户口径 B-3）——**持久化字段＝状态数组本身的顺序**（`state.fleetConfigs[]`）。
 *  ★ 为什么不另开 `order` 字段 / 独立顺序数组：
 *   · 数组顺序**就是状态**（`save.js` 整体快照状态 ⇒ **天然持久化**，无需加字段、无需 `stateVersion` 迁移）；
 *   · 只有一个顺序来源 ⇒ 不会出现"数组顺序与 order 字段打架"的第二口径；
 *   · `snapshot().fleet.configs` / `listFleetConfigsIn` 本来就按数组顺序输出 ⇒ **快照顺序＝显示顺序**，界面零排序逻辑。
 *  ★ 两个入口（**同一口径**：都先校验、后改动 ⇒ 被拒时**状态零改动**）：
 *   · `moveFleetConfigIn(state, id, delta)`：`delta` 只允许 `-1`（上移）/ `+1`（下移）——配对"上移 / 下移"按钮；
 *   · `reorderFleetConfigIn(state, id, toIndex)`：拖到**最终下标**——配对拖动排序。
 *  ★ 确定性：纯数组搬移，无随机 / 无时间；越界与非法参数一律返回 `badOrder` / `edgeMove`。 */
function moveFleetConfigIn(state, id, delta) {
  const list = state.fleetConfigs || [];
  const from = list.findIndex((c) => c && c.id === id);
  if (from < 0) return { ok: false, reason: { code: 'unknown', id: id === undefined ? null : String(id) } };
  if (delta !== -1 && delta !== 1) {
    return { ok: false, reason: { code: 'badOrder', dir: Number.isFinite(delta) ? delta : null } };
  }
  const to = from + delta;
  if (to < 0 || to >= list.length) {
    return { ok: false, reason: { code: 'edgeMove', index: from, total: list.length, dir: delta } };
  }
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  return { ok: true, id, from, to };
}

/** 拖到指定**最终下标**（`toIndex` 为搬移后的位置；与本条目当前位置相同 ⇒ `edgeMove`、零改动） */
function reorderFleetConfigIn(state, id, toIndex) {
  const list = state.fleetConfigs || [];
  const from = list.findIndex((c) => c && c.id === id);
  if (from < 0) return { ok: false, reason: { code: 'unknown', id: id === undefined ? null : String(id) } };
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= list.length) {
    return { ok: false, reason: { code: 'badOrder', index: Number.isFinite(toIndex) ? toIndex : null, total: list.length } };
  }
  if (toIndex === from) return { ok: false, reason: { code: 'edgeMove', index: from, total: list.length, dir: 0 } };
  const [item] = list.splice(from, 1);
  list.splice(toIndex, 0, item);
  return { ok: true, id, from, to: toIndex };
}

/** 删除可行性（**只读判定**；与 `deleteFleetConfigIn` 同一口径 ⇒ 界面禁用原因与引擎一致） */
function deleteCheckOf(cfg) {
  if (cfg.count > 0 || cfg.out > 0) return { ok: false, reason: { code: 'notEmpty', count: cfg.count, out: cfg.out } };
  return { ok: true };
}

/** ★ **删除**：**仅** `count === 0 && out === 0`（有船（含在外）⇒ 拒删且状态零改动） */
function deleteFleetConfigIn(state, id) {
  const list = state.fleetConfigs || [];
  const idx = list.findIndex((c) => c && c.id === id);
  if (idx < 0) return { ok: false, reason: { code: 'unknown', id: id === undefined ? null : String(id) } };
  const c = list[idx];
  const chk = deleteCheckOf(c);
  if (!chk.ok) return { ok: false, reason: chk.reason };
  list.splice(idx, 1);
  return { ok: true, id, name: c.name };
}

/** ★ **出征数量登记**（M3d 预留：出征 ⇒ `out += n`、返回 ⇒ `out -= n`、损毁 ⇒ `count/out` 同步减）。
 *  本步**只登记、不做任何出征业务**；约束 `0 ≤ out ≤ count`（越界 ⇒ 拒绝且零改动）。 */
function setFleetOutIn(state, id, n) {
  const cfg = findFleetConfigIn(state, id);
  if (!cfg) return { ok: false, reason: { code: 'unknown', id: id === undefined ? null : String(id) } };
  if (!Number.isInteger(n) || n < 0 || n > cfg.count) {
    return { ok: false, reason: { code: 'badOut', n: Number.isFinite(n) ? n : null, count: cfg.count } };
  }
  cfg.out = n;
  return { ok: true, id, out: n, count: cfg.count };
}

/** ★ 逐条配置的**只读派生视图**（造价、拆解预览、槽位、单位图标入参、模块筹码、能力标记
 *  —— **渲染层直接读，界面不自算任何数值 / 不推导任何图标**）。
 *  ★ 舰队表格**只有这一处数据源**（M3b 的"配置区 / 舰队区两处各显示一遍"已合并为一张表）。 */
/** ★ 单位图标入参（**唯一口径**，列表与弹窗草稿共用）：直接喂给 `ui/unitIcon.js` 的 `unitIcon()`。
 *  与战斗屏**同一图标口径**：等级解析出的 `typeCfg.icon` 优先、缺省回落既有素材路径
 *  `ship-<typeId>-ally.svg`、加载失败降级 ▲。值全部来自配置 / 等级解析 ⇒ **界面不推导、不拼路径**。 */
function iconShipOf(def, level) {
  if (!def) return { typeId: '', side: 'ally', typeCfg: { icon: null } };
  const resolved = resolveShipAtLevel(def, level);
  return {
    typeId: String(def.id),
    side: 'ally',
    typeCfg: { icon: resolved && resolved.icon ? resolved.icon : null },
  };
}

function listFleetConfigsIn(state, opts = {}) {
  const shipOf = opts.shipDefOf || shipDefOf;
  const modOf = opts.moduleDefOf || moduleDefOf;
  const list = state.fleetConfigs || [];
  return list.map((c, idx) => {
    const def = shipOf(c.shipId);
    const resolved = def ? resolveShipAtLevel(def, c.level) : null;
    const slots = resolved && Number.isFinite(resolved.slots) ? Math.max(0, Math.floor(resolved.slots)) : 0;
    const idle = Math.max(0, c.count - c.out);
    return {
      id: c.id,
      name: c.name,
      /** ★ 排序位置（＝状态数组下标；**界面只读它**，不自己数格子） */
      order: idx,
      shipId: c.shipId,
      /** 船型名（第 3 列「单位类型」；界面走 i18n 取词条） */
      typeNameKey: def ? def.nameKey : null,
      /** ★ 单位图标入参：**直接喂给 `ui/unitIcon.js` 的 `unitIcon()`**（见 `iconShipOf`） */
      iconShip: iconShipOf(def, c.level),
      /** 兼容字段（旧口径；渲染层已改用 `iconShip`） */
      shipNameKey: def ? def.nameKey : null,
      level: c.level,
      maxLevel: def ? shipMaxLevel(def) : 0,
      slots,
      buildable: !!(def && def.buildable !== false),
      unlockOk: unlockOkOf(def, c.level).ok,
      modules: (c.modules || []).map((m) => {
        const mdef = modOf(m.moduleId);
        return {
          moduleId: m.moduleId,
          level: m.level,
          nameKey: mdef ? mdef.nameKey : null,
          category: mdef ? mdef.category || null : null,
        };
      }),
      /** ★ 第 5 列「模块图标行」：**含空槽位占位**的筹码描述（`chipsOf` 唯一构造器，与弹窗草稿同源） */
      moduleChips: chipsOf(c.modules, slots, { moduleDefOf: modOf }),
      moduleCount: (c.modules || []).length,
      count: c.count,
      out: c.out,
      idle,
      cost: costOfConfigIn(state, c, opts),
      refundPerUnit: refundWith(state, c, 1, opts),
      canBuild: canBuildIn(state, c.id, 1, opts),
      canScrap: canScrapIn(state, c.id, 1, opts),
      canDelete: deleteCheckOf(c),
      /** ★ 排序按钮的可用性（**引擎给，界面只读**）：与 `moveFleetConfigIn` 同一口径 ⇒ 禁用原因一致 */
      canMoveUp: idx > 0 ? { ok: true } : { ok: false, reason: { code: 'edgeMove', index: idx, total: list.length, dir: -1 } },
      canMoveDown: idx < list.length - 1 ? { ok: true } : { ok: false, reason: { code: 'edgeMove', index: idx, total: list.length, dir: 1 } },
      identityKey: identityKeyOf(c.shipId, c.level, c.modules),
    };
  });
}

/** ★★ **模块选择弹窗的数据源**（用户口径 A-1：分类筛选 + 独立列表 —— **UI 只渲染、只筛选，什么都不算**）。
 *  · `categories` ＝ **有序**类别 key 列表（顺序＝配置的 `CATEGORY_ORDER`；只保留"确有可装配模块"的类别）；
 *  · `modules`    ＝ 全部可装配模块（顺序＝`installableModuleIds()`：`CATEGORY_ORDER` → 注册表顺序，**确定性**），
 *    每项携带渲染层需要的**全部**字段：`moduleId / nameKey / icon / category / categoryNameKey / maxLevel`；
 *  · 分类名走 i18n 词条 `module.cat.<category>`（**与 `CATEGORY_ORDER` 同一来源**，两处共用）；
 *  · `maxLevel` 由 `moduleMaxLevel()` 给 ⇒ 弹窗里的等级下拉范围**由引擎决定**（界面不自算）。
 *  ★ 只读：不改状态、不看数量、不做造价（造价由 `previewFleetSpec` 另给）。 */
function modulePickerDataIn(state, opts = {}) {
  const modOf = opts.moduleDefOf || moduleDefOf;
  const modules = installableModuleIds().map((mid) => {
    const def = modOf(mid) || {};
    const category = typeof def.category === 'string' ? def.category : '';
    return {
      moduleId: mid,
      nameKey: def.nameKey || null,
      icon: def.icon || null,
      category,
      categoryNameKey: category ? `module.cat.${category}` : null,
      maxLevel: moduleMaxLevel(def),
    };
  });
  const categories = CATEGORY_ORDER.filter((cat) => modules.some((m) => m.category === cat));
  return { categories, modules };
}

/** ★★ **某模块在某等级的费用**（用户口径：二级弹窗要显示所选模块**当前等级**的造价；**只读配置**）。
 *  · `install` ＝ `installCost`（该等级的装配消耗）—— 走**与表格单艘造价里模块部分同一个助手**
 *    `moduleInstallCostOf()` ⇒ **同源同值**；重复模块**各算一份**；
 *  · `remove`  ＝ `removeCost`（该等级的**拆下费用**）。★ 口径说明：配置里它是"消耗"而**不是返还**
 *    （见模块配置注释"装配 / 拆下 / 升级 / 研究 费用"），且引擎目前**尚未消费**它 ⇒ 弹窗里作**参考**显示；
 *  · `upgrade` ＝ `upgradeCost`（该等级条目）—— ★ **不是累加项**：模块造价口径＝"该等级的 `installCost`"
 *    （`moduleInstallCostOf` 只取 `installCost` 的逐级值）⇒ 弹窗**不显示**它，避免误读为"装配＋升级"；
 *  · `science` ＝ `scienceCost`（研究站侧，M3e 用）；`blueprint` ＝ 蓝图**门槛**（不消耗）；
 *  · `affordable` ＝ 当前资源是否够付 `install`（界面只读：不足时仅作提示，不是禁用依据）；
 *  · **不改状态**；非法入参 ⇒ `{ok:false, reason}`（`unknownModule` / `badModuleLevel`）。 */
function moduleCostAtIn(state, moduleId, level, opts = {}) {
  const modOf = opts.moduleDefOf || moduleDefOf;
  const bpOf = opts.blueprintReqOf || moduleBlueprintReqOf;
  const def = modOf(moduleId);
  if (!def) return { ok: false, reason: { code: 'unknownModule', moduleId: String(moduleId) } };
  const maxLevel = moduleMaxLevel(def);
  const lv = Number.isInteger(level) ? level : null;
  if (lv === null || lv < 1 || lv > maxLevel) {
    return { ok: false, reason: { code: 'badModuleLevel', moduleId: String(moduleId), level: lv, maxLevel } };
  }
  const install = moduleInstallCostOf(def, lv);
  return {
    ok: true,
    moduleId: String(moduleId),
    level: lv,
    maxLevel,
    nameKey: def.nameKey || null,
    install,
    remove: costOf(perLevelValueOf(def.removeCost, lv, { empty: {} })),
    upgrade: costOf(perLevelValueOf(def.upgradeCost, lv, { empty: {} })),
    science: costOf(perLevelValueOf(def.scienceCost, lv, { empty: {} })),
    blueprint: bpOf(def, lv),
    affordable: !reasonOfIn(state, install),
  };
}

/** ★★ **模块条目编辑**（草稿级**纯函数**）：二级弹窗三个动作（确认 / 添加 / 移除）的**唯一实现**。
 *  · `op.action`：`'set'`（**替换**第 `index` 条 ＝ 确认）/ `'add'`（**追加**到末尾 ＝ 添加）/
 *    `'remove'`（**删除**第 `index` 条 ＝ 移除）；
 *  · `op.level` 必须落在 `1..moduleMaxLevel(def)`：**不默认、不夹取** ⇒ 越界即拒绝（界面不自算范围）；
 *  · `op.slots` ＝ 该船型该等级的模块槽位数（**引擎快照给**）：`add` 时 `modules.length ≥ slots` ⇒ `slotsFull`；
 *    未给（非整数）⇒ 不设上限（仅自检/脚本用，界面恒传）；
 *  · **输入数组不被改动**（返回新数组）⇒ 任何失败调用都让调用方草稿**零改动**；
 *  · 返回 `{ok:true, action, index, modules}` / `{ok:false, reason:{code}}`；
 *    `index` 语义：`set` / `remove` ⇒ 目标下标（非法 ⇒ `noTarget`）；`add` ⇒ 新条目所在下标。 */
function applyModuleSlotIn(modules, op, opts = {}) {
  const modOf = opts.moduleDefOf || moduleDefOf;
  const src = Array.isArray(modules)
    ? modules.map((m) => ({ moduleId: String(m && m.moduleId), level: m && m.level }))
    : [];
  const o = op || {};
  const action = o.action;
  if (action !== 'set' && action !== 'add' && action !== 'remove') {
    return { ok: false, reason: { code: 'badAction', action: action === undefined ? null : String(action) } };
  }
  const index = Number.isInteger(o.index) ? o.index : -1;
  if (action !== 'add' && (index < 0 || index >= src.length)) {
    return { ok: false, reason: { code: 'noTarget', action, index, total: src.length } };
  }
  if (action === 'remove') return { ok: true, action, index, modules: src.filter((_, i) => i !== index) };
  const slots = Number.isInteger(o.slots) && o.slots >= 0 ? o.slots : Infinity;
  if (action === 'add' && src.length >= slots) {
    return { ok: false, reason: { code: 'slotsFull', total: src.length, slots } };
  }
  const def = modOf(o.moduleId);
  if (!def) return { ok: false, reason: { code: 'unknownModule', moduleId: String(o.moduleId) } };
  const maxLevel = moduleMaxLevel(def);
  const level = Number.isInteger(o.level) ? o.level : null;
  if (level === null || level < 1 || level > maxLevel) {
    return { ok: false, reason: { code: 'badModuleLevel', moduleId: String(o.moduleId), level, maxLevel } };
  }
  const out = src.slice();
  if (action === 'set') {
    out[index] = { moduleId: String(o.moduleId), level };
    return { ok: true, action, index, modules: out };
  }
  out.push({ moduleId: String(o.moduleId), level });
  return { ok: true, action, index: out.length - 1, modules: out };
}

/** ★ 舰队统计（只读）：容量 / 拥有 / 在外 / 剩余 / 拆解比例 */
function fleetStatsIn(state) {
  const capacity = fleetCapacityIn(state);
  const total = fleetTotalIn(state);
  return {
    capacity,
    total,
    out: fleetOutIn(state),
    remaining: Math.max(0, capacity - total),
    scrapRefundRatio: scrapRatioIn(state),
  };
}

/* ---------- 舰队（M3b）：对**单例**的公开 API（体例同资源 API） ---------- */

/** 舰队统计（只读） */
export function fleetStats() {
  return fleetStatsIn(baseState);
}
/** 舰队总容量（只读；读船坞该等级 `effect.fleetCapacity`） */
export function fleetCapacityOf() {
  return fleetCapacityIn(baseState);
}
/** 舰队**拥有总数** Σ`count` */
export function fleetTotal() {
  return fleetTotalIn(baseState);
}
/** 舰队**在外总数** Σ`out` */
export function fleetOut() {
  return fleetOutIn(baseState);
}
/** 舰队**剩余容量** */
export function fleetRemainingCap() {
  return fleetRemainingCapIn(baseState);
}
/** 逐条配置的只读视图（UI 渲染用；含造价 / 拆解预览 / 槽位 / 能力标记） */
export function listFleetConfigs() {
  return listFleetConfigsIn(baseState);
}
/** ★ 干跑校验 + 造价预览（**不改状态**；新建 / 编辑表单据此显示槽位、造价与禁用原因） */
export function previewFleetSpec(spec) {
  return validateFleetSpecIn(baseState, spec);
}
/** ★ 新建配置（同配置合并、重名自动 `#N`） */
export function createFleetConfig(spec) {
  return createFleetConfigIn(baseState, spec);
}
/** ★ 编辑＝克隆为新配置（原条目保留） */
export function cloneFleetConfig(id, patch) {
  return cloneFleetConfigIn(baseState, id, patch);
}
/** 重命名（去重口径同上） */
export function renameFleetConfig(id, name) {
  return renameFleetConfigIn(baseState, id, name);
}
/** ★ 上移 / 下移（`delta` ∈ {−1, +1}；越界 ⇒ `edgeMove`、非法 ⇒ `badOrder`，均**零改动**） */
export function moveFleetConfig(id, delta) {
  return moveFleetConfigIn(baseState, id, delta);
}
/** ★ 拖动排序：把该配置移到**最终下标** `toIndex`（非法 / 原地下标 ⇒ 拒绝且零改动） */
export function reorderFleetConfig(id, toIndex) {
  return reorderFleetConfigIn(baseState, id, toIndex);
}
/** ★ 模块选择弹窗的数据源（分类 + 可装配模块清单；只读，界面零自算） */
export function modulePickerData() {
  return modulePickerDataIn(baseState);
}
/** ★ 某模块**某等级**的费用（二级弹窗显示用；只读配置，**与表格单艘造价里的模块部分同源**） */
export function moduleCostAt(moduleId, level) {
  return moduleCostAtIn(baseState, moduleId, level);
}
/** ★ 模块槽位编辑（确认＝`set` / 添加＝`add` / 移除＝`remove`；**纯函数**：输入数组不被改动） */
export function applyModuleSlot(modules, op) {
  return applyModuleSlotIn(modules, op);
}
/** 删除（仅 `count === 0 && out === 0`） */
export function deleteFleetConfig(id) {
  return deleteFleetConfigIn(baseState, id);
}
/** 出征数量登记（M3d 预留 / 调试用；只改 `out`，不改 `count`） */
export function setFleetOut(id, n) {
  return setFleetOutIn(baseState, id, n);
}
/** 某条配置的**单艘造价**（未知 id ⇒ `null`） */
export function buildCostOf(id) {
  const c = findFleetConfigIn(baseState, id);
  return c ? costOfConfigIn(baseState, c) : null;
}
/** 能否建造 `n` 艘（**不改状态**） */
export function canBuild(id, n = 1) {
  return canBuildIn(baseState, id, n);
}
/** ★ 建造 `n` 艘（扣资源 + `count += n`；失败 ⇒ 状态零改动） */
export function build(id, n = 1) {
  return buildIn(baseState, id, n);
}
/** 拆解 `n` 艘的**返还预览**（只读；未知 id ⇒ `null`） */
export function scrapRefundOf(id, n = 1) {
  const c = findFleetConfigIn(baseState, id);
  return c ? refundWith(baseState, c, n) : null;
}
/** ★ 拆解 `n` 艘（只拆未出征的部分；返还按船坞比例、逐资源向下取整） */
export function scrap(id, n = 1) {
  return scrapIn(baseState, id, n);
}

/* ---------- 建筑等级（只读） ---------- */

/** 某建筑的当前等级（未知建筑 ⇒ 0） */
export function buildingLevelOf(id) {
  const b = baseState.buildings[id];
  return b ? b.level : 0;
}

/** ★ `upgradeBuilding(id)` —— **M3a 只留入口**（**绝不改动状态**；升级逻辑属 M3c）
 *  @returns `{ ok:false, reason:{ code } }`，`code` ∈
 *    · `'unknown'`        未知 id（既不是建筑也不是左列表项）；
 *    · `'notBuilding'`    左列表项但**不是建筑**（★ M3a 修订后**不会出现**：左列表 ≡ 建筑注册表；
 *                        本分支保留仅为将来若重新引入"非建筑列表项"时的防御性出口）；
 *    · `'locked'`         本阶段**未开放**（`placeholder: true`，如星球）；
 *    · `'notImplemented'` 该建筑属于后续步骤（`stage` 字段给出里程碑），M3a **未实现**。 */
export function upgradeBuilding(id) {
  const def = getBaseBuilding(id);
  if (!def) {
    const item = getBaseListItem(id);
    return { ok: false, reason: { code: item ? 'notBuilding' : 'unknown' } };
  }
  if (def.placeholder === true) return { ok: false, reason: { code: 'locked', stage: def.stage } };
  return { ok: false, reason: { code: 'notImplemented', stage: def.stage } };
}

/* ---------- 只读快照（**供 UI**；UI 不自算任何数值） ---------- */

/** ★ 基地只读快照：资源（含展示顺序与**上限**）/ 建筑等级 / 左列表项 / **舰队（M3b）** / 研究容器。
 *  ★ 资源数值只从账户复制，**不做任何计算**（上限、门槛、耗时一律由各自配置决定，UI 直接读配置或 API）。 */
export function snapshot() {
  const buildings = {};
  for (const id of BASE_BUILDING_IDS) {
    const def = BASE_BUILDINGS[id];
    buildings[id] = {
      id,
      nameKey: def.nameKey,
      level: buildingLevelOf(id),
      maxLevel: def.maxLevel,
      stage: def.stage,
      placeholder: def.placeholder === true,
    };
  }
  const caps = capsOf(); // ★ 上限只算一次（配置派生，与状态无关）
  return {
    stateVersion: baseState.stateVersion,
    resources: resourcesOf(),
    /** ★ 资源**上限**（只读；来源＝配置：初始上限 ＋ 建筑 `effect.resourceCap`） */
    caps,
    /** 资源栏展示口径（**顺序来自资源注册表的 `order`**；UI 直接遍历，不自排）
     *  · `value` 当前值 / `cap` 上限 / `remaining` 还能加多少（**UI 不自算**，只用悬浮提示与满格标识） */
    resourceItems: RESOURCE_LIST.map((r) => {
      const value = Number.isFinite(baseState.resources[r.key]) ? baseState.resources[r.key] : 0;
      const cap = caps[r.key];
      return {
        key: r.key,
        nameKey: r.nameKey,
        descKey: r.descKey,
        marker: r.marker,
        colorKey: r.colorKey,
        value,
        cap,
        remaining: Math.max(0, cap - value),
        full: cap > 0 && value >= cap, // ★ 已达上限（UI 用既有 `--warn` 做轻微标识）
      };
    }),
    buildingIds: BASE_BUILDING_IDS.slice(),
    buildings,
    /** 左列表口径（＝建筑注册表；顺序＝配置 `order`）
     *  · `metaKey` ＝ **面板副标题词条键（约定 `building.<id>.meta`）** —— 每建筑一句，
     *    由**约定派生**（不写进建筑配置 ⇒ 建筑配置结构保持不变）；
     *  · `zones`    ＝ **面板分区**（仅船坞有；只描述结构：`build` 实装于 M3b、`fleet` 的出征部分属 M3c）。 */
    listItems: BASE_LIST_ITEMS.map((it) => ({
      id: it.id,
      nameKey: it.nameKey,
      metaKey: `building.${it.id}.meta`,
      kind: it.kind,
      order: it.order,
      stage: it.stage,
      zones: Array.isArray(it.zones) ? it.zones.map((z) => ({ ...z })) : null,
      placeholder: it.placeholder === true,
      level: buildingLevelOf(it.id),
      maxLevel: it.maxLevel,
    })),
    listItemIds: BASE_LIST_ITEM_IDS.slice(),
    /** ★ 舰队（M3b）：统计（容量 / 拥有 / 在外 / 剩余 / 拆解比例）＋ 逐条配置的**只读派生视图**
     *  （造价 `cost`、拆解预览 `refundPerUnit` / `refundIdle`、槽位 `slots`、能力标记
     *   `canBuild` / `canScrap` / `canDelete`）—— **UI 直接渲染，不自算任何数值**。 */
    fleet: { ...fleetStatsIn(baseState), configs: listFleetConfigsIn(baseState) },
    blueprints: { ...baseState.blueprints },
    cargoStore: baseState.cargoStore.map((c) => ({ ...c })),
    research: { slots: baseState.research.slots, active: baseState.research.active ? { ...baseState.research.active } : null },
  };
}

/** 只读清单摘要（控制台核对用；纯数据，可直接 JSON 打印） */
export function listBaseData() {
  return {
    stateVersion: BASE_CONFIG.stateVersion,
    resources: resourcesOf(),
    caps: capsOf(),
    buildings: BASE_BUILDING_IDS.map((id) => ({
      id,
      level: buildingLevelOf(id),
      maxLevel: BASE_BUILDINGS[id].maxLevel,
      stage: BASE_BUILDINGS[id].stage,
      placeholder: BASE_BUILDINGS[id].placeholder === true,
    })),
    listItems: BASE_LIST_ITEMS.map((it) => ({ id: it.id, order: it.order, kind: it.kind })),
    /** ★ 舰队摘要（M3b；只读核对用）：统计 + 每条配置的骨架（不含造价等派生视图） */
    fleet: {
      ...fleetStatsIn(baseState),
      configs: (baseState.fleetConfigs || []).map((c) => ({
        id: c.id,
        name: c.name,
        shipId: c.shipId,
        level: c.level,
        modules: (c.modules || []).map((m) => `${m.moduleId}@${m.level}`),
        count: c.count,
        out: c.out,
      })),
    },
    researchSlots: baseState.research.slots,
  };
}

/* ---------- ★ 自检 ---------- */

/** ★ **基地自检**（只读；控制台 `LS.base.selfCheck()`）
 *  ★ 全部子项都在**私有临时状态**上做（`createBaseState()`）⇒ **不触碰** `baseState` 单例。
 *  @returns {{ pass: boolean, checks: { name: string, pass: boolean, detail: string }[] }} */
export function baseSelfCheck() {
  const checks = [];
  const add = (name, problems) => {
    const list = Array.isArray(problems) ? problems.filter(Boolean) : problems ? [String(problems)] : [];
    checks.push({ name, pass: list.length === 0, detail: list.length ? head(list) : 'ok' });
  };

  // ① 资源注册表完整 + 与 baseConfig 初始额度键一致（同集合、同顺序）
  {
    const p = [];
    if (!RESOURCE_KEYS.length) p.push('资源注册表为空');
    for (const k of RESOURCE_KEYS) {
      const r = RESOURCE_LIST.find((x) => x.key === k);
      if (!r) p.push(`${k}: 未出现在 RESOURCE_LIST`);
      if (BASE_LIST_ITEM_IDS.includes(k)) p.push(`${k}: 资源键与基地列表项 id 冲突`);
    }
    const orders = RESOURCE_LIST.map((r) => r.order);
    if (new Set(orders).size !== orders.length) p.push('资源 order 不唯一');
    const keysByOrder = [...RESOURCE_LIST].sort((a, b) => a.order - b.order).map((r) => r.key);
    if (!jsonEq(RESOURCE_LIST.map((r) => r.key), keysByOrder)) p.push('RESOURCE_LIST 未按 order 升序');
    for (const r of RESOURCE_LIST) {
      if (r.nameKey !== `res.${r.key}`) p.push(`${r.key}: nameKey 体例应为 res.${r.key}（现 ${r.nameKey}）`);
      if (r.descKey !== `res.${r.key}.desc`) p.push(`${r.key}: descKey 体例应为 res.${r.key}.desc（现 ${r.descKey}）`);
      if (typeof r.marker !== 'string' || !r.marker) p.push(`${r.key}: marker 应为非空字符串`);
      if (typeof r.colorKey !== 'string' || !r.colorKey.startsWith('--')) p.push(`${r.key}: colorKey 应为 CSS 变量名（--xxx）`);
    }
    const initialKeys = Object.keys(BASE_CONFIG.initialResources || {});
    if (!jsonEq(initialKeys, RESOURCE_KEYS)) {
      p.push(`baseConfig.initialResources 的键应与资源注册表一致且同序（现 ${initialKeys.join('/')}）`);
    }
    add('① 资源注册表完整 + 与 baseConfig 初始额度键一致', p);
  }

  // ② 基地建筑注册表完整（五建筑 / 左列表＝建筑同序 order 1..N / levels.length === maxLevel / 分区与效果字段）
  {
    const p = [];
    if (BASE_BUILDING_IDS.length !== 5) p.push(`建筑应为 5 个（现 ${BASE_BUILDING_IDS.length}：${BASE_BUILDING_IDS.join('/')}）`);
    for (const id of BASE_BUILDING_IDS) {
      const def = BASE_BUILDINGS[id];
      if (!def || typeof def !== 'object') {
        p.push(`${id}: 定义缺失`);
        continue;
      }
      if (def.id !== id) p.push(`${id}: id(${def.id}) 与键名不一致`);
      if (def.kind !== 'building') p.push(`${id}: kind 应为 'building'（现 ${def.kind}）`);
      if (def.nameKey !== `building.${id}`) p.push(`${id}: nameKey 体例应为 building.${id}（现 ${def.nameKey}）`);
      if (typeof def.stage !== 'string' || !def.stage) p.push(`${id}: 缺 stage（实装里程碑，供界面显示"待实现"）`);
      const levels = def.levels;
      if (!Array.isArray(levels) || !levels.length) {
        p.push(`${id}: levels 缺失或为空`);
        continue;
      }
      if (levels.length !== def.maxLevel) p.push(`${id}: levels.length(${levels.length}) 应等于 maxLevel(${def.maxLevel})`);
      levels.forEach((e, i) => {
        if (!e || typeof e !== 'object') {
          p.push(`${id}.levels[${i}]: 不是对象`);
          return;
        }
        if (e.level !== i + 1) p.push(`${id}.levels[${i}]: level 应为 ${i + 1}（现 ${e.level}）`);
        if (!e.cost || typeof e.cost !== 'object') p.push(`${id}.levels[${i}]: 缺 cost`);
        else for (const k of Object.keys(e.cost)) if (!isResourceKey(k)) p.push(`${id}.levels[${i}].cost: 未知资源键 ${k}`);
        if (!e.effect || typeof e.effect !== 'object') p.push(`${id}.levels[${i}]: 缺 effect`);
      });
      // 占位标记：只有星球（本阶段未开放）允许 placeholder:true
      if (id === 'planet' && def.placeholder !== true) p.push('planet: 应为 placeholder:true（本阶段未开放）');
      if (id !== 'planet' && def.placeholder === true) p.push(`${id}: 不应标 placeholder`);
    }
    // ★ M3a 修订：左列表 ≡ 建筑注册表（**舰队已并入船坞** ⇒ 不再有非建筑列表项）
    const orders = BASE_LIST_ITEMS.map((it) => it.order);
    if (new Set(orders).size !== orders.length) p.push(`列表项 order 不唯一（${orders.join('/')}）`);
    if (!jsonEq(orders, orders.map((_, i) => i + 1))) p.push(`列表项 order 应为**连续 1..N** 升序（现 ${orders.join('/')}）`);
    if (!jsonEq(BASE_LIST_ITEM_IDS, BASE_BUILDING_IDS)) p.push('左列表项应与建筑注册表**一一对应且同序**');
    for (const it of BASE_LIST_ITEMS) {
      if (it.kind !== 'building') p.push(`列表项 ${it.id}: kind 应为 'building'（现 ${it.kind}）`);
    }
    // 面板分区（`zones`；只描述结构）：key / nameKey / stage 齐全、key 唯一
    for (const it of BASE_LIST_ITEMS) {
      if (it.zones === undefined) continue;
      if (!Array.isArray(it.zones) || !it.zones.length) {
        p.push(`${it.id}.zones 应为非空数组`);
        continue;
      }
      const zkeys = it.zones.map((z) => (z && z.key) || '');
      if (new Set(zkeys).size !== zkeys.length) p.push(`${it.id}.zones 的 key 不唯一（${zkeys.join('/')}）`);
      for (const z of it.zones) {
        if (!z || typeof z.key !== 'string' || !z.key) p.push(`${it.id}.zones: 缺 key`);
        if (!z || typeof z.nameKey !== 'string' || !z.nameKey) p.push(`${it.id}.zones: 缺 nameKey`);
        if (!z || typeof z.stage !== 'string' || !z.stage) p.push(`${it.id}.zones: 缺 stage`);
      }
    }
    // ★ 船坞面板必须有**两区**（「建造」+「舰队 / 出征状态」）—— 舰队并入船坞后的结构约束
    if (((BASE_BUILDINGS.shipyard && BASE_BUILDINGS.shipyard.zones) || []).length < 2) {
      p.push('船坞应至少有两个面板分区（建造 / 舰队）');
    }
    // ★ 资源上限提升字段位（星球 `effect.resourceCap`）：键必须是已注册资源键（值只要求是数，M3 恒 0）
    for (const id of BASE_BUILDING_IDS) {
      for (const e of BASE_BUILDINGS[id].levels) {
        const rc = e.effect ? e.effect.resourceCap : null;
        if (rc === undefined || rc === null) continue;
        if (typeof rc !== 'object' || Array.isArray(rc)) p.push(`${id}.levels[level ${e.level}].effect.resourceCap 应为对象`);
        else for (const k of Object.keys(rc)) if (!isResourceKey(k)) p.push(`${id}.levels[level ${e.level}].effect.resourceCap: 未知资源键 ${k}`);
      }
    }
    // 指挥中心出战上限 / 研究站研究位：字段必须在配置里登记（逐级都有）
    for (const id of BASE_BUILDING_IDS) {
      if (id !== 'commandCenter' && id !== 'researchStation') continue;
      const field = id === 'commandCenter' ? 'maxFleet' : 'researchSlots';
      for (const e of BASE_BUILDINGS[id].levels) {
        if (!Number.isInteger(e.effect[field])) p.push(`${id}.levels[level ${e.level}].effect.${field} 应为整数（效果由配置决定）`);
      }
    }
    // 其余建筑不编造未实装加成 ⇒ effect 必须为空对象（★ 例外：**已登记的字段位**，见下）
    for (const e of BASE_BUILDINGS.stargate.levels) {
      if (Object.keys(e.effect).length) p.push(`stargate.levels[level ${e.level}].effect 应为空对象（不编造未实现的加成）`);
    }
    // ★ M3b：船坞 `effect` 恰好登记**两个字段**（舰队总容量 / 拆解返还比例）—— 多一个都算"编造"
    for (const e of BASE_BUILDINGS.shipyard.levels) {
      const keys = Object.keys(e.effect).sort();
      if (!jsonEq(keys, ['fleetCapacity', 'scrapRefundRatio'])) {
        p.push(`shipyard.levels[level ${e.level}].effect 应恰好登记 fleetCapacity / scrapRefundRatio（现 ${keys.join('/') || '空'}）`);
      }
      const fc = e.effect.fleetCapacity;
      if (!(Number.isFinite(fc) && fc > 0)) p.push(`shipyard.levels[level ${e.level}].effect.fleetCapacity 应为正数（现 ${fc}）`);
      const rr = e.effect.scrapRefundRatio;
      if (!(Number.isFinite(rr) && rr > 0 && rr <= 1)) p.push(`shipyard.levels[level ${e.level}].effect.scrapRefundRatio 应落在 (0,1]（现 ${rr}）`);
    }
    add('② 建筑注册表完整（五建筑 / 左列表＝建筑同序 order 1..N / levels.length === maxLevel / 效果字段与分区结构登记）', p);
  }

  // ③ 资源校验 / 扣减 / 不足零改动（**在私有临时状态上做，不动单例**）
  {
    const p = [];
    const st = createBaseState();
    // (a) 非法 cost / gains ⇒ 拒绝且状态零改动
    const before = JSON.stringify(st);
    for (const bad of [{ gold: 1 }, { energy: -1 }, { energy: 'x' }, [], 'x']) {
      if (canAffordIn(st, bad) !== false) p.push(`非法 cost 未被判为不可支付：${JSON.stringify(bad)}`);
      if (spendIn(st, bad).ok !== false) p.push(`非法 cost 未被 spend 拒绝：${JSON.stringify(bad)}`);
    }
    if (gainIn(st, { gold: 1 }).ok !== false) p.push('非法 gains 未被 gain 拒绝');
    if (JSON.stringify(st) !== before) p.push('非法入参竟然改动了状态');
    // (b) 不足 ⇒ 失败且**状态逐字段不变**
    const huge = { energy: st.resources.energy + 1 };
    const beforeShort = JSON.stringify(st);
    const r = spendIn(st, huge);
    if (r.ok !== false) p.push('资源不足却扣减成功');
    else if (!r.reason || r.reason.resource !== 'energy') p.push(`不足原因应为 energy（现 ${r.reason && r.reason.resource}）`);
    if (JSON.stringify(st) !== beforeShort) p.push('资源不足时状态发生了变化（应逐字段不变）');
    // (c) 恰好够 ⇒ 成功且逐键精确扣减；只读快照与账户解耦
    const seed = { energy: 10, alloy: 3 };
    const st2 = createBaseState();
    for (const k of RESOURCE_KEYS) st2.resources[k] = seed[k] || 0;
    const ok = spendIn(st2, seed);
    if (ok.ok !== true) p.push('恰好够的消耗被拒绝');
    else if (!RESOURCE_KEYS.every((k) => st2.resources[k] === 0)) p.push('扣减后账户未精确归零');
    // (d) gain 精确相加；快照是副本
    const st3 = createBaseState();
    for (const k of RESOURCE_KEYS) st3.resources[k] = 0;
    gainIn(st3, { ore: 7, rare: 2 });
    if (st3.resources.ore !== 7 || st3.resources.rare !== 2) p.push('gain 未逐键精确相加');
    const snap = { ...st3.resources };
    snap.energy = 999;
    if (st3.resources.energy === 999) p.push('只读快照未与账户解耦');
    // (e) 空消耗 / null 视为零
    const st4 = createBaseState();
    const z = JSON.stringify(st4);
    if (!spendIn(st4, null).ok || !spendIn(st4, {}).ok) p.push('空消耗（null / {}）应视为零消耗且成功');
    if (JSON.stringify(st4) !== z) p.push('零消耗竟然改动了状态');
    add('③ 资源校验 / 扣减 / 不足零改动（含非法入参拒绝）', p);
  }

  // ④ 建筑等级初始化正确（初始等级读 baseConfig 并夹到配置区间内）
  {
    const p = [];
    const st = createBaseState();
    for (const id of BASE_BUILDING_IDS) {
      const def = BASE_BUILDINGS[id];
      const want = clampBuildingLevel(def, BASE_CONFIG.initialBuildingLevel);
      if (!st.buildings[id]) p.push(`${id}: 未初始化`);
      else if (st.buildings[id].level !== want) p.push(`${id}: 初始等级应为 ${want}（现 ${st.buildings[id].level}）`);
      if (want < def.levels[0].level || want > def.levels[def.levels.length - 1].level) p.push(`${id}: 初始等级越出配置区间`);
    }
    // 研究位：读研究站配置效果（不写死研究位数）
    const slotsWant = buildingEffectOf('researchStation', st.buildings.researchStation.level).researchSlots;
    if (st.research.slots !== slotsWant) p.push(`research.slots 应为研究站配置效果值 ${slotsWant}（现 ${st.research.slots}）`);
    // 重置 / 创建互不影响（两个独立实例）
    const a = createBaseState();
    gainIn(a, { energy: 1 });
    const b = createBaseState();
    if (b.resources.energy === a.resources.energy) p.push('createBaseState 的实例未相互独立');
    add('④ 建筑等级与容器初始化正确（等级/研究位均读配置）', p);
  }

  // ⑤ 数值零硬编码（**行为断言**：一切阈值精确等于配置值 ⇒ 引擎里没有第二份常量）
  //    · 以"配置给出的 cost 恰好可支付"证明门槛＝配置值；
  //    · 以"配置值 − 1 恰好不可支付、且缺口正好是该项"证明没有隐藏的加成 / 取整 / 偏移。
  {
    const p = [];
    let cases = 0;
    for (const id of BASE_BUILDING_IDS) {
      const def = BASE_BUILDINGS[id];
      for (const e of def.levels) {
        const cost = e.cost || {};
        cases += 1;
        const st = createBaseState();
        for (const k of RESOURCE_KEYS) st.resources[k] = cost[k] || 0;
        if (!canAffordIn(st, cost)) p.push(`${id} Lv${e.level}: 按配置额度本应可支付，却被判为不足（阈值与配置不一致）`);
        const paid = spendIn(st, cost);
        if (!paid.ok) p.push(`${id} Lv${e.level}: 按配置额度扣减失败`);
        else if (!RESOURCE_KEYS.every((k) => st.resources[k] === 0)) p.push(`${id} Lv${e.level}: 扣减额与配置不一致（残留 ${JSON.stringify(st.resources)}）`);
        for (const k of Object.keys(cost)) {
          if (!(cost[k] > 0)) continue;
          const st2 = createBaseState();
          for (const kk of RESOURCE_KEYS) st2.resources[kk] = cost[kk] || 0;
          st2.resources[k] = cost[k] - 1; // 配置值 − 1 的边界
          const r2 = spendIn(st2, cost);
          if (r2.ok !== false) p.push(`${id} Lv${e.level}: ${k} 差 1 仍被判为可支付（存在隐藏补贴）`);
          else if (!r2.reason || r2.reason.resource !== k) p.push(`${id} Lv${e.level}: 缺口应为 ${k}（现 ${r2.reason && r2.reason.resource}）`);
          else if (r2.reason.need !== cost[k] || r2.reason.have !== cost[k] - 1) p.push(`${id} Lv${e.level}: 缺口量值与配置不符`);
        }
      }
    }
    if (!cases) p.push('未取到任何建筑等级消耗（配置缺失）');
    add('⑤ 数值零硬编码（阈值精确等于配置值 ± 1 边界遍历断言）', p);
  }

  // ⑥ i18n 词条成对（资源名称/用途 + 建筑名称 + **建筑面板副标题** + 船坞分区；每个语言字典都要有）
  {
    const p = [];
    const need = [];
    for (const r of RESOURCE_LIST) need.push(r.nameKey, r.descKey);
    for (const id of BASE_BUILDING_IDS) need.push(BASE_BUILDINGS[id].nameKey);
    // ★ 面板副标题（约定 `building.<id>.meta`）：**每个建筑一句** —— 修"M3a 首版所有面板同一句"
    for (const id of BASE_BUILDING_IDS) need.push(`building.${id}.meta`);
    // ★ 船坞分区词条 + 可选分区说明词条（分区写在 `data/baseBuildings/shipyard.js` 的 `zones`）
    for (const it of BASE_LIST_ITEMS) {
      for (const z of it.zones || []) {
        need.push(z.nameKey);
        if (z.noteKey) need.push(z.noteKey);
      }
    }
    for (const key of need) {
      if (!key) {
        p.push('存在空词条 key');
        continue;
      }
      for (const loc of i18n.locales) if (!i18n.has(key, loc)) p.push(`缺词条 ${key}@${loc}`);
    }
    // ★ M3b：引擎的**失败原因码**必须有成对词条 `base.reason.<code>`（界面据此显示"按钮为什么灰着"）
    for (const code of FLEET_REASON_CODES) {
      for (const loc of i18n.locales) if (!i18n.has(`base.reason.${code}`, loc)) p.push(`缺词条 base.reason.${code}@${loc}`);
    }
    // ★ 副标题**必须互不相同**（防"所有面板同一句"复发；按**当前语言**逐个取值比对）
    const metas = BASE_BUILDING_IDS.map((id) => i18n.t(`building.${id}.meta`));
    if (new Set(metas).size !== metas.length) p.push(`建筑面板副标题重复（应每个建筑一句）：${head(metas)}`);
    add('⑥ i18n 词条成对（res.* / building.* / building.*.meta / 船坞分区 / base.reason.*）+ 副标题互不相同', p);
  }

  // ⑦ 资源上限：gain **按上限截断**（绝不超上限 / 恰好到顶 / 溢出量可读 / 五资源逐一）
  {
    const p = [];
    const caps = capsOf();
    const st = createBaseState();
    const capEnergy = caps.energy;
    if (!(capEnergy > 0)) p.push(`初始上限应为正数（energy=${capEnergy}）`);
    // (a) 超上限请求 ⇒ 截断到上限、绝不超出、溢出量 = 请求量 − 入账量
    const before = st.resources.energy;
    const over = capEnergy + 999 - before;
    const r1 = gainIn(st, { energy: capEnergy + 999 });
    if (r1.ok !== true) p.push('合法 gain 被拒绝');
    if (st.resources.energy !== capEnergy) p.push(`超上限入账后应恰好 ＝ 上限（现 ${st.resources.energy} / ${capEnergy}）`);
    if (r1.gained.energy !== capEnergy - before) p.push(`入账量应为剩余容量（期望 ${capEnergy - before}，现 ${r1.gained.energy}）`);
    if (r1.overflow.energy !== over) p.push(`溢出量应为请求量 − 入账量（期望 ${over}，现 ${r1.overflow.energy}）`);
    // (b) 已满再 gain ⇒ 一分不给、全量溢出（**上界不会被突破**）
    const r2 = gainIn(st, { energy: 5 });
    if (st.resources.energy !== capEnergy) p.push('满上限后 gain 竟然超过了上限');
    if (Object.keys(r2.gained).length !== 0) p.push(`满上限后不应有任何入账（现 ${JSON.stringify(r2.gained)}）`);
    if (r2.overflow.energy !== 5) p.push(`满上限后溢出量应为全额（现 ${r2.overflow.energy}）`);
    // (c) 恰好到顶 ⇒ 全额入账且**无溢出**
    const st2 = createBaseState();
    const need = capEnergy - st2.resources.energy;
    const r3 = gainIn(st2, { energy: need });
    if (r3.ok !== true || r3.gained.energy !== need) p.push('恰好到上限时应全额入账');
    if (Object.keys(r3.overflow).length) p.push(`恰好到上限时不应有溢出（现 ${JSON.stringify(r3.overflow)}）`);
    if (st2.resources.energy !== capEnergy) p.push('恰好到上限后应精确等于上限');
    // (d) 五种资源逐一：填到上限、溢出恒为多出的固定量 10
    const st3 = createBaseState();
    for (const k of RESOURCE_KEYS) {
      const room = Math.max(0, caps[k] - st3.resources[k]);
      const r4 = gainIn(st3, { [k]: room + 10 });
      if (st3.resources[k] !== caps[k]) p.push(`${k}: 截断后未落在上限（现 ${st3.resources[k]} / ${caps[k]}）`);
      if (r4.overflow[k] !== 10) p.push(`${k}: 溢出量应为 10（现 ${r4.overflow[k]}）`);
    }
    add('⑦ 资源上限：gain 按上限截断（不超上限 / 恰好到顶 / 溢出量可读 / 五资源逐一）', p);
  }

  // ⑧ 上限**来源＝配置**（改配置即变 / 逐级回退 / 非法值回落 0）+ 只读口径自洽
  {
    const p = [];
    // (a) 上限 ≡ 初始上限 ＋ Σ各建筑该等级 effect.resourceCap（**在自检里按配置独立算一遍比对**）
    const caps = capsOf();
    const expect = {};
    for (const k of RESOURCE_KEYS) expect[k] = capValue(BASE_CONFIG.initialResourceCaps ? BASE_CONFIG.initialResourceCaps[k] : 0);
    for (const id of BASE_BUILDING_IDS) {
      const lv = buildingLevelOf(id); // 单例等级（**只读**；不改状态）
      let entry = null;
      for (const e of BASE_BUILDINGS[id].levels) if (e.level <= lv) entry = e;
      const bonus = entry && entry.effect ? entry.effect.resourceCap : null;
      if (bonus && typeof bonus === 'object') for (const k of RESOURCE_KEYS) expect[k] += capValue(bonus[k]);
    }
    if (!jsonEq(caps, expect)) p.push(`上限 ≠ 初始上限 + Σ建筑 effect.resourceCap（现 ${JSON.stringify(caps)}）`);
    // (b) **注入篡改过的配置副本** ⇒ 上限随之改变（证明代码里没有第二份上限常量）
    const fake = capsFromConfig(
      { energy: 12345 },
      { fake: { levels: [{ level: 1, effect: { resourceCap: { energy: 7 } } }] } },
      { fake: 1 }
    );
    if (fake.energy !== 12345 + 7) p.push(`上限应随配置变（期望 12352，现 ${fake.energy}）`);
    // (c) 等级逐级回退：等级 2 生效 level 1 的项、等级 3 才生效 level 3 的项
    const ladder = { f: { levels: [{ level: 1, effect: { resourceCap: { energy: 5 } } }, { level: 3, effect: { resourceCap: { energy: 9 } } }] } };
    if (capsFromConfig({}, ladder, { f: 2 }).energy !== 5) p.push('上限未按等级逐级回退（Lv2 应取 Lv1 的项）');
    if (capsFromConfig({}, ladder, { f: 3 }).energy !== 9) p.push('上限未按等级取到 Lv3 的项');
    if (capsFromConfig({}, ladder, {}).energy !== 0) p.push('未达该等级时不应生效（等级 0 应取不到任何项）');
    // (d) 非法上限 ⇒ **回落 0**（负 / 非数 / 字符串 / null / undefined / 缺键），且建筑侧非法增量同样按 0
    const bad = capsFromConfig({ energy: -1, ore: 'x', alloy: NaN, rare: null, science: undefined }, {}, {});
    for (const k of RESOURCE_KEYS) if (bad[k] !== 0) p.push(`${k}: 非法上限未回落为 0（现 ${bad[k]}）`);
    const badBonus = capsFromConfig({}, { b: { levels: [{ level: 1, effect: { resourceCap: { energy: -5, ore: 'x' } } }] } }, { b: 1 });
    if (badBonus.energy !== 0 || badBonus.ore !== 0) p.push('建筑侧非法上限增量未按 0 计');
    // (e) 只读口径自洽：remainingCapOf 与 capsOf / 账户一致；未知资源键 ⇒ 0
    const room = remainingCapOf('energy');
    const want = Math.max(0, caps.energy - baseState.resources.energy);
    if (room !== want) p.push(`remainingCapOf('energy') 应等于 上限 − 当前值（期望 ${want}，现 ${room}）`);
    if (remainingCapOf('nope') !== 0) p.push('未知资源键的剩余容量应为 0');
    const snap = snapshot();
    for (const it of snap.resourceItems) {
      if (it.cap !== snap.caps[it.key]) p.push(`快照 ${it.key}: cap 与 caps 不一致`);
      if (it.remaining !== Math.max(0, it.cap - it.value)) p.push(`快照 ${it.key}: remaining 口径不一致`);
      if (it.full !== (it.cap > 0 && it.value >= it.cap)) p.push(`快照 ${it.key}: full 口径不一致`);
    }
    add('⑧ 上限来源＝配置（改配置即变 / 逐级回退 / 非法值回落 0）+ 只读口径自洽', p);
  }

  // ⑨ 舰队配置：槽位唯一口径 / 创建 / 同配置合并 / 命名去重（#N）/ 非法入参（失败零改动）
  {
    const p = [];
    // (a) 槽位口径：唯一来源＝既有 `resolveShipAtLevel(...).slots`（与战斗侧同口径）；
    //     `slotGrowth` 只校验**形状**，并核对"每级槽位 ≥ Lv1 基础槽位"（成长单调不减）
    for (const id of SHIP_IDS) {
      const def = SHIPS[id];
      const baseSlots = Number.isFinite(def.slots) ? def.slots : 0;
      const g = def.slotGrowth;
      if (g !== undefined) {
        const okShape =
          g && Number.isInteger(g.every) && g.every >= 1 &&
          Number.isFinite(g.add) && g.add >= 0 && Number.isFinite(g.max) && g.max >= 0;
        if (!okShape) p.push(`${id}: slotGrowth 形状非法（应 { every: 整数≥1, add: 数≥0, max: 数≥0 }）`);
      }
      for (const lv of shipLevels(def)) {
        const resolved = resolveShipAtLevel(def, lv) || {};
        const slots = shipSlotsOf(def, lv);
        // 缺省 `slots` ⇒ 该口径下即 0（不视为不一致）
        const expect = Number.isFinite(resolved.slots) ? Math.max(0, Math.floor(resolved.slots)) : 0;
        if (slots !== expect) p.push(`${id} Lv${lv}: 槽位数与 resolveShipAtLevel 口径不一致`);
        if (slots < baseSlots) p.push(`${id} Lv${lv}: 槽位 ${slots} 低于 Lv1 基础槽位 ${baseSlots}（成长应单调不减）`);
      }
    }
    // (b) 创建 / 同配置合并 / 命名去重 / 克隆链
    const st = createBaseState();
    const r1 = createFleetConfigIn(st, { name: 'A', shipId: 'combat', level: 1, modules: [] });
    if (!r1.ok || st.fleetConfigs.length !== 1) p.push('正常配置未被创建');
    if (r1.ok && r1.name !== 'A') p.push(`首次命名应原样为 A（现 ${r1.name}）`);
    // ★ 同名同配置 ⇒ 合并（**名称零变化**）：改名口径见下方 (b2)
    const r2 = createFleetConfigIn(st, { name: 'A', shipId: 'combat', level: 1, modules: [] });
    if (!r2.ok || !r2.merged) p.push('同 shipId+level+modules 应**合并**（merged:true）');
    if (st.fleetConfigs.length !== 1) p.push(`合并后条目数应为 1（现 ${st.fleetConfigs.length}）`);
    if (r2.ok && r1.ok && r2.id !== r1.id) p.push('合并应返回同一条目的 id');
    if (r2.ok && r2.nameChanged) p.push('同名合并不应算作"改名"');
    // (b2) ★ M3b 迭代 2（B-2）：**合并时以草稿的显式新名为准**；留空 ⇒ 保留既有名
    const stN = createBaseState();
    const n1 = createFleetConfigIn(stN, { name: 'M1', shipId: 'combat', level: 1, modules: [] });
    const n2 = createFleetConfigIn(stN, { name: 'M2', shipId: 'combat', level: 1, modules: [] });
    if (!n2.ok || !n2.merged || n2.id !== n1.id) p.push('改名合并应命中同一条目（同 shipId+level+modules）');
    else if (n2.name !== 'M2' || !n2.nameChanged) p.push(`合并时应以**新名**为准（现 ${n2.name}）`);
    if (n1.ok && findFleetConfigIn(stN, n1.id).name !== 'M2') p.push('合并后既有条目名应更新为新名');
    if (stN.fleetConfigs.length !== 1) p.push('改名合并不应产生新条目');
    const n3 = createFleetConfigIn(stN, { name: '', shipId: 'combat', level: 1, modules: [] });
    if (!n3.ok || !n3.merged) p.push('留空名 + 同配置应仍合并');
    else if (n3.name !== 'M2') p.push(`留空名合并应**保留既有名**（现 ${n3.name}）`);
    if (n3.ok && n3.nameChanged) p.push('留空名合并不应改动名称');
    // 改名去重：草稿名已被**别人**占用 ⇒ 走既有 `#N`
    createFleetConfigIn(stN, { name: 'M3', shipId: 'combat', level: 2, modules: [] });
    const n4 = createFleetConfigIn(stN, { name: 'M3', shipId: 'combat', level: 1, modules: [] });
    if (!n4.ok || n4.name !== 'M3#2') p.push(`改名合并遇重名应得 M3#2（现 ${n4.ok ? n4.name : 'failed'}）`);
    if (n1.ok && findFleetConfigIn(stN, n1.id).name !== 'M3#2') p.push('去重后的新名应落到既有条目上');
    const r3 = createFleetConfigIn(st, { name: 'A', shipId: 'combat', level: 2, modules: [] });
    if (!r3.ok) p.push(`不同配置（等级不同）应可创建（现 ${r3.ok ? '' : r3.reason.code}）`);
    if (r3.ok && r3.name !== 'A#2') p.push(`重名应自动追加 #2（现 ${r3.name}）`);
    const r4 = r3.ok ? cloneFleetConfigIn(st, r3.id, {}) : { ok: false };
    // ★ 编辑＝克隆的**落点口径**（与 ⑭ 的"完全相同 ⇒ 合并回原条目"同一口径）：
    //   草稿与原条目逐字段相同 ⇒ 合并回原条目（不产生新条目），名字沿用其现有名（A#2）。
    if (!r4.ok) p.push('克隆 A#2 失败');
    else if (!r4.merged || r4.id !== r3.id) p.push('克隆出完全相同的配置应**合并回原条目**（与 ⑭ 同口径）');
    else if (r4.name !== 'A#2') p.push(`合并回原条目应保留其现有名 A#2（现 ${r4.name}）`);
    if (r4.ok) {
      // 重命名：空闲名**原样保留**；已占用 ⇒ **去掉末尾 #N 再编号**
      const rnFree = renameFleetConfigIn(st, r1.id, 'B');
      if (!rnFree.ok || rnFree.name !== 'B') p.push(`重命名为空闲名 B 应原样保留（现 ${rnFree.ok ? rnFree.name : 'failed'}）`);
      // `r4.id === r3.id`（合并回原条目）⇒ 这里改的是**另一条**（r1）
      const rnBusy = renameFleetConfigIn(st, r4.id, 'B');
      if (!rnBusy.ok || rnBusy.name !== 'B#2') p.push(`重命名为已占用的 B 应得 B#2（现 ${rnBusy.ok ? rnBusy.name : 'failed'}）`);
      // ★ "去尾 #N"：`B#2` 已被占 ⇒ 应得 `B#3`（而不是 `B#2#2`，克隆链不越滚越长）
      const r5 = createFleetConfigIn(st, { name: 'C', shipId: 'combat', level: 3, modules: [] });
      const rnChain = r5.ok ? renameFleetConfigIn(st, r5.id, 'B#2') : { ok: false };
      if (!rnChain.ok || rnChain.name !== 'B#3') p.push(`重命名为已占用的 B#2 应得 B#3（现 ${rnChain.ok ? rnChain.name : 'failed'}）`);
      if (renameFleetConfigIn(st, r4.id, '').reason.code !== 'badName') p.push('空名重命名应返回 badName');
      if (renameFleetConfigIn(st, 'noSuchId', 'x').reason.code !== 'unknown') p.push('重命名未知 id 应返回 unknown');
    }
    // (c) 非法入参（全部失败且**状态零改动**）
    const mods = installableModuleIds();
    const slots1 = shipSlotsOf('combat', 1);
    const tooMany = mods.slice(0, slots1 + 1).map((mid) => ({ moduleId: mid, level: 1 }));
    const badCases = [
      ['badSpec', null],
      ['unknownShip', { shipId: 'noSuchShip', level: 1 }],
      ['notBuildable', { shipId: 'drone', level: 1, modules: [] }],
      ['badLevel', { shipId: 'combat', level: shipMaxLevel('combat') + 1, modules: [] }],
      ['badLevel', { shipId: 'combat', level: 0, modules: [] }],
      ['unknownModule', { shipId: 'combat', level: 1, modules: [{ moduleId: 'noSuchModule' }] }],
    ];
    if (mods.length > slots1) badCases.push(['slotOverflow', { shipId: 'combat', level: 1, modules: tooMany }]);
    else p.push('可装配模块数量不足以构造"超槽位"用例');
    const unpickable = Object.keys(MODULES).find((mid) => MODULES[mid].picker === false);
    if (unpickable) badCases.push(['moduleNotPickable', { shipId: 'combat', level: 1, modules: [{ moduleId: unpickable, level: 1 }] }]);
    else p.push('未找到 picker:false 的模块（无法核对"内部模块不可装配"）');
    const before = JSON.stringify(st);
    const countBefore = st.fleetConfigs.length;
    for (const [code, spec] of badCases) {
      const r = createFleetConfigIn(st, spec);
      if (r.ok) p.push(`非法配置竟然创建成功（应 ${code}）：${JSON.stringify(spec)}`);
      else if (r.reason.code !== code) p.push(`非法配置的失败原因应为 ${code}（现 ${r.reason.code}）`);
    }
    if (JSON.stringify(st) !== before) p.push('非法配置被拒时状态被改动');
    if (st.fleetConfigs.length !== countBefore) p.push('非法配置被拒时条目数发生变化');
    add('⑨ 舰队配置：槽位唯一口径 / 创建 / 同配置合并 / 命名去重（#N）/ 非法入参零改动', p);
  }

  // ⑩ 删除限制（`count > 0` 或 `out > 0` ⇒ 拒删且零改动；空条目可删）+ 在外登记越界拒绝
  {
    const p = [];
    const st = createBaseState();
    const r = createFleetConfigIn(st, { name: 'D', shipId: 'combat', level: 1, modules: [] });
    const id = r.ok ? r.id : '';
    if (!r.ok) p.push('测试用配置创建失败');
    const del1 = deleteFleetConfigIn(st, id);
    if (!del1.ok) p.push(`空配置（count=0 / out=0）应可删除（现 ${del1.ok ? '' : del1.reason.code}）`);
    if (st.fleetConfigs.length !== 0) p.push('删除后条目数应为 0');
    const delUnknown = deleteFleetConfigIn(st, 'noSuchId');
    if (delUnknown.ok || delUnknown.reason.code !== 'unknown') p.push('删除未知 id 应返回 unknown');
    // count > 0 ⇒ 拒删
    const st2 = createBaseState();
    const r2 = createFleetConfigIn(st2, { name: 'D', shipId: 'combat', level: 1, modules: [] });
    const id2 = r2.ok ? r2.id : '';
    const one = costOfConfigIn(st2, findFleetConfigIn(st2, id2), {});
    for (const k of RESOURCE_KEYS) st2.resources[k] = Math.max(st2.resources[k], (one[k] || 0) * 2);
    if (!buildIn(st2, id2, 1).ok) p.push('建造 1 艘失败（资源已按配置造价补足）');
    const snap1 = JSON.stringify(st2);
    const d1 = deleteFleetConfigIn(st2, id2);
    if (d1.ok || d1.reason.code !== 'notEmpty') p.push(`count>0 时应拒删（现 ${d1.ok ? 'ok' : d1.reason.code}）`);
    if (JSON.stringify(st2) !== snap1) p.push('count>0 拒删时状态被改动');
    // out > 0 ⇒ 拒删
    const so = setFleetOutIn(st2, id2, 1);
    if (!so.ok) p.push(`登记在外数量失败（现 ${so.ok ? '' : so.reason.code}）`);
    const snap2 = JSON.stringify(st2);
    const d2 = deleteFleetConfigIn(st2, id2);
    if (d2.ok || d2.reason.code !== 'notEmpty') p.push(`out>0 时应拒删（现 ${d2.ok ? 'ok' : d2.reason.code}）`);
    if (d2.ok === false && (d2.reason.count !== 1 || d2.reason.out !== 1)) p.push('拒删原因应带 count / out 供界面显示');
    if (JSON.stringify(st2) !== snap2) p.push('out>0 拒删时状态被改动');
    // 越界 out ⇒ 拒绝且零改动
    const snap3 = JSON.stringify(st2);
    if (setFleetOutIn(st2, id2, 5).ok) p.push('out 超出 count 应被拒绝');
    const badOut = setFleetOutIn(st2, id2, -1);
    if (badOut.ok || badOut.reason.code !== 'badOut') p.push('out 为负应返回 badOut');
    if (JSON.stringify(st2) !== snap3) p.push('非法 out 竟然改动了状态');
    if (fleetOutIn(st2) !== 1) p.push(`在外总数应为 1（现 ${fleetOutIn(st2)}）`);
    if (fleetTotalIn(st2) !== 1) p.push(`拥有总数应为 1（现 ${fleetTotalIn(st2)}）`);
    add('⑩ 删除限制（count>0 / out>0 拒删且零改动）+ 在外登记越界拒绝', p);
  }

  // ⑪ LvN 造价累计（`buildCost + ΣupgradeCost[2..N]`，逐级读配置）+ 行为边界（差 1 不可支付）
  {
    const p = [];
    // (a) 注入"篡改过的船型定义" ⇒ 逐级精确对拍（证明是**逐级累加**，不是取某一项 / 加常量）
    const fake = {
      id: 'fake', nameKey: 'ship.fake', buildable: true, slots: 3, maxLevel: 6,
      buildCost: { energy: 10, ore: 1 },
      upgradeCost: [{ level: 2, cost: { energy: 5 } }, { level: 3, cost: { ore: 2 } }, { level: 5, cost: { rare: 7 } }],
    };
    if (!jsonEq(shipBuildCostAtLevel(fake, 1), { energy: 10, ore: 1 })) p.push('Lv1 造价应只有 buildCost');
    if (!jsonEq(shipBuildCostAtLevel(fake, 2), { energy: 15, ore: 1 })) p.push('Lv2 造价应＝buildCost + upgradeCost[2]');
    if (!jsonEq(shipBuildCostAtLevel(fake, 3), { energy: 15, ore: 3 })) p.push('Lv3 造价应再累加 upgradeCost[3]');
    if (!jsonEq(shipBuildCostAtLevel(fake, 4), { energy: 15, ore: 3 })) p.push('Lv4 无条目应沿用 Lv3');
    if (!jsonEq(shipBuildCostAtLevel(fake, 6), { energy: 15, ore: 3, rare: 7 })) p.push('Lv6 应累加 upgradeCost[5]');
    const lv1Entry = { id: 'f2', buildCost: { energy: 1 }, upgradeCost: [{ level: 1, cost: { energy: 99 } }, { level: 2, cost: { ore: 4 } }] };
    if (shipBuildCostAtLevel(lv1Entry, 2).energy !== 1) p.push('level ≤ 1 的条目不应作为"升级"累加（否则建造基准被重复计）');
    if (shipBuildCostAtLevel(lv1Entry, 2).ore !== 4) p.push('level 2 的条目应照常累加');
    // (b) 真配置：Lv1 造价 ≡ 配置 buildCost；键必须是已注册资源键；unlockByLevel 字段位必须在位
    for (const id of SHIP_IDS) {
      const def = SHIPS[id];
      if (!jsonEq(shipBuildCostAtLevel(def, 1), costOf(def.buildCost))) p.push(`${id}: Lv1 造价应与配置 buildCost 一致`);
      for (const k of Object.keys(costOf(def.buildCost))) if (!isResourceKey(k)) p.push(`${id}.buildCost: 未知资源键 ${k}`);
      const table = Array.isArray(def.upgradeCost) ? def.upgradeCost : [];
      for (const e of table) {
        const c = e && e.cost ? e.cost : {};
        for (const k of Object.keys(c)) if (!isResourceKey(k)) p.push(`${id}.upgradeCost[level ${e && e.level}]: 未知资源键 ${k}`);
      }
      if (!Array.isArray(def.unlockByLevel)) p.push(`${id}: 缺 unlockByLevel 字段位（应为数组；空数组＝无条件）`);
      // 可建造船型必须有升级消耗表（`upgradeCost` 为空数组的只有**不可建造**的召唤模板）
      if (def.buildable !== false && (!Array.isArray(table) || !table.length)) {
        p.push(`${id}: 可建造船型的 upgradeCost 应为逐级条目数组`);
      }
    }
    // (c) 行为边界：按配置造价恰好可支付；任一资源差 1 ⇒ notAffordable 且指向该资源
    const st = createBaseState();
    const cr = createFleetConfigIn(st, { name: 'C', shipId: 'combat', level: 1, modules: [] });
    const cid = cr.ok ? cr.id : '';
    for (const k of RESOURCE_KEYS) st.resources[k] = 0;
    for (const k of Object.keys(fake.buildCost)) st.resources[k] = fake.buildCost[k]; // 恰好＝造价
    const okPaid = canBuildIn(st, cid, 1, { shipDefOf: () => fake });
    if (!okPaid.ok) p.push(`按（注入的）配置造价恰好可支付时应允许建造（现 ${okPaid.ok ? '' : okPaid.reason.code}）`);
    else if (!jsonEq(okPaid.cost, fake.buildCost)) p.push('建造扣减量应精确等于配置造价');
    for (const k of Object.keys(fake.buildCost)) {
      const st2 = createBaseState();
      const cr2 = createFleetConfigIn(st2, { name: 'C', shipId: 'combat', level: 1, modules: [] });
      for (const kk of RESOURCE_KEYS) st2.resources[kk] = 0;
      st2.resources[k] = fake.buildCost[k] - 1;
      const r2 = canBuildIn(st2, cr2.ok ? cr2.id : '', 1, { shipDefOf: () => fake });
      if (r2.ok) p.push(`差 1 个 ${k} 仍被判为可建造（存在隐藏补贴 / 取整）`);
      else if (r2.reason.code !== 'notAffordable' || r2.reason.resource !== k) {
        p.push(`差 1 个 ${k} 时原因应为 notAffordable / ${k}（现 ${r2.reason.code} / ${r2.reason.resource}）`);
      } else if (r2.reason.need !== fake.buildCost[k] || r2.reason.have !== fake.buildCost[k] - 1) {
        p.push(`差 1 个 ${k} 时缺口量值应与配置一致`);
      }
    }
    // (d) 解锁口径：空数组 / 缺省 ⇒ 通过；非空 ⇒ 保守拒绝（条件尚未实装）
    if (!unlockOkOf({ id: 'x', unlockByLevel: [] }, 1).ok) p.push('unlockByLevel 为空数组时应无条件通过');
    if (!unlockOkOf({ id: 'x' }, 1).ok) p.push('unlockByLevel 缺省时应无条件通过');
    const noUnlock = unlockOkOf({ id: 'x', unlockByLevel: [{ level: 5, note: '占位条件' }] }, 5);
    if (noUnlock.ok || noUnlock.reason.code !== 'unlockNotImplemented') p.push('unlockByLevel 非空时应保守拒绝（unlockNotImplemented）');
    const stNoUnlock = createBaseState();
    const ru = createFleetConfigIn(stNoUnlock, { name: 'U', shipId: 'combat', level: 1, modules: [] }, { shipDefOf: () => ({ ...fake, unlockByLevel: [{ level: 1 }] }) });
    if (ru.ok || ru.reason.code !== 'unlockNotImplemented') p.push('带未实装解锁条件的船型应不可建造');
    add('⑪ 造价累计（buildCost + ΣupgradeCost，逐级读配置）+ 差 1 边界 / 解锁口径', p);
  }

  // ⑫ 建造：扣资源精确 / count 增加 / 舰队容量拦截（恰好到容量；超 1 艘拒且零改动）
  {
    const p = [];
    const st = createBaseState();
    const cap = fleetCapacityIn(st);
    if (!(cap > 0)) p.push(`船坞 Lv${stateLevelOf(st, 'shipyard')} 的 fleetCapacity 应为正数（现 ${cap}）`);
    if (cap !== buildingEffectOf('shipyard', stateLevelOf(st, 'shipyard')).fleetCapacity) p.push('舰队容量应直接读船坞配置 effect.fleetCapacity');
    const r = createFleetConfigIn(st, { name: 'B', shipId: 'combat', level: 1, modules: [] });
    const id = r.ok ? r.id : '';
    const one = costOfConfigIn(st, findFleetConfigIn(st, id), {});
    // 资源给足：配置资源上限 + 单艘造价 ×（容量×2 + 2），并与上限口径解耦（直接赋值）
    for (const k of RESOURCE_KEYS) st.resources[k] = (capsOf()[k] || 0) + (one[k] || 0) * (cap * 2 + 2);
    const beforeRes = { ...st.resources };
    for (let i = 0; i < cap; i += 1) {
      const b = buildIn(st, id, 1);
      if (!b.ok) {
        p.push(`第 ${i + 1} 艘建造失败（现 ${b.reason.code}）`);
        break;
      }
    }
    const cfg = findFleetConfigIn(st, id);
    if (!cfg || cfg.count !== cap) p.push(`应恰好建成容量上限 ${cap} 艘（现 ${cfg ? cfg.count : 'n/a'}）`);
    if (fleetTotalIn(st) !== cap) p.push(`拥有总数应为 ${cap}（现 ${fleetTotalIn(st)}）`);
    if (fleetRemainingCapIn(st) !== 0) p.push(`剩余容量应为 0（现 ${fleetRemainingCapIn(st)}）`);
    if (fleetOutIn(st) !== 0) p.push('建造不应改变在外数量');
    for (const k of RESOURCE_KEYS) {
      const want = (one[k] || 0) * cap;
      if (beforeRes[k] - st.resources[k] !== want) {
        p.push(`${k}: 建造扣减应精确等于 单艘造价 × ${cap}（现 ${beforeRes[k] - st.resources[k]}，期望 ${want}）`);
      }
    }
    const snap = JSON.stringify(st);
    const over = buildIn(st, id, 1);
    if (over.ok) p.push('已到舰队容量仍能建造');
    else if (over.reason.code !== 'capacityFull') p.push(`到容量后应返回 capacityFull（现 ${over.reason.code}）`);
    else if (over.reason.capacity !== cap || over.reason.remaining !== 0) p.push('capacityFull 原因应带 capacity / remaining 供界面显示');
    if (JSON.stringify(st) !== snap) p.push('容量拦截时状态被改动');
    const snap2 = JSON.stringify(st);
    for (const bad of [0, -1, 1.5, 'x']) {
      const b = buildIn(st, id, bad);
      if (b.ok) p.push(`非法艘数 ${String(bad)} 竟然建造成功`);
      else if (b.reason.code !== 'badCount') p.push(`非法艘数应返回 badCount（现 ${b.reason.code}）`);
    }
    if (JSON.stringify(st) !== snap2) p.push('非法艘数被拒时状态被改动');
    if (buildIn(st, 'noSuchId', 1).reason.code !== 'unknown') p.push('未知 id 建造应返回 unknown');
    const beforeIdle = JSON.stringify(canBuildIn(st, id, 1).reason);
    if (!beforeIdle.includes('capacityFull')) p.push('容量满时 canBuild 也应报 capacityFull（与 build 同一口径）');
    add('⑫ 建造：扣资源精确 / count 增加 / 舰队容量拦截（恰好到容量；超 1 艘拒且零改动）', p);
  }

  // ⑬ 拆解返还＝单艘造价 × 艘数 × 船坞比例（逐资源**向下取整**、不足 1 不返还）+ 只拆未出征部分
  {
    const p = [];
    const st = createBaseState();
    const ratio = scrapRatioIn(st);
    if (!(ratio > 0 && ratio <= 1)) p.push(`船坞拆解返还比例应落在 (0,1]（现 ${ratio}）`);
    if (ratio !== buildingEffectOf('shipyard', stateLevelOf(st, 'shipyard')).scrapRefundRatio) {
      p.push('拆解比例应直接读船坞配置 effect.scrapRefundRatio');
    }
    const r = createFleetConfigIn(st, { name: 'S', shipId: 'combat', level: 1, modules: [] });
    const cfg = findFleetConfigIn(st, r.ok ? r.id : '');
    // (a) 注入"看得见取整"的成本 ⇒ 证明比例 + 逐资源向下取整真的生效
    const injected = () => ({ energy: 3 });
    const want1 = floorScaled(3 * 1 * ratio);
    const want3 = floorScaled(3 * 3 * ratio);
    const ref1 = refundWith(st, cfg, 1, { costOf: injected });
    const ref3 = refundWith(st, cfg, 3, { costOf: injected });
    if (!jsonEq(ref1, want1 > 0 ? { energy: want1 } : {})) p.push(`单艘返还应为 floor(3×比例)＝${want1}（现 ${JSON.stringify(ref1)}）`);
    if (!jsonEq(ref3, want3 > 0 ? { energy: want3 } : {})) p.push(`3 艘返还应为 floor(9×比例)＝${want3}（现 ${JSON.stringify(ref3)}）`);
    const weird = () => ({ energy: 37, alloy: 3 });
    const e2 = floorScaled(37 * ratio);
    const a2 = floorScaled(3 * ratio);
    const expect2 = {};
    if (e2 > 0) expect2.energy = e2;
    if (a2 > 0) expect2.alloy = a2;
    if (!jsonEq(refundWith(st, cfg, 1, { costOf: weird }), expect2)) {
      p.push(`逐资源向下取整不正确（期望 ${JSON.stringify(expect2)}，现 ${JSON.stringify(refundWith(st, cfg, 1, { costOf: weird }))}）`);
    }
    // (b) 真配置路径：返还 ≡ 每资源 floor(单艘造价 × 艘数 × 比例)
    const one = costOfConfigIn(st, cfg, {});
    const expectReal = {};
    for (const k of RESOURCE_KEYS) {
      const v = floorScaled((one[k] || 0) * 2 * ratio);
      if (v > 0) expectReal[k] = v;
    }
    if (!jsonEq(refundWith(st, cfg, 2), expectReal)) p.push('真配置返还与 floor(单艘造价 × 艘数 × 比例) 不一致');
    // (c) 实际拆解：count -= n、资源精确增加、out 不变；账户清零 ⇒ 返还不会被资源上限截断
    const st2 = createBaseState();
    const r2 = createFleetConfigIn(st2, { name: 'S', shipId: 'combat', level: 1, modules: [] });
    const id2 = r2.ok ? r2.id : '';
    const cfg2 = findFleetConfigIn(st2, id2);
    const one2 = costOfConfigIn(st2, cfg2, {});
    for (const k of RESOURCE_KEYS) st2.resources[k] = 0;
    cfg2.count = 3;
    const resBefore = { ...st2.resources };
    const sc = scrapIn(st2, id2, 2);
    if (!sc.ok) p.push(`拆解失败（现 ${sc.reason.code}）`);
    else {
      if (sc.scrapped !== 2 || sc.count !== 1) p.push(`拆解后数量应为 3 − 2 ＝ 1（现 ${sc.count}）`);
      for (const k of RESOURCE_KEYS) {
        const want = floorScaled((one2[k] || 0) * 2 * ratio);
        if (st2.resources[k] - resBefore[k] !== want) p.push(`${k}: 拆解返还入账应为 floor(单艘造价 × 2 × 比例)＝${want}`);
      }
      if (Object.keys(sc.overflow).length) p.push('账户清零后拆解返还不应被资源上限截断');
    }
    // (d) 只拆未出征的部分：count=3 / out=2 ⇒ 可拆 1、拆 2 被拒且零改动
    cfg2.count = 3;
    cfg2.out = 0;
    if (!setFleetOutIn(st2, id2, 2).ok) p.push('登记在外失败');
    const snapOut = JSON.stringify(st2);
    const s2 = scrapIn(st2, id2, 2);
    if (s2.ok || s2.reason.code !== 'notEnoughIdle') p.push(`在外 2 时应只能拆 1 艘（现 ${s2.ok ? 'ok' : s2.reason.code}）`);
    if (s2.ok === false && (s2.reason.idle !== 1 || s2.reason.out !== 2)) p.push('notEnoughIdle 原因应带 idle / out');
    if (JSON.stringify(st2) !== snapOut) p.push('拆解被拒时状态被改动');
    const s3 = scrapIn(st2, id2, 1);
    if (!s3.ok) p.push(`拆未出征的 1 艘应成功（现 ${s3.ok ? '' : s3.reason.code}）`);
    else if (cfg2.count !== 2 || cfg2.out !== 2) p.push(`拆解后 count 应减 1、out 不变（现 ${cfg2.count} / ${cfg2.out}）`);
    if (scrapIn(st2, id2, 0).reason.code !== 'badCount') p.push('拆解 0 艘应返回 badCount');
    if (scrapIn(st2, 'noSuchId', 1).reason.code !== 'unknown') p.push('拆解未知 id 应返回 unknown');
    add('⑬ 拆解返还（单艘造价 × 艘数 × 船坞比例、逐资源向下取整）+ 只拆未出征部分', p);
  }

  // ⑭ 配置"编辑"＝克隆为**新条目**（原条目逐字段不变；完全相同的配置仍合并）
  {
    const p = [];
    const st = createBaseState();
    const r1 = createFleetConfigIn(st, { name: 'E', shipId: 'combat', level: 1, modules: [] });
    const id1 = r1.ok ? r1.id : '';
    const srcBefore = JSON.stringify(findFleetConfigIn(st, id1));
    const newLevel = Math.min(2, shipMaxLevel('combat'));
    const r2 = cloneFleetConfigIn(st, id1, { level: newLevel });
    if (!r2.ok) p.push(`克隆失败（现 ${r2.ok ? '' : r2.reason.code}）`);
    if (st.fleetConfigs.length !== 2) p.push(`编辑应新增条目（现 ${st.fleetConfigs.length}）`);
    if (JSON.stringify(findFleetConfigIn(st, id1)) !== srcBefore) p.push('原条目在"编辑"后发生变化（应原样保留）');
    if (r2.ok && r2.id === id1) p.push('克隆必须产生新 id');
    const c2 = r2.ok ? findFleetConfigIn(st, r2.id) : null;
    if (c2 && (c2.count !== 0 || c2.out !== 0)) p.push('新条目应从 count＝0 / out＝0 起');
    if (c2 && c2.level !== newLevel) p.push('新条目应带上 patch 里的等级');
    if (r2.ok && r2.clonedFrom !== id1) p.push('克隆结果应标注 clonedFrom');
    if (r2.ok && r2.merged) p.push('等级不同的克隆不应合并');
    const r3 = cloneFleetConfigIn(st, id1, {});
    if (!r3.ok || !r3.merged || r3.id !== id1) p.push('克隆出完全相同的配置应合并回原条目');
    if (cloneFleetConfigIn(st, 'noSuchId', {}).reason.code !== 'unknown') p.push('克隆未知 id 应返回 unknown');
    if (st.fleetConfigs.length !== 2) p.push(`合并口径下条目数应仍为 2（现 ${st.fleetConfigs.length}）`);
    add('⑭ 配置"编辑"＝克隆为新条目（原条目零改动；完全相同的配置仍合并）', p);
  }

  // ⑮ 蓝图门槛（模块 `blueprint`）：未达标 ⇒ 拒装配 / 拒建造；达标或恢复后可装配
  {
    const p = [];
    const modId = 'cannon';
    const realDef = MODULES[modId];
    if (!realDef) p.push(`测试模块 ${modId} 不存在`);
    const fakeMod = { ...realDef, blueprint: [{ level: 1, count: 2 }, { level: 5, count: 3 }] };
    const modOf = (mid) => (mid === modId ? fakeMod : MODULES[mid]);
    if (moduleBlueprintReqOf(fakeMod, 1) !== 2) p.push('蓝图门槛逐级解析错误（Lv1 应为 2）');
    if (moduleBlueprintReqOf(fakeMod, 5) !== 3) p.push('蓝图门槛逐级解析错误（Lv5 应为 3）');
    if (moduleBlueprintReqOf(realDef, 1) !== 0) p.push('真配置的蓝图门槛占位应为 0（M3a 口径）');
    const spec = { name: 'G', shipId: 'combat', level: 1, modules: [{ moduleId: modId, level: 1 }] };
    // (a) 未达标 ⇒ 拒绝且不进状态
    const st = createBaseState();
    const r1 = createFleetConfigIn(st, spec, { moduleDefOf: modOf });
    if (r1.ok) p.push('蓝图未达标竟然可装配');
    else if (r1.reason.code !== 'blueprintMissing') p.push(`蓝图未达标应返回 blueprintMissing（现 ${r1.reason.code}）`);
    else if (r1.reason.need !== 2 || r1.reason.have !== 0) p.push('蓝图未达标原因应带 need＝2 / have＝0');
    if (st.fleetConfigs.length) p.push('蓝图未达标时不应产生条目');
    // (b) 达标 ⇒ 通过
    st.blueprints = { [modId]: 2 };
    const r2 = createFleetConfigIn(st, spec, { moduleDefOf: modOf });
    if (!r2.ok) p.push(`蓝图达标后应可装配（现 ${r2.ok ? '' : r2.reason.code}）`);
    // (c) 等级门槛：Lv5 需 3 张、只拥有 2 张 ⇒ 拒
    const spec5 = { name: 'G5', shipId: 'combat', level: 5, modules: [{ moduleId: modId, level: 5 }] };
    const r3 = createFleetConfigIn(st, spec5, { moduleDefOf: modOf });
    if (r3.ok) p.push('模块 Lv5 需 3 张蓝图、只拥有 2 张时应被拒');
    else if (r3.reason.code !== 'blueprintMissing' || r3.reason.need !== 3) p.push('Lv5 门槛原因应带 need＝3');
    // (d) 恢复（拥有 3）⇒ 可装配
    st.blueprints = { [modId]: 3 };
    if (!createFleetConfigIn(st, spec5, { moduleDefOf: modOf }).ok) p.push('蓝图补足后应可装配');
    // (e) 真配置（门槛占位 0）⇒ 无需蓝图即可装配、且不会因门槛受阻于建造
    const st2 = createBaseState();
    const r4 = createFleetConfigIn(st2, spec);
    if (!r4.ok) p.push(`真配置（blueprint 占位 0）应无需蓝图即可装配（现 ${r4.ok ? '' : r4.reason.code}）`);
    else {
      const cb = canBuildIn(st2, r4.id, 1);
      if (!cb.ok && cb.reason.code === 'blueprintMissing') p.push('真配置的建造不应受阻于蓝图门槛');
    }
    // 模块等级越界 / 未知模块（顺带核对校验链完整）
    const st3 = createBaseState();
    if (createFleetConfigIn(st3, { shipId: 'combat', level: 1, modules: [{ moduleId: modId, level: 999 }] }, { moduleDefOf: modOf }).reason.code !== 'badModuleLevel') {
      p.push('模块等级越过模块 maxLevel 应返回 badModuleLevel');
    }
    add('⑮ 蓝图门槛（模块 blueprint）：未达标拒装配 / 拒建造，达标或恢复后可装配', p);
  }

  // ⑯ ★ 快照渲染契约（**防"等级 undefined"/"NaN 上屏"复发**）：
  //    左列表项与舰队配置视图的字段必须是**整数**、**同源**、**键名固定**，且渲染层只读这些键。
  {
    const p = [];
    const snap = snapshot();
    // (a) 左列表项：id 齐全 / 顺序一致 / level·maxLevel 均为**整数**且 maxLevel ≥ level
    if (!Array.isArray(snap.listItems) || !snap.listItems.length) p.push('快照 listItems 不应为空');
    if (snap.listItemIds.join(',') !== snap.listItems.map((it) => it.id).join(',')) {
      p.push('listItemIds 与 listItems 的 id 顺序 / 内容不一致');
    }
    for (const it of snap.listItems) {
      if (typeof it.id !== 'string' || !it.id) p.push('左列表项缺 id');
      if (!Number.isInteger(it.level) || it.level < 1) p.push(`listItems[${it.id}].level 应为 ≥1 的整数（现 ${it.level}）`);
      if (!Number.isInteger(it.maxLevel) || it.maxLevel < it.level) {
        p.push(`listItems[${it.id}].maxLevel 应为整数且 ≥ level（现 ${it.maxLevel} / ${it.level}）`);
      }
      // 同源：等级 ≡ 引擎取等级函数（读状态）；上限 ≡ 建筑配置
      if (it.level !== buildingLevelOf(it.id)) p.push(`listItems[${it.id}].level 与 buildingLevelOf 不一致`);
      if (it.maxLevel !== BASE_BUILDINGS[it.id].maxLevel) p.push(`listItems[${it.id}].maxLevel 与建筑配置不一致`);
      // ★ **渲染契约**：界面只读 `level` / `maxLevel` 两键 ⇒ 快照必须显式给出；
      //   而**建筑配置里不得有 `level`**（等级属于状态）—— 这正是"面板误用配置对象 ⇒ 等级 undefined"的根因
      if (!('level' in it) || !('maxLevel' in it)) {
        p.push(`listItems[${it.id}] 必须显式暴露 level / maxLevel（渲染层只读这两个键）`);
      }
      if ('level' in BASE_BUILDINGS[it.id]) p.push(`建筑配置 ${it.id} 不应自带 level（等级只在状态 / 快照里）`);
      // 渲染层还要用的键（名称 / 副标题 / 分区 / 占位标记）
      if (typeof it.nameKey !== 'string' || !it.nameKey) p.push(`listItems[${it.id}] 缺 nameKey`);
      if (typeof it.metaKey !== 'string' || !it.metaKey) p.push(`listItems[${it.id}] 缺 metaKey`);
      if (it.zones !== null && !Array.isArray(it.zones)) p.push(`listItems[${it.id}].zones 应为数组或 null`);
      for (const z of it.zones || []) {
        if (typeof z.key !== 'string' || !z.key) p.push(`listItems[${it.id}] 的分区缺 key（界面按 key 分派分区内容）`);
        if (typeof z.nameKey !== 'string' || !z.nameKey) p.push(`listItems[${it.id}] 的分区缺 nameKey`);
      }
    }
    // ★ 船坞分区 key 是**渲染分派契约**（`ui/baseView.js` 按 `zones[].key` 分派）：
    //   ★ M3b 迭代后**只剩一个分区 `fleet`** —— "配置区 + 舰队区"已合并为**同一张表**，
    //     不许再有第二个分区（否则数量 / 造价会在两处各显示一遍 ⇒ 冗余复发）。
    const shipyardItem = snap.listItems.find((it) => it.id === 'shipyard');
    const zoneKeys = shipyardItem && shipyardItem.zones ? shipyardItem.zones.map((z) => z.key) : [];
    if (zoneKeys.length !== 1 || zoneKeys[0] !== 'fleet') {
      p.push(`船坞应只有 1 个分区且 key 为 fleet（现 ${zoneKeys.join('/') || '空'}）—— 界面据此渲染**唯一的合并表格**`);
    }
    // (b) 舰队配置视图：**渲染层读到的每个键都在**，数值字段均为整数（防 undefined / NaN 上屏）
    const VIEW_KEYS = [
      'id', 'name', 'order', 'shipId', 'typeNameKey', 'iconShip', 'level', 'maxLevel', 'slots',
      'modules', 'moduleChips', 'moduleCount', 'count', 'out', 'idle',
      'cost', 'refundPerUnit', 'canBuild', 'canScrap', 'canDelete', 'canMoveUp', 'canMoveDown',
    ];
    const st = createBaseState();
    const sampleMods = installableModuleIds().slice(0, 1).map((mid) => ({ moduleId: mid, level: 1 }));
    let sample = createFleetConfigIn(st, { name: 'V', shipId: 'combat', level: 5, modules: sampleMods });
    // 带模块建不出来（例如将来该模块的蓝图门槛非 0，属 ⑮ 的职责）⇒ 退化为无模块样本，**仍然**核验视图键与整数性
    if (!sample.ok) sample = createFleetConfigIn(st, { name: 'V', shipId: 'combat', level: 5, modules: [] });
    const views = listFleetConfigsIn(st, {});
    if (!sample.ok || views.length !== 1) p.push('渲染契约自检：样本配置未能构造');
    for (const v of views) {
      for (const k of VIEW_KEYS) if (!(k in v)) p.push(`舰队配置视图缺键 ${k}（界面按此键渲染）`);
      for (const k of ['order', 'level', 'maxLevel', 'slots', 'moduleCount', 'count', 'out', 'idle']) {
        if (!Number.isInteger(v[k])) p.push(`舰队配置视图 ${k} 应为整数（现 ${v[k]}）`);
      }
      if (v.order !== views.indexOf(v)) p.push(`舰队配置视图 order 应＝快照数组下标（现 ${v.order}）`);
      if (v.level < 1 || v.maxLevel < v.level) p.push(`舰队配置视图等级 / 上限关系不正确（${v.level} / ${v.maxLevel}）`);
      if (v.slots < v.moduleCount) p.push('舰队配置视图槽位数不应少于已装模块数');
      if (v.idle !== Math.max(0, v.count - v.out)) p.push('舰队配置视图 idle 口径应为 max(0, count − out)');
      if (!v.cost || typeof v.cost !== 'object') p.push('舰队配置视图 cost 应为对象');
      if (!v.refundPerUnit || typeof v.refundPerUnit !== 'object') p.push('舰队配置视图 refundPerUnit 应为对象');
      for (const k of ['canBuild', 'canScrap', 'canDelete', 'canMoveUp', 'canMoveDown']) {
        if (!v[k] || typeof v[k].ok !== 'boolean') p.push(`舰队配置视图 ${k} 必须带布尔 ok`);
        if (v[k] && v[k].ok === false && (!v[k].reason || !v[k].reason.code)) p.push(`${k} 为 false 时必须带 reason.code（禁用必有原因）`);
      }
      for (const m of v.modules) {
        if (typeof m.moduleId !== 'string' || !Number.isInteger(m.level)) {
          p.push('舰队配置视图的模块项应为 { moduleId: 字符串, level: 整数 }');
        }
      }
    }
    // (c) 资源栏项：数值链路同源（有限数 / cap ≥ 0 / remaining 口径一致）—— 防 NaN 上屏
    for (const it of snap.resourceItems) {
      if (!Number.isFinite(it.value) || !Number.isFinite(it.cap)) p.push(`资源栏 ${it.key} 的 value / cap 应为有限数`);
      if (it.cap < 0) p.push(`资源栏 ${it.key} 的 cap 不应为负`);
      if (it.remaining !== Math.max(0, it.cap - it.value)) p.push(`资源栏 ${it.key} 的 remaining 口径不一致`);
    }
    add('⑯ 快照渲染契约：左列表 level/maxLevel 整数且同源、舰队配置视图键名固定且整数、无 undefined/NaN', p);
  }

  // ⑰ 模块**可重复**：重复项合法 + 同一性 / 合并＝**排序后的模块多重集**（顺序不敏感、重复与等级可区分）
  {
    const p = [];
    const st = createBaseState();
    const ids = installableModuleIds();
    if (ids.length < 2) p.push('可装配模块不足 2 个，无法验证重复模块');
    const ma = ids[0];
    const mb = ids[1];
    const M = (id, level = 1) => ({ moduleId: id, level });
    const mk = (mods, name) => createFleetConfigIn(st, { name, shipId: 'combat', level: 5, modules: mods });
    // (a) 真配置：同一模块装**两次** ⇒ 合法（唯一上限仍是槽位数）
    const r1 = mk([M(ma), M(ma)], 'D1');
    if (!r1.ok) p.push(`重复模块应合法（现 ${r1.ok ? '' : r1.reason.code}）`);
    if (st.fleetConfigs.length !== 1) p.push(`一条重复模块配置应只产生 1 个条目（现 ${st.fleetConfigs.length}）`);
    const c1 = r1.ok ? findFleetConfigIn(st, r1.id) : null;
    if (c1 && c1.modules.length !== 2) p.push(`重复模块应**原样保存 2 项**（现 ${c1 ? c1.modules.length : 'n/a'}）`);
    // (b) 同一性键＝排序后的多重集：重复可区分 / 顺序不敏感 / 等级可区分
    const k = (mods) => identityKeyOf('combat', 5, mods);
    if (k([M(ma), M(ma)]) === k([M(ma)])) p.push('[A,A] 与 [A] 的同一性键必须不同（多重集口径）');
    if (k([M(ma), M(mb)]) !== k([M(mb), M(ma)])) p.push('[A,B] 与 [B,A] 应视为同一配置（顺序不敏感）');
    if (k([M(ma, 1), M(ma, 2)]) === k([M(ma, 1), M(ma, 1)])) p.push('同模块不同等级的多重集必须可区分');
    // (c) 合并：同一多重集（含重复 / 顺序不同）⇒ 合并回原条目，不新建
    const r2 = mk([M(ma), M(ma)], 'D2');
    if (!r2.ok || !r2.merged || r2.id !== r1.id) p.push('重复模块的同一配置应合并（不新建条目）');
    const r3 = mk([M(mb), M(ma)], 'D3');
    const r4 = mk([M(ma), M(mb)], 'D4');
    if (!r3.ok || !r4.ok || r4.id !== r3.id || !r4.merged) p.push('顺序不同的同一多重集应合并为同一条目');
    // (d) 槽位仍是**唯一**上限：重复模块超槽位 ⇒ slotOverflow 且零改动
    const slots5 = shipSlotsOf('combat', 5);
    const many = Array.from({ length: slots5 + 1 }, () => M(ma));
    const snapBefore = JSON.stringify(st);
    const r5 = mk(many, 'D5');
    if (r5.ok || r5.reason.code !== 'slotOverflow') p.push(`重复模块超槽位应 slotOverflow（现 ${r5.ok ? 'ok' : r5.reason.code}）`);
    if (JSON.stringify(st) !== snapBefore) p.push('槽位超限被拒时状态被改动');
    // (e) 造价：重复模块**各算一份**（注入逐级 installCost ⇒ 3 个重复项 ＝ 3 份）
    const fakeShip = { id: 'combat', nameKey: 'ship.combat', buildable: true, maxLevel: 16, buildCost: {}, upgradeCost: [], unlockByLevel: [], slots: 5 };
    const fakeMod = { id: ma, nameKey: 'x', category: 'attack', picker: true, maxLevel: 16, installCost: { energy: 10 } };
    const v = validateFleetSpecIn(
      st,
      { shipId: 'combat', level: 5, modules: [M(ma), M(ma), M(ma)] },
      { shipDefOf: () => fakeShip, moduleDefOf: () => fakeMod }
    );
    if (!v.ok) p.push(`注入定义下 3 个重复模块应合法（现 ${v.reason.code}）`);
    else if (v.cost.energy !== 30) p.push(`重复模块应各算一份造价（期望 30，现 ${v.cost.energy}）`);
    add('⑰ 模块可重复：重复项合法，同一性/合并＝排序后的模块多重集（顺序不敏感、重复与等级可区分、槽位仍为唯一上限）', p);
  }

  // ⑱ 模块**等级**参与造价（`installCost` 逐级表：同模块不同等级 ⇒ 造价不同）
  {
    const p = [];
    const st = createBaseState();
    const mid = installableModuleIds()[0];
    const fakeShip = { id: 'combat', nameKey: 'ship.combat', buildable: true, maxLevel: 16, buildCost: {}, upgradeCost: [], unlockByLevel: [], slots: 5 };
    const costAt = (level, def) => {
      const v = validateFleetSpecIn(
        st,
        { shipId: 'combat', level: 5, modules: [{ moduleId: mid, level }] },
        { shipDefOf: () => fakeShip, moduleDefOf: () => def }
      );
      return v.ok ? v.cost.energy : null;
    };
    // (a) 注入逐级表：Lv1 ⇒ 100、Lv5 ⇒ 700（**逐级读配置**，不是常数）
    const ladder = { id: mid, nameKey: 'x', category: 'attack', picker: true, maxLevel: 16, installCost: [{ level: 1, cost: { energy: 100 } }, { level: 5, cost: { energy: 700 } }] };
    const i1 = costAt(1, ladder);
    const i5 = costAt(5, ladder);
    if (i1 !== 100) p.push(`模块 Lv1 装配费应取逐级表 Lv1＝100（现 ${i1}）`);
    if (i5 !== 700) p.push(`模块 Lv5 装配费应取逐级表 Lv5＝700（现 ${i5}）`);
    if (!(i5 > i1)) p.push('模块等级必须参与造价（Lv5 应贵于 Lv1）');
    // (b) 真配置：火炮 `cannon` 的 `installCost` 已按等级填实（本迭代要求非 0 且逐级递增）
    const realCost = (level) => {
      const v = validateFleetSpecIn(st, { shipId: 'combat', level: 5, modules: [{ moduleId: 'cannon', level }] }, { shipDefOf: () => fakeShip });
      return v.ok ? v.cost.energy || 0 : null;
    };
    const rc1 = realCost(1);
    const rc2 = realCost(2);
    if (rc1 === null || rc2 === null) p.push('真配置：cannon 在 Lv1 / Lv2 都应可装配（检查 blueprint 门槛与等级上限）');
    else {
      if (!(rc1 > 0)) p.push(`真配置：cannon Lv1 的 installCost 应为非 0 实际值（现 ${rc1}）`);
      if (!(rc2 > rc1)) p.push(`真配置：cannon Lv2 的 installCost 应高于 Lv1（现 ${rc1} → ${rc2}）`);
    }
    add('⑱ 模块等级参与造价（installCost 逐级表：注入表逐级对拍 + 真配置 cannon 非 0 且逐级递增）', p);
  }

  // ⑲ 舰队表格**列契约**：表格每列读到的键都在（含 `typeNameKey` / `iconShip` / `moduleChips`），筹码无 undefined
  {
    const p = [];
    const st = createBaseState();
    const mods = installableModuleIds().slice(0, 2).map((mid) => ({ moduleId: mid, level: 1 }));
    const r = createFleetConfigIn(st, { name: 'T', shipId: 'combat', level: 5, modules: mods });
    if (!r.ok) p.push(`表格样本配置构造失败（现 ${r.reason.code}）`);
    const v = listFleetConfigsIn(st, {})[0];
    if (!v) p.push('配置视图为空（无法核对表格列）');
    else {
      // 第 1/2/3/4/5/7/8/9 列的键
      for (const k of ['name', 'iconShip', 'typeNameKey', 'level', 'moduleChips', 'cost', 'refundPerUnit', 'count']) {
        if (!(k in v)) p.push(`表格列 ${k} 缺失（界面按此键渲染）`);
      }
      if (typeof v.typeNameKey !== 'string' || !v.typeNameKey) p.push('typeNameKey 应为非空字符串（第 3 列「单位类型」）');
      if (!v.iconShip || v.iconShip.typeId !== v.shipId) p.push('iconShip.typeId 应 ＝ shipId（`unitIcon()` 的唯一入参）');
      if (!v.iconShip || typeof v.iconShip.typeCfg !== 'object' || v.iconShip.typeCfg === null) p.push('iconShip.typeCfg 应为对象（图标优先级口径）');
      // 第 5 列：筹码（**含空槽位占位** ⇒ 长度恒等于槽位数）
      if (!Array.isArray(v.moduleChips)) p.push('moduleChips 应为数组');
      else {
        if (v.moduleChips.length !== v.slots) p.push(`moduleChips 长度应 ＝ 槽位数 ${v.slots}（现 ${v.moduleChips.length}）`);
        for (const chip of v.moduleChips) {
          for (const k of ['empty', 'moduleId', 'level', 'maxLevel', 'category', 'nameKey', 'icon']) {
            if (!(k in chip)) p.push(`模块筹码缺键 ${k}（界面按此渲染 .module-chip / .module-slot-empty）`);
          }
          if (typeof chip.empty !== 'boolean') p.push('筹码 empty 应为布尔');
          if (chip.empty === false) {
            if (typeof chip.moduleId !== 'string' || !chip.moduleId) p.push('已装筹码必须有 moduleId');
            if (!Number.isInteger(chip.level) || chip.level < 1) p.push(`已装筹码 level 应为 ≥1 整数（现 ${chip.level}）`);
            if (!Number.isInteger(chip.maxLevel) || chip.maxLevel < chip.level) p.push(`已装筹码 maxLevel 应为 ≥level 的整数（等级下拉范围；现 ${chip.maxLevel}）`);
            if (typeof chip.category !== 'string' || !chip.category) p.push('已装筹码应有 category（`.module-chip.<category>` 配色类名）');
          }
        }
        const filled = v.moduleChips.filter((c) => !c.empty).length;
        if (filled !== v.moduleCount) p.push(`已装筹码数应 ＝ moduleCount（现 ${filled} / ${v.moduleCount}）`);
      }
      // 弹窗草稿预览**同源**：`previewFleetSpec` 也必须给 chips（列表与草稿共用同一构造器）
      const pv = previewFleetSpec({ shipId: 'combat', level: 5, modules: mods });
      if (!pv.ok) p.push(`草稿预览应合法（现 ${pv.reason.code}）`);
      else if (!Array.isArray(pv.chips) || pv.chips.length !== pv.slots) p.push('previewFleetSpec 应给出与表格同源的 chips');
      if (!pv.iconShip || pv.iconShip.typeId !== 'combat') p.push('previewFleetSpec 应给出 iconShip（弹窗标题的单位图标与表格同源）');
      const pvBad = previewFleetSpec({ shipId: 'no-such-ship' });
      if (!Array.isArray(pvBad.chips)) p.push('非法草稿（未知船型）也应给出 chips 数组 ⇒ 弹窗照常渲染');
      if (!pvBad.iconShip || pvBad.iconShip.typeId !== '') p.push('未知船型的预览也应给出空 iconShip（弹窗不崩）');
    }
    add('⑲ 舰队表格列契约（name/iconShip/typeNameKey/level/moduleChips/cost/refundPerUnit/count）+ 筹码键齐全无 undefined', p);
  }

  // ⑳ 舰队表格**单一数据源**：一条配置只由 `snapshot().fleet.configs` 提供一次（两区重复已消除）
  {
    const p = [];
    const snapNow = snapshot();
    if (!snapNow.fleet || !Array.isArray(snapNow.fleet.configs)) p.push('快照应提供 fleet.configs（表格唯一数据源）');
    if (snapNow.fleet && 'ships' in snapNow.fleet) p.push('快照不应再有第二个舰队列表（ships）');
    const listData = listBaseData();
    if (!listData.fleet || !Array.isArray(listData.fleet.configs)) p.push('listBaseData 应与快照同口径给出 fleet.configs');
    const st = createBaseState();
    const r = createFleetConfigIn(st, { name: 'O', shipId: 'combat', level: 1, modules: [] });
    const v1 = listFleetConfigsIn(st, {})[0];
    if (v1) {
      // 数量 / 造价各**只有一处**来源（禁止第二种别名 ⇒ 防"两区各显示一遍"复发）
      for (const k of ['ships', 'total', 'costTotal', 'countTotal']) {
        if (k in v1) p.push(`配置视图出现第二处数量/造价来源 ${k}（同一行契约被破坏）`);
      }
      for (const k of ['count', 'cost']) if (!(k in v1)) p.push(`配置视图缺列 ${k}`);
    }
    if (!r.ok) p.push(`单一数据源样本构造失败（现 ${r.reason.code}）`);
    else if (!buildIn(st, r.id, 1).ok) p.push('建造失败（无法核对数量来源）');
    const v2 = listFleetConfigsIn(st, {})[0];
    if (v1 && v2 && v2.count !== v1.count + 1) p.push(`建造后视图数量应 +1（现 ${v1 ? v1.count : 'n/a'} → ${v2 ? v2.count : 'n/a'}）`);
    add('⑳ 舰队表格单一数据源（快照 fleet.configs 唯一；数量/造价各一列，无两区重复来源）', p);
  }

  // ㉑ 重复模块 + **各自等级**：快照 `moduleChips` 的顺序与等级逐一正确（弹窗回填 / 表格渲染共用同一构造器）
  {
    const p = [];
    const st = createBaseState();
    const mods = installableModuleIds();
    const slots = shipSlotsOf('combat', 1);
    // 取**等级上限 ≥ 2** 的可装配模块（这样"同模块不同等级"的两个筹码可区分）；用**注入定义**避开蓝图门槛
    const m0 = mods.find((id) => moduleMaxLevel(moduleDefOf(id)) >= 2) || mods[0];
    const realDef = m0 ? moduleDefOf(m0) : null;
    if (!realDef || slots < 2) p.push('样本不足：需要 ≥1 个可装配模块与 ≥2 个槽位');
    else {
      const maxLv = moduleMaxLevel(realDef);
      const fakeDef = { ...realDef, blueprint: [] }; // ★ 去掉蓝图门槛 ⇒ 断言只测"重复 + 各自等级 + 顺序"
      const modOf = (mid) => (mid === m0 ? fakeDef : MODULES[mid]);
      const lv2 = Math.min(2, maxLv);
      const dup = [{ moduleId: m0, level: 1 }, { moduleId: m0, level: lv2 }];
      const r = createFleetConfigIn(st, { name: 'D', shipId: 'combat', level: 1, modules: dup }, { moduleDefOf: modOf });
      if (!r.ok) p.push(`重复模块配置应可创建（现 ${r.reason.code}）`);
      const v = listFleetConfigsIn(st, { moduleDefOf: modOf })[0];
      if (v) {
        const chips = v.moduleChips.filter((c) => !c.empty);
        if (chips.length !== 2) p.push(`重复模块应在筹码里出现 2 次（现 ${chips.length}）`);
        if (chips[0] && chips[0].moduleId !== m0) p.push('筹码顺序应与草稿顺序一致（第 1 项）');
        if (chips[1] && chips[1].moduleId !== m0) p.push('筹码顺序应与草稿顺序一致（第 2 项）');
        if (chips[0] && chips[0].level !== 1) p.push(`第 1 个筹码等级应为 1（现 ${chips[0] && chips[0].level}）`);
        if (chips[1] && chips[1].level !== lv2) p.push(`第 2 个筹码等级应为 ${lv2}（现 ${chips[1] && chips[1].level}）`);
        for (const c of chips) {
          if (c.maxLevel !== maxLv) p.push(`筹码应带该模块等级上限 ${maxLv}（现 ${c.maxLevel}）`);
          if (c.nameKey !== realDef.nameKey) p.push('筹码应带模块名词条 key');
          if (!c.category) p.push('筹码应带模块分类（供 module-chip 分类配色）');
        }
        // 弹窗草稿（干跑校验）与表格**同源** ⇒ 顺序 / 等级逐项一致
        const pv = validateFleetSpecIn(st, { shipId: 'combat', level: 1, modules: dup }, { moduleDefOf: modOf });
        if (!pv.ok) p.push(`草稿应合法（现 ${pv.reason.code}）`);
        else {
          const dchips = pv.chips.filter((c) => !c.empty);
          if (dchips.length !== 2) p.push('草稿筹码应与模块条目数一致');
          else if (dchips[0].level !== chips[0].level || dchips[1].level !== chips[1].level) p.push('草稿筹码等级应与表格同源同值');
        }
        // 重复模块的造价**各算一份**（与 ⑰(e) 同一口径）：fakeDef 的 installCost 未覆盖 ⇒ 真配置值仍逐项累加
      }
    }
    add('㉑ 重复模块 + 各自等级：moduleChips 顺序/等级/上限与草稿同源（表格与弹窗共用 chipsOf）', p);
  }

  // ㉒ 模块选择弹窗的**数据来源**：分类筛选列表完全来自引擎（UI 零自算）
  {
    const p = [];
    const data = modulePickerDataIn(createBaseState(), {});
    const ids = installableModuleIds();
    if (!Array.isArray(data.categories) || !Array.isArray(data.modules)) p.push('应给出 { categories, modules }');
    else {
      if (data.modules.length !== ids.length) p.push(`模块条数应＝可装配模块数（现 ${data.modules.length} / ${ids.length}）`);
      if (data.modules.some((m, i) => m.moduleId !== ids[i])) p.push('模块顺序应与 installableModuleIds() 一致（确定性）');
      for (const m of data.modules) {
        const def = MODULES[m.moduleId] || {};
        if (!m.nameKey || !i18n.has(m.nameKey)) p.push(`${m.moduleId}: 应带 i18n 名 key`);
        if (m.category !== def.category) p.push(`${m.moduleId}: 分类应取自配置（现 ${m.category}）`);
        if (!m.categoryNameKey || !i18n.has(m.categoryNameKey)) p.push(`${m.moduleId}: 分类名 key ${m.categoryNameKey} 缺词条`);
        if (m.maxLevel !== moduleMaxLevel(def)) p.push(`${m.moduleId}: 等级上限应由引擎给（现 ${m.maxLevel}）`);
        if (m.icon !== (def.icon || null)) p.push(`${m.moduleId}: 图标应取自配置`);
      }
      // 分类**顺序＝CATEGORY_ORDER**，且只保留"确有模块"的类别
      const expect = CATEGORY_ORDER.filter((cat) => data.modules.some((m) => m.category === cat));
      if (JSON.stringify(data.categories) !== JSON.stringify(expect)) p.push(`分类表应为 CATEGORY_ORDER 的有序子集（现 ${data.categories.join(',')}）`);
      for (const cat of CATEGORY_ORDER) {
        if (!i18n.has(`module.cat.${cat}`)) p.push(`类别 ${cat} 缺 i18n 分类名（module.cat.${cat}）`);
      }
      // 每个模块的 category 都能在 categories 里被筛到（不会出现"筛不到"的孤儿模块）
      for (const m of data.modules) if (!data.categories.includes(m.category)) p.push(`${m.moduleId} 的分类不在筛选表里`);
    }
    add('㉒ 模块选择弹窗数据源＝引擎（分类顺序 CATEGORY_ORDER / 名称·图标·上限·分类名 key 齐全，UI 零自算）', p);
  }

  // ㉓ 默认配置名＝**该语言下的船型名**（迭代 3 口径：单位配置，不再带"编队 / Squad"后缀）
  {
    const p = [];
    const shipDef = shipDefOf('combat');
    const before = i18n.locale;
    const other = i18n.locales.find((l) => l !== before) || before;
    const probe = () => {
      const st = createBaseState();
      const r = createFleetConfigIn(st, { shipId: 'combat', level: 1, modules: [] }); // 留空 ⇒ 默认名
      return { name: r.ok ? r.name : '', hull: i18n.t(shipDef.nameKey), has: i18n.has('base.fleet.defaultName') };
    };
    let there = null;
    let switched = false;
    const here = probe();
    if (other !== before && i18n.set(other)) {
      switched = true;
      there = probe();
      i18n.set(before); // ★ 断言完立刻还原语言（自检**不改外在状态**）
    }
    const bad = (lbl, v) => {
      if (!v.has) p.push(`缺词条 base.fleet.defaultName（${lbl}）`);
      if (!v.name) {
        p.push(`留空名应生成默认名（${lbl}）`);
        return;
      }
      // ★ 迭代 3：默认名 **＝ 该语言的船型名**（逐字相等，不是"包含"）
      if (v.name !== v.hull) p.push(`默认名应等于该语言的船型名（${lbl}：期望 ${v.hull}，现 ${v.name}）`);
      if (v.name === 'combat') p.push(`默认名不得是船型 id 字面量（${lbl}）`);
      if (v.name.startsWith('??')) p.push(`默认名不得泄漏 ??key（${lbl}）`);
      for (const word of ['编队', 'Squad', 'squad']) {
        if (v.name.includes(word)) p.push(`默认名不应含"${word}"（这是**单位配置**而非编队）（${lbl}）`);
      }
    };
    bad(before, here);
    if (!switched) p.push('只有一种语言：跨语言默认名断言被跳过');
    else if (there) bad(other, there);
    // 名称 key 缺失时的退化：仍用模板包住 id 字面量（**绝不泄漏 ??key**）
    const deg = defaultFleetNameOf('no.such.key', 'combat');
    if (!deg.includes('combat') || deg.startsWith('??')) p.push(`名称 key 缺失时应退化为 id 字面量并被模板包裹（现 ${deg}）`);
    if (i18n.locale !== before) i18n.set(before); // 双保险：语言必须还原
    add('㉓ 默认配置名＝该语言的**船型名**（zh/en 各自逐字相等、非 id 字面量、不含"编队 / Squad"）', p);
  }

  // ㉔ 改名合并（B-2）：以**新修改的名称**为准 + 复核"完全相同的草稿仍合并、无空条目"
  {
    const p = [];
    const st = createBaseState();
    const a = createFleetConfigIn(st, { name: '原名', shipId: 'combat', level: 1, modules: [] });
    if (!a.ok) p.push('样本创建失败');
    buildIn(st, a.id, 1);
    const outBefore = findFleetConfigIn(st, a.id).count;
    // ① **只改名称**（配置项完全相同）⇒ 合并回原条目并**应用新名**
    const b = cloneFleetConfigIn(st, a.id, { name: '新名' });
    if (!b.ok) p.push(`只改名的编辑应成功（现 ${b.reason.code}）`);
    else {
      if (!b.merged) p.push('只改名的编辑应**合并回原条目**（同 identityKey）');
      if (b.name !== '新名') p.push(`合并时应以**新名**为准（现 ${b.name}）`);
      if (findFleetConfigIn(st, a.id).name !== '新名') p.push('既有条目名应被更新为新名');
      if (st.fleetConfigs.length !== 1) p.push(`改名不应新增条目（现 ${st.fleetConfigs.length}）`);
      if (findFleetConfigIn(st, a.id).count !== outBefore) p.push('改名应保留既有数量/在外');
    }
    // ② **逐字段完全相同**的草稿 ⇒ 仍合并、**不新增**、也不改名
    const c = cloneFleetConfigIn(st, a.id, {});
    if (!c.ok || !c.merged || c.id !== a.id) p.push('完全相同的草稿应合并回原条目');
    else if (c.name !== '新名' || c.nameChanged) p.push('相同草稿不应改动名字');
    if (st.fleetConfigs.length !== 1) p.push('相同草稿不应产生新条目/空条目');
    // ③ 改了配置（等级）且改名 ⇒ 走"新建条目"，**原条目原样保留**
    const d = cloneFleetConfigIn(st, a.id, { name: '另一条', level: 2 });
    if (!d.ok) p.push(`改配置的编辑应成功（现 ${d.reason.code}）`);
    else {
      if (d.merged) p.push('配置不同不应合并');
      if (st.fleetConfigs.length !== 2) p.push(`改配置应新增 1 条（现 ${st.fleetConfigs.length}）`);
      if (findFleetConfigIn(st, a.id).name !== '新名') p.push('原条目应原样保留');
      if (findFleetConfigIn(st, d.id).count !== 0) p.push('新条目应从 0 艘起');
    }
    // ④ 与**别人**重名 ⇒ 仍走 `#N` 唯一化
    const e = cloneFleetConfigIn(st, a.id, { name: '另一条' });
    if (!e.ok || e.name !== '另一条#2') p.push(`与其它条目重名应得 另一条#2（现 ${e.ok ? e.name : 'failed'}）`);
    add('㉔ 改名合并以新名为准（identityKey 命中 ⇒ 更新名称并保留数量/在外；未命中 ⇒ 原条目保留 + 新条目；重名 #N）', p);
  }

  // ㉕ 列表排序：上/下移 ≡ 拖动、**连续下移再连续上移必回原位**、越界零改动、快照顺序＝状态数组顺序
  {
    const p = [];
    // ★ 5 条配置（等级 1..5，identity 互不相同）：条目数 ≥ 3 才能做"连续下移 / 上移往返"这类强断言
    const mkState = () => {
      const s = createBaseState();
      const ids = [];
      for (let i = 1; i <= 5; i += 1) {
        const r = createFleetConfigIn(s, { name: `s${i}`, shipId: 'combat', level: i, modules: [] });
        if (!r.ok) return { s, ok: false, reason: r.reason, ids };
        ids.push(r.id);
      }
      return { s, ok: true, ids };
    };
    const A = mkState();
    if (!A.ok) p.push(`排序样本创建失败（${A.reason && A.reason.code}）`);
    else {
      const st = A.s;
      // ★ 一律**按 id 逐项对拍**（名称可能带去重后缀，id 才是身份）
      const idOrder = (state) => (state.fleetConfigs || []).map((x) => x.id);
      const snapOrder = (state) => listFleetConfigsIn(state, {}).map((v) => v.id);
      const label = (ids) => ids.map((id) => `s${A.ids.indexOf(id) + 1}`).join(',');
      const sameIds = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
      const views = (state) => listFleetConfigsIn(state, {});
      // ① 初始：快照 / 视图顺序 ＝ 数组顺序；`order` ＝ 下标；首末 `canMoveUp/Down` 与位置一致
      if (!sameIds(snapOrder(st), idOrder(st))) p.push('快照顺序应＝状态数组顺序');
      if (views(st).some((v, i) => v.order !== i)) p.push('视图 order 应为数组下标');
      const checkArrows = (state, tag) => {
        const list = views(state);
        list.forEach((v, i) => {
          // ★ 防御式读取：视图字段缺失时**报错而不是抛异常**（自检绝不能因断言本身崩掉）
          const upOk = !!(v.canMoveUp && v.canMoveUp.ok === true);
          const downOk = !!(v.canMoveDown && v.canMoveDown.ok === true);
          const upCode = v.canMoveUp && v.canMoveUp.reason ? v.canMoveUp.reason.code : null;
          const downCode = v.canMoveDown && v.canMoveDown.reason ? v.canMoveDown.reason.code : null;
          if (upOk !== (i > 0)) p.push(`${tag}：下标 ${i} 的 canMoveUp 应为 ${i > 0}`);
          if (downOk !== (i < list.length - 1)) p.push(`${tag}：下标 ${i} 的 canMoveDown 应为 ${i < list.length - 1}`);
          if (i === 0 && upCode !== 'edgeMove') p.push(`${tag}：首项 canMoveUp 的原因应为 edgeMove`);
          if (i === list.length - 1 && downCode !== 'edgeMove') p.push(`${tag}：末项 canMoveDown 的原因应为 edgeMove`);
        });
      };
      checkArrows(st, '初始');
      // ② 越界 / 非法 / 原位：**零改动 + 原因**
      const before = JSON.stringify(st);
      if (moveFleetConfigIn(st, A.ids[0], -1).reason.code !== 'edgeMove') p.push('首项上移应返回 edgeMove');
      if (moveFleetConfigIn(st, A.ids[4], 1).reason.code !== 'edgeMove') p.push('末项下移应返回 edgeMove');
      if (moveFleetConfigIn(st, A.ids[0], 0).reason.code !== 'badOrder') p.push('方向 0 应返回 badOrder');
      if (moveFleetConfigIn(st, A.ids[0], 5).reason.code !== 'badOrder') p.push('非法方向应返回 badOrder');
      if (reorderFleetConfigIn(st, A.ids[0], 99).reason.code !== 'badOrder') p.push('越界下标应返回 badOrder');
      if (reorderFleetConfigIn(st, A.ids[0], 0).reason.code !== 'edgeMove') p.push('拖到原位应返回 edgeMove');
      if (moveFleetConfigIn(st, 'noSuchId', 1).reason.code !== 'unknown') p.push('未知 id 应返回 unknown');
      if (JSON.stringify(st) !== before) p.push('被拒的排序操作应**状态零改动**');
      // ③ ★ 连续下移两次（第 2 条：下标 1 ⇒ 3）→ 连续上移两次 ⇒ **必须回到原始顺序**（逐项 id 对拍）
      const orig = idOrder(st);
      const wantDown = [A.ids[0], A.ids[2], A.ids[3], A.ids[1], A.ids[4]]; // s1,s3,s4,s2,s5
      for (let k = 1; k <= 2; k += 1) {
        const r = moveFleetConfigIn(st, A.ids[1], 1);
        if (!r.ok) p.push(`第 ${k} 次下移应成功（现 ${r.reason.code}）`);
        else if (!sameIds(snapOrder(st), idOrder(st))) p.push(`第 ${k} 次下移后快照顺序应与数组顺序一致`);
        if (views(st).some((v, i) => v.order !== i)) p.push(`第 ${k} 次下移后视图 order 应仍为数组下标`);
      }
      if (!sameIds(idOrder(st), wantDown)) p.push(`连续下移两次应为 s1,s3,s4,s2,s5（现 ${label(idOrder(st))}）`);
      checkArrows(st, '下移后');
      for (let k = 1; k <= 2; k += 1) {
        const r = moveFleetConfigIn(st, A.ids[1], -1);
        if (!r.ok) p.push(`第 ${k} 次上移应成功（现 ${r.reason.code}）`);
        else if (!sameIds(snapOrder(st), idOrder(st))) p.push(`第 ${k} 次上移后快照顺序应与数组顺序一致`);
      }
      if (!sameIds(idOrder(st), orig)) p.push(`连续下移两次再上移两次应回到原始顺序（现 ${label(idOrder(st))}）`);
      if (!sameIds(snapOrder(st), orig)) p.push('往返后快照顺序应＝原始顺序');
      checkArrows(st, '往返后');
      // ④ 移到**末位**后再次同向移动 ⇒ `edgeMove` 且**零改动**（边界不得错位，也不是"失败"）
      for (let k = 1; k <= 3; k += 1) {
        if (!moveFleetConfigIn(st, A.ids[1], 1).ok) p.push(`下移到末位的第 ${k} 步应成功`);
      }
      if (idOrder(st)[4] !== A.ids[1]) p.push('3 次下移后应位于末位');
      const atEnd = JSON.stringify(st);
      if (moveFleetConfigIn(st, A.ids[1], 1).reason.code !== 'edgeMove') p.push('末位再下移应返回 edgeMove');
      if (JSON.stringify(st) !== atEnd) p.push('末位再下移应零改动（不得错位）');
      // ⑤ 等价性：同一初始状态的**两个平行状态** —— "拖动到下标 3" ≡ "连续下移两次"
      const B = mkState();
      const C = mkState();
      const dragOk = B.ok && reorderFleetConfigIn(B.s, B.ids[1], 3).ok;
      if (!dragOk) p.push('拖动排序失败');
      const btnOk = C.ok && moveFleetConfigIn(C.s, C.ids[1], 1).ok && moveFleetConfigIn(C.s, C.ids[1], 1).ok;
      if (!btnOk) p.push('按钮连续下移两次失败');
      if (dragOk && btnOk) {
        const byDrag = idOrder(B.s);
        const byBtn = idOrder(C.s);
        if (!sameIds(byDrag, byBtn)) p.push(`拖动与按钮应等价（拖动 ${label(byDrag)} / 按钮 ${label(byBtn)}）`);
        if (!sameIds(byDrag, wantDown)) p.push(`拖到下标 3 的结果应为 s1,s3,s4,s2,s5（现 ${label(byDrag)}）`);
      }
    }
    add('㉕ 排序（上/下移 ≡ 拖动；**连续下移两次再上移两次回原位**；每步快照＝数组同序；越界/原位零改动 + 原因；canMoveUp/Down 与位置一致）', p);
  }

  // ㉖ 资源配色键：资源 → CSS 变量 → 颜色语义（矿物紫 / 稀土绿 / 合金银）；且**不借用**货物/分类色
  {
    const p = [];
    const expect = { energy: '--energy', ore: '--ore', alloy: '--alloy', rare: '--rare', science: '--accent' };
    for (const k of RESOURCE_KEYS) {
      const def = getResource(k);
      if (!def || typeof def.colorKey !== 'string' || !def.colorKey.startsWith('--')) p.push(`${k}: colorKey 应为 CSS 变量名`);
      else if (expect[k] && def.colorKey !== expect[k]) p.push(`${k}: colorKey 应为 ${expect[k]}（现 ${def.colorKey}）`);
    }
    // 资源**不得**借用货物色 / 模块分类色（否则货物或模块会跟着变色）
    const borrowed = ['--cargo', '--cat-transport', '--cat-mining', '--cat-function', '--cat-attack', '--cat-shield', '--cat-drone'];
    for (const k of RESOURCE_KEYS) {
      const ck = getResource(k) && getResource(k).colorKey;
      if (borrowed.includes(ck)) p.push(`${k} 不应借用 ${ck}（会让货物/模块跟着变色）`);
    }
    // 三个关键资源色**互不相同**
    const keys3 = ['ore', 'rare', 'alloy'].map((k) => getResource(k).colorKey);
    if (new Set(keys3).size !== 3) p.push(`矿物/稀土/合金应指向 3 个不同变量（现 ${keys3.join(',')}）`);
    // 变量**确实定义在 `:root`**，且颜色语义正确（紫 / 绿 / 银）—— 无 DOM 环境跳过（不误报）
    const root = typeof document !== 'undefined' && document.documentElement ? document.documentElement : null;
    if (!root || typeof getComputedStyle !== 'function') {
      p.push('环境异常：无 DOM ⇒ 无法核对 CSS 变量取色（自检应在浏览器环境运行）');
    } else {
      const cs = getComputedStyle(root);
      const hexOf = (v) => (v || '').trim();
      const rgbOf = (v) => {
        const m = /^#([0-9a-f]{6})$/i.exec(hexOf(v));
        if (!m) return null;
        const n = parseInt(m[1], 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      };
      const classOf = (rgb) => {
        if (!rgb) return 'unknown';
        const [r, g, b] = rgb.map((x) => x / 255);
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const l = (max + min) / 2;
        const d = max - min;
        const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
        let h = 0;
        if (d !== 0) {
          if (max === r) h = 60 * (((g - b) / d) % 6);
          else if (max === g) h = 60 * ((b - r) / d + 2);
          else h = 60 * ((r - g) / d + 4);
        }
        if (h < 0) h += 360;
        if (s < 0.25 && l > 0.55) return 'silver';
        if (h >= 250 && h <= 300 && s > 0.3) return 'purple';
        if (h >= 90 && h <= 165 && s > 0.3) return 'green';
        return `other(h${Math.round(h)},s${s.toFixed(2)},l${l.toFixed(2)})`;
      };
      const want = { ore: 'purple', rare: 'green', alloy: 'silver' };
      for (const k of Object.keys(want)) {
        const v = hexOf(cs.getPropertyValue(getResource(k).colorKey));
        if (!v) p.push(`CSS 变量 ${getResource(k).colorKey} 未在 :root 定义`);
        else {
          const cls = classOf(rgbOf(v));
          if (cls !== want[k]) p.push(`${k} 颜色语义应为 ${want[k]}（现 ${getResource(k).colorKey}=${v} ⇒ ${cls}）`);
        }
      }
      // 货物（橙）与采矿类模块（紫）**不受本次调色影响**：变量仍在且非空
      for (const v of ['--cargo', '--cat-transport']) {
        if (!hexOf(cs.getPropertyValue(v))) p.push(`既有语义色 ${v} 不应被移除`);
      }
    }
    add('㉖ 资源配色键（energy/ore/alloy/rare/science → CSS 变量）+ 矿物紫/稀土绿/合金银 + 不借用货物·分类色', p);
  }

  // ㉗ 模块造价读取（二级弹窗显示用）：**与表格单艘造价里的模块部分同源**、逐级读配置、非法入参被拒
  {
    const p = [];
    const st = createBaseState();
    const mods = installableModuleIds();
    const m0 = mods.find((id) => moduleMaxLevel(moduleDefOf(id)) >= 2) || mods[0];
    const def0 = m0 ? moduleDefOf(m0) : null;
    if (!def0) p.push('样本不足：需要 ≥1 个可装配模块');
    else {
      const maxLv = moduleMaxLevel(def0);
      for (const lv of [1, Math.min(2, maxLv), maxLv]) {
        const c = moduleCostAtIn(st, m0, lv);
        if (!c.ok) {
          p.push(`${m0} Lv${lv} 费用读取失败（${c.reason.code}）`);
          continue;
        }
        if (c.level !== lv) p.push(`${m0} 费用应回带所查等级（现 ${c.level}）`);
        if (c.maxLevel !== maxLv) p.push(`${m0} 的等级上限应为 ${maxLv}（现 ${c.maxLevel}）`);
        // ★ 与"表格造价"的模块部分**同一助手** ⇒ 必须逐资源相等（同源口径）
        if (!jsonEq(c.install, moduleInstallCostOf(def0, lv))) p.push(`${m0} Lv${lv} 的装配费应与表格模块造价同源`);
        if (!jsonEq(c.remove, costOf(perLevelValueOf(def0.removeCost, lv, { empty: {} })))) p.push(`${m0} Lv${lv} 的拆下费应逐级读配置`);
        if (c.blueprint !== moduleBlueprintReqOf(def0, lv)) p.push(`${m0} Lv${lv} 的蓝图门槛应逐级读配置`);
        if (typeof c.affordable !== 'boolean') p.push(`${m0} Lv${lv} 应给出"当前资源够不够"（affordable 布尔）`);
      }
      // ★ 用**注入定义**证明"逐级读取"真的生效（不依赖真配置的数值调校；体例同 ⑪ / ⑰）
      const lvB = maxLv >= 2 ? Math.min(3, maxLv) : 0;
      if (!lvB) p.push('样本不足：需要等级上限 ≥ 2 的模块以核对逐级读取');
      else {
        const fake = {
          ...def0,
          blueprint: [],
          installCost: [{ level: 1, cost: { energy: 11 } }, { level: lvB, cost: { energy: 33 } }],
          removeCost: [{ level: 1, cost: { ore: 7 } }],
          upgradeCost: [], // ★ 显式清空 ⇒ 顺带核对"未配置即免费"的读法
          scienceCost: [],
        };
        const modOf = () => fake;
        const c1 = moduleCostAtIn(st, m0, 1, { moduleDefOf: modOf });
        const cB = moduleCostAtIn(st, m0, lvB, { moduleDefOf: modOf });
        if (!c1.ok || !jsonEq(c1.install, { energy: 11 })) p.push('Lv1 装配费应读 `installCost` 的 Lv1 条目（注入定义）');
        if (!cB.ok || !jsonEq(cB.install, { energy: 33 })) p.push(`Lv${lvB} 装配费应读该等级条目（注入定义）`);
        if (!cB.ok || !jsonEq(cB.remove, { ore: 7 })) p.push('未列出的等级应沿用上一项（`removeCost` 逐级表）');
        if (!c1.ok || !jsonEq(c1.upgrade, {}) || !jsonEq(c1.science, {})) p.push('未配置的 `upgradeCost` / `scienceCost` 应读成空（免费）');
      }
      // 非法入参：被拒（**不默认、不夹取**）
      if (moduleCostAtIn(st, 'noSuchModule', 1).reason.code !== 'unknownModule') p.push('未知模块应返回 unknownModule');
      if (moduleCostAtIn(st, m0, 0).reason.code !== 'badModuleLevel') p.push('等级 0 应返回 badModuleLevel');
      if (moduleCostAtIn(st, m0, maxLv + 1).reason.code !== 'badModuleLevel') p.push('等级超上限应返回 badModuleLevel');
      if (moduleCostAtIn(st, m0, 1.5).reason.code !== 'badModuleLevel') p.push('非整数等级应返回 badModuleLevel');
      if (moduleCostAtIn(st, m0, '1').reason.code !== 'badModuleLevel') p.push('字符串等级应返回 badModuleLevel');
    }
    add('㉗ 模块造价（该模块该等级）：装配 / 拆下 / 蓝图逐级读配置 + 与表格模块造价**同源** + 非法入参被拒', p);
  }

  // ㉘ 模块槽位编辑（二级弹窗：确认＝`set` 替换 / 添加＝`add` 追加 / 移除＝`remove` 删除）
  {
    const p = [];
    // ★ 本检查**不需要状态**（槽位编辑是纯函数：只读配置的范围、只动传入的模块数组）
    const mods = installableModuleIds();
    const m0 = mods[0];
    const m1 = mods[1] || mods[0];
    const def0 = m0 ? moduleDefOf(m0) : null;
    if (!def0) p.push('样本不足：需要 ≥1 个可装配模块');
    else {
      const maxLv = moduleMaxLevel(def0);
      const lv2 = Math.min(2, maxLv);
      const fake = { ...def0, blueprint: [] };
      const fakeModOf = () => fake;
      const src = [{ moduleId: m0, level: 1 }];
      const frozen = JSON.stringify(src);
      // set（＝确认）：替换该下标，长度 / 其余条目 / 顺序不变；**返回新数组**
      const rSet = applyModuleSlotIn(src, { action: 'set', index: 0, moduleId: m0, level: lv2 }, { moduleDefOf: fakeModOf });
      if (!rSet.ok) p.push(`set 应成功（现 ${rSet.reason.code}）`);
      else {
        if (rSet.index !== 0) p.push('set 应返回原下标');
        if (rSet.modules.length !== 1) p.push('set 不应改变条目数');
        if (rSet.modules[0].level !== lv2) p.push('set 应写入新等级');
        if (rSet.modules === src) p.push('set 必须返回**新数组**（不得原地改）');
      }
      // add（＝添加）：追加到末尾、**允许重复模块**；满槽位 ⇒ slotsFull
      const rAdd = applyModuleSlotIn(src, { action: 'add', moduleId: m0, level: 1, slots: 2 }, { moduleDefOf: fakeModOf });
      if (!rAdd.ok) p.push(`add 应成功（现 ${rAdd.reason.code}）`);
      else {
        if (rAdd.modules.length !== 2) p.push('add 应追加 1 条');
        if (rAdd.index !== 1) p.push('add 应返回新条目下标');
        if (rAdd.modules[0].moduleId !== m0 || rAdd.modules[1].moduleId !== m0) p.push('add 应保留既有条目且允许重复模块');
      }
      const rFull = applyModuleSlotIn(src, { action: 'add', moduleId: m0, level: 1, slots: 1 }, { moduleDefOf: fakeModOf });
      if (rFull.ok || rFull.reason.code !== 'slotsFull') p.push('满槽位的 add 应返回 slotsFull');
      // remove（＝移除）：删除该下标、其余条目顺序不变；无对应条目 ⇒ noTarget
      const src3 = [{ moduleId: m0, level: 1 }, { moduleId: m1, level: 1 }, { moduleId: m0, level: 1 }];
      const rRm = applyModuleSlotIn(src3, { action: 'remove', index: 1 }, { moduleDefOf: fakeModOf });
      if (!rRm.ok || rRm.modules.length !== 2) p.push('remove 应删除 1 条');
      else if (rRm.modules[0].moduleId !== m0 || rRm.modules[1].moduleId !== m0) p.push('remove 后其余条目应保持原顺序');
      if (applyModuleSlotIn(src3, { action: 'remove', index: 9 }).reason.code !== 'noTarget') p.push('越界 remove 应返回 noTarget');
      if (applyModuleSlotIn(src3, { action: 'set', index: -1, moduleId: m0, level: 1 }).reason.code !== 'noTarget') {
        p.push('无当前条目的 set 应返回 noTarget（＝"确认"在"新增"态禁用）');
      }
      // 非法动作 / 未知模块 / 越界或非整数等级（**不默认、不夹取**）
      if (applyModuleSlotIn(src3, { action: 'nope' }).reason.code !== 'badAction') p.push('未知动作应返回 badAction');
      if (applyModuleSlotIn(src3, { action: 'set', index: 0, moduleId: 'noSuch', level: 1 }).reason.code !== 'unknownModule') p.push('未知模块应返回 unknownModule');
      if (applyModuleSlotIn(src3, { action: 'add', moduleId: m0, level: maxLv + 1, slots: 9 }, { moduleDefOf: fakeModOf }).reason.code !== 'badModuleLevel') p.push('越界等级应返回 badModuleLevel');
      if (applyModuleSlotIn(src3, { action: 'add', moduleId: m0, level: 0, slots: 9 }, { moduleDefOf: fakeModOf }).reason.code !== 'badModuleLevel') p.push('等级 0 应返回 badModuleLevel');
      if (applyModuleSlotIn(src3, { action: 'add', moduleId: m0, level: '1', slots: 9 }, { moduleDefOf: fakeModOf }).reason.code !== 'badModuleLevel') p.push('非整数等级应被拒（不默认、不夹取）');
      // ★ **输入数组零改动**（纯函数）：任何调用（含失败）都不得改到调用方的草稿
      if (JSON.stringify(src) !== frozen || JSON.stringify(src3) !== JSON.stringify([{ moduleId: m0, level: 1 }, { moduleId: m1, level: 1 }, { moduleId: m0, level: 1 }])) {
        p.push('任何槽位操作都不得改动输入数组');
      }
      // 失败结果**不得携带 `modules`**（调用方据此"失败 ⇒ 零改动"，不会被误用）
      const failures = [
        applyModuleSlotIn(src3, { action: 'nope' }),
        applyModuleSlotIn(src3, { action: 'remove', index: 9 }),
        applyModuleSlotIn(src3, { action: 'add', moduleId: m0, level: 1, slots: 0 }, { moduleDefOf: fakeModOf }),
      ];
      for (const f of failures) if (f.ok || 'modules' in f) p.push('失败结果不得携带 modules（避免误用）');
      // 重复模块 + 各自等级 ⇒ `identityKey` 与 ㉑ 同口径（两条同模块不同等级是**两条**，不是一条）
      const a1 = applyModuleSlotIn([], { action: 'add', moduleId: m0, level: 1 }, { moduleDefOf: fakeModOf });
      const a2 = a1.ok ? applyModuleSlotIn(a1.modules, { action: 'add', moduleId: m0, level: lv2 }, { moduleDefOf: fakeModOf }) : a1;
      const want = [{ moduleId: m0, level: 1 }, { moduleId: m0, level: lv2 }];
      if (!a2.ok) p.push(`连续 add 应成功（现 ${a2.reason && a2.reason.code}）`);
      else if (identityKeyOf('combat', 1, a2.modules) !== identityKeyOf('combat', 1, want)) {
        p.push('重复模块各自等级应原样进入 identityKey（与 ㉑ 同口径）');
      }
    }
    add('㉘ 模块槽位编辑（确认＝set 替换 / 新增＝add 追加 / 移除＝remove 删除；越界与非法被拒、**输入数组零改动**）', p);
  }

  return { pass: checks.every((c) => c.pass), checks };
}

export default baseState;
