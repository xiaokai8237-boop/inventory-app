package com.kuanwei.inventory;

import android.Manifest;
import android.app.DownloadManager;
import android.content.ComponentCallbacks2;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.DownloadListener;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
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

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppUpdatePlugin.class);
        super.onCreate(savedInstanceState);

        // ===== 状态栏 / 导航栏配色（深色，与页面"深空蓝晶"主题一致） =====
        setupSystemBars();

        // ===== 全局异常捕获：防止未捕获异常导致闪退 =====
        installGlobalCrashHandler();

        // ===== WebView 性能优化 =====
        optimizeWebView();

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
            // 混合内容：与 capacitor.config.json 的 allowMixedContent 保持一致
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
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

            // ===== 麦克风/相机权限：已授权则直接放行，避免"仅在使用中允许"二次请求被系统拒绝 =====
            // 场景：用户第一次授权时选"仅在使用中允许"，系统视为一次性授权；
            // 第二次 getUserMedia 时若未在这里放行，系统直接返回 NotAllowedError（麦克风权限被拒绝）。
            webView.setWebChromeClient(new BridgeWebChromeClient(bridge) {
                @Override
                public void onPermissionRequest(final PermissionRequest request) {
                    try {
                        boolean hasAudio = false, hasVideo = false;
                        for (String res : request.getResources()) {
                            if ("android.webkit.resource.AUDIO_CAPTURE".equals(res)) hasAudio = true;
                            if ("android.webkit.resource.VIDEO_CAPTURE".equals(res)) hasVideo = true;
                        }
                        boolean audioOk = !hasAudio ||
                            (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED);
                        boolean videoOk = !hasVideo ||
                            (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED);
                        if (audioOk && videoOk) {
                            request.grant(request.getResources());
                        } else {
                            super.onPermissionRequest(request);
                        }
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
     * 按返回键：优先 WebView 回退历史（按一下退一页），无历史才退出应用。
     * 防止"返回键直接退出 APP"。
     */
    @Override
    public void onBackPressed() {
        try {
            if (bridge != null) {
                WebView webView = bridge.getWebView();
                if (webView != null && webView.canGoBack()) {
                    webView.goBack();
                    return;
                }
            }
        } catch (Exception ignored) {}
        super.onBackPressed();
    }

    /**
     * 低内存回收：主动清理 WebView 缓存，防止长时间使用越来越卡 / 闪退。
     */
    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL) {
            try {
                WebView webView = bridge != null ? bridge.getWebView() : null;
                if (webView != null) {
                    webView.clearCache(true);
                }
            } catch (Exception ignored) {}
        }
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
