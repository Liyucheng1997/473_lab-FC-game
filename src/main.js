import './styles/tokens.css';
import './styles/app.css';
import * as THREE from 'three';
import { PPU, W, H } from './emu/ppu.js';
import { Pad } from './emu/pad.js';
import { APU } from './emu/apu.js';
import { Machine, regionOf, REGIONS } from './emu/machine.js';
import { buildTiles } from './emu/tiles.js';
import { buildDemoRom } from './emu/demo-rom.js';
import snake from './games/snake.js';
import breakout from './games/breakout.js';
import shooter from './games/shooter.js';
import { createStage } from './scene/stage.js';
import { buildWorld } from './scene/models.js';
import { CHAPTERS, PARTS } from './content.js';
import { widgets } from './widgets.js';

const BLUE = 0x0a84ff, ORANGE = 0xff9f0a;
const hex = (v, n = 2) => v.toString(16).toUpperCase().padStart(n, '0');

// ---------------- 仿真系统 ----------------
const ppu = new PPU();
buildTiles(ppu);
const pad = new Pad();
const apu = new APU();
const machine = new Machine(ppu, pad);
const rom = buildDemoRom(ppu);
const sys = {
  ppu, pad, apu, machine, rom,
  games: [shooter, breakout, snake],
  mode: 'game', game: shooter, lastGame: shooter,
  cpuSpeed: 'full', cpuMsg: '', lastAccess: null,
  power: true, slowScan: false, grid: false, ppuPulse: false,
};

function loadGame(g) {
  sys.mode = 'game'; sys.game = g; sys.lastGame = g;
  g.init(sys);
}
function loadRom() {
  sys.mode = 'rom';
  machine.load(rom.mem);
  machine.reset();
  sys.lastAccess = null;
}
const programIndex = () => (sys.mode === 'rom' ? sys.games.length : sys.games.indexOf(sys.game));
function loadProgram(i) {
  if (i >= sys.games.length) { loadRom(); sys.cpuSpeed = 'full'; } else loadGame(sys.games[i]);
}

// 执行一条 6502 指令，并把它的总线访问变成主板上的脉冲
function cpuStep(visual) {
  const m = machine;
  if (m.cpu.halted) { sys.cpuMsg = 'CPU 已停机'; return; }
  if (m.idle()) {
    const nmi = m.skipToVblank();
    sys.cpuMsg = nmi ? 'PPU 画完一帧，发出 NMI 中断 → CPU 跳到 NMI 处' : 'CPU 在原地空转，等待下一帧';
    if (visual) world.bus.fire('ppu', ORANGE, true, 0.6);
    return;
  }
  m.step();
  const data = m.trace.filter((t) => !t.f);
  const last = data[data.length - 1];
  if (visual) {
    world.bus.fire('cart', BLUE, true);
    for (const t of data) {
      const r = regionOf(t.a);
      if (r !== 'none') world.bus.fire(r, t.w ? ORANGE : BLUE, !t.w);
    }
  }
  if (last) {
    sys.lastAccess = last;
    const reg = REGIONS.find((r) => r.id === regionOf(last.a));
    sys.cpuMsg = `${last.w ? '写' : '读'} $${hex(last.a, 4)}（${reg ? reg.name : '未使用'}）${last.w ? '←' : '→'} $${hex(last.v)}`;
  } else {
    sys.lastAccess = { a: m.cpu.pc };
    sys.cpuMsg = '只在 CPU 内部运算，没有访问外部';
  }
}

let slowCnt = 0, pulseCnt = 0;
function tick() {
  if (!sys.power) return;
  if (sys.mode === 'game') sys.game.update(sys);
  else if (sys.cpuSpeed === 'full') machine.runFrame();
  else if (sys.cpuSpeed === 'fast') { for (let i = 0; i < 4; i++) cpuStep(true); }
  else if (sys.cpuSpeed === 'slow' && ++slowCnt >= 15) { slowCnt = 0; cpuStep(true); }
  pad.tick();
  if (sys.ppuPulse && ++pulseCnt % 12 === 0) {
    world.bus.fire('vram', BLUE, true);
    world.bus.fire('chr', BLUE, true);
    world.bus.fire('video', ORANGE, false, 0.6);
  }
}

