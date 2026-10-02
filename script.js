'use strict';

/* ========== 状態 ========== */
const KEY = 'shiftApp.v1';
const DEF_ROLES = [['レジ', '#0f6e6e'], ['接客', '#3b6fb6'], ['品出し', '#b45f06'], ['調理', '#a23b5a'], ['清掃', '#5b7a2f'], ['事務', '#6b5b95']]
  .map(([name, color]) => ({ name, color }));
/* 自動作成のルール（プリセット）。数値は 0=オフ 1=弱 2=標準 3=強 */
const PRESETS = {
  balance:   { label: 'バランス重視', desc: '評価・希望時間・連続勤務・人件費をまんべんなく考慮します。迷ったらこれがおすすめです。', v: { rating: 2, contig: 2, wage: 1, fair: 1, fill: 'max', target: 'fill', sub: 'fallback' } },
  headcount: { label: '人数重視', desc: '希望勤務時間にこだわらず、各時間帯を最高人数に近づけます。繁忙期や人手不足の日向けです。', v: { rating: 1, contig: 1, wage: 0, fair: 1, fill: 'max', target: 'ignore', sub: 'always' } },
  cost:      { label: '人件費重視', desc: '最低人数だけを満たし、時給の安いスタッフを優先します。予備の時間は使いません。', v: { rating: 1, contig: 2, wage: 3, fair: 0, fill: 'min', target: 'cap', sub: 'never' } },
  quality:   { label: '評価重視', desc: '評価の高いスタッフを優先して配置します。忙しい時間帯の品質を上げたいときに。', v: { rating: 3, contig: 2, wage: 0, fair: 0, fill: 'mid', target: 'fill', sub: 'fallback' } },
  fair:      { label: '公平重視', desc: 'スタッフ間の勤務時間をなるべく揃えます。希望時間を超えては入れません。', v: { rating: 1, contig: 2, wage: 1, fair: 3, fill: 'mid', target: 'cap', sub: 'fallback' } },
  wish:      { label: '希望優先', desc: '希望勤務時間と本来の出退勤時間を最優先し、予備の時間は使いません。', v: { rating: 1, contig: 2, wage: 0, fair: 1, fill: 'max', target: 'fill', sub: 'never' } }
};
const $ = s => document.querySelector(s);

let state = load();
let formRating = 3, editingId = null;

function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* 破損時は初期化 */ }
  if (!s || !Array.isArray(s.staff)) s = { staff: [], open: 9, close: 22, rules: {}, schedule: {} };
  s.roles = s.roles || DEF_ROLES;
  s.autoRules = s.autoRules || { preset: 'balance', ...PRESETS.balance.v };
  s.shifts = s.shifts || {};        // { 日付: { スタッフID: { start, end, brk(休憩分) } } }
  s.published = s.published || {};  // { 週の月曜日の日付: true }（確定済みの週）
  s.roleRules = s.roleRules || {};   // { 役割名: { min, max(null=上限なし) } }
  s.settings = s.settings || { display: 'JPY', rate: 150 };
  if (s.settings.auto === undefined) s.settings.auto = true;
  if (!s.settings.sort) s.settings.sort = { key: 'manual', desc: false };
  if (s.settings.limitDay === undefined) { s.settings.limitDay = 8; s.settings.limitWeek = 40; }
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
['fStart', 'fEnd', 'fStart2', 'fEnd2', 'sStart', 'sEnd'].forEach(timeField);

