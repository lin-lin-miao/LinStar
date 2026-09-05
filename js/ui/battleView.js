/* ===== ui/battleView.js —— 战斗屏（M1 对战 Demo + 视觉/交互增强） =====
 * 布局（自上而下）：敌方单位 → 分隔线 → 我方战斗单位 → 后勤(占位) → 技能(占位)
 *                  → 单位详情面板（点击单位后出现，可指定主目标）→ 战报
 * 单位实体卡（矩形，从上到下）：单位图标(SVG) → 状态条(HP/护盾/能量) → 简约模块图标
 * 实时信息：模块冷却倒计时徽标 / 就绪脉冲；"下一步"行动提示（敌方将做什么一望可知）
 * 流程：选择演练 -> 开战(combat:state true) -> 实时结算 -> 结算浮层(自动存档)
 * 调试：window.__battle 暴露当前战斗对象
 */
import { el } from '../core/utils.js';
import { bus } from '../core/eventBus.js';
import { i18n } from '../i18n/index.js';
import { SHIPS } from '../data/ships.js';
import { MODULES } from '../data/modules.js';
import { createBattle, TARGET_POLICIES } from '../systems/battle.js';
import { moduleMaxLevel } from '../entities/module.js';
import { bar } from './widgets.js';
import { router } from './router.js';
import { log } from '../core/log.js';
import { ticker } from '../core/tick.js';

const SEC_TICKS = 20; // 1 秒 = 20 tick（与战斗核心一致，用于按 tick 折算每秒消耗）

/* —— 演练配置（沙盘）：双方均可增删舰船、调整每舰模块后开战 ——
 * 本轮仅可选"战斗舰"(combat)；模块从 data/modules.js 已注册模块中选装/卸除，
 * 每舰模块数不超过 SHIPS[type].slots（combat=3）。 */
const SHIP_TYPES = ['combat']; // M1：演练仅战斗舰（运输/采矿 M2 再放开）
const MODULE_IDS = Object.keys(MODULES);
let allyShips = [{ type: 'combat', modules: [] }]; // 我方演练编队（编辑态）
let enemyShips = [{ type: 'combat', modules: [] }]; // 敌方演练编队（编辑态）
let battleAllyCfg = null;  // 最近一次开战的我方配置快照（供"再战"重开同一配置）
let battleEnemyCfg = null; // 最近一次开战的敌方配置快照

function moduleName(id) {
  const m = MODULES[id];
  return m ? i18n.t(m.nameKey) : id;
}
function shipName(type) {
  return SHIPS[type] ? i18n.t(SHIPS[type].nameKey) : type;
}
function shipSlotLimit(type) {
  return (SHIPS[type] && SHIPS[type].slots) || 1;
}

let battle = null;
let selectedId = null;
let listenersBound = false;

/* 模块级 DOM 引用 */
let stageArea = null;
let overlay = null;            // { overlay, show }
let enemyZone = null;
let allyZone = null;
let detailEl = null;           // 详情面板挂载点
let detail = null;             // { ship, refs } | null
let updateCards = null;
let logPanelEl = null;
let statusEl = null;           // 战斗状态行（阶段/存活数）
let cmdSel = null;             // 指挥栏：全队目标策略下拉
let cmdPreview = null;         // 指挥栏：当前命中目标预览

/* ================= 图标与卡片 ================= */

/** 单位类型显示名：多个同阵营同名单位时带 #序号（如 战斗舰 #2），与战斗日志一致 */
function baseName(ship) {
  const base = i18n.t(ship.nameKey);
  return (ship.sideSize || 1) > 1 ? `${base} #${ship.order || 1}` : base;
}

/* ===== effects 词条能力检测（与引擎同一套判定：有词条才有效果） ===== */
function fxHas(fx, key) { return Number(fx[key] || 0) > 0; }
/** 带符号数值显示：正 +n / 负 −n / 0 */
function fmtSigned(v) {
  const n = Math.round(Math.abs(v));
  return v > 0 ? `+${n}` : v < 0 ? `−${n}` : '0';
}
/** 输出型（造成伤害等）：有 damage 词条 */
function isWeapon(fx) { return fxHas(fx, 'damage'); }
/** 纯回复型：有 shield_gain 且无 damage */
function isShieldRestore(fx) { return fxHas(fx, 'shield_gain') && !fxHas(fx, 'damage'); }
/** 目标词条是否仅作用于自身（self only） */
function rowSelfOnly(inst) {
  const k = (inst.cfg.target || {}).kinds;
  return Array.isArray(k) && k.length === 1 && k[0] === 'self';
}

