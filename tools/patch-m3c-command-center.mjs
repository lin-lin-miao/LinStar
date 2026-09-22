#!/usr/bin/env node
/* ===== tools/patch-m3c-command-center.mjs —— M3c：**指挥中心逐级升级费用表**（占位预填） =====
 *
 * 用途（用户口径 M3c 第 4 条）：
 *   · 把 `js/data/baseBuildings/commandCenter.js` 的 `levels[]` **整表重铺**为逐级真实占位值：
 *       Lv1 ＝ 全 0（初始等级，不收费）；
 *       Lv2..Lv16：能量币 ≈ `800 × 1.6^(等级 − 2)`（逐级 `round`）、合金 ＝ 能量币的 40%、
 *                  **Lv3 起**加稀土（`10 × 1.6^(等级 − 3)`，逐级 `round`）；`ore` / `science` 保持 0；
 *       `effect.maxFleet` ＝ `2 + 等级`（**出战上限由配置决定**，代码零公式）。
 *   ★ 只改这**一个**建筑文件；其余建筑**保持 0 占位不动**。
 *
 * 设计要点：
 *   · **幂等**：文件里已有本脚本的标记注释（`★ M3c 费用表`）⇒ **跳过**（不覆盖你后来手工调过的数值）；
 *     想整表重铺 ⇒ 手工删掉该标记注释行（含其后续两行说明）再跑。
 *   · **确定性**：数值只由上面的公式 + `Math.round` 生成，**不含时间 / 随机**；写进文件的是**字面量**，
 *     运行期不参与任何计算（引擎只读配置 —— 见 `systems/base.js`）。
 *   · `--dry-run` 只打印将要写入的内容与摘要，**不落盘**；`--help` 打印用法。
 *   · 改的是**整块** `levels: [ … ],`（从 `levels: [` 行起按括号配平找到结束行），不碰文件其它内容。
 *   · 注释里**不出现**紧邻的 `星号+斜杠`（避免误闭块注释）。
 *
 * 用法：
 *   node tools/patch-m3c-command-center.mjs --dry-run
 *   node tools/patch-m3c-command-center.mjs
 *   node tools/patch-m3c-command-center.mjs --help
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** 仓库根（＝本文件所在 tools/ 的上一级）——跨平台、不依赖 cwd */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'js/data/baseBuildings/commandCenter.js';
const MARKER = '★ M3c 费用表';
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const HELP = argv.includes('--help') || argv.includes('-h');

if (HELP) {
  console.log(`用法：node tools/patch-m3c-command-center.mjs [--dry-run]
  --dry-run  只打印将写入的费用表与摘要，不修改文件
标记注释：${MARKER}（文件里已有它 ⇒ 幂等跳过，不覆盖你后来手工调校的数值）
想整表重铺：手工删掉该标记注释行（含后续两行说明）后再跑
落点：${FILE} 的 levels[]（其余建筑不动）`);
  process.exit(0);
}

/* ---------------- 数值生成（唯一出处；生成后即固化进配置文件） ---------------- */
const round = (x) => Math.max(0, Math.round(x));
const MAX_LEVEL = 16;
const ENERGY_BASE = 800;   // Lv2 的能量币（用户建议量级）
const GROWTH = 1.6;        // 逐级递增 ~60%（用户建议量级）
const ALLOY_RATIO = 0.4;   // 合金 ＝ 能量币的 40%
const RARE_FROM = 3;       // Lv3 起引入稀土
const RARE_BASE = 10;      // Lv3 的稀土量
const MAX_FLEET_BASE = 2;  // 出战上限 ＝ 2 + 等级（占位口径，与该文件头注释一致）

/** 逐级**迭代取整**（每级都在上一级结果上前进 ⇒ 脚本与文件里的字面量完全可复现） */
function ladder(level) {
  if (level < 2) return { energy: 0, ore: 0, alloy: 0, rare: 0, science: 0 };
  let energy = ENERGY_BASE;
  let rare = 0;
  for (let lv = 3; lv <= level; lv += 1) {
    energy = round(energy * GROWTH);
    if (lv >= RARE_FROM) {
      if (lv === RARE_FROM) rare = RARE_BASE;
      else rare = round(rare * GROWTH);
    }
  }
  return { energy, ore: 0, alloy: round(energy * ALLOY_RATIO), rare, science: 0 };
}

