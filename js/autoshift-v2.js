'use strict';

/* ========== シフト自動作成 v2：期間全体を見渡して、入れ替えながら良くしていく ==========
   1) 従来の方式で初期案を作る  2) 「人数不足・責任者・休みの連続・連勤・勤務間の時間・週の日数・公平さ・個人の上限」をまとめて点数にして、
   従業員の入れ替え・日の入れ替えを繰り返して点数を下げる（希望休・在籍・勤務可能曜日・時間・18歳未満の深夜は、最初から候補に入れない）
   3) 足りない日の理由と、相談できる人（休みを指定されている人が先、希望休の人は最後の手段）をまとめる */
let lastReport = null, a2Seed = 0, busyStop = false;
const yieldUI = () => new Promise(r => setTimeout(r, 0)), paintUI = () => new Promise(r => setTimeout(r, 40));
const busyUI = {
  show(msg, sub) { $('#busyMsg').textContent = msg; $('#busySub').textContent = sub || ''; $('#busyBar').style.width = '0%'; $('#busy').hidden = false; },
  set(f) { $('#busyBar').style.width = Math.round(f * 100) + '%'; },
  hide() { $('#busy').hidden = true; }
};
function prng32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const strSeed = str => { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const nowMs = () => (typeof performance !== 'undefined' ? performance : Date).now();

async function autoShiftsV2(p, keep, seedOffset, onProgress) {
  const A = state.settings.auto2, R = state.autoRules, S = state.settings;
  const t0 = nowMs(), budget = Math.max(300, (A.secs || 2) * 1000);
  const init = autoShifts(p, keep);   // 初期案
  const keys = pKeys(p), D = keys.length, H = hoursList(), Hn = H.length, E = state.staff, N = E.length, pk = ymd(p.start);
  if (!N || !D || !Hn) return init;
  const rng = prng32(strSeed(pk + ':' + N + ':' + (seedOffset || 0))), rint = n => Math.floor(rng() * n);   // 同じ条件なら同じ案。「別の案」は番号を変える
  const lv = x => [0, 0.5, 1, 2][x] || 0, h0 = H[0];
  const W = { short: 100, dayShort: 120, over: 20, sur: R.fill === 'max' ? 0 : 1.5, lead: 40, hard: 300, int: 100, rest: 25, days: 8, fair: 8 * lv(R.fair), fairWe: 4 * lv(R.fair), income: 30,
    sub: R.sub === 'never' ? 30 : R.sub === 'always' ? 0 : 3, flex: 3, cost: [0, 0.002, 0.006, 0.015][R.wage] || 0, rate: [0, 0.1, 0.2, 0.4][R.rating] || 0 };
  const patterns = state.patterns.filter(x => x.start && x.end && x.days.length);
  const dow = keys.map(k => parseYmd(k).getDay()), isWE = dow.map(x => x === 0 || x === 6);
  const mon0 = (dow[0] + 6) % 7, wk = keys.map((_, d) => Math.floor((d + mon0) / 7)), nW = wk[D - 1] + 1, wdays = new Array(nW).fill(0); wk.forEach(w => wdays[w]++);
  const ym = keys.map(k => k.slice(0, 7)), months = [...new Set(ym)], mi = ym.map(m => months.indexOf(m)), nM = months.length;
  const rmin = H.map(h => rule(h).min), rmax = H.map(h => rule(h).max);
  const rtgt = H.map((h, i) => R.fill === 'min' ? rmin[i] : R.fill === 'max' ? rmax[i] : Math.ceil((rmin[i] + rmax[i]) / 2));
  const roleNames = state.roles.map(r => r.name), RN = roleNames.length + 1;
  const ri = E.map(s => { const i = roleNames.indexOf(s.role); return i < 0 ? RN - 1 : i; });
  // 兼務：skl＝その人が入れる持ち場（役割の番号）、defSt＝ふだん入る持ち場、stn＝その日に入る持ち場（日ごとに1つ）
  const skl = E.map(s => { const a = []; skillsOf(s).forEach(nm => { const i = roleNames.indexOf(nm); if (i >= 0 && !a.includes(i)) a.push(i); }); return a.length ? a : [RN - 1]; });
  const defSt = E.map((s, e) => skl[e].includes(ri[e]) ? ri[e] : skl[e][0]), stn = new Int16Array(N * D).fill(-1);
  const multiIdx = []; skl.forEach((a, e) => { if (a.length > 1) multiIdx.push(e); });
  const stIdx = (s, sh) => { const k2 = roleNames.indexOf(stationOf(s, sh)); return k2 < 0 ? RN - 1 : k2; };
  const isLead = E.map(s => !!(state.roles.find(r => r.name === s.role) || {}).lead), leadMin = (A.leadMin > 0 && isLead.some(Boolean)) ? A.leadMin : 0;
  const rr = roleNames.map((n, i) => ({ i, q: state.roleRules[n] })).filter(x => x.q && (x.q.min || x.q.max != null));
  const dayRule = keys.map(k => dayRuleOf(k));

  // ---- 候補（誰が・どの日に・どの時間帯で入れるか）----
  const cands = new Array(N * D), fixedRec = new Array(N * D), fixedCand = new Array(N * D), autoOffOk = new Uint8Array(N * D), hasCand = new Uint8Array(N), weEl = new Uint8Array(N), autoCnt = new Uint8Array(N * D);   // autoCnt：出勤できたのに入らなかった日（自動の休みとして数える）
  const mkCand = (s, a, b, pat, subSet) => {
    const len = b - a, brk = legalBreak(len), work = len - brk / 60;
    if (work > S.limitDay + 1e-9 && !pat) return null;
    let sub = 0; for (let h = a; h < b; h++) if (subSet.has(h)) sub++;
    const rec = { start: pad2(a) + ':00', end: pad2(b) + ':00', brk }, cost = shiftCost(s, rec);
    return { a, b, len, brk, work, pat, cost, base: sub * W.sub + (patterns.length && !pat ? W.flex : 0) + Math.max(0, 4 - len) * 3 - W.rate * s.rating * work + W.cost * cost };
  };
  E.forEach((s, e) => keys.forEach((k, d) => {
    const i = e * D + d, rec = dayShifts(k)[s.id], fx = rec && !rec.auto ? rec : null, pref = adminPref(s.id, k, pk), emp = employedOn(s, k);
    fixedRec[i] = fx; autoOffOk[i] = (emp && pref.status !== 'off') ? 1 : 0; cands[i] = [];
    if (fx) { if (!isWork(fx)) autoCnt[i] = 1; if (isWork(fx)) { const a = Math.floor(tmin(fx.start) / 60), b = Math.ceil(tmin(fx.end) / 60); fixedCand[i] = mkCand(s, a, b, true, new Set()) || { a, b, len: b - a, brk: fx.brk || 0, work: shiftHours(fx), pat: true, cost: shiftCost(s, fx), base: 0 }; fixedCand[i].base = 0; stn[i] = stIdx(s, fx); } return; }
    if (!emp || pref.status === 'off') return;
    let main = mainHours(s, k).filter(h => H.includes(h)), sub = subHours(s, k).filter(h => H.includes(h));
    if (pref.status === 'time') { const lo = toH(pref.start), hi = toH(pref.end, true); main = main.filter(h => h >= lo && h < hi); sub = sub.filter(h => h >= lo && h < hi); }
    if (isMinor(s, k)) { main = main.filter(h => !nightLegal(h)); sub = sub.filter(h => !nightLegal(h)); }
    const subSet = new Set(sub), U = [...new Set([...main, ...sub])].sort((x, y) => x - y), Uset = new Set(U), seen = new Set();
    let list = [];
    const add = (a, b, pat) => { const key = a * 100 + b; if (seen.has(key)) return; seen.add(key); const c = mkCand(s, a, b, pat, subSet); if (c) list.push(c); };
    patterns.forEach(x => { if (!x.days.includes(dow[d])) return; const a = toH(x.start), b = toH(x.end, true); let ok = b > a; for (let h = a; h < b && ok; h++) if (!Uset.has(h)) ok = false; if (ok) add(a, b, true); });
    if (!patterns.length || A.flex) {
      for (let x = 0; x < U.length;) {   // つながった時間のかたまりごとに、いろいろな長さ・開始時刻の候補を作る
        let y = x; while (y + 1 < U.length && U[y + 1] === U[y] + 1) y++;
        const bs = U[x], be = U[y], B = be - bs + 1;
        if (B >= 2) for (let len = Math.min(B, 3); len <= Math.min(B, 10); len++) for (let st = bs; st + len - 1 <= be; st++) add(st, st + len, false);
        x = y + 1;
      }
    }
    if (list.length > 60) { const pats = list.filter(c => c.pat), free = list.filter(c => !c.pat); for (let j = free.length - 1; j > 0; j--) { const r = rint(j + 1); [free[j], free[r]] = [free[r], free[j]]; } list = pats.concat(free.slice(0, 60 - pats.length)); }
    cands[i] = list; if (list.length) { hasCand[e] = 1; autoCnt[i] = 1; if (isWE[d]) weEl[e] = 1; }
  }));

  // ---- 状態 ----
  const cur = new Int32Array(N * D).fill(-1), cov = new Int16Array(D * Hn), lcov = new Int16Array(D * Hn), rcov = new Int16Array(D * Hn * RN);
  const workers = new Int16Array(D), days = new Int16Array(N), we = new Int16Array(N);
  E.forEach((s, e) => keys.forEach((k, d) => {   // 初期案を、候補に対応づける
    const i = e * D + d, rec = dayShifts(k)[s.id]; if (fixedRec[i] || !isWork(rec)) return;
    const a = Math.floor(tmin(rec.start) / 60), b = Math.ceil(tmin(rec.end) / 60);
    let ci = cands[i].findIndex(c => c.a === a && c.b === b);
    autoCnt[i] = 1;
    if (ci < 0) { const c = mkCand(s, a, b, false, new Set()) || { a, b, len: b - a, brk: rec.brk || 0, work: shiftHours(rec), pat: false, cost: shiftCost(s, rec), base: 0 }; cands[i].push(c); ci = cands[i].length - 1; hasCand[e] = 1; }
    cur[i] = ci; const sx = rec.st ? roleNames.indexOf(rec.st) : -1; stn[i] = skl[e].includes(sx) ? sx : defSt[e];
  }));
  const candAt = (e, d) => { const i = e * D + d; return fixedCand[i] || (cur[i] >= 0 ? cands[i][cur[i]] : null); };
  const addC = (e, d, c, sg) => {
    for (let h = c.a; h < c.b; h++) { const q = d * Hn + (h - h0); if (h - h0 < 0 || h - h0 >= Hn) continue; cov[q] += sg; if (isLead[e]) lcov[q] += sg; rcov[q * RN + (stn[e * D + d] >= 0 ? stn[e * D + d] : ri[e])] += sg; }
    workers[d] += sg; days[e] += sg; if (isWE[d]) we[e] += sg;
  };
  const setCell = (e, d, idx, st) => { const i = e * D + d, old = cur[i]; if (old >= 0) addC(e, d, cands[i][old], -1); cur[i] = idx; stn[i] = idx >= 0 ? (st !== undefined ? st : defSt[e]) : -1; if (idx >= 0) addC(e, d, cands[i][idx], 1); };
  const rebuild = () => { cov.fill(0); lcov.fill(0); rcov.fill(0); workers.fill(0); days.fill(0); we.fill(0); for (let e = 0; e < N; e++) for (let d = 0; d < D; d++) { const c = candAt(e, d); if (c) addC(e, d, c, 1); } };

  // ---- 期間の外にある勤務（週・月・連勤・勤務間の時間の計算に使う）----
  const keySet = new Set(keys), outH = new Float64Array(N * nW), outD = new Int16Array(N * nW), baseInc = new Float64Array(N * nM), preRun = new Int16Array(N), preEnd = new Int16Array(N).fill(-1);
  const first = parseYmd(keys[0]);
  Object.keys(state.shifts).forEach(dt => {
    if (keySet.has(dt)) return;
    const off = Math.round((parseYmd(dt) - first) / 864e5) + mon0, w = Math.floor(off / 7), m = months.indexOf(dt.slice(0, 7));
    E.forEach((s, e) => { const sh = state.shifts[dt][s.id]; if (!isWork(sh)) return; if (off >= 0 && w < nW) { outH[e * nW + w] += shiftHours(sh); outD[e * nW + w]++; } if (m >= 0) baseInc[e * nM + m] += shiftCost(s, sh); });
  });
  E.forEach((s, e) => { for (let i = 1; i <= S.maxStreak + 1; i++) { const sh = dayShifts(ymd(addDays(first, -i)))[s.id]; if (isWork(sh)) { preRun[e]++; if (i === 1) preEnd[e] = Math.ceil(tmin(sh.end) / 60); } else break; } });
  const dlo = new Float64Array(N), dhi = new Float64Array(N), midT = new Float64Array(N), cap = new Float64Array(N), wLim = new Float64Array(N);
  E.forEach((s, e) => { const dp = s.dpw || A.dpw; const any = hasCand[e] || keys.some((k, d) => fixedCand[e * D + d]); dlo[e] = any ? dp.min : 0; dhi[e] = any ? dp.max : 0; midT[e] = (dlo[e] + dhi[e]) / 2 * D / 7; cap[e] = s.incomeCap ? toDisp(s.incomeCap, 'JPY') : 0; wLim[e] = Math.min(S.limitWeek, s.weeklyMax || Infinity); });

  // 兼務できる人は、その日に入る持ち場を「人数が足りない持ち場」から選ぶ
  const rmnR = roleNames.map(n => (state.roleRules[n] && state.roleRules[n].min) || 0), rmxR = roleNames.map(n => { const q = state.roleRules[n]; return q && q.max != null ? q.max : Infinity; });
  const pickSt = (e, d, c) => {
    const sk = skl[e]; if (sk.length < 2) return defSt[e];
    const i = e * D + d, had = cur[i] >= 0 && cands[i][cur[i]] === c; if (had) addC(e, d, c, -1);   // いまの自分の分は、数えない状態で比べる
    let best = defSt[e], bs = -1e9;
    sk.forEach(r => { let sc = r === defSt[e] ? 0.5 : 0; for (let h = c.a; h < c.b; h++) { const q = d * Hn + (h - h0); if (h - h0 < 0 || h - h0 >= Hn) continue; const v = rcov[q * RN + r]; if (rmnR[r] && v < rmnR[r]) sc += 3 * (rmnR[r] - v); else if (v >= rmxR[r]) sc -= 3; } if (sc > bs) { bs = sc; best = r; } });
    if (had) addC(e, d, c, 1);
    return best;
  };

  // ---- 点数（低いほど良い）----
  const dayCost = d => {
    let c = 0; const b = d * Hn;
    for (let i = 0; i < Hn; i++) {
      const v = cov[b + i];
      if (v < rmin[i]) c += W.short * (rmin[i] - v); else { if (v > rmax[i]) c += W.over * (v - rmax[i]); if (v > rtgt[i]) c += W.sur * (v - rtgt[i]); }
      if (leadMin && lcov[b + i] < leadMin) c += W.lead * (leadMin - lcov[b + i]);
    }
    for (let j = 0; j < rr.length; j++) { const { i: r, q } = rr[j]; for (let i = 0; i < Hn; i++) { const v = rcov[(b + i) * RN + r]; if (q.min && v < q.min) c += W.short * (q.min - v); if (q.max != null && v > q.max) c += W.over * (v - q.max); } }
    const dr = dayRule[d]; if (dr) { const n = workers[d]; if (n < dr.min) c += W.dayShort * (dr.min - n); if (dr.max != null && n > dr.max) c += W.over * (n - dr.max); }
    return c;
  };
  const wCnt = new Float64Array(nW), wHr = new Float64Array(nW), inc = new Float64Array(nM);
  const empCost = e => {
    let c = 0, run = preRun[e], prevEnd = preEnd[e], autoOff = 0; wCnt.fill(0); wHr.fill(0); inc.fill(0);
    for (let d = 0; d < D; d++) {
      const cd = candAt(e, d);
      if (cd) {
        run++; if (run > S.maxStreak) c += W.hard;
        wCnt[wk[d]]++; wHr[wk[d]] += cd.work; inc[mi[d]] += cd.cost; c += cd.base;
        if (prevEnd >= 0) { const gap = 24 - prevEnd + cd.a; if (gap < A.interval) c += W.int * (A.interval - gap); }
        prevEnd = cd.b; if (autoOff > A.restMax) c += W.rest * (autoOff - A.restMax); autoOff = 0;
      } else { run = 0; prevEnd = -1; if (autoCnt[e * D + d]) autoOff++; }
    }
    if (autoOff > A.restMax) c += W.rest * (autoOff - A.restMax);
    for (let w = 0; w < nW; w++) {
      const fr = wdays[w] / 7, lo = fr === 1 ? dlo[e] : Math.floor(dlo[e] * fr), hi = fr === 1 ? dhi[e] : Math.ceil(dhi[e] * fr), td = wCnt[w] + outD[e * nW + w], th = wHr[w] + outH[e * nW + w];
      if (td < lo) c += W.days * (lo - td); else if (td > hi) c += W.days * (td - hi);
      if (th > wLim[e]) c += W.hard * (th - wLim[e]);
    }
    if (cap[e]) for (let m = 0; m < nM; m++) { const t = inc[m] + baseInc[e * nM + m]; if (t > cap[e]) c += W.income * (t - cap[e]) / 1000; }
    return c;
  };
  const fairCost = () => {
    if (!W.fair) return 0;
    let sD = 0, sM = 0, c = 0; for (let e = 0; e < N; e++) { sD += days[e]; sM += midT[e]; }
    if (sM > 0) { const avg = sD / sM; for (let e = 0; e < N; e++) if (midT[e] > 0) { const dv = days[e] - avg * midT[e]; c += W.fair * dv * dv / midT[e]; } }
    let sw = 0, ne = 0; for (let e = 0; e < N; e++) if (weEl[e]) { sw += we[e]; ne++; }
    if (ne) { const a = sw / ne; for (let e = 0; e < N; e++) if (weEl[e]) { const dv = we[e] - a; c += W.fairWe * dv * dv; } }
    return c;
  };

  // ---- 入れ替えを繰り返す ----
  rebuild();
  for (let d = 0; d < D; d++) for (const e of multiIdx) { const i = e * D + d; if (fixedRec[i] || cur[i] < 0) continue; const c = cands[i][cur[i]], ns = pickSt(e, d, c); if (ns !== stn[i]) { addC(e, d, c, -1); stn[i] = ns; addC(e, d, c, 1); } }   // 最初の持ち場の割り振り
  const dayC = new Float64Array(D), empC = new Float64Array(N); let fairC = 0, total = 0;
  const recompute = () => { total = 0; for (let d = 0; d < D; d++) { dayC[d] = dayCost(d); total += dayC[d]; } for (let e = 0; e < N; e++) { empC[e] = empCost(e); total += empC[e]; } fairC = fairCost(); total += fairC; };
  recompute(); const startCost = total;
  const attempt = (chs, T, probe) => {
    const ds = [], es = []; chs.forEach(([e, d]) => { if (!ds.includes(d)) ds.push(d); if (!es.includes(e)) es.push(e); });
    let before = fairC; ds.forEach(d => { before += dayC[d]; }); es.forEach(e => { before += empC[e]; });
    const olds = chs.map(([e, d]) => cur[e * D + d]), oldSt = chs.map(([e, d]) => stn[e * D + d]);
    chs.forEach(([e, d, idx]) => setCell(e, d, idx, idx >= 0 ? pickSt(e, d, cands[e * D + d][idx]) : undefined));
    const nf = fairCost(), nd = ds.map(d => dayCost(d)), ne = es.map(e => empCost(e));
    let after = nf; nd.forEach(x => { after += x; }); ne.forEach(x => { after += x; });
    const delta = after - before;
    if (!probe && (delta <= 0 || rng() < Math.exp(-delta / T))) { ds.forEach((d, j) => { dayC[d] = nd[j]; }); es.forEach((e, j) => { empC[e] = ne[j]; }); fairC = nf; total += delta; return true; }
    for (let j = chs.length - 1; j >= 0; j--) setCell(chs[j][0], chs[j][1], olds[j], olds[j] >= 0 ? oldSt[j] : undefined);
    return probe ? delta : false;
  };
  const attemptStation = (e, d, ns, T) => {   // 持ち場だけを変える（シフトの時間は同じ）
    const i = e * D + d, c = cands[i][cur[i]], os = stn[i], before = dayC[d];
    addC(e, d, c, -1); stn[i] = ns; addC(e, d, c, 1);
    const nd = dayCost(d), delta = nd - before;
    if (delta <= 0 || rng() < Math.exp(-delta / T)) { dayC[d] = nd; total += delta; return true; }
    addC(e, d, c, -1); stn[i] = os; addC(e, d, c, 1); return false;
  };
  const randCell = () => { for (let t = 0; t < 10; t++) { const e = rint(N), d = rint(D), i = e * D + d; if (cands[i].length) return [e, d]; } return null; };
  const shortHours = d => { const o = [], b = d * Hn; for (let i = 0; i < Hn; i++) if (cov[b + i] < rmin[i] || (leadMin && lcov[b + i] < leadMin)) o.push(i); return o; };
  let shortDaysList = [], iters = 0, best = total, lastY = nowMs(); const bestCur = Int32Array.from(cur), bestStn = Int16Array.from(stn);
  const tOpt = nowMs(), remain = Math.max(100, budget - (tOpt - t0));
  while (true) {
    if ((iters & 127) === 0) {
      const el = nowMs() - tOpt; if (el >= remain || busyStop) break;
      if (nowMs() - lastY > 40) { if (onProgress) onProgress(Math.min(1, el / remain)); await yieldUI(); lastY = nowMs(); }   // 画面の「作成中」を動かすため、ときどき処理を譲る
      if ((iters & 255) === 0) { shortDaysList = []; for (let d = 0; d < D; d++) if (dayC[d] > 0 && (shortHours(d).length || (dayRule[d] && workers[d] < dayRule[d].min))) shortDaysList.push(d); }
      var T = 30 * Math.pow(0.5 / 30, el / remain);
    }
    iters++;
    const r = rng(); let done = false;
    if (multiIdx.length && rng() < 0.12) {   // 兼務できる人の持ち場を入れ替える
      const e = multiIdx[rint(multiIdx.length)], dd = []; for (let d = 0; d < D; d++) { const i = e * D + d; if (!fixedRec[i] && cur[i] >= 0) dd.push(d); }
      if (dd.length) { const d = dd[rint(dd.length)], i = e * D + d, ns = skl[e][rint(skl[e].length)]; if (ns !== stn[i]) attemptStation(e, d, ns, T); }
      continue;
    }
    if (r < 0.4 && shortDaysList.length) {   // 人数が足りない日に、入れる人を足す
      const d = shortDaysList[rint(shortDaysList.length)], hs = shortHours(d), hh2 = hs.length ? hs[rint(hs.length)] + h0 : null, s0 = rint(N);
      for (let t = 0; t < N && !done; t++) {
        const e = (s0 + t) % N, i = e * D + d; if (fixedRec[i] || cur[i] >= 0 || !cands[i].length) continue;
        const ok = []; cands[i].forEach((c, ci) => { if (hh2 === null || (hh2 >= c.a && hh2 < c.b)) ok.push(ci); });
        if (ok.length) { attempt([[e, d, ok[rint(ok.length)]]], T); done = true; }
      }
    }
    if (done) continue;
    if (r < 0.6) { const x = randCell(); if (x) { const i = x[0] * D + x[1]; attempt([[x[0], x[1], rint(cands[i].length + 1) - 1]], T); } }
    else if (r < 0.8) {   // その日の中で、働く人と休みの人を入れ替える
      const d = rint(D), a = [], b = []; for (let e = 0; e < N; e++) { const i = e * D + d; if (fixedRec[i]) continue; if (cur[i] >= 0) a.push(e); else if (cands[i].length) b.push(e); }
      if (a.length && b.length) { const e1 = a[rint(a.length)], e2 = b[rint(b.length)], c1 = cands[e1 * D + d][cur[e1 * D + d]]; const l2 = cands[e2 * D + d]; let ci = l2.findIndex(c => c.a === c1.a && c.b === c1.b); if (ci < 0) ci = rint(l2.length); attempt([[e1, d, -1], [e2, d, ci]], T); }
    } else {   // 同じ人の勤務を、別の日に動かす（休みの連続をほぐす）
      const e = rint(N), a = [], b = []; for (let d = 0; d < D; d++) { const i = e * D + d; if (fixedRec[i]) continue; if (cur[i] >= 0) a.push(d); else if (cands[i].length) b.push(d); }
      if (a.length && b.length) { const d1 = a[rint(a.length)], d2 = b[rint(b.length)], c1 = cands[e * D + d1][cur[e * D + d1]], l2 = cands[e * D + d2]; let ci = l2.findIndex(c => c.a === c1.a && c.b === c1.b); if (ci < 0) ci = rint(l2.length); attempt([[e, d1, -1], [e, d2, ci]], T); }
    }
    if ((iters & 511) === 0 && total < best - 1e-6) { best = total; bestCur.set(cur); bestStn.set(stn); }
  }
  if (best < total - 1e-6) { cur.set(bestCur); stn.set(bestStn); rebuild(); recompute(); }

  // ---- 結果を書きこむ ----
  let stSwitch = 0;
  keys.forEach((k, d) => {
    E.forEach((s, e) => {
      const i = e * D + d; if (fixedRec[i]) return;
      if (state.shifts[k]) delete state.shifts[k][s.id];
      if (cur[i] >= 0) { const c = cands[i][cur[i]], sn = stn[i] >= 0 && stn[i] < roleNames.length ? roleNames[stn[i]] : '', sw = sn && sn !== s.role; if (sw) stSwitch++; (state.shifts[k] = state.shifts[k] || {})[s.id] = { start: pad2(c.a) + ':00', end: pad2(c.b) + ':00', brk: c.brk, auto: true, ...(sw ? { st: sn } : {}) }; }
      else if (autoOffOk[i]) (state.shifts[k] = state.shifts[k] || {})[s.id] = { off: true, auto: true };
    });
    if (state.shifts[k] && !Object.keys(state.shifts[k]).length) delete state.shifts[k];
  });

  // ---- 結果のまとめ（足りない日・理由・相談できる人・公平さ）----
  const shortages = []; let leadHours = 0, leadDays = 0;
  keys.forEach((k, d) => {
    const hrs = [], b = d * Hn; for (let i = 0; i < Hn; i++) if (cov[b + i] < rmin[i]) hrs.push({ h: H[i], need: rmin[i], have: cov[b + i] });
    const dr = dayRule[d], dayShort = dr && workers[d] < dr.min ? dr.min - workers[d] : 0;
    let leadShort = 0; if (leadMin) for (let i = 0; i < Hn; i++) if (lcov[b + i] < leadMin) leadShort++;
    if (leadShort) { leadHours += leadShort; leadDays++; }
    if (hrs.length || dayShort) shortages.push({ k, d, hrs, dayShort, leadShort });
  });
  shortages.sort((x, y) => (y.hrs.length + y.dayShort * 3) - (x.hrs.length + x.dayShort * 3));
  shortages.slice(0, 12).forEach(sd => {
    const { d, hrs } = sd, k = keys[d], items = [], last = [];
    E.forEach((s, e) => {
      const i = e * D + d, pref = adminPref(s.id, k, pk);
      if (fixedRec[i] || cur[i] >= 0) return;
      if (cands[i].length) {   // 休みの指定になっている人（自動の休み）：入れたときに、いちばん影響が小さい候補
        let bestC = null, bestD = Infinity;
        cands[i].forEach((c, ci) => { if (hrs.length && !hrs.some(x => x.h >= c.a && x.h < c.b)) return; const dl = attempt([[e, d, ci]], 1, true); if (dl < bestD) { bestD = dl; bestC = c; } });
        if (bestC) items.push({ id: s.id, name: s.name, a: bestC.a, b: bestC.b, delta: bestD });
      } else if (pref.status === 'off' && employedOn(s, k)) {   // 希望休の人：最後の手段
        const hs = mainHours(s, k).concat(subHours(s, k)).filter(h => H.includes(h)); const want = hrs.length ? hrs[0].h : hs[0];
        if (hs.includes(want)) { let a = want, b = want + 1; while (hs.includes(a - 1) && b - a < S.limitDay) a--; while (hs.includes(b) && b - a < S.limitDay) b++; last.push({ id: s.id, name: s.name, a, b }); }
      }
    });
    items.sort((x, y) => x.delta - y.delta); sd.cands = items.slice(0, 5); sd.last = last.slice(0, 5);
    sd.avail = E.filter((s, e) => cands[e * D + d].length).length;
  });
  const fair = E.map((s, e) => {
    let hrs = 0, run = 0, maxRun = 0, subH = 0; for (let d = 0; d < D; d++) { const c = candAt(e, d); if (c) { hrs += c.work; run = 0; } else if (autoCnt[e * D + d]) { run++; maxRun = Math.max(maxRun, run); } }
    return { id: s.id, name: s.name, role: s.role, days: days[e], hours: hrs, we: we[e], lo: dlo[e], hi: dhi[e], maxOff: maxRun, weeks: D / 7 };
  });
  let streakV = 0, intV = 0, restV = 0, flexN = 0, patN = 0, subN = 0;
  E.forEach((s, e) => {
    let run = preRun[e], prevEnd = preEnd[e], auto = 0;
    for (let d = 0; d < D; d++) { const c = candAt(e, d);
      if (c) { run++; if (run > S.maxStreak) streakV++; if (prevEnd >= 0 && 24 - prevEnd + c.a < A.interval) intV++; prevEnd = c.b; if (auto > A.restMax) restV++; auto = 0; if (!fixedRec[e * D + d]) { if (patterns.length) { if (c.pat) patN++; else flexN++; } } }
      else { run = 0; prevEnd = -1; if (autoCnt[e * D + d]) auto++; } }
    if (auto > A.restMax) restV++;
  });
  lastReport = { at: Date.now(), label: pLabel(p), pk, stSwitch, multiN: multiIdx.length, ms: Math.round(nowMs() - t0), iters, startCost: Math.round(startCost), endCost: Math.round(total), shortages, fair, streakV, intV, restV, flexN, patN, leadMin, leadHours, leadDays, patterns: patterns.length, restMax: A.restMax, interval: A.interval };
  const shortDays = shortages.map(x => x.k);
  return { shortDays, relaxed: init.relaxed, report: lastReport };
}

$('#wCloseNow').addEventListener('click', async () => {
  const pk = ymd(aP.start);
  if (state.closed[pk]) { delete state.closed[pk]; save(); renderShift(); return ui.toast('希望の受付を再開しました'); }
  if (!await ui.ask(`${pLabel(aP)} の希望シフトの提出を、今すぐ締め切ります。従業員は提出・変更ができなくなります（あとで再開できます）。`, { ok: '締め切る', danger: true })) return;
  state.closed[pk] = true; save(); renderShift(); ui.toast('希望の受付を締め切りました');
});
$('#wAuto').addEventListener('click', async () => {
  const pk = ymd(aP.start);
  if (isPublished()) return lockedMsg();
  if (!state.staff.length) return ui.toast('先に従業員を登録してください', 'err');
  const unsub = state.staff.filter(s => !subOf(s.id, pk)).map(s => s.name);
  const keep = $('#wKeep').checked, any = pKeys(aP).some(hasShifts);
  const msg = `${pLabel(aP)} のシフトを自動作成します。` + (any ? (keep ? '\n手で入れたシフトと休みは残し、ほかを作り直します。' : '\n今のシフト（休みの指定を含む）は、すべて作り直されます。') : '') +
    (unsub.length ? `\n\n希望が未提出の人：${unsub.join('、')}\n（希望休なし・出勤可能として扱います）` : '') + `\n\nルール：${ruleLabel()}`;
  if (!await ui.ask(msg, { ok: '自動作成する' })) return;
  busyStop = false; busyUI.show('シフトを自動作成しています', `最大${state.settings.auto2.secs}秒かかります。人数が足りない日をなくすように、入れ替えながら良くしています。`); await paintUI();
  let res; try { res = await autoShiftsV2(aP, keep, 0, f => busyUI.set(f)); } catch (err) { console.error(err); res = autoShifts(aP, keep); ui.toast('新しい自動作成でエラーが出たため、従来の方式で作りました', 'warn'); } finally { busyUI.hide(); }
  const { shortDays, relaxed } = res; save(); renderShift();
  const notes = [];
  if (res.report) notes.push(`（${(res.report.ms / 1000).toFixed(1)}秒）`);
  if (shortDays.length) notes.push(`それでも最低人数に届かない日：${shortDays.slice(0, 4).map(mdText).join('、')}${shortDays.length > 4 ? `…ほか${shortDays.length - 4}日` : ''}`);
  ui.toast(`シフトを自動作成しました（${ruleLabel()}）。希望休と希望時間の外には入れていません。` + (notes.join('') || '必要なマスを調整してください'), shortDays.length ? 'warn' : '');
  if (shortDays.length && res.report) openReport();   // 足りない日があれば、理由と相談できる人を見せる
});

/* ---- 作成結果のレポート ---- */
function openReport() { renderReport(); $('#arModal').hidden = false; }
function renderReport() {
  const r = lastReport, box = $('#arBody');
  if (!r) { box.innerHTML = '<p class="meta">まだ自動作成していません。</p>'; return; }
  const bad = r.shortages.length, dn = k => { const d = parseYmd(k); return `${d.getMonth() + 1}/${d.getDate()}（${DOW[d.getDay()]}）`; };
  let html = `<div class="sum${bad ? ' bad' : ''}"><b>${esc(r.label)}</b>　計算 ${(r.ms / 1000).toFixed(1)}秒（${r.iters.toLocaleString()}回の入れ替え）<br>` +
    (bad ? `⚠ 人数が不足している日が${bad}日あります。` : '✓ 人数が不足している日はありません。') + `<br>連勤の上限超え ${r.streakV}件 ／ 勤務の間の時間が足りない ${r.intV}件 ／ 自動の休みの連続（${r.restMax}日超え）${r.restV}件` +
    (r.multiN ? ` ／ 兼務できる人 ${r.multiN}人（兼務の持ち場に入った勤務 ${r.stSwitch}件）` : '') +
    (r.patterns ? ` ／ 型に合わせた勤務 ${r.patN}件・型に合わない勤務 ${r.flexN}件` : '') +
    (r.leadMin ? `<br>責任者が不在の時間：${r.leadHours}時間（${r.leadDays}日）${r.leadHours ? '　※責任者の人数や出勤日数が足りないときは、役割の見直しか、「責任者を各時間に置く人数」の調整が必要です' : ''}` : '') + '</div>';
  if (bad) {
    html += '<h3>人数が不足している日（内訳と、相談できる人）</h3>';
    r.shortages.slice(0, 12).forEach(sd => {
      html += `<div class="arday"><b>${dn(sd.k)}</b>${shortTable(sd.k)}<div class="meta">この日に勤務可能な従業員（休みの指定の人）：${sd.avail ?? 0}人</div>`;
      html += sd.cands && sd.cands.length ? '<div class="cands"><span class="meta">まず相談する人（休みの指定になっている人。影響が小さい順）</span>' + sd.cands.map(c => `<div class="cand"><b>${esc(c.name)}</b> ${c.a}:00–${c.b}:00 <span class="meta">影響 ${c.delta >= 0 ? '+' : ''}${Math.round(c.delta)}点</span> <button type="button" class="btn small" data-ar="${c.id}|${sd.k}|${c.a}|${c.b}">この人に入れる</button></div>`).join('') + '</div>' : '<div class="meta">不足の時間帯に出られる人が、ほかにいません（希望休の人をのぞく）。</div>';
      if (sd.last && sd.last.length) html += '<div class="last">最後の手段（希望休の人。原則はお願いしません）：' + sd.last.map(c => `${esc(c.name)} ${c.a}:00–${c.b}:00 <button type="button" class="btn small" data-ar="${c.id}|${sd.k}|${c.a}|${c.b}">確認して入れる</button>`).join('　') + '</div>';
      html += '</div>';
    });
    if (bad > 12) html += `<p class="meta">…ほか${bad - 12}日</p>`;
  }
  html += '<h3>従業員ごとの出勤日数と、休みの連続</h3><div class="tscroll"><table><thead><tr><th>従業員</th><th>出勤日数</th><th>希望（週）</th><th>実働時間</th><th>週末</th><th>自動の休みの最大連続</th></tr></thead><tbody>' +
    r.fair.map(f => `<tr><td>${esc(f.name)}</td><td>${f.days}日</td><td>${f.lo}〜${f.hi}日 → 期間の目安 ${Math.round(f.lo * f.weeks)}〜${Math.round(f.hi * f.weeks)}日</td><td>${fh(f.hours)}時間</td><td>${f.we}日</td><td${f.maxOff > r.restMax ? ' class="warnText"' : ''}>${f.maxOff}日</td></tr>`).join('') + '</tbody></table></div>';
  box.innerHTML = html;
}
$('#wReport').addEventListener('click', openReport);
$('#arClose').addEventListener('click', () => { $('#arModal').hidden = true; });
$('#busyStop').addEventListener('click', () => { busyStop = true; $('#busySub').textContent = 'ここまでの結果で仕上げています…'; });
$('#arModal').addEventListener('click', async e => {
  if (e.target === $('#arModal')) { $('#arModal').hidden = true; return; }
  const v = e.target.dataset.ar; if (!v) return;
  const [id, k, a, b] = v.split('|'); $('#arModal').hidden = true;
  await activateCell(id, k); if (!shiftEl.hidden) { setT('sStart', pad2(+a) + ':00'); setT('sEnd', pad2(+b) + ':00'); setBreak(legalBreak(+b - +a)); updateShiftInfo(); }
});
$('#arRetry').addEventListener('click', async () => {
  if (isPublished()) return lockedMsg();
  $('#arModal').hidden = true; busyStop = false; busyUI.show('別の案で作り直しています', `最大${state.settings.auto2.secs}秒かかります。`); await paintUI();
  let res; try { res = await autoShiftsV2(aP, $('#wKeep').checked, ++a2Seed, f => busyUI.set(f)); } finally { busyUI.hide(); }
  save(); renderShift(); openReport();
  ui.toast(`別の案で作り直しました（不足の日：${res.shortDays.length}日）`, res.shortDays.length ? 'warn' : '');
});