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
 *   ④ **跨星区阶段**（`crossSectorPhase`）：**单位「星区间移动」的唯一落地处**
 *      （逐格跨区搬迁 + 航行引擎冷却到期判定；见下方「星区间移动」块）；
 *   ⑤ **结算入口预留**（`settle()`；时间耗尽时自动调用一次）。
 *
 * ★ 单 tick 流程（与文档 §1 逐条对应）：
 *   ① 星域层推进持续时间（`runTicks += 1`；剩余 = `durationTicks - runTicks`）；
 *   ② 按 **`sectors[]` 索引序（固定顺序）** 依次 `step()` 每个星区
 *      （各区内部结算全序不变：`3 → 3b → 3c → 3d-1…3d-5 → 4 → Phase B/B2 → 5 → C`）；
 *   ③ **跨星区阶段**（`crossSectorPhase(容器上下文)`；单位星区间移动的**唯一落地处**）；
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
 *   · ★ `starfield.unitNav(unitId)` ⇒ **单位航行只读快照**（每次读取返回**新对象**；未知单位 ⇒ `null`）：
 *     `{ unitId, side, sectorIndex（当前所在星区 index）, navCoeff（航行系数＝coefficients.nav）,
 *        navReadyUntil（绝对到期 tick）, navRemainTicks（＝max(0, navReadyUntil − runTicks））,
 *        moveQueueTargetIndex（已下达的目标星区 index；未排队 ⇒ null）,
 *        navPath（剩余路径的星区 index 序列；未排队/不可达 ⇒ null）,
 *        navCdTicks（本条冻结的冷却长度；进度条分母）, navEnergy（当前能量）,
 *        navEnergyPerTick（**本 tick 充能能耗**：来自单位配置 `navEnergyPerTick`）,
 *        navStalled（＝**充能中**（含可指挥与未结束前提）且 `navEnergy < navEnergyPerTick`：
 *                    本 tick 无法推进冷却；**不再要求“已排队”** —— 「始终充能」口径）,
 *        canCommand（存活 且 我方 且 非召唤/临时单位：UI 据此决定可否拖拽） }`；
 *   · ★ `starfield.moveQueue` ⇒ **移动指令**只读列表（每次读取返回**新数组 + 新对象**；顺序＝下达顺序）；
 *   · ★ **写接口**：`starfield.moveUnitTo(unitId, targetIndex)` ⇒
 *     `{ ok, queued?, cancelled?, cleared?, reason? }`（见文件头）；
 *   · ★ **M3d 出征单位**：`starfield.baseUnits` ⇒ **出征单位只读汇总**（每次读取返回**新数组 + 新对象**；
 *     只含**有归属标签**的单位；条目含 `unitId / configId / ordinal / alive / sectorIndex / inEntry /
 *     hp / hpMax / shield / energy / ore / cargos[]`）＋ **唯一取回入口**
 *     `starfield.takeBackUnit(unitId, { allowDead? })` ⇒ 把单位**摘出星域**并交出**携回载荷**
 *     （`{ ok, unitId, configId, ordinal, alive, inEntry, ore, cargos, repaired }`）；**返回即修复**
 *     （满血满盾满能量、模块冷却归零；**等级与模块保留**）由 `repairForReturn` 落地；
 *     单位归属由 `createStarfield(cfg, seed, { baseRefs })` 写在**单位对象**上（`unit.baseRef`，跨区随对象走）；
 *   · ★★ **M3d 多次派遣（增援注入）**：`starfield.reinforce(list)` ⇒ 把新派遣的单位**增量并入入场星区**
 *     的我方编队（**不新建星域、不重建星区、不动既有状态**；引擎新增最小接口 `battle.reinforce()`）；
 *     仅**运行中**可注入（`finished`/`stopped`/`settled`/演出中 ⇒ 拒绝 `fieldOver`）；配套
 *     `starfield.undoReinforce(unitIds)` 供编排层"基地侧落地失败"时**原样回滚**（不带业务语义）；
 *   · ★★ **M3d 结束演出（变白）**：`starfield.beginCollapse()` ⇒ 开始演出（**幂等**；运行中拒绝 `running`）；
 *     只读口径 `starfield.collapsing / collapseElapsed / collapseDone / collapseRingTicks` 与
 *     **`starfield.whitenPlan`**（唯一顺序来源：`{ ringTicks, rings:[{ring, atTick, fromTick, toTick,
 *     sectorIndexes, count}], order, ringCount, sectorCount, totalTicks }`——环号＝`round(到中心欧氏距离)`，
 *     中心恒星在 `(0,0)` 环号 0；★ 迭代 2 每环带**起止 tick**：`fromTick ＝ atTick`（该环开始变白）、
 *     `toTick ＝ fromTick + ringTicks`（该环变满）；`totalTicks ＝ 环数 × ringTicks` **口径未变**）、
 *     `starfield.whiteSectorIndexes`（**已整环走完**的星区集合，严格由计划派生）；
 *     ★★ **迭代 2「渐变式变白」**：引擎给出**每区进度 0..1**（只读、确定、无随机），界面**只渲染不算**——
 *     · `starfield.sectorWhitenProgress(index)` ⇒ 该星区此刻的白化进度
 *       （＝`(collapseElapsed − 该环 fromTick) / ringTicks`，夹取到 `[0,1]`；**同环内所有星区并行同值**、
 *       环与环**依次**推进 ⇒ 前一环走完才轮到后一环）；
 *     · 只读快照 `starfield.sectors[].whiten` 与上者同源（`sectorSummaries()` 每个星区都带）；
 *     · ★ 语义边界：`whiteSectorIndexes` ＝ "**已达 1.0**"，`whiten`/`sectorWhitenProgress` ＝ "白到几成"；
 *     演出期间 `step()` **只推进变白进度**（不 step 任何星区 ⇒ 无 AI/攻击/事件/结算 ⇒ 零玩法副作用）；
 *     每环间隔读**星域配置字段 `collapseRingTicks`**（内置三档显式配置；缺失才用兜底常量）；
 *   · ★★ **M3d 迭代 2：返回点判据＝「星门**类型**」**：只读字段 `starfield.gateTypeId`
 *     （＝该档配置 `sideRules.playerEntryTypeId`，兜底 `data/sectorTypes` 的 `stargate.id`）与
 *     每个星区的 `isGate`（`typeId === gateTypeId`）、每个出征单位的
 *     `baseUnits[].atGate`/`sectorTypeId`（**按类型判定，不按入场下标**）—— `playerEntryIndex` 只表示
 *     **入场点**（生成器规则），**不再**作为"能否返回"的判据；
 *   · `starfield.summary()` ⇒ 星域级只读摘要（含各类型星区数、敌我存活合计、货物合计、告警）。
 *
 * ★★ 星区间移动（阶段 1 引擎 + 阶段 2 UI）★★
 *   ① **航行系数**（＝单位 `coefficients.nav`，与 attack/shield/mining **同族同链**；唯一读口径
 *      `entities/ship.js navCoeffOf(ship)` ⇒ 即既有 `coeff(ship,'nav')` ＝ `(基准 + Σ加性) × Π乘性`）：
 *      船型基础值写在 `data/ships/<id>.js` 的 `coefficients.nav`（默认 1、逐级可覆写），模块词条
 *      `nav_coeff_add` 经**既有 `_coeff_add` 后缀规则**自动并入同一张 `coeffMods` ⇒ **零特判、无第二套链路**；
 *      ★ **可移动性与模块无关**：**任何单位默认可移动**（`navCoeff` 缺省 1 ＝基础能力）；`navThruster`
 *      只是**加成**——本文件的路径/冷却/排队链路里**没有任何“必须装某模块才能移动”的判据**；
 *   ② **航行引擎冷却（唯一公式；在「迁移落地时」算一次，供下一步使用）**：
 *      `cd = max(1, round(navCdTicks ÷ navCoeff × (1 + timeCoeff)))`；
 *      · `navCdTicks` ＝**船型配置的冷却基准**（`data/ships/<id>.js` 顶层 `navCdTicks`，**默认 200t＝10 秒**，
 *        逐级可覆写；唯一读口径 `entities/ship.js navCdTicksOf(ship)`）；
 *      · `timeCoeff` ＝该单位**当前生效的** `time_coeff`（走**既有唯一取值链** `timeCoeffOf(ship)`）；
 *      · 结果写成**绝对到期 tick**：`unit.navReadyUntil = runTicks + cd`（基准＝容器 `runTicks`，
 *        模型同战斗实例的 `sectorCdUntil`）⇒ 跨星区阶段**只判到期 + 迁移**；
 *   ②i ★ **就绪即走（不要求“充能满”）**：单位**就绪**（`navRemainTicks === 0`）时下达移动 ⇒
 *      `navReadyUntil = runTicks`（**立即到期**）⇒ **下一 tick 的跨星区阶段即完成迁移**；
 *      **迁移落地后**才按上式重新计时（该冷却用于**下一步**）⇒ 进度条语义＝「**下一步就绪度**」；
 *   ②b ★★ **始终充能**（用户口径；代价＝**单位配置值** `navEnergyPerTick`
 *      【`data/ships/<id>.js` 顶层，占位 2 能量/tick · 待用户调校，**逐级可覆写**】；
 *      **充能（冷却推进）是可指挥单位的常态、与“有没有移动指令”无关** ——
 *      每 tick，凡**处于充能中**（剩余 > 0）的**可指挥**单位都尝试推进 1 tick 冷却，**推进即扣能**：
 *      · 扣得起 ⇒ 扣该单位配置的代价、冷却推进 1 tick（绝对 tick 模型下无需写任何字段：`now` 前进 1）；
 *      · **扣不起 ⇒ 不扣、该 tick 冷却不推进** ⇒ 在绝对 tick 模型下表现为**到期 tick 顺延 1**
 *        （`navReadyUntil += 1`）⇒ **剩余冷却恒不变**（＝“能量不足则不减少冷却时间”的唯一实现）；
 *      · ★ **充能完成（剩余 ＝ 0）后不再扣能**：就绪态**保持就绪、零耗能**（不会持续掉能量）；
 *        ★ 就绪时的移动**不再额外扣能** —— 这一步的“充能费”已在充能期间按 tick 付清；
 *      · **扣能范围**：**仅可指挥且在场**的单位（存活 ＋ 我方 ＋ 非召唤，与 `canCommand` 同源）；
 *        敌方 / 召唤单位**不充能、不扣能**；
 *      · **星域已结束/停止/结算**（`halted`）⇒ 阶段直接返回：**不推进、不扣能**（队列同时清空）；
 *      · 能量字段缺失/NaN ⇒ 按 0 处理（⇒ 充能暂停，**不产生 NaN/Infinity**）；
 *      · **只写 `hull.energy`**（引擎**唯一**能量字段，**不另起第二套能量系统**）；扣减只发生在
 *        **跨星区阶段**（该阶段在**全部星区 `step()` 之后**）⇒ **不在任何 Pass1/结算遍历内**；
 *      · ⚠ 该分支对“无移动指令”的单位也会**扣能量**（必要时写 `navReadyUntil`）——
 *        这是「始终充能」的**必然结果**，自检①已按新口径改写（见下）；
 *   ③ **移动规则**：一次只移动**一个星区**、只走**上下左右**相邻格；目标由玩家指定；
 *      路径＝**最短路径**（★ M3d 迭代 3：**先在现有星区图上求四方向逐格最短通路（BFS）** ⇒ 可**绕开**
 *      版图边界与不存在的格位；★ **无障碍时仍走既有「均匀阶梯」**（交替推进，对角被均匀拆开）⇒ 手感不变）；
 *      每步 |Δ|=1，且**每一步的落点都必须是 `layout` 有效格**（图上**无通路** ⇒ 该目标**不可达**，拒绝并给原因码）；
 *      **每完成一步即为下一步重新计时**（**无论是否还有后续指令** —— 充能照常进行）；
 *      剩余路径可按只读口径 `unitNav().navPath` 取（UI 只渲染）；
 *   ④ **跨区时机＝即时到区**：一步落地即把该单位**整体搬**进相邻 B 区实例 ——
 *      **不引入“航行中”中间状态**（冷却期间单位照常在本区参战）；
 *   ⑤ **排队**：冷却中仍可再次下达 ⇒ **覆盖目标、保留当前 `navReadyUntil`**（不重算已开始那一步）；
 *      就绪时下达 ⇒ **立即到期、下一 tick 即走**；之后**自动执行下一步**（玩家无需再操作）；
 *   ⑥ **异常清理**：单位死亡/被销毁 ⇒ 清其队列与冷却字段；`finished`/`stopped`/`settled` ⇒ **清空全部队列**；
 *      目标星区不存在 ⇒ 清目标并记 `reason:'invalid'`。
 *   ★ **唯一写入口**：`starfield.moveUnitTo(unitId, targetIndex)` —— **只记账/排队，不直接搬迁**；
 *   ★ **唯一落地**：本文件的 `crossSectorPhase(...)`（每 tick 在**全部星区 `step()` 之后**执行 ⇒
 *     本 tick 的迁移在**下一 tick** 才在各区生效，**与星区顺序无关**）；
 *   ★ **同 tick 多单位**：按「`sectors[]` 索引序 × 区内 `units()` 顺序 × 单位 id」**稳定排序**后依次处理
 *     —— 前两键已唯一确定次序，第三键只是形式化兜底（**与 `uid()` 的随机性无关**，不影响可复现性）；
 *   ★ **搬迁方式＝同一实例整体搬迁**（阶段 1 修订）：A 实例 `takeUnit(id)`（摘除但**保留全部自身状态**）
 *     → B 实例 `adoptUnit(unit, side)`（挂回 + 在**本实例内重绑**）。因此：
 *     · **单位身份与对象同一性不变**（`id` 不变、`===` 同一对象）；
 *     · **随对象保留**：血量/护盾（含各护盾池现值与持续期）/能量/**模块实例与自身冷却·持续期** /
 *       已装货物（`ship.cargos` 实体与 `hull.cargo`）/携带矿物（`hull.ore`）/定位与策略/目标选择；
 *     · **被清除**：**由其它单位施加的临时状态**（判据＝来源 key 是否**本单位自身模块实例 id**；
 *       含目标级上限叠加与“强制打我”来源栈）；
 *     · **不随行**：**在装（未入舱）货物**（仍是源区实体 ⇒ 解锁并留在源区）、未触发的「后触发」载荷；
 *     · **静默离区**：搬迁**不产生任何战报** —— 源区其它单位/模块指向它的**目标引用**被静默清除
 *       （等价于既有 `clearShipDeadRefs` 的清引用范围、但不播报），源区各模块**结束类战报的 n**
 *       也只统计**仍在场**的单位（离场≠阵亡；真正阵亡仍走 `onDeath`，**一字未改**）；
 *     · 目标实例内**重绑**：`__pending`、护盾池使用序 `_shieldSeq`、出场序号 `order`、上限/派生重算。
 *
 * ★ 确定性与性能：本文件**不含任何随机数/时间戳**（种子只经 A-5 生成器；
 *   `step()` 只按固定顺序调用各区既有 `step()`）；星区间本轮**无相互影响** ⇒ 天然确定可复现。
 *   ★ 跨星区阶段同样**无随机、无时间戳**：只按固定顺序读单位、只写容器自己的队列、单位的
 *   `navReadyUntil` 与 `hull.energy`（能量门控）⇒ 同配置＋同种子＋同操作序列 ⇒ 结果完全一致。
 */
import { generateStarfield, expandUnitSpecs } from '../data/starfield.js';
import { getStarfield } from '../data/starfields/index.js';
import { createRng } from '../core/rng.js';
import { startBattle } from './battle.js';
// ★ 星区间移动的**唯一取值链**：航行系数、冷却基准与时间系数都走 `entities/ship.js` 的既有只读口径
//   （本文件**不自算**这些系数，只把它们代进航行冷却公式）。
import { navCoeffOf, timeCoeffOf, navCdTicksOf, navEnergyPerTickOf } from '../entities/ship.js';
// ★ **仅供 `starfieldMoveSelfCheck` 造沙盒/注入“外部施加的临时状态”用**（注册表驱动、**不硬编码
//   星区类型 id**；正式代码路径**不使用**这几个导入）：
//   · 星区类型注册表：自检要把配置覆写成“只留填充类型”的小版图；
//   · `set*Mod`：自检按**既有唯一落地入口**给单位写入“自身来源 / 外部来源”两种修饰，用于验证
//     「迁移只清外部来源」这一条（引擎侧同源实现见 `battle.js clearForeignMods`）。
import { SECTOR_TYPE_IDS, getSectorType, STARGATE_TYPE_ID } from '../data/sectorTypes/index.js';
import { setCoeffMod, setTimeCoeffMod, setStealthMod, setDamageTakeMulMod } from '../entities/ship.js';
// ★ M3d：返回时**携回**的矿物 / 货物走单位既有只读口径（本文件**不自己数货仓**）
import { oreLoadOf, cargoListOf } from '../entities/ship.js';

/** ★★ M3d **结束演出（变白）每环间隔的兜底值**（tick）：
 *  · **唯一来源仍是配置**（星域配置字段 `collapseRingTicks`，内置三档均已显式写 20）；
 *  · 本常量只在「配置没写 / 写了非法值」时兜底（例如控制台临时构造的自定义配置），
 *    ⇒ 运行期**不参与**内置三档的任何计算（数值仍在配置文件里调）。 */
const DEFAULT_COLLAPSE_RING_TICKS = 20;

/** ★ **③ 跨星区阶段**（**唯一落地处**）：推进**航行引擎充能**（冷却）＋把**已下达的移动指令**推进一格。
 *
 *  ★ 口径（与文件头「星区间移动」逐条对应）：
 *   · 调用时机＝每 tick 在**全部星区 `step()` 完成之后**、时间耗尽判定之前（见 `createStarfield.step`）
 *     ⇒ **本 tick 的迁移在下一 tick 才在各区生效**，与星区处理顺序无关；
 *   · ★★ **始终充能**（用户口径）：**不要求“有移动指令”** —— 每 tick，凡**可指挥且在充能中**
 *     （`navRemainTicks > 0`）的单位都会尝试推进 1 tick 冷却；**推进即扣该单位配置的能耗**：
 *       · 扣得起 ⇒ 扣费、冷却推进（绝对 tick 模型下＝什么都不用写：`now` 前进 1 即“剩余减 1”）；
 *       · 扣不起 ⇒ **不扣、不推进** ⇒ 到期 tick 顺延 1（剩余不变、`navStalled` 为真）；
 *     · **充能完成（`navRemainTicks === 0`）后不再扣能**（就绪态零耗能、保持就绪）；
 *   · **一步一格**：每 tick 每个单位至多迁移 1 个星区；**迁移落地后立即开始下一次充能**
 *     （`navReadyUntil = runTicks + cd`，cd 取该单位当刻的 `navCoeff`/`timeCoeff`）
 *     —— **无论是否还有后续指令**（口径 3）；
 *   · ★ **召唤物不随行**：本函数只搬迁**下达指令的那一个单位**（`takeUnit`/`adoptUnit` 只动它的阵营数组
 *     成员身份），**绝不触碰也不带走任何召唤物**；留在源星区的召唤物**照常存活/计时**，且其占用的
 *     召唤上限由容器注入的**星域范围计数**（`countSummonsAcross`）继续计入 ⇒ 迁移后不会重复召唤；
 *   · **只判到期 + 迁移，绝不重算**（`navReadyUntil` 与 `navCdTicks` 都是冻结值，本函数只读它们）。
 *  ★ 入参＝**容器上下文**（由 `createStarfield` 构造并传入，字段见该处 `crossCtx` 的注释）：
 *   它同时提供容器私有状态（`entries` / 队列 / 时钟）与搬迁实现（`moveUnitAcross`），
 *   **不进任何 UI 只读口径**。本函数是**唯一**执行搬迁的地方（唯一写入口 `moveUnitTo` 只记账）。
 *  @param {object} sf 星域容器上下文（见 `createStarfield` 的 `crossCtx`）
 */
