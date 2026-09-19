/* ===== ui/starfieldConfigView.js —— ★ C-3：星域配置界面（正式主入口） =====
 * 定位（设计文档 §2/§7/§10 阶段 C）：把「星域配置对象」（与内置 `data/starfields/<id>.js` **同格式**）
 *   做成可编辑的正式界面：难度基底 → 种子 → 基础覆写（半径/持续时间）→ 逐类型开关/数量区间/
 *   **默认 NPC 列表（可配置多个）** → ★★ **完整 NPC 列表编辑器（C-3b：内置只读摘要 +
 *   **内嵌自定义列表可编辑**；内嵌列表＝配置根层 `npcLists`，id 以 `custom:` 开头，**不必对应
 *   `data/npcLists/*` 文件**）** → **玩家单位列表（我方初始编队）** → 预览（纯函数）
 *   → 导出（下载 `.json` / 复制）/ 导入（选文件 / 读剪贴板）→ **进入星域**（经 `ui/starfieldSession.js` 唯一持有者）。
 * ★ **唯一口径**（不自算、不硬编码 id）：
 *   · 类型清单＝`SECTOR_TYPE_IDS`、NPC 清单＝`NPC_LIST_IDS`、难度清单＝`STARFIELD_IDS`、
 *     船型＝`SHIP_IDS`（排除 `picker:false`）、模块＝`MODULES`（排除 `picker:false`）——全部注册表驱动；
 *   · 生成＝`generateStarfield(cfg, seed)`、校验＝`validateStarfieldConfig(cfg)`（**同一入口，不自写第二套规则**）；
 *   · NPC 列表字段的**归一**＝`readNpcListIds()`（数组优先、兼容单值 `npcListId`；去重/丢空）；
 *   · 槽位/等级上限＝`resolveShipAtLevel` / `shipLevels` / `moduleMaxLevel`（与 `setupView` 同一来源）；
 *   · 种子＝`core/rng.js randomSeed()`（**全项目唯一允许的非确定性入口，且只在本界面产生**）；
 *   · 时长秒数＝`formatTickSeconds()`（唯一 tick→秒口径）。
 * ★ **只读与安全**：内置配置**深拷贝**后才编辑（绝不改内置对象）；预览/导出/导入**都不创建星域实例**
 *   （只有「进入星域」会 `setStarfield(createStarfield(...))`）。
 * ★ **零回归**：编队测试界面仍只经 `LS.drill()`；本界面不触碰战斗屏与星域地图内部。
 * ★ **编辑态**：保存在模块级（`editCfg/editSeed/editId`）⇒ 切换语言 `repaint()` 后**保留**；
 *   离开视图再回来同样保留（换难度基底时按该配置重新载入）。
 * ★★ **② 导出/导入（本轮改造：界面不再直接显示 JSON 文本）**：
 *   · **导出**＝「下载 `.json` 文件」（`Blob` + `URL.createObjectURL` + 隐藏 `<a download>` 点击），
 *     文件名＝`starfield-<id>-<seed>.json`；附加便利＝「复制到剪贴板」（`navigator.clipboard.writeText`）；
 *   · **导入**＝「选择 JSON 文件」（`<input type="file" accept=".json,application/json">`，`FileReader`/`file.text()`）
 *     ＋「从剪贴板导入」（`navigator.clipboard.readText`，失败 ⇒ 提示改用文件）；
 *   · **降级（确定性、不死路）**：下载/剪贴板**任一不可用**都有明确提示并可改用另一条路；
 *     **下载不可用**（主路径缺失）时导出区**才**出现一个**只读兜底文本框**（`readonly`，供手动复制）；
 *     **文件选择不可用**时导入区出现一个**兜底文本域**（粘贴 JSON 后导入）。
 *     ★ 判据取「主路径不可用」而非「两者都不可用」：剪贴板**运行时**写入失败（权限被拒）同样是死路，
 *       主路径缺失就给文本兜底最稳；**正常路径（下载/选文件可用）绝不显示 JSON 文本**。
 *   · **校验**：导入内容一律走 `validateStarfieldConfig(normalizedCfg(obj))` **同一入口**；
 *     非法 ⇒ 红框 + 逐条原因且**不改动当前编辑内容**；合法 ⇒ 载入编辑区 + 成功提示；
 *   · 导出/导入**深拷贝**，绝不修改内置数据对象、绝不修改传入对象。
 */
import { el } from '../core/utils.js';
import { i18n } from '../i18n/index.js';
import { router } from './router.js';
import { formatTickSeconds } from '../core/tick.js';
import { randomSeed } from '../core/rng.js';
import { generateStarfield } from '../data/starfield.js';
import { createStarfield } from '../systems/starfield.js';
import { SHIPS, SHIP_IDS, shipLevels, shipMaxLevel, resolveShipAtLevel } from '../data/ships.js';
import { MODULES } from '../data/modules.js';
import { moduleMaxLevel } from '../entities/module.js';
import {
  STARFIELD_IDS,
  SECTOR_TYPE_IDS,
  NPC_LIST_IDS,
  NPC_LISTS,
  CUSTOM_NPC_LIST_PREFIX,
  getStarfield,
  getSectorType,
  getNpcList,
  customNpcListIds,
  isCustomNpcListId,
  readNpcListIds,
  resolveNpcList,
  validateStarfieldConfig,
} from '../data/starfieldData.js';
import { setStarfield } from './starfieldSession.js';

/* ---------- 编辑态（模块级 ⇒ 重绘/离开再进入均保留；不触碰内置数据对象） ---------- */
let editId = STARFIELD_IDS[0];
let editCfg = null; // 深拷贝后的编辑中配置（结构同内置 `data/starfields/<id>.js`）
let editSeed = ''; // ★ 种子（唯一输入处；默认随机生成）
let previewOut = null; // 最近一次预览结果（只读展示）
let importMsg = null; // { kind:'ok'|'err', lines:[…] }
let exportMsg = null; // 导出侧提示（下载/复制的结果或不可用说明）
let pendingExportSelect = false; // ★ 复制失败 ⇒ 重绘后重新选中兜底文本框（一次性标记）
/* ★★ C-3b **内嵌列表编辑器的临时态**（都会被重绘清空 ⇒ 不在配置数据里留痕）：
 *   · `inlineMsgs[id]`    ＝ `{ kind:'ok'|'err', text }`（该列表的重命名/删除提示）；
 *   · `inlineConfirm[id]` ＝ 待确认删除的**引用清单**（`refsOf` 的产物；非空 ⇒ 显示确认条）。 */
const inlineMsgs = {};
const inlineConfirm = {};

/** ★ 种子规则（本界面唯一规则，回报中说明）：只允许 `A-Z a-z 0-9 _ -`，长度 1~32 */
const SEED_RE = /^[A-Za-z0-9_-]{1,32}$/;
const clone = (v) => JSON.parse(JSON.stringify(v));

/* ---------- 船型/模块的展示口径（**与 `setupView` 同一来源**：注册表 + 既有解析函数） ---------- */
/** 可编入编队的船型：排除内部模板（`picker === false`，如召唤用 drone） */
const SHIP_TYPE_IDS = SHIP_IDS.filter((id) => SHIPS[id] && SHIPS[id].picker !== false);
/** 可装配的模块清单（排除 `picker:false` 的内部/专属模块） */
const MODULE_IDS = Object.keys(MODULES).filter((id) => !MODULES[id].picker);
const shipName = (type) => (SHIPS[type] ? i18n.t(SHIPS[type].nameKey) : type);
function moduleName(id) {
  const m = MODULES[id];
  if (!m) return id;
  const t = i18n.t(m.nameKey);
  return t && !t.startsWith('??') ? t : m.name || id; // 名称降级占位（体例同 setupView）
}
const shipSlotLimit = (type, level) => Math.max(1, (resolveShipAtLevel(type, level) || {}).slots || 1);

/** ★ NPC 列表**显示名**（内置 id → `npcList.<id>`；内嵌 id → `nameKey`（**仅当词条确实存在**）→ `name`
 *  → id 本体；**绝不显示 `??key`**）—— 内置与内嵌**同一函数**，不硬编码任何 id。 */
function npcListName(id) {
  const list = resolveNpcList(id, editCfg) || {};
  const key = typeof list.nameKey === 'string' ? list.nameKey : '';
  if (key && i18n.has(key)) return i18n.t(key);
  if (typeof list.name === 'string' && list.name) return list.name;
  if (getNpcList(id)) return i18n.t(`npcList.${id}`);
  return id;
}

/** 内嵌列表**占位名**（新建时写入 `name`；用户可在「列表名」输入框里改）：直接用 id 本体 */
const defaultCustomListName = (id) => id;

/* ---------- ★ ② 能力探测与导出/导入的低层动作（**唯一实现**，全部走 try/catch 降级） ---------- */

/** 环境能力（**只做特性探测、不试探性调用**）：下载 / 写剪贴板 / 读剪贴板 / 文件选择 */
function capabilities() {
  const doc = typeof document !== 'undefined' ? document : null;
  const canDownload =
    typeof Blob === 'function' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function' &&
    !!doc &&
    typeof HTMLAnchorElement !== 'undefined' &&
    typeof HTMLAnchorElement.prototype.click === 'function';
  const cb = typeof navigator !== 'undefined' ? navigator.clipboard : null;
  return {
    download: canDownload,
    writeClipboard: !!(cb && typeof cb.writeText === 'function'),
    readClipboard: !!(cb && typeof cb.readText === 'function'),
    fileInput: !!doc && typeof doc.createElement === 'function' && typeof FileReader === 'function',
  };
}

