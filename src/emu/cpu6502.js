// 6502 CPU：完整的官方指令集解释器 + 一个小汇编器
// 红白机用的是理光 2A03（国产兼容机多为联电 UA6527），内核就是 6502

const OPS = new Array(256).fill(null);
const def = (code, name, mode, cyc) => { OPS[code] = { name, mode, cyc }; };

['ORA', 'AND', 'EOR', 'ADC', 'STA', 'LDA', 'CMP', 'SBC'].forEach((n, i) => {
  [['izx', 0x01, 6], ['zp', 0x05, 3], ['imm', 0x09, 2], ['abs', 0x0d, 4], ['izy', 0x11, 5], ['zpx', 0x15, 4], ['aby', 0x19, 4], ['abx', 0x1d, 4]]
    .forEach(([m, o, c]) => { if (!(n === 'STA' && m === 'imm')) def(i * 0x20 + o, n, m, c); });
});
['ASL', 'ROL', 'LSR', 'ROR'].forEach((n, i) => {
  [['zp', 0x06, 5], ['acc', 0x0a, 2], ['abs', 0x0e, 6], ['zpx', 0x16, 6], ['abx', 0x1e, 7]].forEach(([m, o, c]) => def(i * 0x20 + o, n, m, c));
});
['DEC', 'INC'].forEach((n, i) => {
  [['zp', 0xc6, 5], ['abs', 0xce, 6], ['zpx', 0xd6, 6], ['abx', 0xde, 7]].forEach(([m, o, c]) => def(o + i * 0x20, n, m, c));
});
('00 BRK imp 7,10 BPL rel 2,30 BMI rel 2,50 BVC rel 2,70 BVS rel 2,90 BCC rel 2,B0 BCS rel 2,D0 BNE rel 2,F0 BEQ rel 2,' +
  '24 BIT zp 3,2C BIT abs 4,18 CLC imp 2,D8 CLD imp 2,58 CLI imp 2,B8 CLV imp 2,38 SEC imp 2,F8 SED imp 2,78 SEI imp 2,' +
  'E0 CPX imm 2,E4 CPX zp 3,EC CPX abs 4,C0 CPY imm 2,C4 CPY zp 3,CC CPY abs 4,CA DEX imp 2,88 DEY imp 2,E8 INX imp 2,C8 INY imp 2,' +
  '4C JMP abs 3,6C JMP ind 5,20 JSR abs 6,A2 LDX imm 2,A6 LDX zp 3,B6 LDX zpy 4,AE LDX abs 4,BE LDX aby 4,' +
  'A0 LDY imm 2,A4 LDY zp 3,B4 LDY zpx 4,AC LDY abs 4,BC LDY abx 4,EA NOP imp 2,48 PHA imp 3,08 PHP imp 3,68 PLA imp 4,28 PLP imp 4,' +
  '40 RTI imp 6,60 RTS imp 6,86 STX zp 3,96 STX zpy 4,8E STX abs 4,84 STY zp 3,94 STY zpx 4,8C STY abs 4,' +
  'AA TAX imp 2,A8 TAY imp 2,BA TSX imp 2,8A TXA imp 2,9A TXS imp 2,98 TYA imp 2')
  .split(',').forEach((s) => { const [c, n, m, y] = s.split(' '); def(parseInt(c, 16), n, m, +y); });

const C = 1, Z = 2, I = 4, D = 8, B = 16, U = 32, V = 64, N = 128;

export class CPU {
  constructor(bus) { this.bus = bus; this.reset(); }

  reset() {
    this.a = 0; this.x = 0; this.y = 0; this.sp = 0xfd; this.p = I | U;
    this.cycles = 0; this.halted = false;
    // 复位：从卡带最末尾的"复位向量"读出程序入口
    this.pc = this.bus.read(0xfffc) | (this.bus.read(0xfffd) << 8);
  }
  nmi() {
    this.push16(this.pc);
    this.push((this.p & ~B) | U);
    this.p |= I;
    this.pc = this.bus.read(0xfffa) | (this.bus.read(0xfffb) << 8);
    this.cycles += 7;
  }

