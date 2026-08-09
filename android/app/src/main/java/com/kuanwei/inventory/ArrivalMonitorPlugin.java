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
import android.text.Html;

import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingClient;
import com.google.android.gms.location.GeofencingRequest;
import com.google.android.gms.location.LocationServices;

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

    /** 发到店通知（#146：8 套模板差异渲染 + 记录回筐/导航按钮）data: {storeName, distM, goods, template, ring, vibrate, silent} */
    @PluginMethod
    public void notifyArrival(PluginCall call) {
        try {
            String dataStr = call.getString("data", "");
            boolean ring = call.getBoolean("ring", true);
            boolean vibrate = call.getBoolean("vibrate", true);
            boolean silent = call.getBoolean("silent", false);
            String template = call.getString("template", "rich");

            ensureChannel();
            String channel = silent ? ArrivalForegroundService.CHANNEL_SERVICE : CHANNEL_ARRIVAL;

            String storeName = "门店";
            int dist = 0;
            JSONArray goods = new JSONArray();
            try {
                JSONObject d = new JSONObject(dataStr);
                storeName = d.optString("storeName", "门店");
                dist = d.optInt("distM", 0);
                if (d.optJSONArray("goods") != null) goods = d.optJSONArray("goods");
            } catch (Exception e) {}

            String title = "即将到达 " + storeName;
            String body = buildTemplateBody(template, storeName, dist, goods, dataStr);

            // 启动前台服务（保活 + 常驻牌子）
            try {
                Intent svc = new Intent(getContext(), ArrivalForegroundService.class);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    getContext().startForegroundService(svc);
                } else {
                    getContext().startService(svc);
                }
            } catch (Exception ignored) {}

            // 整卡点击：打开 APP 进回收页单店视图
            Intent open = new Intent(getContext(), MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            open.putExtra("arrival_store", storeName);
            open.putExtra("arrival_action", "open");
            PendingIntent pi = PendingIntent.getActivity(getContext(), 0, open,
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE : PendingIntent.FLAG_UPDATE_CURRENT);

            NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            // alarm 用高重要度渠道；silent 用低重要度渠道（无声音）
            if ("alarm".equals(template) && nm != null) {
                if (nm.getNotificationChannel("arrival_alarm") == null) {
                    NotificationChannel ch = new NotificationChannel("arrival_alarm", "到店提醒(紧急)", NotificationManager.IMPORTANCE_HIGH);
                    ch.enableVibration(true);
                    nm.createNotificationChannel(ch);
                }
                channel = "arrival_alarm";
            }

            Notification.Builder nb = new Notification.Builder(getContext(), channel)
                    .setSmallIcon(R.drawable.ic_stat_notify)
                    .setContentTitle(title)
                    .setContentText(body.replace('\n', ' '))
                    .setAutoCancel(true)
                    .setContentIntent(pi);
            // 模板差异：颜色条（alarm 红 / silent 灰 / rich 金 / dist 青）
            if ("alarm".equals(template)) nb.setColor(0xFFE53935);
            else if ("silent".equals(template)) nb.setColor(0xFF9E9E9E);
            else if ("rich".equals(template)) nb.setColor(0xFFF5DC92);
            else if ("dist".equals(template)) nb.setColor(0xFF7CE8E0);
            // 默认声音/震动（alarm 强制响铃震动；silent 无）
            if ("alarm".equals(template)) { ring = true; vibrate = true; }
            int def = 0;
            if (ring && !silent) def |= Notification.DEFAULT_SOUND;
            if (vibrate && !silent) def |= Notification.DEFAULT_VIBRATE;
            nb.setDefaults(def);

            // 按钮：记录回筐（触发点 → 回收页单店视图）/ 导航去下一家
            Intent recycleIntent = new Intent(getContext(), MainActivity.class);
            recycleIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            recycleIntent.putExtra("arrival_store", storeName);
            recycleIntent.putExtra("arrival_action", "recycle");
            PendingIntent recyclePi = PendingIntent.getActivity(getContext(), 1, recycleIntent,
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE : PendingIntent.FLAG_UPDATE_CURRENT);
            nb.addAction(R.drawable.ic_stat_notify, "记录回筐", recyclePi);

            Intent navIntent = new Intent(getContext(), MainActivity.class);
            navIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            navIntent.putExtra("arrival_store", storeName);
            navIntent.putExtra("arrival_action", "navigate");
            PendingIntent navPi = PendingIntent.getActivity(getContext(), 2, navIntent,
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE : PendingIntent.FLAG_UPDATE_CURRENT);
            nb.addAction(R.drawable.ic_stat_notify, "导航去下一家", navPi);

            // 需求3 方案B（用户拍板）：不用 RemoteViews（小米折叠态不认），用 HTML 染色 + BigTextStyle，所有 ROM 保证显示
            // 去掉距离行；标题"即将到达 店名"系统显示；5 筐每筐一行染色；打卡红字；双按钮系统级
            if ("rich".equals(template)) {
                try {
                    CharSequence richText = Html.fromHtml(buildRichHtmlBody(goods), Html.FROM_HTML_MODE_LEGACY);
                    nb.setContentText(richText);
                    nb.setStyle(new Notification.BigTextStyle().bigText(richText));
                } catch (Exception ignored) {}
            } else {
                nb.setStyle(new Notification.BigTextStyle().bigText(body));
            }

            // 记录待处理到店（供 MainActivity 转发给网页；冷启动时网页加载完再取）
            MainActivity.setPendingArrival(storeName, "open");

            if (nm != null) nm.notify(7002, nb.build());
            call.resolve();
        } catch (Exception e) {
            call.reject("notify_error");
        }
    }

    /** 需求3 方案B：HTML 染色正文（所有 ROM 保证显示；无距离行；5 筐每筐一行染色 + 打卡红字） */
    private String buildRichHtmlBody(JSONArray goods) {
        // 5 筐配色（与 #146 v6 定稿一致）
        final String[] COLORS = { "#F5A623", "#F5DC92", "#7CE8E0", "#8FA9FF", "#4ADE80" };
        StringBuilder sb = new StringBuilder();
        int idx = 0;
        for (int i = 0; i < goods.length(); i++) {
            JSONObject g = goods.optJSONObject(i);
            if (g == null) continue;
            int qty = g.optInt("qty", 0);
            if (qty <= 0) continue;
            String c = COLORS[idx % COLORS.length];
            idx++;
            String name = g.optString("name", "筐");
            sb.append("<font color='#FFFFFF'><b>").append(name).append("</b></font> ");
            sb.append("<font color='").append(c).append("'><b>").append(qty).append("</b></font>");
            int whole = g.optInt("whole", 0);
            if (whole > 0) {
                sb.append("  <font color='").append(c).append("'><b>整箱 ").append(whole).append("</b></font>");
            }
            sb.append("<br>");
        }
        // 打卡红字（无 emoji，符合 P0 规则）
        sb.append("<font color='#FF4D4F'><b>【不要忘记打卡！】</b></font>");
        return sb.toString();
    }

    /** 前端取未处理的到店跳转（通知点击带过来的店名/动作；取后清空） */
    @PluginMethod
    public void getPendingArrival(PluginCall call) {
        try {
            String[] p = MainActivity.takePendingArrival();
            JSObject ret = new JSObject();
            ret.put("storeName", p[0] == null ? "" : p[0]);
            ret.put("action", p[1] == null ? "" : p[1]);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("pending_error");
        }
    }

    /** 按 8 套模板构建通知正文 */
    private String buildTemplateBody(String template, String storeName, int dist, JSONArray goods, String dataStr) {
        StringBuilder sb = new StringBuilder();
        boolean isDetail = "detail".equals(template);
        boolean isList = "list".equals(template);
        boolean isMinimal = "minimal".equals(template);
        if (isMinimal) {
            sb.append("距你 ").append(dist).append(" 米");
        } else if (isDetail) {
            sb.append("距你 ").append(dist).append(" 米\n");
            appendGoodsLines(sb, goods, true);
            sb.append("\n不要忘记打卡！");
        } else if (isList) {
            JSONArray route = null;
            try { route = new JSONObject(dataStr).optJSONArray("route"); } catch (Exception ignored) {}
            if (route != null && route.length() > 0) {
                for (int i = 0; i < route.length(); i++) {
                    JSONObject r = route.optJSONObject(i);
                    if (r == null) continue;
                    sb.append(r.optString("name", "店")).append("  ").append(r.optString("dist", ""));
                    int qty = r.optInt("qty", 0);
                    if (qty > 0) sb.append("  ").append(qty);
                    sb.append("\n");
                }
            } else {
                sb.append("距你 ").append(dist).append(" 米\n不要忘记打卡！");
            }
        } else if ("dist".equals(template)) {
            sb.append("距你 ").append(dist).append(" 米\n");
            appendGoodsLines(sb, goods, false);
            sb.append("\n不要忘记打卡！");
        } else if ("rich".equals(template)) {
            sb.append("距你 ").append(dist).append(" 米\n此店需要发出的各筐整箱数量\n");
            appendGoodsLines(sb, goods, true);
            sb.append("\n不要忘记打卡！");
        } else {
            // classic / alarm / silent：标准一行各筐
            sb.append("距你 ").append(dist).append(" 米\n");
            StringBuilder line = new StringBuilder();
            for (int i = 0; i < goods.length(); i++) {
                JSONObject g = goods.optJSONObject(i);
                if (g == null) continue;
                int qty = g.optInt("qty", 0);
                if (qty <= 0) continue;
                if (line.length() > 0) line.append(" · ");
                line.append(g.optString("name", "")).append(" ").append(qty);
                int whole = g.optInt("whole", 0);
                if (whole > 0) line.append("/整箱").append(whole);
            }
            if (line.length() > 0) sb.append(line).append("\n");
            sb.append("不要忘记打卡！");
        }
        return sb.toString();
    }

    private void appendGoodsLines(StringBuilder sb, JSONArray goods, boolean withWholeLine) {
        for (int i = 0; i < goods.length(); i++) {
            JSONObject g = goods.optJSONObject(i);
            if (g == null) continue;
            int qty = g.optInt("qty", 0);
            if (qty <= 0) continue;
            sb.append(g.optString("name", "")).append(" ").append(qty);
            int whole = g.optInt("whole", 0);
            if (withWholeLine && whole > 0) sb.append(" · 整箱 ").append(whole);
            else if (whole > 0) sb.append("/整箱").append(whole);
            sb.append("\n");
        }
    }

    /** 注册门店地理围栏（#145 真实接入：系统级监测，进程被杀也能触发）route: [{name, lat, lng}] */
    @PluginMethod
    public void registerRoute(PluginCall call) {
        try {
            String routeStr = call.getString("route", "[]");
            double radiusM = call.getDouble("radiusM", 500.0);
            JSONArray route = new JSONArray(routeStr);
            List<Geofence> fences = new ArrayList<>();
            for (int i = 0; i < route.length(); i++) {
                JSONObject o = route.getJSONObject(i);
                double lat = o.optDouble("lat", 0);
                double lng = o.optDouble("lng", 0);
                String name = o.optString("name", "店" + i);
                if (lat == 0 && lng == 0) continue;
                // 名字做 hash 后缀保证 requestId 唯一且稳定
                String reqId = GEOFENCE_ID_PREFIX + i + "_" + Math.abs(name.hashCode());
                fences.add(new Geofence.Builder()
                        .setRequestId(reqId)
                        .setCircularRegion(lat, lng, (float) radiusM)
                        .setExpirationDuration(Geofence.NEVER_EXPIRE)
                        .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER)
                        .build());
            }
            if (fences.isEmpty()) { call.resolve(new JSObject().put("registered", 0)); return; }
            GeofencingRequest req = new GeofencingRequest.Builder()
                    .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER)
                    .addGeofences(fences)
                    .build();
            Intent intent = new Intent(getContext(), ArrivalGeofenceReceiver.class);
            PendingIntent pi = PendingIntent.getBroadcast(getContext(), 0, intent,
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE : PendingIntent.FLAG_UPDATE_CURRENT);
            LocationServices.getGeofencingClient(getContext())
                    .addGeofences(req, pi)
                    .addOnSuccessListener(aVoid -> call.resolve(new JSObject().put("registered", fences.size())))
                    .addOnFailureListener(e -> call.reject("geofence_error:" + e.getMessage()));
        } catch (Exception e) {
            call.reject("register_error:" + e.getMessage());
        }
    }

    /** 移除围栏 + 停前台服务 */
    @PluginMethod
    public void stopMonitor(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), ArrivalGeofenceReceiver.class);
            PendingIntent pi = PendingIntent.getBroadcast(getContext(), 0, intent,
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE : PendingIntent.FLAG_UPDATE_CURRENT);
            LocationServices.getGeofencingClient(getContext()).removeGeofences(pi);
        } catch (Exception ignored) {}
        try {
            getContext().stopService(new Intent(getContext(), ArrivalForegroundService.class));
        } catch (Exception ignored) {}
        call.resolve();
    }

    /** 电池优化：直接弹系统「允许忽略电池优化」请求框（用户只点允许，不用跳设置列表） */
    @PluginMethod
    public void requestBatteryIgnore(PluginCall call) {
        try {
            String pkg = getContext().getPackageName();
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:" + pkg));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            // 某些机型不支持该请求框 → 退回电池优化设置列表
            try {
                Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
                call.resolve();
            } catch (Exception e2) {
                call.reject("battery_request_error");
            }
        }
    }

    /** 通知权限是否已开启（NotificationManagerCompat，系统真实状态，修复 WebView Notification API 误报） */
    @PluginMethod
    public void notificationEnabled(PluginCall call) {
        try {
            boolean enabled = NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
            call.resolve(new JSObject().put("enabled", enabled));
        } catch (Exception e) {
            call.resolve(new JSObject().put("enabled", false));
        }
    }

    /** 自启动：尝试厂商专属跳转（小米/华为/OPPO/vivo），全失败跳应用详情兜底 */
    @PluginMethod
    public void openAutoStart(PluginCall call) {
        String[] intents = new String[]{
                // 小米/红米
                "com.miui.securitycenter/.autostart.AutoStartManagementActivity",
                "com.miui.securitycenter/com.miui.permcenter.autostart.AutoStartManagementActivity",
                // 华为/荣耀
                "com.huawei.systemmanager/.startupmgr.ui.StartupNormalAppListActivity",
                "com.huawei.systemmanager/.optimize.process.ProtectActivity",
                // OPPO / realme
                "com.coloros.safecenter/.permission.startup.StartupAppListActivity",
                "com.coloros.safecenter/.startupapp.StartupAppListActivity",
                "com.oppo.safe/.permission.startup.StartupAppListActivity",
                // vivo / iQOO
                "com.vivo.permissionmanager/.activity.BgStartUpManagerActivity",
                "com.iqoo.secure/.ui.phoneoptimize.BgStartUpManager",
                "com.vivo.permissionmanager/.activity.BgStartUpManagerActivity"
        };
        boolean jumped = false;
        for (String full : intents) {
            try {
                int slash = full.indexOf('/');
                String pkg = full.substring(0, slash);
                String cls = full.substring(slash + 1);
                Intent it = new Intent();
                it.setClassName(pkg, cls);
                it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(it);
                jumped = true;
                break;
            } catch (Exception ignored) {}
        }
        if (!jumped) {
            // 兜底：应用详情页（里面有自启动/后台入口）
            try {
                Intent it = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:" + getContext().getPackageName()));
                it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(it);
            } catch (Exception ignored) {}
        }
        call.resolve(new JSObject().put("jumped", jumped));
    }
}
