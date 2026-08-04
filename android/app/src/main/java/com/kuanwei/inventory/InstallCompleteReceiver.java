package com.kuanwei.inventory;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 安装完成自动启动接收器：
 * 用户点系统安装器「完成/打开」后，包已安装/替换完成 → 系统发 PACKAGE_REPLACED / PACKAGE_ADDED 广播
 * （包相关广播在 Android 官方隐式广播豁免列表，允许静态注册）
 * → 检测到是本应用 → 自动拉起主界面，省去用户手动找图标打开。
 */
public class InstallCompleteReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (action == null) return;
        if (!Intent.ACTION_PACKAGE_REPLACED.equals(action) && !Intent.ACTION_PACKAGE_ADDED.equals(action)) return;

        // 校验是安装/替换的是本应用（intent data 形如 package:com.kuanwei.inventory）
        try {
            String data = intent.getDataString();
            if (data == null || !data.contains(context.getPackageName())) return;
        } catch (Exception ignored) {
            return;
        }

        // 延迟 600ms 再启动，让系统安装器界面正常收尾，然后自动打开软件
        try {
            final Context ctx = context.getApplicationContext();
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try { Thread.sleep(600); } catch (InterruptedException ignored) {}
                    try {
                        Intent launch = new Intent(ctx, MainActivity.class);
                        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                        ctx.startActivity(launch);
                    } catch (Exception ignored) {}
                }
            }).start();
        } catch (Exception ignored) {}
    }
}
