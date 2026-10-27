'use strict';

/* ========== ログイン・アカウント ==========
   ※ この端末のブラウザの中だけで動くログインです。パスワードは「塩 ＋ 繰り返しのSHA-256」で保存しますが、
     データ自体がブラウザに入っているため、ほかの人に見られないようにする本格的な保護にはサーバーが必要です。 */
const ROLE_LABEL = { dev: '開発者', admin: '管理者', employee: '従業員' };
const ID_RE = /^[A-Za-z0-9_.-]{3,20}$/;
const SESSION_KEY = 'shiftApp.session';
const AUTH = () => state.auth;

const SHA_PRIMES = (() => { const p = []; for (let n = 2; p.length < 64; n++) if (p.every(q => n % q)) p.push(n); return p; })();
const SHA_K = SHA_PRIMES.map(n => Math.floor((Math.cbrt(n) % 1) * 4294967296));
const SHA_H0 = SHA_PRIMES.slice(0, 8).map(n => Math.floor((Math.sqrt(n) % 1) * 4294967296));
function sha256hex(msg) {
  const bytes = new TextEncoder().encode(msg), l = bytes.length, total = ((l + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(total); buf.set(bytes); buf[l] = 0x80;
  const dv = new DataView(buf.buffer); dv.setUint32(total - 8, Math.floor(l * 8 / 4294967296)); dv.setUint32(total - 4, (l * 8) >>> 0);
  const H = SHA_H0.slice(), w = new Uint32Array(64), rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      w[i] = (w[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA_K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) | 0; });
  }
  return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}
const HEX = '0123456789abcdef', PW_AL = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', CODE_AL = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randBytes = n => { const a = new Uint8Array(n); if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a); else for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256); return a; };
const randStr = (n, al) => Array.from(randBytes(n), b => al[b % al.length]).join('');
const newPw = () => randStr(10, PW_AL);
const newCode = () => randStr(16, CODE_AL).replace(/(.{4})(?=.)/g, '$1-');
const hashPw = (pw, salt) => { let h = sha256hex(salt + ':' + pw); for (let i = 0; i < 4000; i++) h = sha256hex(h + salt); return h; };

const findUser = id => AUTH().users.find(u => u.id.toLowerCase() === String(id).trim().toLowerCase());
const makeUser = o => { const salt = randStr(16, HEX); return { id: o.id, name: o.name || o.id, role: o.role, staffId: o.staffId || '', salt, hash: hashPw(o.password, salt), must: !!o.must, off: false, at: Date.now(), last: 0 }; };
const setPw = (u, pw, must) => { u.salt = randStr(16, HEX); u.hash = hashPw(pw, u.salt); u.must = !!must; };
const checkPw = (u, pw) => hashPw(pw, u.salt) === u.hash;
const staffOf = u => state.staff.find(s => s.id === u.staffId);
const displayName = u => u.role === 'employee' ? ((staffOf(u) || {}).name || u.name) : u.name;
function nextEmpId() { let n = 1; while (findUser('e' + String(n).padStart(3, '0'))) n++; return 'e' + String(n).padStart(3, '0'); }
function issueFor(s) {   // 従業員のアカウントを発行（すでにあれば、パスワードを再発行）
  const pw = newPw();
  let u = AUTH().users.find(x => x.staffId === s.id && x.role === 'employee');
  if (u) { setPw(u, pw, true); u.off = false; }
  else { u = makeUser({ id: nextEmpId(), name: s.name, role: 'employee', staffId: s.id, password: pw, must: true }); AUTH().users.push(u); }
  return { name: s.name, id: u.id, pw };
}
const credText = rows => '名前\tID\tパスワード\n' + rows.map(r => `${r.name}\t${r.id}\t${r.pw}`).join('\n');

/* セッション（「保持する」ならこの端末に残し、そうでなければタブを閉じるまで） */
const readSession = () => { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY)); } catch (e) { return null; } };
function endSession() { me = null; localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY); }
function startSession(u, remember) { endSession(); me = u; (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify({ id: u.id })); }
const allowedModes = () => !me ? [] : me.role === 'dev' ? ['admin', 'employee', 'dev'] : me.role === 'admin' ? ['admin'] : ['employee'];

