/* ===== systems/expedition.js —— 出征（星门 → 星域）与返回闭环【M3d】 =====
 * 定位：**基地与星域之间唯一的业务编排层**。三块职责各自只有一处实现，本文件只做"拼装"：
 *   · **基地侧账目**（扣出征费用 / `out` 增减 / 矿物入基地 / 货物并入研究站库）
 *     ⇒ 只在 `systems/base.js`（`deploySquadCheckIn` / `deploySquadIn` / `settleReturnIn`）；
 *   · **星域侧事实**（谁活着、在哪一区、带什么载荷、把单位摘出星域）
 *     ⇒ 只在 `systems/starfield.js`（`baseUnits` / `takeBackUnit` / `createStarfield(cfg, seed, {baseRefs})`）；
 *   · **本文件**：读该档配置（`deployCost` / 覆写 `playerUnits`）⇒ 干跑 ⇒ 落地 ⇒ 创建星域 ⇒
 *     返回/损毁**唯一结算**（把两侧结果拼起来交给界面）。
 *
 * ★★ 口径（用户已定；逐条对应本文件的实现）：
 *   ① **出征装配＝逐配置选数量**：`specs` ＝ `[{ id, n }]`，`n` ＝ **本次新增派遣数**
 *      （0..该配置空闲数 `count − out` ⇒ 超了才是 `tooMany` 硬拒绝）；
 *      ★★ **迭代 3：`Σ out ＋ Σ n` 不再受 `maxFleet` 拦截** —— 出战上限降级为「**费率分界**」
 *      （`r ＝ maxFleet − Σ 同时存活`：正常部分每艘 1× 单船费用，超出部分按 `overQuota` 加价）；
 *   ② **出征消耗资源**：费用＝该档星域配置的 `deployCost` ＝ **单船费用**（★ 迭代 2 口径：**每派出一艘收一次**
 *      ⇒ 正常段 n 艘扣 `n × deployCost`）＋ ★ 迭代 3 的**超出加价** `ceil(单船费 × (m + offset)^exponent)`；
 *      **损毁不返还**。★ **激活星域**＝**激活费**（`activateUnits × 单船费用`）**＋ 随行单位的派遣费**（合并成一个总价）；
 *   ③ **星域进行中可随时回基地屏**：离开星域地图即**挂起**（既有口径：地图视图不再驱动 tick），
 *      `out` **保持不变**（本文件不因"离开"做任何记账——挂起是界面层的事，见 `starfieldMapView`）；
 *   ④ **返回时携带矿物入基地**：走 `systems/base.js` 的 `gain` 口径 ⇒ **超出容量上限的部分丢弃**
 *      （`overflow`／`overflowTotal` 随回执返回，界面据此提示）；
 *   ⑤ **星域编号**：＝星域 `seed`（**界面用 `core/rng.js randomSeed()` 生成**，本文件**不含随机数**）；
 *      同编号 + 同装配 + 同配置 ⇒ **同星域**（生成器确定性口径）；
 *   ⑥ **返回/损毁单一结算**（`settleExpeditionIn`）——**主动返回 / 结束自动返回 / 阵亡销账**三条路径
 *      都走同一个入口、同一份账目代码：
 *      · **返回点＝「星门**类型**」星区**（★ 迭代 2 口径：判据读容器 `gateTypeId`（＝配置 `sideRules.playerEntryTypeId`，
 *        兜底 `data/sectorTypes` 的 `stargate.id`）与单位 `atGate`（**该单位所在星区的 `typeId` 等于星门类型**）
 *        ⇒ **任一**星门类型星区都可返回；★ **不再**按入场下标 `playerEntryIndex` 判定
 *        —— 旧口径下"在其它星门星区无法返回"是缺陷，已修）；
 *      · **主动返回**：`returnCheck` 判据（活 且 有归属 且 在星门星区 且 星域未结束）⇒ `settleExpeditionIn(mode:'unit')`；
 *      · **结束自动返回**：星域结束时**仍在星门星区存活**的基地单位自动返回；
 *      · **未返回**（阵亡 / 结束时不在星门星区）⇒ `count` 与 `out` **同步减**（**单位与费用都不返还**）；
 *      · **返回即修复**（星域侧 `takeBackUnit` ⇒ 满血满盾满能量、模块冷却归零；**等级与模块保留**）；
 *      · **矿物入基地**（超上限丢弃）、**已装货物入研究站库**（**按类型 + 等级堆叠**）。
 *
 * ★★ M3d 迭代（用户口径七项；本文件新增部分逐条对应）：
 *   ⑦ **战区左右箭头**：档位清单仍读注册表（`listBattlefronts`），箭头**循环**切换；仅一档 ⇒ 灰（`oneTier`）
 *     —— 见 `stargateViewIn` 的 `tierNav`（`canPrev/canNext/reason` 全由引擎给，界面不自算）；
 *   ⑧ **星门面板不显示编号**：`systems/expedition.js` 的 `stargateViewIn` 是**星门面板唯一数据源**，
 *     其字段里**没有** `seed`/编号（自检 ⑪ 断言）——编号只在星域侧（地图/侧栏）显示；
 *   ⑨ **同一时间只允许一个星域**：已开启时面板改显「星域剩余时间」（`field.remainingTicks`，读容器只读口径），
 *     且**不可另开别的档**（`fieldBusy`）；**但可继续派遣**（见 ⑩）；
 *   ⑩ **多次派遣（增援注入）**：`dispatchExpeditionIn` ⇒ **增量注入既有星域**（`starfield.reinforce`），
 *     不新建星域、不重置既有状态；登记 `out`、按费率分界计价扣费；★ 迭代 3 起**不再校验出战上限**
 *     （上限＝费率分界 ⇒ 超出只加价；`Σ 同时存活` 只用来算 `r`＝正常名额）；
 *   ⑪ **放弃星域**：`giveUpCheckIn`（无星域 ⇒ `noField`；**仍有存活的派遣单位** ⇒ `unitsAlive`）
 *     ＋ `giveUpExpedition`（走既有 `end` 结算路径；无存活本单位 ⇒ 无返回账目）；
 *   ⑫ **结束演出（变白）**：本文件**不驱动**演出（时序在界面）；与结算的接缝是**先结算、后开演**
 *     ——`settleExpeditionIn(mode:'end')` **幂等**（同一次运行只结算一次）⇒ 演出期间重复调用恒"无事可做"。
 *
 * ★★ M3d 迭代 2（用户口径七项；本文件新增/改动的部分）：
 *   ⑬ **渐变式变白**＝容器只读 `sectors[].whiten` / `sectorWhitenProgress(index)`（**引擎算好 0..1，界面只渲染**）；
 *   ⑭ **「激活星域」与「派遣」分离**（本文件口径）：
 *     · **激活** `activateExpeditionIn`（别名 `launchExpeditionIn`）⇒ **创建该档星域**，费用＝**激活费**
 *       `activateUnits × 单船费用` **＋ 随行单位的派遣费**（★ 迭代 3 合并求和、只给一个总价）；
 *       ★ **允许零单位激活**（空星域先存在、之后再派遣；零单位时只扣激活费 ⇒ **激活不占出战名额**）；
 *     · **派遣** `dispatchExpeditionIn` ⇒ 向**既有**星域**增量注入** n 艘（n ≥ 1），费用＝费率分界合计；
 *     · 两者各有独立干跑/落地、**同一份校验口径**（干跑 ≡ 落地）、失败**两侧零改动**；
 *       ★ **迭代 3：出战上限不再拦截**（`Σ 同时存活` 只用于定价，超出部分加价）；
 *   ⑮ **返回判据按「星门类型」**（见上 ⑥ 的星号行）：`returnCheck` 用 `atGate`，非星门类型才报 `notAtGate`；
 *   ⑯ **费用按单位计**：单船费用 `deployCostOf(id)` / 激活费 `activateCostOf(id)` / 缩放 `scaleCost`
 *      / ★ 迭代 3 的**超出加价** `overQuotaRateOf(id)` + `dispatchPriceOf(id, n, r)`（**唯一计价函数**）；
 *      面板与视图只读它们（`view.unitCost`/`activateUnits`/`activateCost`/`cost`/`price`），**界面不做乘法/加法**；
 *   ⑰ **变速器恢复**：与本文件无关（唯一入口 `core/tick.js` 的 `ticker.restore()`）；本文件的自检 ㉑ 断言其语义。
 *
 * ★ 零回归：星域的**既有调试手填路径完全保留**——那种星域的单位**没有归属标签**（`baseUnits` 为空），
 *   本文件既不会给它记账、也不会拦它；`returnCheck` 对它稳定返回 `notDeployed`。
 * ★ 确定性：本文件**无随机、无时间戳**（种子外部给）；同输入 ⇒ 同输出。
 */
import * as base from './base.js';
import { createStarfield } from './starfield.js';
import { ticker } from '../core/tick.js'; // ★ 仅自检用：断言"变速器恢复"的唯一入口 `restore()` 的语义
import { STARFIELD_IDS, getStarfield as getStarfieldCfg } from '../data/starfields/index.js';
import { SHIPS, SHIP_IDS } from '../data/ships/index.js'; // ★ 仅自检用：挑"首个可建造船型"造样本配置
import { BASE_BUILDINGS } from '../data/baseBuildings/index.js'; // ★ 仅自检用：把样本船坞拉到配置顶（放开容量）
// ★ 仅自检用：核对主按钮 `primary.labelKey` 的词条在**每个语言字典**里都存在
//   （引擎本身**不含任何提示文字** —— 本导入只用于断言，不参与任何业务计算；与 `systems/base.js` 同体例）
import { i18n } from '../i18n/index.js';

/** ★ 已做过「结束结算」的星域（同一次运行只结算一次；`WeakSet` ⇒ 不持有引用、不阻碍回收）
 *  · `sync`（阵亡销账）**不受它限制**（它是增量的：只处理"此刻已阵亡且尚未销账"的单位）。 */
const fieldResolved = new WeakSet();

/** ★★ **激活星域的激活费倍数·兜底值**（配置字段 `activateUnits` 缺失/非法时才用；内置三档均已显式配置）
 *  · 口径＝"多少个**单船费用**"：激活一次性扣 `activateUnits × deployCost`（**与随行单位数无关**）；
 *  · 数值**进配置文件**（`data/starfields/<id>.js`），本常量只是引擎兜底（体例同 `collapseRingTicks`）。 */
const DEFAULT_ACTIVATE_UNITS = 2;

/** ★ **战区（难度档）只读清单**（星门面板的"战区列表"数据源；**每次调用返回新数组 + 新对象**）：
 *  · 全部字段**读配置**（名称词条 / 难度描述词条 / 半径 / 持续时间 / 出征费用），界面**零硬编码**；
 *  · `affordable` ＋ `reason` ＝ 走基地侧**唯一资源校验**（`base.canAfford` / `base.reasonOf`）——
 *    界面**只读**，不自己比资源。 */
export function listBattlefronts() {
  return STARFIELD_IDS.map((id) => {
    const d = getStarfieldCfg(id) || {};
    const deployCost = { ...(d.deployCost || {}) };
    // `reason` ＝ `null`（付得起）/ `{code:'badCost'}` / **补上 code 的资源缺口对象**（`{code:'notAffordable',
    // resource, need, have}`）—— 补 code 只为让界面能用**同一套** `reasonText`（界面不造词、不自己判断）
    const short = base.reasonOf(deployCost);
    const reason = short === null ? null : short.code ? short : { code: 'notAffordable', ...short };
    // ★ 迭代 2：**激活费**（＝`activateUnits ×` 单船费用）也在这里算好 ⇒ 界面只读、不自己乘
    const activateCost = activateCostOf(id);
    const actShort = base.reasonOf(activateCost);
    const activateReason = actShort === null ? null : actShort.code ? actShort : { code: 'notAffordable', ...actShort };
    return {
      id,
      nameKey: d.nameKey || `starfield.${id}`,
      descKey: d.descKey || null,
      radius: Number.isFinite(d.radius) ? d.radius : 0,
      durationTicks: Number.isFinite(d.durationTicks) ? d.durationTicks : 0,
      deployCost, // ★ 单船费用（正常段每派出一艘收一次）
      activateUnits: activateUnitsOf(id), // ★ 激活费倍数（多少个单船费用）
      activateCost, // ★ 激活费（激活一次性收取的固定部分）
      overQuota: overQuotaRateOf(id), // ★ 迭代 3：超出「出战上限（费率分界）」部分的加价费率
      affordable: reason === null,
      reason,
      activateAffordable: activateReason === null,
      activateReason,
    };
  });
}

/** ★ 该档星域的**单船费用**（只读；未知档 ⇒ `{}` ＝ 免费）
 *  ★ M3d 迭代 2 口径：**每派出一艘单位收一次**（正常段 n 艘 ⇒ 扣 `n ×` 本费用）；
 *  ★ 迭代 3：**只是"正常名额内"的单价** —— 超出正常名额的部分另按 `overQuota` 的费率加价。 */
export function deployCostOf(starfieldId) {
  const d = getStarfieldCfg(starfieldId);
  return d && d.deployCost ? { ...d.deployCost } : {};
}

/** ★ 该档星域的**激活费倍数**（读配置字段 `activateUnits`；缺失/非法 ⇒ 兜底常量 `DEFAULT_ACTIVATE_UNITS`） */
export function activateUnitsOf(starfieldId) {
  const d = getStarfieldCfg(starfieldId);
  const a = d && d.activateUnits;
  return Number.isInteger(a) && a > 0 ? a : DEFAULT_ACTIVATE_UNITS;
}

/** ★★ **按"多少个单位"换算实际要收的费用**（纯函数、只读、确定性、无副作用）：
 *  · `units ≤ 0` ⇒ `{}`（零消耗）；
 *  · 否则逐资源键 `key → 单船费用 × units`（**只保留 > 0 的项** ⇒ 键集合与单船费用一致，展示口径不变）；
 *  · 唯一用途：派遣 n 艘 ⇒ `n ×` 单船费用；激活 ⇒ 倍数由 `activateCostOf` 走同一函数。 */
export function scaleCost(cost, units) {
  const n = Number.isFinite(units) ? Math.trunc(units) : 0;
  const out = {};
  if (n <= 0) return out;
  for (const [k, v] of Object.entries(cost || {})) {
    const per = Number.isFinite(v) ? v : 0;
    if (per > 0) out[k] = per * n;
  }
  return out;
}

/** ★★ **多份费用相加**（**合并求和**；M3d 迭代 3 用户口径："合并求和显示，不单列"）：
 *  · 逐资源键相加；`> 0` 的项才保留（键集合＝各份键的并集，展示口径与单船费用一致）；
 *  · 唯一用途：**激活星域**时的总价 ＝ 激活费 ＋（随行单位的派遣费）⇒ **界面/回执只给一个数**。 */
export function sumCosts(...costs) {
  const out = {};
  for (const c of costs) {
    for (const [k, v] of Object.entries(c || {})) {
      const add = Number.isFinite(v) ? v : 0;
      if (add <= 0) continue;
      out[k] = (Number.isFinite(out[k]) ? out[k] : 0) + add;
    }
  }
  return out;
}

/** ★ 该档星域的**激活费**（激活一次性收取）＝ `activateUnits ×` 单船费用（只读、配置驱动） */
export function activateCostOf(starfieldId) {
  return scaleCost(deployCostOf(starfieldId), activateUnitsOf(starfieldId));
}

/** ★★ **M3d 迭代 3：超出「出战上限（费率分界）」的加价费率·兜底值**
 *  （配置字段 `overQuota` 缺失/非法时才用；内置三档均已显式配置 ⇒ 正常路径读配置）。
 *  · **`exponent: 1.5`** —— 超出部分总价 ＝ `单船费 × (m + offset) ^ 1.5`（**幂指数常量，注释注明**）；
 *  · `offset: 1` —— 保证**第一艘超出就已经加价**（`m ＝ 1 ⇒ 2 ^ 1.5 ≈ 2.83×`，不会等于正常价）。 */
const DEFAULT_OVER_QUOTA = { exponent: 1.5, offset: 1 };

/** ★ 该档星域的**超出加价费率**（只读；读配置字段 `overQuota`；缺失/非法 ⇒ 兜底常量 `DEFAULT_OVER_QUOTA`）
 *  @returns `{ exponent, offset }`（**新对象**，调用方改不掉配置） */
export function overQuotaRateOf(starfieldId) {
  const d = getStarfieldCfg(starfieldId);
  const oq = d && d.overQuota;
  if (!oq || typeof oq !== 'object' || Array.isArray(oq)) return { ...DEFAULT_OVER_QUOTA };
  const exponent = Number.isFinite(oq.exponent) && oq.exponent > 0 ? oq.exponent : DEFAULT_OVER_QUOTA.exponent;
  const offset = Number.isInteger(oq.offset) && oq.offset >= 1 ? oq.offset : DEFAULT_OVER_QUOTA.offset;
  return { exponent, offset };
}

/** ★★ **M3d 迭代 3：派遣计费的唯一函数**（纯函数、只读、确定性、无副作用、**唯一公式处**）——
 *  用户口径：**出战上限不再拦截派遣**，它只是一条「**费率分界**」：
 *   · 设本次派遣 `n` 艘、**剩余正常名额** `r`（＝`maxFleet − Σ 同时存活`，可为 0 / 负数）；
 *   · **正常部分** `normal ＝ min(n, max(0, r))` ⇒ 每艘收 **1×** 单船费用；
 *   · **超出部分** `m ＝ n − normal`（m ≥ 0）⇒ **一整块**加价：
 *       `overCost ＝ 单船费用 × (m + offset) ^ exponent`
 *     （★ **第一艘超出就已经加价**：`m ＝ 1` ⇒ `(1 + offset) ^ exponent` 倍；
 *      ★ 不是"每艘各按 m 计"再累加，而是**超出部分整体**用同一个幂次 —— 与用户口径逐字一致）；
 *   · **总价 ＝ 正常部分 ＋ 超出部分**（★ 界面/回执**合并求和、只给一个数**，不并列两段）；
 *   · **取整**：逐资源键 `Math.ceil`（**向上取整，唯一取整口径**）—— 避免出现分毫数字，
 *     且**加价绝不因取整而少收**；`n ≤ 0` ⇒ `{}`（与 `scaleCost` 同体例：零艘＝零费用）。
 *  @param starfieldId 档位 id（单船费用与加价费率都从它读配置）
 *  @param n           本次派遣艘数（激活时＝随行单位数）
 *  @param remaining   **剩余正常名额** `r`（＝`maxFleet − Σ 同时存活`；激活新星域 ⇒ Σ 存活 ＝ 0）
 *  @returns `{ cost, normal, over, normalCost, overCost, remaining, rate }`
 *           （`cost` ＝ **合并后的唯一结论**；`normalCost`/`overCost` 仅供自检/调试核对，界面不并列显示） */
export function dispatchPriceOf(starfieldId, n, remaining) {
  const unit = deployCostOf(starfieldId);
  const rate = overQuotaRateOf(starfieldId);
  const count = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
  const r = Number.isFinite(remaining) ? Math.trunc(remaining) : 0;
  const normal = Math.min(count, Math.max(0, r));
  const over = count - normal; // ≥ 0
  const keys = Object.keys(unit).filter((k) => Number.isFinite(unit[k]) && unit[k] > 0);
  const cost = {};
  const normalCost = {};
  const overCost = {};
  if (count > 0) {
    const mult = over > 0 ? Math.pow(over + rate.offset, rate.exponent) : 0;
    for (const k of keys) {
      const per = unit[k];
      const nc = per * normal;
      const oc = over > 0 ? Math.ceil(per * mult) : 0;
      if (nc > 0) normalCost[k] = nc;
      if (oc > 0) overCost[k] = oc;
      const total = nc + oc;
      if (total > 0) cost[k] = total;
    }
  }
  return { cost, normal, over, normalCost, overCost, remaining: r, rate };
}

/** ★★ **左右箭头切档（唯一口径）**：`frontId` 按 `step`（±1）在**档位清单**里**循环**移动
 *  · 清单顺序＝`listBattlefronts()`（＝注册表 `STARFIELD_IDS` 的顺序 ⇒ **确定可复现**）；
 *  · **循环**：末尾 +1 ⇒ 回到首个；首个 −1 ⇒ 到末尾；
 *  · 未知/空 `frontId` ⇒ 落到**首个**（再按 `step` 移动）；
 *  · 仅一档 ⇒ 恒返回该档（箭头由 `stargateViewIn` 判灰，见 `tierNav.canPrev/canNext`）。
 *  ★ 界面**只调本函数**取值 ⇒ 不自己算下标、不自已取模。 */
export function cycleFrontId(frontId, step) {
  const ids = listBattlefronts().map((f) => f.id);
  const n = ids.length;
  if (!n) return '';
  const cur = frontId === undefined || frontId === null ? '' : String(frontId);
  const i = ids.indexOf(cur);
  const from = i < 0 ? 0 : i;
  const k = Number.isFinite(step) ? Math.trunc(step) : 0;
  return ids[(((from + k) % n) + n) % n];
}

/** ★ **"星域还开着"的判据**（**唯一口径**）：存在容器、且**未结束/未停止/未结算/未处于结束演出**。
 *  · 用于两处：① 是否可**另开新档**（开着 ⇒ 只能继续派遣或放弃）；② 面板显"剩余时间"还是显档位箭头。 */
export function fieldLive(sf) {
  return !!sf && typeof sf === 'object' && !sf.finished && !sf.settled && !sf.stopped && !sf.collapsing;
}

