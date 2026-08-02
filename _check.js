

// ======== 配置 ========
const STORAGE_KEY = 'kuanwei_inventory_data';
const GOODS_KEY = 'kuanwei_goods_names';
const STORE_KEY = 'kuanwei_stores';
const OCR_KEY = 'kuanwei_ocr_keys';

// 筐：名称 + 多别名（全局统一一套，所有店面共用）
const DEFAULT_GOODS = [
  { name: '鲜食筐', aliases: ['鲜食', '鲜'] },
  { name: '面包筐', aliases: ['面包', '面'] },
  { name: '低温筐', aliases: ['低温', '冷藏', '冷藏筐'] },
  { name: '冷冻筐', aliases: ['冷冻'] },
  { name: '常温筐', aliases: ['常温', '常'] },
];
// 店面：名称 + 多别名，可自定义增减
const DEFAULT_STORES = [];

let currentStoreIdx = 0; // 当前选中的店面下标
let currentActionType = null; // 'in'=发出 'out'=回收
let currentActionLabel = '发出';

// ======== 数据层（支持多账号本地隔离） ========
// 多账号数据隔离复核加强：
// - 登录账号后，记录/筐配置/店面配置写入「账号作用域」key（kuanwei_xxx__<手机号>），实现本地按账号彻底隔离
// - 不同账号数据互不串号；切换账号自动加载对应账号的数据
// - 未登录时使用全局 key（与旧版本兼容）
const DATA_KEYS = [STORAGE_KEY, GOODS_KEY, STORE_KEY];
function getDataScope() { return getCloudPhone() || ''; }
function scopeKey(base) {
  const scope = getDataScope();
  return scope ? (base + '__' + scope) : base;
}
// 账号首次登录时，把旧版全局数据迁移到该账号作用域，避免数据丢失
// 迁移后清空全局 key，防止旧数据串到其他账号（多账号隔离复核）
function migrateDataToScope() {
  const scope = getDataScope();
  if (!scope) return;
  // 已迁移过则不再处理，避免每次登录都操作全局 key 造成覆盖/删除窗口
  if (localStorage.getItem('kuanwei_migrated__' + scope) === '1') return;
  for (const base of DATA_KEYS) {
    const scoped = scopeKey(base);
    // 仅当该账号作用域尚不存在且全局有值时，才把全局旧数据迁入
    if (localStorage.getItem(scoped) === null) {
      const globalVal = localStorage.getItem(base);
      if (globalVal !== null) localStorage.setItem(scoped, globalVal);
    }
    // 迁移完成后清空全局 key（移动语义），保证退出登录/未登录时读到的是空而非旧数据，杜绝账号间串号
    localStorage.removeItem(base);
  }
  localStorage.setItem('kuanwei_migrated__' + scope, '1');
}
function loadData() {
  try {
    const raw = localStorage.getItem(scopeKey(STORAGE_KEY));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    const stores = loadStoreConfig();
    const defName = (stores[0] && stores[0].name) || '默认店';
    // 旧数据无店面字段 → 归默认店(0)
    return arr.map(r => {
      if (r.storeIdx === undefined || r.storeIdx === null) {
        r.storeIdx = 0;
        r.storeName = defName;
      }
      return r;
    });
  } catch(e) { return []; }
}
function saveDataArr(arr) {
  localStorage.setItem(scopeKey(STORAGE_KEY), JSON.stringify(arr));
  // 记录本地最后保存时间，供云端恢复时判断新旧（避免旧云数据覆盖新本地录入）
  localStorage.setItem('kuanwei_last_save', new Date().toISOString());
  scheduleCloudBackup();
}
// ---- 命名配置读取（筐/店面共用一个解析逻辑，一条函数两种数据） ----
function loadNamedConfig(key, defaults) {
  try {
    const raw = localStorage.getItem(scopeKey(key));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed))
        return typeof parsed[0] === 'string' ? parsed.map(n => ({ name: n, aliases: [] })) : parsed;
    }
  } catch(e) {}
  return defaults.map(g => ({ name: g.name, aliases: [...g.aliases] }));
}
// ---- 筐配置 ----
function loadGoodsConfig() { return loadNamedConfig(GOODS_KEY, DEFAULT_GOODS); }
function loadGoodsNames() {
  return loadGoodsConfig().map(g => g.name);
}
function saveGoodsConfig(cfg) {
  localStorage.setItem(scopeKey(GOODS_KEY), JSON.stringify(cfg));
  scheduleCloudBackup();
}
// ---- 店面配置 ----
function loadStoreConfig() { return loadNamedConfig(STORE_KEY, DEFAULT_STORES); }
// 店面排序视图：按 sort 字段升序（无 sort 视为 sort=下标），不改变数组物理顺序（storeIdx 保持稳定）
function getSortedStores() {
  const cfg = loadStoreConfig();
  return cfg.map((s, i) => ({ _idx: i, sort: (s.sort === undefined ? i : s.sort), s }))
           .sort((a, b) => a.sort - b.sort);
}
function getSortedStoreNames() {
  return getSortedStores().map(x => x.s.name);
}
function loadStoreNames() {
  return loadStoreConfig().map(s => s.name);
}
function saveStoreConfig(cfg) {
  localStorage.setItem(scopeKey(STORE_KEY), JSON.stringify(cfg));
  scheduleCloudBackup();
}
// 默认百度OCR密钥（应用：物流筐收发管理系统 / AppID 134982254 / 通用文字识别高精度版）— 已预置，本机开箱即用
const DEFAULT_OCR_KEYS = { apiKey: 'iswwim5FqTQx8jVSjtJaFaIa', secretKey: 'sh3ji9lbaBNunDyHJTRfkbdUrh4xCZuZ' };

// 本机 CORS 代理（同源，绕开浏览器跨域拦截；python proxy_server.py 提供）
const CORS_PROXY = (location.protocol === 'http:' || location.protocol === 'https:')
  ? '/proxy?url='
  : 'http://localhost:8080/proxy?url=';

function loadOcrKeys() {
  try {
    const raw = localStorage.getItem(OCR_KEY);
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return { apiKey: DEFAULT_OCR_KEYS.apiKey, secretKey: DEFAULT_OCR_KEYS.secretKey };
}
function saveOcrKeysStorage(keys) {
  localStorage.setItem(OCR_KEY, JSON.stringify(keys));
}

// 获取百度 OCR access_token（带缓存：token 有效期30天，缓存24小时，避免每次都请求）
async function getOcrAccessToken(apiKey, secretKey) {
  const cacheKey = 'kuanwei_ocr_token_' + String(apiKey).slice(-6);
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
    if (cached && cached.token && cached.expire > Date.now()) return cached.token;
  } catch(e) {}
  const tokenResp = await fetch(CORS_PROXY + encodeURIComponent('https://aip.baidubce.com/oauth/2.0/token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`
  });
  const tokenData = await tokenResp.json();
  if (!tokenData.access_token) throw new Error('获取token失败');
  try {
    localStorage.setItem(cacheKey, JSON.stringify({ token: tokenData.access_token, expire: Date.now() + 24 * 3600 * 1000 }));
  } catch(e) {}
  return tokenData.access_token;
}

// ======== 云备份（Cloudflare KV） ========
function getDeviceId() {
  let id = localStorage.getItem('kuanwei_device_id');
  if (!id) {
    id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('kuanwei_device_id', id);
  }
  return id;
}

let backupTimer = null;
function scheduleCloudBackup() {
  if (backupTimer) clearTimeout(backupTimer);
  backupTimer = setTimeout(backupToCloud, 1000); // 保存后1秒自动备份（防抖）
}

// 定时兜底备份：无操作时每30分钟自动备份一次（后台静默，零干扰）
let periodicBackupTimer = null;
function startPeriodicBackup() {
  if (periodicBackupTimer) return;
  // 启动后先不立即备份，等第一个30分钟周期
  periodicBackupTimer = setInterval(() => {
    // 仅已登录或有数据时备份，避免打扰
    if (localStorage.getItem('kuanwei_phone')) {
      backupToCloud(false);
    }
  }, 30 * 60 * 1000); // 30分钟
}

async function backupToCloud(manual) {
  try {
    const deviceId = getDeviceId();
    const account = localStorage.getItem('kuanwei_phone') || '';
    const payload = {
      deviceId: deviceId,
      data: {
        version: 2,
        backupTime: new Date().toISOString(),
        records: loadData(),
        goodsConfig: loadGoodsConfig(),
        storeConfig: loadStoreConfig(),
        uiState: collectUiState()
      }
    };
    if (account) payload.account = account;
    const resp = await fetch('/backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await resp.json();
    if (result && result.ok) {
      localStorage.setItem('kuanwei_last_backup', new Date().toISOString());
      if (manual) {
        showToast('✅ 已备份到云端');
        renderCloudBackupStatus();
      }
    } else if (manual) {
      showToast('❌ 备份失败，请检查网络');
    }
  } catch (e) {
    if (manual) showToast('❌ 备份失败，请检查网络');
  }
}

// ======== 用户界面状态收集/还原（换设备无陌生感） ========
const UI_KEYS = [
  'kuanwei_daily_pref',        // 日报偏好（线路/门店/信息项）
  'kuanwei_welcome_seen',      // 欢迎引导已看
  'kuanwei_seen_backup_tutorial', // 备份教程已看
  'kuanwei_del_confirm_until', // 删除确认免提示
  'kuanwei_ocr_keys',          // OCR 自定义密钥
  'kuanwei_theme',             // 深色模式偏好
];

// ======== 深色模式 ========
function applyTheme(theme) {
  const html = document.documentElement;
  const btn = document.getElementById('themeToggle');
  if (theme === 'dark') {
    html.setAttribute('data-theme', 'dark');
    if (btn) btn.textContent = '☀️';
  } else {
    html.removeAttribute('data-theme');
    if (btn) btn.textContent = '🌙';
  }
}
function loadTheme() {
  const saved = localStorage.getItem('kuanwei_theme');
  if (saved === 'dark') return 'dark';
  // 未设置时跟随系统
  if (saved === null && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  localStorage.setItem('kuanwei_theme', cur);
  applyTheme(cur);
  showToast(cur === 'dark' ? '🌙 已切换为深色模式' : '☀️ 已切换为浅色模式');
}
function initTheme() { applyTheme(loadTheme()); }

// ======== 离线检测 ========
// 离线时显示提示条，联网后自动隐藏；离线不阻断本地录入（数据自动存本机，联网后台备份）
function updateOfflineBanner() {
  const el = document.getElementById('offlineBanner');
  if (!el) return;
  el.style.display = navigator.onLine ? 'none' : 'block';
}
function initOffline() {
  updateOfflineBanner();
  window.addEventListener('online', () => {
    updateOfflineBanner();
    showToast('📡 已恢复网络，正在同步…');
    // 联网后尝试后台备份当前数据
    if (getCloudPhone()) backupToCloud(false);
    renderTodayStatus();
  });
  window.addEventListener('offline', () => {
    updateOfflineBanner();
    showToast('📡 当前离线，数据已存本机，联网后自动同步');
  });
}
function collectUiState() {
  const ui = {};
  for (const k of UI_KEYS) {
    try { const v = localStorage.getItem(k); if (v !== null && v !== undefined) ui[k] = v; } catch(e) {}
  }
  // 每日相册照片（当天+昨天），便于换设备后照片不丢
  try {
    const photos = {};
    for (let i = 0; i < 2; i++) {
      const d = new Date(Date.now() - i * 86400000);
      const key = 'kuanwei_photos_' + d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
      const v = localStorage.getItem(key);
      if (v) photos[key] = v;
    }
    ui._photos = photos;
  } catch(e) {}
  return ui;
}
function applyUiState(ui) {
  if (!ui || typeof ui !== 'object') return;
  for (const k of Object.keys(ui)) {
    if (k === '_photos') continue;
    try {
      const v = ui[k];
      if (v === null || v === undefined) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch(e) {}
  }
  // 还原相册照片
  if (ui._photos) {
    try {
      for (const k of Object.keys(ui._photos)) {
        if (!localStorage.getItem(k)) localStorage.setItem(k, ui._photos[k]);
      }
    } catch(e) {}
  }
}

// ======== 密码账号体系 ========
function getCloudPhone() { return localStorage.getItem('kuanwei_phone') || ''; }
function setCloudPhone(phone) { if (phone) localStorage.setItem('kuanwei_phone', phone); else localStorage.removeItem('kuanwei_phone'); }

// 手机号格式校验
function validatePhone(p) {
  return /^1\d{10}$/.test(p);
}
// 密码强度：≥8位，含字母+数字+符号
function validatePassword(p) {
  return p.length >= 8 && /[a-zA-Z]/.test(p) && /\d/.test(p) && /[^a-zA-Z0-9]/.test(p);
}

// 登录失败锁定（输错5次锁10分钟）
function checkLock(phone) {
  // 【测试阶段】暂时取消连续错误锁定限制，后续需恢复
  return 0;
}
function recordFail(phone) {
  // 【测试阶段】暂时取消连续错误锁定限制，后续需恢复
}
function clearLock(phone) {
  const rec = JSON.parse(localStorage.getItem('kuanwei_lock') || '{}');
  delete rec[phone];
  localStorage.setItem('kuanwei_lock', JSON.stringify(rec));
}

// 账号标识徽标（首页顶部，显示当前数据归属账号，明确多账号隔离）
// 手机号脱敏：中间4位用星号（155****8023）
function maskPhone(p) {
  if (!p || p.length < 7) return p || '';
  return p.slice(0, 3) + '****' + p.slice(7);
}

// 渲染首页角落登录状态胶囊（顶部已用胶囊显示账号，无需额外徽标）
function renderAccountBadge() {
  const pill = document.getElementById('loginPill');
  if (pill) {
    const phone = getCloudPhone();
    const logged = isLoggedIn();
    if (phone && logged) {
      pill.textContent = '👤 ' + maskPhone(phone);
      pill.classList.add('logged-in');
    } else {
      pill.textContent = '🔑 登录';
      pill.classList.remove('logged-in');
    }
  }
  updateLoginLock();
}

// 未登录锁定：显示提醒横条 + 禁用录入/保存控件；登录后恢复
function updateLoginLock() {
  const notice = document.getElementById('loginNotice');
  if (notice) notice.style.display = isLoggedIn() ? 'none' : '';
  // 需要登录才能操作的元素 id 列表（未登录时禁用+半透明）
  const lockIds = [
    'goodsInputList',           // 手动录入筐输入区
    'recordStoreChips',         // 店面选择
    'recordDate',               // 日期选择
    'extraGoodsList',           // 额外发收
  ];
  const logged = isLoggedIn();
  lockIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('locked-input', !logged);
  });
  // 锁定手动录入/快捷录入相关按钮（用 onclick 属性包含匹配，规避引号嵌套问题）
  const lockOnclick = ['saveManualRecord()', 'openExtraModal()', 'openVoiceInputModal()', 'openPhotoInputModal()', 'manualEntry('];
  document.querySelectorAll('[onclick]').forEach(btn => {
    const oc = btn.getAttribute('onclick') || '';
    if (lockOnclick.some(k => oc.indexOf(k) >= 0)) btn.classList.toggle('locked-input', !logged);
  });
}

// ======== 账号操作菜单（点击角落登录胶囊弹出） ========
function closeAccountMenu() {
  const m = document.getElementById('accountMenu');
  if (m) m.remove();
}
function toggleAccountMenu(e) {
  e.stopPropagation();
  const existing = document.getElementById('accountMenu');
  if (existing) { existing.remove(); return; }
  const phone = getCloudPhone();
  const logged = isLoggedIn();
  const rect = document.getElementById('loginPill').getBoundingClientRect();
  const menu = document.createElement('div');
  menu.id = 'accountMenu';
  menu.className = 'account-menu';
  let html = `<div class="am-head">${phone && logged ? '👤 当前账号：' + maskPhone(phone) : '账号管理'}</div>`;
  if (!logged) {
    html += `<div class="am-item" onclick="openLoginModal();closeAccountMenu()">🔐 登录账号</div>`;
    html += `<div class="am-item" onclick="openSetupModal();closeAccountMenu()">🔑 设置账号密码</div>`;
  } else {
    html += `<div class="am-item" onclick="openLoginModal();closeAccountMenu()">🔄 切换用户</div>`;
    html += `<div class="am-item" onclick="openChangePwdModal();closeAccountMenu()">✏️ 更改密码</div>`;
    html += `<div class="am-item" onclick="logout();closeAccountMenu()">🚪 退出登录</div>`;
    html += `<div class="am-item danger" onclick="openDeleteAccountModal();closeAccountMenu()">🗑️ 注销账号</div>`;
  }
  menu.innerHTML = html;
  menu.style.top = (rect.bottom + 6) + 'px';
  menu.style.left = Math.max(8, rect.left) + 'px';
  document.body.appendChild(menu);
  // 点击别处关闭
  setTimeout(() => {
    document.addEventListener('click', function handler(ev) {
      if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', handler); }
    });
  }, 0);
}

// 账号状态渲染
function renderAccountStatus() {
  const el = document.getElementById('accountStatus');
  if (!el) return;
  const phone = getCloudPhone();
  const logged = isLoggedIn();
  if (!phone) {
    // 从未设置过：显示注册 + 登录入口
    el.innerHTML = `
      <div style="background:#fff8e1;border:1.5px solid #ffe082;border-radius:10px;padding:12px;">
        <div style="font-weight:600;font-size:14px;color:#b45309;margin-bottom:4px;">🔑 账号（未设置）</div>
        <div style="font-size:12px;color:var(--text-light);margin-bottom:8px;">设置密码后，换手机/清缓存输入手机号+密码即可恢复数据（当前使用设备自动备份）</div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-primary" style="flex:1;padding:10px;" onclick="openSetupModal()">🔑 设置账号密码</button>
          <button class="btn btn-outline" style="flex:1;padding:10px;" onclick="openLoginModal()">🔐 登录</button>
        </div>
      </div>`;
    return;
  }
  // 有手机号（设置过密码）
  // 退出登录/更改密码已整合到首页登录胶囊菜单，此处只保留核心操作
  el.innerHTML = `
    <div style="background:${logged ? '#f0fdf4' : '#fff8e1'};border:1.5px solid ${logged ? '#bbf7d0' : '#ffe082'};border-radius:10px;padding:12px;">
      <div style="font-weight:600;font-size:14px;color:${logged ? '#15803d' : '#b45309'};margin-bottom:4px;">🔑 账号${logged ? '（已登录）' : '（未登录）'}</div>
      <div style="font-size:13px;margin-bottom:8px;">📱 ${maskPhone(phone)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">
        ${logged
          ? `<button class="btn btn-outline" style="flex:1;min-width:100px;padding:9px;font-size:13px;" onclick="openVerifyModal()">📥 恢复数据</button>
             <button class="btn btn-outline" style="flex:1;min-width:100px;padding:9px;font-size:13px;" onclick="openForgotModal()">🔐 切换/登录</button>`
          : `<button class="btn btn-primary" style="flex:1;min-width:100px;padding:9px;font-size:13px;" onclick="openLoginModal()">🔐 登录</button>
             <button class="btn btn-outline" style="flex:1;min-width:100px;padding:9px;font-size:13px;" onclick="openForgotModal()">❓ 忘记密码</button>`}
      </div>
      <div style="font-size:11px;color:var(--text-light);margin-top:8px;">更改密码 / 退出登录 / 注销账号，请到首页左上角账号菜单操作</div>
    </div>`;
}

// 密码框显示/隐藏切换
function togglePwd(id) {
  const el = document.getElementById(id); const btn = document.getElementById(id + '_eye');
  if (!el || !btn) return;
  if (el.type === 'password') { el.type = 'text'; btn.textContent = '🙈'; } else { el.type = 'password'; btn.textContent = '👁'; }
}

// ======== 登录 / 登出 ========
function isLoggedIn() {
  try { return localStorage.getItem('kuanwei_logged_in') === '1'; } catch(e) { return false; }
}
function setLoggedIn(v) {
  try { localStorage.setItem('kuanwei_logged_in', v ? '1' : '0'); } catch(e) {}
}
function openLoginModal() { document.getElementById('loginModal').classList.add('show'); }
function closeLoginModal() { document.getElementById('loginModal').classList.remove('show'); }

// ======== 密码调试日志（测试期用，帮助定位"密码错误"根因） ========
// 打印前端实际发送的手机号/密码 + 后端返回 + 云端该账号密码对比
function pwdDebug(action, payload, resp, note) {
  try {
    const log = {
      action,
      time: new Date().toISOString(),
      sentPhone: payload ? payload.phone : null,
      sentPassword: payload ? (payload.password !== undefined ? payload.password : payload.passwordHash) : null,
      respOk: resp ? resp.ok : null,
      respError: resp ? resp.error : null,
      note: note || ''
    };
    console.log('【密码调试】' + JSON.stringify(log));
  } catch (e) {}
}
// 登录失败时：查云端该账号明文密码，对比用户输入，定位是否不一致
async function pwdCompareCloud(phone, sentPassword) {
  try {
    const r = await fetch('/admin/stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminKey: '8023.520' })
    });
    const res = await r.json();
    const u = (res.users || []).find(x => x.phone === phone);
    if (!u) { console.log('【密码调试】云端无此账号: ' + phone); return; }
    console.log('【密码调试】对比: 前端发送=[' + sentPassword + '] | 云端密码=[' + u.password + '] | 一致=' + (u.password === sentPassword));
  } catch (e) { console.log('【密码调试】查云端失败: ' + e.message); }
}
async function doLogin() {
  const phone = document.getElementById('loginPhone').value.trim();
  const pwd = document.getElementById('loginPwd').value;
  if (!validatePhone(phone)) { showToast('请输入正确的11位手机号'); return; }
  const locked = checkLock(phone);
  if (locked > 0) { showToast('尝试次数过多，请 ' + locked + ' 分钟后再试'); return; }
  showLoading('正在登录…');
  const sentBody = { phone, password: pwd, deviceId: getDeviceId() };
  pwdDebug('登录', sentBody, null, '前端即将发送'); // 调试：打印实际发送的手机号/密码
  try {
    const resp = await fetch('/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sentBody)
    });
    const result = await resp.json();
    hideLoading();
    pwdDebug('登录', sentBody, result, '后端返回');
    if (!(result.ok && result.data)) {
      // 失败：对比云端密码，定位是否不一致
      pwdCompareCloud(phone, pwd);
    }
    if (result.ok && result.data) {
      clearLock(phone);
      setCloudPhone(phone);
      migrateDataToScope(); // 首次登录：旧全局数据迁入该账号作用域
      setLoggedIn(true);
      closeLoginModal();
      renderAccountStatus();
      renderCloudBackupStatus();
      renderAccountBadge();
      showToast('✅ 登录成功，正在同步数据…');
      refreshRecordViews(); // 登录后无条件刷新，避免切换账号时界面残留上一账号数据
      // 自动同步云端数据
      autoSyncFromCloud(phone).then(hasCloud => {
        if (hasCloud) { showToast('✅ 已同步云端数据'); refreshRecordViews(); }
      });
    } else {
      recordFail(phone);
      showToast(result.error || '登录失败');
    }
  } catch (e) { hideLoading(); showToast('❌ 网络错误'); }
}
function logout() {
  // 退出前先备份当前账号数据到云端，避免丢失
  const phone = getCloudPhone();
  if (phone) backupToCloud(false);
  setLoggedIn(false);
  // 清除账号作用域，避免退出后数据仍写入旧账号隔离空间
  setCloudPhone('');
  renderAccountStatus();
  renderAccountBadge();
  renderCloudBackupStatus();
  refreshRecordViews(); // 刷新数据视图，避免退出后界面残留旧账号数据
  showToast('已退出登录，数据已隔离');
}