/** ★ 触发浏览器下载（`Blob` + `URL.createObjectURL` + 隐藏 `<a download>`）：
 *  @returns {{ok:boolean, error?:string}} —— **任何一步失败都返回 `ok:false`**（调用方据此降级，不死路） */
function downloadJson(obj, filename) {
  try {
    const text = JSON.stringify(obj, null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // 释放稍后执行（**延迟 10s**：部分浏览器若立即 revoke，会把尚未启动的下载一并取消）
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* 释放失败不影响已触发的下载 */
      }
    }, 10000);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/** ★ 读文本（`file.text()` → 回退 `FileReader`）；失败 ⇒ reject */
function readFileText(file) {
  if (file && typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result == null ? '' : reader.result));
    reader.onerror = () => reject(reader.error || new Error('read error'));
    reader.readAsText(file);
  });
}


/** 载入某难度的**深拷贝**到编辑区（绝不改内置对象） */
function loadBase(id) {
  const base = getStarfield(id) || getStarfield(STARFIELD_IDS[0]) || {};
  editId = base.id || STARFIELD_IDS[0];
  editCfg = clone(base);
  if (!editCfg.sectorTypes) editCfg.sectorTypes = {};
  ensurePlayerUnits(editCfg); // ★ 玩家单位列表归一为数组（缺失/非法形态 ⇒ 空数组）
  if (typeof base.seed === 'string' && base.seed) editSeed = base.seed;
  else if (!editSeed) editSeed = randomSeed(); // 默认随机生成
  previewOut = null;
  importMsg = null;
  exportMsg = null;
}

/** ★ 玩家单位列表字段归一（**纯形态归一，不做内容校验**；内容校验仍只走 `validateStarfieldConfig`）：
 *  · 非数组/缺失 ⇒ `[]`（＝不给初始编队）；
 *  · 逐条把 `modules` 归一为数组；**字符串形式的模块**（外部注入/手改导入）归一为 `{moduleId, level:1}`
 *    （体例同 `setupView.renderFleetColumn` 的兼容处理）。 */
function ensurePlayerUnits(cfg) {
  if (!Array.isArray(cfg.playerUnits)) cfg.playerUnits = [];
  for (const u of cfg.playerUnits) {
    if (!u || typeof u !== 'object') continue;
    if (!Array.isArray(u.modules)) u.modules = [];
    u.modules = u.modules.map((m) => (typeof m === 'string' ? { moduleId: m, level: 1 } : m));
  }
  return cfg.playerUnits;
}

/** ★★ C-3b **内嵌列表的形态归一与引用维护**（纯本地逻辑，**不自写第二套校验规则** ——
 *  结构与单位一律交给 `validateStarfieldConfig` ⇒ 与内置列表同一口径）： */

/** 取（必要时建）编辑配置根层的 `npcLists` 映射；**非对象 ⇒ 重建为空对象**（非法导入的兜底） */
function ensureNpcLists() {
  if (!editCfg.npcLists || typeof editCfg.npcLists !== 'object' || Array.isArray(editCfg.npcLists)) editCfg.npcLists = {};
  return editCfg.npcLists;
}

/** 取某内嵌列表定义（缺失 ⇒ `null`；**不隐式创建** —— 创建只发生在「新建内嵌列表」） */
function customListOf(id) {
  const map = ensureNpcLists();
  const def = map[id];
  return def && typeof def === 'object' && !Array.isArray(def) ? def : null;
}

/** ★ 认领/归一某内嵌列表的**可编辑形态**（纯形态归一，不做内容校验）：
 *  · `name` 非字符串 ⇒ 用 id 兜底（避免非法的 `name: 5` 一类输入被静默保留）；
 *  · `units` 非数组 ⇒ `[]`；逐条把 `modules` 归一为数组、**字符串模块**归一为 `{moduleId, level:1}`。 */
function ensureCustomList(id) {
  const map = ensureNpcLists();
  if (!map[id] || typeof map[id] !== 'object' || Array.isArray(map[id])) map[id] = { units: [] };
  const list = map[id];
  if (typeof list.name !== 'string') list.name = defaultCustomListName(id);
  if (!Array.isArray(list.units)) list.units = [];
  for (const u of list.units) {
    if (!u || typeof u !== 'object') continue;
    if (!Array.isArray(u.modules)) u.modules = [];
    u.modules = u.modules.map((m) => (typeof m === 'string' ? { moduleId: m, level: 1 } : m));
  }
  return list;
}

/** ★ **新建内嵌列表**的 id 分配：`custom:lN` 自 1 起扫描，**避开内置 id 与已有内嵌 id**（扫描避重） */
function nextCustomListId() {
  const map = ensureNpcLists();
  for (let n = 1; ; n += 1) {
    const id = `${CUSTOM_NPC_LIST_PREFIX}l${n}`;
    if (!getNpcList(id) && !Object.prototype.hasOwnProperty.call(map, id)) return id;
  }
}

/** ★ 收集**该内嵌列表的全部引用处**（**只读、不改数据**；供删除规则与只读提示）：
 *  · 逐 `SECTOR_TYPE_IDS` 的 `editCfg.sectorTypes[tid].npcListIds`（`readNpcListIds` 归一后判定）——
 *    ★ 只认**配置覆写**里的引用（**类型定义里的默认集合不在其中**：那份默认值不可由本界面改，
 *    故也不属于「一键解引用」的范围 ⇒ 引用清单与可改范围严格一致，不会出现“点了移除却没变化”）；
 *  · `sideRules.allyNpcListIds`（友方援军列表，同为 NPC 列表引用）。
 *  @returns {{ kind:'type'|'ally', typeId:string|null, name:string }[]} —— 每处一条（同处多次引用只记一条） */
function refsOf(id) {
  const out = [];
  if (!editCfg) return out;
  for (const typeId of SECTOR_TYPE_IDS) {
    const ov = editCfg.sectorTypes && editCfg.sectorTypes[typeId];
    if (!ov || typeof ov !== 'object') continue;
    if (readNpcListIds(ov).includes(id)) out.push({ kind: 'type', typeId, name: i18n.t(`sectorType.${typeId}`) });
  }
  const ally = editCfg.sideRules && editCfg.sideRules.allyNpcListIds;
  if (Array.isArray(ally) && ally.map((x) => (typeof x === 'string' ? x.trim() : x)).includes(id)) {
    out.push({ kind: 'ally', typeId: null, name: i18n.t('starfield.cfg.npcRefAlly') });
  }
  return out;
}

/** 引用清单 → 供 i18n 的行内文本（类型行＝「<类型名>（候选列表）」；友方行＝固定词条） */
const refLabelOf = (r) => (r.kind === 'type' ? i18n.t('starfield.cfg.npcRefType', { name: r.name }) : r.name);

/** ★ **把某内嵌列表从所有引用处摘掉**（**一键解引用**；只改本界面的编辑副本 `editCfg`）：
 *  · 逐类型 `npcListIds` 数组过滤掉该 id（**保留数组形态**，即使变成空 `[]` ＝ 明确「无单位」）；
 *  · `sideRules.allyNpcListIds` 同样过滤；
 *  · **不做隐式回落**：摘掉后就地留空，绝不把引用悄悄换成别的列表。 */
function dropReferencesTo(id) {
  for (const typeId of SECTOR_TYPE_IDS) {
    const ov = editCfg.sectorTypes && editCfg.sectorTypes[typeId];
    if (!ov || typeof ov !== 'object' || !Array.isArray(ov.npcListIds)) continue;
    ov.npcListIds = ov.npcListIds.filter((x) => x !== id);
  }
  const ally = editCfg.sideRules && editCfg.sideRules.allyNpcListIds;
  if (Array.isArray(ally)) editCfg.sideRules.allyNpcListIds = ally.filter((x) => x !== id);
}

/** ★ **删除内嵌列表**（删除前必须已无引用 ⇒ 由调用方保证；本函数只做删除 + 临时态清理） */
function deleteCustomList(id) {
  const map = ensureNpcLists();
  delete map[id];
  delete inlineMsgs[id];
  delete inlineConfirm[id];
  // 引用中若仍有该 id（异常路径）⇒ 保持原样交给校验报错，**不做静默解引用**
}

/** ★ **重命名内嵌列表 id**（同步更新所有引用）：
 *  @returns {{ok:boolean, msg:string}} —— 校验口径与数据层**一致**（前缀 / 冲突 / 重复 / 非空），
 *    **本界面再报一次**只为即时反馈；最终判定仍在 `validateStarfieldConfig`（同一入口）。
 *  · 合法 ⇒ 键名迁移 + 逐处引用改名（含 `sideRules.allyNpcListIds`）+ 保留原**键序**（重建对象以稳序）。 */