function tryLogin(id, pw, remember) {   // 5回続けて失敗すると60秒ロック
  const key = String(id).trim().toLowerCase(), L = AUTH().lock, lk = L[key], now = Date.now();
  if (lk && lk.until > now) return { err: `ログインに失敗した回数が多いため、あと${Math.ceil((lk.until - now) / 1000)}秒ほどお待ちください` };
  const u = findUser(id);
  if (!u || !checkPw(u, pw)) {
    const n = ((lk && lk.n) || 0) + 1;
    L[key] = n >= 5 ? { n: 0, until: now + 60000 } : { n, until: 0 }; save();
    return { err: n >= 5 ? '5回続けて失敗したため、60秒ほどログインできません' : 'IDまたはパスワードが違います' };
  }
  if (u.off) return { err: 'このアカウントは無効になっています。管理者に連絡してください' };
  delete L[key]; u.last = now; save(); startSession(u, remember);
  return { u };
}

function showLogin(view) {
  document.body.dataset.auth = 'out'; delete document.body.dataset.role;
  view = view || (AUTH().users.length ? 'login' : 'setup');
  const id = { login: 'lgForm', setup: 'suForm', recover: 'rcForm' };
  Object.values(id).forEach(f => { $('#' + f).hidden = f !== id[view]; });
  ['#lgMsg', '#suMsg', '#rcMsg'].forEach(m => { $(m).textContent = ''; });
  $('#lgHelp').hidden = true; $('#lgPw').value = '';
  const first = { login: '#lgId', setup: '#suAPw', recover: '#rcId' }[view]; if ($(first)) $(first).focus();
}
function enterApp() {
  document.body.dataset.auth = 'in'; document.body.dataset.role = me.role;
  $('#uName').textContent = `${displayName(me)}（${ROLE_LABEL[me.role]}）`;
  const modes = allowedModes();
  $('.mode').hidden = modes.length < 2;
  document.querySelectorAll('.mbtn').forEach(b => { b.hidden = !modes.includes(b.dataset.mode); });
  if (me.role === 'employee') empId = me.staffId;
  $('#eWho').closest('label').hidden = me.role === 'employee';
  setMode(me.role === 'employee' ? 'employee' : 'admin');
  renderAccounts(); renderAdmins();
  $('#uPw').hidden = me.role === 'employee';   // 従業員は、従業員画面の「設定」からパスワードを設定する
  if (me.must && me.role !== 'employee') openPw(true);
}

$('#lgForm').addEventListener('submit', e => {
  e.preventDefault();
  const r = tryLogin($('#lgId').value, $('#lgPw').value, $('#lgRemember').checked);
  $('#lgPw').value = '';
  if (r.err) { $('#lgMsg').textContent = r.err; $('#lgPw').focus(); return; }
  $('#lgId').value = ''; enterApp();
});
$('#lgShow').addEventListener('click', () => { const i = $('#lgPw'), show = i.type === 'password'; i.type = show ? 'text' : 'password'; $('#lgShow').textContent = show ? '隠す' : '表示'; });
$('#lgForgot').addEventListener('click', e => { e.preventDefault(); $('#lgHelp').hidden = !$('#lgHelp').hidden; });
$('#lgRecover').addEventListener('click', () => showLogin('recover'));
$('#rcBack').addEventListener('click', () => showLogin('login'));
$('#uOut').addEventListener('click', async () => { if (!await confirmLeaveSettings()) return; abandonDraft(); endSession(); showLogin('login'); ui.toast('ログアウトしました'); });

/* はじめの設定：管理者と開発者のアカウントを作る */
$('#suForm').addEventListener('submit', e => {
  e.preventDefault();
  const a = { id: $('#suAId').value.trim(), name: $('#suAName').value.trim() || '管理者', pw: $('#suAPw').value, pw2: $('#suAPw2').value };
  const d = { id: $('#suDId').value.trim(), name: $('#suDName').value.trim() || '開発者', pw: $('#suDPw').value, pw2: $('#suDPw2').value };
  const err = m => { $('#suMsg').textContent = m; };
  if (!ID_RE.test(a.id) || !ID_RE.test(d.id)) return err('IDは、英数字と「_ . -」で3〜20文字にしてください');
  if (a.id.toLowerCase() === d.id.toLowerCase()) return err('管理者と開発者のIDは、別にしてください');
  for (const x of [a, d]) { if (x.pw.length < 6) return err('パスワードは6文字以上にしてください'); if (x.pw !== x.pw2) return err('確認用のパスワードが一致しません'); }
  AUTH().users.push(makeUser({ id: a.id, name: a.name, role: 'admin', password: a.pw }), makeUser({ id: d.id, name: d.name, role: 'dev', password: d.pw }));
  const code = newCode(), salt = randStr(16, HEX);
  AUTH().recovery = { salt, hash: hashPw(code.replace(/-/g, ''), salt) };
  const u = findUser(d.id); u.last = Date.now(); save(); startSession(u, false);
  ['#suAPw', '#suAPw2', '#suDPw', '#suDPw2'].forEach(i => { $(i).value = ''; });
  showCreds('アカウントを作りました', '開発者の「復旧コード」です。開発者のパスワードを忘れたときに使います。この画面を閉じると二度と表示できないため、控えてから閉じてください。', `復旧コード：${code}`, enterApp);
});

