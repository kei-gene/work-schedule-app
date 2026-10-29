'use strict';

/* ========== 開発者モード（仮） ========== */
const RND_SUR = ['佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤', '吉田', '山田', '佐々木', '松本', '井上', '木村', '林', '清水', '山崎', '森'];
const RND_GIV = ['太郎', '花子', '健太', '美咲', '翔太', '愛', '大輝', '結衣', '陽菜', '蓮', '悠斗', '優奈', '拓海', '彩', '颯太', '莉子', '直樹', '真央', '亮', '菜々子'];
const RND_EN = ['Sarah Lee', 'Mike Chen', 'Emma Brown', 'Daniel Kim', 'Olivia Park', 'Noah Smith', 'Mia Tanaka', 'Liam Wong'];
const RND_COMMENTS = ['試験期間のため、1日お休みをいただけると助かります。', '早い時間帯なら多めに入れます。', '特にありません。よろしくお願いします。', '家族の予定があるので、週末は控えめでお願いします。', '', ''];
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = rnd(0, i); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
const hh = n => pad2(n) + ':00';

/* 業態ごとの階級（役割）と、従業員の傾向。店長（boss）は基本的に1人だけ */
const INDUSTRIES = {
  restaurant: { label: '飲食店', open: 10, close: 24, demand: [[10, 11, 2], [11, 14, 5], [14, 17, 3], [17, 21, 6], [21, 23, 3], [23, 24, 2]], wk: 1.3, roles: [
    { name: '店長', color: '#a23b5a', boss: true, max: 1, w: 0, rating: [4, 5], wage: [1800, 2400], len: [8, 10], win: 'any' },
    { name: '副店長', color: '#6b5b95', max: 2, w: 1, rating: [4, 5], wage: [1500, 1900], len: [8, 9], win: 'any' },
    { name: 'ホールリーダー', color: '#3b6fb6', max: 2, w: 1, rating: [3, 5], wage: [1250, 1500], len: [6, 8], win: 'any' },
    { name: 'キッチンリーダー', color: '#b45f06', max: 2, w: 1, rating: [3, 5], wage: [1300, 1600], len: [6, 8], win: 'any' },
    { name: 'ホール', color: '#0f6e6e', w: 6, rating: [2, 4], wage: [1050, 1250], len: [4, 7], win: 'any' },
    { name: 'キッチン', color: '#8a6d1d', w: 5, rating: [2, 4], wage: [1100, 1300], len: [4, 8], win: 'any' },
    { name: '洗い場', color: '#5b7a2f', w: 2, rating: [1, 3], wage: [1000, 1150], len: [3, 5], win: 'late' }] },
  convenience: { label: 'コンビニ', open: 6, close: 28, demand: [[6, 9, 3], [9, 17, 2], [17, 20, 3], [20, 28, 2]], wk: 1.1, roles: [
    { name: '店長', color: '#a23b5a', boss: true, max: 1, w: 0, rating: [4, 5], wage: [1800, 2300], len: [8, 10], win: 'early' },
    { name: '副店長', color: '#6b5b95', max: 2, w: 1, rating: [4, 5], wage: [1500, 1800], len: [8, 9], win: 'any' },
    { name: '日勤リーダー', color: '#3b6fb6', max: 2, w: 1, rating: [3, 5], wage: [1200, 1400], len: [6, 8], win: 'early' },
    { name: '夜勤リーダー', color: '#2f7d9a', max: 2, w: 1, rating: [3, 5], wage: [1400, 1700], len: [7, 8], win: 'night' },
    { name: '日勤スタッフ', color: '#0f6e6e', w: 6, rating: [2, 4], wage: [1050, 1200], len: [4, 8], win: 'any' },
    { name: '夜勤スタッフ', color: '#8a6d1d', w: 4, rating: [2, 4], wage: [1250, 1450], len: [6, 8], win: 'night' },
    { name: '研修中', color: '#5f6b76', w: 1, rating: [1, 2], wage: [1000, 1050], len: [3, 5], win: 'any' }] },
  supermarket: { label: 'スーパー', open: 8, close: 23, demand: [[8, 10, 3], [10, 16, 4], [16, 20, 6], [20, 23, 3]], wk: 1.3, roles: [
    { name: '店長', color: '#a23b5a', boss: true, max: 1, w: 0, rating: [4, 5], wage: [1800, 2400], len: [8, 10], win: 'any' },
    { name: '副店長', color: '#6b5b95', max: 2, w: 1, rating: [4, 5], wage: [1500, 1900], len: [8, 9], win: 'any' },
    { name: '部門チーフ', color: '#3b6fb6', max: 3, w: 1, rating: [3, 5], wage: [1300, 1600], len: [7, 9], win: 'early' },
    { name: 'レジチーフ', color: '#2f7d9a', max: 1, w: 1, rating: [3, 5], wage: [1200, 1400], len: [6, 8], win: 'any' },
    { name: 'レジ', color: '#0f6e6e', w: 6, rating: [2, 4], wage: [1050, 1200], len: [4, 7], win: 'any' },
    { name: '青果', color: '#5b7a2f', w: 3, rating: [2, 4], wage: [1050, 1250], len: [4, 7], win: 'early' },
    { name: '精肉・鮮魚', color: '#b45f06', w: 3, rating: [2, 4], wage: [1100, 1300], len: [4, 8], win: 'early' },
    { name: '惣菜', color: '#8a6d1d', w: 3, rating: [2, 4], wage: [1050, 1250], len: [4, 7], win: 'any' },
    { name: '品出し', color: '#5f6b76', w: 4, rating: [1, 3], wage: [1000, 1150], len: [3, 6], win: 'early' },
    { name: '新人研修', color: '#9a8c98', w: 1, rating: [1, 2], wage: [1000, 1050], len: [3, 5], win: 'any' }] },
  apparel: { label: 'アパレル', open: 10, close: 22, demand: [[10, 12, 2], [12, 18, 4], [18, 22, 3]], wk: 1.5, roles: [
    { name: '店長', color: '#a23b5a', boss: true, max: 1, w: 0, rating: [4, 5], wage: [1800, 2400], len: [8, 10], win: 'any' },
    { name: '副店長', color: '#6b5b95', max: 1, w: 1, rating: [4, 5], wage: [1500, 1900], len: [8, 9], win: 'any' },
    { name: '販売リーダー', color: '#3b6fb6', max: 2, w: 1, rating: [3, 5], wage: [1250, 1500], len: [6, 8], win: 'any' },
    { name: '販売スタッフ', color: '#0f6e6e', w: 7, rating: [2, 4], wage: [1100, 1300], len: [4, 8], win: 'any' },
    { name: 'レジ', color: '#2f7d9a', w: 3, rating: [2, 4], wage: [1050, 1200], len: [4, 7], win: 'any' },
    { name: 'ストック', color: '#5f6b76', w: 2, rating: [1, 3], wage: [1000, 1150], len: [3, 6], win: 'early' },
    { name: 'VMD', color: '#8a6d1d', max: 1, w: 1, rating: [3, 5], wage: [1300, 1600], len: [6, 8], win: 'early' },
    { name: '新人研修', color: '#9a8c98', w: 1, rating: [1, 2], wage: [1000, 1050], len: [3, 5], win: 'any' }] }
};
/* 兼務できる持ち場のグループ（バイト・パートの一部が、同じグループの持ち場を兼務できる）と、業態ごとの「役割ごとの最低人数」 */
const SKILL_GROUPS = { restaurant: ['ホール', 'キッチン', '洗い場'], convenience: ['日勤スタッフ', '夜勤スタッフ'], supermarket: ['レジ', '青果', '精肉・鮮魚', '惣菜', '品出し'], apparel: ['販売スタッフ', 'レジ', 'ストック'] };
const ROLE_MIN = { restaurant: { 'ホール': 1, 'キッチン': 1 }, supermarket: { 'レジ': 1 }, apparel: { '販売スタッフ': 1 } };
function addSkills(s, indKey) {   // 評価が高い人ほど、教わって一人でできる持ち場が多い
  const g = SKILL_GROUPS[indKey]; if (!g || !g.includes(s.role) || s.type === '社員') return s;
  if (Math.random() < 0.2 + 0.1 * s.rating) s.skills = shuffle(g.filter(n => n !== s.role)).slice(0, Math.random() < 0.7 ? 1 : 2);
  return s;
}
const indNote = k => { const i = INDUSTRIES[k]; return i ? `${i.label}：営業 ${i.open}:00〜${i.close}:00 ／ 階級（上が上位）：${i.roles.map(r => r.name).join(' ＞ ')} ／ 店長は1人だけ登録します。` : '今ある役割（階級）の中から、ランダムに選びます。'; };

