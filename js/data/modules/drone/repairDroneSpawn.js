/* ===== data/modules/drone/repairDroneSpawn.js —— 维修无人机（召唤 · 无人机类） =====
 * 功能：召唤一个【维修无人机】临时单位，自带一枚与召唤模块**同等级**的「维修光束」
 *   （`function/repairBeam`，**无人机专属模块**：其自身 `picker:false`，玩家不可安装）。
 * 来源：`无人机模块设定.md`「维修无人机：搭载专用的维修光束模块。」——**该文档未给本无人机的三围**，
 *   故三围/存在时间/在场上限**全部为占位预填**（体例参考激光无人机 `drone/laserDroneSpawn.js`）。
 * 无人机船舰数据模型统一用 `data/ships.js` 的通用 `'drone'` 模板（与既有召唤模块完全同一路径），
 *   本模块经 `effects.summon` 设定其具体种类：
 *   - 图标：**本模块未写 `icon`**（无 SVG 素材）⇒ 召唤单位降级为 ▲（名称首字降级同理）；
 *   - 携带模组 `modules`（**等级＝召唤模块等级**，`installModule(..., force=true)` 不受槽限）；
 *   - `attrs.base` 按船型模板结构覆写三围（缺省沿用模板）；
 *   - `lifespan_ticks` 仅 `temp:true`（临时单位）时生效：到期**自动死亡**并直接移出场景；
 *   - `maxSummoned`＝**本召唤模块**的在场存活上限（按 `summonMod` 计，不同召唤模块互不挤占）。
 * 定位 `role`：**未写 `attrs.role`** ⇒ 沿用通用无人机模板的 `combat`（**文档未指定定位**，如需把维修
 *   无人机改为后勤（`logistics`：只在敌方战斗单位全灭后才可被选为目标）请在 `attrs` 里显式给出）。
 * ★ 数值来源标注（逐条）：
 *   · 【文档给定】无（该文档只给了“搭载维修光束”这一条功能口径）；
 *   · 【占位预填】三围 `hp 30 / shieldCap 10 / energyCap 300 / energyRegen 30`（hp/shieldCap 照激光
 *     无人机的占位体例；能量按“撑得起维修光束”预填：`energy_cost 60` ÷ `cooldown 60t`＝20/s 需求，
 *     `energyRegen 30/s` 有裕量）；存在时间 `1200t`（照激光无人机体例的占位）；在场上限 `2/3/4/5`；
 *     `cooldown_ticks 200` 与 `energy_cost 50` 照激光无人机的 Lv1 占位（各级沿用 Lv1）。
 *   · 逐级表：**占位**（hp/护盾/能量/回能随级小幅提升；存在时间与召号冷却各级沿用 Lv1）。
 * 数值说明：【占位预填 · 待用户调校】。
 */
export default {
  id: 'repairDroneSpawn',
  /* ★ M3 基地侧字段【占位预填 · 待用户调校】——M3a 只铺字段，读取逻辑属 M3b（船坞）/ M3e（研究站）。
   * · `levels[]` 仍是【战斗数值】的唯一逐级表（由 entities/module.js 解析 effects/target）；
   *   下列基地侧字段自带**独立逐级表**（数组项 { level, ... }，未列出该等级则沿用上一项）；
   * · 缺省即视为「无消耗 / 无门槛」：installCost / removeCost / upgradeCost / scienceCost 缺失＝免费，
   *   blueprint 缺失＝无需蓝图；资源键见 data/resources.js（缺失键视为 0）。 */
  installCost: { energy: 0, ore: 0, alloy: 0, rare: 0 },
  removeCost: { energy: 0, ore: 0, alloy: 0, rare: 0 },
  upgradeCost: [{ level: 2, cost: { energy: 0, ore: 0, alloy: 0, rare: 0 } }],
  blueprint: [{ level: 1, count: 0 }],
  scienceCost: [{ level: 2, cost: { science: 0 } }],
  nameKey: 'module.repairDroneSpawn', // i18n -> 维修无人机（未显式命名时作为召唤单位显示名）
  name: '维修无人机',
  category: 'drone',
  target: {}, // 召唤类：无命中目标（走 summon 执行）
  effects: {
    type: ['summon', 'cool_first'], // 召唤钩子；cool_first＝部署即进入冷却（开场不会立刻召唤）
    summon: {
      type: 'drone',                                  // 通用无人机模板
      modules: [{ moduleId: 'repairBeam' }],           // 携带：维修光束（等级＝召唤模块等级，不受槽限）
      attrs: {                                        // 覆写通用模板三围（缺省沿用模板）【占位预填】
        base: { hp: 30, shieldCap: 10, energyCap: 300, energyRegen: 30 },
      },
      lifespan_ticks: 1200, // 存在时间(tick)，仅 temp:true 生效【占位预填】（照激光无人机体例）
      maxSummoned: 2,       // 在场存活上限【占位预填】
      temp: true,           // 临时单位：到期自动死亡 + 阵亡直接移出场景
    },
    cooldown_ticks: 200, // 每次补召间隔【占位预填，各级沿用 Lv1】
    energy_cost: 50,     // 每次召唤能耗【占位预填，各级沿用 Lv1】
  },
  maxLevel: 16,
  levels: [
    // 逐级**占位**：仅三围与在场上限随级提升（存在时间/召唤冷却沿用 Lv1）
    { level: 5, effects: { summon: { attrs: { base: { hp: 34, shieldCap: 12, energyCap: 360, energyRegen: 36 } }, lifespan_ticks: 1200, maxSummoned: 3 } } },
    { level: 10, effects: { summon: { attrs: { base: { hp: 40, shieldCap: 14, energyCap: 420, energyRegen: 42 } }, lifespan_ticks: 1200, maxSummoned: 4 } } },
    { level: 16, effects: { summon: { attrs: { base: { hp: 48, shieldCap: 18, energyCap: 500, energyRegen: 50 } }, lifespan_ticks: 1200, maxSummoned: 5 } } },
  ],
};
