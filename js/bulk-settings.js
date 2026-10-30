'use strict';

/* ========== 従業員一括登録 ========== */
const ROLE_PALETTE = ['#0f6e6e', '#3b6fb6', '#b45f06', '#a23b5a', '#5b7a2f', '#6b5b95', '#8a6d1d', '#2f7d9a'];
const BULK_SAMPLE = '田中太郎,レジ,4,,月火水木金 9:00-15:00; 土日 12:00-18:00\nSarah Lee,接客,5,1300,毎日 12:00-18:00\n佐藤花子,調理,3,,平日 10:00-18:00; 土 10:00-14:00（予備）';

/* 「月火水木金 9:00-15:00; 土日 12:00-18:00（予備）」のような書き方を読み取る */
const DAY_CH = { '月': 1, '火': 2, '水': 3, '木': 4, '金': 5, '土': 6, '日': 0 };
function parseDays(t) {
  if (t === '毎日') return [1, 2, 3, 4, 5, 6, 0];
  if (t === '平日') return [1, 2, 3, 4, 5];
  if (t === '週末' || t === '土日') return [6, 0];
  const out = [];
  for (const ch of t) { if (!(ch in DAY_CH)) return null; if (!out.includes(DAY_CH[ch])) out.push(DAY_CH[ch]); }
  return out.length ? out : null;
}
function parseAvail(str) {
  const avail = [], errs = [];
  String(str).split(/[;；|／]/).map(x => x.trim()).filter(Boolean).forEach(seg => {
    const m = seg.match(/^(毎日|平日|週末|土日|[月火水木金土日]+)\s*([0-9０-９:：]+)\s*[-〜~ー–－]\s*([0-9０-９:：]+)\s*(\(?（?予備\)?）?)?$/);
    if (!m) { errs.push(`「${seg}」を読み取れません`); return; }
    const days = parseDays(m[1]), a = parseT(m[2]), b = parseT(m[3]);
    if (!days || !a || !b || toH(b, true) <= toH(a)) { errs.push(`「${seg}」の曜日か時刻が正しくありません`); return; }
    avail.push({ days: DAY_ORDER.filter(d => days.includes(d)), start: a, end: b, kind: m[4] ? 'sub' : 'main' });
  });
  return { avail, errs };
}
/* 1行1人：名前, 役割, 評価, 時給（空欄なら最低賃金）, 勤務可能曜日・時間。タブ区切り（表計算ソフトからの貼り付け）またはカンマ区切り */
function parseBulk(text, addRoles) {
  const rows = [], errs = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const c = (line.includes('\t') ? line.split('\t') : line.split(/[,，、]/)).map(x => x.trim().replace(/^"(.*)"$/, '$1'));
    if (['名前', '氏名', 'name'].includes(c[0].toLowerCase())) return;   // 見出し行は読み飛ばす
    const [name, role = '', rt = '', wg = '', av = ''] = c;
    const bad = [];
    if (!name) bad.push('名前がありません');
    let rating = 3;
    if (rt) rating = /^[1-5]$/.test(rt) ? +rt : (/^★{1,5}$/.test(rt) ? rt.length : 0);
    if (!rating) bad.push('評価は1〜5で入力してください');
    const wage = wg ? +wg.replace(/[^\d.]/g, '') : 0, cur = /\$|ドル|usd|dollar/i.test(wg) ? 'USD' : 'JPY';
    if (!(wage >= 0)) bad.push('時給は数字で入力してください');
    else if (wage > 0 && cur === 'JPY' && wage < state.settings.minWage) bad.push(`時給が最低賃金（${state.settings.minWage}円）を下回っています`);
    const { avail, errs: ae } = parseAvail(av);
    if (!av.trim()) bad.push('勤務可能曜日・時間がありません');
    bad.push(...ae);
    if (role && !addRoles && !state.roles.some(r => r.name === role)) bad.push(`役割「${role}」は登録されていません`);
    if (bad.length) errs.push(`${i + 1}行目：${bad.join('、')}`);
    else rows.push({ name, role, rating, wage, cur, avail });
  });
  return { rows, errs };
}

const bulkEl = $('#bulkModal');
const closeBulk = () => { bulkEl.hidden = true; };
$('#btnBulk').addEventListener('click', () => { $('#bulkResult').textContent = ''; bulkEl.hidden = false; $('#bulkText').focus(); });
$('#bulkCancel').addEventListener('click', closeBulk);
bulkEl.addEventListener('click', e => { if (e.target === bulkEl) closeBulk(); });
bulkEl.addEventListener('keydown', e => { if (e.key === 'Escape') closeBulk(); });
$('#bulkSample').addEventListener('click', () => { $('#bulkText').value = BULK_SAMPLE; $('#bulkResult').textContent = ''; });
$('#bulkFile').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  const buf = await f.arrayBuffer();
  let t;
  try { t = new TextDecoder('utf-8', { fatal: true }).decode(buf); }      // Excel 保存の CSV は Shift_JIS のことがある
  catch (_) { t = new TextDecoder('shift_jis').decode(buf); }
  $('#bulkText').value = t.replace(/^\uFEFF/, ''); $('#bulkResult').textContent = ''; e.target.value = '';
});
$('#bulkImport').addEventListener('click', () => {
  const { rows, errs } = parseBulk($('#bulkText').value, $('#bulkRoles').checked), el = $('#bulkResult');
  el.className = 'msg warn';
  if (errs.length) { el.textContent = errs.slice(0, 8).join('\n') + (errs.length > 8 ? `\n…ほか${errs.length - 8}件` : '') + '\n（直してからもう一度「取り込む」を押してください）'; return; }
  if (!rows.length) { el.textContent = '取り込む行がありません。'; return; }
  let add = 0, upd = 0;
  rows.forEach(d => {
    if (d.role && !state.roles.some(r => r.name === d.role)) state.roles.push({ name: d.role, color: ROLE_PALETTE[state.roles.length % ROLE_PALETTE.length] });
    const ex = state.staff.find(s => s.name === d.name);
    if (ex) { Object.assign(ex, d); upd++; } else { state.staff.push({ id: 's' + Date.now() + '_' + add, ...d }); add++; }
  });
  save(); renderRoles(); renderGantt(); closeBulk();
  ui.toast(`一括登録しました（追加${add}人${upd ? `・上書き${upd}人` : ''}）`);
});