/* 業態に合わせて、役割（階級）・営業時間を入れ替える */
function applyIndustry(ind) {
  state.roles = ind.roles.map(r => ({ name: r.name, color: r.color, lead: !!(r.boss || r.name === '副店長') }));   // 店長・副店長は責任者
  const PAT = { restaurant: [['早番', 10, 17], ['遅番', 17, 24], ['通し', 11, 21]], convenience: [['早番', 6, 14], ['日勤', 9, 17], ['遅番', 14, 22], ['夜勤', 22, 28]], supermarket: [['早番', 8, 15], ['中番', 11, 18], ['遅番', 16, 23]], apparel: [['早番', 10, 17], ['遅番', 15, 22]] };
  const key = Object.keys(INDUSTRIES).find(k => INDUSTRIES[k] === ind);
  state.patterns = (PAT[key] || []).map(([name, a, b], i) => ({ id: 'p' + Date.now() + i, name, start: hh(a), end: hh(b), days: [1, 2, 3, 4, 5, 6, 0] }));
  const names = new Set(state.roles.map(r => r.name));
  state.staff.forEach(s => { if (!names.has(s.role)) s.role = ''; if (s.skills) s.skills = s.skills.filter(n => names.has(n)); });
  state.roleRules = {}; const boss = ind.roles.find(r => r.boss); if (boss) state.roleRules[boss.name] = { min: 0, max: 1 };
  Object.entries(ROLE_MIN[key] || {}).forEach(([n, m]) => { state.roleRules[n] = { min: m, max: null }; });   // 例：ホール・キッチンは、いつも最低1人   // 店長は同時に1人まで
  state.open = ind.open; state.close = ind.close; state.rules = {}; viewOrder = null; mDay = null;
}
/* 登録人数に合わせた、時間帯ごと・日ごとの人数ルールの目安 */
function applyIndustryRules(ctx) {
  const N = state.staff.length, r = f => Math.max(1, Math.round(N * f));
  if (ctx) {   // 必要人数（時間帯ごと）から、時間帯ごと・日ごとの人数ルールを作る
    const dem = h => demandAt(ctx.ind, h, ctx.scale), H = hoursList(), sum = H.reduce((a, h) => a + dem(h), 0), wd = Math.ceil(sum / 6.5), we = Math.ceil(sum * ctx.ind.wk / 6.5);
    state.rules = {}; H.forEach(h => { const m = dem(h); state.rules[h] = { min: m, max: Math.ceil(m * 1.5) + 1 }; });
    state.shiftRules = [{ day: 'weekday', month: 0, date: '', min: wd, max: Math.ceil(wd * 1.4) }, { day: 'weekend', month: 0, date: '', min: we, max: Math.ceil(we * 1.4) }];
    return;
  }
  hoursList().forEach(h => { state.rules[h] = { min: 1, max: Math.max(3, Math.ceil(N * 0.4)) }; });
  state.shiftRules = [
    { day: 'weekday', month: 0, date: '', min: r(0.25), max: Math.max(r(0.25) + 1, r(0.5)) },
    { day: 'weekend', month: 0, date: '', min: r(0.35), max: Math.max(r(0.35) + 1, r(0.7)) }
  ];
}

