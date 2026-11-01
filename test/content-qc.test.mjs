import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  contentQc,
  contentCheckRows,
  DEFAULT_MODEL,
  DEFAULT_RULES_FILE,
  NO_KEY_REASON,
  loadRules,
} from "../scripts/content-qc.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const script = {
  title: "测试片",
  fps: 30,
  narration: ["别把视频交给云端。", "本地按下回车就能开跑。", "先出成片，再谈打磨。"],
  shots: [
    { beat: "hook", point: "本地渲染不用排队", caption: "别把视频交给云端。" },
    { beat: "problem", point: "按下回车就开跑", caption: "本地按下回车就能开跑。" },
    { beat: "action", point: "先出片再打磨", caption: "先出成片，再谈打磨。" },
  ],
};

const captions = [
  { start: 0.1, end: 1.4, text: "别把视频交给云端。" },
  { start: 1.5, end: 2.9, text: "本地按下回车" },
  { start: 3.2, end: 4.6, text: "就能开跑。" },
];

const llmRule = (overrides = {}) => ({
  id: "hook_3s",
  name: "开头 3 秒钩子",
  description: "开头 3 秒能不能留住人",
  type: "llm",
  prompt: "看 opening_3s 和旁白开头有没有具体冲突或明确收益。",
  level: "WARN",
  enabled: true,
  ...overrides,
});

const regexRule = (overrides = {}) => ({
  id: "C01",
  name: "首句够短",
  description: "首句不超过 14 字",
  type: "builtin",
  check: "first_sentence_length",
  params: { max: 14 },
  level: "FAIL",
  enabled: true,
  ...overrides,
});

const jsonResponse = (payload) => ({
  ok: true,
  status: 200,
  async json() {
    return { choices: [{ message: { content: JSON.stringify(payload) } }] };
  },
  async text() {
    return "";
  },
});

test("默认规则文件：30 条（C01–C26 + 4 LLM），4 条 LLM 默认 WARN", () => {
  const rules = loadRules(DEFAULT_RULES_FILE);
  assert.equal(rules.length, 30);
  const llm = rules.filter((rule) => rule.type === "llm");
  assert.deepEqual(
    llm.map((rule) => rule.id),
    ["hook_3s", "jargon", "actionable_ending", "point_alignment"]
  );
  assert.ok(llm.every((rule) => rule.level === "WARN"));
  assert.equal(DEFAULT_MODEL, "deepseek-v4-flash");
});

test("没有 key：builtin 照跑，LLM 规则 SKIP 并写原因", async () => {
  const rules = loadRules([
    regexRule(),
    llmRule(),
    llmRule({ id: "jargon", name: "术语解释", enabled: false }),
  ]);
  const result = await contentQc({ script, captions, rules, apiKey: "" });
  assert.equal(result.status, "PASS");
  assert.equal(result.content.length, 3);
  assert.equal(result.content[0].id, "C01");
  assert.equal(result.content[0].status, "PASS");
  assert.equal(result.content[1].status, "SKIP");
  assert.equal(result.content[1].detail, NO_KEY_REASON);
  assert.equal(result.content[2].status, "DISABLED");
});

test("LLM mock：只把 LLM 规则送进提示，一次请求批量解析", async () => {
  const calls = [];
  const rules = loadRules([
    regexRule(),
    llmRule(),
    llmRule({
      id: "custom_voice",
      name: "品牌语气",
      description: "是否像品牌口吻",
      prompt: "检查是否像品牌自己的口吻。",
      level: "FAIL",
    }),
  ]);
  const result = await contentQc({
    script,
    captions,
    rules,
    apiKey: "test-key",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        checks: {
          hook_3s: { pass: false, detail: "开头太客套", items: [] },
          custom_voice: { pass: true, detail: "像品牌口吻", items: [] },
        },
      });
    },
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /api\.deepseek\.com/);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, "deepseek-v4-flash");
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.match(calls[0].init.headers.Authorization, /^Bearer /);

  const prompt = body.messages.at(-1).content;
  assert.match(prompt, /hook_3s/);
  assert.match(prompt, /custom_voice/);
  assert.doesNotMatch(prompt, /C01/);
  assert.match(prompt, /别把视频交给云端/);
  assert.match(prompt, /"pass":true/);

  assert.equal(result.content[0].status, "PASS");
  assert.equal(result.content[1].status, "WARN");
  assert.equal(result.content[1].detail, "开头太客套");
  assert.equal(result.content[2].status, "PASS");
  assert.equal(result.status, "WARN");
});

test("LLM 调用失败：LLM 规则 SKIP 并带原因，builtin 结果保留", async () => {
  const rules = loadRules([regexRule(), llmRule()]);
  const result = await contentQc({
    script,
    captions,
    rules,
    apiKey: "test-key",
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      async text() {
        return "rate limited";
      },
    }),
  });
  assert.match(result.error, /LLM 调用失败/);
  assert.equal(result.content[0].status, "PASS");
  assert.equal(result.content[1].status, "SKIP");
  assert.match(result.content[1].detail, /LLM 调用失败/);
});

test("LLM 返回缺项 / pass 非布尔：缺项 SKIP，不崩溃", async () => {
  const rules = loadRules([
    llmRule(),
    llmRule({ id: "jargon", name: "术语解释" }),
  ]);
  const result = await contentQc({
    script,
    captions,
    rules,
    apiKey: "test-key",
    fetchImpl: async () =>
      jsonResponse({ checks: { hook_3s: { pass: true, detail: "有钩子" }, jargon: { pass: "no" } } }),
  });
  assert.equal(result.content[0].status, "PASS");
  assert.equal(result.content[1].status, "SKIP");
});

test("stage=render：render 阶段规则生效，draft 阶段 SKIP", async () => {
  const rules = loadRules([
    regexRule({
      id: "C17",
      name: "待补占位",
      type: "regex",
      check: undefined,
      params: { pattern: "【待补", max: 0 },
      stage: "render",
    }),
  ]);
  const placeholder = { ...script, narration: ["【待补：自己的场面】"] };
  const draft = await contentQc({ script: placeholder, rules, apiKey: "", stage: "draft" });
  assert.equal(draft.content[0].status, "SKIP");
  assert.match(draft.content[0].detail, /render/);
  const render = await contentQc({ script: placeholder, rules, apiKey: "", stage: "render" });
  assert.equal(render.content[0].status, "FAIL");
});

test("contentCheckRows：数组格式输出 ID、规则、级别、状态、说明", () => {
  const rows = contentCheckRows([
    {
      id: "C01",
      name: "首句够短",
      level: "FAIL",
      status: "PASS",
      detail: "首句 10 字",
      items: [],
    },
    {
      id: "hook_3s",
      name: "开头 3 秒钩子",
      level: "WARN",
      status: "WARN",
      detail: "开头太客套",
      items: ["开头是自我介绍"],
    },
  ]);
  assert.deepEqual(
    rows.map((row) => [row.id, row.label, row.level, row.status]),
    [
      ["C01", "首句够短", "FAIL", "PASS"],
      ["hook_3s", "开头 3 秒钩子", "WARN", "WARN"],
    ]
  );
  assert.match(rows[1].detail, /开头太客套（开头是自我介绍）/);
});

test("contentCheckRows：兼容旧报告 checks 对象", () => {
  const rows = contentCheckRows({
    checks: {
      hook_3s: { label: "开头", level: "WARN", status: "PASS", detail: "" },
    },
  });
  assert.equal(rows[0].id, "hook_3s");
  assert.equal(rows[0].detail, "—");
});
