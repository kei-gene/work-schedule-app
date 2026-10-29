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
    const sh = dayShifts(k)[s.id], isW = isWork(sh), stName = stationOf(s, sh), color = roleColor(stName), off = adminPref(s.id, k, pk).status === 'off';
    const w = work[s.id] || [], b = brk[s.id] || [], cells = w.length + b.length;
    const win = isW ? shiftHourList(sh) : (shiftOn ? [] : mainHours(s, k)), sub = (!isW && !shiftOn) ? subHours(s, k) : [];
    const hrs = manual ? w.length : (isW ? shiftHours(sh) : 0), cost = (isW && !manual) ? shiftCost(s, sh) : hourly(s) * hrs; total += cost;
    const needBrk = manual && cells > 6 && b.length * 60 < legalBreak(cells);   // 法定の休憩が足りない
    html += `<tr><th class="name"><b>${esc(s.name)}</b><div class="meta">${esc(s.role || '役割なし')}${stName !== s.role ? '→' + esc(stName) : ''} ／ <span class="stars">${stars(s.rating)}</span></div>
      <div class="meta${off || needBrk ? ' warnText' : ''}">${isW ? hm(sh.start) + '–' + hm(sh.end) + '・' : ''}${fh(hrs)}時間${isW && sh.brk ? '・休憩' + sh.brk + '分' : ''}・${money(cost)}${off ? '・希望休' : ''}${needBrk ? '・⚠休憩が足りません' : ''}</div></th>`;
    H.forEach(h => {
      const on = w.includes(h), br = b.includes(h);
      const cls = on || br ? (br ? 'brk' : 'on') : win.includes(h) ? 'ok' : sub.includes(h) ? 'sub' : 'off';
      html += `<td class="cell ${cls}${manual ? '' : ' view'}" data-id="${s.id}" data-h="${h}"${on ? ` style="background:${color}"` : ''}>${on ? '●' : br ? '休憩' : ''}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody><tfoot><tr><th class="name">配置人数<small>最低〜最高（休憩中は除く）</small></th>';
  H.forEach(h => { const c = rows.filter(s => (work[s.id] || []).includes(h)).length, r = rule(h); html += `<td class="${c < r.min ? 'low' : c > r.max ? 'high' : ''}"${c < r.min ? ` data-tip="${esc(`${h}時台：${c}人（最低${r.min}人）\nあと${r.min - c}人（休憩中の人は含みません）`)}"` : ''}>${c}<small>${r.min}〜${r.max}</small></td>`; });
  html += '</tr>';
  state.roles.forEach(ro => {
    const q = state.roleRules[ro.name];
    if (!q || (!q.min && q.max == null)) return;
    html += `<tr><th class="name"><span style="color:${ro.color}">●</span> ${esc(ro.name)}の人数<small>${q.min}〜${q.max == null ? '制限なし' : q.max}</small></th>`;
    H.forEach(h => { const c = rows.filter(s => stationOf(s, dayShifts(k)[s.id]) === ro.name && (work[s.id] || []).includes(h)).length; html += `<td class="${c < q.min ? 'low' : q.max != null && c > q.max ? 'high' : ''}">${c}</td>`; });
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