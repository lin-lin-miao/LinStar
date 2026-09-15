/* ===== ui/setupView.js —— 演练编队配置界面（沙盘 · 单一职责） =====
 * 职责：**只做编队编辑与开战前预检** —— 单位类型/等级/定位、模块装配与模块等级、双方编队增删。
 * 不持有战斗对象、不渲染战斗屏、不碰 tick。
 *
 * ★ 与战斗屏的解耦方式＝**回调注入**（`onStart(formation)` / `onExit()`）：
 *   本文件**不 import `battleView.js`**，因此不存在模块循环依赖；谁挂载谁负责给回调。
 *
 * ★ 校验口径唯一：开战前预检调用 `systems/battle.js` 的 `normalizeFormation()` —— **与引擎开战
 *   完全同一个函数**（等级钳制 / 模块合法性 / 槽位截断），UI **不自算**任何数值或槽位规则；
 *   预检有告警 → 明确提示并**禁用「开战」**（不允许确认）。
 *
 * ★ 编队数据结构（ShipCfg，敌我各一份数组；也是 `startBattle` 的入参结构）：
 *   { type:'combat', level:1, role?:'combat'|'logistics', modules:[{ moduleId:'cannon', level:1 }] }
 *   · `type`  船型 id（取自 `data/ships/index.js SHIPS`，**动态**生成可选列表；`picker:false` 的
 *     内部模板（如召唤用的 `drone`）不进入编队可选）。
 *   · `level` 船型等级（`shipLevels(type)` → 1..maxLevel）。
 *   · `role`  单位定位：**不写＝用船型默认值**（`data/ships/<id>.js` 的 `role`，兜底 'combat'）；
 *     一旦在界面里选择即写入本字段（覆盖船型默认）。战斗界面据此决定显示在【战斗单位栏】或【后勤单位栏】。
 *   · `modules` 模块数组（超槽位由引擎规范化时截断，并在预检中先行提示）。
 *
 * ★ 星区（战斗场景）设定：`{ sector: { name, oreReserve, cargos } }` **与双方编队同级**随开战入口一起提交
 *   （`getFormation()` / `onStart(formation)` / `normalizeFormation()` 同一条链）。
 *   · `name`      用户自定义名称：**原样提交、UI 不做 i18n**（战斗屏按引擎 `battle.sector` 原样显示）；
 *   · `oreReserve` 矿物储量：**输入格式校验＝非负整数**（本文件唯一自校验项；非法 → 提示 + 禁用「开战」），
 *     真实缺省/钳制仍由引擎唯一口径 `normalizeSector()` 负责（缺省值登记在 `data/sector.js`）。
 *   · `cargos`    星区**货物设定项**数组：每项＝`{ templateId, name, tons, level }`
 *     （**类型 id / 装载时间 / 加成系数不可提交**——一律随所选类型与等级解析而来，缺省/非法字段由引擎取定义值或钳制）；
 *     · 交互＝**类型（None + 6 种零件）+ 数量批量添加**（数量展开为**独立实例**，与引擎口径一致：一个货物＝一个实体），
 *       逐条可改**名称/吨位/等级**；**类型由所选类型决定、不可编辑**（与“边框色＝类型色”口径一致）；
 *       **装载时间不可编辑**（随等级解析，界面以只读小字「装载 15s」呈现，秒换算走唯一口径 `core/tick.js`）；
 *     · 校验：**吨位＝非负整数、等级＝1..该类型 `maxLevel` 的整数**（非法 → 红框提示 + 禁用「开战」）；
 *       **数量＝≥1 整数**（非法只禁用「添加货物」按钮 —— 它不是提交数据，不该拦开战）；
 *     · 上限一律读 `data/cargo.js CARGO_LIMITS` / `data/cargos/index.js cargoMaxLevel`（**与引擎同一来源**，不硬编码数值）。
 */
import { el } from '../core/utils.js';
import { i18n } from '../i18n/index.js';
import { SHIPS, SHIP_IDS, shipLevels, resolveShipAtLevel } from '../data/ships.js';
import { MODULES } from '../data/modules.js';
import { SECTOR_DEFAULTS } from '../data/sector.js';
import { CARGO_LIMITS, CARGO_IDS, getCargo, cargoMaxLevel, resolveCargoAtLevel } from '../data/cargo.js';
import { moduleMaxLevel } from '../entities/module.js';
import { formatTickSeconds } from '../core/tick.js';
import { normalizeFormation } from '../systems/battle.js';

