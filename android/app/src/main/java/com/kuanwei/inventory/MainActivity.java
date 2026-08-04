package com.kuanwei.inventory;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageView;
import com.getcapacitor.BridgeActivity;

/**
 * 让 splash 图填满全屏：
 * - styles.xml 把 windowSplashScreenAnimatedIcon 设为透明，让 Android 12+ 系统 splash
 *   不显示居中缩略图（系统级限制：图标最大只能占屏幕 2/3 且居中，无法真正填满全屏）。
 * - capacitor.config.json 中 launchShowDuration=0，Capacitor 不再通过 setKeepOnScreenCondition
 *   延长系统 splash（首帧后系统 splash 自动结束）。
 * - 本 Activity 在 super.onCreate 后立即通过 addContentView 添加一个全屏 ImageView
 *   （CENTER_CROP，splash.png），叠加在系统 splash 上方，实现"splash 图填满全屏"的效果。
 *   2 秒后移除 ImageView，让 WebView 页面正常显示。
 */
public class MainActivity extends BridgeActivity {
    private static final long SPLASH_DURATION_MS = 2000;
    private ImageView splashOverlay;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean splashHidden = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppUpdatePlugin.class);
        super.onCreate(savedInstanceState);

        // 添加全屏 splash ImageView（splash.png CENTER_CROP 填满），叠加在系统 splash 上方
        splashOverlay = new ImageView(this);
        splashOverlay.setImageResource(R.drawable.splash);
        splashOverlay.setScaleType(ImageView.ScaleType.CENTER_CROP);
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        );
        addContentView(splashOverlay, params);

        // 延迟 2 秒后移除 splash 图，让 WebView 内容正常显示
        handler.postDelayed(this::hideSplashOverlay, SPLASH_DURATION_MS);
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