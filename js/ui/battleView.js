/* ===== ui/battleView.js —— 战斗屏（对战 Demo + 视觉/交互增强） =====
 * 布局（自上而下）：标题行(含「离开」) → 敌方后勤 → 敌方战斗 → 分隔线 → 我方战斗 → 我方后勤
 *                  → 单位详情面板（点击单位后出现，可指定主目标）→ 指挥栏 → 星区资源栏 → 战报
 * 单位实体卡（矩形，从上到下）：单位图标(SVG) → 状态条(HP/护盾/能量/**货物/矿物**，容量 0 的条自动隐藏)
 *   → 简约模块图标
 * 实时信息：模块冷却倒计时徽标 / 就绪脉冲；"下一步"行动提示（敌方将做什么一望可知）
 * 流程：演练编队配置（`ui/setupView.js`）→ enterBattle() → 开战(combat:state true) → 实时结算
 *       → 结算浮层(自动存档) → 「再战」或「离开」回配置界面
 * ★ 编队配置界面的**逻辑与渲染已整体拆分到 `ui/setupView.js`**（本文件只挂载并接收其回调）；
 *   本文件**不保存编队编辑态**。
 * ★ 唯一的「进入战斗」入口＝本文件导出的 `enterBattle(formation)`（内部走 `systems/battle.js startBattle`）：
 *   演练界面「开战」、结算「再战」、将来的关卡/剧情入口**都必须走它**，不留第二条开战路径。
 * 调试：window.__battle 暴露当前战斗对象
 */
import { el, formatBonusPercent, formatBonusDeltaPercent } from '../core/utils.js';
import { bus } from '../core/eventBus.js';
import { i18n } from '../i18n/index.js';
import { SHIPS } from '../data/ships.js';
import { MODULES } from '../data/modules.js';
import { startBattle, TARGET_POLICIES } from '../systems/battle.js';
import {
  modulePoolCapOf,
  coeff,
  coeffDetail,
  damageTakeMul,
  timeCoeffOf,
  // ★ 货舱 / 矿物容量：**唯一口径在引擎**（本体容量 + Σ各来源×对应船级系数 后取整）
  //   —— UI 只读、**不自算**；分解值 `{base, modules, total}` 供展示，装载量读 `cargoLoadOf`/`oreLoadOf`（M4 前恒 0）。
  cargoCapPartsOf,
  oreCapPartsOf,
  cargoLoadOf,
  oreLoadOf,
  // ★ 已装载**货物实体**清单的只读口径（详情页「装载货物」栏用；数值口径仍是 `cargoLoadOf`）
  cargoListOf,
} from '../entities/ship.js';
import { bar } from './widgets.js';
import { router } from './router.js';
import { setupView } from './setupView.js'; // ★ 演练编队配置屏（单一职责；本文件只挂载它并接收回调）
// ★ 星区侧冷却词条的**唯一识别口径**（与引擎同源）：UI 枚举「星区冷却」行时不自行判词条
import { hasSectorCdFx } from '../data/sector.js';
import { log, formatRich } from '../core/log.js';
import { ticker, formatTickSeconds } from '../core/tick.js';

const SEC_TICKS = 20; // 1 秒 = 20 tick（与战斗核心一致，用于按 tick 折算每秒消耗）

/* —— 编队编辑态（双方编队、单位类型/等级/定位、模块装配）已移出到 `ui/setupView.js`；
 *    本文件只保留「进行中战斗」的运行态。 —— */
let lastFormation = null; // 最近一次成功开战的编队快照（供结算面板「再战」重开同一配置）

/** UI 侧战斗战报（channel=battle，带着色段） */
function uiLog(key, params, colorKeys) {
  const { msg, rich } = formatRich(key, params, colorKeys);
  log.add(msg, 'battle', rich);
}
/** 单位名着色段 */
function shipTok(s, label) {
  return { side: s.side, label };
}

function moduleName(id) {
  const m = MODULES[id];
  if (!m) return id;
  const t = i18n.t(m.nameKey);
  return t && !t.startsWith('??') ? t : (m.name || id); // 名称降级占位：i18n 缺失时用模块 name/id
}
/** 模块"脸"节点：有 SVG 图标(cfg.icon)用 <img>，否则降级显示名称首字。
 *  ★ **缺图回退**：写了 `icon` 但素材缺失/路径失效时，`<img>` 触发 `error` → **就地替换**为
 *    与“无 `icon`”**完全同一条渲染分支**的「名称首字」节点（同一元素形态：无 class 的 `<span>`、
 *    同取 `moduleName` 首字）⇒ 与无图时的呈现**逐字一致**，不新造视觉、不新增类名。
 *  ★ 与召唤单位的 `unitIcon`（同样是 `<img>` + `error` 回退 ▲）**同一写法体例**：`addEventListener('error', …)`
 *    内换掉自身内容。正常路径**零变化**：有图且加载成功时节点/类名/行为与改动前完全一致（`.module-icon-img` 不变）。 */
function moduleGlyphEl(cfg) {
  // 「名称首字」降级节点（唯一渲染分支：无 `icon` 与 `icon` 加载失败**共用**此函数）
  const firstCharEl = () => {
    const name = moduleName(cfg.id);
    return el('span', { text: name ? Array.from(name)[0] : '?' });
  };
  if (cfg.icon) {
    const img = el('img', { class: 'module-icon-img', src: cfg.icon, alt: '' });
    img.draggable = false;
    // 加载失败 → 用「名称首字」节点**原位替换**该 <img>：
    //   · `replaceWith` 是“换掉自己”，故**不会重复插入**、也不会累积子节点；
    //   · 替换后该 <img> 已脱离文档，其 `error` 不会再触发（且 `parentNode` 守卫兜住极端时序）
    //     ⇒ **不残留破图占位**；
    //   · 元素尚未挂到文档时 `replaceWith` 按规范为**空操作**（不抛错）—— 实践中 `error` 事件总在
    //     当前任务之后派发，而各调用方都在同一同步块内把筹码挂进 DOM，故回退恒能生效。
    img.addEventListener('error', () => {
      if (!img.parentNode) return; // 已脱离文档（已被替换/移除）→ 不再处理
      img.replaceWith(firstCharEl());
    });
    return img;
  }
  return firstCharEl();
}
/* 注：船型名称/槽位/编队渲染等**编队配置界面专用**的工具函数已随界面一并移入 `ui/setupView.js`（不在此重复实现）。 */

let battle = null;
let selectedId = null;
let listenersBound = false;

/* 模块级 DOM 引用 */
let stageArea = null;
let stageHeadEl = null;        // 战斗标题行（标题 + 状态 + 「离开」按钮）
let titleEl = null;            // 战斗标题节点（标题 + 星区名称前缀；有战斗时按引擎 `battle.sector` 追加）
let leaveBtn = null;           // 「离开」按钮（有战斗时显示；回编队配置界面）
let overlay = null;            // { overlay, show }
let enemyZone = null;          // 敌方【战斗单位】栏
let enemyLogZone = null;       // 敌方【后勤单位】栏
let allyZone = null;           // 我方【战斗单位】栏
let allyLogZone = null;        // 我方【后勤单位】栏
let allZones = [];             // 四个分区（用于“无单位自动隐藏”的统一刷新）
let detailEl = null;           // 详情面板挂载点
let detail = null;             // { ship, refs } | null
let updateCards = null;
let logPanelEl = null;
let statusEl = null;           // 战斗状态行（阶段/存活数）
let cmdSel = null;             // 指挥栏：全队目标策略下拉
let cmdPreview = null;         // 指挥栏：当前命中目标预览
let cmdAlliance = null;        // 指挥栏：友方同盟护盾共享层条（单独一行）
let cmdAllianceFill = null;    // 同盟护盾条填充
let cmdAllianceNum = null;     // 同盟护盾条数值
let cmdBlast = null;           // 指挥栏：友方防爆护盾共享层条（单独一行）
let cmdBlastFill = null;       // 防爆护盾条填充
let cmdBlastNum = null;        // 防爆护盾条数值
// ★ 指挥栏：货舱总量行（货物 / 矿物，己方一侧合计）——与共享护盾条**同一处、同一视觉体例**；
//   总量为 0 → 整行隐藏（唯一规则）。取值全走引擎 `battle.cargoPool('ally')` / `battle.orePool('ally')`。
let cmdCargo = null;
let cmdCargoFill = null;
let cmdCargoNum = null;
let cmdOre = null;
let cmdOreFill = null;
let cmdOreNum = null;
// ★ 星区资源栏（指挥栏**下方**独立一栏：星区名 + 星区冷却组 + 矿物储量 + **星区货物**组）
//   数据唯一来源＝引擎 `battle.sector`
let sectorZ = null; // { zone, label, cdGroup, cdRows, row, fill, num, cargoGroup, cargoChipRow, cargoChips }
//   · `cargoChips` ＝星区货物芯片项数组（**按需补齐**：星区列表队列式、长度不限 ⇒ 运行时可能新增货物）；
//   · `cargoChipRow` ＝芯片行容器（刷新时按**引擎列表顺序** `append` ⇒ 视觉顺序＝队列顺序）。

/* 迷你护盾池条（详情/长期池用）：无标签小横条 + 数值 */
function makeMiniPool() {
  const fill = el('div', { class: 'pool-mini-fill' });
  const num = el('span', { class: 'pool-mini-num', text: '' });
  const track = el('div', { class: 'pool-mini-track' }, [fill]);
  return { el: el('div', { class: 'pool-mini' }, [track, num]), fill, num, track };
}
/** 刷新迷你护盾池条：value/cap 显式传入；tint={color,glow}|null 决定变色(同色光)。
 *  cap>0 恒显示（值可为 0，破盾后不隐藏避免跳动）；cap<=0 隐藏。 */
function setMiniPool(w, value, cap, tint) {
  if (!w) return;
  if (cap > 0) {
    w.el.style.display = '';
    const pct = Math.max(0, Math.min(100, ((value || 0) / cap) * 100));
    w.fill.style.width = pct.toFixed(1) + '%';
    w.num.textContent = `${Math.round(value || 0)} / ${Math.round(cap)}`;
    if (tint) {
      w.fill.style.background = tint.color;
      w.fill.style.boxShadow = tint.glow;
    } else {
      w.fill.style.background = ''; // 回 CSS 默认渐变
      w.fill.style.boxShadow = '';
    }
  } else {
    w.el.style.display = 'none';
  }
}
/** 带标签的长期(本体)护盾池块：头部文字 + 迷你条。 */
function longShieldBlock() {
  const pool = makeMiniPool();
  const label = el('div', { class: 'detail-subtitle', text: i18n.t('battle.detail.longShield') });
  return { el: el('div', { class: 'detail-long-pool' }, [label, pool.el]), pool };
}

/* 护盾条变色（护盾值改变的类型 → 同色 + 同色光，去掉闪烁）。优先级高者先：反射黄 → 同盟深蓝 →
 * 防爆橙 → 回盾青绿 → 普通受击白。返回 {color,glow} 或 null。 */
function shieldTint(s) {
  if ((s._reflectFlash || 0) > 0)
    return { color: '#facc15', glow: '0 0 14px 4px rgba(250, 204, 21, 0.9)' };
  if ((s._allyFlash || 0) > 0)
    return { color: '#1d4ed8', glow: '0 0 14px 4px rgba(29, 78, 216, 0.9)' };
  if ((s._bpFlash || 0) > 0)
    return { color: '#f59e0b', glow: '0 0 14px 4px rgba(245, 158, 11, 0.9)' };
  if ((s._healFlash || 0) > 0)
    return { color: '#5eead4', glow: '0 0 14px 4px rgba(94, 234, 212, 0.9)' };
  if ((s._dmgFlash || 0) > 0)
    return { color: '#f8fafc', glow: '0 0 14px 4px rgba(248, 250, 252, 0.85)' };
  return null;
}

/* 统一变色状态机（单位卡条 + 独立/长期护盾条共用）：
 * 值变化触发该池变色(currentTint 给色)，保持 TINT_MS 以覆盖“缓动到位”，随后自动回本色。 */
const TINT_MS = 600; // 覆盖 0.35s 宽度缓动 + 余量后消退
const barTints = new Map(); // key: bar 标识 -> { last, color, glow, until }

/** 每帧推进一条 bar 的变色：value 为本帧真实值；currentTint=该单位此刻应展示的事件色(可 null)。
 *  返回应在护盾条上应用的 {color,glow}；无(已回本色)返回 null。 */
function nextBarTint(key, value, currentTint) {
  const now = performance.now();
  let st = barTints.get(key);
  if (!st) st = { last: NaN, color: null, glow: null, until: 0 };
  if (value !== st.last) {
    // 值发生了改变：用此刻的事件类型色
    if (currentTint) {
      st.color = currentTint.color;
      st.glow = currentTint.glow;
      st.until = now + TINT_MS;
    }
    st.last = value;
    barTints.set(key, st);
  }
  if (now < st.until && st.color) return { color: st.color, glow: st.glow };
  if (st.color !== null) {
    st.color = null;
    st.glow = null;
    st.until = 0;
    barTints.set(key, st);
  }
  return null;
}

/* ================= 图标与卡片 ================= */

/** 单位类型显示名：多个同阵营同名单位时带 #序号（如 战斗舰 #2），与战斗日志一致 */
function baseName(ship) {
  const base = i18n.t(ship.nameKey);
  return (ship.sideSize || 1) > 1 ? `${base} #${ship.order || 1}` : base;
}

/* ===== effects 词条能力检测（与引擎同一套判定：有词条才有效果） ===== */
function fxHas(fx, key) { return Number(fx[key] || 0) > 0; }
/** 带符号数值显示：正 +n / 负 −n / 0（整数口径，用于伤害/护盾量等） */
function fmtSigned(v) {
  const n = Math.round(Math.abs(v));
  return v > 0 ? `+${n}` : v < 0 ? `−${n}` : '0';
}
/** 带符号**小数值**显示（保留小数、去掉尾随 0）：+0.2 / −0.05 / 0
 *  —— 系数类词条（如 `attack_coeff_add`）是小数，用 `fmtSigned` 会被取整成 “+0”。 */
function fmtSignedNum(v, digits = 2) {
  if (!v) return '0';
  const n = Number(Math.abs(v).toFixed(digits));
  return v > 0 ? `+${n}` : `−${n}`;
}
/** 乘性系数的显示（×0.95）：去除尾随 0，保留小数 */
function fmtCoeffMul(v) {
  const n = Number(Number(v).toFixed(3));
  return String(n);
}
/** “上限被清空”的展示阈值：上限类词条给到**极大负值**（如 EMP 的 `-1000000`）在引擎里
 *  ＝“把该上限压到 0”（引擎按目标基准重算后 clamp 至 0，当前值随之 clamp）。
 *  纯**展示层**规则（不改任何计算）：≤ 本阈值即显示“清空 XX 上限”，
 *  避免把占位大负值当成真实数字展示；对任意上限词条通用。 */
const CAP_CLEAR_MAX = -1000;
/** 上限类词条文本：大负值 → “清空”分支；否则常规带符号数值 */
function capTermText(key, clearKey, v) {
  if (v <= CAP_CLEAR_MAX) return i18n.t(`battle.detail.${clearKey}`);
  return i18n.t(`battle.detail.${key}`, { v: fmtSigned(v) });
}
/** 输出型（造成伤害等）：有 damage 词条 */
function isWeapon(fx) { return fxHas(fx, 'damage'); }
/** 纯回复型：有 shield_gain 且无 damage */
function isShieldRestore(fx) { return fxHas(fx, 'shield_gain') && !fxHas(fx, 'damage'); }
/** 状态型模块的 `type` 条件标签（与引擎一致：`battle.js` 按这些标签跳过“激活-触发”流程）。
 *  ⚠ 只用于**静态展示口径**（如“无激活周期”）；动态“当前是否生效”一律读引擎判据 stateModuleState()。
 *  · `solo`   —— 条件触发型自身增益（条件成立才生效）；
 *  · `passive`—— **常驻被动**（增幅器类：装上即生效、无冷却/耗能/持续期、不产生战报）。 */
const STATE_TAGS = ['solo', 'passive'];
function isStateModuleFx(fx) {
  const t = Array.isArray(fx && fx.type) ? fx.type : fx && fx.type ? [fx.type] : [];
  return STATE_TAGS.some((k) => t.includes(k));
}
/** ★ **装载器模块**（`type` 标签 `cargo_loader`，如装载光束）的静态识别 —— 与引擎
 *  `battle.js canImpact`/`maybeActivate` **同一识别口径**（**按标签识别、不硬编码模块 id**）。
 *  用途：成本段的周期措辞改为「每件货物」（该模块**无自身冷却**，其“忙/闲”由**装载过程**决定，
 *  显示「每 1t」会误导；仅**展示层**措辞，不含任何数值/门控口径）。 */
function isCargoLoaderFx(fx) {
  const t = Array.isArray(fx && fx.type) ? fx.type : fx && fx.type ? [fx.type] : [];
  return t.includes('cargo_loader');
}
/** ★ **星区冷却模块**（带**星区侧冷却词条** `sector_cd_ticks` 的模块）的**静态识别**：
 *  与引擎 `battle.js hasSectorCd` **同一口径、同一函数**（`data/sector.js hasSectorCdFx`）
 *  —— 词条存在即参与星区冷却（**按词条识别、不硬编码模块 id**）⇒ UI 冷却行枚举与引擎门控**同源**。
 *  用途：星区资源栏为**每个**此类模块各建一行「星区冷却」（按 `MODULES` 自动枚举）。 */
function isSectorCdModuleFx(fx) {
  return hasSectorCdFx(fx);
}
/** 目标词条是否仅作用于自身（self only） */
function rowSelfOnly(inst) {
  const k = (inst.cfg.target || {}).kinds;
  return Array.isArray(k) && k.length === 1 && k[0] === 'self';
}
/** 单位当前是否处于无敌：自身有某模块正处于激活持续期且 effects.type 含 invincible */
function isInvincibleShip(ship) {
  if (!ship || !Array.isArray(ship.modules)) return false;
  for (const inst of ship.modules) {
    if (!inst || !(inst.durationLeft > 0)) continue;
    const t = (inst.cfg && inst.cfg.effects && inst.cfg.effects.type) || [];
    if (Array.isArray(t) && t.includes('invincible')) return true;
  }
  return false;
}

/** 单位图标：
 *  - 召唤(无人机)单位：使用所属召唤模块的图标(ship.summonIcon)；模块无图标时直接降级 ▲。
 *  - 常规单位：读取独立素材文件 assets/img/ship-<type>-<side>.svg；加载失败回退 ▲。
 */
function unitIcon(ship) {
  const wrap = el('span', { class: 'unit-icon-wrap' });
  if (ship.tempNoIcon) {
    wrap.classList.add('fallback');
    wrap.appendChild(document.createTextNode('▲'));
    return wrap;
  }
  const img = el('img', {
    class: 'unit-icon-img',
    alt: '',
    draggable: 'false',
    // 图标优先级：召唤模块图标（summon.attrs.icon / 模块 icon） > **船型等级解析出的 icon**
    // （`ship.typeCfg.icon`，船型任意条目可逐级覆写） > 既有按 typeId+side 约定的素材路径。
    src:
      ship.summonIcon ||
      (ship.typeCfg && ship.typeCfg.icon) ||
      `./assets/img/ship-${ship.typeId}-${ship.side}.svg`,
  });
  img.addEventListener('error', () => {
    wrap.replaceChildren(document.createTextNode('▲'));
    wrap.classList.add('fallback');
  });
  wrap.append(img);
  return wrap;
}

