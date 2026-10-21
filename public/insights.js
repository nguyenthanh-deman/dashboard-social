'use strict';
// Các màn dựa trên snapshot hằng ngày: Top video, Đánh giá tuần, và các khối bổ sung trong ngăn chi tiết kênh.
// Dùng chung tiện ích (h, fmt, pct, compact, chartCard, lineChart…) và biến `state` của app.js.

// ---------- tab ----------
const TABS = [['overview', 'Tổng quan'], ['videos', 'Top video'], ['weekly', 'Đánh giá tuần']];

function renderTabs() {
  $('tabs').replaceChildren(...TABS.map(([key, label]) => h('button', {
    type: 'button', class: 'tab', role: 'tab', 'aria-selected': String(state.tab === key),
    onclick: () => setTab(key),
  }, label)));
  $('range-filter').hidden = state.tab !== 'overview';
}

function setTab(tab) {
  if (state.tab === tab) return;
  state.tab = tab;
  try { localStorage.setItem('tab', tab); } catch { /* bỏ qua */ }
  renderTabs();
  showTab();
}

function showTab() {
  $('banner').replaceChildren();
  if (state.tab === 'videos') return renderVideosTab();
  if (state.tab === 'weekly') return renderWeeklyTab();
  if (state.data) render();
  else $('content').replaceChildren(h('div', { class: 'card loading-card' }, h('p', null, 'Đang tải dữ liệu từ Zernio…')));
}

async function getJson(url) {
  const res = await fetch(url);
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || res.statusText);
  return j;
}

const loadingCard = (text) => h('div', { class: 'card loading-card' }, h('p', null, text));
const emptyCard = (text) => h('div', { class: 'card' }, h('div', { class: 'empty' }, text));

function select(label, options, value, onChange) {
  const el = h('select', { class: 'sel', 'aria-label': label, onchange: (e) => onChange(e.target.value) },
    options.map(([v, text]) => h('option', { value: v }, text)));
  el.value = value;
  return h('label', { class: 'sel-wrap' }, h('span', null, label), el);
}

// ---------- chỉ số giữ chân ----------
const watchText = (p) => {
  const parts = [];
  if (p.completion != null) parts.push(`${dec(p.completion, 1)}% xem hết`);
  if (p.watchSec != null) parts.push(`TB ${dec(p.watchSec, 1)}s`);
  if (p.retention != null) parts.push(`${dec(p.retention, 0)}% độ dài`);
  return parts.join(' · ');
};

// ---------- tab Top video ----------
const vstate = { days: 7, sort: 'engagement', platform: '', channel: '' };

