// 各章节右侧面板里的交互组件。每个函数返回 { update?, dispose? }
import { NES_HEX, cssColor } from './emu/palette.js';
import { BTN, BTN_CN } from './emu/pad.js';
import { REGIONS, regionOf } from './emu/machine.js';
import { BOOT_STEPS } from './content.js';

const hex = (v, n = 2) => v.toString(16).toUpperCase().padStart(n, '0');
const bin = (v) => v.toString(2).padStart(8, '0');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const BLUE = 0x0a84ff, ORANGE = 0xff9f0a;

// ---------------- 卡带 ----------------
function cart(root, app) {
  const { rom } = app.sys;
  root.innerHTML = `
    <div class="rombar">
      <button data-s="header" style="flex:0 0 74px"><b>文件头</b><small>16 字节</small></button>
      <button data-s="prg" style="flex:3"><b>PRG-ROM 程序</b><small>32 KB</small></button>
      <button data-s="chr" style="flex:1.3"><b>CHR 图形</b><small>8 KB</small></button>
    </div>
    <pre class="hex" data-hex></pre>
    <p class="cap" data-cap></p>
    <h3>多合一卡带的秘密：切换 Bank</h3>
    <p>CPU 的地址线只有 16 根，留给卡带的窗口只有 32KB。"4 合 1"卡带的 ROM 比这大得多，Mapper 芯片像一个转换开关，决定此刻把哪一段 ROM 接到窗口上。点一下试试，看电视：</p>
    <div class="bank">
      <div class="bank-win"><small>CPU 看到的窗口</small><b>$8000–$FFFF</b><span data-cur></span></div>
      <div class="bank-list" data-banks></div>
    </div>
    <p class="muted">开机菜单本身也是一个小程序：你选了第几个游戏，它就往 Mapper 写一个数字，然后跳过去执行。</p>`;
  const segs = {
    header: { bytes: rom.header, base: 0, cap: '<b>4E 45 53 1A</b> 是 "NES" 三个字母加一个结束符；<b>02</b> 表示有 2×16KB 的程序，<b>01</b> 表示有 1×8KB 的图形。这 16 字节是模拟器时代加上的"说明书"，真卡带里没有。' },
    prg: { bytes: rom.prg, base: 0x8000, cap: '开头的 <b>78 D8 A2 FF 9A</b> 就是 SEI、CLD、LDX #$FF、TXS 四条指令——下一章你会看到 CPU 逐条执行它们。程序就是这样一串数字。' },
    chr: { bytes: rom.chr.slice(0x410, 0x450), base: 0x410, cap: '每个图块占 16 字节。这里从字母 <b>A</b> 的图块开始：把前 8 个字节写成二进制，1 的位置连起来就是 A 的形状。' },
  };
  const show = (k) => {
    const s = segs[k];
    let out = '';
    for (let r = 0; r < 8; r++) {
      const row = [...s.bytes.slice(r * 8, r * 8 + 8)];
      if (!row.length) break;
      out += hex(s.base + r * 8, 4) + '  ' + row.map((b) => hex(b)).join(' ') + '\n';
    }
    root.querySelector('[data-hex]').textContent = out;
    root.querySelector('[data-cap]').innerHTML = s.cap;
    root.querySelectorAll('.rombar button').forEach((b) => b.classList.toggle('active', b.dataset.s === k));
  };
  root.querySelector('.rombar').onclick = (e) => { const b = e.target.closest('button'); if (b) show(b.dataset.s); };
  show('header');
  const banks = root.querySelector('[data-banks]');
  const names = app.programs();
  banks.innerHTML = names.map((n, i) => `<button data-i="${i}"><small>Bank ${i}</small>${n}</button>`).join('');
  banks.onclick = (e) => { const b = e.target.closest('button'); if (b) { app.loadProgram(+b.dataset.i); app.sys.apu.ensure(); } };
  return {
    update() {
      const cur = app.programIndex();
      banks.querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', i === cur));
      root.querySelector('[data-cur]').textContent = '← Bank ' + cur;
    },
  };
}

