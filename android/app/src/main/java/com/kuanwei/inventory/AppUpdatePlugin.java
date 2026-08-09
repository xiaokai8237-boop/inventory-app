package com.kuanwei.inventory;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import androidx.core.content.FileProvider;

import java.io.File;

/**
 * APK 自动更新插件：
 * 1. downloadAndInstall(url) —— 后台下载 APK 到应用专属目录（下载完成由静态广播
 *    DownloadCompleteReceiver 自动拉起系统安装器，进程被杀也能收到）
 * 2. getDownloadProgress() —— 供前端轮询下载进度
 * 3. 需配合 AndroidManifest 的 REQUEST_INSTALL_PACKAGES 权限 + FileProvider
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    private static final String APK_FILE = "kuanwei-update.apk";
    // static：进程存活期间前端轮询需要；进程被杀后由静态广播接收器接管安装
    private static long lastDownloadId = -1;

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
        // URL 必须 http/https：DownloadManager.Request 构造函数对无 scheme / 非 http(s) 的 URI
        // 直接抛 IllegalArgumentException（相对路径如 "apk/app-vX.apk" 会导致下载异常甚至崩溃）
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme();
        if (scheme == null || (!"http".equals(scheme) && !"https".equals(scheme))) {
            call.reject("invalid_url:" + url);
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

        DownloadManager dm = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        if (dm == null) {
            call.reject("download_manager_unavailable");
            return;
        }

        File dest = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), APK_FILE);
        if (dest.exists()) dest.delete();

        DownloadManager.Request req = new DownloadManager.Request(uri);
        req.setDestinationUri(Uri.fromFile(dest));
        req.setTitle("物流筐更新包");
        req.setDescription("正在下载新版本…");
        req.setMimeType("application/vnd.android.package-archive");
        req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        lastDownloadId = dm.enqueue(req);

        // 下载完成 → 三条保险拉起安装器：
        // ① 进程存活时：前端轮询到 100% 主动调 installDownloaded()（不依赖广播）
        // ② 进程被杀：静态广播 DownloadCompleteReceiver 拉起（标准 Android 有效）
        // ③ 都失败：下次启动 APP 时前端 hasDownloadedApk() 检查 → 弹安装提示 → installDownloaded()

        JSObject ret = new JSObject();
        ret.put("downloading", true);
        call.resolve(ret);
    }

    /** 主动拉起系统安装器（进程存活时由前端在下载完成后调用，不依赖广播） */
    @PluginMethod
    public void installDownloaded(PluginCall call) {
        try {
            File file = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), APK_FILE);
            if (!file.exists() || file.length() == 0) {
                call.reject("no_apk");
                return;
            }
            Uri apkUri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(apkUri, "application/vnd.android.package-archive");
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(install);
            call.resolve();
        } catch (Exception e) {
            call.reject("install_error:" + e.getMessage());
        }
    }

    /** 检查是否已有下载完成的 APK（供启动兜底：上次下载完成但没装上，下次打开自动提示安装） */
    @PluginMethod
    public void hasDownloadedApk(PluginCall call) {
        try {
            File file = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), APK_FILE);
            JSObject ret = new JSObject();
            ret.put("exists", file.exists() && file.length() > 0);
            ret.put("size", file.exists() ? file.length() : 0);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("check_error");
        }
    }
}