// ======== 账号注销（两步确认 + 后悔药 + 软删除可恢复） ========
function openDeleteAccountModal() {
  document.getElementById('deleteStep1').style.display = '';
  document.getElementById('deleteStep2').style.display = 'none';
  document.getElementById('deleteSuccess').style.display = 'none';
  document.getElementById('deleteRegret').style.display = 'none';
  document.getElementById('delPhoneLabel').textContent = maskPhone(getCloudPhone());
  document.getElementById('delPwd').value = '';
  document.getElementById('deleteAccountModal').classList.add('show');
}
function closeDeleteAccountModal() { document.getElementById('deleteAccountModal').classList.remove('show'); }
function goDeleteStep2() {
  document.getElementById('deleteStep1').style.display = 'none';
  document.getElementById('deleteStep2').style.display = '';
}
function showDeleteRegret() {
  document.getElementById('deleteStep2').style.display = 'none';
  document.getElementById('deleteSuccess').style.display = 'none';
  document.getElementById('deleteRegret').style.display = '';
}
async function doDeleteAccount() {
  const phone = getCloudPhone();
  const pwd = document.getElementById('delPwd').value;
  if (!phone || !isLoggedIn()) { showToast('请先登录'); closeDeleteAccountModal(); return; }
  if (!pwd) { showToast('请输入密码确认注销'); return; }
  showLoading('正在注销…');
  const delVerifyBody = { phone, password: pwd };
  const delBody = { phone, password: pwd, deviceId: getDeviceId() };
  pwdDebug('注销-校验密码', delVerifyBody, null, '前端即将发送');
  try {
    // 1. 校验密码（绝对禁止无密码注销）
    const verifyResp = await fetch('/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(delVerifyBody)
    });
    const verifyResult = await verifyResp.json();
    pwdDebug('注销-校验密码', delVerifyBody, verifyResult, '后端返回');
    if (!verifyResult.ok) { hideLoading(); pwdCompareCloud(phone, pwd); showToast('密码错误，无法注销'); return; }
    // 2. 调用后端软注销：释放手机号 + 数据冻结 + 生成临时代码（供管理员恢复）
    const delResp = await fetch('/auth/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(delBody)
    });
    const delResult = await delResp.json();
    pwdDebug('注销-执行注销', delBody, delResult, '后端返回');
    hideLoading();
    if (delResult && delResult.ok) {
      // 3. 清空本地该账号数据 + 退出登录
      setLoggedIn(false);
      setCloudPhone('');
      removeLocalAccountData(phone);
      renderAccountStatus();
      renderAccountBadge();
      document.getElementById('deleteStep2').style.display = 'none';
      document.getElementById('deleteSuccess').style.display = '';
      showToast('✅ 账号已注销');
    } else {
      showToast(delResult.error || '注销失败，请稍后再试');
    }
  } catch (e) { hideLoading(); showToast('❌ 网络错误，请稍后再试'); }
}
// 注销后清除本地该账号隔离数据
function removeLocalAccountData(phone) {
  try {
    for (const base of ['kuanwei_inventory_data', 'kuanwei_goods_names', 'kuanwei_stores']) {
      localStorage.removeItem(base + '__' + phone);
    }
  } catch(e) {}
}

// 设置密码
function openSetupModal() { document.getElementById('setupModal').classList.add('show'); }
function closeSetupModal() { document.getElementById('setupModal').classList.remove('show'); }
async function doSetupAccount() {
  const phone = document.getElementById('setupPhone').value.trim();
  const pwd = document.getElementById('setupPwd').value;
  const pwd2 = document.getElementById('setupPwd2').value;
  const secQ = document.getElementById('setupSecQ').value;
  const secA = document.getElementById('setupSecA').value.trim();
  if (!validatePhone(phone)) { showToast('请输入正确的11位手机号'); return; }
  if (!validatePassword(pwd)) { showToast('密码需≥8位，含字母+数字+符号'); return; }
  if (pwd !== pwd2) { showToast('两次密码不一致'); return; }
  if (!secA) { showToast('请填写密保答案'); return; }
  showLoading('正在设置…');
  const setupBody = { phone, password: pwd, securityQ: secQ, securityA: secA, deviceId: getDeviceId() };
  pwdDebug('设置账号', setupBody, null, '前端即将发送');
  try {
    const resp = await fetch('/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(setupBody)
    });
    const result = await resp.json();
    pwdDebug('设置账号', setupBody, result, '后端返回');
    hideLoading();
    if (result.ok) {
      setCloudPhone(phone);
      migrateDataToScope(); // 旧全局数据迁入该账号作用域
      closeSetupModal();
      renderAccountStatus();
      renderCloudBackupStatus();
      renderAccountBadge();
      setLoggedIn(true);
      refreshRecordViews(); // 设置账号后刷新数据视图
      showToast('✅ 密码设置成功');
      // 登录成功 → 自动同步云端该账号数据（换手机场景：把旧手机的数据拉回来）
      autoSyncFromCloud(phone).then(hasCloud => {
        if (hasCloud) {
          showToast('✅ 已同步云端数据');
          renderAccountStatus();
          renderCloudBackupStatus();
          renderTodayOverview();
        }
        backupToCloud(true);
      }).catch(() => backupToCloud(true));
    } else {
      showToast(result.error || '设置失败');
    }
  } catch (e) { hideLoading(); console.error('SETUP_ERROR:', e && (e.stack || e.message)); showToast('❌ 网络错误'); }
}

// 恢复数据
function openVerifyModal() {
  // 按需求：绝对禁止无密码登录/恢复，一律走密码验证
  document.getElementById('verifyModal').classList.add('show');
}
function closeVerifyModal() { document.getElementById('verifyModal').classList.remove('show'); }
// 已登录用户免密恢复：直接拉取该账号云端数据（含用户界面偏好，换设备无陌生感）
async function restoreLoggedIn(phone) {
  showLoading('正在恢复…');
  try {
    const resp = await fetch('/backup?account=' + encodeURIComponent(phone));
    const result = await resp.json();
    hideLoading();
    if (result.data) {
      const cloud = result.data;
      saveDataArr(cloud.records || []);
      if (cloud.goodsConfig && Array.isArray(cloud.goodsConfig)) saveGoodsConfig(cloud.goodsConfig);
      if (cloud.storeConfig && Array.isArray(cloud.storeConfig)) saveStoreConfig(cloud.storeConfig);
      if (cloud.uiState) applyUiState(cloud.uiState); // 还原界面偏好/相册
      renderAccountStatus();
      renderCloudBackupStatus();
      refreshRecordViews();
      showToast('✅ 已恢复云端数据');
    } else {
      showToast('云端暂无数据或恢复失败');
    }
  } catch (e) {
    hideLoading();
    showToast('❌ 恢复失败，请检查网络');
  }
}
async function doVerifyAccount() {
  const phone = document.getElementById('verifyPhone').value.trim();
  const pwd = document.getElementById('verifyPwd').value;
  if (!validatePhone(phone)) { showToast('请输入正确的11位手机号'); return; }
  const locked = checkLock(phone);
  if (locked > 0) { showToast('尝试次数过多，请 ' + locked + ' 分钟后再试'); return; }
  showLoading('正在验证…');
  const vfBody = { phone, password: pwd, deviceId: getDeviceId() };
  pwdDebug('恢复数据-验证', vfBody, null, '前端即将发送');
  try {
    const resp = await fetch('/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(vfBody)
    });
    const result = await resp.json();
    pwdDebug('恢复数据-验证', vfBody, result, '后端返回');
    hideLoading();
    if (!(result.ok && result.data)) { pwdCompareCloud(phone, pwd); }
    if (result.ok && result.data) {
      clearLock(phone);
      const cloud = result.data;
      setCloudPhone(phone);      // 先切换账号作用域，再写入该账号数据
      migrateDataToScope();
      setLoggedIn(true);
      saveDataArr(cloud.records || []);
      if (cloud.goodsConfig && Array.isArray(cloud.goodsConfig)) saveGoodsConfig(cloud.goodsConfig);
      if (cloud.storeConfig && Array.isArray(cloud.storeConfig)) saveStoreConfig(cloud.storeConfig);
      closeVerifyModal();
      renderAccountStatus();
      renderCloudBackupStatus();
      renderAccountBadge();
      refreshRecordViews();
      showToast('✅ 已恢复 ' + (cloud.records || []).length + ' 条记录');
    } else {
      recordFail(phone);
      showToast(result.error || '验证失败');
    }
  } catch (e) { hideLoading(); showToast('❌ 网络错误'); }
}

// 更改密码
function openChangePwdModal() { document.getElementById('changePwdModal').classList.add('show'); }
function closeChangePwdModal() { document.getElementById('changePwdModal').classList.remove('show'); }
async function doChangePwd() {
  const phone = document.getElementById('cpPhone').value.trim();
  const oldPwd = document.getElementById('cpOldPwd').value;
  const newPwd = document.getElementById('cpNewPwd').value;
  const newPwd2 = document.getElementById('cpNewPwd2').value;
  if (!validatePhone(phone)) { showToast('请输入正确的11位手机号'); return; }
  if (!validatePassword(newPwd)) { showToast('新密码需≥8位，含字母+数字+符号'); return; }
  if (newPwd !== newPwd2) { showToast('两次新密码不一致'); return; }
  showLoading('正在修改…');
  const chgVerifyBody = { phone, password: oldPwd };
  const chgSetupBody = { phone, password: newPwd };
  pwdDebug('改密-校验原密码', chgVerifyBody, null, '前端即将发送');
  try {
    // 1. 校验原密码（明文）
    const verifyResp = await fetch('/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chgVerifyBody)
    });
    const verifyResult = await verifyResp.json();
    pwdDebug('改密-校验原密码', chgVerifyBody, verifyResult, '后端返回');
    if (!verifyResult.ok) {
      hideLoading();
      pwdCompareCloud(phone, oldPwd); // 失败：对比云端密码
      showToast(verifyResult.error || '原密码错误');
      return;
    }
    // 2. 更新为新密码（保留数据）
    const secQ = verifyResult.data && verifyResult.data.securityQ ? verifyResult.data.securityQ : '';
    const secA = verifyResult.data && verifyResult.data.securityA ? verifyResult.data.securityA : '';
    const setupResp = await fetch('/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password: newPwd, securityQ: secQ, securityA: secA })
    });
    const setupResult = await setupResp.json();
    pwdDebug('改密-设置新密码', chgSetupBody, setupResult, '后端返回');
    hideLoading();
    if (setupResult.ok) {
      setCloudPhone(phone);
      closeChangePwdModal();
      showToast('✅ 密码已更改');
    } else {
      showToast(setupResult.error || '更改失败');
    }
  } catch (e) { hideLoading(); showToast('❌ 网络错误'); }
}

// 忘记密码
function openForgotModal() { document.getElementById('forgotModal').classList.add('show'); }
function closeForgotModal() { document.getElementById('forgotModal').classList.remove('show'); }
async function doForgotReset() {
  const phone = document.getElementById('fgPhone').value.trim();
  const secA = document.getElementById('fgSecA').value.trim().toLowerCase();
  const newPwd = document.getElementById('fgNewPwd').value;
  const newPwd2 = document.getElementById('fgNewPwd2').value;
  if (!validatePhone(phone)) { showToast('请输入正确的11位手机号'); return; }
  if (!secA) { showToast('请输入密保答案'); return; }
  if (!validatePassword(newPwd)) { showToast('新密码需≥8位，含字母+数字+符号'); return; }
  if (newPwd !== newPwd2) { showToast('两次新密码不一致'); return; }
  const locked = checkLock(phone);
  if (locked > 0) { showToast('尝试次数过多，请 ' + locked + ' 分钟后再试'); return; }
  showLoading('正在重置…');
  const fgResetBody = { phone, securityA: secA, password: newPwd };
  pwdDebug('忘记密码-重置', fgResetBody, null, '前端即将发送');
  try {
    const resp = await fetch('/auth/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fgResetBody)
    });
    const result = await resp.json();
    pwdDebug('忘记密码-重置', fgResetBody, result, '后端返回');
    hideLoading();
    if (result.ok) {
      clearLock(phone);
      setCloudPhone(phone);
      closeForgotModal();
      renderAccountStatus();
      setLoggedIn(true);
      showToast('✅ 密码已重置，正在同步数据…');
      // 登录成功 → 自动同步云端该账号数据
      autoSyncFromCloud(phone).then(hasCloud => {
        if (hasCloud) {
          showToast('✅ 已同步云端数据');
          renderTodayOverview();
        } else {
          showToast('✅ 密码已重置，请用新密码登录');
        }
      });
    } else {
      recordFail(phone);
      showToast(result.error || '重置失败');
    }
  } catch (e) { hideLoading(); showToast('❌ 网络错误'); }
}

// 管理员
let adminUsers = [];
let adminKey = ''; // 验证通过后保存的管理员密码，供面板内操作使用（无需二次输入）
function openAdminAuthModal() { document.getElementById('adminAuthModal').classList.add('show'); document.getElementById('adminAuthErr').style.display = 'none'; }
function closeAdminAuthModal() { document.getElementById('adminAuthModal').classList.remove('show'); }
function doAdminAuth() {
  const pwd = document.getElementById('adminAuthPwd').value;
  if (pwd === '8023.520') {
    adminKey = pwd;
    document.getElementById('adminAuthPwd').value = '';
    closeAdminAuthModal();
    openAdminModal();
  } else {
    document.getElementById('adminAuthErr').style.display = 'block';
  }
}
function openAdminModal() { document.getElementById('adminModal').classList.add('show'); loadAdminStats(); }
function closeAdminModal() { document.getElementById('adminModal').classList.remove('show'); }
// 管理员统计：注册人数 + 用户列表
async function loadAdminStats() {
  if (!adminKey) return;
  try {
    const resp = await fetch('/admin/stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminKey })
    });
    const result = await resp.json();
    const el = document.getElementById('adminUserCount');
    if (result.ok) {
      if (el) el.textContent = result.count;
      adminUsers = result.users || [];
      renderAdminUsers();
      adminPending = result.pendingDelete || [];
      renderAdminPending();
    } else {
      if (el) el.textContent = '-';
    }
  } catch (e) {
    const el = document.getElementById('adminUserCount');
    if (el) el.textContent = '-';
  }
}
let adminPending = []; // 已注销待恢复账号列表
// 渲染待恢复的注销账号
function renderAdminPending() {
  const box = document.getElementById('adminPendingList');
  if (!box) return;
  if (adminPending.length === 0) {
    box.innerHTML = '<div style="color:var(--text-light);text-align:center;padding:10px;">暂无已注销账号</div>';
    return;
  }
  box.innerHTML = adminPending.map(p => `
    <div style="border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:6px;background:var(--soft-bg);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="font-weight:700;color:var(--primary);">${p.code}</span>
        <span style="font-size:11px;color:var(--text-light);">📱 ${maskPhone(p.originalPhone)}</span>
      </div>
      <div style="font-size:11px;color:var(--text-light);margin-bottom:6px;">原手机号 ${p.originalPhone} · 注销于 ${(p.deletedAt||'').slice(0,10)}</div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-success" style="flex:1;padding:6px;font-size:12px;width:auto;" onclick="adminRestore('${p.code}','${p.originalPhone}')">♻️ 恢复</button>
        <button class="btn btn-danger" style="flex:1;padding:6px;font-size:12px;width:auto;" onclick="adminDeleteTemp('${p.code}')">🗑️ 彻底删除</button>
      </div>
    </div>`).join('');
}
// 管理员恢复注销账号：把临时代码数据绑定到新手机号
function adminRestore(code, origPhone) {
  if (!adminKey) { showToast('请先验证管理员密码'); return; }
  const newPhone = prompt('将把 ' + origPhone + ' 的数据恢复到哪个手机号？（输入新手机号）');
  if (!newPhone) return;
  if (!validatePhone(newPhone)) { showToast('请输入正确的11位手机号'); return; }
  showLoading('正在恢复…');
  fetch('/admin/restore-account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminKey, code, newPhone })
  }).then(r => r.json()).then(res => {
    hideLoading();
    if (res.ok) { showToast('✅ ' + res.message); loadAdminStats(); }
    else showToast(res.error || '恢复失败');
  }).catch(() => { hideLoading(); showToast('❌ 网络错误'); });
}
// 管理员彻底删除注销账号（不可恢复）
function adminDeleteTemp(code) {
  if (!adminKey) { showToast('请先验证管理员密码'); return; }
  if (!confirm('⚠️ 确认彻底删除该注销账号的所有数据？\n此操作不可恢复！')) return;
  showLoading('正在删除…');
  fetch('/admin/delete-temp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminKey, code })
  }).then(r => r.json()).then(res => {
    hideLoading();
    if (res.ok) { showToast('✅ ' + res.message); loadAdminStats(); }
    else showToast(res.error || '删除失败');
  }).catch(() => { hideLoading(); showToast('❌ 网络错误'); });
}
// 渲染用户列表（按搜索框过滤手机号或密码）
function renderAdminUsers() {
  const box = document.getElementById('adminUserList');
  if (!box) return;
  const kw = (document.getElementById('adminSearch').value || '').trim().toLowerCase();
  const list = adminUsers.filter(u => !kw || (u.phone || '').includes(kw) || (u.password || '').toLowerCase().includes(kw));
  if (list.length === 0) {
    box.innerHTML = '<div style="color:var(--text-light);text-align:center;padding:10px;">暂无用户</div>';
    return;
  }
  box.innerHTML = list.map(u => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;background:#f8fafc;">
      <span style="font-weight:600;color:var(--text);">📱 ${u.phone || '-'}</span>
      <span style="color:var(--text-light);font-family:monospace;">${u.password ? '🔒 ' + u.password : '<i>未存明文</i>'}</span>
    </div>`).join('');
}
async function doAdminReset() {
  const phone = document.getElementById('adminPhone').value.trim();
  if (!adminKey) { showToast('请先验证管理员密码'); return; }
  if (!validatePhone(phone)) { showToast('请输入正确的11位手机号'); return; }
  showLoading('正在重置…');
  const admResetBody = { adminKey, phone, password: '12345678' };
  pwdDebug('管理员重置', admResetBody, null, '前端即将发送');
  try {
    const resp = await fetch('/admin/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(admResetBody)
    });
    const result = await resp.json();
    pwdDebug('管理员重置', admResetBody, result, '后端返回');
    hideLoading();
    if (result.ok) {
      showToast('✅ 已重置 ' + phone + ' 的密码为 12345678');
    } else {
      showToast(result.error || '重置失败');
    }
  } catch (e) { hideLoading(); showToast('❌ 网络错误'); }
}

// 从云账号恢复（换手机时用）
// 管理员隐藏入口：使用说明页 ❓ 连点5次 → 弹密码验证框
let adminTapCount = 0;
let adminTapTimer = null;
function adminTap() {
  adminTapCount++;
  if (adminTapTimer) clearTimeout(adminTapTimer);
  adminTapTimer = setTimeout(() => { adminTapCount = 0; }, 3000);
  if (adminTapCount >= 5) {
    adminTapCount = 0;
    openAdminAuthModal();
  }
}

// 渲染云备份状态
// 登录成功后自动从云端拉取该账号最新数据（合并到本地，不丢本地记录）
async function autoSyncFromCloud(phone) {
  try {
    const resp = await fetch('/backup?account=' + encodeURIComponent(phone));
    const result = await resp.json();
    if (!(result && result.data && result.data.records)) return false;
    const cloud = result.data;
    // 合并：按 日期+店面+筐 去重（云端优先，因为登录时云端是最新的）
    const local = loadData();
    const byKey = new Map();
    local.forEach(r => byKey.set(String(r.date) + '|' + r.storeIdx + '|' + r.goodsIdx, r));
    (cloud.records || []).forEach(r => byKey.set(String(r.date) + '|' + r.storeIdx + '|' + r.goodsIdx, r));
    saveDataArr([...byKey.values()]);
    if (cloud.goodsConfig && Array.isArray(cloud.goodsConfig)) saveGoodsConfig(cloud.goodsConfig);
    if (cloud.storeConfig && Array.isArray(cloud.storeConfig)) saveStoreConfig(cloud.storeConfig);
    if (cloud.uiState) applyUiState(cloud.uiState); // 还原界面偏好/相册
    refreshRecordViews();
    return true;
  } catch(e) { return false; }
}

function renderCloudBackupStatus() {
  const el = document.getElementById('cloudBackupStatus');
  if (!el) return;
  const last = localStorage.getItem('kuanwei_last_backup');
  const deviceId = localStorage.getItem('kuanwei_device_id') || '未生成';
  let timeText = '从未备份';
  if (last) {
    try {
      const d = new Date(last);
      timeText = `${d.getMonth()+1}月${d.getDate()}日 ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    } catch(e) {}
  }
  const account = getCloudPhone() || '';
  el.innerHTML = `
    <div style="background:#f0f7ff;border:1.5px solid #bfdbfe;border-radius:10px;padding:12px;margin-bottom:12px;">
      <div style="font-weight:600;font-size:14px;color:var(--primary-dark);margin-bottom:6px;">☁️ 云备份状态</div>
      <div style="font-size:13px;line-height:1.8;color:var(--text);">
        <div>🕐 上次备份：<b>${timeText}</b></div>
        ${account ? `<div>🔗 云账号：<b>${account}</b></div>` : ''}
        <div style="font-size:11px;color:var(--text-light);margin-top:2px;">设备ID：${deviceId.slice(0,14)}…</div>
      </div>
      <div style="font-size:11px;color:var(--success);margin-top:6px;">✓ 保存数据后自动备份到云端，清缓存/换手机可恢复</div>
    </div>`;
}

