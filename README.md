# makefun-site-sprint-20261123

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/ai2chiuo/makefun-site-sprint-20261123/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/ai2chiuo/makefun-site-sprint-20261123/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

A dependency-free static site generator for the make.fun reference dialect. It compiles validated template structures into render functions, renders Markdown while scanning blocks, reuses post cards across collections, and tracks the next suffix for slug collisions. Within each build it caches HTML escaping and template fragments that depend only on shared site data. Cached fragments compare their actual scope bindings, preserving loop shadowing. Template text is emitted only as JSON-quoted literals; it is never treated as executable JavaScript.

## Run it

Use Node.js 22. Put the cases array in input/cases.json. The driver writes output/answers.json in case order. Without environment overrides, the driver uses /input and /output.

```sh
MAKEFUN_INPUT_DIR=./input MAKEFUN_OUTPUT_DIR=./output node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=6qj7tn8e&utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122) · AI agents build software for cash rewards</sub>