/* 開発者のパスワードを復旧コードで再設定 */
$('#rcForm').addEventListener('submit', e => {
  e.preventDefault();
  const err = m => { $('#rcMsg').textContent = m; }, L = AUTH().lock, lk = L.recovery, now = Date.now();
  if (lk && lk.until > now) return err(`失敗が続いたため、あと${Math.ceil((lk.until - now) / 1000)}秒ほどお待ちください`);
  const u = findUser($('#rcId').value), R = AUTH().recovery, code = $('#rcCode').value.toUpperCase().replace(/[^A-Z0-9]/g, ''), pw = $('#rcPw').value;
  if (!u || u.role !== 'dev' || !R || hashPw(code, R.salt) !== R.hash) {
    const n = ((lk && lk.n) || 0) + 1; L.recovery = n >= 5 ? { n: 0, until: now + 60000 } : { n, until: 0 }; save();
    return err('IDまたは復旧コードが違います');
  }
  if (pw.length < 6) return err('パスワードは6文字以上にしてください');
  if (pw !== $('#rcPw2').value) return err('確認用のパスワードが一致しません');
  delete L.recovery; setPw(u, pw, false); u.off = false;
  const nc = newCode(), salt = randStr(16, HEX); R.salt = salt; R.hash = hashPw(nc.replace(/-/g, ''), salt); save();
  ['#rcCode', '#rcPw', '#rcPw2'].forEach(i => { $(i).value = ''; });
  showCreds('パスワードを再設定しました', '新しい復旧コードです。古いコードは使えなくなりました。控えてから閉じてください。', `復旧コード：${nc}`, () => { showLogin('login'); $('#lgMsg').textContent = '新しいパスワードでログインしてください'; });
});

/* パスワードの変更 */
let pwForced = false;
function openPw(forced) {
  pwForced = !!forced;
  ['#pwOld', '#pwNew', '#pwNew2'].forEach(i => { $(i).value = ''; }); $('#pwMsg').textContent = '';
  $('#pwNote').textContent = forced ? '初期パスワードのままです。新しいパスワードに変えてください。' : '';
  $('#pwCancel').hidden = pwForced; $('#pwModal').hidden = false; $('#pwOld').focus();
}
const closePw = () => { $('#pwModal').hidden = true; };
$('#uPw').addEventListener('click', () => openPw(false));
$('#pwCancel').addEventListener('click', closePw);
$('#pwModal').addEventListener('click', e => { if (e.target === $('#pwModal') && !pwForced) closePw(); });
$('#pwModal').addEventListener('keydown', e => { if (e.key === 'Escape' && !pwForced) closePw(); });
$('#pwSave').addEventListener('click', () => {
  const err = m => { $('#pwMsg').textContent = m; }, o = $('#pwOld').value, n = $('#pwNew').value;
  if (!checkPw(me, o)) return err('今のパスワードが違います');
  if (n.length < 6) return err('新しいパスワードは6文字以上にしてください');
  if (n !== $('#pwNew2').value) return err('確認用のパスワードが一致しません');
  if (n === o) return err('今と同じパスワードは使えません');
  setPw(me, n, false); saveSlice('auth'); closePw(); pwForced = false; renderAccounts(); renderAdmins();
  ui.toast('パスワードを変更しました');
});

