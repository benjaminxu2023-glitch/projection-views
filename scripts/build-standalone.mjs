// 生成单文件版本 dist/projection-views-standalone.html：把 src/*.js 内联进页面，
// 这样直接双击（file://）也能打开（Three.js 仍从固定版本 CDN 加载）。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let html = readFileSync(join(root, 'index.html'), 'utf8');

function asIIFE(file, name) {
  let src = readFileSync(join(root, file), 'utf8');
  if (/^\s*import\s/m.test(src)) throw new Error(`${file} 含 import，无法内联`);
  const names = [];
  src = src.replace(/^export\s+(function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm, (_, kw, id) => { names.push(id); return `${kw} ${id}`; });
  if (/^\s*export\s/m.test(src)) throw new Error(`${file} 存在未处理的 export 语法`);
  return `const ${name} = (() => {\n${src}\nreturn { ${names.join(', ')} };\n})();`;
}

const map = { geometry: ['src/geometry.js', 'Geo'], projection: ['src/projection.js', 'Proj'] };
for (const [tag, [file, name]] of Object.entries(map)) {
  const re = new RegExp(`// @inline ${tag}\\nimport \\* as ${name} from '\\./${file.replace('.', '\\.')}';`);
  if (!re.test(html)) throw new Error(`找不到 @inline ${tag} 标记`);
  html = html.replace(re, () => asIIFE(file, name));
}
const out = join(root, 'dist', 'projection-views-standalone.html');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log('已生成', out, (html.length / 1024).toFixed(1) + ' KB');