function renameCustomList(oldId, raw) {
  const nextId = typeof raw === 'string' ? raw.trim() : '';
  if (!nextId) return { ok: false, msg: i18n.t('starfield.cfg.errNpcIdEmpty') };
  if (!isCustomNpcListId(nextId)) return { ok: false, msg: i18n.t('starfield.cfg.errNpcIdPrefix') };
  if (getNpcList(nextId)) return { ok: false, msg: i18n.t('starfield.cfg.errNpcIdBuiltin', { id: nextId }) };
  const map = ensureNpcLists();
  if (nextId !== oldId && Object.prototype.hasOwnProperty.call(map, nextId)) {
    return { ok: false, msg: i18n.t('starfield.cfg.errNpcIdDup', { id: nextId }) };
  }
  if (nextId === oldId) return { ok: true, msg: '' };
  // 迁移键名（**重建对象保序** ⇒ 导出 JSON 里的内嵌列表顺序不变）
  const rebuilt = {};
  for (const [k, v] of Object.entries(map)) rebuilt[k === oldId ? nextId : k] = v;
  editCfg.npcLists = rebuilt;
  // 同步引用（类型覆写 + 友方援军列表）
  for (const typeId of SECTOR_TYPE_IDS) {
    const ov = editCfg.sectorTypes && editCfg.sectorTypes[typeId];
    if (!ov || typeof ov !== 'object' || !Array.isArray(ov.npcListIds)) continue;
    ov.npcListIds = ov.npcListIds.map((x) => (x === oldId ? nextId : x));
  }
  const ally = editCfg.sideRules && editCfg.sideRules.allyNpcListIds;
  if (Array.isArray(ally)) editCfg.sideRules.allyNpcListIds = ally.map((x) => (x === oldId ? nextId : x));
  return { ok: true, msg: '' };
}

/** 编辑配置里某类型的覆写项（缺失时按**类型定义**的默认区间补一个；不改类型定义本体） */
function typeRow(typeId) {  if (!editCfg.sectorTypes[typeId]) editCfg.sectorTypes[typeId] = { enabled: true };
  const ov = editCfg.sectorTypes[typeId];
  if (!ov.count) {
    const c = (getSectorType(typeId) || {}).count || { min: 0, max: 0 };
    ov.count = { min: c.min, max: c.max };
  }
  // ★ NPC 列表：读取时**统一归一为数组形态** `npcListIds: string[]`（兼容既有单值 `npcListId`），
  //   归一后删掉单值键 ⇒ 界面与导出**只有一种形态**（校验会拦“两种写法并存”）。
  //   ★ **未写该键 ⇒ 取类型定义的默认集合**（＝沿用默认，而不是“改成空集合”）——
  //     与上面 `count` 的取材口径一致（界面展示的永远是**生效值**）。
  if (!Array.isArray(ov.npcListIds)) {
    const wrote = Object.prototype.hasOwnProperty.call(ov, 'npcListIds') || Object.prototype.hasOwnProperty.call(ov, 'npcListId');
    ov.npcListIds = wrote ? readNpcListIds(ov) : readNpcListIds(getSectorType(typeId) || {});
    delete ov.npcListId;
  }
  return ov;
}

/** ★ 校验：表单级（种子/数值/区间）＋**引擎级同一入口** `validateStarfieldConfig` ⇒ 问题字符串数组 */
function problems() {
  const out = [];
  if (!SEED_RE.test(editSeed)) out.push(i18n.t('starfield.cfg.errSeed'));
  const r = Number(editCfg.radius);
  if (!Number.isInteger(r) || r < 1) out.push(i18n.t('starfield.cfg.errRadius'));
  const d = Number(editCfg.durationTicks);
  if (!Number.isInteger(d) || d < 1) out.push(i18n.t('starfield.cfg.errDuration'));
  for (const typeId of SECTOR_TYPE_IDS) {
    const ov = editCfg.sectorTypes[typeId];
    if (!ov || ov.enabled === false) continue;
    const c = ov.count || {};
    const mn = Number(c.min);
    const mx = Number(c.max);
    if (!Number.isInteger(mn) || !Number.isInteger(mx) || mn < 0 || mx < 0 || mn > mx) {
      const def = getSectorType(typeId) || {};
      out.push(i18n.t('starfield.cfg.errCount', { name: i18n.t(def.nameKey || `sectorType.${typeId}`) }));
    }
  }
  // ★★ C-3b **内嵌列表表单级校验**（即时反馈；**结构/单位仍由 `validateStarfieldConfig` 最终判定**——
  //    这里只补两类「引擎看不见」的表单约束：`<input type="number">` 的**空串**与**非整数**，
  //    以及**界面侧的重命名约束**（id 前缀/冲突/重复、名称非空）：
  //    · 引擎的口径是「`count` 应为非负整数」；界面口径固定为**整数 ≥ 1**（本编辑器只做固定数量），
  //      且**空串**（用户清空输入框）在引擎侧经 `normalizedCfgOf` 归一后是 `Number('')===0` ⇒ 会被引擎放过，
  //      故必须在此按**原始输入**拦下；
  //    · 本循环读的是**编辑区原始值**（`editCfg`；与引擎路径的 `normalizedCfg()` 归一结果等价，
  //      `Number(...)` 对数字/数字串结果一致，空串与非法串按上面口径报错）。
  for (const cid of customNpcListIds(editCfg)) {
    const list = customListOf(cid);
    if (!list) continue;
    const name = npcListName(cid);
    if (typeof list.name !== 'string' || !list.name.trim()) out.push(i18n.t('starfield.cfg.errNpcNameEmpty', { id: cid }));
    const units = Array.isArray(list.units) ? list.units : [];
    units.forEach((u, i) => {
      if (!u || typeof u !== 'object') return;
      const n = Number(u.count);
      if (!Number.isInteger(n) || n < 1) out.push(i18n.t('starfield.cfg.errNpcUnitCount', { name, n: i + 1 }));
      const ship = SHIPS[u.shipId] || null;
      const max = ship ? shipMaxLevel(ship) : null;
      const lv = Number(u.level);
      if (max != null && (!Number.isInteger(lv) || lv < 1 || lv > max)) {
        out.push(i18n.t('starfield.cfg.errNpcLevel', { name, n: i + 1, max }));
      }
      const mods = Array.isArray(u.modules) ? u.modules : [];
      mods.forEach((m) => {
        const mid = m && (m.moduleId ?? m.id);
        const mdef = mid ? MODULES[mid] : null;
        if (!mdef) return; // 未知模块交给 `validateStarfieldConfig` 报「未知模块」
        const mmax = moduleMaxLevel(mdef);
        const mlv = m.level === undefined || m.level === null || m.level === '' ? 1 : Number(m.level);
        if (!Number.isInteger(mlv) || mlv < 1 || mlv > mmax) {
          out.push(i18n.t('starfield.cfg.errNpcModuleLevel', { name, n: i + 1, mod: moduleName(mid), max: mmax }));
        }
      });
    });
  }
  // ★ 引擎级：恒星唯一/数量口径/引用合法性…一律由既有唯一函数给出（**不自写第二套规则**）
  let rv = null;
  try {
    // ★★ **缺陷修复（radius 误报真因）**：`<input type="number">` 的 `oninput` 写回的是**字符串**
    //    （如 `"2"`）⇒ 直接把 `editCfg` 交给引擎校验时，引擎的 `Number.isInteger(cfg.radius)` 对字符串
    //    返回 false ⇒ 报「radius 应为 ≥1 的整数（现 2）」（消息里打印的是字符串 `2`，故看起来像误报）。
    //    ⇒ 校验前**统一数字归一**（`normalizedCfg()`：`Number(...)` 转换 radius/durationTicks/各 count），
    //      表单级规则仍对**原始输入**判定（`Number(...)` + 整数/范围）⇒ 真正的非法值照样报错。
    rv = validateStarfieldConfig(normalizedCfg());
  } catch (e) {
    rv = { ok: false, problems: [String((e && e.message) || e)] };
  }
  const engineList = Array.isArray(rv) ? rv : rv && Array.isArray(rv.problems) ? rv.problems : [];
  for (const p of engineList) if (p) out.push(typeof p === 'string' ? p : JSON.stringify(p));
  return out;
}

/** ★ **数字归一**（表单字符串 → 数字；**不改内置数据/入参** —— 先深拷贝再改）：
 *  · `radius`/`durationTicks`/各类型 `count`：`Number(...)`；
 *  · `playerUnits[].count` 与 ★ C-3b `npcLists[*].units[].count`：**非空字符串**才转数字
 *    （空串/非法值原样保留 ⇒ 交给 `validateStarfieldConfig` / 表单级规则报错，不会被悄悄变成 0）；
 *  · 其余字段（含 `npcListIds` / `units[].modules`）**原样透传**（形态归一由数据层负责）。 */
function normalizedCfgOf(input) {
  if (!input || typeof input !== 'object') return input; // 非对象 ⇒ 原样交给校验函数报「配置不是对象」
  const cfg = clone(input);
  cfg.radius = Number(cfg.radius);
  cfg.durationTicks = Number(cfg.durationTicks);
  if (cfg.sectorTypes && typeof cfg.sectorTypes === 'object') {
    for (const typeId of SECTOR_TYPE_IDS) {
      const ov = cfg.sectorTypes[typeId];
      if (ov && ov.count) ov.count = { min: Number(ov.count.min), max: Number(ov.count.max) };
    }
  }
  if (Array.isArray(cfg.playerUnits)) {
    for (const u of cfg.playerUnits) {
      if (u && typeof u.count === 'string' && u.count.trim() !== '') u.count = Number(u.count);
    }
  }
  // ★ C-3b：内嵌列表的单位数量同样归一（`npcLists` 非对象 ⇒ 原样交给校验报错）
  if (cfg.npcLists && typeof cfg.npcLists === 'object' && !Array.isArray(cfg.npcLists)) {
    for (const list of Object.values(cfg.npcLists)) {
      if (!list || typeof list !== 'object' || !Array.isArray(list.units)) continue;
      for (const u of list.units) {
        if (u && typeof u.count === 'string' && u.count.trim() !== '') u.count = Number(u.count);
      }
    }
  }
  return cfg;
}

