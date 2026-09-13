/* ===== ui/battleView.js —— 战斗屏（对战 Demo + 视觉/交互增强） =====
 * 布局（自上而下）：标题行(含「离开」) → 敌方后勤 → 敌方战斗 → 分隔线 → 我方战斗 → 我方后勤
 *                  → 指挥栏 → 单位详情面板（点击单位后出现，可指定主目标）→ 战报
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
import { el } from '../core/utils.js';
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
} from '../entities/ship.js';
import { bar } from './widgets.js';
import { router } from './router.js';
import { setupView } from './setupView.js'; // ★ 演练编队配置屏（单一职责；本文件只挂载它并接收回调）
import { log, formatRich } from '../core/log.js';
import { ticker } from '../core/tick.js';

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
/** 模块"脸"节点：有 SVG 图标(cfg.icon)用 <img>，否则降级显示名称首字 */
function moduleGlyphEl(cfg) {
  const name = moduleName(cfg.id);
  if (cfg.icon) {
    const img = el('img', { class: 'module-icon-img', src: cfg.icon, alt: '' });
    img.draggable = false;
    return img;
  }
  return el('span', { text: name ? Array.from(name)[0] : '?' });
}
/* 注：船型名称/槽位/编队渲染等**编队配置界面专用**的工具函数已随界面一并移入 `ui/setupView.js`（不在此重复实现）。 */

let battle = null;
let selectedId = null;
let listenersBound = false;

/* 模块级 DOM 引用 */
let stageArea = null;
let stageHeadEl = null;        // 战斗标题行（标题 + 状态 + 「离开」按钮）
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

/** 刷新指挥栏：策略下拉值与当前命中目标预览；非对战中禁用 */
function refreshCommand() {
  if (!cmdSel || !cmdPreview) return;
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

  const stage = el('div', { class: 'battle-stage' }, [
    enemyLogZ.zone,
    enemyZ.zone,
    el('div', { class: 'battle-sep' }),
    combatZ.zone,
    logisticsZ.zone,
    cmdZ.zone,
    detailEl,
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
  if (kinds.includes('self')) out.push({ u: ship, kind: 'self' });
  if (kinds.includes('enemy')) for (const u of foes) out.push({ u, kind: 'enemy' });
  if (kinds.includes('ally')) for (const u of same) if (u.id !== ship.id) out.push({ u, kind: 'ally' });
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
  if ((fx.shield_coeff_add || 0) !== 0) {
    // 类别系数**加性**词条（自身）：与 `attack_coeff_add` 同体例——**不经类别系数缩放**（它本身就是系数项）
    parts.push(i18n.t('battle.detail.statShieldCoeff', { v: fmtSignedNum(fx.shield_coeff_add) }));
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
    const costText = isStateModuleFx(fx)
      ? i18n.t('battle.detail.stateCost') // 状态型：无激活周期（不显示“能量/冷却 每 Nt”这种误导信息）
      : dur > 0
        ? i18n.t('battle.detail.costCycleDur', {
            n: fx.energy_cost || 0,
            d: dur,
            cd: fx.cooldown_ticks ?? 1,
          })
        : i18n.t('battle.detail.costCycle', {
            n: fx.energy_cost || 0,
            cd: fx.cooldown_ticks ?? 1,
          });
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
      toggleEl = el('button', {
        class: 'btn tiny',
        text: '',
        onclick: () => {
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

function modStatusText(ship, inst) {
  if (inst.enabled === false) return i18n.t('battle.detail.disabled');
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
    if (ship.temp && ship.alive && typeof ship.tempLeft === 'number') {
      lifeNote.style.display = '';
      lifeNote.textContent = i18n.t('battle.lifeLeft', { n: Math.max(0, Math.ceil(ship.tempLeft / SEC_TICKS)) });
    } else {
      lifeNote.style.display = 'none';
    }
    for (const r of modRows) {
      if (r.statusEl) r.statusEl.textContent = modStatusText(ship, r.inst);
      if (r.toggleEl) {
        r.toggleEl.textContent = r.inst.enabled
          ? i18n.t('battle.detail.disable')
          : i18n.t('battle.detail.enable');
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
  allZones = [];
  barTints.clear();
  setupView.detach(); // 卸载配置屏宿主：离屏后不再重绘
  ticker.setSpeed(1);
  ticker.resume();
  router.show('menu');
}

/* ================= 根节点 ================= */

function root() {
  const titleEl = el('div', { class: 'battle-title', text: i18n.t('battle.title') });
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
    overlayDiv.classList.remove('hidden');
  }
  return { overlay: overlayDiv, show };
}

/* ================= 全局监听（只绑定一次） ================= */

function bindGlobalListeners() {
  if (listenersBound) return;
  listenersBound = true;

  bus.on('tick', () => {
    if (!battle) return;
    refreshStatus();
    refreshCommand();
    if (battle.phase !== 'running') return;
    if (updateCards) updateCards();
    refreshDetail();
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
