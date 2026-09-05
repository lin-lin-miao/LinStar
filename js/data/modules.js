/* ===== data/modules.js —— 模块静态配置总表（占位数值） =====
 * 通用字段说明（中文）：
 *   id         唯一标识（引擎内部引用，勿改）
 *   nameKey    显示名词条 key（对应 i18n/*.js，如 module.cannon）
 *   glyph      模块槽短图标字符（纯展示符号，不需 i18n）
 *   category   模块分类：
 *                attack=攻击 / shield=护盾 / function=功能 /
 *                transport=运输 / mining=采矿 / drone=无人机
 *   effects    效果词条（词条驱动执行器，引擎据此自动执行，无需硬编码分支）。
 *               命名约定：所有 effects 词条一律【下划线】风格（如 max_damage）；
 *               后续新增通用词条/配置字段均沿用下划线命名。
 *               词条包括：
 *                damage      → 对每个选定目标造成伤害（乘船类系数；亦为逐步伤害的"上限/起点"基准）
 *                max_damage  →（可选）逐步伤害的封顶值：伤害持续同目标累计，封顶 max_damage
 *                ramp_per_hit→ 逐步伤害成长率：攻击目标不变时，每次成功激活 +ramp_per_hit；
 *                              目标改变/失去、模块能量不足、或停用则成长清零（回到基础值）
 *                shield_gain  → 仅作用于自身：正=自身回盾（乘船类系数）
 *                shield_cap_bonus → 仅作用于自身：提升自身护盾上限（永久/时长型见下）
 *                shield_gain_target → 指向选定目标：正=为其回盾，负=削减其【当前护盾】
 *                                    （触发型，每次激活结算一次；乘船类系数）
 *                shield_cap_target  → 指向选定目标：正=抬升其护盾上限，负=压低其上限
 *                                    ★上限类为"单次一次性、仅对当前所选目标"：
 *                                     每次触发先撤销上次施加在(旧)目标上的影响，
 *                                     再对本次解析目标重新施加（不随多次触发累加）；
 *                                     切换目标后于下一次触发时作用到新目标，
 *                                     携带者阵亡/模块停用/时长结束亦撤销。
 *                                    （触发型/持续型皆可）
 *                hp_target / energy_target      → 同 shield_gain_target，作用于【当前血量】/
 *                                               【当前能量】（正=加，负=减；hp 负可致死）
 *                hp_cap_target / energy_cap_target → 同 shield_cap_target，作用于【血量上限】/
 *                                                【能量上限】（正=抬，负=压）
 *  ※ shield_gain / shield_cap_bonus 只作用于模块所属自身；对其它单位（或自身也需指向）须用
 *    shield_gain_target / shield_cap_target / hp_target / hp_cap_target / energy_target / energy_cap_target。
 *                （后续词条：heal / energyDrain 等，在同一执行器框架追加）
 *                cooldown_ticks / energy_cost 为激活节奏/代价（见"统一激活规则"）
 *                duration_ticks ★ 持续时间词条：触发成功后进入"持续期"，
 *                             在持续期内该模块的加成词条才生效（如护盾上限提升）；
 *                             持续时间结束 → 效果消失（护盾上限回落）→ 进入冷却，
 *                             冷却结束且能量足够 → 再次触发（循环）。
 *                             无 duration_ticks 的模块：激活时立即生效并直接进入冷却。
 *                type        特殊效果标记【列表参数】：仅用于特殊模块的
 *                             特殊逻辑钩子；未来一个模块可带多个特殊效果
 *                             （如 type: ['弹道弹幕','溅射']）。普通词条效果
 *                             不需要 type。
 *   target     目标词条（目标选择相关，引擎/目标选择器/详情 UI 共用）：
 *                kinds      目标可用对象（作用对象，可多选数组）：
 *                              self  = 自身（如再生护盾对自己生效）
 *                              ally  = 友方单位（己方其它单位，M2 支援类模块用）
 *                              enemy = 敌方单位（可选目标 → 详情面板可手动指定）
 *                              any   = 敌我任意（所有存活单位，含自身与对方，可选）
 *                countMode   目标数量语义：
 *                              single = 单体（默认；可手动指定，默认跟随上游）
 *                              multi  = 多目标（有限数量，数量取 maxCount；
 *                                        可手动多选，选择互斥去重，
 *                                        未手动填满的空位由上游(船→全队)自动补足，
 *                                        无可用目标则本次不激活）
 *                              all    = 全队（命中所有符合条件的存活目标）
 *                maxCount    countMode='multi' 时的目标数上限（single/all 忽略）
 *
 * ★ 统一激活规则（所有周期性模块共用，见 systems/battle.js）：
 *   - 模块按冷却周期"激活"：effects.cooldown_ticks 为激活间隔（tick 数）；
 *     若配置里没有 cooldown_ticks 词条，则默认 = 1 tick（每 tick 判定一次）；
 *   - 激活前必须满足能量：effects.energy_cost（缺省 0）；能量不足则不触发、
 *     不扣能、无部分执行，等待下个 tick 能量足够时再触发；
 *   - 纯增益模块（如回盾）若无目标可生效（护盾已满）同样不激活不耗能；
 *   - 时长型模块在持续期内不可重复触发；到期自动进冷却。
 *
 * M1 已注册：火炮、再生护盾、rampCannon(逐步伤害测试)；其余模块在 M2/M4 依清单逐步加入。
 */
