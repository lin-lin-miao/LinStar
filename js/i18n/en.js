/* ===== i18n/en.js —— 英文词条（骨架占位，M6 补齐） =====
 * 缺失词条会自动回退到 zh-CN（见 i18n/index.js）。
 */
export default {
  /* brand / common */
  'brand': 'LinStar',

  /* HUD */
  'hud.tick': 'tick {n}',
  'hud.pause': 'Pause',
  'hud.resume': 'Resume',
  'hud.speed': 'Speed x{n}',
  'hud.export': 'Export Save',
  'hud.import': 'Import Save',
  'hud.lang': 'Language',

  /* Main menu */
  'menu.title': 'LinStar',
  'menu.subtitle': 'A space idle / turn-based web game',
  'menu.start': 'Start Game',
  'menu.hint': 'Save: use Export / Import in the top bar',

  /* Battle placeholder (replaced in M1) */
  'battle.placeholder.title': 'Battle Scene (WIP)',
  'battle.placeholder.body': 'M1 will deliver the first demo: combat ship, cannon module, regenerative shield module.',
  'battle.back': 'Back to Menu',

  /* Save */
  'save.exported': 'Save exported',
  'save.imported': 'Save imported successfully',
  'save.importError': 'Failed to import save: {err}',
  'save.unavailable': 'Local storage unavailable (private/restricted mode); manual export/import still works.',
};
