import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BEAT_SEQUENCE,
  countChars,
  loadRules,
  resolveRulesFile,
  runRules,
  validateRules,
} from "../scripts/content-rules.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RULES_FILE = path.join(ROOT, "qc-rules.json");
const RULES = loadRules(RULES_FILE);
const BY_ID = Object.fromEntries(RULES.map((rule) => [rule.id, rule]));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stickman-content-rules-"));
let fileIndex = 0;
const writeRules = (data) => {
  const file = path.join(tmpDir, `rules-${++fileIndex}.json`);
  fs.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data, null, 2), "utf8");
  return file;
};

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const shot = (point = "要点", extra = {}) => ({ point, ...extra });

const scriptOf = ({ narration, shots, length, fps = 30 }) => ({
  ...(length ? { length } : {}),
  fps,
  narration,
  shots: shots ?? narration.map((_, i) => shot(`要点${i + 1}`)),
});

/** 只跑一条规则，返回该规则结果。 */
const runOne = (id, script, options = {}) => {
  const rule = BY_ID[id];
  assert.ok(rule, `默认规则里没有 ${id}`);
  const [result] = runRules({
    script,
    captions: options.captions,
    research: options.research,
    stage: options.stage,
    rules: [rule],
  });
  return result;
};

const expect = (id, script, options = {}) => ({
  pass: () => {
    const result = runOne(id, script, options);
    assert.equal(result.status, "PASS", `${id} 应通过：${result.detail} ${JSON.stringify(result.items)}`);
    return result;
  },
  fail: (level = BY_ID[id].level) => {
    const result = runOne(id, script, options);
    assert.equal(result.status, level, `${id} 应按 ${level} 不通过：${result.detail}`);
    assert.ok(result.items.length > 0, `${id} 不通过时应有 items`);
    return result;
  },
});

test("countChars：只算中文字/英文字母/数字", () => {
  assert.equal(countChars("AI 写的周报，一看就是 AI 写的。"), 14);
  assert.equal(countChars("打开备忘录，记一条。"), 8);
  assert.equal(countChars("  ，。！？  "), 0);
  assert.equal(countChars("v2.0 版本"), 5);
});

test("默认规则文件：version 2，包含 C01–C26 与 4 条 LLM 规则", () => {
  assert.equal(RULES.length, 30);
  for (let i = 1; i <= 26; i++) {
    const id = `C${String(i).padStart(2, "0")}`;
    assert.ok(BY_ID[id], `缺少 ${id}`);
  }
  assert.equal(BY_ID.C08a, undefined, "C08a 合入 C08，不单独占 id");
  assert.equal(BY_ID.C12a, undefined, "C12a 合入 C12，不单独占 id");
  assert.deepEqual(
    RULES.filter((rule) => rule.type === "llm").map((rule) => rule.id),
    ["hook_3s", "jargon", "actionable_ending", "point_alignment"]
  );
  assert.equal(BY_ID.C17.stage, "render");
  assert.equal(BY_ID.C17.draftStatus, "PASS");
  assert.equal(BY_ID.C13.level, "WARN");
  assert.equal(BY_ID.C08.check, "hook_within_3s");
  assert.match(BY_ID.C08.params.openerPattern, /随着/);
  assert.equal(BY_ID.C10.check, "contrast_pattern");
  assert.equal(BY_ID.C12.check, "ending_question");
  assert.equal(BY_ID.C21.check, "info_sentence_quota");
});

test("C01 首句够短：正反用例", () => {
  expect("C01", scriptOf({ narration: ["短句。"] })).pass();
  expect("C01", scriptOf({ narration: ["这一句话特别特别长超过十四个字了吧。"] })).fail();
});

test("C02 单句长度：≤16 普通；17–22 信息句占额度；≥23 FAIL", () => {
  expect("C02", scriptOf({ narration: ["短句。", "也短。"] })).pass();
  const long = "这一句话特别特别长而且已经明显超过二十二个有效字了吧。";
  assert.ok(countChars(long) >= 23);
  expect("C02", scriptOf({ narration: ["短。", long] })).fail();

  // 钩子+问题只允许 1 句信息句
  const infoHook = "AI 写的周报，一看就是 AI 写的并且还有一点长。";
  const infoProblem = "它其实完全不知道我这周到底做了哪些事情。";
  const hookShots = [
    shot("钩子", { beat: "hook" }),
    shot("问题", { beat: "problem" }),
  ];
  expect("C02", scriptOf({ narration: [infoHook, "它不知道。"], shots: hookShots })).pass();
  const over = expect("C02", scriptOf({ narration: [infoHook, infoProblem], shots: hookShots })).fail();
  assert.match(over.detail, /信息句 2 句/);
  assert.match(over.detail, /第 2 句（钩子\+问题）/);
  assert.equal(over.items.some((item) => /第 2 句/.test(item)), true);
});

