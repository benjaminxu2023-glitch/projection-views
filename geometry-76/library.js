/* geometry-76 模型库 → 主页引擎（src/app.js）的适配层。
 * 必须在 geometry.js、csg.js、advanced.js 之后、app.min.js 之前加载；导出 window.PV_LIBRARY。
 * 坐标约定：geometry-76 的主视图从 -Y 方向看、左视图从 -X 方向看；主页引擎主视图从 +Y 看、左视图从 +X 看（都是 Z 向上、
 * 第一角画法）。两者相差绕 Z 轴转 180°：(x, y, z) -> (-x, -y, z)，这是刚体旋转，不改变面的朝向。
 * 居中与缩放（最大尺寸 = 2）由引擎统一做。 */
const PVLibrary = (() => {
  const catalogue = Geometry.catalogue;
  const cache = new Map();
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  function components(v, f) {
    const parent = v.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
    for (const face of f) for (let k = 1; k < face.length; k++) { const a = find(face[0]), b = find(face[k]); if (a !== b) parent[a] = b; }
    const groups = new Map();
    for (const face of f) { const r = find(face[0]); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(face); }
    return [...groups.values()];
  }
  function signedVolume(v, faces) {
    let s = 0;
    for (const face of faces) for (let k = 1; k + 1 < face.length; k++) s += dot(v[face[0]], cross(v[face[k]], v[face[k + 1]])) / 6;
    return s;
  }
  // 基础 76：各连通部件统一为外法线；回转体（smooth）整块标为同一光滑曲面；
  // 叠放的组合体（多个部件互相嵌入）先用 SolidCSG 求并集，去掉埋在内部的面。
  function prepareBasic(m) {
    const comps = components(m.v, m.f).map((faces) => (signedVolume(m.v, faces) < 0 ? faces.map((x) => [...x].reverse()) : faces));
    const tagOf = () => (m.smooth ? SolidCSG.newSurface() : -1);
    if (comps.length === 1) { const t = tagOf(); return { v: m.v, f: comps[0], s: comps[0].map(() => t), unioned: false }; }
    const solids = comps.map((faces) => SolidCSG.fromMesh(m.v, faces, tagOf()));
    const u = solids.reduce((a, b) => a.union(b)).mesh();
    return { v: u.v, f: u.f, s: u.s, unioned: true };
  }
  function mesh(id) {
    if (cache.has(id)) return cache.get(id);
    const item = catalogue.find((x) => x.id === id);
    if (!item) throw new Error('未知模型：' + id);
    const raw = item.build();
    const m = item.number ? { v: raw.v, f: raw.f, s: raw.s, unioned: false } : prepareBasic(raw);
    const out = { v: m.v.map((p) => [-p[0], -p[1], p[2]]), f: m.f, s: m.s, unioned: m.unioned };
    cache.set(id, out);
    return out;
  }
  const items = catalogue.map((x) => ({ id: x.id, name: x.name, group: x.group, number: x.number || 0, level: x.level || 0, topic: x.topic || '', focus: x.focus || '', task: x.task || '', advanced: !!x.number }));
  const byId = new Map(items.map((x) => [x.id, x]));
  return {
    items, defaultId: 'mech-001',
    has: (id) => byId.has(id), meta: (id) => byId.get(id), mesh,
    // 由页面面板（panel.js）填写：mount 在引擎启动后调用一次；onSolid 在每次换模型后调用
    mount: null, onSolid: null,
  };
})();
if (typeof window !== 'undefined') window.PV_LIBRARY = PVLibrary;
