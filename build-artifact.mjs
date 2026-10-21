// Dựng bản tĩnh để đăng lên Artifact từ snapshot mới nhất:
//   artifact/index.html  trang (CSS + JS nhúng sẵn), ít khi đổi
//   artifact/data.json   dữ liệu ảnh chụp, đổi mỗi ngày
//   node build-artifact.mjs
// Dữ liệu chỉ gồm số liệu kênh/bài đăng công khai. Có bước kiểm tra để không lọt API key.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, KEYS } from './core.mjs';
import { summarize } from './summary.mjs';
import { retentionOf } from './report.mjs';

const DATA = path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'artifact');
const DAY = 864e5;
const PERIODS = [7, 14, 30];     // snapshot chỉ có 30 ngày daily nên chỉ dựng các khoảng này
const WEEKS_KEPT = 6;
const THUMBS_PER_CHANNEL = 20;   // link ảnh bìa dài nên chỉ giữ cho các bài nổi bật

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const readJson = async (f) => JSON.parse(await readFile(f, 'utf8'));
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

// ---------- đọc đầu vào ----------
const snapFiles = (await readdir(path.join(DATA, 'snapshots'))).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
if (!snapFiles.length) { console.error('Chưa có snapshot. Chạy snapshot.mjs trước.'); process.exit(1); }
const snap = await readJson(path.join(DATA, 'snapshots', snapFiles.at(-1)));
// Tên hiển thị (channels.json → labels); tra cứu vẫn dùng tên khóa
const LABELS = (await readJson(path.join(ROOT, 'channels.json'))).labels || {};
const label = (name) => LABELS[name] || name;

// ---------- tổng quan theo từng khoảng ngày ----------
function sumDaily(rows) {
  const o = { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, views: 0, engagement: 0 };
  for (const r of rows) {
    o.views += num(r.views); o.reach += num(r.reach); o.impressions += num(r.impressions); o.engagement += num(r.engagement);
  }
  o.er = o.views > 0 ? (o.engagement / o.views) * 100 : 0;
  return o;
}

const postView = (p) => {
  const r = retentionOf(p.extra);
  return {
    id: p.id, platform: p.platform, content: p.content, publishedAt: p.publishedAt, url: p.url, thumb: p.thumb, mediaType: p.mediaType,
    views: num(p.views), likes: num(p.likes), comments: num(p.comments), shares: num(p.shares), saves: num(p.saves),
    completion: r.completion, watchSec: r.watchSec, retention: r.retention,
  };
};
const erOf = (p) => { const e = p.likes + p.comments + p.shares + p.saves; return p.views > 0 ? (e / p.views) * 100 : 0; };

function overviewFor(days) {
  const nowMs = Date.parse(snap.generatedAt);
  const since = nowMs - days * DAY;
  const to = snap.date;
  const from = iso(Date.parse(`${to}T00:00:00Z`) - (days - 1) * DAY);
  const range = { days, from, to, prevFrom: iso(Date.parse(from) - days * DAY), prevTo: iso(Date.parse(from) - DAY) };

  const channels = snap.channels.map((c) => {
    if (c.error) return { name: c.name, group: c.group, error: c.error, warn: null, duplicateOf: null, sharedWith: [], accounts: [], posts: 0 };
    const exact = days === 30;
    const cur = c.daily.slice(-days), prv = c.daily.slice(-2 * days, -days);
    const inWindow = c.posts.filter((p) => Date.parse(p.publishedAt) >= since);
    return {
      name: c.name, group: c.group, error: null, warn: c.warn || null, duplicateOf: null, sharedWith: [],
      accounts: exact ? c.accounts : c.accounts.map((a) => ({ ...a, gained: null })),
      totals: exact ? c.totals : sumDaily(cur),
      prev: exact ? c.prev : sumDaily(prv),
      followers: exact ? c.followers : {
        current: c.followers.current,
        gained: cur.reduce((s, r) => s + num(r.followersGained), 0),
        prevGained: prv.reduce((s, r) => s + num(r.followersGained), 0),
      },
      posts: inWindow.length,
      daily: cur,
      dataAsOf: c.dataAsOf,
      topPosts: [...inWindow].sort((a, b) => num(b.views) - num(a.views)).slice(0, 5)
        .map((p) => ({ ...postView(p), channel: c.name, er: erOf(postView(p)) })),
    };
  });

  for (const c of channels) c.label = label(c.name);
  const summary = summarize(channels, range);
  const topPosts = summary.topPosts;
  delete summary.topPosts;
  for (const c of channels) delete c.topPosts;
  return { generatedAt: snap.generatedAt, range, summary, channels, topPosts };
}

// ---------- bài đăng (gọn) ----------
const posts = {};
for (const c of snap.channels) {
  if (c.error) continue;
  const ranked = [...c.posts].sort((a, b) => num(b.views) - num(a.views));
  const withThumb = new Set(ranked.slice(0, THUMBS_PER_CHANNEL).map((p) => p.id));
  posts[c.name] = c.posts.map((p) => {
    const v = postView(p);
    return { ...v, content: String(v.content || '').slice(0, 160), thumb: withThumb.has(p.id) ? v.thumb : null };
  });
}