/** 可被玩家选装的模块清单（排除内部模块如 rocketWarhead，其仅随召唤携带；与 modules.js 的 picker 约定一致） */
const MODULE_IDS = Object.keys(MODULES).filter((id) => !MODULES[id].picker);
/** 可编入编队的船型：排除内部模板（`picker === false`，如召唤用 drone） */
const SHIP_TYPE_IDS = SHIP_IDS.filter((id) => SHIPS[id] && SHIPS[id].picker !== false);
/** 敌方侧默认编队（与我方同一默认：1 艘战斗舰，保持既有开箱体验） */
const DEFAULT_SHIPS = () => [{ type: 'combat', level: 1, modules: [] }];

let allyShips = DEFAULT_SHIPS();  // 我方编队（编辑态）
let enemyShips = DEFAULT_SHIPS(); // 敌方编队（编辑态）
/* 星区（战斗场景）编辑态：名称＝用户自定义字符串（UI **原样显示、不做 i18n**）；
 * 储量＝**输入框原文**（字符串，便于做“非负整数”校验；提交时再转 Number，交给引擎规范化钳制）。
 * 缺省值取自 `data/sector.js SECTOR_DEFAULTS`（数值不在本文件硬编码）。 */
let sectorName = SECTOR_DEFAULTS.name;
let sectorOreText = String(SECTOR_DEFAULTS.oreReserve);
/* 星区货物编辑态：每项＝**一个货物实例**（与引擎口径一致：货物**不是数值累积**）。
 * · `count` 只在「添加」时使用（批量展开为多条），**不进入编辑态/提交结构**；
 * · `tonsText`/`levelText` 存**输入框原文**（便于做整数校验；提交时转 Number，交给引擎钳制）；
 * · **类型**（`templateId`）由所选类型决定、不可编辑；**装载时间/加成系数**不可编辑，
 *   随等级解析（装载时间的秒数取自 `core/tick.js formatTickSeconds`，UI 不自算 tick→秒 公式）。 */
let cargos = [];
let host = null;                  // 挂载点（战斗屏的 stageArea）
let hooks = { onStart: null, onExit: null };

/* ---------- 小工具 ---------- */

function moduleName(id) {
  const m = MODULES[id];
  if (!m) return id;
  const t = i18n.t(m.nameKey);
  return t && !t.startsWith('??') ? t : (m.name || id); // 名称降级占位：i18n 缺失时用模块 name/id
}
function shipName(type) {
  return SHIPS[type] ? i18n.t(SHIPS[type].nameKey) : type;
}
/** 该船型在该等级下的槽位数（唯一口径＝`resolveShipAtLevel`；与建单位后的 `ship.slots` 一致） */
function shipSlotLimit(type, level) {
  return Math.max(1, (resolveShipAtLevel(type, level) || {}).slots || 1);
}
/** 该船型的默认定位（船型数据 `role`，兜底 'combat'） */
function shipRoleDefault(type) {
  return (SHIPS[type] && SHIPS[type].role) === 'logistics' ? 'logistics' : 'combat';
}
/** 编队条目 → 深拷贝（避免编辑态与快照互相影响） */
function cloneShips(list) {
  return list.map((s) => {
    const o = { type: s.type, level: s.level | 0 || 1, modules: (s.modules || []).map((m) => ({ ...m })) };
    if (s.role) o.role = s.role;
    return o;
  });
}
/** 星区数据 → 快照（随编队一并交给开战入口；钳制/缺省由引擎 `normalizeFormation` 统一处理） */
function cloneSector() {
  return {
    name: sectorName,
    oreReserve: oreReserveValid(sectorOreText) ? Number(sectorOreText.trim()) : null,
    cargos: cloneCargos(),
  };
}
/** 星区货物编辑态 → 提交用的**设定项**数组（`sector.cargos` 的形状；缺省/非法字段交引擎兜底）。
 *  · 只提交 `{ templateId, name, tons, level }` —— **类型 id / 装载时间 / 加成系数不可覆写**
 *    （它们随所选类型与等级解析而来，引擎侧同样拒绝覆写）；
 *  · `tons`/`level` 非法时提交 `null` ⇒ 引擎回退**该类型定义的对应值**（与星区储量的“非法即禁用开战”同一处置）；
 *  · `count` **不提交**（添加时已展开为独立条目）。 */
