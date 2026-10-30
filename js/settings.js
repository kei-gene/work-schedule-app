'use strict';

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
  target: [['fill', '勤務可能時間いっぱいまで勤務を追加する'], ['cap', '勤務可能時間を上限にする（追加はしない）'], ['ignore', '勤務可能時間の長さにこだわらない']],
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
    const n = state.staff.filter(s => s.role === r.name).length, m = state.staff.filter(s => s.role !== r.name && (s.skills || []).includes(r.name)).length;
    return `<li draggable="true" data-ri="${i}"><span class="grip" title="ドラッグで並び替え">⠿</span><div class="info"><span class="badge" style="background:${r.color}">${esc(r.name)}</span> <span class="meta">${n}人${m ? `・兼務${m}人` : ''}</span></div>
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
    state.staff.forEach(s => { if (s.role === old) s.role = name; if (s.skills) s.skills = s.skills.map(n => n === old ? name : n); }); // 名前変更を従業員にも反映
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
    state.staff.forEach(s => { if (s.skills) s.skills = s.skills.filter(n => n !== r.name); });
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

/* ========== 設定タブ：保存ボタン（押すまで保存しない） ========== */
function updateSetBar() { const b = $('#setBar'); if (b) b.hidden = !isDirty(); }
function renderAllSettings() {   // 保存していない変更を破棄したあと、設定の画面を全部、保存済みの内容で描き直す
  resetRoleForm(); renderRoles(); renderConditions(); renderSettings(); renderLimits(); renderPeriodSettings(); renderTimeRange(); renderAutoRules(); renderShiftRules(); renderMinWage(); renderNight(); renderAuto2(); renderPatterns(); renderAccounts(); applyHelp(); renderSetCat();
  aP = periodOf(new Date()); eP = nextP(); mDay = null; viewOrder = null;
}
async function confirmLeaveSettings() {   // 設定を開いたまま別の画面へ移るとき。保存していない変更があれば確認する
  if (!isDirty()) return true;
  return ui.ask('設定に、保存していない変更があります。\n保存せずに移動すると、この変更は破棄されます。', { ok: '破棄して移動', cancel: '設定に戻る', danger: true });
}
$('#setSave').addEventListener('click', () => { commitDraft(); ui.toast('設定を保存しました'); });
$('#setDiscard').addEventListener('click', async () => {
  if (!isDirty()) return;
  if (!await ui.ask('保存していない変更をすべて破棄して、最後に保存した設定に戻します。', { ok: '破棄する', danger: true })) return;
  discardDraft(); renderAllSettings(); updateSetBar(); ui.toast('変更を破棄しました');
});
window.addEventListener('beforeunload', e => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });