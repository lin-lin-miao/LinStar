#!/usr/bin/env node
/* ===== tools/patch-m3b-costs.mjs —— M3b 迭代：**铺真实费用**（战斗舰 + 火炮模块） =====
 *
 * 用途（用户口径，2025 M3b 迭代第 4 条）：
 *   · 战斗舰 `js/data/ships/combat.js`：`buildCost`（Lv1 建造费）＋ `upgradeCost`（**逐级条目** Lv2..Lv16）；
 *   · 火炮模块 `js/data/modules/attack/cannon.js`：`installCost` / `removeCost` / `upgradeCost` /
 *     `blueprint` / `scienceCost` —— **全部按等级**给出差异。
 *   ★ 只做这两者；其余船型 / 模块**保持 0 占位不动**。
 *
 * 设计要点：
 *   · **幂等**：文件里已有本脚本的标记注释（`★ M3b 真实费用`）⇒ **跳过**（不覆盖你后来手工调过的数值）；
 *     想重铺 ⇒ 手工删掉该标记注释行再跑（脚本**绝不覆盖**已调校的数字）。
 *   · **确定性**：数值由固定公式 + `Math.round` 生成，**不含时间 / 随机**；写进文件的是**字面量**，
 *     运行期**不参与**任何计算（引擎只读配置，代码零硬编码 —— 见 `systems/base.js`）。
 *   · `--dry-run` 只打印将要写入的内容与摘要，**不落盘**；`--help` 打印用法。
 *   · 改的是**单行 → 多行**的结构替换（按行号定位，锚点＝属性名），不碰文件其它内容。
 *   · 注释里**不出现**紧邻的 `星号+斜杠`（避免误闭块注释）。
 *
 * 用法：
 *   node tools/patch-m3b-costs.mjs --dry-run
 *   node tools/patch-m3b-costs.mjs
 *   node tools/patch-m3b-costs.mjs --help
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** 仓库根（＝本文件所在 tools/ 的上一级）——跨平台、不依赖 cwd */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = '★ M3b 真实费用';
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const HELP = argv.includes('--help') || argv.includes('-h');

if (HELP) {
  console.log(`用法：node tools/patch-m3b-costs.mjs [--dry-run]
  --dry-run  只打印将写入的数值与摘要，不修改文件
标记注释：${MARKER}（文件里已有它 ⇒ 幂等跳过，不覆盖你后来手工调校的数值）
想重铺：手工删掉该标记注释行后再跑（脚本不会覆盖你调过的数字）`);
  process.exit(0);
}

/* ---------------- 数值生成（唯一出处；生成后即固化进配置文件） ---------------- */
const round = (x) => Math.max(0, Math.round(x));

/** 战斗舰：Lv1 建造费（用户建议量级：能量币 ~600 / 合金 ~240 / 矿物 ~120） */
const SHIP_BUILD = { energy: 600, ore: 120, alloy: 240, rare: 0 };
const SHIP_FIRST_UP = 0.55; // 首个升级条目 ≈ 建造费的 55%
const SHIP_GROWTH = 1.42;   // 逐级递增 ~42%（用户建议区间 35%~60%）
const SHIP_UP_SPLIT = { ore: 0.2, alloy: 0.4 }; // 升级费里 矿物 / 合金 相对能量币的比例
const SHIP_RARE_FROM = 5;   // Lv5+ 引入稀土
const SHIP_RARE_BASE = 4;
const SHIP_RARE_GROWTH = 1.45;

/** 火炮：Lv1 装配费（用户建议量级：能量币 ~120 / 合金 ~60 / 矿物 ~30） */
const MOD_INSTALL = { energy: 120, ore: 30, alloy: 60 };
const MOD_GROWTH = 1.35;
const MOD_RARE_FROM = 9;
const MOD_RARE_BASE = 2;
const MOD_RARE_GROWTH = 1.4;
const MOD_REMOVE_RATIO = 0.25;  // 拆下费用 ＝ 装配费的 25%
const MOD_UP_RATIO = 0.6;       // 模块升级费 ＝ 该等级装配费的 60%
const MOD_SCIENCE_RATIO = 0.05; // 研究费（能量币的 5%；M3e 才消费）

