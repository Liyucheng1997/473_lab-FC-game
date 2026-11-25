// 无界面自检：汇编演示程序并在 CPU 仿真器上运行，再把三个游戏各跑几百帧
import { PPU } from '../src/emu/ppu.js';
import { Pad } from '../src/emu/pad.js';
import { APU } from '../src/emu/apu.js';
import { Machine } from '../src/emu/machine.js';
import { buildTiles, T } from '../src/emu/tiles.js';
import { buildDemoRom } from '../src/emu/demo-rom.js';
import snake from '../src/games/snake.js';
import breakout from '../src/games/breakout.js';
import shooter from '../src/games/shooter.js';

const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok  :', m); };
const ppu = new PPU(); buildTiles(ppu);
const pad = new Pad(); const apu = new APU();
const rom = buildDemoRom(ppu);
const m = new Machine(ppu, pad);
m.load(rom.mem); m.reset();
assert(m.cpu.pc === 0x8000, '复位向量指向 $8000');
for (let i = 0; i < 5; i++) m.runFrame();
const text = [...ppu.nt.slice(14 * 32 + 10, 14 * 32 + 21)].map((c) => String.fromCharCode(c)).join('');
assert(text === 'HELLO 6502!', '名称表里写入了文字：' + text);
assert(ppu.pal[0] === 0x02 && ppu.pal[17] === 0x28, '调色板已写入');
assert(ppu.oam[0] === 0x58 && ppu.oam[3] === 0x78 && ppu.oam[1] === T.SMILE, '精灵 0 = 笑脸');
assert(ppu.oam[4] === 0xff, '其余精灵已隐藏');
pad.set('RIGHT', 1); pad.set('A', 1);
for (let i = 0; i < 10; i++) m.runFrame();
assert(ppu.oam[3] === 0x78 + 10, '按右 10 帧后 X 增加 10：' + ppu.oam[3]);
assert(ppu.oam[2] === 1, '按住 A 后改用调色板 1');
assert(m.ram[0] === 0x81, 'BUTTONS = $81');
pad.set('RIGHT', 0); pad.set('A', 0);
ppu.renderFrame();
assert(ppu.stats.sprites === 1, '画面上 1 个精灵');

const sys = { ppu, pad, apu };
for (const g of [snake, breakout, shooter]) {
  g.init(sys);
  for (let f = 0; f < 900; f++) {
    pad.set('START', f === 5); pad.set('A', f % 20 < 10);
    pad.set('UP', f % 240 < 60); pad.set('DOWN', f % 240 >= 120 && f % 240 < 180);
    g.update(sys); pad.tick(); ppu.renderFrame();
  }
  assert(g.state !== 'title', `${g.name} 运行 900 帧无异常，状态 ${g.state}，得分 ${g.score}，单行最多精灵 ${ppu.stats.maxLine}`);
}
console.log('PRG 前 16 字节:', [...rom.prg.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join(' '));