async function renderVideosTab() {
  const content = $('content');
  content.replaceChildren(loadingCard('Đang tải top video…'));
  const q = new URLSearchParams({ days: vstate.days, sort: vstate.sort, limit: 50 });
  if (vstate.platform) q.set('platform', vstate.platform);
  if (vstate.channel) q.set('channel', vstate.channel);
  let j;
  try { j = await getJson(`/api/top-posts?${q}`); } catch (err) {
    if (state.tab === 'videos') content.replaceChildren(emptyCard(err.message));
    return;
  }
  if (state.tab !== 'videos') return;

  const redo = (patch) => { Object.assign(vstate, patch); renderVideosTab(); };
  const filters = h('div', { class: 'toolbar' },
    select('Khoảng thời gian', [[1, '24 giờ'], [3, '3 ngày'], [7, '7 ngày'], [14, '14 ngày'], [30, '30 ngày']], vstate.days, (v) => redo({ days: Number(v) })),
    select('Xếp theo', [['engagement', 'Tương tác'], ['views', 'Lượt xem'], ['er', 'Tỷ lệ tương tác'], ['completion', 'Tỷ lệ xem hết'], ['date', 'Mới nhất']], vstate.sort, (v) => redo({ sort: v })),
    select('Nền tảng', [['', 'Tất cả'], ...j.platforms.map((p) => [p, platformName(p)])], vstate.platform, (v) => redo({ platform: v })),
    select('Kênh', [['', 'Tất cả'], ...j.channels.map((c) => [c, c])], vstate.channel, (v) => redo({ channel: v })));

  const cols = ['Video', 'Kênh', 'Đăng', 'Views', 'Thích', 'BL', 'Chia sẻ', 'Lưu', 'ER', 'Xem hết', 'Xem TB'];
  const rows = j.posts.map((p) => h('tr', null,
    h('td', { class: 'left vid' }, postThumb(p), h('span', { class: 'vid-body' },
      h('span', { class: 'vid-text' }, p.content || '(không có nội dung)'),
      p.url && h('a', { class: 'post-link', href: p.url, target: '_blank', rel: 'noopener noreferrer' }, 'Mở bài ↗'))),
    h('td', { class: 'left' }, p.channel, h('small', { class: 'dim' }, ` ${platformName(p.platform)}`)),
    h('td', null, fmtDate(p.publishedAt)),
    h('td', null, fmt(p.views)), h('td', null, fmt(p.likes)), h('td', null, fmt(p.comments)), h('td', null, fmt(p.shares)), h('td', null, fmt(p.saves)),
    h('td', null, p.views ? pct(p.er) : '—'),
    h('td', null, p.completion != null ? dec(p.completion, 1) + '%' : '—'),
    h('td', null, p.watchSec != null ? dec(p.watchSec, 1) + 's' : '—')));

  content.replaceChildren(h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', null, h('h2', { class: 'card-title' }, 'Top video'),
        h('p', { class: 'card-sub' }, `${fmt(j.total)} bài khớp bộ lọc, hiển thị ${j.posts.length} · snapshot ${fmtTime(j.generatedAt)}. Xếp theo tỷ lệ chỉ tính bài từ 100 views trở lên.`)),
      filters),
    j.posts.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 't vt' }, h('thead', null, h('tr', null, cols.map((c, i) => h('th', { class: i < 2 ? 'left' : '' }, c)))), h('tbody', null, rows)))
      : h('div', { class: 'empty' }, 'Không có bài nào khớp bộ lọc'),
    h('p', { class: 'note', style: 'margin-top:12px' }, 'ER = (thích + bình luận + chia sẻ + lưu) / views. Tỷ lệ xem hết và thời gian xem trung bình chỉ có ở nền tảng Zernio cung cấp (hiện chủ yếu TikTok); Facebook chỉ có thời gian xem trung bình.')));
}

function postThumb(p) {
  const label = p.mediaType === 'video' ? 'video' : 'ảnh';
  return p.thumb
    ? h('img', { class: 'thumb sm', src: p.thumb, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => e.target.replaceWith(h('div', { class: 'thumb sm' }, label)) })
    : h('div', { class: 'thumb sm' }, label);
}

// ---------- tab Đánh giá tuần ----------
const GRADE = {
  surge: { label: 'Tăng tốc', tone: 'good', rank: 0 },
  growing: { label: 'Tăng trưởng tốt', tone: 'good', rank: 1 },
  steady: { label: 'Ổn định', tone: 'muted', rank: 2 },
  slowing: { label: 'Chững lại', tone: 'warning', rank: 3 },
  declining: { label: 'Giảm', tone: 'critical', rank: 4 },
  inactive: { label: 'Không đăng bài', tone: 'critical', rank: 5 },
  nodata: { label: 'Thiếu dữ liệu', tone: 'muted', rank: 6 },
};
const gradeBadge = (g) => h('span', { class: `grade ${(GRADE[g] || GRADE.nodata).tone}` }, (GRADE[g] || GRADE.nodata).label);
const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
const wstate = { week: '', group: '', sort: 'grade' };

