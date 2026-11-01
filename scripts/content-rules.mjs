#!/usr/bin/env node
/**
 * 内容规则引擎：qc-rules.json 的加载、校验与执行。
 *
 * 规则文件（v2）：
 *   {"version":2,"rules":[{
 *     "id","name","description",
 *     "type":"builtin"|"regex"|"llm",
 *     "check": "builtin 检查器名（type=builtin 时必填）",
 *     "params": { ...阈值/正则/词表，全部可配 },
 *     "prompt": "检查说明（type=llm 时必填）",
 *     "level":"FAIL"|"WARN",
 *     "stage":"draft"|"render",
 *     "draftStatus":"PASS"|"SKIP",  // 可选，只对 stage=render 生效
 *     "enabled":true
 *   }]}
 *
 * v2 说明：C01–C26 为确定性规则；C08a 词表合入 C08，C12a 口号词表合入 C12；
 * 4 条 LLM 规则保留旧 id（hook_3s / jargon / actionable_ending / point_alignment），
 * 对应规范 L01–L04。
 *
 * 优先级（由调用方解析）：--rules > <项目目录>/qc-rules.json > 仓库根 qc-rules.json。
 *
 * 纯函数入口：
 *   runRules({script, captions, research, rules, stage}) →
 *   [{id,name,type,level,stage,status,detail,items}]
 *
 * 说明：
 * - 字数统一用 countChars：只算中文字、英文字母、数字，不算标点和空格；
 * - stage=render 的规则只在 stage=render 时执行，其余规则两个阶段都执行；
 * - type=llm 的规则由 scripts/content-qc.mjs 调 LLM 执行，这里只占位 SKIP；
 * - 规则判定的“不通过”按规则自己的 level 上报（FAIL / WARN）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_RULES_FILE = path.join(ROOT, "qc-rules.json");
export const DEFAULT_PROJECT_RULES_NAME = "qc-rules.json";

export const RULE_TYPES = ["builtin", "regex", "llm"];
export const RULE_LEVELS = ["FAIL", "WARN"];
export const RULE_STAGES = ["draft", "render"];
export const RULE_STATUSES = ["PASS", "WARN", "FAIL", "SKIP", "DISABLED"];

/** 规范五段；beatRole 的 conclusion 统一映射为 takeaway。 */
export const BEAT_SEQUENCE = ["hook", "problem", "breakdown", "takeaway", "action"];
export const BEAT_LABELS = {
  hook: "钩子",
  problem: "问题",
  breakdown: "拆解",
  takeaway: "结论",
  action: "行动",
};

/** 规范第三节的示范改写用到的默认值，集中放这里方便文档和测试引用。 */
export const DEFAULT_TERMS = [
  "Agent",
  "提示词",
  "大模型",
  "API",
  "多模态",
  "Token",
  "RAG",
  "微调",
];

export const DEFAULT_EXPLAIN_MARKERS = [
  "就是",
  "相当于",
  "说白了",
  "也就是",
  "指的是",
  "，即",
];

export const DEFAULT_ACTION_VERBS = [
  "打开",
  "写",
  "记",
  "列",
  "删",
  "改",
  "试",
  "粘",
  "发",
  "关",
  "建",
  "存",
  "录",
  "找",
  "问",
  "补",
];

/** C08 / C08a：v2 万能开头词表。 */
export const DEFAULT_OPENER_PATTERN =
  "^(随着|在.{0,12}(背景下|今天|时代)|今天(跟|和)大家|大家好|有这样一(群人|个地方)|他是一名)";

/** C10：明确纠正对象。可按「对立名词组」配置，也兼容扁平数组。 */
export const DEFAULT_CORRECTION_NOUNS = [
  ["保存", "上传"],
  ["前端", "后端"],
  ["客户端", "服务端"],
  ["输入", "输出"],
  ["读取", "写入"],
];

/** C12：具体留白问题里允许出现的对象名词。 */
export const DEFAULT_CONCRETE_NOUNS = [
  "周报",
  "日报",
  "月报",
  "会议纪要",
  "备忘录",
  "提示词",
  "表格",
  "文档",
  "邮件",
  "脚本",
  "清单",
  "计划",
  "手机",
  "电脑",
  "镜头",
  "字幕",
  "视频",
  "简历",
];

export const DEFAULT_EMPTY_QUESTION_PATTERN =
  "你学会了吗|对不对|是不是|好不好|你觉得呢|欢迎在评论区|有哪些困惑";

export const DEFAULT_SLOGAN_PATTERN =
  "未来可期|让我们|携手|致敬|新的篇章|拥抱\\s*AI|解锁|一起加油";

/** C02 / C21 共用信息句额度。 */
export const DEFAULT_INFO_QUOTA = {
  normalMax: 16,
  infoMax: 22,
  hookProblemMax: 1,
  breakdownPerShots: 8,
  breakdownMaxPer: 1,
  takeawayActionMax: 1,
};

/* ─────────────────────────────
 * 文本工具
 * ───────────────────────────── */

const CHINESE_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const ALNUM_RE = /[0-9０-９A-Za-z]/;

/**
 * 统一字数口径：只算中文字、英文字母、数字，不算标点和空格。
 * @param {unknown} text
 * @returns {number}
 */
export const countChars = (text) =>
  Array.from(String(text ?? "")).filter(
    (ch) => CHINESE_RE.test(ch) || ALNUM_RE.test(ch)
  ).length;

const SENTENCE_RE = /[^。！？!?；;\n]+[。！？!?；;]?/g;

/** 按句号/问号/叹号/分号/换行切句，保留句末标点。 */
export const splitSentences = (text) =>
  (String(text ?? "").match(SENTENCE_RE) ?? [])
    .map((sentence) => sentence.trim())
    .filter(Boolean);

const trimText = (value) => (typeof value === "string" ? value.trim() : "");

const listOfStrings = (value) =>
  Array.isArray(value)
    ? value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];

const normalizeCaptions = (captions) => {
  if (Array.isArray(captions)) return captions;
  if (Array.isArray(captions?.captions)) return captions.captions;
  return [];
};

const captionStartSeconds = (caption, fps) => {
  const start = Number(caption?.start);
  if (Number.isFinite(start)) return start;
  const startFrame = Number(caption?.startFrame);
  if (Number.isFinite(startFrame)) return startFrame / fps;
  return null;
};

const stripLeadingPunct = (text) =>
  String(text ?? "").replace(/^[\s\p{P}\p{S}]+/u, "");

