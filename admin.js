/* 物流筐 · 管理页面逻辑（admin.html 配套） */
var ADMIN_KEY = localStorage.getItem('kuanwei_admin_key') || '';
var today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

function toast(msg, ms) {
  var t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._tm); t._tm = setTimeout(function () { t.classList.remove('show'); }, ms || 2200);
}
function api(path, body) {
  return fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ adminKey: ADMIN_KEY }, body || {}))
  }).then(function (r) {
    return r.text().then(function (t) {
      try { return JSON.parse(t); } catch (e) { return { error: '服务响应异常(HTTP ' + r.status + ')' }; }
    });
  }).catch(function (e) { return { error: '网络连接失败（' + (e && e.message ? e.message : '请检查网络') + '）' }; });
}
function fmtTime(ts) {
  if (!ts) return '';
  var d = new Date(ts + 8 * 3600 * 1000);
  var p = function (n) { return String(n).padStart(2, '0'); };
  return p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
}
function fmtDate(iso) {
  if (!iso) return '未开通';
  var d = new Date(iso);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function vipLabel(acct) {
  if (!acct || !acct.vipUntil) return '<span class="u-vip">非会员</span>';
  if (acct.vipUntil.indexOf('2100') === 0) return '<span class="u-vip">终身 VIP</span>';
  return '<span class="u-vip">VIP 至 ' + fmtDate(acct.vipUntil) + '</span>';
}

/* ===== 登录 ===== */
function doLogin() {
  var pwd = document.getElementById('loginPwd').value.trim();
  var err = document.getElementById('loginErr');
  if (!pwd) { err.textContent = '请输入管理密码'; return; }
  fetch('/admin/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminKey: pwd })
  }).then(function (r) { return r.json(); }).then(function (res) {
    if (res && res.ok) {
      ADMIN_KEY = pwd;
      try { localStorage.setItem('kuanwei_admin_key', pwd); } catch (e) {}
      // 管理 APK 原生环境：初始化监听端（派生 listenKey + 心跳 + 事件桥）
      if (window.KWListen) window.KWListen.init(pwd);
      enterMain();
    } else {
      err.textContent = '密码错误，请重试';
    }
  }).catch(function () { err.textContent = '网络异常，请重试'; });
}
function doLogout() {
  ADMIN_KEY = ''; try { localStorage.removeItem('kuanwei_admin_key'); } catch (e) {}
  document.getElementById('mainPage').style.display = 'none';
  document.getElementById('loginPage').style.display = 'flex';
  document.getElementById('loginPwd').value = '';
}
function enterMain() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('mainPage').style.display = 'block';
  switchTab('overview');
}
if (ADMIN_KEY) { if (window.KWListen) window.KWListen.init(ADMIN_KEY); enterMain(); }

/* ===== Tab 切换 ===== */
var CUR_TAB = 'overview';
function switchTab(tab) {
  CUR_TAB = tab;
  document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === tab); });
  if (tab === 'overview') renderOverview();
  else if (tab === 'users') renderUsers();
  else if (tab === 'grant') renderGrant();
  else if (tab === 'config') renderConfig();
  else if (tab === 'reconcile') renderReconcile();
}

