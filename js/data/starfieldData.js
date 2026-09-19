/* ===== data/starfieldData.js —— 星域数据层：聚合查看 + **只读自检**（步骤 A-2/A-3/A-4） =====
 * 定位（设计文档 §10 阶段 A）：A-2/A-3/A-4 三个注册表（星区类型 / NPC 列表 / 星域配置）落地后，
 *   本文件提供**唯一的校验口径**（纯函数、**只读、不改任何数据**）：
 *     · `selfCheck()`             ⇒ 全量自检（供控制台 `LS.starfieldData.selfCheck()`；返回 `{pass, checks[]}`）；
 *     · `validateStarfieldConfig(cfg)` ⇒ **单份星域配置**的引用/结构校验（返回问题字符串数组，空＝通过）
 *         —— 既被 `selfCheck()` 复用，也是**步骤 C-3「导入配置」的一致性校验**入口（同格式 ⇒ 同校验）；
 *     · `listStarfieldData()`     ⇒ 三个注册表的**只读清单摘要**（供控制台 `LS.starfieldData.list()`）。
 *
 * ★ 校验项（每条对应 `checks[]` 里一项；`detail` 给出前若干条问题）：
 *   ① 三个注册表可加载、每个定义非空且 **`id` 与键名一致**、**id 无重复**；
 *   ② 星区类型定义**结构完整**（`nameKey`＝`sectorType.<id>`、`kind`、`placement.mode`、`count` 区间、
 *      `mapColor` 为 CSS 变量名、`marker`、`content.*` 区间、**`npcListIds` 引用存在**）；
 *   ③ **星域配置引用存在性**：`sectorTypes` 键 / **`npcListIds`** / `sideRules.*` / **`playerUnits[]`**
 *      引用的类型、列表、船型与模块均存在；
 *   ④ **各 `count.min ≤ count.max`**（类型默认值 + 星域配置覆写，两者都查）；
 *   ⑤ **NPC 列表内 `shipId`/`moduleId` 均存在于既有注册表**，并额外核对：等级 ≤ 该船型/模块上限、
 *      **模块件数 ≤ 该等级槽位数**（避免生成时抛「模块槽位已满」）、**不引用 `picker:false`** 的内部/专属模块；
 *   ⑥ **可 JSON 往返**：三份星域配置 + 全部类型 + 全部 NPC 列表都满足 `JSON.parse(JSON.stringify(x))` 后
 *      **深度相等**（⇒ 无函数、无循环引用；导出文件与内置配置同格式：步骤 C-3 前置）；
 *   ⑦ **星门类型 `placement.edges` 恰为四个方位**（`top/right/bottom/left`）；其余 `mode:'edges'` 类型只需
 *      「非空且 ⊆ 四方位」；
 *   ⑧ 布局规则自洽：**`mode:'center'` 的类型恰有一个**（恒星星区＝中心）且其 `count {1,1}`；`ring` 的
 *      可选 `minRadius/maxRadius`（若给出）合法；
 *   ⑨ 星域配置**结构合法**：`radius ≥ 1`、`durationTicks > 0`、`seed` 为 null/字符串/数字、
 *      `sectorTypes` 非空且 **`star` 已启用且数量恰为 1**（中心恒星口径）、`sideRules`/`specialEffects` 结构在位；
 *   ⑨ **i18n 词条齐全**：全部 `nameKey` 在 `i18n.locales` 的**每个语言**字典中都存在（缺词条时 `t()` 会返回
 *      `??key`）；命名体例＝`sectorType.<id>` / `npcList.<id>` / `starfield.<id>`。
 *   ⑩ ★ **恰有一个填充类型**（`fill:true`）：生成器「剩余格位补位 ⇒ 星区总数恒 ＝ layout.cells」的结构前提
 *      （语义见 `data/sectorTypes/empty.js`；引擎**不硬编码类型 id**）。
 *   ⑪ ★ **NPC 列表数组形态**（新字段 `npcListIds: string[]`，兼容既有单值 `npcListId`）：
 *      类型定义与星域配置覆写的引用均存在（未知 id **报错、不静默吞掉**）；`normalizeNpcListIds` 的
 *      「去重 / 丢空项 / 单值 ⇒ 单元素数组 / `null`·`''`·缺省 ⇒ `[]`」形态契约。
 * ★ 本文件**不生成任何数据**（生成器＝步骤 A-5 `data/starfield.js`：配置 + 种子 ⇒ 星域初始状态）。
 *
 * ★★ **C-3b 内嵌自定义 NPC 列表**（用户口径：NPC 列表**必须可添加/编辑**，「**不限定必须使用文件列表**」）
 *   —— 星域配置**根层**新增可选字段 **`npcLists: { [id]: { nameKey? | name?, units[] } }`**：
 *   · **与内置 `data/npcLists/*` 的 `units[]` 完全同构** ⇒ 单位校验/展开**复用同一套函数**（本文件
 *     `unitsProblems` ＋ `data/starfield.js expandUnitSpecs`），**不写第二套规则**；
 *   · **id 规则**：内嵌列表 id **必须以 `custom:` 开头**（如 `custom:l1`）；校验中**显式检查**：
 *     非空、以 `custom:` 开头、**不得与内置 id 冲突**、**不得重复**；反向也查 ——
 *     **内置 id 不得带 `custom:` 前缀**（⇒ **报错而不是静默**）；
 *   · **解析顺序（唯一口径 `resolveNpcList`）**：`npcListIds` 每项 ⇒ ① 内置 `getNpcList(id)`
 *     → ② **本配置根层 `npcLists[id]`** → ③ 都没有 ⇒ **引用校验报错**（绝不静默吞掉）；
 *   · 生成器/容器**不需要新逻辑**：解析阶段把内嵌列表**注入同一份候选表**，`pickNpcListId` 照旧消费。
 */
import { i18n } from '../i18n/index.js';
import { getShip, resolveShipAtLevel, shipMaxLevel } from './ships/index.js';
import { MODULES } from './modules.js';
import { getCargo } from './cargos/index.js';
import { SECTOR_TYPES, SECTOR_TYPE_IDS, getSectorType } from './sectorTypes/index.js';
import { NPC_LISTS, NPC_LIST_IDS, getNpcList } from './npcLists/index.js';
import { STARFIELDS, STARFIELD_IDS } from './starfields/index.js';
import { moduleMaxLevel } from '../entities/module.js'; // 模块等级上限的唯一口径（数据层只读它，不另算）

/* ---------- 内部小工具（纯函数） ---------- */