/** ★★ **「激活星域」/「派遣」的干跑**（**唯一入口**；`state` 参数版 ⇒ 自检可隔离）。两种 mode：
 *  · `'activate'`：当前**没有**开着的星域 ⇒ **创建该档星域**（＝激活）。
 *    ★ 迭代 2：**允许零单位**（`specs` 为空 ⇒ 只收激活费、星域先空着）；带随行单位时，仍走基地侧
 *      **唯一装配校验** `deploySquadCheckIn`（形状/数量/空闲数/费用）⇒ 随行单位照常占用名额。
 *    ★★ 迭代 3 费用＝**激活费** `activateCostOf(id)`（＝`activateUnits × 单船费用`）**＋ 随行单位的派遣费**
 *      （随行那部分用 `dispatchPriceOf(id, Σn, maxFleet)` —— 此时星域还是空的 ⇒ 全是正常段）；
 *      ★ **合并求和、只给一个总价** `cost`（用户口径："合并求和显示，不单列"）。
 *  · `'dispatch'`：当前**已开着同档**星域 ⇒ **增量派遣** n 艘（`n ≥ 1`）。
 *    费用＝`dispatchPriceOf(id, Σn, maxFleet − Σ 存活)` 的合计（正常段 ＋ 超出加价）。
 *    ★★ 迭代 3：**出战上限不再拦截**（`deployLimit` 已从本函数彻底移除）——
 *      超出上限只是加价（`price.over` / `remaining` 允许为负）。
 *  · 已开着**别的档** ⇒ `fieldBusy`（同一时间只允许一个星域）。
 *  校验顺序：`unknown`（档位）⇒ `fieldBusy`（开着别的档）⇒ 装配/费用（`deploySquadCheckIn`）。
 *  **任一步不过 ⇒ 基地与星域两侧零改动。**
 *  @param state 基地状态（界面传 `base.baseState`）
 *  @param specs `[{ id, n }]`（`n` ＝ 本次**新增**派遣数；激活时可空数组）
 *  @param opts  `{ starfieldId, current?, seed? }`（`current` ＝ 当前星域容器）
 *  @returns `{ ok:true, mode:'activate'|'dispatch', starfieldId, cost, price, activateCost?, unitCost?,
 *              items, total, used, limit, remaining, units, refs, alive? }` / `{ ok:false, reason:{ code, ... } }`
 *           （**两侧零改动**）
 *  ★ 编号（`seed`）**不在这里校验**：干跑只回答"这样装配能不能派出"；
 *    编号由界面在**点击激活时**用 `core/rng.js randomSeed()` 生成并传给 `activateExpedition`（见下）。 */
export function previewExpeditionIn(state, specs, opts = {}) {
  const starfieldId = opts.starfieldId === undefined || opts.starfieldId === null ? '' : String(opts.starfieldId);
  const tier = getStarfieldCfg(starfieldId);
  if (!tier) return { ok: false, reason: { code: 'unknown', id: starfieldId } };
  const cur = opts.current || null;
  const live = fieldLive(cur);
  if (live && String(cur.configId) !== starfieldId) {
    // ★ 同一时间只允许一个星域 ⇒ 已开着**别的档**时不能再开新档（但可继续派遣/放弃）
    return { ok: false, reason: { code: 'fieldBusy', starfieldId, openAt: String(cur.configId) } };
  }
  const list = Array.isArray(specs) ? specs : [];

  /* ---------- ① 激活（无开着的星域）：费用＝**激活费 ＋ 随行单位的派遣费**（合并求和、一个数） ---------- */
  if (!live) {
    // ★ 迭代 3：激活的**总价** ＝ 激活费（固定 `activateUnits ×` 单船费用）＋ 随行单位按**同一费率函数**
    //   算出的派遣费 ⇒ 界面上只显示**一个合并后的数**（用户口径："合并求和显示，不单列"）。
    //   激活时星区是新建的空场 ⇒ **Σ 同时存活 ＝ 0** ⇒ 剩余正常名额 `r ＝ maxFleet`。
    const activateCost = activateCostOf(starfieldId); // ＝ 倍数 × 单船费用（与随行单位数无关）
    // ★ 迭代 2：**"零单位激活"按 Σn ＝ 0 判定**（不是"数组为空"）—— 界面/控制台把"选了 0 艘的配置"也传上来时
    //   语义应与空数组**完全一致**（空星域先存在）；但若条目本身非法（`badSpec`/未知配置/坏数量）⇒ 照常走
    //   基地侧唯一校验，报出与"派遣"**同源**的原因码，绝不静默吞掉。
    const sum0 = base.deploySquadTotalsIn(state, list);
    const zeroUnits = !sum0.badSpec && !sum0.badN.length && !sum0.unknown.length && sum0.total === 0;
    const limit0 = sum0.limit;
    const price0 = dispatchPriceOf(starfieldId, sum0.total, limit0); // r ＝ maxFleet − 0（新星域还没有单位）
    const cost = sumCosts(activateCost, price0.cost); // ★ **合并求和**（激活费 ＋ 随行派遣费）
    let chk = null;
    if (!zeroUnits) {
      // 有随行单位 ⇒ 走基地侧唯一装配校验（含空闲/费用；★ 迭代 3 起**不再有"名额不足"拒绝**）
      chk = base.deploySquadCheckIn(state, list, cost);
      if (!chk.ok) return { ok: false, reason: chk.reason };
    } else {
      // ★ 零单位激活：**只有激活费**（`price0.cost` 为空 ⇒ 合并后仍＝激活费），只校验"付得起"
      const short = base.reasonOf(cost);
      if (short) return { ok: false, reason: short.code ? short : { code: 'notAffordable', ...short } };
      const tot = base.deploySquadTotalsIn(state, []);
      chk = {
        ok: true,
        items: [],
        total: 0,
        used: tot.used,
        limit: tot.limit,
        remaining: Math.max(0, tot.limit - tot.used),
      };
    }
    const conv = chk.items.length ? base.squadUnitsIn(state, chk.items) : { ok: true, units: [], refs: [] };
    if (!conv.ok) return { ok: false, reason: conv.reason };
    return {
      ok: true,
      mode: 'activate',
      starfieldId,
      seed: opts.seed === undefined ? null : opts.seed,
      cost,
      activateCost,
      unitCost: deployCostOf(starfieldId),
      // ★ `price` 只描述**派遣那一部分**（`normal`/`over`/`remaining`/`rate`；`cost` ＝ 随行单位的派遣费）——
      //   界面**不读**它做算术，只用它显示"正常 r 艘 / 超出 m 艘加价"的**艘数**分界说明；
      //   真正要收的钱是上面的 `cost`（＝ 激活费 ＋ 随行派遣费，**一个数**）。
      price: price0,
      items: chk.items,
      total: chk.total,
      used: chk.used,
      limit: chk.limit,
      remaining: chk.remaining,
      units: conv.units,
      refs: conv.refs,
    };
  }

  /* ---------- ② 派遣（已开着同档星域）：费用＝**费率分界**计费（正常部分 + 超出加价），**不拦截** ---------- */
  const unitCost = deployCostOf(starfieldId);
  const sums = base.deploySquadTotalsIn(state, list); // 纯汇总（只为按"艘数"计价；随后同一口径复算）
  // ★ 迭代 3：剩余正常名额 `r ＝ maxFleet − Σ **同时存活**`（容器只读事实）——**只用于计价，不再拒绝**
  const alive = aliveDeployedOf(cur);
  const price = dispatchPriceOf(starfieldId, sums.total, sums.limit - alive);
  const cost = price.cost;
  const chk = base.deploySquadCheckIn(state, list, cost); // ★ 空装配 ⇒ 这里会以 `emptyDeploy` 拒绝（派遣必须 ≥ 1 艘）
  if (!chk.ok) return { ok: false, reason: chk.reason };
  const conv = base.squadUnitsIn(state, chk.items);
  if (!conv.ok) return { ok: false, reason: conv.reason };
  return {
    ok: true,
    mode: 'dispatch',
    starfieldId,
    cost,
    unitCost,
    price,
    items: chk.items,
    total: chk.total,
    used: chk.used,
    limit: chk.limit,
    remaining: chk.remaining,
    alive,
    units: conv.units,
    refs: conv.refs,
  };
}

/** ★ **同时存活的派遣单位数**（**引擎派生、只读**；＝容器 `baseUnits` 里 `alive` 的条数）。
 *  · ★★ 迭代 3 用途：**费率分界的计价基准**（`r ＝ maxFleet − 本函数`：正常段艘数）与面板只读显示；
 *    —— 它**不再是**任何动作的否决判据（出战上限不拦截）；
 *  · 与 `out` 的关系：`out` 是**基地账目**（阵亡销账是增量的、每 tick 一次），本函数是**星域事实**
 *    ⇒ 两者短暂不一致时，**计价以星域事实为准**（用户口径：`r ＝ maxFleet − Σ 同时存活`）。 */
export function aliveDeployedOf(sf) {
  const views = sf && Array.isArray(sf.baseUnits) ? sf.baseUnits : [];
  let n = 0;
  for (const v of views) if (v.alive) n += 1;
  return n;
}

/** ★ 上一条的**单例包装**（界面用：读唯一基地状态） */
export function previewExpedition(specs, opts = {}) {
  return previewExpeditionIn(base.baseState, specs, opts);
}

/** ★ **出征装配的纯汇总**（只读、不校验；界面 chips 与"能不能出征"读**同一册子**）：
 *  即便干跑失败（超编 / 资源不足 / 空装配），界面也能把"出战上限 / 已在外 / 本次派遣 / 余量"显示出来。 */
export function expeditionTotals(specs) {
  return base.deploySquadTotals(specs);
}

/** ★★ **激活星域落地**（`state` 参数版；＝创建该档星域）——顺序刻意如此（**任一步失败 ⇒ 基地零改动**）：
 *  ① 干跑（`previewExpeditionIn` ⇒ `mode:'activate'`；含**激活费 ＋ 随行单位派遣费**的**合并总价**与随行装配合法性）；
 *  ② **先创建星域**（纯函数、不碰基地）：失败 ⇒ 直接返回，基地一个字段都没动；
 *  ③ **后写基地账目**：有随行单位 ⇒ `deploySquadIn`（扣**合并总价** ＋ `out` 增加）；**零单位** ⇒ `spendIn`
 *     （只扣**激活费**；`deploySquadIn` 会以 `emptyDeploy` 拒绝空装配 ⇒ 不能走它）。
 *     理论上不会失败（刚校验过、中间无改动）；若仍失败 ⇒ 返回失败并**丢弃**刚创建的星域（不交给界面）。
 *  ★ **允许零单位激活**：空星域先存在（`playerUnits: []`），之后再「派遣」逐艘注入。
 *  ★ **费用（★ 迭代 3 合并口径）**＝ **激活费**（`activateUnits × 单船费用`，**与随行单位数无关**）
 *    **＋** 随行单位按**同一费率函数 `dispatchPriceOf`** 算出的**派遣费**（激活时星域还是空的 ⇒
 *    剩余正常名额 `r ＝ maxFleet`，随行超过 `r` 的部分照常按 `(m+1)^1.5` 加价）；
 *    ⇒ 界面把这两笔**合并成一个数**显示（用户口径："合并求和显示，不单列"）。
 *  @returns `{ ok:true, starfield, seed, starfieldId, cost, price, spent, items, total, used, limit, remaining }`
 *           / `{ ok:false, reason }`（**基地状态零改动**） */
export function activateExpeditionIn(state, specs, opts = {}) {
  const seed = opts.seed;
  if (seed === undefined || seed === null || seed === '') return { ok: false, reason: { code: 'badSeed' } };
  const pre = previewExpeditionIn(state, specs, opts);
  if (!pre.ok) return { ok: false, reason: pre.reason };
  // 已开着星域 ⇒ 只能"派遣"（不能再激活一个）
  if (pre.mode !== 'activate') {
    return { ok: false, reason: { code: 'fieldBusy', starfieldId: pre.starfieldId, openAt: pre.starfieldId } };
  }
  const tier = getStarfieldCfg(pre.starfieldId);
  // ★ 配置**深拷贝**后覆写 `playerUnits`（既有调试手填路径不受影响：这是本次激活专用的副本）
  const cfg = JSON.parse(JSON.stringify(tier));
  cfg.playerUnits = pre.units.map((u) => ({
    shipId: u.shipId,
    count: u.count,
    level: u.level,
    modules: u.modules.map((m) => ({ moduleId: m.moduleId, level: m.level })),
  }));
  let sf = null;
  try {
    sf = createStarfield(cfg, pre.seed, { baseRefs: pre.refs });
  } catch (err) {
    // ★ 生成失败（配置/编号异常）⇒ 报 `unknown` 并带原始信息；基地**零改动**、刚建的星域**不交付**
    return { ok: false, reason: { code: 'unknown', id: pre.starfieldId, detail: err && err.message ? String(err.message) : null } };
  }
  // ★ 有随行单位 ⇒ 走唯一装配落地（登记 `out` ＋ 扣激活费）；零单位 ⇒ 只扣激活费（唯一扣减口径 `spendIn`）
  const dep = pre.items.length
    ? base.deploySquadIn(state, specs, pre.cost)
    : base.spendIn(state, pre.cost);
  if (!dep.ok) return { ok: false, reason: dep.reason }; // 基地零改动；刚建的星域**不交付**
  return {
    ok: true,
    starfield: sf,
    seed: sf.seed,
    starfieldId: pre.starfieldId,
    cost: pre.cost,
    price: pre.price, // ★ 迭代 3：随行单位的计价明细（`cost` 才是**激活费 ＋ 随行派遣费**的合并总价）
    spent: dep.spent,
    items: dep.items || [],
    total: pre.total,
    used: pre.used,
    limit: pre.limit,
    remaining: pre.remaining,
  };
}

/** ★ **兼容别名**（控制台/既有文档口径 `LS.expedition.launch*`）：语义已按迭代 2 变更为
 *  **「激活星域」**（允许零单位；★ 迭代 3 起总价＝激活费 ＋ 随行单位的派遣费，合并成一个数）
 *  —— 单例包装见 `activateExpedition`。 */
export const launchExpeditionIn = activateExpeditionIn;

/** ★ **激活星域的落地·单例包装**（界面用：读唯一基地状态） */
export function activateExpedition(specs, opts = {}) {
  return activateExpeditionIn(base.baseState, specs, opts);
}

/** ★ 上一条的**兼容别名**（控制台 `LS.expedition.launch(specs, opts)`） */
export const launchExpedition = activateExpedition;

/** ★★ **多次派遣落地**（＝把新单位**增量注入既有星域**；`state` ＋ 容器参数版）：
 *  ① 干跑（`previewExpeditionIn`；此时 `opts.current` 是既有星域 ⇒ 必然走 `mode:'dispatch'`：
 *     档位一致、装配合法、**费用按「费率分界」算**（正常 `r` 艘 × 单船费用 ＋ 超出部分加价；
 *     ★ 迭代 3 起**出战上限不再拦截**）付得起）；
 *  ② **先写星域侧**（`sf.reinforce`：纯追加新单位，**不新建星域、不重建星区、不动既有单位/星区状态**）；
 *  ③ **后写基地账目**（`base.deploySquadIn`：扣**本次费用**（＝干跑算好的 `pre.cost`）＋ 各配置 `out` 增加、`count` 不变）。
 *  ★ **失败 ⇒ 基地与星域两侧零改动**：星域侧若在 ② 之后失败（容器级判据）⇒ 先 `undoReinforce` 把刚注入的
 *    单位**原样摘除**（不带任何业务语义、不计账）⇒ 星域侧回到注入前；基地侧此时**尚未写入**。
 *    ③ 不可能失败（干跑与落地共用同一份校验、且中间无插入）；万一失败 ⇒ 同样 `undoReinforce` 回滚。
 *  @returns `{ ok:true, starfieldId, cost, price, spent, items, total, used, limit, remaining, alive, entryIndex, unitIds }`
 *           / `{ ok:false, reason }`（**两侧零改动**） */
export function dispatchExpeditionIn(state, sf, specs, opts = {}) {
  // ★ 档位**默认＝既有星域自己的档**（派遣只可能注入**当前星域**⇒ 不传 `starfieldId` 也必须成立；
  //   否则干跑会以空档位落到 `unknown`，与"派遣"语义不符）
  const fieldId = sf && sf.configId !== undefined && sf.configId !== null ? String(sf.configId) : '';
  const opts2 = opts.starfieldId === undefined || opts.starfieldId === null || opts.starfieldId === ''
    ? { ...opts, starfieldId: fieldId }
    : opts;
  const pre = previewExpeditionIn(state, specs, { ...opts2, current: sf });
  if (!pre.ok) return { ok: false, reason: pre.reason };
  if (pre.mode !== 'dispatch') return { ok: false, reason: { code: 'noField' } };
  // ★ 注入清单：`units` 与 `items` **一一对应**（同一翻译点 `base.squadUnitsIn` 产出）⇒ 逐批带上 configId
  const list = pre.items.map((it, i) => {
    const u = pre.units[i] || { shipId: null, count: 0, level: 1, modules: [] };
    return { shipId: u.shipId, count: it.n, level: u.level, modules: u.modules, configId: it.id };
  });
  const inj = sf.reinforce(list);
  if (!inj.ok) return { ok: false, reason: inj.reason }; // 星域侧未改动 ⇒ 基地未写入 ⇒ 两侧零改动
  // ★ 扣费**复用干跑算好的那一份**（＝`n × 单船费用`）⇒ 干跑与落地不可能各算一遍（口径唯一）
  const dep = base.deploySquadIn(state, specs, pre.cost);
  if (!dep.ok) {
    sf.undoReinforce(inj.unitIds); // ★ 回滚星域侧（原样摘除）⇒ 两侧零改动
    return { ok: false, reason: dep.reason };
  }
  return {
    ok: true,
    starfieldId: pre.starfieldId,
    cost: pre.cost,
    price: pre.price, // ★ 迭代 3：本次计价的明细（`normal`/`over`/`remaining`/`rate`；界面只读它做艘数分界说明）
    spent: dep.spent,
    items: dep.items,
    total: dep.total,
    used: dep.used,
    limit: dep.limit,
    remaining: dep.remaining,
    alive: pre.alive + pre.total, // 派遣后的**同时存活数**（引擎派生值，界面只读）
    entryIndex: inj.entryIndex,
    unitIds: inj.unitIds.slice(),
  };
}

/** ★ 上一条的**单例包装**（界面用：当前星域取 `ui/starfieldSession` 的唯一持有者） */
export function dispatchExpedition(sf, specs, opts = {}) {
  return dispatchExpeditionIn(base.baseState, sf, specs, opts);
}

/** ★★ **放弃星域的可用性判据**（纯查询、**不改状态**；界面据此决定按钮灰不灰 + 为什么）：
 *  ① 无星域 ⇒ `noField`；
 *  ② **仍有存活的派遣单位** ⇒ `unitsAlive`（★ 用户口径：只要星域里还有活着的派遣单位就**不得放弃**）；
 *  ③ 其余（无星域 / 活单位已全部返回或销毁）⇒ 可放弃。
 *  @returns `{ ok:true, alive, configId }` / `{ ok:false, reason:{ code, ... } }` */
export function giveUpCheckIn(state, sf) {
  if (!sf || typeof sf !== 'object') return { ok: false, reason: { code: 'noField' } };
  const alive = aliveDeployedOf(sf);
  if (alive > 0) return { ok: false, reason: { code: 'unitsAlive', alive, configId: String(sf.configId || '') } };
  return { ok: true, alive, configId: String(sf.configId || '') };
}

/** ★★ **放弃星域落地**（＝**立刻结束**该星域；走既有的 `end` 结算路径）：
 *  · 先判据（`giveUpCheckIn`；不通过 ⇒ **零改动**、返回原因）；
 *  · 再走**唯一结算入口** `settleExpeditionIn(mode:'end')`——此时**无存活的派遣单位**
 *    ⇒ 通常"无事可做"（`skipped`）；若存在**阵亡未销账**的单位，它照样按**损毁**记账（口径一致）；
 *  · **关闭星域**（把当前星域清空）由界面完成（`ui/starfieldSession.setStarfield(null)`）——
 *    本层（systems）不碰界面状态（体例同其余编排函数）。
 *  @returns `{ ok:true, report }`（`report` 可能是 `{skipped:true}`）/ `{ ok:false, reason }` */
export function giveUpExpeditionIn(state, sf) {
  const chk = giveUpCheckIn(state, sf);
  if (!chk.ok) return { ok: false, reason: chk.reason };
  const report = settleExpeditionIn(state, sf, { mode: 'end' });
  if (report && report.ok === false) return { ok: false, reason: report.reason };
  return { ok: true, report: report || null, alive: chk.alive, configId: chk.configId };
}

/** ★ 上一条的**单例包装**（界面用） */
export function giveUpExpedition(sf) {
  return giveUpExpeditionIn(base.baseState, sf);
}

/** ★ **主动返回的可用性判据**（**纯查询、不改状态**；界面据此决定"返回基地"按钮灰不灰 + 为什么）：
 *  ① 星域存在且**未结束/未停止** ⇒ 否则 `fieldOver`；
 *  ② 该单位是**基地派出的**（有归属标签）⇒ 否则 `notDeployed`（调试手填的星域走这条）；
 *  ③ 该单位**存活** ⇒ 否则 `unitDead`；
 *  ④ ★★ 该单位**位于任一「星门类型」星区**（容器只读字段 `atGate`，**按星区类型 id 判定**）⇒ 否则 `notAtGate`。
 *     ★ M3d 迭代 2 修复：判据**不再用入场下标**（`playerEntryIndex`）—— 星域里可能同时存在**多个**星门星区
 *       （`h1` 1~2 / `h2` 1~3 / `h3` 2~4 个）⇒ 旧口径下"在其它星门星区"会误判为 `notAtGate`、无法返回。
 *  @returns `{ ok:true, unitId, configId, ordinal, sectorIndex, sectorTypeId }` / `{ ok:false, reason:{code,...} }` */
export function returnCheck(sf, unitId) {
  const id = unitId === undefined || unitId === null ? '' : String(unitId);
  if (!sf || typeof sf !== 'object') return { ok: false, reason: { code: 'unknown', id } };
  if (sf.finished || sf.settled || sf.stopped) return { ok: false, reason: { code: 'fieldOver', id } };
  const view = (sf.baseUnits || []).find((u) => u.unitId === id);
  if (!view) return { ok: false, reason: { code: 'notDeployed', id } };
  if (!view.alive) return { ok: false, reason: { code: 'unitDead', id } };
  if (!view.atGate) {
    return {
      ok: false,
      reason: { code: 'notAtGate', id, sectorIndex: view.sectorIndex, sectorTypeId: view.sectorTypeId || null, gateTypeId: sf.gateTypeId || null },
    };
  }
  return {
    ok: true,
    unitId: id,
    configId: view.configId,
    ordinal: view.ordinal,
    sectorIndex: view.sectorIndex,
    sectorTypeId: view.sectorTypeId || null,
  };
}