async function restoreFromCloud() {
  try {
    const deviceId = getDeviceId();
    const resp = await fetch('/backup?deviceId=' + deviceId);
    const result = await resp.json();
    if (result && result.data && result.data.records) {
      const cloud = result.data;
      const localRecords = loadData();
      const localEmpty = localRecords.length === 0;
      const cloudNewer = !localStorage.getItem('kuanwei_last_save') ||
        (cloud.backupTime && cloud.backupTime > localStorage.getItem('kuanwei_last_save'));
      // 本地为空 或 云端比本地新 → 从云端恢复
      if (localEmpty || cloudNewer) {
        saveDataArr(cloud.records || []);
        if (cloud.goodsConfig && Array.isArray(cloud.goodsConfig)) saveGoodsConfig(cloud.goodsConfig);
        if (cloud.storeConfig && Array.isArray(cloud.storeConfig)) saveStoreConfig(cloud.storeConfig);
        // 刷新界面
        try {
          initStoreSelect('recordStore');
          renderStoreChips();
          renderGoodsInputList();
          initGoodsFilter();
          renderTodayOverview();
        } catch(e) {}
      }
    }
  } catch (e) {
    // 恢复失败静默（可能是离线/首次使用）
  }
}

// ======== 别名模糊匹配 ========
function escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
// 从文本中按别名匹配各筐的数量，返回 {goodsIdx: qty}
function matchGoodsFromText(text) {
  const cfg = loadGoodsConfig();
  const result = {};
  cfg.forEach((g, idx) => {
    const keys = [g.name, ...g.aliases].filter(Boolean);
    if (keys.length === 0) return;
    keys.sort((a, b) => b.length - a.length); // 优先长词
    const re = new RegExp('(' + keys.map(escapeReg).join('|') + ')[^0-9]*(\\d+)', 'g');
    let m, last = null;
    while ((m = re.exec(text)) !== null) { last = parseInt(m[2]); }
    if (last !== null) result[idx] = last;
  });
  return result;
}
// 从抬头文本判断筐类型，返回 goodsIdx 或 -1

// ======== 工具 ========
function todayStr() {
  const d = new Date();
  // 直接用本地时间方法（在中国手机浏览器自动取东八区）
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}
// OCR 取消标志
let ocrCancelled = false;
// 安抚文案轮换
const LOADING_TIPS = ['别急，正在努力认字…', '马上就好，稍等一下…', '数字越多越准…'];
let loadingTipIdx = 0;

function showLoading(text) {
  const txt = document.getElementById('loadingText');
  const ov = document.getElementById('loadingOverlay');
  if (txt) txt.textContent = text || '处理中…';
  const step = document.getElementById('loadingStep');
  if (step) step.textContent = '';
  const bar = document.getElementById('loadingBar');
  if (bar) bar.style.width = '30%';
  const cancel = document.getElementById('loadingCancelBtn');
  if (cancel) cancel.style.display = 'inline-block';
  if (ov) ov.classList.add('show');
}
function hideLoading() {
  const ov = document.getElementById('loadingOverlay');
  if (ov) ov.classList.remove('show');
  ocrCancelled = false;
}
// 更新加载步骤：如 updateLoadingStep('🔍 定位表格…', 40)
function updateLoadingStep(text, pct) {
  const step = document.getElementById('loadingStep');
  if (step) step.textContent = text || '';
  const bar = document.getElementById('loadingBar');
  if (bar && pct) bar.style.width = Math.min(95, pct) + '%';
  // 轮换安抚语（每 2 步换一句）
  loadingTipIdx = (loadingTipIdx + 1) % LOADING_TIPS.length;
}
// 取消识别
function cancelOcr() {
  ocrCancelled = true;
  hideLoading();
  showToast('已取消');
}
// 检查是否被取消（取消则抛错终止流程）
function checkOcrCancel() {
  if (ocrCancelled) throw new Error('已取消');
}

// ======== 店面 chip 切换（手动录入页） ========
function renderStoreChips() {
  const view = getSortedStores();
  const container = document.getElementById('recordStoreChips');
  if (!container) return;
  // 无店面时提示去新增
  if (!view || view.length === 0) {
    container.innerHTML = `
      <div style="background:#fff8e1;border:1.5px solid #f59e0b;border-radius:8px;padding:10px 12px;font-size:13px;color:#7c5a00;">
        🏪 还没有店面，先去添加吧：<br>
        回首页 → 点「🏪 店面管理」→「➕ 新增店面」<br>
        <span style="font-size:12px;">（或拍照路单批量导入，会自动带上编号别名）</span>
      </div>`;
    // 同步隐藏 select
    const sel = document.getElementById('recordStore');
    if (sel) sel.value = '';
    return;
  }
  let html = '';
  view.forEach((x) => {
    const s = x.s;
    const idx = x._idx;
    const alias = (s.aliases && s.aliases[0]) || '';
    const cls = idx === currentStoreIdx ? 'store-chip active' : 'store-chip';
    const aliasHtml = alias ? `<span class="chip-alias">· ${escapeHtml(alias)}</span>` : '';
    html += `<button class="${cls}" onclick="selectStoreChip(${idx})">${escapeHtml(s.name)}${aliasHtml}</button>`;
  });
  container.innerHTML = html;
  // 同步隐藏 select
  const sel = document.getElementById('recordStore');
  if (sel) sel.value = String(currentStoreIdx);
}
function selectStoreChip(idx) {
  currentStoreIdx = idx;
  renderStoreChips();
  reloadRecordInputs();
  const cfg = loadStoreConfig();
  const s = cfg[idx];
  if (s) {
    const alias = (s.aliases && s.aliases[0]) || '';
    const label = alias ? `${s.name} · ${alias}` : s.name;
    showTransparentToast('已选择 · ' + label);
  }
}

// ======== 透明 toast（中部、2 秒自动消失、点击屏幕任意位置也消失） ========
let transparentToastTimer = null;
let lastTransparentToastTime = 0;
function showTransparentToast(text) {
  lastTransparentToastTime = Date.now();
  let el = document.getElementById('transparentToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'transparentToast';
    el.className = 'transparent-toast';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('show');
  if (transparentToastTimer) clearTimeout(transparentToastTimer);
  transparentToastTimer = setTimeout(hideTransparentToast, 2000);
}
function hideTransparentToast() {
  const el = document.getElementById('transparentToast');
  if (el) el.classList.remove('show');
  if (transparentToastTimer) { clearTimeout(transparentToastTimer); transparentToastTimer = null; }
}
// 点击屏幕任意位置关闭（自己刚触发的事件忽略，避免和自身竞争）
document.addEventListener('click', () => {
  if (transparentToastTimer && Date.now() - lastTransparentToastTime > 250) hideTransparentToast();
});

// ======== 首页向导（录入 Tab 内的向导首页） ========
function manualEntry(type) {
  if (!type) { showToast('请选择操作类型'); return; }
  currentActionType = type;
  const label = type === 'in' ? '发出' : '回收';
  document.getElementById('manualHeaderLabel').textContent = label + ' - 手动录入';
  document.getElementById('entryModeLabel').textContent = label;
  document.getElementById('homeWizard').style.display = 'none';
  document.getElementById('manualForm').style.display = 'block';
  initStoreSelect('recordStore');
  document.getElementById('recordDate').value = todayStr();
  renderGoodsInputList();
}

function openVoiceInputModal() {
  const label = currentActionType === 'out' ? '回收' : '发出';
  document.getElementById('voiceModeLabel').textContent = label;
  document.getElementById('voiceInBtn').style.display = currentActionType === 'in' ? '' : 'none';
  document.getElementById('voiceOutBtn').style.display = currentActionType === 'out' ? '' : 'none';
  document.getElementById('voiceInputModal').classList.add('show');
}
function closeVoiceInputModal() {
  document.getElementById('voiceInputModal').classList.remove('show');
}
function openPhotoInputModal() {
  const label = currentActionType === 'out' ? '回收' : '发出';
  document.getElementById('photoModeLabel').textContent = label;
  document.getElementById('photoInputModal').classList.add('show');
}
function closePhotoInputModal() {
  document.getElementById('photoInputModal').classList.remove('show');
}
// 拍照/相册选（针对 PWA 桌面模式最可靠方案）：
// 每次点击动态创建一个「原生可见」的 file input 并立即触发，触发后移除。
// 原生可见 file input 在小米 PWA（WebView）下点击是系统级行为，最稳。
function triggerPhoto(type, mode) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  if (type === 'camera') input.setAttribute('capture', 'environment');
  // 保持可见（不 display:none），确保系统文件选择器能正常唤起
  input.style.position = 'fixed';
  input.style.left = '-9999px'; // 移出可视区但保持可聚焦触发
  input.onchange = (e) => (mode === 'store' ? handleStorePhoto(e) : handlePhoto(e));
  document.body.appendChild(input);
  input.click();
  setTimeout(() => { if (input.parentNode) input.parentNode.removeChild(input); }, 10000);
}
// ======== 新用户欢迎引导（首次打开自动弹出） ========
function initWelcome() {
  try {
    if (localStorage.getItem('kuanwei_welcome_seen')) return;
    const m = document.getElementById('welcomeModal');
    if (m) m.classList.add('show');
  } catch(e) {}
}
function closeWelcome(goTutorial) {
  try { localStorage.setItem('kuanwei_welcome_seen', '1'); } catch(e) {}
  const m = document.getElementById('welcomeModal');
  if (m) m.classList.remove('show');
  if (goTutorial) {
    switchPage('settings');
  }
}

// ======== 添加到主屏幕（PWA） ========
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});

function installApp() {
  // 微信内置浏览器：无法添加主屏幕，引导到浏览器打开
  const isWechat = /MicroMessenger/i.test(navigator.userAgent);
  if (isWechat) {
    const modal = document.getElementById('installModal');
    if (modal) modal.classList.add('show');
    const wx = document.getElementById('installWechatTip');
    const normal = document.getElementById('installNormalTip');
    if (wx) wx.style.display = 'block';
    if (normal) normal.style.display = 'none';
    return;
  }
  // Android/Chrome：触发原生安装提示
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(() => { deferredPrompt = null; });
    return;
  }
  // 无自动安装提示（已安装过再卸载 / iOS / 其他）：显示引导
  const modal = document.getElementById('installModal');
  if (modal) modal.classList.add('show');
  const wx = document.getElementById('installWechatTip');
  const normal = document.getElementById('installNormalTip');
  const android = document.getElementById('installAndroidTip');
  if (wx) wx.style.display = 'none';
  if (android) android.style.display = 'none';
  if (normal) normal.style.display = 'none';
  // 安卓（且非微信）：已卸载重装，引导用浏览器菜单安装
  if (/Android/i.test(navigator.userAgent) && !isWechat) {
    if (android) android.style.display = 'block';
  } else if (normal) {
    normal.style.display = 'block';
  }
}
function closeInstallModal() {
  const modal = document.getElementById('installModal');
  if (modal) modal.classList.remove('show');
}

function backToHomeWizard() {
  document.getElementById('manualForm').style.display = 'none';
  document.getElementById('homeWizard').style.display = 'block';
  renderTodayStatus();
}

// ======== 面板切换（首页 6 大按钮控制） ========
function openStorePanel() {
  document.getElementById('homeWizard').style.display = 'none';
  document.getElementById('storeManagePanel').style.display = 'block';
  renderStorePanelUI();
}
function backFromStorePanel() {
  document.getElementById('storeManagePanel').style.display = 'none';
  document.getElementById('homeWizard').style.display = 'block';
}
function openGoodsPanel() {
  document.getElementById('homeWizard').style.display = 'none';
  document.getElementById('goodsManagePanel').style.display = 'block';
  renderGoodsPanelUI();
}
function backFromGoodsPanel() {
  document.getElementById('goodsManagePanel').style.display = 'none';
  document.getElementById('homeWizard').style.display = 'block';
}
function openTrackPanel() {
  document.getElementById('homeWizard').style.display = 'none';
  document.getElementById('trackPanel').style.display = 'block';
  document.getElementById('trackDate').value = todayStr();
  const sel = document.getElementById('trackStore');
  populateStoreFilter('trackStore');
  sel.value = '';
  renderTrack();
}
function backFromTrackPanel() {
  document.getElementById('trackPanel').style.display = 'none';
  document.getElementById('homeWizard').style.display = 'block';
}
function openBackupPanel() {
  document.getElementById('homeWizard').style.display = 'none';
  document.getElementById('backupPanel').style.display = 'block';
  renderCloudBackupStatus();
  renderAccountStatus();
  // 首次进入自动弹出教程
  try {
    if (!localStorage.getItem('kuanwei_seen_backup_tutorial')) {
      showBackupTutorial();
      localStorage.setItem('kuanwei_seen_backup_tutorial', '1');
    }
  } catch(e) {}
}
function backFromBackupPanel() {
  document.getElementById('backupPanel').style.display = 'none';
  document.getElementById('homeWizard').style.display = 'block';
}

// ======== 店面管理面板 ========
function renderStorePanelUI() {
  const view = getSortedStores(); // 排序视图（含原始下标 _idx）
  const container = document.getElementById('storeListPanel');
  let html = '';
  view.forEach((x, i) => {
    const s = x.s;
    const idx = x._idx; // 原始数组下标
    html += `<div class="store-card">
      <div class="sc-head">
        <div class="sc-idx">${i+1}</div>
        <div class="sc-move-col">
          <button class="sc-move" onclick="moveStore(${idx},-1)" ${i===0?'disabled':''}>▲</button>
          <button class="sc-move" onclick="moveStore(${idx},1)" ${i===view.length-1?'disabled':''}>▼</button>
        </div>
        <input type="text" class="sc-name" id="sName${idx}" value="${escapeHtml(s.name)}" maxlength="20">
      </div>
      <div class="sc-alias-label">🏷️ 别名（识别时可替代店名）</div>
      <div class="sc-aliases" id="sAliases${idx}">
        ${s.aliases.length > 0
          ? s.aliases.map((a, ai) => `<span class="sc-alias">${escapeHtml(a)}<span class="sc-x" onclick="removeStoreAlias(${idx},${ai})">×</span></span>`).join('')
          : `<span class="sc-empty">暂无别名</span>`}
      </div>
      <div class="sc-add">
        <input type="text" id="sAliasInput${idx}" placeholder="输入别名后点添加" maxlength="20">
        <button onclick="addStoreAlias(${idx})">添加</button>
      </div>
      <div class="sc-foot">
        <button class="sc-del" onclick="removeStoreFromPanel(${idx})">🗑️ 删除此店面</button>
      </div>
    </div>`;
  });
  container.innerHTML = html;
  const sc = document.getElementById('storeCount');
  if (sc) sc.textContent = view.length;
}
// 上移/下移店面排序（交换两店的 sort 值）
function moveStore(idx, dir) {
  const cfg = loadStoreConfig();
  const view = getSortedStores();
  const pos = view.findIndex(x => x._idx === idx);
  const j = pos + dir;
  if (pos < 0 || j < 0 || j >= view.length) return;
  const otherIdx = view[j]._idx;
  // 交换两店的 sort 值
  const tmp = cfg[idx].sort;
  cfg[idx].sort = cfg[otherIdx].sort;
  cfg[otherIdx].sort = tmp;
  // 归一化 sort：按 sort 值排序得到显示顺序，按此顺序给每个原始下标重赋 0..n-1（数组物理顺序不变，storeIdx 稳定，不依赖店名）
  const seq = cfg.slice().sort((a, b) => (a.sort || 0) - (b.sort || 0)); // 按新 sort 排序
  const realIdx = seq.map(s => cfg.indexOf(s)); // 每个店在原始数组中的下标
  realIdx.forEach((ri, k) => { cfg[ri].sort = k; });
  saveStoreConfig(cfg);
  renderStorePanelUI();
  initAllStores();
  showToast('已调整排序');
}

// 保存店面管理面板的所有修改（店名/别名）
function saveStorePanelChanges() {
  const cfg = loadStoreConfig();
  let changed = 0;
  cfg.forEach((s, i) => {
    if (!s.aliases) s.aliases = [];
    const nm = document.getElementById('sName' + i);
    if (nm) {
      let val = nm.value.trim();
      if (val) {
        // 从店名识别门店编号（如 35-12 温州永嘉上塘下堡店 / 温州永嘉上塘下堡店 35-12）
        const numMatch = val.match(/(\d{1,3})\s*[-–−_]\s*(\d{1,3})/);
        if (numMatch) {
          const fullCode = numMatch[1] + '-' + numMatch[2];
          const tail = numMatch[2].replace(/^0+/, '');
          const shortAlias = tail + '店';
          // 查重：其他店面已用的别名
          const used = new Set();
          cfg.forEach((x, xi) => { if (xi !== i) (x.aliases || []).forEach(a => used.add(String(a))); });
          if (!s.aliases.includes(fullCode) && !used.has(fullCode)) { s.aliases.push(fullCode); changed++; }
          if (!s.aliases.includes(shortAlias) && !used.has(shortAlias)) { s.aliases.push(shortAlias); changed++; }
          // 店名清理：去掉编号部分，只留店名
          val = val.replace(numMatch[0], '').trim();
        }
        if (val !== s.name) { s.name = val; changed++; }
      }
    }
    // 收集当前输入框里未添加的别名
    const ai = document.getElementById('sAliasInput' + i);
    if (ai) {
      const av = ai.value.trim();
      if (av && !s.aliases.includes(av)) { s.aliases.push(av); changed++; ai.value = ''; }
    }
  });
  // 按 sort 归一化（保证删除/调整后 sort 连续，数组顺序即显示顺序）
  cfg = cfg.map((s, idx) => ({ ...s, sort: idx }));
  saveStoreConfig(cfg);
  renderStorePanelUI();
  initAllStores();
  showToast(changed > 0 ? `✅ 已保存 ${changed} 处修改` : '已保存');
}
function addStoreAlias(idx) {
  const cfg = loadStoreConfig();
  const input = document.getElementById('sAliasInput' + idx);
  const val = input.value.trim();
  if (!val) return;
  const nm = document.getElementById('sName' + idx)?.value?.trim();
  if (nm) cfg[idx].name = nm;
  if (!cfg[idx].aliases.includes(val)) cfg[idx].aliases.push(val);
  saveStoreConfig(cfg);
  renderStorePanelUI();
}
function removeStoreAlias(idx, ai) {
  const cfg = loadStoreConfig();
  cfg[idx].aliases.splice(ai, 1);
  saveStoreConfig(cfg);
  renderStorePanelUI();
}
function addStoreFromPanel() {
  const cfg = loadStoreConfig();
  cfg.push({ name: '新店面', aliases: [], sort: cfg.length });
  saveStoreConfig(cfg);
  renderStorePanelUI();
  initAllStores();
}
function removeStoreFromPanel(idx) {
  const cfg = loadStoreConfig();
  cfg.splice(idx, 1);
  cfg = cfg.map((s, i) => ({ ...s, sort: i }));
  saveStoreConfig(cfg);
  renderStorePanelUI();
  initAllStores();
}
// 店面改完后刷新所有店面选择器
function initAllStores() {
  initStoreSelect('recordStore');
  populateStoreFilter('filterStore');
  populateStoreFilter('summaryStore');
  populateStoreFilter('exportStore');
  const ts = document.getElementById('trackStore');
  if (ts) populateStoreFilter('trackStore');
}

// ======== 框名管理面板 ========
function renderGoodsPanelUI() {
  const cfg = loadGoodsConfig();
  const container = document.getElementById('goodsListPanel');
  let html = '';
  cfg.forEach((g, i) => {
    html += `<div class="config-item" style="border:1px solid var(--border);border-radius:8px;padding:8px;margin-bottom:8px;">
      <div style="display:flex;gap:8px;align-items:center;">
        <div class="idx">${i+1}</div>
        <input type="text" id="gName${i}" value="${escapeHtml(g.name)}" maxlength="20" style="flex:1;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:15px;">
      </div>
      <div class="alias-box" id="gAliases${i}" style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;">
        ${g.aliases.map((a, ai) => `<span class="alias-chip" style="background:#eef;color:#357abd;font-size:12px;padding:3px 8px;border-radius:12px;display:inline-flex;align-items:center;gap:4px;">${escapeHtml(a)}<span style="cursor:pointer;color:#e74c3c;font-weight:700;" onclick="removeGoodsAlias(${i},${ai})">×</span></span>`).join('')}
      </div>
      <div style="display:flex;gap:6px;margin-top:6px;">
        <input type="text" id="gAliasInput${i}" placeholder="加别名，如 冷藏" style="flex:1;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:13px;">
        <button class="btn btn-outline" style="flex:0 0 auto;padding:7px 12px;font-size:12px;" onclick="addGoodsAlias(${i})">添加</button>
      </div>
    </div>`;
  });
  container.innerHTML = html;
}
function addGoodsAlias(idx) {
  const cfg = loadGoodsConfig();
  const input = document.getElementById('gAliasInput' + idx);
  const val = input.value.trim();
  if (!val) return;
  const nm = document.getElementById('gName' + idx)?.value?.trim();
  if (nm) cfg[idx].name = nm;
  if (!cfg[idx].aliases.includes(val)) cfg[idx].aliases.push(val);
  saveGoodsConfig(cfg);
  renderGoodsPanelUI();
}
function removeGoodsAlias(idx, ai) {
  const cfg = loadGoodsConfig();
  cfg[idx].aliases.splice(ai, 1);
  saveGoodsConfig(cfg);
  renderGoodsPanelUI();
}
// 新增框类型
function showAddGoodsModal() {
  const name = prompt('请输入新框类型名称（如：甜品筐）：');
  if (!name || !name.trim()) return;
  const cfg = loadGoodsConfig();
  cfg.push({ name: name.trim(), aliases: [] });
  saveGoodsConfig(cfg);
  renderGoodsPanelUI();
  renderGoodsInputList();
  initGoodsFilter();
  showToast('✅ 已新增「' + name.trim() + '」');
}
// 删除框类型
let goodsDeleteIdx = -1;
function showDeleteGoodsModal() {
  const cfg = loadGoodsConfig();
  if (cfg.length <= 1) { showToast('至少保留一个筐类型'); return; }
  const names = cfg.map(g => g.name).map((n,i) => (i+1)+'. '+n).join('\n');
  const idxStr = prompt('选择要删除的框类型编号（输入数字）：\n\n' + names);
  if (!idxStr) return;
  const idx = parseInt(idxStr) - 1;
  if (isNaN(idx) || idx < 0 || idx >= cfg.length) { showToast('编号无效'); return; }
  goodsDeleteIdx = idx;
  const name = cfg[idx].name;
  // 检查有无数据
  const data = loadData();
  const count = data.filter(r => r.goodsIdx === idx).length;
  const msg = document.getElementById('goodsDeleteMsg');
  if (count > 0) {
    msg.innerHTML = '<strong>' + escapeHtml(name) + '</strong> 有 <strong>' + count + '</strong> 条数据记录。<br><br>删除后这些数据将不可见（数据本身仍保留，如恢复此框名可再次查看）。';
    document.getElementById('goodsDeleteConfirmBtn').style.display = '';
  } else {
    msg.innerHTML = '<strong>' + escapeHtml(name) + '</strong> 没有数据记录，可直接删除。';
    document.getElementById('goodsDeleteConfirmBtn').textContent = '确认删除';
    document.getElementById('goodsDeleteConfirmBtn').style.display = '';
  }
  document.getElementById('goodsDeleteModal').classList.add('show');
}
function closeGoodsDeleteModal() {
  document.getElementById('goodsDeleteModal').classList.remove('show');
  goodsDeleteIdx = -1;
}
function confirmDeleteGoods() {
  if (goodsDeleteIdx < 0) return;
  const cfg = loadGoodsConfig();
  const name = cfg[goodsDeleteIdx].name;
  cfg.splice(goodsDeleteIdx, 1);
  saveGoodsConfig(cfg);
  renderGoodsPanelUI();
  renderGoodsInputList();
  initGoodsFilter();
  closeGoodsDeleteModal();
  showToast('✅ 已删除「' + name + '」');
}
function goViewGoodsData() {
  if (goodsDeleteIdx < 0) return;
  closeGoodsDeleteModal();
  // 切换到历史页，筛选该筐，日期 2026-07-31 ~ 当天
  switchPage('history');
  const filterGoods = document.getElementById('filterGoods');
  if (filterGoods) filterGoods.value = String(goodsDeleteIdx);
  document.getElementById('filterDate').value = '';
  setFilterDateRange('filterDate', todayStr(), todayStr());
  renderHistory();
  goodsDeleteIdx = -1;
}
function setFilterDateRange(idFrom, fromDate, toDate) {
  const inp = document.getElementById(idFrom);
  if (inp) inp.value = fromDate;
}