test("C03 镜句对齐：正反用例", () => {
  expect("C03", scriptOf({ narration: ["一。", "二。"], shots: [shot(), shot()] })).pass();
  expect("C03", scriptOf({ narration: ["一。", "二。"], shots: [shot()] })).fail();
});

test("C04 总字数：长版 300–800，短版 60–120", () => {
  const longShots = Array.from({ length: 13 }, () => shot());
  expect("C04", scriptOf({ narration: ["字".repeat(400)], shots: longShots })).pass();
  expect("C04", scriptOf({ narration: ["字".repeat(100)], shots: longShots })).fail();
  expect("C04", scriptOf({ narration: ["字".repeat(100)], shots: [shot()] })).pass();
  expect("C04", scriptOf({ narration: ["字".repeat(20)], shots: [shot()] })).fail();
  expect("C04", scriptOf({ narration: ["字".repeat(200)], length: "short" })).fail();
});

test("C05 point 必填：正反用例", () => {
  expect("C05", scriptOf({ narration: ["一。"], shots: [shot("记下一件事")] })).pass();
  expect("C05", scriptOf({ narration: ["一。"], shots: [shot("")] })).fail();
  expect("C05", scriptOf({ narration: ["一。"], shots: [shot("这是一条超过二十个字的 point 需要被拦下来")] })).fail();
});

test("C06 point 不复读：正反用例", () => {
  expect("C06", scriptOf({ narration: ["本地渲染不用排队。"], shots: [shot("本地开跑")] })).pass();
  expect("C06", scriptOf({ narration: ["本地渲染不用排队。"], shots: [shot("本地渲染不用排队。")] })).fail("WARN");
});

test("C07 五段齐全：正反用例", () => {
  const good = BEAT_SEQUENCE.map((beat) => shot("要点", { beat }));
  expect("C07", scriptOf({ narration: BEAT_SEQUENCE.map(() => "一。"), shots: good })).pass();
  const missing = BEAT_SEQUENCE.slice(0, 4).map((beat) => shot("要点", { beat }));
  expect("C07", scriptOf({ narration: ["一。", "二。", "三。", "四。"], shots: missing })).fail();

  const wrong = [
    shot("要点", { beat: "problem" }),
    shot("要点", { beat: "hook" }),
    shot("要点", { beat: "breakdown" }),
    shot("要点", { beat: "takeaway" }),
    shot("要点", { beat: "action" }),
  ];
  expect("C07", scriptOf({ narration: ["一。", "二。", "三。", "四。", "五。"], shots: wrong })).fail();
});

test("C07 兼容 beatRole，conclusion 映射成 takeaway", () => {
  const script = scriptOf({
    narration: ["一。", "二。", "三。", "四。", "五。"],
    shots: [
      shot("要点", { beatRole: "hook" }),
      shot("要点", { beatRole: "problem" }),
      shot("要点", { beatRole: "breakdown" }),
      shot("要点", { beatRole: "conclusion" }),
      shot("要点", { beatRole: "action" }),
    ],
  });
  expect("C07", script).pass();
});

test("C08 钩子在 3 秒内：正反用例与实测时间退化", () => {
  const good = scriptOf({
    narration: ["AI 写的周报，一看就是 AI 写的。"],
    shots: [shot("一眼能看出来", { beat: "hook" })],
  });
  const result = expect("C08", good).pass();
  assert.match(result.detail, /未用实测时间/);

  const bad = scriptOf({
    narration: ["随着 AI 的发展，周报越来越难写。"],
    shots: [shot("背景", { beat: "hook" })],
  });
  expect("C08", bad).fail();

  const measuredBad = scriptOf({
    narration: ["AI 写的周报，一看就是 AI 写的。"],
    shots: [shot("一眼能看出来", { beat: "hook" })],
  });
  expect("C08", measuredBad, {
    captions: [{ start: 0.2, end: 1.2, text: "大家好，今天聊聊 AI。" }],
  }).fail();

  const notFirst = scriptOf({
    narration: ["我先说个现象。", "AI 写的周报，一看就是 AI 写的。"],
    shots: [shot("现象", { beat: "problem" }), shot("一眼能看出来", { beat: "hook" })],
  });
  expect("C08", notFirst).fail();
});

test("C09 禁用词：正反用例", () => {
  expect("C09", scriptOf({ narration: ["我先列三条做完的事。"] })).pass();
  expect("C09", scriptOf({ narration: ["这个工具就是扛把子。"] })).fail();
});

