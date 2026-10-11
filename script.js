'use strict';

/* ========== 状態 ========== */
const KEY = 'shiftApp.v1';
const DEF_ROLES = [['レジ', '#0f6e6e'], ['接客', '#3b6fb6'], ['品出し', '#b45f06'], ['調理', '#a23b5a'], ['清掃', '#5b7a2f'], ['事務', '#6b5b95']]
  .map(([name, color]) => ({ name, color }));
/* 自動作成のルール（プリセット）。数値は 0=オフ 1=弱 2=標準 3=強 */
const PRESETS = {
  balance:   { label: 'バランス重視', desc: '人手不足を作らないことを最優先にします。希望休と、希望時間の外には入れません。希望した人を全員入れる必要はなく、最低人数と最高人数の間で、従業員間の勤務日数・時間をなるべく揃えながらバランスよく組みます。足りないときは、予備の時間や休みの日をゆるめて補います。迷ったらこれがおすすめです。', v: { rating: 2, contig: 2, wage: 1, fair: 3, fill: 'mid', target: 'cap', sub: 'fallback', fix: 'flex' } },
  headcount: { label: '人数重視', desc: '出勤できる時間の長さにこだわらず、各時間帯を最高人数に近づけます。繁忙期や人手不足の日向けです。', v: { rating: 1, contig: 1, wage: 0, fair: 1, fill: 'max', target: 'ignore', sub: 'always', fix: 'flex' } },
  cost:      { label: '人件費重視', desc: '最低人数だけを満たし、時給の安い従業員を優先します。予備の時間は使いません。', v: { rating: 1, contig: 2, wage: 3, fair: 0, fill: 'min', target: 'cap', sub: 'never', fix: 'off' } },
  quality:   { label: '評価重視', desc: '評価の高い従業員を優先して配置します。忙しい時間帯の品質を上げたいときに。', v: { rating: 3, contig: 2, wage: 0, fair: 0, fill: 'mid', target: 'fill', sub: 'fallback', fix: 'flex' } },
  fair:      { label: '公平重視', desc: '従業員間の勤務時間をなるべく揃えます。希望時間を超えては入れません。', v: { rating: 1, contig: 2, wage: 1, fair: 3, fill: 'mid', target: 'cap', sub: 'fallback', fix: 'off' } },
  wish:      { label: '希望優先', desc: '希望の曜日・時間を最優先し、予備の時間は使いません。', v: { rating: 1, contig: 2, wage: 0, fair: 1, fill: 'max', target: 'fill', sub: 'never', fix: 'off' } }
};
const $ = s => document.querySelector(s);

let state = load();
let me = null;   // ログイン中のユーザー
let formRating = 3, editingId = null;

function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* 破損時は初期化 */ }
  if (!s || !Array.isArray(s.staff)) s = { staff: [], open: 9, close: 22, rules: {}, schedule: {} };
  s.roles = s.roles || DEF_ROLES;
  s.autoRules = s.autoRules || { preset: 'balance', ...PRESETS.balance.v };
  s.shifts = s.shifts || {};        // { 日付: { 従業員ID: { start, end, brk(休憩分) } } }
  s.published = s.published || {};  // { 週の月曜日の日付: true }（確定済みの週）
  s.roleRules = s.roleRules || {};   // { 役割名: { min, max(null=上限なし) } }
  s.auth = s.auth || { users: [], lock: {}, recovery: null };   // ログインのアカウント（パスワードは塩つきハッシュ）
  if (s.autoRules && s.autoRules.fix === 'all') s.autoRules.fix = 'flex';   // 「時間指定までゆるめる」は廃止（希望時間の外には入れない）
  s.deadlines = s.deadlines || {};  // { 期間の開始日: 提出締切の日付 }
  s.closed = s.closed || {};        // { 期間の開始日: true }（管理者が手動で受付を締め切った期間）
  s.work = s.work || {};            // 作業表 { 日付: { 従業員ID: [時間, ...] } }
  s.shiftRules = s.shiftRules || []; // 日ごとの人数ルール [{ day, month, date, min, max }]
  if (s.schedule && Object.values(s.schedule).some(a => a && a.length) && !Object.keys(s.work).length) {   // 日付のなかった旧データは、今日の分に引き継ぐ
    const n = new Date(); s.work[`${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`] = s.schedule;
  }
  s.workMode = s.workMode || {};    // 作業表の作り方 { 日付: 'rules'（人数ルールで自動作成）| 'manual'（手動で調整） }。ないときは「シフト通り」
  Object.keys(s.work).forEach(d => { if (!s.workMode[d]) s.workMode[d] = 'manual'; });   // 以前に手で作った作業表は、手動として残す
  s.schedule = {};
  s.settings = s.settings || { display: 'JPY', rate: 150 };
  if (s.settings.auto === undefined) s.settings.auto = true;
  if (!s.settings.sort) s.settings.sort = { key: 'manual', desc: false };
  if (s.settings.limitDay === undefined) { s.settings.limitDay = 8; s.settings.limitWeek = 40; }
  if (s.settings.maxStreak === undefined) s.settings.maxStreak = 6;
  if (!s.settings.minWage) { s.settings.minWage = 1231; s.settings.minWageArea = '大阪府'; }
  if (!s.settings.night) s.settings.night = { start: 22, end: 5, pct: 25, plus: 0 };   // 深夜の割増（時間帯・％・加算の円は、管理者が変えられる）
  s.requests = s.requests || [];   // 出勤できる曜日・時間の変更申請 [{ id, staffId, at, avail, dpw, note, status, reply }]
  if (!s.settings.auto2) s.settings.auto2 = { restMax: 2, interval: 9, dpw: { min: 3, max: 5 }, leadMin: 1, secs: 2, flex: true };   // 自動作成の条件
  s.patterns = s.patterns || [];   // シフトの型 [{ id, name, start, end, days }]   // 最低賃金：大阪府（令和8年10月1日〜）。設定で変えられる
  if (s.settings.sort && s.settings.sort.key === 'shortage') s.settings.sort = { key: 'manual', desc: false };
  s.staff.forEach(x => {
    if (!x.avail) {
      x.avail = [];
      if (x.start && x.end) x.avail.push({ days: [0, 1, 2, 3, 4, 5, 6], start: x.start, end: x.end, kind: 'main' });
      if (x.start2 && x.end2) x.avail.push({ days: [0, 1, 2, 3, 4, 5, 6], start: x.start2, end: x.end2, kind: 'sub' });
    }
    delete x.start; delete x.end; delete x.start2; delete x.end2; delete x.hours;
  });
  if (s.settings.deadlineDays === undefined) s.settings.deadlineDays = 0;   // 締切の初期値（期間の開始日の何日前。0=設定しない）
  if (!s.settings.layout) s.settings.layout = 'auto';
  if (!s.settings.shiftSort) s.settings.shiftSort = { key: 'role', desc: false };   // シフト管理の並び順（はじめは階級順）
  s.prefs = s.prefs || {};          // 従業員の希望 { 従業員ID: { dates, rules, comments, submissions } }
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
/* 出勤できる曜日と時間：s.avail = [{ days:[曜日0〜6], start, end, kind:'main'（希望）|'sub'（予備） }, ...]。日付を渡すと、その曜日の分だけ */
const slotDays = x => x.days || [0, 1, 2, 3, 4, 5, 6];
const slotHours = x => span(x.start, x.end);
const availOn = (s, k) => (s.avail || []).filter(x => k == null || slotDays(x).includes(parseYmd(k).getDay()));
const mainHours = (s, k) => [...new Set(availOn(s, k).filter(x => x.kind !== 'sub').flatMap(slotHours))].sort((a, b) => a - b);
const subHours = (s, k) => { const m = new Set(mainHours(s, k)); return [...new Set(availOn(s, k).filter(x => x.kind === 'sub').flatMap(slotHours))].filter(h => !m.has(h)).sort((a, b) => a - b); };

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
const effWage = s => s.wage > 0 ? s.wage : state.settings.minWage;   // 時給は管理者が決める。空欄（0）の人は最低賃金
const hourly = s => toDisp(effWage(s), s.wage > 0 ? (s.cur || 'JPY') : 'JPY');
/* 深夜の割増：時間帯（開始〜終了）・割増率（％）・時給に足す金額（円）は、管理者が決める */
const nightPay = h => { const N = state.settings.night, x = h % 24; return N.start > N.end ? (x >= N.start || x < N.end) : (x >= N.start && x < N.end); };
const nightLegal = h => { const x = h % 24; return x >= 22 || x < 5; };   // 法定の深夜（22:00〜翌5:00）：18歳未満は原則働けない
const overlapMin = (sh, pred) => { let m = 0; const a = tmin(sh.start), b = tmin(sh.end); for (let h = Math.floor(a / 60); h < Math.ceil(b / 60); h++) if (pred(h)) m += Math.min(b, (h + 1) * 60) - Math.max(a, h * 60); return m; };
const nightMin = sh => overlapMin(sh, nightPay);
function shiftCost(s, sh) {   // 時給 × 実働 ＋ 深夜の割増
  if (!isWork(sh)) return 0;
  const N = state.settings.night, base = hourly(s), prem = base * (N.pct || 0) / 100 + toDisp(N.plus || 0, 'JPY');
  return base * shiftHours(sh) + prem * nightMin(sh) / 60;
}
const ageOn = (s, k) => { if (!s.birth) return null; const b = parseYmd(s.birth), d = parseYmd(k); let a = d.getFullYear() - b.getFullYear(); if (d.getMonth() < b.getMonth() || (d.getMonth() === b.getMonth() && d.getDate() < b.getDate())) a--; return a; };
const isMinor = (s, k) => { const a = ageOn(s, k); return a !== null && a < 18; };
const employedOn = (s, k) => (!s.join || k >= s.join) && (!s.leave || k <= s.leave);   // 入社日〜退職日
const monthIncome = (s, k) => { const ym = k.slice(0, 7); let t = 0; Object.keys(state.shifts).forEach(d => { if (d.slice(0, 7) === ym) t += shiftCost(s, state.shifts[d][s.id]); }); return t; };

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
['sStart', 'sEnd', 'eFrom', 'eTo'].forEach(timeField);

/* ========== タブ ========== */
let curTab = 'home';
function switchTab(name) {
  curTab = name;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === name));
  if (name === 'home') renderGantt();
  if (name === 'shift') renderShift();
  if (name === 'setup') renderStaffList();
  if (name === 'settings') { renderSetCat(); renderShiftRules(); renderAccounts(); renderMinWage(); renderNight(); renderAuto2(); renderPatterns(); }
}
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

