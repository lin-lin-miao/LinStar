/* ===== main.js —— 启动引导 =====
 * 顺序：载入存档 -> 设置语言 -> 挂载路由/HUD -> 显示菜单 -> 启动 tick -> 自动保存
 * 调试：window.LS（M0.8）
 */
import { bus } from './core/eventBus.js';
import { el } from './core/utils.js';
import { ticker } from './core/tick.js';
import { log } from './core/log.js';
import { i18n } from './i18n/index.js';
import { save } from './systems/save.js';
import { router } from './ui/router.js';
import { hud } from './ui/hud.js';
import { menuView } from './ui/menuView.js';
import { starfieldConfigView } from './ui/starfieldConfigView.js';
import { starfieldMapView } from './ui/starfieldMapView.js';
import { baseView } from './ui/baseView.js';
import { getStarfield, setStarfield, ensureStarfield } from './ui/starfieldSession.js';
import { battleView } from './ui/battleView.js';
import { createRng, hashSeed, randomSeed, rngSelfTest } from './core/rng.js';
import * as starfieldData from './data/starfieldData.js';
import { generateStarfield, previewStarfield, starfieldGenSelfCheck } from './data/starfield.js';
import { createStarfield, starfieldMoveSelfCheck } from './systems/starfield.js';
import { battleSelfCheck } from './systems/battle.js';
import * as baseSystem from './systems/base.js';
import * as expedition from './systems/expedition.js'; // ★ M3d：出征 / 返回闭环的唯一编排层

const AUTOSAVE_MS = 10_000; // 每 10 秒自动保存一次

function boot() {
  // 1. 存档与语言
  save.load();
  i18n.set(save.settings.locale || 'zh-CN');
  document.documentElement.lang = i18n.locale;

  // 2. 路由与视图
  router.mount(document.getElementById('app-screen'));
  router.register('menu', menuView);
  // ★ S0-1：「星域配置界面」（占位页，C-3 正式实装）
  //   ★★ M3a 修订（用户口径）：**主菜单只保留「主基地」一个入口** ⇒
  //      本路由**不再有 UI 入口**（仅测试用控制台 `LS.goto('starfield')` 可进入）。
  router.register('starfield', starfieldConfigView);
  // ★ C-1：星域大地图（只读视图 + 缩放平移 + 点击选中；完整战斗侧栏＝C-2）
  //   入口＝星域配置界面（同为测试路径）或控制台 `LS.goto('starfieldMap')`；屏内"返回"回主菜单。
  router.register('starfieldMap', starfieldMapView);
  router.register('battle', battleView);
  // ★ M3a：主基地屏（左列表 + 右面板 + 顶部资源栏；业务面板属 M3b~M3e，本轮为骨架）
  router.register('base', baseView);

  // 3. 顶栏
  hud.mount(document.getElementById('app-header'));

  // 4. 首屏与时钟
  router.show('menu');
  ticker.start();

  // 5. 全局事件接线
  bus.on('i18n:changed', ({ locale }) => {
    save.settings.locale = locale;
    document.documentElement.lang = locale;
    save.persist();
    router.repaint();
  });

  bus.on('save:imported', () => {
    // 导入档可能携带不同语言设置
    if (i18n.set(save.settings.locale || 'zh-CN')) {
      document.documentElement.lang = i18n.locale;
    }
    router.show(router.current || 'menu');
  });

  bus.on('save:import-error', ({ err }) => {
    // eslint-disable-next-line no-alert
    window.alert(err === 'busy' ? i18n.t('save.importBusy') : i18n.t('save.importError', { err }));
  });

  // 6. 自动保存
  setInterval(() => save.persist(), AUTOSAVE_MS);
  window.addEventListener('beforeunload', () => save.persist());

  // 7. 调试控制台
  attachDebug();

  log.info('LinStar M1.9 启动完成');
}

/* ===== window.LS 调试控制台（M0.8） ===== */

/** ★ 主基地调试：改动资源后，若当前就在基地屏则**立即重绘**（否则只在下次进入时体现） */
function repaintBase(result) {
  if (router.current === 'base') router.repaint();
  return result;
}

