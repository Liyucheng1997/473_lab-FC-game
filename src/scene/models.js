// 全部用代码搭出来的模型：电视、主机（外壳 + 主板）、卡带、手柄
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const CREAM = 0xf1ede2, RED = 0xc62a2f, DARK = 0x2a2a2d, PCB = 0x1d7a4c, GOLD = 0xd9a441;
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0, ...o });
const metal = std(0xc8c8cc, { metalness: 0.9, roughness: 0.3 });
const chipMat = std(0x1b1b1e, { roughness: 0.4 });

function box(w, h, d, m, r = 0.04) {
  const g = r ? new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
function put(obj, parent, x = 0, y = 0, z = 0) { obj.position.set(x, y, z); parent.add(obj); return obj; }

function textTexture(lines, { w = 256, h = 128, color = '#d0d0d4', bg = null, size = 44, font = 'bold' } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  g.fillStyle = color;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const arr = [].concat(lines);
  arr.forEach((t, i) => {
    g.font = `${font} ${i ? size * 0.55 : size}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    g.fillText(t, w / 2, h / 2 + (i - (arr.length - 1) / 2) * size * 0.95);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
function decal(w, h, tex) {
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
}

// 一颗双列直插芯片，躺在 XZ 平面上
function chip(w, d, label, pins = 20) {
  const g = new THREE.Group();
  put(box(w, 0.09, d, chipMat, 0.012), g, 0, 0.075, 0);
  const lab = decal(w * 0.92, d * 0.8, textTexture(label, { w: 256, h: Math.round(256 * d * 0.8 / (w * 0.92)), size: 40 }));
  lab.rotation.x = -Math.PI / 2;
  put(lab, g, 0, 0.1215, 0);
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.02, 0.06, 0.03), metal, pins * 2);
  const m = new THREE.Matrix4();
  for (let i = 0; i < pins; i++) {
    const x = -w / 2 + ((i + 0.5) * w) / pins;
    inst.setMatrixAt(i * 2, m.makeTranslation(x, 0.03, d / 2 + 0.012));
    inst.setMatrixAt(i * 2 + 1, m.makeTranslation(x, 0.03, -d / 2 - 0.012));
  }
  g.add(inst);
  return g;
}

// 主板上的信号走线，以及沿走线跑的"数据脉冲"
export class Pulser {
  constructor(parent, y = 0.012) {
    this.parent = parent; this.y = y; this.routes = {}; this.live = [];
    this.geo = new THREE.SphereGeometry(0.035, 12, 8);
  }
  route(id, pts, color = GOLD) {
    const v = pts.map(([x, z]) => new THREE.Vector3(x, this.y, z));
    const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.4, emissive: 0x000000 });
    let len = 0;
    for (let i = 0; i < v.length - 1; i++) {
      const a = v[i], b = v[i + 1], l = a.distanceTo(b);
      const seg = new THREE.Mesh(new THREE.BoxGeometry(l + 0.03, 0.006, 0.03), mat);
      seg.position.copy(a).add(b).multiplyScalar(0.5);
      seg.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
      this.parent.add(seg);
      len += l;
    }
    this.routes[id] = { v, len, mat, glow: 0 };
  }
  // reverse = 从设备流向芯片（读）；否则从芯片流向设备（写）
  fire(id, color = 0x0a84ff, reverse = false, dur = 0.45) {
    const r = this.routes[id];
    if (!r || this.live.length > 40) return;
    const mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    this.parent.add(mesh);
    r.glow = 1; r.color = color;
    this.live.push({ r, mesh, t: 0, dur, reverse });
  }
  update(dt) {
    for (const p of this.live) {
      p.t += dt / p.dur;
      let d = Math.min(1, p.t) * p.r.len;
      if (p.reverse) d = p.r.len - d;
      const v = p.r.v;
      for (let i = 0; i < v.length - 1; i++) {
        const l = v[i].distanceTo(v[i + 1]);
        if (d <= l || i === v.length - 2) { p.mesh.position.lerpVectors(v[i], v[i + 1], Math.min(1, d / l)); break; }
        d -= l;
      }
      p.mesh.position.y = this.y + 0.03;
      if (p.t >= 1) { this.parent.remove(p.mesh); p.mesh.material.dispose(); }
    }
    this.live = this.live.filter((p) => p.t < 1);
    for (const r of Object.values(this.routes)) {
      if (r.glow > 0) {
        r.glow = Math.max(0, r.glow - dt * 2.5);
        r.mat.emissive.set(r.color).multiplyScalar(r.glow * 0.9);
      }
    }
  }
}

export function buildWorld(scene, tex) {
  const anchors = {};
  const anchor = (key, parent, x, y, z) => { anchors[key] = put(new THREE.Object3D(), parent, x, y, z); };
  const world = { anchors, padButtons: [], chips: {} };

  // ---------------- 电视 ----------------
  const tv = put(new THREE.Group(), scene, 0, 0.9, -2.8);
  put(box(5.2, 0.9, 2.7, std(0xe6e3dc, { roughness: 0.75 }), 0.05), scene, 0, 0.45, -2.8); // 电视柜
  put(box(4.7, 3.6, 2.4, std(0x4b4845, { roughness: 0.7 }), 0.14), tv, 0, 1.95, 0);
  put(box(3.86, 3.0, 0.1, std(0x161618, { roughness: 0.35 }), 0.06), tv, -0.3, 2.0, 1.2);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 2.62), new THREE.MeshBasicMaterial({ map: tex.tv, toneMapped: false }));
  put(screen, tv, -0.3, 2.0, 1.256);
  for (const y of [2.9, 2.4]) {
    const k = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.12, 24), std(0x1c1c1e));
    k.rotation.x = Math.PI / 2;
    k.castShadow = true;
    put(k, tv, 1.98, y, 1.22);
  }
  const grille = textTexture('', { w: 64, h: 128 });
  { const g = grille.image.getContext('2d'); g.fillStyle = '#1c1c1e'; for (let i = 0; i < 12; i++) g.fillRect(6, 6 + i * 10, 52, 4); grille.needsUpdate = true; }
  put(decal(0.5, 1.0, grille), tv, 1.98, 1.3, 1.205);
  for (const x of [-1.9, 1.9]) put(box(0.5, 0.16, 1.8, std(0x2c2c2e), 0.05), tv, x, 0.08, 0);
  anchor('tv', tv, -0.3, 3.5, 1.2);
  anchor('speaker', tv, 1.98, 1.3, 1.25);

  // PPU 分层演示用的两块浮空面板
  const frameMat = new THREE.LineBasicMaterial({ color: 0x0071e3 });
  const layer = (map, transparent) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 2.62), new THREE.MeshBasicMaterial({ map, toneMapped: false, transparent, alphaTest: transparent ? 0.5 : 0, side: THREE.DoubleSide }));
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(3.5, 2.62)), frameMat));
    m.visible = false;
    return put(m, tv, -0.3, 2.0, 1.256);
  };
  world.layerBg = layer(tex.bg, false);
  world.layerSpr = layer(tex.spr, true);
  anchor('layerBg', world.layerBg, -1.75, 1.45, 0);
  anchor('layerSpr', world.layerSpr, -1.75, 1.45, 0);
  anchor('layerOut', tv, -2.05, 3.45, 1.26);
  world.tv = tv;

  // ---------------- 主机 ----------------
  const con = put(new THREE.Group(), scene, 0, 0, 1.0);
  put(box(3.2, 0.36, 2.3, std(CREAM), 0.06), con, 0, 0.18, 0);
  world.console = con;

  // 主板
  const board = put(new THREE.Group(), con, 0, 0.4, 0);
  put(box(2.9, 0.04, 2.0, std(PCB, { roughness: 0.65 }), 0.01), board, 0, -0.02, 0);
  const parts = [
    ['cpu', chip(1.0, 0.3, 'CPU', 20), -0.6, 0.35],
    ['ppu', chip(1.0, 0.3, 'PPU', 20), 0.6, 0.35],
    ['ram', chip(0.56, 0.22, 'RAM', 12), -0.95, -0.72],
    ['vram', chip(0.56, 0.22, 'VRAM', 12), 0.95, -0.72],
    ['logic', chip(0.34, 0.16, '74', 8), -0.3, 0.82],
    ['logic2', chip(0.34, 0.16, '74', 8), 0.4, 0.82],
  ];
  for (const [key, g, x, z] of parts) { put(g, board, x, 0, z); world.chips[key] = g; anchor(key, board, x, 0.16, z); }
  const slot = put(box(1.75, 0.22, 0.17, std(0x141416), 0.02), board, 0, 0.11, -0.2);
  put(box(1.6, 0.02, 0.05, std(0x050505), 0), slot, 0, 0.11, 0);
  anchor('slot', board, -0.7, 0.24, -0.2);
  put(box(0.5, 0.26, 0.42, metal, 0.02), board, 1.18, 0.13, -0.27);
  anchor('rf', board, 1.18, 0.28, -0.27);
  const xtal = put(box(0.22, 0.09, 0.1, metal, 0.04), board, 1.15, 0.045, 0.8);
  xtal.castShadow = true;
  anchor('xtal', board, 1.15, 0.12, 0.8);
  put(box(0.36, 0.2, 0.22, std(0x141416), 0.02), board, -1.1, 0.1, 0.88);
  anchor('port', board, -1.1, 0.22, 0.88);
  put(box(0.16, 0.24, 0.06, std(0x141416), 0.01), board, -1.25, 0.12, -0.25);
  for (const [x, z] of [[-0.1, -0.75], [0.25, -0.75], [-1.3, 0.3], [0.1, 0.05]]) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 16), std(0x1e3a8a, { roughness: 0.3 }));
    cap.castShadow = true;
    put(cap, board, x, 0.08, z);
  }
  const bus = new Pulser(board);
  bus.route('ram', [[-0.9, 0.2], [-0.9, -0.6]]);
  bus.route('cart', [[-0.4, 0.2], [-0.4, -0.11]]);
  bus.route('ppu', [[-0.6, 0.52], [-0.6, 0.63], [0.6, 0.63], [0.6, 0.52]]);
  bus.route('pad', [[-1.0, 0.52], [-1.0, 0.66], [-1.1, 0.66], [-1.1, 0.77]]);
  bus.route('apu', [[-0.2, 0.2], [-0.2, 0.04], [1.12, 0.04], [1.12, -0.06]], 0xc98a4b);
  bus.route('vram', [[0.9, 0.2], [0.9, -0.6]]);
  bus.route('chr', [[0.4, 0.2], [0.4, -0.11]]);
  bus.route('video', [[1.02, 0.2], [1.02, 0.12], [1.25, 0.12], [1.25, -0.06]], 0xc98a4b);
  world.bus = bus;
  world.board = board;

  // 上盖
  const shell = put(new THREE.Group(), con, 0, 0, 0);
  put(box(3.2, 0.42, 2.3, std(CREAM), 0.07), shell, 0, 0.57, 0);
  put(box(2.6, 0.03, 1.3, std(RED, { roughness: 0.4 }), 0.012), shell, 0, 0.785, 0.05);
  put(box(1.8, 0.04, 0.4, std(0x101012), 0.01), shell, 0, 0.795, -0.2);
  world.powerBtn = put(box(0.3, 0.07, 0.2, std(0x7d1418), 0.02), shell, -0.95, 0.815, 0.48);
  put(box(0.3, 0.07, 0.2, std(0x7d1418), 0.02), shell, -0.55, 0.815, 0.48);
  put(box(0.5, 0.07, 0.16, std(0x8e8e93), 0.02), shell, 0.35, 0.815, 0.48);
  world.led = put(new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff3b30, toneMapped: false })), shell, 0.98, 0.805, 0.48);
  for (const x of [-0.95, -0.35]) put(box(0.38, 0.2, 0.06, std(0x141416), 0.02), shell, x, 0.5, 1.15);
  anchor('console', shell, 1.3, 0.8, 0.9);
  anchor('power', shell, -0.95, 0.86, 0.48);
  world.shell = shell;

  // ---------------- 卡带 ----------------
  const cart = put(new THREE.Group(), con, 0, 1.0, -0.2);
  const yellow = std(0xf0c02c, { roughness: 0.45 });
  const back = put(box(1.6, 1.15, 0.13, yellow, 0.03), cart, 0, 0, -0.066);
  const front = put(new THREE.Group(), cart, 0, 0, 0.066);
  front.add(box(1.6, 1.15, 0.13, yellow, 0.03));
  put(decal(1.3, 0.62, textTexture(['4 合 1', '游戏卡'], { w: 512, h: 244, bg: '#fbfbfd', color: '#1d1d1f', size: 96 })), front, 0, 0.16, 0.067);
  const cpcb = put(new THREE.Group(), cart, 0, -0.1, 0);
  cpcb.add(box(1.36, 0.92, 0.03, std(PCB, { roughness: 0.65 }), 0.005));
  const cchip = (key, w, h, label, x, y) => {
    const m = put(box(w, h, 0.05, chipMat, 0.01), cpcb, x, y, 0.04);
    put(decal(w * 0.9, h * 0.8, textTexture(label, { w: 256, h: Math.round(256 * h * 0.8 / (w * 0.9)), size: 44 })), m, 0, 0, 0.026);
    anchor(key, cpcb, x, y + h / 2, 0.07);
  };
  cchip('prg', 0.56, 0.3, 'PRG', -0.34, 0.2);
  cchip('chr', 0.56, 0.3, 'CHR', 0.34, 0.2);
  cchip('mapper', 0.42, 0.18, 'MAPPER', 0, -0.12);
  const fingers = textTexture('', { w: 256, h: 32 });
  { const g = fingers.image.getContext('2d'); g.fillStyle = '#e0b040'; for (let i = 0; i < 30; i++) g.fillRect(4 + i * 8.3, 0, 5, 32); fingers.needsUpdate = true; }
  put(decal(1.28, 0.14, fingers), cpcb, 0, -0.38, 0.017);
  anchor('fingers', cpcb, 0.5, -0.38, 0.03);
  anchor('cart', cart, 0, 0.62, 0);
  back.castShadow = true;
  world.cart = cart;
  world.cartFront = front;

  // ---------------- 手柄 ----------------
  const pad = put(new THREE.Group(), scene, 2.5, 0, 3.0);
  pad.rotation.y = -0.18;
  put(box(1.5, 0.16, 0.66, std(CREAM), 0.05), pad, 0, 0.08, 0);
  put(box(1.36, 0.012, 0.52, std(RED, { roughness: 0.4 }), 0.004), pad, 0, 0.162, 0);
  const btn = (name, mesh, x, z) => {
    put(mesh, pad, x, 0.185, z);
    mesh.userData.btn = name; mesh.userData.y0 = 0.185;
    world.padButtons.push(mesh);
  };
  const dm = std(DARK, { roughness: 0.5 });
  put(box(0.11, 0.05, 0.11, dm, 0.01), pad, -0.45, 0.185, 0);
  btn('UP', box(0.11, 0.05, 0.12, dm, 0.015), -0.45, -0.115);
  btn('DOWN', box(0.11, 0.05, 0.12, dm, 0.015), -0.45, 0.115);
  btn('LEFT', box(0.12, 0.05, 0.11, dm, 0.015), -0.565, 0);
  btn('RIGHT', box(0.12, 0.05, 0.11, dm, 0.015), -0.335, 0);
  btn('SELECT', box(0.15, 0.04, 0.055, std(0x48484a), 0.018), -0.07, 0.12);
  btn('START', box(0.15, 0.04, 0.055, std(0x48484a), 0.018), 0.13, 0.12);
  for (const [n, x] of [['B', 0.36], ['A', 0.57]]) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 28), std(0x8f1a1f, { roughness: 0.35 }));
    m.castShadow = true;
    btn(n, m, x, 0.06);
  }
  anchor('pad', pad, 0.5, 0.25, -0.3);
  world.pad = pad;

  // 手柄线：从手柄后沿垂到桌面，再接到主机前面的端口
  pad.updateMatrixWorld(true);
  const p0 = new THREE.Vector3(-0.3, 0.08, -0.33).applyMatrix4(pad.matrixWorld);
  const curve = new THREE.CatmullRomCurve3([
    p0, new THREE.Vector3(p0.x - 0.3, 0.04, p0.z - 0.25), new THREE.Vector3(0.4, 0.03, 2.75),
    new THREE.Vector3(-0.7, 0.04, 2.55), new THREE.Vector3(-0.95, 0.3, 2.3), new THREE.Vector3(-0.95, 0.5, 2.16),
  ]);
  const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.028, 8), std(0x2c2c2e, { roughness: 0.6 }));
  cable.castShadow = true;
  scene.add(cable);
  world.cable = curve;
  world.cablePulses = [];
  world.cableGeo = new THREE.SphereGeometry(0.07, 12, 8);
  world.fireCable = (color, reverse = false) => {
    const mesh = new THREE.Mesh(world.cableGeo, new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    scene.add(mesh);
    world.cablePulses.push({ mesh, t: 0, reverse });
  };

  // ---------------- 状态与动画 ----------------
  world.state = { shell: 'closed', cart: 'in', layers: false };
  const damp = (cur, target, k) => cur + (target - cur) * k;
  world.update = (dt) => {
    const k = 1 - Math.exp(-dt * 5);
    const s = world.state;
    shell.position.y = damp(shell.position.y, s.shell === 'closed' ? 0 : 2.0, k);
    shell.visible = s.shell !== 'hidden' || shell.position.y < 1.2;
    if (s.shell === 'hidden' && shell.position.y > 1.2) shell.visible = false;
    const cp = { in: [0, 1.0, -0.2, 0], aside: [2.75, 0.62, 0.1, -0.5], open: [0, 2.3, 0.9, 0.3], up: [0, 2.6, -0.2, 0] }[s.cart];
    cart.position.x = damp(cart.position.x, cp[0], k);
    cart.position.y = damp(cart.position.y, cp[1], k);
    cart.position.z = damp(cart.position.z, cp[2], k);
    cart.rotation.y = damp(cart.rotation.y, cp[3], k);
    front.position.z = damp(front.position.z, s.cart === 'open' ? 0.75 : 0.066, k);
    front.position.x = damp(front.position.x, s.cart === 'open' ? 1.0 : 0, k);
    const lz = s.layers ? 1 : 0;
    world.layerBg.position.z = damp(world.layerBg.position.z, 1.256 + lz * 1.0, k);
    world.layerSpr.position.z = damp(world.layerSpr.position.z, 1.256 + lz * 2.0, k);
    world.layerBg.visible = world.layerSpr.visible = world.layerBg.position.z > 1.3;
    bus.update(dt);
    for (const p of world.cablePulses) {
      p.t += dt / 0.6;
      p.mesh.position.copy(curve.getPoint(p.reverse ? 1 - Math.min(1, p.t) : Math.min(1, p.t)));
      if (p.t >= 1) { scene.remove(p.mesh); p.mesh.material.dispose(); }
    }
    world.cablePulses = world.cablePulses.filter((p) => p.t < 1);
  };
  world.setButtons = (padState) => {
    for (const m of world.padButtons) {
      m.position.y = m.userData.y0 - (padState.held(m.userData.btn) ? 0.022 : 0);
    }
  };
  return world;
}
