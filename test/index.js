// 让 `node --test test/` 也能跑：目录形式会解析到这个入口，逐个加载测试文件。
import "./lint.test.mjs";
import "./research.test.mjs";
import "./content-rules.test.mjs";
import "./content-qc.test.mjs";
