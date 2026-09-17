/* ===== core/rng.js —— 确定性随机数工具（可播种 PRNG · 星域生成的唯一随机源） =====
 * 用途：**星域（大地图）生成**的唯一随机口径 —— 同一「配置 + 种子」⇒ **完全相同的星域**（可复现、
 *   可分享、可存档还原）。本文件提供 **纯函数式、无模块级可变全局状态** 的 RNG 实例工厂。
 *
 * ★ 确定性保证（用户口径 / 设计文档 §4、§10 A-1）：
 *   1. **算法确定**：核心＝**mulberry32**（32 位整数运算，只用到 `|0` / `Math.imul` / `>>>`，
 *      **无浮点累加、无环境相关行为**）⇒ 同一 JS 引擎版本下逐位可复现（跨浏览器一致）；
 *   2. **种子派生确定**：`hashSeed(seed)`＝**FNV-1a 32 位**哈希 `String(seed)`；
 *      ★ **数字与字符串走同一路径**（`hashSeed(7) === hashSeed('7')`）⇒ 界面输入 "7" 与配置写 `7`
 *      得到同一星域（不制造两套种子语义）；
 *   3. **无隐式随机源**：**本文件内 `Math.random()` 只出现在 `randomSeed()` 一处**（见下），
 *      且 **不使用 `Date`/时间戳**；生成过程中**禁止**调用它（生成只能来自 `createRng(seed)`）；
 *   4. **实例独立**：所有状态都在闭包内（`createRng()` 各自独立）⇒ 复现只取决于「种子 + 调用序列」；
 *   5. **抽样消耗规则**（写死、可预期）：`nextU32`/`nextFloat` 每次恒消耗 1 次；`nextInt`/`pickOne`/
 *      `pickWeighted`/`shuffle` **只在确实需要随机选择时才消耗**（退化输入 ⇒ 返回确定的退化结果且
 *      **不消耗**，见各函数注释）⇒ 序列位置只取决于「有效调用次数」，便于对拍复现。
 *
 * ★ 对外口径（本轮只落地工具，**不接入任何生成逻辑**，接入属步骤 A-5）：
 *   `createRng(seed)` ⇒ `{ seed, seedU32, nextU32, nextFloat, nextInt, pickOne, pickWeighted, shuffle, fork }`
 *   `randomSeed()`    ⇒ 默认随机种子（**唯一允许的非确定性入口**，仅“星域配置界面”未输入时调用一次）
 *   `hashSeed(seed)`  ⇒ 种子 → uint32（导出口径，便于打印/对拍）
 *   `rngSelfTest()`   ⇒ 最小自测（确定性断言，**不依赖任何外部随机**）——见文件末
 *
 * ★ 最小自测（两种方式，任选其一）：
 *   ① 控制台：`LS.rng.selfTest()`（`main.js` 的 `window.LS` 已挂本模块）⇒ 返回 `{ pass, checks[] }`，
 *      `pass:true` ＝ 全部通过；`checks[i].detail` 给出对拍值（同种子两次应完全相同的 uint32 序列）。
 *   ② 手工对拍：`const a = LS.rng.create('demo'), b = LS.rng.create('demo');`
 *      ⇒ `a.nextU32() === b.nextU32()` 恒为 `true`（换 `'demo2'` 应不同；`a.nextInt(1,6)` ∈ [1,6]）。
 */

/** ★ **mulberry32 单步核心（uint32）**——**唯一实现**，供 `mulberry32` 与 `createRng` 共用。
 *  · 逐位等价于既有 `mulberry32`（种子按 uint32 直接使用、**不哈希**）；
 *  · 返回 `[0, 2^32)` 的无符号整数；调用一次＝推进流一次。 */
function makeU32Stream(seedU32) {
  let a = seedU32 >>> 0;
  return function nextU32() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** mulberry32：极简 32 位播种 PRNG，返回 `() => [0,1)`（**保留既有导出与逐位行为**：
 *  种子按 uint32 直接使用，**不经 `hashSeed`** ⇒ 老调用方零回归；新代码请用 `createRng()`）。 */
export function mulberry32(seed) {
  const nextU32 = makeU32Stream(seed >>> 0);
  return function next() {
    return nextU32() / 4294967296;
  };
}

/** 字符串/数字种子 ⇒ **uint32**（FNV-1a 32 位；数字按十进制字符串参与哈希 ⇒ `hashSeed(7) === hashSeed('7')`）。
 *  · 纯函数、无状态；空种子（`null`/`undefined`/`''`）⇒ 哈希空串（**确定**，不是随机）。 */
export function hashSeed(seed) {
  const s = seed == null ? '' : String(seed);
  let h = 0x811c9dc5; // FNV-1a offset basis
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime（32 位乘法，取模由 Math.imul 保证）
  }
  return h >>> 0;
}

