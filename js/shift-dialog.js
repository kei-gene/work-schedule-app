'use strict';

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
  const cf = conflictOf({ start: a, end: b }, adminPref(editShift.id, editShift.date, pkOf(editShift.date)), s, editShift.date);   // 保存の前に、希望時間の外などを知らせる
  if (cf === 'out') el.textContent += `\n⚠ ${s.name}さんの希望時間の外です（保存するとき、確認が出ます）`;
  if (isMinor(s, editShift.date) && overlapMin({ start: a, end: b }, nightLegal) > 0) el.textContent += `\n⚠ 18歳未満のため、22時〜翌5時には原則入れません（保存するとき、確認が出ます）`;
  if (!employedOn(s, editShift.date)) el.textContent += `\n⚠ この日は入社前、または退職後です（保存するとき、確認が出ます）`;
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