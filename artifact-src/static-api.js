'use strict';
// Bản tĩnh của dashboard: thay các lời gọi /api/... bằng dữ liệu ảnh chụp đã nhúng (window.__SNAPSHOT__).
// Nhờ vậy app.js và insights.js chạy y nguyên như bản local.
(function () {
  const D = window.__SNAPSHOT__;
  if (!D) return;
  window.STATIC_MODE = true;
  window.STATIC_RANGES = Object.keys(D.overviews).map(Number).sort((a, b) => a - b);

  const DAY = 864e5;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const clamp = (v, lo, hi, dflt) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const withMetrics = (p) => {
    const engagement = num(p.likes) + num(p.comments) + num(p.shares) + num(p.saves);
    return { ...p, engagement, er: p.views > 0 ? (engagement / p.views) * 100 : 0 };
  };

  const SORTS = {
    views: (p) => p.views,
    engagement: (p) => p.engagement,
    er: (p) => (p.views >= 100 ? p.er : -1),
    completion: (p) => (p.views >= 100 && p.completion != null ? p.completion : -1),
    completion_rate: (p) => (p.completion != null ? p.completion : -1),
    date: (p) => Date.parse(p.publishedAt) || 0,
  };

  function postsOf(channel) {
    return (D.posts[channel] || []).map((p) => withMetrics({ ...p, channel }));
  }

  function topPosts(q) {
    const days = clamp(q.get('days'), 1, 30, 7);
    const since = Date.parse(D.generatedAt) - days * DAY;
    const sortKey = SORTS[q.get('sort')] ? q.get('sort') : 'views';
    const channel = q.get('channel'), platform = q.get('platform');
    const seen = new Set();
    const rows = [];
    for (const name of D.channels) {
      if (channel && name !== channel) continue;
      for (const p of postsOf(name)) {
        if (platform && p.platform !== platform) continue;
        if (Date.parse(p.publishedAt) < since) continue;
        if (seen.has(p.id)) continue; // cùng một bài ở hai kênh dùng chung tài khoản
        seen.add(p.id);
        rows.push(p);
      }
    }
    const key = SORTS[sortKey];
    rows.sort((a, b) => key(b) - key(a));
    return {
      date: D.date, generatedAt: D.generatedAt, total: rows.length,
      channels: D.channels, platforms: D.platforms,
      posts: rows.slice(0, clamp(q.get('limit'), 1, 100, 50)),
    };
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const raw = typeof input === 'string' ? input : input.url;
    const url = new URL(raw, location.href);
    const m = url.pathname.match(/\/api\/(.+)$/);
    if (!m) return realFetch(input, init);
    const route = m[1];
    const q = url.searchParams;

    if (route === 'overview') {
      const want = clamp(q.get('days'), 1, 366, 30);
      const have = window.STATIC_RANGES;
      const pick = have.includes(want) ? want : have.reduce((b, d) => (Math.abs(d - want) < Math.abs(b - want) ? d : b), have[0]);
      return json(D.overviews[pick]);
    }
    if (route === 'status') return json({ loading: false, done: D.channels.length, total: D.channels.length });
    if (route === 'snapshot-info') return json({ date: D.date, generatedAt: D.generatedAt, channels: D.channels.length });
    if (route === 'top-posts') return json(topPosts(q));
    if (route === 'weekly') {
      const weeks = Object.keys(D.weekly).sort().reverse();
      const w = D.weekly[q.get('week')] || D.weekly[weeks[0]];
      return w ? json({ ...w, weeks }) : json({ error: 'Chưa có báo cáo tuần.' }, 404);
    }
    const c = route.match(/^channel\/([A-Za-z0-9_]+)\/posts$/);
    if (c) {
      const days = clamp(q.get('days'), 1, 30, 30);
      const since = Date.parse(D.generatedAt) - days * DAY;
      const key = SORTS[q.get('sort')] || SORTS.views;
      const rows = postsOf(c[1]).filter((p) => Date.parse(p.publishedAt) >= since).sort((a, b) => key(b) - key(a));
      return json({ posts: rows.slice(0, clamp(q.get('limit'), 1, 50, 15)) });
    }
    return json({ error: 'Không tìm thấy' }, 404);
  };
})();
