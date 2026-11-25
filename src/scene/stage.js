// 舞台：渲染器、环境反射、三点布光、接触阴影、沿球面插值的镜头
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  const key = new THREE.DirectionalLight(0xfff4e6, 2.4);
  key.position.set(6, 11, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 30 });
  key.shadow.bias = -0.0004;
  key.shadow.radius = 5;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xcfe2ff, 0.9);
  rim.position.set(-7, 6, -6);
  scene.add(rim);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d8e0, 0.5));

  // 地面只接阴影，本身透明，融进页面背景
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.16 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  camera.position.set(9, 7, 13);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 2;
  controls.maxDistance = 22;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.target.set(0, 1.2, 0);

  // 镜头飞行：对"相机相对目标的偏移"做球坐标插值，避免穿过模型
  const fly = { on: false, t: 0, dur: 1.2, t0: new THREE.Vector3(), t1: new THREE.Vector3(), s0: new THREE.Spherical(), s1: new THREE.Spherical() };
  const tmp = new THREE.Vector3();
  const sph = new THREE.Spherical();
  controls.addEventListener('start', () => { fly.on = false; });

  function flyTo(pos, target, dur = 1.3) {
    fly.t0.copy(controls.target);
    fly.t1.set(...target);
    fly.s0.setFromVector3(tmp.copy(camera.position).sub(controls.target));
    fly.s1.setFromVector3(tmp.set(...pos).sub(fly.t1));
    let d = fly.s1.theta - fly.s0.theta;
    if (d > Math.PI) fly.s1.theta -= Math.PI * 2;
    if (d < -Math.PI) fly.s1.theta += Math.PI * 2;
    fly.t = 0; fly.dur = dur; fly.on = true;
  }

  let insets = { left: 0, right: 0, top: 0, bottom: 0 };
  let size = { w: 1, h: 1 };
  function applyOffset() {
    const { w, h } = size;
    const sx = (insets.left - insets.right) / 2, sy = (insets.top - insets.bottom) / 2;
    camera.aspect = w / h;
    camera.setViewOffset(w, h, -sx, -sy, w, h);
    camera.updateProjectionMatrix();
  }
  function resize(w, h) { size = { w, h }; renderer.setSize(w, h, false); applyOffset(); }
  function setInsets(i) {
    if (i.left === insets.left && i.right === insets.right && i.top === insets.top && i.bottom === insets.bottom) return;
    insets = i; applyOffset();
  }

  function update(dt) {
    if (fly.on) {
      fly.t = Math.min(1, fly.t + dt / fly.dur);
      const k = 1 - Math.pow(1 - fly.t, 3);
      controls.target.lerpVectors(fly.t0, fly.t1, k);
      sph.radius = fly.s0.radius + (fly.s1.radius - fly.s0.radius) * k;
      sph.phi = fly.s0.phi + (fly.s1.phi - fly.s0.phi) * k;
      sph.theta = fly.s0.theta + (fly.s1.theta - fly.s0.theta) * k;
      camera.position.setFromSpherical(sph).add(controls.target);
      camera.lookAt(controls.target);
      if (fly.t >= 1) fly.on = false;
    } else controls.update();
  }
  const render = () => renderer.render(scene, camera);

  return { renderer, scene, camera, controls, flyTo, resize, setInsets, update, render };
}