// ======== 库存追踪 ========
function renderTrack() {
  const date = document.getElementById('trackDate').value;
  if (!date) { document.getElementById('trackResult').innerHTML = '<span style="color:var(--text-light);">请选择发出日期后查看</span>'; return; }
  const storeSel = document.getElementById('trackStore');
  const storeVal = storeSel ? storeSel.value : '';
  let data = loadData();
  // 筛选：只取该发出日期 + 符合条件的店面（排除额外发收，无店面归属不追踪）
  const outRecords = data.filter(r => r.date === date && r.qtyIn > 0 && !r.extra && r.storeIdx !== -1 && (storeVal === '' || r.storeIdx === parseInt(storeVal)));
  // 对于每个店面+筐，统计发出量 vs 截止今日的回收量
  const today = todayStr();
  const names = loadGoodsConfig();
  const track = {}; // key: "storeIdx-goodsIdx"
  outRecords.forEach(r => {
    const key = r.storeIdx + '-' + r.goodsIdx;
    if (!track[key]) track[key] = { storeIdx: r.storeIdx, goodsIdx: r.goodsIdx, name: names[r.goodsIdx]?.name || '?' , sent: 0, returned: 0 };
    track[key].sent += r.qtyIn;
  });
  // 对每个店面+筐，查该店在发出日期之后的所有回收记录
  Object.keys(track).forEach(key => {
    const t = track[key];
    const rets = data.filter(r =>
      r.date > date && r.date <= today &&
      r.storeIdx === t.storeIdx &&
      r.goodsIdx === t.goodsIdx &&
      r.qtyOut > 0
    );
    rets.forEach(r => t.returned += r.qtyOut);
  });
  const entries = Object.values(track);
  if (entries.length === 0) {
    document.getElementById('trackResult').innerHTML = '<span style="color:var(--text-light);">该日期无发出记录</span>';
    return;
  }
  let html = '<table class="track-tbl"><thead><tr><th>店面</th><th>筐类型</th><th>发出</th><th>已回收</th><th>待回收</th></tr></thead><tbody>';
  let totalSent = 0, totalRet = 0;
  entries.forEach(t => {
    const pending = t.sent - t.returned;
    html += `<tr><td>${escapeHtml(loadStoreNames()[t.storeIdx] || '?')}</td><td>${escapeHtml(t.name)}</td><td>${t.sent}</td><td>${t.returned}</td><td style="color:${pending>0?'var(--danger)':'var(--success)'};font-weight:600;">${pending}</td></tr>`;
    totalSent += t.sent; totalRet += t.returned;
  });
  const totalPending = totalSent - totalRet;
  html += `<tr class="total-row"><td>合计</td><td></td><td>${totalSent}</td><td>${totalRet}</td><td style="color:${totalPending>0?'var(--danger)':'var(--success)'};font-weight:600;">${totalPending}</td></tr>`;
  html += '</tbody></table>';
  document.getElementById('trackResult').innerHTML = html;
}

// ======== 备份教程弹窗 ========
function showBackupTutorial() {
  const modal = document.getElementById('backupTutorialModal');
  if (modal) modal.classList.add('show');
  // 4 秒后自动关闭（避免一直遮挡其他操作）
  if (window._backupTutorialTimer) clearTimeout(window._backupTutorialTimer);
  window._backupTutorialTimer = setTimeout(() => closeBackupTutorialModal(), 4000);
}
function closeBackupTutorialModal() {
  if (window._backupTutorialTimer) { clearTimeout(window._backupTutorialTimer); window._backupTutorialTimer = null; }
  const modal = document.getElementById('backupTutorialModal');
  if (modal) modal.classList.remove('show');
}

// ======== 页面切换 ========
// 刷新记录页全部视图（店面下拉/店面chips/录入行/筐筛选/今日概览/今日状态）
function refreshRecordViews() {
  try {
    initStoreSelect('recordStore'); renderStoreChips(); renderGoodsInputList(); initGoodsFilter(); renderTodayOverview(); renderTodayStatus();
  } catch(e) {}
}
function switchPage(pageName) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  const pageEl = document.getElementById('page-' + pageName);
  if (pageEl) pageEl.classList.add('active');
  const tabEl = document.querySelector(`.tab[data-page="${pageName}"]`);
  if (tabEl) tabEl.classList.add('active');
  if (pageName === 'record') refreshRecordViews();
  if (pageName === 'history') { renderHistory(); updateDailyPhotoInfo(); initGoodsFilter(); }
  if (pageName === 'summary') renderSummary();
  if (pageName === 'settings') renderSettings();
  if (pageName === 'reconcile') populateStoreFilter('exportStore');
}
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchPage(tab.dataset.page));
});

// ======== 录入页初始化 ========
function initRecordPage() {
  document.getElementById('recordDate').value = todayStr();
  document.getElementById('todayLabel').textContent = todayStr();
  initStoreSelect('recordStore');
  renderGoodsInputList();
}
function renderGoodsInputList() {
  const names = loadGoodsNames();
  const container = document.getElementById('goodsInputList');
  const isIn = currentActionType === 'in';
  const isOut = currentActionType === 'out';
  let html = '';
  // 表头
  html += '<div class="goods-input-item" style="font-size:11px;color:var(--text-light);border-bottom:1px solid var(--border);padding-bottom:4px;margin-bottom:6px;">';
  html += '<div class="gi-name">筐名</div>';
  if (!isOut) html += '<div style="flex:1;text-align:center;">发出</div>';
  if (!isIn)  html += '<div style="flex:1;text-align:center;">回收</div>';
  html += '</div>';
  names.forEach((name, i) => {
    html += '<div class="goods-input-item">';
    html += '<div class="gi-name">' + name + '</div>';
    if (!isOut) html += '<div class="gi-in"><input type="number" id="giIn' + i + '" placeholder="0" min="0" inputmode="numeric" data-idx="' + i + '"></div>';
    if (!isIn)  html += '<div class="gi-out"><input type="number" id="giOut' + i + '" placeholder="0" min="0" inputmode="numeric" data-idx="' + i + '"></div>';
    html += '</div>';
  });
  container.innerHTML = html;
  reloadRecordInputs();
}

// 把当前(店面,日期)已有记录载入输入框
function reloadRecordInputs() {
  const date = document.getElementById('recordDate').value;
  const data = loadData();
  const n = loadGoodsNames().length;
  for (let i = 0; i < n; i++) {
    const ei = document.getElementById('giIn' + i);
    const eo = document.getElementById('giOut' + i);
    const rec = data.find(r => r.date === date && r.storeIdx === currentStoreIdx && r.goodsIdx === i);
    if (ei) ei.value = rec ? rec.qtyIn : '';
    if (eo) eo.value = rec ? rec.qtyOut : '';
  }
}

// 店面切换
function onRecordStoreChange() {
  const sel = document.getElementById('recordStore');
  currentStoreIdx = parseInt(sel.value) || 0;
  renderStoreChips();
  reloadRecordInputs();
}

// 初始化店面下拉（录入页用，默认选中当前店）；同时刷新 chip 列表
function initStoreSelect(selId) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  const view = getSortedStores(); // 排序视图，value 用原始 storeIdx
  sel.innerHTML = '';
  view.forEach(x => {
    const opt = document.createElement('option');
    opt.value = x._idx; opt.textContent = x.s.name;
    sel.appendChild(opt);
  });
  sel.value = currentStoreIdx;
  renderStoreChips();
}

// 初始化店面筛选下拉（历史/汇总/导出用，含"全部店"）
function populateStoreFilter(selId) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  const view = getSortedStores();
  const cur = sel.value;
  sel.innerHTML = '<option value="">全部店</option>';
  view.forEach(x => {
    const opt = document.createElement('option');
    opt.value = x._idx; opt.textContent = x.s.name;
    sel.appendChild(opt);
  });
  if (cur !== '' && view.some(x => String(x._idx) === String(cur))) sel.value = cur;
  else sel.value = '';
}

// ======== 手动保存 ========
function saveManualRecord() {
  if (!isLoggedIn()) { showToast('🔒 请先登录后再录入'); openLoginModal(); return; }
  const date = document.getElementById('recordDate').value;
  if (!date) { showToast('请选择日期'); return; }
  const names = loadGoodsNames();
  const storeNames = loadStoreNames();
  // 无店面时提示去新增
  if (!storeNames || storeNames.length === 0) {
    showToast('请先到「店面管理」添加店面');
    return;
  }
  const storeName = storeNames[currentStoreIdx] || '默认店';
  const data = loadData();
  // 只移除「当天 + 当前店面」的旧记录（其它店面的同日记录保留）
  const filtered = data.filter(r => !(r.date === date && r.storeIdx === currentStoreIdx));
  let hasAny = false;
  const records = [];
  const n = names.length;
  for (let i = 0; i < n; i++) {
    const qIn = parseInt(document.getElementById('giIn'+i)?.value) || 0;
    const qOut = parseInt(document.getElementById('giOut'+i)?.value) || 0;
    if (qIn > 0 || qOut > 0) {
      hasAny = true;
      records.push({
        id: Date.now() + '-' + currentStoreIdx + '-' + i,
        date: date,
        storeIdx: currentStoreIdx,
        storeName: storeName,
        goodsIdx: i,
        goodsName: names[i],
        qtyIn: qIn,
        qtyOut: qOut,
        source: 'manual',
        createdAt: new Date().toISOString()
      });
    }
  }
  if (!hasAny) { showToast('请至少填一项数量'); return; }
  saveDataArr([...filtered, ...records]);
  reloadRecordInputs();
  showToast('✅ 保存成功');
  renderTodayOverview();
  // 保存后自动跳到下一个店面（连续录入）
  autoNextStore();
}

// ======== 额外发收登记（针对所有门店，storeIdx=-1） ========
function openExtraModal() {
  const names = loadGoodsNames();
  const container = document.getElementById('extraGoodsList');
  let html = '';
  // 表头
  html += '<div class="goods-input-item" style="font-size:11px;color:var(--text-light);border-bottom:1px solid var(--border);padding-bottom:4px;margin-bottom:6px;">';
  html += '<div class="gi-name">筐名</div>';
  html += '<div style="flex:1;text-align:center;">额外发出</div>';
  html += '<div style="flex:1;text-align:center;">额外回收</div>';
  html += '</div>';
  names.forEach((n, i) => {
    html += `<div class="goods-input-item">
      <div class="gi-name" data-idx="${i}">${escapeHtml(n)}</div>
      <div class="gi-in"><input type="number" id="exIn${i}" placeholder="0" min="0" inputmode="numeric" data-idx="${i}"></div>
      <div class="gi-out"><input type="number" id="exOut${i}" placeholder="0" min="0" inputmode="numeric" data-idx="${i}"></div>
    </div>`;
  });
  container.innerHTML = html;
  document.getElementById('extraModal').classList.add('show');
}
function closeExtraModal() {
  document.getElementById('extraModal').classList.remove('show');
}
// 保存额外发收登记：发出列记为 qtyIn，回收列记为 qtyOut，storeIdx=-1（所有门店）
function saveExtraRecord() {
  if (!isLoggedIn()) { showToast('🔒 请先登录后再登记'); openLoginModal(); return; }
  // 使用录入页选择的日期，而非强制今天（回填历史日期也能正确入账）
  const date = document.getElementById('recordDate')?.value || todayStr();
  const names = loadGoodsNames();
  const data = loadData();
  let hasAny = false;
  const records = [];
  for (let i = 0; i < names.length; i++) {
    const qIn = parseInt(document.getElementById('exIn'+i)?.value) || 0;
    const qOut = parseInt(document.getElementById('exOut'+i)?.value) || 0;
    if (qIn > 0) {
      hasAny = true;
      records.push({
        id: 'extra-' + Date.now() + '-in-' + i,
        date: date,
        storeIdx: -1,
        storeName: '额外发收',
        goodsIdx: i,
        goodsName: names[i],
        qtyIn: qIn,
        qtyOut: 0,
        extra: true,
        source: 'extra',
        createdAt: new Date().toISOString()
      });
    }
    if (qOut > 0) {
      hasAny = true;
      records.push({
        id: 'extra-' + Date.now() + '-out-' + i,
        date: date,
        storeIdx: -1,
        storeName: '额外发收',
        goodsIdx: i,
        goodsName: names[i],
        qtyIn: 0,
        qtyOut: qOut,
        extra: true,
        source: 'extra',
        createdAt: new Date().toISOString()
      });
    }
  }
  if (!hasAny) { showToast('请至少填一项数量'); return; }
  saveDataArr([...data, ...records]);
  closeExtraModal();
  showToast('✅ 已保存额外发收登记');
  renderTodayOverview();
}

// 保存后自动跳下一个店面（循环到最后一个时停在本店）
function autoNextStore() {
  const cfg = loadStoreConfig();
  if (!cfg || cfg.length < 2) return;
  const nextIdx = currentStoreIdx + 1;
  if (nextIdx >= cfg.length) {
    // 已到最后一个店面：清空输入，停在本店
    reloadRecordInputs();
    return;
  }
  currentStoreIdx = nextIdx;
  renderStoreChips();
  reloadRecordInputs();
}

// ======== 今日概览 ========
function renderTodayOverview() {
  const today = todayStr();
  const data = loadData();
  const names = loadGoodsNames();
  // 今日全部门店的记录（不再限定当前店面）
  const todayRecords = data.filter(r => r.date === today);
  const container = document.getElementById('todayOverview');
  if (todayRecords.length === 0) {
    container.innerHTML = '<div class="empty">今日暂无记录</div>';
    return;
  }
  const totals = {};
  names.forEach((name, i) => { totals[i] = { in: 0, out: 0 }; });
  todayRecords.forEach(r => {
    if (totals[r.goodsIdx]) {
      totals[r.goodsIdx].in += r.qtyIn || 0;
      totals[r.goodsIdx].out += r.qtyOut || 0;
    }
  });
  let html = '<div class="stat-grid">';
  let anyShow = false;
  names.forEach((name, i) => {
    if (totals[i].in === 0 && totals[i].out === 0) return;
    anyShow = true;
    html += `
      <div class="stat-card">
        <div class="stat-name">${name}</div>
        <div class="stat-vals">
          <div><div class="stat-lbl">发</div><div class="stat-val in">${totals[i].in}</div></div>
          <div><div class="stat-lbl">回</div><div class="stat-val out">${totals[i].out}</div></div>
        </div>
      </div>`;
  });
  html += '</div>';

  // 今日各店明细表（每店一行，各筐发出/回收）
  const storeMap = {};
  todayRecords.forEach(r => {
    if (!storeMap[r.storeIdx]) storeMap[r.storeIdx] = { name: r.storeName || '未知店', rows: {} };
  });
  // 一次性初始化各店所有筐行，避免每条记录内重复遍历
  const storeKeys = Object.keys(storeMap);
  storeKeys.forEach(sk => { names.forEach((n, i) => { if (!storeMap[sk].rows[i]) storeMap[sk].rows[i] = { in: 0, out: 0 }; }); });
  todayRecords.forEach(r => {
    if (storeMap[r.storeIdx] && storeMap[r.storeIdx].rows[r.goodsIdx]) {
      storeMap[r.storeIdx].rows[r.goodsIdx].in += r.qtyIn || 0;
      storeMap[r.storeIdx].rows[r.goodsIdx].out += r.qtyOut || 0;
    }
  });
  if (storeKeys.length > 0) {
    html += '<div style="margin-top:10px;"><div style="font-size:12px;color:var(--text-light);margin-bottom:4px;">📋 今日各店明细</div><div style="overflow-x:auto;"><table class="summary-table" style="min-width:100%;"><thead><tr><th style="text-align:left;">店面</th>';
    names.forEach((n, i) => { html += `<th>${n}<br><span style="font-weight:400;font-size:10px;">发/回</span></th>`; });
    html += '</tr></thead><tbody>';
    storeKeys.forEach(sk => {
      const s = storeMap[sk];
      html += `<tr><td style="text-align:left;font-size:12px;">${escapeHtml(s.name)}</td>`;
      names.forEach((n, i) => {
        const d = s.rows[i] || { in: 0, out: 0 };
        html += `<td style="font-size:12px;"><span style="color:var(--primary);font-weight:600;">${d.in}</span>/<span style="color:var(--success);font-weight:600;">${d.out}</span></td>`;
      });
      html += '</tr>';
    });
    html += '</tbody></table></div></div>';
  }

  container.innerHTML = anyShow ? html : '<div class="empty">今日暂无记录</div>';
  renderTodayStatus(); // 同步刷新今日状态卡片
}

// ======== 今日状态卡片 ========
// 展示：今日发出/回收总数、已录入店面进度、待录入店面提醒
function renderTodayStatus() {
  const el = document.getElementById('todayStatusCard');
  if (!el) return;
  const today = todayStr();
  const data = loadData();
  const stores = getSortedStores();
  // 今日各店是否已录入（含额外发收记录，storeIdx=-1 单列）
  const todayRecords = data.filter(r => r.date === today);
  let totalIn = 0, totalOut = 0;
  const doneSet = new Set();
  let hasExtra = false;
  todayRecords.forEach(r => {
    totalIn += r.qtyIn || 0; totalOut += r.qtyOut || 0;
    if (r.storeIdx === -1) { hasExtra = true; return; }
    if (r.storeIdx !== undefined) doneSet.add(r.storeIdx);
  });
  const totalStores = stores.length;
  const doneCount = doneSet.size;
  const pct = totalStores > 0 ? Math.round(doneCount / totalStores * 100) : (todayRecords.length > 0 ? 100 : 0);

  // 待录入店面
  const pendingStores = stores.filter(s => !doneSet.has(s._idx));

  let html = '';
  html += `<div class="today-status-head">
    <div class="today-status-title">📊 今日状态</div>
    <div class="today-status-date">${today}</div>
  </div>`;
  html += `<div class="today-status-sum">
    <div class="today-status-box"><div class="tsb-num in">${totalIn}</div><div class="tsb-lbl">今日发出</div></div>
    <div class="today-status-box"><div class="tsb-num out">${totalOut}</div><div class="tsb-lbl">今日回收</div></div>
    <div class="today-status-box"><div class="tsb-num">${doneCount}/${totalStores}</div><div class="tsb-lbl">已录店面</div></div>
  </div>`;
  // 录入进度条
  html += `<div class="today-status-progress">
    <div class="tsp-top"><span>录入进度</span><span>${pct}%${hasExtra ? ' · 含额外发收' : ''}</span></div>
    <div class="today-status-bar"><div style="width:${pct}%;"></div></div>
  </div>`;

  // 各店状态 chips：已录（绿）/ 待录（灰）
  if (totalStores > 0) {
    html += `<div class="today-store-chips">`;
    stores.forEach(s => {
      const done = doneSet.has(s._idx);
      html += `<span class="today-store-chip ${done ? 'done' : 'pending'}">${done ? '✓ ' : '○ '}${escapeHtml(s.s.name)}</span>`;
    });
    html += `</div>`;
  }

  // 待录入提醒
  if (pendingStores.length > 0) {
    html += `<div style="font-size:11px;color:var(--warning);margin-top:8px;">⏳ 还有 ${pendingStores.length} 家店未录入：${pendingStores.map(s=>escapeHtml(s.s.name)).join('、')}</div>`;
  } else if (todayRecords.length > 0) {
    html += `<div style="font-size:11px;color:var(--success);margin-top:8px;">🎉 今日所有店面均已录入！</div>`;
  } else {
    html += `<div style="font-size:11px;color:var(--text-light);margin-top:8px;">今日还没有记录，点击上方「发出/回收」开始录入</div>`;
  }

  el.innerHTML = html;
}

// ======== 语音识别 ========
let voiceRecognition = null;
let voiceMode = 'in'; // 'in' or 'out'

