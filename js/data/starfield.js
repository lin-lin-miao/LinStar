/* ===== data/starfield.js —— ★ 星域生成器（步骤 A-5）：**纯函数**「配置 + 种子 ⇒ 星域初始状态」 =====
 * 设计依据：`战场大地图(星域)说明.md` §4「星域初始化（配置 + 可预测随机性）」、§5「布局生成（方形网格 · 近似圆）」。
 *
 * ★ 铁律与保证：
 *   1. **纯函数**：无 UI/tick 依赖、**不修改入参**（只读 config）；同「配置 + 种子」⇒ 结果**逐位相同**
 *      （`JSON.stringify` 相等），可直接用于 C-3 预览/导出与存档对拍；
 *   2. **唯一随机源**＝`core/rng.js` 的 `createRng(seed)`：**本文件不调用 `Math.random()`/`randomSeed()`**
 *      （默认随机种子只属「星域配置界面」那一步）——`seed` 缺省取 `config.seed`，两者都缺 ⇒ **抛错**；
 *   3. **分区随机（fork）**：星域级各流互不干扰 ——
 *        `root = createRng(seed)`；**每个类型**一条 `root.fork('count:' + typeId)`＝该类型抽到的数量；
 *        `root.fork('layout')`＝格位分配（方位挑选 / 圆内格洗牌）；
 *        **每个星区** `root.fork('sector:' + index)`＝该区内容（矿物/货物/NPC 数量）。
 *      ⇒ 改某类型的数量区间**不影响其它类型抽到的数量**；改某类型的内容（如 `npcListIds`）
 *        **完全不影响其它星区**（版图与内容都逐字节一致，见自检第 ⑧ 项）；
 *        ⚠ 唯一共享处＝**格位池**：某类型数量变化会改变其后圆内类型**占用哪些格**（版图口径使然，非随机泄漏）。
 *   4. **不硬编码类型 id**：一切由字段驱动 —— 位置规则读 `placement`（`center`/`ring`/`edges`）、
 *      数量读 `count{min,max}`（星域配置覆写优先）、内容读 `content`、单位读 `npcListIds`
 *      （**候选 NPC 列表集合**，按种子在该星区子流里抽一个；兼容单值 `npcListId`）；
 *   4b. ★ **C-3b 内嵌自定义列表**：候选集合里的 id 经 **`resolveNpcList(id, cfg)`** 解析
 *      （**内置 `data/npcLists/*` 优先 → 本配置根层 `npcLists` → 未命中 ⇒ 空数组 + 校验报错**）
 *      ⇒ 内嵌列表**天然可用**，**不改抽样顺序、不改 `fork` 子流用法**（同种子结果与改造前一致，
 *      除非该配置确实引用了内嵌列表）；
 *   5. **数值一律占位预填**（全部来自 `data/sectorTypes/` 与 `data/starfields/`，本文件不含数值常量）。
 *
 * ★ 布局（§5）：方网格 `(q,r)`，**到中心欧氏距离 ≤ `radius`** 的格＝星区 ⇒ 近似圆形；
 *   **固定扫描顺序＝先 r 后 q**（`r` 从小到大、同一行内 `q` 从小到大）⇒ `index` ＝该顺序下的下标（**0 起**）；
 *   中心格 `(0,0)` 恒由 `placement.mode:'center'` 的类型（恒星星区）占用。
 *
 * ★ 分配顺序（**确定、可复现**，分三段；段内按注册表固定顺序 `SECTOR_TYPE_IDS`）：
 *    ① **center** 段：占用中心格（容量 1）；② **edges** 段：占用**最上/最下/最左/最右**四条外缘
 *    （圆形布局下每个方位的极值行/列**恰含 1 格** ⇒ 一个方位＝一格；由种子随机挑选方位）；
 *    ③ **ring** 段：占用其余圆内格（可受可选 `minRadius/maxRadius` 约束；格池由种子洗牌后顺序发放）；
 *    ④ ★ **补位段（用户口径：圆内格位没被任何类型占到 ⇒ 补为空区，格子恒满）**：三段分配完成后，
 *      圆内**剩余空格位**全部补为**唯一带 `fill:true` 标记**的类型（见 `data/sectorTypes/<id>.js`；
 *      **不硬编码类型 id**）⇒ **星区总数恒 ＝ `layout.cells`**；补位**不消耗随机**、**只占空格位**
 *      （不挤占既有类型）、**不产生截断告警**（另记非错误信息 `sectorCellsFilled`）。
 *    ★ 先放“受约束者”再放“任意格”是**布局合法性**的要求（否则任意格可能吃掉唯一的中心/方位格）。
 *
 * ★ **兜底口径（本轮定稿）**：某类型**实得格数 < 请求数**（容量不足）⇒ **不抛错、不静默**：
 *   按上面的固定顺序**截断**，并在结果 `warnings` 追加
 *   `{ code:'sectorCountTruncated', typeId, requested, placed }`
 *   （与既有 `normalizeFormation`/`normalizeSector` 的 warnings 体例一致：**结构化、可编程消费**）。
 *   注：截断后该类型数量可能低于 `count.min`（容量不足所致），由 warning 明示。
 *   ★ **补位不算截断**：`fill:true` 类型的最终数量 ＝ 区间抽数 ＋ 补位数（可高于 `count.max`，属设计口径），
 *     补位只记 `{ code:'sectorCellsFilled', typeId, filled }`；该类型仍可能因**容量不足**被截断
 *     （＝它“显式”要的格数都放不下，此时 `filled` 为 0）。
 *
 * ★ 逐星区内容（**只能来自该星区子流** `fork('sector:'+index)`）：
 *   · **矿物**：`content.ore{min,max}` 取值（空区可为 0）；
 *   · **星球(货物)**：`content.cargos{enabled,templates,count,tonsRange,levelRange}` 展开为货物**实例数组**，
 *     实例结构与 `systems/battle.js normalizeSectorCargos` 的产物**同形**（`id/templateId/nameKey/name/type/
 *     colorKey/tons/loadTicks/level/bonus/enhanced/manualUnloadedSide/manualUnloadedUntil`），
 *     类型与等级走既有唯一口径 `getCargo` + `resolveCargoAtLevel`；`templates` 为空 ⇒ 从**全部已登记货物类型**
 *     中抽取（**排除兜底类型** `CARGO_DEFAULTS.templateId`，即「无」不参与随机生成）；
 *   · **单位**：按 **`npcListIds`（候选 NPC 列表集合；星域配置可覆写，兼容单值 `npcListId`）**
 *     先用**该星区子流**抽一个列表（候选 >1 时消耗 1 次抽样；=1 时取唯一项、不消耗 ⇒ 单元素数组＝原单值），
 *     再展开 `units[]`，等级/模块照列表设定；
 *     ★ 列表定义经 **`resolveNpcList(id, cfg)`** 解析（**内置优先 → 本配置根层内嵌 `npcLists` → 未命中报错**，
 *       见 `data/starfieldData.js` 的 C-3b 口径）—— 内嵌自定义列表与内置文件列表**完全同构**；
 *     条目结构＝**引擎编队口径** `{ type, level, modules:[{moduleId,level}] }`（`type`＝船型 id，
 *     与 `startBattle/enterBattle` 的编队条目同一形状）＋**星域层附加字段 `side`**（阵营；
 *     优先级＝列表条目的 `side` > 列表的 `side` > 星域配置 `sideRules.npcSide`）；
 *   · **特殊结构**：`structures` 本轮恒 `[]`（占位）；**`specialEffect` 占位透传**。
 *
 * ★ **确定性 id 方案**：货物实例 id 沿用既有口径 `cargoInstanceId(n)`＝`cargo-<n>`（`data/cargo.js`），
 *   序号 `n` 从 1 起、**跨星区按 `index` 顺序全局递增** ⇒ 全星域唯一、确定、可复现；
 *   与引擎运行时 `nextCargoId()`（取现有列表最大序号续号、绝不复用）**自然衔接**。
 *   （⇒ 若某星区生成的货物件数变化，其后星区的**编号**会顺移；故“分区对拍”应以**内容**为准或用
 *     `fork` 语义下的同标记比较，见 `starfieldGenSelfCheck()` 第 ⑧ 项说明。）
 *
 * ★ 结果结构（**JSON 可往返**：无 `undefined`、无函数、无循环引用）：
 *   { configId, seed, radius, durationTicks,
 *     layout: { width, height, cells, order:'r-then-q' },
 *     sectors: [ { index, q, r, typeId, isStar, placement:{mode,edges},
 *                  ore, cargos:[…], units:[…], specialEffect } ],
 *     counts:  { <typeId>: { enabled, min, max, requested, filled, placed } },
 *     warnings: [ { code:'sectorCountTruncated'|'sectorCellsFilled', … } ],
 *     ★ playerEntryIndex }
 *   · `isStar` ＝ 该星区是否**中心/(可参战)恒星区**：判据＝该类型的 `placement.mode === 'center'`
 *     （**结构派生、不认类型 id**）；
 *   · `playerEntryIndex` ＝ **玩家单位入场星区**的只读下标（判定规则见 `resolvePlayerEntryIndex`；
 *     只做派生、不消耗随机、不改任何星区内容 ⇒ 与“是否配置了玩家单位”无关）；
 *   · `layout.width/height` ＝ 方网格包围盒边长（`2*radius+1`）；`cells` ＝ 圆内格数。
 */