/* 時間帯ごとの必要人数（業態の目安 × 店の規模） */
const demandAt = (ind, h, scale) => { const seg = ind.demand.find(([a, b]) => h >= a && h < b); return Math.max(1, Math.round((seg ? seg[2] : 1) * scale)); };
const WD = [1, 2, 3, 4, 5], WE = [6, 0];
const frac = (days, type) => { const base = type === 'we' ? WE : WD; return days.filter(d => base.includes(d)).length / base.length; };   // その種類の曜日のうち、出勤できる割合
/* 出勤できる曜日のパターン（現実の働き方に近づける）。type：足りない曜日の種類（'wd' 平日 / 'we' 休日） */
function pickDays(type) {
  const r = Math.random(), all = [1, 2, 3, 4, 5, 6, 0];
  if (type === 'we') return r < 0.45 ? WE.slice() : r < 0.75 ? all : [...WE, ...shuffle(WD.slice()).slice(0, rnd(2, 3))];
  if (type === 'wd') return r < 0.45 ? WD.slice() : r < 0.75 ? all : shuffle(WD.slice()).slice(0, rnd(3, 4));
  return r < 0.5 ? all : r < 0.65 ? WD.slice() : r < 0.8 ? [...WE, ...shuffle(WD.slice()).slice(0, rnd(1, 3))] : shuffle(all).slice(0, rnd(3, 5));
}
/* 人の事情（年齢・雇用区分）：社員は店長・副店長級、リーダーはパート・アルバイトのベテラン。アルバイトは学生・フリーター、パートは主婦（夫）・シニアが中心。
   学生は、平日は授業のあとの時間（高校生は17時以降）と土日、主婦は昼間の平日、シニアは夕方までが中心になる */