/* ========== タブ ========== */
let curTab = 'home';
function switchTab(name) {
  curTab = name;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === name));
  if (name === 'home') renderGantt();
  if (name === 'shift') renderShift();
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
const NAME_W = 230, COL_W = 72;   // 表の列幅（すべての時間マスを同じ大きさに）
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
  let html = '<table class="gantt" style="width:' + (NAME_W + H.length * COL_W) + 'px"><colgroup><col style="width:' + NAME_W + 'px">' + H.map(() => `<col style="width:${COL_W}px">`).join('') + '</colgroup><thead><tr><th class="name">スタッフ</th>' + H.map(h => `<th>${fmt(h)}</th>`).join('') + '</tr></thead><tbody>';
  rows.forEach(s => {
    const mine = (state.schedule[s.id] || []).filter(h => H.includes(h)), m = mainHours(s), b = subHours(s), color = roleColor(s.role);
    const cost = hourly(s) * mine.length; total += cost;
    html += `<tr><th class="name"><b>${esc(s.name)}</b><div class="meta">${esc(s.role || '役割なし')} ／ <span class="stars">${stars(s.rating)}</span></div>
      <div class="meta">${mine.length}${s.hours ? '/' + s.hours : ''}時間${s.wage ? '・' + money(cost) : ''}</div></th>`;
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
    Object.values(state.shifts).forEach(m => delete m[del]);
    save(); renderStaffList(); renderGantt(); renderRoles(); ui.toast('削除しました');
  }
});

/* ========== 条件設定（人数） ========== */
function renderConditions() {
  const opts = (from, to, sel, label = fmt) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
    .map(h => `<option value="${h}"${h === sel ? ' selected' : ''}>${label(h)}</option>`).join('');
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

/* ---- 表の表示時間 ---- */
function renderTimeRange() {
  $('#vOpen').textContent = fmt(state.open); $('#vClose').textContent = fmt(state.close);
  $('#rangeNote').textContent = `${fmt(state.open)}〜${fmt(state.close)} の ${state.close - state.open} 列を表示します（最後の列は ${fmt(state.close - 1)}〜${fmt(state.close)}）。`;
}
document.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
  const [k, d] = b.dataset.step.split(':'), n = +d, before = state.open + ',' + state.close;
  if (k === 'open') state.open = Math.min(Math.max(state.open + n, 0), state.close - 1);
  else state.close = Math.min(Math.max(state.close + n, state.open + 1), 28);
  if (before === state.open + ',' + state.close) return ui.toast('これ以上は変更できません（0:00〜28:00、最低1時間）', 'warn');
  save(); renderTimeRange(); renderConditions(); renderGantt();
}));

