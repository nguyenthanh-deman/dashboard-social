'use strict';
// Dashboard kênh social — mọi dữ liệu từ API đều đi qua textContent (không dùng innerHTML).

// ---------- tiện ích DOM ----------
const NS = 'http://www.w3.org/2000/svg';
function build(el, attrs, kids) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const h = (tag, attrs, ...kids) => build(document.createElement(tag), attrs, kids);
const s = (tag, attrs, ...kids) => build(document.createElementNS(NS, tag), attrs, kids);
const $ = (id) => document.getElementById(id);

// ---------- định dạng ----------
const nf = new Intl.NumberFormat('vi-VN');
const fmt = (n) => nf.format(Math.round(n));
const dec = (x, d = 1) => (Math.round(x * 10 ** d) / 10 ** d).toString().replace('.', ',');
function compact(n) {
  const a = Math.abs(n);
  if (a >= 1e9) return dec(n / 1e9) + 'B';
  if (a >= 1e6) return dec(n / 1e6, a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e4) return dec(n / 1e3, a >= 1e5 ? 0 : 1) + 'K';
  return fmt(n);
}
const pct = (x) => dec(x, 2) + '%';
const fmtDay = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('vi-VN') : '—');
const fmtTime = (iso) => new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
const PLATFORM = { tiktok: 'TikTok', facebook: 'Facebook', youtube: 'YouTube', instagram: 'Instagram', threads: 'Threads' };
const platformName = (p) => PLATFORM[p] || (p ? p[0].toUpperCase() + p.slice(1) : '—');
// Trang Facebook dùng tên trang làm username nên không thêm "@"
const handleOf = (platform, username) => (platform === 'facebook' ? username : `@${username}`);
const todayUtc = () => new Date().toISOString().slice(0, 10);
const partialNote = (daily) => (daily.length && daily[daily.length - 1].date === todayUtc() ? ` · ngày cuối (${fmtDay(daily[daily.length - 1].date)}) chưa đủ dữ liệu` : '');

function pctChange(cur, prev) {
  if (!prev) return cur ? null : 0;
  return ((cur - prev) / prev) * 100;
}