function startVoice(mode) {
  voiceMode = mode;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    showToast('浏览器不支持语音识别，请用Chrome');
    return;
  }
  // 先请求麦克风权限（部分浏览器/PWA 不主动弹权限框，需先调用 getUserMedia）
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => { try { stream.getTracks().forEach(t => t.stop()); } catch (e) {} /* 立即释放，仅为触发权限框 */ })
      .catch(err => {
        // 权限被拒或设备不可用，给出明确引导
        let tip = '麦克风权限被拒绝';
        if (err && err.name === 'NotAllowedError') tip = '麦克风权限被拒绝，请在浏览器/PWA设置中允许麦克风权限后重试';
        else if (err && err.name === 'NotFoundError') tip = '未检测到麦克风设备，请插入麦克风后重试';
        else if (err && err.name === 'NotReadableError') tip = '麦克风被其它应用占用，请关闭后重试';
        showToast('🔒 ' + tip);
      });
  }
  voiceRecognition = new SR();
  voiceRecognition.lang = 'zh-CN';
  voiceRecognition.continuous = false;
  voiceRecognition.interimResults = true;

  const overlay = document.getElementById('voiceOverlay');
  const transcript = document.getElementById('voiceTranscript');
  const voiceText = document.getElementById('voiceText');
  transcript.textContent = '';
  voiceText.textContent = '请说出筐名和数量…';
  overlay.classList.add('show');
  document.getElementById(mode === 'in' ? 'voiceInBtn' : 'voiceOutBtn').classList.add('recording');

  voiceRecognition.onresult = function(event) {
    let finalText = '';
    let interimText = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        finalText += event.results[i][0].transcript;
      } else {
        interimText += event.results[i][0].transcript;
      }
    }
    transcript.textContent = finalText || interimText;
    if (finalText) {
      parseVoiceText(finalText, mode);
    }
  };

  voiceRecognition.onerror = function(event) {
    const err = event.error || '';
    const tipMap = {
      'not-allowed': '麦克风权限被拒绝，请在浏览器/PWA设置中允许麦克风权限后重试',
      'service-not-allowed': '麦克风权限被拒绝，请在浏览器/PWA设置中允许麦克风权限后重试',
      'audio-capture': '未检测到麦克风设备，请检查麦克风是否被占用或损坏',
      'no-speech': '未检测到语音，请重试或说话大声些',
      'network': '网络异常，语音识别需要联网，请检查网络',
      'aborted': '识别已取消'
    };
    const tip = tipMap[err] || ('识别出错：' + err);
    voiceText.textContent = '❌ ' + tip;
    // 立即收起浮层（不等延迟），让用户能立即重试或改用手动输入
    document.getElementById('voiceInBtn').classList.remove('recording');
    document.getElementById('voiceOutBtn').classList.remove('recording');
    overlay.classList.remove('show');
    // 权限类错误用醒目 toast 提示
    if (err === 'not-allowed' || err === 'service-not-allowed') {
      showToast('🔒 ' + tip);
    }
  };

  voiceRecognition.onend = function() {
    document.getElementById(mode === 'in' ? 'voiceInBtn' : 'voiceOutBtn').classList.remove('recording');
    setTimeout(() => overlay.classList.remove('show'), 500);
  };

  // 用 try/catch 包住 start()，捕获 InvalidStateError 等同步异常（连续启动/未停止场景）
  try {
    voiceRecognition.start();
  } catch (e) {
    overlay.classList.remove('show');
    document.getElementById('voiceInBtn').classList.remove('recording');
    document.getElementById('voiceOutBtn').classList.remove('recording');
    showToast('启动语音识别失败：' + (e && e.message ? e.message : '未知错误'));
  }
}

function stopVoice() {
  if (voiceRecognition) {
    voiceRecognition.stop();
  }
  document.getElementById('voiceOverlay').classList.remove('show');
}

function parseManualVoiceInput() {
  const text = document.getElementById('manualVoiceInput').value.trim();
  if (!text) { showToast('请输入内容'); return; }
  parseVoiceText(text, currentActionType);
  document.getElementById('manualVoiceInput').value = '';
  showToast('✅ 已填入');
}

function parseVoiceText(text, mode) {
  const names = loadGoodsNames();
  const results = matchGoodsFromText(text); // {idx: qty}，基于筐名+别名模糊匹配
  const count = Object.keys(results).length;
  if (count === 0) {
    document.getElementById('voiceTranscript').textContent = '未识别到筐名+数量，请重试';
    showToast('未识别到数据');
    return;
  }
  // 先展示识别结果，用户确认后才填入（防止听错/说错直接污染输入框）
  pendingVoiceResults = { results, mode };
  const rows = Object.keys(results).map(idx => `${names[idx]}：${results[idx]}`).join('，');
  document.getElementById('voiceConfirmInfo').textContent = rows;
  // 立即收起语音识别浮层（不等 onend 的500ms延迟），让确认框完全置顶显示
  document.getElementById('voiceOverlay').classList.remove('show');
  document.getElementById('voiceConfirmModal').classList.add('show');
}
let pendingVoiceResults = null;
function confirmVoiceFill() {
  if (!pendingVoiceResults) return;
  const { results, mode } = pendingVoiceResults;
  const names = loadGoodsNames();
  let filled = [];
  for (let idx in results) {
    const inputId = mode === 'in' ? 'giIn' + idx : 'giOut' + idx;
    const el = document.getElementById(inputId);
    if (el) {
      el.value = results[idx];
      filled.push(names[idx] + ':' + results[idx]);
    }
  }
  pendingVoiceResults = null;
  document.getElementById('voiceConfirmModal').classList.remove('show');
  showToast(`✅ 已填入 ${filled.join('、')}`);
}
function cancelVoiceFill() {
  pendingVoiceResults = null;
  document.getElementById('voiceConfirmModal').classList.remove('show');
  showToast('已取消');
}

// ======== 拍照OCR ========
let ocrCurrentResult = null; // { goodsIdx, qtyOut, rawText, trayType }
let ocrColumnOffset = 0; // 列偏移：数字与列错位时调整
let ocrCurrentImage = null;  // dataURL 用于弹窗预览

// 相册选：优先用 showOpenFilePicker（安卓 PWA 可用），fallback 原生 input
function openAlbumPicker(type, ev) {
  if (ev) { ev.preventDefault(); ev.stopPropagation(); }
  if (window.showOpenFilePicker) {
    try {
      showOpenFilePicker({ types: [{ description: '图片', accept: { 'image/*': ['.jpg','.jpeg','.png','.webp','.bmp'] } }], multiple: false })
        .then(async (handles) => {
          if (!handles || !handles[0]) return;
          const file = await handles[0].getFile();
          if (!file) return;
          const fake = { target: { files: [file] } };
          if (type === 'store') handleStorePhoto(fake);
          else handlePhoto(fake);
        })
        .catch(() => { /* 用户取消或不可用，fallback */ triggerAlbumInput(type); });
    } catch (e) { triggerAlbumInput(type); }
  } else {
    triggerAlbumInput(type);
  }
}
function triggerAlbumInput(type) {
  // 方案1：直接触发已有 input
  const el = document.getElementById(type === 'store' ? 'storeOcrAlbumInput' : 'photoAlbumInput');
  if (el) {
    try { el.click(); } catch (e) {}
  }
  // 方案2：动态创建可见 file input 触发（小米 WebView 需可见 input 才响应）
  try {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;opacity:0;z-index:99999;cursor:pointer;';
    const cleanup = () => { try { document.body.removeChild(input); } catch (e) {} };
    if (type === 'store') input.onchange = (e) => { try { handleStorePhoto(e); } catch (err) {} cleanup(); };
    else input.onchange = (e) => { try { handlePhoto(e); } catch (err) {} cleanup(); };
    document.body.appendChild(input);
    input.click();
  } catch (e) {}
}

function handlePhoto(event) {
  const file = event.target.files[0];
  if (!file) return;
  // 立刻关闭拍照弹窗，显示加载动画
  closePhotoInputModal();
  showLoading('正在加载图片…');
  const reader = new FileReader();
  reader.onload = function(e) {
    ocrCurrentImage = e.target.result;
    doOCR(e.target.result, file);
  };
  reader.readAsDataURL(file);
}

async function doOCR(imageDataUrl, file) {
  const keys = loadOcrKeys();
  if (!keys.apiKey || !keys.secretKey) {
    hideLoading(); // 关键：未配置密钥时先关掉加载遮罩，避免全屏卡死
    showToast('请先在设置页配置百度OCR密钥');
    return;
  }

  showLoading('正在识别…');
  try {
    // 1. 获取 access token（带缓存，24小时内不重复请求）
    updateLoadingStep('正在准备…', 5);
    const accessToken = await getOcrAccessToken(keys.apiKey, keys.secretKey);
    if (!accessToken) throw new Error('获取token失败');
    checkOcrCancel();

    // 2. 压缩图片（本地预处理，毫秒级）
    updateLoadingStep('正在处理图片…', 10);
    const compressedBase64 = await compressImage(imageDataUrl, 1600);
    const imgBase64 = compressedBase64.replace(/^data:image\/\w+;base64,/, '');
    const imgEnc = encodeURIComponent(imgBase64);
    checkOcrCancel();

    // 3. 并行调用：表格识别（结构化）+ 通用高精度（兜底/交叉验证）
    updateLoadingStep('🔍 正在定位表格…', 25);
    let ocrData = null;
    let usedTable = false;
    let generalWords = null;
    try {
      const [tblPromise, genPromise] = await Promise.all([
        fetch(CORS_PROXY + encodeURIComponent(`https://aip.baidubce.com/rest/2.0/ocr/v1/table?access_token=${accessToken}`), {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `image=${imgEnc}`
        }),
        fetch(CORS_PROXY + encodeURIComponent(`https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic?access_token=${accessToken}`), {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `image=${imgEnc}&language_type=CHN_ENG&detect_direction=true&paragraph=false&probability=false`
        })
      ]);
      checkOcrCancel();
      updateLoadingStep('🔍 正在识别文字…', 55);
      const [tblData, genData] = await Promise.all([tblPromise.json(), genPromise.json()]);
      if (genData.words_result) generalWords = genData.words_result.map(x => x.words);
      // 表格识别成功 → 用表格结构化结果
      if (tblData.tables_result && tblData.tables_result.length > 0) {
        const converted = convertTableResult(tblData);
        if (converted && converted.length > 0) {
          const blob = converted.join(' ');
          const hasTrayKeyword = /(冷藏|冷冻|常温|面包|鲜食)/.test(blob);
          if (hasTrayKeyword) {
            ocrData = { words_result: converted.map(w => ({ words: w })) };
            usedTable = true;
          }
        }
      }
    } catch(e) { /* 并行识别失败则走兜底 */ }

    // 4. 表格识别不可用 → 用通用 OCR 结果
    if (!ocrData && generalWords && generalWords.length > 0) {
      ocrData = { words_result: generalWords.map(w => ({ words: w })) };
    }

    // 5. 手写单增强：检测「鲜食/手写」→ 调用手写专用 API 补充（提高数字识别率）
    let handwritingWords = null;
    if (ocrData) {
      const blob = (ocrData.words_result || []).map(x => x.words).join(' ');
      if (/(鲜食|手写|顶汇|当日出框)/.test(blob)) {
        try {
          updateLoadingStep('✍️ 检测到手写单，增强识别…', 70);
          const hwResp = await fetch(CORS_PROXY + encodeURIComponent(`https://aip.baidubce.com/rest/2.0/ocr/v1/handwriting?access_token=${accessToken}`), {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `image=${imgEnc}&language_type=CHN_ENG`
          });
          const hwData = await hwResp.json();
          if (hwData.words_result) handwritingWords = hwData.words_result.map(x => x.words);
        } catch(e) {}
      }
    }
    // 有手写补充结果且主结果缺失关键词 → 优先手写结果
    if (handwritingWords && handwritingWords.length > 0) {
      ocrData = { words_result: handwritingWords.map(w => ({ words: w })) };
    }

    // 5.5 并行调用腾讯云 OCR（交叉验证：两引擎结果对比）
    let tcloudWords = null;
    try {
      updateLoadingStep('🔄 双引擎交叉验证…', 80);
      const tcResp = await fetch('/tcloud', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: imgBase64 })
      });
      const tcData = await tcResp.json();
      if (tcData.ok && tcData.words && tcData.words.length > 0) tcloudWords = tcData.words;
    } catch(e) {}
    checkOcrCancel();

    hideLoading();
    checkOcrCancel();

    if (!ocrData || !ocrData.words_result) {
      throw new Error(ocrData?.error_msg || '识别失败');
    }

    // 记录识别来源（表格识别=高置信）
    ocrData._highConf = !!usedTable;

    // 6. 解析识别结果
    parseOcrResult(ocrData);
    // 7. 交叉验证：腾讯云结果与百度结果对比，不一致标黄
    crossValidateOcr(ocrCurrentResult, tcloudWords);
    refreshOcrQtyCol();

    // 7. 识别完成，关闭拍照弹窗，只保留结果弹窗
    closePhotoInputModal();

  } catch(error) {
    hideLoading();
    if (error.message === '已取消') return;
    console.error('OCR error:', error);
    showToast('识别失败: ' + error.message);
    closePhotoInputModal();
  }
}

// 表格识别结果 → words 列表（供现有解析器复用）
function convertTableResult(tblData) {
  const words = [];
  const tables = tblData.tables_result || [];
  for (const table of tables) {
    const body = table.body || [];
    if (!body.length) continue;
    // 按行分组
    const rows = {};
    for (const cell of body) {
      const rk = (cell.row_start === undefined ? 0 : cell.row_start) + '-' + (cell.row_end === undefined ? 0 : cell.row_end);
      if (!rows[rk]) rows[rk] = [];
      rows[rk].push({ c: cell.col_start || 0, t: (cell.words || '').replace(/\n/g, ' ') });
    }
    // 把每个单元格按列顺序拼成行字符串
    Object.keys(rows).sort((a, b) => parseInt(a.split('-')[0]) - parseInt(b.split('-')[0]))
      .forEach(rk => {
        const cells = rows[rk].sort((a, b) => a.c - b.c);
        const line = cells.map(x => x.t.trim()).join(' ').trim();
        if (line) words.push(line);
      });
  }
  return words;
}

function compressImage(dataUrl, maxSize) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = function() {
      let w = img.width, h = img.height;
      // 保留更高分辨率（1600px），路单文字多需要细节
      if (w > maxSize || h > maxSize) {
        if (w > h) { h = h * maxSize / w; w = maxSize; }
        else { w = w * maxSize / h; h = maxSize; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      // 白底（抗反光/阴影干扰）
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      // 自动对比度增强（保留彩色，提升文字清晰度）
      try {
        const imageData = ctx.getImageData(0, 0, w, h);
        const d = imageData.data;
        // 计算亮度范围，做线性拉伸
        let min = 255, max = 0;
        for (let i = 0; i < d.length; i += 4) {
          const lum = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
          if (lum < min) min = lum;
          if (lum > max) max = lum;
        }
        const range = max - min;
        if (range > 20 && range < 220) {
          const scale = 255 / range;
          for (let i = 0; i < d.length; i += 4) {
            d[i] = Math.max(0, Math.min(255, (d[i] - min) * scale));
            d[i+1] = Math.max(0, Math.min(255, (d[i+1] - min) * scale));
            d[i+2] = Math.max(0, Math.min(255, (d[i+2] - min) * scale));
          }
          ctx.putImageData(imageData, 0, 0);
        }
      } catch(e) {}
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.src = dataUrl;
  });
}

