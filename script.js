'use strict';

/* ========== 状態 ========== */
const KEY = 'shiftApp.v1';
const DEF_ROLES = [['レジ', '#0f6e6e'], ['接客', '#3b6fb6'], ['品出し', '#b45f06'], ['調理', '#a23b5a'], ['清掃', '#5b7a2f'], ['事務', '#6b5b95']]
  .map(([name, color]) => ({ name, color }));
const $ = s => document.querySelector(s);

let state = load();
let formRating = 3, editingId = null;

function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* 破損時は初期化 */ }
  if (!s || !Array.isArray(s.staff)) s = { staff: [], open: 9, close: 22, rules: {}, schedule: {} };
  s.roles = s.roles || DEF_ROLES;
  s.roleRules = s.roleRules || {};   // { 役割名: { min, max(null=上限なし) } }
  s.settings = s.settings || { display: 'JPY', rate: 150 };
  if (s.settings.auto === undefined) s.settings.auto = true;
  if (!s.settings.sort) s.settings.sort = { key: 'manual', desc: false };
  return s;
}
function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

const hoursList = () => Array.from({ length: state.close - state.open }, (_, i) => state.open + i);
const rule = h => state.rules[h] || { min: 1, max: 3 };
const fmt = h => h + ':00';
const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const roleColor = n => (state.roles.find(r => r.name === n) || {}).color || '#5f6b76';

function toH(t, isEnd) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return isEnd && m > 0 ? h + 1 : h;
}
function span(a, b) {
  const x = toH(a), y = toH(b, true), r = [];
  if (x == null || y == null) return r;
  for (let h = x; h < y; h++) r.push(h);
  return r;
}
const mainHours = s => span(s.start, s.end);
const subHours = s => span(s.start2, s.end2);

/* ========== 独自の通知・確認UI ========== */
const ui = {
  toast(msg, type = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + type; t.textContent = msg;
    $('#toasts').append(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, type === 'warn' ? 6000 : 3000);
  },
  ask(msg, { ok = 'OK', cancel = 'キャンセル', danger = false, alertOnly = false } = {}) {
    return new Promise(res => {
      const m = $('#modal'), okb = $('#modalOk'), cb = $('#modalCancel');
      $('#modalMsg').textContent = msg;
      okb.textContent = ok; cb.textContent = cancel; cb.hidden = alertOnly;
      okb.className = 'btn ' + (danger ? 'danger' : 'primary');
      m.hidden = false; okb.focus();
      const done = v => { m.hidden = true; okb.onclick = cb.onclick = m.onclick = document.onkeydown = null; res(v); };
      okb.onclick = () => done(true);
      cb.onclick = () => done(false);
      m.onclick = e => { if (e.target === m) done(false); };
      document.onkeydown = e => { if (e.key === 'Escape') done(false); };
    });
  }
};

/* ========== 金額 ========== */
const toDisp = (amt, cur) => cur === state.settings.display ? amt : cur === 'USD' ? amt * state.settings.rate : amt / state.settings.rate;
const money = v => state.settings.display === 'USD' ? '$' + v.toFixed(2) : Math.round(v).toLocaleString() + '円';
const hourly = s => toDisp(s.wage, s.cur || 'JPY');

/* ========== 時刻入力（直接入力 ＋ 選択） ========== */
/* 「9:00」「900」「0900」「9時30分」などを HH:MM に整える。空は ''、不正は null */
function parseT(raw) {
  let s = String(raw).trim().replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 65248)).replace(/[：.時]/g, ':').replace(/分/g, '');
  if (!s) return '';
  let h, m;
  if (s.includes(':')) { [h, m = '0'] = s.split(':'); if (m === '') m = '0'; }
  else if (s.length <= 2) { h = s; m = '0'; }
  else if (s.length <= 4) { h = s.slice(0, -2); m = s.slice(-2); }
  else return null;
  if (!/^\d{1,2}$/.test(h) || !/^\d{1,2}$/.test(m)) return null;
  h = +h; m = +m;
  if (h > 28 || m > 59 || (h === 28 && m > 0)) return null;   // 深夜帯は28:00（翌4:00）まで
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
const closePops = () => document.querySelectorAll('.tpop').forEach(p => p.hidden = true);
document.addEventListener('click', e => { if (!e.target.closest('.time')) closePops(); });