const wpick = list => { let r = Math.random() * list.reduce((a, x) => a + x[1], 0); for (const [v, w] of list) { r -= w; if (r <= 0) return v; } return list[list.length - 1][0]; };
function pickPersona(sp, hc, t) {   // hc：人が足りない時間、t：'wd'（平日）か'we'（休日）。人数だけ決めるときは、どちらも指定しない
  if (sp.boss) return { persona: 'mgr', type: '社員', age: rnd(32, 55) };
  if (sp.name === '副店長') return { persona: 'mgr', type: '社員', age: rnd(27, 48) };
  const mk = p => p === 'wife' ? { persona: p, type: 'パート', age: wpick([[rnd(30, 49), 65], [rnd(50, 59), 25], [rnd(24, 29), 10]]) }
    : p === 'senior' ? { persona: p, type: 'パート', age: rnd(60, 72) }
    : p === 'free' ? { persona: p, type: 'アルバイト', age: Math.random() < 0.75 ? rnd(23, 34) : rnd(35, 50) }
    : p === 'hs' ? { persona: p, type: 'アルバイト', age: rnd(16, 18) }
    : { persona: 'uni', type: 'アルバイト', age: rnd(18, 22) };
  if (/研修/.test(sp.name)) return mk(wpick([['uni', 6], ['hs', 2], ['free', 2]]));   // 入ったばかりの人
  if (sp.max != null) { const p = wpick([['wife', 5], ['free', 4], ['uni', 1]]); return p === 'wife' ? { persona: p, type: 'パート', age: rnd(30, 55) } : p === 'free' ? { persona: p, type: 'アルバイト', age: rnd(25, 45) } : { persona: 'uni', type: 'アルバイト', age: rnd(21, 23) }; }   // リーダー：長く働いているパート・アルバイト
  const day = t === 'wd' && hc < 17, night = sp.win === 'night' || hc >= 21;
  return mk(night ? wpick([['uni', 40], ['free', 40], ['wife', 10]]) : day ? wpick([['wife', 55], ['senior', 15], ['free', 20], ['uni', 10]]) : t === 'wd' ? wpick([['uni', 40], ['hs', 12], ['free', 20], ['wife', 28]]) : wpick([['uni', 38], ['hs', 10], ['free', 22], ['wife', 22], ['senior', 8]]));
}
/* 1人分：出勤できる曜日と時間（複数の時間帯・予備つき）、時給（多くの人は最低賃金のまま）を作る */
function buildStaff(sp, st, en, isBoss, used, idx, days, per) {
  per = per || pickPersona(sp, st, undefined);
  const open = state.open, close = state.close, min = state.settings.minWage;
  const pats = (state.patterns || []).filter(x => x.start && x.end);   // シフトの型があるときは、多くの人が型に近い時間帯で出られる設定にする（現実の募集に近づける）
  if (pats.length && !isBoss && Math.random() < 0.7) { let best = null, bo = 0; pats.forEach(x => { const a = toH(x.start), b = toH(x.end, true), ov = Math.min(b, en) - Math.max(a, st); if (ov > bo) { bo = ov; best = x; } }); if (best) { st = toH(best.start); en = toH(best.end, true); } }
  const minor = per.age < 18, stu = per.persona === 'uni' || per.persona === 'hs', sein = per.type === '社員', leader = sp.max != null;   // 18歳未満：22時〜翌5時には出られない
  if (minor) { en = Math.min(en, 22); st = Math.max(Math.min(st, en - 4), Math.max(open, 5)); if (en - st < 3) { st = Math.max(open, 5); en = Math.min(22, st + 4); } }
  if (sein) {   // 社員：ほぼ毎日出勤できる（実際に働くのは週5日ほど）。店長は営業時間をほぼ通しで、副店長は通し・早番ぎみ・遅番ぎみのどれか（早番・遅番で店に社員がいる時間をつなぐ）
    const top = Math.min(close, 24), len = top - open;
    if (len >= 4) {
      if (sp.boss) { st = open; en = top; }
      else { const k = Math.random(); if (k < 0.4) { st = open; en = top; } else if (k < 0.7) { st = open; en = open + Math.ceil(len * 0.75); } else { st = open + Math.floor(len * 0.25); en = top; } }
    }
    days = Math.random() < 0.9 ? DAY_ORDER.slice() : shuffle(DAY_ORDER.slice()).slice(0, 6);
  }
  if (per.persona === 'senior' && en > 19) en = Math.max(st + 3, 19);   // シニアは夕方まで
  if (per.persona === 'wife' && en > 22) en = Math.max(st + 3, 22);
  let name, tries = 0;
  do { name = pick(RND_SUR) + pick(RND_GIV); tries++; } while (used.has(name) && tries < 40);
  if (used.has(name)) name += rnd(2, 9);
  used.add(name);
  const main = DAY_ORDER.filter(d => days.includes(d)), wdM = main.filter(d => d >= 1 && d <= 5), weM = main.filter(d => d === 0 || d === 6);
  let avail;
  if (stu && wdM.length) {   // 学生：平日は授業のあと、土日は通常の時間
    const ws = Math.max(st, per.persona === 'hs' ? 17 : 16); avail = [];
    if (weM.length) avail.push({ days: weM, start: hh(st), end: hh(en), kind: 'main' });
    if (en - ws >= 3) avail.push({ days: wdM, start: hh(ws), end: hh(en), kind: 'main' });
    if (!avail.length) avail.push({ days: [6, 0], start: hh(st), end: hh(en), kind: 'main' });
  } else avail = [{ days: main, start: hh(st), end: hh(en), kind: 'main' }];
  if (Math.random() < 0.35 && en < Math.min(close, minor ? 22 : close)) avail.push({ days: main.slice(), start: hh(en), end: hh(Math.min(minor ? 22 : close, en + rnd(1, 3))), kind: 'sub' });
  const rest = DAY_ORDER.filter(d => !days.includes(d)), restUse = stu ? rest.filter(d => d === 0 || d === 6) : rest;
  if (!isBoss && restUse.length && Math.random() < 0.3) {   // ほかの曜日は、別の時間帯で出られる人（「＋ 追加」の例）
    const l2 = Math.min(close - open, rnd(4, 8)), s2 = minor ? rnd(Math.max(open, 5), 18) : rnd(open, close - l2);
    avail.push({ days: restUse, start: hh(s2), end: hh(minor ? Math.min(22, s2 + l2) : s2 + l2), kind: 'main' });
  }
  const w = Math.round(rnd(sp.wage[0], sp.wage[1]) / 10) * 10, type = per.type;
  const dayMs = 864e5, now = Date.now(), birth = ymd(new Date(now - (per.age * 365.25 + rnd(2, 362)) * dayMs));   // 年齢から誕生日を作る
  const capP = leader ? 0.08 : { wife: 0.35, uni: 0.25, senior: 0.1 }[per.persona] || 0;   // 扶養内などで、収入を抑えたい人
  const dpwBy = { uni: { min: 2, max: 4 }, hs: { min: 1, max: 3 }, wife: { min: 3, max: 4 }, senior: { min: 2, max: 4 }, free: { min: 3, max: 5 } };
  return {
    id: 's' + Date.now() + '_r' + idx, name, role: sp.name, rating: rnd(sp.rating[0], sp.rating[1]), wage: w > min + 20 ? w : 0, cur: 'JPY',
    type, birth, avail, dpw: sein ? { min: 5, max: 5 } : leader ? { min: 4, max: 5 } : minor ? { min: 1, max: 3 } : (Math.random() < 0.2 ? null : dpwBy[per.persona]),
    weeklyMax: sein ? 0 : minor ? 28 : (type === 'パート' && Math.random() < 0.4) ? pick([20, 24, 28]) : 0,        // 働き方を抑えたい人（例）
    incomeCap: (!sein && !minor && Math.random() < capP) ? pick([88000, 108000]) : 0,
    join: !sein && Math.random() < 0.04 ? ymd(new Date(now + rnd(3, 14) * dayMs)) : '', leave: !sein && Math.random() < 0.03 ? ymd(new Date(now + rnd(10, 25) * dayMs)) : ''
  };
}

const addSupply = (sup, s, open, close) => (s.avail || []).filter(x => x.kind !== 'sub').forEach(x => {
  const k = Math.min(1, 8 / Math.max(1, toH(x.end, true) - toH(x.start)));   // 出られる時間が長くても、1日に働くのは8時間ほど（社員の「ほぼ通しで出られる」を、過大に数えない）
  for (let h = toH(x.start); h < toH(x.end, true); h++) ['wd', 'we'].forEach(t => { if (sup[t][h] !== undefined) sup[t][h] += frac(slotDays(x), t) * k; });
});
/* 企業が「各時間帯の必要人数が足りるように採用する」イメージ：平日・休日それぞれで足りない時間帯を見つけて、そこに出勤できる人を足していく。
   従業員は、出勤できる日の約64%（週4.5日ぶん）しか出勤しない想定で、必要人数の約1.56倍（× 余裕）の人が出勤できるまで採用する */
