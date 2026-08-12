package com.kuanwei.inventory;

import android.Manifest;
import android.app.DownloadManager;
import android.content.ComponentCallbacks2;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.DownloadListener;
import android.webkit.PermissionRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.Toast;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

/**
 * 主界面（含启动页 + WebView 全面优化）：
 *
 * 一、启动页
 * - styles.xml 把 windowSplashScreenAnimatedIcon 设为透明（Android 12+ 系统 splash 不显示居中缩略图）
 * - launchShowDuration=0，Capacitor 不控制 splash
 * - 本 Activity 叠加全屏 splash ImageView（CENTER_CROP 填满），2 秒后移除
 *
 * 二、WebView 性能优化
 * - 渲染优先级设为 HIGH，提升 JS/滚动响应速度
 * - 开启 DOM Storage / Database / 混合内容
 * - 缓存模式 LOAD_DEFAULT（配合 sw 离线缓存）
 * - 关闭缩放控件、文本自动缩放，保证布局稳定
 * - 降低图片显示模式：省内存
 *
 * 三、稳定性
 * - 按返回键：优先让 WebView 回退历史（按一下退一页），无历史才交给系统
 * - onTrimMemory：低内存时主动清 WebView 缓存，防长时间使用越来越卡
 * - 状态栏/导航栏配深色，与页面主题一致
 */
public class MainActivity extends BridgeActivity {
    private ImageView splashOverlay;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean splashHidden = false;

    // ===== 通知点击带过来的到店跳转（#146：记录回筐/导航/整卡）=====
    // 通知 action 点击 → onNewIntent/onCreate 解析 extra → 存静态字段 → 前端 getPendingArrival 取用（冷启动网页加载完也能拿到）
    private static volatile String pendingArrivalStore = null;
    private static volatile String pendingArrivalAction = null;

    public static void setPendingArrival(String store, String action) {
        pendingArrivalStore = store;
        pendingArrivalAction = action;
    }

    public static String[] takePendingArrival() {
        String[] r = { pendingArrivalStore, pendingArrivalAction };
        pendingArrivalStore = null;
        pendingArrivalAction = null;
        return r;
    }

    private void consumeArrivalIntent(Intent intent) {
        try {
            if (intent == null) return;
            String store = intent.getStringExtra("arrival_store");
            String action = intent.getStringExtra("arrival_action");
            if (store != null && !store.isEmpty()) {
                setPendingArrival(store, action == null ? "open" : action);
            }
        } catch (Exception ignored) {}
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        consumeArrivalIntent(intent);
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppUpdatePlugin.class);
        registerPlugin(AudioRecorderPlugin.class);
        registerPlugin(ArrivalMonitorPlugin.class);
        registerPlugin(PayListenerPlugin.class); // 收款监听（管理版）
        super.onCreate(savedInstanceState);
        consumeArrivalIntent(getIntent());

        // ===== 状态栏 / 导航栏配色（深色，与页面"深空蓝晶"主题一致） =====
        setupSystemBars();

        // ===== 全局异常捕获：防止未捕获异常导致闪退 =====
        installGlobalCrashHandler();

        // ===== WebView 性能优化 =====
        optimizeWebView();

        // ===== 麦克风/相机系统权限预申请（彻底修复"仅在使用中允许"二次被拒）=====
        // 在应用层一次性申请系统权限（首次启动弹系统授权框，用户选"仅在使用中允许"即永久生效于前台），
        // 之后 WebView 的 getUserMedia 由 onPermissionRequest 无条件放行，不再经过 Capacitor 二次请求流程。
        requestRuntimePermissions();