// ---------------- 电视画面 ----------------
const mkCanvas = () => {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  return { c, g, img, u32: new Uint32Array(img.data.buffer) };
};
const out = { tv: mkCanvas(), bg: mkCanvas(), spr: mkCanvas() };
const mkTex = (o) => {
  const t = new THREE.CanvasTexture(o.c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
  return t;
};
const tex = { tv: mkTex(out.tv), bg: mkTex(out.bg), spr: mkTex(out.spr) };
let beam = 0;

function drawGrid(g, sprites) {
  g.fillStyle = 'rgba(255,255,255,0.22)';
  for (let x = 0; x < W; x += 8) g.fillRect(x, 0, 0.5, H);
  for (let y = 0; y < H; y += 8) g.fillRect(0, y, W, 0.5);
  if (!sprites) return;
  g.strokeStyle = '#0a84ff';
  g.lineWidth = 1;
  for (let i = 0; i < 64; i++) {
    const y = ppu.oam[i * 4];
    if (y < 240) g.strokeRect(ppu.oam[i * 4 + 3] + 0.5, y + 0.5, 7, 7);
  }
}

function present() {
  const o = out.tv;
  if (!sys.power) o.u32.fill(0xff0c0c0c);
  else if (sys.slowScan) {
    for (let n = 0; n < 2; n++) {
      o.u32.set(ppu.fb.subarray(beam * W, beam * W + W), beam * W);
      if (++beam >= H) {
        beam = 0;
        tick();
        ppu.renderFrame();
        for (let i = 0; i < o.u32.length; i++) o.u32[i] = ((o.u32[i] >>> 1) & 0x7f7f7f) | 0xff000000;
      }
    }
  } else o.u32.set(ppu.fb);
  o.g.putImageData(o.img, 0, 0);
  if (sys.power && sys.slowScan) { o.g.fillStyle = '#fff'; o.g.fillRect(0, beam, W, 1); }
  if (sys.grid) drawGrid(o.g, true);
  tex.tv.needsUpdate = true;
  if (world.layerBg.visible) {
    out.bg.u32.set(ppu.bgL);
    out.bg.g.putImageData(out.bg.img, 0, 0);
    if (sys.grid) drawGrid(out.bg.g, false);
    out.spr.u32.set(ppu.sprL);
    out.spr.g.putImageData(out.spr.img, 0, 0);
    if (sys.grid) drawGrid(out.spr.g, true);
    tex.bg.needsUpdate = tex.spr.needsUpdate = true;
  }
}

// ---------------- 三维场景 ----------------
const canvas = document.getElementById('gl');
const stage = createStage(canvas);
const world = buildWorld(stage.scene, tex);

// ---------------- 界面 ----------------
const nav = document.getElementById('nav-list');
const panel = document.getElementById('panel');
const body = document.getElementById('panel-body');
const labelHost = document.getElementById('labels');
let chapter = null, widget = null, labels = [];

nav.innerHTML = CHAPTERS.map((c, i) => `<button data-id="${c.id}"><span class="no">${i + 1}</span><span><b>${c.title}</b><small>${c.sub}</small></span></button>`).join('');
nav.onclick = (e) => { const b = e.target.closest('button'); if (b) go(b.dataset.id); };

function showPart(key) {
  const p = PARTS[key];
  const el = document.getElementById('part');
  el.innerHTML = `<b>${p.name}</b><p>${p.text}</p>`;
  el.hidden = false;
  labels.forEach((l) => l.el.classList.toggle('active', l.key === key));
  panel.scrollTo({ top: 0, behavior: 'smooth' });
}

function go(id) {
  const c = CHAPTERS.find((x) => x.id === id) || CHAPTERS[0];
  const idx = CHAPTERS.indexOf(c);
  const wasRom = chapter && chapter.program === 'rom';
  widget?.dispose?.();
  widget = null;
  chapter = c;
  nav.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.id === c.id));
  nav.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

  // 这一章电视上跑什么
  if (c.program === 'rom') { loadRom(); sys.cpuSpeed = c.id === 'cpu' ? 'fast' : 'pause'; sys.cpuMsg = ''; }
  else if (wasRom || !sys.game.state) loadGame(sys.lastGame);

  body.innerHTML = `
    <div class="eyebrow">第 ${idx + 1} 章 · 共 ${CHAPTERS.length} 章</div>
    <h1>${c.title}<small>${c.sub}</small></h1>
    <div id="part" class="part" hidden></div>
    ${c.html}
    <div class="pager">
      <button class="btn" data-go="${CHAPTERS[idx - 1]?.id || ''}" ${idx ? '' : 'disabled'}>上一章</button>
      <button class="btn btn-primary" data-go="${CHAPTERS[idx + 1]?.id || ''}" ${idx < CHAPTERS.length - 1 ? '' : 'disabled'}>下一章：${CHAPTERS[idx + 1]?.title || ''}</button>
    </div>`;
  body.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => b.dataset.go && go(b.dataset.go); });
  panel.scrollTop = 0;

  Object.assign(world.state, { layers: false, ...c.scene });
  // 窄屏可视区域是竖的，把镜头拉远一些才能看全
  const far = window.innerWidth < 900 ? 1.7 : 1;
  stage.flyTo(c.scene.cam.map((v, i) => c.scene.target[i] + (v - c.scene.target[i]) * far), c.scene.target);

  labelHost.innerHTML = '';
  labels = c.labels.map((key) => {
    const el = document.createElement('button');
    el.className = 'label';
    el.textContent = PARTS[key].name;
    el.onclick = () => showPart(key);
    labelHost.appendChild(el);
    return { key, el, obj: world.anchors[key] };
  });

  const mount = body.querySelector('[data-widget]');
  if (mount && widgets[c.id]) widget = widgets[c.id](mount, app);
  history.replaceState(null, '', '#' + c.id);
}