// ---------- báo cáo tuần + nhận xét nội dung ----------
const weekly = {};
let weekFiles = [];
try { weekFiles = (await readdir(path.join(DATA, 'weekly'))).filter((f) => /^\d{4}-W\d{2}\.json$/.test(f)).sort().slice(-WEEKS_KEPT); } catch { /* chưa có */ }
// Nhận xét nội dung viết vào đầu tuần; các ngày giữa tuần dùng lại nhận xét gần nhất và ghi rõ là của tuần nào.
let commentFiles = [];
try { commentFiles = (await readdir(path.join(DATA, 'commentary'))).filter((f) => /^\d{4}-W\d{2}\.json$/.test(f)).sort(); } catch { /* chưa có */ }
for (const f of weekFiles) {
  const w = await readJson(path.join(DATA, 'weekly', f));
  const own = `${w.week}.json`;
  const useFile = commentFiles.includes(own) ? own : commentFiles.filter((x) => x < own).at(-1);
  let commentary = {};
  if (useFile) { try { commentary = await readJson(path.join(DATA, 'commentary', useFile)); } catch { /* bỏ qua file hỏng */ } }
  const latest = f === weekFiles.at(-1);
  for (const c of w.channels) {
    c.label = label(c.name);
    if (commentary[c.name]) {
      c.commentary = String(commentary[c.name]).slice(0, 1200);
      if (useFile !== own) c.commentaryWeek = useFile.slice(0, 8);
    }
    if (!latest) for (const p of c.topPosts || []) p.thumb = null;
    if (c.worstPost && !latest) c.worstPost.thumb = null;
  }
  weekly[w.week] = w;
}

const out = {
  date: snap.date, generatedAt: snap.generatedAt,
  channels: snap.channels.filter((c) => !c.error).map((c) => c.name),
  platforms: [...new Set(Object.values(posts).flatMap((l) => l.map((p) => p.platform)))].sort(),
  overviews: Object.fromEntries(PERIODS.map((d) => [d, overviewFor(d)])),
  posts, weekly,
};
const text = JSON.stringify(out);

// ---------- kiểm tra an toàn trước khi đăng ----------
const problems = [];
for (const [name, key] of KEYS) if (text.includes(key)) problems.push(`chứa API key của ${name}`);
if (/sk_[0-9a-f]{24,}/i.test(text)) problems.push('có chuỗi dạng sk_… (API key)');
if (/Bearer\s+[A-Za-z0-9._-]{16,}/.test(text)) problems.push('có chuỗi dạng "Bearer …"');
if (problems.length) { console.error('DỪNG: dữ liệu không an toàn để đăng: ' + problems.join('; ')); process.exit(2); }
const emails = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || [];

// ---------- trang HTML ----------
const css = await readFile(path.join(ROOT, 'public', 'style.css'), 'utf8');
const markup = (await readFile(path.join(ROOT, 'public', 'index.html'), 'utf8')).replace(/^[\s\S]*<body>/, '').replace(/<script[\s\S]*$/, '').trim();
const js = [
  await readFile(path.join(ROOT, 'artifact-src', 'static-api.js'), 'utf8'),
  await readFile(path.join(ROOT, 'public', 'app.js'), 'utf8'),
  await readFile(path.join(ROOT, 'public', 'insights.js'), 'utf8'),
].join('\n;\n');
if (js.includes('</script')) { console.error('DỪNG: mã JS chứa "</script", không nhúng an toàn được.'); process.exit(2); }

const html = `<title>Dashboard kênh social</title>
<style>
${css}
</style>
${markup}
<script id="app-src" type="text/plain">
${js}
</script>
<script>
fetch('data.json').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (d) {
  window.__SNAPSHOT__ = d;
  var s = document.createElement('script');
  s.textContent = document.getElementById('app-src').textContent;
  document.body.appendChild(s);
}).catch(function (e) {
  document.getElementById('content').textContent = 'Không tải được dữ liệu: ' + e.message;
});
</script>
`;

await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, 'data.json'), text);
await writeFile(path.join(OUT, 'index.html'), html);

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log(`Snapshot ${snap.date} (${snap.generatedAt})`);
console.log(`  kênh: ${out.channels.length}, bài: ${Object.values(posts).reduce((s, l) => s + l.length, 0)}, tuần: ${Object.keys(weekly).join(', ') || '—'}`);
console.log(`  nhận xét nội dung: ${Object.values(weekly).at(-1)?.channels.filter((c) => c.commentary).length ?? 0} kênh`);
console.log(`  artifact/data.json ${kb(Buffer.byteLength(text))}, artifact/index.html ${kb(Buffer.byteLength(html))}`);
console.log(`  kiểm tra an toàn: không có API key${emails.length ? `; có ${emails.length} địa chỉ email trong caption bài đăng` : ''}`);
