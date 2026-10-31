'use strict';

/* ========== 管理者：シフト管理 ========== */
const isPublished = () => !!state.published[ymd(aP.start)];

/* ---- 画面サイズの自動判定（PC・タブレット横向き ／ スマホ・タブレット縦向き） ---- */
const mqMobile = window.matchMedia ? window.matchMedia('(orientation: portrait), (max-width: 820px)') : null;
const detectLayout = () => { const p = state.settings.layout || 'auto'; return p === 'auto' ? ((mqMobile && mqMobile.matches) ? 'mobile' : 'desktop') : p; };
let layout = detectLayout();
document.body.dataset.layout = layout;
function renderActive() {
  const m = document.body.dataset.mode;
  if (m === 'employee') renderEmployee();
  else if (m === 'dev') renderDev();
  else if (curTab === 'shift') renderShift();
  else if (curTab === 'home') renderGantt();
}
function applyLayout() {
  const next = detectLayout();
  document.body.dataset.layout = next;
  if (next !== layout) { layout = next; renderActive(); }
}
if (mqMobile) { if (mqMobile.addEventListener) mqMobile.addEventListener('change', applyLayout); else if (mqMobile.addListener) mqMobile.addListener(applyLayout); }

/* その日の出勤人数と、最低人数（全体・役割ごと）に足りないか */
/* ---- 日ごとの人数ルール（最低・最高人数）：平日・週末・毎日・曜日・月・日付で自由に組み合わせる ---- */
const SR_DAY = [['all', '毎日'], ['weekday', '平日（月〜金）'], ['weekend', '週末（土・日）'], ['dow1', '毎週月曜日'], ['dow2', '毎週火曜日'], ['dow3', '毎週水曜日'], ['dow4', '毎週木曜日'], ['dow5', '毎週金曜日'], ['dow6', '毎週土曜日'], ['dow0', '毎週日曜日'], ['date', '特定の日付']];
const SR_LABEL = Object.fromEntries(SR_DAY);
function srMatch(r, k) {
  const d = parseYmd(k), dow = d.getDay();
  if (+r.month && d.getMonth() + 1 !== +r.month) return false;
  if (r.day === 'all') return true;
  if (r.day === 'weekday') return dow >= 1 && dow <= 5;
  if (r.day === 'weekend') return dow === 0 || dow === 6;
  if (r.day === 'date') return r.date === k;
  return r.day === 'dow' + dow;
}
const srSpec = r => (r.day === 'date' ? 5 : /^dow/.test(r.day) ? 4 : r.day === 'all' ? 1 : 3) + (+r.month ? 0.5 : 0);   // 細かい指定ほど優先
function dayRuleOf(k) {
  let best = null, bs = -1;
  state.shiftRules.forEach((r, i) => { if (!srMatch(r, k)) return; const sc = srSpec(r) + i * 1e-6; if (sc > bs) { bs = sc; best = r; } });
  return best;
}
const srText = r => `${+r.month ? r.month + '月の' : ''}${r.day === 'date' ? (r.date ? mdText(r.date) : '（日付未指定）') : SR_LABEL[r.day]}：最低${r.min}人${r.max == null ? '' : '・最高' + r.max + '人'}`;