function cloneCargos() {
  return cargos.map((c) => ({
    templateId: c.templateId,
    name: c.name,
    tons: tonsValid(c.tonsText) ? Number(c.tonsText.trim()) : null,
    level: levelValid(c) ? Number(c.levelText.trim()) : null,
  }));
}
/** ★ 星区矿物储量输入校验（唯一口径）：**非负整数**（纯数字；空串/小数/负号/其它字符 → 非法）。 */
function oreReserveValid(text) {
  return /^\d+$/.test(String(text == null ? '' : text).trim());
}
/** ★ 货物**吨位**输入校验：非负整数（与矿物储量同一体例） */
function tonsValid(text) {
  return /^\d+$/.test(String(text == null ? '' : text).trim());
}
/** 该货物编辑条目所选类型的最大等级（唯一口径＝`data/cargos/index.js cargoMaxLevel`） */
function cargoMaxLevelOf(c) {
  return cargoMaxLevel(c.templateId) || 1;
}
/** ★ 货物**等级**输入校验：1..该类型 `maxLevel` 的整数（上限随所选类型而变，故传整条编辑条目） */
function levelValid(c) {
  const t = String((c && c.levelText) == null ? '' : c.levelText).trim();
  if (!/^[1-9]\d*$/.test(t)) return false;
  return Number(t) <= cargoMaxLevelOf(c);
}
/** ★ 货物**数量**（批量添加用）输入校验：≥1 的正整数 */
function cargoCountValid(text) {
  return /^[1-9]\d*$/.test(String(text == null ? '' : text).trim());
}
/** 当前货物编辑态是否**全部合法**（吨位/等级）；非法 → 调用方禁用「开战」（与星区储量同一处置） */
function cargosAllValid() {
  return cargos.every((c) => tonsValid(c.tonsText) && levelValid(c));
}
/** 星区设定编辑行（名称输入框 + 矿物储量输入框 + 非法提示）：
 *  · 输入即写回编辑态；储量非法 → 就地提示「须为非负整数」并由调用方**禁用「开战」**（与预检告警同一处置）；
 *  · 不在输入时整屏重绘（避免丢焦点）：就地更新提示，并通过 `onValidityChange()` 通知调用方刷新开战按钮
 *    （**无参回调**：调用方自行综合“星区储量 + 星区货物”的全部合法性后决定按钮状态）。 */
function sectorBlock(onValidityChange) {
  const nameInput = el('input', {
    class: 'drill-sector-name',
    type: 'text',
    maxlength: '40',
    placeholder: i18n.t('battle.drill.sectorNamePh'),
    'aria-label': i18n.t('battle.drill.sectorName'),
  });
  nameInput.value = sectorName; // property 赋值（避免被当作字符串属性）
  const oreInput = el('input', {
    class: 'drill-sector-ore',
    type: 'text',
    inputmode: 'numeric',
    'aria-label': i18n.t('battle.drill.sectorOreLabel'),
  });
  oreInput.value = sectorOreText;
  const oreErr = el('div', { class: 'drill-warn-text' });
  const syncOre = () => {
    const ok = oreReserveValid(sectorOreText);
    oreErr.textContent = ok ? '' : i18n.t('battle.drill.sectorOreInvalid');
    oreErr.classList.toggle('hidden', ok);
    oreInput.classList.toggle('invalid', !ok);
    if (typeof onValidityChange === 'function') onValidityChange();
  };
  nameInput.addEventListener('input', () => { sectorName = nameInput.value; });
  oreInput.addEventListener('input', () => { sectorOreText = oreInput.value; syncOre(); });
  syncOre();
  return el('div', { class: 'drill-sector' }, [
    el('div', { class: 'zone-label', text: i18n.t('battle.drill.sector') }),
    el('div', { class: 'drill-sector-row' }, [
      el('span', { class: 'drill-sector-cap', text: i18n.t('battle.drill.sectorName') }),
      nameInput,
      el('span', { class: 'drill-sector-cap', text: i18n.t('battle.drill.sectorOreLabel') }),
      oreInput,
    ]),
    oreErr,
  ]);
}

/** ★ 星区设定·**货物设定**（类型＝None + 6 种零件；一货一文件，注册表 `data/cargos/index.js`）：
 *  · **添加**：**类型**下拉（由注册表 `CARGO_IDS` / `getCargo().nameKey` **动态生成**，不硬编码任何货物）
 *    + 数量输入 + 「添加货物」；数量＝**展开为 N 个独立条目**（一个货物＝一个实体，与引擎口径一致），
 *    数量非法 → 红框 + 禁用「添加」；
 *  · **逐条编辑**：名称（**默认取类型名**：留空即回退类型名，见下方 placeholder）/ 吨位 / 等级；
 *    · **类型由所选类型决定、不可编辑** —— 以一个**类型芯片**呈现（文字色/边框色＝该类型代表色
 *      `colorKey` 指向的 CSS 变量，UI 不硬编码色值），与战斗屏货物芯片同一套配色；
 *    · **装载时间不可编辑**（随等级解析）：以只读小字「装载 15s」呈现，秒换算走**唯一口径**
 *      `core/tick.js formatTickSeconds`（UI 不自算 tick→秒 公式）；等级变化即就地重算显示；
 *  · **校验**：吨位＝非负整数、**等级＝1..该类型 `maxLevel` 的整数** —— 非法 → 该输入框红框 + 就地提示
 *    + **禁用「开战」**（与星区储量同一处置体例）；数量非法只拦「添加」按钮（它不是提交数据）；
 *  · **上限**：**总件数不限**（用户口径：编队定义阶段**不封顶**，可无限添加货物条目；引擎
 *    `normalizeSectorCargos` 亦不按总数截断 ⇒ 再无 `cargoOverflow` 告警）——唯一保留的“数量”限制是
 *    **单次输入的便捷上限** `CARGO_LIMITS.maxCountPerEntry`（一次批量添加的条数，不是总量限制）；
 *  · 校验仍保留**字段级**（名称长度、吨位/等级合法性 —— 与引擎同一来源 `CARGO_LIMITS`/`cargoMaxLevel`）；
 *  · 输入过程中**不整屏重绘**（避免丢焦点）：就地刷新提示与合法性，经 `onValidityChange()` 通知调用方。 */
