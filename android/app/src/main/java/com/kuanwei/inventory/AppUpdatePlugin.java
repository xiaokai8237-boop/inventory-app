package com.kuanwei.inventory;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * APK 自动更新插件：
 * 1. downloadAndInstall(url) —— 后台下载 APK 到应用专属目录，完成后拉起系统安装器
 * 2. 需配合 AndroidManifest 的 REQUEST_INSTALL_PACKAGES 权限 + FileProvider
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    private static final String APK_FILE = "kuanwei-update.apk";
    private long lastDownloadId = -1;
    private PluginCall pendingCall;
    private BroadcastReceiver downloadReceiver;

    /** 返回当前 APK 的 versionCode / versionName（用于前端对比 app-version.json 判断是否有新版） */
    @PluginMethod
    public void getVersion(PluginCall call) {
        try {
            android.content.pm.PackageInfo pi = getContext().getPackageManager()
                    .getPackageInfo(getContext().getPackageName(), 0);
            JSObject ret = new JSObject();
            ret.put("versionCode", pi.versionCode);
            ret.put("versionName", pi.versionName == null ? "" : pi.versionName);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("version_error");
        }
    }

    /**
     * 查询当前下载任务的进度（供前端轮询刷新进度条）。
     * 返回 { progress: 0-100, status: 1待下载/2下载中/4暂停/8完成/16失败, done, total }
     * 没有进行中的下载任务时 progress = -1
     */
    @PluginMethod
    public void getDownloadProgress(PluginCall call) {
        try {
            if (lastDownloadId < 0) {
                call.resolve(new JSObject().put("progress", -1));
                return;
            }
            DownloadManager dm = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm == null) {
                call.reject("download_manager_unavailable");
                return;
            }
            DownloadManager.Query q = new DownloadManager.Query();
            q.setFilterById(lastDownloadId);
            Cursor c = dm.query(q);
            try {
                if (c != null && c.moveToFirst()) {
                    long total = c.getLong(c.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                    long done = c.getLong(c.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                    int status = c.getInt(c.getColumnIndex(DownloadManager.COLUMN_STATUS));
                    JSObject ret = new JSObject();
                    ret.put("total", total);
                    ret.put("done", done);
                    ret.put("status", status);
                    ret.put("progress", total > 0 ? (int) Math.round(done * 100.0 / total) : 0);
                    call.resolve(ret);
                } else {
                    call.resolve(new JSObject().put("progress", -1));
                }
            } catch (Exception e) {
                call.reject("query_error");
            } finally {
                if (c != null) c.close();
            }
        } catch (Exception e) {
            call.reject("progress_error");
        }
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url required");
            return;
        }
        // Android 8+ 需要"安装未知来源应用"授权；未授权则引导用户去系统设置开启
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!getActivity().getPackageManager().canRequestPackageInstalls()) {
                try {
                    Intent intent = new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                    intent.setData(Uri.parse("package:" + getActivity().getPackageName()));
                    getActivity().startActivity(intent);
                } catch (Exception ignored) {}
                call.reject("need_install_permission");
                return;
            }
        }

        pendingCall = call;
        DownloadManager dm = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        if (dm == null) {
            call.reject("download_manager_unavailable");
            return;
        }

        File dest = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), APK_FILE);
        if (dest.exists()) dest.delete();

        DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
        req.setDestinationUri(Uri.fromFile(dest));
        req.setTitle("物流筐更新包");
        req.setDescription("正在下载新版本…");
        req.setMimeType("application/vnd.android.package-archive");
        req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        lastDownloadId = dm.enqueue(req);

        if (downloadReceiver == null) {
            downloadReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
                    if (id == lastDownloadId) {
                        installDownloadedApk();
                    }
                }
            };
            getContext().registerReceiver(downloadReceiver, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));
        }

        JSObject ret = new JSObject();
        ret.put("downloading", true);
        call.resolve(ret);
    }

    /** 检查下载结果并拉起系统安装器 */
    private void installDownloadedApk() {
        try {
            File file = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), APK_FILE);
            if (!file.exists() || file.length() == 0) {
                if (pendingCall != null) { pendingCall.reject("download_failed"); pendingCall = null; }
                return;
            }
            Uri apkUri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    file);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            if (pendingCall != null) { pendingCall.resolve(); pendingCall = null; }
        } catch (Exception e) {
            if (pendingCall != null) { pendingCall.reject("install_error"); pendingCall = null; }
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (downloadReceiver != null) {
            try { getContext().unregisterReceiver(downloadReceiver); } catch (Exception ignored) {}
            downloadReceiver = null;
        }
        super.handleOnDestroy();
    }
}