/* 従業員画面の設定：パスワード（はじめは「設定」、設定後は「再設定」） */
function renderEmpPw() {
  const emp = !!(me && me.role === 'employee'), must = emp && me.must;
  $('#ePwNotice').hidden = !must;
  if (!emp) { $('#ePwTitle').textContent = 'パスワード設定'; $('#ePwNote').textContent = '従業員としてログインしたときに使える項目です（開発者の確認用の表示では、操作できません）。'; $('#ePwFields').hidden = true; return; }
  $('#ePwFields').hidden = false;
  $('#ePwTitle').textContent = must ? 'パスワード設定' : 'パスワード再設定';
  $('#ePwNote').textContent = must ? '管理者から受け取った初期パスワードのままです。ご自身のパスワードを決めてください。' : '旧パスワードと、新しいパスワードを入れて、登録してください。';
  $('#ePwOldRow').hidden = must; $('#ePwSave').textContent = must ? '登録する' : '変更する';
}
$('#ePwNotice').addEventListener('click', () => { eTab = 'rules'; renderEmployee(); });
$('#ePwSave').addEventListener('click', () => {
  if (!me || me.role !== 'employee') return;
  const err = m => { $('#ePwMsg').textContent = m; }, o = $('#ePwOld').value, n = $('#ePwNew').value, first = me.must;
  if (!first && !checkPw(me, o)) return err('旧パスワードが違います');
  if (n.length < 6) return err('新しいパスワードは6文字以上にしてください');
  if (n !== $('#ePwNew2').value) return err('確認用のパスワードが一致しません');
  if (!first && n === o) return err('今と同じパスワードは使えません');
  setPw(me, n, false); save();
  ['#ePwOld', '#ePwNew', '#ePwNew2'].forEach(i => { $(i).value = ''; }); err('');
  renderEmpPw(); ui.toast(first ? 'パスワードを設定しました' : 'パスワードを変更しました');
});

/* 発行したIDとパスワードの表示（この画面でしか確認できない） */
let credDone = null;
function showCreds(title, note, text, done) {
  $('#cTitle').textContent = title; $('#cNote').textContent = note; $('#cText').value = text;
  credDone = done || null; $('#credModal').hidden = false; $('#cClose').focus();
}
$('#cClose').addEventListener('click', () => { $('#credModal').hidden = true; $('#cText').value = ''; const f = credDone; credDone = null; if (f) f(); });
$('#cCopy').addEventListener('click', async () => {
  const t = $('#cText').value;
  try { if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(t); else { $('#cText').select(); document.execCommand('copy'); } ui.toast('コピーしました'); }
  catch (e) { $('#cText').select(); ui.toast('コピーできませんでした。選択した文字を手でコピーしてください', 'warn'); }
});

/* 設定タブ：従業員アカウント（管理者・開発者が操作） */
function renderAccounts() {
  const ul = $('#acList'); if (!ul) return;
  ul.innerHTML = state.staff.length ? state.staff.map(s => {
    const u = AUTH().users.find(x => x.staffId === s.id && x.role === 'employee');
    const st = !u ? '未発行' : u.off ? '無効' : u.must ? '初期パスワードのまま' : '有効';
    return `<li><div class="info"><b>${esc(s.name)}</b><span class="pill${u && !u.off && !u.must ? ' ok' : u && u.off ? ' warn' : ''}">${st}</span>` +
      (u ? `<div class="meta">ID：${esc(u.id)}${u.last ? ` ／ 最終ログイン ${fmtAt(u.last)}` : ' ／ まだログインしていません'}</div>` : '') + '</div>' +
      (u ? `<button type="button" class="btn small" data-ac="reset" data-s="${s.id}">パスワード再発行</button><button type="button" class="btn small" data-ac="${u.off ? 'on' : 'off'}" data-s="${s.id}">${u.off ? '有効にする' : '無効にする'}</button><button type="button" class="btn small" data-ac="del" data-s="${s.id}">削除</button>`
        : `<button type="button" class="btn small primary" data-ac="issue" data-s="${s.id}">発行</button>`) + '</li>';
  }).join('') : '<li class="meta">従業員がまだいません。</li>';
}
$('#acList').addEventListener('click', async e => {
  const act = e.target.dataset.ac; if (!act) return;
  const s = state.staff.find(x => x.id === e.target.dataset.s), u = AUTH().users.find(x => x.staffId === (s && s.id) && x.role === 'employee'); if (!s) return;
  if (act === 'issue' || act === 'reset') {
    if (act === 'reset' && !await ui.ask(`${s.name}さんのパスワードを再発行します。今のパスワードは使えなくなります。`, { ok: '再発行する' })) return;
    const r = issueFor(s); saveSlice('auth'); renderAccounts();
    showCreds(`${s.name}さんのアカウント`, '初期パスワードは、この画面でしか確認できません。本人に伝えてから閉じてください（最初のログインで本人が変更します）。', credText([r]));
  } else if (act === 'on' || act === 'off') { u.off = act === 'off'; saveSlice('auth'); renderAccounts(); ui.toast(u.off ? 'アカウントを無効にしました' : 'アカウントを有効にしました'); }
  else if (act === 'del') {
    if (!await ui.ask(`${s.name}さんのアカウントを削除します（従業員の登録は残ります）。`, { ok: '削除する', danger: true })) return;
    AUTH().users = AUTH().users.filter(x => x !== u); saveSlice('auth'); renderAccounts(); ui.toast('アカウントを削除しました');
  }
});
$('#acAll').addEventListener('click', async () => {
  const todo = state.staff.filter(s => !AUTH().users.some(u => u.staffId === s.id && u.role === 'employee'));
  if (!todo.length) return ui.toast('未発行の人はいません', 'warn');
  if (!await ui.ask(`アカウントが未発行の${todo.length}人に、IDと初期パスワードを発行します。`, { ok: '発行する' })) return;
  const rows = todo.map(issueFor); saveSlice('auth'); renderAccounts();
  showCreds(`${rows.length}人分のアカウントを発行しました`, '初期パスワードは、この画面でしか確認できません。コピーして控えてから閉じてください（最初のログインで本人が変更します）。', credText(rows));
});

