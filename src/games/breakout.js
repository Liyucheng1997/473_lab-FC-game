// 打砖块：砖块和墙是背景图块，球和挡板是精灵
import { T } from '../emu/tiles.js';

const PADDLE_Y = 216, LEFT = 16, RIGHT = 240;

export default {
  id: 'breakout',
  name: '打砖块',
  en: 'BRICKS',
  desc: '砖和墙是背景图块，球和挡板是精灵。敲掉一块砖 = 把两个格子改回空白。',
  keys: '左右移动，A 发球',

  init({ ppu }) {
    ppu.reset();
    ppu.setPal(0, [0x0f, 0x00, 0x2d, 0x30]); // 墙、文字
    ppu.setPal(1, [0x0f, 0x16, 0x06, 0x26]); // 红砖
    ppu.setPal(2, [0x0f, 0x27, 0x17, 0x37]); // 橙砖
    ppu.setPal(3, [0x0f, 0x2a, 0x1a, 0x3a]); // 绿砖
    ppu.setPal(4, [0x0f, 0x21, 0x11, 0x30]); // 精灵：挡板
    ppu.fill(0, 3, 32, 1, T.WALL);
    ppu.fill(0, 4, 2, 26, T.WALL);
    ppu.fill(30, 4, 2, 26, T.WALL);
    this.state = 'title';
    this.score = 0; this.lives = 3; this.level = 1;
    this.px = 112;
    this.bricks(ppu);
    this.hud(ppu);
    ppu.text(10, 20, 'PRESS START');
    this.resetBall();
  },
  bricks(ppu) {
    this.left = 0;
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 14; c++) {
        ppu.setTile(2 + c * 2, 6 + r, T.BRICK_L);
        ppu.setTile(3 + c * 2, 6 + r, T.BRICK_R);
        ppu.setAttr(1 + c, 3 + (r >> 1), 1 + (r >> 1)); // 每两行砖共用一组调色板
        this.left++;
      }
    }
  },
  hud(ppu) {
    ppu.text(2, 1, 'SCORE ' + String(this.score).padStart(4, '0'));
    ppu.text(22, 1, 'LIVES ' + this.lives);
  },
  resetBall() { this.stuck = true; this.vx = 0; this.vy = 0; },

  update({ ppu, pad, apu }) {
    if (this.state !== 'play') {
      if (pad.hit('START') || pad.hit('A')) {
        if (this.state === 'over') { this.init({ ppu }); }
        ppu.fill(2, 20, 28, 1, 0);
        this.state = 'play';
        apu.pulse({ freq: 660, dur: 0.08 });
      }
      this.draw(ppu);
      return;
    }
    if (pad.held('LEFT')) this.px -= 3;
    if (pad.held('RIGHT')) this.px += 3;
    this.px = Math.max(LEFT, Math.min(RIGHT - 32, this.px));

    if (this.stuck) {
      this.bx = this.px + 12; this.by = PADDLE_Y - 8;
      if (pad.hit('A') || pad.hit('START')) {
        const sp = 1.8 + this.level * 0.25;
        this.stuck = false; this.vx = sp * 0.6; this.vy = -sp;
      }
    } else {
      // 先横向移动再纵向移动，各自检查是否撞到实心图块
      this.bx += this.vx;
      if (this.hitTile(ppu, apu)) { this.bx -= this.vx; this.vx = -this.vx; }
      this.by += this.vy;
      if (this.hitTile(ppu, apu)) { this.by -= this.vy; this.vy = -this.vy; }
      const cx = this.bx + 4;
      if (this.vy > 0 && this.by + 8 >= PADDLE_Y && this.by < PADDLE_Y + 6 && cx >= this.px - 2 && cx <= this.px + 34) {
        const sp = Math.hypot(this.vx, this.vy);
        const k = Math.max(-0.85, Math.min(0.85, (cx - (this.px + 16)) / 18));
        this.vx = sp * k; this.vy = -sp * Math.sqrt(1 - k * k);
        apu.pulse({ freq: 330, dur: 0.05, duty: 0.25 });
      }
      if (this.by > 240) {
        this.lives--;
        this.hud(ppu);
        apu.pulse({ freq: 200, to: 60, dur: 0.3 });
        if (this.lives <= 0) { this.state = 'over'; ppu.text(11, 20, 'GAME OVER'); }
        this.resetBall();
      }
      if (this.left === 0) { this.level++; this.bricks(ppu); this.resetBall(); apu.pulse({ freq: 523, to: 1046, dur: 0.3, duty: 0.25 }); }
    }
    this.draw(ppu);
  },

  hitTile(ppu, apu) {
    const tx = Math.floor((this.bx + 4) / 8), ty = Math.floor((this.by + 4) / 8);
    const t = ppu.getTile(tx, ty);
    if (t === T.WALL) { apu.pulse({ freq: 220, dur: 0.04 }); return true; }
    if (t === T.BRICK_L || t === T.BRICK_R) {
      const bx = t === T.BRICK_L ? tx : tx - 1;
      ppu.setTile(bx, ty, 0); ppu.setTile(bx + 1, ty, 0);
      this.left--; this.score += 10;
      this.hud(ppu);
      apu.pulse({ freq: 500 + (11 - ty) * 60, dur: 0.06, duty: 0.125 });
      return true;
    }
    return false;
  },

  draw(ppu) {
    const tiles = [T.PAD_L, T.PAD_M, T.PAD_M, T.PAD_R];
    for (let i = 0; i < 4; i++) ppu.sprite(i, this.px + i * 8, PADDLE_Y, tiles[i], 0);
    if (this.stuck) { this.bx = this.px + 12; this.by = PADDLE_Y - 8; }
    ppu.sprite(4, Math.round(this.bx), Math.round(this.by), T.BALL, 0);
  },
};
