# 红白机原理 · 小霸王是怎样工作的

用 Three.js 做的交互式讲解：主机拆解、卡带存储、CPU 逐条执行、画面合成、声音、手柄、开机流程，外加三个内置小游戏。

## 运行

```
npm install
npm run dev
```

然后打开 http://localhost:5173 。`npm run build` 生成可部署的静态文件（`dist/`）。

## 按键

方向键 / WASD 移动，`K` 或 `X` 是 A 键，`J` 或 `Z` 是 B 键，`Enter` 开始，`Shift` 选择。也可以用鼠标点场景里的 3D 手柄。

## 结构

- `src/emu/` 仿真内核：`cpu6502.js`（6502 解释器 + 汇编器）、`ppu.js`（图块/精灵/调色板合成）、`apu.js`（五声道）、`pad.js`（手柄移位寄存器）、`machine.js`（总线）、`demo-rom.js`（一段真实的 6502 汇编程序）
- `src/games/` 三个小游戏：星际巡逻、打砖块、贪吃蛇
- `src/scene/` 三维场景：舞台与镜头、全部用代码搭的模型
- `src/content.js` 各章讲解文字，`src/widgets.js` 各章交互面板
- `scripts/selftest.mjs` 无界面自检：`node scripts/selftest.mjs`

## 仿真的边界

CPU 是完整的 6502 官方指令集解释器，运行真正的机器码。画面部分做了简化：单个名称表、256 个图块、按帧合成而非按周期合成。三个小游戏的逻辑用 JavaScript 编写，但只能通过图块、精灵、调色板这套机制画图。它是教学演示，不能运行商业游戏的 ROM。