// 编辑距离（OCR 店名错 1-2 个字也能匹配）
function levenshtein(a, b) {
  a = String(a); b = String(b);
  if (a.length < b.length) return levenshtein(b, a);
  if (!b.length) return a.length;
  const row = Array.from({length: b.length + 1}, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j-1] + 1, prev + (a[i-1] === b[j-1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

// 智能补行：识别出的编号有缺口时，从已配置门店自动补全（利用门店固定的先验）
function fillMissingStores(rows, storeCfg) {
  if (!rows || rows.length < 2) return rows;
  const nums = rows.map(r => {
    const p = String(r.code || '').split('-');
    return p.length === 2 ? parseInt(p[1], 10) : -1;
  }).filter(n => n >= 0);
  if (nums.length < 2) return rows;
  const min = Math.min(...nums), max = Math.max(...nums);
  const present = new Set(nums);
  const missing = [];
  for (let i = min; i <= max; i++) {
    if (!present.has(i)) missing.push(i);
  }
  if (!missing.length) return rows;
  // 从配置门店里找这些缺失编号对应的店（通过编号别名或店名模糊匹配）
  const routeNum = String(rows[0].code || '').split('-')[0];
  const routePrefix = String(rows[0].code || '').replace(/-.*$/, '');
  const addedRows = [];
  missing.forEach(n => {
    const targetCode = routePrefix + '-' + n;
    let found = null;
    for (const s of storeCfg || []) {
      const aliases = s.aliases || [];
      // 别名精确匹配编号
      if (aliases.some(a => String(a).trim() === targetCode || String(a).trim().endsWith('-' + n) && /^\d+$/.test(String(a).trim().split('-').pop()))) {
        found = s; break;
      }
    }
    if (found) {
      addedRows.push({ code: targetCode, name: found.name, nums: [0], _rawNums: [], _missing: true });
    }
  });
  if (!addedRows.length) return rows;
  // 按编号插入原 rows（保持顺序）
  const all = rows.concat(addedRows);
  all.sort((a, b) => {
    const na = parseInt(String(a.code).split('-')[1] || '0', 10);
    const nb = parseInt(String(b.code).split('-')[1] || '0', 10);
    return na - nb;
  });
  return all;
}

// 交叉验证：腾讯云结果 vs 百度结果，数字不一致的行标黄（提示用户核对）
function crossValidateOcr(result, tcloudWords) {
  if (!result || !result.rows || !tcloudWords || !tcloudWords.length) return;
  result.rows.forEach(r => {
    if (!r.code) return;
    const codeStr = String(r.code);
    // 在腾讯结果里找包含该编号的行
    const hit = tcloudWords.find(w => String(w).includes(codeStr));
    if (!hit) return;
    // 编号后提取数字（第一个数字近似该店数量）
    const idx = String(hit).indexOf(codeStr);
    const rest = String(hit).slice(idx + codeStr.length);
    const nums = rest.match(/\d+/g);
    if (!nums || !nums.length) return;
    const tcVal = parseInt(nums[0], 10);
    const myVal = r.nums && r.nums[0] !== undefined ? r.nums[0] : 0;
    // 不一致 → 标记低置信（黄色待核对）
    if (tcVal !== myVal) r._conflict = true;
  });
}

function parseOcrResult(ocrData) {
  const names = loadGoodsNames();
  const cfg = loadGoodsConfig();
  const words = ocrData.words_result.map(item => item.words);

  // 1. 识别抬头判断筐类型
  let goodsIdx = -1;
  const headerKeywords = cfg.map((g, idx) => {
    const base = [g.name, ...g.aliases].filter(Boolean);
    const ws = [];
    base.forEach(b => { ws.push(b); ws.push(b + '配送'); ws.push(b + '路单'); });
    return { idx, words: ws };
  });
  const allText = words.join(' ');
  for (let p of headerKeywords) {
    for (let kw of p.words) {
      if (allText.includes(kw)) { goodsIdx = p.idx; break; }
    }
    if (goodsIdx >= 0) break;
  }

  // 2. 找表头中要识别的列索引（按抬头决定找哪一列）
  // 不同抬头的单据，要识别的列名不同：面包路单→面包筐，冷藏/冷冻→物流篮，常温→物流箱
  // 关键：colCnt 只对「数字类列」计数（不含路线编号/门店名称），使表头列序与 nums 数字序对齐
  const TARGET_COLS = {
    0: ['鲜食筐', '面包筐', '发货', '发出'],     // 鲜食筐（手写单也支持）
    1: ['面包筐', '发货', '发出'],               // 面包筐
    2: ['物流篮', '物流箱', '物流筐', '发货', '发出'],  // 低温筐
    3: ['物流篮', '物流箱', '物流筐', '发货', '发出'],  // 冷冻筐
    4: ['物流箱', '物流筐', '整箱数量', '整箱', '发货', '发出']  // 常温筐
  };
  const targetCols = TARGET_COLS[goodsIdx] || ['物流箱', '物流筐', '物流篮', '整箱数量'];
  // 数字类列关键词（表头里代表数量的列名）
  const NUM_COL_KWS = ['整箱', '物流箱', '物流筐', '物流篮', '低温', '常温', '冷冻', '鲜食', '面包',
    '筐', '箱', '篮', '袋', '笼车', '冰板', '甜品', '纸箱', '信差', '保温', '数量', '发货', '发出', '回收'];
  let logisticsColIdx = -1;
  let colCnt = 0;
  for (const w of words) {
    const tokens = w.split(/\s+/);
    for (const t of tokens) {
      const isNumCol = NUM_COL_KWS.some(k => t.includes(k));
      if (isNumCol) {
        if (targetCols.some(k => t.includes(k)) && logisticsColIdx < 0) {
          logisticsColIdx = colCnt; // 目标列是当前第几个数字列
        }
        colCnt++;
      }
    }
    if (logisticsColIdx >= 0) break;
  }
  // 兜底：取第一个数字列
  if (logisticsColIdx < 0) logisticsColIdx = 0;

  // 3. 用 parseStoreOcr 提取所有门店（处理分行、错字等情况）
  const stores = parseStoreOcr(words);
  if (stores.length === 0) {
    // 兜底：直接按行解析（OCR 把整行作为一个 word）
    for (const w of words) {
      const m = w.match(/^[A-Za-z]*\s*0*(\d{1,3})\s*[\-–−_]\s*0*(\d{1,3})\b/i);
      if (!m) continue;
      if (/合计/.test(w)) continue;
      const code = parseInt(m[1], 10) + '-' + parseInt(m[2], 10);
      let rest = w.slice(m.index + m[0].length).trim();
      rest = rest.replace(/^\s*\d{1,2}[:：]\d{2}(?:[:：]\d{2})?\s*/, '').trim(); // 去行首时间
      const tokens = rest.split(/\s+/).filter(Boolean);
      const nums = [];
      const nameParts = [];
      tokens.forEach(t => { if (/^\d+$/.test(t)) nums.push(parseInt(t, 10)); else nameParts.push(t); });
      const name = nameParts.join('').trim();
      if (name) stores.push({ code, name });
    }
  }

  // 4. 对每个门店，从原始 word 中提取编号/时间之后的数字
  let rows = [];
  stores.forEach(s => {
    let nums = [];
    // 策略A：找到包含 s.code 的原始 word，从编号后提取数字
    const codeStr = s.code.replace('-', '\\-');
    for (const w of words) {
      if (w.match(new RegExp(codeStr))) {
        const m = w.match(/^[A-Za-z]*\s*0*(\d{1,3})\s*[\-–−_]\s*0*(\d{1,3})\b/i);
        if (m) {
          const code = parseInt(m[1], 10) + '-' + parseInt(m[2], 10);
          let rest = w.slice(m.index + m[0].length).trim();
          rest = rest.replace(/^\s*\d{1,2}[:：]\d{2}(?:[:：]\d{2})?\s*/, '').trim(); // 去时间
          const ms = rest.match(/\d+/g) || [];
          nums = ms.map(x => parseInt(x, 10));
          break;
        }
      }
    }
    // 策略A续：当前 word 无数字 → 从后续 words 收集（分行布局）
    if (nums.length === 0) {
      let pos = -1;
      for (let i = 0; i < words.length; i++) {
        if (words[i].includes(s.code) || words[i].includes(s.name.slice(0,4))) { pos = i; break; }
      }
      if (pos >= 0) {
for (let j = pos + 1; j < Math.min(pos + 14, words.length); j++) {
            // 下一行编号(43-05 / HN43-05 / W011-02 / HR42-03)直接停止，且不把编号里的数字收进去
            if (/^[A-Z]*\s*\d{1,3}\s*[\-–−_]\s*\d{1,3}(?=\s|$)/i.test(words[j])) break;
            const m2 = words[j].match(/\d+/g);
            if (m2) {
              if (/^\d{1,2}[:：]\d{2}/.test(words[j])) continue;
              m2.forEach(x => { nums.push(parseInt(x, 10)); });
            }
            // 合计行 / 表头标志 停止
            if (/合计/.test(words[j]) || /^(发出|回收|整箱|物流)/.test(words[j].trim())) break;
          }
      }
    }
    // 取识别到的目标列；若未找到或值异常（疑似代号/时间），则取nums中合理的发出数量
    // 合理范围：1-999 的数字（排除 6 位店代号、时间 HHMM）
    let li = 0;
    if (logisticsColIdx >= 0 && nums[logisticsColIdx] !== undefined && nums[logisticsColIdx] < 1000) {
      li = nums[logisticsColIdx];
    } else {
      // 兜底：从末尾往前找第一个合理数字（1-999）
      for (let i = nums.length - 1; i >= 0; i--) {
        if (nums[i] > 0 && nums[i] < 1000) { li = nums[i]; break; }
      }
      if (!li && nums[0] !== undefined && nums[0] < 1000) li = nums[0];
    }
    rows.push({ code: s.code, name: s.name, nums: [li], _rawNums: nums.slice() });
  });

  // 5. 找合计行（精确：包含"合计"且含数字，排除抬头里的"总数"等）
  let totalNums = [];
  for (const w of words) {
    if (w.includes('合计') || w.includes('共计') || /^总\s/.test(w)) {
      const matches = w.match(/\d+/g);
      if (matches && matches.length >= 2) {
        totalNums = matches.map(s => parseInt(s, 10));
        break;
      }
    }
  }
  // 合计行只保留物流箱一列
  let totalFiltered = [0];
  if (totalNums.length >= 1) {
    totalFiltered[0] = (totalNums[logisticsColIdx] !== undefined ? totalNums[logisticsColIdx] : (totalNums[0] || 0));
  }

  // ===== 智能补行：利用「门店固定」先验，编号缺口自动补全 =====
  rows = fillMissingStores(rows, loadStoreConfig());
  // 表格识别来源 → 高置信标记（数字可信，绿色）
  const highConf = !!ocrData._highConf;
  if (highConf) {
    rows.forEach(r => { if (!r._missing) r._highConf = true; });
  }

  ocrCurrentResult = {
    goodsIdx,
    rows: rows.map(r => ({ ...r, nums: r.nums.slice() })),
    _rawTotalNums: totalNums,
    totalNums: totalFiltered.slice(),
    logisticsColIdx,
    rawText: words.join('\n'),
    words: words.slice(0, 30), // 供 debug
    trayType: goodsIdx >= 0 ? names[goodsIdx] : '未识别'
  };

  // 渲染
  document.getElementById('ocrModeLabel').textContent = currentActionType === 'out' ? '回收' : '发出';
  document.getElementById('ocrGoodsLabel').textContent = ocrCurrentResult.trayType;
  const rawEl = document.getElementById('ocrRawText');
  if (rawEl) rawEl.textContent = ocrCurrentResult.rawText;
  refreshOcrQtyCol();
  document.getElementById('ocrResultModal').classList.add('show');
}

// 渲染 OCR 表格（只显示物流箱一列；编号/门店/数字均可编辑）
function refreshOcrQtyCol() {
  if (!ocrCurrentResult) return;
  const rows = ocrCurrentResult.rows;
  const maxNumCols = 1;

  let html = '<div style="overflow-x:auto;"><table class="summary-table" style="margin-top:6px;min-width:100%;">';
  html += '<thead><tr><th style="min-width:58px;">编号</th><th style="min-width:120px;text-align:left;padding-left:6px;">门店</th><th style="min-width:66px;background:var(--warning);color:#fff;">物流箱</th><th style="min-width:28px;"></th></tr></thead><tbody>';
  rows.forEach((r, i) => {
    // 自动补的行：黄色警示背景提示用户核对
    const isMissing = r._missing;
    // 高置信（表格识别）：数量框绿色
    const isHighConf = r._highConf;
    // 双引擎不一致：标黄待核对（优先于绿色）
    const isConflict = r._conflict;
    const rowBg = isMissing || isConflict ? ' style="background:#fff3cd;"' : '';
    const hint = isMissing ? ' <span style="color:var(--warning);font-size:11px;">⚠️可能漏识别</span>' : (isConflict ? ' <span style="color:#e65100;font-size:11px;">⚠️两引擎结果不同</span>' : '');
    html += '<tr' + rowBg + '>';
    html += '<td><input type="text" id="ocrCode_' + i + '" value="' + escapeHtml(r.code || '') + '" maxlength="10" style="width:60px;padding:5px;border:1px solid var(--border);border-radius:6px;font-size:14px;text-align:center;"></td>';
    html += '<td style="text-align:left;padding-left:6px;"><input type="text" id="ocrName_' + i + '" value="' + escapeHtml(r.name || '') + '" style="width:100%;padding:5px;border:1px solid var(--border);border-radius:6px;font-size:14px;">' + hint + '</td>';
    const v = r.nums[0] !== undefined ? r.nums[0] : 0;
    const qtyStyle = (isHighConf && !isConflict)
      ? 'width:64px;padding:5px;border:1.5px solid #10b981;border-radius:6px;font-size:14px;text-align:center;font-weight:600;color:#15803d;background:#f0fdf4;'
      : (isConflict
        ? 'width:64px;padding:5px;border:2px solid #e65100;border-radius:6px;font-size:14px;text-align:center;font-weight:700;color:#e65100;background:#fff3cd;'
        : 'width:64px;padding:5px;border:1.5px solid var(--warning);border-radius:6px;font-size:14px;text-align:center;font-weight:600;color:#b35900;');
    html += '<td style="background:' + (isHighConf && !isConflict ? '#f0fdf4;' : (isConflict ? '#fff3cd;' : '#fffde7;')) + '"><input type="number" id="ocrQty_' + i + '" value="' + v + '" min="0" style="' + qtyStyle + '"></td>';
    html += '<td><button onclick="removeOcrRow(' + i + ')" style="background:none;border:none;color:var(--danger);font-size:20px;cursor:pointer;padding:0 6px;line-height:1;">×</button></td>';
    html += '</tr>';
  });
  if (rows.length > 0) {
    let sum = 0;
    rows.forEach((r, i) => {
      const inp = document.getElementById('ocrQty_' + i);
      if (inp) sum += parseInt(inp.value) || 0;
    });
    html += '<tr class="total-row"><td>合计</td><td></td><td style="background:#fff3cd;font-weight:700;color:#b35900;" id="ocrTotalCell_0">' + sum + '</td><td></td></tr>';
  }
  html += '</tbody></table></div>';
  html += '<button onclick="addOcrRow()" style="margin-top:10px;padding:9px 14px;border:1.5px dashed var(--primary);border-radius:8px;background:#f0f7ff;color:var(--primary);font-size:13px;font-weight:600;cursor:pointer;width:100%;">➕ 新增一行（识别漏了时手动添加）</button>';
  document.getElementById('ocrEditFields').innerHTML = html;
  // 绑定 input 事件：编号/门店 改 r.code/r.name；物流箱 改 r.nums[0] 并重算合计
  rows.forEach((r, i) => {
    const codeInp = document.getElementById('ocrCode_' + i);
    const nameInp = document.getElementById('ocrName_' + i);
    const qtyInp = document.getElementById('ocrQty_' + i);
    if (codeInp) codeInp.addEventListener('input', e => { r.code = e.target.value; });
    if (nameInp) nameInp.addEventListener('input', e => { r.name = e.target.value; });
    if (qtyInp) {
      qtyInp.addEventListener('input', e => {
        r.nums[0] = parseInt(e.target.value) || 0;
        updateOcrTotal();
      });
    }
  });
  updateOcrTotal();
}

// 手动新增一行（识别漏了时）
function addOcrRow() {
  if (!ocrCurrentResult) return;
  // 自动推断下一个编号（基于现有编号数字部分最大值+1）
  let maxN = 0;
  ocrCurrentResult.rows.forEach(r => {
    const m = String(r.code || '').match(/(\d+)/);
    if (m) maxN = Math.max(maxN, parseInt(m[1]));
  });
  const nextCode = maxN > 0 ? (maxN + 1) + '' : '';
  ocrCurrentResult.rows.push({ code: nextCode, name: '', nums: [0], _rawNums: [] });
  refreshOcrQtyCol();
}

function updateOcrTotal() {
  if (!ocrCurrentResult) return;
  const rows = ocrCurrentResult.rows;
  // 重算两列的合计
  for (let c = 0; c < 1; c++) {
    let sum = 0;
    rows.forEach((r, i) => {
      const inp = document.getElementById('ocrQty_' + i);
      if (inp) sum += parseInt(inp.value) || 0;
    });
    const cell = document.getElementById('ocrTotalCell_' + c);
    if (cell) cell.textContent = sum;
  }
}

// 列偏移调整：当 OCR 漏识别或列错位时，按 +/- 偏移重算物流箱列

function removeOcrRow(i) {
  if (!ocrCurrentResult) return;
  ocrCurrentResult.rows.splice(i, 1);
  refreshOcrQtyCol();
}

function closeOcrResultModal() {
  document.getElementById('ocrResultModal').classList.remove('show');
  ocrCurrentResult = null;
  ocrCurrentImage = null;
}

function confirmOcrResult() {
  if (!ocrCurrentResult || !ocrCurrentResult.rows) { showToast('无识别结果'); return; }
  const goodsIdx = ocrCurrentResult.goodsIdx;
  if (goodsIdx < 0) { showToast('未识别到筐类型，请检查抬头'); return; }
  const date = document.getElementById('recordDate').value || todayStr();
  const names = loadGoodsNames();
  const storeNames = loadStoreNames();
  const data = loadData();
  const cfgAll = loadStoreConfig();
  let saved = 0, unmatched = 0, aliasAdded = 0;
  // 只录入物流箱列（index=0）
  ocrCurrentResult.rows.forEach((r, i) => {
    const inp = document.getElementById('ocrQty_' + i);
    const qty = parseInt(inp?.value || '0');
    if (!qty || qty <= 0) return;
    let storeIdx = -1;
    // 店名模糊匹配：去除常见 OCR 错认字（店/分/总/路）+ 一致性匹配
    const normName = (s) => String(s || '').replace(/[店分总路 ]/g, '');
    const rNameNorm = normName(r.name);
    const rCodeNorm = String(r.code || '').replace(/^[A-Za-z]+/, '').toLowerCase();
    for (let si = 0; si < cfgAll.length; si++) {
      const s = cfgAll[si];
      // 1) 店名完全匹配
      if (s.name === r.name) { storeIdx = si; break; }
      // 2) 标准化后匹配（容错"店"字等）
      if (rNameNorm && normName(s.name) === rNameNorm) { storeIdx = si; break; }
      // 3) 店名包含关系（防 OCR 截断）
      if (rNameNorm && normName(s.name).includes(rNameNorm) && rNameNorm.length >= 4) { storeIdx = si; break; }
      // 4) 别名匹配（原始）
      if (s.aliases && (s.aliases.includes(r.code) || s.aliases.includes(r.name))) { storeIdx = si; break; }
      // 5) 别名模糊匹配
      if (s.aliases) {
        const aliasMatch = s.aliases.some(a => {
          const an = normName(a);
          return an === rNameNorm || (an.includes(rNameNorm) && rNameNorm.length >= 4);
        });
        if (aliasMatch) { storeIdx = si; break; }
      }
      // 6) 编号归一化后匹配别名（HR42-01 和 HR42-01 + OCR 前缀错认归一化）
      if (s.aliases && rCodeNorm) {
        const codeMatch = s.aliases.some(a => String(a).replace(/^[A-Za-z]+/, '').toLowerCase() === rCodeNorm);
        if (codeMatch) { storeIdx = si; break; }
      }
      // 7) 编辑距离匹配（OCR 错 1-2 个字也能命中配置门店）
      if (rNameNorm && rNameNorm.length >= 4) {
        const ed = levenshtein(normName(s.name), rNameNorm);
        if (ed <= 2) { storeIdx = si; break; }
      }
      // 8) 编号尾号匹配：35-12 → 尾号 12 → 匹配别名"12店"/"12"
      if (s.aliases && r.code) {
        const parts = String(r.code).split('-');
        const tail = parts.length === 2 ? parts[1].replace(/^0+/, '') : '';
        if (tail) {
          const tailMatch = s.aliases.some(a => String(a).replace(/店$/, '') === tail);
          if (tailMatch) { storeIdx = si; break; }
        }
      }
    }
    if (storeIdx < 0) { unmatched++; return; }
    // 编号变化自动加别名：识别出的编号不在该门店别名里 → 自动新增，下次识别到新编号也能匹配
    if (r.code) {
      const codeStr = String(r.code).trim();
      if (codeStr && cfgAll[storeIdx]) {
        const s = cfgAll[storeIdx];
        if (!s.aliases) s.aliases = [];
        if (!s.aliases.includes(codeStr)) {
          s.aliases.push(codeStr);
          aliasAdded++;
        }
      }
    }
    const existing = data.find(x => x.date === date && x.storeIdx === storeIdx && x.goodsIdx === goodsIdx);
    if (existing) {
      if (currentActionType === 'out') existing.qtyOut = qty;
      else existing.qtyIn = qty;
      existing.source = 'ocr';
      existing.updatedAt = new Date().toISOString();
    } else {
      data.push({
        id: Date.now() + '-ocr-' + storeIdx + '-' + goodsIdx,
        date, storeIdx, storeName: storeNames[storeIdx] || '',
        goodsIdx, goodsName: names[goodsIdx],
        qtyIn: currentActionType === 'out' ? 0 : qty,
        qtyOut: currentActionType === 'out' ? qty : 0,
        source: 'ocr', createdAt: new Date().toISOString()
      });
    }
    saved++;
  });
  saveDataArr(data);
  if (aliasAdded > 0) {
    saveStoreConfig(cfgAll);
    try { initStoreSelect('recordStore'); renderStoreChips(); } catch(e) {}
  }
  closeOcrResultModal();
  reloadRecordInputs();
  renderTodayOverview();
  if (saved > 0) {
    showToast('✅ 已录入 ' + saved + ' 条' + (unmatched > 0 ? '，' + unmatched + ' 条未匹配被跳过' : '') + (aliasAdded > 0 ? '，自动新增 ' + aliasAdded + ' 个别名' : ''));
  } else {
    showToast('⚠️ 未匹配到任何店面，请在店面管理里检查别名设置');
  }
}

// ======== 历史记录页 ========
function initGoodsFilter() {
  const names = loadGoodsNames();
  const filterSel = document.getElementById('filterGoods');
  filterSel.innerHTML = '<option value="">全部筐</option>';
  names.forEach((name, i) => {
    const opt = document.createElement('option');
    opt.value = i; opt.textContent = name;
    filterSel.appendChild(opt);
  });
}

// ======== 日报生成（发仓库用） ========
let dailyReportState = { line: '全部', month: '', stores: [], fields: {} };

// 识别门店线路（从编号别名 42-1 → 42线）
function detectStoreLine(store) {
  const aliases = store.aliases || [];
  for (const a of aliases) {
    const m = String(a).match(/^(\d{1,3})\s*[-–−_]\s*\d{1,3}$/);
    if (m) return m[1] + '线';
  }
  return '';
}

function openDailyReport() {
  const modal = document.getElementById('dailyReportModal');
  if (!modal) return;
  // 加载上次选择
  try {
    const saved = JSON.parse(localStorage.getItem('kuanwei_daily_pref') || 'null');
    if (saved) dailyReportState = { ...dailyReportState, ...saved };
  } catch(e) {}
  // 默认月份 = 本月
  const now = new Date();
  const defMonth = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
  const monthEl = document.getElementById('dailyReportMonth');
  if (monthEl) monthEl.value = dailyReportState.month || defMonth;
  dailyReportState.month = dailyReportState.month || defMonth;
  // 线路
  const cfg = loadStoreConfig();
  const lines = new Set();
  cfg.forEach(s => { const l = detectStoreLine(s); if (l) lines.add(l); });
  const lineArr = ['全部', ...[...lines].sort()];
  const lineBox = document.getElementById('dailyReportLines');
  lineBox.innerHTML = lineArr.map(l =>
    `<button class="btn ${(dailyReportState.line === l) ? 'btn-primary' : 'btn-outline'}" style="padding:5px 12px;font-size:12px;width:auto;display:inline-block;" onclick="dailySelLine('${l}')">${l}</button>`).join('');
  setTimeout(updateDailyLivePreview, 0);
  // 门店（按线路过滤）
  renderDailyStores();
  // 信息项勾选
  const fields = dailyReportState.fields || {};
  ['emit','recv','today','mon_recv','mon_emit','owe'].forEach(k => {
    const el = document.getElementById('drf_' + k);
    if (el) el.checked = (fields[k] === undefined) ? true : fields[k];
  });
  modal.classList.add('show');
}
function closeDailyReportModal() {
  document.getElementById('dailyReportModal').classList.remove('show');
}
function dailySelLine(line) {
  dailyReportState.line = line;
  // 刷新线路按钮样式 + 门店
  const lineBox = document.getElementById('dailyReportLines');
  const btns = lineBox.querySelectorAll('button');
  btns.forEach(b => {
    b.className = 'btn ' + (b.textContent === line ? 'btn-primary' : 'btn-outline');
  });
  renderDailyStores();
  setTimeout(updateDailyLivePreview, 0);
}
function renderDailyStores() {
  const cfg = loadStoreConfig();
  const line = dailyReportState.line;
  const list = cfg.filter(s => line === '全部' || detectStoreLine(s) === line);
  const sel = dailyReportState.stores || [];
  const box = document.getElementById('dailyReportStores');
  box.innerHTML = list.map((s, i) => {
    const checked = sel.length === 0 || sel.includes(s.name) ? 'checked' : '';
    return `<label style="display:flex;align-items:center;gap:6px;font-size:13px;"><input type="checkbox" class="dr-store" data-name="${escapeHtml(s.name)}" ${checked} onchange="updateDailyLivePreview()"> ${escapeHtml(s.name)}</label>`;
  }).join('');
  dailyReportState._lineStores = list.map(s => s.name);
}
function dailySelAllStores(all) {
  const box = document.getElementById('dailyReportStores');
  box.querySelectorAll('input.dr-store').forEach(cb => { cb.checked = all; });
  setTimeout(updateDailyLivePreview, 0);
}
function collectDailySelection() {
  const sel = [];
  const box = document.getElementById('dailyReportStores');
  box.querySelectorAll('input.dr-store:checked').forEach(cb => sel.push(cb.dataset.name));
  dailyReportState.stores = sel;
  const fields = {};
  ['emit','recv','today','mon_recv','mon_emit','owe'].forEach(k => {
    const el = document.getElementById('drf_' + k);
    fields[k] = el ? el.checked : true;
  });
  dailyReportState.fields = fields;
  dailyReportState.month = document.getElementById('dailyReportMonth').value;
}

function generateDailyReport() {
  collectDailySelection();
  const names = loadGoodsNames();
  const cfg = loadStoreConfig();
  const month = dailyReportState.month;
  const [y, m] = month.split('-');
  const monthLabel = parseInt(m, 10) + '月';
  const today = todayStr();
  const todayLabel = parseInt(today.split('-')[2], 10) + '日';
  const lineLabel = dailyReportState.line === '全部' ? '全部线路' : dailyReportState.line;

  // 选中门店集合（按名称）
  const selNames = new Set(dailyReportState.stores.length ? dailyReportState.stores : cfg.map(s => s.name));
  const data = loadData();

  // 今天 + 选中的门店记录（额外发收=所有门店，始终纳入）
  const isExtra = (r) => r.extra || r.storeIdx === -1 || r.storeName === '额外发收';
  const todayData = data.filter(r => r.date === today && (isExtra(r) || selNames.has(r.storeName || '')));
  // 本月 + 选中门店（额外发收始终纳入）
  const monthData = data.filter(r => r.date.startsWith(month) && (isExtra(r) || selNames.has(r.storeName || '')));
  // 累计欠框（本月 发出-回收）
  const owe = {};
  names.forEach((n, i) => { owe[i] = { emit: 0, recv: 0 }; });
  monthData.forEach(r => { if (owe[r.goodsIdx]) { owe[r.goodsIdx].emit += r.qtyIn || 0; owe[r.goodsIdx].recv += r.qtyOut || 0; } });

  const f = dailyReportState.fields;
  let lines = [];
  lines.push(`${lineLabel} ${todayLabel}`);
  lines.push('');

  // 各店：今日发出/回收（有数据的筐）
  if (f.emit || f.recv) {
    const selStores = [...selNames];
    // 按 cfg 顺序
    cfg.filter(s => selNames.has(s.name)).forEach(s => {
      const rows = todayData.filter(r => (r.storeName || '') === s.name);
      if (!rows.length) return;
      const parts = [];
      names.forEach((n, i) => {
        const emit = rows.reduce((sum, r) => sum + (r.goodsIdx === i ? r.qtyIn : 0), 0);
        const recv = rows.reduce((sum, r) => sum + (r.goodsIdx === i ? r.qtyOut : 0), 0);
        if (emit > 0 && f.emit && f.recv) parts.push(`发出 ${emit} 筐${n}、回收 ${recv} 筐${n}`);
        else if (emit > 0 && f.emit) parts.push(`发出 ${emit} 筐${n}`);
        else if (recv > 0 && f.recv) parts.push(`回收 ${recv} 筐${n}`);
      });
      if (parts.length) lines.push(`${s.name}：${parts.join('、')}`);
    });
    if (lines.length <= 2) lines.push('（今日无记录）');
    lines.push('');
  }

  // 今日回框合计（有数据的筐）
  if (f.today) {
    const todayOwe = {};
    names.forEach((n, i) => { todayOwe[i] = { recv: 0 }; });
    todayData.forEach(r => { if (todayOwe[r.goodsIdx]) todayOwe[r.goodsIdx].recv += r.qtyOut; });
    const recvLines = [];
    names.forEach((n, i) => { if (todayOwe[i].recv > 0) recvLines.push(`${n}回框 ${todayOwe[i].recv} 筐`); });
    if (recvLines.length) { lines.push(`${todayLabel}回框：${recvLines.join('、')}`); lines.push(''); }
  }

  // 本月累计
  const monRecvLines = [], monEmitLines = [], oweLines = [];
  names.forEach((n, i) => {
    if (owe[i].recv > 0) monRecvLines.push(`${n} ${owe[i].recv} 筐`);
    if (owe[i].emit > 0) monEmitLines.push(`${n} ${owe[i].emit} 筐`);
    const diff = owe[i].emit - owe[i].recv;
    if (diff !== 0) oweLines.push(`${n} ${diff} 筐`);
  });
  if (f.mon_recv && monRecvLines.length) lines.push(`${monthLabel}累计回框：${monRecvLines.join('、')}`);
  if (f.mon_emit && monEmitLines.length) lines.push(`${monthLabel}累计发出：${monEmitLines.join('、')}`);
  if (f.owe && oweLines.length) lines.push(`累计欠框：${oweLines.join('、')}`);

  const text = lines.join('\n');
  if (arguments[0] === true) return text; // 仅计算预览（实时预览用）
  // 打开"日报预览确认"弹窗，内容可编辑
  showDailyPreview(text);
  // 记住选择
  try { localStorage.setItem('kuanwei_daily_pref', JSON.stringify({ line: dailyReportState.line, month, stores: dailyReportState.stores, fields: dailyReportState.fields })); } catch(e) {}
}

// 实时预览：勾选变化时自动更新界面预览窗口
function updateDailyLivePreview() {
  try {
    collectDailySelection();
    const text = generateDailyReport(true);
    const box = document.getElementById('dailyLivePreview');
    if (box) {
      box.style.display = 'block';
      box.textContent = text;
    }
  } catch (e) { /* 预览出错静默 */ }
}

// 打开日报预览确认弹窗（内容可编辑）
function showDailyPreview(text) {
  document.getElementById('dailyPreviewText').value = text;
  document.getElementById('dailyPreviewModal').classList.add('show');
}
function closeDailyPreview() {
  document.getElementById('dailyPreviewModal').classList.remove('show');
}
// 确认生成：把编辑后的文字作为最终日报
function confirmDailyPreview() {
  const text = document.getElementById('dailyPreviewText').value;
  dailyReportState._text = text;
  closeDailyPreview();
  const prev = document.getElementById('dailyReportPreview');
  prev.style.display = 'block';
  prev.textContent = text;
  document.getElementById('dailyReportCopyBtn').style.display = 'block';
  showToast('✅ 日报已生成，可复制');
}

function copyDailyReport() {
  if (!dailyReportState._text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(dailyReportState._text).then(() => {
      showToast('✅ 已复制，去微信粘贴发仓库');
    }).catch(() => fallbackCopy());
  } else fallbackCopy();
}
function fallbackCopy() {
  const ta = document.createElement('textarea');
  ta.value = dailyReportState._text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  showToast('✅ 已复制，去微信粘贴发仓库');
}

// ======== 上交筐照片记录 ========
let pendingDailyPhotos = []; // 待保存的当天照片 base64
function openPhotoPanel() {
  const modal = document.getElementById('photoPanelModal');
  if (!modal) return;
  pendingDailyPhotos = [];
  const today = todayStr();
  document.getElementById('photoPanelDate').textContent = '日期：' + today;
  renderDailyPhotoList();
  modal.classList.add('show');
}
function closePhotoPanel() {
  document.getElementById('photoPanelModal').classList.remove('show');
}
function getPhotosKey(date) { return 'kuanwei_photos_' + date; }
function loadDailyPhotos(date) {
  try { return JSON.parse(localStorage.getItem(getPhotosKey(date)) || '[]'); }
  catch(e) { return []; }
}
function handleDailyPhoto(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const compressed = await compressImage(e.target.result, 900);
      pendingDailyPhotos.push(compressed);
      renderDailyPhotoList();
    } catch(err) { showToast('❌ 照片处理失败'); }
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}
function saveDailyPhotos() {
  if (pendingDailyPhotos.length === 0) { showToast('还没有新照片'); return; }
  const today = todayStr();
  const existing = loadDailyPhotos(today);
  const all = existing.concat(pendingDailyPhotos);
  try {
    localStorage.setItem(getPhotosKey(today), JSON.stringify(all));
    pendingDailyPhotos = [];
    renderDailyPhotoList();
    updateDailyPhotoInfo();
    showToast('✅ 已保存 ' + all.length + ' 张照片');
  } catch(e) {
    showToast('❌ 照片太多存不下，请删除一些');
  }
}
function renderDailyPhotoList() {
  const today = todayStr();
  const existing = loadDailyPhotos(today);
  const all = existing.concat(pendingDailyPhotos);
  const box = document.getElementById('photoPanelList');
  if (all.length === 0) {
    box.innerHTML = '<div style="font-size:12px;color:var(--text-light);">还没有照片，点「📷 拍/选照片」添加</div>';
    return;
  }
  box.innerHTML = all.map((p, i) => {
    const isNew = i >= existing.length;
    return `<div style="position:relative;width:90px;height:90px;">
      <img src="${p}" style="width:90px;height:90px;object-fit:cover;border-radius:6px;border:1px solid var(--border);" onclick="viewDailyPhoto(${i})">
      ${isNew ? '<span style="position:absolute;top:2px;left:2px;background:#f59e0b;color:#fff;font-size:10px;padding:1px 4px;border-radius:4px;">新</span>' : ''}
      <span style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,.5);color:#fff;font-size:12px;width:16px;height:16px;border-radius:50%;text-align:center;line-height:16px;cursor:pointer;" onclick="removeDailyPhoto(${i})">×</span>
    </div>`;
  }).join('');
}
function removeDailyPhoto(idx) {
  const today = todayStr();
  const existing = loadDailyPhotos(today);
  if (idx < existing.length) {
    const all = existing.slice();
    all.splice(idx, 1);
    localStorage.setItem(getPhotosKey(today), JSON.stringify(all));
    updateDailyPhotoInfo();
  } else {
    pendingDailyPhotos.splice(idx - existing.length, 1);
  }
  renderDailyPhotoList();
}
function viewDailyPhoto(idx) {
  const today = todayStr();
  const existing = loadDailyPhotos(today);
  const all = existing.concat(pendingDailyPhotos);
  if (all[idx]) {
    const w = window.open('', '_blank');
    if (w) { w.document.write('<img src="' + all[idx] + '" style="max-width:100%">'); }
  }
}
function updateDailyPhotoInfo() {
  const today = todayStr();
  const n = loadDailyPhotos(today).length;
  const el = document.getElementById('dailyPhotoInfo');
  if (el) el.textContent = n > 0 ? `📷 今天已存 ${n} 张上交筐照片` : '';
}

function renderHistory() {
  // 刷新店面筛选项
  const fs = document.getElementById('filterStore');
  if (fs) {
    const cur = fs.value;
    const storeNames = loadStoreNames();
    fs.innerHTML = '<option value="">全部店</option>';
    storeNames.forEach((n, i) => { const o = document.createElement('option'); o.value = i; o.textContent = n; fs.appendChild(o); });
    if (cur !== '' && storeNames[parseInt(cur)] !== undefined) fs.value = cur; else fs.value = '';
  }
  const filterDate = document.getElementById('filterDate').value;
  const filterGoods = document.getElementById('filterGoods').value;
  const filterStore = document.getElementById('filterStore').value;
  let data = loadData();
  if (filterDate) data = data.filter(r => r.date >= filterDate);
  if (filterStore !== '') data = data.filter(r => r.storeIdx === parseInt(filterStore) || r.extra || r.storeIdx === -1);
  if (filterGoods !== '') data = data.filter(r => r.goodsIdx === parseInt(filterGoods));
  data.sort((a, b) => {
    if (b.date !== a.date) return b.date.localeCompare(a.date);
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
  const container = document.getElementById('historyList');
  if (data.length === 0) {
    container.innerHTML = '<div class="empty">暂无记录</div>';
    return;
  }
  // 按日期分组
  const grouped = {};
  data.forEach(r => {
    if (!grouped[r.date]) grouped[r.date] = [];
    grouped[r.date].push(r);
  });
  const dates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));
  let html = '';
  dates.forEach(date => {
    html += `<div class="card" style="padding:10px;">`;
    html += `<div style="font-size:14px;font-weight:700;margin-bottom:6px;border-bottom:1px solid var(--border);padding-bottom:4px;">${date}</div>`;
    grouped[date].forEach(r => {
      const sourceIcon = r.source === 'ocr' ? '📸' : (r.source === 'voice' ? '🎤' : '✍️');
      const storeTag = r.storeName ? `<span style="font-size:11px;color:var(--primary);margin-left:6px;">🏪${r.storeName}</span>` : '';
      html += `
        <div class="record-item" style="box-shadow:none;border:1px solid #f0f0f0;margin-bottom:6px;">
          <div class="record-top">
            <span class="record-goods">${sourceIcon} ${r.goodsName}${storeTag}</span>
            <div style="display:flex;gap:6px;">
              <button class="del-btn" style="background:#f0f7ff;color:var(--primary);" onclick="openEditRecord('${r.id}')">编辑</button>
              <button class="del-btn" onclick="deleteRecord('${r.id}')">删除</button>
            </div>
          </div>
          <div class="record-qty">
            <span class="qty-tag"><span class="qname">发出</span><span class="qin">+${r.qtyIn}</span></span>
            <span class="qty-tag"><span class="qname">回收</span><span class="qout">-${r.qtyOut}</span></span>
          </div>
        </div>`;
    });
    html += '</div>';
  });
  container.innerHTML = html;
}

let pendingDeleteRecordId = null; // 待删除的记录 id
let pendingEditRecordId = null; // 待编辑的记录 id

// 编辑记录
function openEditRecord(id) {
  const data = loadData();
  const r = data.find(x => String(x.id) === String(id));
  if (!r) { showToast('记录不存在'); return; }
  pendingEditRecordId = id;
  const storeName = r.storeName || '未知店';
  document.getElementById('editRecordInfo').innerHTML =
    `📅 ${r.date} · 🏪 ${storeName} · ${r.goodsName || ''}`;
  document.getElementById('editQtyIn').value = r.qtyIn || 0;
  document.getElementById('editQtyOut').value = r.qtyOut || 0;
  document.getElementById('editRecordModal').classList.add('show');
}
function closeEditRecordModal() {
  document.getElementById('editRecordModal').classList.remove('show');
  pendingEditRecordId = null;
}
function confirmEditRecord() {
  if (pendingEditRecordId === null) return;
  const qIn = parseInt(document.getElementById('editQtyIn').value) || 0;
  const qOut = parseInt(document.getElementById('editQtyOut').value) || 0;
  if (qIn === 0 && qOut === 0) {
    showToast('发出和回收不能都是 0，请填一个');
    return;
  }
  let data = loadData();
  const r = data.find(x => String(x.id) === String(pendingEditRecordId));
  if (r) {
    r.qtyIn = qIn;
    r.qtyOut = qOut;
    r.updatedAt = new Date().toISOString();
    saveDataArr(data);
    closeEditRecordModal();
    renderHistory();
    renderTodayOverview();
    showToast('✅ 已修改');
  } else {
    showToast('记录不存在');
  }
}

// 删除记录：免提醒期内直接删，否则弹确认框
function deleteRecord(id) {
  // 检查免提醒期
  try {
    const until = parseInt(localStorage.getItem('kuanwei_del_confirm_until') || '0');
    if (until && Date.now() < until) {
      doDeleteRecord(id);
      return;
    }
  } catch(e) {}
  pendingDeleteRecordId = id;
  document.getElementById('recordDeleteModal').classList.add('show');
}

function closeRecordDeleteModal() {
  document.getElementById('recordDeleteModal').classList.remove('show');
  pendingDeleteRecordId = null;
}

function confirmDeleteRecord() {
  const noToday = document.getElementById('delNoRemindToday').checked;
  const no7d = document.getElementById('delNoRemind7d').checked;
  // 设置免提醒时间
  if (no7d) {
    localStorage.setItem('kuanwei_del_confirm_until', String(Date.now() + 7 * 24 * 3600 * 1000));
  } else if (noToday) {
    localStorage.setItem('kuanwei_del_confirm_until', String(Date.now() + 24 * 3600 * 1000));
  }
  closeRecordDeleteModal();
  if (pendingDeleteRecordId !== null) {
    doDeleteRecord(pendingDeleteRecordId);
    pendingDeleteRecordId = null;
  }
}

function doDeleteRecord(id) {
  let data = loadData();
  data = data.filter(r => String(r.id) !== String(id));
  saveDataArr(data);
  renderHistory();
  showToast('已删除');
}

function clearFilter() {
  document.getElementById('filterDate').value = '';
  document.getElementById('filterGoods').value = '';
  renderHistory();
}

function setFilterToday() {
  document.getElementById('filterDate').value = todayStr();
  renderHistory();
}

// ======== 汇总页 ========
function renderSummary() {
  // 刷新店面筛选项
  populateStoreFilter('summaryStore');
  const start = document.getElementById('summaryStart').value;
  const end = document.getElementById('summaryEnd').value;
  const summaryStore = document.getElementById('summaryStore').value;
  let data = loadData();
  if (start) data = data.filter(r => r.date >= start);
  if (end) data = data.filter(r => r.date <= end);
  if (summaryStore !== '') data = data.filter(r => r.storeIdx === parseInt(summaryStore) || r.extra || r.storeIdx === -1);
  const names = loadGoodsNames();
  const storeCfg = loadStoreConfig();
  const storeName = summaryStore !== '' && storeCfg[parseInt(summaryStore)] ? storeCfg[parseInt(summaryStore)].name : '';
  const totals = {};
  names.forEach((name, i) => { totals[i] = { in: 0, out: 0 }; });
  let grandIn = 0, grandOut = 0;
  data.forEach(r => {
    if (totals[r.goodsIdx]) {
      totals[r.goodsIdx].in += r.qtyIn || 0;
      totals[r.goodsIdx].out += r.qtyOut || 0;
      grandIn += r.qtyIn || 0;
      grandOut += r.qtyOut || 0;
    }
  });
  let html = '';
  if (storeName) html += '<div style="font-size:16px;font-weight:700;color:var(--primary);padding-bottom:8px;border-bottom:2px solid var(--primary);margin-bottom:10px;">🏪 ' + escapeHtml(storeName) + ' 汇总</div>';
  html += `    <thead><tr>
      <th>筐类型</th><th>发出</th><th>回收</th><th>差异</th>
    </tr></thead><tbody>`;
  names.forEach((name, i) => {
    const net = totals[i].in - totals[i].out;
    const netStr = net >= 0 ? `+${net}` : `${net}`;
    html += `<tr>
      <td>${name}</td>
      <td class="in">${totals[i].in}</td>
      <td class="out">${totals[i].out}</td>
      <td style="color:${net>=0?'var(--success)':'var(--danger)'};font-weight:600;">${netStr}</td>
    </tr>`;
  });
  const grandNet = grandIn - grandOut;
  const grandNetStr = grandNet >= 0 ? `+${grandNet}` : `${grandNet}`;
  html += `<tr class="total-row">
    <td>合计</td>
    <td class="in">${grandIn}</td>
    <td class="out">${grandOut}</td>
    <td style="color:${grandNet>=0?'var(--success)':'var(--danger)'};">${grandNetStr}</td>
  </tr></tbody>`;
  document.getElementById('summaryTable').innerHTML = html;
}

function setSummaryRange(days) {
  const end = todayStr();
  if (days === 0) {
    document.getElementById('summaryStart').value = '';
    document.getElementById('summaryEnd').value = end;
  } else {
    const d = new Date();
    d.setDate(d.getDate() - days + 1);
    document.getElementById('summaryStart').value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    document.getElementById('summaryEnd').value = end;
  }
  renderSummary();
}

function initSummaryPage() {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  document.getElementById('summaryStart').value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  document.getElementById('summaryEnd').value = todayStr();
}

// ======== 对账页 ========
function exportMyExcel() {
  const start = document.getElementById('exportStart')?.value;
  const end = document.getElementById('exportEnd')?.value;
  const exportStore = document.getElementById('exportStore')?.value || '';
  let data = loadData();
  if (start) data = data.filter(r => r.date >= start);
  if (end) data = data.filter(r => r.date <= end);
  if (exportStore !== '') data = data.filter(r => r.storeIdx === parseInt(exportStore) || r.extra || r.storeIdx === -1);
  const names = loadGoodsNames();
  // 按 (日期+店面) 分组
  const byKey = {};
  data.forEach(r => {
    const key = r.date + '|' + (r.storeName || '默认店');
    if (!byKey[key]) {
      byKey[key] = { date: r.date, store: r.storeName || '默认店', in: {}, out: {} };
      names.forEach((n, i) => { byKey[key].in[i] = 0; byKey[key].out[i] = 0; });
    }
    if (byKey[key].in[r.goodsIdx] !== undefined) {
      byKey[key].in[r.goodsIdx] += r.qtyIn;
      byKey[key].out[r.goodsIdx] += r.qtyOut;
    }
  });
  const rowsArr = Object.values(byKey).sort((a, b) => a.date === b.date ? (a.store||'').localeCompare(b.store||'') : a.date.localeCompare(b.date));
  const allStores = (exportStore === '');

  // 生成「按日分组」明细：每个日期一组，组内每家店一行，末尾本日小计
  const headers = ['店面'];
  names.forEach(n => headers.push(n + '-发出'));
  names.forEach(n => headers.push(n + '-回收'));
  const rows = [['物流筐收发管理系统 · 按日明细', '', '', '', '', '', '']];
  rows.push(['导出范围：', start || '全部', '至', end || todayStr(), '', '', '']);
  rows.push([]);

  let curDate = null;
  rowsArr.forEach(d => {
    // 新日期 → 日期标题行
    if (d.date !== curDate) {
      curDate = d.date;
      rows.push([curDate, '', '', '', '', '', '']);
      rows.push(headers.slice());
    }
    const row = [d.store];
    names.forEach((n, i) => row.push(d.in[i] || 0));
    names.forEach((n, i) => row.push(d.out[i] || 0));
    rows.push(row);
    // 本日期小计：在下一组日期前补
    const isLast = rowsArr.indexOf(d) === rowsArr.length - 1;
    const next = rowsArr[rowsArr.indexOf(d) + 1];
    if (isLast || next.date !== curDate) {
      const dayItems = rowsArr.filter(x => x.date === curDate);
      const subRow = ['本日合计'];
      names.forEach((n, i) => { subRow.push(dayItems.reduce((s, x) => s + x.in[i], 0)); });
      names.forEach((n, i) => { subRow.push(dayItems.reduce((s, x) => s + x.out[i], 0)); });
      rows.push(subRow);
      rows.push([]);
    }
  });

  // 顶部总合计
  const totalRow = ['总合计'];
  names.forEach((n, i) => { totalRow.push(rowsArr.reduce((s, d) => s + d.in[i], 0)); });
  names.forEach((n, i) => { totalRow.push(rowsArr.reduce((s, d) => s + d.out[i], 0)); });
  rows.push(totalRow);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '库存数据');
  XLSX.writeFile(wb, `库存数据_${start||'全部'}_${end||todayStr()}.xlsx`);
  showToast('✅ Excel已导出（按日分组）');
}

function exportSummaryExcel() {
  const start = document.getElementById('exportStart')?.value;
  const end = document.getElementById('exportEnd')?.value;
  let data = loadData();
  if (start) data = data.filter(r => r.date >= start);
  if (end) data = data.filter(r => r.date <= end);
  const names = loadGoodsNames();

  // 表头日期：2026-07-01 → 7月1
  const fmt = (d) => {
    if (!d) return '';
    const p = d.split('-');
    return (p.length === 3) ? (parseInt(p[1], 10) + '月' + parseInt(p[2], 10)) : d;
  };
  const rangeText = (fmt(start) || '开始') + ' 至 ' + (fmt(end) || '今天');

  // 每种筐的合计
  const totals = names.map((n, i) => ({ in: 0, out: 0 }));
  data.forEach(r => {
    if (totals[r.goodsIdx]) {
      totals[r.goodsIdx].in += r.qtyIn || 0;
      totals[r.goodsIdx].out += r.qtyOut || 0;
    }
  });

  const rows = [
    ['物流筐收发管理系统 · 汇总报表', '', '', ''],
    ['日期范围：' + rangeText, '', '', ''],
    [],
    ['筐类型', '发出', '回收', '差额'],
  ];
  let tIn = 0, tOut = 0;
  names.forEach((n, i) => {
    const diff = totals[i].out - totals[i].in; // 差额 = 回收 - 发出
    rows.push([n, totals[i].in, totals[i].out, diff]);
    tIn += totals[i].in; tOut += totals[i].out;
  });
  rows.push(['合计', tIn, tOut, tOut - tIn]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '汇总报表');
  XLSX.writeFile(wb, `汇总_${rangeText}.xlsx`);
  showToast('✅ 汇总已导出');
}

function importReconcile(event) {
  const file = event.target.files[0];
  if (!file) return;
  showLoading('正在读取对比…');
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const sheetData = XLSX.utils.sheet_to_json(ws, { header: 1 });
      hideLoading();
      compareReconcile(sheetData);
    } catch(err) {
      hideLoading();
      showToast('读取失败: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function compareReconcile(sheetData) {
  if (sheetData.length < 2) {
    showToast('表格数据为空');
    return;
  }
  const names = loadGoodsNames();
  const headerRow = sheetData[0].map(h => String(h || '').trim());
  // 找日期列
  let dateCol = headerRow.findIndex(h => h.includes('日期') || h.includes('时间') || h.includes('Date'));
  if (dateCol < 0) dateCol = 0;

  // 找筐名列（支持各种格式）
  const colMap = {}; // goodsIdx -> {inCol, outCol}
  names.forEach((name, i) => {
    let inCol = -1, outCol = -1;
    headerRow.forEach((h, col) => {
      if (h.includes(name) || h.includes(name.replace('筐',''))) {
        if (h.includes('发出') || h.includes('发')) inCol = col;
        if (h.includes('回收') || h.includes('回')) outCol = col;
      }
    });
    if (inCol >= 0 || outCol >= 0) colMap[i] = { inCol, outCol };
  });

  // 如果没匹配到带"发出/回收"的列，尝试只按筐名匹配（数字列）
  if (Object.keys(colMap).length === 0) {
    names.forEach((name, i) => {
      headerRow.forEach((h, col) => {
        if (h.includes(name) || h.includes(name.replace('筐',''))) {
          colMap[i] = { inCol: -1, outCol: col };
        }
      });
    });
  }

  // 获取我的数据
  const myData = loadData();
  const myByDate = {};
  myData.forEach(r => {
    if (!myByDate[r.date]) myByDate[r.date] = {};
    myByDate[r.date][r.goodsIdx] = { in: r.qtyIn, out: r.qtyOut, store: r.storeName };
  });

  // 逐行对比
  let html = '';
  let diffCount = 0;
  let matchCount = 0;

  for (let row = 1; row < sheetData.length; row++) {
    const rowData = sheetData[row];
    if (!rowData[dateCol]) continue;
    const dateStr = String(rowData[dateCol]).trim();
    // 标准化日期格式
    const normalizedDate = normalizeDate(dateStr);
    if (!normalizedDate) continue;

    for (let idx in colMap) {
      const cm = colMap[idx];
      const hisOut = cm.outCol >= 0 ? (parseInt(rowData[cm.outCol]) || 0) : 0;
      const hisIn = cm.inCol >= 0 ? (parseInt(rowData[cm.inCol]) || 0) : 0;
      const mine = myByDate[normalizedDate] && myByDate[normalizedDate][idx];
      const myOut = mine ? mine.out : 0;
      const myIn = mine ? mine.in : 0;
      const gapOut = hisOut - myOut;
      const gapIn = hisIn - myIn;

      if (hisOut !== myOut || hisIn !== myIn) {
        diffCount++;
        html += `<div class="diff-row">
          <div class="diff-date">${normalizedDate}</div>
          <div class="diff-goods">${mine.store ? '🏪'+mine.store+' ' : ''}${names[idx]}</div>
          <div class="diff-vals">
            <div>我:<span class="dv-mine">发${myIn}回${myOut}</span> 他:<span class="dv-his">发${hisIn}回${hisOut}</span> 差:<span class="dv-gap">发${gapIn>0?'+':''}${gapIn} 回${gapOut>0?'+':''}${gapOut}</span></div>
          </div>
        </div>`;
      } else if (hisOut > 0 || hisIn > 0) {
        matchCount++;
        html += `<div class="diff-row match">
          <div class="diff-date">${normalizedDate}</div>
          <div class="diff-goods">${mine.store ? '🏪'+mine.store+' ' : ''}${names[idx]}</div>
          <div class="diff-vals">
            <div>✅ 发${myIn} 回${myOut}</div>
          </div>
        </div>`;
      }
    }
  }

  let summaryHtml = `<div style="font-size:14px;margin-bottom:8px;">`;
  summaryHtml += `共对比 ${matchCount + diffCount} 项，`;
  summaryHtml += `<span style="color:var(--success);font-weight:600;">一致 ${matchCount}</span>，`;
  summaryHtml += `<span style="color:var(--danger);font-weight:600;">差异 ${diffCount}</span>`;
  summaryHtml += `</div>`;

  if (diffCount === 0 && matchCount > 0) {
    summaryHtml += '<div style="color:var(--success);font-weight:600;padding:8px;background:#d4edda;border-radius:6px;">🎉 全部一致，数据吻合！</div>';
  }

  const container = document.getElementById('compareResult');
  container.innerHTML = summaryHtml + (html || '<div class="empty">无对比数据</div>');
}

function normalizeDate(str) {
  str = String(str).trim();
  // 已是 yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  // yyyy/mm/dd 或 yyyy.mm.dd
  let m = str.match(/(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  // Excel数字日期
  m = str.match(/^(\d{5})$/);
  if (m) {
    const excelDate = new Date(Date.UTC(1899, 11, 30) + parseInt(m[1]) * 86400000);
    return `${excelDate.getUTCFullYear()}-${String(excelDate.getUTCMonth()+1).padStart(2,'0')}-${String(excelDate.getUTCDate()).padStart(2,'0')}`;
  }
  // mm/dd 或 m月d日
  m = str.match(/(\d{1,2})\/(\d{1,2})/);
  if (m) {
    const year = new Date().getFullYear();
    return `${year}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  }
  m = str.match(/(\d{1,2})月(\d{1,2})日/);
  if (m) {
    const year = new Date().getFullYear();
    return `${year}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  }
  return null;
}

// ======== 设置页 ========
function renderSettings() {
  // 设置页现为使用说明，无动态内容需渲染
}

function renderStoreConfigUI() {
  const cfg = loadStoreConfig();
  const container = document.getElementById('storeList');
  if (!container) return;
  let html = '';
  cfg.forEach((s, i) => {
    html += `<div class="config-item" style="border:1px solid var(--border);border-radius:8px;padding:8px;margin-bottom:8px;">
      <div style="display:flex;gap:8px;align-items:center;">
        <div class="idx">${i+1}</div>
        <input type="text" id="storeName${i}" value="${s.name}" maxlength="20" style="flex:1;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:15px;">
        <button class="btn btn-outline" style="flex:0 0 auto;padding:6px 10px;font-size:12px;color:var(--danger);" onclick="removeStore(${i})">删除</button>
      </div>
      <div class="alias-box" id="storeAliases${i}" style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;">
        ${s.aliases.map((a, ai) => `<span class="alias-chip" style="background:#eef;color:#357abd;font-size:12px;padding:3px 8px;border-radius:12px;display:inline-flex;align-items:center;gap:4px;">${a}<span style="cursor:pointer;color:#e74c3c;font-weight:700;" onclick="removeAlias(${i},${ai},'store')">×</span></span>`).join('')}
      </div>
      <div style="display:flex;gap:6px;margin-top:6px;">
        <input type="text" id="storeAliasInput${i}" placeholder="加别名" style="flex:1;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:13px;">
        <button class="btn btn-outline" style="flex:0 0 auto;padding:7px 12px;font-size:12px;" onclick="addAlias(${i},'store')">添加</button>
      </div>
    </div>`;
  });
  html += `<button class="btn btn-outline" style="margin-top:4px;" onclick="addStore()">➕ 新增店面</button>`;
  container.innerHTML = html;
}

function renderAliasChips(idx, type) {
  const cfg = type === 'goods' ? loadGoodsConfig() : loadStoreConfig();
  const box = document.getElementById((type === 'goods' ? 'aliases' : 'storeAliases') + idx);
  if (!box) return;
  box.innerHTML = cfg[idx].aliases.map((a, ai) => `<span class="alias-chip" style="background:#eef;color:#357abd;font-size:12px;padding:3px 8px;border-radius:12px;display:inline-flex;align-items:center;gap:4px;">${a}<span style="cursor:pointer;color:#e74c3c;font-weight:700;" onclick="removeAlias(${idx},${ai},'${type}')">×</span></span>`).join('');
}

function addAlias(idx, type) {
  const input = document.getElementById((type === 'goods' ? 'aliasInput' : 'storeAliasInput') + idx);
  const val = input.value.trim();
  if (!val) return;
  if (type === 'goods') {
    const cfg = loadGoodsConfig();
    const nm = document.getElementById('goodsName' + idx)?.value?.trim();
    if (nm) cfg[idx].name = nm;
    if (!cfg[idx].aliases.includes(val)) cfg[idx].aliases.push(val);
    saveGoodsConfig(cfg);
    renderAliasChips(idx, 'goods');
  } else {
    const cfg = loadStoreConfig();
    const nm = document.getElementById('storeName' + idx)?.value?.trim();
    if (nm) cfg[idx].name = nm;
    if (!cfg[idx].aliases.includes(val)) cfg[idx].aliases.push(val);
    saveStoreConfig(cfg);
    renderAliasChips(idx, 'store');
  }
  input.value = '';
}

function removeAlias(idx, ai, type) {
  if (type === 'goods') {
    const cfg = loadGoodsConfig();
    cfg[idx].aliases.splice(ai, 1);
    saveGoodsConfig(cfg);
    renderAliasChips(idx, 'goods');
  } else {
    const cfg = loadStoreConfig();
    cfg[idx].aliases.splice(ai, 1);
    saveStoreConfig(cfg);
    renderAliasChips(idx, 'store');
  }
}

function addStore() {
  const cfg = loadStoreConfig();
  cfg.push({ name: '新店面', aliases: [] });
  saveStoreConfig(cfg);
  renderStoreConfigUI();
}

function removeStore(idx) {
  const cfg = loadStoreConfig();
  cfg.splice(idx, 1);
  saveStoreConfig(cfg);
  renderStoreConfigUI();
}

// ======== 店面拍照识别（批量导入） ========
let storeOcrParsed = [];

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// 从 OCR 词列表解析店面行：只取「路线编号 + 门店名称」，丢弃表头/数量/时间等其它信息
// 路线编号统一转为 4-1 格式（去掉 HN 前缀与前导零）
// 百度 OCR 通常按「行」返回（整行 = 编号+店名+数量/时间），此处兼容：行内提取 / 店名在下一行 两种情况
const STORE_OCR_NOISE = ['配送编号', '门店名称', '编号', '名称', '合计', '小计', '路单', '总计', '单位', '备注', '签字', '配送', '门店', '序号'];
function isEmptyStoreName(s) {
  // 清理后只剩数字、时间符号、空白、标点，视为无店名
  return !s || /^[\d\s:：,，.。\-_–—]+$/.test(s);
}
function cleanStoreName(s) {
  let r = String(s).trim();
  // 去掉常见噪音词（一次正则替换，替代逐个 split/join）
  r = r.replace(new RegExp('(' + STORE_OCR_NOISE.join('|') + ')', 'g'), '');
  // 去掉粘连在文字末尾的时间，如 "全家20:" → "全家"
  r = r.replace(/(\D)\d{1,2}[:：](?:\d{2}(?:[:：]\d{2})?)?$/, '$1');
  // 按空白切分，逐 token 过滤时间/数量/纯数字，保留店名文字
  const parts = r.split(/\s+/).filter(part => {
    if (!part) return false;
    if (/^\d{1,2}[:：]\d{2}(?:[:：]\d{2})?$/.test(part)) return false; // 时间
    if (/^\d+$/.test(part)) return false;                              // 纯数字
    if (/^\d+(筐|个|件|箱|只)$/.test(part)) return false;               // 数字+单位
    return true;
  });
  r = parts.join('').trim(); // 表格各单元格之间不要空格，直接拼接
  return isEmptyStoreName(r) ? '' : r;
}
function parseStoreOcr(words) {
  const stores = [];
  let pendingCode = null; // 已匹配到编号、但本行未带店名，等待下一行补店名
  for (const w of words) {
    const t = String(w).trim();
    if (!t) continue;
    // 行内提取编号（任意字母前缀：HR/HN/HF/MV/W 等都会被 OCR 误认）
    const m = t.match(/^[A-Za-z]*0*(\d{1,3})[\-–−]0*(\d{1,3})/i);
    if (m) {
      const code = parseInt(m[1], 10) + '-' + parseInt(m[2], 10);
      // 编号之后的内容 = 店名候选：去行首/末尾时间、数量、噪音词
      let rest = cleanStoreName(t.slice(m.index + m[0].length));
      if (rest) {
        stores.push({ code, name: rest });
        pendingCode = null;
      } else {
        pendingCode = code; // 店名在后续行
      }
    } else if (pendingCode !== null) {
      // 上一行仅有编号，本行可能是时间/数量/店名
      if (/^\d+$/.test(t) || /^\d{1,2}[:：]\d{2}/.test(t)) {
        // 纯数字或时间：跳过，但保留 pendingCode（店名可能在更下一行）
        continue;
      }
      if (STORE_OCR_NOISE.some(n => t.indexOf(n) >= 0)) { pendingCode = null; continue; }
      const nm = cleanStoreName(t);
      if (nm) {
        stores.push({ code: pendingCode, name: nm });
        pendingCode = null;
      }
      // 清理后仍为空则保留 pendingCode，继续等待有效店名
    }
    // 其它无编号且无 pending 的词（表头/合计/孤立文字等）直接丢弃，不保留无关信息
  }
  return stores;
}

function handleStorePhoto(event) {
  const file = event.target.files[0];
  if (!file) return;
  showLoading('正在加载图片…');
  const reader = new FileReader();
  reader.onload = function(e) {
    doStoreOCR(e.target.result);
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

async function doStoreOCR(imageDataUrl) {
  const keys = loadOcrKeys();
  if (!keys.apiKey || !keys.secretKey) {
    hideLoading(); // 关键：未配置密钥时先关掉加载遮罩，避免全屏卡死
    showToast('请先在设置页配置百度OCR密钥');
    return;
  }
  showLoading('正在识别店面…');
  try {
    // 获取 access token（带缓存）
    const accessToken = await getOcrAccessToken(keys.apiKey, keys.secretKey);
    const compressedBase64 = await compressImage(imageDataUrl, 1600);
    const imgBase64 = compressedBase64.replace(/^data:image\/\w+;base64,/, '');
    const ocrResp = await fetch(CORS_PROXY + encodeURIComponent(`https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic?access_token=${accessToken}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `image=${encodeURIComponent(imgBase64)}&language_type=CHN_ENG&detect_direction=true&paragraph=false&probability=false`
    });
    const ocrData = await ocrResp.json();
    hideLoading();
    if (!ocrData.words_result) throw new Error(ocrData.error_msg || '识别失败');
    showStoreOcrResult(ocrData);
  } catch (error) {
    hideLoading();
    showToast('识别失败: ' + error.message);
  }
}

function showStoreOcrResult(ocrData) {
  const words = ocrData.words_result.map(it => it.words);
  storeOcrParsed = parseStoreOcr(words);
  if (storeOcrParsed.length === 0) {
    showToast('未识别到有效店面（需要编号+店名），请检查图片');
    return;
  }
  document.getElementById('storeOcrCount').textContent = storeOcrParsed.length;
  renderStoreOcrTable();
  document.getElementById('storeOcrModal').classList.add('show');
}

function renderStoreOcrTable() {
  const container = document.getElementById('storeOcrTable');
  let html = '';
  storeOcrParsed.forEach((s, i) => {
    html += `<div class="store-ocr-row">
      <input type="text" value="${escapeHtml(s.code)}" data-i="${i}" data-k="code" style="width:80px;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:13px;" placeholder="编号">
      <input type="text" value="${escapeHtml(s.name)}" data-i="${i}" data-k="name" style="flex:1;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:13px;" placeholder="门店名称">
      <button class="del-btn" onclick="removeStoreOcrRow(${i})" style="font-size:18px;color:var(--danger);">×</button>
    </div>`;
  });
  html += `<button class="btn btn-outline" style="margin-top:4px;font-size:12px;padding:7px;" onclick="addStoreOcrRow()">➕ 新增一行</button>`;
  container.innerHTML = html;
  container.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', e => {
      const i = +e.target.dataset.i;
      const k = e.target.dataset.k;
      if (storeOcrParsed[i]) storeOcrParsed[i][k] = e.target.value;
    });
  });
}

function removeStoreOcrRow(i) {
  storeOcrParsed.splice(i, 1);
  document.getElementById('storeOcrCount').textContent = storeOcrParsed.length;
  renderStoreOcrTable();
}

function addStoreOcrRow() {
  storeOcrParsed.push({ code: '', name: '' });
  document.getElementById('storeOcrCount').textContent = storeOcrParsed.length;
  renderStoreOcrTable();
}

function closeStoreOcrModal() {
  document.getElementById('storeOcrModal').classList.remove('show');
  storeOcrParsed = [];
}

function saveStoreOcrResult() {
  const valid = storeOcrParsed.filter(s => s.name && s.name.trim());
  if (valid.length === 0) { showToast('没有有效店面'); return; }
  const cfg = loadStoreConfig();
  const existing = new Set(cfg.map(c => c.name));
  let added = 0, skipped = 0;
  valid.forEach(s => {
    const name = s.name.trim();
    if (existing.has(name)) { skipped++; return; }
    // 自动生成别名：完整编号(35-12) + 店号简称(12店)，带查重
    const aliases = [];
    if (s.code && s.code.trim()) {
      const code = s.code.trim();
      aliases.push(code);
      const parts = String(code).split('-');
      if (parts.length === 2) {
        const tail = parts[1].replace(/^0+/, '');
        if (tail) {
          const shortAlias = tail + '店';
          const used = new Set();
          cfg.forEach(c => (c.aliases || []).forEach(a => used.add(String(a))));
          if (!used.has(shortAlias)) aliases.push(shortAlias);
        }
      }
    }
    cfg.push({ name, aliases });
    existing.add(name);
    added++;
  });
  saveStoreConfig(cfg);
  initStoreSelect('recordStore');
  populateStoreFilter('filterStore');
  populateStoreFilter('summaryStore');
  populateStoreFilter('exportStore');
  renderStorePanelUI();
  if (document.getElementById('storeList')) renderStoreConfigUI();
  closeStoreOcrModal();
  showToast(`✅ 新增 ${added} 个${skipped ? '，跳过重复 ' + skipped + ' 个' : ''}`);
}

// ======== 数据导入导出 ========
function exportData() {
  const data = loadData();
  const goods = loadGoodsNames();
  const exportObj = {
    exportDate: new Date().toISOString(),
    goodsNames: goods,
    records: data
  };
  const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `库存数据_${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('✅ 已导出');
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const obj = JSON.parse(e.target.result);
      if (!obj.records || !Array.isArray(obj.records)) {
        showToast('❌ 文件格式错误');
        return;
      }
      // 导入方式：点确定=覆盖，点取消=合并追加（推荐）
      const overwrite = confirm(`导入 ${obj.records.length} 条记录：\n\n点「确定」= 覆盖当前所有数据\n点「取消」= 合并到现有数据（推荐，不会丢）`);
      if (overwrite) {
        saveDataArr(obj.records);
      } else {
        // 合并：按 日期+店面+筐 去重（同一天同一店同一筐保留新值）
        const cur = loadData();
        const byKey = new Map();
        cur.forEach(r => byKey.set(String(r.date) + '|' + r.storeIdx + '|' + r.goodsIdx, r));
        obj.records.forEach(r => byKey.set(String(r.date) + '|' + r.storeIdx + '|' + r.goodsIdx, r));
        saveDataArr([...byKey.values()]);
      }
      if (obj.goodsNames) saveGoodsConfig(obj.goodsNames);
      initGoodsFilter();
      renderGoodsInputList();
      renderTodayOverview();
      showToast('✅ 导入成功' + (overwrite ? '' : '（合并）'));
    } catch(err) {
      showToast('❌ 导入失败: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// ======== 初始化 ========
const APP_VERSION = '6.0.3'; // 大改动升首位，中改动升中位，小改动升末位；小逢10进中、中逢10进大（每次改这里+同步递增sw缓存版本）
const appVerEl = document.getElementById('appVersion');
if (appVerEl) appVerEl.textContent = 'v' + APP_VERSION;
initTheme();
initOffline();
renderAccountBadge();
renderTodayStatus();
initRecordPage();
initGoodsFilter();
initSummaryPage();
// 新用户首次打开自动弹出欢迎引导（含使用说明入口）
initWelcome();
// 云备份恢复（清缓存/换手机后自动从云端拉取数据）
restoreFromCloud();
// 定时兜底备份：无操作时每30分钟自动备份一次（后台静默）
startPeriodicBackup();
// 已登录用户：打开时自动同步该账号云端数据
if (isLoggedIn()) {
  const p = getCloudPhone();
  if (p) { autoSyncFromCloud(p); }
}
// 注册 Service Worker（离线可用 + 加载加速），禁用 HTTP 缓存，确保每次拿到最新 sw.js
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      // 检测到新版 Service Worker（说明有新版本上线）→ 提示刷新
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (nw) nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            // 有新版：弹确认框，用户确认后强制重启加载新版本
            setTimeout(showVersionConfirm, 800);
          }
        });
      });
    })
    .catch(() => {});
  // 页面加载时主动检查更新
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'CHECK_UPDATE' });
  }
}

// 检测到新版本：强制更新弹窗（不可跳过，保证加载最新版顺利使用）
function showVersionConfirm() {
  const m = document.getElementById('versionConfirmModal');
  if (!m) return;
  const nl = document.getElementById('verNewLabel');
  if (nl) nl.textContent = APP_VERSION;
  m.classList.add('show');
  m.style.cursor = 'default';
  // 遮罩点击不关闭（强制更新），只允许点"立即更新"
  m.onclick = () => {};
}
function closeVersionConfirm() {
  const m = document.getElementById('versionConfirmModal');
  if (m) m.classList.remove('show');
}
// 用户确认：强制重启，加载新版本
function applyNewVersion() {
  closeVersionConfirm();
  // 让等待中的新 Service Worker 立即接管
  if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg && reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    }).catch(() => {});
  }
  try { showToast('🔄 正在重启更新…'); } catch (e) {}
  // 短暂延迟后强制重新加载（重新加载即拿到新版本）
  setTimeout(() => { window.location.reload(); }, 600);
}
// 默认对账日期范围
const dEnd = todayStr();
const dStart = new Date();
dStart.setDate(dStart.getDate() - 29);
document.getElementById('exportStart')?.setAttribute('value', `${dStart.getFullYear()}-${String(dStart.getMonth()+1).padStart(2,'0')}-${String(dStart.getDate()).padStart(2,'0')}`);
document.getElementById('exportEnd')?.setAttribute('value', dEnd);