/* ---- 自動作成のルール ---- */
const LV = ['オフ', '弱', '標準', '強'];
const AR_FIELDS = { rating: 'aRating', contig: 'aContig', wage: 'aWage', fair: 'aFair', fill: 'aFill', target: 'aTarget', sub: 'aSub' };
const AR_NUM = ['rating', 'contig', 'wage', 'fair'];
const AR_OPTS = {
  fill: [['min', '最低人数まで（人件費を抑える）'], ['mid', '最低と最高の中間まで'], ['max', '最高人数まで']],
  target: [['fill', '希望勤務時間まで勤務を追加する'], ['cap', '希望勤務時間を上限にする（追加はしない）'], ['ignore', '希望勤務時間を気にしない']],
  sub: [['never', '使わない'], ['fallback', '人手が足りないときだけ使う'], ['always', '本来の時間と同等に使う']]
};
const ruleLabel = () => state.autoRules.preset === 'custom' ? 'カスタム' : PRESETS[state.autoRules.preset].label;
function renderAutoRules() {
  const R = state.autoRules;
  $('#aPreset').innerHTML = Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('') + '<option value="custom">カスタム（手動調整）</option>';
  $('#aPreset').value = R.preset;
  AR_NUM.forEach(k => { const el = $('#' + AR_FIELDS[k]); el.innerHTML = LV.map((l, i) => `<option value="${i}">${l}</option>`).join(''); el.value = R[k]; });
  Object.keys(AR_OPTS).forEach(k => { const el = $('#' + AR_FIELDS[k]); el.innerHTML = AR_OPTS[k].map(([v, l]) => `<option value="${v}">${l}</option>`).join(''); el.value = R[k]; });
  $('#aDesc').textContent = R.preset === 'custom' ? '個別の項目を調整した状態です。タイプを選ぶと、そのおすすめ設定に戻ります。' : PRESETS[R.preset].desc;
  $('#ruleNote').textContent = `自動作成のルール：${ruleLabel()}（設定タブで変更できます）`;
}
$('#aPreset').addEventListener('change', () => {
  const k = $('#aPreset').value;
  state.autoRules = k === 'custom' ? { ...state.autoRules, preset: 'custom' } : { preset: k, ...PRESETS[k].v };
  save(); renderAutoRules(); ui.toast(`自動作成のルールを「${ruleLabel()}」にしました`);
});
Object.entries(AR_FIELDS).forEach(([, id]) => $('#' + id).addEventListener('change', () => {
  const v = {};
  Object.keys(AR_FIELDS).forEach(f => { const x = $('#' + AR_FIELDS[f]).value; v[f] = AR_NUM.includes(f) ? +x : x; });
  const hit = Object.keys(PRESETS).find(p => Object.keys(v).every(f => PRESETS[p].v[f] === v[f]));
  state.autoRules = { preset: hit || 'custom', ...v }; save(); renderAutoRules();
}));

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
  const R = state.autoRules;
  const W = { rating: [0, 1, 2, 4][R.rating], contig: [0, 1, 2, 4][R.contig], wage: [0, 0.3, 1, 2.5][R.wage], fair: [0, 0.4, 1, 2][R.fair] };
  const H = hoursList(), sch = {}, cnt = {}, roleAt = {};
  H.forEach(h => { cnt[h] = 0; roleAt[h] = {}; });
  const P = state.staff.map(s => ({
    s, main: mainHours(s), sub: R.sub === 'never' ? [] : subHours(s),
    target: R.target === 'ignore' ? Infinity : (s.hours || mainHours(s).length),
    yen: (s.cur === 'USD' ? s.wage * state.settings.rate : s.wage) || 0
  }));
  P.forEach(p => sch[p.s.id] = []);
  const rr = state.roleRules;
  const roleMax = r => (rr[r] && rr[r].max != null) ? rr[r].max : Infinity;
  const roleMin = r => (rr[r] && rr[r].min) || 0;
  const roleOK = (p, h) => !p.s.role || (roleAt[h][p.s.role] || 0) < roleMax(p.s.role);   // 役割ごとの最高人数
  const capH = h => { const r = rule(h); return R.fill === 'min' ? r.min : R.fill === 'mid' ? Math.ceil((r.min + r.max) / 2) : r.max; };
  const assign = (p, h) => { sch[p.s.id].push(h); cnt[h]++; roleAt[h][p.s.role] = (roleAt[h][p.s.role] || 0) + 1; };
  const score = (p, h) => {
    const mine = sch[p.s.id];
    if (mine.includes(h) || mine.length >= p.target) return -Infinity;
    const inMain = p.main.includes(h);
    if (!inMain && !p.sub.includes(h)) return -Infinity;
    if (!roleOK(p, h)) return -Infinity;
    return p.s.rating * W.rating                                  // 評価
      + (inMain && R.sub !== 'always' ? 3 : 0)                    // 本来の出退勤時間を優先
      + (mine.includes(h - 1) || mine.includes(h + 1) ? W.contig : 0) // 連続勤務
      + (isFinite(p.target) ? (p.target - mine.length) * 0.5 : 0) // 希望時間に足りない人を優先
      + (p.s.role && !roleAt[h][p.s.role] ? 1.5 : 0)              // 役割の偏りを避ける
      - (p.yen / 1000) * W.wage                                   // 人件費
      - mine.length * W.fair;                                     // 勤務時間の公平さ
  };
  const best = (h, only) => {
    let b = null, bs = -Infinity;
    P.forEach(p => { if (only && p.s.role !== only) return; const v = score(p, h); if (v > bs) { bs = v; b = p; } });
    return b;
  };
  const avail = h => P.filter(p => score(p, h) > -Infinity).length;

  // 1) 候補が少ない時間帯から、役割ごとの最低人数 → 全体の最低人数を満たす
  [...H].sort((a, b) => avail(a) - avail(b)).forEach(h => {
    state.roles.forEach(ro => {
      while ((roleAt[h][ro.name] || 0) < roleMin(ro.name) && cnt[h] < rule(h).max) {
        const p = best(h, ro.name); if (!p) break; assign(p, h);
      }
    });
    while (cnt[h] < rule(h).min) { const p = best(h); if (!p) break; assign(p, h); }
  });

  // 2) 希望勤務時間まで勤務を追加（「希望勤務時間まで追加する」のとき）
  if (R.target === 'fill') {
    [...P].sort((a, b) => W.rating ? b.s.rating - a.s.rating : 0).forEach(p => {
      while (sch[p.s.id].length < p.target) {
        const cand = p.main.filter(h => H.includes(h) && !sch[p.s.id].includes(h) && cnt[h] < capH(h) && roleOK(p, h));
        if (!cand.length) break;
        cand.sort((a, b) => (cnt[a] - rule(a).min) - (cnt[b] - rule(b).min) || score(p, b) - score(p, a));
        assign(p, cand[0]);
      }
    });
  }

  // 3) 各時間帯を「余裕のある時間帯の人数」まで補う
  [...H].sort((a, b) => cnt[a] - cnt[b]).forEach(h => {
    while (cnt[h] < capH(h)) { const p = best(h); if (!p) break; assign(p, h); }
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
  else ui.toast(`スケジュールを作成しました（${ruleLabel()}）。必要なマスを調整してください`);
}
$('#btnAuto').addEventListener('click', runAuto);
$('#btnAutoHome').addEventListener('click', runAuto);

/* ========== シフト管理（管理者用） ========== */
const DAY_W = 112, DOW = ['日', '月', '火', '水', '木', '金', '土'];
const pad2 = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseYmd = t => { const [y, m, d] = t.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = d => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7));
const tmin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fh = x => String(Math.round(x * 100) / 100);
const shiftHours = sh => Math.max(0, (tmin(sh.end) - tmin(sh.start) - (sh.brk || 0)) / 60);
const legalBreak = h => h > 8 ? 60 : h > 6 ? 45 : 0;   // 法定の最低休憩の目安（6時間超45分／8時間超60分）
let weekStart = mondayOf(new Date());
const weekKeys = () => Array.from({ length: 7 }, (_, i) => ymd(addDays(weekStart, i)));
const dayShifts = k => state.shifts[k] || {};
const hasShifts = k => Object.keys(dayShifts(k)).length > 0;
const isPublished = () => !!state.published[ymd(weekStart)];

