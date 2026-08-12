/* 物流筐管理 APK 监听端（Capacitor 原生桥）
 * 仅原生环境生效：浏览器打开 admin.html 时自动跳过。
 * 职责：收款通知事件 → 上报 /listen/report；每 5 分钟心跳 /listen/heartbeat
 */
(function () {
  var DEV_KEY = 'kuanwei_listen_dev';
  var KEY_CACHE = 'kuanwei_listen_key';
  var deviceId = localStorage.getItem(DEV_KEY);
  if (!deviceId) {
    deviceId = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    try { localStorage.setItem(DEV_KEY, deviceId); } catch (e) {}
  }
  var listenKey = ''; // 派生缓存（登录后设置）

  function isNative() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }

  // 派生 listenKey = hex(SHA-256('kuanwei-listen:' + adminKey))，与后端一致
  function deriveKey(adminKey) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode('kuanwei-listen:' + adminKey))
      .then(function (buf) { return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join(''); });
  }

  function post(path, body) {
    return fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); }).catch(function () { return null; });
  }

  // 上报收款（原生监听事件触发）
  function report(amount) {
    if (!listenKey) return;
    return post('/listen/report', { listenKey: listenKey, amount: parseFloat(amount) });
  }

  // 心跳
  function heartbeat() {
    if (!listenKey) return;
    return post('/listen/heartbeat', { listenKey: listenKey, deviceId: deviceId });
  }

  // 初始化：登录成功后调用（派生并缓存 listenKey，注册事件，启动心跳）
  function init(adminKey) {
    if (!isNative()) return; // 浏览器打开不启用
    deriveKey(adminKey).then(function (k) {
      listenKey = k;
      try { localStorage.setItem(KEY_CACHE, k); } catch (e) {}
      // 立即心跳一次 + 每 5 分钟
      heartbeat();
      if (!window._kwHeartbeatTimer) {
        window._kwHeartbeatTimer = setInterval(heartbeat, 5 * 60 * 1000);
      }
      // 原生监听事件（Capacitor notifyListeners 映射为 DOM 事件）
      document.addEventListener('onPayReceived', function (e) {
        var amt = e && e.detail && e.detail.amount;
        if (amt) report(amt);
      });
      // 刷新概览页监听状态
      if (window.KWAdminRefresh) window.KWAdminRefresh();
    });
  }

  // 查询系统通知监听是否已授权
  function checkEnabled(cb) {
    if (!isNative() || !window.Capacitor || !window.Capacitor.Plugins || !window.Capacitor.Plugins.PayListener) { cb && cb(false); return; }
    window.Capacitor.Plugins.PayListener.checkEnabled().then(function (r) { cb && cb(!!r.enabled); }).catch(function () { cb && cb(false); });
  }

  // 跳系统设置授权
  function openSettings() {
    if (!isNative() || !window.Capacitor || !window.Capacitor.Plugins || !window.Capacitor.Plugins.PayListener) return;
    window.Capacitor.Plugins.PayListener.openSettings();
  }

  // 自检：环境 / listenKey / 心跳连通 / 通知权限，结果用 toast 展示
  function selfCheck() {
    var lines = [];
    var show = function () { if (window.toast) window.toast(lines.join('\n'), 15000); };
    // 1. 运行环境
    if (!isNative()) { lines.push('环境：浏览器，监听仅管理APK生效'); show(); return; }
    lines.push('环境：管理APK ✓');
    // 2. listenKey 是否已派生（未登录/未 init 则空）
    if (!listenKey) {
      lines.push('暗号：未派生（请重新登录一次管理密码）');
      // 仍尝试触发一次派生：若当前无 listenKey 且登录页已存 key，可尝试 init
      var saved = '';
      try { saved = localStorage.getItem('kuanwei_admin_key') || ''; } catch (e) {}
      if (saved) { init(saved); lines.push('已自动重新初始化'); }
      show(); return;
    }
    lines.push('暗号：已派生 ✓');
    // 3. 心跳连通性（立即发一次）
    post('/listen/heartbeat', { listenKey: listenKey, deviceId: deviceId }).then(function (r) {
      if (r && r.ok) {
        lines.push('心跳：上报成功 ✓');
      } else if (r && r.error) {
        lines.push('心跳：被拒（' + r.error + '）→ 密码可能已改，请重新登录');
      } else {
        lines.push('心跳：网络失败');
      }
      // 4. 通知监听权限
      checkEnabled(function (enabled) {
        lines.push('通知监听权限：' + (enabled ? '已开启 ✓' : '未开启 → 点下方提示去系统设置开启'));
        show();
      });
    });
  }

  window.KWListen = { init: init, report: report, heartbeat: heartbeat, checkEnabled: checkEnabled, openSettings: openSettings, selfCheck: selfCheck, isNative: isNative };
})();
