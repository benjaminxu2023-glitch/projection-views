// URL 参数 -> 初始状态（纯函数，可在 Node 中测试）。主页与 geometry-76 页面共用。
//   ?solid=<id>（geometry-76 也接受旧链接的 ?model=<id>）&mode=central &views=1 &rays=1 &unfold=1
//   &shadows=0 &axes=0 &rot=x,y,z &light=d,a,b &panel=1
const nums = (s, n) => { if (!s) return null; const a = s.split(',').map(Number); return a.length === n && a.every(Number.isFinite) ? a : null; };

export function parseParams(search, { ids, defaultId, allowModel = false, defaultLight }) {
  const qs = new URLSearchParams(search);
  const want = qs.get('solid') || (allowModel ? qs.get('model') : null);
  return {
    solid: ids.includes(want) ? want : defaultId,
    mode: qs.get('mode') === 'central' ? 'central' : 'ortho',
    views: qs.get('views') === '1',
    rays: qs.get('rays') === '1',
    unfold: qs.get('unfold') === '1',
    shadows: qs.get('shadows') !== '0',
    axes: qs.get('axes') !== '0',
    rot: nums(qs.get('rot'), 3) || [0, 0, 0],
    light: nums(qs.get('light'), 3) || [...defaultLight],
    panel: qs.get('panel') === '1',
  };
}
