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
 * ★ 星区（战斗场景）设定：`{ sector: { name, oreReserve } }` **与双方编队同级**随开战入口一起提交
 *   （`getFormation()` / `onStart(formation)` / `normalizeFormation()` 同一条链）。
 *   · `name`      用户自定义名称：**原样提交、UI 不做 i18n**（战斗屏按引擎 `battle.sector` 原样显示）；
 *   · `oreReserve` 矿物储量：**输入格式校验＝非负整数**（本文件唯一自校验项；非法 → 提示 + 禁用「开战」），
 *     真实缺省/钳制仍由引擎唯一口径 `normalizeSector()` 负责（缺省值登记在 `data/sector.js`）。
 */
import { el } from '../core/utils.js';
import { i18n } from '../i18n/index.js';
import { SHIPS, SHIP_IDS, shipLevels, resolveShipAtLevel } from '../data/ships.js';
import { MODULES } from '../data/modules.js';
import { SECTOR_DEFAULTS } from '../data/sector.js';
import { moduleMaxLevel } from '../entities/module.js';
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
  return { name: sectorName, oreReserve: oreReserveValid(sectorOreText) ? Number(sectorOreText.trim()) : null };
}
/** ★ 矿物储量输入校验（唯一口径）：**非负整数**（纯数字；空串/小数/负号/其它字符 → 非法）。 */
function oreReserveValid(text) {
  return /^\d+$/.test(String(text == null ? '' : text).trim());
}
/** 星区设定编辑行（名称输入框 + 矿物储量输入框 + 非法提示）：
 *  · 输入即写回编辑态；储量非法 → 就地提示「须为非负整数」并由调用方**禁用「开战」**（与预检告警同一处置）；
 *  · 不在输入时整屏重绘（避免丢焦点）：就地更新提示，并通过 `onValidityChange(ok)` 通知调用方刷新开战按钮。 */
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
    if (typeof onValidityChange === 'function') onValidityChange(ok);
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
    default:
      return i18n.t('battle.drill.warn.invalid');
  }
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
  const oreOk = oreReserveValid(sectorOreText);

  const warnList = el('div', { class: 'drill-warn-list' });
  if (norm.warnings.length) {
    warnList.append(
      el('div', {
        class: 'drill-warn-title',
        text: i18n.t('battle.drill.warn.title', { n: norm.warnings.length }),
      })
    );
    for (const w of norm.warnings.slice(0, 6)) {
      const sideName = i18n.t(w.side === 'ally' ? 'battle.fleet.ally' : 'battle.fleet.enemy');
      warnList.append(
        el('div', { class: 'drill-warn-text', text: `${sideName} #${(w.index | 0) + 1}：${warnText(w)}` })
      );
    }
  }

  const startBtn = el('button', {
    class: 'btn primary',
    text: i18n.t('battle.drill.start'),
    title: fleetBlocked || !oreOk ? i18n.t('battle.drill.blocked') : '',
    onclick: () => {
      const pf = preflight();
      // 不允许确认：编队预检有告警 / 双方任一为空 / 星区储量非法（三者同一处置）
      if (pf.norm.warnings.length || !pf.current.allies.length || !pf.current.enemies.length) return;
      if (!oreReserveValid(sectorOreText)) return;
      if (typeof hooks.onStart === 'function') hooks.onStart(pf.current);
    },
  });
  startBtn.disabled = fleetBlocked || !oreOk; // property 赋 disabled，避免被当作字符串属性写入
  /** 储量输入变化时就地刷新「开战」可用性（不整屏重绘，避免丢焦点） */
  const syncStartBtn = (ok) => {
    startBtn.disabled = fleetBlocked || !ok;
    startBtn.title = fleetBlocked || !ok ? i18n.t('battle.drill.blocked') : '';
  };

  host.replaceChildren(
    el('div', { class: 'drill-builder' }, [
      el('h3', { text: i18n.t('battle.drill.title') }),
      el('p', { class: 'drill-hint', text: i18n.t('battle.drill.hint') }),
      sectorBlock(syncStartBtn),
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
      // 星区：名称原样、储量按引擎规范化后的数值回填输入框（非法/缺省 → 缺省占位值）
      const sec = normalizeFormation({ sector: formation.sector }).sector;
      sectorName = sec.name;
      sectorOreText = String(sec.oreReserve);
    }
    if (!a && !e) {
      allyShips = DEFAULT_SHIPS();
      enemyShips = DEFAULT_SHIPS();
      sectorName = SECTOR_DEFAULTS.name;
      sectorOreText = String(SECTOR_DEFAULTS.oreReserve);
    }
    if (host) renderLaunch();
  },
  /** 恢复默认编队与星区（每次从战斗“离开”回到配置界面时不清空，仅显式调用时重置） */
  reset() {
    allyShips = DEFAULT_SHIPS();
    enemyShips = DEFAULT_SHIPS();
    sectorName = SECTOR_DEFAULTS.name;
    sectorOreText = String(SECTOR_DEFAULTS.oreReserve);
    if (host) renderLaunch();
  },
  /** 卸载宿主（避免离屏后仍被重绘） */
  detach() {
    host = null;
    hooks = { onStart: null, onExit: null };
  },
};

export default setupView;
