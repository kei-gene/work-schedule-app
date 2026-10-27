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
  s.patterns = s.patterns || [];   // シフトの型 [{ id, name, start, end, days }]
  if (!s.settings.submit) s.settings.submit = { mode: 'next' };   // 従業員が希望を出せる期間：'next' 次回分だけ ／ 'cur_next' 今の期間と次回分 ／ 'open' 今の期間以降すべて
  if (!s.settings.helpDef) s.settings.helpDef = 'open';   // 設定の説明文：'open' 表示する ／ 'closed' 畳む
  s.settings.helpOpen = s.settings.helpOpen || {};        // カードごとに開閉を変えたとき { カードID: true/false }   // 最低賃金：大阪府（令和8年10月1日〜）。設定で変えられる
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
/* 設定タブでは、変更はいったんメモリの中だけに置き、「保存する」を押したときに保存する（draft＝編集中の状態。committed＝最後に保存した内容） */
let draft = null;
const clone = o => JSON.parse(JSON.stringify(o));
const stripAuth = o => { const { auth, ...rest } = o; return JSON.stringify(rest); };   // アカウントは、設定の保存ボタンとは別に、すぐ保存する
const isDirty = () => !!draft && stripAuth(state) !== stripAuth(draft.committed);
function save() { if (draft) { updateSetBar(); return; } localStorage.setItem(KEY, JSON.stringify(state)); }
function saveSlice(...keys) {   // 設定の下書きとは関係なく、指定した項目だけをすぐ保存する（アカウントなど）
  if (!draft) return save();
  keys.forEach(k => { draft.committed[k] = clone(state[k]); });
  localStorage.setItem(KEY, JSON.stringify(draft.committed));
}
function savePrefs() {   // 説明文の開け閉めは、保存ボタンを押さなくても残す
  if (!draft) return save();
  draft.committed.settings.helpDef = state.settings.helpDef; draft.committed.settings.helpOpen = clone(state.settings.helpOpen);
  localStorage.setItem(KEY, JSON.stringify(draft.committed));
}
function beginDraft() { draft = { committed: clone(state) }; updateSetBar(); }
function commitDraft() { if (!draft) return; localStorage.setItem(KEY, JSON.stringify(state)); draft.committed = clone(state); updateSetBar(); }
function discardDraft() { if (!draft) return; const auth = state.auth; state = clone(draft.committed); state.auth = auth; }   // 保存していない変更を、最後に保存した状態へ戻す
function abandonDraft() { if (draft) { discardDraft(); draft = null; updateSetBar(); } }

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