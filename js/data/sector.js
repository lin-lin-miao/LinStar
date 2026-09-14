/* ===== data/sector.js —— 星区（战斗场景）数据与缺省值 =====
 * 星区数据（`SectorCfg`）＝ `{ name, oreReserve, cargos }`：
 *   · `name`      星区名称：**用户自定义字符串**，UI/战报**原样显示、不做 i18n 翻译**（故不进 i18n 词条表）。
 *   · `oreReserve` 矿物储量：**非负整数**（开采从中扣减、单位阵亡返还）。
 *   · `cargos`    星区**货物实体**列表：数组，每项＝一个货物实例
 *                 `{ id, templateId, nameKey, name, type, colorKey, tons, loadTicks, level, bonus }`
 *                 （`type`＝类型 id、`colorKey`＝类型色所在的 **CSS 变量名**）。
 *                 ★ 货物是**星区侧状态**（**装载体系已实装**：装载器模块按标签 `cargo_loader` 把它装进
 *                 单位货舱；锁定 / 进度 / 入舱 / 返还全部在**结算阶段**统一落地）——货物本身**不写
 *                 任何数值类意图**，Pass1 仍零数值变化；货物**类型定义**在 `data/cargos/*.js`
 *                 注册表与等级解析在 `data/cargos/index.js`、缺省值与钳制上限在 `data/cargo.js`
 *                 （本文件只放星区侧的缺省值）。
 *                 ★ **优先队列**（`sector.cargoQueue`，有序 id 列表）同样只是星区侧状态，
 *                 由引擎唯一接口切换（`battle.toggleCargoQueue`），UI 只读、不自算。
 *
 * ★ 唯一规范化（钳制）口径在战斗层：`systems/battle.js normalizeSector()` ——
 *   名称去首尾空白并截断超长、储量钳制为非负整数、货物逐项校验/覆写/钳制并**按顺序编号**；
 *   **数值只在本文件与 `data/cargo.js` / `data/cargos/*.js` 登记**，引擎不硬编码。
 * ★ 缺省值：编队未提供星区时按本表兜底。
 *   · 缺省名称＝空串 ⇒ 战斗屏标题/结算不显示名称前缀（“无名称”即无前缀，无需额外开关）；
 *   · 缺省储量＝**占位预填**（待用户调校）⇒ 星区资源栏在“有星区数据”时显示（见 UI 的为空则隐藏规则）；
 *   · 缺省货物＝**空数组** ⇒ 星区货物栏整区块隐藏（沿用“为空则隐藏”的唯一规则）。
 */
export const SECTOR_DEFAULTS = {
  name: '',          // 缺省名称：空串（不显示名称前缀）
  oreReserve: 5000,  // 缺省矿物储量【占位预填】：待用户调校
  cargos: [],        // 缺省货物：无（空数组 ⇒ 星区货物栏隐藏）
};

/* ---------- ★ 星区侧冷却词条（**唯一识别口径**：引擎门控与 UI 冷却行枚举共用同一函数）----------
 * 词条名 **`sector_cd_ticks`** ＝「该模块的**星区侧**冷却时长（整数 tick）」：
 *   · **词条存在即代表该模块参与星区冷却**（是否参与**按词条识别**、与 `SECTOR_WORDS`/`COEFF_ADD`
 *     同体例；**不硬编码任何模块 id**）—— 以后任何模块只要带上它，就受星区侧冷却约束；
 *   · 该值＝**星区侧**冷却时长（按模块 id 各自独立计时）；模块**实例自身**冷却仍由 `cooldown_ticks`
 *     决定 —— 两把冷却相互独立、仍需**同时就绪**才可激活；
 *   · 写 `0` 也**算参与**（＝星区侧不跨 tick 限制，仅保留“同一 tick 只接受第一个”的裁决）；
 *   · 本值是**基础量**，实际时长走引擎唯一口径 `timeScaled(基础量, 拥有者当 tick 时间系数)` 整数化
 *     （与 `cooldown_ticks` 完全同算法 ⇒ 同一单位两把冷却同 tick 到期）。
 * ★ 作用对象＝**星区**（战场全局，既非自身也非目标词条）⇒ 无 `_target` 后缀、不作用于模块拥有者。 */
export const SECTOR_CD_WORD = 'sector_cd_ticks';

/** 该模块 `effects` 的星区侧冷却时长：**词条缺失 → `null`（＝不参与星区冷却）**；
 *  存在 → 非负数值（非法/负值一律归 0，仍算参与）。**判定“是否参与”请用 `hasSectorCdFx()`。** */
export function sectorCdTicksFx(fx) {
  if (!fx || fx[SECTOR_CD_WORD] == null) return null;
  const v = Number(fx[SECTOR_CD_WORD]);
  return Number.isFinite(v) ? Math.max(0, v) : 0;
}

/** 该模块是否**参与星区冷却**（唯一识别口径：引擎 `canImpact` 门控 / `settleSectorOps` 落地
 *  与 UI 冷却行枚举都走它 ⇒ 不存在第二套判据）。 */
export function hasSectorCdFx(fx) {
  return sectorCdTicksFx(fx) != null;
}

export default SECTOR_DEFAULTS;
