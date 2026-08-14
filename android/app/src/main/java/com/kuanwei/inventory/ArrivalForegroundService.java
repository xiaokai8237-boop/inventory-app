package com.kuanwei.inventory;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

/**
 * 到店提醒前台服务（#237 不依赖 Google 服务的原生 GPS 轮询改造；#278 增强定位可靠性）：
 * - 通知栏常驻「物流筐 · 到店提醒运行中」（安卓规定后台干活的 APP 必须亮牌子）
 * - START_STICKY：被系统杀掉后自动重启
 * - onTaskRemoved：用户从最近任务划掉时自动重启（保活）
 * - 双通道定位（不依赖 Google Play Services，国产手机无 GMS 也可用）：
 *   ① 被动监听 LocationManager（GPS + 网络）：每 20s / 5m 回调
 *   ② 主动兜底轮询：每 30s getLastKnownLocation 取最近一次位置计算
 *   → 停车 / 信号弱 / 被动回调被系统延迟时，主动轮询仍能触发到店通知
 * - 去重：进半径提醒一次，出店 1.5 倍半径后重置可再提醒
 * - 每次 onStartCommand 重读路线：registerRoute 更新店面坐标后服务在跑也能立即生效
 */
public class ArrivalForegroundService extends Service implements LocationListener {
    public static final String CHANNEL_SERVICE = "kuanwei_arrival_service";
    public static final int NOTIF_ID_SERVICE = 7001;
    public static final int NOTIF_ID_ARRIVAL_BASE = 7002;

    private static final String PREFS_ROUTE = "kuanwei_arrival_route";
    private static final String KEY_ROUTE = "route_json";
    private static final String KEY_DIST = "dist_m";
    private static final String PREFS_ON = "kuanwei_arrival";
    private static final String KEY_MONITOR_ON = "monitor_on";
    private static final String CHANNEL_ARRIVAL = "arrival_alarm";

    private static final long PASSIVE_MIN_TIME = 20 * 1000L; // 被动监听 20s
    private static final float PASSIVE_MIN_DIST = 5f;        // 5 米变化
    private static final long POLL_INTERVAL = 30 * 1000L;    // 主动兜底轮询 30s

    private LocationManager lm;
    private JSONArray route = new JSONArray();
    private double distM = 500;
    private final Set<String> alarmed = new HashSet<>();

