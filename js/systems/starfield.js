/* ===== systems/starfield.js —— ★ 星域容器（步骤 B-2） =====
 * 设计依据：`战场大地图(星域)说明.md` §1「总体结构与单 tick 流程」、§8「结束与最终结算」、§10 阶段 B。
 *
 * 职责：
 *   ① 用 **A-5 生成器**（`data/starfield.js generateStarfield`）产出星域初始状态（配置 + 种子 ⇒ 确定、可复现）；
 *   ② 为**每个星区**创建一个**独立 battle 实例**（`systems/battle.js startBattle(..., {starfield:true})`）——
 *      单位用生成结果的**引擎编队口径** `{type, level, modules}`（`side` 决定入 ally 还是 enemy），
 *      货物用**同形实例数组**喂给星区货物规范化口径（`normalizeSectorCargos`，经 `sector.cargos` 设定项）；
 *      ★ **不复制、不共享**任何实例间状态（每个实例的战报/单位/星区/货物都是自己的闭包私有变量）；
 *   ③ 持有**星域自身持续时间**并驱动 tick 循环（固定顺序 = `sectors[]` 索引序 ⇒ 确定可复现）；
 *   ③b ★ **玩家单位入场（容器构造时一次性完成，不新增运行时逻辑）**：
 *      把星域配置的 **`playerUnits[]`**（我方初始编队，与 NPC 列表 `units[]` 同构）按既有编队口径
 *      `{type, level, modules}` 注入**入场星区**的 **allies**（我方）；入场星区＝`gen.playerEntryIndex`
 *      （判定唯一口径 `data/starfield.js resolvePlayerEntryIndex`：`sideRules.playerEntryTypeId`
 *      → 回退第一个 `placement.mode:'edges'` 星区 → 仍无 ⇒ `#1`）；**不改引擎战斗逻辑**；
 *   ④ **跨星区阶段**占位（`crossSectorPhase`，本轮空实现，仅留调用点与接口）；
 *   ⑤ **结算入口预留**（`settle()`；时间耗尽时自动调用一次）。
 *
 * ★ 单 tick 流程（与文档 §1 逐条对应）：
 *   ① 星域层推进持续时间（`runTicks += 1`；剩余 = `durationTicks - runTicks`）；
 *   ② 按 **`sectors[]` 索引序（固定顺序）** 依次 `step()` 每个星区
 *      （各区内部结算全序不变：`3 → 3b → 3c → 3d-1…3d-5 → 4 → Phase B/B2 → 5 → C`）；
 *   ③ **跨星区阶段**（`crossSectorPhase(starfield)`，本轮空实现）；
 *   ④ `runTicks >= durationTicks` ⇒ **所有星区停止运行（不再 step）** 并进入**结算入口** `settle()`。
 *   ★ **任何星区都不执行「一方全灭即结束」**：`starfield` 模式下 battle 实例内部**不调用** `checkEnd()`
 *     （判定代码保留在 `battle.js` 中、只是不执行；星区无单位时**静默空转、仍走 tick**）。
 *
 * ★ 只读口径（**供 C-1 地图 / C-2 侧栏使用；UI 只读、绝不自算**）：
 *   · `starfield.sectors`      ⇒ 逐区摘要数组（**每次读取返回新数组 + 新对象**，与 `battle.sector` 同体例）：
 *     `{ index, q, r, typeId, isStar, placement:{mode,edges}, alive:{ally,enemy}（存活单位数）,
 *        ore（当前剩余储量）, oreInit（初始储量）, cargoCount（当前货物件数）, cargoInit（★ 货物**初始**件数）,
 *        cd（星区侧冷却：模块 id → 剩余 tick）,
 *        hasEvent（**最近推进的那一 tick 内是否产生过战报**）, logLines（累计战报条数）, phase }`；
 *   · `starfield.battleOf(index)` ⇒ 该星区的 **battle 实例**（C-2 侧栏用它渲染完整战斗场景）；
 *   · `starfield.runTicks / remainingTicks / durationTicks / finished / stopped / settled`；
 *   · `starfield.configId / seed / radius / generation（A-5 原始生成结果，只读）/ warnings`；
 *   · ★ `starfield.playerEntryIndex`（**玩家单位入场星区**的只读下标，显示编号＝下标+1）
 *     与 `starfield.playerUnitCount`（注入的玩家单位数）——口径见文件头「玩家单位入场」；
 *   · `starfield.summary()` ⇒ 星域级只读摘要（含各类型星区数、敌我存活合计、货物合计、告警）。
 *
 * ★ 确定性与性能：本文件**不含任何随机数/时间戳**（种子只经 A-5 生成器；
 *   `step()` 只按固定顺序调用各区既有 `step()`）；星区间本轮**无相互影响** ⇒ 天然确定可复现。
 */