const prefixOf = (sentence, length = 2) =>
  Array.from(stripLeadingPunct(sentence)).slice(0, length).join("");

/** 这一镜属于哪一段：beat 是枚举才认，否则兼容 beatRole（conclusion→takeaway）。 */
export const beatOf = (shot) => {
  if (!shot || typeof shot !== "object") return null;
  if (BEAT_SEQUENCE.includes(shot.beat)) return shot.beat;
  if (shot.beatRole === "conclusion") return "takeaway";
  if (BEAT_SEQUENCE.includes(shot.beatRole)) return shot.beatRole;
  return null;
};

/* ─────────────────────────────
 * 检查器共用工具
 * ───────────────────────────── */

const isFourCharWord = (word) =>
  countChars(word) === 4 && Array.from(word).length === 4;

const splitCommaWords = (sentence) =>
  sentence
    .split(/[、，,]/)
    .map((word) => stripLeadingPunct(word).replace(/[。！？!?；;\s]+$/g, ""))
    .filter(Boolean);

/** 找出连续同前缀的区间（用于 C14 / C23）。 */
const prefixRuns = (sentences, prefixChars = 2) => {
  const runs = [];
  let start = -1;
  let prefix = "";
  const flush = (end) => {
    if (start >= 0) {
      runs.push({ prefix, start, end, length: end - start + 1 });
      start = -1;
      prefix = "";
    }
  };
  sentences.forEach((sentence, index) => {
    const current = prefixOf(sentence, prefixChars);
    if (!current) {
      flush(index - 1);
      return;
    }
    if (start >= 0 && current === prefix) return;
    flush(index - 1);
    start = index;
    prefix = current;
  });
  flush(sentences.length - 1);
  return runs.filter((run) => run.length > 1);
};

/** 找连续四字词区间（C23 用）。 */
const fourCharRuns = (sentence, minRun = 3) => {
  const words = splitCommaWords(sentence);
  const runs = [];
  let start = -1;
  const flush = (end) => {
    if (start >= 0 && end - start + 1 >= minRun) {
      runs.push({ start, end, words: words.slice(start, end + 1) });
    }
    start = -1;
  };
  words.forEach((word, index) => {
    if (isFourCharWord(word)) {
      if (start < 0) start = index;
      return;
    }
    flush(index - 1);
  });
  flush(words.length - 1);
  return runs;
};

/**
 * C02 / C21 的信息句额度分析。
 * 17–22 字算信息句；≥23 单列为 tooLong。
 */
const analyzeInfoSentences = (ctx, params = {}) => {
  const normalMax = Number(params.normalMax ?? params.max ?? DEFAULT_INFO_QUOTA.normalMax);
  const infoMax = Number(params.infoMax ?? DEFAULT_INFO_QUOTA.infoMax);
  const hookProblemMax = Number(params.hookProblemMax ?? DEFAULT_INFO_QUOTA.hookProblemMax);
  const breakdownPerShots = Math.max(
    1,
    Number(params.breakdownPerShots ?? DEFAULT_INFO_QUOTA.breakdownPerShots)
  );
  const breakdownMaxPer = Number(
    params.breakdownMaxPer ?? DEFAULT_INFO_QUOTA.breakdownMaxPer
  );
  const takeawayActionMax = Number(
    params.takeawayActionMax ?? DEFAULT_INFO_QUOTA.takeawayActionMax
  );

  const beats = ctx.shots.map(beatOf);
  const info = [];
  const tooLong = [];
  ctx.narration.forEach((line, index) => {
    const length = countChars(line);
    if (length > infoMax) {
      tooLong.push({ index, length, line });
      return;
    }
    if (length <= normalMax) return;
    const beat = beats[index] ?? null;
    const group =
      beat === "hook" || beat === "problem"
        ? "hook_problem"
        : beat === "takeaway" || beat === "action"
          ? "takeaway_action"
          : "breakdown";
    info.push({ index, length, line, beat, group, unassigned: !beat });
  });

  // 未标 beat 的镜头并入拆解额度，避免旧脚本因为缺 beat 误伤。
  const breakdownShotCount = beats.filter(
    (beat) => beat === "breakdown" || beat === null
  ).length || (info.some((item) => item.group === "breakdown") ? ctx.narration.length : 0);
  const breakdownMax =
    breakdownShotCount > 0
      ? Math.ceil(breakdownShotCount / breakdownPerShots) * breakdownMaxPer
      : 0;

  const budgets = {
    hook_problem: {
      label: "钩子+问题",
      max: hookProblemMax,
      candidates: info.filter((item) => item.group === "hook_problem"),
    },
    breakdown: {
      label: "拆解",
      max: breakdownMax,
      candidates: info.filter((item) => item.group === "breakdown"),
    },
    takeaway_action: {
      label: "结论+行动",
      max: takeawayActionMax,
      candidates: info.filter((item) => item.group === "takeaway_action"),
    },
  };

  const violations = [];
  for (const [group, budget] of Object.entries(budgets)) {
    if (budget.candidates.length <= budget.max) continue;
    const entries = budget.candidates.map(
      (item) => `第 ${item.index + 1} 句 ${item.length} 字：${item.line}`
    );
    violations.push({
      group,
      label: budget.label,
      count: budget.candidates.length,
      max: budget.max,
      entries,
    });
  }

  const occupied = info.map(
    (item) => `第 ${item.index + 1} 句（${budgets[item.group].label}）${item.length} 字：${item.line}`
  );
  const quotaSummary = Object.entries(budgets)
    .map(([, budget]) => `${budget.label} ${budget.candidates.length}/${budget.max}`)
    .join("，");

  return { normalMax, infoMax, info, tooLong, budgets, violations, occupied, quotaSummary };
};

/* ─────────────────────────────
 * 内置检查器
 * ───────────────────────────── */

/**
 * 每个检查器：(ctx, params) => {pass:boolean, detail:string, items:string[]}
 * pass=null 表示跳过（例如没有 research.md），引擎映射为 SKIP。
 * 可选 level 覆盖规则默认级别（C10 / C12 的 WARN 分支）。
 */