test("C10 假对比句式：默认 FAIL，明确纠正对象降 WARN；评论区归 C12", () => {
  expect("C10", scriptOf({ narration: ["事实我给，句子它写。"] })).pass();
  expect("C10", scriptOf({ narration: ["不是技巧，而是态度。"] })).fail();
  expect("C10", scriptOf({ narration: ["不是保存的问题，而是上传的问题。"] })).fail("WARN");
  expect("C10", scriptOf({ narration: ["欢迎在评论区聊聊。"] })).pass();
});

test("C11 结尾动作：正反用例", () => {
  expect("C11", scriptOf({ narration: ["先列三条。", "现在打开备忘录，记一条。"] })).pass();
  expect("C11", scriptOf({ narration: ["第一句。", "今天就聊到这。"] })).fail();
});

test("C12 结尾问句判定：空问 FAIL、具体问 WARN、无问句 PASS、C12a 口号 FAIL", () => {
  expect("C12", scriptOf({ narration: ["先列三条。", "现在打开备忘录，记一条。"] })).pass();
  expect("C12", scriptOf({ narration: ["先列三条。", "你学会了吗？"] })).fail();
  expect("C12", scriptOf({ narration: ["先列三条。", "欢迎在评论区聊聊。"] })).fail();
  expect("C12", scriptOf({ narration: ["先列三条。", "你上周周报里有几条是自己写的事实？"] })).fail("WARN");
  expect("C12", scriptOf({ narration: ["先列三条。", "那到底该怎么办呢？"] })).fail();
  expect("C12", scriptOf({ narration: ["先列三条。", "未来可期。"] })).fail();
});

test("C13 术语解释：正反用例（WARN）", () => {
  expect("C13", scriptOf({ narration: ["Agent 就是能自己干活的程序。"] })).pass();
  expect("C13", scriptOf({ narration: ["Agent 很厉害。"] })).fail("WARN");
  expect("C13", scriptOf({ narration: ["Agent 很厉害。", "说白了，它能自己干活。"] })).pass();
});

test("C14 同句式开头：只报连续=2，连续 ≥3 交给 C23", () => {
  expect("C14", scriptOf({ narration: ["今天先列三条。", "再粘给它。", "最后说结论。"] })).pass();
  expect("C14", scriptOf({ narration: ["我们走吧。", "我们看看。", "我们说好。"] })).pass();
  expect("C14", scriptOf({ narration: ["我们走吧。", "我们看看。", "今天先这样。"] })).fail("WARN");
  expect("C23", scriptOf({ narration: ["我们走吧。", "我们看看。", "我们说好。"] })).fail("WARN");
});

test("C15 第一人称：正反用例（WARN）", () => {
  expect("C15", scriptOf({ narration: ["我之前也这样。", "后来我想明白了。"] })).pass();
  expect("C15", scriptOf({ narration: ["本地渲染不用排队。"] })).fail("WARN");
});

test("C16 排比：正反用例（WARN）", () => {
  expect("C16", scriptOf({ narration: ["做了什么，卡在哪，下周干啥。"] })).pass();
  expect("C16", scriptOf({ narration: ["今天，打开电脑，打开电脑，打开电脑。"] })).fail("WARN");
});

test("C17 待补占位：draft PASS/不拦，render 才检查", () => {
  const draft = runOne("C17", scriptOf({ narration: ["【待补：自己的场景】"] }));
  assert.equal(draft.status, "PASS");
  assert.match(draft.detail, /草稿阶段不拦截/);

  expect("C17", scriptOf({ narration: ["【待补：自己的场景】"] }), { stage: "render" }).fail();
  expect("C17", scriptOf({ narration: ["我昨天被客户看出来了。"] }), { stage: "render" }).pass();
});

test("C18 数字有出处：无 research SKIP，正反用例（WARN）", () => {
  const skipped = runOne("C18", scriptOf({ narration: ["成本下降了 30%。"] }));
  assert.equal(skipped.status, "SKIP");

  expect("C18", scriptOf({ narration: ["成本下降了 30%。"] }), {
    research: "报告显示成本下降了 30%。",
  }).pass();
  expect("C18", scriptOf({ narration: ["成本下降了 30%。"] }), {
    research: "报告只提到成本下降。",
  }).fail("WARN");
});

test("C19 夸张词：正反用例（WARN）", () => {
  expect("C19", scriptOf({ narration: ["先说一个最直接的判断。"] })).pass();
  expect("C19", scriptOf({ narration: ["最好，第一，彻底解决。"] })).fail("WARN");
});

