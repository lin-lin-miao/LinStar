/* ===== systems/battle.js —— 战斗系统核心 =====
 * 战斗状态机：idle -> running -> settled（胜负结算）-> 可重新开始
 *
 * tick 结算顺序（见清单 3.5）：
 *   1. 模块冷却倒计时
 *   2. 能量基础回复
 *   3. 累计各模块"有效贡献窗口"（activeTicks，用于 DPS 冻结）
 *   4. 行动：激活模块（目标解析 -> 能量门控 -> 词条执行器）
 *   5. 死亡清理与胜负判定
 *
 * ★ 模块效果执行器（解耦，词条驱动）：
 *   模块在 data/modules.js 中用 effects 词条声明效果——
 *     damage     → 对每个选定目标造成伤害（×船类系数）
 *     shield_gain → 对每个选定目标恢复护盾（×船类系数）
 *     （后续词条如 heal / energyDrain 在此同一框架追加执行器）
 *   effects.type 仅用于"特殊模块的特殊效果"标记，且为【列表参数】，
 *   未来一个模块可同时携带多个特殊效果（type: ['...', '...']）。
 *
 * ★ 统一目标系统（详情/单位框/指挥栏共用同一解析）：
 *   目标可用对象 kinds（self/ally/enemy）+ 目标数量 countMode
 *   （single/multi/all，multi 数量上限 maxCount）
 *   解析链：模块手动选择(单/多，互斥) → 上游（船指定 → 全队策略）自动补足
 *   目标不足/无目标 → 本次不激活。
 *
 * 契约：开始广播 combat:state{active:true}；结算完成广播 active:false（自动落档）。
 * 事件：'battle:settled' { result:'win'|'lose' }
 */
import { bus } from '../core/eventBus.js';
import { log } from '../core/log.js';
import { i18n } from '../i18n/index.js';
import { createShip, installModule, coeff, recalcDerived } from '../entities/ship.js';

const TPS = 20; // 1 秒 = 20 tick

/** 全队（阵营级）自动目标策略：顺序 / 最低血量 / 最低护盾（可扩展） */
export const TARGET_POLICIES = ['order', 'lowestHp', 'lowestShield'];

/** 按全队策略对存活目标排序（order=阵列顺序=前排优先；其余按数值升序） */
function orderedFoes(foes, policy) {
  const alive = foes.filter((f) => f.alive);
  if (policy === 'lowestHp') return alive.sort((a, b) => a.hull.hp - b.hull.hp);
  if (policy === 'lowestShield') return alive.sort((a, b) => a.hull.shield - b.hull.shield);
  return alive;
}

/** 单位类型名（多个同阵营同名单位时带 #序号 区分，如 战斗舰 #2） */
function typeName(ship) {
  const base = i18n.t(ship.nameKey);
  return (ship.sideSize || 1) > 1 ? `${base} #${ship.order || 1}` : base;
}

function nameForLog(ship) {
  const key = ship.side === 'ally' ? 'battle.unit.ally' : 'battle.unit.enemy';
  return i18n.t(key, { type: typeName(ship) });
}

/** 造成伤害：护盾先承伤，再扣血；目标死亡时记录战报 */
function damageShip(target, amount) {
  let dealt = 0;
  let rest = amount;
  if (target.hull.shield > 0) {
    const absorbed = Math.min(target.hull.shield, rest);
    target.hull.shield -= absorbed;
    dealt += absorbed;
    rest -= absorbed;
  }
  if (rest > 0) {
    target.hull.hp -= rest;
    dealt += rest;
  }
  if (target.hull.hp <= 0 && target.alive) {
    target.hull.hp = 0;
    target.alive = false;
    log.add(i18n.t('battle.log.destroyed', { ship: nameForLog(target) }), 'battle');
  }
  return dealt;
}

/**
 * 创建一场战斗。
 * @param {{ally: [{type, modules}], enemy: [{type, modules}]}} preset 双方编队配置
 */