const PLACEMENT_MODES = ['center', 'ring', 'edges'];
const EDGE_NAMES = ['top', 'right', 'bottom', 'left'];
const TYPE_KINDS = ['basic', 'special'];
const NPC_SIDES = ['enemy', 'ally'];
const MAX_DETAIL = 5; // detail 最多列几条问题（避免控制台刷屏）
/** ★ **内嵌自定义 NPC 列表**的 id 前缀（**唯一口径常量**；数据层/界面/控制台共用，不各写一份） */
export const CUSTOM_NPC_LIST_PREFIX = 'custom:';

/** 深度相等（纯函数；用于 JSON 往返比对） */
function deepEq(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEq(a[k], b[k]));
}

/** 该值能否 JSON 往返（无函数 / 无循环引用 / 无 undefined 丢失） */
function jsonRoundTripOk(v) {
  try {
    return deepEq(v, JSON.parse(JSON.stringify(v)));
  } catch {
    return false;
  }
}

/** 区间对象 `{min,max}`：整数、非负、min ≤ max */
function rangeOk(r) {
  return (
    !!r &&
    typeof r === 'object' &&
    Number.isInteger(r.min) &&
    Number.isInteger(r.max) &&
    r.min >= 0 &&
    r.min <= r.max
  );
}
const rs = (r) => (r && typeof r === 'object' ? `${r.min}~${r.max}` : String(r));
const head = (list) => (list.length > MAX_DETAIL ? `${list.slice(0, MAX_DETAIL).join('；')} …（共 ${list.length} 条）` : list.join('；'));

/* ---------- ★ NPC 列表字段的**归一**（唯一口径；生成器 / 校验 / 界面共用） ---------- */

/** ★ **NPC 列表引用归一为数组**（新字段 **`npcListIds: string[]`**；兼容既有单值 **`npcListId`**）：
 *  · `null` / `undefined` / `''` ⇒ `[]`（既有口径：**无单位**）；
 *  · **字符串** ⇒ `[v]`（兼容既有单值写法 ⇒ 单元素数组与原单值**等价**）；
 *  · **数组** ⇒ 逐项 `trim` 后**去重**、**丢弃空项/非字符串项**（保持原顺序）；
 *  · 其它类型 ⇒ `[]`；
 *  ★ **不静默吞掉未知 id**：本函数只做形态归一，**引用存在性**一律由 `validateStarfieldConfig` /
 *    `selfCheck` 报错（未知 id 会带着原样字符串报出来）。
 *  纯函数、**不修改入参**（返回新数组）。 */
export function normalizeNpcListIds(v) {
  const out = [];
  const take = (x) => {
    if (typeof x !== 'string') return;
    const s = x.trim();
    if (!s || out.includes(s)) return;
    out.push(s);
  };
  if (Array.isArray(v)) for (const x of v) take(x);
  else take(v);
  return out;
}

/** ★ 读某个**持有者**（星区类型定义 / 星域配置覆写）上的 NPC 列表引用：
 *  **`npcListIds`（数组）优先**，该键缺失时回退单值 `npcListId`；两者都缺 ⇒ `[]`。
 *  ★ 用 `hasOwnProperty` 判定“**显式写了**”——`npcListId: null` ＝ 明确「无单位」（覆写语义），
 *    与「没写 ⇒ 沿用类型默认值」严格区分（生成器 `effectiveType` 依赖这一点）。 */
export function readNpcListIds(holder) {
  if (!holder || typeof holder !== 'object') return [];
  if (Object.prototype.hasOwnProperty.call(holder, 'npcListIds')) return normalizeNpcListIds(holder.npcListIds);
  if (Object.prototype.hasOwnProperty.call(holder, 'npcListId')) return normalizeNpcListIds(holder.npcListId);
  return [];
}

/** 校验一个「NPC 列表引用字段」的**形态 + 引用存在性**（数组 / 兼容字符串；未知 id ⇒ 报错，不静默吞掉）
 *  @param {string} tag 问题前缀（如 `h1.planet`）
 *  @param {*} raw 引用字段原值（`npcListIds` 数组 / 兼容单值 `npcListId` 字符串 / null）
 *  @param {string} key 字段名（用于报错定位）
 *  @param {{ customLists?: object|null }} [opts] ★ C-3b：`customLists` ＝ **本配置根层的 `npcLists`**
 *    ⇒ 引用按 `resolveNpcList` 的**唯一解析顺序**判定（内置 → 内嵌 → 报错）。 */
function npcListIdsProblems(tag, raw, key, opts) {
  const p = [];
  const miss = (v) => p.push(`${tag}: 未知 NPC 列表 ${v}`);
  if (Array.isArray(raw)) {
    raw.forEach((v, i) => {
      if (typeof v !== 'string' || !v.trim()) p.push(`${tag}: ${key}[${i}] 应为非空字符串`);
      else if (!resolveNpcList(v.trim(), opts && opts.customLists)) miss(v);
    });
    if (normalizeNpcListIds(raw).length !== raw.length) p.push(`${tag}: ${key} 含重复项或空项（应去重且不含空项）`);
  } else if (typeof raw === 'string') {
    if (raw.trim() && !resolveNpcList(raw.trim(), opts && opts.customLists)) miss(raw);
  } else if (raw !== null && raw !== undefined) {
    p.push(`${tag}: ${key} 应为数组或字符串（现 ${typeof raw}）`);
  }
  return p;
}

/* ---------- ★★ C-3b **内嵌自定义 NPC 列表**（配置根层 `npcLists`）的唯一口径 ---------- */

/** ★ **NPC 列表解析的唯一入口**（C-3b 定稿口径；**内置优先 → 配置内嵌 → `null`**）：
 *  ① 内置注册表 `getNpcList(id)` 命中 ⇒ 返回它（**冲突时内置优先**：内嵌定义被忽略、由校验报错）；
 *  ② 否则取 `cfg.npcLists[id]`（内嵌自定义列表）⇒ 返回它；
 *  ③ 都没有 ⇒ **`null`**（**绝不静默吞掉**：引用校验会据此报「未知 NPC 列表」）。
 *  @param {string} id 列表 id（内置 id 或 `custom:*`）
 *  @param {object|null} [cfg] 星域配置（或只传 `cfg.npcLists` 对象本身）
 *  @returns {object|null} 列表定义（**只读；不复制、不改入参**）
 *  ★ 生成器与界面**一律走本函数**（不各自 `getNpcList` ⇒ 内嵌列表天然可用）。 */
export function resolveNpcList(id, cfg) {
  if (typeof id !== 'string' || !id) return null;
  const builtin = getNpcList(id);
  if (builtin) return builtin;
  const custom = getCustomNpcList(id, cfg);
  return custom || null;
}