import { createRng } from '../core/rng.js';
import { SECTOR_TYPE_IDS, getSectorType } from './sectorTypes/index.js';
import { NPC_LIST_IDS, getNpcList } from './npcLists/index.js';
import { getStarfield } from './starfields/index.js';
import { readNpcListIds, resolveNpcList, validateStarfieldConfig } from './starfieldData.js';
import {
  CARGO_DEFAULTS,
  CARGO_LIMITS,
  CARGO_IDS,
  cargoInstanceId,
  cargoMaxLevel,
  getCargo,
  resolveCargoAtLevel,
} from './cargo.js';

/* ---------- 小工具（纯函数） ---------- */

/** 依 id 或定义对象取星域配置（未知 ⇒ 抛错；生成器不做“猜”行为） */
function resolveConfig(configOrId) {
  if (typeof configOrId === 'string') {
    const cfg = getStarfield(configOrId);
    if (!cfg) throw new Error(`未知星域配置: ${configOrId}`);
    return cfg;
  }
  if (!configOrId || typeof configOrId !== 'object') throw new Error('星域配置无效（应为 id 或配置对象）');
  return configOrId;
}

/** 种子口径：显式入参 > `config.seed`；两者都缺 ⇒ 抛错（**不得回落到随机**） */
function resolveSeed(config, seed) {
  const s = seed === undefined || seed === null || seed === '' ? config.seed : seed;
  if (s === undefined || s === null || s === '') {
    throw new Error('缺少随机种子：请显式传入 seed，或在星域配置里给 config.seed（生成器内不使用随机默认值）');
  }
  return s;
}

/** 该类型在某星域配置里的**生效参数**（配置覆写优先、未写用类型默认；**不修改任何入参**） */
function effectiveType(typeId, cfg) {
  const def = getSectorType(typeId);
  const ov = (cfg.sectorTypes && cfg.sectorTypes[typeId]) || {};
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  return {
    typeId,
    def,
    enabled: ov.enabled !== false,
    count: ov.count || def.count,
    placement: def.placement || { mode: 'ring' },
    content: def.content,
    // ★ **NPC 列表候选集合**（`npcListIds: string[]`，兼容既有单值 `npcListId`；归一在 `starfieldData`）：
    //   配置里**显式写了**（含 `[]` / `null` ＝ 明确“无单位”）就优先，否则用类型默认。
    npcListIds: hasOwn(ov, 'npcListIds') || hasOwn(ov, 'npcListId') ? readNpcListIds(ov) : readNpcListIds(def),
  };
}

/** ★ **从候选 NPC 列表集合中按种子确定性地抽一个**（**星区子流**上的一次抽取）：
 *  · 候选 **> 1** ⇒ `rng.pickOne`（**消耗 1 次抽样**，结果由该星区自己的子流 `fork('sector:'+index)` 决定）；
 *  · 候选 **= 1** ⇒ 直接返回该唯一项、**不消耗抽样**（体例同 `core/rng.js` 的“退化输入不消耗”口径
 *    ⇒ **单元素数组与原单值 `npcListId` 逐字节等价**，既有星域零回归）；
 *  · 候选 **= 0** ⇒ `null`（＝无单位，**不影响该星区其它内容**：抽取发生在单位展开之前/之后均不额外消耗）。 */
function pickNpcListId(ids, rng) {
  if (!Array.isArray(ids) || !ids.length) return null;
  return ids.length > 1 ? rng.pickOne(ids) : ids[0];
}

/** ★ **玩家单位入场星区判定**（**结构派生、不硬编码类型 id**；纯函数、不消耗随机）：
 *  ① 配置 `sideRules.playerEntryTypeId` 指到的类型**确有星区**（该类型被启用且落位）⇒ 用它；
 *  ② 否则**回退**：按 `sectors[]` 顺序取**第一个 `placement.mode === 'edges'` 的星区**
 *     （即“四条外缘”之一；不认具体类型 id）；
 *  ③ 仍无 ⇒ **`#1` 号星区**（`sectors[0].index`，显示编号 1）；
 *  ④ 无星区（极端数据）⇒ `-1`（不注入）。
 *  ★ 玩家单位的**注入**由容器 `systems/starfield.js` 负责（本函数只给判定结果，保持生成器纯函数）。 */
export function resolvePlayerEntryIndex(sectors, cfg) {
  const list = Array.isArray(sectors) ? sectors : [];
  if (!list.length) return -1;
  const want = cfg && cfg.sideRules && cfg.sideRules.playerEntryTypeId;
  if (want) {
    const hit = list.find((s) => s.typeId === want);
    if (hit) return hit.index;
  }
  const edge = list.find((s) => s.placement && s.placement.mode === 'edges');
  if (edge) return edge.index;
  return list[0].index;
}

