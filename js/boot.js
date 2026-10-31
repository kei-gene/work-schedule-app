'use strict';

/* ========== 初期化 ========== */
setT('eFrom', '09:00'); setT('eTo', '17:00');
resetForm(); renderRoles(); renderConditions(); renderSettings(); renderLimits(); renderPeriodSettings(); renderTimeRange(); renderAutoRules(); renderSortBar(); renderShiftSortBar(); renderShiftRules(); renderSetCat(); renderMinWage(); renderNight(); renderAuto2(); renderPatterns(); renderStaffList(); initSettingsUI(); renderGantt();
if (state.settings.auto) fetchRate(false);   // ページを開くたびに最新レートを取得

/* ---- ホバー（スマホはタップ）で出る説明 ---- */
const tipEl = document.createElement('div'); tipEl.id = 'tip'; tipEl.hidden = true; document.body.append(tipEl);
let tipFor = null;
function showTip(el, x, y) {
  const lines = el.dataset.tip.split('\n'); tipFor = el;
  let html = `<b>${esc(lines[0])}</b>`, rows = [];
  const flush = () => { if (rows.length) { html += '<table>' + rows.map(r => `<tr>${r.map((c, i) => `<td${i === r.length - 1 ? ' class="miss"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('') + '</table>'; rows = []; } };
  lines.slice(1).forEach(l => {
    if (l.startsWith('|')) { rows.push(l.slice(1).split('|')); return; }   // 表の行（時間・必要・現在・不足）
    flush();
    if (l.startsWith('§')) html += `<div class="sec${l.startsWith('§（参考）') ? ' lead' : ''}">${esc(l.slice(1))}</div>`;
    else html += `<div${l.startsWith('（参考）') ? ' class="lead"' : ''}>${esc(l)}</div>`;
  });
  flush(); tipEl.innerHTML = html;
  tipEl.hidden = false; tipEl.style.left = '0px'; tipEl.style.top = '0px';   // 本来の幅と高さを測るため、いったん左上に置く（前の位置が右端だと、細長く縮んでしまう）
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
  let left = x + 14; if (left + w > vw - 8) left = x - w - 14;              // 右に入りきらないときは、カーソルの左に出す
  let top = y + 16; if (top + h > vh - 8) top = y - h - 12;                 // 下に入りきらないときは、カーソルの上に出す
  tipEl.style.left = Math.max(8, Math.min(left, vw - w - 8)) + 'px';
  tipEl.style.top = Math.max(8, Math.min(top, vh - h - 8)) + 'px';
}
const hideTip = () => { tipEl.hidden = true; tipFor = null; };
document.addEventListener('mouseover', e => { const t = e.target.closest && e.target.closest('[data-tip]'); if (t && layout !== 'mobile') showTip(t, e.clientX, e.clientY); });
document.addEventListener('mousemove', e => { if (tipFor && !tipEl.hidden && layout !== 'mobile') showTip(tipFor, e.clientX, e.clientY); });
document.addEventListener('mouseout', e => { const t = e.target.closest && e.target.closest('[data-tip]'); if (t && !t.contains(e.relatedTarget)) hideTip(); });
document.addEventListener('click', e => {
  const t = e.target.closest && e.target.closest('[data-tip]');
  if (layout === 'mobile' && t) { /* 同じ内容をもう一度タップしたら閉じる（再描画で要素が変わっても動く） */ if (tipFor && !tipEl.hidden && tipFor.dataset.tip === t.dataset.tip) hideTip(); else { const r = t.getBoundingClientRect(); showTip(t, r.left, r.bottom); } }
  else if (!t) hideTip();
}, true);
window.addEventListener('scroll', hideTip, true);

/* ---- 設定タブ：カードの見た目と、説明文の開け閉め ---- */
function initSettingsUI() {
  document.querySelectorAll('.setcat .card').forEach((card, i) => {
    if (!card.id) card.id = 'sc' + i;
    const h2 = card.querySelector(':scope > h2'); if (!h2) return;
    const head = document.createElement('div'); head.className = 'cardhead'; card.insertBefore(head, h2); head.append(h2);
    const body = document.createElement('div'); body.className = 'cardbody';
    while (head.nextSibling) body.append(head.nextSibling);
    card.append(body);
    if (card.querySelector('.help')) { const b = document.createElement('button'); b.type = 'button'; b.className = 'helpbtn'; b.dataset.hc = card.id; head.append(b); }
  });
  $('#srNote').classList.add('help');
  applyHelp();
}
function applyHelp() {
  const def = state.settings.helpDef !== 'closed', ov = state.settings.helpOpen;
  document.querySelectorAll('.setcat .card').forEach(card => {
    const open = card.id in ov ? ov[card.id] : def; card.classList.toggle('help-off', !open);
    const b = card.querySelector('.helpbtn'); if (b) { b.textContent = open ? 'ⓘ 説明を隠す' : 'ⓘ 説明を見る'; b.setAttribute('aria-expanded', String(open)); }
  });
  document.querySelectorAll('.setcat .catdesc').forEach(el => el.classList.toggle('help-off', !def));
  $('#helpDef').value = def ? 'open' : 'closed';
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('.helpbtn'); if (!b) return;
  const card = $('#' + b.dataset.hc), open = !(b.dataset.hc in state.settings.helpOpen ? state.settings.helpOpen[b.dataset.hc] : state.settings.helpDef !== 'closed');
  state.settings.helpOpen[b.dataset.hc] = open; savePrefs(); applyHelp();
});
$('#helpDef').addEventListener('change', () => { state.settings.helpDef = $('#helpDef').value; state.settings.helpOpen = {}; savePrefs(); applyHelp(); ui.toast(state.settings.helpDef === 'open' ? '説明を、いつも表示します' : '説明を、いつも畳みます（各カードの「説明を見る」で開けます）'); });

/* ---- ロゴ：同じフォルダに logo.png（または logo.svg / logo.jpg / logo.webp）を置くと、名前の横に表示されます。ないときは仮のマーク ---- */
const LOGO_FALLBACK = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0f6e6e"/><rect x="14" y="17" width="36" height="7" rx="3.5" fill="#fff"/><rect x="14" y="29" width="36" height="7" rx="3.5" fill="#fff" opacity=".85"/><rect x="14" y="41" width="22" height="7" rx="3.5" fill="#fff" opacity=".7"/></svg>');
(function setupLogo() {
  const imgs = [...document.querySelectorAll('img.logo')], fav = $('#favicon'), names = ['logo.png', 'logo.svg', 'logo.jpg', 'logo.jpeg', 'logo.webp'];
  imgs.forEach(i => { i.src = LOGO_FALLBACK; }); fav.href = LOGO_FALLBACK;
  const tryNext = k => { if (k >= names.length) return; const t = new Image(); t.onload = () => { imgs.forEach(i => { i.src = names[k]; }); fav.href = names[k]; }; t.onerror = () => tryNext(k + 1); t.src = names[k]; };
  tryNext(0);
})();

/* ---- 起動：保持されたログインがあれば入り、なければログイン画面（アカウントがなければ、はじめの設定） ---- */
(function boot() {
  const ss = readSession(), u = ss && findUser(ss.id);
  if (u && !u.off) { me = u; enterApp(); } else { endSession(); showLogin(); }
})();