/** ★ 由**容器只读快照**（`baseUnits`，含 `ore` / `cargos`）拼出**结算计划**（**不碰状态、不摘单位**）：
 *  · `returns` / `losses` ＝ 交给基地侧唯一结算 `settleReturnIn` 的载荷；
 *  · 与 `takeBackUnit` 交出的载荷**同源同口径**（都读 `hull.ore` / `cargos`）⇒ 干跑与落地不会走偏。 */
function planOf(views, isReturn) {
  const returns = [];
  const losses = [];
  for (const v of views) {
    if (isReturn(v)) {
      returns.push({ configId: v.configId, ore: v.ore, cargos: (v.cargos || []).map((c) => ({ ...c })) });
    } else {
      losses.push({ configId: v.configId });
    }
  }
  return { returns, losses };
}

/** ★ **基地侧账目干跑**：在**状态副本**上跑**同一个** `settleReturnIn` ⇒ 真实状态逐字段零改动。
 *  @returns `null`（可落地）/ 原因对象（不可落地 ⇒ 调用方**不得**摘出任何单位） */
function probeReturn(state, plan) {
  let probe = null;
  try {
    probe = JSON.parse(JSON.stringify(state));
  } catch (err) {
    return { code: 'badSpec', detail: err && err.message ? String(err.message) : null };
  }
  const r = base.settleReturnIn(probe, { returns: plan.returns, losses: plan.losses });
  return r.ok ? null : r.reason;
}

/** ★ 把「星域侧取回结果」+「基地侧账目回执」拼成**一份回执**（界面只读它 ⇒ 不再自己算数字） */
function reportOf(mode, takenList, acct) {
  const units = takenList.map((t) => ({
    unitId: t.unitId,
    configId: t.configId,
    ordinal: t.ordinal,
    alive: t.alive,
    inEntry: t.inEntry,
    atGate: t.atGate, // ★ 迭代 2：返回判据（按星区**类型**）——结算口径与 `returnCheck` 同源
    ore: t.ore,
    cargos: t.cargos.map((c) => ({ ...c })),
    repaired: { ...t.repaired },
  }));
  const cargoCount = units.reduce((n, u) => n + u.cargos.length, 0);
  // ★ 携回矿物只统计**真正返回的**单位（活 且 **在星门类型星区**；`sync` 的阵亡单位与
  //   `end` 里"结束时不在星门星区"的存活单位都按**未返回**处理 ⇒ 不产生基地收益）
  const oreSum = units.reduce((n, u) => n + (u.alive && u.atGate ? u.ore : 0), 0);
  // ★ 回执里的**合计**一律由引擎算好（界面只读，**不自己求和**）：
  //   `gainedTotal`＝实际入基地的矿物合计、`overflowTotal`＝因**容量上限被丢弃**的矿物合计。
  const gainedTotal = Object.values(acct.gained).reduce((n, v) => n + (Number.isFinite(v) ? v : 0), 0);
  const overflowTotal = Object.values(acct.overflow).reduce((n, v) => n + (Number.isFinite(v) ? v : 0), 0);
  return {
    ok: true,
    mode,
    units,
    returned: acct.returned,
    lost: acct.lost,
    ore: oreSum, // 携回矿物**总量**（入基地前；实际入账见 `gained` / `gainedTotal`）
    cargoCount,
    gained: { ...acct.gained },
    gainedTotal,
    overflow: { ...acct.overflow },
    overflowTotal,
    cargoAdded: acct.cargoAdded.map((c) => ({ ...c })),
    out: acct.out,
    count: acct.count,
    limit: acct.limit,
    deployRemaining: acct.deployRemaining,
  };
}

/** ★★ **返回 / 损毁的唯一结算入口**（`state` 参数版；三条路径全走这里）：
 *  · `mode:'unit'`：**主动返回**一个单位（`opts.unitId`；判据＝`returnCheck`）；
 *  · `mode:'sync'`：**阵亡销账**（把"已阵亡且尚未销账"的基地单位摘出星域并按**损毁**记账）——
 *    与「死亡即时释放名额」同口径（`count` 与 `out` 同减）；**可反复调用**（增量、幂等）；
 *  · `mode:'end'`：**星域结束结算**——仍在**星门类型星区**（`atGate`）存活者自动返回，其余（阵亡 / 已离开星门星区）
 *    按**未返回**记账；**同一次运行只结算一次**（`WeakSet` 记忆）。
 *  ★ **返回与损毁共用同一份账目代码**（`base.settleReturnIn`）⇒ 不允许两处各算一遍。
 *  ★★ **先校验、后落地（两侧都算上）**：先由**容器只读快照**拼出计划（`planOf`），
 *     在**状态副本**上干跑基地侧结算（`probeReturn`）——两者都**不改任何状态**；
 *     只有干跑通过才真正摘出单位并写基地账目（同步执行、中间无插入 ⇒ 提交必然成功）。
 *  @returns `{ ok:true, mode, returned, lost, ore, cargoCount, gained, overflow, cargoAdded, units[], out, count }`
 *           / `{ ok:true, skipped:true }`（无事可做）/ `{ ok:false, reason }`（**两侧都零改动**） */
export function settleExpeditionIn(state, sf, opts = {}) {
  const mode = opts.mode || 'end';
  if (!sf || typeof sf !== 'object') return { ok: false, reason: { code: 'unknown', id: null } };
  const views = sf.baseUnits || [];
  const isReturn = mode === 'unit' ? () => true : (v) => !!(v.alive && v.atGate);

  if (mode === 'unit') {
    const chk = returnCheck(sf, opts.unitId);
    if (!chk.ok) return { ok: false, reason: chk.reason };
  } else if (mode === 'sync') {
    if (!views.some((u) => !u.alive)) return { ok: true, skipped: true, mode, returned: 0, lost: 0 };
  } else if (fieldResolved.has(sf)) {
    // ★ 结束结算**同一次运行只做一次**（幂等；重复调用 = 无事可做）
    return { ok: true, skipped: true, mode: 'end', returned: 0, lost: 0 };
  }

  // ① 计划（只读；`unit` 模式只取那一个单位，其余模式取按口径筛出的那批）
  const picked = mode === 'unit' ? views.filter((v) => v.unitId === String(opts.unitId)) : views.filter((v) => (mode === 'sync' ? !v.alive : true));
  if (!picked.length) return { ok: true, skipped: true, mode, returned: 0, lost: 0 };
  const plan = planOf(picked, isReturn);
  // ② 基地侧**干跑**（状态副本）⇒ 不过 ⇒ 一个单位都不摘、一个字段都不改
  const bad = probeReturn(state, plan);
  if (bad) return { ok: false, reason: bad };
  // ③ 落地一：摘出星域（`allowDead`：不返回的单位允许是阵亡的）
  const taken = [];
  for (const v of picked) {
    const t = sf.takeBackUnit(v.unitId, { allowDead: !isReturn(v) });
    if (t.ok) taken.push(t);
  }
  if (mode === 'end') fieldResolved.add(sf); // ★ 无论摘出几只，本次运行都视为"已结算过"
  if (!taken.length) return { ok: true, skipped: true, mode, returned: 0, lost: 0 };
  // ④ 落地二：基地账目（**唯一结算**；与干跑同一份载荷口径 ⇒ 必然成功）
  const acct = base.settleReturnIn(state, { returns: plan.returns, losses: plan.losses });
  if (!acct.ok) return { ok: false, reason: acct.reason };
  return reportOf(mode, taken, acct);
}

/** ★ 上一条的**单例包装**（界面用） */
export function settleExpedition(sf, opts = {}) {
  return settleExpeditionIn(base.baseState, sf, opts);
}

/** ★ **推进时的例行结算**（界面每 tick 调一次；**唯一入口**，内部仍走上面的唯一结算）：
 *  · 先把"本 tick 已阵亡"的单位销账（`sync`）——与「死亡即时释放名额」同口径；
 *  · 星域时间耗尽（`finished`）⇒ 立刻做**结束结算**（`end`：星门星区存活者自动返回）。
 *  @returns `{ ok:true, sync, end }`（两个字段是**回执或 null**；界面据此提示，不自己算） */
export function tickExpeditionIn(state, sf) {
  if (!sf || typeof sf !== 'object') return { ok: false, reason: { code: 'unknown', id: null }, sync: null, end: null };
  const out = { ok: true, sync: null, end: null };
  if (sf.finished || sf.settled) {
    const r = settleExpeditionIn(state, sf, { mode: 'end' });
    out.end = r && r.skipped ? null : r;
    return out;
  }
  if (sf.stopped) return out;
  const r = settleExpeditionIn(state, sf, { mode: 'sync' });
  out.sync = r && r.skipped ? null : r;
  return out;
}

/** ★ 上一条的**单例包装**（界面用） */
export function tickExpedition(sf) {
  return tickExpeditionIn(base.baseState, sf);
}

/** ★★ **星门面板的唯一数据源**（M3d 迭代：界面**只读本对象**，不自算任何数值、不自己拼判据）：
 *  · `mode`：`'activate'`（**没有**开着的星域 ⇒ 主按钮＝「激活星域」）／`'dispatch'`（已开着同档星域 ⇒ 主按钮＝「派遣」）；
 *  · `tier`：当前档位的**只读档位对象**（`listBattlefronts` 的一条：名称/描述/半径/时长/单船费用/付得起）；
 *  · `tierNav`：箭头区数据（`ids/index/canPrev/canNext/reason`；**仅一档 ⇒ 两个箭头灰** + `oneTier`）；
 *  · `field`：已开着星域时的只读事实（`{ configId, remainingTicks, alive }`；未开 ⇒ `null`）
 *    —— ★ 界面在这时把"箭头区"替换为「星域剩余时间」（`remainingTicks`，秒数换算由界面走 `core/tick.js`）；
 *  · `totals`：四个统计块（`limit 出战上限 / used 已在外 / total 本次选派遣 / remaining 余量`）；
 *  · ★★ 迭代 4 **唯一主按钮口径** `primary`（界面**只读它**，不再自己判断该亮哪个）：
 *    `{ mode, labelKey, ok, reason, cost }` ——
 *      · `mode`     ＝ `'activate'`（未激活 ⇒ 按钮文本「激活星域」）/ `'dispatch'`（已激活 ⇒ 文本「派遣」）；
 *      · `labelKey` ＝ i18n **词条键**（`base.stargate.activateGo` / `base.stargate.dispatchGo`；
 *        界面只做 `i18n.t(labelKey)` ⇒ 引擎**不含任何提示文字**）；
 *      · `ok` / `reason` ＝ 该动作此刻的可用性与原因（★ 同一时刻只有一个动作可点 ⇒ 由 `fieldBusy` 表达）；
 *      · `cost`     ＝ 该动作**合并求和**后的**一个数**（激活 ⇒ 激活费 ＋ 随行派遣费；派遣 ⇒ 费率分界合计）；
 *    ★ 迭代 4 起**不再有 `activate` / `dispatch` 两个并列判据**（合并为一个主按钮 ⇒ 判据也只留一份）。
 *  · ★★ 迭代 3 **费用口径（费率分界、合并求和）**：`unitCost` ＝ 单船费用、`activateUnits` ＝ 激活费倍数、
 *    `activateCost` ＝ 激活费（＝`activateUnits × unitCost`）、
 *    `cost` ＝ ★ **本次点主按钮实际要收的那** **一个数** ——
 *      激活 ⇒ **激活费 ＋（随行单位的派遣费）**（`price` 为随行那部分的计价明细）；
 *      派遣 ⇒ 按费率分界计价（正常部分 ＋ 超出加价）的**合计**；
 *    `price` ＝ 本次计价明细 `{ normal 正常艘数, over 超出艘数, normalCost, overCost, remaining 正常名额, rate }`
 *      （★ **迭代 4 起界面不再显示分界说明行**，但**数据照旧保留**：自检与后续 M4 仍要用它）；
 *    ⇒ 界面**直接显示 `cost`**，不做乘法、不做加法、更不并列两段；
 *  · `giveUp`：**放弃星域按钮**的可用性与原因（`{ ok, reason }`）；
 *  · ★★ 迭代 3：**`cardLimit` 已删除**（上限不再限制可选艘数 ⇒ 卡片不再被禁用）；
 *  · `alive`：当前**同时存活的派遣单位数**（只读事实）。
 *  ★★ **本对象里没有、也绝不会有"星域编号"**（`seed`）、也**没有任何提示文字/短语键**
 *     （消息一律在 i18n 里由界面按 `reason.code` 取；自检 ⑪ 与迭代 2 的 ⑳ 断言"无编号键 / 无提示文字键"）。 */
export function stargateViewIn(state, opts = {}) {
  // ★ 档位清单**可注入**（`opts.fronts`）：只给**自检/离线预览**用（默认＝注册表只读清单 `listBattlefronts()`）
  const fronts = Array.isArray(opts.fronts) ? opts.fronts : listBattlefronts();
  const ids = fronts.map((f) => f.id);
  const cur = opts.current || null;
  const live = fieldLive(cur);
  const openId = live ? String(cur.configId) : '';
  let frontId = opts.frontId === undefined || opts.frontId === null ? '' : String(opts.frontId);
  if (live) frontId = openId; // 已开星域 ⇒ 档位锁定为该星域的档（不可另开新档）
  if (!ids.includes(frontId)) frontId = ids.length ? ids[0] : '';
  const index = ids.indexOf(frontId);
  const tier = fronts.find((f) => f.id === frontId) || null;
  const specs = Array.isArray(opts.specs) ? opts.specs : [];
  const totals = base.deploySquadTotalsIn(state, specs);
  const pv = frontId
    ? previewExpeditionIn(state, specs, { starfieldId: frontId, current: cur })
    : { ok: false, reason: { code: 'unknown', id: '' } };
  const gu = giveUpCheckIn(state, cur);
  const multi = ids.length > 1;
  const unitCost = deployCostOf(frontId);
  const activateCost = activateCostOf(frontId);
  const alive = live ? aliveDeployedOf(cur) : 0;
  // ★★ 迭代 3：**计价只走唯一函数**（`dispatchPriceOf`）—— 界面拿到的永远是**一个合并后的总价**：
  //   · 派遣 ⇒ 费率分界合计（正常段 ＋ 超出加价）；
  //   · 激活 ⇒ **激活费 ＋（随行单位的派遣费）**（★ 合并求和，绝不并列两段）。
  //   ★ 即使当前动作不可用（如 `tooMany`）也照常给出数字 ⇒ 界面不需要、也不允许自己算。
  const price = dispatchPriceOf(frontId, totals.total, totals.limit - alive);
  const mergedCost = live ? price.cost : sumCosts(activateCost, price.cost);
  // ★★ 迭代 4：**模式只有一处推导**（顶层 `mode` 与主按钮的 `primary.mode` 同源 ⇒ 不可能不一致）
  const mode = live ? 'dispatch' : 'activate';
  return {
    mode,
    tier,
    tierNav: {
      ids,
      index,
      canPrev: multi,
      canNext: multi,
      reason: multi ? null : ids.length === 1 ? { code: 'oneTier' } : { code: 'unknown', id: '' },
    },
    field: live
      ? {
          configId: openId,
          remainingTicks: Number.isFinite(cur.remainingTicks) ? cur.remainingTicks : 0,
          alive: aliveDeployedOf(cur),
        }
      : null,
    totals: { limit: totals.limit, used: totals.used, total: totals.total, remaining: totals.remaining },
    /* ★★ 迭代 4：**唯一主按钮**（激活星域 ⇄ 派遣 同体一个按钮）——
     *   · `mode` 随激活状态切换；`labelKey` 是 i18n 键（文本在 i18n、界面零硬编码）；
     *   · `ok` / `reason` **直接来自 `previewExpeditionIn` 的结论** —— 它已经覆盖了两种模式：
     *       未激活 ⇒ 激活分支（已开着**另一档**星域时给 `fieldBusy`）；
     *       已激活（同档）⇒ 派遣分支（`noIdle` / `tooMany` / `emptyDeploy` / `notAffordable` …）；
     *     ⇒ "同一时刻只有一个动作可点"这件事**由引擎一句话表达**，界面不需要比较两个判据。 */
    primary: {
      mode,
      labelKey: live ? 'base.stargate.dispatchGo' : 'base.stargate.activateGo',
      ok: pv.ok,
      reason: pv.ok ? null : pv.reason,
      cost: mergedCost,
    },
    giveUp: { ok: !!gu.ok, reason: gu.ok ? null : gu.reason },
    // ★★ 迭代 3 费用（界面只读、不做乘法/加法）：单船费用 / 激活费倍数 / 激活费 /
    //   ★ `cost` ＝ **本次实际要收的那一个数**（激活＝激活费＋随行派遣费；派遣＝费率分界合计）——
    //     它与 `primary.cost` 是**同一个对象**（同一份合并结果，`mergedCost`；自检 ⑱ 断言二者恒等 ⇒ 不可能分叉）；
    //   ★ `price` ＝ 计价明细（`normal`/`over`/`rate`）—— ★ 迭代 4：**界面不再显示分界行**，
    //     但数据**照旧给出**（自检用它核对计价口径，M4 的新界面也可直接复用）
    unitCost,
    activateUnits: activateUnitsOf(frontId),
    activateCost,
    cost: mergedCost,
    price,
    alive,
  };
}

/** ★ 上一条的**单例包装**（界面用：星域取 `ui/starfieldSession` 的唯一持有者，由界面传入） */
export function stargateView(sf, opts = {}) {
  return stargateViewIn(base.baseState, { ...opts, current: sf });
}

/* ================= ★ M3d 自检（控制台 `LS.expedition.selfCheck()`） =================
 * ★ 全部子项都在**私有临时状态**上做（`base.createBaseState()` + 本模块自建的星域实例）
 *   ⇒ **不触碰** `baseState` 单例、不碰 `ui/starfieldSession` 的当前星域（跑完单例逐字节不变）。
 * ★ **共 25 项**（①..⑨ 为 M3d 原有 9 项；⑩..⑰ 为 M3d 迭代新增 8 项；⑱ 为空态契约回归防护；
 *   ⑲..㉔ 为 **M3d 迭代 2 新增 6 项**：变白进度契约 / 视图无提示文字键 / 变速器恢复 /
 *   返回判据按星门**类型** / 费用**按单位计** / **激活与派遣分离**；
 *   ㉕ 为 **M3d 迭代 3 新增 1 项**：**出战上限＝费率分界**（不拦截、精确计价的端到端锚点））。
 *   ★ 既有 18 项**只增不减、口径不弱化**（迭代 2 只把 `mode:'launch'` 改名为 `mode:'activate'`，
 *     并按新的费用口径更新断言；`launch*` 仍是同一函数的**兼容别名**）。迭代 2 里**断言只做搬运、不做删除**：
 *     · ① 原表内「空装配 ⇒ `emptyDeploy`」一项 ⇒ 拆成"**激活**零单位（含只选 0 艘的空条目）⇒ 成功"
 *       ＋"**派遣**空装配 ⇒ 仍 `emptyDeploy`"两半（同一项的两种口径，覆盖面不减）；
 *     · ⑱② 原「无空闲单位 ⇒ 不可出征」一项 ⇒ 落到**主按钮的派遣态**上断言 `noIdle`（激活允许零单位）；
 *     · ⑦ 的"不在星门星区"样本 ⇒ 改挑**非星门类型**星区（一档可能有 2 个星门星区，旧挑法会挑到另一个星门）。
 *   ★ **迭代 3 的断言搬运**（同样"只搬运、不删除"，且**更强**）：原「超上限 ⇒ `deployLimit`」的断言
 *     （① 的样本表行、② 的单配置/合计两处、⑬ 的"超上限两侧零改动"、㉔② 的"名额已满必被拒"）
 *     ⇒ 一律搬到"**超出上限必须成功**，且 `price.over` / `remaining(−1)` / 精确加价"这一侧；
 *     新增 ㉕ 作为**计价口径的唯一锚点**（纯函数边界 ＋ 端到端逐资源键核对 ＋ 大批量不拦截 ＋ 资源不足仍拒）。
 *   ★ **迭代 4 的契约改写**（**项数不变、断言不弱化**）：界面把「激活星域 / 派遣」两个按钮**合并为一个**，
 *     引擎侧对应地把 `activate` / `dispatch` **两个并列判据合并为 `primary`**：
 *     · ⑱ 的契约断点从 `activate.ok` / `dispatch.ok` ⇒ **`primary` 五件套**
 *       （`mode` 与顶层 `mode` 同源 / `labelKey` 必须是正确词条键且**每个语言都有该词条** /
 *        `ok` 布尔 / `reason` 与 `ok` 互斥且齐全 / `cost` 是合并后的一个数），并**反向断言**
 *       `activate` / `dispatch` 已不存在；同时删掉迭代 3 遗留的 `cardLimit` 正数断言（它本该只判"已删除"）。
 *     · ㉔ 的"恰好一个可点" ⇒ **主按钮口径正确 + `mode` 随激活状态切换**
 *       （未激活 ⇒ 文本键 `activateGo`、可点；激活后 ⇒ `dispatchGo`、选中单位即可点、未选 ⇒ `emptyDeploy`；
 *        已开星域 ⇒ 档位被锁定为进行中的那一档；另开别档的硬拒仍在动作层，见 ⑫）；
 *     · ⑱② 的"无空闲 ⇒ 不可出征"同步落到**主按钮的派遣态**（`primary.reason.code === 'noIdle'`）。 */

/** 自检 detail 最多列几条（体例同 `systems/base.js`） */
const MAX_DETAIL = 5;
const head = (list) => (list.length > MAX_DETAIL ? `${list.slice(0, MAX_DETAIL).join('；')} …（共 ${list.length} 条）` : list.join('；'));
const jsonEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** 自检样本船型：**首个可建造**船型（配置 `buildable !== false`；与基地界面 `baseView` 同一口径） */
function sampleShipId() {
  return SHIP_IDS.find((id) => SHIPS[id] && SHIPS[id].buildable !== false) || SHIP_IDS[0];
}

/** 造一个临时基地状态：资源充足、船坞拉到配置顶（容量不再是瓶颈）、一条配置 A 备足 `units` 艘
 *  ★ **自检专用**（只写临时状态对象，**不碰单例**）。 */