/** 方网格圆内格：**先 r 后 q** 的固定扫描顺序 ⇒ index ＝ 数组下标（0 起） */
function buildCells(radius) {
  const cells = [];
  for (let r = -radius; r <= radius; r += 1) {
    for (let q = -radius; q <= radius; q += 1) {
      if (q * q + r * r <= radius * radius) cells.push({ index: cells.length, q, r, dist: Math.sqrt(q * q + r * r) });
    }
  }
  return cells;
}

/** 四方位 → 该方位的**极值格**（圆形布局下：最上行/最下行/最左列/最右列**各恰 1 格**） */
function axisCellOf(radius, dir, cells) {
  const want = { top: { q: 0, r: -radius }, bottom: { q: 0, r: radius }, left: { q: -radius, r: 0 }, right: { q: radius, r: 0 } }[dir];
  if (!want) return null;
  return cells.find((c) => c.q === want.q && c.r === want.r) || null;
}

/** 货物实例（**与 `normalizeSectorCargos` 产物同形**；类型/等级走既有唯一口径） */
function makeCargoInstance(tplId, level, tons, id) {
  const def = getCargo(tplId);
  if (!def) return null;
  const lv = Math.min(cargoMaxLevel(def), Math.max(1, level | 0));
  const cfg = resolveCargoAtLevel(def, lv);
  return {
    id: cargoInstanceId(id), // ★ 既有确定性 id 口径：`cargo-<序号>`（全星域唯一）
    templateId: def.id,
    nameKey: cfg.nameKey,
    name: CARGO_DEFAULTS.name, // 生成器不造自定义名（空串 ⇒ UI 显示类型名）
    type: cfg.type,
    colorKey: cfg.colorKey,
    tons: Math.min(CARGO_LIMITS.maxTons, Math.max(0, tons | 0)),
    loadTicks: cfg.loadTicks == null ? CARGO_DEFAULTS.loadTicks : cfg.loadTicks,
    level: cfg.level,
    bonus: cfg.bonus == null ? CARGO_DEFAULTS.bonus : cfg.bonus,
    enhanced: false, // 既有一次性强化的初值（同 `normalizeSectorCargos`）
    manualUnloadedSide: null, // 既有「玩家手动卸载」标记初值（同 `normalizeSectorCargos`）
    manualUnloadedUntil: 0,
  };
}

/** ★ **单位条目数组 → 引擎编队条目数组**（`{ type, level, modules }`；**唯一展开口径**）：
 *  · 条目＝`{ shipId, count | countRange:[min,max], level?, modules?:[{moduleId,level?}] }`
 *    （与 `data/npcLists/` 的 `units[]` 同构；**数量/等级/模块的归一只有这一处**）；
 *  · `count` 缺省 1；`countRange` 用传入的 `rng` 在 `[min,max]` 内取值（**调用方决定用哪条子流**）；
 *  · `level` 缺省 1；模块只保留**有 id** 的项，逐条**深拷贝**（不与入参共享引用）；
 *  · **不写 `side`**（阵营由调用方决定：星域 NPC 走「条目 side > 列表 side > `sideRules.npcSide`」，
 *    玩家单位恒为我方）；
 *  · 纯函数：**不修改入参**。 */
export function expandUnitSpecs(units, rng) {
  const out = [];
  for (const u of Array.isArray(units) ? units : []) {
    if (!u || !u.shipId) continue;
    const n = Number.isFinite(u.count)
      ? Math.max(0, Math.floor(u.count))
      : Array.isArray(u.countRange) && u.countRange.length === 2
        ? Math.max(0, rng.nextInt(u.countRange[0], u.countRange[1]))
        : 1;
    const level = Number.isFinite(u.level) ? Math.max(1, u.level | 0) : 1;
    const modules = (Array.isArray(u.modules) ? u.modules : [])
      .map((m) => ({
        moduleId: m && (m.moduleId ?? m.id),
        level: m && Number.isFinite(m.level) ? m.level : 1,
      }))
      .filter((m) => !!m.moduleId);
    for (let i = 0; i < n; i += 1) out.push({ type: u.shipId, level, modules: modules.map((m) => ({ ...m })) });
  }
  return out;
}

/** ★ **候选 NPC 列表集合 → 星区单位数组**（引擎编队口径 `{type,level,modules}` ＋ 星域层 `side`）：
 *  · **列表解析走唯一入口 `resolveNpcList(id, cfg)`**（★ C-3b：**内置 `data/npcLists/*` 优先 →
 *    本配置根层内嵌 `npcLists` → 未命中 ⇒ 空数组**；未命中由 `validateStarfieldConfig` 报错，此处只兜底）。
 *  · `cfg` 只被读取（读 `cfg.npcLists`）⇒ 纯函数、**不修改入参**；
 *  · 展开口径完全不变（逐条目、**每条目一次**抽样；阵营＝条目 `side` > 列表 `side` > `defaultSide`）
 *    ⇒ **同配置 + 同种子逐字节与改造前一致**（除非该配置确实引用了内嵌列表）。 */
function expandUnits(listId, cfg, rng, defaultSide) {
  const list = resolveNpcList(listId, cfg);
  if (!list || !Array.isArray(list.units)) return [];
  const out = [];
  // ★ 逐条目展开（**每条目一次** ⇒ 抽样消耗序列与改造前完全一致；阵营优先级见下）
  for (const u of list.units) {
    const side = u.side || list.side || defaultSide;
    for (const entry of expandUnitSpecs([u], rng)) out.push({ ...entry, side });
  }
  return out;
}

/* ---------- 主入口 ---------- */

/** ★ **生成星域初始状态**（纯函数；同「配置 + 种子」⇒ 结果完全一致）
 *  @param {string|object} configOrId 星域配置 id（如 `'h1'`）或配置对象
 *  @param {string|number} [seed] 种子；省略 ⇒ 取 `config.seed`；**都缺 ⇒ 抛错**（不回落到随机）
 *  @returns {{ configId:string, seed:string, radius:number, durationTicks:number,
 *              layout:object, sectors:object[], counts:object, warnings:object[] }}
 *  @throws {Error} 未知配置 / 配置结构或引用非法（走 `validateStarfieldConfig` 的**同一校验口径**）/ 缺种子 */