/** ★ 取**本配置内嵌**的 `npcLists[id]`（**只看根层 `npcLists`，不回退内置**；未知 ⇒ `null`）：
 *  @param {string} id ；@param {object|null} [cfg] 星域配置，或直接传 `cfg.npcLists`
 *  @returns {object|null} —— 传 `{ id, npcLists }`（配置对象）或直接传 `npcLists` 映射两者都支持。 */
export function getCustomNpcList(id, cfg) {
  if (typeof id !== 'string' || !id || !cfg || typeof cfg !== 'object') return null;
  const map = cfg.npcLists && typeof cfg.npcLists === 'object' ? cfg.npcLists : cfg;
  const def = map[id];
  return def && typeof def === 'object' ? def : null;
}

/** ★ 本配置的**内嵌列表 id 清单**（按 `npcLists` 键的**原有顺序**；非对象 ⇒ `[]`） */
export function customNpcListIds(cfg) {
  const map = cfg && typeof cfg === 'object' && cfg.npcLists && typeof cfg.npcLists === 'object' ? cfg.npcLists : null;
  return map ? Object.keys(map) : [];
}

/** ★ 某 id 是否为**内嵌自定义列表 id**（**只判前缀**，不查存在性 ⇒ 校验「必须以 custom: 开头」用） */
export const isCustomNpcListId = (id) => typeof id === 'string' && id.startsWith(CUSTOM_NPC_LIST_PREFIX);

/** ★ 单个**内嵌列表**的结构校验（**单位部分复用 `unitsProblems` 同一口径**；问题形如 `npcLists[<id>]: …`）：
 *  · `id`：非空、**以 `custom:` 开头**、**不与内置 id 冲突**；
 *  · `units`：必须是数组（否则一条问题），逐条走 `unitsProblems`（船型/模块/等级/槽位/picker）；
 *  · `side`（可选）：`null` 或 `enemy`/`ally`；`nameKey`/`name`（可选）：非空字符串（**界面展示名**）；
 *  · `nameKey` 只在**写了**的时候要求非空 —— 内嵌列表**不强制** i18n 词条（可直接用 `name`，见 C-3b 口径）。 */
function customListProblems(id, list) {
  const p = [];
  if (!id || typeof id !== 'string') p.push('npcLists: 键名应为非空字符串');
  if (!isCustomNpcListId(id)) p.push(`npcLists[${id}]: 内嵌列表 id 必须以 ${CUSTOM_NPC_LIST_PREFIX} 开头（如 ${CUSTOM_NPC_LIST_PREFIX}l1）`);
  if (getNpcList(id)) p.push(`npcLists[${id}]: 与内置 NPC 列表 id 冲突（内置优先，请改名）`);
  if (!list || typeof list !== 'object' || Array.isArray(list)) {
    p.push(`npcLists[${id}]: 定义应为对象`);
    return p;
  }
  if (list.nameKey !== undefined && (typeof list.nameKey !== 'string' || !list.nameKey)) {
    p.push(`npcLists[${id}]: nameKey 应为非空字符串（可选；内嵌列表不强制 i18n 词条）`);
  }
  if (list.name !== undefined && (typeof list.name !== 'string' || !list.name)) {
    p.push(`npcLists[${id}]: name 应为非空字符串（可选）`);
  }
  if (list.side != null && !NPC_SIDES.includes(list.side)) p.push(`npcLists[${id}]: side 应为 null 或 ${NPC_SIDES.join('/')}`);
  if (!Array.isArray(list.units)) {
    p.push(`npcLists[${id}]: units 非数组`);
    return p;
  }
  p.push(...unitsProblems(`npcLists[${id}].units`, list.units)); // ★ 与内置列表**同一套单位校验**
  return p;
}

/** ★ 配置根层 **`npcLists`** 的整体校验（未写 ⇒ 无问题）：
 *  · 必须是对象（非数组）；键名 id **非空**、**以 `custom:` 开头**、**不与内置 id 冲突**、**不重复**；
 *  · 逐条走 `customListProblems`（单位/结构；**复用同一口径**）。
 *  @returns {string[]} 问题列表（空＝通过） */
function customListsProblems(npcLists) {
  const p = [];
  if (npcLists === undefined || npcLists === null) return p; // 未写 ⇒ 无内嵌列表（既有配置零影响）
  if (typeof npcLists !== 'object' || Array.isArray(npcLists)) return ['npcLists 应为对象（{ [id]: { units[] } }）'];
  // ★ 「id 不得重复」的**显式检查**：
  //   · 键名级别的重复（`{ 'a': x, 'a': y }`）在 JS 对象里**已被后写覆盖** ⇒ 无法恢复，
  //     故只能靠**界面侧的重命名校验**提前拦（`ui/starfieldConfigView.js` 的 `newListId/rename` 扫描避重）；
  //   · 下面的检查拦「**自引用键**」（`npcLists.npcLists` 指向 `npcLists` 自身）这类真能观测到的重复形态。
  for (const [id, def] of Object.entries(npcLists)) {
    if (getCustomNpcList(id, npcLists) === npcLists) p.push(`npcLists: 内嵌列表 id 重复（${id}）`);
    p.push(...customListProblems(id, def));
  }
  return p;
}

/* ---------- 单项校验（供 selfCheck 与 validateStarfieldConfig 共用） ---------- */

/** 单个注册表：定义非空、`id` 与键名一致、id 无重复 ⇒ 问题字符串数组 */
function registryProblems(map) {
  const p = [];
  const seen = new Map(); // id → 首个键名（查重复 id）
  for (const [key, def] of Object.entries(map)) {
    if (!def || typeof def !== 'object') {
      p.push(`${key}: 定义缺失或不是对象`);
      continue;
    }
    if (!def.id) p.push(`${key}: 缺 id`);
    else if (def.id !== key) p.push(`${key}: id(${def.id}) 与键名不一致`);
    if (def.id) {
      if (seen.has(def.id)) p.push(`id 重复：${def.id}（${seen.get(def.id)} / ${key}）`);
      else seen.set(def.id, key);
    }
  }
  return p;
}