import { generateStarfield, expandUnitSpecs } from '../data/starfield.js';
import { getStarfield } from '../data/starfields/index.js';
import { createRng } from '../core/rng.js';
import { startBattle } from './battle.js';

/** ★ **③ 跨星区阶段**（**占位接口 · 本轮空实现**）：后续轮次在此实装
 *  「星区间移动推进 / 抵达入场 / 跨区资源汇总 / 跨区相互作用」等（设计文档 §1 结构图末项、§9 非目标 1/5）。
 *  · 调用时机＝每 tick 在**全部星区 step 完成之后**、时间耗尽判定之前（见 `createStarfield.step`）；
 *  · 本轮**不读不写任何状态**（纯空函数）⇒ 不产生任何数值/事件影响，仅固化调用点与签名。 */
export function crossSectorPhase(starfield) {
  void starfield; // 占位：本轮空实现（保留形参以便后续实装）
}

/** 生成结果的单位条目 → **引擎编队条目**（`{type, level, modules}`；剥离星域层附加字段 `side`）。 */
function formationOf(units) {
  return (Array.isArray(units) ? units : [])
    .filter((u) => u && u.type)
    .map((u) => ({
      type: u.type,
      level: u.level,
      modules: (Array.isArray(u.modules) ? u.modules : []).map((m) => ({ moduleId: m.moduleId, level: m.level })),
    }));
}

/** 生成结果的货物实例 → **星区货物设定项**（`CargoSpec`：`{templateId, tons, level}`）。
 *  ★ 数量口径：引擎的 `normalizeSectorCargos` **一件设定项展开 1 个实例**（`count` 缺省 1）
 *    ⇒ 逐件转换成 1 条设定项即可，id 由引擎按**该星区自己的顺序**重新编号（`cargo-1..N`，确定性、可复现）。
 *  （⇒ 星区内部的货物 id 与**其它星区无关**，不受别的星区货物件数变化影响。） */
function cargoSpecsOf(cargos) {
  return (Array.isArray(cargos) ? cargos : [])
    .filter((c) => c && c.templateId)
    .map((c) => ({ templateId: c.templateId, tons: c.tons, level: c.level }));
}

/** ★ 解析配置对象（id 或对象；**与 A-5 生成器同一认可范围**：生成器已先抛错，这里只做取值） */
function configOf(configOrId) {
  if (configOrId && typeof configOrId === 'object') return configOrId;
  return getStarfield(configOrId) || {};
}

/** ★ **玩家单位列表 → 我方编队条目**（`{type, level, modules}`；字段＝星域配置 `playerUnits[]`）：
 *  · 与 NPC 列表 `units[]` **同构**：`{ shipId, count | countRange:[min,max], level?, modules?:[{moduleId,level?}] }`
 *    ⇒ 展开走**唯一口径** `data/starfield.js expandUnitSpecs`（**不自写第二套**）；
 *  · **数量**：`count` 固定值（推荐）；`countRange` 亦支持 ⇒ 用**独立子流** `createRng(seed).fork('playerUnits')`
 *    抽取（**不消耗**星域生成流/星区内容流 ⇒ 版图与 NPC 内容零影响；同种子完全确定）；
 *  · **阵营恒为我方**（调用方把结果并入目标星区的 `allies`）；`side` 字段不在本函数的产物里。
 *  ★ 不修改配置对象（`expandUnitSpecs` 逐条深拷贝）。 */
function expandPlayerUnits(cfg, seed) {
  const units = cfg && Array.isArray(cfg.playerUnits) ? cfg.playerUnits : [];
  if (!units.length) return [];
  const rng = createRng(seed).fork('playerUnits'); // ★ 独立子流（core/rng.js）
  return expandUnitSpecs(units, rng);
}

/**
 * ★ 创建星域（容器）：**配置（或 id） + 种子 ⇒ 可运行的星域**。
 * @param {string|object} configOrId 星域配置 id（如 `'h1'`）或配置对象（同 A-5）
 * @param {string|number} [seed] 种子；省略 ⇒ 取 `config.seed`；**都缺 ⇒ 抛错**（生成器内不回落随机）
 * @returns 星域容器（只读口径 + `step()` / `settle()` / `stop()` / `summary()`）
 */
