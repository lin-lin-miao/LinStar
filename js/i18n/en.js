/* ===== i18n/en.js —— 英文词条（骨架占位，M6 补齐） =====
 * 缺失词条会自动回退到 zh-CN（见 i18n/index.js）。
 */
export default {
  /* brand / common */
  'brand': 'LinStar',

  /* HUD */
  'hud.tps': '{n} tps',
  'hud.tpsTip': 'Measured ticks per second',
  'hud.pause': 'Pause',
  'hud.resume': 'Resume',
  'hud.step': 'Step',
  'hud.stepTip': 'Advance one frame while paused',
  'hud.speed': 'Speed x{n}',
  'hud.export': 'Export Save',
  'hud.import': 'Import Save',
  'hud.lang': 'Language',

  /* Main menu */
  'menu.title': 'LinStar',
  'menu.subtitle': 'A space idle / turn-based web game',
  'menu.start': 'Start Game',
  'menu.hint': 'Save: use Export / Import in the top bar',

  /* Save */
  'save.exported': 'Save exported',
  'save.imported': 'Save imported successfully',
  'save.importError': 'Failed to import save: {err}',
  'save.exportBusy': 'Cannot export save mid-battle',
  'save.importBusy': 'Cannot import save mid-battle',
  'save.busy': 'Cannot save mid-battle; autosaves after settlement',
  'save.unavailable': 'Local storage unavailable (private/restricted mode); manual export/import still works.',

  /* Ships */
  'ship.combat': 'Combat Ship',
  'ship.transport': 'Transport Ship',
  'ship.mining': 'Mining Ship',
  'ship.drone': 'Drone',
  'ship.rocket': 'Rocket',
  'ship.missile': 'Missile',
  'ship.omegaMissile': 'Omega Missile',
  'ship.slagMissile': 'Slag Missile',

  /* Modules */
  'module.cannon': 'Cannon',
  'module.concussionCannon': 'Concussion Cannon',
  'module.heavyCannon': 'Heavy Cannon',
  'module.laser': 'Laser',
  'module.dualLaser': 'Twin Laser',
  'module.denseBarrage': 'Dense Barrage',
  'module.laserDroneSpawn': 'Laser Drone',
  'module.rocketLauncher': 'Rocket Launcher',
  'module.rocketWarhead': 'Rocket Blast',
  'module.missileLauncher': 'Missile Launcher',
  'module.missileWarhead': 'Missile Blast',
  'module.omegaMissileLauncher': 'Omega Missile Launcher',
  'module.omegaMissileWarhead': 'Omega Missile Blast',
  'module.slagMissileLauncher': 'Slag Missile Launcher', // Mining · summons a slag missile (ore_cost only, no energy)
  'module.slagMissileWarhead': 'Slag Missile Blast', // Internal: warhead carried by the slag missile (picker:false)
  'module.reactorCoil': 'Strong Radiation Coil',
  'module.shieldBattery': 'Shield Battery',
  'module.hullArmor': 'Hull Armor',
  'module.recycle': 'Recycling',
  'module.energyTransfer': 'Energy Transfer',
  'module.oreTransfer': 'Ore Transfer', // Mining · single ally target (moves own ore 1:1, no coefficient)
  'module.cargoHold': 'Cargo Hold',
  'module.loadingBeam': 'Loading Beam', // Transport · active, targetless (tag cargo_loader + word cargo_load: loads sector cargo into the hold)
  'module.oreHold': 'Ore Hold',
  'module.miningLaser': 'Mining Laser',
  'module.oreCompressor': 'Ore Compressor', // Mining · passive booster (own mining coefficient)
  'module.oreRepair': 'Ore Repair', // Mining · single ally target incl. self (spends own ore_cost to heal hp_target, raw value)
  'module.genesis': 'Genesis', // Mining · targetless active (sector ore reserve, additive)
  'module.oreEnrichment': 'Ore Enrichment', // Mining · targetless active (sector ore reserve, multiplicative)
  'module.emp': 'EMP',
  'module.alphaShield': 'Alpha Shield',
  'module.regenShield': 'Regenerative Shield',
  'module.hardShield': 'Hardened Shield',
  'module.reflectShield': 'Reflective Shield',
  'module.allianceShield': 'Alliance Shield',
  'module.blastShield': 'Blast Shield',
  'battle.detail.longShield': 'Long-term Shield Pool',
  'module.shieldSuppressor': 'Shield Suppressor',
  'module.singleHanded': 'Single-Handed',
  'module.impregnable': 'Impregnable',
  'module.timeWarp': 'Time Warp',
  'module.slowTime': 'Slow Time',
  'module.overload': 'Overload',
  'module.stealth': 'Stealth',

  /* Cargo type names (`data/cargos/*.js` nameKey; the type name is also the default cargo name) */
  'cargo.none': 'None',
  'cargo.weaponPart': 'Weapon Part',
  'cargo.fieldComponent': 'Field Component',
  'cargo.functionDevice': 'Function Device',
  'cargo.droneDebris': 'Drone Debris',
  'cargo.miningRig': 'Mining Rig',
  'cargo.freightBlueprint': 'Freight Blueprint',

  /* Unit coefficients (detail page · before Modules) */
  'battle.detail.coeffs': 'Unit Coefficients',
  'battle.coeff.attack': 'Attack coeff.',
  'battle.coeff.shield': 'Shield coeff.',
  'battle.coeff.function': 'Function coeff.',
  'battle.coeff.transport': 'Transport coeff.',
  'battle.coeff.mining': 'Mining coeff.',
  'battle.coeff.drone': 'Drone coeff.',
  // ★ Unit-coefficient bar (detail page): **values only, no explanatory text**.
  //   `timeCoeff` = time coefficient (negative = accelerate / positive = slow down;
  //   timer demand = base × (1 + coeff), rounded).
  'battle.coeff.mulRow': 'Other coeffs',
  'battle.coeff.takeMul': 'Damage taken',
  'battle.coeff.timeCoeff': 'Time coeff.',
  'battle.coeff.none': 'None',

  /* Battle scene */
  'battle.title': 'Battle',
  'battle.drill.title': 'Drill Fleet Setup',
  'battle.drill.hint': 'Add units of any type on either side, set each unit level and role (combat / logistics), equip modules, then Start.',
  'battle.fleet.ally': 'Our Fleet',
  'battle.fleet.enemy': 'Enemy Fleet',
  'battle.drill.addShip': '+ Add Unit',
  'battle.drill.removeShip': 'Remove Ship',
  'battle.drill.addModule': '+ Add Module…',
  'battle.drill.removeModule': 'Remove Module',
  'battle.drill.levelOf': 'Module {n}: choose level',
  'battle.drill.fullSlots': 'Module slots full',
  'battle.drill.start': 'Start Battle',
  'battle.drill.shipType': 'Add unit: choose type',
  'battle.drill.shipLevel': 'Unit {n}: choose level',
  'battle.drill.role': 'Unit role',
  'battle.drill.role.combat': 'Combat Unit',
  'battle.drill.role.logistics': 'Logistics Unit',
  'battle.drill.slots': 'Modules {n}/{m}',
  // Sector (battle scene) setup: the name is a user-typed string (shown verbatim, never translated)
  'battle.drill.sector': 'Sector',
  'battle.drill.sectorName': 'Sector name',
  'battle.drill.sectorNamePh': '(empty = no name shown)',
  'battle.drill.sectorOreLabel': 'Ore reserve',
  'battle.drill.sectorOreInvalid': 'Ore reserve must be 0 or a positive whole number',
  // Sector cargo setup (type = None + 6 part kinds): add in bulk by type + count, then edit
  // name / tons / level per entry (the type comes from the picked type and is NOT editable;
  // load time follows the level and is NOT editable).
  'battle.drill.cargoTitle': 'Sector Cargo',
  'battle.drill.cargoTplLabel': 'Type',
  'battle.drill.cargoCountLabel': 'Count',
  'battle.drill.cargoAdd': 'Add cargo',
  'battle.drill.cargoEmpty': '(no cargo)',
  'battle.drill.cargoName': 'Cargo name',
  'battle.drill.cargoType': 'Type',
  'battle.drill.cargoTons': 'Tons',
  'battle.drill.cargoLevel': 'Level',
  'battle.drill.cargoLoad': 'Load {s}s',
  'battle.drill.cargoRemove': 'Remove this cargo',
  'battle.drill.cargoRemoveBtn': 'Remove',
  'battle.drill.cargoTonsInvalid': 'Tons must be 0 or a positive whole number',
  'battle.drill.cargoLevelInvalid': 'Level must be a whole number from 1 to {max}',
  'battle.drill.cargoCountInvalid': 'Count must be 1 or a positive whole number',
  'battle.drill.blocked': 'Invalid setup — cannot start',
  'battle.drill.warn.title': 'Setup issues ({n}) — fix them to start:',
  'battle.drill.warn.slotOverflow': 'More modules than slots at this level (max {n}) — remove modules or raise the unit level',
  'battle.drill.warn.levelClamped': 'Unit level above the cap — counted as Lv{n}',
  'battle.drill.warn.moduleLevelClamped': 'Module level above the cap — counted as Lv{n}',
  'battle.drill.warn.invalid': 'Invalid entry (unknown ship type / module) — it will be ignored',
  // Sector-cargo warnings (produced by the single engine rule `normalizeSectorCargos`, side is always 'sector')
  'battle.drill.warn.cargoInvalid': 'Invalid sector cargo entry — it will be ignored',
  'battle.drill.warn.cargoUnknownTemplate': 'Unknown cargo type ({id}) — it will be ignored',
  'battle.drill.warn.cargoCountClamped': 'Cargo count out of range — counted as {n}',
  'battle.drill.warn.cargoClamped': 'Cargo {field} out of range — clamped to {to}',
  'battle.drill.warn.cargoOverflow': 'Too much sector cargo (max {n}) — the excess was dropped',
  'battle.zone.enemy': 'Enemy Combat Units',
  'battle.zone.enemyLogistics': 'Enemy Logistics Units',
  'battle.zone.combat': 'Our Combat Units',
  'battle.zone.logistics': 'Our Logistics Units',
  'battle.zone.command': 'Command',
  // Sector resource bar (one row below the command bar): title falls back to "Sector" when unnamed
  'battle.zone.sector': 'Sector',
  'battle.sector.ore': 'Ore reserve',
  'battle.sector.line': 'Sector: {name}',
  // Sector bar · sector-cooldown group (a separate sub-section ABOVE the reserve row)
  'battle.sector.cdTitle': 'Sector cooldown',
  // Sector bar · sector-cooldown rows (one per sector-cooldown module, shown only while cooling)
  'battle.sector.cd': 'Cooldown {n}t',
  // ★ Sector bar · SECTOR CARGO sub-section (sits SIDE BY SIDE with the sector-cooldown group): one small
  //   chip per cargo (FIXED HEIGHT 32px), border colour = TYPE colour; clicking toggles its place in the
  //   PRIORITY QUEUE (queued = edge glow + inner fill). A chip is SIX INDEPENDENT segments (each its own
  //   element with its own short template — never glued into one long string), visual order:
  //     `[cargoSeq] name [· cargoBonus %] [· cargoLv level] [· cargoMeta tons·load] [trailing pad]`
  //     · cargoSeq   queue number (1-based; EMPTY PLACEHOLDER while not queued, fixed width ⇒ no jump);
  //     · name       user name or the type-name entry `nameKey` (no template — the name is data);
  //     · cargoBonus incremental bonus percent (`bonus` is a multiplier: 1 → hidden, 1.1 → `10%`);
  //     · cargoLv    level (segment shown ONLY when the level is not 1);
  //     · cargoMeta  tons · load seconds (last text segment);
  //     · trailing pad  empty spacer of the SAME WIDTH as the queue-number column (CSS only).
  'battle.sector.cargoTitle': 'Sector Cargo',
  'battle.sector.cargoSeq': '{n}',
  'battle.sector.cargoBonus': '{v}%',
  'battle.sector.cargoLv': 'Lv{level}',
  'battle.sector.cargoMeta': '{tons}t · {load}s',
  'battle.sector.cargoHover': '{type}: {hint}',
  'battle.sector.cargoAddHint': 'Click to add to the priority queue',
  'battle.sector.cargoRemoveHint': 'Click to remove from the queue',
  'battle.sector.cargoLockedHint': 'Loading — about {s}s left', // Hover hint while locked by a loader; seconds = formatTickSeconds(need − elapsed); clicking does nothing
  'battle.command.fleet': 'Fleet Primary Target',
  'battle.command.preview': 'Current: {name}',
  'battle.command.noTarget': '(No living targets)',
  'battle.policy.order': 'Order',
  'battle.policy.lowestHp': 'Lowest HP',
  'battle.policy.lowestShield': 'Lowest Shield',
  'battle.policy.droneFirst': 'Drones First',
  'battle.policy.shipFirst': 'Ships First',
  'battle.side.ally': 'Ally',
  'battle.side.enemy': 'Enemy',
  'battle.hp': 'HP',
  'battle.shield': 'Shield',
  'battle.energy': 'Energy',
  'battle.cargo': 'Cargo',
  'battle.ore': 'Ore',
  'battle.cargo.breakdown': 'Base {base} + Modules {modules}',
  'battle.unit.ally': 'Ally {type}',
  'battle.unit.enemy': 'Enemy {type}',
  'battle.unit.focus': 'Target: {name}',
  'battle.unit.focusNone': 'Target: —',
  'battle.log.title': 'Battle Log',
  'battle.log.start': 'Battle started',
  /* —— 命中/溅射成句（逐吸收段，模块名渲染绿；{dtype} 为伤害类型） —— */
  'battle.log.hit.fire': "{actor}'s {weapon} fires at {target}",
  'battle.log.hit.blast': "{actor}'s {weapon} explodes on {target}",
  'battle.log.hit.splash': "{actor}'s {weapon} splash-hits {target}",
  'battle.log.hit.absorb': ', {amount} {dtype} damage to {abs}',
  'battle.log.hit.reflect': "{owner}'s {module} reflects {amount} damage back to {attacker}",
  'battle.log.empParalyze': "{actor}'s {module} paralyzes {target}",
  'battle.abs.base': 'ship shield',
  'battle.abs.hull': 'hull',
  'battle.abs.alliance': 'shared ally shield',
  'battle.abs.blastproof': 'shared blast shield',
  'battle.dmgType.projectile': 'Kinetic',
  'battle.dmgType.beam': 'Energy',
  'battle.dmgType.explosive': 'Explosive',
  'battle.dmgType.normal': 'Normal',
  'battle.dmgType.reflect': 'Reflected',
  'battle.log.summon': '{ship} summoned {unit}',
  'battle.log.selfDestruct': '{ship} self-destructed',
  'battle.log.shieldBreak': "{ship}'s {module} shield broken",
  'battle.log.tempExpired': '{ship} expired and vanished',
  'battle.log.destroyed': '{ship} destroyed',
  'battle.result.win.title': 'Victory',
  'battle.result.win.desc': 'All enemy units destroyed',
  'battle.result.lose.title': 'Defeat',
  'battle.result.lose.desc': 'All allied units destroyed',
  'battle.result.draw.title': 'Draw',
  'battle.result.draw.desc': 'All units on both sides destroyed',
  'battle.restart': 'Battle Again',
  'battle.leave': 'Leave',
  'battle.leave.title': 'End this battle and return to the fleet setup',
  'battle.menu.back': 'Back to Main Menu',

  /* Battle interactions (M1 enhancement) */
  'battle.phase.idle': 'Idle',
  'battle.phase.running': 'In battle',
  'battle.phase.settled': 'Settled',
  'battle.status': 'Phase: {phase} | Ally alive {ally} / Enemy alive {enemy}',
  'battle.act.fireReady': 'Ready to fire',
  'battle.act.fireCool': 'Fires in {n}t',
  'battle.act.regen': 'Regenerating shield',
  'battle.act.regenCool': 'Shield regen in {n}t',
  'battle.act.cooling': 'Cooling · {n}t',
  'battle.act.buffing': 'Active {n}t',
  'battle.act.buffReady': 'Ready to activate',
  'battle.act.shieldFull': 'Shield full',
  'battle.act.noEnergy': 'No energy',
  'battle.act.idle': 'Idle',
  'battle.act.dead': 'Destroyed',
  'battle.intent': 'Next: {act}',
  'battle.lifeLeft': '{n}s left',
  'battle.detail.empty': 'Click a unit in the scene for details',
  'battle.detail.slots': '{n} module slots',
  'battle.detail.modules': 'Modules',
  'battle.detail.noModules': 'No modules installed',
  'battle.detail.costCycle': 'Energy {n} · every {cd}t',
  'battle.detail.costCycleDur': 'Energy {n} · {d}t duration + {cd}t cooldown',
  // ★ Modules with an ore cost (`ore_cost`): cost and period segments are separate short phrases,
  //   composed on demand — avoids a misleading "Energy 0" while leaving the existing
  //   costCycle/costCycleDur wording of every other module byte-identical (zero regression).
  'battle.detail.costOre': 'Ore {n}',
  'battle.detail.costEnergy': 'Energy {n}',
  'battle.detail.perCycle': 'every {cd}t',
  'battle.detail.perCargo': 'per cargo', // Loader (`cargo_loader`): no own cooldown; its cycle is one full load
  'battle.detail.perCycleDur': '{d}t duration + {cd}t cooldown',
  'battle.detail.cooling': 'Cooldown {n}t',
  'battle.detail.loading': 'Loading {done}/{need}t', // Loader busy (progress/need ticks come from the engine read-only `cargoLoadingOf`)
  'battle.detail.ready': 'Ready',
  'battle.detail.stateActive': 'Active',
  'battle.detail.stateInactive': 'Condition unmet',
  'battle.detail.stateCost': 'State type',
  'battle.detail.noEnergy': 'No energy',
  'battle.detail.regen': 'Regenerating',
  'battle.detail.full': 'Shield full',
  'battle.detail.target': 'Primary Attack Target',
  'battle.detail.auto': 'By Auto Strategy',
  'battle.detail.following': 'Follows fleet [{policy}] → {name}',
  'battle.detail.autoOwn': 'Auto [{policy}] → {name}',
  'battle.detail.autoPolicy': 'Auto strategy',
  'battle.detail.followFleet': 'Follow fleet',
  'battle.detail.targetLocked': 'Locked target: {name} (cannot change)',
  'battle.detail.lockGone': 'destroyed',
  'battle.detail.moduleTarget': 'Module Target',
  'battle.detail.moduleFollow': 'Follow Ship (default)',
  'battle.detail.targetInfoMulti': 'Auto: take first {n} targets by fleet policy',
  'battle.detail.targetInfoAll': 'Auto: hits all living enemies',
  'battle.detail.targetSelf': 'Target: self',
  'battle.detail.manualTag': '(manual)',
  'battle.detail.lockTag': '(locked)',
  'battle.detail.lockNote': 'Locked: target stays fixed for this duration (a new pick applies on the next activation)',
  'battle.detail.targetLockPending': 'Locked: new target recorded, takes effect on the next activation',
  'battle.detail.targetLockedGone': '(locked target is dead; pick a new one for the next activation)',
  'battle.detail.targetCurPrefix': 'Hit targets: ',
  'battle.detail.curNone': '(no usable targets this activation)',
  'battle.detail.buffing': 'Active {n}t',
  'battle.detail.disable': 'Disable',
  'battle.detail.enable': 'Enable',
  // "Undeactivatable" tag: tooltip on the greyed-out toggle (engine predicate moduleUndeactivatable)
  'battle.detail.undeactivatable': 'This module cannot be deactivated',
  'battle.detail.disabled': 'Disabled',
  'battle.detail.ended': 'Battle over - actions locked (view only)',
  'battle.detail.aiGear': 'Module AI strategy (reserved, in development)',
  'battle.detail.statDamage': 'Damage {n}/shot',
  'battle.detail.statAttackCoeff': 'Attack coefficient {v}',
  'battle.detail.statAttackCoeffT': 'Target attack coefficient {v}',
  'battle.detail.statHpBelow': 'HP ≤{v}%',
  'battle.detail.statDamageCoeffMul': 'Damage taken ×{v}',
  'battle.detail.statDamageCoeffMulT': 'Target damage taken ×{v}',
  'battle.detail.statRamp': '+{r}/activation · cap {c}',
  'battle.detail.statTimeCoeff': 'Time coeff. {v}',
  'battle.detail.statBlast': 'Blast range {n}',
  'battle.detail.statInvincible': 'Invincible {n}t',
  'battle.detail.statRegen': 'Shield +{n}/shot',
  'battle.detail.statOreGain': 'Mining {n}/shot', // Mining Laser: ore gained per activation (× mining coeff.)
  'battle.detail.statCargoLoad': 'Loading speed {v}', // Loading Beam: loading-speed bonus (speed = 1 + value + (transport coeff − 1))
  'battle.detail.cargos': 'Loaded Cargo', // Detail panel "Loaded Cargo" row (below the coefficient block): chips of cargo in the hold
  'battle.detail.cargoUnloadHint': 'Click to return to the sector', // Hover hint of those chips (click = the engine's only return entry point)
  'battle.detail.statMiningCoeff': 'Mining coeff {v}', // Ore Compressor: own mining coefficient, additive
  'battle.detail.statSectorOreAdd': 'Sector ore {v}/shot', // Genesis: sector reserve, additive (uncapped)
  'battle.detail.statSectorOreMul': 'Sector ore ×{v}/shot', // Ore Enrichment: sector reserve, multiplicative
  'battle.detail.statOreT': 'Target ore +{n}', // Ore Transfer: ore moved 1:1 (no coefficient applied, shown raw)
  'battle.detail.statCap': 'Shield cap +{n}',
  // ★ 自身常驻静态加成（增幅器类自身词条）：只放数值（无机制说明句）
  //   ★ 能量上限可**取负**（护盾电池的代价）→ 统一用带符号数值 {v}（fmtSigned 渲染 +N / −N）。
  'battle.detail.statHpCapBonus': 'HP cap {v}',
  'battle.detail.statEnergyCapBonus': 'Energy cap {v}',
  'battle.detail.statEnergyRegenBonus': 'Energy regen {v}/s',
  'battle.detail.statCargoCapBonus': 'Cargo cap {v}',
  'battle.detail.statOreCapBonus': 'Ore cap {v}',
  // 自身护盾系数加性（`shield_coeff_add`，与既有 `attack_coeff_add` 的显示体例一致）
  'battle.detail.statShieldCoeff': 'Shield coeff {v}',
  // 按阵亡数回血（`hp_regen_per_death`，如「回收利用」）：只放数值
  'battle.detail.statHpRegenPerDeath': 'Restore {n} HP per death',
  'battle.detail.statShieldT': 'Target shield {v}',
  'battle.detail.statCapT': 'Target cap {v}',
  'battle.detail.statCapClear': 'Clears target shield cap',
  'battle.detail.statHpT': 'Target HP {v}',
  'battle.detail.statHpCapT': 'Target HP cap {v}',
  'battle.detail.statHpCapClear': 'Clears target HP cap',
  'battle.detail.statEnergyT': 'Target energy {v}',
  'battle.detail.statEnergyCapT': 'Target energy cap {v}',
  'battle.detail.statEnergyCapClear': 'Clears target energy cap',
  // ★ Self-only modules (`target.kinds === ['self']`, e.g. Stealth): the cap term applies to oneself
  'battle.detail.statEnergyCapClearSelf': 'Clears own energy cap',
  'battle.detail.targetForced': 'Forced to attack: {name}',
  'battle.detail.statDuration': 'Duration {n}t',
  'battle.detail.statSummon': 'Summon {type} · cap {n} · lifespan {t}t',
  'battle.detail.contrib.dmg': 'This battle: {dmg} total damage · DPS {dps} · {act} activations',
  'battle.detail.contrib.regen': 'This battle: {amt} total restored · {rate}/s · {act} activations',
  'battle.detail.contrib.latestDmg': 'last hit {n} dmg',
  'battle.detail.contrib.latestShield': 'last {n} shield',
  'battle.detail.locked': 'Locked on: {name}',
  'battle.detail.targetIs': 'Current target: {name}',
  'battle.detail.noControl': '(Enemy unit - cannot assign its target)',
  'battle.detail.noTargets': '(No living targets)',
  'battle.log.retarget': '{ship} set primary target to {target}',
  'battle.log.autoTarget': '{ship} now follows fleet target',
  'battle.log.moduleOff': '{ship} disabled module: {module}',
  'battle.log.moduleOn': '{ship} enabled module: {module}',
  'battle.log.moduleFollow': 'Module {module} of {ship} now follows ship target',
  'battle.log.aiPlaceholder': 'Module AI strategy ({module}) will be available in a later version',
  'battle.log.forceTarget': '{actor}\'s {module}: {n} target(s) forced to attack it',
  'battle.log.forceFallback': "{owner}'s {module} forced-target effect ended: focus of {n} unit(s) falls back to remaining sources",
  'battle.log.forceRelease': "{owner}'s {module} forced-target effect ended: {n} unit(s) return to normal target priority",
  'battle.log.hastenStart': "{owner}'s {module} starts accelerating: {n} unit(s)",
  'battle.log.hastenEnd': "{owner}'s {module} acceleration ended: {n} unit(s)",
  'battle.log.slowStart': "{owner}'s {module} starts slowing: {n} unit(s)",
  'battle.log.slowEnd': "{owner}'s {module} slowing ended: {n} unit(s)",
  // ★ Stealth (`type` tag `stealth`): low-frequency aggregation (one line per state flip, with module owner)
  'battle.log.stealthStart': "{owner}'s {module} active: {n} unit(s) stealthed",
  'battle.log.stealthEnd': "{owner}'s {module} stealth ended: {n} unit(s)",
  // ★ Per-death regen (`hp_regen_per_death`, e.g. "Recycling"): low-frequency — requires deaths,
  //   and at most one line per module per tick, only when the heal actually restored HP.
  'battle.log.recycleRegen': "{owner}'s {module} recycled: {n} unit(s) died, restored {amount} HP",
  // ★ Mining / sector-reserve low-frequency logs (`{owner}'s {module}: …`; owner colored, module green):
  //   · miningGain: only when the actual ore stored > 0; aggregated per module instance (≤1 line/instance/tick);
  //   · sectorOreAdd: only when the actual delta > 0 (n = that entry's delta, already × mining coeff.);
  //   · sectorOreMul: only when that entry really changed the reserve (mul = actual multiplier, n = its delta).
  'battle.log.miningGain': "{owner}'s {module}: mined {n} ore",
  'battle.log.sectorOreAdd': "{owner}'s {module}: sector ore +{n}",
  'battle.log.sectorOreMul': "{owner}'s {module}: sector ore ×{mul} (+{n})",
  // ★ Ore Transfer (`ore_target`, 1:1): low-frequency — logged only when the ACTUAL amount moved > 0
  //   (n = actual amount, not the requested one), at most one line per module per tick; the sentence is
  //   emitted at the settlement landing site (step 3d-2, same batch as the numbers); owner/target colored.
  'battle.log.oreTransfer': "{owner}'s {module}: transferred {n} ore to {target}",
  // ★ Ore-cost healing modules (`ore_cost` + healing `hp_target`, e.g. Ore Repair): low-frequency — logged
  //   only when the ACTUAL healing > 0, at most one line per module per tick; n = ore actually spent,
  //   amount = HP actually restored (hpMax clamp included, single source of truth); emitted at the
  //   healing landing site (settlement step 4c, same batch as the numbers); owner/target colored.
  'battle.log.oreRepair': "{owner}'s {module}: spent {n} ore, restored {amount} HP to {target}",
  'battle.result.close': 'Dismiss',
};