/* ---- シフト管理の従業員並び替え（はじめは階級順） ---- */
const SHIFT_SORTS = {
  role: { label: '階級順（役割管理の並び順）', desc: false },
  rating: { label: '評価', desc: true },
  name: { label: '名前（あいうえお）', desc: false },
  hours: { label: '期間の勤務時間', desc: true },
  days: { label: '期間の出勤日数', desc: true },
  offs: { label: '希望休の多さ', desc: true },
  unsub: { label: '希望の未提出を先に', desc: true },
  wage: { label: '時給', desc: true },
  manual: { label: '登録順', desc: false }
};
const roleIdx = s => { const k = state.roles.findIndex(r => r.name === s.role); return k < 0 ? 999 : k; };   // 役割なしは最後
function shiftStaff(keys, pk) {
  const { key, desc } = state.settings.shiftSort;
  const f = {
    role: roleIdx, rating: s => s.rating, name: s => s.name, wage: s => hourly(s), manual: () => 0,
    hours: s => keys.reduce((n, k) => n + shiftHours(dayShifts(k)[s.id]), 0),
    days: s => keys.filter(k => isWork(dayShifts(k)[s.id])).length,
    offs: s => keys.filter(k => adminPref(s.id, k, pk).status === 'off').length,
    unsub: s => subOf(s.id, pk) ? 0 : 1
  }[key] || (() => 0);
  const arr = state.staff.map((s, i) => ({ s, i, v: f(s) }));
  arr.sort((a, b) => {
    let c = typeof a.v === 'string' ? a.v.localeCompare(b.v, 'ja') : a.v - b.v;
    if (desc) c = -c;
    return c || (key === 'role' ? b.s.rating - a.s.rating : roleIdx(a.s) - roleIdx(b.s)) || a.i - b.i;   // 同じなら、階級→評価→登録順
  });
  return arr.map(x => x.s);
}
function renderShiftSortBar() {
  const sv = state.settings.shiftSort, b = $('#wDir');
  if (!SHIFT_SORTS[sv.key]) { sv.key = 'role'; sv.desc = false; }
  $('#wSort').value = sv.key; b.disabled = sv.key === 'manual'; b.textContent = sv.desc ? '▼ 降順' : '▲ 昇順';
}
$('#wSort').innerHTML = Object.entries(SHIFT_SORTS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
$('#wSort').addEventListener('change', () => { const k = $('#wSort').value; state.settings.shiftSort = { key: k, desc: SHIFT_SORTS[k].desc }; save(); renderShift(); });
$('#wDir').addEventListener('click', () => { state.settings.shiftSort.desc = !state.settings.shiftSort.desc; save(); renderShift(); });

/* ---- 人数ルールの反映表示・人数が足りない日の一覧 ---- */
function renderRuleNote(keys) {
  const L = state.shiftRules, el = $('#wRuleNote');
  if (!L.length) { el.className = 'rulenote none'; el.innerHTML = '日ごとの人数ルールは未設定です。<button type="button" class="btn small" data-go="rules">設定で決める</button>'; return; }
  const used = new Set(); let days = 0;
  keys.forEach(k => { const r = dayRuleOf(k); if (r) { days++; used.add(L.indexOf(r)); } });
  el.className = 'rulenote on';
  el.innerHTML = `<b>✓ 人数ルールを反映中</b><span>この期間の${days}日に適用</span>` + [...used].slice(0, 4).map(i => `<span class="chip">${esc(srText(L[i]))}</span>`).join('') +
    (used.size > 4 ? `<span>…ほか${used.size - 4}件</span>` : '') + '<button type="button" class="btn small" data-go="rules">設定を開く</button>';
}
$('#wRuleNote').addEventListener('click', e => { if (e.target.dataset.go) { setCat = 'shift'; switchTab('settings'); } });
function renderLackLine(keys) {
  const el = $('#wLack'), active = keys.some(hasShifts), lack = active ? keys.filter(k => dayStat(k).lack) : [];
  el.hidden = !lack.length;
  if (!lack.length) { el.innerHTML = ''; return; }
  const dn = k => `${mdText(k)}（${DOW[parseYmd(k).getDay()]}）`;
  el.innerHTML = `<details${lack.length <= 5 ? ' open' : ''}><summary>⚠ 人数が不足している日が${lack.length}日あります<small>（クリックで開く・閉じる）</small></summary>` +
    '<div class="tscroll"><table class="lacktbl"><thead><tr><th>日付</th><th>内容</th><th>必要</th><th>現在</th><th>不足</th></tr></thead><tbody>' +
    lack.slice(0, 14).map(k => { const rows = shortRows(k); return rows.map((r, i) => `<tr class="${[i === 0 ? 'first' : '', r.ref ? 'ref' : ''].filter(Boolean).join(' ')}">${i === 0 ? `<th class="dt" rowspan="${rows.length}">${dn(k)}</th>` : ''}${shortCells(r)}</tr>`).join(''); }).join('') + '</tbody></table></div>' +
    (lack.length > 14 ? `<p class="meta">…ほか${lack.length - 14}日</p>` : '') + '<p class="meta">「必要」は最低人数、「現在」はいま配置されている人数、「不足」はあと何人必要かです。くわしい内訳は、表の日付（赤い日）にカーソルを当てる（スマホはタップ）か、「作成結果」で見られます。</p></details>';
}

function dayCover(k) {   // その日の、時間ごとの配置人数
  const H = hoursList(), cnt = {}, roleAt = {};
  H.forEach(h => { cnt[h] = 0; roleAt[h] = {}; });
  let n = 0;
  state.staff.forEach(s => {
    const sh = dayShifts(k)[s.id]; if (!isWork(sh)) return;
    n++; const stn = stationOf(s, sh);   // 兼務できる人は、その日に入る持ち場で数える
    for (let h = Math.floor(tmin(sh.start) / 60); h < Math.ceil(tmin(sh.end) / 60); h++) if (cnt[h] !== undefined) { cnt[h]++; roleAt[h][stn] = (roleAt[h][stn] || 0) + 1; }
  });
  return { n, cnt, roleAt, H };
}
/* 人数が不足している日の内訳を、表の行にする（一覧・カーソルを当てたとき・スマホ・作成結果で使う）。必要人数・現在の人数・不足の人数を出す */
function shortItems(k) {
  const c = dayCover(k), H = c.H, dr = dayRuleOf(k), L = [];
  const group = (hs, need, have) => {   // 必要人数と現在の人数が同じ時間が続くときは、1行にまとめる
    const rows = []; hs.forEach(h => { const n = need(h), v = have(h), r = rows[rows.length - 1]; if (r && r.e === h - 1 && r.need === n && r.have === v) r.e = h; else rows.push({ s: h, e: h, need: n, have: v }); });
    return rows.map(r => ({ range: r.s === r.e ? `${r.s}時台` : `${r.s}〜${r.e}時台`, need: r.need, have: r.have }));
  };
  const hs = H.filter(h => c.cnt[h] < rule(h).min);
  if (hs.length) L.push({ kind: 'hour', label: '時間帯の人数', rows: group(hs, h => rule(h).min, h => c.cnt[h]) });
  if (dr && c.n < dr.min) L.push({ kind: 'day', label: '1日の出勤人数', rows: [{ range: '1日', need: dr.min, have: c.n }] });
  state.roles.forEach(ro => { const q = state.roleRules[ro.name]; if (!q || !q.min) return; const low = H.filter(h => (c.roleAt[h][ro.name] || 0) < q.min); if (low.length) L.push({ kind: 'role', label: `役割「${ro.name}」`, rows: group(low, () => q.min, h => c.roleAt[h][ro.name] || 0) }); });
  const A = state.settings.auto2, leads = state.roles.filter(r => r.lead).map(r => r.name), nLead = h => leads.reduce((n, nm) => n + (c.roleAt[h][nm] || 0), 0);
  if (A.leadMin > 0 && leads.length) { const low = H.filter(h => nLead(h) < A.leadMin); if (low.length) L.push({ kind: 'lead', label: '責任者（参考）', ref: true, rows: group(low, () => A.leadMin, nLead) }); }
  return L;
}
const shortRows = k => { const out = []; shortItems(k).forEach(it => it.rows.forEach(r => out.push({ ...r, label: it.label, kind: it.kind, ref: !!it.ref }))); return out; };
const missTxt = r => (r.kind === 'lead' && !r.have) ? '不在' : `${r.need - r.have}人`;
function shortDetail(k) {   // カーソルを当てたときの説明（§＝見出し、|＝表の行）
  const out = []; shortItems(k).forEach(it => { out.push(`§${it.ref ? '（参考）' : ''}${it.label}`); it.rows.slice(0, 8).forEach(r => out.push(`|${r.range}|必要${r.need}人|現在${r.have}人|${it.kind === 'lead' && !r.have ? '不在' : '不足' + (r.need - r.have) + '人'}`)); if (it.rows.length > 8) out.push(`…ほか${it.rows.length - 8}行`); });
  return out;
}
const shortCells = r => `<td><span class="lb">${esc(r.label)}</span>${r.kind === 'day' ? '' : esc(r.range)}</td><td>${r.need}人</td><td>${r.have}人</td><td class="miss">${missTxt(r)}</td>`;
const shortTable = k => { const rows = shortRows(k); return rows.length ? `<table class="lacktbl"><thead><tr><th>内容</th><th>必要</th><th>現在</th><th>不足</th></tr></thead><tbody>${rows.map(r => `<tr${r.ref ? ' class="ref"' : ''}>${shortCells(r)}</tr>`).join('')}</tbody></table>` : '<p class="meta">いまは解消しています。</p>'; };
const tipOf = k => { const d = parseYmd(k); return `${d.getMonth() + 1}/${d.getDate()}（${DOW[d.getDay()]}）：人数が不足しています\n` + shortDetail(k).join('\n'); };

function dayStat(k) {   // lack = 人数が足りない（1日の人数ルール、または時間帯ごとの最低人数）
  const { n, cnt, roleAt, H } = dayCover(k), dr = dayRuleOf(k), hs = shortageOf(cnt, roleAt, H), dayShort = dr ? Math.max(0, dr.min - n) : 0;
  return { n, cnt, short: hs, dayShort, over: !!(dr && dr.max != null && n > dr.max), rule: dr, lack: hs > 0 || dayShort > 0 };
}

/* 希望との食い違い：'req'=希望休の日 ／ 'out'=希望の時間外 */
const conflictOf = (sh, pref, s, k) => {   // 'req' 希望休の日 / 'out' 希望時間の外
  if (pref.status === 'off') return 'req';
  if (pref.status === 'time' && (tmin(sh.start) < tmin(pref.start) || tmin(sh.end) > tmin(pref.end))) return 'out';
  if (s && (s.avail || []).length) { const ok = new Set([...mainHours(s, k), ...subHours(s, k)]); if (shiftHourList(sh).some(h => !ok.has(h))) return 'out'; }
  return '';
};

/* 表の1マス（PC版） */
function shiftCell(s, k, pk, compact) {
  const sh = dayShifts(k)[s.id], pref = adminPref(s.id, k, pk), L = state.settings, attr = `data-id="${s.id}" data-d="${k}"`, c = compact ? ' c' : '', tc = k === todayKey() ? ' todaycol' : '';
  if (isWork(sh)) {
    const hrs = shiftHours(sh), over = hrs > L.limitDay, cf = conflictOf(sh, pref, s, k), stn = stationOf(s, sh), swSt = stn !== s.role;
    const title = `${s.name} ${hm(sh.start)}–${hm(sh.end)}（実働${fh(hrs)}時間${sh.brk ? '・休憩' + sh.brk + '分' : ''}${swSt ? '・持ち場：' + stn : ''}）${cf === 'req' ? ' ※希望休の日です' : cf === 'out' ? ' ※希望の時間外です' : ''}`;
    const tag = !cf ? '' : compact ? '<em class="tag">!</em>' : `<em class="tag">${cf === 'req' ? '休希望' : '時間外'}</em>`;
    const body = compact ? `<span>${hm(sh.start)}</span><span>${hm(sh.end)}</span>` : `${hm(sh.start)}–${hm(sh.end)}<small>${fh(hrs)}時間${over ? ' ⚠' : ''}${swSt ? '・' + esc(stn) : ''}</small>`;
    return { hrs, html: `<td class="scell on${over ? ' over' : ''}${c}${tc}" style="background:${roleColor(stn)}" title="${esc(title)}" ${attr}>${body}${tag}</td>` };
  }
  let cls, lab, title;
  if (!employedOn(s, k)) { cls = 'na'; lab = '—'; title = '入社前、または退職後'; }
  else if (pref.status === 'off') { cls = 'pf-off'; lab = '希望休'; title = '本人の希望休'; }
  else if (sh && sh.off) { cls = 'rest'; lab = '休み'; title = 'こちらで指定した休み'; }
  else if (pref.status === 'time') { cls = 'pf-time'; lab = compact ? `<span>${hm(pref.start)}</span><span>${hm(pref.end)}</span>` : `${hm(pref.start)}–${hm(pref.end)}<small>のみ可</small>`; title = `${hm(pref.start)}〜${hm(pref.end)} なら出勤可能`; }
  else { cls = 'pf-ok'; lab = '○'; title = '未決定（出勤可能）'; }
  return { hrs: 0, html: `<td class="scell empty ${cls}${c}${tc}" title="${esc(s.name + '：' + title)}" ${attr}>${lab}</td>` };
}

function renderShiftDesktop(keys, pk, el, ro) {
  el = el || $('#wGrid');
  const today = todayKey(), L = state.settings, anyWage = state.staff.length > 0, compact = keys.length > 14, nameW = compact ? 156 : NAME_W;
  const dayCount = Array(keys.length).fill(0), dayCost = Array(keys.length).fill(0), active = keys.some(hasShifts), stat = keys.map(k => dayStat(k));
  const lowAt = i => active && stat[i].lack, anyRule = stat.some(x => x.rule);
  let html = `<table class="gantt shiftgrid${compact ? ' compact' : ''}${ro ? ' ro' : ''}" style="width:100%;min-width:${nameW + keys.length * (compact ? 30 : 64)}px"><colgroup><col style="width:${nameW}px"></colgroup><thead><tr><th class="name">従業員</th>` +
    keys.map((k, i) => { const d = parseYmd(k), low = lowAt(i); return `<th class="${low ? 'low ' : ''}${k === today ? 'today ' : ''}${d.getDay() === 0 ? 'sun' : d.getDay() === 6 ? 'sat' : ''}" ${low ? ` data-tip="${esc(tipOf(k))}"` : ` title="${mdText(k)}（${DOW[d.getDay()]}）"`}>${compact && i && d.getDate() !== 1 ? d.getDate() : mdText(k)}<small>${compact ? DOW[d.getDay()] : '（' + DOW[d.getDay()] + '）'}</small>${k === today ? '<i class="todaymark">今日</i>' : ''}${low ? '<i class="warnmark">⚠</i>' : ''}</th>`; }).join('') + '</tr></thead><tbody>';
  shiftStaff(keys, pk).forEach(s => {
    const sb = subOf(s.id, pk); let tot = 0;
    const cells = keys.map((k, i) => {
      const c = shiftCell(s, k, pk, compact);
      if (c.hrs > 0 || isWork(dayShifts(k)[s.id])) { tot += c.hrs; dayCount[i]++; dayCost[i] += shiftCost(s, dayShifts(k)[s.id]); }
      return c.html;
    }).join('');
    const cost = keys.reduce((n, k) => n + shiftCost(s, dayShifts(k)[s.id]), 0);
    const incWarn = s.incomeCap && [...new Set(keys.map(k => k.slice(0, 7)))].some(ym => monthIncome(s, ym + '-01') > toDisp(s.incomeCap, 'JPY'));
    const overW = [...new Set(keys.map(k => ymd(mondayOf(parseYmd(k)))))].some(m => wkHours(s.id, m) > Math.min(L.limitWeek, s.weeklyMax || Infinity));
    html += `<tr><th class="name"><b>${esc(s.name)}</b><div class="meta">${esc(s.role || '役割なし')}${compact ? (sb ? '' : ' ・<span class="warnText">未提出</span>') : ` ／ <span class="${sb ? '' : 'warnText'}">${sb ? '希望提出済み' : '希望未提出'}</span>`}</div>
      <div class="meta${overW ? ' warnText' : ''}">${compact ? fh(tot) + 'h' : '合計' + fh(tot) + '時間'}・${money(cost)}${overW ? ' ⚠週超過' : ''}${incWarn ? ' ⚠収入上限' : ''}</div></th>${cells}</tr>`;
  });
  html += '</tbody><tfoot>';
  if (anyRule) html += '<tr class="need"><th class="name">必要人数<small>人数ルール</small></th>' + stat.map(st => `<td>${st.rule ? st.rule.min + (compact ? (st.rule.max == null ? '+' : '-' + st.rule.max) : '〜' + (st.rule.max == null ? '' : st.rule.max)) : '—'}</td>`).join('') + '</tr>';
  html += '<tr><th class="name">出勤人数</th>' + dayCount.map((n, i) => `<td class="${lowAt(i) ? 'low' : stat[i].over ? 'high' : ''}${keys[i] === today ? ' todaycol' : ''}" ${lowAt(i) ? ` data-tip="${esc(tipOf(keys[i]))}"` : stat[i].over ? ' title="最高人数を超えています"' : ''}>${n}${compact ? '' : '人'}</td>`).join('') + '</tr>';
  if (anyWage) html += '<tr><th class="name">人件費</th>' + dayCost.map(c => `<td>${c ? (compact ? Math.round(c / 1000) + 'k' : money(c)) : '—'}</td>`).join('') + '</tr>';
  el.innerHTML = html + '</tfoot></table>';
}

/* ---- スマホ版：月カレンダー（出勤人数つき）＋ 選んだ日の従業員一覧 ---- */
let mDay = null;
function renderShiftMobile(keys, pk) {
  const today = todayKey(), active = keys.some(hasShifts);
  if (!mDay || !keys.includes(mDay)) mDay = keys.includes(today) ? today : keys[0];
  let html = '<div class="mcal">' + DOW_MON.map(d => `<div class="dow">${d}</div>`).join('') + '<div class="mday blank"></div>'.repeat((aP.start.getDay() + 6) % 7);
  keys.forEach(k => {
    const d = parseYmd(k), st = dayStat(k), t = hasShifts(k), wd = d.getDay(), low = active && st.lack;
    html += `<button type="button" class="mday${k === mDay ? ' sel' : ''}${k === today ? ' today' : ''}${low ? ' low' : ''}${wd === 0 ? ' sun' : wd === 6 ? ' sat' : ''}" data-k="${k}"${low ? ` data-tip="${esc(tipOf(k))}"` : ''}><b>${d.getDate()}</b>${k === today ? '<em class="tdm">今日</em>' : ''}<span>${t ? st.n + '人' : '—'}</span>${low ? '<i class="wm">⚠</i>' : ''}</button>`;
  });
  html += '</div>';
  const d = parseYmd(mDay), st = dayStat(mDay), idx = keys.indexOf(mDay), t = hasShifts(mDay), low = active && st.lack;
  html += `<div class="mday-head"><button type="button" class="btn small" data-mnav="-1"${idx === 0 ? ' disabled' : ''} aria-label="前の日">‹</button><strong class="${low ? 'lack' : ''}">${d.getMonth() + 1}/${d.getDate()}（${DOW[d.getDay()]}）${low ? ' ⚠' : ''}</strong>` +
    `<button type="button" class="btn small" data-mnav="1"${idx === keys.length - 1 ? ' disabled' : ''} aria-label="次の日">›</button>` +
    `<span class="pill${low ? ' warn' : ' ok'}">${t ? st.n + '人' + (low ? '・人数が不足' : '') : '未作成'}</span>` +
    (st.rule ? `<span class="meta">必要 ${st.rule.min}${st.rule.max == null ? '人以上' : '〜' + st.rule.max + '人'}</span>` : '') + '</div>' +
    (low ? `<div class="mshort">${shortTable(mDay)}</div>` : '') + '<ul class="mlist">';
  shiftStaff(keys, pk).forEach(s => {
    const sh = dayShifts(mDay)[s.id], pref = adminPref(s.id, mDay, pk);
    let chip, cls = '', style = '';
    if (isWork(sh)) {
      const cf = conflictOf(sh, pref, s, mDay);
      const stn = stationOf(s, sh);
      chip = `${hm(sh.start)}–${hm(sh.end)}（${fh(shiftHours(sh))}時間）${stn !== s.role ? '・' + stn : ''}${cf === 'req' ? ' ※希望休の日' : cf === 'out' ? ' ※時間外' : ''}`; cls = 'work'; style = ` style="background:${roleColor(stn)}"`;
    } else if (pref.status === 'off') { chip = '希望休'; cls = 'pf-off'; }
    else if (sh && sh.off) { chip = '休み'; cls = 'rest'; }
    else if (pref.status === 'time') { chip = `${hm(pref.start)}–${hm(pref.end)} のみ可`; cls = 'pf-time'; }
    else { chip = '未決定（○）'; cls = 'pf-ok'; }
    html += `<li><button type="button" class="mrow" data-id="${s.id}" data-d="${mDay}"><span class="mname"><b>${esc(s.name)}</b><i>${esc(s.role || '役割なし')}</i></span><span class="mchip ${cls}"${style}>${chip}</span></button></li>`;
  });
  $('#wMobile').innerHTML = html + '</ul>';
}
$('#wMobile').addEventListener('click', e => {
  const day = e.target.closest('.mday[data-k]'), nav = e.target.closest('[data-mnav]'), row = e.target.closest('.mrow');
  if (day) { mDay = day.dataset.k; renderShift(); }
  else if (nav) { const keys = pKeys(aP), i = keys.indexOf(mDay) + +nav.dataset.mnav; if (keys[i]) { mDay = keys[i]; renderShift(); } }
  else if (row) activateCell(row.dataset.id, row.dataset.d);
});

function renderShift() {
  const p = aP, keys = pKeys(p), pk = ymd(p.start), pub = isPublished(), mobile = layout === 'mobile';
  $('#wLabel').textContent = pLabel(p);
  $('#wStatus').textContent = pub ? '確定済み' : '下書き'; $('#wStatus').className = 'pill' + (pub ? ' ok' : '');
  $('#wPublish').textContent = pub ? '確定を解除' : '確定する';
  $('#wJump').value = pk;
  $('#wDeadline').value = state.deadlines[pk] || '';
  const unsub = state.staff.filter(s => !subOf(s.id, pk)).length;
  $('#wDlInfo').textContent = `${deadlineText(pk)}・未提出${unsub}人`; $('#wDlInfo').className = 'pill' + (isClosed(pk) ? ' warn' : '');
  $('#wGrid').hidden = mobile; $('#wMobile').hidden = !mobile;
  $('#wGrid').classList.toggle('locked', pub); $('#wMobile').classList.toggle('locked', pub);
  if (!state.staff.length) {
    const msg = '<div class="empty">従業員がまだいません。「従業員」タブから登録してください。</div>';
    $('#wGrid').innerHTML = msg; $('#wMobile').innerHTML = msg; $('#wTotal').textContent = ''; $('#wReq').innerHTML = ''; return;
  }
  const mc = !!state.closed[pk]; $('#wCloseNow').textContent = mc ? '受付を再開する' : '今すぐ締め切る'; $('#wCloseNow').disabled = !mc && isClosed(pk);
  renderRuleNote(keys); renderShiftSortBar(); renderLackLine(keys);
  if (mobile) renderShiftMobile(keys, pk); else renderShiftDesktop(keys, pk);
  const anyWage = state.staff.length > 0;
  let grand = 0, grandCost = 0;
  state.staff.forEach(s => keys.forEach(k => { const h = shiftHours(dayShifts(k)[s.id]); grand += h; grandCost += shiftCost(s, dayShifts(k)[s.id]); }));
  $('#wTotal').textContent = grand ? `この期間の合計　${fh(grand)}時間${anyWage ? '・' + money(grandCost) : ''}` : '';
  renderReqPanel(keys, pk);
}

function renderReqPanel(keys, pk) {
  $('#wReq').innerHTML = `<h3>従業員からの希望（提出状況とコメント）</h3><p class="meta">${deadlineText(pk)}</p><ul class="reqlist">` + state.staff.map(s => {
    const sb = subOf(s.id, pk);
    const ent = sb ? Object.entries(sb.snap).filter(([k]) => keys.includes(k)) : [];
    const off = ent.filter(([, v]) => v.status === 'off').length, tm = ent.length - off;
    return `<li><div class="rq-head"><b>${esc(s.name)}</b><span class="pill${sb ? ' ok' : ''}">${sb ? '提出済み ' + fmtAt(sb.at) : '未提出'}</span>` +
      (sb ? `<span class="meta">希望休 ${off}日・時間指定 ${tm}日</span>` : '') + '</div>' +
      (sb && sb.comment ? `<div class="cmt">${esc(sb.comment)}</div>` : '') + '</li>';
  }).join('') + '</ul>';
}

/* 期間の移動・提出締切 */
$('#wPrev').addEventListener('click', () => { aP = periodOf(addDays(aP.start, -1)); renderShift(); });
$('#wNext').addEventListener('click', () => { aP = periodOf(aP.end); renderShift(); });
$('#wToday').addEventListener('click', () => { aP = periodOf(new Date()); renderShift(); });
$('#wJump').addEventListener('change', () => { if ($('#wJump').value) { aP = periodOf(parseYmd($('#wJump').value)); renderShift(); } });
$('#wDeadline').addEventListener('change', () => {
  const pk = ymd(aP.start), v = $('#wDeadline').value;
  if (v) { state.deadlines[pk] = v; ui.toast(`提出締切を ${mdText(v)} にしました`); } else delete state.deadlines[pk];
  save(); renderShift();
});
$('#wDlClear').addEventListener('click', () => {
  const pk = ymd(aP.start);
  if (!state.deadlines[pk]) return ui.toast('この期間に個別の締切は設定されていません', 'warn');
  delete state.deadlines[pk]; save(); renderShift(); ui.toast('この期間の締切の指定を解除しました');
});

const lockedMsg = () => ui.toast('確定済みの期間です。変更するには「確定を解除」を押してください', 'warn');
$('#wCopy').addEventListener('click', async () => {
  if (isPublished()) return lockedMsg();
  const keys = pKeys(aP), prev = pKeys(periodOf(addDays(aP.start, -1)));
  if (!prev.some(hasShifts)) return ui.toast('前の期間にシフトがありません', 'warn');
  if (keys.some(hasShifts) && !await ui.ask('この期間のシフトを、前の期間の内容で上書きします。よろしいですか？', { ok: '上書きする', danger: true })) return;
  keys.forEach((k, i) => { if (prev[i] && hasShifts(prev[i])) state.shifts[k] = JSON.parse(JSON.stringify(state.shifts[prev[i]])); else delete state.shifts[k]; });
  save(); renderShift(); ui.toast('前の期間のシフトをコピーしました');
});
$('#wClear').addEventListener('click', async () => {
  if (isPublished()) return lockedMsg();
  const keys = pKeys(aP);
  if (!keys.some(hasShifts)) return ui.toast('この期間にシフトはありません', 'warn');
  if (!await ui.ask('この期間のシフトをすべて消します。よろしいですか？', { ok: '空にする', danger: true })) return;
  keys.forEach(k => delete state.shifts[k]); save(); renderShift(); ui.toast('この期間のシフトを空にしました');
});
$('#wPublish').addEventListener('click', async () => {
  const pk = ymd(aP.start);
  if (isPublished()) { delete state.published[pk]; save(); renderShift(); return ui.toast('確定を解除しました（下書きに戻しました）'); }
  if (!pKeys(aP).some(hasWork)) return ui.toast('確定するシフトがありません', 'warn');
  if (!await ui.ask('この期間のシフトを確定します。確定中は編集できません（解除すればまた編集できます）。', { ok: '確定する' })) return;
  state.published[pk] = true; save(); renderShift(); ui.toast('この期間のシフトを確定しました');
});

/* ---- 期間まるごと自動作成 ----
   希望休は必ず守る。人手が足りない日は、設定「人手が足りないときの対応」に従って、段階的に条件をゆるめて補う。
   level 0=通常 ／ 1=予備の時間・休みの日をゆるめる ／ 2=さらに時間指定・勤務時間の上限・連続勤務の上限もゆるめる */
function autoShifts(p, keep) {
  const keys = pKeys(p), R = state.autoRules, S = state.settings, H = hoursList(), pk = ymd(p.start);
  const fairP = [0, 0.15, 0.3, 0.6][R.fair], total = {}, shortDays = [], relaxed = { soft: 0, hard: 0 };
  const maxLevel = R.fix === 'off' ? 0 : 1;   // ゆるめるのは、予備の時間・休みの日まで
  const hrsOf = x => isWork(x) ? shiftHours(x) : 0;
  state.staff.forEach(s => total[s.id] = 0);
  keys.forEach(k => {   // 「残す」のときは、自動で作った分だけを消す（手で入れたシフト・休みは固定）
    if (keep && state.shifts[k]) { Object.keys(state.shifts[k]).forEach(id => { if (state.shifts[k][id].auto) delete state.shifts[k][id]; }); if (!hasShifts(k)) delete state.shifts[k]; }
    else delete state.shifts[k];
    state.staff.forEach(s => { total[s.id] += hrsOf(dayShifts(k)[s.id]); });
  });
  const streakOf = (id, k) => { let n = 0; for (let i = 1; i <= S.maxStreak; i++) { if (isWork(dayShifts(ymd(addDays(parseYmd(k), -i)))[id])) n++; else break; } return n; };
  const build = (k, level, fixed) => {   // その日に入れられる人（希望休・希望時間の外は、どの段階でも対象にしない）
    const P = [];
    state.staff.forEach((s, idx) => {
      if (fixed.has(s.id)) return;
      if (!employedOn(s, k)) return;                                                      // 入社前・退職後
      const pref = adminPref(s.id, k, pk);
      if (pref.status === 'off') return;
      if (streakOf(s.id, k) >= S.maxStreak) return;                                       // 連続勤務の上限
      let room = Math.min(S.limitDay, S.limitWeek - wkHours(s.id, k));                   // 1日・週の注意ライン
      if (s.weeklyMax) room = Math.min(room, s.weeklyMax - wkHours(s.id, k));            // 本人の週の上限時間
      if (s.incomeCap) room = Math.min(room, (toDisp(s.incomeCap, 'JPY') - monthIncome(s, k)) / Math.max(1, hourly(s)));   // 本人の月の上限収入
      if (room < 1) return;
      let main = mainHours(s, k), sub = (R.sub === 'never' && level < 1) ? [] : subHours(s, k);
      if (pref.status === 'time') {                                                      // 本人の時間指定の中だけ
        const lo = toH(pref.start), hi = toH(pref.end, true);
        main = main.filter(h => h >= lo && h < hi); sub = sub.filter(h => h >= lo && h < hi);
      }
      main = main.filter(h => H.includes(h)); sub = sub.filter(h => H.includes(h));
      if (isMinor(s, k)) { main = main.filter(h => !nightLegal(h)); sub = sub.filter(h => !nightLegal(h)); }   // 18歳未満は、22時〜翌5時に入れない
      if (!main.length && !sub.length) return;
      const base = (R.target === 'ignore' || level >= 1) ? Infinity : mainHours(s, k).length;
      P.push(makeP(s, main, sub, Math.min(base, room), total[s.id] * fairP, level < 1 && parseYmd(k).getDay() === (idx + 1) % 7));   // 週に1日は、従業員ごとに曜日をずらして休み
    });
    return P;
  };
  const recFrom = (hrs, allowed) => {   // 希望時間の中で、つながった1つのシフトにする（あいた時間は、希望時間の中のときだけつなぐ）
    hrs = hrs.slice().sort((a, b) => a - b); if (!hrs.length) return null;
    const blocks = [];
    hrs.forEach(h => {
      const b = blocks[blocks.length - 1];
      let join = false;
      if (b && h - b.e <= 3) { join = true; for (let x = b.e + 1; x < h; x++) if (!allowed.has(x)) join = false; }
      if (join) { b.e = h; b.n++; } else blocks.push({ s: h, e: h, n: 1 });
    });
    const bk = blocks.reduce((a, b) => b.n > a.n ? b : a);
    return { start: pad2(bk.s) + ':00', end: pad2(bk.e + 1) + ':00', brk: legalBreak(bk.e + 1 - bk.s) };
  };
  const capH2 = h => R.fill === 'min' ? rule(h).min : R.fill === 'mid' ? Math.ceil((rule(h).min + rule(h).max) / 2) : rule(h).max;
  const workerCap = k => {   // その日に出勤する人数の目安（全員を入れず、公平に回すための上限）
    const dr0 = dayRuleOf(k);
    if (dr0) return R.fill === 'min' ? dr0.min : dr0.max == null ? null : R.fill === 'max' ? dr0.max : Math.ceil((dr0.min + dr0.max) / 2);
    return R.fill === 'max' ? null : Math.max(1, Math.ceil(H.reduce((n, h) => n + capH2(h), 0) / 6));   // 人数ルールがないときは、必要な時間数から見積もる
  };
  keys.forEach(k => {
    const seed = dayCover(k);   // 手で入れたシフトの分は、人数として数える
    let best = null, bestShort = Infinity, used = 0;
    for (let lv = 0; lv <= maxLevel; lv++) {
      const P = build(k, lv, new Set(Object.keys(dayShifts(k)))), res = solveHours(P, H, seed, workerCap(k)), sc = shortageOf(res.cnt, res.roleAt, H);
      if (sc < bestShort) { best = { P, res }; bestShort = sc; used = lv; }
      if (sc === 0) break;
    }
    if (used === 1) relaxed.soft++;
    best.P.forEach(({ s, main, sub }) => {
      const rec = recFrom(best.res.sch[s.id], new Set([...main, ...sub])); if (!rec) return;
      (state.shifts[k] = state.shifts[k] || {})[s.id] = { ...rec, auto: true }; total[s.id] += shiftHours(rec);
    });
    // 日ごとの人数ルール（最低・最高）を反映する
    const dr = dayRuleOf(k), wk = () => state.staff.filter(s => isWork(dayShifts(k)[s.id])), cov = () => { const c = dayCover(k); return shortageOf(c.cnt, c.roleAt, H); };
    if (dr) {
      if (dr.max != null && wk().length > dr.max) {   // 多いときは、自動で入れた人から、時間帯の最低人数を割らない範囲で減らす
        for (const s of wk().filter(x => dayShifts(k)[x.id].auto).sort((a, b) => (total[b.id] - total[a.id]) || (a.rating - b.rating))) {   // 勤務の多い人から減らす
          if (wk().length <= dr.max) break;
          const rec = state.shifts[k][s.id], before = cov();
          delete state.shifts[k][s.id];
          if (cov() > before) state.shifts[k][s.id] = rec; else total[s.id] -= shiftHours(rec);
        }
      }
      for (let lv = used; wk().length < dr.min && lv <= maxLevel; lv++) {   // 足りないときは、出勤できる人を足す（希望時間の中だけ）
        const cands = build(k, lv, new Set(Object.keys(dayShifts(k)))).sort((a, b) => (a.bias - b.bias) || (b.s.rating - a.s.rating));
        for (const pp of cands) {
          if (wk().length >= dr.min) break;
          const allowed = new Set([...pp.main, ...pp.sub]), hrs = [...allowed].sort((a, b) => a - b);
          const rec = recFrom(hrs.slice(0, Math.max(1, Math.min(isFinite(pp.target) ? pp.target : hrs.length, hrs.length, 12))), allowed);
          if (!rec) continue;
          (state.shifts[k] = state.shifts[k] || {})[pp.s.id] = { ...rec, auto: true }; total[pp.s.id] += shiftHours(rec);
        }
      }
    }
    if (cov() > 0 || (dr && wk().length < dr.min)) shortDays.push(k);
    // 勤務のない日は「休み」にする（希望休の日は、希望休のまま）
    state.staff.forEach(s => { if (!dayShifts(k)[s.id] && adminPref(s.id, k, pk).status !== 'off') (state.shifts[k] = state.shifts[k] || {})[s.id] = { off: true, auto: true }; });
  });
  return { shortDays, relaxed };
}