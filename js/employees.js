'use strict';

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