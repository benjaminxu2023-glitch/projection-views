// 投影数学（纯函数，不依赖 Three.js，可在 Node 中测试）
// 世界坐标：Z 轴向上；三个投影面都过原点：
//   V 面（正面 / 主视图）：y = 0，物体在 y > 0 一侧
//   W 面（侧面 / 左视图）：x = 0，物体在 x > 0 一侧
//   H 面（水平面 / 俯视图）：z = 0，物体在 z > 0 一侧

export const WALL_SIZE = 9;

// 每个面的局部坐标系 (U, V, N)，右手系，N 指向物体一侧。
// u、v 范围在 uvMin .. uvMin + WALL_SIZE 之间。
export const WALLS = {
  V: { key: 'V', name: '正面（主视图）', U: [-1, 0, 0], V: [0, 0, 1], N: [0, 1, 0], uvMin: [-WALL_SIZE, 0] },
  W: { key: 'W', name: '侧面（左视图）', U: [0, 1, 0], V: [0, 0, 1], N: [1, 0, 0], uvMin: [0, 0] },
  H: { key: 'H', name: '俯视图', U: [-1, 0, 0], V: [0, -1, 0], N: [0, 0, 1], uvMin: [-WALL_SIZE, -WALL_SIZE] },
};

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// 平行光（正投影）：沿面的法线方向把点压到面上
export function projectOrtho(p, wall) {
  const n = wall.N;
  const d = dot(p, n);
  return [p[0] - d * n[0], p[1] - d * n[1], p[2] - d * n[2]];
}

// 点光源（中心投影）：从光源 L 经过点 p 的射线与面相交。
// 面过原点：n·(L + t(p-L)) = 0  =>  t = -n·L / n·(p-L)
// 当 p 不在光源与面之间（n·p >= n·L）时没有投影，返回 null。
export function projectCentral(p, L, wall) {
  const n = wall.N;
  const nl = dot(n, L);
  const np = dot(n, p);
  if (!(nl > np)) return null;
  const t = nl / (nl - np);
  return [L[0] + t * (p[0] - L[0]), L[1] + t * (p[1] - L[1]), L[2] + t * (p[2] - L[2])];
}

// 世界点 -> 面上 (u, v)
export function toWallUV(q, wall) {
  return [dot(q, wall.U), dot(q, wall.V)];
}

// 中心投影的放大倍数（对平行于面的截面）：光源到面距离 / 光源到截面距离
export function magnification(L, planeDepth, wall) {
  const nl = dot(wall.N, L);
  return nl / (nl - planeDepth);
}

// 绕物体中心的旋转矩阵，按 X、Y、Z 依次（与 Three.js Euler 'XYZ' 相同：R = Rx·Ry·Rz）
export function rotationMatrix(rxDeg, ryDeg, rzDeg) {
  const r = Math.PI / 180;
  const a = rxDeg * r, b = ryDeg * r, c = rzDeg * r;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  // 行主序 3x3
  return [
    cb * cc, -cb * sc, sb,
    ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb,
    sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb,
  ];
}

export function applyMat3(m, p) {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
    m[3] * p[0] + m[4] * p[1] + m[5] * p[2],
    m[6] * p[0] + m[7] * p[1] + m[8] * p[2],
  ];
}
