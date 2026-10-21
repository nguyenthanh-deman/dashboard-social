// Dashboard social — server cục bộ, không cần cài thêm gói nào (Node >= 20).
// Đọc API key từ .env, gọi Zernio ở phía server, trình duyệt không bao giờ thấy key.
import http from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  ROOT, DAY, CHANNELS, CHANNEL_NAMES, KEYS, zGet, normPost, makeRange, loadChannel,
} from './core.mjs';
import { retentionOf } from './report.mjs';
import { summarize } from './summary.mjs';

const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const CACHE_TTL = 10 * 60 * 1000;

// ---------- snapshot hằng ngày (do snapshot.mjs ghi vào data/) ----------

const DATA = path.join(ROOT, 'data');
const snapCache = { file: '', mtime: 0, data: null };

// Snapshot mới nhất, đọc lại khi file đổi (job hằng ngày có thể chạy lúc server đang mở).
async function latestSnapshot() {
  const dir = path.join(DATA, 'snapshots');
  let files;
  try { files = (await readdir(dir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort(); } catch { return null; }
  if (!files.length) return null;
  const file = path.join(dir, files[files.length - 1]);
  const { mtimeMs } = await stat(file);
  if (snapCache.file !== file || snapCache.mtime !== mtimeMs) {
    snapCache.data = JSON.parse(await readFile(file, 'utf8'));
    snapCache.file = file; snapCache.mtime = mtimeMs;
  }
  return snapCache.data;
}

async function readWeekly(week) {
  const name = /^\d{4}-W\d{2}$/.test(week || '') ? week : 'latest';
  try { return JSON.parse(await readFile(path.join(DATA, 'weekly', name + '.json'), 'utf8')); } catch { return null; }
}

async function listWeeks() {
  try { return (await readdir(path.join(DATA, 'weekly'))).filter((f) => /^\d{4}-W\d{2}\.json$/.test(f)).map((f) => f.slice(0, 8)).sort().reverse(); } catch { return []; }
}

const POST_SORTS = {
  views: (p) => p.views,
  engagement: (p) => p.likes + p.comments + p.shares + p.saves,
  er: (p) => (p.views >= 100 ? p.er : -1),            // bỏ bài quá ít views để ER không bị nhiễu
  completion: (p) => (p.views >= 100 && p.completion !== null ? p.completion : -1),
  date: (p) => Date.parse(p.publishedAt) || 0,
};

// Top bài từ snapshot: lọc theo ngày/kênh/nền tảng rồi sắp xếp, không phải gọi lại Zernio.
async function topPosts(q) {
  const snap = await latestSnapshot();
  if (!snap) return null;
  const days = clamp(q.get('days'), 1, 30, 7);
  const since = Date.parse(snap.generatedAt) - days * DAY;
  const sortKey = POST_SORTS[q.get('sort')] ? q.get('sort') : 'views';
  const channel = q.get('channel'), platform = q.get('platform');
  const seen = new Set();
  const rows = [];
  for (const c of snap.channels) {
    if (c.error || (channel && c.name !== channel)) continue;
    for (const p of c.posts) {
      if (platform && p.platform !== platform) continue;
      if (Date.parse(p.publishedAt) < since) continue;
      if (seen.has(p.id)) continue;       // cùng một bài xuất hiện ở hai kênh dùng chung tài khoản
      seen.add(p.id);
      const r = retentionOf(p.extra);
      const eng = p.likes + p.comments + p.shares + p.saves;
      rows.push({ ...p, extra: undefined, engagement: eng, er: p.views > 0 ? (eng / p.views) * 100 : 0, completion: r.completion, watchSec: r.watchSec, retention: r.retention });
    }
  }
  const key = POST_SORTS[sortKey];
  rows.sort((a, b) => key(b) - key(a));
  return {
    date: snap.date, generatedAt: snap.generatedAt, total: rows.length,
    channels: snap.channels.filter((c) => !c.error).map((c) => c.name),
    platforms: [...new Set(snap.channels.flatMap((c) => (c.posts || []).map((p) => p.platform)))].sort(),
    posts: rows.slice(0, clamp(q.get('limit'), 1, 100, 50)),
  };
}

// ---------- cache + tiến trình ----------

const jobs = new Map(); // days -> { at, data, promise, done, total }

async function buildOverview(days, job) {
  const range = makeRange(days);
  job.total = CHANNELS.length; job.done = 0;
  const channels = await Promise.all(CHANNELS.map(async (ch) => {
    const r = await loadChannel(ch, range);
    job.done++;
    return r;
  }));
  const summary = summarize(channels, range);
  const topPosts = summary.topPosts; delete summary.topPosts;
  for (const c of channels) delete c.topPosts;
  return { generatedAt: new Date().toISOString(), range, summary, channels, topPosts };
}

function getOverview(days, refresh) {
  let job = jobs.get(days);
  const fresh = job?.data && Date.now() - job.at < CACHE_TTL;
  if (job?.promise) return job.promise;
  if (fresh && !refresh) return Promise.resolve(job.data);
  job = job || { at: 0, data: null, promise: null, done: 0, total: CHANNELS.length };
  jobs.set(days, job);
  job.promise = buildOverview(days, job)
    .then((data) => { job.data = data; job.at = Date.now(); return data; })
    .finally(() => { job.promise = null; });
  return job.promise;
}

// ---------- HTTP ----------

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8' };
const clamp = (v, lo, hi, dflt) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function handleApi(url, res) {
  const days = clamp(url.searchParams.get('days'), 1, 366, 30);

  if (url.pathname === '/api/overview') {
    try { return sendJson(res, 200, await getOverview(days, url.searchParams.get('refresh') === '1')); }
    catch (err) { return sendJson(res, 502, { error: err.message }); }
  }
  if (url.pathname === '/api/status') {
    const job = jobs.get(days);
    return sendJson(res, 200, { loading: !!job?.promise, done: job?.done || 0, total: job?.total || CHANNELS.length });
  }
  if (url.pathname === '/api/top-posts') {
    const r = await topPosts(url.searchParams);
    return r ? sendJson(res, 200, r) : sendJson(res, 404, { error: 'Chưa có snapshot. Chạy snapshot.mjs (hoặc run-daily.bat) để tạo dữ liệu.' });
  }
  if (url.pathname === '/api/weekly') {
    const w = await readWeekly(url.searchParams.get('week'));
    return w ? sendJson(res, 200, { ...w, weeks: await listWeeks() }) : sendJson(res, 404, { error: 'Chưa có báo cáo tuần. Chạy snapshot.mjs để tạo.' });
  }
  if (url.pathname === '/api/snapshot-info') {
    const snap = await latestSnapshot();
    return sendJson(res, 200, snap ? { date: snap.date, generatedAt: snap.generatedAt, channels: snap.channels.length } : { date: null });
  }
  const m = url.pathname.match(/^\/api\/channel\/([A-Za-z0-9_]+)\/posts$/);
  if (m) {
    const name = m[1];
    const key = KEYS.get(name);
    if (!CHANNEL_NAMES.has(name) || !key) return sendJson(res, 404, { error: 'Không có kênh này' });
    const sort = ['views', 'date', 'engagement', 'completion_rate'].includes(url.searchParams.get('sort')) ? url.searchParams.get('sort') : 'views';
    const range = makeRange(days);
    try {
      const r = await zGet(key, '/analytics', { fromDate: range.from, toDate: range.to, sortBy: sort, order: 'desc', limit: clamp(url.searchParams.get('limit'), 1, 50, 15) });
      return sendJson(res, 200, { posts: (r.posts || []).map((p) => normPost(p, name)) });
    } catch (err) { return sendJson(res, 502, { error: err.message }); }
  }
  return sendJson(res, 404, { error: 'Không tìm thấy' });
}

async function handleStatic(url, res) {
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(url, res);
    else await handleStatic(url, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: 'Lỗi máy chủ' });
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Dashboard: http://localhost:${PORT}`);
});