function cargoBlock(onValidityChange) {
  // ★ 类型下拉：**动态取自货物注册表**（顺序＝`CARGO_IDS`，None 在前）
  const tplSel = el(
    'select',
    { class: 'drill-cargo-tpl', 'aria-label': i18n.t('battle.drill.cargoTplLabel') },
    CARGO_IDS.map((id) => el('option', { value: id, text: i18n.t(getCargo(id).nameKey) }))
  );
  let countText = '1';
  const countInput = el('input', {
    class: 'drill-cargo-count',
    type: 'text',
    inputmode: 'numeric',
    'aria-label': i18n.t('battle.drill.cargoCountLabel'),
  });
  countInput.value = countText;
  const addBtn = el('button', { class: 'btn small', text: i18n.t('battle.drill.cargoAdd') });
  const errEl = el('div', { class: 'drill-warn-text hidden' });
  const emptyEl = el('div', { class: 'drill-cargo-empty', text: i18n.t('battle.drill.cargoEmpty') });
  const listEl = el('div', { class: 'drill-cargo-list' });

  /** 汇总提示（数量/吨位/等级非法项）+ 通知调用方刷新「开战」可用性 */
  const syncHint = () => {
    const msgs = [];
    if (!cargoCountValid(countText)) msgs.push(i18n.t('battle.drill.cargoCountInvalid'));
    if (cargos.some((c) => !tonsValid(c.tonsText))) msgs.push(i18n.t('battle.drill.cargoTonsInvalid'));
    if (cargos.some((c) => !levelValid(c))) {
      // 等级上限随所选类型而变 ⇒ 文案带上当前上限（最严的一条：取最小上限，避免误导）
      const maxes = cargos.filter((c) => !levelValid(c)).map((c) => cargoMaxLevelOf(c));
      msgs.push(i18n.t('battle.drill.cargoLevelInvalid', { max: Math.min(...maxes) }));
    }
    errEl.textContent = msgs.join(' / ');
    errEl.classList.toggle('hidden', !msgs.length);
    if (typeof onValidityChange === 'function') onValidityChange();
  };
  const syncCount = () => {
    const ok = cargoCountValid(countText);
    countInput.classList.toggle('invalid', !ok);
    addBtn.disabled = !ok; // ★ 总件数**不封顶**（用户口径）⇒ 只按“单次数量是否合法”决定可否添加
    syncHint();
  };

  /** 单个货物条目（**类型芯片** / 名称 / 吨位 / 等级 / 装载时间 / 移除）—— 逐条独立成体 */
  const cargoItem = (c) => {
    const tpl = getCargo(c.templateId) || getCargo(CARGO_IDS[0]);
    // ★ 类型芯片：只读；**类型色**取自定义的 `colorKey`（CSS 变量名）⇒ UI 不硬编码色值
    const typeEl = el('span', {
      class: 'drill-cargo-type',
      text: i18n.t(tpl.nameKey),
      title: i18n.t('battle.drill.cargoType'),
    });
    typeEl.style.setProperty('--chip-color', `var(${tpl.colorKey || '--cat-none'})`);
    const nameInput = el('input', {
      class: 'drill-cargo-name',
      type: 'text',
      maxlength: String(CARGO_LIMITS.nameLen),
      placeholder: i18n.t(tpl.nameKey), // 默认取类型名：名称留空即回退类型名（引擎侧同样以 nameKey 兜底）
      'aria-label': i18n.t('battle.drill.cargoName'),
    });
    nameInput.value = c.name;
    const tonsInput = el('input', {
      class: 'drill-cargo-tons',
      type: 'text',
      inputmode: 'numeric',
      'aria-label': i18n.t('battle.drill.cargoTons'),
    });
    tonsInput.value = c.tonsText;
    const levelInput = el('input', {
      class: 'drill-cargo-level',
      type: 'text',
      inputmode: 'numeric',
      'aria-label': i18n.t('battle.drill.cargoLevel'),
    });
    levelInput.value = c.levelText;
    // 装载时间＝**只读派生值**（随等级解析；秒换算唯一口径 core/tick.js）
    const loadEl = el('span', { class: 'drill-cargo-load', text: '' });
    const item = el('div', { class: 'drill-cargo-item' }, [
      typeEl,
      nameInput,
      tonsInput,
      levelInput,
      loadEl,
      el('button', {
        class: 'btn small',
        text: i18n.t('battle.drill.cargoRemoveBtn'),
        title: i18n.t('battle.drill.cargoRemove'),
        'aria-label': i18n.t('battle.drill.cargoRemove'),
        onclick: () => {
          const i = cargos.indexOf(c);
          if (i >= 0) cargos.splice(i, 1);
          renderList();
        },
      }),
    ]);
    const syncItem = () => {
      item.classList.toggle('tons-invalid', !tonsValid(c.tonsText));
      item.classList.toggle('level-invalid', !levelValid(c));
      // 装载时间：等级合法 → 按**等级解析**取该级 loadTicks（唯一解析口径），否则显示定义基准值
      const lv = levelValid(c) ? Number(String(c.levelText).trim()) : 1;
      const cfg = resolveCargoAtLevel(c.templateId, lv) || tpl;
      loadEl.textContent = i18n.t('battle.drill.cargoLoad', { s: formatTickSeconds(cfg.loadTicks) });
    };
    nameInput.addEventListener('input', () => { c.name = nameInput.value; });
    tonsInput.addEventListener('input', () => { c.tonsText = tonsInput.value; syncItem(); syncHint(); });
    levelInput.addEventListener('input', () => { c.levelText = levelInput.value; syncItem(); syncHint(); });
    syncItem();
    return item;
  };

  const renderList = () => {
    listEl.replaceChildren(...cargos.map((c) => cargoItem(c)));
    emptyEl.classList.toggle('hidden', cargos.length > 0);
    syncCount(); // 内含 syncHint（＋通知调用方刷新「开战」可用性）
  };

  addBtn.addEventListener('click', () => {
    if (!cargoCountValid(countText)) return;
    const tpl = getCargo(tplSel.value) || getCargo(CARGO_IDS[0]);
    // ★ 一次批量添加 `want` 条（**单次输入的便捷上限** `maxCountPerEntry`，非总量限制）：
    //   总件数**不封顶**（用户口径）⇒ 循环内**不再**做任何总数判断、可无限次添加。
    const want = Math.min(CARGO_LIMITS.maxCountPerEntry, Number(countText));
    for (let i = 0; i < want; i++) {
      cargos.push({
        templateId: tpl.id,
        name: '',                    // 空名称 ⇒ 战斗屏显示**类型名**（i18n 词条 nameKey）
        tonsText: String(tpl.tons),  // 吨位：统一占位 5t（该类型的 Lv1 定义值）
        levelText: '1',              // 等级：从 Lv1 起步（装载时间随等级解析）
      });
    }
    renderList();
  });
  countInput.addEventListener('input', () => { countText = countInput.value; syncCount(); });

  const block = el('div', { class: 'drill-cargo' }, [
    el('div', { class: 'zone-label drill-cargo-title', text: i18n.t('battle.drill.cargoTitle') }),
    el('div', { class: 'drill-cargo-add' }, [tplSel, countInput, addBtn]),
    errEl,
    emptyEl,
    listEl,
  ]);
  renderList();
  return block;
}

