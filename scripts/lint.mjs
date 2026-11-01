#!/usr/bin/env node
/**
 * 脚本文案 lint：结构检查 + 五段节奏建议 + qc-rules.json 的非 LLM 内容规则。
 *
 * 用法：
 *   stickman lint --project examples/sample
 *   stickman lint --project examples/sample --rules qc-rules.json
 *   stickman lint --project examples/sample --stage render
 *   stickman lint --project examples/sample --captions public/sample-captions.json
 *
 * 自动发现：
 *   - research.md：<项目目录>/research.md，供 C18「数字有出处」；
 *   - captions：public/<目录名>-captions.json 或 <项目目录>/captions.json，供 C08 实测时间。
 *
 * 退出码：有 FAIL 为 1；只有 WARN / INFO / SKIP 为 0。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  beatOf,
  countChars,
  loadRules,
  overallStatus,
  resolveRulesFile,
  runRules,
} from "./content-rules.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 规范五段：字数 / 镜头数 / 时长区间。短版各段压到 1–2 镜。
 * weight 保留作参考（钩子 10% / 问题 15% / 拆解 45% / 结论 15% / 行动 15%）。
 */
export const BEAT_PLAN = [
  {
    role: "hook",
    label: "钩子",
    weight: 0.1,
    chars: [30, 60],
    shots: [3, 5],
    seconds: [6, 12],
    shortShots: [1, 2],
    shortSeconds: [2, 4],
  },
  {
    role: "problem",
    label: "问题",
    weight: 0.15,
    chars: [60, 120],
    shots: [5, 8],
    seconds: [12, 24],
    shortShots: [1, 2],
    shortSeconds: [3, 6],
  },
  {
    role: "breakdown",
    label: "拆解",
    weight: 0.45,
    chars: [150, 450],
    shots: [12, 30],
    seconds: [30, 90],
    shortShots: [1, 2],
    shortSeconds: [7, 12],
  },
  {
    role: "takeaway",
    label: "结论",
    weight: 0.15,
    chars: [30, 80],
    shots: [2, 5],
    seconds: [6, 16],
    shortShots: [1, 2],
    shortSeconds: [3, 6],
  },
  {
    role: "action",
    label: "行动",
    weight: 0.15,
    chars: [15, 50],
    shots: [1, 3],
    seconds: [4, 10],
    shortShots: [1, 2],
    shortSeconds: [2, 5],
  },
];

/** 兼容旧字段：beatRole 枚举（conclusion 仍可写，引擎会映射成 takeaway）。 */
export const BEAT_ROLES = ["hook", "problem", "breakdown", "conclusion", "action"];

const round2 = (value) => Math.round(value * 100) / 100;

const parseArgs = (argv) => {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq > 2) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
};

const durationOf = (shot) => {
  const value = Number(shot?.duration);
  return Number.isFinite(value) && value > 0 ? value : 0;
};

const fmtRange = ([low, high]) => `${low}–${high}`;

/**
 * 纯函数：检查脚本结构与节奏。
 * @param {{length?: string, shots?: any[], narration?: any[]}} script
 * @returns {{items: {level: "ERROR"|"WARN"|"INFO", code: string, message: string}[],
 *   pacing: any[], totalSec: number}}
 */
