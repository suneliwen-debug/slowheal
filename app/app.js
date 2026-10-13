/* SlowHeal 慢愈 — app logic (Supabase backend) */
/* 手机 Chrome 被切成「电脑版网站」时（或折叠屏自动切换），页面会缩得很小：自动放大回手机大小 */
(function () {
  function fit() {
    var sw = window.screen && screen.width, iw = window.innerWidth;
    if (!sw || !iw) return;
    var r = iw / sw, phone = Math.min(screen.width, screen.height) <= 820;
    document.documentElement.style.zoom = (phone && r > 1.25) ? String(Math.min(r, 4)) : '';
  }
  fit(); window.addEventListener('resize', fit); window.addEventListener('orientationchange', function () { setTimeout(fit, 300); });
})();
(function () {
  'use strict';

  /* ================= basics ================= */
  const C = window.SLOWHEAL_CONFIG || {};
  const configured = !!(C.SUPABASE_URL && C.SUPABASE_ANON_KEY && !/YOUR/i.test(C.SUPABASE_URL + C.SUPABASE_ANON_KEY));
  const sb = configured ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY) : null;
  const BUCKET = 'photos';
  const PERSONAL = !!C.PERSONAL;   // 个人版：没有账号、没有社区，资料只在这台手机

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const dk = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const rid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const NOW = () => new Date();
  const TODAY = () => dk(new Date());
  const fmt = ts => { const d = new Date(ts), n = new Date(); const t = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (dk(d) === dk(n)) return '今天 ' + t; const y = new Date(n); y.setDate(y.getDate() - 1); if (dk(d) === dk(y)) return '昨天 ' + t;
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + t; };
  const initial = s => (String(s || '?').trim()[0] || '?').toUpperCase();
  const avatarSVG = name => 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="#E6A9B7"/><text x="40" y="52" font-size="34" text-anchor="middle" fill="#fff" font-family="sans-serif">' + esc(initial(name)) + '</text></svg>');

  let toastT;
  function toast(msg) { const t = $('toast'); t.classList.remove('has-act'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2400); }
  function toastAct(msg, label, fn, ms) {
    const t = $('toast'); t.innerHTML = '<span>' + esc(msg) + '</span><button type="button" class="toast-act">' + esc(label) + '</button>'; t.hidden = false; t.classList.add('has-act');
    const hide = () => { t.hidden = true; t.classList.remove('has-act'); };
    t.querySelector('button').onclick = () => { clearTimeout(toastT); hide(); fn(); };
    clearTimeout(toastT); toastT = setTimeout(hide, ms || 5000);
  }
  function fail(e, fallback) { console.error(e); toast(fallback || '没有成功，请检查网络后再试'); }

  /* ================= state ================= */
  let U = null;            // auth user
  const CASE_KINDS = ['reason', 'moment'];
  const activeCase = () => (S.cases || []).find(c => c.status === 'active') || null;
  const activeId = () => { const c = activeCase(); return c ? c.id : null; };
  const vis = () => S.records.filter(r => !CASE_KINDS.includes(r.kind) || (r.case_id || null) === activeId());
  const lettersVis = () => S.letters.filter(l => (l.case_id || null) === activeId());
  function syncContact() { const c = activeCase(); S.contact = c ? { name: c.name || 'TA', avatar: c.avatar || null, style: c.style || 'green', blur: !!c.blur } : { name: 'TA', avatar: null, style: 'green', blur: false }; }
  const S = { cases: [], episodes: [], capsules: [], profile: null, moods: {}, checkins: {}, records: [], contact: null, letters: [], feedFilter: 'all', feedCursor: null, myCheers: new Set(), postCount: 0 };

  /* ================= sheet ================= */
  const bg = $('sheetBg'), sh = $('sheet');
  let sheetTimers = [];
  function openSheet(html, after) {
    sh.innerHTML = '<button class="close" data-close type="button">关闭</button>' + html;
    bg.hidden = false; sh.scrollTop = 0;
    sh.querySelectorAll('[data-close]').forEach(b => b.onclick = closeSheet);
    after && after();
  }
  function closeSheet() { bg.hidden = true; sh.innerHTML = ''; sheetTimers.forEach(clearInterval); sheetTimers = []; if (typeof Music !== 'undefined') Music.stop(); }
  bg.addEventListener('click', e => { if (e.target === bg) closeSheet(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !bg.hidden) closeSheet(); });

  function delBtn(onDel, label) {
    const b = document.createElement('button'); b.className = 'del'; b.type = 'button'; b.textContent = label || '删除';
    b.onclick = () => { if (b.classList.contains('armed')) onDel(); else { b.classList.add('armed'); b.textContent = '再点一次删除'; setTimeout(() => { b.classList.remove('armed'); b.textContent = label || '删除'; }, 2500); } };
    return b;
  }

  /* ================= photos ================= */
  function compress(file, max) {
    return new Promise(res => {
      const u = URL.createObjectURL(file), im = new Image();
      im.onload = () => {
        const m = max || 1600, sc = Math.min(1, m / Math.max(im.width, im.height));
        const c = document.createElement('canvas'); c.width = Math.round(im.width * sc); c.height = Math.round(im.height * sc);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
        c.toBlob(b => res(b), 'image/jpeg', .85);
      };
      im.onerror = () => { URL.revokeObjectURL(u); res(null); };
      im.src = u;
    });
  }
  async function uploadBlobs(blobs) {
    const paths = [];
    for (const b of blobs) {
      const p = U.id + '/' + rid() + '.jpg';
      const { error } = await sb.storage.from(BUCKET).upload(p, b, { contentType: 'image/jpeg', upsert: false });
      if (error) throw error;
      paths.push(p);
    }
    return paths;
  }
  async function removeFiles(paths) { if (paths && paths.length) await sb.storage.from(BUCKET).remove(paths).catch(() => {}); }

  const urlCache = new Map(); // path -> {url, exp}
  async function signed(paths) {
    const now = Date.now(), need = [...new Set(paths)].filter(p => { const c = urlCache.get(p); return !c || c.exp < now + 60000; });
    for (let i = 0; i < need.length; i += 50) {
      const chunk = need.slice(i, i + 50);
      const { data } = await sb.storage.from(BUCKET).createSignedUrls(chunk, 3600);
      (data || []).forEach(d => { if (d.signedUrl) urlCache.set(d.path, { url: d.signedUrl, exp: now + 3600000 }); });
    }
    const out = {}; paths.forEach(p => { const c = urlCache.get(p); if (c) out[p] = c.url; }); return out;
  }
  // fill every [data-imgs] box under root
  async function hydrate(root) {
    const boxes = [...root.querySelectorAll('[data-imgs]')];
    const all = boxes.flatMap(b => b.dataset.imgs.split('|').filter(Boolean));
    if (!all.length) return;
    const map = await signed(all).catch(() => ({}));
    boxes.forEach(box => {
      if (!box.dataset.imgs) return;
      const ids = box.dataset.imgs.split('|').filter(Boolean); box.removeAttribute('data-imgs'); box.innerHTML = '';
      ids.forEach(p => { if (!map[p]) return; const b = document.createElement('button'); b.type = 'button'; b.className = 'thumb'; b.setAttribute('aria-label', '查看照片');
        b.innerHTML = '<img src="' + map[p] + '" alt="" loading="lazy">'; b.onclick = e => { e.stopPropagation(); openSheet('<div class="viewer"><img src="' + map[p] + '" alt="照片"></div>'); }; box.appendChild(b); });
    });
  }
  const imgBox = (paths, cls) => paths && paths.length ? '<div class="' + (cls || 'thumbs') + (paths.length === 1 && cls === 'grid' ? ' one' : '') + '" data-imgs="' + esc(paths.join('|')) + '"></div>' : '';

  function makePicker(el, max, opts) {
    const st = { blobs: [] };
    if (!opts || !opts.bare) el.innerHTML = '<label class="addimg"><input type="file" accept="image/*" multiple>＋ 上传截图 / 照片</label><div class="thumbs"></div>';
    const inp = (opts && opts.input) || el.querySelector('input'), th = (opts && opts.thumbs) || el.querySelector('.thumbs');
    const draw = () => { th.innerHTML = ''; st.blobs.forEach((b, i) => { const u = URL.createObjectURL(b), t = document.createElement('button'); t.type = 'button'; t.className = 'thumb'; t.setAttribute('aria-label', '移除这张');
      t.innerHTML = '<img src="' + u + '" alt=""><span class="x">×</span>'; t.onclick = () => { URL.revokeObjectURL(u); st.blobs.splice(i, 1); draw(); }; th.appendChild(t); }); };
    inp.onchange = async () => { for (const f of inp.files) { if (st.blobs.length >= max) { toast('一次最多 ' + max + ' 张'); break; } const b = await compress(f); if (b) st.blobs.push(b); else toast('有一张图片打不开'); } inp.value = ''; draw(); };
    st.reset = () => { st.blobs = []; draw(); };
    return st;
  }

  /* ================= auth ================= */
  let authMode = 'login';
  document.querySelectorAll('[data-auth]').forEach(b => b.onclick = () => {
    authMode = b.dataset.auth;
    document.querySelectorAll('[data-auth]').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
    const su = authMode === 'signup';
    $('aNick').hidden = !su; $('aAgreeRow').hidden = !su; $('aForgot').hidden = su;
    $('aSubmit').textContent = su ? '注册' : '登录';
    $('aPass').autocomplete = su ? 'new-password' : 'current-password';
    $('aMsg').textContent = ''; $('aMsg').className = 'msg';
  });
  function authMsg(t, ok) { $('aMsg').textContent = t; $('aMsg').className = 'msg' + (ok ? ' ok' : ''); }
  const authErr = e => { const m = (e && e.message) || '';
    if (/Invalid login/i.test(m)) return '邮箱或密码不对';
    if (/not confirmed/i.test(m)) return '请先到邮箱点确认链接';
    if (/already registered/i.test(m)) return '这个邮箱已经注册过了，请直接登录';
    if (/Password should/i.test(m)) return '密码至少 6 位';
    if (/rate limit/i.test(m)) return '操作太频繁，请稍后再试';
    return '没有成功：' + m; };
  $('authForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!sb) return authMsg('App 还没连上后台（config.js 未填写）');
    const email = $('aEmail').value.trim(), password = $('aPass').value;
    if (!/^\S+@\S+\.\S+$/.test(email)) return authMsg('请输入正确的邮箱');
    if (password.length < 6) return authMsg('密码至少 6 位');
    $('aSubmit').disabled = true;
    try {
      if (authMode === 'signup') {
        if (!$('aAgree').checked) return authMsg('请先勾选同意');
        const nickname = $('aNick').value.trim() || '匿名';
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { nickname }, emailRedirectTo: location.origin + location.pathname } });
        if (error) return authMsg(authErr(error));
        if (!data.session) authMsg('确认邮件已寄到 ' + email + '，点邮件里的链接后回来登录。', true);
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) return authMsg(authErr(error));
      }
    } finally { $('aSubmit').disabled = false; }
  });
  if ($('aGoogle')) $('aGoogle').onclick = async () => {
    if (!sb) return authMsg('App 还没连上后台');
    $('aGoogle').disabled = true;
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
    if (error) { $('aGoogle').disabled = false; authMsg(/provider/i.test(error.message) ? 'Google 登录还没开通，请先用邮箱注册' : authErr(error)); }
  };
  $('aForgot').onclick = async () => {
    const email = $('aEmail').value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return authMsg('先在上面填你的邮箱');
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    authMsg(error ? authErr(error) : '重设密码的邮件已寄出，请查收。', !error);
  };
  function newPasswordSheet() {
    openSheet('<h2>设置新密码</h2><input type="password" id="np" placeholder="新密码（至少 6 位）" autocomplete="new-password"><button class="btn" id="npBtn" type="button">保存</button><p class="msg" id="npMsg"></p>', () => {
      $('npBtn').onclick = async () => { const p = $('np').value; if (p.length < 6) { $('npMsg').textContent = '至少 6 位'; return; }
        const { error } = await sb.auth.updateUser({ password: p }); if (error) $('npMsg').textContent = authErr(error); else { closeSheet(); toast('密码已更新'); } };
    });
  }

  function showAuth() { U = null; $('main').hidden = true; $('auth').hidden = false; if (!sb) authMsg('App 还没连上后台：请在 config.js 填入 Supabase 的网址和 key。'); }
  if (!sb) showAuth();
  else sb.auth.onAuthStateChange((ev, session) => {
    setTimeout(() => {
      if (ev === 'PASSWORD_RECOVERY') newPasswordSheet();
      if (session && session.user) { if (!U || U.id !== session.user.id) enter(session.user); }
      else showAuth();
    }, 0);
  });

  /* ================= 旧资料搬进第一份疗愈档案 ================= */
  async function migrateCases(oldContact) {
    if (S.cases.length) return;
    const loose = { records: S.records.filter(r => CASE_KINDS.includes(r.kind) && !r.case_id), letters: S.letters.filter(l => !l.case_id), episodes: S.episodes.filter(e => (e.kind === 'peek' || e.kind === 'contact') && !e.case_id) };
    const hasData = loose.records.length || loose.letters.length || (oldContact && oldContact.name && oldContact.name !== 'TA');
    if (!hasData && S.profile.mode === 'daily') return;
    const oc = oldContact || {};
    const { data: c, error } = await sb.from('cases').insert({ name: oc.name || 'TA', avatar: oc.avatar || null, style: oc.style || 'green', blur: !!oc.blur, status: 'active' }).select().single();
    if (error) { console.error(error); return; }
    S.cases.push(c);
    for (const [t, rows] of Object.entries(loose)) {
      if (!rows.length) continue;
      const { error: e2 } = await sb.from(t).update({ case_id: c.id }).in('id', rows.map(x => x.id));
      if (!e2) rows.forEach(x => x.case_id = c.id);
    }
  }

  /* ================= enter + load ================= */
  async function enter(user) {
    U = user; $('auth').hidden = true; $('main').hidden = false; $('meEmail').textContent = user.email || '';
    try {
      const [p, m, c, r, ct, l, ep, cp, cs] = await Promise.all([
        sb.from('profiles').select('*').eq('id', U.id).maybeSingle(),
        sb.from('moods').select('*'),
        sb.from('checkins').select('*'),
        sb.from('records').select('*').order('created_at', { ascending: false }),
        sb.from('chat_contact').select('*').maybeSingle(),
        sb.from('letters').select('*').order('created_at', { ascending: true }),
        sb.from('episodes').select('*').order('created_at', { ascending: false }).limit(1000),
        sb.from('capsules').select('*').order('unlock_at', { ascending: true }),
        sb.from('cases').select('*').order('started_at', { ascending: true })
      ]);
      [p, m, c, r, ct, l, ep, cp, cs].forEach(x => { if (x.error) throw x.error; });
      S.cases = cs.data || [];
      S.episodes = ep.data || []; S.capsules = cp.data || [];
      S.profile = p.data || { nickname: '匿名', created_at: new Date().toISOString() };
      S.moods = {}; (m.data || []).forEach(x => S.moods[x.day] = x);
      S.checkins = {}; (c.data || []).forEach(x => S.checkins[x.day] = x.items || []);
      S.records = r.data || [];
      S.letters = l.data || [];
      await migrateCases(ct.data);
      syncContact();
    } catch (e) { fail(e, '读取资料失败，请检查网络'); }
    if (S.profile.mode !== 'daily' && !activeCase()) S.profile.mode = 'daily';
    if (S.profile.mode === 'daily' && activeCase()) S.profile.mode = 'heal';  // 疗愈中：先专心走完这一段
    applyMode(); renderChatHead(); renderLetters(); renderMe(); renderCases();
    loadFeed(true);
    await maybeLock();
  }

  /* ================= navigation ================= */
  function go(v) {
    document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.v === v ? 'true' : 'false'));
    document.querySelectorAll('.view').forEach(x => x.hidden = x.id !== 'v-' + v);
    $('sosBtn').hidden = v === 'chat';
    if (v === 'chat') scrollChat(); else window.scrollTo(0, 0);
    if (v === 'me') renderMe();
  }
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => go(t.dataset.v));

  /* ================= 今日 ================= */
  const MODE = () => (S.profile && S.profile.mode) || 'heal';
  const MOODS_HEAL = [['想念对方', 2], ['难过想哭', 1.5], ['委屈崩溃', 1], ['愤怒难受', 1.5], ['不甘心', 2], ['后悔自责', 1.5], ['孤独无助', 1.5], ['焦虑不安', 2], ['睡不着', 2], ['空空的', 2], ['心好累', 2.5], ['情绪平稳', 4], ['释怀了一点', 4], ['被朋友治愈', 4.5], ['有点开心', 4.5], ['自愈一点点', 4.5]];
  const MOODS_DAILY = [['超开心', 5], ['小确幸', 4.5], ['被爱着', 4.5], ['充满能量', 4.5], ['期待', 4], ['平静', 4], ['有点累', 2.5], ['有点低落', 2], ['生气', 1.5], ['烦躁', 2], ['委屈', 1.5], ['崩溃', 1], ['难过', 1.5], ['焦虑', 2]];
  const SCORE = Object.fromEntries(MOODS_HEAL.concat(MOODS_DAILY, [['想联系TA', 1.5]]));
  let MOODS = MOODS_HEAL;
  const CARE_DEFAULT = [{ id: 0, t: '好好吃三餐' }, { id: 1, t: '12 点前睡觉' }, { id: 2, t: '出门走走或运动 20 分钟' }];
  const CARE_MAX = 5;
  const careList = () => (S.profile && Array.isArray(S.profile.care) && S.profile.care.length) ? S.profile.care : CARE_DEFAULT;
  async function saveCare(list) {
    const prev = S.profile.care; S.profile.care = list; renderToday();
    const { error } = await sb.from('profiles').update({ care: list }).eq('id', U.id);
    if (error) { S.profile.care = prev; renderToday(); fail(error); }
  }
  const QUOTES_DAILY = ['今天也值得被好好过。', '小小的开心，也值得记下来。', '你正在成为更喜欢的自己。', '好事正在慢慢发生。', '把日子过成自己喜欢的样子。', '对自己好一点，是最好的开始。', '你笑起来的样子很好看。', '今天的阳光，是给你的。', '你值得所有温柔的事。', '新的一页，由你来写。'];
  const QUOTES_HEAL = ['今天很难受的话，就只做一件事：好好睡一觉。', '你想念的，可能是那时候的自己，不一定是 TA。', '你不是太敏感，是真的被伤到了。', '放不下也没关系，先放一点点。', '你不需要任何人的回复，才能好好过今天。', '反复想起不是失败，是心在慢慢消化。', '今天没有联系 TA，已经很了不起了。', '你值得一段不用猜、不用忍的关系。', '允许今天比昨天差一点，明天再说。', '变好不是为了让谁后悔，是为了找回自己。'];
  const sel = new Set();
  const customMoods = () => ((S.profile && Array.isArray(S.profile.custom_moods)) ? S.profile.custom_moods : []);
  const myMoods = () => customMoods().filter(x => (x.m || 'heal') === MODE());
  const scoreOf = t => SCORE[t] != null ? SCORE[t] : ((customMoods().find(x => x.t === t) || {}).s || 3);
  async function saveCustomMoods(list) {
    const prev = S.profile.custom_moods; S.profile.custom_moods = list; buildMoodChips();
    const { error } = await sb.from('profiles').update({ custom_moods: list }).eq('id', U.id);
    if (error) { S.profile.custom_moods = prev; buildMoodChips(); fail(error); return false; }
    return true;
  }
  function customMoodSheet() {
    let lvl = 3;
    const mine = myMoods();
    openSheet('<h2>写下你自己的心情</h2><p class="hint">现在的感觉，用你自己的话来说。</p>' +
      '<input type="text" id="cmName" maxlength="8" placeholder="例如：有点想哭、松了一口气">' +
      '<span class="label">这个心情比较像</span><div class="chips" id="cmLvl">' +
      [['😊 偏开心', 4.5], ['😐 说不上来', 3], ['😢 偏难过', 1.5]].map(([t, v]) => '<button type="button" class="chip" data-v="' + v + '" aria-pressed="' + (v === 3) + '">' + t + '</button>').join('') + '</div>' +
      '<button class="btn" id="cmGo" type="button">加上这个心情</button>' +
      (mine.length ? '<span class="label">我写过的心情</span><ul class="list" id="cmList">' + mine.map(x => '<li class="line"><span class="txt">' + esc(x.t) + '</span><button type="button" class="link" data-t="' + esc(x.t) + '">删除</button></li>').join('') + '</ul>' : ''), () => {
      $('cmLvl').querySelectorAll('button').forEach(b => b.onclick = () => { lvl = +b.dataset.v; $('cmLvl').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false')); });
      $('cmGo').onclick = async () => {
        const t = $('cmName').value.trim(); if (!t) return $('cmName').focus();
        if (MOODS.some(([m]) => m === t) || myMoods().some(x => x.t === t)) { sel.add(t); buildMoodChips(); closeSheet(); return; }
        if (myMoods().length >= 12) return toast('最多 12 个，先删掉一个不用的');
        $('cmGo').disabled = true;
        if (await saveCustomMoods(customMoods().concat({ t, s: lvl, m: MODE() }))) { sel.add(t); buildMoodChips(); closeSheet(); toast('加好了，以后都可以选'); }
        else $('cmGo').disabled = false;
      };
      if ($('cmList')) $('cmList').querySelectorAll('button').forEach(b => b.onclick = async () => {
        const t = b.dataset.t; sel.delete(t);
        if (await saveCustomMoods(customMoods().filter(x => !(x.t === t && (x.m || 'heal') === MODE())))) b.closest('li').remove();
      });
      setTimeout(() => { if ($('cmName')) $('cmName').focus(); }, 100);
    });
  }
  function buildMoodChips() {
    $('moodChips').innerHTML = '';
    MOODS.concat(myMoods().map(x => [x.t, x.s])).forEach(([m]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip' + (m === '想联系TA' ? ' alert' : ''); b.textContent = m; b.dataset.m = m; b.setAttribute('aria-pressed', sel.has(m) ? 'true' : 'false');
      b.onclick = () => { if (sel.has(m)) sel.delete(m); else { sel.add(m); if (m === '想联系TA') { logEpisode('contact'); openImpulse(); } } b.setAttribute('aria-pressed', sel.has(m) ? 'true' : 'false'); };
      $('moodChips').appendChild(b); });
    const add = document.createElement('button'); add.type = 'button'; add.className = 'chip chip-add'; add.textContent = '＋ 自己写';
    add.onclick = customMoodSheet; $('moodChips').appendChild(add);
  }
  buildMoodChips();
  $('saveMood').onclick = async () => {
    const note = $('moodNote').value.trim(), prev = S.moods[TODAY()];
    if (!sel.size && !note) { $('moodSaved').textContent = '选一个心情，或写一句话'; return; }
    const tags = sel.size ? [...sel] : [];
    const score = tags.length ? Math.round(tags.reduce((a, t) => a + scoreOf(t), 0) / tags.length * 10) / 10 : (prev ? Number(prev.score) : 3);
    const entries = moodEntries(prev, TODAY()).concat({ at: new Date().toISOString(), text: note || null, tags }).slice(-50);
    const row = { user_id: U.id, day: TODAY(), tags: tags.length ? tags : ((prev && prev.tags) || []), note: note || (prev && prev.note) || null, score, entries };
    $('saveMood').disabled = true;
    const { error } = await sb.from('moods').upsert(row);
    $('saveMood').disabled = false;
    if (error) return fail(error);
    S.moods[row.day] = row; $('moodNote').value = '';
    $('moodSaved').textContent = (MODE() === 'daily' ? (tags.length && score < 3 ? '记下了。生气、难过都是被允许的，抱抱你。' : '记下了，今天也很棒。') : '记下了。今天辛苦了。') + '点曲线上的点可以回看。'; renderToday();
  };
  // 每天可以记很多次，像日记一样留着
  function moodEntries(m, day) {
    if (!m) return [];
    if (Array.isArray(m.entries) && m.entries.length) return m.entries.slice();
    return m.note || (m.tags && m.tags.length) ? [{ at: day + 'T12:00:00', text: m.note || null, tags: m.tags || [] }] : [];
  }
  const WK = ['日', '一', '二', '三', '四', '五', '六'];
  const dayTitle = day => { const d = new Date(day + 'T00:00:00'); return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · 星期' + WK[d.getDay()]; };
  const moodDays = () => Object.keys(S.moods).filter(d => moodEntries(S.moods[d], d).length).sort();
  function openDay(day) {
    const list = moodDays(), idx = list.indexOf(day), m = S.moods[day], es = moodEntries(m, day).slice().reverse();
    openSheet('<span class="label">心情日记</span><h2>' + dayTitle(day) + '</h2>' +
      (m && m.tags && m.tags.length ? '<div class="chips">' + m.tags.map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>' : '') +
      (es.length ? '<ul class="list diary">' + es.map(e => { const d = new Date(e.at); return '<li class="diary-item"><time>' + (e.at.length > 10 && !/T12:00:00$/.test(e.at) ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : '') + '</time><div>' +
        ((e.tags || []).length ? '<small>' + e.tags.map(esc).join(' · ') + '</small>' : '') + '<p>' + (e.text ? esc(e.text) : '<span class="hint">这次只记了心情</span>') + '</p></div></li>'; }).join('') + '</ul>'
        : '<p class="hint">这一天没有写下什么。</p>') +
      '<div class="row between"><button class="btn ghost" id="dPrev" type="button"' + (idx > 0 ? '' : ' disabled') + '>‹ 前一天</button><button class="btn soft" id="dAll" type="button">全部日记</button><button class="btn ghost" id="dNext" type="button"' + (idx > -1 && idx < list.length - 1 ? '' : ' disabled') + '>后一天 ›</button></div>', () => {
      $('dPrev').onclick = () => idx > 0 && openDay(list[idx - 1]);
      $('dNext').onclick = () => idx < list.length - 1 && openDay(list[idx + 1]);
      $('dAll').onclick = openDiary;
    });
  }
  function openDiary() {
    const days = moodDays().reverse();
    openSheet('<h2>我的心情日记</h2>' + (days.length ? '<ul class="list">' + days.map(d => { const es = moodEntries(S.moods[d], d), last = es.filter(e => e.text).pop();
      return '<li><button class="diary-day" type="button" data-day="' + d + '"><b>' + dayTitle(d) + '</b><small>' + esc((S.moods[d].tags || []).join(' · ')) + ' · 记了 ' + es.length + ' 次</small>' + (last ? '<span>' + esc(last.text) + '</span>' : '') + '</button></li>'; }).join('') + '</ul>'
      : '<p class="hint">还没有记录。在今日页选心情、写一句，就会留在这里。</p>'), () => {
      sh.querySelectorAll('[data-day]').forEach(b => b.onclick = () => openDay(b.dataset.day));
    });
  }
  $('diaryAll').onclick = () => openDiary();
  [['chart7'], ['chart30']].forEach(([id]) => $(id).addEventListener('click', e => { const t = e.target.closest('[data-day]'); if (t) openDay(t.dataset.day); }));
  function series(n) { const out = []; for (let i = n - 1; i >= 0; i--) { const d = NOW(); d.setDate(d.getDate() - i); const m = S.moods[dk(d)]; out.push({ d, v: m ? Number(m.score) : null }); } return out; }
  function chart(n) {
    const data = series(n), W = 320, H = 140, L = 34, R = 10, T = 12, B = 26, iw = W - L - R, ih = H - T - B;
    const x = i => L + i * iw / (n - 1), y = v => T + (5 - v) / 4 * ih;
    let g = ''; [1, 3, 5].forEach(v => { g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)" stroke-width="1"/>'; });
    g += '<text x="' + (L - 6) + '" y="' + (y(5) + 4) + '" text-anchor="end" font-size="10" fill="var(--muted)">' + (MODE() === 'daily' ? '开心' : '平稳') + '</text><text x="' + (L - 6) + '" y="' + (y(1) + 4) + '" text-anchor="end" font-size="10" fill="var(--muted)">' + (MODE() === 'daily' ? '低落' : '很痛') + '</text>';
    const pts = data.map((p, i) => p.v == null ? null : [x(i), y(p.v)]);
    let seg = [], path = ''; pts.forEach(p => { if (p) seg.push(p); else if (seg.length) { path += 'M' + seg.map(q => q.join(',')).join('L'); seg = []; } }); if (seg.length) path += 'M' + seg.map(q => q.join(',')).join('L');
    if (path) g += '<path d="' + path + '" fill="none" stroke="var(--mist)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
    pts.forEach((p, i) => { if (p) g += '<circle class="pt-hit" data-day="' + dk(data[i].d) + '" cx="' + p[0] + '" cy="' + p[1] + '" r="14" fill="rgba(0,0,0,0)"><title>' + dayTitle(dk(data[i].d)) + '</title></circle>'; });
    pts.forEach((p, i) => { if (p) g += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + (i === n - 1 ? 5 : 3.5) + '" fill="' + (i === n - 1 ? 'var(--blush)' : 'var(--mist)') + '"/>'; });
    const step = n <= 7 ? 1 : Math.ceil(n / 6);
    data.forEach((p, i) => { if (i % step === 0 || i === n - 1) g += '<text x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="10" fill="var(--muted)">' + (i === n - 1 ? '今天' : (p.d.getMonth() + 1) + '/' + p.d.getDate()) + '</text>'; });
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="情绪曲线">' + g + '</svg>';
  }
  function dayN() { return Math.max(1, Math.floor((new Date(TODAY()) - new Date(dk(new Date(S.profile.created_at)))) / 864e5) + 1); }
  function renderToday() {
    const h = NOW().getHours(), nick = S.profile.nickname || '';
    const hi = h < 5 ? '这么晚还没睡' : h < 11 ? '早安' : h < 18 ? '午安' : '晚上好';
    $('hello').textContent = hi + (nick && nick !== '匿名' ? '，' + nick : '') + '。';
    $('dayline').textContent = '这是你来到慢愈的第 ' + dayN() + ' 天。';
    const tm = S.moods[TODAY()]; sel.clear(); (tm ? tm.tags : []).forEach(t => { if (MOODS.some(x => x[0] === t)) sel.add(t); });
    $('moodChips').querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', sel.has(c.dataset.m) ? 'true' : 'false'));
    $('chart7').innerHTML = chart(7);
    const d = NOW(), Q = MODE() === 'daily' ? QUOTES_DAILY : QUOTES_HEAL; $('quote').textContent = Q[(d.getDate() + d.getMonth() * 31) % Q.length];
    const done = S.checkins[TODAY()] || [], ul = $('rxList'); ul.innerHTML = '';
    const list = careList();
    list.forEach(({ id: i, t }) => { const li = document.createElement('li'); li.className = 'task';
      li.innerHTML = '<input type="checkbox" id="care' + i + '"' + (done.includes(i) ? ' checked' : '') + '><label for="care' + i + '">' + esc(t) + '</label>';
      if (list.length > 1) li.appendChild(delBtn(() => saveCare(list.filter(x => x.id !== i))));
      li.querySelector('input').onchange = async e => {
        const cur = new Set(S.checkins[TODAY()] || []); e.target.checked ? cur.add(i) : cur.delete(i);
        const items = [...cur].sort((a, b) => a - b), prev = S.checkins[TODAY()]; S.checkins[TODAY()] = items; renderTodayStats();
        const { error } = await sb.from('checkins').upsert({ user_id: U.id, day: TODAY(), items });
        if (error) { S.checkins[TODAY()] = prev || []; renderToday(); fail(error); }
      };
      ul.appendChild(li); });
    $('careAddRow').hidden = list.length >= CARE_MAX;
    $('careCount').textContent = list.length >= CARE_MAX ? '最多 ' + CARE_MAX + ' 件' : list.length + ' / ' + CARE_MAX;
    renderTodayStats(); renderCards(); renderUrge(); renderCapReady();
  }
  $('careAdd').onclick = () => {
    const t = $('careIn').value.trim(); if (!t) return $('careIn').focus();
    const list = careList(); if (list.length >= CARE_MAX) return toast('最多 ' + CARE_MAX + ' 件');
    $('careIn').value = ''; saveCare(list.concat({ id: Math.max(-1, ...list.map(x => x.id)) + 1, t }));
  };
  $('careIn').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); $('careAdd').click(); } });
  function renderTodayStats() {
    let st = 0; for (let i = 0; i < 400; i++) { const d = NOW(); d.setDate(d.getDate() - i); const r = S.checkins[dk(d)]; if (r && r.length) st++; else if (i > 0) break; }
    $('streak').textContent = st ? '已经连续 ' + st + ' 天照顾自己。' : '做一件就很好。';
  }

  /* ================= 模式 ================= */
  const RK = () => MODE() === 'daily' ? 'selflove' : 'reason';
  const MK = () => MODE() === 'daily' ? 'joy' : 'moment';
  function applyMode() {
    const daily = MODE() === 'daily';
    MOODS = daily ? MOODS_DAILY : MOODS_HEAL; buildMoodChips();
    document.documentElement.dataset.mode = daily ? 'daily' : 'heal';
    const tc = document.querySelector('meta[name="theme-color"]'); if (tc) tc.content = daily ? '#D9714A' : '#8F86C2';
    document.querySelector('.tab[data-v="chat"]').hidden = daily;
    $('urgeCard').hidden = daily;
    $('sosBtn').textContent = daily ? '抱抱' : '急救';
    layoutTabs();
    $('moodNote').placeholder = daily ? '今天发生了什么事？' : '一句话记下今天，也可以不写';
    $('heartTab').textContent = daily ? '慢观' : '心事';
    $('heartTitle').textContent = daily ? '慢观自我' : '心事';
    $('heartBrand').textContent = daily ? '新的一页，由你来写' : '只有你自己看得到';
    $('reasonLabel').textContent = daily ? '我喜欢自己的地方' : '我们不合适的理由';
    $('reasonText').placeholder = daily ? '例如：我很会照顾身边的人' : '再写一条，例如：吵架就消失好几天';
    $('momentLabel').textContent = daily ? '记下今天的自己' : '截图和当时的感受';
    $('momentText').placeholder = daily ? '今天发生了什么开心、好笑、可爱的事？' : '看到这些的时候，我的感受是……';
    $('momentReason').hidden = daily;
    $('joyTools').hidden = !daily;
    
    // 失恋夸夸圈 和 生活圈 分开
    const cTab = document.querySelector('.tab[data-v="circle"]');
    if (PERSONAL) { cTab.lastChild.textContent = '夸夸'; document.querySelector('#circleSeg [data-c="feed"]').textContent = daily ? '生活日记' : '夸夸日记'; document.querySelector('#v-circle h1').textContent = daily ? '生活日记' : '夸夸日记'; }
    else {
      cTab.lastChild.textContent = daily ? '生活圈' : '夸夸圈';
      document.querySelector('#circleSeg [data-c="feed"]').textContent = daily ? '生活圈' : '夸夸圈';
      document.querySelector('#v-circle h1').textContent = daily ? '生活圈' : '夸夸圈';
      document.querySelector('#v-circle .brand').textContent = daily ? '分享生活里的小美好' : '一起走出来，互相夸夸';
      $('newPost').textContent = daily ? '分享生活' : '写夸夸日记';
    }
    if (U && S.circleMode !== (daily ? 'daily' : 'heal')) { S.circleMode = daily ? 'daily' : 'heal'; loadFeed(true); if (typeof cheer === 'function' && $('cheerTxt')) cheer(); }
    const gBtn = document.querySelector('#circleSeg [data-c="goals"]'); gBtn.hidden = !daily;
    if (!daily && gBtn.getAttribute('aria-selected') === 'true') document.querySelector('#circleSeg [data-c="feed"]').click();
    document.querySelectorAll('#topMode button').forEach(b => b.setAttribute('aria-selected', b.dataset.m === MODE() ? 'true' : 'false'));
    const locked = !!activeCase() && !daily;
    document.querySelectorAll('#topMode [data-m="daily"], #modeSeg [data-m="daily"]').forEach(b => { b.textContent = locked ? '🔒 慢观自我' : '慢观自我'; b.classList.toggle('locked', locked); });
    $('topMode').hidden = false; $('modeSeg').hidden = false;  // 今日页只显示当前模式名称，切换在「我的」
    document.querySelectorAll('#topMode button').forEach(b => { b.hidden = b.dataset.m !== MODE(); });
    $('nextTab').textContent = daily ? '愿望' : '下一任';
    $('wantList').closest('.card').hidden = daily; $('noList').closest('.card').hidden = daily; $('wishCard').hidden = !daily; $('goalCard').hidden = !daily;
    if (daily) renderWishes();
    $('nextTitle').textContent = daily ? '愿望与显化' : '对下一任的期待';
    $('nextBrand').textContent = daily ? '想做的事一件件去做，想要的生活先写下来' : '下一次，我值得被好好对待';
    $('wantLabel').textContent = daily ? '我希望身边的人' : '我希望下一任';
    $('noLabel').textContent = daily ? '我不再接受' : '我绝不再接受';
    document.querySelectorAll('#modeSeg button').forEach(b => b.setAttribute('aria-selected', b.dataset.m === MODE() ? 'true' : 'false'));
    $('modeHint').textContent = daily ? '记录开心、好笑的小事，喜欢上现在的自己。如果又遇到难过的事，可以再开启新一轮疗愈。' : (activeCase() ? '先专心走完这一段。等你好起来，归档这段关系，「慢观自我」就会为你打开。' : '陪你度过失恋、吵架和放不下的时候。');
    if (daily && !$('v-chat').hidden) go('today');
    renderToday(); renderHeart();
  }
  function lockSheet() {
    openSheet('<div class="celebrate"><div class="lock-ico">🔒</div><h2>先专心照顾好自己</h2>' +
      '<p>「慢观自我」是留给走出来以后的你的。</p><p>现在先专心走完这一段。等你觉得自己好起来了，归档这段关系，「慢观自我」就会为你打开。</p>' +
      '<div class="stack-btns"><button class="btn ghost" data-close type="button">好，我再陪自己走一段</button><button class="link" id="lkGo" type="button">我已经走出来了，归档这段关系</button></div></div>', () => {
      $('lkGo').onclick = () => archiveSheet();
    });
  }
  async function setMode(m, quiet) {
    if (m === 'heal' && !activeCase()) { applyMode(); return newCaseSheet(); }
    if (m === 'daily' && activeCase() && !quiet) { applyMode(); return lockSheet(); }
    if (m === MODE()) return;
    const prev = MODE(); S.profile.mode = m; applyMode();
    const { error } = await sb.from('profiles').update({ mode: m }).eq('id', U.id);
    if (error) { S.profile.mode = prev; applyMode(); return fail(error); }
    if (!quiet) toast(m === 'daily' ? '慢观自我，欢迎你' : '回到心愈之旅，' + (S.contact.name || 'TA') + '的档案都在');
  }
  document.querySelectorAll('#topMode button').forEach(b => b.onclick = () => setMode(b.dataset.m));
  /* 慢观自我：贴纸、题目、彩带 */
  const STICKERS = ['好开心', '好好笑', '好好吃', '被宠爱', '小成就', '好运气', '好可爱', '放松'];
  const PROMPTS = ['今天吃到最好吃的东西是什么？', '今天谁让你笑出来了？', '今天有什么小事做得很好？夸夸自己！', '今天看到什么可爱的东西？', '最近有什么让你期待的事？', '今天最舒服的一刻是什么时候？', '如果给今天打分，几分？为什么？', '今天有没有一件好笑的糗事？', '今天对自己好的一件事是什么？', '最近听到最好听的一首歌是？'];
  let sticker = null, promptI = Math.floor(Math.random() * 10);
  function drawStickers() {
    $('stickers').innerHTML = '';
    STICKERS.forEach(s => { const b = document.createElement('button'); b.type = 'button'; b.className = 'sticker'; b.textContent = s; b.setAttribute('aria-pressed', s === sticker);
      b.onclick = () => { sticker = sticker === s ? null : s; drawStickers(); }; $('stickers').appendChild(b); });
  }
  drawStickers();
  $('joyPrompt').onclick = () => { promptI = (promptI + 1) % PROMPTS.length; $('momentText').placeholder = PROMPTS[promptI]; $('momentText').focus(); };
  function confetti() {
    const cs = getComputedStyle(document.documentElement), cols = [cs.getPropertyValue('--mist'), cs.getPropertyValue('--blush'), '#7FC8A9', '#F49AC1', '#8EC5FF'];
    for (let i = 0; i < 40; i++) { const s = document.createElement('span'); s.className = 'confetti'; s.style.left = Math.random() * 100 + 'vw'; s.style.background = cols[i % cols.length];
      s.style.animationDelay = Math.random() * .4 + 's'; s.style.animationDuration = 1.2 + Math.random() * .8 + 's'; document.body.appendChild(s); setTimeout(() => s.remove(), 2600); }
  }
  document.querySelectorAll('#modeSeg button').forEach(b => b.onclick = () => setMode(b.dataset.m));

  /* ================= 分享 + 告别卡片 + 回望 ================= */
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  async function share() {
    const url = C.SHARE_URL != null ? C.SHARE_URL : location.origin + location.pathname;
    const text = 'SlowHeal 慢愈：允许自己难过，也允许自己慢慢变好。送给正在难熬的你。' + (url ? '\n' + url : '');
    try { if (navigator.share) { await navigator.share({ title: 'SlowHeal 慢愈', text }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text); toast('分享文字已复制，贴给朋友就好'); }
    catch (e) { openSheet('<h2>复制下面这段，贴给朋友</h2><textarea readonly id="shareTxt">' + esc(text) + '</textarea>', () => { $('shareTxt').select(); }); }
  }
  $('byeShare').onclick = share; $('meShare').onclick = share;
  $('byeX').onclick = () => { lsSet('sh_bye_' + U.id, '1'); $('byeCard').hidden = true; };
  $('byeDaily').onclick = () => { lsSet('sh_bye_' + U.id, '1'); archiveSheet(); };
  // 只在失恋模式、近 21 天明显好转时出现；判断结果不显示给用户
  function looksRecovered() {
    const recent = [];
    for (let i = 0; i < 21; i++) { const d = NOW(); d.setDate(d.getDate() - i); const m = S.moods[dk(d)]; if (m) recent.push({ i, m }); }
    if (recent.length < 7) return false;
    const tags = r => r.m.tags || [];
    if (recent.some(r => r.i < 14 && tags(r).includes('想联系TA'))) return false;
    if (S.episodes.some(e => e.kind === 'contact' && Date.now() - +new Date(e.created_at) < 14 * 864e5)) return false;
    if (recent.filter(r => tags(r).includes('想念对方')).length > 2) return false;
    const avg = recent.reduce((a, r) => a + Number(r.m.score), 0) / recent.length;
    return avg >= 3.5;
  }
  const LOOK = [[30, '你来到慢愈已经一个月了'], [90, '你来到慢愈已经三个月了'], [180, '你来到慢愈已经半年了'], [365, '你来到慢愈已经一年了']];
  let lookAt = null;
  function renderCards() {
    $('byeCard').hidden = !(MODE() === 'heal' && !lsGet('sh_bye_' + U.id) && looksRecovered());
    const n = dayN(); lookAt = null;
    for (const [d, label] of LOOK) if (n >= d && n < d + 14 && !lsGet('sh_look_' + d + '_' + U.id)) lookAt = [d, label];
    $('lookCard').hidden = !lookAt;
    if (lookAt) $('lookLabel').textContent = lookAt[1];
  }
  $('lookGo').onclick = () => { lsSet('sh_look_' + lookAt[0] + '_' + U.id, '1'); $('lookCard').hidden = true; go('heart'); };
  $('lookX').onclick = () => { lsSet('sh_look_' + lookAt[0] + '_' + U.id, '1'); $('lookCard').hidden = true; };
  /* ================= 生活愿望清单（慢观自我） ================= */
  const WISH_IDEAS = ['一个人去看一场电影', '学会做一道拿手菜', '去一个没去过的地方', '早起看一次日出', '养一盆植物', '报名一堂想上的课', '换一个新发型', '把房间整理成喜欢的样子'];
  async function setWishDone(r, done) {
    const v = done ? '已完成' : null;
    const { error } = await sb.from('records').update({ tag: v }).eq('id', r.id);
    if (error) { fail(error); return false; }
    r.tag = v; renderWishes(); renderHeart(); return true;
  }
  function renderWishes() {
    const ul = $('wishList'); if (!ul) return; ul.innerHTML = '';
    const all = vis().filter(r => r.kind === 'wish');
    const ws = all.filter(r => r.tag !== '已完成').slice().reverse();
    const done = all.length - ws.length;
    $('wishCount').textContent = done ? '已实现 ' + done + ' 个 ✨' : '';
    if (!ws.length) ul.innerHTML = '<li class="empty">' + (done ? '清单都完成啦！实现的心愿都存在「慢观 · 记下的美好」里。再写一个新的吧。' : '写下想做的事，大的小的都可以。做到了就打勾。') + '</li>';
    ws.forEach(r => {
      const li = document.createElement('li'); li.className = 'task wish';
      li.innerHTML = '<input type="checkbox" id="w' + r.id + '"><label for="w' + r.id + '">' + esc(r.text) + '</label>';
      li.querySelector('input').onchange = async e => {
        if (!e.target.checked) return;
        li.classList.add('done', 'leaving');
        await new Promise(res => setTimeout(res, 450));
        if (!await setWishDone(r, true)) { li.classList.remove('done', 'leaving'); e.target.checked = false; return; }
        confetti();
        toastAct('✨ 心愿已完成，存入「记下的美好」', '撤销', async () => { if (await setWishDone(r, false)) toast('已恢复回愿望清单'); }, 5000);
      };
      li.appendChild(delBtn(() => deleteRecord(r))); ul.appendChild(li);
    });
    const ideas = WISH_IDEAS.filter(t => !all.some(r => r.text === t)).slice(0, 4);
    $('wishIdeas').innerHTML = ideas.map(t => '<button class="chip" type="button">' + esc(t) + '</button>').join('');
    $('wishIdeas').querySelectorAll('.chip').forEach(c => c.onclick = async () => { if (await addRecord('wish', c.textContent, null, c)) renderWishes(); });
  }
  $('wishAdd').onclick = async () => { const t = $('wishIn').value.trim(); if (!t) return $('wishIn').focus(); if (await addRecord('wish', t, null, $('wishAdd'))) { $('wishIn').value = ''; renderWishes(); } };
  $('wishIn').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); $('wishAdd').click(); } });

  /* ================= 心事 ================= */
  $('meBtn').onclick = () => go('me');
  $('meBack').onclick = () => go('today');
  const pkMoment = makePicker($('pkMoment'), 9);
  async function addRecord(kind, text, blobs, btn, extra) {
    if (!text && !(blobs && blobs.length)) return false;
    btn && (btn.disabled = true);
    try {
      const images = blobs && blobs.length ? await uploadBlobs(blobs) : [];
      const { data, error } = await sb.from('records').insert(Object.assign({ kind, text: text || null, images }, CASE_KINDS.includes(kind) ? { case_id: activeId() } : {}, extra || {})).select().single();
      if (error) { await removeFiles(images); throw error; }
      S.records.unshift(data); renderHeart(); return true;
    } catch (e) { fail(e); return false; } finally { btn && (btn.disabled = false); }
  }
  async function deleteRecord(r) {
    const { error } = await sb.from('records').delete().eq('id', r.id);
    if (error) return fail(error);
    removeFiles(r.images); S.records = S.records.filter(x => x.id !== r.id); renderHeart();
  }
  $('momentSave').onclick = async () => {
    const t = $('momentText').value.trim(), why = $('momentReason').value.trim();
    if (!t && !pkMoment.blobs.length && !why) { $('momentText').focus(); return; }
    if ((t || pkMoment.blobs.length) && !(await addRecord(MK(), t, pkMoment.blobs.slice(), $('momentSave'), MODE() === 'daily' && sticker ? { tag: sticker } : null))) return;
    if (MODE() === 'daily') { confetti(); sticker = null; drawStickers(); }
    if (MODE() !== 'daily' && why && !(await addRecord(RK(), why, null, $('momentSave')))) return;
    $('momentText').value = ''; $('momentReason').value = ''; pkMoment.reset(); toast(MODE() === 'daily' ? '又多了一件开心的事！' : why ? '保存好了，理由也加上了' : '保存好了');
  };
  $('reasonSave').onclick = async () => { const t = $('reasonText').value.trim(); if (!t) return $('reasonText').focus(); if (await addRecord(RK(), t, null, $('reasonSave'))) $('reasonText').value = ''; };
  $('wantSave').onclick = async () => { const t = $('wantText').value.trim(); if (!t) return $('wantText').focus(); if (await addRecord('want', t, null, $('wantSave'))) $('wantText').value = ''; };
  $('noSave').onclick = async () => { const t = $('noText').value.trim(); if (!t) return $('noText').focus(); if (await addRecord('no', t, null, $('noSave'))) $('noText').value = ''; };
  [['reasonText', 'reasonSave'], ['wantText', 'wantSave'], ['noText', 'noSave']].forEach(([i, b]) => $(i).addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); $(b).click(); } }));

  const byStar = arr => arr.filter(r => r.starred).concat(arr.filter(r => !r.starred));
  async function toggleStar(r) {
    const v = !r.starred; r.starred = v; renderHeart();
    const { error } = await sb.from('records').update({ starred: v }).eq('id', r.id);
    if (error) { r.starred = !v; renderHeart(); fail(error); }
  }
  $('tGoReason').onclick = () => $('reasonList').closest('.card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('tGoMoment').onclick = () => { const l = $('momentList'); (l.firstElementChild || $('momentLabel')).scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  function renderHeart() {
    if (MODE() === 'daily') { renderReplayPeriods(); if (!rpPosts && U) rpLoadPosts().then(renderReplayPeriods).catch(() => {}); }
    const dly = MODE() === 'daily';
    $('tReason').textContent = vis().filter(r => r.kind === RK()).length;
    const isDoneWish = r => dly && r.kind === 'wish' && r.tag === '已完成';
    $('tMoment').textContent = vis().filter(r => r.kind === MK() || isDoneWish(r)).length;
    $('tReasonL').textContent = dly ? '喜欢自己的地方' : '我们不合适的地方';
    $('tMomentL').textContent = dly ? '记下的美好' : (S.contact && S.contact.name && S.contact.name !== 'TA' ? S.contact.name : '他') + '伤害你的瞬间';
    if (typeof renderGoals === 'function') renderGoals();
    const ml = $('momentList'); ml.innerHTML = '';
    const moments = vis().filter(r => r.kind === MK() || isDoneWish(r)).sort((x, y) => (y.created_at || '') > (x.created_at || '') ? 1 : -1);
    if (!moments.length) ml.innerHTML = '<li class="empty">' + (MODE() === 'daily' ? '拍一张照片，记下今天让你开心的事。' : '上传一张截图，写下你当时的感受。') + '</li>';
    moments.forEach(r => { const li = document.createElement('li'); li.className = 'moment';
      li.innerHTML = '<div class="meta"><span>' + fmt(r.created_at) + '</span></div>' + (r.tag ? '<span class="stamp">' + esc(r.tag) + '</span>' : '') + imgBox(r.images, 'grid') + (r.text ? '<div class="feel' + (r.kind === 'joy' ? ' joy' : '') + '">' + esc(r.text) + '</div>' : '');
      if (isDoneWish(r)) {
        li.classList.add('wish-done');
        li.innerHTML = '<div class="meta"><span>' + fmt(r.created_at) + ' 许下</span></div><span class="stamp">✨ 心愿实现了</span><div class="feel wish-feel">' + esc(r.text) + '</div>';
        const rb = document.createElement('button'); rb.type = 'button'; rb.className = 'btn ghost sm'; rb.textContent = '恢复回愿望清单';
        rb.onclick = async () => { rb.disabled = true; if (await setWishDone(r, false)) toast('已恢复回愿望清单'); else rb.disabled = false; };
        li.appendChild(rb); ml.appendChild(li); return;
      }
      li.querySelector('.meta').appendChild(delBtn(() => deleteRecord(r))); ml.appendChild(li); });
    hydrate(ml);
    const lines = (kind, el, empty, ordered) => { el.innerHTML = ''; const arr = byStar(vis().filter(r => r.kind === kind).slice().reverse());
      if (!arr.length) { el.innerHTML = '<li class="empty"' + (ordered ? ' style="list-style:none"' : '') + '>' + empty + '</li>'; return 0; }
      arr.forEach(r => { const li = document.createElement('li'); if (!ordered) li.className = 'line'; li.innerHTML = '<span class="txt">' + esc(r.text) + '</span>';
        const st = document.createElement('button'); st.type = 'button'; st.className = 'star'; st.textContent = r.starred ? '★' : '☆'; st.setAttribute('aria-pressed', !!r.starred); st.setAttribute('aria-label', r.starred ? '取消星标' : '加星标，想找他时优先显示');
        st.onclick = () => toggleStar(r); li.appendChild(st);
        li.appendChild(delBtn(() => deleteRecord(r))); el.appendChild(li); });
      return arr.length; };
    const n = lines(RK(), $('reasonList'), MODE() === 'daily' ? '还没有写。你身上有很多值得喜欢的地方，想到一个写一个。' : '还没有写。想到一条就写一条，想找他的时候回来看看。', true);
    $('reasonList').classList.toggle('numbered', n > 0);
    $('reasonCount').textContent = n ? '已经写了 ' + n + ' 条' : '';
    lines('want', $('wantList'), '还空着。');
    lines('no', $('noList'), '还空着。');
  }

  /* ================= 发给 TA ================= */
  const STYLES = [
    ['green', '绿泡泡', '#EDEDED', '#95EC69'],
    ['paper', '信纸绿', '#EFE7DE', '#D9FDD3'],
    ['gradient', '渐变紫', '#FFFFFF', 'linear-gradient(135deg,#6D5BFF,#B44CE0 55%,#E0558E)'],
    ['sky', '蓝天', '#A7C3D6', '#E3F8D1']
  ];
  async function contactAvatarURL() {
    if (S.contact.avatar) { const m = await signed([S.contact.avatar]).catch(() => ({})); if (m[S.contact.avatar]) return m[S.contact.avatar]; }
    return avatarSVG(S.contact.name);
  }
  async function renderChatHead() {
    const c = S.contact; $('chat').dataset.style = c.style || 'green';
    $('chatName').textContent = c.name || 'TA'; $('tabName').textContent = c.name || 'TA';
    const u = await contactAvatarURL(); $('chatAva').src = u; $('tabAva').src = u;
    $('chatAva').classList.toggle('blur-ava', !!c.blur); $('tabAva').classList.toggle('blur-ava', !!c.blur);
  }
  function scrollChat() { const b = $('chatBody'); requestAnimationFrame(() => b.scrollTop = b.scrollHeight); }
  function renderLetters() {
    const body = $('chatBody'); body.innerHTML = '';
    const LV = lettersVis();
    if (!LV.length) { body.innerHTML = '<div class="chat-empty">想发给 TA 的话，写在这里。<br>它们会好好留着，但不会真的发出去。</div>'; return; }
    let lastDay = '';
    LV.forEach(l => {
      const d = new Date(l.created_at), day = dk(d);
      if (day !== lastDay) { lastDay = day; const s = document.createElement('div'); s.className = 'chat-day'; s.textContent = fmt(l.created_at).replace(/ \d\d:\d\d$/, ''); body.appendChild(s); }
      const row = document.createElement('div'); row.className = 'msgrow';
      row.innerHTML = '<div class="bubble" role="button" tabindex="0">' + (l.images && l.images.length ? imgBox(l.images) : '') + (l.text ? '<span>' + esc(l.text) + '</span>' : '') + '<time>' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + '</time></div>';
      const bub = row.querySelector('.bubble');
      bub.onkeydown = e => { if (e.key === 'Enter') bub.click(); };
      bub.onclick = () => openSheet('<h2>这条消息</h2><p class="hint">' + fmt(l.created_at) + '</p><p>想让它消失的话，就把它烧掉吧。</p><div class="row"><button class="btn blush" id="lDel" type="button">烧掉这条</button><button class="btn soft" data-close type="button">留着</button></div>', () => {
        $('lDel').onclick = async () => {
          closeSheet(); bub.classList.add('burning');
          const [{ error }] = await Promise.all([sb.from('letters').delete().eq('id', l.id), new Promise(r => setTimeout(r, 1200))]);
          if (error) { bub.classList.remove('burning'); return fail(error); }
          removeFiles(l.images); S.letters = S.letters.filter(x => x.id !== l.id); renderLetters(); toast('烧掉了');
        };
      });
      body.appendChild(row);
    });
    hydrate(body).then(scrollChat); scrollChat();
  }
  const pkChat = makePicker(null, 9, { bare: true, input: $('chatFile'), thumbs: $('chatThumbs') });
  const ci = $('chatInput');
  ci.addEventListener('input', () => { ci.style.height = 'auto'; ci.style.height = Math.min(120, ci.scrollHeight) + 'px'; });
  $('chatForm').addEventListener('submit', async e => {
    e.preventDefault();
    const t = ci.value.trim(), bl = pkChat.blobs.slice(); if (!t && !bl.length) return;
    $('chatSend').disabled = true;
    try {
      const images = bl.length ? await uploadBlobs(bl) : [];
      const { data, error } = await sb.from('letters').insert({ text: t || null, images, case_id: activeId() }).select().single();
      if (error) { await removeFiles(images); throw error; }
      const first = !lettersVis().some(l => dk(new Date(l.created_at)) === TODAY());
      S.letters.push(data); ci.value = ''; ci.style.height = ''; pkChat.reset(); renderLetters();
      if (first) toast('留在这里了，不会发出去');
    } catch (err) { fail(err); } finally { $('chatSend').disabled = false; }
  });
  async function saveAvatar(blob) {
    const c = S.contact; let cs = activeCase();
    const avatar = (await uploadBlobs([blob]))[0];
    if (!cs) { cs = await createCase(c.name || 'TA', { avatar }); if (!cs) throw new Error('case'); }
    else { const { error } = await sb.from('cases').update({ avatar }).eq('id', cs.id); if (error) throw error; if (cs.avatar && cs.avatar !== avatar) removeFiles([cs.avatar]); cs.avatar = avatar; }
    syncContact(); renderChatHead(); renderCases();
  }
  $('chatAva').style.cursor = 'pointer'; $('chatAva').title = '点一下换头像';
  $('chatAva').onclick = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = async () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      try { const blob = await compress(f, 512); if (!blob) throw new Error('img'); await saveAvatar(blob); toast('头像换好了'); }
      catch (e) { fail(e, '这张图片读取不了，换一张试试'); }
    };
    inp.click();
  };
  $('chatSet').onclick = async () => {
    const c = S.contact; let style = c.style || 'green', newAva = null;
    const cur = await contactAvatarURL();
    openSheet('<h2>聊天设置</h2>' +
      '<div class="ava-edit"><img id="setAva" src="' + cur + '" alt=""><label class="addimg"><input type="file" accept="image/*" id="setAvaFile">换头像</label></div>' +
      '<input type="text" id="setName" maxlength="30" placeholder="TA 的名字" value="' + esc(c.name || '') + '">' +
      '<label class="switch"><input type="checkbox" id="setBlur"' + (c.blur ? ' checked' : '') + '>模糊 TA 的头像（看到会难受的话）</label>' +
      '<span class="label">聊天界面风格</span><div class="style-pick" id="stylePick">' +
      STYLES.map(s => '<button type="button" data-s="' + s[0] + '" aria-pressed="' + (s[0] === style) + '"><span class="swatch" style="background:' + s[2] + '"><i style="background:' + s[3] + '"></i></span>' + s[1] + '</button>').join('') +
      '</div><button class="btn" id="setSave" type="button">保存</button>', () => {
      $('stylePick').querySelectorAll('button').forEach(b => b.onclick = () => { style = b.dataset.s; $('stylePick').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false')); });
      $('setAvaFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { newAva = await compress(f, 512); if (!newAva) throw new Error('img'); $('setAva').src = URL.createObjectURL(newAva); toast('按下面「保存」就换好了'); } catch (err) { newAva = null; fail(err, '这张图片读取不了，换一张试试'); } };
      $('setSave').onclick = async () => {
        $('setSave').disabled = true;
        try {
          let avatar = c.avatar;
          if (newAva) { avatar = (await uploadBlobs([newAva]))[0]; if (c.avatar) removeFiles([c.avatar]); }
          const row = { name: $('setName').value.trim() || 'TA', avatar, style, blur: $('setBlur').checked };
          let cs = activeCase();
          if (!cs) { cs = await createCase(row.name, row); if (!cs) throw new Error('case'); }
          else { const { error } = await sb.from('cases').update(row).eq('id', cs.id); if (error) throw error; Object.assign(cs, row); }
          syncContact(); closeSheet(); renderChatHead(); renderHeart(); renderCases();
        } catch (e) { fail(e); $('setSave').disabled = false; }
      };
    });
  };

  /* ================= 夸夸圈 ================= */
  document.querySelectorAll('#feedSeg button').forEach(b => b.onclick = () => {
    document.querySelectorAll('#feedSeg button').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
    S.feedFilter = b.dataset.f; loadFeed(true);
  });
  $('moreFeed').onclick = () => loadFeed(false);
  const PAGE = 20;
  let feedReq = 0;
  async function loadFeed(reset) {
    const my = ++feedReq;
    if (reset) { S.feedCursor = null; $('feed').innerHTML = '<li class="empty">载入中……</li>'; }
    let q = sb.from('posts').select('id,user_id,text,images,is_public,created_at,profiles(nickname),cheers(count),comments(count)').order('created_at', { ascending: false }).limit(PAGE);
    q = (PERSONAL || S.feedFilter === 'mine') ? q.eq('user_id', U.id) : q.eq('is_public', true);
    q = q.eq('circle', MODE() === 'daily' ? 'daily' : 'heal');
    if (S.feedCursor) q = q.lt('created_at', S.feedCursor);
    const { data, error } = await q;
    if (my !== feedReq) return;
    if (error) { if (reset) $('feed').innerHTML = '<li class="empty">载入失败，下拉或稍后再试</li>'; return fail(error); }
    if (reset) $('feed').innerHTML = '';
    const ids = data.map(p => p.id);
    if (ids.length) { const { data: mine } = await sb.from('cheers').select('post_id').eq('user_id', U.id).in('post_id', ids); (mine || []).forEach(x => S.myCheers.add(x.post_id)); }
    if (my !== feedReq) return;
    if (reset && !data.length) $('feed').innerHTML = '<li class="empty">' + (S.feedFilter === 'mine' ? '写下今天你很棒的地方吧。' : (MODE() === 'daily' ? '生活圈还没有人分享，来分享一件生活里的小美好吧。' : '还没有人分享。') + '做第一个夸自己的人吧。') + '</li>';
    data.forEach(p => $('feed').appendChild(postCard(p)));
    hydrate($('feed'));
    if (data.length) S.feedCursor = data[data.length - 1].created_at;
    $('moreFeed').hidden = data.length < PAGE;
  }
  const cnt = a => (a && a[0] && a[0].count) || 0;
  function postCard(p) {
    const li = document.createElement('li'); li.className = 'post';
    const nick = (p.profiles && p.profiles.nickname) || '匿名', mine = p.user_id === U.id;
    let cheers = cnt(p.cheers), comments = cnt(p.comments), cheered = S.myCheers.has(p.id);
    li.innerHTML = '<div class="who"><span class="av">' + esc(initial(nick)) + '</span><div><b>' + esc(nick) + '</b>' + (p.is_public ? '' : '<span class="private-tag">只给自己</span>') + '<small>' + fmt(p.created_at) + '</small></div><button class="more" type="button" aria-label="更多">⋯</button></div>' +
      (p.text ? '<p class="txt">' + esc(p.text) + '</p>' : '') + imgBox(p.images, 'grid') +
      '<div class="acts"><button class="act" data-a="cheer" type="button" aria-pressed="' + cheered + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/></svg><span>夸夸 ' + cheers + '</span></button>' +
      '<button class="act" data-a="cmt" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h16v11H9l-5 4z"/></svg><span>留言 ' + comments + '</span></button></div>' +
      '<div class="cmts" hidden></div>';
    const cheerBtn = li.querySelector('[data-a="cheer"]');
    cheerBtn.onclick = async () => {
      cheerBtn.disabled = true;
      const { error } = cheered ? await sb.from('cheers').delete().eq('post_id', p.id).eq('user_id', U.id) : await sb.from('cheers').insert({ post_id: p.id });
      cheerBtn.disabled = false;
      if (error && error.code !== '23505') return fail(error);
      cheered = !cheered; cheers += cheered ? 1 : -1; cheered ? S.myCheers.add(p.id) : S.myCheers.delete(p.id);
      cheerBtn.setAttribute('aria-pressed', cheered); cheerBtn.querySelector('span').textContent = '夸夸 ' + Math.max(0, cheers);
    };
    const box = li.querySelector('.cmts'), cmtBtn = li.querySelector('[data-a="cmt"]');
    const setCount = d => { comments = Math.max(0, comments + d); cmtBtn.querySelector('span').textContent = '留言 ' + comments; };
    cmtBtn.onclick = () => { box.hidden = !box.hidden; if (!box.hidden) loadComments(p, box, mine, setCount); };
    li.querySelector('.more').onclick = () => postMenu(p, mine, li);
    if (PERSONAL) { li.querySelector('.acts').remove(); li.querySelector('.cmts').remove(); const tag = li.querySelector('.private-tag'); if (tag) tag.remove(); }
    return li;
  }
  const QUICK = ['你真的很棒！', '抱抱你', '为你骄傲', '慢慢来，你做得很好', '今天的你也很勇敢', '你值得被好好对待', '一步一步来就好'];
  async function loadComments(p, box, postMine, setCount) {
    box.innerHTML = '<span class="hint">载入中……</span>';
    const { data, error } = await sb.from('comments').select('id,user_id,text,created_at,profiles(nickname)').eq('post_id', p.id).order('created_at', { ascending: true }).limit(200);
    if (error) { box.innerHTML = ''; return fail(error); }
    box.innerHTML = '';
    const list = document.createElement('div'); list.style.cssText = 'display:flex;flex-direction:column;gap:6px';
    const addRow = c => { const r = document.createElement('div'); r.className = 'cmt';
      r.innerHTML = '<span><b>' + esc((c.profiles && c.profiles.nickname) || '匿名') + '</b>：' + esc(c.text) + '</span>';
      const own = c.user_id === U.id;
      if (own || postMine) r.appendChild(delBtn(async () => { const { error } = await sb.from('comments').delete().eq('id', c.id); if (error) return fail(error); r.remove(); setCount(-1); }));
      else { const rep = document.createElement('button'); rep.className = 'del'; rep.type = 'button'; rep.textContent = '举报'; rep.onclick = () => reportSheet({ comment_id: c.id }); r.appendChild(rep); }
      list.appendChild(r); };
    (data || []).forEach(addRow);
    if (!data || !data.length) list.innerHTML = '<span class="hint">还没有留言，来夸夸 TA 吧。</span>';
    box.appendChild(list);
    const quick = document.createElement('div'); quick.className = 'quick';
    QUICK.forEach(q => { const b = document.createElement('button'); b.type = 'button'; b.textContent = q; b.onclick = () => send(q); quick.appendChild(b); });
    box.appendChild(quick);
    const form = document.createElement('form'); form.className = 'row';
    form.innerHTML = '<input type="text" maxlength="300" placeholder="写一句夸夸……" class="grow"><button class="btn soft" type="submit">发送</button>';
    form.onsubmit = e => { e.preventDefault(); send(form.querySelector('input').value.trim()); };
    box.appendChild(form);
    async function send(text) {
      if (!text) return;
      const { data: c, error } = await sb.from('comments').insert({ post_id: p.id, text }).select('id,user_id,text,created_at').single();
      if (error) return fail(error);
      c.profiles = { nickname: S.profile.nickname };
      if (list.querySelector('.hint')) list.innerHTML = '';
      addRow(c); setCount(1); form.querySelector('input').value = '';
    }
  }
  function postMenu(p, mine, li) {
    if (mine) {
      openSheet('<h2>我的日记</h2><div class="row">' +
        (PERSONAL ? '' : '<button class="btn soft" id="pVis" type="button">' + (p.is_public ? '改成只给自己' : '公开到夸夸圈') + '</button>') +
        '<button class="btn blush" id="pDel" type="button">删除这篇</button></div>', () => {
        if ($('pVis')) $('pVis').onclick = async () => { const { error } = await sb.from('posts').update({ is_public: !p.is_public }).eq('id', p.id); if (error) return fail(error); closeSheet(); toast(p.is_public ? '已改成只给自己' : '已公开'); loadFeed(true); };
        $('pDel').onclick = async () => { const { error } = await sb.from('posts').delete().eq('id', p.id); if (error) return fail(error); removeFiles(p.images); closeSheet(); li.remove(); toast('已删除'); };
      });
    } else {
      openSheet('<h2>这篇日记</h2><div class="row"><button class="btn soft" id="pRep" type="button">举报</button><button class="btn soft" id="pBlock" type="button">屏蔽这个人</button></div><p class="hint">屏蔽后，你不会再看到 TA 的日记和留言。</p>', () => {
        $('pRep').onclick = () => reportSheet({ post_id: p.id });
        $('pBlock').onclick = async () => { const { error } = await sb.from('blocks').insert({ blocked: p.user_id }); if (error && error.code !== '23505') return fail(error); closeSheet(); toast('已屏蔽'); loadFeed(true); };
      });
    }
  }
  function reportSheet(target) {
    const reasons = ['骚扰或攻击别人', '色情或暴力内容', '广告或诈骗', '让人不舒服的其他内容'];
    openSheet('<h2>举报</h2><p class="hint">选一个原因。被多人举报的内容会先自动隐藏。</p><div class="chips" id="repR">' + reasons.map(r => '<button class="chip" type="button" aria-pressed="false">' + r + '</button>').join('') + '</div><button class="btn" id="repGo" type="button" disabled>提交举报</button>', () => {
      let reason = null;
      $('repR').querySelectorAll('.chip').forEach(c => c.onclick = () => { reason = c.textContent; $('repR').querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', x === c ? 'true' : 'false')); $('repGo').disabled = false; });
      $('repGo').onclick = async () => { const { error } = await sb.from('reports').insert(Object.assign({ reason }, target)); closeSheet();
        if (error && error.code === '23505') return toast('你已经举报过了'); if (error) return fail(error); toast('收到了，谢谢你'); };
    });
  }
  $('newPost').onclick = () => {
    openSheet('<h2>夸夸日记</h2><p class="hint">这里是夸夸自己的地方。想倾诉难过的事，写进「心事」会更安全，只有你自己看得到。</p><textarea id="npText" maxlength="1000" placeholder="今天我很棒的地方是……（再小的事都算）"></textarea><div class="picker" id="npPk"></div><p class="hint">公开前看看照片里有没有别人的脸、名字或聊天记录。</p>' +
      '<label class="switch"' + (PERSONAL ? ' hidden' : '') + '><input type="checkbox" id="npPub"' + (PERSONAL ? '' : ' checked') + '>公开到夸夸圈，大家可以夸你、给你留言</label><button class="btn" id="npGo" type="button">' + (PERSONAL ? '写好了' : '发布') + '</button>', () => {
      if (PERSONAL) sh.querySelectorAll('.hint').forEach(h => h.remove());
      const pk = makePicker($('npPk'), 9);
      $('npGo').onclick = async () => {
        const t = $('npText').value.trim(); if (!t && !pk.blobs.length) return $('npText').focus();
        $('npGo').disabled = true;
        try {
          const images = pk.blobs.length ? await uploadBlobs(pk.blobs) : [];
          const { error } = await sb.from('posts').insert({ text: t || null, images, is_public: $('npPub').checked, circle: MODE() === 'daily' ? 'daily' : 'heal' });
          if (error) { await removeFiles(images); throw error; }
          closeSheet(); toast('你今天也很棒'); S.postCount++; rpPosts = null; loadFeed(true); cheer();
        } catch (e) { fail(e); $('npGo').disabled = false; }
      };
    });
  };

  /* ================= 我的 ================= */
  async function renderMe() {
    if (!S.profile) return;
    $('meName').textContent = S.profile.nickname || '你';
    if (document.activeElement !== $('nickIn')) $('nickIn').value = S.profile.nickname || '';
    const { count } = await sb.from('posts').select('id', { count: 'exact', head: true }).eq('user_id', U.id);
    S.postCount = count || 0;
    $('stats').innerHTML = [[dayN(), '陪自己的天数'], [Object.keys(S.moods).length, '情绪记录'], [S.records.length + S.letters.length, '写下的心事'], [S.postCount, '夸夸日记']].map(a => '<div class="stat"><b>' + a[0] + '</b><span>' + a[1] + '</span></div>').join('');
    const rec = series(7).map(p => p.v).filter(v => v != null), avg = rec.length ? rec.reduce((a, b) => a + b, 0) / rec.length : null;
    let rxDays = 0; for (let i = 0; i < 7; i++) { const d = NOW(); d.setDate(d.getDate() - i); const r = S.checkins[dk(d)]; if (r && r.length) rxDays++; }
    const p = Math.max(0, Math.min(100, Math.round((avg == null ? 0 : (avg - 1) / 3.5 * 65) + rxDays / 7 * 35)));
    $('progBar').style.width = p + '%'; $('progNum').textContent = p + '%';
    $('chart30').innerHTML = chart(30);
    renderInsight(); renderCaps();
  }
  $('nickSave').onclick = async () => {
    const n = $('nickIn').value.trim(); if (!n) return $('nickIn').focus();
    const { error } = await sb.from('profiles').update({ nickname: n }).eq('id', U.id); if (error) return fail(error);
    S.profile.nickname = n; renderMe(); renderToday(); toast('昵称已更新');
  };
  $('signOut').onclick = async () => { await sb.auth.signOut(); location.reload(); };
  $('delAcc').onclick = () => openSheet('<h2>删除账号</h2><p>你的心事、聊天、夸夸日记、照片和账号都会永久删除，不能恢复。</p><p class="hint">请输入「删除」两个字确认。</p><input type="text" id="delIn"><button class="btn blush" id="delGo" type="button">永久删除</button><p class="msg" id="delMsg"></p>', () => {
    $('delGo').onclick = async () => {
      if ($('delIn').value.trim() !== '删除') { $('delMsg').textContent = '请输入「删除」'; return; }
      $('delGo').disabled = true; $('delMsg').textContent = '正在删除……';
      try {
        for (let i = 0; i < 50; i++) { const { data } = await sb.storage.from(BUCKET).list(U.id, { limit: 100 }); if (!data || !data.length) break; await sb.storage.from(BUCKET).remove(data.map(f => U.id + '/' + f.name)); }
        const { error } = await sb.rpc('delete_my_account'); if (error) throw error;
        await sb.auth.signOut(); location.reload();
      } catch (e) { $('delMsg').textContent = '删除失败，请稍后再试'; $('delGo').disabled = false; console.error(e); }
    };
  });

  /* ================= 想找他之前：先看看 ================= */
  const toYou = t => String(t).replace(/我/g, '你');
  function reasonsBlock() {
    const reasons = byStar(vis().filter(r => r.kind === 'reason').slice().reverse());
    const hurts = vis().filter(r => r.kind === 'moment').length;
    return '<div class="card remind-sec"><div class="row between"><h3>我们不合适的理由</h3><span class="hint">' + (reasons.length ? reasons.length + ' 条' : '') + '</span></div>' +
      (reasons.length ? '<ol class="list numbered">' + reasons.map(r => '<li><span class="txt">' + (r.starred ? '★ ' : '') + esc(r.text) + '</span></li>').join('') + '</ol>'
        : '<p class="hint">还没写。现在就写一条吧，下次想找他就有东西看。</p>') +
      (hurts ? '<p class="hint">另外还有 ' + hurts + ' 个他伤害你的瞬间，记在「心事」里。</p>' : '') +
      '<div class="row"><input type="text" id="rmReasonIn" class="grow" maxlength="1000" placeholder="再写一条不合适的地方"><button class="btn soft" id="rmReasonAdd" type="button">加上</button></div></div>';
  }
  function futureBlock() {
    const want = byStar(vis().filter(r => r.kind === 'want').slice().reverse());
    const no = byStar(vis().filter(r => r.kind === 'no').slice().reverse());
    const people = (want.length ? want.map(r => toYou(r.text)) : ['尊重你', '愿意为你花钱', '在乎你的感受']).map(t => /的人$/.test(t) ? t : t + '的人');
    return '<div class="card future-card"><span class="label">你值得的</span>' +
      '<p class="future-big">会有' + people.map(p => '<em>' + esc(p) + '</em>').join('、') + '出现的。</p>' +
      (want.length ? '' : '<p class="hint">这是例子。写下你自己期望的样子吧。</p>') +
      (no.length ? '<p class="future-no">而且你不会再接受：' + no.map(r => esc(toYou(r.text))).join('、') + '。</p>' : '') +
      '<div class="row"><input type="text" id="rmWantIn" class="grow" maxlength="500" placeholder="我希望下一任……"><button class="btn soft" id="rmWantAdd" type="button">加上</button></div></div>';
  }
  function remindSheet(fromImpulse) {
    const coolCard = fromImpulse ? '<div class="card cool" id="cool"><span class="label">先冷静一下，再决定</span><div class="row center" id="coolPick"><button class="btn soft" data-min="1" type="button">1 分钟</button><button class="btn soft" data-min="3" type="button">3 分钟</button><button class="btn soft" data-min="5" type="button">5 分钟</button></div></div>' : '';
    const endBtns = '<div class="row"><button class="btn blush" id="rmStay" type="button">今天先不找他</button><button class="btn soft" id="rmWrite" type="button">还是想说，写在这里就好</button></div>';
    openSheet('<h2>想找' + esc(S.contact.name || 'TA') + '之前，先看看这些</h2>' + coolCard +
      '<div id="rmStep1" class="stack"><span class="step-tag">1 / 2 · 想清楚</span><div class="banner">你写下这些的时候，是清醒的。相信那时候的自己。</div><div id="rmReasons">' + reasonsBlock() + '</div>' +
      '<div class="row"><button class="btn" id="rmNext" type="button">下一个 →</button>' + (fromImpulse ? '<button class="btn ghost" id="rmBreath" type="button">先呼吸一下</button>' : '') + '</div></div>' +
      '<div id="rmStep2" class="stack" hidden><span class="step-tag">2 / 2 · 你值得更好的</span><div id="rmFuture">' + futureBlock() + '</div>' + endBtns +
      '<div class="row"><button class="btn ghost" id="rmPrev" type="button">← 上一个</button></div></div>', () => {
      const wireReason = () => { const add = async () => { const t = $('rmReasonIn').value.trim(); if (!t) return $('rmReasonIn').focus(); if (await addRecord('reason', t, null, $('rmReasonAdd'))) { $('rmReasons').innerHTML = reasonsBlock(); wireReason(); } };
        $('rmReasonAdd').onclick = add; $('rmReasonIn').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add(); } }; };
      const wireWant = () => { const add = async () => { const t = $('rmWantIn').value.trim(); if (!t) return $('rmWantIn').focus(); if (await addRecord('want', t, null, $('rmWantAdd'))) { $('rmFuture').innerHTML = futureBlock(); wireWant(); } };
        $('rmWantAdd').onclick = add; $('rmWantIn').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add(); } }; };
      wireReason(); wireWant();
      const show = n => { $('rmStep1').hidden = n !== 1; $('rmStep2').hidden = n !== 2; (n === 2 ? $('rmStep2') : sh).scrollIntoView({ behavior: 'smooth', block: 'start' }); };
      $('rmNext').onclick = () => show(2); $('rmPrev').onclick = () => show(1);
      $('rmStay').onclick = () => { closeSheet(); toast('做得很好，你在保护自己'); };
      $('rmWrite').onclick = () => { closeSheet(); go('chat'); ci.focus(); };
      if (fromImpulse) { $('rmBreath').onclick = openSOS; $('coolPick').querySelectorAll('button').forEach(b => b.onclick = () => startCool(+b.dataset.min)); }
    });
  }
  function startCool(min) {
    const lines = byStar(vis().filter(r => r.kind === 'reason' && r.text).slice().reverse()).map(r => r.text);
    if (!lines.length) lines.push('你值得一段不用猜、不用忍的关系。');
    let left = min * 60, li = 0;
    $('cool').innerHTML = '<span class="label">冷静中</span><div class="timer" id="coolT"></div><p class="quote" id="coolLine">' + esc(lines[0]) + '</p><button class="btn ghost" id="coolQuit" type="button">放弃联系，回到今日</button>';
    const draw = () => { $('coolT').textContent = pad(Math.floor(left / 60)) + ':' + pad(left % 60); };
    draw();
    $('coolQuit').onclick = () => { closeSheet(); go('today'); toast('做得很好，你在保护自己'); };
    const t = setInterval(() => {
      if (!$('coolT')) return clearInterval(t);
      left--; if (left % 6 === 0) { li = (li + 1) % lines.length; $('coolLine').textContent = lines[li]; }
      if (left <= 0) { clearInterval(t); $('cool').innerHTML = '<span class="label">时间到了</span><p class="quote">现在的你，还想联系' + esc(S.contact.name || 'TA') + '吗？</p><p class="hint">不管怎么选，都可以。看完下面的，再决定。</p>'; return; }
      draw();
    }, 1000);
    sheetTimers.push(t);
  }
  $('chatLook').onclick = () => remindSheet(false);

  /* ================= 结束本阶段疗愈：归档 ================= */
  $('chatEnd').onclick = () => archiveSheet();

  /* ================= 冲动拦截 + 急救 ================= */
  function openImpulse() { remindSheet(true); }
  const ENCOURAGE_HEAL = ["现在痛是很正常的，不必逼自己马上好起来。", "这段经历的错，不全在你身上，请不要反复审判自己。", "允许自己怀念、允许自己难过，悲伤不需要被羞耻。", "就算反反复复情绪反扑，也不代表之前的努力全部作废。", "你已经很勇敢了，撑到现在真的辛苦你了。", "想他不代表你还要回去，只是你真的认真爱过。", "你会想念，是因为你付出过真心，这不丢脸。", "今天哭了也没关系，眼泪是心在慢慢排毒。", "放不下是正常的，放下本来就需要时间。", "你不需要马上想明白为什么，先照顾好自己。", "分开不代表你不值得被爱。", "一段关系结束了，你的价值没有一起结束。", "你没有失败，你只是在一段不合适的关系里努力过。", "不要因为一个人的离开，就否定整个自己。", "你已经尽力了，剩下的不是你能决定的。", "他怎么对你，说明的是他，不是你。", "你值得一个不会让你这么难过的人。", "难受的时候，就让自己难受一下，不用假装没事。", "今天没有联系他，你已经很了不起。", "就算今天联系了他，也不要因此讨厌自己。", "回头看是人之常情，你不用为此自责。", "你会好起来的，不是因为忘了他，而是因为你变得更爱自己。", "愈合不是一条直线，有起有落都很正常。", "今天比昨天难过，不代表你在倒退。", "你已经在路上了，只是走得慢一点。", "心碎不是你的错，认真去爱本来就可能会受伤。", "你曾经那么用心地爱过，这份能力还在你身上。", "你不需要他的道歉，也可以慢慢放下。", "你不需要一个答案，也可以重新开始。", "委屈的时候，记得你有权利生气。", "他说过伤你的话，不代表你就是那样的人。", "这么难的日子你都撑过来了，你比自己想象的强大。", "半夜睡不着很正常，明天会比今晚好一点点。", "你给出去的爱是真的，你也值得收到真的爱。", "你不是太敏感，你是真的被伤到了。", "被冷落、被忽视的感觉很痛，你的痛是合理的。", "不必急着原谅谁，先好好心疼自己。", "今天只要好好吃一顿饭，就已经很好了。", "你不需要向任何人证明你已经走出来了。", "怀念那些美好也没关系，但不要忘了你为什么离开。", "你记得的甜，是真的；你受的苦，也是真的。", "你的大脑会美化过去，别让它骗你回去受苦。", "想联系他的时候，先抱一抱自己。", "你可以想他，也可以选择不回去。", "放下一个人，不等于放弃那段时光里的自己。", "你在这段关系里学到的，会带你去更好的地方。", "你没有浪费时间，你只是更了解自己了。", "难过是爱过的证明，不是软弱的证明。", "不要拿他的标准来评价自己。", "你不需要变成别人喜欢的样子，你本来就很好。", "被辜负不是因为你不够好，是对方没有珍惜。", "你没有做错什么，只是你们走到了不同的路口。", "一个人的离开，会给更合适的人腾出位置。", "你的心现在很累，就让它先休息。", "允许自己今天什么都不做，只是慢慢呼吸。", "今天的崩溃，不会抹掉你之前的坚强。", "情绪来的时候，就让它来，它也会走的。", "不用跟谁比谁走出来得快，你有你的节奏。", "你不是一个人在经历这些，很多人都走过来了。", "你这么难过，说明你是一个很真诚的人。", "你会再次心动的，那时你会感谢今天的坚持。", "他不是你人生的全部，只是其中一章。", "你值得一个回你讯息、在乎你感受的人。", "你不需要再猜，也不需要再等了。", "别再为不珍惜你的人失眠了，你值得好好睡一觉。", "你的眼泪很珍贵，留给值得的人。", "你已经看清了，这本身就是很大的进步。", "痛会变轻的，就像伤口会结痂一样。", "现在觉得过不去，是因为你还在最难的那一段，会过去的。", "慢慢来，没有人规定你几天要好起来。", "你可以一边难过，一边继续好好生活。", "今天又想起他了吗？没关系，想完了就把注意力还给自己。", "你曾经那么用力地爱一个人，现在请同样用力地爱自己。", "你会遇到一个让你不用那么累的人。", "心碎会让你更懂得怎么保护自己。", "这不是被丢下，是你终于可以把自己找回来了。", "不要因为害怕孤单，回到让你受伤的地方。", "一个人也可以过得很好，你正在学会。", "你的未来里，没有他也会很精彩。", "不必删掉回忆，只要不再住在回忆里。", "你今天能打开这里，说明你还在努力，这已经很好了。", "你不是在倒退，你只是需要多一点时间。", "就算很想他，你也做得很好，因为你没有放弃自己。", "他错过的是你，不是你错过了他。", "你值得被坚定地选择，而不是被犹豫地对待。", "你已经给过机会了，现在该给自己机会了。", "别害怕从头开始，你已经不是从零开始了。", "伤心的时候，记得你身边还有爱你的人。", "今天先不要做任何决定，等心平静一点再说。", "你没有输，你只是及时离开了不对的人。", "会痛，是因为你在长出新的自己。", "请相信，时间会站在你这边。", "你值得被宠着，而不是被冷着。", "你不需要一直坚强，偶尔脆弱也是被允许的。", "放过他，也放过那个一直自责的自己。", "你在慢慢变好，即使你现在还感觉不到。", "某一天你会发现，想起他已经不痛了。", "今天辛苦了，你已经很棒了。", "抱抱你，这一关你一定过得去。", "你已经走了这么远，再往前一步就好。"];
  const ENCOURAGE = ["你比你想象的更勇敢，也更坚强。", "难过的时候还愿意照顾自己，你真的很了不起。", "这一关很难，但你已经撑过很多次了，这次也可以。", "你值得被好好爱，首先是被你自己。", "今天的眼泪，会变成明天的力气。", "慢一点没关系，你一直在往前走。", "你不需要完美，你已经足够好。", "你走过的每一步都算数，没有一步是白费的。", "抬头看看，你已经离最难的时候很远了。", "你有能力让自己的日子重新亮起来。", "相信自己，你一定会越来越好。", "风雨会停，你也会重新笑起来。", "你身上的温柔和善良，是任何人都拿不走的。", "把今天过好，就是最厉害的事。", "你值得所有美好的事情发生。", "再坚持一下，好事正在来的路上。", "你已经做得很好了，给自己一个拥抱吧。", "你的感受很重要，你这个人也很重要。", "会好的，而且会比你想的更好。", "你不是一个人，你还有你自己。", "每一个熬过来的夜晚，都让你更强大。", "你正在成为更好的自己，别停下来。", "允许自己休息，但不要放弃自己。", "你配得上一个温柔又明亮的未来。", "今天的你，已经比昨天勇敢一点了。", "你笑起来的样子，值得每天出现。", "把爱留一点给自己，你最值得。", "你的人生还有好多好多精彩的章节。", "你可以的，一直都可以。", "你很棒，真的很棒。", "能走到今天，你已经赢了很多次。", "你的价值，从来不需要别人来证明。", "别人怎么对你，不代表你值多少。", "你值得一个会珍惜你的人，包括你自己。", "你已经很努力了，这份努力会被看见的。", "再小的进步，也是进步。", "今天不想努力也没关系，明天的你会接上。", "你是自己人生的主角，不是谁的配角。", "你的心很柔软，这是你的力量，不是弱点。", "把注意力放回自己身上，你会发现很多美好。", "你会遇到懂你、珍惜你的人。", "这一段只是人生的一页，不是全部。", "你会感谢现在没有放弃的自己。", "好好吃饭，好好睡觉，你就在变好。", "你已经比你以为的走得更远了。", "你值得被温柔对待，从今天开始。", "你的光，不会因为一个人离开就熄灭。", "真正爱你的人，不会让你一直哭。", "你不欠任何人一个完美的自己。", "你可以重新开始，任何时候都可以。", "今天的你，也在努力生活，很了不起。", "你有很多值得骄傲的地方，别忘了。", "会有人为了你的笑容而心动的。", "你的未来，会感谢今天坚持的你。", "一步一步来，你会走到想去的地方。", "你比任何一段关系都重要。", "难过是暂时的，你的好是长久的。", "你已经在慢慢好起来了，真的。", "你有权利快乐，也有能力快乐。", "别急，好的东西都在路上。", "你值得拥有一段让你安心的关系。", "你很勇敢，因为你还愿意相信美好。", "今天也请为自己骄傲一下。", "给自己一点时间，伤口会慢慢愈合。", "你的坚强，连你自己都没发现。", "你不是不够好，只是遇到了不合适的人。", "相信时间，也相信你自己。", "你已经撑过了最难的部分。", "你值得被坚定地选择。", "从今天起，把自己放在第一位。", "你会越来越喜欢现在的自己。", "你身上有一种光，总会被对的人看见。", "你有资格过得很好很好。", "世界很大，还有很多美好等着你。", "你已经学会了保护自己，这很了不起。", "你的善良，终会被温柔以待。", "别怀疑自己，你一直都很好。", "你在变得更清醒、更强大。", "每一个今天，都是重新出发的机会。", "你值得一个不用猜、不用忍的未来。", "抱抱自己，你辛苦了，你做得很好。", "就算慢，你也一直在前进。", "你的心会再次变得轻盈。", "你值得被捧在手心里。", "你会重新爱上生活，也会被生活爱着。", "你本来就很好，不需要谁来证明。", "今天也辛苦了，明天会更好一点。", "你的努力，你自己知道就很珍贵。", "好好爱自己，是一辈子最浪漫的事。", "你会发光的，一直都会。", "你有选择幸福的权利。", "勇敢地往前走，你身后有更强大的自己。", "今天的你，值得一朵小红花。", "你可以哭，但别忘了你也很坚强。", "未来的你，正在向现在的你招手。", "你会遇见更好的风景，也会成为更好的人。", "你已经很好了，接下来会更好。", "你比想象中更值得被爱。", "每天进步一点点，就是了不起的事。", "记住，你是被宇宙偏爱的那一个。"];
  const COMFORT_DAILY = ['累了就休息一下，你已经做得很好了。', '深呼吸，慢慢来，不用急。', '此刻什么都不用做，陪陪自己就好。', '你比你以为的更有力量。'];
  const comfort = () => MODE() === 'daily' ? COMFORT_DAILY : COMFORT;
  const COMFORT = ['你现在很痛，这是真的。但这个感觉会过去。', '你不用马上想通，只要先呼吸。', '你已经撑过很多个难熬的晚上了，今晚也可以。', '此刻不需要做任何决定。'];
  function milestonesHTML() {
    const days = dayN(), daysOf = ts => Math.max(0, Math.floor((Date.now() - +new Date(ts)) / 864e5));
    const ms = [];
    const care = Object.values(S.checkins).filter(x => x && x.length).length;
    let best = 0, run = 0; for (let i = 400; i >= 0; i--) { const d = NOW(); d.setDate(d.getDate() - i); const r = S.checkins[dk(d)]; if (r && r.length) { run++; best = Math.max(best, run); } else run = 0; }
    const lastContact = S.episodes.find(e => e.kind === 'contact' && (e.case_id || null) === activeId());
    const ac = activeCase(); const noContact = lastContact ? daysOf(lastContact.created_at) : (ac ? daysOf(ac.started_at || ac.created_at) : days - 1);
    const done = (S.cases || []).filter(c => c.status === 'archived');
    const cnt = k => vis().filter(r => r.kind === k).length;
    const doneGoals = vis().filter(r => r.kind === 'goal' && r.tag === '已达成');
    const p0 = weekCount('peek', 0), p1 = weekCount('peek', 1);
    const heal = MODE() !== 'daily';
    if (heal && done.length) ms.push(['走完了 ' + done.length + ' 段旅程', '每一段，你都好好地走过来了。']);
    if (heal && noContact >= 1) ms.push(['没有联系 TA', '已经 ' + noContact + ' 天了。这是你一天一天守住的。']);
    if (heal && p1 > p0) ms.push(['想看 TA 动态变少了', '这 7 天 ' + p0 + ' 次，之前 7 天 ' + p1 + ' 次。']);
    if (doneGoals.length) ms.push(['完成了 ' + doneGoals.length + ' 个目标', doneGoals.slice(0, 3).map(r => r.text).join('、')]);
    if (care) ms.push(['照顾了自己 ' + care + ' 天', best > 1 ? '最长连续 ' + best + ' 天。' : '每一天都算数。']);
    if (Object.keys(S.moods).length) ms.push(['记录了 ' + Object.keys(S.moods).length + ' 次心情', '你愿意看见自己的感受，这很不容易。']);
    if (cnt('joy')) ms.push(['记下了 ' + cnt('joy') + ' 件开心的事', '原来日子里还是有很多好事。']);
    if (cnt('selflove')) ms.push(['找到 ' + cnt('selflove') + ' 个喜欢自己的地方', '你身上有很多值得喜欢的地方。']);
    if (cnt('wish')) { const wd = vis().filter(r => r.kind === 'wish' && r.tag === '已完成').length; if (wd) ms.push(['完成了 ' + wd + ' 个生活愿望', '想做的事，你真的去做了。']); }
    if (heal && cnt('reason')) ms.push(['看清了 ' + cnt('reason') + ' 个不合适的地方', '你没有选择性失忆，你很清醒。']);
    if (S.capsules.length) ms.push(['写了 ' + S.capsules.length + ' 封给未来的信', '你相信以后的自己会更好。']);
    if (S.postCount) ms.push(['写了 ' + S.postCount + ' 篇夸夸日记', '你学会了夸自己。']);
    return '<div class="card ms-card"><span class="label">你其实很棒</span>' +
      '<p class="ms-hero">你已经陪自己走了<br><b>' + days + '</b> 天</p>' +
      (ms.length ? '<ol class="ms">' + ms.map(m => '<li><span class="ms-dot" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span><div><b>' + esc(m[0]) + '</b><small>' + esc(m[1]) + (m[2] ? ' · ' + m[2] : '') + '</small></div></li>').join('') + '</ol>' : '<p>今天打开这里，就是第一个里程碑。</p>') +
      '<p class="ms-foot">这些都是你自己一步一步走出来的里程碑。<br>再坚持一下，你已经走了这么远了。</p></div>';
  }
  function openSOS() {
    let ci2 = 0;
    const daily = MODE() === 'daily';
    openSheet('<h2>' + (daily ? '抱抱你' : '情绪急救') + '</h2><p class="quote" id="cLine">' + comfort()[0] + '</p>' + milestonesHTML() +
      '<div class="card center"><div class="orb-wrap"><div class="orb" id="orb"></div></div><p class="quote" id="oText">跟着圆圈呼吸</p><p class="hint" id="oCount">吸气 4 秒 · 停 4 秒 · 呼气 6 秒</p>' +
      '<div class="row center"><button class="btn soft" id="b1" type="button" aria-pressed="false">1 分钟</button><button class="btn soft" id="b5" type="button" aria-pressed="false">5 分钟</button></div>' +
      '<label class="switch" style="align-self:center"><input type="checkbox" id="sMusic"' + (lsGet('sh_music2') === '0' ? '' : ' checked') + '>配音乐</label></div>' +
      (daily ? '' : '<div class="card"><span class="label">快速冷静 · 做一件就好</span><ul class="list tight">' + ['洗个热水澡，或用冷水洗把脸', '出门走 10 分钟', '戴上耳机听三首歌', '想哭就哭出来', '喝一大杯温水', '把手机放到另一个房间'].map((t, i) => '<li class="task"><input type="checkbox" id="sc' + i + '"><label for="sc' + i + '">' + t + '</label></li>').join('') + '</ul></div>') +
      '<div class="card ground" id="ground"><span class="label">5-4-3-2-1 五感练习</span><p>把注意力带回此时此地。</p><div class="row"><button class="btn soft" id="gStart" type="button">开始</button></div></div>' +
      '<div class="card"><div class="row"><button class="btn soft" id="draw" type="button">' + (daily ? '抽一句鼓励的话' : '抽一句给你的话') + '</button></div><p class="txt quote" id="drawOut"></p></div>' +
      '<p class="hint center disclaimer">慢愈不能代替心理咨询或医生。撑不住的时候，请找身边信任的人或专业人员。</p>', () => {
      const G = [[5, '说出你看到的 5 样东西'], [4, '摸一摸身边的 4 样东西，感受它们的触感'], [3, '听一听，说出 3 种声音'], [2, '闻一闻，找出 2 种气味'], [1, '感受嘴里的 1 种味道，或喝一口水']];
      let gi = -1;
      const gStep = () => { gi++; if (gi >= G.length) { $('ground').innerHTML = '<span class="label">5-4-3-2-1 五感练习</span><p class="quote">很好，你回到这里了。</p>'; return; }
        $('ground').innerHTML = '<span class="label">5-4-3-2-1 五感练习</span><div class="n">' + G[gi][0] + '</div><p>' + G[gi][1] + '</p><div class="row"><button class="btn soft" id="gNext" type="button">' + (gi === G.length - 1 ? '完成' : '下一步') + '</button></div>';
        $('gNext').onclick = gStep; };
      $('gStart').onclick = gStep;
      sheetTimers.push(setInterval(() => { const C2 = comfort(); ci2 = (ci2 + 1) % C2.length; const el = $('cLine'); if (el) el.textContent = C2[ci2]; }, 8000));
      const steps = [['慢慢吸气', 4, 1.9], ['停一下', 4, 1.9], ['慢慢呼气', 6, 1]];
      let bt = null;
      let curTotal = 0, startedAt = 0;
      $('sMusic').onchange = e => { lsSet('sh_music2', e.target.checked ? '1' : '0');
        if (!e.target.checked) Music.stop(); else if (curTotal) { const left = curTotal - Math.floor((Date.now() - startedAt) / 1000); if (left > 3) Music.play(left, { breath: true }); } };
      const mmss = n => Math.floor(n / 60) + ':' + pad(n % 60);
      const run = total => { clearInterval(bt); let si = 0, left = 4; const orb = $('orb');
        [['b1', 60], ['b5', 300]].forEach(([id, n]) => { const on = n === total; $(id).className = 'btn' + (on ? '' : ' soft'); $(id).setAttribute('aria-pressed', on); $(id).textContent = (n === 60 ? '1 分钟' : '5 分钟') + (on ? ' · 进行中' : ''); }); curTotal = total; startedAt = Date.now(); if ($('sMusic').checked && !Music.play(total, { breath: true })) toast('这台手机放不了音乐');
        const ap = () => { $('oText').textContent = steps[si][0]; orb.style.transitionDuration = steps[si][1] + 's'; orb.style.transform = 'scale(' + steps[si][2] + ')'; }; ap();
        $('oCount').textContent = '还剩 ' + mmss(total);
        bt = setInterval(() => { if (!$('orb')) return clearInterval(bt); total--; left--;
          if (total <= 0) { clearInterval(bt); orb.style.transform = 'scale(1)'; $('oText').textContent = '很好，你的心慢下来了。'; $('oCount').textContent = ''; ['b1', 'b5'].forEach(id => { $(id).className = 'btn soft'; $(id).setAttribute('aria-pressed', 'false'); $(id).textContent = id === 'b1' ? '1 分钟' : '5 分钟'; }); return; }
          if (left <= 0) { si = (si + 1) % 3; left = steps[si][1]; ap(); } $('oCount').textContent = '还剩 ' + mmss(total); }, 1000);
        sheetTimers.push(bt); };
      $('b1').onclick = () => run(60); $('b5').onclick = () => run(300);
      let lastDraw = '';
      $('draw').onclick = () => {
        const P = MODE() === 'daily' ? ENCOURAGE : ENCOURAGE_HEAL;
        let t; do { t = P[Math.floor(Math.random() * P.length)]; } while (t === lastDraw);
        lastDraw = t; $('drawOut').textContent = t;
      };
    });
  }

  /* ================= 猫伴 ================= */
  const CAT_SAD = ['咕噜噜…我在这里陪着你。', '不用硬撑，难过可以留下来。', '摸摸头，你的眼泪我接住啦。', '慢慢来，不用急着好起来。', '你已经很努力了，休息一下吧。', '心里沉甸甸的话，可以讲给我听。'];
  const CAT_CALM = ['咕噜噜～你今天有在好好照顾自己。', '风慢慢变柔和啦，一切都会松弛下来。', '真好，看见你慢慢平静下来。', '继续保持这份温柔，给自己。', '你正在一点点复原哦。', '安心，你值得被好好对待。'];
  const CAT_ANY = ['摸摸小猫，喘口气。', '不用回答，静静待一会儿就好。', '我会安静陪着你。'];
  const CAT_REPLY = ['我听见啦，你可以尽情说。', '辛苦你了，愿意把心事讲出来。', '把心事留在这，不用独自扛着。', '我认真听着呢。', '说出来，会轻松一点点。'];
  const Purr = (() => {
    let ctx, g, src, lfo, on = false;
    function start(vol) {
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
        if (!on) {
          on = true;
          const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
          let last = 0; for (let i = 0; i < len; i++) { last = (last + 0.04 * (Math.random() * 2 - 1)) / 1.04; d[i] = last * 3.5; }
          src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
          const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 650; const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90; const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 320; pk.Q.value = 1.2; pk.gain.value = 9;
          const amp = ctx.createGain(); amp.gain.value = 0.55;
          lfo = ctx.createOscillator(); lfo.frequency.value = 25; const lg = ctx.createGain(); lg.gain.value = 0.5; lfo.connect(lg); lg.connect(amp.gain);
          g = ctx.createGain(); g.gain.value = 0;
          const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -20; comp.ratio.value = 4;
          src.connect(hp); hp.connect(lp); lp.connect(pk); pk.connect(amp); amp.connect(g); g.connect(comp); comp.connect(ctx.destination);
          src.start(); lfo.start();
        }
        g.gain.cancelScheduledValues(ctx.currentTime); g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
        g.gain.linearRampToValueAtTime(vol, ctx.currentTime + 1.2);
      } catch (e) { on = false; }
    }
    function stop() {
      if (!on || !ctx) return; on = false;
      const gg = g, ss = src, ll = lfo;
      gg.gain.cancelScheduledValues(ctx.currentTime); gg.gain.setValueAtTime(gg.gain.value, ctx.currentTime); gg.gain.linearRampToValueAtTime(0, ctx.currentTime + 1);
      setTimeout(() => { try { ss.stop(); ll.stop(); } catch (e) {} }, 1200);
    }
    return { soft: () => start(0.12), loud: () => start(0.36), stop };
  })();
  function catMood() {
    let tags = [...sel];
    if (!tags.length) { const m = S.moods[TODAY()]; if (m) { const es = moodEntries(m, TODAY()); const last = es.length ? es[es.length - 1] : null; tags = (last && last.tags && last.tags.length) ? last.tags : (m.tags || []); } }
    if (!tags.length) return 'none';
    const sc = tags.reduce((a, t) => a + scoreOf(t), 0) / tags.length;
    return sc < 3 ? 'sad' : sc >= 3.5 ? 'calm' : 'none';
  }

  let catSayT = 0, catLast = '', catStopT = 0, catBlinkT = 0;
  function catLine() {
    const md = catMood(), pool = (md === 'sad' ? CAT_SAD : md === 'calm' ? CAT_CALM : []).concat(CAT_ANY);
    let t; do { t = pool[Math.floor(Math.random() * pool.length)]; } while (t === catLast && pool.length > 1);
    return (catLast = t);
  }
  function catSay() {
    const now = Date.now(); if (now - catSayT < 4200) return; catSayT = now;
    const el = $('catSay'); el.textContent = catLine(); el.classList.add('on');
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 2800);
  }
  function catBlink() { const st = $('catStage'); st.classList.add('blink'); clearTimeout(catBlinkT); catBlinkT = setTimeout(() => st.classList.remove('blink'), 260); }
  function openCat() {
    const st = $('catStage'), md = catMood();
    st.className = 'cat-stage' + (md === 'sad' ? ' sad' : md === 'calm' ? ' calm' : '');
    $('catHint').style.opacity = 1; $('catSay').classList.remove('on'); $('catFloats').innerHTML = '';
    $('catView').hidden = false; document.body.style.overflow = 'hidden';
    if (md === 'sad') { st.classList.remove('sad'); void st.offsetWidth; setTimeout(() => st.classList.add('sad'), 350); }
  }
  function closeCat() { Purr.stop(); $('catView').hidden = true; document.body.style.overflow = ''; }
  (() => {
    const st = $('catStage'), head = $('catHead'), svg = $('catSvg');
    let petting = false;
    const lean = e => {
      const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.33, y = (e.clientY - r.top) / r.height - 0.5;
      head.style.transform = 'translate(' + Math.max(-10, Math.min(10, x * 30)) + 'px,' + Math.max(-8, Math.min(6, y * 16)) + 'px) rotate(' + Math.max(-10, Math.min(10, x * 22)) + 'deg)';
    };
    const down = e => { petting = true; clearTimeout(catStopT); st.classList.add('pet'); $('catHint').style.opacity = 0; Purr.loud(); lean(e); setTimeout(catSay, 900); };
    const move = e => { if (!petting) return; lean(e); if (Date.now() - catSayT > 4200) setTimeout(catSay, 600); };
    const up = () => { if (!petting) return; petting = false; catStopT = setTimeout(() => { st.classList.remove('pet'); head.style.transform = ''; Purr.stop(); }, 900); };
    svg.addEventListener('pointerdown', e => { try { svg.setPointerCapture(e.pointerId); } catch (x) {} down(e); });
    svg.addEventListener('pointermove', move);
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => svg.addEventListener(t, up));
  })();
  $('catSend').onclick = () => {
    const t = $('catIn').value.trim(); if (!t) return $('catIn').focus();
    const b = document.createElement('div'); b.className = 'cat-bubble'; b.textContent = t;
    $('catFloats').appendChild(b); setTimeout(() => b.remove(), 5200);
    $('catIn').value = ''; setTimeout(catBlink, 800);
    setTimeout(() => { const r = document.createElement('div'); r.className = 'cat-bubble reply'; r.textContent = CAT_REPLY[Math.floor(Math.random() * CAT_REPLY.length)]; $('catFloats').appendChild(r); setTimeout(() => r.remove(), 5700); }, 1400);
  };

  $('catIn').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); $('catSend').click(); } });
  $('catBtn').onclick = openCat;
  $('catBack').onclick = () => { closeCat(); go('today'); };
  $('sosBtn').onclick = openSOS;
  let lastCheer = '';
  function cheer() {
    const P = MODE() === 'daily' ? ENCOURAGE : ENCOURAGE_HEAL;
    let t; do { t = P[Math.floor(Math.random() * P.length)]; } while (t === lastCheer && P.length > 1);
    lastCheer = t; const el = $('cheerTxt'); el.classList.remove('pop'); void el.offsetWidth; el.textContent = t; el.classList.add('pop');
    $('cheerLbl').textContent = MODE() === 'daily' ? '今天也给你一句鼓励' : '给你打打气';
  }
  $('cheerBtn').onclick = cheer;

  /* ================= 冲动登记 + 情绪反扑日志 ================= */
  async function logEpisode(kind, extra) {
    const row = Object.assign({ kind }, (kind === 'peek' || kind === 'contact') ? { case_id: activeId() } : {}, extra || {});
    const { data, error } = await sb.from('episodes').insert(row).select().single();
    if (error) { console.error(error); return null; }
    S.episodes.unshift(data); renderUrge(); return data;
  }
  function weekCount(kind, weeksAgo) {
    const end = Date.now() - weeksAgo * 7 * 864e5, start = end - 7 * 864e5;
    return S.episodes.filter(e => e.kind === kind && ((kind !== 'peek' && kind !== 'contact') || (e.case_id || null) === activeId()) && +new Date(e.created_at) > start && +new Date(e.created_at) <= end).length;
  }
  function renderUrge() {
    const n = weekCount('peek', 0), k = weekCount('contact', 0), parts = [];
    if (n) parts.push('想看 ' + n + ' 次'); if (k) parts.push('想联系 ' + k + ' 次');
    $('urgeWeek').textContent = MODE() === 'heal' && parts.length ? '这 7 天' + parts.join(' · ') : '';
  }
  $('peekBtn').onclick = () => { logEpisode('peek'); remindSheet(true); };
  $('contactBtn').onclick = () => { logEpisode('contact'); remindSheet(true); };
  const TRIGGERS = ['深夜睡不着', '看到 TA 的动态', '看到以前的照片', '一个人的时候', '听到某首歌', '被别人问起', '喝了酒', '其他'];
  $('relapseBtn').onclick = () => {
    let level = null; const trig = new Set();
    openSheet('<h2>' + (MODE() === 'daily' ? '记一次情绪崩溃' : '记一次情绪反扑') + '</h2><p class="hint">难受又涌上来，很正常。记下来，慢慢会看到自己的规律。只有你自己看得到。</p>' +
      '<span class="label">现在有多难受（1 = 一点点，10 = 快撑不住）</span><div class="scale" id="rLevel">' + Array.from({ length: 10 }, (_, i) => '<button type="button" aria-pressed="false">' + (i + 1) + '</button>').join('') + '</div>' +
      '<span class="label">是什么让你难受？（可以多选）</span><div class="chips" id="rTrig">' + TRIGGERS.map(t => '<button class="chip" type="button" aria-pressed="false">' + t + '</button>').join('') + '</div>' +
      '<textarea id="rThought" maxlength="1000" class="short" placeholder="脑子里在想什么？写一句就好（选填）"></textarea>' +
      '<div class="row"><button class="btn" id="rSave" type="button">记下来</button></div>', () => {
      $('rLevel').querySelectorAll('button').forEach((b, i) => b.onclick = () => { level = i + 1; $('rLevel').querySelectorAll('button').forEach((x, j) => x.setAttribute('aria-pressed', j === i ? 'true' : 'false')); });
      $('rTrig').querySelectorAll('.chip').forEach(c => c.onclick = () => { const t = c.textContent; trig.has(t) ? trig.delete(t) : trig.add(t); c.setAttribute('aria-pressed', trig.has(t)); });
      $('rSave').onclick = async () => {
        if (!level) return toast('先选一下有多难受');
        $('rSave').disabled = true;
        const ok = await logEpisode('relapse', { intensity: level, trigger: [...trig].join('、') || null, thought: $('rThought').value.trim() || null });
        if (!ok) { $('rSave').disabled = false; return fail(null); }
        if (level >= 7) openSheet('<h2>记下了</h2><p class="quote">现在真的很难受，对吗？先照顾好此刻的自己。</p><div class="row"><button class="btn blush" id="rSos" type="button">打开急救</button><button class="btn soft" data-close type="button">我还好</button></div>', () => { $('rSos').onclick = openSOS; });
        else { closeSheet(); toast('记下了。这一阵会过去的。'); }
      };
    });
  };
  function renderInsight() {
    if (MODE() === 'daily') {
      const since = Date.now() - 30 * 864e5, joys = vis().filter(r => r.kind === 'joy' && +new Date(r.created_at) > since).length;
      const tally = {}; Object.values(S.moods).forEach(m => { if (Date.now() - +new Date(m.day) < 30 * 864e5) (m.tags || []).forEach(t => { if (MOODS_DAILY.some(x => x[0] === t)) tally[t] = (tally[t] || 0) + 1; }); });
      const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
      $('insight').textContent = (joys ? '这 30 天你记下了 ' + joys + ' 件开心的事。' : '开始记下开心的事吧，这里会帮你数着。') + (top ? '\n最常出现的心情是「' + top[0] + '」。' : '') + '\n' + QUOTES_DAILY[new Date().getDate() % QUOTES_DAILY.length];
      $('insight').style.whiteSpace = 'pre-line'; return;
    }
    const all = S.episodes, peek0 = weekCount('peek', 0), peek1 = weekCount('peek', 1);
    const out = [];
    if (MODE() === 'heal' && (peek0 || peek1)) out.push('这 7 天想看 TA 动态 ' + peek0 + ' 次，之前 7 天 ' + peek1 + ' 次。' + (peek0 < peek1 ? '在变少了。' : ''));
    if (all.length < 5) out.push('难受的时候多记几次，这里会慢慢告诉你，你比较容易在什么时候难受。');
    else {
      const B = [['深夜（0–5 点）', h => h < 6], ['早上', h => h >= 6 && h < 12], ['下午', h => h >= 12 && h < 18], ['晚上', h => h >= 18]];
      const cnt = B.map(([n, f]) => [n, all.filter(e => f(new Date(e.created_at).getHours())).length]).sort((a, b) => b[1] - a[1]);
      const we = all.filter(e => [0, 6].includes(new Date(e.created_at).getDay())).length, wd = all.length - we;
      out.push('你比较容易在' + cnt[0][0] + '难受。' + (we / 2 > wd / 5 ? '周末比平日多一些。' : ''));
      const rel = all.filter(e => e.kind === 'relapse' && e.trigger);
      if (rel.length >= 3) { const m = {}; rel.forEach(e => e.trigger.split('、').forEach(t => m[t] = (m[t] || 0) + 1)); const top = Object.entries(m).sort((a, b) => b[1] - a[1])[0]; out.push('最常让你难受的是「' + top[0] + '」。'); }
      out.push('这些时候可以提前准备：早点睡、约个朋友、把手机放远一点。');
    }
    $('insight').textContent = out.join('\n');
    $('insight').style.whiteSpace = 'pre-line';
  }

  /* ================= 时间胶囊 ================= */
  const capOpen = c => +new Date(c.unlock_at) <= Date.now();
  const ymd = ts => { const d = new Date(ts); return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日'; };
  const ymdhm = ts => { const d = new Date(ts); return ymd(ts) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  function untilText(ts) {
    let s = Math.max(0, Math.round((+new Date(ts) - Date.now()) / 1000));
    if (s < 60) return '还有 ' + s + ' 秒';
    if (s < 3600) return '还有 ' + Math.floor(s / 60) + ' 分 ' + pad(s % 60) + ' 秒';
    if (s < 86400) return '还有 ' + Math.floor(s / 3600) + ' 小时 ' + Math.floor(s % 3600 / 60) + ' 分';
    return ymdhm(ts) + ' 才能打开';
  }
  function renderCaps() {
    const ul = $('capList'); ul.innerHTML = '';
    if (!S.capsules.length) { ul.innerHTML = '<li class="empty">还没有时间胶囊。写一封给未来的自己吧。</li>'; return; }
    S.capsules.forEach(c => {
      const li = document.createElement('li'); const open = capOpen(c);
      li.className = 'cap ' + (open ? 'cap-open' : 'cap-shut');
      li.innerHTML = '<div class="cap-ico" aria-hidden="true">' + (open ? ENV_OPEN : ENV_SHUT) + '</div><div class="cap-body"><b>' + (open ? '可以打开了' : '已封存') + '</b><small>写于 ' + ymd(c.created_at) + '</small>' +
        (open ? '<small>' + (lsGet('sh_cap_' + c.id) ? '读过了，点开再看一次' : '点一下打开') + '</small>' : '<small class="cap-left" data-unlock="' + c.unlock_at + '">' + untilText(c.unlock_at) + '</small>') + '</div>';
      if (open) { li.tabIndex = 0; li.setAttribute('role', 'button'); li.onclick = () => openLetter(c); li.onkeydown = e => { if (e.key === 'Enter') openLetter(c); }; }
      if (!open) { const cal = document.createElement('button'); cal.type = 'button'; cal.className = 'btn ghost cap-cal'; cal.textContent = '加到日历'; cal.onclick = e => { e.stopPropagation(); addToCalendar(c); }; li.appendChild(cal); }
      ul.appendChild(li);
    });
  }
  const ENV_SHUT = '<svg viewBox="0 0 48 48"><rect x="5" y="12" width="38" height="26" rx="4" fill="var(--mist-soft)" stroke="var(--mist)" stroke-width="2"/><path d="M6 14l18 13 18-13" fill="none" stroke="var(--mist)" stroke-width="2"/><circle cx="24" cy="27" r="4.5" fill="var(--blush)"/></svg>';
  const ENV_OPEN = '<svg viewBox="0 0 48 48"><path d="M5 22l19-12 19 12v16a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" fill="var(--blush-soft)" stroke="var(--mist)" stroke-width="2"/><rect x="12" y="6" width="24" height="22" rx="2" fill="var(--card)" stroke="var(--mist)" stroke-width="1.5"/><path d="M16 13h16M16 18h12M16 23h14" stroke="var(--muted)" stroke-width="1.5"/></svg>';
  /* 提醒：App 开着（包括在背景）→ 手机通知；App 完全关掉 → 靠手机日历 */
  const canNotify = () => 'Notification' in window && Notification.permission !== 'denied';
  async function askNotify() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    try { return (await Notification.requestPermission()) === 'granted'; } catch (e) { return false; }
  }
  function phoneNotify(c) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const opt = { body: '有一封你写给自己的信，现在可以打开了。', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'cap-' + c.id };
    const fallback = () => { try { new Notification('慢愈 · 时间胶囊', opt); } catch (e) {} };
    if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.ready.then(r => r.showNotification('慢愈 · 时间胶囊', opt)).catch(fallback); else fallback();
  }
  function addToCalendar(c) {
    const z = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const st = new Date(c.unlock_at), en = new Date(+st + 15 * 60000);
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SlowHeal//ZH', 'BEGIN:VEVENT', 'UID:' + c.id + '@slowheal', 'DTSTAMP:' + z(new Date()), 'DTSTART:' + z(st), 'DTEND:' + z(en),
      'SUMMARY:慢愈：有一封时间胶囊可以打开了', 'DESCRIPTION:打开慢愈，读一读那时候的你写给现在的你的信。', 'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:慢愈时间胶囊', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })); a.download = 'slowheal-capsule.ics';
    document.body.appendChild(a); a.click(); a.remove();
    toast('打开下载的文件，选「日历」就会在时间到时提醒你');
  }
  function remindSetup(c) {
    openSheet('<div class="celebrate"><div class="cap-ico big-ico">' + ENV_SHUT + '</div><p class="big">封存好了</p><p>' + ymdhm(c.unlock_at) + ' 就可以打开。<br>要怎么提醒你？</p>' +
      '<div class="stack-btns">' + (canNotify() ? '<button class="btn" id="rmNotify" type="button">用手机通知提醒我</button>' : '') +
      '<button class="btn soft" id="rmCal" type="button">加到手机日历（App 关掉也会提醒）</button><button class="btn ghost" data-close type="button">不用了，我自己来看</button></div>' +
      '<p class="hint">手机通知要 App 还开着或在背景才收得到。App 完全关掉的话，请用「加到手机日历」。</p></div>', () => {
      if ($('rmNotify')) $('rmNotify').onclick = async () => { const ok = await askNotify(); closeSheet(); toast(ok ? '好，时间到会通知你' : '手机没有允许通知，可以改用「加到日历」'); };
      $('rmCal').onclick = () => { addToCalendar(c); closeSheet(); };
    });
  }
  function openLetter(c) {
    lsSet('sh_cap_' + c.id, '1');
    const span = Math.round((+new Date(c.unlock_at) - +new Date(c.created_at)) / 60000);
    const ago = span < 60 ? span + ' 分钟前' : span < 1440 ? Math.round(span / 60) + ' 小时前' : span < 60 * 24 * 45 ? Math.round(span / 1440) + ' 天前' : Math.round(span / 43200) + ' 个月前';
    openSheet('<div class="env-stage" id="envStage"><div class="env"><div class="env-back"></div><div class="letter"><p class="letter-head">写于 ' + ymdhm(c.created_at) + '<br>' + ago + '的你，写给现在的你</p><div class="letter-text">' + esc(c.text) + '</div><p class="letter-foot">那时候的你，把这些留给了现在的你。</p></div><div class="env-front"></div><div class="env-flap"></div></div></div>', () => {
      requestAnimationFrame(() => requestAnimationFrame(() => $('envStage').classList.add('opening')));
      setTimeout(() => { if ($('envStage')) { $('envStage').classList.add('opened'); confetti(); } }, 1500);
    });
    renderCaps(); renderCapReady();
  }
  function renderCapReady() {
    const ready = S.capsules.find(c => capOpen(c) && !lsGet('sh_cap_' + c.id));
    $('capReadyCard').hidden = !ready;
    if (ready) $('capReadyGo').onclick = () => openLetter(ready);
  }
  // 每秒检查：倒数更新；一到时间就跳出卡片提醒
  const notified = new Set();
  setInterval(() => {
    if (!U || !S.capsules.length) return;
    document.querySelectorAll('.cap-left[data-unlock]').forEach(el => { el.textContent = untilText(el.dataset.unlock); });
    const fresh = S.capsules.filter(c => capOpen(c) && !lsGet('sh_cap_' + c.id) && !notified.has(c.id));
    if (!fresh.length) return;
    fresh.forEach(c => notified.add(c.id));
    renderCapReady(); if (!$('v-circle').hidden) renderCaps();
    const c = fresh[0];
    phoneNotify(c);
    const pop = () => openSheet('<div class="celebrate"><div class="cap-ico big-ico">' + ENV_SHUT + '</div><p class="big">叮！有一封信<br>可以打开了</p><p>这是 ' + ymdhm(c.created_at) + ' 的你，写给现在的你。</p><div class="stack-btns"><button class="btn" id="popOpen" type="button">打开看看</button><button class="btn ghost" data-close type="button">等一下再看</button></div></div>', () => { $('popOpen').onclick = () => openLetter(c); });
    if ($('sheetBg').hidden && $('lock').hidden) pop(); else toast('有一封时间胶囊可以打开了');
  }, 1000);

  /* 写信：滚轮选时间 */
  const UNITS = [['分钟', 60e3], ['小时', 36e5], ['天', 864e5], ['个月', 0], ['年', -1]];
  function wheelHTML(id, items) { return '<div class="wheel" id="' + id + '" tabindex="0">' + items.map((t, i) => '<div class="wheel-item" data-i="' + i + '">' + t + '</div>').join('') + '</div>'; }
  const ITEM_H = 40;
  const wheelGet = el => Math.max(0, Math.min(el.children.length - 1, Math.round(el.scrollTop / ITEM_H)));
  const wheelSet = (el, i, smooth) => el.scrollTo({ top: i * ITEM_H, behavior: smooth ? 'smooth' : 'auto' });
  function unlockFrom(n, ui) {
    const u = new Date();
    if (UNITS[ui][1] > 0) u.setTime(u.getTime() + n * UNITS[ui][1]); else if (UNITS[ui][1] < 0) u.setFullYear(u.getFullYear() + n); else u.setMonth(u.getMonth() + n);
    return u;
  }
  $('capNew').onclick = () => {
    const nums = Array.from({ length: 60 }, (_, i) => String(i + 1));
    openSheet('<h2>写给未来的自己</h2><textarea id="capText" maxlength="5000" placeholder="亲爱的，到你读到这封信的时候……"></textarea>' +
      '<span class="label">多久以后打开（上下滑动选择）</span>' +
      '<div class="wheels"><div class="wheel-band" aria-hidden="true"></div>' + wheelHTML('wNum', nums) + wheelHTML('wUnit', UNITS.map(u => u[0])) + '<span class="wheel-after">后</span></div>' +
      '<div class="chips" id="capPre"><button class="chip" type="button" data-n="2" data-u="0">2 分钟（试试看）</button><button class="chip" type="button" data-n="1" data-u="3">1 个月</button><button class="chip" type="button" data-n="3" data-u="3">3 个月</button><button class="chip" type="button" data-n="6" data-u="3">半年</button><button class="chip" type="button" data-n="1" data-u="4">1 年</button><button class="chip" type="button" data-n="3" data-u="4">3 年</button><button class="chip" type="button" data-n="5" data-u="4">5 年</button></div>' +
      '<p class="cap-when" id="capWhen"></p>' +
      '<p class="hint">封存以后，到时间之前不能看、也不能改。时间一到，App 会跳出卡片提醒你。</p><button class="btn" id="capSave" type="button">封存</button>', () => {
      const wn = $('wNum'), wu = $('wUnit');
      const upd = () => { $('capWhen').textContent = '将在 ' + ymdhm(unlockFrom(wheelGet(wn) + 1, wheelGet(wu))) + ' 打开'; [wn, wu].forEach(w => { const k = wheelGet(w); [...w.children].forEach((c, i) => c.classList.toggle('on', i === k)); }); };
      let tm; [wn, wu].forEach(w => { w.addEventListener('scroll', () => { clearTimeout(tm); tm = setTimeout(upd, 60); }); w.addEventListener('keydown', e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); wheelSet(w, wheelGet(w) + (e.key === 'ArrowDown' ? 1 : -1), true); } });
        w.addEventListener('click', e => { const it = e.target.closest('.wheel-item'); if (it) wheelSet(w, +it.dataset.i, true); }); });
      requestAnimationFrame(() => { wheelSet(wn, 0); wheelSet(wu, 3); upd(); });
      $('capPre').querySelectorAll('.chip').forEach(ch => ch.onclick = () => { wheelSet(wn, +ch.dataset.n - 1, true); wheelSet(wu, +ch.dataset.u, true); setTimeout(upd, 400); });
      $('capSave').onclick = async () => {
        const t = $('capText').value.trim(); if (!t) return $('capText').focus();
        const u = unlockFrom(wheelGet(wn) + 1, wheelGet(wu));
        $('capSave').disabled = true;
        const { data, error } = await sb.from('capsules').insert({ text: t, unlock_at: u.toISOString() }).select().single();
        if (error) { $('capSave').disabled = false; return fail(error); }
        S.capsules.push(data); S.capsules.sort((a, b) => a.unlock_at < b.unlock_at ? -1 : 1);
        closeSheet(); renderCaps(); remindSetup(data);
      };
    });
  };

  /* ================= 夸夸圈开关 + 浏览提醒 ================= */
  function layoutTabs() {
    const showC = lsGet('sh_hide_circle') !== '1';
    document.querySelector('.tab[data-v="circle"]').hidden = !showC;
    $('showCircle').checked = showC;
    const n = [...document.querySelectorAll('.nav .tab')].filter(t => !t.hidden).length;
    document.querySelector('.nav .inner').style.gridTemplateColumns = 'repeat(' + n + ',1fr)';
  }
  $('showCircle').onchange = e => { lsSet('sh_hide_circle', e.target.checked ? '0' : '1'); layoutTabs(); };
  let circleSec = 0;
  setInterval(() => {
    if (PERSONAL || document.hidden || $('v-circle').hidden) return;
    circleSec += 30;
    if (circleSec >= 900) { circleSec = 0; openSheet('<h2>休息一下吧</h2><p class="quote">已经在夸夸圈看了 15 分钟了。起来喝口水、伸个懒腰，看看窗外。</p><div class="row"><button class="btn" data-close type="button">好</button></div>'); }
  }, 30000);

  /* ================= App 锁 ================= */
  const pinKey = () => 'sh_pin_' + (U ? U.id : '');
  async function hashPin(pin) {
    const s = 'slowheal:' + (U ? U.id : '') + ':' + pin;
    if (window.crypto && crypto.subtle) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
    let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return 'f' + (h >>> 0).toString(16);
  }
  function renderPinBtn() { $('pinBtn').textContent = lsGet(pinKey()) ? '关闭' : '设定'; }
  function maybeLock() {
    renderPinBtn();
    if (!lsGet(pinKey())) return;
    $('lock').hidden = false; $('lockIn').value = ''; $('lockMsg').textContent = ''; setTimeout(() => $('lockIn').focus(), 50);
  }
  async function tryUnlock() {
    if (await hashPin($('lockIn').value) === lsGet(pinKey())) { $('lock').hidden = true; $('lockIn').value = ''; }
    else { $('lockMsg').textContent = '密码不对'; $('lockIn').value = ''; }
  }
  $('lockGo').onclick = tryUnlock;
  $('lockIn').addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });
  $('lockForgot').onclick = async () => {
    if (!PERSONAL) { try { localStorage.removeItem(pinKey()); } catch (e) {} await sb.auth.signOut(); location.reload(); return; }
    $('lockMsg').innerHTML = '个人版没有账号，忘记密码只能清空所有资料重新开始。<br><button class="link" id="lockWipe" type="button">清空并重新开始</button>';
    $('lockWipe').onclick = () => { if ($('lockWipe').dataset.armed) { try { localStorage.removeItem(pinKey()); } catch (e) {} sb.rpc('delete_my_account').then(() => location.reload()); } else { $('lockWipe').dataset.armed = '1'; $('lockWipe').textContent = '真的要清空吗？再按一次'; } };
  };
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (U && lsGet(pinKey()) && Date.now() - hiddenAt > 60000) maybeLock();
  });
  $('pinBtn').onclick = () => {
    if (lsGet(pinKey())) { try { localStorage.removeItem(pinKey()); } catch (e) {} renderPinBtn(); return toast('App 锁已关闭'); }
    openSheet('<h2>设定 App 锁</h2><p class="hint">每次打开慢愈，或离开超过 1 分钟再回来，都要输入密码。密码只存在这台手机。忘记的话，重新登录就可以重设。</p>' +
      '<input type="password" inputmode="numeric" id="pin1" maxlength="6" placeholder="4–6 位数字"><input type="password" inputmode="numeric" id="pin2" maxlength="6" placeholder="再输入一次"><button class="btn" id="pinSave" type="button">保存</button><p class="msg" id="pinMsg"></p>', () => {
      $('pinSave').onclick = async () => {
        const a = $('pin1').value, b = $('pin2').value;
        if (!/^\d{4,6}$/.test(a)) { $('pinMsg').textContent = '请输入 4–6 位数字'; return; }
        if (a !== b) { $('pinMsg').textContent = '两次输入不一样'; return; }
        lsSet(pinKey(), await hashPin(a)); closeSheet(); renderPinBtn(); toast('App 锁已开启');
      };
    });
  };

  /* ================= 音乐（App 里自己合成，不用下载） ================= */
  const Music = (() => {
    let ctx = null, master = null, timers = [], live = [];
    const CH = [[261.63, 329.63, 392.0, 493.88], [220.0, 261.63, 329.63, 392.0], [174.61, 220.0, 261.63, 329.63], [196.0, 246.94, 293.66, 392.0]];
    const PENTA = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
    function ensure() {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
      if (!ctx) ctx = new AC(); if (ctx.state === 'suspended') ctx.resume(); return ctx;
    }
    function osc(c, type, f, t, dur, peak, dest, attack) {
      const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + (attack || 2)); g.gain.setValueAtTime(peak, t + dur - 1.5); g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.1); live.push(o);
      o.onended = () => { live = live.filter(x => x !== o); };
    }
    function stop() {
      token++; timers.forEach(clearTimeout); timers = [];
      if (!master || !ctx) return;
      const m = master, now = ctx.currentTime; master = null;
      try { m.gain.cancelScheduledValues(now); m.gain.setValueAtTime(m.gain.value, now); m.gain.linearRampToValueAtTime(0, now + 1); } catch (e) {}
      const kill = live.slice(); live = [];
      setTimeout(() => { kill.forEach(o => { try { o.stop(); } catch (e) {} }); try { m.disconnect(); } catch (e) {} }, 1200);
    }
    let token = 0;
    function play(sec, opt) {
      stop(); const c = ensure(); if (!c) return false;
      const my = ++token;
      // 手机第一次按时声音引擎还没醒，先叫醒再开始
      try { const b = c.createBuffer(1, 1, 22050), src = c.createBufferSource(); src.buffer = b; src.connect(c.destination); src.start(0); } catch (e) {}
      if (c.state !== 'running') { c.resume().then(() => { if (my === token) start(c, sec, opt); }).catch(() => {}); return true; }
      start(c, sec, opt); return true;
    }
    function start(c, sec, opt) {
      const t0 = c.currentTime + 0.1, end = t0 + sec;
      master = c.createGain(); const m = master;
      m.gain.setValueAtTime(0, t0); m.gain.linearRampToValueAtTime(0.55, t0 + 3); m.gain.setValueAtTime(0.55, Math.max(t0 + 3, end - 4)); m.gain.linearRampToValueAtTime(0, end);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1600; lp.connect(m); m.connect(c.destination);
      const LEN = 8;
      const chord = i => {
        if (master !== m) return; const st = t0 + i * LEN; if (st >= end) return;
        const ch = CH[i % CH.length], dur = Math.min(LEN + 2, end - st);
        ch.forEach(f => { osc(c, 'sine', f, st, dur, 0.045, lp); osc(c, 'triangle', f / 2 * 1.003, st, dur, 0.03, lp); });
        for (let k = 0; k < 4; k++) { const tt = st + 0.8 + k * 2 + Math.random(); if (tt < end - 1) { const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = PENTA[Math.floor(Math.random() * PENTA.length)];
          g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(0.035, tt + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, tt + 2.2); o.connect(g); g.connect(lp); o.start(tt); o.stop(tt + 2.3); live.push(o); } }
        timers.push(setTimeout(() => chord(i + 1), (st + LEN - c.currentTime - 1) * 1000));
      };
      chord(0);
      if (opt && opt.breath) { // 跟着呼吸的海浪声：吸 4 · 停 4 · 呼 6
        const n = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = n.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        const src = c.createBufferSource(); src.buffer = n; src.loop = true;
        const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.7;
        const g = c.createGain(); g.gain.setValueAtTime(0.01, t0);
        for (let t = t0; t < end; t += 14) { g.gain.linearRampToValueAtTime(0.16, Math.min(end, t + 4)); g.gain.setValueAtTime(0.16, Math.min(end, t + 8)); g.gain.linearRampToValueAtTime(0.01, Math.min(end, t + 14)); }
        src.connect(bp); bp.connect(g); g.connect(m); src.start(t0); src.stop(end + 0.1); live.push(src);
      }
      timers.push(setTimeout(() => { if (master === m) master = null; }, sec * 1000 + 500));
    }
    return { play, stop };
  })();

  /* ================= 慢观自我：目标显化 + 回放 ================= */
  const goals = () => vis().filter(r => r.kind === 'goal').slice().reverse();
  function renderGoals() {
    const ul = $('goalList'); ul.innerHTML = '';
    const g = goals();
    if (!g.length) { ul.innerHTML = '<li class="empty">写下你想要的样子，用「我已经……」的语气，像它已经发生了一样。</li>'; return; }
    g.forEach(r => {
      const li = document.createElement('li'); li.className = 'line goal' + (r.tag === '已达成' ? ' done' : '');
      li.innerHTML = '<span class="txt">' + esc(r.text) + '</span>' + (r.tag === '已达成' ? '<span class="stamp">已达成</span>' : '');
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ghost'; b.textContent = r.tag === '已达成' ? '还没' : '达成了';
      b.onclick = async () => { const v = r.tag === '已达成' ? null : '已达成'; const { error } = await sb.from('records').update({ tag: v }).eq('id', r.id); if (error) return fail(error); r.tag = v; renderGoals(); if (v) { confetti(); toast('你做到了！'); } };
      li.appendChild(b); li.appendChild(delBtn(() => deleteRecord(r))); ul.appendChild(li);
    });
  }
  $('goalAdd').onclick = async () => { const t = $('goalIn').value.trim(); if (!t) return $('goalIn').focus(); if (await addRecord('goal', t, null, $('goalAdd'))) { $('goalIn').value = ''; renderGoals(); } };
  $('goalIn').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); $('goalAdd').click(); } });
  $('manifestGo').onclick = () => {
    const lines = goals().filter(r => r.tag !== '已达成').map(r => r.text);
    if (!lines.length) { toast('先写下一个目标吧'); $('goalIn').focus(); return; }
    let i = 0, left = 60;
    openSheet('<div class="celebrate"><span class="label">显化一分钟</span><p class="hint">闭上眼睛也可以。想象它已经发生了，你是什么感觉？</p><div class="orb-wrap"><div class="orb" id="mOrb"></div></div><p class="big" id="mLine">' + esc(lines[0]) + '</p><p class="hint" id="mLeft">60</p></div>', () => {
      const ok = Music.play(60); if (!ok) toast('这台手机放不了音乐，可以静静地看');
      const orb = $('mOrb'); let big = false;
      const breathe = () => { big = !big; orb.style.transitionDuration = '5s'; orb.style.transform = 'scale(' + (big ? 1.8 : 1) + ')'; };
      breathe();
      const t = setInterval(() => {
        if (!$('mLine')) return clearInterval(t);
        left--; $('mLeft').textContent = left;
        if (left % 5 === 0) breathe();
        if (left % 8 === 0) { i = (i + 1) % lines.length; $('mLine').textContent = lines[i]; }
        if (left <= 0) { clearInterval(t); $('mLine').textContent = '你值得这一切。'; $('mLeft').textContent = ''; confetti(); }
      }, 1000);
      sheetTimers.push(t);
    });
  };
  /* ================= 回放：本月 / 每个月 / 全年 / 全部 ================= */
  let rpPosts = null, rpYear = null;
  async function rpLoadPosts() {
    if (rpPosts) return rpPosts;
    const { data } = await sb.from('posts').select('id,text,images,created_at').eq('user_id', U.id).eq('circle', 'daily').order('created_at', { ascending: false }).limit(500);
    return (rpPosts = data || []);
  }
  function rpSlides(posts) {
    const slides = [];
    S.records.forEach(r => {
      if (r.kind === 'joy') slides.push({ head: r.tag || '今天的我', text: r.text, images: r.images, at: r.created_at });
      if (r.kind === 'goal' && r.tag === '已达成') slides.push({ head: '我做到了', text: r.text, at: r.created_at });
      if (r.kind === 'wish' && r.tag === '已完成') slides.push({ head: '愿望实现了', text: r.text, at: r.created_at });
      if (r.kind === 'selflove') slides.push({ head: '我喜欢自己', text: r.text, at: r.created_at });
    });
    Object.entries(S.moods || {}).forEach(([day, m]) => moodEntries(m, day).forEach(e => {
      const tg = e.tags || []; if (!e.text || !tg.length) return;
      if (tg.reduce((x, t) => x + scoreOf(t), 0) / tg.length >= 4) slides.push({ head: tg.join(' · '), text: e.text, at: e.at || day });
    }));
    (posts || []).forEach(p => slides.push({ head: '我的生活', text: p.text, images: p.images, at: p.created_at }));
    return slides.filter(x => x.at && !isNaN(new Date(x.at)));
  }
  function renderReplayPeriods() {
    const yb = $('rpYears'); if (!yb) return;
    const now = new Date(), cy = now.getFullYear(), cm = now.getMonth();
    const ds = rpSlides(rpPosts || []).map(x => new Date(x.at));
    const years = [...new Set(ds.map(d => d.getFullYear()).concat(cy))].sort((x, y) => y - x);
    if (!rpYear || !years.includes(rpYear)) rpYear = cy;
    yb.innerHTML = years.map(y => '<button type="button" class="chip" aria-pressed="' + (y === rpYear) + '" data-y="' + y + '">' + y + ' 年</button>').join('');
    yb.querySelectorAll('button').forEach(x => x.onclick = () => { rpYear = +x.dataset.y; renderReplayPeriods(); });
    const cnt = (f, t) => ds.filter(d => d >= f && d < t).length;
    const last = rpYear === cy ? cm : 11, items = [];
    for (let mo = last; mo >= 0; mo--) {
      const f = new Date(rpYear, mo, 1), t = new Date(rpYear, mo + 1, 1), n = cnt(f, t);
      if (!n && !(rpYear === cy && mo === cm)) continue;
      items.push({ name: (rpYear === cy && mo === cm) ? '本月 · ' + (mo + 1) + ' 月' : (mo + 1) + ' 月', title: rpYear + ' 年 ' + (mo + 1) + ' 月', f, t, n });
    }
    const yf = new Date(rpYear, 0, 1), yt = new Date(rpYear + 1, 0, 1);
    const big = [{ name: rpYear + ' 全年', title: rpYear + ' 年', f: yf, t: yt, n: cnt(yf, yt), year: true }];
    if (years.length > 1) big.push({ name: '全部回忆', title: '全部回忆', f: new Date(0), t: new Date(8.64e15), n: ds.length, year: true });
    const all = big.concat(items);
    $('rpPeriods').innerHTML = all.map((x, i) => '<button type="button" class="rp-p' + (x.year ? ' yr' : '') + '" data-i="' + i + '"' + (x.n ? '' : ' disabled') + '><b>' + esc(x.name) + '</b><small>' + (x.n ? x.n + ' 个回忆' : '还没有记录') + '</small></button>').join('');
    $('rpPeriods').querySelectorAll('button').forEach(x => x.onclick = () => replay(all[+x.dataset.i]));
  }
  async function replay(P) {
    const posts = await rpLoadPosts();
    const slides = rpSlides(posts).filter(x => { const d = new Date(x.at); return d >= P.f && d < P.t; }).sort((x, y) => new Date(x.at) - new Date(y.at));
    if (!slides.length) return openSheet('<h2>' + esc(P.title) + '还没有回忆</h2><p>写几篇「记下今天的自己」、夸夸日记，或者完成一个愿望，这里就会帮你回放。</p>');
    const max = P.year ? 30 : 15;
    let show = slides;
    if (show.length > max) { const step = show.length / max; show = Array.from({ length: max }, (_, k) => slides[Math.floor(k * step)]); }
    const dur = P.year ? Math.min(120, Math.max(60, show.length * 4)) : 60;
    const per = Math.max(3, Math.floor(dur / (show.length + 1)));
    const paths = show.flatMap(s => (s.images || []).slice(0, 1));
    const urls = paths.length ? await signed(paths).catch(() => ({})) : {};
    const kinds = {}; slides.forEach(x => kinds[x.head] = 1);
    let i = -1;
    const more = '<div class="rp-more"><p>' + esc(P.title) + '，你一共记下了 ' + slides.length + ' 个回忆。' + (slides.length < 5 ? '多记录自己，下次回放会更丰富。' : '') + '</p><button class="btn" id="rpWrite" type="button">去记下今天的自己</button></div>';
    openSheet('<div class="replay"><div class="bar"><span id="rpBar"></span></div><div id="rpSlide" class="rp-slide"></div><p class="hint center" id="rpCount"></p><div class="row center"><button class="btn soft" id="rpNext" type="button">下一张</button></div><div id="rpMore" hidden>' + more + '</div></div>', () => {
      const goWrite = () => { closeSheet(); go('heart'); setTimeout(() => { $('momentText').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('momentText').focus(); }, 200); };
      $('rpMore').querySelector('#rpWrite').onclick = goWrite;
      const syncNext = () => { $('rpCount').textContent = i < 0 ? '' : (i + 1) + ' / ' + show.length; const last = i >= show.length - 1; $('rpNext').disabled = last; $('rpNext').textContent = last ? '已经是最后一张' : '下一张'; $('rpMore').hidden = !last; };
      Music.play(dur);
      const draw = () => {
        if (i < 0) { $('rpSlide').innerHTML = '<span class="stamp">我的回放</span><p class="rp-title">' + esc(P.title) + '</p><p class="hint">' + slides.length + ' 个属于你的瞬间</p>'; }
        else { const s = show[i], img = s.images && s.images[0] && urls[s.images[0]];
          $('rpSlide').innerHTML = (img ? '<img src="' + img + '" alt="">' : '') + '<span class="stamp">' + esc(s.head) + '</span>' + (s.text ? '<p class="big">' + esc(s.text) + '</p>' : '') + '<p class="hint">' + ymd(s.at) + '</p>'; }
        $('rpSlide').classList.remove('in'); void $('rpSlide').offsetWidth; $('rpSlide').classList.add('in');
        syncNext();
      };
      draw();
      let tick = 0;
      const t = setInterval(() => {
        if (!$('rpSlide')) return clearInterval(t);
        tick++; $('rpBar').style.width = Math.min(100, tick / dur * 100) + '%';
        if (tick % per === 0) { i++; if (i >= show.length || tick >= dur) { clearInterval(t); $('rpSlide').innerHTML = '<p class="big">这些都是你。</p><p>' + esc(P.title) + '的你，比自己以为的更好。</p>'; $('rpCount').textContent = ''; $('rpNext').hidden = true; $('rpMore').hidden = false; confetti(); return; } draw(); }
      }, 1000);
      sheetTimers.push(t);
      $('rpNext').onclick = () => { if (i < show.length - 1) { i++; draw(); } };
    });
  }

  /* ================= 夸夸 + 时间胶囊 ================= */
  document.querySelectorAll('#circleSeg button').forEach(b => b.onclick = () => {
    document.querySelectorAll('#circleSeg button').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
    const c = b.dataset.c;
    $('paneFeed').hidden = c !== 'feed'; $('paneCaps').hidden = c !== 'caps'; $('paneGoals').hidden = c !== 'goals'; $('newPost').hidden = c !== 'feed';
    if (c === 'caps') renderCaps(); if (c === 'goals') { renderReplayPeriods(); rpLoadPosts().then(renderReplayPeriods).catch(() => {}); }
  });

  /* ================= 疗愈档案（每一段感情一份，一次只开一份） ================= */
  function archiveSheet() {
    const c = activeCase(); if (!c) return;
    const name = esc(c.name || 'TA');
    openSheet('<div class="celebrate"><div class="cap-ico big-ico">' + ENV_SHUT + '</div><h2>结束本阶段疗愈</h2>' +
      '<p>恭喜你走完这一段旅程。和' + name + '有关的这份疗愈档案，会封存到历史档案库。</p>' +
      '<p>你会回到「慢观自我」继续记录自己。档案不会被删除，往后你随时可以回看。</p>' +
      '<div class="stack-btns"><button class="btn" id="arGo" type="button">归档这段关系</button><button class="btn ghost" data-close type="button">还没准备好</button></div></div>', () => {
      const b = $('arGo');
      b.onclick = async () => {
        if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = '确定归档？再按一次'; return; }
        b.disabled = true; b.textContent = '正在归档……';
        const at = new Date().toISOString();
        const { error } = await sb.from('cases').update({ status: 'archived', archived_at: at }).eq('id', c.id);
        if (error) { b.disabled = false; b.textContent = '归档这段关系'; delete b.dataset.armed; return fail(error); }
        c.status = 'archived'; c.archived_at = at; syncContact();
        await setMode('daily', true);
        renderChatHead(); renderLetters(); renderHeart(); renderCases();
        celebrate(c);
      };
    });
  }
  function celebrate(c) {
    openSheet('<div class="celebrate"><svg viewBox="0 0 24 24" fill="none"><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" fill="var(--blush)"/><path d="M8.5 10.5l2.3 2.3 4.7-4.6" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '<p class="big">恭喜你，<br>走完了这一段旅程。</p><p>这一段已经好好收进档案库了。<br>你的日记、边界和里程碑都还在，接下来，继续好好记录自己。</p>' +
      '<div class="stack-btns"><button class="btn" id="cDaily" type="button">开始慢观自我</button><button class="btn ghost" id="cLib" type="button">看看档案库</button></div></div>', () => {
      $('cDaily').onclick = () => { closeSheet(); go('today'); };
      $('cLib').onclick = () => { closeSheet(); go('me'); setTimeout(() => $('caseCard').scrollIntoView({ behavior: 'smooth', block: 'center' }), 200); };
    });
  }
  function newCaseSheet() {
    const old = (S.cases || []).filter(c => c.status === 'archived').length;
    openSheet('<h2>开启新一轮疗愈</h2><p class="quote">如果此刻你再次陷入情绪的伤痛，可以开启新一轮疗愈旅程。</p>' +
      '<p>你过往所有日记、边界与自我里程碑全部保留，不会丢失。' + (old ? '之前的 ' + old + ' 份档案也安安稳稳地放在档案库里。' : '') + '</p>' +
      '<input type="text" id="ncName" maxlength="30" placeholder="这一段，你想怎么称呼 TA？（可以不填）">' +
      '<div class="stack-btns"><button class="btn" id="ncGo" type="button">开启新一轮疗愈</button><button class="btn ghost" data-close type="button">先不用</button></div>', () => {
      $('ncGo').onclick = async () => {
        $('ncGo').disabled = true;
        const c = await createCase($('ncName').value.trim() || 'TA');
        if (!c) { $('ncGo').disabled = false; return; }
        closeSheet(); await setMode('heal', true);
        renderChatHead(); renderLetters(); renderHeart(); renderCases();
        toast('这一次，也会走过去的');
      };
    });
  }
  async function createCase(name, extra) {
    const { data, error } = await sb.from('cases').insert(Object.assign({ name, style: 'green', blur: false, status: 'active' }, extra || {})).select().single();
    if (error) { fail(error); return null; }
    S.cases.push(data); syncContact(); return data;
  }
  function caseStats(c) {
    const rs = S.records.filter(r => r.case_id === c.id);
    return { reasons: rs.filter(r => r.kind === 'reason'), moments: rs.filter(r => r.kind === 'moment'), letters: S.letters.filter(l => l.case_id === c.id) };
  }
  function renderCases() {
    const ul = $('caseList'); if (!ul) return; ul.innerHTML = '';
    const list = (S.cases || []).slice().sort((a, b) => (b.started_at || b.created_at || '') > (a.started_at || a.created_at || '') ? 1 : -1);
    $('caseNew').hidden = !!activeCase();
    if (!list.length) { ul.innerHTML = '<li class="empty">还没有疗愈档案。</li>'; return; }
    list.forEach(c => {
      const st = caseStats(c), on = c.status === 'active';
      const li = document.createElement('li'); li.className = 'cap ' + (on ? 'cap-open' : 'cap-shut'); li.tabIndex = 0; li.setAttribute('role', 'button');
      li.innerHTML = '<div class="cap-ico" aria-hidden="true">' + (on ? ENV_OPEN : ENV_SHUT) + '</div><div class="cap-body"><b>' + esc(c.name || 'TA') + (on ? ' · 疗愈中' : ' · 已归档') + '</b>' +
        '<small>' + ymd(c.started_at || c.created_at) + (c.archived_at ? ' → ' + ymd(c.archived_at) : ' 开始') + '</small>' +
        '<small>' + st.reasons.length + ' 个不合适的地方 · ' + st.moments.length + ' 个受伤的瞬间 · ' + st.letters.length + ' 条没发出的话</small></div>';
      if (!on) { const del = document.createElement('button'); del.type = 'button'; del.className = 'btn ghost cap-cal'; del.textContent = '永久删除'; del.onclick = e => { e.stopPropagation(); deleteCaseSheet(c); }; li.appendChild(del); }
      li.onclick = () => on ? (closeSheet(), setMode('heal'), go('heart')) : openCase(c);
      li.onkeydown = e => { if (e.key === 'Enter') li.click(); };
      ul.appendChild(li);
    });
  }
  async function openCase(c) {
    const st = caseStats(c);
    const imgs = st.moments.flatMap(m => m.images || []);
    const urls = imgs.length ? await signed(imgs).catch(() => ({})) : {};
    openSheet('<div class="row between"><span class="label">已归档 · 只能回看</span><button class="btn ghost cap-cal" id="caseDelTop" type="button">永久删除</button></div><h2>' + esc(c.name || 'TA') + '</h2><p class="hint">' + ymd(c.started_at || c.created_at) + ' → ' + (c.archived_at ? ymd(c.archived_at) : '') + '</p>' +
      '<div class="card"><span class="label">我们不合适的地方</span>' + (st.reasons.length ? '<ol class="list numbered">' + st.reasons.map(r => '<li><span class="txt">' + esc(r.text) + '</span></li>').join('') + '</ol>' : '<p class="hint">没有记录。</p>') + '</div>' +
      '<div class="card"><span class="label">受伤的瞬间</span>' + (st.moments.length ? st.moments.map(m => '<div class="moment">' + ((m.images || []).map(p => urls[p] ? '<img src="' + urls[p] + '" alt="" style="border-radius:10px;max-height:200px">' : '').join('')) + (m.text ? '<div class="feel">' + esc(m.text) + '</div>' : '') + '</div>').join('') : '<p class="hint">没有记录。</p>') + '</div>' +
      '<div class="card"><span class="label">没发出去的话</span>' + (st.letters.length ? '<ul class="list diary">' + st.letters.map(l => '<li class="diary-item"><time>' + ymd(l.created_at).replace(/^\d+ 年 /, '') + '</time><div><p>' + esc(l.text || '（图片）') + '</p></div></li>').join('') + '</ul>' : '<p class="hint">没有记录。</p>') + '</div>' +
      '<p class="hint center">这些都是你走过的路。</p><div class="row center"><button class="btn ghost" id="caseDel" type="button">永久删除这份档案</button></div>', () => {
      $('caseDel').onclick = () => deleteCaseSheet(c); $('caseDelTop').onclick = () => deleteCaseSheet(c);
    });
  }
  function deleteCaseSheet(c) {
    const st = caseStats(c);
    openSheet('<div class="celebrate"><h2>永久删除「' + esc(c.name || 'TA') + '」的档案？</h2><p>' + st.reasons.length + ' 个不合适的地方、' + st.moments.length + ' 个受伤的瞬间（含照片）、' + st.letters.length + ' 条没发出的话，都会永久删除，不能恢复。</p>' +
      '<p class="hint">你的日记、边界、里程碑不会受影响。</p><div class="stack-btns"><button class="btn blush" id="cdGo" type="button">永久删除</button><button class="btn ghost" data-close type="button">先留着</button></div></div>', () => {
      const d = $('cdGo');
      d.onclick = async () => {
        if (!d.dataset.armed) { d.dataset.armed = '1'; d.textContent = '真的确定吗？再按一次'; return; }
        d.disabled = true; d.textContent = '正在删除……';
        try {
          const files = st.moments.flatMap(m => m.images || []).concat(st.letters.flatMap(l => l.images || []), c.avatar ? [c.avatar] : []);
          for (const t of ['letters', 'records', 'episodes']) { const { error } = await sb.from(t).delete().eq('case_id', c.id); if (error) throw error; }
          const { error } = await sb.from('cases').delete().eq('id', c.id); if (error) throw error;
          await removeFiles(files);
          S.letters = S.letters.filter(l => l.case_id !== c.id); S.records = S.records.filter(r => r.case_id !== c.id); S.episodes = S.episodes.filter(e => e.case_id !== c.id); S.cases = S.cases.filter(x => x.id !== c.id);
          closeSheet(); renderCases(); toast('这份档案已经永久删除');
        } catch (e) { d.disabled = false; d.textContent = '永久删除'; delete d.dataset.armed; fail(e); }
      };
    });
  }
  $('caseNew').onclick = () => newCaseSheet();

  /* ================= 个人版界面 ================= */
  if (PERSONAL) {
    document.querySelector('#v-circle .brand').textContent = '只有你自己看得到';
    document.querySelector('#v-circle h1').textContent = '夸夸日记';
    $('feedSeg').hidden = true; $('newPost').textContent = '写一篇';
    document.querySelector('#circleSeg [data-c="feed"]').textContent = '夸夸日记';
    const ct = document.querySelector('.tab[data-v="circle"]'); ct.lastChild.textContent = '夸夸';
    document.querySelector('label[for="showCircle"], #showCircle').parentElement.lastChild.textContent = '在底部显示夸夸日记';
    $('signOut').hidden = true;
    $('delAcc').textContent = '清空所有资料';
    document.querySelector('#v-me a.rowlink').hidden = true;
    const nickCard = $('nickIn').closest('.card'); nickCard.querySelector('.label').textContent = '怎么称呼你（打招呼用）';
    const bk = document.createElement('div'); bk.className = 'card';
    bk.innerHTML = '<span class="label">备份</span><p class="hint">资料只存在这台手机。换手机或清除浏览器资料前，先备份到文件。</p><div class="row"><button class="btn soft" id="bkOut" type="button">备份到文件</button><label class="btn ghost" style="position:relative">从备份恢复<input type="file" accept=".json,application/json" id="bkIn" style="position:absolute;width:1px;height:1px;opacity:0"></label></div>';
    nickCard.after(bk);
    $('bkOut').onclick = async () => {
      try {
        const txt = await window.SLOWHEAL_BACKUP();
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' }));
        a.download = 'slowheal-backup-' + TODAY() + '.json'; document.body.appendChild(a); a.click(); a.remove();
        toast('备份好了，存好这个文件');
      } catch (e) { fail(e, '备份没有成功'); }
    };
    $('bkIn').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      openSheet('<h2>从备份恢复？</h2><p>现在 App 里的资料会被备份文件里的内容取代。</p><div class="row"><button class="btn blush" id="bkGo" type="button">恢复</button><button class="btn soft" data-close type="button">取消</button></div>', () => {
        $('bkGo').onclick = async () => { try { await window.SLOWHEAL_RESTORE(await f.text()); } catch (err) { closeSheet(); fail(err, '这个文件不能用来恢复'); } };
      });
      e.target.value = '';
    };
  }
  $('delAcc').onclick = PERSONAL ? () => openSheet('<h2>清空所有资料</h2><p>心事、聊天、日记、照片都会永久删除，不能恢复。</p><div class="row"><button class="btn blush" id="wipeGo" type="button">确定清空</button><button class="btn soft" data-close type="button">取消</button></div>', () => {
    $('wipeGo').onclick = () => { if ($('wipeGo').dataset.armed) { try { localStorage.removeItem(pinKey()); } catch (e) {} sb.rpc('delete_my_account').then(() => location.reload()); } else { $('wipeGo').dataset.armed = '1'; $('wipeGo').textContent = '真的确定吗？再按一次'; } };
  }) : $('delAcc').onclick;

  /* ================= PWA ================= */
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