/* ---------- 渲染 ---------- */

/** 定位下拉（战斗单位 / 后勤单位）：显示**当前生效值**（条目显式值或船型默认值） */
function roleSelect(sh) {
  const eff = sh.role || shipRoleDefault(sh.type);
  const sel = el(
    'select',
    { class: 'drill-role', 'aria-label': i18n.t('battle.drill.role') },
    ['combat', 'logistics'].map((r) =>
      Object.assign(el('option', { value: r, text: i18n.t(`battle.drill.role.${r}`) }), { selected: r === eff })
    )
  );
  sel.addEventListener('change', () => {
    sh.role = sel.value === 'logistics' ? 'logistics' : 'combat';
    renderLaunch();
  });
  return sel;
}

/** 单位等级下拉（1..maxLevel）：切换等级后槽位上限随之变化，超出的模块由预检提示（不自动删除） */
function shipLevelSelect(sh) {
  const levels = shipLevels(sh.type);
  const sel = el(
    'select',
    { class: 'drill-ship-level', 'aria-label': i18n.t('battle.drill.shipLevel', { n: shipName(sh.type) }) },
    levels.map((lv) => {
      const o = el('option', { value: String(lv), text: `Lv${lv}` });
      if (lv === (sh.level | 0 || 1)) o.selected = true;
      return o;
    })
  );
  sel.addEventListener('change', () => {
    sh.level = Number(sel.value) || 1;
    renderLaunch();
  });
  return sel;
}

