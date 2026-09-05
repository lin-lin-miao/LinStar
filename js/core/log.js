/* ===== core/log.js —— 事件/战斗日志 =====
 * 环形保留最近 MAX 条；同步输出到控制台并广播 'log' 事件，
 * 战斗 UI（M1）与调试面板可订阅展示。
 *
 * rich：可选，某行需要“分段着色”时的着色段数组（如敌方名红/我方名蓝）。
 * 每段为 普通文本字符串 或 { label, side:'ally'|'enemy' }（渲染层据此包上颜色 span）。
 * 控制台/导出仍用拼接好的纯文本 msg。
 */
import { bus } from './eventBus.js';
import { i18n } from '../i18n/index.js';

const MAX = 500;
const lines = [];

export const log = {
  get lines() { return lines; },

  add(msg, kind = 'info', rich) {
    const line = { t: Date.now(), kind, msg: String(msg), rich: rich || null };
    lines.push(line);
    if (lines.length > MAX) lines.shift();
    // eslint-disable-next-line no-console
    console.log(`[LinStar:${kind}] ${line.msg}`);
    bus.emit('log', line);
    return line;
  },

  info(msg) { return this.add(msg, 'info'); },
  warn(msg) { return this.add(msg, 'warn'); },
  error(msg) { return this.add(msg, 'error'); },

  clear() {
    lines.length = 0;
    bus.emit('log:cleared');
  },

  dump() {
    return lines.map((l) => `[${new Date(l.t).toISOString()}] ${l.kind}: ${l.msg}`).join('\n');
  },
};

/** 把 i18n 模板串按 {占位符} 拆段；colorKeys 里指定为“着色单位名”的参数，
 * 其值应为 { side:'ally'|'enemy', label:'显示名' }，段里标记 side 供渲染上色。
 * 返回 { msg: 纯文本, rich: 着色段数组 }。 */
export function formatRich(key, params, colorKeys) {
  const text = i18n.t(key);
  const colorSet = new Set(colorKeys || []);
  let msg = '';
  const rich = [];
  const push = (s) => {
    if (!s) return;
    msg += s;
    rich.push(s);
  };
  const re = /\{(\w+)\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    push(text.slice(last, m.index));
    last = re.lastIndex;
    const k = m[1];
    const v = params ? params[k] : undefined;
    if (colorSet.has(k) && v && typeof v === 'object' && v.side) {
      msg += v.label;
      rich.push({ label: v.label, side: v.side });
    } else {
      const s = v === undefined ? m[0] : String(v);
      msg += s;
      rich.push(s);
    }
  }
  push(text.slice(last));
  return { msg, rich };
}

export default log;