    private final Handler pollHandler = new Handler(Looper.getMainLooper());
    private final Runnable pollRunnable = new Runnable() {
        @Override
        public void run() {
            pollLastKnown();
            pollHandler.postDelayed(this, POLL_INTERVAL);
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        startAsForeground();
        startLocationMonitor();
    }

    /** 常驻通知（前台服务亮牌） */
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

    /** 定位监测：重读路线 → 重新注册被动监听 → 启动主动兜底轮询（可重复调用，幂等） */
    private void startLocationMonitor() {
        try {
            SharedPreferences sp = getSharedPreferences(PREFS_ROUTE, Context.MODE_PRIVATE);
            String routeStr = sp.getString(KEY_ROUTE, "[]");
            distM = sp.getFloat(KEY_DIST, 500f);
            route = new JSONArray(routeStr);
            // 标记监测开启（开机自启用 ArrivalBootReceiver 读取）
            getSharedPreferences(PREFS_ON, Context.MODE_PRIVATE)
                    .edit().putBoolean(KEY_MONITOR_ON, true).apply();
        } catch (Exception ignored) {}
        try {
            // 先移除旧监听，避免重复注册（onStartCommand 会重复调用本方法）
            if (lm != null) {
                try { lm.removeUpdates(this); } catch (Exception ignored) {}
            }
            lm = (LocationManager) getSystemService(LOCATION_SERVICE);
            if (lm == null) return;
            boolean fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                    == PackageManager.PERMISSION_GRANTED;
            if (!fine) return;
            if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, PASSIVE_MIN_TIME, PASSIVE_MIN_DIST, this);
            }
            if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, PASSIVE_MIN_TIME, PASSIVE_MIN_DIST, this);
            }
        } catch (Exception ignored) {}
        // 主动兜底轮询（停车/信号弱时被动回调可能不触发，靠这个兜底）
        pollHandler.removeCallbacks(pollRunnable);
        pollHandler.postDelayed(pollRunnable, POLL_INTERVAL);
    }

    /** 主动取最近一次已知位置做到店判定（不依赖被动回调时机） */
    private void pollLastKnown() {
        try {
            if (lm == null) return;
            boolean fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                    == PackageManager.PERMISSION_GRANTED;
            if (!fine) return;
            Location loc = null;
            try { loc = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER); } catch (Exception ignored) {}
            if (loc == null) {
                try { loc = lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER); } catch (Exception ignored) {}
            }
            if (loc != null) checkArrival(loc);
        } catch (Exception ignored) {}
    }

    @Override
    public void onLocationChanged(Location loc) {
        checkArrival(loc);
    }

    /** 到店判定：遍历路线，进半径提醒一次（去重），出 1.5 倍半径重置 */
    private void checkArrival(Location loc) {
        try {
            if (loc == null || route == null) return;
            for (int i = 0; i < route.length(); i++) {
                JSONObject o = route.optJSONObject(i);
                if (o == null) continue;
                double lat = o.optDouble("lat", 0);
                double lng = o.optDouble("lng", 0);
                String name = o.optString("name", "门店");
                if (lat == 0 && lng == 0) continue;
                float[] res = new float[1];
                Location.distanceBetween(loc.getLatitude(), loc.getLongitude(), lat, lng, res);
                float d = res[0];
                if (d <= distM) {
                    // 进半径 → 提醒一次（去重）
                    if (!alarmed.contains(name)) {
                        alarmed.add(name);
                        JSONArray goods = o.optJSONArray("goods");
                        notifyArrival(name, goods);
                    }
                } else if (d > distM * 1.5) {
                    // 出店 1.5 倍半径 → 重置，允许再次提醒
                    alarmed.remove(name);
                }
            }
        } catch (Exception ignored) {}
    }

    /** 发到店通知（高优先级，响铃+震动；#275 按模板渲染：店名 + 各筐数量 + 打卡，去掉距离） */
    private void notifyArrival(String storeName, JSONArray goods) {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm == null) return;
            NotificationChannel ch = new NotificationChannel(CHANNEL_ARRIVAL,
                    "到店提醒", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("到达门店时提醒");
            nm.createNotificationChannel(ch);

            Intent open = new Intent(this, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pi = PendingIntent.getActivity(this, Math.abs(storeName.hashCode()), open,
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE : PendingIntent.FLAG_UPDATE_CURRENT);

            if (goods == null) goods = new JSONArray();
            CharSequence compactText = ArrivalMonitorPlugin.buildRichSpannable(goods, true);
            CharSequence fullText = ArrivalMonitorPlugin.buildRichSpannable(goods, false);

            Notification n = new Notification.Builder(this, CHANNEL_ARRIVAL)
                    .setSmallIcon(R.drawable.ic_stat_notify)
                    .setContentTitle("即将到达 " + storeName)
                    .setContentText(compactText)
                    .setStyle(new Notification.BigTextStyle().bigText(fullText))
                    .setAutoCancel(true)
                    .setDefaults(Notification.DEFAULT_SOUND | Notification.DEFAULT_VIBRATE)
                    .setContentIntent(pi)
                    .build();
            nm.notify(NOTIF_ID_ARRIVAL_BASE + Math.abs(storeName.hashCode()) % 1000, n);
        } catch (Exception ignored) {}
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // #278 每次启动都重读路线并重建监听：registerRoute 更新店面坐标后，已在运行的服务也能立即生效
        startLocationMonitor();
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
    public void onDestroy() {
        super.onDestroy();
        pollHandler.removeCallbacks(pollRunnable);
        // 停止定位监听 + 清除常驻通知（monitor_on 标记保留：可能被系统杀，START_STICKY 会重启）
        if (lm != null) {
            try { lm.removeUpdates(this); } catch (Exception ignored) {}
        }
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(NOTIF_ID_SERVICE);
        } catch (Exception ignored) {}
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // LocationListener 兼容方法
    @Override public void onProviderDisabled(String provider) {}
    @Override public void onProviderEnabled(String provider) {}
    @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
}
