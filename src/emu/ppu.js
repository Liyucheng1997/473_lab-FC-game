// 简化的 PPU（图像处理器）：图案表 + 名称表 + 属性表 + 调色板 + 64 个精灵，逐扫描线合成
import { NES_HEX } from './palette.js';

export const W = 256;
export const H = 240;

const ABGR = new Uint32Array(64);
NES_HEX.forEach((h, i) => {
  ABGR[i] = (0xff000000 | ((h & 255) << 16) | (((h >> 8) & 255) << 8) | ((h >> 16) & 255)) >>> 0;
});

export class PPU {
  constructor() {
    this.chr = new Uint8Array(256 * 64); // 图案表：256 个 8×8 图块，每像素 0-3
    this.nt = new Uint8Array(32 * 30); // 名称表：每格放哪个图块
    this.at = new Uint8Array(16 * 15); // 属性表：每 16×16 像素区域用哪组调色板
    this.pal = new Uint8Array(32); // 0-15 背景 4 组，16-31 精灵 4 组
    this.oam = new Uint8Array(256); // 64 个精灵 × (y, 图块, 属性, x)
    this.fb = new Uint32Array(W * H);
    this.bgL = new Uint32Array(W * H);
    this.sprL = new Uint32Array(W * H);
    this._ls = new Uint8Array(W);
    this._lb = new Uint8Array(W);
    this.showBg = true; // 用户开关
    this.showSpr = true;
    this.spriteLimit = true;
    this.stats = { sprites: 0, maxLine: 0, dropped: 0 };
    this.reset();
  }

  reset() {
    this.nt.fill(0);
    this.at.fill(0);
    this.pal.fill(0x0f);
    this.oam.fill(0xff);
    this.scrollX = 0;
    this.splitY = 0; // 这一行以上不滚动（状态栏）
    this.maskBg = true; // 程序通过 $2001 控制
    this.maskSpr = true;
  }

  // ---- 给游戏用的便捷写入 ----
  setTile(x, y, t) { if (x >= 0 && x < 32 && y >= 0 && y < 30) this.nt[y * 32 + x] = t; }
  getTile(x, y) { return x >= 0 && x < 32 && y >= 0 && y < 30 ? this.nt[y * 32 + x] : 0; }
  text(x, y, s) { for (let i = 0; i < s.length; i++) this.setTile(x + i, y, s.charCodeAt(i)); }
  fill(x, y, w, h, t) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.setTile(x + i, y + j, t); }
  // 以 16×16 像素块为单位设置调色板组
  setAttr(bx, by, p) { if (bx >= 0 && bx < 16 && by >= 0 && by < 15) this.at[by * 16 + bx] = p & 3; }
  setPal(group, colors) { for (let i = 0; i < 4; i++) this.pal[group * 4 + i] = colors[i]; }
  sprite(i, x, y, tile, attr = 0) {
    const o = i * 4;
    this.oam[o] = y; this.oam[o + 1] = tile; this.oam[o + 2] = attr; this.oam[o + 3] = x;
  }
  hideSprite(i) { this.oam[i * 4] = 0xff; }
  clearSprites() { this.oam.fill(0xff); }

  // 把图案表编码成真实卡带 CHR-ROM 的格式：每个图块 16 字节（两个位平面）
  chrBytes() {
    const out = new Uint8Array(8192);
    for (let t = 0; t < 256; t++) {
      for (let y = 0; y < 8; y++) {
        let p0 = 0, p1 = 0;
        for (let x = 0; x < 8; x++) {
          const v = this.chr[t * 64 + y * 8 + x];
          p0 |= (v & 1) << (7 - x);
          p1 |= (v >> 1) << (7 - x);
        }
        out[t * 16 + y] = p0;
        out[t * 16 + 8 + y] = p1;
      }
    }
    return out;
  }

  renderFrame() {
    const { chr, nt, at, pal, oam, fb, bgL, sprL, _ls: ls, _lb: lb } = this;
    const bgOn = this.showBg && this.maskBg;
    const sprOn = this.showSpr && this.maskSpr;
    const backdrop = ABGR[pal[0] & 63];
    let total = 0, maxLine = 0, dropped = 0;
    for (let i = 0; i < 64; i++) if (oam[i * 4] < 240) total++;

    for (let y = 0; y < H; y++) {
      // 1) 找出这一行上的精灵（硬件每行最多处理 8 个）
      ls.fill(0);
      const picked = [];
      let onLine = 0;
      for (let i = 0; i < 64; i++) {
        const sy = oam[i * 4];
        if (y >= sy && y < sy + 8) {
          onLine++;
          if (picked.length < 8 || !this.spriteLimit) picked.push(i);
          else dropped++;
        }
      }
      if (onLine > maxLine) maxLine = onLine;
      for (let k = picked.length - 1; k >= 0; k--) {
        const o = picked[k] * 4;
        const attr = oam[o + 2];
        const sx = oam[o + 3];
        const row = attr & 0x80 ? 7 - (y - oam[o]) : y - oam[o];
        const base = oam[o + 1] * 64 + row * 8;
        const pbase = 16 + (attr & 3) * 4;
        for (let dx = 0; dx < 8; dx++) {
          const x = sx + dx;
          if (x >= W) break;
          const p = chr[base + (attr & 0x40 ? 7 - dx : dx)];
          if (p) { ls[x] = pbase + p; lb[x] = attr & 0x20; }
        }
      }
      // 2) 逐像素：背景 + 精灵合成
      const sc = y < this.splitY ? 0 : this.scrollX;
      const ty = y >> 3;
      const rowOff = (y & 7) * 8;
      let o = y * W;
      for (let x = 0; x < W; x++, o++) {
        const wx = (x + sc) & 255;
        const tx = wx >> 3;
        const bp = chr[nt[ty * 32 + tx] * 64 + rowOff + (wx & 7)];
        const bgc = bp ? ABGR[pal[at[(ty >> 1) * 16 + (tx >> 1)] * 4 + bp] & 63] : backdrop;
        const s = ls[x];
        const sc32 = s ? ABGR[pal[s] & 63] : 0;
        bgL[o] = bgc;
        sprL[o] = sc32;
        let c = bgOn ? bgc : backdrop;
        if (s && sprOn && !(lb[x] && bp && bgOn)) c = sc32;
        fb[o] = c;
      }
    }
    this.stats.sprites = total;
    this.stats.maxLine = maxLine;
    this.stats.dropped = dropped;
  }
}
