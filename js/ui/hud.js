/* ===== ui/hud.js —— 顶栏：品牌 / tick/s / 战斗控件 / 语言 / 导出 / 导入 =====
 * - tick 区域显示实测每秒 tick（tick/s，M0 修正），高频更新仅改 textContent；
 * - 暂停/调速按钮仅在战斗中显示（正常界面隐藏）；
 * - 战斗中导出/导入按钮禁用（保存节点在结算完成后自动落档）。
 */
import { el } from '../core/utils.js';
import { bus } from '../core/eventBus.js';
import { ticker } from '../core/tick.js';
import { i18n } from '../i18n/index.js';
import { save } from '../systems/save.js';
import { log } from '../core/log.js';

const SPEEDS = [0.25, 0.5, 1, 2, 4]; // 可轮换的速度档（含慢速 0.25x/0.5x）

let rootEl = null;
let tickEl = null;
let combatControlsEl = null;
let fileInput = null;
let combatActive = false;

function tpsLabel() {
  return i18n.t('hud.tps', { n: ticker.tps });
}

function onExport() {
  const ok = save.export();
  if (ok) log.info(i18n.t('save.exported'));
}

function onImportClick() {
  if (combatActive) return;
  fileInput?.click();
}

function build() {
  tickEl = el('span', { class: 'hud-tick', text: tpsLabel(), title: i18n.t('hud.tpsTip') });

  // —— 战斗专属控件（暂停 / 逐帧 / 倍速），仅战斗中显示 ——
  const pauseBtn = el('button', {
    class: 'btn small',
    text: ticker.running ? i18n.t('hud.pause') : i18n.t('hud.resume'),
    onclick: () => ticker.toggle(),
  });

  // 逐帧：暂停状态下点击推进一帧（运行中禁用）
  const stepBtn = el('button', {
    class: 'btn small',
    text: i18n.t('hud.step'),
    title: i18n.t('hud.stepTip'),
    disabled: ticker.running ? 'disabled' : null,
    onclick: () => ticker.step(),
  });

  const speedBtn = el('button', {
    class: 'btn small',
    text: i18n.t('hud.speed', { n: ticker.speed }),
    onclick: () => {
      const idx = (SPEEDS.indexOf(ticker.speed) + 1) % SPEEDS.length;
      ticker.setSpeed(SPEEDS[idx]);
    },
  });

  combatControlsEl = el('span', {
    class: 'hud-combat-controls',
    style: combatActive ? '' : 'display:none',
  }, [pauseBtn, stepBtn, speedBtn]);

  // —— 全局控件 ——
  const langSelect = el(
    'select',
    {
      class: 'langs',
      'aria-label': i18n.t('hud.lang'),
      onchange: (ev) => i18n.set(ev.target.value),
    },
    i18n.locales.map((loc) =>
      el('option', {
        value: loc,
        text: loc === 'zh-CN' ? '中文' : 'English',
        selected: loc === i18n.locale ? '' : null,
      })
    )
  );

  const exportBtn = el('button', {
    class: 'btn small',
    text: i18n.t('hud.export'),
    onclick: onExport,
    disabled: combatActive ? 'disabled' : null,
    title: combatActive ? i18n.t('save.busy') : '',
  });

  const importBtn = el('button', {
    class: 'btn small',
    text: i18n.t('hud.import'),
    onclick: onImportClick,
    disabled: combatActive ? 'disabled' : null,
    title: combatActive ? i18n.t('save.busy') : '',
  });

  return [
    el('span', { class: 'brand', text: i18n.t('brand') }),
    el('span', { class: 'hud-spacer' }),
    tickEl,
    combatControlsEl,
    langSelect,
    exportBtn,
    importBtn,
  ];
}

export const hud = {
  /** 挂载到 <header id="app-header"> */
  mount(headerEl) {
    rootEl = headerEl;

    fileInput = el('input', {
      type: 'file',
      accept: '.json,application/json',
      style: 'display:none',
    });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (file) save.importFile(file);
      fileInput.value = '';
    });

    // tick/s 高频更新（只改文本，不重建 DOM）
    bus.on('tick', () => {
      if (tickEl) tickEl.textContent = tpsLabel();
    });
    bus.on('ticker:state', () => this.refresh());
    bus.on('i18n:changed', () => this.refresh());
    // 战斗状态：战斗中显示暂停/调速并禁用存档按钮；结束自动落档（save.js 处理）
    bus.on('combat:state', ({ active } = {}) => {
      combatActive = Boolean(active);
      this.refresh();
    });

    this.refresh();
  },

  /** 重建全部控件（语言/暂停/倍速/战斗状态变化时调用） */
  refresh() {
    if (!rootEl) return;
    const nodes = build();
    rootEl.replaceChildren(fileInput, ...nodes);
  },
};

export default hud;
