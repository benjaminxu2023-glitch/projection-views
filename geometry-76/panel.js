(() => {
  'use strict';
  const library = window.PV_LIBRARY;
  const items = library.items;
  const byId = new Map(items.map(item => [item.id, item]));
  const $ = id => document.getElementById(id);
  let select, currentId, mounted = false, matches = [];
  const inRange = item => $('library').value === 'all' || ($('library').value === 'advanced') === item.advanced;
  const number = item => 'M' + String(item.number).padStart(3, '0');

  function option(value, text) {
    const node = document.createElement('option');
    node.value = value;
    node.textContent = text;
    return node;
  }

  function categories() {
    $('category').replaceChildren(option('', '全部考点 / 分类'));
    for (const group of new Set(items.filter(inRange).map(item => item.group))) {
      $('category').appendChild(option(group, group));
    }
  }

  function filter() {
    if (!mounted) return;
    const category = $('category').value;
    const query = $('search').value.trim().toLowerCase();
    matches = items.filter(item => inRange(item) && (!category || item.group === category) &&
      [item.name, item.group, item.topic, item.focus, item.id].join(' ').toLowerCase().includes(query));
    const shape = $('shape');
    shape.replaceChildren();
    const groups = new Map();
    for (const item of matches) {
      if (!groups.has(item.group)) {
        const group = document.createElement('optgroup');
        group.label = item.group;
        groups.set(item.group, group);
        shape.appendChild(group);
      }
      groups.get(item.group).appendChild(option(item.id, (item.advanced ? number(item) + ' · ' : '') + item.name));
    }
    $('shape-count').textContent = '176 种 · 当前 ' + matches.length + ' 种';
    for (const id of ['previous', 'next', 'random']) $(id).disabled = !matches.length;
    shape.disabled = !matches.length;
    if (!matches.length) {
      const empty = option('', '没有匹配模型，请更换关键词');
      empty.disabled = true;
      shape.appendChild(empty);
      shape.value = '';
      return;
    }
    if (matches.some(item => item.id === currentId)) shape.value = currentId;
    else select(matches[0].id);
  }

  function render() {
    const item = byId.get(currentId);
    if (!item) return;
    $('shape').value = item.id;
    $('exercise-id').textContent = item.advanced ? number(item) + ' · 原创期末练习' : '基础构形 · ' + item.group;
    $('difficulty').textContent = item.advanced ? '★'.repeat(item.level) + (item.level === 4 ? ' 进阶' : ' 综合挑战') : '基础';
    $('exercise-title').textContent = item.name;
    $('exercise-task').textContent = item.task || '观察形体，练习绘制三视图，并比较不同观察方向下轮廓的变化。';
    $('exercise-focus').textContent = '考点：' + item.focus;
    $('exercise-hint').open = false;
    const url = new URL(window.location.href);
    url.searchParams.set('solid', item.id);
    url.searchParams.delete('model');
    window.history.replaceState(window.history.state, '', url);
  }

  library.onSolid = id => {
    if (!byId.has(id)) return;
    currentId = id;
    if (!mounted) return;
    const item = byId.get(id);
    if (!inRange(item)) {
      $('library').value = item.advanced ? 'advanced' : 'basic';
      categories();
      // External model changes must remain selected even under an earlier search.
      $('search').value = '';
      filter();
    }
    render();
  };

  library.mount = ({ select: selectSolid, state }) => {
    select = selectSolid;
    currentId = currentId || state.solid;
    const item = byId.get(currentId);
    if (item) $('library').value = item.advanced ? 'advanced' : 'basic';
    mounted = true;
    $('library').onchange = () => { categories(); filter(); };
    $('category').onchange = filter;
    $('search').oninput = filter;
    $('shape').onchange = event => select(event.target.value);
    const step = delta => {
      if (!matches.length) return;
      const index = matches.findIndex(item => item.id === currentId);
      select(matches[(index + delta + matches.length) % matches.length].id);
    };
    $('previous').onclick = () => step(-1);
    $('next').onclick = () => step(1);
    $('random').onclick = () => {
      const candidates = matches.filter(item => item.id !== currentId);
      if (candidates.length) select(candidates[Math.floor(Math.random() * candidates.length)].id);
    };
    categories();
    filter();
    render();
  };
  window.__pvPanel = { filter, matching: () => matches.map(item => item.id) };
})();