/** 单个星区类型定义的结构校验 ⇒ 问题字符串数组 */
function sectorTypeProblems(id, def) {
  const p = [];
  if (def.nameKey !== `sectorType.${id}`) p.push(`${id}: nameKey 应为 sectorType.${id}（现 ${def.nameKey}）`);
  if (!TYPE_KINDS.includes(def.kind)) p.push(`${id}: kind 非法（${def.kind}）`);
  const pl = def.placement;
  if (!pl || !PLACEMENT_MODES.includes(pl.mode)) p.push(`${id}: placement.mode 非法（${pl && pl.mode}）`);
  else {
    if (pl.mode === 'edges') {
      const edges = Array.isArray(pl.edges) ? pl.edges : [];
      if (!edges.length) p.push(`${id}: mode:'edges' 必须给非空 edges`);
      else if (edges.some((e) => !EDGE_NAMES.includes(e))) p.push(`${id}: edges 含非法方位（${edges.join(',')}）`);
    }
    if (pl.mode === 'ring') {
      if (pl.minRadius != null && (!Number.isInteger(pl.minRadius) || pl.minRadius < 1)) p.push(`${id}: minRadius 非法`);
      if (pl.maxRadius != null && (!Number.isInteger(pl.maxRadius) || pl.maxRadius < 1)) p.push(`${id}: maxRadius 非法`);
      if (pl.minRadius != null && pl.maxRadius != null && pl.minRadius > pl.maxRadius) p.push(`${id}: minRadius > maxRadius`);
    }
  }
  if (!rangeOk(def.count)) p.push(`${id}: count 非法（${rs(def.count)}）`);
  const c = def.content;
  if (!c || typeof c !== 'object') p.push(`${id}: 缺 content`);
  else {
    if (!rangeOk(c.ore)) p.push(`${id}: content.ore 非法（${rs(c.ore)}）`);
    const cg = c.cargos;
    if (!cg || typeof cg !== 'object') p.push(`${id}: 缺 content.cargos`);
    else {
      if (typeof cg.enabled !== 'boolean') p.push(`${id}: content.cargos.enabled 非布尔`);
      if (!Array.isArray(cg.templates)) p.push(`${id}: content.cargos.templates 非数组`);
      else for (const t of cg.templates) if (!getCargo(t)) p.push(`${id}: 未知货物类型 ${t}`);
      if (!rangeOk(cg.count)) p.push(`${id}: content.cargos.count 非法（${rs(cg.count)}）`);
      if (!rangeOk(cg.tonsRange)) p.push(`${id}: content.cargos.tonsRange 非法（${rs(cg.tonsRange)}）`);
      if (!rangeOk(cg.levelRange)) p.push(`${id}: content.cargos.levelRange 非法（${rs(cg.levelRange)}）`);
    }
    if (!Array.isArray(c.structures)) p.push(`${id}: content.structures 非数组`);
  }
  if (def.npcListIds !== undefined && def.npcListId !== undefined) {
    p.push(`${id}: npcListIds 与 npcListId 不应并存（单一形态；以 npcListIds 为准）`);
  }
  if (def.npcListIds !== undefined) p.push(...npcListIdsProblems(id, def.npcListIds, 'npcListIds'));
  else if (def.npcListId !== undefined) p.push(...npcListIdsProblems(id, def.npcListId, 'npcListId'));
  if (def.specialEffect !== null && typeof def.specialEffect !== 'object') p.push(`${id}: specialEffect 应为 null 或对象`);
  // ★ 填充类型标记（**可选字段**）：写了就必须是布尔。语义＝「该类型是**剩余格位**的填充类型」
  //   （生成器在数量分配后把圆内空格位全补成它 ⇒ 星区总数恒 ＝ layout.cells；见 `data/starfield.js`）。
  //   **全仓唯一性**由 `selfCheck()` 的专项检查强制（不在此逐类型判重）。
  if (def.fill !== undefined && typeof def.fill !== 'boolean') p.push(`${id}: fill 应为布尔（true＝剩余格位填充类型）`);
  // ★ 贴图字段（**可选 · 预留**）：只允许 `null` 或**非空字符串路径** ⇒ 有值渲染贴图、为空回退「类型色 + marker」
  if (def.texture !== undefined && def.texture !== null && (typeof def.texture !== 'string' || !def.texture)) {
    p.push(`${id}: texture 应为 null 或非空字符串（贴图资源路径）`);
  }
  if (typeof def.mapColor !== 'string' || !def.mapColor.startsWith('--')) p.push(`${id}: mapColor 应为 CSS 变量名（--xxx）`);
  if (typeof def.marker !== 'string' || !def.marker) p.push(`${id}: marker 应为非空字符串`);
  return p;
}

/** ★ **单位条目数组**的校验（**唯一口径**，被 `npcListProblems` 与 `playerUnits` 共用）：
 *  `units[]` 每条＝一批同类单位 `{ shipId, count | countRange:[min,max], level?, modules?:[{moduleId,level?}] }`
 *  —— 校验**船型/模块存在性**、**等级 ≤ 该船型/模块上限**、**模块件数 ≤ 该等级槽位数**、**不引用 `picker:false`**。
 *  @param {string} tag 问题前缀（如 `patrolLight.units` / `h1.playerUnits`）；问题形如 `${tag}[i]: …`
 *  @returns {string[]} 问题列表（空＝通过） */
function unitsProblems(tag, units) {
  const p = [];
  units.forEach((u, i) => {
    const t = `${tag}[${i}]`;
    if (!u || typeof u !== 'object') {
      p.push(`${t}: 不是对象`);
      return;
    }
    const ship = getShip(u.shipId);
    if (!ship) {
      p.push(`${t}: 未知船型 ${u.shipId}`);
      return;
    }
    // 等级（缺省 1）
    const lv = Number.isFinite(u.level) ? Math.max(1, u.level | 0) : 1;
    const sMax = shipMaxLevel(ship);
    if (lv > sMax) p.push(`${t}: 等级 ${lv} 超出船型上限 ${sMax}`);
    // 数量：count 与 countRange 二选一（都可缺省 ⇒ 视为 1）
    if (u.count !== undefined && (!Number.isInteger(u.count) || u.count < 0)) p.push(`${t}: count 应为非负整数`);
    if (u.countRange !== undefined) {
      const r = Array.isArray(u.countRange) && u.countRange.length === 2 ? { min: u.countRange[0], max: u.countRange[1] } : null;
      if (!rangeOk(r)) p.push(`${t}: countRange 应为 [min,max] 且 min ≤ max`);
    }
    // 携带模块：存在性 + picker + 等级 + 槽位数
    const mods = u.modules === undefined ? [] : u.modules;
    if (!Array.isArray(mods)) {
      p.push(`${t}: modules 非数组`);
      return;
    }
    const slots = (resolveShipAtLevel(ship, lv) || {}).slots;
    if (Number.isFinite(slots) && mods.length > slots) {
      p.push(`${t}: 模块 ${mods.length} 件 > Lv${lv} 槽位 ${slots}（生成时会抛「模块槽位已满」）`);
    }
    mods.forEach((m, j) => {
      const mid = m && (m.moduleId ?? m.id);
      const mdef = mid ? MODULES[mid] : null;
      if (!mdef) {
        p.push(`${t}.modules[${j}]: 未知模块 ${mid}`);
        return;
      }
      if (mdef.picker === false) p.push(`${t}.modules[${j}]: 模块 ${mid} 为 picker:false（内部/专属，不可装配）`);
      if (Number.isFinite(m.level) && m.level > moduleMaxLevel(mdef)) {
        p.push(`${t}.modules[${j}]: 等级 ${m.level} 超出模块上限 ${moduleMaxLevel(mdef)}`);
      }
    });
  });
  return p;
}