/* ===== 概览 ===== */
function renderOverview() {
  var el = document.getElementById('tabContent');
  el.innerHTML = '<div class="card"><div class="card-title"><span class="ic"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l4 4v8h10l4-4h4l-4 8H3L1 1z"/><circle cx="7" cy="19" r="2"/><circle cx="17" cy="19" r="2"/></svg></span>监听状态 <span id="listenPill" class="listen-pill off" style="margin-left:6px;cursor:pointer;" onclick="KWListen.selfCheck()" title="点此自检监听">检测中…</span> <span style="font-size:10px;color:var(--dim);">(点状态可自检)</span></div><div id="listenDetail" style="font-size:11px;color:var(--dim);"></div></div>' +
    '<div class="card"><div class="card-title"><span class="ic"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 15h4"/></svg></span>今日收款（' + today + '）</div><div class="ov-grid" id="ovToday"></div></div>' +
    '<div class="card"><div class="card-title"><span class="ic"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></span>快捷操作</div><div class="ov-grid">' +
    '<div class="ov-cell" style="cursor:pointer;" onclick="switchTab(\'grant\')"><div class="ov-num cyan" style="font-size:16px;">补发 VIP</div><div class="ov-lab">兜底第 5 层</div></div>' +
    '<div class="ov-cell" style="cursor:pointer;" onclick="switchTab(\'config\')"><div class="ov-num cyan" style="font-size:16px;">收款设置</div><div class="ov-lab">换码 30 秒生效</div></div>' +
    '<div class="ov-cell" style="cursor:pointer;" onclick="switchTab(\'reconcile\')"><div class="ov-num cyan" style="font-size:16px;">每日对账</div><div class="ov-lab">收到/匹配/未匹配</div></div>' +
    '<div class="ov-cell" style="cursor:pointer;" onclick="switchTab(\'users\')"><div class="ov-num cyan" style="font-size:16px;">用户管理</div><div class="ov-lab">统计 · 重置 · 恢复</div></div></div></div>';
  // 监听状态
  api('/admin/listen-status').then(function (res) {
    var pill = document.getElementById('listenPill'), det = document.getElementById('listenDetail');
    if (!res || !res.ok) { pill.textContent = '查询失败'; return; }
    var devs = res.devices || [];
    if (!devs.length) { pill.textContent = '未接入监听'; pill.className = 'listen-pill off'; det.textContent = '管理 APP 尚未上报心跳（装好 APK 并开启监听后显示在线）'; return; }
    var online = devs.filter(function (d) { return d.online; });
    pill.textContent = online.length ? '监听在线' : '监听离线';
    pill.className = 'listen-pill ' + (online.length ? 'on' : 'off');
    det.textContent = devs.map(function (d) { return '设备 ' + d.deviceId.slice(0, 6) + ' · 最近心跳 ' + fmtTime(d.lastBeat) + (d.online ? ' · 在线' : ' · 已离线'); }).join('<br>');
    // 原生环境补充通知授权状态（管理 APK）
    if (window.KWListen && window.KWListen.isNative()) {
      window.KWListen.checkEnabled(function (enabled) {
        var pill2 = document.getElementById('listenPill');
        if (!enabled) {
          pill2.textContent = '通知监听未授权';
          pill2.className = 'listen-pill off';
          var d2 = document.getElementById('listenDetail');
          d2.innerHTML = d2.innerHTML + '<br><a href="javascript:void(0)" onclick="KWListen.openSettings()" style="color:#7CE8E0;">点此去系统设置开启通知监听</a>';
        }
      });
    }
  });
  // 今日收款
  api('/admin/reconcile', { date: today }).then(function (res) {
    var el2 = document.getElementById('ovToday');
    if (!res || !res.ok) { el2.innerHTML = '<div class="empty">查询失败</div>'; return; }
    el2.innerHTML =
      '<div class="ov-cell"><div class="ov-num">' + res.total + '</div><div class="ov-lab">收款笔数</div></div>' +
      '<div class="ov-cell"><div class="ov-num">' + res.totalAmount + '</div><div class="ov-lab">总金额(元)</div></div>' +
      '<div class="ov-cell"><div class="ov-num cyan">' + res.matched + '</div><div class="ov-lab">已匹配</div></div>' +
      '<div class="ov-cell"><div class="ov-num red">' + res.unmatched + '</div><div class="ov-lab">未匹配</div></div>';
  });
}