  fetch() { const v = this.bus.read(this.pc, true); this.pc = (this.pc + 1) & 0xffff; return v; }
  fetch16() { const lo = this.fetch(); return lo | (this.fetch() << 8); }
  push(v) { this.bus.write(0x100 | this.sp, v); this.sp = (this.sp - 1) & 255; }
  pop() { this.sp = (this.sp + 1) & 255; return this.bus.read(0x100 | this.sp); }
  push16(v) { this.push(v >> 8); this.push(v & 255); }
  pop16() { const lo = this.pop(); return lo | (this.pop() << 8); }
  zn(v) { this.p = (this.p & ~(Z | N)) | (v === 0 ? Z : 0) | (v & N); return v; }
  flag(f, on) { this.p = on ? this.p | f : this.p & ~f; }

  step() {
    if (this.halted) return;
    const bus = this.bus;
    const op = this.fetch();
    const e = OPS[op];
    if (!e) { this.halted = true; return; }
    let addr = -1;
    switch (e.mode) {
      case 'imm': addr = this.pc; this.pc = (this.pc + 1) & 0xffff; break;
      case 'zp': addr = this.fetch(); break;
      case 'zpx': addr = (this.fetch() + this.x) & 255; break;
      case 'zpy': addr = (this.fetch() + this.y) & 255; break;
      case 'abs': addr = this.fetch16(); break;
      case 'abx': addr = (this.fetch16() + this.x) & 0xffff; break;
      case 'aby': addr = (this.fetch16() + this.y) & 0xffff; break;
      case 'ind': { const p = this.fetch16(); addr = bus.read(p) | (bus.read((p & 0xff00) | ((p + 1) & 255)) << 8); break; }
      case 'izx': { const z = (this.fetch() + this.x) & 255; addr = bus.read(z) | (bus.read((z + 1) & 255) << 8); break; }
      case 'izy': { const z = this.fetch(); addr = ((bus.read(z) | (bus.read((z + 1) & 255) << 8)) + this.y) & 0xffff; break; }
      case 'rel': { let o = this.fetch(); if (o > 127) o -= 256; addr = (this.pc + o) & 0xffff; break; }
    }
    const rd = () => (e.mode === 'acc' ? this.a : e.mode === 'imm' ? bus.read(addr, true) : bus.read(addr));
    const wr = (v) => { if (e.mode === 'acc') this.a = v; else bus.write(addr, v); };
    const br = (c) => { if (c) { this.pc = addr; this.cycles++; } };
    const cmp = (r) => { const v = rd(); this.flag(C, r >= v); this.zn((r - v) & 255); };
    const adc = (v) => {
      const s = this.a + v + (this.p & C);
      this.flag(V, ~(this.a ^ v) & (this.a ^ s) & 0x80);
      this.flag(C, s > 255);
      this.a = this.zn(s & 255);
    };
    switch (e.name) {
      case 'LDA': this.a = this.zn(rd()); break;
      case 'LDX': this.x = this.zn(rd()); break;
      case 'LDY': this.y = this.zn(rd()); break;
      case 'STA': wr(this.a); break;
      case 'STX': wr(this.x); break;
      case 'STY': wr(this.y); break;
      case 'TAX': this.x = this.zn(this.a); break;
      case 'TAY': this.y = this.zn(this.a); break;
      case 'TXA': this.a = this.zn(this.x); break;
      case 'TYA': this.a = this.zn(this.y); break;
      case 'TSX': this.x = this.zn(this.sp); break;
      case 'TXS': this.sp = this.x; break;
      case 'INX': this.x = this.zn((this.x + 1) & 255); break;
      case 'INY': this.y = this.zn((this.y + 1) & 255); break;
      case 'DEX': this.x = this.zn((this.x - 1) & 255); break;
      case 'DEY': this.y = this.zn((this.y - 1) & 255); break;
      case 'INC': wr(this.zn((rd() + 1) & 255)); break;
      case 'DEC': wr(this.zn((rd() - 1) & 255)); break;
      case 'AND': this.a = this.zn(this.a & rd()); break;
      case 'ORA': this.a = this.zn(this.a | rd()); break;
      case 'EOR': this.a = this.zn(this.a ^ rd()); break;
      case 'ADC': adc(rd()); break;
      case 'SBC': adc(rd() ^ 255); break;
      case 'CMP': cmp(this.a); break;
      case 'CPX': cmp(this.x); break;
      case 'CPY': cmp(this.y); break;
      case 'BIT': { const v = rd(); this.flag(Z, !(this.a & v)); this.flag(N, v & N); this.flag(V, v & V); break; }
      case 'ASL': { const v = rd(); this.flag(C, v & 0x80); wr(this.zn((v << 1) & 255)); break; }
      case 'LSR': { const v = rd(); this.flag(C, v & 1); wr(this.zn(v >> 1)); break; }
      case 'ROL': { const v = rd(), c = this.p & C; this.flag(C, v & 0x80); wr(this.zn(((v << 1) | c) & 255)); break; }
      case 'ROR': { const v = rd(), c = this.p & C; this.flag(C, v & 1); wr(this.zn((v >> 1) | (c << 7))); break; }
      case 'BPL': br(!(this.p & N)); break;
      case 'BMI': br(this.p & N); break;
      case 'BVC': br(!(this.p & V)); break;
      case 'BVS': br(this.p & V); break;
      case 'BCC': br(!(this.p & C)); break;
      case 'BCS': br(this.p & C); break;
      case 'BNE': br(!(this.p & Z)); break;
      case 'BEQ': br(this.p & Z); break;
      case 'JMP': this.pc = addr; break;
      case 'JSR': this.push16((this.pc - 1) & 0xffff); this.pc = addr; break;
      case 'RTS': this.pc = (this.pop16() + 1) & 0xffff; break;
      case 'RTI': this.p = (this.pop() & ~B) | U; this.pc = this.pop16(); break;
      case 'PHA': this.push(this.a); break;
      case 'PHP': this.push(this.p | B | U); break;
      case 'PLA': this.a = this.zn(this.pop()); break;
      case 'PLP': this.p = (this.pop() & ~B) | U; break;
      case 'CLC': this.flag(C, 0); break;
      case 'SEC': this.flag(C, 1); break;
      case 'CLI': this.flag(I, 0); break;
      case 'SEI': this.flag(I, 1); break;
      case 'CLD': this.flag(D, 0); break;
      case 'SED': this.flag(D, 1); break;
      case 'CLV': this.flag(V, 0); break;
      case 'NOP': break;
      case 'BRK': this.halted = true; break;
    }
    this.cycles += e.cyc;
  }
}