/** 当前编辑配置的规范化副本（用于校验/预览/导出/进入星域） */
const normalizedCfg = () => normalizedCfgOf(editCfg);

/* ---------- 表单小件（体例沿用既有 `setupView`：字段行 + 输入 + 提示 + 禁用提交） ---------- */
const numInput = (value, oninput, disabled, min) =>
  el('input', {
    class: 'cfg-num',
    type: 'number',
    step: '1',
    min: min == null ? null : String(min), // ★ C-3b：数量输入用 `min:1`（浏览器侧约束；判定仍以校验为准）
    value: String(value == null ? 0 : value),
    oninput,
    disabled: disabled ? 'disabled' : null,
  });

const fieldRow = (labelText, nodes, hint) =>
  el('div', { class: 'cfg-row' }, [
    el('label', { class: 'cfg-label', text: labelText }),
    el('div', { class: 'cfg-field' }, nodes),
    el('div', { class: 'cfg-hint', text: hint || '' }),
  ]);

/* ---------- ★ ⑤ 玩家单位列表编辑区（我方初始编队；字段＝`playerUnits[]`） ---------- */

/** 单个玩家单位条目（船型 / 等级 / 数量 / 模块 / 移除）——「一舰一行」，体例沿用 `setupView` 的编队块 */
function playerUnitRow(units, u, idx, repaint) {
  const shipId = u.shipId;
  // 未知船型（非法导入/手改）也要如实显示 ⇒ 临时并入一项，交给校验报错（不静默吞掉）
  const shipOpts = SHIP_TYPE_IDS.includes(shipId) ? SHIP_TYPE_IDS : [...SHIP_TYPE_IDS, shipId].filter(Boolean);
  const shipSel = el(
    'select',
    {
      class: 'cfg-select',
      'aria-label': i18n.t('starfield.cfg.playerShip'),
      onchange: (e) => {
        u.shipId = e.target.value;
        u.level = 1; // 换船型 ⇒ 等级回 1（上限随船型变；越界由校验拦）
        repaint();
      },
    },
    shipOpts.map((id) => el('option', { value: id, text: shipName(id), selected: id === shipId ? 'selected' : null }))
  );
  const lv = Number(u.level) | 0 || 1;
  const lvSel = el(
    'select',
    {
      class: 'cfg-select',
      'aria-label': i18n.t('starfield.cfg.playerLevel'),
      onchange: (e) => {
        u.level = Number(e.target.value) || 1;
        repaint();
      },
    },
    shipLevels(shipId).map((l) => el('option', { value: String(l), text: `Lv${l}`, selected: l === lv ? 'selected' : null }))
  );
  const cntI = numInput(
    u.count,
    (e) => {
      u.count = e.target.value; // 原文（字符串）⇒ 交给统一校验入口判定；规范化在 `normalizedCfgOf`
      repaint();
    },
    false,
    1
  );
  const mods = Array.isArray(u.modules) ? u.modules : (u.modules = []);
  const slots = shipSlotLimit(shipId, lv);
  const chips = el(
    'span',
    { class: 'cfg-unit-mods' },
    mods.map((m, mi) => {
      const mid = m && (m.moduleId ?? m.id); // 兼容 `id` 写法（与数据层 `expandUnitSpecs` 同一口径）
      const maxLv = moduleMaxLevel(MODULES[mid]);
      const chip = el('span', { class: 'cfg-unit-mod' }, [
        el('button', {
          class: 'chip on drill-mod-chip', // ★ 复用既有模块芯片样式（与 `setupView` 同一体例）
          text: `× ${moduleName(mid)}`,
          title: i18n.t('starfield.cfg.playerRemoveModule'),
          onclick: () => {
            mods.splice(mi, 1);
            repaint();
          },
        }),
      ]);
      if (maxLv > 1) {
        chip.append(
          el(
            'select',
            {
              class: 'cfg-select',
              'aria-label': i18n.t('starfield.cfg.playerModuleLevel', { n: moduleName(mid) }),
              onchange: (e) => {
                m.level = Number(e.target.value) || 1;
                repaint();
              },
            },
            Array.from({ length: maxLv }, (_, i) =>
              el('option', { value: String(i + 1), text: `Lv${i + 1}`, selected: i + 1 === (Number(m.level) | 0 || 1) ? 'selected' : null })
            )
          )
        );
      }
      return chip;
    })
  );
  const addSel = el(
    'select',
    {
      class: 'cfg-select',
      disabled: mods.length >= slots ? 'disabled' : null,
      'aria-label': i18n.t('starfield.cfg.playerAddModule'),
      onchange: (e) => {
        const id = e.target.value;
        if (id && mods.length < slots) mods.push({ moduleId: id, level: 1 });
        repaint();
      },
    },
    [
      el('option', { value: '', text: i18n.t('starfield.cfg.playerAddModule'), selected: 'selected' }),
      ...MODULE_IDS.map((id) => el('option', { value: id, text: moduleName(id) })),
    ]
  );
  return el('div', { class: 'cfg-unit' }, [
    el('div', { class: 'cfg-unit-head' }, [
      el('span', { class: 'cfg-unit-name', text: i18n.t('starfield.cfg.playerUnitN', { n: idx + 1 }) }),
      shipSel,
      lvSel,
      el('span', { class: 'cfg-label', text: i18n.t('starfield.cfg.playerCount') }),
      cntI,
      el('button', {
        class: 'btn tiny ghost',
        text: '×',
        title: i18n.t('starfield.cfg.playerRemove'),
        'aria-label': i18n.t('starfield.cfg.playerRemove'),
        onclick: () => {
          const at = units.indexOf(u);
          if (at >= 0) units.splice(at, 1);
          repaint();
        },
      }),
    ]),
    el('div', { class: 'cfg-unit-slots' }, [
      el('span', { text: i18n.t('starfield.cfg.playerSlots', { n: mods.length, m: slots }) }),
      addSel,
    ]),
    chips,
  ]);
}

/** ★ **玩家单位列表**编辑区（我方初始编队；**阵营恒为我方**）：
 *  · 字段＝星域配置根部 `playerUnits: [{ shipId, count, level, modules }]`（与 NPC 列表 `units[]` 同构）；
 *  · **数量＝固定值**（`count` 非负整数；`countRange` 也支持，但界面只给固定值，说明见回报）；
 *  · 入场星区由上面的「入场星区类型」+ 回退规则决定（预览区有明确一行提示）；
 *  · **内容校验一律交给 `validateStarfieldConfig`**（船型/等级/模块/槽位/数量；UI 不自写规则）。 */
function playerUnitsBlock(repaint) {
  const units = ensurePlayerUnits(editCfg);
  return el('div', { class: 'cfg-panel' }, [
    el('h3', { text: i18n.t('starfield.cfg.playerUnits') }),
    el('p', { class: 'cfg-hint', text: i18n.t('starfield.cfg.playerUnitsHint') }),
    units.length ? el('div', { class: 'cfg-units' }, units.map((u, idx) => playerUnitRow(units, u, idx, repaint))) : null,
    units.length ? null : el('div', { class: 'cfg-hint', text: i18n.t('starfield.cfg.playerUnitsEmpty') }),
    el('div', { class: 'cfg-actions' }, [
      el('button', {
        class: 'btn small',
        text: i18n.t('starfield.cfg.playerAdd'),
        onclick: () => {
          units.push({ shipId: SHIP_TYPE_IDS[0], count: 1, level: 1, modules: [] });
          repaint();
        },
      }),
    ]),
  ]);
}

/* ---------- ★★ C-3b **完整 NPC 列表编辑器**：内置只读摘要 + **内嵌自定义列表（可编辑）** ----------
 * 用户口径：NPC 列表**必须可添加/编辑**，且「**不限定必须使用文件列表**」⇒ 编辑器产出的列表
 *   **内嵌在星域配置根层 `npcLists`**，不必对应 `data/npcLists/*` 文件。
 * ★ 唯一口径（**UI 只读引擎 / 不自算、不硬编码 id**）：
 *   · 列表结构/单位可装配性（船型/等级/槽位/`picker:false`/模块等级）**一律由 `validateStarfieldConfig`
 *     最终判定**；本文件只在表单层补「空串 / 非整数 / ≥1」这类输入框特有的约束（见 `problems()`）；
 *   · 列表解析＝`resolveNpcList(id, editCfg)`（**内置优先 → 本配置内嵌 → 未命中**）；
 *   · 列表名＝`npcListName(id)`（内置走 `npcList.<id>` 词条；内嵌走 `nameKey`（词条存在时）/ `name` / id）；
 *   · 候选下拉＝**内置 id ∪ 本配置内嵌 id**（`NPC_LIST_IDS` + `customNpcListIds`），**不写死任何 id**。
 * ★ 删除规则（**已定稿**）：**默认禁止删除仍被引用的列表** —— 列出「仍被 N 处引用：<类型> …」，
 *   并提供**一键「从这些引用中移除」**（把该 id 从各 `npcListIds` 摘掉）后再删除；**不做静默解引用**。
 * ★ 重命名：**同步更新所有引用**（类型候选集合 + `sideRules.allyNpcListIds`），id 仍须 `custom:` 前缀。 */

