#!/usr/bin/env node
/**
 * 事实核查：从旁白里抽取数字/事实说法，逐条联网搜索并判定。
 *
 * 用法：
 *   stickman research --project examples/sample-story
 *   stickman research --project examples/sample --n 5 --max-claims 12
 *   stickman research --project examples/sample --no-llm
 *   stickman research --project examples/sample --out out/sample-research.md
 *
 * 产出：
 *   <dir>/research.md + <dir>/research.json（--out 时改路径，json 与 md 同名）
 *
 * 依赖：
 *   - 有 DEEPSEEK_API_KEY 且未加 --no-llm：用 LLM 抽 claim / 判定 verdict；
 *     模型默认 deepseek-v4-flash，可用 --model 或 STICKMAN_LLM_MODEL 覆盖。
 *   - 搜索：$DS_SEARCH_BIN（默认 /home/box/.local/bin/ds-search），
 *     以 `--json --n N <query>` 调用，单条超时 60s。
 *   - 没有 key 时自动退回正则启发式，全程离线（搜索仍需 key，失败会记 unverified）。
 *
 * 判定：verdict ∈ {supported, contradicted, unverified}；source_url 必须是搜索结果里的 URL，
 * 并去掉搜索/LLM 带出的 `#1` 这类纯数字序号锚点。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_SEARCH_BIN = "/home/box/.local/bin/ds-search";
const SEARCH_TIMEOUT_MS = 60_000;

const VERDICTS = ["supported", "contradicted", "unverified"];
const VERDICT_LABELS = {
  supported: "已证实",
  contradicted: "有出入",
  unverified: "未证实",
};

const log = (...m) => console.log("[research]", ...m);

/* ─────────────────────────────
 * 参数
 * ───────────────────────────── */

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