function shipUpgradeEnergy(level) {
  return round(SHIP_BUILD.energy * SHIP_FIRST_UP * SHIP_GROWTH ** (level - 2));
}
function shipUpgradeCost(level) {
  const e = shipUpgradeEnergy(level);
  const cost = { energy: e, ore: round(e * SHIP_UP_SPLIT.ore), alloy: round(e * SHIP_UP_SPLIT.alloy), rare: 0 };
  if (level >= SHIP_RARE_FROM) cost.rare = round(SHIP_RARE_BASE * SHIP_RARE_GROWTH ** (level - SHIP_RARE_FROM));
  return cost;
}
function moduleInstallCost(level) {
  const f = MOD_GROWTH ** (level - 1);
  const cost = { energy: round(MOD_INSTALL.energy * f), ore: round(MOD_INSTALL.ore * f), alloy: round(MOD_INSTALL.alloy * f), rare: 0 };
  if (level >= MOD_RARE_FROM) cost.rare = round(MOD_RARE_BASE * MOD_RARE_GROWTH ** (level - MOD_RARE_FROM));
  return cost;
}
const scaleCost = (cost, ratio) => {
  const out = {};
  for (const [k, v] of Object.entries(cost)) out[k] = round(v * ratio);
  return out;
};
const costText = (cost, order = ['energy', 'ore', 'alloy', 'rare', 'science']) =>
  order.filter((k) => cost[k] !== undefined).map((k) => `${k}: ${cost[k]}`).join(', ');

/* ---------------- 生成文本块 ---------------- */
const IND = '  ';
const MODULE_LEVELS = 16;
const SHIP_MAX = 16;

function buildShipBlocks() {
  const marker = `${IND}/* ${MARKER}（【占位预填 · 待用户调校】；结构由 tools/patch-m3b-costs.mjs 生成 —— 只调数值即可） */`;
  const build = `${IND}buildCost: { ${costText(SHIP_BUILD)} },`;
  const rows = [];
  for (let lv = 2; lv <= SHIP_MAX; lv += 1) {
    rows.push(`${IND}${IND}{ level: ${lv}, cost: { ${costText(shipUpgradeCost(lv))} } },`);
  }
  const up = [
    `${IND}/* ${MARKER} —— 逐级**升级消耗**（Lv2..Lv16；未列出的等级**沿用上一项**；
${IND}   引擎口径：建 LvN 的造价 ＝ buildCost ＋ Σ(level ≤ N 的升级条目)） */`,
    `${IND}upgradeCost: [`,
    ...rows,
    `${IND}],`,
  ].join('\n');
  return { marker, build, up };
}

function buildModuleBlocks() {
  const marker = `${IND}/* ${MARKER}（【占位预填 · 待用户调校】；结构由 tools/patch-m3b-costs.mjs 生成 —— 只调数值即可）
${IND}   —— 下列各表**均按模块等级**给出：装配 / 拆下 / 升级 / 研究 费用与**蓝图门槛**逐级不同。 */`;
  const kv = (o, order) => costText(o, order);
  const installRows = [];
  const removeRows = [];
  const upRows = [];
  const scienceRows = [];
  for (let lv = 1; lv <= MODULE_LEVELS; lv += 1) {
    const inst = moduleInstallCost(lv);
    installRows.push(`${IND}${IND}{ level: ${lv}, cost: { ${kv(inst)} } },`);
    removeRows.push(`${IND}${IND}{ level: ${lv}, cost: { ${kv(scaleCost(inst, MOD_REMOVE_RATIO))} } },`);
    scienceRows.push(`${IND}${IND}{ level: ${lv}, cost: { science: ${round(inst.energy * MOD_SCIENCE_RATIO)} } },`);
    if (lv >= 2) upRows.push(`${IND}${IND}{ level: ${lv}, cost: { ${kv(scaleCost(inst, MOD_UP_RATIO))} } },`);
  }
  // 蓝图门槛：Lv1 免（保证开箱即可装 Lv1 火炮）；越高越稀缺
  const bp = `[${[[1, 0], [5, 1], [10, 3], [16, 6]].map(([l, c]) => `{ level: ${l}, count: ${c} }`).join(', ')}]`;
  return {
    marker,
    install: [`${IND}installCost: [`, ...installRows, `${IND}],`].join('\n'),
    remove: [`${IND}removeCost: [`, ...removeRows, `${IND}],`].join('\n'),
    up: [`${IND}upgradeCost: [`, ...upRows, `${IND}],`].join('\n'),
    blueprint: `${IND}blueprint: ${bp},`,
    science: [`${IND}scienceCost: [`, ...scienceRows, `${IND}],`].join('\n'),
  };
}

