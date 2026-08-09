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
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.RelativeSizeSpan;
import android.text.style.StyleSpan;
import android.graphics.Typeface;

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
            CharSequence body = buildTemplateBody(template, storeName, dist, goods, dataStr);

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
                    .setContentText(buildRichSpannable(goods, true))
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

            // 需求3 方案B+（用户拍板）：Spannable 染色放大（鲜艳色 + 大字）+ 折叠态塞满 + 无距离
            // 折叠态 = 紧凑一行全量（不展开也能看到全部筐）；展开态 = 分行完整版
            if ("rich".equals(template)) {
                try {
                    CharSequence compactText = buildRichSpannable(goods, true);
                    CharSequence fullText = buildRichSpannable(goods, false);
                    nb.setContentText(compactText);
                    nb.setStyle(new Notification.BigTextStyle().bigText(fullText));
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

    /** 需求3 方案B+（用户指定格式）：「此店需要发出：筐名 X 个 · … · 整箱 X 件 · 不要忘记打卡!」
     *  鲜艳饱和色 + 大字；筐名/数量同色；整箱合计琥珀色；打卡红字
     *  @param compact true=折叠态单行全量；false=展开态分行（前缀行/筐行/整箱行/打卡行）
     */
    private CharSequence buildRichSpannable(JSONArray goods, boolean compact) {
        // 鲜艳饱和色（在浅色/深色通知栏背景下都清晰）
        final int[] COLORS = { 0xFFFF7A00, 0xFFFFB300, 0xFF00C9C0, 0xFF5B7CFF, 0xFF00C853 };
        final int CLOCK = 0xFFFF3B30; // 打卡警示红（更鲜艳）
        final int WHOLE = 0xFFFFB300; // 整箱合计琥珀金
        SpannableStringBuilder sb = new SpannableStringBuilder();
        // 前缀「此店需要发出：」
        int s0 = sb.length();
        sb.append(compact ? "此店需要发出:" : "此店需要发出：");
        sb.setSpan(new StyleSpan(Typeface.BOLD), s0, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        sb.setSpan(new RelativeSizeSpan(compact ? 1.2f : 1.3f), s0, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        int wholeTotal = 0;
        int count = 0; // 已显示筐数（用于分隔）
        int idx = 0;   // 颜色索引
        for (int i = 0; i < goods.length(); i++) {
            JSONObject g = goods.optJSONObject(i);
            if (g == null) continue;
            int qty = g.optInt("qty", 0);
            if (qty <= 0) continue;
            String name = g.optString("name", "筐");
            int c = COLORS[idx % COLORS.length];
            idx++;
            // 整箱数 = 常温筐内的数据（用户录入常温筐发出时填；没填为 0 → 不显示整箱行）
            if (name.contains("常温")) wholeTotal = g.optInt("whole", 0);
            // 筐间分隔
            if (count > 0) sb.append(compact ? " · " : " · ");
            count++;
            // 筐名（染色 + 加粗 + 1.25倍）
            int start = sb.length();
            sb.append(name);
            sb.setSpan(new ForegroundColorSpan(c), start, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            sb.setSpan(new StyleSpan(Typeface.BOLD), start, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            sb.setSpan(new RelativeSizeSpan(compact ? 1.2f : 1.3f), start, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            // 数量 + 个（染色 + 加粗 + 大字）
            start = sb.length();
            sb.append(" ").append(String.valueOf(qty)).append(" 个");
            sb.setSpan(new ForegroundColorSpan(c), start, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            sb.setSpan(new StyleSpan(Typeface.BOLD), start, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            sb.setSpan(new RelativeSizeSpan(compact ? 1.4f : 2.0f), start, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        // 整箱合计「整箱 X 件」（琥珀金）
        if (wholeTotal > 0) {
            sb.append(compact ? " · " : "\n");
            int start = sb.length();
            sb.append("整箱 ").append(String.valueOf(wholeTotal)).append(" 件");
            sb.setSpan(new ForegroundColorSpan(WHOLE), start, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            sb.setSpan(new StyleSpan(Typeface.BOLD), start, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            sb.setSpan(new RelativeSizeSpan(compact ? 1.2f : 1.5f), start, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        // 打卡红字
        sb.append(compact ? " · " : "\n");
        int start = sb.length();
        sb.append("不要忘记打卡!");
        sb.setSpan(new ForegroundColorSpan(CLOCK), start, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        sb.setSpan(new StyleSpan(Typeface.BOLD), start, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        sb.setSpan(new RelativeSizeSpan(compact ? 1.2f : 1.3f), start, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return sb;
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

    /** 按 8 套模板构建通知正文（方案B+：全部模板去距离行 + 鲜艳染色 + 大字，保证任意模板都清晰）
     *  minimal = 店名+打卡红字；list = 路线列表染色；其余 = 5 筐染色分行 */
    private CharSequence buildTemplateBody(String template, String storeName, int dist, JSONArray goods, String dataStr) {
        final int CLOCK = 0xFFFF3B30;
        boolean isMinimal = "minimal".equals(template);
        boolean isList = "list".equals(template);
        if (isMinimal) {
            // 极简：店名 + 打卡红字（无距离）
            SpannableStringBuilder sb = new SpannableStringBuilder();
            int s0 = sb.length();
            sb.append(storeName);
            sb.setSpan(new StyleSpan(Typeface.BOLD), s0, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            int s1 = sb.length();
            sb.append("\n【不要忘记打卡！】");
            sb.setSpan(new ForegroundColorSpan(CLOCK), s1, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            sb.setSpan(new StyleSpan(Typeface.BOLD), s1, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            sb.setSpan(new RelativeSizeSpan(1.3f), s1, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            return sb;
        }
        if (isList) {
            // 路线列表：店名+距离（青）+数量（金），无距离行开头
            SpannableStringBuilder sb = new SpannableStringBuilder();
            JSONArray route = null;
            try { route = new JSONObject(dataStr).optJSONArray("route"); } catch (Exception ignored) {}
            if (route != null && route.length() > 0) {
                for (int i = 0; i < route.length(); i++) {
                    JSONObject r = route.optJSONObject(i);
                    if (r == null) continue;
                    if (sb.length() > 0) sb.append("\n");
                    int s0 = sb.length();
                    sb.append(r.optString("name", "店")).append("  ").append(r.optString("dist", ""));
                    sb.setSpan(new ForegroundColorSpan(0xFF00C9C0), s0, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                    sb.setSpan(new StyleSpan(Typeface.BOLD), s0, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                    int qty = r.optInt("qty", 0);
                    if (qty > 0) {
                        int s1 = sb.length();
                        sb.append("  ").append(String.valueOf(qty));
                        sb.setSpan(new ForegroundColorSpan(0xFFFFB300), s1, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                        sb.setSpan(new StyleSpan(Typeface.BOLD), s1, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                    }
                }
            } else {
                return buildRichSpannable(goods, false);
            }
            int s1 = sb.length();
            sb.append("\n【不要忘记打卡！】");
            sb.setSpan(new ForegroundColorSpan(CLOCK), s1, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            sb.setSpan(new StyleSpan(Typeface.BOLD), s1, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            return sb;
        }
        // detail / dist / rich / classic / alarm / silent：5 筐染色分行，无距离
        return buildRichSpannable(goods, false);
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