// ---------------- CPU ----------------
function cpu(root, app) {
  const { sys } = app;
  const { rom, machine } = sys;
  const codeLines = new Map();
  rom.listing.forEach((l) => codeLines.set(l.line, l));
  const listing = rom.lines.map((src, i) => {
    const l = codeLines.get(i);
    const [code, ...cm] = src.split(';');
    const comment = cm.length ? `<i>;${esc(cm.join(';'))}</i>` : '';
    return `<div class="ln" data-l="${i}"><span class="ad">${l ? hex(l.addr, 4) : ''}</span><span class="by">${l ? l.bytes.slice(0, 3).map((b) => hex(b)).join(' ') : ''}</span><span class="sr">${esc(code)}${comment}</span></div>`;
  }).join('');
  root.innerHTML = `
    <div class="regs" data-regs></div>
    <div class="seg" data-speed>
      <button data-v="pause">暂停</button><button data-v="slow">慢速</button><button data-v="fast">快速</button><button data-v="full">全速</button>
    </div>
    <div class="row"><button class="btn btn-sm" data-step>单步执行</button><button class="btn btn-sm" data-reset>复位重来</button></div>
    <div class="status" data-msg></div>
    <div class="listing" data-list>${listing}</div>
    <h3>CPU 眼里的世界：64KB 地址空间</h3>
    <div class="memmap">${REGIONS.map((r) => `<div data-r="${r.id}"><code>$${hex(r.from, 4)}–$${hex(r.to, 4)}</code><b>${r.name}</b><small>${r.note}</small></div>`).join('')}</div>
    <h3>内存里的三个变量</h3>
    <table class="kv mono" data-vars></table>`;
  const q = (s) => root.querySelector(s);
  const list = q('[data-list]');
  q('[data-speed]').onclick = (e) => { const b = e.target.closest('button'); if (b) sys.cpuSpeed = b.dataset.v; };
  q('[data-step]').onclick = () => { sys.cpuSpeed = 'pause'; app.cpuStep(true); };
  q('[data-reset]').onclick = () => { app.loadRom(); sys.cpuMsg = '已复位：PC 从复位向量 $FFFC 读出入口地址'; };
  let lastLine = -1;
  return {
    update() {
      const c = machine.cpu;
      const flags = 'NV-BDIZC'.split('').map((f, i) => `<span class="${c.p & (0x80 >> i) ? 'on' : ''}">${f}</span>`).join('');
      q('[data-regs]').innerHTML =
        `<div><small>A</small><b>${hex(c.a)}</b></div><div><small>X</small><b>${hex(c.x)}</b></div><div><small>Y</small><b>${hex(c.y)}</b></div>` +
        `<div><small>SP 栈指针</small><b>${hex(c.sp)}</b></div><div><small>PC 程序计数器</small><b>${hex(c.pc, 4)}</b></div><div class="flags"><small>标志位</small><b>${flags}</b></div>`;
      q('[data-speed]').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === sys.cpuSpeed));
      q('[data-msg]').textContent = sys.cpuMsg || '';
      const line = rom.lineOf.get(c.pc) ?? -1;
      if (line !== lastLine) {
        list.querySelector('.ln.cur')?.classList.remove('cur');
        const el = line >= 0 && list.children[line];
        if (el) { el.classList.add('cur'); list.scrollTop = el.offsetTop - list.clientHeight / 2; }
        lastLine = line;
      }
      const reg = sys.lastAccess ? regionOf(sys.lastAccess.a) : '';
      root.querySelectorAll('.memmap > div').forEach((d) => d.classList.toggle('active', d.dataset.r === reg));
      const r = machine.ram;
      q('[data-vars]').innerHTML =
        `<tr><td>$0000 BUTTONS</td><td>${bin(r[0])}</td></tr><tr><td>$0001 PX</td><td>${hex(r[1])}（${r[1]}）</td></tr><tr><td>$0002 PY</td><td>${hex(r[2])}（${r[2]}）</td></tr>`;
    },
  };
}