export function generateStarfield(configOrId, seed) {
  const cfg = resolveConfig(configOrId);
  const problems = validateStarfieldConfig(cfg);
  if (problems.length) throw new Error(`星域配置非法：${problems.slice(0, 3).join('；')}`);
  const useSeed = resolveSeed(cfg, seed);
  const radius = Math.max(1, cfg.radius | 0);
  const rngRoot = createRng(useSeed); // ★ 唯一随机源（core/rng.js）
  const rngLayout = rngRoot.fork('layout'); // 星域级：格位分配（方位挑选 / 圆内格洗牌）
  const defaultSide = (cfg.sideRules && cfg.sideRules.npcSide) || 'enemy';

  /* —— ① 布局 + 类型分配（固定顺序：center → edges → ring；段内按 SECTOR_TYPE_IDS） —— */
  const cells = buildCells(radius);
  const center = cells.find((c) => c.q === 0 && c.r === 0) || null;
  const types = SECTOR_TYPE_IDS.map((id) => effectiveType(id, cfg)).filter((t) => t.enabled);
  const counts = {};
  const warnings = [];
  for (const t of types) {
    // ★ 数量：**每个类型一条独立子流**（`fork('count:'+typeId)`）⇒ 改某类型的数量区间
    //   **不会影响其它类型抽到的数量**（区段级分区；格位池仍共享 ⇒ 见文件头说明）
    const n = rngRoot.fork(`count:${t.typeId}`).nextInt(t.count.min, t.count.max);
    counts[t.typeId] = {
      enabled: true,
      min: t.count.min,
      max: t.count.max,
      requested: n, // 区间抽数（**显式生成**的数量）
      filled: 0, // ★ 补位数（仅填充类型可能 > 0；见 ④ 补位段）
      placed: 0, // ★ 实际落位合计 ＝ 本节显式落位 ＋ 补位数
    };
  }
  const byMode = (mode) => types.filter((t) => t.placement && t.placement.mode === mode);
  const ringTypes = byMode('ring'); // 圆内类型（固定顺序；段内发放用）

  const placedTypeId = new Array(cells.length).fill(null);
  const placeAt = (cellIndex, t) => {
    placedTypeId[cellIndex] = t.typeId;
    counts[t.typeId].placed += 1;
  };
  const truncWarn = (t) => {
    const c = counts[t.typeId];
    warnings.push({ code: 'sectorCountTruncated', typeId: t.typeId, requested: c.requested, placed: c.placed });
  };

  // ① center 段：中心格（容量 1）
  for (const t of byMode('center')) {
    const c = counts[t.typeId];
    if (center && c.requested > 0) placeAt(center.index, t);
    if (c.placed < c.requested) truncWarn(t);
  }
  // ② edges 段：四方位极值格（每方位 1 格；方位由种子随机挑选，方位集合来自 placement.edges）
  const takenCells = new Set(placedTypeId.map((v, i) => (v ? i : -1)).filter((i) => i >= 0));
  for (const t of byMode('edges')) {
    const c = counts[t.typeId];
    const dirs = (Array.isArray(t.placement.edges) ? t.placement.edges : [])
      .map((d) => axisCellOf(radius, d, cells))
      .filter((cell) => cell && !takenCells.has(cell.index));
    const pick = rngLayout.shuffle(dirs); // ★ 方位随机（种子决定）
    for (let i = 0; i < c.requested && i < pick.length; i += 1) {
      placeAt(pick[i].index, t);
      takenCells.add(pick[i].index);
    }
    if (c.placed < c.requested) truncWarn(t);
  }
  // ③ ring 段：其余圆内格（可选 minRadius/maxRadius 约束；格池洗牌后按类型固定顺序发放）
  const ringCells = [];
  for (const cell of cells) {
    if (placedTypeId[cell.index]) continue;
    const usable = ringTypes.some((t) => {
      const min = Number.isFinite(t.placement.minRadius) ? t.placement.minRadius : 1;
      const max = Number.isFinite(t.placement.maxRadius) ? t.placement.maxRadius : radius;
      return cell.dist >= min && cell.dist <= max;
    });
    if (usable) ringCells.push(cell);
  }
  const ringPool = rngLayout.shuffle(ringCells); // ★ 圆内格顺序由种子决定
  let cursor = 0;
  for (const t of ringTypes) {
    const c = counts[t.typeId];
    const min = Number.isFinite(t.placement.minRadius) ? t.placement.minRadius : 1;
    const max = Number.isFinite(t.placement.maxRadius) ? t.placement.maxRadius : radius;
    let placed = 0;
    while (placed < c.requested && cursor < ringPool.length) {
      const cell = ringPool[cursor];
      cursor += 1;
      if (cell.dist < min || cell.dist > max) continue; // 该类型自身的半径约束
      placeAt(cell.index, t);
      placed += 1;
    }
    if (c.placed < c.requested) truncWarn(t);
  }

  /* ④ ★ **补位段（用户口径：圆内格位没被任何类型占到 ⇒ 补为空区，格子恒满）** ——
   *   · **数据驱动、不硬编码类型 id**：填充类型 ＝ 唯一带 **`fill:true`** 标记的类型
   *     （见 `data/sectorTypes/<id>.js`；本仓＝`empty`）；该标记由 `data/starfieldData.js selfCheck()`
   *     的「恰有一个填充类型」项强制唯一。
   *   · **只占空格位**：仅把上面 center/edges/ring 三段**都没要**的格位补上 ⇒ **不可能挤占**任何
   *     已分配格位（`planet/mineral/star/stargate` 的位置与内容零改动）。
   *   · **不消耗随机**（只按 `cells` 的固定扫描顺序补齐）⇒ 同配置＋同种子仍逐位相同；
   *     且补位发生在**全部随机抽数之后** ⇒ 对其它类型的抽数序列**零影响**。
   *   · **不是截断**：补位不产生 `sectorCountTruncated`；只记一条**非错误信息**
   *     `{ code:'sectorCellsFilled', typeId, filled }`（便于控制台核对）。
   *   · ★ **若填充类型被配置为 `enabled:false`** ⇒ 不做补位（尊重「类型增减开关」口径，
   *     此时仍可能留下空洞 —— 与改造前行为一致）。 */
  const fillType = types.find((t) => t.def && t.def.fill === true) || null;
  let filled = 0;
  if (fillType) {
    for (const cell of cells) {
      if (placedTypeId[cell.index]) continue;
      placeAt(cell.index, fillType);
      filled += 1;
    }
    counts[fillType.typeId].filled = filled;
    if (filled > 0) warnings.push({ code: 'sectorCellsFilled', typeId: fillType.typeId, filled });
  }

  /* —— ② 逐星区内容（每区只用自己的子流 `fork('sector:'+index)`；★ 补位后每格都有类型） —— */
  const typeById = new Map(types.map((t) => [t.typeId, t]));
  const sectors = [];
  let cargoSeq = 0; // ★ 全星域唯一的货物序号（按 index 顺序递增 ⇒ 确定、可复现）
  for (const cell of cells) {
    const typeId = placedTypeId[cell.index];
    const t = typeId ? typeById.get(typeId) : null;
    if (!t) continue; // 未被分配到的格不成为星区（仅当**填充类型被禁用**、或类型容量不足时可能出现）
    const rng = rngRoot.fork(`sector:${cell.index}`); // ★ 星区子流（分区随机）
    const content = t.content || {};
    const oreRange = content.ore || { min: 0, max: 0 };
    const ore = rng.nextInt(oreRange.min, oreRange.max);

    // 星球(货物)：按 content.cargos 参数展开为实例数组
    const cargos = [];
    const cg = content.cargos || {};
    if (cg.enabled) {
      const n = rng.nextInt((cg.count || { min: 0, max: 0 }).min, (cg.count || { min: 0, max: 0 }).max);
      const pool = Array.isArray(cg.templates) && cg.templates.length
        ? cg.templates.slice()
        : CARGO_IDS.filter((id) => id !== CARGO_DEFAULTS.templateId); // 兜底类型（「无」）不参与随机
      const tonsRange = cg.tonsRange || { min: 0, max: 0 };
      const lvRange = cg.levelRange || { min: 1, max: 1 };
      for (let i = 0; i < n; i += 1) {
        const tplId = rng.pickOne(pool);
        if (!tplId) break; // 无可用模板（极端数据）⇒ 该区不出货物
        const tons = rng.nextInt(tonsRange.min, tonsRange.max);
        const level = rng.nextInt(lvRange.min, lvRange.max);
        cargoSeq += 1;
        const inst = makeCargoInstance(tplId, level, tons, cargoSeq);
        if (inst) cargos.push(inst);
      }
    }

    // 单位：按 **NPC 列表候选集合**（`npcListIds[]`，兼容单值 `npcListId`）**按种子随机抽一个**再展开
    // （抽取用该星区自己的子流 `rng`；候选 ≤1 时不消耗抽样 ⇒ 单元素数组＝原单值、零回归）
    // ★ C-3b：列表解析走 `resolveNpcList`（内置优先 → **本配置内嵌 `npcLists`** → 未命中报错）
    //   候选表本身**不变**（仍是 `readNpcListIds` 的归一结果）⇒ `pickNpcListId` 的抽样顺序零变化。
    const units = t.npcListIds.length ? expandUnits(pickNpcListId(t.npcListIds, rng), cfg, rng, defaultSide) : [];

    sectors.push({
      index: cell.index,
      q: cell.q,
      r: cell.r,
      typeId: t.typeId,
      isStar: t.placement.mode === 'center', // ★ 结构派生（中心＝恒星星区·可参战），不认类型 id
      placement: { mode: t.placement.mode, edges: Array.isArray(t.placement.edges) ? t.placement.edges.slice() : null },
      ore,
      cargos,
      units,
      specialEffect: t.def.specialEffect === undefined ? null : t.def.specialEffect, // 占位透传
    });
  }

  return {
    configId: cfg.id,
    seed: String(useSeed), // 规范化：数字/字符串同串 ⇒ 回灌本结果仍得同一星域
    radius,
    durationTicks: cfg.durationTicks,
    layout: { width: radius * 2 + 1, height: radius * 2 + 1, cells: cells.length, order: 'r-then-q' },
    sectors,
    counts,
    warnings,
    // ★ **玩家单位入场星区**（只读派生，结构驱动、不硬编码类型 id；见 `resolvePlayerEntryIndex`）：
    //   `systems/starfield.js` 据此把 `cfg.playerUnits` 注入该星区的**我方**编队；
    //   配置界面预览据此显示「玩家单位将生成于 #编号 类型名（q, r）」。
    //   ★ 本身**不消耗随机、不改任何星区内容** ⇒ 生成结果与「有没有 playerUnits」无关（零回归）。
    playerEntryIndex: resolvePlayerEntryIndex(sectors, cfg),
  };
}