const CHECKS = {
  /** C01 首句够短 */
  first_sentence_length(ctx, params) {
    const max = Number(params.max ?? 14);
    const first = ctx.narration[0] ?? "";
    if (!first) {
      return { pass: false, detail: "没有 narration[0]", items: ["缺少首句"] };
    }
    const length = countChars(first);
    return {
      pass: length <= max,
      detail: `首句 ${length} 字（上限 ${max}）：${first}`,
      items: length <= max ? [] : [`首句 ${length} 字 > ${max}：${first}`],
    };
  },

  /** C02 单句长度（折中：≤16 普通句；17–22 信息句额度；≥23 FAIL） */
  sentence_length(ctx, params) {
    if (ctx.narration.length === 0) {
      return { pass: false, detail: "没有 narration", items: ["缺少旁白"] };
    }
    const analysis = analyzeInfoSentences(ctx, params);
    const items = [
      ...analysis.tooLong.map(
        (item) => `第 ${item.index + 1} 句 ${item.length} 字 ≥ 23：${item.line}`
      ),
      ...analysis.violations.flatMap((violation) => [
        `${violation.label}信息句超额度：${violation.count} 句 > ${violation.max} 句`,
        ...violation.entries.map((entry) => `占用额度的句子：${entry}`),
      ]),
    ];
    const occupiedDetail =
      analysis.occupied.length > 0
        ? `；信息句 ${analysis.occupied.length} 句（${analysis.quotaSummary}）：${analysis.occupied.join("；")}`
        : "；没有 17–22 字信息句";
    return {
      pass: items.length === 0,
      detail:
        items.length === 0
          ? `${ctx.narration.length} 句：普通句 ≤${analysis.normalMax}，信息句额度未超${occupiedDetail}`
          : `${items.length} 处句长问题${occupiedDetail}`,
      items,
    };
  },

  /** C21 信息句额度（与 C02 共用额度表） */
  info_sentence_quota(ctx, params) {
    const analysis = analyzeInfoSentences(ctx, params);
    const items = analysis.violations.flatMap((violation) => [
      `${violation.label}信息句超额度：${violation.count} 句 > ${violation.max} 句`,
      ...violation.entries.map((entry) => `占用额度的句子：${entry}`),
    ]);
    return {
      pass: items.length === 0,
      detail:
        items.length === 0
          ? `信息句额度未超（${analysis.quotaSummary}）`
          : `${items.length} 处信息句超额度（${analysis.quotaSummary}）`,
      items,
    };
  },

  /** C20 分行体：连续 ≥4 句每句 ≤8 字 */
  line_break_style(ctx, params) {
    const minRun = Math.max(2, Number(params.minRun ?? 4));
    const maxLength = Number(params.maxLength ?? 8);
    const lengths = ctx.sentences.map((sentence) => countChars(sentence));
    const items = [];
    let start = -1;
    const flush = (end) => {
      if (start >= 0 && end - start + 1 >= minRun) {
        items.push(
          `第 ${start + 1}–${end + 1} 句连续 ${end - start + 1} 句都 ≤${maxLength} 字：${ctx.sentences
            .slice(start, end + 1)
            .join("")}`
        );
      }
      start = -1;
    };
    lengths.forEach((length, index) => {
      if (length > 0 && length <= maxLength) {
        if (start < 0) start = index;
        return;
      }
      flush(index - 1);
    });
    flush(lengths.length - 1);
    return {
      pass: items.length === 0,
      detail:
        items.length === 0
          ? `没有连续 ${minRun} 句都 ≤${maxLength} 字的分行体`
          : `发现 ${items.length} 处分行体`,
      items,
    };
  },

  /** C22 过早总结：前 30% 字符内出现总结词 */
  early_summary(ctx, params) {
    const ratio = Number(params.ratio ?? 0.3);
    const patterns = listOfStrings(params.patterns).length
      ? listOfStrings(params.patterns)
      : ["总之", "总的来说", "一句话", "归根结底", "这就是.{0,8}(精神|关键|本质)"];
    const regexes = patterns.map((pattern) => new RegExp(pattern));
    const total = countChars(ctx.text);
    const threshold = total * ratio;
    let offset = 0;
    const items = [];
    for (const sentence of ctx.sentences) {
      const length = countChars(sentence);
      if (offset < threshold) {
        for (const regex of regexes) {
          const match = sentence.match(regex);
          if (match) {
            items.push(
              `全文前 ${Math.round(ratio * 100)}% 内出现总结套话「${match[0]}」：${sentence}`
            );
            break;
          }
        }
      }
      offset += length;
    }
    return {
      pass: items.length === 0,
      detail:
        items.length === 0
          ? `全文前 ${Math.round(ratio * 100)}% 没有过早总结`
          : `发现 ${items.length} 处过早总结`,
      items,
    };
  },

  /** C23 机械排比 / 同构开头 */
  mechanical_parallelism(ctx, params) {
    const prefixChars = Math.max(1, Number(params.prefixChars ?? 2));
    const minPrefixRun = Math.max(2, Number(params.minPrefixRun ?? 3));
    const fourCharRun = Math.max(2, Number(params.fourCharRun ?? 3));
    const fromToPattern = new RegExp(
      params.fromToPattern ?? "从.{1,8}到.{1,8}[，,].{0,4}从.{1,8}到"
    );
    const items = [];

    for (const run of prefixRuns(ctx.sentences, prefixChars)) {
      if (run.length < minPrefixRun) continue;
      items.push(
        `第 ${run.start + 1}–${run.end + 1} 句连续 ${run.length} 句以「${run.prefix}」开头：${ctx.sentences
          .slice(run.start, run.end + 1)
          .join("")}`
      );
    }

    for (const sentence of ctx.sentences) {
      for (const run of fourCharRuns(sentence, fourCharRun)) {
        items.push(`连续 ${run.words.length} 个四字词：${run.words.join("、")}`);
      }
    }

    for (const sentence of ctx.sentences) {
      const match = sentence.match(fromToPattern);
      if (match) items.push(`「从…到…」排比：${match[0]}`);
    }

    return {
      pass: items.length === 0,
      detail: items.length === 0 ? "没有机械排比或同构开头" : `发现 ${items.length} 处机械排比`,
      items,
    };
  },

  /** C26 长短交替提示 */
  length_alternation(ctx, params) {
    const minRun = Math.max(2, Number(params.minRun ?? 5));
    const minLength = Number(params.minLength ?? 12);
    const maxLength = Number(params.maxLength ?? 16);
    const maxDiff = Number(params.maxDiff ?? 2);
    const lengths = ctx.sentences.map((sentence) => countChars(sentence));
    const items = [];
    let start = -1;
    const flush = (end) => {
      if (start >= 0 && end - start + 1 >= minRun) {
        items.push(
          `第 ${start + 1}–${end + 1} 句连续 ${end - start + 1} 句都在 ${minLength}–${maxLength} 字且相邻差 ≤${maxDiff}：${ctx.sentences
            .slice(start, end + 1)
            .join("")}`
        );
      }
      start = -1;
    };
    lengths.forEach((length, index) => {
      const inRange = length >= minLength && length <= maxLength;
      const previous = lengths[index - 1];
      const close =
        inRange &&
        previous !== undefined &&
        previous >= minLength &&
        previous <= maxLength &&
        Math.abs(length - previous) <= maxDiff;
      if (inRange && (start < 0 || close)) {
        if (start < 0) start = index;
        return;
      }
      flush(index - 1);
      if (inRange) start = index;
    });
    flush(lengths.length - 1);
    return {
      pass: items.length === 0,
      detail:
        items.length === 0
          ? "长短有交替，没有连续 5 句长度过近"
          : `发现 ${items.length} 处长句连排，建议拆入短句落点`,
      items,
    };
  },

  /** C10 假对比句式（保留明确纠正对象时降为 WARN） */
  contrast_pattern(ctx, params) {
    const patterns = listOfStrings(params.patterns).length
      ? listOfStrings(params.patterns)
      : ["不是.{1,12}而是", "不只是.{1,12}更是", "并非.{1,12}而是"];
    const regexes = patterns.map((pattern) => new RegExp(pattern));
    const configured = Array.isArray(params.correctionNouns)
      ? params.correctionNouns
      : DEFAULT_CORRECTION_NOUNS;
    const pairGroups =
      configured.length > 0 && configured.every((item) => Array.isArray(item))
        ? configured
        : null;
    const flatNouns = pairGroups ? [] : listOfStrings(configured);
    const hasCorrectionTarget = (sentence) => {
      if (pairGroups) {
        return pairGroups.some(
          (group) =>
            Array.isArray(group) &&
            group.length > 0 &&
            group.every((noun) => typeof noun === "string" && sentence.includes(noun))
        );
      }
      return flatNouns.filter((noun) => sentence.includes(noun)).length >= 2;
    };

    const hard = [];
    const soft = [];
    for (const sentence of ctx.sentences) {
      for (const regex of regexes) {
        if (!regex.test(sentence)) continue;
        if (hasCorrectionTarget(sentence)) soft.push(sentence);
        else hard.push(sentence);
        break;
      }
    }
    const items = [
      ...hard.map((sentence) => `假对比句式：${sentence}`),
      ...soft.map((sentence) => `含明确纠正对象的对比句（可保留，建议人工确认）：${sentence}`),
    ];
    const level = hard.length > 0 ? "FAIL" : "WARN";
    return {
      pass: items.length === 0,
      ...(items.length > 0 ? { level } : {}),
      detail:
        items.length === 0
          ? "没有「不是…而是…」类假对比句式"
          : `命中 ${items.length} 处对比句（${hard.length} 处需改，${soft.length} 处可保留）`,
      items,
    };
  },

  /** C03 镜句对齐 */
  shot_alignment(ctx) {
    const narrationCount = ctx.narration.length;
    const shotCount = ctx.shots.length;
    const pass = narrationCount === shotCount;
    return {
      pass,
      detail: `narration ${narrationCount} 条 / shots ${shotCount} 个`,
      items: pass
        ? []
        : [`narration 有 ${narrationCount} 条，shots 有 ${shotCount} 个，数量不一致`],
    };
  },

  /** C04 总字数 */
  total_chars(ctx, params) {
    const min = Number(params.min ?? 300);
    const max = Number(params.max ?? 800);
    const shortMin = Number(params.shortMin ?? 60);
    const shortMax = Number(params.shortMax ?? 120);
    const shortShotMax = Number(params.shortShotMax ?? 12);
    const isShort =
      ctx.script?.length === "short" || ctx.shots.length <= shortShotMax;
    const low = isShort ? shortMin : min;
    const high = isShort ? shortMax : max;
    const total = countChars(ctx.text);
    const pass = total >= low && total <= high;
    return {
      pass,
      detail: `全文 ${total} 字（${isShort ? `短版 ${low}–${high}` : `长版 ${low}–${high}`}）`,
      items: pass ? [] : [`全文 ${total} 字，不在 ${low}–${high} 区间`],
    };
  },

  /** C05 point 必填 */
  point_present(ctx, params) {
    const min = Number(params.min ?? 1);
    const max = Number(params.max ?? 20);
    const items = [];
    ctx.shots.forEach((shot, index) => {
      const point = trimText(shot?.point);
      const length = countChars(point);
      if (!point) items.push(`镜 ${index + 1} 缺少 point`);
      else if (length < min || length > max) {
        items.push(`镜 ${index + 1} 的 point ${length} 字，不在 ${min}–${max}：${point}`);
      }
    });
    return {
      pass: items.length === 0,
      detail:
        items.length === 0
          ? `${ctx.shots.length} 个镜头都有 ${min}–${max} 字的 point`
          : `${items.length} 个镜头的 point 不合规`,
      items,
    };
  },

  /** C06 point 不复读 */
  point_repeat(ctx, params) {
    const maxRatio = Number(params.maxRatio ?? 0.3);
    const total = ctx.shots.length;
    const same = [];
    ctx.shots.forEach((shot, index) => {
      const point = trimText(shot?.point);
      const narration = trimText(ctx.narration[index]);
      if (point && narration && point === narration) same.push({ index, point });
    });
    const ratio = total > 0 ? same.length / total : 0;
    const pass = ratio <= maxRatio + 1e-9;
    return {
      pass,
      detail: `${same.length}/${total} 镜的 point 与旁白完全相同（上限 ${Math.round(maxRatio * 100)}%）`,
      items: pass
        ? []
        : same.map(({ index, point }) => `镜 ${index + 1}：point 与旁白相同「${point}」`),
    };
  },

  /** C07 五段齐全且顺序正确 */
  beats_complete(ctx) {
    const beats = ctx.shots.map(beatOf);
    const present = new Set(beats.filter(Boolean));
    const missing = BEAT_SEQUENCE.filter((beat) => !present.has(beat));
    const items = [];
    if (missing.length > 0) {
      items.push(
        `缺少段落：${missing.map((beat) => `${BEAT_LABELS[beat]}（${beat}）`).join("、")}`
      );
    }
    let lastIndex = -1;
    beats.forEach((beat, index) => {
      if (!beat) return;
      const order = BEAT_SEQUENCE.indexOf(beat);
      if (order < lastIndex) {
        items.push(
          `镜 ${index + 1} 的 ${beat} 出现在 ${BEAT_SEQUENCE[lastIndex]} 之后，顺序不对`
        );
      } else {
        lastIndex = order;
      }
    });
    return {
      pass: items.length === 0,
      detail:
        items.length === 0
          ? `五段齐全且顺序正确：${BEAT_SEQUENCE.join(" → ")}`
          : `${items.length} 个节奏问题`,
      items,
    };
  },

  /**
   * C08 钩子在 3 秒内 + C08a 万能开头。
   * 第一镜 beat=hook；前 3 秒 captions 与 narration[0..2] 都要过 openerPattern。
   */
  hook_within_3s(ctx, params) {
    const seconds = Number(params.seconds ?? 3);
    const narrationLines = Math.max(1, Number(params.narrationLines ?? 3));
    const pattern = new RegExp(
      params.openerPattern ?? params.pattern ?? DEFAULT_OPENER_PATTERN,
      params.flags ?? ""
    );
    const matches = (text) => {
      pattern.lastIndex = 0;
      return pattern.test(text);
    };
    const items = [];
    const beats = ctx.shots.map(beatOf);
    if (ctx.shots.length === 0) {
      items.push("没有 shots，无法确认第一镜 beat=hook");
    } else if (beats[0] !== "hook") {
      const hookIndex = beats.indexOf("hook");
      items.push(
        hookIndex === -1
          ? "第一镜没有标 beat=hook（也没有任何 hook 镜）"
          : `第一个 hook 镜是第 ${hookIndex + 1} 镜，第一镜必须是 hook`
      );
    }

    // C08a：无论有没有 captions，旁白前三句都查。
    ctx.narration.slice(0, narrationLines).forEach((line, index) => {
      if (line && matches(line)) {
        items.push(`narration 第 ${index + 1} 句命中万能开头（C08a）：${line}`);
      }
    });

    const measured = ctx.captions
      .map((caption) => ({
        start: captionStartSeconds(caption, ctx.fps),
        text: trimText(caption?.text),
      }))
      .filter((caption) => caption.text && caption.start !== null && caption.start < seconds);

    let detail;
    if (ctx.captions.length > 0) {
      const texts = measured.map((caption) => caption.text);
      for (const text of texts) {
        if (matches(text)) items.push(`前 ${seconds} 秒字幕命中万能开头（C08a）：${text}`);
      }
      detail =
        texts.length > 0
          ? `captions 实测前 ${seconds} 秒 ${texts.length} 句 + narration[0..${narrationLines - 1}] 均不命中 C08a`
          : `captions 实测前 ${seconds} 秒没有可检查的字幕；已检查 narration[0..${narrationLines - 1}]`;
    } else {
      detail = `未用实测时间（没有 captions），退回检查 narration[0..${narrationLines - 1}]（C08a）`;
    }

    return {
      pass: items.length === 0,
      detail,
      items,
    };
  },

  /** C11 结尾动作；短版允许结论事实句 + 行动动词镜 */
  ending_action(ctx, params) {
    const verbs = listOfStrings(params.verbs).length
      ? listOfStrings(params.verbs)
      : DEFAULT_ACTION_VERBS;
    const leadingWords = listOfStrings(params.leadingWords).length
      ? listOfStrings(params.leadingWords)
      : ["现在", "今天", "先", "就"];
    const lastN = Math.max(1, Number(params.lastN ?? 2));
    const strip = (sentence) => {
      let value = stripLeadingPunct(sentence);
      let changed = true;
      while (changed) {
        changed = false;
        for (const word of leadingWords) {
          if (value.startsWith(word)) {
            value = value.slice(word.length).replace(/^[\s\p{P}\p{S}]+/u, "");
            changed = true;
          }
        }
      }
      return value;
    };
    const isShort =
      ctx.script?.length === "short" || ctx.shots.length <= 12;
    const candidates = ctx.sentences.slice(-lastN);
    if (isShort) {
      // 结论镜可以是事实句，只要行动镜还是动作动词开头。
      ctx.shots.forEach((shot, index) => {
        if (beatOf(shot) !== "action") return;
        const narration = trimText(ctx.narration[index]);
        if (narration && !candidates.includes(narration)) candidates.push(narration);
      });
    }
    if (candidates.length === 0) {
      return { pass: false, detail: "没有可检查的结尾句子", items: ["缺少旁白"] };
    }
    let matchedVerb = "";
    let matchedSentence = "";
    for (const sentence of candidates) {
      const stripped = strip(sentence);
      const verb = verbs.find((item) => stripped.startsWith(item));
      if (verb) {
        matchedVerb = verb;
        matchedSentence = sentence;
        break;
      }
    }
    return {
      pass: Boolean(matchedVerb),
      detail: matchedVerb
        ? `${isShort ? "短版" : "结尾"}行动镜以动作「${matchedVerb}」开头：${matchedSentence}`
        : `最后 ${candidates.length} 句都不是动作开头`,
      items: matchedVerb
        ? []
        : candidates.map((sentence) => `结尾不是动作动词开头：${sentence}`),
    };
  },

  /** C12 结尾问句判定（并入 C12a 口号词表） */
  ending_question(ctx, params) {
    const last = ctx.sentences.at(-1) ?? "";
    if (!last) {
      return { pass: false, detail: "没有可检查的结尾句子", items: ["缺少旁白"] };
    }
    const emptyPattern = new RegExp(
      params.emptyQuestionPattern ?? DEFAULT_EMPTY_QUESTION_PATTERN
    );
    const sloganPattern = new RegExp(params.sloganPattern ?? DEFAULT_SLOGAN_PATTERN);
    const sloganLastN = Math.max(1, Number(params.sloganLastN ?? 2));
    const concreteNouns = listOfStrings(params.concreteNouns).length
      ? listOfStrings(params.concreteNouns)
      : DEFAULT_CONCRETE_NOUNS;
    const isQuestion =
      /[？?]/.test(last) || /(吗|呢)\s*[。！!]?\s*$/.test(last);
    const items = [];

    // C12a：结尾口号词表
    const sloganSentences = ctx.sentences.slice(-sloganLastN);
    for (const sentence of sloganSentences) {
      const match = sentence.match(sloganPattern);
      if (match) items.push(`结尾命中 C12a 口号词：「${match[0]}」：${sentence}`);
    }

    let level = "FAIL";
    let detail;
    if (items.length > 0) {
      detail = `结尾有口号腔（C12a）`;
    } else if (emptyPattern.test(last)) {
      items.push(`结尾是口号式空问：${last}`);
      detail = "结尾是口号式空问（C12 error）";
    } else if (isQuestion) {
      const nouns = concreteNouns.filter((noun) => last.includes(noun));
      if (nouns.length > 0) {
        level = "WARN";
        items.push(
          `结尾是具体留白问题（对象：${nouns.join("、")}），行动段宜改成动作：${last}`
        );
        detail = "具体留白问题：WARN，不直接拦渲染";
      } else {
        items.push(`结尾问句没有具体对象，按空问处理：${last}`);
        detail = "结尾问句没有具体对象（C12 error）";
      }
    } else {
      detail = `结尾不是问句，动作由 C11 检查：${last}`;
    }

    return {
      pass: items.length === 0,
      ...(items.length > 0 ? { level } : {}),
      detail,
      items,
    };
  },

  /** 兼容旧自定义规则：旧版「结尾不反问」只看最后一句。 */
  ending_not_question(ctx, params) {
    const pattern = new RegExp(params.pattern ?? "([？?]|吗|呢)\\s*[。！!]?\\s*$");
    const last = ctx.sentences.at(-1) ?? "";
    if (!last) {
      return { pass: false, detail: "没有可检查的结尾句子", items: ["缺少旁白"] };
    }
    const pass = !pattern.test(last);
    return {
      pass,
      detail: pass ? `最后一句不是反问：${last}` : `最后一句是反问/疑问：${last}`,
      items: pass ? [] : [`最后一句不能是反问：${last}`],
    };
  },

  /** C13 术语解释（WARN） */
  jargon_explained(ctx, params) {
    const terms = listOfStrings(params.terms).length
      ? listOfStrings(params.terms)
      : DEFAULT_TERMS;
    const markers = listOfStrings(params.markers).length
      ? listOfStrings(params.markers)
      : DEFAULT_EXPLAIN_MARKERS;
    const sentences = ctx.sentences;
    const lowerSentences = sentences.map((sentence) => sentence.toLowerCase());
    const items = [];
    for (const term of terms) {
      const lowerTerm = term.toLowerCase();
      const index = lowerSentences.findIndex((sentence) => sentence.includes(lowerTerm));
      if (index === -1) continue;
      const current = lowerSentences[index] ?? "";
      const next = lowerSentences[index + 1] ?? "";
      const explained = markers.some(
        (marker) =>
          current.includes(marker.toLowerCase()) || next.includes(marker.toLowerCase())
      );
      if (!explained) {
        items.push(`术语「${term}」首次出现在第 ${index + 1} 句，同句或下一句没有解释`);
      }
    }
    return {
      pass: items.length === 0,
      detail:
        items.length === 0
          ? "出现的术语都有白话解释"
          : `${items.length} 个术语没有解释`,
      items,
    };
  },

  /** C14 同句式开头：只报连续=2；连续 ≥3 交给 C23 */
  consecutive_same_prefix(ctx, params) {
    const maxRun = Math.max(2, Number(params.maxRun ?? 2));
    const prefixChars = Math.max(1, Number(params.prefixChars ?? 2));
    const runs = prefixRuns(ctx.sentences, prefixChars);
    const reported = runs.filter((run) => run.length === maxRun);
    const items = reported.map(
      (run) =>
        `第 ${run.start + 1}–${run.end + 1} 句连续 ${run.length} 句以「${run.prefix}」开头`
    );
    const longest = runs.reduce((max, run) => Math.max(max, run.length), 1);
    return {
      pass: items.length === 0,
      detail:
        items.length === 0
          ? `没有连续 ${maxRun} 句同开头（最长 ${longest} 句，连续 ≥3 句由 C23 报）`
          : `${items.length} 处连续 ${maxRun} 句同开头（连续 ≥3 句由 C23 报）`,
      items,
    };
  },

  /** C15 第一人称（WARN） */
  first_person(ctx, params) {
    const token = typeof params.token === "string" && params.token ? params.token : "我";
    const min = Math.max(1, Number(params.min ?? 2));
    const count = Array.from(ctx.text).filter((ch) => ch === token).length;
    return {
      pass: count >= min,
      detail: `全文出现「${token}」${count} 次（至少 ${min} 次）`,
      items: count >= min ? [] : [`「${token}」只出现 ${count} 次，建议用第一人称讲自己的经历`],
    };
  },

  /** C16 排比（WARN） */
  parallelism(ctx) {
    const items = [];

    // 连续 3 句字数相同且前 2 字相同
    const chars = ctx.sentences.map((sentence) => countChars(sentence));
    const prefixes = ctx.sentences.map((sentence) => prefixOf(sentence, 2));
    for (let i = 0; i + 2 < ctx.sentences.length; i++) {
      if (
        prefixes[i] &&
        prefixes[i] === prefixes[i + 1] &&
        prefixes[i] === prefixes[i + 2] &&
        chars[i] === chars[i + 1] &&
        chars[i] === chars[i + 2]
      ) {
        items.push(
          `第 ${i + 1}–${i + 3} 句字数相同且开头相同：${ctx.sentences
            .slice(i, i + 3)
            .join("")}`
        );
      }
    }

    // 连续 3 个四字词以顿号/逗号分隔
    for (const sentence of ctx.sentences) {
      const words = sentence
        .split(/[、，,]/)
        .map((word) => stripLeadingPunct(word).replace(/[。！？!?；;\s]+$/g, ""))
        .filter(Boolean);
      const isFourChar = (word) => countChars(word) === 4 && Array.from(word).length === 4;
      for (let i = 0; i + 2 < words.length; i++) {
        if (isFourChar(words[i]) && isFourChar(words[i + 1]) && isFourChar(words[i + 2])) {
          items.push(
            `连续 3 个四字词：${words.slice(i, i + 3).join("、")}`
          );
        }
      }
    }

    return {
      pass: items.length === 0,
      detail: items.length === 0 ? "没有发现排比" : `发现 ${items.length} 处排比`,
      items,
    };
  },

  /** C18 数字有出处（WARN） */
  numbers_sourced(ctx) {
    if (!ctx.research.trim()) {
      return {
        pass: null,
        detail: "未提供 research.md，跳过数字出处检查",
        items: [],
      };
    }
    const sentences = ctx.sentences.filter(
      (sentence) => /\d/.test(sentence) || /百分之|倍/.test(sentence)
    );
    const numbers = [
      ...new Set(
        sentences.flatMap((sentence) => sentence.match(/\d+(?:\.\d+)?/g) ?? [])
      ),
    ];
    if (numbers.length === 0) {
      return {
        pass: true,
        detail: "没有需要核对出处的阿拉伯数字（百分之/倍 未带数字，跳过）",
        items: [],
      };
    }
    const missing = numbers.filter((number) => !ctx.research.includes(number));
    return {
      pass: missing.length === 0,
      detail:
        missing.length === 0
          ? `${numbers.length} 个数字都能在 research.md 找到`
          : `${missing.length}/${numbers.length} 个数字在 research.md 找不到`,
      items: missing.map((number) => `数字 ${number} 在 research.md 里找不到出处`),
    };
  },
};

