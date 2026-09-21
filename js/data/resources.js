/* ===== data/resources.js —— 资源注册表（M3 五资源 · **唯一来源**） =====
 * 定位（主基地框架说明 §2 / §10）：基地资源账户的**种类与展示顺序**只在本文件定义一次；
 *   `systems/base.js`（账户与校验）与 `ui/baseView.js`（顶部资源栏）都**只读本注册表**，
 *   不各自维护资源清单、不硬编码资源键。
 * 字段体例（与 `data/sectorTypes/*.js` 同一"注册表条目"体例）：
 *   · `key`     **资源键**（＝注册表键名；账户、配置文件里的 cost/gain 都用它）；
 *   · `nameKey` 名称词条 key（体例 `res.<key>`；zh-CN / en **成对**，由基地自检核对）；
 *   · `descKey` 用途说明词条 key（体例 `res.<key>.desc`；星球面板的"资源种类与用途"用）；
 *   · `order`   展示顺序（整数、注册表内**唯一**；顶部资源栏与用途列表都按它排）；
 *   · `marker`  文字图标（**不新增图片素材**：仅用字符，体例同 `sectorTypes` 的 `marker`）；
 *   · `colorKey` **CSS 变量名**（`css/base.css :root` 里**既有**的语义色，不新增色值）；
 *                语义映射（★ M3b 迭代 2 按用户口径调整：**矿物＝紫 / 稀土＝绿 / 合金＝银**）：
 *                能量币→`--energy`、**矿物→`--ore`（紫）**、**合金→`--alloy`（银）**、
 *                **稀土→`--rare`（绿）**、科研点→`--accent`。
 *                ★ 合金 / 稀土**不再借用**其它语义的变量（旧值 `--cargo` / `--cat-mining`）：
 *                  `--cargo` 是**货物（橙）**的容量条色、`--cat-mining` 是**采矿类模块（紫）**的分类色，
 *                  借用的结果会让"货物变银 / 采矿模块变绿" ⇒ 与用户口径冲突。
 *                  故本轮在 `:root` 的"资源语义色"组里**补齐两个专用变量** `--rare` / `--alloy`
 *                  （与 `--energy` / `--ore` / `--cargo` 同一体例：**改色只改 `css/base.css` 一处**）。
 *
 * ★ 本文件**不写任何数值额度**（初始额度只在 `data/baseConfig.js`，见 §10「唯一保留在基地配置的数值」）。
 * ★ 五种资源（占位定位，待用户调校）：
 *   · `energy` 能量币 —— **一切活动的基础消耗**（建造 / 改装 / 升级 / 研究 / 出征均消耗）；
 *   · `ore`    矿物   —— 原料（建造高阶船只与部件的副消耗；由星域采矿入库带回）；
 *   · `alloy`  合金   —— 建造材料（船体与建造的主材料）；
 *   · `rare`   稀土   —— 稀有建造材料（高等级建造与升级消耗，占位：等级 ≥3 起）；
 *   · `science` 科研点 —— 解锁科技（研究站加速或替代部分研究消耗；M3 无产出）。
 */

/** 能量币（一切活动的基础消耗） */
const energy = {
  key: 'energy',
  nameKey: 'res.energy',
  descKey: 'res.energy.desc',
  order: 1,
  marker: '⚡',
  colorKey: '--energy',
};

/** 矿物（原料；星域采矿入库带回）—— ★ 资源语义色＝**紫**（`--ore`，M3b 迭代 2 用户口径） */
const ore = {
  key: 'ore',
  nameKey: 'res.ore',
  descKey: 'res.ore.desc',
  order: 2,
  marker: '◆',
  colorKey: '--ore',
};

/** 合金（船体与建造的主材料）—— ★ 资源语义色＝**银**（`--alloy`，M3b 迭代 2 用户口径） */
const alloy = {
  key: 'alloy',
  nameKey: 'res.alloy',
  descKey: 'res.alloy.desc',
  order: 3,
  marker: '⬢',
  colorKey: '--alloy',
};

/** 稀土（稀有建造材料：高等级建造与升级消耗）—— ★ 资源语义色＝**绿**（`--rare`，M3b 迭代 2 用户口径） */
const rare = {
  key: 'rare',
  nameKey: 'res.rare',
  descKey: 'res.rare.desc',
  order: 4,
  marker: '✦',
  colorKey: '--rare',
};

/** 科研点（解锁科技；M3 无产出，仅供调试发放） */
const science = {
  key: 'science',
  nameKey: 'res.science',
  descKey: 'res.science.desc',
  order: 5,
  marker: '✧',
  colorKey: '--accent',
};

/** 资源注册表（key → 定义；键序即定义顺序） */
export const RESOURCES = { energy, ore, alloy, rare, science };

/** 资源键**有序**列表（**唯一口径**：账户初始化、消耗校验、UI 遍历都读它） */
export const RESOURCE_KEYS = Object.keys(RESOURCES);

/** 资源定义**有序**列表（按 `order` 升序；顶部资源栏与用途说明按它排） */
export const RESOURCE_LIST = RESOURCE_KEYS.map((k) => RESOURCES[k]).sort((a, b) => a.order - b.order);

/** 按 key 取资源定义（未知 ⇒ null） */
export function getResource(key) {
  return RESOURCES[key] || null;
}

/** 该 key 是否为已注册资源键 */
export function isResourceKey(key) {
  return Object.prototype.hasOwnProperty.call(RESOURCES, key);
}

export default RESOURCES;