/** 单个**内嵌列表单位条目**（一条＝一批同类单位；船型 / 等级 / 数量 / 模块 / 移除）——
 *  字段与内置 `units[]` **完全同构**；交互体例沿用玩家单位行（不新增第二套控件）。 */
function inlineUnitRow(units, u, idx, repaint) {
  const shipId = u.shipId;
  // 未知船型（非法导入/手改）也要如实显示 ⇒ 临时并入一项，交给 `validateStarfieldConfig` 报错（不静默吞掉）
  const shipOpts = SHIP_TYPE_IDS.includes(shipId) ? SHIP_TYPE_IDS : [...SHIP_TYPE_IDS, shipId].filter(Boolean);
  const shipSel = el(
    'select',
    {
      class: 'cfg-select',
      'aria-label': i18n.t('starfield.cfg.npcUnitShip'),
      onchange: (e) => {
        u.shipId = e.target.value;
        u.level = 1; // 换船型 ⇒ 等级回 1（上限随船型变；越界由校验拦）
        repaint();
      },
    },
    shipOpts.map((id) => el('option', { value: id, text: shipName(id), selected: id === shipId ? 'selected' : null }))
  );
  const lv = Number(u.level) | 0 || 1;
  // ★ 等级下拉＝`shipLevels(shipId)`（**1..该船型 maxLevel 的唯一口径**，与 `setupView` 同源）
  const lvSel = el(
    'select',
    {
      class: 'cfg-select',
      'aria-label': i18n.t('starfield.cfg.npcUnitLevel'),
      onchange: (e) => {
        u.level = Number(e.target.value) || 1;
        repaint();
      },
    },
    shipLevels(shipId).map((l) => el('option', { value: String(l), text: `Lv${l}`, selected: l === lv ? 'selected' : null }))
  );
  // ★ 数量＝**固定值**（整数 ≥1）；原文（字符串）交给统一校验入口判定，数字归一在 `normalizedCfgOf`
  const cntI = numInput(
    u.count,
    (e) => {
      u.count = e.target.value;
      repaint();
    },
    false,
    1
  );
  const mods = Array.isArray(u.modules) ? u.modules : (u.modules = []);
  const slots = shipSlotLimit(shipId, lv);
  // ★ 模块下拉＝**过滤 `picker:false`** 的模块清单（`MODULE_IDS`，与玩家单位行同一份）
  const chips = el(
    'span',
    { class: 'cfg-unit-mods' },
    mods.map((m, mi) => {
      const mid = m && (m.moduleId ?? m.id); // 兼容 `id` 写法（与 `expandUnitSpecs` 同一口径）
      const maxLv = moduleMaxLevel(MODULES[mid]);
      const chip = el('span', { class: 'cfg-unit-mod' }, [
        el('button', {
          class: 'chip on drill-mod-chip',
          text: `× ${moduleName(mid)}`,
          title: i18n.t('starfield.cfg.playerRemoveModule'),
          onclick: () => {
            mods.splice(mi, 1);
            repaint();
          },
        }),
      ]);
      if (maxLv > 1) {
        chip.append(
          el(
            'select',
            {
              class: 'cfg-select',
              'aria-label': i18n.t('starfield.cfg.playerModuleLevel', { n: moduleName(mid) }),
              onchange: (e) => {
                m.level = Number(e.target.value) || 1;
                repaint();
              },
            },
            Array.from({ length: maxLv }, (_, i) =>
              el('option', { value: String(i + 1), text: `Lv${i + 1}`, selected: i + 1 === (Number(m.level) | 0 || 1) ? 'selected' : null })
            )
          )
        );
      }
      return chip;
    })
  );
  const addSel = el(
    'select',
    {
      class: 'cfg-select',
      disabled: mods.length >= slots ? 'disabled' : null,
      'aria-label': i18n.t('starfield.cfg.npcAddModule'),
      onchange: (e) => {
        const id = e.target.value;
        if (id && mods.length < slots) mods.push({ moduleId: id, level: 1 });
        repaint();
      },
    },
    [
      el('option', { value: '', text: i18n.t('starfield.cfg.npcAddModule'), selected: 'selected' }),
      ...MODULE_IDS.map((id) => el('option', { value: id, text: moduleName(id) })),
    ]
  );
  return el('div', { class: 'cfg-unit' }, [
    el('div', { class: 'cfg-unit-head' }, [
      el('span', { class: 'cfg-unit-name', text: i18n.t('starfield.cfg.npcUnitN', { n: idx + 1 }) }),
      shipSel,
      lvSel,
      el('span', { class: 'cfg-label', text: i18n.t('starfield.cfg.npcUnitCount') }),
      cntI,
      el('button', {
        class: 'btn tiny ghost',
        text: '×',
        title: i18n.t('starfield.cfg.npcUnitRemove'),
        'aria-label': i18n.t('starfield.cfg.npcUnitRemove'),
        onclick: () => {
          const at = units.indexOf(u);
          if (at >= 0) units.splice(at, 1);
          repaint();
        },
      }),
    ]),
    el('div', { class: 'cfg-unit-slots' }, [
      el('span', { text: i18n.t('starfield.cfg.playerSlots', { n: mods.length, m: slots }) }),
      addSel,
    ]),
    chips,
  ]);
}

/** **内嵌列表的条目编辑区**（`units[]` 增删 + 逐条编辑；**空 units ⇒ 该星区不放单位**） */
function inlineUnitsBlock(id, list, repaint) {
  const units = Array.isArray(list.units) ? list.units : (list.units = []);
  return el('div', { class: 'cfg-inline-units' }, [
    units.length
      ? el('div', { class: 'cfg-units' }, units.map((u, idx) => inlineUnitRow(units, u, idx, repaint)))
      : el('div', { class: 'cfg-hint', text: i18n.t('starfield.cfg.npcUnitsEmpty') }),
    el('div', { class: 'cfg-actions' }, [
      el('button', {
        class: 'btn tiny',
        text: i18n.t('starfield.cfg.npcUnitAdd'),
        onclick: () => {
          units.push({ shipId: SHIP_TYPE_IDS[0], count: 1, level: 1, modules: [] });
          repaint();
        },
      }),
    ]),
  ]);
}

/** **单个内嵌列表卡片**：列表名 / id / 重命名 / 删除（含「仍被引用」拦截与一键解引用）/ 单位条目 */
function inlineListRow(id, repaint) {
  const list = ensureCustomList(id);
  const refs = refsOf(id); // ★ 引用清单（只读；同时驱动「只读提示」与「删除拦截」）
  const msg = inlineMsgs[id] || null;
  const confirmRefs = inlineConfirm[id] || null;
  const nameInput = el('input', {
    class: 'cfg-text cfg-inline-name',
    type: 'text',
    value: typeof list.name === 'string' ? list.name : '',
    placeholder: i18n.t('starfield.cfg.npcNameLabel'),
    'aria-label': i18n.t('starfield.cfg.npcNameLabel'),
    oninput: (e) => {
      list.name = e.target.value; // 原文；「名称非空」由表单级校验判定（`errNpcNameEmpty`）
      repaint();
    },
  });
  // ★ **id 输入框**（重命名的输入处）：默认填当前 id；点「重命名 id」才落库（**校验不过 ⇒ 不改动**）
  const idInput = el('input', {
    class: 'cfg-text cfg-inline-id',
    type: 'text',
    value: id,
    placeholder: `${CUSTOM_NPC_LIST_PREFIX}l1`, // 占位示例＝**前缀常量** + 编号（不写死完整 id）
    'aria-label': i18n.t('starfield.cfg.npcIdLabel'),
    oninput: () => {
      // 仅作输入缓冲，**不即时改名**（避免边打字边改名把引用改花）；点按钮才生效
    },
  });
  const head = el('div', { class: 'cfg-inline-head' }, [
    el('span', { class: 'cfg-label', text: i18n.t('starfield.cfg.npcNameLabel') }),
    nameInput,
    el('span', { class: 'cfg-label', text: i18n.t('starfield.cfg.npcIdLabel') }),
    idInput,
    el('button', {
      class: 'btn tiny',
      text: i18n.t('starfield.cfg.npcRename'),
      title: i18n.t('starfield.cfg.npcRenameHint'),
      onclick: () => {
        const r = renameCustomList(id, idInput.value); // ★ 同步更新所有引用（类型候选集合 + 友方援军列表）
        if (r.ok) delete inlineMsgs[id]; // 改名成功 ⇒ 清掉该 id 的旧提示（失败才留原因）
        else inlineMsgs[id] = { kind: 'err', text: r.msg }; // 校验不过 ⇒ **保持原 id 不变**
        repaint();
      },
    }),
    el('button', {
      class: 'btn tiny ghost',
      text: i18n.t('starfield.cfg.npcDelete'),
      title: i18n.t('starfield.cfg.npcDeleteHint'),
      onclick: () => {
        const now = refsOf(id);
        if (now.length) {
          // ★ **默认禁止删除仍被引用的列表**：列出引用处 + 给出「一键从这些引用中移除」
          inlineConfirm[id] = now;
          inlineMsgs[id] = { kind: 'err', text: i18n.t('starfield.cfg.npcDeleteBlocked', { n: now.length, list: now.map(refLabelOf).join('、') }) };
        } else {
          deleteCustomList(id);
        }
        repaint();
      },
    }),
  ]);
  const refLine = el('div', {
    class: 'cfg-hint',
    text: refs.length
      ? i18n.t('starfield.cfg.npcRefs', { n: refs.length, list: refs.map(refLabelOf).join('、') })
      : i18n.t('starfield.cfg.npcRefsNone'),
  });
  return el('div', { class: 'cfg-inline-list' }, [
    head,
    refLine,
    msg && msg.text ? el('div', { class: `cfg-msg ${msg.kind}` }, [el('div', { text: msg.text })]) : null,
    confirmRefs
      ? el('div', { class: 'cfg-actions' }, [
          el('button', {
            class: 'btn tiny',
            text: i18n.t('starfield.cfg.npcDeleteUnref'),
            title: i18n.t('starfield.cfg.npcDeleteUnrefHint'),
            onclick: () => {
              dropReferencesTo(id); // ★ 一键解引用（逐处摘掉）后再删除 —— 不静默、可见、可撤销（重载回退）
              deleteCustomList(id);
              repaint();
            },
          }),
          el('button', {
            class: 'btn tiny ghost',
            text: i18n.t('starfield.cfg.npcDeleteCancel'),
            onclick: () => {
              delete inlineConfirm[id];
              delete inlineMsgs[id];
              repaint();
            },
          }),
        ])
      : null,
    inlineUnitsBlock(id, list, repaint),
  ]);
}