/** ★ 创建一个**独立**的确定性 RNG 实例。
 *  @param {string|number} seed 种子（字符串/数字等价口径见 `hashSeed`）
 *  @returns {{
 *    seed: string, seedU32: number,
 *    nextU32(): number, nextFloat(): number,
 *    nextInt(min: number, maxInclusive: number): number,
 *    pickOne(arr: any[]): any,
 *    pickWeighted(items: any[], weightOf?: any): any,
 *    shuffle(arr: any[]): any[],
 *    fork(label: string): object
 *  }}
 *  · **纯函数式**：实例各自持有闭包状态，互不影响；同一实例按同一调用序列 ⇒ 同一结果；
 *  · 所有方法**不修改入参**（`shuffle` 返回新数组）。 */
export function createRng(seed) {
  const seedStr = seed == null ? '' : String(seed);
  const seedU32 = hashSeed(seedStr);
  const nextU32 = makeU32Stream(seedU32);

  /** `[0,1)` —— 与 `nextU32` **同一条流**（`nextU32()/2^32`，不额外推进） */
  const nextFloat = () => nextU32() / 4294967296;

  return {
    seed: seedStr,
    seedU32,

    nextU32,

    nextFloat,

    /** `[min, max]` **整数（含两端）**；min/max 顺序颠倒会自动交换、非整数会向区间内取整。
     *  · **退化区间**（取整后 `hi <= lo`）⇒ 直接返回该值且**不消耗抽样**（见文件头“抽样消耗规则”）；
     *  · 实现＝`lo + floor(nextFloat() × 跨度)`（不用取模 ⇒ **无模偏差**）；
     *  · 跨度建议 ≤ 2^32（超出时浮点精度受限，实际用量远小于此）。 */
    nextInt(minInclusive, maxInclusive) {
      const lo = Math.ceil(Math.min(minInclusive, maxInclusive));
      const hi = Math.floor(Math.max(minInclusive, maxInclusive));
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return Number.isFinite(lo) ? lo : 0;
      const span = hi - lo + 1;
      return lo + Math.floor(nextFloat() * span);
    },

    /** 等概率取一项；**空数组 ⇒ `null` 且不消耗抽样**；不修改入参。 */
    pickOne(arr) {
      const list = Array.isArray(arr) ? arr : [];
      if (!list.length) return null;
      return list[Math.floor(nextFloat() * list.length)];
    },

    /** 按权重取一项（**加权随机**）：
     *  @param items    候选项数组
     *  @param weightOf 权重来源：**函数** `(item, index) => number` 或 **等长数组**；缺省＝等权（※ 等权时
     *                  请直接用 `pickOne`）。**非正/非有限权重按 0 处理**（权重项可为 0 ⇒ 永不选中）。
     *  · 空数组、或**总权重 ≤ 0** ⇒ 返回 `null` 且**不消耗抽样**；其余情况恒消耗 **1 次**；
     *  · 实现＝前缀累减（线性、确定性）；浮点兜底返回最后一项（同样确定）。 */
    pickWeighted(items, weightOf = 1) {
      const list = Array.isArray(items) ? items : [];
      if (!list.length) return null;
      const w = (item, i) => {
        const v = typeof weightOf === 'function' ? weightOf(item, i) : Array.isArray(weightOf) ? weightOf[i] : weightOf;
        return Number.isFinite(v) && v > 0 ? v : 0;
      };
      let total = 0;
      for (let i = 0; i < list.length; i += 1) total += w(list[i], i);
      if (!(total > 0)) return null;
      let r = nextFloat() * total;
      for (let i = 0; i < list.length; i += 1) {
        r -= w(list[i], i);
        if (r < 0) return list[i];
      }
      return list[list.length - 1];
    },

    /** Fisher–Yates 洗牌：**返回新数组**（不改入参）；长度 ≤ 1 ⇒ 原样返回（新数组）且**不消耗抽样**。 */
    shuffle(arr) {
      const out = Array.isArray(arr) ? arr.slice() : [];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(nextFloat() * (i + 1));
        const t = out[i];
        out[i] = out[j];
        out[j] = t;
      }
      return out;
    },

    /** **派生子流**：子流种子＝`父种子 + '/' + label`（再走 `hashSeed`）⇒
     *  · **确定性**：同 `(父种子, label)` ⇒ 同子流；
     *  · **独立**：**不消耗父流抽样**，且**与父流已抽次数无关**（父流抽多抽少都不改子流）
     *    ⇒ 各子系统可用固定标签取独立流（如 `fork('sector:3')`：单改一处不影响它处、便于分区对拍复现）；
     *  · 可层层派生（路径累加：`a/b/c`）。 */
    fork(label) {
      return createRng(`${seedStr}/${label == null ? '' : String(label)}`);
    },
  };
}

