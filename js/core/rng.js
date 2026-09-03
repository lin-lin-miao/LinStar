/* ===== core/rng.js —— 随机数（可播种，便于复现测试） =====
 * M0 提供默认 Math.random 与 mulberry32 播种生成器；
 * 战斗伤害等随机在 M1 起按需切换为可播种流。
 */

/** mulberry32：极简 32 位播种 PRNG，返回 () => [0,1) */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 当前默认随机源（后续可整体替换为可播种流） */
export const random = () => Math.random();

/** [min, max] 整数（含两端） */
export function int(min, max, rng = random) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/** [min, max) 浮点 */
export function float(min, max, rng = random) {
  return rng() * (max - min) + min;
}

/** 概率命中 */
export function chance(p, rng = random) {
  return rng() < p;
}