function timeField(id) {
  const pad = n => String(n).padStart(2, '0'), el = $('#' + id);
  el.className = 'time';
  el.innerHTML = '<input type="text" inputmode="numeric" maxlength="6" placeholder="--:--" autocomplete="off">' +
    '<button type="button" class="tbtn" aria-label="時刻を選ぶ">▾</button>' +
    '<div class="tpop" hidden><div class="tcol" data-k="h">' + Array.from({ length: 29 }, (_, i) => `<button type="button"${i >= 24 ? ` title="翌${i - 24}:00台"` : ''}>${pad(i)}</button>`).join('') +
    '</div><div class="tcol" data-k="m">' + ['00', '15', '30', '45'].map(m => `<button type="button">${m}</button>`).join('') +
    '</div><button type="button" class="btn small tclear">クリア</button></div>';
  const inp = el.querySelector('input'), pop = el.querySelector('.tpop');
  const mark = () => {
    const v = parseT(inp.value) || '';
    pop.querySelectorAll('.tcol').forEach(col => col.querySelectorAll('button').forEach(b => {
      const sel = v && b.textContent === (col.dataset.k === 'h' ? v.slice(0, 2) : v.slice(3));
      b.classList.toggle('sel', !!sel);
      if (sel && col.dataset.k === 'h') col.scrollTop = b.offsetTop - col.offsetTop - 60;
    }));
  };
  inp.addEventListener('blur', () => { const v = parseT(inp.value); inp.classList.toggle('bad', v === null); if (v) inp.value = v; });
  inp.addEventListener('input', () => inp.classList.remove('bad'));
  el.querySelector('.tbtn').onclick = () => { const open = pop.hidden; closePops(); if (open) { pop.hidden = false; mark(); } };
  pop.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    inp.classList.remove('bad');
    if (b.classList.contains('tclear')) { inp.value = ''; pop.hidden = true; return; }
    const cur = parseT(inp.value) || '00:00', k = b.parentElement.dataset.k;
    inp.value = k === 'h' ? b.textContent + ':' + (b.textContent === '28' ? '00' : cur.slice(3)) : cur.slice(0, 2) + ':' + b.textContent;
    if (k === 'm') pop.hidden = true; else mark();
  };
}
const getT = id => parseT($('#' + id + ' input').value);
const setT = (id, t) => { const i = $('#' + id + ' input'); i.value = t || ''; i.classList.remove('bad'); };
['fStart', 'fEnd', 'fStart2', 'fEnd2'].forEach(timeField);

/* ========== タブ ========== */
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === name));
  if (name === 'home') renderGantt();
}
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