export const lintScript = (script) => {
  const items = [];
  const emptyPacing = BEAT_PLAN.map((beat) => ({
    role: beat.role,
    label: beat.label,
    actualShots: 0,
    actualSec: 0,
    actualChars: 0,
    suggestedSec: 0,
    suggestedSecRange: beat.seconds,
    suggestedShotRange: beat.shots,
    suggestedCharRange: beat.chars,
  }));

  if (!script || typeof script !== "object" || Array.isArray(script)) {
    items.push({
      level: "ERROR",
      code: "no-script",
      message: "script.json 不是有效对象",
    });
    return { items, pacing: emptyPacing, totalSec: 0 };
  }

  const shots = Array.isArray(script.shots) ? script.shots : null;
  if (!shots || shots.length === 0) {
    items.push({
      level: "ERROR",
      code: "no-shots",
      message: "script.json 缺少 shots（或 shots 为空）",
    });
    return { items, pacing: emptyPacing, totalSec: 0 };
  }

  const narration = Array.isArray(script.narration) ? script.narration : [];

  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const index = i + 1;
    if (!shot || typeof shot !== "object") {
      items.push({
        level: "WARN",
        code: "invalid-shot",
        message: `shot ${index} 不是对象`,
      });
      continue;
    }
    const point = typeof shot.point === "string" ? shot.point.trim() : "";
    if (!point) {
      // 保留原有行为：结构 lint 里 point 缺失只算 WARN；C05 会按规则级别报 FAIL。
      items.push({
        level: "WARN",
        code: "missing-point",
        message: `shot ${index} 缺少 point`,
      });
    }
    if (shot.beatRole !== undefined && !BEAT_ROLES.includes(shot.beatRole)) {
      items.push({
        level: "WARN",
        code: "invalid-beat-role",
        message: `shot ${index} 的 beatRole 无效：${JSON.stringify(shot.beatRole)}（可用 ${BEAT_ROLES.join(" / ")}）`,
      });
    }
  }

  if (narration.length > 0 && narration.length !== shots.length) {
    items.push({
      level: "WARN",
      code: "narration-count",
      message: `narration 有 ${narration.length} 条，shots 有 ${shots.length} 个，数量不一致`,
    });
  }

  const total = shots.reduce((sum, shot) => sum + durationOf(shot), 0);
  const isShort = script.length === "short" || shots.length <= 12;
  const pacing = BEAT_PLAN.map((beat) => {
    const matched = shots
      .map((shot, index) => ({ shot, index }))
      .filter(({ shot }) => shot && beatOf(shot) === beat.role);
    const actualShots = matched.length;
    const actualSec = matched.reduce((sum, { shot }) => sum + durationOf(shot), 0);
    const actualChars = matched.reduce(
      (sum, { index }) => sum + countChars(narration[index]),
      0
    );
    return {
      role: beat.role,
      label: beat.label,
      actualShots,
      actualSec: round2(actualSec),
      actualChars,
      suggestedSec: round2(total * beat.weight),
      suggestedSecRange: isShort ? beat.shortSeconds : beat.seconds,
      suggestedShotRange: isShort ? beat.shortShots : beat.shots,
      suggestedCharRange: beat.chars,
    };
  });

  const anyTagged = shots.some((shot) => beatOf(shot));
  if (anyTagged) {
    for (const row of pacing) {
      if (row.actualShots === 0) continue;
      const problems = [];
      const [shotLow, shotHigh] = row.suggestedShotRange;
      if (row.actualShots < shotLow || row.actualShots > shotHigh) {
        problems.push(`建议 ${shotLow}–${shotHigh} 镜，实际 ${row.actualShots} 镜`);
      }
      if (total > 0) {
        const [secLow, secHigh] = row.suggestedSecRange;
        if (row.actualSec < secLow || row.actualSec > secHigh) {
          problems.push(`建议 ${secLow}–${secHigh}s，实际 ${row.actualSec}s`);
        }
      }
      if (!isShort && row.actualChars > 0) {
        const [charLow, charHigh] = row.suggestedCharRange;
        if (row.actualChars < charLow || row.actualChars > charHigh) {
          problems.push(`建议 ${charLow}–${charHigh} 字，实际 ${row.actualChars} 字`);
        }
      }
      if (problems.length > 0) {
        items.push({
          level: "WARN",
          code: "pacing",
          message: `${row.label}段（${row.role}）：${problems.join("；")}（${isShort ? "短版" : "长版"}）`,
        });
      }
    }
    const taggedRoles = new Set(shots.map((shot) => beatOf(shot)).filter(Boolean));
    const missing = BEAT_PLAN.filter((beat) => !taggedRoles.has(beat.role));
    if (missing.length > 0) {
      items.push({
        level: "INFO",
        code: "missing-beat-label",
        message: `这些段落还没标 beat：${missing.map((beat) => `${beat.label}（${beat.role}）`).join("、")}`,
      });
    }
  }

  const first = shots[0];
  if (first && typeof first === "object") {
    const firstDuration = durationOf(first);
    if (firstDuration > 3 && beatOf(first) !== "hook") {
      items.push({
        level: "INFO",
        code: "first-shot-hook",
        message: `首镜 ${firstDuration}s，开头 3 秒要有钩子（可把 beat 标为 "hook"，并压缩到 3 秒内）`,
      });
    }
  }

  // 相邻镜头场景不硬性要求切换，只在连续 3 镜以上同一个场景时给 INFO。
  let runStart = 0;
  for (let i = 1; i <= shots.length; i++) {
    const current = shots[i]?.scene;
    const previous = shots[runStart]?.scene;
    const same = i < shots.length && current && current === previous;
    if (same) continue;
    if (previous && i - runStart >= 3) {
      items.push({
        level: "INFO",
        code: "same-scene",
        message: `第 ${runStart + 1}–${i} 镜都在「${previous}」，可考虑换场（只提示，不强制）`,
      });
    }
    runStart = i;
  }

  return { items, pacing, totalSec: round2(total) };
};

const exists = async (file) => {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
};

const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8"));

const normalizeCaptions = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.captions)) return raw.captions;
  return [];
};

const findCaptions = async (projectDir, captionsFile) => {
  if (typeof captionsFile === "string" && captionsFile.trim()) {
    const file = path.resolve(ROOT, captionsFile);
    return (await exists(file)) ? file : null;
  }
  const name = path.basename(projectDir);
  const candidates = [
    path.join(ROOT, "public", `${name}-captions.json`),
    path.join(projectDir, "captions.json"),
  ];
  for (const file of candidates) {
    if (await exists(file)) return file;
  }
  return null;
};