/* ========== ホームの並び替え ========== */
const SORTS = {
  manual:   { label: '登録順', desc: false },
  role:     { label: '役割別（役割管理の並び順）', desc: false },
  start:    { label: '出勤時間順', desc: false },
  rating:   { label: '評価', desc: true },
  hours:    { label: '勤務時間の長さ', desc: true },
  wage:     { label: '時給', desc: true },
  name:     { label: '名前（あいうえお）', desc: false }
};
const mineOf = s => workOf(HW())[s.id] || [];
const SORT_VAL = {
  role: s => { const k = state.roles.findIndex(r => r.name === s.role); return k < 0 ? 999 : k; },      // 役割なしは最後
  start: s => { const m = mineOf(s); return m.length ? Math.min(...m) : 100 + (mainHours(s)[0] ?? 99); }, // 勤務なしは最後
  rating: s => s.rating,
  hours: s => mineOf(s).length,
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

/* ========== ホーム：シフト表（上）と作業表（下） ========== */
const NAME_W = 230, COL_W = 72;   // 表の列幅（すべての時間マスを同じ大きさに）
const HOME_BACK = 7, HOME_FWD = 14;   // 見られるのは、過去1週間〜先2週間
const dim = () => layout === 'mobile' ? { n: 104, c: 52 } : { n: NAME_W, c: COL_W };
let viewOrder = null; // マスの編集中に行が動かないよう、並び順は並び替え・再作成などの時だけ更新する
let _hs = null, _hw = null;   // 上（シフト表）・下（作業表）で表示中の日
const HS = () => _hs || (_hs = todayKey()), HW = () => _hw || (_hw = todayKey());
const homeRange = () => [ymd(addDays(new Date(), -HOME_BACK)), ymd(addDays(new Date(), HOME_FWD))];
const clampHome = k => { const [lo, hi] = homeRange(); return k < lo ? lo : k > hi ? hi : k; };
const dayLabel = k => { const d = parseYmd(k); return `${d.getMonth() + 1}/${d.getDate()}（${DOW[d.getDay()]}）` + (k === todayKey() ? '・今日' : ''); };

/* 作業表は、その日のシフトから自動で作られる（シフトを変えると、作業表も変わる）。
   働く時間は、シフトの出勤〜退勤のまま「つながった時間」。法定の休憩は、シフトの真ん中あたりに「休憩」として入れる */
const shiftHourList = sh => { const a = Math.floor(tmin(sh.start) / 60), b = Math.ceil(tmin(sh.end) / 60), r = []; for (let h = a; h < b; h++) r.push(h); return r; };
const breakHourList = (sh, idx) => {   // 休憩のマス（最初と最後の時間はさけ、人ごとに1時間ずつずらす）
  const hrs = shiftHourList(sh), n = Math.ceil((sh.brk || 0) / 60);
  if (!n || hrs.length < n + 2) return [];
  const at = Math.min(hrs.length - n - 1, Math.max(1, Math.floor((hrs.length - n) / 2) + [0, 1, -1][idx % 3]));
  return hrs.slice(at, at + n);
};
const normW = v => Array.isArray(v) ? { w: v.slice(), b: [] } : { w: [...((v && v.w) || [])], b: [...((v && v.b) || [])] };
/* シフトから作る。optimize=true のときは、時間帯ごとの最低人数がなるべく保てるように、休憩の位置を調整する */
function deriveDay(date, optimize) {
  const order = state.staff.filter(s => isWork(dayShifts(date)[s.id])), work = {}, brk = {}, H = hoursList(), cover = {};
  H.forEach(h => { cover[h] = 0; });
  order.forEach(s => shiftHourList(dayShifts(date)[s.id]).forEach(h => { if (cover[h] !== undefined) cover[h]++; }));
  order.map((s, i) => ({ s, i })).sort((a, b) => shiftHourList(dayShifts(date)[b.s.id]).length - shiftHourList(dayShifts(date)[a.s.id]).length || a.i - b.i).forEach(({ s, i }) => {
    const sh = dayShifts(date)[s.id], hrs = shiftHourList(sh), n = Math.ceil((sh.brk || 0) / 60);
    let br = [];
    if (n && hrs.length >= n + 2) {
      if (!optimize) br = breakHourList(sh, i);
      else {
        let bestAt = 1, bestScore = -Infinity; const mid = (hrs.length - n) / 2;
        for (let at = 1; at <= hrs.length - n - 1; at++) {
          const slack = Math.min(...hrs.slice(at, at + n).map(h => cover[h] === undefined ? 99 : cover[h] - 1 - rule(h).min));
          const sc = slack * 10 - Math.abs(at - mid);   // 人が多い時間に休憩を置く。同じなら、真ん中に近いほう
          if (sc > bestScore) { bestScore = sc; bestAt = at; }
        }
        br = hrs.slice(bestAt, bestAt + n);
      }
      br.forEach(h => { if (cover[h] !== undefined) cover[h]--; });
    }
    brk[s.id] = br; work[s.id] = hrs.filter(h => !br.includes(h));
  });
  return { work, brk, order };
}
function workDay(date) {   // { work: {ID: [働く時間]}, brk: {ID: [休憩の時間]}, mode }
  const mode = state.workMode[date] || 'shift';
  if (mode === 'manual') {
    const M = state.work[date] || {}, work = {}, brk = {};
    Object.keys(M).forEach(id => { const x = normW(M[id]); work[id] = x.w; brk[id] = x.b; });
    return { work, brk, mode };
  }
  const d = deriveDay(date, mode === 'rules');
  return { work: d.work, brk: d.brk, mode };
}
const workOf = date => workDay(date).work;
function materialize(date) {   // 連動している表を、手動で直せる形にする
  const { work, brk } = workDay(date), M = {};
  Object.keys(work).forEach(id => { M[id] = { w: work[id].slice(), b: (brk[id] || []).slice() }; });
  state.work[date] = M; state.workMode[date] = 'manual';
}

let _hsP = null;   // ホームのシフト表で表示中の期間（はじめは今日を含む期間＝1か月分）
const HSP = () => _hsP || (_hsP = periodOf(new Date()));
function renderHomeShift() {
  const p = HSP(), keys = pKeys(p), pk = ymd(p.start), wrap = $('#hShift'), note = $('#hsNote');
  const rec = keys.some(hasShifts), pub = !!state.published[pk], stat = keys.map(k => dayStat(k)), lack = rec ? keys.filter((k, i) => stat[i].lack) : [];
  $('#hsLabel').textContent = pLabel(p); $('#hsLabel').className = lack.length ? 'lack' : '';
  $('#hsStatus').textContent = !rec ? '未作成' : pub ? '確定済み' : '下書き'; $('#hsStatus').className = 'pill' + (rec && pub ? ' ok' : '');
  note.innerHTML = '';
  if (!state.staff.length) { wrap.innerHTML = '<div class="empty">従業員がまだいません。「従業員」タブから登録してください。</div>'; return; }
  if (!rec) { wrap.innerHTML = '<div class="empty">この期間のシフトは、まだ作成されていません。「シフト管理で開く」から作成できます。</div>'; return; }
  renderShiftDesktop(keys, pk, wrap, true);   // シフト管理と同じ表（見るだけ）
  let tot = 0; state.staff.forEach(s => keys.forEach(k => { tot += shiftHours(dayShifts(k)[s.id]); }));
  note.innerHTML = `<span class="pill">合計 ${fh(tot)}時間</span>` + (lack.length ? `<span class="lackmsg">⚠ 人数が足りない日が${lack.length}日あります：${lack.slice(0, 8).map(mdText).join('、')}${lack.length > 8 ? `…ほか${lack.length - 8}日` : ''}</span>` : '<span>人数が足りない日はありません</span>');
}

function renderWork(keep) {
  const H = hoursList(), wrap = $('#gantt'), k = HW(), pk = pkOf(k), [lo, hi] = homeRange(), D = dim(), shiftOn = hasWork(k);
  const { work, brk, mode } = workDay(k), manual = mode === 'manual';
  $('#legend').innerHTML = state.roles.map(r => `<span><i style="background:${r.color}"></i>${esc(r.name)}</span>`).join('') +
    '<span><i style="background:#5f6b76"></i>役割なし</span><span><i style="background:#dfe6ec;border:1px solid #bcc8d2"></i>休憩（法定）</span>' + (manual ? '<span><i style="background:#f3faf9;border:1px solid #ccc"></i>出勤できる時間</span>' : '');
  $('#hwLabel').textContent = dayLabel(k); $('#hwPrev').disabled = k <= lo; $('#hwNext').disabled = k >= hi;
  const drift = manual && shiftOn && (() => { const dw = deriveDay(k).work, ids = new Set([...Object.keys(dw), ...Object.keys(work).filter(i => (work[i] || []).length)]);
    return [...ids].some(i => JSON.stringify([...(dw[i] || [])].sort((a, b) => a - b)) !== JSON.stringify([...(work[i] || []), ...(brk[i] || [])].sort((a, b) => a - b))); })();   // シフトと違う部分があるか
  $('#hwMode').textContent = manual ? (drift ? '手動で調整中（シフトと違う部分あり）' : '手動で調整中') : mode === 'rules' ? '人数ルールで自動作成（シフトと連動）' : 'シフトと連動中';
  $('#hwMode').className = 'pill' + (manual ? ' warn' : ' ok');
  $('#hwNote').textContent = manual
    ? 'マスをクリックすると「働く → 休憩 → なし」の順に切り替わります。「シフト通りに作る」で、シフトの時間どおりに戻せます。'
    : 'この日のシフトに合わせて自動で作られています（シフトを変えると、この表も変わります）。マスをクリックすると、手動の調整に切り替わります。6時間を超える勤務には、法律で決まっている休憩を「休憩」として入れています。';
  $('#btnFromShift').disabled = !shiftOn; $('#btnAutoHome').disabled = !shiftOn;
  if (!state.staff.length || (!shiftOn && !manual)) {
    wrap.innerHTML = `<div class="empty">${state.staff.length ? 'この日のシフトがまだありません。シフトを作ると、この表が自動で作られます。手動で作るときは「空にする」を押してください。' : '従業員がまだいません。「従業員」タブから登録してください。'}</div>`;
    $('#total').textContent = ''; return;
  }
  const rank = new Map(sortedStaff().map((s, i) => [s.id, i]));
  const rows = state.staff.filter(s => shiftOn ? (isWork(dayShifts(k)[s.id]) || (work[s.id] || []).length || (brk[s.id] || []).length) : true).sort((a, b) => rank.get(a.id) - rank.get(b.id));
  let total = 0;
  let html = '<table class="gantt" style="width:' + (D.n + H.length * D.c) + 'px"><colgroup><col style="width:' + D.n + 'px">' + H.map(() => `<col style="width:${D.c}px">`).join('') + '</colgroup><thead><tr><th class="name">従業員</th>' + H.map(h => `<th>${fmt(h)}</th>`).join('') + '</tr></thead><tbody>';
  rows.forEach(s => {
    const sh = dayShifts(k)[s.id], isW = isWork(sh), color = roleColor(s.role), off = adminPref(s.id, k, pk).status === 'off';
    const w = work[s.id] || [], b = brk[s.id] || [], cells = w.length + b.length;
    const win = isW ? shiftHourList(sh) : (shiftOn ? [] : mainHours(s, k)), sub = (!isW && !shiftOn) ? subHours(s, k) : [];
    const hrs = manual ? w.length : (isW ? shiftHours(sh) : 0), cost = (isW && !manual) ? shiftCost(s, sh) : hourly(s) * hrs; total += cost;
    const needBrk = manual && cells > 6 && b.length * 60 < legalBreak(cells);   // 法定の休憩が足りない
    html += `<tr><th class="name"><b>${esc(s.name)}</b><div class="meta">${esc(s.role || '役割なし')} ／ <span class="stars">${stars(s.rating)}</span></div>
      <div class="meta${off || needBrk ? ' warnText' : ''}">${isW ? hm(sh.start) + '–' + hm(sh.end) + '・' : ''}${fh(hrs)}時間${isW && sh.brk ? '・休憩' + sh.brk + '分' : ''}・${money(cost)}${off ? '・希望休' : ''}${needBrk ? '・⚠休憩が足りません' : ''}</div></th>`;
    H.forEach(h => {
      const on = w.includes(h), br = b.includes(h);
      const cls = on || br ? (br ? 'brk' : 'on') : win.includes(h) ? 'ok' : sub.includes(h) ? 'sub' : 'off';
      html += `<td class="cell ${cls}${manual ? '' : ' view'}" data-id="${s.id}" data-h="${h}"${on ? ` style="background:${color}"` : ''}>${on ? '●' : br ? '休憩' : ''}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody><tfoot><tr><th class="name">配置人数<small>最低〜最高（休憩中は除く）</small></th>';
  H.forEach(h => { const c = rows.filter(s => (work[s.id] || []).includes(h)).length, r = rule(h); html += `<td class="${c < r.min ? 'low' : c > r.max ? 'high' : ''}">${c}<small>${r.min}〜${r.max}</small></td>`; });
  html += '</tr>';
  state.roles.forEach(ro => {
    const q = state.roleRules[ro.name];
    if (!q || (!q.min && q.max == null)) return;
    html += `<tr><th class="name"><span style="color:${ro.color}">●</span> ${esc(ro.name)}の人数<small>${q.min}〜${q.max == null ? '制限なし' : q.max}</small></th>`;
    H.forEach(h => { const c = rows.filter(s => s.role === ro.name && (work[s.id] || []).includes(h)).length; html += `<td class="${c < q.min ? 'low' : q.max != null && c > q.max ? 'high' : ''}">${c}</td>`; });
    html += '</tr>';
  });
  wrap.innerHTML = html + '</tfoot></table>';
  $('#total').textContent = total > 0 ? '人件費の合計　' + money(total) : '';
}
function renderGantt(keep) { renderHomeShift(); renderWork(keep); }

/* 日付の移動（上下それぞれ） */
const stepHome = (which, n) => { const nk = clampHome(ymd(addDays(parseYmd(which === 's' ? HS() : HW()), n))); if (which === 's') _hs = nk; else _hw = nk; renderGantt(true); };
$('#hsPrev').addEventListener('click', () => { _hsP = periodOf(addDays(HSP().start, -1)); renderGantt(true); });
$('#hsNext').addEventListener('click', () => { _hsP = periodOf(HSP().end); renderGantt(true); });
$('#hsToday').addEventListener('click', () => { _hsP = periodOf(new Date()); renderGantt(true); });
$('#hwPrev').addEventListener('click', () => { stepHome('w', -1); }); $('#hwNext').addEventListener('click', () => { stepHome('w', 1); });
$('#hwToday').addEventListener('click', () => { _hw = todayKey(); renderGantt(); });
$('#hsEdit').addEventListener('click', () => { aP = HSP(); mDay = null; switchTab('shift'); });

/* マスのクリック：働く → 休憩 → なし。連動中の表は、クリックすると手動の調整に切り替わる */
$('#gantt').addEventListener('click', async e => {
  const td = e.target.closest('.cell[data-id]'); if (!td) return;
  const k = HW(), id = td.dataset.id, h = +td.dataset.h;
  if (!td.classList.contains('on') && !td.classList.contains('brk') && td.classList.contains('off') &&
      !await ui.ask('出勤できる時間の外のマスです。\nこの時間に勤務を入れますか？', { ok: '入れる' })) return;
  if ((state.workMode[k] || 'shift') !== 'manual') { materialize(k); ui.toast('手動の調整に切り替えました。「シフト通りに作る」で、シフトの時間どおりに戻せます', 'warn'); }
  const M = state.work[k] || (state.work[k] = {}), x = normW(M[id]);
  if (x.w.includes(h)) { x.w.splice(x.w.indexOf(h), 1); x.b.push(h); }        // 働く → 休憩
  else if (x.b.includes(h)) x.b.splice(x.b.indexOf(h), 1);                   // 休憩 → なし
  else x.w.push(h);                                                          // なし → 働く
  M[id] = x; save(); renderGantt(true);
});
$('#btnFromShift').addEventListener('click', async () => {
  const k = HW();
  if (!hasWork(k)) return ui.toast('この日のシフトがまだありません。先にシフト管理で作成してください', 'warn');
  if ((state.workMode[k] || 'shift') === 'manual' && !await ui.ask(`${mdText(k)} の手動の調整を消して、シフトの時間どおりに作り直します。`, { ok: '作り直す' })) return;
  delete state.workMode[k]; delete state.work[k]; save(); renderGantt(); ui.toast('シフトの時間どおりに作業表を作りました（休憩は「休憩」と表示）');
});
$('#btnAutoHome').addEventListener('click', async () => {
  const k = HW();
  if (!hasWork(k)) return ui.toast('この日のシフトがまだありません。先にシフト管理で作成してください', 'warn');
  if ((state.workMode[k] || 'shift') === 'manual' && !await ui.ask(`${mdText(k)} の手動の調整を消して、人数ルールで自動作成します。`, { ok: '自動作成する' })) return;
  state.workMode[k] = 'rules'; delete state.work[k]; save(); renderGantt();
  const { work } = workDay(k), low = hoursList().filter(h => Object.values(work).filter(a => a.includes(h)).length < rule(h).min);
  if (low.length) ui.toast(`シフトの時間どおりに作りました。${low.map(fmt).join('、')} は最低人数に届いていません（シフトの人数が足りません）`, 'warn');
  else ui.toast('シフトの時間どおりに作り、休憩を最低人数が保てる位置に置きました');
});
$('#btnClear').addEventListener('click', async () => {
  const k = HW();
  if (!await ui.ask(`${mdText(k)} の作業表を空にして、手動で作れる状態にします。`, { ok: '空にする', danger: true })) return;
  state.workMode[k] = 'manual'; state.work[k] = {}; save(); renderGantt(); ui.toast('作業表を空にしました。マスをクリックして作ってください');
});
$('#hwOpen').addEventListener('click', () => { aP = periodOf(parseYmd(HW())); mDay = HW(); switchTab('shift'); });

/* ========== 従業員の登録（一覧・追加・編集） ========== */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];   // 月〜日
const daysText = ds => { const set = new Set(ds), n = set.size; return n === 7 ? '毎日' : (n === 5 && [1, 2, 3, 4, 5].every(d => set.has(d))) ? '平日' : (n === 2 && set.has(6) && set.has(0)) ? '週末' : DAY_ORDER.filter(d => set.has(d)).map(d => DOW[d]).join(''); };
const availText = s => (s.avail || []).length ? s.avail.map(x => `${daysText(slotDays(x))} ${hm(x.start)}–${hm(x.end)}${x.kind === 'sub' ? '（予備）' : ''}`).join('／') : '未設定';
const wageText = s => s.wage > 0 ? (s.cur === 'USD' ? '$' + s.wage : s.wage.toLocaleString() + '円') : `最低賃金（${state.settings.minWage.toLocaleString()}円）`;
const belowMin = s => s.wage > 0 && (s.cur || 'JPY') === 'JPY' && s.wage < state.settings.minWage;

/* 出勤できる曜日と時間の入力欄（従業員の登録と、変更申請の両方で使う）。曜日をえらび、時間を入れ、「＋ 追加」で時間帯をいくつでも増やせる */
function SlotEditor(rootSel, prefix, addSel) {
  const root = $(rootSel), ed = { draft: [] }, re = new RegExp('^' + prefix + '([SE])(\\d+)$');
  ed.render = () => {
    root.innerHTML = ed.draft.length ? ed.draft.map((x, i) => `<div class="slot">
      <div class="sl-days">${DAY_ORDER.map(d => `<button type="button" class="dchip${d === 6 ? ' sat' : d === 0 ? ' sun' : ''}${x.days.includes(d) ? ' on' : ''}" data-i="${i}" data-d="${d}" aria-pressed="${x.days.includes(d)}">${DOW[d]}</button>`).join('')}
        <span class="sl-quick"><button type="button" class="btn small" data-i="${i}" data-q="all">毎日</button><button type="button" class="btn small" data-i="${i}" data-q="weekday">平日</button><button type="button" class="btn small" data-i="${i}" data-q="weekend">週末</button></span></div>
      <div class="sl-time"><div id="${prefix}S${i}"></div><span>〜</span><div id="${prefix}E${i}"></div>
        <select data-i="${i}" data-k="kind"><option value="main"${x.kind !== 'sub' ? ' selected' : ''}>希望</option><option value="sub"${x.kind === 'sub' ? ' selected' : ''}>予備</option></select>
        <button type="button" class="btn small" data-i="${i}" data-sdel="1">削除</button></div></div>`).join('')
      : '<p class="meta">時間帯がまだありません。「＋ 追加」から入れてください。</p>';
    ed.draft.forEach((x, i) => { timeField(prefix + 'S' + i); timeField(prefix + 'E' + i); setT(prefix + 'S' + i, x.start); setT(prefix + 'E' + i, x.end); });
  };
  ed.read = () => ed.draft.forEach((x, i) => { x.start = getT(prefix + 'S' + i); x.end = getT(prefix + 'E' + i); });   // いま入力中の時刻も読み取る
  ed.check = () => {   // 問題があればエラー文、なければ null
    ed.read();
    if (!ed.draft.length) return '出勤できる曜日と時間を、1つ以上入れてください';
    for (const x of ed.draft) {
      if (x.start === null || x.end === null) return '時刻の形式が正しくありません。9:00 や 0900 のように入力してください';
      if (!x.days.length) return '曜日を1つ以上えらんでください';
      if (!x.start || !x.end) return '出勤と退勤の時間を入れてください';
      if (toH(x.end, true) <= toH(x.start)) return '退勤は出勤より後にしてください';
    }
    return null;
  };
  ed.value = () => ed.draft.map(x => ({ days: DAY_ORDER.filter(v => x.days.includes(v)), start: x.start, end: x.end, kind: x.kind === 'sub' ? 'sub' : 'main' }));
  ed.set = list => { ed.draft = JSON.parse(JSON.stringify(list)); ed.render(); };
  root.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.dataset.i == null) return;
    const x = ed.draft[+b.dataset.i];
    if (b.dataset.d != null) { const d = +b.dataset.d; x.days = x.days.includes(d) ? x.days.filter(v => v !== d) : [...x.days, d]; }
    else if (b.dataset.q) x.days = b.dataset.q === 'all' ? [...DAY_ORDER] : b.dataset.q === 'weekday' ? [1, 2, 3, 4, 5] : [6, 0];
    else if (b.dataset.sdel) ed.draft.splice(+b.dataset.i, 1);
    else return;
    ed.render();
  });
  root.addEventListener('change', e => { if (e.target.dataset.k === 'kind') ed.draft[+e.target.dataset.i].kind = e.target.value; });
  root.addEventListener('tchange', e => { const m = re.exec(e.target.id); if (m && ed.draft[+m[2]]) ed.draft[+m[2]][m[1] === 'S' ? 'start' : 'end'] = getT(e.target.id) || ''; });
  $(addSel).addEventListener('click', () => { ed.draft.push({ days: ed.draft.length ? [] : [...DAY_ORDER], start: '09:00', end: '17:00', kind: 'main' }); ed.render(); });
  return ed;
}
const adminSlots = SlotEditor('#fSlots', 'sl', '#fSlotAdd'), reqSlots = SlotEditor('#rSlots', 'rq', '#rSlotAdd');

function renderStarInput() {
  $('#fStars').innerHTML = [1, 2, 3, 4, 5].map(n => `<span data-n="${n}" class="${n <= formRating ? 'on' : ''}" role="button" aria-label="評価${n}">★</span>`).join('');
}
$('#fStars').addEventListener('click', e => { if (e.target.dataset.n) { formRating = +e.target.dataset.n; renderStarInput(); } });
function renderRoleSelect() {
  const sel = $('#fRole'), cur = sel.value;
  sel.innerHTML = '<option value="">（選択なし）</option>' + state.roles.map(r => `<option value="${esc(r.name)}">${esc(r.name)}</option>`).join('');
  sel.value = state.roles.some(r => r.name === cur) ? cur : '';
}
function updateWageNote() {
  const v = +$('#fWage').value, cur = $('#fCur').value, min = state.settings.minWage;
  $('#fWageNote').textContent = !(v > 0) ? `空欄のときは、最低賃金（${min.toLocaleString()}円）で計算します` : (cur === 'JPY' && v < min) ? `⚠ 最低賃金（${min.toLocaleString()}円）を下回っています` : '';
}
['input', 'change'].forEach(ev => { $('#fWage').addEventListener(ev, updateWageNote); $('#fCur').addEventListener(ev, updateWageNote); });

const empEl = $('#empModal');
function openEmp(id) {
  editingId = id;
  const s = id ? state.staff.find(x => x.id === id) : null;
  formRating = s ? s.rating : 3;
  renderRoleSelect();
  $('#fName').value = s ? s.name : ''; $('#fRole').value = s ? s.role : '';
  $('#fWage').value = s && s.wage > 0 ? s.wage : ''; $('#fCur').value = s ? (s.cur || 'JPY') : 'JPY';
  $('#fType').value = s ? (s.type || '') : 'アルバイト'; $('#fBirth').value = s ? (s.birth || '') : '';
  $('#fJoin').value = s ? (s.join || '') : ''; $('#fLeave').value = s ? (s.leave || '') : '';
  $('#fWeekMax').value = s && s.weeklyMax ? s.weeklyMax : ''; $('#fIncCap').value = s && s.incomeCap ? s.incomeCap : '';
  $('#fDpwMin').value = s && s.dpw ? s.dpw.min : ''; $('#fDpwMax').value = s && s.dpw ? s.dpw.max : '';
  adminSlots.set(s ? (s.avail || []) : [{ days: [...DAY_ORDER], start: '09:00', end: '17:00', kind: 'main' }]);
  $('#formTitle').textContent = s ? '従業員を編集' : '従業員を登録'; $('#fSubmit').textContent = s ? '変更を保存' : '登録する';
  renderStarInput(); updateWageNote();
  empEl.hidden = false; $('#fName').focus();
}
const closeEmp = () => { empEl.hidden = true; editingId = null; };
const resetForm = closeEmp;
empEl.addEventListener('click', e => { if (e.target === empEl) closeEmp(); });
empEl.addEventListener('keydown', e => { if (e.key === 'Escape') closeEmp(); });
$('#fCancel').addEventListener('click', closeEmp);
$('#emAdd').addEventListener('click', () => openEmp(null));

$('#staffForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#fName').value.trim(), wage = +$('#fWage').value || 0, cur = $('#fCur').value;
  const birth = $('#fBirth').value, join = $('#fJoin').value, leave = $('#fLeave').value, weeklyMax = +$('#fWeekMax').value || 0, incomeCap = +$('#fIncCap').value || 0;
  if (!name) return ui.toast('名前を入力してください', 'err');
  if (state.staff.some(s => s.name === name && s.id !== editingId)) return ui.toast('同じ名前の従業員がすでにいます。区別できる名前にしてください', 'err');
  if (wage > 0 && cur === 'JPY' && wage < state.settings.minWage) return ui.toast(`時給は最低賃金（${state.settings.minWage.toLocaleString()}円）以上にしてください。空欄なら最低賃金になります`, 'err');
  if (birth && birth > todayKey()) return ui.toast('生年月日が、今日より後になっています', 'err');
  if (join && leave && leave < join) return ui.toast('退職日は、入社日より後にしてください', 'err');
  const err = adminSlots.check(); if (err) return ui.toast(err, 'err');
  const dmin = $('#fDpwMin').value, dmax = $('#fDpwMax').value;
  const dpw = (dmin === '' && dmax === '') ? null : { min: Math.min(+dmin || 0, +dmax || 0), max: Math.max(+dmin || 0, +dmax || 0) };
  const d = { name, role: $('#fRole').value, rating: formRating, wage, cur, type: $('#fType').value, birth, join, leave, weeklyMax, incomeCap, dpw, avail: adminSlots.value() };
  if (editingId) { Object.assign(state.staff.find(s => s.id === editingId), d); ui.toast('変更を保存しました'); }
  else { state.staff.push({ id: 's' + Date.now(), ...d }); ui.toast(`${name}さんを登録しました`); }
  save(); closeEmp(); renderStaffList(); renderGantt(); renderRoles();
});

function renderStaffList() {
  const box = $('#staffList'), sel = $('#emRole'), cur = sel.value;
  sel.innerHTML = '<option value="">すべての役割</option>' + state.roles.map(r => `<option value="${esc(r.name)}">${esc(r.name)}</option>`).join('') + '<option value="__none">役割なし</option>';
  sel.value = [...sel.options].some(o => o.value === cur) ? cur : '';
  const q = ($('#emSearch').value || '').trim(), rf = sel.value, today = todayKey();
  const list = state.staff.slice().sort((a, b) => roleIdx(a) - roleIdx(b) || b.rating - a.rating || state.staff.indexOf(a) - state.staff.indexOf(b))   // 階級順
    .filter(s => (!q || s.name.includes(q)) && (!rf || (rf === '__none' ? !s.role : s.role === rf)));
  $('#emCount').textContent = `${list.length}人` + (list.length !== state.staff.length ? `（全${state.staff.length}人）` : '');
  renderReqBanner();
  if (!state.staff.length) { box.innerHTML = '<div class="empty">まだ従業員がいません。「＋ 従業員を追加」から登録できます（開発者モードで、例のデータも作れます）。</div>'; return; }
  if (!list.length) { box.innerHTML = '<div class="empty">条件に合う従業員がいません。</div>'; return; }
  const sub = s => [s.type, s.birth ? (isMinor(s, today) ? `<b class="warnText">${ageOn(s, today)}歳（18歳未満）</b>` : `${ageOn(s, today)}歳`) : '', s.weeklyMax ? `週${s.weeklyMax}時間まで` : '', s.incomeCap ? `月${s.incomeCap.toLocaleString()}円まで` : '', s.dpw ? `週${s.dpw.min}〜${s.dpw.max}日` : '', s.join ? `入社 ${s.join.slice(5).replace('-', '/')}` : '', s.leave ? `退職 ${s.leave.slice(5).replace('-', '/')}` : ''].filter(Boolean).join('・');
  box.innerHTML = '<table class="emtable"><thead><tr><th>名前</th><th>役割</th><th>評価</th><th>時給</th><th>出勤できる曜日・時間</th><th></th></tr></thead><tbody>' + list.map(s => `<tr>
    <td class="nm"><b>${esc(s.name)}</b><div class="sub">${sub(s)}</div></td>
    <td>${s.role ? `<span class="badge" style="background:${roleColor(s.role)}">${esc(s.role)}</span>` : '<span class="meta">—</span>'}</td>
    <td><span class="stars">${stars(s.rating)}</span></td>
    <td>${esc(wageText(s))}${belowMin(s) ? ' <span class="warnText">⚠最低賃金未満</span>' : ''}</td>
    <td class="av">${(s.avail || []).length ? s.avail.map(x => `<span>${esc(daysText(slotDays(x)))} ${hm(x.start)}–${hm(x.end)}${x.kind === 'sub' ? '<i class="meta">（予備）</i>' : ''}</span>`).join('') : '<span class="warnText">未設定</span>'}</td>
    <td class="btns"><button type="button" class="btn small" data-edit="${s.id}">編集</button> <button type="button" class="btn small" data-del="${s.id}">削除</button></td></tr>`).join('') + '</tbody></table>';
}
['emSearch', 'emRole'].forEach(id => $('#' + id).addEventListener(id === 'emSearch' ? 'input' : 'change', renderStaffList));
$('#staffList').addEventListener('click', async e => {
  const ed = e.target.dataset.edit, del = e.target.dataset.del;
  if (ed) openEmp(ed);
  if (del) {
    const s = state.staff.find(x => x.id === del);
    if (!await ui.ask(`${s.name}さんを削除します。スケジュールからも外れます。`, { ok: '削除する', danger: true })) return;
    state.staff = state.staff.filter(x => x.id !== del); Object.values(state.work).forEach(m => delete m[del]);
    Object.values(state.shifts).forEach(m => delete m[del]);
    delete state.prefs[del]; state.auth.users = state.auth.users.filter(u => u.staffId !== del); state.requests = state.requests.filter(r => r.staffId !== del);
    save(); renderStaffList(); renderGantt(); renderRoles(); ui.toast('削除しました');
  }
});

/* ---- 出勤できる曜日・時間の変更申請（従業員が申請 → 管理者が承認すると反映） ---- */
const dpwText = s => s.dpw ? `${s.dpw.min}〜${s.dpw.max}日（本人の希望）` : `${state.settings.auto2.dpw.min}〜${state.settings.auto2.dpw.max}日（初期値）`;
const REQ_LABEL = { pending: '承認待ち', approved: '承認されました', rejected: '承認されませんでした' };
const pendingReqs = () => state.requests.filter(r => r.status === 'pending');
function renderReqBanner() {
  const n = pendingReqs().length; $('#reqBanner').hidden = !n;
  $('#reqBannerText').textContent = n ? `出勤できる曜日・時間の変更申請が${n}件あります。` : '';
}
function renderReqCard() {   // 従業員画面
  const s = state.staff.find(x => x.id === empId), emp = !!(me && me.role === 'employee');
  if (!s) return;
  $('#reqCur').textContent = `いまの登録：${availText(s)} ／ 週の出勤日数：${dpwText(s)}`;
  $('#reqOpen').disabled = !emp;
  const mine = state.requests.filter(r => r.staffId === s.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 4);
  $('#reqList').innerHTML = mine.length ? mine.map(r => `<li><div class="info"><span class="reqst ${r.status}">${REQ_LABEL[r.status]}</span> <span class="meta">${fmtAt(r.at)} に申請</span>
    <div class="meta">${esc(availText({ avail: r.avail }))}</div>${r.reply ? `<div class="meta">管理者より：${esc(r.reply)}</div>` : ''}</div></li>`).join('') : '<li class="meta">申請はまだありません。</li>';
}
$('#reqOpen').addEventListener('click', () => {
  const s = state.staff.find(x => x.id === empId); if (!s || !me || me.role !== 'employee') return;
  reqSlots.set(s.avail || []); $('#rNote').value = ''; $('#rDpwMin').value = s.dpw ? s.dpw.min : ''; $('#rDpwMax').value = s.dpw ? s.dpw.max : ''; $('#reqModal').hidden = false;
});
const closeReq = () => { $('#reqModal').hidden = true; };
$('#rCancel').addEventListener('click', closeReq);
$('#reqModal').addEventListener('click', e => { if (e.target === $('#reqModal')) closeReq(); });
$('#rSend').addEventListener('click', () => {
  const s = state.staff.find(x => x.id === empId); if (!s) return;
  const err = reqSlots.check(); if (err) return ui.toast(err, 'err');
  const avail = reqSlots.value();
  const a = $('#rDpwMin').value, b = $('#rDpwMax').value, dpw = (a === '' && b === '') ? null : { min: Math.min(+a || 0, +b || 0), max: Math.max(+a || 0, +b || 0) };
  if (JSON.stringify(avail) === JSON.stringify(s.avail) && JSON.stringify(dpw) === JSON.stringify(s.dpw || null)) return ui.toast('いまの登録と同じ内容です', 'warn');
  state.requests = state.requests.filter(r => !(r.staffId === s.id && r.status === 'pending'));   // 前の承認待ちは、新しい申請に置きかえる
  state.requests.push({ id: 'q' + Date.now(), staffId: s.id, at: new Date().toISOString(), avail, dpw, note: $('#rNote').value.trim(), status: 'pending' });
  save(); closeReq(); renderReqCard(); ui.toast('管理者に申請しました。承認されると反映されます');
});
function renderReqReview() {   // 管理者画面
  const list = pendingReqs();
  $('#revList').innerHTML = list.length ? list.map(r => { const s = state.staff.find(x => x.id === r.staffId); return s ? `<li data-id="${r.id}">
    <b>${esc(s.name)}</b> <span class="meta">${fmtAt(r.at)} に申請</span>
    <div class="cmp"><b>いま</b><span>${esc(availText(s))}</span><b>申請</b><span>${esc(availText({ avail: r.avail }))}</span>${r.dpw ? `<b>週の日数</b><span>${esc(dpwText(s))} → ${r.dpw.min}〜${r.dpw.max}日</span>` : ''}</div>
    ${r.note ? `<div class="cmt">${esc(r.note)}</div>` : ''}
    <input type="text" data-reply placeholder="返信メッセージ（任意）">
    <div class="actions"><button type="button" class="btn small" data-rv="reject">承認しない</button><button type="button" class="btn small primary" data-rv="approve">承認して反映</button></div></li>` : ''; }).join('') : '<li class="meta">確認待ちの申請はありません。</li>';
}
$('#reqReview').addEventListener('click', () => { renderReqReview(); $('#revModal').hidden = false; });
$('#revClose').addEventListener('click', () => { $('#revModal').hidden = true; });
$('#revModal').addEventListener('click', e => {
  if (e.target === $('#revModal')) { $('#revModal').hidden = true; return; }
  const act = e.target.dataset.rv; if (!act) return;
  const li = e.target.closest('li'), r = state.requests.find(x => x.id === li.dataset.id); if (!r) return;
  r.reply = li.querySelector('[data-reply]').value.trim(); r.decidedAt = new Date().toISOString();
  if (act === 'approve') { const s = state.staff.find(x => x.id === r.staffId); s.avail = JSON.parse(JSON.stringify(r.avail)); if (r.dpw) s.dpw = { ...r.dpw }; r.status = 'approved'; }
  else r.status = 'rejected';
  save(); renderReqReview(); renderStaffList(); renderGantt();
  ui.toast(act === 'approve' ? '承認して反映しました。作成ずみのシフトは変わりません（必要なら自動作成をやり直してください）' : '承認しませんでした');
});

/* 深夜の割増の設定 */
function renderNight() {
  const N = state.settings.night, opts = Array.from({ length: 25 }, (_, h) => `<option value="${h}">${h}:00</option>`).join('');
  $('#ntStart').innerHTML = opts; $('#ntEnd').innerHTML = opts;
  $('#ntStart').value = N.start; $('#ntEnd').value = N.end; $('#ntPct').value = N.pct; $('#ntPlus').value = N.plus || 0;
  const ex = Math.round(state.settings.minWage * (1 + (N.pct || 0) / 100) + (N.plus || 0));
  $('#ntNote').textContent = `いまの設定：${N.start}:00〜${N.end}:00 の勤務に、時給の${N.pct}％${N.plus ? `＋${N.plus}円` : ''}を加えます（最低賃金${state.settings.minWage.toLocaleString()}円の人の深夜1時間は、約${ex.toLocaleString()}円）。`;
}
['ntStart', 'ntEnd', 'ntPct', 'ntPlus'].forEach(id => $('#' + id).addEventListener('change', () => {
  const p = +$('#ntPct').value, pl = +$('#ntPlus').value;
  if (!(p >= 0) || !(pl >= 0)) { ui.toast('割増率と足す金額は、0以上の数を入れてください', 'err'); renderNight(); return; }
  Object.assign(state.settings.night, { start: +$('#ntStart').value, end: +$('#ntEnd').value, pct: p, plus: pl });
  save(); renderNight(); renderGantt(); if (curTab === 'shift') renderShift(); ui.toast('深夜の割増を更新しました');
}));

/* ---- 自動作成の条件・シフトの型・責任者の印 ---- */
function renderAuto2() {
  const A = state.settings.auto2;
  $('#a2Rest').value = A.restMax; $('#a2Int').value = A.interval; $('#a2DMin').value = A.dpw.min; $('#a2DMax').value = A.dpw.max;
  $('#a2Lead').value = A.leadMin; $('#a2Secs').value = String(A.secs); $('#a2Flex').checked = !!A.flex;
  const leads = state.roles.filter(r => r.lead).map(r => r.name);
  $('#a2Note').textContent = A.leadMin > 0 ? (leads.length ? `責任者：${leads.join('、')}（各時間に${A.leadMin}人以上）` : '責任者の役割がまだ決まっていません。「共通」の役割の管理で、店長・副店長などに印を付けてください。') : '責任者の配置は見ません。';
}
['a2Rest', 'a2Int', 'a2DMin', 'a2DMax', 'a2Lead', 'a2Secs', 'a2Flex'].forEach(id => $('#' + id).addEventListener('change', () => {
  const A = state.settings.auto2, n = x => Math.max(0, Math.round(+$(x).value || 0)), dmin = n('#a2DMin'), dmax = n('#a2DMax');
  A.restMax = Math.max(1, n('#a2Rest')); A.interval = n('#a2Int'); A.dpw = { min: Math.min(dmin, dmax), max: Math.max(dmin, dmax) };
  A.leadMin = n('#a2Lead'); A.secs = +$('#a2Secs').value || 2; A.flex = $('#a2Flex').checked;
  save(); renderAuto2(); renderStaffList(); ui.toast('自動作成の条件を更新しました');
}));
$('#roleList').addEventListener('change', e => {
  const i = e.target.dataset.rlead; if (i == null) return;
  state.roles[+i].lead = e.target.checked; save(); renderAuto2(); ui.toast(e.target.checked ? `「${state.roles[+i].name}」を責任者にしました` : '責任者の印をはずしました');
});

function renderPatterns() {
  const L = state.patterns;
  $('#ptList').innerHTML = L.length ? L.map((x, i) => `<div class="pt">
    <div class="pt-top"><input type="text" data-i="${i}" data-k="name" value="${esc(x.name)}" placeholder="名前（例 早番）" maxlength="8">
      ${DAY_ORDER.map(d => `<button type="button" class="dchip${d === 6 ? ' sat' : d === 0 ? ' sun' : ''}${x.days.includes(d) ? ' on' : ''}" data-i="${i}" data-d="${d}">${DOW[d]}</button>`).join('')}
      <span class="sl-quick"><button type="button" class="btn small" data-i="${i}" data-q="all">毎日</button><button type="button" class="btn small" data-i="${i}" data-q="weekday">平日</button><button type="button" class="btn small" data-i="${i}" data-q="weekend">週末</button></span></div>
    <div class="pt-time"><div id="ptS${i}"></div><span>〜</span><div id="ptE${i}"></div><button type="button" class="btn small" data-i="${i}" data-pdel="1">削除</button></div></div>`).join('')
    : '<p class="meta">型はまだありません。「＋ 型を追加」から作れます（例：早番 10:00–17:00、遅番 17:00–24:00）。</p>';
  L.forEach((x, i) => { timeField('ptS' + i); timeField('ptE' + i); setT('ptS' + i, x.start); setT('ptE' + i, x.end); });
}
$('#ptList').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || b.dataset.i == null) return;
  const x = state.patterns[+b.dataset.i];
  if (b.dataset.d != null) { const d = +b.dataset.d; x.days = x.days.includes(d) ? x.days.filter(v => v !== d) : [...x.days, d]; }
  else if (b.dataset.q) x.days = b.dataset.q === 'all' ? [...DAY_ORDER] : b.dataset.q === 'weekday' ? [1, 2, 3, 4, 5] : [6, 0];
  else if (b.dataset.pdel) state.patterns.splice(+b.dataset.i, 1);
  else return;
  save(); renderPatterns();
});
$('#ptList').addEventListener('change', e => { if (e.target.dataset.k === 'name') { state.patterns[+e.target.dataset.i].name = e.target.value.trim(); save(); } });
$('#ptList').addEventListener('tchange', e => {
  const m = /^pt([SE])(\d+)$/.exec(e.target.id); if (!m) return;
  const x = state.patterns[+m[2]], a = getT('ptS' + m[2]), b = getT('ptE' + m[2]);
  if (!a || !b || toH(b, true) <= toH(a)) { ui.toast('時刻は「開始 ＜ 終了」になるように入れてください', 'err'); renderPatterns(); return; }
  if (x.start === a && x.end === b) return;
  x.start = a; x.end = b; save();
});
$('#ptAdd').addEventListener('click', () => { state.patterns.push({ id: 'p' + Date.now(), name: '', start: '09:00', end: '17:00', days: [...DAY_ORDER] }); save(); renderPatterns(); });

/* 最低賃金の設定 */
function renderMinWage() {
  $('#mwArea').value = state.settings.minWageArea; $('#mwVal').value = state.settings.minWage;
  const low = state.staff.filter(belowMin).length;
  $('#mwNote').textContent = `いまの最低賃金：${state.settings.minWageArea} ${state.settings.minWage.toLocaleString()}円` + (low ? `　⚠ 最低賃金を下回る時給の従業員が${low}人います` : '');
}
['mwArea', 'mwVal'].forEach(id => $('#' + id).addEventListener('change', () => {
  const v = Math.round(+$('#mwVal').value);
  if (!(v > 0)) { ui.toast('最低賃金は、0より大きい数を入れてください', 'err'); renderMinWage(); return; }
  state.settings.minWage = v; state.settings.minWageArea = $('#mwArea').value.trim() || '（地域未設定）';
  save(); renderMinWage(); renderStaffList(); renderGantt(); ui.toast('最低賃金を更新しました');
}));

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
  target: [['fill', '出勤できる時間いっぱいまで勤務を追加する'], ['cap', '出勤できる時間を上限にする（追加はしない）'], ['ignore', '出勤できる時間の長さにこだわらない']],
  sub: [['never', '使わない'], ['fallback', '人手が足りないときだけ使う'], ['always', '本来の時間と同等に使う']],
  fix: [['off', 'ゆるめない（足りないままにする）'], ['flex', '足りないときは、予備の時間・休みの日をゆるめて補う（希望休と希望時間の外には入れない）']]
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
      <label class="rlead"><input type="checkbox" data-rlead="${i}"${r.lead ? ' checked' : ''}> 責任者</label>
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
    state.staff.forEach(s => { if (s.role === old) s.role = name; }); // 名前変更を従業員にも反映
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
    const msg = users.length ? `役割「${r.name}」を削除します。${users.length}人の従業員の役割は「選択なし」になります。` : `役割「${r.name}」を削除します。`;
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
const makeP = (s, main, sub, target, bias = 0, rest = false) => ({ s, main, sub, target, bias, rest, yen: s.wage > 0 ? (s.cur === 'USD' ? s.wage * state.settings.rate : s.wage) : state.settings.minWage });

/* 1日分（時間帯ごと）の配置を解く。P: 配置の対象になる従業員。bias は大きいほど後回しにする重み */
function solveHours(P, H, seed, maxWorkers) {
  const R = state.autoRules;
  const W = { rating: [0, 1, 2, 4][R.rating], contig: [0, 1, 2, 4][R.contig], wage: [0, 0.3, 1, 2.5][R.wage], fair: [0, 0.4, 1, 2][R.fair] };
  const sch = {}, cnt = {}, roleAt = {};
  H.forEach(h => { cnt[h] = seed ? (seed.cnt[h] || 0) : 0; roleAt[h] = seed ? { ...(seed.roleAt[h] || {}) } : {}; });
  P.forEach(p => sch[p.s.id] = []);
  const rr = state.roleRules;
  const roleMax = r => (rr[r] && rr[r].max != null) ? rr[r].max : Infinity;
  const roleOK = (p, h) => !p.s.role || (roleAt[h][p.s.role] || 0) < roleMax(p.s.role);   // 役割ごとの最高人数
  const capH = h => { const r = rule(h); return R.fill === 'min' ? r.min : R.fill === 'mid' ? Math.ceil((r.min + r.max) / 2) : r.max; };
  const workers = new Set(), seedN = seed ? (seed.n || 0) : 0; let capOn = false;   // 余裕を埋める段階では、出勤する人数を maxWorkers までにする
  const full = p => capOn && maxWorkers != null && seedN + workers.size >= maxWorkers && !workers.has(p.s.id);
  const assign = (p, h) => { workers.add(p.s.id); sch[p.s.id].push(h); cnt[h]++; roleAt[h][p.s.role] = (roleAt[h][p.s.role] || 0) + 1; };
  const score = (p, h) => {
    const mine = sch[p.s.id];
    if (mine.includes(h) || mine.length >= p.target) return -Infinity;
    if (mine.length && (h < Math.min(...mine) - 1 || h > Math.max(...mine) + 1)) return -Infinity;   // いまの勤務につながる時間だけ
    const inMain = p.main.includes(h);
    if (!inMain && !p.sub.includes(h)) return -Infinity;
    if (!roleOK(p, h) || full(p)) return -Infinity;
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

  capOn = true;
  // 2) 出勤できる時間いっぱいまで勤務を追加（「出勤できる時間いっぱいまで追加する」のとき）
  if (R.target === 'fill') {
    [...P].sort((a, b) => (a.bias - b.bias) || (W.rating ? b.s.rating - a.s.rating : 0)).forEach(p => {
      if (p.rest || full(p)) return;   // 休みの日は、最低人数を満たすために必要なときだけ出勤
      while (sch[p.s.id].length < p.target) {
        const mine = sch[p.s.id], lo = mine.length ? Math.min(...mine) - 1 : -Infinity, hi = mine.length ? Math.max(...mine) + 1 : Infinity;
        const cand = p.main.filter(h => H.includes(h) && !mine.includes(h) && h >= lo && h <= hi && cnt[h] < capH(h) && roleOK(p, h));
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
const isClosed = pk => !!state.closed[pk] || (!!deadlineOf(pk) && todayKey() > deadlineOf(pk));   // 手動で締め切った、または締切日を過ぎた
function deadlineText(pk) {
  if (state.closed[pk]) return '受付を締め切りました（管理者が手動で締め切り）';
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
/* ---- 日ごとの人数ルール（最低・最高人数）：平日・週末・毎日・曜日・月・日付で自由に組み合わせる ---- */
const SR_DAY = [['all', '毎日'], ['weekday', '平日（月〜金）'], ['weekend', '週末（土・日）'], ['dow1', '毎週月曜日'], ['dow2', '毎週火曜日'], ['dow3', '毎週水曜日'], ['dow4', '毎週木曜日'], ['dow5', '毎週金曜日'], ['dow6', '毎週土曜日'], ['dow0', '毎週日曜日'], ['date', '特定の日付']];
const SR_LABEL = Object.fromEntries(SR_DAY);
function srMatch(r, k) {
  const d = parseYmd(k), dow = d.getDay();
  if (+r.month && d.getMonth() + 1 !== +r.month) return false;
  if (r.day === 'all') return true;
  if (r.day === 'weekday') return dow >= 1 && dow <= 5;
  if (r.day === 'weekend') return dow === 0 || dow === 6;
  if (r.day === 'date') return r.date === k;
  return r.day === 'dow' + dow;
}
const srSpec = r => (r.day === 'date' ? 5 : /^dow/.test(r.day) ? 4 : r.day === 'all' ? 1 : 3) + (+r.month ? 0.5 : 0);   // 細かい指定ほど優先
function dayRuleOf(k) {
  let best = null, bs = -1;
  state.shiftRules.forEach((r, i) => { if (!srMatch(r, k)) return; const sc = srSpec(r) + i * 1e-6; if (sc > bs) { bs = sc; best = r; } });
  return best;
}
const srText = r => `${+r.month ? r.month + '月の' : ''}${r.day === 'date' ? (r.date ? mdText(r.date) : '（日付未指定）') : SR_LABEL[r.day]}：最低${r.min}人${r.max == null ? '' : '・最高' + r.max + '人'}`;

/* ---- シフト管理の従業員並び替え（はじめは階級順） ---- */
const SHIFT_SORTS = {
  role: { label: '階級順（役割管理の並び順）', desc: false },
  rating: { label: '評価', desc: true },
  name: { label: '名前（あいうえお）', desc: false },
  hours: { label: '期間の勤務時間', desc: true },
  days: { label: '期間の出勤日数', desc: true },
  offs: { label: '希望休の多さ', desc: true },
  unsub: { label: '希望の未提出を先に', desc: true },
  wage: { label: '時給', desc: true },
  manual: { label: '登録順', desc: false }
};
const roleIdx = s => { const k = state.roles.findIndex(r => r.name === s.role); return k < 0 ? 999 : k; };   // 役割なしは最後
function shiftStaff(keys, pk) {
  const { key, desc } = state.settings.shiftSort;
  const f = {
    role: roleIdx, rating: s => s.rating, name: s => s.name, wage: s => hourly(s), manual: () => 0,
    hours: s => keys.reduce((n, k) => n + shiftHours(dayShifts(k)[s.id]), 0),
    days: s => keys.filter(k => isWork(dayShifts(k)[s.id])).length,
    offs: s => keys.filter(k => adminPref(s.id, k, pk).status === 'off').length,
    unsub: s => subOf(s.id, pk) ? 0 : 1
  }[key] || (() => 0);
  const arr = state.staff.map((s, i) => ({ s, i, v: f(s) }));
  arr.sort((a, b) => {
    let c = typeof a.v === 'string' ? a.v.localeCompare(b.v, 'ja') : a.v - b.v;
    if (desc) c = -c;
    return c || (key === 'role' ? b.s.rating - a.s.rating : roleIdx(a.s) - roleIdx(b.s)) || a.i - b.i;   // 同じなら、階級→評価→登録順
  });
  return arr.map(x => x.s);
}
function renderShiftSortBar() {
  const sv = state.settings.shiftSort, b = $('#wDir');
  if (!SHIFT_SORTS[sv.key]) { sv.key = 'role'; sv.desc = false; }
  $('#wSort').value = sv.key; b.disabled = sv.key === 'manual'; b.textContent = sv.desc ? '▼ 降順' : '▲ 昇順';
}
$('#wSort').innerHTML = Object.entries(SHIFT_SORTS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
$('#wSort').addEventListener('change', () => { const k = $('#wSort').value; state.settings.shiftSort = { key: k, desc: SHIFT_SORTS[k].desc }; save(); renderShift(); });
$('#wDir').addEventListener('click', () => { state.settings.shiftSort.desc = !state.settings.shiftSort.desc; save(); renderShift(); });

/* ---- 人数ルールの反映表示・人数が足りない日の一覧 ---- */
function renderRuleNote(keys) {
  const L = state.shiftRules, el = $('#wRuleNote');
  if (!L.length) { el.className = 'rulenote none'; el.innerHTML = '日ごとの人数ルールは未設定です。<button type="button" class="btn small" data-go="rules">設定で決める</button>'; return; }
  const used = new Set(); let days = 0;
  keys.forEach(k => { const r = dayRuleOf(k); if (r) { days++; used.add(L.indexOf(r)); } });
  el.className = 'rulenote on';
  el.innerHTML = `<b>✓ 人数ルールを反映中</b><span>この期間の${days}日に適用</span>` + [...used].slice(0, 4).map(i => `<span class="chip">${esc(srText(L[i]))}</span>`).join('') +
    (used.size > 4 ? `<span>…ほか${used.size - 4}件</span>` : '') + '<button type="button" class="btn small" data-go="rules">設定を開く</button>';
}
$('#wRuleNote').addEventListener('click', e => { if (e.target.dataset.go) { setCat = 'shift'; switchTab('settings'); } });
function renderLackLine(keys) {
  const el = $('#wLack'), active = keys.some(hasShifts);
  const lack = active ? keys.filter(k => dayStat(k).lack) : [];
  el.hidden = !lack.length;
  el.textContent = lack.length ? `⚠ 人数が足りない日が${lack.length}日あります：${lack.slice(0, 8).map(mdText).join('、')}${lack.length > 8 ? `…ほか${lack.length - 8}日` : ''}` : '';
}

function dayCover(k) {   // その日の、時間ごとの配置人数
  const H = hoursList(), cnt = {}, roleAt = {};
  H.forEach(h => { cnt[h] = 0; roleAt[h] = {}; });
  let n = 0;
  state.staff.forEach(s => {
    const sh = dayShifts(k)[s.id]; if (!isWork(sh)) return;
    n++;
    for (let h = Math.floor(tmin(sh.start) / 60); h < Math.ceil(tmin(sh.end) / 60); h++) if (cnt[h] !== undefined) { cnt[h]++; roleAt[h][s.role] = (roleAt[h][s.role] || 0) + 1; }
  });
  return { n, cnt, roleAt, H };
}
function dayStat(k) {   // lack = 人数が足りない（1日の人数ルール、または時間帯ごとの最低人数）
  const { n, cnt, roleAt, H } = dayCover(k), dr = dayRuleOf(k), hs = shortageOf(cnt, roleAt, H), dayShort = dr ? Math.max(0, dr.min - n) : 0;
  return { n, cnt, short: hs, dayShort, over: !!(dr && dr.max != null && n > dr.max), rule: dr, lack: hs > 0 || dayShort > 0 };
}

/* 希望との食い違い：'req'=希望休の日 ／ 'out'=希望の時間外 */
const conflictOf = (sh, pref, s, k) => {   // 'req' 希望休の日 / 'out' 希望時間の外
  if (pref.status === 'off') return 'req';
  if (pref.status === 'time' && (tmin(sh.start) < tmin(pref.start) || tmin(sh.end) > tmin(pref.end))) return 'out';
  if (s && (s.avail || []).length) { const ok = new Set([...mainHours(s, k), ...subHours(s, k)]); if (shiftHourList(sh).some(h => !ok.has(h))) return 'out'; }
  return '';
};

/* 表の1マス（PC版） */
function shiftCell(s, k, pk, compact) {
  const sh = dayShifts(k)[s.id], pref = adminPref(s.id, k, pk), L = state.settings, attr = `data-id="${s.id}" data-d="${k}"`, c = compact ? ' c' : '';
  if (isWork(sh)) {
    const hrs = shiftHours(sh), over = hrs > L.limitDay, cf = conflictOf(sh, pref, s, k);
    const title = `${s.name} ${hm(sh.start)}–${hm(sh.end)}（実働${fh(hrs)}時間${sh.brk ? '・休憩' + sh.brk + '分' : ''}）${cf === 'req' ? ' ※希望休の日です' : cf === 'out' ? ' ※希望の時間外です' : ''}`;
    const tag = !cf ? '' : compact ? '<em class="tag">!</em>' : `<em class="tag">${cf === 'req' ? '休希望' : '時間外'}</em>`;
    const body = compact ? `<span>${hm(sh.start)}</span><span>${hm(sh.end)}</span>` : `${hm(sh.start)}–${hm(sh.end)}<small>${fh(hrs)}時間${over ? ' ⚠' : ''}</small>`;
    return { hrs, html: `<td class="scell on${over ? ' over' : ''}${c}" style="background:${roleColor(s.role)}" title="${esc(title)}" ${attr}>${body}${tag}</td>` };
  }
  let cls, lab, title;
  if (!employedOn(s, k)) { cls = 'na'; lab = '—'; title = '入社前、または退職後'; }
  else if (pref.status === 'off') { cls = 'pf-off'; lab = '希望休'; title = '本人の希望休'; }
  else if (sh && sh.off) { cls = 'rest'; lab = '休み'; title = 'こちらで指定した休み'; }
  else if (pref.status === 'time') { cls = 'pf-time'; lab = compact ? `<span>${hm(pref.start)}</span><span>${hm(pref.end)}</span>` : `${hm(pref.start)}–${hm(pref.end)}<small>のみ可</small>`; title = `${hm(pref.start)}〜${hm(pref.end)} なら出勤可能`; }
  else { cls = 'pf-ok'; lab = '○'; title = '未決定（出勤可能）'; }
  return { hrs: 0, html: `<td class="scell empty ${cls}${c}" title="${esc(s.name + '：' + title)}" ${attr}>${lab}</td>` };
}

function renderShiftDesktop(keys, pk, el, ro) {
  el = el || $('#wGrid');
  const today = todayKey(), L = state.settings, anyWage = state.staff.length > 0, compact = keys.length > 14, nameW = compact ? 156 : NAME_W;
  const dayCount = Array(keys.length).fill(0), dayCost = Array(keys.length).fill(0), active = keys.some(hasShifts), stat = keys.map(k => dayStat(k));
  const lowAt = i => active && stat[i].lack, anyRule = stat.some(x => x.rule);
  let html = `<table class="gantt shiftgrid${compact ? ' compact' : ''}${ro ? ' ro' : ''}" style="width:100%;min-width:${nameW + keys.length * (compact ? 30 : 64)}px"><colgroup><col style="width:${nameW}px"></colgroup><thead><tr><th class="name">従業員</th>` +
    keys.map((k, i) => { const d = parseYmd(k), low = lowAt(i); return `<th class="${low ? 'low ' : ''}${k === today ? 'today ' : ''}${d.getDay() === 0 ? 'sun' : d.getDay() === 6 ? 'sat' : ''}" title="${mdText(k)}（${DOW[d.getDay()]}）${low ? '：人数が足りません' : ''}">${compact && i && d.getDate() !== 1 ? d.getDate() : mdText(k)}<small>${compact ? DOW[d.getDay()] : '（' + DOW[d.getDay()] + '）'}</small>${low ? '<i class="warnmark">⚠</i>' : ''}</th>`; }).join('') + '</tr></thead><tbody>';
  shiftStaff(keys, pk).forEach(s => {
    const sb = subOf(s.id, pk); let tot = 0;
    const cells = keys.map((k, i) => {
      const c = shiftCell(s, k, pk, compact);
      if (c.hrs > 0 || isWork(dayShifts(k)[s.id])) { tot += c.hrs; dayCount[i]++; dayCost[i] += shiftCost(s, dayShifts(k)[s.id]); }
      return c.html;
    }).join('');
    const cost = keys.reduce((n, k) => n + shiftCost(s, dayShifts(k)[s.id]), 0);
    const incWarn = s.incomeCap && [...new Set(keys.map(k => k.slice(0, 7)))].some(ym => monthIncome(s, ym + '-01') > toDisp(s.incomeCap, 'JPY'));
    const overW = [...new Set(keys.map(k => ymd(mondayOf(parseYmd(k)))))].some(m => wkHours(s.id, m) > Math.min(L.limitWeek, s.weeklyMax || Infinity));
    html += `<tr><th class="name"><b>${esc(s.name)}</b><div class="meta">${esc(s.role || '役割なし')}${compact ? (sb ? '' : ' ・<span class="warnText">未提出</span>') : ` ／ <span class="${sb ? '' : 'warnText'}">${sb ? '希望提出済み' : '希望未提出'}</span>`}</div>
      <div class="meta${overW ? ' warnText' : ''}">${compact ? fh(tot) + 'h' : '合計' + fh(tot) + '時間'}・${money(cost)}${overW ? ' ⚠週超過' : ''}${incWarn ? ' ⚠収入上限' : ''}</div></th>${cells}</tr>`;
  });
  html += '</tbody><tfoot>';
  if (anyRule) html += '<tr class="need"><th class="name">必要人数<small>人数ルール</small></th>' + stat.map(st => `<td>${st.rule ? st.rule.min + (compact ? (st.rule.max == null ? '+' : '-' + st.rule.max) : '〜' + (st.rule.max == null ? '' : st.rule.max)) : '—'}</td>`).join('') + '</tr>';
  html += '<tr><th class="name">出勤人数</th>' + dayCount.map((n, i) => `<td class="${lowAt(i) ? 'low' : stat[i].over ? 'high' : ''}" title="${lowAt(i) ? '人数が足りません' : stat[i].over ? '最高人数を超えています' : ''}">${n}${compact ? '' : '人'}</td>`).join('') + '</tr>';
  if (anyWage) html += '<tr><th class="name">人件費</th>' + dayCost.map(c => `<td>${c ? (compact ? Math.round(c / 1000) + 'k' : money(c)) : '—'}</td>`).join('') + '</tr>';
  el.innerHTML = html + '</tfoot></table>';
}

/* ---- スマホ版：月カレンダー（出勤人数つき）＋ 選んだ日の従業員一覧 ---- */
let mDay = null;
function renderShiftMobile(keys, pk) {
  const today = todayKey(), active = keys.some(hasShifts);
  if (!mDay || !keys.includes(mDay)) mDay = keys.includes(today) ? today : keys[0];
  let html = '<div class="mcal">' + DOW_MON.map(d => `<div class="dow">${d}</div>`).join('') + '<div class="mday blank"></div>'.repeat((aP.start.getDay() + 6) % 7);
  keys.forEach(k => {
    const d = parseYmd(k), st = dayStat(k), t = hasShifts(k), wd = d.getDay(), low = active && st.lack;
    html += `<button type="button" class="mday${k === mDay ? ' sel' : ''}${k === today ? ' today' : ''}${low ? ' low' : ''}${wd === 0 ? ' sun' : wd === 6 ? ' sat' : ''}" data-k="${k}"><b>${d.getDate()}</b><span>${t ? st.n + '人' : '—'}</span>${low ? '<i class="wm">⚠</i>' : ''}</button>`;
  });
  html += '</div>';
  const d = parseYmd(mDay), st = dayStat(mDay), idx = keys.indexOf(mDay), t = hasShifts(mDay), low = active && st.lack;
  html += `<div class="mday-head"><button type="button" class="btn small" data-mnav="-1"${idx === 0 ? ' disabled' : ''} aria-label="前の日">‹</button><strong class="${low ? 'lack' : ''}">${d.getMonth() + 1}/${d.getDate()}（${DOW[d.getDay()]}）${low ? ' ⚠' : ''}</strong>` +
    `<button type="button" class="btn small" data-mnav="1"${idx === keys.length - 1 ? ' disabled' : ''} aria-label="次の日">›</button>` +
    `<span class="pill${low ? ' warn' : ' ok'}">${t ? st.n + '人' + (low ? '・人数が足りません' : '') : '未作成'}</span>` +
    (st.rule ? `<span class="meta">必要 ${st.rule.min}${st.rule.max == null ? '人以上' : '〜' + st.rule.max + '人'}</span>` : '') + '</div><ul class="mlist">';
  shiftStaff(keys, pk).forEach(s => {
    const sh = dayShifts(mDay)[s.id], pref = adminPref(s.id, mDay, pk);
    let chip, cls = '', style = '';
    if (isWork(sh)) {
      const cf = conflictOf(sh, pref, s, mDay);
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
    const msg = '<div class="empty">従業員がまだいません。「従業員」タブから登録してください。</div>';
    $('#wGrid').innerHTML = msg; $('#wMobile').innerHTML = msg; $('#wTotal').textContent = ''; $('#wReq').innerHTML = ''; return;
  }
  const mc = !!state.closed[pk]; $('#wCloseNow').textContent = mc ? '受付を再開する' : '今すぐ締め切る'; $('#wCloseNow').disabled = !mc && isClosed(pk);
  renderRuleNote(keys); renderShiftSortBar(); renderLackLine(keys);
  if (mobile) renderShiftMobile(keys, pk); else renderShiftDesktop(keys, pk);
  const anyWage = state.staff.length > 0;
  let grand = 0, grandCost = 0;
  state.staff.forEach(s => keys.forEach(k => { const h = shiftHours(dayShifts(k)[s.id]); grand += h; grandCost += shiftCost(s, dayShifts(k)[s.id]); }));
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
   level 0=通常 ／ 1=予備の時間・休みの日をゆるめる ／ 2=さらに時間指定・勤務時間の上限・連続勤務の上限もゆるめる */
function autoShifts(p, keep) {
  const keys = pKeys(p), R = state.autoRules, S = state.settings, H = hoursList(), pk = ymd(p.start);
  const fairP = [0, 0.15, 0.3, 0.6][R.fair], total = {}, shortDays = [], relaxed = { soft: 0, hard: 0 };
  const maxLevel = R.fix === 'off' ? 0 : 1;   // ゆるめるのは、予備の時間・休みの日まで
  const hrsOf = x => isWork(x) ? shiftHours(x) : 0;
  state.staff.forEach(s => total[s.id] = 0);
  keys.forEach(k => {   // 「残す」のときは、自動で作った分だけを消す（手で入れたシフト・休みは固定）
    if (keep && state.shifts[k]) { Object.keys(state.shifts[k]).forEach(id => { if (state.shifts[k][id].auto) delete state.shifts[k][id]; }); if (!hasShifts(k)) delete state.shifts[k]; }
    else delete state.shifts[k];
    state.staff.forEach(s => { total[s.id] += hrsOf(dayShifts(k)[s.id]); });
  });
  const streakOf = (id, k) => { let n = 0; for (let i = 1; i <= S.maxStreak; i++) { if (isWork(dayShifts(ymd(addDays(parseYmd(k), -i)))[id])) n++; else break; } return n; };
  const build = (k, level, fixed) => {   // その日に入れられる人（希望休・希望時間の外は、どの段階でも対象にしない）
    const P = [];
    state.staff.forEach((s, idx) => {
      if (fixed.has(s.id)) return;
      if (!employedOn(s, k)) return;                                                      // 入社前・退職後
      const pref = adminPref(s.id, k, pk);
      if (pref.status === 'off') return;
      if (streakOf(s.id, k) >= S.maxStreak) return;                                       // 連続勤務の上限
      let room = Math.min(S.limitDay, S.limitWeek - wkHours(s.id, k));                   // 1日・週の注意ライン
      if (s.weeklyMax) room = Math.min(room, s.weeklyMax - wkHours(s.id, k));            // 本人の週の上限時間
      if (s.incomeCap) room = Math.min(room, (toDisp(s.incomeCap, 'JPY') - monthIncome(s, k)) / Math.max(1, hourly(s)));   // 本人の月の上限収入
      if (room < 1) return;
      let main = mainHours(s, k), sub = (R.sub === 'never' && level < 1) ? [] : subHours(s, k);
      if (pref.status === 'time') {                                                      // 本人の時間指定の中だけ
        const lo = toH(pref.start), hi = toH(pref.end, true);
        main = main.filter(h => h >= lo && h < hi); sub = sub.filter(h => h >= lo && h < hi);
      }
      main = main.filter(h => H.includes(h)); sub = sub.filter(h => H.includes(h));
      if (isMinor(s, k)) { main = main.filter(h => !nightLegal(h)); sub = sub.filter(h => !nightLegal(h)); }   // 18歳未満は、22時〜翌5時に入れない
      if (!main.length && !sub.length) return;
      const base = (R.target === 'ignore' || level >= 1) ? Infinity : mainHours(s, k).length;
      P.push(makeP(s, main, sub, Math.min(base, room), total[s.id] * fairP, level < 1 && parseYmd(k).getDay() === (idx + 1) % 7));   // 週に1日は、従業員ごとに曜日をずらして休み
    });
    return P;
  };
  const recFrom = (hrs, allowed) => {   // 希望時間の中で、つながった1つのシフトにする（あいた時間は、希望時間の中のときだけつなぐ）
    hrs = hrs.slice().sort((a, b) => a - b); if (!hrs.length) return null;
    const blocks = [];
    hrs.forEach(h => {
      const b = blocks[blocks.length - 1];
      let join = false;
      if (b && h - b.e <= 3) { join = true; for (let x = b.e + 1; x < h; x++) if (!allowed.has(x)) join = false; }
      if (join) { b.e = h; b.n++; } else blocks.push({ s: h, e: h, n: 1 });
    });
    const bk = blocks.reduce((a, b) => b.n > a.n ? b : a);
    return { start: pad2(bk.s) + ':00', end: pad2(bk.e + 1) + ':00', brk: legalBreak(bk.e + 1 - bk.s) };
  };
  const capH2 = h => R.fill === 'min' ? rule(h).min : R.fill === 'mid' ? Math.ceil((rule(h).min + rule(h).max) / 2) : rule(h).max;
  const workerCap = k => {   // その日に出勤する人数の目安（全員を入れず、公平に回すための上限）
    const dr0 = dayRuleOf(k);
    if (dr0) return R.fill === 'min' ? dr0.min : dr0.max == null ? null : R.fill === 'max' ? dr0.max : Math.ceil((dr0.min + dr0.max) / 2);
    return R.fill === 'max' ? null : Math.max(1, Math.ceil(H.reduce((n, h) => n + capH2(h), 0) / 6));   // 人数ルールがないときは、必要な時間数から見積もる
  };
  keys.forEach(k => {
    const seed = dayCover(k);   // 手で入れたシフトの分は、人数として数える
    let best = null, bestShort = Infinity, used = 0;
    for (let lv = 0; lv <= maxLevel; lv++) {
      const P = build(k, lv, new Set(Object.keys(dayShifts(k)))), res = solveHours(P, H, seed, workerCap(k)), sc = shortageOf(res.cnt, res.roleAt, H);
      if (sc < bestShort) { best = { P, res }; bestShort = sc; used = lv; }
      if (sc === 0) break;
    }
    if (used === 1) relaxed.soft++;
    best.P.forEach(({ s, main, sub }) => {
      const rec = recFrom(best.res.sch[s.id], new Set([...main, ...sub])); if (!rec) return;
      (state.shifts[k] = state.shifts[k] || {})[s.id] = { ...rec, auto: true }; total[s.id] += shiftHours(rec);
    });
    // 日ごとの人数ルール（最低・最高）を反映する
    const dr = dayRuleOf(k), wk = () => state.staff.filter(s => isWork(dayShifts(k)[s.id])), cov = () => { const c = dayCover(k); return shortageOf(c.cnt, c.roleAt, H); };
    if (dr) {
      if (dr.max != null && wk().length > dr.max) {   // 多いときは、自動で入れた人から、時間帯の最低人数を割らない範囲で減らす
        for (const s of wk().filter(x => dayShifts(k)[x.id].auto).sort((a, b) => (total[b.id] - total[a.id]) || (a.rating - b.rating))) {   // 勤務の多い人から減らす
          if (wk().length <= dr.max) break;
          const rec = state.shifts[k][s.id], before = cov();
          delete state.shifts[k][s.id];
          if (cov() > before) state.shifts[k][s.id] = rec; else total[s.id] -= shiftHours(rec);
        }
      }
      for (let lv = used; wk().length < dr.min && lv <= maxLevel; lv++) {   // 足りないときは、出勤できる人を足す（希望時間の中だけ）
        const cands = build(k, lv, new Set(Object.keys(dayShifts(k)))).sort((a, b) => (a.bias - b.bias) || (b.s.rating - a.s.rating));
        for (const pp of cands) {
          if (wk().length >= dr.min) break;
          const allowed = new Set([...pp.main, ...pp.sub]), hrs = [...allowed].sort((a, b) => a - b);
          const rec = recFrom(hrs.slice(0, Math.max(1, Math.min(isFinite(pp.target) ? pp.target : hrs.length, hrs.length, 12))), allowed);
          if (!rec) continue;
          (state.shifts[k] = state.shifts[k] || {})[pp.s.id] = { ...rec, auto: true }; total[pp.s.id] += shiftHours(rec);
        }
      }
    }
    if (cov() > 0 || (dr && wk().length < dr.min)) shortDays.push(k);
    // 勤務のない日は「休み」にする（希望休の日は、希望休のまま）
    state.staff.forEach(s => { if (!dayShifts(k)[s.id] && adminPref(s.id, k, pk).status !== 'off') (state.shifts[k] = state.shifts[k] || {})[s.id] = { off: true, auto: true }; });
  });
  return { shortDays, relaxed };
}
/* ========== シフト自動作成 v2：期間全体を見渡して、入れ替えながら良くしていく ==========
   1) 従来の方式で初期案を作る  2) 「人数不足・責任者・休みの連続・連勤・勤務間の時間・週の日数・公平さ・個人の上限」をまとめて点数にして、
   従業員の入れ替え・日の入れ替えを繰り返して点数を下げる（希望休・在籍・出勤できる曜日と時間・18歳未満の深夜は、最初から候補に入れない）
   3) 足りない日の理由と、相談できる人（休みを指定されている人が先、希望休の人は最後の手段）をまとめる */
let lastReport = null, a2Seed = 0;
function prng32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const strSeed = str => { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const nowMs = () => (typeof performance !== 'undefined' ? performance : Date).now();

function autoShiftsV2(p, keep, seedOffset) {
  const A = state.settings.auto2, R = state.autoRules, S = state.settings;
  const t0 = nowMs(), budget = Math.max(300, (A.secs || 2) * 1000);
  const init = autoShifts(p, keep);   // 初期案
  const keys = pKeys(p), D = keys.length, H = hoursList(), Hn = H.length, E = state.staff, N = E.length, pk = ymd(p.start);
  if (!N || !D || !Hn) return init;
  const rng = prng32(strSeed(pk + ':' + N + ':' + (seedOffset || 0))), rint = n => Math.floor(rng() * n);   // 同じ条件なら同じ案。「別の案」は番号を変える
  const lv = x => [0, 0.5, 1, 2][x] || 0, h0 = H[0];
  const W = { short: 100, dayShort: 120, over: 20, sur: R.fill === 'max' ? 0 : 1.5, lead: 40, hard: 80, int: 40, rest: 25, days: 8, fair: 8 * lv(R.fair), fairWe: 4 * lv(R.fair), income: 30,
    sub: R.sub === 'never' ? 30 : R.sub === 'always' ? 0 : 3, flex: 3, cost: [0, 0.002, 0.006, 0.015][R.wage] || 0, rate: [0, 0.1, 0.2, 0.4][R.rating] || 0 };
  const patterns = state.patterns.filter(x => x.start && x.end && x.days.length);
  const dow = keys.map(k => parseYmd(k).getDay()), isWE = dow.map(x => x === 0 || x === 6);
  const mon0 = (dow[0] + 6) % 7, wk = keys.map((_, d) => Math.floor((d + mon0) / 7)), nW = wk[D - 1] + 1, wdays = new Array(nW).fill(0); wk.forEach(w => wdays[w]++);
  const ym = keys.map(k => k.slice(0, 7)), months = [...new Set(ym)], mi = ym.map(m => months.indexOf(m)), nM = months.length;
  const rmin = H.map(h => rule(h).min), rmax = H.map(h => rule(h).max);
  const rtgt = H.map((h, i) => R.fill === 'min' ? rmin[i] : R.fill === 'max' ? rmax[i] : Math.ceil((rmin[i] + rmax[i]) / 2));
  const roleNames = state.roles.map(r => r.name), RN = roleNames.length + 1;
  const ri = E.map(s => { const i = roleNames.indexOf(s.role); return i < 0 ? RN - 1 : i; });
  const isLead = E.map(s => !!(state.roles.find(r => r.name === s.role) || {}).lead), leadMin = (A.leadMin > 0 && isLead.some(Boolean)) ? A.leadMin : 0;
  const rr = roleNames.map((n, i) => ({ i, q: state.roleRules[n] })).filter(x => x.q && (x.q.min || x.q.max != null));
  const dayRule = keys.map(k => dayRuleOf(k));

  // ---- 候補（誰が・どの日に・どの時間帯で入れるか）----
  const cands = new Array(N * D), fixedRec = new Array(N * D), fixedCand = new Array(N * D), autoOffOk = new Uint8Array(N * D), hasCand = new Uint8Array(N), weEl = new Uint8Array(N);
  const mkCand = (s, a, b, pat, subSet) => {
    const len = b - a, brk = legalBreak(len), work = len - brk / 60;
    if (work > S.limitDay + 1e-9 && !pat) return null;
    let sub = 0; for (let h = a; h < b; h++) if (subSet.has(h)) sub++;
    const rec = { start: pad2(a) + ':00', end: pad2(b) + ':00', brk }, cost = shiftCost(s, rec);
    return { a, b, len, brk, work, pat, cost, base: sub * W.sub + (patterns.length && !pat ? W.flex : 0) + Math.max(0, 4 - len) * 3 - W.rate * s.rating * work + W.cost * cost };
  };
  E.forEach((s, e) => keys.forEach((k, d) => {
    const i = e * D + d, rec = dayShifts(k)[s.id], fx = rec && !rec.auto ? rec : null, pref = adminPref(s.id, k, pk), emp = employedOn(s, k);
    fixedRec[i] = fx; autoOffOk[i] = (emp && pref.status !== 'off') ? 1 : 0; cands[i] = [];
    if (fx) { if (isWork(fx)) { const a = Math.floor(tmin(fx.start) / 60), b = Math.ceil(tmin(fx.end) / 60); fixedCand[i] = mkCand(s, a, b, true, new Set()) || { a, b, len: b - a, brk: fx.brk || 0, work: shiftHours(fx), pat: true, cost: shiftCost(s, fx), base: 0 }; fixedCand[i].base = 0; } return; }
    if (!emp || pref.status === 'off') return;
    let main = mainHours(s, k).filter(h => H.includes(h)), sub = subHours(s, k).filter(h => H.includes(h));
    if (pref.status === 'time') { const lo = toH(pref.start), hi = toH(pref.end, true); main = main.filter(h => h >= lo && h < hi); sub = sub.filter(h => h >= lo && h < hi); }
    if (isMinor(s, k)) { main = main.filter(h => !nightLegal(h)); sub = sub.filter(h => !nightLegal(h)); }
    const subSet = new Set(sub), U = [...new Set([...main, ...sub])].sort((x, y) => x - y), Uset = new Set(U), seen = new Set();
    let list = [];
    const add = (a, b, pat) => { const key = a * 100 + b; if (seen.has(key)) return; seen.add(key); const c = mkCand(s, a, b, pat, subSet); if (c) list.push(c); };
    patterns.forEach(x => { if (!x.days.includes(dow[d])) return; const a = toH(x.start), b = toH(x.end, true); let ok = b > a; for (let h = a; h < b && ok; h++) if (!Uset.has(h)) ok = false; if (ok) add(a, b, true); });
    if (!patterns.length || A.flex) {
      for (let x = 0; x < U.length;) {   // つながった時間のかたまりごとに、いろいろな長さ・開始時刻の候補を作る
        let y = x; while (y + 1 < U.length && U[y + 1] === U[y] + 1) y++;
        const bs = U[x], be = U[y], B = be - bs + 1;
        if (B >= 2) for (let len = Math.min(B, 3); len <= Math.min(B, 10); len++) for (let st = bs; st + len - 1 <= be; st++) add(st, st + len, false);
        x = y + 1;
      }
    }
    if (list.length > 60) { const pats = list.filter(c => c.pat), free = list.filter(c => !c.pat); for (let j = free.length - 1; j > 0; j--) { const r = rint(j + 1); [free[j], free[r]] = [free[r], free[j]]; } list = pats.concat(free.slice(0, 60 - pats.length)); }
    cands[i] = list; if (list.length) { hasCand[e] = 1; if (isWE[d]) weEl[e] = 1; }
  }));

  // ---- 状態 ----
  const cur = new Int32Array(N * D).fill(-1), cov = new Int16Array(D * Hn), lcov = new Int16Array(D * Hn), rcov = new Int16Array(D * Hn * RN);
  const workers = new Int16Array(D), days = new Int16Array(N), we = new Int16Array(N);
  E.forEach((s, e) => keys.forEach((k, d) => {   // 初期案を、候補に対応づける
    const i = e * D + d, rec = dayShifts(k)[s.id]; if (fixedRec[i] || !isWork(rec)) return;
    const a = Math.floor(tmin(rec.start) / 60), b = Math.ceil(tmin(rec.end) / 60);
    let ci = cands[i].findIndex(c => c.a === a && c.b === b);
    if (ci < 0) { const c = mkCand(s, a, b, false, new Set()) || { a, b, len: b - a, brk: rec.brk || 0, work: shiftHours(rec), pat: false, cost: shiftCost(s, rec), base: 0 }; cands[i].push(c); ci = cands[i].length - 1; hasCand[e] = 1; }
    cur[i] = ci;
  }));
  const candAt = (e, d) => { const i = e * D + d; return fixedCand[i] || (cur[i] >= 0 ? cands[i][cur[i]] : null); };
  const addC = (e, d, c, sg) => {
    for (let h = c.a; h < c.b; h++) { const q = d * Hn + (h - h0); if (h - h0 < 0 || h - h0 >= Hn) continue; cov[q] += sg; if (isLead[e]) lcov[q] += sg; rcov[q * RN + ri[e]] += sg; }
    workers[d] += sg; days[e] += sg; if (isWE[d]) we[e] += sg;
  };
  const setCell = (e, d, idx) => { const i = e * D + d, old = cur[i]; if (old >= 0) addC(e, d, cands[i][old], -1); cur[i] = idx; if (idx >= 0) addC(e, d, cands[i][idx], 1); };
  const rebuild = () => { cov.fill(0); lcov.fill(0); rcov.fill(0); workers.fill(0); days.fill(0); we.fill(0); for (let e = 0; e < N; e++) for (let d = 0; d < D; d++) { const c = candAt(e, d); if (c) addC(e, d, c, 1); } };

  // ---- 期間の外にある勤務（週・月・連勤・勤務間の時間の計算に使う）----
  const keySet = new Set(keys), outH = new Float64Array(N * nW), outD = new Int16Array(N * nW), baseInc = new Float64Array(N * nM), preRun = new Int16Array(N), preEnd = new Int16Array(N).fill(-1);
  const first = parseYmd(keys[0]);
  Object.keys(state.shifts).forEach(dt => {
    if (keySet.has(dt)) return;
    const off = Math.round((parseYmd(dt) - first) / 864e5) + mon0, w = Math.floor(off / 7), m = months.indexOf(dt.slice(0, 7));
    E.forEach((s, e) => { const sh = state.shifts[dt][s.id]; if (!isWork(sh)) return; if (off >= 0 && w < nW) { outH[e * nW + w] += shiftHours(sh); outD[e * nW + w]++; } if (m >= 0) baseInc[e * nM + m] += shiftCost(s, sh); });
  });
  E.forEach((s, e) => { for (let i = 1; i <= S.maxStreak + 1; i++) { const sh = dayShifts(ymd(addDays(first, -i)))[s.id]; if (isWork(sh)) { preRun[e]++; if (i === 1) preEnd[e] = Math.ceil(tmin(sh.end) / 60); } else break; } });
  const dlo = new Float64Array(N), dhi = new Float64Array(N), midT = new Float64Array(N), cap = new Float64Array(N), wLim = new Float64Array(N);
  E.forEach((s, e) => { const dp = s.dpw || A.dpw; const any = hasCand[e] || keys.some((k, d) => fixedCand[e * D + d]); dlo[e] = any ? dp.min : 0; dhi[e] = any ? dp.max : 0; midT[e] = (dlo[e] + dhi[e]) / 2 * D / 7; cap[e] = s.incomeCap ? toDisp(s.incomeCap, 'JPY') : 0; wLim[e] = Math.min(S.limitWeek, s.weeklyMax || Infinity); });

  // ---- 点数（低いほど良い）----
  const dayCost = d => {
    let c = 0; const b = d * Hn;
    for (let i = 0; i < Hn; i++) {
      const v = cov[b + i];
      if (v < rmin[i]) c += W.short * (rmin[i] - v); else { if (v > rmax[i]) c += W.over * (v - rmax[i]); if (v > rtgt[i]) c += W.sur * (v - rtgt[i]); }
      if (leadMin && lcov[b + i] < leadMin) c += W.lead * (leadMin - lcov[b + i]);
    }
    for (let j = 0; j < rr.length; j++) { const { i: r, q } = rr[j]; for (let i = 0; i < Hn; i++) { const v = rcov[(b + i) * RN + r]; if (q.min && v < q.min) c += W.short * (q.min - v); if (q.max != null && v > q.max) c += W.over * (v - q.max); } }
    const dr = dayRule[d]; if (dr) { const n = workers[d]; if (n < dr.min) c += W.dayShort * (dr.min - n); if (dr.max != null && n > dr.max) c += W.over * (n - dr.max); }
    return c;
  };
  const wCnt = new Float64Array(nW), wHr = new Float64Array(nW), inc = new Float64Array(nM);
  const empCost = e => {
    let c = 0, run = preRun[e], prevEnd = preEnd[e], autoOff = 0; wCnt.fill(0); wHr.fill(0); inc.fill(0);
    for (let d = 0; d < D; d++) {
      const cd = candAt(e, d);
      if (cd) {
        run++; if (run > S.maxStreak) c += W.hard;
        wCnt[wk[d]]++; wHr[wk[d]] += cd.work; inc[mi[d]] += cd.cost; c += cd.base;
        if (prevEnd >= 0) { const gap = 24 - prevEnd + cd.a; if (gap < A.interval) c += W.int * (A.interval - gap); }
        prevEnd = cd.b; if (autoOff > A.restMax) c += W.rest * (autoOff - A.restMax); autoOff = 0;
      } else { run = 0; prevEnd = -1; if (autoOffOk[e * D + d]) autoOff++; }
    }
    if (autoOff > A.restMax) c += W.rest * (autoOff - A.restMax);
    for (let w = 0; w < nW; w++) {
      const fr = wdays[w] / 7, lo = fr === 1 ? dlo[e] : Math.floor(dlo[e] * fr), hi = fr === 1 ? dhi[e] : Math.ceil(dhi[e] * fr), td = wCnt[w] + outD[e * nW + w], th = wHr[w] + outH[e * nW + w];
      if (td < lo) c += W.days * (lo - td); else if (td > hi) c += W.days * (td - hi);
      if (th > wLim[e]) c += W.hard * (th - wLim[e]);
    }
    if (cap[e]) for (let m = 0; m < nM; m++) { const t = inc[m] + baseInc[e * nM + m]; if (t > cap[e]) c += W.income * (t - cap[e]) / 1000; }
    return c;
  };
  const fairCost = () => {
    if (!W.fair) return 0;
    let sD = 0, sM = 0, c = 0; for (let e = 0; e < N; e++) { sD += days[e]; sM += midT[e]; }
    if (sM > 0) { const avg = sD / sM; for (let e = 0; e < N; e++) if (midT[e] > 0) { const dv = days[e] - avg * midT[e]; c += W.fair * dv * dv / midT[e]; } }
    let sw = 0, ne = 0; for (let e = 0; e < N; e++) if (weEl[e]) { sw += we[e]; ne++; }
    if (ne) { const a = sw / ne; for (let e = 0; e < N; e++) if (weEl[e]) { const dv = we[e] - a; c += W.fairWe * dv * dv; } }
    return c;
  };

  // ---- 入れ替えを繰り返す ----
  rebuild();
  const dayC = new Float64Array(D), empC = new Float64Array(N); let fairC = 0, total = 0;
  const recompute = () => { total = 0; for (let d = 0; d < D; d++) { dayC[d] = dayCost(d); total += dayC[d]; } for (let e = 0; e < N; e++) { empC[e] = empCost(e); total += empC[e]; } fairC = fairCost(); total += fairC; };
  recompute(); const startCost = total;
  const attempt = (chs, T, probe) => {
    const ds = [], es = []; chs.forEach(([e, d]) => { if (!ds.includes(d)) ds.push(d); if (!es.includes(e)) es.push(e); });
    let before = fairC; ds.forEach(d => { before += dayC[d]; }); es.forEach(e => { before += empC[e]; });
    const olds = chs.map(([e, d]) => cur[e * D + d]);
    chs.forEach(([e, d, idx]) => setCell(e, d, idx));
    const nf = fairCost(), nd = ds.map(d => dayCost(d)), ne = es.map(e => empCost(e));
    let after = nf; nd.forEach(x => { after += x; }); ne.forEach(x => { after += x; });
    const delta = after - before;
    if (!probe && (delta <= 0 || rng() < Math.exp(-delta / T))) { ds.forEach((d, j) => { dayC[d] = nd[j]; }); es.forEach((e, j) => { empC[e] = ne[j]; }); fairC = nf; total += delta; return true; }
    for (let j = chs.length - 1; j >= 0; j--) setCell(chs[j][0], chs[j][1], olds[j]);
    return probe ? delta : false;
  };
  const randCell = () => { for (let t = 0; t < 10; t++) { const e = rint(N), d = rint(D), i = e * D + d; if (cands[i].length) return [e, d]; } return null; };
  const shortHours = d => { const o = [], b = d * Hn; for (let i = 0; i < Hn; i++) if (cov[b + i] < rmin[i] || (leadMin && lcov[b + i] < leadMin)) o.push(i); return o; };
  let shortDaysList = [], iters = 0, best = total; const bestCur = Int32Array.from(cur);
  const tOpt = nowMs(), remain = Math.max(100, budget - (tOpt - t0));
  while (true) {
    if ((iters & 127) === 0) {
      const el = nowMs() - tOpt; if (el >= remain) break;
      if ((iters & 255) === 0) { shortDaysList = []; for (let d = 0; d < D; d++) if (dayC[d] > 0 && (shortHours(d).length || (dayRule[d] && workers[d] < dayRule[d].min))) shortDaysList.push(d); }
      var T = 30 * Math.pow(0.5 / 30, el / remain);
    }
    iters++;
    const r = rng(); let done = false;
    if (r < 0.4 && shortDaysList.length) {   // 人数が足りない日に、入れる人を足す
      const d = shortDaysList[rint(shortDaysList.length)], hs = shortHours(d), hh2 = hs.length ? hs[rint(hs.length)] + h0 : null, s0 = rint(N);
      for (let t = 0; t < N && !done; t++) {
        const e = (s0 + t) % N, i = e * D + d; if (fixedRec[i] || cur[i] >= 0 || !cands[i].length) continue;
        const ok = []; cands[i].forEach((c, ci) => { if (hh2 === null || (hh2 >= c.a && hh2 < c.b)) ok.push(ci); });
        if (ok.length) { attempt([[e, d, ok[rint(ok.length)]]], T); done = true; }
      }
    }
    if (done) continue;
    if (r < 0.6) { const x = randCell(); if (x) { const i = x[0] * D + x[1]; attempt([[x[0], x[1], rint(cands[i].length + 1) - 1]], T); } }
    else if (r < 0.8) {   // その日の中で、働く人と休みの人を入れ替える
      const d = rint(D), a = [], b = []; for (let e = 0; e < N; e++) { const i = e * D + d; if (fixedRec[i]) continue; if (cur[i] >= 0) a.push(e); else if (cands[i].length) b.push(e); }
      if (a.length && b.length) { const e1 = a[rint(a.length)], e2 = b[rint(b.length)], c1 = cands[e1 * D + d][cur[e1 * D + d]]; const l2 = cands[e2 * D + d]; let ci = l2.findIndex(c => c.a === c1.a && c.b === c1.b); if (ci < 0) ci = rint(l2.length); attempt([[e1, d, -1], [e2, d, ci]], T); }
    } else {   // 同じ人の勤務を、別の日に動かす（休みの連続をほぐす）
      const e = rint(N), a = [], b = []; for (let d = 0; d < D; d++) { const i = e * D + d; if (fixedRec[i]) continue; if (cur[i] >= 0) a.push(d); else if (cands[i].length) b.push(d); }
      if (a.length && b.length) { const d1 = a[rint(a.length)], d2 = b[rint(b.length)], c1 = cands[e * D + d1][cur[e * D + d1]], l2 = cands[e * D + d2]; let ci = l2.findIndex(c => c.a === c1.a && c.b === c1.b); if (ci < 0) ci = rint(l2.length); attempt([[e, d1, -1], [e, d2, ci]], T); }
    }
    if ((iters & 511) === 0 && total < best - 1e-6) { best = total; bestCur.set(cur); }
  }
  if (best < total - 1e-6) { cur.set(bestCur); rebuild(); recompute(); }

  // ---- 結果を書きこむ ----
  keys.forEach((k, d) => {
    E.forEach((s, e) => {
      const i = e * D + d; if (fixedRec[i]) return;
      if (state.shifts[k]) delete state.shifts[k][s.id];
      if (cur[i] >= 0) { const c = cands[i][cur[i]]; (state.shifts[k] = state.shifts[k] || {})[s.id] = { start: pad2(c.a) + ':00', end: pad2(c.b) + ':00', brk: c.brk, auto: true }; }
      else if (autoOffOk[i]) (state.shifts[k] = state.shifts[k] || {})[s.id] = { off: true, auto: true };
    });
    if (state.shifts[k] && !Object.keys(state.shifts[k]).length) delete state.shifts[k];
  });

  // ---- 結果のまとめ（足りない日・理由・相談できる人・公平さ）----
  const shortages = [];
  keys.forEach((k, d) => {
    const hrs = [], b = d * Hn; for (let i = 0; i < Hn; i++) if (cov[b + i] < rmin[i]) hrs.push({ h: H[i], need: rmin[i], have: cov[b + i] });
    const dr = dayRule[d], dayShort = dr && workers[d] < dr.min ? dr.min - workers[d] : 0;
    let leadShort = 0; if (leadMin) for (let i = 0; i < Hn; i++) if (lcov[b + i] < leadMin) leadShort++;
    if (hrs.length || dayShort || leadShort) shortages.push({ k, d, hrs, dayShort, leadShort });
  });
  shortages.sort((x, y) => (y.hrs.length + y.dayShort * 3) - (x.hrs.length + x.dayShort * 3));
  shortages.slice(0, 12).forEach(sd => {
    const { d, hrs } = sd, k = keys[d], items = [], last = [];
    E.forEach((s, e) => {
      const i = e * D + d, pref = adminPref(s.id, k, pk);
      if (fixedRec[i] || cur[i] >= 0) return;
      if (cands[i].length) {   // 休みの指定になっている人（自動の休み）：入れたときに、いちばん影響が小さい候補
        let bestC = null, bestD = Infinity;
        cands[i].forEach((c, ci) => { if (hrs.length && !hrs.some(x => x.h >= c.a && x.h < c.b)) return; const dl = attempt([[e, d, ci]], 1, true); if (dl < bestD) { bestD = dl; bestC = c; } });
        if (bestC) items.push({ id: s.id, name: s.name, a: bestC.a, b: bestC.b, delta: bestD });
      } else if (pref.status === 'off' && employedOn(s, k)) {   // 希望休の人：最後の手段
        const hs = mainHours(s, k).concat(subHours(s, k)).filter(h => H.includes(h)); const want = hrs.length ? hrs[0].h : hs[0];
        if (hs.includes(want)) { let a = want, b = want + 1; while (hs.includes(a - 1) && b - a < S.limitDay) a--; while (hs.includes(b) && b - a < S.limitDay) b++; last.push({ id: s.id, name: s.name, a, b }); }
      }
    });
    items.sort((x, y) => x.delta - y.delta); sd.cands = items.slice(0, 5); sd.last = last.slice(0, 5);
    sd.avail = E.filter((s, e) => cands[e * D + d].length).length;
  });
  const fair = E.map((s, e) => {
    let hrs = 0, run = 0, maxRun = 0, subH = 0; for (let d = 0; d < D; d++) { const c = candAt(e, d); if (c) { hrs += c.work; run = 0; } else if (autoOffOk[e * D + d] && !fixedRec[e * D + d]) { run++; maxRun = Math.max(maxRun, run); } else if (!autoOffOk[e * D + d]) { /* 希望休・在籍外 */ } }
    return { id: s.id, name: s.name, role: s.role, days: days[e], hours: hrs, we: we[e], lo: dlo[e], hi: dhi[e], maxOff: maxRun, weeks: D / 7 };
  });
  let streakV = 0, intV = 0, restV = 0, flexN = 0, patN = 0, subN = 0;
  E.forEach((s, e) => {
    let run = preRun[e], prevEnd = preEnd[e], auto = 0;
    for (let d = 0; d < D; d++) { const c = candAt(e, d);
      if (c) { run++; if (run > S.maxStreak) streakV++; if (prevEnd >= 0 && 24 - prevEnd + c.a < A.interval) intV++; prevEnd = c.b; if (auto > A.restMax) restV++; auto = 0; if (!fixedRec[e * D + d]) { if (patterns.length) { if (c.pat) patN++; else flexN++; } } }
      else { run = 0; prevEnd = -1; if (autoOffOk[e * D + d]) auto++; } }
    if (auto > A.restMax) restV++;
  });
  lastReport = { at: Date.now(), label: pLabel(p), pk, ms: Math.round(nowMs() - t0), iters, startCost: Math.round(startCost), endCost: Math.round(total), shortages, fair, streakV, intV, restV, flexN, patN, leadMin, patterns: patterns.length, restMax: A.restMax, interval: A.interval };
  const shortDays = shortages.map(x => x.k);
  return { shortDays, relaxed: init.relaxed, report: lastReport };
}

$('#wCloseNow').addEventListener('click', async () => {
  const pk = ymd(aP.start);
  if (state.closed[pk]) { delete state.closed[pk]; save(); renderShift(); return ui.toast('希望の受付を再開しました'); }
  if (!await ui.ask(`${pLabel(aP)} の希望シフトの提出を、今すぐ締め切ります。従業員は提出・変更ができなくなります（あとで再開できます）。`, { ok: '締め切る', danger: true })) return;
  state.closed[pk] = true; save(); renderShift(); ui.toast('希望の受付を締め切りました');
});
$('#wAuto').addEventListener('click', async () => {
  const pk = ymd(aP.start);
  if (isPublished()) return lockedMsg();
  if (!state.staff.length) return ui.toast('先に従業員を登録してください', 'err');
  const unsub = state.staff.filter(s => !subOf(s.id, pk)).map(s => s.name);
  const keep = $('#wKeep').checked, any = pKeys(aP).some(hasShifts);
  const msg = `${pLabel(aP)} のシフトを自動作成します。` + (any ? (keep ? '\n手で入れたシフトと休みは残し、ほかを作り直します。' : '\n今のシフト（休みの指定を含む）は、すべて作り直されます。') : '') +
    (unsub.length ? `\n\n希望が未提出の人：${unsub.join('、')}\n（希望休なし・出勤可能として扱います）` : '') + `\n\nルール：${ruleLabel()}`;
  if (!await ui.ask(msg, { ok: '自動作成する' })) return;
  let res; try { res = autoShiftsV2(aP, keep, 0); } catch (err) { console.error(err); res = autoShifts(aP, keep); ui.toast('新しい自動作成でエラーが出たため、従来の方式で作りました', 'warn'); }
  const { shortDays, relaxed } = res; save(); renderShift();
  const notes = [];
  if (res.report) notes.push(`（${(res.report.ms / 1000).toFixed(1)}秒）`);
  if (shortDays.length) notes.push(`それでも最低人数に届かない日：${shortDays.slice(0, 4).map(mdText).join('、')}${shortDays.length > 4 ? `…ほか${shortDays.length - 4}日` : ''}`);
  ui.toast(`シフトを自動作成しました（${ruleLabel()}）。希望休と希望時間の外には入れていません。` + (notes.join('') || '必要なマスを調整してください'), shortDays.length ? 'warn' : '');
  if (shortDays.length && res.report) openReport();   // 足りない日があれば、理由と相談できる人を見せる
});

/* ---- 作成結果のレポート ---- */
function openReport() { renderReport(); $('#arModal').hidden = false; }
function renderReport() {
  const r = lastReport, box = $('#arBody');
  if (!r) { box.innerHTML = '<p class="meta">まだ自動作成していません。</p>'; return; }
  const bad = r.shortages.length, dn = k => { const d = parseYmd(k); return `${d.getMonth() + 1}/${d.getDate()}（${DOW[d.getDay()]}）`; };
  let html = `<div class="sum${bad ? ' bad' : ''}"><b>${esc(r.label)}</b>　計算 ${(r.ms / 1000).toFixed(1)}秒（${r.iters.toLocaleString()}回の入れ替え）<br>` +
    (bad ? `⚠ 人数が足りない日が${bad}日あります。` : '✓ 人数が足りない日はありません。') + `<br>連勤の上限超え ${r.streakV}件 ／ 勤務の間の時間が足りない ${r.intV}件 ／ 自動の休みの連続（${r.restMax}日超え）${r.restV}件` +
    (r.patterns ? ` ／ 型に合わせた勤務 ${r.patN}件・型に合わない勤務 ${r.flexN}件` : '') + '</div>';
  if (bad) {
    html += '<h3>人数が足りない日（理由と、相談できる人）</h3>';
    r.shortages.slice(0, 12).forEach(sd => {
      const why = [sd.hrs.length ? '足りない時間帯：' + sd.hrs.slice(0, 6).map(x => `${x.h}時台（${x.have}/${x.need}人）`).join('、') + (sd.hrs.length > 6 ? '…' : '') : '', sd.dayShort ? `1日の人数があと${sd.dayShort}人` : '', sd.leadShort ? `責任者がいない時間が${sd.leadShort}時間` : ''].filter(Boolean).join(' ／ ');
      html += `<div class="arday"><b>${dn(sd.k)}</b>　${esc(why)}<div class="meta">この日に出勤できる従業員（休みの指定の人）：${sd.avail ?? 0}人</div>`;
      html += sd.cands && sd.cands.length ? '<div class="cands"><span class="meta">まず相談する人（休みの指定になっている人。影響が小さい順）</span>' + sd.cands.map(c => `<div class="cand"><b>${esc(c.name)}</b> ${c.a}:00–${c.b}:00 <span class="meta">影響 ${c.delta >= 0 ? '+' : ''}${Math.round(c.delta)}点</span> <button type="button" class="btn small" data-ar="${c.id}|${sd.k}|${c.a}|${c.b}">この人に入れる</button></div>`).join('') + '</div>' : '<div class="meta">この日に出られる人が、ほかにいません。</div>';
      if (sd.last && sd.last.length) html += '<div class="last">最後の手段（希望休の人。原則はお願いしません）：' + sd.last.map(c => `${esc(c.name)} ${c.a}:00–${c.b}:00 <button type="button" class="btn small" data-ar="${c.id}|${sd.k}|${c.a}|${c.b}">確認して入れる</button>`).join('　') + '</div>';
      html += '</div>';
    });
    if (bad > 12) html += `<p class="meta">…ほか${bad - 12}日</p>`;
  }
  html += '<h3>従業員ごとの出勤日数と、休みの連続</h3><div class="tscroll"><table><thead><tr><th>従業員</th><th>出勤日数</th><th>希望（週）</th><th>実働時間</th><th>週末</th><th>自動の休みの最大連続</th></tr></thead><tbody>' +
    r.fair.map(f => `<tr><td>${esc(f.name)}</td><td>${f.days}日</td><td>${f.lo}〜${f.hi}日 → 期間の目安 ${Math.round(f.lo * f.weeks)}〜${Math.round(f.hi * f.weeks)}日</td><td>${fh(f.hours)}時間</td><td>${f.we}日</td><td${f.maxOff > r.restMax ? ' class="warnText"' : ''}>${f.maxOff}日</td></tr>`).join('') + '</tbody></table></div>';
  box.innerHTML = html;
}
$('#wReport').addEventListener('click', openReport);
$('#arClose').addEventListener('click', () => { $('#arModal').hidden = true; });
$('#arModal').addEventListener('click', async e => {
  if (e.target === $('#arModal')) { $('#arModal').hidden = true; return; }
  const v = e.target.dataset.ar; if (!v) return;
  const [id, k, a, b] = v.split('|'); $('#arModal').hidden = true;
  await activateCell(id, k); if (!shiftEl.hidden) { setT('sStart', pad2(+a) + ':00'); setT('sEnd', pad2(+b) + ':00'); setBreak(legalBreak(+b - +a)); updateShiftInfo(); }
});
$('#arRetry').addEventListener('click', () => {
  if (isPublished()) return lockedMsg();
  const res = autoShiftsV2(aP, $('#wKeep').checked, ++a2Seed); save(); $('#arModal').hidden = true; renderShift(); openReport();
  ui.toast(`別の案で作り直しました（足りない日：${res.shortDays.length}日）`, res.shortDays.length ? 'warn' : '');
});

/* ---- マスの編集ダイアログ ---- */
let editShift = null;
const shiftEl = $('#shiftModal');
const closeShift = () => { shiftEl.hidden = true; editShift = null; };
function updateShiftInfo() {
  const a = getT('sStart'), b = getT('sEnd'), brk = +$('#sBreak').value, el = $('#sInfo');
  if (!a || !b || tmin(b) <= tmin(a) || !editShift) { el.textContent = ''; return; }
  const hrs = Math.max(0, (tmin(b) - tmin(a) - brk) / 60), s = state.staff.find(x => x.id === editShift.id);
  el.textContent = `実働 ${fh(hrs)}時間` + `・${money(shiftCost(s, { start: a, end: b, brk }))}${overlapMin({ start: a, end: b }, nightPay) ? `（うち深夜${fh(overlapMin({ start: a, end: b }, nightPay) / 60)}時間）` : ''}` +
    (hrs > state.settings.limitDay ? `　⚠ 1日の注意ライン（${state.settings.limitDay}時間）を超えています` : '');
  const need = legalBreak((tmin(b) - tmin(a)) / 60);
  if (brk < need) el.textContent += `　※法定の休憩（${need}分）が必要なため、保存すると自動で入ります`;
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
  $('#sHint').textContent = `出勤できる曜日・時間：${availText(s)}` + (cur && cur.off ? '　【今は「休み」に指定中】' : '');
  $('#sPref').textContent = '本人の希望：' + prefText(pref);
  $('#sFillSub').hidden = !slotFor(s, date, 'sub');
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
const slotFor = (s, date, kind) => (s.avail || []).find(x => (kind === 'sub' ? x.kind === 'sub' : x.kind !== 'sub') && slotDays(x).includes(parseYmd(date).getDay()));
$('#sFillMain').addEventListener('click', () => { const s = state.staff.find(x => x.id === editShift.id), sl = slotFor(s, editShift.date, 'main'); if (!sl) return ui.toast('この曜日に出勤できる時間が登録されていません', 'warn'); fillShift(sl.start, sl.end); });
$('#sFillSub').addEventListener('click', () => { const s = state.staff.find(x => x.id === editShift.id), sl = slotFor(s, editShift.date, 'sub'); if (sl) fillShift(sl.start, sl.end); });
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
$('#sSave').addEventListener('click', async () => {
  const a = getT('sStart'), b = getT('sEnd'); let brk = +$('#sBreak').value;
  if (a === null || b === null) return ui.toast('時刻の形式が正しくありません。9:00 や 0900 のように入力してください', 'err');
  if (!a || !b) return ui.toast('出勤と退勤の時間を入れてください', 'err');
  if (tmin(b) <= tmin(a)) return ui.toast('退勤は出勤より後にしてください', 'err');
  if (brk >= tmin(b) - tmin(a)) return ui.toast('休憩が勤務時間より長くなっています', 'err');
  const stf = state.staff.find(x => x.id === editShift.id);
  if (conflictOf({ start: a, end: b }, adminPref(editShift.id, editShift.date, pkOf(editShift.date)), stf, editShift.date) === 'out' &&
      !await ui.ask(`${stf.name}さんの希望時間の外です。\n原則として、希望時間の外にはシフトを入れません。それでも保存しますか？`, { ok: 'それでも保存', danger: true })) return;
  if (isMinor(stf, editShift.date) && overlapMin({ start: a, end: b }, nightLegal) > 0 &&
      !await ui.ask(`${stf.name}さんは18歳未満です。\n原則として、22時〜翌5時には働けません。それでも保存しますか？`, { ok: 'それでも保存', danger: true })) return;
  if (editShift && !employedOn(stf, editShift.date) &&
      !await ui.ask(`${stf.name}さんは、この日は入社前（または退職後）です。それでも保存しますか？`, { ok: 'それでも保存', danger: true })) return;
  if (!editShift) return;
  const need = legalBreak((tmin(b) - tmin(a)) / 60), bumped = brk < need;   // 法定の最低休憩に足りなければ、自動で入れる
  if (bumped) brk = need;
  const { id, date } = editShift, pref = adminPref(id, date, pkOf(date));
  (state.shifts[date] = state.shifts[date] || {})[id] = { start: a, end: b, brk };
  save(); closeShift(); renderShift();
  const cf = conflictOf({ start: a, end: b }, pref, stf, date), note = cf === 'req' ? '（希望休の日です）' : cf === 'out' ? '（希望の時間外です）' : '';
  ui.toast('シフトを保存しました' + note + (bumped ? `（法定の休憩${need}分を入れました）` : ''), note ? 'warn' : '');
});

/* ========== 従業員画面（仮：従業員を選んで操作） ========== */
let empId = null, brush = 'off', eTab = 'req';

function renderEmployee() {
  const sel = $('#eWho');
  sel.innerHTML = state.staff.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  if (me && me.role === 'employee') empId = state.staff.some(s => s.id === me.staffId) ? me.staffId : null;   // 従業員は自分の分だけ
  else if (!state.staff.some(s => s.id === empId)) empId = state.staff[0] ? state.staff[0].id : null;
  sel.value = empId || '';
  $('#eNone').hidden = !!empId; $('#eBody').hidden = !empId;
  document.querySelectorAll('.etab').forEach(b => b.classList.toggle('active', b.dataset.etab === eTab));
  if (!empId) return;
  $('#eReq').hidden = eTab !== 'req'; $('#eRules').hidden = eTab !== 'rules';
  renderBrush(); renderEmpCal(); renderEmpRules(); renderEmpPw(); renderReqCard();
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

/* 業態ごとの階級（役割）と、従業員の傾向。店長（boss）は基本的に1人だけ */
const INDUSTRIES = {
  restaurant: { label: '飲食店', open: 10, close: 24, demand: [[10, 11, 2], [11, 14, 5], [14, 17, 3], [17, 21, 6], [21, 23, 3], [23, 24, 2]], wk: 1.3, roles: [
    { name: '店長', color: '#a23b5a', boss: true, max: 1, w: 0, rating: [4, 5], wage: [1800, 2400], len: [8, 10], win: 'any' },
    { name: '副店長', color: '#6b5b95', max: 2, w: 1, rating: [4, 5], wage: [1500, 1900], len: [8, 9], win: 'any' },
    { name: 'ホールリーダー', color: '#3b6fb6', max: 2, w: 1, rating: [3, 5], wage: [1250, 1500], len: [6, 8], win: 'any' },
    { name: 'キッチンリーダー', color: '#b45f06', max: 2, w: 1, rating: [3, 5], wage: [1300, 1600], len: [6, 8], win: 'any' },
    { name: 'ホール', color: '#0f6e6e', w: 6, rating: [2, 4], wage: [1050, 1250], len: [4, 7], win: 'any' },
    { name: 'キッチン', color: '#8a6d1d', w: 5, rating: [2, 4], wage: [1100, 1300], len: [4, 8], win: 'any' },
    { name: '洗い場', color: '#5b7a2f', w: 2, rating: [1, 3], wage: [1000, 1150], len: [3, 5], win: 'late' }] },
  convenience: { label: 'コンビニ', open: 6, close: 28, demand: [[6, 9, 3], [9, 17, 2], [17, 20, 3], [20, 28, 2]], wk: 1.1, roles: [
    { name: '店長', color: '#a23b5a', boss: true, max: 1, w: 0, rating: [4, 5], wage: [1800, 2300], len: [8, 10], win: 'early' },
    { name: '副店長', color: '#6b5b95', max: 2, w: 1, rating: [4, 5], wage: [1500, 1800], len: [8, 9], win: 'any' },
    { name: '日勤リーダー', color: '#3b6fb6', max: 2, w: 1, rating: [3, 5], wage: [1200, 1400], len: [6, 8], win: 'early' },
    { name: '夜勤リーダー', color: '#2f7d9a', max: 2, w: 1, rating: [3, 5], wage: [1400, 1700], len: [7, 8], win: 'night' },
    { name: '日勤スタッフ', color: '#0f6e6e', w: 6, rating: [2, 4], wage: [1050, 1200], len: [4, 8], win: 'any' },
    { name: '夜勤スタッフ', color: '#8a6d1d', w: 4, rating: [2, 4], wage: [1250, 1450], len: [6, 8], win: 'night' },
    { name: '研修中', color: '#5f6b76', w: 1, rating: [1, 2], wage: [1000, 1050], len: [3, 5], win: 'any' }] },
  supermarket: { label: 'スーパー', open: 8, close: 23, demand: [[8, 10, 3], [10, 16, 4], [16, 20, 6], [20, 23, 3]], wk: 1.3, roles: [
    { name: '店長', color: '#a23b5a', boss: true, max: 1, w: 0, rating: [4, 5], wage: [1800, 2400], len: [8, 10], win: 'any' },
    { name: '副店長', color: '#6b5b95', max: 2, w: 1, rating: [4, 5], wage: [1500, 1900], len: [8, 9], win: 'any' },
    { name: '部門チーフ', color: '#3b6fb6', max: 3, w: 1, rating: [3, 5], wage: [1300, 1600], len: [7, 9], win: 'early' },
    { name: 'レジチーフ', color: '#2f7d9a', max: 1, w: 1, rating: [3, 5], wage: [1200, 1400], len: [6, 8], win: 'any' },
    { name: 'レジ', color: '#0f6e6e', w: 6, rating: [2, 4], wage: [1050, 1200], len: [4, 7], win: 'any' },
    { name: '青果', color: '#5b7a2f', w: 3, rating: [2, 4], wage: [1050, 1250], len: [4, 7], win: 'early' },
    { name: '精肉・鮮魚', color: '#b45f06', w: 3, rating: [2, 4], wage: [1100, 1300], len: [4, 8], win: 'early' },
    { name: '惣菜', color: '#8a6d1d', w: 3, rating: [2, 4], wage: [1050, 1250], len: [4, 7], win: 'any' },
    { name: '品出し', color: '#5f6b76', w: 4, rating: [1, 3], wage: [1000, 1150], len: [3, 6], win: 'early' },
    { name: '新人研修', color: '#9a8c98', w: 1, rating: [1, 2], wage: [1000, 1050], len: [3, 5], win: 'any' }] },
  apparel: { label: 'アパレル', open: 10, close: 22, demand: [[10, 12, 2], [12, 18, 4], [18, 22, 3]], wk: 1.5, roles: [
    { name: '店長', color: '#a23b5a', boss: true, max: 1, w: 0, rating: [4, 5], wage: [1800, 2400], len: [8, 10], win: 'any' },
    { name: '副店長', color: '#6b5b95', max: 1, w: 1, rating: [4, 5], wage: [1500, 1900], len: [8, 9], win: 'any' },
    { name: '販売リーダー', color: '#3b6fb6', max: 2, w: 1, rating: [3, 5], wage: [1250, 1500], len: [6, 8], win: 'any' },
    { name: '販売スタッフ', color: '#0f6e6e', w: 7, rating: [2, 4], wage: [1100, 1300], len: [4, 8], win: 'any' },
    { name: 'レジ', color: '#2f7d9a', w: 3, rating: [2, 4], wage: [1050, 1200], len: [4, 7], win: 'any' },
    { name: 'ストック', color: '#5f6b76', w: 2, rating: [1, 3], wage: [1000, 1150], len: [3, 6], win: 'early' },
    { name: 'VMD', color: '#8a6d1d', max: 1, w: 1, rating: [3, 5], wage: [1300, 1600], len: [6, 8], win: 'early' },
    { name: '新人研修', color: '#9a8c98', w: 1, rating: [1, 2], wage: [1000, 1050], len: [3, 5], win: 'any' }] }
};
const indNote = k => { const i = INDUSTRIES[k]; return i ? `${i.label}：営業 ${i.open}:00〜${i.close}:00 ／ 階級（上が上位）：${i.roles.map(r => r.name).join(' ＞ ')} ／ 店長は1人だけ登録します。` : '今ある役割（階級）の中から、ランダムに選びます。'; };

/* 業態に合わせて、役割（階級）・営業時間を入れ替える */
function applyIndustry(ind) {
  state.roles = ind.roles.map(r => ({ name: r.name, color: r.color, lead: !!(r.boss || r.name === '副店長') }));   // 店長・副店長は責任者
  const PAT = { restaurant: [['早番', 10, 17], ['遅番', 17, 24], ['通し', 11, 21]], convenience: [['早番', 6, 14], ['日勤', 9, 17], ['遅番', 14, 22], ['夜勤', 22, 28]], supermarket: [['早番', 8, 15], ['中番', 11, 18], ['遅番', 16, 23]], apparel: [['早番', 10, 17], ['遅番', 15, 22]] };
  const key = Object.keys(INDUSTRIES).find(k => INDUSTRIES[k] === ind);
  state.patterns = (PAT[key] || []).map(([name, a, b], i) => ({ id: 'p' + Date.now() + i, name, start: hh(a), end: hh(b), days: [1, 2, 3, 4, 5, 6, 0] }));
  const names = new Set(state.roles.map(r => r.name));
  state.staff.forEach(s => { if (!names.has(s.role)) s.role = ''; });
  state.roleRules = {}; const boss = ind.roles.find(r => r.boss); if (boss) state.roleRules[boss.name] = { min: 0, max: 1 };   // 店長は同時に1人まで
  state.open = ind.open; state.close = ind.close; state.rules = {}; viewOrder = null; mDay = null;
}
/* 登録人数に合わせた、時間帯ごと・日ごとの人数ルールの目安 */
function applyIndustryRules(ctx) {
  const N = state.staff.length, r = f => Math.max(1, Math.round(N * f));
  if (ctx) {   // 必要人数（時間帯ごと）から、時間帯ごと・日ごとの人数ルールを作る
    const dem = h => demandAt(ctx.ind, h, ctx.scale), H = hoursList(), sum = H.reduce((a, h) => a + dem(h), 0), wd = Math.ceil(sum / 6.5), we = Math.ceil(sum * ctx.ind.wk / 6.5);
    state.rules = {}; H.forEach(h => { const m = dem(h); state.rules[h] = { min: m, max: Math.ceil(m * 1.5) + 1 }; });
    state.shiftRules = [{ day: 'weekday', month: 0, date: '', min: wd, max: Math.ceil(wd * 1.4) }, { day: 'weekend', month: 0, date: '', min: we, max: Math.ceil(we * 1.4) }];
    return;
  }
  hoursList().forEach(h => { state.rules[h] = { min: 1, max: Math.max(3, Math.ceil(N * 0.4)) }; });
  state.shiftRules = [
    { day: 'weekday', month: 0, date: '', min: r(0.25), max: Math.max(r(0.25) + 1, r(0.5)) },
    { day: 'weekend', month: 0, date: '', min: r(0.35), max: Math.max(r(0.35) + 1, r(0.7)) }
  ];
}

/* 時間帯ごとの必要人数（業態の目安 × 店の規模） */
const demandAt = (ind, h, scale) => { const seg = ind.demand.find(([a, b]) => h >= a && h < b); return Math.max(1, Math.round((seg ? seg[2] : 1) * scale)); };
const WD = [1, 2, 3, 4, 5], WE = [6, 0];
const frac = (days, type) => { const base = type === 'we' ? WE : WD; return days.filter(d => base.includes(d)).length / base.length; };   // その種類の曜日のうち、出勤できる割合
/* 出勤できる曜日のパターン（現実の働き方に近づける）。type：足りない曜日の種類（'wd' 平日 / 'we' 休日） */
function pickDays(type) {
  const r = Math.random(), all = [1, 2, 3, 4, 5, 6, 0];
  if (type === 'we') return r < 0.45 ? WE.slice() : r < 0.75 ? all : [...WE, ...shuffle(WD.slice()).slice(0, rnd(2, 3))];
  if (type === 'wd') return r < 0.45 ? WD.slice() : r < 0.75 ? all : shuffle(WD.slice()).slice(0, rnd(3, 4));
  return r < 0.5 ? all : r < 0.65 ? WD.slice() : r < 0.8 ? [...WE, ...shuffle(WD.slice()).slice(0, rnd(1, 3))] : shuffle(all).slice(0, rnd(3, 5));
}
/* 1人分：出勤できる曜日と時間（複数の時間帯・予備つき）、時給（多くの人は最低賃金のまま）を作る */
function buildStaff(sp, st, en, isBoss, used, idx, days) {
  const open = state.open, close = state.close, min = state.settings.minWage;
  const minor = !isBoss && sp.max == null && sp.rating[1] <= 4 && Math.random() < 0.07;   // 高校生など（18歳未満）：22時〜翌5時には出られない
  if (minor) { en = Math.min(en, 22); st = Math.max(Math.min(st, en - 4), Math.max(open, 5)); if (en - st < 3) { st = Math.max(open, 5); en = Math.min(22, st + 4); } }
  let name, tries = 0;
  do { name = pick(RND_SUR) + pick(RND_GIV); tries++; } while (used.has(name) && tries < 40);
  if (used.has(name)) name += rnd(2, 9);
  used.add(name);
  const main = DAY_ORDER.filter(d => days.includes(d)), avail = [{ days: main, start: hh(st), end: hh(en), kind: 'main' }];
  if (Math.random() < 0.35 && en < Math.min(close, minor ? 22 : close)) avail.push({ days: main.slice(), start: hh(en), end: hh(Math.min(minor ? 22 : close, en + rnd(1, 3))), kind: 'sub' });
  const rest = DAY_ORDER.filter(d => !days.includes(d));
  if (!isBoss && rest.length && Math.random() < 0.3) {   // ほかの曜日は、別の時間帯で出られる人（「＋ 追加」の例）
    const l2 = Math.min(close - open, rnd(4, 8)), s2 = minor ? rnd(Math.max(open, 5), 18) : rnd(open, close - l2);
    avail.push({ days: rest, start: hh(s2), end: hh(minor ? Math.min(22, s2 + l2) : s2 + l2), kind: 'main' });
  }
  const w = Math.round(rnd(sp.wage[0], sp.wage[1]) / 10) * 10, leader = sp.max != null;
  const type = leader ? '社員' : pick(['アルバイト', 'アルバイト', 'パート']);
  const dayMs = 864e5, now = Date.now(), birthDate = d => { const x = new Date(d); return ymd(x); };
  const birth = minor ? birthDate(now - (16 + rnd(0, 1)) * 365.25 * dayMs - rnd(0, 300) * dayMs) : (Math.random() < 0.8 ? birthDate(now - rnd(19, 55) * 365.25 * dayMs - rnd(0, 300) * dayMs) : '');
  return {
    id: 's' + Date.now() + '_r' + idx, name, role: sp.name, rating: rnd(sp.rating[0], sp.rating[1]), wage: w > min + 20 ? w : 0, cur: 'JPY',
    type, birth, avail, dpw: leader ? { min: 5, max: 5 } : minor ? { min: 1, max: 3 } : type === 'パート' ? { min: 3, max: 4 } : (Math.random() < 0.5 ? { min: 2, max: 4 } : null),
    weeklyMax: minor ? 28 : (type === 'パート' && Math.random() < 0.4) ? pick([20, 24, 28]) : 0,        // 働き方を抑えたい人（例）
    incomeCap: (!leader && !minor && Math.random() < 0.15) ? pick([88000, 108000]) : 0,
    join: Math.random() < 0.04 ? ymd(new Date(now + rnd(3, 14) * dayMs)) : '', leave: Math.random() < 0.03 ? ymd(new Date(now + rnd(10, 25) * dayMs)) : ''
  };
}
const addSupply = (sup, s, open, close) => (s.avail || []).filter(x => x.kind !== 'sub').forEach(x => {
  for (let h = toH(x.start); h < toH(x.end, true); h++) ['wd', 'we'].forEach(t => { if (sup[t][h] !== undefined) sup[t][h] += frac(slotDays(x), t); });
});
/* 企業が「各時間帯の必要人数が足りるように採用する」イメージ：平日・休日それぞれで足りない時間帯を見つけて、そこに出勤できる人を足していく。
   従業員は、出勤できる日の約64%（週4.5日ぶん）しか出勤しない想定で、必要人数の約1.56倍（× 余裕）の人が出勤できるまで採用する */
function randomStaffDemand(indKey, scale, margin) {
  const ind = INDUSTRIES[indKey], open = state.open, close = state.close, span = close - open;
  const used = new Set(state.staff.map(s => s.name)), counts = {}, out = [], sup = { wd: {}, we: {} };
  for (let h = open; h < close; h++) { sup.wd[h] = 0; sup.we[h] = 0; }
  state.staff.forEach(s => { counts[s.role] = (counts[s.role] || 0) + 1; addSupply(sup, s); });
  const need = (t, h) => Math.ceil(demandAt(ind, h, scale) * (t === 'we' ? ind.wk : 1) * 1.56 * margin);
  const specs = ind.roles, boss = specs.find(sp => sp.boss), room = x => x.w > 0 && (x.max == null || (counts[x.name] || 0) < x.max);
  for (let i = 0; i < 300; i++) {
    let worst = null;
    ['wd', 'we'].forEach(t => { for (let h = open; h < close; h++) { const gap = need(t, h) - sup[t][h]; if (gap > 0 && (!worst || gap > worst.gap)) worst = { t, h, gap }; } });
    if (!worst) break;
    const { t, h: hc } = worst;
    let sp, isBoss = false;
    if (boss && !(counts[boss.name] || 0)) { sp = boss; isBoss = true; }
    else {
      const ok = specs.filter(x => room(x) && (x.win !== 'night' || hc >= close - 9) && !(x.win === 'early' && hc > open + span * 0.65));
      const pool = ok.length ? ok : specs.filter(room);
      let r = Math.random() * pool.reduce((a, x) => a + x.w, 0); sp = pool[pool.length - 1];
      for (const x of pool) { r -= x.w; if (r <= 0) { sp = x; break; } }
    }
    counts[sp.name] = (counts[sp.name] || 0) + 1;
    const len = Math.min(span, rnd(sp.len[0], sp.len[1])), st = Math.min(close - len, Math.max(open, hc - rnd(0, len - 1)));
    const s = buildStaff(sp, st, st + len, isBoss, used, out.length, pickDays(t)); out.push(s); addSupply(sup, s);
  }
  return out;
}
/* いまの従業員で、必要人数（時間帯ごとの最低人数）を満たせそうか（平日・休日） */
function supplyReport() {
  if (!state.staff.length) return '';
  const H = hoursList(), res = {};
  ['wd', 'we'].forEach(t => {
    const sup = {}; H.forEach(h => { sup[h] = 0; }); state.staff.forEach(s => addSupply({ wd: t === 'wd' ? sup : {}, we: t === 'we' ? sup : {} }, s));
    let worst = Infinity, worstH = H[0], sum = 0; const weak = [];
    H.forEach(h => { const ratio = sup[h] * 0.64 / Math.max(1, rule(h).min); sum += ratio; if (ratio < worst) { worst = ratio; worstH = h; } if (ratio < 1) weak.push(h); });
    res[t] = { worst, worstH, avg: sum / H.length, weak };
  });
  const f = (t, n) => `${n}：最低${res[t].worst.toFixed(1)}倍（${res[t].worstH}時台）・平均${res[t].avg.toFixed(1)}倍`;
  const weak = [...res.wd.weak.map(h => '平日' + h + '時台'), ...res.we.weak.map(h => '休日' + h + '時台')];
  return `人員の充足度（出勤できる人数 × 出勤率64% ÷ 必要人数）　${f('wd', '平日')}／${f('we', '休日')}。` + (weak.length ? `⚠ ${weak.slice(0, 8).join('、')}${weak.length > 8 ? '…' : ''}は、必要人数を満たせない見込みです。` : '全時間帯で、必要人数を満たせる見込みです。');
}

/* 人数を決めて作る（業態の「必要人数から自動」をオフにしたとき） */
function randomStaff(n, indKey) {
  const ind = INDUSTRIES[indKey], open = state.open, close = state.close, span = Math.max(1, close - open), out = [];
  const GENERIC = { name: '', w: 1, rating: [1, 5], wage: [1000, 1500], len: [4, 8], win: 'any' };
  const specs = ind ? ind.roles : state.roles.map(r => ({ ...GENERIC, name: r.name }));
  const used = new Set(state.staff.map(s => s.name)), counts = {};
  state.staff.forEach(s => { counts[s.role] = (counts[s.role] || 0) + 1; });
  const pickRole = () => {
    const ok = specs.filter(sp => sp.w > 0 && (sp.max == null || (counts[sp.name] || 0) < sp.max));
    if (!ok.length) return GENERIC;
    let r = Math.random() * ok.reduce((a, sp) => a + sp.w, 0);
    for (const sp of ok) { r -= sp.w; if (r <= 0) return sp; }
    return ok[ok.length - 1];
  };
  const boss = specs.find(sp => sp.boss);
  for (let i = 0; i < n; i++) {
    const isBoss = !!boss && i === 0 && !(counts[boss.name] || 0);   // 店長は、いなければ最初の1人だけ
    const sp = isBoss ? boss : pickRole();
    counts[sp.name] = (counts[sp.name] || 0) + 1;
    const len = Math.min(span, rnd(sp.len[0], sp.len[1])), slack = Math.max(0, span - len);
    const kind = sp.win === 'any' ? ['early', 'any', 'late'][i % 3] : sp.win;   // 朝・昼・夜がばらけるようにする
    const st = open + (kind === 'early' ? rnd(0, Math.floor(slack / 3)) : kind === 'late' ? slack - rnd(0, Math.floor(slack / 3)) : kind === 'night' ? slack : rnd(0, slack));
    out.push(buildStaff(sp, st, Math.min(close, st + len), isBoss, used, i, pickDays()));
  }
  // 平日・休日のどの時間にも、出勤できる人が1人はいるようにする
  const all = [...state.staff, ...out];
  [['wd', WD], ['we', WE]].forEach(([, base]) => {
    for (let h = open; h < close; h++) {
      if (all.some(x => (x.avail || []).some(sl => sl.kind !== 'sub' && h >= toH(sl.start) && h < toH(sl.end, true) && slotDays(sl).some(d => base.includes(d))))) continue;
      const c = out.filter(x => !boss || x.role !== boss.name)[0] || out[0]; if (!c) break;
      c.avail.push({ days: base.slice(), start: hh(h), end: hh(Math.min(close, h + 4)), kind: 'main' });
    }
  });
  return out;
}

function randomPrefs(p) {
  const keys = pKeys(p), pk = ymd(p.start), open = state.open, close = state.close;
  const window_ = () => { const a = rnd(open, Math.max(open, close - 4)); return { start: hh(a), end: hh(Math.min(close, a + rnd(3, 6))) }; };
  const isWe = k => [0, 6].includes(parseYmd(k).getDay());
  const cap = Math.max(1, Math.floor(state.staff.length * 0.3)), offCount = {};   // 同じ日に希望休が集まりすぎないようにする
  state.staff.forEach(s => {
    const P = pf(s.id);
    P.dates = {}; P.rules = [];
    if (Math.random() < 0.25) P.rules.push(Math.random() < 0.7 ? { target: pick(RULE_TARGETS.slice(2))[0], status: 'off' } : { target: 'holiday', status: 'time', ...window_() });
    const offN = pick([0, 0, 1, 1, 1, 2, 2, 3, 3, 4, 5]), timeN = rnd(0, 2);
    const order = Math.random() < 0.5 ? [...shuffle(keys.filter(isWe)), ...shuffle(keys.filter(k => !isWe(k)))] : shuffle(keys.slice());   // 休みは週末ぎみ
    let off = 0;
    for (const k of order) { if (off >= offN) break; if ((offCount[k] || 0) >= cap) continue; P.dates[k] = { status: 'off' }; offCount[k] = (offCount[k] || 0) + 1; off++; }
    order.filter(k => !P.dates[k]).slice(0, timeN).forEach(k => { P.dates[k] = { status: 'time', ...window_() }; });
    delete P.submissions[pk];
    if (Math.random() < 0.9) {
      const c = pick(RND_COMMENTS);
      P.comments[pk] = c;
      P.submissions[pk] = { at: new Date(Date.now() - rnd(1, 72) * 3600e3).toISOString(), comment: c, snap: snapshotFor(s.id, keys) };
    } else P.comments[pk] = '';   // 未提出のまま
  });
}

function renderDev() {
  renderAdmins();
  $('#dLayout').value = state.settings.layout || 'auto';
  const kb = Math.round((localStorage.getItem(KEY) || '').length / 102.4) / 10;
  $('#dInfo').textContent = `従業員 ${state.staff.length}人 ／ シフトのある日 ${Object.keys(state.shifts).length}日 ／ 保存データ 約${kb}KB`;
  $('#dReport').textContent = supplyReport();
  syncDevCount();
}
function syncDevCount() { $('#dCount').disabled = $('#dAuto').checked && $('#dInd').value !== 'generic' && $('#dApply').checked; }
['dAuto', 'dInd', 'dApply'].forEach(id => $('#' + id).addEventListener('change', syncDevCount));
$('#dInd').addEventListener('change', () => { $('#dIndNote').textContent = indNote($('#dInd').value); });
$('#dIndNote').textContent = indNote('generic');
$('#dRandomStaff').addEventListener('click', async () => {
  const indKey = $('#dInd').value, ind = INDUSTRIES[indKey], apply = !!ind && $('#dApply').checked, auto = apply && $('#dAuto').checked;
  let n = Math.round(+$('#dCount').value);
  if (!auto && !(n >= 1 && n <= 50)) return ui.toast('人数は1〜50で入れてください', 'err');
  const replace = $('#dMode').value === 'replace';
  if (replace && state.staff.length && !await ui.ask(`今の従業員${state.staff.length}人と、そのシフト・希望がすべて消えます。入れ替えますか？`, { ok: '入れ替える', danger: true })) return;
  if (replace) { state.staff = []; state.work = {}; state.workMode = {}; state.shifts = {}; state.prefs = {}; state.published = {}; state.auth.users = state.auth.users.filter(u => u.role !== 'employee'); }
  if (apply) applyIndustry(ind);
  const scale = +$('#dScale').value, margin = +$('#dMargin').value;
  const made = auto ? randomStaffDemand(indKey, scale, margin) : randomStaff(n, indKey); n = made.length; state.staff.push(...made);
  if (apply) { applyIndustryRules(auto ? { ind, scale } : null); renderConditions(); renderTimeRange(); renderRoleRules(); renderShiftRules(); }
  const rows = $('#dAcct').checked ? made.map(issueFor) : [];
  save(); renderRoles(); renderGantt(); renderDev();
  ui.toast(`ランダムな従業員を${n}人登録しました${apply ? `（${ind.label}モード${auto ? '・必要人数から自動' : ''}）` : ''}`);
  if (rows.length) showCreds('従業員アカウントを発行しました', '初期パスワードは、この画面でしか確認できません。控えてから閉じてください（最初のログインで本人が変更します）。', credText(rows));
});
$('#dRandomPrefs').addEventListener('click', async () => {
  if (!state.staff.length) return ui.toast('先に従業員を登録してください', 'warn');
  const p = periodOf(new Date());
  if (!await ui.ask(`${pLabel(p)} の希望を、全員分ランダムに作り直します。今ある希望と提出は上書きされます。`, { ok: '作る' })) return;
  randomPrefs(p); save(); renderDev();
  ui.toast('希望シフトをランダムに作りました。管理者画面のシフト管理で確認できます');
});
$('#dLayout').addEventListener('change', () => { state.settings.layout = $('#dLayout').value; save(); applyLayout(); });
$('#dReset').addEventListener('click', async () => {
  if (!await ui.ask('このアプリが保存しているデータ（アカウントを含む）をすべて消して、最初の状態に戻します。元には戻せません。', { ok: 'すべて消す', danger: true })) return;
  localStorage.removeItem(KEY); endSession(); location.reload();
});

$('#pDlDays').addEventListener('change', () => {
  const n = Math.round(+$('#pDlDays').value);
  if (!(n >= 0 && n <= 60)) { ui.toast('0〜60の数を入れてください', 'err'); renderPeriodSettings(); return; }
  state.settings.deadlineDays = n; save(); ui.toast(n ? `締切の初期値を、期間の開始日の${n}日前にしました` : '締切の初期値をなしにしました');
  if (curTab === 'shift') renderShift();
});

/* ---- 管理者／従業員／開発者の表示切替（仮） ---- */
function setMode(m) {
  if (!allowedModes().includes(m)) return;
  document.body.dataset.mode = m;
  document.querySelectorAll('.mbtn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  if (m === 'employee' || m === 'dev') { document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === m)); if (m === 'employee') renderEmployee(); else renderDev(); }
  else switchTab(curTab);
}
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

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
/* 1行1人：名前, 役割, 評価, 時給（空欄なら最低賃金）, 出勤できる曜日と時間。タブ区切り（表計算ソフトからの貼り付け）またはカンマ区切り */
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
    if (!av.trim()) bad.push('出勤できる曜日と時間がありません');
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

/* ========== ログイン・アカウント ==========
   ※ この端末のブラウザの中だけで動くログインです。パスワードは「塩 ＋ 繰り返しのSHA-256」で保存しますが、
     データ自体がブラウザに入っているため、ほかの人に見られないようにする本格的な保護にはサーバーが必要です。 */
const ROLE_LABEL = { dev: '開発者', admin: '管理者', employee: '従業員' };
const ID_RE = /^[A-Za-z0-9_.-]{3,20}$/;
const SESSION_KEY = 'shiftApp.session';
const AUTH = () => state.auth;

const SHA_PRIMES = (() => { const p = []; for (let n = 2; p.length < 64; n++) if (p.every(q => n % q)) p.push(n); return p; })();
const SHA_K = SHA_PRIMES.map(n => Math.floor((Math.cbrt(n) % 1) * 4294967296));
const SHA_H0 = SHA_PRIMES.slice(0, 8).map(n => Math.floor((Math.sqrt(n) % 1) * 4294967296));
function sha256hex(msg) {
  const bytes = new TextEncoder().encode(msg), l = bytes.length, total = ((l + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(total); buf.set(bytes); buf[l] = 0x80;
  const dv = new DataView(buf.buffer); dv.setUint32(total - 8, Math.floor(l * 8 / 4294967296)); dv.setUint32(total - 4, (l * 8) >>> 0);
  const H = SHA_H0.slice(), w = new Uint32Array(64), rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      w[i] = (w[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA_K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) | 0; });
  }
  return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}
const HEX = '0123456789abcdef', PW_AL = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', CODE_AL = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randBytes = n => { const a = new Uint8Array(n); if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a); else for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256); return a; };
const randStr = (n, al) => Array.from(randBytes(n), b => al[b % al.length]).join('');
const newPw = () => randStr(10, PW_AL);
const newCode = () => randStr(16, CODE_AL).replace(/(.{4})(?=.)/g, '$1-');
const hashPw = (pw, salt) => { let h = sha256hex(salt + ':' + pw); for (let i = 0; i < 4000; i++) h = sha256hex(h + salt); return h; };

const findUser = id => AUTH().users.find(u => u.id.toLowerCase() === String(id).trim().toLowerCase());
const makeUser = o => { const salt = randStr(16, HEX); return { id: o.id, name: o.name || o.id, role: o.role, staffId: o.staffId || '', salt, hash: hashPw(o.password, salt), must: !!o.must, off: false, at: Date.now(), last: 0 }; };
const setPw = (u, pw, must) => { u.salt = randStr(16, HEX); u.hash = hashPw(pw, u.salt); u.must = !!must; };
const checkPw = (u, pw) => hashPw(pw, u.salt) === u.hash;
const staffOf = u => state.staff.find(s => s.id === u.staffId);
const displayName = u => u.role === 'employee' ? ((staffOf(u) || {}).name || u.name) : u.name;
function nextEmpId() { let n = 1; while (findUser('e' + String(n).padStart(3, '0'))) n++; return 'e' + String(n).padStart(3, '0'); }
function issueFor(s) {   // 従業員のアカウントを発行（すでにあれば、パスワードを再発行）
  const pw = newPw();
  let u = AUTH().users.find(x => x.staffId === s.id && x.role === 'employee');
  if (u) { setPw(u, pw, true); u.off = false; }
  else { u = makeUser({ id: nextEmpId(), name: s.name, role: 'employee', staffId: s.id, password: pw, must: true }); AUTH().users.push(u); }
  return { name: s.name, id: u.id, pw };
}
const credText = rows => '名前\tID\tパスワード\n' + rows.map(r => `${r.name}\t${r.id}\t${r.pw}`).join('\n');

/* セッション（「保持する」ならこの端末に残し、そうでなければタブを閉じるまで） */
const readSession = () => { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY)); } catch (e) { return null; } };
function endSession() { me = null; localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY); }
function startSession(u, remember) { endSession(); me = u; (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify({ id: u.id })); }
const allowedModes = () => !me ? [] : me.role === 'dev' ? ['admin', 'employee', 'dev'] : me.role === 'admin' ? ['admin'] : ['employee'];

function tryLogin(id, pw, remember) {   // 5回続けて失敗すると60秒ロック
  const key = String(id).trim().toLowerCase(), L = AUTH().lock, lk = L[key], now = Date.now();
  if (lk && lk.until > now) return { err: `ログインに失敗した回数が多いため、あと${Math.ceil((lk.until - now) / 1000)}秒ほどお待ちください` };
  const u = findUser(id);
  if (!u || !checkPw(u, pw)) {
    const n = ((lk && lk.n) || 0) + 1;
    L[key] = n >= 5 ? { n: 0, until: now + 60000 } : { n, until: 0 }; save();
    return { err: n >= 5 ? '5回続けて失敗したため、60秒ほどログインできません' : 'IDまたはパスワードが違います' };
  }
  if (u.off) return { err: 'このアカウントは無効になっています。管理者に連絡してください' };
  delete L[key]; u.last = now; save(); startSession(u, remember);
  return { u };
}

function showLogin(view) {
  document.body.dataset.auth = 'out'; delete document.body.dataset.role;
  view = view || (AUTH().users.length ? 'login' : 'setup');
  const id = { login: 'lgForm', setup: 'suForm', recover: 'rcForm' };
  Object.values(id).forEach(f => { $('#' + f).hidden = f !== id[view]; });
  ['#lgMsg', '#suMsg', '#rcMsg'].forEach(m => { $(m).textContent = ''; });
  $('#lgHelp').hidden = true; $('#lgPw').value = '';
  const first = { login: '#lgId', setup: '#suAPw', recover: '#rcId' }[view]; if ($(first)) $(first).focus();
}
function enterApp() {
  document.body.dataset.auth = 'in'; document.body.dataset.role = me.role;
  $('#uName').textContent = `${displayName(me)}（${ROLE_LABEL[me.role]}）`;
  const modes = allowedModes();
  $('.mode').hidden = modes.length < 2;
  document.querySelectorAll('.mbtn').forEach(b => { b.hidden = !modes.includes(b.dataset.mode); });
  if (me.role === 'employee') empId = me.staffId;
  $('#eWho').closest('label').hidden = me.role === 'employee';
  setMode(me.role === 'employee' ? 'employee' : 'admin');
  renderAccounts(); renderAdmins();
  $('#uPw').hidden = me.role === 'employee';   // 従業員は、従業員画面の「設定」からパスワードを設定する
  if (me.must && me.role !== 'employee') openPw(true);
}

$('#lgForm').addEventListener('submit', e => {
  e.preventDefault();
  const r = tryLogin($('#lgId').value, $('#lgPw').value, $('#lgRemember').checked);
  $('#lgPw').value = '';
  if (r.err) { $('#lgMsg').textContent = r.err; $('#lgPw').focus(); return; }
  $('#lgId').value = ''; enterApp();
});
$('#lgShow').addEventListener('click', () => { const i = $('#lgPw'), show = i.type === 'password'; i.type = show ? 'text' : 'password'; $('#lgShow').textContent = show ? '隠す' : '表示'; });
$('#lgForgot').addEventListener('click', e => { e.preventDefault(); $('#lgHelp').hidden = !$('#lgHelp').hidden; });
$('#lgRecover').addEventListener('click', () => showLogin('recover'));
$('#rcBack').addEventListener('click', () => showLogin('login'));
$('#uOut').addEventListener('click', () => { endSession(); showLogin('login'); ui.toast('ログアウトしました'); });

/* はじめの設定：管理者と開発者のアカウントを作る */
$('#suForm').addEventListener('submit', e => {
  e.preventDefault();
  const a = { id: $('#suAId').value.trim(), name: $('#suAName').value.trim() || '管理者', pw: $('#suAPw').value, pw2: $('#suAPw2').value };
  const d = { id: $('#suDId').value.trim(), name: $('#suDName').value.trim() || '開発者', pw: $('#suDPw').value, pw2: $('#suDPw2').value };
  const err = m => { $('#suMsg').textContent = m; };
  if (!ID_RE.test(a.id) || !ID_RE.test(d.id)) return err('IDは、英数字と「_ . -」で3〜20文字にしてください');
  if (a.id.toLowerCase() === d.id.toLowerCase()) return err('管理者と開発者のIDは、別にしてください');
  for (const x of [a, d]) { if (x.pw.length < 6) return err('パスワードは6文字以上にしてください'); if (x.pw !== x.pw2) return err('確認用のパスワードが一致しません'); }
  AUTH().users.push(makeUser({ id: a.id, name: a.name, role: 'admin', password: a.pw }), makeUser({ id: d.id, name: d.name, role: 'dev', password: d.pw }));
  const code = newCode(), salt = randStr(16, HEX);
  AUTH().recovery = { salt, hash: hashPw(code.replace(/-/g, ''), salt) };
  const u = findUser(d.id); u.last = Date.now(); save(); startSession(u, false);
  ['#suAPw', '#suAPw2', '#suDPw', '#suDPw2'].forEach(i => { $(i).value = ''; });
  showCreds('アカウントを作りました', '開発者の「復旧コード」です。開発者のパスワードを忘れたときに使います。この画面を閉じると二度と表示できないため、控えてから閉じてください。', `復旧コード：${code}`, enterApp);
});

/* 開発者のパスワードを復旧コードで再設定 */
$('#rcForm').addEventListener('submit', e => {
  e.preventDefault();
  const err = m => { $('#rcMsg').textContent = m; }, L = AUTH().lock, lk = L.recovery, now = Date.now();
  if (lk && lk.until > now) return err(`失敗が続いたため、あと${Math.ceil((lk.until - now) / 1000)}秒ほどお待ちください`);
  const u = findUser($('#rcId').value), R = AUTH().recovery, code = $('#rcCode').value.toUpperCase().replace(/[^A-Z0-9]/g, ''), pw = $('#rcPw').value;
  if (!u || u.role !== 'dev' || !R || hashPw(code, R.salt) !== R.hash) {
    const n = ((lk && lk.n) || 0) + 1; L.recovery = n >= 5 ? { n: 0, until: now + 60000 } : { n, until: 0 }; save();
    return err('IDまたは復旧コードが違います');
  }
  if (pw.length < 6) return err('パスワードは6文字以上にしてください');
  if (pw !== $('#rcPw2').value) return err('確認用のパスワードが一致しません');
  delete L.recovery; setPw(u, pw, false); u.off = false;
  const nc = newCode(), salt = randStr(16, HEX); R.salt = salt; R.hash = hashPw(nc.replace(/-/g, ''), salt); save();
  ['#rcCode', '#rcPw', '#rcPw2'].forEach(i => { $(i).value = ''; });
  showCreds('パスワードを再設定しました', '新しい復旧コードです。古いコードは使えなくなりました。控えてから閉じてください。', `復旧コード：${nc}`, () => { showLogin('login'); $('#lgMsg').textContent = '新しいパスワードでログインしてください'; });
});

/* パスワードの変更 */
let pwForced = false;
function openPw(forced) {
  pwForced = !!forced;
  ['#pwOld', '#pwNew', '#pwNew2'].forEach(i => { $(i).value = ''; }); $('#pwMsg').textContent = '';
  $('#pwNote').textContent = forced ? '初期パスワードのままです。新しいパスワードに変えてください。' : '';
  $('#pwCancel').hidden = pwForced; $('#pwModal').hidden = false; $('#pwOld').focus();
}
const closePw = () => { $('#pwModal').hidden = true; };
$('#uPw').addEventListener('click', () => openPw(false));
$('#pwCancel').addEventListener('click', closePw);
$('#pwModal').addEventListener('click', e => { if (e.target === $('#pwModal') && !pwForced) closePw(); });
$('#pwModal').addEventListener('keydown', e => { if (e.key === 'Escape' && !pwForced) closePw(); });
$('#pwSave').addEventListener('click', () => {
  const err = m => { $('#pwMsg').textContent = m; }, o = $('#pwOld').value, n = $('#pwNew').value;
  if (!checkPw(me, o)) return err('今のパスワードが違います');
  if (n.length < 6) return err('新しいパスワードは6文字以上にしてください');
  if (n !== $('#pwNew2').value) return err('確認用のパスワードが一致しません');
  if (n === o) return err('今と同じパスワードは使えません');
  setPw(me, n, false); save(); closePw(); pwForced = false; renderAccounts(); renderAdmins();
  ui.toast('パスワードを変更しました');
});

/* 従業員画面の設定：パスワード（はじめは「設定」、設定後は「再設定」） */
function renderEmpPw() {
  const emp = !!(me && me.role === 'employee'), must = emp && me.must;
  $('#ePwNotice').hidden = !must;
  if (!emp) { $('#ePwTitle').textContent = 'パスワード設定'; $('#ePwNote').textContent = '従業員としてログインしたときに使える項目です（開発者の確認用の表示では、操作できません）。'; $('#ePwFields').hidden = true; return; }
  $('#ePwFields').hidden = false;
  $('#ePwTitle').textContent = must ? 'パスワード設定' : 'パスワード再設定';
  $('#ePwNote').textContent = must ? '管理者から受け取った初期パスワードのままです。ご自身のパスワードを決めてください。' : '旧パスワードと、新しいパスワードを入れて、登録してください。';
  $('#ePwOldRow').hidden = must; $('#ePwSave').textContent = must ? '登録する' : '変更する';
}
$('#ePwNotice').addEventListener('click', () => { eTab = 'rules'; renderEmployee(); });
$('#ePwSave').addEventListener('click', () => {
  if (!me || me.role !== 'employee') return;
  const err = m => { $('#ePwMsg').textContent = m; }, o = $('#ePwOld').value, n = $('#ePwNew').value, first = me.must;
  if (!first && !checkPw(me, o)) return err('旧パスワードが違います');
  if (n.length < 6) return err('新しいパスワードは6文字以上にしてください');
  if (n !== $('#ePwNew2').value) return err('確認用のパスワードが一致しません');
  if (!first && n === o) return err('今と同じパスワードは使えません');
  setPw(me, n, false); save();
  ['#ePwOld', '#ePwNew', '#ePwNew2'].forEach(i => { $(i).value = ''; }); err('');
  renderEmpPw(); ui.toast(first ? 'パスワードを設定しました' : 'パスワードを変更しました');
});

/* 発行したIDとパスワードの表示（この画面でしか確認できない） */
let credDone = null;
function showCreds(title, note, text, done) {
  $('#cTitle').textContent = title; $('#cNote').textContent = note; $('#cText').value = text;
  credDone = done || null; $('#credModal').hidden = false; $('#cClose').focus();
}
$('#cClose').addEventListener('click', () => { $('#credModal').hidden = true; $('#cText').value = ''; const f = credDone; credDone = null; if (f) f(); });
$('#cCopy').addEventListener('click', async () => {
  const t = $('#cText').value;
  try { if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(t); else { $('#cText').select(); document.execCommand('copy'); } ui.toast('コピーしました'); }
  catch (e) { $('#cText').select(); ui.toast('コピーできませんでした。選択した文字を手でコピーしてください', 'warn'); }
});

/* 設定タブ：従業員アカウント（管理者・開発者が操作） */
function renderAccounts() {
  const ul = $('#acList'); if (!ul) return;
  ul.innerHTML = state.staff.length ? state.staff.map(s => {
    const u = AUTH().users.find(x => x.staffId === s.id && x.role === 'employee');
    const st = !u ? '未発行' : u.off ? '無効' : u.must ? '初期パスワードのまま' : '有効';
    return `<li><div class="info"><b>${esc(s.name)}</b><span class="pill${u && !u.off && !u.must ? ' ok' : u && u.off ? ' warn' : ''}">${st}</span>` +
      (u ? `<div class="meta">ID：${esc(u.id)}${u.last ? ` ／ 最終ログイン ${fmtAt(u.last)}` : ' ／ まだログインしていません'}</div>` : '') + '</div>' +
      (u ? `<button type="button" class="btn small" data-ac="reset" data-s="${s.id}">パスワード再発行</button><button type="button" class="btn small" data-ac="${u.off ? 'on' : 'off'}" data-s="${s.id}">${u.off ? '有効にする' : '無効にする'}</button><button type="button" class="btn small" data-ac="del" data-s="${s.id}">削除</button>`
        : `<button type="button" class="btn small primary" data-ac="issue" data-s="${s.id}">発行</button>`) + '</li>';
  }).join('') : '<li class="meta">従業員がまだいません。</li>';
}
$('#acList').addEventListener('click', async e => {
  const act = e.target.dataset.ac; if (!act) return;
  const s = state.staff.find(x => x.id === e.target.dataset.s), u = AUTH().users.find(x => x.staffId === (s && s.id) && x.role === 'employee'); if (!s) return;
  if (act === 'issue' || act === 'reset') {
    if (act === 'reset' && !await ui.ask(`${s.name}さんのパスワードを再発行します。今のパスワードは使えなくなります。`, { ok: '再発行する' })) return;
    const r = issueFor(s); save(); renderAccounts();
    showCreds(`${s.name}さんのアカウント`, '初期パスワードは、この画面でしか確認できません。本人に伝えてから閉じてください（最初のログインで本人が変更します）。', credText([r]));
  } else if (act === 'on' || act === 'off') { u.off = act === 'off'; save(); renderAccounts(); ui.toast(u.off ? 'アカウントを無効にしました' : 'アカウントを有効にしました'); }
  else if (act === 'del') {
    if (!await ui.ask(`${s.name}さんのアカウントを削除します（従業員の登録は残ります）。`, { ok: '削除する', danger: true })) return;
    AUTH().users = AUTH().users.filter(x => x !== u); save(); renderAccounts(); ui.toast('アカウントを削除しました');
  }
});
$('#acAll').addEventListener('click', async () => {
  const todo = state.staff.filter(s => !AUTH().users.some(u => u.staffId === s.id && u.role === 'employee'));
  if (!todo.length) return ui.toast('未発行の人はいません', 'warn');
  if (!await ui.ask(`アカウントが未発行の${todo.length}人に、IDと初期パスワードを発行します。`, { ok: '発行する' })) return;
  const rows = todo.map(issueFor); save(); renderAccounts();
  showCreds(`${rows.length}人分のアカウントを発行しました`, '初期パスワードは、この画面でしか確認できません。コピーして控えてから閉じてください（最初のログインで本人が変更します）。', credText(rows));
});

/* 開発者画面：管理者・開発者アカウント */
function renderAdmins() {
  const ul = $('#adList'); if (!ul) return;
  const lastDev = u => u.role === 'dev' && !AUTH().users.some(x => x !== u && x.role === 'dev' && !x.off);
  ul.innerHTML = AUTH().users.filter(u => u.role !== 'employee').map(u => {
    const self = me && u.id === me.id, lock = self || lastDev(u) ? ' disabled' : '';
    return `<li><div class="info"><b>${esc(u.name)}</b> <span class="badge" style="background:${u.role === 'dev' ? '#6b5b95' : '#0f6e6e'}">${ROLE_LABEL[u.role]}</span>` +
      `${u.off ? '<span class="pill warn">無効</span>' : ''}${u.must ? '<span class="pill">初期パスワード</span>' : ''}` +
      `<div class="meta">ID：${esc(u.id)}${u.last ? ` ／ 最終ログイン ${fmtAt(u.last)}` : ' ／ まだログインしていません'}${self ? ' ／ 今のあなた' : ''}</div></div>` +
      `<button type="button" class="btn small" data-ad="reset" data-u="${esc(u.id)}">パスワード再発行</button>` +
      `<button type="button" class="btn small" data-ad="${u.off ? 'on' : 'off'}" data-u="${esc(u.id)}"${lock}>${u.off ? '有効にする' : '無効にする'}</button>` +
      `<button type="button" class="btn small" data-ad="del" data-u="${esc(u.id)}"${lock}>削除</button></li>`;
  }).join('');
}
$('#adList').addEventListener('click', async e => {
  const act = e.target.dataset.ad; if (!act) return;
  const u = findUser(e.target.dataset.u); if (!u) return;
  if (act === 'reset') {
    if (!await ui.ask(`${u.name}（${u.id}）のパスワードを再発行します。今のパスワードは使えなくなります。`, { ok: '再発行する' })) return;
    const pw = newPw(); setPw(u, pw, true); save(); renderAdmins();
    showCreds(`${u.name}さんのパスワード`, '新しいパスワードは、この画面でしか確認できません。本人に伝えてから閉じてください（次のログインで本人が変更します）。', credText([{ name: u.name, id: u.id, pw }]));
  } else if (act === 'on' || act === 'off') { u.off = act === 'off'; save(); renderAdmins(); ui.toast(u.off ? 'アカウントを無効にしました' : 'アカウントを有効にしました'); }
  else if (act === 'del') {
    if (!await ui.ask(`${u.name}（${u.id}）のアカウントを削除します。`, { ok: '削除する', danger: true })) return;
    AUTH().users = AUTH().users.filter(x => x !== u); save(); renderAdmins(); ui.toast('アカウントを削除しました');
  }
});
$('#adForm').addEventListener('submit', e => {
  e.preventDefault();
  const role = $('#adRole').value, id = $('#adId').value.trim(), name = $('#adName').value.trim(), pw0 = $('#adPw').value;
  if (!ID_RE.test(id)) return ui.toast('IDは、英数字と「_ . -」で3〜20文字にしてください', 'err');
  if (findUser(id)) return ui.toast('そのIDはすでに使われています', 'err');
  if (pw0 && pw0.length < 6) return ui.toast('パスワードは6文字以上にしてください', 'err');
  const pw = pw0 || newPw();
  AUTH().users.push(makeUser({ id, name: name || id, role, password: pw, must: !pw0 }));
  save(); $('#adForm').reset(); renderAdmins();
  if (!pw0) showCreds(`${name || id}さんのアカウント`, '初期パスワードは、この画面でしか確認できません。本人に伝えてから閉じてください（最初のログインで本人が変更します）。', credText([{ name: name || id, id, pw }]));
  else ui.toast('アカウントを追加しました');
});

/* ========== 初期化 ========== */
setT('eFrom', '09:00'); setT('eTo', '17:00');
resetForm(); renderRoles(); renderConditions(); renderSettings(); renderLimits(); renderPeriodSettings(); renderTimeRange(); renderAutoRules(); renderSortBar(); renderShiftSortBar(); renderShiftRules(); renderSetCat(); renderMinWage(); renderNight(); renderAuto2(); renderPatterns(); renderStaffList(); renderGantt();
if (state.settings.auto) fetchRate(false);   // ページを開くたびに最新レートを取得

/* ---- 起動：保持されたログインがあれば入り、なければログイン画面（アカウントがなければ、はじめの設定） ---- */
(function boot() {
  const ss = readSession(), u = ss && findUser(ss.id);
  if (u && !u.off) { me = u; enterApp(); } else { endSession(); showLogin(); }
})();