'use strict';

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