export const BUILTIN_CHECKS = Object.keys(CHECKS).sort();

export const BUILTIN_CHECK_INFO = {
  first_sentence_length: "C01 首句够短",
  sentence_length: "C02 单句长度（折中）",
  shot_alignment: "C03 镜句对齐",
  total_chars: "C04 总字数",
  point_present: "C05 point 必填",
  point_repeat: "C06 point 不复读",
  beats_complete: "C07 五段齐全",
  hook_within_3s: "C08 钩子在 3 秒内（C08a 万能开头）",
  contrast_pattern: "C10 假对比句式",
  ending_action: "C11 结尾动作",
  ending_question: "C12 结尾问句判定（C12a 口号）",
  ending_not_question: "C12 旧版结尾问句检查（兼容）",
  jargon_explained: "C13 术语解释",
  consecutive_same_prefix: "C14 同句式开头",
  first_person: "C15 第一人称",
  parallelism: "C16 等长排比",
  numbers_sourced: "C18 数字有出处",
  line_break_style: "C20 分行体",
  info_sentence_quota: "C21 信息句额度",
  early_summary: "C22 过早总结",
  mechanical_parallelism: "C23 机械排比 / 同构开头",
  length_alternation: "C26 长短交替提示",
};

/* ─────────────────────────────
 * regex 检查器
 * ───────────────────────────── */