async function renderWeeklyTab() {
  const content = $('content');
  content.replaceChildren(loadingCard('Đang tải báo cáo tuần…'));
  let w;
  try { w = await getJson(`/api/weekly${wstate.week ? `?week=${wstate.week}` : ''}`); } catch (err) {
    if (state.tab === 'weekly') content.replaceChildren(emptyCard(err.message));
    return;
  }
  if (state.tab !== 'weekly') return;

  const groups = [...new Set(w.channels.map((c) => c.group))];
  let rows = w.channels.filter((c) => !wstate.group || c.group === wstate.group);
  const by = {
    grade: (a, b) => (GRADE[a.grade]?.rank ?? 9) - (GRADE[b.grade]?.rank ?? 9) || (b.week?.views || 0) - (a.week?.views || 0),
    views: (a, b) => (b.week?.views || 0) - (a.week?.views || 0),
    growth: (a, b) => (b.viewsChange ?? -1e9) - (a.viewsChange ?? -1e9),
    followers: (a, b) => (b.followerGain || 0) - (a.followerGain || 0),
    er: (a, b) => (b.week?.er || 0) - (a.week?.er || 0),
  };
  rows = [...rows].sort(by[wstate.sort]);
  const redo = (patch) => { Object.assign(wstate, patch); renderWeeklyTab(); };

  const counts = {};
  for (const c of w.channels) counts[c.grade] = (counts[c.grade] || 0) + 1;
  const summary = h('div', { class: 'wk-summary' }, Object.entries(GRADE).filter(([k]) => counts[k]).map(([k, g]) =>
    h('div', { class: 'card tile' }, h('p', { class: 'tile-label' }, g.label), h('p', { class: 'tile-value' }, String(counts[k])))));

  const toolbar = h('div', { class: 'toolbar' },
    select('Tuần', (w.weeks.length ? w.weeks : [w.week]).map((k) => [k, k]), w.week, (v) => redo({ week: v })),
    select('Nhóm', [['', 'Tất cả'], ...groups.map((g) => [g, g])], wstate.group, (v) => redo({ group: v })),
    select('Xếp theo', [['grade', 'Đánh giá'], ['views', 'Views'], ['growth', '% views so với tuần trước'], ['followers', 'Follower tăng'], ['er', 'Tỷ lệ tương tác']], wstate.sort, (v) => redo({ sort: v })));

  content.replaceChildren(
    h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('div', null, h('h2', { class: 'card-title' }, `Đánh giá tuần ${w.week}`),
          h('p', { class: 'card-sub' }, `${w.from} → ${w.to} · so với 7 ngày liền trước · ER trung vị hệ thống ${w.systemMedianEr != null ? pct(w.systemMedianEr) : '—'}`)),
        toolbar),
      h('p', { class: 'note' }, 'Điểm dựa trên: thay đổi views, follower ròng, tỷ lệ tương tác so với trung vị hệ thống. Nhận xét nội dung là phân tích số liệu từng bài (bài nổi bật, bài kém, tần suất, tỷ lệ xem hết), chưa đọc nội dung video.')),
    summary,
    h('div', { class: 'wk-grid' }, rows.map(weeklyCard)));
}

function weeklyCard(c) {
  if (!c.week) return h('section', { class: 'card wk' }, h('div', { class: 'wk-head' }, h('h3', { class: 'card-title' }, c.label || c.name), gradeBadge(c.grade)), h('p', { class: 'note' }, (c.insights || []).join(' ')));
  const w = c.week, p = c.prev;
  const metric = (label, value, note) => h('div', null, h('span', { class: 'm-label' }, label), h('b', null, value), note && h('span', { class: 'm-note' }, note));
  return h('section', { class: 'card wk' },
    h('div', { class: 'wk-head' }, h('div', null, h('h3', { class: 'card-title' }, c.label || c.name), h('p', { class: 'card-sub' }, c.group)), gradeBadge(c.grade)),
    h('div', { class: 'wk-metrics' },
      metric('Follower', fmt(c.followers), `${signed(c.followerGain)}${c.followerGainPct != null ? ` (${c.followerGainPct >= 0 ? '+' : '−'}${dec(Math.abs(c.followerGainPct), 1)}%)` : ''}`),
      metric('Views', compact(w.views), c.viewsChange != null ? delta(w.views, p.views) : `trước ${compact(p.views)}`),
      metric('Tương tác', w.views ? pct(w.er) : '—', p.views ? `trước ${pct(p.er)}` : null),
      metric('Bài đăng', fmt(w.posts), `trước ${fmt(p.posts)}`),
      metric('Xem hết', w.completion != null ? dec(w.completion, 1) + '%' : '—', w.watchSec != null ? `TB ${dec(w.watchSec, 1)}s` : null)),
    h('ul', { class: 'insights' }, c.insights.map((t) => h('li', null, t))),
    commentaryBlock(c),
    c.platforms?.length ? h('p', { class: 'note' }, c.platforms.map((x) => `${platformName(x.platform)}: ${x.posts} bài, ${compact(x.views)} views, ER ${x.views ? pct(x.er) : '—'}`).join(' · ')) : null,
    c.topPosts?.length ? h('details', { class: 'wk-posts' }, h('summary', null, `Top ${c.topPosts.length} bài trong tuần`),
      h('ul', { class: 'posts' }, c.topPosts.map((tp) => weeklyPost(tp)))) : null);
}