test("规范 v2 示范 9 镜：C17 draft PASS / render FAIL，C02 信息句不超额度", () => {
  const script = JSON.parse(
    fs.readFileSync(path.join(ROOT, "test/fixtures/style-guide-demo.json"), "utf8")
  );
  assert.equal(script.narration.length, 9);
  assert.equal(script.shots.length, 9);
  assert.equal(countChars(script.narration[5]), 17, "镜 6 是 17 字信息句");
  assert.match(script.narration[2], /【待补/);
  assert.equal(script.narration[7], "稿子里每条都是我这周干过的。");
  assert.equal(script.narration[8], "现在打开备忘录，先记一条今天的。");

  const results = runRules({ script, rules: RULES, stage: "draft" });
  const byId = Object.fromEntries(results.map((result) => [result.id, result]));

  for (let i = 1; i <= 26; i++) {
    const id = `C${String(i).padStart(2, "0")}`;
    if (id === "C18") continue;
    assert.equal(byId[id].status, "PASS", `${id} 应 PASS：${byId[id].detail}`);
  }
  assert.equal(byId.C18.status, "SKIP");
  assert.equal(byId.C17.status, "PASS");
  assert.match(byId.C02.detail, /信息句 1 句/);
  assert.match(byId.C02.detail, /第 6 句/);

  const render = runRules({ script, rules: RULES, stage: "render" });
  assert.equal(render.find((result) => result.id === "C17").status, "FAIL");
});

test("C20 分行体：连续 4 句 ≤8 字 FAIL，3 句 PASS", () => {
  expect("C20", scriptOf({ narration: ["夜班。", "灯还亮着。", "她拿起周报。", "全是套话。"] })).fail();
  expect("C20", scriptOf({ narration: ["夜班。", "灯还亮着。", "全是套话。", "她最后还是把周报关掉了。"] })).pass();
});

test("C21 信息句额度：拆解每 8 镜 ≤1，超额度 FAIL", () => {
  const info1 = "我先把今天做完的事列成三条写在纸上。";
  const info2 = "再把这些事实按顺序粘给模型让它顺句子。";
  assert.ok(countChars(info1) >= 17 && countChars(info1) <= 22);
  assert.ok(countChars(info2) >= 17 && countChars(info2) <= 22);
  const shots = [
    shot("一", { beat: "breakdown" }),
    shot("二", { beat: "breakdown" }),
    shot("三", { beat: "breakdown" }),
  ];
  expect("C21", scriptOf({ narration: [info1, "先这样。"], shots })).pass();
  const result = expect("C21", scriptOf({ narration: [info1, info2, "先这样。"], shots })).fail();
  assert.match(result.detail, /信息句超额度/);
});

test("C22 过早总结：前 30% 命中 WARN，后段不拦", () => {
  expect("C22", scriptOf({ narration: ["总之，工具只是工具。", "后面再讲具体做法。"] })).fail("WARN");
  expect(
    "C22",
    scriptOf({ narration: ["先打开备忘录。", "记下今天做完的三件事。", "最后再总结一句。"] })
  ).pass();
});

test("C23 机械排比：连续同头、四字词、从…到…都 WARN", () => {
  expect("C23", scriptOf({ narration: ["我们走吧。", "我们看看。", "我们说好。"] })).fail("WARN");
  expect("C23", scriptOf({ narration: ["提质增效、降本减耗、开源节流。"] })).fail("WARN");
  expect("C23", scriptOf({ narration: ["从效率到质量，从个人到团队。"] })).fail("WARN");
});

test("C24/C25 抽象大词与替人物抒情：WARN", () => {
  expect("C24", scriptOf({ narration: ["这件事的本质是认知重构。"] })).fail("WARN");
  expect("C25", scriptOf({ narration: ["那一刻我明白了奋斗的意义。"] })).fail("WARN");
});

test("C26 长短交替：连续 5 句 12–16 字且相邻差 ≤2 WARN", () => {
  const narr = [12, 13, 14, 13, 14].map((n) => `${"字".repeat(n)}。`);
  expect("C26", scriptOf({ narration: narr })).fail("WARN");
  const varied = [12, 13, 14, 8, 15, 16].map((n) => `${"字".repeat(n)}。`);
  expect("C26", scriptOf({ narration: varied })).pass();
});

test("loadRules：默认文件与数组输入", () => {
  assert.equal(loadRules(RULES_FILE).length, 30);
  const one = {
    id: " custom ",
    name: " 自定义 ",
    description: " 说明 ",
    type: "regex",
    params: { pattern: "竞品", max: 0 },
    level: "WARN",
    enabled: false,
  };
  assert.deepEqual(loadRules([one]), [
    {
      id: "custom",
      name: "自定义",
      description: "说明",
      type: "regex",
      params: { pattern: "竞品", max: 0 },
      level: "WARN",
      stage: "draft",
      enabled: false,
    },
  ]);
});

