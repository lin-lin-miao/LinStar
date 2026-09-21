/* ===== data/baseConfig.js —— 基地【初始状态】配置（M3a） =====
 * 定位（主基地框架说明 §10「数值落位」）：本文件**只放基地的初始状态**，
 *   ★ **不放任何建筑 / 船型 / 模块 / 货物的消耗数值**（那些一律写在各自配置文件里：
 *     `data/baseBuildings/<id>.js`、`data/ships/<id>.js`、`data/modules/<类别>/<模块>.js`、`data/cargos/<id>.js`）。
 *   ★ `systems/base.js` 只实现**规则与校验**，**不持有任何数值**；本文件是"基地初始状态"的唯一出处。
 *
 * 字段：
 *   · `stateVersion`         基地状态版本号（M3f 存档迁移预留；M3 不存档，字段先立起来）；
 *   · `initialBuildingLevel` 建筑**初始等级**（所有建筑共用；`createBaseState` 按它初始化，
 *                            并夹取到该建筑配置 `levels[]` 的合法区间内 —— 代码里不写死等级）；
 *   · `initialResources`     **初始资源额度**（键＝`data/resources.js` 的资源键，顺序与之一致）；
 *   · `initialResourceCaps`  **资源容量上限的初始值**（同上键序；**未来由星球建筑的
 *                            `effect.resourceCap` 提升**，见 `data/baseBuildings/planet.js`）。
 *
 * ★ 上限口径（`systems/base.js` 的**唯一实现**，代码零硬编码）：
 *     上限 ＝ `initialResourceCaps` ＋ Σ各建筑该等级 `effect.resourceCap`（缺字段/非法值一律按 0 计）。
 *   M3 阶段星球为占位（其 `resourceCap` 恒 0）⇒ **上限 ＝ 本文件的初始上限**。
 *
 * ★ 全部数值为【占位预填 · 待用户调校】——取值来源：`主基地框架说明.md` §2 口径 3。
 */
export const BASE_CONFIG = {
  /** 基地状态版本（M3f 存档用；M3 不持久化，先占位）
   *  · 1 ＝ M3a 形状（含 `ships[]` 船只实例容器）；
   *  · 2 ＝ **M3b 形状**：`ships[]` 已按用户口径**迁移为 `fleetConfigs[]`**
   *        （舰队＝"抽象配置条目 + 数量"，见 `systems/base.js` 头注释）＋ `fleetSeq` 分配序号。 */
  stateVersion: 2,

  /** 建筑初始等级（占位；由 `systems/base.js` 夹取到该建筑配置的等级区间内） */
  initialBuildingLevel: 1,

  /** ★ 初始资源额度【占位预填 · 待用户调校】（键与 `data/resources.js` 一致且同序） */
  initialResources: {
    energy: 2000, // 能量币
    ore: 300,     // 矿物
    alloy: 500,   // 合金
    rare: 60,     // 稀土
    science: 0,   // 科研点（M3 无产出，仅初始额度 + 调试发放）
  },

  /** ★ 资源**容量上限**的初始值【占位预填 · 待用户调校】（同上键序；恒 ≥ 初始额度）
   *  · 语义：每种资源**最多能攒到**的数量；`gain()` 按上限**截断**（超出部分不获得，返回 `overflow`）；
   *  · **未来由星球建筑提升**：`baseBuildings/planet.js` 的 `effect.resourceCap`（M3 恒 0 ⇒ 上限＝本值）；
   *  · 非法值（负 / 非数 / 缺键）由引擎**回落为 0**（不提升、不报错）。 */
  initialResourceCaps: {
    energy: 5000, // 能量币上限
    ore: 1200,    // 矿物上限
    alloy: 2000,  // 合金上限
    rare: 300,    // 稀土上限
    science: 300, // 科研点上限
  },
};

export default BASE_CONFIG;
