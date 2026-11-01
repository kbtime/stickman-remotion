import test from "node:test";
import assert from "node:assert/strict";
import { lintScript, BEAT_PLAN, BEAT_ROLES } from "../scripts/lint.mjs";

const shot = (point, duration, extra = {}) => {
  const value = { duration, ...extra };
  if (point !== undefined) value.point = point;
  return value;
};

test("BEAT_PLAN：统一成规范五段，短版各段 1–2 镜", () => {
  assert.deepEqual(
    BEAT_PLAN.map((beat) => beat.role),
    ["hook", "problem", "breakdown", "takeaway", "action"]
  );
  assert.deepEqual(
    BEAT_PLAN.map((beat) => beat.label),
    ["钩子", "问题", "拆解", "结论", "行动"]
  );
  for (const beat of BEAT_PLAN) {
    assert.deepEqual(beat.shortShots, [1, 2]);
    assert.equal(beat.chars.length, 2);
    assert.equal(beat.seconds.length, 2);
  }
  assert.deepEqual(BEAT_ROLES, ["hook", "problem", "breakdown", "conclusion", "action"]);
});

test("lintScript：缺 point 报 WARN", () => {
  const result = lintScript({
    narration: ["一", "二", "三"],
    shots: [shot("要点一", 2), shot(undefined, 2), shot("", 2)],
  });
  const missing = result.items.filter((item) => item.code === "missing-point");
  assert.equal(missing.length, 2);
  assert.ok(missing.some((item) => item.message === "shot 2 缺少 point"));
  assert.ok(missing.some((item) => item.message === "shot 3 缺少 point"));
  assert.ok(missing.every((item) => item.level === "WARN"));
});

test("lintScript：narration 与 shots 数量不一致报 WARN", () => {
  const result = lintScript({
    narration: ["一", "二"],
    shots: [shot("要点", 2)],
  });
  const item = result.items.find((i) => i.code === "narration-count");
  assert.ok(item);
  assert.equal(item.level, "WARN");
});

test("lintScript：结构错误（没有 shots）返回 ERROR", () => {
  const result = lintScript({ narration: [] });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].level, "ERROR");
  assert.equal(result.items[0].code, "no-shots");
  assert.equal(result.pacing.length, BEAT_PLAN.length);
  assert.ok(
    result.pacing.every(
      (row) => row.actualShots === 0 && row.actualSec === 0 && row.suggestedSec === 0
    )
  );
});

test("lintScript：短版五段各 1 镜且时长在区间内，没有 pacing WARN", () => {
  const result = lintScript({
    narration: [],
    shots: [
      shot("钩子", 3, { beat: "hook" }),
      shot("问题", 4, { beat: "problem" }),
      shot("拆解", 8, { beat: "breakdown" }),
      shot("结论", 4, { beat: "takeaway" }),
      shot("行动", 3, { beat: "action" }),
    ],
  });
  const byRole = Object.fromEntries(result.pacing.map((row) => [row.role, row]));
  assert.equal(byRole.hook.actualShots, 1);
  assert.deepEqual(byRole.hook.suggestedShotRange, [1, 2]);
  assert.deepEqual(byRole.hook.suggestedSecRange, [2, 4]);
  assert.equal(byRole.breakdown.actualSec, 8);
  assert.equal(result.items.filter((i) => i.code === "pacing").length, 0);
  assert.equal(result.items.filter((i) => i.level === "ERROR").length, 0);
});

test("lintScript：短版某段超过 2 镜或时长越界时报 WARN", () => {
  const result = lintScript({
    narration: [],
    shots: [
      shot("钩子", 3, { beat: "hook" }),
      shot("问题一", 3, { beat: "problem" }),
      shot("问题二", 3, { beat: "problem" }),
      shot("问题三", 3, { beat: "problem" }),
      shot("拆解", 8, { beat: "breakdown" }),
      shot("结论", 4, { beat: "takeaway" }),
      shot("行动", 3, { beat: "action" }),
    ],
  });
  const pacing = result.items.filter((i) => i.code === "pacing");
  assert.equal(pacing.length, 1);
  assert.match(pacing[0].message, /问题段/);
  assert.match(pacing[0].message, /建议 1–2 镜，实际 3 镜/);
});

test("lintScript：长版按规范镜头/时长区间提示", () => {
  const shots = [];
  const push = (count, beat, duration) => {
    for (let i = 0; i < count; i++) shots.push(shot(`要点${shots.length + 1}`, duration, { beat }));
  };
  push(3, "hook", 4);
  push(5, "problem", 3);
  push(12, "breakdown", 4);
  push(2, "takeaway", 4);
  push(1, "action", 5);
  const result = lintScript({ narration: [], shots });
  assert.equal(shots.length, 23);
  assert.equal(result.items.filter((i) => i.code === "pacing").length, 0);
  const breakdown = result.pacing.find((row) => row.role === "breakdown");
  assert.deepEqual(breakdown.suggestedShotRange, [12, 30]);
  assert.deepEqual(breakdown.suggestedSecRange, [30, 90]);
});

test("lintScript：beatRole=conclusion 视为结论段", () => {
  const result = lintScript({
    narration: [],
    shots: [
      shot("钩子", 3, { beatRole: "hook" }),
      shot("问题", 3, { beatRole: "problem" }),
      shot("拆解", 8, { beatRole: "breakdown" }),
      shot("结论", 4, { beatRole: "conclusion" }),
      shot("行动", 3, { beatRole: "action" }),
    ],
  });
  const takeaway = result.pacing.find((row) => row.role === "takeaway");
  assert.equal(takeaway.actualShots, 1);
});

test("lintScript：首镜超过 3 秒且不是 hook 时给 INFO", () => {
  const result = lintScript({
    narration: [],
    shots: [shot("开场", 4.2), shot("收尾", 2)],
  });
  const item = result.items.find((i) => i.code === "first-shot-hook");
  assert.ok(item);
  assert.equal(item.level, "INFO");

  const hooked = lintScript({
    narration: [],
    shots: [shot("开场", 4.2, { beat: "hook" }), shot("收尾", 2)],
  });
  assert.equal(hooked.items.some((i) => i.code === "first-shot-hook"), false);
});

test("lintScript：无效 beatRole 报 WARN，不崩溃", () => {
  const result = lintScript({
    narration: ["一"],
    shots: [shot("要点", 2, { beatRole: "opening" })],
  });
  const item = result.items.find((i) => i.code === "invalid-beat-role");
  assert.ok(item);
  assert.equal(item.level, "WARN");
});

test("lintScript：连续 3 镜同一 scene 只给 INFO，不算硬规则", () => {
  const result = lintScript({
    narration: [],
    shots: [
      shot("一", 2, { scene: "desk" }),
      shot("二", 2, { scene: "desk" }),
      shot("三", 2, { scene: "desk" }),
      shot("四", 2, { scene: "office" }),
    ],
  });
  const item = result.items.find((i) => i.code === "same-scene");
  assert.ok(item);
  assert.equal(item.level, "INFO");
});