/** 只读**摘要**（供控制台人工核对：`LS.starfieldGen.preview('h1','demo')`；**不生成新逻辑、只调上面**） */
export function previewStarfield(configOrId, seed) {
  const s = generateStarfield(configOrId, seed);
  const typeCounts = {};
  let cargoTotal = 0;
  let unitTotal = 0;
  for (const sec of s.sectors) {
    typeCounts[sec.typeId] = (typeCounts[sec.typeId] || 0) + 1;
    cargoTotal += sec.cargos.length;
    unitTotal += sec.units.length;
  }
  return {
    configId: s.configId,
    seed: s.seed,
    radius: s.radius,
    durationTicks: s.durationTicks,
    layout: s.layout,
    sectors: s.sectors.length,
    sectorTypes: typeCounts,
    cargoTotal,
    unitTotal,
    starIndex: (s.sectors.find((x) => x.isStar) || {}).index,
    warnings: s.warnings,
  };
}

/* ---------- 自检（确定性与口径断言；控制台 `LS.starfieldGen.selfCheck()`） ---------- */

/** ★ **生成器自检**（纯函数；返回 `{ pass, checks[] }`，体例同 `LS.rng.selfTest()` / `LS.starfieldData.selfCheck()`）
 *  检查项：
 *   ① 同配置 + 同种子**两次生成深度相等**（`JSON.stringify` 相等）；
 *   ② 不同种子 ⇒ 结果不同；
 *   ③ 生成**不修改入参配置**（生成前后 `JSON.stringify(config)` 不变）；
 *   ④ 各类型数量口径：**非填充类型** ⇒ `placed` 落在配置/类型区间内（未触发该类型截断时）；
 *      **填充类型（`fill:true`）** ⇒ `requested` 落在区间内、`placed ＝ requested ＋ filled`（补位后合计）；
 *      任何被截断的类型只要求 `placed ≤ requested`；
 *   ⑤ 人为放大数量触发截断 ⇒ **有 `sectorCountTruncated` 告警** 且**星区总数仍 ＝ 可用格位数**；
 *   ⑥ 所有 `placement.mode:'edges'` 的星区**全部落在四方位外缘**（(0,±R)/(±R,0)）；
 *   ⑦ 中心**恰 1 个** `isStar` 星区且坐标 `(0,0)`；
 *   ⑧ **`fork` 分区性**：只改某类型的 **`npcListIds`**（＝内容参数，不改数量 ⇒ 版图与货物件数都不变）时：
 *      **版图（每个 index 的类型）不变**、**其它类型星区逐字节一致**（含货物 id/吨位/等级、矿物、单位），
 *      而**被改类型的星区确实变化**（证明改动生效）。
 *   ⑨ 结果**可 JSON 往返**（无函数/循环引用/`undefined` 丢字段）。
 *   ★ ⑩⑪⑫（本轮补位口径新增）：
 *   ⑩ **星区总数恒 ＝ `layout.cells`**（圆内格位恒满，地图无空洞）；
 *   ⑪ **补位链路自洽**：注册表里**恰有一个 `fill:true` 类型**、结果里该类型 `placed ＝ requested ＋ filled`、
 *      补位数为 0 时不出现 `sectorCellsFilled`、且补位**只占空格位**（不挤占既有类型）；
 *   ⑫ **零回归**：把填充类型 `enabled:false`（＝不做补位）再生成一次 ⇒
 *      **非填充类型星区的「位置 + 内容」逐字节一致**（含货物 id／吨位／等级、矿物、单位）。
 *   ★ ⑬⑭（本轮新增）：
 *   ⑬ **NPC 列表候选集合**（`npcListIds[]`）：**单元素数组 ≡ 原单值 `npcListId`**（逐字节）；
 *      多候选时**每区单位必须整体属于某一个候选列表**（抽取结果不得越界）；空集合 ⇒ 无单位；
 *      改候选集合**不影响其它类型星区**（分区随机）。
 *   ⑭ **玩家单位入场星区判定**（`playerEntryIndex`）：配了 `playerEntryTypeId` ⇒ 该类型星区；
 *      该类型被禁用 ⇒ **回退第一个 `placement.mode:'edges'` 星区**；无 edges ⇒ **`#1`（index 0）**；
 *      且判定与 `playerUnits` 配置**互不影响**（生成结果逐字节一致）。
 *   ★ ⑮（C-3b 新增）**内嵌自定义列表的端到端对拍**：同一类型分别引用**内置列表**与
 *      「**`units` 与之内嵌副本完全相同**的内嵌列表 `custom:l1`」⇒ 同配置 + 同种子下
 *      **生成结果逐字节一致**（列表解析走 `resolveNpcList`：内置优先 → 本配置内嵌 → 报错）。 */