/** 渲染一列编队（sideKey: 'ally' | 'enemy'），含增删舰、单位等级/定位、模块装配与模块等级 */
function renderFleetColumn(sideKey, warnByShip) {
  const ships = sideKey === 'ally' ? allyShips : enemyShips;
  const titleKey = sideKey === 'ally' ? 'battle.fleet.ally' : 'battle.fleet.enemy';
  const wrap = el('div', { class: 'drill-fleet' }, [el('div', { class: 'zone-label', text: i18n.t(titleKey) })]);

  ships.forEach((sh, idx) => {
    // 兼容：模块可能以字符串 id 形式存在（外部注入的数据）→ 归一为 {moduleId, level}
    sh.modules = sh.modules.map((m) => (typeof m === 'string' ? { moduleId: m, level: 1 } : m));
    if (!sh.level) sh.level = 1;
    const slots = shipSlotLimit(sh.type, sh.level);
    const warn = (warnByShip.get(`${sideKey}:${idx}`) || [])[0];

    const head = el('div', { class: 'drill-ship-head' }, [
      el('span', { class: 'drill-ship-name', text: `${shipName(sh.type)} #${idx + 1}` }),
      shipLevelSelect(sh),
      roleSelect(sh),
      el('button', {
        class: 'btn tiny ghost',
        text: i18n.t('battle.drill.removeShip'),
        title: i18n.t('battle.drill.removeShip'),
        onclick: () => {
          ships.splice(idx, 1);
          renderLaunch();
        },
      }),
    ]);

    const chips = el('div', { class: 'drill-modules' });
    sh.modules.forEach((mod, mi) => {
      const id = mod.moduleId;
      const maxLv = moduleMaxLevel(MODULES[id]);
      const unit = el('span', { class: 'drill-mod' });
      unit.append(
        el('button', {
          class: 'chip on drill-mod-chip',
          title: i18n.t('battle.drill.removeModule'),
          text: `× ${moduleName(id)}`,
          onclick: () => {
            sh.modules.splice(mi, 1);
            renderLaunch();
          },
        })
      );
      // 模块等级可选：仅当该模块 maxLevel>1 时显示 Lv 下拉（未给高阶数值前不出现）
      if (maxLv > 1) {
        const sel = el(
          'select',
          { class: 'drill-mod-level', 'aria-label': i18n.t('battle.drill.levelOf', { n: moduleName(id) }) },
          Array.from({ length: maxLv }, (_, i) => {
            const o = el('option', { value: String(i + 1), text: `Lv${i + 1}` });
            if (i + 1 === (mod.level || 1)) o.selected = true;
            return o;
          })
        );
        sel.addEventListener('change', () => {
          mod.level = Number(sel.value) || 1;
          renderLaunch();
        });
        unit.append(sel);
      }
      chips.append(unit);
    });

    const full = sh.modules.length >= slots;
    const addSel = el(
      'select',
      { class: 'drill-add-mod', 'aria-label': i18n.t('battle.drill.addModule') },
      full
        ? [el('option', { text: i18n.t('battle.drill.fullSlots') })]
        : [
            el('option', { value: '', text: i18n.t('battle.drill.addModule') }),
            ...MODULE_IDS.map((id) => el('option', { value: id, text: moduleName(id) })),
          ]
    );
    addSel.addEventListener('change', () => {
      const id = addSel.value;
      if (id && sh.modules.length < slots) sh.modules.push({ moduleId: id, level: 1 });
      renderLaunch();
    });

    const slotLine = el('div', {
      class: 'drill-slots',
      text: i18n.t('battle.drill.slots', { n: sh.modules.length, m: slots }),
    });
    const row = el('div', { class: `drill-ship${warn ? ' invalid' : ''}` }, [head, chips, slotLine, addSel]);
    if (warn) {
      row.append(el('div', { class: 'drill-warn-text', text: warnText(warn) }));
    }
    wrap.append(row);
  });

  // 添加单位：类型下拉（**动态取自船型注册表**）+ 添加按钮
  const typeSel = el(
    'select',
    { class: 'drill-add-type', 'aria-label': i18n.t('battle.drill.shipType') },
    SHIP_TYPE_IDS.map((id) => el('option', { value: id, text: shipName(id) }))
  );
  wrap.append(
    el('div', { class: 'drill-add-row' }, [
      typeSel,
      el('button', {
        class: 'btn small',
        text: i18n.t('battle.drill.addShip'),
        onclick: () => {
          ships.push({ type: typeSel.value || SHIP_TYPE_IDS[0], level: 1, modules: [] });
          renderLaunch();
        },
      }),
    ])
  );
  return wrap;
}

