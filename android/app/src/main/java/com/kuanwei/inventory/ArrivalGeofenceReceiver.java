package com.kuanwei.inventory;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.text.Html;

import androidx.core.content.ContextCompat;

import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingEvent;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;

/**
 * 地理围栏触发接收器（#145 真实接入）：
 * 系统监测到进入门店围栏 → 本接收器被唤醒（即使 APP 进程被杀）→ 发到店通知
 * 门店名从注册时的 requestId（kw_{i}_{nameHash}）反查 SharedPreferences 存的路线
 */
public class ArrivalGeofenceReceiver extends BroadcastReceiver {
    public static final String PREFS = "kuanwei_arrival_route";
    public static final String KEY_ROUTE = "route_json";
    public static final String KEY_DIST = "dist_m";
    public static final String KEY_ALARMED = "alarmed_ids";

    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            GeofencingEvent event = GeofencingEvent.fromIntent(intent);
            if (event == null) return;
            if (event.hasError()) return;
            int transition = event.getGeofenceTransition();
            if (transition != Geofence.GEOFENCE_TRANSITION_ENTER) return;

            List<Geofence> fences = event.getTriggeringGeofences();
            if (fences == null || fences.isEmpty()) return;

            // 通知权限检查（Android 13+）
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                    ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                return;
            }

            SharedPreferences sp = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String routeStr = sp.getString(KEY_ROUTE, "[]");
            int distM = sp.getInt(KEY_DIST, 500);
            JSONArray route = new JSONArray(routeStr);

            // 触发围栏名（从 requestId 解出）
            String hitName = null;
            for (Geofence f : fences) {
                String rid = f.getRequestId();
                if (rid.startsWith("kw_")) {
                    int hash = Integer.parseInt(rid.substring(rid.lastIndexOf('_') + 1));
                    hitName = findNameByHash(route, hash);
                    if (hitName != null) break;
                }
            }
            if (hitName == null) hitName = "附近门店";

            // 防重复：同一家店 1 小时内只提醒一次
            long now = System.currentTimeMillis();
            String alarmed = sp.getString(KEY_ALARMED, "{}");
            JSONObject alarmedMap = new JSONObject(alarmed);
            if (now - alarmedMap.optLong(hitName, 0) < 3600 * 1000) return;
            alarmedMap.put(hitName, now);
            sp.edit().putString(KEY_ALARMED, alarmedMap.toString()).apply();

            // 组装通知内容（店名 + 该店各筐数量 + 打卡）
            JSONObject storeInfo = findStoreInfo(route, hitName);
            String title = "即将到达 " + hitName;
            StringBuilder body = new StringBuilder();
            body.append("距你 ").append(distM).append(" 米以内\n");
            JSONArray goods = storeInfo != null ? storeInfo.optJSONArray("goods") : null;
            if (goods != null && goods.length() > 0) {
                for (int i = 0; i < goods.length(); i++) {
                    JSONObject g = goods.getJSONObject(i);
                    int qty = g.optInt("qty", 0);
                    if (qty <= 0) continue;
                    body.append(g.optString("name", "")).append(" ").append(qty);
                    int whole = g.optInt("whole", 0);
                    if (whole > 0) body.append(" / 整箱 ").append(whole);
                    body.append("\n");
                }
            }
            body.append("\n不要忘记打卡！");

            // 通知渠道
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (nm.getNotificationChannel(ArrivalMonitorPlugin.CHANNEL_ARRIVAL) == null) {
                NotificationChannel ch = new NotificationChannel(ArrivalMonitorPlugin.CHANNEL_ARRIVAL, "到店提醒", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("到达门店时提醒你（店名/筐数/打卡）");
                ch.enableVibration(true);
                nm.createNotificationChannel(ch);
            }

            Intent open = new Intent(context, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            open.putExtra("arrival_store", hitName);
            open.putExtra("arrival_action", "open");
            PendingIntent pi = PendingIntent.getActivity(context, 0, open,
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE : PendingIntent.FLAG_UPDATE_CURRENT);

            // 需求3：rich 图文版自定义大卡（RemoteViews，与 ArrivalMonitorPlugin 同款布局）
            Notification.Builder nb = new Notification.Builder(context, ArrivalMonitorPlugin.CHANNEL_ARRIVAL)
                    .setSmallIcon(R.drawable.ic_stat_notify)
                    .setContentTitle(title)
                    .setContentText(body.toString().replace('\n', ' '))
                    .setAutoCancel(true)
                    .setContentIntent(pi)
                    .setDefaults(Notification.DEFAULT_SOUND | Notification.DEFAULT_VIBRATE);

            // #146 按钮：记录回筐（→ 回收页单店视图）/ 导航去下一家
            Intent recycleIntent = new Intent(context, MainActivity.class);
            recycleIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            recycleIntent.putExtra("arrival_store", hitName);
            recycleIntent.putExtra("arrival_action", "recycle");
            PendingIntent recyclePi = PendingIntent.getActivity(context, 1, recycleIntent,
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE : PendingIntent.FLAG_UPDATE_CURRENT);
            nb.addAction(R.drawable.ic_stat_notify, "记录回筐", recyclePi);

            Intent navIntent = new Intent(context, MainActivity.class);
            navIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            navIntent.putExtra("arrival_store", hitName);
            navIntent.putExtra("arrival_action", "navigate");
            PendingIntent navPi = PendingIntent.getActivity(context, 2, navIntent,
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE : PendingIntent.FLAG_UPDATE_CURRENT);
            nb.addAction(R.drawable.ic_stat_notify, "导航去下一家", navPi);

            // 需求3 方案B（用户拍板）：不用 RemoteViews（小米折叠态不认），用 HTML 染色 + BigTextStyle，所有 ROM 保证显示
            // 去掉距离行；标题"即将到达 店名"系统显示；5 筐每筐一行染色；打卡红字；双按钮系统级
            try {
                CharSequence richText = Html.fromHtml(buildRichHtmlBody(goods), Html.FROM_HTML_MODE_LEGACY);
                nb.setContentText(richText);
                nb.setStyle(new Notification.BigTextStyle().bigText(richText));
            } catch (Exception ignored) {}

            MainActivity.setPendingArrival(hitName, "open");

            nm.notify(7003, nb.build());
        } catch (Exception ignored) {}
    }

    /** 需求3 方案B：HTML 染色正文（所有 ROM 保证显示；无距离行；5 筐每筐一行染色 + 打卡红字） */
    private String buildRichHtmlBody(JSONArray goods) {
        final String[] COLORS = { "#F5A623", "#F5DC92", "#7CE8E0", "#8FA9FF", "#4ADE80" };
        StringBuilder sb = new StringBuilder();
        int idx = 0;
        if (goods != null) {
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
        }
        sb.append("<font color='#FF4D4F'><b>【不要忘记打卡！】</b></font>");
        return sb.toString();
    }

    private String findNameByHash(JSONArray route, int hash) {
        try {
            for (int i = 0; i < route.length(); i++) {
                JSONObject o = route.getJSONObject(i);
                String name = o.optString("name", "");
                if (!name.isEmpty() && Math.abs(name.hashCode()) == hash) return name;
            }
        } catch (Exception ignored) {}
        return null;
    }

    private JSONObject findStoreInfo(JSONArray route, String name) {
        try {
            for (int i = 0; i < route.length(); i++) {
                JSONObject o = route.getJSONObject(i);
                if (name.equals(o.optString("name"))) return o;
            }
        } catch (Exception ignored) {}
        return null;
    }
}