export function starfieldGenSelfCheck() {
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass: !!pass, detail: detail == null ? '' : String(detail) });
  const clone = (v) => JSON.parse(JSON.stringify(v));
  // ★ 填充类型 id：**由数据标记派生**（不硬编码）；`fill:true` 的唯一性由 `starfieldData.selfCheck()` 强制
  const fillId = SECTOR_TYPE_IDS.find((id) => {
    const d = getSectorType(id);
    return !!d && d.fill === true;
  }) || null;

  // ① 同种子两次一致
  const a = generateStarfield('h1', 'demo');
  const b = generateStarfield('h1', 'demo');
  add('① 同配置 + 同种子 ⇒ 结果深度相等', JSON.stringify(a) === JSON.stringify(b), `${a.sectors.length} 个星区`);

  // ② 不同种子 ⇒ 不同（比**星区内容**而非含 seed 字段的整体 ⇒ 真比较生成结果）
  const c = generateStarfield('h1', 'demo-2');
  add('② 不同种子 ⇒ 结果不同', JSON.stringify(a.sectors) !== JSON.stringify(c.sectors));

  // ③ 不修改入参
  const cfg = clone(getStarfield('h1'));
  const before = JSON.stringify(cfg);
  generateStarfield(cfg, 'mut-check');
  add('③ 生成不修改入参配置', before === JSON.stringify(cfg));

  // ④ 数量口径：非填充类型看 placed；填充类型看 requested（区间）＋ placed＝requested＋filled
  {
    const p = [];
    const truncated = new Set((a.warnings || []).map((w) => w.typeId));
    for (const [typeId, s] of Object.entries(a.counts)) {
      if (truncated.has(typeId)) {
        if (!(s.placed <= s.requested + (s.filled || 0))) p.push(`${typeId}: placed(${s.placed}) > requested+filled(${s.requested}+${s.filled || 0})`);
        continue;
      }
      if (typeId === fillId) {
        if (s.requested < s.min || s.requested > s.max) p.push(`${typeId}(填充): requested=${s.requested} 不在 [${s.min},${s.max}]`);
        if (s.placed !== s.requested + (s.filled || 0)) p.push(`${typeId}(填充): placed=${s.placed} ≠ requested+filled=${s.requested}+${s.filled || 0}`);
        continue;
      }
      if (s.placed < s.min || s.placed > s.max) p.push(`${typeId}: placed=${s.placed} 不在 [${s.min},${s.max}]`);
    }
    add('④ 各类型数量口径（非填充看 placed；填充看 requested + filled）', p.length === 0, p.join('；'));
  }

  // ⑤ 截断兜底：放大数量 ⇒ 有告警且总量＝可用格位
  {
    const big = clone(getStarfield('h1'));
    big.sectorTypes.empty = { enabled: true, count: { min: 999, max: 999 } };
    const g = generateStarfield(big, 'trunc');
    const warn = (g.warnings || []).find((w) => w.code === 'sectorCountTruncated' && w.typeId === 'empty');
    const total = g.sectors.length;
    add('⑤ 容量不足 ⇒ 截断告警 + 总量＝可用格位', !!warn && total === g.layout.cells, `sectors=${total}, cells=${g.layout.cells}, warned=${!!warn}`);
  }

  // ⑥ 星门等 edges 类型：全部落在四方位外缘
  {
    const R = a.radius;
    const axis = (s) => (s.q === 0 && Math.abs(s.r) === R) || (s.r === 0 && Math.abs(s.q) === R);
    const bad = a.sectors.filter((s) => s.placement.mode === 'edges' && !axis(s)).map((s) => s.index);
    add('⑥ edges 类型全部落在四方位外缘', bad.length === 0, bad.join(','));
  }

  // ⑦ 中心恰 1 个 star（isStar）且在 (0,0)
  {
    const stars = a.sectors.filter((s) => s.isStar);
    add('⑦ 中心恰 1 个恒星区且位于 (0,0)', stars.length === 1 && stars[0].q === 0 && stars[0].r === 0, `count=${stars.length}`);
  }

  // ⑧ fork 分区性：**只改某类型的「单位来源」（`npcListIds` 候选集合）**⇒ 版图分配不变、其它类型星区**逐字节一致**
  //   （改的是“内容参数”而非“数量”，故格位与货物件数都不变 ⇒ 全局货物序号也不顺移 ⇒ 可做全等比较；
  //    此处用**单元素候选集合** ⇒ 不额外消耗抽样，比较口径与改造前一致）
  {
    const g1 = generateStarfield('h1', 'fork-check');
    const mod = clone(getStarfield('h1'));
    mod.sectorTypes.planet = { ...(mod.sectorTypes.planet || {}), npcListIds: ['patrolHeavy'] };
    delete mod.sectorTypes.planet.npcListId; // ★ 两种写法不可并存（校验会拦）
    const g2 = generateStarfield(mod, 'fork-check');
    // (a) 版图（每个 index 的类型）完全一致
    const mapOf = (g) => g.sectors.map((s) => `${s.index}:${s.typeId}`).join(',');
    const layoutSame = mapOf(g1) === mapOf(g2);
    // (b) 非 planet 星区**完全一致**（含货物 id/吨位/等级、矿物、单位）
    const others = (g) => JSON.stringify(g.sectors.filter((s) => s.typeId !== 'planet'));
    const othersSame = others(g1) === others(g2);
    // (c) planet 星区**确实变了**（证明改动生效、不是“没改到”）
    const planets = (g) => JSON.stringify(g.sectors.filter((s) => s.typeId === 'planet'));
    const planetChanged = planets(g1) !== planets(g2);
    add('⑧ 分区随机：改某类型内容不影响其它星区', layoutSame && othersSame && planetChanged, `layout=${layoutSame}, others=${othersSame}, changed=${planetChanged}`);
  }

  // ⑨ JSON 往返
  {
    let ok = false;
    try {
      ok = JSON.stringify(a) === JSON.stringify(JSON.parse(JSON.stringify(a)));
    } catch {
      ok = false;
    }
    add('⑨ 结果可 JSON 往返', ok);
  }

  // ⑩ 星区总数恒 ＝ layout.cells（补位后地图无空洞）
  add(
    '⑩ 星区总数恒 ＝ layout.cells（圆内格位恒满）',
    a.sectors.length === a.layout.cells,
    `sectors=${a.sectors.length}, cells=${a.layout.cells}`
  );

  // ⑪ 补位链路自洽（唯一 fill 类型 / placed＝requested+filled / 告警口径 / 不挤占既有类型）
  {
    const p = [];
    if (!fillId) p.push('注册表里没有 fill:true 类型（无法补位）');
    else {
      const c = a.counts[fillId];
      if (!c) p.push(`counts 缺填充类型 ${fillId}`);
      else {
        if (c.placed !== c.requested + (c.filled || 0)) p.push(`${fillId}: placed=${c.placed} ≠ requested+filled=${c.requested}+${c.filled || 0}`);
        const fillWarns = (a.warnings || []).filter((w) => w.code === 'sectorCellsFilled');
        if (c.filled > 0 && (fillWarns.length !== 1 || fillWarns[0].filled !== c.filled || fillWarns[0].typeId !== fillId)) {
          p.push(`filled=${c.filled} 但 sectorCellsFilled 告警不匹配（${JSON.stringify(fillWarns)}）`);
        }
        if (c.filled === 0 && fillWarns.length) p.push('filled=0 却出现 sectorCellsFilled 告警');
        // ★ 补位只占空格位：**非填充类型**各自拿到它请求的全部格数（没有人被挤占）
        for (const [typeId, s] of Object.entries(a.counts)) {
          if (typeId === fillId) continue;
          if (s.placed !== s.requested) p.push(`${typeId}: placed=${s.placed} ≠ requested=${s.requested}（疑似被补位挤占）`);
        }
      }
    }
    add('⑪ 补位链路自洽（唯一 fill 类型 · placed＝requested+filled · 只占空格位）', p.length === 0, p.join('；'));
  }

  // ⑫ 零回归：把填充类型 `enabled:false`（＝不做补位）再生成一次 ⇒ 非填充类型逐字节一致
  {
    const noFill = clone(getStarfield('h1'));
    if (fillId) noFill.sectorTypes[fillId] = { ...(noFill.sectorTypes[fillId] || {}), enabled: false };
    const g = generateStarfield(noFill, 'demo');
    const strip = (res) => JSON.stringify(res.sectors.filter((s) => s.typeId !== fillId));
    const same = strip(a) === strip(g);
    add(
      '⑫ 零回归：不做补位时非填充类型星区逐字节一致（位置 + 内容）',
      same,
      `补位版 ${a.sectors.length} 区 / 不补位版 ${g.sectors.length} 区`
    );
  }

  // ⑬ ★ **NPC 列表候选集合**（`npcListIds[]`，兼容单值 `npcListId`）：
  //   (a) **单元素数组 ≡ 原单值**（`npcListIds:['x']` 与 `npcListId:'x'` **逐字节**相同 ⇒ 零回归）；
  //   (b) **抽取结果必须落在候选集合内**：每个该类星区的单位**全部来自同一个候选列表**
  //       （用「船型@等级」签名比对 ⇒ 能区分不同候选列表，且不依赖抽取运气）；
  //   (c) **空集合 ⇒ 无单位**；
  //   (d) **分区随机**：改某类型的候选集合**不影响其它类型的星区**（逐字节一致）。
  {
    const p = [];
    // (a) 单元素数组 ≡ 单值（改的是“内容参数”，数量不变 ⇒ 可做全等比较）
    //   ★ 两种写法**不可并存**（校验会拦）⇒ 构造时显式只留一个键
    const single = clone(getStarfield('h1'));
    single.sectorTypes.planet = { ...(single.sectorTypes.planet || {}), npcListIds: ['patrolLight'] };
    delete single.sectorTypes.planet.npcListId;
    const legacy = clone(getStarfield('h1'));
    legacy.sectorTypes.planet = { ...(legacy.sectorTypes.planet || {}), npcListId: 'patrolLight' };
    delete legacy.sectorTypes.planet.npcListIds;
    const e1 = generateStarfield(single, 'npc-arr');
    const e2 = generateStarfield(legacy, 'npc-arr');
    if (JSON.stringify(e1.sectors) !== JSON.stringify(e2.sectors)) {
      p.push('单元素数组 npcListIds 与单值 npcListId 的结果不一致（应逐字节等价）');
    }
    // (b)(d) 多候选：每区单位必须整体属于**某一个**候选列表
    const multi = clone(getStarfield('h1'));
    const CAND = ['patrolLight', 'patrolHeavy'];
    multi.sectorTypes.planet = { ...(multi.sectorTypes.planet || {}), npcListIds: CAND };
    delete multi.sectorTypes.planet.npcListId;
    const gm = generateStarfield(multi, 'npc-arr');
    // ★ C-3b：候选列表的签名**按 `resolveNpcList(id, cfg)` 取定义**（内置优先 → 本配置内嵌；不硬编码来源）
    const sigOf = (id) => {
      const list = resolveNpcList(id, multi) || {};
      const units = Array.isArray(list.units) ? list.units : [];
      return units.map((u) => `${u.shipId}@${u.level == null ? 1 : u.level}`);
    };
    const sigs = CAND.map(sigOf);
    for (const s of gm.sectors.filter((x) => x.typeId === 'planet')) {
      if (!s.units.length) {
        p.push(`planet#${s.index}: 候选非空却无单位`);
        continue;
      }
      const mine = s.units.map((u) => `${u.type}@${u.level == null ? 1 : u.level}`);
      const fits = sigs.some((sig) => mine.every((m) => sig.includes(m)));
      if (!fits) p.push(`planet#${s.index}: 单位 ${mine.join(',')} 不属于任何单一候选列表（抽取结果越界）`);
    }
    const othersSame = (g1, g2, tid) =>
      JSON.stringify(g1.sectors.filter((s) => s.typeId !== tid)) === JSON.stringify(g2.sectors.filter((s) => s.typeId !== tid));
    const one = generateStarfield(single, 'npc-arr');
    if (!othersSame(one, gm, 'planet')) p.push('多候选抽取影响了其它类型星区（分区随机被破坏）');
    // (c) 空集合 ⇒ 无单位；其它类型星区逐字节一致
    const none = clone(getStarfield('h1'));
    none.sectorTypes.planet = { ...(none.sectorTypes.planet || {}), npcListIds: [] };
    delete none.sectorTypes.planet.npcListId;
    const gn = generateStarfield(none, 'npc-arr');
    if (gn.sectors.some((s) => s.typeId === 'planet' && s.units.length)) p.push('空候选集合却生成了单位');
    if (!othersSame(one, gn, 'planet')) p.push('空候选集合影响了其它类型星区（分区随机被破坏）');
    add('⑬ NPC 列表候选集合（单元素≡单值 / 抽取落在集合内 / 空集合无单位 / 分区随机）', p.length === 0, p.join('；'));
  }

  // ⑭ ★ **玩家单位入场星区判定**（纯派生、不消耗随机、不硬编码类型 id）：
  //   (a) 配了 `playerEntryTypeId` 且该类型有星区 ⇒ 落在该类型星区；
  //   (b) 该类型被禁用/未配 ⇒ **回退到第一个 `placement.mode === 'edges'` 星区**；
  //   (c) 无任何 edges 类型 ⇒ **回退到 `#1`（index 0）**；
  //   (d) 判定**不改变任何星区内容**（有无玩家单位配置，生成结果逐字节一致）。
  {
    const p = [];
    const g = generateStarfield('h1', 'entry');
    const wantType = (getStarfield('h1').sideRules || {}).playerEntryTypeId;
    const hit = g.sectors.find((s) => s.typeId === wantType);
    if (hit && g.playerEntryIndex !== hit.index) p.push(`playerEntryIndex=${g.playerEntryIndex} ≠ 类型 ${wantType} 星区 ${hit.index}`);
    // (b) 入场类型被禁用 ⇒ 回退「第一个 `placement.mode:'edges'` 星区」；若连 edges 都没有 ⇒ `#1`
    //   ★ 被禁用的类型 id 也**由配置派生**（不硬编码类型 id）
    const noGate = clone(getStarfield('h1'));
    if (wantType) noGate.sectorTypes[wantType] = { ...(noGate.sectorTypes[wantType] || {}), enabled: false };
    const gg = generateStarfield(noGate, 'entry');
    const anyEdge = gg.sectors.find((s) => s.placement.mode === 'edges');
    const expectEdge = anyEdge ? anyEdge.index : gg.sectors[0].index;
    if (gg.playerEntryIndex !== expectEdge) p.push(`入场类型被禁用后应回退到 ${expectEdge}（现 ${gg.playerEntryIndex}）`);
    // (c) 无任何 edges 类型 ⇒ #1（index 0）
    const noEdges = clone(getStarfield('h1'));
    for (const [tid, ov] of Object.entries(noEdges.sectorTypes)) {
      if (getSectorType(tid) && getSectorType(tid).placement.mode === 'edges') noEdges.sectorTypes[tid] = { ...ov, enabled: false };
    }
    const ge = generateStarfield(noEdges, 'entry');
    if (ge.playerEntryIndex !== ge.sectors[0].index) p.push(`无 edges 类型时应回退 #1（现 ${ge.playerEntryIndex}）`);
    // (d) 判定与星区内容无关（含/不含 playerUnits 的生成结果逐字节一致）
    const withPU = clone(getStarfield('h1'));
    withPU.playerUnits = [{ shipId: 'combat', count: 1, level: 1, modules: [] }];
    const g2 = generateStarfield(withPU, 'entry');
    if (JSON.stringify(g.sectors) !== JSON.stringify(g2.sectors)) p.push('playerUnits 的配置改变了星区内容（生成器应完全忽略它）');
    if (g.playerEntryIndex !== g2.playerEntryIndex) p.push('playerUnits 的配置改变了入场星区判定');
    add('⑭ 玩家入场星区判定（playerEntryTypeId → edges 回退 → #1；不改星区内容）', p.length === 0, p.join('；'));
  }

  // ⑮ ★★ **C-3b 内嵌自定义列表的端到端对拍**（**逐字节一致**）：
  //   · 构造配置 A：类型 `firstTypeId` 引用**内置列表** `srcId`；
  //   · 构造配置 B：同一类型引用**内嵌列表 `custom:l1`**，其 `units` ＝ `srcId` 的 units **深拷贝**
  //     （**且不带同名 `nameKey`/`name`** ⇒ 结果里不出现的展示字段不会造成差异）；
  //   · 断言 `JSON.stringify(generate(A))` **逐字节等于** `generate(B)` 的同一串（**含 `configId`/`seed`/
  //     版图/货物 id 序号/单位/告警** —— 两份配置只差「列表来源」，故整体串应完全相同）；
  //   · 另断言：内嵌副本的引用**通过校验**（内嵌列表被正确解析 ⇒ 不是靠空列表蒙混过关）。
  //   ★ 注意事项（写进断言）：「内嵌副本与等价内置列表**同构**」的前提是**列表定义的 `units[]` 相同**；
  //     若内嵌副本另写 `nameKey`/`name` 或 `side`（**内置为 `side:null`**），则**字段本身不同**、
  //     对拍不再成立 ⇒ 本检查刻意构造**除来源外完全相同**的两份配置。
  {
    const p = [];
    const base = getStarfield('h1');
    const firstTypeId = Object.keys((base && base.sectorTypes) || {})[0] || null;
    const srcId = NPC_LIST_IDS.find((id) => {
      const l = getNpcList(id);
      return !!l && Array.isArray(l.units) && l.units.length > 0;
    });
    if (firstTypeId && srcId) {
      const cfgA = clone(base);
      cfgA.sectorTypes[firstTypeId] = { ...(cfgA.sectorTypes[firstTypeId] || {}), npcListIds: [srcId] };
      delete cfgA.sectorTypes[firstTypeId].npcListId;
      const srcList = getNpcList(srcId);
      const embedded = { units: clone(srcList.units) }; // ★ 仅 `units`，与内置定义的**校验相关字段同构**
      const cfgB = clone(cfgA);
      cfgB.npcLists = { 'custom:l1': embedded };
      cfgB.sectorTypes[firstTypeId] = { ...(cfgB.sectorTypes[firstTypeId] || {}), npcListIds: ['custom:l1'] };
      delete cfgB.sectorTypes[firstTypeId].npcListId;
      const pA = validateStarfieldConfig(cfgA);
      const pB = validateStarfieldConfig(cfgB);
      if (pA.length) p.push(`对拍配置 A（内置引用 ${srcId}）不合法：${pA.slice(0, 2).join('；')}`);
      if (pB.length) p.push(`对拍配置 B（内嵌引用 custom:l1）不合法：${pB.slice(0, 2).join('；')}`);
      const outA = JSON.stringify(generateStarfield(cfgA, 'custom-parity'));
      const outB = JSON.stringify(generateStarfield(cfgB, 'custom-parity'));
      if (outA !== outB) p.push(`内嵌副本与等价内置列表的生成结果不一致（${outA.length} vs ${outB.length} 字节）`);
    } else {
      p.push('缺少可对拍的「非空内置列表」或「本档首个星区类型」（无法完成端到端对拍）');
    }
    add('⑮ C-3b 内嵌副本 ≡ 等价内置列表（同配置同种子 ⇒ 生成结果逐字节一致）', p.length === 0, p.join('；'));
  }

  return { pass: checks.every((ch) => ch.pass), checks };
}

export default generateStarfield;