function randomStaffDemand(indKey, scale, margin) {
  const ind = INDUSTRIES[indKey], open = state.open, close = state.close, span = close - open;
  const used = new Set(state.staff.map(s => s.name)), counts = {}, out = [], sup = { wd: {}, we: {} };
  for (let h = open; h < close; h++) { sup.wd[h] = 0; sup.we[h] = 0; }
  const ruled = Object.entries(ROLE_MIN[indKey] || {}), supR = {};   // 役割ごとの最低人数がある持ち場は、その持ち場ができる人も数える
  ruled.forEach(([r]) => { supR[r] = { wd: {}, we: {} }; for (let h = open; h < close; h++) { supR[r].wd[h] = 0; supR[r].we[h] = 0; } });
  const addRoleSupply = s => { const sk = skillsOf(s), w = sk.length > 1 ? 0.6 : 1; ruled.forEach(([r]) => { if (!sk.includes(r)) return; (s.avail || []).filter(x => x.kind !== 'sub').forEach(x => { const k = Math.min(1, 8 / Math.max(1, toH(x.end, true) - toH(x.start))); for (let h = toH(x.start); h < toH(x.end, true); h++) ['wd', 'we'].forEach(t => { if (supR[r][t][h] !== undefined) supR[r][t][h] += frac(slotDays(x), t) * w * k; }); }); }); };   // 兼務できる人は、持ち場ごとに0.6人ぶん
  state.staff.forEach(s => { counts[s.role] = (counts[s.role] || 0) + 1; addSupply(sup, s); addRoleSupply(s); });
  const need = (t, h) => Math.ceil(demandAt(ind, h, scale) * (t === 'we' ? ind.wk : 1) * 1.56 * margin);
  const specs = ind.roles, boss = specs.find(sp => sp.boss), room = x => x.w > 0 && (x.max == null || (counts[x.name] || 0) < x.max);
  for (let i = 0; i < 300; i++) {
    let worst = null;
    ['wd', 'we'].forEach(t => { for (let h = open; h < close; h++) { const gap = need(t, h) - sup[t][h]; if (gap > 0 && (!worst || gap > worst.gap)) worst = { t, h, gap }; } });
    ruled.forEach(([r, m]) => { const spR = specs.find(x => x.name === r); if (!spR || !room(spR)) return; ['wd', 'we'].forEach(t => { for (let h = open; h < close; h++) { const gap = Math.ceil(m * 1.56 * margin) - supR[r][t][h]; if (gap > 0 && (!worst || gap > worst.gap)) worst = { t, h, gap, role: r }; } }); });
    if (!worst) break;
    const { t, h: hc } = worst;
    let sp, isBoss = false;
    if (boss && !(counts[boss.name] || 0)) { sp = boss; isBoss = true; }
    else if (worst.role) sp = specs.find(x => x.name === worst.role);
    else {
      const ok = specs.filter(x => room(x) && (x.win !== 'night' || hc >= close - 9) && !(x.win === 'early' && hc > open + span * 0.65));
      const pool = ok.length ? ok : specs.filter(room);
      let r = Math.random() * pool.reduce((a, x) => a + x.w, 0); sp = pool[pool.length - 1];
      for (const x of pool) { r -= x.w; if (r <= 0) { sp = x; break; } }
    }
    counts[sp.name] = (counts[sp.name] || 0) + 1;
    const len = Math.min(span, rnd(sp.len[0], sp.len[1])), st = Math.min(close - len, Math.max(open, hc - rnd(0, len - 1)));
    const s = addSkills(buildStaff(sp, st, st + len, isBoss, used, out.length, pickDays(t), pickPersona(sp, hc, t)), indKey); out.push(s); addSupply(sup, s); addRoleSupply(s);
  }
  return out;
}
/* いまの従業員で、必要人数（時間帯ごとの最低人数）を満たせそうか（平日・休日） */
function supplyReport() {
  if (!state.staff.length) return '';
  const H = hoursList(), res = {};
  ['wd', 'we'].forEach(t => {
    const sup = {}; H.forEach(h => { sup[h] = 0; }); state.staff.forEach(s => addSupply({ wd: t === 'wd' ? sup : {}, we: t === 'we' ? sup : {} }, s));
    let worst = Infinity, worstH = H[0], sum = 0; const weak = [];
    H.forEach(h => { const ratio = sup[h] * 0.64 / Math.max(1, rule(h).min); sum += ratio; if (ratio < worst) { worst = ratio; worstH = h; } if (ratio < 1) weak.push(h); });
    res[t] = { worst, worstH, avg: sum / H.length, weak };
  });
  const f = (t, n) => `${n}：最低${res[t].worst.toFixed(1)}倍（${res[t].worstH}時台）・平均${res[t].avg.toFixed(1)}倍`;
  const weak = [...res.wd.weak.map(h => '平日' + h + '時台'), ...res.we.weak.map(h => '休日' + h + '時台')];
  return `人員の充足度（出勤できる人数 × 出勤率64% ÷ 必要人数）　${f('wd', '平日')}／${f('we', '休日')}。` + (weak.length ? `⚠ ${weak.slice(0, 8).join('、')}${weak.length > 8 ? '…' : ''}は、必要人数を満たせない見込みです。` : '全時間帯で、必要人数を満たせる見込みです。');
}