/** 告警 → 文案（键由引擎的规范化 code 给出，UI 只做措辞） */
function warnText(w) {
  switch (w.code) {
    case 'slotOverflow':
      return i18n.t('battle.drill.warn.slotOverflow', { n: w.slots });
    case 'levelClamped':
      return i18n.t('battle.drill.warn.levelClamped', { n: w.to });
    case 'moduleLevelClamped':
      return i18n.t('battle.drill.warn.moduleLevelClamped', { n: w.to });
    // ★ 星区货物侧告警（引擎 `normalizeSectorCargos` 产出，`side` 恒为 'sector'）
    case 'cargoInvalid':
      return i18n.t('battle.drill.warn.cargoInvalid');
    case 'cargoUnknownTemplate':
      return i18n.t('battle.drill.warn.cargoUnknownTemplate', { id: w.templateId == null ? '' : w.templateId });
    case 'cargoCountClamped':
      return i18n.t('battle.drill.warn.cargoCountClamped', { n: w.to });
    case 'cargoClamped':
      // `field` 是引擎给的**字段标识**（`tons` / `level`）⇒ UI 负责翻成中文措辞（UI 只做措辞、不自算规则）
      return i18n.t('battle.drill.warn.cargoClamped', {
        field: i18n.t(w.field === 'level' ? 'battle.drill.cargoLevel' : 'battle.drill.cargoTons'),
        to: w.to,
      });
    // ★ 原 `cargoOverflow`（总数超上限 ⇒ 截断）分支已**随总件数上限的取消一并移除**
    //   （引擎 `normalizeSectorCargos` 不再产生该告警码，i18n 文案亦已删除）⇒ 落到下面的兜底文案。
    default:
      return i18n.t('battle.drill.warn.invalid');
  }
}

/** 告警所属区块名（编队侧＝我方/敌方编队；**星区侧＝星区设定**，`side:'sector'`） */
function warnSideName(side) {
  if (side === 'ally') return i18n.t('battle.fleet.ally');
  if (side === 'enemy') return i18n.t('battle.fleet.enemy');
  return i18n.t('battle.drill.sector');
}

/** 预检：**调用引擎同一函数** `normalizeFormation` 得告警（UI 不自算规则）。
 *  星区随编队一并传入 → 引擎按唯一口径 `normalizeSector` 填缺省/钳制（UI 只校验“非负整数”这一输入格式）。 */
function preflight() {
  const current = { allies: cloneShips(allyShips), enemies: cloneShips(enemyShips), sector: cloneSector() };
  const norm = normalizeFormation(current);
  const warnByShip = new Map();
  for (const w of norm.warnings) {
    const key = `${w.side}:${w.index}`;
    if (!warnByShip.has(key)) warnByShip.set(key, []);
    warnByShip.get(key).push(w);
  }
  return { current, norm, warnByShip };
}