function nextActionText(ship) {
  let shieldInfo = null;
  /** ★ **门控未满足**（词条 `hp_below_activate` 低血门控等，引擎判据 `battle.moduleGateMet`）：
   *  “下一步”不得提示「可激活 / 开火就绪」等就绪态，统一显示「条件未满足」（与详情页状态行同一文案键）。
   *  持续中 / 冷却中仍优先（表达进行中的计时，见 modStatusText 同一说明）。 */
  const gateBlocked = (inst) => stateModuleGate(inst) === false;
  for (const inst of ship.modules) {
    if (!inst.enabled) continue; // 停用的模块不参与"下一步"计算
    const fx = inst.cfg.effects;
    if ((fx.duration_ticks || 0) > 0) {
      // 时长型模块（如欧米茄护盾）：优先展示 持续中 → 冷却 → 充能就绪
      if (inst.durationLeft > 0) return i18n.t('battle.act.buffing', { n: inst.durationLeft });
      if (inst.cooldown > 0) return i18n.t('battle.act.cooling', { n: inst.cooldown });
      if (gateBlocked(inst)) return i18n.t('battle.detail.stateInactive');
      return ship.hull.energy >= fx.energy_cost
        ? i18n.t('battle.act.buffReady')
        : i18n.t('battle.act.noEnergy');
    }
    if (isWeapon(fx)) {
      if (inst.cooldown > 0) return i18n.t('battle.act.fireCool', { n: inst.cooldown });
      if (gateBlocked(inst)) return i18n.t('battle.detail.stateInactive');
      return ship.hull.energy >= fx.energy_cost
        ? i18n.t('battle.act.fireReady')
        : i18n.t('battle.act.noEnergy');
    }
    if (isShieldRestore(fx)) shieldInfo = inst;
  }
  if (shieldInfo) {
    const rfx = shieldInfo.cfg.effects;
    if (ship.hull.shield >= ship.hull.shieldCap) return i18n.t('battle.act.shieldFull');
    if (shieldInfo.cooldown > 0) return i18n.t('battle.act.regenCool', { n: shieldInfo.cooldown });
    // 与武器一致：能量须满足本次激活消耗才回复
    return ship.hull.energy >= (rfx.energy_cost || 0)
      ? i18n.t('battle.act.regen')
      : i18n.t('battle.act.noEnergy');
  }
  return i18n.t('battle.act.idle');
}

function buildModuleChips(ship) {
  const type = SHIPS[ship.typeId];
  // ★ 槽位数取**实例的等级解析结果**（`ship.slots`，由 createShip/applyShipLevel 按船型等级落地）；
  //   未带该字段的旧实例/调用方回退到该船型 Lv1 定义 → 默认等级下与拆分前完全一致。
  const slots = ship.slots != null ? ship.slots : (type && type.slots) || 1;
  const chips = [];
  for (let i = 0; i < slots; i += 1) {
    const inst = ship.modules[i];
    if (!inst) {
      chips.push({ empty: true, el: el('span', { class: 'module-slot-empty' }) });
      continue;
    }
    const badge = el('span', { class: 'chip-badge', text: '' });
    const chip = el('span', { class: `module-chip ${inst.cfg.category}` });
    chip.append(moduleGlyphEl(inst.cfg));
    chip.append(el('span', { class: 'module-lv', text: `L${inst.level}` }));
    chip.append(badge);
    chip.title = `${moduleName(inst.cfg.id)} · L${inst.level}`;
    chips.push({ empty: false, inst, el: chip, badge });
  }
  return chips;
}

/** 单位实体卡：图标 → 状态条 → 模块图标（+ 下一步提示） */
function buildShipCard(ship) {
  const tagKey = ship.side === 'ally' ? 'battle.side.ally' : 'battle.side.enemy';
  const hpBar = bar(i18n.t('battle.hp'), 'var(--hp)');
  const shieldBar = bar(i18n.t('battle.shield'), 'var(--shield)');
  const energyBar = bar(i18n.t('battle.energy'), 'var(--energy)');
  // ★ 货舱容量条（货物 / 矿物）：与护盾条**同一套条形体例**（同一个 `bar()` 组件 + `.bar` 结构）。
  //   取值＝引擎唯一口径 `cargoCapPartsOf`/`oreCapPartsOf`（UI 不自算）；**容量为 0 → 整条隐藏**（唯一规则）。
  //   当前值读 `cargoLoadOf`/`oreLoadOf`（M4 资源系统落地前恒为 0，故显示「0 / 上限」）。
  const cargoBar = bar(i18n.t('battle.cargo'), 'var(--cargo)');
  const oreBar = bar(i18n.t('battle.ore'), 'var(--ore)');
  const chips = buildModuleChips(ship);
  const intentEl = el('div', { class: 'unit-intent', text: '' });
  const focusEl = el('div', { class: 'unit-focus', text: '' }); // 主要目标
  const nameTag = el('div', { class: 'unit-name', text: `${baseName(ship)} · ${i18n.t(tagKey)}` });
  const lifeEl = el('div', { class: 'unit-timer', text: '' }); // 临时单位存活剩余（非临时隐藏）

  const cardEl = el('div', { class: `unit-card ${ship.side}`, onclick: () => selectUnit(ship.id) }, [
    el('div', { class: 'unit-icon-zone' }, [unitIcon(ship), nameTag]),
    el('div', { class: 'unit-bars' }, [hpBar.el, shieldBar.el, energyBar.el, cargoBar.el, oreBar.el]),
    lifeEl,
    el('div', { class: 'unit-modules' }, chips.map((c) => c.el)),
    intentEl,
    focusEl,
  ]);

  function refreshChips(s) {
    for (const c of chips) {
      if (c.empty) continue;
      const fx = c.inst.cfg.effects;
      const off = c.inst.enabled === false;
      c.el.classList.toggle('off', off);
      if (off) {
        c.el.classList.remove('cooling', 'ready', 'active');
        c.badge.style.display = 'none';
        continue;
      }
      // 状态型模块（条件型自身增益）：生效 → 发光；未满足 → 不加就绪脉动（避免“脉动=就绪”的误导）
      const stState = stateModuleState(c.inst);
      if (stState !== null) {
        c.el.classList.toggle('active', stState);
        c.el.classList.remove('cooling', 'ready');
        c.badge.style.display = 'none'; // 状态型无倒计时徽标
        continue;
      }
      if ((fx.duration_ticks || 0) > 0) {
        // 时长型：优先展示持续期（发光+持续倒计时徽标），无持续则冷却倒计时
        if (c.inst.durationLeft > 0) {
          c.el.classList.add('active');
          c.el.classList.remove('cooling', 'ready');
          c.badge.textContent = String(c.inst.durationLeft);
          c.badge.style.display = '';
        } else if (c.inst.cooldown > 0) {
          c.el.classList.add('cooling');
          c.el.classList.remove('active', 'ready');
          c.badge.textContent = String(c.inst.cooldown);
          c.badge.style.display = '';
        } else {
          c.el.classList.add('ready');
          c.el.classList.remove('cooling', 'active');
          c.badge.style.display = 'none';
        }
      } else if (isWeapon(fx)) {
        const cooling = c.inst.cooldown > 0;
        c.el.classList.toggle('cooling', cooling);
        c.el.classList.toggle('ready', !cooling);
        if (cooling) {
          c.badge.textContent = String(c.inst.cooldown);
          c.badge.style.display = '';
        } else {
          c.badge.style.display = 'none';
        }
      } else if (isShieldRestore(fx)) {
        // 回盾模组：与普通模组一致地显示冷却倒计时；就绪且有能量、盾未满时显示"可回盾"
        const cooling = c.inst.cooldown > 0;
        c.el.classList.toggle('cooling', cooling);
        if (cooling) {
          c.el.classList.remove('active');
          c.badge.textContent = String(c.inst.cooldown);
          c.badge.style.display = '';
        } else {
          c.badge.style.display = 'none';
          c.el.classList.toggle(
            'active',
            s.hull.shield < s.hull.shieldCap && s.hull.energy >= (fx.energy_cost || 0)
          );
        }
      } else {
        // 其它（如目标级抑制等）：通用冷却倒计时/就绪
        const cooling = c.inst.cooldown > 0;
        c.el.classList.toggle('cooling', cooling);
        c.el.classList.toggle('ready', !cooling);
        if (cooling) {
          c.badge.textContent = String(c.inst.cooldown);
          c.badge.style.display = '';
        } else {
          c.badge.style.display = 'none';
        }
      }
      // ★ 门控型模块（词条 `hp_below_activate` 低血门控等）：**条件未满足 → 不显示“就绪”脉动**
      //   （单位面板无文字状态位，故以“去掉 ready 光晕/脉动”表达「条件未满足」，与详情页状态行
      //    同一引擎判据 `battle.moduleGateMet`，UI 不自算；持续/冷却徽标保持不动，不与既有展示回归）。
      if (stateModuleGate(c.inst) === false) c.el.classList.remove('ready');
    }
  }

  function update(s) {
    // 无敌状态：护盾条变白并泛白光晕（仅护盾条，非整卡）
    if (isInvincibleShip(s)) {
      shieldBar.setColor('var(--invincible)');
      shieldBar.glow('0 0 10px 1px rgba(255,255,255,0.85)');
    } else {
      shieldBar.setColor('var(--shield)');
      shieldBar.glow('');
    }
    hpBar.update(s.hull.hp, s.hull.hpMax);
    shieldBar.update(s.hull.shield, s.hull.shieldCap);
    energyBar.update(s.hull.energy, s.hull.energyCap);
    // ★ 货舱容量条（货物 / 矿物）：容量为 0 → 整条隐藏（唯一规则，与详情/指挥栏一致）；
    //   当前装载量读引擎口径 `cargoLoadOf`/`oreLoadOf`（M4 前恒 0）。
    const cp = cargoCapPartsOf(s);
    const op = oreCapPartsOf(s);
    cargoBar.el.classList.toggle('hidden', cp.total <= 0);
    oreBar.el.classList.toggle('hidden', op.total <= 0);
    if (cp.total > 0) cargoBar.update(cargoLoadOf(s), cp.total);
    if (op.total > 0) oreBar.update(oreLoadOf(s), op.total);
    // 护盾值改变：按改变类型变色+同色光，宽度缓动到位后回本色（自动由 nextBarTint 过期触发）
    const agTint = nextBarTint('ship:' + s.id, s.hull.shield, shieldTint(s));
    if (agTint) {
      shieldBar.setColor(agTint.color);
      shieldBar.glow(agTint.glow);
    }
    cardEl.classList.toggle('dead', !s.alive);
    cardEl.classList.toggle('selected', selectedId === s.id);
    // 临时单位存活剩余时间（秒）；非临时单位隐藏
    if (s.temp && s.alive && typeof s.tempLeft === 'number') {
      lifeEl.style.display = '';
      lifeEl.textContent = i18n.t('battle.lifeLeft', { n: Math.max(0, Math.ceil(s.tempLeft / SEC_TICKS)) });
    } else {
      lifeEl.style.display = 'none';
    }
    refreshChips(s);
    intentEl.textContent = s.alive
      ? i18n.t('battle.intent', { act: nextActionText(s) })
      : i18n.t('battle.act.dead');
    // 单位框显示主要目标（船级/全队策略，与核心同一逻辑）
    if (s.alive) {
      const cur = currentTargetOf(s);
      focusEl.replaceChildren(
        ...targetLabelNodes('battle.unit.focus', s.alive ? cur : null, 'battle.unit.focusNone')
      );
    } else {
      focusEl.textContent = '';
    }
  }
  update(ship);
  return { el: cardEl, update };
}

/* ================= 布局构建 ================= */

/** 一个分区（栏）：标题 + 单位行（+ 可选空栏提示）。
 *  ★ **无单位时整栏自动隐藏**（由 syncZoneVisibility 统一刷新）——敌我双方的战斗/后勤栏皆然：
 *    单位入场（含召唤）后自动出现，全部阵亡/离场后自动隐藏，不留空框。 */
function zoneEl(labelKey, sideClass, emptyHintKey) {
  const label = el('div', { class: 'zone-label', text: i18n.t(labelKey) });
  const unitsRow = el('div', { class: 'zone-units' });
  const children = [label, unitsRow];
  const hint = emptyHintKey ? el('div', { class: 'zone-hint', text: i18n.t(emptyHintKey) }) : null;
  if (hint) children.push(hint);
  const zone = el('div', { class: `battle-zone ${sideClass || ''}`.trim() }, children);
  const rec = { zone, unitsRow, hint, side: sideClass || '' };
  zone.classList.add('hidden'); // 初始隐藏，由 syncZoneVisibility 按单位数显示
  return rec;
}

/** 刷新四个分区的显隐：**该栏没有单位卡就隐藏**（战斗/后勤、敌我共四条规则完全一致）。 */
function syncZoneVisibility() {
  for (const z of allZones) {
    if (!z) continue;
    const n = z.unitsRow.children.length;
    z.zone.classList.toggle('hidden', n === 0);
    if (z.hint) z.hint.classList.toggle('hidden', n > 0);
  }
}

/** 指挥栏（原技能行）：设置全队（我方阵营）主要目标的自动策略 */
function buildCommandZone() {
  const label = el('div', { class: 'zone-label', text: i18n.t('battle.zone.command') });
  cmdSel = el(
    'select',
    { class: 'command-policy', 'aria-label': i18n.t('battle.command.fleet') },
    TARGET_POLICIES.map((p) => el('option', { value: p, text: i18n.t(`battle.policy.${p}`) }))
  );
  cmdSel.addEventListener('change', () => {
    if (!battle) return;
    battle.setAllyPolicy(cmdSel.value);
    refreshCommand();
    if (detail) detail.refreshStats();
    if (updateCards) updateCards();
  });
  cmdPreview = el('span', { class: 'command-preview', text: '' });
  // 共享护盾条行构造器（同盟 / 防爆 / 货物 / 矿物 各一行，无则隐藏）
  //   `extraCls`：`''`=同盟、`'is-blast'`=防爆、`'is-cargo'`=货物、`'is-ore'`=矿物
  //   （同一行体例，仅**填充/文字配色**不同：货物橙、矿物绿，其余沿用共享护盾条的既有蓝）
  const makeRow = (nameKey, extraCls) => {
    const fill = el('div', { class: `command-alliance-fill${extraCls ? ` ${extraCls}` : ''}` });
    const num = el('span', { class: 'command-alliance-num', text: '' });
    const row = el('div', { class: `command-alliance-row${extraCls ? ` ${extraCls}` : ''} hidden` }, [
      el('span', { class: 'command-alliance-label', text: i18n.t(nameKey) }),
      el('div', { class: 'command-alliance-track' }, [fill]),
      num,
    ]);
    return { row, fill, num };
  };
  const al = makeRow('module.allianceShield', '');
  cmdAlliance = al.row;
  cmdAllianceFill = al.fill;
  cmdAllianceNum = al.num;
  const bp = makeRow('module.blastShield', 'is-blast');
  cmdBlast = bp.row;
  cmdBlastFill = bp.fill;
  cmdBlastNum = bp.num;
  // ★ 货舱总量行（货物 / 矿物）：与共享护盾条**同一处、同一视觉体例**（值走引擎阵营合计口径）；
  //   与共享护盾条一致地**只显示己方（我方）一侧**（指挥栏本就是“我方全队”栏，敌方不镜像）。
  const cg = makeRow('battle.cargo', 'is-cargo');
  cmdCargo = cg.row;
  cmdCargoFill = cg.fill;
  cmdCargoNum = cg.num;
  const or = makeRow('battle.ore', 'is-ore');
  cmdOre = or.row;
  cmdOreFill = or.fill;
  cmdOreNum = or.num;
  const bar = el('div', { class: 'command-bar' }, [
    el('span', { class: 'command-label', text: i18n.t('battle.command.fleet') }),
    cmdSel,
    cmdPreview,
  ]);
  const zone = el('div', { class: 'battle-zone command' }, [
    label,
    bar,
    cmdAlliance,
    cmdBlast,
    cmdCargo,
    cmdOre,
  ]);
  refreshCommand();
  return { zone };
}

/** 渲染一行共享护盾条：pool 非空(有持续中护盾)才显示。 */
function renderSharedRow(row, fill, num, pool) {
  if (!row || !fill || !num) return;
  if (pool && pool.max > 0) {
    const pct = Math.max(0, Math.min(100, (pool.value / pool.max) * 100));
    fill.style.width = pct.toFixed(1) + '%';
    num.textContent = `${Math.round(pool.value)} / ${Math.round(pool.max)}`;
    row.classList.remove('hidden');
  } else {
    fill.style.width = '0%';
    num.textContent = '';
    row.classList.add('hidden');
  }
}

