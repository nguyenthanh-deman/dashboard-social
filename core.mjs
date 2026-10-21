// Lõi dùng chung của server.mjs và snapshot.mjs: đọc cấu hình, gọi Zernio, chuẩn hoá dữ liệu.
// API key đọc từ .env, chỉ dùng ở phía server, trình duyệt không bao giờ thấy key.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { retentionOf } from './report.mjs';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
const API = 'https://zernio.com/api/v1';
const CONCURRENCY = 6;
export const DAY = 864e5;

// ---------- cấu hình: kênh + API key ----------

const config = JSON.parse(await readFile(path.join(ROOT, 'channels.json'), 'utf8'));
export const CHANNELS = config.groups.flatMap((g) => g.channels.map((name) => ({ name, group: g.group })));
export const CHANNEL_NAMES = new Set(CHANNELS.map((c) => c.name));

// Chấp nhận cả `TEN [sk_...]` lẫn `TEN=sk_...`. Chỉ giữ khóa của kênh có trong channels.json.
function parseEnv(text) {
  const keys = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_.]+)\s*=?\s*["']?\[?\s*(sk_[0-9A-Za-z]+)\s*\]?["']?\s*$/);
    if (m && CHANNEL_NAMES.has(m[1])) keys.set(m[1], m[2]);
  }
  return keys;
}
export const KEYS = parseEnv(await readFile(path.join(ROOT, '.env'), 'utf8'));
console.log(`Đã nạp ${KEYS.size}/${CHANNELS.length} API key của các kênh trong channels.json`);

// ---------- gọi Zernio ----------

function limiter(max) {
  let active = 0;
  const queue = [];
  const pump = () => {
    if (active >= max || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => { active--; pump(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); pump(); });
}
const limit = limiter(CONCURRENCY);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function zGet(key, pathname, query = {}) {
  const url = new URL(API + pathname);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await limit(() => fetch(url, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(30000),
      }));
    } catch (err) {
      if (attempt < 2) { await sleep(800 * 2 ** attempt); continue; }
      throw new ApiError(0, 'Không kết nối được tới Zernio');
    }
    if (res.ok) return res.json();
    const body = await res.json().catch(() => null);
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 800 * 2 ** attempt);
      continue;
    }
    throw new ApiError(res.status, body?.error || res.statusText || 'Lỗi không xác định');
  }
}

// ---------- chuẩn hoá dữ liệu ----------

export const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);
export const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

const ZERO_TOTALS = { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, views: 0 };

export function normTotals(t = {}) {
  const o = {};
  for (const k of Object.keys(ZERO_TOTALS)) o[k] = num(t[k]);
  o.engagement = o.likes + o.comments + o.shares + o.saves;
  o.er = o.views > 0 ? (o.engagement / o.views) * 100 : 0; // trùng công thức engagementRate của Zernio
  return o;
}
export function addTotals(a, b) {
  const o = {};
  for (const k of Object.keys(ZERO_TOTALS)) o[k] = a[k] + b[k];
  o.engagement = o.likes + o.comments + o.shares + o.saves;
  o.er = o.views > 0 ? (o.engagement / o.views) * 100 : 0;
  return o;
}

function issueText(i) {
  if (!i) return '';
  if (typeof i === 'string') return i;
  return i.message || i.description || i.title || i.code || '';
}

function accountState(acc, health) {
  const issues = (health?.issues || []).map(issueText).filter(Boolean);
  const meta = acc.metadata || {};
  const refreshErr = meta.tokenRefreshError || meta.lastRefreshFailureReason || '';
  const detail = issues[0] || refreshErr || '';
  if (acc.needsReconnection || health?.needsReconnect || health?.status === 'error') {
    return { state: 'error', reason: 'Cần kết nối lại tài khoản', detail };
  }
  if (acc.isActive === false) {
    return { state: 'error', reason: /reconnect|expired|invalid/i.test(refreshErr) ? 'Token hết hạn, cần kết nối lại' : 'Tài khoản không hoạt động', detail };
  }
  if (acc.enabled === false) return { state: 'warning', reason: 'Tài khoản đang bị tắt', detail };
  if (health?.status === 'warning') return { state: 'warning', reason: 'Cảnh báo từ Zernio', detail };
  return { state: 'ok', reason: '', detail: '' };
}

const STD_METRICS = new Set(['impressions', 'reach', 'likes', 'comments', 'shares', 'saves', 'clicks', 'views', 'engagementRate']);

// Chỉ số riêng từng nền tảng (xem hết video, thời gian xem, skip...) nằm ngoài bộ chuẩn: giữ nguyên tên để hiển thị/lưu lại.
function extraMetrics(p) {
  const extra = {};
  const sources = [p.analytics || {}, ...(p.platformAnalytics || []).map((x) => x.analytics || {})];
  for (const src of sources) {
    for (const [k, v] of Object.entries(src)) {
      if (!STD_METRICS.has(k) && typeof v === 'number' && Number.isFinite(v) && !(k in extra)) extra[k] = v;
    }
  }
  return extra;
}

