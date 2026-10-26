// 三视图的可见线 / 不可见线计算（纯 JS）
// 观察者在面法线 N 的正方向无穷远处，沿 -N 看向投影面（第一角画法）。
// 输入的 verts / triNormals 是已经旋转、平移到世界坐标的数据。

const GRID = 40;

export function computeView(solid, verts, triNormals, wall) {
  const { tris, edges } = solid;
  const U = wall.U, V = wall.V, N = wall.N;
  const nV = verts.length / 3, nT = tris.length / 3;
  const pu = new Float64Array(nV), pv = new Float64Array(nV), pd = new Float64Array(nV);
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (let i = 0; i < nV; i++) {
    const x = verts[i * 3], y = verts[i * 3 + 1], z = verts[i * 3 + 2];
    pu[i] = x * U[0] + y * U[1] + z * U[2];
    pv[i] = x * V[0] + y * V[1] + z * V[2];
    pd[i] = x * N[0] + y * N[1] + z * N[2];
    if (pu[i] < umin) umin = pu[i]; if (pu[i] > umax) umax = pu[i];
    if (pv[i] < vmin) vmin = pv[i]; if (pv[i] > vmax) vmax = pv[i];
  }
  const span = Math.max(umax - umin, vmax - vmin, 1e-6);
  const cw = (umax - umin) / GRID + 1e-9, ch = (vmax - vmin) / GRID + 1e-9;
  const cells = Array.from({ length: GRID * GRID }, () => []);
  const triArea = new Float64Array(nT);
  for (let t = 0; t < nT; t++) {
    const a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2];
    const area = (pu[b] - pu[a]) * (pv[c] - pv[a]) - (pu[c] - pu[a]) * (pv[b] - pv[a]);
    triArea[t] = area;
    if (Math.abs(area) < 1e-9 * span * span) continue; // 侧对观察者的面，投影成线，不会遮挡
    const u0 = Math.min(pu[a], pu[b], pu[c]), u1 = Math.max(pu[a], pu[b], pu[c]);
    const v0 = Math.min(pv[a], pv[b], pv[c]), v1 = Math.max(pv[a], pv[b], pv[c]);
    const i0 = Math.max(0, Math.floor((u0 - umin) / cw)), i1 = Math.min(GRID - 1, Math.floor((u1 - umin) / cw));
    const j0 = Math.max(0, Math.floor((v0 - vmin) / ch)), j1 = Math.min(GRID - 1, Math.floor((v1 - vmin) / ch));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cells[j * GRID + i].push(t);
  }
  const epsD = 1e-3 * span, epsB = -1e-7;

  function occluded(u, v, d, t1, t2) {
    const i = Math.min(GRID - 1, Math.max(0, Math.floor((u - umin) / cw)));
    const j = Math.min(GRID - 1, Math.max(0, Math.floor((v - vmin) / ch)));
    const list = cells[j * GRID + i];
    for (let k = 0; k < list.length; k++) {
      const t = list[k];
      if (t === t1 || t === t2) continue;
      const a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2];
      const area = triArea[t];
      const w0 = ((pu[b] - u) * (pv[c] - v) - (pu[c] - u) * (pv[b] - v)) / area;
      if (w0 < epsB) continue;
      const w1 = ((pu[c] - u) * (pv[a] - v) - (pu[a] - u) * (pv[c] - v)) / area;
      if (w1 < epsB) continue;
      const w2 = 1 - w0 - w1;
      if (w2 < epsB) continue;
      const dt = w0 * pd[a] + w1 * pd[b] + w2 * pd[c];
      if (dt > d + epsD) return true;
    }
    return false;
  }

  const vis = [], hid = [];
  const step = span / 120;
  for (let e = 0; e < edges.length; e += 5) {
    const a = edges[e], b = edges[e + 1], t1 = edges[e + 2], t2 = edges[e + 3], kind = edges[e + 4];
    if (kind === 0) {
      // 光滑边：只有在轮廓处（一侧朝向观察者、一侧背向）才画
      const s1 = triNormals[t1 * 3] * N[0] + triNormals[t1 * 3 + 1] * N[1] + triNormals[t1 * 3 + 2] * N[2];
      const s2 = triNormals[t2 * 3] * N[0] + triNormals[t2 * 3 + 1] * N[1] + triNormals[t2 * 3 + 2] * N[2];
      if ((s1 > 1e-9) === (s2 > 1e-9)) continue;
    }
    const du = pu[b] - pu[a], dv = pv[b] - pv[a];
    const len = Math.hypot(du, dv);
    if (len < 1e-6 * span) continue; // 垂直于投影面的棱，投影成一个点
    const n = Math.min(200, Math.max(2, Math.ceil(len / step)));
    let prev = null, start = 0;
    for (let i = 0; i <= n; i++) {
      let state = null;
      if (i < n) {
        const s = (i + 0.5) / n;
        state = occluded(pu[a] + du * s, pv[a] + dv * s, pd[a] + (pd[b] - pd[a]) * s, t1, t2);
      }
      if (i === 0) { prev = state; continue; }
      if (state !== prev) {
        const end = i / n;
        const out = prev ? hid : vis;
        out.push(pu[a] + du * start, pv[a] + dv * start, pu[a] + du * end, pv[a] + dv * end);
        start = end; prev = state;
      }
    }
  }
  return { visible: vis, hidden: hid };
}