/** 单个 NPC 列表的校验（引用存在性 + 等级/槽位/picker + 数量） ⇒ 问题字符串数组 */
function npcListProblems(id, list) {
  const p = [];
  if (list.nameKey !== `npcList.${id}`) p.push(`${id}: nameKey 应为 npcList.${id}（现 ${list.nameKey}）`);
  if (list.side != null && !NPC_SIDES.includes(list.side)) p.push(`${id}: side 占位应为 null 或 ${NPC_SIDES.join('/')}`);
  const units = list.units;
  if (!Array.isArray(units)) return [`${id}: units 非数组`];
  p.push(...unitsProblems(`${id}.units`, units));
  return p;
}

/** ★ **单份星域配置**的引用/结构校验（**C-3 导入校验入口**）：
 *  @returns {string[]} 问题列表（**空数组＝通过**）
 *  · 引用：`sectorTypes` 键、逐类型 **`npcListIds[]`**（兼容单值 `npcListId`）覆写、
 *    **`playerUnits[]`**（船型/模块/等级/槽位）、`sideRules.playerEntryTypeId` /
 *    `allyNpcListIds[]` / `neutralSectorTypeIds[]` 必须都存在；
 *  · ★ C-3b：**内嵌自定义列表** `cfg.npcLists`（结构 + id 前缀/冲突）一并校验，且
 *    类型覆写与 `sideRules.allyNpcListIds` 的引用按 `resolveNpcList`（**内置 → 内嵌 → 报错**）判定；
 *  · 结构：`radius ≥ 1`、`durationTicks > 0`、`seed`＝null/字符串/数字、`sectorTypes` 非空、
 *    **`star` 类型必须启用且数量恰为 1**（中心恒星口径）、`sideRules`/`specialEffects` 结构在位、
 *    逐类型覆写的 `count` 区间合法。 */
export function validateStarfieldConfig(cfg) {
  const p = [];
  if (!cfg || typeof cfg !== 'object') return ['配置不是对象'];
  const sid = cfg.id || '(无 id)';
  if (cfg.nameKey !== `starfield.${sid}`) p.push(`${sid}: nameKey 应为 starfield.${sid}（现 ${cfg.nameKey}）`);
  if (!Number.isInteger(cfg.radius) || cfg.radius < 1) p.push(`${sid}: radius 应为 ≥1 的整数（现 ${cfg.radius}）`);
  if (!Number.isInteger(cfg.durationTicks) || cfg.durationTicks <= 0) p.push(`${sid}: durationTicks 应为 >0 的整数`);
  const seedKind = cfg.seed === null || typeof cfg.seed === 'string' || typeof cfg.seed === 'number';
  if (!seedKind) p.push(`${sid}: seed 应为 null / 字符串 / 数字`);

  /* ★★ C-3b **内嵌自定义 NPC 列表**（配置根层 `npcLists`；未写 ⇒ 无内嵌列表、零影响）：
   *   · 结构 + id 前缀/冲突/重复 ⇒ `customListsProblems`（单位部分复用 `unitsProblems`）；
   *   · 之后的**引用解析**一律带 `{ customLists: cfg.npcLists }` ⇒ 内嵌列表可被引用，未知 id 仍报错。 */
  p.push(...customListsProblems(cfg.npcLists));
  const refOpts = { customLists: cfg.npcLists };

  // ★ **玩家单位列表**（我方初始编队；与 NPC 列表 `units[]` **同构**、走**同一套单位校验**）：
  //   `playerUnits: [{ shipId, count | countRange:[min,max], level?, modules?:[{moduleId,level?}] }]`
  if (cfg.playerUnits !== undefined && cfg.playerUnits !== null) {
    if (!Array.isArray(cfg.playerUnits)) p.push(`${sid}: playerUnits 应为数组（单位条目列表）`);
    else p.push(...unitsProblems(`${sid}.playerUnits`, cfg.playerUnits));
  }

  const st = cfg.sectorTypes;
  if (!st || typeof st !== 'object' || !Object.keys(st).length) {
    p.push(`${sid}: sectorTypes 缺失或为空`);
  } else {
    for (const [tid, ov] of Object.entries(st)) {
      if (!getSectorType(tid)) {
        p.push(`${sid}: 未知星区类型 ${tid}`);
        continue;
      }
      if (!ov || typeof ov !== 'object') {
        p.push(`${sid}.${tid}: 覆写不是对象`);
        continue;
      }
      if (ov.count !== undefined && !rangeOk(ov.count)) p.push(`${sid}.${tid}: count 非法（${rs(ov.count)}）`);
      // ★ NPC 列表覆写：**数组形态 `npcListIds[]` 优先**，兼容既有单值 `npcListId`（并存 ⇒ 报错，避免两套口径）
      //   ★ C-3b：引用解析带**本配置的内嵌列表**（内置 → 内嵌 → 报错）
      if (ov.npcListIds !== undefined && ov.npcListId !== undefined) {
        p.push(`${sid}.${tid}: npcListIds 与 npcListId 不应并存（单一形态；以 npcListIds 为准）`);
      }
      if (ov.npcListIds !== undefined) p.push(...npcListIdsProblems(`${sid}.${tid}`, ov.npcListIds, 'npcListIds', refOpts));
      else if (ov.npcListId !== undefined) p.push(...npcListIdsProblems(`${sid}.${tid}`, ov.npcListId, 'npcListId', refOpts));
    }
    // 中心恒星（口径）：**只校验配置里显式覆写的部分**（未写＝沿用类型默认 `{enabled:true,count:{1,1}}`）
    if (st.star !== undefined) {
      const starOv = st.star || {};
      if (starOv.enabled === false) p.push(`${sid}: star（中心恒星）必须启用`);
      if (starOv.count !== undefined && (starOv.count.min !== 1 || starOv.count.max !== 1)) {
        p.push(`${sid}: star.count 覆写应为 {min:1,max:1}（中心恒星口径）`);
      }
    }
  }

  const sr = cfg.sideRules;
  if (!sr || typeof sr !== 'object') p.push(`${sid}: sideRules 缺失`);
  else {
    if (sr.playerEntryTypeId != null && !getSectorType(sr.playerEntryTypeId)) {
      p.push(`${sid}: sideRules.playerEntryTypeId 未知类型 ${sr.playerEntryTypeId}`);
    }
    if (sr.npcSide != null && !NPC_SIDES.includes(sr.npcSide)) p.push(`${sid}: sideRules.npcSide 非法（${sr.npcSide}）`);
    for (const k of ['allyNpcListIds', 'neutralSectorTypeIds']) {
      if (sr[k] === undefined) continue;
      if (!Array.isArray(sr[k])) {
        p.push(`${sid}: sideRules.${k} 应为数组`);
        continue;
      }
      for (const ref of sr[k]) {
        // ★ C-3b：`allyNpcListIds` 与类型覆写**同一解析口径**（内置 → 本配置内嵌 `npcLists` → 报错）
        const ok = k === 'allyNpcListIds' ? !!resolveNpcList(ref, refOpts.customLists) : !!getSectorType(ref);
        if (!ok) p.push(`${sid}: sideRules.${k} 引用不存在：${ref}`);
      }
    }
  }
  if (!Array.isArray(cfg.specialEffects)) p.push(`${sid}: specialEffects 应为数组（占位，可为空）`);
  return p;
}