/* ===== 用户管理 ===== */
function renderUsers() {
  var el = document.getElementById('tabContent');
  el.innerHTML = '<div class="card"><div class="card-title"><span class="ic"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>用户列表 <span id="uCount" style="color:var(--cyan);margin-left:6px;"></span></div><div id="uList"><div class="empty">加载中…</div></div></div>' +
    '<div class="card"><div class="card-title"><span class="ic"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></span>重置用户密码</div><input class="f-input" id="rpPhone" placeholder="用户手机号"><input class="f-input" id="rpPwd" placeholder="新密码（至少 6 位）" style="margin-top:8px;"><button class="f-btn" onclick="doResetPwd()">重置密码</button></div>' +
    '<div class="card"><div class="card-title"><span class="ic"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg></span>恢复注销账号</div><div id="pendList" style="font-size:12px;color:var(--dim);margin-bottom:8px;">加载中…</div><input class="f-input" id="rsCode" placeholder="临时代码"><input class="f-input" id="rsPhone" placeholder="绑定到新手机号" style="margin-top:8px;"><button class="f-btn" onclick="doRestore()">恢复账号</button></div>';
  api('/admin/stats').then(function (res) {
    var list = document.getElementById('uList'), cnt = document.getElementById('uCount'), pend = document.getElementById('pendList');
    if (!res || !res.ok) { list.innerHTML = '<div class="empty">加载失败</div>'; return; }
    cnt.textContent = res.count + ' 人';
    if (!res.users.length) { list.innerHTML = '<div class="empty">暂无用户</div>'; }
    else {
      list.innerHTML = res.users.map(function (u) {
        var vip = '';
        return '<div class="u-row"><div><div class="u-phone">' + u.phone + '</div><div class="u-meta">' + (u.lastLoginAt ? '最近登录 ' + u.lastLoginAt.slice(0, 16).replace('T', ' ') : '暂无登录记录') + '</div></div>' + vip + '<button class="u-btn" onclick="resetForUser(\'' + u.phone + '\')">重置密码</button></div>';
      }).join('');
    }
    pend.innerHTML = (res.pendingDelete || []).length
      ? res.pendingDelete.map(function (p) { return '临时代码 <b style="color:var(--gold);">' + p.code + '</b>（原号 ' + p.originalPhone + '）<br>'; }).join('')
      : '暂无待恢复账号';
  });
}
function resetForUser(phone) {
  document.getElementById('rpPhone').value = phone;
  document.getElementById('rpPwd').focus();
  switchTab('users');
}
function doResetPwd() {
  var phone = document.getElementById('rpPhone').value.trim();
  var pwd = document.getElementById('rpPwd').value.trim();
  if (!/^1\d{10}$/.test(phone)) { toast('手机号格式不正确'); return; }
  if (pwd.length < 6) { toast('新密码至少 6 位'); return; }
  api('/admin/reset', { phone: phone, password: pwd }).then(function (res) {
    toast(res && res.ok ? '密码已重置' : (res && res.error) || '操作失败');
  });
}
function doRestore() {
  var code = document.getElementById('rsCode').value.trim();
  var phone = document.getElementById('rsPhone').value.trim();
  if (!code) { toast('请输入临时代码'); return; }
  if (!/^1\d{10}$/.test(phone)) { toast('新手机号格式不正确'); return; }
  api('/admin/restore-account', { code: code, newPhone: phone }).then(function (res) {
    toast(res && res.ok ? res.message : (res && res.error) || '操作失败');
    if (res && res.ok) { document.getElementById('rsCode').value = ''; document.getElementById('rsPhone').value = ''; renderUsers(); }
  });
}

/* ===== 补发 VIP ===== */
function renderGrant() {
  var el = document.getElementById('tabContent');
  el.innerHTML = '<div class="card"><div class="card-title"><span class="ic"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12c0 1.1.9 2 2 2h14v-4"/><path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2 1.1 0 2-.9 2-2 0-1.1-.9-2-2-2z"/></svg></span>补发 VIP（兜底第 5 层）</div>' +
    '<div style="font-size:11px;color:var(--dim);margin-bottom:8px;">用户付款后未自动到账时，输手机号 + 选档位补发。叠加规则：续费在原到期时间上加天数，终身卡直接设 2100 年。</div>' +
    '<input class="f-input" id="gPhone" placeholder="用户手机号"><select class="f-select" id="gPlan" style="margin-top:8px;">' +
    '<option value="month">月卡（+30 天）</option><option value="season">季卡（+90 天）</option><option value="year">年卡（+365 天）</option><option value="lifetime">终身卡</option></select>' +
    '<button class="f-btn" onclick="doGrant()">确认补发</button></div>' +
    '<div class="card"><div class="card-title"><span class="ic"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></span>说明</div>' +
    '<div style="font-size:11px;color:var(--dim);line-height:1.9;">1. 补发仅用于「已付款未到账」情况，请先与用户核对付款记录<br>2. 每笔补发会写入操作日志，可在对账页查看<br>3. 非会员误发可联系技术支持处理</div></div>';
}
function doGrant() {
  var phone = document.getElementById('gPhone').value.trim();
  var plan = document.getElementById('gPlan').value;
  if (!/^1\d{10}$/.test(phone)) { toast('手机号格式不正确'); return; }
  api('/admin/grant-vip', { phone: phone, planId: plan }).then(function (res) {
    toast(res && res.ok ? '已补发，VIP 至 ' + fmtDate(res.vipUntil) : (res && res.error) || '操作失败');
  });
}

