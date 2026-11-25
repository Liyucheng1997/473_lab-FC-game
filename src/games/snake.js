// 贪吃蛇：整个画面只用"背景图块"画出来，没有用到任何精灵
import { T } from '../emu/tiles.js';

const CW = 16, CH = 13, OY = 4; // 16×13 个格子，每格 16×16 像素，从第 4 行图块开始
const DIRS = { UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0] };

export default {
  id: 'snake',
  name: '贪吃蛇',
  en: 'SNAKE',
  desc: '只用背景图块，没有一个精灵。每走一步只改写两三个格子。',
  keys: '方向键移动',

  init({ ppu }) {
    ppu.reset();
    ppu.setPal(0, [0x0f, 0x2a, 0x16, 0x30]); // 黑、绿、红、白
    ppu.setPal(1, [0x0f, 0x00, 0x2d, 0x30]); // 墙：灰
    this.state = 'title';
    this.score = 0;
    this.drawField(ppu);
    ppu.text(2, 1, 'SNAKE');
    ppu.text(10, 14, 'PRESS START');
    this.hud(ppu);
  },

  cell(ppu, cx, cy, kind) {
    const x = cx * 2, y = OY + cy * 2;
    const t = kind === 'body' ? [T.SEG, T.SEG, T.SEG, T.SEG]
      : kind === 'head' ? [T.EYE, T.EYE, T.SEG, T.SEG]
      : kind === 'apple' ? [T.APPLE, T.APPLE + 1, T.APPLE + 2, T.APPLE + 3]
      : kind === 'wall' ? [T.WALL, T.WALL, T.WALL, T.WALL] : [0, 0, 0, 0];
    ppu.setTile(x, y, t[0]); ppu.setTile(x + 1, y, t[1]);
    ppu.setTile(x, y + 1, t[2]); ppu.setTile(x + 1, y + 1, t[3]);
    ppu.setAttr(cx, (OY >> 1) + cy, kind === 'wall' ? 1 : 0);
  },
  drawField(ppu) {
    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
      this.cell(ppu, x, y, x === 0 || y === 0 || x === CW - 1 || y === CH - 1 ? 'wall' : 'empty');
    }
  },
  hud(ppu) { ppu.text(18, 1, 'SCORE ' + String(this.score).padStart(4, '0')); },

  start(ppu) {
    this.drawField(ppu);
    ppu.fill(0, 2, 32, 1, 0);
    this.snake = [{ x: 5, y: 6 }, { x: 4, y: 6 }, { x: 3, y: 6 }];
    this.dir = 'RIGHT'; this.next = 'RIGHT';
    this.score = 0; this.timer = 0; this.state = 'play';
    this.snake.forEach((s, i) => this.cell(ppu, s.x, s.y, i ? 'body' : 'head'));
    this.placeApple(ppu);
    this.hud(ppu);
  },
  placeApple(ppu) {
    let x, y;
    do { x = 1 + Math.floor(Math.random() * (CW - 2)); y = 1 + Math.floor(Math.random() * (CH - 2)); }
    while (this.snake.some((s) => s.x === x && s.y === y));
    this.apple = { x, y };
    this.cell(ppu, x, y, 'apple');
  },

  update({ ppu, pad, apu }) {
    if (this.state !== 'play') {
      if (pad.hit('START') || pad.hit('A')) { apu.pulse({ freq: 660, dur: 0.08 }); this.start(ppu); }
      return;
    }
    for (const d of Object.keys(DIRS)) {
      if (pad.hit(d) && DIRS[d][0] !== -DIRS[this.dir][0] && DIRS[d][1] !== -DIRS[this.dir][1]) this.next = d;
    }
    const speed = Math.max(5, 12 - Math.floor(this.snake.length / 4));
    if (++this.timer < speed) return;
    this.timer = 0;
    this.dir = this.next;
    const [dx, dy] = DIRS[this.dir];
    const head = { x: this.snake[0].x + dx, y: this.snake[0].y + dy };
    const hitWall = head.x <= 0 || head.y <= 0 || head.x >= CW - 1 || head.y >= CH - 1;
    if (hitWall || this.snake.some((s) => s.x === head.x && s.y === head.y)) {
      this.state = 'over';
      ppu.text(4, 2, 'GAME OVER - PRESS START');
      apu.noise({ dur: 0.4, vol: 0.5, rate: 0.4 });
      apu.pulse({ freq: 220, to: 55, dur: 0.4 });
      return;
    }
    this.cell(ppu, this.snake[0].x, this.snake[0].y, 'body');
    this.snake.unshift(head);
    this.cell(ppu, head.x, head.y, 'head');
    if (head.x === this.apple.x && head.y === this.apple.y) {
      this.score += 10;
      this.hud(ppu);
      apu.pulse({ freq: 523, to: 1046, dur: 0.1, duty: 0.25 });
      this.placeApple(ppu);
    } else {
      const tail = this.snake.pop();
      this.cell(ppu, tail.x, tail.y, 'empty');
    }
  },
};