const compileRegex = (pattern, flags = "") => {
  const safeFlags = flags.includes("g") ? flags : `${flags}g`;
  return new RegExp(pattern, safeFlags);
};

const runRegexCheck = (ctx, params) => {
  const patterns = listOfStrings(params.patterns).length
    ? listOfStrings(params.patterns)
    : listOfStrings([params.pattern]);
  if (patterns.length === 0) {
    return { pass: true, detail: "没有配置 pattern，跳过", items: [] };
  }
  const flags = typeof params.flags === "string" ? params.flags : "";
  const max = Number(params.max ?? 0);
  const hits = [];
  for (const pattern of patterns) {
    const regex = compileRegex(pattern, flags);
    for (const match of ctx.text.matchAll(regex)) {
      hits.push(match[0]);
    }
  }
  const unique = [...new Set(hits)];
  const pass = hits.length <= max;
  return {
    pass,
    detail:
      hits.length === 0
        ? "0 处命中"
        : `命中 ${hits.length} 处（上限 ${max}）${unique.length ? `：${unique.slice(0, 8).join("、")}` : ""}`,
    items: pass
      ? []
      : unique.slice(0, 8).map((hit) => `命中「${hit}」`),
  };
};

/* ─────────────────────────────
 * 规则加载与校验
 * ───────────────────────────── */