/* 人数を決めて作る（業態の「必要人数から自動」をオフにしたとき） */
function randomStaff(n, indKey) {
  const ind = INDUSTRIES[indKey], open = state.open, close = state.close, span = Math.max(1, close - open), out = [];
  const GENERIC = { name: '', w: 1, rating: [1, 5], wage: [1000, 1500], len: [4, 8], win: 'any' };
  const specs = ind ? ind.roles : state.roles.map(r => ({ ...GENERIC, name: r.name }));
  const used = new Set(state.staff.map(s => s.name)), counts = {};
  state.staff.forEach(s => { counts[s.role] = (counts[s.role] || 0) + 1; });
  const pickRole = () => {
    const ok = specs.filter(sp => sp.w > 0 && (sp.max == null || (counts[sp.name] || 0) < sp.max));
    if (!ok.length) return GENERIC;
    let r = Math.random() * ok.reduce((a, sp) => a + sp.w, 0);
    for (const sp of ok) { r -= sp.w; if (r <= 0) return sp; }
    return ok[ok.length - 1];
  };
  const boss = specs.find(sp => sp.boss);
  for (let i = 0; i < n; i++) {
    const isBoss = !!boss && i === 0 && !(counts[boss.name] || 0);   // 店長は、いなければ最初の1人だけ
    const sp = isBoss ? boss : pickRole();
    counts[sp.name] = (counts[sp.name] || 0) + 1;
    const len = Math.min(span, rnd(sp.len[0], sp.len[1])), slack = Math.max(0, span - len);
    const kind = sp.win === 'any' ? ['early', 'any', 'late'][i % 3] : sp.win;   // 朝・昼・夜がばらけるようにする
    const st = open + (kind === 'early' ? rnd(0, Math.floor(slack / 3)) : kind === 'late' ? slack - rnd(0, Math.floor(slack / 3)) : kind === 'night' ? slack : rnd(0, slack));
    out.push(addSkills(buildStaff(sp, st, Math.min(close, st + len), isBoss, used, i, pickDays(), pickPersona(sp, st, undefined)), indKey));
  }
  // 平日・休日のどの時間にも、出勤できる人が1人はいるようにする
  const all = [...state.staff, ...out];
  [['wd', WD], ['we', WE]].forEach(([, base]) => {
    for (let h = open; h < close; h++) {
      if (all.some(x => (x.avail || []).some(sl => sl.kind !== 'sub' && h >= toH(sl.start) && h < toH(sl.end, true) && slotDays(sl).some(d => base.includes(d))))) continue;
      const c = out.filter(x => !boss || x.role !== boss.name)[0] || out[0]; if (!c) break;
      c.avail.push({ days: base.slice(), start: hh(h), end: hh(Math.min(close, h + 4)), kind: 'main' });
    }
  });
  return out;
}

/* ========== 希望シフトのシミュレーション（イレギュラーな予定つき） ==========
   企業は、各時間帯が足りるように人を採用している（上の「ランダムで従業員を登録」）ので、ふだんは人手が足りないことはほとんどない。
   そのうえで、暮らしの事情（旅行・子どもの行事・試験・就活・通院など）で、希望休や時間の制限が出る。人の事情（学生・子育て中など）ごとに、起きやすい予定を変えている */
