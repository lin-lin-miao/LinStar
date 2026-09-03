/* ===== ui/hud.js —— 顶栏：品牌 / tick / 暂停 / 倍速 / 语言 / 导出 / 导入 =====
 * tick 数字高频更新（仅改 textContent），其余控件在状态变化时整体重建。
 */
import { el } from '../core/utils.js';
import { bus } from '../core/eventBus.js';
import { ticker } from '../core/tick.js';
import { i18n } from '../i18n/index.js';
import { save } from '../systems/save.js';
import { log } from '../core/log.js';

const SPEEDS = [1, 2, 4];

let rootEl = null;
let tickEl = null;
let fileInput = null;

function tickLabel() {
  return ticker.running ? i18n.t('hud.pause') : i18n.t('hud.resume');
}

function onExport() {
  save.export();
  log.info(i18n.t('save.exported'));
}

function onImportClick() {
  fileInput?.click();
}

function build() {
  tickEl = el('span', { class: 'hud-tick', text: i18n.t('hud.tick', { n: ticker.count }) });

  const pauseBtn = el('button', {
    class: 'btn small',
    text: tickLabel(),
    onclick: () => ticker.toggle(),
  });

  const speedBtn = el('button', {
    class: 'btn small',
    text: i18n.t('hud.speed', { n: ticker.speed }),
    onclick: () => {
      const idx = (SPEEDS.indexOf(ticker.speed) + 1) % SPEEDS.length;
      ticker.setSpeed(SPEEDS[idx]);
    },
  });

  const langSelect = el(
    'select',
    {
      class: 'langs',
      'aria-label': i18n.t('hud.lang'),
      onchange: (ev) => i18n.set(ev.target.value),
    },
    i18n.locales.map((loc) =>
      el('option', { value: loc, text: loc === 'zh-CN' ? '中文' : 'English', selected: loc === i18n.locale ? '' : null })
    )
  );

  return [
    el('span', { class: 'brand', text: i18n.t('brand') }),
    el('span', { class: 'hud-spacer' }),
    tickEl,
    pauseBtn,
    speedBtn,
    langSelect,
    el('button', { class: 'btn small', text: i18n.t('hud.export'), onclick: onExport }),
    el('button', { class: 'btn small', text: i18n.t('hud.import'), onclick: onImportClick }),
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

    // tick 计数器高频更新（只改文本，不重建 DOM）
    bus.on('tick', () => {
      if (tickEl) tickEl.textContent = i18n.t('hud.tick', { n: ticker.count });
    });
    bus.on('ticker:state', () => this.refresh());
    bus.on('i18n:changed', () => this.refresh());

    this.refresh();
  },

  /** 重建全部控件（语言/暂停/倍速变化时调用） */
  refresh() {
    if (!rootEl) return;
    const nodes = build();
    rootEl.replaceChildren(fileInput, ...nodes);
  },
};

export default hud;