const clampInt = (value, fallback, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

/* ─────────────────────────────
 * 旁白与启发式抽取
 * ───────────────────────────── */

/** 从 script.json 里取旁白：优先 narration[]，否则 shots[].narration/text */
export const extractNarration = (script) => {
  if (!script || typeof script !== "object") return [];
  if (Array.isArray(script.narration) && script.narration.length > 0) {
    return script.narration
      .filter((line) => typeof line === "string")
      .map((line) => line.trim())
      .filter(Boolean);
  }
  if (Array.isArray(script.shots)) {
    return script.shots
      .map((shot) =>
        typeof shot?.narration === "string"
          ? shot.narration
          : typeof shot?.text === "string"
            ? shot.text
            : typeof shot?.caption === "string"
              ? shot.caption
              : ""
      )
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return [];
};

const SENTENCE_RE = /[^。！？!?；;\n]+[。！？!?；;]?/g;

const splitSentences = (text) =>
  (String(text ?? "").match(SENTENCE_RE) ?? [])
    .map((s) => s.trim())
    .filter(Boolean);

/** 含数字 / 百分比 / 年份 / 第一·最·首次 / 研究表明 等的句子算“事实说法” */
const CLAIM_HINTS = [
  /\d/,
  /[%％]/,
  /(?:19|20)\d{2}\s*年/,
  /百分之/,
  /第一|第二|第三|首个|首次|最早|最新/,
  /最/,
  /研究表明|研究发现|数据显示|据统计|调查显示|实验证明|报告显示/,
  /超过|不到|接近|翻倍|增长|下降|平均/,
  /每天|每月|每年/,
];

const looksLikeClaim = (sentence) => CLAIM_HINTS.some((re) => re.test(sentence));

const truncate = (text, max = 60) => {
  const chars = Array.from(String(text ?? ""));
  return chars.length <= max ? chars.join("") : chars.slice(0, max).join("");
};

const NUMERIC_ANCHOR_RE = /#\d+$/;

/**
 * 规范化来源 URL：去掉 `#1`、`#12` 这类纯数字序号锚点，保留正常的 fragment。
 * 搜索结果和 LLM 都可能带出这种锚点，写进报告前统一收敛到原始 URL。
 * @param {unknown} url
 * @returns {string}
 */
export const normalizeSourceUrl = (url) => {
  if (typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  return trimmed.replace(NUMERIC_ANCHOR_RE, "");
};

/**
 * 生成本地时区偏移的 ISO 时间，如 `2026-11-01T08:53:04+08:00`。
 * @param {Date} [date]
 * @returns {string}
 */
export const formatIsoWithLocalOffset = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) throw new Error("无效的时间");
  const pad = (value, width = 2) => String(Math.abs(value)).padStart(width, "0");
  const offsetMinutes = -d.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
  const offsetMins = Math.abs(offsetMinutes) % 60;
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(offsetHours)}:${pad(offsetMins)}`
  );
};

/**
 * 正则启发式抽取 claims。
 * @param {string[]|string} narration 旁白数组或整段文本
 * @param {{maxClaims?: number}} [options]
 * @returns {{claim: string, query: string}[]}
 */
export const extractClaimsHeuristic = (narration, options = {}) => {
  const maxClaims = clampInt(options.maxClaims, 12, 1, 100);
  const lines = Array.isArray(narration) ? narration : [narration];
  const sentences = lines.flatMap((line) => splitSentences(line));
  const seen = new Set();
  const claims = [];
  for (const sentence of sentences) {
    if (sentence.length < 4) continue;
    if (!looksLikeClaim(sentence)) continue;
    if (seen.has(sentence)) continue;
    seen.add(sentence);
    claims.push({ claim: sentence, query: truncate(sentence, 60) });
    if (claims.length >= maxClaims) break;
  }
  return claims;
};

/* ─────────────────────────────
 * 搜索结果解析
 * ───────────────────────────── */

const firstString = (...values) =>
  values.find((v) => typeof v === "string" && v.trim().length > 0)?.trim() ?? "";

const pickResultArray = (value) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const candidates = [
    value.results,
    value.items,
    value.list,
    value.data,
    value.data?.results,
    value.data?.items,
    value.data?.data,
    value.payload?.results,
    value.response?.results,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  // 再深一层：{ data: { results: [...] } } 之类的组合
  for (const candidate of Object.values(value)) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const nested = pickResultArray(candidate);
      if (nested.length > 0) return nested;
    }
  }
  return [];
};

const normalizeResult = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const url = firstString(raw.url, raw.link, raw.href, raw.source_url, raw.sourceUrl);
  const title = firstString(raw.title, raw.name, raw.heading);
  const snippet = firstString(
    raw.snippet,
    raw.content,
    raw.description,
    raw.summary,
    raw.abstract,
    raw.text,
    raw.excerpt
  );
  const site = firstString(raw.site_name, raw.site, raw.domain, raw.source);
  const date = firstString(raw.date, raw.published_at, raw.publishedAt);
  if (!url && !title && !snippet) return null;
  return { title: title || url, url, snippet, site, date };
};

/**
 * 宽容解析 ds-search 的 --json 输出：既接受 JSON 字符串，也接受已解析对象。
 * 结果数组可能藏在 results / items / data.results 等字段下。
 * @returns {{title: string, url: string, snippet: string, site: string, date: string}[]}
 */
export const parseSearchResults = (input) => {
  let data = input;
  if (typeof data === "string") {
    const text = data.trim();
    if (!text) return [];
    try {
      data = JSON.parse(text);
    } catch {
      return [];
    }
  }
  return pickResultArray(data)
    .map(normalizeResult)
    .filter((item) => item !== null && (item.url || item.title || item.snippet));
};

/* ─────────────────────────────
 * 启发式判定
 * ───────────────────────────── */

const haystackOf = (result) => result?.snippet || result?.title || "";

/**
 * 无 LLM 时：有搜索结果且结果片段包含 claim 中的所有数字 → supported（取第一个匹配 URL），
 * 否则 unverified。
 * @returns {{verdict: "supported"|"unverified", source_url: string, reason: string}}
 */
export const judgeHeuristic = (claim, results) => {
  const list = (Array.isArray(results) ? results : parseSearchResults(results)).filter(Boolean);
  const digits = String(claim ?? "").match(/\d+(?:\.\d+)?/g) ?? [];
  if (list.length === 0) {
    return { verdict: "unverified", source_url: "", reason: "没有搜索到可用结果" };
  }
  const match = list.find((result) =>
    digits.every((digit) => haystackOf(result).includes(digit))
  );
  if (match) {
    return {
      verdict: "supported",
      source_url: normalizeSourceUrl(match.url),
      reason:
        digits.length > 0
          ? `搜索结果包含说法中的数字（${digits.join("、")}）`
          : "搜索结果与说法方向一致（说法中没有数字可比对）",
    };
  }
  return {
    verdict: "unverified",
    source_url: "",
    reason:
      digits.length > 0
        ? `搜索结果没有同时出现说法中的数字（${digits.join("、")}）`
        : "搜索结果没有覆盖这条说法",
  };
};

/* ─────────────────────────────
 * LLM（DeepSeek）
 * ───────────────────────────── */

const stripFences = (text) =>
  String(text ?? "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

const callDeepSeekJson = async ({ apiKey, model, messages, fetchImpl }) => {
  const doFetch = fetchImpl ?? globalThis.fetch;
  const res = await doFetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      messages,
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });
  if (!res || typeof res.ok !== "boolean") {
    throw new Error("LLM 请求没有返回有效响应");
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      detail = "";
    }
    throw new Error(`HTTP ${res.status}${detail ? `：${detail.slice(0, 200)}` : ""}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("LLM 没有返回内容");
  }
  try {
    return JSON.parse(stripFences(content));
  } catch {
    throw new Error("LLM 返回的不是合法 JSON");
  }
};