// ---------------- 画面 ----------------
function ppu(root, app) {
  const { sys, world } = app;
  const p = sys.ppu;
  root.innerHTML = `
    <div class="chips" data-tg>
      <button class="chip" data-k="layers">分层视图</button>
      <button class="chip" data-k="showBg">背景层</button>
      <button class="chip" data-k="showSpr">精灵层</button>
      <button class="chip" data-k="spriteLimit">每行 8 精灵限制</button>
      <button class="chip" data-k="slowScan">慢放扫描线</button>
      <button class="chip" data-k="grid">显示格子</button>
    </div>
    <div class="status tabular" data-stat></div>
    <h3>图案表：卡带里的 256 块"积木"</h3>
    <div class="pt-wrap">
      <canvas class="pix" data-pt width="128" height="128"></canvas>
      <div class="tz"><canvas class="pix" data-tz width="8" height="8"></canvas><pre data-bits></pre></div>
    </div>
    <p class="cap">点击任意图块放大。右边的数字就是它在 ROM 里的真实内容：每个像素 0–3。</p>
    <h3>调色板：8 组，每组 4 色</h3>
    <div class="pals" data-pals></div>
    <p class="cap">前 4 组给背景，后 4 组给精灵；每组的第 0 色是透明。点击某一组，看图案表换上不同的颜色。</p>`;
  const q = (s) => root.querySelector(s);
  const get = (k) => (k === 'layers' ? world.state.layers : k === 'slowScan' || k === 'grid' ? sys[k] : p[k]);
  q('[data-tg]').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const k = b.dataset.k;
    if (k === 'layers') world.state.layers = !world.state.layers;
    else if (k === 'slowScan' || k === 'grid') sys[k] = !sys[k];
    else p[k] = !p[k];
  };
  let sel = 0x41, palSel = 0, tick = 0;
  const pt = q('[data-pt]'), ptx = pt.getContext('2d'), img = ptx.createImageData(128, 128);
  const tz = q('[data-tz]').getContext('2d'), timg = tz.createImageData(8, 8);
  const rgb = (i) => NES_HEX[p.pal[i] & 63];
  const color = (v) => (v ? rgb(palSel * 4 + v) : rgb(0));
  const setPx = (im, o, c) => { im.data[o] = c >> 16; im.data[o + 1] = (c >> 8) & 255; im.data[o + 2] = c & 255; im.data[o + 3] = 255; };
  pt.onclick = (e) => {
    const r = pt.getBoundingClientRect();
    sel = Math.floor(((e.clientY - r.top) / r.height) * 16) * 16 + Math.floor(((e.clientX - r.left) / r.width) * 16);
    tick = 0;
  };
  q('[data-pals]').onclick = (e) => { const g = e.target.closest('[data-g]'); if (g) { palSel = +g.dataset.g; tick = 0; } };
  return {
    update() {
      q('[data-tg]').querySelectorAll('button').forEach((b) => b.classList.toggle('active', !!get(b.dataset.k)));
      const s = p.stats;
      q('[data-stat]').textContent = `本帧精灵 ${s.sprites} 个 · 单行最多 ${s.maxLine} 个 · 因超限被丢弃 ${s.dropped} 行次`;
      if (tick++ % 20) return;
      for (let t = 0; t < 256; t++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        setPx(img, (((t >> 4) * 8 + y) * 128 + (t & 15) * 8 + x) * 4, color(p.chr[t * 64 + y * 8 + x]));
      }
      ptx.putImageData(img, 0, 0);
      ptx.strokeStyle = '#0a84ff';
      ptx.strokeRect((sel & 15) * 8 + 0.5, (sel >> 4) * 8 + 0.5, 7, 7);
      let bits = '';
      for (let i = 0; i < 64; i++) {
        setPx(timg, i * 4, color(p.chr[sel * 64 + i]));
        bits += p.chr[sel * 64 + i] + ((i & 7) === 7 ? '\n' : ' ');
      }
      tz.putImageData(timg, 0, 0);
      q('[data-bits]').textContent = `图块 $${hex(sel)}\n` + bits;
      q('[data-pals]').innerHTML = Array.from({ length: 8 }, (_, g) =>
        `<div data-g="${g}" class="${g === palSel ? 'active' : ''}"><small>${g < 4 ? '背景' : '精灵'} ${g & 3}</small>${[0, 1, 2, 3].map((i) => `<i style="background:${cssColor(p.pal[i ? g * 4 + i : 0])}"></i>`).join('')}</div>`).join('');
    },
    dispose() { sys.slowScan = false; sys.grid = false; p.showBg = p.showSpr = p.spriteLimit = true; },
  };
}

