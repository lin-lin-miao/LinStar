/* ===== data/modules/drone/sentryTurretSpawn.js —— 哨戒炮塔（召唤 · 无人机类 · 固定炮塔） =====
 * 功能：召唤一个【哨戒炮塔】临时单位，自带**两个**与召唤模块**同等级**的模块：
 *   **一枚「火炮」**`attack/cannon`
 *   ＋「同盟护盾」`shield/allianceShield`（**跨友方共享护盾池**：本方全体共享该池，见 `data/ships.js`
 *   与同盟护盾模块自身的口径）。
 * 来源：`无人机模块设定.md`「哨戒炮塔：搭载1个火炮模块，与一个同盟护盾，能量恢复为30，能量上限1000，
 *   存在时间2400」——**energyRegen 30 / energyCap 1000 / lifespan_ticks 2400 为文档给定硬数值，
 *   逐字照填**（hp/护盾文档未给 ⇒ 占位）。
 * 图标：**文档要求“两个炮塔图标需要使用一个实心的正六边形SVG作为图标”** ⇒ 本模块 `icon` 指向
 *   `assets/img/哨戒炮塔.svg`（**素材由美术另行交付**；无人机类棕 `--cat-drone`）。
 *   ★ 召唤单位图标**随本模块 icon**（引擎口径 `u.summonIcon = attrs.icon || inst.cfg.icon || ''`）
 *     ⇒ 模块与召唤单位**指向同一图标**；素材未就位时走既有 `error` 监听降级（首字/▲），不会报错。
 * 无人机船舰数据模型统一用 `data/ships.js` 的通用 `'drone'` 模板；本模块经 `effects.summon` 设定种类：
 *   - 携带模组 `modules`：**两条**（火炮 + 同盟护盾），等级＝召唤模块等级、force 安装不受槽限；
 *   - `attrs.base` 覆写三围；`temp:true` + `lifespan_ticks 2400` 到期自动死亡并直接移出场景（**炮塔**）；
 *   - `maxSummoned`＝本召唤模块的在场存活上限（按 `summonMod` 计，不与其它召唤模块互相挤占）。
 * 定位 `role`：**未写 `attrs.role`** ⇒ 沿用通用无人机模板的 `combat`（**文档未指定定位**）。
 * ★ 数值来源标注（逐条）：
 *   · 【文档给定】`base.energyRegen 30`、`base.energyCap 1000`、`lifespan_ticks 2400`
 *     （**各级沿用同一组硬数值**：文档只给了一组 ⇒ **不擅自让硬数值随级变化**）；
 *   · 【占位预填】`base.hp 40`、`base.shieldCap 20`（与激光炮塔同一组占位，**无文档依据**）、
 *     `maxSummoned 1/2/3/4`（与激光炮塔同一占位阶梯）、`cooldown_ticks 200` 与 `energy_cost 50`
 *     （照激光无人机 Lv1 占位，各级沿用 Lv1）；
 *   · 逐级表：**只放大占位项**（hp/shieldCap、在场上限），文档给定的能量两项与存在时间**各级不变**。
 * 数值说明：【占位预填 · 待用户调校】（文档给定的三项除外）。
 */
export default {
  id: 'sentryTurretSpawn',
  nameKey: 'module.sentryTurretSpawn', // i18n -> 哨戒炮塔（未显式命名时作为召唤单位显示名）
  name: '哨戒炮塔',
  icon: 'assets/img/哨戒炮塔.svg', // ★ 实心正六边形 SVG（美术另交付）；召唤单位共用本图标
  category: 'drone',
  target: {}, // 召唤类：无命中目标（走 summon 执行）
  effects: {
    type: ['summon', 'cool_first'], // 召唤钩子；cool_first＝部署即进入冷却（开场不会立刻召唤）
    summon: {
      type: 'drone', // 通用无人机模板
      // 携带：**一枚火炮** + 同盟护盾（等级＝召唤模块等级，不受槽限）
      modules: [{ moduleId: 'cannon' }, { moduleId: 'allianceShield' }],
      attrs: {
        // 【文档给定】energyRegen 30 / energyCap 1000；【占位预填】hp 40 / shieldCap 20
        base: { hp: 40, shieldCap: 20, energyCap: 1000, energyRegen: 30 },
      },
      lifespan_ticks: 2400, // 【文档给定】存在时间(tick)＝2400（仅 temp:true 生效）
      maxSummoned: 1,       // 在场存活上限【占位预填】
      temp: true,           // 临时单位：到期自动死亡 + 阵亡直接移出场景
    },
    cooldown_ticks: 200, // 每次补召间隔【占位预填，各级沿用 Lv1】
    energy_cost: 50,     // 每次召唤能耗【占位预填，各级沿用 Lv1】
  },
  maxLevel: 16,
  levels: [
    // 逐级**占位**：**只**放大 hp/shieldCap 与在场上限；energyRegen/energyCap/lifespan 为文档硬数值、各级不变
    { level: 5, effects: { summon: { attrs: { base: { hp: 46, shieldCap: 24, energyCap: 1000, energyRegen: 30 } }, lifespan_ticks: 2400, maxSummoned: 2 } } },
    { level: 10, effects: { summon: { attrs: { base: { hp: 54, shieldCap: 28, energyCap: 1000, energyRegen: 30 } }, lifespan_ticks: 2400, maxSummoned: 3 } } },
    { level: 16, effects: { summon: { attrs: { base: { hp: 64, shieldCap: 34, energyCap: 1000, energyRegen: 30 } }, lifespan_ticks: 2400, maxSummoned: 4 } } },
  ],
};
