/* ===== data/cargo.js —— 货物【聚合入口】（向后兼容转发层 + 缺省值/上限常量） =====
 * ★ 本文件对应的货物定义已拆分：**一类货物一个文件**，统一放在 `data/cargos/` 目录下：
 *     data/cargos/none.js              无（默认类型/兜底 · 灰）
 *     data/cargos/weaponPart.js        武器零件（攻击类色）
 *     data/cargos/fieldComponent.js    力场组件（护盾类色）
 *     data/cargos/functionDevice.js    功能设备（功能类色）
 *     data/cargos/droneDebris.js       机骸碎片（无人机类色 · 棕）
 *     data/cargos/miningRig.js         采矿器械（采矿类色 · 紫）
 *     data/cargos/freightBlueprint.js  货运蓝图（运输类色 · 亮黄）
 *   注册表 + 等级解析唯一口径在 `data/cargos/index.js`（`CARGOS` / `CARGO_IDS` / `getCargo` /
 *   `cargoMaxLevel` / `cargoLevels` / `resolveCargoAtLevel`）。
 *
 * ★ 本文件（体例同 `data/ships.js`）**只做转发 + 缺省值/上限常量**，不留第二套货物定义：
 *   · 转发：注册表与等级解析（具名 + 默认导出均指向 `data/cargos/index.js`）；
 *   · 自带：`CARGO_DEFAULTS`（类型定义缺值时的兜底）、`CARGO_LIMITS`（**唯一上限来源**）、
 *     `CARGO_ID_PREFIX` / `cargoInstanceId`（实例 id 口径）。
 *
 * ★ 货物＝**星区侧实体**（拥有 `id`），装载体系实装后与战斗数值链的接口**只有一条**：
 *   装载模块（`type` 标签 `cargo_loader`）按**结算阶段统一落地**的顺序把货物从星区搬进单位货舱；
 *   星区货物本身**仍不参与 Pass1 的任何数值修改**（装载意图只写 `__pending.cargoLoadOps`，
 *   进度/锁定/入库全部在结算阶段落地 ⇒ 铁律不变）。
 * ★ 字段（**定义与实例共用同一套字段名**，实例字段可逐条覆写定义值）：
 *   · `nameKey`   **名称的 i18n 键**（实例未覆写名称时显示它）；
 *   · `name`      **名称**：用户自定义字符串（**原样显示、不做 i18n**；空串 ⇒ 回退 `nameKey` 词条）；
 *   · `type`      **类型 id**（＝货物定义自身的 id，如 `weaponPart`；**由所选模板决定、不可编辑**）；
 *   · `colorKey`  **类型色来源**＝**CSS 变量名**（如 `--cat-attack`；**定义文件内不硬编码色值**，
 *                 色值一律登记在 `css/base.css :root` 的 `--cat-*`）；
 *   · `tons`      **吨位**＝占据货仓值（**非负整数**；统一占位值 **5t**）；
 *   · `loadTicks` **装载需要时间**（**tick**；统一占位值 **300t**＝15s，50ms/tick ⇒ 秒换算见
 *                 `core/tick.js ticksToSeconds`；★ 装载实装后：**该值按等级解析一次后即成为该件货物
 *                 的固有装载时间**，装载完成时会被**永久改写为 `CARGO_FAST_LOAD_TICKS`**（见下）；
 *   · `level` / `maxLevel` / `levels[]` **等级表**（与模块/船型**同一等级模型**：顶层＝Lv1 基准、
 *     逐级绝对值、未填回退上一级，唯一解析函数 `resolveCargoAtLevel`，**实例创建时解析一次**）；
 *   · `bonus`     **加成系数**（倍率语义、中性值 1；★ 本轮**仅数据承载**，作用待装载/运载实装再定）。
 *
 * ★ 唯一规范化（钳制）口径在战斗层：`systems/battle.js normalizeSector()` / `normalizeSectorCargos()`
 *   —— 名称去空白并截断、吨位钳到 `[0, CARGO_LIMITS.maxTons]`、等级钳到 `[1, cargoMaxLevel]`；
 *   **非法项丢弃并记 `warnings`**（体例同 `normalizeFormation`）。
 */
export {
  CARGOS,
  CARGO_IDS,
  getCargo,
  cargoMaxLevel,
  cargoLevels,
  resolveCargoAtLevel,
} from './cargos/index.js';
export { default } from './cargos/index.js';

/** 缺省值（货物定义缺某项时的兜底；**数值统一占位**：吨位 5t、装载时间 300t） */
export const CARGO_DEFAULTS = {
  templateId: 'none', // 缺省类型＝`none`（默认/兜底类型）
  name: '',           // 缺省名称＝空串 ⇒ 显示回退到 `nameKey` 词条（即类型名）
  tons: 5,            // ★ 统一占位：1 个货物占 5t
  loadTicks: 300,     // ★ 统一占位：300t = 15s（随等级解析，界面上不可编辑）
  level: 1,           // 缺省等级
  bonus: 1,           // 加成系数中性值＝1（倍率语义）
};

/** ★ 各项钳制上限（**唯一来源**：引擎 `normalizeSectorCargos` 与编队界面校验都读这里，不各自硬编码）
 *  · 等级上限不在此处：由**各货物定义自身的 `maxLevel`** 决定（`cargoMaxLevel(def)`，唯一口径）；
 *  · `loadTicks`/`bonus` 不可由入参覆写（随等级解析而来），故此处不设上限。 */
export const CARGO_LIMITS = {
  nameLen: 40,           // 名称最大字符数（与星区名称同口径）
  maxTons: 9999,         // 吨位上限（非负整数）
  maxCountPerEntry: 20,  // 单条设定的「数量」上限（编队界面一次批量添加的条数）
  maxTotal: 40,          // 星区货物**实例总数**上限（超出部分截断并记 warning）
};

/** ★ 货物实例 id 前缀：实例 id ＝ `cargo-<序号>`（序号＝**规范化后的顺序号**，从 1 开始）
 *  ——**确定性、可复现**（同一份星区设定恒得同一组 id，不使用随机数/时间戳），
 *  且**与列表顺序一一对应**（UI 预检与引擎开战各自规范化同一份输入 ⇒ id 一致）。 */
export const CARGO_ID_PREFIX = 'cargo-';

/** ★ 按序号生成货物实例 id（1 起） */
export function cargoInstanceId(index1) {
  return `${CARGO_ID_PREFIX}${Math.max(1, index1 | 0)}`;
}

/** ★ **装载完成后的固有装载时间**（tick）——用户口径：一件货物**被成功装载过一次**之后，
 *  它的 `loadTicks` 被**永久改写**为本值（同一件货物此后**即使返还星区**也保持本值，
 *  再次装载只需 `round(本值 ÷ 装载速度)` tick）。
 *  · 数值唯一来源＝本常量（引擎 `systems/battle.js` 装载结算步骤 5 写入，**不散落硬编码**）；
 *  · 20t ＝ 1s（`core/tick.js`：20 tick/秒）——`formatTickSeconds(CARGO_FAST_LOAD_TICKS)` ⇒ `'1'`。 */
export const CARGO_FAST_LOAD_TICKS = 20;