// ---------------- 声音 ----------------
function apu(root, app) {
  const a = app.sys.apu;
  const chans = [
    { id: 'pulse1', name: '方波 1', desc: '主旋律。可调"占空比"改变音色', play: (d) => a.pulse({ freq: 440, dur: 0.5, duty: d }, 'pulse1') },
    { id: 'pulse2', name: '方波 2', desc: '和声、音效', play: (d) => a.pulse({ freq: 660, dur: 0.5, duty: d }, 'pulse2') },
    { id: 'triangle', name: '三角波', desc: '柔和低沉，通常做贝斯', play: () => a.tri({ freq: 110, dur: 0.6 }) },
    { id: 'noise', name: '噪声', desc: '随机信号：鼓点、爆炸、脚步', play: () => a.noise({ dur: 0.3 }) },
    { id: 'dmc', name: '采样', desc: '1 位增量编码的粗糙录音', play: () => a.dmc() },
  ];
  root.innerHTML = `
    <canvas class="scope" data-scope width="680" height="150"></canvas>
    <p class="cap">实时示波器：喇叭此刻收到的波形。</p>
    <div class="chans">${chans.map((c) => `<button data-c="${c.id}"><canvas width="96" height="40"></canvas><span><b>${c.name}</b><small>${c.desc}</small></span><em>播放</em></button>`).join('')}</div>
    <h3>方波的占空比</h3>
    <div class="seg" data-duty><button data-v="0.125">12.5%</button><button data-v="0.25">25%</button><button data-v="0.5" class="active">50%</button><button data-v="0.75">75%</button></div>
    <p class="cap">一个周期里"高"的时间占多少。越窄声音越尖、越薄。选好后点上面的方波试听。</p>
    <div class="row"><button class="btn btn-primary" data-song>播放一段四声道合奏</button></div>`;
  const q = (s) => root.querySelector(s);
  let duty = 0.5;
  const shape = (id, x) => {
    if (id === 'triangle') return 1 - 4 * Math.abs(((x * 2) % 1) - 0.5);
    if (id === 'noise') return Math.sin(x * 9973.13 * 7.1) > 0 ? 0.8 : -0.8;
    if (id === 'dmc') return Math.round(Math.sin(x * 12) * Math.exp(-x * 3) * 4) / 4;
    return (x * 2) % 1 < duty ? 0.8 : -0.8;
  };
  const drawMini = () => {
    root.querySelectorAll('.chans button').forEach((b) => {
      const c = b.querySelector('canvas'), g = c.getContext('2d');
      g.clearRect(0, 0, 96, 40);
      g.strokeStyle = getComputedStyle(root).getPropertyValue('--text-2') || '#6e6e73';
      g.lineWidth = 2;
      g.beginPath();
      for (let x = 0; x < 96; x++) {
        const y = 20 - shape(b.dataset.c, b.dataset.c === 'noise' ? Math.floor(x / 3) / 32 : x / 96) * 14;
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    });
  };
  drawMini();
  q('.chans').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    a.ensure();
    chans.find((c) => c.id === b.dataset.c).play(duty);
    app.world.bus.fire('apu', ORANGE, false, 0.6);
  };
  q('[data-duty]').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    duty = +b.dataset.v;
    q('[data-duty]').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    drawMini();
  };
  q('[data-song]').onclick = () => { a.song(); app.world.bus.fire('apu', ORANGE, false, 0.6); };
  const scope = q('[data-scope]'), sg = scope.getContext('2d');
  const buf = new Uint8Array(1024);
  return {
    update() {
      const now = performance.now();
      root.querySelectorAll('.chans button').forEach((b) => b.classList.toggle('live', Math.abs(now - a.last[b.dataset.c]) < 160));
      sg.clearRect(0, 0, 680, 150);
      sg.strokeStyle = '#0a84ff';
      sg.lineWidth = 3;
      sg.beginPath();
      if (a.analyser) a.analyser.getByteTimeDomainData(buf); else buf.fill(128);
      for (let i = 0; i < 680; i++) {
        const y = 75 - ((buf[i] - 128) / 128) * 68;
        i ? sg.lineTo(i, y) : sg.moveTo(i, y);
      }
      sg.stroke();
    },
  };
}

