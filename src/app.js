import * as THREE from '../vendor/three.module.min.js';
import { LineSegments2 } from '../vendor/addons/LineSegments2.js';
import { LineSegmentsGeometry } from '../vendor/addons/LineSegmentsGeometry.js';
import { LineMaterial } from '../vendor/addons/LineMaterial.js';
import { SOLIDS, buildSolid } from './solids.js';
import { WALLS, WALL_SIZE as S, rotationMatrix, magnification, dot } from './projection.js';
import { computeView } from './views.js';

// ---------------- 状态 ----------------
const CENTER = [2.5, 2.5, 2.1];
// 点光源：每个投影面前方各有一个投射中心 S_k = C + N_k·d + U_k·a + V_k·b
// light = [d 光源到物体中心的距离, a 左右偏移, b 上下偏移]
const DEFAULT_LIGHT = [3.2, 0.35, 0.45];
const LIGHT_DIST_MAX = 6.2;
const LIGHT_OFF_MAX = 1.6;
const MASK_RES = 1024;
const qs = new URLSearchParams(location.search);
const nums = (s, n) => { if (!s) return null; const a = s.split(',').map(Number); return a.length === n && a.every(Number.isFinite) ? a : null; };
const state = {
  solid: SOLIDS.some((s) => s.id === qs.get('solid')) ? qs.get('solid') : 'cube',
  mode: qs.get('mode') === 'central' ? 'central' : 'ortho',
  views: qs.get('views') === '1',
  rays: qs.get('rays') === '1',
  unfold: qs.get('unfold') === '1',
  shadows: qs.get('shadows') !== '0',
  axes: qs.get('axes') !== '0',
  rot: nums(qs.get('rot'), 3) || [0, 0, 0],
  light: nums(qs.get('light'), 3) || [...DEFAULT_LIGHT],
  panel: qs.get('panel') === '1',
};
let solid = null;

// ---------------- 渲染器与场景 ----------------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0xd9d9d9, 1);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
camera.up.set(0, 0, 1);