function attachDebug() {
  window.LS = {
    version: '0.5-m1.9',
    state: () => save.data,
    goto: (name) => router.show(name),
    tick: {
      get count() { return ticker.count; },
      get tps() { return ticker.tps; },
      pause: () => ticker.pause(),
      resume: () => ticker.resume(),
      step: () => ticker.step(),           // 暂停下逐帧推进一帧
      setSpeed: (v) => ticker.setSpeed(v),
    },
    // 战斗状态模拟（供测试 HUD 与存档门控；M1 起由 battle.js 自动广播）
    combat: {
      on: () => bus.emit('combat:state', { active: true }),
      off: () => bus.emit('combat:state', { active: false }),
      get active() { return save.combatActive; },
    },
    i18n: {
      set: (loc) => i18n.set(loc),
      get locale() { return i18n.locale; },
    },
    save: {
      now: () => save.persist(),
      export: () => save.export(),
      reset: () => { save.reset(); router.show('menu'); },
      raw: () => JSON.stringify(save.exportData(), null, 2),
    },
    log: {
      dump: () => log.dump(),
      clear: () => log.clear(),
    },
    // ★ 进入战斗（**唯一开战入口**的调试入口）：与演练界面「开战」/结算「再战」走同一函数，
    //   便于在不点界面的情况下用控制台验证编队数据/关卡入口。
    //   例：LS.battle.start({ allies:[{type:'combat',level:5}], enemies:[{type:'transport'}] })
    battle: {
      start: (formation) => battleView.enterBattle(formation),
      leave: () => battleView.leaveBattle(),
      get current() { return window.__battle || null; },
      // ★ **B-1 自检**：`battle.js` 可实例化 / 实例间零共享（两实例并行 step、战报隔离、全灭不结束、空编队…）
      selfCheck: () => battleSelfCheck(),
    },
    // ★★ **主基地**（M3a：基地状态 + 五资源账户；业务面板属 M3b ~ M3e，本轮只有骨架）。
    //   用法：`LS.base.snapshot()`   ⇒ 基地只读快照（资源 / 建筑等级 / 左列表项）
    //        / `LS.base.state`      ⇒ 基地**状态本体**（唯一来源；调试可读，正常只经下面的 debug 改动）
    //        / `LS.base.list()`     ⇒ 只读清单摘要（控制台核对）
    //        / `LS.base.selfCheck()`⇒ `{pass, checks[]}`（注册表 / 校验与扣减 / 零硬编码 / i18n 成对 …）
    //        / `LS.base.debug.gain({ energy: 100 })`  ⇒ 加资源（返回 `{ ok, gained, overflow }`；
    //                                                    **按上限截断**，超出部分进 `overflow`）
    //        / `LS.base.debug.spend({ energy: 100 })` ⇒ 扣资源（不足 ⇒ `{ ok:false, reason:{resource,need,have} }`，
    //                                                    **状态零改动**）
    //        / `LS.base.debug.caps()`                 ⇒ 资源上限只读快照（来源＝配置：初始上限 + 建筑 effect.resourceCap）
    //        / `LS.base.debug.remaining('energy')`    ⇒ 该资源还能加多少
    //        / `LS.base.debug.reset()`                ⇒ 重置基地（回到 `data/baseConfig.js` 的初始状态）
    //        / `LS.base.debug.buildings()`            ⇒ 建筑只读清单
    //   ★ 在基地屏上执行 debug 改动会**自动重绘**该屏（不是在基地屏则只改状态）。
    //   ★ 数值一律来自配置文件：控制台**不需要**、也**不提供**任何数值调整入口。
    //   ★ 界面文案里**不出现**任何控制台/命令说明（调试入口只在本文件）。
    //   ★★ **舰队（M3b）**：舰队＝"抽象配置条目 + 数量"（不是逐艘实例）。
    //        / `LS.base.fleet.stats()`        ⇒ `{ capacity, total, out, remaining, scrapRefundRatio }`
    //        / `LS.base.fleet.configs()`      ⇒ 逐条配置只读视图（造价 / 拆解预览 / 槽位 / 能力标记）
    //        / `LS.base.fleet.preview({shipId:'combat', level:1, modules:[{moduleId:'cannon'}]})`
    //                                         ⇒ 干跑校验 + 造价（**不改状态**；界面表单同口径）
    //        / `LS.base.fleet.create({name, shipId, level, modules})` ⇒ 新建（同配置**合并**、重名自动 `#N`）
    //        / `LS.base.fleet.clone(id, { level: 2 })`                ⇒ 编辑＝**另存为新配置**（原条目保留）
    //        / `LS.base.fleet.rename(id, '名字')` / `.remove(id)`      ⇒ 重命名 / 删除（**仅** 0 艘且无在外）
    //        / `LS.base.fleet.move(id, -1|+1)` ⇒ 上移 / 下移；`.reorder(id, 下标)` ⇒ 拖动到最终下标
    //          （顺序＝**状态数组顺序**、天然持久；越界/非法 ⇒ 零改动 + 原因 `badOrder`/`edgeMove`）
    //        / `LS.base.fleet.modulePicker()` ⇒ 模块选择弹窗的数据源（分类表 + 可装配模块清单，只读）
    //        / `LS.base.fleet.moduleCost(id, 等级)` ⇒ 该模块该等级的装配 / 拆下费用（与表格造价同源）
    //        / `LS.base.fleet.slotOp(模块数组, { action, index, moduleId, level, slots })` ⇒ 槽位增删改的**纯函数**
    //        / `LS.base.fleet.build(id, 1)` / `.scrap(id, 1)`          ⇒ 建造（扣资源）/ 拆解（按船坞比例返还）
    //        / `LS.base.fleet.costOf(id)` / `.refundOf(id, n)`         ⇒ 单艘造价 / 拆解返还**预览**（只读）
    //        / `LS.base.fleet.setOut(id, n)`  ⇒ 登记"在外"数量（M3d 出征预留；出征**不从数量里扣**）
    //          ★★ M3c ⇒ **M3d 迭代 3 语义修订**：**出战上限不再拦截**，它只是一条「**费率分界**」——
    //          `Σ out ＋ 本次新增` 可以超过上限（登记照常成功，回执给出 `remaining`（可为负）与 `over`）；
    //          **减少 `out`（含归零）不受限**（撤回永远允许 ⇒ 名额只会被释放）；
    //          ★ "超出只加价"的**收费**口径在 `LS.expedition` 侧（`dispatchPriceOf`），**登记层不收费**
    //        / `LS.base.fleet.canDeploy(id, n)` ⇒ 与 `setOut` **同一口径**的干跑校验（不改状态；
    //          只可能因入参类问题（`badOut`/`noIdle`/`unknown`）否决，**不因上限否决**）
    //        / `LS.base.fleet.maxFleet()` / `.deployUsed()` / `.deployRemaining()`
    //          ⇒ **出战名额三件套**（上限＝指挥中心该等级 `effect.maxFleet`；均为只读；
    //          ★ 迭代 3：`deployRemaining` 仍是 `max(0, 上限 − 已用)`，现在只作**显示**用）
    //   ★ 改变状态的那几个会**自动重绘**基地屏（体例同 `debug.gain`）。
    base: {
      get state() { return baseSystem.baseState; },
      snapshot: () => baseSystem.snapshot(),
      list: () => baseSystem.listBaseData(),
      selfCheck: () => baseSystem.baseSelfCheck(),
      /** ★ 舰队（M3b）：只读 API + 建造 / 拆解 / 配置管理（改动状态者 ⇒ 自动重绘基地屏） */
      fleet: {
        stats: () => baseSystem.fleetStats(),
        configs: () => baseSystem.listFleetConfigs(),
        capacity: () => baseSystem.fleetCapacityOf(),
        total: () => baseSystem.fleetTotal(),
        out: () => baseSystem.fleetOut(),
        remaining: () => baseSystem.fleetRemainingCap(),
        preview: (spec) => baseSystem.previewFleetSpec(spec),
        costOf: (id) => baseSystem.buildCostOf(id),
        canBuild: (id, n) => baseSystem.canBuild(id, n),
        refundOf: (id, n) => baseSystem.scrapRefundOf(id, n),
        build: (id, n = 1) => repaintBase(baseSystem.build(id, n)),
        scrap: (id, n = 1) => repaintBase(baseSystem.scrap(id, n)),
        create: (spec) => repaintBase(baseSystem.createFleetConfig(spec)),
        clone: (id, patch) => repaintBase(baseSystem.cloneFleetConfig(id, patch)),
        rename: (id, name) => repaintBase(baseSystem.renameFleetConfig(id, name)),
        remove: (id) => repaintBase(baseSystem.deleteFleetConfig(id)),
        setOut: (id, n) => repaintBase(baseSystem.setFleetOut(id, n)),
        /** ★ 出战名额（M3c）：上限 / 已用 / 余量（只读；读指挥中心该等级配置效果，UI 零自算） */
        maxFleet: () => baseSystem.maxFleetOf(),
        deployUsed: () => baseSystem.deployUsed(),
        deployRemaining: () => baseSystem.deployRemaining(),
        /** ★ 与 `setOut` **同口径**的干跑校验（不改状态；`n` ＝ 目标在外数） */
        canDeploy: (id, n) => baseSystem.canDeploy(id, n),
        /** ★ 排序（M3b 迭代 2 · B-3）：上移/下移（`delta` ∈ {−1,+1}）与拖动到**最终下标**；
         *  顺序**持久化在状态数组顺序里** ⇒ 快照按该顺序输出；被拒（越界/非法）时**零改动**。 */
        move: (id, delta) => repaintBase(baseSystem.moveFleetConfig(id, delta)),
        reorder: (id, toIndex) => repaintBase(baseSystem.reorderFleetConfig(id, toIndex)),
        /** ★ 模块选择弹窗的数据源（分类 + 可装配模块清单；只读，界面零自算） */
        modulePicker: () => baseSystem.modulePickerData(),
        /** ★ 某模块**某等级**的费用（二级弹窗显示用；`installCost` 与表格模块造价**同源**） */
        moduleCost: (moduleId, level) => baseSystem.moduleCostAt(moduleId, level),
        /** ★ 模块槽位编辑（草稿级**纯函数**）：`{ action:'set'|'add'|'remove', index, moduleId, level, slots }`
         *  ⇒ `{ok:true, action, index, modules}`（**新数组**，输入零改动）/ `{ok:false, reason}` */
        slotOp: (modules, op) => baseSystem.applyModuleSlot(modules, op),
      },
      debug: {
        gain: (gains) => repaintBase(baseSystem.gain(gains)),
        spend: (cost) => repaintBase(baseSystem.spend(cost)),
        canAfford: (cost) => baseSystem.canAfford(cost),
        reasonOf: (cost) => baseSystem.reasonOf(cost),
        reset: () => repaintBase(baseSystem.resetBaseState()),
        buildings: () => baseSystem.snapshot().buildings,
        /** ★ 资源**上限**只读口径（M3a 修订：上限＝配置派生；`gain` 会按上限截断） */
        caps: () => baseSystem.capsOf(),
        remaining: (key) => baseSystem.remainingCapOf(key),
        /** ★ 建筑升级（M3c：**指挥中心已实装** —— 校验资源 ⇒ 扣资源 ⇒ 等级立即 +1、效果立即生效；
         *  失败 ⇒ 零改动 + 原因码：`maxLevel` / `notAffordable` / `notImplemented` / `locked` / `unknown`。
         *  ★ 会扣资源 ⇒ 自动重绘基地屏。其余建筑仍返回"未实现"） */
        upgrade: (id) => repaintBase(baseSystem.upgradeBuilding(id)),
      },
    },
    // ★ **星域容器**（步骤 B-2：多星区独立战斗实例 + 固定顺序 tick + 星域持续时间 + 跨区阶段占位 + 结算入口预留）。
    //   用法：`LS.starfield.create('h1', 'demo')` ⇒ 创建星域（创建即各区进入 running，但**不订阅全局 ticker**）
    //        / `LS.starfield.step(20)` ⇒ 推进 20 个星域 tick（返回含 `ms`＝本次耗时毫秒，供性能核对）
    //        / `LS.starfield.summary()` ⇒ 星域级只读摘要（各区存活/储量/货物/冷却/有无事件）
    //        / `LS.starfield.stop()` ⇒ 手动停止（不结算）；`LS.starfield.current` ⇒ 当前星域句柄
    //        / `LS.starfield.current.playerEntryIndex` ⇒ **玩家单位入场星区**（只读下标，显示编号＝下标+1）
    //          与 `.playerUnitCount`（已注入的玩家单位数；口径＝`data/starfield.js resolvePlayerEntryIndex`）
    //   ★ 只读/可控：不破坏既有单星区玩法（各区实例为「星域星区模式」：不发全局事件、不写全局战报、
    //     不执行“一方全灭即结束”判定）；星域**不接管**战斗屏（UI 绑定仍由 `enterBattle` 负责）。
    starfield: {
      create(configOrId, seed) {
        setStarfield(createStarfield(configOrId, seed)); // ★ 唯一持有者＝ui/starfieldSession.js（并镜像 window.__starfield）
        return getStarfield();
      },
      step(n = 1) {
        const sf = getStarfield();
        if (!sf) return { ok: false, reason: 'none' };
        const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const r = sf.step(n);
        const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
        return { ...r, ms: Math.round((t1 - t0) * 100) / 100 }; // ★ 仅供控制台性能核对（不参与引擎状态）
      },
      summary() {
        const sf = getStarfield();
        return sf ? sf.summary() : { ok: false, reason: 'none' };
      },
      stop() {
        const sf = getStarfield();
        return sf ? sf.stop() : { ok: false, reason: 'none' };
      },
      get current() { return getStarfield(); },
      /** ★★ **单位「星区间移动」（阶段 1 引擎 + 阶段 2 UI）** —— 控制台口径（**唯一写入口** + 只读口径）：
       *  · `LS.starfield.moveUnitTo(unitId, targetIndex)` ⇒ `{ ok, queued?, cancelled?, cleared?, reason? }`
       *    （**只记账/排队，不直接搬迁**；搬迁只发生在每 tick 的跨星区阶段；**失败** `reason` ∈
       *     `'none'|'dead'|'owner'|'far'|'invalid'|'finished'`）；
       *    ★ **目标＝该单位当前所在星区 ⇒ 取消移动**（用户口径）：返回
       *      `{ ok:true, cancelled:true, cleared, reason:'cancelled' }` —— 清掉其移动指令
       *      （**本步立即取消、不再走**；冷却进度保留）；本来就没有指令 ⇒ `cleared:false`（幂等成功、不报错）；
       *    ★ **可移动性与模块无关**：任何我方常规单位**默认可移动**（`navThruster` 只是加成）；
       *    ★ **就绪即走**：单位就绪（`navRemainTicks === 0`）时下达 ⇒ **下一 tick 即完成迁移**
       *      （**不需要先充能满**）；迁移落地后再按下方公式为**下一步**重新计时（**无论是否还有后续指令**，
       *      充能照常进行）；冷却中下达 ⇒ 排队等待；
       *  · `LS.starfield.unitNav(unitId)` ⇒ `{ unitId, side, sectorIndex, navCoeff, navReadyUntil,
       *     navRemainTicks, moveQueueTargetIndex, navPath, navCdTicks, navEnergy, navEnergyPerTick,
       *     navStalled, canCommand }`（**只读、UI 不自算**；未知单位 ⇒ null）；
       *    ★ `navCoeff` ＝单位 `coefficients.nav`（与 attack/shield/mining **同族同链**，
       *      读写显示全同构；模块词条 `nav_coeff_add` 自动并入同一张表）；
       *    ★ 冷却公式：`cd = max(1, round(navCdTicks ÷ navCoeff × (1 + 时间系数)))`，
       *      其中 `navCdTicks` ＝**船型配置**的冷却基准（`data/ships/<id>.js`，**默认 200t ＝ 10 秒**，
       *      逐级可覆写）；
       *    ★ ★ **始终充能（用户口径）**：**冷却推进与“有无移动指令”无关** —— 每 tick，
       *      凡**可指挥且在充能中**（剩余 > 0）的单位都会尝试推进 1 tick，**推进即扣** `navEnergyPerTick`；
       *      · ★ `navEnergyPerTick` ＝**单位配置值**（`data/ships/<id>.js` 顶层 `navEnergyPerTick`，
       *        【占位预填 2/tick · 待用户调校】，**逐级可覆写**）—— 唯一读口径
       *        `entities/ship.js navEnergyPerTickOf(ship)`（UI 只读快照字段，**不自算**）;
       *      · 扣不起 ⇒ **不扣、该 tick 不推进**（到期 tick 顺延 1、剩余不变）且 `navStalled === true`
       *        ⇒ UI 据此显示“暂停/变色”，**不得自行比较能量**；
       *      · **充能完成后（剩余 ＝ 0）不再扣能**：就绪态零耗能、保持就绪；**就绪时的移动不再额外扣能**
       *        （这一步的充能费已在充能期间按 tick 付清）；
       *    ★ `navCdTicks`（快照里）＝本步**冻结的冷却长度**（阶段 2 进度条**分母**）；
       *      `navPath` ＝**剩余路径**的星区 index 序列（未排队 ⇒ null；阶段 2 地图描边用）；
       *      `canCommand` ＝此刻可否被指挥（阶段 2 拖拽可用性的**唯一判据**）；
       *      `navStalled` ＝**充能中且扣不起**（**不再要求“有指令”**）；
       *  · `LS.starfield.moveQueue` ⇒ 当前移动指令只读列表（每次读取返回新数组，含 `stalled`）；
       *  · `LS.starfield.moveSelfCheck()` ⇒ `{pass, checks[]}`（零回归（无单位充能中）/ **始终充能**（含
       *     “能耗＝单位配置值”）/ 阶梯路径 / 就绪即走与计时 / 公式锚点 / 顺序 / 目标变更与取消 /
       *     **整体搬迁保状态** / 外部状态清除 / 能量门控 / 异常清理 / **召唤物不随行、迁移不重复召唤、
       *     迁移后模块行为、不迁移时零回归**）。
       *  ★ ★ **召唤物口径（用户口径）**：**召唤物不随单位迁移**（留在源星区照常作战/计时）；
       *     因此**召唤上限按整个星域（跨星区）统计**（容器注入 `summonCountOf`）⇒ 单位迁到新星区后
       *     **不会重复召唤**；源区那只阵亡/到期后名额自然释放。非星域玩法不注入 ⇒ 引擎走原“本实例计数”。
       *  ★ 单位 id 取自 `LS.starfield.current.battleOf(星区index).units()`
       *    （`sectorIndex` 与显示编号的关系：编号 ＝ index + 1）。
       *  ★ 阶段 2 的 UI 入口：**星域大地图**（`#/starfieldMap`）—— 侧栏单位卡拖到地图格子即下达移动；
       *    选中单位后侧栏**跟随其跨区移动**并在图上描出其**剩余路径**；
       *    UI 只调上述唯一写入口，**不含任何自算判据**（详见 `ui/starfieldMapView.js` 文件头）。 */
      moveUnitTo(unitId, targetIndex) {
        const sf = getStarfield();
        return sf ? sf.moveUnitTo(unitId, targetIndex) : { ok: false, reason: 'none', unitId, targetIndex, queued: false };
      },
      unitNav(unitId) {
        const sf = getStarfield();
        return sf ? sf.unitNav(unitId) : null;
      },
      get moveQueue() {
        const sf = getStarfield();
        return sf ? sf.moveQueue : [];
      },
      /** ★ **阶段 1 自检**：星区间移动（逐格跨区 / 航行冷却 / 排队 / 零回归）的自动化验收 */
      moveSelfCheck: () => starfieldMoveSelfCheck(),
      /** ★ **星域级「全队主要目标」**（跨所有星区统一的**单一来源**）：
       *  · `LS.starfield.fleetPolicy` ⇒ 读当前值；`LS.starfield.setFleetPolicy('weakest')` ⇒ 改（对**所有**星区立即生效，
       *    走引擎既有唯一接口 `battle.setAllyPolicy` 下发；返回是否被引擎接受）。 */
      get fleetPolicy() {
        const sf = getStarfield();
        return sf ? sf.fleetPolicy : null;
      },
      setFleetPolicy(kind) {
        const sf = getStarfield();
        return sf ? sf.setFleetPolicy(kind) : false;
      },
    },
    // ★ **编队配置界面**（原主菜单入口已移除，改为本控制台指令；界面与开战流程零改动）。
    //   用法：`LS.drill()` ⇒ 打开「演练编队配置」屏（有对局则先经既有「离开」路径回到编队屏）。
    drill: () => battleView.enterDrill(),
    // ★ **测试用界面入口命名空间**（原 UI 入口已按用户口径全部收敛到「主基地」⇒ 只剩控制台可调）。
    //   ★ 打开星域大地图（无星域实例时用默认配置 `h1` + 随机种子兜底创建，
    //     口径见 `ui/starfieldSession.js`；C-3 起由「星域配置界面」正式提供难度/种子）。
    ui: {
      openStarfieldMap: () => {
        ensureStarfield();
        router.show('starfieldMap');
        return true;
      },
      /** ★ C-3：打开「星域配置界面」（路由 `'starfield'`）——**M3a 修订后仅测试用**（UI 无入口） */
      openStarfieldConfig: () => {
        router.show('starfield');
        return true;
      },
    },
    // ★ **确定性随机工具**（步骤 A-1；星域生成的**唯一随机源**，见 `core/rng.js`）。
    //   用法：`LS.rng.selfTest()`（最小自测）/ `LS.rng.create('demo').nextU32()`（手工对拍）
    //        / `LS.rng.randomSeed()`（默认随机种子＝唯一允许的非确定性入口）/ `LS.rng.hash('demo')`
    rng: {
      create: (seed) => createRng(seed),
      hash: (seed) => hashSeed(seed),
      randomSeed: () => randomSeed(),
      selfTest: () => rngSelfTest(),
    },
    // ★ **星域数据层**（步骤 A-2/A-3/A-4：星区类型 / NPC 列表 / 星域配置；**只读自检，不改任何数据**）。
    //   ★ 本对象与 `data/starfieldData.js` 的**导出一一对应**（体例同 `LS.rng`）⇒ 控制台可直接读写口径：
    //     `LS.starfieldData.selfCheck()` / `.list()` / `.validate(cfg)`
    //     `LS.starfieldData.getStarfield('h1')` / `.getSectorType('stargate')` / `.getNpcList('patrolLight')`
    //     `LS.starfieldData.STARFIELD_IDS` / `.SECTOR_TYPE_IDS` / `.NPC_LIST_IDS`
    //     `LS.starfieldData.STARFIELDS` / `.SECTOR_TYPES` / `.NPC_LISTS`（注册表本体，只读查看）
    //     `LS.starfieldData.readNpcListIds(x)` / `.normalizeNpcListIds(v)`
    //     （★ NPC 列表字段**数组形态**的唯一归一：`npcListIds: string[]`，兼容单值 `npcListId`）
    //     ★★ C-3b **内嵌自定义 NPC 列表**（配置根层 `npcLists`，id 以 `custom:` 开头）：
    //       `LS.starfieldData.resolveNpcList(id, cfg)`（**内置优先 → 配置内嵌 → null** 的唯一解析入口）
    //       `LS.starfieldData.getCustomNpcList(id, cfg)` / `.customNpcListIds(cfg)`
    //       `LS.starfieldData.isCustomNpcListId(id)` / `.CUSTOM_NPC_LIST_PREFIX`
    starfieldData: {
      selfCheck: () => starfieldData.selfCheck(),
      list: () => starfieldData.listStarfieldData(),
      validate: (cfg) => starfieldData.validateStarfieldConfig(cfg),
      getStarfield: (id) => starfieldData.getStarfield(id),
      getSectorType: (id) => starfieldData.getSectorType(id),
      getNpcList: (id) => starfieldData.getNpcList(id),
      resolveNpcList: (id, cfg) => starfieldData.resolveNpcList(id, cfg),
      getCustomNpcList: (id, cfg) => starfieldData.getCustomNpcList(id, cfg),
      customNpcListIds: (cfg) => starfieldData.customNpcListIds(cfg),
      isCustomNpcListId: (id) => starfieldData.isCustomNpcListId(id),
      CUSTOM_NPC_LIST_PREFIX: starfieldData.CUSTOM_NPC_LIST_PREFIX,
      readNpcListIds: (holder) => starfieldData.readNpcListIds(holder),
      normalizeNpcListIds: (v) => starfieldData.normalizeNpcListIds(v),
      STARFIELD_IDS: starfieldData.STARFIELD_IDS,
      SECTOR_TYPE_IDS: starfieldData.SECTOR_TYPE_IDS,
      NPC_LIST_IDS: starfieldData.NPC_LIST_IDS,
      STARFIELDS: starfieldData.STARFIELDS,
      SECTOR_TYPES: starfieldData.SECTOR_TYPES,
      NPC_LISTS: starfieldData.NPC_LISTS,
    },
    // ★ **星域生成器**（步骤 A-5：纯函数「配置 + 种子 ⇒ 星域初始状态」；**不调用随机默认值**）。
    //   用法：`LS.starfieldGen.generate('h1', 'demo')` ⇒ 完整星域初始状态（JSON 可往返；
    //        含只读派生 `playerEntryIndex`＝玩家单位入场星区下标）
    //        / `LS.starfieldGen.preview('h1', 'demo')` ⇒ 摘要（星区数/各类型数/货物与单位总数/告警）
    //        / `LS.starfieldGen.selfCheck()` ⇒ `{pass, checks[]}`（确定性/分区性/截断兜底等 15 项）
    starfieldGen: {
      generate: (configOrId, seed) => generateStarfield(configOrId, seed),
      preview: (configOrId, seed) => previewStarfield(configOrId, seed),
      selfCheck: () => starfieldGenSelfCheck(),
    },
    // ★ **出征 / 返回闭环**（M3d）—— 基地与星域之间**唯一的业务编排层**（`systems/expedition.js`）。
    //   界面（星门面板 / 星域地图侧栏）用的就是这一套；控制台同样只调它，**不绕过、不自算**。
    //   用法：
    //     · `LS.expedition.fronts()` ⇒ 战区（难度档）只读清单（名称、描述、半径、持续时间、单船费用
    //       `deployCost`、`activateUnits` 与 `activateCost`＝激活费、★ 迭代 3 的超出加价费率 `overQuota`、付得起？）
    //     · `LS.expedition.totals([{id:'c1',n:2}])` ⇒ 装配纯汇总（出战上限 / 已在外 / 本次派遣 / 余量）
    //     · `LS.expedition.preview(specs, { starfieldId:'h1' })` ⇒ 干跑
    //       （**不改状态**；失败码见 `FLEET_REASON_CODES`：`emptyDeploy`/`tooMany`/`noIdle`/`notAffordable`/`fieldBusy`…
    //       ★ 迭代 3：`deployLimit` **不再是任何动作的拒绝原因**（出战上限＝**费率分界**，超出只加价）
    //       ⇒ 现在**永远**不会从这条路径返回）
    //     · `LS.expedition.launch(specs, { starfieldId:'h1', seed:'demo' })` ⇒ **激活星域**落地
    //       （扣**激活费 ＋ 随行单位的派遣费**（合并成一个总价）＋ 各配置 `out` 增加（零单位则不加）
    //        ＋ 用 `seed` 建星域；**失败 ⇒ 基地零改动**）
    //     · `LS.expedition.returnCheck(unitId)` / `LS.expedition.returnUnit(unitId)` ⇒ 主动返回（判据 / 落地；
    //       ★ 迭代 2 判据＝**星门类型**：任一星门类型星区都可返回，不在星门类型 ⇒ `notAtGate`）
    //     · `LS.expedition.settle({ mode:'sync' })` / `.settle({ mode:'end' })` ⇒ 例行 / 结束结算
    //       （**返回与损毁的唯一结算入口**；返回 ⇒ `out-1`，未返回 ⇒ `count` 与 `out` 同减；矿物入基地、
    //        货物入研究站库；★ 星域结束时仍在**星门类型**星区存活者自动返回）
    //   ★ M3d 迭代 2（用户口径七项）追加：
    //     · `LS.expedition.activate(specs, { starfieldId, seed })` ⇒ **激活星域**（创建该档星域；
    //       **允许零单位**（空星域先存在，之后再派遣）；费用＝**激活费 ＋ 随行单位的派遣费**
    //       （读配置 `data/starfields/<id>.js` 的 `activateUnits` / `deployCost` / `overQuota`）；
    //       **激活本身不占出战名额**）
    //     · `LS.expedition.launch(...)` ⇒ **兼容别名**（同上；语义已随迭代 2 变为"激活"）
    //     · `LS.expedition.unitCost(id)` / `.activateCost(id)` ⇒ 只读费用口径（单船费用 / 激活费）
    //     · `LS.expedition.view({ frontId, specs })` ⇒ 星门面板唯一数据源（★ 迭代 4：**唯一主按钮口径**
    //       `primary`：`{ mode:'activate'|'dispatch', labelKey（i18n 词条键）, ok, reason, cost }`
    //       —— 原来的 `activate` / `dispatch` 两个并列判据**已合并进 `primary`**）；
    //       另有 `unitCost`/`activateUnits`/`activateCost`/`cost`（★ 迭代 3：**合并求和后的一个总价**）
    //       /`price`（`normal`/`over`/`remaining`/`rate`；★ 迭代 4：**界面不再显示分界说明行**，
    //       但引擎数据照旧保留，供自检与后续 M4 使用）；`mode:'activate'|'dispatch'`；
    //       ★ `cardLimit` **已删除**（上限不再限制可选艘数）；契约里**没有星域编号**、也**没有任何提示文字键**）
    //     · `LS.expedition.selfCheck()` ⇒ `{pass, checks[]}`（M3d 共 **25 项**：原有 18 项 ＋ 迭代 2 的 6 项
    //       ＋ 迭代 3 的 1 项「出战上限＝费率分界」＋ 迭代 4 的契约改写，见各 `add(...)` 的名字）
    expedition: {
      fronts: () => expedition.listBattlefronts(),
      cycleTier: (frontId, step) => expedition.cycleFrontId(frontId, step),
      totals: (specs) => expedition.expeditionTotals(specs),
      preview: (specs, opts) => expedition.previewExpedition(specs, opts || {}),
      view: (opts) => expedition.stargateView(getStarfield(), opts || {}),
      activate: (specs, opts) => expedition.activateExpedition(specs, opts || {}),
      launch: (specs, opts) => expedition.launchExpedition(specs, opts || {}), // ★ 兼容别名（＝activate）
      unitCost: (id) => expedition.deployCostOf(id),
      activateCost: (id) => expedition.activateCostOf(id),
      dispatch: (specs, opts) => expedition.dispatchExpedition(getStarfield(), specs, opts || {}),
      giveUpCheck: () => expedition.giveUpCheckIn(baseSystem.baseState, getStarfield()),
      giveUp: () => expedition.giveUpExpedition(getStarfield()),
      alive: () => expedition.aliveDeployedOf(getStarfield()),
      returnCheck: (unitId) => expedition.returnCheck(getStarfield(), unitId),
      returnUnit: (unitId) => expedition.settleExpedition(getStarfield(), { mode: 'unit', unitId }),
      settle: (opts) => expedition.settleExpedition(getStarfield(), opts || { mode: 'end' }),
      tick: () => expedition.tickExpedition(getStarfield()),
      selfCheck: () => expedition.selfCheck(),
    },
  };
}

