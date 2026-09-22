#!/usr/bin/env node
/* ===== tools/patch-m3d-building-levels.mjs —— M3d：**补齐基地建筑的逐级等级表**（占位预填） =====
 *
 * 用途（M3d 收尾修红）：
 *   `systems/base.js` 自检 ② 断言「每个建筑的 `levels.length === maxLevel`」。
 *   M3a 留下的骨架里，`stargate` 与 `shipyard` 都是 `maxLevel: 16` 却只写了 5 级
 *   ⇒ **② 本来就是红的**（与 M3d 的业务逻辑无关，属遗留缺口）。
 *   本脚本把这两个文件**缺的那几级**补上，**原有 Lv1..Lv5 一字不改**。
 *
 * 补法（沿用各文件自身已有的增长，**占位量级**，固化进配置文件后运行期不参与计算）：
 *   · `stargate`：能量币 / 矿石 / 合金 / 稀土 一律在上一级基础上 `round(×1.6)`（该文件 Lv2..Lv5 的实际增长）；
 *   · `shipyard`：同上 `round(×1.6)`；另 `effect.fleetCapacity` **+4 / 级**、`effect.scrapRefundRatio` **+0.02 / 级**；
 *   · `effect` 里**只写该文件已经有的字段**（不编造新加成）；`science` 恒 0（与既有写法一致）。
 *
 * 设计要点：
 *   · **幂等**：已有标记注释（`★ M3d 补齐`）**或** `levels.length` 已达 `maxLevel` ⇒ 跳过，不覆盖手工调校的数值；
 *   · **确定性**：只由上面的常数 + `Math.round` 生成，无时间 / 随机；写进文件的是**字面量**；
 *   · `--dry-run` 只打印将写入的行，不落盘；`--help` 打印用法；
 *   · 只在 `levels: [ … ]` 块内追加行（按括号配平定位），**不碰文件其它内容**；
 *   · 注释里**不出现**紧邻的 `星号+斜杠`（避免误闭块注释）。
 *
 * 用法：
 *   node tools/patch-m3d-building-levels.mjs --dry-run
 *   node tools/patch-m3d-building-levels.mjs
 *   node tools/patch-m3d-building-levels.mjs --help
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** 仓库根（＝本文件所在 tools/ 的上一级）——跨平台、不依赖 cwd */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = '★ M3d 补齐';
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const HELP = argv.includes('--help') || argv.includes('-h');

/** 每个待补文件的**最后一个已写等级**（原样读自文件；补出来的级一律由它迭代而来） */
const TARGETS = [
  {
    file: 'js/data/baseBuildings/stargate.js',
    maxLevel: 16,
    base: { level: 5, cost: { energy: 3000, ore: 300, alloy: 1000, rare: 50 }, effect: {} },
    note: ['能量 Lv2→Lv5：500/1000/1800/3000 继续 ×1.6 取整，逐级严格递增。'],
  },
  {
    file: 'js/data/baseBuildings/shipyard.js',
    maxLevel: 16,
    base: { level: 5, cost: { energy: 3100, ore: 340, alloy: 1150, rare: 50 }, effect: { fleetCapacity: 20, scrapRefundRatio: 0.7 } },
    note: ['能量/矿石/合金/稀有 ×1.6 取整、容量 +4、返还比例 +0.02（≤ 1）。'],
  },
];

if (HELP) {
  console.log(`用法：node tools/patch-m3d-building-levels.mjs [--dry-run]
  --dry-run  只打印将要追加的等级行，不修改文件
标记注释：${MARKER}（文件里已有它、或 levels.length 已达 maxLevel ⇒ 幂等跳过）
落点：${TARGETS.map((t) => t.file).join(' / ')} 的 levels[]（只追加缺失的级，已在的级一字不改）`);
  process.exit(0);
}

const round = (x) => Math.max(0, Math.round(x));

/** 逐级**迭代取整**：从 `base.level` 的数值出发，一路算出到目标级的字面量 */
function levelsAfter(base, target) {
  const out = [];
  let energy = base.cost.energy;
  let ore = base.cost.ore;
  let alloy = base.cost.alloy;
  let rare = base.cost.rare;
  const hasCap = Number.isFinite(base.effect.fleetCapacity);
  const hasRatio = Number.isFinite(base.effect.scrapRefundRatio);
  for (let lv = base.level + 1; lv <= target; lv += 1) {
    energy = round(energy * 1.6);
    ore = round(ore * 1.6);
    alloy = round(alloy * 1.6);
    rare = round(rare * 1.6);
    const effect = {};
    if (hasCap) effect.fleetCapacity = base.effect.fleetCapacity + 4 * (lv - base.level);
    if (hasRatio) effect.scrapRefundRatio = Number((base.effect.scrapRefundRatio + 0.02 * (lv - base.level)).toFixed(2));
    out.push({ level: lv, cost: { energy, ore, alloy, rare, science: 0 }, effect });
  }
  return out;
}