const costText = (cost, order = ['energy', 'ore', 'alloy', 'rare', 'science']) =>
  order.map((k) => `${k}: ${cost[k]}`).join(', ');

/* ---------------- 生成文本块（与仓库里已有的表逐字一致） ---------------- */
const IND = '  ';
function buildLevelsBlock() {
  const head = [
    `${IND}/* ${MARKER}（【占位预填 · 待用户调校】；结构由 tools/patch-m3c-command-center.mjs 生成 —— 只调数值即可）`,
    `${IND}   口径：Lv1 免费（初始等级）；Lv2.. 能量币 ≈ 800 × 1.6^(等级 − 2)、合金 ＝ 能量币的 40%、Lv3 起加稀土；`,
    `${IND}   \`effect.maxFleet\` ＝ 2 + 等级（**出战上限由配置决定**，代码零公式）。 */`,
  ];
  const rows = [];
  for (let lv = 1; lv <= MAX_LEVEL; lv += 1) {
    rows.push(`${IND}${IND}{ level: ${lv}, cost: { ${costText(ladder(lv))} }, effect: { maxFleet: ${MAX_FLEET_BASE + lv} } },`);
  }
  return [...head, `${IND}levels: [`, ...rows, `${IND}],`].join('\n');
}

/* ---------------- 整块替换（从 `levels: [` 起按括号配平找结束行） ---------------- */
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

const abs = path.join(ROOT, FILE);
console.log(`── ${FILE}（指挥中心逐级升级费用表）`);
if (!fs.existsSync(abs)) {
  console.log(`✗ 文件不存在：${FILE}`);
  process.exit(1);
}
const src = fs.readFileSync(abs, 'utf8');
const lines = src.split('\n');
const range = findLevelsRange(lines);
if (!range) {
  console.log('  ⚠ 未找到锚点 `levels: [ … ],`（文件结构可能已改）⇒ 未改动任何内容');
  process.exit(1);
}
const blockLines = buildLevelsBlock().split('\n');
if (src.includes(MARKER)) {
  const already = lines.slice(range.start, range.end + 1).join('\n') === blockLines.join('\n');
  console.log(`  ✓ 已就位（含标记「${MARKER}」）⇒ 幂等跳过（想重铺：删掉该标记注释后再跑）`);
  console.log(`  ${already ? '· 现有表与公式生成结果**逐字一致**' : '· 现有表已被手工调校（**脚本不动它**，符合幂等口径）'}`);
} else {
  console.log(`  · 行 ${range.start + 1}..${range.end + 1}（现 levels[] 共 ${range.end - range.start + 1} 行）⇒ ${blockLines.length} 行（${MAX_LEVEL} 级）`);
  const out = [...lines.slice(0, range.start), ...blockLines, ...lines.slice(range.end + 1)].join('\n');
  if (DRY) {
    console.log('  （--dry-run：未落盘）将写入：');
    console.log(blockLines.join('\n'));
  } else {
    fs.writeFileSync(abs, out, 'utf8');
    console.log(`  ✓ 已写入（${out.length - src.length >= 0 ? '+' : ''}${out.length - src.length} 字符）`);
  }
}

/* ---------------- 摘要 ---------------- */
console.log('\n===== 摘要 =====');
console.log(`  指挥中心 Lv1 升级费：{ ${costText(ladder(1))} }（初始等级，免费）`);
console.log(`  Lv2 { ${costText(ladder(2))} }`);
console.log(`  Lv3 { ${costText(ladder(3))} }（起引入稀土）`);
console.log(`  Lv${MAX_LEVEL} { ${costText(ladder(MAX_LEVEL))} }`);
console.log(`  出战上限（配置）：Lv1 ⇒ ${MAX_FLEET_BASE + 1} … Lv${MAX_LEVEL} ⇒ ${MAX_FLEET_BASE + MAX_LEVEL}`);
console.log(`  ${DRY ? '（--dry-run：实际未写盘）' : ''}下一步（父代理执行）：`);
console.log(`    node --check ${FILE}`);
console.log('  然后跑应用自检：LS.base.selfCheck()（期望 31/31：② 建筑注册表 / ㉙ 升级即时生效 / ㉛ 费用表逐级递增）');
