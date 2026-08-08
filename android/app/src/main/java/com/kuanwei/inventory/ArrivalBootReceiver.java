package com.kuanwei.inventory;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

/**
 * 开机自启接收器：手机重启后自动恢复到店提醒前台服务（若上次开启过监测）
 */
public class ArrivalBootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            if (intent == null || !"android.intent.action.BOOT_COMPLETED".equals(intent.getAction())) return;
            SharedPreferences sp = context.getSharedPreferences("kuanwei_arrival", Context.MODE_PRIVATE);
            if (!sp.getBoolean("monitor_on", false)) return;
            Intent svc = new Intent(context, ArrivalForegroundService.class);
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                context.startForegroundService(svc);
            } else {
                context.startService(svc);
            }
        } catch (Exception ignored) {}
    }
}