// ---------- biểu tượng ----------
function icon(kind, size = 14) {
  const attrs = { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': 'true' };
  if (kind === 'up') return s('svg', attrs, s('path', { d: 'M8 3l5 8H3z', fill: 'var(--good)' }));
  if (kind === 'down') return s('svg', attrs, s('path', { d: 'M8 13L3 5h10z', fill: 'var(--critical)' }));
  if (kind === 'flat') return s('svg', attrs, s('path', { d: 'M3 8h10', stroke: 'var(--muted)', 'stroke-width': 2, 'stroke-linecap': 'round' }));
  if (kind === 'ok') return s('svg', attrs, s('circle', { cx: 8, cy: 8, r: 7, fill: 'var(--good)' }), s('path', { d: 'M4.8 8.2l2.2 2.2 4.2-4.4', fill: 'none', stroke: '#fff', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  if (kind === 'warning') return s('svg', attrs, s('path', { d: 'M8 1.5l7 12.5H1z', fill: 'var(--warning)' }), s('path', { d: 'M8 6v4M8 11.6v.4', stroke: '#0b0b0b', 'stroke-width': 1.8, 'stroke-linecap': 'round' }));
  return s('svg', attrs, s('circle', { cx: 8, cy: 8, r: 7, fill: 'var(--critical)' }), s('path', { d: 'M5.4 5.4l5.2 5.2M10.6 5.4l-5.2 5.2', stroke: '#fff', 'stroke-width': 1.8, 'stroke-linecap': 'round' }));
}
const STATE_LABEL = { ok: 'Hoạt động', warning: 'Cảnh báo', error: 'Lỗi' };
const statusBadge = (state, label) => h('span', { class: 'st' }, icon(state), label || STATE_LABEL[state]);

function delta(cur, prev, suffix = '') {
  const c = pctChange(cur, prev);
  if (c === null) return h('span', { class: 'delta' }, icon('up'), 'Mới', suffix && h('span', { class: 'dim' }, suffix));
  const kind = Math.abs(c) < 0.05 ? 'flat' : c > 0 ? 'up' : 'down';
  const sign = c > 0 ? '+' : c < 0 ? '−' : '';
  const txt = Math.abs(c) >= 1000 ? `${sign}999%+` : `${sign}${dec(Math.abs(c), 1)}%`; // kỳ trước gần bằng 0 thì % không còn ý nghĩa
  return h('span', { class: 'delta' }, icon(kind), txt);
}

// ---------- tooltip dùng chung ----------
const tip = $('tip');
function showTip(nodes, x, y) {
  tip.replaceChildren(...nodes);
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let left = x + 14, top = y - r.height - 10;
  if (left + r.width > innerWidth - 8) left = x - r.width - 14;
  if (left < 8) left = 8;
  if (top < 8) top = y + 16;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}
const hideTip = () => { tip.hidden = true; };
const tipRow = (value, label, o = {}) => h('div', { class: 'tip-row' + (o.minor ? ' minor' : '') }, o.key && h('i', { class: 'tip-key' }), h('strong', null, value), h('span', null, label));

// ---------- thang đo ----------
function niceScale(min, max, integer = true) {
  if (max === min) max = min + 1;
  const range = max - min;
  const rough = range / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= rough);
  if (integer) step = Math.max(1, step);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  return { lo, hi, ticks };
}

// ---------- biểu đồ SVG ----------
const charts = []; // { host, draw }
// Mỗi biểu đồ tự vẽ lại khi bề rộng khung chứa đổi (kể cả lần đầu có bề rộng, ví dụ khi hết bị ẩn).
function registerChart(host, draw) {
  const entry = { host, w: 0, draw: () => (host.dataset.empty ? host.replaceChildren(h('p', { class: 'note' }, 'Chưa có dữ liệu')) : draw()) };
  charts.push(entry);
  const ro = new ResizeObserver(() => {
    if (!host.isConnected) { ro.disconnect(); return; }
    const w = host.clientWidth;
    if (w && w !== entry.w) { entry.w = w; entry.draw(); }
  });
  ro.observe(host);
  if (host.clientWidth) { entry.w = host.clientWidth; entry.draw(); } // vẽ ngay nếu đã có bề rộng
}
function redrawCharts() {
  for (let i = charts.length - 1; i >= 0; i--) {
    const c = charts[i];
    if (!c.host.isConnected) charts.splice(i, 1);
    else if (c.host.clientWidth) { c.w = c.host.clientWidth; c.draw(); }
  }
}

// Con trỏ/bàn phím chọn một vị trí X; tooltip hiện cùng nội dung cho cả hai.
function attachScrub(svgEl, host, n, idxFromX, onShow, onHide) {
  let cur = -1;
  const show = (i, clientX, clientY) => { cur = i; onShow(i, clientX, clientY); };
  const hide = () => { cur = -1; onHide(); hideTip(); };
  svgEl.addEventListener('pointermove', (e) => {
    const r = svgEl.getBoundingClientRect();
    show(idxFromX(e.clientX - r.left), e.clientX, e.clientY);
  });
  svgEl.addEventListener('pointerleave', hide);
  svgEl.addEventListener('blur', hide);
  svgEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return hide();
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = Math.max(0, Math.min(n - 1, (cur < 0 ? n - 1 : cur) + (e.key === 'ArrowRight' ? 1 : -1)));
    const r = host.getBoundingClientRect();
    show(i, r.left + r.width / 2, r.top + 40);
  });
}

function xLabels(svgEl, rows, xAt, y, m, W) {
  const n = rows.length;
  const count = Math.min(n, W < 420 ? 4 : 6);
  const seen = new Set();
  for (let k = 0; k < count; k++) {
    const i = count === 1 ? 0 : Math.round((k * (n - 1)) / (count - 1));
    if (seen.has(i)) continue;
    seen.add(i);
    const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
    const x = i === 0 ? Math.max(xAt(i) - 8, m.l - 8) : i === n - 1 ? Math.min(xAt(i) + 8, W - m.r + 8) : xAt(i);
    svgEl.append(s('text', { class: 'ax-text', x, y, 'text-anchor': anchor }, fmtDay(rows[i].date)));
  }
}

function yAxis(svgEl, sc, m, W, yOf) {
  for (const t of sc.ticks) {
    const y = yOf(t);
    svgEl.append(s('line', { class: t === 0 ? 'ax-base' : 'ax-grid', x1: m.l, x2: W - m.r, y1: y, y2: y }));
    svgEl.append(s('text', { class: 'ax-text', x: m.l - 8, y: y + 4, 'text-anchor': 'end' }, compact(t)));
  }
}

function lineChart(host, rows, o) {
  if (!rows.length) host.dataset.empty = '1';
  registerChart(host, () => {
    host.replaceChildren();
    const W = host.clientWidth, H = o.height || 220;
    const m = { t: 18, r: 14, b: 26, l: 46 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const n = rows.length;
    const sc = niceScale(0, Math.max(0, ...rows.map((r) => r[o.key])));
    const xAt = (i) => m.l + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
    const yOf = (v) => m.t + ph - ((v - sc.lo) / (sc.hi - sc.lo)) * ph;
    const svgEl = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', tabindex: 0, 'aria-label': `${o.title}. Dùng phím mũi tên trái/phải để xem từng ngày.` });
    yAxis(svgEl, sc, m, W, yOf);
    xLabels(svgEl, rows, xAt, H - 6, m, W);
    const pts = rows.map((r, i) => [xAt(i), yOf(r[o.key])]);
    const curve = monotonePath(pts);
    svgEl.append(s('path', { class: 'area', d: curve + ` L${pts[n - 1][0]},${yOf(0)} L${pts[0][0]},${yOf(0)} Z` }));
    svgEl.append(s('path', { class: 'line glow', d: curve }));
    svgEl.append(s('path', { class: 'line', d: curve }));
    const last = pts[n - 1];
    svgEl.append(s('circle', { class: 'dot', cx: last[0], cy: last[1], r: 4 }));
    svgEl.append(s('text', { class: 'end-label', x: last[0], y: last[1] - 10, 'text-anchor': 'end' }, compact(rows[n - 1][o.key])));
    const cross = s('line', { class: 'cross', y1: m.t, y2: m.t + ph, visibility: 'hidden' });
    const hot = s('circle', { class: 'dot', r: 4, visibility: 'hidden' });
    svgEl.append(cross, hot);
    host.append(svgEl);
    attachScrub(svgEl, host, n,
      (px) => Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / pw) * (n - 1)))),
      (i, cx, cy) => {
        cross.setAttribute('x1', pts[i][0]); cross.setAttribute('x2', pts[i][0]); cross.setAttribute('visibility', 'visible');
        hot.setAttribute('cx', pts[i][0]); hot.setAttribute('cy', pts[i][1]); hot.setAttribute('visibility', 'visible');
        const r = rows[i];
        showTip([h('div', { class: 'tip-title' }, fmtDay(r.date) + '/' + r.date.slice(0, 4)), tipRow(fmt(r[o.key]), o.label, { key: true }), ...(o.extras || []).map((e) => tipRow(fmt(r[e.key]), e.label, { minor: true }))], cx, cy);
      },
      () => { cross.setAttribute('visibility', 'hidden'); hot.setAttribute('visibility', 'hidden'); });
  });
}