/**
 * 跑一个项目目录的 lint：结构 + 非 LLM 规则。
 * @param {{projectDir: string, rulesFile?: string, stage?: "draft"|"render",
 *   captionsFile?: string}} params
 */
export const lintProject = async ({
  projectDir,
  rulesFile,
  stage = "draft",
  captionsFile,
}) => {
  const scriptFile = path.join(projectDir, "script.json");
  const script = await readJson(scriptFile);
  const structural = lintScript(script);

  const foundCaptions = await findCaptions(projectDir, captionsFile);
  const captions = foundCaptions ? normalizeCaptions(await readJson(foundCaptions)) : [];

  const researchFile = path.join(projectDir, "research.md");
  const research = (await exists(researchFile))
    ? await fs.readFile(researchFile, "utf8")
    : "";

  const resolvedRulesFile = resolveRulesFile({ rulesFile, projectDir });
  const rules = resolvedRulesFile ? loadRules(resolvedRulesFile) : [];
  const ruleResults = runRules({
    script,
    captions,
    research,
    rules,
    stage,
  }).filter((result) => result.type !== "llm");

  const contentStatus = overallStatus(ruleResults);
  const hasFail =
    structural.items.some((item) => item.level === "ERROR") ||
    ruleResults.some((result) => result.status === "FAIL");

  return {
    scriptFile,
    script,
    structural,
    rulesFile: resolvedRulesFile,
    rules,
    ruleResults,
    captionsFile: foundCaptions,
    researchFile: research ? researchFile : null,
    contentStatus,
    status: hasFail ? "FAIL" : contentStatus === "WARN" ? "WARN" : "PASS",
  };
};

const formatItem = (item) => `[lint] ${item.level} ${item.code}: ${item.message}`;

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.project !== "string" || !args.project.trim()) {
    throw new Error("缺少 --project <dir>（目录里要有 script.json）");
  }
  if (args.stage !== undefined && args.stage !== "draft" && args.stage !== "render") {
    throw new Error(`--stage 只能是 draft 或 render，收到 "${String(args.stage)}"`);
  }
  const projectDir = path.resolve(ROOT, args.project);
  const stage = args.stage === "render" ? "render" : "draft";
  const result = await lintProject({
    projectDir,
    rulesFile: typeof args.rules === "string" ? args.rules : undefined,
    stage,
    captionsFile: typeof args.captions === "string" ? args.captions : undefined,
  });
  const { structural, ruleResults } = result;
  const pacing = structural.pacing;
  const total = structural.totalSec;

  console.log(
    `[lint] ${path.relative(ROOT, result.scriptFile)}（总时长 ${round2(total)}s，阶段 ${stage}）`
  );
  if (structural.items.length === 0) {
    console.log("[lint] 结构：PASS");
  } else {
    for (const item of structural.items) console.log(formatItem(item));
  }

  console.log("");
  console.log("[lint] 五段节奏（规范区间）：");
  console.log("  段落   建议镜头    实际   建议时长     实际");
  for (const row of pacing) {
    console.log(
      `  ${row.label.padEnd(4, " ")} ${fmtRange(row.suggestedShotRange).padEnd(8, " ")} ${String(row.actualShots).padEnd(6, " ")} ${fmtRange(row.suggestedSecRange).padEnd(12, " ")} ${row.actualSec}s`
    );
  }

  console.log("");
  const ruleCount = ruleResults.length;
  console.log(
    `[lint] 内容规则：${result.contentStatus}（${ruleCount} 条，规则文件 ${result.rulesFile ? path.relative(ROOT, result.rulesFile) : "无"}）`
  );
  if (result.researchFile) {
    console.log(`[lint] C18 用 ${path.relative(ROOT, result.researchFile)} 核对数字`);
  }
  if (result.captionsFile) {
    console.log(`[lint] C08 用 ${path.relative(ROOT, result.captionsFile)} 实测前 3 秒`);
  }
  for (const rule of ruleResults) {
    const items =
      Array.isArray(rule.items) && rule.items.length > 0 ? `（${rule.items.join("；")}）` : "";
    console.log(
      `  [${rule.status}] ${rule.id} ${rule.name}（${rule.level}）：${rule.detail}${items}`
    );
  }

  const hasError = structural.items.some((item) => item.level === "ERROR");
  const hasFail = ruleResults.some((rule) => rule.status === "FAIL");
  return hasError || hasFail ? 1 : 0;
};

const isDirectRun = () => {
  if (!process.argv[1]) return false;
  try {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
};

if (isDirectRun()) {
  main()
    .then((code) => {
      process.exitCode = code ?? 0;
    })
    .catch((err) => {
      console.error("[lint] 失败：", err?.stack ?? err?.message ?? err);
      process.exitCode = 1;
    });
}