/* ===== 收款设置 ===== */
var cfgDraft = { wxQr: '', alipayQr: '', kfQr: '', kfWx: '', kfHours: '凌晨 1:00 — 下午 3:00' };
function renderConfig() {
  var el = document.getElementById('tabContent');
  el.innerHTML = '<div class="card"><div class="card-title"><span class="ic"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span>收款设置（保存即全局生效，换码 30 秒）</div>' +
    '<div style="font-size:11px;color:var(--dim);margin-bottom:10px;">用户下单页实时拉取这里的码。收款码失效 / 换账户 / 客服换号，在这里换，不用重新打包 APP。</div>' +
    '<div class="qr-upload">' +
    '<div class="qr-box"><div class="qr-name">微信收款码</div><img id="pvWx" src="" alt="微信收款码"><label for="fWx">上传图片</label><input type="file" id="fWx" accept="image/*" onchange="pickQr(this, \'wxQr\', \'pvWx\')"></div>' +
    '<div class="qr-box"><div class="qr-name">支付宝收款码</div><img id="pvAli" src="" alt="支付宝收款码"><label for="fAli">上传图片</label><input type="file" id="fAli" accept="image/*" onchange="pickQr(this, \'alipayQr\', \'pvAli\')"></div>' +
    '<div class="qr-box"><div class="qr-name">客服二维码</div><img id="pvKf" src="" alt="客服二维码"><label for="fKf">上传图片</label><input type="file" id="fKf" accept="image/*" onchange="pickQr(this, \'kfQr\', \'pvKf\')"></div></div>' +
    '<div class="f-label">客服微信号（用户复制添加）</div><input class="f-input" id="cfWx" placeholder="如 kf_2026">' +
    '<div class="f-label">客服工作时间</div><input class="f-input" id="cfHours" placeholder="如 凌晨 1:00 — 下午 3:00">' +
    '<button class="f-btn" onclick="saveConfig()">保存收款配置</button>' +
    '<button class="f-btn ghost" style="margin-top:8px;" onclick="selfCheck()">服务自检（排查保存失败）</button></div>';
  api('/admin/pay-config').then(function (res) {
    if (!res || !res.ok) return;
    var c = res.config || {};
    cfgDraft = c;
    document.getElementById('pvWx').src = c.wxQr || '';
    document.getElementById('pvAli').src = c.alipayQr || '';
    document.getElementById('pvKf').src = c.kfQr || '';
    document.getElementById('cfWx').value = c.kfWx || '';
    document.getElementById('cfHours').value = c.kfHours || '';
  });
}
function pickQr(input, key, previewId) {
  var file = input.files && input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast('图片需 ≤5MB'); input.value = ''; return; }
  var reader = new FileReader();
  reader.onload = function () {
    // canvas 压缩：最长边 900px 缩放（二维码保真 PNG），避免 base64 膨胀超后端上限
    var img = new Image();
    img.onload = function () {
      try {
        var maxSide = 900;
        var scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        var cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.width * scale));
        cv.height = Math.max(1, Math.round(img.height * scale));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        var dataUrl = cv.toDataURL('image/png');
        if (dataUrl.length > 1_050_000) { dataUrl = cv.toDataURL('image/jpeg', 0.88); } // PNG 仍超 → JPEG 兜底
        if (dataUrl.length > 1_300_000) { toast('图片压缩后仍过大，请换小图', 8000); return; }
        cfgDraft[key] = dataUrl;
        document.getElementById(previewId).src = dataUrl;
        toast('已选择，记得点保存');
      } catch (e) { toast('图片处理失败，请重试', 8000); }
    };
    img.onerror = function () { toast('图片读取失败', 8000); };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}