const fail = (message) => {
  throw new Error(message);
};

/** 规则文件优先级：--rules > 项目目录 > 仓库根。不存在则返回 null。 */
export const resolveRulesFile = ({ rulesFile, projectDir } = {}) => {
  if (typeof rulesFile === "string" && rulesFile.trim()) {
    return path.isAbsolute(rulesFile) ? rulesFile : path.resolve(ROOT, rulesFile);
  }
  if (typeof projectDir === "string" && projectDir.trim()) {
    const candidate = path.join(path.resolve(projectDir), DEFAULT_PROJECT_RULES_NAME);
    if (fs.existsSync(candidate)) return candidate;
  }
  if (fs.existsSync(DEFAULT_RULES_FILE)) return DEFAULT_RULES_FILE;
  return null;
};

const validateRule = (rule, index, source, seen) => {
  const where = `${source} 第 ${index + 1} 条规则`;
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
    fail(`${where} 不是对象`);
  }
  const id = trimText(rule.id);
  if (!id) fail(`${where} 缺少字段 id（非空字符串）`);
  if (seen.has(id)) fail(`${where}（${id}）的 id 重复：${id}`);
  seen.add(id);

  const name = trimText(rule.name);
  if (!name) fail(`${where}（${id}）缺少字段 name（中文名，非空字符串）`);

  const description = trimText(rule.description);

  const type = trimText(rule.type);
  if (!RULE_TYPES.includes(type)) {
    fail(
      `${where}（${id}）的 type 必须是 ${RULE_TYPES.join(" / ")}，收到 ${JSON.stringify(rule.type)}`
    );
  }

  const level = trimText(rule.level);
  if (!RULE_LEVELS.includes(level)) {
    fail(
      `${where}（${id}）的 level 必须是 ${RULE_LEVELS.join(" / ")}，收到 ${JSON.stringify(rule.level)}`
    );
  }

  const stage = rule.stage === undefined ? "draft" : trimText(rule.stage);
  if (!RULE_STAGES.includes(stage)) {
    fail(
      `${where}（${id}）的 stage 必须是 ${RULE_STAGES.join(" / ")}，收到 ${JSON.stringify(rule.stage)}`
    );
  }

  const draftStatus =
    rule.draftStatus === undefined ? undefined : trimText(rule.draftStatus);
  if (draftStatus !== undefined && !["PASS", "SKIP"].includes(draftStatus)) {
    fail(
      `${where}（${id}）的 draftStatus 必须是 PASS / SKIP，收到 ${JSON.stringify(rule.draftStatus)}`
    );
  }

  const enabled = rule.enabled === undefined ? true : rule.enabled;
  if (typeof enabled !== "boolean") {
    fail(`${where}（${id}）的 enabled 必须是布尔值，收到 ${JSON.stringify(rule.enabled)}`);
  }

  const params =
    rule.params === undefined ? {} : rule.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    fail(`${where}（${id}）的 params 必须是对象`);
  }

  const check = trimText(rule.check);
  if (type === "builtin") {
    if (!check) fail(`${where}（${id}）缺少字段 check（builtin 检查器名）`);
    if (!Object.hasOwn(CHECKS, check)) {
      fail(
        `${where}（${id}）的 check 不存在：${check}（可用 ${BUILTIN_CHECKS.join(" / ")}）`
      );
    }
  }

  if (type === "regex") {
    const patterns = listOfStrings(params.patterns).length
      ? listOfStrings(params.patterns)
      : listOfStrings([params.pattern]);
    if (patterns.length === 0) {
      fail(`${where}（${id}）的 params 缺少 pattern 或 patterns（非空字符串）`);
    }
    const flags = typeof params.flags === "string" ? params.flags : "";
    for (const pattern of patterns) {
      try {
        compileRegex(pattern, flags);
      } catch (err) {
        fail(
          `${where}（${id}）的 params.pattern 无法编译：${JSON.stringify(pattern)}（${err?.message ?? err}）`
        );
      }
    }
  }

  const prompt = trimText(rule.prompt);
  if (type === "llm" && !prompt) {
    fail(`${where}（${id}）缺少字段 prompt（LLM 检查说明，非空字符串）`);
  }

  return {
    id,
    name,
    description,
    type,
    ...(type === "builtin" ? { check } : {}),
    params: { ...params },
    ...(prompt ? { prompt } : {}),
    level,
    stage,
    ...(draftStatus ? { draftStatus } : {}),
    enabled,
  };
};

