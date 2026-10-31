'use strict';

/* ========== タブ ========== */
let curTab = 'home';
function switchTab(name) {
  if (name !== 'settings') abandonDraft();   // 設定の保存していない変更は、ほかのタブへ移ると破棄される（移る前に確認が出る）
  curTab = name;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === name));
  if (name === 'home') renderGantt();
  if (name === 'shift') renderShift();
  if (name === 'setup') renderStaffList();
  if (name === 'settings') { if (!draft) beginDraft(); renderSetCat(); renderShiftRules(); renderAccounts(); renderMinWage(); renderNight(); renderAuto2(); renderPatterns(); }
}
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', async () => { if (b.dataset.tab !== curTab && !await confirmLeaveSettings()) return; switchTab(b.dataset.tab); }));

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
const normW = v => Array.isArray(v) ? { w: v.slice(), b: [], s: {} } : { w: [...((v && v.w) || [])], b: [...((v && v.b) || [])], s: { ...((v && v.s) || {}) } };   // s：{ 時間: 持ち場 }（ふだんの持ち場と違う時間だけ）
/* ---- 作業表の持ち場（時間ごと）：ふだんは、その日のシフトの持ち場。兼務できる人は、人数が足りない役割へ、途中の時間から別の持ち場に入る ---- */
const baseStation = (s, date) => stationOf(s, dayShifts(date)[s.id]);
function stationAt(s, date, h, stn) { const v = stn && stn[s.id] && stn[s.id][h]; return v && skillsOf(s).includes(v) ? v : baseStation(s, date); }
function deriveStations(date, work) {   // → { 従業員ID: { 時間: 持ち場 } }（ふだんの持ち場と違う時間だけ）
  const H = hoursList(), staff = state.staff.filter(s => (work[s.id] || []).length), over = {}, prev = {};
  const mn = r => (state.roleRules[r] && state.roleRules[r].min) || 0, mx = r => { const q = state.roleRules[r]; return q && q.max != null ? q.max : Infinity; };
  if (!staff.some(s => skillsOf(s).length > 1) || !state.roles.some(r => mn(r.name) > 0 || mx(r.name) < Infinity)) return over;
  H.forEach(h => {
    const on = staff.filter(s => work[s.id].includes(h)), st = {}, cnt = {};
    on.forEach(s => { const p = prev[s.id]; st[s.id] = p && skillsOf(s).includes(p) ? p : baseStation(s, date); cnt[st[s.id]] = (cnt[st[s.id]] || 0) + 1; });   // 前の時間と同じ持ち場から始める（むやみに変えない）
    const move = (s, to) => { cnt[st[s.id]]--; st[s.id] = to; cnt[to] = (cnt[to] || 0) + 1; };
    const surplus = r => (cnt[r] || 0) - mn(r);
    state.roles.forEach(ro => {   // 最低人数に足りない役割へ、ほかの持ち場（余裕のあるところ）から来てもらう。もとの持ち場に戻る人を優先
      while ((cnt[ro.name] || 0) < mn(ro.name) && (cnt[ro.name] || 0) < mx(ro.name)) {
        const c = on.filter(s => st[s.id] !== ro.name && skillsOf(s).includes(ro.name) && surplus(st[s.id]) >= 1)
          .sort((a, b) => (baseStation(b, date) === ro.name) - (baseStation(a, date) === ro.name) || surplus(st[b.id]) - surplus(st[a.id]));
        if (!c.length) break; move(c[0], ro.name);
      }
    });
    state.roles.forEach(ro => {   // 最高人数を超える役割からは、ほかの持ち場へ
      while ((cnt[ro.name] || 0) > mx(ro.name)) {
        const c = on.filter(s => st[s.id] === ro.name).flatMap(s => skillsOf(s).filter(r => r !== ro.name && (cnt[r] || 0) < mx(r)).map(r => ({ s, r })));
        if (!c.length) break; move(c[0].s, c[0].r);
      }
    });
    on.forEach(s => { prev[s.id] = st[s.id]; if (st[s.id] !== baseStation(s, date)) (over[s.id] = over[s.id] || {})[h] = st[s.id]; });
  });
  return over;
}
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
function workDay(date) {   // { work: {ID: [働く時間]}, brk: {ID: [休憩の時間]}, mode, stn: {ID: {時間: 持ち場}} }
  const mode = state.workMode[date] || 'shift';
  if (mode === 'manual') {
    const M = state.work[date] || {}, work = {}, brk = {}, stn = {};
    Object.keys(M).forEach(id => { const x = normW(M[id]); work[id] = x.w; brk[id] = x.b; stn[id] = x.s; });
    return { work, brk, mode, stn };
  }
  const d = deriveDay(date, mode === 'rules');
  return { work: d.work, brk: d.brk, mode, stn: deriveStations(date, d.work) };
}
const workOf = date => workDay(date).work;
function materialize(date) {   // 連動している表を、手動で直せる形にする
  const { work, brk, stn } = workDay(date), M = {};
  Object.keys(work).forEach(id => { M[id] = { w: work[id].slice(), b: (brk[id] || []).slice(), s: { ...((stn && stn[id]) || {}) } }; });
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
  note.innerHTML = `<span class="pill">合計 ${fh(tot)}時間</span>` + (lack.length ? `<span class="lackmsg">⚠ 人数が不足している日が${lack.length}日あります：${lack.slice(0, 8).map(mdText).join('、')}${lack.length > 8 ? `…ほか${lack.length - 8}日` : ''}</span>` : '<span>人数が不足している日はありません</span>');
}

