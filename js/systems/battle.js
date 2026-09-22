/* ===== systems/battle.js —— 战斗系统核心 =====
 * 战斗状态机：idle -> running -> settled（胜负结算）-> 可重新开始
 *
 * tick 结算顺序（两段式结算，见下方 step()）：
 *   Pass 1 —— 行动遍历（对 tick 起始存活全体【单遍单位 for】，每单位一次完成）**零数值变化**：
 *     闪标递减（纯表现）→ 清理自身指向已死目标的引用 → 回充/回能/消耗/护盾池填池/上限修改/
 *     到期撤销/临时寿命 一律**只记意图**进 __pending（能量门控用单位内运行计数）→ 模块时长/冷却
 *     等**模块私有计时器**就地推进（对单位数值无影响）。全部单位【先记录后】，同 tick 双方对等。
 *   Pass 2 —— 结算：
 *     Phase A（单遍单位 for 收集，不新增全量单位循环）：把各单位 __pending 的意图并入若干
 *       **记录数组**（伤害命中 / 上限修改 / 到期撤销 / 能量 / 非伤害数值 / 临时寿命）。
 *     结算步骤（迭代记录数组，跨单位统一顺序）：
 *       步骤 1 计时推进（模块私有计时器，其唯一跨单位影响“到期撤销/恢复”已记为意图）；
 *       步骤 2 上限与系数统一落地（到期撤销 + capOps + 系数修饰 coeffOps + 时间系数 timeOps
 *              + 潜行标记 stealthOps，**先于伤害结算**）；
 *       步骤 2b 强制目标统一落地（forceOps：把选定目标压入施放者的强制来源栈，只改目标指向）；
 *       步骤 3 能量统一落地（回充 → 模块消耗 → energy_target 量值）；
 *       步骤 3b 星区矿物采集统一落地（oreGains：按比例分配 → 入 `hull.ore` → 扣减星区储量，唯一分配点）；
 *       步骤 3c 星区储量词条统一落地（sectorOps：**先加法、后乘法**，**无上限**；星区侧模块冷却同批写入）；
 *       步骤 3d 矿物支出统一落地（3d-1 `oreSpends`：模块的**矿物成本**从自身矿物仓扣除；
 *              3d-2 `oreTransfers`：矿物输送 **1:1 成对**搬运「自身 −N / 目标 +N」）；
 *              3d-3 `cargoTransfers`：**货物传输**把**整件已入舱货物**成对搬运「自身货舱 −整件 / 目标货舱 +整件」；
 *              3d-4 `cargoRepairs`：**货物维修**消耗**整件已入舱货物**（销毁、不返还星区；回血在 4c）；
 *              3d-5 `cargoEnhances`：**货物强化**把**目标货舱一件尚未被强化的货物** `bonus += bonus_add`
 *                    并置一次性标记 `enhanced`（成本＝能量步骤 3 + 矿物 3d-1，恒在其前）；
 *       步骤 4 护盾/模块池填充/血量/自毁/临时寿命统一落地。
 *     Phase B（相内子步，迭代命中条目）：按“普通/爆炸”吸收链结算真·武器/爆炸命中；
 *     Phase B2：反射返程统一在本 tick 命中全部结算完之后补打回（不递归、逐笔 noReflect）。
 *     Phase C（单遍单位 for 收尾）：统计写回 + 清 __pending + 临时单位移出。
 *     判死发生即就地撤销死者残留效果/cap(onDeath)，故不再需要 Pass0 的全量 dropDead/cleanDead。
 *
 * ★ 模块效果执行器（解耦，词条驱动）：
 *   模块在 data/modules.js 中用 effects 词条声明效果——
 *     damage     → 对每个选定目标造成伤害（×船类系数）
 *     shield_gain → **自身**恢复护盾（×船类系数；作用于模块所属自身）
 *     ore_gain   → **自身**开采矿物（×**采矿系数**；无目标、不进入目标选择链）：
 *        Pass1 只记“采集请求”（`__pending.oreGains`，按**剩余矿物容量**截断，**零数值变化**）→
 *        **结算步骤 3b** 跨单位一次算清：星区储量足额则各按请求量、不足则**按请求量比例均分**
 *        （floor + 余数按“请求量大者优先”）→ 入 `hull.ore`（读口径 `oreLoadOf`）→ 扣减星区储量；
 *        剩余容量为 0 / 星区储量为 0 → 不激活（`canImpact` 同一出口）；单位阵亡 → 携带矿物全额返还储量。
 *        ★ 战报（低频）：**仅实际入库量 > 0** 时记 1 条 `battle.log.miningGain`（`{owner}的{module}：采集 {n} 点矿物`），
 *          按**模块实例**聚合成一条（每实例每 tick ≤ 1 条，上限＝实际入库的“单位×模块实例”对数）。
 *     mining_coeff_add → **自身**采矿系数加性修饰（**自身**词条，与 `attack_coeff_add`/`shield_coeff_add`
 *        同族同表 `COEFF_ADD`）；常驻路径 `ship.js syncStaticCoeffs`（`_coeff_add` 后缀自动识别）。
 *        影响面全是**按需读取**（矿物容量模块部分 `oreCapacityOf`、采矿激光实采量 `ore_gain × coeff`），
 *        无任何缓存派生值 ⇒ **无需 `recalcDerived`**、装上/启停即时生效。
 *     sector_ore_add → **星区**剩余矿物储量**加法**（绝对增量 `sector_ore_add: 100` ⇒ 剩余 +100）：
 *        实际增量＝`round(词条值 × coeff(拥有者,'mining'))`（**乘采矿系数**，与采矿激光实采量/矿舱容量同口径；
 *        在 **Pass1 记账时**算好并取整一次 ⇒ 与采矿激光“同口径、同位置”，tick 内系数变化不影响已记意图）；
 *     sector_ore_mul → **星区**剩余矿物储量**乘法**（增量比例 `sector_ore_mul: 0.1` ⇒ 剩余 ×1.1，结果取整；
 *        **纯比例、不乘任何系数**）：
 *        二者作用于**星区**（既非自身也非目标词条）、模块需**无目标**（`target: {}`、不进目标选择链）；
 *        **混合冷却口径**：模块**实例自身冷却**（`cooldown_ticks`）＋**星区侧该模块冷却**
 *        （**独立词条 `sector_cd_ticks`**，星区只接受一次触发）**同时就绪**才能生效 —— 两把冷却互相独立、
 *        各自计时，同词条的各模块在星区上的冷却也各自独立（key ＝ 模块 id）；
 *        门控落在 `canImpact`（唯一出口）：不满足 → **不激活、不耗能、不进冷却**；
 *        同 tick 多个单位携带同一模块 → 固定顺序**只接受第一个**。
 *        Pass1 只记意图（`__pending.sectorOps`，**零数值变化**）→ **结算步骤 3c** 统一落地
 *        （先加法求和加入、再乘法逐条作用在当前剩余上并各取整一次；**星区储量无上限**），
 *        星区冷却同批写入（绝对到期 tick 模型，时长取 `sector_cd_ticks`）；
 *        只读口径＝`battle.sector.cd`（**UI 只读**）。
 *        ★ 战报（低频，**只在真正生效时**）：加法 `battle.log.sectorOreAdd`（`{owner}的{module}：星区矿物 +{n}`，
 *          `n`＝该条实际增量）、乘法 `battle.log.sectorOreMul`（`{owner}的{module}：星区矿物 ×{mul}（+{n}）`，
 *          `n`＝该条落地前后差值）——每模块每次激活至多 1 条，且被星区侧冷却限频。
 *     sector_cd_ticks → **星区侧冷却词条**（**独立词条**，见 `data/sector.js`「星区侧冷却词条」）：
 *        **词条存在即代表该模块参与星区冷却**（按词条识别、不硬编码模块 id）——以后任何模块带上它
 *        就自动受星区侧冷却约束（门控 / 落地 / UI 冷却行枚举**同源**，识别函数 `hasSectorCdFx`）；
 *        时长＝**本词条值**（不再取 `cooldown_ticks`，后者只管实例自身冷却）；`0` 也算参与。
 *     ore_cost → **自身**词条：**一次施放消耗的携带矿物量**（从**自身**矿物仓 `hull.ore` 扣，
 *        唯一读口径 `oreLoadOf`）——与 `energy_cost` **完全同体例**的“成本”词条，只是成本来源换成矿物：
 *        · 门控在 **Pass1 成本门控处**（召唤型模块与能量门控同一处；非召唤模块另在 `canImpact` 复核）：
 *          携带不足 → **不激活、不扣矿物、不进冷却**；
 *        · 单位内运行计数 `ctx.oreAvail`（tick 起始携带量 − 本 tick 已记账支出）
 *          ⇒ 同单位多模块按序门控、不会超发（与 `ctx.avail` 的能量口径完全同构）；
 *        · Pass1 只记账（`__pending.oreSpends`，**零数值变化**）→ **结算步骤 3d-1** 统一扣除；
 *          ★ 该步骤同时把“**本 tick 实际扣矿量**”写回实例（`_orePaidAmt`/`_orePaidTick`，非数值标记），
 *            供**治疗型矿物成本模块**（`ore_cost` + 治疗 `hp_target`）在步骤 4c 成句时取用
 *            → 该类模块记 **1 条低频战报** `battle.log.oreRepair`（仅**实际回血量 > 0**、每模块每 tick ≤ 1 条）；
 *            成本本身不单独记战报（与 `energy_cost` 同口径）。
 *     ore_target → **目标级量值词条**：给目标**增加矿物**（已登记进量值词条表 `AMOUNT`，与
 *        `energy_target` 同族同表）。★ **1:1、不乘任何系数**（单独成支，不走 `fx[k] * co` 通用缩放路径）：
 *        · 门控（`canImpact` 唯一出口）：① 自身携带矿物 < 词条值 → 不激活；
 *          ② 目标剩余矿物容量为 0（已满）→ 不激活（沿用“存在可影响目标”口径）；
 *          ③ 目标容量不足但 > 0 → 照常激活，实际量＝`min(词条值, 自身剩余携带, 目标剩余容量)`；
 *        · Pass1 只记意图（`__pending.oreTransfers`，**零数值变化**）→ **结算步骤 3d-2** 统一落地
 *          （一条记录＝一次「自身 −N / 目标 +N」，同额、原子；截断读 Pass1 快照 ⇒ 与遍历顺序无关）；
 *          ★ 落地处记 **1 条低频战报** `battle.log.oreTransfer`（仅**实际输送量 > 0**、每模块每 tick ≤ 1 条）。
 *     shield_gain_target → 对每个选定目标恢复/汲取护盾（目标级）
 *     cargo_transfer（`type` 标签）→ **货物传输**：把**一整件已入舱货物**原样搬运给单体友方（运输类模块）。
 *        · 被搬运物只从**唯一实体清单** `cargoListOf(ship)` 取（**在装货物不在其中 ⇒ 天然不可传输**），
 *          选择口径＝**货舱列表顺序顺延取第一件「目标剩余货舱装得下」的**（唯一实现
 *          `pickCargoOf(ship,'fifo',false, cargoRoomOf(target))`：首件装不下就**往后顺延**，
 *          全部装不下 ⇒ 无货可搬）；仍**只搬一件**（顺延只改“选哪一件”、不改“搬几件”）；
 *        · 门控（`canImpact` 唯一出口，**零数值变化**）：① 自身无已入舱货物 → 不激活、不耗能、不进冷却；
 *          ② 全部已入舱货物都超出该目标剩余货舱 → 不激活（唯一读口径 `cargoRoomOf`；判据与选择
 *          口径**同一函数、同一快照**，不会出现“门控通过但选不到”）；
 *          ③ 能量不足 → 既有成本门控拦住（同一处）；
 *        · Pass1 只记意图（`__pending.cargoTransfers`）→ **结算步骤 3d-3** 成对原子落地
 *          （「自身货舱 −整件 / 目标货舱 +整件」同一实体、先出后入；`hull.cargo` 与实体清单同写同源；
 *            **不改 `loadTicks`** ⇒ 实体特性随货走）；落地处记 **1 条低频战报** `battle.log.cargoTransfer`。
 *     cargo_repair（`type` 标签）→ **货物维修**：消耗**一整件已入舱货物**换回血（运输类模块）。
 *        · 被消耗物只从 `cargoListOf(ship)` 取（在装货物天然不可消耗），选择口径＝**吨位最小优先**
 *          （同吨位 ⇒ 货舱列表顺序；唯一实现 `pickCargoOf(ship,'min')`）；
 *        · 门控（`canImpact` 唯一出口）：① 自身无已入舱货物 → 不激活；② 目标满血 → 不激活
 *          （沿用 `hp_target` 的 `atCap` 判据）；③ 能量不足 → 成本门控拦住；
 *        · **回血量 = round(货物吨位 × `hp_per_ton`)**，Pass1 一次算好并**冻结**进意图（结算不重算）；
 *          `hp_per_ton` **不进** `AMOUNT` 表 ⇒ **不乘任何类别系数**（对既有模块零影响）；
 *        · 货物销毁（**不返还星区**）→ **结算步骤 3d-4**（幂等：判据＝实体是否仍在 `ship.cargos` 内）；
 *          回血 → 既有**步骤 4c `applyHpTo`**（正值按 hpMax 截断、不受受伤减免）⇒ **先扣货、后回血**；
 *          两者成对同 tick；4c 回血落地处记 **1 条低频战报** `battle.log.cargoRepair`（成对判据同样取自
 *          “本 tick 实际发生的事实”：实际回血 > 0 且 `_cargoPaidTick` ＝本 tick）。
 *     cargo_enhance（`type` 标签）→ **货物强化**：把**目标单位货舱里一件「尚未被强化」的货物**的加成系数
 *        **加性**提高 `bonus_add`（一次性、永久）——采矿类模块，消耗自身矿物（`ore_cost`）＋能量。
 *        · 目标＝单体（`kinds:['ally','self']`，含自身；**无隐式优先级**，见 `moduleTargetList` 的
 *          候选池口径）；强化对象只从**目标**的 `cargoListOf(target)` 取（**在装货物天然不可被强化**）；
 *        · 选择口径＝**货舱列表顺序中第一件尚未被强化的货物**（FIFO；★ 待用户确认是否与“吨位最小”统一）；
 *        · 门控（`canImpact` 唯一出口）：① 目标货舱无「尚未被强化」的货物 → 不激活；② 矿物不足 / ③ 能量不足
 *          → 既有成本门控拦住（`ctx.oreAvail`/`ctx.avail`）；
 *        · **提升量＝词条原值**（**不乘任何类别系数**：`bonus_add` 不进 `AMOUNT` 表，通用缩放不适用）；
 *        · Pass1 只记意图（`__pending.cargoEnhances`）→ **结算步骤 3d-5** 唯一写入：
 *          `货物.bonus += bonus_add` ＋ 一次性标记 `货物.enhanced = true`（**幂等**判据＝该标记；
 *          标记**随实体走**，传输/返还星区/再装载都不清）⇒ “每件货物只能被强化一次”；
 *        · 落地处记 **1 条低频战报** `battle.log.cargoEnhance`（仅真正写入时、每模块每 tick ≤ 1 条）。
 *     exact_amount（`type` 标签）→ **量值按词条原值**：本模块的**目标级量值词条**（`AMOUNT` 表：
 *       shield/hp/energy/ore）一律**不乘任何系数**（1:1 口径，如「矿物维修」的回血 `hp_target`）。
 *       · 引擎按**标签**识别、不按模块 id 硬编码；**只管量值**，不管 `CAPFIELD` 上限类词条；
 *       · 未带该标签的模块走原 `词条值 × 类别系数` 路径 ⇒ 既有数值**一字不变**（零回归）。
 *     force_target_self（`type` 标签）→ 把每个选定目标压入“强制来源栈”（栈顶＝最后激活者优先被集火；
 *       撤销只出栈，不恢复旧目标）
 *     include_self（`type` 标签）→ 效果**同时施加于自身**（与目标选择器无关；**标签补入的自身不产生
 *       blast 溅射**；若自身是被选择器正常解析出来的目标——`prefer_self` 默认/手动选中——则照常有溅射）
 *     prefer_self（`type` 标签）→ **优先自己**：自身可作为目标时，默认解析优先取自己（手动选择优先于它）
 *     lock_target_on_activate（`type` 标签）→ **激活后锁定目标**：持续期内目标固定为激活瞬间的解析结果，
 *       优先级高于强制目标与手动目标；持续期内玩家点选的目标只记录、下次激活才采用
 *     delayed_trigger（`type` 标签）→ **后触发**：效果**不在激活时产生**，而是把「作用集合 + 出伤数值」
 *       冻结在激活瞬间（`effectSetOf` → `inst._delayedRefs`），在**持续期到期结算的瞬间**才产生
 *       （Pass1 到期分支 `fireDelayedEffect` 按既有伤害记账写入目标 `__pending.dmg`）→ 走既有
 *       命中/护盾/防爆/溅射抑制/判死/战报链路，不新增伤害体系；提前结束持续期（停用/阵亡/离场）不触发
 *     hp_below_activate（词条，如 `0.2`）→ **低血触发门控**：仅当 `hull.hp / hull.hpMax ≤ 阈值` 时可激活；
 *       激活即打**结构标记** `inst._firedOnce`（Pass1 零数值变化），血量**回升过阈值**才清标记
 *       → 同一低血区间只触发一次，血量回升后可再次触发
 *     stealth（`type` 标签）→ **潜行**：把作用集合（`effectSetOf`：目标 ∪ 波及 ∪ `include_self` 自身）
 *       内的单位标记为“**不能成为主要攻击目标**”（`ship.stealthMods` + `ship.isStealth`，**零数值变化**）；
 *       仍受 `blast_range` 溅射、仍受既已锁定的目标（`lockTargetId` / `lock_target_on_activate`）约束；
 *       目标解析过滤的**唯一口径**＝`targetAllowed`（内含潜行判据 `stealthBlocksTargeting` + role 分离；
 *       `moduleTargetList` 与 `shipEffectiveTarget` 同口径）；Pass1 只记账（`__pending.stealthOps`）→ **结算步骤 2**
 *       与 capOps/coeffOps/timeOps 同批落地
 *       → 从**下一 tick 的目标解析**起体现；需搭配 `duration_ticks`（到期/停用/阵亡/移出场景/重新激活前撤销）
 *     attack_coeff_add → 类别系数**加性**修饰（**自身**词条，走 coeff() 唯一口径）
 *     hp_cap_bonus / energy_cap_bonus / energy_regen_bonus / shield_coeff_add / shield_cap_bonus /
 *       cargo_cap_bonus / ore_cap_bonus →
 *       **自身【常驻静态加成】**（**增幅器类**，一律**无 `_target` 后缀** = 硬作用于模块所属自身）：
 *       血量上限 / 能量上限 / 能量恢复 / 类别系数加性 / 护盾容量 / 货物容量 / 矿物容量。
 *       **无冷却、无持续、无耗能、不激活**——
 *       由**派生重算/按需读取**落地（安装即生效、停用即失效），**不进** Pass1/Pass2 任何记账、**不产生战报**，
 *       故对 tick 而言零数值变化。唯一落地口径＝`ship.js syncSelfStatics`（三围上限与能量恢复：
 *       `基准 + Σ自身常驻×类别系数 + Σ目标级 cap 叠加`；类别系数加性写既有 `coeffMods`）、护盾池
 *       `permanentBonus`（护盾容量），以及**按需读取**的 `cargoCapacityOf`/`oreCapacityOf`
 *       （货舱/矿物容量 = 本体容量 + Σ各来源×对应船级系数 后取整；各来源分别乘系数再求和）；
 *       战斗内启停模块走 `recomputeCap`（合并目标级叠加，非累加），
 *       绝不复位到裸基准。常驻判据＝模块启用中 且 **无 `duration_ticks`**（与护盾池 permanentBonus 分支同源）。
 *     hp_regen_per_death → **按上一 tick 阵亡数回血**（**自身**词条，如「回收利用」）：
 *       恢复量 = `词条值 × 类别系数 × 上一 tick 阵亡数`（全场双方合计、**排除召唤/临时单位**，
 *       判据 `summonMod || isSummon`，与 soloConditionHolds 同一口径）。阵亡数由各判死点唯一出口
 *       `onDeath()` 累加 `deathsThisTick`、**tick 收尾**提交为 `lastTickDeaths`（Pass1 只读快照 →
 *       同一 tick 内无“死→回血”反馈环、遍历顺序无关、镜像对等）。回血为**真实 hp 恢复**：
 *       Pass1 只记 `__pending.hpDeltas`（带 `regen:true`），**结算步骤 4c** 与 `hp_target` 同批
 *       `applyHpTo`（钳制到 `hpMax`、正值不乘受伤减免）；`0 阵亡` → 不记账、零数值变化；
 *       仅“**实际回血 > 0**”时记 1 条低频战报 `battle.log.recycleRegen`（带模块拥有者）。
 *     damage_coeff_mul → **受伤减免系数**（**自身**词条，受击向）：该单位**受到的**一切伤害在落地时乘它
 *       （0.95 = 只承受 95%；唯一结算点＝`applyHit` 入口，故主目标命中/爆炸波及/反射返程等
 *       所有来源自动一并减免）；**豁免**：自毁 `self_destruct_damage`、能量削减、上限类 `*_cap_target`
 *     attack_coeff_add_target / damage_coeff_mul_target → 同上但作用于**每个解析目标**（目标级词条）
 *     time_coeff → **时间系数**（影响“**需求量**”，★ **不改每 tick 推进量**：每 tick 恒推进 1 tick）：
 *       作用对象的各类计时器需求量变为 `timeScaled(基础量, 系数)` ＝ `max(0, round(基础量 × (1 + 系数)))`，
 *       计时器**剩余 = 需求量 − 已推进 tick 数**（每个计时器各自记 `elapsed`，每 tick 恒 +1）→
 *       模块**冷却**、模块**持续时间**、临时单位**存在时间**都按新需求量走完。
 *       · 系数**为负＝加速**（`-0.1` → 需求量 ×0.9，更快走完；由「时间扭曲」模块给出）；
 *       · 系数**为正＝放缓**（`+0.1` → 需求量 ×1.1，更慢走完；由「放缓时间」模块给出）。
 *       作用集合＝目标选择器解析结果 ∪ `blast_range` 波及 ∪ `include_self` 标签补入的自身
 *       （与上限词条共用 `effectSetOf`）；Pass2 结算阶段落地 → **下一 tick 起**生效。
 *       ★ 系数在计时**中途**落地/撤销时，按已推进 tick 数反推剩余 → 总是“新需求 − 已推进”，
 *         需求变小剩余必变小（不会出现错向）；已推进的进度绝不回退。
 *       **战报低频**：仅在“从无→有”记 1 条（负系数＝`hastenStart`、正系数＝`slowStart`）、
 *       “从有→无”记 1 条（`hastenEnd`/`slowEnd`）（同一模块同 tick 内到期并重新激活则整体静默），
 *       **不逐次激活播报**。
 *     （后续词条如 heal / energyDrain 在此同一框架追加执行器）
 *   effects.type 仅用于"特殊模块的特殊效果"标记，且为【列表参数】，
 *   未来一个模块可同时携带多个特殊效果（type: ['...', '...']）。
 *   ★ **持续型一律由 `duration_ticks > 0` 判定**：`'duration'` 不是合法标签（不要写进 type 数组）。
 *
 * ★ 统一目标系统（详情/单位框/指挥栏共用同一解析）：
 *   目标可用对象 kinds（self/ally/enemy）+ 目标数量 countMode
 *   （single/multi/all，multi 数量上限 maxCount）
 *   解析链（单模块优先级，★ 唯一口径，与 `shipEffectiveTarget` 同源）：
 *     锁定单位 > 激活锁定(`lock_target_on_activate`·持续期内) > 强制目标 > 模块手动选择(单/多，互斥)
 *     > 优先自己(`prefer_self`) > 船指定目标 > 自动粘性 > 全队策略自动补足
 *   ★ **潜行过滤**（`type` 标签 `stealth`，唯一口径 `stealthBlocksTargeting`）：上述链中
 *     **除“锁定单位 / 激活锁定”外的全部来源**（强制目标 / 手动选择 / 优先自己 / 船指定目标 /
 *     自动粘性 / 全队策略）**一律跳过潜行单位**；`blast_range` 溅射**不受影响**。
 *   ★ **单位定位（role）分离**（唯一口径 `targetAllowed` / `roleBlocksInFoes`，与潜行过滤**同一处**）：
 *     · `enemy` 类目标：**目标方仍有「可选战斗单位」时，其后勤单位不可被选**；「可选」＝**存活 且 未被
 *       潜行屏蔽**（对该施放者而言不可选）→ 战斗单位全部阵亡**或全部被潜行屏蔽**时后勤**解禁**
 *       （避免“潜行挡战斗 + role 挡后勤 → 候选池空”，按**存活/潜行快照**计、下一 tick 起体现）；
 *     · `self`/`ally`/`any` 类**不做 role 分离**（治疗/输送类仍可指向后勤单位）；
 *     · **锁定豁免照旧**（`lockTargetId` / `lock_target_on_activate` 两分支在过滤之前直接返回）；
 *     · **溅射按主目标所属 role 队列分离**：`blast_range` 邻接只取自**与主目标同侧、同 role** 的
 *       视觉顺序队列（`unitsOfRole`/`orderedQueueFor`），**不跨 role 波及**。
 *   目标不足/无目标 → 本次不激活。
 *
 * ★★ 货物装载（运输类 `loadingBeam` —— **装载光束**；标签驱动、结算阶段统一落地）★★
 *   · **能力由标签、速度由词条**：`effects.type` 含 **`cargo_loader`** ⇒ 该模块是**装载器**
 *     （引擎**按标签识别、不硬编码模块 id**）；`effects.cargo_load` ＝**装载速度加成**（纯数值，可逐级变）。
 *     无目标（`target:{}`）⇒ **不进入目标选择链**（与采矿激光 `ore_gain` 完全同体例：`selfTargeted`）。
 *   · **装载对象＝星区货物**，选择顺序（唯一口径 `pickLoadableCargo`，Pass1 读 tick 起始快照）：
 *       ① **优先队列优先**（按 `cargoQueue` 顺序，**队首最先**）；② 其后＝**未被选入队列者按星区列表顺序**；
 *       ★ 星区列表本身是**队列式（前出后入）**：入舱即从列表移除（其余项前移）、返还即追加到**队尾**
 *         ⇒ ② 的“默认先后”随装载/返还自然前移，**不是**按编号固定位置（见 `appendCargoToSector`）；
 *       逐件判定，**不可用则跳过并继续找下一件**——不可用＝(a) 已被别的装载器锁定（`cargo._loadBy`）、
 *       (b) **本 tick 已被认领**（`loadClaimedTick`）、(c) **本舰剩余货舱装不下**（`< 货物 tons`）；
 *       **全部不可用 ⇒ 不激活、不耗能、不进冷却**。
 *   · ★ **同 tick 争抢的裁决＝装载速度优先（`resolveLoadClaims`，唯一裁决点）**：
 *       Pass1 中每个装载器先登记一条**认领申请**（`loadClaims`，Stage A：不耗能/不进冷却/不写意图），
 *       随后在 **Pass1 末尾、Phase A 之前**统一裁决：**全体申请（跨阵营）按装载速度从高到低**排序，
 *       同一件货物**只有一个赢家**；**同速**按**固定遍历序**（allies → enemies、组内既定模块顺序）
 *       先到先得（与 `sectorClaimedTick`/`ctx.oreClaimed` 的既有争抢口径同体例）⇒ 确定、可复现；
 *       赢家才按既有口径记账（耗能 → 冷却 → 意图 → 激活统计），败者**不激活**（不耗能、不进冷却）
 *       并继续尝试下一件。速度**只有一个口径** `cargoLoadSpeedOf`（排序与时长公式共用，不另算第二套）。
 *   · **一次一件**：**每个模块实例同一时刻至多 1 件在装**（`inst._load` 非空即视为“忙”）⇒
 *     装载期间**不再重复扣能量**；能量门控沿用既有成本门控（不足 ⇒ 不激活、不扣能量；
 *     裁决时再按同一能量预算复核，能量不足的申请整体作废、货物留给速度次高者）。
 *   · **装载时长（用户口径，唯一实现 `cargoLoadNeedTicks`）**：
 *       `需求 tick = max(1, round(货物.loadTicks ÷ 速度))`，**下限 1t**（取整与下限**只此一处**）；
 *       `速度 = 1 + 词条 cargo_load + (coeff(拥有者,'transport') − 1)`（默认 `1 + 0.1 + 1 − 1 = 1.1`
 *       ⇒ 300t 货物 ⇒ `round(300/1.1) = 273t` ≈ 13.7s）。**在 Pass1 裁决获胜时按 tick 起始快照算好一次**
 *       并随意图一起记入 `__pending`（与 `ore_gain` 的“Pass1 用本 tick 快照算好再记账”**同一体例**）
 *       ⇒ 本 tick 内系数变化不改动已记需求；UI **只读引擎给出的需求/进度**，用
 *       `core/tick.js formatTickSeconds` 换算展示（**不存在第二套公式**）。
 *   · **Pass1 零数值变化**：只记 `loadClaims`（认领申请）→ 裁决后写 `__pending.cargoLoadOps`
 *       （每条 `{ inst, ship, cargo, need }`）＋本 tick 认领集合 `loadClaimedTick`（记账，非数值）。
 *   · **结算步骤 5（★ 唯一落地，位置＝Phase B2 之后、Phase C 之前）**：`settleCargoLoads(ops)`
 *       ① **启动**：双向登记锁定（`inst._load = { cargo, elapsed, need, startedTick }` ＋
 *          `cargo._loadBy = { ship, inst }`）—— 拥有者本 tick 已死/已停用 ⇒ **不启动**（能量不退）；
 *       ② **进度推进**：每 tick **+1**（`elapsed` 上限＝`need`；**启动那一 tick 不推进** ⇒ 装载恰好
 *          耗时 `need` tick）；拥有者阵亡 / 模块停用 ⇒ **立即解锁 + 进度归零**（能量不退）；
 *       ③ **完成**：`elapsed ≥ need` 且拥有者**存活** 且**货舱容得下** ⇒ `landCargoOn()`：
 *          货物**从星区移除**（同时出 `cargoQueue`）→ 进入该单位 `ship.cargos` ＋ `hull.cargo += tons`
 *          （**唯一写入者**）→ **`cargo.loadTicks` 永久改写为 `CARGO_FAST_LOAD_TICKS`(20t)** → 解锁；
 *          容量不足（中途容量变小）⇒ **保持锁定与进度**（`elapsed` 钳在需求上）等下 tick 再判。
 *       ★ **放在全部判死之后**是“拥有者本 tick 死亡 ⇒ **不完成装载**”的**确定性规则**：
 *         判死散落在步骤 4c/4d/4e 与 Phase B/B2，只有在本步骤读 `ship.alive` 才能得到**本 tick 终态**，
 *         与“谁先谁后死”无关（镜像对等、与遍历顺序无关）；启动/推进同样只读 `alive`/`enabled` 结构标记。
 *       ⚠ 与步骤 3（能量）的关系：**能量在步骤 3 已扣**，本步骤**不再触碰能量**（口径：停用/阵亡**不退能量**）。
 *   · **解锁（立即）**：模块**停用**（`disableModule`）或**拥有者阵亡**（`onDeath`）⇒ 解锁 + 进度归零。
 *   · **单位阵亡返还**：已装载货物按 `onDeath` **全额返还星区**（唯一出口、**幂等**：返还后清单与
 *       `hull.cargo` 立即清空）；**同一 `id`、同一对象**，**追加到星区列表末尾**（**队列式：前出后入**；
 *       用户口径：**不恢复初始顺序**），且**不再自动入队**（队列是用户的选择）；返还后该货物的
 *       `loadTicks` **保持 20t**（特性永久）。
 *   · **手动卸载（详情页点芯片）**＝`battle.unloadCargo(shipId, cargoId)`：同一返还实现（`manual=true`），
 *       并记「**分阵营 + 带时限**」标记（`manualUnloadedSide`＝卸载者阵营、`manualUnloadedUntil`＝绝对
 *       到期 tick＝卸载 tick + `CARGO_MANUAL_UNLOAD_TICKS`(600t＝30s)）：**本阵营**装载器的**自动选取**
 *       在时限内跳过该件（判据唯一实现 `cargoManualUnloadActive`），**敌对方不受影响**、**到期自动失效**、
 *       **玩家把它加入优先队列即立即清除**；阵亡全额返还**不记标记**（不是玩家意图）。
 *   · **唯一接口/只读口径**：
 *       · `battle.unloadCargo(shipId, cargoId)` —— 主动**返还**（详情页点芯片），返回 `{ ok, … }`；
 *       · `battle.sector.cargos[]` 每项新增 `locked` / `lockedBy` / `loadProgressTicks` / `loadNeedTicks`
 *         / **`manualUnloaded` / `manualUnloadedTicks`**（前两个为 `true` 时＝该件在剩余 tick 内不会被
 *         **本阵营**装载器自动选取；**引擎派生**，UI 只读、不自算到期）；被锁定的货物**点击入队无效**
 *         （`toggleCargoQueue` 引擎侧拒绝）；
 *       · 单位侧＝`ship.js cargoListOf(ship)`（已装货物实体清单）＋ `cargoLoadOf(ship)`（吨位口径）。
 *   · **低频战报**（本批新增，均为“仅真正发生时 1 条”）：
 *       · **装载完成** ⇒ `battle.log.cargoLoad`（唯一入舱点 `landCargoOn` 成句，与数值同批）；
 *       · **手动卸载回星区** ⇒ `battle.log.cargoUnload`（**UI 在 tick 之间即时触发** ⇒ 立即成句、
 *         直接写战报序列、**不写 `__pending`**；失败早退不记、重复点击幂等不重复成句）；
 *       · **阵亡返还**：**不单独播报**（避免死亡刷屏；如需再定）。
 *
 * ★★ 星域容器专用：单位「跨实例整体搬迁」的两个最小接口（阶段 1「星区间移动」；单星区玩法不调用）★★
 *   · `battle.takeUnit(id)` —— **摘取单位**：把该单位从本实例场景摘除，但**保留其全部自身状态**
 *     （血量/护盾与各池现值/能量/模块实例与冷却与持续期/已装货物/携带矿物/定位与策略/目标选择）；
 *     · 同时 ① 撤销它对**本实例其它单位**的影响（既有 `dropSourceMods`/`releaseCoeffRefs`/`releaseTime`/
 *       `releaseStealth`/`releaseForced`）、② 作废它自己未触发的后触发载荷、并把它从**其它模块**已冻结的
 *       后触发作用集合里剔除（防跨实例幽灵写入）、③ 释放在装（未入舱）货物、
 *       ④ **清除“由其它单位施加”的临时状态**（判据＝来源 key 是否本单位自身模块实例 id，见
 *       `clearForeignMods`）；⑤ 摘除后刷新 `sideSize`；**不计阵亡数、不置 `alive=false`、不播报阵亡**。
 *     · 返回 `{ ok, unit, reason }`。
 *   · `battle.adoptUnit(unit, side)` —— **收编单位**：把**同一个对象实例**挂回本实例阵营数组并**在本实例内
 *     重绑**（`order` 取本实例下一出场序号、护盾池使用序 `_shieldSeq` 按本实例计数器重编号、`__pending`
 *     重建、`recomputeCap` 按本实例状态重算上限与护盾池）⇒ 搬迁后**照常参与 Pass1/结算/Phase B/C**。
 *   ★ 二者**只为星域容器**而设（`crossSectorPhase` 唯一落地处），**不进入** Pass1/Phase A/B/C 结算全序、
 *     不改变任何既有调用路径 ⇒ 既有战斗屏与 `LS.drill()` 行为、数值、战报序列**一字不变**（零回归）。
 *   ★ 单位上的**航行字段**（同为星域容器专用，引擎侧只读）：
 *     · `coefficients.nav` —— **航行系数**（与其它类别系数**同族同链**；唯一读口径
 *       `entities/ship.js navCoeffOf(ship)` ⇒ 即 `coeff(ship,'nav')`）；战斗数值链**不读它**；
 *     · `ship.navReadyUntil` —— **航行冷却的绝对到期 tick**（基准＝星域容器 `runTicks`；模型同本实例的
 *       `sectorCdUntil`）：`≤ 当前 tick` ＝ 就绪（**就绪时下达 ⇒ 立即到期，下一 tick 即迁移**）。
 *       **唯一写入口＝星域容器**（迁移落地后按 `navCdTicks` 为下一步重新计时，**无论是否还有后续指令**；
 *       冷却推进的**能量门控**同样只在该阶段落地 —— ★ **「始终充能」口径**：只要处于**充能中**（剩余 > 0）
 *       且**可指挥**，每 tick 就尝试扣该单位配置的 `navEnergyPerTick`（唯一读口径 `navEnergyPerTickOf`）：
 *       扣得起 ⇒ 推进；扣不起 ⇒ 不扣、到期 tick 顺延 1；
 *       **充能完成后不再扣能**）。既有单星区玩法恒为 0、从不读写。
 *     · `ship.navCdTicks` / `ship.baseNavCdTicks` —— 本步**冻结的冷却长度**（只读展示分母）与
 *       **船型配置的冷却基准**（`data/ships/<id>.js navCdTicks`，默认 200t；只读口径 `navCdTicksOf`）。
 *
 * 契约：开始广播 combat:state{active:true}；结算完成广播 active:false（自动落档）。
 * 事件：'battle:settled' { result:'win'|'lose'|'draw' }
 * ★ 开战入口（唯一）：本文件 `startBattle({allies, enemies})` —— 校验/规范化编队 + 建单位；
 *   UI 侧唯一入口是 `ui/battleView.js enterBattle(formation)`（内部调用前者）。
 *   请勿在别处直接 `createBattle` 或自拼 preset。
 */
import { bus } from '../core/eventBus.js';
import { log, formatRich } from '../core/log.js';
// ★ 展示口径（战报成句用）：**唯一换算**，二者分工严格、**不得混用** ——
//   · `core/utils.js formatBonusPercent`：入参是**倍率**（中性值 1，公式 `(b−1)×100`；引擎侧不需要，
//     货物芯片的加成段由 UI 调它）；
//   · `formatBonusDeltaPercent`：入参是**增量**（中性值 0，公式 `d×100`，带正负号）——
//   「货物强化」的 `bonus_add` 是**增量**词条（0.1 ⇒ '+10'），故其战报**必须**用后者。
import { formatBonusDeltaPercent } from '../core/utils.js';
import { i18n } from '../i18n/index.js';
// ★ 唯一开战接口的入参校验口径：船型注册表 + 等级解析（`data/ships.js` 转发 `data/ships/index.js`）、
//   模块注册表与模块等级上限。UI 的编队预检也调用本文件导出的 `normalizeFormation`（同一口径，不各自实现）。
import { MODULES } from '../data/modules.js';
// ★ 星区（战斗场景）数据的**缺省值登记处**（名称/储量缺省值只放 data/，引擎不硬编码数值）
import { SECTOR_DEFAULTS, hasSectorCdFx, sectorCdTicksFx } from '../data/sector.js';
// ★ 星区**货物（实体化）**：类型注册表/等级解析转发层 + 字段缺省值/钳制上限（引擎不硬编码货物数值）
import {
  CARGO_DEFAULTS,
  CARGO_LIMITS,
  cargoInstanceId,
  cargoMaxLevel,
  getCargo,
  resolveCargoAtLevel,
  // ★ 装载完成后的**固有装载时间**（tick）：一件货物装载成功后 `loadTicks` 被永久改写为它
  //   （数值唯一来源＝data 层常量，引擎不硬编码；见下方「货物装载」）
  CARGO_FAST_LOAD_TICKS,
  // ★ 玩家手动卸载后的「不被自动装载」时限（tick，600t＝30s；数值唯一来源＝data 层常量）
  CARGO_MANUAL_UNLOAD_TICKS,
} from '../data/cargo.js';
import { getShip, resolveShipAtLevel, shipMaxLevel } from '../data/ships.js';
import { moduleMaxLevel } from '../entities/module.js';
import {
  createShip,
  installModule,
  coeff,
  setCoeffMod,
  clearCoeffMod,
  setCoeffMulMod,
  clearCoeffMulMod,
  damageTakeMul,
  setDamageTakeMulMod,
  clearDamageTakeMulMod,
  // ★ 时间系的**唯一读口径/换算**都在 ship.js：`timeCoeffOf()`（单位时间系数）、
  //   `timeScaled(need, coeff)`（需求量整数化）；系数**来源读写**走 setTimeCoeffMod/clearTimeCoeffMod。
  setTimeCoeffMod,
  clearTimeCoeffMod,
  timeCoeffOf,
  timeScaled,
  // ★ 潜行（`type` 标签 `stealth`）的**唯一读口径** `isStealthed()` 与来源读写
  //   `setStealthMod/clearStealthMod` 都在 ship.js；引擎只做目标解析过滤，不复制判定逻辑。
  setStealthMod,
  clearStealthMod,
  isStealthed,
  clearAllSourceMods,
  recalcDerived,
  // ★ 自身【常驻静态加成】的唯一落地口径（增幅器类词条 hp_cap_bonus / energy_cap_bonus /
  //   energy_regen_bonus / X_coeff_add、以及护盾容量）：三围上限 = 基准 + Σ自身常驻 + Σ目标级叠加，
  //   类别系数加性写既有 coeffMods，统一在 ship.js `syncSelfStatics` 落地；
  //   战斗层只把 capOverlays 的聚合值传入（见 recomputeCap），不复制公式。
  syncSelfStatics,
  fillHullVitals,
  fillShieldPools,
  fillModuleShieldPool,
  syncShieldSummary,
  BASE_POOL_KEY,
  // ★ 货舱 / 矿物容量（自身常驻词条 `cargo_cap_bonus` / `ore_cap_bonus`）的**唯一口径**在 ship.js：
  //   `cargoCapacityOf/oreCapacityOf`（取整总量）、`cargoCapPartsOf/oreCapPartsOf`（本体/模块分解，UI 用）、
  //   `cargoLoadOf/oreLoadOf`（当前装载读数口径，M4 前恒 0）——战斗层只做**阵营合计**，不复制算式。
  cargoCapacityOf,
  oreCapacityOf,
  cargoCapPartsOf,
  oreCapPartsOf,
  cargoLoadOf,
  oreLoadOf,
  // ★ 已装载**货物实体**清单的只读口径（数值口径仍是 `cargoLoadOf`；装载体系见文件头「货物装载」）：
  //   每项＝星区货物实例本身（同一 id/同一对象）；清单增删的唯一写入者＝本文件货物链的四个落地点
  //   （装载完成 landCargoOn / 返还 returnCargoToSector / 传输 settleCargoTransfers / 维修消耗 settleCargoRepairs）；
  //   ★ **只有已入舱货物在本清单内**（在装货物仍在星区列表）⇒ 以它为数据源的功能天然看不到在装货物。
  cargoListOf,
} from '../entities/ship.js';

const TPS = 20; // 1 秒 = 20 tick

/** 召唤物继承召唤者系数时**必定覆盖的类别**（船型条目里另有的类别，如 `drone`，也会一并继承）。 */
const COEFF_CATEGORIES = ['attack', 'shield', 'function', 'transport', 'mining'];

/** 全队（阵营级）自动目标策略：顺序 / 最低血量 / 最低护盾 / 优先无人机 / 优先舰船（可扩展）。
 *  ship 级可用 ship.policy 覆盖（null=跟随全队）；该列表也作为 船舰主要目标 的策略选项。 */
export const TARGET_POLICIES = ['order', 'lowestHp', 'lowestShield', 'droneFirst', 'shipFirst'];

/** 按策略对存活目标排序：
 *  lowestHp / lowestShield 按数值升序；
 *  droneFirst / order（默认）→ 召唤(无人机)组视为"队首"，先于主力；
 *  shipFirst → 主力(舰船)先于召唤(无人机)。组内按阵列顺序。
 *  注：此处用于【目标选择队列】；渲染队列顺序与它无关（召唤物排在列尾显示）。 */
function orderedFoes(foes, policy) {
  const alive = foes.filter((f) => f.alive);
  if (policy === 'lowestHp') return alive.sort((a, b) => a.hull.hp - b.hull.hp);
  if (policy === 'lowestShield') return alive.sort((a, b) => a.hull.shield - b.hull.shield);
  const summoned = alive.filter((f) => f.isSummon);
  const mains = alive.filter((f) => !f.isSummon);
  if (policy === 'shipFirst') return [...mains, ...summoned];
  return [...summoned, ...mains]; // order / droneFirst
}

/** 单位类型名（多个同阵营同名单位时带 #序号 区分，如 战斗舰 #2） */
function typeName(ship) {
  const base = i18n.t(ship.nameKey);
  return (ship.sideSize || 1) > 1 ? `${base} #${ship.order || 1}` : base;
}

function nameForLog(ship) {
  const key = ship.side === 'ally' ? 'battle.unit.ally' : 'battle.unit.enemy';
  return i18n.t(key, { type: typeName(ship) });
}

/** 单位名着色段（敌方名红 / 我方名蓝，由渲染层包 span） */
function uTok(ship) {
  return { side: ship.side, label: nameForLog(ship) };
}

/** ★ **战报落库的唯一出口**（B-1）：把一行战报写到**当前实例**的战报缓冲；
 *  · `logSink` ＝**瞬时上下文指针**（**不是共享状态**）：由实例的公开入口在调用期间指向自己的写入口
 *    并**在返回时恢复原值**（单线程 + 栈式恢复 ⇒ 可重入安全；两个实例先后 step 互不串台）；
 *  · 无上下文（理论上不会发生：所有战报都产生在实例公开入口的调用栈内）⇒ 兜底走既有全局日志通道；
 *  · 实例侧写入口（`createBattle` 内 `sinkLine`）负责：**入本实例缓冲** ＋ 非“星域星区模式”时再写
 *    `core/log.js` 全局通道（＝战斗屏战报面板的既有数据源）。
 *  ★ 这样既保住了既有 UI 战报面板（零回归），又让**每个实例拥有自己的战报序列**（多星区容器/C-2 用）。 */
let logSink = null;
function writeLine(msg, rich) {
  if (logSink) logSink(msg, rich);
  else log.add(msg, 'battle', rich);
}

/** 战斗战报（channel=battle）：colorKeys 所列占位参数按着色单位名段替换 */
function battleLog(key, params, colorKeys) {
  const { msg, rich } = formatRich(key, params, colorKeys);
  writeLine(msg, rich);
}

/* ===== 命中成句（逐吸收段）辅助 =====
 * 每笔命中断言 = 表头动词句 + 逗号罗列的“对{承接者}造成 N 点{dtype}伤害”各吸收段。
 * 承接者：目标自身时长盾模块(绿)、舰载护盾(base 池)、共享同盟/共享防爆、舰体(hull)。
 * 伤害类型 {dtype}：取伤害来源模块 fx.type 里的命中伤害标签(projectile→动能 / beam→能量)，
 * 无已识别标签→普通；反射返程→反射。模块名一律渲染绿色。 */
const DTYPE_TAGS = ['projectile', 'beam', 'explosive']; // 命中伤害类型标签（i18n battle.dmgType.* 建映射，可扩展）

/** 解析伤害来源模块的命中伤害类型标签 → 返回 i18n key 后缀（reflect 由调用方显式给） */
function damageTypeTag(fx) {
  const tags = Array.isArray(fx && fx.type) ? fx.type : fx && fx.type ? [fx.type] : [];
  for (const t of DTYPE_TAGS) if (tags.includes(t)) return t;
  return 'normal';
}
/** 模块名绿色段 */
function modTok(inst) {
  return { label: i18n.t(inst.cfg.nameKey), mod: true };
}
/** 战报里的**小数数值段**（乘数/系数类）：取 3 位小数并去掉尾随 0（1.1 / 1.15 / 0.95；整数原样）。
 *  仅用于战报文案的数值呈现，**不参与任何计算**。 */
function fmtLogNum(v) {
  const n = Number(Number(v).toFixed(3));
  return String(n);
}
/** 一个吸收段 → 填入 {abs} 的值：自身护盾模块=绿段对象；舰载护盾/共享同盟/防爆/舰体=纯文本标签 */
function segAbs(s) {
  if (s.k === 'mod') return modTok(s.inst);
  return i18n.t('battle.abs.' + s.k); // base/alliance/blastproof/hull
}
/** 单位标签判定（供目标词条 exclude 排除；可扩展）：
 *  projectile = 召唤弹体类单位（火箭/导弹弹体，由召唤模块 summon.projectile 标记）。 */
function unitHasTag(u, tag) {
  if (!u) return false;
  if (tag === 'projectile') return !!u.isProjectile;
  return false;
}

/** 把 表头模板 + 逐吸收段模板 拼成一行并落日志（多段各自经 formatRich，再串联 msg/rich） */
function emitHitLog(headKey, headParams, seg, dtypeTag) {
  const dtype = i18n.t('battle.dmgType.' + dtypeTag);
  let msg = '';
  const rich = [];
  const append = (key, params, colorKeys) => {
    const r = formatRich(key, params, colorKeys);
    msg += r.msg;
    rich.push(...r.rich);
  };
  append(headKey, headParams, ['actor', 'target', 'attacker', 'owner']); // 单位红/蓝、模块(mod)恒绿
  for (const s of seg || []) {
    if (!(s && s.amount > 0)) continue;
    append('battle.log.hit.absorb', { abs: segAbs(s), amount: Math.round(s.amount), dtype }, []);
  }
  if (msg) writeLine(msg, rich); // ★ B-1：经统一出口（实例缓冲 + 非星域模式下再写全局通道）
}

/** 目标当前是否处于"无敌"：自身有某模块正处于激活的持续期内且其 effects.type 含 invincible。
 * 无敌 = 免疫一切经伤害结算（applyHit/旧 damageShip）的伤害（普通 + 爆炸波及）；
 * 自毁(self_destruct)为直接扣血，无法免疫。 */
function invincibleNow(target) {
  if (!target || !Array.isArray(target.modules)) return false;
  for (const inst of target.modules) {
    if (!inst || !(inst.durationLeft > 0)) continue;
    const cfg = inst.cfg && inst.cfg.effects;
    const t = (cfg && cfg.type) || [];
    if (Array.isArray(t) && t.includes('invincible')) return true;
  }
  return false;
}

/* ---------- 护盾独立池 + 同盟/防爆共享吸收支持 ----------
 * 承伤统一在各“护盾池”（见 ship.js 头部说明）上进行，本区 helpers 只改池值与闪标，
 * 不直接写 hull.shield（汇总由 syncShieldSummary 每次刷新）。
 *  - 自身吸收：目标自己的池按 时长型护盾模块池(激活序，先激活先用)→长期/本体池(最低优先级) 逐个扣减；
 *    普通伤害跳过防爆池（绝不能吃防爆池）；爆炸伤害可再吃防爆模块池。
 *  - 共享吸收：目标自身可吸池耗尽、伤害将扣血时，由友方各“共享模块池”
 *    (type alliance/blastproof) 按激活顺序代吸；爆炸伤防爆池优先。
 * 每 tick 由 createBattle.step 更新为当前双方编队；承伤时据此在“目标所属友方阵营”内找共享池。
 */
/* ★ **B-1（可实例化）**：本区 helper **不再读任何模块级“当前阵营引用”** —— 目标所属阵营的当前编队由
 *   调用方（**实例内部的 `applyHit`**）**显式传入**：`allies`/`enemies` ＝**该战斗实例自己的**单位列表
 *   ⇒ 多个 battle 实例各自 `step()` 时**零共享状态**、互不干扰（实例化前的 `activeAllies/activeEnemies`
 *   两个**模块级可变变量已删除**：它们曾是唯一的“跨实例串台”来源）。
 *   （`absorbByAlliance` / `drainBlastproof` 因此各多出 `allies, enemies` 两个参数；引擎行为一字不变。） */
const teamOf = (s, allies, enemies) => (s.side === 'ally' ? allies : enemies);
const isType = (fx, k) => Array.isArray(fx && fx.type) && fx.type.includes(k);

/* ---------- ★「不可停用」标签（`type` 含 `undeactivatable`）----------
 * 语义：带该标签的模块**不能被停用**——引擎侧一律**拒绝**停用请求（模块恒保持启用、不产生任何侧效/战报），
 *      UI 侧只做**呈现**（开关灰显 + 悬停说明），故任何来源（UI、控制台调试、将来脚本/关卡）都无法绕过。
 * 识别方式：**按标签**（与 `passive`/`solo`/`stealth` 同一体例），**不按模块 id 硬编码**。 */
const TAG_UNDEACTIVATABLE = 'undeactivatable';
const isUndeactivatable = (inst) =>
  !!(inst && inst.cfg && isType(inst.cfg.effects, TAG_UNDEACTIVATABLE));

/** 目标“自己的护盾池”按【使用顺序】列表：
 *  - 时长型护盾模块池：按激活顺序(_shieldSeq 先激活先使用)；allowBp=false 时跳过防爆池（普通伤害不碰防爆）；
 *  - 长期/本体池(并入常驻模块)排最末（最低优先级）。
 *  仅列出值>0 的池。 */
function ownShieldPools(target, allowBp) {
  const pools = target && target.hull && target.hull.pools;
  if (!(pools instanceof Map)) return [];
  const list = [];
  for (const inst of target.modules || []) {
    const p = pools.get(inst.id);
    if (!p || p.cap <= 0 || p.value <= 0) continue;
    if (!allowBp && p.blastproof) continue;
    list.push(p);
  }
  list.sort((a, b) => (a.inst._shieldSeq || 0) - (b.inst._shieldSeq || 0)); // 先激活先使用
  const base = pools.get('base');
  if (base && base.cap > 0 && base.value > 0) list.push(base); // 长期(本体)池：最低优先级、最后用
  return list;
}

/** 目标自身池吸收 amount：按 时长型护盾池(激活序，先激活先用)→长期(本体)池 的顺序扣减并刷新汇总。
 *  blast=true 时防爆模块池也可吸（爆炸伤；通常防爆池已在防爆拦截阶段优先被消耗）。
 *  返回 { rest: 剩余量, takes: [{pool, take}] }，takes 供反射核算。 */
function absorbOwnPools(target, amount, blast) {
  const zero = { rest: amount, takes: [] };
  if (amount <= 0 || !target) return zero;
  let rest = amount;
  const takes = [];
  for (const p of ownShieldPools(target, blast)) {
    if (rest <= 0) break;
    const take = Math.min(p.value, rest);
    p.value -= take;
    rest -= take;
    takes.push({ pool: p, take });
  }
  syncShieldSummary(target); // 汇总刷新（hull.shield = Σ 池值）
  return { rest, takes };
}

/** 目标盾量增减（正=补盾、负=汲取），直接作用到“池”，顺序同吸收（本体长期池先→时长护盾池），
 *  各自封顶自身 cap。补盾可把“共享池/防爆池”（施放者自己的时长模块池）一并补满——
 *  与旧“总量向总上限回满”观感一致；汲取也可打到防爆池（旧聚合语义即如此，汲取不走 blastFloor）。
 *  返回实际增减量（正=增加）。 */
function poolShieldAdd(target, amt) {
  const pools = target && target.hull && target.hull.pools;
  if (!(pools instanceof Map) || amt === 0) return 0;
  const order = [];
  const base = pools.get('base');
  if (base && base.cap > 0) order.push(base);
  for (const inst of target.modules || []) {
    const p = pools.get(inst.id);
    if (p && p.cap > 0) order.push(p);
  }
  let left = amt;
  if (left > 0) {
    for (const p of order) {
      if (left <= 0) break;
      const room = p.cap - p.value;
      if (room <= 0) continue;
      const add = Math.min(room, left);
      p.value += add;
      left -= add;
    }
  } else {
    for (const p of order) {
      if (left >= 0) break;
      const take = Math.min(p.value, -left);
      p.value -= take;
      left += take;
    }
  }
  syncShieldSummary(target);
  return amt - left; // 实际作用量（正=实际补入，负=实际汲取）
}

/** 友方共享吸收：target(某友方单位) 自身池耗尽、伤害将扣血时，由友方各同盟/防爆共享模块池
 *  (施放者池) 代吸。blast=true 时(爆炸型伤害)：防爆池先吸、随后同盟池；否则只允许非防爆的同盟池。
 *  施放者池被吸收时其护盾条相应闪标（同盟深蓝 _allyFlash、防爆橙 _bpFlash）。
 *  返回 { rest: 仍未吸收量, bpAbsorbed: 进入防爆池的量 }。 */
function absorbByAlliance(target, amount, blast, allies, enemies) {
  const zero = { rest: amount, bpAbsorbed: 0 };
  if (amount <= 0) return zero;
  const cands = [];
  for (const O of teamOf(target, allies, enemies)) {
    if (!O || !O.alive) continue;
    for (const p of O.hull.pools.values()) {
      if (!p.inst) continue; // 本体池不参与共享
      const isAl = p.alliance;
      const isBp = p.blastproof;
      if (!isAl && !isBp) continue;
      if (isBp && !blast) continue; // 防爆池只吸爆炸型伤害
      if (p.value <= 0) continue;
      cands.push({ O, p, seq: p.inst._shieldSeq || 0, bp: isBp });
    }
  }
  // 排序：爆炸伤 → 防爆池(isBp)先，再普通同盟池；普通伤 → 仅同盟池。同型按释放顺序。
  cands.sort((a, b) => {
    if (a.bp !== b.bp) return a.bp ? -1 : 1;
    return a.seq - b.seq;
  });
  let rest = amount;
  let bpAbsorbed = 0;
  const touched = new Set();
  const spentOwners = new Set();
  for (const c of cands) {
    if (rest <= 0) break;
    const take = Math.min(c.p.value, rest);
    c.p.value -= take;
    touched.add(c.O);
    if (noBreakPoolSpent(c.O, c.p)) spentOwners.add(c.O); // no_break 共享池被抽空 → 标耗尽
    if (c.bp) {
      c.O._bpFlash = 40;   // 防爆层被吸收：护盾条橙色闪烁标记（≈2s）
      bpAbsorbed += take;
    } else {
      c.O._allyFlash = 40; // 同盟层被吸收：护盾条深蓝闪烁标记（≈2s）
    }
    rest -= take;
  }
  for (const O of touched) syncShieldSummary(O); // 被吸方汇总刷新
  for (const O of spentOwners) recalcDerived(O); // 已耗尽 no_break 池移除、cap 回落（recalc 亦刷新汇总）
  return { rest, bpAbsorbed };
}

/** 共享吸收把某施放者 O 的“no_break 时长护盾池”抽空(value≤0) → 标其 _shieldSpent(不再贡献 cap/池)。
 *  因共享池常由"队友承伤"抽干(不经过 O 自身的 breakShieldOnDepletion)，此处单独兜底。
 *  返回 true 表示该 O 需随后 recalcDerived 以落地 cap 回落。 */
function noBreakPoolSpent(O, pool) {
  if (!O || !O.alive || !pool || pool.value > 1e-6) return false;
  const inst = pool.inst;
  if (!inst || inst._shieldSpent) return false;
  const fx = inst.cfg && inst.cfg.effects;
  if (!fx || (fx.duration_ticks || 0) <= 0 || (fx.shield_cap_bonus || 0) <= 0) return false;
  if (!isType(fx, 'no_break')) return false;
  inst._shieldSpent = true; // 不动持续/冷却/日志，仅停贡献
  return true;
}

/** 防爆拦截（仅爆炸型伤害）：目标受防爆护盾保护时，先用友方防爆池抵挡本伤害（即使目标自带护盾），
 *  让爆炸不对主要目标造成伤害。池按“释放顺序”逐池扣减并置施放者橙色闪标。
 *  返回 { rest: 剩余量, drained: 进入防爆池的量 }。 */
function drainBlastproof(target, amount, allies, enemies) {
  if (amount <= 0) return { rest: amount, drained: 0 };
  const cands = [];
  for (const O of teamOf(target, allies, enemies)) {
    if (!O || !O.alive) continue;
    for (const p of O.hull.pools.values()) {
      if (!p.inst || !p.blastproof || p.value <= 0) continue;
      cands.push({ O, p, seq: p.inst._shieldSeq || 0 });
    }
  }
  cands.sort((a, b) => a.seq - b.seq);
  let rest = amount;
  let drained = 0;
  const touched = new Set();
  const spentOwners = new Set();
  for (const c of cands) {
    if (rest <= 0) break;
    const take = Math.min(c.p.value, rest);
    c.p.value -= take;
    touched.add(c.O);
    if (noBreakPoolSpent(c.O, c.p)) spentOwners.add(c.O); // no_break 防爆池被抽空 → 标耗尽
    c.O._bpFlash = 40; // 防爆层被拦截：护盾条橙色闪烁标记（≈2s）
    drained += take;
    rest -= take;
  }
  for (const O of touched) syncShieldSummary(O); // 被吸方汇总刷新
  for (const O of spentOwners) recalcDerived(O); // 已耗尽 no_break 池移除、cap 回落（recalc 亦刷新汇总）
  return { rest, drained };
}

/**
 * 创建一场战斗（★ **B-1：可实例化** —— 每次调用得到**一个完全独立的实例**）。
 * @param {{ally: [{type, modules}], enemy: [{type, modules}],
 *          sector?: {name, oreReserve, cargos?}}} preset
 *        双方编队配置 + 星区（战斗场景）数据（缺省按 `data/sector.js SECTOR_DEFAULTS` /
 *        `data/cargo.js` 兜底并钳制；`cargos` ＝星区货物设定项数组，见 `normalizeSectorCargos`）
 * @param {{starfield?: boolean}} [opts] ★ **B-2 星域容器专用选项**（缺省一律 `false` ⇒ **既有单星区玩法零变化**）：
 *   `opts.starfield = true` ⇒ **「星域星区模式」**（该实例由 `systems/starfield.js` 容器驱动），三个效果：
 *     ① **不订阅全局 ticker、不发全局事件**（`start()` 里的 `bus.on('tick')` / `combat:state` 一律跳过；
 *        由容器按固定顺序调用实例的 `step()`）；
 *     ② **不写全局战报通道**（`core/log.js`）：战报只进**本实例自己的** `battle.log` 缓冲；
 *     ③ **不执行“一方全灭 ⇒ 结束”判定** —— `checkEnd()` **代码保留但不再被调用**（设计文档 §8：
 *        “保留但不执行”；星区无单位时**静默空转、仍走 tick**）。
 * ★ 实例内部状态**互不共享**：单位列表 / 模块实例 / 星区储量与冷却 / 货物与队列 / `__pending` /
 *   战报缓冲 `battle.log` / tick 计数 `runTicks` 等**全部为本次调用的闭包私有变量**；
 *   模块级仅保留**只读常量表**（`TPS`/`COEFF_CATEGORIES`/`DTYPE_TAGS`/`TARGET_POLICIES`/`AMOUNT` 等）。
 */
export function createBattle(preset, opts) {
  /* ★ B-1：实例私有**战报缓冲**（`battle.log` 只读口径的来源）＋“星域星区模式”开关 */
  const starfieldMode = !!(opts && opts.starfield);
  /* ★★ **召唤上限的「星域范围」计数注入点**（星域容器专用；缺省 `null` ⇒ **既有“本实例计数”口径逐字不变**）：
   *   `(side, moduleId) => number` —— 由容器返回**整个星域**中该阵营 `alive && summonMod === moduleId` 的单位数。
   *   ★ **为什么必须跨星区**：**召唤物不随单位迁移**（用户口径）⇒ 单位迁走后，**留在源星区的召唤物
   *     仍必须继续占用该召唤模块的上限**；若仍按“本实例”计数，新星区里计数为 0 ⇒ 迁移后会**重复召唤**
   *     （用户实测 bug：新星区多出一只、源区那只还在）。
   *   ★ 只读、无副作用；非星域玩法（战斗屏 / `LS.drill()`）**根本不注入** ⇒ 走原分支，零回归。 */
  const summonCountOf = typeof (opts && opts.summonCountOf) === 'function' ? opts.summonCountOf : null;
  const LOG_MAX = 1000; // 环形上限（与 `core/log.js` 的 500 条同体例；防止长时间星域运行内存无界）
  const logEntries = [];
  let logTotal = 0; // ★ 累计写入条数（**单调递增、不受环形上限影响**）⇒ 供容器/UI 判定“本 tick 有无新战报”
  const allies = [];
  const enemies = [];
  /** ★ 本实例的**战报写入口**（模块级 `logSink` 指向它，见 `writeLine`）：
   *  · 先入**本实例**缓冲（`battle.log` 只读口径的来源）；环形上限 `LOG_MAX` 条；
   *  · 再按模式决定是否写 `core/log.js` **全局通道**（既有战斗屏战报面板的数据源）——
   *    **星域星区模式**下只进本实例 ⇒ 多星区不互相污染、不刷屏（C-2 侧栏按区读 `battle.log`）。
   *  ★ 行对象 `Object.freeze`（只读口径 ⇒ 外部改不到引擎内部状态，体例同 `battle.sector`）。 */
  function sinkLine(msg, rich) {
    const entry = Object.freeze({ tick: runTicks, msg, rich: rich ? Object.freeze(rich.slice()) : null });
    logEntries.push(entry);
    logTotal += 1;
    if (logEntries.length > LOG_MAX) logEntries.shift();
    if (!starfieldMode) log.add(msg, 'battle', rich);
  }
  /** 公开入口统一包一层：调用期间把战报出口指向本实例，**退出时恢复原值**
   *  （单线程 + 栈式恢复 ⇒ 可重入安全；两个实例先后/嵌套调用都互不串台）。 */
  function withSink(fn) {
    const prev = logSink;
    logSink = sinkLine;
    try {
      return fn();
    } finally {
      logSink = prev;
    }
  }
  /* ---------- 星区（战斗场景）：名称 + 矿物储量 ----------
   * · `sectorName`      用户自定义名称（UI/战报**原样显示、不做 i18n**；空串＝不显示名称前缀）
   * · `oreReserve`      当前**剩余**矿物储量（初值＝`oreReserveInit`，开采扣减、阵亡返还）
   * · `oreReserveInit`  **初始**储量（只读快照，供 UI「剩余/初始」显示）
   * ★ 读取口径：`battle.sector`（只读快照，见下方 return）；**UI 不计算储量**，只读它。
   * ★ 守恒（**仅对“采矿/阵亡返还”这一对**）：扣减＝本 tick **实际入库**总量；返还＝单位阵亡时携带的
   *    矿物（不设上限）⇒ 二者相抵，矿物不会因同 tick 阵亡丢失。
   *   ⚠ **星区储量没有上限**（用户口径）：星区词条（`sector_ore_add` / `sector_ore_mul`，结算步骤 3c）
   *     可把剩余储量推到**高于初始储量**（`oreReserveInit` 仍是初始快照、不随之变化）
   *     ⇒ 因此**不存在“剩余 ≤ 初始”这一不变量**（星区资源栏的条幅按 100% 封顶，仅显示层处理）。 */
  const sectorInit = normalizeSector(preset && preset.sector);
  const sectorName = sectorInit.name;
  const oreReserveInit = sectorInit.oreReserve;
  let oreReserve = oreReserveInit;
  /* ---------- ★ 星区「货物（实体化）」与**优先队列**（纯星区侧状态）----------
   * ★ 用户确认口径：货物是**独立实体**（不是数值累积），带**唯一稳定 id**（`cargo-<顺序号>`）；
   *   · `cargos`     货物实体快照（字段＝**等级解析后的值**；只读口径每次返回**新数组 + 新对象**）——
   *     字段含 `templateId`（类型 id）/ `type` / `colorKey`（类型色＝CSS 变量名）/
   *     `tons` / `loadTicks` / `level` / `bonus`（后三者＝**该等级解析后的值**，解析在
   *     `normalizeSectorCargos` 里**只做一次**；唯一解析口径＝`data/cargos/index.js resolveCargoAtLevel`）；
   *     ★ 例外：`loadTicks` 会被**装载体系**在装载完成时**永久改写**为 `CARGO_FAST_LOAD_TICKS`（20t），
   *       其余字段在开战后恒不变（装载只搬移实体、不改字段）；
   *   · `cargoQueue` **优先队列**＝**有序 id 列表**（队首＝最高优先级），点击入队＝追加队尾、再次点击＝出队；
   *  ★ **不参与任何战斗数值结算**：不写护盾/血量/能量/系数、**不占用 `__pending` 的数值类意图**
   *    （装载只记结构类意图 `cargoLoadOps`，且全部在结算阶段落地）⇒ **Pass1 零数值变化**；
   *  ★ 已实现范围＝「实体与字段（一货一文件 + 等级解析）+ 星区货物栏显示 + 队列切换
   *    ＋ **装载体系（装载光束：锁定 / 时长 / 入舱 / 返还）**」——**运载/卸货等后续环节仍留待后续轮**；
   *  ★ 唯一接口＝`battle.toggleCargoQueue(id)`（队列切换，锁定中拒绝）、
   *    `battle.unloadCargo(shipId, cargoId)`（已装货物返还星区）；只读口径＝`battle.sector`
   *    （`{…, cargos（含 queued/queueIndex/locked/lockedBy/loadProgressTicks/loadNeedTicks）, cargoQueue}`）
   *    ＋单位侧 `ship.js cargoListOf(ship)`/`cargoLoadOf(ship)`——**UI 只读、绝不自算**。 */
  const cargos = sectorInit.cargos.map((c) => ({ ...c }));
  const cargoQueue = []; // 有序 id 列表（队首＝最高优先级）
  /* ---------- ★ 星区货物**列表顺序＝队列式（前出后入）** + **id 自增计数器** ----------
   * · **列表顺序口径（用户口径）**：`cargos` 数组**就是队列** ——
   *     ① **编队定义**的货物按**定义顺序**入列（开战时的初始顺序＝定义顺序，`normalizeSectorCargos` 已如此）；
   *     ② **装载（入舱）**＝从列表中**移除**该项 ⇒ 其余项**整体前移**（`splice`，序号自然连续）；
   *     ③ **返还星区 / 卸载**＝**追加到列表末尾 `push`**（`appendCargoToSector`）——
   *        **不再**按 `cargo-<序号>` 插回“原位置”，即**不恢复初始顺序**（用户明确要求）；
   *     ④ 列表**长度不限**（编队定义阶段与运行时都不封顶；见 `data/cargo.js CARGO_LIMITS` 的说明）。
   *     ⑤ ★ **与「优先队列」的区别（两个不同概念，勿混同）**：`cargoQueue`＝**玩家点击选出的
   *        装载优先级**（`queueIndex` 序号即由它派生，逐条前移 ⇒ 序号连续）；而**列表顺序**＝
   *        队列式排列（视觉顺序、以及“未入队者”的默认装载先后）。二者互不改写对方。
   * · **id 生成（唯一且不复用）**：编队定义阶段的 id 由 `normalizeSectorCargos` 按位置生成
   *    （`cargo-1..cargo-N`，确定性、可复现）；**运行时**再需要新 id 时一律走 `nextCargoId()`
   *    —— **自增计数器**（种子＝现有列表里最大的序号 ⇒ 与定义序号**不冲突**），**单调递增、绝不回收**
   *    ⇒ 已装载/已销毁的编号**永不复用**（货物实体在整场战斗中的身份唯一）。**不用随机数/时间戳**。 */
  let cargoSeq = cargos.reduce((mx, c) => {
    const m = /(\d+)\s*$/.exec(String(c.id || ''));
    return m ? Math.max(mx, parseInt(m[1], 10)) : mx;
  }, 0);
  /** 取下一个**运行时货物 id**（`cargo-<n>`，自增、不复用；唯一 id 口径＝`data/cargo.js cargoInstanceId`）。 */
  function nextCargoId() {
    cargoSeq += 1;
    return cargoInstanceId(cargoSeq);
  }
  /* ---------- ★ 星区货物**装载**（运输类 `loadingBeam` —— 标签 `cargo_loader` 驱动）----------
   * ★ 与既有“星区侧纯状态”口径的关系（**本轮唯一的口径扩展**）：
   *   · `cargos` 里的每件货物**仍是同一批实体对象**（`id` 恒定）—— 装载**不复制、不重建**，
   *     而是把该对象**从星区列表搬进单位清单**（`ship.cargos`）后再搬回来（返还），
   *     故“同一件货物”的身份、等级、加成**全程不变**（`loadTicks` 会在装载完成时**永久改写**）；
   *   · 仍**不写任何单位数值**（`hull.cargo` 只在结算步骤 5 由唯一写入者改）⇒ **Pass1 零数值变化**。
   * ★ 三个结构标记（全部属**引擎内部**、不进只读快照）：
   *   · `inst._load = { cargo, elapsed, need, startedTick }`｜undefined —— **该模块实例在装的货物**
   *     （**同一实例同一时刻至多 1 件**；非空＝“忙”，装载期间不再激活、不再扣能量）；
   *   · `cargo._loadBy = { ship, inst }`｜undefined —— 货物的**锁定**索引（谁锁着它），
   *     与 `inst._load` **同源同写**（`inst._load` 是权威记录，本字段仅供 O(1) 查询“这件被锁了吗”）；
   *   · `loadClaimedTick` —— **本 tick 已被认领的货物 id 集合**（Pass1 记账、**非数值**；
   *     与星区冷却的 `sectorClaimedTick` **完全同体例**）：同一 tick 内第二个装载器不再抢同一件。
   * ★ 只在**结算阶段**落地（见文件头「货物装载」与结算步骤 5）：Pass1 只记 `__pending.cargoLoadOps`。
   * ★ **装载对象的选取顺序（唯一口径 `pickLoadableCargo`）**：① **优先队列**队首最先 → ② 其余按
   *   **星区列表顺序**；逐件排除：已被锁定 / **玩家手动卸载（本阵营、未到期）** / 本 tick 已被认领 /
   *   本舰装不下。
   * ★ **玩家手动卸载的排除口径（唯一实现＝`cargoManualUnloadActive` + 本函数的排除链）**：
   *   玩家在详情页点芯片返还星区 ⇒ `unloadCargo(…, manual=true)` 记「**分阵营 + 带时限**」标记：
   *   `manualUnloadedSide`＝**卸载者所属阵营**（`'ally'`/`'enemy'`，与单位 `side` 同一套词、不另造口径）、
   *   `manualUnloadedUntil`＝**绝对到期 tick**（＝卸载时的 `runTicks + CARGO_MANUAL_UNLOAD_TICKS`，
   *     600t＝30s，**数值唯一来源**＝data 层常量）。在本函数内：**仅当**该件的标记阵营与此处装载器的
   *   阵营**相同**（`c.manualUnloadedSide === ship.side`）**且未到期**（`runTicks < until`）时跳过 ⇒
   *     · **敌对方装载器不受影响**：标记阵营不同 ⇒ 照常自动装载（这正是“分阵营”的目的）；
   *     · **到期自动失效**：绝对到期 tick 模型，无逐 tick 递减 ⇒ 确定、可复现、镜像对等；
   *     · **玩家把它加入优先队列即立即清除标记**（`toggleCargoQueue`）⇒ 显式意图永远优先。
   *   **为什么必须有这条**：装载光束**无自身冷却**（忙/闲判据＝是否正在装载），返还后的货物立刻又满足
   *   “在星区、未锁定、未认领” ⇒ 下一 tick 就会被装回去，而 `loadTicks` 已被永久改写为 fast-load
   *   （20t≈1s）⇒ 玩家“点击卸载”几乎看不到效果。阵亡**全额返还不置标记**（那不是玩家意图）。 */
  const loadClaimedTick = new Set(); // 本 tick 已被装载器认领的货物 id（每 tick 起始清空）
  const loadClaims = [];             // 本 tick 的**装载认领申请**（Stage A 登记 → 裁决后清空；Pass1 记账、非数值）
  /* ---------- ★ 星区侧「模块冷却」（**独立词条 `sector_cd_ticks`** 驱动，与模块 id 解耦）----------
   * ★ 用户确认口径：模块要生效必须**同时**满足
   *     ① 模块实例自身冷却已就绪（`cooldown_ticks`，与普通模块完全一致，走既有 `inst.cooldown`）；
   *     ② **星区侧该模块的冷却已结束**（星区**只接受一次触发**）——参与判据＝**模块是否带词条
   *        `sector_cd_ticks`**（**按词条识别、不硬编码模块 id**，识别口径唯一实现在
   *        `data/sector.js hasSectorCdFx`；引擎薄封装 `hasSectorCd`/`sectorCdTicksOf`），
   *        时长＝**该词条值**（不再取 `cooldown_ticks`）。
   *   两把冷却互相独立、各自计时；**同词条的多个模块在星区上的冷却也各自独立**（key ＝ 模块 id）。
   * ★ 数据结构＝`sectorCdUntil: Map<模块id, 到期 tick>`（**绝对到期 tick 模型**）：
   *     · 就绪判据 `runTicks >= until`；剩余 `max(0, until − runTicks)`；
   *     · **没有逐 tick 递减**（故不存在“递减落在 Pass1 还是结算”的顺序问题，也**不会逐 tick 抖动**）；
   *     · 到期 tick 在**结算步骤 3c** 写入，取值＝`timeScaled(sector_cd_ticks, tickTimeCoeff(ship))`
   *       —— 与同一实例自身冷却的 `startCooldown`（取 `cooldown_ticks`）**完全同算法**
   *       ⇒ 两个词条取同值时，对**被接受的那个单位**而言两把冷却**在同 tick 到期**
   *       （星区冷却只额外约束**其它**单位）；
   *     · `runTicks` 在 `step()` 起始 +1、全 tick 恒定（Pass1 / 结算 / 战报后 UI 读数同值）⇒
   *       门控与 UI 读数**同口径**、与遍历顺序无关、双方镜像对等。
   * ★ `sectorClaimedTick`＝**本 tick**已被星区接受的模块 id 集合（Pass1 记账，**零数值变化**）：
   *    同一 tick 多个单位携带同一模块时，按固定结算顺序（我方→敌方）**只接受第一个**，
   *    其余单位本 tick 不激活（不耗能、不进冷却）；`step()` 起始清空。 */
  const sectorCdUntil = new Map(); // 模块 id -> 到期 tick（含）；无记录＝就绪
  const sectorClaimedTick = new Set(); // 本 tick 已被星区接受的模块 id（Pass1 记账，每 tick 起始清空）
  let phase = 'idle'; // idle | running | settled
  let result = null;
  let tickOff = null;
  let runTicks = 0; // 战斗已进行的 tick 数（running 起计）
  const seqCount = { ally: 0, enemy: 0 }; // 各阵营"出场序号"分配器：编号由出场顺序决定、不随队列变化
  let shieldSeq = 0; // 护盾模块"激活顺序"分配器（时长型护盾激活即递增，先激活先使用）
  let reflectQueue = []; // 本 tick 反射返程记账：{ owner, attacker, mod, amount }，待"武器/爆炸命中全部结算完"后统一补打回并成句

  /* ---------- 死亡计数（"回收利用" 等按阵亡数结算的词条用）----------
   * ★ 口径：**全场（双方合计）**、**排除召唤/临时单位**（判据 `summonMod || isSummon`，与
   *   `soloConditionHolds` 的"召唤物不计入"完全同判据、不新造字段）、**按上一 tick 结算**。
   * ★ "上一 tick"语义（沿用既有"上一 tick 快照"范式，如 `_takeMulTick`/`_timeCoeffTick`）：
   *   - 判死发生在结算阶段（Phase 4c/4d/4e/B/B2）→ 各判死点经唯一出口 `onDeath()` 累加 `deathsThisTick`；
   *   - **tick 收尾**（Phase C 之后）把 `deathsThisTick` 提交为 `lastTickDeaths` 再清零；
   *   - Pass1 只读 `lastTickDeaths`（本 tick 内恒定）→ **同一 tick 内没有任何"死→回血"反馈环**，
   *     与遍历顺序无关、双方镜像对等；本 tick 新发生的死亡要等到**下一 tick** 才计入。 */
  let deathsThisTick = 0; // 本 tick 已判死的"非召唤"单位数（结算阶段累加，tick 收尾提交）
  let lastTickDeaths = 0; // **上一 tick** 的死亡数（Pass1 唯一读口径；tick 收尾赋值）

  /** 开战/召唤即满盾就位：把单位“自带持续护盾”（时长型护盾模块，duration_ticks>0 且
   *  shield_cap_bonus>0）视为已在首个可行动 tick 就位满盾——按 spawnList/doSummon 已用的
   *  fillShieldPools/满盾逻辑，把该模块池补满。复用机制，不逐 tick 白送盾（仅登场一次）。
   *  实现：令该模块进入持续期（生池）并只把其自身池补满到 cap（本体/其它模块池保持现值），
   *  记激活序 _shieldSeq。 */
  function seedSpawnShields(ship) {
    if (!ship || !ship.alive) return ship;
    for (const inst of ship.modules || []) {
      if (!inst.enabled) continue;
      const fx = inst.cfg && inst.cfg.effects;
      if (!fx) continue;
      if (!((fx.duration_ticks || 0) > 0 && (fx.shield_cap_bonus || 0) > 0)) continue; // 仅持续护盾
      if (inst.durationLeft > 0) continue; // 已在持续期
      startDuration(inst, timeCoeffOf(ship)); // 进入持续期：需求量按当前时间系数整数化、已推进归 0
      clearCooldown(inst);
      inst._shieldSpent = false; // 首次激活/重新激活：确保不残留"已耗尽"标记
      recalcDerived(ship);              // 生成该模块的护盾池（空池）
      fillModuleShieldPool(ship, inst); // ★ 只把该模块自身池补满到 cap
      inst._shieldSeq = ++shieldSeq;    // 记录激活顺序（先激活先使用）
    }
    syncShieldSummary(ship);
    return ship;
  }

  function spawnList(arr, side, list) {
    for (const cfg of list) {
      // ★ 船型等级 + 单位定位：编队 cfg 可带 `level`（缺省 1）与 `role`（'combat'|'logistics'，缺省用船型默认）
      //   （唯一口径 `data/ships/index.js resolveShipAtLevel`，见 entities/ship.js createShip）。
      const ship = createShip(cfg.type, side, cfg.role ? { role: cfg.role } : null, cfg.level || 1);
      for (const mod of cfg.modules) {
        // 支持字符串 id（level=1）或规格对象 { moduleId/id, level }
        const spec = mod && typeof mod === 'object' ? mod : { moduleId: mod };
        installModule(ship, spec.moduleId ?? spec.id, spec.level ?? 1);
      }
      // 开战满盾：把各护盾池（本体池 + 当前贡献模块池）补满到各自 cap；
      // 汇总后 hull.shield = shieldCap（与旧“满盾登场”观感一致；时长型模块持续期外无池）
      fillShieldPools(ship);
      fillHullVitals(ship); // 满血/满能量登场（与满盾同体例；本体三围已含自身常驻加成）
      seedSpawnShields(ship); // 自带持续护盾首 tick 即满盾就位
      seqCount[side] += 1;
      ship.order = seqCount[side]; // 出场序号（#编号），稳定不随队列/移除变化
      arr.push(ship);
    }
  }

  // 单位在创建战斗时即生成完毕（UI 可在 start() 前据此渲染实体框）
  spawnList(allies, 'ally', preset.ally || []);
  spawnList(enemies, 'enemy', preset.enemy || []);
  for (const s of allies) s.sideSize = allies.length;
  for (const s of enemies) s.sideSize = enemies.length;

  /* ---------- 召唤 / 临时单位支持 ---------- */
  const sidesOf = (side) => (side === 'ally' ? allies : enemies);
  /** 该阵营当前存活的某种单位数量（用于"最大召唤数"判定） */
  function countLiveOfType(side, typeId) {
    let n = 0;
    for (const u of sidesOf(side)) if (u.alive && u.typeId === typeId) n += 1;
    return n;
  }
  /** 该阵营人数变化后同步各单位的 sideSize（仅决定是否显示 # 前缀），不改动出场序号 */
  function refreshSideSize(side) {
    const arr = sidesOf(side);
    for (const u of arr) u.sideSize = arr.length;
  }
  /** 生成一个召唤单位并入阵营（overrides 覆写模板），排在该阵营队列【列尾】显示；
   * 目标队列顺序由 orderedFoes 另行处理（召唤物视为队首）。
   * 出场序号由 seqCount 统一分配、稳定不随队列/移除变化。
   * temp=true → 临时单位：受存在时间(lifespan)约束，到期自动死亡；阵亡/到期后直接移出场景。
   * temp=false → 普通单位：不设存在时间，持续作战至死亡（阵亡后保留灰色卡片）。 */
  function spawnSummoned(typeId, side, overrides, temp) {
    const s = createShip(typeId, side, overrides || null);
    s.isSummon = true;           // 召唤单位标记（目标队列视为队首；渲染仍排在列尾）
    s.temp = !!temp;             // 是否为临时单位（由召唤配置决定）
    if (s.temp) {
      // 剩余存在 tick / 基础需求量 / 已推进 tick 数（仅临时单位使用；真正起点由 doSummon 的 startLife 写入）
      s.tempLeft = 0;
      s.tempLifeNeed = 0;
      s.tempLifeElapsed = 0;
    }
    seqCount[side] += 1;
    s.order = seqCount[side];    // #编号由出场顺序决定（整队统一递增）
    sidesOf(side).push(s);       // 排在列尾（显示在主力之后）；目标顺序由 orderedFoes 另行处理
    refreshSideSize(side);
    return s;
  }
  /** 把临时单位移出场景，并清理其各模块对本场其它单位施加的影响 */
  function removeSummoned(side, u) {
    for (const inst of u.modules) {
      if (inst.durationLeft > 0) endDuration(inst); // 移出场景：结束持续期（剩余/已推进一并归 0）
      releaseCargoLoad(inst); // 移出场景 ⇒ 解除其在装货物的锁定（与其在各判死点的清理口径一致；幂等）
      dropSourceMods(inst);
      clearAllSourceMods(u, inst.id); // 移出场景 → 回退其施放方自身获得的修饰（系数加/乘 + 受伤减免）
      releaseCoeffRefs(inst); // 移出场景 → 撤销其施加在各被作用单位上的目标级修饰
      releaseTime(inst); // 移出场景 → 撤销其施加在各被作用单位上的时间系数
      releaseStealth(inst); // 移出场景 → 撤销其施加在各被作用单位上的潜行标记
      inst._coeffAdd = 0;
      inst._coeffMul = 1;
      inst._takeMul = 1;
      releaseForced(inst); // 移出场景 → 解除其施加的强制目标（被强制者按来源栈回落/回正常优先级）
    }
    const arr = sidesOf(side);
    const i = arr.indexOf(u);
    if (i >= 0) {
      arr.splice(i, 1);
      refreshSideSize(side);
    }
  }

  /* ---------- ★★ 星域容器专用：单位「跨实例整体搬迁」的两个最小接口（阶段 1 修订） ----------
   * 背景：星域容器把「单位逐格跨星区」落地为 **把同一个单位对象实例从 A 星区实例整体搬到 B 星区实例**
   * （见 `systems/starfield.js crossSectorPhase`）：
   *   · **保留该单位全部自身状态** —— 血量/护盾（含各护盾池现值与持续期）/能量/模块实例（冷却 `cooldown`
   *     与 `cdElapsed`、持续期 `durationLeft`/`durElapsed`、启停、统计）/已装货物（`ship.cargos` 实体与
   *     `hull.cargo`）/携带矿物（`hull.ore`）/定位与策略（`role`/`policy`）/目标选择（`targetId`、
   *     模块 `target`、`_lockIds`、`_stick`）；
   *   · **只清除“由其它单位施加的临时状态”**（判据＝来源是否本单位自身模块，见 `clearForeignMods`）。
   * 本实例此前没有这种接口（单位只在开局一次性创建、召唤只增不减、阵亡只标记 `alive=false`），故新增两个。
   * ★ **零回归保证（三条）**：
   *   ① **不改变任何既有调用路径**：两个接口都是**新增**的公开方法，既不进 Pass1/Phase A/B/C 的结算全序，
   *      也不被既有玩法（`LS.drill()` / 战斗屏）调用 ⇒ 既有行为、数值、战报序列一字不变；
   *   ② **不做任何战斗数值结算**：只做「摘除 / 挂回 + 按来源清理外部修饰 + 派生重算」，不写血量/护盾/能量
   *      当前值（除“上限重算”带来的既有钳制），不产生战报、不计入阵亡数；
   *   ③ **经 `withSink` 包裹**：即便清理过程产生战报（如时间系数撤销），也只进**本实例**缓冲。
   * ★ 与判死出口 `onDeath` 的区别：阵亡是**永久离场**（结束自身时长、返还货物/矿物、撤销自身获得的修饰，
   *   撤销自身获得的修饰）；**跨星区搬迁是“活着换场景”**，自身状态必须原样带走 ⇒ 两者**不共用**清理体。 */
  /** ★ **清除“由其它单位施加”的临时状态**（唯一判据：**来源 key ∉ 本单位自身模块实例 id**）：
   *  · 既有家族的 key 一律＝**施加方模块实例 id**（`setCoeffMod`/`setCoeffMulMod`/`setDamageTakeMulMod`/
   *    `setTimeCoeffMod`/`setStealthMod`，见 ship.js）⇒ 自身模块写的 key ∈ 自身 `modules[].id`
   *    （**自身状态、保留**），其余 ⇒ **外部施加、清除**（走既有撤销入口 `clear*Mod`，各入口自带派生值
   *    刷新：受伤减免连乘 / 时间系数组合 / 潜行标记 / 系数求和）；
   *  · **目标级上限叠加**（其它单位的 `*_cap_target`，由本实例 `capOverlays` 承载）⇒ 删掉本单位的条目
   *    （上限回到「基准 + 自身常驻」；由 `adoptUnit` 在目标实例内 `recomputeCap` 落地）；
   *  · **强制目标来源栈**（其它单位施加的“必须打我”）⇒ 清空并刷新派生标签
   *    （`forcedBy`/`forcedTargetId` 归 null ⇒ 回到正常目标优先级）；
   *  · ★ **不触碰**：模块实例自身状态（冷却/持续期/启停/统计）、`ship.cargos`/`hull.ore`（货物与矿物跟随）、
   *    `targetId`/`inst.target`/`inst._lockIds`/`inst._stick`（**自身的目标选择**，属自身状态 —— 若它们指向
   *    源区单位，迁移后由既有 `clearShipDeadRefs` 按“目标已不存在”的既有口径在下一 tick 回落）。 */
  function clearForeignMods(ship) {
    const own = new Set((ship.modules || []).map((i) => i.id));
    if (ship.coeffMods instanceof Map) {
      for (const k of [...ship.coeffMods.keys()]) if (!own.has(k)) clearCoeffMod(ship, k);
    }
    if (ship.coeffMulMods instanceof Map) {
      for (const k of [...ship.coeffMulMods.keys()]) if (!own.has(k)) clearCoeffMulMod(ship, k);
    }
    if (ship.damageTakeMulMods instanceof Map) {
      for (const k of [...ship.damageTakeMulMods.keys()]) if (!own.has(k)) clearDamageTakeMulMod(ship, k);
    }
    if (ship.timeCoeffMods instanceof Map) {
      for (const k of [...ship.timeCoeffMods.keys()]) if (!own.has(k)) clearTimeCoeffMod(ship, k);
    }
    if (ship.stealthMods instanceof Set) {
      for (const k of [...ship.stealthMods]) if (!own.has(k)) clearStealthMod(ship, k);
    }
    if (capOverlays.has(ship.id)) capOverlays.delete(ship.id); // 其它单位加在它身上的上限叠加
    if (Array.isArray(ship.forceStack) && ship.forceStack.length) {
      ship.forceStack.length = 0; // 其它单位施加的“强制打我”
      refreshForcedTags(ship);
    }
  }

  /** ★ **摘取单位**（容器搬迁第一步）：把该单位**从本实例场景摘除**，但**保留其全部自身状态**。
   *  · 判据＝单位 id（找不到 ⇒ `{ok:false, reason:'none'}`，无副作用）；
   *  · ① **撤销它对其它单位的影响**（唯一入口＝既有五个 `release*`，与既有“移出场景”同口径）：
   *       `dropSourceMods`（目标级上限）/`releaseCoeffRefs`（目标级系数）/`releaseTime`（时间系数）/
   *       `releaseStealth`（潜行）/`releaseForced`（强制目标）；
   *       ★ **静默离区**：三个带战报的撤销入口一律传 `silent = true`（**不记“加速/减速结束”“潜行结束”
   *       “强制解除/回落”**）⇒ 搬迁本身**不产生任何战报**；但 `silent` 的既有语义是“同 tick 到期并重新激活
   *       的延续场景”，它会**保留** `_timeActive`/`_stealthActive` 标记 ⇒ 这里必须**把标记一并归位**
   *       （否则该模块在目标实例里首次生效会被误判为“延续”，**漏记“开始”战报**）。
   *  · ② **作废它自己未触发的「后触发」载荷**（`inst._delayedRefs`/`_delayedDmg`）：该载荷的作用集合引用
   *       **源区单位**，若保留会在目标实例结算时打到源区单位身上（跨实例幽灵写入）——口径与既有
   *       “提前结束持续期（停用/阵亡/移出场景）不触发”一致（`endDuration` 亦如此清理）；
   *  · ③ **释放其在装货物**（`releaseCargoLoad`：解锁 + 进度归零、能量不退）：在装货物**尚未入舱**、
   *       仍是**源区**的货物实体 ⇒ 不随单位走（**已在舱**的货物在 `ship.cargos` 里，原样跟随）；
   *  · ④ **清除其它单位施加在它身上的临时状态**（`clearForeignMods`，判据＝来源是否自身模块）；
   *  · ④b **反向清理（源区侧，静默）** —— 把本单位从源区**其它单位/模块**里的一切指向它的引用中摘掉：
   *       · **目标引用**（等价于既有 `clearShipDeadRefs` 的清引用范围，但**不播报**）：其它单位的
   *         `targetId`、模块手动目标 `{mode:'unit'|'units'}` 若指向本单位 ⇒ 清成 `null` / `{mode:'follow'}`
   *         （或仅移除本单位并保留其余），**不产生“回落”类战报**；锁定单位（`lockTargetId`）按既有口径跳过；
   *       · **作用集合引用**（`_delayedRefs`/`_timeRefs`/`_stealthRefs`/`_coeffRefs`/`_forcedRefs`，判据＝对象
   *         **同一性**）：剔除本单位 ⇒ ① 这些模块日后撤销时**不会写进已不在本实例的单位**；
   *         ② **结束类战报的 n 只统计“仍在场”的单位**（离场≠阵亡，计数口径据此修正）；
   *         ③ 「后触发」载荷不会跨实例写挂账（幽灵写入）。
   *       ★ 只影响**离场单位**：真正阵亡仍走 `onDeath`（**一字未改**）⇒ 既有“回落/结束”战报与管理口径零回归。
   *  · ⑤ 从所属阵营数组摘除、刷新 `sideSize`；**不计阵亡数、不置 `alive=false`、不播报阵亡**；
   *  · ⑥ 重建本实例的 tick 挂账结构 `__pending`（其内容引用本实例闭包状态；下一 tick Pass1 本就会重建），
   *       并清掉模块上可能残留的“本 tick 到期记录”指针 `_expiryRec`（仅同 tick 内的中间量）。
   *  ★ 本单位**自身的目标选择**（`targetId`/`inst.target`/`_lockIds`/`_stick`）**保留**（属自身状态）；
   *    若它指向的源区单位不在目标实例里，则由目标实例**既有**的 `clearShipDeadRefs` 在下一 tick 按
   *    “目标已不存在”的既有口径回落（与“目标阵亡”完全同源，**未新增机制**）。
   *  @returns {{ ok:boolean, unit:object|null, reason:'none'|null }} */
  function takeUnit(id) {
    const ship = allies.find((u) => u.id === id) || enemies.find((u) => u.id === id);
    if (!ship) return { ok: false, unit: null, reason: 'none' };
    for (const inst of ship.modules || []) {
      dropSourceMods(inst);
      releaseCoeffRefs(inst);
      releaseTime(inst, true);      // ★ 静默：不记“加速/减速结束”
      releaseStealth(inst, true);   // ★ 静默：不记“潜行结束”
      releaseForced(inst, true);    // ★ 静默：不记“强制解除/回落”
      releaseCargoLoad(inst);
      inst._delayedRefs = null; // 未触发的后触发载荷作废（作用集合引用源区单位，见上）
      inst._delayedDmg = 0;
      inst._expiryRec = null;   // 同 tick 中间量（引用源实例的 pending 记录）
      // ★ `silent` 会保留“生效中”标记（那是给“同 tick 到期并重激活”的延续场景用的）⇒ 此处归位
      inst._timeActive = false;
      inst._stealthActive = false;
    }
    clearForeignMods(ship);
    // ★ 反向清理（源区侧，静默；见上 ④b）：目标引用 + 五类作用集合引用
    for (const other of [...allies, ...enemies]) {
      if (other === ship) continue;
      if (other.targetId === ship.id && !other.lockTargetId) other.targetId = null; // 目标引用（不播报）
      for (const oi of other.modules || []) {
        const t = oi.target;
        if (t && t.mode === 'unit' && t.id === ship.id) {
          oi.target = { mode: 'follow' }; // 手动目标指向离场单位 ⇒ 回落为“跟随”，与既有同口径
        } else if (t && t.mode === 'units' && Array.isArray(t.ids) && t.ids.includes(ship.id)) {
          const kept = t.ids.filter((x) => x !== ship.id);
          if (kept.length) t.ids = kept;
          else oi.target = { mode: 'follow' };
        }
        // ★ **粘性目标 `_stick`（存的是单位 id）**：把离场单位的 id 摘掉（静默、幂等）——
        //   与既有“无可粘目标 ⇒ `undefined`”同口径；否则源区单位会留着一个**跨实例的失效 id**
        //   （读取时本就不会匹配任何存活单位 ⇒ 无幽灵写入，但按“静默离区不留跨实例引用”的口径一并清理）。
        if (Array.isArray(oi._stick) && oi._stick.includes(ship.id)) {
          const keptStick = oi._stick.filter((x) => x !== ship.id);
          oi._stick = keptStick.length ? keptStick : undefined;
        }
        for (const key of ['_delayedRefs', '_timeRefs', '_stealthRefs', '_coeffRefs', '_forcedRefs']) {
          const list = oi[key];
          if (Array.isArray(list) && list.includes(ship)) oi[key] = list.filter((x) => x !== ship);
        }
      }
    }
    const arr = sidesOf(ship.side);
    const i = arr.indexOf(ship);
    if (i >= 0) {
      arr.splice(i, 1);
      refreshSideSize(ship.side);
    }
    ship.__pending = freshPending(); // 换成本实例的挂账结构（不残留源实例闭包引用）
    return { ok: true, unit: ship, reason: null };
  }

  /** ★ **收编单位**（容器搬迁第二步）：把**同一个单位对象**挂回本实例的阵营数组，并在**本实例内重绑**。
   *  · `side` 缺省沿用单位自身 `side`；**幂等**（已在数组中 ⇒ 直接返回 `ok`）；
   *  · ① 挂回该阵营数组**末尾**、分配本实例的**下一出场序号** `order`（与 `spawnList` 同口径）、
   *       刷新 `sideSize`（仅影响 `#序号` 显示口径）；
   *  · ② **重绑本实例引用**：护盾池“激活顺序”序号 `_shieldSeq` 改用**本实例**计数器按模块顺序重新编号
   *       （`_shieldSeq` 只用于“先激活先用”的排序 ⇒ 本单位内部相对顺序不变、跨实例数值无意义）；
   *       `__pending` 重建为**本实例**的挂账结构；
   *  · ③ **按本实例状态重算派生**：`recomputeCap(unit)` —— 本实例 `capOverlays` 中该单位**暂无条目**
   *       ⇒ 上限回到「基准 + 自身常驻」；护盾池结构/池值按本单位现有模块重算（**只钳制、不补齐**）。
   *       ★ 自身模块与其写下的自身系数修饰（key ∈ 自身模块 id）都随对象保留 ⇒ 重算结果与原实例一致，
   *       **血量/护盾/能量当前值不变**（除非上限确实变小 ⇒ 走既有钳制口径）。
   *  @returns {{ ok:boolean, unit:object|null, reason?:string }} */
  function adoptUnit(unit, side) {
    if (!unit || typeof unit !== 'object') return { ok: false, unit: null, reason: 'none' };
    const s = side === 'ally' || side === 'enemy' ? side : unit.side === 'enemy' ? 'enemy' : 'ally';
    const arr = sidesOf(s);
    if (arr.includes(unit)) return { ok: true, unit, reason: 'already' }; // 幂等
    unit.side = s;
    seqCount[s] += 1;
    unit.order = seqCount[s]; // 出场序号由本实例分配（与 spawnList 同口径；稳定、不随队列变化）
    arr.push(unit);
    refreshSideSize(s);
    const pools = unit.hull && unit.hull.pools;
    for (const inst of unit.modules || []) {
      if (pools instanceof Map && pools.has(inst.id)) inst._shieldSeq = ++shieldSeq; // 护盾池使用序：本实例重新编号
    }
    unit.__pending = freshPending();
    recomputeCap(unit); // 按本实例状态重算上限/护盾池（capOverlays 无该单位条目 ⇒ 目标级叠加归零）
    return { ok: true, unit, reason: null };
  }

  /** ★★ **增援单位（容器「多次派遣」专用最小接口）**：把若干**新单位**按既有编队口径生成并**追加**到某阵营**数组末尾**。
   *  · 与 `spawnList`（开战建单位）**同一套口径**：`createShip` → `installModule` → 满盾/满血满能量 → 出场序号；
   *  · 与召唤单位（`spawnSummoned`）**不同**：本接口产出的是**普通单位**（非 `isSummon`/非临时），
   *    也不改任何 `seqCount` 之外的规则；`seqCount`/`order`/`sideSize` 全部与 `spawnList` 同源；
   *  · **纯追加**：不动既有单位、不动目标/队列缓存（新单位在下一 tick 的目标解析里自然参与）；
   *  · 既有单星区玩法（`LS.drill()` / 战斗屏）**从不调用** ⇒ 行为一字不变（零回归）。
   *  @param {Array<{type:string, level?:number, modules?:Array, role?:string}>} list 编队条目（与 `startBattle` 的 `allies` 同构）
   *  @param {'ally'|'enemy'} [side] 阵营（缺省 `'ally'`；非法值同样落到 `'ally'`）
   *  @returns {{ ok:boolean, units:object[], count:number, side:'ally'|'enemy' }} `units` ＝ **本次新增的单位对象**（按传入顺序） */
  function reinforce(list, side) {
    const s = side === 'enemy' ? 'enemy' : 'ally';
    const arr = sidesOf(s);
    const spec = Array.isArray(list) ? list : [];
    const before = arr.length;
    spawnList(arr, s, spec);
    refreshSideSize(s);
    return { ok: true, units: arr.slice(before), count: arr.length - before, side: s };
  }

  /* ---------- 统一目标系统 ---------- */
  const policies = { ally: 'order', enemy: 'order' };  // 单位级策略：ship.policy 有效则用它覆盖全队策略；否则跟随全队
  const policyOf = (ship) =>
    ship.policy && TARGET_POLICIES.includes(ship.policy) ? ship.policy : policies[ship.side] || 'order';
  /** 设置某船的自动目标策略（ship 对象或 id）；kind=null → 跟随全队。即时清除旧自动粘性目标。 */
  function setShipPolicy(ship, kind) {
    if (!ship) return false;
    if (kind && !TARGET_POLICIES.includes(kind)) return false;
    ship.policy = kind || null;
    for (const inst of ship.modules || []) inst._stick = undefined; // 策略变化即时生效
    return true;
  }

  /* ---------- ★ 单位定位（role）分离：目标选择与溅射队列的唯一口径 ----------
   * `role ∈ {'combat','logistics'}`；**缺省＝'combat'**（落地口径见 `entities/ship.js createShip`：
   *   船型数据 `data/ships/<id>.js` 的 `role` → 编队条目 `ShipCfg.role` / 召唤 `attrs.role` 可覆写 →
   *   实例 `ship.role`；`applyShipLevel` 重解析时同样写回）。**本文件只读 `ship.role`，不自算定位**。
   *
   * 1) **队列口径** `unitsOfRole(side, role)`：某阵营**按 role 分离后的“视觉顺序队列”**
   *    —— 与战斗界面四个分区（敌我 × 战斗/后勤）的卡片顺序**完全一致**（同 `allies`/`enemies` 数组顺序；
   *    **不做存活过滤**：阵亡单位仍占队列位置，与既有“按索引取前后邻居 + 存活才结算”的语义一致）。
   *    `orderedQueueFor(u)` ＝ 单位 `u` **自己那一侧、自己那一 role** 的队列 —— `blast_range` 溅射邻接的
   *    **唯一取法**（即时爆炸与 `effectSetOf` 共用，不再各写一遍）。
   *    **无后勤单位时** `unitsOfRole(side,'combat')` ≡ 整条阵营队列 → **既有行为零变化**。
   *
   * 2) **对敌可选口径** `roleBlocksInFoes(u, foes, isStealthBlocked)`：目标方阵营 `foes` 中**仍有
   *    「可选战斗单位」**时，该阵营的**后勤单位不可被选**；没有可选战斗单位时后勤**解禁**。
   *    ★ **“可选战斗单位”判据（与潜行叠加后的最终口径）**＝ 存活 **且 未被潜行筛选屏蔽**
   *      （`f.alive && roleOf(f)==='combat' && !isStealthBlocked(f)`）——
   *      即：敌方战斗单位**全部阵亡**、**或全部被潜行屏蔽**（对该施放者而言不可选）时，
   *      `enemy` 可选择敌方后勤单位（避免“潜行挡战斗 + role 挡后勤 → 候选池空”）。
   *    ★ 只作用于**“对敌”语义**：`kinds` 含 `enemy` 的选择器，以及船级“主要攻击目标”/阵营预览/UI 候选池
   *      的对敌分支；`ally`/`self`/`any` 三类**不做 role 分离**（治疗/输送类仍可指向后勤单位）。
   *    ★ 潜行判据由调用方传入（`isStealthBlocked`）：施放者视角用 `stealthBlocksTargeting(ship,·)`，
   *      阵营预览（无施放者）用 `tickStealthed(·)` —— 与各自既有潜行口径**完全同源**、潜行语义未改。
   *    ★ 时序：判据读**存活状态**，而 Pass1 阶段不会有任何单位被判死（判死全部发生在结算阶段）→
   *      本 tick 全体单位的目标解析看到的是**同一份 tick 起始存活状态**；本 tick 结算落地的阵亡
   *      从**下一 tick** 的解析起体现（与潜行/系数同一时序范式，不逐 tick 抖动、不产生数值修改）。
   *
   * 3) **目标可选唯一判据** `targetAllowed(ship, u, kind)` ＝ 潜行过滤 +（按来源桶的）role 分离，
   *    与潜行过滤**落在同一处**（`moduleTargetList` 的候选池过滤），并被 `shipEffectiveTarget`、
   *    `fleetPreview`、UI 候选池（导出 `targetableBy`）共用；**锁定豁免照旧**（两个锁定分支在过滤之前直接返回）。
   *    `kind` ＝ 候选来自哪个选择器桶（`'self'|'enemy'|'ally'|'any'`）；**缺省（2 参调用）按 `'enemy'`
   *    （对敌主要目标）语义判定** —— 与既有 2 参调用完全兼容。 */
  function roleOf(u) {
    return u && u.role === 'logistics' ? 'logistics' : 'combat'; // 缺省/异常值一律按战斗单位
  }
  /** 某阵营按 role 分离后的视觉顺序队列（与战斗界面分区渲染顺序一致；**含阵亡单位占位**，不过滤存活） */
  function unitsOfRole(side, role) {
    const want = role === 'logistics' ? 'logistics' : 'combat';
    return (side === 'ally' ? allies : enemies).filter((u) => roleOf(u) === want);
  }
  /** 单位自身所在队列（**同侧 + 同 role**）—— `blast_range` 邻接的唯一取法 */
  function orderedQueueFor(u) {
    return unitsOfRole(u && u.side, u && u.role);
  }
  /** 对敌 role 分离核心判据：目标方仍有**可选战斗单位**（存活 且 未被潜行屏蔽）→ 其后勤单位不可被选。
   *  `isStealthBlocked(f)` ＝ 该战斗单位是否因**潜行**而对“当前解析视角”不可选
   *  （施放者视角 `stealthBlocksTargeting(ship,·)`；阵营预览 `tickStealthed`）——潜行语义本身未改。 */
  function roleBlocksInFoes(u, foes, isStealthBlocked) {
    if (!u || roleOf(u) !== 'logistics') return false;
    const blocked = typeof isStealthBlocked === 'function' ? isStealthBlocked : () => false;
    return foes.some((f) => f.alive && roleOf(f) === 'combat' && !blocked(f));
  }
  /** ★ 目标可选（唯一口径）：潜行过滤 + 按来源桶的 role 分离。
   *  **不含存活判定** —— 存活由各调用方的既有逻辑负责（候选池 `!u.alive` / `orderedFoes` 只给存活 /
   *  UI 的 `f.alive`），以免改动既有语义。 */
  function targetAllowed(ship, u, kind) {
    if (!ship || !u) return false;
    if (stealthBlocksTargeting(ship, u)) return false; // 潜行：自身永远可选、只挡对敌（既有语义不变）
    if (kind === 'ally' || kind === 'self' || kind === 'any') return true; // ★ 三类不做 role 分离
    const foes = ship.side === 'ally' ? enemies : allies;
    if (!foes.includes(u)) return true; // 非对敌候选（友方/自身）不受 role 分离限制
    // 'enemy'（含缺省）→ role 分离；「可选战斗单位」与潜行叠加：潜行屏蔽的战斗单位不算可选
    return !roleBlocksInFoes(u, foes, (f) => stealthBlocksTargeting(ship, f));
  }

  /** 依目标词条(kinds/countMode/maxCount)解析本次命中的目标列表（引擎与 UI 共用）
   *  - 目标池：self → 自身；enemy → 敌方存活（按全队策略排序，★ 受 role 分离：目标方仍有**可选战斗单位**
   *    （存活且未被潜行屏蔽）时不含其后勤）；ally → 同阵营其它存活；any → 敌我任意（含自身，★ 不做 role 分离）
   *  - ★★ **`self` 与 `ally` 同源同序（本口径为唯一权威）**：两者都按**己方单位数组的自然顺序**展开，
   *    **自身只在其自然位置、不置顶** ⇒ 不带 `prefer_self` 时“**队列中轮到自身才为自身**”；
   *    带 `prefer_self` 才由优先级链（rank 2）把自身提到最前。UI 的候选池（`battleView` 的 `candList`）
   *    与本函数**同一顺序**，**不得自成一套**。
   *  - 手动选择互斥（去重）；未手动覆盖的空位由上游自动补足
   *  - ★ **目标优先级链（唯一口径，与 `shipEffectiveTarget` 同源）**：
   *      **锁定单位(`lockTargetId`) > 激活锁定(`lock_target_on_activate`·持续期内) > 强制目标 >
   *        模块手动目标 > 优先自己(`prefer_self`) > 船 `targetId` > 自动粘性 > 全队策略/阵营顺序**
   *    （实现：给候选池打优先级桶后稳定排序，三个 countMode 分支同取这一条链）
   *  - ★ **候选池过滤（唯一处）**＝潜行过滤 + 按来源桶的 role 分离，同由 `targetAllowed(ship, u, kind)` 判定，
   *    且都在**两个锁定分支之后**执行 —— 锁定单位/激活锁定**豁免**，其余来源（含**玩家手动选定**）一律过滤：
   *      · 潜行（`type` 标签 `stealth`）：跳过潜行单位（自身永远可选、只挡对敌）；
   *      · role 分离：**`enemy` 桶**在“目标方仍有可选战斗单位（存活且未被潜行屏蔽）”时跳过其后勤；
   *        `self`/`ally`/`any` 桶不分离。
   *    过滤后为空 → 返回 []（按既有规则**不激活**）。
   *  - countMode：single=1 / multi=min(maxCount, 可用) / all=全部；空目标池 → 无目标 []
   */
  function moduleTargetList(ship, inst) {
    const fx = (inst && inst.cfg.effects) || {};
    const tgt = (inst && inst.cfg.target) || {};
    const kinds = Array.isArray(tgt.kinds) ? tgt.kinds : [];
    const mode = tgt.countMode || 'single';
    const maxN = Math.max(1, tgt.maxCount || 1);
    const foes = ship.side === 'ally' ? enemies : allies;
    const sameSide = ship.side === 'ally' ? allies : enemies;

    // —— 锁定单位（如一次性火箭）：目标在召唤时固定、永不可改——
    //    即使锁定目标已阵亡也只返回空（绝不另选/改换其他目标）。
    if (ship.lockTargetId) {
      const b = foes.find((u) => u.id === ship.lockTargetId);
      return b && b.alive ? [b] : [];
    }

    // ★ 候选池：按选择器桶组装，**每个候选带上来源桶 `kind`**（role 分离按桶判定，见下方统一过滤处）。
    // ★★ **`self` 与 `ally` 同源同序（本次修正）**：两者都从**己方单位数组 `sameSide` 的自然顺序**
    //    一次性展开 —— **自身只出现在它的自然位置**（＝己方队列里轮到它的那一格），
    //    不再因为 `self` 桶被写在最前面而**隐含置顶**（那等于给了自身一个未声明的优先级）。
    //    · **带 `prefer_self` 的模块**：仍由下方优先级链把它提到最前（rank 2），行为**逐字不变**；
    //    · **不带 `prefer_self` 的模块**（`kinds` 含 `self` 时）：与普通队列选择**完全相同** ——
    //      “队列中轮到自身才为自身”，自身**没有任何优先级**；己方只剩自身时，自身仍会被正常选中。
    //    · `kind` 桶名照旧（自身恒记 `'self'`）⇒ 下方 `targetAllowed` 的按桶判定（潜行/role 分离）
    //      语义与既有一致（`self` 与 `ally` 桶均不做 role 分离）。
    //    · 桶间相对次序＝「自身+友方（阵营自然顺序）→ 敌方（策略队列）→ 任意（敌我）」，与既有一致
    //      （仅“自身桶的位置”由置顶改为**并入己方自然顺序**）。
    const pool = []; // { u, kind }
    if (kinds.includes('self') || kinds.includes('ally')) {
      for (const u of sameSide) {
        if (u.id === ship.id) {
          if (kinds.includes('self')) pool.push({ u, kind: 'self' });
        } else if (kinds.includes('ally') && u.alive) {
          pool.push({ u, kind: 'ally' });
        }
      }
    }
    if (kinds.includes('enemy')) {
      for (const u of orderedFoes(foes, policyOf(ship))) pool.push({ u, kind: 'enemy' });
    }
    if (kinds.includes('any')) {
      for (const u of [...allies, ...enemies]) pool.push({ u, kind: 'any' }); // 敌我任意（含自身）
    }
    const excl = Array.isArray(tgt.exclude) ? tgt.exclude : []; // 目标排除标签（如 projectile=召唤弹体）
    const uniq = [];
    const seen = new Set();
    // ★ **唯一过滤处（潜行 + role 同一处）**：`targetAllowed(ship, u, kind)` ——
    //   · 潜行过滤（`stealthBlocksTargeting`，语义不变）：**锁定分支之后**统一过滤候选池 →
    //     锁定单位/激活锁定豁免，其余来源（含玩家手动选定）一律跳过潜行单位；
    //   · role 分离：仅 **`enemy` 桶**受限 —— 目标方仍有**可选战斗单位**（存活 且 未被潜行屏蔽）时
    //     其后勤不入池（战斗单位全部阵亡/全部潜行时自动放开）；`self`/`ally`/`any` 桶不做 role 分离。
    //   ★ 同一单位可能来自多个桶：**任一桶允许即可选**（被挡的候选不登记 `seen`，故 `any` 桶仍可放行
    //     敌方后勤 —— 对应“any 不受分离限制”）。过滤后为空 → 返回 []（**不激活**，不报错）。
    for (const { u, kind } of pool) {
      if (!u.alive) continue;
      if (excl.length && excl.some((t) => unitHasTag(u, t))) continue;
      if (seen.has(u.id)) continue;
      if (!targetAllowed(ship, u, kind)) continue;
      seen.add(u.id);
      uniq.push(u);
    }
    if (!uniq.length) return [];

    // —— ★ 激活锁定（`type` 标签 `lock_target_on_activate`）：目标在**激活瞬间**固定 ——
    //    优先级**高于强制目标与手动目标**（仅次于上面的“锁定单位”），且**只在本次持续期内生效**：
    //    · 持续期内完全按锁定集合返回 —— 玩家仍可点选目标，但那只是**记录**，下一次激活才采用；
    //    · 锁定目标阵亡 → 只返回其余存活的锁定目标（全部阵亡则返回空，**绝不**改选其它目标）；
    //    · 持续期结束（`durationLeft` 归 0）后自动回到下面的正常优先级链。
    //    ★ 读取的是 Pass1 记账时写入的 `inst._lockIds`（结构引用，非数值）→ 不破坏 Pass1 零数值变化。
    if (moduleTargetLocked(inst)) {
      const locked = [];
      for (const id of inst._lockIds) {
        const u = allies.find((x) => x.id === id) || enemies.find((x) => x.id === id);
        if (u && u.alive) locked.push(u);
      }
      return locked;
    }

    // —— ★ **目标优先级链（唯一口径）** ——
    //    激活锁定目标（上方已返回） > 强制目标 > 模块手动目标 > 优先自己(`prefer_self`) >
    //    船 `targetId` > 自动粘性 > 自然顺序（全队策略/阵营顺序）
    //    ★ **“自然顺序”的确切含义**＝**候选池的组装顺序**，即：己方单位**阵营数组 `sameSide`
    //      的自然顺序**（自身在其中的**自然位置**，**没有**任何优待）、敌方按 `orderedFoes(foes, 全队策略)`。
    //      ⇒ **不带 `prefer_self` 的模块**（`kinds` 含 `self` 亦然）：队列里**轮到自身**时结果才是自身
    //      —— 这正是“与普通队列选择相同、自身无优先级”的实现；己方只剩自身时自身照常被选中。
    //    实现：对候选池每个单位打**优先级桶**（rank），桶内保持自然顺序 → 一次稳定排序得出结果；
    //    `all`/`multi`/`single` 三个分支都从这同一条有序链上取（`single` 取首位、`multi` 取前 N、`all` 取全部）。
    // ★ **潜行过滤 + role 分离已在候选池过滤处统一完成**（见上方 `targetAllowed`）：
    //   两者都落在**锁定分支之后** —— 上方的“锁定单位 / 激活锁定”属**激活瞬间已锁定**的目标，
    //   **豁免**全部过滤（潜行不推翻既有锁定；role 分离同样不推翻锁定）；
    //   其余全部来源（强制目标 / 模块手动目标 / 优先自己 / 船 `targetId` / 自动粘性 / 全队策略）
    //   一律经过 `targetAllowed`。过滤后无可用目标 → `uniq` 为空并已提前返回 []
    //   （**按既有规则不激活**，不报错）。
    const forced = forcedTopUnit(ship);
    const forcedIn = forced && uniq.some((u) => u.id === forced.id) ? forced : null;
    const selIds = new Set(
      inst.target && inst.target.mode === 'units' ? inst.target.ids || [] : []
    );
    const selId = inst.target && inst.target.mode === 'unit' ? inst.target.id : null;
    // ★ 优先自己（`prefer_self`）：自身**可作为目标**（kinds 允许 self/any → 自身在池中）时，
    //   默认解析**优先取自己**；玩家手动指定其它目标时手动优先（rank 1 < rank 2）。
    const preferSelf = isType(fx, 'prefer_self');
    // 自动粘性：仅在“无任何手动锁定（船 targetId / 模块 unit|units）”时生效（原有语义不变）
    const manualLocked = !!ship.targetId || (inst.target && inst.target.mode !== 'follow');
    const stickIds = new Set(!manualLocked && Array.isArray(inst._stick) ? inst._stick : []);
    const rankOf = (u) => {
      if (forcedIn && u.id === forcedIn.id) return 0;
      if (selIds.has(u.id) || (selId && u.id === selId)) return 1;
      if (preferSelf && u.id === ship.id) return 2;
      if (ship.targetId && u.id === ship.targetId) return 3;
      if (stickIds.has(u.id)) return 4;
      return 5;
    };
    const ordered = uniq
      .map((u, i) => ({ u, i }))
      .sort((a, b) => rankOf(a.u) - rankOf(b.u) || a.i - b.i)
      .map((x) => x.u);

    if (mode === 'all') return ordered; // 全员（不缩减 AoE 覆盖），仅按上述优先级排序
    if (mode === 'multi') return ordered.slice(0, maxN); // 前 N 位（强制/手动优先占位）
    return ordered.slice(0, 1); // single：优先级最高者
  }

  /** ★ 该模块当前是否处于**激活锁定**中（`type` 标签 `lock_target_on_activate` + 本次持续期未结束）。
   *  **UI 的唯一判据**（不产条件、不自算）：锁定中目标固定为本次激活的解析结果，
   *  玩家新点选的目标只**记录**、要等**下一次激活**才采用（UI 据此显示“已锁定 / 下次生效”）。
   *  ★ 需搭配 `duration_ticks`：没有持续期就无所谓“此次激活的固定目标”。 */
  function moduleTargetLocked(inst) {
    if (!inst) return false;
    const fx = (inst.cfg && inst.cfg.effects) || {};
    return (
      isType(fx, 'lock_target_on_activate') &&
      (inst.durationLeft || 0) > 0 &&
      Array.isArray(inst._lockIds) &&
      inst._lockIds.length > 0
    );
  }

  /* ---------- 潜行（`type` 标签 `stealth` · 目标选择向）----------
   * ★ 语义：被标记单位**不得被选为主要攻击目标**（其它单位的目标解析一律跳过它）。
   *   下列**唯一口径** `stealthBlocksTargeting` 是潜行的**判定函数**，由**统一过滤判据** `targetAllowed`
   *   调用（role 分离与之**调用同一处**）→ `moduleTargetList`（模块目标优先级链）与
   *   `shipEffectiveTarget`（船级主要目标）/`fleetPreview`/UI 候选池（`targetableBy`）**同口径**，
   *   避免“显示能打、实际不打”。
   * ★ **豁免（仍受“目标锁定”影响）**：`lockTargetId`（一次性火箭/导弹弹体）与
   *   `lock_target_on_activate` 的锁定集合 `inst._lockIds`（**激活瞬间已锁定**的目标）在各自分支
   *   **直接返回**、不经过本判据 → 潜行**不影响**这些既有锁定（潜行是“事后生效”，不推翻锁定）。
   * ★ **不影响溅射**：`blast_range` 波及（`effectSetOf` 与 `maybeActivate` 的爆炸循环）**不走**本判据，
   *   潜行单位照常被波及；`applyHit` 侧也没有任何潜行减免 —— “仍会受到溅射影响”由此天然成立。
   * ★ **不影响友方/自身**：潜行只挡“把对方当敌人打”，支援类模块（buff/回盾/时间系）解析到
   *   潜行单位（友军或自己）照常成立；自身永远可选（自指模块不受影响）。
   * ★ 读**tick 起始快照** `u._stealthTick`（Pass1 单位开头写入，见 `pass1Unit`；新召单位在
   *   `doSummon` 生成时写入）：本 tick 全体单位的目标解析按同一份 tick 起始状态进行；
   *   本 tick 结算阶段落地的潜行从**下一 tick 的目标解析**起体现（与系数/时间系数同一时序范式）。 */
  function tickStealthed(u) {
    if (u && typeof u._stealthTick === 'boolean') return u._stealthTick;
    return isStealthed(u); // 快照缺失（战斗外/异常路径）→ 唯一读口径现算兜底
  }
  /** u 是否因**潜行**而不可被 ship 选为“主要攻击目标”（潜行的**唯一判定口径**，UI 同源） */
  function stealthBlocksTargeting(ship, u) {
    if (!ship || !u) return false;
    if (u.id === ship.id) return false; // 自身永远可选（自指/自身单体模块不受潜行影响）
    const foes = ship.side === 'ally' ? enemies : allies;
    if (!foes.includes(u)) return false; // 只挡“对敌”目标：友方/支援类目标不受潜行影响
    return tickStealthed(u);
  }

  /** 船的"当前实际目标"（供 UI 显示单位主要目标/提示）：
   *  ★ 优先级链与 `moduleTargetList` **同口径**（船级视角）：
   *    **锁定单位 > 激活锁定(`lock_target_on_activate`·首个锁定中的攻敌模块) > 强制目标 >
   *      船手动目标 `targetId` > 首个能攻击敌方的模块的实时解析结果 > 全队策略队首**。
   *  ★ **潜行 + role 过滤同口径**（`targetAllowed(ship, u, 'enemy')`）：**锁定单位与激活锁定豁免**，
   *    其余来源（强制目标 / 船 `targetId` / 模块解析结果 / 全队策略队首）一律跳过潜行单位，
   *    并跳过“目标方仍有可选战斗单位（存活且未被潜行屏蔽）时的其后勤”（role 分离，见文首 role 口径块）。
   *  （模块内部的手动目标/`prefer_self` 由 `moduleTargetList` 自己按完整链解析，此处不再重复。）
   *  `shipEffectiveTarget` 是**船级“主要攻击目标”显示**：只返回**敌方**单位 ——
   *  支援类模块（如时间扭曲选中友军/自己）不得把船的主要目标显示成友方。 */
  function shipEffectiveTarget(ship) {
    const foes = ship.side === 'ally' ? enemies : allies;
    if (ship.lockTargetId) {
      const b = foes.find((f) => f.id === ship.lockTargetId && f.alive);
      return b || null; // 锁定单位不回落其他目标（即使锁定目标已阵亡也返回 null）
    }
    if (ship.modules && ship.modules.length) {
      for (const inst of ship.modules) {
        if (!moduleTargetLocked(inst)) continue;
        const list = moduleTargetList(ship, inst); // 锁定中：返回本次激活固定的目标
        const u = list.find((x) => foes.includes(x));
        if (u) return u; // 只可能是敌方；锁定到友军/自己则视为与该显示无关，继续下探
      }
    }
    const forced = forcedTopUnit(ship); // 被强制时 UI 与战斗解析必须显示同一目标
    // ★ 潜行 + role 同口径（`targetAllowed`）：被强制指向的单位若已潜行、或落在“目标方仍有可选战斗单位时的
    //   其后勤”上 → 不可作为主要攻击目标（继续下探正常链）
    if (forced && targetAllowed(ship, forced, 'enemy')) return forced;
    if (ship.targetId) {
      const u = foes.find((f) => f.id === ship.targetId && f.alive);
      if (u && targetAllowed(ship, u, 'enemy')) return u; // ★ 同上：跳过，继续下探（targetId 本身不改写）
    }
    if (ship.modules && ship.modules.length) {
      for (const inst of ship.modules) {
        const fx = (inst.cfg && inst.cfg.effects) || {};
        const kinds = (inst.cfg && inst.cfg.target && inst.cfg.target.kinds) || [];
        // ★ “攻敌模块”判据：明确选敌，或**确实会造成伤害**的模块；
        //   仅“敌我任意(kinds:any)”**不足以**算攻敌（否则支援类模块会把主要目标显示成友军/自己）。
        const offensive = kinds.includes('enemy') || (fx.damage || 0) > 0;
        if (!offensive) continue; // 跳过纯增益/召唤等不攻敌的模块
        const list = moduleTargetList(ship, inst);
        // ★ 船级主要目标只能是敌方：支援/自指模块解析出的友军或自己一律不计入
        const u = list.find((x) => foes.includes(x));
        if (u) return u;
      }
    }
    // ★ 全队策略队首：同样跳过潜行单位与“目标方仍有可选战斗单位时的其后勤”（role 分离同口径）
    return orderedFoes(foes, policyOf(ship)).find((f) => targetAllowed(ship, f, 'enemy')) || null;
  }

  /** 阵营策略预览：该阵营当前全队首个命中目标（★ 同口径跳过潜行单位；★ role 分离：目标方仍有
   *  **可选战斗单位**（存活 且 未被潜行屏蔽）时不把其后勤单位当作命中目标 —— 与 `shipEffectiveTarget`
   *  同一判据 `roleBlocksInFoes`，潜行判据用阵营级 `tickStealthed`） */
  function fleetPreview(side) {
    const foes = side === 'ally' ? enemies : allies;
    return (
      orderedFoes(foes, policies[side]).find(
        (u) => !tickStealthed(u) && !roleBlocksInFoes(u, foes, tickStealthed)
      ) || null
    );
  }

  /** ★ **共享的“作用集合（effect set）”计算** —— 供**上限类词条**与**时间加速**等
   *  “按集合成批落地”的非伤害词条组共用（避免各处重复实现同一套扩展规则）。
   *  作用集合 = 三个来源的**并集**（按单位 id 去重，冻结于本次激活瞬间）：
   *    ① 目标选择器解析出的目标（`moduleTargetList`，含 excludes/粘性/强制目标/激活锁定等全部既有语义）；
   *    ② `blast_range > 0` 时，**各目标所在队列**（★ 该目标**自己那一侧、自己那一 role** 的视觉顺序队列，
   *       见 `orderedQueueFor`/`unitsOfRole`；**不跨 role 波及**）前后各 N 个存活单位；
   *    ③ `type` 标签 `include_self` 时，模块所属单位自身（★ **按标签识别**，与目标选择器无关：
   *       即使 `kinds` 不含 `self`/`any`，带该标签也一定作用于自身）。
   *  ★ **“自身是否产生溅射”取决于它是怎么进集合的（精确规则）**：
   *    · **由 `include_self` 标签补入的自身**（不进 `targets`，只在函数末尾 `set.set`）→ **不产生任何溅射**，
   *      只是精确作用于自己；
   *    · **目标选择器正常解析出的自身**（`kinds` 含 `self`/`any`：带 `prefer_self` 的模块默认取到自己、
   *      玩家手动选中自身、或不带该标签时“己方队列正好轮到自身”）→ 它与任何别的目标**完全同权**，
   *      **照常对自身所在队列前后各 N 个存活单位产生溅射**。
   *    实现上不需要任何 `primary === ship` 特判：溅射循环只遍历 `targets`，标签补入发生在循环之后。
   *  ★ 用**目标自己的**队列做波及（而不是“施放方的敌方队列”）：对“选中友方/任意”的词条
   *    （如时间加速）才是正确语义；对 EMP 这类“选中敌方”的词条，二者**完全等价**（原有行为不变）。
   *    ★ 该队列本身**按 role 分离**（`orderedQueueFor`）：主目标为战斗单位则只在战斗队列内波及，
   *    为后勤单位则只在后勤队列内波及 —— **不跨 role**；**无后勤单位时与既有整条队列完全一致（零变化）**。
   *  ★ 只用只读信息（存活状态 + 队列顺序），不修改任何数值 → 可在 Pass1 安全调用；
   *    返回的数组由结算阶段消费（并写入 `inst._xxxRefs` 作为撤销依据）。 */
  function effectSetOf(ship, targets, fx) {
    const set = new Map(); // id -> unit（去重）
    for (const t of targets) if (t && t.alive) set.set(t.id, t);
    const r = (fx && fx.blast_range) || 0;
    if (r > 0) {
      // ★ 溅射**只从 `targets`（目标选择器解析结果）出发** —— 不区分 primary 是不是施放者自己：
      //   若“自身”是被选择器**正常解析**出来的目标（带 `prefer_self` 的模块默认取到自己、或玩家手动
      //   把自身选为目标、或不带该标签时“己方队列正好轮到自身”），
      //   它就是一个普通 primary → **照常对自身所在队列前后各 N 个存活单位产生溅射**；
      //   反之，**由 `include_self` 标签补入的自身不进 `targets`**（见函数末尾），故**不产生任何溅射**。
      for (const primary of targets) {
        if (!primary) continue;
        // ★ 队列＝**与主目标同侧、同 role** 的视觉顺序队列（`orderedQueueFor`，与战斗界面分区渲染一致）：
        //   主目标是**战斗单位** → 只在战斗队列内前后各 N 个位置波及；是**后勤单位** → 只在后勤队列内波及；
        //   **绝不跨 role 波及**。无后勤单位时该队列 ≡ 既有“目标自己那一侧的整条队列” → 既有行为零变化。
        const roster = orderedQueueFor(primary);
        const idx = roster.findIndex((u) => u.id === primary.id);
        if (idx < 0) continue;
        for (let k = 1; k <= r; k += 1) {
          for (const nb of [roster[idx - k], roster[idx + k]]) {
            if (nb && nb.alive) set.set(nb.id, nb);
          }
        }
      }
    }
    // ★ `include_self` 标签补入的自身：**只并入集合、绝不作为溅射 primary**（两条规则由此自然同时成立）
    if (fx && isType(fx, 'include_self') && ship.alive) set.set(ship.id, ship);
    return [...set.values()];
  }

  /* ---------- 目标级 护盾/血量/能量/矿物 词条管理 ----------
   * 指向"选定目标"的词条（kinds 可含 self/ally/enemy/any）：
   *   量值型（每次激活即时 加/减 当前值，正=加负=减）：
   *       shield_gain_target / hp_target / energy_target / ore_target
   *       · 缩放口径：默认 `词条值 × 本模块类别系数`；带 `type` 标签 `exact_amount` 的模块按**词条原值**；
   *       ★ `ore_target`＝**矿物输送量**：给目标增加矿物，**1:1、不乘任何系数**
   *         （量值落地处单独成支，见下方 `AMOUNT[k] === 'ore'` 分支；与模块是否带标签无关）。
   *   上限型（抬/压 cap，随本模块停用/时长结束/来源失效撤销）：
   *       shield_cap_target / hp_cap_target / energy_cap_target
   * shield_gain / shield_cap_bonus（只作用于自身的旧词条）仍由 recalcDerived 处理。
   */
  const capOverlays = new Map(); // targetId -> Map(sourceModId, {sh,hp,en})
  const AMOUNT = { shield_gain_target: 'shield', hp_target: 'hp', energy_target: 'energy', ore_target: 'ore' };
  const CAPFIELD = { shield_cap_target: 'sh', hp_cap_target: 'hp', energy_cap_target: 'en' };
  /** 类别系数加性修饰词条 → 系数类别（可扩展：加性增益词条名 → `coeff()` 的 category）
   *  如 `attack_coeff_add: 0.2` = **自身** attack 系数 +0.2（base 1.0 → 1.2）；
   *  `shield_coeff_add: 0.1` = **自身** shield 系数 +0.1（作用于护盾池容量，见 modulePoolCapOf）；
   *  `mining_coeff_add: 0.1` = **自身** mining 系数 +0.1（作用于矿物容量模块部分与采矿激光实采量）。
   *  ★ 本表服务于**结算阶段**的条件型/时长型路径（`coeffOps` → `applyCoeffOp`）；
   *    **常驻**（`passive`，无 `duration_ticks`）的同类词条由 ship.js `syncStaticCoeffs` 直接写
   *    同一张 `coeffMods` 表（安装/启停时），二者共用 `setCoeffMod` 与 `clearAllSourceMods` 撤销入口
   *    ——（`_coeff_add` 后缀规则，故新增同族词条**无需**另加特判）。 */
  const COEFF_ADD = { attack_coeff_add: 'attack', shield_coeff_add: 'shield', mining_coeff_add: 'mining' };
  /** 类别系数**乘性**修饰词条 → 系数类别（**预留扩展点，当前无任何词条映射**）。
   *  ★ 注意：`damage_coeff_mul` **不属于**本表 —— 它是**受伤减免系数**（见 DAMAGE_TAKE_MUL），
   *    作用于该单位**受到的**一切伤害、不参与 `coeff()`；本乘性表仅保留给未来“按类别乘性”的词条。 */
  const COEFF_MUL = {};
  /* —— 目标级（走目标选择器的）系数修饰词条 ——
   * ★ 命名铁律：**无 `_target` 后缀＝自身词条**（作用对象＝模块所属单位）；
   *   **带 `_target` 后缀＝目标词条**（作用对象＝`target` 选择器解析出的每个目标）。
   *   目标级记录同样记入 `__pending.coeffOps`（挂在施放方 pending 上），但 `rec.ship` ＝**被作用单位**（逐目标一条）。 */
  const COEFF_ADD_T = { attack_coeff_add_target: 'attack' };
  /** **受伤减免**词条（自身）→ `ship.damageTakeMulMods`：该单位受到的伤害统一乘积（0.95 = 只承受 95%）。
   *  与 `coeff()` 无关：不分类别、不影响护盾池/非伤害量值；结算步骤 2 落地、撤销同其它系数修饰。 */
  const DAMAGE_TAKE_MUL = { damage_coeff_mul: true };
  /** **受伤减免**词条（目标级，`_target` 后缀）：对每个解析目标写其自身的受伤减免 */
  const DAMAGE_TAKE_MUL_T = { damage_coeff_mul_target: true };
  /** **时间系数**词条 → 作用对象上的 `ship.timeCoeffMods`（来源 key → 系数，负=加速 / 正=放缓）。
   *  ★ 语义＝乘在“**需求量**”上（`timeScaled(基础量, 系数)`），**不改每 tick 推进量**（恒为 1）；
   *    多来源组合规则见 ship.js `refreshTimeCoeff()`（当前＝**加性求和**）。
   *  ★ 与 `coeff()`/`damageTakeMul()` 都无关：不改伤害、不改护盾池，只改**计时器的需求量**。 */
  const TIME = { time_coeff: true };
  /** 读回某单位当前已落地的某来源系数修饰值（用于**逐目标**记录的幂等判定：
   *  `_coeffAdd/_coeffMul` 只能记“自身”一条，逐目标必须从表回读）。 */
  function appliedCoeff(ship, key, category, mode) {
    const isMul = mode === 'mul';
    const m = isMul
      ? (ship.coeffMulMods instanceof Map ? ship.coeffMulMods.get(key) : null)
      : (ship.coeffMods instanceof Map ? ship.coeffMods.get(key) : null);
    if (!m || m.category !== category) return isMul ? 1 : 0;
    return isMul ? m.mul : m.add;
  }
  /** 读回某单位当前已落地的某来源**受伤减免系数**（逐目标记录幂等判定用；缺省 1） */
  function appliedTakeMul(ship, key) {
    const m = ship.damageTakeMulMods instanceof Map ? ship.damageTakeMulMods.get(key) : undefined;
    return typeof m === 'number' ? m : 1;
  }

  function ownerOf(inst) {
    for (const s of [...allies, ...enemies]) if (s.modules.includes(inst)) return s;
    return null;
  }

  /** 重算目标三围上限 = 自身(基础 + **常驻静态加成**) + Σ目标级 cap 增/减
   *  每次均从各自基础值(baseShieldCap/baseHpMax/baseEnergyCap)重算，
   *  保证非累加：撤销旧影响后新施加不会在已减值上再叠。
   *  护盾叠加(shield_cap_target)记入“本体池”的 capExtra（随本体池容量由 recalcDerived
   *  一并钳制/汇总）；血量/能量上限、能量恢复与**类别系数加性**（`X_coeff_add`）由 ship.js
   *  **唯一口径 `syncSelfStatics`** 落地（`基准 + Σ自身常驻词条 + 本次传入的目标级叠加`；
   *  系数加性写既有 `coeffMods`），本函数**不再自行复位到基准**
   *  —— 否则会把增幅器类常驻加成（`hp_cap_bonus`/`energy_cap_bonus`/`energy_regen_bonus`）一并抹掉。
   *  ★ 关键：此处只改本体池的 capExtra，绝不触碰护盾【池值】，
   *    且必须让 recalcDerived 以“正确 permanentBonus”统一重算 cap——
   *    若改用 baseShieldPoolOf(其内部 ensureBasePool(…,undefined)) 会把常驻护盾
   *    (如再生护盾)的 permanentBonus 当作 0 而把 cap 算小，ensureBasePool 的
   *    value=min(value,cap) 随即把真实池值钳掉，之后 cap 复原但池值已丢（EMP 清空再生护盾 BUG）。 */
  function recomputeCap(target) {
    const m = capOverlays.get(target.id);
    let sh = 0;
    let hp = 0;
    let en = 0;
    if (m) for (const v of m.values()) { sh += v.sh; hp += v.hp; en += v.en; }
    const pools = target.hull && target.hull.pools;
    let base = pools instanceof Map ? pools.get(BASE_POOL_KEY) : null;
    if (!base) {
      recalcDerived(target); // 本体池缺失：先按正确来源建池（含 permanentBonus）
      base = pools instanceof Map ? pools.get(BASE_POOL_KEY) : null;
    }
    if (base) base.capExtra = sh; // 非累加：仅重设目标级叠加，不动池值
    recalcDerived(target); // 护盾池同步（本体池=baseShieldCap+capExtra+permanentBonus、各模块池）并刷新汇总
    // ★ 自身常驻静态加成（系数加性 / 三围上限 / 能量恢复）与目标级叠加**合并重算**（唯一口径在 ship.js
    //   `syncSelfStatics`；非累加）；当前值只做钳制、不补齐（与护盾池“只加容量不白送”同口径）。
    syncSelfStatics(target, hp, en);
  }

  /** 设置/覆盖本模块对某目标某一 cap(sh/hp/en) 的增/减并立即生效 */
  function setOverlay(target, inst, field, value) {
    if (!capOverlays.has(target.id)) capOverlays.set(target.id, new Map());
    const src = capOverlays.get(target.id);
    if (!src.has(inst.id)) src.set(inst.id, { sh: 0, hp: 0, en: 0 });
    src.get(inst.id)[field] = value;
    recomputeCap(target);
  }

  /** 移除本模块对全部目标的 cap 影响（停用/时长结束/失效时调用）并重算受影响目标 */
  function dropSourceMods(inst) {
    let touched = false;
    for (const m of capOverlays.values()) {
      if (m.has(inst.id)) {
        m.delete(inst.id);
        touched = true;
      }
    }
    if (touched) for (const s of [...allies, ...enemies]) recomputeCap(s);
  }

  /** 启用/停用模块（处理自身被动重算 + 移除其目标级 cap 影响）
   *  ★ 启停会改变【自身常驻静态加成】的合计（增幅器类词条：上限/能量恢复/类别系数加性）
   *    → 必须走 `recomputeCap`（= 护盾池重算 + 唯一口径 `syncSelfStatics`），而**不能**只调
   *    `recalcDerived`：后者不重算三围上限与系数，且若自行复位到基准会把该单位身上**仍在生效的
   *    目标级 cap 叠加**（如电磁脉冲）一并抹掉。`recomputeCap` 会把两者合并重算，非累加、口径唯一。 */
  function enableModule(inst) {
    inst.enabled = true;
    const o = ownerOf(inst);
    if (o) recomputeCap(o); // 重新计入自身常驻加成（含血量/能量上限、能量恢复）
  }
  function disableModule(inst) {
    // ★ 「不可停用」标签（`type` 含 `undeactivatable`）：**引擎侧唯一拒绝点**——
    //   任何来源（UI 开关、控制台调试、将来脚本）调用停用都直接忽略：模块保持启用、
    //   不改任何数值/计时/修饰、不产生战报（因此无需 UI 之外的额外防护）。
    //   返回 false 表示“本次停用被拒绝”（既有调用方忽略返回值，行为不变）。
    if (isUndeactivatable(inst)) return false;
    inst.enabled = false;
    if (inst._ramp) inst._ramp = { key: '', count: 0 }; // 停用 → 逐步伤害成长归零
    // ★ 装载器被停用 ⇒ **立即解锁货物、装载进度归零**（下次从头开始；**已消耗能量不退**）：
    //   与“阵亡解锁”共用同一函数（幂等、零数值变化），且与 `_ramp` 同属“停用即回退的模块私有状态”。
    releaseCargoLoad(inst);
    dropSourceMods(inst); // 移除其施加在其它单位上的护盾上限影响
    // 时间系（时间系数）的撤销置于“施放方是否还在”判空**之前**：其作用集合挂在 `inst._timeRefs` 上、
    // 与被作用单位是否会随施放方一起离开无关，放前面可避免无主模块留下永不撤销的时间系数。
    releaseTime(inst); // 停用 → 撤销其施加在各被作用单位上的时间系数
    releaseStealth(inst); // 停用 → 撤销其施加在各被作用单位上的潜行标记
    const o = ownerOf(inst);
    if (!o) return;
    clearAllSourceMods(o, inst.id); // 停用 → 回退其施加在自身的修饰（系数加/乘 + 受伤减免）
    releaseCoeffRefs(inst); // 停用 → 撤销其施加在各被作用单位上的目标级修饰
    inst._coeffAdd = 0;
    inst._coeffMul = 1;
    inst._takeMul = 1;
    releaseForced(inst); // 停用 → 解除其施加的强制目标（被强制者按其来源栈回落/回到正常优先级）
    if (inst.durationLeft > 0) {
      endDuration(inst); // 停用 → 结束持续期（剩余/已推进一并归 0）
      startCooldown(inst, timeCoeffOf(o)); // 并进入冷却（需求量按当前时间系数、已推进归 0）
    }
    recomputeCap(o); // 结束自身常驻/自身时长加成（口径同 enableModule）
  }

  /** 进入战斗（开始 tick 结算） */
  function start() {
    if (phase !== 'idle') return;
    phase = 'running';
    result = null;
    deathsThisTick = 0; // 死亡计数从零起（首 tick 的"上一 tick 死亡数"＝0 → 不触发任何按阵亡数的词条）
    lastTickDeaths = 0;
    // ★ 星域星区模式（B-1/B-2）：**不订阅全局 ticker、不发全局事件** —— 由星域容器按固定顺序 `step()`
    if (!starfieldMode) {
      // ★ 经 `withSink` 包一层：tick 回调期间战报出口指向**本实例**（入实例缓冲 + 既有全局通道）——
      //   与公开入口 `battle.step()` 走**同一份** `step()` 实现（结算全序一字不变）。
      tickOff = bus.on('tick', () => withSink(step));
      bus.emit('combat:state', { active: true });
    }
    writeLine(i18n.t('battle.log.start'), null); // ★ 经统一战报出口（实例缓冲 ＋ 非星域模式下写全局）
  }

  /** 中止/离开战斗（未结算） */
  function stop() {
    if (tickOff) {
      tickOff();
      tickOff = null;
    }
    const wasActive = phase === 'running';
    phase = 'idle';
    result = null;
    if (wasActive && !starfieldMode) bus.emit('combat:state', { active: false });
  }

  /** 结算完成（随后自动存档） */
  function settle(res) {
    if (phase !== 'running') return;
    phase = 'settled';
    result = res;
    if (tickOff) {
      tickOff();
      tickOff = null;
    }
    if (!starfieldMode) {
      bus.emit('battle:settled', { result: res });
      bus.emit('combat:state', { active: false }); // 结算完成后允许/触发存档
    }
  }

  /* ---------- tick 结算（Pass 0 / Pass 1 行动遍历 / Pass 2 结算遍历） ---------- */

  /** 本 tick 能量回充：**只记账不回写**（数值统一在 Pass2 结算阶段落地）。
   *  返回本次回充额度，供 Pass1 的“单位内运行计数”做门控。 */
  function energyRegenTick(ship, P) {
    const regen = ship.energyRegenPerSec / TPS;
    P.energyRegen += regen;
    return regen;
  }

  /** 模块此刻是否处于"有效贡献窗口"（窗口冻结 → DPS 冻结）。
   *  availEnergy：Pass1 单位内运行计数（tick 起始能量 + 本 tick 回充额度）；
   *  因能量已改为结算阶段落地，此处不能直接读 ship.hull.energy（那只是 tick 起始值）。 */
  function moduleActiveNow(ship, inst, availEnergy) {
    if (!ship.alive || !inst.enabled) return false;
    const fx = inst.cfg.effects;
    const hasDmg = (fx.damage || 0) > 0;
    const hasShield = (fx.shield_gain || 0) > 0;
    if (hasShield && !hasDmg) {
      // 纯回复类：须盾未满且能量足够（满盾/能量不足不算窗口）
      const avail = availEnergy === undefined ? ship.hull.energy : availEnergy;
      return ship.hull.shield < ship.hull.shieldCap && avail >= (fx.energy_cost || 0);
    }
    return true;
  }

  /** 召唤类模块执行：按 fx.summon 补召一个临时单位（携带模组数量不受该单位槽限约束）
   *  - 已达该阵营该单位的"最大召唤数" → 不召唤（保持待命，有空位即补召）
   *  - 能量不足 → 不召唤
   *  - 召唤单位存在 lifespan_ticks tick，到期自动死亡；临时单位阵亡/到期后直接移出场景 */
  /** Pass1 能量消耗：**只记账不回写能量**（结算步骤 3 统一落地），
   *  同时扣减“单位内运行计数”ctx.avail 以便同单位后续模块按序门控。
   *  返回是否支付成功（能量足够）。 */
  function payEnergy(ctx, inst, cost) {
    if (ctx.avail < cost) return false;
    ctx.avail -= cost;
    ctx.P.energySpends.push({ inst, amount: cost });
    return true;
  }

  /** ★ Pass1 **矿物（携带矿物）消耗**：与 `payEnergy` **完全同体例**（唯一区别是成本来源）——
   *  **只记账不回写**（结算步骤 3d-1 统一落地），同时扣减“单位内运行计数” `ctx.oreAvail`
   *  以便同单位后续模块按序门控（含矿物输送：二者共用同一预算 ⇒ 总支出不超 tick 起始携带量）。
   *  返回是否支付成功（携带矿物足够）。成本词条＝`ore_cost`（自身词条，见文件头效果表）。 */
  function payOre(ctx, inst, cost) {
    if (ctx.oreAvail < cost) return false;
    ctx.oreAvail -= cost;
    ctx.P.oreSpends.push({ inst, amount: cost });
    return true;
  }

  /** ★ **召唤者当前生效的单位系数快照**（唯一口径）——召唤物“直接继承召唤者系数数值”的取值来源：
   *  逐类别取 `coeff(ship, 类别)` 的**当前结果**（含船型基础 + 模块加性/乘性 + 当刻目标级系数修饰）。
   *  类别集合＝`COEFF_CATEGORIES` ∪ 召唤者 `coefficients` 既有键（如 `drone`）→ 注入后召唤物系数表**完整确定**。
   *  **只读**：不改召唤者任何数值，不写任何缓存（Pass1 零数值变化铁律）。 */
  function inheritCoefficientsOf(ship) {
    const out = {};
    for (const c of COEFF_CATEGORIES) out[c] = coeff(ship, c);
    for (const c of Object.keys((ship && ship.coefficients) || {})) out[c] = coeff(ship, c);
    return out;
  }

  function doSummon(ship, inst, fx, boundId, ignoreCap, ctx) {
    const sum = (fx.summon && typeof fx.summon === 'object') ? fx.summon : {};
    if (!sum.type) return;
    const side = ship.side;
    // 场上存活上限按"所属召唤模块"(family)计：不同召唤模块即使复用同一船型(如 drone)也不互相挤占。
    // ignoreCap：本次为"按目标数齐射"（per_target），不受该模块在场上限限制。
    if (!ignoreCap) {
      // ★ 上限判据的**唯一分派点**：
      //   · 有容器注入 ⇒ **星域范围计数**（跨星区；见 `createBattle` 的 `summonCountOf` 说明）；
      //   · 无注入（战斗屏 / `LS.drill()`）⇒ **本实例计数**（既有口径一字未改）。
      //   ⚠ “召唤物不随单位迁移” ⇒ 留在源区的召唤物**必须继续占额**，否则迁移后会重复召唤。
      let total = 0;
      if (summonCountOf) {
        total = summonCountOf(side, inst.moduleId);
      } else {
        for (const u of sidesOf(side)) if (u.alive && u.summonMod === inst.moduleId) total += 1;
      }
      if (total >= (sum.maxSummoned || 1)) return; // 已达该模块在场召唤数上限
    }
    const cost = fx.energy_cost || 0;
    // ★ **矿物成本**（`ore_cost`，自身携带矿物）：与能量成本同批、同体例 —— 记账到 `__pending.oreSpends`，
    //   结算步骤 3d-1 统一扣除。**先复核矿物、后付能量**：保证绝不会出现“能量已付、矿物不够、召唤未发生”。
    //   （正常路径下 `maybeActivate` 的成本门控已拦过，此处为同一口径的复核；
    //     `per_target` 齐射逐枚调用本函数 → 逐枚各扣一次，矿物不足时自然中止后续齐射。）
    const oreCost = fx.ore_cost || 0;
    if (oreCost > 0 && ctx.oreAvail < oreCost) return;
    if (!payEnergy(ctx, inst, cost)) return; // 能量不足（用单位内运行计数门控，消耗记账到结算）
    if (oreCost > 0) payOre(ctx, inst, oreCost); // 矿物不足已在上一行拦住 → 此处恒成功
    // —— 用召唤模块给通用无人机"覆写模板"：attrs 按船型结构整条可覆写，缺省沿用模板 ——
    const A = (sum.attrs && typeof sum.attrs === 'object') ? sum.attrs : {};
    // ★ 召唤物**直接继承召唤者的单位系数数值**（激活瞬间快照，唯一口径）：
    //   · 取值＝`coeff(ship, 类别)` 的**当前结果**（含船型基础 + 模块加性/乘性 + 当刻目标级系数修饰）；
    //   · 可继承类别＝**全部**（`attack`/`shield`/`function`/`transport`/`mining` + 船型条目里另有的类别，
    //     如 `drone`）——缺项按 `coeff()` 口径取 1，故写入后召唤物的系数表**完整确定**；
    //   · **注入落点与 `attrs` 同一条覆写链**：写进 `ov.coefficients` → `createShip` 的
    //     `buildTypeCfg` 全条目覆写（`coefficients` 深合并）→ 召唤物实例系数；
    //   · **优先级**：召唤者快照 **覆盖模板默认系数**；`attrs.coefficients` 若显式给出则**逐类别压过**快照
    //     （attrs 是“该召唤品种的显式定义”，比继承值更具体；现网数据无一处使用 → 零回归）；
    //   · **之后不再同步**：召唤者后续系数变化 / 修饰来源失效**都不影响**已召唤单位
    //     （召唤物自身之后只叠加它自己的等级与词条，走既有 `coeff()`）。
    //   · 纯**只读**取值（不改召唤者任何数值）→ 不破坏 Pass1 零数值变化。
    const inheritCoeffs = inheritCoefficientsOf(ship);
    const ov = {
      ...(A.nameKey ? { nameKey: A.nameKey } : {}),
      ...(A.base && typeof A.base === 'object' ? { base: A.base } : {}),
      coefficients: {
        ...(inheritCoeffs || {}),
        ...(A.coefficients && typeof A.coefficients === 'object' ? A.coefficients : {}),
      },
    };
    // temp：缺省 true（临时单位，存在时间到期自动死亡+阵亡直接移除）；
    //     设 false 则召出的是一艘普通单位（无存在时间限制，阵亡保留灰色卡片）
    const isTemp = !(sum.temp === false);
    const u = spawnSummoned(sum.type, side, ov, isTemp);
    u.summonMod = inst.moduleId; // 用于按召唤模块统计在场存活上限（不同召唤模块互不挤占）
    // 临时单位存在时间：基础需求量（未缩放）记在 `tempLifeNeed` 上，需求量按**当时**时间系数整数化，
    // 已推进 tick 数归 0（见 startLife / applyTempTick）。
    if (isTemp) startLife(u, (sum.lifespan_ticks || 0) > 0 ? sum.lifespan_ticks : 60, timeCoeffOf(u));
    u.summonIcon = A.icon || inst.cfg.icon || ''; // 召唤单位图标：attrs.icon 优先，其次模块 icon
    if (sum.projectile) u.isProjectile = true; // 弹体类召唤单位（火箭/导弹）：可被目标词条 exclude 排除
    u.tempNoIcon = !u.summonIcon;                   // 无图标 → 单位降级 ▲
    // 显示名：模块给召唤单位显式指定名称词条(attrs.nameKey)则用之；
    // 模块未指定时才覆写为所属召唤模块名（模板 ship.drone 词条仅作缺省安全回退）。
    if (!A.nameKey) u.nameKey = inst.cfg.nameKey || u.nameKey;
    if (boundId) {
      u.lockTargetId = boundId; // 固定目标：召唤时锁定，不可再改（即使目标阵亡也不切换）
      u.targetId = boundId;
    }
    // 携带模组：等级默认 = 召唤模块等级；若 spec.level 显式给出则用之
    const mods = Array.isArray(sum.modules) ? sum.modules : [];
    for (const m of mods) {
      const spec = m && typeof m === 'object' ? m : { moduleId: m };
      const mid = spec.moduleId ?? spec.id;
      if (!mid) continue;
      const lv = spec.level ? spec.level : (inst.level || 1);
      installModule(u, mid, lv, true); // force：不受该单位模块槽上限约束（cool_first 引信在模块安装时统一处理）
    }
    fillShieldPools(u); // 满盾登场（同 spawnList 逻辑）：本体+模块各池补满
    fillHullVitals(u);  // 满血/满能量登场（同 spawnList 逻辑）：三围已含自身常驻加成（installModule 时重算）
    seedSpawnShields(u); // 自带持续护盾首 tick 即满盾就位
    u._takeMulTick = damageTakeMul(u); // 本 tick 受伤减免快照（新召单位不在本 tick 的 Pass1 名单里）
    u._timeCoeffTick = timeCoeffOf(u); // 同上：本 tick 单位时间系数快照（新召单位同理）
    u._stealthTick = isStealthed(u);   // 同上：本 tick 潜行快照（新召单位同理；唯一读口径 isStealthed）
    // 继承模块所属船舰的自动策略与该船当前目标（仅非锁定单位；锁定单位目标由 boundId 固定）
    if (!boundId) {
      if (ship.policy) u.policy = ship.policy; // ship.policy 为空=跟随全队（召唤物同默认）
      const parentTarget = shipEffectiveTarget(ship);
      if (parentTarget && parentTarget.alive) {
        for (const inner of u.modules) {
          const ifx = (inner.cfg && inner.cfg.effects) || {};
          const ikinds = (inner.cfg && inner.cfg.target && inner.cfg.target.kinds) || [];
          const off = ikinds.includes('enemy') || ikinds.includes('any') || (ifx.damage > 0);
          if (off) inner._stick = [parentTarget.id];
        }
      }
    } else {
      inst._stick = [boundId]; // 发射器持续瞄准同一锁定目标（存活时）
    }
    startCooldown(inst, tickTimeCoeff(ship)); // 召唤后进入冷却（需求量按当前时间系数、已推进归 0）
    battleLog(
      'battle.log.summon',
      {
        ship: uTok(ship),
        unit: uTok(u),
        module: i18n.t(inst.cfg.nameKey),
      },
      ['ship', 'unit']
    );
  }

  /** 单位**剩余矿物容量**（唯一口径：`oreCapacityOf(ship)`【本体 + Σ模块×采矿系数，取整】− `oreLoadOf(ship)`）。
   *  `claimed`＝本 tick 该单位**已认领**的采集量（单位内运行计数，与能量门控 `ctx.avail` 同一体例：
   *   只存在于 Pass1 的局部语境，**不写任何游戏状态**）——同一单位多个采矿模块据此**累加截断**，
   *   保证该单位本 tick 的入库总量不超过剩余容量。 */
  function oreRoomOf(ship, claimed = 0) {
    return Math.max(0, oreCapacityOf(ship) - oreLoadOf(ship) - Math.max(0, claimed || 0));
  }

  /* ---------- ★ 货物装载 · Pass1 口径（速度/时长/剩余容量/对象选择）----------
   * 全部**只读**（读 tick 起始快照 + 单位内在装占用 + 本 tick 认领计数），**零数值变化**。 */

  /** 按 id 取星区货物实体（内部用；装载对象恒取实体本身，不复制） */
  function cargoById(id) {
    return cargos.find((c) => c.id === id) || null;
  }

  /** ★ **本 tick 已被认领的货物实体 id 集合（全局、每 tick 清空）** —— **货物链三处共用**：
   *   「货物传输」`cargo_transfer`、「货物维修」`cargo_repair`、「货物强化」`cargo_enhance`。
   *   · **为什么是全局而非单位内**：前两者只从**自己**货舱取货 ⇒ 本来不可能争用；但「货物强化」作用于
   *     **目标单位**的货舱（可为他人）⇒ 与“该目标自己的传输/维修”可能同时看中同一件 ⇒ 必须**同一集合**才挡得住。
   *   · 语义＝**先到先得**（与星区侧 `sectorClaimedTick`、“本 tick 只接受第一个”完全同体例）：
   *     收集顺序＝**固定结算顺序（allies → enemies）** ⇒ 确定性、可复现；
   *   · 同一单位多模块也共用它 ⇒ 同单位多模块**不会搬运/消耗/强化同一件**（原单位内预留口径被它涵盖、更强）；
   *   · 只存在于**本 tick 的 Pass1 语境**（每 tick 起始 `clear()`），**不写任何游戏状态**（零数值变化）。 */
  const cargoClaimedTick = new Set();

  /** ★ **可用于传输/消耗/强化的「已入舱货物」清单**（唯一口径；货物链三处共用）：
   *   · 数据源＝**唯一实体清单** `cargoListOf(ship)`（＝`ship.cargos`）；
   *   · ★ **在装（锁定中、尚未入舱）的货物不可用**：`landCargoOn`（步骤 5）是**唯一入舱写入者**，
   *     在装期间货物仍在**星区列表**、根本不在 `cargos` 里 ⇒ 天然被排除；此处再按 `cargo._loadBy`
   *     **防御性复核**（在装货物恒带锁定索引；正常不会出现在本清单内）⇒ 双保险；
   *   · 再排除**本 tick 已被认领**者（`cargoClaimedTick`，见上）；
   *   · `unenhancedOnly` ＝ true 时再排除**已被强化过一次**的货物（`cargo.enhanced`，一次性标记）——
   *     供「货物强化」的候选池使用（其余两处不传，语义不变）；
   *   · **纯函数**（只读，不写任何状态）。 */
  function availableCargosOf(ship, unenhancedOnly) {
    return cargoListOf(ship).filter(
      (c) =>
        c &&
        !c._loadBy &&
        !cargoClaimedTick.has(c.id) &&
        !(unenhancedOnly && c.enhanced)
    );
  }

  /** ★ **被搬运/被消耗/被强化货物的选择口径（唯一处）**：
   *   · `mode === 'fifo'`（**货物传输**，以及**货物强化**）＝**按货舱列表顺序（先入舱者先被处理）
   *     取第一件「可用」的**；★ 若给了 `maxTons`（＝**目标当前剩余货舱**）⇒ **取第一件「装得下」的**
   *     —— 这就是**货物传输的“顺延”口径**（用户口径：队首吨位超出目标容量时**往后顺延**继续找，
   *     直到找到装得下的那一件；**全部装不下 ⇒ 返回 null**＝调用方不激活、不耗能、不进冷却）。
   *     仍**只取一件**（“多件累加”不在本轮口径内）；
   *   · `mode === 'min'` （**货物维修**）＝**吨位最小优先**，**同吨位 ⇒ 货舱列表顺序**（先入舱者先被消耗）；
   *     ★ **`maxTons` 对维修不适用**（消耗货物不进入其它货舱 ⇒ 无“装得下”约束；内部不参与筛选）；
   *   · 两者都是**确定性**规则：列表顺序＝入舱顺序（`cargos` 数组顺序可复现），选取**只读**、不写状态；
   *   · 无可用货物 ⇒ `null`（调用方据此不激活）。 */
  function pickCargoOf(ship, mode, unenhancedOnly, maxTons) {
    const list = availableCargosOf(ship, unenhancedOnly);
    if (!list.length) return null;
    if (mode !== 'min') {
      // fifo（缺省）：列表顺序**顺延**到第一件装得下的（`maxTons` 未给＝不设容量约束 ⇒ 恒取首件）
      const cap = maxTons == null ? null : Math.max(0, maxTons);
      for (const c of list) {
        if (cap != null && Math.max(0, c.tons || 0) > cap) continue; // 装不下 ⇒ **顺延**下一件
        return c;
      }
      return null; // 全部装不下 ⇒ 无可用货物（调用方不激活）
    }
    let best = list[0];
    let bestTons = Math.max(0, best.tons || 0);
    for (let i = 1; i < list.length; i += 1) {
      const t = Math.max(0, list[i].tons || 0);
      if (t < bestTons) {
        best = list[i];
        bestTons = t; // **严格小于** ⇒ 同吨位保留更靠前者（先入舱者）＝并列时的确定顺序
      }
    }
    return best;
  }

  /** 货物在战报里的显示名（**与 UI 芯片同一口径**：用户自定义名优先 → 类型名 i18n → 类型标签原样）。 */
  function cargoNameForLog(cargo) {
    if (!cargo) return '';
    return cargo.name || (cargo.nameKey ? i18n.t(cargo.nameKey) : cargo.type || '');
  }

  /** ★ 装载**速度**（唯一口径）：`1 + 词条 cargo_load + (coeff(拥有者,'transport') − 1)`。
   *  · 词条＝`effects.cargo_load`（装载速度加成；缺省 0 ⇒ 速度为运输系数本身）；
   *  · 运输系数取**唯一读口径** `coeff(ship,'transport')`（与货舱容量缩放类别同一口径）；
   *  · 防御：速度非正（数据异常/系数被压到 ≤0）时**按 1 处理**（避免除零/负需求）。 */
  function cargoLoadSpeedOf(ship, inst) {
    const bonus = ((inst && inst.cfg && inst.cfg.effects) || {}).cargo_load || 0;
    const speed = 1 + bonus + (coeff(ship, 'transport') - 1);
    return speed > 0 ? speed : 1;
  }

  /** ★ 装载**需求时长**（唯一口径）：`max(1, round(货物装载时间 ÷ 速度))`，**下限 1t**。
   *  ★ **取整（Math.round）与下限（Math.max(1, …)）只在本函数发生一次**：唯一调用点＝
   *    `maybeActivate` 的装载记账处（激活成功后才算），结果**随意图一起冻结**进
   *    `__pending.cargoLoadOps.need` ⇒ 结算阶段**不再重算**、本 tick 内系数变化**不会**改动它
   *    （与 `ore_gain` 的实采量“Pass1 用本 tick 快照算好再记账”**同一体例**：快照稳定、可复现）。 */
  function cargoLoadNeedTicks(ship, inst, cargo) {
    const ticks = Math.max(0, (cargo && cargo.loadTicks) || 0);
    return Math.max(1, Math.round(ticks / cargoLoadSpeedOf(ship, inst)));
  }

  /** ★ 单位**剩余货物容量**（唯一口径：`cargoCapacityOf(ship)` − `cargoLoadOf(ship)` − 占用）。
   *  `claimed`＝本 tick 该单位**已认领**的装载吨位（单位内运行计数，与 `ctx.oreClaimed` 同体例）；
   *  另计入**在装占用**（`inst._load.cargo.tons`：已锁定但尚未入舱者**提前预留**吨位）——
   *  二者互不重叠（在装＝往 tick 起算的既有状态，认领＝本 tick 新记的意图）⇒ 不会重复扣减。
   *  与 `oreRoomOf` 同一体例：**只读、不写**（不破坏 Pass1 零数值变化）。 */
  function cargoRoomOf(ship, claimed = 0) {
    let used = cargoLoadOf(ship) + Math.max(0, claimed || 0);
    for (const inst of ship.modules || []) {
      const ld = inst._load;
      if (ld && ld.cargo) used += Math.max(0, ld.cargo.tons || 0);
    }
    return Math.max(0, cargoCapacityOf(ship) - used);
  }

  /** ★ **玩家手动卸载标记是否对某阵营的装载器生效**（**唯一判据**，装载选取处调用）：
   *  · 生效条件（**两条同时满足**）：
   *      ① **阵营相同**：`cargo.manualUnloadedSide === side`（记的是**卸载者所属阵营**，
   *         取值＝单位 `side` 的 `'ally'`/`'enemy'`，**不另造一套阵营词**）⇒ **敌对方不受影响**；
   *      ② **未到期**：`runTicks < cargo.manualUnloadedUntil`（**绝对到期 tick 模型**：没有逐 tick
   *         递减 ⇒ 不抖动、与遍历顺序无关、双方镜像对等、确定可复现；到期后自动失效、无需清理）；
   *  · `side` 缺省/为空（无阵营语境）⇒ 判为**不生效**（只读、纯函数、不写状态）；
   *  · **唯一读口径**：`pickLoadableCargo` 与星区只读快照（`get sector()` 的派生字段）都走本函数
   *    ⇒ **UI 不自算**，两处永不漂移。 */
  function cargoManualUnloadActive(cargo, side) {
    if (!cargo || !side) return false;
    if (cargo.manualUnloadedSide !== side) return false;
    return runTicks < Math.max(0, cargo.manualUnloadedUntil || 0);
  }

  /** ★ 装载对象选择（**唯一口径**）：返回本 tick 该模块**应装载的货物实体**（无可装者 ⇒ null）。
   *  顺序＝**优先队列优先**（按 `cargoQueue` 顺序，**队首最先**）**> 默认队列**（未被选入队列者
   *  按星区列表顺序）；逐件判定，**不可用即跳过并继续找下一件**：
   *    (a) 已被锁定（`cargo._loadBy`：别的装载器正装着它）；
   *    (a2) **玩家手动卸载且对本阵营生效中**（`cargoManualUnloadActive(c, ship.side)`：阵营相同 +
   *       未到 `manualUnloadedUntil`）—— 见文件头「玩家手动卸载的排除口径」；
   *    (b) **本 tick 已被认领**（`loadClaimedTick`：同一 tick 内每件货物**只被认领一次**）；
   *    (c) 本舰**剩余货舱装不下**（`cargoRoomOf < 货物 tons`）。
   *  **纯函数**（只读，不写任何状态）：`canImpact` 门控与 `resolveLoadClaims` 认领**调用同一函数**、
   *  读同一份快照 ⇒ 两处结果必然一致（不会出现“门控通过但认领时选不到”）。
   *  ⚠ 认领标记 `loadClaimedTick` 由 `resolveLoadClaims` 按**速度优先**逐条写入（每 tick 起始清空）；
   *     `canImpact` 调用时该集合尚空 ⇒ 该判定只承担“有没有货可装”的预筛。 */
  function pickLoadableCargo(ship, inst, ctx) {
    const claimed = (ctx && ctx.cargoClaimed) || 0;
    const room = cargoRoomOf(ship, claimed);
    if (room <= 0) return null; // 剩余货舱为 0 → 任何货物都装不下（不激活）
    const seen = new Set();
    const ordered = [];
    for (const id of cargoQueue) {
      const c = cargoById(id);
      if (c && !seen.has(c.id)) {
        seen.add(c.id);
        ordered.push(c); // ① 优先队列（队首最先）
      }
    }
    for (const c of cargos) if (!seen.has(c.id)) ordered.push(c); // ② 其余按星区列表顺序
    for (const c of ordered) {
      if (c._loadBy) continue;                     // (a) 已被锁定
      // ★ (a2) **玩家手动卸载**（分阵营 + 带时限）：**只对本阵营**的装载器生效、到期自动失效；
      //     排除只针对“自动选取”，玩家把它加入优先队列即立即清除标记（见 `toggleCargoQueue`）。
      if (cargoManualUnloadActive(c, ship.side)) continue;
      if (loadClaimedTick.has(c.id)) continue;     // (b) 本 tick 已被认领
      if (Math.max(0, c.tons || 0) > room) continue; // (c) 本舰装不下 → 跳过并试下一件
      return c;
    }
    return null;
  }

  /** ★ 装载器 **Stage A**：登记一条**认领申请**（Pass1 记账，**零数值变化**）。
   *  · `speed` 在登记时按**唯一速度口径** `cargoLoadSpeedOf` 算好（裁决排序 + 需求时长**共用同一函数**）；
   *  · `order` ＝**固定遍历序**（本数组下标；Pass1 按 allies → enemies、组内既定模块顺序单调递增）
   *    ⇒ 速度并列时的**确定性**依据（稳定、可复现）。 */
  function queueLoadClaim(ship, inst, ctx) {
    loadClaims.push({
      ship,
      inst,
      ctx, // 单位内运行语境（能量预算 ctx.avail 在裁决时按同一预算扣减 ⇒ 口径不变）
      speed: cargoLoadSpeedOf(ship, inst), // ★ 唯一速度口径（不另算第二套）
      order: loadClaims.length,
    });
  }

  /** ★ **装载器认领裁决**（Pass1 末尾、Phase A 之前；**唯一裁决点**；仍属 Pass1 ⇒ 零数值变化）：
   *  · **排序（全局跨阵营统一）**：所有申请**一起**按**装载速度从高到低**排序 —— 同一件货物对
   *    **全体装载器只有一个赢家**，与阵营无关（速度就是唯一优先级；**不是**“先按阵营再按速度”分组）；
   *  · **同速判定**：按**固定结算顺序**（`order`：allies → enemies、组内既定模块顺序）先到先得
   *    ⇒ **确定、可复现**；这与本引擎其它“同 tick 争抢”的既有口径**完全同体例**
   *    （`sectorClaimedTick` 星区冷却“固定顺序只接受第一个”、`ctx.oreClaimed` 采矿预算同源），
   *    不另造第二套规则；
   *  · **镜像对等**：速度不同 ⇒ 胜负**只由速度决定**（两侧互换后完全对称）；
   *    速度相同 ⇒ 沿用既有争抢口径的固定顺序裁决（allies 侧优先）——这是**既有确定性约定的沿用**，
   *    不是新增偏向规则（若要求同速也完全对称，须给同速再引入一个与阵营无关的键，当前引擎无此键）。
   *  · **逐申请依次裁决**：获胜者调用**既有的唯一选择口径** `pickLoadableCargo` 取第一件可用货物
   *    （`_loadBy` 锁定 / 本 tick 已认领 / 货舱装不下 ⇒ 跳过并试下一件），随后按**与其它模块激活尾部
   *    一字不差**的口径记账：**耗能（只记账）→ 冷却（按 tick 起始时间系数）→ pending 装载意图
   *    → 激活统计**；并累加**单位内认领吨位**（裁决局部计数，体例同 `ctx.oreClaimed`）。
   *  · **能量不足 / 已阵亡 / 已停用 / 已在装 ⇒ 该申请整体作废**（不认领、不耗能、不进冷却、不计激活），
   *    货物留给**后续申请者**（即速度次高者）⇒ “能量不足不激活”语义不变。 */
  function resolveLoadClaims() {
    if (!loadClaims.length) return;
    const sorted = [...loadClaims].sort((a, b) => b.speed - a.speed || a.order - b.order);
    const claimTons = new Map(); // 单位（对象引用）→ 本 tick 已认领吨位（裁决局部，不写进任何游戏状态）
    for (const c of sorted) {
      const ship = c.ship;
      const inst = c.inst;
      const ctx = c.ctx;
      if (!ship || !inst || !ctx) continue;
      if (!ship.alive || !inst.enabled) continue; // 本 tick 已阵亡 / 已停用 ⇒ 申请作废
      if (inst._load) continue;                   // 已在装（防御：Pass1 门控已挡住）
      const fx = inst.cfg.effects || {};
      const cost = fx.energy_cost || 0;
      if (ctx.avail < cost) continue;             // 能量不足 ⇒ 不激活、不耗能（货物留给后续申请者）
      const claimed = claimTons.get(ship) || 0;
      const cargo = pickLoadableCargo(ship, inst, { cargoClaimed: claimed });
      if (!cargo) continue;                       // 无可用货物 ⇒ 不激活（不耗能、不进冷却）
      loadClaimedTick.add(cargo.id);              // ★ 认领：本 tick 该件货物不再被别人认领
      claimTons.set(ship, claimed + Math.max(0, cargo.tons || 0));
      payEnergy(ctx, inst, cost);                 // 能量：Pass1 只记账（结算步骤 3 统一落地）
      startCooldown(inst, tickTimeCoeff(ship));   // 冷却：按 tick 起始时间系数（与其它模块同口径）
      if ((fx.hp_below_activate || 0) > 0) inst._firedOnce = true; // 低血门控标记：裁决获胜才算“真正激活”
      const P = pendOf(ship);
      if (P) {
        P.cargoLoadOps.push({
          inst,
          ship,
          cargo,
          need: cargoLoadNeedTicks(ship, inst, cargo), // 需求时长（含取整与下限，唯一实现在该函数内）
        });
      }
      // 激活统计（与 `maybeActivate` 尾部同一口径）：本 tick 真正激活一次
      inst._pendingAct = { dmg: 0, shield: 0 };
      inst.stats.activations += 1;
      inst.stats.energySpent += cost;
    }
  }

  /* ---------- ★ 星区词条（直接改**星区矿物储量**的模块：创世纪 / 矿藏富集）---------- */
  /** 星区词条 → 归一化操作类型（**唯一登记表**，与既有 `COEFF_ADD`/`AMOUNT` 同一体例）：
   *  · `sector_ore_add` ＝ **绝对增量**（＋固定值）；
   *  · `sector_ore_mul` ＝ **增量比例**（0.1 ⇒ 当前剩余储量 ×(1+0.1)）。
   *  ⚠ 作用对象＝**星区**（战场全局）：既非自身词条也非目标词条 —— 无 `_target` 后缀、
   *    也不作用于模块所属单位；模块需**无目标**（`target: {}`）、不进目标选择链。 */
  const SECTOR_WORDS = { sector_ore_add: 'add', sector_ore_mul: 'mul' };
  /** 该模块实例的星区词条（无则 `null`）：`{ key, kind }`，kind='add'|'mul'。 */
  function sectorWordOf(inst) {
    const fx = inst && inst.cfg && inst.cfg.effects;
    if (!fx) return null;
    for (const k of Object.keys(SECTOR_WORDS)) {
      if ((fx[k] || 0) !== 0) return { key: k, kind: SECTOR_WORDS[k] };
    }
    return null;
  }
  /* ---------- ★ 星区侧冷却词条（`sector_cd_ticks`）——与模块 id **解耦** ----------
   * ★ 用户口径：**词条存在即代表该模块参与星区冷却**（按词条识别、不硬编码模块 id）——
   *   以后任何模块只要带上该词条，就自动受星区侧冷却约束（门控 + 落地 + UI 冷却行枚举**同源**）。
   *   识别口径的唯一实现在 `data/sector.js`（`hasSectorCdFx` / `sectorCdTicksFx`），
   *   本层只做两个薄封装：
   *     · `sectorCdTicksOf(inst)` → 该模块的星区侧冷却**基础时长**（`null`＝不参与）；
   *     · `hasSectorCd(inst)`     → 是否参与星区冷却（引擎门控与 UI 枚举共用同一判据）。
   * ★ 时长来源＝**本词条**（不再取 `cooldown_ticks`）：`cooldown_ticks` 只管**实例自身**冷却；
   *   两把冷却相互独立、需**同时就绪**才可激活（门控见 `canImpact`）。 */
  function sectorCdTicksOf(inst) {
    return sectorCdTicksFx(inst && inst.cfg && inst.cfg.effects);
  }
  function hasSectorCd(inst) {
    return hasSectorCdFx(inst && inst.cfg && inst.cfg.effects);
  }
  /** 战报里的**模块拥有者名段**（`ownerOf` + `uTok`；异常兜底为中性占位）——
   *  与 `stealthStart` 等处同一写法，供星区/采矿类战报共用，避免各处重复兜底。 */
  function ownerTok(inst) {
    const holder = inst ? ownerOf(inst) : null;
    return holder ? uTok(holder) : { side: null, label: '—' };
  }
  /** **星区侧**该模块的冷却是否已结束（唯一读口径；`runTicks` 为当前 tick 号、tick 内恒定）。 */
  function sectorCdReady(moduleId) {
    const until = sectorCdUntil.get(moduleId);
    return until == null || runTicks >= until;
  }
  /** **星区侧**该模块的剩余冷却 tick 数（唯一读口径；0＝就绪）。**UI 只读它，不自算**。 */
  function sectorCdRemain(moduleId) {
    const until = sectorCdUntil.get(moduleId);
    return until == null ? 0 : Math.max(0, until - runTicks);
  }

  /** 激活前可行性：时长型加盾模块（未在持续期即可激活）；纯增益须对某目标生效。
   *  `ship` ＝施放方自身（自身词条的判定对象），`targets` ＝本次解析出的目标（目标级词条的判定对象）。
   *  `ctx`（可选）＝本 tick 的单位内运行语境：`oreClaimed`（采矿“本 tick 已认领量”，只进不减）、
   *   `oreAvail`（**本 tick 可动用的携带矿物预算**，矿物成本/矿物输送共用，只减不进）；
   *   `cargoClaimed`（装载：本单位本 tick 已认领吨位；由 `resolveLoadClaims` 的裁决局部计数传入，
   *   裁决外恒为 0——`canImpact` 的装载预筛只判“有没有货可装”）；
   *   ★ **货物实体预留不走 `ctx`**：货物链三处（传输/维修/强化）共用**全局每 tick 集合**
   *   `cargoClaimedTick`（见「货物装载」段顶部说明）——因为「货物强化」会作用于**目标单位**的货舱，
   *   必须与“该目标自己的传输/维修”共用同一集合才挡得住争用；其它词条不读 `ctx`。 */
  function canImpact(ship, targets, fx, inst, ctx) {
    // ★ **星区侧冷却门控**（独立词条 `sector_cd_ticks`，或带星区效果词条 `sector_ore_add`/`sector_ore_mul`）：
    //   **混合冷却门控**的**唯一落点**（Pass1 唯一门控出口），**先于其它效果词条判定**——
    //   ① 实例自身冷却 由既有的 `inst.cooldown > 0` 前置判定承担（本函数之前）；
    //   ② **星区侧该模块冷却**（时长取 `sector_cd_ticks`）：未结束 → 不激活；
    //   ③ 本 tick 星区**已被同一模块接受**（固定顺序只取第一个）→ 不激活。
    //   不满足一律**不激活、不耗能、不进冷却**（沿用既有口径）。
    //   ⚠ 只带星区冷却词条、效果另算的模块：本门控照旧生效，随后**继续走下面的常规判定**
    //     （不在此提前 `return true`）。
    const secW = sectorWordOf(inst);
    const secCd = sectorCdTicksOf(inst);
    if (secW || secCd != null) {
      if (!sectorCdReady(inst.cfg.id)) return false;
      if (sectorClaimedTick.has(inst.cfg.id)) return false;
    }
    // ★ 自身词条·装载（`type` 标签 `cargo_loader`，如装载光束）：**装载器门控**（唯一出口）——
    //   ① **每模块实例同一时刻至多 1 件在装**（`inst._load` 非空＝忙）→ 不激活、不耗能、不进冷却
    //      （这正是“装载期间不再重复扣能量”的落点）；
    //   ② 必须存在**可装货物**：未锁定 / 本 tick 未被认领 / 本舰剩余货舱装得下
    //      ⇒ 无 → 不激活（此处只做“**有没有货可装**”的预筛，**不认领**：真正的裁决在
    //      `resolveLoadClaims()`，按**装载速度从高到低**跨阵营统一排序 ⇒ 本预筛失败者必然也拿不到货）。
    //   ⚠ 与采矿 `ore_gain` 同体例：**不进目标选择链**，但仍走本函数（唯一门控出口）；
    //     能量门控在 Pass1 成本门控处 + 裁决处（同 `energy_cost` 既有口径），本处不重复。
    if (isType(fx, 'cargo_loader')) {
      if (inst && inst._load) return false;
      return pickLoadableCargo(ship, inst, ctx) != null;
    }
    // ★ 自身词条·采矿（`ore_gain`，无 `_target` 后缀 ⇒ 作用于模块所属自身）：按施放方
    //   **剩余矿物容量**与**星区剩余储量**判定 —— 二者任一为 0 → 不可影响 → 本次不激活（不耗能、不进冷却）。
    //   与“无可生效目标不激活”共用本函数这一**唯一出口**，不新造第二套判定。
    //   注：储量读的是**本 tick 起始**值（储量只在结算步骤 3b 变化）→ 同 tick 内恒定、与遍历顺序无关。
    if ((fx.ore_gain || 0) > 0) {
      return oreRoomOf(ship, ctx && ctx.oreClaimed) > 0 && oreReserve > 0;
    }
    // ★ 星区效果词条（创世纪 / 矿藏富集）：无目标级判定，双冷却就绪即可激活；
    //   ④ `sector_ore_mul` 额外要求**星区剩余储量 > 0**（储量 0 时乘法恒无效果，不白耗能、不进冷却；
    //      与采矿“剩余容量为 0 → 不激活”完全同体例。加法 `sector_ore_add` 不受此限）。
    if (secW) {
      if (secW.kind === 'mul' && Math.floor(oreReserve) <= 0) return false;
      return true;
    }
    if ((fx.damage || 0) > 0) return true;
    // ★ **自身词条·矿物成本**（`ore_cost`，如矿渣导弹发生器）：从**自身携带矿物**中扣除，
    //   与能量成本**完全同体例**（唯一读口径 `oreLoadOf`；单位内运行计数 `ctx.oreAvail`）——
    //   携带不足 → **不可影响 → 不激活、不扣矿物、不进冷却**。
    //   ⚠ 召唤型模块按既有设计不进入本函数（其成本门控与能量门控同处，见 maybeActivate/doSummon），
    //     本支为**同一口径的复核与扩展点**：将来任何非召唤模块带 `ore_cost` 也在同一出口拦住。
    //   ⚠ 不在此提前 `return true`：本词条是**成本**、不是效果，继续走后面的常规效果判定。
    if ((fx.ore_cost || 0) > 0) {
      const oreLeft = ctx && ctx.oreAvail != null ? ctx.oreAvail : oreLoadOf(ship);
      if (oreLeft < fx.ore_cost) return false;
    }
    // ★ **目标级量值词条·矿物输送**（`ore_target`，正值＝给目标增加矿物）：**1:1、不乘任何系数**。
    //   门控（与能量输送的“目标已满不激活”同体例，但多一条“自身携带不足不激活”）：
    //     ① 自身**剩余携带矿物** < 词条值 → 不可影响（不激活、不耗能、不进冷却）；
    //        （剩余＝tick 起始携带量 − 本 tick 已记账的矿物支出 `ctx.oreAvail`，单位内运行计数）
    //     ② 目标**剩余矿物容量**为 0（已满）→ 不可影响（唯一读口径 `oreRoomOf`）；
    //     ③ 目标容量不足但 > 0 → **照常激活**，实际输送量在 Pass1 按
    //        `min(词条值, 自身剩余携带, 目标剩余容量)` 截断、按**实际量**结算。
    //   ⚠ 必须放在下面的通用量值循环**之前**：通用循环按“目标是否未满”判定，不含施放方携带量口径。
    if ((fx.ore_target || 0) > 0) {
      const oreLeft = ctx && ctx.oreAvail != null ? ctx.oreAvail : oreLoadOf(ship);
      if (oreLeft < fx.ore_target) return false;
      if (!targets.some((t) => oreRoomOf(t) > 0)) return false;
      return true;
    }
    // ★ **货物传输**（`type` 标签 `cargo_transfer`，如「货物传输」）：把**整整一件已入舱货物**送给目标。
    //   门控（**零数值变化**，与 `ore_target` 的“施放方有货 + 目标装得下”完全同体例）：
    //     ① 自身**无已入舱货物** → 不可影响（不激活、不耗能、不进冷却）；
    //        「已入舱」唯一口径＝唯一实体清单 `cargoListOf(ship)`（在装货物不在其内 ⇒ 天然不可传输）；
    //     ② ★ **顺延口径**（用户口径）：按货舱列表顺序找**第一件目标剩余货舱装得下**的货物
    //        （唯一实现 `pickCargoOf(ship,'fifo',false, cargoRoomOf(t))` —— 首件装不下就**往后顺延**；
    //        全部装不下 ⇒ 返回 null）⇒ 本处判据＝“**存在**某个存活目标，对它**确有**这样一件货”；
    //     ③ 能量不足由本函数之外的成本门控拦住（与既有口径同一处）。
    //   ⚠ 必须放在通用量值循环**之前**：被搬运的是**实体**，不是 AMOUNT 表里的量值词条。
    if (isType(fx, 'cargo_transfer')) {
      return targets.some((t) => t.alive && pickCargoOf(ship, 'fifo', false, cargoRoomOf(t)) != null);
    }
    // ★ **货物维修**（`type` 标签 `cargo_repair`，如「货物维修」）：消耗**一整件已入舱货物**换回血。
    //   门控（**零数值变化**）：
    //     ① 自身**无已入舱货物** → 不可影响（口径同上：唯一实体清单 `cargoListOf(ship)`）；
    //     ② 目标**已满血** → 不可影响（沿用既有 `hp_target` 的 `atCap` 判据 `t.hull.hp >= t.hull.hpMax`）；
    //     ③ 能量不足由成本门控拦住（同一处）。
    //   ⚠ `hp_per_ton` **不是** AMOUNT 表里的目标级量值词条（它只是**派生回血量的系数项**）⇒ 通用循环
    //     看不到它，必须在此单独成支；这也正是“回血量不乘类别系数”的实现方式（见 maybeActivate 记账处）。
    if (isType(fx, 'cargo_repair')) {
      const cargo = pickCargoOf(ship, 'min'); // 选择口径：吨位最小优先（同吨位按货舱列表顺序）
      if (!cargo) return false;
      return targets.some((t) => t.alive && t.hull.hp < t.hull.hpMax);
    }
    // ★ **货物强化**（`type` 标签 `cargo_enhance`，如「货物强化」）：把**目标货舱里一件尚未被强化**的
    //   货物加成系数**加性**提高 `bonus_add`（一次性、永久）。
    //   门控（**零数值变化**）：
    //     ① **目标货舱中没有任何「尚未被强化」的货物** → 不可影响（不激活、不扣矿、不耗能、不进冷却）——
    //        判据＝对**目标单位**调唯一选择口径 `pickCargoOf(target,'fifo',true)`（内部即候选池
    //        `availableCargosOf(target, true)`）：**只取已入舱的货物**（在装货物不在货舱清单内 ⇒
    //        天然不可被强化）、**本 tick 未被任何单位认领**、**尚未被强化过**；返回 null ⇒ 不可影响；
    //     ② **矿物不足**（`ore_cost`）→ 既有成本门控拦住（单位内预算 `ctx.oreAvail`）；
    //     ③ **能量不足**（`energy_cost`）→ 同上（`ctx.avail`）。
    //   ⚠ 必须放在通用量值循环**之前**：`bonus_add` **不是** `AMOUNT` 表里的目标级量值词条
    //     （它作用在**货物实体**上、且**不乘类别系数**）⇒ 通用循环看不到它，必须单独成支。
    if (isType(fx, 'cargo_enhance')) {
      const add = fx.bonus_add || 0;
      if (!(add > 0)) return false; // 词条缺失/非正 ⇒ 无可施加效果（防御性，正常不会发生）
      return targets.some((t) => t.alive && pickCargoOf(t, 'fifo', true) != null);
    }
    // 目标级量值词条（shield/hp/energy）：负(削减)恒可影响；正(增益)需存在未满目标
    for (const k of Object.keys(AMOUNT)) {
      const v = fx[k] || 0;
      if (!v) continue;
      const f = AMOUNT[k];
      const atCap = (t) =>
        f === 'shield'
          ? t.hull.shield >= t.hull.shieldCap
          : f === 'hp'
            ? t.hull.hp >= t.hull.hpMax
            : f === 'ore'
              ? oreRoomOf(t) <= 0 // 矿物：按**剩余矿物容量**判定（唯一口径 oreRoomOf，UI/引擎同源）
              : t.hull.energy >= t.hull.energyCap;
      if (v < 0) return true;
      if (targets.some((t) => !atCap(t))) return true;
      return false; // 全满且为正增益 → 无益，不激活
    }
    // 目标级上限词条：恒可影响
    for (const k of Object.keys(CAPFIELD)) if ((fx[k] || 0) !== 0) return true;
    // 目标级系数/受伤减免修饰词条（`*_target` 后缀）：恒可影响（对每个解析目标施加）
    for (const k of Object.keys(COEFF_ADD_T)) if ((fx[k] || 0) !== 0) return true;
    for (const k of Object.keys(DAMAGE_TAKE_MUL_T)) if ((fx[k] || 0) > 0) return true;
    // `force_target_self` 为 `type` 标签（不是词条）：按标签恒可影响（作用集合由目标选择器给出）
    if (isType(fx, 'force_target_self')) return true;
    // 时间系数词条（`time_coeff`）：恒可影响（作用集合＝目标 ∪ 波及 ∪ 自身，见 effectSetOf）
    //  ★ 系数可正可负（加速/放缓皆是有效效果），故判定用 `!== 0` 而非 `> 0`。
    for (const k of Object.keys(TIME)) if ((fx[k] || 0) !== 0) return true;
    // `shield_gain` 为**自身词条** → 按施放方自身是否缺盾判定（不再看目标）
    if ((fx.shield_gain || 0) > 0 && ship && ship.hull.shield < ship.hull.shieldCap) {
      return true;
    }
    if ((fx.duration_ticks || 0) > 0 && (fx.shield_cap_bonus || 0) > 0) {
      return !inst || inst.durationLeft <= 0; // 效果未在持续期 → 可激活
    }
    const tags = Array.isArray(fx.type) ? fx.type : fx.type ? [fx.type] : [];
    if (tags.length) return true; // 特殊效果视为可影响（预留）
    return false;
  }

  /* ---------- pending 记账 ----------
   * 每个存活单位一个 __pending，Pass 1 写入、Pass 2 统一结算：
   *   dmg:           本 tick 对该单位造成的伤害（主目标/爆炸波及条目，含反射来源信息）
   *                  每条 { actor, inst(来源模块), amount, blast, splash, gate? }
   *   shieldHeals:   对本单位自身池的 补盾(正)/汲取(负) 序列（`shield_gain_target`＝目标级：记在被作用目标上；
   *                  `shield_gain`＝**自身词条**：记在施放方自己的 pending 上，即作用于自身），
   *                  每条 { inst, amount }，用于 Pass2 顺序 poolShieldAdd。
   *   energyDeltas:  对本单位能量的直接增/减序列（energy_target），每条 { inst, amount }。
   *   hpDeltas:      对本单位血量的直接增/减序列（`hp_target`），负可致死，每条 { inst, amount }。
   *                  ★ 常驻被动「回收利用」的按阵亡回血（`hp_regen_per_death`）**复用本序列**
   *                  （每条另带 `regen:true` 仅用于结算阶段记低频战报）：Pass1 只读上一 tick 阵亡数
   *                  快照 `lastTickDeaths` 记账，结算步骤 4c 与 hp_target 同批 `applyHpTo` 落地。
   *   selfDestruct:  { inst, amount }｜null —— self_destruct_damage（对本单位自身直接扣/回血，致死记 selfDestruct）。
   *   capOps:        本 tick 由本单位模块产生的“上限修改意图”（Pass1 只记账，结算步骤 2 统一落地）：
   *                   { inst, actor, ops:[[field, value]…], targets:[单位引用…], paralyze:bool }。
   *   expiries:      本 tick 到期的“时长撤销/恢复意图”（Pass1 只记账，结算步骤 2 统一落地）：
   *                   { ship, inst, cancelled }；cancelled=该模块当 tick 又重新激活（到期被覆盖）。
   *   energyRegen:   本 tick 能量回充额度（Pass1 只记账，结算步骤 3 统一落地）。
   *   energySpends:  本 tick 模块能量消耗序列（每激活一次记一条；结算步骤 3 按序落地）：
   *                   每条 { inst, amount }。
   *   poolFills:     本 tick“模块护盾池创建+填满意图”（时长型护盾重新激活；结算步骤 4a 落地）：每条 { inst }。
   *   tempTick:      本 tick 临时单位寿命递减意图（结算步骤 4e 落地，到期即判死）。
   *   coeffOps:      本 tick 的**系数/受伤减免修饰意图**（Pass1 记账或激活时记账，结算步骤 2 落地）：
   *                   每条 { inst, ship, category?, mode:'add'|'mul'|'takeMul', value, want, self? }；
   *                   `mode:'add'|'mul'`＝**类别系数**修饰（`category` 必填，写 `coeffMods/coeffMulMods`）；
   *                   `mode:'takeMul'`＝**受伤减免系数**修饰（不分类别，写 `damageTakeMulMods`＝该单位受伤统乘）；
   *                   `ship`＝**被作用单位**：自身词条＝模块所属单位（`self:true`，幂等读 `inst._coeffAdd/_coeffMul/_takeMul`）；
   *                   目标级词条（`*_target` 后缀）＝**逐目标一条**（`self` 缺省 false，幂等从对应表回读）。
   *                   `want`=期望生效（状态型读 tick 起始条件；时长型激活时恒 true、到期时由 expiries 撤销）。
   *   forceOps:      本 tick 的**强制目标意图**（`type` 标签 `force_target_self` 激活时记账，结算步骤 2b 落地）：
   *                   每条 { inst, actor, targets:[单位引用…] } —— 把各目标压入“强制来源栈”（施放者＝actor）。
   *   timeOps:       本 tick 的**时间系数意图**（`time_coeff` 激活时记账，结算步骤 2 与上限/系数同批落地）：
   *                   每条 { inst, targets:[单位引用…]（＝effectSetOf 的作用集合）, coeff } —— 写各单位的
   *                   `ship.timeCoeffMods`（多来源组合规则见 ship.js refreshTimeCoeff），
   *                   供其**下一 tick 起**的计时器需求量（timeScaled）使用。
   *   stealthOps:    本 tick 的**潜行意图**（`type` 标签 `stealth` 激活时记账，结算步骤 2 与
   *                   上限/系数/时间系数同批落地）：每条 { inst, targets:[单位引用…]（＝effectSetOf 的作用集合） }
   *                   —— 给各单位的 `ship.stealthMods` 打来源 key（潜行＝不可作为主要攻击目标），
   *                   供其**下一 tick 起**的目标解析（`stealthBlocksTargeting`）使用；**零数值变化**。
   *   oreGains:      本 tick 的**矿物采集请求**（自身词条 `ore_gain` 激活时记账，**结算步骤 3b** 统一分配/入库）：
   *                   每条 { inst, amount }（amount 已按“剩余矿物容量”截断、且已扣本 tick 本单位已认领量）。
   *                   **不是**即时数值修改：Pass1 零数值变化；储量不足时由 3b 按请求量比例均分（跨单位一次算清）。
   *   sectorOps:     本 tick 的**星区变更意图**（带星区效果词条 `sector_ore_add`/`sector_ore_mul` 或
   *                   **星区侧冷却词条** `sector_cd_ticks` 的模块在其激活时记账，**结算步骤 3c** 统一落地）：
   *                   每条 { inst, ship（模块拥有者，供时间系数/冷却时长）, kind:'add'|'mul'|null
   *                   （`null` ＝本次只有冷却要落地）, value（**该等级原值**：加法＝**已乘采矿系数并取整**的
   *                   绝对增量、乘法＝增量比例）, cdTicks（星区侧冷却基础量，`null`＝不参与） }。
   *                   落地顺序固定＝**先加法（求和后一次性加入）、再乘法（逐条作用在当前剩余上、各取整一次）**；
   *                   星区储量**无上限**；星区侧冷却也在 3c 同批写入（`sectorCdUntil`）。Pass1 零数值变化。
   *   oreSpends:     本 tick 的**矿物成本消耗序列**（自身词条 `ore_cost`，如矿渣导弹发生器：
   *                   每成功施放一次记一条；**结算步骤 3d-1** 按序从自身矿物仓 `hull.ore` 扣除）：
   *                   每条 { inst, amount } —— 与 `energySpends` 完全同体例，只是成本来源为携带矿物。
   *   oreTransfers:  本 tick 的**矿物输送意图**（目标级量值词条 `ore_target`，**结算步骤 3d-2** 落地）：
   *                   每条 { inst, from（施放方）, to（目标单位引用）, amount（**实际输送量**，已在 Pass1
   *                   按 min(词条值, 自身剩余携带, 目标剩余容量) 截断） }。
   *                   ★ **一条记录＝一次「自身 −N / 目标 +N」**（同额、原子、成对）→ 只记在**施放方** pending 上，
   *                     目标侧不另记 ⇒ 不重复计数；Pass1 零数值变化。
   *   cargoLoadOps:  本 tick 的**装载启动意图**（`type` 标签 `cargo_loader`，如装载光束；
   *                   **结算步骤 5** 统一落地：锁定货物 + 进度推进 + 完成入舱）：
   *                   每条 { inst（装载器模块实例）, ship（拥有者）, cargo（星区货物实体引用）,
   *                          need（**需求时长 tick**，已在 Pass1 按 tick 起始快照算好并冻结：
   *                                `max(1, round(货物装载时间 ÷ 速度))`） }。
   *                   ★ 每条恒为“**一件货物**”（每模块实例同一时刻至多 1 件在装）；Pass1 零数值变化；
   *                     采样顺序＝固定结算顺序（allies → enemies），与遍历位置无关、镜像对等。
   *   cargoTransfers: 本 tick 的**货物传输意图**（`type` 标签 `cargo_transfer`，**结算步骤 3d-3** 落地）：
   *                   每条 { inst, from（施放方）, to（目标单位引用）, cargo（**本单位已入舱货物实体引用**） }。
   *                   ★ **一条记录＝一次「自身货舱 −整件 / 目标货舱 +整件」**（同一实体、原子、成对）
   *                     → 只记在**施放方** pending 上，目标侧不另记 ⇒ 不重复计数；
   *                   ★ 被搬运物在 Pass1 由唯一选择口径 `pickCargoOf(ship, 'fifo', false, cargoRoomOf(to))`
   *                     选定（本单位**已入舱**货物按列表顺序**顺延**取第一件目标**装得下**的；在装货物
   *                     不在清单内 ⇒ 不可传输；**目标与货物一起冻结**，结算 3d-3 不重选、只按当前
   *                     剩余货舱**防御性复核**）；**实体原样搬运**（`tons`/`level`/`loadTicks` 随实体过去，
   *                     不在记录里另存数值）；Pass1 零数值变化。
   *   cargoRepairs:  本 tick 的**货物维修意图**（`type` 标签 `cargo_repair`，**结算步骤 3d-4** 销毁货物、
   *                   **步骤 4c** 回血）：每条 { inst, ship, cargo（被消耗的已入舱货物实体引用）,
   *                   amount（**回血量**，Pass1 已按 `round(货物吨位 × hp_per_ton)` 算好并冻结；同时写入
   *                   **目标单位** pending 的 `hpDeltas` ⇒ 4c 与 `hp_target` 同一条路径落地） }。
   *                   ★ 货物**销毁、不返还星区**；`hp_per_ton` 不乘任何类别系数（见采集处说明）。
   *   cargoEnhances: 本 tick 的**货物强化意图**（`type` 标签 `cargo_enhance`，**结算步骤 3d-5** 写入）：
   *                   每条 { inst, target（**目标单位**引用，可为他人）, cargo（**目标货舱中**尚待强化的
   *                   货物实体引用）, amount（＝`bonus_add` **词条原值**，不乘任何系数） }。
   *                   ★ 落地＝对**货物实体**写入 `bonus += amount` 且置一次性标记 `enhanced = true`
   *                     （唯一写入者、幂等）；**只记在施放方 pending** 上，目标侧不另记 ⇒ 不重复计数。
   *   ★ 矿物链两处（`oreSpends`/`oreTransfers`）共用**单位内运行计数** `ctx.oreAvail`（tick 起始携带量 −
   *     本 tick 已记账支出），故同单位多模块的总支出恒不超过 tick 起始携带量（防超发、可复现）。
   *   ★ 货物链三处（`cargoTransfers`/`cargoRepairs`/`cargoEnhances`）共用**每 tick 全局预留集合**
   *     `cargoClaimedTick`（本 tick 已被**任何单位**认领的货物 id；见「货物装载」段顶部）：
   *     同一件货物在一 tick 内只会被搬运/消耗/强化**其中一种** ⇒ 三条链作用对象两两不相交、可复现；
   *     同一单位多模块同理**不会选中同一件**（原单位内预留口径被它涵盖、更强）。
   *   ★ 装载链另用**单位内认领吨位计数**（裁决局部 `claimTons`，体例同 `ctx.oreClaimed`）——
   *     由 `resolveLoadClaims` 在**裁决过程中**维护：同单位多个装载器合计不得超过**剩余货舱**（防超装、可复现）。 */
  function freshPending() {
    return {
      dmg: [],
      shieldHeals: [],
      energyDeltas: [],
      hpDeltas: [],
      selfDestruct: null,
      capOps: [],
      expiries: [],
      energyRegen: 0,
      energySpends: [],
      poolFills: [],
      tempTick: false,
      coeffOps: [],
      forceOps: [],
      timeOps: [],
      stealthOps: [],
      oreGains: [],
      sectorOps: [],
      oreSpends: [],
      oreTransfers: [],
      cargoLoadOps: [],
      cargoTransfers: [],
      cargoRepairs: [],
      cargoEnhances: [],
    };
  }
  /** 惰性取某单位 pending（召唤新单位当 tick 被锁定命中时也能挂账） */
  function pendOf(u) {
    if (!u) return null;
    if (!u.__pending) u.__pending = freshPending();
    return u.__pending;
  }

  /* ---------- 计时器通用口径（★ 每 tick 恒推进 1 tick；时间系数只改“需求量”）----------
   * 每个计时器各自记录**已推进 tick 数**（模块：`inst.durElapsed`/`inst.cdElapsed`；临时单位：`u.tempLifeElapsed`），
   * **剩余 = 需求量 − 已推进**，其中 `需求量 = timeScaled(基础量, 单位时间系数)`（整数 tick，见 ship.js）。
   * 因此系数在计时**中途**落地/撤销时也能正确生效：已推进数不回退，剩余始终随需求量**同向**变化
   * （需求变小 → 剩余必然变小，绝不出现错向）。
   * 计时器**启动/重置**（进入持续期、进入冷却、召唤临时单位）时必须把对应的已推进数归 0。 */
  /** 启动/重置模块**持续期**计时：需求量按**当前**时间系数整数化，已推进数归 0。 */
  function startDuration(inst, coeff) {
    const fx = inst.cfg.effects || {};
    inst.durElapsed = 0;
    inst.durationLeft = timeScaled(fx.duration_ticks || 0, coeff);
  }
  /** 结束模块**持续期**（不进入冷却）：剩余与已推进数一并归 0。
   *  ★ `delayed_trigger` 的待触发载荷随持续期一并撤销：唯一触发时机是**自然到期结算的瞬间**
   *    （`advanceModuleState` 的到期分支），提前结束（停用/阵亡/移出场景/破盾）不产生效果。 */
  function endDuration(inst) {
    inst.durationLeft = 0;
    inst.durElapsed = 0;
    inst._delayedRefs = null;
    inst._delayedDmg = 0;
    inst._delayedPrimary = null;
    inst._delayedBlast = false;
  }
  /** 启动/重置模块**冷却**计时：需求量按**当前**时间系数整数化，已推进数归 0。 */
  function startCooldown(inst, coeff) {
    const fx = inst.cfg.effects || {};
    inst.cdElapsed = 0;
    inst.cooldown = timeScaled(fx.cooldown_ticks ?? 1, coeff);
  }
  /** 清空模块**冷却**（激活进入持续期）：剩余与已推进数一并归 0。 */
  function clearCooldown(inst) {
    inst.cooldown = 0;
    inst.cdElapsed = 0;
  }
  /** 启动/重置**临时单位存在时间**计时：需求量按**当前**时间系数整数化，已推进数归 0。 */
  function startLife(u, baseNeed, coeff) {
    u.tempLifeNeed = baseNeed; // 基础需求量（未缩放，供后续每 tick 按当时系数重算）
    u.tempLifeElapsed = 0;
    u.tempLeft = timeScaled(baseNeed, coeff);
  }

  /** ★ `type` 标签 `delayed_trigger`（**后触发**）的落地点：**效果在持续期结束（到期结算）时才触发**。
   *  在 `advanceModuleState` 的**自然到期分支**调用（仍在 Pass1：**只记账、零数值变化**）：
   *  · 按既有伤害记账方式把伤害写入**激活瞬间冻结的作用集合**内各存活单位的 `__pending.dmg`
   *    （主目标 `splash:false`；`blast_range` 波及 `splash:true` 且带 `gate`，与 `maybeActivate`
   *    的即时爆炸**同一条目格式**）→ 随后由 Phase A 收集、Phase B `settleHits` 统一结算：
   *    护盾池吸收 / 防爆拦截（`blast` 标签）/ 溅射抑制（gate）/ 反射 / 判死 / 战报**全部沿用既有链路**，
   *    **不新增任何伤害体系**。
   *  · 出伤数值与作用集合都在**激活瞬间**冻结（`inst._delayedDmg` / `inst._delayedRefs`），
   *    故持续期内的类别系数变化不影响本次引爆；作用集合内已阵亡/离场者跳过（结算侧还会再复核）。
   *  · 载荷在触发时一并清空（`endDuration` 的提前结束路径同样清空 → 停用/阵亡/移出场景不产生效果）。 */
  function fireDelayedEffect(ship, inst) {
    const refs = inst._delayedRefs;
    const dmg = inst._delayedDmg || 0;
    const blast = !!inst._delayedBlast;
    const primary = inst._delayedPrimary;
    inst._delayedRefs = null;
    inst._delayedDmg = 0;
    inst._delayedPrimary = null;
    inst._delayedBlast = false;
    if (!ship || !refs || !refs.length || dmg <= 0) return;
    // 本次触发的伤害统计项（结算阶段 `landDamageApp` 回填 → Phase C `finalizeModules` 写回
    // lastDmg / 累计 damageDealt；激活本身已在 `maybeActivate` 计入 activations）
    inst._pendingAct = { dmg: 0, shield: 0 };
    const actKey = `${ship.id}:${inst.id}`; // 溅射抑制 gate（与即时爆炸同一 key 口径）
    for (const u of refs) {
      if (!u || !u.alive) continue; // 已阵亡/移出场景者跳过
      const P = pendOf(u);
      if (!P) continue;
      const isPrimary = !!(primary && primary.has(u.id));
      P.dmg.push({
        actor: ship,
        inst,
        amount: dmg,
        blast,
        splash: !isPrimary,
        gate: !isPrimary && blast ? actKey : null, // 仅爆炸型可被防爆抑制
      });
    }
  }

  /** 单模块状态结构推进 + 有效贡献窗口累计（时长/冷却倒计时）。
   *  Pass1 单位遍历内、逐模块调用（先结构推进，再判定是否激活）。
   *  ★ 计时器（durationLeft/cooldown）与窗口累计就地完成：它们是**模块私有计时器**，不对任何
   *    单位数值产生可见影响，也不会波及其它单位；真到期的**撤销/恢复**（dropSourceMods +
   *    recalcDerived，会改上限）才是有跨单位影响的数值修改 —— 故只记“到期撤销意图”，
   *    由结算步骤 2 与上限修改一起统一落地（同 tick 双方一致）。 */
  function advanceModuleState(ship, inst, ctx) {
    if (!inst.enabled) return; // 停用模块：冷却/持续/窗口全部冻结
    const fx = inst.cfg.effects;
    // ★ 本 tick 的单位**时间系数**（读 Pass1 快照）→ 决定本 tick 各类计时器的需求量；
    //   每 tick **推进量恒为 1**（不再随系数变化），只有“需要多少 tick 才走完”随系数变化。
    const coeff = tickTimeCoeff(ship);
    if (inst.durationLeft > 0) {
      inst.durElapsed = (inst.durElapsed || 0) + 1; // 已推进恒 +1
      inst.durationLeft = Math.max(0, timeScaled(fx.duration_ticks || 0, coeff) - inst.durElapsed);
      if (inst.durationLeft <= 0) {
        inst.durationLeft = 0;
        inst.durElapsed = 0;
        // ★ `delayed_trigger`（后触发）：**持续期结算到期的瞬间才产生效果** —— 就在此处按既有伤害
        //   记账方式写入各作用单位的 `__pending.dmg`（仍是 Pass1：只记账、零数值变化），
        //   由 Phase A 收集、Phase B 统一按既有命中链路结算（护盾/防爆/判死/战报）。
        if (isType(fx, 'delayed_trigger')) fireDelayedEffect(ship, inst);
        if ((fx.cooldown_ticks || 0) > 0) startCooldown(inst, coeff); // 进入冷却（需求量按当前系数）
        // ★ 到期撤销/恢复不再即时执行：只记账（携带 inst 与所属单位），结算步骤 2 统一落地
        const rec = { ship, inst, cancelled: false };
        ctx.P.expiries.push(rec);
        inst._expiryRec = rec; // 若本 tick 又重新激活 → 在 maybeActivate 里标记 cancelled
      }
    } else if (inst.cooldown > 0) {
      inst.cdElapsed = (inst.cdElapsed || 0) + 1; // 已推进恒 +1
      inst.cooldown = Math.max(0, timeScaled(fx.cooldown_ticks ?? 1, coeff) - inst.cdElapsed);
      if (inst.cooldown <= 0) inst.cdElapsed = 0;
    }
    // 有效贡献窗口累计（读本 tick 起始态 + 单位内运行计数，先于本模块激活）
    if (moduleActiveNow(ship, inst, ctx.avail)) inst.stats.activeTicks += 1;
  }

  /** 条件型自身增益（type 含 `solo`）：**仅当“非召唤的友方存活单位”只有自己一个**时生效。
   *  ★ 召唤物不计入：以 `summonMod`（`doSummon` 对召唤单位打的模块标记）或 `isSummon`
   *    （`spawnSummoned` 打的召唤标记）为准 —— 临时单位/弹体类单位天然被覆盖，
   *    即“自己召唤出单位**不会**让本效果失效”。仅统计本阵营的非召唤存活单位数 ≤ 1（含自己）。
   *  读 tick 起始存活状态即可（本 tick 的判死全部延后到结算阶段 → Pass1 内该计数稳定，
   *  且与单位遍历位置无关）。 */
  function soloConditionHolds(ship) {
    let n = 0;
    for (const u of sidesOf(ship.side)) {
      if (!u.alive) continue;
      if (u.summonMod || u.isSummon) continue; // 排除召唤物（临时单位/弹体亦被覆盖）
      n += 1;
    }
    return n <= 1;
  }

  /** ★ 状态型模块（`type` 含条件标签，如 `solo`；或常驻被动 `passive`）**当前是否生效**的**唯一权威判据**
   *  ——供 UI 读取。
   *  · `solo`：判据 = 结算阶段落地的实际生效值（加性系数 `inst._coeffAdd`（0 = 未生效）/ 受伤减免
   *    `inst._takeMul`（1 = 未生效））；
   *  · `passive`（常驻增幅器）：判据 = **模块启用中**（静态加成在开战前就已计入派生值，与战斗阶段无关）。
   *  **UI 不得自行重算条件**（避免两套口径）。
   *  返回：`true` = 生效中；`false` = 条件未满足/未生效；`null` = 非状态型模块
   *  （UI 走原有 就绪/冷却/持续 逻辑，故其它模块显示不回归），或战斗未进行中（尚无结算结果）。 */
  function moduleEffective(inst) {
    const fx = inst && inst.cfg && inst.cfg.effects;
    if (!fx) return null;
    // ★ **常驻被动**（`type` 标签 `passive`，如增幅器类）：装上即生效、无“激活-触发”流程，
    //   生效判据 = 模块启用中；**与战斗阶段无关**（静态加成在开战前就已计入派生值）
    //   → 不返回 null（UI 据此显示「生效中」/「已停用」，且不显示倒计时徽标与就绪脉动）。
    if (isType(fx, 'passive')) return inst.enabled !== false;
    if (!isType(fx, 'solo')) return null;
    const hasTerm =
      Object.keys(COEFF_ADD).some((k) => (fx[k] || 0) !== 0) ||
      Object.keys(DAMAGE_TAKE_MUL).some((k) => (fx[k] || 0) > 0);
    if (!hasTerm) return null;
    if (phase !== 'running') return null; // 未开战/已结束：无结算结果，交给原有中性显示
    const on = !!inst._coeffAdd || (inst._takeMul || 1) !== 1;
    return !!on && inst.enabled !== false;
  }

  /** ★ **触发门控（`hp_below_activate`）当前是否满足**的**唯一权威判据**——供 UI 读取。
   *  与 `moduleEffective`（状态型 `solo` 的生效判据）**同一个思路**：UI 只读引擎判据、**绝不自算条件**。
   *  判据（与引擎 `maybeActivate` 顶部的门控判定**完全同源**）：
   *    · 无该词条 / 无门控（`hp_below_activate <= 0`）→ `null`（**非门控型**，UI 走原有状态逻辑）；
   *    · 战斗未进行中（`running` 之外）→ `null`（无运行期状态，交给原有中性显示）；
   *    · `inst._firedOnce`（**本次低血区间已触发过**、血量回升过阈值才清标记）→ `false`（条件未满足）；
   *    · 否则比较**血量比例** `hull.hp / hull.hpMax ≤ hp_below_activate` → `true/false`。
   *  返回：`true` = 门控满足（可激活）；`false` = **条件未满足**（UI 据此显示「条件未满足」，**不得显示“就绪”**）；
   *  `null` = 非门控型 / 战斗未进行中。 */
  function moduleGateMet(inst) {
    const fx = inst && inst.cfg && inst.cfg.effects;
    if (!fx) return null;
    // ★ **带星区冷却词条**（`sector_cd_ticks`）或星区效果词条（创世纪 / 矿藏富集）的模块：
    //   **除自身冷却外还受「星区侧该模块冷却」门控**（星区只接受一次触发）→ 星区冷却未结束 → `false`
    //   （UI 按既有体例显示「条件未满足」、不显示“就绪”）。与低血门控**同一键、同一套呈现**，
    //   不新造第二套口径；识别走**同一函数** `hasSectorCd`（与 `canImpact` 门控同源）。
    //   注：UI 只读本判据；剩余 tick 数由星区资源栏读 `battle.sector.cd` 显示。
    if (sectorWordOf(inst) || hasSectorCd(inst)) {
      if (phase !== 'running') return null; // 未开战/已结束：无运行期门控状态
      return sectorCdReady(inst.cfg.id);
    }
    const need = fx.hp_below_activate || 0;
    if (!(need > 0)) return null; // 无门控词条：非门控型模块
    if (phase !== 'running') return null; // 未开战/已结束：无运行期门控状态
    const holder = ownerOf(inst);
    if (!holder) return null;
    if (inst._firedOnce) return false; // 本低血区间已触发过（血量回升过阈值才清标记）
    const hpMax = holder.hull.hpMax || 0;
    const ratio = hpMax > 0 ? holder.hull.hp / hpMax : 0;
    return ratio <= need;
  }

  /** Pass1 —— 条件型自身增益：**只记“期望生效状态”**（零数值变化）。
   *  与“激活-触发”流程无关（状态型：无冷却/耗能/持续期），故不进 maybeActivate；
   *  真正的加减由结算步骤 2 `applyCoeffOp` 统一落地（系数加性 → `coeffMods`；受伤减免 → `damageTakeMulMods`）。 */
  function pass1CoeffState(ship, inst, ctx) {
    const fx = inst.cfg.effects;
    if (!fx) return;
    const key = Object.keys(COEFF_ADD).find((k) => (fx[k] || 0) !== 0);
    const dmgKey = Object.keys(DAMAGE_TAKE_MUL).find((k) => (fx[k] || 0) > 0);
    if (!key && !dmgKey) return;
    const want = !!inst.enabled && isType(fx, 'solo') && soloConditionHolds(ship);
    if (key) {
      ctx.P.coeffOps.push({
        inst,
        ship, // 自身词条：作用对象＝模块所属单位
        category: COEFF_ADD[key],
        mode: 'add',
        value: fx[key],
        want,
        self: true, // 幂等读 inst._coeffAdd（同时供 UI 判据 moduleEffective 使用）
      });
    }
    if (dmgKey) {
      ctx.P.coeffOps.push({
        inst,
        ship, // 自身词条：作用对象＝模块所属单位
        mode: 'takeMul',
        value: fx[dmgKey],
        want,
        self: true, // 幂等读 inst._takeMul（同时供 UI 判据 moduleEffective 使用）
      });
    }
  }

  /** Pass1 —— **常驻被动**（`type` 标签 `passive`）：**只记账、零数值变化**。
   *  · 静态加成类词条（`hp_cap_bonus` / `energy_cap_bonus` / `energy_regen_bonus` / `X_coeff_add`）：
   *    **本函数无任何 tick 动作** —— 其数值在“安装 / 启停”时由 ship.js `syncSelfStatics` 派生落地
   *    （非“激活-触发”流程：无冷却、无耗能、无持续期、不产生战报）。
   *  · 按**上一 tick 阵亡数**结算的词条（`hp_regen_per_death`，如「回收利用」）：读快照 `lastTickDeaths`
   *    （本 tick 内恒定）→ 记 `__pending.hpDeltas`，与 `hp_target` **同一落地路径**（结算步骤 4c 统一
   *    `applyHpTo`：**真实回血**、钳制到 `hpMax`、正值不乘受伤减免、可致死者只有负值路径）；
   *    `regen:true` 仅为结算阶段“实际回血>0 时记一条低频战报”的标记。
   *    ★ **0 阵亡 → 不记任何账**（本 tick 零数值变化、无战报）。 */
  function pass1Passive(ship, inst, ctx) {
    if (!inst.enabled) return; // 停用：不生效（静态加成部分已由 disableModule → recomputeCap 回退）
    const fx = inst.cfg.effects;
    if (!fx) return;
    const per = fx.hp_regen_per_death || 0;
    if (!(per > 0)) return; // 无该词条：常驻被动无 tick 动作
    const n = lastTickDeaths; // ★ 上一 tick（双方合计、排除召唤物）的阵亡数快照
    if (!(n > 0)) return; // 0 阵亡：不回血
    ctx.P.hpDeltas.push({
      inst,
      amount: per * coeff(ship, inst.cfg.category) * n, // 词条值 × 类别系数 × 上一 tick 阵亡数
      regen: true,
    });
  }

  /** 结算步骤 2 —— 统一落地一条“修饰意图”：仅在**生效状态/数值发生变化**时写入/撤销。
   *  `inst._coeffAdd`（加性，0=未生效）与 `inst._coeffMul`（乘性，1=未生效）记录本模块当前已生效值，作幂等判据。
   *  `mode:'takeMul'`（受伤减免）改写 `ship.damageTakeMulMods`，幂等值记在 `inst._takeMul`（自身）/ 单位表（目标级）。
   *  与上限修改同属“上限/系数类”，故与 capOps 同批（先于伤害结算），跨单位顺序一致。 */
  function applyCoeffOp(rec) {
    const ship = rec.ship;
    const inst = rec.inst;
    const isMul = rec.mode === 'mul';
    const isTake = rec.mode === 'takeMul';
    const offVal = isMul || isTake ? 1 : 0;
    const on = !!rec.want && !!inst.enabled && !!ship && ship.alive;
    const val = on ? rec.value : offVal;
    // 幂等判据：自身记录读模块实例上的已生效值；**目标级记录逐目标从对应表回读**
    //（`_coeffAdd/_coeffMul/_takeMul` 只能记一条，无法代表“同一模块对不同单位”各自的状态）。
    const cur = rec.self
      ? isTake
        ? inst._takeMul || 1
        : isMul
          ? inst._coeffMul || 1
          : inst._coeffAdd || 0
      : isTake
        ? appliedTakeMul(ship, inst.id)
        : appliedCoeff(ship, inst.id, rec.category, rec.mode);
    if (val === cur) return; // 状态未变：不写不改（幂等）
    if (rec.self) {
      if (isTake) inst._takeMul = val;
      else if (isMul) inst._coeffMul = val;
      else inst._coeffAdd = val;
    }
    if (!on) {
      if (isTake) clearDamageTakeMulMod(ship, inst.id);
      else if (isMul) clearCoeffMulMod(ship, inst.id);
      else clearCoeffMod(ship, inst.id);
      return;
    }
    if (isTake) setDamageTakeMulMod(ship, inst.id, val);
    else if (isMul) setCoeffMulMod(ship, inst.id, rec.category, val);
    else setCoeffMod(ship, inst.id, rec.category, val);
    // 护盾类别系数会参与模块护盾池容量（modulePoolCapOf → coeff(ship,'shield')）：
    // 若某词条修饰 shield 类别（自身或目标级），此处同步重算该单位的派生池；attack 类别不涉及派生值。
    // （受伤减免不参与 coeff()，无需重算派生值。）
    if (rec.category === 'shield' && ship.alive) recalcDerived(ship);
  }

  /* ---------- 受伤减免系数（`damage_coeff_mul` 系列）----------
   * ★ 口径（受击向）：**该单位受到的伤害全部乘上它**（0.95 = 只承受 95%）。
   * ★ **唯一结算点**＝`applyHit(target, amount, …)` 的入口（`amount * tickTakeMul(target)`，
   *   在吸入护盾/舰体之前）——故主目标命中、爆炸/波及、反射返程、负值扣血·削盾量值
   *   等**所有来源**自动一并减免，出伤侧无需逐点相乘。
   * ★ 豁免：自毁 `self_destruct_damage`（`applySelfDestruct` 独立路径）、能量削减、上限类 `*_cap_target`。 */
  /** 本 tick 该单位的受伤减免系数（唯一读取入口）：取 Pass1 单位开头写下的**快照** `u._takeMulTick`，
   *  保证同一 tick 内“受伤按 tick 起始值算”，本 tick 结算阶段落地的减免从**下一 tick** 才体现（镜像对等）；
   *  Pass1 内新召单位（弹体/无人机）在其生成时即写下快照，无快照者现算兜底。 */
  function tickTakeMul(u) {
    if (u && typeof u._takeMulTick === 'number') return u._takeMulTick;
    return damageTakeMul(u);
  }

  /* ---------- 时间系数（`time_coeff` 词条 · 影响“需求量”，不改每 tick 推进量）----------
   * ★ 口径：作用对象的**时间系数**（负＝加速、正＝放缓）只改各计时器的**需求量**：
   *     `需求量 = timeScaled(基础量, 系数)`（＝`max(0, round(基础量 × (1 + 系数)))`，整数 tick）；
   *     每个计时器各自记**已推进 tick 数**，**剩余 = 需求量 − 已推进**，且**每 tick 推进恒为 1**。
   *   作用于三处（均在 battle.js）：
   *     · `advanceModuleState` 的模块**持续时间** `inst.durationLeft`（elapsed＝`inst.durElapsed`）；
   *     · 同函数的模块**冷却** `inst.cooldown`（elapsed＝`inst.cdElapsed`；剩余钳到 0）；
   *     · 结算步骤 4e `applyTempTick` 的临时单位**存在时间** `u.tempLeft`（elapsed＝`u.tempLifeElapsed`）。
   * ★ **中途变更系数**：需求量每 tick 按快照系数重算、已推进数不回退 → 剩余总是“新需求 − 已推进”，
   *   需求变小则剩余必变小（不可能出现错向）；系数被撤销后需求量回到基础值，剩余随之回到未加速的进度。
   * ★ 多来源组合规则见 ship.js `refreshTimeCoeff()`（当前＝**加性求和**；切换点在该函数一行内）。
   * ★ 落地与撤销都在**结算阶段**（激活＝结算步骤 2；到期/停用/阵亡/移出场景＝各自既有撤销路径），
   *   且一律读 Pass1 快照 `u._timeCoeffTick` → **下一 tick 起**生效、跨单位顺序一致。
   * ★ 战报低频：负系数＝加速（`hastenStart`/`hastenEnd`），正系数＝减速（`slowStart`/`slowEnd`）。 */
  /** 本 tick 该单位的**时间系数**（唯一读取入口）：取 Pass1 快照 `u._timeCoeffTick`，
   *  无快照者（Pass1 内新召单位已在其生成时写入；异常兜底）现算 `timeCoeffOf`。 */
  function tickTimeCoeff(u) {
    if (u && typeof u._timeCoeffTick === 'number') return u._timeCoeffTick;
    return timeCoeffOf(u);
  }

  /** 时间系数 → 该模块的低频战报键（**符号决定加速/减速侧**）：负系数＝加速、正系数＝减速。
   *  由 `applyTimeOp` 落地时记在 `inst._timeLog` 上，撤销时沿用同一对键（保证“开始/结束”成对）。 */
  function timeLogKeys(coeff) {
    return (Number(coeff) || 0) > 0
      ? { start: 'battle.log.slowStart', end: 'battle.log.slowEnd' }
      : { start: 'battle.log.hastenStart', end: 'battle.log.hastenEnd' };
  }

  /** 结算步骤 2 —— 落地一条**时间系数意图**（与上限/系数同批，先于伤害结算）：
   *  **单次一次性、仅对当前作用集合**：先撤上一批（旧集合上的系数立即失效），再对本次集合重新写入。
   *  ★ 战报（低频，**不逐次激活播报**）：仅当该模块的时间系数**从无→有**时记 1 条
   *    「开始加速/开始减速：{n}个单位」（文案由系数符号决定）。 */
  function applyTimeOp(rec) {
    const inst = rec.inst;
    const wasActive = !!inst._timeActive; // 撤销前先记下“之前是否已生效”（用于 0→有 判定）
    releaseTime(inst, true); // 先撤上一批（切换作用集合后旧单位按剩余来源重新组合）；此处恒静默
    const applied = [];
    for (const u of rec.targets) {
      if (!u || !u.alive) continue; // 结算时复核存活（集合内可能有本 tick 已判死/离场者）
      setTimeCoeffMod(u, inst.id, rec.coeff);
      applied.push(u);
    }
    inst._timeRefs = applied.length ? applied : null; // 供各撤销路径精确回退
    inst._timeActive = applied.length > 0; // 模块级“时间系数生效中”标记（战报聚合用）
    inst._timeLog = timeLogKeys(rec.coeff); // 记录本次的加速/减速侧战报键（撤销沿用）
    // 仅 **0 → 有** 记一条“开始加速/开始减速”；n＝本次**真正写入**的单位数（结算复核存活后的数量）
    if (!wasActive && inst._timeActive) {
      const holder = ownerOf(inst);
      const owner = holder ? uTok(holder) : { side: null, label: '—' };
      battleLog(inst._timeLog.start, { owner, module: modTok(inst), n: applied.length }, ['owner']);
    }
  }
  /** 撤销某模块施加在**其作用集合**上的时间系数（到期/停用/阵亡/移出场景/重新激活前）。
   *  ★ 作用集合 `inst._timeRefs` 由**结算阶段**在记录落地后写入（Pass1 不写），
   *    保证撤销时拿到的是“上一次真正落地的集合”，不会因覆盖而漏撤销。
   *  ★ 战报（低频，**不逐次播报**）：仅当**从有→无**且 `silent` 为假时记 1 条
   *    「加速结束/减速结束：{n}个单位」（侧别沿用 `inst._timeLog`）。
   *    `silent`＝本 tick 该模块到期后又重新激活（撤销与重建同 tick 完成）：既不记“结束”，
   *    **也不清 `_timeActive`** → 紧随其后的 `applyTimeOp` 判定为“延续”，因此**不会**再记一条“开始”
   *    ⇒ 同 tick 重激活**完全静默**、不产生成对刷屏（与 `releaseForced(inst, silent)` 同一套做法）。 */
  function releaseTime(inst, silent) {
    if (!inst) return;
    const refs = Array.isArray(inst._timeRefs) ? inst._timeRefs : null;
    const n = refs ? refs.filter(Boolean).length : 0;
    if (refs) {
      for (const u of refs) if (u) clearTimeCoeffMod(u, inst.id);
      inst._timeRefs = null;
    }
    if (silent) return; // 同上：延续场景不动 _timeActive、不记战报
    if (inst._timeActive && n) {
      // 效果结束类战报一律带**模块拥有者**（形如「XX的{模块}加速结束/减速结束：{n}个单位」）
      const holder = ownerOf(inst);
      const owner = holder ? uTok(holder) : { side: null, label: '—' };
      const keys = inst._timeLog || timeLogKeys(inst.cfg && inst.cfg.effects ? inst.cfg.effects.time_coeff : 0);
      battleLog(keys.end, { owner, module: modTok(inst), n }, ['owner']);
    }
    inst._timeActive = false;
  }

  /** 撤销某模块施加在**其本次激活作用集合**上的目标级修饰（系数修饰 + 受伤减免）：
   *  逐被作用单位清掉该来源 key 的加性/乘性系数修饰与受伤减免（护盾类别顺带重算派生池）。
   *  ★ 作用集合 `inst._coeffRefs` 由**结算阶段**在记录落地后写入（Pass1 不写），保证撤销时拿到的是
   *    “上一次真正落地的集合”，重复激活不会因覆盖而漏撤销。 */
  function releaseCoeffRefs(inst) {
    if (!inst || !Array.isArray(inst._coeffRefs)) return;
    for (const u of inst._coeffRefs) {
      if (!u) continue;
      clearAllSourceMods(u, inst.id);
      if (u.alive && inst._coeffShield) recalcDerived(u);
    }
    inst._coeffRefs = null;
  }

  /* ---------- 强制目标（`type` 标签 `force_target_self`）----------
   * ★ 结构：**每单位一个有序强制来源栈** `u.forceStack = [{ instId, actorId, seq }]`
   *   - 顺序＝来源**激活先后**（`seq` 单调递增，数组恒按 seq 升序）→ **栈顶＝最后激活仍生效的来源**，
   *     即“后激活者优先被集火”：集火顺序 C → B → A。
   *   - 派生标签：`u.forcedTargetId`＝栈顶来源的施放者单位 id、`u.forcedBy`＝栈顶模块实例 id。
   *     （旧版 `forceSrcs` Map 已升级为本有序栈；Map 结构不再使用。）
   * ★ 目标优先级（见 `moduleTargetList`）：**激活锁定(`lock_target_on_activate`) > 强制目标 >
   *   模块手动目标 > 优先自己(`prefer_self`) > 船 `targetId` > 自动粘性 > 全队策略**。
   *   强制**不改写**被强制单位的 `targetId`——玩家/既有选定的主要目标保持原样，
   *   故所有来源失效后该单位自然**按正常优先级**继续解析（不恢复任何“被强制前的快照”）。
   * ★ 回落链：某来源提前取消/到期/停用/阵亡/离场时，把它从各被强制单位的栈中移除；
   *   若移除的是栈顶 → 其**集火对象回落到下一个仍生效的来源**（C 消失 → B）；
   *   栈空 → 该单位回到正常优先级解析（A）。 */
  let forceSeq = 0; // 强制来源激活序号（单调递增；保证栈恒按激活先后排序）
  function refreshForcedTags(u) {
    const st = u.forceStack;
    if (Array.isArray(st) && st.length) {
      const top = st[st.length - 1];
      u.forcedBy = top.instId;
      u.forcedTargetId = top.actorId;
    } else {
      u.forcedBy = null;
      u.forcedTargetId = null;
    }
  }
  /** 压入一条强制来源（结算步骤 2b 落地）：同一来源重复激活 → 先移除旧条目再入栈顶（后激活者优先） */
  function pushForce(u, inst, actor) {
    if (!Array.isArray(u.forceStack)) u.forceStack = [];
    const i = u.forceStack.findIndex((e) => e.instId === inst.id);
    if (i >= 0) u.forceStack.splice(i, 1);
    forceSeq += 1;
    u.forceStack.push({ instId: inst.id, actorId: actor.id, seq: forceSeq });
    refreshForcedTags(u);
  }
  /** 从 u 的强制栈中移除某来源；返回 'none'（无此来源）/ 'unchanged'（非栈顶，集火对象不变）/
   *  'fallback'（回落到下一来源）/ 'cleared'（栈空，回到正常优先级） */
  function popForceByInst(u, instId) {
    if (!u || !Array.isArray(u.forceStack) || !u.forceStack.length) return 'none';
    const before = u.forceStack[u.forceStack.length - 1].instId;
    const i = u.forceStack.findIndex((e) => e.instId === instId);
    if (i < 0) return 'none';
    u.forceStack.splice(i, 1);
    refreshForcedTags(u);
    const after = u.forceStack.length ? u.forceStack[u.forceStack.length - 1].instId : null;
    if (before === after) return 'unchanged';
    return after ? 'fallback' : 'cleared';
  }
  /** 该单位当前被强制攻击的目标单位（栈顶来源的施放者，需存活；栈顶施放者不存在时向下回退）；
   *  返回 null ＝当前无有效强制（走正常优先级）。单位自身阵亡返回 null。 */
  function forcedTopUnit(ship) {
    const st = ship.forceStack;
    if (!Array.isArray(st) || !st.length || !ship.alive) return null;
    const foes = ship.side === 'ally' ? enemies : allies;
    for (let i = st.length - 1; i >= 0; i -= 1) {
      const u = foes.find((f) => f.id === st[i].actorId && f.alive);
      if (u) return u;
    }
    return null;
  }
  /** 撤销某模块对**其本次激活作用集合**的全部强制（到期/停用/阵亡/移出场景统一走这里）。
   *  战报按“本次撤销事件”聚合一条（不逐单位刷屏）：仅统计**栈顶变化**的单位。
   *  `silent`=本 tick 该模块到期后又重新激活（撤销与新施加同 tick 完成，不单独记“解除/回落”，避免刷屏）。 */
  function releaseForced(inst, silent) {
    if (!inst || !Array.isArray(inst._forcedRefs)) return;
    let fell = 0;
    let cleared = 0;
    for (const u of inst._forcedRefs) {
      const r = popForceByInst(u, inst.id);
      if (r === 'fallback') fell += 1;
      else if (r === 'cleared') cleared += 1;
    }
    inst._forcedRefs = null;
    if (silent) return;
    // 效果结束类战报一律带**模块拥有者**（形如「XX的{模块}{效果}结束」）：owner＝施放方单位（红/蓝）、
    // module＝模块名（绿）。ownerOf 在各撤销路径（到期/停用/阵亡/移出场景）都能取到持模块的单位。
    const holder = ownerOf(inst);
    const owner = holder ? uTok(holder) : { side: null, label: '—' };
    if (cleared) {
      battleLog('battle.log.forceRelease', { owner, module: modTok(inst), n: cleared }, ['owner']);
    }
    if (fell) {
      battleLog('battle.log.forceFallback', { owner, module: modTok(inst), n: fell }, ['owner']);
    }
  }
  /** 结算步骤 2b —— 统一落地一条“强制目标意图”：把各目标的强制目标切换为施放者。
   *  · 目标已死者跳过；不强制自己；
   *  · **锁定单位（`lockTargetId`：一次性火箭/导弹弹体）跳过**——其目标在召唤时固定、永不可改
   *    （`moduleTargetList` 对锁定单位直接返回锁定目标）；
   *  · 施放方本 tick 已死其意图照常落地（与伤害/上限修改一致）。 */
  function applyForceOp(rec) {
    const actor = rec.actor;
    if (!actor) return;
    const pushed = [];
    for (const t of rec.targets) {
      if (!t || !t.alive || t === actor) continue;
      if (t.lockTargetId) continue; // 锁定单位：跳过
      pushForce(t, rec.inst, actor);
      pushed.push(t);
    }
    // 结算侧记账：本次**真正落地**的强制作用集合（供撤销时精确出栈；Pass1 不写，避免重复激活覆盖丢失）
    rec.inst._forcedRefs = pushed;
    if (pushed.length > 0) {
      battleLog(
        'battle.log.forceTarget',
        { actor: uTok(actor), module: modTok(rec.inst), n: pushed.length },
        ['actor']
      );
    }
  }

  /* ---------- 潜行落地与撤销（`type` 标签 `stealth`）----------
   * ★ 落地：`applyStealthOp`（**结算步骤 2**，与 capOps/coeffOps/timeOps 同批、先于伤害结算）——
   *   先撤上一批（切换作用集合后旧单位按剩余来源重新组合，故必须镜像 `applyTimeOp` 的“先撤后建”），
   *   再对本次集合内的**存活**单位写入来源 key（`setStealthMod`，来源 key＝模块实例 id，可多来源并存）。
   * ★ 撤销：`releaseStealth(inst, silent)` —— 到期（`expiries`）/ 停用 / 阵亡 / 移出场景 / 重新激活前统一走它；
   *   `inst._stealthRefs`（结算阶段写入的“上一次真正落地的作用集合”）保证重复激活不会漏撤销；
   *   `silent=true`（同 tick 到期后又重新激活：`expiries` 记录带 `cancelled`）→ 既不记“结束”也**不清
   *   `_stealthActive`** → 紧随其后的 `applyStealthOp` 判为“延续”、不再记“开始” ⇒ **整体静默、不刷屏**
   *   （与 `releaseForced`/`releaseTime` 同一套做法）。
   * ★ 战报（低频聚合，遵循《战报日志开发要点》§3「效果结束类必须带模块拥有者」铁律）：
   *   仅“从无→有”记 1 条「{owner}的{module}生效：{n}个单位进入潜行」、“从有→无”记 1 条
   *   「{owner}的{module}潜行结束：{n}个单位」；**不逐次激活播报**、不逐单位播报（标记类无高频播报）。 */
  function releaseStealth(inst, silent) {
    if (!inst) return;
    const refs = Array.isArray(inst._stealthRefs) ? inst._stealthRefs : null;
    const n = refs ? refs.filter(Boolean).length : 0;
    if (refs) {
      for (const u of refs) if (u) clearStealthMod(u, inst.id); // 唯一撤销口径（ship.js）
      inst._stealthRefs = null;
    }
    if (silent) return; // 同 tick 到期并重新激活：不动 _stealthActive、不记战报（延续场景）
    if (inst._stealthActive && n) {
      const holder = ownerOf(inst);
      const owner = holder ? uTok(holder) : { side: null, label: '—' };
      battleLog('battle.log.stealthEnd', { owner, module: modTok(inst), n }, ['owner']);
    }
    inst._stealthActive = false;
  }

  /** 结算步骤 2 —— 统一落地一条“潜行意图”（与上限/系数/时间系数同批，先于伤害结算）：
   *  **单次一次性、仅对当前作用集合**：先撤上一批，再对本次集合内的存活单位重新打标；
   *  作用集合 `inst._stealthRefs` 由**结算阶段**写入（Pass1 不写），供各撤销路径精确回退。 */
  function applyStealthOp(rec) {
    const inst = rec.inst;
    const wasActive = !!inst._stealthActive; // 撤销前先记下“之前是否已生效”（用于 0→有 判定）
    releaseStealth(inst, true); // 先撤上一批（此处恒静默）
    const applied = [];
    for (const u of rec.targets) {
      if (!u || !u.alive) continue; // 结算时复核存活（集合内可能有本 tick 已判死/离场者）
      setStealthMod(u, inst.id);
      applied.push(u);
    }
    inst._stealthRefs = applied.length ? applied : null;
    inst._stealthActive = applied.length > 0; // 模块级“潜行生效中”标记（战报聚合用，非数值）
    // 仅 **0 → 有** 记一条“进入潜行”；n＝本次**真正写入**的单位数（结算复核存活后的数量）
    if (!wasActive && inst._stealthActive) {
      const holder = ownerOf(inst);
      const owner = holder ? uTok(holder) : { side: null, label: '—' };
      battleLog('battle.log.stealthStart', { owner, module: modTok(inst), n: applied.length }, ['owner']);
    }
  }

  /** 单位判死瞬间就地清理其全局残留（原 cleanDeadEffects“对死者”部分，逐死就地执行、省去每 tick 全量循环）：
   *  - 撤销死者自身仍在持续的时长 buff；
   *  - 撤销它与“其它单位”之间的双向影响：它施加的 cap 影响 / 目标级系数修饰 / 强制目标来源，
   *    以及它自身获得的自身词条系数修饰；强制目标只解除来源（被强制者按来源栈回落或回正常优先级）；
   *  - 清除仍指向“该死者(作为被叠加目标，已死)”的 cap 叠加。
   *  ★ 本函数**只服务判死**；星域容器的「跨实例整体搬迁」（`takeUnit`/`adoptUnit`）**不共用**它 ——
   *    搬迁是“活着换场景”，必须**保留**自身状态（时长/货物/矿物/自身修饰），故其清理范围**刻意更小**
   *    （见 `takeUnit` 注释）。 */
  function onDeath(ship) {
    // ★ 死亡返还（星区矿物）：本舰**携带的矿物**（本舰矿物仓 `hull.ore`）**全额返还星区储量**。
    //   · 落点＝**判死唯一出口**本函数：四个判死点（applyHpTo / applySelfDestruct / applyTempTick /
    //     applyHit）各自以 `X.alive` 门控后才置 `alive=false` 并调用本函数 ⇒ **每单位至多一次**；
    //   · 幂等性：返还后立即把 `hull.ore` 归 0 ⇒ 即便将来出现新的重复调用路径，携带量为 0、不再重复返还；
    //   · ⚠ **矿物与货物是两条独立返还链**：本段只处理**矿物 → 星区储量**（`hull.cargo` 与储量无关）；
    //     已装载**货物**的返还在下方单独一段（回**星区货物列表**，见 `returnCargoToSector`）。
    //   · 守恒（**仅“采集 ↔ 返还”这一对**）：返还量 ≤ 该单位本场从本储量采集量之和 ⇒
    //     **返还自身不会让储量超过初始**，故此处**不设上限**（⚠ 星区词条可抬高储量、与此无关）。
    const oreCarried = oreLoadOf(ship);
    if (oreCarried > 0) {
      ship.hull.ore = 0;
      oreReserve += oreCarried;
    }
    // ★ 货物返还（**本轮新增口径**，与矿物返还**同一出口、同一体例**）：
    //   · **已装载货物全额返还星区**（同一 id、同一对象，**追加到星区列表末尾**：队列式前出后入，
    //     **不恢复初始顺序**；列表长度不限）；
    //   · **幂等**：返还后 `ship.cargos` 与 `hull.cargo` 立即清空 ⇒ 重复调用无副作用
    //     （与矿物“返还后归 0”完全同一手法）；
    //   · **只返还货物、不改数值**：护盾/血量/能量一律不碰（装载体系与战斗数值链无关）；
    //   · 返还的货物保持 `loadTicks`（已装载过者恒为 20t ⇒ “一次装好”是**货物特性**，不随死亡还原）；
    //   · **不自动重新入队**（优先队列是用户的选择）。
    returnCargoToSector(ship);
    // ★ 死亡计数（唯一出口）：排除召唤/临时单位（判据与 soloConditionHolds 的"召唤物不计入"同一口径）。
    //   结算阶段累加、tick 收尾提交为 lastTickDeaths → 供**下一 tick** 的 Pass1 读取（"按上一 tick 死亡数"）。
    if (!ship.summonMod && !ship.isSummon) deathsThisTick += 1;
    // ★ 在装（**未完成**）货物的解锁：本舰阵亡 ⇒ 立即解锁 + 进度归零、**不完成装载**、能量不退。
    //   与下方模块清理循环同批（同一 `ship.modules` 遍历），恒在结算步骤 5 之前 ⇒ 本 tick 也不会补完成。
    for (const inst of ship.modules) {
      if (inst.durationLeft > 0) endDuration(inst); // 结束自身时长 buff（剩余/已推进一并归 0）
      releaseCargoLoad(inst); // ★ 阵亡 ⇒ 解除其在装货物的锁定（进度归零、不完成装载、能量不退）
      dropSourceMods(inst); // 撤销其对其它目标护盾上限的影响（若无则无操作）
      clearAllSourceMods(ship, inst.id); // 撤销其自身获得的修饰（系数加/乘 + 受伤减免，阵亡即回退）
      releaseCoeffRefs(inst); // 撤销其施加在各被作用单位上的目标级修饰
      releaseTime(inst); // 撤销其施加在各被作用单位上的时间系数（携带者阵亡）
      releaseStealth(inst); // 撤销其施加在各被作用单位上的潜行标记（携带者阵亡）
      inst._coeffAdd = 0;
      inst._coeffMul = 1;
      inst._takeMul = 1;
      releaseForced(inst); // 撤销其强制目标来源（被强制者按来源栈回落或回正常优先级）
    }
    if (capOverlays.has(ship.id)) capOverlays.delete(ship.id); // 施加在死者身上的 cap 不再需要维持
    // 死者自身的强制来源栈不再有意义（它已无法行动）→ 清空，避免残留标签
    if (Array.isArray(ship.forceStack)) {
      ship.forceStack.length = 0;
      refreshForcedTags(ship);
    }
  }

  /** 清理本存活单位指向“已判死目标”的引用并回落上游（原 dropDeadTargets 里“每存活单位清自身引用”部分）。
   *  Pass1 每单位开头执行：上一 tick 判死的目标，本 tick 行动前即时回落。 */
  function clearShipDeadRefs(ship) {
    const foes = ship.side === 'ally' ? enemies : allies;
    // ★ **两个存活判据必须分开**（曾经的 BUG 根因）：
    //   · `ship.targetId`（船级目标）**只可能是敌方**（由全队策略/自动选敌产生）→ 用 `aliveFoeId`；
    //   · 模块**手动目标**（`inst.target`）范围由该模块的 `target.kinds` 决定，**可以是任意单位**
    //     （`self`/`ally`/`any`：例如“时间扭曲”选中自己或友军）→ 必须用 `aliveUnitId` 在全场单位里找。
    //     若统一按敌方队列判定，则选中自己/友军的模块手动目标会被**误判为已阵亡**，
    //     在下一个 tick 被清成 `{mode:'follow'}`（并误写一条“回落”战报）→ 表现为**手动目标改不动**。
    const aliveFoeId = (id) => {
      const u = foes.find((f) => f.id === id);
      return !!(u && u.alive);
    };
    const aliveUnitId = (id) => {
      const u = allies.find((f) => f.id === id) || enemies.find((f) => f.id === id);
      return !!(u && u.alive);
    };
    if (ship.targetId && !ship.lockTargetId && !aliveFoeId(ship.targetId)) {
      ship.targetId = null;
      battleLog('battle.log.autoTarget', { ship: uTok(ship) }, ['ship']);
    }
    for (const inst of ship.modules) {
      const t = inst.target;
      if (!t) continue;
      if (t.mode === 'unit') {
        if (!aliveUnitId(t.id)) {
          inst.target = { mode: 'follow' };
          battleLog(
            'battle.log.moduleFollow',
            { ship: uTok(ship), module: i18n.t(inst.cfg.nameKey) },
            ['ship']
          );
        }
      } else if (t.mode === 'units') {
        const kept = (t.ids || []).filter(aliveUnitId);
        if (kept.length !== (t.ids || []).length) {
          if (!kept.length) {
            inst.target = { mode: 'follow' };
            battleLog(
              'battle.log.moduleFollow',
              { ship: uTok(ship), module: i18n.t(inst.cfg.nameKey) },
              ['ship']
            );
          } else {
            t.ids = kept; // 部分目标阵亡：仅移除并保留其余
          }
        }
      }
    }
  }

  /** 单位临时生命周期：Pass1 只记“本 tick 寿命递减意图”（结算步骤 4e 落地，到期判死记 tempExpired）。
   *  不再在 Pass1 就地判死：判死会撤销 cap 影响，属数值修改，须与其它数值一样归到结算阶段。 */
  function pass1TempLifespan(ship, ctx) {
    if (!ship.temp || !ship.alive) return;
    ctx.P.tempTick = true;
  }

  /**
   * Pass1 —— 模块激活（词条执行器判定段，不立即改目标数值）。
   * 只推进模块自身副作用（durationLeft/cooldown/_shieldSeq/自身护盾生池填池/召唤/上限叠加/粘性目标）
   * 并把对目标的数值影响写入 pending；目标值统一在 Pass2 结算。
   */
  function maybeActivate(ship, inst, ctx) {
    const fx = inst.cfg.effects;
    if (!fx) return;
    // ★ 低血触发门控（`hp_below_activate`，如 `0.2` = **仅当单位血量 ≤ 20% 时**才可激活一次）：
    //   · 只读写**结构标记** `inst._firedOnce`（非数值）→ 符合 Pass1“零数值变化”约定；
    //   · 血量比例 = `hull.hp / hull.hpMax`（`hpMax` 已含上限类词条的运行期增减）；
    //   · **标记生命周期**：本次真正激活时打标（见下方 payEnergy 之后）→ 该低血区间内不再激活；
    //     血量**回升过阈值**（比例 > 阈值）即在此清除标记 → 下次跌破阈值可再次触发；
    //   · 判定且标记清扫都在 Pass1、读 tick 起始血量（本 tick 的判死/回血均在结算阶段落地，
    //     Pass1 内血量恒定 → 判定与遍历位置无关、跨单位对等）。
    const hpNeed = fx.hp_below_activate || 0; // 0 = 无门控（既有模块行为不变）
    let hpRatio = 1;
    if (hpNeed > 0) {
      hpRatio = ship.hull.hpMax > 0 ? ship.hull.hp / ship.hull.hpMax : 0;
      if (hpRatio > hpNeed) inst._firedOnce = false; // 血量回升过阈值 → 清标记（可再次触发）
    }
    if (!inst.enabled) return;
    // 低血门控：未进入低血区间 / 本低血区间已触发过（标记未清）→ 本次不激活（不耗能、不进冷却）
    if (hpNeed > 0 && (hpRatio > hpNeed || inst._firedOnce)) return;
    if (inst.cooldown > 0) return;
    if (inst.durationLeft > 0) return; // 持续效果进行中不可重复触发
    const cost = fx.energy_cost || 0;
    // ★ 能量门控用“单位内运行计数”（tick 起始能量 + 本 tick 回充 − 本 tick 已记账消耗），
    //   而非 ship.hull.energy（能量已改为结算阶段落地）。保证同单位多模块的依次门控结果与旧即时语义一致，
    //   且该计数是单位局部、不跨单位，故不引入新的顺序差。
    // ★ **矿物成本门控**（`ore_cost`，自身词条）与能量成本**同一处、同体例**：
    //   读“单位内运行计数” `ctx.oreAvail`（tick 起始携带量 − 本 tick 已记账矿物支出）；
    //   不足 → **不激活、不扣矿物、不进冷却**（与能量不足完全一致，含 ramp 成长清零）。
    //   ⚠ 召唤型模块按既有设计**不进入 `canImpact`**（无目标级判定），故其成本门控就在此处
    //     （`doSummon` 内另有一次同口径复核）；非召唤模块的矿物成本同时也在 `canImpact` 拦住。
    const oreCost = fx.ore_cost || 0;
    if (ctx.avail < cost || (oreCost > 0 && ctx.oreAvail < oreCost)) {
      // 成本不足：本次不触发；逐步伤害(ramp)成长清零 → 断能/断矿后伤害回到基础值
      if (inst._ramp) inst._ramp = { key: '', count: 0 };
      return;
    }

    // —— 召唤类模块（fx.summon 存在）：走召唤执行（立即生成单位，属结构性副作用） ——
    if (fx.summon && typeof fx.summon === 'object' && fx.summon.type) {
      const sTypes = Array.isArray(fx.type) ? fx.type : fx.type ? [fx.type] : [];
      const perTarget = sTypes.includes('per_target'); // 特殊 type 标记：召唤数量 = 当前目标数（每个目标一枚）
      const needTargets = perTarget || fx.summon.bind_target; // 需先解析发射器模块目标
      const aimList = needTargets ? moduleTargetList(ship, inst) : [];
      if (perTarget) {
        // 逐目标补召一枚（每枚绑定其对应目标）；无目标则不召唤
        if (!aimList.length) return;
        for (const t of aimList) doSummon(ship, inst, fx, t.id, true, ctx); // ignoreCap：本次齐射不受在场上限限制
        return;
      }
      if (fx.summon.bind_target) {
        const boundId = aimList.length ? aimList[0].id : undefined;
        if (boundId) doSummon(ship, inst, fx, boundId, false, ctx); // 有目标才召唤并锁定
        return;
      }
      doSummon(ship, inst, fx, null, false, ctx);
      return;
    }

    // —— 非召唤模块：解析目标并做可行性判定（目标解析读 tick 起始快照，不受本 tick pending 影响）——
    const targets = moduleTargetList(ship, inst);
    // 自毁词条(self_destruct_damage)：即使无可命中目标也必须引爆自毁（始终触发）
    const isSuicide = (fx.self_destruct_damage || 0) !== 0;
    // ★ **无需目标的自身/星区词条**（自毁 `self_destruct_damage` / 采矿 `ore_gain` / 星区 `sector_ore_add`
    //   `sector_ore_mul` / 仅带星区冷却词条且未声明 `kinds` 者）：`target` 缺省 ⇒ 候选池为空，
    //   但它们**不进入目标选择链** → 跳过“必须有目标”这一前置判定。
    //   ⚠ 与自毁的区别：自毁连可行性判定都跳过（始终触发）；采矿与星区词条**仍走 `canImpact`**
    //     （容量/储量/双冷却门控都在那里）。
    //   ⚠ 只带星区冷却词条**但声明了 `kinds`** 的模块（效果另算）**不**跳过该判定（避免空放）。
    const sectorW = sectorWordOf(inst);
    const secCd = sectorCdTicksOf(inst);
    const declaresKinds = Array.isArray((inst.cfg.target || {}).kinds) && (inst.cfg.target || {}).kinds.length > 0;
    //   ★ 装载器（`type` 标签 `cargo_loader`）与采矿/星区词条**同体例**：作用于“星区货物 → 本舰货舱”，
    //     不是战斗单位 ⇒ **不进入目标选择链**，跳过“必须有目标”的前置判定（可行性仍在 `canImpact`）。
    const cargoLoader = isType(fx, 'cargo_loader');
    const selfTargeted =
      isSuicide || (fx.ore_gain || 0) > 0 || cargoLoader || !!sectorW || (secCd != null && !declaresKinds);
    if (!selfTargeted && !targets.length) return; // 无足够目标：本次不激活
    if (!isSuicide && !canImpact(ship, targets, fx, inst, ctx)) return; // 无可生效目标/条件：不激活不耗能

    // ★ 激活锁定（`type` 标签 `lock_target_on_activate`）：把**本次解析结果**记为锁定集合 ——
    //   · 持续期内 `moduleTargetList` 直接返回该集合（优先级高于强制目标与手动目标）；
    //   · 玩家在持续期内点选的目标只被**记录**在 `inst.target`，下一次激活时按正常链采用；
    //   · 只写“结构引用”（单位 id 列表），不产生任何数值变化 → 符合 Pass1 零数值变化约定；
    //   · 持续期结束（`durationLeft` 归 0）锁定自动失效，无需额外撤销。
    if (isType(fx, 'lock_target_on_activate')) inst._lockIds = targets.map((t) => t.id);

    // —— ★ 自身·**装载能力**（`type` 标签 `cargo_loader`，如装载光束）：**Stage A —— 只登记认领申请** ——
    //   · **位置**：在**成本支付（`payEnergy`/`payOre`）与冷却之前**提前返回 —— 装载器**不在此处耗能**，
    //     因为“本 tick 是否真的开始装载”要等**跨阵营速度裁决**（见 `resolveLoadClaims`）才确定；
    //     若在此先扣能量，败者会白付能量、且赢家会重复扣一次。
    //   · **为什么不在此处就地认领**：同一 tick 内多个装载器争抢货物时，**认领顺序＝装载速度从高到低**
    //     （唯一口径 `cargoLoadSpeedOf`），而本函数按**固定单位顺序**被逐个调用 ⇒ 必须先把所有申请收齐，
    //     再由 `resolveLoadClaims()` 在**同一 Pass1 内、Phase A 之前**统一裁决（见 `step()`）。
    //   · 故此处**不耗能、不进冷却、不写 pending、不计激活数**：裁决获胜者才按既有口径记账
    //     （能量/冷却/意图/激活统计），**败者直接不激活** —— 语义与“无可生效目标不激活”完全一致，
    //     且 **Pass1 仍零数值变化**（只是记账）。
    //   · 对象选择与需求时长都在裁决处算（唯一口径 `pickLoadableCargo` / `cargoLoadNeedTicks`），
    //     读的仍是**本 tick 起始快照**（Pass1 内不产生任何可见数值变化）⇒ 快照稳定、可复现。
    if (cargoLoader) {
      queueLoadClaim(ship, inst, ctx);
      return;
    }

    // 自身能量消耗：只记账（结算步骤 3 统一落地），并在 Pass1 扣减单位内运行计数以做后续门控
    payEnergy(ctx, inst, cost);
    // ★ 自身**矿物成本**（`ore_cost`）：与能量消耗**同批、同体例** —— Pass1 只记账
    //   （`__pending.oreSpends`），由**结算步骤 3d-1** 统一从自身矿物仓扣除（读口径 `oreLoadOf`）；
    //   `canImpact`（唯一门控出口）已用同一运行计数 `ctx.oreAvail` 拦住不足者 ⇒ 此处恒成功。
    //   （**非召唤模块**的 `ore_cost` 就在本行扣除 —— 如「矿物维修」`oreRepair`；
    //     召唤型（矿渣导弹发生器）走上面的召唤分支、由 `doSummon` 记账，两者口径完全一致。）
    if (oreCost > 0) payOre(ctx, inst, oreCost);
    // ★ 低血触发（`hp_below_activate`）：本次**真正激活**（目标/可行性/能量门控均已通过）→ 打标记；
    //   该标记只在“血量回升过阈值”时被清除（见函数顶部）→ 每个低血区间只触发一次。
    if (hpNeed > 0) inst._firedOnce = true;
    if ((fx.duration_ticks || 0) > 0) {
      // 持续时间词条：先进入持续期（需求量＝timeScaled(duration_ticks, 本 tick 时间系数)，已推进归 0）；
      // 时长型护盾池的“创建+填满”改为意图（结算步骤 4a 落地，使池值变化与其它数值修改同样归到结算阶段）。
      // 持续结束后自动进冷却；瞬间量值词条走 pending。
      startDuration(inst, tickTimeCoeff(ship));
      clearCooldown(inst);
      if (inst._expiryRec) inst._expiryRec.cancelled = true; // 本 tick 到期后又重新激活 → 覆盖该次到期撤销
      if ((fx.shield_cap_bonus || 0) > 0) ctx.P.poolFills.push({ inst, ship });
      // 受伤减免词条（damage_coeff_mul）：持续期内生效 → 激活时记“置位”意图，
      // 由结算步骤 2 落地（写施放方自身的 damageTakeMulMods）；到期撤销由 expiries 统一处理。
      const mulKey = Object.keys(DAMAGE_TAKE_MUL).find((k) => (fx[k] || 0) > 0);
      if (mulKey) {
        ctx.P.coeffOps.push({
          inst,
          ship, // 自身词条（无 `_target` 后缀）：作用对象＝模块所属单位（自身获得受伤减免）
          mode: 'takeMul',
          value: fx[mulKey],
          want: true,
          self: true,
        });
      }
    } else {
      startCooldown(inst, tickTimeCoeff(ship)); // 瞬时模块：激活后进入冷却（需求量按当前时间系数）
    }

    // —— ★ 自身词条·采矿（`ore_gain`）：本 tick 的**采集请求**（Pass1 只记账，**零数值变化**）——
    //   · 请求量 = `ore_gain × coeff(ship,'mining')` **取整**（`Math.round`：与货仓容量唯一口径
    //     `cargoCapacityOf`/`oreCapacityOf` 同族；矿物是**离散数量**，储量/入库量恒为整数）
    //     —— 与矿物容量的缩放类别**同一口径**（乘**采矿系数**，不是模块自身类别系数；当前二者同值）。
    //   · 再按**剩余矿物容量**（扣掉本 tick 本单位已认领量）截断；剩余为 0 的情形已在 `canImpact` 挡住。
    //   · 真正的**分配与入库**在结算步骤 3b 统一次算清（跨单位一次算清 → 储量不足时按比例均分）。
    if ((fx.ore_gain || 0) > 0) {
      const want = Math.round(fx.ore_gain * coeff(ship, 'mining'));
      const room = oreRoomOf(ship, ctx.oreClaimed);
      const claim = Math.max(0, Math.min(want, room));
      if (claim > 0) {
        ctx.oreClaimed = (ctx.oreClaimed || 0) + claim; // 单位内运行计数：同单位多模块累加截断
        const P = pendOf(ship);
        if (P) P.oreGains.push({ inst, amount: claim });
      }
    }

    // —— ★ **货物传输**（`type` 标签 `cargo_transfer`，如「货物传输」）：本 tick 的**搬运意图** ——
    //   （Pass1 **只记账、零数值变化**；真正搬运在**结算步骤 3d-3**统一落地）
    //   · 被搬运物＝本单位**已入舱货物**中**按列表顺序第一件「目标剩余货舱装得下」的**
    //     （**顺延口径**，用户口径；唯一实现 `pickCargoOf(ship,'fifo',false, cargoRoomOf(target))`
    //     ⇒ 首件装不下就往后顺延；全部装不下 ⇒ null）；`canImpact` 已用**同一函数、同一快照**预筛
    //     ⇒ 此处不再另写第二套判据（**不会出现“门控通过但选不到”**）；
    //   · ★ **目标与货物在 Pass1 一起冻结**（记录内所存实体引用即所选之件）⇒ 结算步骤 3d-3
    //     **不重选**，只按**当前**剩余货舱**防御性复核**（装不下 ⇒ 整件不转、幂等，见 `settleCargoTransfers`）；
    //   · **实体搬运**：记录里存**货物实体引用**（同一 `id`/同一对象）⇒ `tons`/`level`/`loadTicks`
    //     随实体一起过去，**不在记录里另存数值**（避免第二套数值口径、也无需重算）；
    //   · 仍**只搬一件**（“多件累加”不在本轮口径内：顺延只影响“选哪一件”，不影响“搬几件”）；
    //   · `cargoClaimedTick`：**全局预留**该实体（同单位多模块、以及“别人的货物强化”都不会再动它；
    //     先到先得、收集顺序固定 ⇒ 与遍历顺序无关、可复现）；
    //   · 目标＝`targets[0]`（`countMode:'single'` ⇒ 单目标；无目标已被前置判定挡住）。
    if (isType(fx, 'cargo_transfer')) {
      const target = targets[0];
      const cargo = target ? pickCargoOf(ship, 'fifo', false, cargoRoomOf(target)) : null;
      if (target && cargo) {
        cargoClaimedTick.add(cargo.id); // 本 tick 全局预留（只存在于 Pass1 局部语境，不写游戏状态）
        const P = pendOf(ship);
        if (P) P.cargoTransfers.push({ inst, from: ship, to: target, cargo });
      }
    }

    // —— ★ **货物维修**（`type` 标签 `cargo_repair`，如「货物维修」）：本 tick 的**消耗+回血意图** ——
    //   （Pass1 **只记账、零数值变化**；货物销毁在**结算步骤 3d-4**、回血在**步骤 4c**统一落地）
    //   · 被消耗物＝本单位**已入舱货物**中**吨位最小者**（并列取列表靠前＝先入舱者；唯一实现 `pickCargoOf(…,'min')`）；
    //   · ★ **回血量在 Pass1 一次算好并冻结**：`round(货物吨位 × hp_per_ton)`（体例同 `cargoLoadNeedTicks`/
    //     `ore_gain`：Pass1 用 tick 起始快照算好再记账，结算阶段**不重算**）；
    //   · ★ **不乘任何类别系数**：`hp_per_ton` **不进**量值词条表 `AMOUNT` ⇒ 通用路径的 `fx[k]*类别系数`
    //     缩放根本不适用；算好的量直接走**既有目标级 `hpDeltas`**（与 `hp_target` 同一条路径、
    //     步骤 4c `applyHpTo` 正值按 hpMax 截断、不受受伤减免）⇒ **对既有模块零影响**；
    //   · `cargoClaimedTick` 全局预留该实体（同单位多模块、以及“别人的货物强化”都不会再动它）。
    if (isType(fx, 'cargo_repair')) {
      const target = targets[0];
      const cargo = pickCargoOf(ship, 'min');
      const perTon = fx.hp_per_ton || 0;
      if (target && cargo && perTon > 0) {
        const amount = Math.round(Math.max(0, cargo.tons || 0) * perTon); // ★ 唯一计算/取整处（冻结进意图）
        if (amount > 0) {
          cargoClaimedTick.add(cargo.id);
          const P = pendOf(ship);
          if (P) P.cargoRepairs.push({ inst, ship, cargo, amount });
          const Pt = pendOf(target);
          if (Pt) Pt.hpDeltas.push({ inst, amount }); // 目标级回血（结算步骤 4c 与 hp_target 同批）
        }
      }
    }

    // —— ★ **货物强化**（`type` 标签 `cargo_enhance`，如「货物强化」）：本 tick 的**强化意图** ——
    //   （Pass1 **只记账、零数值变化**；真正写入在**结算步骤 3d-5**统一落地）
    //   · 被强化物＝**目标单位货舱**中**第一件「尚未被强化」的货物**（FIFO 口径，唯一实现
    //     `pickCargoOf(target,'fifo',true)`）；`canImpact` 已保证“目标确有此等货物” ⇒ 此处不再重判；
    //   · **提升量＝词条原值** `fx.bonus_add`（**不乘任何类别系数**：该词条不进 `AMOUNT` 表，
    //     通用缩放路径不适用；本处也只做一次 `|| 0` 取值，不改写数值）；
    //   · 记录里存**货物实体引用**（同一 `id`/同一对象）⇒ 落地时直接对实体写入；
    //   · `cargoClaimedTick`：**全局预留**该实体（本 tick 任何单位/模块不得再搬运/消耗/强化它；
    //     先到先得，收集顺序固定 ⇒ 确定可复现）；
    //   · 目标＝`targets[0]`（`countMode:'single'` ⇒ 单目标；无目标已被前置判定挡住）；
    //     写入落在**目标**货舱的货物上（可为他人，不写施放者自身）。
    if (isType(fx, 'cargo_enhance')) {
      const target = targets[0];
      const add = fx.bonus_add || 0;
      const cargo = target ? pickCargoOf(target, 'fifo', true) : null;
      if (target && cargo && add > 0) {
        cargoClaimedTick.add(cargo.id);
        const P = pendOf(ship);
        if (P) P.cargoEnhances.push({ inst, target, cargo, amount: add });
      }
    }

    // —— ★ 星区词条（`sector_ore_add` / `sector_ore_mul`）＋ **星区侧冷却词条**（`sector_cd_ticks`）——
    //   本 tick 的**星区变更意图**（Pass1，**零数值变化**）：
    //   · 只要模块**带星区效果词条或星区冷却词条**，激活成功后就记一条 `__pending.sectorOps`
    //     （`kind` 为 `'add'|'mul'`；**仅带冷却词条者 `kind = null`**，即本次只有冷却要落地）；
    //   · 同时把「本 tick 星区已被该模块接受」写进 `sectorClaimedTick`（Pass1 记账、非数值）→
    //     同一 tick 后续单位携带同一模块时，`canImpact` 的门控会挡住 → **固定顺序只接受第一个**；
    //   · **加法量在此按采矿系数缩放并取整一次**：`round(词条值 × coeff(ship,'mining'))`
    //     —— 与**采矿激光实采量完全同口径、同位置**（`ore_gain` 也是 Pass1 用本 tick 快照算好再记账），
    //     故本 tick 内系数变化（结算步骤 2 的 coeffOps）不会改动已经记好的意图量 ⇒ 快照稳定、可复现；
    //     乘法仍为**纯比例**（不乘任何系数，用户口径）。
    //   · 星区冷却**不在此写**（与实例冷却一样“激活时先不动、结算阶段统一落地”）：由 3c 写入 `sectorCdUntil`，
    //     时长取 `sector_cd_ticks`、算法与同一实例的 `startCooldown` 完全一致 ⇒ 两把冷却对同一单位**同 tick 到期**；
    //   · 意图照常由 Phase A 收集（**不按 alive 门控**）：与既有口径一致 ——
    //     “施放方本 tick 已死其意图仍照常落地”（激活成功即生效，随后阵亡不影响本次结果）。
    if (sectorW || secCd != null) {
      const P = pendOf(ship);
      const raw = sectorW ? fx[sectorW.key] || 0 : 0;
      // 加法＝绝对增量（乘采矿系数、取整）；乘法＝增量比例（原样，不乘系数）
      const value = sectorW && sectorW.kind === 'add' ? Math.round(raw * coeff(ship, 'mining')) : raw;
      if (P) {
        P.sectorOps.push({
          inst,
          ship,
          kind: sectorW ? sectorW.kind : null,
          value,
          cdTicks: secCd, // null ＝ 该模块不参与星区冷却
        });
      }
      sectorClaimedTick.add(inst.cfg.id);
    }

    // —— 目标级受伤减免词条（`damage_coeff_mul_target`）：对**每个解析目标**写其自身的受伤减免 ——
    //   ★ 逐目标一条记录（`rec.ship` ＝被作用单位，与自身词条区分）；与自身词条同批在结算步骤 2 落地，
    //     故同样**下一 tick 生效**。
    //   ★ 与自身受伤减免同规则：**必须搭配 `duration_ticks`**（时长型）——离开持续期才有唯一的撤销时机
    //     （到期/停用/阵亡/移出场景）；无 `duration_ticks` 的瞬时模块不施加，避免“施加后永不撤销”。
    const tMulKey = Object.keys(DAMAGE_TAKE_MUL_T).find((k) => (fx[k] || 0) > 0);
    const tAddKey = Object.keys(COEFF_ADD_T).find((k) => (fx[k] || 0) !== 0);
    if ((tMulKey || tAddKey) && (fx.duration_ticks || 0) > 0) {
      for (const t of targets) {
        if (!t.alive) continue; // 目标已死：不施加（结算时还会按 alive 复核）
        if (tMulKey) {
          ctx.P.coeffOps.push({
            inst,
            ship: t,
            mode: 'takeMul',
            value: fx[tMulKey],
            want: true,
          });
        }
        if (tAddKey) {
          ctx.P.coeffOps.push({
            inst,
            ship: t,
            category: COEFF_ADD_T[tAddKey],
            mode: 'add',
            value: fx[tAddKey],
            want: true,
          });
        }
      }
      // 作用集合 `inst._coeffRefs` 由**结算阶段**在记录落地后统一写入（Pass1 不写）：
      // 一次激活一“批”，重复激活不会覆盖掉上一批而漏撤销（撤销时机＝到期/停用/阵亡/移出场景）。
    }

    // —— 强制目标（`type` 标签 `force_target_self`）：把**目标选择器解析出的每个目标**的
    //     强制目标切换为施放者 ——
    //   ★ 引擎按**标签**识别（不按模块 id 硬编码）；受影响单位＝ `moduleTargetList` 的结果
    //   （可被 blast_range/exclude 等影响）。与上限修改同理，Pass1 只记账（结算步骤 2b 统一落地，
    //   跨单位顺序一致）。**作用集合 `inst._forcedRefs` 由结算阶段写入**（见 applyForceOp），
    //   供到期/停用/阵亡时精确出栈撤销.
    //   ★ 与系数修饰同规则：**必须搭配 `duration_ticks`** —— 持续期结束是唯一的自动撤销时机；
    //     无时长的瞬时模块不施加（否则“施加后永不撤销”，且重复激活会丢掉上一批作用集合）。
    if (isType(fx, 'force_target_self') && (fx.duration_ticks || 0) > 0) {
      const fTargets = targets.filter((t) => t !== ship);
      ctx.P.forceOps.push({ inst, actor: ship, targets: fTargets });
    }

    // —— ★ 潜行（`type` 标签 `stealth`）：把**作用集合**内的单位标记为“潜行”（不可作为主要攻击目标）——
    //   · 引擎按**标签**识别（不按模块 id 硬编码）；作用集合＝**共享 helper** `effectSetOf`
    //     （解析到的目标 ∪ `blast_range` 波及 ∪ `include_self` 自身），与上限类/时间系数词条同源
    //     （“潜行”模块 kinds:['self'] → 集合即自身；将来若要“给友军上潜行”只需改选择器，引擎无需改动）。
    //   · 与其它时长型修饰同规则：**必须搭配 `duration_ticks`** —— 持续期结束是唯一的自动撤销时机
    //     （到期 / 停用 / 阵亡 / 移出场景 / 重新激活前统一走 `releaseStealth`）；无时长的瞬时模块不施加。
    //   · Pass1 只记账（`__pending.stealthOps`，**零数值变化**），结算步骤 2 与 capOps/coeffOps/timeOps
    //     **同批**统一落地（先于伤害结算）→ 从**下一 tick 的目标解析**起体现。
    //   · **不改任何数值**：仍受 `blast_range` 溅射、仍受既已锁定的目标（`lockTargetId` /
    //     `lock_target_on_activate` 锁定集合）约束。
    if (isType(fx, 'stealth') && (fx.duration_ticks || 0) > 0) {
      const P = pendOf(ship);
      if (P) P.stealthOps.push({ inst, targets: effectSetOf(ship, targets, fx) });
    }

    // —— 目标级 量值/上限 词条：对每个选定目标同时生效（shield/hp/energy 三类）——
    const co = coeff(ship, inst.cfg.category);
    // ★ **量值按词条原值**（`type` 标签 `exact_amount`，如「矿物维修」的回血 `hp_target`）：
    //   本模块的**目标级量值词条**（`AMOUNT` 表：shield/hp/energy/ore）一律**不乘任何系数**（1:1 口径）；
    //   · 引擎按**标签**识别、不按模块 id 硬编码；**只管量值**，不管 `CAPFIELD` 上限类词条；
    //   · 未带该标签的既有模块走原 `fx[k] * co` 路径 ⇒ 数值一字不变（零回归）。
    const exactAmt = isType(fx, 'exact_amount');
    const amtKeys = Object.keys(AMOUNT).filter((k) => (fx[k] || 0) !== 0);
    const capKeys = Object.keys(CAPFIELD).filter((k) => (fx[k] || 0) !== 0);
    if (capKeys.length) {
      // 上限类词条为"单次一次性、仅对当前所选目标"：
      // 每次触发先撤销上次施加在(旧)目标上的上限影响，再对本次解析目标重新施加——
      // 故不随多次触发累加；切换目标后于下一次触发时生效到新目标（旧目标影响随之消失）。
      // ★ 对等性：上限修改**不在 Pass1 即时生效**，而是与伤害/数值一样归到 Pass2 结算阶段统一落地
      //   （见 applyCapOps：Phase A2，先于伤害结算）。否则本 tick 排前的施放方会即时压掉排后单位
      //   的能量/血量/护盾上限，使其判定/耗能/回能吃新上限，而镜像局面不吃 → 同 tick 双方不对等。
      //   这里只把“上限意图”记入施放方 __pending.capOps。
      // 携带者阵亡时由其判死点 onDeath 就地撤销（dropSourceMods）。
      // ★ 作用集合（激活瞬间确定并冻结）：由**共享 helper** `effectSetOf` 计算
      //   ＝ 解析到的目标 ∪ `blast_range` 波及 ∪ `include_self` 自身（时间加速等词条组共用同一实现）。
      const capTargets = effectSetOf(ship, targets, fx);
      const P = pendOf(ship);
      if (P) {
        P.capOps.push({
          inst,
          actor: ship, // 施放方引用（结算落地/战报用；施放方本 tick 已死也照常落地）
          ops: capKeys.map((k) => [CAPFIELD[k], fx[k] * co]), // 数值在激活瞬间按系数冻结
          targets: capTargets,
          paralyze: (fx.energy_cap_target || 0) < 0, // EMP 语义：能量上限被压到 0 →“瘫痪”
        });
      }
    }

    // —— 「时间系数」词条（`time_coeff`）：把**作用集合**内的单位各计时器**需求量**乘上 (1 + 系数) ——
    //   · 作用集合＝**共享 helper** `effectSetOf`（目标 ∪ blast_range 波及 ∪ include_self 自身），
    //     与上限类词条同源，故“选中友方 + 波及 + 自身”一次算清；**不新增任何作用集合逻辑**。
    //   · 与其它时长型修饰同规则：**必须搭配 `duration_ticks`**（离开持续期才有唯一的撤销时机）。
    //   · 与上限修改同批：Pass1 只记账（`__pending.timeOps`），结算步骤 2 统一落地
    //     → 落地/撤销都跨单位顺序一致，且从**下一 tick 的需求量**起体现
    //     （本 tick 的计时已按 tick 起始的快照系数推进完毕）。
    //   · 系数**不经类别系数缩放**（时间系语义：`-0.1` 就是需求量 ×0.9）；可正可负，故判定用 `!== 0`。
    const timeKey = Object.keys(TIME).find((k) => (fx[k] || 0) !== 0);
    if (timeKey && (fx.duration_ticks || 0) > 0) {
      const P = pendOf(ship);
      if (P) {
        P.timeOps.push({
          inst,
          targets: effectSetOf(ship, targets, fx),
          coeff: fx[timeKey], // 时间系数（负=加速 / 正=放缓）
        });
      }
    }
    for (const target of targets) {
      const P = pendOf(target);
      if (!P) continue;
      for (const k of amtKeys) {
        const f = AMOUNT[k];
        // ★ **矿物输送**（`ore_target`）：**1:1、不乘任何系数**（单独成支，不走下面的 `fx[k] * co`）——
        //   · 实际输送量＝`min(词条值, 自身剩余携带矿物, 目标剩余矿物容量)`；
        //     `自身剩余携带` ＝ 单位内运行计数 `ctx.oreAvail`（tick 起始携带量 − 本 tick 已记账支出），
        //     `目标剩余容量` ＝ 唯一口径 `oreRoomOf`（＝ oreCapacityOf − oreLoadOf）；两者都是 **Pass1 快照**读，
        //     故与遍历顺序无关、镜像对等（`canImpact` 已保证自身携带 ≥ 词条值、目标剩余容量 > 0）。
        //   · **一条记录＝一次「自身 −N / 目标 +N」**（成对、原子、同额）→ 记在**施放方** pending 上
        //     （`__pending.oreTransfers`），结算步骤 3d-2 统一落地；不在目标 pending 上另记一条
        //     ⇒ 天然**不重复计数**。
        //   · 同单位多模块共用 `ctx.oreAvail` 预算：前一模块的支出会即时减少后一模块可用量（按序、不超发）。
        if (f === 'ore') {
          const want = fx[k];
          const carried = Math.max(0, ctx.oreAvail != null ? ctx.oreAvail : oreLoadOf(ship));
          const amount = Math.max(0, Math.min(want, carried, oreRoomOf(target)));
          if (amount <= 0) continue;
          ctx.oreAvail = carried - amount; // 单位内运行计数：按序扣减（防同单位多模块超发）
          const Ps = pendOf(ship);
          if (Ps) Ps.oreTransfers.push({ inst, from: ship, to: target, amount });
          continue;
        }
        // ★ 量值缩放：默认 `词条值 × 本模块类别系数`（`co`）；带 `exact_amount` 标签的模块按**词条原值**（1:1）。
        const amt = exactAmt ? fx[k] : fx[k] * co;
        if (f === 'shield') P.shieldHeals.push({ inst, amount: amt }); // 目标级护盾量值 → Pass2 作用到池
        else if (f === 'energy') P.energyDeltas.push({ inst, amount: amt });
        else P.hpDeltas.push({ inst, amount: amt }); // hp：正加血负扣血（直接机体，可致死）
      }
    }
    // fx.shield_gain（**自身词条**：无 `_target` 后缀 → 作用于模块所属自身，如 alphaShield 自回盾）
    //   同入自身 shieldHeals（Pass2 结算）。要作用到目标请用 `shield_gain_target`。
    if ((fx.shield_gain || 0) > 0) {
      const Ps = pendOf(ship);
      if (Ps) Ps.shieldHeals.push({ inst, amount: fx.shield_gain * co });
    }

    // —— 逐步伤害（ramp_per_hit）：每次成功激活 +ramp，持续同一组目标则逐次累加 ——
    //  有 max_damage：从基础 damage 起涨，封顶 max_damage；无则从 0 起涨，封顶 damage。
    //  目标组改变（切换/阵亡）→ 于本次激活检测到并清零、重新累加。
    const baseRaw = fx.damage || 0;
    let effRaw = baseRaw;
    if ((fx.ramp_per_hit || 0) > 0) {
      const typeArr = fx.type || [];
      if (typeArr.includes('ramp_by_enemy_count')) {
        // —— type 钩子 ramp_by_enemy_count：单次伤害随“当前场上敌方存活数”提升（不随时间累积）——
        //    伤害 = 基础 damage + ramp_per_hit × 当前敌方存活数；有 max_damage 则封顶。
        //    敌方阵亡越多，单发伤害越低。 ——
        const foes = ship.side === 'ally' ? enemies : allies;
        let foeCount = 0;
        for (const f of foes) if (f.alive) foeCount += 1;
        const hasMax = (fx.max_damage || 0) > 0;
        const rawBonus = baseRaw + (fx.ramp_per_hit || 0) * foeCount;
        effRaw = hasMax ? Math.min(fx.max_damage, rawBonus) : rawBonus;
      } else {
        // —— type 钩子 ramp_full：仅当“目标选择的所有槽位都有目标”才逐击增伤；
        //    目标未满时（如 dualLaser 只命中 1/2）不成长，伤害维持基础 ——
        const needFull = typeArr.includes('ramp_full');
        let canRamp = true;
        if (needFull) {
          const reqCount = Math.max(
            1,
            (inst.cfg.target && inst.cfg.target.maxCount) || targets.length
          );
          canRamp = targets.length >= reqCount;
        }
        if (canRamp) {
          const sig = targets
            .map((u) => u.id)
            .sort()
            .join(',');
          if (!inst._ramp) inst._ramp = { key: '', count: 0 };
          if (sig !== inst._ramp.key) {
            inst._ramp.key = sig;
            inst._ramp.count = 0;
          }
          inst._ramp.count += 1; // 本次激活计数 +1
          const steps = inst._ramp.count - 1; // 首次=基础，此后每次激活 +ramp
          const hasMax = (fx.max_damage || 0) > 0;
          const cap = hasMax ? fx.max_damage : baseRaw;
          const start = hasMax ? baseRaw : 0;
          effRaw = Math.min(cap, start + (fx.ramp_per_hit || 0) * steps);
        }
      }
    }
    const effDmg = effRaw * coeff(ship, inst.cfg.category); // 出伤侧到此为止：受伤减免在 applyHit 入口按**受击方**结算
    const isBlastMod = isType(fx, 'blast'); // 爆炸型伤害（如火箭/导弹爆炸）
    // ★ `delayed_trigger`（`type` 标签，**后触发**）：本模块的伤害**不在激活时开出**，
    //   而是把「作用集合 + 出伤数值」冻结在激活瞬间，待**持续期到期结算的瞬间**才记账并走既有伤害链路
    //   （见 `fireDelayedEffect`）。注意：与 `blast`/`explosive` 等标签相互独立、可叠加。
    const isDelayedTrigger = isType(fx, 'delayed_trigger');
    // —— 主目标伤害（pending 记账，Pass2 结算实际吸收/扣血并判破盾/反射）——
    //   ★ 后触发模块（`delayed_trigger`）在此**不开出伤害**，只冻结载荷（见下方延迟块）。
    if ((fx.damage || 0) > 0 && !isDelayedTrigger) {
      for (const target of targets) {
        const P = pendOf(target);
        if (P) P.dmg.push({ actor: ship, inst, amount: effDmg, blast: isBlastMod, splash: false });
      }
      // —— 爆炸范围 blast_range：命中主目标后，对其所在队列"视觉顺序中的前后"各 blast_range 个位置内
      //    的存活单位同时造成同额爆炸伤害。目标在发射时锁定，爆炸不另行选目标、不随目标改变。 ——
      //    ★ **队列口径与 `effectSetOf` 完全一致**（共享 `orderedQueueFor`）：主目标**同侧、同 role** 的队列，
      //      **不跨 role 波及**。既有伤害类模块均为 `kinds:['enemy']` → 主目标必在敌方队列，
      //      故与旧写法（施放方的敌方队列）**等价**，既有行为零变化。
      //    防爆护盾：若主目标命中被防爆池吸收(isBlastMod)，blast_range 被抑制（不再波及相邻单位）——
      //    Pass1 无法预知是否被防爆吸收，故一律按“条件爆炸(带 gate)”挂账，Pass2 按主目标结果决定是否跳过。
      const blastR = ((fx.blast_range || 0) | 0);
      if (blastR > 0) {
        const hitSet = new Set(targets.map((u) => u.id));       // 主目标已结算，不再重复受爆炸
        const actKey = `${ship.id}:${inst.id}`;                 // 每次激活唯一 gate（爆炸抑制按整次激活）
        for (const primary of targets) {
          const roster = orderedQueueFor(primary);              // ★ 目标同侧同 role 的视觉顺序队列
          const idx = roster.findIndex((u) => u.id === primary.id);
          if (idx < 0) continue;
          for (let k = 1; k <= blastR; k += 1) {
            for (const nb of [roster[idx - k], roster[idx + k]]) {
              if (!nb || !nb.alive || hitSet.has(nb.id)) continue;
              hitSet.add(nb.id);
              const P = pendOf(nb);
              if (P) {
                P.dmg.push({
                  actor: ship,
                  inst,
                  amount: effDmg,
                  blast: isBlastMod,
                  splash: true,
                  gate: isBlastMod ? actKey : null, // 仅爆炸型主模块可被防爆抑制
                });
              }
            }
          }
        }
      }
    }
    // —— ★ `delayed_trigger`（后触发）的**载荷冻结**：激活瞬间只记结构引用与数值，不产生任何效果 ——
    //   · 作用集合＝**共享 helper** `effectSetOf`（解析到的目标 ∪ `blast_range` 波及 ∪ `include_self`），
    //     与上限类/时间系数词条同一实现，**激活瞬间冻结**（持续期内新入场/离场单位不受影响）；
    //   · 出伤数值＝`effDmg`（已按**激活瞬间**的类别系数折算，持续期内系数变化不影响本次引爆）；
    //   · 主目标 id 集合另存：引爆时用于区分“主目标命中”与“`blast_range` 溅射”（与即时爆炸同一口径，
    //     波及条目带 `gate` → 主目标被防爆池吸收时波及被抑制）；
    //   · 载荷全部为**结构引用/数值缓存**，Pass1 零数值变化；真正落地在持续期到期分支（`fireDelayedEffect`）。
    if (isDelayedTrigger && (fx.damage || 0) > 0) {
      inst._delayedRefs = effectSetOf(ship, targets, fx);
      inst._delayedPrimary = new Set(targets.map((t) => t.id));
      inst._delayedDmg = effDmg;
      inst._delayedBlast = isBlastMod;
    }
    // —— 自毁词条 self_destruct_damage：对所属单位自身血量"正加负减"（负值即扣光机体死亡）；
    //    始终触发（锁定目标即使已阵亡也照常引爆），Pass2 在自身血量上结算。 ——
    if (isSuicide && ship.alive) {
      const P = pendOf(ship);
      if (P) P.selfDestruct = { inst, amount: fx.self_destruct_damage || 0 };
    }
    // 持久化自动目标（粘性）：无手动锁定时记住本次实际命中的目标，下次沿用存活者。
    // ★ 被强制顶到首位的目标**不写入粘性**：强制是有时限的外部约束，不是本模块“自己选定”的目标；
    //   若记入粘性，强制结束（来源栈空）后仍会被粘性继续锁着 → 违背“全部来源失效后按正常优先级重新解析”。
    const autoLocked =
      !ship.targetId && (!inst.target || inst.target.mode === 'follow');
    if (autoLocked && targets.length) {
      const fr = forcedTopUnit(ship);
      const keep = fr ? targets.filter((t) => t.id !== fr.id) : targets;
      inst._stick = keep.length ? keep.map((t) => t.id) : undefined;
    }
    // 本次激活统计：activations / energy 立即记；damage/shield 实际量 Pass2 结算后累计到 _pendingAct
    inst._pendingAct = { dmg: 0, shield: 0 };
    inst.stats.activations += 1;
    inst.stats.energySpent += cost;
  }

  /** Pass1 —— 单位级行动遍历：对一个单位一次做完全部“行动”侧工作。
   *  （原分散的 闪标递减 / __pending 初始化 / 自身死目标引用清理 / 能量回充 /
   *    模块结构推进与窗口累计 / 模块激活记账 / 临时单位生命周期 归并到这里，Pass1 只对单位跑一次。）
   *  闪标/挂账只对本 tick 行动的存活单位有意义，故在此一并完成，不再单独全量循环。 */
  function pass1Unit(ship) {
    // —— 本 tick 起始：护盾/反射/同盟/防爆/受击闪标逐 tick 递减（纯表现，可即时） ——
    if (ship._healFlash > 0) ship._healFlash -= 1;
    if (ship._reflectFlash > 0) ship._reflectFlash -= 1;
    if (ship._allyFlash > 0) ship._allyFlash -= 1;
    if (ship._bpFlash > 0) ship._bpFlash -= 1;
    if (ship._dmgFlash > 0) ship._dmgFlash -= 1;
    // （本 tick 挂账已在 Pass1 遍历前为全体存活单位一次性建好，见 step()；
    //   召唤新增单位由 pendOf 惰性创建，此处不再重置，以免冲掉排前单位记到其身上的记账。）
    // —— 清理自己指向“已判死目标”的引用（结构引用清理，非数值修改）——
    clearShipDeadRefs(ship);
    // —— 本 tick 的**受伤减免系数快照**（damage_coeff_mul 系列，受击向）：Pass1 单位开头取一次，
    //    供本 tick 的全部受伤/减伤判定统一使用 →
    //    “本 tick 受伤按 tick 起始值算，本 tick 结算阶段落地的修饰从下一 tick 才体现”，
    //    与其它系数的生效时序一致（且不引入任何数值修改，仅只读缓存）。 ——
    ship._takeMulTick = damageTakeMul(ship);
    // —— 本 tick 的**单位时间系数快照**（`time_coeff`）：Pass1 单位开头取一次，
    //    供本 tick 的三类计时器需求量换算（模块持续/冷却、临时单位存在时间）统一使用 →
    //    “本 tick 的计时需求量按 tick 起始的系数算，本 tick 结算阶段落地的系数/撤销从下一 tick 才体现”，
    //    与受伤减免/系数完全同一范式（且不引入任何数值修改，仅只读缓存）。
    //    ★ 唯一口径 timeCoeffOf(ship)；每 tick 推进量恒为 1，只有“需求量”随系数变化。 ——
    ship._timeCoeffTick = timeCoeffOf(ship);
    // —— 本 tick 的**潜行快照**（`type` 标签 `stealth`）：Pass1 单位开头取一次，供本 tick 全部
    //    目标解析（`moduleTargetList` / `shipEffectiveTarget` → `targetAllowed` → `stealthBlocksTargeting`）统一使用 →
    //    “本 tick 的目标解析按 tick 起始的潜行状态进行，本 tick 结算阶段落地的潜行从下一 tick 起体现”，
    //    与受伤减免/时间系数完全同一范式（且不引入任何数值修改，仅只读缓存）。
    //    ★ 唯一读口径 isStealthed(ship)。 ——
    ship._stealthTick = isStealthed(ship);
    const P = pendOf(ship);
    if (!P) return;
    // —— 能量回充：只记账（数值统一在结算步骤 3 落地）——
    const regen = energyRegenTick(ship, P);
    // ★ 单位内运行计数：本 tick 起始能量 + 本 tick 回充额度 —— 供本 tick 门控/窗口判定使用。
    //   能量本身不改（Pass1 零数值变化）；该计数是单位局部，同单位多模块依次门控结果与旧即时语义一致。
    // ★ `oreAvail` ＝**本 tick 可动用的携带矿物预算**（tick 起始携带量，唯一读口径 `oreLoadOf`）：
    //   供**矿物成本**（`ore_cost`）与**矿物输送**（`ore_target`）在单位内**按序扣减**——
    //   二者共用同一预算 ⇒ 同单位多模块的总支出**恒不超过 tick 起始携带量**（防超发、可复现）；
    //   与 `oreClaimed`（**采矿入库**的单位内认领计数）方向相反、各自独立：一个管“进”、一个管“出”。
    const ctx = {
      ship,
      P,
      avail: Math.min(ship.hull.energyCap, ship.hull.energy + regen),
      oreAvail: oreLoadOf(ship),
    };
    // —— 模块：① 结构推进(时长/冷却递减、窗口累计、到期只记撤销意图) ② 判定激活(只记账不改数值)
    //          ③ 条件型自身增益(状态型，只记期望生效状态) ④ 常驻被动(无“激活-触发”流程) ——
    for (const inst of ship.modules) advanceModuleState(ship, inst, ctx);
    for (const inst of ship.modules) {
      if (isType(inst.cfg.effects, 'solo')) pass1CoeffState(ship, inst, ctx);
      // ★ 常驻被动（`type` 标签 `passive`，如增幅器类 hp_cap_bonus/energy_cap_bonus/energy_regen_bonus、
      //   回收利用 hp_regen_per_death）：**不进“激活-触发”流程**（无冷却/耗能/持续期、无目标）。
      //   纯静态加成由派生重算落地（安装/启停时 ship.js `syncSelfStatics`）；按上一 tick 阵亡数结算的
      //   词条只在此记账（`__pending.hpDeltas`，Pass1 零数值变化），由结算步骤 4c 统一落地。
      else if (isType(inst.cfg.effects, 'passive')) pass1Passive(ship, inst, ctx);
      else maybeActivate(ship, inst, ctx); // 状态型模块不进“激活-触发”流程（无冷却/耗能/持续期）
    }
    // —— 临时单位存在时间：只记“寿命递减意图”（结算步骤 4e 落地，到期判死）——
    pass1TempLifespan(ship, ctx);
  }

  /* ---------------- Pass 2 结算 ---------------- */

  function applyEnergyTo(u, amount) {
    if (!u || !u.alive) return;
    u.hull.energy =
      amount > 0
        ? Math.min(u.hull.energyCap, u.hull.energy + amount)
        : Math.max(0, u.hull.energy + amount);
  }
  function applyHpTo(u, amount) {
    if (!u || !u.alive) return;
    u.hull.hp =
      amount > 0
        ? Math.min(u.hull.hpMax, u.hull.hp + amount)
        : Math.max(0, u.hull.hp + amount);
    if (u.hull.hp <= 0 && u.alive) {
      u.hull.hp = 0;
      u.alive = false;
      battleLog('battle.log.destroyed', { ship: uTok(u) }, ['ship']);
      onDeath(u); // 就地撤销死者残留效果/cap 影响
    }
  }

  /* ---- 结算步骤 4 的子步（按类别跨单位统一落地，迭代的是“记录数组”而非全量单位） ---- */

  /** 4a 模块护盾池“创建+填满”（时长型护盾重新激活）：结算阶段落地，池值变化不作为 Pass1 副作用。 */
  function applyPoolFill(rec) {
    const inst = rec.inst;
    const o = rec.ship; // 所属单位（记账时携带，避免结算期再做全量单位查找）
    if (!o || !o.alive) return; // 目标(自身)已死者跳过
    if (inst._expiryRec) inst._expiryRec.cancelled = true; // 重新激活覆盖本 tick 的到期撤销
    inst._shieldSpent = false;        // 重新激活：清除上轮"已耗尽"标记 → 重新贡献独立池/回满
    recalcDerived(o);                 // 生成该模块的护盾池（空池，总上限即提高）
    fillModuleShieldPool(o, inst);    // ★ 只把该模块自身池补满到其 cap；本体/其它模块池保持现值
    inst._shieldSeq = ++shieldSeq;    // 记录激活顺序（先激活的先被使用）
  }

  /** 4b 护盾补/汲取（含“汲取抽空 → 就地破盾降 cap”）
   *  ★ 负值（对目标的**削盾**＝伤害类削减）乘该单位的**受伤减免系数**（与 applyHit 同一口径）；
   *    正值（回盾/增益）不减免；能量削减不做减免（见 applyEnergyDeltas）。 */
  function applyShieldHeals(u, P) {
    let drainedShield = false;
    const takeMul = tickTakeMul(u);
    for (const h of P.shieldHeals) {
      const amt = h.amount < 0 ? h.amount * takeMul : h.amount;
      const act = poolShieldAdd(u, amt); // 实际作用量（正=补入，负=汲取）
      if (act < 0) drainedShield = true;      // 汲取(负)可能把池抽空 → 抽空即破盾
      if (act > 0) {
        u._healFlash = 40; // 回盾闪光标记（≈2s）
        if (h.inst && h.inst._pendingAct) h.inst._pendingAct.shield += act;
      }
    }
    if (drainedShield && u.alive) breakShieldOnDepletion(u); // 汲取抽空的池：就地破盾降 cap
  }

  /** 4d 自毁（self_destruct_damage）：直接改机体血量，负值扣光即判死。
   *  ★ **受伤减免系数对它无效**（自伤，不是“受到的伤害”；走本独立路径即天然豁免）。 */
  function applySelfDestruct(u, P) {
    if (!P.selfDestruct || !u.alive) return;
    const sdam = P.selfDestruct.amount;
    u.hull.hp =
      sdam > 0
        ? Math.min(u.hull.hpMax, u.hull.hp + sdam)
        : Math.max(0, u.hull.hp + sdam);
    if (u.hull.hp <= 0) {
      u.hull.hp = 0;
      u.alive = false;
      battleLog('battle.log.selfDestruct', { ship: uTok(u) }, ['ship']);
      onDeath(u); // 就地撤销死者残留效果/cap 影响
    }
  }

  /** 4e 临时单位寿命：**需求量**＝`timeScaled(lifespan, 时间系数)`、**已推进恒 +1**、剩余 = 需求 − 已推进；
   *  剩余归 0 即到期判死（并就地撤销其 cap/存续影响）。
   *  ★ 系数只改“需要多少 tick 才到期”（加速＝需求变少、放缓＝需求变多），不改每 tick 推进量。 */
  function applyTempTick(u) {
    if (!u.temp || !u.alive) return;
    const need = timeScaled(u.tempLifeNeed || 0, tickTimeCoeff(u));
    u.tempLifeElapsed = (u.tempLifeElapsed || 0) + 1; // 已推进恒 +1
    u.tempLeft = Math.max(0, need - u.tempLifeElapsed);
    if (u.tempLeft <= 0) {
      u.hull.hp = 0;
      u.alive = false;
      battleLog('battle.log.tempExpired', { ship: uTok(u) }, ['ship']);
      onDeath(u); // 就地撤销其存续效果/cap 影响
    }
  }

  /** 单次伤害结算：护盾吸收 →（爆炸先防爆拦截）→ 自身池 → 同盟/防爆共享 → 扣血；反射记账。
   * 返回 { dealt, ally, bpAbsorbed, seg }：
   *   dealt      自身池吸收 + 扣血（供 “对目标造成伤害” 统计）；
   *   ally       同盟/防爆共享池吸收总量（含防爆拦截）；
   *   bpAbsorbed 其中进入防爆池的部分（含防爆拦截）；
   *   seg        逐吸收源明细（按引擎实际吸收顺序）：{k:'mod'|'base'|'alliance'|'blastproof'|'hull', inst?, amount}，
   *              供日志按承接者逐段成句。
   * noReflect=true 时该次伤害不再触发反射（用于反射返程的补打回，避免双方反射死循环）。
   * ★ `damage_coeff_mul`（受伤减免）唯一的结算点就在本函数**入口**：先把 `amount` 按**受击方**的
   *   减免系数缩小，再走下述吸收/扣血 —— 因此所有来源（主命中/波及/反射返程）天然一致。 */
  function applyHit(target, amount, blast, actor, noReflect) {
    const zero = { dealt: 0, ally: 0, bpAbsorbed: 0, seg: [] };
    if (!target || !target.alive || amount <= 0) return zero;
    if (invincibleNow(target)) return zero; // 无敌：不受伤害、不阵亡
    // ★★ **受伤减免系数的唯一结算点**（`damage_coeff_mul` 系列，受击向）：
    //    在任何吸收（防爆拦截/护盾池/同盟/舰体）之前，把本次伤害乘上**受击方**的减免系数
    //    → 主目标命中 / 爆炸波及 / 反射返程等**所有来源**自动一并减免，出伤侧无需逐点相乘。
    //    取本 tick 快照 `_takeMulTick`（Pass1 单位开头写入）→ 本 tick 落地的减免**下一 tick**才体现。
    //    豁免：自毁 self_destruct_damage 走 applySelfDestruct 独立路径，根本不经过本函数。
    const takeMul = tickTakeMul(target);
    amount = takeMul === 1 ? amount : amount * takeMul;
    if (amount <= 0) return zero; // 减免到 0（或负）：等效未命中（不产生成句，仍按 0 伤害处理）
    let killed = false; // 本次命中有无把目标击毁（供调用方在“命中句之后”补记被击毁句）
    let rest = amount;
    let dealt = 0;        // 自身池吸收 + 扣血
    let ownAbs = 0;       // 自身池吸收量
    let allyAbs = 0;      // 共享(同盟/防爆)吸收总量
    let bpAbs = 0;        // 共享吸收中进入防爆池的部分
    const takes = [];     // 自身池逐池吸收明细（供反射核算）
    const seg = [];       // 逐吸收源明细（按引擎实际吸收顺序）：{k, inst?, amount}
    // ① 防爆拦截（仅爆炸型）：受防爆护盾保护时先用友方防爆池挡（即使目标自带护盾，爆炸也不伤目标）
    if (blast && rest > 0) {
      const bp = drainBlastproof(target, rest, allies, enemies); // ★ B-1：阵营编队由本实例显式传入
      const drained = rest - bp.rest;
      if (drained > 0) { allyAbs += drained; bpAbs += drained; seg.push({ k: 'blastproof', amount: drained }); }
      rest = bp.rest;
    }
    // ② 自身护盾池承伤：普通伤 base→非防爆模块池（防爆存在不再禁吃本体/其它模块盾）；
    //    爆炸伤可再吃防爆模块池（通常已在①被拦截耗尽）。
    if (rest > 0) {
      const before = rest;
      const own = absorbOwnPools(target, rest, !!blast);
      ownAbs = before - own.rest;
      if (ownAbs > 0) {
        dealt += ownAbs;
        takes.push(...own.takes);
        target._dmgFlash = 40; // 普通护盾受击：护盾条白色闪烁（≈2s；反射/同盟/防爆等各有其色，覆盖此白）
      }
      for (const t of own.takes) {
        if (t.take > 0) seg.push(t.pool.inst ? { k: 'mod', inst: t.pool.inst, amount: t.take } : { k: 'base', amount: t.take });
      }
      rest = own.rest;
    }
    // ③ 自身池耗尽且伤害将扣血：友方同盟/防爆护盾(施放者共享模块池)代为吸收；不够的部分才真正扣血
    if (rest > 0) {
      const beforeAlly = rest;
      const ar = absorbByAlliance(target, rest, !!blast, allies, enemies); // ★ B-1：同上
      const ab = beforeAlly - ar.rest;
      allyAbs += ab;
      bpAbs += ar.bpAbsorbed;
      if (ar.bpAbsorbed > 0) seg.push({ k: 'blastproof', amount: ar.bpAbsorbed }); // 爆炸：③内防爆优先
      if (ab - ar.bpAbsorbed > 0) seg.push({ k: 'alliance', amount: ab - ar.bpAbsorbed });
      rest = ar.rest;
    }
    if (rest > 0) {
      target.hull.hp -= rest;
      dealt += rest;
      seg.push({ k: 'hull', amount: rest });
    }
    if (target.hull.hp <= 0 && target.alive) {
      target.hull.hp = 0;
      target.alive = false;
      killed = true; // 击毁句推迟：由调用方在本命中句之后补记（保证“开火先于被击毁”）
      onDeath(target); // 就地撤销死者残留效果/cap 影响
    }
    // —— 反射护盾（反馈式）：落在目标“反射护盾模块池”内被消耗的量按 shield_reflect 返还给攻击者。
    //    不在此递归/成句打回，而是把返程(含反射模块名)记入 reflectQueue，待本 tick 全部武器/爆炸
    //    命中结算完后统一补打回并组合成句；闪标即时发生。 ——
    if (!noReflect && actor && actor !== target && ownAbs > 0) {
      let reflected = 0;
      let reflectMod = null;
      for (const t of takes) {
        const pool = t.pool;
        const inst = pool && pool.inst;
        const fx = inst && inst.cfg && inst.cfg.effects;
        if (!fx || (fx.shield_reflect || 0) <= 0) continue;
        reflected += (fx.shield_reflect || 0) * t.take;
        if (!reflectMod) reflectMod = inst; // 反射模块名（通常唯一）
      }
      if (reflected > 0) {
        target._reflectFlash = 40; // 反射闪光标记（≈2s，UI 据此闪烁护盾条黄色）
        reflectQueue.push({ owner: target, attacker: actor, mod: reflectMod, amount: reflected });
      }
    }
    // 破盾就地结算：伤害把目标某“自身时长护盾池”抽空(value≤0)即在此处理（普通→结束持续；no_break→标已耗尽）。
    if (target.alive && ownAbs > 0) breakShieldOnDepletion(target);
    return { dealt, ally: allyAbs, bpAbsorbed: bpAbs, seg, killed };
  }

  /** 把单条伤害命中落地成句 + 累加来源模块统计（Pass2 内调用）。
   *  表头：主目标普通=开火命中 / 主目标爆炸=爆炸命中 / 波及=溅射到；
   *  后接按引擎实际吸收顺序的逐吸收段（舰载护盾/自身时长盾模块(绿)/共享同盟/共享防爆/舰体）。 */
  function landDamageApp(app, res) {
    if (app.inst && app.inst._pendingAct) {
      app.inst._pendingAct.dmg += res.dealt + res.ally; // 自身池吸收 + 扣血 + 共享吸收 = 总伤害
    }
    const seg = res && res.seg;
    if (!seg || !seg.length) return; // 0 伤害 / 无敌：不产出成句
    const headKey = app.splash
      ? 'battle.log.hit.splash'
      : app.blast
        ? 'battle.log.hit.blast'
        : 'battle.log.hit.fire';
    const dtypeTag = app.inst ? damageTypeTag(app.inst.cfg && app.inst.cfg.effects) : 'normal';
    emitHitLog(
      headKey,
      { actor: uTok(app.actor), weapon: app.inst ? modTok(app.inst) : null, target: uTok(app.target) },
      seg,
      dtypeTag
    );
    // 被击毁句紧跟在本命中句之后（保证“开火/溅射先于被击毁”的显示顺序）。
    if (res.killed) battleLog('battle.log.destroyed', { ship: uTok(app.target) }, ['ship']);
  }

  /** Pass2 相内子步 —— 结算本 tick 的全部武器/爆炸伤害命中（迭代的是“pending 命中条目”，非每 tick 全量单位）。
   * 主目标先行（确定防爆抑制），后爆炸波及；反射只在此记账(reflectQueue)，真·命中全部结算后由 step 统一返程。 */
  function settleHits(primaries, splashes) {
    // 主目标先行：若爆炸型主目标伤害被防爆池吸收，则其 blast_range 波及被抑制（跳过 gate 内波及）。
    const suppressedGates = new Set();
    for (const app of primaries) {
      if (!app.target.alive) continue; // 目标已判死：不结算该条命中（不重复、不落到已死单位）
      const res = applyHit(app.target, app.amount, app.blast, app.actor, false);
      landDamageApp(app, res);
      if (app.blast && res.bpAbsorbed > 0) {
        suppressedGates.add(`${app.actor.id}:${app.inst.id}`);
      }
    }
    for (const app of splashes) {
      if (!app.target.alive) continue; // 目标已判死：波及不落到已死亡单位
      if (app.gate && suppressedGates.has(app.gate)) continue; // 防爆已拦截主目标 → 不波及相邻
      const res = applyHit(app.target, app.amount, app.blast, app.actor, false);
      landDamageApp(app, res);
    }
  }

  /** 结算步骤 2 —— 统一落地一条“上限修改意图”（Phase A 收集，伤害结算之前应用）。
   *  · 施放方本 tick 已判死也照常落地（与“已死攻击方开出的伤害照常结算”一致，收集不受 alive 门控）；
   *  · 目标已死者跳过：其 onDeath 已撤销 capOverlays/清池，再施加会留残留叠加；
   *  · 先 dropSourceMods(inst)（撤销本模块上次施加的上限影响）再逐目标 setOverlay（非累加；
   *    多条记录之间顺序无关，因 recomputeCap 按目标级总和重算）；
   *  · EMP 附加（瘫痪战报 + ramp 成长清零）与上限应用同处同批执行，保证同 tick 同时生效；
   *    每次激活、每个受影响单位仍只记一条战报（记录本身即“本次激活”，持续期内不会重复触发）。 */
  function applyCapOps(rec) {
    if (!rec || !rec.inst) return;
    dropSourceMods(rec.inst);
    for (const t of rec.targets) {
      if (!t || !t.alive) continue;
      for (const [field, value] of rec.ops) setOverlay(t, rec.inst, field, value);
    }
    if (!rec.paralyze) return;
    const actor = rec.actor || ownerOf(rec.inst);
    if (!actor) return; // 无施放方引用（理论不会）：上限已落地，仅省略战报
    const actorTok = uTok(actor);
    for (const t of rec.targets) {
      if (!t || !t.alive) continue;
      battleLog(
        'battle.log.empParalyze',
        { actor: actorTok, module: modTok(rec.inst), target: uTok(t) },
        ['actor', 'target']
      );
      for (const tinst of t.modules || []) {
        const tfx = tinst.cfg && tinst.cfg.effects;
        if (tfx && (tfx.ramp_per_hit || 0) > 0 && tinst._ramp) tinst._ramp = { key: '', count: 0 }; // 成长清零（同“能量不足/停用”那套）
      }
    }
  }

  /** 破盾机制（独立池模型）：每个“时长型大护盾”模块（duration_ticks>0 且 shield_cap_bonus>0 且持续中）
   *  贡献一个独立护盾池（cap = shield_cap_bonus × 护盾系数，与 recalcDerived 一致）。
   *  - 该模块池被打空(pool.value ≤ 0) ⇔ 该护盾层耗尽：
   *      · 普通模块（硬化/反射等，非 no_break）→ “破盾”→ 立即结束其持续并进入冷却；
   *      · no_break 模块（同盟/防爆等）→ 仅标记 inst._shieldSpent：不再贡献总 cap/独立池，
   *        但持续/冷却/日志不动，维持激活直到自然持续到期。
   *  - 与其它护盾/本体池是否打空无关。 */
  function breakShieldOnDepletion(ship) {
    if (!ship.alive) return;
    const broken = [];
    const spentNoBreak = [];
    for (const inst of ship.modules) {
      if (!inst.enabled || !(inst.durationLeft > 0)) continue;
      const fx = inst.cfg.effects || {};
      if (!((fx.duration_ticks || 0) > 0 && (fx.shield_cap_bonus || 0) > 0)) continue;
      const p = ship.hull.pools.get(inst.id);
      if (!p || p.value > 1e-6) continue; // 该模块池未被抽空
      if (isType(fx, 'no_break')) {
        // no_break：层被打空 → 只标记"已耗尽"，不再贡献总 cap；持续/冷却/日志均不动（走自然持续到期）。
        if (!inst._shieldSpent) spentNoBreak.push(inst);
      } else {
        broken.push(inst); // 普通破盾：结束持续 + 进冷却
      }
    }
    if (!broken.length && !spentNoBreak.length) return;
    for (const inst of broken) {
      endDuration(inst); // 破盾 → 结束持续期（剩余/已推进一并归 0）
      startCooldown(inst, timeCoeffOf(ship)); // 破盾 → 进入冷却（需求量按当前时间系数）
      battleLog(
        'battle.log.shieldBreak',
        { module: i18n.t(inst.cfg.nameKey), ship: uTok(ship) },
        ['ship']
      );
    }
    for (const inst of spentNoBreak) inst._shieldSpent = true; // 不提前结束，仅停贡献
    recalcDerived(ship); // 移除已破盾模块的池（值丢弃）；no_break 已耗尽者的池也被 contributingShieldFx 排除 → 一并删除、cap 回落
  }

  /* （原 dropDeadTargets / cleanDeadEffects 的每 tick 全量循环已去除：
   *   - 存活单位清理“自身指向已死目标的引用” → Pass1 每单位开头 clearShipDeadRefs(ship)；
   *   - 死者撤销自身时长 buff / 其 cap 影响 / 施加在死者上的 cap → 各判死点就地 onDeath(ship)。） */

  /** Pass2 内、每单位一次：把本 tick 激活模块的结算统计写回（lastDmg/lastShield + 累计）。
   * 由 Pass2 收尾单遍单位 for 调用；在临时单位移出前执行以保证死去的召唤也能累计。 */
  function finalizeModules(ship) {
    for (const inst of ship.modules) {
      const pa = inst._pendingAct;
      if (!pa) continue;
      inst.lastDmg = pa.dmg;       // 本次激活实际造成的总伤害
      inst.lastShield = pa.shield; // 本次激活实际恢复的总护盾
      inst.stats.damageDealt += pa.dmg;
      inst.stats.shieldRestored += pa.shield;
      inst._pendingAct = undefined;
    }
  }

  function checkEnd() {
    const anyAlly = allies.some((s) => s.alive);
    const anyEnemy = enemies.some((s) => s.alive);
    if (!anyAlly && !anyEnemy) settle('draw'); // 同 tick 双方同归 → 判和
    else if (!anyEnemy) settle('win');
    else if (!anyAlly) settle('lose');
  }

  /** ★ 结算步骤 3b：星区矿物采集的**唯一分配/入库点**（跨单位一次算清、与遍历顺序无关）。
   *  输入＝本 tick 全部采集请求（固定结算顺序收集，`want` 已在 Pass1 按剩余矿物容量截断）。
   *  流程：① 足额（星区剩余 ≥ 总请求）→ 各按请求量全额；② 不足 → **按请求量比例均分**：
   *        先 `floor(请求量 × 剩余 / 总请求)`，再把未分配的余数按「**请求量从大到小，同量按固定结算顺序**」
   *        逐个 +1 补足 ⇒ **Σ入库 = 剩余储量**（整数、不超发、无遗漏；每方至多 +1）。
   *  ③ 逐请求入库（防御性再钳一次剩余容量）→ ④ 星区储量扣减＝本次**实际入库总量**（不超发）。
   *  · 镜像对等：规则对双方完全相同，且不读任何“当前存活/血量”等可变状态（Pass1 的截断量与
   *    tick 起始储量都是快照）→ 同一局面镜像后结果完全对称。
   *  · 储量守恒（**仅“采矿 ↔ 阵亡返还”这一对**）：扣减＝实际入库量；单位阵亡时由其唯一判死出口
   *    `onDeath` 全额返还 ⇒ 矿物不会因同 tick 阵亡丢失（⚠ 星区储量**无上限**，星区词条可把剩余推到高于初始）。 */
  function settleOreGains(claims) {
    if (!claims.length) return;
    const demand = claims.reduce((s, c) => s + c.want, 0);
    if (demand <= 0) return;
    const avail = Math.max(0, Math.floor(oreReserve)); // 本 tick 起始剩余储量（整数）
    if (avail <= 0) return; // 星区矿物耗尽：全部不采集（`canImpact` 已按同一口径挡住激活，此处复核）
    let grants; // 逐请求的实际分配量（与 claims 同序）
    if (avail >= demand) {
      grants = claims.map((c) => c.want); // 足额：按请求量全额
    } else {
      const base = claims.map((c) => Math.floor((c.want * avail) / demand)); // 先按比例取整（floor）
      let left = avail - base.reduce((s, v) => s + v, 0); // 未分配的余数（恒 < 请求数）
      // 余数补足顺序：**请求量大者优先**，同量按固定结算顺序（收集顺序）——稳定、确定性、可复现
      const order = claims.map((c, i) => i).sort((a, b) => claims[b].want - claims[a].want || a - b);
      for (const i of order) {
        if (left <= 0) break;
        base[i] += 1;
        left -= 1;
      }
      grants = base;
    }
    let granted = 0;
    const byInst = new Map(); // 实际入库量按**模块实例**聚合（见下方战报聚合边界）
    for (let i = 0; i < claims.length; i += 1) {
      const c = claims[i];
      if (!c.ship || !c.ship.alive) continue; // 结算复核存活（正常恒存活：判死都在本步骤之后）
      const amt = Math.min(grants[i], oreRoomOf(c.ship)); // 防御性再钳：正常恒为 0 差额（Pass1 已按容量截断）
      if (amt <= 0) continue;
      c.ship.hull.ore = (c.ship.hull.ore || 0) + amt; // 入库＝本舰矿物仓（读口径 `oreLoadOf`）
      granted += amt;
      byInst.set(c.inst, (byInst.get(c.inst) || 0) + amt); // 同实例多请求合并（Map 保序＝首次入库顺序）
    }
    oreReserve = Math.max(0, oreReserve - granted); // 扣减＝**实际入库总量**（不超发、守恒）
    // ★ 采矿战报（低频，**每模块实例每 tick 至多 1 条**）：成句＝`{owner}的{module}：采集 {n} 点矿物`
    //   · **触发条件＝实际入库量 > 0**（星区储量不足导致比例分配为 0、或容量已满 → 不记）；
    //   · **聚合边界**：按**模块实例**（单位 × 模块配置对象）聚合成一条，`n` ＝ 该实例本 tick
    //     **实际**入库总量（比例分配 + 容量复核后的真值，非请求量）——同一实例本 tick 至多激活 1 次
    //     （激活后自身冷却 ≥ 1 tick），故“聚合”只在防御性场景生效；
    //   · **条数上限**＝本 tick **实际入库**的（单位 × 模块实例）对数 ≤ 该单位采矿模块总数，
    //     且模块自身冷却（`cooldown_ticks`，采矿激光＝20t）天然限频 ⇒ 不会刷屏；
    //   · 与其它低频战报同体例：`owner`＝模块拥有者（`uTok`，着色）、`module`＝模块名（`modTok` 绿字）。
    for (const [inst, amt] of byInst) {
      battleLog(
        'battle.log.miningGain',
        { owner: ownerTok(inst), module: modTok(inst), n: amt },
        ['owner']
      );
    }
  }

  /** ★ 结算步骤 3c：星区储量词条（创世纪 `sector_ore_add` / 矿藏富集 `sector_ore_mul`）的
   *  **唯一落地/冷却点**（跨单位一次算清、与遍历顺序无关）。
   *  输入＝本 tick 全部星区意图（固定结算顺序收集：allies → enemies；Pass1 已按“星区只接受一次”去重）；
   *  每条＝`{ inst, ship, kind:'add'|'mul'|null, value, cdTicks }`（`kind=null`＝仅落冷却）。
   *  落地顺序（★ 用户确认的固定顺序）：
   *    ① **先加法**：全部加法意图**求和后一次性加入**（加法可交换 ⇒ 与顺序无关、确定）；
   *       每条加法量已在 **Pass1** 按 `round(词条值 × coeff(拥有者,'mining'))` 算好（与采矿激光同口径同位置）
   *       ⇒ 本步骤只做求和，**不再乘系数、不再取整**；
   *    ② **再乘法**：按固定结算顺序**逐条**作用于**当前剩余储量**，**每条各取整一次**
   *       （`Math.round(剩余 × (1+比例))`；多条乘法＝连乘、逐次取整；单条时等价于“结算时取整一次”）；
   *    ③ 星区储量**不做任何封顶**（用户口径：无上限），只保持**非负整数**
   *       （`Math.max(0, …)` 仅防负，与既有“储量恒为非负整数”一致）。
   *  冷却落地（同一步）：凡带**星区侧冷却词条** `sector_cd_ticks` 的意图（含 `kind=null` 者），
   *    写入 `sectorCdUntil.set(模块id, runTicks + need)`，其中
   *    `need = timeScaled(sector_cd_ticks, tickTimeCoeff(模块拥有者))` —— 与同一实例自身冷却的
   *    `startCooldown`（取 `cooldown_ticks`）**完全同算法**（只差词条来源、同一 tick 的快照时间系数）
   *    ⇒ 两个词条取同值时，对被接受的那个单位而言两把冷却**同 tick 到期**；
   *    星区冷却因此只额外约束**其它**单位的同模块触发（key ＝ 模块 id，各模块独立）。
   *  · 绝对到期 tick 模型 ⇒ **无逐 tick 递减、无抖动**；`runTicks` 全 tick 恒定 ⇒ 与遍历顺序无关、镜像对等。
   *  · 归属：模块意图即使其拥有者在本 tick 后续判死，也**照常落地**（与既有“施放方已死其意图仍落地”一致）。
   *  · **战报（低频）**：加法记 `battle.log.sectorOreAdd`（`n`＝该条实际增量，即 Pass1 定好的整数增量）；
   *    乘法记 `battle.log.sectorOreMul`（`mul`＝实际乘数 `1+比例`、`n`＝该条**落地前后差值**，逐条精确）。
   *    二者都**只在真正生效时**记：加法仅 `n > 0`、乘法仅在该条改变了储量时记（`n > 0`）⇒
   *    每模块每次激活至多 1 条，且受星区侧冷却限频，天然低频。 */
  function settleSectorOps(ops) {
    if (!ops.length) return;
    // ① 加法：全部求和后一次性加入
    let addSum = 0;
    for (const op of ops) if (op.kind === 'add') addSum += op.value || 0;
    if (addSum !== 0) oreReserve = Math.max(0, Math.round(oreReserve + addSum)); // 无上限；取整仅守“储量恒为非负整数”不变量（整数词条下为恒等）
    // ①′ 加法战报：逐条记（各条增量互相独立、求和即总量 ⇒ 逐条归属精确；仅实际增量 > 0 才记）
    for (const op of ops) {
      if (op.kind !== 'add' || !(op.value > 0)) continue;
      battleLog(
        'battle.log.sectorOreAdd',
        { owner: ownerTok(op.inst), module: modTok(op.inst), n: op.value },
        ['owner']
      );
    }
    // ② 乘法：按固定结算顺序逐条作用于“当前剩余储量”，每条各取整一次
    for (const op of ops) {
      if (op.kind !== 'mul') continue;
      const before = oreReserve;
      const mul = 1 + (op.value || 0);
      oreReserve = Math.max(0, Math.round(oreReserve * mul)); // 取整＝每条乘法作用时各一次
      const gain = oreReserve - before; // 该条**实际**增量（逐条精确，取落地前后差值）
      if (gain > 0) {
        battleLog(
          'battle.log.sectorOreMul',
          { owner: ownerTok(op.inst), module: modTok(op.inst), mul: fmtLogNum(mul), n: gain },
          ['owner']
        );
      }
    }
    // ③ 星区侧冷却：凡带该词条的意图各写一份（key＝模块 id）——各模块独立计时
    for (const op of ops) {
      if (op.cdTicks == null) continue;
      const need = timeScaled(op.cdTicks, tickTimeCoeff(op.ship));
      const id = op.inst && op.inst.cfg ? op.inst.cfg.id : null;
      if (id != null) sectorCdUntil.set(id, runTicks + Math.max(0, need));
    }
  }

  /** ★ 结算步骤 3d-1：**模块矿物成本**（自身词条 `ore_cost`）的唯一扣除点。
   *  输入＝本 tick 全部“施放成功”的矿物成本记录（固定结算顺序收集：allies → enemies），
   *  每条＝`{ ship（成本承担者）, inst, amount }`（amount 已在 Pass1 由 `payOre` 记账，**未取整需求**：
   *  词条为整数矿物量，且门控已保证单位内总支出 ≤ tick 起始携带量）。
   *  · 落点：`hull.ore` 直接扣减（唯一写入口之一；读口径恒为 `oreLoadOf`），**下限 0**（防御性钳制）；
   *  · 与本 tick 的**采矿入库（3b）互不影响**：3b 只增加、本步骤只减少，且本步骤在 3b **之后**
   *    ⇒ “本 tick 采到的矿物可即时用于本 tick 的成本”，绝不会透支（Pass1 预算基于 tick 起始量）；
   *  · 与**矿物输送（3d-2）共用同一 Pass1 预算** `ctx.oreAvail` ⇒ 同单位多模块总支出不超发；
   *  · **本步骤自身不记战报**：成本消耗与既有 `energy_cost` 同一口径（能量消耗也不记战报）；
   *    两类由“矿物成本”触发的低频战报各自成句于其**效果落地处**：
   *      – 召唤事件 → 既有 `battle.log.summon`（矿渣导弹发生器走该链路）；
   *      – 治疗型（`ore_cost` + 治疗 `hp_target`，如「矿物维修」）→ `battle.log.oreRepair`，
   *        成句在**结算步骤 4c**（回血落地处，此时才拿得到“实际回血量”）。
   *  · ★ 为后者在本步骤写一个**非数值的聚合标记**：`inst._orePaidAmt`（本 tick 该实例**实际**扣矿量）
   *    与 `inst._orePaidTick`（写入时的 tick 号）—— 4c 成句时按 `_orePaidTick === runTicks` 取用，
   *    保证取的必然是**本 tick** 的真实扣减量（跨 tick 残留值不会被误用）。 */
  function settleOreSpends(list) {
    if (!list.length) return;
    for (const rec of list) {
      const u = rec.ship;
      if (!u || !u.alive) continue; // 防御性：正常恒存活（判死都在本步骤之后）
      const amt = Math.max(0, rec.amount || 0);
      if (amt <= 0) continue;
      const beforeOre = Math.max(0, u.hull.ore || 0);
      u.hull.ore = Math.max(0, beforeOre - amt);
      // ★ 战报聚合标记（**模块实例上的非数值字段**，与 `_stealthActive`/`_firedOnce` 同类）：
      //   实际扣减量＝扣前 − 扣后（正常恒等于 amt；仅病态钳制时更小）⇒ “n 取实际量”的唯一来源。
      if (rec.inst) {
        rec.inst._orePaidAmt = beforeOre - u.hull.ore;
        rec.inst._orePaidTick = runTicks;
      }
    }
  }

  /** ★ 结算步骤 3d-2：**矿物输送**（目标级量值词条 `ore_target`）的唯一落地/搬运点。
   *  输入＝本 tick 全部输送意图（固定结算顺序收集：allies → enemies），
   *  每条＝`{ inst, from（施放方）, to（目标）, amount（Pass1 已截断的实际输送量） }`。
   *  · **1:1 成对**：一条记录＝一次「from −N / to +N」，**同额、原子**（同一条内先扣后加，
   *    不存在只扣不加/只加不扣的中间态）⇒ 矿物总量守恒、不重复计数；
   *  · **按实际量结算**：在 Pass1 截断量基础上**再钳一次**（自身当前携带 `oreLoadOf`、
   *    目标当前剩余容量 `oreRoomOf`）——防御性复核（正常恒为恒等，因为 Pass1 已按 tick 起始快照截断、
   *    且 3b 只增不减；仅在“同一 tick 多方输送给同一目标”超出其剩余容量的极端情形下生效，
   *    此时以**固定顺序**先到先得、按实际装入量 1:1 结算，规则对双方一致 ⇒ 镜像对等）；
   *  · 施放方若在本 tick 已死：本步骤仍在其**判死之前**，故恒存活；目标同理；
   *  · **战报（`battle.log.oreTransfer`）**：★ 仅在**实际输送量 > 0** 时记 1 条
   *    （`n` 取**实际**转移量，非请求量/词条值），成句带**模块拥有者**（着色）＋模块名（绿）＋目标（着色）。
   *    ★ **每模块每 tick 至多 1 条**：本词条所在模块为主动模块、单次激活只产生 1 条输送记录
   *    （冷却 ≥1 tick ⇒ 同实例每 tick 至多激活一次），故“一条记录＝一条战报”即为上限，
   *    与「采矿激光」的“每 tick 每模块至多 1 条”同一聚合体例（此处甚至无需再聚合）。
   *    ★ 成句位置＝**落地处**（与数值同一批、同在结算步骤 3d-2）：`n` 就是真正写入的数值，
   *    与 UI 数值条**天然一致**（不会出现“日志说 50、实际只进 30”的偏差）。
   *    ⚠ 不记“请求量”也不记“被截断量”：截断原因（自身不足/目标已满）本身就不会激活 ⇒ 无事件。 */
  function settleOreTransfers(list) {
    if (!list.length) return;
    for (const rec of list) {
      const from = rec.from;
      const to = rec.to;
      if (!from || !to || !from.alive || !to.alive) continue; // 防御性：正常恒存活
      const amt = Math.max(
        0,
        Math.min(rec.amount || 0, oreLoadOf(from), oreRoomOf(to))
      );
      if (amt <= 0) continue;
      from.hull.ore = Math.max(0, (from.hull.ore || 0) - amt); // 施放方 −N
      to.hull.ore = (to.hull.ore || 0) + amt;                  // 目标 +N（同额 ⇒ 1:1）
      // ★ 低频战报：仅在**实际输送量 > 0** 时记 1 条（每模块每 tick 至多 1 条，见上方说明）。
      //   成句体例与既有低频战报一致：`{owner}的{module}：…`，owner/target 着色、模块名绿。
      battleLog(
        'battle.log.oreTransfer',
        { owner: ownerTok(rec.inst), module: modTok(rec.inst), n: amt, target: uTok(to) },
        ['owner', 'target']
      );
    }
  }

  /* ---------------- ★ 货物传输 / 货物维修 / 货物强化 · 结算（步骤 3d-3 / 3d-4 / 3d-5）：唯一落地处 ----
   * 位置：**矿物支出段（3d）之内、3d-2 之后**，整段恒在**步骤 4（含全部判死）之前**：
   *   步骤 3b 采矿入库 → 3c 星区词条 → 3d-1 矿物成本 → 3d-2 矿物输送
   *   → **3d-3 货物传输（搬运整件）→ 3d-4 货物维修消耗（销毁整件）→ 3d-5 货物强化（写入 bonus）**
   *   → 步骤 4a/4b/4c(回血)/4d/4e … → Phase B/B2 → 步骤 5 装载完成 → Phase C
   * · 与 3d-1/3d-2 **互不影响**：那两条只动 `hull.ore` / 星区储量，本三条只动 `ship.cargos` +
   *   `hull.cargo` + 货物实体的 `bonus`/`enhanced`；
   * · 与步骤 5（货物装载）**互不影响**：5 只动**星区 → 单位**的入舱与在装锁定，本三条只动**单位 → 单位 /
   *   单位内部消耗 / 单位货舱内货物的加成**；且 5 在全部判死之后、本三条在其之前 ⇒ 两者作用的货物集合
   *   **天然不相交**（3d 的货物已在舱内、5 的货物仍在星区；在舱货物不可能被 5 再次装载）；
   * · **确定性**：每条记录在 Pass1 按唯一选择口径选定（传输/维修取**施放方自己的货舱**、强化取
   *   **目标单位的货舱**），且三处共用**每 tick 全局预留集合** `cargoClaimedTick`（先到先得；
   *   收集顺序＝固定结算顺序 allies → enemies）⇒ **与全局遍历顺序无关、镜像对等**；
   *   三处的记录两两作用对象互不相同（各自预留），故 3d-3/3d-4/3d-5 的**先后顺序不改变结果**。
   * · **施放方/目标在本段恒存活**（判死都在其后）⇒ 落地与“谁先谁后死”无关。
   * · ★ 本段在**步骤 5（装载完成）之前** ⇒ 本 tick **搬出/消耗腾出的舱位**可被本 tick 的
   *   “装载完成能否入舱”判定使用（容量读的恒是**当前**值）；反向不会：步骤 5 入舱的货物本 tick
   *   不可能被本段搬运/消耗/强化（Pass1 只从 tick 起始的货舱清单里选）⇒ 单向、确定、可复现。
   */

  /** ★ **结算步骤 3d-4：货物维修消耗**（`type` 标签 `cargo_repair`）的唯一落地/销毁点。
   *  输入＝本 tick 全部维修意图（固定结算顺序收集）：每条 `{ inst, ship, cargo, amount }`。
   *  · **消耗整件**：把该实体移出 `ship.cargos` 并同步 `hull.cargo −= tons`（**同写同源 ⇒ 不漂移**）；
   *  · **不返还星区**（用户口径：货物被消耗销毁，不是搬运）——既不入 `cargos`、也不入 `cargoQueue`；
   *  · **幂等**：判据＝该实体是否仍在 `ship.cargos` 内（不在 ⇒ 跳过）⇒ 重复调用/重复记录都不会二次扣吨位；
   *  · **在装货物不可被消耗**（防御性复核）：在装货物恒带 `cargo._loadBy` 锁定索引、且必不在 `cargos` 内；
   *  · ★ 写**非数值聚合标记** `inst._cargoPaid`（被消耗货物 id）/`inst._cargoPaidTick`（tick 号）：
   *    供**步骤 4c 回血落地处**成句战报时取“本 tick 确实发生了“以货物换血”这次事实”（体例同 `_orePaid*`）。 */
  function settleCargoRepairs(list) {
    if (!list.length) return;
    for (const rec of list) {
      const ship = rec.ship;
      const cargo = rec.cargo;
      if (!ship || !cargo || !Array.isArray(ship.cargos)) continue;
      if (!ship.alive) continue;                       // 防御性：正常恒存活（判死都在本步骤之后）
      if (cargo._loadBy) continue;                     // 防御性：在装货物不得被消耗
      const i = ship.cargos.indexOf(cargo);
      if (i < 0) continue;                             // 幂等：已不在本舰货舱（已被消耗/返还）⇒ 跳过
      ship.cargos.splice(i, 1);
      ship.hull.cargo = Math.max(0, (ship.hull.cargo || 0) - Math.max(0, cargo.tons || 0));
      if (rec.inst) {
        rec.inst._cargoPaid = cargo.id;
        // 成句用的货物显示名**在销毁处取一次**（此时实体仍在手，口径与 UI 芯片一致）——
        // 避免 4c 再按 id 反查（该实体已不在任何清单内）。
        rec.inst._cargoPaidName = cargoNameForLog(cargo);
        rec.inst._cargoPaidTick = runTicks;
      }
    }
  }

  /** ★ **结算步骤 3d-3：货物传输**（`type` 标签 `cargo_transfer`）的唯一落地/搬运点。
   *  输入＝本 tick 全部传输意图（固定结算顺序收集）：每条 `{ inst, from, to, cargo }`。
   *  · **成对原子**：一条记录＝一次「from 货舱 −整件 / to 货舱 +整件」，**同一实体**先出后入，
   *    不存在只出不入/只入不出的中间态（同一条内完成）⇒ 货物总量守恒、不重复计数；
   *  · **实体原样搬运**：`id`/`tons`/`level`/`loadTicks` 全部随实体过去（**不修改任何字段**，
   *    尤其**不改 `loadTicks`**：不会把“已装好 20t”重置，也不会给未装好的货物打上该特性）；
   *  · `hull.cargo`（数值口径 `cargoLoadOf`）与**实体清单**（`cargoListOf`）**同写同源**⇒不会漂移；
   *  · **落地时按当前剩余货舱再钳一次**（防御性复核）：**装不下则整件不转**（确定性规则 —— 转移是
   *    **整件原子**的，不存在“转一半”；Pass1 门控已按 tick 起始快照挡住 ⇒ 正常不会发生）；
   *  · **幂等**：判据＝该实体是否仍在 `from.cargos` 内（不在 ⇒ 跳过）⇒ 重复调用无副作用；
   *  · **战报（`battle.log.cargoTransfer`）**：★ 仅**实际搬运成功**时记 1 条、每模块每 tick ≤ 1 条
   *    （单目标单件 ⇒ 天然至多一条），成句在**落地处**（与数值同批）。 */
  function settleCargoTransfers(list) {
    if (!list.length) return;
    for (const rec of list) {
      const from = rec.from;
      const to = rec.to;
      const cargo = rec.cargo;
      if (!from || !to || !cargo) continue;
      if (!from.alive || !to.alive) continue;          // 防御性：正常恒存活（判死都在本步骤之后）
      if (cargo._loadBy) continue;                     // 防御性：在装货物不得被搬走
      const i = from.cargos.indexOf(cargo);
      if (i < 0) continue;                             // 幂等：源货舱已无该件 ⇒ 跳过（不产生半程搬运）
      const tons = Math.max(0, cargo.tons || 0);
      if (cargoRoomOf(to) < tons) continue;            // 防御性复核：目标当前装不下 ⇒ 整件不转
      from.cargos.splice(i, 1);
      from.hull.cargo = Math.max(0, (from.hull.cargo || 0) - tons);
      to.cargos.push(cargo);
      to.hull.cargo = Math.max(0, (to.hull.cargo || 0) + tons);
      battleLog(
        'battle.log.cargoTransfer',
        {
          owner: ownerTok(rec.inst),
          module: modTok(rec.inst),
          cargo: cargoNameForLog(cargo),
          target: uTok(to),
        },
        ['owner', 'target']
      );
    }
  }

  /** ★ **结算步骤 3d-5：货物强化**（`type` 标签 `cargo_enhance`，如「货物强化」）的唯一写入点。
   *  输入＝本 tick 全部强化意图（固定结算顺序收集）：每条 `{ inst, target, cargo, amount }`。
   *  · **写入对象＝货物实体**（可为**他人**货舱里的货物）：`cargo.bonus += amount`（**加性、倍率语义**）
   *    并置**一次性标记 `cargo.enhanced = true`**——标记写在实体上，**随实体走**
   *    （之后被传输、阵亡返还星区、再次装载都**不清除**）⇒ “每件货物只能被强化一次”由此保证；
   *  · **幂等**：判据＝`cargo.enhanced`（**已标记 ⇒ 直接跳过，绝不二次累加**）；
   *    另有“该实体是否仍在目标货舱内”的复核（不在 ⇒ 跳过）；
   *  · **只读/防御复核**：`cargo._loadBy` 非空（在装货物）⇒ 跳过 —— 在装货物本就不在货舱清单内，双保险；
   *  · **成本顺序**：能量在**步骤 3**、矿物成本在**3d-1**，**都恒在本步骤之前** ⇒ “**先扣成本、后写入效果**”
   *    与既有体例一致（成本不足在 Pass1 已被门控挡住 ⇒ 不会出现“扣了成本却没写入”的正常路径）；
   *  · **与其它链的关系**：本步骤与 3d-2/3d-3/3d-4 只作用于**互不相交**的货物实体
   *    （三处共用每 tick 全局预留集合 `cargoClaimedTick`，先到先得）⇒ **先后顺序不影响结果**；
   *    整段 3d 恒在**步骤 4（含全部判死）**与**步骤 5（装载完成）**之前 ⇒ 只对“本 tick 起始即已入舱”
   *    的货物生效，且施放方/目标此刻都还存活（镜像对等、与遍历顺序无关）。
   *  · **战报（`battle.log.cargoEnhance`）**：★ 仅在**真正写入时**记 1 条、每模块每 tick ≤ 1 条
   *    （单目标单件，天然），成句在本落地处（与数值同批）；`v`＝`bonus_add` 的**增量百分比**
   *    （唯一换算 **`formatBonusDeltaPercent`**：增量语义 ⇒ `0.1 → '+10'`、带正负号；
   *     ⚠ **不得**改用 `formatBonusPercent`——那是**倍率**口径，会把 0.1 当成倍率算出 `−90`）。 */
  function settleCargoEnhances(list) {
    if (!list.length) return;
    for (const rec of list) {
      const target = rec.target;
      const cargo = rec.cargo;
      if (!target || !cargo) continue;
      if (!target.alive) continue;                     // 防御性：正常恒存活（判死都在本步骤之后）
      if (cargo._loadBy) continue;                     // 防御性：在装货物不得被强化
      if (!Array.isArray(target.cargos) || target.cargos.indexOf(cargo) < 0) continue; // 已不在该货舱 ⇒ 跳过
      if (cargo.enhanced) continue;                    // ★ 幂等：已强化过 ⇒ 绝不二次累加
      const add = Math.max(0, Number(rec.amount) || 0);
      if (!(add > 0)) continue;
      const cur = Number(cargo.bonus);
      cargo.bonus = (Number.isFinite(cur) ? cur : 1) + add; // 加性写入（倍率语义、中性值 1）
      cargo.enhanced = true;                                // ★ 一次性标记（随实体走、永不清除）
      battleLog(
        'battle.log.cargoEnhance',
        {
          owner: ownerTok(rec.inst),
          module: modTok(rec.inst),
          cargo: cargoNameForLog(cargo),
          v: formatBonusDeltaPercent(add),
        },
        ['owner']
      );
    }
  }

  /* ---------------- ★ 货物装载 · 结算（步骤 5）：唯一落地处 ---------------- */
  /** ★ 把货物**追加到星区列表末尾**（返还/卸载用：同一 `id`、同一对象）。
   *  · **队列式（前出后入）**：星区列表就是队列 —— 入舱时从列表移除（其余项**前移**），返还时
   *    **排到队尾**；**不再**按 `cargo-<序号>` 插回“原位置”（用户口径：卸载不恢复初始顺序）；
   *  · **长度不限**：直接 `push`，**不做任何上限截断**（星区货物列表**总件数不封顶**：编队定义阶段
   *    不截断、运行时亦不限，见 `data/cargo.js CARGO_LIMITS`）⇒ 装载返还的“外来货物”可无限加入；
   *  · **幂等**：已在列表中 ⇒ 直接返回（不重复追加）；
   *  · **防御**：缺 `id` 的货物（正常不会有）由 `nextCargoId()` 补一个**唯一且不复用**的 id。 */
  function appendCargoToSector(cargo) {
    if (!cargo) return;
    if (cargos.includes(cargo)) return;
    if (!cargo.id) cargo.id = nextCargoId();
    cargos.push(cargo);
  }

  /** 解除**一件**在装装载（幂等）：解锁货物 + 清模块的在装记录（**进度归零**）。
   *  · 双向登记同源：`inst._load`（权威记录）与 `cargo._loadBy`（锁定索引）一并清空；
   *  · **已消耗能量不退**（本函数不碰能量）；货物回到“未锁定、可被任意装载器再次选中”的状态。 */
  function releaseCargoLoad(inst) {
    if (!inst || !inst._load) return;
    const cargo = inst._load.cargo;
    if (cargo && cargo._loadBy && cargo._loadBy.inst === inst) cargo._loadBy = undefined;
    inst._load = undefined;
  }

  /** 把**已完成装载**的货物搬进单位货舱（唯一写入者）：星区 → 单位。
   *  · 货物**出星区列表**（同时出 `cargoQueue`：不在星区了自然不再排队）；
   *  · 进 `ship.cargos` ＋ `hull.cargo += tons`（`cargoLoadOf` 的**唯一数值口径**，与实体清单同写同源）；
   *  · **`loadTicks` 永久改写为 `CARGO_FAST_LOAD_TICKS`（20t）** —— 该件货物此后（含返还星区后）
   *    再装只需 `round(20 ÷ 速度)` tick（用户确认口径：“一次装好”是**货物的特性**，不是本次装载的临时状态）；
   *  · 解锁并清在装记录（`inst._load`/`cargo._loadBy` 归空；`hull.cargo` 与清单**同时**更新 ⇒ 不会漂移）。 */
  function landCargoOn(ship, inst) {
    const ld = inst && inst._load;
    if (!ship || !ld || !ld.cargo) return;
    const cargo = ld.cargo;
    inst._load = undefined;
    if (cargo._loadBy && cargo._loadBy.inst === inst) cargo._loadBy = undefined;
    const qi = cargoQueue.indexOf(cargo.id);
    if (qi >= 0) cargoQueue.splice(qi, 1); // 离开星区 ⇒ 同时离开优先队列
    const ci = cargos.indexOf(cargo);
    if (ci >= 0) cargos.splice(ci, 1);
    cargo.loadTicks = CARGO_FAST_LOAD_TICKS; // ★ 永久“一次装好”（数据层常量，不硬编码）
    ship.cargos.push(cargo);
    ship.hull.cargo = Math.max(0, (ship.hull.cargo || 0) + Math.max(0, cargo.tons || 0));
    // ★ **低频战报「装载完成」**（`battle.log.cargoLoad`）：**仅真正入舱时 1 条** ——
    //   · 本函数是**唯一入舱点**（结算步骤 5 完成处），且每个模块实例同一时刻至多 1 件在装
    //     ⇒ **每模块每 tick ≤ 1 条**（无需聚合去重）；
    //   · **成句与数值同批**：写在落地赋值之后（数值已生效的同一步骤内，顺序确定、可复现）；
    //   · `cargo`＝**纯文本**（与 UI 芯片同一名称口径：自定义名 → 类型名 i18n → 类型标签）、
    //     `owner` 着色（colorKeys）、`module` 恒绿（rich 段的 `mod` 标记）。
    battleLog(
      'battle.log.cargoLoad',
      { owner: ownerTok(inst), module: modTok(inst), cargo: cargoNameForLog(cargo) },
      ['owner']
    );
  }

  /** 把单位的**已装载货物**返还星区（阵亡全额返还 / 详情页主动返还走同一函数）。
   *  · `cargoId` 缺省 ⇒ 返还该单位**全部**（判死出口用）；给 id ⇒ 只返还那一件（UI 接口用）；
   *  · `manual` ＝**玩家主动卸载**（详情页点芯片 ⇒ `true`；阵亡返还不传 ⇒ `false`）：
   *    记**「分阵营 + 带时限」**标记 —— `manualUnloadedSide`＝**卸载者所属阵营**（`ship.side`）、
   *    `manualUnloadedUntil`＝**绝对到期 tick** `runTicks + CARGO_MANUAL_UNLOAD_TICKS`（600t＝30s）：
   *      · 该件在**时限内**不会被**本阵营**的装载器**自动选取**（判据唯一实现 `cargoManualUnloadActive`）；
   *      · **敌对方装载器不受影响**（阵营不同 ⇒ 照常自动装载）；
   *      · **到期自动失效**（绝对到期 tick 模型，无逐 tick 递减 ⇒ 确定、可复现、镜像对等）；
   *      · **玩家把它加入优先队列即立即清除标记**（`toggleCargoQueue`）⇒ 排除只针对自动选取。
   *  · 返回被返还的 id 数组（`[]` ＝ 无货可返）；
   *  · **幂等**：返还后实体离开 `ship.cargos`、`hull.cargo` 同步扣减 ⇒ 重复调用无副作用；
   *  · 货物**保持原 id、原字段**（`loadTicks` 已是 20t ⇒ 特性保留），**追加到星区列表末尾**
   *    （队列式**前出后入**；用户口径：**不恢复初始顺序**、不按序号插回原位）；
   *  · **不自动重新入队**（优先队列是用户的选择，不替用户决定）。 */
  function returnCargoToSector(ship, cargoId = null, manual = false) {
    const out = [];
    if (!ship || !Array.isArray(ship.cargos) || !ship.cargos.length) return out;
    const list = cargoId == null ? [...ship.cargos] : ship.cargos.filter((c) => c.id === cargoId);
    for (const cargo of list) {
      const i = ship.cargos.indexOf(cargo);
      if (i >= 0) ship.cargos.splice(i, 1);
      ship.hull.cargo = Math.max(0, (ship.hull.cargo || 0) - Math.max(0, cargo.tons || 0));
      cargo._loadBy = undefined; // 返还的货物恒解锁（阵亡返还 ⇒ 可再被装载；手动卸载 ⇒ 见下一行）
      if (manual) {
        // ★ 玩家主动卸载：记**分阵营 + 带时限**标记（阵营＝卸载者所属阵营；到期 tick 为绝对值）
        cargo.manualUnloadedSide = ship.side;
        cargo.manualUnloadedUntil = runTicks + CARGO_MANUAL_UNLOAD_TICKS;
      }
      appendCargoToSector(cargo);
      out.push(cargo.id);
    }
    return out;
  }

  /** ★ **结算步骤 5：货物装载统一落地**（位置＝Phase B2 之后、Phase C 之前；唯一落地处）。
   *  为什么放在**全部判死之后**：判死散落在步骤 4c/4d/4e 与 Phase B/B2，只有在此读 `ship.alive`
   *  才能得到**本 tick 的终态** ⇒ 「拥有者本 tick 死亡 ⇒ **解锁、进度归零、不完成装载**」是一条
   *  **确定性规则**（与“谁先谁后死”无关、镜像对等、与遍历顺序无关）；能量已在步骤 3 扣除且**不退**。
   *  三小步（顺序固定）：
   *   ① **启动**：把 Pass1 的意图落地为锁定（双向登记）+ 需求时长（已冻结，不重算）；
   *   ② **推进/解除**：每 tick +1（启动那一 tick 不推进 ⇒ 恰好耗时 `need` tick）；拥有者阵亡或
   *      模块停用 ⇒ 立即解除（解锁 + 进度归零）；
   *   ③ **完成**：`elapsed ≥ need` 且拥有者存活 且**货舱容得下** ⇒ 入舱；容不下（容量中途变小）⇒
   *      **保持锁定与进度**（`elapsed` 钳在需求上）等待后续 tick —— 不静默丢弃已投入的装载时间。
   *  落地范围：**只动星区货物/队列 + 单位货舱**（`ship.cargos`/`hull.cargo`）与**模块的结构标记**，
   *  不改任何战斗数值（护盾/血量/能量/系数一律不碰）⇒ 与既有步骤无交叉、顺序无歧义。 */
  function settleCargoLoads(ops, units) {
    if (ops.length) {
      for (const op of ops) {
        const inst = op.inst;
        const ship = op.ship;
        const cargo = op.cargo;
        if (!inst || !cargo) continue;
        if (inst._load) continue;                 // 已在装（防御：Pass1 门控已挡住）
        if (cargo._loadBy) continue;              // 已被别的装载器锁定（防御：认领集合已挡住）
        if (!ship || !ship.alive) continue;       // 拥有者本 tick 已死 ⇒ 不启动（能量不退）
        if (!inst.enabled) continue;              // 模块本 tick 已停用 ⇒ 不启动
        inst._load = {
          cargo,
          elapsed: 0,                             // 已推进 tick 数（启动 tick 不推进，见下）
          need: Math.max(1, op.need | 0),         // 需求时长（Pass1 已按快照冻结）
          startedTick: runTicks,                  // 启动 tick 号（用于“启动那一 tick 不推进”）
        };
        cargo._loadBy = { ship, inst };           // 锁定（任何单位/模块不得再锁定它）
      }
    }
    const all = units || [...allies, ...enemies];
    for (const ship of all) {
      for (const inst of ship.modules || []) {
        const ld = inst._load;
        if (!ld || !ld.cargo) continue;
        // 拥有者阵亡 / 模块停用 ⇒ 立即解锁 + 进度归零（下次从头开始；能量不退）
        if (!ship.alive || !inst.enabled) {
          releaseCargoLoad(inst);
          continue;
        }
        if (ld.startedTick === runTicks) continue; // ★ 启动那一 tick 不推进 ⇒ 装载恰好耗时 need tick
        ld.elapsed = Math.min(ld.elapsed + 1, ld.need);
        if (ld.elapsed < ld.need) continue;
        // 完成前复核剩余容量（容量可能因模块启停而中途变小）：容不下 ⇒ 保持锁定与进度，下 tick 再判
        if (cargoLoadOf(ship) + Math.max(0, ld.cargo.tons || 0) > cargoCapacityOf(ship)) continue;
        landCargoOn(ship, inst);
      }
    }
  }

  /** 每 tick 主入口：Pass 1 行动遍历（单遍单位 for）→ Pass 2 结算（单遍单位 for + 命中子步 + 收尾单遍）。 */
  function step() {
    if (phase !== 'running') return;
    runTicks += 1;
    // ★ B-1：原先在此写入的两个**模块级**“当前阵营引用”已删除 —— 同盟/防爆共享吸收现在直接由
    //   `applyHit(target, …, allies, enemies)` 传入本实例自己的编队 ⇒ **多实例零串台**。
    reflectQueue = []; // 每 tick 清空反射返程记账，避免跨 tick 残留/重复
    // ★ 星区「本 tick 已被接受的模块」集合：每 tick 起始清空（Pass1 记账用，非数值状态）——
    //   同一 tick 多个单位携带同一星区模块时，按固定结算顺序（allies → enemies）**只接受第一个**。
    sectorClaimedTick.clear();
    // ★ 货物链的**每 tick 全局预留集合**同样在每 tick 起始清空（Pass1 记账用，非数值状态）——
    //   「货物传输/货物维修/货物强化」三处共用：先到先得，收集顺序＝固定结算顺序（allies → enemies）。
    cargoClaimedTick.clear();
    // ★ 星区「本 tick 已被装载器认领的货物」集合：每 tick 起始清空（同 `sectorClaimedTick` 体例）——
    //   认领在 Pass1 末尾由 `resolveLoadClaims()` 按**装载速度从高到低**（同速按固定遍历序）裁决并写入。
    loadClaimedTick.clear();
    loadClaims.length = 0; // 本 tick 的装载认领申请（Stage A 登记 → 裁决后无用；每 tick 起始清空）

    // 固定行动快照（tick 起始存活全体）＋一次性建好本 tick 挂账。
    // ★ 必须在任何记账(Pass1 激活把伤害/回盾写进目标 __pending)之前为全体建好，
    //   否则后处理单位 reset __pending 会冲掉排前面单位记到它身上的伤害（曾致“仅敌方能打伤害”）。
    // 召唤新增由 pendOf 惰性创建、下 tick 才开始行动。
    const pass1Units = [];
    for (const s of [...allies, ...enemies]) {
      if (!s.alive) continue;
      s.__pending = freshPending();
      pass1Units.push(s);
    }

    // ===== Pass 1 —— 行动遍历（单遍单位 for）=====
    // 对每个单位：闪标递减 + 清理自身死目标引用 + 能量回充 +
    // 模块结构推进(时长/冷却) + 模块激活记账 + 临时单位生命周期，一次完成。
    for (const ship of pass1Units) pass1Unit(ship);

    // ★ **装载器认领裁决**（Pass1 阶段收尾，仍在 Phase A 之前）：把本 tick 收集到的装载认领申请
    //   按**装载速度从高到低**（同速按固定遍历序）统一裁决 —— 同一件货物**只有一个赢家**（跨阵营全局排序），
    //   赢家才按既有口径记账（耗能/冷却/装载意图/激活统计），败者不激活（不耗能、不进冷却）。
    //   ★ 仍在 Pass1：只写记账与 pending 意图，**零数值变化**（所有数值仍在结算阶段落地）。
    resolveLoadClaims();

    // ===== Pass 2 —— 结算 =====
    // Phase A（单遍单位 for 收集，作用于本 tick 全体[含 Pass1 新召/已死者]）：把各单位 __pending 上的
    //   各类意图并入若干**记录数组**（不新增全量单位循环）：
    //   ①伤害命中(拆主目标/爆炸波及) ②上限修改意图 ③到期撤销意图 ④能量意图 ⑤非伤害数值意图 ⑥临时寿命意图。
    // 记账挂在“受影响/施放方”上：攻击方/施放方本 tick 已死其意图仍照常落地（收集不受其 alive 门控）。
    const allNow = [...allies, ...enemies];
    const primaries = [];
    const splashes = [];
    const capOps = [];
    const expiries = [];
    const poolFills = [];
    const energyRecs = [];
    const nonDamageRecs = [];
    const tempRecs = [];
    const coeffOps = [];
    const forceOps = [];
    const timeOps = [];
    const stealthOps = [];
    const oreClaims = []; // 本 tick 的矿物采集请求（按固定结算顺序收集 → 步骤 3b 统一按比例分配）
    const sectorOps = []; // 本 tick 的星区储量变更意图（按固定结算顺序收集 → 步骤 3c 先加后乘统一落地）
    const oreSpends = []; // 本 tick 的矿物成本消耗（`ore_cost`，带上所属单位引用 → 步骤 3d-1 统一扣除）
    const oreTransfers = []; // 本 tick 的矿物输送意图（`ore_target`，记录内已含 from/to → 步骤 3d-2 统一落地）
    const cargoLoadOps = [];  // 本 tick 的装载启动意图（`cargo_loader`，记录内已含 inst/ship/cargo → 步骤 5 统一落地）
    const cargoTransfers = []; // 本 tick 的货物传输意图（`cargo_transfer`，记录内已含 from/to/cargo → 步骤 3d-3 统一落地）
    const cargoRepairs = [];   // 本 tick 的货物维修意图（`cargo_repair`，记录内已含 ship/cargo/amount → 步骤 3d-4 + 4c 统一落地）
    const cargoEnhances = [];  // 本 tick 的货物强化意图（`cargo_enhance`，记录内已含 target/cargo/amount → 步骤 3d-5 统一写入）
    for (const u of allNow) {
      const P = u.__pending;
      if (!P) continue; // 本 tick 未参与(无挂账)者跳过
      for (const app of P.dmg) {
        const a = Object.assign({ target: u }, app);
        (app.splash ? splashes : primaries).push(a);
      }
      if (P.capOps.length) capOps.push(...P.capOps);
      if (P.expiries.length) expiries.push(...P.expiries);
      if (P.poolFills.length) poolFills.push(...P.poolFills);
      if (P.energyRegen || P.energySpends.length || P.energyDeltas.length) energyRecs.push({ u, P });
      if (P.shieldHeals.length || P.hpDeltas.length || P.selfDestruct) nonDamageRecs.push({ u, P });
      if (P.tempTick) tempRecs.push(u);
      if (P.coeffOps.length) coeffOps.push(...P.coeffOps);
      if (P.forceOps.length) forceOps.push(...P.forceOps);
      if (P.timeOps.length) timeOps.push(...P.timeOps);
      if (P.stealthOps.length) stealthOps.push(...P.stealthOps);
      if (P.oreGains.length) {
        // 采集请求带上所属单位引用（分配/入库要落到具体单位）；收集顺序＝固定结算顺序（allies → enemies）
        for (const g of P.oreGains) oreClaims.push({ ship: u, inst: g.inst, want: g.amount });
      }
      if (P.sectorOps.length) sectorOps.push(...P.sectorOps); // 星区词条意图（记录内已含 ship；顺序＝固定结算顺序）
      // 矿物成本：记录带上所属单位引用（扣减要落到具体单位）；收集顺序＝固定结算顺序（allies → enemies）
      if (P.oreSpends.length) {
        for (const s of P.oreSpends) oreSpends.push({ ship: u, inst: s.inst, amount: s.amount });
      }
      if (P.oreTransfers.length) oreTransfers.push(...P.oreTransfers); // 记录内已含 from/to；顺序＝固定结算顺序
      if (P.cargoLoadOps.length) cargoLoadOps.push(...P.cargoLoadOps); // 装载意图（含 cargo 实体）；顺序＝固定结算顺序
      // 货物传输/维修/强化意图（记录内已含 from/to 或 ship/target/cargo）；顺序＝固定结算顺序（allies → enemies）
      if (P.cargoTransfers.length) cargoTransfers.push(...P.cargoTransfers);
      if (P.cargoRepairs.length) cargoRepairs.push(...P.cargoRepairs);
      if (P.cargoEnhances.length) cargoEnhances.push(...P.cargoEnhances);
    }

    // ── 结算步骤 1：计时推进（全单位模块时长/冷却递减、窗口累计）──
    //   本引擎把“时长/冷却递减 + 窗口累计”保留在 Pass1 就地完成：它们是**模块私有计时器**，
    //   不对任何单位数值产生可见影响、也不波及其它单位；其中唯一有跨单位影响的部分
    //   ——**到期撤销/恢复**（dropSourceMods + recalcDerived，会改上限）——已改为纯意图
    //   （见 pass1Unit → expiries），故在此直接进入步骤 2 统一次序落地。

    // ── 结算步骤 2：上限与系数统一落地（到期撤销 + 上限修改 + 系数修改），**必须先于伤害结算** ──
    //   到期撤销：模块时长结束 → 撤销其施加的上限影响 + 系数修饰 + 强制目标标签 + 自身时长加成回落（含删池）。
    //   注：系数/强制目标的撤销**先于** `cancelled` 判定执行（本 tick 到期后又重新激活＝先撤后建，
    //   避免旧作用集合的标签残留；重建由本 tick 的 coeffOps/forceOps 完成）。
    for (const e of expiries) {
      clearAllSourceMods(e.ship, e.inst.id); // 自身词条：撤销该来源在施放方自身的修饰（系数 + 受伤减免）
      releaseCoeffRefs(e.inst); // 目标级词条（*_target）：撤销其施加在各被作用单位上的修饰
      releaseTime(e.inst, !!e.cancelled); // 时间系数：撤销其施加在各被作用单位上的系数（计时需求量回落；同 tick 重激活则静默）
      e.inst._coeffAdd = 0;
      e.inst._coeffMul = 1;
      e.inst._takeMul = 1;
      releaseForced(e.inst, !!e.cancelled); // 强制来源出栈（本 tick 又重新激活则不单记“解除/回落”，避免刷屏）
      releaseStealth(e.inst, !!e.cancelled); // 潜行标记撤销（同 tick 重激活则静默：不记“结束”、保留 _stealthActive）
      if (e.cancelled) continue; // 本 tick 到期后又重新激活：该次撤销被覆盖（重新激活已重建并填满池）
      dropSourceMods(e.inst);
      if (e.ship && e.ship.alive) recalcDerived(e.ship);
    }
    //   上限修改：逐记录 dropSourceMods(inst) → 逐存活目标 setOverlay（非累加，记录间顺序无关）
    for (const rec of capOps) applyCapOps(rec);
    //   时间系数落地（`time_coeff`）：与上限同批（“作用集合”类），**先于**伤害结算
    //   → 本 tick 的计时已在 Pass1 按快照需求量算完，故系数从**下一 tick** 起体现（撤销同理）。
    for (const rec of timeOps) applyTimeOp(rec);
    //   系数/受伤减免修改（条件型自身增益 / 时长型修饰 / 目标级修饰）：与上限修改同属“上限/系数类”，
    //   同批落地、跨单位顺序一致；只在状态变化时写入/撤销（幂等）。此后本 tick 的伤害结算不使用它们
    //   （见 Phase B 说明），故生效时序 = **下一 tick 的激活/受伤**才体现
    //   （Pass1 单位开头快照 `_takeMulTick` 与 Pass1 读到的系数都是结算后的最新值）。
    //   ★ 目标级记录（`!rec.self`）的**被作用单位集合**在落地后写入 `inst._coeffRefs`（撤销依据）。
    const coeffRefsByInst = new Map(); // inst -> { units: [被作用单位…], shield: bool }
    for (const rec of coeffOps) {
      applyCoeffOp(rec);
      if (rec.self || !rec.ship) continue;
      let b = coeffRefsByInst.get(rec.inst);
      if (!b) {
        b = { units: [], shield: false };
        coeffRefsByInst.set(rec.inst, b);
      }
      if (!b.units.includes(rec.ship)) b.units.push(rec.ship);
      if (rec.category === 'shield') b.shield = true;
    }
    for (const [inst, b] of coeffRefsByInst) {
      inst._coeffRefs = b.units;
      inst._coeffShield = b.shield; // 护盾类别 → 撤销时顺带 recalcDerived
    }

    //   潜行标记落地（`type` 标签 `stealth`）：与上限/系数/时间系数**同批**（“作用集合类”），
    //   **先于**伤害结算 —— 结构性、**零数值变化** → 本 tick 的目标解析已在 Pass1 完成，
    //   故从**下一 tick 的目标解析**起体现（撤销同理）。
    for (const rec of stealthOps) applyStealthOp(rec);

    // ── 结算步骤 2b：强制目标统一落地（控制类，跨单位顺序一致）──
    //   放在系数之后、能量/伤害之前：只改各单位的目标指向（结构性），不影响本 tick 已收集的数值；
    //   其效果从**下一 tick 的目标解析**（Pass1 moduleTargetList）开始体现。
    for (const rec of forceOps) applyForceOp(rec);

    // ── 结算步骤 3：能量统一落地（回充 → 模块消耗 → 能量量值词条），规则对所有单位一致 ──
    for (const { u, P } of energyRecs) {
      if (!u.alive) continue;
      if (P.energyRegen) u.hull.energy = Math.min(u.hull.energyCap, u.hull.energy + P.energyRegen);
      for (const s of P.energySpends) u.hull.energy = Math.max(0, u.hull.energy - s.amount);
      // energy_target 量值词条：**不做受伤减免**（能量削减不是血/盾伤害），与 applyHit 的减免口径分开
      for (const e of P.energyDeltas) applyEnergyTo(u, e.amount);
    }

    // ── 结算步骤 3b：星区矿物采集统一落地（**唯一分配/入库点**）──
    //   放在“能量之后、护盾/血量之前”：本 tick 的判死都发生在其后（步骤 4c/4e、Phase B），
    //   故此刻所有请求方都还存活（请求已在 Pass1 按存活单位记入）；本 tick 采集后又同 tick 阵亡者
    //   「先入库、再由唯一判死出口 onDeath 全额返还」→ 净效果＝星区储量不变（矿物不会因同 tick 阵亡丢失）。
    settleOreGains(oreClaims);

    // ── 结算步骤 3c：星区储量词条（创世纪/矿藏富集）统一落地（**唯一落地/星区冷却点**）──
    //   顺序固定：3b 采矿入库/扣减 → 3c 星区词条（**先加法、后乘法**）→ 步骤 4 护盾/血量；
    //   放在判死之前 ⇒ 本步骤的落地与“谁先谁后死”无关（镜像对等、与遍历顺序无关）。
    settleSectorOps(sectorOps);

    // ── 结算步骤 3d：**矿物支出统一落地**（3d-1 矿物成本消耗 → 3d-2 矿物输送 1:1 成对搬运）──
    //   位置：3b 采矿入库 / 3c 星区词条**之后**、步骤 4（含全部判死）**之前**，故：
    //     · 与 3b/3c **互不影响、互不干扰**（3b 只动“本舰矿物仓入库 + 星区储量扣减”、3c 只动“星区储量”，
    //       3d 只在**两舰之间搬运矿物 / 扣掉模块成本**，三者的写入对象互不重叠 ⇒ 顺序不影响结果）；
    //     · 3b 在本步骤之前 ⇒ **本 tick 新采的矿物已入库**，可被后续输送/成本使用，且**不会让扣减透支**
    //       （Pass1 预算 `ctx.oreAvail` ≤ tick 起始携带量，3b 只增不减）；
    //     · 全部判死都在其后 ⇒ 施放方与目标此刻都还存活（Pass1 也已按存活单位记账）。
    //   顺序固定：**先成本（3d-1）、后输送（3d-2）** —— 与结算步骤 3「回充 → 消耗 → 量值」的
    //   “先成本、后效果”体例完全一致；两条链均由固定结算顺序收集 ⇒ 确定性、镜像对等。
    settleOreSpends(oreSpends);
    settleOreTransfers(oreTransfers);

    // ── 结算步骤 3d-3 / 3d-4：**货物搬运与消耗统一落地**（运输类两模块；仍在 3d 段内、步骤 4 之前）──
    //   顺序固定：**先 3d-3 货物传输（搬运整件）→ 后 3d-4 货物维修消耗（销毁整件）**。
    //   三条货物链的记录各自预留了**互不相同的货物实体**（Pass1 全局预留集合 `cargoClaimedTick`，
    //   先到先得）⇒ **先后不影响结果**（此处排序只为“唯一口径、可复现”）；
    //   两者都只动 `ship.cargos` + `hull.cargo`，与 3d-1/3d-2（只动矿物/星区储量）以及
    //   步骤 5（只动星区→单位的入舱）作用对象不相交。
    //   放在步骤 4c 之前 ⇒ 维修天然“**先扣货物（3d-4）、后回血（4c）**”，与「矿物维修」同口径。
    settleCargoTransfers(cargoTransfers);
    settleCargoRepairs(cargoRepairs);
    // ── 结算步骤 3d-5：**货物强化写入**（`cargo_enhance`；3d 段最末、仍在步骤 4 与步骤 5 之前）──
    //   成本（能量步骤 3 / 矿物 3d-1）恒在其前 ⇒ “先扣成本、后写入效果”；
    //   与 3d-2/3d-3/3d-4 作用对象互不相交（共用 `cargoClaimedTick` 预留）⇒ 先后不影响结果。
    settleCargoEnhances(cargoEnhances);

    // ── 结算步骤 4：护盾 / 模块池填充 / 血量 / 自毁 / 临时寿命统一落地 ──
    for (const rec of poolFills) applyPoolFill(rec);            // 4a 模块护盾池创建+填满
    for (const { u, P } of nonDamageRecs) if (u.alive) applyShieldHeals(u, P); // 4b 补/汲取盾(+破盾)
    // ★ 低频战报的**每 tick 聚合集合**（治疗型矿物成本模块，见下方 4c 成句处）：
    //   本 tick 局部（每次 `step()` 新建）⇒ 天然“每模块每 tick 至多 1 条”，无需跨 tick 清理。
    const oreRepairLogged = new Set();
    // ★ 同理：**「货物维修」（`cargo_repair`）的低频战报**每模块每 tick ≤ 1 条的聚合集合（本 tick 局部）。
    const cargoRepairLogged = new Set();
    for (const { u, P } of nonDamageRecs) {                     // 4c 血量
      if (!u.alive) continue;
      const takeMul = tickTakeMul(u); // 负值(hp_target 扣血)＝受到的伤害 → 乘受伤减免；正值加血不减免
      for (const h of P.hpDeltas) {
        const before = u.hull.hp;
        applyHpTo(u, h.amount < 0 ? h.amount * takeMul : h.amount);
        // ★ 按阵亡数回血（`hp_regen_per_death`，如「回收利用」）：**若实际回血 > 0** 才记 1 条低频战报
        //   （区别于目标级 `hp_target`：那类走既有命中/量值战报措辞；本词条按“模块拥有者 + 实际回血”
        //    成句，每 tick 每模块至多 1 条，且必须有阵亡才会出现 → 天然低频）。
        if (h.regen && u.hull.hp > before) {
          battleLog(
            'battle.log.recycleRegen',
            { owner: uTok(u), module: modTok(h.inst), n: lastTickDeaths, amount: Math.round(u.hull.hp - before) },
            ['owner']
          );
        }
        // ★ **治疗型「矿物成本」模块**（`ore_cost` + 治疗 `hp_target`，如「矿物维修」`oreRepair`）的
        //   低频战报 —— 成句就在**回血落地处**（与数值同批，`amount` 就是真正写进血量的差值）：
        //   · 触发判据全部取自“本 tick 实际发生的事实”，**不按模块 id / 词条名硬编码**：
        //       ① `u.hull.hp > before`：本次是**实际回血 > 0**（`applyHpTo` 前后差值 ⇒ **天然包含 hpMax 截断**，
        //          “实际回血量”口径唯一；负值/零值一律不成句）；
        //       ② `h.inst._orePaidTick === runTicks`：该模块实例**本 tick 确实支付了矿物**
        //          （由结算步骤 3d-1 写入的标记，3d 恒在本步骤之前 ⇒ 同 tick 必已就绪）；
        //       ③ 二者同时成立 ⇒ 即“以矿物换回血”这一次激活。
        //   · `n` ＝ **实际扣矿量**（3d-1 写入的 `_orePaidAmt`，非词条值/请求值）；实际扣矿为 0 不会成句
        //     （判据 ② 已要求 > 0），故不存在“照实显示 0”的歧义 —— 无矿物支出就没有这条战报。
        //   · **每模块每 tick ≤ 1 条**：`oreRepairLogged` 为本 tick 局部集合，同一实例只成句一次
        //     （当前模块为 `single` 单目标 ⇒ 恒只有 1 条；该集合同时兜住将来多目标版本的刷屏）。
        if (
          u.hull.hp > before &&
          h.inst &&
          h.inst._orePaidTick === runTicks &&
          (h.inst._orePaidAmt || 0) > 0 &&
          !oreRepairLogged.has(h.inst.id)
        ) {
          oreRepairLogged.add(h.inst.id);
          battleLog(
            'battle.log.oreRepair',
            {
              owner: ownerTok(h.inst),
              module: modTok(h.inst),
              n: Math.round(h.inst._orePaidAmt),
              target: uTok(u),
              amount: Math.round(u.hull.hp - before),
            },
            ['owner', 'target']
          );
        }
        // ★ **「货物维修」（`cargo_repair`）的低频战报**（与上面「矿物维修」完全同体例，只是代价从
        //   “矿物”换成“一整件货物”）——成句就在**回血落地处**（与数值同批）：
        //   · 触发判据全部取自“本 tick 实际发生的事实”、**不按模块 id / 词条名硬编码**：
        //       ① `u.hull.hp > before`：本行是**实际回血 > 0**（`applyHpTo` 前后差值 ⇒ 天然含 hpMax 截断）；
        //       ② `h.inst._cargoPaidTick === runTicks`：该实例**本 tick 确实销毁了一件货物**
        //          （由结算步骤 3d-4 写入的标记，3d 恒在本步骤之前 ⇒ 同 tick 必已就绪）；
        //       ③ 二者同时成立 ⇒ 即“以货物换回血”这一次激活（成对：有消耗才有战报，无消耗不成句）。
        //   · `cargo`＝**实际被消耗的那件货物名**（3d-4 销毁该实体时一并写入的 `_cargoPaidName`，
        //     口径与 UI 芯片一致；不在 4c 反查 —— 该实体此时已不在任何清单内）；
        //   · **每模块每 tick ≤ 1 条**：`cargoRepairLogged` 为本 tick 局部集合，同一实例只成句一次。
        if (
          u.hull.hp > before &&
          h.inst &&
          h.inst._cargoPaidTick === runTicks &&
          h.inst._cargoPaid &&
          !cargoRepairLogged.has(h.inst.id)
        ) {
          cargoRepairLogged.add(h.inst.id);
          battleLog(
            'battle.log.cargoRepair',
            {
              owner: ownerTok(h.inst),
              module: modTok(h.inst),
              cargo: h.inst._cargoPaidName || '',
              target: uTok(u),
              amount: Math.round(u.hull.hp - before),
            },
            ['owner', 'target']
          );
        }
      }
    }
    for (const { u, P } of nonDamageRecs) applySelfDestruct(u, P); // 4d 自毁
    for (const u of tempRecs) applyTempTick(u);                    // 4e 临时单位寿命递减/到期判死

    // Phase B（相内子步：迭代 pending 命中条目）主目标先行(确定防爆抑制) → 后爆炸波及。
    settleHits(primaries, splashes);

    // Phase B2（反射返程，统一在真·武器/爆炸命中全部结算完之后）：
    // 把本 tick 记下的反射逐笔作为 noReflect=true 的伤害补打回原攻击方（返程不再触发反射），
    // 并把“谁(反射模块)反射多少给谁”表头与该返程落地的逐吸收段组合成句。
    // 攻击方已判死者：applyHit 因 !alive 自然返回 0（seg 空 → 仅表头无段；此处成句仍记反射来源）。
    for (const r of reflectQueue) {
      const land = applyHit(r.attacker, r.amount, false, null, true);
      emitHitLog(
        'battle.log.hit.reflect',
        {
          owner: uTok(r.owner),
          module: r.mod ? modTok(r.mod) : null,
          attacker: uTok(r.attacker),
          amount: Math.round(r.amount),
        },
        land.seg,
        'reflect'
      );
      if (land.killed) battleLog('battle.log.destroyed', { ship: uTok(r.attacker) }, ['ship']); // 反射返程致死：紧跟反射句
    }

    // ── 结算步骤 5：**货物装载统一落地**（锁定 / 进度推进 / 完成入舱 / 死亡与停用的解锁）──
    //   位置＝**Phase B2 之后、Phase C 之前**（本 tick 的伤害与**全部判死**都已结算完毕）：
    //     · 完成判定读 `ship.alive` ⇒ 「拥有者本 tick 死亡 ⇒ 不完成装载」为**确定性规则**
    //       （不依赖“谁先谁后死”，镜像对等、与遍历顺序无关）；
    //     · 与步骤 3（能量）的关系：能量已在 3 扣除、本步骤**不触碰能量**（停用/阵亡**不退能量**）；
    //     · 与步骤 4/Phase B/B2 的关系：本步骤**只动星区货物/队列 + 单位货舱 + 模块结构标记**，
    //       不碰护盾/血量/系数 ⇒ 与其无交集、互不影响（顺序无歧义）；
    //     · 落地后货物已完成搬移 ⇒ Phase C 的统计写回与战报收集看到的是最终状态。
    settleCargoLoads(cargoLoadOps, allNow);

    // Phase C（单遍单位 for 收尾）：统计写回 + 清 __pending + 收集待移除临时死者。
    // 破盾已在 applyHit(伤害抽空)/applyShieldHeals(汲取抽空) 内就地触发，此处不再全量扫描。
    // finalize 在临时单位移出前执行，保证死去的召唤也能累计；清挂账防陈旧记账被下 tick 重复收集。
    const deadTemp = [];
    for (const u of allNow) {
      finalizeModules(u);
      u.__pending = undefined;
      if (!u.alive && u.temp) deadTemp.push(u);
    }
    for (const u of deadTemp) removeSummoned(u.side, u); // 临时单位阵亡/到期直接移出场景
    // ★ 死亡计数提交（tick 收尾，Phase C 之后）：本 tick 的死亡数 → `lastTickDeaths`，供**下一 tick**
    //   的 Pass1 读取（"按上一 tick 的死亡数结算"）；随后清零本 tick 计数。放在收尾处保证同一 tick 内
    //   的死亡绝不反馈给本 tick 的 Pass1（无反馈环、与遍历顺序无关、镜像对等）。
    lastTickDeaths = deathsThisTick;
    deathsThisTick = 0;
    // ★ **“一方全灭 ⇒ 结束”判定**（设计文档 §8：**保留在代码中、但星域星区模式下不执行**）：
    //   · 既有单星区玩法（非星域模式）⇒ 照旧调用（**零回归**）；
    //   · 星域星区模式 ⇒ **不调用**（星区无单位时静默空转、仍走 tick；何时结束由**星域持续时间**决定）。
    if (!starfieldMode) checkEnd();
  }

  /** 汇总某阵营符合 pred 的“共享护盾池”（模块池，非本体）{value,max}：逐池累加池值/池容量。 */
  function poolTotalFor(side, pred) {
    let value = 0;
    let max = 0;
    for (const u of sidesOf(side)) {
      if (!u.alive) continue;
      for (const p of u.hull.pools.values()) {
        if (!p.inst) continue; // 本体池不参与共享统计
        if (!pred(p)) continue;
        value += p.value;
        max += p.cap;
      }
    }
    return { value, max };
  }

  /** 汇总某阵营**货舱（货物 / 矿物）**容量与已装载量：`{ value（已用）, max（容量合计）,
   *  base（本体合计）, modules（模块部分合计） }` —— 与 `poolTotalFor` **同一体例**（只统计**存活单位**，
   *  逐单位走 `ship.js` 唯一口径 `cargoCapPartsOf`/`oreCapPartsOf`，战斗层不复制算式）。
   *  UI（指挥栏「货舱总量」）只读它；`max <= 0` 时由 UI 整行隐藏（与共享护盾条“无则隐藏”同一规则）。 */
  function cargoTotalFor(side, kind) {
    const partsOf = kind === 'ore' ? oreCapPartsOf : cargoCapPartsOf;
    const loadOf = kind === 'ore' ? oreLoadOf : cargoLoadOf;
    let value = 0;
    let max = 0;
    let base = 0;
    let modules = 0;
    for (const u of sidesOf(side)) {
      if (!u.alive) continue;
      const p = partsOf(u);
      value += loadOf(u);
      max += p.total;
      base += p.base;
      modules += p.modules;
    }
    return { value, max, base, modules };
  }

  const api = {
    get phase() { return phase; },
    get result() { return result; },
    get allies() { return allies; },
    get enemies() { return enemies; },
    get runTicks() { return runTicks; },
    /** ★ 星区（战斗场景）状态**只读快照**：
     *  `{ name（用户自定义名称，原样显示、不做 i18n）, oreReserve（当前剩余，非负整数）,
     *     oreReserveInit（初始储量，只读快照）, cd（星区侧模块冷却剩余：模块 id → ticks，只含冷却中者） }`。
     *  · 储量变化来源：采矿扣减（结算步骤 3b）＋单位阵亡返还（判死唯一出口 `onDeath`）＋
     *    星区词条（结算步骤 3c：先加法、后乘法，**无上限**）；
     *  · `cd` ＝**星区侧冷却**的唯一读口径（**凡带词条 `sector_cd_ticks` 的模块各占一键、各自独立**；
     *    0/缺省＝就绪）——与「模块自身冷却」（`inst.cooldown`，UI 从模块行读）是**两把独立冷却**，
     *    两者都就绪才生效；UI 冷却行**按同一识别口径**枚举模块（不硬编码 id）；
     *  · `cargos` ＝星区**货物实体**列表（只读）：每项＝`{ id, templateId, nameKey, name, type, colorKey,
     *    tons, loadTicks, level, bonus, enhanced, queued, queueIndex, locked, lockedBy, loadProgressTicks, loadNeedTicks }`，
     *    其中 `queued`/`queueIndex`/`locked`/`lockedBy`/`loadProgressTicks`/`loadNeedTicks` 都是**引擎派生**：
     *    · `enhanced` ＝**已被「货物强化」强化过一次**的**一次性标记**（★ 引擎写入、随实体走：返还星区后
     *      **仍在**该快照里为 true ⇒ UI 直接读、**不自算**）；`bonus` 为**倍率**，展示百分比请调
     *      `core/utils.js formatBonusPercent`（UI 已有的加成段就是这条口径，**不得自写公式**）；
     *    · `queued`/`queueIndex` ＝优先队列状态（`queueIndex` ＝ **1 起的队列序号**，未入队＝0）；
     *    ★ **数组顺序＝星区货物队列顺序（前出后入）**：定义阶段按定义顺序；入舱移除（其余前移）；
     *      返还则**追加到末尾** ⇒ UI 若需呈现队列，**直接按数组顺序排列即可**（不自算顺序、不按 id 排序）；
     *      再次强调：**数组顺序**与**优先队列 `queueIndex`** 是两个不同概念（互不改写）；
     *      列表**长度不限**（编队定义阶段不截断、运行时可无限追加“外来货物”，总件数不封顶）；
     *    · `locked`/`lockedBy` ＝**装载锁定**（被某装载器锁定中；`lockedBy`＝装载单位 id，未锁＝null）；
     *    · `manualUnloaded` ＝**玩家手动卸载是否正在生效**（**引擎派生**，判据唯一实现
     *      `cargoManualUnloadActive`）：即“本阵营的装载器**自动选取**会跳过它”；`manualUnloadedTicks`
     *      ＝**剩余有效 tick 数**（未生效＝0；秒数换算由 UI 调 `core/tick.js formatTickSeconds`，
     *      **UI 不自算到期**）；★ 原始字段（`manualUnloadedSide`/`manualUnloadedUntil`）**不进快照**
     *      （与 `_loadBy` 同处置：外部改不到引擎内部状态，也避免 UI 自己算到期）；
     *    · `enhanced` ＝**一次性强化标记**（「货物强化」置 true，随实体走、永不清除）；
     *    · `loadProgressTicks`/`loadNeedTicks` ＝**在装进度 / 需求时长（tick）**（未在装＝0/0；
     *      秒数换算由 UI 调 `core/tick.js formatTickSeconds`，**UI 不自算**）
     *    ⇒ **UI 直接读、不自算**（UI 用 `queued` 表达**选中态**、用 `queueIndex` 填**名称前的序号列**、
     *      用 `locked` 表达**装载中**（置灰 + 点击无效））；
     *  · `cargoQueue` ＝优先队列的**id 有序副本**（队首＝最高优先级；也是装载对象的优先级顺序）；
     *  · 每次读取返回**新对象**（含新的 `cd`/`cargos`/`cargoQueue` 快照）⇒ 外部改不到引擎内部状态；
     *    **UI 只读本口径、绝不自算**。 */
    get sector() {
      const cd = {};
      for (const id of sectorCdUntil.keys()) {
        const rem = sectorCdRemain(id);
        if (rem > 0) cd[id] = rem; // 只暴露“冷却中”的模块（就绪＝不出现）
      }
      // ★ 货物：把队列状态**派生**进每项（UI 只读，不自己算序号）；同时给出队列的 id 有序副本
      //   ★ 装载体系同样只读派生：`locked`/`lockedBy`（谁锁着它）＋ `loadProgressTicks`/`loadNeedTicks`
      //     （在装进度与需求时长，供 UI 展示；UI **不自算**进度/时长）——内部标记 `_loadBy` 不外泄。
      const cargosSnap = cargos.map((c) => {
        const qi = cargoQueue.indexOf(c.id) + 1; // 0＝未入队；1 起＝队列序号
        const by = c._loadBy || null;
        const ld = by && by.inst ? by.inst._load : null;
        // 内部锁定索引与手动卸载的**原始**字段不进快照（外部改不到引擎内部状态；到期由引擎算）
        const { _loadBy, manualUnloadedSide, manualUnloadedUntil, ...rest } = c;
        // ★ 手动卸载：**引擎派生**“对装载器自动选取是否生效”＋**剩余 tick**（UI 只读、不自算到期）。
        //   注意：本快照面向 UI 呈现 ⇒ 以**星区视角**判定（星区货物的排除对象＝装载单位；两侧装载器
        //   阵营不同 ⇒ 只要对**任一**阵营仍在生效即提示；判据仍是同一个 `cargoManualUnloadActive`）。
        const muActive =
          cargoManualUnloadActive(c, 'ally') || cargoManualUnloadActive(c, 'enemy');
        const muUntil = Math.max(0, manualUnloadedUntil || 0);
        return {
          ...rest,
          queued: qi > 0,
          queueIndex: qi,
          locked: !!by, // ★ 已装载器锁定（此间不可入队、不可被其它装载器选中）
          lockedBy: by && by.ship ? by.ship.id : null, // 锁定者＝装载单位 id（未锁定＝null）
          loadProgressTicks: ld ? ld.elapsed : 0,      // 已推进 tick（未在装＝0）
          loadNeedTicks: ld ? ld.need : 0,             // 需求 tick（未在装＝0）
          manualUnloaded: muActive,                    // ★ 派生：自动装载是否仍在跳过它
          manualUnloadedTicks: muActive ? Math.max(0, muUntil - runTicks) : 0, // ★ 派生：剩余生效 tick
        };
      });
      return { name: sectorName, oreReserve, oreReserveInit, cd, cargos: cargosSnap, cargoQueue: [...cargoQueue] };
    },
    /** ★ 星区货物**优先队列**的唯一切换接口（加入/取消）：
     *  · 未入队 → **追加到队尾**（排在最后）——同时**清除该件的「手动卸载」标记**（阵营 + 到期 tick
     *    双清；玩家显式要求装载 ⇒ 立即解除“对本阵营自动选取的排除”）；已入队 → **从队中移除**
     *    （其余项相对顺序不变）；
     *  · **被装载器锁定的货物拒绝切换**（`cargo._loadBy` 非空 ⇒ `ok:false, reason:'locked'`，
     *    队列状态**原样不变**）—— 引擎侧唯一判据，UI 只按返回值/只读口径呈现，不自算“能不能点”；
     *  · 返回 `{ ok, queued, queueIndex, reason? }`：`ok:false` ＝ id 不存在（`reason:'missing'`）
     *    或被锁定（`reason:'locked'`）；`queued` ＝ 切换后是否在队列中；`queueIndex` ＝ **1 起的队列序号**
     *    （未入队＝0）⇒ UI 不自算；
     *  · 只动**队列顺序**，不改动货物实体字段本身；不参与 tick 结算、不写 `__pending`（Pass1 零数值变化），
     *    故**任意时刻**（暂停/运行/结束）都可切换；装载体系只**读**它决定装载对象优先级
     *    （优先队列队首最先，见文件头「货物装载」），**不改写**队列。 */
    toggleCargoQueue(id) {
      const c = cargos.find((x) => x.id === id);
      if (!c) return { ok: false, queued: false, queueIndex: 0, reason: 'missing' };
      if (c._loadBy) {
        // 装载中：队列状态不变（原样回读，便于 UI 直接采用）
        const qi = cargoQueue.indexOf(id);
        return { ok: false, queued: qi >= 0, queueIndex: qi >= 0 ? qi + 1 : 0, reason: 'locked' };
      }
      const idx = cargoQueue.indexOf(id);
      if (idx >= 0) cargoQueue.splice(idx, 1);
      else {
        cargoQueue.push(id);
        // ★ 玩家**显式入队**＝“请装载它” ⇒ **立即清除**「手动卸载」标记（阵营 + 到期 tick 双清），
        //   解除对**本阵营**自动选取的排除（排除只针对“自动选取”，玩家意图永远优先 ⇒ 一键即可再装回）。
        c.manualUnloadedSide = null;
        c.manualUnloadedUntil = 0;
      }
      const i2 = cargoQueue.indexOf(id);
      return { ok: true, queued: i2 >= 0, queueIndex: i2 >= 0 ? i2 + 1 : 0 };
    },
    /** ★ 单位**已装载货物 → 星区**的主动返还接口（唯一入口；详情页点芯片）：
     *  · 参数：`shipId`＝载货单位 id，`cargoId`＝该单位货舱内某件货物 id（**必填**：只返还这一件）；
     *  · 成功：货物**追加到星区列表末尾**（**队列式：前出后入**；**不恢复初始顺序**、不按序号插回
     *    原位 —— 用户口径；**同一 id**、字段不变、`loadTicks` 保持，即已装载过者恒为 20t），
     *    单位 `ship.cargos`/`hull.cargo` 同步扣减（**唯一写入者**口径不变）；
     *  · ★ 同时记 **「分阵营 + 带时限」的手动卸载标记**（`manualUnloadedSide`＝卸载者阵营、
     *    `manualUnloadedUntil`＝绝对到期 tick，600t＝30s）：**本阵营**的装载器**自动选取**会跳过它，
     *    否则装载光束（**无冷却**）会在**下一 tick** 把刚卸载的货物装回去 ⇒ “点击卸载”形同无效；
     *    **敌对方装载器不受影响**、**到期自动失效**、**玩家把它加入优先队列即立即清除**该标记；
     *  · ★ **低频战报**：成功时**立即**记 1 条 `battle.log.cargoUnload`（UI 即时动作 ⇒ 直接写战报序列、
     *    不写 `__pending`；失败早退不记；同一件重复点击因已不在货舱而不重复成句 ⇒ 幂等）；
     *  · 与「阵亡全额返还」共用同一实现（`returnCargoToSector`）——**阵亡返还不记标记、不播报卸载**；
     *  · 返回 `{ ok, shipId, cargoId }`；失败返回 `{ ok:false, reason }`：
     *    `'ship'`（无此单位）、`'dead'`（该单位已阵亡 ⇒ 其货物已在 `onDeath` 全额返还）、
     *    `'cargo'`（该单位货舱内无此货物）；
     *  · 不改任何战斗数值（不碰护盾/血量/能量/系数），与 tick 结算无交互 ⇒ 任意时刻可调用。 */
    unloadCargo(shipId, cargoId) {
      const ship = [...allies, ...enemies].find((u) => u.id === shipId);
      if (!ship) return { ok: false, reason: 'ship', shipId, cargoId };
      if (!ship.alive) return { ok: false, reason: 'dead', shipId, cargoId };
      const target = (ship.cargos || []).find((c) => c.id === cargoId);
      const has = !!target;
      if (!has) return { ok: false, reason: 'cargo', shipId, cargoId };
      // ★ `manual = true`：玩家主动卸载 ⇒ 该件被**本阵营**装载器的**自动选取**排除（分阵营 + 带时限，
      //   直到玩家把它加入优先队列）
      returnCargoToSector(ship, cargoId, true);
      // ★ **低频战报「卸载回星区」**（`battle.log.cargoUnload`）—— 本动作由 **UI 在 tick 之间即时触发**
      //   （点击详情页芯片），故**立即成句、直接写入战报序列**（**不写 `__pending`**：它不是 tick 结算
      //   产物，写挂账反而会把它错排进某一 tick 的批次）。确定性与幂等由以下三点保证：
      //     ① **一次点击 1 条**（本函数被点一次调一次）；
      //     ② `{ok:false}` 的**三条早退路径都不记**（无此单位 / 单位阵亡 / 货舱无此件）⇒ 无效点击不留噪；
      //     ③ **幂等**：同一件第二次点击必然在 `has` 处被挡住（它已不在 `ship.cargos`）⇒ 不再重复成句。
      //   **限流**：不额外限流 —— 条数＝玩家的有效点击数（人为低频、且日志环形只留最近 500 条）；
      //   若将来 UI 提供“全部卸载”类批量入口，再在此处按批聚合为 1 条即可（口径不变）。
      battleLog(
        'battle.log.cargoUnload',
        { owner: uTok(ship), cargo: cargoNameForLog(target) },
        ['owner']
      );
      return { ok: true, shipId, cargoId };
    },
    get allyPolicy() { return policies.ally; },
    get enemyPolicy() { return policies.enemy; },
    setShipPolicy,
    setAllyPolicy(kind) {
      if (!TARGET_POLICIES.includes(kind)) return false;
      policies.ally = kind;
      for (const s of allies) if (!s.policy) for (const inst of s.modules) inst._stick = undefined;
      return true;
    },
    /** 全部存活单位（含双方） */
    units() { return [...allies, ...enemies]; },
    /* ★★ **星域容器专用：单位「跨实例整体搬迁」的两个最小接口**（阶段 1「星区间移动」；见文件头同名说明）——
     *  既有单星区玩法（`LS.drill()` / 战斗屏）**从不调用**它们 ⇒ 行为一字不变（零回归）。 */
    /** ★ **摘取单位**（容器搬迁第一步）：摘除本单位但**保留其全部自身状态**（离场≠阵亡） */
    takeUnit,
    /** ★ **收编单位**（容器搬迁第二步）：把**同一实例**挂回本实例阵营并重绑本实例引用 */
    adoptUnit,
    /** ★★ **增援单位**（M3d「多次派遣」：星域容器把新派遣的单位**增量注入既有战斗实例**；见同名函数注释） */
    reinforce,
    /** 某阵营同盟共享池的总盾量/上限（只统计非防爆 alliance && !blastproof 的模块池）。 */
    alliancePool(side) {
      return poolTotalFor(side, (p) => p.alliance && !p.blastproof);
    },
    alliancePoolTotal(side) { return this.alliancePool(side).value; },
    /** 某阵营防爆共享池的总盾量/上限（只统计 blastproof 的模块池）。 */
    blastPool(side) {
      return poolTotalFor(side, (p) => p.blastproof);
    },
    blastPoolTotal(side) { return this.blastPool(side).value; },
    /** ★ 某阵营**货物**容量合计 `{value,max,base,modules}`（唯一口径：逐单位走 ship.js `cargoCapPartsOf`）。 */
    cargoPool(side) {
      return cargoTotalFor(side, 'cargo');
    },
    /** ★ 某阵营**矿物**容量合计 `{value,max,base,modules}`（唯一口径：逐单位走 ship.js `oreCapPartsOf`）。 */
    orePool(side) {      return cargoTotalFor(side, 'ore');
    },
    moduleTargetList,
    moduleTargetLocked, // ★ “激活锁定中”的唯一判据（UI 用：显示 已锁定 / 下次生效）
    shipEffectiveTarget,
    fleetPreview,
    enableModule,
    disableModule,
    moduleEffective, // 状态型模块“当前是否生效”的唯一判据（UI 用；非状态型返回 null）
    moduleGateMet, // ★ 触发门控（`hp_below_activate`）“当前是否满足”的唯一判据（UI 用；非门控型返回 null）
    /** ★ **装载器模块「当前在装货物」的唯一只读判据**（UI 用：模块行显示「装载中 已推进/需求」）。
     *  · 返回 `{ cargoId, tons, elapsed, need, shipId }`（`elapsed`/`need` 单位＝**tick**，
     *    秒数换算由 UI 调 `core/tick.js formatTickSeconds`，**UI 不自算**进度/时长）；
     *  · 非装载器 / 当前未在装 ⇒ **返回 null**（判据＝引擎内部权威记录 `inst._load`，只读快照，
     *    不暴露任何内部对象引用 ⇒ 外部改不到引擎状态）。 */
    cargoLoadingOf(inst) {
      const ld = inst && inst._load;
      if (!ld || !ld.cargo) return null;
      const by = ld.cargo._loadBy;
      return {
        cargoId: ld.cargo.id,
        tons: Math.max(0, ld.cargo.tons || 0),
        elapsed: Math.max(0, ld.elapsed | 0),
        need: Math.max(0, ld.need | 0),
        shipId: by && by.ship ? by.ship.id : null,
      };
    },
    moduleUndeactivatable: isUndeactivatable, // ★「不可停用」标签的唯一判据（UI 用：开关灰显 + 悬停说明；引擎侧由 disableModule 拒绝）
    targetableBy: (ship, u, kind) => targetAllowed(ship, u, kind), // ★ 目标可选口径（唯一）：潜行 + role 分离（「可选战斗单位」＝存活且未被潜行屏蔽）
    //   （`kind` ＝ 候选来源选择器桶 'self'|'enemy'|'ally'|'any'；缺省/2 参调用按 'enemy' 对敌语义判定，
    //     与既有 2 参调用完全兼容；UI 候选池只需把桶名带过来，**不自算任何过滤规则**）
    /** ★ **B-1/B-2：手动推进 1 tick**（不依赖全局 ticker）—— 星域容器按固定顺序逐区驱动用。
     *  · 语义＝全局 tick 回调的**同一份** `step()` 实现（结算全序一字不变）；
     *  · `phase !== 'running'` ⇒ **直接返回**（与 `step()` 的门控同口径，不产生任何副作用）；
     *  · 不订阅/不解除任何 tick 订阅（`start()`/`stop()` 的既有行为**一字不变**）。 */
    step: () => step(),
    /** ★ **本实例的战报序列**（B-1；只读快照：每次返回**新数组**，行对象已 `Object.freeze`）
     *  行 ＝ `{ tick（产生时的 runTicks）, msg, rich }`；**UI 只读本口径、不自算**。
     *  · 非星域模式：与 `core/log.js` 全局通道**同步**（全局那份供既有战斗屏战报面板）；
     *  · 星域星区模式：**只进本实例**（不写全局）⇒ 多星区各自独立、C-2 侧栏按区读取。 */
    get log() { return logEntries.slice(); },
    /** ★ **累计战报条数**（单调递增；不受 `battle.log` 环形上限影响）—— 供容器/UI 判定
     *  “本 tick 该星区有没有新战报”（星域地图的“有事件”标记）。 */
    get logTotal() { return logTotal; },
    /** ★ 本实例是否处于「星域星区模式」（B-2 容器创建时为 true；既有单星区玩法恒 false） */
    get starfieldMode() { return starfieldMode; },
    start,
    stop,
  };
  /* ★ 统一包一层（B-1）：可能产生战报的 6 个公开入口，在调用期间把**战报出口**指向本实例缓冲
   *   （退出时恢复原值 ⇒ 可重入安全、多实例零串台）；六者的**语义/返回值一字不变**。
   *   （`takeUnit`/`adoptUnit` 在清理/重算时可能播报（如时间系数撤销）—— 一并纳入同一出口口径。） */
  for (const k of ['start', 'stop', 'step', 'unloadCargo', 'takeUnit', 'adoptUnit']) {
    const orig = api[k];
    api[k] = (...args) => withSink(() => orig.apply(api, args));
  }
  return api;
}

/* ================= ★ 唯一的「进入战斗」接口（数据/引擎侧） =================
 * 契约：**所有开战路径都必须经此入口**（演练编队界面、结算面板「再战」、将来的关卡/剧情入口…），
 * 不允许在别处直接 `createBattle` / 自行拼 preset（否则会出现“第二条开战路径”）。
 * 分层：
 *   · `normalizeFormation(formation)` —— **纯函数**：校验并规范化双方编队（不改动入参、不建单位）。
 *     UI 的“编队预检/不允许确认”也调用它 → **UI 与引擎同一校验口径**，不会出现两套判定。
 *   · `startBattle(formation)` —— 规范化 + 建单位（复用 `createBattle` → `spawnList` → `createShip`，
 *     等级经 `cfg.level`、定位经 `cfg.role` 传入），返回句柄供调用方查询/接管 UI。
 * 编队条目结构（`ShipCfg`）：
 *   { type:'combat', level:1, role?:'combat'|'logistics', modules:[{ moduleId:'cannon', level:1 }] }
 *   · `type`   船型 id（`data/ships/index.js SHIPS` 的键；未知 → 丢弃并记 warning）
 *   · `level`  船型等级，**钳制**到 [1, shipMaxLevel(type)]
 *   · `role`   单位定位；缺省时用船型默认（`data/ships/<id>.js role`，再兜底 'combat'）
 *   · `modules` 数组；字符串元素等价于 {moduleId, level:1}；未知模块丢弃；
 *              模块等级钳制到 [1, moduleMaxLevel]；**超出该等级槽位数的部分截断**（槽位口径＝
 *              `resolveShipAtLevel(type, level).slots`，与建单位后的 `ship.slots` 完全一致）
 * 星区（战斗场景）数据（`SectorCfg`，与编队**同级**传入，随编队一起规范化）：
 *   { sector: { name:string（用户自定义名称·原样显示、不做 i18n）, oreReserve:number（矿物储量·非负整数）,
 *               cargos?: [CargoSpec]（星区**货物设定项**，本轮新增；缺省＝空数组） } }
 *   · 缺省（未传/字段缺失）→ `data/sector.js SECTOR_DEFAULTS`（缺省名称＝空串、缺省储量＝占位值、
 *     缺省货物＝空数组）；字段名/类型定义/钳制上限登记在 `data/cargo.js`（**一类货物一个文件**，
 *     定义在 `data/cargos/*.js`、注册表与等级解析在 `data/cargos/index.js`），引擎不硬编码；
 *   · 钳制口径唯一＝`normalizeSector()`：名称去空白/截断、储量**非负整数**（负数→0、小数→向下取整、非数值→0）、
 *     货物逐项走 `normalizeSectorCargos()`；
 *   · 战斗实例上的**只读读取口径**＝`battle.sector`（`{name, oreReserve（剩余）, oreReserveInit（初始）,
 *     cd（星区侧模块冷却剩余：模块 id → ticks，只含冷却中者）,
 *     cargos（货物实体：含派生字段 queued/queueIndex）, cargoQueue（队列 id 有序副本）}`）；
 *     **UI 只读、不自算**；队列切换的**唯一接口**＝`battle.toggleCargoQueue(id)`。
 * 货物设定项（`CargoSpec`，编队界面提交的**原始设定**；逐个字段可省，省则取该类型定义的值）：
 *   { templateId?:string（货物类型 id＝`data/cargos/CARGOS` 的键；未知 → 丢弃并记 warning）,
 *     count?:number（**数量**：该项展开成的**独立实例**个数，1..CARGO_LIMITS.maxCountPerEntry）,
 *     name?:string（自定义名称·原样显示、不做 i18n；空串＝显示类型名）,
 *     tons?:number（吨位·非负整数，默认 5t）, level?:number（等级·≥1 整数，钳到该类型 `maxLevel`） }
 *   ★ **类型 id / 装载时间 / 加成系数不可由入参覆写**（一律随所选类型与等级解析而来）。
 * 货物**实例**（规范化后的只读形态）：{ id（`cargo-<顺序号>`，确定性、可复现）, templateId, nameKey, name,
 *   type（类型 id）, colorKey（类型色＝CSS 变量名）, tons, loadTicks, level, bonus }
 *   ＋ 只读快照上派生的 { queued:boolean, queueIndex:number（1 起，未入队＝0） }。
 * 返回值（`normalizeFormation`）：{ allies:[ShipCfg], enemies:[ShipCfg], sector:SectorCfg, warnings:[Warning] }
 *   Warning = { side:'ally'|'enemy'|'sector', index:number, code:string, ...细节 }
 *   code ∈ unknownType | levelClamped | unknownModule | moduleLevelClamped | slotOverflow
 *          | cargoInvalid | cargoUnknownTemplate | cargoCountClamped | cargoClamped
 *          （后四者 `side` 恒为 `'sector'`、`index` ＝ 该设定项在 `sector.cargos` 中的下标；
 *           ★ 原 `cargoOverflow`（总数超上限）已随**总件数上限的取消**一并移除 —— 货物条目数不限）
 * 返回值（`startBattle`）：{ ok:boolean, error:null|'noUnits', battle:Battle|null,
 *                           formation:{allies,enemies,sector}, warnings:[Warning] }
 *   · `ok:false`（error='noUnits'：任一方为空）→ **不创建战斗**（避免“空编队瞬间结算”）
 *   · `ok:true` → `battle` 即既有句柄（phase/result/allies/enemies/units()/start()/stop()…），
 *     但**尚未 start**：由调用方决定何时 `battle.start()`（战斗屏开战即暂停的既有交互由 UI 负责）。
 * 调用示例：
 *   const r = startBattle({ allies:[{type:'combat',level:5,modules:[{moduleId:'cannon',level:3}]}],
 *                           enemies:[{type:'combat',role:'logistics'}] });
 *   if (r.ok) { r.battle.start(); renderStage(r.battle); } */

/** ★ 星区（战斗场景）数据的**唯一规范化（钳制）口径**（纯函数，不改入参）：
 *  `{ name, oreReserve, cargos }` ——
 *   · `name`      用户自定义名称：取字符串、**去首尾空白**、超长截断（40 字符）；缺省/`null` → `SECTOR_DEFAULTS.name`
 *                 （空串＝无名称 ⇒ 战斗屏/结算不显示名称前缀）。**不做 i18n**：显示时原样输出。
 *   · `oreReserve` 矿物储量：**非负整数**（负数 → 0；小数 → 向下取整；非数值 → 0）；
 *                 缺省/`null`/空串 → `SECTOR_DEFAULTS.oreReserve`（占位缺省值，登记在 `data/sector.js`）。
 *   · `cargos`    星区**货物实体**：逐项走 `normalizeSectorCargos`（校验/覆写/钳制/顺序编号）；
 *                 缺省 → `SECTOR_DEFAULTS.cargos`（空数组 ⇒ 星区货物栏整区块隐藏）。
 *  `warnings` 可选：若传入数组，货物侧的非法/钳制项会**追加**进去（体例同 `normalizeFormation` 的 warnings，
 *   条目的 `side` 一律 `'sector'`、`index` ＝ 该设定项在 `cargos` 数组中的下标）。
 *  数值一律来自 `data/sector.js` / `data/cargo.js`，引擎不硬编码。 */
export function normalizeSector(raw, warnings) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const nameRaw = s.name == null ? SECTOR_DEFAULTS.name : String(s.name);
  const name = nameRaw.trim().slice(0, 40);
  const oreRaw = s.oreReserve;
  let oreReserve;
  if (oreRaw == null || oreRaw === '') {
    oreReserve = SECTOR_DEFAULTS.oreReserve;
  } else {
    const n = Number(oreRaw);
    oreReserve = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }
  const cargos = normalizeSectorCargos(s.cargos == null ? SECTOR_DEFAULTS.cargos : s.cargos, warnings);
  return { name, oreReserve, cargos };
}

/** ★ 星区**货物列表**的唯一规范化（钳制）口径（纯函数，不改入参；非法项**丢弃**并记 warning）：
 *  · 输入＝编队界面提交的**设定项**数组，每项可含
 *    `{ templateId, count, name, tons, level }`（未给字段取**该类型定义**的对应值）；
 *    ★ **类型 id / 装载时间 / 加成系数不可由入参覆写**：`type`、`loadTicks`、`bonus` 一律来自
 *    货物定义（随等级解析），避免与「类型色由类型决定」的口径冲突；
 *  · `templateId` 缺省/空串 → `CARGO_DEFAULTS.templateId`（＝`none`）；**非空但未登记 → 丢弃 +
 *    `cargoUnknownTemplate`**（与编队未知船型 `unknownType` 同体例）；
 *  · `count`（**数量**）＝该项**展开成的实例个数**（1..`CARGO_LIMITS.maxCountPerEntry`；越界钳制 + `cargoCountClamped`）
 *    —— 每个实例**独立成体**（货物**不是数值累积**）；
 *  · **实例 id ＝ `cargo-<顺序号>`**（顺序号＝**规范化后的位置**、从 1 起）⇒ **确定性、可复现**、
 *    **开战时的初始列表顺序＝定义顺序**且与 id 一一对应（UI 预检与引擎开战各自规范化同一份输入 ⇒
 *    id 完全一致；**不使用随机数/时间戳**）。★ 此后列表按**队列式**变化（入舱移除→其余前移；
 *    返还追加到末尾）⇒ **运行时 id 与列表位置不再对应**（id 只作唯一身份，位置由队列决定）；
 *    运行时新增货物另走自增计数器 `nextCargoId()`（**绝不复用**已用过的编号）；
 *  · `level` 钳到 `[1, cargoMaxLevel(定义)]`（等级上限由**货物定义自身的 `maxLevel`** 决定，
 *    与模块/船型同一等级模型），并调用**等级解析唯一口径** `data/cargos/index.js resolveCargoAtLevel`
 *    **在实例创建时解析一次**（此后实例字段固定，不再随等级表变化）；
 *  · 逐字段：`name` **去首尾空白并截断 40 字符**（空串 ⇒ 显示回退类型名的 i18n 词条 `nameKey`）；
 *    `tons` **非负整数**（可覆写；非法/越界 → 回退该等级解析值 / 钳到边界，记 `cargoClamped`）；
 *  · 实例总数**不设上限**（用户口径）：编队定义阶段与运行时**都不封顶** —— 本函数**不按总数截断**，
 *    也**不再产生** `cargoOverflow` 告警（该告警码与 i18n 文案已一并移除）；运行时的星区列表同样
 *    **长度不限**（装载返还的“外来货物”按队列式追加到列表末尾，见 `appendCargoToSector`）。
 *  ★ 货物是**星区侧状态**：本函数是纯数据规范化，与战斗数值链无关（**Pass1 零数值变化**）。 */
export function normalizeSectorCargos(list, warnings) {
  const out = [];
  const warn = (w) => { if (Array.isArray(warnings)) warnings.push(w); };
  if (!Array.isArray(list)) return out;
  /** 单字段数值钳制：非法 → 回退定义值；越界 → 钳到边界；**发生任何变化都记 `cargoClamped`** */
  const num = (index, key, want, min, max, def) => {
    const n = Number(want);
    let got;
    if (!Number.isFinite(n)) got = def;
    else got = Math.min(max, Math.max(min, Math.floor(n)));
    if (got !== n) {
      warn({ side: 'sector', index, code: 'cargoClamped', field: key, from: Number.isFinite(n) ? n : null, to: got });
    }
    return got;
  };
  list.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      warn({ side: 'sector', index, code: 'cargoInvalid' });
      return;
    }
    const tplId = raw.templateId == null || raw.templateId === '' ? CARGO_DEFAULTS.templateId : String(raw.templateId);
    const def = getCargo(tplId);
    if (!def) {
      warn({ side: 'sector', index, code: 'cargoUnknownTemplate', templateId: tplId });
      return;
    }
    // 等级：钳到 [1, 该定义的 maxLevel]（上限唯一来源＝定义自身；越界/非数值记 warning）
    const level = num(
      index,
      'level',
      raw.level == null || raw.level === '' ? CARGO_DEFAULTS.level : raw.level,
      1,
      cargoMaxLevel(def),
      CARGO_DEFAULTS.level
    );
    // ★ 等级解析唯一口径：**实例创建时解析一次**（与模块/船型的 levels 深合并完全同构）
    const cfg = resolveCargoAtLevel(def, level);
    // 定义缺项时的兜底（数值统一占位：5t / 300t / 系数 1）
    const baseTons = cfg.tons == null ? CARGO_DEFAULTS.tons : cfg.tons;
    const baseLoadTicks = cfg.loadTicks == null ? CARGO_DEFAULTS.loadTicks : cfg.loadTicks;
    const baseBonus = cfg.bonus == null ? CARGO_DEFAULTS.bonus : cfg.bonus;
    // 数量：展开为 N 个**独立实例**（越界钳制并记 warning）
    const wantCount = Number(raw.count == null || raw.count === '' ? 1 : raw.count);
    let count = Number.isFinite(wantCount) ? Math.floor(wantCount) : 1;
    if (count < 1) count = 1;
    if (count > CARGO_LIMITS.maxCountPerEntry) count = CARGO_LIMITS.maxCountPerEntry;
    if (count !== wantCount) {
      warn({ side: 'sector', index, code: 'cargoCountClamped', from: Number.isFinite(wantCount) ? wantCount : null, to: count });
    }
    // 可覆写字段：名称（用户字符串）与吨位
    const name = String(raw.name == null ? CARGO_DEFAULTS.name : raw.name).trim().slice(0, CARGO_LIMITS.nameLen);
    const tons = num(index, 'tons', raw.tons == null || raw.tons === '' ? baseTons : raw.tons, 0, CARGO_LIMITS.maxTons, baseTons);
    for (let k = 0; k < count; k++) {
      out.push({
        id: cargoInstanceId(out.length + 1), // ★ 顺序号 = 规范化后的位置（1 起）⇒ 确定性、可复现
        templateId: def.id,                  // 类型 id（＝定义 id）
        nameKey: cfg.nameKey,                // 类型名的 i18n 键（`name` 为空串时 UI 回退用它）
        name,
        type: cfg.type,                      // ★ 类型 id（由所选类型决定，不可覆写）
        colorKey: cfg.colorKey,              // ★ 类型色来源＝CSS 变量名（如 `--cat-attack`）
        tons,
        loadTicks: baseLoadTicks,            // 随等级解析（不可覆写；唯一换算见 `core/tick.js`）
        level: cfg.level,                    // 生效等级（解析器已钳到 [1, maxLevel]）
        bonus: baseBonus,                    // 随等级解析（不可覆写；本轮仅数据承载）
        // ★ **一次性强化标记**（「货物强化」模块 `cargo_enhance` 的结算步骤 3d-5 置 true）：
        //   开战时恒为 false；**永久**（随实体走：传输/返还星区/再装载都不清除）⇒ “每件货物只能被强化一次”。
        enhanced: false,
        // ★ **玩家手动卸载标记（分阵营 + 带时限）**：详情页点芯片主动返还星区时记录
        //   `manualUnloadedSide`＝**卸载者所属阵营**、`manualUnloadedUntil`＝**绝对到期 tick**
        //   （卸载 tick + `CARGO_MANUAL_UNLOAD_TICKS`＝600t＝30s）；阵亡全额返还**不记**（那不是玩家意图）。
        //   生效范围＝**仅该阵营**的装载器的**自动选取**（`cargoManualUnloadActive`，唯一判据）：
        //   敌对方不受影响、到期自动失效、玩家入队即清除。开战时恒为“无标记”（`null`/`0`）。
        manualUnloadedSide: null,
        manualUnloadedUntil: 0,
      });
    }
  });
  return out;
}

/** ★ 编队规范化（纯函数）：校验 + 等级钳制 + 模块合法性 + 槽位截断；UI 预检与引擎开战共用。 */
export function normalizeFormation(formation = {}) {
  const warnings = [];
  const side = (list, sideKey) => {
    const out = [];
    if (!Array.isArray(list)) return out;
    list.forEach((raw, index) => {
      const type = raw && typeof raw === 'object' ? raw.type : null;
      if (!getShip(type)) {
        warnings.push({ side: sideKey, index, code: 'unknownType', type: type == null ? null : String(type) });
        return;
      }
      const maxLv = shipMaxLevel(type);
      const wantLv = Math.max(1, (raw.level | 0) || 1);
      const level = Math.min(maxLv, wantLv);
      if (level !== wantLv) warnings.push({ side: sideKey, index, code: 'levelClamped', from: wantLv, to: level });
      // 槽位上限＝**该船型该等级**的解析结果（与建单位后的 `ship.slots` 同一口径）
      const slots = Math.max(1, (resolveShipAtLevel(type, level) || {}).slots || 1);
      const modules = [];
      for (const m of Array.isArray(raw.modules) ? raw.modules : []) {
        const spec = m && typeof m === 'object' ? m : { moduleId: m };
        const mid = spec.moduleId ?? spec.id;
        if (!mid || !MODULES[mid]) {
          warnings.push({ side: sideKey, index, code: 'unknownModule', moduleId: mid == null ? null : String(mid) });
          continue;
        }
        if (modules.length >= slots) {
          warnings.push({ side: sideKey, index, code: 'slotOverflow', moduleId: mid, slots });
          continue;
        }
        const mMax = moduleMaxLevel(MODULES[mid]);
        const wantMl = Math.max(1, (spec.level | 0) || 1);
        const mlv = Math.min(mMax, wantMl);
        if (mlv !== wantMl) {
          warnings.push({ side: sideKey, index, code: 'moduleLevelClamped', moduleId: mid, from: wantMl, to: mlv });
        }
        modules.push({ moduleId: mid, level: mlv });
      }
      const cfg = { type, level, modules };
      // 单位定位：仅接受两个合法值；缺省（undefined）→ 建单位时回退船型默认值
      const role = raw.role === 'logistics' ? 'logistics' : raw.role === 'combat' ? 'combat' : undefined;
      if (role) cfg.role = role;
      out.push(cfg);
    });
    return out;
  };
  return {
    allies: side(formation.allies ?? formation.ally, 'ally'),
    enemies: side(formation.enemies ?? formation.enemy, 'enemy'),
    // ★ 星区（战斗场景）随编队一并规范化（缺省值 + 非负整数钳制，唯一口径 normalizeSector；
    //   货物侧非法/钳制项把 warning 一并追加进本函数的 warnings，`side` 恒为 'sector'）
    sector: normalizeSector(formation.sector, warnings),
    warnings,
  };
}

/** ★ 唯一的「进入战斗」接口（数据/引擎侧）：规范化编队 → 创建双方单位 → 返回句柄。
 *  详见上方契约注释；UI 侧的唯一入口是 `ui/battleView.js enterBattle()`（内部调用本函数）。
 *  ★ **B-2 扩展（可选第 2 参，缺省行为**一字不变**）**：`opts.starfield === true` ⇒ **星域星区模式**
 *   （由 `systems/starfield.js` 容器调用）：
 *     · **允许空编队**（某一方甚至双方都为空 ⇒ 不再返回 `noUnits`；
 *       设计文档 §8「星区无战斗单位时静默空转、仍走 tick」）；
 *     · 实例内部：不订阅全局 ticker/不发全局事件、战报只进实例缓冲、**不执行全灭结束判定**
 *       （详见 `createBattle` 的 `opts` 说明）。
 *   ⚠ 既有单星区玩法（演练编队 / 结算再战）**不传 opts** ⇒ 行为与改造前完全一致。 */
export function startBattle(formation = {}, opts) {
  const norm = normalizeFormation(formation);
  const starfield = !!(opts && opts.starfield);
  if (!starfield && (!norm.allies.length || !norm.enemies.length)) {
    return { ok: false, error: 'noUnits', battle: null, formation: norm, warnings: norm.warnings };
  }
  const battle = createBattle({ ally: norm.allies, enemy: norm.enemies, sector: norm.sector }, opts);
  return { ok: true, error: null, battle, formation: norm, warnings: norm.warnings };
}

/* ================= ★ B-1 自检：battle 可实例化（实例间零共享） ================= */

/** 编队/星区造数据（自检用；数值均为占位） */
function drillFormation(allyCount, ore) {
  const unit = () => ({ type: 'combat', level: 5, modules: [{ moduleId: 'cannon', level: 3 }, { moduleId: 'hardShield', level: 3 }] });
  return {
    allies: Array.from({ length: allyCount }, unit),
    enemies: [unit(), unit(), { type: 'transport', level: 5, modules: [{ moduleId: 'cargoHold', level: 1 }] }],
    sector: {
      oreReserve: ore,
      cargos: [
        { templateId: 'weaponPart', tons: 5, level: 1 },
        { templateId: 'miningRig', tons: 8, level: 2 },
      ],
    },
  };
}

/** 实例“可比较快照”（**只取确定性数值字段**，避开 `uid()` 生成的非确定性单位 id：
 *  单位出场序号 `order` 才是引擎内的稳定标识，见 `spawnList`）。 */
function vitalsOf(b) {
  const units = b
    .units()
    .map(
      (u) =>
        `${u.side}#${u.order}:${u.typeId}:${Math.round(u.hull.hp)}/${Math.round(u.hull.shield)}/${Math.round(u.hull.energy)}@${u.alive ? 1 : 0}`
    )
    .join('|');
  const s = b.sector;
  return `${units};ore=${s.oreReserve}/${s.oreReserveInit};cargo=${s.cargos.length};ticks=${b.runTicks}`;
}

/** ★ **B-1 自检**（「battle 可实例化 / 实例之间零共享」的自动化验收）——控制台 **`LS.battle.selfCheck()`**
 *  检查项（全部纯本地、同步、无全局副作用 —— 星域星区模式不订阅 ticker、不写全局战报）：
 *   ① **两实例并行推进互不影响**：tick 计数 / 单位数 / 星区储量 / 战报序列各自独立；
 *   ② **战报隔离**：A 推进 5 tick 期间 B 的战报**不增**（B 的 `log.length` 恒为 1＝仅“战斗开始”）；
 *   ③ **同编队两实例逐 tick 数值一致**（同 tick 快照全等 ⇒ 无跨实例串台、引擎确定）；
 *   ④ **星域星区模式不执行「一方全灭 ⇒ 结束」**（全灭后 `phase` 仍为 `running`、`result` 仍为 `null`）；
 *   ⑤ **星域星区模式允许空编队**且可正常 `step()`；非星域模式空编队**仍是 `noUnits`**（既有语义不变）；
 *   ⑥ **星域星区模式不写全局战报通道**（`core/log.js` 行数在创建 + 推进前后**不变**）。
 *  @returns {{ pass:boolean, checks:{name,pass,detail}[] }} */
export function battleSelfCheck() {
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass: !!pass, detail: detail == null ? '' : String(detail) });

  // ①/② 两实例并行推进 + 战报隔离
  const A = startBattle(drillFormation(2, 1000), { starfield: true });
  const B = startBattle(drillFormation(1, 500), { starfield: true });
  const a = A.battle;
  const b = B.battle;
  a.start();
  b.start();
  const bLogAtStart = b.log.length; // 预期＝1（仅“战斗开始”行）
  const aUnits = a.units().length;
  const bUnits = b.units().length;
  for (let i = 0; i < 5; i += 1) a.step();
  const aTicksAfter = a.runTicks;
  const bTicksAfter = b.runTicks;
  const bLogAfterA = b.log.length;
  for (let i = 0; i < 3; i += 1) b.step();
  const ok1 =
    aTicksAfter === 5 &&
    bTicksAfter === 0 && // A 推进时 B 一步未动
    b.runTicks === 3 &&
    a.runTicks === 5 && // B 推进时 A 的 tick 不受影响
    a.units().length === aUnits &&
    b.units().length === bUnits &&
    a.log.length >= 1 &&
    a.log.every((l) => l.tick <= 5) &&
    b.log.every((l) => l.tick <= 3);
  add('① 两实例并行推进互不影响（tick/单位/星区/战报独立）', ok1, `A=${aTicksAfter}→${a.runTicks}t B=${bTicksAfter}→${b.runTicks}t`);
  add('② 战报隔离：A 推进期间 B 战报不增', bLogAfterA === bLogAtStart && bLogAtStart === 1, `B.log=${bLogAfterA}（起始 ${bLogAtStart}）`);

  // ③ 同编队两实例逐 tick 数值一致
  {
    const C = startBattle(drillFormation(2, 1000), { starfield: true });
    const D = startBattle(drillFormation(2, 1000), { starfield: true });
    C.battle.start();
    D.battle.start();
    for (let i = 0; i < 30; i += 1) {
      C.battle.step();
      D.battle.step();
    }
    const vc = vitalsOf(C.battle);
    const vd = vitalsOf(D.battle);
    add('③ 同编队两实例逐 tick 数值一致（30 tick）', vc === vd, vc === vd ? 'vitals 全等' : `C=${vc} D=${vd}`);
  }

  // ④ 星域星区模式：一方全灭后仍不结束（保留代码、不执行）
  {
    const E = startBattle(
      {
        allies: [{ type: 'transport', level: 1, modules: [] }],
        enemies: [
          { type: 'combat', level: 16, modules: [{ moduleId: 'heavyCannon', level: 16 }] },
          { type: 'combat', level: 16, modules: [{ moduleId: 'heavyCannon', level: 16 }] },
          { type: 'combat', level: 16, modules: [{ moduleId: 'heavyCannon', level: 16 }] },
          { type: 'combat', level: 16, modules: [{ moduleId: 'heavyCannon', level: 16 }] },
        ],
        sector: { oreReserve: 100 },
      },
      { starfield: true }
    );
    const e = E.battle;
    e.start();
    for (let i = 0; i < 240; i += 1) e.step();
    const allyAlive = e.units().filter((u) => u.side === 'ally' && u.alive).length;
    add(
      '④ 星域星区模式：一方全灭不结束（phase 仍 running）',
      e.phase === 'running' && e.result === null,
      `allyAlive=${allyAlive}, phase=${e.phase}, result=${String(e.result)}`
    );
  }

  // ⑤ 空编队：星域模式允许；非星域模式仍 noUnits
  {
    const F1 = startBattle({ allies: [], enemies: [], sector: { oreReserve: 100 } }, { starfield: true });
    let okEmpty = false;
    if (F1.ok && F1.battle) {
      F1.battle.start();
      for (let i = 0; i < 3; i += 1) F1.battle.step();
      okEmpty = F1.battle.runTicks === 3 && F1.battle.units().length === 0;
    }
    add('⑤ 星域星区模式允许空编队并可 step', okEmpty);
    const F2 = startBattle({ allies: [], enemies: [] });
    add('⑤ 非星域模式空编队仍返回 noUnits（既有语义不变）', F2.ok === false && F2.error === 'noUnits', `ok=${F2.ok}, error=${String(F2.error)}`);
  }

  // ⑥ 星域星区模式不写全局战报通道
  {
    const before = log.lines.length;
    const G = startBattle(drillFormation(2, 1000), { starfield: true });
    G.battle.start();
    for (let i = 0; i < 10; i += 1) G.battle.step();
    const after = log.lines.length;
    add('⑥ 星域星区模式不写全局战报通道', before === after, `全局日志 ${before} → ${after}（本实例 log=${G.battle.log.length}）`);
  }

  return { pass: checks.every((c) => c.pass), checks };
}

export default createBattle;