/** ★ 星区资源栏（指挥栏**下方**独立一栏）。**最终 DOM 顺序**：
 *    〔栏目标题 `.zone-label`〕→〔横向行 `.sector-line`：**星区冷却组 ＋ 星区货物组 并排**〕
 *    →〔矿物储量条 `command-alliance-row.is-ore`（整行，保持现状）〕。
 *  · 数据唯一来源＝引擎只读口径 `battle.sector`（`{name, oreReserve（剩余）, oreReserveInit（初始）,
 *    cd（星区侧模块冷却剩余：模块 id → ticks，只含冷却中者）, cargos（货物实体＋派生 queued/queueIndex）,
 *    cargoQueue（队列 id 有序副本）}`）—— UI **只读、绝不自算**。
 *  · 「有星区数据」＝储量 > 0 或名称非空；否则整栏隐藏（沿用既有“为空则隐藏”的唯一规则）。
 *  · 栏目标题＝**星区名称原样显示**（用户自定义字符串，不做 i18n）；无名称时回退通用文案「星区」。
 *  · **星区冷却组**：为**每个带星区冷却词条 `sector_cd_ticks` 的模块**各一行（识别函数与引擎门控
 *    **同源**：`data/sector.js hasSectorCdFx`；按 `MODULES` **自动枚举、不硬编码模块 id**），
 *    行体例复用 `command-alliance-row`（无进度条，仅「模块名 + 剩余冷却」）；
 *    **只在冷却中显示该行、就绪即隐藏**，各模块各显各的；无星区数据 → 整组隐藏。
 *  · **星区货物组**（与冷却组**并排**于同一横向行）：**小节标题单独一行 ＋ 货物芯片单独一行**
 *    （组内**纵向两行**：`.sector-cargo-group` ＞ 标题 / `.sector-cargo-chips`；芯片行内 `flex-wrap` 可换行）。
 *    为星区每件**货物实体**一个小芯片（**高度固定 32px**；字号与详情页**目标选择器**
 *    `.target-chk`、编队类型芯片 `.drill-cargo-type` **同一来源 `--chip-font-size`**，
 *    圆角/边框/水平内距一致）——**构造器唯一**：`buildCargoChip`（详情页「装载货物」栏同源复用）。
 *    ★ **芯片 DOM＝六段独立元素**（各段各自成元素、各自带 i18n 短模板，**不硬拼成长串**）：
 *      `[.cargo-chip-seq 序号/占位] [.cargo-chip-name 名称] [.cargo-chip-bonus 加成%]`
 *      `[.cargo-chip-lv 等级] [.cargo-chip-meta 吨位·装载秒] [.cargo-chip-pad 末尾填充]`
 *    · 序号：**已入队**显示其**优先队列序号**（1 起，**读引擎 `queueIndex`、UI 不自算**）；
 *      **未入队**该元素文本为空 ⇒ 由 CSS **定宽保留序号位**（右对齐）⇒ 入队/取消**芯片宽度与文字位置不跳动**；
 *    · **末尾填充 `.cargo-chip-pad`** 是**与序号列同宽**的占位格（CSS 侧两者**共用同一宽度变量**
 *      `--cargo-seq-w`，UI 只建一个空元素、不写任何宽度数值）⇒ 左右留白对称、「名称+内容」视觉居中；
 *      该格**兼作「已强化」徽标位**（引擎只读 `enhanced` ⇒ 显示语言无关符号 `※`，否则保持空占位）；
 *    · 名称段：用户自定义名称；空串 ⇒ 回退**类型名**词条 `nameKey`（无额外模板，名称本身即数据）；
 *    · 加成段（**紧跟名称之后**）：i18n `battle.sector.cargoBonus`（`'{v}%'`），`v` 来自**唯一换算**
 *      `core/utils.js formatBonusPercent(bonus)`（倍率 → 增量百分比；`bonus=1` ⇒ `'0'` ⇒ **整段隐藏**）；
 *    · 等级段（**加成之后**）：i18n `battle.sector.cargoLv`（`'Lv{level}'`），**等级 = 1 时整段隐藏**；
 *    · 末尾文字段：i18n `battle.sector.cargoMeta`（`'{tons}t · {load}s'`；装载秒数走**唯一换算**
 *      `core/tick.js formatTickSeconds`）；
 *    · 段间分隔符由 CSS `::before` 提供 ⇒ **某段隐藏时其分隔符自动消失**（不会留下孤立 `·`）；
 *    · 文字过长 ⇒ 名称段/末尾段**在段内省略号收尾**，序号列与末尾填充**不收缩** ⇒ 不溢出、不裁切；
 *    · **边框色＝类型色**：由 `colorKey`（货物定义里的 **CSS 变量名**，如 `--cat-attack`）写入芯片的
 *      `--chip-color` ⇒ UI 不硬编码任何色值，默认类型 None 即灰 `--cat-none`；
 *    · 芯片是**可点击按钮**：点击＝调用引擎**唯一切换接口** `battle.toggleCargoQueue(id)`
 *      （加入/移出**优先队列**；再次点击＝取消），随后按引擎只读口径**重绘**；
 *    · **选中态**＝引擎派生的 `queued`（**边缘发光 + 内部填充**，颜色仍取类型色）；
 *    · **装载中**＝引擎派生的 `locked`（CSS 置灰 + 虚线边）：此时**点击不改队列**——引擎
 *      `toggleCargoQueue` 直接拒绝（`ok:false, reason:'locked'`），UI 不自算“能不能点”；
 *      悬停提示改用 `battle.sector.cargoLockedHint`；
 *    · **无货物 → 整组隐藏**（沿用“为空则隐藏”唯一规则）。★ 星区货物列表是**队列式（前出后入）、
 *      长度不限**：装载走 ⇒ 芯片隐藏；返还/新增 ⇒ 芯片**按需补建**并按**引擎列表顺序**排到末尾
 *      （顺序口径与补齐逻辑见 `refreshSectorZone`，UI 不另算顺序）。 */
function buildSectorZone() {
  const label = el('div', { class: 'zone-label', text: '' });
  // ★ 星区冷却组：小节标题 + 各模块一行（仅冷却中显示）
  const cdTitle = el('div', { class: 'zone-label', text: i18n.t('battle.sector.cdTitle') });
  const cdRows = Object.values(MODULES)
    .filter((m) => isSectorCdModuleFx(m.effects))
    .map((m) => {
      const tickEl = el('span', { class: 'command-alliance-num', text: '' });
      const r = el('div', { class: 'command-alliance-row hidden' }, [
        el('span', { class: 'command-alliance-label', text: i18n.t(m.nameKey) }),
        tickEl,
      ]);
      return { id: m.id, row: r, tickEl };
    });
  const cdGroup = el('div', { class: 'sector-cd-group hidden' }, [
    cdTitle,
    ...cdRows.map((c) => c.row),
  ]);
  // ★ 星区货物组：**小节标题单独一行 + 货物芯片单独一行**（组内纵向两行；芯片行内仍可换行）
  //   ★ 芯片**不在建栏时一次性建齐**：星区列表是**队列式（前出后入）**、长度不限 ⇒ 运行时可能出现
  //     建栏时并不存在的货物（装载后返还星区的“外来货物”）⇒ 由 `refreshSectorZone` **按需补齐**，
  //     并按**引擎列表顺序**排列芯片（走 `arrangeChips`：顺序未变则零 DOM 操作 ⇒ 芯片顺序＝队列顺序，
  //     且不会因每帧搬动节点而丢点击）。
  const cargoTitle = el('div', { class: 'zone-label', text: i18n.t('battle.sector.cargoTitle') });
  const cargoChips = []; // 芯片项数组（星区栏专属；身份＝`item.cargo.id`）
  const cargoChipRow = el('div', { class: 'sector-cargo-chips' });
  const cargoGroup = el('div', { class: 'sector-cargo-group hidden' }, [cargoTitle, cargoChipRow]);
  // ★ **星区栏货物芯片的唯一点击绑定点＝容器级事件委托**（不逐芯片 `addEventListener`）：
  //   容器 `cargoChipRow` 与整栏同生命周期、**永不重建** ⇒ 芯片按需补建/被重排都**不会丢绑定**；
  //   点击 ⇒ 调引擎**唯一切换接口** `battle.toggleCargoQueue(id)`（入队/出队；**被装载器锁定 ⇒ 引擎
  //   直接拒绝**），随后一律回到只读口径重绘 ⇒ 状态以引擎为准，UI **不自算任何规则**。
  //   货物 id 取自芯片节点上的 `data-cargo-id`（由 `refreshCargoChipText` 从引擎口径同步）。
  cargoChipRow.addEventListener('click', (e) => {
    const node = e.target && typeof e.target.closest === 'function' ? e.target.closest('.cargo-chip') : null;
    if (!node || !cargoChipRow.contains(node)) return;
    if (!battle || typeof battle.toggleCargoQueue !== 'function') return;
    const cargoId = node.dataset ? node.dataset.cargoId : '';
    if (!cargoId) return;
    battle.toggleCargoQueue(cargoId);
    refreshSectorZone();
  });
  // ★ 横向行：冷却组与货物组并排（窄屏由 CSS 断点改为纵向堆叠）
  const line = el('div', { class: 'sector-line' }, [cdGroup, cargoGroup]);
  // 储量条（整行、保持现状）
  const fill = el('div', { class: 'command-alliance-fill is-ore' });
  const num = el('span', { class: 'command-alliance-num', text: '' });
  const row = el('div', { class: 'command-alliance-row is-ore hidden' }, [
    el('span', { class: 'command-alliance-label', text: i18n.t('battle.sector.ore') }),
    el('div', { class: 'command-alliance-track' }, [fill]),
    num,
  ]);
  const zone = el('div', { class: 'battle-zone sector hidden' }, [label, line, row]);
  return { zone, label, cdGroup, cdRows, row, fill, num, cargoGroup, cargoChipRow, cargoChips };
}

/** ★ 把 `nodes` 按给定顺序排进容器 —— **顺序未变时一个 DOM 操作都不做**（顺序稳定＝点击不被干扰）。
 *  · 为什么必须这样：`append` 对**已在容器内**的节点也会**先移除再插入**（即使目标位置没变），而星区栏/
 *    详情栏都是**每 tick 刷新**的 ⇒ 若每帧都重排，鼠标按下与抬起之间按钮被“搬动”了一次，浏览器可能把
 *    `click` 派发到**共同祖先**（容器）而不是按钮本身 ⇒ **点击落空**（表现为“点了没反应”）。
 *    本函数先比对现有子元素顺序：**完全一致 ⇒ 直接 return**（零 DOM 变更）；
 *  · 不一致时只对**位置确实不同**的节点做 `insertBefore` 微调（不做整体 `replaceChildren`，
 *    既有节点与事件状态一律保留）；不在 `nodes` 里的元素（如已隐藏的旧芯片）自然被留在末尾。
 *  · UI **只按引擎给的顺序排**，本函数不参与任何顺序计算（顺序口径仍在引擎侧）。 */
function arrangeChips(container, nodes) {
  if (!container) return;
  const cur = container.children;
  if (cur.length === nodes.length) {
    let same = true;
    for (let i = 0; i < nodes.length; i += 1) {
      if (cur[i] !== nodes[i]) { same = false; break; }
    }
    if (same) return; // ★ 顺序未变 ⇒ 零 DOM 操作（关键：保住点击）
  }
  for (let i = 0; i < nodes.length; i += 1) {
    const want = nodes[i];
    const at = container.children[i];
    if (at === want) continue;
    container.insertBefore(want, at || null);
  }
}

/** ★ 建一个**星区栏**货物芯片：构造器与详情页**共用** `buildCargoChip`（同一套 DOM/样式/文案口径）。
 *  星区列表是**队列式、长度不限**（可能运行时新增货物）⇒ 建芯片走本函数、**按需补齐**（见 `refreshSectorZone`）。
 *  ⚠ **本函数不绑点击**：点击由**容器级事件委托**统一处理（唯一绑定点在 `buildSectorZone` 的
 *  `cargoChipRow` 上）——逐芯片绑定会在“芯片被移动/重建”时有丢绑定的风险，委托从结构上排除该风险。 */
function buildSectorCargoChip(c) {
  return buildCargoChip(c);
}

/** 货物芯片·**名称段**文本：用户自定义名称优先；空串 ⇒ 回退该货物的**类型名**词条（`nameKey`）。
 *  （名称本身是数据，故不再套一层 i18n 拼接模板；吨位/装载秒/等级各自成段、各走自己的短模板。） */
function cargoNameText(c) {
  return c.name || (c.nameKey ? i18n.t(c.nameKey) : c.type);
}

/** ★ **「已强化」徽标字符**：`※` —— **语言无关符号**，故直接以**常量**提供、**不占 i18n 键**
 *  （悬停说明另用最短键 `battle.sector.cargoEnhanced`，只有它需要翻译）。
 *  出现在芯片**末尾占位格** `.cargo-chip-pad` 内（星区栏与单位详情栏**共用同一构造器** ⇒ 两处同时生效）；
 *  未强化时该格保持**空占位**，宽度由 CSS 与序号列**同宽口径** `.cargo-seq-w` 固定 ⇒ 芯片宽度与文字位置
 *  **不跳动**（徽标本身不新造配色：沿用芯片正文色＝类型色）。 */
const CARGO_ENHANCED_MARK = '※';

/* ===== 货物芯片（**唯一构造器**：星区栏与单位详情「装载货物」栏共用同一套 DOM/样式/文案口径） =====
 * ★ DOM＝**六段独立元素**（顺序＝视觉顺序）：
 *     `[.cargo-chip-seq 序号/占位] [.cargo-chip-name 名称] [.cargo-chip-bonus 加成%]
 *      [.cargo-chip-lv 等级] [.cargo-chip-meta 吨位·装载秒] [.cargo-chip-pad 末尾占位/已强化徽标]`
 *   · 序号列 / 末尾占位格**定宽**（宽度口径在 CSS，两段共用同一变量）；详情页不使用序号列（留空占位）。
 *   · ★ **末尾占位格兼作「已强化」徽标位**：货物 `enhanced === true`（**引擎只读口径**，UI 不自算）
 *     ⇒ 该格显示语言无关符号 `※`（常量 `CARGO_ENHANCED_MARK`）＋悬停说明 `battle.sector.cargoEnhanced`；
 *     否则**空占位**（定宽 ⇒ 宽度与文字位置不跳动）。
 * ★ 文案：名称段＝`cargoNameText`；加成段＝`battle.sector.cargoBonus`（`bonus=1` ⇒ 整段隐藏）；
 *   等级段＝`battle.sector.cargoLv`（等级=1 ⇒ 整段隐藏）；末段＝`battle.sector.cargoMeta`
 *   （吨位取整、装载秒走**唯一换算** `core/tick.js formatTickSeconds`）。
 * ★ 颜色：`--chip-color` 由货物 `colorKey`（CSS 变量名）写入 ⇒ 边框＝**类型色**（None ⇒ 灰）。
 * 返回 `{ cargo, chip, seqEl, nameEl, bonusEl, lvEl, metaEl, padEl, sig }`（`sig` 供刷新时判“文案要不要重写”）。 */
function buildCargoChip(c) {
  const seqEl = el('span', { class: 'cargo-chip-seq' }); // 定宽序号列（详情页恒空＝占位）
  const nameEl = el('span', { class: 'cargo-chip-name' });
  const bonusEl = el('span', { class: 'cargo-chip-bonus' });
  const lvEl = el('span', { class: 'cargo-chip-lv' });
  const metaEl = el('span', { class: 'cargo-chip-meta' });
  const padEl = el('span', { class: 'cargo-chip-pad' }); // 末尾占位格（与序号列同宽；兼作「已强化」徽标位）
  const chip = el('button', { class: 'cargo-chip', type: 'button' }, [
    seqEl,
    nameEl,
    bonusEl,
    lvEl,
    metaEl,
    padEl,
  ]);
  // ★ 类型色**唯一来源**＝货物定义的 `colorKey`（CSS 变量名）；缺失 → 兜底 None 灰
  chip.style.setProperty('--chip-color', `var(${c.colorKey || '--cat-none'})`);
  const item = { cargo: c, chip, seqEl, nameEl, bonusEl, lvEl, metaEl, padEl, sig: '' };
  refreshCargoChipText(item);
  return item;
}
/** 刷新货物芯片的**文字段**（名称/加成/等级/吨位·装载秒/末尾徽标）——只在文案签名变化时重写 DOM（不逐 tick 抖动）。
 *  ★ 各段取值口径与 `buildCargoChip` 完全一致（**同一实现**，不存在第二套文案逻辑）：
 *    进舱后 `loadTicks` 会被引擎永久改写为 20t ⇒ 末段（装载秒数）随之刷新。 */
function refreshCargoChipText(item) {
  const c = item.cargo;
  // ★ 把**引擎口径的货物 id** 同步到芯片节点（`data-cargo-id`）——**容器级事件委托**靠它定位货物：
  //   委托把监听器**唯一地**绑在行容器上（星区栏 `.sector-cargo-chips` / 详情栏 `.detail-cargos-chips`），
  //   容器与面板同生命周期、**永不重建** ⇒ 芯片被移动/重建都**不会丢绑定**（比逐芯片 `addEventListener` 稳）。
  //   只在变化时写，避免每 tick 无谓的 DOM 属性写。
  const idStr = c && c.id != null ? String(c.id) : '';
  if (item.chip.dataset.cargoId !== idStr) item.chip.dataset.cargoId = idStr;
  const bonusV = formatBonusPercent(c.bonus);
  const enhanced = !!c.enhanced; // ★ 引擎只读口径（一次性强化标记）；UI 不自算
  const sig = `${c.name || ''}|${c.nameKey || ''}|${c.type || ''}|${c.tons}|${c.loadTicks}|${c.level}|${bonusV}|${enhanced ? 1 : 0}`;
  if (sig === item.sig) return;
  item.sig = sig;
  item.nameEl.textContent = cargoNameText(c);
  // ★ 加成：唯一换算 `core/utils.js formatBonusPercent`（**倍率** → 增量百分比）；无加成（`'0'`）⇒ 整段隐藏
  //   （⚠ 与「货物强化」效果列/战报用的 `formatBonusDeltaPercent`（**增量**口径）分工不同，见该函数注释）
  if (bonusV === '0') {
    item.bonusEl.classList.add('hidden');
    item.bonusEl.textContent = '';
  } else {
    item.bonusEl.classList.remove('hidden');
    item.bonusEl.textContent = i18n.t('battle.sector.cargoBonus', { v: bonusV });
  }
  // ★ 等级：仅等级 ≠ 1 时显示该段（隐藏时其分隔符随 CSS `::before` 一并消失）
  if ((c.level | 0) > 1) {
    item.lvEl.classList.remove('hidden');
    item.lvEl.textContent = i18n.t('battle.sector.cargoLv', { level: c.level });
  } else {
    item.lvEl.classList.add('hidden');
    item.lvEl.textContent = '';
  }
  item.metaEl.textContent = i18n.t('battle.sector.cargoMeta', {
    tons: Math.round(c.tons),
    load: formatTickSeconds(c.loadTicks),
  });
  // ★ **「已强化」徽标**（`enhanced === true`）：写在**末尾占位格**里（**不新增一段 DOM** ⇒ 六段结构不变）；
  //   未强化 ⇒ 该格文本清空、`title` 清空，宽度由 CSS 定宽保持 ⇒ **芯片宽度与文字位置不跳动**。
  item.padEl.textContent = enhanced ? CARGO_ENHANCED_MARK : '';
  item.padEl.title = enhanced ? i18n.t('battle.sector.cargoEnhanced') : '';
}

/** 用**最新只读快照**批量刷新一批货物芯片的文字段（星区栏 / 详情页共用同一实现）。
 *  · `live` ＝该批芯片对应的货物字段对象列表（星区侧读 `battle.sector.cargos`、单位侧读
 *    `cargoListOf(ship)`：**同一套字段名**，UI 只读、不自算任何值）；
 *  · 芯片在**建时**持有的货物对象是**快照副本**（星区只读口径每次返回新对象）⇒ 这里用最新快照
 *    覆盖 `chip.cargo`，从而反映引擎侧的变化（例如**装载完成后 `loadTicks` 被永久改写为 20t**）；
 *  · 文案重写有**签名兜底**（`refreshCargoChipText` 内）⇒ 未变化时不写 DOM（不逐 tick 抖动）。 */
function refreshCargoChipList(chips, live) {
  for (const item of chips || []) {
    const cur = (live || []).find((x) => x.id === item.cargo.id);
    if (!cur) continue; // 该货物当前不在本列表（如已被装载/仍在星区）→ 调用方负责显隐
    item.cargo = cur;
    refreshCargoChipText(item);
  }
}

