/* ===== i18n/index.js —— 词条查询与语言切换 =====
 * 词条表为扁平结构，key 形如 'menu.start'（不做嵌套路径解析）。
 * 用法：i18n.t('menu.start') / i18n.t('hud.tps', { n: 20 })
 * 回退链：当前语言 -> zh-CN -> '??key'（便于发现缺词）。
 * 切换语言广播 'i18n:changed'，UI 层据此重绘。
 */
import { bus } from '../core/eventBus.js';
import zhCN from './zh-CN.js';
import en from './en.js';

const DICTS = {
  'zh-CN': zhCN,
  en,
};

let current = 'zh-CN';

function fillParams(text, params) {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

export const i18n = {
  get locale() { return current; },
  get locales() { return Object.keys(DICTS); },

  /** 设置当前语言；不存在时忽略。返回是否成功 */
  set(locale) {
    if (!DICTS[locale] || locale === current) return false;
    current = locale;
    bus.emit('i18n:changed', { locale: current });
    return true;
  },

  /** 查询词条（支持 {param} 插值），自动回退 zh-CN */
  t(key, params) {
    let text = DICTS[current][key];
    if (text === undefined) text = DICTS['zh-CN'][key];
    if (text === undefined) return `??${key}`;
    return fillParams(text, params);
  },
};

export default i18n;