function renderShift() {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), keys = days.map(ymd), pub = isPublished();
  $('#wLabel').textContent = `${days[0].getFullYear()}年 ${days[0].getMonth() + 1}/${days[0].getDate()}〜${days[6].getMonth() + 1}/${days[6].getDate()}`;
  $('#wStatus').textContent = pub ? '確定済み' : '下書き'; $('#wStatus').className = 'pill' + (pub ? ' ok' : '');
  $('#wPublish').textContent = pub ? '確定を解除' : '確定する';
  $('#wJump').value = keys[0];
  const wrap = $('#wGrid'); wrap.classList.toggle('locked', pub);
  if (!state.staff.length) { wrap.innerHTML = '<div class="empty">スタッフがまだいません。「作業スケジュール作成」タブから登録してください。</div>'; $('#wTotal').textContent = ''; return; }
  const today = ymd(new Date()), anyWage = state.staff.some(s => s.wage), L = state.settings;
  const dayCount = Array(7).fill(0), dayCost = Array(7).fill(0);
  let grand = 0, grandCost = 0;
  let html = `<table class="gantt shiftgrid" style="width:${NAME_W + 7 * DAY_W}px"><colgroup><col style="width:${NAME_W}px">` + keys.map(() => `<col style="width:${DAY_W}px">`).join('') +
    '</colgroup><thead><tr><th class="name">スタッフ</th>' +
    days.map((d, i) => `<th class="${keys[i] === today ? 'today ' : ''}${d.getDay() === 0 ? 'sun' : d.getDay() === 6 ? 'sat' : ''}">${d.getMonth() + 1}/${d.getDate()}（${DOW[d.getDay()]}）</th>`).join('') + '</tr></thead><tbody>';
  state.staff.forEach(s => {
    let wh = 0;
    const cells = keys.map((k, i) => {
      const sh = dayShifts(k)[s.id];
      if (!sh) return `<td class="scell empty" data-id="${s.id}" data-d="${k}">＋</td>`;
      const hrs = shiftHours(sh), over = hrs > L.limitDay;
      wh += hrs; dayCount[i]++; dayCost[i] += hrs * hourly(s);
      return `<td class="scell on${over ? ' over' : ''}" style="background:${roleColor(s.role)}" data-id="${s.id}" data-d="${k}">${sh.start}–${sh.end}<small>${fh(hrs)}時間${over ? ' ⚠' : ''}</small></td>`;
    }).join('');
    const cost = wh * hourly(s), overW = wh > L.limitWeek;
    grand += wh; grandCost += cost;
    html += `<tr><th class="name"><b>${esc(s.name)}</b><div class="meta">${esc(s.role || '役割なし')}</div>
      <div class="meta${overW ? ' warnText' : ''}">週${fh(wh)}時間${s.wage ? '・' + money(cost) : ''}${overW ? ' ⚠' : ''}</div></th>${cells}</tr>`;
  });
  html += '</tbody><tfoot><tr><th class="name">出勤人数</th>' + dayCount.map(n => `<td>${n}人</td>`).join('') + '</tr>';
  if (anyWage) html += '<tr><th class="name">人件費</th>' + dayCost.map(c => `<td>${c ? money(c) : '—'}</td>`).join('') + '</tr>';
  wrap.innerHTML = html + '</tfoot></table>';
  $('#wTotal').textContent = grand ? `この週の合計　${fh(grand)}時間${anyWage ? '・' + money(grandCost) : ''}` : '';
}