/** 刷新星区资源栏（有星区数据才显示；含星区冷却组：仅冷却中显示、就绪隐藏；含星区货物组：无货物则整组隐藏）。
 *  ★ 「星区冷却组」的显示规则：**组内至少有一行冷却中**才显示该组（含小节标题）；全就绪 → 整组隐藏；
 *    **无星区数据 → 整组隐藏**（随整栏隐藏）。所有数值只读引擎口径 `battle.sector.cd`，UI 不自算。
 *  ★ 「星区货物组」的显示规则：**星区有货物**才显示该组；每个芯片的**选中态**只读
 *    `battle.sector.cargos[].queued`（引擎派生）——点击只调 `battle.toggleCargoQueue`，
 *    **UI 不自算队列**；**序号列**只读引擎派生的 `queueIndex`（未入队 ⇒ 该列为空、但**定宽占位仍在**）；
 *    **装载中**（`locked`）⇒ 置灰 + 虚线边 + 点击无效（引擎拒绝），悬停提示换成「装载中」文案。
 *  ★★ **芯片顺序＝引擎列表顺序（队列式：前出后入）**：星区列表长度不限、且运行时可能新增货物
 *    （装载后返还星区的“外来货物”）⇒ 本函数每帧：① 为**列表中有、却还没有芯片**的货物**按需建芯片**；
 *    ② 按列表顺序 `append` 芯片（既有节点被**移动**）⇒ 溢出/返还后**后入者排到末尾**、其余前移；
 *    ③ 不在列表中的芯片（被装载走/已消耗）**隐藏但保留 DOM**（不重建、不丢事件绑定）。
 *    ⚠ 「**优先队列**」`queueIndex`（玩家点击入队的优先级序号）与「**列表顺序**」是**两个概念**：
 *      前者只读引擎派生的 `queueIndex`、后者＝引擎 `cargos` 数组顺序 —— UI 都不自算。 */
function refreshSectorZone() {
  if (!sectorZ) return;
  const sec = battle && battle.sector ? battle.sector : null;
  const hasName = !!(sec && sec.name);
  const hasOre = !!(sec && sec.oreReserveInit > 0);
  const has = !!(sec && (hasName || hasOre));
  sectorZ.zone.classList.toggle('hidden', !has);
  // 星区冷却组：**无星区数据 → 整组隐藏**；否则逐行「剩余 > 0 才显示」，并据此决定整组显隐
  let anyCd = false;
  for (const c of sectorZ.cdRows || []) {
    const rem = has ? (sec.cd && sec.cd[c.id]) || 0 : 0;
    c.row.classList.toggle('hidden', !(rem > 0));
    c.tickEl.textContent = rem > 0 ? i18n.t('battle.sector.cd', { n: rem }) : '';
    if (rem > 0) anyCd = true;
  }
  if (sectorZ.cdGroup) sectorZ.cdGroup.classList.toggle('hidden', !anyCd);
  // ★ 星区货物组：**无货物 → 整组隐藏**（沿用“为空则隐藏”唯一规则；整栏无星区数据时同样隐藏）。
  //   芯片只读引擎只读口径：`queued`（选中态）／`queueIndex`（**序号列**，未入队⇒置空、定宽占位仍在）
  //   ／`locked`（**装载中**：置灰 + 虚线边，且点击无效——引擎侧 `toggleCargoQueue` 拒绝）。
  const cargoList = has ? (sec.cargos || []) : [];
  // ① **按需补齐芯片**：列表是队列式且长度不限 ⇒ 出现列表中有、芯片还没有的货物时当场建（含点击绑定）
  for (const c of cargoList) {
    if (!sectorZ.cargoChips.some((x) => x.cargo.id === c.id)) {
      sectorZ.cargoChips.push(buildSectorCargoChip(c));
    }
  }
  for (const c of sectorZ.cargoChips || []) {
    const item = cargoList.find((x) => x.id === c.cargo.id); // ★ 芯片建时持有货物快照 ⇒ 以 `cargo.id` 定位
    const queued = !!(item && item.queued);
    const locked = !!(item && item.locked); // ★ 引擎派生：被装载器锁定（UI 不自算）
    const qi = item ? item.queueIndex | 0 : 0; // ★ 引擎派生的队列序号（1 起；0＝未入队）——UI 不自算
    c.chip.classList.toggle('hidden', !item);
    c.chip.classList.toggle('queued', queued);
    c.chip.classList.toggle('locked', locked);
    c.seqEl.textContent = qi > 0 ? i18n.t('battle.sector.cargoSeq', { n: qi }) : '';
    // ★ 悬停提示（**状态优先**：装载中 > 已入队 > **玩家手动卸载** > 可入队）——判据全部来自引擎只读口径：
    //   · `locked`  ⇒ 装载中（剩余秒数＝唯一换算 formatTickSeconds(需求 − 已推进)）；
    //   · `queued`  ⇒ 已入优先队列（再点＝移出）；
    //   · `manualUnloaded` ⇒ 玩家手动卸载（**分阵营 + 带时限**，引擎派生）：本阵营装载器**自动选取
    //     暂时会跳过它**；剩余秒数＝引擎派生 `manualUnloadedTicks`（**UI 不自算到期**）→ formatTickSeconds；
    //   · 其余      ⇒ 可点击入队。
    let hintKey = 'battle.sector.cargoAddHint';
    let hintParams; // 仅“需要数值”的两态传参（其余键不含 {s} ⇒ 不传，模板原样）
    if (locked && item) {
      hintKey = 'battle.sector.cargoLockedHint';
      hintParams = { s: formatTickSeconds(Math.max(0, (item.loadNeedTicks | 0) - (item.loadProgressTicks | 0))) };
    } else if (queued) {
      hintKey = 'battle.sector.cargoRemoveHint';
    } else if (item && item.manualUnloaded) {
      hintKey = 'battle.sector.cargoHoldHint';
      hintParams = { s: formatTickSeconds(Math.max(0, item.manualUnloadedTicks | 0)) };
    }
    c.chip.title = i18n.t('battle.sector.cargoHover', {
      type: item && item.nameKey ? i18n.t(item.nameKey) : '',
      hint: i18n.t(hintKey, hintParams),
    });
  }
  // ② **顺序＝引擎列表顺序**（队列式：前出后入）：按列表顺序排列 ⇒ 返还/新增的货物**排到末尾**；
  //    ③ 不在列表中的芯片已在上面 `.hidden`（**保留 DOM，不重建** ⇒ 委托绑定天然不受影响）。
  //    ★ 排列走 `arrangeChips`：**顺序未变 ⇒ 零 DOM 操作**（每帧无条件 `append` 会在鼠标按下与抬起
  //    之间搬动按钮、可能导致 click 落空 —— 见该函数注释）。
  if (sectorZ.cargoChipRow) {
    const ordered = [];
    for (const c of cargoList) {
      const chip = sectorZ.cargoChips.find((x) => x.cargo.id === c.id);
      if (chip) ordered.push(chip.chip);
    }
    arrangeChips(sectorZ.cargoChipRow, ordered);
  }
  refreshCargoChipList(sectorZ.cargoChips, cargoList);
  if (sectorZ.cargoGroup) sectorZ.cargoGroup.classList.toggle('hidden', !has || !cargoList.length);
  if (!has) {
    sectorZ.fill.style.width = '0%';
    sectorZ.num.textContent = '';
    return;
  }
  sectorZ.label.textContent = hasName ? sec.name : i18n.t('battle.zone.sector');
  sectorZ.row.classList.toggle('hidden', !hasOre); // 储量为 0 → 该行隐藏（与“为空则隐藏”同规则）
  const pct = hasOre ? Math.max(0, Math.min(100, (sec.oreReserve / sec.oreReserveInit) * 100)) : 0;
  sectorZ.fill.style.width = pct.toFixed(1) + '%';
  sectorZ.num.textContent = `${Math.round(sec.oreReserve)} / ${Math.round(sec.oreReserveInit)}`;
}

/** 刷新指挥栏：策略下拉值与当前命中目标预览；非对战中禁用 */
function refreshCommand() {
  if (!cmdSel || !cmdPreview) return;
  refreshSectorZone(); // 星区资源栏与指挥栏同批刷新（每 tick 只读引擎口径）
  if (!battle) {
    cmdPreview.textContent = '';
    cmdSel.disabled = true;
    if (cmdAlliance) { if (cmdAllianceFill) cmdAllianceFill.style.width = '0%'; cmdAlliance.classList.add('hidden'); }
    if (cmdBlast) { if (cmdBlastFill) cmdBlastFill.style.width = '0%'; cmdBlast.classList.add('hidden'); }
    if (cmdCargo) { if (cmdCargoFill) cmdCargoFill.style.width = '0%'; cmdCargo.classList.add('hidden'); }
    if (cmdOre) { if (cmdOreFill) cmdOreFill.style.width = '0%'; cmdOre.classList.add('hidden'); }
    return;
  }
  cmdSel.value = battle.allyPolicy;
  cmdSel.disabled = battle.phase !== 'running';
  const t = battle.fleetPreview('ally');
  cmdPreview.replaceChildren(
    ...targetLabelNodes('battle.command.preview', t, 'battle.command.noTarget')
  );
  // 同盟 / 防爆 共享层条：有对应持续中护盾才显示（各一行），无则隐藏
  if (typeof battle.alliancePool === 'function') {
    renderSharedRow(cmdAlliance, cmdAllianceFill, cmdAllianceNum, battle.alliancePool('ally'));
  }
  if (typeof battle.blastPool === 'function') {
    renderSharedRow(cmdBlast, cmdBlastFill, cmdBlastNum, battle.blastPool('ally'));
  }
  // ★ 货舱总量（货物 / 矿物）：走引擎阵营合计口径（`cargoPool`/`orePool`，只统计存活单位）；
  //   总量为 0 → 整行隐藏（与共享护盾条“池为空则隐藏”同一规则、同一渲染函数）。
  if (typeof battle.cargoPool === 'function') {
    renderSharedRow(cmdCargo, cmdCargoFill, cmdCargoNum, battle.cargoPool('ally'));
  }
  if (typeof battle.orePool === 'function') {
    renderSharedRow(cmdOre, cmdOreFill, cmdOreNum, battle.orePool('ally'));
  }
}

function buildStage() {
  // ★ 四栏对称：敌方后勤 / 敌方战斗 ｜（分隔线）｜ 我方战斗 / 我方后勤
  //   单位进哪一栏由**编队条目 `role`（或船型默认值）→ 实例 `ship.role`** 决定（唯一口径，见 rebuildUnits）。
  const enemyLogZ = zoneEl('battle.zone.enemyLogistics', 'enemy', null);
  const enemyZ = zoneEl('battle.zone.enemy', 'enemy', null);
  const combatZ = zoneEl('battle.zone.combat', 'ally', null);
  const logisticsZ = zoneEl('battle.zone.logistics', 'ally', null);
  allZones = [enemyLogZ, enemyZ, combatZ, logisticsZ];
  const cmdZ = buildCommandZone();
  sectorZ = buildSectorZone(); // 星区资源栏（指挥栏下方独立一栏；有星区数据才显示）
  refreshSectorZone();

  // 详情面板（选中单位后填充）
  detailEl = el('div', { class: 'battle-detail hidden' });
  showEmptyDetail();

  const logTitle = el('div', { class: 'log-title', text: i18n.t('battle.log.title') });
  const logLines = el('div');
  const logPanel = el('div', { class: 'battle-log' }, [logTitle, logLines]);

  // 战报下缘拖动手柄：手动调整战报框高度（上下拖动）
  const grip = el('div', { class: 'log-resize', title: '' });
  logPanel.appendChild(grip);
  let dragging = false;
  let startY = 0;
  let startH = 0;
  grip.addEventListener('pointerdown', (e) => {
    dragging = true;
    startY = e.clientY;
    startH = logPanel.offsetHeight;
    grip.classList.add('active');
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  grip.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const h = startH + (startY - e.clientY); // 上拉增高
    logPanel.style.height = `${Math.max(36, Math.min(520, h))}px`;
  });
  const endDrag = () => {
    dragging = false;
    grip.classList.remove('active');
  };
  grip.addEventListener('pointerup', endDrag);
  grip.addEventListener('pointercancel', endDrag);

  // ★ 区块顺序（自上而下）：敌方战报/敌方 → 分隔 → 我方战斗/后勤 → **单位详情栏** → 指挥栏 → **星区资源栏** → 战报。
  //   「单位详情栏」上移至指挥栏**之前**（原本在指挥栏之后）：详情是“选中单位的即时读数”，
  //   紧贴单位栏更符合阅读顺序；指挥栏及其下方的星区资源栏属“全局设置/全局读数”，统一靠下聚拢。
  //   纯 DOM 顺序调整：`.battle-stage` 是 flex 纵向列 + 统一 gap，无任何 order/margin 依赖 → 无需 CSS 改动；
  //   窄屏媒体查询也只改卡片/字号，不涉及区块顺序，故响应式行为不变。
  const stage = el('div', { class: 'battle-stage' }, [
    enemyLogZ.zone,
    enemyZ.zone,
    el('div', { class: 'battle-sep' }),
    combatZ.zone,
    logisticsZ.zone,
    detailEl,
    cmdZ.zone,
    sectorZ.zone,
    logPanel,
  ]);
  return { stage, enemyZ, enemyLogZ, combatZ, logisticsZ, logLines };
}

function rebuildUnits() {
  const cardById = new Map();
  // ★ 单位卡归属哪一栏：**读引擎侧的实例字段 `ship.role`**（'logistics'=后勤栏，其余=战斗栏）。
  //   该字段由 `createShip` 落地：船型默认值 `data/ships/<id>.js role` 或**编队条目 `role`** 覆盖
  //   （编队 → `startBattle` → `spawnList` → `createShip(overrides)`），UI **不自算定位**。
  //   敌我两侧同规则（同一函数），故四个分区严格对称。
  const rowOf = (ship) => {
    const logi = ship.role === 'logistics';
    if (ship.side === 'enemy') return (logi ? enemyLogZone : enemyZone).unitsRow;
    return (logi ? allyLogZone : allyZone).unitsRow;
  };
  // 每次刷新按当前 roster 调和：新增(召唤)单位建卡、被移除(临时单位阵亡/到期)单位删卡
  let lastSig = ''; // 上一次的 roster 签名（单位 id 顺序串），变化时才增删/重排卡片
  const reconcile = () => {
    const units = battle.units();
    const sig = units.map((u) => u.id).join('|');
    if (sig !== lastSig) {
      lastSig = sig;
      const present = new Set();
      for (const ship of units) {
        present.add(ship.id);
        let rec = cardById.get(ship.id);
        if (!rec) {
          rec = { ship, card: buildShipCard(ship) };
          cardById.set(ship.id, rec);
          rowOf(ship).append(rec.card.el);
        }
      }
      for (const [id, rec] of [...cardById]) {
        if (present.has(id)) continue;
        rec.card.el.remove();
        cardById.delete(id);
        if (selectedId === id) {
          selectedId = null;
          showEmptyDetail();
        }
      }
      // 按数组(渲染队列)顺序重排卡片：主力在前、召唤物在列尾
      for (const u of units) {
        const rec = cardById.get(u.id);
        if (rec) rowOf(u).appendChild(rec.card.el);
      }
      syncZoneVisibility(); // ★ 单位进出后刷新四栏显隐（无单位的栏自动隐藏）
    }
    // 每 tick 仅就地刷新数值（不触碰 DOM 顺序，避免打断点击/详情选中）
    for (const ship of units) {
      const rec = cardById.get(ship.id);
      if (rec) rec.card.update(ship);
    }
  };
  updateCards = reconcile;
  reconcile();
}

/* ================= 详情面板 ================= */

function findUnit(id) {
  return battle?.units().find((u) => u.id === id) || null;
}

function foesOf(ship) {
  return ship.side === 'ally' ? battle.enemies : battle.allies;
}

/** 目标可选池（存活、去重）：按 target 词条 kinds 展开（enemy/ally/self/any 敌我任意）
 *  ★ **过滤判据全部来自引擎** `battle.targetableBy(ship, u, kind)`（**唯一口径，UI 不自算**），含两条规则：
 *    ① **潜行过滤**（`type` 标签 `stealth`）：被标记单位不可被选为主要攻击目标；只挡“对敌目标”，
 *       自身/友方（支援类）不受影响，且不影响既已锁定的目标解析；
 *    ② **role 分离**：`enemy` 目标在“目标方仍有**可选战斗单位**（存活 且 未被潜行屏蔽）”时
 *       **跳过其后勤单位**（战斗单位全部阵亡**或全部被潜行屏蔽**时后勤解禁）；`self`/`ally`/`any`
 *       三类不做分离 —— 故**每个候选都要带上它来自哪个选择器桶**（kind），
 *       由引擎按桶判定；UI 只做“把桶名带过去”，不做任何过滤判断。 */
function candList(ship, tgt) {
  const kinds = (tgt && tgt.kinds) || [];
  const foes = ship.side === 'ally' ? battle.enemies : battle.allies;
  const same = ship.side === 'ally' ? battle.allies : battle.enemies;
  const out = []; // { u, kind }（kind＝来源选择器桶，交给引擎判据）
  // ★★ **`self` 与 `ally` 同源同序（与引擎 `moduleTargetList` 同一口径，UI 不自算顺序）**：
  //   两者都按**己方单位数组的自然顺序**一次展开 —— **自身只在其自然位置、不置顶**；
  //   带 `prefer_self` 的模块由引擎优先级链把自身排在前面（本列表给出的只是**候选顺序**，
  //   与引擎的“自然顺序”完全一致 ⇒ 默认解析结果＝本列表首位，玩家看到的按钮顺序就是实际选择顺序）。
  if (kinds.includes('self') || kinds.includes('ally')) {
    for (const u of same) {
      if (u.id === ship.id) {
        if (kinds.includes('self')) out.push({ u, kind: 'self' });
      } else if (kinds.includes('ally')) {
        out.push({ u, kind: 'ally' });
      }
    }
  }
  if (kinds.includes('enemy')) for (const u of foes) out.push({ u, kind: 'enemy' });
  if (kinds.includes('any')) for (const u of battle.units()) out.push({ u, kind: 'any' });
  const seen = new Set();
  const res = [];
  for (const { u, kind } of out) {
    if (!u.alive || seen.has(u.id)) continue;
    if (typeof battle.targetableBy === 'function' && !battle.targetableBy(ship, u, kind)) continue; // 潜行/role：不可选
    seen.add(u.id);
    res.push(u);
  }
  return res;
}

/** 目标名着色类名：友方蓝 / 敌方红 */
function sideCls(u) {
  return u.side === 'ally' ? 'side-ally' : 'side-enemy';
}

/** 单个目标名（着色节点），供"命中目标/当前目标"等显示复用 */
function unitNameSpan(u) {
  return el('span', { class: `target-name ${sideCls(u)}`, text: baseName(u) });
}

/** 把含 {name} 的模板句子渲染成 [前缀文字 + 彩色目标名( + 后缀)] 节点 */
function targetLabelNodes(key, u, noneKey) {
  const nodes = [];
  if (!u) {
    nodes.push(document.createTextNode(i18n.t(noneKey)));
    return nodes;
  }
  const tpl = i18n.t(key);
  const cut = tpl.indexOf('{name}');
  if (cut >= 0) nodes.push(document.createTextNode(tpl.slice(0, cut)));
  nodes.push(unitNameSpan(u));
  if (cut >= 0) nodes.push(document.createTextNode(tpl.slice(cut + 7)));
  return nodes;
}

