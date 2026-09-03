/* ===== core/tick.js —— 游戏刻主循环 =====
 * 1 秒 = 20 tick（TICK_MS = 50ms），与《我的世界》一致。
 * 采用固定步长累加器：定时器以 50ms 固定频率触发，按 speed 倍率累加应走的时间，
 * 每满 50ms 结算 1 tick。暂停时只停累加，不销毁定时器。
 */
import { bus } from './eventBus.js';

const TICK_MS = 50;           // 每 tick 的毫秒数（20 tps）
const SPEED_MIN = 1;
const SPEED_MAX = 8;

let acc = 0;                  // 累加器（毫秒）
let count = 0;                // 已走过的 tick 数
let speed = 1;
let running = true;
let timer = null;

function emitState() {
  bus.emit('ticker:state', { running, speed, count });
}

function pump() {
  if (!running) return;
  acc += TICK_MS * speed;
  while (acc >= TICK_MS) {
    acc -= TICK_MS;
    count += 1;
    bus.emit('tick', count);
  }
}

export const ticker = {
  get count() { return count; },
  get speed() { return speed; },
  get running() { return running; },

  start() {
    if (!timer) timer = setInterval(pump, TICK_MS);
  },

  pause() {
    if (!running) return;
    running = false;
    acc = 0;
    emitState();
  },

  resume() {
    if (running) return;
    running = true;
    emitState();
  },

  toggle() { running ? this.pause() : this.resume(); },

  setSpeed(v) {
    const n = Math.max(SPEED_MIN, Math.min(SPEED_MAX, Number(v) || 1));
    if (n === speed) return;
    speed = n;
    emitState();
  },

  /** 仅供测试：重置计数 */
  reset() {
    count = 0;
    acc = 0;
    emitState();
  },
};