const IRR_LEVEL = { none: 0, low: 0.5, mid: 1, high: 1.8 };
const IRR_LABEL = { trip: '旅行・帰省', holiday: '連休の帰省', kidevent: '子どもの行事', exam: 'テスト期間', school: '学校行事', job: '就職活動', leisure: 'ライブ・遊びの予定', health: '通院・体調', ceremony: '冠婚葬祭', qual: '資格試験', move: '引っ越し' };
const EXAM_P = { 1: 0.8, 2: 0.8, 5: 0.3, 6: 0.6, 7: 0.9, 10: 0.3, 11: 0.5, 12: 0.8 };   // 月ごとの、学校のテスト期間のあたりやすさ
const HOLIDAY_SPANS = [['04-29', '05-06', 'ゴールデンウィーク'], ['08-12', '08-16', 'お盆'], ['09-19', '09-23', 'シルバーウィーク'], ['12-29', '01-03', '年末年始']];
const inSpan = (md, a, b) => a <= b ? (md >= a && md <= b) : (md >= a || md <= b);
const rangeTxt = ks => ks.length === 1 ? mdText(ks[0]) : `${mdText(ks[0])}〜${mdText(ks[ks.length - 1])}`;
const listTxt = ks => ks.map(mdText).join('、');
function traitsOf(s) {   // 人の事情（同じ人は、いつも同じ）
  const r = prng32(strSeed('trait:' + s.id)), age = s.birth ? ageOn(s, todayKey()) : null, minor = age !== null && age < 18, part = s.type !== '社員';
  const student = minor || (age !== null && age <= 23 && s.type === 'アルバイト' && r() < 0.9);
  const parent = !student && age !== null && age >= 28 && age <= 55 && r() < (s.type === 'パート' ? 0.7 : s.type === '社員' ? 0.5 : 0.2);
  return { age, minor, student, parent, jobhunt: student && !minor && age >= 20 && r() < 0.35, boss: !part };
}
function randomPrefs(p, mult = 1) {
  const keys = pKeys(p), pk = ymd(p.start), open = state.open, close = state.close, N = state.staff.length;
  const window_ = () => { const a = rnd(open, Math.max(open, close - 4)); return { start: hh(a), end: hh(Math.min(close, a + rnd(3, 6))) }; };
  const isWe = k => [0, 6].includes(parseYmd(k).getDay()), wes = keys.filter(isWe), wds = keys.filter(k => !isWe(k));
  const cap = Math.max(1, Math.floor(N * 0.3)), capEv = Math.max(2, Math.ceil(N * 0.5)), offCount = {}, counts = {};   // 普通の休みは3割まで、イベントでも半数までに抑える（全員が休む日はつくらない）
  const chance = pr => Math.random() < Math.min(0.9, pr * mult);
  const win = n => { const i = rnd(0, Math.max(0, keys.length - n)); return keys.slice(i, i + n); };
  const one = pool => pick(pool.length ? pool : keys);
  const mid = parseYmd(keys[Math.floor(keys.length / 2)]), exam = (mult > 0 && Math.random() < Math.min(0.95, (EXAM_P[mid.getMonth() + 1] || 0.1) * Math.max(mult, 0.6))) ? (() => { const len = rnd(7, 10); return { len, i: rnd(0, Math.max(0, keys.length - len)) }; })() : null;   // 学校のテスト期間（学生は、だいたい同じ時期になる）
  const hol = mult > 0 ? HOLIDAY_SPANS.map(([a, b, nm]) => ({ nm, ks: keys.filter(k => inSpan(k.slice(5), a, b)) })).filter(x => x.ks.length) : [];
  state.staff.forEach(s => {
    const P = pf(s.id), T = traitsOf(s), cms = [];
    P.dates = {}; P.rules = [];
    const useDay = (k, v) => { if (P.dates[k]) return false; if (v.status === 'off') { if ((offCount[k] || 0) >= capEv) return false; offCount[k] = (offCount[k] || 0) + 1; } P.dates[k] = v; return true; };
    const put = (ks, v) => ks.reduce((n, k) => n + (useDay(k, v) ? 1 : 0), 0);
    const note = (tag, n, cm) => { if (!n) return; counts[tag] = (counts[tag] || 0) + 1; if (cm) cms.push(cm); };
    const OFF = { status: 'off' };
    if (mult > 0) {
      if (chance(0.12)) { const ks = win(rnd(2, 5)); note('trip', put(ks, OFF), `${rangeTxt(ks)}は${pick(['旅行', '帰省', '家族旅行'])}のため、お休みをいただきたいです。`); }
      hol.forEach(h => { if (chance(0.2)) { const ks = shuffle(h.ks.slice()).slice(0, rnd(2, 4)).sort(); note('holiday', put(ks, OFF), `${h.nm}は帰省します。`); } });
      if (T.parent) {
        if (chance(0.12)) { const k = one(Math.random() < 0.8 ? wes : wds); note('kidevent', put([k], OFF), pick([`子どもの運動会のため${mdText(k)}は休みたいです。`, `${mdText(k)}は子どもの行事があります。`, `${mdText(k)}は子どもの発表会があるためお休みをお願いします。`])); }
        if (chance(0.08)) { const k = one(wds), e = Math.min(close, Math.max(open + 3, 15)); note('kidevent', put([k], { status: 'time', start: hh(open), end: hh(e) }), `${mdText(k)}は子どもの面談のため、${e}時までなら出られます。`); }
      }
      if (T.student && exam && chance(0.65)) {   // テスト期間：休みを増やし、出られる日も夕方以降だけにする
        const sh = rnd(-2, 2), a = Math.max(0, exam.i + sh), ks = keys.slice(a, a + exam.len), st = Math.max(open, Math.min(17, close - 3)), en = T.minor ? Math.min(close, 22) : close;
        const offKs = [], timeKs = []; ks.forEach(k => { const r = Math.random(); if (r < 0.4) offKs.push(k); else if (r < 0.7 && en > st) timeKs.push(k); });
        if (ks.length) note('exam', put(offKs, OFF) + put(timeKs, { status: 'time', start: hh(st), end: hh(en) }), `テスト期間（${rangeTxt(ks)}）のため、出勤を減らしたいです。出られる日も${st}時以降になります。`);
      }
      if (T.minor && chance(0.12)) { const k = one(Math.random() < 0.5 ? wes : keys); note('school', put([k], OFF), `学校行事（${pick(['文化祭', '体育祭', '修学旅行の準備'])}）のため${mdText(k)}は休みます。`); }
      if (T.jobhunt && chance(0.25)) { const ks = shuffle(wds.slice()).slice(0, rnd(1, 3)).sort(); note('job', put(ks, OFF), `就職活動の面接・説明会があるため、${listTxt(ks)}は出勤できません。`); }
      if (!T.boss && (T.age === null || T.age <= 35) && chance(0.1)) { const k = one(wes); note('leisure', put([k], OFF), Math.random() < 0.4 ? `${mdText(k)}は予定があり、お休みをお願いします。` : ''); }
      if (chance(0.09)) { const k = one(keys); note('health', put([k], OFF), Math.random() < 0.5 ? `${mdText(k)}は通院のため、お休みをお願いします。` : ''); }
      if (T.age !== null && T.age >= 25 && chance(0.04)) { const ks = win(rnd(1, 2)); note('ceremony', put(ks, OFF), `${rangeTxt(ks)}は親族の用事のため、休みたいです。`); }
      if (!T.student && chance(0.04)) { const k = one(wes); note('qual', put([k], OFF), `${mdText(k)}は資格試験のため、お休みをお願いします。`); }
      if (chance(0.02)) { const ks = win(rnd(1, 2)); note('move', put(ks, OFF), `${rangeTxt(ks)}は引っ越しのため、休みたいです。`); }
    }
    if (Math.random() < 0.25) P.rules.push(Math.random() < 0.7 ? { target: pick(RULE_TARGETS.slice(2))[0], status: 'off' } : { target: 'holiday', status: 'time', ...window_() });
    const offN = pick([0, 0, 0, 1, 1, 2, 2, 3]), timeN = rnd(0, 1);   // ふだんの、ちょっとした希望
    const order = Math.random() < 0.5 ? [...shuffle(wes.slice()), ...shuffle(wds.slice())] : shuffle(keys.slice());   // 休みは週末ぎみ
    let off = 0;
    for (const k of order) { if (off >= offN) break; if (P.dates[k] || (offCount[k] || 0) >= cap) continue; P.dates[k] = { status: 'off' }; offCount[k] = (offCount[k] || 0) + 1; off++; }
    order.filter(k => !P.dates[k]).slice(0, timeN).forEach(k => { P.dates[k] = { status: 'time', ...window_() }; });
    delete P.submissions[pk];
    if (Math.random() < 0.9) {
      const c = cms.length ? cms.join(' ') + (Math.random() < 0.3 ? ' よろしくお願いします。' : '') : pick(RND_COMMENTS);
      P.comments[pk] = c;
      P.submissions[pk] = { at: new Date(Date.now() - rnd(1, 72) * 3600e3).toISOString(), comment: c, snap: snapshotFor(s.id, keys) };
    } else P.comments[pk] = cms.join(' ');   // 未提出のまま
  });
  const peak = keys.reduce((b, k) => (offCount[k] || 0) > b.n ? { k, n: offCount[k] } : b, { k: keys[0], n: 0 });
  return { counts, peak, n: N };
}

