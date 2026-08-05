package com.kuanwei.inventory;

import android.content.Context;
import android.media.MediaRecorder;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;

/**
 * 原生录音插件：绕开 WebView getUserMedia（小米等国产 ROM 上 getUserMedia 频繁
 * 返回 NotReadableError 导致无法录音），改用 Android 原生 MediaRecorder 直接录音。
 *
 * 流程：start() 开始录音（m4a/AAC，16kHz 采样对齐腾讯云 ASR）→ stop() 停止并返回
 * { base64, mime, size }，前端把 base64 直接交给现有 /tcloud-asr 识别。
 * 权限：RECORD_AUDIO 已在 MainActivity.requestRuntimePermissions() 预申请。
 */
@CapacitorPlugin(name = "AudioRecorder")
public class AudioRecorderPlugin extends Plugin {

    private static final String FILE_NAME = "kuanwei_voice.m4a";
    private MediaRecorder recorder;
    private File outFile;
    private boolean recording = false;

    /** 开始录音 */
    @PluginMethod
    public void start(PluginCall call) {
        try {
            Context ctx = getContext();
            if (ctx == null) { call.reject("context_unavailable"); return; }

            // 清理上次残留
            releaseRecorder();
            outFile = new File(ctx.getCacheDir(), FILE_NAME);
            if (outFile.exists()) outFile.delete();

            // API 31+ 推荐带 Context 构造；旧版本用无参
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                recorder = new MediaRecorder(ctx);
            } else {
                recorder = new MediaRecorder();
            }
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            recorder.setAudioSamplingRate(16000);   // 对齐腾讯云 16k_zh
            recorder.setAudioEncodingBitRate(64000);
            recorder.setOutputFile(outFile.getAbsolutePath());
            recorder.prepare();
            recorder.start();
            recording = true;
            call.resolve(new JSObject().put("ok", true));
        } catch (Exception e) {
            releaseRecorder();
            call.reject("start_error:" + (e.getMessage() == null ? e.toString() : e.getMessage()));
        }
    }

    /** 停止录音，返回 { base64, mime, size } */
    @PluginMethod
    public void stop(PluginCall call) {
        try {
            if (!recording) { call.reject("not_recording"); return; }
            recording = false;
            try {
                if (recorder != null) recorder.stop();
            } catch (Exception e) {
                // 录音时间过短 stop() 可能抛 RuntimeException（如 <1s），仍尝试读取文件
            }
            releaseRecorder();

            if (outFile == null || !outFile.exists() || outFile.length() == 0) {
                call.reject("no_audio_data");
                return;
            }
            long len = outFile.length();
            if (len > 5 * 1024 * 1024) { // 上限 5MB，防异常超大
                call.reject("audio_too_large");
                return;
            }
            byte[] buf = new byte[(int) len];
            FileInputStream fis = new FileInputStream(outFile);
            try {
                int off = 0;
                while (off < buf.length) {
                    int r = fis.read(buf, off, buf.length - off);
                    if (r < 0) break;
                    off += r;
                }
            } finally {
                try { fis.close(); } catch (Exception ignored) {}
            }
            String b64 = Base64.encodeToString(buf, Base64.NO_WRAP);
            JSObject ret = new JSObject();
            ret.put("base64", b64);
            ret.put("mime", "audio/mp4");
            ret.put("size", (int) len);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("stop_error:" + (e.getMessage() == null ? e.toString() : e.getMessage()));
        }
    }

    /** 是否可用（前端探测用） */
    @PluginMethod
    public void isAvailable(PluginCall call) {
        call.resolve(new JSObject().put("ok", true));
    }

    private void releaseRecorder() {
        try { if (recorder != null) { recorder.release(); } } catch (Exception ignored) {}
        recorder = null;
    }
}
