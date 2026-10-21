// In bản tóm tắt gọn của tuần mới nhất để Claude viết nhận xét nội dung từng kênh.
//   node weekly-brief.mjs            in ra màn hình
// Claude ghi kết quả vào data/commentary/<tuần>.json dạng { "TÊN_KÊNH": "nhận xét 2-4 câu", ... }
// build-artifact.mjs sẽ nhúng nhận xét này vào tab "Đánh giá tuần".
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { retentionOf } from './report.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(ROOT, 'data');
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const readJson = async (f) => JSON.parse(await readFile(f, 'utf8'));

const weekly = await readJson(path.join(DATA, 'weekly', 'latest.json'));
const snapFiles = (await readdir(path.join(DATA, 'snapshots'))).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
const snap = await readJson(path.join(DATA, 'snapshots', snapFiles.at(-1)));
const postsOf = new Map(snap.channels.filter((c) => !c.error).map((c) => [c.name, c.posts]));

const day = (t) => String(t || '').slice(0, 10);
const fmt = (n) => Math.round(num(n)).toLocaleString('en-US');
const cut = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function line(p) {
  const eng = num(p.likes) + num(p.comments) + num(p.shares) + num(p.saves);
  const er = p.views > 0 ? ((eng / p.views) * 100).toFixed(1) + '%' : '-';
  const r = retentionOf(p.extra);
  const watch = r.completion != null ? ` xem hết ${r.completion.toFixed(1)}%` : '';
  return `  - [${p.platform} ${day(p.publishedAt)}] ${fmt(p.views)} views, ER ${er}${watch}: ${cut(p.content, 130)}`;
}

const out = [];
out.push(`# Brief tuần ${weekly.week} (${weekly.from} → ${weekly.to})`);
out.push(`ER trung vị hệ thống ${weekly.systemMedianEr?.toFixed(2)}%, tỷ lệ xem hết trung vị ${weekly.systemMedianCompletion?.toFixed(1) ?? '-'}%.`);
out.push('Với mỗi kênh dưới đây, viết 2-4 câu NHẬN XÉT NỘI DUNG: chủ đề/format/hook nào hiệu quả, cái nào kém, nên làm gì tuần tới.');
out.push('Chỉ dựa vào các bài và số liệu bên dưới, không bịa. Kênh quá ít dữ liệu thì nói rõ là chưa đủ để kết luận.');
out.push(`Ghi file data/commentary/${weekly.week}.json dạng {"TÊN_KÊNH": "nhận xét"}.`);
out.push('');

for (const c of weekly.channels) {
  if (!c.week) { out.push(`## ${c.name} (${c.group}): ${c.grade}, ${c.insights?.[0] || 'không có dữ liệu'}`, ''); continue; }
  const w = c.week;
  out.push(`## ${c.name} (${c.group}) · ${c.grade} · ${fmt(w.views)} views (${c.viewsChange == null ? 'n/a' : (c.viewsChange >= 0 ? '+' : '') + c.viewsChange.toFixed(0) + '%'}), ER ${w.er.toFixed(2)}%, ${w.posts} bài (tuần trước ${c.prev.posts}), follower ${c.followerGain >= 0 ? '+' : ''}${fmt(c.followerGain)}`);
  const inWeek = (postsOf.get(c.name) || []).filter((p) => day(p.publishedAt) >= weekly.from && day(p.publishedAt) <= weekly.to);
  if (!inWeek.length) { out.push('  (không có bài trong tuần)', ''); continue; }
  const sorted = [...inWeek].sort((a, b) => num(b.views) - num(a.views));
  const matured = sorted.filter((p) => day(p.publishedAt) <= new Date(Date.parse(weekly.to) - 2 * 864e5).toISOString().slice(0, 10));
  out.push('  Top:', ...sorted.slice(0, 5).map(line));
  if (matured.length > 5) out.push('  Kém nhất:', ...matured.slice(-4).map(line));
  out.push('');
}
console.log(out.join('\n'));
