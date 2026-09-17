/* ===== ui/menuView.js —— 主菜单 ===== */
import { el } from '../core/utils.js';
import { i18n } from '../i18n/index.js';
import { save } from '../systems/save.js';
import { router } from './router.js';

function root() {
  const storageNotice = save.storageAvailable
    ? null
    : el('div', { class: 'notice', text: i18n.t('save.unavailable') });

  return el('section', { class: 'screen screen-menu' }, [
    el('h1', { text: i18n.t('menu.title') }),
    el('p', { class: 'subtitle', text: i18n.t('menu.subtitle') }),
    el('button', {
      class: 'btn primary',
      text: i18n.t('menu.start'),
      // ★ S0-1：原「编队配置（单星区模拟）」入口位置改为「**星域配置界面**」（本轮为占位页，C-3 正式实装）；
      //   编队界面**不再有界面入口**，改用控制台指令 `LS.drill()`（见 `js/main.js`）；
      //   编队界面本身与开战流程**零改动**（仍走 `setupView` + 唯一开战入口 `enterBattle`）。
      onclick: () => router.show('starfield'),
    }),
    storageNotice,
    el('div', { class: 'hint', text: i18n.t('menu.hint') }),
  ]);
}

export const menuView = {
  root,
};

export default menuView;
