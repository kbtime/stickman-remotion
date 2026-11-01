import test from "node:test";
import assert from "node:assert/strict";
import {
  extractClaimsHeuristic,
  extractNarration,
  formatIsoWithLocalOffset,
  judgeHeuristic,
  judgeWithLlm,
  normalizeSourceUrl,
  parseSearchResults,
  renderResearchMarkdown,
  runResearch,
} from "../scripts/research.mjs";

test("extractNarration：优先 narration，其次 shots", () => {
  assert.deepEqual(extractNarration({ narration: ["甲", " 乙 "], shots: [] }), ["甲", "乙"]);
  assert.deepEqual(
    extractNarration({
      shots: [{ narration: "第一镜" }, { text: "第二镜" }, { caption: "第三镜" }],
    }),
    ["第一镜", "第二镜", "第三镜"]
  );
  assert.deepEqual(extractNarration({}), []);
});

test("extractClaimsHeuristic：抓数字/百分比/第一/研究等说法，跳过普通句子", () => {
  const narration = [
    "这段视频没有可以核实的说法吧。",
    "第一，本地渲染不用排队。",
    "2024 年渲染成本下降了 30%。",
    "研究表明，人们更喜欢短句。",
    "改一句旁白只要几十秒。",
  ];
  const claims = extractClaimsHeuristic(narration);
  const texts = claims.map((item) => item.claim);
  assert.equal(texts.includes("这段视频没有可以核实的说法吧。"), false);
  assert.ok(texts.includes("第一，本地渲染不用排队。"));
  assert.ok(texts.includes("2024 年渲染成本下降了 30%。"));
  assert.ok(texts.includes("研究表明，人们更喜欢短句。"));
  assert.ok(claims.every((item) => item.query === item.claim.slice(0, 60)));
});

test("extractClaimsHeuristic：去重并遵守 maxClaims", () => {
  const narration = ["增长 10% 是真的。", "增长 10% 是真的。", "增长了 20%。"];
  const claims = extractClaimsHeuristic(narration, { maxClaims: 5 });
  assert.equal(claims.length, 2);
  const limited = extractClaimsHeuristic(narration, { maxClaims: 1 });
  assert.equal(limited.length, 1);
});

test("extractClaimsHeuristic：query 截断到 60 字", () => {
  const long = "增长 10% 的这句说法非常长非常长非常长非常长非常长非常长非常长非常长非常长非常长非常长。";
  const [claim] = extractClaimsHeuristic([long]);
  assert.ok(Array.from(claim.query).length <= 60);
});

test("judgeHeuristic：结果包含全部数字 → supported 并取第一个匹配 URL", () => {
  const results = [
    { title: "无关", url: "https://a.example/x", snippet: "没有数字" },
    { title: "相关", url: "https://b.example/y", snippet: "2024 年下降了 30%" },
    { title: "也相关", url: "https://c.example/z", snippet: "2024 年下降了 30%" },
  ];
  const verdict = judgeHeuristic("2024 年成本下降 30%", results);
  assert.equal(verdict.verdict, "supported");
  assert.equal(verdict.source_url, "https://b.example/y");
  assert.match(verdict.reason, /2024/);
});

test("judgeHeuristic：数字不全 / 没有结果 → unverified", () => {
  const partial = judgeHeuristic("2024 年成本下降 30%", [
    { url: "https://a.example", snippet: "2024 年有报告" },
  ]);
  assert.equal(partial.verdict, "unverified");
  assert.equal(partial.source_url, "");

  const empty = judgeHeuristic("增长 30%", []);
  assert.equal(empty.verdict, "unverified");
  assert.equal(empty.source_url, "");
});

test("parseSearchResults：宽容解析多种字段与嵌套结构", () => {
  const flat = parseSearchResults({
    results: [
      { title: "标题", url: "https://a.example", content: "正文摘要" },
      { name: "别名", link: "https://b.example", description: "描述" },
    ],
  });
  assert.equal(flat.length, 2);
  assert.deepEqual(
    { title: flat[0].title, url: flat[0].url, snippet: flat[0].snippet },
    { title: "标题", url: "https://a.example", snippet: "正文摘要" }
  );
  assert.equal(flat[1].title, "别名");
  assert.equal(flat[1].snippet, "描述");

  const nested = parseSearchResults({
    data: { results: [{ url: "https://c.example", snippet: "片段", site_name: "站点" }] },
  });
  assert.equal(nested.length, 1);
  assert.equal(nested[0].url, "https://c.example");
  assert.equal(nested[0].site, "站点");

  const asString = parseSearchResults(
    JSON.stringify({ results: [{ url: "https://d.example", summary: "总结" }] })
  );
  assert.equal(asString.length, 1);
  assert.equal(asString[0].snippet, "总结");

  assert.deepEqual(parseSearchResults("not json"), []);
  assert.deepEqual(parseSearchResults(null), []);
});

