// 手柄：8 个按键 + 一个移位寄存器（真机里是 4021 芯片）
export const BTN = ['A', 'B', 'SELECT', 'START', 'UP', 'DOWN', 'LEFT', 'RIGHT'];
export const BTN_CN = ['A', 'B', '选择', '开始', '上', '下', '左', '右'];

export class Pad {
  constructor() {
    this.kb = new Uint8Array(8); // 键盘
    this.ui = new Uint8Array(8); // 鼠标点 3D 手柄
    this.prev = new Uint8Array(8);
    this.latched = new Uint8Array(8);
    this.strobe = 0;
    this.idx = 8;
  }
  set(name, v, src = 'kb') { const i = BTN.indexOf(name); if (i >= 0) this[src][i] = v ? 1 : 0; }
  bit(i) { return this.kb[i] | this.ui[i]; }
  held(name) { return this.bit(BTN.indexOf(name)) === 1; }
  hit(name) { const i = BTN.indexOf(name); return this.bit(i) === 1 && !this.prev[i]; }
  tick() { for (let i = 0; i < 8; i++) this.prev[i] = this.bit(i); }

  // ---- CPU 通过 $4016 访问 ----
  write(v) {
    this.strobe = v & 1;
    if (this.strobe) this.latch();
  }
  latch() { for (let i = 0; i < 8; i++) this.latched[i] = this.bit(i); this.idx = 0; }
  read() {
    if (this.strobe) return this.bit(0);
    const b = this.idx < 8 ? this.latched[this.idx] : 1;
    this.idx++;
    return b;
  }
}