/**
 * 校验并规范化规则数据。
 * @param {{version?:number,rules?:any[]}|any[]} data
 * @param {string} [source]
 */
export const validateRules = (data, source = "内容规则") => {
  if (Array.isArray(data)) {
    const seen = new Set();
    return data.map((rule, index) => validateRule(rule, index, source, seen));
  }
  if (!data || typeof data !== "object") {
    fail(`${source} 必须是 JSON 对象`);
  }
  if (data.version !== 2) {
    fail(
      `${source} 的 version 必须是 2，收到 ${JSON.stringify(data.version)}`
    );
  }
  if (!Array.isArray(data.rules)) {
    fail(`${source} 缺少 rules 数组`);
  }
  const seen = new Set();
  return data.rules.map((rule, index) => validateRule(rule, index, source, seen));
};

/**
 * 读取并校验规则文件。
 * @param {string|{version?:number,rules?:any[]}|any[]} [file]
 */
export const loadRules = (file = DEFAULT_RULES_FILE) => {
  if (Array.isArray(file) || (file && typeof file === "object")) {
    return validateRules(file, "内容规则");
  }
  const filePath = path.resolve(String(file));
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    fail(`读不到内容规则文件：${filePath}（${err?.message ?? err}）`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    fail(`内容规则文件不是合法 JSON：${filePath}（${err?.message ?? err}）`);
  }
  return validateRules(data, `内容规则文件 ${filePath}`);
};