export function createBattle(preset) {
  const allies = [];
  const enemies = [];
  let phase = 'idle'; // idle | running | settled
  let result = null;
  let tickOff = null;
  let runTicks = 0; // 战斗已进行的 tick 数（running 起计）

  function spawnList(arr, side, list) {
    for (const cfg of list) {
      const ship = createShip(cfg.type, side);
      for (const mod of cfg.modules) {
        // 支持字符串 id（level=1）或规格对象 { moduleId/id, level }
        const spec = mod && typeof mod === 'object' ? mod : { moduleId: mod };
        installModule(ship, spec.moduleId ?? spec.id, spec.level ?? 1);
      }
      // 开战护盾 = 护盾上限（含被动模块加成上限；时长型模块持续期外不贡献，
      // 因 recalcDerived 只在持续期计入其上限加成，故此处即"满盾"）
      ship.hull.shield = ship.hull.shieldCap;
      ship.order = arr.length + 1; // 该阵营内的出场序号（用于 #编号 显示）
      arr.push(ship);
    }
  }

  // 单位在创建战斗时即生成完毕（UI 可在 start() 前据此渲染实体框）
  spawnList(allies, 'ally', preset.ally || []);
  spawnList(enemies, 'enemy', preset.enemy || []);
  for (const s of allies) s.sideSize = allies.length;
  for (const s of enemies) s.sideSize = enemies.length;

  /* ---------- 统一目标系统 ---------- */
  const policies = { ally: 'order', enemy: 'order' };
  const policyOf = (ship) => policies[ship.side] || 'order';

  /** 依目标词条(kinds/countMode/maxCount)解析本次命中的目标列表（引擎与 UI 共用）
   *  - 目标池：self → 自身；enemy → 敌方存活（按全队策略排序）；ally → 同阵营其它存活
   *  - 手动选择互斥（去重）；未手动覆盖的空位由上游自动补足：
   *      船指定目标(ship.targetId)置前 → 其余按全队策略顺序
   *  - countMode：single=1 / multi=min(maxCount, 可用) / all=全部；空目标池 → 无目标 []
   */
  function moduleTargetList(ship, inst) {
    const fx = (inst && inst.cfg.effects) || {};
    const tgt = (inst && inst.cfg.target) || {};
    const kinds = Array.isArray(tgt.kinds) ? tgt.kinds : [];
    const mode = tgt.countMode || 'single';
    const maxN = Math.max(1, tgt.maxCount || 1);
    const foes = ship.side === 'ally' ? enemies : allies;
    const sameSide = ship.side === 'ally' ? allies : enemies;

    const pool = [];
    if (kinds.includes('self')) pool.push(ship);
    if (kinds.includes('enemy')) pool.push(...orderedFoes(foes, policyOf(ship)));
    if (kinds.includes('ally')) {
      pool.push(...sameSide.filter((u) => u.alive && u.id !== ship.id));
    }
    if (kinds.includes('any')) pool.push(...[...allies, ...enemies]); // 敌我任意（含自身）
    const uniq = [];
    for (const u of pool) {
      if (!u.alive) continue;
      if (!uniq.some((x) => x.id === u.id)) uniq.push(u);
    }
    if (!uniq.length) return [];
    // 船指定目标（上游）置于池前（若其在池中）
    if (ship.targetId) {
      const i = uniq.findIndex((u) => u.id === ship.targetId);
      if (i > 0) {
        const [d] = uniq.splice(i, 1);
        uniq.unshift(d);
      }
    }

    if (mode === 'all') return uniq;

    if (mode === 'multi') {
      // 手动多选（互斥集合）优先，不足 maxN 的空位由上游顺序自动补足
      const selIds = new Set(
        inst.target && inst.target.mode === 'units' ? inst.target.ids || [] : []
      );
      const out = [];
      for (const u of uniq) {
        if (selIds.has(u.id) && out.length < maxN) out.push(u);
      }
      for (const u of uniq) {
        if (out.length >= maxN) break;
        if (!selIds.has(u.id)) out.push(u);
      }
      return out;
    }

    // single
    if (inst.target && inst.target.mode === 'unit') {
      const u = uniq.find((f) => f.id === inst.target.id);
      if (u) return [u];
    }
    return uniq.slice(0, 1);
  }

  /** 船的"上游"目标（供 UI 显示单位主要目标/提示） */
  function shipEffectiveTarget(ship) {
    const foes = ship.side === 'ally' ? enemies : allies;
    if (ship.targetId) {
      const u = foes.find((f) => f.id === ship.targetId && f.alive);
      if (u) return u;
    }
    return orderedFoes(foes, policyOf(ship))[0] || null;
  }

  /** 阵营策略预览：该阵营当前全队首个命中目标 */
  function fleetPreview(side) {
    const foes = side === 'ally' ? enemies : allies;
    return orderedFoes(foes, policies[side])[0] || null;
  }

  /* ---------- 目标级 护盾/血量/能量 词条管理 ----------
   * 指向"选定目标"的词条（kinds 可含 self/ally/enemy/any）：
   *   量值型（每次激活即时 加/减 当前值，正=加负=减）：
   *       shield_gain_target / hp_target / energy_target
   *   上限型（抬/压 cap，随本模块停用/时长结束/来源失效撤销）：
   *       shield_cap_target / hp_cap_target / energy_cap_target
   * shield_gain / shield_cap_bonus（只作用于自身的旧词条）仍由 recalcDerived 处理。
   */
  const capOverlays = new Map(); // targetId -> Map(sourceModId, {sh,hp,en})
  const AMOUNT = { shield_gain_target: 'shield', hp_target: 'hp', energy_target: 'energy' };
  const CAPFIELD = { shield_cap_target: 'sh', hp_cap_target: 'hp', energy_cap_target: 'en' };

  function ownerOf(inst) {
    for (const s of [...allies, ...enemies]) if (s.modules.includes(inst)) return s;
    return null;
  }

  /** 重算目标三围上限 = 自身(基础+被动+自身时长加成) + Σ目标级 cap 增/减
   *  每次均从各自基础值(baseShieldCap/baseHpMax/baseEnergyCap)重算，
   *  保证非累加：撤销旧影响后新施加不会在已减值上再叠。 */
  function recomputeCap(target) {
    recalcDerived(target); // 护盾上限 = 基础 + 自身被动/时长加成
    target.hull.hpMax = target.hull.baseHpMax; // 先复位血量/能量上限到基准
    target.hull.energyCap = target.hull.baseEnergyCap;
    const m = capOverlays.get(target.id);
    let sh = 0;
    let hp = 0;
    let en = 0;
    if (m) for (const v of m.values()) { sh += v.sh; hp += v.hp; en += v.en; }
    if (sh !== 0) target.hull.shieldCap = Math.max(0, target.hull.shieldCap + sh);
    if (hp !== 0) target.hull.hpMax = Math.max(1, target.hull.hpMax + hp);
    if (en !== 0) target.hull.energyCap = Math.max(0, target.hull.energyCap + en);
    target.hull.shield = Math.min(target.hull.shield, target.hull.shieldCap);
    target.hull.hp = Math.min(target.hull.hp, target.hull.hpMax);
    target.hull.energy = Math.min(target.hull.energy, target.hull.energyCap);
  }

  /** 设置/覆盖本模块对某目标某一 cap(sh/hp/en) 的增/减并立即生效 */
  function setOverlay(target, inst, field, value) {
    if (!capOverlays.has(target.id)) capOverlays.set(target.id, new Map());
    const src = capOverlays.get(target.id);
    if (!src.has(inst.id)) src.set(inst.id, { sh: 0, hp: 0, en: 0 });
    src.get(inst.id)[field] = value;
    recomputeCap(target);
  }

  /** 移除本模块对全部目标的 cap 影响（停用/时长结束/失效时调用）并重算受影响目标 */
  function dropSourceMods(inst) {
    let touched = false;
    for (const m of capOverlays.values()) {
      if (m.has(inst.id)) {
        m.delete(inst.id);
        touched = true;
      }
    }
    if (touched) for (const s of [...allies, ...enemies]) recomputeCap(s);
  }

  /** 启用/停用模块（处理自身被动重算 + 移除其目标级 cap 影响） */
  function enableModule(inst) {
    inst.enabled = true;
    const o = ownerOf(inst);
    if (o) recalcDerived(o); // 重新计入自身被动加成
  }
  function disableModule(inst) {
    inst.enabled = false;
    if (inst._ramp) inst._ramp = { key: '', count: 0 }; // 停用 → 逐步伤害成长归零
    dropSourceMods(inst); // 移除其施加在其它单位上的护盾上限影响
    const o = ownerOf(inst);
    if (!o) return;
    if (inst.durationLeft > 0) {
      inst.durationLeft = 0;
      inst.cooldown = inst.cfg.effects.cooldown_ticks ?? 1;
    }
    recalcDerived(o); // 结束自身被动/自身时长加成
  }

  /** 进入战斗（开始 tick 结算） */
  function start() {
    if (phase !== 'idle') return;
    phase = 'running';
    result = null;
    tickOff = bus.on('tick', step);
    bus.emit('combat:state', { active: true });
    log.add(i18n.t('battle.log.start'), 'battle');
  }

  /** 中止/离开战斗（未结算） */
  function stop() {
    if (tickOff) {
      tickOff();
      tickOff = null;
    }
    const wasActive = phase === 'running';
    phase = 'idle';
    result = null;
    if (wasActive) bus.emit('combat:state', { active: false });
  }

  /** 结算完成（随后自动存档） */
  function settle(res) {
    if (phase !== 'running') return;
    phase = 'settled';
    result = res;
    if (tickOff) {
      tickOff();
      tickOff = null;
    }
    bus.emit('battle:settled', { result: res });
    bus.emit('combat:state', { active: false }); // 结算完成后允许/触发存档
  }

  /* ---------- tick 结算 ---------- */

  /** 模块状态推进：
   *  - 有 duration_ticks 的模块：效果持续期递减；持续结束 → 撤销效果(重算派生)
   *    → 进入 cooldown_ticks 冷却；
   *  - 无 duration 的模块：直接按冷却递减（激活后进入冷却）。
   *  - 停用模块：一切冻结。
   */
  function moduleCycleTick(ship) {
    for (const inst of ship.modules) {
      if (!inst.enabled) continue; // 停用的模块冷却/持续冻结
      const fx = inst.cfg.effects;
      if (inst.durationLeft > 0) {
        inst.durationLeft -= 1;
        if (inst.durationLeft <= 0) {
          inst.durationLeft = 0;
          dropSourceMods(inst);   // 时长结束 → 撤销其对目标护盾上限的影响
          recalcDerived(ship);    // 撤销自身时长加成（如自身护盾上限回落）
          if ((fx.cooldown_ticks || 0) > 0) inst.cooldown = fx.cooldown_ticks ?? 1; // 进入冷却
        }
      } else if (inst.cooldown > 0) {
        inst.cooldown -= 1;
      }
    }
  }

  function energyRegenTick(ship) {
    ship.hull.energy = Math.min(
      ship.hull.energyCap,
      ship.hull.energy + ship.energyRegenPerSec / TPS
    );
  }

  /** 模块此刻是否处于"有效贡献窗口"（窗口冻结 → DPS 冻结） */
  function moduleActiveNow(ship, inst) {
    if (!ship.alive || !inst.enabled) return false;
    const fx = inst.cfg.effects;
    const hasDmg = (fx.damage || 0) > 0;
    const hasShield = (fx.shield_gain || 0) > 0;
    if (hasShield && !hasDmg) {
      // 纯回复类：须盾未满且能量足够（满盾/能量不足不算窗口）
      return ship.hull.shield < ship.hull.shieldCap && ship.hull.energy >= (fx.energy_cost || 0);
    }
    return true;
  }

  /** 激活前可行性：时长型加盾模块（未在持续期即可激活）；纯增益须对某目标生效 */
  function canImpact(targets, fx, inst) {
    if ((fx.damage || 0) > 0) return true;
    // 目标级量值词条（shield/hp/energy）：负(削减)恒可影响；正(增益)需存在未满目标
    for (const k of Object.keys(AMOUNT)) {
      const v = fx[k] || 0;
      if (!v) continue;
      const f = AMOUNT[k];
      const atCap = (t) =>
        f === 'shield'
          ? t.hull.shield >= t.hull.shieldCap
          : f === 'hp'
            ? t.hull.hp >= t.hull.hpMax
            : t.hull.energy >= t.hull.energyCap;
      if (v < 0) return true;
      if (targets.some((t) => !atCap(t))) return true;
      return false; // 全满且为正增益 → 无益，不激活
    }
    // 目标级上限词条：恒可影响
    for (const k of Object.keys(CAPFIELD)) if ((fx[k] || 0) !== 0) return true;
    if ((fx.shield_gain || 0) > 0 && targets.some((t) => t.hull.shield < t.hull.shieldCap)) {
      return true;
    }
    if ((fx.duration_ticks || 0) > 0 && (fx.shield_cap_bonus || 0) > 0) {
      return !inst || inst.durationLeft <= 0; // 效果未在持续期 → 可激活
    }
    const tags = Array.isArray(fx.type) ? fx.type : fx.type ? [fx.type] : [];
    if (tags.length) return true; // 特殊效果视为可影响（预留）
    return false;
  }

  /** 统一的模块激活（词条执行器，与激活框架解耦） */
  function activate(ship, inst) {
    const fx = inst.cfg.effects;
    if (!fx || !inst.enabled) return;
    if (inst.cooldown > 0) return;
    if (inst.durationLeft > 0) return; // 持续效果进行中不可重复触发
    const cost = fx.energy_cost || 0;
    if (ship.hull.energy < cost) {
      // 能量不足：本次不触发；逐步伤害(ramp)成长清零 → 断能后伤害回到基础值
      if (inst._ramp) inst._ramp = { key: '', count: 0 };
      return;
    }

    const targets = moduleTargetList(ship, inst);
    if (!targets.length) return; // 无足够目标：本次不激活
    if (!canImpact(targets, fx, inst)) return; // 无可生效目标（如盾满/效果已在持续）：不激活不耗能

    ship.hull.energy -= cost;
    if ((fx.duration_ticks || 0) > 0) {
      // 持续时间词条：先进入持续期并【先应用时长型加成（如护盾上限提升）】，
      // 再执行瞬间效果词条（如 shield_gain 回盾按新上限结算）；持续结束后自动进冷却
      inst.durationLeft = fx.duration_ticks;
      inst.cooldown = 0;
      if ((fx.shield_cap_bonus || 0) > 0) recalcDerived(ship); // 上限先加
    } else {
      inst.cooldown = fx.cooldown_ticks ?? 1;
    }

    // —— 目标级量值/上限词条：对每个选定目标同时生效（shield/hp/energy 三类）——
    const co = coeff(ship, inst.cfg.category);
    const amtKeys = Object.keys(AMOUNT).filter((k) => (fx[k] || 0) !== 0);
    const capKeys = Object.keys(CAPFIELD).filter((k) => (fx[k] || 0) !== 0);
    if (amtKeys.length || capKeys.length) {
      // 上限类词条为"单次一次性、仅对当前所选目标"：
      // 每次触发先撤销上次施加在(旧)目标上的上限影响，再对本次解析目标重新施加——
      // 故不随多次触发累加；切换目标后于下一次触发时生效到新目标（旧目标影响随之消失），
      // 携带者阵亡亦由 cleanDeadEffects 撤销。
      if (capKeys.length) dropSourceMods(inst);
      for (const target of targets) {
        for (const k of capKeys) setOverlay(target, inst, CAPFIELD[k], fx[k] * co);
        for (const k of amtKeys) {
          const amt = fx[k] * co;
          const f = AMOUNT[k];
          if (f === 'shield') {
            target.hull.shield =
              amt > 0
                ? Math.min(target.hull.shieldCap, target.hull.shield + amt)
                : Math.max(0, target.hull.shield + amt);
          } else if (f === 'energy') {
            target.hull.energy =
              amt > 0
                ? Math.min(target.hull.energyCap, target.hull.energy + amt)
                : Math.max(0, target.hull.energy + amt);
          } else {
            // hp：正=加血，负=扣血（直接作用于机体，可能致死）
            target.hull.hp =
              amt > 0
                ? Math.min(target.hull.hpMax, target.hull.hp + amt)
                : Math.max(0, target.hull.hp + amt);
            if (target.hull.hp <= 0 && target.alive) {
              target.hull.hp = 0;
              target.alive = false;
              log.add(i18n.t('battle.log.destroyed', { ship: nameForLog(target) }), 'battle');
            }
          }
        }
      }
    }

    let dmgTotal = 0;
    let shieldTotal = 0;
    // —— 逐步伤害（ramp_per_hit）：每次成功激活 +ramp，持续同一组目标则逐次累加 ——
    //  有 max_damage：从基础 damage 起涨，封顶 max_damage；无则从 0 起涨，封顶 damage。
    //  目标组改变（切换/阵亡）→ 于本次激活检测到并清零、重新累加。
    const baseRaw = fx.damage || 0;
    let effRaw = baseRaw;
    if ((fx.ramp_per_hit || 0) > 0) {
      const sig = targets
        .map((u) => u.id)
        .sort()
        .join(',');
      if (!inst._ramp) inst._ramp = { key: '', count: 0 };
      if (sig !== inst._ramp.key) {
        inst._ramp.key = sig;
        inst._ramp.count = 0;
      }
      inst._ramp.count += 1; // 本次激活计数 +1
      const steps = inst._ramp.count - 1; // 首次=基础，此后每次激活 +ramp
      const hasMax = (fx.max_damage || 0) > 0;
      const cap = hasMax ? fx.max_damage : baseRaw;
      const start = hasMax ? baseRaw : 0;
      effRaw = Math.min(cap, start + (fx.ramp_per_hit || 0) * steps);
    }
    const effDmg = effRaw * coeff(ship, inst.cfg.category);
    for (const target of targets) {
      // —— 词条执行器：依据 effects 中的词条对每个选定目标同时生效 ——
      if ((fx.damage || 0) > 0) {
        const dmg = effDmg;
        const dealt = damageShip(target, dmg);
        dmgTotal += dealt;
        log.add(
          i18n.t('battle.log.fire', {
            actor: nameForLog(ship),
            target: nameForLog(target),
            dmg: Math.round(dealt),
          }),
          'battle'
        );
      }
      if ((fx.shield_gain || 0) > 0) {
        const before = target.hull.shield;
        const gain = fx.shield_gain * coeff(ship, inst.cfg.category);
        target.hull.shield = Math.min(target.hull.shieldCap, before + gain);
        shieldTotal += target.hull.shield - before;
      }
      // 未来词条执行器在此追加（如 heal / energyDrain / shieldDrain …）
    }
    inst.stats.activations += 1;
    inst.stats.damageDealt += dmgTotal;
    inst.stats.shieldRestored += shieldTotal;
    inst.stats.energySpent += cost;
    // type 列表 = 特殊效果钩子（M1 无内建特殊钩子；M2 特殊模块在 activate 前/后挂接）
  }

  /** 手动指定目标（船级/模块级单/多选）阵亡 → 清理/回落上游 */
  function dropDeadTargets() {
    for (const ship of [...allies, ...enemies]) {
      const foes = ship.side === 'ally' ? enemies : allies;
      const aliveId = (id) => {
        const u = foes.find((f) => f.id === id);
        return u && u.alive;
      };
      if (ship.targetId && !aliveId(ship.targetId)) {
        ship.targetId = null;
        log.add(i18n.t('battle.log.autoTarget', { ship: nameForLog(ship) }), 'battle');
      }
      for (const inst of ship.modules) {
        const t = inst.target;
        if (!t) continue;
        if (t.mode === 'unit') {
          if (!aliveId(t.id)) {
            inst.target = { mode: 'follow' };
            log.add(
              i18n.t('battle.log.moduleFollow', {
                ship: nameForLog(ship),
                module: i18n.t(inst.cfg.nameKey),
              }),
              'battle'
            );
          }
        } else if (t.mode === 'units') {
          const kept = (t.ids || []).filter(aliveId);
          if (kept.length !== (t.ids || []).length) {
            if (!kept.length) {
              inst.target = { mode: 'follow' };
              log.add(
                i18n.t('battle.log.moduleFollow', {
                  ship: nameForLog(ship),
                  module: i18n.t(inst.cfg.nameKey),
                }),
                'battle'
              );
            } else {
              t.ids = kept; // 部分目标阵亡：仅移除并保留其余
            }
          }
        }
      }
    }
  }

  /** 单位阵亡后清理其仍存续的效果（自身时长 buff / 施加到其它目标上的 cap 影响） */
  function cleanDeadEffects() {
    const all = [...allies, ...enemies];
    for (const ship of all) {
      if (ship.alive) continue;
      for (const inst of ship.modules) {
        if (inst.durationLeft > 0) inst.durationLeft = 0; // 结束自身时长 buff
        dropSourceMods(inst); // 撤销其对其它目标护盾上限的影响（若无则无操作）
      }
    }
    // 清除仍指向已阵亡目标（target 已死）的 cap 影响
    for (const tid of [...capOverlays.keys()]) {
      const t = all.find((s) => s.id === tid);
      if (!t || !t.alive) capOverlays.delete(tid);
    }
  }

  function step() {
    if (phase !== 'running') return;
    runTicks += 1;
    dropDeadTargets();
    cleanDeadEffects();
    const alive = [...allies, ...enemies].filter((s) => s.alive);
    for (const s of alive) moduleCycleTick(s);
    for (const s of alive) energyRegenTick(s);
    // 累计各模块有效贡献窗口（先于激活，含当前 tick）
    for (const s of alive) {
      for (const inst of s.modules) {
        if (moduleActiveNow(s, inst)) inst.stats.activeTicks += 1;
      }
    }
    // 敌方先行动，我方后行动（先手规则占位，M2 细调）
    for (const s of enemies) if (s.alive) for (const inst of s.modules) activate(s, inst);
    for (const s of allies) if (s.alive) for (const inst of s.modules) activate(s, inst);
    checkEnd();
  }

  function checkEnd() {
    const anyAlly = allies.some((s) => s.alive);
    const anyEnemy = enemies.some((s) => s.alive);
    if (!anyEnemy) settle('win');
    else if (!anyAlly) settle('lose');
  }

  return {
    get phase() { return phase; },
    get result() { return result; },
    get allies() { return allies; },
    get enemies() { return enemies; },
    get runTicks() { return runTicks; },
    get allyPolicy() { return policies.ally; },
    get enemyPolicy() { return policies.enemy; },
    setAllyPolicy(kind) {
      if (!TARGET_POLICIES.includes(kind)) return false;
      policies.ally = kind;
      return true;
    },
    /** 全部存活单位（含双方） */
    units() { return [...allies, ...enemies]; },
    moduleTargetList,
    shipEffectiveTarget,
    fleetPreview,
    enableModule,
    disableModule,
    start,
    stop,
  };
}

export default createBattle;
