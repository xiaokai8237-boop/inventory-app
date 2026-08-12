package com.kuanwei.inventory;

import android.content.ComponentName;
import android.content.Intent;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 收款监听 Capacitor 插件（管理 APK）
 *
 * 桥接：PayNotificationListener（原生监听）→ 本插件 → JS 事件 onPayReceived
 * JS 侧：window.addEventListener('payListener', ...) 或 document.addEventListener('onPayReceived'...)
 * Capacitor 事件名规则：notifyListeners(EVENT) → JS 端 document.addEventListener('onPayReceived')
 */
@CapacitorPlugin(name = "PayListener")
public class PayListenerPlugin extends Plugin {
    public static final String EVENT_PAY = "onPayReceived";

    @Override
    public void load() {
        super.load();
        // 注册原生→JS 桥（同进程静态字段通信）
        PayNotificationListener.setBridge(amount -> {
            try {
                JSObject ret = new JSObject();
                ret.put("amount", amount);
                notifyListeners(EVENT_PAY, ret);
            } catch (Exception ignored) {}
        });
    }

    /** 通知监听是否已开启（用户在系统设置里授权后为 true） */
    @PluginMethod
    public void checkEnabled(PluginCall call) {
        try {
            ComponentName cn = new ComponentName(getContext(), PayNotificationListener.class);
            String flat = Settings.Secure.getString(getContext().getContentResolver(),
                    "enabled_notification_listeners");
            boolean enabled = flat != null && flat.contains(cn.flattenToString());
            JSObject ret = new JSObject();
            ret.put("enabled", enabled);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("查询失败", e);
        }
    }

    /** 跳转系统"通知使用权"设置页（引导用户开启监听） */
    @PluginMethod
    public void openSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("无法打开设置", e);
        }
    }
}