/* 週の移動 */
const setWeek = d => { weekStart = mondayOf(d); renderShift(); };
$('#wPrev').addEventListener('click', () => setWeek(addDays(weekStart, -7)));
$('#wNext').addEventListener('click', () => setWeek(addDays(weekStart, 7)));
$('#wToday').addEventListener('click', () => setWeek(new Date()));
$('#wJump').addEventListener('change', () => { if ($('#wJump').value) setWeek(parseYmd($('#wJump').value)); });

const lockedMsg = () => ui.toast('確定済みの週です。変更するには「確定を解除」を押してください', 'warn');
$('#wCopy').addEventListener('click', async () => {
  if (isPublished()) return lockedMsg();
  const keys = weekKeys(), prev = keys.map(k => ymd(addDays(parseYmd(k), -7)));
  if (!prev.some(hasShifts)) return ui.toast('前の週にシフトがありません', 'warn');
  if (keys.some(hasShifts) && !await ui.ask('この週のシフトを、前の週の内容で上書きします。よろしいですか？', { ok: '上書きする', danger: true })) return;
  keys.forEach((k, i) => { if (hasShifts(prev[i])) state.shifts[k] = JSON.parse(JSON.stringify(state.shifts[prev[i]])); else delete state.shifts[k]; });
  save(); renderShift(); ui.toast('前の週のシフトをコピーしました');
});
$('#wClear').addEventListener('click', async () => {
  if (isPublished()) return lockedMsg();
  const keys = weekKeys();
  if (!keys.some(hasShifts)) return ui.toast('この週にシフトはありません', 'warn');
  if (!await ui.ask('この週のシフトをすべて消します。よろしいですか？', { ok: '空にする', danger: true })) return;
  keys.forEach(k => delete state.shifts[k]); save(); renderShift(); ui.toast('この週のシフトを空にしました');
});
$('#wPublish').addEventListener('click', async () => {
  const wk = ymd(weekStart);
  if (isPublished()) { delete state.published[wk]; save(); renderShift(); return ui.toast('確定を解除しました（下書きに戻しました）'); }
  if (!weekKeys().some(hasShifts)) return ui.toast('確定するシフトがありません', 'warn');
  if (!await ui.ask('この週のシフトを確定します。確定中は編集できません（解除すればまた編集できます）。', { ok: '確定する' })) return;
  state.published[wk] = true; save(); renderShift(); ui.toast('この週のシフトを確定しました');
});