/** 通用目标选择按钮渲染：single=单选指定(再点取消=跟随上游)，multi=多选互斥 */
function renderTargetPicks(container, ship, inst, cand, isSingle, cap) {
  const selected = () => {
    const t = inst.target;
    if (!t) return [];
    return t.mode === 'units' ? t.ids || [] : t.mode === 'unit' ? [t.id] : [];
  };
  const isSel = (id) => selected().includes(id);
  container.replaceChildren(
    ...cand.map((u) => {
      const b = el('button', {
        class: `target-chk ${sideCls(u)}`,
        text: baseName(u),
        title: baseName(u),
      });
      if (isSel(u.id)) b.classList.add('active');
      b.addEventListener('click', () => {
        if (isSingle) {
          inst.target =
            inst.target && inst.target.mode === 'unit' && inst.target.id === u.id
              ? { mode: 'follow' } // 再点取消 → 跟随上游
              : { mode: 'unit', id: u.id };
        } else {
          let ids = selected().filter(Boolean);
          if (isSel(u.id)) ids = ids.filter((x) => x !== u.id);
          else if (ids.length < cap) ids.push(u.id);
          inst.target = ids.length ? { mode: 'units', ids } : { mode: 'follow' };
        }
        renderTargetPicks(container, ship, inst, candList(ship, inst.cfg.target), isSingle, cap);
        if (detail) detail.refreshStats();
        if (updateCards) updateCards();
      });
      return b;
    })
  );
}

/** 某船当前"上游"目标（船级指定 → 阵营策略首个），与战斗核心同一套逻辑 */
function currentTargetOf(ship) {
  return battle && battle.shipEffectiveTarget ? battle.shipEffectiveTarget(ship) : null;
}

function showEmptyDetail() {
  if (!detailEl) return;
  detailEl.classList.add('hidden');
  detailEl.replaceChildren(
    el('div', { class: 'detail-empty', text: i18n.t('battle.detail.empty') })
  );
  detail = null;
}

function selectUnit(id) {
  if (selectedId === id) {
    selectedId = null;
    showEmptyDetail();
    updateCards?.();
    return;
  }
  selectedId = id;
  const ship = findUnit(id);
  if (ship) buildDetail(ship);
  updateCards?.();
}

/** 每次激活的基础效果文本（词条驱动，按船类系数折算后的每次量）
 *  ★ **只放数值/量词行**：本行仅列该模块的**数值词条**（如 `时间系数 −0.1`、`攻击系数 +0.2`、
 *    `受到伤害 ×0.95`、`清空目标能量上限`、`爆炸范围 1`、`血量 ≤20%`）。**不放任何机制讲解**：
 *    括号解释（如「（持续/冷却/存在时间的需求量）」）、由 `type` 标签派生的说明句
 *    （`include_self`/`prefer_self`/`lock_target_on_activate`/`force_target_self`/`solo`…）、
 *    以及其它描述性后缀一律不显示（“是否生效/是否锁定”等**状态词**另由状态行与目标行极简表达）。
 *  ★ 系数一律走 `coeff(ship, category)`（船型基础 + 运行期加性修饰），与战斗结算同一口径。
 *  ★ `damage_coeff_mul`（受伤减免）是**受击向**词条：它作用于**承受方**，不进本行的“每次造成量”；
 *    其效果由结算期实际伤害（统计/战报）体现，本行只按配置值显示该词条本身（见下方 statDamageCoeffMul）。 */
function perActText(ship, inst) {
  const fx = inst.cfg.effects;
  const coef = coeff(ship, fx.category);
  const parts = [];
  if ((fx.attack_coeff_add || 0) !== 0) {
    // ★ 展示**该等级解析后的配置值**（`inst.cfg.effects` 已按 level 合并），不是运行期生效值；
    //   “是否生效”由状态行/芯片 class 表达（同一判据 `stateModuleState`），两者不混淆。
    parts.push(i18n.t('battle.detail.statAttackCoeff', { v: fmtSignedNum(fx.attack_coeff_add) }));
  }
  if (fxHas(fx, 'damage')) {
    parts.push(i18n.t('battle.detail.statDamage', { n: Math.round(fx.damage * coef) }));
  }
  if ((fx.hp_below_activate || 0) > 0) {
    // 低血触发阈值（`hp_below_activate`，如 0.2 = 血量 ≤20% 时可激活）：**只放阈值数值本身**
    parts.push(i18n.t('battle.detail.statHpBelow', { v: Math.round(fx.hp_below_activate * 100) }));
  }
  const fxType = Array.isArray(fx.type) ? fx.type : fx.type ? [fx.type] : [];
  if ((fx.blast_range || 0) > 0) parts.push(i18n.t('battle.detail.statBlast', { n: fx.blast_range }));
  if (fxType.includes('invincible') && (fx.duration_ticks || 0) > 0)
    parts.push(i18n.t('battle.detail.statInvincible', { n: fx.duration_ticks }));
  if ((fx.ramp_per_hit || 0) > 0) {
    const cap = (fx.max_damage || 0) > 0 ? fx.max_damage : fx.damage || 0;
    parts.push(i18n.t('battle.detail.statRamp', { r: fx.ramp_per_hit, c: Math.round(cap) }));
  }
  if ((fx.time_coeff || 0) !== 0) {
    // 时间系数（负＝加速 / 正＝放缓）：**不经类别系数缩放**（时间系语义，与引擎一致），
    // 只展示系数本身（需求量 = 基础量 ×(1+系数)，取整）——不在 UI 复制换算逻辑。
    parts.push(i18n.t('battle.detail.statTimeCoeff', { v: fmtSignedNum(fx.time_coeff) }));
  }
  if (fxHas(fx, 'shield_gain')) {
    parts.push(i18n.t('battle.detail.statRegen', { n: Math.round(fx.shield_gain * coef) }));
  }
  if (fx.shield_cap_bonus > 0) {
    parts.push(i18n.t('battle.detail.statCap', { n: Math.round(fx.shield_cap_bonus * coef) }));
  }
  // ★ 自身【常驻静态加成】词条（增幅器类，无 `_target` 后缀＝作用于自身）：**只放数值**；
  //   展示该等级解析后的配置值 ×类别系数（与引擎 `selfStaticBonus`/`modulePoolCapOf` 同一口径）。
  //   ★ 一律用**带符号**数值（`{v}` + fmtSigned）：`energy_cap_bonus` 可为负（常驻削减，如护盾电池）。
  if ((fx.hp_cap_bonus || 0) !== 0) {
    parts.push(i18n.t('battle.detail.statHpCapBonus', { v: fmtSigned(fx.hp_cap_bonus * coef) }));
  }
  if ((fx.energy_cap_bonus || 0) !== 0) {
    parts.push(i18n.t('battle.detail.statEnergyCapBonus', { v: fmtSigned(fx.energy_cap_bonus * coef) }));
  }
  if ((fx.energy_regen_bonus || 0) !== 0) {
    parts.push(
      i18n.t('battle.detail.statEnergyRegenBonus', { v: fmtSigned(fx.energy_regen_bonus * coef) })
    );
  }
  // ★ 货舱容量词条（自身常驻）：货物按**运输系数**、矿物按**采矿系数**缩放（与引擎唯一口径
  //   `cargoCapacityOf`/`oreCapacityOf` 的缩放类别一致）——故此处**显式取对应类别系数**，不沿用 `coef`。
  if ((fx.cargo_cap_bonus || 0) !== 0) {
    parts.push(
      i18n.t('battle.detail.statCargoCapBonus', { v: fmtSigned(fx.cargo_cap_bonus * coeff(ship, 'transport')) })
    );
  }
  if ((fx.ore_cap_bonus || 0) !== 0) {
    parts.push(
      i18n.t('battle.detail.statOreCapBonus', { v: fmtSigned(fx.ore_cap_bonus * coeff(ship, 'mining')) })
    );
  }
  // ★ 采矿词条（自身·无目标）：每次激活的**采矿量**——同样是**自身词条**（无 `_target` 后缀）、
  //   按**采矿系数**缩放（与引擎 Pass1 的 `ore_gain × coeff(ship,'mining')` 同一口径）。
  if ((fx.ore_gain || 0) > 0) {
    parts.push(i18n.t('battle.detail.statOreGain', { n: Math.round(fx.ore_gain * coeff(ship, 'mining')) }));
  }
  // ★ 装载速度词条（`cargo_load`，自身·无目标，配合 `type` 标签 `cargo_loader`）：
  //   直接展示该等级解析后的**速度加成原值**（不经类别系数缩放——速度公式里它是**加项**：
  //   `速度 = 1 + 本值 + (运输系数 − 1)`，与引擎 `cargoLoadSpeedOf` 同一口径）。
  if ((fx.cargo_load || 0) !== 0) {
    parts.push(i18n.t('battle.detail.statCargoLoad', { v: fmtSignedNum(fx.cargo_load) }));
  }
  if ((fx.shield_coeff_add || 0) !== 0) {
    // 类别系数**加性**词条（自身）：与 `attack_coeff_add` 同体例——**不经类别系数缩放**（它本身就是系数项）
    parts.push(i18n.t('battle.detail.statShieldCoeff', { v: fmtSignedNum(fx.shield_coeff_add) }));
  }
  if ((fx.mining_coeff_add || 0) !== 0) {
    // 采矿系数**加性**词条（自身，与护盾电池同体例）：同为系数项 → **不经类别系数缩放**。
    // 影响面（引擎按需读取）：矿物容量模块部分 `oreCapacityOf`、采矿激光实采量 `ore_gain × coeff(ship,'mining')`。
    parts.push(i18n.t('battle.detail.statMiningCoeff', { v: fmtSignedNum(fx.mining_coeff_add) }));
  }
  // ★ **星区词条**（直接改星区矿物储量，无目标）：创世纪（加法）/ 矿藏富集（乘法）。
  //   两者都**不随船级系数缩放**（作用于星区而非本单位）→ 直接展示该等级的原值；
  //   乘法按“实际乘数”展示（增量比例 0.1 → ×1.1），与引擎 3c 的 `1+value` 同一口径。
  if ((fx.sector_ore_add || 0) !== 0) {
    parts.push(i18n.t('battle.detail.statSectorOreAdd', { v: fmtSigned(fx.sector_ore_add) }));
  }
  if ((fx.sector_ore_mul || 0) !== 0) {
    parts.push(
      i18n.t('battle.detail.statSectorOreMul', { v: fmtCoeffMul(1 + fx.sector_ore_mul) })
    );
  }
  if ((fx.hp_regen_per_death || 0) > 0) {
    // 按阵亡数回血（`hp_regen_per_death`，如「回收利用」）：只放**每次恢复量**，不含“上一 tick 阵亡数”
    parts.push(
      i18n.t('battle.detail.statHpRegenPerDeath', { n: Math.round(fx.hp_regen_per_death * coef) })
    );
  }
  if ((fx.shield_gain_target || 0) !== 0) {
    parts.push(i18n.t('battle.detail.statShieldT', { v: fmtSigned(fx.shield_gain_target * coef) }));
  }
  if ((fx.shield_cap_target || 0) !== 0) {
    parts.push(capTermText('statCapT', 'statCapClear', fx.shield_cap_target * coef));
  }
  // ★ **矿物输送**（`ore_target`，正值＝给目标增加矿物）：**1:1、不乘任何系数** ——
  //   故与引擎同一口径，本行**原样显示词条值**（不走下面 `tgtMeta` 的 `× coef` 通用路径）。
  if ((fx.ore_target || 0) > 0) {
    parts.push(i18n.t('battle.detail.statOreT', { n: fx.ore_target }));
  }
  // ★ **货物传输**（`type` 标签 `cargo_transfer`）：把**整件已入舱货物**原样搬运给友方 ——
  //   无数值词条（搬运的是实体本身，不做吨位换算）⇒ 本行只展示**粒度**（“1 件货物”），不编造数值。
  if (fxType.includes('cargo_transfer')) parts.push(i18n.t('battle.detail.statCargoTransfer'));
  // ★ **货物维修**（`type` 标签 `cargo_repair`）：`hp_per_ton`＝**每吨货物回复的生命值**（逐级递增）——
  //   与引擎同一口径：**词条原值、不乘任何类别系数**（回血量＝round(货物吨位 × 本值)）⇒ 不走 `× coef` 路径。
  if ((fx.hp_per_ton || 0) > 0) {
    parts.push(i18n.t('battle.detail.statHpPerTon', { v: fmtSignedNum(fx.hp_per_ton) }));
  }
  // ★ **货物强化**（`type` 标签 `cargo_enhance`）：`bonus_add`＝给**目标货舱一件尚未被强化的货物**的
  //   加成系数**加性**提高的量。⚠ 它是**增量**（0.1 ＝ +10%），**不是倍率** ⇒ 必须走**增量口径**的
  //   唯一换算 `core/utils.js formatBonusDeltaPercent`（0.1 ⇒ '+10'、−0.05 ⇒ '−5'、0 ⇒ '0'），
  //   **不得**用 `formatBonusPercent`（那是倍率口径，会把 0.1 当成倍率算出 −90%）。
  //   0 ⇒ 整段不显示；负增量按同公式正常显示（带 `−`）。
  if ((fx.bonus_add || 0) !== 0) {
    parts.push(i18n.t('battle.detail.statBonusAdd', { v: formatBonusDeltaPercent(fx.bonus_add) }));
  }
  const tgtMeta = [
    ['hp_target', 'statHpT', null],
    ['hp_cap_target', 'statHpCapT', 'statHpCapClear'],
    ['energy_target', 'statEnergyT', null],
    ['energy_cap_target', 'statEnergyCapT', 'statEnergyCapClear'],
  ];
  // ★ **自身单体模块**（`target.kinds === ['self']`，如「潜行」）：上限类词条的**作用对象就是自己** →
  //   “清空”分支改用“自身”措辞（`清空自身能量上限`）。纯展示层规则：阈值判定与数值语义完全不变。
  const selfOnlyFx = rowSelfOnly(inst);
  for (const [k, key, clearKey] of tgtMeta) {
    const raw = fx[k] || 0;
    if (raw === 0) continue;
    const v = raw * coef;
    if (clearKey) {
      parts.push(
        selfOnlyFx && k === 'energy_cap_target'
          ? i18n.t('battle.detail.statEnergyCapClearSelf')
          : capTermText(key, clearKey, v)
      );
    } else parts.push(i18n.t(`battle.detail.${key}`, { v: fmtSigned(v) }));
  }
  if ((fx.damage_coeff_mul || 0) > 0 && fx.damage_coeff_mul !== 1) {
    // 受伤减免系数（受击向，如 ×0.95 = 只承受 95% 伤害）：作用于**承受方**，展示等级解析后的配置值
    parts.push(i18n.t('battle.detail.statDamageCoeffMul', { v: fmtCoeffMul(fx.damage_coeff_mul) }));
  }
  // —— 目标级系数修饰词条（`*_target` 后缀）：作用于**解析出的目标**（非自身） ——
  if ((fx.attack_coeff_add_target || 0) !== 0) {
    parts.push(
      i18n.t('battle.detail.statAttackCoeffT', { v: fmtSignedNum(fx.attack_coeff_add_target) })
    );
  }
  if ((fx.damage_coeff_mul_target || 0) > 0 && fx.damage_coeff_mul_target !== 1) {
    parts.push(
      i18n.t('battle.detail.statDamageCoeffMulT', { v: fmtCoeffMul(fx.damage_coeff_mul_target) })
    );
  }
  if (fx.duration_ticks > 0) {
    parts.push(i18n.t('battle.detail.statDuration', { n: fx.duration_ticks }));
  }
  if (fx.summon && typeof fx.summon === 'object') {
    const st = fx.summon;
    // ★ 召唤物名**与引擎同一口径**：`doSummon` 中「模块给召唤单位显式指定名称词条(attrs.nameKey)则用之」
    //   → 本行优先显示 `attrs.nameKey`（如 欧米茄导弹/导弹/火箭），缺省才回退模板名（通用无人机模板 = 无人机）。
    const nameKey = (st.attrs && st.attrs.nameKey) || (SHIPS[st.type] ? SHIPS[st.type].nameKey : '');
    const tname = nameKey ? i18n.t(nameKey) : st.type || '';
    parts.push(
      i18n.t('battle.detail.statSummon', {
        type: tname,
        n: st.maxSummoned || 0,
        t: st.lifespan_ticks || 0,
      })
    );
  }
  return parts.join(' · ');
}

/** 本场战斗贡献文本：总伤害/总回复 + 每秒均值（DPS 等） + 激活次数
 * 分母 = 模块自身"有效贡献窗口"时长（单位存活&启用时逐 tick 累计），
 * 单位死亡或模块停用后窗口冻结 → 速率不再变化。
 */
function contribText(ship, inst) {
  const fx = inst.cfg.effects;
  const st = inst.stats;
  if (!st) return '';
  const secs = (st.activeTicks || 0) / SEC_TICKS;
  if (fxHas(fx, 'damage')) {
    const dps = secs > 0 ? st.damageDealt / secs : 0;
    const base = i18n.t('battle.detail.contrib.dmg', {
      dmg: Math.round(st.damageDealt),
      dps: dps.toFixed(1),
      act: st.activations,
    });
    // 追加"本次触发伤害"（最近一次激活造成/恢复的即时值）
    return Number.isFinite(inst.lastDmg)
      ? `${base} · ${i18n.t('battle.detail.contrib.latestDmg', { n: Math.round(inst.lastDmg) })}`
      : base;
  }
  if (fxHas(fx, 'shield_gain')) {
    const rate = secs > 0 ? st.shieldRestored / secs : 0;
    const base = i18n.t('battle.detail.contrib.regen', {
      amt: Math.round(st.shieldRestored),
      rate: rate.toFixed(1),
      act: st.activations,
    });
    return Number.isFinite(inst.lastShield)
      ? `${base} · ${i18n.t('battle.detail.contrib.latestShield', { n: Math.round(inst.lastShield) })}`
      : base;
  }
  return '';
}

/** 模块列表行（构建一次；启停按钮与状态文本按操作/tick 更新）
 * 仅"我方单位 & 战斗进行中"可操作模块（停用/启用 + 齿轮 AI 预留入口）
 * 每模块两行：数值行（名称/每次效果/耗能/冷却/状态/操作）+ 本场贡献行
 */