const app = { sys, world, stage, loadRom, loadProgram, programIndex, cpuStep, programs: () => [...sys.games.map((g) => g.name), '6502 演示'] };

// 标签：把三维锚点投影到屏幕
const v3 = new THREE.Vector3();
function updateLabels() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  for (const l of labels) {
    let vis = true;
    for (let o = l.obj; o; o = o.parent) if (!o.visible) { vis = false; break; }
    l.obj.getWorldPosition(v3).project(stage.camera);
    if (!vis || v3.z > 1) { l.el.style.display = 'none'; continue; }
    l.el.style.display = '';
    l.el.style.transform = `translate(-50%, -100%) translate(${((v3.x + 1) / 2) * w}px, ${((1 - v3.y) / 2) * h - 8}px)`;
  }
}

// 面板占位 → 让镜头对准"可视区域"的中心
function measureInsets() {
  const n = document.getElementById('nav').getBoundingClientRect();
  const p = panel.getBoundingClientRect();
  const wide = window.innerWidth >= 900;
  stage.setInsets(wide
    ? { left: n.right, right: window.innerWidth - p.left, top: 0, bottom: 0 }
    : { left: 0, right: 0, top: n.bottom, bottom: window.innerHeight - p.top });
}
function resize() { stage.resize(window.innerWidth, window.innerHeight); measureInsets(); }
window.addEventListener('resize', resize);

// ---------------- 输入 ----------------
const KEYS = {
  ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', KeyW: 'UP', KeyS: 'DOWN', KeyA: 'LEFT', KeyD: 'RIGHT',
  KeyK: 'A', KeyX: 'A', KeyJ: 'B', KeyZ: 'B', Enter: 'START', ShiftLeft: 'SELECT', ShiftRight: 'SELECT',
};
window.addEventListener('keydown', (e) => {
  const b = KEYS[e.code];
  if (!b || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target instanceof HTMLButtonElement && e.code === 'Enter') e.target.blur();
  e.preventDefault();
  apu.ensure();
  pad.set(b, 1);
});
window.addEventListener('keyup', (e) => { const b = KEYS[e.code]; if (b) pad.set(b, 0); });
window.addEventListener('blur', () => { pad.kb.fill(0); pad.ui.fill(0); });

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
canvas.addEventListener('pointerdown', (e) => {
  ndc.set((e.clientX / canvas.clientWidth) * 2 - 1, -(e.clientY / canvas.clientHeight) * 2 + 1);
  ray.setFromCamera(ndc, stage.camera);
  const hit = ray.intersectObjects(world.padButtons, false)[0];
  if (!hit) return;
  apu.ensure();
  pad.set(hit.object.userData.btn, 1, 'ui');
  stage.controls.enabled = false;
});
window.addEventListener('pointerup', () => { pad.ui.fill(0); stage.controls.enabled = true; });

// ---------------- 主循环 ----------------
let lastT = performance.now(), acc = 0;
function frame(forceDt) {
  const now = performance.now();
  const dt = typeof forceDt === 'number' ? forceDt : Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  acc += dt;
  let n = 0;
  while (acc >= 1 / 60) {
    acc -= 1 / 60;
    if (n++ < 3 && !sys.slowScan) tick();
  }
  ppu.renderFrame();
  present();
  world.setButtons(pad);
  world.led.visible = sys.power;
  world.update(dt);
  measureInsets();
  stage.update(dt);
  stage.camera.updateMatrixWorld();
  updateLabels();
  widget?.update?.();
  stage.render();
}
function loop() { frame(); requestAnimationFrame(loop); }

loadGame(shooter);
resize();
go(location.hash.slice(1) || 'overview');
loop();
if (import.meta.env.DEV) window.__debug = { sys, world, stage, frame, go, app };
