#!/usr/bin/env node
/**
 * 内容层 QC：先跑 qc-rules.json 里的 builtin / regex 规则，再对 type=llm 的规则批量调一次 LLM。
 *
 * export async function contentQc({script, captions, research, rules, rulesFile,
 *   stage, apiKey, model, fetchImpl})
 * 由 scripts/qc.mjs 在给了 --script 时调用（--no-content 可关闭）。
 *
 * 规则文件（v2，默认仓库根 qc-rules.json）：
 *   {"version":2,"rules":[{id,name,description,type,check,params,prompt,level,stage,enabled}]}
 *   完整校验在 scripts/content-rules.mjs 的 loadRules。
 *
 * LLM 规则：
 *   - 只把 type=llm、enabled=true、当前 stage 生效的规则送进提示；
 *   - 一次请求批量返回 {"checks":{"<id>":{"pass":boolean,"detail":"...","items":[]}}}；
 *   - 没有 DEEPSEEK_API_KEY → 这些规则 SKIP；
 *   - 调用失败 → SKIP 并在 detail / error 写原因。
 *
 * 返回的 content 是数组：[{id,name,type,level,stage,status,detail,items}]。
 * 内容 FAIL 只用于报告，不改变 qc 的视觉退出码。
 */
import {
  DEFAULT_RULES_FILE,
  RULE_LEVELS,
  loadRules,
  overallStatus,
  runRules,
} from "./content-rules.mjs";

export {
  DEFAULT_RULES_FILE,
  RULE_LEVELS,
  loadRules,
  runRules,
  overallStatus,
};

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
export const DEFAULT_MODEL = "deepseek-v4-flash";
export const NO_KEY_REASON = "未设置 DEEPSEEK_API_KEY";

const stripFences = (text) =>
  String(text ?? "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

const splitSentences = (text) =>
  String(text ?? "")
    .split(/(?<=[。！？!?；;])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

const normalizeItems = (raw) => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (item === null || item === undefined) return null;
      if (typeof item === "string") return item.trim();
      if (typeof item === "number") return String(item);
      if (typeof item === "object") {
        const shot = item.shot ?? item.index ?? item.shotIndex;
        const reason = item.reason ?? item.detail ?? item.message ?? item.problem ?? "";
        if (shot !== undefined && String(reason).trim()) {
          return `镜 ${shot}：${String(reason).trim()}`;
        }
        return item.term ?? item.name ?? item.text ?? item.reason ?? JSON.stringify(item);
      }
      return String(item);
    })
    .filter((item) => item !== null && String(item).trim().length > 0);
};

const captionStart = (caption, fps) => {
  const start = Number(caption?.start);
  if (Number.isFinite(start)) return start;
  const startFrame = Number(caption?.startFrame);
  if (Number.isFinite(startFrame)) return startFrame / fps;
  return null;
};

const buildInput = (script, captions) => {
  const narration = Array.isArray(script?.narration) ? script.narration : [];
  const shots = Array.isArray(script?.shots) ? script.shots : [];
  const captionList = Array.isArray(captions)
    ? captions
    : Array.isArray(captions?.captions)
      ? captions.captions
      : [];
  const fps = Number(script?.fps) > 0 ? Number(script.fps) : 30;

  const openingCaptions = captionList
    .filter((caption) => {
      const start = captionStart(caption, fps);
      return start !== null && start < 3 && typeof caption?.text === "string";
    })
    .map((caption) => caption.text.trim())
    .filter(Boolean);

  const allText = narration.join("");
  const sentences = splitSentences(allText);
  const lastSentence = sentences.length > 0 ? sentences[sentences.length - 1] : "";

  const shotInfo = shots.map((shot, i) => ({
    index: i + 1,
    point: typeof shot?.point === "string" ? shot.point : "",
    beat: typeof shot?.beat === "string" ? shot.beat : shot?.beatRole ?? "",
    narration:
      typeof shot?.caption === "string" && shot.caption.trim()
        ? shot.caption.trim()
        : typeof narration[i] === "string"
          ? narration[i].trim()
          : "",
  }));

  return {
    narration: narration.join("\n"),
    opening_3s: openingCaptions,
    last_sentence: lastSentence,
    shots: shotInfo,
  };
};

const buildPrompt = (input, rules) => {
  const ruleBlocks = rules.map((rule, i) =>
    [
      `${i + 1}. id: ${rule.id}`,
      `   名称：${rule.name}`,
      `   用途：${rule.description}`,
      `   检查说明：${rule.prompt}`,
    ].join("\n")
  );
  return [
    "请按下列规则检查这段讲解视频的内容。每条规则只判断「通过 / 不通过」，不要自己决定 WARN 或 FAIL 级别。",
    "",
    ...ruleBlocks,
    "",
    '严格输出 JSON：{"checks":{"<规则 id>":{"pass":true,"detail":"一句中文说明","items":[]}}}',
    "pass 为 true 表示通过，false 表示不通过；items 用来列具体问题，没有问题时给空数组。",
    "只输出规则列表里出现过的 id，不要额外增加检查项。",
    "",
    "材料：",
    JSON.stringify(input, null, 2),
  ].join("\n");
};

const callLlm = async ({ input, rules, apiKey, model, fetchImpl }) => {
  const doFetch = fetchImpl ?? globalThis.fetch;
  const res = await doFetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "你是短视频内容编辑。只依据给定材料判断，严格输出 JSON，不要输出 markdown 或解释。",
        },
        { role: "user", content: buildPrompt(input, rules) },
      ],
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
    throw new Error(`HTTP ${res.status}${detail ? `：${String(detail).slice(0, 200)}` : ""}`);
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

