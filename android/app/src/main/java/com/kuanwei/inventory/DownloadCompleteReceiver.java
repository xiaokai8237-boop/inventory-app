package com.kuanwei.inventory;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;

/**
 * 下载完成静态广播接收器（解决"下载完成不弹安装器"）：
 *
 * 之前下载完成广播是【动态注册】（AppUpdatePlugin 里 registerReceiver），
 * 动态注册的接收器只在 APP 进程存活时有效——用户点更新后 APP 被切走/进程被杀，
 * 下载完成时收不到广播 → 安装器不弹出。
 *
 * 静态注册（AndroidManifest.xml）由系统在广播到达时自动实例化，进程死了也能收到：
 * 下载完成 → 校验下载状态成功 → 自动拉起系统安装器替换安装。
 * （ACTION_DOWNLOAD_COMPLETE 是 Android 官方豁免的隐式广播，允许静态注册）
 */
public class DownloadCompleteReceiver extends BroadcastReceiver {

    private static final String APK_FILE = "kuanwei-update.apk";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        if (!DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) return;

        long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);

        // 校验下载状态：必须是 SUCCESSFUL 才安装，避免文件不完整就拉起安装器
        DownloadManager dm = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        if (dm != null && id > 0) {
            DownloadManager.Query q = new DownloadManager.Query();
            q.setFilterById(id);
            Cursor c = null;
            try {
                c = dm.query(q);
                if (c != null && c.moveToFirst()) {
                    int status = c.getInt(c.getColumnIndex(DownloadManager.COLUMN_STATUS));
                    if (status != DownloadManager.STATUS_SUCCESSFUL) return; // 失败/暂停/待下载 → 不安装
                }
            } catch (Exception ignored) {
            } finally {
                if (c != null) c.close();
            }
        }

        File file = new File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), APK_FILE);
        if (!file.exists() || file.length() == 0) return;

        try {
            Uri apkUri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(apkUri, "application/vnd.android.package-archive");
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(install);
        } catch (Exception e) {
            Toast.makeText(context, "更新包下载完成，安装失败，请手动安装", Toast.LENGTH_LONG).show();
        }
    }
}
