package com.kuanwei.inventory;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 地理围栏触发接收器（#145 接入 Geofencing 后启用）：
 * 当前版本由前端前台 60s 轮询 + notifyArrival 原生通知覆盖到店提醒，
 * 本接收器保留占位，避免依赖 play-services-location（当前网络对 dl.google.com 不通）。
 */
public class ArrivalGeofenceReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        // #145：恢复 GeofencingEvent 解析 + 发到店通知
    }
}