test("normalizeSourceUrl：去掉纯数字序号锚点，保留正常 fragment", () => {
  assert.equal(
    normalizeSourceUrl("https://m.newsmth.net/article/Travel/897878?p=7#1"),
    "https://m.newsmth.net/article/Travel/897878?p=7"
  );
  assert.equal(normalizeSourceUrl("  https://a.example/x#12  "), "https://a.example/x");
  assert.equal(normalizeSourceUrl("https://a.example/x#section-2"), "https://a.example/x#section-2");
  assert.equal(normalizeSourceUrl(""), "");
  assert.equal(normalizeSourceUrl(null), "");
});

test("judgeHeuristic：搜索结果 URL 带 #N 时输出去掉锚点的原始 URL", () => {
  const verdict = judgeHeuristic("2024 年成本下降 30%", [
    { url: "https://a.example/x#1", snippet: "2024 年下降了 30%" },
  ]);
  assert.equal(verdict.verdict, "supported");
  assert.equal(verdict.source_url, "https://a.example/x");
});

test("judgeWithLlm：LLM 返回带 #N 的 URL 时规范化回搜索结果原始 URL", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdicts: [
                  {
                    index: 1,
                    verdict: "supported",
                    source_url: "https://a.example/x#1",
                    reason: "摘要支持",
                  },
                  {
                    index: 2,
                    verdict: "supported",
                    source_url: "https://b.example/y#3",
                    reason: "摘要支持",
                  },
                ],
              }),
            },
          },
        ],
      };
    },
  });
  const verdicts = await judgeWithLlm(
    [{ claim: "说法一" }, { claim: "说法二" }],
    [
      [{ title: "甲", url: "https://a.example/x", snippet: "摘要" }],
      [{ title: "乙", url: "https://b.example/y#3", snippet: "摘要" }],
    ],
    { apiKey: "test-key", fetchImpl }
  );
  assert.equal(verdicts[0].source_url, "https://a.example/x");
  assert.equal(verdicts[1].source_url, "https://b.example/y");
});

test("formatIsoWithLocalOffset：输出带本地时区偏移的 ISO 时间", () => {
  const previousTz = process.env.TZ;
  process.env.TZ = "Asia/Shanghai";
  try {
    const date = new Date(2026, 10, 1, 8, 53, 4);
    assert.equal(formatIsoWithLocalOffset(date), "2026-11-01T08:53:04+08:00");
  } finally {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  }
});

test("runResearch：generatedAt 使用带偏移的 ISO 时间", async () => {
  const report = await runResearch({
    script: { title: "测试片", narration: ["这是一句普通旁白。"] },
    project: "test",
    noLlm: true,
    apiKey: "",
    searchBin: "/bin/false",
  });
  assert.match(report.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  assert.equal(report.generatedAt.endsWith("Z"), false);
});

test("renderResearchMarkdown：包含标题/总览/表格/未证实清单", () => {
  const md = renderResearchMarkdown({
    title: "测试片",
    project: "examples/sample",
    generatedAt: "2026-01-01T00:00:00.000Z",
    llm: false,
    model: null,
    counts: { total: 2, supported: 1, contradicted: 0, unverified: 1 },
    claims: [
      {
        claim: "增长 30%",
        verdict: "supported",
        source_url: "https://a.example",
        reason: "搜索摘要包含 30%",
      },
      {
        claim: "研究表明大家都喜欢",
        verdict: "unverified",
        source_url: "",
        reason: "没有覆盖这条说法",
        error: "搜索超时（60s）",
      },
    ],
  });
  assert.match(md, /^# 事实核查 — 测试片/);
  assert.match(md, /生成时间：2026-01-01T00:00:00\.000Z/);
  assert.match(md, /共 2 条说法：已证实 1、有出入 0、未证实 1/);
  assert.match(md, /## 核实结果/);
  assert.match(md, /\| # \| 说法 \| 结论 \| 来源 URL \| 备注 \|/);
  assert.match(md, /已证实/);
  assert.match(md, /https:\/\/a\.example/);
  assert.match(md, /未证实/);
  assert.match(md, /搜索失败：搜索超时（60s）/);
  assert.match(md, /## 未证实\/有出入的说法（建议修改或删除）/);
  assert.match(md, /2\. \[未证实\] 研究表明大家都喜欢/);
});
