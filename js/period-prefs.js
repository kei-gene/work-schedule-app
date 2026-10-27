'use strict';

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
let aP = periodOf(new Date()), eP = periodOf(periodOf(new Date()).end);   // 管理者は今の期間、従業員は次回分から表示   // 管理者側／従業員側で表示中の期間

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