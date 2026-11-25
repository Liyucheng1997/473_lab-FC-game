// 整机：把 CPU、内存、PPU 寄存器、手柄接到同一条"总线"上
import { CPU } from './cpu6502.js';

export const CYCLES_PER_FRAME = 29780; // NTSC：CPU 每帧大约能跑这么多个周期

export const REGIONS = [
  { id: 'ram', from: 0x0000, to: 0x1fff, name: '内存 RAM', note: '2KB 工作内存：变量、栈' },
  { id: 'ppu', from: 0x2000, to: 0x3fff, name: 'PPU 寄存器', note: '往这里写 = 指挥画面芯片' },
  { id: 'apu', from: 0x4000, to: 0x4015, name: 'APU 寄存器', note: '往这里写 = 发声' },
  { id: 'pad', from: 0x4016, to: 0x4017, name: '手柄端口', note: '读这里 = 读按键' },
  { id: 'cart', from: 0x8000, to: 0xffff, name: '卡带 PRG-ROM', note: '游戏程序本体，只读' },
];
export const regionOf = (a) => (a < 0x2000 ? 'ram' : a < 0x4000 ? 'ppu' : a === 0x4016 || a === 0x4017 ? 'pad' : a < 0x4020 ? 'apu' : a >= 0x8000 ? 'cart' : 'none');

export class Machine {
  constructor(ppu, pad) {
    this.ppu = ppu;
    this.pad = pad;
    this.ram = new Uint8Array(0x800);
    this.prg = new Uint8Array(0x10000);
    this.trace = [];
    this.cpu = new CPU(this);
  }
  load(mem) { this.prg = mem; }

  reset() {
    this.ram.fill(0);
    this.ppu.reset();
    this.ppu.maskBg = false;
    this.ppu.maskSpr = false;
    this.ctrl = 0; this.latch = 0; this.vaddr = 0; this.oamAddr = 0;
    this.vblank = true; // 简化：上电即认为 PPU 已就绪
    this.frames = 0;
    this.trace = [];
    this.cpu.reset();
    this.frameStart = 0;
    this.trace = [];
  }

  read(a, isFetch = false) {
    let v = 0;
    if (a < 0x2000) v = this.ram[a & 0x7ff];
    else if (a < 0x4000) {
      if ((a & 7) === 2) { v = this.vblank ? 0x80 : 0; this.vblank = false; this.latch = 0; }
    } else if (a === 0x4016) v = this.pad.read() | 0x40;
    else if (a >= 0x8000) v = this.prg[a];
    this.trace.push({ a, v, w: false, f: isFetch });
    return v;
  }

  write(a, v) {
    this.trace.push({ a, v, w: true, f: false });
    if (a < 0x2000) { this.ram[a & 0x7ff] = v; return; }
    if (a < 0x4000) {
      switch (a & 7) {
        case 0: this.ctrl = v; break;
        case 1: this.ppu.maskBg = !!(v & 0x08); this.ppu.maskSpr = !!(v & 0x10); break;
        case 3: this.oamAddr = v; break;
        case 4: this.ppu.oam[this.oamAddr] = v; this.oamAddr = (this.oamAddr + 1) & 255; break;
        case 5: if (!this.latch) this.ppu.scrollX = v; this.latch ^= 1; break;
        case 6:
          if (!this.latch) this.vaddr = (this.vaddr & 0x00ff) | ((v & 0x3f) << 8);
          else this.vaddr = (this.vaddr & 0xff00) | v;
          this.latch ^= 1;
          break;
        case 7: this.ppuWrite(this.vaddr, v); this.vaddr = (this.vaddr + (this.ctrl & 4 ? 32 : 1)) & 0x3fff; break;
      }
      return;
    }
    if (a === 0x4014) { // OAM DMA：把内存里一整页（256 字节）精灵数据一次拷给 PPU
      const base = (v << 8) & 0x7ff;
      for (let i = 0; i < 256; i++) this.ppu.oam[i] = this.ram[(base + i) & 0x7ff];
      return;
    }
    if (a === 0x4016) this.pad.write(v);
  }

  // PPU 自己的地址空间：$2000 起是名称表，$23C0 起是属性表，$3F00 起是调色板
  ppuWrite(a, v) {
    const { ppu } = this;
    if (a >= 0x3f00) {
      let i = a & 31;
      if (i >= 16 && (i & 3) === 0) i -= 16;
      ppu.pal[i] = v & 63;
    } else if (a >= 0x2000 && a < 0x2400) {
      const o = a - 0x2000;
      if (o < 960) ppu.nt[o] = v;
      else {
        const i = o - 960, bx = (i & 7) * 2, by = (i >> 3) * 2;
        ppu.setAttr(bx, by, v);
        ppu.setAttr(bx + 1, by, v >> 2);
        ppu.setAttr(bx, by + 1, v >> 4);
        ppu.setAttr(bx + 1, by + 1, v >> 6);
      }
    }
  }

  // CPU 是否停在"自己跳自己"的空转循环上（JMP 到当前地址）
  idle() {
    const pc = this.cpu.pc;
    return this.prg[pc] === 0x4c && (this.prg[pc + 1] | (this.prg[pc + 2] << 8)) === pc;
  }

  enterVblank() {
    this.frameStart = this.cpu.cycles;
    this.frames++;
    this.vblank = true;
    if (this.ctrl & 0x80) { this.cpu.nmi(); return true; }
    return false;
  }
  skipToVblank() { this.trace = []; this.cpu.cycles = this.frameStart + CYCLES_PER_FRAME; return this.enterVblank(); }

  // 执行一条指令；返回 true 表示这条指令之后进入了新的一帧
  step() {
    this.trace = [];
    this.cpu.step();
    if (this.cpu.cycles - this.frameStart >= CYCLES_PER_FRAME) { this.enterVblank(); return true; }
    return false;
  }
  runFrame() {
    for (let i = 0; i < 20000; i++) {
      if (this.idle()) { this.skipToVblank(); return; }
      if (this.step()) return;
    }
  }
}
