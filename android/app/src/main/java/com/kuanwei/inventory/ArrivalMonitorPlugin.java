package com.kuanwei.inventory;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * 到店提醒插件（#144/#145）：
 * 1. requestPermissions —— 申请后台定位 + 通知权限（配合前端傻瓜引导）
 * 2. openSettings(kind) —— 跳系统设置（location/notification/battery）引导用户开白名单
 * 3. notifyArrival(data) —— 发到店通知栏通知（按模板简化：标题 + 大文本内容）+ 启动前台服务
 * 4. registerRoute(routeJson) —— 注册门店地理围栏（后台由系统监测，进程被杀也能触发）
 * 5. stopMonitor() —— 移除围栏 + 停前台服务
 */
@CapacitorPlugin(name = "ArrivalMonitor")
public class ArrivalMonitorPlugin extends Plugin {
    public static final String CHANNEL_ARRIVAL = "kuanwei_arrival";
    private static final String GEOFENCE_ID_PREFIX = "kw_";

    private void ensureChannel() {
        try {
            NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ARRIVAL) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL_ARRIVAL, "到店提醒", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("到达门店时提醒你（店名/筐数/打卡）");
                ch.enableVibration(true);
                nm.createNotificationChannel(ch);
            }
        } catch (Exception ignored) {}
    }

    /** 申请定位（含后台）+ 通知权限（Android 13+ 通知权限独立） */
    @PluginMethod
    public void requestPermissions(PluginCall call) {
        try {
            List<String> perms = new ArrayList<>();
            perms.add(Manifest.permission.ACCESS_FINE_LOCATION);
            perms.add(Manifest.permission.ACCESS_COARSE_LOCATION);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                perms.add(Manifest.permission.ACCESS_BACKGROUND_LOCATION);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                perms.add(Manifest.permission.POST_NOTIFICATIONS);
            }
            List<String> need = new ArrayList<>();
            for (String p : perms) {
                if (ContextCompat.checkSelfPermission(getContext(), p) != PackageManager.PERMISSION_GRANTED) {
                    need.add(p);
                }
            }
            if (need.isEmpty()) { call.resolve(); return; }
            requestPermissionForAlias("arrival", call, "arrivalPermsCallback");
            // 记录 pending 权限列表供回调处理
            JSObject ret = new JSObject();
            ret.put("permissions", need.toArray(new String[0]));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("perm_error");
        }
    }

    @PluginMethod
    public void arrivalPermsCallback(PluginCall call) {
        call.resolve();
    }

    /** 跳系统设置：location=定位设置 / notification=通知设置 / battery=电池优化白名单 */
    @PluginMethod
    public void openSettings(PluginCall call) {
        try {
            String kind = call.getString("kind", "location");
            Intent intent;
            if ("notification".equals(kind)) {
                intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            } else if ("battery".equals(kind)) {
                intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            } else {
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:" + getContext().getPackageName()));
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("open_settings_error");
        }
    }

    /** 发到店通知（前端已算好店名/距离/筐数）data: {storeName, distM, goods, template, ring, vibrate, silent} */
    @PluginMethod
    public void notifyArrival(PluginCall call) {
        try {
            String dataStr = call.getString("data", "");
            boolean ring = call.getBoolean("ring", true);
            boolean vibrate = call.getBoolean("vibrate", true);
            boolean silent = call.getBoolean("silent", false);
            String template = call.getString("template", "rich");

            ensureChannel();
            // 静默模式：用低重要度渠道不发声音
            String channel = silent ? ArrivalForegroundService.CHANNEL_SERVICE : CHANNEL_ARRIVAL;

            String title = "即将到达门店";
            String body = "";
            try {
                JSONObject d = new JSONObject(dataStr);
                title = "即将到达 " + d.optString("storeName", "门店");
                int dist = d.optInt("distM", 0);
                StringBuilder sb = new StringBuilder();
                sb.append("距你 ").append(dist).append(" 米\n");
                JSONArray goods = d.optJSONArray("goods");
                if (goods != null) {
                    for (int i = 0; i < goods.length(); i++) {
                        JSONObject g = goods.getJSONObject(i);
                        String gn = g.optString("name", "");
                        int qty = g.optInt("qty", 0);
                        int whole = g.optInt("whole", 0);
                        if (qty > 0) {
                            sb.append(gn).append(" ").append(qty);
                            if (whole > 0) sb.append(" / 整箱 ").append(whole);
                            sb.append("\n");
                        }
                    }
                }
                sb.append("\n不要忘记打卡！");
                body = sb.toString();
            } catch (Exception e) {
                body = "已到达门店附近\n不要忘记打卡！";
            }

            // 启动前台服务（保活 + 常驻牌子）
            try {
                Intent svc = new Intent(getContext(), ArrivalForegroundService.class);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    getContext().startForegroundService(svc);
                } else {
                    getContext().startService(svc);
                }
            } catch (Exception ignored) {}

            Intent open = new Intent(getContext(), MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            open.putExtra("arrival_store", title);
            PendingIntent pi = PendingIntent.getActivity(getContext(), 0, open,
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE : PendingIntent.FLAG_UPDATE_CURRENT);

            Notification.Builder nb = new Notification.Builder(getContext(), channel)
                    .setSmallIcon(R.drawable.ic_stat_notify)
                    .setContentTitle(title)
                    .setContentText(body.replace('\n', ' '))
                    .setStyle(new Notification.BigTextStyle().bigText(body))
                    .setAutoCancel(true)
                    .setContentIntent(pi);
            int def = 0;
            if (ring) def |= Notification.DEFAULT_SOUND;
            if (vibrate) def |= Notification.DEFAULT_VIBRATE;
            nb.setDefaults(def);

            NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(7002, nb.build());
            call.resolve();
        } catch (Exception e) {
            call.reject("notify_error");
        }
    }

    /** 注册门店地理围栏（#145 接入 Geofencing 后启用；当前由前端前台 60s 轮询监测） */
    @PluginMethod
    public void registerRoute(PluginCall call) {
        // #145：恢复 Geofencing 注册逻辑
        call.resolve(new JSObject().put("mode", "foreground-poll"));
    }

    /** 移除围栏 + 停前台服务 */
    @PluginMethod
    public void stopMonitor(PluginCall call) {
        try {
            getContext().stopService(new Intent(getContext(), ArrivalForegroundService.class));
        } catch (Exception ignored) {}
        call.resolve();
    }
}