// ---------------- 汇编器：把人能读的助记符翻译成机器码 ----------------
const ENC = {};
OPS.forEach((e, code) => { if (e) (ENC[e.name] ||= {})[e.mode] = code; });
const SIZE = { imp: 1, acc: 1, imm: 2, zp: 2, zpx: 2, zpy: 2, izx: 2, izy: 2, rel: 2, abs: 3, abx: 3, aby: 3, ind: 3 };

function evalExpr(s, sym) {
  s = s.trim();
  let sel = null;
  if (s[0] === '<' || s[0] === '>') { sel = s[0]; s = s.slice(1); }
  let v = 0, sign = 1;
  for (const raw of s.split(/([+-])/)) {
    const t = raw.trim();
    if (!t) continue;
    if (t === '+') { sign = 1; continue; }
    if (t === '-') { sign = -1; continue; }
    let n;
    if (t[0] === '$') n = parseInt(t.slice(1), 16);
    else if (t[0] === '%') n = parseInt(t.slice(1), 2);
    else if (/^\d+$/.test(t)) n = +t;
    else if (t in sym) n = sym[t];
    else throw new Error('未定义的符号：' + t);
    v += sign * n;
  }
  if (sel === '<') v &= 255;
  if (sel === '>') v = (v >> 8) & 255;
  return v;
}

