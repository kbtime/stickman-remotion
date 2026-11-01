#!/usr/bin/env node
/**
 * stickman — 火柴人讲解视频 CLI
 *
 * 只是 scripts/render.mjs 与 scripts/tts.mjs 的一层薄包装：
 * 子命令之后的 argv 原样转发，工作目录固定为仓库根，退出码透传。
 *
 * 用法：
 *   stickman render --project examples/sample-story --aspect 9:16
 *   stickman tts --project examples/sample --audio voice.mp3
 *   stickman --help
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// import.meta.url -> 绝对路径，兼容 Windows / 含空格路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const COMMANDS = {
  render: {
    script: path.join("scripts", "render.mjs"),
    desc: "渲染 mp4（必要时先 TTS）",
    help: [
      "stickman render — 渲染 mp4（必要时先 TTS）",
      "",
      "用法:",
      "  stickman render [选项]",
      "",
      "常用参数（全部原样转发给 scripts/render.mjs）:",
      "  --project <dir>    项目目录，含 script.json（如 examples/sample-story）",
      "  --aspect <ratio>   画幅 16:9 或 9:16（优先级最高）",
      "  --audio <file>     使用现成音频，跳过 TTS",
      "  --out <file>       输出路径（默认 out/<name>.mp4）",
      "  --preview <time>   只渲染前 N 秒（如 30s / 15 / 10.5s），默认加 -preview 后缀",
      "  --content-gate     渲染前跑 lint --stage render，有 FAIL 则中止（默认关闭）",
      "  --force-tts        强制重新生成旁白与字幕",
      "  --help             显示本帮助",
      "",
      "示例:",
      "  stickman render --project examples/sample-story",
      "  stickman render --project examples/sample-story --aspect 9:16",
      "  stickman render --project examples/sample --audio voice.mp3 --out out/demo.mp4",
      "  stickman render --project examples/sample --preview 10.5",
    ].join("\n"),
  },
  tts: {
    script: path.join("scripts", "tts.mjs"),
    desc: "只生成旁白与字幕",
    help: [
      "stickman tts — 只生成旁白与字幕",
      "",
      "用法:",
      "  stickman tts [选项]",
      "",
      "常用参数（全部原样转发给 scripts/tts.mjs）:",
      "  --project <dir>    项目目录，含 script.json（如 examples/sample）",
      "  --audio <file>     使用现成音频，只生成字幕时间轴",
      "  --voice <name>     音色（默认 zh-CN-XiaoxiaoNeural）",
      "  --rate <rate>      语速（默认 +0%，如 +10%）",
      "  --force            强制重新生成",
      "  --help             显示本帮助",
      "",
      "示例:",
      "  stickman tts --project examples/sample",
      "  stickman tts --project examples/sample --voice zh-CN-YunxiNeural --rate +10%",
    ].join("\n"),
  },
  qc: {
    script: path.join("scripts", "qc.mjs"),
    desc: "成片 QC：黑帧/空镜/主角尺寸/字幕安全区/字幕时长/内容检查",
    help: [
      "stickman qc — 成片 QC，输出 qc-report.json 与 qc-report.md",
      "",
      "用法:",
      "  stickman qc --video <mp4> --captions <captions.json> [选项]",
      "",
      "常用参数（全部原样转发给 scripts/qc.mjs）:",
      "  --video <file>     要检查的视频，如 out/sample.mp4",
      "  --captions <file>  字幕时间轴，如 public/sample-captions.json",
      "  --script <file>    可选：script.json，额外检查 point/节奏 + 内容规则",
      "  --rules <file>     内容规则文件（默认项目目录或仓库根 qc-rules.json）",
      "  --stage <stage>    内容规则阶段：draft（默认）或 render",
      "  --no-content       关闭内容检查（builtin / regex / LLM 全部跳过）",
      "  --model <name>     内容检查模型（默认 deepseek-v4-flash）",
      "  --out-dir <dir>    报告目录（默认 qc/<视频名>）",
      "  --sample-fps <n>   抽帧频率，默认 2",
      "  --preview          预览视频标记：只检查视频时长内的字幕",
      "  --help             显示本帮助",
      "",
      "示例:",
      "  stickman qc --video out/sample.mp4 --captions public/sample-captions.json",
      "  stickman qc --video out/sample.mp4 --captions public/sample-captions.json --script examples/sample/script.json",
      "  stickman qc --video out/sample.mp4 --captions public/sample-captions.json --script examples/sample/script.json --rules qc-rules.json",
      "  stickman qc --video out/sample-preview.mp4 --captions public/sample-captions.json --preview",
    ].join("\n"),
  },
  research: {
    script: path.join("scripts", "research.mjs"),
    desc: "事实核查：抽取数字/事实说法并联网搜索判定",
    help: [
      "stickman research — 事实核查，输出 research.md 与 research.json",
      "",
      "用法:",
      "  stickman research --project <dir> [--out <file>] [--n 5] [--max-claims 12] [--no-llm]",
      "",
      "常用参数（全部原样转发给 scripts/research.mjs）:",
      "  --project <dir>    项目目录，含 script.json（如 examples/sample-story）",
      "  --out <file>       输出 md 路径（默认 <dir>/research.md，json 写同名 .json）",
      "  --n <n>            每条说法取多少条搜索结果，默认 5",
      "  --max-claims <n>   最多核查多少条说法，默认 12",
      "  --no-llm           不用 DEEPSEEK_API_KEY，走正则启发式抽取与判定",
      "  --model <name>     LLM 模型，默认 deepseek-v4-flash（也可用 STICKMAN_LLM_MODEL）",
      "  --help             显示本帮助",
      "",
      "依赖:",
      "  - DEEPSEEK_API_KEY（LLM 抽取/判定；没有时自动走启发式）",
      "  - ds-search（默认 /home/box/.local/bin/ds-search，可用 DS_SEARCH_BIN 覆盖）",
      "",
      "示例:",
      "  stickman research --project examples/sample",
      "  stickman research --project examples/sample --no-llm --n 3",
      "  stickman research --project examples/sample-drucker --out out/drucker-research.md",
    ].join("\n"),
  },
  lint: {
    script: path.join("scripts", "lint.mjs"),
    desc: "脚本文案 lint：结构 / 五段节奏 / qc-rules 非 LLM 规则",
    help: [
      "stickman lint — 脚本文案 lint，输出问题、五段节奏与非 LLM 内容规则结果",
      "",
      "用法:",
      "  stickman lint --project <dir> [--rules <file>] [--stage render] [--captions <file>]",
      "",
      "常用参数（全部原样转发给 scripts/lint.mjs）:",
      "  --project <dir>    项目目录，含 script.json（如 examples/sample）",
      "  --rules <file>     规则文件（默认项目目录 qc-rules.json，其次仓库根）",
      "  --stage <stage>    draft（默认）或 render；C17 等 render 规则只在 render 生效",
      "  --captions <file>  captions.json（默认 public/<目录名>-captions.json 或 <dir>/captions.json）",
      "  --help             显示本帮助",
      "",
      "检查项:",
      "  - shot 缺 point（结构 WARN）与 narration/shots 数量不一致",
      "  - 五段节奏：钩子/问题/拆解/结论/行动，按规范镜头数、时长区间提示",
      "  - qc-rules.json 的 C01–C19（builtin/regex），自动找 research.md 供 C18",
      "  - LLM 规则不在 lint 里跑",
      "",
      "退出码：有 FAIL 为 1；只有 WARN / INFO / SKIP 为 0。",
      "",
      "示例:",
      "  stickman lint --project examples/sample-story --stage render",
      "  stickman lint --project examples/sample-story --stage render",
      "  stickman lint --project examples/sample-story --rules ./my-rules.json",
    ].join("\n"),
  },
};

const MAIN_HELP = [
  "stickman — 火柴人讲解视频 CLI",
  "",
  "用法:",
  "  stickman render [选项]   渲染 mp4（必要时先 TTS）",
  "  stickman tts [选项]      只生成旁白与字幕",
  "  stickman qc [选项]       成片 QC（黑帧/空镜/主角尺寸/字幕安全区）",
  "  stickman research [选项] 事实核查（抽取数字/事实说法并联网搜索）",
  "  stickman lint [选项]     脚本文案 lint（point / narration / 节奏）",
  "  stickman --help",
  "",
  "示例:",
  "  stickman render --project examples/sample-story",
  "  stickman render --project examples/sample-story --aspect 9:16",
  "  stickman render --project examples/sample-story --content-gate",
  "  stickman tts --project examples/sample --force",
  "  stickman qc --video out/sample.mp4 --captions public/sample-captions.json",
  "  stickman research --project examples/sample --no-llm",
  "  stickman lint --project examples/sample-story --stage render",
  "",
  "也可用: npx stickman … / npm link 后全局 stickman / node bin/stickman.mjs …",
].join("\n");

const printHelp = (text) => {
  process.stdout.write(text + "\n");
};

const main = (argv) => {
  const [cmd, ...rest] = argv;

  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    printHelp(MAIN_HELP);
    return 0;
  }

  const entry = COMMANDS[cmd];
  if (!entry) {
    process.stderr.write(
      `未知命令 "${cmd}"。可用：${Object.keys(COMMANDS).join(", ")}\n\n${MAIN_HELP}\n`
    );
    return 1;
  }

  if (rest.includes("--help") || rest.includes("-h")) {
    printHelp(entry.help);
    return 0;
  }

  const scriptPath = path.join(ROOT, entry.script);
  const result = spawnSync(process.execPath, [scriptPath, ...rest], {
    stdio: "inherit",
    cwd: ROOT,
  });

  if (result.error) {
    process.stderr.write(`无法启动 ${entry.script}: ${result.error.message}\n`);
    return 1;
  }
  if (result.signal) {
    process.stderr.write(`${entry.script} 被信号 ${result.signal} 终止\n`);
    return 1;
  }
  return result.status ?? 1;
};

process.exit(main(process.argv.slice(2)));