/** ★★ **完整 NPC 列表区**（内置只读摘要 + 内嵌可编辑）—— 由 `root()` 挂进「星区类型」面板之后。 */
function npcListsBlock(repaint) {
  const ids = customNpcListIds(editCfg);
  return el('div', { class: 'cfg-panel' }, [
    el('h3', { text: i18n.t('starfield.cfg.npcSection') }),
    el('p', { class: 'cfg-hint', text: i18n.t('starfield.cfg.npcSectionHint') }),
    // ① 内置列表（**只读摘要**；引用覆写在上面「星区类型」区）
    el('div', { class: 'cfg-npc-list' }, [
      el('div', { class: 'cfg-npc-title', text: i18n.t('starfield.cfg.npcBuiltinTitle') }),
      ...NPC_LIST_IDS.map((nid) => {
        const list = getNpcList(nid) || {};
        const units = Array.isArray(list.units) ? list.units : [];
        const text = units.length
          ? units
              .map((u) => {
                const cnt = u.countRange ? `${u.countRange[0]}~${u.countRange[1]}` : u.count;
                const mods = Array.isArray(u.modules) ? u.modules.length : 0;
                return `${i18n.t(`ship.${u.shipId}`)} ×${cnt} L${u.level}${mods ? ` [+${mods}]` : ''}`;
              })
              .join(' · ')
          : i18n.t('starfield.cfg.npcEmpty');
        return el('div', { class: 'cfg-npc-item' }, [
          el('span', { class: 'cfg-npc-name', text: i18n.t(`npcList.${nid}`) }),
          el('span', { class: 'cfg-npc-units', text }),
        ]);
      }),
    ]),
    // ② 内嵌列表（**可编辑**：增删列表 / 重命名 / 增删单位条目 / 船型·数量·等级·模块）
    el('div', { class: 'cfg-inline' }, [
      el('div', { class: 'cfg-npc-title', text: i18n.t('starfield.cfg.npcInlineTitle') }),
      el('p', { class: 'cfg-hint', text: i18n.t('starfield.cfg.npcInlineHint') }),
      el('p', { class: 'cfg-hint', text: i18n.t('starfield.cfg.npcIdPrefixHint') }),
      ids.length ? null : el('div', { class: 'cfg-hint', text: i18n.t('starfield.cfg.npcInlineEmpty') }),
      ...ids.map((cid) => inlineListRow(cid, repaint)),
      el('div', { class: 'cfg-actions' }, [
        el('button', {
          class: 'btn small',
          text: i18n.t('starfield.cfg.npcCreate'),
          title: i18n.t('starfield.cfg.npcCreateHint'),
          onclick: () => {
            const nid = nextCustomListId(); // ★ 扫描避重（避开内置 id 与已有内嵌 id）
            ensureCustomList(nid);
            repaint();
          },
        }),
      ]),
    ]),
  ]);
}