function splitArgs(s) {
  const out = [];
  let cur = '', q = false;
  for (const ch of s) {
    if (ch === '"') q = !q;
    if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function operand(name, o, sym) {
  const has = (m) => ENC[name] && ENC[name][m] !== undefined;
  if (!o) return { mode: has('acc') ? 'acc' : 'imp' };
  if (/^A$/i.test(o)) return { mode: 'acc' };
  if (o[0] === '#') return { mode: 'imm', expr: o.slice(1) };
  let m;
  if ((m = o.match(/^\((.+),\s*X\)$/i))) return { mode: 'izx', expr: m[1] };
  if ((m = o.match(/^\((.+)\),\s*Y$/i))) return { mode: 'izy', expr: m[1] };
  if ((m = o.match(/^\((.+)\)$/))) return { mode: 'ind', expr: m[1] };
  let idx = '';
  if ((m = o.match(/^(.+),\s*([XY])$/i))) { o = m[1]; idx = m[2].toLowerCase(); }
  if (has('rel')) return { mode: 'rel', expr: o };
  let v;
  try { v = evalExpr(o, sym); } catch { v = undefined; }
  const zp = 'zp' + idx, ab = idx ? 'ab' + idx : 'abs';
  if (v !== undefined && v < 256 && has(zp)) return { mode: zp, expr: o };
  return { mode: ab, expr: o };
}

export function assemble(src, predef = {}) {
  const lines = src.split('\n');
  const sym = { ...predef };
  const items = [];
  let pc = 0;
  lines.forEach((line, i) => {
    let text = line.replace(/;.*$/, '').trim();
    if (!text) return;
    let m;
    if ((m = text.match(/^(\w+)\s*=\s*(.+)$/))) { sym[m[1]] = evalExpr(m[2], sym); return; }
    if ((m = text.match(/^(\w+):\s*(.*)$/))) { sym[m[1]] = pc; text = m[2]; if (!text) return; }
    if ((m = text.match(/^\.org\s+(.+)$/))) { pc = evalExpr(m[1], sym); return; }
    if ((m = text.match(/^\.(byte|word)\s+(.+)$/))) {
      const parts = [];
      for (const a of splitArgs(m[2])) {
        if (a[0] === '"') for (const ch of a.slice(1, -1)) parts.push(ch.charCodeAt(0));
        else parts.push(a);
      }
      const w = m[1] === 'word' ? 2 : 1;
      items.push({ kind: 'data', pc, line: i, parts, w });
      pc += parts.length * w;
      return;
    }
    m = text.match(/^([A-Za-z]{3})\s*(.*)$/);
    const name = m && m[1].toUpperCase();
    if (!m || !ENC[name]) throw new Error(`第 ${i + 1} 行看不懂：${text}`);
    const op = operand(name, m[2].trim(), sym);
    if (ENC[name][op.mode] === undefined) throw new Error(`第 ${i + 1} 行：${name} 不支持这种写法`);
    items.push({ kind: 'op', pc, line: i, name, ...op });
    pc += SIZE[op.mode];
  });

  const mem = new Uint8Array(0x10000);
  const listing = [];
  for (const it of items) {
    const bytes = [];
    if (it.kind === 'data') {
      for (const p of it.parts) {
        const v = typeof p === 'number' ? p : evalExpr(p, sym);
        bytes.push(v & 255);
        if (it.w === 2) bytes.push((v >> 8) & 255);
      }
    } else {
      bytes.push(ENC[it.name][it.mode]);
      if (it.expr !== undefined) {
        const v = evalExpr(it.expr, sym);
        if (it.mode === 'rel') {
          const off = v - (it.pc + 2);
          if (off < -128 || off > 127) throw new Error(`第 ${it.line + 1} 行：跳转太远`);
          bytes.push(off & 255);
        } else {
          bytes.push(v & 255);
          if (SIZE[it.mode] === 3) bytes.push((v >> 8) & 255);
        }
      }
    }
    bytes.forEach((b, k) => { mem[it.pc + k] = b; });
    listing.push({ addr: it.pc, bytes, line: it.line, kind: it.kind });
  }
  return { mem, listing, sym, lines };
}
