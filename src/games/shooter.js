// 星际巡逻：横版射击。星空是会卷动的背景，飞船/敌人/子弹全是精灵
import { T } from '../emu/tiles.js';

const MAX_E = 12, MAX_B = 4;

export default {
  id: 'shooter',
  name: '星际巡逻',
  en: 'STAR PATROL',
  desc: '星空背景靠"卷轴"滚动，顶部状态栏用分屏保持不动；敌人排成一排时会触发每行 8 个精灵的限制。',
  keys: '方向键移动，A 射击',

  init({ ppu }) {
    ppu.reset();
    ppu.setPal(0, [0x0f, 0x10, 0x16, 0x30]);
    ppu.setPal(4, [0x0f, 0x30, 0x27, 0x21]); // 飞船
    ppu.setPal(5, [0x0f, 0x2a, 0x16, 0x28]); // 敌人 A
    ppu.setPal(6, [0x0f, 0x24, 0x30, 0x28]); // 敌人 B
    ppu.setPal(7, [0x0f, 0x28, 0x27, 0x30]); // 子弹、爆炸
    for (let y = 3; y < 30; y++) for (let x = 0; x < 32; x++) {
      const r = Math.random();
      ppu.setTile(x, y, r < 0.06 ? T.STAR1 : r < 0.09 ? T.STAR2 : 0);
    }
    ppu.splitY = 24; // 前 24 行（状态栏）不跟着卷动
    this.frame = 0;
    this.state = 'title';
    this.reset();
    ppu.text(2, 2, 'STAR PATROL - PRESS START');
    this.hud(ppu);
  },
  reset() {
    this.ship = { x: 32, y: 120 };
    this.bullets = []; this.enemies = []; this.booms = [];
    this.score = 0; this.lives = 3; this.spawn = 60; this.wave = 0; this.safe = 0; this.cool = 0;
  },
  hud(ppu) {
    ppu.text(2, 1, 'SCORE ' + String(this.score).padStart(5, '0'));
    for (let i = 0; i < 3; i++) ppu.setTile(26 + i, 1, i < this.lives ? T.HEART : 0);
  },

  spawnWave() {
    this.wave++;
    if (this.wave % 3 === 0) {
      // 一字长蛇阵：10 个敌人在同一高度 → 超过每行 8 个精灵的硬件上限
      const y = 48 + Math.random() * 150;
      for (let i = 0; i < 10 && this.enemies.length < MAX_E; i++) {
        this.enemies.push({ x: 256 + i * 14, base: y, amp: 0, ph: 0, sp: 1.1, kind: 1 });
      }
    } else {
      const n = 3 + Math.min(4, Math.floor(this.wave / 3));
      for (let i = 0; i < n && this.enemies.length < MAX_E; i++) {
        this.enemies.push({ x: 256 + i * 22, base: 60 + Math.random() * 130, amp: 10 + Math.random() * 22, ph: Math.random() * 6, sp: 1 + Math.random() * 0.8 + this.wave * 0.02, kind: 0 });
      }
    }
  },

  update({ ppu, pad, apu }) {
    this.frame++;
    if (this.frame & 1) ppu.scrollX = (ppu.scrollX + 1) & 255;
    const playing = this.state === 'play';

    if (!playing) {
      this.ship.y = 120 + Math.sin(this.frame / 30) * 16;
      if (pad.hit('START') || pad.hit('A')) {
        this.reset();
        this.state = 'play';
        ppu.fill(0, 2, 32, 1, 0);
        this.hud(ppu);
        apu.pulse({ freq: 440, to: 880, dur: 0.15, duty: 0.25 });
      }
    } else {
      const s = this.ship;
      if (pad.held('LEFT')) s.x -= 2;
      if (pad.held('RIGHT')) s.x += 2;
      if (pad.held('UP')) s.y -= 2;
      if (pad.held('DOWN')) s.y += 2;
      s.x = Math.max(0, Math.min(200, s.x));
      s.y = Math.max(28, Math.min(216, s.y));
      if (this.cool > 0) this.cool--;
      if (pad.held('A') && this.cool === 0 && this.bullets.length < MAX_B) {
        this.bullets.push({ x: s.x + 14, y: s.y + 4 });
        this.cool = 10;
        apu.pulse({ freq: 900, to: 300, dur: 0.08, vol: 0.35, duty: 0.125 }, 'pulse2');
      }
      if (this.safe > 0) this.safe--;
    }

    if (--this.spawn <= 0) { this.spawnWave(); this.spawn = Math.max(70, 150 - this.wave * 4); }
    for (const b of this.bullets) b.x += 5;
    this.bullets = this.bullets.filter((b) => b.x < 256);
    for (const e of this.enemies) {
      e.x -= e.sp;
      e.ph += 0.06;
      e.y = e.base + Math.sin(e.ph) * e.amp;
      if (!playing) continue;
      for (const b of this.bullets) {
        if (!b.dead && b.x + 8 > e.x && b.x < e.x + 8 && b.y + 6 > e.y && b.y + 2 < e.y + 8) {
          b.dead = e.dead = true;
          this.score += 50;
          this.hud(ppu);
          this.booms.push({ x: e.x, y: e.y, t: 12 });
          apu.noise({ dur: 0.12, vol: 0.4, rate: 0.8 });
        }
      }
      const s = this.ship;
      if (!e.dead && !this.safe && e.x + 7 > s.x + 2 && e.x < s.x + 14 && e.y + 7 > s.y + 3 && e.y < s.y + 13) {
        e.dead = true;
        this.lives--;
        this.safe = 90;
        this.hud(ppu);
        this.booms.push({ x: s.x + 4, y: s.y + 4, t: 16 });
        apu.noise({ dur: 0.35, vol: 0.6, rate: 0.3 });
        apu.dmc();
        if (this.lives <= 0) { this.state = 'over'; ppu.text(4, 2, 'GAME OVER - PRESS START'); }
      }
    }
    this.bullets = this.bullets.filter((b) => !b.dead);
    this.enemies = this.enemies.filter((e) => !e.dead && e.x > -8);
    for (const b of this.booms) b.t--;
    this.booms = this.booms.filter((b) => b.t > 0);
    this.draw(ppu);
  },

  draw(ppu) {
    ppu.clearSprites();
    const s = this.ship;
    const blink = this.safe > 0 && (this.frame & 4);
    if (this.state !== 'over' && !blink) {
      for (let q = 0; q < 4; q++) ppu.sprite(q, Math.round(s.x) + (q & 1) * 8, Math.round(s.y) + (q >> 1) * 8, T.SHIP + q, 0);
    }
    this.bullets.forEach((b, i) => ppu.sprite(4 + i, b.x, b.y, T.BULLET, 3));
    // 每帧轮换敌人在精灵表里的顺序：超限时大家"轮流消失"，看起来就是闪烁
    const n = this.enemies.length;
    this.enemies.forEach((e, i) => {
      if (e.x < 0 || e.x > 255) return;
      const slot = 8 + ((i + this.frame) % Math.max(n, 1));
      ppu.sprite(slot, Math.round(e.x), Math.round(e.y), (this.frame >> 3) & 1 ? T.ENEMY1 : T.ENEMY2, e.kind ? 2 : 1);
    });
    this.booms.forEach((b, i) => { if (i < 4) ppu.sprite(24 + i, Math.round(b.x), Math.round(b.y), T.BOOM, 3 | (b.t & 2 ? 0x40 : 0)); });
  },
};