/* 開発者画面：管理者・開発者アカウント */
function renderAdmins() {
  const ul = $('#adList'); if (!ul) return;
  const lastDev = u => u.role === 'dev' && !AUTH().users.some(x => x !== u && x.role === 'dev' && !x.off);
  ul.innerHTML = AUTH().users.filter(u => u.role !== 'employee').map(u => {
    const self = me && u.id === me.id, lock = self || lastDev(u) ? ' disabled' : '';
    return `<li><div class="info"><b>${esc(u.name)}</b> <span class="badge" style="background:${u.role === 'dev' ? '#6b5b95' : '#0f6e6e'}">${ROLE_LABEL[u.role]}</span>` +
      `${u.off ? '<span class="pill warn">無効</span>' : ''}${u.must ? '<span class="pill">初期パスワード</span>' : ''}` +
      `<div class="meta">ID：${esc(u.id)}${u.last ? ` ／ 最終ログイン ${fmtAt(u.last)}` : ' ／ まだログインしていません'}${self ? ' ／ 今のあなた' : ''}</div></div>` +
      `<button type="button" class="btn small" data-ad="reset" data-u="${esc(u.id)}">パスワード再発行</button>` +
      `<button type="button" class="btn small" data-ad="${u.off ? 'on' : 'off'}" data-u="${esc(u.id)}"${lock}>${u.off ? '有効にする' : '無効にする'}</button>` +
      `<button type="button" class="btn small" data-ad="del" data-u="${esc(u.id)}"${lock}>削除</button></li>`;
  }).join('');
}
$('#adList').addEventListener('click', async e => {
  const act = e.target.dataset.ad; if (!act) return;
  const u = findUser(e.target.dataset.u); if (!u) return;
  if (act === 'reset') {
    if (!await ui.ask(`${u.name}（${u.id}）のパスワードを再発行します。今のパスワードは使えなくなります。`, { ok: '再発行する' })) return;
    const pw = newPw(); setPw(u, pw, true); save(); renderAdmins();
    showCreds(`${u.name}さんのパスワード`, '新しいパスワードは、この画面でしか確認できません。本人に伝えてから閉じてください（次のログインで本人が変更します）。', credText([{ name: u.name, id: u.id, pw }]));
  } else if (act === 'on' || act === 'off') { u.off = act === 'off'; save(); renderAdmins(); ui.toast(u.off ? 'アカウントを無効にしました' : 'アカウントを有効にしました'); }
  else if (act === 'del') {
    if (!await ui.ask(`${u.name}（${u.id}）のアカウントを削除します。`, { ok: '削除する', danger: true })) return;
    AUTH().users = AUTH().users.filter(x => x !== u); save(); renderAdmins(); ui.toast('アカウントを削除しました');
  }
});
$('#adForm').addEventListener('submit', e => {
  e.preventDefault();
  const role = $('#adRole').value, id = $('#adId').value.trim(), name = $('#adName').value.trim(), pw0 = $('#adPw').value;
  if (!ID_RE.test(id)) return ui.toast('IDは、英数字と「_ . -」で3〜20文字にしてください', 'err');
  if (findUser(id)) return ui.toast('そのIDはすでに使われています', 'err');
  if (pw0 && pw0.length < 6) return ui.toast('パスワードは6文字以上にしてください', 'err');
  const pw = pw0 || newPw();
  AUTH().users.push(makeUser({ id, name: name || id, role, password: pw, must: !pw0 }));
  save(); $('#adForm').reset(); renderAdmins();
  if (!pw0) showCreds(`${name || id}さんのアカウント`, '初期パスワードは、この画面でしか確認できません。本人に伝えてから閉じてください（最初のログインで本人が変更します）。', credText([{ name: name || id, id, pw }]));
  else ui.toast('アカウントを追加しました');
});