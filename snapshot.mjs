// Job hằng ngày: chụp số liệu mọi kênh từ Zernio vào data/, rồi dựng báo cáo tuần.
//   node snapshot.mjs                 chụp tất cả kênh trong channels.json
//   node snapshot.mjs --only=PA_1,PA_2  chỉ chụp vài kênh (để thử)
//   node snapshot.mjs --no-weekly     bỏ qua bước dựng báo cáo tuần
//   node snapshot.mjs --weekly-only   không gọi Zernio, dựng lại báo cáo tuần từ snapshot mới nhất
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, CHANNELS, KEYS, zGet, loadChannel, makeRange, normPost, isoDay } from './core.mjs';
import { buildWeekly } from './report.mjs';

const DATA = path.join(ROOT, 'data');
const SNAP_DIR = path.join(DATA, 'snapshots');
const WEEK_DIR = path.join(DATA, 'weekly');
const HISTORY = path.join(DATA, 'history.json');
const SNAP_FILE = /^\d{4}-\d{2}-\d{2}\.json$/;
const DAYS = 30;          // cửa sổ bài đăng lấy mỗi lần
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

const args = new Map(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const only = args.get('only') ? new Set(String(args.get('only')).split(',')) : null;

async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(data));
  await rename(tmp, file);
}
async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

async function fetchPosts(key, channel, range) {
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await zGet(key, '/analytics', { fromDate: range.from, toDate: range.to, sortBy: 'date', order: 'desc', limit: PAGE_SIZE, page });
    const batch = r.posts || [];
    out.push(...batch.map((p) => normPost(p, channel)));
    if (batch.length < PAGE_SIZE) break;
  }
  return out;
}

async function snapshotChannel(ch, range) {
  const base = await loadChannel(ch, range);
  if (base.error) return { name: ch.name, group: ch.group, error: base.error };
  let posts = [], postsError = null;
  try { posts = await fetchPosts(KEYS.get(ch.name), ch.name, range); } catch (e) { postsError = e.message; }
  return {
    name: ch.name, group: ch.group, error: null, warn: base.warn || postsError,
    accounts: base.accounts, followers: base.followers, totals: base.totals, prev: base.prev,
    daily: base.daily, dataAsOf: base.dataAsOf, postCount: base.posts, posts,
  };
}

function nearest(dates, target) {
  let best = null, gap = Infinity;
  for (const d of dates) {
    const g = Math.abs(Date.parse(d) - Date.parse(target));
    if (g < gap) { gap = g; best = d; }
  }
  return best;
}

async function makeWeekly(snapshot) {
  const dates = (await readdir(SNAP_DIR)).filter((f) => SNAP_FILE.test(f)).map((f) => f.slice(0, 10)).filter((d) => d < snapshot.date);
  const weekAgo = new Date(Date.parse(snapshot.date) - 7 * 864e5).toISOString().slice(0, 10);
  const olderDate = nearest(dates.filter((d) => Math.abs(Date.parse(d) - Date.parse(weekAgo)) <= 3 * 864e5), weekAgo);
  const older = olderDate ? await readJson(path.join(SNAP_DIR, `${olderDate}.json`), null) : null;
  const weekly = buildWeekly(snapshot, older);
  await writeJson(path.join(WEEK_DIR, `${weekly.week}.json`), weekly);
  await writeJson(path.join(WEEK_DIR, 'latest.json'), weekly);
  console.log(`Đã dựng báo cáo tuần ${weekly.week} (${weekly.from} → ${weekly.to})${older ? `, đối chiếu snapshot ${olderDate}` : ', chưa có snapshot tuần trước nên follower dùng số Zernio ghi nhận'}.`);
}

const today = isoDay(Date.now());

if (args.get('weekly-only')) {
  const files = (await readdir(SNAP_DIR)).filter((f) => SNAP_FILE.test(f)).sort();
  if (!files.length) { console.error('Chưa có snapshot nào.'); process.exit(1); }
  await makeWeekly(JSON.parse(await readFile(path.join(SNAP_DIR, files[files.length - 1]), 'utf8')));
  process.exit(0);
}
const range = makeRange(DAYS);
const list = CHANNELS.filter((c) => !only || only.has(c.name));
console.log(`[${new Date().toISOString()}] Chụp ${list.length} kênh, cửa sổ ${range.from} → ${range.to}`);

let done = 0;
const channels = await Promise.all(list.map(async (ch) => {
  const r = await snapshotChannel(ch, range);
  console.log(`  ${String(++done).padStart(2)}/${list.length} ${ch.name}: ${r.error ? 'LỖI ' + r.error : `${r.accounts.length} tài khoản, ${r.posts.length} bài`}`);
  return r;
}));

const failed = channels.filter((c) => c.error).length;
if (failed === channels.length) { console.error('Tất cả kênh đều lỗi, không ghi snapshot.'); process.exit(1); }

const snapshot = { date: today, generatedAt: new Date().toISOString(), range, channels };
await writeJson(path.join(SNAP_DIR, `${today}.json`), snapshot);

// Lịch sử gọn theo ngày để vẽ biểu đồ follower dài hạn mà không phải đọc cả snapshot.
const history = await readJson(HISTORY, {});
history[today] = Object.fromEntries(channels.filter((c) => !c.error).map((c) => [c.name, {
  followers: c.followers.current,
  accounts: Object.fromEntries(c.accounts.map((a) => [a.id, a.followers])),
  views: c.totals.views, engagement: c.totals.engagement, posts: c.postCount,
}]));
await writeJson(HISTORY, history);
console.log(`Đã ghi snapshot ${today} (${failed} kênh lỗi).`);

if (!args.get('no-weekly')) await makeWeekly(snapshot);