function moduleRows(ship) {
  const rows = [];
  const controllable = ship.side === 'ally' && battle && battle.phase === 'running';
  const sideKey = ship.side === 'ally' ? 'battle.unit.ally' : 'battle.unit.enemy';
  const unitLabel = i18n.t(sideKey, { type: baseName(ship) });

  for (const inst of ship.modules) {
    const fx = inst.cfg.effects;
    const chipEl = el('span', { class: `module-chip ${inst.cfg.category}` });
    chipEl.append(moduleGlyphEl(inst.cfg));
    const statusEl = el('span', { class: 'mod-status' });
    const metaEl = el('span', { class: 'mod-effect', text: perActText(ship, inst) });
    const dur = fx.duration_ticks || 0;
    // ★ **含矿物成本（`ore_cost`）的模块**：成本段（耗矿/耗能）与周期段**分别成词、按需拼接**——
    //   ① 不会出现“耗能 0”的误导（矿渣导弹发生器只耗矿、不耗能）；
    //   ② 不含矿物成本的既有模块**继续走原有整句键**（文案逐字不变 → 零回归）。
    //   ★ UI **只放数值、只读配置**：不判断冷却/携带量等运行期条件（那是引擎口径，UI 不自算）。
    const oreCost = fx.ore_cost || 0;
    // 常规模块的**周期段**（含矿物成本者按「耗矿 · 耗能 · 周期」分段拼接；否则沿用原有整句键）
    const cycleText =
      oreCost > 0
        ? [
            i18n.t('battle.detail.costOre', { n: oreCost }),
            (fx.energy_cost || 0) > 0 ? i18n.t('battle.detail.costEnergy', { n: fx.energy_cost }) : null,
            dur > 0
              ? i18n.t('battle.detail.perCycleDur', { d: dur, cd: fx.cooldown_ticks ?? 1 })
              : i18n.t('battle.detail.perCycle', { cd: fx.cooldown_ticks ?? 1 }),
          ]
            .filter(Boolean)
            .join(' · ')
        : dur > 0
          ? i18n.t('battle.detail.costCycleDur', { n: fx.energy_cost || 0, d: dur, cd: fx.cooldown_ticks ?? 1 })
          : i18n.t('battle.detail.costCycle', { n: fx.energy_cost || 0, cd: fx.cooldown_ticks ?? 1 });
    // ★ **装载器**（`type` 标签 `cargo_loader`）：周期措辞＝**每件货物**（该模块无自身冷却，
    //   其“忙/闲”由装载过程决定 ⇒ 显示“每 1t”会误导）；仍**只放数值、只读配置**。
    const costText = isStateModuleFx(fx)
      ? i18n.t('battle.detail.stateCost') // 状态型：无激活周期（不显示“能量/冷却 每 Nt”这种误导信息）
      : isCargoLoaderFx(fx)
        ? [
            (fx.energy_cost || 0) > 0 ? i18n.t('battle.detail.costEnergy', { n: fx.energy_cost }) : null,
            i18n.t('battle.detail.perCargo'),
          ]
            .filter(Boolean)
            .join(' · ')
        : cycleText;
    const contribEl = el('div', { class: 'mod-contrib', text: contribText(ship, inst) });
    // 该模块的独立护盾池条（仅当模块当前持有独立池——时长型护盾激活中——时显示）
    const poolMini = makeMiniPool();

    // —— 模块级目标（依据 modules.js 的 target 词条渲染：选择器与命中显示同用一套
    //    蓝=友方 / 红=敌方着色逻辑，不同模块仅候选范围 kinds 不同）——
    let targetPickEl = null;   // 统一彩色目标选择按钮（single=单选，multi=多选互斥）
    let targetInfoEl = null;   // 只读说明（multi/all 或 AI 侧）
    let targetCurEl = null;    // 当前解析命中目标实时行（彩色）
    const tgt = inst.cfg.target || {};
    const kinds = Array.isArray(tgt.kinds) ? tgt.kinds : [];
    const mode = tgt.countMode || 'single';
    const foeTarget = kinds.includes('enemy');
    const allyTarget = kinds.includes('ally');
    const anyTarget = kinds.includes('any'); // 敌我任意可指向
    const hasTargets = foeTarget || allyTarget || anyTarget;
    const selfOnly = kinds.length === 1 && kinds[0] === 'self';

    if (hasTargets) {
      targetCurEl = el('div', { class: 'mod-target-cur' });
    } else if (selfOnly) {
      targetCurEl = el('div', { class: 'mod-target-cur', text: i18n.t('battle.detail.targetSelf') });
    }

    if (controllable && hasTargets && mode !== 'all') {
      // 任意敌方/友方/敌我目标皆用同一套彩色按钮，仅候选范围不同
      targetPickEl = el('div', { class: 'mod-target-multi' });
      renderTargetPicks(
        targetPickEl,
        ship,
        inst,
        candList(ship, tgt),
        mode === 'single',
        Math.max(1, tgt.maxCount || 2)
      );
    } else if (hasTargets && mode === 'multi') {
      targetInfoEl = el('span', {
        class: 'mod-target-info',
        text: i18n.t('battle.detail.targetInfoMulti', { n: Math.max(1, tgt.maxCount || 2) }),
      });
    } else if (hasTargets && mode === 'all') {
      targetInfoEl = el('span', {
        class: 'mod-target-info',
        text: i18n.t('battle.detail.targetInfoAll'),
      });
    }

    let toggleEl = null;
    let gearEl = null;
    const controls = el('span', { class: 'mod-controls' });
    if (controllable) {
      // ★「不可停用」标签（`undeactivatable`，引擎判据 `stateModuleUndeactivatable`）：
      //   开关**灰显**（`disabled` + `.locked`）并带悬停说明；点击在 UI 侧直接返回，
      //   引擎 `disableModule` 亦会拒绝（双层，任何来源都改不动）。
      const locked = stateModuleUndeactivatable(inst);
      toggleEl = el('button', {
        class: `btn tiny${locked ? ' locked' : ''}`,
        text: '',
        title: locked ? i18n.t('battle.detail.undeactivatable') : '',
        onclick: () => {
          if (stateModuleUndeactivatable(inst)) return; // 不可停用：UI 侧不发起（引擎侧同样拒绝）
          // 走引擎启停：处理自身被动重算 + 撤销其目标级护盾上限影响/结束自身时长
          if (inst.enabled) battle.disableModule(inst);
          else battle.enableModule(inst);
          uiLog(
            inst.enabled ? 'battle.log.moduleOn' : 'battle.log.moduleOff',
            { ship: shipTok(ship, unitLabel), module: i18n.t(inst.cfg.nameKey) },
            ['ship']
          );
          if (updateCards) updateCards();
          if (detail) detail.refreshStats();
        },
      });
      toggleEl.disabled = locked;
      gearEl = el('button', {
        class: 'icon-btn',
        title: i18n.t('battle.detail.aiGear'),
        onclick: () => {
          log.add(
            i18n.t('battle.log.aiPlaceholder', { module: i18n.t(inst.cfg.nameKey) }),
            'battle'
          );
        },
      }, [el('img', { class: 'gear-img', src: './assets/img/icon-gear.svg', alt: '' })]);
      controls.append(toggleEl, gearEl);
    }

    // ★ 激活锁定提示（`lock_target_on_activate` 标签）：锁定中目标不可改，
    //   玩家点选的目标只**记录**、下一次激活才采用 —— 文案由引擎判据 `moduleTargetLocked` 决定
    const lockNoteEl = el('span', { class: 'mod-target-lock' });

    const row = el('div', { class: 'mod-row' }, [
      chipEl,
      el('span', { class: 'mod-name', text: i18n.t(inst.cfg.nameKey) }),
      el('span', { class: 'mod-lv', text: `L${inst.level}` }),
      metaEl,
      el('span', { class: 'mod-cost', text: costText }),
      statusEl,
      controls,
    ]);
    const widget = targetPickEl || targetInfoEl;
    const targetLine = widget || targetCurEl
      ? el('div', { class: 'mod-target-line' }, [
          el('span', { class: 'mod-target-cap', text: i18n.t('battle.detail.moduleTarget') }),
          el('span', { class: 'mod-target-ctl' }, [widget, lockNoteEl]),
        ])
      : null;
    const block = el('div', { class: 'mod-block' }, [
      row,
      targetLine,
      targetCurEl,
      contribEl,
      poolMini.el,
    ]);

    rows.push({
      block,
      statusEl,
      toggleEl,
      chipEl,
      contribEl,
      poolMini,
      targetPickEl,
      targetCurEl,
      lockNoteEl,
      targetSig: '',
      inst,
    });
  }
  if (!rows.length) {
    rows.push({
      block: el('div', { class: 'mod-row dim', text: i18n.t('battle.detail.noModules') }),
    });
  }
  return rows;
}

/** 状态型模块（`type` 含 `solo` 等条件标签）的**引擎判据**（唯一口径，UI 绝不自算条件）：
 *  true = 生效中；false = 条件未满足；null = 非状态型模块 / 战斗未进行中（走原有状态逻辑）。 */
function stateModuleState(inst) {
  if (!battle || typeof battle.moduleEffective !== 'function') return null;
  return battle.moduleEffective(inst);
}

/** ★ **触发门控型模块**（词条 `hp_below_activate` 低血门控等）的**引擎判据**（唯一口径，UI 绝不自算条件）：
 *  true = 门控满足（可激活）；false = **条件未满足**（不得显示“就绪”）；null = 非门控型 / 战斗未进行中。
 *  与状态型 `solo` 共用同一文案键与同一套“引擎判据 → 状态词/芯片 class”的呈现方式，不新增第二套口径。 */
function stateModuleGate(inst) {
  if (!battle || typeof battle.moduleGateMet !== 'function') return null;
  return battle.moduleGateMet(inst);
}

/** ★ **「不可停用」模块**（`type` 标签 `undeactivatable`）的**引擎判据**（唯一口径，UI 绝不自查标签）：
 *  true = 该模块不可停用（开关灰显 + 悬停说明「该模块不可停用」）；false = 可正常启停。
 *  · 引擎侧同样拒绝停用（`battle.disableModule` 直接忽略）→ UI 灰显只是**呈现**，不是唯一防线。 */
function stateModuleUndeactivatable(inst) {
  return !!(battle && typeof battle.moduleUndeactivatable === 'function' && battle.moduleUndeactivatable(inst));
}

function modStatusText(ship, inst) {
  if (inst.enabled === false) return i18n.t('battle.detail.disabled');
  // ★ **装载器进行中**（唯一读口径 `battle.cargoLoadingOf`）：装载过程**优先于**“就绪/冷却”措辞
  //   （该模块无自身冷却，若按冷却分支走会显示「就绪」而实际正在装 ⇒ 误导）。
  //   进度/需求 tick 直接来自引擎；UI 不自算、不换算（与其它状态词一样按 `t` 显示）。
  const ld = battle && typeof battle.cargoLoadingOf === 'function' ? battle.cargoLoadingOf(inst) : null;
  if (ld) return i18n.t('battle.detail.loading', { done: ld.elapsed, need: ld.need });
  // 状态型模块（条件型自身增益）：以引擎结算落地的生效标志为唯一判据
  const st = stateModuleState(inst);
  if (st === true) return i18n.t('battle.detail.stateActive');
  if (st === false) return i18n.t('battle.detail.stateInactive');
  const fx = inst.cfg.effects;
  /** ★ **空闲态状态词**（唯一出口）：**引擎门控判据未满足 → 「条件未满足」**，
   *  否则按能量给「就绪 / 能量不足」。
   *  · 门控**优先于能量**（与引擎 `maybeActivate` 的判定顺序一致：先门控、后能量门控）；
   *  · 但**不覆盖“持续中 / 冷却中”**：那两者表达模块自身的进行中状态（含门控模块在持续期内
   *    `_firedOnce` 恒为真，若让门控压倒持续期，会出现“正在倒计时引爆却显示条件未满足”的误导）。 */
  const idleStatus = (cost) =>
    stateModuleGate(inst) === false
      ? i18n.t('battle.detail.stateInactive')
      : ship.hull.energy >= (cost || 0)
        ? i18n.t('battle.detail.ready')
        : i18n.t('battle.detail.noEnergy');
  if ((fx.duration_ticks || 0) > 0) {
    // 时长型：优先展示 持续中 → 到期冷却 → 就绪/条件未满足/能量不足
    if (inst.durationLeft > 0) return i18n.t('battle.detail.buffing', { n: inst.durationLeft });
    if (inst.cooldown > 0) return i18n.t('battle.detail.cooling', { n: inst.cooldown });
    return idleStatus(fx.energy_cost);
  }
  if (isWeapon(fx)) {
    if (inst.cooldown > 0) return i18n.t('battle.detail.cooling', { n: inst.cooldown });
    return idleStatus(fx.energy_cost);
  }
  if (isShieldRestore(fx)) {
    if (ship.hull.shield >= ship.hull.shieldCap) return i18n.t('battle.detail.full');
    if (inst.cooldown > 0) return i18n.t('battle.detail.cooling', { n: inst.cooldown });
    return ship.hull.energy >= (fx.energy_cost || 0)
      ? i18n.t('battle.detail.regen')
      : i18n.t('battle.detail.noEnergy');
  }
  // 其它类型（如目标级抑制词条等）：通用 冷却/就绪/条件未满足/能量
  if (inst.cooldown > 0) return i18n.t('battle.detail.cooling', { n: inst.cooldown });
  return idleStatus(fx.energy_cost);
}

/* ===== 单位系数栏（详情页 · 位于“模块字段”之前 · **可折叠、默认折叠**） =====
 * 展示该单位的**各种系数**，数值**一律取自引擎导出函数**（不在 UI 重算任何逻辑）：
 *   · 类别系数（attack/shield/function/transport/mining/drone…）：`coeffDetail(ship, category)`
 *     —— 与战斗结算的 `coeff()` **同一次算式**（同一函数返回 base/add/mul/value 分项），
 *     故“实际值”永远等于引擎所用值。
 *   · **其它系数**（预留，**单独一行**）：`coeffDetail(...).mul` 汇总（类别系数乘性；当前无词条映射 → 显示“无”）。
 *   · **受伤减免**：`damageTakeMul(ship)`（受击向，唯一读口径）→ 显示 `×值`。
 *   · **时间系数**：`timeCoeffOf(ship)`（唯一读口径）→ 显示系数本身（负＝加速 / 正＝放缓）。
 * 每 tick 由 `refreshStats` 重算一次，故运行期修饰（加性/减免/时间系数）即时反映。
 * ★ 版式：**第一行＝7 项**（类别系数 + 受伤减免 + 时间系数，`flex-wrap` 兜底防溢出），
 *   **「其它系数」单独一行一格**（预留项不与常用项混排）→ 均不溢出/不挤压后续区域。
 * ★ 文案：**只放数值，不放任何解释性说明**（基础值、口径、预留说明一律不显示；含义在字段文档里）。
 * ★ 折叠：**默认折叠**（面板每次重建都是折叠态 → “首次进入必定折叠”；展开态在一次选中期间由
 *   `refreshStats` 保住，不因每 tick 刷新而回弹）；点击标题行任意处或回车/空格切换。 */
function buildCoeffSection(ship) {
  const item = (label, read) => {
    const val = el('span', { class: 'coeff-val' });
    const block = el('span', { class: 'coeff-item' }, [
      el('span', { class: 'coeff-name', text: label }),
      val,
    ]);
    return { block, val, read };
  };
  const items = [];
  for (const cat of Object.keys(ship.coefficients || {})) {
    items.push(
      item(i18n.t(`battle.coeff.${cat}`), () => {
        const d = coeffDetail(ship, cat); // ★ 引擎函数：base / add / mul / value 同源
        return fmtCoeffMul(d.value); // 只显示实际值（不加“基础值”等说明）
      })
    );
  }
  // 受伤减免（受击向）：唯一读口径 damageTakeMul
  items.push(item(i18n.t('battle.coeff.takeMul'), () => `×${fmtCoeffMul(damageTakeMul(ship))}`));
  // 时间系数：唯一读口径 timeCoeffOf（缺省 0；负＝加速、正＝放缓，如 −0.1 / +0.1）
  items.push(item(i18n.t('battle.coeff.timeCoeff'), () => fmtSignedNum(timeCoeffOf(ship))));
  // ★「其它系数」（**预留**）：**单独一行/单独一格**（不挤进上面那行）—— 逐类别列出乘性连乘值，无映射时显示“无”
  const extraItem = item(i18n.t('battle.coeff.mulRow'), () => {
    const parts = [];
    for (const cat of Object.keys(ship.coefficients || {})) {
      const d = coeffDetail(ship, cat);
      if (d.mul !== 1) parts.push(`${i18n.t(`battle.coeff.${cat}`)} ×${fmtCoeffMul(d.mul)}`);
    }
    return parts.length ? parts.join('、') : i18n.t('battle.coeff.none');
  });
  items.push(extraItem);

  const refresh = () => {
    for (const it of items) it.val.textContent = it.read();
  };
  refresh();
  // ★ 版式：**第一行＝7 项**（类别系数 + 受伤减免 + 时间系数），**第二行＝「其它系数」单独一格**；
  //   两行同属这一个可折叠内容块（折叠/默认折叠行为不变）；`flex-wrap` 兜底 → 不溢出、不挤压模块字段区。
  const body = el('div', { class: 'detail-coeffs' }, [
    el('div', { class: 'coeff-line' }, items.slice(0, -1).map((it) => it.block)),
    el('div', { class: 'coeff-line coeff-line-extra' }, [extraItem.block]),
  ]);

  // —— 可折叠标题行（默认折叠；点击/回车/空格切换）——
  const arrow = el('span', { class: 'fold-arrow', text: '▸' });
  const titleEl = el(
    'div',
    {
      class: 'detail-subtitle detail-fold',
      role: 'button',
      tabindex: '0',
      'aria-expanded': 'false',
    },
    [arrow, el('span', { text: i18n.t('battle.detail.coeffs') })]
  );
  const setOpen = (open) => {
    body.classList.toggle('hidden', !open); // 默认折叠：初始即 hidden
    arrow.textContent = open ? '▾' : '▸';
    titleEl.setAttribute('aria-expanded', open ? 'true' : 'false');
    titleEl.classList.toggle('open', open);
  };
  const toggle = () => setOpen(body.classList.contains('hidden'));
  titleEl.addEventListener('click', toggle);
  titleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      toggle();
    }
  });
  setOpen(false); // ★ 首次进入必须折叠

  return { titleEl, bodyEl: body, refresh };
}

/* ===== 单位详情 ·「装载货物」栏（**单位系数区块下方**；标题单独一行 + 芯片单独一行）=====
 * · 内容＝该单位**已装载（已入舱）**的货物 **＋ 该单位正在装载（锁定中、尚未入舱）**的货物，
 *   两类都用唯一构造器 `buildCargoChip`（同 `.cargo-chip` 体例、边框色＝类型色、字号随 `--chip-font-size`）；
 * · **两类芯片的视觉与点击**：
 *   · **已入舱**：现状不变 —— 点击 ⇒ 引擎**唯一接口** `battle.unloadCargo(shipId, cargoId)` 返还星区；
 *   · **在装/锁定中**：加 `.cargo-chip.locked`（**置灰 + 虚线边 + not-allowed**，与星区栏同一体例），
 *     **点击无效**（引擎侧不提供“中途返还”路径：该货物尚不在 `ship.cargos` 中，`unloadCargo` 会返回
 *     `{ok:false,reason:'cargo'}`）；悬停＝`battle.sector.cargoLockedHint`（`装载中：剩余约 {s}s`）。
 * · **只读口径（复用既有派生，未新增引擎接口）**：
 *   · 已入舱 ⇒ `cargoListOf(ship)`（实体清单）；
 *   · 在装 ⇒ `battle.sector.cargos` 中 **`lockedBy === ship.id`** 的项（引擎派生字段；进度/需求时长
 *     亦为派生字段）—— UI **只做筛选与展示，不自算任何锁定/进度规则**。
 * · **有货物才显示**：已入舱或在装**任一存在** ⇒ 显示该栏；两者皆无 ⇒ **整栏隐藏**（唯一规则）。
 * · ★ **排列顺序＝引擎口径（队列式：前出后入）**：先已入舱（`cargoListOf(ship)` 顺序＝**入舱顺序**）、
 *   再在装（星区列表顺序）；每次刷新按该顺序排列 ⇒ 货物被传输/消耗后其余**前移**、新入舱者**排到末尾**
 *   （与星区栏同一手法：UI **只按引擎列表顺序排列、不自算顺序**）。
 *   ★ 排列走 `arrangeChips`：**顺序未变 ⇒ 零 DOM 操作**（每帧无条件 `append` 会在鼠标按下与抬起之间
 *   搬动按钮、可能导致 `click` 落空 —— 这正是“点了没反应”的一大来源，见该函数注释）。
 *   ★ 点击＝**容器级事件委托**（唯一绑定点在本行容器上）⇒ 芯片被移动/复用/重建都**不会丢绑定**。
 * · **可操作性**：返还仍只在 `我方 且 存活 且 对战中` 生效（与「主要攻击目标」栏同一口径；
 *   引擎接口本身保持通用）。 */