const extractClaimsWithLlm = async (narration, { apiKey, model, maxClaims, fetchImpl }) => {
  const data = await callDeepSeekJson({
    apiKey,
    model,
    fetchImpl,
    messages: [
      {
        role: "system",
        content:
          "你是严谨的事实核查编辑。只输出 JSON，不要输出解释或 markdown。",
      },
      {
        role: "user",
        content: [
          "下面是视频旁白。请找出其中需要核实的数字或事实说法（最多 " +
            maxClaims +
            " 条），并为每条生成一个适合网页搜索的中文 query（可补充关键上下文，不要加引号）。",
          "只输出 JSON：{\"claims\":[{\"claim\":\"说法\",\"query\":\"搜索词\"}]}",
          "",
          "旁白：",
          narration.map((line) => `- ${line}`).join("\n"),
        ].join("\n"),
      },
    ],
  });
  const raw = Array.isArray(data?.claims) ? data.claims : [];
  const seen = new Set();
  const claims = [];
  for (const item of raw) {
    if (!item) continue;
    const claim = typeof item === "string" ? item : item.claim;
    const query = typeof item === "string" ? item : item.query;
    if (typeof claim !== "string" || !claim.trim()) continue;
    const key = claim.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    claims.push({
      claim: key,
      query: truncate(typeof query === "string" && query.trim() ? query.trim() : key, 60),
    });
    if (claims.length >= maxClaims) break;
  }
  if (claims.length === 0) throw new Error("LLM 没有抽取出任何说法");
  return claims;
};