export function normPost(p, channel) {
  const a = p.analytics || {};
  const extra = extraMetrics(p);
  return {
    id: p._id || p.postId,
    channel,
    username: p.platformAnalytics?.[0]?.accountUsername || '',
    extra,
    ...retentionOf(extra),   // completion (% xem hết), watchSec (giây xem TB), retention (% độ dài video)
    clicks: num(a.clicks),
    platform: p.platform,
    content: String(p.content || '').slice(0, 240),
    publishedAt: p.publishedAt || p.scheduledFor || null,
    url: safeUrl(p.platformPostUrl),
    thumb: safeUrl(p.thumbnailUrl),
    mediaType: p.mediaType || null,
    views: num(a.views), impressions: num(a.impressions), reach: num(a.reach),
    likes: num(a.likes), comments: num(a.comments), shares: num(a.shares), saves: num(a.saves),
    er: num(a.engagementRate),
  };
}

// ---------- nạp dữ liệu một kênh ----------

export function makeRange(days) {
  const to = Date.parse(`${isoDay(Date.now())}T00:00:00Z`);
  const from = to - (days - 1) * DAY;
  return { days, from: isoDay(from), to: isoDay(to), prevFrom: isoDay(from - days * DAY), prevTo: isoDay(from - DAY) };
}

export async function loadChannel(ch, range) {
  const base = { name: ch.name, group: ch.group, error: null, warn: null, duplicateOf: null, sharedWith: [], accounts: [], posts: 0 };
  const key = KEYS.get(ch.name);
  if (!key) return { ...base, error: 'Không tìm thấy API key trong .env' };

  const [acc, health, dash, top] = await Promise.allSettled([
    zGet(key, '/accounts'),
    zGet(key, '/accounts/health'),
    zGet(key, '/analytics/dashboard', { fromDate: range.from, toDate: range.to, compare: 'previous_period', topPosts: 0, recentPosts: 0 }),
    zGet(key, '/analytics', { fromDate: range.from, toDate: range.to, sortBy: 'views', order: 'desc', limit: 5 }),
  ]);

  if (acc.status === 'rejected') {
    const e = acc.reason;
    return { ...base, error: e.status === 401 ? 'API key không hợp lệ hoặc đã bị thu hồi (401)' : `Không lấy được danh sách tài khoản: ${e.message}` };
  }

  const healthById = new Map((health.status === 'fulfilled' ? health.value.accounts || [] : []).map((h) => [h.accountId, h]));
  const d = dash.status === 'fulfilled' ? dash.value : null;
  const byAccount = new Map((d?.followers?.byAccount || []).map((a) => [a.accountId, a]));

  const accounts = (acc.value.accounts || []).map((a) => {
    const st = accountState(a, healthById.get(a._id));
    const f = byAccount.get(a._id);
    return {
      id: a._id,
      // platformUserId khác nhau giữa các workspace cho cùng một tài khoản TikTok, nên nhận diện theo username
      identity: `${a.platform}:${String(a.username || a.platformUserId).toLowerCase()}`,
      platform: a.platform,
      username: a.username || '',
      displayName: a.displayName || '',
      avatar: safeUrl(a.profilePicture),
      url: safeUrl(a.profileUrl),
      followers: num(f?.current ?? a.followersCount),
      gained: num(f?.gained),
      tokenExpiresAt: healthById.get(a._id)?.tokenExpiresAt || a.tokenExpiresAt || null,
      ...st,
    };
  });

  const out = {
    ...base,
    accounts,
    totals: normTotals(d?.totals),
    prev: normTotals(d?.previousTotals),
    followers: { current: accounts.reduce((s, a) => s + a.followers, 0), gained: num(d?.followers?.gained), prevGained: num(d?.previousFollowers?.gained) },
    posts: top.status === 'fulfilled' ? num(top.value.overview?.totalPosts) : 0,
    daily: (d?.daily || []).map((r) => ({ date: r.date, views: num(r.views), reach: num(r.reach), impressions: num(r.impressions), engagement: num(r.engagement), followersGained: num(r.followersGained) })),
    dataAsOf: d?.dataAsOf || null,
    topPosts: top.status === 'fulfilled' ? (top.value.posts || []).map((p) => normPost(p, ch.name)) : [],
  };
  if (dash.status === 'rejected') {
    out.warn = dash.reason.status === 402 || dash.reason.status === 403
      ? 'Gói Zernio chưa có add-on Analytics' : `Không lấy được số liệu phân tích: ${dash.reason.message}`;
  }
  return out;
}