// ---------------- 手柄 ----------------
function pad(root, app) {
  const { sys, world } = app;
  root.innerHTML = `
    <div class="bits" data-bits>${BTN.map((b, i) => `<div><small>${BTN_CN[i]}</small><b>0</b><em>第 ${i + 1} 位</em></div>`).join('')}</div>
    <div class="row"><button class="btn btn-primary" data-read>演示一次读取</button></div>
    <div class="status" data-msg>按住几个键，再点"演示一次读取"。</div>`;
  const cells = [...root.querySelectorAll('[data-bits] > div')];
  const msg = root.querySelector('[data-msg]');
  let timers = [], snap = null, cur = -1;
  const clear = () => { timers.forEach(clearTimeout); timers = []; };
  root.querySelector('[data-read]').onclick = () => {
    clear();
    snap = BTN.map((_, i) => sys.pad.bit(i));
    cur = -1;
    msg.textContent = '主机往 $4016 写 1 再写 0：手柄给 8 个按键拍下快照。';
    world.fireCable(ORANGE, true);
    for (let i = 0; i < 8; i++) {
      timers.push(setTimeout(() => {
        cur = i;
        msg.textContent = `第 ${i + 1} 次读 $4016 → 得到 ${snap[i]}（${BTN_CN[i]}键${snap[i] ? '按下' : '没按'}）`;
        world.fireCable(snap[i] ? BLUE : 0x8e8e93);
        world.bus.fire('pad', BLUE, true);
      }, 900 + i * 650));
    }
    timers.push(setTimeout(() => {
      cur = -1;
      msg.textContent = `8 位凑成一个字节：${snap.join('')}。程序接下来只要检查其中某一位，就知道哪个键被按下。`;
      snap = null;
    }, 900 + 8 * 650));
  };
  return {
    update() {
      cells.forEach((c, i) => {
        const v = snap ? snap[i] : sys.pad.bit(i);
        c.querySelector('b').textContent = v;
        c.classList.toggle('on', !!v);
        c.classList.toggle('cur', i === cur);
      });
    },
    dispose: clear,
  };
}