/* ===== window 级错误红条（诊断用）：任何运行时报错都会显示在页面上 ===== */
function installErrorReporter() {
  function show(title, msg) {
    try {
      const box = el('div', {
        class: 'fatal-overlay',
        style:
          'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;' +
          'background:rgba(20,5,8,0.92);padding:24px;',
      });
      const panel = el('div', {
        style:
          'max-width:720px;max-height:80vh;overflow:auto;border:1px solid #ff5d6c;border-radius:12px;' +
          'background:#1a0f14;padding:18px 22px;color:#ffd7db;font:13px/1.6 Consolas,monospace;white-space:pre-wrap;',
      });
      panel.append(
        el('div', {
          style: 'font-size:16px;font-weight:700;color:#ff8a94;margin-bottom:8px;',
          text: title,
        }),
        el('div', { text: msg }),
        el('button', {
          class: 'btn small',
          style: 'margin-top:12px;',
          text: '重载 Reload',
          onclick: () => location.reload(),
        })
      );
      box.append(panel);
      document.body.append(box);
    } catch {
      // 无法渲染时保持控制台输出
    }
  }
  window.addEventListener('error', (e) => {
    show(`运行时错误 Runtime Error（${e.message || 'unknown'}）`, e.error?.stack || `${e.filename || ''}:${e.lineno || ''}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    show('未处理的 Promise 拒绝 Unhandled Rejection', String(e.reason));
  });
}

/* ===== 启动引导 ===== */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    installErrorReporter();
    boot();
  });
} else {
  installErrorReporter();
  boot();
}