/* マスの編集ダイアログ */
let editShift = null;
const shiftEl = $('#shiftModal');
const closeShift = () => { shiftEl.hidden = true; editShift = null; };
function updateShiftInfo() {
  const a = getT('sStart'), b = getT('sEnd'), brk = +$('#sBreak').value, el = $('#sInfo');
  if (!a || !b || tmin(b) <= tmin(a) || !editShift) { el.textContent = ''; return; }
  const hrs = Math.max(0, (tmin(b) - tmin(a) - brk) / 60), s = state.staff.find(x => x.id === editShift.id);
  el.textContent = `実働 ${fh(hrs)}時間` + (s.wage ? `・${money(hrs * hourly(s))}` : '') +
    (hrs > state.settings.limitDay ? `　⚠ 1日の注意ライン（${state.settings.limitDay}時間）を超えています` : '');
}
function setBreak(v) {
  const sel = $('#sBreak'), b = String(v || 0);
  if (![...sel.options].some(o => o.value === b)) sel.add(new Option(b + '分', b));
  sel.value = b;
}
function openShift(id, date) {
  const s = state.staff.find(x => x.id === id), cur = dayShifts(date)[id];
  editShift = { id, date };
  $('#sTitle').textContent = `${s.name}　${date.replace(/-/g, '/')}（${DOW[parseYmd(date).getDay()]}）`;
  $('#sHint').textContent = `通常の出勤時間：${s.start}–${s.end}` + (s.start2 ? `／予備：${s.start2}–${s.end2}` : '');
  $('#sFillSub').hidden = !s.start2;
  setT('sStart', cur ? cur.start : ''); setT('sEnd', cur ? cur.end : ''); setBreak(cur ? cur.brk : 0);
  $('#sDelete').hidden = !cur; $('#sSave').textContent = cur ? '変更を保存' : '保存';
  updateShiftInfo(); shiftEl.hidden = false; $('#sStart input').focus();
}
$('#wGrid').addEventListener('click', e => {
  const td = e.target.closest('.scell'); if (!td) return;
  if (isPublished()) return lockedMsg();
  openShift(td.dataset.id, td.dataset.d);
});
const fillShift = (a, b) => { setT('sStart', a); setT('sEnd', b); setBreak(legalBreak((tmin(b) - tmin(a)) / 60)); updateShiftInfo(); };
$('#sFillMain').addEventListener('click', () => { const s = state.staff.find(x => x.id === editShift.id); fillShift(s.start, s.end); });
$('#sFillSub').addEventListener('click', () => { const s = state.staff.find(x => x.id === editShift.id); fillShift(s.start2, s.end2); });
['click', 'input', 'change', 'focusout'].forEach(ev => shiftEl.addEventListener(ev, () => editShift && updateShiftInfo()));
$('#sCancel').addEventListener('click', closeShift);
shiftEl.addEventListener('click', e => { if (e.target === shiftEl) closeShift(); });
shiftEl.addEventListener('keydown', e => { if (e.key === 'Escape') closeShift(); });
$('#sDelete').addEventListener('click', () => {
  const { id, date } = editShift;
  delete state.shifts[date][id]; if (!hasShifts(date)) delete state.shifts[date];
  save(); closeShift(); renderShift(); ui.toast('休みにしました');
});
$('#sSave').addEventListener('click', () => {
  const a = getT('sStart'), b = getT('sEnd'), brk = +$('#sBreak').value;
  if (a === null || b === null) return ui.toast('時刻の形式が正しくありません。9:00 や 0900 のように入力してください', 'err');
  if (!a || !b) return ui.toast('出勤と退勤の時間を入れてください', 'err');
  if (tmin(b) <= tmin(a)) return ui.toast('退勤は出勤より後にしてください', 'err');
  if (brk >= tmin(b) - tmin(a)) return ui.toast('休憩が勤務時間より長くなっています', 'err');
  const { id, date } = editShift;
  (state.shifts[date] = state.shifts[date] || {})[id] = { start: a, end: b, brk };
  save(); closeShift(); renderShift(); ui.toast('シフトを保存しました');
});