export function createStarfield(configOrId, seed) {
  const gen = generateStarfield(configOrId, seed); // ★ A-5（纯函数；同配置同种子 ⇒ 结果完全一致）
  const warnings = (gen.warnings || []).map((w) => ({ ...w }));
  const durationTicks = Math.max(0, gen.durationTicks | 0);

  /* ★ **玩家单位入场**（用户口径）：
   *   · 入场星区＝生成结果的只读派生 `gen.playerEntryIndex`（判定唯一口径＝`resolvePlayerEntryIndex`：
   *     `sideRules.playerEntryTypeId` → 回退「第一个 `placement.mode:'edges'` 星区」→ 仍无 ⇒ `#1`）；
   *   · 玩家单位按**既有编队口径** `{type, level, modules}` 并入该星区的 **allies**（我方）；
   *   · 判定与展开都**不改星区内容、不消耗星域随机流**（独立子流 `fork('playerUnits')`）⇒
   *     同配置同种子 ⇒ 入场星区与编队完全确定；无 `playerUnits` ⇒ 与改造前逐字节一致（零回归）。 */
  const playerUnits = expandPlayerUnits(configOf(configOrId), gen.seed);
  const playerEntryIndex = Number.isInteger(gen.playerEntryIndex) ? gen.playerEntryIndex : -1;

  // 内部条目：星区元数据 + **该区专属的 battle 实例**（实例间零共享）
  const entries = [];
  for (const s of gen.sectors) {
    const units = Array.isArray(s.units) ? s.units : [];
    const allies = formationOf(units.filter((u) => u.side === 'ally'));
    const enemies = formationOf(units.filter((u) => u.side !== 'ally')); // 缺省/未标 side ⇒ 敌方（契约见 `sideRules.npcSide`）
    // ★ 玩家单位**只进「入场星区」的我方编队**（置于队首＝玩家自己的舰队优先；不改引擎任何规则）
    if (playerUnits.length && s.index === playerEntryIndex) {
      allies.unshift(...playerUnits.map((u) => ({ type: u.type, level: u.level, modules: u.modules.map((m) => ({ ...m })) })));
    }
    const entry = startBattle(
      { allies, enemies, sector: { oreReserve: s.ore, cargos: cargoSpecsOf(s.cargos) } },
      { starfield: true } // ★ 星域星区模式：允许空编队 + 不订阅全局 ticker/不发全局事件 + 战报只进本实例 + 不执行全灭判定
    );
    if (!entry.ok) {
      // 防御性兜底：星域星区模式下 `startBattle` 不会返回失败（空编队亦合法），此处仅记录不中断
      warnings.push({ code: 'sectorBattleFailed', index: s.index, error: entry.error || null });
      continue;
    }
    for (const w of entry.warnings || []) warnings.push({ ...w, index: s.index }); // 编队/货物规范化的钳制告警（带星区 index）
    const battle = entry.battle;
    battle.start(); // 进入 running（星域模式：不订阅全局 ticker、不发 combat:state）
    entries.push({
      index: s.index,
      q: s.q,
      r: s.r,
      typeId: s.typeId,
      isStar: s.isStar,
      placement: s.placement,
      battle,
      // ★ **该区货物「初始件数」**（用户口径：地图货物进度条的分母）：来源＝**A-5 生成结果里该区 `cargos` 的长度**
      //   （＝引擎按 `normalizeSectorCargos` 规范化后得到的初始件数，与开战时的初始列表**同一份口径**）。
      //   `ore` 的初始值走 `battle.sector.oreReserveInit`（引擎快照），货物侧对称地在此固定记录一次。
      cargoInit: Array.isArray(s.cargos) ? s.cargos.length : 0,
      lastLogTotal: battle.logTotal, // 事件判据基准（见 `hasEvent`）
      hasEvent: false,
    });
  }

  let runTicks = 0;
  let stopped = false; // 手动停止（不结算）
  let finished = false; // 时间耗尽（自动结算）
  let settled = false;
  let settleResult = null;
  // ★ 星域级「全队主要目标」的**唯一持有处**（初始 'order' ＝ 引擎 `createBattle` 的默认档）
  let fleetPolicy = 'order';

  const aliveCounts = () => {
    let ally = 0;
    let enemy = 0;
    for (const e of entries) {
      for (const u of e.battle.units()) {
        if (!u.alive) continue;
        if (u.side === 'ally') ally += 1;
        else enemy += 1;
      }
    }
    return { ally, enemy };
  };

  /** 逐区只读摘要（每次调用返回**新数组 + 新对象**；UI 只读、不自算） */
  function sectorSummaries() {
    return entries.map((e) => {
      const snap = e.battle.sector; // ★ 只读快照口径（与战斗屏同一份：名称/储量/冷却/货物）
      let ally = 0;
      let enemy = 0;
      for (const u of e.battle.units()) {
        if (!u.alive) continue;
        if (u.side === 'ally') ally += 1;
        else enemy += 1;
      }
      return {
        index: e.index,
        q: e.q,
        r: e.r,
        typeId: e.typeId,
        isStar: e.isStar,
        placement: { mode: e.placement.mode, edges: e.placement.edges ? e.placement.edges.slice() : null },
        alive: { ally, enemy },
        ore: snap.oreReserve,
        oreInit: snap.oreReserveInit,
        cargoCount: snap.cargos.length,
        cargoInit: e.cargoInit, // ★ 该区**货物初始件数**（只读、引擎派生；与 `oreInit` 对称）
        cd: { ...snap.cd },
        hasEvent: e.hasEvent,
        logLines: e.battle.logTotal,
        phase: e.battle.phase,
      };
    });
  }

  /** 星域级只读摘要（控制台 `LS.starfield.summary()` / 结算占位 / C-3 预览都用它） */
  function summary() {
    const list = sectorSummaries();
    const byType = {};
    let cargoTotal = 0;
    let eventCount = 0;
    for (const s of list) {
      byType[s.typeId] = (byType[s.typeId] || 0) + 1;
      cargoTotal += s.cargoCount;
      if (s.hasEvent) eventCount += 1;
    }
    return {
      configId: gen.configId,
      seed: gen.seed,
      radius: gen.radius,
      durationTicks,
      runTicks,
      remainingTicks: Math.max(0, durationTicks - runTicks),
      finished,
      stopped,
      settled,
      layout: { ...gen.layout },
      sectorCount: list.length,
      sectorTypes: byType,
      alive: aliveCounts(),
      cargoTotal,
      eventSectors: eventCount,
      warnings,
    };
  }

  /** ★ **结算入口（本轮仅预留）**：时间耗尽时自动调用一次；只产出**只读汇总占位对象**，
   *  不产生任何 UI/存档副作用（内容与形式待定 ⇒ 设计文档 §8/§9）。后续轮次在此实装正式结算。 */
  function settle() {
    if (settled) return settleResult;
    settled = true;
    const s = summary();
    settleResult = {
      todo: true, // ★ 占位标记：正式结算内容待定（本轮只预留接口 + 汇总数据出口）
      configId: s.configId,
      seed: s.seed,
      runTicks: s.runTicks,
      durationTicks: s.durationTicks,
      sectorCount: s.sectorCount,
      sectorTypes: s.sectorTypes,
      alive: s.alive,
      cargoTotal: s.cargoTotal,
      warnings: s.warnings,
    };
    return settleResult;
  }

  const api = {
    configId: gen.configId,
    seed: gen.seed,
    radius: gen.radius,
    durationTicks,
    /** ★ A-5 **原始生成结果**（只读参考；只读用途：C-3 预览/导出、调试对拍）——容器不修改它 */
    generation: gen,
    /** ★ **玩家单位入场星区**（只读下标；判定口径见 `data/starfield.js resolvePlayerEntryIndex`；
     *  显示编号 ＝ 下标 + 1；`-1` ＝ 无星区可入场）；UI **只读本字段、不自算** */
    playerEntryIndex,
    /** ★ 已注入的**玩家单位数量**（我方编队条目数；`0` ＝ 本星域未配置玩家单位） */
    playerUnitCount: playerUnits.length,
    /** 星域级告警（A-5 截断告警 + 编队/货物规范化告警，后者带 `index`） */
    warnings,
    get runTicks() {
      return runTicks;
    },
    get remainingTicks() {
      return Math.max(0, durationTicks - runTicks);
    },
    /** 时间是否耗尽（耗尽 ⇒ 不再 step、并已进入结算入口） */
    get finished() {
      return finished;
    },
    /** 是否被手动 `stop()`（不结算） */
    get stopped() {
      return stopped;
    },
    get settled() {
      return settled;
    },
    /** 结算结果（未结算 ⇒ null；已结算 ⇒ 占位对象，见 `settle()`） */
    get settleResult() {
      return settleResult;
    },
    /** ★ 逐区只读摘要（每次读取返回新数组/新对象） */
    get sectors() {
      return sectorSummaries();
    },
    /** ★ 取某星区的 **battle 实例**（C-2 侧栏用；未知 index ⇒ null） */
    battleOf(index) {
      const e = entries.find((x) => x.index === index);
      return e ? e.battle : null;
    },
    /**
     * ★ **推进星域时间**（默认 1 tick；唯一驱动入口）——严格按文档 §1 的流程：
     *   ① `runTicks += 1` → ② 固定顺序逐区 `step()` → ③ 跨星区阶段 → ④ 时间耗尽 ⇒ 停止 + 结算。
     * @param {number} [n] 推进 tick 数（非正整数 ⇒ 不推进）
     * @returns {{ ok:boolean, reason?:string, ticks:number, runTicks:number, remainingTicks:number,
     *             finished:boolean, stopped:boolean, settled:boolean }}
     */
    step(n = 1) {
      if (stopped) return { ok: false, reason: 'stopped', ticks: 0, runTicks, remainingTicks: Math.max(0, durationTicks - runTicks), finished, stopped, settled };
      const want = Math.floor(Number(n));
      const ticks = Number.isFinite(want) && want > 0 ? want : 0;
      let done = 0;
      for (let k = 0; k < ticks; k += 1) {
        if (finished) break;
        // ① 星域层推进持续时间
        runTicks += 1;
        // ② 按 sectors[] 索引序（固定顺序）依次 step 每个星区；顺带刷新“本区最近一 tick 有无事件”
        for (const e of entries) {
          e.battle.step();
          const total = e.battle.logTotal;
          e.hasEvent = total > e.lastLogTotal;
          e.lastLogTotal = total;
        }
        // ③ 跨星区阶段（本轮空实现）
        crossSectorPhase(api);
        done += 1;
        // ④ 时间耗尽 ⇒ 所有星区停止运行（不再 step）并进入结算入口
        if (runTicks >= durationTicks) {
          finished = true;
          settle();
        }
      }
      return {
        ok: true,
        ticks: done,
        runTicks,
        remainingTicks: Math.max(0, durationTicks - runTicks),
        finished,
        stopped,
        settled,
      };
    },
    /** ★ 手动停止（不再 step；**不结算**） */
    stop() {
      stopped = true;
      return { ok: true, runTicks, remainingTicks: Math.max(0, durationTicks - runTicks), finished, stopped };
    },
    /** ★ 结算入口（时间耗尽时自动调用；也可手动调用 ⇒ 手动调用会置 `settled` 但不改 `finished`） */
    settle,
    /** ★★ **星域级「全队主要目标」**（用户口径：星域模式下**全队唯一**，跨所有星区统一）——
     *  · **单一来源＝本容器**（`fleetPolicy`，取值同既有唯一实现 `battle.setAllyPolicy` 的合法值域）；
     *  · 各星区实例**不各自持有一份 UI 状态**：读走本 getter，写走下面的 `setFleetPolicy()`；
     *  · **镜像对等**：`setFleetPolicy` 用**引擎既有唯一接口** `entry.battle.setAllyPolicy(kind)` 把同一值
     *    下发给**每个**星区实例（scalar 赋值 + 各实例自重置 `_stick`）⇒ 各实例 `allyPolicy` 恒等于本值；
     *  · **不影响确定性**：不引入任何遍历顺序依赖（各实例独立赋值，与 `sectors[]` 索引序无关），
     *    目标链实现（`orderedFoes(foes, policies[side])`）**一字未改**。 */
    get fleetPolicy() {
      return fleetPolicy;
    },
    /** 修改星域级「全队主要目标」⇒ 立即对**所有**星区生效（返回是否被引擎接受） */
    setFleetPolicy(kind) {
      let ok = false;
      for (const e of entries) ok = e.battle.setAllyPolicy(kind) || ok; // ★ 唯一接口；顺序无关
      if (ok) fleetPolicy = kind;
      return ok;
    },
    /** ★ 星域级只读摘要 */
    summary,
  };
  return api;
}

export default createStarfield;