/* ---------------- 逐文件替换（按行锚点；从后往前 splice 保持行号有效） ---------------- */
const TARGETS = [
  {
    file: 'js/data/ships/combat.js',
    label: '战斗舰 buildCost + upgradeCost',
    plan: () => {
      const b = buildShipBlocks();
      return [
        { re: /^\s*buildCost\s*:/, text: `${b.marker}\n${b.build}` },
        { re: /^\s*upgradeCost\s*:\s*\[.*\],\s*$/, text: b.up },
      ];
    },
  },
  {
    file: 'js/data/modules/attack/cannon.js',
    label: '火炮 installCost / removeCost / upgradeCost / blueprint / scienceCost',
    plan: () => {
      const m = buildModuleBlocks();
      return [
        { re: /^\s*installCost\s*:/, text: `${m.marker}\n${m.install}` },
        { re: /^\s*removeCost\s*:\s*\{.*\},\s*$/, text: m.remove },
        { re: /^\s*upgradeCost\s*:\s*\[.*\],\s*$/, text: m.up },
        { re: /^\s*blueprint\s*:\s*\[.*\],\s*$/, text: m.blueprint },
        { re: /^\s*scienceCost\s*:\s*\[.*\],\s*$/, text: m.science },
      ];
    },
  },
];

let changedTotal = 0;
let missingTotal = 0;

for (const t of TARGETS) {
  const abs = path.join(ROOT, t.file);
  if (!fs.existsSync(abs)) {
    console.log(`✗ 文件不存在：${t.file}`);
    missingTotal += 1;
    continue;
  }
  const src = fs.readFileSync(abs, 'utf8');
  const lines = src.split('\n');
  console.log(`\n── ${t.file}（${t.label}）`);
  if (src.includes(MARKER)) {
    console.log(`  ✓ 已就位（含标记「${MARKER}」）⇒ 幂等跳过（想重铺：删掉该注释行后再跑）`);
    continue;
  }
  const edits = [];
  for (const e of t.plan()) {
    const hits = [];
    for (let i = 0; i < lines.length; i += 1) if (e.re.test(lines[i])) hits.push(i);
    if (hits.length === 0) {
      console.log(`  ⚠ 未找到锚点：${e.re}（需人工检查该文件是否已改结构）`);
      continue;
    }
    for (const i of hits) edits.push({ i, text: e.text, firstLine: lines[i].trim() });
  }
  if (!edits.length) {
    missingTotal += 1;
    console.log('  ⚠ 无任何可改锚点 ⇒ 跳过本文件');
    continue;
  }
  edits.sort((a, b) => b.i - a.i); // 从后往前替换
  for (const ed of edits) {
    console.log(`  · 行 ${ed.i + 1}：${ed.firstLine} ⇒ ${ed.text.split('\n').length} 行`);
    lines.splice(ed.i, 1, ...ed.text.split('\n'));
  }
  const out = lines.join('\n');
  if (out === src) {
    console.log('  ✓ 内容无变化（已是最新）');
    continue;
  }
  if (DRY) {
    console.log(`  （--dry-run：未落盘；将新增 ${out.length - src.length} 字符）`);
  } else {
    fs.writeFileSync(abs, out, 'utf8');
    console.log(`  ✓ 已写入（${out.length - src.length >= 0 ? '+' : ''}${out.length - src.length} 字符）`);
  }
  changedTotal += 1;
}

/* ---------------- 摘要 ---------------- */
console.log('\n===== 摘要 =====');
console.log(`  文件改动：${changedTotal} 个${DRY ? '（--dry-run：实际未写盘）' : ''}；问题文件：${missingTotal} 个`);
console.log(`  战斗舰 Lv1 建造费：{ ${costText(SHIP_BUILD)} }`);
console.log(`  战斗舰升级条目：Lv2 { ${costText(shipUpgradeCost(2))} } … Lv16 { ${costText(shipUpgradeCost(16))} }`);
console.log(`  火炮 Lv1 装配费：{ ${costText(moduleInstallCost(1))} }；Lv16 { ${costText(moduleInstallCost(16))} }`);
console.log('  下一步（父代理执行）：');
console.log('    node --check js/data/ships/combat.js');
console.log('    node --check js/data/modules/attack/cannon.js');
console.log('  然后跑应用自检：LS.base.selfCheck()（期望 20/20：⑱ 会核对 cannon 非 0 且逐级递增）');
if (missingTotal > 0) process.exit(1);
