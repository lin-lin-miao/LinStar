/* ===== i18n/zh-CN.js —— 简体中文词条（当前唯一完整语言） =====
 * 所有界面可见文本都必须来自词条表，禁止在逻辑中硬编码文案。
 */
export default {
  /* 品牌 / 通用 */
  'brand': 'LinStar',

  /* 顶栏 HUD */
  'hud.tps': '{n} tick/s',
  'hud.tpsTip': '实测每秒游戏刻',
  'hud.pause': '暂停',
  'hud.resume': '继续',
  'hud.step': '逐帧',
  'hud.stepTip': '暂停时点击推进一帧',
  'hud.speed': '速度x{n}',
  'hud.export': '导出存档',
  'hud.import': '导入存档',
  'hud.lang': '语言',

  /* 主菜单 */
  'menu.title': 'LinStar',
  'menu.subtitle': '太空背景 · 增量 · 回合制网页游戏',
  'menu.start': '开始游戏',
  'menu.hint': '存档：右上角可导出 / 导入',

  /* 存档 */
  'save.exported': '存档已导出',
  'save.imported': '存档导入成功',
  'save.importError': '存档导入失败：{err}',
  'save.exportBusy': '战斗中不可导出存档',
  'save.importBusy': '战斗中不可导入存档',
  'save.busy': '战斗中不可保存，结算完成后自动保存',
  'save.unavailable': '本地存储不可用（受限/无痕模式），仍可手动导出与导入存档。',

  /* 船舰 */
  'ship.combat': '战斗舰',
  'ship.transport': '运输舰',
  'ship.mining': '采矿船',
  'ship.drone': '无人机',
  'ship.rocket': '火箭',
  'ship.missile': '导弹',
  'ship.omegaMissile': '欧米茄导弹',
  'ship.slagMissile': '矿渣导弹',

  /* 模块 */
  'module.cannon': '火炮',
  'module.concussionCannon': '震荡炮',
  'module.heavyCannon': '大型火炮',
  'module.laser': '激光',
  'module.dualLaser': '双向激光',
  'module.denseBarrage': '密集弹幕',
  'module.laserDroneSpawn': '激光无人机',
  'module.rocketLauncher': '火箭发射器',
  'module.rocketWarhead': '火箭爆炸',
  'module.missileLauncher': '导弹发射器',
  'module.missileWarhead': '导弹爆炸',
  'module.omegaMissileLauncher': '欧米茄导弹发射器',
  'module.omegaMissileWarhead': '欧米茄导弹爆炸',
  'module.slagMissileLauncher': '矿渣导弹发生器', // 采矿 · 召唤矿渣导弹（**只耗自身携带矿物 ore_cost**、不耗能）
  'module.slagMissileWarhead': '矿渣导弹爆炸', // 内部：矿渣导弹携带的爆炸弹头（picker:false）
  'module.reactorCoil': '强辐线圈',
  'module.shieldBattery': '护盾电池',
  'module.hullArmor': '船体装甲',
  'module.recycle': '回收利用',
  'module.energyTransfer': '能量输送',
  'module.oreTransfer': '矿物输送', // 采矿 · 主动单体友方（把自身携带矿物 **1:1** 输送给目标 ore_target）
  'module.cargoHold': '货舱',
  'module.loadingBeam': '装载光束', // 运输 · 主动无目标（标签 cargo_loader + 词条 cargo_load：把星区货物装进本舰货舱）
  'module.oreHold': '矿舱',
  'module.miningLaser': '采矿激光',
  'module.oreCompressor': '矿物压缩', // 采矿 · 常驻增幅器（自身采矿系数 mining_coeff_add）
  'module.oreRepair': '矿物维修', // 采矿 · 主动单体友方（含自身；耗自身矿物 ore_cost 修复目标 hp_target，量值按词条原值）
  'module.genesis': '创世纪', // 采矿 · 无目标主动（星区剩余储量**加法** sector_ore_add）
  'module.oreEnrichment': '矿藏富集', // 采矿 · 无目标主动（星区剩余储量**乘法** sector_ore_mul）
  'module.emp': '电磁脉冲',
  'module.alphaShield': '阿尔法护盾',
  'module.regenShield': '再生护盾',
  'module.hardShield': '硬化护盾',
  'module.reflectShield': '反射护盾',
  'module.allianceShield': '同盟护盾',
  'module.blastShield': '防爆护盾',
  'battle.detail.longShield': '长期护盾池',
  'module.shieldSuppressor': '护盾抑制器',
  'module.singleHanded': '单枪匹马',
  'module.impregnable': '固若金汤',
  'module.timeWarp': '时间扭曲',
  'module.slowTime': '放缓时间',
  'module.overload': '辐能过载',
  'module.stealth': '潜行',

  /* 货物类型名（`data/cargos/*.js` 的 `nameKey`；类型名即默认货物名，实例自定义 `name` 时不再使用） */
  'cargo.none': '无',
  'cargo.weaponPart': '武器零件',
  'cargo.fieldComponent': '力场组件',
  'cargo.functionDevice': '功能设备',
  'cargo.droneDebris': '机骸碎片',
  'cargo.miningRig': '采矿器械',
  'cargo.freightBlueprint': '货运蓝图',

  /* 单位系数栏（详情页 · 模块字段之前） */
  'battle.detail.coeffs': '单位系数',
  'battle.coeff.attack': '攻击系数',
  'battle.coeff.shield': '护盾系数',
  'battle.coeff.function': '功能系数',
  'battle.coeff.transport': '运输系数',
  'battle.coeff.mining': '采矿系数',
  'battle.coeff.drone': '无人机系数',
  // ★ 单位系数栏（详情页）：**只放数值、不放任何解释性文案**（基础值/口径说明/预留说明一律不显示）。
  //   `mulRow` 为预留项（当前无词条映射 → 显示“无”）；`takeMul`＝受伤减免（×值）；
  //   `timeCoeff`＝时间系数（负＝加速 / 正＝放缓；计时器需求量 = 基础量 ×(1+系数)，取整）。
  'battle.coeff.mulRow': '其它系数',
  'battle.coeff.takeMul': '受伤减免',
  'battle.coeff.timeCoeff': '时间系数',
  'battle.coeff.none': '无',

  /* 对战场景 */
  'battle.title': '对战场景',
  'battle.drill.title': '演练编队配置',
  'battle.drill.hint': '双方皆可添加各类单位、设置单位等级与定位（战斗/后勤），并为每单位装配/卸除模块，点“开战”进入对局。',
  'battle.fleet.ally': '我方编队',
  'battle.fleet.enemy': '敌方编队',
  'battle.drill.addShip': '＋ 添加单位',
  'battle.drill.removeShip': '移除该舰',
  'battle.drill.addModule': '＋ 添加模块…',
  'battle.drill.removeModule': '移除该模块',
  'battle.drill.levelOf': '模块 {n}：选择等级',
  'battle.drill.fullSlots': '模块槽位已满',
  'battle.drill.start': '开战',
  'battle.drill.shipType': '添加单位：选择类型',
  'battle.drill.shipLevel': '单位 {n}：选择等级',
  'battle.drill.role': '单位定位',
  'battle.drill.role.combat': '战斗单位',
  'battle.drill.role.logistics': '后勤单位',
  'battle.drill.slots': '模块 {n}/{m}',
  // 星区（战斗场景）设定：名称＝用户自定义字符串（**原样提交/显示、不做 i18n**）；储量＝非负整数
  'battle.drill.sector': '星区设定',
  'battle.drill.sectorName': '星区名称',
  'battle.drill.sectorNamePh': '（留空则不显示名称）',
  'battle.drill.sectorOreLabel': '矿物储量',
  'battle.drill.sectorOreInvalid': '矿物储量须为 0 或正整数',
  // 星区设定·**货物设定**：类型（None + 6 种零件）+ 数量批量添加；逐条可改名称/吨位/等级
  // （类型由所选类型决定、**不可编辑**；**装载时间随等级解析、不可编辑**）
  'battle.drill.cargoTitle': '星区货物',
  'battle.drill.cargoTplLabel': '类型',
  'battle.drill.cargoCountLabel': '数量',
  'battle.drill.cargoAdd': '添加货物',
  'battle.drill.cargoEmpty': '（暂无货物）',
  'battle.drill.cargoName': '货物名称',
  'battle.drill.cargoType': '类型',
  'battle.drill.cargoTons': '吨位',
  'battle.drill.cargoLevel': '等级',
  'battle.drill.cargoLoad': '装载 {s}s',
  'battle.drill.cargoRemove': '移除该货物',
  'battle.drill.cargoRemoveBtn': '移除',
  'battle.drill.cargoTonsInvalid': '吨位须为 0 或正整数',
  'battle.drill.cargoLevelInvalid': '等级须为 1 至 {max} 的整数',
  'battle.drill.cargoCountInvalid': '数量须为 1 或正整数',
  'battle.drill.blocked': '存在无效配置，无法开战',
  'battle.drill.warn.title': '配置存在问题（{n} 项），修正后方可开战：',
  'battle.drill.warn.slotOverflow': '模块数超出该等级槽位（上限 {n}），请卸除多余模块或提高单位等级',
  'battle.drill.warn.levelClamped': '单位等级超出上限，已按 Lv{n} 计',
  'battle.drill.warn.moduleLevelClamped': '模块等级超出上限，已按 Lv{n} 计',
  'battle.drill.warn.invalid': '存在无效条目（未知船型/模块），将被忽略',
  // 星区货物侧告警（引擎唯一口径 `normalizeSectorCargos` 产出，`side` 恒为 'sector'）
  'battle.drill.warn.cargoInvalid': '星区货物存在无效条目，将被忽略',
  'battle.drill.warn.cargoUnknownTemplate': '未知货物类型（{id}），将被忽略',
  'battle.drill.warn.cargoCountClamped': '货物数量超出允许范围，已按 {n} 计',
  'battle.drill.warn.cargoClamped': '货物{field}超出允许范围，已钳制为 {to}',
  'battle.drill.warn.cargoOverflow': '星区货物超出上限（{n} 项），超出部分已截断',
  'battle.zone.enemy': '敌方战斗单位',
  'battle.zone.enemyLogistics': '敌方后勤单位',
  'battle.zone.combat': '我方战斗单位',
  'battle.zone.logistics': '我方后勤单位',
  'battle.zone.command': '指挥栏',
  // 星区资源栏（指挥栏下方独立一栏）：栏目标题无名称时用「星区」；行标签＝矿物储量（剩余/初始）
  'battle.zone.sector': '星区',
  'battle.sector.ore': '矿物储量',
  'battle.sector.line': '星区：{name}',
  // 星区冷却组（储量条**上方**的独立小节标题）：组内每模块一行，**仅冷却中显示**、就绪隐藏
  'battle.sector.cdTitle': '星区冷却',
  // 星区资源栏·星区冷却行（每个星区冷却模块各一行，**仅在冷却中显示**）：剩余冷却 tick 数
  'battle.sector.cd': '冷却 {n}t',
  // ★ 星区资源栏·**星区货物**小节（与星区冷却组**并排**的独立区块）：每件货物一个小芯片
  //   （**高度固定 32px**），边框色＝**类型色**；点击＝加入/移出**优先队列**（选中态＝边缘发光+内部填充）。
  //   芯片＝**六段独立元素**（各段各自成元素、各用一条短模板，**不拼成长串**），视觉顺序：
  //     `[cargoSeq 序号列] 名称 [· cargoBonus 加成%] [· cargoLv 等级] [· cargoMeta 吨位·装载秒] [末尾填充]`
  //     · cargoSeq   优先队列序号（1 起；**未入队留空占位**、定宽 ⇒ 入队/取消不跳动）；
  //     · 名称段     用户名称或类型名词条 `nameKey`（无模板，名称即数据）；
  //     · cargoBonus **加成增量百分比**（`bonus` 是倍率：1 → 整段不显示、1.1 → `10%`）；
  //     · cargoLv    等级（**仅等级 ≠ 1 时显示**该段）；
  //     · cargoMeta  吨位 · 装载秒数（末段文字）；
  //     · 末尾填充   与序号列**同宽的空占位**（无文案，纯 CSS 定宽，左右留白对称）。
  'battle.sector.cargoTitle': '星区货物',
  'battle.sector.cargoSeq': '{n}',
  'battle.sector.cargoBonus': '{v}%',
  'battle.sector.cargoLv': 'Lv{level}',
  'battle.sector.cargoMeta': '{tons}t · {load}s',
  'battle.sector.cargoHover': '{type}：{hint}',
  'battle.sector.cargoAddHint': '点击加入优先队列',
  'battle.sector.cargoRemoveHint': '点击移出队列',
  'battle.sector.cargoLockedHint': '装载中：剩余约 {s}s', // 被装载器锁定（引擎派生 locked）时的悬停提示；剩余秒数＝formatTickSeconds(需求−已推进)；此时点击无效
  'battle.command.fleet': '全队主要目标',
  'battle.command.preview': '当前命中：{name}',
  'battle.command.noTarget': '（无存活目标）',
  'battle.policy.order': '顺序',
  'battle.policy.lowestHp': '最低血量',
  'battle.policy.lowestShield': '最低护盾',
  'battle.policy.droneFirst': '优先无人机',
  'battle.policy.shipFirst': '优先舰船',
  'battle.side.ally': '我方',
  'battle.side.enemy': '敌方',
  'battle.hp': 'HP',
  'battle.shield': '护盾',
  'battle.energy': '能量',
  'battle.cargo': '货物',
  'battle.ore': '矿物',
  'battle.cargo.breakdown': '本体 {base} + 模块 {modules}',
  'battle.unit.ally': '我方{type}',
  'battle.unit.enemy': '敌方{type}',
  'battle.unit.focus': '目标：{name}',
  'battle.unit.focusNone': '目标：—',
  'battle.log.title': '战报',
  'battle.log.start': '战斗开始',
  /* —— 命中/溅射成句（逐吸收段，模块名渲染绿；{dtype} 为伤害类型） —— */
  'battle.log.hit.fire': '{actor}的{weapon}开火命中{target}',
  'battle.log.hit.blast': '{actor}的{weapon}爆炸命中{target}',
  'battle.log.hit.splash': '{actor}的{weapon}溅射到{target}',
  'battle.log.hit.absorb': '，对{abs}造成{amount}点{dtype}伤害',
  'battle.log.hit.reflect': '{owner}的{module}反射{amount}点伤害给{attacker}',
  'battle.log.empParalyze': '{actor}的{module}使{target}瘫痪',
  'battle.abs.base': '舰载护盾',
  'battle.abs.hull': '舰体',
  'battle.abs.alliance': '共享同盟护盾',
  'battle.abs.blastproof': '共享防爆护盾',
  'battle.dmgType.projectile': '动能',
  'battle.dmgType.beam': '能量',
  'battle.dmgType.explosive': '爆炸',
  'battle.dmgType.normal': '普通',
  'battle.dmgType.reflect': '反射',
  'battle.log.summon': '{ship} 召唤了 {unit}',
  'battle.log.tempExpired': '{ship} 到达存在时间自动消失',
  'battle.log.selfDestruct': '{ship} 引爆自毁',
  'battle.log.shieldBreak': '{ship} 的 {module} 护盾被击破',
  'battle.log.destroyed': '{ship} 被击毁',
  'battle.result.win.title': '胜利',
  'battle.result.win.desc': '敌方战斗单位已被全歼',
  'battle.result.lose.title': '失败',
  'battle.result.lose.desc': '我方战斗单位已被全歼',
  'battle.result.draw.title': '平局',
  'battle.result.draw.desc': '双方单位全部阵亡',
  'battle.restart': '再来一场',
  'battle.leave': '离开',
  'battle.leave.title': '结束本场战斗并返回编队配置界面',
  'battle.menu.back': '返回主菜单',

  /* 战斗交互（M1 增强） */
  'battle.phase.idle': '待命',
  'battle.phase.running': '对战中',
  'battle.phase.settled': '已结算',
  'battle.status': '阶段：{phase} ｜ 我方存活 {ally} ／ 敌方存活 {enemy}',
  'battle.act.fireReady': '开火就绪',
  'battle.act.fireCool': '开火 · {n}t 后',
  'battle.act.regen': '回复护盾',
  'battle.act.regenCool': '回复护盾 · {n}t 后',
  'battle.act.cooling': '冷却中 · {n}t',
  'battle.act.buffing': '效果持续 {n}t',
  'battle.act.buffReady': '可激活',
  'battle.act.shieldFull': '护盾已满',
  'battle.act.noEnergy': '能量不足',
  'battle.act.idle': '待机',
  'battle.act.dead': '已击毁',
  'battle.intent': '下一步：{act}',
  'battle.lifeLeft': '存活 {n}s',
  'battle.detail.empty': '点击场景中的单位查看详情',
  'battle.detail.slots': '模块槽 {n}',
  'battle.detail.modules': '模块',
  'battle.detail.noModules': '未安装模块',
  'battle.detail.costCycle': '耗能 {n} · 每 {cd}t',
  'battle.detail.costCycleDur': '耗能 {n} · 持续 {d}t + 冷却 {cd}t',
  // ★ 含「矿物成本」（`ore_cost`）的模块：成本段与周期段**分别成词、按需拼接**（最短体例）——
  //   好处：① 不会出现“耗能 0”的误导；② `costCycle`/`costCycleDur` 原样保留，
  //   不含矿物成本的既有模块文案**逐字不变**（零回归）。
  'battle.detail.costOre': '耗矿 {n}',
  'battle.detail.costEnergy': '耗能 {n}',
  'battle.detail.perCycle': '每 {cd}t',
  'battle.detail.perCargo': '每件货物', // 装载器（`cargo_loader`）：无自身冷却，周期＝一次完整装载
  'battle.detail.perCycleDur': '持续 {d}t + 冷却 {cd}t',
  'battle.detail.cooling': '冷却 {n}t',
  'battle.detail.loading': '装载中 {done}/{need}t', // 装载器在装（进度/需求 tick 均来自引擎只读判据 cargoLoadingOf）
  'battle.detail.ready': '就绪',
  'battle.detail.stateActive': '生效中',
  'battle.detail.stateInactive': '条件未满足',
  'battle.detail.stateCost': '状态型',
  'battle.detail.noEnergy': '能量不足',
  'battle.detail.regen': '回复中',
  'battle.detail.full': '护盾已满',
  'battle.detail.target': '主要攻击目标',
  'battle.detail.auto': '按自动策略',
  'battle.detail.following': '跟随全队[{policy}] → {name}',
  'battle.detail.autoOwn': '自动[{policy}] → {name}',
  'battle.detail.autoPolicy': '自动策略',
  'battle.detail.followFleet': '跟随全队',
  'battle.detail.targetLocked': '目标锁定：{name}（不可更改）',
  'battle.detail.lockGone': '已阵亡',
  'battle.detail.moduleTarget': '模块目标',
  'battle.detail.moduleFollow': '跟随船舰（默认）',
  'battle.detail.targetInfoMulti': '自动选择：按全队策略取前 {n} 个目标',
  'battle.detail.targetInfoAll': '自动选择：命中全部敌方单位',
  'battle.detail.targetSelf': '目标：自身',
  'battle.detail.manualTag': '（手动）',
  'battle.detail.lockTag': '（已锁定）',
  'battle.detail.lockNote': '锁定中：本次持续期内不切换目标（新选择于下次激活生效）',
  'battle.detail.targetLockPending': '锁定中：已记录新目标，将于下次激活生效',
  'battle.detail.targetLockedGone': '（锁定目标已阵亡，等待下次激活重新选目标）',
  'battle.detail.targetCurPrefix': '命中目标：',
  'battle.detail.curNone': '（无可用目标，本次不激活）',
  'battle.detail.buffing': '效果持续 {n}t',
  'battle.detail.disable': '停用',
  'battle.detail.enable': '启用',
  // 「不可停用」标签（`undeactivatable`）：开关灰显时的悬停说明（引擎判据 `moduleUndeactivatable`）
  'battle.detail.undeactivatable': '该模块不可停用',
  'battle.detail.disabled': '已停用',
  'battle.detail.ended': '战斗已结束，操作锁定（仅可浏览）',
  'battle.detail.aiGear': '模块 AI 策略（开发中预留入口）',
  'battle.detail.statDamage': '伤害 {n}/次',
  'battle.detail.statAttackCoeff': '攻击系数 {v}',
  'battle.detail.statAttackCoeffT': '目标攻击系数 {v}',
  'battle.detail.statHpBelow': '血量 ≤{v}%',
  'battle.detail.statDamageCoeffMul': '受到伤害 ×{v}',
  'battle.detail.statDamageCoeffMulT': '目标受到伤害 ×{v}',
  'battle.detail.statRamp': '每次激活 +{r} · 上限 {c}',
  'battle.detail.statTimeCoeff': '时间系数 {v}',
  'battle.detail.statBlast': '爆炸范围 {n}',
  'battle.detail.statInvincible': '无敌 {n}t',
  'battle.detail.statRegen': '回盾 {n}/次',
  'battle.detail.statOreGain': '采矿量 {n}/次', // 采矿激光：每次激活的采矿量（× 采矿系数后取整）
  'battle.detail.statCargoLoad': '装载速度 {v}', // 装载光束：装载速度加成原值（速度 = 1 + 本值 + (运输系数 − 1)）
  'battle.detail.cargos': '装载货物', // 详情页「装载货物」栏（单位系数区块下方：已入舱货物芯片）
  'battle.detail.cargoUnloadHint': '点击返还星区', // 该栏货物芯片的悬停提示（点击＝引擎唯一返还接口）
  'battle.detail.statMiningCoeff': '采矿系数 {v}', // 矿物压缩：自身采矿系数加性（不加取整、不乘船级系数）
  'battle.detail.statSectorOreAdd': '星区矿物 {v}/次', // 创世纪：星区剩余储量加法（绝对增量、无上限）
  'battle.detail.statSectorOreMul': '星区矿物 ×{v}/次', // 矿藏富集：星区剩余储量乘法（展示实际乘数 1+比例）
  'battle.detail.statOreT': '目标矿物 +{n}', // 矿物输送：1:1 输送给目标的矿物量（**不乘任何系数**，原样显示）
  'battle.detail.statCap': '护盾上限 +{n}',
  // ★ 自身常驻静态加成（增幅器类自身词条）：只放数值（无机制说明句）
  //   ★ 能量上限可**取负**（护盾电池的代价）→ 统一用带符号数值 {v}（fmtSigned 渲染 +N / −N）。
  'battle.detail.statHpCapBonus': '血量上限 {v}',
  'battle.detail.statEnergyCapBonus': '能量上限 {v}',
  'battle.detail.statEnergyRegenBonus': '能量恢复 {v}/s',
  'battle.detail.statCargoCapBonus': '货物容量 {v}',
  'battle.detail.statOreCapBonus': '矿物容量 {v}',
  // 自身护盾系数加性（`shield_coeff_add`，与既有 `attack_coeff_add` 的显示体例一致）
  'battle.detail.statShieldCoeff': '护盾系数 {v}',
  // 按阵亡数回血（`hp_regen_per_death`，如「回收利用」）：只放数值
  'battle.detail.statHpRegenPerDeath': '每阵亡单位恢复 {n}',
  'battle.detail.statShieldT': '目标护盾 {v}',
  'battle.detail.statCapT': '目标护盾上限 {v}',
  'battle.detail.statCapClear': '清空目标护盾上限',
  'battle.detail.statHpT': '目标血量 {v}',
  'battle.detail.statHpCapT': '目标血量上限 {v}',
  'battle.detail.statHpCapClear': '清空目标血量上限',
  'battle.detail.statEnergyT': '目标能量 {v}',
  'battle.detail.statEnergyCapT': '目标能量上限 {v}',
  'battle.detail.statEnergyCapClear': '清空目标能量上限',
  // ★ 自身单体模块（`target.kinds === ['self']`，如「潜行」）：上限类词条的作用对象就是自己 → “自身”措辞
  'battle.detail.statEnergyCapClearSelf': '清空自身能量上限',
  'battle.detail.targetForced': '被强制攻击：{name}',
  'battle.detail.statDuration': '持续 {n}t',
  'battle.detail.statSummon': '召唤 {type} · 存活上限 {n} · 时长 {t}t',
  'battle.detail.contrib.dmg': '本场贡献：总伤害 {dmg} · DPS {dps} · 激活 {act} 次',
  'battle.detail.contrib.regen': '本场贡献：总回复 {amt} · {rate}/秒 · 激活 {act} 次',
  'battle.detail.contrib.latestDmg': '本击伤害 {n}',
  'battle.detail.contrib.latestShield': '本次回盾 {n}',
  'battle.detail.locked': '锁定目标：{name}',
  'battle.detail.targetIs': '当前目标：{name}',
  'battle.detail.noControl': '（敌方单位，无法指定其目标）',
  'battle.detail.noTargets': '（无存活目标）',
  'battle.log.retarget': '{ship} 将主要攻击目标设为 {target}',
  'battle.log.autoTarget': '{ship} 改为跟随全队目标',
  'battle.log.moduleOff': '{ship} 停用了模块：{module}',
  'battle.log.moduleOn': '{ship} 启用了模块：{module}',
  'battle.log.moduleFollow': '{ship} 的模块「{module}」恢复跟随船舰目标',
  'battle.log.aiPlaceholder': '模块 AI 策略（{module}）将在后续版本开放',
  'battle.log.forceTarget': '{actor} 的 {module} 生效：{n} 个目标被强制攻击它',
  'battle.log.forceFallback': '{owner}的{module}强制效果结束：{n}个单位的集火对象回落至其它仍生效的来源',
  'battle.log.forceRelease': '{owner}的{module}强制效果结束：{n}个单位恢复按正常优先级选择目标',
  'battle.log.hastenStart': '{owner}的{module}开始加速：{n}个单位',
  'battle.log.hastenEnd': '{owner}的{module}加速结束：{n}个单位',
  'battle.log.slowStart': '{owner}的{module}开始减速：{n}个单位',
  'battle.log.slowEnd': '{owner}的{module}减速结束：{n}个单位',
  // ★ 潜行（`type` 标签 `stealth`）：低频聚合（仅状态翻转各一条、带模块拥有者；标记类不做高频播报）
  'battle.log.stealthStart': '{owner}的{module}生效：{n}个单位进入潜行',
  'battle.log.stealthEnd': '{owner}的{module}潜行结束：{n}个单位',
  // ★ 按阵亡数回血（`hp_regen_per_death`，如「回收利用」）：**低频**——必须有阵亡才会出现，
  //   且仅“实际回血 > 0”时每 tick 每模块至多一条；带模块拥有者。
  'battle.log.recycleRegen': '{owner}的{module}回收利用：阵亡 {n} 个单位，恢复 {amount} 点生命',
  // ★ 采矿 / 星区储量类**低频战报**（成句体例：`{owner}的{module}：…`，owner 着色、module 恒绿）：
  //   · `miningGain`：每次激活**实际入库量 > 0** 才记；按**模块实例**聚合成一条（每实例每 tick ≤ 1 条）；
  //   · `sectorOreAdd`：仅实际增量 > 0 时记（`n`＝该条实际增量，已乘采矿系数）；
  //   · `sectorOreMul`：仅该条真正改变储量时记（`mul`＝实际乘数如 1.1、`n`＝该条落地前后差值）。
  'battle.log.miningGain': '{owner}的{module}：采集 {n} 点矿物',
  'battle.log.sectorOreAdd': '{owner}的{module}：星区矿物 +{n}',
  'battle.log.sectorOreMul': '{owner}的{module}：星区矿物 ×{mul}（+{n}）',
  // ★ 矿物输送（`ore_target`，1:1）：低频——**仅在实际输送量 > 0** 时记一条（`n`＝实际转移量，非请求量），
  //   每模块每 tick 至多 1 条（单次激活只产生一条输送记录）；成句在结算步骤 3d-2 的**落地处**（与数值同批）；
  //   owner/target 着色、module 恒绿。与「能量输送」（不记战报）不同：矿物是**成对搬运**的可见资源。
  'battle.log.oreTransfer': '{owner}的{module}：输送 {n} 点矿物给 {target}',
  // ★ 治疗型「矿物成本」模块（`ore_cost` + 治疗 `hp_target`，如「矿物维修」）：低频——**仅在实际回血量 > 0** 时记，
  //   每模块每 tick 至多 1 条；`n`＝**实际扣矿量**、`amount`＝**实际回血量**（含 hpMax 截断，口径唯一）；
  //   owner/target 着色、module 恒绿；成句在结算步骤 4c 的**回血落地处**（与数值同批）。
  'battle.log.oreRepair': '{owner}的{module}：消耗 {n} 点矿物，修复 {target} {amount} 点生命',
  'battle.result.close': '收起',
};