/* ========== ホームの並び替え ========== */
const SORTS = {
  manual:   { label: '登録順', desc: false },
  role:     { label: '役割別（役割管理の並び順）', desc: false },
  start:    { label: '出勤時間順', desc: false },
  rating:   { label: '評価', desc: true },
  hours:    { label: '勤務時間の長さ', desc: true },
  shortage: { label: '希望時間との不足', desc: true },
  wage:     { label: '時給', desc: true },
  name:     { label: '名前（あいうえお）', desc: false }
};
const mineOf = s => state.schedule[s.id] || [];
const SORT_VAL = {
  role: s => { const k = state.roles.findIndex(r => r.name === s.role); return k < 0 ? 999 : k; },      // 役割なしは最後
  start: s => { const m = mineOf(s); return m.length ? Math.min(...m) : 100 + (mainHours(s)[0] ?? 99); }, // 勤務なしは最後
  rating: s => s.rating,
  hours: s => mineOf(s).length,
  shortage: s => (s.hours || mainHours(s).length) - mineOf(s).length,
  wage: s => hourly(s),
  name: s => s.name
};
function sortedStaff() {
  const { key, desc } = state.settings.sort, f = SORT_VAL[key];
  const arr = state.staff.map((s, i) => ({ s, i, v: f ? f(s) : i }));
  arr.sort((a, b) => {
    let c = typeof a.v === 'string' ? a.v.localeCompare(b.v, 'ja') : a.v - b.v;
    if (desc) c = -c;
    return c || (key === 'role' ? SORT_VAL.start(a.s) - SORT_VAL.start(b.s) : 0) || a.i - b.i;
  });
  return arr.map(x => x.s);
}
function renderSortBar() {
  const sv = state.settings.sort, b = $('#hDir');
  if (!SORTS[sv.key]) { sv.key = 'manual'; sv.desc = false; }
  $('#hSort').value = sv.key; b.disabled = sv.key === 'manual';
  b.textContent = sv.desc ? '▼ 降順' : '▲ 昇順';
}
$('#hSort').innerHTML = Object.entries(SORTS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
$('#hSort').addEventListener('change', () => {
  const k = $('#hSort').value;
  state.settings.sort = { key: k, desc: SORTS[k].desc }; save(); renderSortBar(); renderGantt();
});
$('#hDir').addEventListener('click', () => {
  state.settings.sort.desc = !state.settings.sort.desc; save(); renderSortBar(); renderGantt();
});

/* ========== ホーム ========== */
let viewOrder = null; // マスの編集中に行が動かないよう、並び順は並び替え・再作成などの時だけ更新する
function renderGantt(keep) {
  const H = hoursList(), wrap = $('#gantt');
  $('#legend').innerHTML = state.roles.map(r => `<span><i style="background:${r.color}"></i>${esc(r.name)}</span>`).join('') +
    '<span><i style="background:#5f6b76"></i>役割なし</span><span><i style="background:#f3faf9;border:1px solid #ccc"></i>出勤可能</span><span><i style="background:#fbf6ea;border:1px solid #ccc"></i>予備時間</span>';
  let total = 0;
  if (!state.staff.length) {
    wrap.innerHTML = '<div class="empty">スタッフがまだいません。「作業スケジュール作成」タブから登録してください。</div>';
    $('#total').textContent = ''; return;
  }
  if (!keep || !viewOrder) viewOrder = sortedStaff().map(s => s.id);
  const rows = viewOrder.map(id => state.staff.find(s => s.id === id)).filter(Boolean)
    .concat(state.staff.filter(s => !viewOrder.includes(s.id)));
  let html = '<table class="gantt"><thead><tr><th class="name">スタッフ</th>' + H.map(h => `<th>${fmt(h)}</th>`).join('') + '</tr></thead><tbody>';
  rows.forEach(s => {
    const mine = state.schedule[s.id] || [], m = mainHours(s), b = subHours(s), color = roleColor(s.role);
    const cost = hourly(s) * mine.length; total += cost;
    html += `<tr><th class="name"><b>${esc(s.name)}</b><div class="meta">${esc(s.role || '役割なし')} ／ <span class="stars">${stars(s.rating)}</span></div>
      <div class="meta">${mine.length}時間${s.hours ? ' / 希望' + s.hours : ''}${s.wage ? ' ／ ' + money(cost) : ''}</div></th>`;
    H.forEach(h => {
      const on = mine.includes(h);
      const cls = on ? 'on' : m.includes(h) ? 'ok' : b.includes(h) ? 'sub' : 'off';
      html += `<td class="cell ${cls}" data-id="${s.id}" data-h="${h}"${on ? ` style="background:${color}"` : ''}>${on ? '●' : ''}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody><tfoot><tr><th class="name">配置人数<small>最低〜最高</small></th>';
  H.forEach(h => {
    const c = state.staff.filter(s => (state.schedule[s.id] || []).includes(h)).length, r = rule(h);
    html += `<td class="${c < r.min ? 'low' : c > r.max ? 'high' : ''}">${c}<small>${r.min}〜${r.max}</small></td>`;
  });
  html += '</tr>';
  state.roles.forEach(ro => {
    const q = state.roleRules[ro.name];
    if (!q || (!q.min && q.max == null)) return;
    html += `<tr><th class="name"><span style="color:${ro.color}">●</span> ${esc(ro.name)}の人数<small>${q.min}〜${q.max == null ? '制限なし' : q.max}</small></th>`;
    H.forEach(h => {
      const c = rows.filter(s => s.role === ro.name && (state.schedule[s.id] || []).includes(h)).length;
      html += `<td class="${c < q.min ? 'low' : q.max != null && c > q.max ? 'high' : ''}">${c}</td>`;
    });
    html += '</tr>';
  });
  wrap.innerHTML = html + '</tfoot></table>';
  $('#total').textContent = total > 0 ? '人件費の合計　' + money(total) : '';
}

$('#gantt').addEventListener('click', async e => {
  const td = e.target.closest('.cell'); if (!td) return;
  const id = td.dataset.id, h = +td.dataset.h;
  const arr = state.schedule[id] || (state.schedule[id] = []), i = arr.indexOf(h);
  if (i >= 0) arr.splice(i, 1);
  else {
    if (td.classList.contains('off') && !await ui.ask('出勤可能時間外のマスです。\nこの時間に勤務を追加しますか？', { ok: '追加する' })) return;
    arr.push(h);
  }
  save(); renderGantt(true);
});
$('#btnClear').addEventListener('click', async () => {
  if (await ui.ask('現在のスケジュールをすべて消去します。よろしいですか？', { ok: '消去する', danger: true })) {
    state.schedule = {}; save(); renderGantt(); ui.toast('スケジュールを消去しました');
  }
});

/* ========== スタッフ登録 ========== */
function renderStarInput() {
  $('#fStars').innerHTML = [1, 2, 3, 4, 5].map(n => `<span data-n="${n}" class="${n <= formRating ? 'on' : ''}" role="button" aria-label="評価${n}">★</span>`).join('');
}
$('#fStars').addEventListener('click', e => { if (e.target.dataset.n) { formRating = +e.target.dataset.n; renderStarInput(); } });

function renderRoleSelect() {
  const sel = $('#fRole'), cur = sel.value;
  sel.innerHTML = '<option value="">（選択なし）</option>' + state.roles.map(r => `<option value="${esc(r.name)}">${esc(r.name)}</option>`).join('');
  sel.value = state.roles.some(r => r.name === cur) ? cur : '';
}

$('#staffForm').addEventListener('submit', e => {
  e.preventDefault();
  const d = {
    name: $('#fName').value.trim(), role: $('#fRole').value, rating: formRating,
    hours: +$('#fHours').value || 0, wage: +$('#fWage').value || 0, cur: $('#fCur').value,
    start: getT('fStart'), end: getT('fEnd'), start2: getT('fStart2'), end2: getT('fEnd2')
  };
  if (!d.name) return ui.toast('名前を入力してください', 'err');
  if ([d.start, d.end, d.start2, d.end2].includes(null)) return ui.toast('時刻の形式が正しくありません。9:00 や 0900 のように入力してください', 'err');
  if (!d.start || !d.end) return ui.toast('出勤時間と退勤時間を選んでください', 'err');
  if (toH(d.end, true) <= toH(d.start)) return ui.toast('退勤時間は出勤時間より後にしてください', 'err');
  if (!d.start2 !== !d.end2) return ui.toast('予備の出勤・退勤時間は両方選んでください', 'err');
  if (d.start2 && toH(d.end2, true) <= toH(d.start2)) return ui.toast('予備の退勤時間は出勤時間より後にしてください', 'err');
  if (editingId) { Object.assign(state.staff.find(s => s.id === editingId), d); ui.toast('変更を保存しました'); }
  else { state.staff.push({ id: 's' + Date.now(), ...d }); ui.toast(`${d.name}さんを登録しました`); }
  save(); resetForm(); renderStaffList(); renderGantt(); renderRoles();
});
$('#fCancel').addEventListener('click', resetForm);

function resetForm() {
  editingId = null; formRating = 3;
  $('#staffForm').reset();
  setT('fStart', '09:00'); setT('fEnd', '17:00'); setT('fStart2', ''); setT('fEnd2', '');
  $('#formTitle').textContent = 'スタッフを登録';
  $('#fSubmit').textContent = '登録する';
  $('#fCancel').hidden = true;
  renderStarInput();
}

function renderStaffList() {
  const ul = $('#staffList');
  if (!state.staff.length) { ul.innerHTML = '<li class="meta">まだ登録がありません。上のフォームから追加してください。</li>'; return; }
  ul.innerHTML = state.staff.map(s => `
    <li><div class="info">
      <b>${esc(s.name)}</b>${s.role ? ` <span class="badge" style="background:${roleColor(s.role)}">${esc(s.role)}</span>` : ''}
      <span class="stars">${stars(s.rating)}</span>
      <div class="meta">${s.start}–${s.end}${s.start2 ? '（予備 ' + s.start2 + '–' + s.end2 + '）' : ''}
        ／ 希望${s.hours || '指定なし'}時間 ／ ${s.wage ? (s.cur === 'USD' ? '$' + s.wage : s.wage.toLocaleString() + '円') + '/時' : '給料指定なし'}</div></div>
      <button class="btn small" data-edit="${s.id}">編集</button>
      <button class="btn small" data-del="${s.id}">削除</button></li>`).join('');
}
$('#staffList').addEventListener('click', async e => {
  const ed = e.target.dataset.edit, del = e.target.dataset.del;
  if (ed) {
    const s = state.staff.find(x => x.id === ed);
    editingId = ed; formRating = s.rating;
    $('#fName').value = s.name; $('#fRole').value = s.role;
    $('#fHours').value = s.hours || ''; $('#fWage').value = s.wage || ''; $('#fCur').value = s.cur || 'JPY';
    setT('fStart', s.start); setT('fEnd', s.end); setT('fStart2', s.start2); setT('fEnd2', s.end2);
    $('#formTitle').textContent = 'スタッフを編集';
    $('#fSubmit').textContent = '変更を保存';
    $('#fCancel').hidden = false;
    renderStarInput(); $('#fName').focus();
  }
  if (del) {
    const s = state.staff.find(x => x.id === del);
    if (!await ui.ask(`${s.name}さんを削除します。スケジュールからも外れます。`, { ok: '削除する', danger: true })) return;
    state.staff = state.staff.filter(x => x.id !== del); delete state.schedule[del];
    save(); renderStaffList(); renderGantt(); renderRoles(); ui.toast('削除しました');
  }
});

/* ========== 条件設定（人数） ========== */
function renderConditions() {
  const opts = (from, to, sel, label = fmt) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
    .map(h => `<option value="${h}"${h === sel ? ' selected' : ''}>${label(h)}</option>`).join('');
  $('#cOpen').innerHTML = opts(0, 27, state.open);
  $('#cClose').innerHTML = opts(1, 28, state.close);
  $('#bFrom').innerHTML = opts(state.open, state.close - 1, state.open);
  $('#bTo').innerHTML = opts(state.open + 1, state.close, state.close);
  $('#ruleBody').innerHTML = hoursList().map(h => {
    const r = rule(h);
    return `<tr><td>${fmt(h)}〜${fmt(h + 1)}</td>
      <td><input type="number" min="0" max="99" data-h="${h}" data-k="min" value="${r.min}"></td>
      <td><input type="number" min="0" max="99" data-h="${h}" data-k="max" value="${r.max}"></td></tr>`;
  }).join('');
}
function renderRoleRules() {
  $('#roleRuleBody').innerHTML = state.roles.length ? state.roles.map((r, i) => {
    const q = state.roleRules[r.name] || { min: 0, max: null };
    return `<tr><td><span class="badge" style="background:${r.color}">${esc(r.name)}</span></td>
      <td><input type="number" min="0" max="99" data-ri="${i}" data-k="min" value="${q.min || 0}"></td>
      <td><input type="number" min="0" max="99" data-ri="${i}" data-k="max" value="${q.max == null ? '' : q.max}" placeholder="なし"></td></tr>`;
  }).join('') : '<tr><td colspan="3" class="meta">役割が未登録です。設定タブで追加してください。</td></tr>';
}
$('#roleRuleBody').addEventListener('change', e => {
  const i = e.target.dataset.ri, k = e.target.dataset.k; if (i == null) return;
  const name = state.roles[i].name, q = state.roleRules[name] || { min: 0, max: null }, raw = e.target.value.trim();
  if (k === 'min') q.min = Math.max(0, +raw || 0);
  else q.max = raw === '' ? null : Math.max(0, +raw || 0);
  if (q.max != null && q.max < q.min) { if (k === 'min') q.max = q.min; else q.min = q.max; }
  state.roleRules[name] = q; save(); renderRoleRules(); renderGantt();
});
['#cOpen', '#cClose'].forEach(sel => $(sel).addEventListener('change', () => {
  const o = +$('#cOpen').value, c = +$('#cClose').value;
  if (c <= o) { ui.toast('終了時刻は開始時刻より後にしてください', 'err'); renderConditions(); return; }
  state.open = o; state.close = c; save(); renderConditions(); renderGantt();
}));
$('#ruleBody').addEventListener('change', e => {
  const h = e.target.dataset.h; if (h == null) return;
  const r = { ...rule(h) }, k = e.target.dataset.k;
  r[k] = Math.max(0, +e.target.value || 0);
  if (r.max < r.min) { if (k === 'min') r.max = r.min; else r.min = r.max; }
  state.rules[h] = r; save(); renderConditions();
});
$('#bApply').addEventListener('click', () => {
  const from = +$('#bFrom').value, to = +$('#bTo').value;
  const min = Math.max(0, +$('#bMin').value || 0), max = Math.max(0, +$('#bMax').value || 0);
  if (to <= from) return ui.toast('範囲の終了は開始より後にしてください', 'err');
  if (max < min) return ui.toast('最高人数は最低人数以上にしてください', 'err');
  hoursList().filter(h => h >= from && h < to).forEach(h => state.rules[h] = { min, max });
  save(); renderConditions(); renderGantt();
  ui.toast(`${fmt(from)}〜${fmt(to)} を 最低${min}人・最高${max}人 に設定しました`);
});

/* ========== 設定タブ ========== */
const RATE_URL = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=JPY'; // 欧州中央銀行（ECB）の参照レート
function renderSettings() {
  const t = state.settings;
  $('#sCur').value = t.display; $('#sRate').value = t.rate;
  $('#sAuto').checked = t.auto; $('#sRate').readOnly = t.auto;
  $('#rateStatus').textContent = t.auto
    ? (t.rateDate ? `欧州中央銀行（ECB）の参照レート（${t.rateDate}分）を使用中です。営業日の16時（中央ヨーロッパ時間）ごろに更新されます。` : 'ページを開くと最新レートを取得します。')
    : '手動で入力したレートを使用中です。';
}
async function fetchRate(manual) {
  $('#rateStatus').textContent = '最新レートを取得しています…';
  try {
    const r = await fetch(RATE_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json(), v = j.rates && j.rates.JPY;
    if (!(v > 0)) throw new Error('invalid');
    state.settings.rate = Math.round(v * 100) / 100; state.settings.rateDate = j.date;
    save(); renderSettings(); renderGantt();
    if (manual) ui.toast(`為替レートを更新しました（1ドル＝${state.settings.rate}円）`);
  } catch (e) {
    renderSettings();
    $('#rateStatus').textContent = `最新レートを取得できなかったため、保存済みのレート（1ドル＝${state.settings.rate}円）を使っています。`;
    if (manual) ui.toast('為替レートを取得できませんでした。ネット接続を確認してください', 'err');
  }
}
$('#sCur').addEventListener('change', () => {
  state.settings.display = $('#sCur').value; save(); renderGantt(); ui.toast('表示通貨を変更しました');
});
$('#sRate').addEventListener('change', () => {
  const v = +$('#sRate').value;
  if (!(v > 0)) { ui.toast('為替レートは0より大きい数にしてください', 'err'); renderSettings(); return; }
  state.settings.rate = v; save(); renderGantt(); ui.toast('為替レートを更新しました');
});
$('#sAuto').addEventListener('change', () => {
  state.settings.auto = $('#sAuto').checked; save(); renderSettings();
  if (state.settings.auto) fetchRate(true);
});
$('#sFetch').addEventListener('click', () => fetchRate(true));

/* ---- 役割の管理（追加・編集・削除） ---- */
let editingRole = null;
function renderRoles() {
  $('#roleList').innerHTML = state.roles.length ? state.roles.map((r, i) => {
    const n = state.staff.filter(s => s.role === r.name).length;
    return `<li draggable="true" data-ri="${i}"><span class="grip" title="ドラッグで並び替え">⠿</span><div class="info"><span class="badge" style="background:${r.color}">${esc(r.name)}</span> <span class="meta">${n}人</span></div>
      <button class="btn small" data-rup="${i}"${i === 0 ? ' disabled' : ''} aria-label="上へ">▲</button>
      <button class="btn small" data-rdn="${i}"${i === state.roles.length - 1 ? ' disabled' : ''} aria-label="下へ">▼</button>
      <button class="btn small" data-redit="${i}">編集</button>
      <button class="btn small" data-rdel="${i}">削除</button></li>`;
  }).join('') : '<li class="meta">役割がありません。上のフォームから追加してください。</li>';
  renderRoleSelect(); renderStaffList(); renderRoleRules();
}
function resetRoleForm() {
  editingRole = null; $('#rName').value = ''; $('#rColor').value = '#0f6e6e';
  $('#rSubmit').textContent = '追加'; $('#rCancel').hidden = true;
}
$('#roleForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#rName').value.trim(), color = $('#rColor').value;
  if (!name) return ui.toast('役割の名前を入力してください', 'err');
  if (state.roles.some((r, i) => r.name === name && i !== editingRole)) return ui.toast('同じ名前の役割がすでにあります', 'err');
  if (editingRole == null) {
    state.roles.push({ name, color }); ui.toast(`役割「${name}」を追加しました`);
  } else {
    const r = state.roles[editingRole], old = r.name;
    r.name = name; r.color = color;
    state.staff.forEach(s => { if (s.role === old) s.role = name; }); // 名前変更をスタッフにも反映
    if (old !== name && state.roleRules[old]) { state.roleRules[name] = state.roleRules[old]; delete state.roleRules[old]; }
    ui.toast(`役割「${name}」を変更しました`);
  }
  save(); resetRoleForm(); renderRoles(); renderGantt();
});
$('#rCancel').addEventListener('click', resetRoleForm);
$('#roleList').addEventListener('click', async e => {
  const ed = e.target.dataset.redit, del = e.target.dataset.rdel;
  if (ed != null) {
    const r = state.roles[ed]; editingRole = +ed;
    $('#rName').value = r.name; $('#rColor').value = r.color;
    $('#rSubmit').textContent = '変更を保存'; $('#rCancel').hidden = false; $('#rName').focus();
  }
  if (del != null) {
    const r = state.roles[del], users = state.staff.filter(s => s.role === r.name);
    const msg = users.length ? `役割「${r.name}」を削除します。${users.length}人のスタッフの役割は「選択なし」になります。` : `役割「${r.name}」を削除します。`;
    if (!await ui.ask(msg, { ok: '削除する', danger: true })) return;
    users.forEach(s => s.role = '');
    delete state.roleRules[r.name];
    state.roles.splice(del, 1); save(); resetRoleForm(); renderRoles(); renderGantt(); ui.toast('役割を削除しました');
  }
});

/* ---- 役割の並び替え（▲▼ボタン / ドラッグ） ---- */
function moveRole(from, to) {
  if (to < 0 || to >= state.roles.length || from === to) return;
  const ed = editingRole != null ? state.roles[editingRole] : null;
  const [r] = state.roles.splice(from, 1); state.roles.splice(to, 0, r);
  editingRole = ed ? state.roles.indexOf(ed) : null;
  save(); renderRoles(); renderGantt();
}
let dragRole = null;
const roleLis = () => document.querySelectorAll('#roleList li');
$('#roleList').addEventListener('click', e => {
  const up = e.target.dataset.rup, dn = e.target.dataset.rdn;
  if (up != null) moveRole(+up, +up - 1);
  if (dn != null) moveRole(+dn, +dn + 1);
});
$('#roleList').addEventListener('dragstart', e => {
  const li = e.target.closest('li[data-ri]'); if (!li) return;
  dragRole = +li.dataset.ri; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ''); li.classList.add('drag');
});
$('#roleList').addEventListener('dragover', e => {
  if (dragRole == null) return;
  e.preventDefault();
  const li = e.target.closest('li[data-ri]');
  roleLis().forEach(x => x.classList.toggle('over', x === li && +x.dataset.ri !== dragRole));
});
$('#roleList').addEventListener('drop', e => {
  e.preventDefault();
  const li = e.target.closest('li[data-ri]');
  if (li && dragRole != null) moveRole(dragRole, +li.dataset.ri);
  dragRole = null;
});
$('#roleList').addEventListener('dragend', () => { dragRole = null; roleLis().forEach(x => x.classList.remove('drag', 'over')); });

/* ========== 自動作成 ========== */
function autoGenerate() {
  const H = hoursList(), sch = {}, cnt = {}, roleAt = {};
  H.forEach(h => { cnt[h] = 0; roleAt[h] = {}; });
  const P = state.staff.map(s => ({ s, main: mainHours(s), sub: subHours(s), target: s.hours || mainHours(s).length }));
  P.forEach(p => sch[p.s.id] = []);
  const rr = state.roleRules;
  const roleMax = r => (rr[r] && rr[r].max != null) ? rr[r].max : Infinity;
  const roleMin = r => (rr[r] && rr[r].min) || 0;
  const roleOK = (p, h) => !p.s.role || (roleAt[h][p.s.role] || 0) < roleMax(p.s.role);   // 役割ごとの最高人数
  const assign = (p, h) => { sch[p.s.id].push(h); cnt[h]++; roleAt[h][p.s.role] = (roleAt[h][p.s.role] || 0) + 1; };
  const score = (p, h) => {
    const mine = sch[p.s.id];
    if (mine.includes(h) || mine.length >= p.target) return -Infinity;
    const inMain = p.main.includes(h);
    if (!inMain && !p.sub.includes(h)) return -Infinity;
    if (!roleOK(p, h)) return -Infinity;
    return p.s.rating * 2 + (inMain ? 3 : 0)
      + (mine.includes(h - 1) || mine.includes(h + 1) ? 2 : 0)
      + (p.target - mine.length) * 0.5
      + (p.s.role && !roleAt[h][p.s.role] ? 1.5 : 0)
      - hourly(p.s) * (state.settings.display === 'USD' ? 0.04 : 0.0003); // 時給はわずかに考慮
  };
  const avail = h => P.filter(p => score(p, h) > -Infinity).length;
  [...H].sort((a, b) => avail(a) - avail(b)).forEach(h => {
    // 役割ごとの最低人数を先に満たす（全体の最高人数は超えない）
    state.roles.forEach(ro => {
      while ((roleAt[h][ro.name] || 0) < roleMin(ro.name) && cnt[h] < rule(h).max) {
        let best = null, bs = -Infinity;
        P.forEach(p => { if (p.s.role !== ro.name) return; const v = score(p, h); if (v > bs) { bs = v; best = p; } });
        if (!best) break;
        assign(best, h);
      }
    });
    while (cnt[h] < rule(h).min) {
      let best = null, bs = -Infinity;
      P.forEach(p => { const v = score(p, h); if (v > bs) { bs = v; best = p; } });
      if (!best) break;
      assign(best, h);
    }
  });
  [...P].sort((a, b) => b.s.rating - a.s.rating).forEach(p => {
    while (sch[p.s.id].length < p.target) {
      const cand = p.main.filter(h => H.includes(h) && !sch[p.s.id].includes(h) && cnt[h] < rule(h).max && roleOK(p, h));
      if (!cand.length) break;
      cand.sort((a, b) => (cnt[a] - rule(a).min) - (cnt[b] - rule(b).min) || score(p, b) - score(p, a));
      assign(p, cand[0]);
    }
  });
  state.schedule = sch; save();
  const roles = state.roles.map(r => [r.name, H.filter(h => (roleAt[h][r.name] || 0) < roleMin(r.name)).length]).filter(x => x[1] > 0);
  return { hours: H.filter(h => cnt[h] < rule(h).min), roles };
}
async function runAuto() {
  if (!state.staff.length) return ui.toast('先にスタッフを登録してください', 'err');
  if (Object.values(state.schedule).some(a => a.length) &&
      !await ui.ask('現在のスケジュールは上書きされます。自動作成しますか？', { ok: '自動作成する' })) return;
  const { hours, roles } = autoGenerate();
  switchTab('home');
  const notes = [];
  if (hours.length) notes.push(`${hours.map(fmt).join('、')} は最低人数に届いていません。`);
  roles.forEach(([n, c]) => notes.push(`役割「${n}」は${c}時間帯で最低人数に届いていません。`));
  if (notes.length) ui.toast('作成しました。' + notes.join(''), 'warn');
  else ui.toast('スケジュールを作成しました。必要なマスを調整してください');
}
$('#btnAuto').addEventListener('click', runAuto);
$('#btnAutoHome').addEventListener('click', runAuto);

/* ========== 初期化 ========== */
resetForm(); renderRoles(); renderConditions(); renderSettings(); renderSortBar(); renderGantt();
if (state.settings.auto) fetchRate(false);   // ページを開くたびに最新レートを取得