function buildShipCargoRow(ship) {
  const label = el('div', { class: 'detail-cargos-label', text: i18n.t('battle.detail.cargos') });
  const chipRow = el('div', { class: 'detail-cargos-chips' });
  const rowEl = el('div', { class: 'detail-cargos hidden' }, [label, chipRow]);
  const byId = new Map(); // cargoId → 芯片项（货物在星区/单位之间搬移，id 恒定 ⇒ 复用同一芯片）
  const operable = () => ship.side === 'ally' && ship.alive && !!battle && battle.phase === 'running';
  // ★ **本行货物芯片的唯一点击绑定点＝容器级事件委托**（`chipRow` 与本行同生命周期、**永不重建**）：
  //   为什么不再逐芯片 `addEventListener`：本行是**每 tick 刷新**的，芯片还会被重排/按需补建
  //   ——逐芯片绑定在“节点被移动或重建”的场景下有**丢绑定**的风险（表现＝点了没反应）；
  //   委托把监听器挂在**恒定容器**上 ⇒ 无论芯片怎么移动/重建，点击都必然到达同一个处理函数。
  //   处理：调引擎**唯一返还接口** `battle.unloadCargo(shipId, cargoId)`（**在装货物不在 `ship.cargos`
  //   中 ⇒ 引擎直接拒绝**，无需 UI 自算“能不能点”）；随后星区栏与本行**同 tick 就地刷新**。
  //   货舱容量/数值都由引擎改，UI 只重绘 ⇒ 幂等：重复点击时第二次引擎已找不到该件（`reason:'cargo'`）⇒ 无副作用。
  chipRow.addEventListener('click', (e) => {
    const node = e.target && typeof e.target.closest === 'function' ? e.target.closest('.cargo-chip') : null;
    if (!node || !chipRow.contains(node)) return;
    if (!operable() || !battle || typeof battle.unloadCargo !== 'function') return;
    const cargoId = node.dataset ? node.dataset.cargoId : '';
    if (!cargoId) return;
    battle.unloadCargo(ship.id, cargoId);
    refreshSectorZone(); // 星区栏即时反映（芯片重新出现、可再次入队）
    refresh();           // 本行即时反映（该芯片隐藏或转为在装态）
  });
  const chipFor = (cargo) => {
    let item = byId.get(cargo.id);
    if (item) {
      // ★ 复用既有芯片：若它已不在本行容器内（容器被清空/节点被移走）⇒ 当场补回
      //   （否则会“有货物、无芯片”——点击自然无反应；这是上一版“只建一次”的隐患，一并堵死）
      if (item.chip.parentNode !== chipRow) chipRow.append(item.chip);
      return item;
    }
    item = buildCargoChip(cargo);
    byId.set(cargo.id, item);
    chipRow.append(item.chip);
    return item;
  };
  const refresh = () => {
    const loaded = cargoListOf(ship); // ① 已入舱（实体清单）
    const sec = battle && battle.sector ? battle.sector : null;
    // ② 在装/锁定中：只读 `battle.sector.cargos` 的**引擎派生** `lockedBy`（UI 不自算锁定规则）
    const loading = (sec && sec.cargos ? sec.cargos : []).filter((c) => c.lockedBy === ship.id);
    const shown = new Set();
    for (const cargo of loaded) {
      shown.add(cargo.id);
      const item = chipFor(cargo);
      item.cargo = cargo; // 直接取实体（同一对象）⇒ 字段变化（loadTicks → 20t）即时反映
      refreshCargoChipText(item);
      item.chip.classList.remove('hidden', 'queued', 'locked'); // 已入舱：队列/装载中语义均不适用
      item.chip.title = operable() ? i18n.t('battle.detail.cargoUnloadHint') : '';
    }
    for (const cargo of loading) {
      if (shown.has(cargo.id)) continue; // 防御：同一件不会既已入舱又在装
      shown.add(cargo.id);
      const item = chipFor(cargo);
      item.cargo = cargo; // 星区只读快照项（含 loadProgressTicks/loadNeedTicks，均为引擎派生）
      refreshCargoChipText(item);
      item.chip.classList.remove('hidden', 'queued');
      item.chip.classList.add('locked'); // ★ 在装/锁定中：与星区栏同一体例（置灰 + 虚线）
      item.chip.title = i18n.t('battle.sector.cargoLockedHint', {
        // 剩余秒数＝formatTickSeconds(需求 − 已推进)（唯一换算，UI 不外写公式）
        s: formatTickSeconds(Math.max(0, (cargo.loadNeedTicks | 0) - (cargo.loadProgressTicks | 0))),
      });
    }
    for (const [id, item] of byId) if (!shown.has(id)) item.chip.classList.add('hidden');
    // ★ **排列顺序＝引擎口径**（队列式：前出后入）：先**已入舱**（`cargoListOf(ship)` 顺序＝入舱顺序）、
    //   再**在装/锁定中**（`battle.sector.cargos` 列表顺序）；货物被传输/消耗而离开后其余芯片**前移**，
    //   新入舱者**排到末尾**（UI 不自算顺序）。★ 走 `arrangeChips`：**顺序未变 ⇒ 零 DOM 操作**
    //   （每帧无条件 `append` 会在鼠标按下与抬起之间搬动按钮、可能导致 click 落空 —— 见该函数注释）。
    const ordered = [];
    for (const cargo of loaded) { const it = byId.get(cargo.id); if (it) ordered.push(it.chip); }
    for (const cargo of loading) { const it = byId.get(cargo.id); if (it) ordered.push(it.chip); }
    arrangeChips(chipRow, ordered);
    rowEl.classList.toggle('hidden', shown.size === 0); // 两者皆无 ⇒ 整栏隐藏
  };
  refresh();
  return { el: rowEl, refresh };
}

function buildDetail(ship) {
  const tagKey = ship.side === 'ally' ? 'battle.side.ally' : 'battle.side.enemy';
  const type = SHIPS[ship.typeId];
  const modRows = moduleRows(ship);

  const head = el('div', { class: 'detail-head' }, [
    unitIcon(ship),
    el('div', { class: 'detail-head-text' }, [
      el('div', { class: 'detail-name', text: `${baseName(ship)} · ${i18n.t(tagKey)}` }),
      el('div', { class: 'detail-type', text: i18n.t('battle.detail.slots', { n: ship.slots ?? type.slots }) }),
    ]),
  ]);

  const stats = {
    hp: el('span', { class: 'detail-stat-value' }),
    shield: el('span', { class: 'detail-stat-value' }),
    energy: el('span', { class: 'detail-stat-value' }),
  };
  const statLine = el('div', { class: 'detail-stats' }, [
    el('div', { class: 'stat-cell' }, [el('span', { class: 'stat-name hp', text: i18n.t('battle.hp') }), stats.hp]),
    el('div', { class: 'stat-cell' }, [el('span', { class: 'stat-name shield', text: i18n.t('battle.shield') }), stats.shield]),
    el('div', { class: 'stat-cell' }, [el('span', { class: 'stat-name energy', text: i18n.t('battle.energy') }), stats.energy]),
  ]);

  const lifeNote = el('div', { class: 'detail-timer', text: '' }); // 临时单位存活剩余（非临时隐藏）

  // ★ 货舱容量条（货物 / 矿物）：与单位卡**同一套条形体例**（同一个 `bar()` 组件 + `.bar` 结构），
  //   名称/当前值/上限，颜色区分货物与矿物；取值＝引擎唯一口径 `cargoCapPartsOf`/`oreCapPartsOf`。
  //   **容量为 0 → 整条隐藏**；两条皆为 0 → 整个区块隐藏（唯一规则）。
  //   条上 `title` 显示**本体 / 模块分解值**（只放数值，来自引擎分解，不在 UI 重算）。
  const dCargo = bar(i18n.t('battle.cargo'), 'var(--cargo)');
  const dOre = bar(i18n.t('battle.ore'), 'var(--ore)');
  const cargoBlock = el('div', { class: 'detail-cargo' }, [dCargo.el, dOre.el]);

  // ★ 单位系数栏：置于“模块字段”之前（**可折叠、默认折叠**：类别系数 / 受伤减免 / 时间系数 / 其它系数）
  const coeffSec = buildCoeffSection(ship);
  // ★ 「装载货物」栏：**单位系数区块下方单独一行**（有货物才显示；点芯片＝返还星区）
  const cargoRow = buildShipCargoRow(ship);

  const modsTitle = el('div', { class: 'detail-subtitle', text: i18n.t('battle.detail.modules') });
  // 长期(本体)护盾池显示在所有模块详情信息的最前面
  const longPoolBlock = longShieldBlock();
  const modsList = el('div', { class: 'detail-mods' }, [
    longPoolBlock.el,
    ...modRows.map((r) => r.block),
  ]);

  const targetLabel = el('div', { class: 'detail-subtitle', text: i18n.t('battle.detail.target') });
  const targetBar = el('div', { class: 'detail-target' });
  const targetHint = el('div', { class: 'detail-target-cur', text: '' });

  const topRow = el('div', { class: 'detail-top' }, [head, statLine, cargoBlock, lifeNote]);
  const panelEl = el('div', { class: 'detail-inner' }, [
    topRow,
    coeffSec.titleEl,
    coeffSec.bodyEl,
    cargoRow.el,
    modsTitle,
    modsList,
    targetLabel,
    targetBar,
    targetHint,
  ]);

  detailEl.classList.remove('hidden');
  detailEl.replaceChildren(panelEl);

  const refreshStats = () => {
    stats.hp.textContent = `${Math.ceil(ship.hull.hp)} / ${ship.hull.hpMax}`;
    stats.shield.textContent = `${Math.ceil(ship.hull.shield)} / ${ship.hull.shieldCap}（+${shipHullRegenText(ship, 'shield')}/s）`;
    stats.energy.textContent = `${Math.floor(ship.hull.energy)} / ${ship.hull.energyCap}（+${ship.energyRegenPerSec}/s）`;
    // ★ 货舱容量条（货物 / 矿物）：容量为 0 → 整条隐藏；两条皆 0 → 区块隐藏（唯一规则，与单位卡/指挥栏一致）
    const cp = cargoCapPartsOf(ship);
    const op = oreCapPartsOf(ship);
    cargoBlock.classList.toggle('hidden', cp.total <= 0 && op.total <= 0);
    dCargo.el.classList.toggle('hidden', cp.total <= 0);
    dOre.el.classList.toggle('hidden', op.total <= 0);
    if (cp.total > 0) {
      dCargo.update(cargoLoadOf(ship), cp.total);
      dCargo.el.title = i18n.t('battle.cargo.breakdown', { base: cp.base, modules: cp.modules });
    }
    if (op.total > 0) {
      dOre.update(oreLoadOf(ship), op.total);
      dOre.el.title = i18n.t('battle.cargo.breakdown', { base: op.base, modules: op.modules });
    }
    coeffSec.refresh(); // 单位系数栏：每 tick 按引擎函数重算（运行期修饰即时反映）
    cargoRow.refresh(); // 「装载货物」栏：每 tick 只读 `cargoListOf(ship)`（无货物 ⇒ 整行隐藏）
    if (ship.temp && ship.alive && typeof ship.tempLeft === 'number') {
      lifeNote.style.display = '';
      lifeNote.textContent = i18n.t('battle.lifeLeft', { n: Math.max(0, Math.ceil(ship.tempLeft / SEC_TICKS)) });
    } else {
      lifeNote.style.display = 'none';
    }
    for (const r of modRows) {
      if (r.statusEl) r.statusEl.textContent = modStatusText(ship, r.inst);
      if (r.toggleEl) {
        // ★「不可停用」：开关灰显 + 说明（与创建时同一引擎判据；状态恒定，不会因数值变化而变）
        const locked = stateModuleUndeactivatable(r.inst);
        r.toggleEl.textContent = r.inst.enabled
          ? i18n.t('battle.detail.disable')
          : i18n.t('battle.detail.enable');
        r.toggleEl.disabled = locked;
        r.toggleEl.classList.toggle('locked', locked);
        r.toggleEl.title = locked ? i18n.t('battle.detail.undeactivatable') : '';
      }
      if (r.chipEl) {
        r.chipEl.classList.toggle('off', r.inst.enabled === false);
        // 状态型模块：生效 → 发光；未满足 → 不加就绪脉动（同一判据，见 modStatusText）
        const stState = stateModuleState(r.inst);
        if (stState !== null) {
          r.chipEl.classList.toggle('active', stState);
          r.chipEl.classList.remove('cooling', 'ready');
        } else if (stateModuleGate(r.inst) === false) {
          // ★ 门控型模块（如 `hp_below_activate`）：条件未满足 → 不加“就绪”脉动（同一引擎判据）
          r.chipEl.classList.remove('ready');
        }
      }
      if (r.contribEl) r.contribEl.textContent = contribText(ship, r.inst);
      // 模块自身独立护盾池条：仅时长型护盾模块显示（激活/破盾后都不隐藏，避免跳动）；
      // 破盾后池已删，value 取 0、cap 仍按模块 cfg×系数给出（保持条幅不跳）。
      if (r.poolMini) {
        const fx = r.inst.cfg.effects || {};
        const isDurShield = Number(fx.shield_cap_bonus || 0) > 0 && Number(fx.duration_ticks || 0) > 0;
        if (isDurShield) {
          const cap = modulePoolCapOf(ship, r.inst);
          const pool = ship.hull.pools ? ship.hull.pools.get(r.inst.id) : null;
          const value = pool ? pool.value : 0;
          const mt = nextBarTint('mod:' + ship.id + ':' + r.inst.id, value, shieldTint(ship));
          setMiniPool(r.poolMini, value, cap, mt);
        } else {
          setMiniPool(r.poolMini, 0, 0); // 非独立池模块（武器/常驻并入长期池）隐藏该条
        }
      }
      // 统一彩色目标按钮重绘（目标存活列表/选中变化时）
      if (r.targetPickEl) {
        const cand = candList(ship, r.inst.cfg.target);
        const isSingle = (r.inst.cfg.target || {}).countMode !== 'multi';
        const selPart = isSingle
          ? r.inst.target && r.inst.target.mode === 'unit'
            ? r.inst.target.id
            : ''
          : r.inst.target && r.inst.target.mode === 'units'
            ? (r.inst.target.ids || []).join('|')
            : '';
        const curSig = cand.map((u) => u.id).join('|') + '::' + selPart;
        if (curSig !== r.targetSig) {
          r.targetSig = curSig;
          renderTargetPicks(
            r.targetPickEl,
            ship,
            r.inst,
            cand,
            isSingle,
            Math.max(1, (r.inst.cfg.target || {}).maxCount || 2)
          );
        }
      }
      // 实时命中目标行（与选择器同一套着色：友方蓝 / 敌方红）
      if (r.targetCurEl && battle && !rowSelfOnly(r.inst)) {
        const list = battle.moduleTargetList(ship, r.inst);
        // ★ 激活锁定（`lock_target_on_activate`）：引擎判据（UI 不自算）
        const locked =
          typeof battle.moduleTargetLocked === 'function' && battle.moduleTargetLocked(r.inst);
        const manual =
          r.inst.target && (r.inst.target.mode === 'unit' || r.inst.target.mode === 'units');
        // 锁定提示：本次持续期不切换目标；有手动选择时额外说明“下次激活生效”
        if (r.lockNoteEl) {
          r.lockNoteEl.textContent = locked
            ? manual
              ? i18n.t('battle.detail.targetLockPending')
              : i18n.t('battle.detail.lockNote')
            : '';
        }
        const nodes = [];
        if (list.length) {
          nodes.push(document.createTextNode(i18n.t('battle.detail.targetCurPrefix')));
          if (locked) {
            // 锁定中：先把“已锁定”说清，再列出锁定的目标名
            nodes.push(el('span', { class: 'target-lock', text: i18n.t('battle.detail.lockTag') }));
            nodes.push(document.createTextNode(' '));
          } else if (manual) {
            nodes.push(
              el('span', { class: 'target-manual', text: i18n.t('battle.detail.manualTag') })
            );
            nodes.push(document.createTextNode(' '));
          }
          list.forEach((u, ix) => {
            if (ix) nodes.push(document.createTextNode('、'));
            nodes.push(unitNameSpan(u));
          });
        } else {
          nodes.push(
            document.createTextNode(
              locked ? i18n.t('battle.detail.targetLockedGone') : i18n.t('battle.detail.curNone')
            )
          );
        }
        r.targetCurEl.replaceChildren(...nodes);
      }
    }
    // 长期(本体)护盾池：始终显示（常驻再生并入其中；值可为 0 也不隐藏避免跳动）
    const basePool = ship.hull.pools ? ship.hull.pools.get('base') : null;
    const longValue = basePool ? basePool.value : 0;
    const longCap = basePool ? basePool.cap : 0;
    const longTint = nextBarTint('long:' + ship.id, longValue, shieldTint(ship));
    setMiniPool(longPoolBlock.pool, longValue, longCap, longTint);
    targetHint.textContent = targetHintText(ship);
  };

  const renderTargetBar = () => {
    targetBar.replaceChildren();
    const operable = ship.side === 'ally' && ship.alive && battle && battle.phase === 'running';
    if (!operable) {
      const note =
        !ship.alive
          ? i18n.t('battle.detail.noControl')
          : ship.side !== 'ally'
            ? i18n.t('battle.detail.noControl')
            : i18n.t('battle.detail.ended');
      targetBar.append(el('span', { class: 'target-note', text: note }));
      return;
    }
    // 锁定单位（一次性火箭）：目标召唤时固定、不可改 → 只读提示，不显示自动策略/手动选择
    if (ship.lockTargetId) {
      const b = foesOf(ship).find((f) => f.id === ship.lockTargetId);
      targetBar.append(
        el('span', {
          class: 'target-note target-locked',
          text: i18n.t('battle.detail.targetLocked', {
            name: b && b.alive ? baseName(b) : i18n.t('battle.detail.lockGone'),
          }),
        })
      );
      return;
    }
    // ★ 船级“主要攻击目标”候选：潜行单位 + （目标方仍有可选战斗单位时的）其后勤单位
    //   **不可被选为主要攻击目标** → 不进入按钮列表
    //   （判据取自引擎 `battle.targetableBy(ship, u, 'enemy')`，唯一口径；与模块手动目标列表同一规则）
    const foes = foesOf(ship).filter(
      (f) => f.alive && (typeof battle.targetableBy !== 'function' || battle.targetableBy(ship, f, 'enemy'))
    );
    // 该舰自动策略：''=跟随全队，否则为该舰独立策略（覆盖全队）
    const policySel = el(
      'select',
      { class: 'target-policy', 'aria-label': i18n.t('battle.detail.autoPolicy') },
      [
        el('option', { value: '', text: i18n.t('battle.detail.followFleet') }),
        ...TARGET_POLICIES.map((p) =>
          el('option', { value: p, text: i18n.t(`battle.policy.${p}`) })
        ),
      ]
    );
    policySel.value = ship.policy || '';
    policySel.addEventListener('change', () => {
      if (battle && battle.setShipPolicy) battle.setShipPolicy(ship, policySel.value || null);
      refreshStats();
      updateCards?.();
    });
    targetBar.append(
      el('div', { class: 'target-policy-row' }, [
        el('span', { class: 'target-policy-label', text: i18n.t('battle.detail.autoPolicy') }),
        policySel,
      ])
    );
    const autoBtn = el('button', {
      class: `btn small ${!ship.targetId ? 'active' : ''}`,
      text: i18n.t('battle.detail.auto'),
      onclick: () => setTarget(ship, null),
    });
    targetBar.append(autoBtn);
    foes.forEach((f, idx) => {
      targetBar.append(
        el('button', {
          class: `btn small target-btn enemy-tag ${ship.targetId === f.id ? 'active' : ''}`,
          text: `${idx + 1}. ${baseName(f)}`,
          title: baseName(f),
          onclick: () => setTarget(ship, f.id),
        })
      );
    });
    if (!foes.length) targetBar.append(el('span', { class: 'target-note', text: i18n.t('battle.detail.noTargets') }));
  };

  function targetHintText(s) {
    const cur = currentTargetOf(s); // 与战斗核心同一套目标链：船级指定 → 阵营策略
    if (s.lockTargetId) {
      const b = (s.side === 'ally' ? battle?.enemies : battle?.allies)?.find(
        (f) => f.id === s.lockTargetId
      );
      const name = b && b.alive ? baseName(b) : i18n.t('battle.detail.lockGone');
      return i18n.t('battle.detail.targetLocked', { name });
    }
    // 被强制攻击（`force_target_self` 来源栈）：目标链被外部夺走，提示里明确说明（不改写 targetId）
    if (s.forcedTargetId) {
      const f = (s.side === 'ally' ? battle?.enemies : battle?.allies)?.find(
        (x) => x.id === s.forcedTargetId && x.alive
      );
      if (f) return i18n.t('battle.detail.targetForced', { name: baseName(f) });
    }
    if (s.side === 'ally') {
      if (s.targetId) {
        return cur
          ? i18n.t('battle.detail.locked', { name: baseName(cur) })
          : i18n.t('battle.detail.noTargets');
      }
      const policy = s.policy || (battle ? battle.allyPolicy : 'order');
      const key = s.policy ? 'battle.detail.autoOwn' : 'battle.detail.following';
      return cur
        ? i18n.t(key, {
            policy: i18n.t(`battle.policy.${policy}`),
            name: baseName(cur),
          })
        : i18n.t('battle.detail.noTargets');
    }
    return cur
      ? i18n.t('battle.detail.targetIs', { name: baseName(cur) })
      : i18n.t('battle.detail.noTargets');
  }

  function shipHullRegenText(s, which) {
    let rate = 0;
    for (const inst of s.modules) {
      const fx = inst.cfg.effects;
      // 启用的回复类模块按"每次激活量 × 每秒激活次数"折算每秒速率
      if (which === 'shield' && isShieldRestore(fx) && inst.enabled) {
        rate += (fx.shield_gain || 0) * (SEC_TICKS / (fx.cooldown_ticks ?? 1));
      }
    }
    return String(Math.round(rate));
  }

  function setTarget(s, enemyId) {
    s.targetId = enemyId;
    if (enemyId) {
      const foe = foesOf(s).find((f) => f.id === enemyId);
      uiLog(
        'battle.log.retarget',
        { ship: shipTok(s, unitDisplayName(s)), target: shipTok(foe, baseName(foe)) },
        ['ship', 'target']
      );
    } else {
      uiLog('battle.log.autoTarget', { ship: shipTok(s, unitDisplayName(s)) }, ['ship']);
    }
    renderTargetBar();
    refreshStats();
  }

  function unitDisplayName(s) {
    const key = s.side === 'ally' ? 'battle.unit.ally' : 'battle.unit.enemy';
    return i18n.t(key, { type: baseName(s) });
  }

  detail = { ship, refreshStats, renderTargetBar };
  renderTargetBar();
  refreshStats();
}