const hemi = new THREE.HemisphereLight(0xffffff, 0x9aa0aa, 1.9);
hemi.position.set(0, 0, 1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(9, 7, 14);
scene.add(sun);
const fill = new THREE.DirectionalLight(0xffffff, 0.6);
fill.position.set(-3, 10, 2);
scene.add(fill);

const lineMats = [];
const lineMat = (o) => { const m = new LineMaterial(o); lineMats.push(m); return m; };

// ---------------- 投影墙 ----------------
const maskRT = new THREE.WebGLRenderTarget(MASK_RES, MASK_RES, { samples: 4, depthBuffer: false });
const tmpRT = new THREE.WebGLRenderTarget(MASK_RES, MASK_RES, { depthBuffer: false });
const wallKeys = ['V', 'W', 'H'];
const walls = {};
const wallTint = { V: 0.985, W: 1.0, H: 1.02 };

const wallVS = `
varying vec2 vP; varying vec2 vUv;
void main(){ vUv = uv; vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const wallFS = `
uniform sampler2D uMask; uniform float uShadow; uniform float uTint; uniform float uSize;
varying vec2 vP; varying vec2 vUv;
float grid(vec2 p, float sp, float w){
  vec2 c = p / sp; vec2 fw = fwidth(c);
  vec2 g = abs(fract(c - 0.5) - 0.5) / max(fw, vec2(1e-5));
  float l = 1.0 - clamp(min(g.x, g.y) / w, 0.0, 1.0);
  float fade = clamp(1.6 - max(fw.x, fw.y) * 9.0, 0.0, 1.0);
  return l * fade;
}
void main(){
  vec3 base = vec3(0.80, 0.80, 0.815) * uTint;
  float minor = grid(vP, 0.5, 1.15);
  float major = grid(vP, 2.5, 1.5);
  vec3 col = mix(base, vec3(0.94, 0.94, 0.95), minor * 0.85);
  col = mix(col, vec3(0.50, 0.51, 0.54), major * 0.75);
  float d = max(abs(vP.x), abs(vP.y));
  float a = 0.9 * smoothstep(uSize, uSize * 0.78, d);
  float m = texture2D(uMask, vUv).r * uShadow;
  col = mix(col, vec3(0.96, 0.42, 0.39), m * 0.66);
  a = max(a, m * 0.85);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

const labelTex = (text, color = '#3e587e', size = 120) => {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = `700 ${size}px -apple-system, "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 40;
  c.width = w; c.height = Math.ceil(size * 1.35);
  ctx.font = font; ctx.fillStyle = color; ctx.textBaseline = 'middle';
  ctx.fillText(text, 20, c.height / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return { tex: t, aspect: c.width / c.height };
};
const labelMesh = (text, h, opts = {}) => {
  const { tex, aspect } = labelTex(text, opts.color, opts.size);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(h * aspect, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: opts.opacity ?? 0.92 }));
  m.renderOrder = 2;
  return m;
};

const LABEL_POS = { V: [-CENTER[0] - 0.9, 0.42], W: [CENTER[1] + 0.9, 0.42], H: [-CENTER[0] - 0.4, -CENTER[1] - 2.2] };
for (const k of wallKeys) {
  const w = WALLS[k];
  const pivot = new THREE.Group();
  const frame = new THREE.Group();
  frame.matrixAutoUpdate = false;
  frame.matrix.makeBasis(new THREE.Vector3(...w.U), new THREE.Vector3(...w.V), new THREE.Vector3(...w.N));
  pivot.add(frame);
  scene.add(pivot);
  const rt = new THREE.WebGLRenderTarget(MASK_RES, MASK_RES, { depthBuffer: false });
  const g = new THREE.PlaneGeometry(S, S);
  g.translate(w.uvMin[0] + S / 2, w.uvMin[1] + S / 2, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMask: { value: rt.texture }, uShadow: { value: 1 }, uTint: { value: wallTint[k] }, uSize: { value: S } },
    vertexShader: wallVS, fragmentShader: wallFS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    extensions: { derivatives: true },
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.renderOrder = 0;
  frame.add(mesh);
  const label = labelMesh(w.name, k === 'H' ? 0.5 : 0.48);
  label.position.set(LABEL_POS[k][0], LABEL_POS[k][1], 0.01);
  frame.add(label);
  const visMat = lineMat({ color: 0x1d2b45, linewidth: 2.3, worldUnits: false });
  const hidMat = lineMat({ color: 0x1d2b45, linewidth: 1.7, worldUnits: false, dashed: true, dashSize: 0.11, gapSize: 0.075 });
  const vis = new LineSegments2(new LineSegmentsGeometry(), visMat);
  const hid = new LineSegments2(new LineSegmentsGeometry(), hidMat);
  vis.renderOrder = hid.renderOrder = 3;
  vis.frustumCulled = hid.frustumCulled = false;
  frame.add(hid, vis);
  walls[k] = { def: w, pivot, frame, rt, mat, mesh, vis, hid, label };
}

// 坐标轴
const axes = new THREE.Group();
scene.add(axes);
const axisLine = (to, color, width, opacity) => {
  const g = new LineSegmentsGeometry(); g.setPositions([0, 0, 0, ...to]);
  const m = lineMat({ color, linewidth: width, worldUnits: false, transparent: opacity < 1, opacity });
  const l = new LineSegments2(g, m); l.frustumCulled = false; l.renderOrder = 4; return l;
};
axes.add(axisLine([0, 0, S * 0.66], 0x3d72d9, 2.2, 1));
axes.add(axisLine([S * 0.92, 0, 0], 0xe0524a, 1.8, 0.55));
axes.add(axisLine([0, S * 0.92, 0], 0x3fae5c, 1.8, 0.55));
const axisLetter = (t, color, pos) => {
  const { tex, aspect } = labelTex(t, color, 110);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  sp.scale.set(0.34 * aspect, 0.34, 1); sp.position.set(...pos); sp.renderOrder = 5; axes.add(sp);
};
axisLetter('z', '#3d72d9', [0, 0, S * 0.66 + 0.3]);
axisLetter('x', '#d0473f', [S * 0.92 + 0.3, 0, 0.1]);
axisLetter('y', '#2f9a4d', [0, S * 0.92 + 0.3, 0.1]);

// ---------------- 物体 ----------------
const objGroup = new THREE.Group();
objGroup.position.set(...CENTER);
scene.add(objGroup);
const objMat = new THREE.MeshStandardMaterial({ color: 0x2f6fe8, roughness: 0.48, metalness: 0.02, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, transparent: true, opacity: 1 });
const objMesh = new THREE.Mesh(new THREE.BufferGeometry(), objMat);
objGroup.add(objMesh);
const edgeMat = lineMat({ color: 0xff8b1e, linewidth: 2.6, worldUnits: false, transparent: true, opacity: 1 });
const objEdges = new LineSegments2(new LineSegmentsGeometry(), edgeMat);
objEdges.frustumCulled = false;
objGroup.add(objEdges);

// 点光源（发光灯泡，每个投影面一个）
const bulbs = {};
const bulbGroup = new THREE.Group();
scene.add(bulbGroup);
const glowTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const gr = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,248,214,1)'); gr.addColorStop(0.22, 'rgba(255,214,92,0.85)'); gr.addColorStop(0.55, 'rgba(255,170,40,0.25)'); gr.addColorStop(1, 'rgba(255,160,40,0)');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
})();
const coreGeo = new THREE.SphereGeometry(0.14, 24, 16);
const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff3b8 });
const dropMat = new THREE.LineDashedMaterial({ color: 0x9a7420, dashSize: 0.12, gapSize: 0.09, transparent: true, opacity: 0.55 });
for (const k of ['V', 'W', 'H']) {
  const g = new THREE.Group();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, depthWrite: false, transparent: true }));
  glow.scale.set(1.25, 1.25, 1); glow.renderOrder = 6;
  g.add(glow, new THREE.Mesh(coreGeo, coreMat));
  bulbGroup.add(g);
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
  const drop = new THREE.LineSegments(dg, dropMat); drop.frustumCulled = false;
  bulbGroup.add(drop);
  bulbs[k] = { g, drop };
}
function lightPos(k) {
  const w = WALLS[k], [d, a, b] = state.light;
  return [0, 1, 2].map((i) => CENTER[i] + w.N[i] * d + w.U[i] * a + w.V[i] * b);
}

// 投射线
const MAX_KEYS = 16;
const rayPos = new Float32Array(MAX_KEYS * 3 * 2 * 3);
const rayGeo = new THREE.BufferGeometry();
rayGeo.setAttribute('position', new THREE.BufferAttribute(rayPos, 3));
const rays = new THREE.LineSegments(rayGeo, new THREE.LineBasicMaterial({ color: 0xe5483d, transparent: true, opacity: 0.5, depthWrite: false }));
rays.frustumCulled = false; rays.renderOrder = 7;
scene.add(rays);

// ---------------- 投影遮罩（离屏渲染：并集、裁剪、柔边） ----------------
const maskScene = new THREE.Scene();
const maskMat = new THREE.ShaderMaterial({
  uniforms: { uU: { value: new THREE.Vector3() }, uV: { value: new THREE.Vector3() }, uN: { value: new THREE.Vector3() }, uL: { value: new THREE.Vector3() }, uCentral: { value: 0 }, uMin: { value: new THREE.Vector2() }, uSize: { value: S } },
  vertexShader: `
    uniform vec3 uU, uV, uN, uL; uniform float uCentral; uniform vec2 uMin; uniform float uSize;
    void main(){
      vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
      vec3 q;
      if (uCentral > 0.5) { vec3 d = p - uL; q = uL - d * (dot(uN, uL) / dot(uN, d)); }
      else { q = p - dot(uN, p) * uN; }
      vec2 uv = vec2(dot(q, uU), dot(q, uV));
      gl_Position = vec4((uv - uMin) / uSize * 2.0 - 1.0, 0.0, 1.0);
    }`,
  fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }',
  side: THREE.DoubleSide, depthTest: false, depthWrite: false,
});
const maskMesh = new THREE.Mesh(new THREE.BufferGeometry(), maskMat);
maskMesh.frustumCulled = false; maskMesh.matrixAutoUpdate = false;
maskScene.add(maskMesh);
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const blurMat = new THREE.ShaderMaterial({
  uniforms: { uTex: { value: null }, uDir: { value: new THREE.Vector2() } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `uniform sampler2D uTex; uniform vec2 uDir; varying vec2 vUv;
    void main(){
      float s = texture2D(uTex, vUv).r * 0.2270270;
      s += (texture2D(uTex, vUv + uDir * 1.3846154).r + texture2D(uTex, vUv - uDir * 1.3846154).r) * 0.3162162;
      s += (texture2D(uTex, vUv + uDir * 3.2307692).r + texture2D(uTex, vUv - uDir * 3.2307692).r) * 0.0702703;
      gl_FragColor = vec4(s, s, s, 1.0);
    }`,
  depthTest: false, depthWrite: false,
});
const quadScene = new THREE.Scene();
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blurMat);
quad.frustumCulled = false;
quadScene.add(quad);
const clearBlack = new THREE.Color(0x000000);
const clearBg = new THREE.Color(0xd9d9d9);

function renderMasks() {
  maskMesh.matrix.copy(objMesh.matrixWorld);
  maskMat.uniforms.uCentral.value = state.mode === 'central' ? 1 : 0;
  renderer.setClearColor(clearBlack, 1);
  for (const k of wallKeys) {
    const w = walls[k].def;
    const u = maskMat.uniforms;
    u.uU.value.set(...w.U); u.uV.value.set(...w.V); u.uN.value.set(...w.N); u.uMin.value.set(...w.uvMin);
    u.uL.value.set(...lightPos(k));
    renderer.setRenderTarget(maskRT); renderer.clear(); renderer.render(maskScene, quadCam);
    blurMat.uniforms.uTex.value = maskRT.texture; blurMat.uniforms.uDir.value.set(0.55 / MASK_RES, 0);
    renderer.setRenderTarget(tmpRT); renderer.render(quadScene, quadCam);
    blurMat.uniforms.uTex.value = tmpRT.texture; blurMat.uniforms.uDir.value.set(0, 0.55 / MASK_RES);
    renderer.setRenderTarget(walls[k].rt); renderer.render(quadScene, quadCam);
  }
  renderer.setRenderTarget(null);
  renderer.setClearColor(clearBg, 1);
}

// ---------------- 物体更新、三视图线、投射线 ----------------
let worldVerts = new Float32Array(0), worldNormals = new Float32Array(0), keyLocal = [];
const lastViews = {};

function pickKeyVertices(s) {
  const pts = [];
  const seen = new Set();
  const src = s.featureLines.length ? s.featureLines : s.verts;
  for (let i = 0; i < src.length; i += 3) {
    const key = `${src[i].toFixed(3)},${src[i + 1].toFixed(3)},${src[i + 2].toFixed(3)}`;
    if (!seen.has(key)) { seen.add(key); pts.push([src[i], src[i + 1], src[i + 2]]); }
  }
  if (pts.length <= MAX_KEYS) return pts;
  // 最远点采样，取分布最开的点
  const out = [pts.reduce((a, b) => (b[2] - b[0] - b[1] > a[2] - a[0] - a[1] ? b : a))];
  const dmin = pts.map((p) => Math.hypot(p[0] - out[0][0], p[1] - out[0][1], p[2] - out[0][2]));
  while (out.length < MAX_KEYS) {
    let bi = 0; for (let i = 1; i < pts.length; i++) if (dmin[i] > dmin[bi]) bi = i;
    out.push(pts[bi]);
    for (let i = 0; i < pts.length; i++) dmin[i] = Math.min(dmin[i], Math.hypot(pts[i][0] - pts[bi][0], pts[i][1] - pts[bi][1], pts[i][2] - pts[bi][2]));
  }
  return out;
}

function lightMin() { return [solid.radius + 0.35, -LIGHT_OFF_MAX, -LIGHT_OFF_MAX]; }
function lightMax() { return [LIGHT_DIST_MAX, LIGHT_OFF_MAX, LIGHT_OFF_MAX]; }
function clampLight() { const mn = lightMin(), mx = lightMax(); state.light = state.light.map((v, i) => Math.min(mx[i], Math.max(mn[i], v))); }

function setSolid(id) {
  state.solid = id;
  solid = buildSolid(id);
  objMesh.geometry.dispose();
  objMesh.geometry = solid.geometry;
  maskMesh.geometry = solid.geometry;
  objEdges.geometry.dispose();
  const eg = new LineSegmentsGeometry();
  if (solid.featureLines.length) eg.setPositions(solid.featureLines);
  objEdges.geometry = eg;
  objEdges.visible = solid.featureLines.length > 0;
  worldVerts = new Float32Array(solid.verts.length);
  worldNormals = new Float32Array(solid.triNormals.length);
  keyLocal = pickKeyVertices(solid);
  clampLight();
  dirty.object = true;
}

function updateObject() {
  const r = Math.PI / 180;
  objGroup.rotation.set(state.rot[0] * r, state.rot[1] * r, state.rot[2] * r, 'XYZ');
  objGroup.updateMatrixWorld(true);
  for (const k of ['V', 'W', 'H']) {
    const L = lightPos(k), n = WALLS[k].N, d = dot(n, L);
    bulbs[k].g.position.set(...L);
    const a = bulbs[k].drop.geometry.attributes.position;
    a.array.set([...L, L[0] - d * n[0], L[1] - d * n[1], L[2] - d * n[2]]); a.needsUpdate = true;
    bulbs[k].drop.computeLineDistances();
  }
  if (state.shadows) renderMasks();
  updateViews();
  updateRays();
  updateUIValues();
}

function rotatedWorld() {
  const m = rotationMatrix(...state.rot);
  const v = solid.verts, n = solid.triNormals;
  for (let i = 0; i < v.length; i += 3) {
    const x = v[i], y = v[i + 1], z = v[i + 2];
    worldVerts[i] = m[0] * x + m[1] * y + m[2] * z + CENTER[0];
    worldVerts[i + 1] = m[3] * x + m[4] * y + m[5] * z + CENTER[1];
    worldVerts[i + 2] = m[6] * x + m[7] * y + m[8] * z + CENTER[2];
  }
  for (let i = 0; i < n.length; i += 3) {
    const x = n[i], y = n[i + 1], z = n[i + 2];
    worldNormals[i] = m[0] * x + m[1] * y + m[2] * z;
    worldNormals[i + 1] = m[3] * x + m[4] * y + m[5] * z;
    worldNormals[i + 2] = m[6] * x + m[7] * y + m[8] * z;
  }
  return m;
}

function setSegs(line, uv) {
  if (!uv.length) { line.visible = false; return; }
  const p = new Float32Array((uv.length / 2) * 3);
  for (let i = 0, j = 0; i < uv.length; i += 2, j += 3) { p[j] = uv[i]; p[j + 1] = uv[i + 1]; p[j + 2] = 0.015; }
  line.geometry.dispose();
  const g = new LineSegmentsGeometry();
  g.setPositions(p);
  line.geometry = g;
  line.computeLineDistances();
  line.visible = true;
}

function updateViews() {
  const show = state.views;
  for (const k of wallKeys) { walls[k].vis.visible = walls[k].hid.visible = false; }
  if (!show) return;
  rotatedWorld();
  for (const k of wallKeys) {
    const res = computeView(solid, worldVerts, worldNormals, walls[k].def);
    lastViews[k] = { visible: res.visible.length / 4, hidden: res.hidden.length / 4 };
    setSegs(walls[k].hid, res.hidden);
    setSegs(walls[k].vis, res.visible);
  }
}

function updateRays() {
  rays.visible = state.rays && !state.unfold;
  if (!rays.visible) return;
  const m = rotationMatrix(...state.rot);
  const LS = { V: lightPos('V'), W: lightPos('W'), H: lightPos('H') };
  let o = 0;
  for (const p0 of keyLocal) {
    const p = [m[0] * p0[0] + m[1] * p0[1] + m[2] * p0[2] + CENTER[0], m[3] * p0[0] + m[4] * p0[1] + m[5] * p0[2] + CENTER[1], m[6] * p0[0] + m[7] * p0[1] + m[8] * p0[2] + CENTER[2]];
    for (const k of wallKeys) {
      const n = WALLS[k].N;
      let a, q;
      if (state.mode === 'central') {
        const L = LS[k];
        const nl = dot(n, L), np = dot(n, p); const t = nl / (nl - np);
        a = L; q = [L[0] + t * (p[0] - L[0]), L[1] + t * (p[1] - L[1]), L[2] + t * (p[2] - L[2])];
      } else {
        const d = dot(n, p); a = p; q = [p[0] - d * n[0], p[1] - d * n[1], p[2] - d * n[2]];
      }
      rayPos.set(a, o); rayPos.set(q, o + 3); o += 6;
    }
  }
  rayGeo.setDrawRange(0, o / 3);
  rayGeo.attributes.position.needsUpdate = true;
}

// ---------------- 相机（单指旋转、双指缩放） ----------------
const cam = { theta: 45, phi: 17, dist: 15, target: new THREE.Vector3(2.0, 2.0, 2.05) };
const camGoal = null;
function defaultCam() {
  const aspect = innerWidth / innerHeight;
  const d = aspect < 1 ? 13.2 / Math.max(0.5, aspect * 1.42) : 14.5;
  return { theta: 45, phi: 19, dist: Math.min(d, 22), target: new THREE.Vector3(2.2, 2.2, 2.4) };
}
const unfoldCam = () => { const aspect = innerWidth / innerHeight; return { theta: 90, phi: 0, dist: aspect < 1 ? 15.5 / Math.max(0.42, aspect) : 21, target: new THREE.Vector3(0, 0, 0.4) }; };
let camAnim = null;
function animateCamTo(goal, ms = 700) { camAnim = { from: { theta: cam.theta, phi: cam.phi, dist: cam.dist, target: cam.target.clone() }, to: goal, t0: performance.now(), ms }; }
const lim = () => (state.unfold ? { t: [60, 120], p: [-25, 35], d: [8, 60] } : { t: [8, 82], p: [-4, 78], d: [5, 32] });
function clampCam() {
  const l = lim();
  cam.theta = Math.min(l.t[1], Math.max(l.t[0], cam.theta));
  cam.phi = Math.min(l.p[1], Math.max(l.p[0], cam.phi));
  cam.dist = Math.min(l.d[1], Math.max(l.d[0], cam.dist));
}
let viewShift = 0, viewShiftGoal = 0;
function applyCam() {
  const t = (cam.theta * Math.PI) / 180, p = (cam.phi * Math.PI) / 180;
  camera.position.set(cam.target.x + cam.dist * Math.cos(p) * Math.cos(t), cam.target.y + cam.dist * Math.cos(p) * Math.sin(t), cam.target.z + cam.dist * Math.sin(p));
  camera.lookAt(cam.target);
  const w = innerWidth, h = innerHeight;
  const wide = w >= 760;
  if (Math.abs(viewShift) > 0.5) camera.setViewOffset(w, h, wide ? viewShift : 0, wide ? 0 : viewShift, w, h); else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}

const pointers = new Map();
let pinch0 = 0, dist0 = 0, tapT = 0, moved = 0;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  camAnim = null; moved = 0;
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); dist0 = cam.dist; }
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  moved += Math.abs(dx) + Math.abs(dy);
  if (pointers.size === 1) {
    cam.theta -= dx * 0.32; cam.phi += dy * 0.28;
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch0 > 0) cam.dist = dist0 * (pinch0 / Math.max(d, 1));
  }
  clampCam(); needsRender = true;
});
const up = (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size === 1) { pinch0 = 0; }
  if (pointers.size === 0 && moved < 6) {
    const now = performance.now();
    if (now - tapT < 320) animateCamTo(state.unfold ? unfoldCam() : defaultCam());
    tapT = now;
  }
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist *= Math.exp(e.deltaY * 0.0012); clampCam(); needsRender = true; }, { passive: false });

// ---------------- 展开动画 ----------------
let unfoldK = state.unfold ? 1 : 0;
function applyUnfold() {
  const e = unfoldK < 0.5 ? 2 * unfoldK * unfoldK : 1 - Math.pow(-2 * unfoldK + 2, 2) / 2;
  walls.H.pivot.rotation.x = (-Math.PI / 2) * e;
  walls.W.pivot.rotation.z = (Math.PI / 2) * e;
  const fade = 1 - Math.min(1, unfoldK * 2.2);
  objMat.opacity = fade; edgeMat.opacity = fade;
  objGroup.visible = fade > 0.01;
  objMat.depthWrite = fade > 0.99;
  bulbGroup.visible = state.mode === 'central' && fade > 0.01;
  axes.visible = state.axes && unfoldK < 0.02;
}

// ---------------- 界面 ----------------
const $ = (id) => document.getElementById(id);
const sel = $('solid');
{
  const groups = {};
  SOLIDS.forEach((s, i) => { (groups[s.group] ||= []).push([s, i]); });
  for (const [g, list] of Object.entries(groups)) {
    const og = document.createElement('optgroup'); og.label = g;
    for (const [s, i] of list) { const o = document.createElement('option'); o.value = s.id; o.textContent = `${s.name}`; og.appendChild(o); }
    sel.appendChild(og);
  }
}
sel.addEventListener('change', () => { setSolid(sel.value); });

const segBtns = [...document.querySelectorAll('#mode button')];
segBtns.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.v)));
function setMode(m) { state.mode = m; dirty.object = true; syncUI(); }

const bindSwitch = (id, key, after) => {
  const el = $(id);
  el.checked = state[key];
  el.addEventListener('change', () => { state[key] = el.checked; if (after) after(); dirty.object = true; syncUI(); });
};
bindSwitch('views', 'views');
bindSwitch('rays', 'rays');
bindSwitch('shadows', 'shadows');
bindSwitch('axes', 'axes');
bindSwitch('unfold', 'unfold', () => { if (state.unfold && !state.views) { state.views = true; $('views').checked = true; } animateCamTo(state.unfold ? unfoldCam() : defaultCam(), 900); });

const rotInputs = ['rx', 'ry', 'rz'].map((id) => $(id));
rotInputs.forEach((el, i) => el.addEventListener('input', () => { state.rot[i] = Number(el.value); dirty.object = true; }));
$('resetRot').addEventListener('click', () => { state.rot = [0, 0, 0]; dirty.object = true; syncUI(); });
const lightInputs = ['lx', 'ly', 'lz'].map((id) => $(id));
lightInputs.forEach((el, i) => el.addEventListener('input', () => { state.light[i] = Number(el.value); clampLight(); dirty.object = true; }));
$('resetLight').addEventListener('click', () => { state.light = [...DEFAULT_LIGHT]; clampLight(); dirty.object = true; syncUI(); });
$('resetView').addEventListener('click', () => animateCamTo(state.unfold ? unfoldCam() : defaultCam()));

const sheet = $('sheet');
function setPanel(open) {
  state.panel = open;
  sheet.classList.toggle('open', open);
  updateShift();
}
function updateShift() {
  const h = innerHeight;
  if (innerWidth >= 760) { viewShiftGoal = state.panel ? sheet.getBoundingClientRect().width * 0.5 : 0; return; }
  const covered = state.panel ? sheet.getBoundingClientRect().height : 90;
  viewShiftGoal = Math.max(0, Math.min(h * 0.32, covered * (state.panel ? 0.4 : 0.3)));
}
{
  const grab = $('grab');
  let y0 = null;
  grab.addEventListener('pointerdown', (e) => { y0 = e.clientY; });
  grab.addEventListener('pointerup', (e) => {
    if (y0 == null) return;
    const dy = e.clientY - y0; y0 = null;
    if (dy < -18) setPanel(true); else if (dy > 18) setPanel(false); else setPanel(!state.panel);
  });
}

const fmtDeg = (v) => `${Math.round(v)}°`;
function setRange(el, v) { el.value = v; const p = ((v - el.min) / (el.max - el.min)) * 100; el.style.setProperty('--p', `${p}%`); }
function updateUIValues() {
  rotInputs.forEach((el, i) => { setRange(el, state.rot[i]); $(el.id + 'v').textContent = fmtDeg(state.rot[i]); });
  const mn = lightMin(), mx = lightMax();
  lightInputs.forEach((el, i) => { el.min = mn[i].toFixed(2); el.max = mx[i]; setRange(el, state.light[i]); $(el.id + 'v').textContent = state.light[i].toFixed(1); });
  if (state.mode === 'central') {
    const m = wallKeys.map((k) => magnification(lightPos(k), dot(WALLS[k].N, CENTER), WALLS[k]));
    $('mag').textContent = `物体中心截面放大倍数：主视图 ×${m[0].toFixed(2)} · 左视图 ×${m[1].toFixed(2)} · 俯视图 ×${m[2].toFixed(2)}`;
  }
}
function syncUI() {
  sel.value = state.solid;
  const ci = state.mode === 'central' ? 1 : 0;
  $('mode').style.setProperty('--i', ci);
  segBtns.forEach((b, i) => b.classList.toggle('on', i === ci));
  $('lightBox').hidden = state.mode !== 'central';
  for (const id of ['views', 'rays', 'shadows', 'axes', 'unfold']) $(id).checked = state[id];
  for (const k of wallKeys) walls[k].mat.uniforms.uShadow.value = state.shadows ? 1 : 0;
  updateUIValues();
  requestAnimationFrame(updateShift);
}

// ---------------- 主循环（按需渲染） ----------------
const dirty = { object: true };
let needsRender = true;
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  camera.aspect = w / h;
  const pr = renderer.getPixelRatio();
  for (const m of lineMats) m.resolution.set(w * pr, h * pr);
  updateShift();
  needsRender = true;
}
addEventListener('resize', resize);

function frame(now) {
  requestAnimationFrame(frame);
  if (camAnim) {
    const k = Math.min(1, (now - camAnim.t0) / camAnim.ms);
    const e = 1 - Math.pow(1 - k, 3);
    const f = camAnim.from, g = camAnim.to;
    cam.theta = f.theta + (g.theta - f.theta) * e; cam.phi = f.phi + (g.phi - f.phi) * e; cam.dist = f.dist + (g.dist - f.dist) * e;
    cam.target.lerpVectors(f.target, g.target, e);
    if (k >= 1) camAnim = null;
    needsRender = true;
  }
  const uGoal = state.unfold ? 1 : 0;
  if (unfoldK !== uGoal) { unfoldK += Math.sign(uGoal - unfoldK) * Math.min(Math.abs(uGoal - unfoldK), 1 / 50); needsRender = true; }
  if (Math.abs(viewShift - viewShiftGoal) > 0.3) { viewShift += (viewShiftGoal - viewShift) * 0.18; needsRender = true; }
  if (dirty.object) { dirty.object = false; updateObject(); needsRender = true; }
  if (!needsRender) return;
  needsRender = false;
  applyUnfold();
  applyCam();
  renderer.render(scene, camera);
  if (window.__pv) window.__pv.frames++;
}

// ---------------- 启动 ----------------
setSolid(state.solid);
Object.assign(cam, defaultCam());
if (state.unfold) Object.assign(cam, unfoldCam());
resize();
syncUI();
setPanel(state.panel);
viewShift = viewShiftGoal;
requestAnimationFrame(frame);

window.__pv = {
  ready: true, frames: 0, state, lastViews,
  set(p) { Object.assign(state, p); if (p.solid) setSolid(p.solid); if (p.light) clampLight(); if ('unfold' in p) animateCamTo(state.unfold ? unfoldCam() : defaultCam(), 10); dirty.object = true; syncUI(); },
  setPanel,
  solids: SOLIDS.map((s) => s.id),
};