const IND = '  ';
/** 生成"要追加的行"（注释 + Lv6..LvN）——与仓库里已写好的内容**逐字一致** */
function buildAppendLines(t) {
  const rows = levelsAfter(t.base, t.maxLevel);
  const first = rows[0].level;
  const head = [
    `${IND}// ${MARKER} Lv${first}..Lv${t.maxLevel}（**原有 Lv1..Lv${t.base.level} 一字未改**）：本表必须逐级完整（自检 ② \`levels.length === maxLevel\`），`,
    `${IND}//   原文件只有 ${t.base.level} 级而 \`maxLevel: ${t.maxLevel}\` ⇒ **② 本来就是红的**（M3a 遗留的骨架缺口，与 M3d 逻辑无关）。`,
    `${IND}//   补法＝沿用本文件自身已有增长：${t.note[0]}`,
  ];
  return [...head, ...rows.map(rowLine)];
}

function rowLine(r) {
  const c = r.cost;
  const cost = `energy: ${c.energy}, ore: ${c.ore}, alloy: ${c.alloy}, rare: ${c.rare}, science: 0`;
  const keys = Object.keys(r.effect);
  const effect = keys.length ? `{ ${keys.map((k) => `${k}: ${r.effect[k]}`).join(', ')} }` : '{}';
  return `${IND}${IND}{ level: ${r.level}, cost: { ${cost} }, effect: ${effect} },`;
}

/** 找 `levels: [ … ],` 的**括号配平**范围（不碰其它块） */
function findLevelsRange(lines) {
  const start = lines.findIndex((l) => /^\s*levels\s*:\s*\[/.test(l));
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < lines.length; i += 1) {
    for (const ch of lines[i]) {
      if (ch === '[') depth += 1;
      else if (ch === ']') depth -= 1;
    }
    if (depth === 0) return { start, end: i };
  }
  return null;
}

let problems = 0;
for (const t of TARGETS) {
  const abs = path.join(ROOT, t.file);
  console.log(`── ${t.file}`);
  if (!fs.existsSync(abs)) {
    console.log('  ✗ 文件不存在 ⇒ 跳过');
    problems += 1;
    continue;
  }
  const src = fs.readFileSync(abs, 'utf8');
  const lines = src.split('\n');
  const range = findLevelsRange(lines);
  if (!range) {
    console.log('  ⚠ 未找到锚点 `levels: [ … ],` ⇒ 未改动');
    problems += 1;
    continue;
  }
  const body = lines.slice(range.start, range.end + 1);
  const count = body.filter((l) => /^\s*\{\s*level\s*:/.test(l)).length;
  const lastLevel = Math.max(
    0,
    ...body
      .map((l) => (/^\s*\{\s*level\s*:\s*(\d+)/.exec(l) || [])[1])
      .filter(Boolean)
      .map((n) => Number(n))
  );
  if (lastLevel >= t.maxLevel) {
    console.log(`  ✓ 已完整（Lv1..Lv${lastLevel}，共 ${count} 级）⇒ 幂等跳过`);
    continue;
  }
  const head = parseInt((/maxLevel\s*:\s*(\d+)/.exec(src) || [])[1] || '0', 10);
  if (head !== t.maxLevel) console.log(`  ⚠ 文件里 maxLevel=${head}，脚本按 ${t.maxLevel} 处理（以文件为准请手动核对）`);
  const append = buildAppendLines({ ...t, base: { ...t.base, level: lastLevel } });
  console.log(`  · 现有 ${count} 级（末级 Lv${lastLevel}）⇒ 追加 ${append.length - 3} 级（Lv${lastLevel + 1}..Lv${t.maxLevel}）`);
  if (DRY) {
    console.log('  （--dry-run：未落盘）将插入到 `levels: [` 块末尾之前：');
    for (const l of append) console.log(l);
    continue;
  }
  // 追加到 `],` 结束行**之前**（结束行本身不动 ⇒ 文件其余内容逐字不变）
  const out = [...lines.slice(0, range.end), ...append, ...lines.slice(range.end)].join('\n');
  fs.writeFileSync(abs, out, 'utf8');
  console.log(`  ✓ 已写入（${out.length - src.length >= 0 ? '+' : ''}${out.length - src.length} 字符）`);
}

console.log('\n===== 摘要 =====');
for (const t of TARGETS) {
  const rows = levelsAfter(t.base, t.maxLevel);
  const first = rows[0];
  const last = rows[rows.length - 1];
  console.log(`  ${t.file}`);
  console.log(`    Lv${first.level} → { energy: ${first.cost.energy}, ore: ${first.cost.ore}, alloy: ${first.cost.alloy}, rare: ${first.cost.rare} }`);
  console.log(`    Lv${last.level} → { energy: ${last.cost.energy}, ore: ${last.cost.ore}, alloy: ${last.cost.alloy}, rare: ${last.cost.rare} }`);
}
console.log(`  ${DRY ? '（--dry-run：实际未写盘）' : ''}下一步（父代理执行）：`);
console.log(`    node --check js/data/baseBuildings/stargate.js`);
console.log(`    node --check js/data/baseBuildings/shipyard.js`);
console.log('  然后跑应用自检：LS.base.selfCheck()（② 建筑注册表完整的 levels.length 断言应转绿；期望 31/31）');
if (problems) process.exit(1);
