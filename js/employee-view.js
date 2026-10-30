'use strict';

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
/* ---- 従業員が希望を出せる期間（管理者が設定。初期設定は「次回分だけ」）---- */
const curP = () => periodOf(new Date()), nextP = () => periodOf(curP().end);
function canSubmit(p) {
  const m = state.settings.submit.mode, k = ymd(p.start), c = ymd(curP().start), n = ymd(nextP().start);
  return m === 'open' ? k >= c : m === 'cur_next' ? (k === c || k === n) : k === n;
}
const periodUnitText = () => { const S = state.settings.period; return S.mode === 'month' ? '1か月' : `${S.weeks}週間`; };
const spanKind = n => n <= 7 ? 'w1' : n <= 14 ? 'w2' : 'month';
function renderEmpStatus() {
  const pk = ymd(eP.start), P = pf(empId), sub = P.submissions[pk], comment = P.comments[pk] || '', el = $('#eSubStatus');
  const dirty = sub && (JSON.stringify(sub.snap) !== JSON.stringify(snapshotFor(empId, pKeys(eP))) || (sub.comment || '') !== comment.trim());
  el.textContent = !sub ? (!canSubmit(eP) ? '提出を受け付けている期間ではありません' : isClosed(pk) ? '未提出（締切を過ぎました）' : '未提出') : dirty ? '提出後に変更があります。再提出してください' : `提出済み（${fmtAt(sub.at)}）`;
  el.className = 'substatus ' + (!sub ? '' : dirty ? 'warn' : 'ok');
  $('#eSubmit').textContent = sub ? '再提出する' : '提出する';
}
function renderEmpCal() {
  const p = eP, keys = pKeys(p), pk = ymd(p.start), pub = !!state.published[pk];
  const allowed = canSubmit(p);
  $('#eLabel').textContent = pLabel(p) + '・' + periodUnitText() + '単位' + (pub ? '　確定済み' : '');
  $('#eCal').dataset.span = spanKind(keys.length);
  let html = DOW_MON.map(d => `<div class="dow">${d}</div>`).join('') + '<div class="cday blank"></div>'.repeat((p.start.getDay() + 6) % 7);
  keys.forEach((k, i) => {
    const d = parseYmd(k), e = effPref(empId, k), sh = pub ? dayShifts(k)[empId] : null, wd = d.getDay();
    const cls = e.status, label = e.status === 'off' ? '希望休' : e.status === 'time' ? `${hm(e.start)}–${hm(e.end)}` : '出勤可';
    html += `<button type="button" class="cday ${cls}${wd === 0 ? ' sun' : wd === 6 ? ' sat' : ''}${k === todayKey() ? ' today' : ''}" data-k="${k}"><span class="dn">${d.getDate()}${(i === 0 || d.getDate() === 1) ? `<i>${d.getMonth() + 1}月</i>` : ''}</span>` +
      `<span class="st">${label}</span>${e.src === 'rule' && e.status !== 'ok' ? '<em class="src">毎週</em>' : ''}` +
      (sh ? `<span class="conf">確定 ${sh.off ? '休み' : hm(sh.start) + '–' + hm(sh.end)}</span>` : '') + '</button>';
  });
  $('#eCal').innerHTML = html;
  const closed = isClosed(pk), lock = pub || closed || !allowed, dl = deadlineOf(pk), left = dl ? Math.round((parseYmd(dl) - parseYmd(todayKey())) / 864e5) : 99;
  $('#eDeadline').textContent = !allowed ? '' : pub ? 'この期間のシフトは確定しました。' : closed ? deadlineText(pk) + '。希望の提出・変更はできません。変更したいときは管理者に連絡してください。' : dl ? deadlineText(pk) + 'までに提出してください。' : '';
  $('#eDeadline').className = 'dlbanner' + (closed ? ' closed' : left <= 3 ? ' near' : '');
  $('#eSubmit').disabled = lock; $('#eComment').disabled = lock; $('#eCal').classList.toggle('locked', lock); $('.brushbar').classList.toggle('off', lock);
  const win = $('#eWindow'), n = nextP();
  win.hidden = allowed;
  if (!allowed) win.innerHTML = `この期間は、いま希望を出せません（見るだけです）。希望を出せるのは「${esc(pLabel(n))}」（次回分）です。<button type="button" class="btn small" id="eGoNext">次回分へ</button>`;
  if (document.activeElement !== $('#eComment')) $('#eComment').value = pf(empId).comments[pk] || '';
  renderEmpStatus();
}
$('#eWho').addEventListener('change', () => { empId = $('#eWho').value; renderEmployee(); });
document.querySelectorAll('.etab').forEach(b => b.addEventListener('click', () => { eTab = b.dataset.etab; renderEmployee(); }));
document.querySelectorAll('.brush').forEach(b => b.addEventListener('click', () => { brush = b.dataset.brush; renderBrush(); }));
$('#ePrev').addEventListener('click', () => { eP = periodOf(addDays(eP.start, -1)); renderEmpCal(); });
$('#eNext').addEventListener('click', () => { eP = periodOf(eP.end); renderEmpCal(); });
$('#eToday').addEventListener('click', () => { eP = nextP(); renderEmpCal(); });
$('#eWindow').addEventListener('click', e => { if (e.target.id === 'eGoNext') { eP = nextP(); renderEmpCal(); } });

