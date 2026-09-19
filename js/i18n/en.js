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
  'menu.back': 'Back to Menu', // Generic "back to menu" for non-battle screens (e.g. the starfield config placeholder)
  'menu.hint': 'Save: use Export / Import in the top bar',

  /* Starfield Configuration screen (step S0-1 = placeholder page; implemented in step C-3) */
  'starfield.config.title': 'Starfield Configuration',
  'starfield.config.todo': 'Coming soon: pick difficulty/play mode, enter a random seed (random by default), configure the starfield radius and per-type sector counts, edit NPC lists, preview, and export/import the config.',
  'starfield.config.drillHint': 'Dev/testing: the drill formation screen no longer has a UI entry — open it with the console command LS.drill().',

  /* Starfield data layer (steps A-2/A-3/A-4): sector type / NPC list / starfield (difficulty) names
   * Key convention (enforced by `data/starfieldData.js selfCheck()`) = `sectorType.<id>` / `npcList.<id>` / `starfield.<id>` */
  'sectorType.star': 'Star Sector',
  'sectorType.planet': 'Planet Sector',
  'sectorType.mineral': 'Mineral Field',
  'sectorType.empty': 'Empty Space',
  'sectorType.stargate': 'Stargate Sector',
  'npcList.none': 'No Units',
  'npcList.patrolLight': 'Light Patrol',
  'npcList.patrolHeavy': 'Heavy Patrol',
  // Difficulty ladder names: identical in both languages (H1…Hn); add subtitles here if needed later
  'starfield.h1': 'H1',
  'starfield.h2': 'H2',
  'starfield.h3': 'H3',

  /* Starfield Map (step C-1: read-only view + zoom/pan + click-to-select; full battle sidebar = C-2).
   * Sector type names are NOT duplicated here — they use the existing `sectorType.<id>` keys. */
  'starfield.map.title': 'Starfield Map',
  'starfield.map.back': 'Back to Configuration',
  'starfield.map.meta': 'Difficulty {id} · Seed {seed} · Radius {r}',
  'starfield.map.remaining': '{s}s left',
  // ★ The below-the-map operation hint (formerly `starfield.map.hint`) was removed entirely ⇒ key deleted.
  'starfield.map.legend': 'Legend',
  'starfield.map.legend.void': 'No sector (empty cell)',
  'starfield.map.void': 'No sector: ({q}, {r})',
  'starfield.map.zoom.in': 'Zoom in',
  'starfield.map.zoom.out': 'Zoom out',
  'starfield.map.zoom.reset': 'Reset view',
  'starfield.map.resize': 'Drag to resize the sidebar',
  /* Sector display name (single source of truth): `#n Name (q, r)`, e.g. `#11 Planet Sector (1, -2)`.
   * Used by BOTH the battle screen's sector zone label and the starfield map sidebar title; {n} = index + 1. */
  'starfield.zoneName': '#{n} {name} ({q}, {r})',

  /* ★ C-3 Starfield configuration screen (main entry): labels / buttons / hints / validation reasons / status */
  'starfield.cfg.title': 'Starfield Configuration',
  'starfield.cfg.subtitle': 'Pick a difficulty as the base, then configure seed, radius, duration and per-type sectors; preview, then enter.',
  'starfield.cfg.difficulty': 'Difficulty / mode',
  'starfield.cfg.difficultyHint': 'Switching difficulty reloads the editor from that config (built-in data is never modified).',
  'starfield.cfg.seed': 'Seed',
  'starfield.cfg.seedRandom': 'Randomize',
  'starfield.cfg.seedHint': 'Letters/digits/underscore/hyphen, 1-32 chars; same config + same seed gives an identical result.',
  'starfield.cfg.radius': 'Radius',
  'starfield.cfg.radiusHint': 'Circular starfield radius (>=1); total sectors always equals the cells inside the circle.',
  'starfield.cfg.duration': 'Duration (ticks)',
  'starfield.cfg.durationHint': '>=1; currently about {s} seconds (20 tps).',
  /* Player-unit entry sector type (`sideRules.playerEntryTypeId`; "Auto" = field omitted => fallback rule) */
  'starfield.cfg.entryType': 'Entry sector type (player units)',
  'starfield.cfg.entryTypeHint': 'Player units spawn in a sector of this type; "Auto" = not specified => fall back to the first four-edge (edges) type, or #1 if none.',
  'starfield.cfg.entryAuto': 'Auto (fallback rule)',
  'starfield.cfg.types': 'Sector types (enable / count range / default NPC lists)',
  'starfield.cfg.min': 'min',
  'starfield.cfg.max': 'max',
  'starfield.cfg.typeNpc': 'default NPC lists',
  'starfield.cfg.typeNpcHint': 'Multiple allowed: each sector of this type draws one candidate list at random from the set (seed-driven); an empty set means no units.',
  'starfield.cfg.npcAdd': 'Add list',
  'starfield.cfg.npcAddHint': 'Add another candidate NPC list (one of them is drawn at random)',
  'starfield.cfg.npcRemove': 'Remove this list',
  'starfield.cfg.tagSpecial': 'special',
  'starfield.cfg.tagFill': 'fill',
  'starfield.cfg.npcReadonly': 'NPC lists (read-only summary; per-type candidate sets are overridden above)',
  'starfield.cfg.npcEmpty': 'no units',
  /* Player unit list (starting allied fleet; field = `playerUnits[]`, same shape as NPC list units[]) */
  'starfield.cfg.playerUnits': 'Player units (starting allied fleet)',
  'starfield.cfg.playerUnitsHint': 'Spawned in the entry sector when entering the starfield (see preview line); side is always ally. Each row = ship + level + count + modules (same shape as NPC lists).',
  'starfield.cfg.playerUnitsEmpty': 'No player units configured: entering the starfield spawns no starting allied fleet (use Add unit below).',
  'starfield.cfg.playerAdd': 'Add unit',
  'starfield.cfg.playerRemove': 'Remove this unit',
  'starfield.cfg.playerUnitN': 'Unit #{n}',
  'starfield.cfg.playerShip': 'Ship',
  'starfield.cfg.playerLevel': 'Level',
  'starfield.cfg.playerCount': 'Count',
  'starfield.cfg.playerSlots': 'modules {n}/{m}',
  'starfield.cfg.playerAddModule': 'Add module',
  'starfield.cfg.playerRemoveModule': 'Remove this module',
  'starfield.cfg.playerModuleLevel': '{n} level',
  'starfield.cfg.playerEntry': 'Player units will spawn in #{n} {name} ({q}, {r})',
  'starfield.cfg.playerEntryNone': 'Player unit entry sector: none (shown after Preview)',
  'starfield.cfg.previewTitle': 'Preview generation',
  'starfield.cfg.preview': 'Preview',
  'starfield.cfg.previewNone': 'Not previewed yet. Press Preview to compute with the current config and seed (pure function, no starfield created).',
  'starfield.cfg.previewError': 'Preview failed: {msg}',
  'starfield.cfg.previewTotal': 'Sectors {n} / cells inside circle {cells}',
  'starfield.cfg.previewBase': 'Radius {r} - duration {t} ticks (about {s}s)',
  'starfield.cfg.previewNoWarn': 'No warnings.',
  'starfield.cfg.ioTitle': 'Export / import (same JSON format as built-in configs)',
  'starfield.cfg.export': 'Export (currently edited config)',
  'starfield.cfg.import': 'Import (JSON file / clipboard)',
  'starfield.cfg.importBtn': 'Import',
  'starfield.cfg.copy': 'Copy to clipboard',
  'starfield.cfg.copied': 'Copied to clipboard.',
  'starfield.cfg.copyFail': 'Clipboard write failed: text selected, please copy manually.',
  'starfield.cfg.copyUnsupported': 'Clipboard unavailable: please use "Download JSON file" instead.',
  /* Export download (primary path) / import file + clipboard (with fallback hints) */
  'starfield.cfg.download': 'Download JSON file',
  'starfield.cfg.downloaded': 'Download started: {name}',
  'starfield.cfg.downloadFail': 'Download failed: {msg}; you can use "Copy to clipboard" instead.',
  'starfield.cfg.downloadUnsupported': 'Download unavailable: this browser does not support file download (Blob/URL); please use "Copy to clipboard" instead.',
  'starfield.cfg.importFile': 'Choose JSON file',
  'starfield.cfg.importFileHint': 'Only .json (same format as built-in config files); imported content goes through the same validation as "Enter starfield".',
  'starfield.cfg.importClipboard': 'Import from clipboard',
  'starfield.cfg.importClipboardFail': 'Reading the clipboard failed (or it is not JSON): please use "Choose JSON file" instead.',
  'starfield.cfg.importClipboardUnsupported': 'Clipboard reading unavailable: please use "Choose JSON file" instead.',
  'starfield.cfg.importReadFail': 'Reading the file failed: {msg}',
  'starfield.cfg.importFallbackHint': 'File picking and clipboard are both unavailable: paste JSON below and press Import.',
  'starfield.cfg.importParse': 'JSON parse error: {msg}',
  'starfield.cfg.importFail': 'Import failed (current edits unchanged):',
  'starfield.cfg.importOk': 'Imported successfully into the editor.',
  'starfield.cfg.enter': 'Enter starfield',
  'starfield.cfg.noErrors': 'Validation passed - ready to enter the starfield.',
  'starfield.cfg.errSeed': 'Invalid seed: letters/digits/underscore/hyphen only, 1-32 chars.',
  'starfield.cfg.errRadius': 'Radius must be an integer >= 1.',
  'starfield.cfg.errDuration': 'Duration (ticks) must be an integer >= 1.',
  'starfield.cfg.errCount': 'Invalid count range for "{name}": integers >= 0 with min <= max.',
  /* C-3b **full NPC list editor** (built-in read-only summary + **editable inline custom lists**):
   *   · inline lists live at the config root as `npcLists` (units[] **identical in shape** to `data/npcLists/*`);
   *   · id rule: must start with `custom:`, must not clash with a built-in id, must not repeat;
   *   · delete rule: a still-referenced list cannot be deleted silently (references are listed and can be removed first);
   *   · resolution: built-in -> inline -> error (`LS.starfieldData.resolveNpcList`). */
  'starfield.cfg.npcSection': 'NPC lists (built-in read-only summary / editable inline custom lists)',
  'starfield.cfg.npcSectionHint': 'Inline lists travel inside the same config JSON through the existing export/import and the same validation entry (no data/npcLists/* file required).',
  'starfield.cfg.npcBuiltinTitle': 'Built-in lists (read-only summary)',
  'starfield.cfg.npcInlineTitle': 'Inline lists (editable; id must be prefixed with custom:)',
  'starfield.cfg.npcInlineHint': 'Inline lists are exported/imported with the config; once referenced by a sector type candidate set they take part in generation (a built-in id of the same name wins).',
  'starfield.cfg.npcIdPrefixHint': 'id rule: must start with custom: (e.g. custom:l1) and must not clash with a built-in list id. To rename, edit the "id" field of that list below and press "Rename id" (references are updated too).',
  'starfield.cfg.npcCreate': 'New inline list',
  'starfield.cfg.npcCreateHint': 'Allocates an unused custom:lN id, then edit its unit entries',
  'starfield.cfg.npcNameLabel': 'List name',
  'starfield.cfg.npcIdLabel': 'id',
  'starfield.cfg.npcRename': 'Rename id',
  'starfield.cfg.npcRenameHint': 'Renaming also updates every reference (sector types and ally reinforcement lists); the id must still start with custom: and stay unique/non-builtin.',
  'starfield.cfg.npcRefs': 'Referenced by {n} place(s): {list}',
  'starfield.cfg.npcRefsNone': 'Not referenced by any candidate set (never used in generation)',
  'starfield.cfg.npcRefType': '{name} (candidate list)',
  'starfield.cfg.npcRefAlly': 'Ally reinforcement list (allyNpcListIds)',
  'starfield.cfg.npcDelete': 'Delete this list',
  'starfield.cfg.npcDeleteHint': 'All references must be cleared first (no silent de-referencing).',
  'starfield.cfg.npcDeleteBlocked': 'Still referenced by {n} place(s): {list}',
  'starfield.cfg.npcDeleteUnref': 'Remove from those references and delete',
  'starfield.cfg.npcDeleteUnrefHint': 'Drops this id from every candidate set listed above, then deletes the inline list',
  'starfield.cfg.npcDeleteCancel': 'Cancel delete',
  'starfield.cfg.npcInlineEmpty': 'No inline lists yet: use "New inline list" above (an inline list does not need a data/npcLists/* file).',
  'starfield.cfg.npcUnitsEmpty': 'This list has no unit entries (its sectors spawn no units).',
  'starfield.cfg.npcUnitAdd': 'Add unit entry',
  'starfield.cfg.npcUnitN': 'Entry #{n}',
  'starfield.cfg.npcUnitRemove': 'Remove this entry',
  'starfield.cfg.npcUnitShip': 'Ship',
  'starfield.cfg.npcUnitCount': 'Count',
  'starfield.cfg.npcUnitLevel': 'Level',
  'starfield.cfg.npcAddModule': 'Add module',
  'starfield.cfg.previewNpcInline': 'Inline lists: {n}',
  'starfield.cfg.previewNpcInlineNone': 'Inline lists: 0',
  'starfield.cfg.previewNpcInlineUsed': 'Referenced inline lists: {list}',
  'starfield.cfg.errNpcIdEmpty': 'Inline list id must not be empty.',
  'starfield.cfg.errNpcIdPrefix': 'Inline list id must start with custom: (e.g. custom:l1).',
  'starfield.cfg.errNpcIdBuiltin': 'Inline list id clashes with a built-in list: {id} (built-in wins, please rename).',
  'starfield.cfg.errNpcIdDup': 'Duplicate inline list id: {id}',
  'starfield.cfg.errNpcNameEmpty': 'Name of inline list "{id}" must not be empty.',
  'starfield.cfg.errNpcUnitCount': 'Entry {n} of "{name}": count must be an integer >= 1.',
  'starfield.cfg.errNpcLevel': 'Entry {n} of "{name}": level must be within 1 - {max}.',
  'starfield.cfg.errNpcModuleLevel': 'Entry {n} of "{name}": level of "{mod}" must be within 1 - {max}.',
  'starfield.map.status.running': 'Running',
  'starfield.map.status.finished': 'Time is up',
  'starfield.map.status.settled': 'Settled',
  'starfield.map.status.stopped': 'Stopped',
  /* Per-**sector** phase text: value = the container's read-only `sectors[].phase` (mapped as-is, never inferred) */
  'starfield.phase.idle': 'Idle',
  'starfield.phase.running': 'Running',
  'starfield.phase.settled': 'Settled',
  /* Cell details (shown by zoom level): a = allied alive, e = enemy alive, ore = reserve, cargo = item count */
  'starfield.cell.alive': 'A{a} · E{e}',
  'starfield.cell.oreCargo': 'Ore {ore} · Cargo {cargo}',
  /* Overflow hint for the in-cell alive-unit icon preview (icon cap = `ui/starfieldMapView.js CELL_ICON_MAX`) */
  'starfield.cell.moreAlive': '{n} more alive units not shown',
  /* Sidebar (this round = sector summary; C-2 mounts the full battle scene here) */
  'starfield.sidebar.title': 'Sector Summary',
  'starfield.sidebar.close': 'Close',
  'starfield.sidebar.index': 'Index',
  'starfield.sidebar.coord': 'Coordinates',
  'starfield.sidebar.type': 'Type',
  'starfield.sidebar.alive': 'Alive units',
  'starfield.sidebar.ore': 'Ore reserve',
  'starfield.sidebar.cargo': 'Cargo items',
  'starfield.sidebar.cd': 'Sector cooldown',
  'starfield.sidebar.logLines': 'Total log lines',
  'starfield.sidebar.phase': 'Status',
  'starfield.sidebar.none': 'None',
  'starfield.sidebar.stageTodo': 'The full battle scene will be mounted here in step C-2.',
  /* ★★ Inter-sector movement (stage-2 UI): drag a sidebar unit card onto a map cell to issue the move —
   * every failure `reason` maps 1:1 to the engine's single write entry `moveUnitTo` (UI never invents rules).
   * ★ Dropping onto the unit's own sector CANCELS the move (a success, not a failure) ⇒ `cancelled` notice. */
  'starfield.move.failed': 'Cannot move: {reason}',
  'starfield.move.cancelled': 'Move cancelled',
  'starfield.move.none': 'No such unit',
  'starfield.move.dead': 'That unit is destroyed',
  'starfield.move.owner': 'That unit is not under your command',
  'starfield.move.far': 'Blocked by the layout — unreachable',
  'starfield.move.invalid': 'No such sector',
  'starfield.move.finished': 'The starfield has ended — no more orders',
  /* Starfield configuration placeholder: entry into the map (C-1) */
  'starfield.config.enterMap': 'Enter Starfield (placeholder)',
  'starfield.config.mapHint': 'For now (C-1) you can open the read-only Starfield Map; if no starfield exists yet it is created with default config H1 + a random seed (proper configuration arrives in C-3).',

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
  // ★ Drone category — 5 new summon modules + 1 drone-exclusive module added this round
  //   (name keys are always `module.<id>`; `repairBeam` has `picker:false` so it never shows in the
  //   formation module picker)
  'module.repairDroneSpawn': 'Repair Drone',
  'module.bulwarkDroneSpawn': 'Bulwark Drone',
  'module.rocketDroneSpawn': 'Rocket Drone',
  'module.laserTurretSpawn': 'Laser Turret',
  'module.sentryTurretSpawn': 'Sentry Turret',
  // Drone · Nano Drone: carries a cannon + this very module (chained summoning); no shield / hp 50 /
  // energyRegen 20 / energyCap 500 / lifespan 400t
  'module.nanoDroneSpawn': 'Nano Drone',
  'module.repairBeam': 'Repair Beam', // Function · drone-exclusive (picker:false): active single ally (never self) heal hp_target, tag exact_amount
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
  'module.cargoTransfer': 'Cargo Transfer', // Transport · active, single ally target (tag cargo_transfer: hands over a whole loaded cargo)
  'module.cargoRepair': 'Cargo Repair', // Transport · active, single ally target incl. self (tag cargo_repair: spends a whole loaded cargo for hp_per_ton)
  'module.navThruster': 'Nav Thruster', // Transport · passive booster (own navigation coefficient nav_coeff_add → inter-sector travel engine cooldown)
  'module.oreHold': 'Ore Hold',
  'module.miningLaser': 'Mining Laser',
  'module.oreCompressor': 'Ore Compressor', // Mining · passive booster (own mining coefficient)
  'module.oreRepair': 'Ore Repair', // Mining · single ally target incl. self (spends own ore_cost to heal hp_target, raw value)
  'module.cargoEnhance': 'Cargo Enhancement', // Mining · single ally target incl. self (ore + energy → raise one not-yet-enhanced cargo's bonus by bonus_add; one-shot, permanent; tag cargo_enhance)
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
  // ★ Nav coefficient (`coefficients.nav`): same row style as the category coefficients above.
  'battle.coeff.nav': 'Nav coeff.',
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
  // ★ Removed with the total-cargo-cap removal: `battle.drill.warn.cargoOverflow`
  //   (the engine no longer emits that warning code — cargo entry count is unlimited)
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
  //     · trailing pad  spacer of the SAME WIDTH as the queue-number column (CSS only); it shows the
  //                     language-neutral `※` badge when the cargo has been enhanced (engine-derived
  //                     `cargo.enhanced`; the glyph is a JS constant, NOT an i18n key) and stays empty
  //                     otherwise ⇒ the chip width never changes.
  'battle.sector.cargoTitle': 'Sector Cargo',
  'battle.sector.cargoSeq': '{n}',
  'battle.sector.cargoBonus': '{v}%',
  'battle.sector.cargoLv': 'Lv{level}',
  'battle.sector.cargoMeta': '{tons}t · {load}s',
  'battle.sector.cargoHover': '{type}: {hint}',
  'battle.sector.cargoAddHint': 'Click to add to the priority queue',
  'battle.sector.cargoRemoveHint': 'Click to remove from the queue',
  'battle.sector.cargoLockedHint': 'Loading — about {s}s left', // Hover hint while locked by a loader; seconds = formatTickSeconds(need − elapsed); clicking does nothing
  // ★ Hover hint for cargo the PLAYER unloaded manually (engine-derived read-only `manualUnloaded` +
  //   `manualUnloadedTicks`): `{s}` = seconds left (engine-derived ticks → `core/tick.js
  //   formatTickSeconds`; the UI never computes expiry itself). Explains that this side's loaders will
  //   not auto-take it for now and that queueing it re-enables loading immediately.
  'battle.sector.cargoHoldHint': 'Manually unloaded — auto-loading skips it for {s}s (click to queue it again)',
  // ★ Hover text for the `※` "enhanced" badge (the glyph is a language-neutral JS constant, NOT an i18n
  //   key); attached to the trailing pad ONLY when `cargo.enhanced === true`.
  'battle.sector.cargoEnhanced': 'Enhanced',
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
  /* ★★ Navigation engine (unit inter-sector movement; stage-2 UI) — card bar + detail panel + queue mark.
   * ★ Every value/criterion comes from the container read-only `unitNav()` (remaining/stalled/queue).
   * ★ The nav coefficient is NOT here: it lives in the Unit Coefficients block (`battle.coeff.nav`). */
  'unit.nav': 'Nav engine',
  'unit.navReady': 'Ready',
  'unit.navRemain': '{s}s left',
  'unit.navStalled': 'No energy',
  'unit.navQueued': 'Queued for #{n}',
  'unit.navQueueMark': '⇥#{n}',
  'unit.navCd': 'Step cooldown {n}t',
  /* ★ The followed (selected) unit vanished while moving ⇒ collapse the detail with a short notice. */
  'starfield.follow.lost': 'The selected unit is no longer in the starfield',
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
  'battle.detail.statCargoTransfer': 'Transfers 1 cargo', // Cargo Transfer: moves a whole cargo (no numeric word ⇒ granularity only)
  'battle.detail.statHpPerTon': 'Heal {v}/ton', // Cargo Repair: `hp_per_ton` (raw word value, no category coeff; heal = tons × value)
  'battle.detail.statBonusAdd': 'Bonus {v}%', // Cargo Enhancement: `bonus_add` (raw word value, no category coeff; DELTA via formatBonusDeltaPercent, sign included ⇒ no `+` here)
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
  // ★ Cargo Transfer (`cargo_transfer`): low-frequency — 1 entry only when a whole cargo actually moved
  //   (`cargo` = the moved cargo's display name); at most 1 per module per tick; emitted at the step 3d-3
  //   landing site together with the numbers; owner/target colored, module always green, `cargo` plain text.
  'battle.log.cargoTransfer': "{owner}'s {module}: transferred {cargo} to {target}",
  // ★ Cargo Repair (`cargo_repair`): low-frequency — only when actual healing > 0 AND a cargo was really
  //   consumed this tick; `cargo` = the consumed cargo, `amount` = actual healing (hpMax-capped);
  //   owner/target colored, module always green; emitted at the step 4c healing site.
  'battle.log.cargoRepair': "{owner}'s {module}: consumed {cargo}, restored {amount} HP to {target}",
  // ★ Cargo Enhancement (`cargo_enhance`): low-frequency — 1 entry only when the write really happened
  //   (that cargo was enhanced this tick); at most 1 per module per tick (single target, one cargo);
  //   emitted at the step 3d-5 landing site together with the numbers; `cargo` = the enhanced cargo's
  //   display name (same naming source as the UI chip), `v` = bonus_add as a percentage increment
  //   (sole conversion `core/utils.js formatBonusDeltaPercent`: DELTA semantics, sign included in the
  //   string ⇒ the template must NOT add `+`, or it would render `++10%`); owner colored, module green.
  'battle.log.cargoEnhance': "{owner}'s {module}: enhanced {cargo} (bonus {v}%)",
  // ★ Cargo load complete (`cargo_loader`, settlement step 5): low-frequency — exactly 1 entry only when
  //   cargo actually lands (sole landing point `landCargoOn`; at most 1 per module per tick); emitted at
  //   the landing site together with the numbers (numbers first, then the sentence); `cargo` = the cargo's
  //   display name (same naming source as the UI chip), owner colored, module always green.
  'battle.log.cargoLoad': "{owner}'s {module}: loaded {cargo}",
  // ★ Unload back to the sector (player clicks a chip in the unit detail panel): low-frequency — exactly
  //   1 entry per effective click; the action is driven by the UI BETWEEN ticks ⇒ emitted immediately,
  //   never queued in `__pending`; `{ok:false}` clicks are not logged and a repeat click produces no
  //   second entry (the cargo is no longer aboard ⇒ idempotent); `cargo` = display name, owner colored
  //   (no module segment).
  'battle.log.cargoUnload': '{owner}: unloaded {cargo} to the sector',
  'battle.result.close': 'Dismiss',
};
