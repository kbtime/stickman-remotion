import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.setConcurrency(null);
Config.setChromiumOpenGlRenderer("swangle");

// 默认画幅；Composition 里若给了 width/height 则以 props 为准。
Config.setCodec("h264");
Config.setPixelFormat("yuv420p");
