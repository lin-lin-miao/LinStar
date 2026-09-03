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
      onclick: () => router.show('battle'),
    }),
    storageNotice,
    el('div', { class: 'hint', text: i18n.t('menu.hint') }),
  ]);
}

export const menuView = {
  root,
};

export default menuView;
