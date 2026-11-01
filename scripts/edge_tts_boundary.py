#!/usr/bin/env python3
"""用 edge-tts 7.x 合成音频，并输出逐词边界。

edge-tts 7 默认只返回 SentenceBoundary；要拿到词级时间轴必须显式传
boundary="WordBoundary"。

用法：
  python3 scripts/edge_tts_boundary.py \
    --text "第一句。第二句。" \
    --voice zh-CN-XiaoxiaoNeural \
    --rate=-8% \
    --audio public/demo-narration.mp3 \
    --boundaries /tmp/demo-boundaries.json

也可以把文本写进文件，避免超长命令行：
  python3 scripts/edge_tts_boundary.py --text-file /tmp/tts.txt ...

boundaries JSON 是数组：
  [{"start": 0.12, "end": 0.46, "text": "第一"}, ...]
offset / duration 的原始单位是 100ns（1 秒 = 10_000_000），这里统一换成秒。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

try:
    import edge_tts
except ImportError:  # pragma: no cover - 只在依赖缺失时触发
    sys.stderr.write(
        "缺少 edge-tts。请先安装：pip install --user --break-system-packages 'edge-tts>=7.3.1'\n"
    )
    raise SystemExit(2)

# edge-tts 的时间单位是 100 纳秒
TICKS_PER_SECOND = 10_000_000


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="edge-tts WordBoundary 合成：写 mp3 + 逐词边界 JSON"
    )
    text_group = parser.add_mutually_exclusive_group(required=True)
    text_group.add_argument("--text", help="要合成的文本")
    text_group.add_argument("--text-file", help="从 UTF-8 文件读取文本")
    parser.add_argument(
        "--voice", default="zh-CN-XiaoxiaoNeural", help="edge-tts 音色"
    )
    parser.add_argument(
        "--rate", default="+0%", help="语速，例如 +0%% / -8%% / +10%%"
    )
    parser.add_argument("--audio", required=True, help="输出 mp3 路径")
    parser.add_argument("--boundaries", required=True, help="输出边界 JSON 路径")
    return parser.parse_args()


async def synthesize(
    text: str,
    voice: str,
    rate: str,
    audio_path: Path,
    boundaries_path: Path,
) -> None:
    audio_path.parent.mkdir(parents=True, exist_ok=True)
    boundaries_path.parent.mkdir(parents=True, exist_ok=True)

    communicate = edge_tts.Communicate(
        text,
        voice,
        rate=rate,
        boundary="WordBoundary",
    )

    boundaries: list[dict[str, object]] = []
    audio_bytes = 0

    with audio_path.open("wb") as audio_file:
        async for chunk in communicate.stream():
            chunk_type = chunk.get("type")
            if chunk_type == "audio":
                data = chunk.get("data")
                if data:
                    audio_file.write(data)
                    audio_bytes += len(data)
            elif chunk_type == "WordBoundary":
                offset = int(chunk.get("offset", 0) or 0)
                duration = int(chunk.get("duration", 0) or 0)
                words = chunk.get("text", "")
                boundaries.append(
                    {
                        "start": round(offset / TICKS_PER_SECOND, 6),
                        "end": round((offset + duration) / TICKS_PER_SECOND, 6),
                        "text": words,
                    }
                )

    if audio_bytes == 0:
        raise RuntimeError("edge-tts 没有返回任何音频数据")

    boundaries_path.write_text(
        json.dumps(boundaries, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    args = parse_args()
    if args.text is not None:
        text = args.text
    else:
        text = Path(args.text_file).read_text(encoding="utf-8")

    text = text.strip()
    if not text:
        raise SystemExit("输入文本为空")

    asyncio.run(
        synthesize(
            text=text,
            voice=args.voice,
            rate=args.rate,
            audio_path=Path(args.audio),
            boundaries_path=Path(args.boundaries),
        )
    )


if __name__ == "__main__":
    main()