test("loadRules：id 唯一、type/level/stage/check/regex/params 校验报清楚字段", () => {
  const base = {
    id: "demo",
    name: "示例",
    description: "示例规则",
    type: "builtin",
    check: "first_sentence_length",
    params: { max: 14 },
    level: "WARN",
    stage: "draft",
    enabled: true,
  };
  const fileWith = (rules) => writeRules({ version: 2, rules });
  const lastMessage = (fn) => {
    try {
      fn();
    } catch (err) {
      return String(err.message);
    }
    assert.fail("应该抛错");
  };

  assert.match(lastMessage(() => loadRules(fileWith([{ ...base }, { ...base }]))), /id 重复/);
  assert.match(lastMessage(() => loadRules(fileWith([{ ...base, type: "script" }]))), /type/);
  assert.match(lastMessage(() => loadRules(fileWith([{ ...base, level: "ERROR" }]))), /level/);
  assert.match(lastMessage(() => loadRules(fileWith([{ ...base, stage: "publish" }]))), /stage/);
  assert.match(
    lastMessage(() => loadRules(fileWith([{ ...base, draftStatus: "FAIL" }]))),
    /draftStatus/
  );
  assert.match(lastMessage(() => loadRules(fileWith([{ ...base, check: "nope" }]))), /check 不存在/);
  assert.match(lastMessage(() => loadRules(fileWith([{ ...base, check: "" }]))), /check/);
  assert.match(
    lastMessage(() =>
      loadRules(fileWith([{ ...base, type: "regex", check: undefined, params: { pattern: "(" } }]))
    ),
    /pattern.*无法编译/
  );
  assert.match(
    lastMessage(() => loadRules(fileWith([{ ...base, params: [] }]))),
    /params/
  );
  assert.match(
    lastMessage(() => loadRules(fileWith([{ ...base, enabled: "yes" }]))),
    /enabled/
  );
  assert.match(
    lastMessage(() =>
      loadRules(fileWith([{ ...base, type: "llm", check: undefined, prompt: "" }]))
    ),
    /prompt/
  );
  assert.match(
    lastMessage(() => loadRules(writeRules({ version: 1, rules: [base] }))),
    /version 必须是 2/
  );
  assert.match(lastMessage(() => loadRules(writeRules("not json"))), /不是合法 JSON/);
});

test("loadRules：disabled 规则保留并标 DISABLED", () => {
  const rule = {
    id: "off_rule",
    name: "关闭的规则",
    description: "已关闭",
    type: "regex",
    params: { pattern: "不该出现", max: 0 },
    level: "FAIL",
    enabled: false,
  };
  const [result] = runRules({ script: scriptOf({ narration: ["不该出现。"] }), rules: [rule] });
  assert.equal(result.status, "DISABLED");
  assert.equal(result.detail, "规则已禁用");
});

test("自定义 regex 规则：新增后能命中并解析", () => {
  const rule = {
    id: "brand_word",
    name: "竞品词",
    description: "不要提竞品名",
    type: "regex",
    params: { patterns: ["竞品", "友商"], max: 0 },
    level: "FAIL",
    enabled: true,
  };
  const [result] = runRules({
    script: scriptOf({ narration: ["友商也在做。"] }),
    rules: [rule],
  });
  assert.equal(result.status, "FAIL");
  assert.equal(result.id, "brand_word");
  assert.match(result.detail, /命中 1 处/);
});

test("validateRules：顶层必须是 {version:2,rules:[]}", () => {
  assert.throws(() => validateRules({ rules: [] }), /version/);
  assert.throws(() => validateRules({ version: 2 }), /rules/);
  assert.deepEqual(validateRules({ version: 2, rules: [] }), []);
});

test("resolveRulesFile：--rules > 项目目录 > 仓库根", () => {
  const project = path.join(tmpDir, "project");
  fs.mkdirSync(project, { recursive: true });
  const projectRules = path.join(project, "qc-rules.json");
  fs.writeFileSync(projectRules, JSON.stringify({ version: 2, rules: [] }), "utf8");
  const explicit = writeRules({ version: 2, rules: [] });

  assert.equal(resolveRulesFile({ rulesFile: explicit, projectDir: project }), path.resolve(explicit));
  assert.equal(resolveRulesFile({ projectDir: project }), projectRules);
  assert.equal(resolveRulesFile({ projectDir: tmpDir }), path.join(ROOT, "qc-rules.json"));
});
