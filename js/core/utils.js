/* ===== core/utils.js —— 通用纯函数工具 ===== */

/** document.querySelector 简写 */
export const $ = (sel, root = document) => root.querySelector(sel);

/** document.querySelectorAll 简写（返回数组） */
export function $$(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

/**
 * 创建元素：
 * el('div', { class: 'x', text: '你好', onclick: fn, dataset: {...}, style: '...' }, [children])
 * `children`（第三参，**可省略**）接受形态 —— **全部视为合法，任何数据状态下都不抛错**：
 *   · `Array`（可**任意嵌套**，元素可以是下述任意形态）；
 *   · **单个 `Node`**（等价于 `[node]` ⇒ 直接挂上）；
 *   · **单个 `string` / `number`**（等价于 `[value]` ⇒ 生成**一个**文本节点）；
 *   · `null` / `undefined` / `false` ⇒ **视作没有子节点**（跳过；典型来自 `cond && el(...)` 的假值分支）；
 *   · 其它**可迭代**对象（`NodeList` / `Set` / `HTMLCollection`…）⇒ 逐个展开（同数组口径）；
 *   · 其它任何值（普通对象、`true`、函数…）⇒ 退化为**一个文本节点** `String(value)`
 *     （与历史行为一致：数组里出现这些值时本来就是 `String(child)` 成文本）。
 * ★ **纯放宽**：不改任何既有语义与返回值 —— 数组/嵌套数组/`Node`/字符串的渲染结果逐字不变，
 *   只把"非可迭代 children ⇒ `TypeError: children is not iterable`"改判为"按单元素/空处理"。
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node.setAttribute(key, String(value));
    }
  }
  appendChildren(node, children);
  return node;
}

/** ★ **子节点挂载（唯一实现；容忍一切 children 形态）** —— 与 `el()` 的第三参同口径：
 *  · 空/假值（`null` / `undefined` / `false`）⇒ **什么都不做**（不抛错）；
 *  · 单个 `Node` ⇒ 直接 `append`；单个 `string` / `number` ⇒ **一个**文本节点；
 *  · 可迭代（数组 / `NodeList` / `Set`…）⇒ 逐个递归（嵌套数组照旧摊平）；
 *  · 其它值 ⇒ `String(value)` 文本节点（历史行为）。
 *  ★ 本函数是"渲染不因数据为空而崩"的**兜底点**：任何视图把 `undefined`、`false`、
 *    一个节点、一个字符串误当 children 传入，都只会**少渲染/正常渲染**，绝不抛 `TypeError`。 */
function appendChildren(node, children) {
  // ① 空值 / 假值 ⇒ 无子节点（**旧实现会 `for…of null` ⇒ TypeError，这里是核心放宽点**）
  if (children === undefined || children === null || children === false) return;
  // ② 单个节点 ⇒ **视作单元素**
  if (children instanceof Node) {
    node.append(children);
    return;
  }
  // ③ 单个字符串 / 数字 ⇒ **视作单元素**（生成一个文本节点；不再按字符逐个拆）
  if (typeof children === 'string' || typeof children === 'number') {
    node.append(document.createTextNode(String(children)));
    return;
  }
  // ④ 数组 / 其它可迭代 ⇒ 逐个递归（与旧实现同分支、同顺序）
  if (typeof children[Symbol.iterator] === 'function') {
    for (const child of children) appendChildren(node, child);
    return;
  }
  // ⑤ 其它值（普通对象 / true / 函数…）⇒ 退化为文本节点（与历史行为一致）
  node.append(document.createTextNode(String(children)));
}

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/** 生成短 id（同一时刻多次调用也尽量唯一） */
export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function pad2(n) { return String(n).padStart(2, '0'); }

/** 时间戳 -> HH:MM:SS */
export function clockTime(ts = Date.now()) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** ★ **倍率 → 增量百分比**的唯一换算口径（`bonus` 是**倍率**、中性值 1 ⇒ 展示的是**增量**）：
 *  `增量% = (bonus − 1) × 100`，例如 1 → `'0'`、1.1 → `'10'`、1.15 → `'15'`、1.125 → `'12.5'`、0.9 → `'-10'`。
 *  · 返回值是**纯数字字符串**（**不含 `%`**）—— 百分号属展示措辞，由调用方走 i18n 模板拼（体例同
 *    `core/tick.js formatTickSeconds` 只返回数字、秒的 `s` 由 i18n 提供）；
 *  · **四舍五入到 1 位小数并去掉无意义 `.0`**（`toFixed(1)` 后转 Number 再转字符串，顺带消掉浮点尾巴）；
 *  · **负加成用同一公式**（如 0.9 → `'-10'`），不做特判；`bonus` 非数值按中性值 1 处理（→ `'0'`）。
 *  ★ 展示层唯一来源：任何界面需要显示“加成 x%”都调用本函数，**禁止各自手写 `(b-1)*100` 私有公式**。 */
export function formatBonusPercent(bonus) {
  const b = Number(bonus);
  const inc = (Number.isFinite(b) ? b - 1 : 0) * 100;
  return String(Number(inc.toFixed(1)));
}

/** ★ **增量 → 增量百分比**的唯一换算口径（`delta` 本身就是**增量**，不是倍率）：
 *  `百分比 = delta × 100`，例如 0 → `'0'`、0.1 → `'+10'`、0.15 → `'+15'`、0.3 → `'+30'`、
 *  −0.05 → `'−5'`。
 *  · ★ **与 `formatBonusPercent` 的分工（勿混用）**：
 *    `formatBonusPercent` 收的是**倍率**（中性值 1，公式 `(b−1)×100`，用于货物芯片的 `bonus` 与
 *    加成类倍率词条）；本函数收的是**增量**（中性值 0，公式 `d×100`，用于 `bonus_add` 这类
 *    **加性增量**词条）。把增量当倍率算会得到 “+10% → −90%” 的错误结果 —— 这正是本函数存在的理由。
 *  · 返回值是**纯数字字符串**（**不含 `%`**，百分号由调用方走 i18n 模板拼；体例同
 *    `formatTickSeconds` / `formatBonusPercent`）；
 *  · **带正负号**：正数前缀 `+`、负数前缀 `−`（U+2212，与 `battleView` 的 `fmtSigned`/`fmtSignedNum`
 *    同一符号体例）、零返回 `'0'`（调用方可据此**整段隐藏**）；
 *  · 四舍五入到 **1 位小数并去掉无意义 `.0`**（`toFixed(1)` 后转 Number 再转字符串，顺带消掉浮点尾巴）；
 *  · 非数值按中性值 0 处理（→ `'0'`）。
 *  ★ 展示层唯一来源：任何界面/战报要显示“增量 x%”都调用本函数，**禁止各自手写 `d*100` 私有公式**。 */
export function formatBonusDeltaPercent(delta) {
  const d = Number(delta);
  const pct = (Number.isFinite(d) ? d : 0) * 100;
  const n = Number(pct.toFixed(1));
  if (n === 0) return '0';
  return `${n > 0 ? '+' : '−'}${Math.abs(n)}`;
}

/** 深拷贝（JSON 兼容对象） */
export function deepClone(obj) {
  return obj === undefined ? undefined : JSON.parse(JSON.stringify(obj));
}

/** 深合并补丁对象 patch 到 base（就地改 base）：普通对象递归合并，数组/原始值直接覆盖（数组拷贝）。
 *  用于等级表的"逐级只写差异、未填字段回退上一级"（船型 levels 见 data/ships/index.js；
 *  模块 levels 见 entities/module.js 的同名本地实现，体例一致）。 */
export function deepMerge(base, patch) {
  if (!patch) return base;
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        deepMerge(base[k], v);
      } else {
        base[k] = deepClone(v);
      }
    } else {
      base[k] = Array.isArray(v) ? v.slice() : v;
    }
  }
  return base;
}

/** 延时 promise */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