/* ─────────────────────────────
 * 执行
 * ───────────────────────────── */

const normalizeResearch = (research) => {
  if (typeof research === "string") return research;
  if (research === undefined || research === null) return "";
  try {
    return JSON.stringify(research);
  } catch {
    return "";
  }
};

const buildContext = ({ script, captions, research }) => {
  const narration = Array.isArray(script?.narration)
    ? script.narration.map((line) => String(line ?? "").trim())
    : [];
  const shots = Array.isArray(script?.shots) ? script.shots : [];
  const text = narration.join("\n");
  return {
    script,
    narration,
    shots,
    text,
    sentences: splitSentences(text),
    captions: normalizeCaptions(captions),
    research: normalizeResearch(research),
    fps: Number(script?.fps) > 0 ? Number(script.fps) : 30,
  };
};

const baseResult = (rule) => ({
  id: rule.id,
  name: rule.name,
  type: rule.type,
  level: rule.level,
  stage: rule.stage,
  status: "SKIP",
  detail: "",
  items: [],
});

/**
 * 跑非 LLM 规则（LLM 规则返回 SKIP 占位，交给 content-qc）。
 * @param {{script?:any, captions?:any, research?:string, rules?:any, stage?:"draft"|"render"}} params
 * @returns {{id:string,name:string,type:string,level:string,stage:string,
 *   status:"PASS"|"WARN"|"FAIL"|"SKIP"|"DISABLED",detail:string,items:string[]}[]}
 */
export const runRules = ({
  script,
  captions,
  research = "",
  rules,
  stage = "draft",
} = {}) => {
  if (!RULE_STAGES.includes(stage)) {
    fail(`stage 必须是 ${RULE_STAGES.join(" / ")}，收到 ${JSON.stringify(stage)}`);
  }
  const list = rules === undefined ? [] : loadRules(rules);
  const ctx = buildContext({ script, captions, research });

  return list.map((rule) => {
    const result = baseResult(rule);
    if (!rule.enabled) {
      return { ...result, status: "DISABLED", detail: "规则已禁用" };
    }
    if (rule.stage === "render" && stage !== "render") {
      const draftStatus = rule.draftStatus ?? "SKIP";
      return {
        ...result,
        status: draftStatus,
        detail:
          draftStatus === "PASS"
            ? `草稿阶段不拦截（${rule.id} 只在 render 阶段检查）`
            : `只在 render 阶段生效（当前 ${stage}）`,
      };
    }
    if (rule.type === "llm") {
      return {
        ...result,
        status: "SKIP",
        detail: "LLM 规则由 content-qc 执行",
      };
    }

    let outcome;
    try {
      outcome =
        rule.type === "regex"
          ? runRegexCheck(ctx, rule.params)
          : CHECKS[rule.check](ctx, rule.params);
    } catch (err) {
      return {
        ...result,
        status: "SKIP",
        detail: `规则执行失败：${err?.message ?? err}`,
      };
    }

    if (outcome.pass === null) {
      return { ...result, status: "SKIP", detail: outcome.detail, items: outcome.items ?? [] };
    }
    const status = outcome.pass
      ? "PASS"
      : RULE_LEVELS.includes(outcome.level)
        ? outcome.level
        : rule.level;
    return {
      ...result,
      status,
      detail: outcome.detail,
      items: outcome.items ?? [],
    };
  });
};

/** 汇总状态：FAIL > WARN > PASS > SKIP。 */
export const overallStatus = (results) => {
  const statuses = (Array.isArray(results) ? results : []).map((item) => item.status);
  if (statuses.includes("FAIL")) return "FAIL";
  if (statuses.includes("WARN")) return "WARN";
  if (statuses.includes("PASS")) return "PASS";
  return "SKIP";
};

export default runRules;
