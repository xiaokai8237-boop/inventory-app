package com.kuanwei.inventory;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 收款通知监听服务（管理 APK 核心）
 *
 * 原理：安卓官方 NotificationListenerService（免 ROOT，锁屏可用）。
 * 监听微信「微信支付收款 XX 元」/ 支付宝「到账 XX 元」等收款通知，
 * 解析金额 → 通过静态桥（同进程）转发给 PayListenerPlugin → JS 事件 → 上报云端匹配订单。
 *
 * 注意：仅解析"收款/到账"类通知的金额数字，不读取任何聊天内容。
 */
public class PayNotificationListener extends NotificationListenerService {
    private static final String TAG = "KuanweiAdmin";
    private static final Pattern AMOUNT = Pattern.compile("(\\d{1,4}\\.\\d{1,2})");

    /** 桥接接口：原生监听 → Capacitor 插件 */
    public interface PayBridge {
        void onPay(String amount);
    }

    private static volatile PayBridge bridge;
    private static volatile String lastRaw = "";

    public static void setBridge(PayBridge b) { bridge = b; }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            Notification n = sbn.getNotification();
            if (n == null) return;
            Bundle ex = n.extras;
            if (ex == null) return;
            String title = String.valueOf(ex.getCharSequence(Notification.EXTRA_TITLE));
            String text = String.valueOf(ex.getCharSequence(Notification.EXTRA_TEXT));
            String pkg = sbn.getPackageName();
            String full = (title + " " + text).trim();

            // 只处理收款/到账类通知（微信支付、支付宝、云闪付等）
            boolean payHint = full.contains("收款") || full.contains("到账") || full.contains("收钱")
                    || full.contains("支付成功") || full.contains("付款成功");
            if (!payHint) return;

            Matcher m = AMOUNT.matcher(full);
            if (!m.find()) return;
            String amount = m.group(1);
            // 同内容去抖（微信可能双端/重复通知）
            String key = amount + "|" + sbn.getPostTime();
            if (key.equals(lastRaw)) return;
            lastRaw = key;
            Log.i(TAG, "收款通知 " + pkg + " 金额 " + amount + " 原文: " + full);
            PayBridge b = bridge;
            if (b != null) b.onPay(amount);
        } catch (Exception e) {
            Log.e(TAG, "解析通知失败", e);
        }
    }
}