function renderWork(keep) {
  const H = hoursList(), wrap = $('#gantt'), k = HW(), pk = pkOf(k), [lo, hi] = homeRange(), D = dim(), shiftOn = hasWork(k);
  const { work, brk, mode, stn } = workDay(k), manual = mode === 'manual';
  $('#legend').innerHTML = state.roles.map(r => `<span><i style="background:${r.color}"></i>${esc(r.name)}</span>`).join('') +
    '<span><i style="background:#5f6b76"></i>役割なし</span><span><i style="background:#dfe6ec;border:1px solid #bcc8d2"></i>休憩（法定）</span>' + (manual ? '<span><i style="background:#f3faf9;border:1px solid #ccc"></i>勤務可能時間</span>' : '');
  $('#hwLabel').textContent = dayLabel(k); $('#hwPrev').disabled = k <= lo; $('#hwNext').disabled = k >= hi;
  const drift = manual && shiftOn && (() => { const dw = deriveDay(k).work, ids = new Set([...Object.keys(dw), ...Object.keys(work).filter(i => (work[i] || []).length)]);
    return [...ids].some(i => JSON.stringify([...(dw[i] || [])].sort((a, b) => a - b)) !== JSON.stringify([...(work[i] || []), ...(brk[i] || [])].sort((a, b) => a - b))); })();   // シフトと違う部分があるか
  $('#hwMode').textContent = manual ? (drift ? '手動で調整中（シフトと違う部分あり）' : '手動で調整中') : mode === 'rules' ? '人数ルールで自動作成（シフトと連動）' : 'シフトと連動中';
  $('#hwMode').className = 'pill' + (manual ? ' warn' : ' ok');
  $('#hwNote').textContent = manual
    ? 'マスをクリックすると「働く → 休憩 → なし」の順に切り替わります。右クリック（スマホは長押し）で、役割・休憩・空白を選べます。「シフト通りに作る」で、シフトの時間どおりに戻せます。'
    : 'この日のシフトに合わせて自動で作られています（シフトを変えると、この表も変わります）。マスをクリックすると、手動の調整に切り替わります。6時間を超える勤務には、法律で決まっている休憩を「休憩」として入れています。兼務できる人は、人数が足りない役割へ、途中の時間から別の持ち場に入ります（右クリック、スマホは長押しで、役割・休憩・空白を選べます）。';
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
    const sh = dayShifts(k)[s.id], isW = isWork(sh), off = adminPref(s.id, k, pk).status === 'off', multi = skillsOf(s).length > 1;
    const w = work[s.id] || [], b = brk[s.id] || [], cells = w.length + b.length;
    const win = isW ? shiftHourList(sh) : (shiftOn ? [] : mainHours(s, k)), sub = (!isW && !shiftOn) ? subHours(s, k) : [];
    const hrs = manual ? w.length : (isW ? shiftHours(sh) : 0), cost = (isW && !manual) ? shiftCost(s, sh) : hourly(s) * hrs; total += cost;
    const needBrk = manual && cells > 6 && b.length * 60 < legalBreak(cells);   // 法定の休憩が足りない
    const seq = []; [...w].sort((a, c) => a - c).forEach(h => { const x = stationAt(s, k, h, stn); if (seq[seq.length - 1] !== x) seq.push(x); });   // 今日入る持ち場（順番どおり）
    html += `<tr><th class="name"><b>${esc(s.name)}</b><div class="meta">${esc(s.role || '役割なし')}${seq.length && (seq.length > 1 || seq[0] !== s.role) ? '（今日：' + seq.map(esc).join('→') + '）' : ''} ／ <span class="stars">${stars(s.rating)}</span></div>
      <div class="meta${off || needBrk ? ' warnText' : ''}">${isW ? hm(sh.start) + '–' + hm(sh.end) + '・' : ''}${fh(hrs)}時間${isW && sh.brk ? '・休憩' + sh.brk + '分' : ''}・${money(cost)}${off ? '・希望休' : ''}${needBrk ? '・⚠休憩が足りません' : ''}</div></th>`;
    H.forEach(h => {
      const on = w.includes(h), br = b.includes(h);
      const cls = on || br ? (br ? 'brk' : 'on') : win.includes(h) ? 'ok' : sub.includes(h) ? 'sub' : 'off';
      const stH = on ? stationAt(s, k, h, stn) : '';
      html += `<td class="cell ${cls}" data-id="${s.id}" data-h="${h}"${on ? ` style="background:${roleColor(stH)}" title="${esc(stH || '役割なし')}"` : ''}>${on ? (multi ? esc(stH.slice(0, 4)) : '●') : br ? '休憩' : ''}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody><tfoot><tr><th class="name">配置人数<small>最低〜最高（休憩中は除く）</small></th>';
  H.forEach(h => { const c = rows.filter(s => (work[s.id] || []).includes(h)).length, r = rule(h); html += `<td class="${c < r.min ? 'low' : c > r.max ? 'high' : ''}"${c < r.min ? ` data-tip="${esc(`${h}時台：人数が不足しています\n|${h}時台|必要${r.min}人|現在${c}人|不足${r.min - c}人\n休憩中の人は含みません`)}"` : ''}>${c}<small>${r.min}〜${r.max}</small></td>`; });
  html += '</tr>';
  state.roles.forEach(ro => {
    const q = state.roleRules[ro.name];
    if (!q || (!q.min && q.max == null)) return;
    html += `<tr><th class="name"><span style="color:${ro.color}">●</span> ${esc(ro.name)}の人数<small>${q.min}〜${q.max == null ? '制限なし' : q.max}</small></th>`;
    H.forEach(h => { const c = rows.filter(s => (work[s.id] || []).includes(h) && stationAt(s, k, h, stn) === ro.name).length; html += `<td class="${c < q.min ? 'low' : q.max != null && c > q.max ? 'high' : ''}">${c}</td>`; });
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
      !await ui.ask('勤務可能時間の外のマスです。\nこの時間に勤務を入れますか？', { ok: '入れる' })) return;
  if ((state.workMode[k] || 'shift') !== 'manual') { materialize(k); ui.toast('手動の調整に切り替えました。「シフト通りに作る」で、シフトの時間どおりに戻せます', 'warn'); }
  const M = state.work[k] || (state.work[k] = {}), x = normW(M[id]);
  if (x.w.includes(h)) { x.w.splice(x.w.indexOf(h), 1); x.b.push(h); delete x.s[h]; }        // 働く → 休憩
  else if (x.b.includes(h)) x.b.splice(x.b.indexOf(h), 1);                   // 休憩 → なし
  else x.w.push(h);                                                          // なし → 働く
  M[id] = x; save(); renderGantt(true);
});
/* 右クリック（スマホは長押し）：役割の変更・休憩・空白を選ぶ */
const cmEl = document.createElement('div'); cmEl.id = 'cmenu'; cmEl.hidden = true; document.body.append(cmEl);
const hideCm = () => { cmEl.hidden = true; cmEl.innerHTML = ''; };
async function setWorkCell(k, id, h, kind, station, td) {   // kind：'work'（働く。station＝入る持ち場）／'break'（休憩）／'none'（空白）
  const s = state.staff.find(v => v.id === id); if (!s) return;
  if (kind !== 'none' && td && td.classList.contains('off') && !await ui.ask('勤務可能時間の外のマスです。\nこの時間に勤務を入れますか？', { ok: '入れる' })) return;
  if ((state.workMode[k] || 'shift') !== 'manual') { materialize(k); ui.toast('手動の調整に切り替えました。「シフト通りに作る」で、シフトの時間どおりに戻せます', 'warn'); }
  const M = state.work[k] || (state.work[k] = {}), x = normW(M[id]);
  x.w = x.w.filter(v => v !== h); x.b = x.b.filter(v => v !== h); delete x.s[h];
  if (kind === 'work') { x.w.push(h); if (station !== baseStation(s, k)) x.s[h] = station; }
  else if (kind === 'break') x.b.push(h);
  M[id] = x; save(); renderGantt(true);
}
function openCm(td, px, py) {
  const k = HW(), id = td.dataset.id, h = +td.dataset.h, s = state.staff.find(v => v.id === id); if (!s) return;
  const { work, brk, stn } = workDay(k), w = (work[id] || []).includes(h), b = (brk[id] || []).includes(h), cur = w ? stationAt(s, k, h, stn) : null, sk = skillsOf(s), roles = sk.length ? sk : [''];
  const item = (act, label, on, color) => `<button type="button" data-cm="${esc(act)}"${on ? ' class="on"' : ''}>${color ? `<i style="background:${color}"></i>` : ''}${esc(label)}${on ? '<b>✓</b>' : ''}</button>`;
  cmEl.dataset.id = id; cmEl.dataset.h = h;
  cmEl.innerHTML = `<div class="cm-head">${esc(s.name)}　${fmt(h)}〜${fmt(h + 1)}</div><div class="cm-title">役割（この時間に働く）</div>` +
    roles.map(r => item('w:' + r, r || '勤務（役割なし）', w && cur === r, roleColor(r))).join('') +
    '<hr>' + item('break', '休憩', b) + item('none', '空白（なし）', !w && !b);
  cmEl.hidden = false;
  const W = cmEl.offsetWidth, Hh = cmEl.offsetHeight;
  cmEl.style.left = Math.max(6, Math.min(px, window.innerWidth - W - 6)) + 'px'; cmEl.style.top = Math.max(6, Math.min(py, window.innerHeight - Hh - 6)) + 'px';
}
$('#gantt').addEventListener('contextmenu', e => { const td = e.target.closest('.cell[data-id]'); if (!td) return; e.preventDefault(); openCm(td, e.clientX, e.clientY); });
cmEl.addEventListener('click', async e => {
  const b = e.target.closest('[data-cm]'); if (!b) return;
  const id = cmEl.dataset.id, h = +cmEl.dataset.h, a = b.dataset.cm, td = document.querySelector(`#gantt .cell[data-id="${id}"][data-h="${h}"]`);
  hideCm();
  await setWorkCell(HW(), id, h, a.startsWith('w:') ? 'work' : a === 'break' ? 'break' : 'none', a.startsWith('w:') ? a.slice(2) : '', td);
});
document.addEventListener('mousedown', e => { if (!cmEl.hidden && !e.target.closest('#cmenu')) hideCm(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCm(); });
window.addEventListener('scroll', hideCm, true); window.addEventListener('resize', hideCm);
let lpT = null, lpFired = false;   // スマホ：長押しでメニュー
$('#gantt').addEventListener('touchstart', e => { const td = e.target.closest('.cell[data-id]'); if (!td || e.touches.length !== 1) return; lpFired = false; const t = e.touches[0]; lpT = setTimeout(() => { lpFired = true; openCm(td, t.clientX, t.clientY); }, 550); }, { passive: true });
['touchmove', 'touchcancel'].forEach(ev => $('#gantt').addEventListener(ev, () => clearTimeout(lpT), { passive: true }));
$('#gantt').addEventListener('touchend', e => { clearTimeout(lpT); if (lpFired) { e.preventDefault(); lpFired = false; } });
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
  const { work, stn } = workDay(k), low = hoursList().filter(h => Object.values(work).filter(a => a.includes(h)).length < rule(h).min);
  const mv = Object.values(stn).reduce((n, m) => n + Object.keys(m).length, 0), mvTxt = mv ? `　兼務できる人が、人数が不足している役割へ入れ替わった時間が${mv}か所あります。` : '';
  if (low.length) ui.toast(`シフトの時間どおりに作りました。${low.map(fmt).join('、')} は最低人数に届いていません（シフトの人数が不足しています）` + mvTxt, 'warn');
  else ui.toast('シフトの時間どおりに作り、休憩を最低人数が保てる位置に置きました' + mvTxt);
});
$('#btnClear').addEventListener('click', async () => {
  const k = HW();
  if (!await ui.ask(`${mdText(k)} の作業表を空にして、手動で作れる状態にします。`, { ok: '空にする', danger: true })) return;
  state.workMode[k] = 'manual'; state.work[k] = {}; save(); renderGantt(); ui.toast('作業表を空にしました。マスをクリックして作ってください');
});
$('#hwOpen').addEventListener('click', () => { aP = periodOf(parseYmd(HW())); mDay = HW(); switchTab('shift'); });