export const judgeWithLlm = async (claims, searchResults, { apiKey, model, fetchImpl }) => {
  const payload = claims.map((item, index) => ({
    index: index + 1,
    claim: item.claim,
    results: (searchResults[index] ?? []).slice(0, 5).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: truncate(r.snippet, 280),
    })),
  }));
  const data = await callDeepSeekJson({
    apiKey,
    model,
    fetchImpl,
    messages: [
      {
        role: "system",
        content:
          "你是事实核查员。只依据给出的搜索摘要判断，不得编造来源。只输出 JSON。",
      },
      {
        role: "user",
        content: [
          "逐条判断说法的结论：supported（摘要支持）、contradicted（摘要与说法冲突）、unverified（摘要不足以判断）。",
          "source_url 必须是该条 results 中出现过的 URL；无法判断时留空字符串。reason 用一句中文说明。",
          '只输出 JSON：{"verdicts":[{"index":1,"verdict":"supported","source_url":"https://…","reason":"…"}]}',
          "",
          JSON.stringify(payload, null, 2),
        ].join("\n"),
      },
    ],
  });
  const list = Array.isArray(data?.verdicts) ? data.verdicts : [];
  const byIndex = new Map();
  for (const item of list) {
    if (!item) continue;
    const index = Number(item.index);
    if (!Number.isInteger(index) || index < 1 || index > claims.length) continue;
    const verdict = VERDICTS.includes(item.verdict) ? item.verdict : null;
    if (!verdict) continue;
    const urls = (searchResults[index - 1] ?? [])
      .map((r) => normalizeSourceUrl(r.url))
      .filter(Boolean);
    const candidate = normalizeSourceUrl(item.source_url);
    const sourceUrl = urls.includes(candidate) ? candidate : "";
    const reason =
      typeof item.reason === "string" && item.reason.trim()
        ? item.reason.trim()
        : VERDICT_LABELS[verdict];
    byIndex.set(index, { verdict, source_url: sourceUrl, reason });
  }
  return claims.map((_, i) => byIndex.get(i + 1) ?? null);
};

/* ─────────────────────────────
 * 搜索
 * ───────────────────────────── */

const summarizeError = (err) => {
  if (!err) return "未知错误";
  if (err.killed) return `搜索超时（${SEARCH_TIMEOUT_MS / 1000}s）`;
  const stderr = typeof err.stderr === "string" ? err.stderr.trim() : "";
  const message = typeof err.message === "string" ? err.message.trim() : String(err);
  const detail = stderr || message;
  return detail.split("\n").slice(0, 2).join(" ").slice(0, 200) || "搜索失败";
};

const runSearch = async (query, { n, bin }) => {
  try {
    const { stdout } = await execFileAsync(
      bin,
      ["--json", "--n", String(n), query],
      { timeout: SEARCH_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }
    );
    return { results: parseSearchResults(stdout), error: null };
  } catch (err) {
    const partial = typeof err?.stdout === "string" ? parseSearchResults(err.stdout) : [];
    return { results: partial, error: summarizeError(err) };
  }
};

/* ─────────────────────────────
 * Markdown
 * ───────────────────────────── */