function mkState(units = 0) {
  const s = base.createBaseState();
  for (const k of Object.keys(s.resources)) s.resources[k] = 1e6;
  const sy = BASE_BUILDINGS.shipyard;
  s.buildings.shipyard.level = sy.levels[sy.levels.length - 1].level; // 容量放开 ⇒ 只让"出战上限"成为约束
  const c = base.createFleetConfigIn(s, { name: 'A', shipId: sampleShipId(), level: 1, modules: [] });
  if (!c.ok) return { ok: false, reason: c.reason };
  if (units > 0) {
    const b = base.buildIn(s, c.id, units);
    if (!b.ok) return { ok: false, reason: b.reason };
  }
  return { ok: true, state: s, id: c.id };
}

/** ★ **出征 / 返回闭环自检**（只读；控制台 `LS.expedition.selfCheck()`）
 *  @returns {{ pass: boolean, checks: { name: string, pass: boolean, detail: string }[] }} */
export function expeditionSelfCheck() {
  const checks = [];
  const add = (name, problems) => {
    const list = Array.isArray(problems) ? problems.filter(Boolean) : problems ? [String(problems)] : [];
    checks.push({ name, pass: list.length === 0, detail: list.length ? head(list) : 'ok' });
  };
  const tier = 'h1';
  const cost = deployCostOf(tier); // ★ 迭代 2：**单船费用**（每派出一艘收一次；原"每次出征一份"口径已废）
  const actCost = activateCostOf(tier); // ★ 迭代 2：**激活费**（＝activateUnits × 单船费用；激活一次性收取）
  const seed = 'EXP-M3D';
  const oreKey = 'ore';
  const singletonBefore = JSON.stringify(base.baseState); // ★ 全程不得触碰单例（最后一项核对）

  // ① 干跑 ≡ 落地（**同一份校验口径**）：同一装配在两份状态上分别干跑 / 落地 ⇒ 结论与失败码一致；失败零改动
  {
    const p = [];
    const a = mkState(0);
    const b = mkState(0);
    if (!a.ok || !b.ok) p.push('自检样本搭建失败');
    else {
      const cap = base.deploySquadTotalsIn(a.state, []).limit;
      const ba = base.buildIn(a.state, a.id, cap + 2);
      const bb = base.buildIn(b.state, b.id, cap + 2);
      if (!ba.ok || !bb.ok) p.push('样本造船失败（容量应已放开）');
      const cases = [
        // ★ 迭代 2：原「空装配 ⇒ emptyDeploy」一项已**移位**（激活现在允许零单位）——见本项末尾的
        //   "空装配"专段：**激活**（含"只选中 0 艘"）⇒ 成功；**派遣**空装配 ⇒ 仍为 `emptyDeploy`。
        { name: '超空闲', specs: [{ id: 'A', n: 99 }], code: 'tooMany' },
        // ★★ 迭代 3：原「超合计上限 ⇒ deployLimit」一行**已废** —— 出战上限**不再拦截**，
        //   该装配现在是**合法**的（只是**加价**）⇒ 断言搬到下方「费率分界」专段（口径不弱化，反而更强）。
        { name: '非法数量', specs: [{ id: 'A', n: -1 }], code: 'badOut' },
        { name: '未知配置', specs: [{ id: 'noSuchId', n: 1 }], code: 'unknown' },
      ];
      for (const w of cases) {
        const mapId = (x) => (x.id === 'A' ? a.id : x.id);
        const mapId2 = (x) => (x.id === 'A' ? b.id : x.id);
        const fzA = JSON.stringify(a.state);
        const fzB = JSON.stringify(b.state);
        const dry = previewExpeditionIn(a.state, w.specs.map(mapId), { starfieldId: tier });
        const live = launchExpeditionIn(b.state, w.specs.map(mapId2), { starfieldId: tier, seed });
        if (dry.ok !== live.ok) p.push(`${w.name}: 干跑与落地结论不一致`);
        else if (!dry.ok && dry.reason.code !== live.reason.code) p.push(`${w.name}: 失败码不一致（${dry.reason.code} vs ${live.reason.code}）`);
        if (dry.ok) p.push(`${w.name}: 干跑应失败（现 ok）`);
        else if (dry.reason.code !== w.code) p.push(`${w.name}: 期望 ${w.code}（现 ${dry.reason.code}）`);
        if (live.ok) p.push(`${w.name}: 落地应失败（现 ok）`);
        if (JSON.stringify(a.state) !== fzA) p.push(`${w.name}: 干跑竟改了状态`);
        if (JSON.stringify(b.state) !== fzB) p.push(`${w.name}: 落地失败必须**状态零改动**`);
      }
      // 成功样本：干跑 ok ⇔ 落地 ok，且名额口径逐字段一致
      const dry2 = previewExpeditionIn(a.state, [{ id: a.id, n: 1 }], { starfieldId: tier });
      const live2 = launchExpeditionIn(b.state, [{ id: b.id, n: 1 }], { starfieldId: tier, seed });
      if (!dry2.ok || !live2.ok) p.push(`成功样本应双双通过（${dry2.ok ? 'ok' : dry2.reason.code} / ${live2.ok ? 'ok' : live2.reason.code}）`);
      else if (dry2.total !== live2.total || dry2.used !== live2.used || dry2.limit !== live2.limit || dry2.remaining !== live2.remaining) {
        p.push('干跑与落地的名额口径应逐字段一致（total/used/limit/remaining）');
      }
      // ★★ 迭代 2 **"空装配"专段**（原表内一项的位移，**口径不弱化**）：
      //   · **激活**：空数组 / "只选中 0 艘的空条目" ⇒ **都算零单位激活**（成功；空星域先存在）；
      //   · **派遣**：空装配 ⇒ 仍是 `emptyDeploy`（且干跑 ≡ 落地、两侧零改动）。
      {
        const c1 = mkState(0);
        const c2 = mkState(0);
        if (!c1.ok || !c2.ok) p.push('自检样本搭建失败');
        else {
          const e1 = previewExpeditionIn(c1.state, [{ id: c1.id, n: 0 }], { starfieldId: tier });
          if (!e1.ok) p.push(`"只选中 0 艘"应算零单位激活（现 ${e1.reason.code}）`);
          else if (e1.mode !== 'activate' || e1.total !== 0) p.push('零单位激活的 mode 应为 activate 且 total 为 0');
          const landA = activateExpeditionIn(c2.state, [{ id: c2.id, n: 0 }], { starfieldId: tier, seed });
          if (!landA.ok) p.push(`零单位激活落地应成功（现 ${landA.reason.code}）`);
          else if (landA.items.length !== 0) p.push('零单位激活不应有装配条目');
          if (landA.ok) {
            const fz1 = JSON.stringify(c1.state);
            const fz2 = JSON.stringify(c2.state);
            const d0 = previewExpeditionIn(c1.state, [], { starfieldId: tier, current: landA.starfield });
            const l0 = dispatchExpeditionIn(c2.state, landA.starfield, []);
            if (d0.ok) p.push('派遣空装配应被拒（现 ok）');
            else if (d0.reason.code !== 'emptyDeploy') p.push(`派遣空装配应返回 emptyDeploy（现 ${d0.reason.code}）`);
            if (l0.ok) p.push('派遣空装配落地应被拒（现 ok）');
            else if (l0.reason.code !== 'emptyDeploy') p.push(`派遣空装配落地应返回 emptyDeploy（现 ${l0.reason.code}）`);
            if (JSON.stringify(c1.state) !== fz1) p.push('派遣空装配 ⇒ 干跑不得改状态');
            if (JSON.stringify(c2.state) !== fz2) p.push('派遣空装配 ⇒ 落地失败必须状态零改动');
          }
        }
      }
    }
    add('① 干跑 ≡ 落地（同一份校验口径：结论与失败码逐项一致）＋失败一律零改动', p);
  }

  // ② ★ 迭代 3 修订：**出战上限不再拦截**（恰好到顶 ⇒ 成功、超 1 / 合计超出 ⇒ **同样成功**，只是加价）
  //    ＋**逐配置不超空闲**（tooMany 仍是硬拒绝；"想派的比空闲的多"与"名额不足"不再混为一谈）
  {
    const p = [];
    const a = mkState(0);
    if (!a.ok) p.push('自检样本搭建失败');
    else {
      const cap = base.deploySquadTotalsIn(a.state, []).limit;
      const b = base.createFleetConfigIn(a.state, { name: 'B', shipId: sampleShipId(), level: 1, modules: [] });
      if (!b.ok) p.push('第二条配置创建失败');
      else {
        const b1 = base.buildIn(a.state, a.id, cap + 2);
        const b2 = base.buildIn(a.state, b.id, 2);
        if (!b1.ok || !b2.ok) p.push('样本造船失败');
        // 单配置恰好到顶 ⇒ 成功 + 余量 0
        const exact = previewExpeditionIn(a.state, [{ id: a.id, n: cap }], { starfieldId: tier });
        if (!exact.ok) p.push(`恰好到顶应可出征（现 ${exact.reason.code}）`);
        else if (exact.remaining !== 0) p.push(`恰好到顶后余量应为 0（现 ${exact.remaining}）`);
        // ★★ 迭代 3：单配置超 1 ⇒ **不再拒绝**（只加价；`price.over` 记下超出艘数）
        const over = previewExpeditionIn(a.state, [{ id: a.id, n: cap + 1 }], { starfieldId: tier });
        if (!over.ok) p.push(`超上限 1 艘**不应再被拒**（现 ${over.reason.code}）`);
        else {
          if (!over.price || over.price.over !== 1 || over.price.normal !== cap) {
            p.push(`超 1 艘的计价明细应为 normal ${cap} / over 1（现 ${over.price && over.price.normal}/${over.price && over.price.over}）`);
          }
          if (over.remaining !== -1) p.push(`超 1 艘后剩余正常名额应为 −1（现 ${over.remaining}）`);
        }
        // 超空闲数 ⇒ tooMany（**这才是真正的硬拒绝**：空闲单位不够）
        const tooMany = previewExpeditionIn(a.state, [{ id: a.id, n: cap + 3 }], { starfieldId: tier });
        if (tooMany.ok) p.push('超空闲数应被拒（现 ok）');
        else if (tooMany.reason.code !== 'tooMany') p.push(`超空闲数应返回 tooMany（现 ${tooMany.reason.code}）`);
        else if (tooMany.reason.idle !== cap + 2) p.push('tooMany 应带准确的空闲数');
        // ★★ 迭代 3：**合计**超出（A 派 cap 艘、B 派 2 艘 ⇒ 合计 cap+2，超上限 2）⇒ **不再拒绝**、只加价
        const sum = previewExpeditionIn(a.state, [{ id: a.id, n: cap }, { id: b.id, n: 2 }], { starfieldId: tier });
        if (!sum.ok) p.push(`合计超出上限**不应再被拒**（现 ${sum.reason.code}）`);
        else {
          if (sum.total !== cap + 2) p.push(`合计艘数应为 ${cap + 2}（现 ${sum.total}）`);
          if (!sum.price || sum.price.over !== 2) p.push(`合计超 2 艘的计价明细应给出 over 2（现 ${sum.price && sum.price.over}）`);
        }
        const fit = previewExpeditionIn(a.state, [{ id: a.id, n: cap }, { id: b.id, n: 0 }], { starfieldId: tier });
        if (!fit.ok) p.push(`合计恰好到顶应可出征（现 ${fit.reason.code}）`);
        else if (fit.remaining !== 0) p.push('合计恰好到顶后余量应为 0');
        else if (fit.price && fit.price.over !== 0) p.push('合计恰好到顶时不应有超出加价');
      }
    }
    add('② 出战上限**不再拦截**（恰好到顶 ⇒ 成功 + 余量 0；单配置超 1 / 合计超 2 ⇒ 同样成功且 `price.over` 精确）；超**空闲数**仍硬拒 `tooMany`', p);
  }

  // ③ 出征费用：资源不足 ⇒ notAffordable 且**零改动**；恰好够 ⇒ 成功且**扣减额精确**
  {
    const p = [];
    const a = mkState(1);
    if (!a.ok) p.push('自检样本搭建失败');
    else {
      const keys = Object.keys(cost);
      if (!keys.length) p.push('该档 deployCost 为空（本项失去意义）');
      const k0 = keys[0];
      for (const k of keys) a.state.resources[k] = cost[k];
      a.state.resources[k0] = cost[k0] - 1;
      const before = { ...a.state.resources };
      const bad = base.deploySquadIn(a.state, [{ id: a.id, n: 1 }], cost);
      if (bad.ok) p.push('差 1 资源应被拒（现 ok）');
      else if (bad.reason.code !== 'notAffordable') p.push(`差 1 应返回 notAffordable（现 ${bad.reason.code}）`);
      else if (bad.reason.resource !== k0 || bad.reason.need !== cost[k0] || bad.reason.have !== cost[k0] - 1) {
        p.push('notAffordable 应指向该资源且 need/have 精确');
      }
      if (!jsonEq(a.state.resources, before)) p.push('失败时资源被动过');
      for (const c of a.state.fleetConfigs) if (c.out !== 0) p.push('失败时 out 被动过');
      // 恰好够 ⇒ 成功且精确扣减
      for (const k of keys) a.state.resources[k] = cost[k];
      const have0 = { ...a.state.resources };
      const okr = base.deploySquadIn(a.state, [{ id: a.id, n: 1 }], cost);
      if (!okr.ok) p.push(`恰好够应成功（现 ${okr.reason.code}）`);
      else {
        for (const k of keys) if (a.state.resources[k] !== have0[k] - cost[k]) p.push(`${k} 扣减额应精确（现 ${a.state.resources[k]}，期望 ${have0[k] - cost[k]}）`);
        const want = {};
        for (const k of keys) if (cost[k] > 0) want[k] = cost[k];
        if (!jsonEq(okr.spent, want)) p.push(`spent 应＝该档 deployCost 中 >0 的项（现 ${JSON.stringify(okr.spent)}）`);
      }
    }
    add('③ 出征费用：不足 ⇒ notAffordable 且**零改动**；恰好够 ⇒ 成功且扣减额精确（spent 与配置一致）', p);
  }

  // ④ 出征落地：各配置 `out` **精确增加**、`count` **不变**（Σout ≡ total）
  {
    const p = [];
    const a = mkState(0);
    if (!a.ok) p.push('自检样本搭建失败');
    else {
      const b = base.createFleetConfigIn(a.state, { name: 'B', shipId: sampleShipId(), level: 1, modules: [] });
      if (!b.ok) p.push('第二条配置创建失败');
      else {
        const b1 = base.buildIn(a.state, a.id, 2);
        const b2 = base.buildIn(a.state, b.id, 1);
        if (!b1.ok || !b2.ok) p.push('样本造船失败');
        const before = a.state.fleetConfigs.map((c) => ({ id: c.id, count: c.count, out: c.out }));
        const r = base.deploySquadIn(a.state, [{ id: a.id, n: 2 }, { id: b.id, n: 1 }], cost);
        if (!r.ok) p.push(`应可出征（现 ${r.reason.code}）`);
        else {
          for (const b0 of before) {
            const now = a.state.fleetConfigs.find((c) => c.id === b0.id);
            const want = b0.id === a.id ? 2 : 1;
            if (now.count !== b0.count) p.push(`${b0.id}: count 不应变（${b0.count} → ${now.count}）`);
            if (now.out !== b0.out + want) p.push(`${b0.id}: out 应精确 +${want}（现 ${now.out}）`);
          }
          if (r.total !== 3) p.push(`total 应为 3（现 ${r.total}）`);
          if (base.deploySquadTotalsIn(a.state, []).used !== 3) p.push('已在外合计应为 3');
        }
      }
    }
    add('④ 出征落地：各配置 out 精确 +n、count 不变（Σout ≡ total，已在外合计同步）', p);
  }

  // ⑤ 编号确定性：同编号＋同装配 ⇒ 同星域（布局/入场星区一致）＋**归属标签与展开顺序一一对应**
  {
    const p = [];
    const a = mkState(0);
    const b = mkState(0);
    if (!a.ok || !b.ok) p.push('自检样本搭建失败');
    else {
      const aB = base.createFleetConfigIn(a.state, { name: 'B', shipId: sampleShipId(), level: 1, modules: [] });
      const bB = base.createFleetConfigIn(b.state, { name: 'B', shipId: sampleShipId(), level: 1, modules: [] });
      if (!aB.ok || !bB.ok) p.push('第二条配置创建失败');
      else {
        const b1 = base.buildIn(a.state, a.id, 2);
        const b2 = base.buildIn(a.state, aB.id, 1);
        const b3 = base.buildIn(b.state, b.id, 2);
        const b4 = base.buildIn(b.state, bB.id, 1);
        if (!b1.ok || !b2.ok || !b3.ok || !b4.ok) p.push('样本造船失败');
        const r1 = launchExpeditionIn(a.state, [{ id: a.id, n: 2 }, { id: aB.id, n: 1 }], { starfieldId: tier, seed });
        const r2 = launchExpeditionIn(b.state, [{ id: b.id, n: 2 }, { id: bB.id, n: 1 }], { starfieldId: tier, seed });
        if (!r1.ok || !r2.ok) p.push(`两次出征应都成功（${r1.ok ? 'ok' : r1.reason.code} / ${r2.ok ? 'ok' : r2.reason.code}）`);
        else {
          if (r1.seed !== seed || r1.starfield.seed !== seed) p.push('星域编号应＝传入的编号');
          if (r1.starfield.playerEntryIndex !== r2.starfield.playerEntryIndex) p.push('同配置同编号 ⇒ 入场星区应一致');
          if (r1.starfield.playerUnitCount !== 3) p.push(`注入的出征单位数应为 3（现 ${r1.starfield.playerUnitCount}）`);
          const views = r1.starfield.baseUnits || [];
          if (views.length !== 3) p.push(`带归属标签的单位应为 3（现 ${views.length}）`);
          else {
            const ord = views.map((u) => u.ordinal).join(',');
            if (ord !== '1,2,1') p.push(`归属 ordinal 应与展开顺序一致（现 ${ord}）`);
            const cfgSet = new Set(views.map((u) => u.configId));
            if (cfgSet.size !== 2) p.push('归属应覆盖两条配置');
            if (!views.every((u) => u.alive && u.inEntry)) p.push('出征单位初始应存活且位于星门星区');
            if ((r1.starfield.baseUnits || []).length !== (r2.starfield.baseUnits || []).length) p.push('两条星域的归属单位数应一致');
          }
          const sig = (sf) => sf.sectors.map((s) => `${s.index}:${s.typeId}:${s.q},${s.r}`).join('|');
          if (sig(r1.starfield) !== sig(r2.starfield)) p.push('同编号 ⇒ 星区布局应逐项一致（确定性）');
        }
      }
    }
    add('⑤ 编号确定性：同编号＋同装配 ⇒ 同星域（布局/入场星区一致）＋归属标签与展开顺序一一对应', p);
  }

  // ⑥ 主动返回：`out −1` / `count` 不变 / **返回即修复** / 矿物超上限丢弃（overflow 正确）/ 货物按类型+等级堆叠
  {
    const p = [];
    const a = mkState(1);
    if (!a.ok) p.push('自检样本搭建失败');
    else {
      const launch = launchExpeditionIn(a.state, [{ id: a.id, n: 1 }], { starfieldId: tier, seed });
      if (!launch.ok) p.push(`出征应成功（现 ${launch.reason.code}）`);
      else {
        const sf = launch.starfield;
        const view = (sf.baseUnits || [])[0];
        if (!view) p.push('星域里应有 1 个基地单位');
        else {
          // ★ 测试替身：直接给单位挂上"携回载荷"（**只测结算数学**；生产代码不会这样写）
          const unit = sf.battleOf(sf.playerEntryIndex).units().find((u) => u.id === view.unitId);
          if (!unit) p.push('预置：在星门星区里找不到该单位对象');
          else {
          const cargo = 1e6; // 远超任何容量上限 ⇒ 必定触发"超上限丢弃"
          a.state.resources[oreKey] = 0; // 清空 ⇒ 剩余容量＝上限（口径确定）
          unit.hull.ore = cargo;
          unit.cargos = [
            { templateId: 'x', level: 1, tons: 1 },
            { templateId: 'x', level: 1, tons: 1 },
            { templateId: 'x', level: 2, tons: 1 },
          ];
          unit.hull.hp = 1; // 修复前置：残血 + 零能量 + 模块冷却拉满
          unit.hull.energy = 0;
          for (const inst of unit.modules || []) inst.cooldown = 5;
          const cfg0 = a.state.fleetConfigs.find((c) => c.id === a.id);
          const before = { out: cfg0.out, count: cfg0.count };
          const r = settleExpeditionIn(a.state, sf, { mode: 'unit', unitId: view.unitId });
          if (!r.ok) p.push(`主动返回应成功（现 ${r.reason.code}）`);
          else {
            const cfg = a.state.fleetConfigs.find((c) => c.id === a.id);
            if (cfg.out !== before.out - 1) p.push(`返回后 out 应 −1（${before.out} → ${cfg.out}）`);
            if (cfg.count !== before.count) p.push(`返回后 count 应不变（${before.count} → ${cfg.count}）`);
            if (r.returned !== 1 || r.lost !== 0) p.push('回执应为 1 返回 / 0 损毁');
            const rep = r.units[0].repaired;
            if (rep.hp !== rep.maxHp || rep.shield !== rep.maxShield || rep.energy !== rep.maxEnergy) {
              p.push('返回即修复：满血满盾满能量应生效');
            }
            if (r.ore !== cargo) p.push(`携回矿物应＝挂载量（现 ${r.ore}）`);
            // 守恒：入基地 + 丢弃 ≡ 携回 ⇒ 既证明"超上限丢弃"、也证明记账未漏未重
            if (r.gainedTotal + r.overflowTotal !== cargo) p.push(`入基地 + 丢弃 应＝携回（${r.gainedTotal} + ${r.overflowTotal} ≠ ${cargo}）`);
            if (r.overflowTotal <= 0) p.push('超上限部分应被记为 overflow（应在 0 以上）');
            if (a.state.resources[oreKey] !== r.gainedTotal) p.push('入基地的矿物应精确进入该资源');
            const store = a.state.cargoStore || []; // ★ 读**临时状态**的货物库（不是单例快照）
            const s1 = store.find((c) => c.templateId === 'x' && c.level === 1);
            const s2 = store.find((c) => c.templateId === 'x' && c.level === 2);
            if (!s1 || s1.count !== 2) p.push(`同类型同等级货物应堆叠为 1 堆 count=2（现 ${s1 ? s1.count : '无'}）`);
            if (!s2 || s2.count !== 1) p.push('不同等级货物应另起一堆（count=1）');
            if (store.length !== 2) p.push(`货物库应有 2 堆（现 ${store.length}）`);
            if ((sf.baseUnits || []).some((u) => u.unitId === view.unitId)) p.push('返回后该单位应已离开星域场景');
            if (r.cargoCount !== 3) p.push(`回执里的携回货物件数应为 3（现 ${r.cargoCount}）`);
          }
          }
        }
      }
    }
    add('⑥ 主动返回：out −1 / count 不变 / 返回即修复 / 矿物超上限丢弃（overflow＋守恒）/ 货物按类型+等级堆叠', p);
  }

  // ⑦ 未返回 ⇒ count 与 out **同减**（损毁 / 结束时不在**星门类型**星区）；结束结算**只做一次**（幂等）
  {
    const p = [];
    const a = mkState(1);
    if (!a.ok) p.push('自检样本搭建失败');
    else {
      const launch = launchExpeditionIn(a.state, [{ id: a.id, n: 1 }], { starfieldId: tier, seed });
      if (!launch.ok) p.push(`出征应成功（现 ${launch.reason.code}）`);
      else {
        const sf = launch.starfield;
        const view = (sf.baseUnits || [])[0];
        // ★ 迭代 2：这里必须选一个**非星门类型**星区（一档可能有 2 个星门星区 ⇒ 不能只按"不是入场星区"挑）
        const other = sf.sectors.find((s) => !s.isGate);
        const taken = sf.battleOf(sf.playerEntryIndex).takeUnit(view.unitId);
        if (!taken.ok || !other) p.push('预置：把单位搬离星门星区失败');
        else {
          // ★ 用引擎既有"取回 + 收编"把单位搬到**非星门类型**星区（代表"结束时不在星门星区"）
          sf.battleOf(other.index).adoptUnit(taken.unit, 'ally');
          const v2 = (sf.baseUnits || []).find((u) => u.unitId === view.unitId);
          if (!v2 || v2.atGate) p.push('预置：单位应已不在任何星门类型星区');
          const chk = returnCheck(sf, view.unitId);
          if (chk.ok) p.push('不在星门星区时主动返回应被拒（现 ok）');
          else if (chk.reason.code !== 'notAtGate') p.push(`应返回 notAtGate（现 ${chk.reason.code}）`);
          const cfg0 = a.state.fleetConfigs.find((c) => c.id === a.id);
          const before = { out: cfg0.out, count: cfg0.count };
          const r = settleExpeditionIn(a.state, sf, { mode: 'end' });
          if (!r.ok) p.push(`结束结算应成功（现 ${r.reason.code}）`);
          else {
            const cfg = a.state.fleetConfigs.find((c) => c.id === a.id);
            if (cfg.count !== before.count - 1) p.push(`未返回 ⇒ count 应 −1（${before.count} → ${cfg.count}）`);
            if (cfg.out !== before.out - 1) p.push(`未返回 ⇒ out 应 −1（${before.out} → ${cfg.out}）`);
            if (r.lost !== 1 || r.returned !== 0) p.push(`回执应为 0 返回 / 1 损毁（现 ${r.returned}/${r.lost}）`);
            if (r.ore !== 0 || r.cargoCount !== 0 || r.gainedTotal !== 0) p.push('未返回不应产生基地收益（损毁不返还）');
            const snap = JSON.stringify(a.state);
            const again = settleExpeditionIn(a.state, sf, { mode: 'end' });
            if (!again.skipped) p.push('结束结算重复调用应返回 skipped（同一次运行只结算一次）');
            if (JSON.stringify(a.state) !== snap) p.push('结束结算重复调用不得改状态');
          }
        }
      }
    }
    add('⑦ 未返回（损毁 / 不在**星门类型**星区）⇒ count 与 out **同减**、无收益；结束结算只做一次（幂等）', p);
  }

  // ⑧ 单处结算：阵亡销账（`sync`）与返回**共用同一入口**；增量幂等（count/out 只减一次，不会两处各算一遍）
  {
    const p = [];
    const a = mkState(2);
    if (!a.ok) p.push('自检样本搭建失败');
    else {
      const launch = launchExpeditionIn(a.state, [{ id: a.id, n: 2 }], { starfieldId: tier, seed });
      if (!launch.ok) p.push(`出征应成功（现 ${launch.reason.code}）`);
      else {
        const sf = launch.starfield;
        const views = sf.baseUnits || [];
        if (views.length !== 2) p.push(`应有 2 个基地单位（现 ${views.length}）`);
        const unit = sf.battleOf(sf.playerEntryIndex).units().find((u) => u.id === views[0].unitId);
        unit.alive = false; // ★ 阵亡（引擎判死的唯一效果就是 alive=false；此处直接摆出该事实）
        const cfg0 = a.state.fleetConfigs.find((c) => c.id === a.id);
        const before = { out: cfg0.out, count: cfg0.count };
        const r1 = tickExpeditionIn(a.state, sf);
        if (!r1.sync) p.push('阵亡单位应在例行结算里被销账（现无回执）');
        else {
          const cfg = a.state.fleetConfigs.find((c) => c.id === a.id);
          if (cfg.count !== before.count - 1 || cfg.out !== before.out - 1) {
            p.push(`阵亡销账应 count/out 同减（count ${before.count}→${cfg.count}、out ${before.out}→${cfg.out}）`);
          }
          if (r1.sync.lost !== 1) p.push(`销账回执应为 1 损毁（现 ${r1.sync.lost}）`);
          const snap = JSON.stringify(a.state);
          const r2 = tickExpeditionIn(a.state, sf);
          if (r2.sync) p.push('已销账的单位不应被再算一次（增量幂等）');
          if (JSON.stringify(a.state) !== snap) p.push('重复例行结算不得改状态');
          // 幸存的那艘仍应可主动返回（**同一入口**的另一条路径）
          const alive = (sf.baseUnits || []).find((u) => u.alive);
          if (!alive) p.push('应还有 1 艘存活单位');
          else {
            const r3 = settleExpeditionIn(a.state, sf, { mode: 'unit', unitId: alive.unitId });
            if (!r3.ok) p.push(`幸存单位应可主动返回（现 ${r3.reason.code}）`);
            else {
              const cfg2 = a.state.fleetConfigs.find((c) => c.id === a.id);
              if (cfg2.out !== 0) p.push(`2 艘都结算后 out 应为 0（现 ${cfg2.out}）`);
              if (cfg2.count !== before.count - 1) p.push(`返回不改变 count（现 ${cfg2.count}）`);
            }
          }
        }
      }
    }
    add('⑧ 单处结算：阵亡销账与主动返回共用同一入口；增量幂等（count/out 只减一次，两条路径可叠加）', p);
  }

  // ⑨ 星域进行中只读（＝离开地图即**挂起**）零记账：`out` 不变、干跑/汇总无副作用、重复出征被 fieldBusy 挡住
  {
    const p = [];
    const a = mkState(1);
    if (!a.ok) p.push('自检样本搭建失败');
    else {
      const launch = launchExpeditionIn(a.state, [{ id: a.id, n: 1 }], { starfieldId: tier, seed });
      if (!launch.ok) p.push(`出征应成功（现 ${launch.reason.code}）`);
      else {
        const sf = launch.starfield;
        const cfg0 = a.state.fleetConfigs.find((c) => c.id === a.id);
        const outBefore = cfg0.out;
        const snap = JSON.stringify(a.state);
        // 「挂起」＝不驱动 tick、只做只读读取（界面离开地图就是这种情况）
        const totals = base.deploySquadTotalsIn(a.state, [{ id: a.id, n: 0 }]);
        // ★★ M3d 迭代：`fieldBusy` **语义修订** ⇒ 同档 ⇒ **可继续派遣**（mode:'dispatch'）；另有活星域时**另开别档** ⇒ fieldBusy
        const dry = previewExpeditionIn(a.state, [{ id: a.id, n: 1 }], { starfieldId: tier, current: sf });
        const t = tickExpeditionIn(a.state, sf); // 无阵亡、未结束 ⇒ 应无回执
        void sf.baseUnits;
        if (t.sync || t.end) p.push('无阵亡且未结束时不应产生结算回执（挂起期间零记账）');
        if (!dry.ok) p.push(`已开同档星域 ⇒ 应可继续派遣（现 ${dry.reason.code}）`);
        else if (dry.mode !== 'dispatch') p.push(`已开同档星域 ⇒ mode 应为 dispatch（现 ${dry.mode}）`);
        const otherTier = STARFIELD_IDS.find((x) => x !== tier);
        if (otherTier) {
          const busy = previewExpeditionIn(a.state, [{ id: a.id, n: 1 }], { starfieldId: otherTier, current: sf });
          if (busy.ok) p.push('已开着另一档星域时不应允许另开新档（现 ok）');
          else if (busy.reason.code !== 'fieldBusy') p.push(`另开别档应返回 fieldBusy（现 ${busy.reason.code}）`);
        }
        if (totals.used !== outBefore) p.push(`已在外应＝out（${outBefore} → ${totals.used}）`);
        const cfg1 = a.state.fleetConfigs.find((c) => c.id === a.id);
        if (cfg1.out !== outBefore) p.push('挂起期间 out 必须保持不变');
        if (JSON.stringify(a.state) !== snap) p.push('只读读取 / 干跑 / 例行结算不得改动基地状态（挂起不影响 out）');
        // ★ 全部子项都跑在临时状态上 ⇒ 单例 `baseState` 必须**逐字节未变**（自检本身零副作用）
        if (JSON.stringify(base.baseState) !== singletonBefore) p.push('自检不得触碰单例 baseState（应逐字节未变）');
      }
    }
    add('⑨ 星域进行中只读（挂起）零记账：out 不变、干跑与汇总无副作用；已开星域 ⇒ 可继续派遣、另开别档才 fieldBusy', p);
  }

  // ⑩ 档位箭头：循环切换（边界回绕）、未知档落到首档、仅一档 ⇒ 两个箭头都灰（oneTier）
  {
    const p = [];
    const ids = listBattlefronts().map((f) => f.id);
    if (ids.length < 2) p.push('内置档位应 ≥ 2（箭头循环的前提）');
    else {
      if (cycleFrontId(ids[0], 1) !== ids[1]) p.push('首个 +1 应为第二档');
      if (cycleFrontId(ids[0], -1) !== ids[ids.length - 1]) p.push('首个 −1 应**回绕**到末尾档');
      if (cycleFrontId(ids[ids.length - 1], 1) !== ids[0]) p.push('末尾 +1 应**回绕**到首个');
      if (cycleFrontId('no-such-tier', 1) !== ids[1]) p.push('未知档应落到首档再移动');
      if (cycleFrontId(ids[0], 0) !== ids[0]) p.push('step 0 应原地不动');
      // 全程循环：连按 n 次必回到原档（确定性）
      let cur = ids[0];
      for (let i = 0; i < ids.length; i += 1) cur = cycleFrontId(cur, 1);
      if (cur !== ids[0]) p.push('连按「下一档」整圈应回到原档');
    }
    const a = mkState(0);
    if (!a.ok) p.push('自检样本搭建失败');
    else {
      const v = stargateViewIn(a.state, { frontId: ids[0] || '', current: null });
      if (!v.tierNav || v.tierNav.ids.length !== ids.length) p.push('tierNav.ids 应为全部档位');
      if (!v.tierNav.canPrev || !v.tierNav.canNext) p.push('多于 1 档时两个箭头都应可用');
      if (v.tierNav.reason) p.push('多于 1 档时不应给箭头原因');
      // ★ 仅一档 ⇒ 灰 + `oneTier`（用**注入的档位清单**验证该分支）
      const one = stargateViewIn(a.state, { fronts: [listBattlefronts()[0]], frontId: '', current: null });
      if (!one || !one.tierNav) p.push('单档视图应可构造');
      else {
        if (one.tierNav.canPrev || one.tierNav.canNext) p.push('仅一档 ⇒ 两个箭头都应不可用');
        if (!one.tierNav.reason || one.tierNav.reason.code !== 'oneTier') p.push(`仅一档 ⇒ 原因应为 oneTier（现 ${one.tierNav.reason && one.tierNav.reason.code}）`);
      }
    }
    add('⑩ 档位箭头：循环切换（首 −1 / 末 +1 回绕、整圈归位）＋未知档落到首档＋仅一档 ⇒ 两箭头灰（oneTier）', p);
  }

  // ⑪ 星门面板契约：**没有星域编号**（键里没有 seed，值里也不含编号字符串）
  {
    const p = [];
    const a = mkState(1);
    if (!a.ok) p.push('自检样本搭建失败');
    else {
      const secret = 'EXP-M3D-SECRET-SEED';
      const launch = launchExpeditionIn(a.state, [{ id: a.id, n: 1 }], { starfieldId: tier, seed: secret });
      if (!launch.ok) p.push(`出征应成功（现 ${launch.reason.code}）`);
      else {
        const dump = (o) => JSON.stringify(o === undefined ? null : o);
        const walkKeys = (o, path, out) => {
          if (!o || typeof o !== 'object') return out;
          for (const [k, v] of Object.entries(o)) {
            out.push(`${path}${k}`);
            if (v && typeof v === 'object') walkKeys(v, `${path}${k}.`, out);
          }
          return out;
        };
        const v = stargateViewIn(a.state, { frontId: tier, current: launch.starfield });
        const keys = walkKeys(v, '', []);
        const badKey = keys.filter((k) => /seed|编号|sfcode/i.test(k));
        if (badKey.length) p.push(`星门面板契约不得含编号字段（现 ${badKey.join('/')}）`);
        if (dump(v).includes(secret)) p.push('星门面板契约不得含星域编号的值');
        if (!v.field || v.field.configId !== tier) p.push('已开星域 ⇒ field.configId 应为当前档');
        // 确认"编号确实存在"（只在星域侧）⇒ 免得上面的断言因为"根本没建星域"而假绿
        if (launch.starfield.seed !== secret) p.push('预置：星域编号应＝传入的编号');
        if (!dump(launch.starfield.summary()).includes(secret)) p.push('预置：星域侧摘要应含编号（编号只在星域侧显示）');
      }
    }
    add('⑪ 星门面板契约**不含星域编号**（无 seed 键、值里无编号字符串）；编号只在星域侧（摘要含它）', p);
  }

  // ⑫ 已开星域 ⇒ 面板显「剩余时间」（读容器、随 tick 递减）；fieldBusy 只表示"不可另开新档"
  {
    const p = [];
    const a = mkState(1);
    if (!a.ok) p.push('自检样本搭建失败');
    else {
      const launch = launchExpeditionIn(a.state, [{ id: a.id, n: 1 }], { starfieldId: tier, seed });
      if (!launch.ok) p.push(`出征应成功（现 ${launch.reason.code}）`);
      else {
        const sf = launch.starfield;
        const v0 = stargateViewIn(a.state, { frontId: tier, current: sf });
        if (v0.mode !== 'dispatch') p.push(`已开星域 ⇒ mode 应为 dispatch（现 ${v0.mode}）`);
        if (!v0.field) p.push('已开星域 ⇒ 应给出 field（剩余时间/存活数）');
        else {
          if (v0.field.remainingTicks !== sf.remainingTicks) p.push('剩余时间应＝容器只读口径');
          if (v0.field.configId !== tier) p.push('field.configId 应为当前档');
          if (v0.field.alive !== 1) p.push(`field.alive 应为 1（现 ${v0.field.alive}）`);
        }
        if (v0.tierNav.index !== listBattlefronts().map((f) => f.id).indexOf(tier)) p.push('档位锁定为当前星域的档');
        // 推进 1 tick ⇒ 剩余时间恰 −1（只读事实、界面不自算）
        const before = v0.field ? v0.field.remainingTicks : 0;
        sf.step(1);
        const v1 = stargateViewIn(a.state, { frontId: tier, current: sf });
        if (!v1.field || v1.field.remainingTicks !== before - 1) p.push(`推进 1 tick 后剩余时间应恰 −1（${before} → ${v1.field && v1.field.remainingTicks}）`);
        // 结束后 ⇒ 回到 launch 模式（field 为空、可再择档）
        // ★ 用 `stop()` 制造"星域已收场"（**不模拟 3600t 的整段战斗** ⇒ 自检轻量、确定）
        sf.stop();
        const v2 = stargateViewIn(a.state, { frontId: tier, current: sf });
        if (v2.mode !== 'activate') p.push(`星域结束后 mode 应回到 activate（现 ${v2.mode}）`);
        if (v2.field !== null) p.push('星域结束后 field 应为 null');
      }
    }
    add('⑫ 已开星域 ⇒ 面板显剩余时间（读容器、推进 1tick 恰 −1）；fieldBusy 语义＝不可另开新档（同档可继续派遣）', p);
  }

  // ⑬ 多次派遣：**增量注入既有星域**（不重建、既有单位与星区状态不变）、out 累加、费用逐次扣、超上限两侧零改动
  {
    const p = [];
    const a = mkState(0);
    if (!a.ok) p.push('自检样本搭建失败');
    else {
      const cap = base.deploySquadTotalsIn(a.state, []).limit;
      // ★ 样本要多造 1 艘：这样"已到上限"时仍有**空闲单位**可派 ⇒ 才能核对"超出上限**只加价**"的口径
      //   （★ 迭代 3：上限**不再拦截** ⇒ 这里测的是加价与"空闲耗尽后才拒绝"）
      const b = base.buildIn(a.state, a.id, cap + 1);
      if (!b.ok) p.push('样本造船失败');
      const l1 = launchExpeditionIn(a.state, [{ id: a.id, n: 1 }], { starfieldId: tier, seed });
      if (!l1.ok) p.push(`首战出征应成功（现 ${l1.reason.code}）`);
      else {
        const sf = l1.starfield;
        const entryBattle = sf.battleOf(sf.playerEntryIndex);
        const firstUnit = entryBattle.units().find((u) => u.baseRef && u.baseRef.ordinal === 1);
        const entryUnits0 = entryBattle.units().length;
        // 其它星区的既有只读事实（注入后必须不变）
        const others0 = sf.sectors.filter((s) => s.index !== sf.playerEntryIndex).map((s) => `${s.index}:${s.ore}:${s.cargoCount}:${s.alive.ally}:${s.alive.enemy}`).join('|');
        const cfg0 = a.state.fleetConfigs.find((c) => c.id === a.id);
        const out0 = cfg0.out;
        const count0 = cfg0.count;
        const res0 = { ...a.state.resources };
        const add1 = dispatchExpeditionIn(a.state, sf, [{ id: a.id, n: cap - 1 }]);
        if (!add1.ok) p.push(`多次派遣应成功（现 ${add1.reason.code}）`);
        else {
          const cfg = a.state.fleetConfigs.find((c) => c.id === a.id);
          if (cfg.out !== out0 + (cap - 1)) p.push(`派遣 ⇒ out 应累加（${out0} → ${cfg.out}）`);
          if (cfg.count !== count0) p.push('派遣不得改变 count');
          if (entryBattle.units().length !== entryUnits0 + (cap - 1)) p.push('新单位应**注入入场星区**（既有星区不被重建）');
          if (!firstUnit || !entryBattle.units().includes(firstUnit)) p.push('既有单位对象必须**原样保留**（不得重建星域）');
          if (firstUnit && firstUnit.baseRef.ordinal !== 1) p.push('既有单位的归属序号不得变');
          const alive = (sf.baseUnits || []).filter((u) => u.alive).length;
          if (alive !== cap) p.push(`派遣后同时存活数应为 ${cap}（现 ${alive}）`);
          if (add1.alive !== cap) p.push(`回执里的存活数应为 ${cap}（现 ${add1.alive}）`);
          const others1 = sf.sectors.filter((s) => s.index !== sf.playerEntryIndex).map((s) => `${s.index}:${s.ore}:${s.cargoCount}:${s.alive.ally}:${s.alive.enemy}`).join('|');
          if (others1 !== others0) p.push('注入不得改动其它星区的既有状态');
          // 费用：★ 迭代 3 口径＝**费率分界**计价（本次 `cap-1` 艘都落在"正常名额"内 ⇒ 一律正常价）
          const dc = deployCostOf(tier);
          const price1 = dispatchPriceOf(tier, cap - 1, cap - 1); // r ＝ maxFleet − 存活(1) ＝ cap−1
          if (price1.over !== 0) p.push('预置：本次派遣应恰好落在"正常名额"内');
          for (const k of Object.keys(dc)) {
            if (dc[k] > 0 && a.state.resources[k] !== res0[k] - dc[k] * (cap - 1)) {
              p.push(`正常名额内的费用应按**每艘**扣减：${k} 期望 ${res0[k] - dc[k] * (cap - 1)}（现 ${a.state.resources[k]}）`);
            }
          }
          // ★★ 迭代 3：**超出上限的派遣不再被拒**（上限＝费率分界）⇒ 第 `cap+1` 艘照常注入，只是**加价**
          const resBeforeOver = { ...a.state.resources };
          const overPush = dispatchExpeditionIn(a.state, sf, [{ id: a.id, n: 1 }]);
          if (!overPush.ok) p.push(`超出上限的派遣**不应再被拒**（现 ${overPush.reason.code}）`);
          else {
            if (overPush.alive !== cap + 1) p.push(`超上限派遣后同时存活应为 ${cap + 1}（现 ${overPush.alive}）`);
            for (const k of Object.keys(dc)) {
              if (dc[k] > 0) {
                const rq = overQuotaRateOf(tier);
                const mult = Math.pow(1 + rq.offset, rq.exponent); // m ＝ 1 ⇒ (1 + offset)^exponent
                const want = resBeforeOver[k] - Math.ceil(dc[k] * mult);
                if (a.state.resources[k] !== want) {
                  p.push(`超出 1 艘的加价应为 ceil(单船费 × (1+offset)^exponent)：${k} 期望 ${want}（现 ${a.state.resources[k]}）`);
                }
              }
            }
          }
          // 空闲单位耗尽 ⇒ `noIdle`（★ 这才是真正的拒绝口径；同样两侧零改动）
          const fzState = JSON.stringify(a.state);
          const fzField = entryBattle.units().length;
          const noIdle = dispatchExpeditionIn(a.state, sf, [{ id: a.id, n: 1 }]);
          if (noIdle.ok) p.push('空闲单位耗尽后继续派遣应被拒（现 ok）');
          else if (noIdle.reason.code !== 'noIdle') p.push(`空闲耗尽应返回 noIdle（现 ${noIdle.reason.code}）`);
          if (JSON.stringify(a.state) !== fzState) p.push('派遣失败 ⇒ 基地必须零改动');
          if (entryBattle.units().length !== fzField) p.push('派遣失败 ⇒ 星域必须零改动（不得留下多余单位）');
        }
      }
    }
    add('⑬ 多次派遣：增量注入既有星域（不重建、既有单位与其它星区状态不变）、out 累加/正常段按每艘扣、**超上限只加价不拒绝**、失败（noIdle）两侧零改动', p);
  }

  // ⑭ 放弃星域：有存活派遣单位 ⇒ unitsAlive 且零改动；无存活 ⇒ 走 end 结算成功；无星域 ⇒ noField
  {
    const p = [];
    const a = mkState(2);
    if (!a.ok) p.push('自检样本搭建失败');
    else {
      // 无星域 ⇒ noField（且零改动）
      const snap0 = JSON.stringify(a.state);
      const none = giveUpExpeditionIn(a.state, null);
      if (none.ok) p.push('无星域时放弃应被拒（现 ok）');
      else if (none.reason.code !== 'noField') p.push(`无星域应返回 noField（现 ${none.reason.code}）`);
      if (JSON.stringify(a.state) !== snap0) p.push('无星域放弃不得改状态');
      const launch = launchExpeditionIn(a.state, [{ id: a.id, n: 2 }], { starfieldId: tier, seed });
      if (!launch.ok) p.push(`出征应成功（现 ${launch.reason.code}）`);
      else {
        const sf = launch.starfield;
        // ① 还有存活派遣单位 ⇒ 拒绝 + 零改动
        const snap = JSON.stringify(a.state);
        const before = (sf.baseUnits || []).filter((u) => u.alive).length;
        const chk = giveUpCheckIn(a.state, sf);
        if (chk.ok) p.push('仍有存活派遣单位时应不得放弃（现 ok）');
        else if (chk.reason.code !== 'unitsAlive') p.push(`应返回 unitsAlive（现 ${chk.reason.code}）`);
        else if (chk.reason.alive !== before) p.push(`unitsAlive 应带存活数 ${before}（现 ${chk.reason.alive}）`);
        const gu1 = giveUpExpeditionIn(a.state, sf);
        if (gu1.ok) p.push('仍有存活单位时放弃应失败（现 ok）');
        if (JSON.stringify(a.state) !== snap) p.push('放弃被拒 ⇒ 基地零改动');
        if ((sf.baseUnits || []).length !== 2) p.push('放弃被拒 ⇒ 星域零改动（单位仍在）');
        // ② 单位全部销毁（阵亡）⇒ 可放弃，走 end 结算
        for (const v of sf.baseUnits) {
          const u = sf.battleOf(sf.playerEntryIndex).units().find((x) => x.id === v.unitId);
          if (u) u.alive = false;
        }
        const cfg0 = a.state.fleetConfigs.find((c) => c.id === a.id);
        const c0 = { out: cfg0.out, count: cfg0.count };
        const chk2 = giveUpCheckIn(a.state, sf);
        if (!chk2.ok) p.push(`无存活派遣单位时应可放弃（现 ${chk2.reason.code}）`);
        const gu2 = giveUpExpeditionIn(a.state, sf);
        if (!gu2.ok) p.push(`无存活派遣单位时放弃应成功（现 ${gu2.reason.code}）`);
        else {
          const cfg = a.state.fleetConfigs.find((c) => c.id === a.id);
          if (cfg.count !== c0.count - 2 || cfg.out !== c0.out - 2) p.push(`放弃 ⇒ 未返回单位应按损毁销账（count/out 各 −2：现 ${cfg.count}/${cfg.out}）`);
          if (gu2.report && gu2.report.ok && gu2.report.returned !== 0) p.push('放弃时不应有"返回"（无存活本单位）');
          const again = giveUpExpeditionIn(a.state, sf);
          if (!again.ok) p.push('放弃后可重复调用（幂等 ⇒ 仍应成功/无事可做）');
        }
      }
    }
    add('⑭ 放弃星域：仍有存活派遣单位 ⇒ unitsAlive 且两侧零改动；无存活 ⇒ 走 end 结算成功（未返回按损毁销账）；无星域 ⇒ noField', p);
  }

  // ⑮ 变白计划：环序＝到中心距离**单调不减**、每环 tick 读配置、覆盖全部星区（无重复无遗漏）、确定性
  {
    const p = [];
    const a = mkState(1);
    if (!a.ok) p.push('自检样本搭建失败');
    else {
      const launch = launchExpeditionIn(a.state, [{ id: a.id, n: 1 }], { starfieldId: tier, seed });
      if (!launch.ok) p.push(`出征应成功（现 ${launch.reason.code}）`);
      else {
        const sf = launch.starfield;
        sf.settle(); // ★ 演出前提＝星域已收场（本项只测"计划"本身 ⇒ 用容器占位结算收场，不跑整段战斗）
        const beg = sf.beginCollapse();
        if (!beg.ok) p.push(`开始演出应成功（现 ${beg.reason && beg.reason.code}）`);
        const plan = sf.whitenPlan;
        if (!plan) p.push('演出开始后应有变白计划');
        else {
          const cfg = getStarfieldCfg(tier);
          const wantTicks = Number.isInteger(cfg.collapseRingTicks) ? cfg.collapseRingTicks : 20;
          if (plan.ringTicks !== wantTicks) p.push(`每环 tick 数应读配置（期望 ${wantTicks}，现 ${plan.ringTicks}）`);
          if (sf.collapseRingTicks !== wantTicks) p.push('容器应暴露每环 tick 数（读配置）');
          const all = sf.sectors.map((s) => s.index);
          const seen = plan.order.slice().sort((x, y) => x - y);
          if (seen.length !== all.length || seen.some((x, i) => x !== all.slice().sort((x2, y2) => x2 - y2)[i])) p.push('计划应覆盖全部星区且无重复无遗漏');
          // 环序：atTick 严格递增、环内集合非空、环号单调不减
          let lastTick = -1;
          let ok2 = true;
          for (const r of plan.rings) {
            if (r.atTick <= lastTick) ok2 = false;
            if (!r.sectorIndexes.length) ok2 = false;
            lastTick = r.atTick;
          }
          if (!ok2) p.push('各环应非空且 atTick 严格递增');
          // 距离单调不减（按 order 逐格算 round(到中心距离)）
          const byIndex = new Map(sf.sectors.map((s) => [s.index, s]));
          let prev = -1;
          for (const idx of plan.order) {
            const s = byIndex.get(idx);
            const ring = s ? Math.round(Math.sqrt(s.q * s.q + s.r * s.r)) : -1;
            if (ring < prev) p.push('变白顺序应按到中心距离单调不减');
            prev = Math.max(prev, ring);
          }
          // 第 0 环＝中心恒星（引擎不变量：恰一个 isStar 且在 (0,0)）
          const star = sf.sectors.find((s) => s.isStar);
          if (!star || !plan.rings.length || !plan.rings[0].sectorIndexes.includes(star.index)) p.push('第 0 环应含中心恒星');
          if (plan.totalTicks !== plan.ringCount * plan.ringTicks) p.push('总时长应＝环数 × 每环 tick 数');
          // 进度：t=0 ⇒ 只有第 0 环；推进 1 环 ⇒ 前两环；播完 ⇒ 全部
          const w0 = sf.whiteSectorIndexes.slice().sort((x, y) => x - y);
          const r0 = plan.rings[0].sectorIndexes.slice().sort((x, y) => x - y);
          if (JSON.stringify(w0) !== JSON.stringify(r0)) p.push('t=0 时只应有第 0 环变白');
          if (sf.collapseDone) p.push('未播完时 collapseDone 应为 false');
          sf.step(plan.ringTicks);
          const w1 = sf.whiteSectorIndexes.length;
          if (plan.rings.length > 1 && w1 !== plan.rings[0].count + plan.rings[1].count) p.push('推进 1 环后应恰好多第 1 环');
          sf.step(plan.totalTicks);
          if (sf.whiteSectorIndexes.length !== plan.sectorCount) p.push('播完后应全部变白');
          if (!sf.collapseDone) p.push('播完后 collapseDone 应为 true');
          // 确定性：同档同编号 ⇒ 同计划
          const a2 = mkState(1);
          if (!a2.ok) p.push('第二个样本搭建失败');
          else {
            const l2 = launchExpeditionIn(a2.state, [{ id: a2.id, n: 1 }], { starfieldId: tier, seed });
            if (!l2.ok) p.push('第二个星域创建失败');
            else {
              l2.starfield.settle();
              l2.starfield.beginCollapse();
              if (JSON.stringify(l2.starfield.whitenPlan) !== JSON.stringify(plan)) p.push('同输入 ⇒ 变白计划应完全一致');
            }
          }
        }
      }
    }
    add('⑮ 变白计划：按到中心距离**单调不减**的环序（第 0 环＝中心恒星）、每环 tick 读配置、覆盖全部星区无重复无遗漏、确定性', p);
  }

  // ⑯ 结束演出期间**零玩法副作用**：不 step 星区（无新战报/无存活变化/无资源变化）、拒收指令、基地零改动
  {
    const p = [];
    const a = mkState(1);
    if (!a.ok) p.push('自检样本搭建失败');
    else {
      const launch = launchExpeditionIn(a.state, [{ id: a.id, n: 1 }], { starfieldId: tier, seed });
      if (!launch.ok) p.push(`出征应成功（现 ${launch.reason.code}）`);
      else {
        const sf = launch.starfield;
        const id = (sf.baseUnits || [])[0].unitId;
        sf.step(3); // 先跑几 tick（正常玩法）
        // ★ 真实时序：**先结算**（星门星区存活者自动返回）⇒ 再开演 ⇒ 演出期间不得再有任何结算
        //   （`sf.settle()` 只是把容器标成"已结算"以进入演出前提；**账目结算由下面这唯一入口完成**）
        sf.settle();
        const end = settleExpeditionIn(a.state, sf, { mode: 'end' });
        if (!end.ok) p.push(`结束结算应成功（现 ${end.reason.code}）`);
        sf.beginCollapse();
        const sig = () => sf.sectors.map((s) => `${s.index}:${s.alive.ally}:${s.alive.enemy}:${s.ore}:${s.cargoCount}:${s.logLines}:${s.phase}`).join('|');
        const before = sig();
        const run0 = sf.runTicks;
        const fzState = JSON.stringify(a.state);
        const fzUnits = JSON.stringify(sf.baseUnits.map((u) => `${u.unitId}:${u.alive}:${u.hp}:${u.ore}`));
        const r = sf.step(5);
        if (!r.collapsing) p.push('演出期间 step 应标记 collapsing');
        if (sf.runTicks !== run0) p.push('演出期间不得推进星域时间（runTicks 不变）');
        if (sig() !== before) p.push('演出期间**不得有任何玩法副作用**（存活/矿物/货物/战报/阶段都应不变）');
        if (JSON.stringify(a.state) !== fzState) p.push('演出期间基地状态不得变');
        if (JSON.stringify(sf.baseUnits.map((u) => `${u.unitId}:${u.alive}:${u.hp}:${u.ore}`)) !== fzUnits) p.push('演出期间单位状态不得变');
        const mv = sf.moveUnitTo(id, sf.playerEntryIndex);
        if (mv.ok) p.push('演出期间应拒收移动指令（现 ok）');
        else if (mv.reason !== 'finished') p.push(`演出期间拒收指令的原因应为 finished（现 ${mv.reason}）`);
        const t = tickExpeditionIn(a.state, sf);
        if (t.sync || t.end) p.push('演出期间不得产生结算回执（已结算 ⇒ 无事可做）');
        if (JSON.stringify(a.state) !== fzState) p.push('演出期间的例行结算调用不得改基地状态');
        if (!sf.collapseDone) {
          sf.step(sf.whitenPlan.totalTicks);
          if (!sf.collapseDone) p.push('推进足够 tick 后演出应收尾');
        }
        if (!sf.collapsing) p.push('演出状态应保持 collapsing（直到界面清理星域）');
      }
    }
    add('⑯ 结束演出期间零玩法副作用：不推进星域时间、无战报/存活/资源变化、拒收指令（finished）、基地零改动', p);
  }

  // ⑰ 演出播完 ⇒ 清理（界面把当前星域置空）后**可再开新星域**：档位自由、out 继续累加
  {
    const p = [];
    const a = mkState(2);
    if (!a.ok) p.push('自检样本搭建失败');
    else {
      const l1 = launchExpeditionIn(a.state, [{ id: a.id, n: 1 }], { starfieldId: tier, seed });
      if (!l1.ok) p.push(`首次出征应成功（现 ${l1.reason.code}）`);
      else {
        const sf = l1.starfield;
        sf.settle();
        sf.beginCollapse();
        sf.step(sf.whitenPlan.totalTicks);
        if (!sf.collapseDone) p.push('演出应播完');
        if (fieldLive(sf)) p.push('演出中/播完的星域不应再算"开着"');
        // 「清理」＝界面把当前星域置空（`setStarfield(null)`）⇒ 编排层看到 current=null ⇒ 可再开新档
        const v = stargateViewIn(a.state, { current: null, frontId: cycleFrontId(tier, 1) });
        if (v.mode !== 'activate') p.push(`清理后应可再激活星域（现 ${v.mode}）`);
        if (v.field !== null) p.push('清理后 field 应为 null');
        const other = cycleFrontId(tier, 1);
        const l2 = launchExpeditionIn(a.state, [{ id: a.id, n: 1 }], { starfieldId: other, seed: `${seed}-2` });
        if (!l2.ok) p.push(`清理后换档再开应成功（现 ${l2.reason.code}）`);
        else {
          const cfg = a.state.fleetConfigs.find((c) => c.id === a.id);
          if (cfg.out !== 2) p.push(`两次出征 ⇒ out 应累加为 2（现 ${cfg.out}）`);
          if (l2.starfield && l2.starfield.configId !== other) p.push('新星域的档位应为新选的档');
          if (fieldLive(l1.starfield)) p.push('旧星域不应重新变活');
        }
      }
    }
    add('⑰ 演出播完 ⇒ 清理后可再开新星域（换档自由、out 继续累加、旧星域不再算活着）', p);
  }

  // ⑱ 空态契约（★ 缺陷回归防护）：星门面板的唯一数据源 `stargateViewIn` 在**四种边界数据**下
  //    都必须产出**契约完整**的只读视图且**不抛错** —— ③④ 之外还含"没有战区档位"（注入空清单）。
  //    ★ 为什么测的是它：面板崩溃的根因往往在"空数据 ⇒ 界面拿到 undefined/非数组 ⇒ 渲染抛错"，
  //      而引擎侧保证"任何数据下都给得出完整契约"是界面不崩的**前提条件**（纯函数、不依赖 DOM）。
  {
    const p = [];
    /** 契约断言：字段齐全 + 类型正确 + 原因对象要么 null 要么有 `code` */
    const reasonOk = (r) => r === null || (!!r && typeof r === 'object' && typeof r.code === 'string');
    const checkContract = (label, v, wantMode) => {
      if (!v || typeof v !== 'object') {
        p.push(`${label}: 视图应为对象`);
        return;
      }
      if (wantMode && v.mode !== wantMode) p.push(`${label}: mode 应为 ${wantMode}（现 ${v.mode}）`);
      if (v.tier !== null && typeof v.tier !== 'object') p.push(`${label}: tier 应为对象或 null`);
      const tn = v.tierNav;
      if (!tn || !Array.isArray(tn.ids) || typeof tn.canPrev !== 'boolean' || typeof tn.canNext !== 'boolean') p.push(`${label}: tierNav 契约不全`);
      else if (tn.canPrev || tn.canNext) {
        if (tn.reason !== null) p.push(`${label}: 箭头可用时 reason 应为 null`);
      } else if (!reasonOk(tn.reason)) p.push(`${label}: 箭头不可用时应给出原因码`);
      if (v.field !== null && (!v.field || !Number.isFinite(v.field.remainingTicks))) p.push(`${label}: field 应为 null 或含 remainingTicks`);
      const t = v.totals;
      if (!t || !Number.isInteger(t.limit) || !Number.isInteger(t.used) || !Number.isInteger(t.total) || !Number.isInteger(t.remaining)) p.push(`${label}: totals 四项都应是整数`);
      if (!Number.isInteger(v.alive) || v.alive < 0) p.push(`${label}: alive 应为非负整数`);
      if (!v.unitCost || typeof v.unitCost !== 'object') p.push(`${label}: unitCost 应为对象`);
      if (!v.activateCost || typeof v.activateCost !== 'object') p.push(`${label}: activateCost 应为对象`);
      if (!v.cost || typeof v.cost !== 'object') p.push(`${label}: cost（本次实际收费，合并后的一个数）应为对象`);
      if ('cardLimit' in v) p.push(`${label}: cardLimit 应已删除（迭代 3：上限不再限制可选艘数）`);
      // ★★ 迭代 4：**唯一主按钮**契约（`activate` / `dispatch` 两个并列判据已合并进 `primary`）
      const pm = v.primary;
      if (!pm || typeof pm !== 'object') p.push(`${label}: primary 应为对象（界面唯一主按钮口径）`);
      else {
        if (pm.mode !== 'activate' && pm.mode !== 'dispatch') p.push(`${label}: primary.mode 应为 activate / dispatch（现 ${pm.mode}）`);
        else if (pm.mode !== v.mode) p.push(`${label}: primary.mode 应与顶层 mode 同源（${pm.mode} ≠ ${v.mode}）`);
        const wantKey = pm.mode === 'dispatch' ? 'base.stargate.dispatchGo' : 'base.stargate.activateGo';
        if (pm.labelKey !== wantKey) p.push(`${label}: primary.labelKey 应为词条键 ${wantKey}（现 ${pm.labelKey}）`);
        else {
          for (const loc of i18n.locales) if (!i18n.has(pm.labelKey, loc)) p.push(`${label}: 缺词条 ${pm.labelKey}@${loc}`);
        }
        if (typeof pm.ok !== 'boolean') p.push(`${label}: primary.ok 应为布尔`);
        else if (!pm.ok && !reasonOk(pm.reason)) p.push(`${label}: primary 不可用时应给出原因码`);
        else if (pm.ok && pm.reason !== null) p.push(`${label}: primary 可用时 reason 应为 null`);
        if (!pm.cost || typeof pm.cost !== 'object') p.push(`${label}: primary.cost 应为对象（合并后的一个数）`);
        else if (pm.cost !== v.cost) p.push(`${label}: primary.cost 应与顶层 cost 是**同一个结果**（同一份合并求和）`);
      }
      if ('activate' in v || 'dispatch' in v) p.push(`${label}: activate / dispatch 两个并列判据应已合并进 primary`);
      if (typeof v.giveUp !== 'object' || typeof v.giveUp.ok !== 'boolean') p.push(`${label}: giveUp.ok 应为布尔`);
      else if (!v.giveUp.ok && !reasonOk(v.giveUp.reason)) p.push(`${label}: giveUp 不可用时应给出原因码`);
      // ★★ 迭代 4：`price` 仍**必须**给出计价明细（**界面已不显示分界行**，但自检与 M4 仍依赖它）
      const pr = v.price;
      if (!pr || !Number.isInteger(pr.normal) || !Number.isInteger(pr.over) || pr.over < 0 || !Number.isInteger(pr.remaining)) {
        p.push(`${label}: price 应给出整数 normal / over / remaining`);
      } else if (pr.normal + pr.over !== v.totals.total) {
        p.push(`${label}: price 的 normal ＋ over 应等于本次选中艘数（${pr.normal} ＋ ${pr.over} ≠ ${v.totals.total}）`);
      } else if (!pr.rate || !(pr.rate.exponent > 0) || !(pr.rate.offset >= 1)) {
        p.push(`${label}: price.rate 应取自配置（exponent > 0 / offset ≥ 1）`);
      }
    };
    const viewOf = (state, opts) => {
      try {
        return { ok: true, v: stargateViewIn(state, opts) };
      } catch (err) {
        p.push(`视图函数抛错：${err && err.message ? String(err.message) : String(err)}`);
        return { ok: false, v: null };
      }
    };
    // ① 无任何单位配置（空基地）
    const s1 = base.createBaseState();
    const r1 = viewOf(s1, { frontId: tier, current: null, specs: [] });
    if (r1.ok) checkContract('无配置', r1.v, 'activate');
    // ② 有配置但**没有建过任何单位**（`idle = 0`）＋ 装配里携带"多余的空条目"（界面可能这么传）
    const a2 = mkState(0);
    if (!a2.ok) p.push('自检样本搭建失败');
    else {
      const r2 = viewOf(a2.state, { frontId: tier, current: null, specs: [{ id: a2.id, n: 0 }] });
      if (r2.ok) {
        checkContract('有配置无单位', r2.v, 'activate');
        // ★ 迭代 2 口径：未激活时主按钮是「激活星域」——**零单位也必须可激活**（空星域先存在）；
        //   此时装配条目全为 0 ⇒ `primary.ok` 仍应为 true（费用＝激活费，资源充足）
        if (!r2.v.primary.ok) p.push(`零单位激活应可用（现 ${r2.v.primary.reason && r2.v.primary.reason.code}）`);
        if (r2.v.primary.mode !== 'activate') p.push(`未激活 ⇒ 主按钮应为「激活星域」（现 ${r2.v.primary.mode}）`);
        if (r2.v.primary.labelKey !== 'base.stargate.activateGo') p.push('未激活 ⇒ 主按钮文本键应为 activateGo');
      }
      // ★★ 迭代 2 **不弱化**：先前的口径"**没有空闲单位** ⇒ 不可出征（`noIdle`）"现在落在**主按钮的派遣态**上
      //    —— 零单位激活出空星域后，再派 1 艘必须被逐条名额判据拦下（`noIdle`），且**两侧零改动**。
      const l2 = activateExpeditionIn(a2.state, [], { starfieldId: tier, seed });
      if (!l2.ok) p.push(`零单位激活应成功（现 ${l2.reason.code}）`);
      else {
        const fz = JSON.stringify(a2.state);
        const live0 = stargateViewIn(a2.state, { frontId: tier, current: l2.starfield, specs: [{ id: a2.id, n: 1 }] });
        if (live0.mode !== 'dispatch') p.push(`已激活 ⇒ mode 应为 dispatch（现 ${live0.mode}）`);
        if (live0.primary.mode !== 'dispatch') p.push(`已激活 ⇒ 主按钮应为「派遣」（现 ${live0.primary.mode}）`);
        if (live0.primary.labelKey !== 'base.stargate.dispatchGo') p.push('已激活 ⇒ 主按钮文本键应为 dispatchGo');
        if (live0.primary.ok) p.push('configId 无任何单位时「派遣」应被拒（现 ok）');
        else if (live0.primary.reason.code !== 'noIdle') p.push(`无空闲单位应返回 noIdle（现 ${live0.primary.reason.code}）`);
        const bad = dispatchExpeditionIn(a2.state, l2.starfield, [{ id: a2.id, n: 1 }]);
        if (bad.ok) p.push('无空闲单位时派遣应被拒（现 ok）');
        else if (bad.reason.code !== 'noIdle') p.push(`无空闲单位应返回 noIdle（现 ${bad.reason.code}）`);
        if (JSON.stringify(a2.state) !== fz) p.push('无空闲单位 ⇒ 基地零改动');
        if (aliveDeployedOf(l2.starfield) !== 0) p.push('无空闲单位 ⇒ 星域零改动');
      }
      // ④ 无星域 ⇒ giveUp 必须被拒（noField）且不抛错
      if (r2.ok && (r2.v.giveUp.ok || r2.v.giveUp.reason.code !== 'noField')) p.push('无星域 ⇒ giveUp 应拒（noField）');
    }
    // ③ 有星域进行中 ⇒ `mode:'dispatch'`（且 field 契约完整）
    const a3 = mkState(1);
    if (!a3.ok) p.push('自检样本搭建失败');
    else {
      const l3 = launchExpeditionIn(a3.state, [{ id: a3.id, n: 1 }], { starfieldId: tier, seed });
      if (!l3.ok) p.push(`激活应成功（现 ${l3.reason.code}）`);
      else {
        const r3 = viewOf(a3.state, { frontId: tier, current: l3.starfield, specs: [] });
        if (r3.ok) checkContract('星域进行中', r3.v, 'dispatch');
      }
    }
    // 边界：**没有战区档位**（注入空清单；真实注册表恒非空 ⇒ 这条只防"配置被清空"的极端情形）
    const r4 = viewOf(s1, { fronts: [], frontId: '', current: null, specs: [] });
    if (r4.ok) {
      checkContract('无档位', r4.v, 'activate');
      if (r4.v.tier !== null) p.push('无档位 ⇒ tier 应为 null');
      if (r4.v.tierNav.canPrev || r4.v.tierNav.canNext) p.push('无档位 ⇒ 两个箭头都应不可用');
      if (!r4.v.tierNav.reason || r4.v.tierNav.reason.code !== 'unknown') p.push('无档位 ⇒ 原因应为 unknown');
      if (r4.v.field !== null) p.push('无档位 ⇒ field 应为 null');
    }
    add('⑱ 空态契约（无配置 / 有配置无单位 / 星域进行中 / 无星域 / 无战区档位）：视图函数不抛错且字段齐全、类型正确、原因码齐备', p);
  }

  // ⑲ ★ 迭代 2：**变白进度契约**（渐变式变白的引擎侧保证）——t=0 全 0 / 环内 `collapseRingTicks` 内**线性**到 1 /
  //    覆盖全部星区 / 环序单调 / **同输入同进度**（确定性：同一 tick 反复读取结果逐字节一致）
  {
    const p = [];
    const a = mkState(1);
    if (!a.ok) p.push('自检样本搭建失败');
    else {
      const l = launchExpeditionIn(a.state, [{ id: a.id, n: 1 }], { starfieldId: tier, seed });
      if (!l.ok) p.push(`激活应成功（现 ${l.reason.code}）`);
      else {
        const sf = l.starfield;
        sf.stop(); // 立刻结束（不再推进任何星区），随后开演
        const beg = sf.beginCollapse();
        if (!beg.ok) p.push(`开演应成功（现 ${beg.reason.code}）`);
        else {
          const plan = sf.whitenPlan;
          const ringTicks = sf.collapseRingTicks;
          if (plan.ringTicks !== ringTicks || !(ringTicks > 0)) p.push('计划的 ringTicks 应为 >0 且与容器口径一致');
          // ① t=0：全部星区进度为 0
          const all = sf.sectors.map((s) => s.index);
          for (const idx of all) {
            if (sf.sectorWhitenProgress(idx) !== 0) p.push(`t=0 时 progress 应全为 0（星区 ${idx}）`);
          }
          // ② 覆盖：计划的 order 与星区集合**逐一对应**（无重复无遗漏）
          const orderSet = new Set(plan.order);
          if (orderSet.size !== plan.order.length) p.push('计划 order 有重复');
          if (plan.order.length !== all.length) p.push(`计划应覆盖全部星区（${plan.order.length} vs ${all.length}）`);
          for (const idx of all) if (!orderSet.has(idx)) p.push(`计划遗漏星区 ${idx}`);
          // ③ 环序单调（环号升序）＋ 区间首尾相接（环与环依次推进）
          for (let i = 0; i < plan.rings.length; i += 1) {
            const r = plan.rings[i];
            if (r.fromTick !== i * ringTicks || r.toTick !== r.fromTick + ringTicks) p.push(`第 ${i} 环区间应为 [${i * ringTicks}, ${(i + 1) * ringTicks}]`);
            if (i > 0 && r.ring < plan.rings[i - 1].ring) p.push('环序应单调不减');
          }
          // ④ 环内**线性**：取第 0 环的任一星区，在区间内逐点核对 0→1 线性（并核对环内**并行**：同环所有星区同值）
          const ring0 = plan.rings[0];
          const probes = [0, Math.floor(ringTicks / 4), Math.floor(ringTicks / 2), ringTicks - 1, ringTicks];
          for (const t of probes) {
            sf.step(t - sf.collapseElapsed); // 推进到 t（`step` 只推进演出、不 step 星区）
            const want = Math.min(1, Math.max(0, t / ringTicks));
            const vals = ring0.sectorIndexes.map((idx) => sf.sectorWhitenProgress(idx));
            for (const v of vals) {
              if (Math.abs(v - want) > 1e-9) p.push(`第 0 环 t=${t} 进度应为 ${want}（现 ${v}）`);
            }
            if (new Set(vals).size > 1) p.push(`同环内应**并行同进度**（t=${t} 出现 ${new Set(vals).size} 种进度）`);
          }
          if (sf.sectorWhitenProgress(ring0.sectorIndexes[0]) !== 1) p.push('走完一整环 ⇒ 该环应恰好为 1（全白）');
          // ⑤ 后一环比前一环晚（未到区间 ⇒ 0；到区间中部 ⇒ 严格大于 0）
          if (plan.rings.length > 1) {
            const r1 = plan.rings[1];
            const r0first = plan.rings[0].sectorIndexes[0];
            const r1first = r1.sectorIndexes[0];
            if (sf.sectorWhitenProgress(r0first) !== 1) p.push('第 0 环走完应已全白');
            if (r1.fromTick !== ringTicks) p.push('第 1 环应与第 0 环**首尾相接**（前环走完才开始）');
            if (sf.sectorWhitenProgress(r1first) !== 0) p.push('第 1 环在起点应仍为 0（环序推进）');
          }
          // ⑥ 确定性：同一 tick 反复读取 ⇒ 结果逐字节一致（纯函数、无随机）
          const snapA = JSON.stringify(plan.rings.map((r) => r.sectorIndexes.map((idx) => sf.sectorWhitenProgress(idx))));
          const snapB = JSON.stringify(plan.rings.map((r) => r.sectorIndexes.map((idx) => sf.sectorWhitenProgress(idx))));
          if (snapA !== snapB) p.push('同输入同进度（重复读取应完全一致）');
          // ⑦ 计划跑完 ⇒ 全部为 1 且 `collapseDone`
          sf.step(plan.totalTicks - sf.collapseElapsed);
          for (const idx of all) {
            if (sf.sectorWhitenProgress(idx) !== 1) p.push(`演出结束应全部为 1（星区 ${idx}）`);
          }
          if (!sf.collapseDone) p.push('演出结束应收尾（collapseDone）');
          if (sf.whiteSectorIndexes.length !== all.length) p.push('结束时"已变白集合"应为全部星区');
        }
      }
    }
    add('⑲ 变白进度契约（t=0 全 0 / 环内线性 0→1 且同环并行 / 覆盖全部星区 / 环序单调首尾相接 / 同输入同进度 / 结束全 1）', p);
  }

  // ⑳ ★ 迭代 2：**星域视图不含任何提示文字键**（契约断言；用户口径＝星域地图内不显示任何浮动提示文字）
  //     · 逐层扫描 `stargateViewIn`（面板）与容器 `summary()`（星域侧）的结果，禁止出现"文案类字段名"
  //       （`msg`/`message`/`notice`/`toast`/`hint`/`tip`/`text`/…）——这类字段一旦存在，界面就可能把它显示出来；
  //     · 同时断言**面板视图没有星域编号**（`seed` 等；⑪ 的既有口径在此**加固**为全对象扫描）；
  //       ★ 星域侧 `summary()` **本来就该有编号**（编号只在星域侧显示）⇒ 那一侧只禁文案类键。
  {
    const p = [];
    const banned = new Set(['msg', 'message', 'notice', 'toast', 'hint', 'tip', 'text', 'label', 'phrase', 'warnText', 'moveMsg', 'floatMsg']);
    // ★ 编号类键：`seed`/`seedKey`/`seedText`（★ 注意 `reason.code` 是**合法字段**，不在禁列）
    const bannedSeed = new Set(['seed', 'seedKey', 'seedText']);
    const walk = (obj, path, depth, banSeedKeys) => {
      if (!obj || typeof obj !== 'object' || depth > 4) return;
      if (Array.isArray(obj)) {
        obj.forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1, banSeedKeys));
        return;
      }
      for (const [k, v] of Object.entries(obj)) {
        if (banned.has(k)) p.push(`视图不应含提示文字键：${path}.${k}`);
        if (banSeedKeys && bannedSeed.has(k)) p.push(`面板视图不应含编号键：${path}.${k}`);
        walk(v, `${path}.${k}`, depth + 1, banSeedKeys);
      }
    };
    const a = mkState(1);
    if (!a.ok) p.push('自检样本搭建失败');
    else {
      walk(stargateViewIn(a.state, { frontId: tier, current: null, specs: [] }), 'view', 0, true);
      const l = launchExpeditionIn(a.state, [{ id: a.id, n: 1 }], { starfieldId: tier, seed });
      if (!l.ok) p.push(`激活应成功（现 ${l.reason.code}）`);
      else {
        walk(stargateViewIn(a.state, { frontId: tier, current: l.starfield, specs: [{ id: a.id, n: 0 }] }), 'view', 0, true);
        // ★ 星域侧：容器 `summary()` 同样不得含文案类键（编号**允许**——它只在星域侧显示）
        walk(l.starfield.summary(), 'summary', 0, false);
      }
    }
    add('⑳ 星域视图契约：**不含任何提示文字键**（msg/notice/hint/text…）；面板视图亦不含编号键（编号只在星域侧显示）', p);
  }

  // ㉑ ★ 迭代 2：**变速器恢复**（暂停/倍速只作用于星域；三条出口统一复位为常态）
  //     · 断言 `ticker.restore()` 的**语义**（运行中 + x1、幂等、恢复后仍可再变速/暂停 ⇒ 不是"锁死"）；
  //     · 三条出口（侧栏「回基地」/演出完成回基地/放弃星域）在界面上都调它（UI 层，自检只保证**唯一入口的语义**）；
  //     · ★ 本项**零残留**：先把主循环的 `{running, speed}` 原样记下，跑完**精确还原**（不改变玩家当前状态）。
  {
    const p = [];
    const before = { running: ticker.running, speed: ticker.speed };
    try {
      ticker.setSpeed(4);
      ticker.pause();
      if (ticker.running) p.push('暂停后 running 应为 false（样本前置失败）');
      ticker.restore();
      if (!ticker.running) p.push('restore 后应恢复运行（running=true）');
      if (ticker.speed !== 1) p.push(`restore 后速度应为 x1（现 ${ticker.speed}）`);
      const c1 = JSON.stringify({ r: ticker.running, s: ticker.speed });
      ticker.restore(); // 幂等：再次调用不得改变任何状态、不得抛错
      if (JSON.stringify({ r: ticker.running, s: ticker.speed }) !== c1) p.push('restore 应幂等（重复调用不改变状态）');
      // 恢复常态后**仍可**在星域内变速/暂停（"只作用于星域"＝星域时可用，而不是被锁死）
      ticker.setSpeed(2);
      if (ticker.speed !== 2) p.push('restore 之后应仍可变速（星域内生效）');
      ticker.pause();
      if (ticker.running) p.push('restore 之后应仍可暂停（星域内生效）');
      ticker.restore();
      if (!ticker.running || ticker.speed !== 1) p.push('出口恢复后应为常态（运行中 + x1）');
    } finally {
      // ★ 精确还原调用前的状态（自检绝不改变玩家当前的变速器状态）
      if (before.speed !== ticker.speed) ticker.setSpeed(before.speed);
      if (before.running && !ticker.running) ticker.resume();
      if (!before.running && ticker.running) ticker.pause();
    }
    add('㉑ 变速器恢复：`ticker.restore()` ⇒ 运行中 + x1（幂等、仍可再变速/暂停）；星域三个出口统一调用它（唯一入口）', p);
  }

  // ㉒ ★ 迭代 2：**返回判据按「星门类型」**（不再按入场下标）——多星门星区时**任一**都可返回
  //     · 判据来源＝容器只读 `gateTypeId`（读配置 `sideRules.playerEntryTypeId`）与单位 `atGate`（按类型判定）；
  //     · 行为验证：把玩家单位搬到**另一个**星门星区（走引擎既有 `takeUnit`/`adoptUnit` 两步，
  //       与容器 `moveUnitTo` 内部同一路径；**自检专用**）⇒ 旧口径（`inEntry`）会误判 `notAtGate`，
  //       新口径仍应 ok，并且**真的能返回**（`settleExpeditionIn` 成功）；
  //     · 反例：单位在**非星门**类型星区 ⇒ `notAtGate`（零改动）。
  //     ★ 样本口径：h1 的 `stargate.count = {min:1,max:2}` ⇒ **同一档天然可能有 2 个星门星区**；
  //       由于星门数量由种子决定，这里在**固定种子列表**上顺序试，取第一个"≥2 个星门"的样本
  //       （**确定可复现**：列表固定、生成器无随机）。
  {
    const p = [];
    /** 试出一个"≥2 个星门星区"的样本（返回 `{ state, id, sf }`；全部试完仍无 ⇒ `{err}`）
     *  ★ 样本带 **2 艘**单位：1 艘用于"搬到另一个星门星区并真的返回"，另 1 艘用于"搬到非星门星区"的反例。 */
    const sampleWithTwoGates = () => {
      for (let i = 0; i < 8; i += 1) {
        const st = mkState(2);
        if (!st.ok) return { err: '自检样本搭建失败' };
        const l = activateExpeditionIn(st.state, [{ id: st.id, n: 2 }], { starfieldId: tier, seed: `${seed}-G${i}` });
        if (!l.ok) return { err: `激活应成功（现 ${l.reason.code}）` };
        if (l.starfield.sectors.filter((s) => s.isGate).length >= 2) return { state: st.state, id: st.id, sf: l.starfield };
      }
      return { err: '未试出含 2 个星门星区的样本（配置 count 上限 < 2？）' };
    };
    const s = sampleWithTwoGates();
    if (s.err) p.push(s.err);
    else {
      const sf = s.sf;
      const gates = sf.sectors.filter((x) => x.isGate);
      const gateTypeId = sf.gateTypeId;
      // ★ 判据来源＝**配置里的类型 id**（不是硬编码、不是下标）
      if (gateTypeId !== 'stargate') p.push(`星门类型 id 应读自配置（现 ${String(gateTypeId)}）`);
      // ★ 类型判据：`isGate` 与 `typeId === gateTypeId` **逐一对应**（与 index 无关）
      for (const x of sf.sectors) {
        if (x.isGate !== (x.typeId === gateTypeId)) p.push(`星区 ${x.index}: isGate 应与类型一致`);
      }
      // 把玩家单位搬到**另一个**星门星区
      const entryIdx = sf.playerEntryIndex;
      const other = gates.find((x) => x.index !== entryIdx);
      const src = sf.battleOf(entryIdx);
      const unit = (src.units ? src.units() : []).find((u) => u.baseRef);
      if (!unit) p.push('样本应有基地派出的单位（入场星门星区）');
      else if (!other) p.push('找不到"另一个"星门星区');
      else {
        const took = src.takeUnit(unit.id);
        if (!took.ok) p.push(`自检搬迁失败（takeUnit: ${took.reason}）`);
        else {
          const adopted = sf.battleOf(other.index).adoptUnit(took.unit, 'ally');
          if (!adopted.ok) p.push(`自检搬迁失败（adoptUnit: ${adopted.reason}）`);
        }
        const view = (sf.baseUnits || []).find((u) => u.unitId === unit.id);
        if (!view) p.push('搬迁后仍应能在只读视图里找到该单位');
        else {
          if (view.sectorIndex !== other.index) p.push(`搬迁后所在星区应为 ${other.index}（现 ${view.sectorIndex}）`);
          if (view.inEntry) p.push('搬迁后 inEntry 应为 false（旧口径的判据点）');
          if (!view.atGate) p.push('搬迁后 atGate 应为 true（按**类型**判定）');
          if (view.sectorTypeId !== gateTypeId) p.push('搬迁后 sectorTypeId 应为星门类型 id');
          const chk = returnCheck(sf, unit.id);
          if (!chk.ok) p.push(`在**另一个**星门星区应可返回（现 ${chk.reason.code}）`);
          else {
            const r = settleExpeditionIn(s.state, sf, { mode: 'unit', unitId: unit.id });
            if (!r.ok) p.push(`从另一个星门星区返回应成功（现 ${r.reason.code}）`);
            else if (r.returned !== 1) p.push(`应恰好 1 艘返回（现 ${r.returned}）`);
          }
        }
      }
      // 反例：把单位搬到**非星门类型**星区 ⇒ notAtGate
      const sf2 = s.sf;
      const nonGate = sf2.sectors.find((x) => !x.isGate);
      const src2 = sf2.battleOf(sf2.playerEntryIndex);
      const u2 = src2.units().find((u) => u.baseRef);
      if (!nonGate || !u2) p.push('反例样本不足（无 非星门星区 / 无派遣单位）');
      else {
        const took2 = src2.takeUnit(u2.id);
        if (!took2.ok) p.push(`自检搬迁失败（takeUnit: ${took2.reason}）`);
        else {
          const adopted2 = sf2.battleOf(nonGate.index).adoptUnit(took2.unit, 'ally');
          if (!adopted2.ok) p.push(`自检搬迁失败（adoptUnit: ${adopted2.reason}）`);
        }
        const chk2 = returnCheck(sf2, u2.id);
        if (chk2.ok) p.push('非星门类型星区应不可返回（现 ok）');
        else if (chk2.reason.code !== 'notAtGate') p.push(`非星门星区应返回 notAtGate（现 ${chk2.reason.code}）`);
        else if (chk2.reason.gateTypeId !== sf2.gateTypeId) p.push('notAtGate 应带上星门类型 id（便于界面解释）');
      }
    }
    add('㉒ 返回判据按**星门类型**（任一星门星区都可返回；非星门类型 ⇒ notAtGate）：多星门场景行为验证', p);
  }

  // ㉓ ★ 迭代 2：**费用按单位计**：派遣 n 艘 ⇒ 扣 `n × 单船费用`（★ 迭代 3：正常名额内）
  //    ＋ 激活 ⇒ 扣 `激活费` 并在有随行单位时**加上**同一费率函数算出的派遣费（合并成一个总价）
  {
    const p = [];
    const keys = Object.keys(cost).filter((k) => cost[k] > 0);
    if (!keys.length) p.push('该档 deployCost 为空（本项失去意义）');
    const a = mkState(0);
    if (!a.ok) p.push('自检样本搭建失败');
    else {
      const b = base.buildIn(a.state, a.id, 4);
      if (!b.ok) p.push('样本造船失败');
      // ① 激活（**零单位**）：扣**恰好**激活费
      const r0 = { ...a.state.resources };
      const act = activateExpeditionIn(a.state, [], { starfieldId: tier, seed });
      if (!act.ok) p.push(`零单位激活应成功（现 ${act.reason.code}）`);
      else {
        for (const k of keys) {
          const want = r0[k] - actCost[k];
          if (a.state.resources[k] !== want) p.push(`零单位激活应扣激活费：${k} 期望 ${want}（现 ${a.state.resources[k]}）`);
        }
        // ② 派遣 3 艘 ⇒ 扣 `3 × 单船费用`
        const r1 = { ...a.state.resources };
        const d = dispatchExpeditionIn(a.state, act.starfield, [{ id: a.id, n: 3 }]);
        if (!d.ok) p.push(`派遣应成功（现 ${d.reason.code}）`);
        else {
          for (const k of keys) {
            const want = r1[k] - cost[k] * 3;
            if (a.state.resources[k] !== want) p.push(`派遣 3 艘应扣 3× 单船费用：${k} 期望 ${want}（现 ${a.state.resources[k]}）`);
          }
          if (d.cost[keys[0]] !== cost[keys[0]] * 3) p.push('回执 cost 应为 3 × 单船费用');
        }
      }
      // ③ 资源不足（差 1）⇒ 派遣被拒且**两侧零改动**（星域侧不得留下多余单位）
      const c = mkState(1);
      if (!c.ok) p.push('自检样本搭建失败');
      else {
        const l2 = activateExpeditionIn(c.state, [], { starfieldId: tier, seed });
        if (!l2.ok) p.push(`零单位激活应成功（现 ${l2.reason.code}）`);
        else {
          const k0 = keys[0];
          c.state.resources[k0] = cost[k0] - 1; // 不够派 1 艘
          const fz = JSON.stringify(c.state);
          const n0 = l2.starfield.battleOf(l2.starfield.playerEntryIndex).units().length;
          const bad = dispatchExpeditionIn(c.state, l2.starfield, [{ id: c.id, n: 1 }]);
          if (bad.ok) p.push('资源不足应被拒（现 ok）');
          else if (bad.reason.code !== 'notAffordable') p.push(`资源不足应返回 notAffordable（现 ${bad.reason.code}）`);
          if (JSON.stringify(c.state) !== fz) p.push('资源不足 ⇒ 基地零改动');
          if (l2.starfield.battleOf(l2.starfield.playerEntryIndex).units().length !== n0) p.push('资源不足 ⇒ 星域零改动');
        }
      }
    }
    add('㉓ 费用**按单位计**：派遣 n 艘 ⇒ 扣 n × 单船费用；激活 ⇒ 扣**激活费（固定部分）＋随行单位派遣费（合并成一个总价）**（零单位 ⇒ 只剩激活费）；不足 ⇒ 两侧零改动', p);
  }

  // ㉔ ★ 迭代 2：**「激活星域」与「派遣」分离**：零单位激活可成功、**激活不占出战名额**、派遣仍受上限约束；
  //     且已激活时 `activate` 恒不可用（`fieldBusy`）、未激活时 `dispatch` 恒不可用。
  {
    const p = [];
    // ① 在**名额已满**（`out ＝ limit`、且资源充足）的基地上**零单位激活** ⇒ 必须成功 ⇒ **激活不占名额**
    const a = mkState(0);
    if (!a.ok) p.push('自检样本搭建失败');
    else {
      const cap = base.deploySquadTotalsIn(a.state, []).limit;
      const b = base.buildIn(a.state, a.id, cap + 1);
      if (!b.ok) p.push('样本造船失败');
      // 直接把 `out` 顶到上限（绕过出兵：只用装配登记，费用传空对象 ⇒ 不消耗资源）
      const reg = base.deploySquadIn(a.state, [{ id: a.id, n: cap }], {});
      if (!reg.ok) p.push(`预置"名额已满"应成功（现 ${reg.reason.code}）`);
      else {
        const outFull = a.state.fleetConfigs.find((c) => c.id === a.id).out;
        if (outFull !== cap) p.push(`预置后 out 应为 ${cap}（现 ${outFull}）`);
        const act = activateExpeditionIn(a.state, [], { starfieldId: tier, seed });
        if (!act.ok) p.push(`名额已满时零单位激活**仍应成功**（现 ${act.reason.code}）`);
        else {
          if (act.total !== 0 || (act.items || []).length !== 0) p.push('零单位激活不应有任何装配条目');
          const outAfter = a.state.fleetConfigs.find((c) => c.id === a.id).out;
          if (outAfter !== outFull) p.push(`零单位激活不得改变 out（${outFull} → ${outAfter}）`);
          if (aliveDeployedOf(act.starfield) !== 0) p.push('零单位激活 ⇒ 星域里应没有派遣单位');
          if (!fieldLive(act.starfield)) p.push('零单位激活 ⇒ 星域应处于"进行中"（可随后派遣）');
          // 已激活（同档）⇒ ★ 迭代 4：**同一个主按钮**的 `mode` 切到 `dispatch`
          const viewLive = stargateViewIn(a.state, { frontId: tier, current: act.starfield, specs: [] });
          if (viewLive.mode !== 'dispatch') p.push(`已激活 ⇒ mode 应为 dispatch（现 ${viewLive.mode}）`);
          if (viewLive.primary.mode !== 'dispatch') p.push(`已激活 ⇒ 主按钮应为「派遣」（现 ${viewLive.primary.mode}）`);
          if (viewLive.primary.labelKey !== 'base.stargate.dispatchGo') p.push('已激活 ⇒ 主按钮文本键应为 dispatchGo');
          // 装配为空 ⇒ 派遣本身无意义（`emptyDeploy`）—— 但**原因必须由引擎给出**（界面只读）
          if (viewLive.primary.ok) p.push('已激活且未选单位 ⇒ 主按钮不应可点（现 ok）');
          else if (viewLive.primary.reason.code !== 'emptyDeploy') p.push(`未选单位时应为 emptyDeploy（现 ${viewLive.primary.reason.code}）`);
          // ② **派遣不再因上限被拦**：账目 `out` 已满（＝limit）但**星域里一个单位都没有**（存活 0）
          //    ⇒ 按"费率分界"口径 r ＝ maxFleet − 存活 ＝ limit ⇒ 派 1 艘**落在正常段** ⇒ **成功**
          const fz = JSON.stringify(a.state);
          const push1 = dispatchExpeditionIn(a.state, act.starfield, [{ id: a.id, n: 1 }]);
          if (!push1.ok) p.push(`账目已满但星域为空时派遣应成功（上限不拦截）（现 ${push1.reason.code}）`);
          else {
            if (aliveDeployedOf(act.starfield) !== 1) p.push('派遣后星域里应恰有 1 艘存活单位');
            if (push1.price && push1.price.over !== 0) p.push('存活为 0 ⇒ 本次派遣应落在正常段（over ＝ 0）');
          }
          if (JSON.stringify(a.state) === fz) p.push('派遣成功应真的写入基地账目（本项旧口径"必被拒"已废）');
        }
      }
    }
    // ③ 未激活时：★ 迭代 4 主按钮＝「激活星域」（零单位也可点）；激活后同一按钮切到「派遣」
    const e = mkState(0);
    if (!e.ok) p.push('自检样本搭建失败');
    else {
      const cap = base.deploySquadTotalsIn(e.state, []).limit;
      const eb = base.buildIn(e.state, e.id, cap);
      if (!eb.ok) p.push('样本造船失败');
      const viewIdle = stargateViewIn(e.state, { frontId: tier, current: null, specs: [] });
      if (viewIdle.mode !== 'activate') p.push(`未激活 ⇒ mode 应为 activate（现 ${viewIdle.mode}）`);
      if (viewIdle.primary.mode !== 'activate') p.push(`未激活 ⇒ 主按钮应为「激活星域」（现 ${viewIdle.primary.mode}）`);
      if (viewIdle.primary.labelKey !== 'base.stargate.activateGo') p.push('未激活 ⇒ 主按钮文本键应为 activateGo');
      if (viewIdle.primary.ok !== true) p.push('未激活且资源充足 ⇒ 主按钮应可用（零单位也算）');
      const eAct = activateExpeditionIn(e.state, [], { starfieldId: tier, seed });
      if (!eAct.ok) p.push(`零单位激活应成功（现 ${eAct.reason.code}）`);
      else {
        // 同一按钮、同一状态 ⇒ 文本切到「派遣」，且**选中单位后即可点**（费用＝本次派遣总价）
        const vAfter = stargateViewIn(e.state, { frontId: tier, current: eAct.starfield, specs: [{ id: e.id, n: cap }] });
        if (vAfter.primary.mode !== 'dispatch' || vAfter.primary.labelKey !== 'base.stargate.dispatchGo') {
          p.push('激活成功后 ⇒ 主按钮应变为「派遣」');
        }
        if (!vAfter.primary.ok) p.push(`激活后选中单位 ⇒ 主按钮应可点（现 ${vAfter.primary.reason && vAfter.primary.reason.code}）`);
        const eD = dispatchExpeditionIn(e.state, eAct.starfield, [{ id: e.id, n: cap }]);
        if (!eD.ok) p.push(`随后派遣应可把名额用满（现 ${eD.reason.code}）`);
        else if (aliveDeployedOf(eAct.starfield) !== cap) p.push(`派遣后同时存活应为 ${cap}（现 ${aliveDeployedOf(eAct.starfield)}）`);
      }
    }
    // ④ ★ 迭代 4 界面契约：**唯一主按钮**（`primary`）口径正确 + `mode` 随激活状态切换 + 已开星域 ⇒ 档位锁定
    {
      const idleState = mkState(0);
      if (!idleState.ok) p.push('自检样本搭建失败');
      else {
        const cap2 = base.deploySquadTotalsIn(idleState.state, []).limit;
        if (!base.buildIn(idleState.state, idleState.id, cap2).ok) p.push('样本造船失败');
        const vIdle = stargateViewIn(idleState.state, { frontId: tier, current: null, specs: [] });
        if (vIdle.primary.mode !== 'activate' || vIdle.primary.ok !== true) p.push('未激活 ⇒ 主按钮应是可点的「激活星域」');
        if (vIdle.primary.reason !== null) p.push('可用时 primary.reason 应为 null');
        const act4 = activateExpeditionIn(idleState.state, [], { starfieldId: tier, seed });
        if (!act4.ok) p.push(`零单位激活应成功（现 ${act4.reason.code}）`);
        else {
          const vLive2 = stargateViewIn(idleState.state, { frontId: tier, current: act4.starfield, specs: [] });
          if (vLive2.primary.mode !== 'dispatch') p.push('已激活 ⇒ 主按钮应切换为「派遣」');
          if (vLive2.primary.ok) p.push('已激活但未选单位 ⇒ 主按钮应不可点（emptyDeploy）');
          else if (vLive2.primary.reason.code !== 'emptyDeploy') p.push(`未选单位时应为 emptyDeploy（现 ${vLive2.primary.reason.code}）`);
          // ★ 同一时刻只有一个动作可做：已开着星域时**档位被锁定为进行中的那一档**
          //   （界面即使停在别档也会被引擎校正 ⇒ 不可能"另开新档"；另开别档的硬拒在引擎/动作层，见 ⑫）
          const otherTier = STARFIELD_IDS.find((id) => id !== tier);
          if (otherTier) {
            const vOther = stargateViewIn(idleState.state, { frontId: otherTier, current: act4.starfield, specs: [] });
            if (!vOther.tier || vOther.tier.id !== act4.starfield.configId) {
              p.push(`已开星域 ⇒ 档位应锁定为进行中的那一档（现 ${vOther.tier && vOther.tier.id}）`);
            }
            if (vOther.primary.mode !== 'dispatch') p.push('已开星域 ⇒ 主按钮应恒为「派遣」态（档位锁定）');
          }
        }
      }
    }
    add('㉔ 激活 / 派遣分离：零单位激活在**账目名额已满**时仍可成功（不占名额、不改 out）、派遣**不再被上限拦**、★ 迭代 4 **唯一主按钮**（`primary.mode` 随激活状态在「激活星域」⇄「派遣」间切换、已开星域 ⇒ 档位被锁定为进行中的那一档、灰时必带原因供 `title`）', p);
  }

  /* ㉕ ★★ M3d 迭代 3：**出战上限＝费率分界**（不再拦截派遣）—— 计费口径的端到端锚点：
   *   · 剩余正常名额 `r ＝ maxFleet − Σ 同时存活`；正常部分每艘 1× 单船费用；
   *   · 超出部分 `m` 艘 ⇒ **一整块**加价 `单船费 × (m + offset) ^ exponent`（配置 `overQuota`，
   *     内置三档 ＝ `(m + 1) ^ 1.5`），逐资源键**向上取整**；
   *   · 断言：纯函数边界（r / r+1 / r+m / r ≤ 0）＋ 端到端"恰好到上限＝正常价""超 1 艘＝精确 2^1.5"
   *     "超 2 艘＝精确 3^1.5"＋**大批量超上限只要付得起就必须成功**＋资源不足仍拒且两侧零改动。 */
  {
    const p = [];
    const keys = Object.keys(cost).filter((k) => cost[k] > 0);
    if (!keys.length) p.push('该档 deployCost 为空（本项失去意义）');
    const rate = overQuotaRateOf(tier);
    if (!(rate.exponent > 0) || !(rate.offset >= 1)) p.push(`费率应取自配置（现 ${JSON.stringify(rate)}）`);
    // ① 纯函数：恰好 r ⇒ 全正常段；r+1 ⇒ over 1（第一艘就加价）；r+m ⇒ over m；(m+1)^1.5 精确
    const q0 = dispatchPriceOf(tier, 3, 3);
    const q1 = dispatchPriceOf(tier, 4, 3);
    const q2 = dispatchPriceOf(tier, 5, 3);
    const qn = dispatchPriceOf(tier, 2, 0); // r ＝ 0 ⇒ 全部按超出计（m ＝ 2）
    if (q0.over !== 0 || q0.normal !== 3) p.push(`恰好 r 艘应全在正常段（normal ${q0.normal} / over ${q0.over}）`);
    if (q1.over !== 1 || q1.normal !== 3) p.push(`超 1 艘应 over ＝ 1（现 ${q1.over}）`);
    if (q2.over !== 2 || q2.normal !== 3) p.push(`超 2 艘应 over ＝ 2（现 ${q2.over}）`);
    if (qn.normal !== 0 || qn.over !== 2) p.push(`r ≤ 0 ⇒ 应全部按超出计（normal ${qn.normal} / over ${qn.over}）`);
    for (const k of keys) {
      const per = cost[k];
      if (q0.cost[k] !== per * 3) p.push(`恰好 r 艘的正常段应为 3 艘价：${k} 期望 ${per * 3}（现 ${q0.cost[k]}）`);
      if (q1.cost[k] !== per * 3 + Math.ceil(per * Math.pow(1 + rate.offset, rate.exponent))) {
        p.push(`超 1 艘应 ＝ 正常段 ＋ ceil(单船费 × (1+offset)^exponent)：${k} 期望 ${per * 3 + Math.ceil(per * Math.pow(1 + rate.offset, rate.exponent))}（现 ${q1.cost[k]}）`);
      }
      if (q2.cost[k] !== per * 3 + Math.ceil(per * Math.pow(2 + rate.offset, rate.exponent))) {
        p.push(`超 2 艘应 ＝ 正常段 ＋ ceil(单船费 × (2+offset)^exponent)：${k} 期望 ${per * 3 + Math.ceil(per * Math.pow(2 + rate.offset, rate.exponent))}（现 ${q2.cost[k]}）`);
      }
      if (qn.cost[k] !== Math.ceil(per * Math.pow(2 + rate.offset, rate.exponent))) {
        p.push(`r ＝ 0 时 2 艘应全部按超出段计：${k} 期望 ${Math.ceil(per * Math.pow(2 + rate.offset, rate.exponent))}（现 ${qn.cost[k]}）`);
      }
      if (!(q2.cost[k] > q1.cost[k] && q1.cost[k] > q0.cost[k])) p.push(`超出越多总价必须越贵（${k}：${q0.cost[k]}/${q1.cost[k]}/${q2.cost[k]}）`);
    }
    // ② 端到端：恰好到上限 ⇒ 正常价；超 1 艘 ⇒ 精确 2^1.5；超 2 艘 ⇒ 精确 3^1.5（逐资源键核对真实扣费）
    const a = mkState(0);
    if (!a.ok) p.push('自检样本搭建失败');
    else {
      const cap = base.deploySquadTotalsIn(a.state, []).limit;
      const b = base.buildIn(a.state, a.id, cap + 3); // 够 (1) cap 艘 ＋ (2) 1 艘 ＋ (3) 2 艘
      if (!b.ok) p.push('样本造船失败');
      const act = activateExpeditionIn(a.state, [], { starfieldId: tier, seed });
      if (!act.ok) p.push(`零单位激活应成功（现 ${act.reason.code}）`);
      else {
        const sf = act.starfield;
        // (1) 恰好到上限：正常价
        const r1 = { ...a.state.resources };
        const d1 = dispatchExpeditionIn(a.state, sf, [{ id: a.id, n: cap }]);
        if (!d1.ok) p.push(`恰好派到上限应成功（现 ${d1.reason.code}）`);
        else {
          for (const k of keys) {
            const want = r1[k] - cost[k] * cap;
            if (a.state.resources[k] !== want) p.push(`恰好到上限应扣正常价：${k} 期望 ${want}（现 ${a.state.resources[k]}）`);
          }
          if (d1.price && (d1.price.over !== 0 || d1.price.normal !== cap)) p.push('恰好到上限的 price 应为"全正常段"');
        }
        // (2) 超 1 艘：正常段 0 艘 ⇒ 全部超出（m ＝ 1）⇒ ceil(单船费 × 2^1.5)
        const r2b = { ...a.state.resources };
        const d2 = dispatchExpeditionIn(a.state, sf, [{ id: a.id, n: 1 }]);
        if (!d2.ok) p.push(`超 1 艘**不应再被拒**（现 ${d2.reason.code}）`);
        else {
          if (d2.price && (d2.price.over !== 1 || d2.price.normal !== 0)) p.push(`超 1 艘应为 over 1 / normal 0（现 ${d2.price.over}/${d2.price.normal}）`);
          for (const k of keys) {
            const want = r2b[k] - Math.ceil(cost[k] * Math.pow(2, rate.exponent));
            if (a.state.resources[k] !== want) p.push(`超 1 艘的加价应为 ceil(单船费 × 2^${rate.exponent})：${k} 期望 ${want}（现 ${a.state.resources[k]}）`);
          }
          if (aliveDeployedOf(sf) !== cap + 1) p.push(`超上限派遣后同时存活应为 ${cap + 1}（现 ${aliveDeployedOf(sf)}）`);
        }
        // (3) 再**一次派 2 艘**（此时 r ＝ −1 ⇒ 全部超出 ⇒ m ＝ 2）⇒ ceil(单船费 × 3^1.5)
        const r3 = { ...a.state.resources };
        const d3 = dispatchExpeditionIn(a.state, sf, [{ id: a.id, n: 2 }]);
        if (!d3.ok) p.push(`超 2 艘**不应再被拒**（现 ${d3.reason.code}）`);
        else {
          if (d3.price && (d3.price.over !== 2 || d3.price.normal !== 0)) p.push(`本次（r ≤ 0）应 normal 0 / over 2（现 ${d3.price.normal}/${d3.price.over}）`);
          for (const k of keys) {
            const want = r3[k] - Math.ceil(cost[k] * Math.pow(2 + rate.offset, rate.exponent));
            if (a.state.resources[k] !== want) p.push(`超 2 艘的加价应为 ceil(单船费 × 3^${rate.exponent})：${k} 期望 ${want}（现 ${a.state.resources[k]}）`);
          }
          if (aliveDeployedOf(sf) !== cap + 3) p.push(`再派 2 艘后同时存活应为 ${cap + 3}（现 ${aliveDeployedOf(sf)}）`);
        }
        // (4) **大批量也不拦截**：另起一份样本，一次派 cap+2 艘（远超上限）⇒ 付得起就必须成功
        const g = mkState(0);
        if (!g.ok) p.push('自检样本搭建失败');
        else {
          const gb = base.buildIn(g.state, g.id, cap + 2);
          if (!gb.ok) p.push('样本造船失败');
          const gAct = activateExpeditionIn(g.state, [], { starfieldId: tier, seed });
          if (!gAct.ok) p.push(`零单位激活应成功（现 ${gAct.reason.code}）`);
          else {
            const g0 = { ...g.state.resources };
            const big = dispatchExpeditionIn(g.state, gAct.starfield, [{ id: g.id, n: cap + 2 }]);
            if (!big.ok) p.push(`付得起的大批量派遣必须成功（上限不拦截）（现 ${big.reason.code}）`);
            else {
              if (aliveDeployedOf(gAct.starfield) !== cap + 2) p.push(`大批量派遣后同时存活应为 ${cap + 2}（现 ${aliveDeployedOf(gAct.starfield)}）`);
              for (const k of keys) {
                const want = g0[k] - (cost[k] * cap + Math.ceil(cost[k] * Math.pow(2 + rate.offset, rate.exponent)));
                if (g.state.resources[k] !== want) p.push(`大批量费用应为"正常 cap 艘 ＋ 超出 2 艘加价"：${k} 期望 ${want}（现 ${g.state.resources[k]}）`);
              }
              if (big.cost[keys[0]] !== g0[keys[0]] - g.state.resources[keys[0]]) p.push('回执 cost 应与实际扣费一致');
            }
          }
        }
        // (5) 资源不足 ⇒ 仍拒 `notAffordable` 且**两侧零改动**（上限不再是原因，钱才是）
        const h = mkState(0);
        if (!h.ok) p.push('自检样本搭建失败');
        else {
          const hb = base.buildIn(h.state, h.id, cap + 2);
          if (!hb.ok) p.push('样本造船失败');
          const hAct = activateExpeditionIn(h.state, [], { starfieldId: tier, seed });
          if (!hAct.ok) p.push(`零单位激活应成功（现 ${hAct.reason.code}）`);
          else {
            const hk = keys[0];
            h.state.resources[hk] = Math.ceil(cost[hk] * Math.pow(3, rate.exponent)) - 1; // 连"超 2 艘"的加价都付不起
            const fzH = JSON.stringify(h.state);
            const n0 = hAct.starfield.battleOf(hAct.starfield.playerEntryIndex).units().length;
            const bad = dispatchExpeditionIn(h.state, hAct.starfield, [{ id: h.id, n: cap + 2 }]);
            if (bad.ok) p.push('资源不足应被拒（现 ok）');
            else if (bad.reason.code !== 'notAffordable') p.push(`资源不足应返回 notAffordable（现 ${bad.reason.code}）`);
            if (JSON.stringify(h.state) !== fzH) p.push('资源不足 ⇒ 基地零改动');
            if (hAct.starfield.battleOf(hAct.starfield.playerEntryIndex).units().length !== n0) p.push('资源不足 ⇒ 星域零改动');
          }
        }
      }
    }
    add('㉕ 出战上限＝**费率分界**（不拦截）：恰好 r 艘＝正常价、超 1 艘＝ceil(单船费 × 2^1.5)、超 m 艘＝ceil(单船费 × (m+1)^1.5)、r ≤ 0 全按超出计、大批量付得起即成功、资源不足仍拒且两侧零改动', p);
  }

  return { pass: checks.every((c) => c.pass), checks };
}

/** ★ **自检的别名导出**（控制台 `LS.expedition.selfCheck()` 用；与 `base` / `starfield` 的命名体例一致） */
export const selfCheck = expeditionSelfCheck;