/** 每 tick 刷新详情数值/模块状态/当前目标 */
function refreshDetail() {
  if (!detail || !detail.ship) return;
  const s = findUnit(detail.ship.id);
  if (!s) { showEmptyDetail(); return; }
  if (detail.ship !== s) return; // 理论不会发生
  detail.refreshStats();
}

/* ================= 流程控制（唯一开战入口 / 离开 / 返回） =================
 * ★ 编队配置界面（双方编队编辑、单位类型/等级/定位、模块装配、开战前预检）已整体迁至
 *   `ui/setupView.js`；本文件通过 `setupView.render(stageArea, { onStart, onExit })` 挂载它，
 *   并以 `onStart = enterBattle` 把它接到唯一开战入口上（回调注入，无模块循环依赖）。 */


/** ★★ 唯一的「进入战斗」入口（UI 侧）——所有开战路径都必须走它 ★★
 *  演练编队界面「开战」、结算面板「再战」、将来的关卡/剧情入口…全部经此函数；不留第二条开战路径。
 *  内部调用 `systems/battle.js startBattle()`（引擎侧唯一开战接口：编队规范化/等级钳制/模块与槽位校验 +
 *  建单位），再初始化战斗屏 UI 与运行态。
 *  @param {{allies:[], enemies:[]}} formation 编队（结构见 `ui/setupView.js` 文件头；也接受 {ally,enemy}）
 *  @returns {{ok:boolean, error:null|'noUnits', battle:object|null, formation:{allies,enemies}, warnings:[]}}
 *           `ok:false` 时**不创建战斗、不改动界面**，由调用方按 `error`/`warnings` 处理。
 *  示例：enterBattle({ allies:[{type:'combat',level:5,modules:[{moduleId:'cannon',level:3}]}],
 *                       enemies:[{type:'transport'}] }) */
export function enterBattle(formation) {
  const entry = startBattle(formation || {});
  if (!entry.ok) return entry; // 校验不通过：保持当前界面不变（不做任何 UI 变更）
  if (battle && battle !== entry.battle) battle.stop(); // 同屏重开/再战：先停旧战斗
  lastFormation = entry.formation; // 规范化后的编队快照，供结算「再战」原样重开
  battle = entry.battle;
  window.__battle = battle;
  // 旧战斗的 UI 运行态清理（新舞台渲染时会被整体替换，这里清引用即可）
  selectedId = null;
  detail = null;
  updateCards = null;
  barTints.clear(); // 变色状态机以单位 id 为键，新战斗必为新 id → 清空避免跨局累积
  overlay?.overlay.classList.add('hidden');
  battle.start(); // 引擎进入 running
  ticker.pause(); // 开战即暂停：让玩家先手动调整目标/启停再开始（既有交互）

  if (router.current === 'battle' && stageArea) {
    renderRunning(); // 已在战斗屏：就地重绘战斗舞台
  } else {
    router.show('battle'); // 未在战斗屏：切屏（root() 按 battle 状态渲染战斗舞台）
  }
  return entry;
}

/** 「离开」：结束当前战斗并回到**编队/演练配置界面**（同一屏内的配置面板）。
 *  ★ 清理清单（保证可反复进出、无残留）：
 *    1) `battle.stop()`：停掉该战斗的 tick 订阅与 running 广播；
 *    2) 清空全部战斗运行态引用：battle / window.__battle / 选中单位 / 详情面板 / 卡片刷新闭包 /
 *       四个分区引用 / 战报挂载点；
 *    3) 关闭结算浮层；
 *    4) 恢复 tick 全局态：速度归 x1、解除“开战自动暂停”（避免遗留全局暂停）；
 *    5) 清空护盾条变色状态机（barTints）；
 *    6) 重新挂载编队配置屏（回调仍指向唯一入口 enterBattle）。
 *  · 编队编辑态**保留在 `setupView` 内**（便于微调后再战）；需要重置调用 `setupView.reset()`。 */
export function leaveBattle() {
  if (battle) {
    battle.stop();
    battle = null;
    window.__battle = null;
  }
  selectedId = null;
  detail = null;
  updateCards = null;
  enemyZone = null;
  enemyLogZone = null;
  allyZone = null;
  allyLogZone = null;
  allZones = [];
  logPanelEl = null;
  sectorZ = null; // 星区资源栏引用随舞台一并失效（下次开战重建）
  barTints.clear();
  overlay?.overlay.classList.add('hidden');
  ticker.setSpeed(1);
  ticker.resume();
  if (stageArea) mountSetup(); // 回编队配置界面
  refreshStatus();
}

/** 挂载编队配置屏（`ui/setupView.js`）：开战回调＝唯一入口 enterBattle，返回回调＝exitToMenu */
function mountSetup() {
  setupView.render(stageArea, { onStart: enterBattle, onExit: exitToMenu });
}

function exitToMenu() {
  if (battle) {
    battle.stop();
    battle = null;
    window.__battle = null;
  }
  detail = null;
  updateCards = null;
  logPanelEl = null;
  sectorZ = null;
  allZones = [];
  barTints.clear();
  setupView.detach(); // 卸载配置屏宿主：离屏后不再重绘
  ticker.setSpeed(1);
  ticker.resume();
  router.show('menu');
}

/* ================= 根节点 ================= */

function root() {
  titleEl = el('div', { class: 'battle-title', text: i18n.t('battle.title') });
  statusEl = el('div', { class: 'battle-status', text: '' });
  // 「离开」：仅在对局中/已结算时出现（配置界面无战斗可离开）→ 回编队/演练配置界面
  leaveBtn = el('button', {
    class: 'btn tiny ghost battle-leave',
    text: i18n.t('battle.leave'),
    title: i18n.t('battle.leave.title'),
    onclick: leaveBattle,
  });
  stageHeadEl = el('div', { class: 'battle-head' }, [titleEl, statusEl, leaveBtn]);
  const rootEl = el('section', { class: 'screen screen-battle' }, [stageHeadEl]);
  stageArea = el('div');
  rootEl.append(stageArea);
  overlay = overlayEl();
  rootEl.append(overlay.overlay);

  bindGlobalListeners();
  refreshStatus();

  if (battle && battle.phase !== 'idle') {
    renderRunning();
  } else {
    mountSetup(); // 编队配置屏（原 renderLaunch，已拆分到 ui/setupView.js）
  }
  return rootEl;
}

/** 战斗状态行：阶段 + 双方存活数（并同步「离开」按钮显隐：有战斗才显示） */
function refreshStatus() {
  if (leaveBtn) leaveBtn.classList.toggle('hidden', !battle);
  // ★ 战斗场景以星区命名：标题追加星区名称（唯一来源＝引擎只读口径 `battle.sector.name`）。
  //   名称为**用户自定义字符串**：**原样显示、不做 i18n**；无名称（空串）时只显示基础标题，不加前缀。
  if (titleEl) {
    const secName = battle && battle.sector && battle.sector.name ? battle.sector.name : '';
    titleEl.textContent = secName ? `${i18n.t('battle.title')} · ${secName}` : i18n.t('battle.title');
  }
  if (!statusEl) return;
  if (!battle) {
    statusEl.textContent = i18n.t('battle.status', {
      phase: i18n.t('battle.phase.idle'),
      ally: 0,
      enemy: 0,
    });
    return;
  }
  const ally = battle.allies.filter((a) => a.alive).length;
  const enemy = battle.enemies.filter((e) => e.alive).length;
  const phaseKey =
    battle.phase === 'running'
      ? 'battle.phase.running'
      : battle.phase === 'settled'
        ? 'battle.phase.settled'
        : 'battle.phase.idle';
  statusEl.textContent = i18n.t('battle.status', {
    phase: i18n.t(phaseKey),
    ally,
    enemy,
  });
}

function renderRunning() {
  const built = buildStage();
  stageArea.replaceChildren(built.stage);
  enemyZone = built.enemyZ;
  enemyLogZone = built.enemyLogZ;
  allyZone = built.combatZ;
  allyLogZone = built.logisticsZ;
  logPanelEl = built.logLines;
  rebuildUnits();
  overlay.overlay.classList.add('hidden');
  if (selectedId && findUnit(selectedId)) buildDetail(findUnit(selectedId));
  refreshStatus();
  if (battle.phase === 'settled' && battle.result) {
    overlay.show(battle.result);
  }
}

function overlayEl() {
  const resultTitle = el('h2', { class: 'result-title' });
  const resultDesc = el('p', { class: 'result-desc' });
  // ★ 结算面板同样按星区命名：显示星区名称（引擎口径 `battle.sector.name`，原样、不做 i18n；无名称则隐藏）
  const resultSector = el('p', { class: 'result-sector hidden' });
  const actions = el('div', { class: 'settle-actions' }, [
    el('button', {
      class: 'btn primary small',
      text: i18n.t('battle.restart'),
      onclick: () => {
        // 「再战」＝用最近一次成功开战的编队快照重开 → 同样走**唯一开战入口**（不留旁路）
        if (lastFormation) enterBattle(lastFormation);
      },
    }),
    el('button', { class: 'btn small', text: i18n.t('battle.leave'), onclick: leaveBattle }),
    el('button', { class: 'btn small', text: i18n.t('battle.menu.back'), onclick: exitToMenu }),
    el('button', {
      class: 'btn small ghost',
      text: i18n.t('battle.result.close'),
      onclick: () => overlayDiv.classList.add('hidden'),
    }),
  ]);
  const overlayDiv = el('div', { class: 'battle-overlay hidden' }, [
    el('div', { class: 'settle-panel' }, [
      el('div', { class: 'settle-line' }, [resultTitle, resultDesc]),
      resultSector,
      actions,
    ]),
  ]);

  /** 结算浮层：'win' | 'lose' | 'draw' 三态（**平局＝双方全灭**，与引擎 `checkEnd()` 的
   *  `!anyAlly && !anyEnemy → settle('draw')` **同一口径**：任何 tick 收尾发现双方均无存活单位即判和，
   *  亦涵盖“同 tick 互毁”。UI 只读 `battle.result`，不自算胜负判据。 */
  function show(result) {
    const kind = result === 'win' ? 'win' : result === 'draw' ? 'draw' : 'lose';
    resultTitle.textContent = i18n.t(`battle.result.${kind}.title`);
    resultTitle.className = `result-title ${kind}`;
    resultDesc.textContent = i18n.t(`battle.result.${kind}.desc`);
    const secName = battle && battle.sector && battle.sector.name ? battle.sector.name : '';
    resultSector.textContent = secName ? i18n.t('battle.sector.line', { name: secName }) : '';
    resultSector.classList.toggle('hidden', !secName);
    overlayDiv.classList.remove('hidden');
  }
  return { overlay: overlayDiv, show };
}

/* ================= 全局监听（只绑定一次） ================= */

function bindGlobalListeners() {
  if (listenersBound) return;
  listenersBound = true;

  bus.on('tick', () => {
    // ★ **延后一拍（微任务）再刷新**：引擎与本 UI 都订阅 `tick`，而两者的**注册先后**决定了同步回调
    //   的执行顺序（首局：引擎先注册 ⇒ UI 在结算之后；重开局：UI 先注册 ⇒ 会读到**上一 tick** 的状态）。
    //   微任务在**本帧全部同步回调跑完之后、渲染之前**执行 ⇒ 无论注册顺序如何，UI 读到的都是
    //   **本 tick 引擎结算之后**的状态（含「装载完成 ⇒ 货物离开星区栏」这类本 tick 落地结果），
    //   且仍在同一帧内完成、无可见延迟。
    queueMicrotask(() => {
      if (!battle) return;
      refreshStatus();
      refreshCommand();
      if (battle.phase !== 'running') return;
      if (updateCards) updateCards();
      refreshDetail();
    });
  });

  bus.on('battle:settled', ({ result }) => {
    overlay?.show(result);
    refreshStatus();
    refreshCommand();
    ticker.setSpeed(1); // 每场战斗结束后速度重置为 x1
    if (updateCards) updateCards();
    // 结算后重建详情面板：隐藏模块启停/齿轮/目标操作（浏览仍可用）
    if (selectedId && findUnit(selectedId)) buildDetail(findUnit(selectedId));
  });

  bus.on('log', (line) => {
    if (!logPanelEl || !battle || battle.phase === 'idle') return;
    if (line.kind !== 'battle') return;
    const entry = el('div', {
      class: `log-line${line.msg.includes('击毁') || line.msg.includes('destroyed') ? ' destroy' : ''}`,
    });
    if (Array.isArray(line.rich) && line.rich.length) {
      // 分段渲染：敌方单位名红 / 我方单位名蓝 / 模块名绿
      for (const seg of line.rich) {
        if (seg && typeof seg === 'object' && seg.mod) {
          entry.appendChild(el('span', { class: 'log-module-name', text: seg.label }));
        } else if (seg && typeof seg === 'object' && seg.side) {
          entry.appendChild(
            el('span', {
              class: `log-unit-name ${seg.side === 'ally' ? 'side-ally' : 'side-enemy'}`,
              text: seg.label,
            })
          );
        } else if (seg && typeof seg === 'object' && typeof seg.label === 'string') {
          entry.appendChild(document.createTextNode(seg.label));
        } else {
          entry.appendChild(document.createTextNode(typeof seg === 'string' ? seg : ''));
        }
      }
    } else {
      entry.textContent = line.msg;
    }
    logPanelEl.prepend(entry);
    while (logPanelEl.children.length > 40) logPanelEl.lastChild.remove();
  });

  bus.on('route', ({ name }) => {
    if (name !== 'battle' && battle && battle.phase === 'running') {
      battle.stop();
      ticker.setSpeed(1); // 中途离开战斗屏同样重置速度
      ticker.resume(); // 解除开战自动暂停，避免遗留全局暂停态
      battle = null;
      window.__battle = null;
      // 离屏清理：清空运行态引用与变色状态机（下次进屏由 root() 重建，可反复进出无残留）
      selectedId = null;
      detail = null;
      updateCards = null;
      logPanelEl = null;
      allZones = [];
      barTints.clear();
      setupView.detach();
    }
  });
}

export const battleView = {
  root,
  enterBattle, // ★ 唯一「进入战斗」入口（UI 侧）：演练开战 / 结算再战 / 将来关卡入口统一走它
  leaveBattle, // 「离开」：结束战斗并回编队配置界面（含完整清理）
};

export default battleView;