// Đường cong monotone (Fritsch–Carlson): không vọt quá dữ liệu như Catmull-Rom
function monotonePath(pts) {
  const n = pts.length;
  if (n < 3) return 'M' + pts.map((p) => p.join(',')).join(' L');
  const dx = [], sl = [];
  for (let i = 0; i < n - 1; i++) { dx.push(pts[i + 1][0] - pts[i][0] || 1e-6); sl.push((pts[i + 1][1] - pts[i][1]) / dx[i]); }
  const tg = [sl[0]];
  for (let i = 1; i < n - 1; i++) tg.push(sl[i - 1] * sl[i] <= 0 ? 0 : (sl[i - 1] + sl[i]) / 2);
  tg.push(sl[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (sl[i] === 0) { tg[i] = 0; tg[i + 1] = 0; continue; }
    const a = tg[i] / sl[i], b = tg[i + 1] / sl[i], r = a * a + b * b;
    if (r > 9) { const k = 3 / Math.sqrt(r); tg[i] = k * a * sl[i]; tg[i + 1] = k * b * sl[i]; }
  }
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const w = dx[i] / 3;
    d += ` C${pts[i][0] + w},${pts[i][1] + tg[i] * w} ${pts[i + 1][0] - w},${pts[i + 1][1] - tg[i + 1] * w} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

function barChart(host, rows, o) {
  if (!rows.length) host.dataset.empty = '1';
  registerChart(host, () => {
    host.replaceChildren();
    const W = host.clientWidth, H = o.height || 220;
    const m = { t: 18, r: 14, b: 26, l: 46 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const n = rows.length;
    const vals = rows.map((r) => r[o.key]);
    const peak = Math.max(...vals);
    const sc = niceScale(Math.min(0, ...vals), Math.max(0, ...vals));
    const slot = pw / n;
    const bw = Math.max(2, Math.min(24, slot - 2)); // khe 2px giữa các cột
    const xAt = (i) => m.l + slot * i + slot / 2;
    const yOf = (v) => m.t + ph - ((v - sc.lo) / (sc.hi - sc.lo)) * ph;
    const svgEl = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', tabindex: 0, 'aria-label': `${o.title}. Dùng phím mũi tên trái/phải để xem từng ngày.` });
    yAxis(svgEl, sc, m, W, yOf);
    xLabels(svgEl, rows, xAt, H - 6, m, W);
    const marks = rows.map((r, i) => {
      const v = r[o.key];
      if (!v) return null;
      const y0 = yOf(0), y1 = yOf(v);
      const top = Math.min(y0, y1), hh = Math.max(1, Math.abs(y1 - y0));
      const rad = Math.min(4, bw / 2, hh);
      const x = xAt(i) - bw / 2;
      // bo góc 4px ở đầu dữ liệu, vuông ở đường nền
      const d = v > 0
        ? `M${x},${top + hh} V${top + rad} Q${x},${top} ${x + rad},${top} H${x + bw - rad} Q${x + bw},${top} ${x + bw},${top + rad} V${top + hh} Z`
        : `M${x},${top} V${top + hh - rad} Q${x},${top + hh} ${x + rad},${top + hh} H${x + bw - rad} Q${x + bw},${top + hh} ${x + bw},${top + hh - rad} V${top} Z`;
      const p = s('path', { class: 'bar' + (v === peak ? ' peak' : ''), d });
      svgEl.append(p);
      return p;
    });
    host.append(svgEl);
    let on = null;
    attachScrub(svgEl, host, n,
      (px) => Math.max(0, Math.min(n - 1, Math.floor((px - m.l) / slot))),
      (i, cx, cy) => {
        if (on) on.classList.remove('on');
        on = marks[i]; if (on) on.classList.add('on');
        showTip([h('div', { class: 'tip-title' }, fmtDay(rows[i].date) + '/' + rows[i].date.slice(0, 4)), tipRow((rows[i][o.key] > 0 ? '+' : '') + fmt(rows[i][o.key]), o.label, { key: true })], cx, cy);
      },
      () => { if (on) on.classList.remove('on'); on = null; });
  });
}

function sparkline(values, w = 96, hgt = 28) {
  const pad = 5;
  const max = Math.max(...values, 1);
  const n = values.length;
  if (!n) return document.createTextNode('');
  const pts = values.map((v, i) => [pad + (n === 1 ? (w - 2 * pad) / 2 : (i / (n - 1)) * (w - 2 * pad)), hgt - pad - (v / max) * (hgt - 2 * pad)]);
  const last = pts[n - 1];
  return s('svg', { class: 'spark', width: w, height: hgt, viewBox: `0 0 ${w} ${hgt}`, 'aria-hidden': 'true' },
    s('path', { d: 'M' + pts.map((p) => p.map((c) => c.toFixed(1)).join(',')).join(' L') }),
    s('circle', { cx: last[0], cy: last[1], r: 4 }));
}

function hbars(items) {
  const max = Math.max(...items.map((i) => i.value), 1);
  const row = (it) => {
    const w = Math.max(0, (it.value / max) * 100);
    const inner = [
      h('span', { class: 'hb-label' }, it.label, it.sub && h('small', null, it.sub)),
      h('span', { class: 'hb-track' },
        h('span', { class: 'hb-bar', style: `width:calc((100% - 64px) * ${w / 100})` }),
        h('span', { class: 'hb-val' }, compact(it.value))),
    ];
    const on = (e) => showTip([h('div', { class: 'tip-title' }, it.label), tipRow(fmt(it.value), it.unit || '', { key: true }), it.sub && tipRow(it.sub, '', { minor: true })], e.clientX, e.clientY);
    const attrs = { class: 'hb', onpointermove: on, onpointerleave: hideTip, onblur: hideTip };
    return it.onClick ? h('button', { ...attrs, type: 'button', onclick: it.onClick, onfocus: (e) => { const r = e.target.getBoundingClientRect(); on({ clientX: r.left + 80, clientY: r.top }); } }, inner)
      : h('div', attrs, inner);
  };
  return h('div', { class: 'hbars' }, items.map(row));
}

// Khối biểu đồ có nút chuyển "Biểu đồ | Bảng" (bảng dữ liệu tương đương cho mọi biểu đồ)
function chartCard({ title, sub, rows, draw, columns }) {
  const host = h('div', { class: 'chart' });
  const tableHost = h('div', { hidden: true });
  const mk = (label, which) => h('button', { type: 'button', 'aria-pressed': which === 'chart' ? 'true' : 'false', onclick: () => {
    for (const b of toggle.children) b.setAttribute('aria-pressed', String(b === btnFor[which]));
    host.hidden = which !== 'chart'; tableHost.hidden = which === 'chart';
    if (which === 'chart') redrawCharts();
    if (which === 'table' && !tableHost.firstChild) tableHost.append(dataTable(rows, columns));
  } }, label);
  const btnFor = {};
  const toggle = h('div', { class: 'view-toggle', role: 'group', 'aria-label': 'Kiểu hiển thị' });
  btnFor.chart = mk('Biểu đồ', 'chart'); btnFor.table = mk('Bảng', 'table');
  toggle.append(btnFor.chart, btnFor.table);
  const card = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', null, h('h2', { class: 'card-title' }, title), sub && h('p', { class: 'card-sub' }, sub)), toggle),
    host, tableHost);
  queueMicrotask(() => draw(host));
  return card;
}
function dataTable(rows, columns) {
  return h('table', { class: 'data' },
    h('thead', null, h('tr', null, columns.map((c) => h('th', null, c.label)))),
    h('tbody', null, [...rows].reverse().map((r) => h('tr', null, columns.map((c) => h('td', null, c.get(r)))))));
}
const DAILY_COLS = {
  views: [{ label: 'Ngày', get: (r) => fmtDay(r.date) + '/' + r.date.slice(0, 4) }, { label: 'Views', get: (r) => fmt(r.views) }, { label: 'Reach', get: (r) => fmt(r.reach) }, { label: 'Tương tác', get: (r) => fmt(r.engagement) }],
  followers: [{ label: 'Ngày', get: (r) => fmtDay(r.date) + '/' + r.date.slice(0, 4) }, { label: 'Follower mới', get: (r) => (r.followersGained > 0 ? '+' : '') + fmt(r.followersGained) }],
};
const viewsCard = (daily, days, h2 = 'Views theo ngày') => chartCard({
  title: h2, sub: `${days} ngày gần nhất${partialNote(daily)}`, rows: daily, columns: DAILY_COLS.views,
  draw: (host) => lineChart(host, daily, { key: 'views', label: 'views', title: h2, extras: [{ key: 'reach', label: 'reach' }, { key: 'engagement', label: 'tương tác' }] }),
});
const followersCard = (daily, days, h2 = 'Follower mới theo ngày') => chartCard({
  title: h2, sub: `Tăng/giảm ròng mỗi ngày${partialNote(daily)}`, rows: daily, columns: DAILY_COLS.followers,
  draw: (host) => barChart(host, daily, { key: 'followersGained', label: 'follower mới', title: h2 }),
});

// ---------- trạng thái ----------
const state = {
  tab: 'overview', days: 30, data: null, loading: false,
  sort: { key: 'order', dir: 1 }, query: '', onlyIssues: false,
};
const STATIC_MODE = !!window.STATIC_MODE; // bản đăng lên artifact: dữ liệu từ ảnh chụp hằng ngày, không gọi Zernio
const RANGES = window.STATIC_RANGES || [7, 14, 30, 60, 90];

// ---------- các khối giao diện ----------
function tile({ label, value, note, spark }) {
  return h('div', { class: 'card tile' }, h('p', { class: 'tile-label' }, label), h('p', { class: 'tile-value' }, value), note, spark);
}

function renderKpis(sm) {
  const days = state.data.range.days;
  const vs = h('span', { class: 'dim' }, `so với ${days} ngày trước`);
  const daily = sm.daily;
  const hero = h('div', { class: 'card tile hero' },
    h('p', { class: 'tile-label' }, 'Tổng follower'),
    h('p', { class: 'tile-value' }, fmt(sm.followers.current)),
    h('p', { class: 'tile-note' }, h('b', null, (sm.followers.gained >= 0 ? '+' : '−') + fmt(Math.abs(sm.followers.gained))), `trong ${days} ngày`, h('span', { class: 'dim' }, '·'), `${sm.accountCount} tài khoản / ${sm.counted} kênh`));
  const tiles = [
    tile({ label: 'Views', value: compact(sm.totals.views), note: h('p', { class: 'tile-note' }, delta(sm.totals.views, sm.prev.views), vs), spark: sparkline(daily.map((d) => d.views)) }),
    tile({ label: 'Follower mới', value: (sm.followers.gained >= 0 ? '+' : '−') + compact(Math.abs(sm.followers.gained)), note: h('p', { class: 'tile-note' }, delta(sm.followers.gained, sm.followers.prevGained), vs), spark: sparkline(daily.map((d) => Math.max(0, d.followersGained))) }),
    tile({ label: 'Reach', value: compact(sm.totals.reach), note: h('p', { class: 'tile-note' }, delta(sm.totals.reach, sm.prev.reach), vs), spark: sparkline(daily.map((d) => d.reach)) }),
    tile({ label: 'Tương tác', value: compact(sm.totals.engagement), note: h('p', { class: 'tile-note' }, delta(sm.totals.engagement, sm.prev.engagement), vs), spark: sparkline(daily.map((d) => d.engagement)) }),
    tile({ label: 'Bài đăng', value: fmt(sm.posts), note: h('p', { class: 'tile-note' }, `Tỷ lệ tương tác ${pct(sm.totals.er)}`, h('span', { class: 'dim' }, `(kỳ trước ${pct(sm.prev.er)})`)) }),
  ];
  return h('section', { class: 'kpis', 'aria-label': 'Chỉ số tổng' }, hero, ...tiles);
}

function renderAlerts(sm) {
  if (!sm.alerts.length) return null;
  return h('section', { class: 'card alerts', 'aria-label': 'Cần chú ý' },
    h('div', { class: 'card-head' }, h('div', null, h('h2', { class: 'card-title' }, `Cần chú ý (${sm.alerts.length})`), h('p', { class: 'card-sub' }, 'Tài khoản hết hạn token hoặc kênh không lấy được dữ liệu — cần kết nối lại trên Zernio'))),
    h('ul', { class: 'alert-list' }, sm.alerts.map((a) => h('li', null, h('button', { type: 'button', onclick: () => openDrawer(a.channel), title: a.detail || '' },
      icon(a.state, 16),
      h('span', null, h('span', { class: 'who' }, a.channel, a.platform ? ` · ${platformName(a.platform)}` : '', a.username ? ` ${handleOf(a.platform, a.username)}` : ''), h('br'), h('span', { class: 'why' }, a.reason)))))));
}

function renderCharts(d) {
  const sm = d.summary, days = d.range.days;
  const platformCard = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', null, h('h2', { class: 'card-title' }, 'Follower theo nền tảng'), h('p', { class: 'card-sub' }, 'Mỗi tài khoản chỉ đếm một lần'))),
    hbars(sm.platforms.map((p) => ({ label: platformName(p.platform), sub: `${p.accounts} tài khoản`, value: p.followers, unit: 'follower' }))));
  const top = d.channels.filter((c) => !c.error && !c.duplicateOf).sort((a, b) => b.totals.views - a.totals.views).slice(0, 8);
  const topCard = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', null, h('h2', { class: 'card-title' }, 'Top kênh theo views'), h('p', { class: 'card-sub' }, `${days} ngày gần nhất`))),
    hbars(top.map((c) => ({ label: c.label || c.name, sub: c.group, value: c.totals.views, unit: 'views', onClick: () => openDrawer(c.name) }))));
  return h('div', { class: 'stack' },
    h('div', { class: 'grid-2' }, viewsCard(sm.daily, days), followersCard(sm.daily, days)),
    h('div', { class: 'grid-2 even', style: 'margin-top:16px' }, platformCard, topCard));
}

const COLS = [
  { key: 'order', label: 'Kênh', left: true },
  { key: 'accounts', label: 'Tài khoản', left: true, nosort: true },
  { key: 'followers', label: 'Follower' },
  { key: 'gained', label: 'Mới' },
  { key: 'views', label: 'Views' },
  { key: 'delta', label: 'vs kỳ trước' },
  { key: 'reach', label: 'Reach' },
  { key: 'engagement', label: 'Tương tác' },
  { key: 'er', label: 'ER' },
  { key: 'posts', label: 'Bài' },
  { key: 'trend', label: 'Xu hướng views', nosort: true },
];
const metric = {
  followers: (c) => c.followers?.current ?? 0,
  gained: (c) => c.followers?.gained ?? 0,
  views: (c) => c.totals?.views ?? 0,
  delta: (c) => pctChange(c.totals?.views ?? 0, c.prev?.views ?? 0) ?? 1e9,
  reach: (c) => c.totals?.reach ?? 0,
  engagement: (c) => c.totals?.engagement ?? 0,
  er: (c) => c.totals?.er ?? 0,
  posts: (c) => c.posts ?? 0,
};
const channelIssues = (c) => !!c.error || c.accounts.some((a) => a.state !== 'ok');

function renderTable(d) {
  const wrap = h('section', { class: 'card', 'aria-label': 'Danh sách kênh' });
  const body = h('div', { class: 'table-wrap' });
  const countEl = h('p', { class: 'card-sub' });
  const search = h('input', { class: 'search', type: 'search', placeholder: 'Tìm kênh hoặc tài khoản…', 'aria-label': 'Tìm kênh', value: state.query, oninput: (e) => { state.query = e.target.value; draw(); } });
  const only = h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { state.onlyIssues = e.target.checked; draw(); } }), 'Chỉ kênh có cảnh báo');
  only.firstChild.checked = state.onlyIssues;
  wrap.append(h('div', { class: 'card-head' }, h('div', null, h('h2', { class: 'card-title' }, 'Tất cả kênh'), countEl), h('div', { class: 'toolbar' }, search, only)), body);

  function draw() {
    const q = state.query.trim().toLowerCase();
    let rows = d.channels.map((c, i) => ({ c, i }));
    if (q) rows = rows.filter(({ c }) => [c.name, c.group, ...c.accounts.map((a) => a.username), ...c.accounts.map((a) => a.platform)].join(' ').toLowerCase().includes(q));
    if (state.onlyIssues) rows = rows.filter(({ c }) => channelIssues(c));
    const { key, dir } = state.sort;
    if (key !== 'order') rows.sort((a, b) => (metric[key](b.c) - metric[key](a.c)) * dir || a.i - b.i);
    countEl.textContent = `${rows.length}/${d.channels.length} kênh · bấm vào hàng để xem chi tiết`;

    const head = h('tr', null, COLS.map((c) => {
      const active = state.sort.key === c.key;
      const arrow = active && c.key !== 'order' ? (state.sort.dir === 1 ? ' ↓' : ' ↑') : '';
      return h('th', { class: c.left ? 'left' : '', scope: 'col', 'aria-sort': active && c.key !== 'order' ? (state.sort.dir === 1 ? 'descending' : 'ascending') : 'none' },
        c.nosort ? c.label : h('button', { type: 'button', onclick: () => {
          if (c.key === 'order') state.sort = { key: 'order', dir: 1 };
          else if (state.sort.key === c.key) state.sort = state.sort.dir === 1 ? { key: c.key, dir: -1 } : { key: 'order', dir: 1 };
          else state.sort = { key: c.key, dir: 1 };
          draw();
        } }, c.label + arrow));
    }));

    const trs = [];
    let lastGroup = null;
    for (const { c } of rows) {
      if (key === 'order' && c.group !== lastGroup) { lastGroup = c.group; trs.push(h('tr', { class: 'group-row' }, h('td', { colspan: COLS.length }, c.group))); }
      trs.push(channelRow(c));
    }
    if (!rows.length) trs.push(h('tr', null, h('td', { colspan: COLS.length }, h('div', { class: 'empty' }, 'Không có kênh nào khớp bộ lọc'))));

    const sm = d.summary;
    const foot = h('tfoot', null, h('tr', null,
      h('td', { colspan: 2 }, `Tổng (${sm.counted} kênh, đã loại trùng)`),
      h('td', null, fmt(sm.followers.current)), h('td', null, (sm.followers.gained > 0 ? '+' : '') + fmt(sm.followers.gained)),
      h('td', null, fmt(sm.totals.views)), h('td', null, delta(sm.totals.views, sm.prev.views)),
      h('td', null, fmt(sm.totals.reach)), h('td', null, fmt(sm.totals.engagement)), h('td', null, pct(sm.totals.er)), h('td', null, fmt(sm.posts)), h('td', null)));
    body.replaceChildren(h('table', { class: 't' }, h('thead', null, head), h('tbody', null, trs), foot));
  }
  draw();
  return wrap;
}

function channelRow(c) {
  const open = () => openDrawer(c.name);
  const tr = h('tr', { class: 'row' + (c.duplicateOf || c.error ? ' dim' : ''), tabindex: 0, role: 'button', 'aria-label': `Xem chi tiết kênh ${c.name}`, onclick: open, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } });
  const chips = h('span', { class: 'chips' }, c.accounts.map((a) => {
    const attrs = { class: 'chip', title: `${handleOf(a.platform, a.username)}${a.reason ? ' — ' + a.reason : ''}` };
    const kids = [a.state !== 'ok' && icon(a.state, 12), platformName(a.platform)];
    // Chip có link thì mở thẳng trang kênh, không mở ngăn chi tiết
    return a.url
      ? h('a', { ...attrs, class: 'chip link', href: a.url, target: '_blank', rel: 'noopener noreferrer', onclick: (e) => e.stopPropagation() }, kids)
      : h('span', attrs, kids);
  }));
  const name = h('td', { class: 'name' }, c.label || c.name,
    c.duplicateOf && h('span', { class: 'badge', title: 'Cùng tài khoản với kênh khác, không tính vào tổng' }, `trùng ${c.duplicateOf}`),
    c.error && h('span', { class: 'badge' }, 'lỗi'),
    h('small', null, c.group));
  if (c.error) {
    tr.append(name, h('td', { class: 'left', colspan: COLS.length - 1 }, statusBadge('error', c.error)));
    return tr;
  }
  tr.append(name, h('td', { class: 'left' }, chips),
    h('td', null, fmt(c.followers.current)),
    h('td', null, (c.followers.gained > 0 ? '+' : '') + fmt(c.followers.gained)),
    h('td', null, fmt(c.totals.views)),
    h('td', null, c.prev.views || c.totals.views ? delta(c.totals.views, c.prev.views) : '—'),
    h('td', null, fmt(c.totals.reach)), h('td', null, fmt(c.totals.engagement)),
    h('td', null, c.totals.views ? pct(c.totals.er) : '—'),
    h('td', null, fmt(c.posts)),
    h('td', null, c.daily.length ? sparkline(c.daily.map((r) => r.views)) : '—'));
  return tr;
}

function postRow(p, withChannel = true) {
  const thumb = p.thumb
    ? h('img', { class: 'thumb', src: p.thumb, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => e.target.replaceWith(h('div', { class: 'thumb' }, p.mediaType === 'video' ? 'video' : 'ảnh')) })
    : h('div', { class: 'thumb' }, p.mediaType === 'video' ? 'video' : 'bài');
  return h('li', { class: 'post' }, thumb,
    h('div', { class: 'post-body' },
      h('p', { class: 'post-text' }, p.content || '(không có nội dung)'),
      h('p', { class: 'post-meta' }, [withChannel && p.channel, platformName(p.platform), fmtDate(p.publishedAt)].filter(Boolean).join(' · '),
        p.url && h('a', { class: 'post-link', href: p.url, target: '_blank', rel: 'noopener noreferrer' }, 'Mở bài ↗')),
      watchText(p) && h('p', { class: 'post-meta' }, watchText(p))),
    h('div', { class: 'post-stats' },
      h('div', null, h('b', null, compact(p.views)), h('span', null, 'views')),
      h('div', null, h('b', null, compact(p.likes)), h('span', null, 'thích')),
      h('div', null, h('b', null, compact(p.comments + p.shares)), h('span', null, 'bl + chia sẻ')),
      h('div', null, h('b', null, pct(p.er)), h('span', null, 'ER'))));
}

function renderTopPosts(posts) {
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', null, h('h2', { class: 'card-title' }, 'Bài đăng nổi bật'), h('p', { class: 'card-sub' }, `Top ${posts.length} bài nhiều views nhất, đăng trong ${state.data.range.days} ngày gần nhất, toàn bộ kênh`))),
    posts.length ? h('ul', { class: 'posts' }, posts.map((p) => postRow(p))) : h('div', { class: 'empty' }, 'Chưa có bài đăng trong khoảng thời gian này'));
}

// ---------- ngăn chi tiết kênh ----------
let lastFocus = null;
function openDrawer(name) {
  const c = state.data.channels.find((x) => x.name === name);
  if (!c) return;
  lastFocus = document.activeElement;
  const dr = $('drawer'), days = state.data.range.days;
  dr.replaceChildren();
  const close = h('button', { class: 'btn', type: 'button', onclick: closeDrawer, 'aria-label': 'Đóng' }, 'Đóng ✕');
  dr.append(h('div', { class: 'drawer-head' },
    h('div', null, h('h2', { id: 'drawer-title' }, c.label || c.name), h('p', { class: 'sub' }, c.group, c.duplicateOf ? ` · trùng tài khoản với ${c.duplicateOf}, không tính vào tổng` : '', c.sharedWith.length ? ` · dùng chung tài khoản với ${c.sharedWith.join(', ')}` : '')),
    close));
  if (c.error) {
    dr.append(h('div', { class: 'card' }, statusBadge('error', c.error)));
  } else {
    if (c.warn) dr.append(h('div', { class: 'card' }, statusBadge('warning', c.warn)));
    dr.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { class: 'card-title' }, `Tài khoản (${c.accounts.length})`)),
      h('div', { class: 'acc-list' }, c.accounts.map(accountRow))));
    const t = c.totals, p = c.prev;
    const mini = (label, value, note) => h('div', { class: 'card tile' }, h('p', { class: 'tile-label' }, label), h('p', { class: 'tile-value' }, value), note && h('p', { class: 'tile-note' }, note));
    dr.append(h('div', { class: 'mini' },
      mini('Views', compact(t.views), delta(t.views, p.views)),
      mini('Reach', compact(t.reach), delta(t.reach, p.reach)),
      mini('Tương tác', compact(t.engagement), delta(t.engagement, p.engagement)),
      mini('ER', pct(t.er), h('span', { class: 'dim' }, `kỳ trước ${pct(p.er)}`)),
      mini('Follower mới', (c.followers.gained > 0 ? '+' : '') + fmt(c.followers.gained), delta(c.followers.gained, c.followers.prevGained)),
      mini('Bài đăng', fmt(c.posts))));
    dr.append(weeklyDrawerCard(c.name));
    if (c.daily.length) dr.append(followerSeriesCard(c), viewsCard(c.daily, days), followersCard(c.daily, days));
    dr.append(postsSection(c));
    if (c.dataAsOf) dr.append(h('p', { class: 'note' }, `Số liệu Zernio cập nhật lúc ${fmtTime(c.dataAsOf)}. Follower mới tính từ lịch sử Zernio ghi nhận, tài khoản mới kết nối sẽ chỉ có dữ liệu từ ngày kết nối.`));
  }
  $('scrim').hidden = false; dr.hidden = false; dr.scrollTop = 0;
  document.body.style.overflow = 'hidden';
  close.focus();
  redrawCharts();
}
function closeDrawer() {
  $('drawer').hidden = true; $('scrim').hidden = true; hideTip();
  document.body.style.overflow = '';
  if (lastFocus && lastFocus.isConnected) lastFocus.focus();
}
$('scrim').addEventListener('click', closeDrawer);
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('drawer').hidden) closeDrawer(); });

function accountRow(a) {
  const initial = (a.username || a.displayName || '?')[0].toUpperCase();
  const av = a.avatar
    ? h('img', { class: 'avatar', src: a.avatar, alt: '', referrerpolicy: 'no-referrer', onerror: (e) => e.target.replaceWith(h('div', { class: 'avatar' }, initial)) })
    : h('div', { class: 'avatar' }, initial);
  const name = handleOf(a.platform, a.username);
  return h('div', { class: 'acc' }, av,
    h('div', { style: 'min-width:0' },
      h('div', { class: 'acc-name' }, a.url ? h('a', { href: a.url, target: '_blank', rel: 'noopener noreferrer' }, name) : name, h('span', { class: 'badge' }, platformName(a.platform))),
      h('div', { class: 'acc-sub' }, statusBadge(a.state, a.state === 'ok' ? STATE_LABEL.ok : a.reason), a.state === 'ok' && a.tokenExpiresAt && a.platform !== 'tiktok' ? h('span', { class: 'dim', style: 'color:var(--muted)' }, ` · token đến ${fmtDate(a.tokenExpiresAt)}`) : null),
      a.state !== 'ok' && a.detail ? h('div', { class: 'note' }, a.detail) : null),
    h('div', { class: 'acc-fol' }, h('b', null, fmt(a.followers)), a.gained == null ? null : h('span', { class: 'note' }, `${a.gained > 0 ? '+' : ''}${fmt(a.gained)} trong kỳ`)));
}

function postsSection(c) {
  const list = h('div', null);
  const toggle = h('div', { class: 'view-toggle', role: 'group', 'aria-label': 'Sắp xếp bài đăng' });
  const sorts = [['views', 'Nhiều views nhất'], ['engagement', 'Tương tác nhiều nhất'], ['completion_rate', 'Xem hết cao nhất'], ['date', 'Mới nhất']];
  const cache = {};
  async function load(sort) {
    for (const b of toggle.children) b.setAttribute('aria-pressed', String(b.dataset.sort === sort));
    list.replaceChildren(h('div', { class: 'empty' }, 'Đang tải bài đăng…'));
    try {
      if (!cache[sort]) {
        const res = await fetch(`/api/channel/${encodeURIComponent(c.name)}/posts?days=${state.data.range.days}&sort=${sort}&limit=15`);
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || res.statusText);
        cache[sort] = j.posts;
      }
      list.replaceChildren(cache[sort].length ? h('ul', { class: 'posts' }, cache[sort].map((p) => postRow(p, false))) : h('div', { class: 'empty' }, 'Chưa có bài đăng trong khoảng thời gian này'));
    } catch (err) {
      list.replaceChildren(h('div', { class: 'empty' }, `Không tải được bài đăng: ${err.message}`));
    }
  }
  for (const [k, label] of sorts) toggle.append(h('button', { type: 'button', 'data-sort': k, 'aria-pressed': 'false', onclick: () => load(k) }, label));
  queueMicrotask(() => load('views'));
  return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { class: 'card-title' }, 'Bài đăng'), toggle), list);
}

// ---------- tải dữ liệu & vẽ ----------
function render() {
  const d = state.data;
  $('sub').textContent = `Nguồn: Zernio · ${d.summary.counted}/${d.channels.length} kênh được tính · ${d.range.from} → ${d.range.to}`;
  $('updated').textContent = `Cập nhật ${fmtTime(d.generatedAt)}`;
  if (state.tab !== 'overview') return; // tab khác tự vẽ từ snapshot
  const nodes = [renderKpis(d.summary), renderAlerts(d.summary), renderCharts(d), renderTable(d), renderTopPosts(d.topPosts)].filter(Boolean);
  $('content').replaceChildren(...nodes);
}

function renderRange() {
  $('range').replaceChildren(...RANGES.map((n) => h('button', { type: 'button', 'aria-pressed': String(n === state.days), onclick: () => { if (n !== state.days) { state.days = n; renderRange(); load(); } } }, `${n} ngày`)));
}

let pollTimer = 0;
async function load(refresh = false) {
  if (state.loading) return;
  state.loading = true;
  const days = state.days;
  const content = $('content');
  $('btn-refresh').disabled = true;
  const onOverview = state.tab === 'overview'; // tab khác tự vẽ từ snapshot, không bị tải nền làm nhấp nháy
  if (onOverview) $('banner').replaceChildren();
  if (state.data && onOverview) content.classList.add('is-loading');
  else if (onOverview) content.replaceChildren(h('div', { class: 'card loading-card' }, h('p', { id: 'load-text' }, 'Đang tải dữ liệu từ Zernio…'), h('div', { class: 'bar-progress' }, h('i', { id: 'load-bar', style: 'width:0%' }))));
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const st = await (await fetch(`/api/status?days=${days}`)).json();
      const t = $('load-text'), b = $('load-bar');
      if (t && st.loading) { t.textContent = `Đang tải dữ liệu từ Zernio… ${st.done}/${st.total} kênh`; b.style.width = (st.done / st.total) * 100 + '%'; }
    } catch { /* bỏ qua */ }
  }, 500);
  try {
    const res = await fetch(`/api/overview?days=${days}${refresh ? '&refresh=1' : ''}`);
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || res.statusText);
    if (days !== state.days) return;
    state.data = j;
    render();
  } catch (err) {
    if (state.tab === 'overview') {
      $('banner').replaceChildren(h('div', { class: 'banner' }, icon('error', 16), `Không tải được dữ liệu: ${err.message}`, h('button', { class: 'btn', type: 'button', onclick: () => load(true) }, 'Thử lại')));
      if (!state.data) $('content').replaceChildren();
    }
  } finally {
    clearInterval(pollTimer);
    state.loading = false;
    content.classList.remove('is-loading');
    $('btn-refresh').disabled = false;
    if (days !== state.days) load();
  }
}

// ---------- giao diện sáng/tối ----------
function effectiveTheme() {
  return document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function paintThemeButton() {
  const dark = effectiveTheme() === 'dark';
  $('btn-theme').replaceChildren(dark
    ? s('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true' }, s('circle', { cx: 8, cy: 8, r: 3, fill: 'currentColor' }), s('path', { d: 'M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round' }))
    : s('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true' }, s('path', { d: 'M13 9.5A5.5 5.5 0 016.5 3 5.5 5.5 0 108 13.5a5.5 5.5 0 005-4z', fill: 'currentColor' })));
}
try { const t = localStorage.getItem('theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch { /* không có localStorage */ }
$('btn-theme').addEventListener('click', () => {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch { /* bỏ qua */ }
  paintThemeButton();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintThemeButton);
paintThemeButton();

$('btn-refresh').addEventListener('click', () => (state.tab === 'overview' ? load(true) : showTab()));
if (STATIC_MODE) $('btn-refresh').hidden = true; // dữ liệu chỉ đổi khi trang được xuất bản lại
else setInterval(() => { if (!document.hidden && !state.loading && state.data && Date.now() - new Date(state.data.generatedAt) > 10 * 60 * 1000) load(); }, 60 * 1000);
renderRange();
load();