/* ---------- 对外：全量自检 / 只读清单 ---------- */

/** ★ **全量自检**（只读；控制台 `LS.starfieldData.selfCheck()`）
 *  @returns {{ pass: boolean, checks: { name: string, pass: boolean, detail: string }[] }} */
export function selfCheck() {
  const checks = [];
  const add = (name, problems) => {
    const list = Array.isArray(problems) ? problems.filter(Boolean) : problems ? [String(problems)] : [];
    checks.push({ name, pass: list.length === 0, detail: list.length ? head(list) : 'ok' });
  };

  // ① 三个注册表：可加载 + id 与键名一致 + id 无重复
  add('① 注册表加载与 id 唯一（星区类型）', registryProblems(SECTOR_TYPES));
  add('① 注册表加载与 id 唯一（NPC 列表）', registryProblems(NPC_LISTS));
  add('① 注册表加载与 id 唯一（星域配置）', registryProblems(STARFIELDS));

  // ② 星区类型定义结构完整（含 content / mapColor / marker / npcListId 引用）
  {
    const p = [];
    for (const id of SECTOR_TYPE_IDS) p.push(...sectorTypeProblems(id, SECTOR_TYPES[id]));
    add('② 星区类型定义结构完整', p);
  }

  // ③ 星域配置引用存在性 + 结构合法（与 C-3 导入校验同一函数）
  {
    const p = [];
    for (const id of STARFIELD_IDS) p.push(...validateStarfieldConfig(STARFIELDS[id]));
    add('③ 星域配置引用存在性 + 结构合法', p);
  }

  // ④ 各 count.min ≤ count.max（类型默认值 + 星域配置覆写）
  {
    const p = [];
    for (const id of SECTOR_TYPE_IDS) {
      const r = SECTOR_TYPES[id].count;
      if (!rangeOk(r)) p.push(`类型 ${id}: ${rs(r)}`);
    }
    for (const sid of STARFIELD_IDS) {
      for (const [tid, ov] of Object.entries(STARFIELDS[sid].sectorTypes || {})) {
        if (ov && ov.count !== undefined && !rangeOk(ov.count)) p.push(`星域 ${sid}.${tid}: ${rs(ov.count)}`);
      }
    }
    add('④ count.min ≤ count.max（默认值 + 覆写）', p);
  }

  // ⑤ NPC 列表：shipId/moduleId 存在 + 等级/槽位/picker 复核
  //   ★ C-3b：**内置 id 不得带 `custom:` 前缀**（该前缀保留给「配置内嵌自定义列表」⇒ 冲突时**报错而非静默**）
  {
    const p = [];
    for (const id of NPC_LIST_IDS) {
      p.push(...npcListProblems(id, NPC_LISTS[id]));
      if (isCustomNpcListId(id)) p.push(`内置 NPC 列表 id ${id} 不得带 ${CUSTOM_NPC_LIST_PREFIX} 前缀（保留给配置内嵌列表）`);
    }
    add('⑤ NPC 列表引用与可装配性（存在性/等级/槽位/picker）', p);
  }

  // ⑥ JSON 往返（无函数、无循环引用）⇒ 导出文件与内置配置同格式
  {
    const p = [];
    for (const id of SECTOR_TYPE_IDS) if (!jsonRoundTripOk(SECTOR_TYPES[id])) p.push(`sectorTypes/${id}`);
    for (const id of NPC_LIST_IDS) if (!jsonRoundTripOk(NPC_LISTS[id])) p.push(`npcLists/${id}`);
    for (const id of STARFIELD_IDS) if (!jsonRoundTripOk(STARFIELDS[id])) p.push(`starfields/${id}`);
    add('⑥ 可 JSON 往返（无函数 / 无循环引用）', p);
  }

  // ⑦ 星门（特殊类型 · edges 模式）：edges 恰为四个方位
  {
    const p = [];
    const gate = getSectorType('stargate');
    const edges = gate && gate.placement && Array.isArray(gate.placement.edges) ? [...gate.placement.edges].sort() : [];
    const want = [...EDGE_NAMES].sort();
    if (JSON.stringify(edges) !== JSON.stringify(want)) {
      p.push(`stargate.placement.edges 应为四方位 ${want.join('/')}（现 ${edges.join('/') || '无'}）`);
    }
    for (const id of SECTOR_TYPE_IDS) {
      const pl = SECTOR_TYPES[id].placement;
      if (pl && pl.mode === 'edges' && (!Array.isArray(pl.edges) || !pl.edges.length)) p.push(`${id}: edges 为空`);
    }
    add('⑦ 星门 edges 恰为四方位', p);
  }

  // ⑧ 布局规则自洽：center 恰有一个且 count {1,1}
  {
    const p = [];
    const centers = SECTOR_TYPE_IDS.filter((id) => SECTOR_TYPES[id].placement && SECTOR_TYPES[id].placement.mode === 'center');
    if (centers.length !== 1) p.push(`mode:'center' 的类型应恰有 1 个（现 ${centers.length}：${centers.join('/') || '无'}）`);
    for (const id of centers) {
      const r = SECTOR_TYPES[id].count;
      if (!r || r.min !== 1 || r.max !== 1) p.push(`中心类型 ${id} 的 count 应为 {min:1,max:1}（现 ${rs(r)}）`);
    }
    add('⑧ 布局：中心唯一（center 恰一个 · 数量 1）', p);
  }

  // ⑨ i18n 词条齐全（每个语言字典都要有）＋ 命名体例
  {
    const p = [];
    const need = [];
    for (const id of SECTOR_TYPE_IDS) need.push([`sectorType.${id}`, SECTOR_TYPES[id].nameKey]);
    for (const id of NPC_LIST_IDS) need.push([`npcList.${id}`, NPC_LISTS[id].nameKey]);
    for (const id of STARFIELD_IDS) need.push([`starfield.${id}`, STARFIELDS[id].nameKey]);
    for (const [expect, actual] of need) if (actual !== expect) p.push(`${expect}: nameKey 体例不符（${actual}）`);
    for (const [, key] of need) {
      if (!key) continue;
      for (const loc of i18n.locales) if (!i18n.has(key, loc)) p.push(`缺词条 ${key}@${loc}`);
    }
    add('⑨ i18n 词条齐全（zh/en 成对 + 命名体例）', p);
  }

  // ⑩ ★ **恰有一个填充类型**（`fill:true`）——生成器补位口径的结构前提（见 `data/starfield.js` ④ 补位段）
  {
    const p = [];
    const fills = SECTOR_TYPE_IDS.filter((id) => SECTOR_TYPES[id].fill === true);
    if (fills.length !== 1) p.push(`fill:true 的类型应恰有 1 个（现 ${fills.length}：${fills.join('/') || '无'}）`);
    add('⑩ 恰有一个填充类型（fill:true）', p);
  }

  // ⑪ ★ **NPC 列表数组形态**（新字段 `npcListIds: string[]`，兼容既有单值 `npcListId`）：
  //    · 类型定义 + 星域配置覆写的引用**均存在**（未知 id 报错、不静默吞掉）；
  //    · **归一幂等/去重/丢空**：`normalizeNpcListIds` 的形态契约；
  //    · **单元素数组 ≡ 原单值**（`readNpcListIds` 归一后逐元素相同 ⇒「单值 ⇒ 单元素数组」口径）；
  //    · `null` / `''` / 缺省 ⇒ `[]`（＝无单位）。
  {
    const p = [];
    for (const id of SECTOR_TYPE_IDS) {
      const def = SECTOR_TYPES[id];
      if (def.npcListIds !== undefined && def.npcListId !== undefined) p.push(`${id}: npcListIds 与 npcListId 并存`);
      if (def.npcListIds !== undefined) p.push(...npcListIdsProblems(id, def.npcListIds, 'npcListIds'));
      else if (def.npcListId !== undefined) p.push(...npcListIdsProblems(id, def.npcListId, 'npcListId'));
    }
    for (const sid of STARFIELD_IDS) {
      // ★ C-3b：配置侧引用（类型覆写 / 友方援军列表）按**内置 → 本配置内嵌 `npcLists` → 报错**解析
      const cf = STARFIELDS[sid];
      const refOpts = { customLists: cf.npcLists };
      for (const [tid, ov] of Object.entries(cf.sectorTypes || {})) {
        if (!ov || typeof ov !== 'object') continue;
        if (ov.npcListIds !== undefined && ov.npcListId !== undefined) p.push(`${sid}.${tid}: npcListIds 与 npcListId 并存`);
        if (ov.npcListIds !== undefined) p.push(...npcListIdsProblems(`${sid}.${tid}`, ov.npcListIds, 'npcListIds', refOpts));
        else if (ov.npcListId !== undefined) p.push(...npcListIdsProblems(`${sid}.${tid}`, ov.npcListId, 'npcListId', refOpts));
      }
      for (const ref of (cf.sideRules && cf.sideRules.allyNpcListIds) || []) {
        if (!resolveNpcList(ref, cf.npcLists)) p.push(`${sid}: sideRules.allyNpcListIds 引用不存在：${ref}`);
      }
    }
    // 归一契约（纯函数断言）
    if (JSON.stringify(normalizeNpcListIds(['b', 'a', 'b', '', null, 'a', 3])) !== JSON.stringify(['b', 'a'])) {
      p.push('normalizeNpcListIds 未按「去重 + 丢弃空项/非字符串」归一');
    }
    if (JSON.stringify(readNpcListIds({ npcListId: 'patrolLight' })) !== JSON.stringify(['patrolLight'])) {
      p.push('单值 npcListId 未归一为单元素数组');
    }
    if (JSON.stringify(readNpcListIds({ npcListIds: ['patrolLight', 'patrolLight'] })) !== JSON.stringify(['patrolLight'])) {
      p.push('数组形态未去重');
    }
    if (readNpcListIds({ npcListId: null }).length !== 0 || readNpcListIds({ npcListIds: [] }).length !== 0 || readNpcListIds({}).length !== 0) {
      p.push('null / 空数组 / 缺省应归一为 []（无单位）');
    }
    add('⑪ NPC 列表数组形态（归一/去重/引用；兼容单值 npcListId）', p);
  }

  // ⑫ ★★ **C-3b 内嵌自定义 NPC 列表**（配置根层 `npcLists`）：前缀/冲突/解析顺序/引用报错/同构单位 ——
  //   (a) `custom:` 前缀**与内置 id 冲突**时**拒绝**（内嵌侧 + 内置侧**两个方向都拦**）；
  //   (b) 内嵌列表**参与解析**：无冲突的 `custom:*` id 被 `resolveNpcList` 解析到；
  //   (c) **内置优先**：同名冲突时 `resolveNpcList` 返回**内置定义**（内嵌定义被忽略、由 (a) 报错）；
  //   (d) **引用不存在时确实报错**（少了内嵌列表定义 ⇒ `validateStarfieldConfig` 非空）；
  //   (e) 内嵌列表的 **units 校验走同一套** `unitsProblems`（未知船型 ⇒ 报错、不静默）。
  {
    const p = [];
    const BASE = STARFIELD_IDS[0];
    const baseCfg = STARFIELDS[BASE];
    const firstTypeId = Object.keys(baseCfg.sectorTypes || {})[0] || null;
    // (a) 内嵌侧前缀冲突（键名用了内置 id，却写在内嵌列表里 ⇒ 冲突）
    const clash = JSON.parse(JSON.stringify(baseCfg));
    clash.npcLists = { patrolLight: { name: 'x', units: [] } };
    if (!validateStarfieldConfig(clash).some((m) => m.includes('与内置 NPC 列表 id 冲突'))) {
      p.push('内嵌列表用内置 id 当键名未被拒（应与内置 id 冲突报错）');
    }
    // (a') **非 `custom:` 前缀的内嵌 id 必须被拒**（哪怕该 id 与内置不冲突）
    const noPfx = JSON.parse(JSON.stringify(baseCfg));
    noPfx.npcLists = { 'l1': { name: 'x', units: [] } };
    if (!validateStarfieldConfig(noPfx).some((m) => m.includes(`必须以 ${CUSTOM_NPC_LIST_PREFIX} 开头`))) {
      p.push(`内嵌列表 id 未以 ${CUSTOM_NPC_LIST_PREFIX} 开头却被通过（应报错）`);
    }
    // (a'') 内置侧不得带 custom: 前缀
    if (!NPC_LIST_IDS.every((id) => !isCustomNpcListId(id))) p.push(`内置 NPC 列表 id 带了 ${CUSTOM_NPC_LIST_PREFIX} 前缀`);
    // (b)(d) 内嵌列表参与解析 + 缺定义时报错（拿一个本档真实存在的类型做起因）
    if (firstTypeId) {
      const good = JSON.parse(JSON.stringify(baseCfg));
      good.npcLists = { 'custom:l1': { name: '内嵌', units: [{ shipId: 'combat', count: 1, level: 1, modules: [] }] } };
      good.sectorTypes[firstTypeId] = { ...(good.sectorTypes[firstTypeId] || {}), npcListIds: ['custom:l1'] };
      delete good.sectorTypes[firstTypeId].npcListId;
      const goodProblems = validateStarfieldConfig(good);
      if (goodProblems.length) p.push(`内嵌列表被引用仍报错：${goodProblems.slice(0, 2).join('；')}`);
      if (!resolveNpcList('custom:l1', good.npcLists)) p.push('内嵌列表未被 resolveNpcList 解析到');
      const miss = JSON.parse(JSON.stringify(baseCfg));
      miss.sectorTypes[firstTypeId] = { ...(miss.sectorTypes[firstTypeId] || {}), npcListIds: ['custom:missing'] };
      delete miss.sectorTypes[firstTypeId].npcListId;
      if (!validateStarfieldConfig(miss).length) p.push('引用了不存在（且未内嵌）的列表却未报错');
    }
    // (c) 内置优先（同名冲突 ⇒ 解析到内置定义，而非内嵌定义）
    const fakeCustom = { name: '假内嵌', units: [] };
    if (NPC_LIST_IDS.length && resolveNpcList(NPC_LIST_IDS[0], { npcLists: { [NPC_LIST_IDS[0]]: fakeCustom } }) !== NPC_LISTS[NPC_LIST_IDS[0]]) {
      p.push('同名冲突时应由内置列表优先（现解析到了内嵌定义）');
    }
    // (e) 内嵌列表的 units 走同一套校验（未知船型 ⇒ 报错）
    if (firstTypeId) {
      const bad = JSON.parse(JSON.stringify(baseCfg));
      bad.npcLists = { 'custom:l1': { name: '坏', units: [{ shipId: 'noSuchShip', count: 1 }] } };
      bad.sectorTypes[firstTypeId] = { ...(bad.sectorTypes[firstTypeId] || {}), npcListIds: ['custom:l1'] };
      delete bad.sectorTypes[firstTypeId].npcListId;
      if (!validateStarfieldConfig(bad).some((m) => m.includes('未知船型'))) p.push('内嵌列表 units 未走同一套单位校验（未知船型未报错）');
    }
    add('⑫ C-3b 内嵌自定义 NPC 列表（custom: 前缀 / 内置优先 / 引用报错 / 同构单位校验）', p);
  }

  return { pass: checks.every((c) => c.pass), checks };
}

