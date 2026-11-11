// 主页回归：根 index.html 的 45 种几何体，新旧两版逐个截图（叠加三视图 + 展开）并比较 lastViews。
// NODE_PATH=<playwright> node scripts/regress-main.cjs <输出目录> <新版 BASE> <旧版 BASE>
const { chromium } = require('playwright');
const fs = require('fs');
const [OUT, NEW, OLD] = [process.argv[2], process.argv[3] || 'http://127.0.0.1:8876/index.html', process.argv[4] || 'http://127.0.0.1:8877/index.html'];
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  async function shot(base, q, file) {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => errors.push(file + ' ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(file + ' ' + m.text()); });
    await page.goto(base + q, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__pv && window.__pv.ready && window.__pv.frames > 0, null, { timeout: 60000 });
    await page.waitForTimeout(700);
    const lv = await page.evaluate(() => JSON.stringify(window.__pv.lastViews));
    await page.screenshot({ path: file });
    await page.close();
    return lv;
  }
  const ids = await (async () => { const p = await browser.newPage(); await p.goto(NEW, { waitUntil: 'networkidle' }); await p.waitForFunction(() => window.__pv && window.__pv.ready); const s = await p.evaluate(() => window.__pv.solids); await p.close(); return s; })();
  const rows = [];
  for (const id of ids) {
    const r = { id };
    for (const [k, q] of [['3d', `?solid=${id}&views=1`], ['unfold', `?solid=${id}&views=1&unfold=1`]]) {
      r[k + 'New'] = await shot(NEW, q, `${OUT}/${id}_${k}_new.png`);
      r[k + 'Old'] = await shot(OLD, q, `${OUT}/${id}_${k}_old.png`);
    }
    r.sameViews = r['3dNew'] === r['3dOld'] && r.unfoldNew === r.unfoldOld;
    rows.push(r);
  }
  fs.writeFileSync(OUT + '/regress-main.json', JSON.stringify({ rows, errors }, null, 1));
  console.log('solids', rows.length, 'same lastViews', rows.filter((r) => r.sameViews).length, 'errors', errors.length);
  for (const e of errors.slice(0, 10)) console.log(e);
  await browser.close();
})();
