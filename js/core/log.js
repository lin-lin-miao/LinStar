/* ===== core/log.js —— 事件/战斗日志 =====
 * 环形保留最近 MAX 条；同步输出到控制台并广播 'log' 事件，
 * 战斗 UI（M1）与调试面板可订阅展示。
 */
import { bus } from './eventBus.js';

const MAX = 500;
const lines = [];

export const log = {
  get lines() { return lines; },

  add(msg, kind = 'info') {
    const line = { t: Date.now(), kind, msg: String(msg) };
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

export default log;