/* 注意ラインの設定 */
function renderLimits() { $('#limDay').value = state.settings.limitDay; $('#limWeek').value = state.settings.limitWeek; }
['limDay', 'limWeek'].forEach(id => $('#' + id).addEventListener('change', () => {
  const d = +$('#limDay').value, w = +$('#limWeek').value;
  if (!(d > 0) || !(w > 0)) { ui.toast('0より大きい数を入れてください', 'err'); renderLimits(); return; }
  state.settings.limitDay = d; state.settings.limitWeek = w; save(); ui.toast('注意ラインを更新しました');
  if (curTab === 'shift') renderShift();
}));

/* ---- 管理者／従業員の表示切替（仮） ---- */
function setMode(m) {
  document.body.dataset.mode = m;
  document.querySelectorAll('.mbtn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  if (m === 'employee') document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'employee'));
  else switchTab(curTab);
}
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

/* ========== スタッフ一括登録 ========== */
const ROLE_PALETTE = ['#0f6e6e', '#3b6fb6', '#b45f06', '#a23b5a', '#5b7a2f', '#6b5b95', '#8a6d1d', '#2f7d9a'];
const BULK_SAMPLE = '田中太郎,レジ,4,6,1100,9:00,15:00,15:00,18:00\nSarah Lee,接客,5,5,$15,12:00,18:00,,\n佐藤花子,調理,3,8,1200,10:00,18:00,,';

/* 1行1人。タブ区切り（表計算ソフトからの貼り付け）またはカンマ区切り */
function parseBulk(text, addRoles) {
  const rows = [], errs = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const c = (line.includes('\t') ? line.split('\t') : line.split(/[,，、]/)).map(x => x.trim().replace(/^"(.*)"$/, '$1'));
    if (['名前', '氏名', 'name'].includes(c[0].toLowerCase())) return;   // 見出し行は読み飛ばす
    const [name, role = '', rt = '', hr = '', wg = '', st = '', en = '', st2 = '', en2 = ''] = c;
    const bad = [];
    if (!name) bad.push('名前がありません');
    let rating = 3;
    if (rt) rating = /^[1-5]$/.test(rt) ? +rt : (/^★{1,5}$/.test(rt) ? rt.length : 0);
    if (!rating) bad.push('評価は1〜5で入力してください');
    const hours = hr ? +hr.replace(/時間|h/gi, '') : 0;
    if (!(hours >= 0 && hours <= 24)) bad.push('希望勤務時間は0〜24で入力してください');
    const wage = wg ? +wg.replace(/[^\d.]/g, '') : 0;
    if (!(wage >= 0)) bad.push('希望給料は数字で入力してください');
    const cur = /\$|ドル|usd|dollar/i.test(wg) ? 'USD' : 'JPY';
    const [a, b, a2, b2] = [st, en, st2, en2].map(parseT);
    if ([a, b, a2, b2].includes(null)) bad.push('時刻の形式が正しくありません');
    else {
      if (!a || !b) bad.push('出勤・退勤時間が必要です');
      else if (toH(b, true) <= toH(a)) bad.push('退勤は出勤より後にしてください');
      if (!a2 !== !b2) bad.push('予備の出勤・退勤は両方入力してください');
      else if (a2 && toH(b2, true) <= toH(a2)) bad.push('予備の退勤は予備の出勤より後にしてください');
    }
    if (role && !addRoles && !state.roles.some(r => r.name === role)) bad.push(`役割「${role}」は登録されていません`);
    if (bad.length) errs.push(`${i + 1}行目：${bad.join('、')}`);
    else rows.push({ name, role, rating, hours, wage, cur, start: a, end: b, start2: a2, end2: b2 });
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

/* ========== 初期化 ========== */
resetForm(); renderRoles(); renderConditions(); renderSettings(); renderLimits(); renderTimeRange(); renderAutoRules(); renderSortBar(); renderGantt();
if (state.settings.auto) fetchRate(false);   // ページを開くたびに最新レートを取得