/* ========== 設定のカテゴリー ========== */
let setCat = 'shift';
function renderSetCat() {
  document.querySelectorAll('.scbtn').forEach(b => b.classList.toggle('active', b.dataset.cat === setCat));
  document.querySelectorAll('.setcat').forEach(c => { c.hidden = c.dataset.cat !== setCat; });
}
document.querySelectorAll('.scbtn').forEach(b => b.addEventListener('click', () => { setCat = b.dataset.cat; renderSetCat(); }));

/* 日ごとの人数ルール（最低・最高人数）の設定 */
function renderShiftRules() {
  const L = state.shiftRules, opt = (list, cur) => list.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join('');
  $('#srBody').innerHTML = L.length ? L.map((r, i) => `<tr>
    <td><select data-i="${i}" data-k="day">${opt(SR_DAY, r.day)}</select></td>
    <td><select data-i="${i}" data-k="month"><option value="0">毎月</option>${Array.from({ length: 12 }, (_, m) => `<option value="${m + 1}"${+r.month === m + 1 ? ' selected' : ''}>${m + 1}月</option>`).join('')}</select></td>
    <td>${r.day === 'date' ? `<input type="date" data-i="${i}" data-k="date" value="${r.date || ''}">` : '—'}</td>
    <td><input type="number" min="0" max="999" data-i="${i}" data-k="min" value="${r.min}"></td>
    <td><input type="number" min="0" max="999" data-i="${i}" data-k="max" value="${r.max == null ? '' : r.max}" placeholder="なし"></td>
    <td><button type="button" class="btn small" data-srdel="${i}">削除</button></td></tr>`).join('')
    : '<tr><td colspan="6" class="meta">ルールはまだありません。「ルールを追加」か「ひな形」から作れます。</td></tr>';
  $('#srNote').textContent = L.length ? '複数のルールに当てはまる日は、細かい指定のほうが使われます（日付 ＞ 曜日 ＞ 平日・週末 ＞ 毎日。同じ細かさなら、月の指定つき ＞ 下にあるルール）。最高を空欄にすると上限なしです。' : '';
}
$('#srBody').addEventListener('change', e => {
  const i = e.target.dataset.i, k = e.target.dataset.k; if (i == null) return;
  const r = state.shiftRules[i], raw = e.target.value;
  if (k === 'day') { r.day = raw; if (raw === 'date' && !r.date) r.date = todayKey(); }
  else if (k === 'month') r.month = +raw;
  else if (k === 'date') r.date = raw;
  else if (k === 'min') { r.min = Math.max(0, Math.round(+raw || 0)); if (r.max != null && r.max < r.min) r.max = r.min; }
  else if (k === 'max') { r.max = raw === '' ? null : Math.max(0, Math.round(+raw || 0)); if (r.max != null && r.max < r.min) r.min = r.max; }
  save(); renderShiftRules();
});
$('#srBody').addEventListener('click', e => { const i = e.target.dataset.srdel; if (i == null) return; state.shiftRules.splice(i, 1); save(); renderShiftRules(); ui.toast('ルールを削除しました'); });
$('#srAdd').addEventListener('click', () => { state.shiftRules.push({ day: 'weekday', month: 0, date: '', min: 2, max: 6 }); save(); renderShiftRules(); });
$('#srSample').addEventListener('click', () => {
  const n = Math.max(4, state.staff.length), r = f => Math.max(1, Math.round(n * f)), has = d => state.shiftRules.some(x => x.day === d && !+x.month);
  let added = 0;
  if (!has('weekday')) { state.shiftRules.push({ day: 'weekday', month: 0, date: '', min: r(0.25), max: Math.max(r(0.25) + 1, r(0.5)) }); added++; }
  if (!has('weekend')) { state.shiftRules.push({ day: 'weekend', month: 0, date: '', min: r(0.35), max: Math.max(r(0.35) + 1, r(0.7)) }); added++; }
  if (!added) return ui.toast('平日・週末のルールはすでにあります', 'warn');
  save(); renderShiftRules(); ui.toast('平日・週末のひな形を追加しました（人数は登録人数からの目安です）');
});