/** 演练配置屏：双方编队编辑 + 星区设定 + 预检提示 + 开战/返回 */
function renderLaunch() {
  if (!host) return;
  const { current, norm, warnByShip } = preflight();
  const fleetBlocked = norm.warnings.length > 0 || !current.allies.length || !current.enemies.length;
  // ★ 「开战」可用性＝**编队预检 + 星区储量格式 + 星区货物条目格式**（三者同一处置：任一不合法即禁用）
  const startBlocked = () => fleetBlocked || !oreReserveValid(sectorOreText) || !cargosAllValid();

  const warnList = el('div', { class: 'drill-warn-list' });
  if (norm.warnings.length) {
    warnList.append(
      el('div', {
        class: 'drill-warn-title',
        text: i18n.t('battle.drill.warn.title', { n: norm.warnings.length }),
      })
    );
    for (const w of norm.warnings.slice(0, 6)) {
      const sideName = warnSideName(w.side); // 星区侧（side:'sector'）显示「星区设定」+ 该项下标
      warnList.append(
        el('div', { class: 'drill-warn-text', text: `${sideName} #${(w.index | 0) + 1}：${warnText(w)}` })
      );
    }
  }

  const startBtn = el('button', {
    class: 'btn primary',
    text: i18n.t('battle.drill.start'),
    title: startBlocked() ? i18n.t('battle.drill.blocked') : '',
    onclick: () => {
      const pf = preflight();
      // 不允许确认：编队预检有告警 / 双方任一为空 / 星区储量或货物条目格式非法（同一处置）
      if (pf.norm.warnings.length || !pf.current.allies.length || !pf.current.enemies.length) return;
      if (!oreReserveValid(sectorOreText) || !cargosAllValid()) return;
      if (typeof hooks.onStart === 'function') hooks.onStart(pf.current);
    },
  });
  startBtn.disabled = startBlocked(); // property 赋 disabled，避免被当作字符串属性写入
  /** 星区侧输入（储量/货物）变化时就地刷新「开战」可用性（不整屏重绘，避免丢焦点） */
  const syncStartBtn = () => {
    const blocked = startBlocked();
    startBtn.disabled = blocked;
    startBtn.title = blocked ? i18n.t('battle.drill.blocked') : '';
  };

  const sectorPanel = sectorBlock(syncStartBtn);
  sectorPanel.append(cargoBlock(syncStartBtn)); // ★ 货物设定**归属星区设定区**（同一面板内、独立小节）

  host.replaceChildren(
    el('div', { class: 'drill-builder' }, [
      el('h3', { text: i18n.t('battle.drill.title') }),
      el('p', { class: 'drill-hint', text: i18n.t('battle.drill.hint') }),
      sectorPanel,
      el('div', { class: 'drill-grid' }, [renderFleetColumn('ally', warnByShip), renderFleetColumn('enemy', warnByShip)]),
      warnList,
      el('div', { class: 'drill-actions' }, [
        startBtn,
        el('button', {
          class: 'btn small',
          text: i18n.t('battle.menu.back'),
          onclick: () => hooks.onExit && hooks.onExit(),
        }),
      ]),
    ])
  );
}

/** 供外部查询/注入的编队入口（结构见文件头） */
export const setupView = {
  /** 挂载到宿主元素并注入回调：`{ onStart(formation), onExit() }` */
  render(hostEl, opts = {}) {
    host = hostEl;
    hooks = { onStart: opts.onStart || null, onExit: opts.onExit || null };
    renderLaunch();
  },
  /** 当前编辑态编队（深拷贝快照，可直接作为 `startBattle` 入参）；含星区数据 `sector` */
  getFormation() {
    return { allies: cloneShips(allyShips), enemies: cloneShips(enemyShips), sector: cloneSector() };
  },
  /** 覆盖编辑态（如从“再战”快照或将来关卡预设载入）；传 null 则恢复默认 */
  setFormation(formation = {}) {
    const a = Array.isArray(formation.allies) ? formation.allies : null;
    const e = Array.isArray(formation.enemies) ? formation.enemies : null;
    if (a) allyShips = cloneShips(a);
    if (e) enemyShips = cloneShips(e);
    if (formation.sector && typeof formation.sector === 'object') {
      // 星区：名称原样、储量按引擎规范化后的数值回填输入框（非法/缺省 → 缺省占位值）；
      // ★ 货物同样按**引擎规范化后**的实例回填编辑态（类型 + 名称 + 吨位 + 等级；
      //   类型/装载时间/系数由类型与等级解析而来，不回填进编辑态）
      const sec = normalizeFormation({ sector: formation.sector }).sector;
      sectorName = sec.name;
      sectorOreText = String(sec.oreReserve);
      cargos = (sec.cargos || []).map((c) => ({
        templateId: c.templateId,
        name: c.name,
        tonsText: String(c.tons),
        levelText: String(c.level),
      }));
    }
    if (!a && !e) {
      allyShips = DEFAULT_SHIPS();
      enemyShips = DEFAULT_SHIPS();
      sectorName = SECTOR_DEFAULTS.name;
      sectorOreText = String(SECTOR_DEFAULTS.oreReserve);
      cargos = [];
    }
    if (host) renderLaunch();
  },
  /** 恢复默认编队与星区（每次从战斗“离开”回到配置界面时不清空，仅显式调用时重置） */
  reset() {
    allyShips = DEFAULT_SHIPS();
    enemyShips = DEFAULT_SHIPS();
    sectorName = SECTOR_DEFAULTS.name;
    sectorOreText = String(SECTOR_DEFAULTS.oreReserve);
    cargos = []; // 缺省货物＝无（`SECTOR_DEFAULTS.cargos`）
    if (host) renderLaunch();
  },
  /** 卸载宿主（避免离屏后仍被重绘） */
  detach() {
    host = null;
    hooks = { onStart: null, onExit: null };
  },
};

export default setupView;