// ---------------- 开机流程 ----------------
function boot(root, app) {
  const { sys, world } = app;
  root.innerHTML = `
    <ol class="steps">${BOOT_STEPS.map((s, i) => `<li data-i="${i}"><b>${s.title}</b><p>${s.text}</p></li>`).join('')}</ol>
    <div class="row"><button class="btn btn-sm" data-prev>上一步</button><button class="btn btn-sm btn-primary" data-next>下一步</button><button class="btn btn-sm" data-auto>自动播放</button></div>
    <div class="status" data-msg></div>`;
  let step = -1, auto = null, t1 = null;
  const items = [...root.querySelectorAll('.steps li')];
  const apply = (i) => {
    step = Math.max(0, Math.min(BOOT_STEPS.length - 1, i));
    items.forEach((li, k) => { li.classList.toggle('active', k === step); li.classList.toggle('done', k < step); });
    items[step].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    clearTimeout(t1);
    sys.ppuPulse = step >= 3;
    if (step === 0) {
      sys.power = false; sys.cpuSpeed = 'pause';
      world.state.cart = 'up';
      t1 = setTimeout(() => { world.state.cart = 'in'; }, 700);
    } else {
      world.state.cart = 'in';
      if (step === 1 || !sys.power) {
        sys.power = true;
        app.loadRom();
        sys.cpuSpeed = 'pause';
        world.bus.fire('cart', BLUE, true, 0.8);
        t1 = setTimeout(() => world.bus.fire('cart', BLUE, true, 0.8), 400);
        sys.cpuMsg = '读 $FFFC、$FFFD → 得到入口地址 $8000';
      }
      if (step >= 2) sys.cpuSpeed = step === 5 ? 'full' : 'fast';
    }
  };
  root.querySelector('.steps').onclick = (e) => { const li = e.target.closest('li'); if (li) apply(+li.dataset.i); };
  root.querySelector('[data-prev]').onclick = () => apply(step - 1);
  root.querySelector('[data-next]').onclick = () => apply(step + 1);
  const autoBtn = root.querySelector('[data-auto]');
  const stopAuto = () => { clearInterval(auto); auto = null; autoBtn.textContent = '自动播放'; };
  autoBtn.onclick = () => {
    if (auto) return stopAuto();
    autoBtn.textContent = '停止播放';
    apply(0);
    auto = setInterval(() => { if (step >= BOOT_STEPS.length - 1) stopAuto(); else apply(step + 1); }, 5200);
  };
  apply(0);
  return {
    update() {
      const c = sys.machine.cpu;
      root.querySelector('[data-msg]').textContent = sys.power ? `PC = $${hex(c.pc, 4)} · 已运行 ${sys.machine.frames} 帧 · ${sys.cpuMsg || ''}` : '电源关闭';
    },
    dispose() { stopAuto(); clearTimeout(t1); sys.power = true; sys.ppuPulse = false; },
  };
}

// ---------------- 游戏厅 ----------------
function play(root, app) {
  const { sys } = app;
  const list = [...sys.games.map((g) => ({ name: g.name, en: g.en, desc: g.desc, keys: g.keys })),
    { name: '6502 演示程序', en: 'HELLO 6502', desc: '第 4 章那段真正的机器码，由 CPU 仿真器全速执行。', keys: '方向键移动，按住 A 换色' }];
  root.innerHTML = `
    <div class="games">${list.map((g, i) => `<button data-i="${i}"><b>${g.name}<small>${g.en}</small></b><p>${g.desc}</p><em>${g.keys}</em></button>`).join('')}</div>
    <div class="row"><button class="btn btn-sm" data-restart>重新开始</button><button class="chip" data-mute>声音</button></div>
    <h3>按键</h3>
    <table class="kv">
      <tr><td>方向</td><td><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> 或 <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></td></tr>
      <tr><td>A 键</td><td><kbd>K</kbd> 或 <kbd>X</kbd></td></tr>
      <tr><td>B 键</td><td><kbd>J</kbd> 或 <kbd>Z</kbd></td></tr>
      <tr><td>开始</td><td><kbd>Enter</kbd></td></tr>
      <tr><td>选择</td><td><kbd>Shift</kbd></td></tr>
    </table>
    <p class="muted">也可以用鼠标直接点场景里的 3D 手柄。想看这些画面是怎么拼出来的，回到"画面"一章打开分层视图再玩。</p>`;
  root.querySelector('.games').onclick = (e) => { const b = e.target.closest('button'); if (b) { sys.apu.ensure(); app.loadProgram(+b.dataset.i); } };
  root.querySelector('[data-restart]').onclick = () => app.loadProgram(app.programIndex());
  root.querySelector('[data-mute]').onclick = () => { sys.apu.ensure(); sys.apu.muted = !sys.apu.muted; };
  return {
    update() {
      const cur = app.programIndex();
      root.querySelectorAll('.games button').forEach((b, i) => b.classList.toggle('active', i === cur));
      root.querySelector('[data-mute]').classList.toggle('active', !sys.apu.muted);
    },
  };
}

export const widgets = { cart, cpu, ppu, apu, pad, boot, play };
