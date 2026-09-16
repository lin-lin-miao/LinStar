/* ===== data/modules/function/repairBeam.js —— 维修光束（功能 · 主动 · 单体友方回血） =====
 * 功能：激活一次，**恢复目标一定生命值**（词条 `hp_target`），消耗**自身能量**（词条 `energy_cost`）。
 * 来源：`无人机模块设定.md`「维修无人机：搭载专用的维修光束模块。新增特殊的维修光束模块，
 *   功能类模块，单体目标，仅对友方，激活一次恢复目标一定生命值，消耗能量。」
 * 分类＝**功能**（`category:'function'`，文件在 `data/modules/function/`，代表色＝功能类色）；
 * ★ **`picker: false`（用户确认口径）**：本模块**仅供「维修无人机」自带**（由召唤模块
 *   `repairDroneSpawn` 经 `effects.summon.modules` force 安装），**玩家不可在编队里安装**——
 *   `ui/setupView.js` 的可选模块清单＝`Object.keys(MODULES).filter(id => !MODULES[id].picker)`
 *   ⇒ 本模块**不会出现**在编队可选列表中（与内部弹头 `rocketWarhead` 等同一体例）。
 * 目标：`{ kinds: ['ally'], countMode:'single', maxCount:1 }` —— **单体、仅友方**。
 *   ★ 照设定文档**只对友方**：既有选择器的 `ally` 桶＝`同阵营其它存活单位`（`battle.js moduleTargetList`：
 *     `sameSide.filter(u => u.alive && u.id !== ship.id)`）⇒ **天然排除自身**，与「矿物维修 / 货物维修」
 *     的 `kinds:['ally','self']`（含自身）**口径不同**，此处**不写 `self`** 即为“仅友方”。
 *   复用既有**目标优先级链**（强制目标 > 模块手动目标 > 船 targetId > 自动粘性 > 全队策略）与手动目标
 *   机制（详情页可点选友方单位）；潜行过滤/role 等既有规则照常适用。
 *   **无可用目标 → 不激活**（`moduleTargetList` 返回空 ⇒ `maybeActivate` 直接返回，不耗能、不进冷却）。
 * 门控（Pass1，零数值变化；全部走**唯一门控出口** `canImpact` + 既有成本门控块）：
 *   ① 能量 < `energy_cost` → 不激活、不耗能、不进冷却（`ctx.avail`，与既有能量门控同一处）；
 *   ② 目标**已满血** → 按既有 `hp_target` 体例不激活（通用量值循环的 `atCap`：
 *      `t.hull.hp >= t.hull.hpMax` ⇒ 全部目标都满 ⇒ 无可影响目标 ⇒ 不激活、不耗能）。
 * ★ **回血口径沿用既有唯一实现**：目标级量值词条 `hp_target` ＋ `type` 标签 **`exact_amount`**
 *   （**按词条原值、1:1 不乘任何类别系数**，与「矿物维修」的回血完全同一路径：`battle.js` 记账处
 *   `const amt = exactAmt ? fx[k] : fx[k] * co`），经既有 `applyHpTo` 落地（**按目标 `hpMax` 截断**、
 *   **不受受伤减免**）。
 * ★ **结算落点＝既有回血路径（结算步骤 4c）**：Pass1 只记 `__pending.hpDeltas`（目标级），
 *   4c 与既有 `hp_target`（自身/目标加血）**同批落地** ⇒ **不需要任何新步骤、不新增结算分支**。
 * 战报：**暂无**（沿用既有目标级量值口径：`hp_target` 在 4c 落地时既无战报也无统计，与「矿物维修」
 *   不同——后者有专属低频战报 `battle.log.oreRepair` 是因为它要报“扣了多少矿”）。
 *   ★ 如需给本模块也加一条低频战报（`{owner}的{module}：修复 {target} {amount} 点生命`），
 *     请先确认音——本轮**不擅自新增**键与成句点。
 * 图标：**暂无对应 SVG 素材 → 不写 `icon`**，走既有「名称首字」降级（“维”）；
 *   素材就位后补 `icon` 即可（筹码缺图回退见 `battleView.moduleGlyphEl` 的 `error` 监听）。
 * 数值说明：【占位预填】由用户逐级人工调校（回血/耗能的逐级阶梯**照「矿物维修」体例**：
 *   `hp_target` 60→110→180→280；`energy_cost` 60→90→130→180；`cooldown_ticks` 取 Lv1 后各级沿用）。
 */
export default {
  id: 'repairBeam',
  nameKey: 'module.repairBeam', // i18n -> 维修光束 / Repair Beam
  name: '维修光束',
  picker: false, // ★ 无人机专属：不出现在演练编队的可选模块清单（玩家不可安装）
  category: 'function',
  // 单体 · **仅友方**（`ally` 桶已排除自身 ⇒ 不含 `self`，与矿物/货物维修口径不同）
  target: { kinds: ['ally'], countMode: 'single', maxCount: 1 },
  effects: {
    // `exact_amount`＝**量值按词条原值**（目标级量值词条一律**不乘任何系数**，1:1 口径）；
    //   引擎按**标签**识别、不按模块 id 硬编码；未带该标签的既有模块数值**一字不变**。
    type: ['exact_amount'],
    cooldown_ticks: 60, // Lv1 占位：修复间隔（各级沿用 Lv1）
    energy_cost: 60,     // Lv1 占位：每次修复的能量消耗（耗能）
    hp_target: 60,      // Lv1 占位：给目标恢复的生命（**词条原值**，不乘任何系数；按 hpMax 截断）
  },
  maxLevel: 16,
  levels: [
    { level: 5, effects: { energy_cost: 90, hp_target: 110 } },
    { level: 10, effects: { energy_cost: 130, hp_target: 180 } },
    { level: 16, effects: { energy_cost: 180, hp_target: 280 } },
  ],
};
