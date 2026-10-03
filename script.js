'use strict';

/* ========== 状態 ========== */
const KEY = 'shiftApp.v1';
const DEF_ROLES = [['レジ', '#0f6e6e'], ['接客', '#3b6fb6'], ['品出し', '#b45f06'], ['調理', '#a23b5a'], ['清掃', '#5b7a2f'], ['事務', '#6b5b95']]
  .map(([name, color]) => ({ name, color }));
/* 自動作成のルール（プリセット）。数値は 0=オフ 1=弱 2=標準 3=強 */
const PRESETS = {
  balance:   { label: 'バランス重視', desc: '人手不足を作らないことを最優先にします。希望休だけは必ず守り、足りないときは希望勤務時間や時間指定などをゆるめて補い、そのほかの時間帯も十分な人数で埋めます。迷ったらこれがおすすめです。', v: { rating: 2, contig: 2, wage: 1, fair: 1, fill: 'max', target: 'fill', sub: 'fallback', fix: 'all' } },
  headcount: { label: '人数重視', desc: '希望勤務時間にこだわらず、各時間帯を最高人数に近づけます。繁忙期や人手不足の日向けです。', v: { rating: 1, contig: 1, wage: 0, fair: 1, fill: 'max', target: 'ignore', sub: 'always', fix: 'flex' } },
  cost:      { label: '人件費重視', desc: '最低人数だけを満たし、時給の安いスタッフを優先します。予備の時間は使いません。', v: { rating: 1, contig: 2, wage: 3, fair: 0, fill: 'min', target: 'cap', sub: 'never', fix: 'off' } },
  quality:   { label: '評価重視', desc: '評価の高いスタッフを優先して配置します。忙しい時間帯の品質を上げたいときに。', v: { rating: 3, contig: 2, wage: 0, fair: 0, fill: 'mid', target: 'fill', sub: 'fallback', fix: 'flex' } },
  fair:      { label: '公平重視', desc: 'スタッフ間の勤務時間をなるべく揃えます。希望時間を超えては入れません。', v: { rating: 1, contig: 2, wage: 1, fair: 3, fill: 'mid', target: 'cap', sub: 'fallback', fix: 'off' } },
  wish:      { label: '希望優先', desc: '希望勤務時間と本来の出退勤時間を最優先し、予備の時間は使いません。', v: { rating: 1, contig: 2, wage: 0, fair: 1, fill: 'max', target: 'fill', sub: 'never', fix: 'off' } }
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
  s.deadlines = s.deadlines || {};  // { 期間の開始日: 提出締切の日付 }
  s.settings = s.settings || { display: 'JPY', rate: 150 };
  if (s.settings.auto === undefined) s.settings.auto = true;
  if (!s.settings.sort) s.settings.sort = { key: 'manual', desc: false };
  if (s.settings.limitDay === undefined) { s.settings.limitDay = 8; s.settings.limitWeek = 40; }
  if (s.settings.maxStreak === undefined) s.settings.maxStreak = 6;
  if (s.settings.deadlineDays === undefined) s.settings.deadlineDays = 0;   // 締切の初期値（期間の開始日の何日前。0=設定しない）
  if (!s.settings.layout) s.settings.layout = 'auto';
  s.prefs = s.prefs || {};          // 従業員の希望 { スタッフID: { dates, rules, comments, submissions } }
  if (!s.settings.period) {
    const n = new Date(), m = new Date(n.getFullYear(), n.getMonth(), n.getDate() - ((n.getDay() + 6) % 7));
    s.settings.period = { mode: 'month', startDay: 1, weeks: 2, anchor: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-${String(m.getDate()).padStart(2, '0')}` };
  }
  if (s.autoRules.fix === undefined) s.autoRules.fix = (PRESETS[s.autoRules.preset] || PRESETS.balance).v.fix;
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
  const fire = () => el.dispatchEvent(new Event('tchange', { bubbles: true }));
  const mark = () => {
    const v = parseT(inp.value) || '';
    pop.querySelectorAll('.tcol').forEach(col => col.querySelectorAll('button').forEach(b => {
      const sel = v && b.textContent === (col.dataset.k === 'h' ? v.slice(0, 2) : v.slice(3));
      b.classList.toggle('sel', !!sel);
      if (sel && col.dataset.k === 'h') col.scrollTop = b.offsetTop - col.offsetTop - 60;
    }));
  };
  inp.addEventListener('blur', () => { const v = parseT(inp.value); inp.classList.toggle('bad', v === null); if (v) inp.value = v; fire(); });
  inp.addEventListener('input', () => inp.classList.remove('bad'));
  el.querySelector('.tbtn').onclick = () => { const open = pop.hidden; closePops(); if (open) { pop.hidden = false; mark(); } };
  pop.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    inp.classList.remove('bad');
    if (b.classList.contains('tclear')) { inp.value = ''; pop.hidden = true; fire(); return; }
    const cur = parseT(inp.value) || '00:00', k = b.parentElement.dataset.k;
    inp.value = k === 'h' ? b.textContent + ':' + (b.textContent === '28' ? '00' : cur.slice(3)) : cur.slice(0, 2) + ':' + b.textContent;
    if (k === 'm') pop.hidden = true; else mark();
    fire();
  };
}
const getT = id => parseT($('#' + id + ' input').value);
const setT = (id, t) => { const i = $('#' + id + ' input'); i.value = t || ''; i.classList.remove('bad'); };
['fStart', 'fEnd', 'fStart2', 'fEnd2', 'sStart', 'sEnd', 'eFrom', 'eTo'].forEach(timeField);

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
    delete state.prefs[del];
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
const AR_FIELDS = { rating: 'aRating', contig: 'aContig', wage: 'aWage', fair: 'aFair', fill: 'aFill', target: 'aTarget', sub: 'aSub', fix: 'aFix' };
const AR_NUM = ['rating', 'contig', 'wage', 'fair'];
const AR_OPTS = {
  fill: [['min', '最低人数まで（人件費を抑える）'], ['mid', '最低と最高の中間まで'], ['max', '最高人数まで']],
  target: [['fill', '希望勤務時間まで勤務を追加する'], ['cap', '希望勤務時間を上限にする（追加はしない）'], ['ignore', '希望勤務時間を気にしない']],
  sub: [['never', '使わない'], ['fallback', '人手が足りないときだけ使う'], ['always', '本来の時間と同等に使う']],
  fix: [['off', 'ゆるめない（足りないままにする）'], ['flex', '希望勤務時間・予備の時間・休みの日をゆるめて補う'], ['all', 'さらに時間指定・勤務時間の上限・連続勤務の上限もゆるめて補う（希望休は必ず守る）']]
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
const roleMinOf = r => (state.roleRules[r] && state.roleRules[r].min) || 0;
const shortageOf = (cnt, roleAt, H) => {   // 最低人数（全体・役割ごと）に足りない延べ人数
  let n = 0;
  H.forEach(h => { n += Math.max(0, rule(h).min - cnt[h]); state.roles.forEach(r => { n += Math.max(0, roleMinOf(r.name) - (roleAt[h][r.name] || 0)); }); });
  return n;
};
const makeP = (s, main, sub, target, bias = 0, rest = false) => ({ s, main, sub, target, bias, rest, yen: (s.cur === 'USD' ? s.wage * state.settings.rate : s.wage) || 0 });

/* 1日分（時間帯ごと）の配置を解く。P: 配置の対象になるスタッフ。bias は大きいほど後回しにする重み */
function solveHours(P, H) {
  const R = state.autoRules;
  const W = { rating: [0, 1, 2, 4][R.rating], contig: [0, 1, 2, 4][R.contig], wage: [0, 0.3, 1, 2.5][R.wage], fair: [0, 0.4, 1, 2][R.fair] };
  const sch = {}, cnt = {}, roleAt = {};
  H.forEach(h => { cnt[h] = 0; roleAt[h] = {}; });
  P.forEach(p => sch[p.s.id] = []);
  const rr = state.roleRules;
  const roleMax = r => (rr[r] && rr[r].max != null) ? rr[r].max : Infinity;
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
      - mine.length * W.fair                                      // 勤務時間の公平さ
      - (p.bias || 0);                                            // 期間全体での公平さ（これまでの勤務が多い人を後回し）
  };
  const best = (h, only, noRest) => {
    let b = null, bs = -Infinity;
    P.forEach(p => { if ((only && p.s.role !== only) || (noRest && p.rest)) return; const v = score(p, h); if (v > bs) { bs = v; b = p; } });
    return b;
  };
  const avail = h => P.filter(p => score(p, h) > -Infinity).length;

  // 1) 候補が少ない時間帯から、役割ごとの最低人数 → 全体の最低人数を満たす
  [...H].sort((a, b) => avail(a) - avail(b)).forEach(h => {
    state.roles.forEach(ro => {
      while ((roleAt[h][ro.name] || 0) < roleMinOf(ro.name) && cnt[h] < rule(h).max) {
        const p = best(h, ro.name); if (!p) break; assign(p, h);
      }
    });
    while (cnt[h] < rule(h).min) { const p = best(h); if (!p) break; assign(p, h); }
  });

  // 2) 希望勤務時間まで勤務を追加（「希望勤務時間まで追加する」のとき）
  if (R.target === 'fill') {
    [...P].sort((a, b) => (a.bias - b.bias) || (W.rating ? b.s.rating - a.s.rating : 0)).forEach(p => {
      if (p.rest) return;   // 休みの日は、最低人数を満たすために必要なときだけ出勤
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
    while (cnt[h] < capH(h)) { const p = best(h, null, true); if (!p) break; assign(p, h); }
  });
  return { sch, cnt, roleAt };
}

/* ホームの「作業スケジュール」（1日分）を自動作成 */
function autoGenerate() {
  const R = state.autoRules, H = hoursList();
  const mk = relax => state.staff.map(s => { const m = mainHours(s); return makeP(s, m, (R.sub === 'never' && !relax) ? [] : subHours(s), (R.target === 'ignore' || relax) ? Infinity : (s.hours || m.length)); });
  let out = solveHours(mk(false), H);
  if (R.fix !== 'off' && shortageOf(out.cnt, out.roleAt, H) > 0) {   // 人手不足なら、希望勤務時間・予備の時間をゆるめてやり直す
    const o2 = solveHours(mk(true), H);
    if (shortageOf(o2.cnt, o2.roleAt, H) < shortageOf(out.cnt, out.roleAt, H)) out = o2;
  }
  const { sch, cnt, roleAt } = out;
  state.schedule = sch; save();
  const roles = state.roles.map(r => [r.name, H.filter(h => (roleAt[h][r.name] || 0) < roleMinOf(r.name)).length]).filter(x => x[1] > 0);
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

/* ========== 期間（シフト表の区切り） ========== */
const DAY_W = 112, DOW = ['日', '月', '火', '水', '木', '金', '土'], DOW_MON = ['月', '火', '水', '木', '金', '土', '日'];
const pad2 = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseYmd = t => { const [y, m, d] = t.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = d => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7));
const tmin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const hm = t => t.replace(/^0/, '');
const fh = x => String(Math.round(x * 100) / 100);
const shiftHours = sh => (!sh || sh.off) ? 0 : Math.max(0, (tmin(sh.end) - tmin(sh.start) - (sh.brk || 0)) / 60);   // 休み(off)は0時間
const legalBreak = h => h > 8 ? 60 : h > 6 ? 45 : 0;   // 法定の最低休憩の目安（6時間超45分／8時間超60分）
const fmtAt = iso => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

/* 日付を含む期間 { start, end(この日は含まない) } を返す。区切り方は設定タブで決める */
function periodOf(date) {
  const S = state.settings.period, d0 = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (S.mode === 'month') {
    let m = d0.getMonth(); if (d0.getDate() < S.startDay) m--;
    return { start: new Date(d0.getFullYear(), m, S.startDay), end: new Date(d0.getFullYear(), m + 1, S.startDay) };
  }
  const len = 7 * S.weeks, anchor = parseYmd(S.anchor), days = Math.round((d0 - anchor) / 864e5);
  const start = addDays(anchor, Math.floor(days / len) * len);
  return { start, end: addDays(start, len) };
}
const pKeys = p => { const out = []; for (let d = p.start; d < p.end; d = addDays(d, 1)) out.push(ymd(d)); return out; };
const pLabel = p => { const e = addDays(p.end, -1); return `${p.start.getFullYear()}年 ${p.start.getMonth() + 1}/${p.start.getDate()}〜${e.getMonth() + 1}/${e.getDate()}（${pKeys(p).length}日間）`; };
const pkOf = date => ymd(periodOf(parseYmd(date)).start);
let aP = periodOf(new Date()), eP = periodOf(new Date());   // 管理者側／従業員側で表示中の期間

const dayShifts = k => state.shifts[k] || {};
const hasShifts = k => Object.keys(dayShifts(k)).length > 0;            // 何か記録がある（休みを含む）
const isWork = sh => !!sh && !sh.off;                                    // 勤務のシフト（休みは含まない）
const hasWork = k => Object.values(dayShifts(k)).some(isWork);
const todayKey = () => ymd(new Date());
const mdText = k => { const d = parseYmd(k); return `${d.getMonth() + 1}/${d.getDate()}`; };
/* 提出締切：期間ごとの指定 ＞ 設定タブの初期値（開始日の○日前）。締切日の終わりまで提出できる */
const deadlineOf = pk => state.deadlines[pk] || (state.settings.deadlineDays > 0 ? ymd(addDays(parseYmd(pk), -state.settings.deadlineDays)) : '');
const isClosed = pk => { const d = deadlineOf(pk); return !!d && todayKey() > d; };
function deadlineText(pk) {
  const dl = deadlineOf(pk); if (!dl) return '提出締切は未設定です';
  const diff = Math.round((parseYmd(dl) - parseYmd(todayKey())) / 864e5);
  return `提出締切 ${mdText(dl)}` + (diff < 0 ? '（過ぎました）' : diff === 0 ? '（今日まで）' : `（あと${diff}日）`);
}
const wkHours = (id, k) => {   // その日を含む週（月〜日）の勤務時間
  const m = mondayOf(parseYmd(k)); let t = 0;
  for (let i = 0; i < 7; i++) { const sh = dayShifts(ymd(addDays(m, i)))[id]; if (sh) t += shiftHours(sh); }
  return t;
};

/* ========== 従業員の希望 ========== */
const RULE_TARGETS = [['weekday', '平日（月〜金）'], ['holiday', '休日（土・日）'], ['dow1', '毎週月曜日'], ['dow2', '毎週火曜日'], ['dow3', '毎週水曜日'], ['dow4', '毎週木曜日'], ['dow5', '毎週金曜日'], ['dow6', '毎週土曜日'], ['dow0', '毎週日曜日']];
const RULE_STATUS = [['ok', '出勤可能'], ['off', '希望休'], ['time', '時間を指定して出勤可能']];
function pf(id) {
  const P = state.prefs[id] = state.prefs[id] || {};
  P.dates = P.dates || {}; P.rules = P.rules || []; P.comments = P.comments || {}; P.submissions = P.submissions || {};
  return P;
}
/* ある日の希望（日付ごとの指定 ＞ 曜日 ＞ 平日・休日 ＞ 出勤可能） */
function effPref(id, key) {
  const P = pf(id), d = P.dates[key];
  if (d) return { ...d, src: 'date' };
  const dow = parseYmd(key).getDay();
  const r = P.rules.find(x => x.target === 'dow' + dow) || P.rules.find(x => x.target === (dow === 0 || dow === 6 ? 'holiday' : 'weekday'));
  if (r && (r.status !== 'time' || (r.start && r.end))) return { status: r.status, start: r.start, end: r.end, src: 'rule' };
  return { status: 'ok', src: 'default' };
}
function snapshotFor(id, keys) {   // 出勤可能以外の日だけ記録する
  const o = {};
  keys.forEach(k => { const e = effPref(id, k); if (e.status !== 'ok') o[k] = e.status === 'time' ? { status: 'time', start: e.start, end: e.end } : { status: 'off' }; });
  return o;
}
const subOf = (id, pk) => pf(id).submissions[pk];
const adminPref = (id, key, pk) => { const sb = subOf(id, pk); return (sb && sb.snap[key]) || { status: 'ok' };   };
const prefText = p => p.status === 'off' ? '希望休' : p.status === 'time' ? `${hm(p.start)}〜${hm(p.end)} なら出勤可能` : '出勤可能';

/* ========== 管理者：シフト管理 ========== */
const isPublished = () => !!state.published[ymd(aP.start)];

/* ---- 画面サイズの自動判定（PC・タブレット横向き ／ スマホ・タブレット縦向き） ---- */
const mqMobile = window.matchMedia ? window.matchMedia('(orientation: portrait), (max-width: 820px)') : null;
const detectLayout = () => { const p = state.settings.layout || 'auto'; return p === 'auto' ? ((mqMobile && mqMobile.matches) ? 'mobile' : 'desktop') : p; };
let layout = detectLayout();
document.body.dataset.layout = layout;
function renderActive() {
  const m = document.body.dataset.mode;
  if (m === 'employee') renderEmployee();
  else if (m === 'dev') renderDev();
  else if (curTab === 'shift') renderShift();
  else if (curTab === 'home') renderGantt();
}
function applyLayout() {
  const next = detectLayout();
  document.body.dataset.layout = next;
  if (next !== layout) { layout = next; renderActive(); }
}
if (mqMobile) { if (mqMobile.addEventListener) mqMobile.addEventListener('change', applyLayout); else if (mqMobile.addListener) mqMobile.addListener(applyLayout); }

/* その日の出勤人数と、最低人数（全体・役割ごと）に足りないか */
function dayStat(k) {
  const H = hoursList(), cnt = {}, roleAt = {};
  H.forEach(h => { cnt[h] = 0; roleAt[h] = {}; });
  let n = 0;
  state.staff.forEach(s => {
    const sh = dayShifts(k)[s.id]; if (!isWork(sh)) return;
    n++;
    for (let h = Math.floor(tmin(sh.start) / 60); h < Math.ceil(tmin(sh.end) / 60); h++) if (cnt[h] !== undefined) { cnt[h]++; roleAt[h][s.role] = (roleAt[h][s.role] || 0) + 1; }
  });
  return { n, short: shortageOf(cnt, roleAt, H) };
}
/* 希望との食い違い：'req'=希望休の日 ／ 'out'=希望の時間外 */
const conflictOf = (sh, pref) => pref.status === 'off' ? 'req' : (pref.status === 'time' && (tmin(sh.start) < tmin(pref.start) || tmin(sh.end) > tmin(pref.end))) ? 'out' : '';

/* 表の1マス（PC版） */
function shiftCell(s, k, pk, compact) {
  const sh = dayShifts(k)[s.id], pref = adminPref(s.id, k, pk), L = state.settings, attr = `data-id="${s.id}" data-d="${k}"`, c = compact ? ' c' : '';
  if (isWork(sh)) {
    const hrs = shiftHours(sh), over = hrs > L.limitDay, cf = conflictOf(sh, pref);
    const title = `${s.name} ${hm(sh.start)}–${hm(sh.end)}（実働${fh(hrs)}時間${sh.brk ? '・休憩' + sh.brk + '分' : ''}）${cf === 'req' ? ' ※希望休の日です' : cf === 'out' ? ' ※希望の時間外です' : ''}`;
    const tag = !cf ? '' : compact ? '<em class="tag">!</em>' : `<em class="tag">${cf === 'req' ? '休希望' : '時間外'}</em>`;
    const body = compact ? `<span>${hm(sh.start)}</span><span>${hm(sh.end)}</span>` : `${hm(sh.start)}–${hm(sh.end)}<small>${fh(hrs)}時間${over ? ' ⚠' : ''}</small>`;
    return { hrs, html: `<td class="scell on${over ? ' over' : ''}${c}" style="background:${roleColor(s.role)}" title="${esc(title)}" ${attr}>${body}${tag}</td>` };
  }
  let cls, lab, title;
  if (pref.status === 'off') { cls = 'pf-off'; lab = '希望休'; title = '本人の希望休'; }
  else if (sh && sh.off) { cls = 'rest'; lab = '休み'; title = 'こちらで指定した休み'; }
  else if (pref.status === 'time') { cls = 'pf-time'; lab = compact ? `<span>${hm(pref.start)}</span><span>${hm(pref.end)}</span>` : `${hm(pref.start)}–${hm(pref.end)}<small>のみ可</small>`; title = `${hm(pref.start)}〜${hm(pref.end)} なら出勤可能`; }
  else { cls = 'pf-ok'; lab = '○'; title = '未決定（出勤可能）'; }
  return { hrs: 0, html: `<td class="scell empty ${cls}${c}" title="${esc(s.name + '：' + title)}" ${attr}>${lab}</td>` };
}

function renderShiftDesktop(keys, pk) {
  const today = todayKey(), L = state.settings, anyWage = state.staff.some(s => s.wage), compact = keys.length > 14, nameW = compact ? 156 : NAME_W;
  const dayCount = Array(keys.length).fill(0), dayCost = Array(keys.length).fill(0), touched = keys.map(hasShifts), stat = keys.map(k => dayStat(k));
  let html = `<table class="gantt shiftgrid${compact ? ' compact' : ''}" style="width:100%;min-width:${nameW + keys.length * (compact ? 30 : 64)}px"><colgroup><col style="width:${nameW}px"></colgroup><thead><tr><th class="name">スタッフ</th>` +
    keys.map((k, i) => { const d = parseYmd(k); return `<th class="${k === today ? 'today ' : ''}${d.getDay() === 0 ? 'sun' : d.getDay() === 6 ? 'sat' : ''}" title="${mdText(k)}（${DOW[d.getDay()]}）">${compact && i && d.getDate() !== 1 ? d.getDate() : mdText(k)}<small>${compact ? DOW[d.getDay()] : '（' + DOW[d.getDay()] + '）'}</small></th>`; }).join('') + '</tr></thead><tbody>';
  state.staff.forEach(s => {
    const sb = subOf(s.id, pk); let tot = 0;
    const cells = keys.map((k, i) => {
      const c = shiftCell(s, k, pk, compact);
      if (c.hrs > 0 || isWork(dayShifts(k)[s.id])) { tot += c.hrs; dayCount[i]++; dayCost[i] += c.hrs * hourly(s); }
      return c.html;
    }).join('');
    const cost = tot * hourly(s);
    const overW = [...new Set(keys.map(k => ymd(mondayOf(parseYmd(k)))))].some(m => wkHours(s.id, m) > L.limitWeek);
    html += `<tr><th class="name"><b>${esc(s.name)}</b><div class="meta">${esc(s.role || '役割なし')}${compact ? (sb ? '' : ' ・<span class="warnText">未提出</span>') : ` ／ <span class="${sb ? '' : 'warnText'}">${sb ? '希望提出済み' : '希望未提出'}</span>`}</div>
      <div class="meta${overW ? ' warnText' : ''}">${compact ? fh(tot) + 'h' : '合計' + fh(tot) + '時間'}${s.wage ? '・' + money(cost) : ''}${overW ? ' ⚠週超過' : ''}</div></th>${cells}</tr>`;
  });
  html += '</tbody><tfoot><tr><th class="name">出勤人数</th>' + dayCount.map((n, i) => `<td class="${touched[i] && stat[i].short ? 'low' : ''}" title="${stat[i].short && touched[i] ? '最低人数に足りない時間帯があります' : ''}">${n}${compact ? '' : '人'}</td>`).join('') + '</tr>';
  if (anyWage) html += '<tr><th class="name">人件費</th>' + dayCost.map(c => `<td>${c ? (compact ? Math.round(c / 1000) + 'k' : money(c)) : '—'}</td>`).join('') + '</tr>';
  $('#wGrid').innerHTML = html + '</tfoot></table>';
}

/* ---- スマホ版：月カレンダー（出勤人数つき）＋ 選んだ日のスタッフ一覧 ---- */
let mDay = null;
function renderShiftMobile(keys, pk) {
  const today = todayKey();
  if (!mDay || !keys.includes(mDay)) mDay = keys.includes(today) ? today : keys[0];
  let html = '<div class="mcal">' + DOW_MON.map(d => `<div class="dow">${d}</div>`).join('') + '<div class="mday blank"></div>'.repeat((aP.start.getDay() + 6) % 7);
  keys.forEach(k => {
    const d = parseYmd(k), st = dayStat(k), t = hasShifts(k), wd = d.getDay();
    html += `<button type="button" class="mday${k === mDay ? ' sel' : ''}${k === today ? ' today' : ''}${t && st.short ? ' low' : ''}${wd === 0 ? ' sun' : wd === 6 ? ' sat' : ''}" data-k="${k}"><b>${d.getDate()}</b><span>${t ? st.n + '人' : '—'}</span></button>`;
  });
  html += '</div>';
  const d = parseYmd(mDay), st = dayStat(mDay), idx = keys.indexOf(mDay), t = hasShifts(mDay);
  html += `<div class="mday-head"><button type="button" class="btn small" data-mnav="-1"${idx === 0 ? ' disabled' : ''} aria-label="前の日">‹</button><strong>${d.getMonth() + 1}/${d.getDate()}（${DOW[d.getDay()]}）</strong>` +
    `<button type="button" class="btn small" data-mnav="1"${idx === keys.length - 1 ? ' disabled' : ''} aria-label="次の日">›</button>` +
    `<span class="pill${t && st.short ? ' warn' : ' ok'}">${t ? st.n + '人' + (st.short ? '・人手不足あり' : '') : '未作成'}</span></div><ul class="mlist">`;
  state.staff.forEach(s => {
    const sh = dayShifts(mDay)[s.id], pref = adminPref(s.id, mDay, pk);
    let chip, cls = '', style = '';
    if (isWork(sh)) {
      const cf = conflictOf(sh, pref);
      chip = `${hm(sh.start)}–${hm(sh.end)}（${fh(shiftHours(sh))}時間）${cf === 'req' ? ' ※希望休の日' : cf === 'out' ? ' ※時間外' : ''}`; cls = 'work'; style = ` style="background:${roleColor(s.role)}"`;
    } else if (pref.status === 'off') { chip = '希望休'; cls = 'pf-off'; }
    else if (sh && sh.off) { chip = '休み'; cls = 'rest'; }
    else if (pref.status === 'time') { chip = `${hm(pref.start)}–${hm(pref.end)} のみ可`; cls = 'pf-time'; }
    else { chip = '未決定（○）'; cls = 'pf-ok'; }
    html += `<li><button type="button" class="mrow" data-id="${s.id}" data-d="${mDay}"><span class="mname"><b>${esc(s.name)}</b><i>${esc(s.role || '役割なし')}</i></span><span class="mchip ${cls}"${style}>${chip}</span></button></li>`;
  });
  $('#wMobile').innerHTML = html + '</ul>';
}
$('#wMobile').addEventListener('click', e => {
  const day = e.target.closest('.mday[data-k]'), nav = e.target.closest('[data-mnav]'), row = e.target.closest('.mrow');
  if (day) { mDay = day.dataset.k; renderShift(); }
  else if (nav) { const keys = pKeys(aP), i = keys.indexOf(mDay) + +nav.dataset.mnav; if (keys[i]) { mDay = keys[i]; renderShift(); } }
  else if (row) activateCell(row.dataset.id, row.dataset.d);
});

function renderShift() {
  const p = aP, keys = pKeys(p), pk = ymd(p.start), pub = isPublished(), mobile = layout === 'mobile';
  $('#wLabel').textContent = pLabel(p);
  $('#wStatus').textContent = pub ? '確定済み' : '下書き'; $('#wStatus').className = 'pill' + (pub ? ' ok' : '');
  $('#wPublish').textContent = pub ? '確定を解除' : '確定する';
  $('#wJump').value = pk;
  $('#wDeadline').value = state.deadlines[pk] || '';
  const unsub = state.staff.filter(s => !subOf(s.id, pk)).length;
  $('#wDlInfo').textContent = `${deadlineText(pk)}・未提出${unsub}人`; $('#wDlInfo').className = 'pill' + (isClosed(pk) ? ' warn' : '');
  $('#wGrid').hidden = mobile; $('#wMobile').hidden = !mobile;
  $('#wGrid').classList.toggle('locked', pub); $('#wMobile').classList.toggle('locked', pub);
  if (!state.staff.length) {
    const msg = '<div class="empty">スタッフがまだいません。「作業スケジュール作成」タブから登録してください。</div>';
    $('#wGrid').innerHTML = msg; $('#wMobile').innerHTML = msg; $('#wTotal').textContent = ''; $('#wReq').innerHTML = ''; return;
  }
  if (mobile) renderShiftMobile(keys, pk); else renderShiftDesktop(keys, pk);
  const anyWage = state.staff.some(s => s.wage);
  let grand = 0, grandCost = 0;
  state.staff.forEach(s => keys.forEach(k => { const h = shiftHours(dayShifts(k)[s.id]); grand += h; grandCost += h * hourly(s); }));
  $('#wTotal').textContent = grand ? `この期間の合計　${fh(grand)}時間${anyWage ? '・' + money(grandCost) : ''}` : '';
  renderReqPanel(keys, pk);
}

function renderReqPanel(keys, pk) {
  $('#wReq').innerHTML = `<h3>従業員からの希望（提出状況とコメント）</h3><p class="meta">${deadlineText(pk)}</p><ul class="reqlist">` + state.staff.map(s => {
    const sb = subOf(s.id, pk);
    const ent = sb ? Object.entries(sb.snap).filter(([k]) => keys.includes(k)) : [];
    const off = ent.filter(([, v]) => v.status === 'off').length, tm = ent.length - off;
    return `<li><div class="rq-head"><b>${esc(s.name)}</b><span class="pill${sb ? ' ok' : ''}">${sb ? '提出済み ' + fmtAt(sb.at) : '未提出'}</span>` +
      (sb ? `<span class="meta">希望休 ${off}日・時間指定 ${tm}日</span>` : '') + '</div>' +
      (sb && sb.comment ? `<div class="cmt">${esc(sb.comment)}</div>` : '') + '</li>';
  }).join('') + '</ul>';
}

/* 期間の移動・提出締切 */
$('#wPrev').addEventListener('click', () => { aP = periodOf(addDays(aP.start, -1)); renderShift(); });
$('#wNext').addEventListener('click', () => { aP = periodOf(aP.end); renderShift(); });
$('#wToday').addEventListener('click', () => { aP = periodOf(new Date()); renderShift(); });
$('#wJump').addEventListener('change', () => { if ($('#wJump').value) { aP = periodOf(parseYmd($('#wJump').value)); renderShift(); } });
$('#wDeadline').addEventListener('change', () => {
  const pk = ymd(aP.start), v = $('#wDeadline').value;
  if (v) { state.deadlines[pk] = v; ui.toast(`提出締切を ${mdText(v)} にしました`); } else delete state.deadlines[pk];
  save(); renderShift();
});
$('#wDlClear').addEventListener('click', () => {
  const pk = ymd(aP.start);
  if (!state.deadlines[pk]) return ui.toast('この期間に個別の締切は設定されていません', 'warn');
  delete state.deadlines[pk]; save(); renderShift(); ui.toast('この期間の締切の指定を解除しました');
});

const lockedMsg = () => ui.toast('確定済みの期間です。変更するには「確定を解除」を押してください', 'warn');
$('#wCopy').addEventListener('click', async () => {
  if (isPublished()) return lockedMsg();
  const keys = pKeys(aP), prev = pKeys(periodOf(addDays(aP.start, -1)));
  if (!prev.some(hasShifts)) return ui.toast('前の期間にシフトがありません', 'warn');
  if (keys.some(hasShifts) && !await ui.ask('この期間のシフトを、前の期間の内容で上書きします。よろしいですか？', { ok: '上書きする', danger: true })) return;
  keys.forEach((k, i) => { if (prev[i] && hasShifts(prev[i])) state.shifts[k] = JSON.parse(JSON.stringify(state.shifts[prev[i]])); else delete state.shifts[k]; });
  save(); renderShift(); ui.toast('前の期間のシフトをコピーしました');
});
$('#wClear').addEventListener('click', async () => {
  if (isPublished()) return lockedMsg();
  const keys = pKeys(aP);
  if (!keys.some(hasShifts)) return ui.toast('この期間にシフトはありません', 'warn');
  if (!await ui.ask('この期間のシフトをすべて消します。よろしいですか？', { ok: '空にする', danger: true })) return;
  keys.forEach(k => delete state.shifts[k]); save(); renderShift(); ui.toast('この期間のシフトを空にしました');
});
$('#wPublish').addEventListener('click', async () => {
  const pk = ymd(aP.start);
  if (isPublished()) { delete state.published[pk]; save(); renderShift(); return ui.toast('確定を解除しました（下書きに戻しました）'); }
  if (!pKeys(aP).some(hasWork)) return ui.toast('確定するシフトがありません', 'warn');
  if (!await ui.ask('この期間のシフトを確定します。確定中は編集できません（解除すればまた編集できます）。', { ok: '確定する' })) return;
  state.published[pk] = true; save(); renderShift(); ui.toast('この期間のシフトを確定しました');
});

/* ---- 期間まるごと自動作成 ----
   希望休は必ず守る。人手が足りない日は、設定「人手が足りないときの対応」に従って、段階的に条件をゆるめて補う。
   level 0=通常 ／ 1=希望勤務時間・予備の時間・休みの日をゆるめる ／ 2=さらに時間指定・勤務時間の上限・連続勤務の上限もゆるめる */
function autoShifts(p) {
  const keys = pKeys(p), R = state.autoRules, S = state.settings, H = hoursList(), pk = ymd(p.start);
  const fairP = [0, 0.15, 0.3, 0.6][R.fair], total = {}, shortDays = [], relaxed = { soft: 0, hard: 0 };
  const maxLevel = R.fix === 'all' ? 2 : R.fix === 'flex' ? 1 : 0;
  state.staff.forEach(s => total[s.id] = 0);
  keys.forEach(k => delete state.shifts[k]);
  const streakOf = (id, k) => { let n = 0; for (let i = 1; i <= S.maxStreak; i++) { if (isWork(dayShifts(ymd(addDays(parseYmd(k), -i)))[id])) n++; else break; } return n; };
  const build = (k, level) => {
    const P = [];
    state.staff.forEach((s, idx) => {
      const pref = adminPref(s.id, k, pk);
      if (pref.status === 'off') return;                                                 // 希望休は、どの段階でも必ず守る
      if (level < 2 && streakOf(s.id, k) >= S.maxStreak) return;                         // 連続勤務の上限
      const room = level < 2 ? Math.min(S.limitDay, S.limitWeek - wkHours(s.id, k)) : Infinity;   // 1日・週の注意ライン
      if (room <= 0) return;
      let main = mainHours(s), sub = (R.sub === 'never' && level < 1) ? [] : subHours(s);
      if (pref.status === 'time' && level < 2) {                                         // 希望の時間帯に限る
        const lo = toH(pref.start), hi = toH(pref.end, true);
        main = main.filter(h => h >= lo && h < hi); sub = sub.filter(h => h >= lo && h < hi);
      }
      if (!main.length && !sub.length) return;
      const base = (R.target === 'ignore' || level >= 1) ? Infinity : (s.hours || mainHours(s).length);
      P.push(makeP(s, main, sub, Math.min(base, room), total[s.id] * fairP, level < 1 && parseYmd(k).getDay() === (idx + 1) % 7));   // 週に1日は、スタッフごとに曜日をずらして休み
    });
    return P;
  };
  keys.forEach(k => {
    let best = null, bestShort = Infinity, used = 0;
    for (let lv = 0; lv <= maxLevel; lv++) {
      const P = build(k, lv), res = solveHours(P, H), sc = shortageOf(res.cnt, res.roleAt, H);
      if (sc < bestShort) { best = { P, res }; bestShort = sc; used = lv; }
      if (sc === 0) break;
    }
    if (used === 1) relaxed.soft++; else if (used === 2) relaxed.hard++;
    if (bestShort > 0) shortDays.push(k);
    best.P.forEach(({ s }) => {
      const hrs = best.res.sch[s.id].slice().sort((a, b) => a - b); if (!hrs.length) return;
      const blocks = [];   // 1時間以内の空きはつなげ、離れているときは一番長い塊を残す
      hrs.forEach(h => { const b = blocks[blocks.length - 1]; if (b && h - b.e <= 1) { b.e = h; b.n++; } else blocks.push({ s: h, e: h, n: 1 }); });
      const bk = blocks.reduce((a, b) => b.n > a.n ? b : a);
      const rec = { start: pad2(bk.s) + ':00', end: pad2(bk.e + 1) + ':00', brk: legalBreak(bk.e + 1 - bk.s) };
      (state.shifts[k] = state.shifts[k] || {})[s.id] = rec;
      total[s.id] += shiftHours(rec);
    });
    // 勤務のない日は「休み」にする（希望休の日は、希望休のまま）
    state.staff.forEach(s => { if (!isWork(dayShifts(k)[s.id]) && adminPref(s.id, k, pk).status !== 'off') (state.shifts[k] = state.shifts[k] || {})[s.id] = { off: true }; });
  });
  return { shortDays, relaxed };
}
$('#wAuto').addEventListener('click', async () => {
  const pk = ymd(aP.start);
  if (isPublished()) return lockedMsg();
  if (!state.staff.length) return ui.toast('先にスタッフを登録してください', 'err');
  const unsub = state.staff.filter(s => !subOf(s.id, pk)).map(s => s.name);
  const msg = `${pLabel(aP)} のシフトを自動作成します。` + (pKeys(aP).some(hasShifts) ? '\n今のシフト（休みの指定を含む）は作り直されます。' : '') +
    (unsub.length ? `\n\n希望が未提出の人：${unsub.join('、')}\n（希望休なし・出勤可能として扱います）` : '') + `\n\nルール：${ruleLabel()}`;
  if (!await ui.ask(msg, { ok: '自動作成する' })) return;
  const { shortDays, relaxed } = autoShifts(aP); save(); renderShift();
  const notes = [];
  if (relaxed.soft) notes.push(`${relaxed.soft}日は人手不足を補うため、希望勤務時間などをゆるめました。`);
  if (relaxed.hard) notes.push(`${relaxed.hard}日は時間指定・勤務時間の上限・連続勤務の上限までゆるめました（⚠や時間外の印を確認してください）。`);
  if (shortDays.length) notes.push(`それでも最低人数に届かない日：${shortDays.slice(0, 4).map(mdText).join('、')}${shortDays.length > 4 ? `…ほか${shortDays.length - 4}日` : ''}`);
  ui.toast(`シフトを自動作成しました（${ruleLabel()}）。` + (notes.join('') || '必要なマスを調整してください'), (relaxed.hard || shortDays.length) ? 'warn' : '');
});

/* ---- マスの編集ダイアログ ---- */
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
  const s = state.staff.find(x => x.id === id), cur = dayShifts(date)[id], pref = adminPref(id, date, pkOf(date)), work = isWork(cur);
  editShift = { id, date };
  $('#sTitle').textContent = `${s.name}　${date.replace(/-/g, '/')}（${DOW[parseYmd(date).getDay()]}）`;
  $('#sHint').textContent = `通常の出勤時間：${s.start}–${s.end}` + (s.start2 ? `／予備：${s.start2}–${s.end2}` : '') + (cur && cur.off ? '　【今は「休み」に指定中】' : '');
  $('#sPref').textContent = '本人の希望：' + prefText(pref);
  $('#sFillSub').hidden = !s.start2;
  setT('sStart', work ? cur.start : ''); setT('sEnd', work ? cur.end : ''); setBreak(work ? cur.brk : 0);
  $('#sDelete').hidden = !!(cur && cur.off); $('#sUnset').hidden = !cur; $('#sSave').textContent = work ? '変更を保存' : '保存';
  updateShiftInfo(); shiftEl.hidden = false; $('#sStart input').focus();
}
async function activateCell(id, k) {
  if (isPublished()) return lockedMsg();
  const s = state.staff.find(x => x.id === id);
  // 希望休の日に新しくシフトを入れるときは確認する
  if (adminPref(id, k, pkOf(k)).status === 'off' && !isWork(dayShifts(k)[id]) &&
      !await ui.ask(`${s.name}さんは ${k.replace(/-/g, '/')} を「希望休」で提出しています。\nそれでもシフトを入れますか？`, { ok: 'シフトを入れる', danger: true })) return;
  openShift(id, k);
}
$('#wGrid').addEventListener('click', e => { const td = e.target.closest('.scell'); if (td) activateCell(td.dataset.id, td.dataset.d); });
const fillShift = (a, b) => { setT('sStart', a); setT('sEnd', b); setBreak(legalBreak((tmin(b) - tmin(a)) / 60)); updateShiftInfo(); };
$('#sFillMain').addEventListener('click', () => { const s = state.staff.find(x => x.id === editShift.id); fillShift(s.start, s.end); });
$('#sFillSub').addEventListener('click', () => { const s = state.staff.find(x => x.id === editShift.id); fillShift(s.start2, s.end2); });
['click', 'input', 'change', 'focusout'].forEach(ev => shiftEl.addEventListener(ev, () => editShift && updateShiftInfo()));
$('#sCancel').addEventListener('click', closeShift);
shiftEl.addEventListener('click', e => { if (e.target === shiftEl) closeShift(); });
shiftEl.addEventListener('keydown', e => { if (e.key === 'Escape') closeShift(); });
$('#sDelete').addEventListener('click', () => {      // こちらで「休み」に指定する
  const { id, date } = editShift;
  (state.shifts[date] = state.shifts[date] || {})[id] = { off: true };
  save(); closeShift(); renderShift(); ui.toast('休みにしました');
});
$('#sUnset').addEventListener('click', () => {       // 指定を外して、未決定に戻す
  const { id, date } = editShift;
  if (state.shifts[date]) { delete state.shifts[date][id]; if (!hasShifts(date)) delete state.shifts[date]; }
  save(); closeShift(); renderShift(); ui.toast('未設定に戻しました');
});
$('#sSave').addEventListener('click', () => {
  const a = getT('sStart'), b = getT('sEnd'), brk = +$('#sBreak').value;
  if (a === null || b === null) return ui.toast('時刻の形式が正しくありません。9:00 や 0900 のように入力してください', 'err');
  if (!a || !b) return ui.toast('出勤と退勤の時間を入れてください', 'err');
  if (tmin(b) <= tmin(a)) return ui.toast('退勤は出勤より後にしてください', 'err');
  if (brk >= tmin(b) - tmin(a)) return ui.toast('休憩が勤務時間より長くなっています', 'err');
  const { id, date } = editShift, pref = adminPref(id, date, pkOf(date));
  (state.shifts[date] = state.shifts[date] || {})[id] = { start: a, end: b, brk };
  save(); closeShift(); renderShift();
  const cf = conflictOf({ start: a, end: b }, pref), note = cf === 'req' ? '（希望休の日です）' : cf === 'out' ? '（希望の時間外です）' : '';
  ui.toast('シフトを保存しました' + note, note ? 'warn' : '');
});

/* ========== 従業員画面（仮：従業員を選んで操作） ========== */
let empId = null, brush = 'off', eTab = 'req';

function renderEmployee() {
  const sel = $('#eWho');
  sel.innerHTML = state.staff.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  if (!state.staff.some(s => s.id === empId)) empId = state.staff[0] ? state.staff[0].id : null;
  sel.value = empId || '';
  $('#eNone').hidden = !!empId; $('#eBody').hidden = !empId;
  document.querySelectorAll('.etab').forEach(b => b.classList.toggle('active', b.dataset.etab === eTab));
  if (!empId) return;
  $('#eReq').hidden = eTab !== 'req'; $('#eRules').hidden = eTab !== 'rules';
  renderBrush(); renderEmpCal(); renderEmpRules();
}
function renderBrush() {
  document.querySelectorAll('.brush').forEach(b => b.classList.toggle('active', b.dataset.brush === brush));
  $('#eTimeBox').hidden = brush !== 'time';
}
function renderEmpStatus() {
  const pk = ymd(eP.start), P = pf(empId), sub = P.submissions[pk], comment = P.comments[pk] || '', el = $('#eSubStatus');
  const dirty = sub && (JSON.stringify(sub.snap) !== JSON.stringify(snapshotFor(empId, pKeys(eP))) || (sub.comment || '') !== comment.trim());
  el.textContent = !sub ? (isClosed(pk) ? '未提出（締切を過ぎました）' : '未提出') : dirty ? '提出後に変更があります。再提出してください' : `提出済み（${fmtAt(sub.at)}）`;
  el.className = 'substatus ' + (!sub ? '' : dirty ? 'warn' : 'ok');
  $('#eSubmit').textContent = sub ? '再提出する' : '提出する';
}
function renderEmpCal() {
  const p = eP, keys = pKeys(p), pk = ymd(p.start), pub = !!state.published[pk];
  $('#eLabel').textContent = pLabel(p) + (pub ? '　確定済み' : '');
  let html = DOW_MON.map(d => `<div class="dow">${d}</div>`).join('') + '<div class="cday blank"></div>'.repeat((p.start.getDay() + 6) % 7);
  keys.forEach((k, i) => {
    const d = parseYmd(k), e = effPref(empId, k), sh = pub ? dayShifts(k)[empId] : null, wd = d.getDay();
    const cls = e.status, label = e.status === 'off' ? '希望休' : e.status === 'time' ? `${hm(e.start)}–${hm(e.end)}` : '出勤可';
    html += `<button type="button" class="cday ${cls}${wd === 0 ? ' sun' : wd === 6 ? ' sat' : ''}" data-k="${k}"><span class="dn">${d.getDate()}${(i === 0 || d.getDate() === 1) ? `<i>${d.getMonth() + 1}月</i>` : ''}</span>` +
      `<span class="st">${label}</span>${e.src === 'rule' && e.status !== 'ok' ? '<em class="src">毎週</em>' : ''}` +
      (sh ? `<span class="conf">確定 ${sh.off ? '休み' : hm(sh.start) + '–' + hm(sh.end)}</span>` : '') + '</button>';
  });
  $('#eCal').innerHTML = html;
  const closed = isClosed(pk), lock = pub || closed, dl = deadlineOf(pk), left = dl ? Math.round((parseYmd(dl) - parseYmd(todayKey())) / 864e5) : 99;
  $('#eDeadline').textContent = pub ? 'この期間のシフトは確定しました。' : closed ? deadlineText(pk) + '。希望の提出・変更はできません。変更したいときは管理者に連絡してください。' : dl ? deadlineText(pk) + 'までに提出してください。' : '';
  $('#eDeadline').className = 'dlbanner' + (closed ? ' closed' : left <= 3 ? ' near' : '');
  $('#eSubmit').disabled = lock; $('#eComment').disabled = lock;
  if (document.activeElement !== $('#eComment')) $('#eComment').value = pf(empId).comments[pk] || '';
  renderEmpStatus();
}
$('#eWho').addEventListener('change', () => { empId = $('#eWho').value; renderEmployee(); });
document.querySelectorAll('.etab').forEach(b => b.addEventListener('click', () => { eTab = b.dataset.etab; renderEmployee(); }));
document.querySelectorAll('.brush').forEach(b => b.addEventListener('click', () => { brush = b.dataset.brush; renderBrush(); }));
$('#ePrev').addEventListener('click', () => { eP = periodOf(addDays(eP.start, -1)); renderEmpCal(); });
$('#eNext').addEventListener('click', () => { eP = periodOf(eP.end); renderEmpCal(); });
$('#eToday').addEventListener('click', () => { eP = periodOf(new Date()); renderEmpCal(); });

/* 日付をタップ → 選んだ内容を指定（同じ内容をもう一度タップで解除） */
$('#eCal').addEventListener('click', e => {
  const b = e.target.closest('.cday[data-k]'); if (!b) return;
  if (state.published[ymd(eP.start)]) return ui.toast('この期間のシフトは確定済みです。変更したいときは管理者に連絡してください', 'warn');
  if (isClosed(ymd(eP.start))) return ui.toast(`${deadlineText(ymd(eP.start))}。希望の変更はできません。管理者に連絡してください`, 'warn');
  const k = b.dataset.k, P = pf(empId), cur = P.dates[k];
  if (brush === 'reset') { if (!cur) return; delete P.dates[k]; }
  else {
    let nv;
    if (brush === 'time') {
      const a = getT('eFrom'), c = getT('eTo');
      if (a === null || c === null || !a || !c) return ui.toast('時間指定の開始と終了を入れてください', 'err');
      if (tmin(c) <= tmin(a)) return ui.toast('終了は開始より後にしてください', 'err');
      nv = { status: 'time', start: a, end: c };
    } else nv = { status: brush };
    if (cur && JSON.stringify(cur) === JSON.stringify(nv)) delete P.dates[k]; else P.dates[k] = nv;
  }
  save(); renderEmpCal();
});
$('#eComment').addEventListener('input', () => { pf(empId).comments[ymd(eP.start)] = $('#eComment').value; save(); renderEmpStatus(); });
$('#eSubmit').addEventListener('click', () => {
  const pk = ymd(eP.start);
  if (state.published[pk]) return ui.toast('この期間のシフトは確定済みのため、希望は提出できません', 'warn');
  if (isClosed(pk)) return ui.toast('提出締切を過ぎているため、提出できません。管理者に連絡してください', 'warn');
  const P = pf(empId), comment = $('#eComment').value.trim();
  P.submissions[pk] = { at: new Date().toISOString(), comment, snap: snapshotFor(empId, pKeys(eP)) };
  P.comments[pk] = comment; save(); renderEmpCal();
  ui.toast('希望シフトを管理者に提出しました');
});

/* 毎週のルール（従業員の設定） */
function renderEmpRules() {
  const P = pf(empId), opt = (list, cur) => list.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join('');
  $('#eRulesBody').innerHTML = P.rules.length ? P.rules.map((r, i) =>
    `<tr><td><select data-i="${i}" data-k="target">${opt(RULE_TARGETS, r.target)}</select></td>
      <td><select data-i="${i}" data-k="status">${opt(RULE_STATUS, r.status)}</select></td>
      <td>${r.status === 'time' ? `<div class="timebox"><div id="rtA${i}"></div><span>〜</span><div id="rtB${i}"></div></div>` : '—'}</td>
      <td><button type="button" class="btn small" data-rdel="${i}">削除</button></td></tr>`).join('')
    : '<tr><td colspan="4" class="meta">ルールはまだありません。「ルールを追加」から作れます。</td></tr>';
  P.rules.forEach((r, i) => { if (r.status === 'time') { timeField('rtA' + i); timeField('rtB' + i); setT('rtA' + i, r.start); setT('rtB' + i, r.end); } });
}
$('#eRulesBody').addEventListener('change', e => {
  const i = e.target.dataset.i, k = e.target.dataset.k; if (i == null) return;
  const P = pf(empId), r = P.rules[i];
  if (k === 'target') {
    if (P.rules.some((x, j) => j != i && x.target === e.target.value)) { ui.toast('その対象のルールはすでにあります', 'err'); renderEmpRules(); return; }
    r.target = e.target.value;
  } else {
    r.status = e.target.value;
    if (r.status === 'time') { r.start = r.start || '09:00'; r.end = r.end || '17:00'; }
  }
  save(); renderEmpRules(); renderEmpCal();
});
$('#eRulesBody').addEventListener('tchange', e => {
  const m = /^rt([AB])(\d+)$/.exec(e.target.id); if (!m) return;
  const r = pf(empId).rules[+m[2]], a = getT('rtA' + m[2]), b = getT('rtB' + m[2]);
  if (!a || !b || tmin(b) <= tmin(a)) { ui.toast('時刻は「開始 ＜ 終了」になるように入れてください', 'err'); renderEmpRules(); return; }
  if (r.start === a && r.end === b) return;
  r.start = a; r.end = b; save(); renderEmpCal();
});
$('#eRulesBody').addEventListener('click', e => {
  const i = e.target.dataset.rdel; if (i == null) return;
  pf(empId).rules.splice(i, 1); save(); renderEmpRules(); renderEmpCal(); ui.toast('ルールを削除しました');
});
$('#eRuleAdd').addEventListener('click', () => {
  const P = pf(empId), t = RULE_TARGETS.find(([v]) => !P.rules.some(r => r.target === v));
  if (!t) return ui.toast('すべての対象にルールがあります', 'warn');
  P.rules.push({ target: t[0], status: 'off' }); save(); renderEmpRules(); renderEmpCal();
});

/* ========== 設定：注意ライン・シフト表の期間 ========== */
function renderLimits() {
  $('#limDay').value = state.settings.limitDay; $('#limWeek').value = state.settings.limitWeek; $('#limStreak').value = state.settings.maxStreak;
}
['limDay', 'limWeek', 'limStreak'].forEach(id => $('#' + id).addEventListener('change', () => {
  const d = +$('#limDay').value, w = +$('#limWeek').value, n = Math.round(+$('#limStreak').value);
  if (!(d > 0) || !(w > 0) || !(n >= 1)) { ui.toast('0より大きい数を入れてください', 'err'); renderLimits(); return; }
  state.settings.limitDay = d; state.settings.limitWeek = w; state.settings.maxStreak = n; save(); renderLimits(); ui.toast('注意ラインを更新しました');
  if (curTab === 'shift') renderShift();
}));
function renderPeriodSettings() {
  const S = state.settings.period;
  $('#pDlDays').value = state.settings.deadlineDays;
  $('#pMode').value = S.mode; $('#pStart').value = S.startDay; $('#pWeeks').value = String(S.weeks); $('#pAnchor').value = S.anchor;
  $('#pMonthBox').hidden = S.mode !== 'month'; $('#pWeeksBox').hidden = S.mode !== 'weeks';
  $('#pNote').textContent = '今日を含む期間：' + pLabel(periodOf(new Date()));
}
['pMode', 'pStart', 'pWeeks', 'pAnchor'].forEach(id => $('#' + id).addEventListener('change', () => {
  const S = state.settings.period, sd = Math.round(+$('#pStart').value);
  if (!(sd >= 1 && sd <= 28)) { ui.toast('月の開始日は1〜28で入れてください', 'err'); renderPeriodSettings(); return; }
  if ($('#pMode').value === 'weeks' && !$('#pAnchor').value) { ui.toast('最初の期間の開始日を入れてください', 'err'); renderPeriodSettings(); return; }
  S.mode = $('#pMode').value; S.startDay = sd; S.weeks = +$('#pWeeks').value; if ($('#pAnchor').value) S.anchor = $('#pAnchor').value;
  aP = periodOf(new Date()); eP = periodOf(new Date()); save(); renderPeriodSettings(); ui.toast('シフト表の期間を変更しました');
}));

/* ========== 開発者モード（仮） ========== */
const RND_SUR = ['佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤', '吉田', '山田', '佐々木', '松本', '井上', '木村', '林', '清水', '山崎', '森'];
const RND_GIV = ['太郎', '花子', '健太', '美咲', '翔太', '愛', '大輝', '結衣', '陽菜', '蓮', '悠斗', '優奈', '拓海', '彩', '颯太', '莉子', '直樹', '真央', '亮', '菜々子'];
const RND_EN = ['Sarah Lee', 'Mike Chen', 'Emma Brown', 'Daniel Kim', 'Olivia Park', 'Noah Smith', 'Mia Tanaka', 'Liam Wong'];
const RND_COMMENTS = ['試験期間のため、1日お休みをいただけると助かります。', '早い時間帯なら多めに入れます。', '特にありません。よろしくお願いします。', '家族の予定があるので、週末は控えめでお願いします。', '', ''];
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = rnd(0, i); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
const hh = n => pad2(n) + ':00';

function randomStaff(n) {
  const used = new Set(state.staff.map(s => s.name)), roles = state.roles.map(r => r.name), open = state.open, close = state.close, out = [];
  for (let i = 0; i < n; i++) {
    const en = Math.random() < 0.12;
    let name, tries = 0;
    do { name = en ? pick(RND_EN) : pick(RND_SUR) + pick(RND_GIV); tries++; } while (used.has(name) && tries < 40);
    if (used.has(name)) name += rnd(2, 9);
    used.add(name);
    // 開始時刻を営業時間いっぱいにばらけさせる（朝〜夜の時間帯が埋まりやすくなる）
    const span = Math.max(0, close - open - 4), base = open + Math.round((n > 1 ? i / (n - 1) : Math.random()) * span);
    const start = n > 1 && i === 0 ? open : Math.min(Math.max(open, base + rnd(-1, 1)), Math.max(open, close - 4)), want = rnd(4, 8);
    const end = n > 1 && i === n - 1 ? close : Math.min(close, start + want + rnd(0, 2));   // 最初の人は開店から、最後の人は閉店まで
    const hasSub = Math.random() < 0.4 && end < close;
    out.push({
      id: 's' + Date.now() + '_r' + i, name,
      role: roles.length && Math.random() < 0.9 ? pick(roles) : '',
      rating: pick([1, 2, 2, 3, 3, 3, 3, 4, 4, 4, 5, 5]),
      hours: Math.min(want, end - start),
      wage: en ? rnd(12, 20) : rnd(20, 30) * 50, cur: en ? 'USD' : 'JPY',
      start: hh(start), end: hh(end),
      start2: hasSub ? hh(end) : '', end2: hasSub ? hh(Math.min(close, end + rnd(1, 3))) : ''
    });
  }
  return out;
}

function randomPrefs(p) {
  const keys = pKeys(p), pk = ymd(p.start), open = state.open, close = state.close;
  const window_ = () => { const a = rnd(open, Math.max(open, close - 4)); return { start: hh(a), end: hh(Math.min(close, a + rnd(3, 6))) }; };
  state.staff.forEach(s => {
    const P = pf(s.id);
    P.dates = {}; P.rules = [];
    if (Math.random() < 0.3) P.rules.push(Math.random() < 0.7 ? { target: pick(RULE_TARGETS.slice(2))[0], status: 'off' } : { target: 'holiday', status: 'time', ...window_() });
    const ks = shuffle(keys.slice()), offN = rnd(0, 4), timeN = rnd(0, 3);
    ks.slice(0, offN).forEach(k => P.dates[k] = { status: 'off' });
    ks.slice(offN, offN + timeN).forEach(k => P.dates[k] = { status: 'time', ...window_() });
    delete P.submissions[pk];
    if (Math.random() < 0.75) {
      const c = pick(RND_COMMENTS);
      P.comments[pk] = c;
      P.submissions[pk] = { at: new Date(Date.now() - rnd(1, 72) * 3600e3).toISOString(), comment: c, snap: snapshotFor(s.id, keys) };
    } else P.comments[pk] = '';   // 未提出のまま
  });
}

function renderDev() {
  $('#dLayout').value = state.settings.layout || 'auto';
  const kb = Math.round((localStorage.getItem(KEY) || '').length / 102.4) / 10;
  $('#dInfo').textContent = `スタッフ ${state.staff.length}人 ／ シフトのある日 ${Object.keys(state.shifts).length}日 ／ 保存データ 約${kb}KB`;
}
$('#dRandomStaff').addEventListener('click', async () => {
  const n = Math.round(+$('#dCount').value);
  if (!(n >= 1 && n <= 50)) return ui.toast('人数は1〜50で入れてください', 'err');
  const replace = $('#dMode').value === 'replace';
  if (replace && state.staff.length && !await ui.ask(`今のスタッフ${state.staff.length}人と、そのシフト・希望がすべて消えます。入れ替えますか？`, { ok: '入れ替える', danger: true })) return;
  if (replace) { state.staff = []; state.schedule = {}; state.shifts = {}; state.prefs = {}; state.published = {}; }
  state.staff.push(...randomStaff(n));
  save(); renderRoles(); renderGantt(); renderDev();
  ui.toast(`ランダムなスタッフを${n}人登録しました`);
});
$('#dRandomPrefs').addEventListener('click', async () => {
  if (!state.staff.length) return ui.toast('先にスタッフを登録してください', 'warn');
  const p = periodOf(new Date());
  if (!await ui.ask(`${pLabel(p)} の希望を、全員分ランダムに作り直します。今ある希望と提出は上書きされます。`, { ok: '作る' })) return;
  randomPrefs(p); save(); renderDev();
  ui.toast('希望シフトをランダムに作りました。管理者画面のシフト管理で確認できます');
});
$('#dLayout').addEventListener('change', () => { state.settings.layout = $('#dLayout').value; save(); applyLayout(); });
$('#dReset').addEventListener('click', async () => {
  if (!await ui.ask('このアプリが保存しているデータをすべて消して、最初の状態に戻します。元には戻せません。', { ok: 'すべて消す', danger: true })) return;
  localStorage.removeItem(KEY); location.reload();
});

$('#pDlDays').addEventListener('change', () => {
  const n = Math.round(+$('#pDlDays').value);
  if (!(n >= 0 && n <= 60)) { ui.toast('0〜60の数を入れてください', 'err'); renderPeriodSettings(); return; }
  state.settings.deadlineDays = n; save(); ui.toast(n ? `締切の初期値を、期間の開始日の${n}日前にしました` : '締切の初期値をなしにしました');
  if (curTab === 'shift') renderShift();
});

/* ---- 管理者／従業員／開発者の表示切替（仮） ---- */
function setMode(m) {
  document.body.dataset.mode = m;
  document.querySelectorAll('.mbtn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  if (m === 'employee' || m === 'dev') { document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === m)); if (m === 'employee') renderEmployee(); else renderDev(); }
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
setT('eFrom', '09:00'); setT('eTo', '17:00');
resetForm(); renderRoles(); renderConditions(); renderSettings(); renderLimits(); renderPeriodSettings(); renderTimeRange(); renderAutoRules(); renderSortBar(); renderGantt();
if (state.settings.auto) fetchRate(false);   // ページを開くたびに最新レートを取得