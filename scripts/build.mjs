// 打包：app.min.js（网页用） + dist/projection-views-standalone.html（单文件，双击即可打开）
let build;
try { ({ build } = await import('esbuild')); } catch { ({ build } = await import(process.env.ESBUILD || '/workspace/pv-tools/node_modules/esbuild/lib/main.js')); }
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const root = new URL('..', import.meta.url).pathname;
const r = await build({ entryPoints: [root + 'src/app.js'], bundle: true, minify: true, format: 'esm', target: ['safari15', 'chrome100'], write: false, legalComments: 'none' });
const js = r.outputFiles[0].text;
writeFileSync(root + 'app.min.js', js);
const html = readFileSync(root + 'index.html', 'utf8');
const icon = 'data:image/svg+xml;base64,' + Buffer.from(readFileSync(root + 'icon.svg')).toString('base64');
const single = html
  .replace('<script type="module" src="./app.min.js"></script>', () => `<script type="module">\n${js.replace(/<\/script/g, '<\\/script')}\n</script>`)
  .replaceAll('href="icon.svg"', `href="${icon}"`);
mkdirSync(root + 'dist', { recursive: true });
writeFileSync(root + 'dist/projection-views-standalone.html', single);
console.log('app.min.js', (js.length / 1024).toFixed(0), 'KB; standalone', (single.length / 1024).toFixed(0), 'KB');
