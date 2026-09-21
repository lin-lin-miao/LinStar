/* ===== data/baseBuildings/planet.js —— 星球（基地建筑配置 · 本阶段未开放） =====
 * 体例与字段说明见 `data/baseBuildings/stargate.js` 头注释（本文件同体例）。
 * ★ `placeholder: true` —— **本阶段未开放**（`主基地框架说明.md` §1.3 / §4.6）：
 *   星球产业（E5）的建造与产出属 M4；M3 只在基地屏右侧面板显示
 *   "本阶段未开放" + **各资源种类与用途说明**（文案走 i18n，资源清单读 `data/resources.js`）。
 * ★ 因此本文件只保留**等级骨架**（`maxLevel: 1`、`level:1` 的 cost 恒 0），
 *   **不预填任何产业数值**（避免编造未定口径的消耗与产出）——
 *   唯一例外是**资源上限提升的字段位** `effect.resourceCap`（见下），其值为 0 ＝**不提升**。
 *
 * ★★ `effect.resourceCap` —— **资源容量上限提升**的唯一预留字段（M3a 修订新增字段位）：
 *   · 语义：本建筑该等级**为各资源上限增加的绝对量**（键＝`data/resources.js` 资源键，缺键视为 0）；
 *   · 引擎口径：`systems/base.js` 的上限 ＝ `baseConfig.initialResourceCaps` ＋ Σ 各建筑该等级的
 *     `effect.resourceCap` ⇒ **M4 只需往这里填数**，上限即随配置生效（代码零硬编码）；
 *   · ★ 本阶段（M3）**恒为全 0**（星球 `placeholder: true` 不可用）⇒ 上限＝初始上限，与首版行为一致。
 */
export default {
  id: 'planet',
  nameKey: 'building.planet',
  kind: 'building',
  order: 5,
  stage: 'M4',
  placeholder: true,
  maxLevel: 1,
  levels: [
    {
      level: 1,
      cost: { energy: 0, ore: 0, alloy: 0, rare: 0, science: 0 },
      /** ★ 资源上限提升【占位预填 · 待用户调校】：M3 恒 0（＝不提升）；M4 产业系统填入后自动生效 */
      effect: { resourceCap: { energy: 0, ore: 0, alloy: 0, rare: 0, science: 0 } },
    },
  ],
};
