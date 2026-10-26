// Playwright 截图 + 控制台错误检查：BASE=http://127.0.0.1:8790/ node scripts/shots.mjs
let chromium;
try { ({ chromium } = await import('playwright-core')); } catch { ({ chromium } = await import('/workspace/pv-tools/node_modules/playwright-core/index.mjs')); }
const BASE = process.env.BASE || 'http://127.0.0.1:8790/index.html';
const OUT = process.env.OUT || new URL('../docs/screenshots', import.meta.url).pathname;
const ONLY = process.env.ONLY;
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' };
const results = [];
async function shot(name, ctxOpts, query, action) {
  if (ONLY && !name.includes(ONLY)) return;
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${name} [${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${name} PAGEERROR ${e.message}`));
  await page.goto(BASE + query, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__pv && window.__pv.ready && window.__pv.frames > 0, null, { timeout: 30000 });
  if (action) await action(page);
  await page.waitForTimeout(1300);
  const info = await page.evaluate(() => ({ solid: window.__pv.state.solid, mode: window.__pv.state.mode, views: JSON.stringify(window.__pv.lastViews) }));
  await page.screenshot({ path: `${OUT}/${name}.png` });
  results.push({ name, ...info });
  await ctx.close();
}
await shot('01-default-cube', mobile, '');
await shot('02-panel-open', mobile, '', async (p) => { await p.tap('#grab'); });
await shot('03-point-light', mobile, '?solid=cuboid&rot=0,0,30', async (p) => { await p.tap('#grab'); await p.tap('#mode button[data-v=central]'); await p.evaluate(() => document.querySelector('.scroll').scrollTop = 120); });
await shot('04-holeblock-views', mobile, '?solid=holeblock&views=1');
await shot('05-bearing-rotated', mobile, '?solid=bearing&views=1&rot=20,-15,35');
await shot('06-unfold-holeblock', mobile, '?solid=holeblock&views=1', async (p) => { await p.evaluate(() => window.__pv.set({ unfold: true })); await p.waitForTimeout(1500); });
await shot('07-point-rays-pyramid', mobile, '?solid=pyr4&mode=central&rays=1');
await shot('08-desktop', { viewport: { width: 1280, height: 800 } }, '?solid=tblock&views=1&panel=1&rot=0,0,25');
// 逐个切换 45 种
if (!ONLY) {
  const ctx = await browser.newContext(mobile);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`all45 PAGEERROR ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`all45 ${m.text()}`); });
  await page.goto(BASE + '?views=1&rays=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__pv && window.__pv.frames > 0);
  const ids = await page.evaluate(() => window.__pv.solids);
  let ok = 0;
  for (const id of ids) {
    for (const mode of ['ortho', 'central']) {
      await page.evaluate(([id, mode]) => window.__pv.set({ solid: id, mode, rot: [17, -23, 31] }), [id, mode]);
      await page.waitForTimeout(60);
    }
    const v = await page.evaluate(() => window.__pv.lastViews);
    if (v.V && v.V.visible > 0 && v.W.visible > 0 && v.H.visible > 0) ok++; else errors.push('no lines ' + id);
  }
  results.push({ name: 'all45', ok, total: ids.length });
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 1));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
