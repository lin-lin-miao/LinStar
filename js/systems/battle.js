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
import { log, formatRich } from '../core/log.js';
import { i18n } from '../i18n/index.js';
import { createShip, installModule, coeff, recalcDerived } from '../entities/ship.js';

const TPS = 20; // 1 秒 = 20 tick

/** 全队（阵营级）自动目标策略：顺序 / 最低血量 / 最低护盾 / 优先无人机 / 优先舰船（可扩展）。
 *  ship 级可用 ship.policy 覆盖（null=跟随全队）；该列表也作为 船舰主要目标 的策略选项。 */
export const TARGET_POLICIES = ['order', 'lowestHp', 'lowestShield', 'droneFirst', 'shipFirst'];

/** 按策略对存活目标排序：
 *  lowestHp / lowestShield 按数值升序；
 *  droneFirst / order（默认）→ 召唤(无人机)组视为"队首"，先于主力；
 *  shipFirst → 主力(舰船)先于召唤(无人机)。组内按阵列顺序。
 *  注：此处用于【目标选择队列】；渲染队列顺序与它无关（召唤物排在列尾显示）。 */
function orderedFoes(foes, policy) {
  const alive = foes.filter((f) => f.alive);
  if (policy === 'lowestHp') return alive.sort((a, b) => a.hull.hp - b.hull.hp);
  if (policy === 'lowestShield') return alive.sort((a, b) => a.hull.shield - b.hull.shield);
  const summoned = alive.filter((f) => f.isSummon);
  const mains = alive.filter((f) => !f.isSummon);
  if (policy === 'shipFirst') return [...mains, ...summoned];
  return [...summoned, ...mains]; // order / droneFirst
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

/** 单位名着色段（敌方名红 / 我方名蓝，由渲染层包 span） */
function uTok(ship) {
  return { side: ship.side, label: nameForLog(ship) };
}

/** 战斗战报（channel=battle）：colorKeys 所列占位参数按着色单位名段替换 */
function battleLog(key, params, colorKeys) {
  const { msg, rich } = formatRich(key, params, colorKeys);
  log.add(msg, 'battle', rich);
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
    battleLog('battle.log.destroyed', { ship: uTok(target) }, ['ship']);
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
  const seqCount = { ally: 0, enemy: 0 }; // 各阵营"出场序号"分配器：编号由出场顺序决定、不随队列变化

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
      seqCount[side] += 1;
      ship.order = seqCount[side]; // 出场序号（#编号），稳定不随队列/移除变化
      arr.push(ship);
    }
  }

  // 单位在创建战斗时即生成完毕（UI 可在 start() 前据此渲染实体框）
  spawnList(allies, 'ally', preset.ally || []);
  spawnList(enemies, 'enemy', preset.enemy || []);
  for (const s of allies) s.sideSize = allies.length;
  for (const s of enemies) s.sideSize = enemies.length;

  /* ---------- 召唤 / 临时单位支持 ---------- */
  const sidesOf = (side) => (side === 'ally' ? allies : enemies);
  /** 该阵营当前存活的某种单位数量（用于"最大召唤数"判定） */
  function countLiveOfType(side, typeId) {
    let n = 0;
    for (const u of sidesOf(side)) if (u.alive && u.typeId === typeId) n += 1;
    return n;
  }
  /** 该阵营人数变化后同步各单位的 sideSize（仅决定是否显示 # 前缀），不改动出场序号 */
  function refreshSideSize(side) {
    const arr = sidesOf(side);
    for (const u of arr) u.sideSize = arr.length;
  }
  /** 生成一个召唤单位并入阵营（overrides 覆写模板），排在该阵营队列【列尾】显示；
   * 目标队列顺序由 orderedFoes 另行处理（召唤物视为队首）。
   * 出场序号由 seqCount 统一分配、稳定不随队列/移除变化。
   * temp=true → 临时单位：受存在时间(lifespan)约束，到期自动死亡；阵亡/到期后直接移出场景。
   * temp=false → 普通单位：不设存在时间，持续作战至死亡（阵亡后保留灰色卡片）。 */
  function spawnSummoned(typeId, side, overrides, temp) {
    const s = createShip(typeId, side, overrides || null);
    s.isSummon = true;           // 召唤单位标记（目标队列视为队首；渲染仍排在列尾）
    s.temp = !!temp;             // 是否为临时单位（由召唤配置决定）
    if (s.temp) s.tempLeft = 0;  // 剩余存在 tick（仅临时单位使用）
    seqCount[side] += 1;
    s.order = seqCount[side];    // #编号由出场顺序决定（整队统一递增）
    sidesOf(side).push(s);       // 排在列尾（显示在主力之后）；目标顺序由 orderedFoes 另行处理
    refreshSideSize(side);
    return s;
  }
  /** 把临时单位移出场景，并清理其各模块对本场其它单位施加的影响 */
  function removeSummoned(side, u) {
    for (const inst of u.modules) {
      if (inst.durationLeft > 0) inst.durationLeft = 0;
      dropSourceMods(inst);
    }
    const arr = sidesOf(side);
    const i = arr.indexOf(u);
    if (i >= 0) {
      arr.splice(i, 1);
      refreshSideSize(side);
    }
  }

  /* ---------- 统一目标系统 ---------- */
  const policies = { ally: 'order', enemy: 'order' };
  // 单位级策略：ship.policy 有效则用它覆盖全队策略；否则跟随全队
  const policyOf = (ship) =>
    ship.policy && TARGET_POLICIES.includes(ship.policy) ? ship.policy : policies[ship.side] || 'order';
  /** 设置某船的自动目标策略（ship 对象或 id）；kind=null → 跟随全队。即时清除旧自动粘性目标。 */
  function setShipPolicy(ship, kind) {
    if (!ship) return false;
    if (kind && !TARGET_POLICIES.includes(kind)) return false;
    ship.policy = kind || null;
    for (const inst of ship.modules || []) inst._stick = undefined; // 策略变化即时生效
    return true;
  }

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
    // —— 自动目标"粘性"：无任何手动锁定(船 targetId / 模块 unit|units)时，
    //     沿用上一轮自动已锁定的存活目标并前置；旧目标未阵亡前不切到新单位
    //     （如新召到队首的单位不会立刻被集火），旧目标丢失后才按策略选新目标 ——
    const manualLocked = !!ship.targetId || (inst.target && inst.target.mode !== 'follow');
    if (!manualLocked && Array.isArray(inst._stick) && inst._stick.length) {
      const aliveStick = inst._stick.filter((id) => uniq.some((u) => u.id === id));
      if (aliveStick.length) {
        const head = [];
        const rest = [];
        for (const u of uniq) (aliveStick.includes(u.id) ? head : rest).push(u);
        const ord = aliveStick.map((id) => head.find((u) => u.id === id)).filter(Boolean);
        uniq.length = 0;
        uniq.push(...ord, ...rest);
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

  /** 船的"当前实际目标"（供 UI 显示单位主要目标/提示）：
   * 优先手动目标；否则取首个能攻击敌方的模块的实时解析结果（moduleTargetList 含自动"粘性"，
   * 即沿用上一轮已锁定的存活目标），而不是只看目标队列队首。 */
  function shipEffectiveTarget(ship) {
    const foes = ship.side === 'ally' ? enemies : allies;
    if (ship.targetId) {
      const u = foes.find((f) => f.id === ship.targetId && f.alive);
      if (u) return u;
    }
    if (ship.modules && ship.modules.length) {
      for (const inst of ship.modules) {
        const fx = (inst.cfg && inst.cfg.effects) || {};
        const kinds = (inst.cfg && inst.cfg.target && inst.cfg.target.kinds) || [];
        const offensive = kinds.includes('enemy') || kinds.includes('any') || (fx.damage > 0);
        if (!offensive) continue; // 跳过纯增益/召唤等不攻敌的模块
        const list = moduleTargetList(ship, inst);
        if (list.length) return list[0];
      }
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

  /** 召唤类模块执行：按 fx.summon 补召一个临时单位（携带模组数量不受该单位槽限约束）
   *  - 已达该阵营该单位的"最大召唤数" → 不召唤（保持待命，有空位即补召）
   *  - 能量不足 → 不召唤
   *  - 召唤单位存在 lifespan_ticks tick，到期自动死亡；临时单位阵亡/到期后直接移出场景 */
  function doSummon(ship, inst, fx) {
    const sum = (fx.summon && typeof fx.summon === 'object') ? fx.summon : {};
    if (!sum.type) return;
    const side = ship.side;
    if (countLiveOfType(side, sum.type) >= (sum.maxSummoned || 1)) return; // 已达上限
    const cost = fx.energy_cost || 0;
    if (ship.hull.energy < cost) return; // 能量不足
    ship.hull.energy -= cost;
    // —— 用召唤模块给通用无人机"覆写模板"：attrs 按船型结构整条可覆写，缺省沿用模板 ——
    const A = (sum.attrs && typeof sum.attrs === 'object') ? sum.attrs : {};
    const ov = {
      ...(A.nameKey ? { nameKey: A.nameKey } : {}),
      ...(A.base && typeof A.base === 'object' ? { base: A.base } : {}),
      ...(A.coefficients && typeof A.coefficients === 'object' ? { coefficients: A.coefficients } : {}),
    };
    // temp：缺省 true（临时单位，存在时间到期自动死亡+阵亡直接移除）；
    //     设 false 则召出的是一艘普通单位（无存在时间限制，阵亡保留灰色卡片）
    const isTemp = !(sum.temp === false);
    const u = spawnSummoned(sum.type, side, ov, isTemp);
    if (isTemp) u.tempLeft = (sum.lifespan_ticks || 0) > 0 ? sum.lifespan_ticks : 60;
    u.summonIcon = inst.cfg.icon || '';   // 单位图标随召唤模块图标
    u.tempNoIcon = !inst.cfg.icon;        // 模块无图标 → 单位降级 ▲
    // 显示名：模块给召唤单位显式指定名称词条(attrs.nameKey)则用之；
    // 模块未指定时才覆写为所属召唤模块名（模板 ship.drone 词条仅作缺省安全回退）。
    if (!A.nameKey) u.nameKey = inst.cfg.nameKey || u.nameKey;
    // 携带模组：等级默认 = 召唤模块等级；若 spec.level 显式给出则用之
    const mods = Array.isArray(sum.modules) ? sum.modules : [];
    for (const m of mods) {
      const spec = m && typeof m === 'object' ? m : { moduleId: m };
      const mid = spec.moduleId ?? spec.id;
      if (!mid) continue;
      const lv = spec.level ? spec.level : (inst.level || 1);
      installModule(u, mid, lv, true); // force：不受该单位模块槽上限约束
    }
    u.hull.shield = u.hull.shieldCap; // 满盾登场（同 spawnList 逻辑）
    // 继承模块所属船舰的自动策略与该船当前目标：策略覆盖随母船；首击与母船攻击同一目标，之后按其策略
    if (ship.policy) u.policy = ship.policy; // ship.policy 为空=跟随全队（召唤物同默认）
    const parentTarget = shipEffectiveTarget(ship);
    if (parentTarget && parentTarget.alive) {
      for (const inner of u.modules) {
        const ifx = (inner.cfg && inner.cfg.effects) || {};
        const ikinds = (inner.cfg && inner.cfg.target && inner.cfg.target.kinds) || [];
        const off = ikinds.includes('enemy') || ikinds.includes('any') || (ifx.damage > 0);
        if (off) inner._stick = [parentTarget.id];
      }
    }
    inst.cooldown = fx.cooldown_ticks ?? 1;
    battleLog(
      'battle.log.summon',
      {
        ship: uTok(ship),
        unit: uTok(u),
        module: i18n.t(inst.cfg.nameKey),
      },
      ['ship', 'unit']
    );
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

    // —— 召唤类模块：无目标，走召唤执行（fx.summon 存在时）——
    if (fx.summon && typeof fx.summon === 'object' && fx.summon.type) {
      doSummon(ship, inst, fx);
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
                battleLog('battle.log.destroyed', { ship: uTok(target) }, ['ship']);
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
      const typeArr = fx.type || [];
      if (typeArr.includes('ramp_by_enemy_count')) {
        // —— type 钩子 ramp_by_enemy_count：单次伤害随“当前场上敌方存活数”提升（不随时间累积）——
        //    伤害 = 基础 damage + ramp_per_hit × 当前敌方存活数；有 max_damage 则封顶。
        //    敌方阵亡越多，单发伤害越低。 ——
        const foes = ship.side === 'ally' ? enemies : allies;
        let foeCount = 0;
        for (const f of foes) if (f.alive) foeCount += 1;
        const hasMax = (fx.max_damage || 0) > 0;
        const rawBonus = baseRaw + (fx.ramp_per_hit || 0) * foeCount;
        effRaw = hasMax ? Math.min(fx.max_damage, rawBonus) : rawBonus;
      } else {
        // —— type 钩子 ramp_full：仅当“目标选择的所有槽位都有目标”才逐击增伤；
        //    目标未满时（如 dualLaser 只命中 1/2）不成长，伤害维持基础 ——
        const needFull = typeArr.includes('ramp_full');
        let canRamp = true;
        if (needFull) {
          const reqCount = Math.max(
            1,
            (inst.cfg.target && inst.cfg.target.maxCount) || targets.length
          );
          canRamp = targets.length >= reqCount;
        }
        if (canRamp) {
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
      }
    }
    const effDmg = effRaw * coeff(ship, inst.cfg.category);
    for (const target of targets) {
      // —— 词条执行器：依据 effects 中的词条对每个选定目标同时生效 ——
      if ((fx.damage || 0) > 0) {
        const dmg = effDmg;
        const dealt = damageShip(target, dmg);
        dmgTotal += dealt;
        battleLog(
          'battle.log.fire',
          {
            actor: uTok(ship),
            target: uTok(target),
            dmg: Math.round(dealt),
          },
          ['actor', 'target']
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
    // 持久化自动目标（粘性）：无手动锁定时记住本次实际命中的目标，下次沿用存活者
    const autoLocked =
      !ship.targetId && (!inst.target || inst.target.mode === 'follow');
    if (autoLocked && targets.length) inst._stick = targets.map((t) => t.id);
    inst.lastDmg = dmgTotal;       // 本次激活造成的总伤害（供"本场贡献/本击"实时显示）
    inst.lastShield = shieldTotal; // 本次激活恢复的总护盾
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
        battleLog('battle.log.autoTarget', { ship: uTok(ship) }, ['ship']);
      }
      for (const inst of ship.modules) {
        const t = inst.target;
        if (!t) continue;
        if (t.mode === 'unit') {
          if (!aliveId(t.id)) {
            inst.target = { mode: 'follow' };
            battleLog(
              'battle.log.moduleFollow',
              { ship: uTok(ship), module: i18n.t(inst.cfg.nameKey) },
              ['ship']
            );
          }
        } else if (t.mode === 'units') {
          const kept = (t.ids || []).filter(aliveId);
          if (kept.length !== (t.ids || []).length) {
            if (!kept.length) {
              inst.target = { mode: 'follow' };
              battleLog(
                'battle.log.moduleFollow',
                { ship: uTok(ship), module: i18n.t(inst.cfg.nameKey) },
                ['ship']
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
    // 敌方先行动，我方后行动（先手规则占位，M2 细调）。
    // 用 slice() 副本迭代：本次召唤/移除单位不干扰本轮遍历。
    for (const s of enemies.slice()) if (s.alive) for (const inst of s.modules.slice()) activate(s, inst);
    for (const s of allies.slice()) if (s.alive) for (const inst of s.modules.slice()) activate(s, inst);
    // —— 临时(召唤)单位生命周期：存在时间逐 tick 递减，到期自动死亡；
    //     临时单位阵亡/到期后直接移出场景（普通单位仍保留灰色卡片）——
    for (const side of ['ally', 'enemy']) {
      for (const u of sidesOf(side).slice()) {
        if (!u.temp) continue;
        if (u.alive) {
          u.tempLeft -= 1;
          if (u.tempLeft <= 0) {
            u.hull.hp = 0;
            u.alive = false;
            battleLog('battle.log.tempExpired', { ship: uTok(u) }, ['ship']);
          }
        }
        if (!u.alive) removeSummoned(side, u);
      }
    }
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
    setShipPolicy,
    setAllyPolicy(kind) {
      if (!TARGET_POLICIES.includes(kind)) return false;
      policies.ally = kind;
      for (const s of allies) if (!s.policy) for (const inst of s.modules) inst._stick = undefined;
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
