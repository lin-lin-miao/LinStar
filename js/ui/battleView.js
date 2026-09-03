/* ===== ui/battleView.js —— 战斗屏（M0 占位，M1 替换为真实对战场景） ===== */
import { el } from '../core/utils.js';
import { i18n } from '../i18n/index.js';
import { router } from './router.js';

function root() {
  return el('section', { class: 'screen screen-placeholder' }, [
    el('div', { class: 'panel-placeholder' }, [
      el('h2', { text: i18n.t('battle.placeholder.title') }),
      el('p', { text: i18n.t('battle.placeholder.body') }),
      el('button', {
        class: 'btn primary',
        text: i18n.t('battle.back'),
        onclick: () => router.show('menu'),
      }),
    ]),
  ]);
}

export const battleView = {
  root,
};

export default battleView;