const statusOfRaw = (raw, rule) => {
  if (raw.pass === true) return "PASS";
  if (raw.pass === false) return rule.level;
  // 兼容旧格式 {status:"PASS|WARN|FAIL"}：统一收敛到规则自己的 level。
  const status = String(raw.status ?? "").toUpperCase();
  if (status === "PASS") return "PASS";
  if (status === "WARN" || status === "FAIL") return rule.level;
  if (status === "SKIP" || status === "DISABLED") return status;
  return "SKIP";
};

const mergeLlmResult = (entry, rule, raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...entry, status: "SKIP", detail: "LLM 未返回该检查项", items: [] };
  }
  const status = statusOfRaw(raw, rule);
  const detail =
    typeof raw.detail === "string"
      ? raw.detail
      : typeof raw.reason === "string"
        ? raw.reason
        : status === "SKIP"
          ? "LLM 返回了无效结果"
          : "";
  return { ...entry, status, detail, items: normalizeItems(raw.items) };
};

const activeLlmRules = (rules, stage) =>
  rules.filter(
    (rule) =>
      rule.type === "llm" &&
      rule.enabled &&
      !(rule.stage === "render" && stage !== "render")
  );

const resolveRules = (rules, rulesFile) => {
  if (rules !== undefined && rules !== null) return loadRules(rules);
  return loadRules(rulesFile || DEFAULT_RULES_FILE);
};

const replaceLlmEntries = (results, replacement) =>
  results.map((entry) => {
    if (entry.type !== "llm") return entry;
    const patch = replacement.get(entry.id);
    return patch ? { ...entry, ...patch } : entry;
  });

/**
 * 内容 QC。
 * @param {{script?: any, captions?: any, research?: string, rules?: any,
 *   rulesFile?: string, stage?: "draft"|"render", apiKey?: string,
 *   model?: string, fetchImpl?: typeof fetch}} params
 */
export async function contentQc({
  script,
  captions = [],
  research = "",
  rules,
  rulesFile,
  stage = "draft",
  apiKey,
  model,
  fetchImpl,
} = {}) {
  const resolvedModel = model || process.env.STICKMAN_LLM_MODEL || DEFAULT_MODEL;
  const resolvedRules = resolveRules(rules, rulesFile);
  const results = runRules({
    script,
    captions,
    research,
    rules: resolvedRules,
    stage,
  });
  const base = {
    model: resolvedModel,
    ...(rulesFile ? { rulesFile } : {}),
    generatedAt: new Date().toISOString(),
  };
  const finish = (content, extra = {}) => ({
    ...base,
    status: overallStatus(content),
    content,
    checks: Object.fromEntries(content.map((item) => [item.id, item])),
    ...extra,
  });

  const llmRules = activeLlmRules(resolvedRules, stage);
  const skipLlm = (reason, extra = {}) =>
    finish(
      replaceLlmEntries(
        results,
        new Map(llmRules.map((rule) => [rule.id, { status: "SKIP", detail: reason, items: [] }]))
      ),
      extra
    );

  const key =
    apiKey === undefined ? process.env.DEEPSEEK_API_KEY : String(apiKey ?? "");
  if (!key) return skipLlm(NO_KEY_REASON);

  const narration = Array.isArray(script?.narration) ? script.narration : [];
  const shots = Array.isArray(script?.shots) ? script.shots : [];
  if (narration.length === 0 && shots.length === 0) {
    return skipLlm("脚本没有可检查的旁白或分镜");
  }
  if (llmRules.length === 0) {
    return finish(results);
  }

  const input = buildInput(script, captions);
  let data;
  try {
    data = await callLlm({
      input,
      rules: llmRules,
      apiKey: key,
      model: resolvedModel,
      fetchImpl,
    });
  } catch (err) {
    const reason = `LLM 调用失败：${err?.message ?? err}`;
    return skipLlm(reason, { error: reason });
  }

  const payload = data?.checks && typeof data.checks === "object" ? data.checks : data ?? {};
  const replacement = new Map(
    llmRules.map((rule) => {
      const entry = results.find((item) => item.id === rule.id);
      return [rule.id, mergeLlmResult(entry, rule, payload?.[rule.id])];
    })
  );
  return finish(replaceLlmEntries(results, replacement));
}

/**
 * qc-report.md 里渲染内容检查表需要的行。
 * 兼容：数组 / {content:[...]} / 旧报告 {checks:{...}}。
 */
export const contentCheckRows = (content) => {
  const list = Array.isArray(content)
    ? content
    : Array.isArray(content?.content)
      ? content.content
      : null;
  if (list) {
    return list.map((row) => {
      const items =
        Array.isArray(row.items) && row.items.length > 0 ? `（${row.items.join("；")}）` : "";
      return {
        key: row.id,
        id: row.id,
        label: row.name || row.id,
        level: row.level || "—",
        status: row.status ?? "SKIP",
        detail: `${row.detail ?? ""}${items}`.trim() || "—",
      };
    });
  }
  const checks = content?.checks ?? {};
  return Object.keys(checks).map((id) => {
    const row = checks[id] ?? {};
    const items =
      Array.isArray(row.items) && row.items.length > 0 ? `（${row.items.join("；")}）` : "";
    return {
      key: id,
      id,
      label: row.label ?? row.name ?? id,
      level: row.level || "—",
      status: row.status ?? "SKIP",
      detail: `${row.detail ?? ""}${items}`.trim() || "—",
    };
  });
};

export default contentQc;