function renderDev() {
  renderAdmins();
  $('#dLayout').value = state.settings.layout || 'auto';
  const kb = Math.round((localStorage.getItem(KEY) || '').length / 102.4) / 10;
  $('#dInfo').textContent = `従業員 ${state.staff.length}人（社員 ${state.staff.filter(s => s.type === '社員').length}・パート ${state.staff.filter(s => s.type === 'パート').length}・アルバイト ${state.staff.filter(s => s.type === 'アルバイト').length}／兼務できる人 ${state.staff.filter(s => skillsOf(s).length > 1).length}人） ／ シフトのある日 ${Object.keys(state.shifts).length}日 ／ 保存データ 約${kb}KB`;
  $('#dReport').textContent = supplyReport();
  syncDevCount();
}
function syncDevCount() { $('#dCount').disabled = $('#dAuto').checked && $('#dInd').value !== 'generic' && $('#dApply').checked; }
['dAuto', 'dInd', 'dApply'].forEach(id => $('#' + id).addEventListener('change', syncDevCount));
$('#dInd').addEventListener('change', () => { $('#dIndNote').textContent = indNote($('#dInd').value); });
$('#dIndNote').textContent = indNote('generic');
$('#dRandomStaff').addEventListener('click', async () => {
  const indKey = $('#dInd').value, ind = INDUSTRIES[indKey], apply = !!ind && $('#dApply').checked, auto = apply && $('#dAuto').checked;
  let n = Math.round(+$('#dCount').value);
  if (!auto && !(n >= 1 && n <= 50)) return ui.toast('人数は1〜50で入れてください', 'err');
  const replace = $('#dMode').value === 'replace';
  if (replace && state.staff.length && !await ui.ask(`今の従業員${state.staff.length}人と、そのシフト・希望がすべて消えます。入れ替えますか？`, { ok: '入れ替える', danger: true })) return;
  if (replace) { state.staff = []; state.work = {}; state.workMode = {}; state.shifts = {}; state.prefs = {}; state.published = {}; state.auth.users = state.auth.users.filter(u => u.role !== 'employee'); }
  if (apply) applyIndustry(ind);
  const scale = +$('#dScale').value, margin = +$('#dMargin').value;
  const made = auto ? randomStaffDemand(indKey, scale, margin) : randomStaff(n, indKey); n = made.length; state.staff.push(...made);
  if (apply) { applyIndustryRules(auto ? { ind, scale } : null); renderConditions(); renderTimeRange(); renderRoleRules(); renderShiftRules(); }
  const rows = $('#dAcct').checked ? made.map(issueFor) : [];
  save(); renderRoles(); renderGantt(); renderDev();
  ui.toast(`ランダムな従業員を${n}人登録しました${apply ? `（${ind.label}モード${auto ? '・必要人数から自動' : ''}）` : ''}`);
  if (rows.length) showCreds('従業員アカウントを発行しました', '初期パスワードは、この画面でしか確認できません。控えてから閉じてください（最初のログインで本人が変更します）。', credText(rows));
});
$('#dRandomPrefs').addEventListener('click', async () => {
  if (!state.staff.length) return ui.toast('先に従業員を登録してください', 'warn');
  const p = periodOf(new Date());
  if (!await ui.ask(`${pLabel(p)} の希望を、全員分ランダムに作り直します。今ある希望と提出は上書きされます。`, { ok: '作る' })) return;
  const rep = randomPrefs(p, IRR_LEVEL[$('#dIrr').value] ?? 1); save(); renderDev();
  const list = Object.entries(rep.counts).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${IRR_LABEL[k]} ${n}人`).join('、');
  $('#dPrefReport').textContent = `イレギュラーな予定：${list || 'なし'}。希望休がいちばん多い日：${rep.peak.n ? `${mdText(rep.peak.k)}（${rep.peak.n}人／全${rep.n}人）` : 'なし'}`;
  ui.toast('希望シフトをランダムに作りました。管理者画面のシフト管理で確認できます');
});
$('#dLayout').addEventListener('change', () => { state.settings.layout = $('#dLayout').value; save(); applyLayout(); });
$('#dReset').addEventListener('click', async () => {
  if (!await ui.ask('このアプリが保存しているデータ（アカウントを含む）をすべて消して、最初の状態に戻します。元には戻せません。', { ok: 'すべて消す', danger: true })) return;
  localStorage.removeItem(KEY); endSession(); location.reload();
});

$('#pDlDays').addEventListener('change', () => {
  const n = Math.round(+$('#pDlDays').value);
  if (!(n >= 0 && n <= 60)) { ui.toast('0〜60の数を入れてください', 'err'); renderPeriodSettings(); return; }
  state.settings.deadlineDays = n; save(); ui.toast(n ? `締切の初期値を、期間の開始日の${n}日前にしました` : '締切の初期値をなしにしました');
  if (curTab === 'shift') renderShift();
});

/* ---- 管理者／従業員／開発者の表示切替（仮） ---- */
function setMode(m) {
  if (!allowedModes().includes(m)) return;
  if (m !== 'admin') abandonDraft();
  document.body.dataset.mode = m;
  document.querySelectorAll('.mbtn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  if (m === 'employee' || m === 'dev') { document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === m)); if (m === 'employee') renderEmployee(); else renderDev(); }
  else switchTab(curTab);
}
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', async () => { if (b.dataset.mode !== document.body.dataset.mode && !await confirmLeaveSettings()) return; setMode(b.dataset.mode); }));