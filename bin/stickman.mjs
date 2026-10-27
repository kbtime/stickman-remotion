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
      "  --force-tts        强制重新生成旁白与字幕",
      "  --help             显示本帮助",
      "",
      "示例:",
      "  stickman render --project examples/sample-story",
      "  stickman render --project examples/sample-story --aspect 9:16",
      "  stickman render --project examples/sample --audio voice.mp3 --out out/demo.mp4",
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
};

const MAIN_HELP = [
  "stickman — 火柴人讲解视频 CLI",
  "",
  "用法:",
  "  stickman render [选项]   渲染 mp4（必要时先 TTS）",
  "  stickman tts [选项]      只生成旁白与字幕",
  "  stickman --help",
  "",
  "示例:",
  "  stickman render --project examples/sample-story",
  "  stickman render --project examples/sample-story --aspect 9:16",
  "  stickman tts --project examples/sample --force",
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