/** 单位图标：读取独立素材文件 assets/img/ship-<type>-<side>.svg（我方蓝/敌方红）
 * 命名规则：船型-阵营，后续新船型(运输舰/采矿船)各新增素材即可。
 * 加载失败时回退为文本三角符号（便于发现素材缺失）。
 */
function unitIcon(ship) {
  const wrap = el('span', { class: 'unit-icon-wrap' });
  const img = el('img', {
    class: 'unit-icon-img',
    alt: '',
    draggable: 'false',
    src: `./assets/img/ship-${ship.typeId}-${ship.side}.svg`,
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
  for (const inst of ship.modules) {
    if (!inst.enabled) continue; // 停用的模块不参与"下一步"计算
    const fx = inst.cfg.effects;
    if ((fx.duration_ticks || 0) > 0) {
      // 时长型模块（如欧米茄护盾）：优先展示 持续中 → 冷却 → 充能就绪
      if (inst.durationLeft > 0) return i18n.t('battle.act.buffing', { n: inst.durationLeft });
      if (inst.cooldown > 0) return i18n.t('battle.act.cooling', { n: inst.cooldown });
      return ship.hull.energy >= fx.energy_cost
        ? i18n.t('battle.act.buffReady')
        : i18n.t('battle.act.noEnergy');
    }
    if (isWeapon(fx)) {
      if (inst.cooldown > 0) return i18n.t('battle.act.fireCool', { n: inst.cooldown });
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
  const chips = [];
  for (let i = 0; i < type.slots; i += 1) {
    const inst = ship.modules[i];
    if (!inst) {
      chips.push({ empty: true, el: el('span', { class: 'module-slot-empty' }) });
      continue;
    }
    const badge = el('span', { class: 'chip-badge', text: '' });
    const chip = el('span', {
      class: `module-chip ${inst.cfg.category}`,
      text: inst.cfg.glyph,
      title: `${i18n.t(inst.cfg.nameKey)} · L${inst.level}`,
    });
    chip.append(el('span', { class: 'module-lv', text: `L${inst.level}` }));
    chip.append(badge);
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
  const chips = buildModuleChips(ship);
  const intentEl = el('div', { class: 'unit-intent', text: '' });
  const focusEl = el('div', { class: 'unit-focus', text: '' }); // 主要目标
  const nameTag = el('div', { class: 'unit-name', text: `${baseName(ship)} · ${i18n.t(tagKey)}` });

  const cardEl = el('div', { class: `unit-card ${ship.side}`, onclick: () => selectUnit(ship.id) }, [
    el('div', { class: 'unit-icon-zone' }, [unitIcon(ship), nameTag]),
    el('div', { class: 'unit-bars' }, [hpBar.el, shieldBar.el, energyBar.el]),
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
        c.el.classList.toggle(
          'active',
          s.hull.shield < s.hull.shieldCap && s.hull.energy >= (fx.energy_cost || 0)
        );
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
    }
  }

  function update(s) {
    hpBar.update(s.hull.hp, s.hull.hpMax);
    shieldBar.update(s.hull.shield, s.hull.shieldCap);
    energyBar.update(s.hull.energy, s.hull.energyCap);
    cardEl.classList.toggle('dead', !s.alive);
    cardEl.classList.toggle('selected', selectedId === s.id);
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

function zoneEl(labelKey, sideClass, emptyHintKey) {
  const label = el('div', { class: 'zone-label', text: i18n.t(labelKey) });
  const unitsRow = el('div', { class: 'zone-units' });
  const children = [label, unitsRow];
  const hint = emptyHintKey ? el('div', { class: 'zone-hint', text: i18n.t(emptyHintKey) }) : null;
  if (hint) children.push(hint);
  const zone = el('div', { class: `battle-zone ${sideClass || ''}`.trim() }, children);
  return { zone, unitsRow, hint };
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
  const bar = el('div', { class: 'command-bar' }, [
    el('span', { class: 'command-label', text: i18n.t('battle.command.fleet') }),
    cmdSel,
    cmdPreview,
  ]);
  const zone = el('div', { class: 'battle-zone command' }, [label, bar]);
  refreshCommand();
  return { zone };
}

/** 刷新指挥栏：策略下拉值与当前命中目标预览；非对战中禁用 */
function refreshCommand() {
  if (!cmdSel || !cmdPreview) return;
  if (!battle) {
    cmdPreview.textContent = '';
    cmdSel.disabled = true;
    return;
  }
  cmdSel.value = battle.allyPolicy;
  cmdSel.disabled = battle.phase !== 'running';
  const t = battle.fleetPreview('ally');
  cmdPreview.replaceChildren(
    ...targetLabelNodes('battle.command.preview', t, 'battle.command.noTarget')
  );
}

function buildStage() {
  const enemyZ = zoneEl('battle.zone.enemy', 'enemy', null);
  const combatZ = zoneEl('battle.zone.combat', 'ally', null);
  const logisticsZ = zoneEl('battle.zone.logistics', 'ally', 'battle.zone.logistics.empty');
  const cmdZ = buildCommandZone();

  // 详情面板（选中单位后填充）
  detailEl = el('div', { class: 'battle-detail hidden' });
  showEmptyDetail();

  const logTitle = el('div', { class: 'log-title', text: i18n.t('battle.log.title') });
  const logLines = el('div');
  const logPanel = el('div', { class: 'battle-log' }, [logTitle, logLines]);

  const stage = el('div', { class: 'battle-stage' }, [
    enemyZ.zone,
    el('div', { class: 'battle-sep' }),
    combatZ.zone,
    logisticsZ.zone,
    cmdZ.zone,
    detailEl,
    logPanel,
  ]);
  return { stage, enemyZ, combatZ, logLines };
}

function rebuildUnits() {
  const allCards = [];
  for (const ship of battle.units()) {
    const card = buildShipCard(ship);
    allCards.push({ ship, card });
    const row = ship.side === 'enemy' ? enemyZone.unitsRow : allyZone.unitsRow;
    row.append(card.el);
  }
  updateCards = () => {
    for (const { ship, card } of allCards) card.update(ship);
  };
  updateCards();
}

/* ================= 详情面板 ================= */

function findUnit(id) {
  return battle?.units().find((u) => u.id === id) || null;
}

function foesOf(ship) {
  return ship.side === 'ally' ? battle.enemies : battle.allies;
}

/** 目标可选池（存活、去重）：按 target 词条 kinds 展开（enemy/ally/self/any 敌我任意） */
function candList(ship, tgt) {
  const kinds = (tgt && tgt.kinds) || [];
  const foes = ship.side === 'ally' ? battle.enemies : battle.allies;
  const same = ship.side === 'ally' ? battle.allies : battle.enemies;
  const out = [];
  if (kinds.includes('self')) out.push(ship);
  if (kinds.includes('enemy')) out.push(...foes);
  if (kinds.includes('ally')) out.push(...same.filter((u) => u.id !== ship.id));
  if (kinds.includes('any')) out.push(...battle.units());
  const seen = new Set();
  const res = [];
  for (const u of out) {
    if (!u.alive || seen.has(u.id)) continue;
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

/** 每次激活的基础效果文本（词条驱动，按船类系数折算后的每次量） */
function perActText(ship, inst) {
  const fx = inst.cfg.effects;
  const coef = SHIPS[ship.typeId]?.coefficients?.[fx.category] ?? 1;
  const parts = [];
  if (fxHas(fx, 'damage')) {
    parts.push(i18n.t('battle.detail.statDamage', { n: Math.round(fx.damage * coef) }));
  }
  if ((fx.ramp_per_hit || 0) > 0) {
    const cap = (fx.max_damage || 0) > 0 ? fx.max_damage : fx.damage || 0;
    parts.push(i18n.t('battle.detail.statRamp', { r: fx.ramp_per_hit, c: Math.round(cap) }));
  }
  if (fxHas(fx, 'shield_gain')) {
    parts.push(i18n.t('battle.detail.statRegen', { n: Math.round(fx.shield_gain * coef) }));
  }
  if (fx.shield_cap_bonus > 0) {
    parts.push(i18n.t('battle.detail.statCap', { n: Math.round(fx.shield_cap_bonus * coef) }));
  }
  if ((fx.shield_gain_target || 0) !== 0) {
    parts.push(i18n.t('battle.detail.statShieldT', { v: fmtSigned(fx.shield_gain_target * coef) }));
  }
  if ((fx.shield_cap_target || 0) !== 0) {
    parts.push(i18n.t('battle.detail.statCapT', { v: fmtSigned(fx.shield_cap_target * coef) }));
  }
  const tgtMeta = [
    ['hp_target', 'statHpT'],
    ['hp_cap_target', 'statHpCapT'],
    ['energy_target', 'statEnergyT'],
    ['energy_cap_target', 'statEnergyCapT'],
  ];
  for (const [k, key] of tgtMeta) {
    if ((fx[k] || 0) !== 0) {
      parts.push(i18n.t(`battle.detail.${key}`, { v: fmtSigned(fx[k] * coef) }));
    }
  }
  if (fx.duration_ticks > 0) {
    parts.push(i18n.t('battle.detail.statDuration', { n: fx.duration_ticks }));
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
    return i18n.t('battle.detail.contrib.dmg', {
      dmg: Math.round(st.damageDealt),
      dps: dps.toFixed(1),
      act: st.activations,
    });
  }
  if (fxHas(fx, 'shield_gain')) {
    const rate = secs > 0 ? st.shieldRestored / secs : 0;
    return i18n.t('battle.detail.contrib.regen', {
      amt: Math.round(st.shieldRestored),
      rate: rate.toFixed(1),
      act: st.activations,
    });
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
    const chipEl = el('span', { class: `module-chip ${inst.cfg.category}`, text: inst.cfg.glyph });
    const statusEl = el('span', { class: 'mod-status' });
    const metaEl = el('span', { class: 'mod-effect', text: perActText(ship, inst) });
    const dur = fx.duration_ticks || 0;
    const costText =
      dur > 0
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
          log.add(
            i18n.t(inst.enabled ? 'battle.log.moduleOn' : 'battle.log.moduleOff', {
              ship: unitLabel,
              module: i18n.t(inst.cfg.nameKey),
            }),
            'battle'
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
          el('span', { class: 'mod-target-ctl' }, [widget]),
        ])
      : null;
    const block = el('div', { class: 'mod-block' }, [
      row,
      targetLine,
      targetCurEl,
      contribEl,
    ]);

    rows.push({
      block,
      statusEl,
      toggleEl,
      chipEl,
      contribEl,
      targetPickEl,
      targetCurEl,
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

function modStatusText(ship, inst) {
  if (inst.enabled === false) return i18n.t('battle.detail.disabled');
  const fx = inst.cfg.effects;
  if ((fx.duration_ticks || 0) > 0) {
    // 时长型：优先展示 持续中 → 到期冷却 → 就绪/能量不足
    if (inst.durationLeft > 0) return i18n.t('battle.detail.buffing', { n: inst.durationLeft });
    if (inst.cooldown > 0) return i18n.t('battle.detail.cooling', { n: inst.cooldown });
    return ship.hull.energy >= (fx.energy_cost || 0)
      ? i18n.t('battle.detail.ready')
      : i18n.t('battle.detail.noEnergy');
  }
  if (isWeapon(fx)) {
    if (inst.cooldown > 0) return i18n.t('battle.detail.cooling', { n: inst.cooldown });
    return ship.hull.energy >= fx.energy_cost
      ? i18n.t('battle.detail.ready')
      : i18n.t('battle.detail.noEnergy');
  }
  if (isShieldRestore(fx)) {
    if (ship.hull.shield >= ship.hull.shieldCap) return i18n.t('battle.detail.full');
    if (inst.cooldown > 0) return i18n.t('battle.detail.cooling', { n: inst.cooldown });
    return ship.hull.energy >= (fx.energy_cost || 0)
      ? i18n.t('battle.detail.regen')
      : i18n.t('battle.detail.noEnergy');
  }
  // 其它类型（如目标级抑制词条等）：通用 冷却/就绪/能量
  if (inst.cooldown > 0) return i18n.t('battle.detail.cooling', { n: inst.cooldown });
  return ship.hull.energy >= (fx.energy_cost || 0)
    ? i18n.t('battle.detail.ready')
    : i18n.t('battle.detail.noEnergy');
}

function buildDetail(ship) {
  const tagKey = ship.side === 'ally' ? 'battle.side.ally' : 'battle.side.enemy';
  const type = SHIPS[ship.typeId];
  const modRows = moduleRows(ship);

  const head = el('div', { class: 'detail-head' }, [
    unitIcon(ship),
    el('div', { class: 'detail-head-text' }, [
      el('div', { class: 'detail-name', text: `${baseName(ship)} · ${i18n.t(tagKey)}` }),
      el('div', { class: 'detail-type', text: i18n.t('battle.detail.slots', { n: type.slots }) }),
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

  const modsTitle = el('div', { class: 'detail-subtitle', text: i18n.t('battle.detail.modules') });
  const modsList = el('div', { class: 'detail-mods' }, modRows.map((r) => r.block));

  const targetLabel = el('div', { class: 'detail-subtitle', text: i18n.t('battle.detail.target') });
  const targetBar = el('div', { class: 'detail-target' });
  const targetHint = el('div', { class: 'detail-target-cur', text: '' });

  const topRow = el('div', { class: 'detail-top' }, [head, statLine]);
  const panelEl = el('div', { class: 'detail-inner' }, [
    topRow,
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
    for (const r of modRows) {
      if (r.statusEl) r.statusEl.textContent = modStatusText(ship, r.inst);
      if (r.toggleEl) {
        r.toggleEl.textContent = r.inst.enabled
          ? i18n.t('battle.detail.disable')
          : i18n.t('battle.detail.enable');
      }
      if (r.chipEl) r.chipEl.classList.toggle('off', r.inst.enabled === false);
      if (r.contribEl) r.contribEl.textContent = contribText(ship, r.inst);
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
        const manual =
          r.inst.target && (r.inst.target.mode === 'unit' || r.inst.target.mode === 'units');
        const nodes = [];
        if (list.length) {
          nodes.push(document.createTextNode(i18n.t('battle.detail.targetCurPrefix')));
          if (manual) {
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
          nodes.push(document.createTextNode(i18n.t('battle.detail.curNone')));
        }
        r.targetCurEl.replaceChildren(...nodes);
      }
    }
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
    const foes = foesOf(ship).filter((f) => f.alive);
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
    if (s.side === 'ally') {
      if (s.targetId) {
        return cur
          ? i18n.t('battle.detail.locked', { name: baseName(cur) })
          : i18n.t('battle.detail.noTargets');
      }
      const policy = battle ? battle.allyPolicy : 'order';
      return cur
        ? i18n.t('battle.detail.following', {
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
      log.add(
        i18n.t('battle.log.retarget', { ship: unitDisplayName(s), target: baseName(foe) }),
        'battle'
      );
    } else {
      log.add(i18n.t('battle.log.autoTarget', { ship: unitDisplayName(s) }), 'battle');
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

/* ================= 演练配置 + 流程控制 ================= */

/** 渲染一列演练编队（sideKey: 'ally' | 'enemy'），含增删舰与模块调整 */
function renderFleetColumn(sideKey) {
  const ships = sideKey === 'ally' ? allyShips : enemyShips;
  const titleKey = sideKey === 'ally' ? 'battle.fleet.ally' : 'battle.fleet.enemy';
  const wrap = el('div', { class: 'drill-fleet' }, [
    el('div', { class: 'zone-label', text: i18n.t(titleKey) }),
  ]);
  ships.forEach((sh, idx) => {
    const head = el('div', { class: 'drill-ship-head' }, [
      el('span', { class: 'drill-ship-name', text: `${shipName(sh.type)} #${idx + 1}` }),
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
    sh.modules = sh.modules.map((m) => (typeof m === 'string' ? { moduleId: m, level: 1 } : m));
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
        const sel = el('select', {
          class: 'drill-mod-level',
          'aria-label': i18n.t('battle.drill.levelOf', { n: moduleName(id) }),
        }, Array.from({ length: maxLv }, (_, i) => {
          const o = el('option', { value: String(i + 1), text: `Lv${i + 1}` });
          if (i + 1 === (mod.level || 1)) o.selected = true;
          return o;
        }));
        sel.addEventListener('change', () => {
          mod.level = Number(sel.value) || 1;
          renderLaunch();
        });
        unit.append(sel);
      }
      chips.append(unit);
    });
    const full = sh.modules.length >= shipSlotLimit(sh.type);
    const addSel = el('select', {
      class: 'drill-add-mod',
      'aria-label': i18n.t('battle.drill.addModule'),
    }, full
      ? [el('option', { text: i18n.t('battle.drill.fullSlots') })]
      : [
          el('option', { value: '', text: i18n.t('battle.drill.addModule') }),
          ...MODULE_IDS.map((id) => el('option', { value: id, text: moduleName(id) })),
        ]);
    addSel.addEventListener('change', () => {
      const id = addSel.value;
      if (id && sh.modules.length < shipSlotLimit(sh.type)) {
        sh.modules.push({ moduleId: id, level: 1 });
      }
      renderLaunch();
    });
    wrap.append(el('div', { class: 'drill-ship' }, [head, chips, addSel]));
  });
  wrap.append(
    el('button', {
      class: 'btn small',
      text: i18n.t('battle.drill.addShip'),
      onclick: () => {
        ships.push({ type: SHIP_TYPES[0], modules: [] });
        renderLaunch();
      },
    })
  );
  return wrap;
}

/** 演练配置屏（沙盘）：替换原硬编码场景选择 */
function renderLaunch() {
  const canStart = allyShips.length > 0 && enemyShips.length > 0;
  const startBtn = el('button', {
    class: 'btn primary',
    text: i18n.t('battle.drill.start'),
    onclick: startBattle,
  });
  startBtn.disabled = !canStart; // property 赋 disabled，避免被当作字符串属性写入
  stageArea.replaceChildren(
    el('div', { class: 'drill-builder' }, [
      el('h3', { text: i18n.t('battle.drill.title') }),
      el('p', { class: 'drill-hint', text: i18n.t('battle.drill.hint') }),
      el('div', { class: 'drill-grid' }, [
        renderFleetColumn('ally'),
        renderFleetColumn('enemy'),
      ]),
      el('div', { class: 'drill-actions' }, [
        startBtn,
        el('button', { class: 'btn small', text: i18n.t('battle.menu.back'), onclick: exitToMenu }),
      ]),
    ])
  );
  refreshStatus();
}

/** 用当前编辑态开战 */
function startBattle() {
  if (!allyShips.length || !enemyShips.length) return;
  const ally = allyShips.map((s) => ({ type: s.type, modules: s.modules.slice() }));
  const enemy = enemyShips.map((s) => ({ type: s.type, modules: s.modules.slice() }));
  beginBattleFromCfg(ally, enemy);
}

/** 用给定配置快照开战（每次开战前自动暂停供手动调整） */
function beginBattleFromCfg(allyCfg, enemyCfg) {
  battleAllyCfg = allyCfg.map((s) => ({ type: s.type, modules: s.modules.slice() }));
  battleEnemyCfg = enemyCfg.map((s) => ({ type: s.type, modules: s.modules.slice() }));
  selectedId = null;
  detail = null;
  if (battle) battle.stop();
  battle = createBattle({ ally: allyCfg, enemy: enemyCfg });
  window.__battle = battle;

  if (stageArea) {
    stageArea.replaceChildren();
    const built = buildStage();
    stageArea.append(built.stage);
    enemyZone = built.enemyZ;
    allyZone = built.combatZ;
    logPanelEl = built.logLines;
    rebuildUnits();
    overlay?.overlay.classList.add('hidden');
  }
  battle.start();
  ticker.pause(); // 开战即暂停：让玩家先手动调整目标/启停再开始
  refreshStatus();
}

function exitToMenu() {
  if (battle) {
    battle.stop();
    battle = null;
    window.__battle = null;
  }
  ticker.setSpeed(1);
  ticker.resume();
  router.show('menu');
}

/* ================= 根节点 ================= */

function root() {
  const titleEl = el('div', { class: 'battle-title', text: i18n.t('battle.title') });
  statusEl = el('div', { class: 'battle-status', text: '' });
  const rootEl = el('section', { class: 'screen screen-battle' }, [titleEl, statusEl]);
  stageArea = el('div');
  rootEl.append(stageArea);
  overlay = overlayEl();
  rootEl.append(overlay.overlay);

  bindGlobalListeners();
  refreshStatus();

  if (battle && battle.phase !== 'idle') {
    renderRunning();
  } else {
    renderLaunch();
  }
  return rootEl;
}

/** 战斗状态行：阶段 + 双方存活数 */
function refreshStatus() {
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
  allyZone = built.combatZ;
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
        if (battleAllyCfg && battleEnemyCfg) beginBattleFromCfg(battleAllyCfg, battleEnemyCfg);
      },
    }),
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

  function show(result) {
    const win = result === 'win';
    resultTitle.textContent = i18n.t(win ? 'battle.result.win.title' : 'battle.result.lose.title');
    resultTitle.className = `result-title ${win ? 'win' : 'lose'}`;
    resultDesc.textContent = i18n.t(win ? 'battle.result.win.desc' : 'battle.result.lose.desc');
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
      text: line.msg,
    });
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
    }
  });
}

export const battleView = {
  root,
};

export default battleView;
