// 390×844 竖屏（iPhone 触屏）截图：控制台收起 / 展开 / 模型库面板 / 点开关展开三视图（动画结束后）。
// NODE_PATH=<playwright> node scripts/mobile-390.cjs <输出目录> <页面 URL> [前缀]
const { chromium } = require('playwright');
const fs = require('fs');
const [OUT, URL0, PREFIX = 'mobile390'] = [process.argv[2], process.argv[3] || 'http://127.0.0.1:8876/geometry-76/index.html', process.argv[4]];
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ' ' + m.text()); });
  const raf = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.goto(URL0 + (URL0.includes('?') ? '&' : '?') + 'solid=mech-012&views=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__pv && window.__pv.ready && window.__pv.frames > 0, null, { timeout: 60000 });
  await page.waitForTimeout(600);
  const overflow = async () => page.evaluate(() => ({ doc: document.documentElement.scrollWidth, scroll: document.querySelector('.scroll').scrollWidth, sheet: document.getElementById('sheet').getBoundingClientRect().width }));
  const shots = [];
  const snap = async (name) => { await raf(); const f = `${OUT}/${PREFIX}-${name}.png`; await page.screenshot({ path: f }); shots.push({ name, file: f, overflow: await overflow() }); };
  await snap('1-collapsed');
  await page.tap('#grab'); await page.waitForTimeout(800); await snap('2-panel-open');
  await page.evaluate(() => { document.querySelector('.scroll').scrollTop = 330; }); await page.waitForTimeout(300); await snap('3-panel-card');
  // 用触屏点开关：更多 → 展开三视图
  await page.evaluate(() => document.getElementById('unfold').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(200);
  await page.tap('#unfold');
  await page.waitForFunction(() => window.__pv.unfoldK === 1, null, { timeout: 30000 });
  await page.waitForTimeout(1200); // 相机动画 900ms
  await snap('4-unfold-panel-open');
  await page.tap('#grab'); await page.waitForTimeout(800); await snap('5-unfold-collapsed');
  const state = await page.evaluate(() => ({ solid: window.__pv.state.solid, unfold: window.__pv.state.unfold, views: window.__pv.state.views, unfoldK: window.__pv.unfoldK, lastViews: window.__pv.lastViews, url: location.search }));
  fs.writeFileSync(`${OUT}/${PREFIX}.json`, JSON.stringify({ url: URL0, shots, state, errors }, null, 1));
  console.log(JSON.stringify({ state, errors, overflow: shots.map((s) => s.name + ':' + JSON.stringify(s.overflow)) }, null, 1));
  await browser.close();
})();