export function crossSectorPhase(sf) {
  if (!sf || !Array.isArray(sf.entries)) return; // 防御：非容器上下文（既有调用点恒传上下文）
  // ⑥ 停止/结束（`finished` / `stopped` / `settled`）⇒ **清空全部队列**（不再执行任何移动）。
  //    （正常路径下 `stop()`/`settle()` 已就地清空；这里是同一口径的兜底，幂等、零副作用。）
  //    ★ 同时**不再推进任何单位的充能**（也不扣能）—— 见 `isCharging()` 的 halted 判据。
  if (sf.halted) {
    if (sf.navQueue.size) sf.navQueue.clear();
    return;
  }
  // ★ **本 tick 的处理顺序（唯一口径）**：`sectors[]` 索引序 × 区内 `units()` 顺序 × 单位 id。
  //   前两键已唯一确定次序（同一 ~(星区, 区内下标) 不可能出现两次），第三键只是形式化兜底
  //   ⇒ **与 `uid()` 的随机性无关**、完全确定可复现。
  const items = [];
  for (let si = 0; si < sf.entries.length; si += 1) {
    const e = sf.entries[si];
    const us = e.battle.units();
    for (let ui = 0; ui < us.length; ui += 1) items.push({ si, ui, e, u: us[ui] });
  }
  items.sort((a, b) => a.si - b.si || a.ui - b.ui || cmpUnitId(a.u.id, b.u.id));
  const now = sf.runTicks;
  for (const it of items) {
    const { e, u } = it;
    // ⑥ 死亡/被销毁 ⇒ 清其队列与冷却字段（与容器读数口径无关，纯清理；不产生告警，避免死亡刷屏）
    if (!u.alive) {
      if (sf.navQueue.has(u.id)) sf.navQueue.delete(u.id);
      u.navReadyUntil = 0;
      u.navCdTicks = 0;
      continue;
    }
    // ② ★★ **始终充能（唯一处）** —— 与“有无移动指令”完全解耦：
    //    · 判据 `isCharging(sf, u)` ＝ **可指挥（我方·非召唤）** 且 **冷却尚未走完**
    //      （`navReadyUntil >= runTicks`，**含“恰好走完”的那一 tick**）且 **星域未结束**；
    //      （`alive` 已在上方判过；敌人/召唤单位**不充能、不扣能**）
    //    · 扣得起 ⇒ 扣能量（`hull.energy`，引擎唯一能量字段）⇒ 冷却推进 1 tick（`now` 已前进 ⇒ 剩余 -1）；
    //    · 扣不起 ⇒ **不扣、不推进** ⇒ 绝对 tick 模型下＝**到期 tick 顺延 1**（剩余恒不变）；
    //    · **已就绪**（`navReadyUntil < runTicks`，即充能已完成的后续 tick）**根本不进这个分支**
    //      ⇒ **零耗能、保持就绪**（口径 2：充能完成后不再扣能）；
    //    · 付费发生在**全部星区 step() 之后**（本阶段），**不在任何 Pass1/结算遍历内** ⇒ Pass1 零数值变化；
    //    · 本分支对“无指令单位”的**唯一写操作**＝扣能量（以及扣不起时的 `navReadyUntil += 1`）
    //      ⇒ 它是「始终充能」口径的必然结果（自检①已按新口径改写）。
    const until = Math.max(0, u.navReadyUntil || 0);
    if (isCharging(sf, u)) {
      if (!navPayEnergy(u)) {
        u.navReadyUntil = until + 1; // ★ 能量不足：到期顺延 1（剩余不变、不扣能量）
        continue;
      }
    }
    // —— 以下只与「已下达的移动指令」有关：无指令 ⇒ 本 tick 到此为止（充能已处理完毕）——
    if (!sf.navQueue.has(u.id)) continue;
    const target = sf.navQueue.get(u.id);
    const dest = sf.entryByIndex.get(target);
    // ⑥ 目标星区不存在 ⇒ 清目标并记 `reason:'invalid'`（阶段 1 中星区集合恒定，
    //   故正常路径不会触发；保留为防御性口径，与 `moveUnitTo` 的返回值同一套 reason 词表）
    if (!dest) {
      dropNavTarget(sf, u, 'invalid');
      continue;
    }
    if (dest.index === e.index) {
      sf.navQueue.delete(u.id); // 已在本区（例如目标区就是出发区）：清目标，无需搬迁
      continue;
    }
    if (now < until) continue; // 尚未充能完成 ⇒ 本 tick 不迁移（只读冻结值，绝不重算）
    // ③ 一步：**移动路径**（无障碍＝均匀阶梯；被边界/空位挡住＝图上最短通路 绕行）的**第一格**
    const nextIndex = navNextStepOf(sf, e.index, target);
    if (nextIndex == null) {
      dropNavTarget(sf, u, 'far'); // **图上无通路**（四方向都到不了）⇒ 与 `moveUnitTo` 的 'far' 同一判据
      continue;
    }
    const nextEntry = sf.entryByIndex.get(nextIndex);
    if (!nextEntry) {
      dropNavTarget(sf, u, 'invalid');
      continue;
    }
    // ★ 跨实例搬迁（**同一实例整体搬迁**：A 摘取 → B 收编）；失败 ⇒ 清目标与冷却（单位留在原区）
    const moved = sf.moveUnitAcross(e, nextEntry, u);
    if (!moved.ok) {
      dropNavTarget(sf, u, moved.reason || 'none');
      u.navReadyUntil = 0;
      u.navCdTicks = 0;
      continue;
    }
    const nu = moved.unit; // ★ 与 `u` **同一对象**（阶段 1 修订：同一实例搬迁，不重建）
    // ③ 迁移落地后按 `navCdTicks`（船型配置）**重新计时**（用于**下一步**；取值链＝当刻 navCoeff/timeCoeff）
    const nextCd = navCooldownOf(nu);
    nu.navReadyUntil = now + nextCd;
    nu.navCdTicks = nextCd;
    if (nextEntry.index === target) sf.navQueue.delete(nu.id); // 已抵达目标 ⇒ 队列清空（否则保留，自动续走）
  }
  // ⑥ 队列里指向“已不在场”的单位（如临时召唤物到期移出场景）⇒ 清掉残留指令（幂等）
  for (const id of [...sf.navQueue.keys()]) if (!sf.findUnitEntry(id)) sf.navQueue.delete(id);
}

