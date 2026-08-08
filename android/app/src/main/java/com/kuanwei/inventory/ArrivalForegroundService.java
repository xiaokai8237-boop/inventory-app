package com.kuanwei.inventory;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * 到店提醒前台服务：
 * - 通知栏常驻「物流筐 · 到店提醒运行中」（安卓规定后台干活的 APP 必须亮牌子，也是防偷跑证明）
 * - START_STICKY：被系统杀掉后自动重启
 * - onTaskRemoved：用户从最近任务划掉时自动重启（保活）
 */
public class ArrivalForegroundService extends Service {
    public static final String CHANNEL_SERVICE = "kuanwei_arrival_service";
    public static final int NOTIF_ID_SERVICE = 7001;

    @Override
    public void onCreate() {
        super.onCreate();
        startAsForeground();
    }

    private void startAsForeground() {
        try {
            NotificationChannel ch = new NotificationChannel(CHANNEL_SERVICE,
                    "到店提醒", NotificationManager.IMPORTANCE_MIN);
            ch.setDescription("到店提醒监测运行中（常驻）");
            ch.setShowBadge(false);
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.createNotificationChannel(ch);

            Intent open = new Intent(this, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pi = PendingIntent.getActivity(this, 0, open,
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE : PendingIntent.FLAG_UPDATE_CURRENT);

            Notification n = new Notification.Builder(this, CHANNEL_SERVICE)
                    .setSmallIcon(R.drawable.ic_stat_notify)
                    .setContentTitle("物流筐 · 到店提醒运行中")
                    .setContentText("到达设置距离的门店时提醒你")
                    .setOngoing(true)
                    .setContentIntent(pi)
                    .build();

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIF_ID_SERVICE, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIF_ID_SERVICE, n);
            }
        } catch (Exception ignored) {}
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY; // 被杀后系统自动重启
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        // 用户划掉任务栏 → 重启服务（保活关键）
        try {
            Intent restart = new Intent(getApplicationContext(), ArrivalForegroundService.class);
            restart.setPackage(getPackageName());
            startService(restart);
        } catch (Exception ignored) {}
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        // 确保通知清除
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(NOTIF_ID_SERVICE);
        } catch (Exception ignored) {}
    }
}