/* ---------- 视图 ---------- */
function root() {
  if (!editCfg) loadBase(editId);
  const probs = problems();
  const invalid = probs.length > 0;
  const repaint = () => router.repaint();
  // ★★ C-3b：**NPC 列表候选下拉的选项**＝**内置 id ∪ 本配置内嵌列表 id**（`custom:` 前缀，注册表驱动）
  const npcCandidates = [...NPC_LIST_IDS, ...customNpcListIds(editCfg)];

  // ① 难度/玩法（动态生成；以后新增玩法文件自动出现）
  const idSel = el(
    'select',
    {
      class: 'cfg-select',
      onchange: (e) => {
        loadBase(e.target.value);
        repaint();
      },
    },
    STARFIELD_IDS.map((id) =>
      el('option', { value: id, text: i18n.t(`starfield.${id}`), selected: id === editId ? 'selected' : null })
    )
  );

  // ② ★ 种子（唯一输入处）：输入 + 随机生成；非法 ⇒ 红框 + 禁用「进入星域」
  const seedInput = el('input', {
    class: `cfg-text${SEED_RE.test(editSeed) ? '' : ' invalid'}`,
    type: 'text',
    value: editSeed,
    maxlength: '32',
    oninput: (e) => {
      editSeed = e.target.value.trim();
      repaint();
    },
  });
  const seedBtn = el('button', {
    class: 'btn small',
    text: i18n.t('starfield.cfg.seedRandom'),
    onclick: () => {
      editSeed = randomSeed(); // ★ 唯一非确定性入口
      repaint();
    },
  });

  // ③ 基础覆写：半径（≥1，编码不设上限）／持续时间（≥1，另附秒数提示）
  const radiusInput = numInput(editCfg.radius, (e) => {
    editCfg.radius = e.target.value;
    repaint();
  });
  const durInput = numInput(editCfg.durationTicks, (e) => {
    editCfg.durationTicks = e.target.value;
    repaint();
  });

  // ③b ★ **入场星区类型**（`sideRules.playerEntryTypeId`）：玩家单位生成在**该类型的星区**；
  //     「自动」＝**不写该字段** ⇒ 回退规则（**第一个启用的 `placement.mode:'edges'` 类型**，仍无 ⇒ `#1`）。
  //     ★ 选项来自 `SECTOR_TYPE_IDS`（不硬编码类型 id）。
  const entryVal = (editCfg.sideRules && editCfg.sideRules.playerEntryTypeId) || '';
  const entryOpts = SECTOR_TYPE_IDS.includes(entryVal) ? SECTOR_TYPE_IDS : [...SECTOR_TYPE_IDS, entryVal].filter(Boolean);
  const entrySel = el(
    'select',
    {
      class: 'cfg-select',
      onchange: (e) => {
        if (!editCfg.sideRules || typeof editCfg.sideRules !== 'object') editCfg.sideRules = {};
        if (e.target.value === '__auto__') delete editCfg.sideRules.playerEntryTypeId;
        else editCfg.sideRules.playerEntryTypeId = e.target.value;
        repaint();
      },
    },
    [
      el('option', { value: '__auto__', text: i18n.t('starfield.cfg.entryAuto'), selected: entryVal ? null : 'selected' }),
      ...entryOpts.map((tid) =>
        el('option', {
          value: tid,
          text: i18n.t(getSectorType(tid) ? getSectorType(tid).nameKey || `sectorType.${tid}` : `sectorType.${tid}`),
          selected: entryVal === tid ? 'selected' : null,
        })
      ),
    ]
  );

  // ④ 逐类型：启用开关 + 数量 min/max + 默认 NPC 列表（注册表驱动）
  const typeRows = SECTOR_TYPE_IDS.map((typeId) => {
    const def = getSectorType(typeId) || {};
    const ov = typeRow(typeId);
    const on = ov.enabled !== false;
    const toggle = el('input', {
      type: 'checkbox',
      checked: on ? 'checked' : null,
      onchange: (e) => {
        ov.enabled = !!e.target.checked;
        repaint();
      },
    });
    const minI = numInput(ov.count.min, (e) => { ov.count.min = e.target.value; repaint(); }, !on);
    const maxI = numInput(ov.count.max, (e) => { ov.count.max = e.target.value; repaint(); }, !on);
    // ★ **默认 NPC 列表（可配置多个）**：等价于「候选集合」——生成时**每个该类星区**从集合里
    //   按其自己的子流 `fork('sector:'+index)` **随机抽一个**（空集合 ⇒ 无单位）。
    //   每行＝一个下拉 + 移除按钮；「添加列表」追加一项；类型停用 ⇒ 全部置灰/禁用。
    //   ★★ C-3b：候选＝**内置 id ∪ 本配置内嵌列表 id**（`npcCandidates`；**不写死任何 id**），
    //     下拉显示名走 `npcListName(id)`（内置走 `npcList.<id>` 词条；内嵌走 `nameKey`/`name`/id）。
    const npcWrap = el('span', { class: 'cfg-npc-rows' });
    ov.npcListIds.forEach((nid, i) => {
      // 未知 id（非法配置/手改导入）也要如实显示 ⇒ 临时并入一项，交给校验报错（不静默吞掉）
      const opts = npcCandidates.includes(nid) ? npcCandidates : [...npcCandidates, nid];
      npcWrap.append(
        el('span', { class: 'cfg-npc-row' }, [
          el(
            'select',
            {
              class: 'cfg-select',
              disabled: on ? null : 'disabled',
              onchange: (e) => {
                ov.npcListIds[i] = e.target.value;
                repaint();
              },
            },
            opts.map((id) => el('option', { value: id, text: npcListName(id), selected: id === nid ? 'selected' : null }))
          ),
          el('button', {
            class: 'btn tiny ghost',
            text: '×',
            title: i18n.t('starfield.cfg.npcRemove'),
            'aria-label': i18n.t('starfield.cfg.npcRemove'),
            disabled: on ? null : 'disabled',
            onclick: () => {
              ov.npcListIds.splice(i, 1);
              repaint();
            },
          }),
        ])
      );
    });
    npcWrap.append(
      el('button', {
        class: 'btn tiny',
        text: i18n.t('starfield.cfg.npcAdd'),
        title: i18n.t('starfield.cfg.npcAddHint'),
        disabled: on ? null : 'disabled',
        onclick: () => {
          // 追加时优先选**尚未出现在本类型集合里**的候选（避免刚添加就因重复被校验拦）；
          // ★ C-3b：候选含**本配置内嵌列表**（内置 ∪ 内嵌）⇒ 新建的内嵌列表可立刻被引用
          ov.npcListIds.push(npcCandidates.find((id) => !ov.npcListIds.includes(id)) || NPC_LIST_IDS[0]);
          repaint();
        },
      })
    );
    const tags = [];
    if (def.kind === 'special') tags.push(i18n.t('starfield.cfg.tagSpecial'));
    if (def.fill === true) tags.push(i18n.t('starfield.cfg.tagFill'));
    return el('div', { class: `cfg-type${on ? '' : ' off'}` }, [
      el('label', { class: 'cfg-type-name' }, [toggle, el('span', { text: ` ${i18n.t(def.nameKey || `sectorType.${typeId}`)}` }), ...tags.map((t) => el('em', { class: 'cfg-tag', text: t }))]),
      el('span', { class: 'cfg-type-count' }, [
        el('span', { text: i18n.t('starfield.cfg.min') }),
        minI,
        el('span', { text: i18n.t('starfield.cfg.max') }),
        maxI,
      ]),
      el('span', { class: 'cfg-type-npc' }, [
        el('span', { title: i18n.t('starfield.cfg.typeNpcHint'), text: i18n.t('starfield.cfg.typeNpc') }),
        npcWrap,
      ]),
    ]);
  });

  // ④b NPC 列表区：**内置只读摘要 + 内嵌列表（可编辑）** ⇒ `npcListsBlock()`（见上）

  // ⑥ 预览（**纯函数**：生成结果摘要；不创建星域实例、不改任何引擎状态）
  const previewBtn = el('button', {
    class: 'btn small',
    text: i18n.t('starfield.cfg.preview'),
    disabled: invalid ? 'disabled' : null,
    onclick: () => {
      try {
        previewOut = generateStarfield(normalizedCfg(), editSeed);
      } catch (e) {
        previewOut = { error: String((e && e.message) || e) };
      }
      repaint();
    },
  });
  // ★ **玩家单位入场星区**那一行（编号＝只读 index + 1；类型名走 `sectorType.<id>` 词条；
  //   判定口径＝生成结果里的只读派生 `playerEntryIndex` ⇒ **UI 只读、不自算**）
  const entrySector =
    previewOut && !previewOut.error && Number.isInteger(previewOut.playerEntryIndex)
      ? previewOut.sectors.find((s) => s.index === previewOut.playerEntryIndex)
      : null;
  const playerLine = entrySector
    ? i18n.t('starfield.cfg.playerEntry', {
        n: entrySector.index + 1,
        name: i18n.t(`sectorType.${entrySector.typeId}`),
        q: entrySector.q,
        r: entrySector.r,
      })
    : i18n.t('starfield.cfg.playerEntryNone');
  /* ★★ C-3b **预览追加两行**（只读口径，**UI 不自算生成结果**）：
   *   · 「内嵌列表 N 个」＝本配置根层 `npcLists` 的条目数（`customNpcListIds`）；
   *   · 「被引用的内嵌列表：`custom:l1`(planet)…」＝**逐类型的生效候选集合**里出现的内嵌 id
   *     （读 `typeRow(typeId).npcListIds` ⇒ 与生成器消费的候选表**同一份归一结果**，
   *      故预览里出现的 id 一定真的会参与生成；无内嵌被引用时走「无」的降级行）。 */
  const inlineIdsPreview = customNpcListIds(editCfg);
  const inlineUsed = [];
  for (const typeId of SECTOR_TYPE_IDS) {
    for (const nid of typeRow(typeId).npcListIds) {
      if (isCustomNpcListId(nid) && !inlineUsed.some((x) => x.id === nid)) inlineUsed.push({ id: nid, typeId });
    }
  }
  const inlineCountLine = inlineIdsPreview.length
    ? i18n.t('starfield.cfg.previewNpcInline', { n: inlineIdsPreview.length })
    : i18n.t('starfield.cfg.previewNpcInlineNone');
  const inlineUsedLine = i18n.t('starfield.cfg.previewNpcInlineUsed', {
    list: inlineUsed.length ? inlineUsed.map((x) => `${x.id}(${x.typeId})`).join(' · ') : i18n.t('starfield.cfg.npcRefsNone'),
  });
  const previewText = !previewOut
    ? i18n.t('starfield.cfg.previewNone')
    : previewOut.error
      ? i18n.t('starfield.cfg.previewError', { msg: previewOut.error })
      : [
          i18n.t('starfield.cfg.previewTotal', { n: previewOut.sectors.length, cells: previewOut.layout.cells }),
          i18n.t('starfield.cfg.previewBase', {
            r: previewOut.radius,
            t: previewOut.durationTicks,
            s: formatTickSeconds(previewOut.durationTicks),
          }),
          playerLine,
          inlineCountLine, // ★ C-3b 预览行①：内嵌列表 N 个
          inlineUsedLine, // ★ C-3b 预览行②：被引用的内嵌列表：custom:l1(planet) …
          '',
          ...Object.keys(previewOut.counts).map((tid) => {
            const c = previewOut.counts[tid];
            return `${i18n.t(`sectorType.${tid}`)}: requested=${c.requested} filled=${c.filled} placed=${c.placed}`;
          }),
          '',
          previewOut.warnings && previewOut.warnings.length
            ? previewOut.warnings
                .map((w) => `${w.code}${w.typeId ? ` ${w.typeId}` : ''}${w.filled != null ? ` filled=${w.filled}` : ''}`)
                .join('\n')
            : i18n.t('starfield.cfg.previewNoWarn'),
          '',
          previewOut.sectors
            .filter((s) => s.isStar || (s.placement && s.placement.mode === 'edges'))
            .map((s) => `#${s.index + 1} ${i18n.t(`sectorType.${s.typeId}`)} (${s.q}, ${s.r})`)
            .join(' · '),
        ].join('\n');
  const previewBox = el('pre', { class: 'cfg-preview', text: previewText });

  /* ⑦ ★★ **导出 / 导入**（与内置 `data/starfields/*.js` **同格式**、可 JSON 往返）——
   *   · **正常路径不显示 JSON 文本**：导出＝下载 `.json` 文件（主）+ 复制到剪贴板（便利）；
   *     导入＝选择 `.json` 文件（主）+ 从剪贴板导入（便利）；
   *   · **降级**（逐条提示、不死路）：
   *      – 下载不可用 ⇒ 「下载」禁用 + 明确提示（可改用复制）；剪贴板不可用 ⇒ 「复制」禁用 + 明确提示；
   *      – **下载不可用时展示只读兜底文本框**（供手动复制）；
   *        判据取「下载不可用」（而非「两者都不可用」）的理由：剪贴板**运行时**写入失败（权限被拒）时
   *        同样会落入死路，而下载是设计上的主路径 ⇒ 主路径缺失就给出文本兜底，最稳。
   *      – 文件选择不可用 ⇒ 展示**粘贴 JSON 兜底文本域** + 「导入」按钮（同上理由）。 */
  const cap = capabilities();
  const exportObj = normalizedCfg();
  exportObj.seed = editSeed; // 种子随配置一并导出（内置配置亦有 `seed` 字段）
  const exportName = `starfield-${exportObj.id || editId}-${editSeed || 'seed'}.json`;
  const exportJson = () => JSON.stringify(exportObj, null, 2);

  const exportText = !cap.download
    ? el('textarea', { class: 'cfg-io cfg-export-fallback', rows: '8', readonly: 'readonly' })
    : null;
  if (exportText) exportText.value = exportJson(); // 仅兜底路径才出现（正常路径不展示 JSON）

  const downloadBtn = el('button', {
    class: 'btn small',
    text: i18n.t('starfield.cfg.download'),
    disabled: cap.download ? null : 'disabled',
    onclick: () => {
      if (!cap.download) {
        exportMsg = i18n.t('starfield.cfg.downloadUnsupported');
        repaint();
        return;
      }
      const r = downloadJson(exportObj, exportName);
      exportMsg = r.ok
        ? i18n.t('starfield.cfg.downloaded', { name: exportName })
        : i18n.t('starfield.cfg.downloadFail', { msg: r.error || '' });
      repaint();
    },
  });
  const copyBtn = el('button', {
    class: 'btn small',
    text: i18n.t('starfield.cfg.copy'),
    disabled: cap.writeClipboard ? null : 'disabled',
    onclick: () => {
      const finish = (ok) => {
        if (ok) exportMsg = i18n.t('starfield.cfg.copied');
        else if (exportText) {
          pendingExportSelect = true; // ★ 重绘后再选中（重绘会重建 DOM，当场 select 会被丢掉）
          exportMsg = i18n.t('starfield.cfg.copyFail');
        } else exportMsg = i18n.t('starfield.cfg.copyUnsupported'); // 改用「下载 JSON 文件」
        repaint();
        if (pendingExportSelect) {
          pendingExportSelect = false;
          const t = typeof document !== 'undefined' ? document.querySelector('.cfg-export-fallback') : null;
          if (t && typeof t.select === 'function') {
            t.focus();
            t.select(); // 兜底路径：选中全文，用户 Ctrl+C 即可
          }
        }
      };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(exportJson()).then(() => finish(true), () => finish(false));
        } else finish(false);
      } catch {
        finish(false);
      }
    },
  });

  /** ★ **导入的唯一处理链**（文件 / 剪贴板 / 兜底文本域**三条路共用**）：
   *  解析 → **数字归一** → `validateStarfieldConfig`（**与「进入星域」同一入口**）→
   *  非法：红框 + 逐条原因且**不改动当前编辑内容**；合法：**深拷贝**载入编辑区 + 成功提示。 */
  const applyImport = (text) => {
    let obj = null;
    try {
      obj = JSON.parse(String(text == null ? '' : text));
    } catch (e) {
      importMsg = { kind: 'err', lines: [i18n.t('starfield.cfg.importParse', { msg: String((e && e.message) || e) })] };
      repaint();
      return;
    }
    let rv = null;
    try {
      rv = validateStarfieldConfig(normalizedCfgOf(obj));
    } catch (e) {
      rv = { ok: false, problems: [String((e && e.message) || e)] };
    }
    const list = Array.isArray(rv) ? rv : rv && Array.isArray(rv.problems) ? rv.problems : [];
    const okFlag = list.length === 0 && !(rv && rv.ok === false);
    if (!okFlag) {
      importMsg = {
        kind: 'err',
        lines: [i18n.t('starfield.cfg.importFail'), ...list.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)))],
      };
      repaint();
      return;
    }
    editCfg = clone(obj); // ★ 深拷贝：绝不与导入对象共享引用（更不改内置数据）
    if (!editCfg.sectorTypes) editCfg.sectorTypes = {};
    ensurePlayerUnits(editCfg);
    if (typeof editCfg.seed === 'string' && editCfg.seed) editSeed = editCfg.seed;
    if (editCfg.id) editId = editCfg.id;
    previewOut = null;
    importMsg = { kind: 'ok', lines: [i18n.t('starfield.cfg.importOk')] };
    repaint();
  };

  const importHint = el('div', { class: 'cfg-hint', text: i18n.t('starfield.cfg.importFileHint') });
  const fileInput = cap.fileInput
    ? el('input', {
        class: 'cfg-file',
        type: 'file',
        accept: '.json,application/json',
        'aria-label': i18n.t('starfield.cfg.importFile'),
        onchange: (e) => {
          const f = e.target.files && e.target.files[0];
          if (!f) return;
          readFileText(f).then(
            (txt) => applyImport(txt),
            (err) => {
              importMsg = { kind: 'err', lines: [i18n.t('starfield.cfg.importReadFail', { msg: String((err && err.message) || err) })] };
              repaint();
            }
          );
        },
      })
    : null;
  const clipImportBtn = el('button', {
    class: 'btn small',
    text: i18n.t('starfield.cfg.importClipboard'),
    disabled: cap.readClipboard ? null : 'disabled',
    onclick: () => {
      if (!cap.readClipboard) {
        importMsg = { kind: 'err', lines: [i18n.t('starfield.cfg.importClipboardUnsupported')] };
        repaint();
        return;
      }
      navigator.clipboard.readText().then(
        (txt) => applyImport(txt),
        () => {
          // ★ 读剪贴板失败 ⇒ **明确提示改用文件**（不死路）
          importMsg = { kind: 'err', lines: [i18n.t('starfield.cfg.importClipboardFail')] };
          repaint();
        }
      );
    },
  });
  // 兜底（仅文件选择不可用时出现）：粘贴 JSON 文本域 + 「导入」按钮
  const importText = !cap.fileInput ? el('textarea', { class: 'cfg-io', rows: '8' }) : null;
  const importPasteBtn = importText
    ? el('button', {
        class: 'btn small',
        text: i18n.t('starfield.cfg.importBtn'),
        onclick: () => applyImport(importText.value),
      })
    : null;

  // ⑧ 进入星域（校验通过 ⇒ 唯一创建路径：容器 + 会话持有者）
  const enterBtn = el('button', {
    class: 'btn primary',
    text: i18n.t('starfield.cfg.enter'),
    disabled: invalid ? 'disabled' : null,
    onclick: () => {
      if (problems().length) return; // 双保险（按钮已禁用）
      setStarfield(createStarfield(normalizedCfg(), editSeed));
      router.show('starfieldMap');
    },
  });

  const backBtn = el('button', {
    class: 'btn small',
    text: i18n.t('menu.back'),
    onclick: () => router.show('menu'),
  });

  const importBox = importMsg
    ? el('div', { class: `cfg-msg ${importMsg.kind}` }, importMsg.lines.map((t) => el('div', { text: t })))
    : null;
  /** 能力提示行（**只在缺能力时出现**）：下载/复制/剪贴板读取不可用 ⇒ 明确告知可改用哪条路 */
  const capHints = [
    cap.download ? null : el('div', { text: i18n.t('starfield.cfg.downloadUnsupported') }),
    cap.writeClipboard ? null : el('div', { text: i18n.t('starfield.cfg.copyUnsupported') }),
    !cap.fileInput && !cap.readClipboard ? el('div', { text: i18n.t('starfield.cfg.importFallbackHint') }) : null,
  ].filter(Boolean);

  return el('section', { class: 'screen screen-starcfg' }, [
    el('div', { class: 'cfg-head' }, [
      el('h2', { text: i18n.t('starfield.cfg.title') }),
      el('p', { class: 'cfg-sub', text: i18n.t('starfield.cfg.subtitle') }),
    ]),
    el('div', { class: 'cfg-panel' }, [
      fieldRow(i18n.t('starfield.cfg.difficulty'), [idSel], i18n.t('starfield.cfg.difficultyHint')),
      fieldRow(i18n.t('starfield.cfg.seed'), [seedInput, seedBtn], i18n.t('starfield.cfg.seedHint')),
      fieldRow(i18n.t('starfield.cfg.radius'), [radiusInput], i18n.t('starfield.cfg.radiusHint')),
      fieldRow(i18n.t('starfield.cfg.duration'), [durInput], i18n.t('starfield.cfg.durationHint', { s: formatTickSeconds(Number(editCfg.durationTicks) || 0) })),
      fieldRow(i18n.t('starfield.cfg.entryType'), [entrySel], i18n.t('starfield.cfg.entryTypeHint')),
    ]),
    el('div', { class: 'cfg-panel' }, [el('h3', { text: i18n.t('starfield.cfg.types') }), ...typeRows]),
    npcListsBlock(repaint), // ★★ C-3b：完整 NPC 列表编辑器（内置只读摘要 + 内嵌列表可编辑）
    playerUnitsBlock(repaint), // ★ 玩家单位列表（我方初始编队；入场星区见预览行）
    el('div', { class: 'cfg-panel' }, [
      el('h3', { text: i18n.t('starfield.cfg.previewTitle') }),
      el('div', { class: 'cfg-actions' }, [previewBtn]),
      previewBox,
    ]),
    el('div', { class: 'cfg-panel' }, [
      el('h3', { text: i18n.t('starfield.cfg.ioTitle') }),
      el('div', { class: 'cfg-io-wrap' }, [
        el('div', { class: 'cfg-io-col' }, [
          el('div', { class: 'cfg-io-title', text: i18n.t('starfield.cfg.export') }),
          el('div', { class: 'cfg-actions' }, [downloadBtn, copyBtn]),
          exportText, // ★ 仅兜底路径（下载不可用）才出现；正常路径不展示 JSON
          exportMsg ? el('div', { class: 'cfg-hint', text: exportMsg }) : null,
        ]),
        el('div', { class: 'cfg-io-col' }, [
          el('div', { class: 'cfg-io-title', text: i18n.t('starfield.cfg.import') }),
          el('div', { class: 'cfg-actions' }, [fileInput, clipImportBtn, importPasteBtn]),
          importHint,
          importText, // ★ 仅兜底路径（文件选择不可用）才出现
        ]),
      ]),
      capHints.length ? el('div', { class: 'cfg-hint' }, capHints) : null,
      importBox,
    ]),
    invalid
      ? el('div', { class: 'cfg-errors' }, probs.map((p) => el('div', { text: p })))
      : el('div', { class: 'cfg-ok', text: i18n.t('starfield.cfg.noErrors') }),
    el('div', { class: 'cfg-actions' }, [enterBtn, backBtn]),
  ]);
}

export const starfieldConfigView = { root };
export default starfieldConfigView;