export const MODULES = {
  /* —— 攻击类：火炮（敌方武器；目标数量 multi：可同时命中多个） —— */
  cannon: {
    id: 'cannon',             // 唯一标识（火炮）
    nameKey: 'module.cannon', // 名称词条 key（i18n -> 火炮 / Cannon）
    glyph: '炮',              // 模块槽短图标字符
    category: 'attack',       // 分类：攻击类
    // 目标词条：可对"敌方单位"开火（multi → 详情面板可手动多选，互斥去重）
    target: {
      kinds: ['enemy'],       // 目标可用对象：敌方单位
      countMode: 'multi',     // 目标数量：多目标
      maxCount: 2,            // 最多同时命中 2 个目标（空位由上游自动补足）
    },
    effects: {
      type: ['projectile'],   // 特殊标记（词条效果已由 damage 驱动）
      damage: 14,             // 词条：对每个选定目标造成伤害（乘船类攻击系数）
      cooldown_ticks: 20,      // 激活间隔（开火冷却；20 tick = 1 秒）
      energy_cost: 6,          // 每次激活消耗能量（能量不足不触发）
    },
  },

  /* —— 护盾类：再生护盾（自身周期回盾；对己目标执行 shield_gain） —— */
  regenShield: {
    id: 'regenShield',        // 唯一标识（再生护盾）
    nameKey: 'module.regenShield', // 名称词条 key（i18n -> 再生护盾 / Regenerative Shield）
    glyph: '盾',              // 模块槽短图标字符
    category: 'shield',       // 分类：护盾类
    // 目标词条：仅作用于自身（不提供目标选择器）
    target: {
      kinds: ['self'],        // 目标可用对象：自身
      countMode: 'single',    // 目标数量：单体（自己）
      maxCount: 1,
    },
    effects: {
      type: [],               // 无特殊钩子：由词条驱动即可
      shield_cap_bonus: 500,    // 词条（永久）：被动提升自身护盾上限（安装即生效）
      shield_gain: 30,         // 词条：每次激活为自身恢复护盾（乘船类护盾系数）
      cooldown_ticks: 5,       // 激活间隔：每 5 tick 尝试激活一次（缺省默认 1 tick）
      energy_cost: 10,         // 每次激活消耗能量（能量不足/盾满则不激活）
    },
  },

  rampCannon: {
    id: 'rampCannon', nameKey: 'module.cannon', glyph: '炮', category: 'attack',
    target: { kinds: ['enemy'], countMode: 'single', maxCount: 1 },
    effects: {
      type: [], damage: 5, max_damage: 120, ramp_per_hit: 1,
      cooldown_ticks: 5, energy_cost: 5
    },
  }
};

/** 模块类别展示顺序（后续 UI/筛选用）：攻击/护盾/功能/运输/采矿/无人机 */
export const CATEGORY_ORDER = ['attack', 'shield', 'function', 'transport', 'mining', 'drone'];

export default MODULES;