/** ★★ **唯一允许的非确定性入口**（设计文档 §4：随机源**只用于产生初始种子那一步**）：
 *  产生一个**默认随机种子** —— 仅由「星域配置界面」在玩家**未输入种子**时调用**一次**，
 *  随后**全程只用 `createRng(该种子)`**（生成、布局、NPC 展开等一律不得再取随机）。
 *  · 实现＝`Math.random()` 取 32 位 ⇒ **8 位十六进制小写字符串**（如 `'3f9a1c07'`）：
 *    短、可显示、可手输、可分享 ⇒ 同串重开即得**同一星域**；
 *  · **不引入 `Date`/时间戳**（避免第二套非确定性来源）；本文件内 `Math.random()` **仅此一处**。 */
export function randomSeed() {
  return Math.floor(Math.random() * 4294967296)
    .toString(16)
    .padStart(8, '0');
}

/** ★ **最小自测**（全部为**确定性断言**，不依赖外部随机；可在控制台直接跑 `LS.rng.selfTest()`）。
 *  @returns {{ pass: boolean, checks: {name:string, pass:boolean, detail?:string}[] }} */
export function rngSelfTest() {
  const checks = [];
  const listEq = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
  const add = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });

  // ① 同种子 ⇒ 同序列（这是“同配置同种子 ⇒ 同星域”的根）
  const a = createRng('h1-demo');
  const b = createRng('h1-demo');
  const seqA = [a.nextU32(), a.nextU32(), a.nextU32()];
  const seqB = [b.nextU32(), b.nextU32(), b.nextU32()];
  add('同种子 ⇒ 同序列', listEq(seqA, seqB), seqA.join(','));

  // ② 不同种子 ⇒ 序列不同（比 3 个值 ⇒ 碰撞概率 ~2^-96，可视为恒真）
  const other = createRng('h1-demo-2');
  add('不同种子 ⇒ 不同序列', !listEq([other.nextU32(), other.nextU32(), other.nextU32()], seqA));

  // ③ 数字/字符串种子同一口径
  add('hashSeed(7) === hashSeed("7")', hashSeed(7) === hashSeed('7'), String(hashSeed(7)));

  // ④ fork 独立：父流抽多少次都不影响子流
  const childA = createRng('seed-x').fork('sector:3');
  const p = createRng('seed-x');
  p.nextU32();
  p.nextU32();
  const childB = p.fork('sector:3');
  add('fork 与父流已抽次数无关', childA.nextU32() === childB.nextU32());

  // ⑤ nextInt 恒落在闭区间内
  const r = createRng('range');
  let inRange = true;
  for (let i = 0; i < 200; i += 1) {
    const v = r.nextInt(3, 7);
    if (v < 3 || v > 7) inRange = false;
  }
  add('nextInt 恒落在 [min,max]', inRange);

  // ⑥ 退化输入不消耗抽样（nextInt 单点 / pickOne 空数组）
  const d1 = createRng('deg');
  d1.nextInt(5, 5);
  const d2 = createRng('deg');
  const d3 = createRng('deg');
  d3.pickOne([]);
  add('退化输入不消耗抽样', d1.nextU32() === d2.nextU32() && d3.nextU32() === d2.nextU32());

  // ⑦ shuffle 保内容、不改入参、同种子同结果
  const src = [1, 2, 3, 4, 5];
  const sh1 = createRng('sh').shuffle(src);
  const sh2 = createRng('sh').shuffle(src);
  add(
    'shuffle 保内容/不改入参/同种子同结果',
    listEq([...sh1].sort((x, y) => x - y), src) && listEq(src, [1, 2, 3, 4, 5]) && listEq(sh1, sh2),
    sh1.join(',')
  );

  // ⑧ pickWeighted：零权重项永不被选中
  const w = createRng('weight');
  let neverZero = true;
  for (let i = 0; i < 100; i += 1) {
    if (w.pickWeighted(['a', 'b', 'c'], [1, 1, 0]) === 'c') neverZero = false;
  }
  add('pickWeighted 零权重项不被选中', neverZero);

  // ⑨ randomSeed 形状（8 位十六进制小写；此处调用是**允许**的唯一非确定性入口）
  add('randomSeed 为 8 位十六进制', /^[0-9a-f]{8}$/.test(randomSeed()));

  return { pass: checks.every((c) => c.pass), checks };
}