const escapeCell = (text) => String(text ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ");

const fmtCounts = (counts) =>
  `共 ${counts.total} 条说法：已证实 ${counts.supported}、有出入 ${counts.contradicted}、未证实 ${counts.unverified}`;

/**
 * 渲染 research.md。
 * @param {{title?: string, project?: string, generatedAt?: string, model?: string,
 *   llm?: boolean, claims: Array<{claim: string, query?: string, verdict: string,
 *   source_url?: string, reason?: string, error?: string}>}} report
 */
export const renderResearchMarkdown = (report) => {
  const claims = Array.isArray(report)
    ? report
    : Array.isArray(report?.claims)
      ? report.claims
      : [];
  const counts = report?.counts ?? {
    total: claims.length,
    supported: claims.filter((c) => c.verdict === "supported").length,
    contradicted: claims.filter((c) => c.verdict === "contradicted").length,
    unverified: claims.filter((c) => c.verdict === "unverified").length,
  };
  const title = report?.title || "未命名";
  const lines = [];
  lines.push(`# 事实核查 — ${title}`);
  lines.push("");
  lines.push(`- 项目：\`${report?.project ?? ""}\``);
  lines.push(`- 生成时间：${report?.generatedAt ?? formatIsoWithLocalOffset()}`);
  lines.push(`- 抽取方式：${report?.llm ? `LLM（${report?.model ?? DEFAULT_MODEL}）` : "正则启发式（--no-llm 或无 DEEPSEEK_API_KEY）"}`);
  lines.push(`- 总览：${fmtCounts(counts)}`);
  lines.push("");
  lines.push("## 核实结果");
  lines.push("");
  lines.push("| # | 说法 | 结论 | 来源 URL | 备注 |");
  lines.push("|---:|---|---|---|---|");
  if (claims.length === 0) {
    lines.push("| — | — | — | — | 没有找到需要核实的数字或事实说法 |");
  } else {
    claims.forEach((item, i) => {
      const verdict = VERDICTS.includes(item.verdict) ? item.verdict : "unverified";
      const label = VERDICT_LABELS[verdict];
      const source =
        verdict === "unverified" ? "未证实" : normalizeSourceUrl(item.source_url) || "—";
      const note = [
        item.reason,
        item.error && !String(item.reason ?? "").includes(item.error)
          ? `搜索失败：${item.error}`
          : "",
      ]
        .filter(Boolean)
        .join("；");
      lines.push(
        `| ${i + 1} | ${escapeCell(item.claim)} | ${label} | ${escapeCell(source)} | ${escapeCell(note) || "—"} |`
      );
    });
  }
  lines.push("");

  lines.push("## 未证实/有出入的说法（建议修改或删除）");
  lines.push("");
  const flagged = claims
    .map((item, i) => ({ ...item, index: i + 1 }))
    .filter((item) => item.verdict === "contradicted" || item.verdict === "unverified");
  if (flagged.length === 0) {
    lines.push("无，全部说法都有搜索结果支持。");
  } else {
    for (const item of flagged) {
      const verdict = item.verdict === "contradicted" ? "contradicted" : "unverified";
      const bits = [`${item.index}. [${VERDICT_LABELS[verdict]}] ${item.claim}`];
      if (item.reason) bits.push(`   - 理由：${item.reason}`);
      const sourceUrl = normalizeSourceUrl(item.source_url);
      if (sourceUrl) bits.push(`   - 来源：${sourceUrl}`);
      if (item.error && !String(item.reason ?? "").includes(item.error)) {
        bits.push(`   - 搜索错误：${item.error}`);
      }
      lines.push(bits.join("\n"));
    }
  }
  lines.push("");
  return lines.join("\n");
};

/* ─────────────────────────────
 * 主流程
 * ───────────────────────────── */

const countVerdicts = (claims) => ({
  total: claims.length,
  supported: claims.filter((c) => c.verdict === "supported").length,
  contradicted: claims.filter((c) => c.verdict === "contradicted").length,
  unverified: claims.filter((c) => c.verdict === "unverified").length,
});

export const runResearch = async ({
  script,
  project,
  n = 5,
  maxClaims = 12,
  apiKey = process.env.DEEPSEEK_API_KEY,
  model = process.env.STICKMAN_LLM_MODEL || DEFAULT_MODEL,
  noLlm = false,
  searchBin = process.env.DS_SEARCH_BIN || DEFAULT_SEARCH_BIN,
  fetchImpl,
  onProgress,
}) => {
  const narration = extractNarration(script);
  const useLlm = Boolean(apiKey) && !noLlm;
  const warnings = [];

  let claims = [];
  let extraction = useLlm ? "llm" : "heuristic";
  if (useLlm) {
    try {
      claims = await extractClaimsWithLlm(narration, {
        apiKey,
        model,
        maxClaims,
        fetchImpl,
      });
    } catch (err) {
      extraction = "heuristic";
      warnings.push(`LLM 抽取失败，改用正则启发式：${err.message}`);
    }
  }
  if (claims.length === 0) {
    claims = extractClaimsHeuristic(narration, { maxClaims });
  }

  onProgress?.(`共 ${claims.length} 条待核实说法`);

  const resultsPerClaim = [];
  const errors = [];
  for (let i = 0; i < claims.length; i++) {
    onProgress?.(`搜索 ${i + 1}/${claims.length}：${claims[i].query}`);
    const { results, error } = await runSearch(claims[i].query, { n, bin: searchBin });
    resultsPerClaim.push(results);
    errors.push(error);
    onProgress?.(`  得到 ${results.length} 条结果${error ? `（失败：${error}）` : ""}`);
  }

  let verdicts = claims.map((item, i) => judgeHeuristic(item.claim, resultsPerClaim[i]));
  if (useLlm && claims.length > 0) {
    try {
      const llmVerdicts = await judgeWithLlm(claims, resultsPerClaim, {
        apiKey,
        model,
        fetchImpl,
      });
      verdicts = verdicts.map((fallback, i) => llmVerdicts[i] ?? fallback);
    } catch (err) {
      warnings.push(`LLM 判定失败，改用启发式判定：${err.message}`);
    }
  }

  const items = claims.map((item, i) => {
    const verdict = verdicts[i] ?? {
      verdict: "unverified",
      source_url: "",
      reason: "没有判定结果",
    };
    const error = errors[i];
    const hasError = Boolean(error);
    const finalVerdict = hasError ? "unverified" : verdict.verdict;
    return {
      claim: item.claim,
      query: item.query,
      verdict: VERDICTS.includes(finalVerdict) ? finalVerdict : "unverified",
      source_url: hasError ? "" : normalizeSourceUrl(verdict.source_url),
      reason: hasError
        ? `${verdict.reason || "搜索失败"}；搜索失败：${error}`
        : verdict.reason || "",
      ...(hasError ? { error } : {}),
    };
  });

  const counts = countVerdicts(items);
  return {
    title: script?.title ?? path.basename(project ?? ""),
    project: project ?? "",
    generatedAt: formatIsoWithLocalOffset(),
    model: useLlm ? model : null,
    llm: useLlm && extraction === "llm",
    extraction,
    warnings,
    counts,
    claims: items,
  };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.project !== "string" || !args.project.trim()) {
    throw new Error("缺少 --project <dir>（目录里要有 script.json）");
  }

  const projectDir = path.resolve(ROOT, args.project);
  const scriptFile = path.join(projectDir, "script.json");
  const script = JSON.parse(await fs.readFile(scriptFile, "utf8"));

  const n = clampInt(args.n, 5, 1, 50);
  const maxClaims = clampInt(args["max-claims"], 12, 1, 100);
  const noLlm = args["no-llm"] === true;
  const model =
    (typeof args.model === "string" && args.model) ||
    process.env.STICKMAN_LLM_MODEL ||
    DEFAULT_MODEL;

  log(
    `项目 ${path.relative(ROOT, projectDir) || "."}，每条最多 ${n} 条结果，最多 ${maxClaims} 条说法，` +
      (noLlm ? "禁用 LLM" : process.env.DEEPSEEK_API_KEY ? `LLM ${model}` : "无 DEEPSEEK_API_KEY，走启发式")
  );

  const report = await runResearch({
    script,
    project: path.relative(ROOT, projectDir) || ".",
    n,
    maxClaims,
    model,
    noLlm,
    onProgress: log,
  });

  for (const warning of report.warnings) log(`WARN ${warning}`);

  const outBase =
    typeof args.out === "string" && args.out.trim()
      ? path.resolve(ROOT, args.out)
      : path.join(projectDir, "research.md");
  const mdPath = outBase.endsWith(".md") ? outBase : `${outBase}.md`;
  const jsonPath = mdPath.replace(/\.md$/i, ".json");

  await fs.mkdir(path.dirname(mdPath), { recursive: true });
  await fs.writeFile(mdPath, renderResearchMarkdown(report), "utf8");
  const { warnings, ...jsonReport } = report;
  await fs.writeFile(
    jsonPath,
    JSON.stringify({ ...jsonReport, warnings }, null, 2) + "\n",
    "utf8"
  );

  log(
    `完成：${report.counts.total} 条，已证实 ${report.counts.supported}，有出入 ${report.counts.contradicted}，未证实 ${report.counts.unverified}`
  );
  log(`报告：${path.relative(ROOT, mdPath)}`);
  log(`报告：${path.relative(ROOT, jsonPath)}`);
  return 0;
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
      console.error("[research] 失败：", err?.stack ?? err?.message ?? err);
      process.exitCode = 1;
    });
}
