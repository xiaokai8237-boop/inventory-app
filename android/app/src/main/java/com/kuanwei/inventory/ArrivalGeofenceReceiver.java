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
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.RelativeSizeSpan;
import android.text.style.StyleSpan;
import android.graphics.Typeface;

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

            // 组装通知内容（店名 + 该店各筐数量 + 打卡；方案B+：去距离 + 鲜艳染色 + 大字）
            JSONObject storeInfo = findStoreInfo(route, hitName);
            String title = "即将到达 " + hitName;
            JSONArray goods = storeInfo != null ? storeInfo.optJSONArray("goods") : null;
            CharSequence body = buildRichSpannable(goods != null ? goods : new JSONArray(), false);

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

            // 需求3 方案B+：折叠态塞满全量 + 展开态分行完整版（鲜艳染色 + 大字，无距离）
            Notification.Builder nb = new Notification.Builder(context, ArrivalMonitorPlugin.CHANNEL_ARRIVAL)
                    .setSmallIcon(R.drawable.ic_stat_notify)
                    .setContentTitle(title)
                    .setContentText(buildRichSpannable(goods != null ? goods : new JSONArray(), true))
                    .setStyle(new Notification.BigTextStyle().bigText(body))
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

            MainActivity.setPendingArrival(hitName, "open");

            nm.notify(7003, nb.build());
        } catch (Exception ignored) {}
    }

    /** 需求3 方案B+（用户定稿 v4）：Spannable 染色放大正文（v4 色板去黄去白；无距离行；筐名/数量同色；打卡红字）
     *  @param compact true=折叠态紧凑单行全量；false=展开态每筐一行
     */
    private CharSequence buildRichSpannable(JSONArray goods, boolean compact) {
        // v4 定稿鲜艳色（高饱和高亮；无黄无白；在浅色/深色通知栏背景下都清晰）
        final int[] COLORS = { 0xFFFF6D00, 0xFFFF4081, 0xFF18FFFF, 0xFF448AFF, 0xFF00E676 };
        final int CLOCK = 0xFFFF1744; // 打卡亮红
        final int WHOLE = 0xFFD500F9; // 整箱亮紫
        SpannableStringBuilder sb = new SpannableStringBuilder();
        int wholeTotal = 0;
        int count = 0; // 已显示筐数（用于分隔）
        int idx = 0;   // 颜色索引
        if (goods != null) {
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
