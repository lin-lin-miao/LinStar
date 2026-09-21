/* ===== data/modules/drone/bulwarkDroneSpawn.js —— 壁垒无人机（召唤 · 无人机类） =====
 * 功能：召唤一个【壁垒无人机】临时单位，自带**两个**与召唤模块**同等级**的模块：
 *   「固若金汤」`function/impregnable`（时长型：强制选定目标攻击自己 + 自身受伤减免）
 *   ＋「硬化护盾」`shield/hardShield`（厚实大护盾 · 大上限 · 持续）。
 * 来源：`无人机模块设定.md`「壁垒无人机：搭载一个固若金汤模块，与一个硬化护盾，自生生命值较低50，
 *   能量恢复为50，能量上限2000」——**hp 50 / energyRegen 50 / energyCap 2000 为文档给定硬数值，
 *   逐字照填**（盾上限文档未给 ⇒ 占位）。
 * 无人机船舰数据模型统一用 `data/ships.js` 的通用 `'drone'` 模板；本模块经 `effects.summon` 设定种类：
 *   - 图标：**本模块未写 `icon`**（无 SVG 素材）⇒ 召唤单位降级为 ▲；
 *   - 携带模组 `modules`：**两条**（固若金汤 + 硬化护盾），等级＝召唤模块等级、force 安装不受槽限；
 *   - `attrs.base` 覆写三围；`temp:true` + `lifespan_ticks` 到期自动死亡并直接移出场景；
 *   - `maxSummoned`＝本召唤模块的在场存活上限（按 `summonMod` 计，不与其它召唤模块互相挤占）。
 * 定位 `role`：**未写 `attrs.role`** ⇒ 沿用通用无人机模板的 `combat`（**文档未指定定位**；壁垒无人机
 *   承担“强制集火 + 减伤”的坦克职责，保持 `combat` 才会被敌方正常选为主要攻击目标——这正是它的用途）。
 * ★ 数值来源标注（逐条）：
 *   · 【文档给定】`base.hp 50`、`base.energyRegen 50`、`base.energyCap 2000`（**各级沿用同一组硬数值**：
 *     文档只给了一组，未说明随等级成长 ⇒ **不擅自让硬数值随级变化**）；
 *   · 【占位预填】`base.shieldCap 20`（文档未给）、`lifespan_ticks 1200`（文档未给存在时间 ⇒ 照激光
 *     无人机体例）、`maxSummoned 2/3/4/5`、`cooldown_ticks 200` 与 `energy_cost 50`（照激光无人机
 *     Lv1 占位，各级沿用 Lv1）；
 *   · 逐级表：**只放大占位项**（`shieldCap`、在场上限），文档给定的三围**各级保持不变**。
 * 数值说明：【占位预填 · 待用户调校】（文档给定的三项除外）。
 */
export default {
  id: 'bulwarkDroneSpawn',
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
  nameKey: 'module.bulwarkDroneSpawn', // i18n -> 壁垒无人机（未显式命名时作为召唤单位显示名）
  name: '壁垒无人机',
  category: 'drone',
  target: {}, // 召唤类：无命中目标（走 summon 执行）
  effects: {
    type: ['summon', 'cool_first'], // 召唤钩子；cool_first＝部署即进入冷却（开场不会立刻召唤）
    summon: {
      type: 'drone', // 通用无人机模板
      // 携带：固若金汤 + 硬化护盾（两条，等级＝召唤模块等级，不受槽限；两模块职能互补：强制集火 + 硬盾）
      modules: [{ moduleId: 'impregnable' }, { moduleId: 'hardShield' }],
      attrs: {
        // 【文档给定】hp 50 / energyRegen 50 / energyCap 2000；【占位预填】shieldCap 20
        base: { hp: 50, shieldCap: 20, energyCap: 2000, energyRegen: 50 },
      },
      lifespan_ticks: 1200, // 存在时间(tick)，仅 temp:true 生效【占位预填】（文档未给 ⇒ 照激光无人机体例）
      maxSummoned: 2,       // 在场存活上限【占位预填】
      temp: true,           // 临时单位：到期自动死亡 + 阵亡直接移出场景
    },
    cooldown_ticks: 2000, // 每次补召间隔【占位预填，各级沿用 Lv1】
    energy_cost: 50,     // 每次召唤能耗【占位预填，各级沿用 Lv1】
  },
  maxLevel: 16,
  levels: [
    // 逐级**占位**：**只**放大 shieldCap 与在场上限；hp/energyRegen/energyCap 为文档硬数值、各级不变
    { level: 5, effects: { summon: { attrs: { base: { hp: 50, shieldCap: 24, energyCap: 2000, energyRegen: 50 } }, lifespan_ticks: 1200, maxSummoned: 3 } } },
    { level: 10, effects: { summon: { attrs: { base: { hp: 50, shieldCap: 28, energyCap: 2000, energyRegen: 50 } }, lifespan_ticks: 1200, maxSummoned: 4 } } },
    { level: 16, effects: { summon: { attrs: { base: { hp: 50, shieldCap: 34, energyCap: 2000, energyRegen: 50 } }, lifespan_ticks: 1200, maxSummoned: 5 } } },
  ],
};