function saveConfig() {
  cfgDraft.kfWx = document.getElementById('cfWx').value.trim();
  cfgDraft.kfHours = document.getElementById('cfHours').value.trim() || '凌晨 1:00 — 下午 3:00';
  if (!cfgDraft.wxQr && !cfgDraft.alipayQr) { toast('至少上传一个收款码', 8000); return; }
  var totalLen = (cfgDraft.wxQr || '').length + (cfgDraft.alipayQr || '').length + (cfgDraft.kfQr || '').length;
  api('/admin/pay-config/save', cfgDraft).then(function (res) {
    if (res && res.ok) toast(res.message || '已保存，全局生效', 3000);
    else toast((res && res.error) || '保存失败（未知错误）', 8000);
  });
}

function selfCheck() {
  var cs = [['登录验证 /admin/verify', '/admin/verify'], ['读配置 /admin/pay-config', '/admin/pay-config'], ['保存配置 /admin/pay-config/save', '/admin/pay-config/save'], ['今日对账 /admin/reconcile', '/admin/reconcile']];
  var lines = [], seq = Promise.resolve();
  cs.forEach(function (c) {
    seq = seq.then(function () {
      return fetch(c[1], { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adminKey: ADMIN_KEY }) })
        .then(function (r) { return r.text().then(function (t) { lines.push(c[0] + '\n→ HTTP ' + r.status + ' | ' + t.slice(0, 60)); }); })
        .catch(function (e) { lines.push(c[0] + '\n→ 请求失败: ' + (e && e.message ? e.message : '网络错误')); });
    });
  });
  seq.then(function () { toast(lines.join('\n'), 15000); });
}

/* ===== 每日对账 ===== */
function renderReconcile() {
  var el = document.getElementById('tabContent');
  el.innerHTML = '<div class="card"><div class="card-title"><span class="ic"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 15h4"/></svg></span>每日对账</div>' +
    '<input class="f-input" type="date" id="rcDate" value="' + today + '" onchange="loadReconcile()">' +
    '<div class="rc-grid" id="rcSummary" style="margin-top:10px;"><div class="rc-cell"><div class="rc-num" style="color:var(--gold);">-</div><div class="rc-lab">收款笔数</div></div><div class="rc-cell"><div class="rc-num" style="color:var(--cyan);">-</div><div class="rc-lab">已匹配</div></div><div class="rc-cell"><div class="rc-num" style="color:var(--danger);">-</div><div class="rc-lab">未匹配</div></div></div></div>' +
    '<div class="card"><div class="card-title"><span class="ic"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg></span>流水明细</div><div id="rcFlows"><div class="empty">选择日期查看</div></div></div>';
  loadReconcile();
}
function loadReconcile() {
  var date = document.getElementById('rcDate').value || today;
  api('/admin/reconcile', { date: date }).then(function (res) {
    if (!res || !res.ok) return;
    document.getElementById('rcSummary').innerHTML =
      '<div class="rc-cell"><div class="rc-num" style="color:var(--gold);">' + res.total + '</div><div class="rc-lab">收款 ' + res.totalAmount + ' 元</div></div>' +
      '<div class="rc-cell"><div class="rc-num" style="color:var(--cyan);">' + res.matched + '</div><div class="rc-lab">已匹配 ' + res.matchedAmount + ' 元</div></div>' +
      '<div class="rc-cell"><div class="rc-num" style="color:var(--danger);">' + res.unmatched + '</div><div class="rc-lab">未匹配 ' + res.unmatchedAmount + ' 元</div></div>';
    var flows = res.flows || [];
    var el = document.getElementById('rcFlows');
    if (!flows.length) { el.innerHTML = '<div class="empty">当日无收款</div>'; return; }
    el.innerHTML = flows.map(function (f) {
      var ok = f.status === 'matched';
      return '<div class="flow-row"><div><div class="flow-amt ' + (ok ? '' : 'un') + '">' + f.amount.toFixed(2) + ' 元</div>' +
        '<div class="flow-meta">' + fmtTime(f.ts) + ' · ' + (ok ? '订单 ' + f.orderNo : '未匹配（' + (f.phone || '未知用户') + '）') + '</div></div>' +
        '<span class="badge ' + (ok ? 'ok' : 'un') + '">' + (ok ? '已开通' : '待处理') + '</span></div>';
    }).join('');
  });
}