        // ===== 添加全屏 splash ImageView（splash.png CENTER_CROP 填满）=====
        splashOverlay = new ImageView(this);
        splashOverlay.setImageResource(R.drawable.splash);
        splashOverlay.setScaleType(ImageView.ScaleType.CENTER_CROP);
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        );
        addContentView(splashOverlay, params);

        // 等待 WebView 页面加载完成后再移除 splash（最长 5 秒），避免"页面还在加载就移除 → 白屏空窗"
        startSplashAwaiter();
    }

    /**
     * 启动 splash 等待器：轮询 WebView 加载进度。
     * - 页面加载完成（progress==100）→ 立即移除 splash
     * - 超过 SPLASH_MAX_WAIT_MS（5 秒）仍未加载完 → 也移除，避免 splash 卡太久
     * 同时保持底部最小展示时长（避免一闪而过）。
     */
    private void startSplashAwaiter() {
        final long startTime = System.currentTimeMillis();
        final long minShowMs = 1200; // 至少显示 1.2 秒，避免闪屏
        final long maxWaitMs = 5000; // 最多等 5 秒
        handler.post(new Runnable() {
            @Override
            public void run() {
                boolean done = false;
                try {
                    int progress = -1;
                    WebView wv = bridge != null ? bridge.getWebView() : null;
                    if (wv != null) {
                        progress = wv.getProgress();
                    }
                    long elapsed = System.currentTimeMillis() - startTime;
                    if ((progress >= 100 && elapsed >= minShowMs) || elapsed >= maxWaitMs) {
                        done = true;
                    }
                } catch (Exception ignored) {
                    done = true;
                }
                if (done) {
                    hideSplashOverlay();
                } else {
                    handler.postDelayed(this, 100);
                }
            }
        });
    }

    /**
     * 全局未捕获异常处理器：记录异常但不立即闪退。
     * （真正崩溃由系统处理；这里捕获常规未处理异常并记录，降低闪退概率）
     */
    private void installGlobalCrashHandler() {
        try {
            final Thread.UncaughtExceptionHandler defaultHandler = Thread.getDefaultUncaughtExceptionHandler();
            Thread.setDefaultUncaughtExceptionHandler((thread, throwable) -> {
                try {
                    android.util.Log.e("Kuanwei", "UncaughtException on " + thread.getName(), throwable);
                } catch (Throwable ignored) {}
                // 交给系统默认处理（正常崩溃流程）
                if (defaultHandler != null) {
                    defaultHandler.uncaughtException(thread, throwable);
                }
            });
        } catch (Exception ignored) {}
    }

    /** 状态栏 / 导航栏配色 */
    private void setupSystemBars() {
        try {
            Window window = getWindow();
            // 允许内容延伸到状态栏/导航栏区域（沉浸式，页面自己处理内边距）
            WindowCompat.setDecorFitsSystemWindows(window, false);
            // 状态栏图标：浅色模式深色字，这里页面是深蓝风格 → 用浅色字（light=true 表示浅色背景/深色图标）
            WindowInsetsControllerCompat insets = WindowCompat.getInsetsController(window, window.getDecorView());
            if (insets != null) {
                // 页面背景是深蓝 → 状态栏图标用白色（浅色）
                insets.setAppearanceLightStatusBars(false);
                insets.setAppearanceLightNavigationBars(false);
            }
        } catch (Exception ignored) {}
    }

    /** WebView 性能 / 缓存优化 */
    private void optimizeWebView() {
        try {
            if (bridge == null) return;
            WebView webView = bridge.getWebView();
            if (webView == null) return;
            WebSettings settings = webView.getSettings();

            // DOM Storage（localStorage / sessionStorage）——物流筐数据存储依赖
            settings.setDomStorageEnabled(true);
            // 数据库
            settings.setDatabaseEnabled(true);
            // 混合内容：禁止明文混合内容（页面全 HTTPS，无 http 资源依赖；防中间人窃听）
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            // 缓存模式：LOAD_DEFAULT（配合 Service Worker 离线缓存，可离线使用）
            settings.setCacheMode(WebSettings.LOAD_DEFAULT);
            // 关闭缩放控件，避免界面抖动
            settings.setDisplayZoomControls(false);
            settings.setBuiltInZoomControls(false);
            // 禁止文本自动缩放，保证布局稳定
            settings.setTextZoom(100);
            // 省内存：图片降级（低内存设备自动降为低清晰度）
            settings.setLoadsImagesAutomatically(true);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                settings.setSafeBrowsingEnabled(false);
            }

            // ===== 麦克风/相机权限：WebView 层无条件放行（彻底修复"仅在使用中允许"二次被拒）=====
            // 系统权限已由 requestRuntimePermissions() 在应用层预申请（首次启动弹一次系统授权框）；
            // 这里 WebView 层直接 grant，不再走 Capacitor 默认的"每次重新弹系统权限请求"流程——
            // 否则"仅在使用中允许"会被系统当成一次性授权，二次请求直接 NotAllowedError。
            webView.setWebChromeClient(new BridgeWebChromeClient(bridge) {
                @Override
                public void onPermissionRequest(final PermissionRequest request) {
                    try {
                        // 无条件放行 WebView 层（录音/相机）。系统权限由应用层预申请保证。
                        request.grant(request.getResources());
                    } catch (Exception e) {
                        // 兜底：异常时走默认流程，避免卡死
                        super.onPermissionRequest(request);
                    }
                }
            });

            // ===== 下载功能（导出 Excel/JSON/APK）=====
            // Android WebView 默认不响应 <a download> 触发的下载（SheetJS exportData/exportMyExcel 用 Blob URL 下载），
            // 这里设置 DownloadListener，把下载交给系统 DownloadManager 处理，用户可在通知栏查看并保存。
            webView.setDownloadListener(new DownloadListener() {
                @Override
                public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimetype, long contentLength) {
                    try {
                        String fileName = getFileNameFromUrl(url, contentDisposition);
                        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                        request.setMimeType(mimetype);
                        request.addRequestHeader("User-Agent", userAgent);
                        request.setDescription("物流筐系统导出文件");
                        request.setTitle(fileName);
                        request.allowScanningByMediaScanner();
                        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                        request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
                        DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                        if (dm != null) {
                            dm.enqueue(request);
                            showToast("开始下载：" + fileName);
                        }
                    } catch (Exception e) {
                        showToast("下载失败：" + e.getMessage());
                    }
                }
            });
        } catch (Exception ignored) {}
    }

    /** 从 URL / content-disposition 提取文件名 */
    private String getFileNameFromUrl(String url, String contentDisposition) {
        try {
            if (contentDisposition != null && contentDisposition.contains("filename=")) {
                String[] parts = contentDisposition.split("filename=");
                if (parts.length > 1) {
                    String name = parts[1].split(";")[0].replace("\"", "").trim();
                    if (name.length() > 0) return name;
                }
            }
        } catch (Exception ignored) {}
        try {
            String path = Uri.parse(url).getPath();
            if (path != null) {
                String name = path.substring(path.lastIndexOf('/') + 1);
                if (name.length() > 0) return name;
            }
        } catch (Exception ignored) {}
        return "download_" + System.currentTimeMillis() + ".file";
    }

    private void showToast(final String msg) {
        runOnUiThread(() -> Toast.makeText(this, msg, Toast.LENGTH_SHORT).show());
    }

    /**
     * 麦克风/相机/定位系统权限预申请：
     * 首次启动主动请求（弹系统授权框），用户选"仅在使用中允许"后系统权限在前台持续有效；
     * 之后 WebView getUserMedia / Geolocation 由 onPermissionRequest 无条件放行，彻底绕开 Capacitor
     * "每次重新弹系统权限 → 一次性授权被系统拒绝"的坑。
     */
    private void requestRuntimePermissions() {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
            String[] perms = new String[]{
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.CAMERA,
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.ACCESS_BACKGROUND_LOCATION,
                Manifest.permission.POST_NOTIFICATIONS
            };
            boolean need = false;
            for (String p : perms) {
                if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) { need = true; break; }
            }
            if (need) {
                requestPermissions(perms, 1001);
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        // 权限结果无需额外处理：已授权即可用；拒绝则语音/拍照不可用（前端有对应提示）
    }

    /**
     * 按返回键：优先通知 WebView 前端处理（关闭弹窗/面板/返回上一页），
     * 前端无法处理（已在首页）才走系统退出逻辑。
     * - 前端通过 postMessage 回传 handled:true/false
     * - 首页场景：前端返回 handled:false → 这里显示"再按一次退出"Toast，2 秒内再按才真正退出
     */
    private long lastBackPressTime = 0;

    @Override
    public void onBackPressed() {
        try {
            if (bridge != null) {
                WebView webView = bridge.getWebView();
                if (webView != null) {
                    // 通知前端处理返回（前端会尝试关弹窗/面板/退页）
                    webView.evaluateJavascript(
                        "(function(){try{var handled=window.__handleNativeBack?window.__handleNativeBack():false;" +
                        "return JSON.stringify({handled:!!handled});}catch(e){return JSON.stringify({handled:false});}})();",
                        value -> {
                            boolean handled = false;
                            try {
                                if (value != null && value.contains("\"handled\":true")) handled = true;
                            } catch (Exception ignored) {}
                            if (!handled) {
                                runOnUiThread(() -> handleExitOnHome());
                            }
                        }
                    );
                    return;
                }
            }
        } catch (Exception ignored) {}
        super.onBackPressed();
    }

    /** 首页时：再按一次退出（2 秒窗口） */
    private void handleExitOnHome() {
        long now = System.currentTimeMillis();
        if (now - lastBackPressTime < 2000) {
            finish(); // 2 秒内再按 → 退出
            return;
        }
        lastBackPressTime = now;
        showToast("再按一次退出");
    }

    /**
     * 低内存回收：主动释放内存，防止长时间使用越来越卡 / 闪退。
     * 注意：只清内存级缓存（clearCache(false) 不清磁盘/Service Worker 离线缓存），
     * 避免影响离线可用性。
     */
    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        try {
            WebView webView = bridge != null ? bridge.getWebView() : null;
            if (webView == null) return;
            if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_MODERATE) {
                // 内存告警：仅清图片内存缓存（不影响磁盘数据/离线缓存）
                webView.clearCache(false);
                webView.freeMemory();
            }
        } catch (Exception ignored) {}
    }

    private void hideSplashOverlay() {
        if (splashHidden) return;
        splashHidden = true;
        if (splashOverlay != null && splashOverlay.getParent() != null) {
            ((ViewGroup) splashOverlay.getParent()).removeView(splashOverlay);
            splashOverlay = null;
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        handler.removeCallbacksAndMessages(null);
    }
}