/** 同 tick 处理顺序的**形式化兜底键**（单位 id 升序；见 `crossSectorPhase` 的顺序说明） */
function cmpUnitId(a, b) {
  const x = String(a == null ? '' : a);
  const y = String(b == null ? '' : b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/* ---------- ★ 星区间移动：路径与冷却（纯函数 / 纯读取，唯一实现） ---------- */

/** ★ **航行能量门控（唯一实现）**：为“本 tick 引擎冷却推进 1 tick”付费；能为 ⇒ 扣费并返回 `true`。
 *  · ★ **代价来自单位配置**：`navEnergyPerTickOf(unit)`（`data/ships/<id>.js` 顶层 `navEnergyPerTick`，
 *    【占位预填 2/tick · 待用户调校】，**逐级可覆写**）—— 本文件**不再持有任何能耗常量**
 *    （唯一默认值 `NAV_ENERGY_DEFAULT_PER_TICK` 在 `entities/ship.js` 一处定义，供配置缺失时回落）；
 *    语义：能量 ≥ 代价 ⇒ 扣代价、冷却推进 1 tick；否则 ⇒ **不扣、且该 tick 冷却不推进**
 *    （剩余冷却不变 ⇒ 到期 tick 顺延 1）。`代价 ＝ 0` 合法（＝免费充能，恒能推进）。
 *  · 只写 `unit.hull.energy`（引擎**唯一**能量字段，**不另起第二套能量系统**）：引擎的常规回能/耗能
 *    照旧由战斗结算（`applyEnergyTo`）管理，本函数只做**一次扣减**（在**全部星区 step() 之后**的
 *    跨星区阶段，故不在任何 Pass1/结算遍历内 ⇒ Pass1 零数值变化、与星区结算顺序无关）；
 *  · 能量字段缺失/NaN ⇒ **按 0 处理**（⇒ 充能暂停，绝不产生 NaN/Infinity）；扣减后钳到 ≥ 0；
 *  · 调用点只有一个：`crossSectorPhase` 内**处于充能中的可指挥单位**的冷却推进处
 *    （**不要求有移动指令**；就绪单位不会被调用 ⇒ 零耗能）。 */
function navPayEnergy(unit) {
  const h = unit && unit.hull;
  if (!h) return false;
  const cost = navEnergyPerTickOf(unit); // ★ 单位配置值（唯一读口径；缺省回落默认常量）
  const cur = Number.isFinite(h.energy) ? h.energy : 0;
  if (cur < cost) return false; // 扣不起 ⇒ 不扣、冷却不推进
  h.energy = Math.max(0, cur - cost);
  return true;
}

/** ★★ **「充能中」的唯一判据**（跨星区阶段的「是否扣能/推进」与 UI 的「是否暂停」**共用同一个函数**）：
 *  `充能中 ⇔ 星域未结束 且 该单位可指挥（我方 · 非召唤 · 存活） 且 冷却**尚未走完**
 *   （`navReadyUntil >= runTicks`，**含恰好走完的那一 tick**）`。
 *  · **含“恰好走完”的那一 tick**：该 tick 冷却仍在推进（剩余 1 → 0）⇒ **照样付费**；
 *    至此一步的充能费 ＝ **cd 次**（与旧口径的付费次数一致，自检⑧的算例不变）；
 *    下一 tick 起 `until < runTicks` ⇒ 不再进本判据 ⇒ **零耗能、保持就绪**（用户口径：充能完成后不再扣能）；
 *  · **星域已结束/停止/结算**（`sf.halted`）⇒ `false`：阶段直接 return，不推进、不扣能；
 *  · **不可指挥**（敌方 / 召唤·临时单位）⇒ `false`：**不充能、不扣能**
 *    （与 `moveUnitTo` 的 `'owner'`、`unitNav().canCommand` 同源，绝不为“不受玩家控制”的单位扣能量）；
 *  · **从未充能**（`navReadyUntil === 0`）且 `runTicks ≥ 1` ⇒ `false` ⇒ 就绪单位零耗能；
 *  · 参数 `sf` ＝容器上下文 `crossCtx`（其 `runTicks` / `halted` 都是 getter ⇒ 恒读当前值）。
 *  @returns {boolean} */
function isCharging(sf, unit) {
  if (!sf || !unit || !unit.alive) return false;
  if (sf.halted) return false;
  if (unit.side !== 'ally' || unit.isSummon) return false;
  return Math.max(0, unit.navReadyUntil || 0) >= sf.runTicks;
}

/** ★ **航行引擎冷却（唯一公式，唯一实现）**：
 *  `cd = max(1, round(navCdTicks ÷ navCoeff × (1 + timeCoeff)))`。
 *  · `navCdTicks` ＝ **船型配置的冷却基准**（`data/ships/<id>.js` 顶层 `navCdTicks`，**默认 200t ＝ 10 秒**；
 *    逐级可覆写）——唯一读口径 `entities/ship.js navCdTicksOf(ship)`，本文件不自算；
 *  · `navCoeff` / `timeCoeff` 都走 `entities/ship.js` 的**既有只读口径**（`navCoeffOf` / `timeCoeffOf`）；
 *    `navCoeff` 已并入 `coefficients.nav`，与其它类别系数**同一条链**（`(基准 + Σ加性) × Π乘性`）；
 *  · `navCoeff ≤ 0`（极端数据/尚未调校的占位值）⇒ 按 `1` 处理，**不产生 NaN/Infinity**；
 *  · **调用时机只有一处**：「每完成一步、迁移落地时」（给**下一步**重新计时）。**结算阶段不再另行计算**。
 *  @returns {number} 冷却 tick 数（≥1 的整数） */
function navCooldownOf(unit) {
  const baseCd = navCdTicksOf(unit); // 船型配置基准（缺省 200；读函数已保证为正数）
  const c = Number(navCoeffOf(unit));
  const safe = Number.isFinite(c) && c > 0 ? c : 1; // 防御：非法/非正 ⇒ 按默认 1 处理
  const t = Number(timeCoeffOf(unit)) || 0;
  return Math.max(1, Math.round((baseCd / safe) * (1 + t)));
}

/** ★ **均匀阶梯路径（无障碍时的首选口径）**：从 `from` 到 `to` 的**最短路径「均匀阶梯」序列** ——
 *  **交替推进（Bresenham/DDA 式误差累计）**：每一步都在 q 与 r 之间选**当前相对进度“落后”的那个轴**前进，
 *  于是整条路径呈**均匀阶梯**，而不再是“先走完一个轴、再走另一个轴”的直角折线；
 *  · 每步仍只前进 **1 格且只沿一个轴**（`|Δq| + |Δr| = 1`、**绝不斜走**），步数恒 ＝ 曼哈顿距离（最短）；
 *  · **取向规则（写死、无浮点、确定性）**：设 `aq ＝ |Δq|`、`ar ＝ |Δr|`、`qDone/rDone` ＝已推进的步数，
 *    每步比较「再走一格 q 后的相对进度」与「再走一格 r 后的相对进度」——
 *      `(qDone + 1) * ar ≤ (rDone + 1) * aq` ⇒ **走 q**；否则走 r。
 *    ★ **对角（`aq === ar`）时上式取等 ⇒ 一律“先 q”** ⇒ 对角路径呈严格交替 `q, r, q, r, …`；
 *    ★ 某一轴已到位（`aq` 或 `ar` 为 0）⇒ 余下全部走另一个轴。
 *  · 逐格取 `layout` 有效格（＝**已生成的星区**；不存在 ⇒ 本步无格 ⇒ 本函数判为**不可用**，交 `navPathOf` 兜底）；
 *  · 起点＝目标 / 任一端不存在 ⇒ `null`。
 *  @returns {number[]|null} 逐格**星区 index**（**不含起点**，末项＝目标）；不可用 ⇒ `null`
 *  ★ 本函数**只负责"无障碍的均匀阶梯"**；"被边界挡住怎么绕"由 `navPathOf` 交给 `bfsPathOf`（见下）。 */
function stairPathOf(sf, from, to) {
  const out = [];
  let q = from.q;
  let r = from.r;
  const aq = Math.abs(to.q - q); // 需推进的 q 步数
  const ar = Math.abs(to.r - r); // 需推进的 r 步数
  const sq = Math.sign(to.q - q);
  const sr = Math.sign(to.r - r);
  let qDone = 0;
  let rDone = 0;
  const steps = aq + ar; // 最短步数（曼哈顿距离）＝循环次数上界（天然防死循环）
  for (let i = 0; i < steps; i += 1) {
    // ★ 交替规则（唯一判据）：整数交叉相乘比较两轴进度；取等 ⇒ 走 q（对角因此严格交替）
    let goQ;
    if (aq === 0) goQ = false; // q 已到位 ⇒ 只能走 r
    else if (ar === 0) goQ = true; // r 已到位 ⇒ 只能走 q
    else goQ = (qDone + 1) * ar <= (rDone + 1) * aq;
    if (goQ) {
      q += sq;
      qDone += 1;
    } else {
      r += sr;
      rDone += 1;
    }
    const idx = sf.entryIndexAtCell.get(`${q},${r}`);
    if (idx === undefined) return null; // 越出 layout 有效格 ⇒ 阶梯不可用（改走 BFS 绕行）
    out.push(idx);
  }
  if (!out.length) return null;
  return out[out.length - 1] === to.index ? out : null;
}

/** ★★ **M3d 迭代 3：图上最短通路（BFS）的邻居扩展顺序 —— 固定写死、即"平局打破"口径**：
 *  **上（r−1） → 右（q+1） → 下（r+1） → 左（q−1）**（以地图朝向为准：`ui/starfieldMapView.js` 的行号 ＝
 *  `r + R` ⇒ `r−1` 是**上一行＝上**、`q+1` 是**右**）。顺序即**方向优先级**：BFS 层序扩展时，
 *  同一层的格子按此顺序入队 ⇒ **多解（等长路径）时恒取"先上、再右、再下、再左"能探到的那条**。 */
const NAV_DIRS = [
  { dq: 0, dr: -1 }, // 上
  { dq: 1, dr: 0 }, // 右
  { dq: 0, dr: 1 }, // 下
  { dq: -1, dr: 0 }, // 左
];

/** ★★ **图上最短通路（BFS；四方向、逐格、可绕行）** —— 当「均匀阶梯」被版图边界/空位挡住时接管：
 *  · **图**＝`sf.entryIndexAtCell`（「q,r」→ 星区 index）＝**已生成的星区**（**唯一版图口径**，不另建第二张图）；
 *    ⇒ 不存在的格位（圆外 / 越界）**不可通行**，但**可以绕开**它走别的格；
 *  · **BFS**（层序扩展）：每格**首次被发现**时记下唯一前驱 ⇒ 由目标回溯得到**一条图上最短**路径；
 *  · **确定性（同起终点恒同一条路径）**：① 邻居扩展顺序**固定**（见 `NAV_DIRS`）；② 前驱只由首次发现决定
 *    （层序 + 固定顺序 ⇒ 与遍历次数、单位 id、时间戳**全无关**）；③ 全程整数运算、**无浮点、无随机**；
 *  · **无通路**（目标不在图上 / 被隔断）⇒ `null`（与 `moveUnitTo` 的 `reason:'far'` 同一判据）。
 *  @returns {number[]|null} 逐格**星区 index**（**不含起点**，末项＝目标）；无通路 ⇒ `null` */
function bfsPathOf(sf, from, to) {
  const grid = sf.entryIndexAtCell;
  const keyOf = (q, r) => `${q},${r}`;
  const startKey = keyOf(from.q, from.r);
  const goalKey = keyOf(to.q, to.r);
  if (!grid.has(startKey) || !grid.has(goalKey)) return null; // 起点/目标不在图上 ⇒ 无通路
  const prev = new Map(); // 格键 → 前驱格键（**首次发现即固定** ⇒ 路径唯一确定）
  const seen = new Set([startKey]);
  const queue = [startKey];
  for (let head = 0; head < queue.length; head += 1) {
    const curKey = queue[head];
    if (curKey === goalKey) break; // 层序 ⇒ 首次弹出目标即为最短（其余格无需再扩展）
    const comma = curKey.indexOf(',');
    const cq = Number(curKey.slice(0, comma));
    const cr = Number(curKey.slice(comma + 1));
    for (const d of NAV_DIRS) {
      const nk = keyOf(cq + d.dq, cr + d.dr);
      if (seen.has(nk) || !grid.has(nk)) continue;
      seen.add(nk);
      prev.set(nk, curKey);
      queue.push(nk);
    }
  }
  if (!seen.has(goalKey)) return null; // 图上有目标格但**没有任何四方向通路** ⇒ 不可达
  // 回溯（防御：前驱链若断裂 ⇒ 判为无通路，绝不返回半条路径）
  const out = [];
  let cur = goalKey;
  while (cur !== startKey && prev.has(cur)) {
    out.push(grid.get(cur));
    cur = prev.get(cur);
  }
  if (cur !== startKey) return null;
  out.reverse();
  return out.length ? out : null;
}

/** ★★ **移动路径（唯一实现）**：`fromIndex → toIndex` 的**逐格星区 index 序列**（不含起点、末项＝目标）。
 *  口径（M3d 迭代 3 —— 用户：**有通路走最短路径**）：
 *  ① **无障碍（均匀阶梯全程落在有效格）⇒ 用 `stairPathOf`**（＝迭代 2 的既有一致口径 ⇒ **手感不变**）；
 *  ② 阶梯被边界/空位挡住（或目标本身是绕行才可达）⇒ **用 `bfsPathOf` 在现有星区图上绕行**（图上最短通路）；
 *  ③ 两者都不行 ⇒ `null` ＝ **无通路**（`moveUnitTo` 返回 `reason:'far'`，拒绝且零改动）。
 *  ★ **单一数据源**：引擎判据（`moveUnitTo`）、运行时逐步推进（`crossSectorPhase`）、
 *    剩余路径与地图描边（`unitNav().navPath`）**读的是同一个函数** ⇒ 三者必然一致，不存在第二套路径规则。
 *  @returns {number[]|null} 逐格**星区 index**（**不含起点**，末项＝目标）；起点＝目标 / 任一端不存在 / 无通路 ⇒ `null` */
function navPathOf(sf, fromIndex, toIndex) {
  const from = sf.entryByIndex.get(fromIndex);
  const to = sf.entryByIndex.get(toIndex);
  if (!from || !to || from === to) return null;
  const stair = stairPathOf(sf, from, to);
  return stair || bfsPathOf(sf, from, to);
}

/** 路径的**第一格**（一步推进；无通路 ⇒ `null`）—— 与 `navPathOf` **同一实现**，不再写第二套规则。 */
function navNextStepOf(sf, fromIndex, toIndex) {
  const path = navPathOf(sf, fromIndex, toIndex);
  return path ? path[0] : null;
}

/** 清掉某单位的**移动目标**并记一条结构化告警（**不改** `navReadyUntil`：已冻结的冷却照旧走完）。
 *  `reason` ∈ `'invalid'`（目标星区不存在）/ `'far'`（**图上无通路**：四方向都到不了该星区）/
 *  `'none'`（搬迁失败：源区**摘取**或目标区**收编**未成功）。 */
function dropNavTarget(sf, unit, reason) {
  sf.navQueue.delete(unit.id);
  sf.warn({ code: 'moveCancelled', unitId: unit.id, reason, tick: sf.runTicks });
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
 * @param {object} [opts] ★ M3d **出征归属**（可选；不传 ⇒ 与改造前逐字节一致）：
 *   · `opts.baseRefs` ＝ `[{ configId, ordinal }]` —— 与**展开后的玩家单位顺序一一对应**的归属标签
 *     （长度 ＝ `playerUnits` 展开后的单位数；长度不足 ⇒ 只标注能对上的前若干艘）；
 *   · 标签**写在单位对象上**（`unit.baseRef`）⇒ `takeUnit`/`adoptUnit` 的**对象同一性**让它随单位跨星区走
 *     （与 `navReadyUntil`/`summonMod` 同一体例），容器只按标签汇总，**不从 id/名字反推**。
 * @returns 星域容器（只读口径 + `step()` / `settle()` / `stop()` / `summary()`）
 */
export function createStarfield(configOrId, seed, opts = {}) {
  const gen = generateStarfield(configOrId, seed); // ★ A-5（纯函数；同配置同种子 ⇒ 结果完全一致）
  const warnings = (gen.warnings || []).map((w) => ({ ...w }));
  const durationTicks = Math.max(0, gen.durationTicks | 0);
  const baseRefs = opts && Array.isArray(opts.baseRefs) ? opts.baseRefs : [];

  /* ★ **玩家单位入场**（用户口径）：
   *   · 入场星区＝生成结果的只读派生 `gen.playerEntryIndex`（判定唯一口径＝`resolvePlayerEntryIndex`：
   *     `sideRules.playerEntryTypeId` → 回退「第一个 `placement.mode:'edges'` 星区」→ 仍无 ⇒ `#1`）；
   *   · 玩家单位按**既有编队口径** `{type, level, modules}` 并入该星区的 **allies**（我方）；
   *   · 判定与展开都**不改星区内容、不消耗星域随机流**（独立子流 `fork('playerUnits')`）⇒
   *     同配置同种子 ⇒ 入场星区与编队完全确定；无 `playerUnits` ⇒ 与改造前逐字节一致（零回归）。 */
  const playerUnits = expandPlayerUnits(configOf(configOrId), gen.seed);
  const playerEntryIndex = Number.isInteger(gen.playerEntryIndex) ? gen.playerEntryIndex : -1;

  /* ★★ **M3d 迭代 2：星门星区的类型 id（返回判据的唯一来源）**：
   *   · 优先读**本档星域配置**的 `sideRules.playerEntryTypeId`（配置驱动、逐档可覆写；见 `data/starfields/h1.js`）；
   *   · 配置未写 ⇒ 回退注册表常量 `STARGATE_TYPE_ID`（读 `data/sectorTypes/stargate.js` 的 `id` 字段）；
   *   · 用途：`isGate`（**按类型判定**，**不按下标**）：星域里可能同时存在**多个**星门星区
   *     （`h1` 1~2 个 / `h2` 1~3 个 / `h3` 2~4 个），单位在**任一**星门星区都应能"返回基地"。
   *   ★ 与 `playerEntryIndex`（**入场**星区）是**两个不同口径**：入场仍是"第一个该类型星区"（生成器规则未改），
   *     返回改为"任一该类型星区"（本条＝用户口径修复：原按下标判定 ⇒ 在其它星门星区无法返回）。 */
  const gateTypeId = (() => {
    const cfg = configOf(configOrId);
    const want = cfg && cfg.sideRules && cfg.sideRules.playerEntryTypeId;
    return want || STARGATE_TYPE_ID;
  })();

  // 内部条目：星区元数据 + **该区专属的 battle 实例**（实例间零共享）
  const entries = [];
  /** ★★ **星域范围的召唤计数**（唯一实现；供每个星区实例的 `doSummon` 上限判据使用）：
   *  统计**全部星区**中 `alive && side === side && summonMod === moduleId` 的单位数（按 `entries` 顺序累加 ⇒ 确定）。
   *  ★ 为什么：**召唤物不随单位迁移**（用户口径）⇒ 留在源星区的召唤物**必须继续占用该召唤模块的上限**，
   *    否则单位迁到新星区后本区计数为 0 ⇒ **重复召唤**（用户实测 bug）。
   *  ★ 只统计**存活**单位 ⇒ 左后召唤物阵亡/到期后**自然释放名额**（与引擎既有本实例口径同源）。
   *  ★ 纯只读、无副作用；非星域玩法（战斗屏 / `LS.drill()`）**根本不注入本钩子** ⇒ 引擎走原分支，零回归。 */
  function countSummonsAcross(side, moduleId) {
    let n = 0;
    for (const e of entries) {
      for (const u of e.battle.units()) {
        if (u.alive && u.side === side && u.summonMod === moduleId) n += 1;
      }
    }
    return n;
  }
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
      {
        starfield: true, // ★ 星域星区模式：允许空编队 + 不订阅全局 ticker/不发全局事件 + 战报只进本实例 + 不执行全灭判定
        // ★ 召唤上限按**整个星域**统计（见 `countSummonsAcross` 的说明）⇒ 迁移不会重复召唤
        summonCountOf: countSummonsAcross,
      }
    );
    if (!entry.ok) {
      // 防御性兜底：星域星区模式下 `startBattle` 不会返回失败（空编队亦合法），此处仅记录不中断
      warnings.push({ code: 'sectorBattleFailed', index: s.index, error: entry.error || null });
      continue;
    }
    for (const w of entry.warnings || []) warnings.push({ ...w, index: s.index }); // 编队/货物规范化的钳制告警（带星区 index）
    const battle = entry.battle;
    /* ★ M3d **出征归属标签**（只在入场星区、只标注玩家单位）：
     *   · 玩家编队是 `allies.unshift(...)` **置于队首**的 ⇒ 引擎 `spawnList` 按编队顺序 push
     *     ⇒ 该实例 `allies` 数组的**前 N 个**正是刚注入的玩家单位（顺序＝`playerUnits` 展开序）；
     *   · 标签是一次性写死的普通字段（不参与任何数值/判据）⇒ 无标签 ⇒ 与改造前逐字节一致（零回归）。 */
    if (baseRefs.length && s.index === playerEntryIndex) {
      const allyArr = Array.isArray(battle.allies) ? battle.allies : [];
      const n = Math.min(baseRefs.length, playerUnits.length, allyArr.length);
      for (let i = 0; i < n; i += 1) {
        const ref = baseRefs[i];
        if (!ref || typeof ref !== 'object') continue;
        allyArr[i].baseRef = { configId: ref.configId, ordinal: ref.ordinal };
      }
    }
    battle.start(); // 进入 running（星域模式：不订阅全局 ticker、不发 combat:state）
    entries.push({
      index: s.index,
      q: s.q,
      r: s.r,
      typeId: s.typeId,
      isStar: s.isStar,
      // ★ M3d 迭代 2：**本区是否星门类型**（按类型 id 判定 ⇒ 「返回基地」的星域侧唯一判据）
      isGate: !!gateTypeId && s.typeId === gateTypeId,
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

  /* ---------- ★★ M3d「结束演出（变白）」的容器状态（**只由本容器持有**）----------
   * 口径（用户定）：倒计时结束 ⇒ **先结算**（结算在 `systems/expedition.js`，与本容器无关）⇒ 关闭侧栏
   *   ⇒ **以中心恒星为起点、按「到中心的距离环」逐环变白**，每环间隔 ＝ **配置字段 `collapseRingTicks`**
   *   ⇒ 全部变白后由界面跳回主基地并清理星域。
   *  · `collapsing` ⇒ **玩法冻结**：`step()` 只推进变白进度、**不再 step 任何星区**（无 AI/攻击/事件/结算）；
   *  · 变白顺序**只由 `whitenPlan` 给出**（`beginCollapse()` 一次算好、之后只读）⇒ 界面/调用方**不自算顺序**；
   *  · 本容器**不驱动时钟**（与全仓一致：`step()` 是唯一驱动）⇒ 演出时长由调用方按 tick 推进。 */
  let collapsing = false;
  let collapseElapsed = 0; // 演出已推进 tick 数（0 ⇒ 尚未开始）
  let whitenPlan = null; // `beginCollapse()` 产出；未开始 ⇒ null
  /** ★ M3d 迭代 2：`星区 index → 所属环条目` 的查表（`beginCollapse()` 内建好 ⇒ 进度查询 O(1)） */
  let whitenRingOf = null;
  /** 配置里的每环间隔（**>0 整数**；配置缺失/非法 ⇒ 兜底常量，见 `DEFAULT_COLLAPSE_RING_TICKS`） */
  const collapseRingTicks = (() => {
    const t = configOf(configOrId) && configOf(configOrId).collapseRingTicks;
    return Number.isInteger(t) && t > 0 ? t : DEFAULT_COLLAPSE_RING_TICKS;
  })();
  /** ★ **出征归属序号的容器级计数器**（`configId → 已用最大序号`）：
   *  · 创建时由 `opts.baseRefs` 初始化（＝各配置的 1..n 序号）；
   *  · 「多次派遣」注入的新单位从这里**继续递增**（**不复用已销毁单位的序号** ⇒ 同配置内序号恒唯一、可复现）。 */
  const ordinalSeq = new Map();
  for (const r of baseRefs) {
    if (!r || typeof r !== 'object') continue;
    const id = String(r.configId == null ? '' : r.configId);
    const o = Number.isInteger(r.ordinal) ? r.ordinal : 0;
    if (!id) continue;
    ordinalSeq.set(id, Math.max(ordinalSeq.get(id) || 0, o));
  }

  /* ---------- ★ 星区间移动的容器状态（阶段 1；**只有本容器持有**）----------
   * ★ 数据结构（用户口径：「以单位 id 为键的映射或等价结构，你定并回报」）：
   *   · `navQueue: Map<单位id, 目标星区index>` —— **移动指令**（覆盖式；冷却中也保留，见文件头 ⑤）；
   *   · 单位的 `sectorIndex`（当前所在星区）**不另设缓存**：它由**星区实例里的单位数组**（唯一事实来源）
   *     即时派生（`findUnitEntry`），避免“缓存与真实归属漂移”这一整类问题；
   *   · 航行冷却 `unit.navReadyUntil` 挂在**单位自身结构**上（`entities/ship.js createShip` 已声明字段）。
   * ★ 三个容器侧入口：**写**＝`moveUnitTo`（唯一，只记账/排队）；**读**＝`unitNav` / `moveQueue`；
   *   **落地**＝模块级 `crossSectorPhase`（唯一，每 tick 在全部星区 step 之后）。 */
  const navQueue = new Map(); // 单位 id -> 目标星区 index（**唯一指令表**；无记录 ＝ 无移动指令）
  const entryByIndex = new Map(entries.map((e) => [e.index, e])); // 星区 index -> 条目
  const entryIndexAtCell = new Map(entries.map((e) => [`${e.q},${e.r}`, e.index])); // 「q,r」-> 星区 index

  /** 按**单位 id** 定位「当前所在星区条目 + 单位对象」（**唯一检索口径**；找不到 ⇒ `null`）。
   *  · 真值来源＝各星区实例的 `units()`（含双方单位）⇒ **不做缓存**、天然自愈；
   *  · 顺序＝`sectors[]` 索引序（同一 id 只可能存在于一个实例内）。 */
  function findUnitEntry(unitId) {
    for (const e of entries) {
      const u = e.battle.units().find((x) => x.id === unitId);
      if (u) return { entry: e, unit: u };
    }
    return null;
  }

  /** ★ **单位跨实例整体搬迁（一步）**：把**同一个单位对象实例**从 `fromEntry` 的实例搬到 `toEntry` 的实例。
   *  · 用**两个既有最小接口**（见 `systems/battle.js` 文件头同名说明）：
   *      ① `fromEntry.battle.takeUnit(id)` —— **摘取**：从源实例场景摘除，但**保留该单位全部自身状态**
   *         （血量/护盾/能量/模块与自身冷却·持续期/已装货物/携带矿物/定位与策略/目标选择）；只做三件清理：
   *         撤销它对**源区其它单位**的影响、作废**未触发的后触发载荷**、**清除其它单位施加给它的临时状态**；
   *      ② `toEntry.battle.adoptUnit(unit, side)` —— **收编**：挂回目标实例阵营数组并在**目标实例内重绑**
   *         （出场序号 / 护盾池使用序 / `__pending` / 上限与派生重算）。
   *  · **id 与对象同一性不变**（返回的 `unit` 与传入的 `unit` 是**同一个对象**）⇒ 容器队列、UI 选择与
   *    模块内部状态全部自然延续；**货物与矿物随对象跟着走**（不需要任何搬运代码）。
   *  · **先摘取、后收编**：摘取失败 ⇒ 源区原样不动；收编失败（理论上不会发生）⇒ 把同一实例**回挂源区**
   *    （同实例搬迁 ⇒ 可直接回挂，不丢状态、不产生副本）。
   *  @returns {{ ok:boolean, unit:object|null, reason?:string }} */
  function moveUnitAcross(fromEntry, toEntry, unit) {
    const taken = fromEntry.battle.takeUnit(unit.id);
    if (!taken.ok || !taken.unit) return { ok: false, unit: null, reason: taken.reason || 'none' };
    const adopted = toEntry.battle.adoptUnit(taken.unit, taken.unit.side);
    if (!adopted.ok) {
      fromEntry.battle.adoptUnit(taken.unit, taken.unit.side); // 回滚：同一实例挂回源区
      return { ok: false, unit: null, reason: adopted.reason || 'none' };
    }
    return { ok: true, unit: adopted.unit, reason: null };
  }

  /** ★ **跨星区阶段的容器上下文**（`crossSectorPhase` 的**唯一入参**）：
   *  只暴露该阶段需要的**容器私有状态与搬迁实现**——**不进 UI 只读口径**（避免把内部队列暴露给界面）。
   *  字段：`entries`（星区条目）、`entryByIndex` / `entryIndexAtCell`（(q,r) 与 index 的唯一映射）、
   *  `navQueue`（指令表）、`runTicks`（容器时钟，getter ⇒ 恒读当前值）、`halted`（是否已停止/结束）、
   *  `moveUnitAcross`（一步搬迁实现）、`findUnitEntry`（按 id 定位）、`warn`（结构化告警出口）。 */
  const crossCtx = {
    entries,
    entryByIndex,
    entryIndexAtCell,
    navQueue,
    findUnitEntry,
    moveUnitAcross,
    get runTicks() {
      return runTicks;
    },
    get halted() {
      return stopped || finished || settled;
    },
    warn: (w) => warnings.push(w),
  };

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
        isGate: e.isGate, // ★ M3d 迭代 2：星门类型星区（返回判据 / 侧栏按钮显隐都只读它）
        // ★ M3d 迭代 2：**该区变白进度 0..1**（演出期间线性；未演出恒 0）——界面只渲染，不自算
        whiten: sectorProgress(e.index),
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
   *  不产生任何 UI/存档副作用（内容与形式待定 ⇒ 设计文档 §8/§9）。后续轮次在此实装正式结算。
   *  ★ 按星区间移动口径 ⑥：进入结算 ⇒ **清空全部移动队列**（不再执行任何移动）。 */
  function settle() {
    if (settled) return settleResult;
    settled = true;
    navQueue.clear(); // ★ 结算 ⇒ 清空全部移动队列（`navReadyUntil` 不必清：已无队列、不再被读取）
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

  /* ---------- ★★ M3d「结束演出（变白）」：**只读计划** + 唯一推进入口 ---------- */

  /** ★ **变白计划**（`beginCollapse()` 内算出，之后**只读**）：
   *  · 环号 ＝ `Math.round(到中心的欧氏距离)`（中心恒星 `(0,0)` ⇒ 环号 0；`data/starfield.js` 生成不变量 ⑦：
   *    恒有**恰一个** `isStar` 星区且坐标 `(0,0)` ⇒ 起点确定）；
   *  · 环序 ＝ 环号**升序**（⇒ 到中心距离**单调不减**）；环内顺序 ＝ **星区 index 升序**（确定可复现）；
   *  · ★★ **M3d 迭代 2「渐变式变白」**：每环给出**起止 tick** `fromTick ＝ atTick`、`toTick ＝ atTick + collapseRingTicks`，
   *    该环的全部星区在这个区间内**并行**、**线性**从 `0` 变到 `1`（进度只读口径见 `sectorProgress`）；
   *    环与环仍**依次**推进（后一环在前一环结束后才开始）。
   *  · `totalTicks = 环数 × collapseRingTicks`（**口径未变**；末环恰好在此刻变满 ⇒ 演出随之收尾）；
   *  · `order` ＝ 全部星区的变白顺序（**无重复无遗漏**，自检 ⑥ 断言）。 */
  function buildWhitenPlan() {
    const byRing = new Map(); // 环号 -> 星区 index 数组
    for (const e of entries) {
      const ring = Math.round(Math.sqrt(e.q * e.q + e.r * e.r));
      if (!byRing.has(ring)) byRing.set(ring, []);
      byRing.get(ring).push(e.index);
    }
    const ringsAsc = Array.from(byRing.keys()).sort((a, b) => a - b);
    const rings = ringsAsc.map((ring, i) => {
      const indexes = byRing.get(ring).slice().sort((a, b) => a - b);
      const fromTick = i * collapseRingTicks;
      return {
        ring,
        atTick: fromTick, // ★ 兼容既有口径：`atTick` ＝ 该环**开始**变白的 tick
        fromTick,
        toTick: fromTick + collapseRingTicks, // ★ 该环**变满**的 tick（区间内线性 0→1）
        sectorIndexes: indexes,
        count: indexes.length,
      };
    });
    const order = [];
    for (const r of rings) order.push(...r.sectorIndexes);
    // ★ 查表：星区 index -> 环条目（进度查询 O(1)；`entries` 恒与 `order` 逐一对应）
    whitenRingOf = new Map();
    for (const r of rings) for (const idx of r.sectorIndexes) whitenRingOf.set(idx, r);
    return {
      configId: gen.configId,
      ringTicks: collapseRingTicks,
      rings,
      order,
      ringCount: rings.length,
      sectorCount: order.length,
      totalTicks: rings.length * collapseRingTicks,
    };
  }

  /** ★ **开始结束演出**（唯一入口；调用方先做完结算、关侧栏，再调本函数）：
   *  · 允许时机＝星域**已停止/已结束/已结算**（时间耗尽或手动停止）；**运行中**调用 ⇒ 拒绝（`running`）；
   *  · 幂等：已开始 ⇒ 原样返回既有计划（不重置进度、不改任何状态）；
   *  · 开始后 ⇒ **玩法冻结**：`step()` 只推进变白进度（不再 step 任何星区 ⇒ 无 AI/攻击/事件/结算），
   *    `moveUnitTo` 本就因 `finished`/`settled` 被拒（见其判据）；
   *  · 本函数**不改 `finished`/`settled`/单位/星区**，只写容器自己的演出状态。
   *  @returns `{ ok:true, plan }` / `{ ok:false, reason:{ code } }`（`running` / `collapsing` 幂等返回 ok） */
  function beginCollapse() {
    if (collapsing) return { ok: true, plan: whitenPlan, already: true };
    if (!stopped && !finished && !settled) return { ok: false, reason: { code: 'running' } };
    collapsing = true;
    collapseElapsed = 0;
    whitenPlan = buildWhitenPlan();
    navQueue.clear(); // 演出期间绝无移动（兜底；正常路径结算时已清）
    return { ok: true, plan: whitenPlan, already: false };
  }

  /** ★★ **单个星区的变白进度**（0..1；**只读、纯函数、确定性、无随机、无副作用**）——
   *  M3d 迭代 2「渐变式变白」的**唯一数据源**（界面只渲染它，**不自算**）：
   *  · 未开始演出 / 该星区不在计划里（非法 index）⇒ `0`；
   *  · 否则 `p = (collapseElapsed − 该环 fromTick) / ringTicks`，夹取到 `[0,1]`：
   *    `p ＝ 0` 尚未开始变白、`0 < p < 1` **正在变白（环内所有星区同时、线性）**、`p ＝ 1` **已纯白**；
   *  · **同输入同进度**：只依赖 `collapseElapsed` 与计划（无随机、无时间函数）⇒ 可复现、可自检。 */
  function sectorProgress(index) {
    if (!collapsing || !whitenPlan || !whitenRingOf) return 0;
    const r = whitenRingOf.get(index);
    if (!r) return 0;
    const span = Math.max(1, r.toTick - r.fromTick);
    const p = (collapseElapsed - r.fromTick) / span;
    return p <= 0 ? 0 : p >= 1 ? 1 : p;
  }

  /** 当前**已变白（进度达到 1）**的星区 index（**严格由计划派生** ⇒ 与渲染顺序不可能各算一遍；未开始 ⇒ 空数组）
   *  ★ 与 `sectorProgress` 同源：只有 `toTick ≤ collapseElapsed`（该环整段区间走完）的环才算"已变白"。 */
  function whiteIndexesNow() {
    if (!collapsing || !whitenPlan) return [];
    const out = [];
    for (const r of whitenPlan.rings) {
      if (r.toTick > collapseElapsed) break;
      for (const idx of r.sectorIndexes) out.push(idx);
    }
    return out;
  }

  /** 推进变白进度（**唯一写入口**；由 `step()` 在演出期间调用） */
  function advanceCollapse(n) {
    if (!collapsing || !whitenPlan) return;
    collapseElapsed = Math.min(whitenPlan.totalTicks, collapseElapsed + n);
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
    /** ★ 创建时注入的**玩家单位数量**（我方编队条目数；`0` ＝ 本星域未配置玩家单位）
     *  ★ M3d：**不含「多次派遣」增援注入的单位**（那是运行期增量；当前在场事实请读 `baseUnits`） */
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
    /* ---------- ★★ M3d：结束演出（变白）的只读口径 + 唯一推进入口 ---------- */
    /** 是否处于结束演出（**演出期间玩法冻结**：`step()` 只推进变白进度） */
    get collapsing() {
      return collapsing;
    },
    /** 演出已推进 tick 数（未开始 ⇒ 0） */
    get collapseElapsed() {
      return collapseElapsed;
    },
    /** 演出是否播完（全部星区已变白；`collapsing !== true` ⇒ false） */
    get collapseDone() {
      return collapsing && !!whitenPlan && collapseElapsed >= whitenPlan.totalTicks;
    },
    /** ★ **变白计划（只读）**：`{ ringTicks, rings:[{ring,atTick,fromTick,toTick,sectorIndexes,count}], order,
     *    ringCount, sectorCount, totalTicks }`；未开始演出 ⇒ `null`。
     *  ★ 界面**只读它**渲染逐环变白（顺序/时序/环内集合全部由引擎给出，UI 不自算）；
     *  ★ 迭代 2：每环带 `fromTick/toTick` ⇒ 该环在区间内**线性**由 0 变到 1（进度派生见 `sectorWhitenProgress`）。 */
    get whitenPlan() {
      return whitenPlan;
    },
    /** ★ 当前**已变白（进度＝1）**星区 index 数组（**严格由计划派生**；未开始 ⇒ `[]`） */
    get whiteSectorIndexes() {
      return whiteIndexesNow();
    },
    /** ★★ 单个星区的**变白进度 0..1**（只读、纯函数、确定性；未演出 ⇒ 0）——迭代 2「渐变式变白」的唯一数据源 */
    sectorWhitenProgress(index) {
      return sectorProgress(index);
    },
    /** ★ 本档的**星门星区类型 id**（返回判据的唯一来源；配置 `sideRules.playerEntryTypeId` → 注册表常量） */
    gateTypeId,
    /** 每环间隔（tick）——**读配置字段 `collapseRingTicks`**（配置缺失 ⇒ 兜底常量） */
    collapseRingTicks,
    /** ★ 逐区只读摘要（每次读取返回新数组/新对象） */
    get sectors() {
      return sectorSummaries();
    },
    /** ★ 取某星区的 **battle 实例**（C-2 侧栏用；未知 index ⇒ null） */
    battleOf(index) {
      const e = entries.find((x) => x.index === index);
      return e ? e.battle : null;
    },
    /* ---------- ★ M3d：出征单位的只读视图 / 取回（返回基地） ---------- */
    /** ★ **出征单位只读汇总**（**每次读取返回新数组 + 新对象**；只含**有归属标签**的单位）：
     *  条目字段见 `baseUnitViewOf`（含 `alive` / `inEntry` / 血量 / 携回矿物与货物）。
     *  · 顺序＝「`entries` 索引序 × 区内 `units()` 顺序」⇒ **确定可复现**（与随机 `uid()` 无关的次序口径，
     *    自检对拍只用 `configId`/`ordinal` 等确定字段，不比 id）。
     *  · 星域侧**只提供事实**（谁活着、在哪、带什么），"能不能返回/该销账哪些"的判据见
     *    `systems/expedition.js`（**单一实现**，容器不复制一套业务判据）。 */
    get baseUnits() {
      const out = [];
      for (const e of entries) {
        for (const u of e.battle.units()) if (u.baseRef) out.push(baseUnitViewOf(e, u, playerEntryIndex));
      }
      return out;
    },
    /** ★★ **把单位取回基地（离开星域场景）** —— 容器侧的唯一摘取入口（M3d）：
     *  · 摘取走引擎既有 `takeUnit`（**保留单位全部自身状态**；本函数随后按口径**清空携回载荷**并**修复**）；
     *  · **携回载荷随对象一起交出**：返回的 `ore` / `cargos` 就是该单位这一趟的收获
     *    （容器同时把它们从单位上清掉 ⇒ **同一份载荷只有一处来源**，不会被算第二遍）；
     *  · `opts.allowDead`（默认 false）：阵亡单位**不允许"主动返回"**（`unitDead`）——
     *    但**结束结算**要把它移出场景（损毁销账）⇒ 结算传 `true`，此时 `alive:false`、**载荷为空**
     *    （阵亡时引擎已把矿物返还星区、货物退回星区 ⇒ 不产生基地收益，符合"损毁不返还"）。
     *  @returns `{ ok:true, unitId, configId, ordinal, alive, inEntry, atGate, ore, cargos, repaired }` /
     *           `{ ok:false, reason:{ code, ... } }`（`notDeployed` / `unknown` / `unitDead` / `none`） */
    takeBackUnit(unitId, opts = {}) {
      const id = unitId === undefined || unitId === null ? '' : String(unitId);
      const found = findUnitEntry(id);
      if (!found) return { ok: false, reason: { code: 'unknown', id } };
      const u = found.unit;
      if (!u.baseRef) return { ok: false, reason: { code: 'notDeployed', id } };
      if (!u.alive && !(opts && opts.allowDead)) {
        return { ok: false, reason: { code: 'unitDead', id } };
      }
      const carry = u.alive ? carryViewOf(u) : { ore: 0, cargos: [] };
      // 先摘取（引擎侧清理到位）——失败 ⇒ 什么都不改（零改动）
      const taken = found.entry.battle.takeUnit(id);
      if (!taken.ok) return { ok: false, reason: { code: 'none', id } };
      navQueue.delete(id); // 摘取后清掉可能的移动指令（队列不留失效 id）
      if (u.alive) {
        // ★ 载荷随手带走 ⇒ 从单位上清空（避免"基地已入账、单位还挂着"的第二处账目）
        u.hull.ore = 0;
        u.cargos = [];
        u.hull.cargo = 0;
      }
      const repaired = repairForReturn(u);
      return {
        ok: true,
        unitId: id,
        configId: u.baseRef.configId,
        ordinal: Number.isInteger(u.baseRef.ordinal) ? u.baseRef.ordinal : null,
        alive: !!u.alive,
        inEntry: found.entry.index === playerEntryIndex,
        atGate: !!found.entry.isGate, // ★ 迭代 2：按**星区类型**判定的"是否在星门星区"（结算口径与 `returnCheck` 同源）
        ore: carry.ore,
        cargos: carry.cargos,
        repaired,
      };
    },
    /** ★★ **增援注入（M3d「多次派遣」的星域侧落地）** —— 把**新派遣的单位**增量并入**入场星区**的我方编队：
     *  · 时机判据：**运行中**才可增援（`finished`/`stopped`/`settled`/演出中 ⇒ 拒绝 `fieldOver`）；
     *  · 与创建时注入**同一套编队口径**（引擎新增最小接口 `battle.reinforce()`，见 `systems/battle.js`）；
     *  · **不新建星域、不重建任何星区实例、不动既有单位与星区状态**（纯追加到入场星区我方数组末尾）；
     *  · **归属标签 `baseRef` 就地写上**（`configId` ＋ 该配置**继续递增**的序号；
     *    序号计数器由创建时的 `opts.baseRefs` 初始化 ⇒ 同一配置内序号恒唯一、可复现）；
     *  · 若本星域**未配置入场星区**（`playerEntryIndex < 0`，理论上仅畸形配置）⇒ 拒绝 `noEntry`（零改动）。
     *  @param {Array<{shipId:string, count:number, level?:number, modules?:Array, configId:string}>} list
     *         「逐配置一批」的注入清单（`count` 份 ⇒ 生成 `count` 个单位；顺序＝传入顺序）
     *  @returns `{ ok:true, entryIndex, unitIds, refs }` / `{ ok:false, reason:{ code } }`
     *  ★ **落地前必须先通过业务干跑**（见 `systems/expedition.js`；本函数只做"能不能注"的容器级判据）。 */
    reinforce(list) {
      if (collapsing) return { ok: false, reason: { code: 'fieldOver', phase: 'collapsing' } };
      if (stopped || finished || settled) return { ok: false, reason: { code: 'fieldOver' } };
      const entry = entryByIndex.get(playerEntryIndex);
      if (!entry) return { ok: false, reason: { code: 'noEntry', entryIndex: playerEntryIndex } };
      const spec = Array.isArray(list) ? list : [];
      const flat = []; // 引擎编队条目（与 `startBattle` 的 allies 同构）
      const refs = []; // 与 flat **一一对应**的归属标签
      for (const it of spec) {
        if (!it || typeof it !== 'object') continue;
        const configId = it.configId == null ? '' : String(it.configId);
        const n = Number.isFinite(it.count) ? Math.max(0, Math.floor(it.count)) : 0;
        if (!configId || n <= 0) continue;
        const mods = Array.isArray(it.modules) ? it.modules.map((m) => ({ ...m })) : [];
        for (let k = 0; k < n; k += 1) {
          flat.push({ type: it.shipId, level: Number.isFinite(it.level) ? it.level : 1, modules: mods.map((m) => ({ ...m })) });
          const next = (ordinalSeq.get(configId) || 0) + 1;
          ordinalSeq.set(configId, next);
          refs.push({ configId, ordinal: next });
        }
      }
      if (!flat.length) return { ok: true, entryIndex: playerEntryIndex, unitIds: [], refs: [] };
      const added = entry.battle.reinforce(flat, 'ally');
      if (!added || !added.ok) return { ok: false, reason: { code: 'none' } };
      // ★ 归属标签：直接写在**引擎交回的新单位对象**上（`added.units` 就是本次追加的那批，顺序＝传入顺序）
      const n = Math.min(refs.length, added.units.length);
      const unitIds = [];
      for (let i = 0; i < n; i += 1) {
        const u = added.units[i];
        if (!u) continue;
        u.baseRef = { configId: refs[i].configId, ordinal: refs[i].ordinal };
        unitIds.push(u.id);
      }
      return { ok: true, entryIndex: playerEntryIndex, unitIds, refs: refs.slice(0, n) };
    },
    /** ★ **增援撤销（唯一用途：编排层"基地侧落地失败"时的回滚）**：把刚注入的单位**原样摘除**（不计账、不修复）。
     *  · 与 `takeBackUnit` 的区别：**不带任何业务语义**（不产生"返回/损毁"账目、不清载荷、不修复）；
     *  · 只摘除**有指定 id 且仍在场**的单位；找不到 ⇒ 跳过（幂等）。
     *  @returns `{ ok:true, removed:number }` */
    undoReinforce(unitIds) {
      const ids = Array.isArray(unitIds) ? unitIds : [];
      let removed = 0;
      for (const id of ids) {
        const found = findUnitEntry(String(id));
        if (!found) continue;
        const r = found.entry.battle.takeUnit(found.unit.id);
        if (r && r.ok) {
          navQueue.delete(found.unit.id);
          removed += 1;
        }
      }
      return { ok: true, removed };
    },
    /* ---------- ★ 星区间移动（阶段 1）：只读口径 + 唯一写入口 ---------- */

    /** ★ **单位航行只读快照**（**UI 只读、绝不自算**；每次读取返回**新对象**；未知单位 ⇒ `null`）：
     *  `{ unitId, side, sectorIndex, navCoeff, navReadyUntil, navRemainTicks, moveQueueTargetIndex,
     *     navPath, navCdTicks, navEnergy, navEnergyPerTick, navStalled, canCommand }`。
     *  · `sectorIndex` ＝单位**当前所在星区**的 index（由星区实例内的单位数组即时派生，**无缓存**）；
     *  · `navCoeff` ＝**航行系数**（唯一读口径 `ship.js navCoeffOf` ⇒ 即 `coefficients.nav`，与其它类别系数同链）；
     *  · `navReadyUntil` ＝航行冷却的**绝对到期 tick**；`navRemainTicks` ＝`max(0, navReadyUntil − runTicks)`
     *    （**引擎派生**：秒数换算由 UI 调 `core/tick.js formatTickSeconds`，UI 不得自己算到期）；
     *  · `moveQueueTargetIndex` ＝**已下达的目标星区 index**（未排队 ⇒ `null`）；
     *  · ★ `navPath` ＝**剩余路径的星区 index 序列**（含目标、**不含当前所在星区**；未排队/不可达 ⇒ `null`）
     *     —— 引擎按唯一路径口径算出（`navPathOf`：无障碍＝均匀阶梯 / 被挡＝图上最短通路绕行），
     *     UI **只渲染、不自算**（阶段 2 地图描边用；★ 迭代 3 起描边自然反映绕行结果，UI 代码未变）；
     *  · `navCdTicks` ＝**本条（当前这一步）冻结的冷却长度**（与 `navReadyUntil` 同写同源；
     *     UI 进度条的**分母**：`进度 ＝ 1 − navRemainTicks / navCdTicks`，就绪/未排队 ⇒ 0 ⇒ 按“满格”呈现）；
     *  · `navEnergy` ＝当前能量（引擎唯一能量字段，读 `hull.energy`；NaN/缺失 ⇒ 0）；
     *  · `navEnergyPerTick` ＝**该单位**充能每 tick 的能量代价（**单位配置值**；
     *     `data/ships/<id>.js` 顶层 `navEnergyPerTick`，逐级可覆写；UI **直接读、不自算**）；
     *  · `navStalled` ＝**本 tick 的充能是否因能量不足而暂停**（引擎派生判据：**处于充能中**
     *    且 `navEnergy < navEnergyPerTick`；**不再要求“有移动指令”** —— 新口径下充能是常态）⇒
     *     UI 据此显示“暂停/变色”，**不得自行比较能量**；
     *  · `canCommand` ＝**该单位此刻是否可被玩家指挥**（引擎派生判据：**存活 且 我方 且 非召唤/临时单位**，
     *     与 `moveUnitTo` 的 `'dead'`/`'owner'` 同一口径）⇒ UI 据此决定“是否可拖拽/是否显示可拖动光标”，
     *     **不得自行拼判据**。
     *  ★ 即使单位缺少 `navReadyUntil` 字段（异常/老实例）也照常返回（按 0 就绪处理）。 */
    unitNav(unitId) {
      const found = findUnitEntry(unitId);
      if (!found) return null;
      const u = found.unit;
      const until = Math.max(0, u.navReadyUntil || 0);
      const energy = Number.isFinite(u.hull && u.hull.energy) ? u.hull.energy : 0;
      const target = navQueue.has(u.id) ? navQueue.get(u.id) : null;
      return {
        unitId: u.id,
        side: u.side,
        sectorIndex: found.entry.index,
        navCoeff: navCoeffOf(u),
        navReadyUntil: until,
        navRemainTicks: Math.max(0, until - runTicks),
        moveQueueTargetIndex: target,
        // ★ 剩余路径：引擎唯一路径口径（`navPathOf`：阶梯 / 绕行）；无通路或未排队 ⇒ null
        navPath: target == null ? null : navPathOf(crossCtx, found.entry.index, target),
        navCdTicks: Math.max(0, u.navCdTicks || 0),
        navEnergy: energy,
        navEnergyPerTick: navEnergyPerTickOf(u),
        // ★ **充能中且扣不起** ⇒ 本 tick 充能暂停（与跨星区阶段共用同一个 `isCharging` 判据）
        navStalled: isCharging(crossCtx, u) && energy < navEnergyPerTickOf(u),
        // ★ 可否指挥（引擎判据，与 `moveUnitTo` 的 `'dead'`/`'owner'` 同源）：UI 只用它决定拖拽可用性
        canCommand: !!u.alive && u.side === 'ally' && !u.isSummon,
      };
    },
    /** ★ **移动指令只读列表**（**每次读取返回新数组 + 新对象**；顺序＝**下达指令的顺序**，确定性）：
     *  每项 `{ unitId, sectorIndex, targetIndex, navReadyUntil, navRemainTicks, stalled }`
     *  （字段口径同 `unitNav`；`stalled` 即 `navStalled`）。 */
    get moveQueue() {
      const out = [];
      for (const [id, target] of navQueue) {
        const found = findUnitEntry(id);
        if (!found) continue; // 防御：已不在场的单位（正常路径不会出现）
        const u = found.unit;
        const until = Math.max(0, u.navReadyUntil || 0);
        const energy = Number.isFinite(u.hull && u.hull.energy) ? u.hull.energy : 0;
        out.push({
          unitId: id,
          sectorIndex: found.entry.index,
          targetIndex: target,
          navReadyUntil: until,
          navRemainTicks: Math.max(0, until - runTicks),
          stalled: isCharging(crossCtx, u) && energy < navEnergyPerTickOf(u),
        });
      }
      return out;
    },
    /**
     * ★ **单位「星区间移动」的唯一写入口**（**只记账 / 排队，绝不直接搬迁**；搬迁只发生在
     *   `crossSectorPhase` 内 —— 见文件头「星区间移动」）。语义（与文件头 ③④⑤⑥ 逐条对应）：
     *   · **一次只移动一个星区**：目标可以是任意**合法星区**，单位会按**引擎算好的路径**逐格走过去
     *     （★ 迭代 3：**无障碍＝均匀阶梯**、**被边界/空位挡住＝图上最短通路绕行** ⇒ 见 `navPathOf`；
     *     每完成一步冻结下一步 cd；到期后**自动执行**，玩家无需再操作）；
     *   · **就绪时**（`navReadyUntil ≤ runTicks`）⇒ **立即到期**（`navReadyUntil = runTicks`）：
     *     **下一 tick 的跨星区阶段即执行迁移**（用户口径：**不需要先充能满**）；迁移落地后再按
     *     `cd = max(1, round(navCdTicks ÷ navCoeff × (1 + timeCoeff)))` 重新计时（用于**下一步**）；
     *   · **冷却中**再下达 ⇒ **覆盖目标、保留当前 `navReadyUntil`**（不重算已开始那一步）；
     *   · ★ **拖/点到“自身所在星区” ⇒ 取消移动指令**（用户口径；不再是 `'same'` 失败）：
     *     清除该单位的排队目标（`moveQueueTargetIndex` 随之清空、UI 路径描边随之消失）；
     *     · **有指令** ⇒ `{ ok:true, cancelled:true, cleared:true }`；
     *     · **本就没有指令** ⇒ 同样 `ok:true`（**幂等无操作**），只是 `cleared:false`；
     *     · ★ **在途那一步的处理（本实现的选择）＝“立即取消、不再走”**：引擎的“下一步落点”完全由
     *       **队列目标**在结算时派生（`navNextStepOf(当前格, 目标)`），没有第二份“已锁定的落点”状态 ⇒
     *       清掉队列即**本步不再执行**（不会出现“取消后还动一格”）。这与“单一来源”铁律一致：
     *       若要保留“已开始那一步仍落地”，就必须新增一份待执行落点状态，故**不采用**。
     *     · ★ **冷却进度保留**：只清目标，**不动** `navReadyUntil`/`navCdTicks` ⇒ “引擎充能中”的状态延续；
     *       取消后再下达 ⇒ 就绪则立即走、冷却中则按剩余冷却等待（与“覆盖目标”同一口径）。
     *   · **可移动性与模块无关**：本函数**没有任何“必须装某模块才能移动”的判据** ——
     *     任何我方常规单位**默认可移动**（`navCoeff` 缺省 1 ＝基础航行能力）；`navThruster` 只是**加成**；
     *   · **本函数不扣能量**：能量只在**跨星区阶段**按“冷却每 tick 代价”逐 tick 扣减（见文件头 ②b）；
     *   · **指挥权口径**：只有**我方常规单位**（`side === 'ally'` **且非召唤/临时单位**）可被指挥；
     *   · 不做任何搬迁、不写 `navReadyUntil` 之外的引擎状态、不产生战报（纯记账）。
     * @param {string} unitId 单位 id
     * @param {number} targetIndex 目标星区 index（**显示编号 ＝ index + 1**；可以不相邻 —— 见上；
     *   **等于该单位当前所在星区 ⇒ 取消**）
     * @returns {{ ok:boolean, cancelled?:boolean, cleared?:boolean, queued?:boolean,
     *             reason?:'none'|'dead'|'owner'|'far'|'invalid'|'finished',
     *             unitId:string, fromIndex?:number, targetIndex?:number, navReadyUntil?:number }}
     *   · 成功且非取消 ⇒ `{ ok:true, queued:true, ... }`；
     *   · **取消**（目标＝当前星区）⇒ `{ ok:true, cancelled:true, cleared, reason:'cancelled', ... }`
     *     （`cleared` ＝本次是否真的清掉了一条指令；`reason:'cancelled'` 只是**成功语义的标注**，
     *     不代表失败 —— UI 据此给“已取消移动”的短提示，**不当作失败**）；
     *   · **失败** (`ok:false`) 的 `reason` 语义：`'none'`＝无此单位（或已不在任何星区）；
     *     `'dead'`＝该单位已阵亡；`'owner'`＝**不归玩家指挥**（非我方 / 召唤·临时单位）；
     *     `'invalid'`＝目标星区**不存在**（越界/无此星区）；`'far'`＝**图上无通路**（★ 迭代 3 口径：
     *     目标存在，但**四方向逐格**从出发格出发**绕也绕不到**它 —— 见 `navPathOf`/`bfsPathOf`；
     *     拒绝 ⇒ **零改动**：不排队、不动 `navReadyUntil`、不产生任何星区变化）；
     *     `'finished'`＝星域已停止/结束/结算（不再接受指令）。
     *   ★ **`'same'` 已不再是失败口径**（同一输入现在走上面的“取消”成功分支）。
     */
    moveUnitTo(unitId, targetIndex) {
      const t = Math.floor(Number(targetIndex));
      // ⑥ 星域已停止/结束/结算 ⇒ 不再接受任何指令（同时保证队列已清空）
      if (stopped || finished || settled) {
        return { ok: false, reason: 'finished', unitId, targetIndex, queued: false };
      }
      const found = findUnitEntry(unitId);
      if (!found) return { ok: false, reason: 'none', unitId, targetIndex, queued: false };
      const u = found.unit;
      // ⑥ 单位已阵亡 ⇒ 清其队列与冷却字段（与跨星区阶段同一口径，幂等）
      if (!u.alive) {
        navQueue.delete(u.id);
        u.navReadyUntil = 0;
        u.navCdTicks = 0;
        return { ok: false, reason: 'dead', unitId: u.id, targetIndex, queued: false };
      }
      // 指挥权：仅**我方常规单位**（召唤/临时单位不归玩家指挥：其编队口径不完整、且会随时到期移出场景）
      if (u.side !== 'ally' || u.isSummon) {
        return { ok: false, reason: 'owner', unitId: u.id, targetIndex, queued: false };
      }
      if (!Number.isFinite(t) || !entryByIndex.has(t)) {
        return { ok: false, reason: 'invalid', unitId: u.id, targetIndex, queued: false };
      }
      // ★ **取消**：目标＝该单位当前所在星区 ⇒ 清其移动指令（清队列＝本步不再执行；冷却进度保留）
      if (t === found.entry.index) {
        const cleared = navQueue.delete(u.id);
        return {
          ok: true,
          cancelled: true,
          cleared,
          queued: false,
          reason: 'cancelled',
          unitId: u.id,
          fromIndex: found.entry.index,
          targetIndex: t,
          navReadyUntil: Math.max(0, u.navReadyUntil || 0),
        };
      }
      // ③ **可达性**：路径（无障碍＝均匀阶梯 / 被挡＝图上最短通路绕行）必须存在 ⇒ 否则 'far'（无通路）
      //    （与跨星区阶段同一判据：同一个 `navPathOf`；此处拒绝 ⇒ 零改动，不排队、不改冷却字段）
      if (!navPathOf(crossCtx, found.entry.index, t)) {
        return { ok: false, reason: 'far', unitId: u.id, fromIndex: found.entry.index, targetIndex: t, queued: false };
      }
      // ② ★ **就绪 ⇒ 立即到期**（`navReadyUntil = runTicks`）：**下一 tick 的跨星区阶段即执行迁移**，
      //    不等冷却条充满（用户口径：引擎进度不必先充能满）；迁移落地后由跨星区阶段重新计时（下一步用）。
      //    ★ **冷却中再下达 ⇒ 覆盖目标、保留当前 `navReadyUntil`**（不打断已开始的那一步）。
      //    ★ `navCdTicks`（只读展示的分母）与 `navReadyUntil` **同写同源**：就绪即执行 ⇒ 此处清零，
      //      仅由跨星区阶段在迁移落地时写入（见 `ship.js createShip` 注释）。
      if (runTicks >= (u.navReadyUntil || 0)) {
        u.navReadyUntil = runTicks; // ＝“此刻就绪/立即到期”
        u.navCdTicks = 0;
      }
      navQueue.set(u.id, t); // 覆盖式：**冷却中再次下达 ⇒ 覆盖目标、保留冷却**
      return {
        ok: true,
        queued: true,
        unitId: u.id,
        fromIndex: found.entry.index,
        targetIndex: t,
        navReadyUntil: u.navReadyUntil,
      };
    },
    /**
     * ★ **推进星域时间**（默认 1 tick；唯一驱动入口）——严格按文档 §1 的流程：
     *   ① `runTicks += 1` → ② 固定顺序逐区 `step()` → ③ 跨星区阶段 → ④ 时间耗尽 ⇒ 停止 + 结算。
     *  ★★ M3d **结束演出期间（`collapsing`）**：本函数**只推进变白进度**——
     *   不 step 任何星区（无 AI/攻击/事件/结算）、不动 `runTicks`、不产生任何战报 ⇒ 演出**零玩法副作用**。
     * @param {number} [n] 推进 tick 数（非正整数 ⇒ 不推进）
     * @returns {{ ok:boolean, reason?:string, ticks:number, runTicks:number, remainingTicks:number,
     *             finished:boolean, stopped:boolean, settled:boolean }}
     */
    step(n = 1) {
      const want0 = Math.floor(Number(n));
      const ticks0 = Number.isFinite(want0) && want0 > 0 ? want0 : 0;
      // ★★ 结束演出（**优先于 stopped/finished 分支**）：只推进变白
      if (collapsing) {
        advanceCollapse(ticks0);
        return {
          ok: true,
          ticks: ticks0,
          runTicks,
          remainingTicks: Math.max(0, durationTicks - runTicks),
          finished,
          stopped,
          settled,
          collapsing: true,
          collapseElapsed,
          collapseDone: api.collapseDone,
        };
      }
      if (stopped) return { ok: false, reason: 'stopped', ticks: 0, runTicks, remainingTicks: Math.max(0, durationTicks - runTicks), finished, stopped, settled };
      const ticks = ticks0;
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
        // ③ 跨星区阶段（**唯一落地处**；本 tick 的迁移在下一 tick 才在各区生效）
        crossSectorPhase(crossCtx);
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
    /** ★ 手动停止（不再 step；**不结算**）——同时按口径 ⑥ **清空全部移动队列**（不再执行） */
    stop() {
      stopped = true;
      navQueue.clear();
      return { ok: true, runTicks, remainingTicks: Math.max(0, durationTicks - runTicks), finished, stopped };
    },
    /** ★ 结算入口（时间耗尽时自动调用；也可手动调用 ⇒ 手动调用会置 `settled` 但不改 `finished`） */
    settle,
    /** ★★ M3d **开始结束演出（变白）**（唯一入口；调用方先做完结算再调；幂等，见同名函数注释） */
    beginCollapse,
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

/* ================= ★ 阶段 1 自检：单位「星区间移动」（控制台 `LS.starfield.moveSelfCheck()`） ================= */

/** **沙盒星域配置**（自检专用；**只读既有配置 `h1` 再覆写**，不改任何既有数据文件）：
 *  · 半径沿用 `h1`（2 ⇒ 13 个星区、版图紧凑、单步成本低）；
 *  · **只保留「中心类型」与「填充类型」**：二者都由**注册表派生**（`placement.mode === 'center'`
 *    与 `fill === true`）⇒ **不硬编码星区类型 id**；其余类型禁用
 *    ⇒ 版图内**无 NPC、无货物、无矿物**（干净、确定的沙盒）；
 *  · `playerUnits` 由调用方给出（恒为我方，入场星区＝`playerEntryIndex`，本沙盒＝`#1` 号星区）；
 *  · ★ 配置校验（`data/starfieldData.js validateStarfieldConfig`）要求「中心恒星必须启用」，
 *    故中心类型保持启用（`count {1,1}`，NPC 清空）。 */
function navSandboxConfig(playerUnits, durationTicks) {
  const cfg = JSON.parse(JSON.stringify(getStarfield('h1') || {}));
  const fillId = SECTOR_TYPE_IDS.find((id) => {
    const d = getSectorType(id);
    return !!d && d.fill === true;
  }) || null;
  const centerId = SECTOR_TYPE_IDS.find((id) => {
    const d = getSectorType(id);
    return !!d && !!d.placement && d.placement.mode === 'center';
  }) || null;
  cfg.sectorTypes = {};
  for (const id of SECTOR_TYPE_IDS) cfg.sectorTypes[id] = { enabled: false };
  if (centerId) cfg.sectorTypes[centerId] = { enabled: true, count: { min: 1, max: 1 }, npcListIds: [] };
  // 校验器按**键名 `star`** 判定“中心恒星必须启用” ⇒ 若注册表另有该键，一并保持启用（与校验口径同源）
  if (cfg.sectorTypes.star) cfg.sectorTypes.star = { enabled: true, count: { min: 1, max: 1 }, npcListIds: [] };
  if (fillId) cfg.sectorTypes[fillId] = { enabled: true, count: { min: 0, max: 0 } };
  cfg.playerUnits = playerUnits;
  cfg.durationTicks = durationTicks;
  return cfg;
}

/** 星区实例的**可比较快照**（只取确定性字段；**避开 `uid()` 生成的随机单位 id**，
 *  出场序号 `order` 才是引擎内的稳定标识 —— 体例同 `battleSelfCheck` 的 `vitalsOf`）。 */
function sectorSigOf(battle) {
  const units = battle
    .units()
    .map(
      (u) =>
        `${u.side}#${u.order}:${u.typeId}:${Math.round(u.hull.hp)}/${Math.round(u.hull.shield)}/${Math.round(u.hull.energy)}@${u.alive ? 1 : 0}`
    )
    .join('|');
  const s = battle.sector;
  return `${units};ore=${s.oreReserve};cargo=${s.cargos.length};t=${battle.runTicks}`;
}

/** 星域级快照（逐区拼接；顺序＝`sectors[]` 索引序 ⇒ 确定可复现） */
function starfieldSigOf(sf) {
  return sf.sectors.map((s) => `${s.index}:${sectorSigOf(sf.battleOf(s.index))}`).join('\n');
}

/* ---------- ★ M3d：出征单位的**只读载荷视图** / **取回（返回基地）** / **返回即修复** ---------- */

/** ★ 单位携回载荷的只读视图（`{templateId, level, tons}`；**只读、不摘取**）：
 *  · 货物实体清单走既有唯一只读口径 `cargoListOf`（引擎 `hull.cargo` 是同源数值口径）；
 *  · 模板键兼容 `templateId` / `type` 两种既有写法（规范化在 `systems/base.js` 再做一次）。 */
function carryViewOf(unit) {
  const cargos = cargoListOf(unit).map((c) => ({
    templateId: (c && (c.templateId || c.type)) || '',
    level: c && Number.isInteger(c.level) ? c.level : 1,
    tons: c && Number.isFinite(c.tons) ? c.tons : 0,
  }));
  return { ore: oreLoadOf(unit), cargos };
}

/** ★ 出征单位的**只读汇总条目**（容器 `baseUnits` 用它；**每次读取返回新对象**）：
 *  · 归属＝`unit.baseRef`（创建时按 `opts.baseRefs` 写在单位对象上，跨星区搬迁随对象走）；
 *  · `inEntry` ＝ 该单位**此刻在入场星区**（`playerEntryIndex`；生成器口径，历史字段）；
 *  · ★ M3d 迭代 2 `atGate` ＝ 该单位**此刻在任一「星门类型」星区**（**按类型 id 判定、不按下标**）
 *    ⇒ **这才是"能不能返回基地"的判据**（完整版在 `systems/expedition.js` 的 `returnCheck`）；界面只读，不自算。 */
function baseUnitViewOf(entry, unit, entryIndex) {
  const carry = carryViewOf(unit);
  return {
    unitId: unit.id,
    configId: unit.baseRef ? unit.baseRef.configId : null,
    ordinal: unit.baseRef && Number.isInteger(unit.baseRef.ordinal) ? unit.baseRef.ordinal : null,
    alive: !!unit.alive,
    sectorIndex: entry.index,
    inEntry: entry.index === entryIndex,
    atGate: !!entry.isGate, // ★ 按**类型**判定（星域里可能有多个星门星区）
    sectorTypeId: entry.typeId, // ★ 只读：当前所在星区的类型 id（界面/自检可核对类型判据）
    hp: Number.isFinite(unit.hull && unit.hull.hp) ? Math.round(unit.hull.hp) : 0,
    hpMax: Number.isFinite(unit.hull && unit.hull.hpMax) ? Math.round(unit.hull.hpMax) : 0,
    shield: Number.isFinite(unit.hull && unit.hull.shield) ? Math.round(unit.hull.shield) : 0,
    energy: Number.isFinite(unit.hull && unit.hull.energy) ? Math.round(unit.hull.energy) : 0,
    ore: carry.ore,
    cargos: carry.cargos,
  };
}

/** ★★ **返回即修复**（用户口径）：满血 → 满盾（各护盾池各自补满）→ 满能量 → **模块冷却归零**。
 *  · 只写单位自身字段（`hull.hp/hpMax`、`hull.pools` 各池 `value/cap`、`hull.shield` 汇总、
 *    `hull.energy/energyCap`、模块实例 `cooldown/cdElapsed`）—— **不改任何配置、不动等级与模块**；
 *  · 返回 `{ hp, shield, energy, maxHp, maxShield, maxEnergy }`（供结算回执与自检）。
 *  ★ 说明：基地侧是**抽象配置**（`count/out`），**不存血量** ⇒ "修复"落在**单位对象**上并由结算回执体现。 */
function repairForReturn(unit) {
  const h = (unit && unit.hull) || {};
  if (Number.isFinite(h.hpMax)) h.hp = h.hpMax;
  if (h.pools instanceof Map) {
    for (const p of h.pools.values()) {
      if (p && Number.isFinite(p.cap)) p.value = Math.max(0, p.cap);
    }
  }
  if (Number.isFinite(h.shieldCap)) h.shield = h.shieldCap; // 汇总口径：Σ 池值（各池已补满）
  if (Number.isFinite(h.energyCap)) h.energy = h.energyCap;
  for (const inst of unit.modules || []) {
    if (!inst) continue;
    inst.cooldown = 0; // 就绪（`advanceModuleState` 的判据字段）
    inst.cdElapsed = 0;
  }
  return {
    hp: Number.isFinite(h.hp) ? h.hp : 0,
    shield: Number.isFinite(h.shield) ? h.shield : 0,
    energy: Number.isFinite(h.energy) ? h.energy : 0,
    maxHp: Number.isFinite(h.hpMax) ? h.hpMax : 0,
    maxShield: Number.isFinite(h.shieldCap) ? h.shieldCap : 0,
    maxEnergy: Number.isFinite(h.energyCap) ? h.energyCap : 0,
  };
}

/** ★ **自检**：单位「星区间移动」（逐格跨区 + 航行引擎「始终充能」 + 排队 + **同一实例整体搬迁**）。
 *  检查项（全部纯本地、同步；星域星区模式本就不订阅全局 ticker / 不写全局战报）：
 *   ① **零回归（新口径）**：**在“无任何单位处于充能中”的前提下**，逐 tick 与「空实现」完全一致
 *      （对照容器＝**只逐区 `step()`、不调用跨星区阶段**）—— 含“不扣能量、不写任何字段”；
 *      ⚠ 旧断言“未排队即零写入”**不再成立**：新口径下**无指令但充能中**的单位同样扣能 ⇒ 对照前提改为
 *      “无单位充能中”（全程复核该前提，前提破了本项即失败）；
 *   ①b **始终充能（实测）**：**无指令**（队列恒空）时仍逐 tick 推进冷却并按**单位配置的能耗**扣能；
 *      扣不起 ⇒ 不扣、不推进（`navStalled` 真、剩余不变）、回能足够后继续推进；
 *      **充能完成后零耗能**（就绪态能量只回不扣、剩余恒 0）；
 *   ② **路径（无障碍）**：**均匀阶梯**（交替推进 / 最少步数 / 逐步相邻 / 不越出有效格）、拒绝口径 `'invalid'`/`'none'`
 *      ＋**未装任何模块的单位同样可移动**；并核对只读口径 `unitNav().navPath` 与引擎判据同源（同一函数）；
 *   ②c ★ **M3d 迭代 3 寻路**（详见下方 `run('②c …')` 的注释）：**有通路走最短路径** ——
 *      · **绕行样例**：阶梯被空位/边界挡住 ⇒ 图上四方向 **BFS 最短通路**（含"路径长于曼哈顿"的严格绕行）；
 *      · **无通路** ⇒ `moveUnitTo` 返回 `'far'`、不排队、**星域逐区快照零改动**；
 *      · **同起终点路径稳定**（重复读取 / 取消后重下 / 同配置同 seed 另容器 ⇒ 逐项一致）；
 *      · **引擎判据 ＝ `navPath` 描边数据 ＝ 实际逐格脚步**（三者同源）；
 *      （原 ② 里"对角目标 ⇒ `'far'`"的两个样本**已变成可达的绕行样例** ⇒ 断言搬到本项，覆盖面不减）
 *   ③ **就绪即走 + 落地后才为下一步计时**：就绪下达 ⇒ `navReadyUntil = runTicks`（下一 tick 即走、**不必充能满**）；
 *      迁移落地后写入 `navReadyUntil = 落地 tick + cd` 与只读分母 `navCdTicks = cd`（两者同写同源），
 *      冷却期内**一字不改**、执行时刻恰＝冻结值；
 *   ③b **唯一公式锚点**：`cd = max(1, round(navCdTicks ÷ navCoeff × (1 + 时间系数)))`
 *      （船型配置 `navCdTicks=200`；系数 1 ⇒ 200t；Lv1 `+0.1` ⇒ 1.1 ⇒ 182t；Lv4 `+0.5` ⇒ 1.5 ⇒ 133t）；
 *   ④ **同 tick 多单位处理顺序确定**：按「`sectors[]` 索引序 × 区内 `units()` 顺序」先后收编
 *      （**与随机 `uid()` 无关**：同操作序列两次运行（单位 id 全不同）结论一致）；
 *   ⑤ **目标变更与取消**：冷却中覆盖目标 ⇒ 目标被覆盖、**`navReadyUntil` 保持不变**（不重算已开始那一步）；
 *      **拖回自身所在星区 ⇒ 取消**（`{ok:true, cancelled:true}`：清队列与路径、冷却进度保留、
 *      本步立即取消不再续走；无指令时取消＝幂等成功）；
 *   ⑥ **整体搬迁保状态**：**同一实例**（`id` 不变、对象同一性）＋ 血/盾/能量/货物/矿物/模块自身冷却
 *      与**未移动的对照单位逐字段增量一致**（★ 新口径：**移动本身不额外扣能** ⇒ 迁移 tick 上连能量也应一致）；
 *      落地后**目标实例确实在结算它**且**立刻开始下一次充能**（无论是否还有后续指令）；
 *   ⑦ **外部临时状态清除、自身状态保留**：其它单位施加的系数/时间/潜行/受伤减免修饰在搬迁后被清除，
 *      **自身模块写下的修饰与其加成（`coefficients.nav`）原样保留**（判据＝来源 key 是否自身模块实例 id）；
 *   ⑧ **能量门控**：冷却期内能量不足 ⇒ `navStalled` 为真、冷却**暂停**（到期顺延、**剩余不变**）
 *      并在能量恢复后**继续走完**（本算例：cd 200t ⇒ 实测 ∈ (200, 400]）；
 *   ⑨ **异常清理**：`finished` ⇒ 清空队列且不再接受指令；单位死亡 ⇒ 清队列与冷却字段；敌方单位 ⇒ `'owner'`。
 *   ⑩ **召唤物不随行**：单位迁移后，源星区的召唤物**仍在原区**、存在时间照常推进、序号/关联不变，
 *      且**指向已迁走单位的跨实例引用**（`targetId` / 模块 `_stick` / 模块 `target`）已被静默解除；
 *   ⑪ **迁移不重复召唤**：目标区**无新增**召唤物，**星域范围总数守恒**（越过一个完整冷却仍为 1）；
 *   ⑫ **迁移后模块行为**：模块实例与冷却**随行**；名额被源区那只占着 ⇒ 新星区**待命不召唤**；
 *      源区那只到期/阵亡后名额释放 ⇒ **在新星区正常召唤**（上限计数不漏算、不重复）；
 *   ⑬ **零回归（不迁移）**：召唤时间线（首次召唤 tick）＝`cool_first` 的冷却、出场状态逐字段＝模块配置、
 *      上限始终生效；且**非星域玩法不注入 `summonCountOf`** ⇒ 引擎走原“本实例计数”分支。
 *  @returns {{ pass:boolean, checks:{name,pass,detail}[] }} */
export function starfieldMoveSelfCheck() {
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass: !!pass, detail: detail == null ? '' : String(detail) });
  const run = (name, fn) => {
    try {
      fn();
    } catch (err) {
      add(`${name} —— 自检执行异常`, false, String((err && err.message) || err));
    }
  };
  /** 某一星区内、由 `moduleId` 召唤出的**存活**单位（顺序＝`units()` 顺序 ⇒ 确定可复现） */
  const summonsIn = (sf, sectorIndex, moduleId) => {
    const b = sf.battleOf(sectorIndex);
    return b ? b.units().filter((u) => u.alive && u.summonMod === moduleId) : [];
  };
  /** **整个星域**范围内由 `moduleId` 召唤出的**存活**单位（遍历 `sf.sectors`，顺序确定） */
  const summonsAcross = (sf, moduleId) => {
    const out = [];
    for (const s of sf.sectors) out.push(...summonsIn(sf, s.index, moduleId));
    return out;
  };
  /** 按 id 取**单位对象**（遍历全部星区；找不到 ⇒ null）——白盒对照用（引擎只读口径仍走 `unitNav`） */  const unitOf = (sf, id) => {
    for (const s of sf.sectors) {
      const b = sf.battleOf(s.index);
      const u = b && b.units().find((x) => x.id === id);
      if (u) return u;
    }
    return null;
  };
  /** 推进到指定容器 tick（自检内部驱动；`step()` 是唯一驱动入口） */
  const stepTo = (sf, tick) => {
    let guard = 0;
    while (sf.runTicks < tick && guard < 200000) {
      sf.step();
      guard += 1;
    }
  };
  /** 推进直到该单位**完成一次一步迁移**（与能量停滞无关）；返回 `{ moved, tick }` */
  const stepUntilMove = (sf, id, maxTicks = 8000) => {
    const from = sf.unitNav(id).sectorIndex;
    for (let i = 0; i < maxTicks; i += 1) {
      sf.step();
      const now = sf.unitNav(id);
      if (now && now.sectorIndex !== from) return { moved: true, tick: sf.runTicks };
    }
    return { moved: false, tick: sf.runTicks };
  };
  /** 推进直到该单位**到达指定星区**（含多步续走；自动容忍能量停滞） */
  const stepUntilAt = (sf, id, idx, maxTicks = 8000) => {
    for (let i = 0; i < maxTicks; i += 1) {
      if (sf.unitNav(id).sectorIndex === idx) return { ok: true, tick: sf.runTicks };
      sf.step();
    }
    return { ok: sf.unitNav(id).sectorIndex === idx, tick: sf.runTicks };
  };
  /** 按坐标取星区 index（自检里用**坐标**定位，避免硬编码 index —— 版图由配置半径决定）；
   *  该坐标无星区 ⇒ `-1`（＝非合法星区 ⇒ `moveUnitTo` 必返回 `'invalid'`，使断言**响亮失败**）。 */
  const atOf = (sf, q, r) => {
    const s = sf.sectors.find((x) => x.q === q && x.r === r);
    return s ? s.index : -1;
  };
  /** 单位**自身模块实例 id**集合（＝“自身来源”判据的权威依据，与 `battle.js clearForeignMods` 同源） */
  const ownIdSet = (u) => new Set((u.modules || []).map((i) => i.id));
  /** ★ **判据断言**：五张修饰表的 key **全部** ∈ 自身模块实例 id（＝已无“其它单位施加”的临时状态） */
  const foreignFree = (u) => {
    const own = ownIdSet(u);
    const keys = [
      ...(u.coeffMods instanceof Map ? u.coeffMods.keys() : []),
      ...(u.coeffMulMods instanceof Map ? u.coeffMulMods.keys() : []),
      ...(u.damageTakeMulMods instanceof Map ? u.damageTakeMulMods.keys() : []),
      ...(u.timeCoeffMods instanceof Map ? u.timeCoeffMods.keys() : []),
      ...(u.stealthMods instanceof Set ? u.stealthMods : []),
    ];
    return keys.every((k) => own.has(k));
  };
  /** 单位**自身状态快照**（搬迁保真对比用；**不含** `order`/`sideSize`/`__pending`/队列
   *  —— 这些是“目标实例内重绑”的字段，按设计会变；`navReadyUntil` 也单列断言） */
  const stateSnap = (u) => ({
    typeId: u.typeId,
    level: u.level,
    role: u.role,
    hp: u.hull.hp,
    hpMax: u.hull.hpMax,
    shield: u.hull.shield,
    shieldCap: u.hull.shieldCap,
    energy: u.hull.energy,
    energyCap: u.hull.energyCap,
    cargo: u.hull.cargo || 0,
    ore: u.hull.ore || 0,
    cargoIds: (u.cargos || []).map((c) => c.id).join(','),
    pools: [...(u.hull.pools instanceof Map ? u.hull.pools : new Map())]
      .map(([k, p]) => `${k}:${Math.round(p.value * 1000)}/${Math.round(p.cap * 1000)}`)
      .join('|'),
    mods: (u.modules || [])
      .map(
        (i) =>
          `${i.moduleId}@${i.level}:cd${i.cooldown}/${i.cdElapsed}|dur${i.durationLeft}/${i.durElapsed}|on${i.enabled ? 1 : 0}|act${i.stats.activeTicks}`
      )
      .join(';'),
  });
  /** 快照的**逐字段增量**（数值 ⇒ 差值；非数值 ⇒ 是否变化 0/1）——用于“移动者 vs 同 tick 对照单位” */
  const deltaOf = (before, after) => {
    const out = {};
    for (const k of Object.keys(before)) {
      const b = before[k];
      const a = after[k];
      out[k] = typeof b === 'number' && typeof a === 'number' ? a - b : a === b ? 0 : 1;
    }
    return out;
  };
  const CENTER_ID = SECTOR_TYPE_IDS.find((id) => {
    const d = getSectorType(id);
    return !!d && !!d.placement && d.placement.mode === 'center';
  }) || null;
  const P1 = { shipId: 'combat', count: 1, level: 5, modules: [{ moduleId: 'cannon', level: 3 }] };
  const P2 = { shipId: 'combat', count: 2, level: 5, modules: [{ moduleId: 'cannon', level: 3 }] };
  const P3 = { shipId: 'combat', count: 3, level: 5, modules: [] }; // ★ 无任何模块（可移动性不依赖模块）
  const PNAV = { shipId: 'combat', count: 3, level: 5, modules: [{ moduleId: 'navThruster', level: 1 }] };
  const PCARGO = {
    shipId: 'combat',
    count: 2,
    level: 5,
    modules: [{ moduleId: 'cannon', level: 3 }, { moduleId: 'navThruster', level: 1 }],
  };

  /* ---- ①①b：零回归（新口径）＋「始终充能」实测断言 ---- */
  run('① 无单位处于充能中 ⇒ 与空实现逐 tick 行为一致（零回归）', () => {
    const cfg = navSandboxConfig([P2], 4000);
    const a = createStarfield(cfg, 'move-noregr'); // ★ 真实实现（step 内含跨星区阶段）
    const b = createStarfield(cfg, 'move-noregr'); // ★ 对照：手动逐区 step（＝空实现，不调用跨星区阶段）
    const warn0 = a.warnings.length;
    let same = true;
    let diffAt = 0;
    let chargingSeen = false; // ★ 全程复核“**没有任何单位处于充能中**”这一对照前提
    for (let i = 0; i < 60; i += 1) {
      a.step();
      for (const s of b.sectors) {
        const inst = b.battleOf(s.index);
        if (inst) inst.step();
      }
      for (const s of a.sectors) {
        for (const u of a.battleOf(s.index).units()) {
          if (a.unitNav(u.id).navRemainTicks > 0) chargingSeen = true;
        }
      }
      if (starfieldSigOf(a) !== starfieldSigOf(b)) {
        same = false;
        diffAt = i + 1;
        break;
      }
    }
    const noQueue = a.moveQueue.length === 0;
    const allIdle = a.sectors.every((s) =>
      a.battleOf(s.index).units().every((u) => (u.navReadyUntil || 0) === 0 && a.unitNav(u.id).navRemainTicks === 0)
    );
    const noWarn = a.warnings.length === warn0;
    // ★ **新口径下的正确断言**：对照前提＝「**无任何单位处于充能中**」（此时阶段对谁都不扣能、不写字段）；
    //   ⚠ 一旦有单位在充能（本场景不发生），真实实现会按**单位配置的能耗**扣能 ⇒ 与空实现**本就应当不同**。
    add(
      '① 无单位处于充能中 ⇒ 与空实现（只逐区 step）逐 tick 行为一致（零回归）',
      same && noQueue && allIdle && !chargingSeen && noWarn,
      `前提：全程无单位充能中=${!chargingSeen}（各就绪单位 navRemainTicks 恒 0=${allIdle}）；` +
        `逐 tick 快照（含能量）${same ? '全等' : `在第 ${diffAt} tick 出现差异`}；队列空=${noQueue}；无新增告警=${noWarn}`
    );

    /* —— ①b ★ 始终充能（用户口径）：**无指令**也推进冷却并按 tick 扣能；就绪后零耗能 ——
     *  算例（确定性；沙盒 NPC 全清 ⇒ 无战斗干扰）：
     *    · 单艘 combat Lv5（无模块）：`energyCap 1200`、回能 `24/秒` ⇒ `1.2/tick`、代价 `2/tick`（占位常量）；
     *    · 第 1 步就绪即走（tick 1 落地）⇒ 落地起进入充能（`cd = navCdTicks = 200`）；
     *    · 此后**不下达任何指令**（队列恒空）⇒ 仍应逐 tick 推进并扣能。 */
    const sfC = createStarfield(
      navSandboxConfig([{ shipId: 'combat', count: 1, level: 5, modules: [] }], 6000),
      'move-charge'
    );
    const cStart = sfC.playerEntryIndex;
    const c0 = sfC.sectors.find((x) => x.index === cStart);
    const cId = sfC.battleOf(cStart).allies[0].id;
    const cu = unitOf(sfC, cId);
    const cost = sfC.unitNav(cId).navEnergyPerTick; // 只读的**单位配置值**（当前占位 2）
    const regen = cu.energyRegenPerSec / 20; // 与引擎同口径（TPS＝20）
    const willStall = cost > regen; // 当前占位值下为 true（回能不足 ⇒ 会周期性停滞）
    sfC.moveUnitTo(cId, atOf(sfC, c0.q, c0.r + 1)); // 就绪 ⇒ tick 1 落地
    sfC.step();
    const navA = sfC.unitNav(cId);
    const cdC = navA.navCdTicks; // 200（充能分母）
    const remainA = navA.navRemainTicks; // 200
    const eA = cu.hull.energy;
    const N = 100; // 观察窗（充能远未结束、能量充足 ⇒ 无停滞）
    for (let i = 0; i < N; i += 1) sfC.step();
    const navB = sfC.unitNav(cId);
    const eB = cu.hull.energy;
    const noOrder = navB.moveQueueTargetIndex === null && sfC.moveQueue.length === 0;
    // ★ 断言：无指令也**冷却递减 1/tick**、能量**按 (回能 − 代价)/tick 递减**（本例无停滞 ⇒ 精确可算）
    const chargeOk =
      noOrder && navB.navRemainTicks === remainA - N && Math.abs(eB - eA - N * (regen - cost)) < 1e-6;
    // —— 停滞子例（无指令路径同样受能量门控）：把能量清零 ⇒ 该 tick 不扣、不推进；随后按能吃起时恢复推进 ——
    cu.hull.energy = 0;
    const remainS = sfC.unitNav(cId).navRemainTicks;
    sfC.step();
    const stalledAtTick = sfC.unitNav(cId).navStalled; // 该 tick 的只读判据（应为真）
    const stallTickOk =
      sfC.unitNav(cId).navRemainTicks === remainS && // 剩余不变（只顺延到期 tick）
      stalledAtTick === true && // 引擎只读判据
      Math.abs(cu.hull.energy - regen) < 1e-6; // 未扣能（只回能）
    for (let i = 0; i < 3; i += 1) sfC.step(); // 回能 1.2 → 2.4 ⇒ 付；1.6 ⇒ 停；2.8 ⇒ 付
    const resumeOk = sfC.unitNav(cId).navRemainTicks === remainS - 2;
    // —— 充能完成 ⇒ **就绪态零耗能**（能量只增不减、剩余恒 0）——
    let guardC = 0;
    while (sfC.unitNav(cId).navRemainTicks > 0 && guardC++ < 4000) sfC.step();
    const readyOk = sfC.unitNav(cId).navRemainTicks === 0;
    const eReady0 = cu.hull.energy;
    const M = 50;
    for (let i = 0; i < M; i += 1) sfC.step();
    const eReady1 = cu.hull.energy;
    // ★ 就绪后：剩余恒 0、能量**只回不扣**（增量恰＝回能×tick 数 ⇒ 证明“充能完成后不再扣能”）
    const idleFreeOk =
      readyOk &&
      sfC.unitNav(cId).navRemainTicks === 0 &&
      Math.abs(eReady1 - eReady0 - M * regen) < 1e-6 &&
      sfC.moveQueue.length === 0;
    // —— ★ **能耗＝单位配置值**（单一来源验证）：白盒把该单位的配置值改成别的数 ⇒ 扣减必须跟着变 ——
    //   （就绪 ⇒ 再下达一次移动：tick 落地后重新进入充能；此后按**新配置值**扣费。）
    const cfg0 = sfC.unitNav(cId).navEnergyPerTick; // 配置值（＝`navEnergyPerTickOf(unit)`）
    cu.baseNavEnergyPerTick = 5; // 白盒：改单位配置（唯一来源）⇒ 引擎扣减应随之变为 5/tick
    const cfg1 = sfC.unitNav(cId).navEnergyPerTick; // 只读口径必须立刻反映新配置值
    const fromConfig = cfg0 === navEnergyPerTickOf(cu);
    sfC.moveUnitTo(cId, atOf(sfC, c0.q, c0.r)); // 回到入场格（就绪 ⇒ 下一 tick 落地）
    sfC.step();
    const eCfg0 = cu.hull.energy;
    const K = 10;
    for (let i = 0; i < K; i += 1) sfC.step();
    const eCfg1 = cu.hull.energy;
    const cfgDriven = cfg1 === 5 && Math.abs(eCfg1 - eCfg0 - K * (regen - cfg1)) < 1e-6;
    cu.baseNavEnergyPerTick = cfg0; // 复原（后续断言/复用不受影响）
    add(
      '①b 始终充能：无指令仍推进冷却并按 tick 扣能；充能完成后零耗能（就绪保持）',
      chargeOk && stallTickOk && resumeOk && idleFreeOk && fromConfig && cfgDriven,
      `cd=${cdC}、代价=${cost}/tick（＝单位配置项 navEnergyPerTick）、回能=${regen.toFixed(2)}/tick；` +
        `无指令（队列空=${noOrder}）观察 ${N}t：剩余 ${remainA}→${navB.navRemainTicks}（应 ${remainA - N}）、` +
        `能量 ${eA.toFixed(2)}→${eB.toFixed(2)}（应 ${(eA + N * (regen - cost)).toFixed(2)}）⇒ ${chargeOk}；` +
        `清零能量后 1t：剩余不变=${stallTickOk}（navStalled 只读=${stalledAtTick}）；再 3t 恢复推进=${resumeOk}；` +
        `充能完成后 ${M}t：剩余恒 0=${readyOk}、能量 ${eReady0.toFixed(2)}→${eReady1.toFixed(2)}（只回不扣=${idleFreeOk}）；` +
        `改配置 ⇒ 只读口径=${cfg1}（原 ${cfg0}）且扣减随之（${K}t 能量 Δ=${(eCfg1 - eCfg0).toFixed(2)}，应 ${(K * (regen - 5)).toFixed(2)}）⇒ ${cfgDriven}；` +
        `（当前占位值下会周期性停滞=${willStall}）`
    );
  });

  /* ---- ②③⑤ 合并场景：一次「阶梯行走」（无模块单位）覆盖路径 / 冻结 / 排队 ---- */
  run('② 均匀阶梯路径（交替推进 / 最少步数 / 逐步相邻 / 不越出有效格）', () => {
    const sf = createStarfield(navSandboxConfig([P3], 4000), 'move-walk');
    const start = sf.playerEntryIndex;
    const s0 = sf.sectors.find((x) => x.index === start);
    const [idA, idB, idC] = sf.battleOf(start).allies.map((u) => u.id);
    const nUp = atOf(sf, s0.q, s0.r + 1);        // (0,−1)
    // ★ M3d 迭代 3：下列两个对角目标**过去**因"阶梯首步落在空位"被判 `'far'`，**现在可由 BFS 绕行抵达**
    //   （用户口径：有通路走最短路径）⇒ 它们的断言搬去 **②c**（绕行样例）；本项只留 `'invalid'`/`'none'`。
    const nDia = atOf(sf, s0.q + 1, s0.r + 1);   // (1,−1)：阶梯被空位 (1,−2) 挡住 ⇒ 绕行 (0,−1)→(1,−1)
    const nFar = atOf(sf, s0.q - 1, s0.r + 1);   // (−1,−1)：镜像样例（同理绕行）
    const nEnd = atOf(sf, s0.q, s0.r + 4);       // (0,2)：同列 4 步之外（=曼哈顿距离 ⇒ 最少步数）
    const nDiag = atOf(sf, s0.q + 1, s0.r + 2);  // (1,0)：|Δq|=1、|Δr|=2
    const moverObj = unitOf(sf, idA);
    const noModule = (moverObj.modules || []).length === 0; // ★ 可移动性不依赖模块

    // —— 拒绝口径（都不产生队列、不改任何字段）——
    //    ★ 注意：目标＝自身所在星区**不再是拒绝口径**（现在走“取消”成功分支，见 ⑤b）；
    //    ★ `'far'`（图上无通路）的拒绝口径见 **②c**（那里用"图上隔断"的样例断言，零改动一并核对）
    const rInv = sf.moveUnitTo(idA, 9999);
    const rNone = sf.moveUnitTo('ship_not_exist', nUp);
    const rejectsOk = rInv.reason === 'invalid' && rNone.reason === 'none';
    const noQueueAfterReject = sf.moveQueue.length === 0;
    // 对角目标**仍然合法且可达**（供 ②c 使用同一算例；此处只确认"不再是拒绝口径"）
    const diaReachNow = nDia >= 0 && nFar >= 0;

    // —— ②b **均匀阶梯**（同一函数的独立算例）：目标 (1,0)（|Δq|=1、|Δr|=2）
    //    ★ 旧“先 q 后 r”口径下首步要经 (1,−2)（无格）⇒ 不可达；新交替口径下**可达**，且**首步走 r**。
    //    本条同时核对「引擎判据 / `unitNav().navPath` 只读口径 / UI 描边」三者同源（同一函数、无第二套规则）。
    const sfStair = createStarfield(navSandboxConfig([P3], 600), 'move-stair');
    const st0 = sfStair.sectors.find((x) => x.index === sfStair.playerEntryIndex);
    const stId = sfStair.battleOf(sfStair.playerEntryIndex).allies[0].id;
    const stUp = atOf(sfStair, st0.q, st0.r + 1);        // (0,−1)：交替口径下的**首步**（走 r）
    const stMid = atOf(sfStair, st0.q + 1, st0.r + 1);   // (1,−1)
    const stTgt = atOf(sfStair, st0.q + 1, st0.r + 2);   // (1,0)：目标
    const stairBook = sfStair.moveUnitTo(stId, stTgt);
    const stairPath = sfStair.unitNav(stId).navPath;     // ★ 只读口径（UI 描边读同一字段）
    const stairStep = stepUntilMove(sfStair, stId, 4);
    const stairFirst = sfStair.unitNav(stId).sectorIndex;
    const stairLeft = sfStair.unitNav(stId).navPath;     // 走完首步后的剩余路径（应消减一格）
    const stairOk =
      stairBook.ok === true && stairStep.moved && stairStep.tick === 1 &&
      Array.isArray(stairPath) && stairPath.length === 3 &&               // 3 步 ＝ 曼哈顿距离（最短）
      stairPath[0] === stUp && stairPath[1] === stMid && stairPath[2] === stTgt && // 均匀阶梯：r→q→r
      stairFirst === stUp &&                                             // 首步确实落在 r 方向那一格
      Array.isArray(stairLeft) && stairLeft.length === 2 && stairLeft[0] === stMid; // 剩余路径随之消减一格

    // —— 记账：目标 (0,2)（同列 4 步）；该单位此刻**就绪** ⇒ 按新口径**立即到期** ——
    const book = sf.moveUnitTo(idA, nEnd);
    const bookedUntil = book.navReadyUntil;
    // ★ 口径锚点①（**就绪即走**）：就绪时下达 ⇒ `navReadyUntil = runTicks`（不发散、不预充能）
    const freezeOk = book.ok === true && bookedUntil <= sf.runTicks;
    const cdAtBook = sf.unitNav(idA).navCdTicks; // 就绪即执行 ⇒ 尚未开始计时 ⇒ 0
    // 下一 tick 的跨星区阶段**立即执行**这一步（(0,−2) → (0,−1)）
    const mv1 = stepUntilMove(sf, idA, 4);
    const after1 = sf.unitNav(idA);
    // ★ 口径锚点②：**迁移落地后**才为**下一步**计时 ⇒ 基础冷却＝`navCdTicks` 配置值（默认 200t）
    //   （落地于 tick 1 ⇒ 到期 tick 201、剩余 200）
    const step1Ok = after1.sectorIndex === nUp && mv1.tick === 1 && after1.navRemainTicks === 200;
    const cdFrozen = after1.navCdTicks === 200 && after1.navReadyUntil === 1 + 200; // 分母与到期 tick 同写同源
    const srcEmpty1 = !sf.battleOf(start).units().some((u) => u.id === idA);
    // 冷却期内**到期 tick 一字不改**（该窗口能量充足 ⇒ 无停滞、不漂移）：走到到期前一 tick 复核
    stepTo(sf, after1.navReadyUntil - 1);
    const stillFrozen = sf.unitNav(idA).navReadyUntil === after1.navReadyUntil && sf.unitNav(idA).navRemainTicks === 1;
    // —— ⑤ 冷却中覆盖目标（此刻未就绪）⇒ 目标被覆盖、`navReadyUntil` **保留** ——
    const override = sf.moveUnitTo(idA, nDiag);
    const keepOk = override.ok === true && override.navReadyUntil === after1.navReadyUntil;
    // 覆盖后继续自动走：先 q ⇒ (1,−1)（恰在冻结 tick 执行），再 r ⇒ (1,0)
    const mv2 = stepUntilMove(sf, idA, 6000);
    const after2 = sf.unitNav(idA);
    const step2Ok = after2.sectorIndex === atOf(sf, s0.q + 1, s0.r + 1) && mv2.tick === after1.navReadyUntil;
    const mv3 = stepUntilMove(sf, idA, 6000);
    const after3 = sf.unitNav(idA);
    const step3Ok = after3.sectorIndex === nDiag && after3.moveQueueTargetIndex === null; // 抵达 ⇒ 队列清空
    const destHasIt = sf.battleOf(nDiag).units().some((u) => u.id === idA);
    const srcEmpty2 = !sf.battleOf(after2.sectorIndex).units().some((u) => u.id === idA);
    const cIdle = sf.unitNav(idC).sectorIndex === start && sf.unitNav(idC).navRemainTicks === 0;

    // —— ⑤b **拖回自身格 ⇒ 取消**（新口径）——
    const nBack = atOf(sf, s0.q, s0.r + 2); // (0,0)：从 (1,0) 一步可达
    const rebook = sf.moveUnitTo(idA, nBack); // 此刻仍在冷却中 ⇒ 排队
    const untilBeforeCancel = sf.unitNav(idA).navReadyUntil;
    const cancel = sf.moveUnitTo(idA, nDiag); // ★ 目标＝自身所在星区 ⇒ 取消
    const afterCancel = sf.unitNav(idA);
    const cancelOk =
      rebook.ok === true && rebook.queued === true &&
      cancel.ok === true && cancel.cancelled === true && cancel.cleared === true &&
      sf.moveQueue.length === 0 && afterCancel.moveQueueTargetIndex === null &&
      afterCancel.navPath === null && // ★ 取消 ⇒ 路径描边数据随之为空
      afterCancel.navReadyUntil === untilBeforeCancel; // ★ 冷却进度保留（只清目标）
    // 取消后推进足够久（远超原到期 tick）⇒ 证明**本步立即取消、不再自动续走**
    const idxAtCancel = afterCancel.sectorIndex;
    for (let i = 0; i < 600; i += 1) sf.step();
    const noStepAfterCancel = sf.unitNav(idA).sectorIndex === idxAtCancel;
    // 幂等：无指令时再“拖回自身” ⇒ 成功且 cleared=false（不报错、不弹失败提示）
    const cancelNoop = sf.moveUnitTo(idA, idxAtCancel);
    const cancelNoopOk = cancelNoop.ok === true && cancelNoop.cancelled === true && cancelNoop.cleared === false;

    add(
      '② 均匀阶梯路径（无障碍 ⇒ 交替推进 / 最少步数 / 逐步相邻 / 拒绝口径 invalid·none / 无模块可移动）',
      noModule && rejectsOk && noQueueAfterReject && stairOk && step1Ok && step2Ok && step3Ok &&
        srcEmpty1 && srcEmpty2 && destHasIt && cIdle && diaReachNow,
      `拒绝：invalid=${rInv.reason} none=${rNone.reason}（'far' 无通路口径见 ②c）；` +
        `无模块=${noModule}；交替算例（|Δq|=1、|Δr|=2）：可达=${stairBook.ok} 路径=[${(stairPath || []).join(',')}]` +
        `（首步走 r=${(stairPath || [])[0] === stUp}）首步落点=${stairFirst} 消减后剩余=[${(stairLeft || []).join(',')}]；` +
        `对角算例（|Δq|=|Δr|=1）首步走 q；落脚序列 ${start}→${nUp}→${atOf(sf, s0.q + 1, s0.r + 1)}→${nDiag}；` +
        `源区已无=${srcEmpty1 && srcEmpty2} 目标区确有=${destHasIt} 旁观单位留守=${cIdle}（步数记录 ${mv1.moved}/${mv2.moved}/${mv3.moved}）`
    );
    add(
      '③ 就绪即走 + 迁移落地后才为下一步计时（`navCdTicks` 只读分母同写同源）',
      freezeOk && step1Ok && cdFrozen && stillFrozen && keepOk,
      `就绪下达 ⇒ navReadyUntil=${bookedUntil}（＝runTicks，立即到期；此时 navCdTicks=${cdAtBook}）；` +
        `第 1 步执行于 tick ${mv1.tick}；落地后 navCdTicks=${after1.navCdTicks}、到期 tick=${after1.navReadyUntil}（冷却期内不变=${stillFrozen}）`
    );
    add(
      '⑤ 目标变更与取消（冷却中覆盖 ⇒ 保留冷却；拖回自身 ⇒ 取消指令且不再自动续走）',
      keepOk && override.queued === true && cancelOk && noStepAfterCancel && cancelNoopOk,
      `覆盖前 ${after1.navReadyUntil} / 覆盖后 ${override.navReadyUntil}；` +
        `取消：cleared=${cancel.cleared} 队列空=${sf.moveQueue.length === 0} 冷却保留=${afterCancel.navReadyUntil === untilBeforeCancel}；` +
        `取消后 600 tick 未再搬迁=${noStepAfterCancel}；无指令时再取消＝幂等成功=${cancelNoopOk}`
    );
  });

  /* ---- ②c ★ M3d 迭代 3：**星域寻路（有通路走最短路径）** ----
   *   · **绕行样例**：直线/阶梯被版图边界（空位格）挡住 ⇒ 引擎改走**图上四方向最短通路**（BFS）；
   *   · **严格绕行**：路径比曼哈顿距离更长也要绕过去（用"图上隔断"样例：挖掉中心格 ⇒ 只能绕外圈）；
   *   · **无通路 ⇒ 拒绝且零改动**：入口格的唯一邻格被挖掉 ⇒ `moveUnitTo` 返回 `'far'`、不排队、不改任何字段；
   *   · **同起终点路径稳定**：重复读取 / 取消后重下 / 另开同配置同 seed 的容器 ⇒ 路径逐项一致；
   *   · **引擎判据 ＝ 描边数据 ＝ 实际脚步**：把绕行路径走完，逐格落点序列必等于 `unitNav().navPath`。
   *   ★ **自检专用的"挖格"注入**：直接删容器自己暴露的格位表 `entryIndexAtCell` 的条目（＝模拟"图上那块不存在/
   *     被隔断"），**只影响寻路**（该表在引擎里只被 `navPathOf`/`bfsPathOf` 读）；星区本身仍在 `entryByIndex` 里
   *     ⇒ 正好构造出"目标存在但无通路"的 `'far'` 场景（真实版图是连通的圆盘，天然没有这种样例）。 */
  run('②c 星域寻路（无障碍＝阶梯 / 被挡＝图上最短通路绕行 / 无通路拒绝 / 路径稳定）', () => {
    const mkSf = (seed) => createStarfield(navSandboxConfig([P3], 4000), seed);
    const cut = (sf, q, r) => sf.entryIndexAtCell.delete(`${q},${r}`); // 自检专用：把某格从图的通行集合里挖掉
    const restore = (sf, q, r, idx) => sf.entryIndexAtCell.set(`${q},${r}`, idx);

    // ① **绕行样例**：入口 (0,−2) → (1,−1)：阶梯首步要落 (1,−2)（该格不存在）⇒ 必须绕经 (0,−1)
    const sf1 = mkSf('move-bfs');
    const e1 = sf1.sectors.find((x) => x.index === sf1.playerEntryIndex);
    const id1 = sf1.battleOf(sf1.playerEntryIndex).allies[0].id;
    const up1 = atOf(sf1, e1.q, e1.r + 1); // (0,−1)：绕行中转格
    const dia1 = atOf(sf1, e1.q + 1, e1.r + 1); // (1,−1)：目标（阶梯被空位挡住）
    const detourBook = sf1.moveUnitTo(id1, dia1);
    const detourPath = sf1.unitNav(id1).navPath;
    // 逐步走完：记录每一格的落点序列（＝实际脚步）
    const walked = [];
    for (let i = 0; i < 12 && sf1.unitNav(id1).sectorIndex !== dia1; i += 1) {
      const before = sf1.unitNav(id1).sectorIndex;
      stepUntilMove(sf1, id1, 600);
      const now = sf1.unitNav(id1).sectorIndex;
      if (now === before) break; // 走不动（能量停滞等）⇒ 退出，交由断言失败报告
      walked.push(now);
    }
    const detourOk =
      detourBook.ok === true &&
      Array.isArray(detourPath) && detourPath.length === 2 &&
      detourPath[0] === up1 && detourPath[1] === dia1 && // 绕行：r 方向一格 → q 方向一格
      walked.length === 2 && walked[0] === up1 && walked[1] === dia1 && // 实际脚步与描边数据一致
      sf1.unitNav(id1).sectorIndex === dia1;

    // ② **严格绕行**（路径长于曼哈顿距离）：挖掉中心 (0,0) ⇒ (0,−1) → (0,1) 只能绕右侧外圈（4 步 > 曼哈顿 2）
    const sf2 = mkSf('move-bfs-detour');
    const e2 = sf2.sectors.find((x) => x.index === sf2.playerEntryIndex); // (0,−2)
    const id2 = sf2.battleOf(sf2.playerEntryIndex).allies[0].id;
    const c002 = atOf(sf2, 0, 0); // 中心格（将被挖掉）
    const from2 = atOf(sf2, 0, -1); // (0,−1)
    const to2 = atOf(sf2, 0, 1); // (0,1)：与 from2 曼哈顿距离 2
    const g_right1 = atOf(sf2, 1, -1); // (1,−1)
    const g_right2 = atOf(sf2, 1, 0); // (1,0)
    const g_right3 = atOf(sf2, 1, 1); // (1,1)
    cut(sf2, 0, 0);
    // 先把单位挪到 (0,−1)（未挖中心时的合法一步），再从那里下达"严格绕行"目标
    sf2.moveUnitTo(id2, from2);
    stepUntilAt(sf2, id2, from2, 2000);
    const sf2moved = sf2.unitNav(id2).sectorIndex === from2;
    const detour2 = sf2.moveUnitTo(id2, to2);
    const path2 = sf2.unitNav(id2).navPath;
    const strictOk =
      sf2moved && detour2.ok === true &&
      Array.isArray(path2) && path2.length === 4 && // 4 步 > 曼哈顿 2 ⇒ 确实是"绕过去"
      path2[0] === g_right1 && path2[1] === g_right2 && path2[2] === g_right3 && path2[3] === to2;

    // ③ **无通路 ⇒ 拒绝且零改动**：挖掉入口格 (0,−2) 的**唯一邻格** (0,−1) ⇒ 四面无路
    const sf3 = mkSf('move-bfs-cut');
    const e3 = sf3.sectors.find((x) => x.index === sf3.playerEntryIndex);
    const id3 = sf3.battleOf(sf3.playerEntryIndex).allies[0].id;
    const nbr3 = atOf(sf3, e3.q, e3.r + 1); // (0,−1)：入口的唯一邻格
    const tgt3 = atOf(sf3, e3.q + 1, e3.r + 1); // (1,−1)
    cut(sf3, e3.q, e3.r + 1);
    const sigBefore3 = starfieldSigOf(sf3);
    const navBefore3 = JSON.stringify({ u: sf3.unitNav(id3).navReadyUntil, c: sf3.unitNav(id3).navCdTicks });
    const noPath = sf3.moveUnitTo(id3, tgt3);
    const navPath3 = sf3.unitNav(id3).navPath;
    restore(sf3, e3.q, e3.r + 1, nbr3); // 复原（保持容器自洽，便于后续断言）
    const noPathOk =
      noPath.ok === false && noPath.reason === 'far' && noPath.queued === false &&
      sf3.moveQueue.length === 0 && navPath3 === null &&
      JSON.stringify({ u: sf3.unitNav(id3).navReadyUntil, c: sf3.unitNav(id3).navCdTicks }) === navBefore3 &&
      starfieldSigOf(sf3) === sigBefore3; // ★ 零改动：星域逐区快照逐字节一致

    // ④ **同起终点路径稳定**：重复读取 / 取消后重下 / 另一同配置同 seed 的容器 ⇒ 路径逐项一致
    // ④ **同起终点路径稳定**：重复读取 / 取消后重下 / 另一同配置同 seed 的容器 ⇒ 路径逐项一致
    const sf4 = mkSf('move-bfs-stable');
    const e4 = sf4.sectors.find((x) => x.index === sf4.playerEntryIndex);
    const id4 = sf4.battleOf(sf4.playerEntryIndex).allies[0].id;
    const t4 = atOf(sf4, e4.q + 1, e4.r + 1);
    sf4.moveUnitTo(id4, t4);
    const s4a = JSON.stringify(sf4.unitNav(id4).navPath);
    const s4b = JSON.stringify(sf4.unitNav(id4).navPath); // 重复读取
    sf4.moveUnitTo(id4, e4.index); // 取消（拖回自身）
    sf4.moveUnitTo(id4, t4); // 重新下达同一目标
    const s4c = JSON.stringify(sf4.unitNav(id4).navPath);
    const sf5 = mkSf('move-bfs-stable'); // 同配置 + 同 seed ⇒ 生成器确定 ⇒ 同版图
    const e5 = sf5.sectors.find((x) => x.index === sf5.playerEntryIndex);
    const id5 = sf5.battleOf(sf5.playerEntryIndex).allies[0].id;
    sf5.moveUnitTo(id5, atOf(sf5, e5.q + 1, e5.r + 1));
    const s5 = JSON.stringify(sf5.unitNav(id5).navPath);
    const stableOk = s4a !== 'null' && s4a === s4b && s4a === s4c && s4a === s5;

    add(
      '②c 星域寻路：绕行样例（阶梯被空位挡住 ⇒ 图上最短通路）/ 严格绕行（长于曼哈顿）/ 无通路 ⇒ far 且零改动 / 同起终点路径稳定',
      detourOk && strictOk && noPathOk && stableOk,
      `绕行：ok=${detourBook.ok} 路径=[${(detourPath || []).join(',')}]（期望 ${up1},${dia1}）实际脚步=[${walked.join(',')}]；` +
        `严格绕行：ok=${detour2.ok} 路径=[${(path2 || []).join(',')}]（期望 ${g_right1},${g_right2},${g_right3},${to2}）；` +
        `无通路：ok=${noPath.ok} reason=${noPath.reason} 队列=${sf3.moveQueue.length} 快照一致=${starfieldSigOf(sf3) === sigBefore3}；` +
        `路径稳定：重复=${s4a === s4b} 取消重下=${s4a === s4c} 同种子另容器=${s4a === s5}`
    );
  });


  /* ---- ③b 唯一公式锚点：cd ＝ max(1, round(navCdTicks ÷ navCoeff × (1 + 时间系数))) ---- */
  run('③b 航行冷却唯一公式锚点（navCdTicks=200 ÷ 系数：1 / 1.1 / 1.5 ⇒ 200 / 182 / 133t）', () => {
    const mk = (seed, modules) => {
      const sf = createStarfield(navSandboxConfig([{ shipId: 'combat', count: 1, level: 5, modules }], 4000), seed);
      const start = sf.playerEntryIndex;
      const s0 = sf.sectors.find((x) => x.index === start);
      const id = sf.battleOf(start).allies[0].id;
      sf.moveUnitTo(id, atOf(sf, s0.q, s0.r + 1)); // 就绪 ⇒ 下一 tick 即走
      sf.step();
      return { sf, id, nav: sf.unitNav(id) };
    };
    // ★ 冷却在**迁移落地后**才计时 ⇒ 落地 tick 1 ⇒ 到期 tick ＝ 1 + cd；分母 `navCdTicks` 即 cd
    const a = mk('move-cd-1', []);                                      // 系数 1（coefficients.nav 默认 1）⇒ 200t
    const b = mk('move-cd-2', [{ moduleId: 'navThruster', level: 1 }]); // +0.1 ⇒ 1.1 ⇒ 182t
    const c = mk('move-cd-3', [{ moduleId: 'navThruster', level: 4 }]); // +0.5 ⇒ 1.5 ⇒ 133t
    const pass =
      a.nav.navCoeff === 1 && a.nav.navCdTicks === 200 && a.nav.navReadyUntil === 1 + 200 &&
      b.nav.navCoeff === 1.1 && b.nav.navCdTicks === 182 && b.nav.navReadyUntil === 1 + 182 &&
      c.nav.navCoeff === 1.5 && c.nav.navCdTicks === 133 && c.nav.navReadyUntil === 1 + 133;
    add(
      '③b 航行冷却唯一公式锚点（系数走 coefficients.nav；基准 navCdTicks=200t）',
      pass,
      `无模块 系数=${a.nav.navCoeff}/cd=${a.nav.navCdTicks}/到期=${a.nav.navReadyUntil}；` +
        `Lv1(+0.1) ⇒ ${b.nav.navCoeff}/${b.nav.navCdTicks}/${b.nav.navReadyUntil}；` +
        `Lv4(+0.5) ⇒ ${c.nav.navCoeff}/${c.nav.navCdTicks}/${c.nav.navReadyUntil}`
    );
  });

  /* ---- ④ 同 tick 多单位：跨区处理顺序＝`sectors[]` 索引序（与随机 uid 无关） ---- */
  const orderScenario = (seed) => {
    const sf = createStarfield(navSandboxConfig([PNAV], 6000), seed);
    const start = sf.playerEntryIndex;
    const s0 = sf.sectors.find((x) => x.index === start);
    const [idA, idB, idC] = sf.battleOf(start).allies.map((u) => u.id);
    const up = atOf(sf, s0.q, s0.r + 1);         // (0,−1)：A 停留地；B/C 的中转
    const right = atOf(sf, s0.q + 1, s0.r + 2);  // (1,0) ：B 的集结地（对角两步：|Δq|=|Δr|=1 ⇒ 先 q 后 r）
    const left = atOf(sf, s0.q - 1, s0.r + 2);   // (−1,0)：C 的集结地
    const center = atOf(sf, s0.q, s0.r + 2);     // (0,0) ：共同目标
    // ① 三单位先一起到 (0,−1)（起点唯一可走的相邻格：其余方向都越出有效格）
    //    ★ 新口径：就绪时下达 ⇒ **下一 tick 即到**（三者同 tick 下达 ⇒ 同 tick 抵达）
    const t0 = sf.runTicks;
    sf.moveUnitTo(idA, up);
    sf.moveUnitTo(idB, up);
    sf.moveUnitTo(idC, up);
    const rA = stepUntilAt(sf, idA, up, 4000);
    const allUp = [idA, idB, idC].every((id) => sf.unitNav(id).sectorIndex === up);
    // ② B、C 各自续走到集结地（路径＝两步，自动续走；此刻三者都在冷却中 ⇒ 排队）
    sf.moveUnitTo(idB, right);
    sf.moveUnitTo(idC, left);
    const rB = stepUntilAt(sf, idB, right, 8000);
    const rC = stepUntilAt(sf, idC, left, 8000);
    const gathered = rA.ok && rB.ok && rC.ok && allUp;
    // ③ 等三者冷却全部走完（无未完成指令、剩余冷却为 0）⇒ 此刻都处于**就绪**
    let guard = 0;
    const readyAll = () =>
      [idA, idB, idC].every((id) => {
        const n = sf.unitNav(id);
        return n.moveQueueTargetIndex === null && n.navRemainTicks === 0;
      });
    while (guard++ < 30000 && !readyAll()) sf.step();
    // ④ **能量对齐**（自检专用：保证三者都付得起本次扣费；否则“停滞”会让抵达 tick 不可预期。
    //    不触碰任何引擎实现 —— 同船型同等级 ⇒ 对齐后轨迹逐 tick 相同）
    for (const id of [idA, idB, idC]) {
      const u = unitOf(sf, id);
      u.hull.energy = u.hull.energyCap;
    }
    // ⑤ 同一 tick 同时下达（三者均就绪）⇒ 都在**下一 tick** 一起进入 (0,0)
    sf.moveUnitTo(idA, center);
    sf.moveUnitTo(idB, center);
    sf.moveUnitTo(idC, center);
    const mv = stepUntilMove(sf, idA, 4000);
    const inCenter = sf.battleOf(center)
      .allies.map((u) => u.id)
      .filter((x) => x === idA || x === idB || x === idC);
    const expect = [[idA, up], [idB, right], [idC, left]].sort((p, q) => p[1] - q[1]).map((p) => p[0]);
    const tag = (x) => (x === idA ? 'A' : x === idB ? 'B' : 'C');
    // 同 tick 判据：三者迁入后为**下一步**冻结的到期 tick 相同（＝抵达 tick ＋ 各自 cd；同型同级 ⇒ cd 相同）
    const sameTick = [idA, idB, idC].every((id) => sf.unitNav(id).navReadyUntil === sf.unitNav(idA).navReadyUntil);
    const orderOk = inCenter.length === 3 && inCenter.every((x, i) => x === expect[i]);
    return {
      pass: gathered && mv.moved && sameTick && orderOk,
      detail: `来源区 index：A=${up}(0,−1) C=${left}(−1,0) B=${right}(1,0)；目标区顺序=${inCenter.map(tag).join('→')}（期望 ${expect.map(tag).join('→')}）；同 tick=${sameTick}；就绪下达后首发 tick=${t0}+1`,
    };
  };
  run('④ 同 tick 多单位处理顺序确定（sectors[] 索引序优先；与随机 uid 无关）', () => {
    const r1 = orderScenario('move-order-1');
    const r2 = orderScenario('move-order-2'); // ★ 第二次运行：单位 id 全不同（`uid()` 随机）⇒ 结论必须一致
    add('④ 同 tick 多单位处理顺序确定（sectors[] 索引序优先；与随机 uid 无关）', r1.pass && r2.pass, `${r1.detail}；复跑一致=${r2.pass}`);
  });

  /* ---- ⑥ 整体搬迁保状态（同一实例；对照单位增量对拍；源区无 / 目标区有 / 能参战） ---- */
  run('⑥ 整体搬迁保状态（同一实例 / 血盾能货物矿物模块冷却一致 / 能参战）', () => {
    const sf = createStarfield(navSandboxConfig([PCARGO], 6000), 'move-carry');
    const start = sf.playerEntryIndex;
    const s0 = sf.sectors.find((x) => x.index === start);
    const dest = atOf(sf, s0.q, s0.r + 1);
    const [idM, idC] = sf.battleOf(start).allies.map((u) => u.id);
    const moverRef = unitOf(sf, idM);
    const ctrlRef = unitOf(sf, idC);
    // ★ 白盒布景（只为让“模块冷却”这一项**非平凡**；不触碰引擎实现）：
    //   两个单位的「火炮」都进入**长冷却中段**（冷却量远大于本次等待时长 ⇒ 迁移时仍在冷却中）
    //   ⇒ 迁移后若被重建，冷却会被归零（与对照单位的对比即会暴露这一点）；
    //   移动者另注入「已装货物 + 携带矿物」以验证二者**跟随单位实例**。
    for (const u of [moverRef, ctrlRef]) {
      const inst = u.modules.find((i) => i.moduleId === 'cannon');
      if (inst) {
        inst.cooldown = 2000;
        inst.cdElapsed = 40;
      }
    }
    moverRef.cargos.push({ id: 'cargo-selftest', templateId: 'none', tons: 12 });
    moverRef.hull.cargo = 12;
    moverRef.hull.ore = 77;
    // 让两单位先跑几 tick（模块窗口、能量回充都进入稳态），再下达移动
    for (let i = 0; i < 5; i += 1) sf.step();
    sf.moveUnitTo(idM, dest);
    // ★ 能量对齐（自检专用）：把两者都压到**远低于上限**的同一值，避免对照单位的回充被“上限钳制”吃掉，
    //   从而让“移动者与对照单位的能量增量差恰＝一次航行能耗”这条断言成立（不触碰引擎实现）。
    moverRef.hull.energy = 400;
    ctrlRef.hull.energy = 400;
    // 推进到“下一步迁移的前一 tick”，再走 1 tick ⇒ 抓取**同 tick 的**前后快照（对照单位作为基准）
    let beforeM = null;
    let beforeC = null;
    let afterM = null;
    let afterC = null;
    let moved = false;
    for (let attempt = 0; attempt < 60 && !moved; attempt += 1) {
      let guard = 0;
      while (sf.unitNav(idM).navRemainTicks > 1 && guard++ < 8000) sf.step();
      beforeM = stateSnap(unitOf(sf, idM));
      beforeC = stateSnap(unitOf(sf, idC));
      sf.step();
      if (sf.unitNav(idM).sectorIndex === dest) {
        afterM = stateSnap(unitOf(sf, idM));
        afterC = stateSnap(unitOf(sf, idC));
        moved = true;
      }
    }
    const cost = sf.unitNav(idM).navEnergyPerTick;
    // ★ 兜底：未能观察到迁移 ⇒ 直接判失败并给出可读原因（**不做** null 对照，避免抛出异常掩盖真因）
    if (!moved || !afterM || !afterC) {
      add(
        '⑥ 整体搬迁保状态（同一实例 / 血盾能货物矿物模块冷却一致 / 落地后续充能）',
        false,
        `未能在 60 次尝试内观察到迁入目标区（目标 index=${dest}；当前 index=${sf.unitNav(idM).sectorIndex}；` +
          `剩余冷却=${sf.unitNav(idM).navRemainTicks}；能量=${moverRef.hull.energy}）`
      );
      return;
    }
    const dM = deltaOf(beforeM, afterM);
    const dC = deltaOf(beforeC, afterC);
    // ★ 新口径（始终充能）：**移动本身不额外扣能**（能量代价＝充能 tick 费，与“是否移动”解耦）
    //   ⇒ 迁移 tick 上，移动者与对照单位的**逐字段增量完全一致（含能量）**（两者此刻都未在充能）。
    const sameDelta = Object.keys(dM).every((k) => Math.abs(dM[k] - dC[k]) < 1e-9);
    const energyOk = Math.abs(dM.energy - dC.energy) < 1e-9;
    // ★ 绝对保真：模块自身状态（冷却/持续期/启停/窗口）与护盾池**与“从未移动的孪生单位”逐字相同**，
    //   且血量/护盾/上限/等级/定位原样；货物与矿物随实例跟到目标区。
    const absKept =
      afterM.mods === afterC.mods && afterM.pools === afterC.pools &&
      afterM.hp === beforeM.hp && afterM.shield === beforeM.shield &&
      afterM.hpMax === beforeM.hpMax && afterM.shieldCap === beforeM.shieldCap &&
      afterM.energyCap === beforeM.energyCap && afterM.level === beforeM.level &&
      afterM.typeId === beforeM.typeId && afterM.role === beforeM.role &&
      afterM.cargo === 12 && afterM.ore === 77 && afterM.cargoIds === 'cargo-selftest';
    const sameInstance = unitOf(sf, idM) === moverRef; // ★ 对象同一性 + id 不变
    const srcGone = !sf.battleOf(start).units().some((u) => u.id === idM);
    const destHas = sf.battleOf(dest).units().some((u) => u.id === idM);
    const destNoDupCargo = sf.battleOf(dest).sector.cargos.every((c) => c.id !== 'cargo-selftest'); // 货物不在星区列表
    const refrozen =
      sf.unitNav(idM).navReadyUntil > sf.runTicks && sf.unitNav(idM).moveQueueTargetIndex === null &&
      sf.unitNav(idM).navCdTicks > 0; // ★ 迁移落地后为**下一步**重新计时（分母同写同源）
    // ★ 迁移落地后：**目标实例确实在结算它**，且**立刻开始下一次充能**（无论是否还有后续指令）——
    //   移动者：剩余冷却逐 tick −1、能量按 (回能 − 代价) 变化；对照单位：**不在充能** ⇒ 只回能不扣能。
    const regenPerTick = moverRef.energyRegenPerSec / 20; // 与引擎同口径（TPS＝20）
    const remLand = sf.unitNav(idM).navRemainTicks;
    const eLand = moverRef.hull.energy;
    const eCtrlLand = ctrlRef.hull.energy;
    const act0 = moverRef.modules.map((i) => i.stats.activeTicks).join(',');
    const K = 5;
    for (let i = 0; i < K; i += 1) sf.step();
    const act1 = moverRef.modules.map((i) => i.stats.activeTicks).join(',');
    const remDelta = remLand - sf.unitNav(idM).navRemainTicks; // 应 ＝ K（充能推进 K tick）
    const eDeltaM = moverRef.hull.energy - eLand; // 应 ＝ K ×(回能 − 代价)
    const eDeltaC = ctrlRef.hull.energy - eCtrlLand; // 应 ＝ K × 回能（对照不充能 ⇒ 不扣能）
    const chargeResumed =
      remDelta === K && Math.abs(eDeltaM - K * (regenPerTick - cost)) < 1e-6;
    const ctrlIdle = Math.abs(eDeltaC - K * regenPerTick) < 1e-6;
    const fighting = act1 !== act0 || chargeResumed; // 被目标实例“受理并推进”的实证
    add(
      '⑥ 整体搬迁保状态（同一实例 / 血盾能货物矿物模块冷却一致 / 落地后续充能）',
      moved && sameDelta && energyOk && absKept && sameInstance && srcGone && destHas && destNoDupCargo &&
        refrozen && chargeResumed && ctrlIdle && fighting,
      `对象同一=${sameInstance}；迁移 tick 增量与对照一致=${sameDelta}（能量不额外扣：${energyOk}）；` +
        `货物=${afterM.cargo}/${afterM.cargoIds} 矿物=${afterM.ore} 冷却=${afterM.mods.split(';')[0]}；` +
        `源区已无=${srcGone} 目标区确有=${destHas} 星区无重复货物=${destNoDupCargo}；` +
        `落地后 ${K}t：移动者剩余 −${remDelta}（应 ${K}）、能量 Δ=${eDeltaM.toFixed(2)}（应 ${(K * (regenPerTick - cost)).toFixed(2)}）⇒ 续充能=${chargeResumed}；` +
        `对照单位 Δ=${eDeltaC.toFixed(2)}（应 ${(K * regenPerTick).toFixed(2)}）不充能不扣能=${ctrlIdle}`
    );
  });

  /* ---- ⑦ 外部施加的临时状态清除、自身状态保留 ---- */
  run('⑦ 外部临时状态清除、自身状态保留（判据＝来源是否自身模块）', () => {
    const sf = createStarfield(navSandboxConfig([{ shipId: 'combat', count: 1, level: 5, modules: [{ moduleId: 'navThruster', level: 1 }] }], 4000), 'move-foreign');
    const start = sf.playerEntryIndex;
    const s0 = sf.sectors.find((x) => x.index === start);
    const id = sf.battleOf(start).allies[0].id;
    const u = unitOf(sf, id);
    const ownInst = u.modules[0].id;
    // —— 其它单位施加的临时状态（白盒用**引擎既有唯一入口**写入，key ∉ 自身模块 id）——
    setCoeffMod(u, 'foreign_selftest', 'attack', 5);
    setTimeCoeffMod(u, 'foreign_selftest', -0.5);
    setStealthMod(u, 'foreign_selftest');
    setDamageTakeMulMod(u, 'foreign_selftest', 0.5);
    // —— 自身来源（key ＝ 自身模块实例 id）：迁移后**必须保留** ——
    setTimeCoeffMod(u, ownInst, -0.2);
    const before = {
      hasForeign: !foreignFree(u),
      timeCoeff: timeCoeffOf(u),
      takeMul: u.damageTakeMul,
      stealth: u.stealthMods.size,
      coeffForeign: u.coeffMods.has('foreign_selftest'),
      navCoeff: navCoeffOf(u),
    };
    sf.moveUnitTo(id, atOf(sf, s0.q, s0.r + 1));
    const mv = stepUntilMove(sf, id, 4000);
    const after = {
      free: foreignFree(u),
      timeCoeff: timeCoeffOf(u),
      takeMul: u.damageTakeMul,
      stealth: u.stealthMods.size,
      ownTimeKept: u.timeCoeffMods instanceof Map && u.timeCoeffMods.has(ownInst),
      navCoeff: navCoeffOf(u),
    };
    // ★ 迁移前的时间系数＝**组合后的生效值**：引擎的多来源组合规则是「正/负**两向各取绝对值最大者**后
    //   求和」（`ship.js refreshTimeCoeff`）⇒ 外部 −0.5 与自身 −0.2 **同向** ⇒ 取最强 −0.5（**不是 −0.7**）。
    //   迁移后外部来源被清除 ⇒ 只剩自身 −0.2。
    const ok =
      mv.moved && before.hasForeign && before.coeffForeign &&
      Math.abs(before.timeCoeff - -0.5) < 1e-9 && before.takeMul === 0.5 &&
      before.stealth === 1 && Math.abs(before.navCoeff - 1.1) < 1e-9 &&
      after.free && Math.abs(after.timeCoeff - -0.2) < 1e-9 &&
      Math.abs(after.takeMul - 1) < 1e-9 && after.stealth === 0 &&
      after.ownTimeKept === true && Math.abs(after.navCoeff - 1.1) < 1e-9;
    add(
      '⑦ 外部临时状态清除、自身状态保留（判据＝来源是否自身模块）',
      ok,
      `迁移前：外部修饰在=${before.hasForeign} 时间系数=${before.timeCoeff}（同向取最强：外部 −0.5 胜出）` +
        `受伤减免=${before.takeMul} 潜行=${before.stealth} 系数=${before.navCoeff}；` +
        `迁移后：全为自身来源=${after.free} 时间系数=${after.timeCoeff}（外部来源已清、自身 −0.2 保留）` +
        `受伤减免=${after.takeMul} 潜行=${after.stealth} 自身加成保留=${after.navCoeff}`
    );
  });

  /* ---- ⑧ 能量门控：冷却期能量不足 ⇒ 冷却暂停（navStalled）、恢复后继续走完 ---- */
  run('⑧ 能量门控：冷却中能量不足 ⇒ 冷却暂停（navStalled）、恢复后继续走完', () => {
    const sf = createStarfield(navSandboxConfig([{ shipId: 'combat', count: 1, level: 5, modules: [] }], 6000), 'move-energy');
    const start = sf.playerEntryIndex;
    const s0 = sf.sectors.find((x) => x.index === start);
    const id = sf.battleOf(start).allies[0].id;
    const u = unitOf(sf, id);
    const up = atOf(sf, s0.q, s0.r + 1);   // (0,−1)
    const end = atOf(sf, s0.q, s0.r + 2);  // (0,0)
    // ① **就绪即走**（能量充足）：第 1 步在下一 tick 完成，落地后进入冷却
    sf.moveUnitTo(id, up);
    const mv1 = stepUntilMove(sf, id, 4);
    const nav1 = sf.unitNav(id);
    const immediateOk = mv1.moved && mv1.tick === 1;
    const cd = nav1.navCdTicks;             // 本步冷却（分母）＝ navCdTicks(200) ÷ 系数(1)
    const base = nav1.navRemainTicks;       // 剩余冷却（新口径下＝完整 cd）
    // ② 冷却中下达第 2 步，并把能量清零 ⇒ 制造“每 tick 只够一半”的场景（回能 1.2/tick < 代价 2/tick）
    u.hull.energy = 0;
    const book2 = sf.moveUnitTo(id, end);
    const nav0 = sf.unitNav(id);
    const cost = nav0.navEnergyPerTick;
    const regenPerTick = u.energyRegenPerSec / 20; // 与引擎同口径（TPS＝20）
    const willStall = cost > regenPerTick;         // 前提：每 tick 回能**不够**一次扣费 ⇒ 必然出现停滞
    const stalledAtBook = nav0.navStalled === true && cost > 0;
    let stalledSeen = false;
    let used = 0;
    let remainKept = true; // ★ 停滞时“剩余冷却不变”的逐 tick 复核
    let prevRemain = nav0.navRemainTicks;
    for (let i = 0; i < 4000; i += 1) {
      sf.step();
      const nv = sf.unitNav(id);
      if (nv.navStalled) {
        stalledSeen = true;
        if (nv.navRemainTicks !== prevRemain) remainKept = false; // 停滞 ⇒ 剩余不变（只顺延到期 tick）
      }
      prevRemain = nv.navRemainTicks;
      if (nv.sectorIndex === end) {
        used = sf.runTicks - mv1.tick; // 第 1 步落地之后又走了多少 tick
        break;
      }
    }
    const arrived = sf.unitNav(id).sectorIndex === end;
    // ★ 锚点算例：这一步需要 `cd` 次付费；回能只有代价的 60% ⇒ 耗时 ∈ (cd, 2×cd]
    //   （停滞只顺延到期 tick、不吞已付出的冷却）；**代价取自单位配置** ⇒ 若把配置调到“回能够付”
    //   则本断言自动切换为“恰为 cd”（同一断言自适应，**不写死任何数值**）。
    const ratioOk = willStall ? used > base && used <= base * 2 : used === base;
    const stallOk = willStall ? stalledAtBook && stalledSeen && remainKept : true;
    add(
      '⑧ 能量门控：冷却中能量不足 ⇒ 冷却暂停（navStalled）、恢复后继续走完',
      immediateOk && book2.ok === true && stallOk && arrived && ratioOk,
      `就绪即走=${immediateOk}（第 1 步 tick ${mv1.tick}）；进入冷却：cd=${cd} 剩余=${base}；` +
        `每 tick 代价=${cost}、回能=${regenPerTick.toFixed(2)}/tick（会停滞=${willStall}）；` +
        `下达时停滞=${stalledAtBook}；过程中出现停滞=${stalledSeen}；停滞期剩余不变=${remainKept}；` +
        `第 2 步耗时=${used}t（应${willStall ? ` ∈ (${base}, ${base * 2}]` : ` ＝ ${base}`}）；已抵达=${arrived}`
    );
  });

  /* ---- ⑨ 异常清理（终局清空队列 / 死亡清队列与冷却 / 敌方不可指挥） ---- */
  run('⑨ 异常清理（finished / dead / owner）', () => {
    // (a) 终局（时间耗尽 ⇒ finished + settled）⇒ 清空全部队列，且不再接受指令
    const fcfg = navSandboxConfig([P1], 30); // 时长 30t：远短于一次冷却 ⇒ 第 2 步必然“走不完”
    const sfFin = createStarfield(fcfg, 'move-finish');
    const fStart = sfFin.playerEntryIndex;
    const f0 = sfFin.sectors.find((x) => x.index === fStart);
    const idF = sfFin.battleOf(fStart).allies[0].id;
    const fUp = atOf(sfFin, f0.q, f0.r + 1);   // (0,−1)
    const fEnd = atOf(sfFin, f0.q, f0.r + 2);  // (0,0)
    // ★ 就绪即走：第 1 步在下一 tick 完成（落地后进入冷却，冷却 > 剩余时长）
    const okBook = sfFin.moveUnitTo(idF, fUp).ok === true;
    sfFin.step();
    const after1Idx = sfFin.unitNav(idF).sectorIndex;
    const queued2 = sfFin.moveUnitTo(idF, fEnd).ok === true && sfFin.moveQueue.length === 1; // 冷却中 ⇒ 排队
    sfFin.step(40); // 到点 ⇒ finished（自动 settle）
    const cleared = sfFin.moveQueue.length === 0;
    const rejectedAfter = sfFin.moveUnitTo(idF, fEnd).reason === 'finished';
    const stayed = sfFin.unitNav(idF).sectorIndex === after1Idx && after1Idx === fUp; // 第 2 步未执行
    // (b) 单位死亡 ⇒ 清其队列与冷却字段（★ 自检直接置 `alive=false` 模拟判死：只验证**本阶段**的清理分支，
    //     引擎真实判死路径一字未改）
    const sfDead = createStarfield(navSandboxConfig([P1], 4000), 'move-dead');
    const dStart = sfDead.playerEntryIndex;
    const d0 = sfDead.sectors.find((x) => x.index === dStart);
    const uDead = sfDead.battleOf(dStart).allies[0];
    const dTarget = atOf(sfDead, d0.q, d0.r + 1);
    sfDead.moveUnitTo(uDead.id, dTarget);
    // 清理前：指令确已登记（就绪下达 ⇒ 到期 tick＝当前 tick，但指令在队列里）
    const queuedBefore = sfDead.moveQueue.length === 1 && sfDead.unitNav(uDead.id).moveQueueTargetIndex === dTarget;
    uDead.alive = false;
    sfDead.step();
    const deadCleared =
      uDead.navReadyUntil === 0 && uDead.navCdTicks === 0 && sfDead.moveQueue.length === 0;
    // (c) 敌方单位 ⇒ `'owner'`（不归玩家指挥）；中心星区驻守 NPC 由配置覆写给出
    const ocfg = navSandboxConfig([P1], 4000);
    if (CENTER_ID) ocfg.sectorTypes[CENTER_ID] = { enabled: true, count: { min: 1, max: 1 }, npcListIds: ['patrolLight'] };
    const sfOwn = createStarfield(ocfg, 'move-owner');
    const foeSector = sfOwn.sectors.find((s) => s.typeId === CENTER_ID);
    const foe = foeSector ? (sfOwn.battleOf(foeSector.index).units().find((u) => u.side === 'enemy') || null) : null;
    const ownerOk = !!foe && sfOwn.moveUnitTo(foe.id, 0).reason === 'owner';
    const allyId = sfOwn.battleOf(sfOwn.playerEntryIndex).allies[0].id;
    const ownerAllyOk = sfOwn.moveUnitTo(allyId, 9999).reason === 'invalid';
    // ★ 只读「可否指挥」判据（UI 拖拽可用性）：我方常规单位 true / 敌方 false（与 'owner' 同源）
    const canCmdOk = sfOwn.unitNav(allyId).canCommand === true && (!foe || sfOwn.unitNav(foe.id).canCommand === false);
    add(
      '⑨ 异常清理：finished 清队列并拒收指令 / 死亡清队列与冷却字段 / 敌方不可指挥',
      okBook && queued2 && cleared && rejectedAfter && stayed && queuedBefore && deadCleared && ownerOk && ownerAllyOk && canCmdOk,
      `终局：第 1 步落到 ${after1Idx}（＝${fUp}）、第 2 步在冷却中排队=${queued2}；到点后清空=${cleared} 拒收=${rejectedAfter} 未再搬迁=${stayed}；` +
        `死亡：清理前已登记=${queuedBefore} 清理后（队列空 + 冷却字段归零）=${deadCleared}；敌方 reason=${foe ? 'owner' : '无敌方单位'}；可否指挥只读=${canCmdOk}`
    );
  });

  /* ---- ⑩⑪⑫ 召唤物：**不随单位迁移**（源区留驻 + 解除跨实例引用 / 目标区不重复生成 / 上限跨星区） ----
   *  真因（已定位）：引擎的召唤上限判据原为 `sidesOf(side)` —— **只数本星区实例**的单位；
   *  而召唤物**不会**被迁移带走（`takeUnit`/`adoptUnit` 只动“被下达指令的那一个单位”的阵营成员身份）
   *  ⇒ 单位迁到新星区后，**本区同名召唤物计数为 0** ⇒ 冷却一到就**又召一只**（新星区多一只、源区那只还在）。
   *  修复：容器给每个星区实例注入**星域范围计数**（`countSummonsAcross`，见 `battle.js` 的 `summonCountOf`）
   *  ⇒ 留在源区的召唤物**继续占用上限** ⇒ 不重复召唤；其阵亡/到期后**名额自然释放**。 */
  run('⑩ 召唤物不随行（留在源星区 / 状态延续 / 跨实例引用被解除）', () => {
    const SUMMON = 'laserTurretSpawn'; // Lv1：maxSummoned 1、cooldown 200、lifespan 2400、能耗 50（占位）
    const cfg = navSandboxConfig(
      [{ shipId: 'combat', count: 1, level: 5, modules: [{ moduleId: SUMMON, level: 1 }] }],
      4000
    );
    const sf = createStarfield(cfg, 'move-summon');
    const start = sf.playerEntryIndex;
    const s0 = sf.sectors.find((x) => x.index === start);
    const moverId = sf.battleOf(start).allies[0].id;
    const moverRef = unitOf(sf, moverId);
    const dest = atOf(sf, s0.q, s0.r + 1); // (0,−1)
    const summonMod = moverRef.modules.find((i) => i.moduleId === SUMMON) || null;
    // ① 等它自然召出一只（`cool_first` ⇒ 开场即冷却，首次召唤在 ~cd 之后）
    let g1 = 0;
    while (summonsIn(sf, start, SUMMON).length === 0 && g1++ < 1500) sf.step();
    const first = summonsIn(sf, start, SUMMON)[0] || null;
    if (!first) {
      add('⑩ 召唤物不随行（留在源星区 / 状态延续 / 跨实例引用被解除）', false,
        `未能在 1500t 内观察到首次召唤（模块=${SUMMON}；单位模块数=${moverRef.modules.length}；能量=${moverRef.hull.energy}）`);
      return;
    }
    const firstSnap = { id: first.id, order: first.order, tempLeft: first.tempLeft, summonMod: first.summonMod };
    // ② 白盒注入**跨实例引用**（模仿“召唤时锁定/粘性指向召唤者”的形态）⇒ 迁移后必须被解除
    first.targetId = moverId; // 目标引用（非 lockTargetId ⇒ 走既有静默回落）
    first.modules[0]._stick = [moverId]; // 粘性目标（存单位 id）
    first.modules[0].target = { mode: 'unit', id: moverId }; // 模块级手动目标
    const refInjected =
      first.targetId === moverId && first.modules[0]._stick.includes(moverId) &&
      first.modules[0].target && first.modules[0].target.id === moverId;
    const modInstBefore = summonMod;
    const modCdBefore = summonMod ? summonMod.cooldown : -1;
    // ③ 迁移（就绪 ⇒ 下一 tick 落地；冷却中则自动排队等待 —— 本场景单位尚未移动过 ⇒ 就绪 ⇒ 立即走）
    const mv = sf.moveUnitTo(moverId, dest);
    let g2 = 0;
    while (sf.unitNav(moverId).sectorIndex !== dest && g2++ < 3000) sf.step();
    const moved = sf.unitNav(moverId).sectorIndex === dest;
    sf.step(); // 再走 1 tick（让迁移后的实例完成一次完整结算）
    const stillThere = summonsIn(sf, start, SUMMON);
    const keepAlive = stillThere.length === 1 && stillThere[0] === first && first.alive;
    const keepTicking = first.tempLeft < firstSnap.tempLeft; // 存在时间照常推进（未被迁移打断）
    const keepOrder = first.order === firstSnap.order && first.summonMod === firstSnap.summonMod;
    // ★ “解除跨实例引用”：迁移时由 `takeUnit` 的反向清理（静默）摘掉指向已迁走单位的目标/粘性/手动目标
    const refsCleared =
      first.targetId !== moverId &&
      !(Array.isArray(first.modules[0]._stick) && first.modules[0]._stick.includes(moverId)) &&
      !(first.modules[0].target && first.modules[0].target.id === moverId);
    // ★ 模块实例随行（同一实例，冷却不因迁移重置）—— 与既有“整体搬迁保状态”口径一致
    const modRode =
      !!modInstBefore && moverRef.modules.includes(modInstBefore) && modInstBefore.cooldown > 0 && modCdBefore > 0;
    add(
      '⑩ 召唤物不随行：单位迁移后源区召唤物仍在原区、状态延续、指向它的跨实例引用已解除',
      mv.ok === true && moved && keepAlive && keepTicking && keepOrder && refInjected && refsCleared && modRode,
      `迁移=${moved}（目标 ${dest}）；源区召唤物数=${stillThere.length}（同一实例=${keepAlive}）` +
        `存在时间 ${firstSnap.tempLeft}→${first.tempLeft}（继续计时=${keepTicking}）序号 ${first.order}=${firstSnap.order}；` +
        `注入跨实例引用=${refInjected} ⇒ 迁移后已解除=${refsCleared}；模块实例随行=${modRode}（冷却=${modInstBefore.cooldown}）`
    );
  });

  run('⑪ 迁移不重复召唤（目标区无新增 / 星域总数守恒）', () => {
    const SUMMON = 'laserTurretSpawn';
    const cfg = navSandboxConfig(
      [{ shipId: 'combat', count: 1, level: 5, modules: [{ moduleId: SUMMON, level: 1 }] }],
      4000
    );
    const sf = createStarfield(cfg, 'move-summon2');
    const start = sf.playerEntryIndex;
    const s0 = sf.sectors.find((x) => x.index === start);
    const moverId = sf.battleOf(start).allies[0].id;
    const dest = atOf(sf, s0.q, s0.r + 1);
    let g1 = 0;
    while (summonsIn(sf, start, SUMMON).length === 0 && g1++ < 1500) sf.step();
    const before = summonsAcross(sf, SUMMON).length; // 迁移前：星域范围总数（应为 1）
    sf.moveUnitTo(moverId, dest);
    let g2 = 0;
    while (sf.unitNav(moverId).sectorIndex !== dest && g2++ < 3000) sf.step();
    const afterMoveDest = summonsIn(sf, dest, SUMMON).length;
    const afterMoveAll = summonsAcross(sf, SUMMON).length;
    // ★ 关键：迁移后**越过一个完整召唤冷却（200t）**仍不得出现第二只（旧口径下这里必为 2）
    for (let i = 0; i < 250; i += 1) sf.step();
    const laterDest = summonsIn(sf, dest, SUMMON).length;
    const laterAll = summonsAcross(sf, SUMMON).length;
    const laterSrc = summonsIn(sf, start, SUMMON).length;
    const conserved = before === 1 && afterMoveAll === 1 && laterAll === 1 && afterMoveDest === 0 && laterDest === 0 && laterSrc === 1;
    add(
      '⑪ 迁移不重复召唤：目标区无新增召唤物，星域范围总数守恒（越过一个冷却周期仍为 1）',
      conserved,
      `迁移前星域总数=${before}；迁移后：目标区=${afterMoveDest} 星域总数=${afterMoveAll}；` +
        `再走 250t（＞冷却 200t）后：目标区=${laterDest} 源区=${laterSrc} 星域总数=${laterAll}`
    );
  });

  run('⑫ 迁移后召唤模块的后续行为（冷却随行 / 名额满则待命 / 名额释放后在新星区正常召唤）', () => {
    const SUMMON = 'laserTurretSpawn';
    const cfg = navSandboxConfig(
      [{ shipId: 'combat', count: 1, level: 5, modules: [{ moduleId: SUMMON, level: 1 }] }],
      4000
    );
    const sf = createStarfield(cfg, 'move-summon3');
    const start = sf.playerEntryIndex;
    const s0 = sf.sectors.find((x) => x.index === start);
    const moverId = sf.battleOf(start).allies[0].id;
    const moverRef = unitOf(sf, moverId);
    const dest = atOf(sf, s0.q, s0.r + 1);
    let g1 = 0;
    while (summonsIn(sf, start, SUMMON).length === 0 && g1++ < 1500) sf.step();
    const left = summonsIn(sf, start, SUMMON)[0] || null;
    sf.moveUnitTo(moverId, dest);
    let g2 = 0;
    while (sf.unitNav(moverId).sectorIndex !== dest && g2++ < 3000) sf.step();
    // (a) 名额仍被源区那只占着 ⇒ 新星区内**待命**（越过一个冷却周期也不召唤）
    for (let i = 0; i < 250; i += 1) sf.step();
    const standby = summonsIn(sf, dest, SUMMON).length === 0 && summonsAcross(sf, SUMMON).length === 1;
    // (b) 让源区那只**按引擎既有路径到期**（白盒：把已推进填满需求 ⇒ 下一 tick `applyTempTick` 判死并移出场景）
    let expired = false;
    if (left && left.temp) {
      left.tempLifeElapsed = Math.max(left.tempLifeElapsed || 0, left.tempLifeNeed || 0);
      sf.step();
      expired = !left.alive;
    }
    const freed = summonsAcross(sf, SUMMON).length === 0;
    // (c) 名额释放后：在**新星区**按正常冷却召唤一只（证明“不漏算/上限释放”）
    let g3 = 0;
    while (summonsIn(sf, dest, SUMMON).length === 0 && g3++ < 1500) sf.step();
    const respawnDest = summonsIn(sf, dest, SUMMON).length === 1;
    const srcEmpty = summonsIn(sf, start, SUMMON).length === 0;
    const modRode = !!moverRef.modules.find((i) => i.moduleId === SUMMON);
    add(
      '⑫ 迁移后召唤模块：名额满则在新星区待命；源区那只到期后名额释放并在新星区正常召唤',
      standby && expired && freed && respawnDest && srcEmpty && modRode,
      `待命（新星区 0 只、星域总数 1）=${standby}；源区那只到期=${expired}；名额释放（星域总数 0）=${freed}；` +
        `随后新星区召出 1 只=${respawnDest}（源区已清空=${srcEmpty}）；模块随行=${modRode}`
    );
  });

  run('⑬ 零回归（不迁移时召唤行为不变）＋ 真因实证（计数口径即重复召唤之因）', () => {
    const SUMMON = 'laserTurretSpawn';
    const cfg = navSandboxConfig(
      [{ shipId: 'combat', count: 1, level: 5, modules: [{ moduleId: SUMMON, level: 1 }] }],
      4000
    );
    const sf = createStarfield(cfg, 'move-summon4');
    const start = sf.playerEntryIndex;
    // (a) 星域容器、**不迁移**：首次召唤 tick ＝ 模块冷却走完（`cool_first` ⇒ `cooldown_ticks 200`），
    //     ★ 引擎的“剩余冷却”在**结算阶段**推进 ⇒ 首次触发落在第 200/201 tick（同一实现内确定）。
    let firstTick = -1;
    for (let i = 0; i < 600; i += 1) {
      sf.step();
      if (firstTick < 0 && summonsIn(sf, start, SUMMON).length === 1) firstTick = sf.runTicks;
    }
    const u = summonsIn(sf, start, SUMMON)[0] || null;
    // 出场状态（只取**与模块配置直接对应**且不受其它模块加成影响的字段：
    //   临时单位标记 / 召唤标记 / 归属模块 / 存在时间需求 2400 / 本体血量 40 / 召唤图标随模块）
    const attrsOk =
      !!u && u.temp === true && u.isSummon === true && u.summonMod === SUMMON &&
      (u.tempLifeNeed || 0) === 2400 && u.hull.hpMax === 40 && !!u.summonIcon;
    const neverDup = summonsIn(sf, start, SUMMON).length === 1; // 上限 1 生效（600t 内不补召）
    const ticking = !!u && u.tempLeft < (u.tempLifeNeed || 0);
    const timelineOk = (firstTick === 200 || firstTick === 201) && attrsOk && neverDup && ticking;
    // (b) ★ **真因实证（差异化对照）**：同一 preset 建两个实例（都在星域模式、都只有 1 个星区）——
    //     · `local`：**不注入钩子** ⇒ 引擎原“**本实例计数**”分支（单星区时 ≡ 星域范围计数 ⇒ 行为应不变）；
    //     · `zero` ：注入“**恒返回 0**”的钩子 ⇒ 精确模拟**旧口径下“迁移到新星区后本区计数为 0”**的状态。
    //     预期：`local` 全程只召 1 只（上限 1 生效）；`zero` 不断增加 ⇒ 证明**重复召唤的真因就是计数口径**，
    //     而修复（星域范围计数）恰好把这一项纠正为“留在源区的召唤物继续占额”。
    const presetOf = () => ({
      allies: [{ type: 'combat', level: 5, modules: [{ moduleId: SUMMON, level: 1 }] }],
      enemies: [],
      sector: {},
    });
    const local = startBattle(presetOf(), { starfield: true });
    const zero = startBattle(presetOf(), { starfield: true, summonCountOf: () => 0 });
    if (local.ok && zero.ok) {
      local.battle.start();
      zero.battle.start();
      for (let i = 0; i < 600; i += 1) {
        local.battle.step();
        zero.battle.step();
      }
    }
    const countIn = (b) => (b ? b.units().filter((x) => x.alive && x.summonMod === SUMMON).length : -1);
    const localN = local.ok ? countIn(local.battle) : -1;
    const zeroN = zero.ok ? countIn(zero.battle) : -1;
    const causal = localN === 1 && zeroN >= 2; // 计数为 0 ⇒ 反复补召（真因）；本实例计数 ⇒ 上限守住
    add(
      '⑬ 零回归：不迁移时召唤时间线/出场状态/上限口径与既有实现一致；并用对照证明“计数口径”是真因',
      timelineOk && causal,
      `首次召唤 tick=${firstTick}（应 200/201＝cool_first 的 cooldown_ticks 200）；出场状态逐项=${attrsOk}；` +
        `600t 内始终 1 只=${neverDup}；存在时间推进中=${ticking}；` +
        `对照：本实例计数 ⇒ ${localN} 只（应 1）；计数恒 0 ⇒ ${zeroN} 只（应 ≥2，即重复召唤的真因）；` +
        `非星域玩法不注入 summonCountOf ⇒ 引擎走原分支（结构性零回归）`
    );
  });

  return { pass: checks.every((c) => c.pass), checks };
}

export default createStarfield;
