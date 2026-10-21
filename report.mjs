// Tính báo cáo tuần cho từng kênh từ snapshot hằng ngày. Thuần hàm, không gọi mạng.
const DAY = 864e5;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const median = (xs) => {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const pctChange = (cur, prev) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const dayOf = (t) => (t ? String(t).slice(0, 10) : '');

// Số tuần ISO: 2026-10-10 -> 2026-W41
export function isoWeek(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // thứ Hai = 0
  d.setUTCDate(d.getUTCDate() - dow + 3); // thứ Năm của tuần này
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - first) / DAY - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// Giữ chân / xem hết video. Zernio dùng chung một bộ tên trường cho mọi nền tảng, nhưng nền tảng không hỗ trợ thì trả 0,
// nên 0 được coi là "không có dữ liệu" chứ không phải "0% người xem hết".
//   completion: % người xem xem hết video (TikTok trả completionRate dạng tỉ lệ 0–1)
//   watchSec:   thời gian xem trung bình, giây (trường igReelsAvgWatchTime đơn vị mili giây)
//   retention:  watchSec / độ dài video (%), chỉ có khi biết độ dài video
export function retentionOf(extra = {}) {
  const get = (re) => { for (const [k, v] of Object.entries(extra)) if (re.test(k) && v > 0) return v; return null; };
  const c = get(/completion/i);
  const w = get(/avg.*watch.*time/i);
  const d = get(/duration/i);
  const watchSec = w === null ? null : w / 1000;
  return {
    completion: c === null ? null : (c <= 1 ? c * 100 : c),
    watchSec,
    retention: watchSec !== null && d ? Math.min(100, (watchSec / d) * 100) : null,
  };
}

const engagementOf = (p) => num(p.likes) + num(p.comments) + num(p.shares) + num(p.saves);
const erOf = (views, eng) => (views > 0 ? (eng / views) * 100 : 0);

function sumDaily(rows, from, to) {
  const o = { views: 0, reach: 0, engagement: 0, followersGained: 0, days: 0 };
  for (const r of rows) {
    if (r.date < from || r.date > to) continue;
    o.views += num(r.views); o.reach += num(r.reach); o.engagement += num(r.engagement); o.followersGained += num(r.followersGained);
    o.days++;
  }
  o.er = erOf(o.views, o.engagement);
  return o;
}

const weighted = (posts, pick) => {
  const xs = posts.map((p) => ({ v: num(p.views), x: pick(p) })).filter((o) => o.x !== null && o.v > 0);
  const w = xs.reduce((s, o) => s + o.v, 0);
  return w > 0 ? xs.reduce((s, o) => s + o.x * o.v, 0) / w : null;
};

function postStats(posts) {
  const views = posts.reduce((s, p) => s + num(p.views), 0);
  const eng = posts.reduce((s, p) => s + engagementOf(p), 0);
  return {
    posts: posts.length,
    views, engagement: eng, er: erOf(views, eng),
    avgViews: posts.length ? views / posts.length : 0,
    medianViews: median(posts.map((p) => num(p.views))) ?? 0,
    completion: weighted(posts, (p) => retentionOf(p.extra).completion),
    watchSec: weighted(posts, (p) => retentionOf(p.extra).watchSec),
    retention: weighted(posts, (p) => retentionOf(p.extra).retention),
  };
}

const slimPost = (p) => ({
  id: p.id, platform: p.platform, username: p.username, content: p.content, publishedAt: p.publishedAt, url: p.url, thumb: p.thumb,
  mediaType: p.mediaType, views: num(p.views), likes: num(p.likes), comments: num(p.comments), shares: num(p.shares), saves: num(p.saves),
  er: erOf(num(p.views), engagementOf(p)), ...retentionOf(p.extra),
});

export const GRADE_LABEL = {
  surge: 'Tăng tốc', growing: 'Tăng trưởng tốt', steady: 'Ổn định', slowing: 'Chững lại', declining: 'Giảm', inactive: 'Không đăng bài', nodata: 'Thiếu dữ liệu',
};

/**
 * snapshot: bản chụp mới nhất. older: bản chụp cách đó ~7 ngày (có thể null) để đối chiếu follower.
 * Trả về { week, from, to, generatedAt, systemMedianEr, channels: [...] }.
 */
export function buildWeekly(snapshot, older = null) {
  const to = addDays(snapshot.date, -1); // hôm nay mới có một phần dữ liệu
  const from = addDays(to, -6);
  const pFrom = addDays(to, -13), pTo = addDays(to, -7);

  const olderFollowers = new Map((older?.channels || []).map((c) => [c.name, c.followers?.current]));
  const seen = new Set();
  const rows = [];

  for (const c of snapshot.channels) {
    if (c.error) { rows.push({ name: c.name, group: c.group, grade: 'nodata', insights: [c.error] }); continue; }
    // Kênh trùng hoàn toàn tài khoản với kênh đã tính thì bỏ qua để không chấm hai lần.
    const ids = c.accounts.map((a) => a.identity);
    if (ids.length && ids.every((i) => seen.has(i))) continue;
    ids.forEach((i) => seen.add(i));

    const daily = c.daily || [];
    const wk = sumDaily(daily, from, to);
    const pw = sumDaily(daily, pFrom, pTo);
    const posts = c.posts || [];
    const inWeek = posts.filter((p) => dayOf(p.publishedAt) >= from && dayOf(p.publishedAt) <= to);
    const inPrev = posts.filter((p) => dayOf(p.publishedAt) >= pFrom && dayOf(p.publishedAt) <= pTo);
    const ws = postStats(inWeek), ps = postStats(inPrev);

    const followers = num(c.followers?.current);
    const gained = wk.followersGained;
    const base = olderFollowers.get(c.name);
    const gainedFromSnap = Number.isFinite(base) ? followers - base : null;
    const followerGain = gainedFromSnap ?? gained;

    const byPlatform = {};
    for (const p of inWeek) (byPlatform[p.platform] ||= []).push(p);
    const platforms = Object.entries(byPlatform).map(([platform, list]) => ({ platform, ...postStats(list) }));

    rows.push({
      name: c.name, group: c.group,
      followers, followerGain, // Tài khoản mới kết nối (nền nhỏ) cho % tăng vô nghĩa nên bỏ qua dưới 100 follower đầu kỳ.
      followerGainPct: followers - followerGain >= 100 ? (followerGain / (followers - followerGain)) * 100 : null,
      week: { views: wk.views, reach: wk.reach, engagement: wk.engagement, er: wk.er, posts: ws.posts, completion: ws.completion, watchSec: ws.watchSec, retention: ws.retention, medianViews: ws.medianViews, avgViews: ws.avgViews },
      prev: { views: pw.views, engagement: pw.engagement, er: pw.er, posts: ps.posts, followersGained: pw.followersGained },
      // Tuần trước dưới 50 views (kênh mới/ít dữ liệu) thì % thay đổi vô nghĩa nên không tính.
      viewsChange: pw.views >= 50 ? pctChange(wk.views, pw.views) : null,
      erChange: pw.er > 0 ? wk.er - pw.er : null,
      platforms,
      topPosts: [...inWeek].sort((a, b) => num(b.views) - num(a.views)).slice(0, 3).map(slimPost),
      // Bài đăng trong 2 ngày gần nhất chưa kịp có views nên không xét "bài kém nhất".
      worstPost: (() => {
        const matured = inWeek.filter((p) => dayOf(p.publishedAt) <= addDays(to, -2));
        return matured.length >= 3 ? slimPost([...matured].sort((a, b) => num(a.views) - num(b.views))[0]) : null;
      })(),
      _score: null,
    });
  }

  const systemEr = median(rows.filter((r) => r.week && r.week.views > 0).map((r) => r.week.er));
  const systemCompletion = median(rows.filter((r) => r.week && r.week.completion !== null).map((r) => r.week.completion));
  const systemViewsPerPost = median(rows.filter((r) => r.week && r.week.posts > 0).map((r) => r.week.avgViews));

  for (const r of rows) {
    if (!r.week) continue;
    const ins = [];
    const w = r.week, p = r.prev;
    if (w.posts === 0 && w.views === 0) {
      r.grade = 'inactive';
      ins.push(p.posts > 0 ? `Không có bài nào trong 7 ngày qua (tuần trước ${p.posts} bài).` : 'Không có bài nào trong 14 ngày qua, cần đăng lại để kênh có dữ liệu.');
      r.insights = ins;
      continue;
    }
    if (w.views === 0 && p.views === 0) {
      r.grade = 'nodata';
      r.insights = [`Có ${w.posts} bài nhưng chưa ghi nhận views nào (kênh mới hoặc Zernio chưa đồng bộ số liệu).`];
      continue;
    }

    let score = 0;
    if (r.viewsChange !== null) {
      if (r.viewsChange >= 30) score += 2; else if (r.viewsChange >= 10) score += 1;
      else if (r.viewsChange <= -30) score -= 2; else if (r.viewsChange <= -10) score -= 1;
      ins.push(`Views ${r.viewsChange >= 0 ? 'tăng' : 'giảm'} ${Math.abs(r.viewsChange).toFixed(0)}% so với tuần trước (${fmt(w.views)} so với ${fmt(p.views)}).`);
    } else if (w.views > 0) ins.push(`Có ${fmt(w.views)} views, tuần trước quá ít (${fmt(p.views)}) để so sánh.`);

    if (r.followerGain > 0) { if ((r.followerGainPct ?? 0) >= 1) score += 1; ins.push(`Thêm ${fmt(r.followerGain)} follower${r.followerGainPct !== null ? ` (+${r.followerGainPct.toFixed(1)}%)` : ''}.`); }
    else if (r.followerGain < 0) { score -= (r.followerGainPct ?? 0) <= -1 ? 2 : 1; ins.push(`Mất ${fmt(-r.followerGain)} follower trong tuần.`); }
    else ins.push('Follower đứng yên trong tuần.');

    if (systemEr !== null && w.views > 0) {
      if (w.er >= systemEr * 1.2) { score += 1; ins.push(`Tỷ lệ tương tác ${w.er.toFixed(1)}% cao hơn mức trung vị toàn hệ thống (${systemEr.toFixed(1)}%).`); }
      else if (w.er <= systemEr * 0.8) { score -= 1; ins.push(`Tỷ lệ tương tác ${w.er.toFixed(1)}% thấp hơn mức trung vị toàn hệ thống (${systemEr.toFixed(1)}%), nên thử hook/CTA khác.`); }
    }

    if (p.posts > 0 && w.posts < p.posts * 0.6) ins.push(`Đăng ít hơn tuần trước (${w.posts} so với ${p.posts} bài), views có thể giảm vì vậy.`);
    else if (w.posts > p.posts * 1.5 && p.posts > 0) ins.push(`Tăng tần suất đăng lên ${w.posts} bài (tuần trước ${p.posts}).`);

    const top = r.topPosts[0];
    if (top && w.medianViews > 0 && top.views >= w.medianViews * 3 && r.week.posts >= 3) {
      ins.push(`Bài tốt nhất đạt ${fmt(top.views)} views, gấp ${(top.views / w.medianViews).toFixed(1)} lần bài trung vị: nên nhân bản chủ đề/format này.`);
    }
    if (r.worstPost && w.medianViews > 0 && r.worstPost.views <= w.medianViews * 0.2) {
      ins.push(`Có bài chỉ đạt ${fmt(r.worstPost.views)} views, kém xa mức trung vị ${fmt(w.medianViews)}.`);
    }
    if (w.completion !== null) {
      const low = systemCompletion !== null && w.completion < systemCompletion * 0.7;
      ins.push(`Tỷ lệ xem hết video ${w.completion.toFixed(1)}%${w.watchSec !== null ? `, xem trung bình ${w.watchSec.toFixed(0)}s` : ''}${low ? ` — thấp hơn trung vị hệ thống (${systemCompletion.toFixed(1)}%), nên sửa đoạn mở đầu/nhịp video` : ''}.`);
    } else if (w.watchSec !== null) ins.push(`Thời gian xem trung bình ${w.watchSec.toFixed(0)}s/video (nền tảng không trả tỷ lệ xem hết).`);
    if (systemViewsPerPost && w.posts > 0 && w.avgViews < systemViewsPerPost * 0.3) ins.push(`Views/bài (${fmt(w.avgViews)}) thấp xa mức trung vị hệ thống (${fmt(systemViewsPerPost)}).`);

    r.grade = score >= 3 ? 'surge' : score >= 1 ? 'growing' : score === 0 ? 'steady' : score >= -2 ? 'slowing' : 'declining';
    r.score = score;
    r.insights = ins;
    delete r._score;
  }

  rows.forEach((r) => { delete r._score; });
  return { week: isoWeek(to), from, to, generatedAt: new Date().toISOString(), systemMedianEr: systemEr, systemMedianCompletion: systemCompletion, channels: rows };
}

function fmt(n) {
  const v = Math.round(num(n));
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (Math.abs(v) >= 1e4) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return v.toLocaleString('en-US');
}
