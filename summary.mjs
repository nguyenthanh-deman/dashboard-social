// Gộp số liệu nhiều kênh thành tổng quan (loại trùng tài khoản dùng chung). Thuần hàm, dùng cho server và bản build tĩnh.
import { normTotals } from './core.mjs';

// Cộng gộp hai bộ chỉ số. engagement được cộng trực tiếp (bản dựng từ snapshot không có đủ likes/comments/shares/saves theo ngày).
const KEYS_SUM = ['impressions', 'reach', 'likes', 'comments', 'shares', 'saves', 'clicks', 'views', 'engagement'];
function addTotals(a, b) {
  const o = {};
  for (const k of KEYS_SUM) o[k] = (a[k] || 0) + (b[k] || 0);
  o.er = o.views > 0 ? (o.engagement / o.views) * 100 : 0;
  return o;
}

export function summarize(channels, range) {
  // Kênh nào có nhiều tài khoản hơn được tính trước; kênh chỉ chứa tài khoản đã được tính ở kênh khác bị loại khỏi tổng.
  const order = channels
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !c.error)
    .sort((a, b) => b.c.accounts.length - a.c.accounts.length || a.i - b.i);
  const owner = new Map();
  for (const { c } of order) {
    const overlap = new Set();
    for (const a of c.accounts) if (owner.has(a.identity)) overlap.add(owner.get(a.identity));
    const allSeen = c.accounts.length > 0 && c.accounts.every((a) => owner.has(a.identity));
    if (allSeen) c.duplicateOf = [...overlap][0];
    else {
      c.sharedWith = [...overlap];
      for (const a of c.accounts) if (!owner.has(a.identity)) owner.set(a.identity, c.name);
    }
  }

  const counted = channels.filter((c) => !c.error && !c.duplicateOf);
  let totals = normTotals(), prev = normTotals();
  let posts = 0;
  const dailyMap = new Map();
  for (const c of counted) {
    totals = addTotals(totals, c.totals);
    prev = addTotals(prev, c.prev);
    posts += c.posts;
    for (const r of c.daily) {
      const cur = dailyMap.get(r.date) || { date: r.date, views: 0, reach: 0, impressions: 0, engagement: 0, followersGained: 0 };
      for (const k of ['views', 'reach', 'impressions', 'engagement', 'followersGained']) cur[k] += r[k];
      dailyMap.set(r.date, cur);
    }
  }

  // follower: mỗi tài khoản chỉ đếm một lần dù xuất hiện ở nhiều kênh
  const seen = new Set();
  const platforms = new Map();
  let followers = 0, gained = 0, prevGained = 0, accountCount = 0;
  const alerts = [];
  for (const c of counted) {
    prevGained += c.followers.prevGained;
    for (const a of c.accounts) {
      if (seen.has(a.identity)) continue;
      seen.add(a.identity);
      accountCount++;
      followers += a.followers;
      gained += a.gained;
      const p = platforms.get(a.platform) || { platform: a.platform, accounts: 0, followers: 0 };
      p.accounts++; p.followers += a.followers;
      platforms.set(a.platform, p);
      if (a.state !== 'ok') alerts.push({ channel: c.name, platform: a.platform, username: a.username, state: a.state, reason: a.reason, detail: a.detail });
    }
  }
  for (const c of channels) if (c.error) alerts.push({ channel: c.name, platform: null, username: '', state: 'error', reason: c.error, detail: '' });

  // Bản dựng từ snapshot cho khoảng ngắn không có mức tăng theo từng tài khoản (gained = null): dùng mức tăng cấp kênh.
  if (counted.some((c) => c.accounts.some((a) => a.gained == null))) {
    gained = counted.reduce((s, c) => s + (c.followers?.gained || 0), 0);
  }

  const topPosts = counted.flatMap((c) => c.topPosts).sort((a, b) => b.views - a.views).slice(0, 12);

  return {
    counted: counted.length,
    accountCount,
    totals, prev, posts,
    followers: { current: followers, gained, prevGained },
    daily: [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    platforms: [...platforms.values()].sort((a, b) => b.followers - a.followers),
    alerts,
    range,
    topPosts,
  };
}