/* 日付をタップ → 選んだ内容を指定（同じ内容をもう一度タップで解除） */
$('#eCal').addEventListener('click', e => {
  const b = e.target.closest('.cday[data-k]'); if (!b) return;
  if (!canSubmit(eP)) return ui.toast('この期間は、いま希望を出せません。希望を出せるのは次回分です', 'warn');
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
  if (!canSubmit(eP)) return ui.toast('この期間は、いま希望を出せません。希望を出せるのは次回分です', 'warn');
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
let pUnitCustom = false;
function renderPeriodSettings() {
  const S = state.settings.period;
  $('#pMode').value = S.mode; $('#pStart').value = S.startDay; $('#pWeeks').value = String(S.weeks); $('#pAnchor').value = S.anchor;
  $('#pDlDays').value = state.settings.deadlineDays || 0;
  $('#pMonthBox').hidden = S.mode !== 'month'; $('#pWeeksBox').hidden = S.mode !== 'weeks';
  const unit = pUnitCustom ? 'custom' : (S.mode === 'weeks' && S.weeks === 1) ? 'w1' : (S.mode === 'weeks' && S.weeks === 2) ? 'w2' : (S.mode === 'month' && S.startDay === 1) ? 'm1' : 'custom';
  $('#pUnit').value = unit; $('#pCustom').hidden = unit !== 'custom';
  $('#pNote').textContent = `今日を含む期間：${pLabel(curP())} ／ 次回分：${pLabel(nextP())}`;
  renderSubmitWindow();
}
function renderSubmitWindow() {
  const m = state.settings.submit.mode, c = curP(), n = nextP();
  $('#sbMode').value = m;
  $('#sbNote').textContent = '従業員がいま希望を出せる期間：' + (m === 'next' ? `次回分 ${pLabel(n)}` : m === 'cur_next' ? `今の期間 ${pLabel(c)} と、次回分 ${pLabel(n)}` : `今の期間 ${pLabel(c)} から先のすべて`);
}
$('#sbMode').addEventListener('change', () => { state.settings.submit.mode = $('#sbMode').value; save(); renderSubmitWindow(); ui.toast('希望を出せる期間を変更しました'); });
$('#pUnit').addEventListener('change', () => {
  const v = $('#pUnit').value, S = state.settings.period; pUnitCustom = v === 'custom';
  if (v === 'w1') { S.mode = 'weeks'; S.weeks = 1; } else if (v === 'w2') { S.mode = 'weeks'; S.weeks = 2; } else if (v === 'm1') { S.mode = 'month'; S.startDay = 1; }
  aP = periodOf(new Date()); eP = nextP(); save(); renderPeriodSettings(); ui.toast(v === 'custom' ? '週数や月の開始日を、下で指定してください' : `シフト表の期間を「${$('#pUnit').selectedOptions[0].textContent}」にしました`);
});
['pMode', 'pStart', 'pWeeks', 'pAnchor'].forEach(id => $('#' + id).addEventListener('change', () => {
  const S = state.settings.period, sd = Math.round(+$('#pStart').value);
  if (!(sd >= 1 && sd <= 28)) { ui.toast('月の開始日は1〜28で入れてください', 'err'); renderPeriodSettings(); return; }
  if ($('#pMode').value === 'weeks' && !$('#pAnchor').value) { ui.toast('最初の期間の開始日を入れてください', 'err'); renderPeriodSettings(); return; }
  S.mode = $('#pMode').value; S.startDay = sd; S.weeks = +$('#pWeeks').value; if ($('#pAnchor').value) S.anchor = $('#pAnchor').value;
  aP = periodOf(new Date()); eP = nextP(); save(); renderPeriodSettings(); ui.toast('シフト表の期間を変更しました');
}));