// Nhận xét nội dung do Claude viết hằng tuần (nếu đã có cho tuần này).
function commentaryBlock(c) {
  return c.commentary
    ? h('div', { class: 'commentary' }, h('b', null, c.commentaryWeek ? `Nhận xét nội dung (tuần ${c.commentaryWeek})` : 'Nhận xét nội dung'), h('p', null, c.commentary))
    : null;
}

function weeklyPost(p) {
  return h('li', { class: 'post' }, postThumb(p),
    h('div', { class: 'post-body' }, h('p', { class: 'post-text' }, p.content || '(không có nội dung)'),
      h('p', { class: 'post-meta' }, [platformName(p.platform), fmtDate(p.publishedAt), watchText(p)].filter(Boolean).join(' · '),
        p.url && h('a', { class: 'post-link', href: p.url, target: '_blank', rel: 'noopener noreferrer' }, 'Mở bài ↗'))),
    h('div', { class: 'post-stats' },
      h('div', null, h('b', null, compact(p.views)), h('span', null, 'views')),
      h('div', null, h('b', null, compact(p.likes)), h('span', null, 'thích')),
      h('div', null, h('b', null, p.views ? pct(p.er) : '—'), h('span', null, 'ER'))));
}

// ---------- bổ sung cho ngăn chi tiết kênh ----------

// Số follower theo ngày dựng ngược từ mức tăng ròng mỗi ngày của Zernio (chính xác với số hiện tại, ước tính cho quá khứ).
function followerSeriesCard(c) {
  const daily = c.daily || [];
  if (daily.length < 2) return null;
  const rows = new Array(daily.length);
  let cur = c.followers.current;
  for (let i = daily.length - 1; i >= 0; i--) {
    rows[i] = { date: daily[i].date, followers: Math.max(0, cur), gained: daily[i].followersGained };
    cur -= daily[i].followersGained;
  }
  return chartCard({
    title: 'Tổng follower theo ngày', sub: 'Dựng ngược từ số hiện tại và mức tăng/giảm ròng mỗi ngày',
    rows, columns: [{ label: 'Ngày', get: (r) => fmtDay(r.date) + '/' + r.date.slice(0, 4) }, { label: 'Follower', get: (r) => fmt(r.followers) }, { label: 'Thay đổi', get: (r) => signed(r.gained) }],
    draw: (host) => lineChart(host, rows, { key: 'followers', label: 'follower', title: 'Tổng follower theo ngày' }),
  });
}

// Đánh giá tuần của kênh, nạp bất đồng bộ từ báo cáo mới nhất.
function weeklyDrawerCard(name) {
  const box = h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { class: 'card-title' }, 'Đánh giá tuần')), h('div', { class: 'empty' }, 'Đang tải…'));
  getJson('/api/weekly').then((w) => {
    const c = w.channels.find((x) => x.name === name);
    box.replaceChildren(
      h('div', { class: 'card-head' }, h('div', null, h('h3', { class: 'card-title' }, `Đánh giá tuần ${w.week}`), h('p', { class: 'card-sub' }, `${w.from} → ${w.to}`)), c ? gradeBadge(c.grade) : null),
      c ? h('ul', { class: 'insights' }, c.insights.map((t) => h('li', null, t)))
        : h('p', { class: 'note' }, 'Kênh này không có trong báo cáo tuần (có thể trùng tài khoản với kênh khác).'),
      c ? commentaryBlock(c) : null);
  }).catch((err) => box.replaceChildren(h('div', { class: 'card-head' }, h('h3', { class: 'card-title' }, 'Đánh giá tuần')), h('p', { class: 'note' }, err.message)));
  return box;
}

// ---------- khởi động ----------
try { const t = localStorage.getItem('tab'); if (TABS.some(([k]) => k === t)) state.tab = t; } catch { /* không có localStorage */ }
renderTabs();
if (state.tab !== 'overview') showTab();
