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
 *      `mapColor` 为 CSS 变量名、`marker`、`content.*` 区间、`npcListId` 引用存在）；
 *   ③ **星域配置引用存在性**：`sectorTypes` 键 / `npcListId` / `sideRules.*` 引用的类型与列表均存在；
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
 *   ⑩ **i18n 词条齐全**：全部 `nameKey` 在 `i18n.locales` 的**每个语言**字典中都存在（缺词条时 `t()` 会返回
 *      `??key`）；命名体例＝`sectorType.<id>` / `npcList.<id>` / `starfield.<id>`。
 *   ⑪ ★ **恰有一个填充类型**（`fill:true`）：生成器「剩余格位补位 ⇒ 星区总数恒 ＝ layout.cells」的结构前提
 *      （语义见 `data/sectorTypes/empty.js`；引擎**不硬编码类型 id**）。
 * ★ 本文件**不生成任何数据**（生成器＝步骤 A-5 `data/starfield.js`：配置 + 种子 ⇒ 星域初始状态）。
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
  if (def.npcListId != null && !getNpcList(def.npcListId)) p.push(`${id}: 未知 NPC 列表 ${def.npcListId}`);
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

/** 单个 NPC 列表的校验（引用存在性 + 等级/槽位/picker + 数量） ⇒ 问题字符串数组 */
function npcListProblems(id, list) {
  const p = [];
  if (list.nameKey !== `npcList.${id}`) p.push(`${id}: nameKey 应为 npcList.${id}（现 ${list.nameKey}）`);
  if (list.side != null && !NPC_SIDES.includes(list.side)) p.push(`${id}: side 占位应为 null 或 ${NPC_SIDES.join('/')}`);
  const units = list.units;
  if (!Array.isArray(units)) return [`${id}: units 非数组`];
  units.forEach((u, i) => {
    const tag = `${id}.units[${i}]`;
    if (!u || typeof u !== 'object') {
      p.push(`${tag}: 不是对象`);
      return;
    }
    const ship = getShip(u.shipId);
    if (!ship) {
      p.push(`${tag}: 未知船型 ${u.shipId}`);
      return;
    }
    // 等级（缺省 1）
    const lv = Number.isFinite(u.level) ? Math.max(1, u.level | 0) : 1;
    const sMax = shipMaxLevel(ship);
    if (lv > sMax) p.push(`${tag}: 等级 ${lv} 超出船型上限 ${sMax}`);
    // 数量：count 与 countRange 二选一（都可缺省 ⇒ 视为 1）
    if (u.count !== undefined && (!Number.isInteger(u.count) || u.count < 0)) p.push(`${tag}: count 应为非负整数`);
    if (u.countRange !== undefined) {
      const r = Array.isArray(u.countRange) && u.countRange.length === 2 ? { min: u.countRange[0], max: u.countRange[1] } : null;
      if (!rangeOk(r)) p.push(`${tag}: countRange 应为 [min,max] 且 min ≤ max`);
    }
    // 携带模块：存在性 + picker + 等级 + 槽位数
    const mods = u.modules === undefined ? [] : u.modules;
    if (!Array.isArray(mods)) {
      p.push(`${tag}: modules 非数组`);
      return;
    }
    const slots = (resolveShipAtLevel(ship, lv) || {}).slots;
    if (Number.isFinite(slots) && mods.length > slots) {
      p.push(`${tag}: 模块 ${mods.length} 件 > Lv${lv} 槽位 ${slots}（生成时会抛「模块槽位已满」）`);
    }
    mods.forEach((m, j) => {
      const mid = m && (m.moduleId ?? m.id);
      const mdef = mid ? MODULES[mid] : null;
      if (!mdef) {
        p.push(`${tag}.modules[${j}]: 未知模块 ${mid}`);
        return;
      }
      if (mdef.picker === false) p.push(`${tag}.modules[${j}]: 模块 ${mid} 为 picker:false（内部/专属，不可装配）`);
      if (Number.isFinite(m.level) && m.level > moduleMaxLevel(mdef)) {
        p.push(`${tag}.modules[${j}]: 等级 ${m.level} 超出模块上限 ${moduleMaxLevel(mdef)}`);
      }
    });
  });
  return p;
}

/** ★ **单份星域配置**的引用/结构校验（**C-3 导入校验入口**）：
 *  @returns {string[]} 问题列表（**空数组＝通过**）
 *  · 引用：`sectorTypes` 键、逐类型 `npcListId` 覆写、`sideRules.playerEntryTypeId` /
 *    `allyNpcListIds[]` / `neutralSectorTypeIds[]` 必须都存在；
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
      if (ov.npcListId !== undefined && ov.npcListId !== null && !getNpcList(ov.npcListId)) {
        p.push(`${sid}.${tid}: 未知 NPC 列表 ${ov.npcListId}`);
      }
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
        const ok = k === 'allyNpcListIds' ? !!getNpcList(ref) : !!getSectorType(ref);
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
  {
    const p = [];
    for (const id of NPC_LIST_IDS) p.push(...npcListProblems(id, NPC_LISTS[id]));
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

  return { pass: checks.every((c) => c.pass), checks };
}

/** 只读清单摘要（控制台 `LS.starfieldData.list()`；**纯数据、可直接 JSON 打印**） */
export function listStarfieldData() {
  return {
    sectorTypes: SECTOR_TYPE_IDS.map((id) => {
      const d = SECTOR_TYPES[id];
      return { id, kind: d.kind, mode: d.placement && d.placement.mode, count: rs(d.count), npcListId: d.npcListId, marker: d.marker, fill: d.fill === true };
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