/** 只读清单摘要（控制台 `LS.starfieldData.list()`；**纯数据、可直接 JSON 打印**） */
export function listStarfieldData() {
  return {
    sectorTypes: SECTOR_TYPE_IDS.map((id) => {
      const d = SECTOR_TYPES[id];
      const npcListIds = readNpcListIds(d); // ★ 统一按**数组**口径呈现（兼容单值 `npcListId`）
      return {
        id,
        kind: d.kind,
        mode: d.placement && d.placement.mode,
        count: rs(d.count),
        npcListIds,
        npcListId: npcListIds[0] || null, // 兼容既有只读字段（＝候选集合首项），新代码请用 `npcListIds`
        marker: d.marker,
        fill: d.fill === true,
      };
    }),
    npcLists: NPC_LIST_IDS.map((id) => {
      const d = NPC_LISTS[id];
      return {
        id,
        units: (d.units || []).map((u) => ({
          shipId: u.shipId,
          count: u.count !== undefined ? u.count : `[${u.countRange ? u.countRange.join('-') : '1'}]`,
          modules: (u.modules || []).length,
        })),
      };
    }),
    starfields: STARFIELD_IDS.map((id) => {
      const d = STARFIELDS[id];
      return {
        id,
        radius: d.radius,
        durationTicks: d.durationTicks,
        seed: d.seed,
        types: Object.keys(d.sectorTypes || {}),
        // ★ 玩家单位列表（我方初始编队）条目数 + 入场星区类型引用（只读摘要，便于控制台核对）
        playerUnits: Array.isArray(d.playerUnits) ? d.playerUnits.length : 0,
        playerEntryTypeId: (d.sideRules && d.sideRules.playerEntryTypeId) || null,
        // ★ C-3b：**内嵌自定义 NPC 列表** id 清单（只读摘要；未写 ⇒ `[]`）
        customNpcListIds: customNpcListIds(d),
      };
    }),
  };
}

/* ---------- ★ 只读访问器**再导出**（数据层门面 ⇒ 控制台 `LS.starfieldData.*` 与本文件导出一一对应） ----------
 * 为什么在此再导出：控制台需要“与数据层导出一致”的可读访问器
 * （如 `LS.starfieldData.getStarfield('h1')` / `getSectorType('stargate')` / `getNpcList('patrolLight')`
 *  / `STARFIELD_IDS` / `SECTOR_TYPE_IDS` / `NPC_LIST_IDS`），而本文件原本只导出自检与摘要
 * ⇒ 在此把三个注册表的**查表函数、id 清单、注册表本体**按**同名**再导出（与 `LS.rng` 的体例一致）。
 * ★ **只读、不改数据**：定义与唯一口径仍在各自注册表的 `index.js`，此处仅为控制台门面。 */
export { getSectorType, SECTOR_TYPE_IDS, SECTOR_TYPES } from './sectorTypes/index.js';
export { getNpcList, NPC_LIST_IDS, NPC_LISTS } from './npcLists/index.js';
export { getStarfield, STARFIELD_IDS, STARFIELDS } from './starfields/index.js';
