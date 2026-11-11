// 逐模型截图 + 控制台错误检查（geometry-76 的 176 个模型，主页引擎）。
// 先在仓库根目录：python3 -m http.server 8876 --bind 127.0.0.1
// NODE_PATH=<playwright 所在 node_modules> node scripts/review-models.cjs <输出目录> [BASE]
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.argv[2] || '/workspace/projection-views-review/v2';
const BASE = process.argv[3] || 'http://127.0.0.1:8876/geometry-76/index.html';
(async () => {
  fs.mkdirSync(OUT + '/models', { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 }, deviceScaleFactor: 1 });
  const errors = [];
  let current = '(load)';
  page.on('pageerror', (e) => errors.push({ model: current, type: 'pageerror', text: e.message }));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push({ model: current, type: m.type(), text: m.text() }); });
  await page.goto(BASE + '?views=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__pv && window.__pv.ready && window.__pv.frames > 0, null, { timeout: 60000 });
  const items = await page.evaluate(() => window.PV_LIBRARY.items.map((x) => ({ id: x.id, name: x.name, number: x.number })));
  const results = [];
  let basicN = 0;
  const settle = async (pred) => {
    await page.waitForFunction(pred, null, { timeout: 30000 });
    // 按需渲染：画面静止后不再出新帧，这里只等两次 requestAnimationFrame 让最后一帧画完
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  };
  for (const it of items) {
    current = it.id;
    const tag = it.number ? 'M' + String(it.number).padStart(3, '0') : 'B' + String(++basicN).padStart(3, '0');
    const t0 = Date.now();
    await page.evaluate((id) => window.__pv.set({ solid: id, unfold: false, views: true, rot: [0, 0, 0] }), it.id);
    await settle(`window.__pv.solid && window.__pv.solid.id === ${JSON.stringify(it.id)} && window.__pv.unfoldK === 0`);
    const buildMs = Date.now() - t0;
    await page.screenshot({ path: `${OUT}/models/${tag}_${it.id}_3d.png` });
    const info = await page.evaluate(() => ({ lastViews: JSON.parse(JSON.stringify(window.__pv.lastViews)), tris: window.__pv.solid.tris.length / 3, edges: window.__pv.solid.edges.length / 5, meshStats: window.__pv.solid.meshStats, shape: document.getElementById('shape').value, title: document.getElementById('exercise-title').textContent }));
    await page.evaluate(() => window.__pv.set({ unfold: true }));
    await settle('window.__pv.unfoldK === 1');
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${OUT}/models/${tag}_${it.id}_unfold.png` });
    results.push({ tag, id: it.id, name: it.name, buildMs, ...info, panelSynced: info.shape === it.id && info.title === it.name });
    if (results.length % 20 === 0) console.log(results.length, 'done');
  }
  fs.writeFileSync(OUT + '/browser-models.json', JSON.stringify({ base: BASE, models: results, errors }, null, 1));
  console.log('models', results.length, 'errors', errors.length, 'panel out of sync', results.filter((r) => !r.panelSynced).length, 'max build+render ms', Math.max(...results.map((r) => r.buildMs)));
  for (const e of errors.slice(0, 20)) console.log(JSON.stringify(e));
  await browser.close();
})();
