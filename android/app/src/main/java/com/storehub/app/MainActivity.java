package com.storehub.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

/** The deployed website owns every route, permission, feature and Supabase connection. */
public class MainActivity extends ComponentActivity {
    private static final int PICK_FILE = 10, SAVE_FILE = 11;
    private WebView web;
    private LinearLayout errorPanel;
    private ProgressBar progress;
    private ValueCallback<Uri[]> upload;
    private Uri cameraUri;
    private File cameraFile, exportFile;
    private OutputStream exportStream;
    private long exportSize, exportExpected;
    private boolean saving;
    private String downloadScript;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(0, 0, 0, 0);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            androidx.core.graphics.Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        root.addView(progress, new LinearLayout.LayoutParams(-1, 4));
        errorPanel = new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL);
        errorPanel.setPadding(32, 48, 32, 32);
        TextView message = new TextView(this);
        message.setText("暂时无法连接 StoreHub，请检查网络后重试。已保存到服务器的数据仍然保留。");
        errorPanel.addView(message);
        Button retry = new Button(this);
        retry.setText("重新加载");
        retry.setOnClickListener(v -> { errorPanel.setVisibility(View.GONE); web.setVisibility(View.VISIBLE); web.loadUrl(BuildConfig.WEB_ORIGIN + "/app"); });
        errorPanel.addView(retry);
        errorPanel.setVisibility(View.GONE);
        root.addView(errorPanel);
        web = new WebView(this);
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        androidx.core.view.WindowInsetsControllerCompat systemBars = androidx.core.view.WindowCompat.getInsetsController(getWindow(), root);
        systemBars.setAppearanceLightStatusBars(true);
        systemBars.setAppearanceLightNavigationBars(true);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { navigateBack(); }
        });
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        try {
            try (java.io.InputStream input = getAssets().open("downloads.js"); java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192]; int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                downloadScript = new String(output.toByteArray(), StandardCharsets.UTF_8);
            }
        } catch (Exception e) { toast("文件导出模块加载失败"); }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "StoreHubDownloads", Collections.singleton(BuildConfig.WEB_ORIGIN),
                (view, messageData, source, mainFrame, reply) -> {
                    if (mainFrame && trusted(source)) receiveExport(messageData.getData());
                });
        } else {
            new AlertDialog.Builder(this).setMessage("请更新 Android System WebView，以支持 APP 文件导出。").setPositiveButton("知道了", null).show();
        }
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                if (trusted(request.getUrl())) return false;
                openExternal(request.getUrl());
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                if (!saving) cleanupExport();
                progress.setVisibility(View.VISIBLE);
            }
            @Override public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
                if (trusted(Uri.parse(url)) && downloadScript != null) view.evaluateJavascript(downloadScript, null);
                CookieManager.getInstance().flush();
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showConnectionError();
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 400) showConnectionError();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) { progress.setProgress(value); }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (upload != null) upload.onReceiveValue(null);
                upload = callback;
                cameraUri = null; cameraFile = null;
                Intent picker = params.createIntent();
                Intent chooser = Intent.createChooser(picker, "选择上传文件");
                boolean image = java.util.Arrays.stream(params.getAcceptTypes()).anyMatch(type -> type.startsWith("image/"));
                if (image) {
                    try {
                        File cameraDirectory = new File(getCacheDir(), "camera");
                        cameraDirectory.mkdirs();
                        cameraFile = File.createTempFile("capture-", ".jpg", cameraDirectory);
                        cameraUri = FileProvider.getUriForFile(MainActivity.this, BuildConfig.APPLICATION_ID + ".files", cameraFile);
                        Intent capture = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                        capture.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
                        capture.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                        capture.setClipData(android.content.ClipData.newRawUri("照片", cameraUri));
                        if (capture.resolveActivity(getPackageManager()) != null) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{capture});
                    } catch (Exception e) { toast("拍照暂不可用，可从相册选择"); }
                }
                try { startActivityForResult(chooser, PICK_FILE); }
                catch (ActivityNotFoundException e) { upload.onReceiveValue(null); upload = null; toast("未找到文件选择器"); }
                return true;
            }
        });
        web.setDownloadListener((url, agent, disposition, mime, length) -> {
            if (!"https".equals(Uri.parse(url).getScheme())) { toast("请通过导出按钮保存文件"); return; }
            try {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.addRequestHeader("User-Agent", agent);
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null) request.addRequestHeader("Cookie", cookies);
                String filename = android.webkit.URLUtil.guessFileName(url, disposition, mime);
                request.setMimeType(mime);
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);
                ((DownloadManager)getSystemService(DOWNLOAD_SERVICE)).enqueue(request);
                toast("下载已开始");
            } catch (Exception e) { toast("下载失败，请重试"); }
        });
        if (state == null || web.restoreState(state) == null) web.loadUrl(BuildConfig.WEB_ORIGIN + "/app");
    }

    private boolean trusted(Uri uri) {
        Uri origin = Uri.parse(BuildConfig.WEB_ORIGIN);
        return "https".equals(uri.getScheme()) && origin.getHost() != null && origin.getHost().equals(uri.getHost()) && (uri.getPort() == -1 || uri.getPort() == 443);
    }
    private void openExternal(Uri uri) {
        String scheme = uri.getScheme();
        if (!"https".equals(scheme) && !"http".equals(scheme) && !"mailto".equals(scheme) && !"tel".equals(scheme)) { toast("无法打开此链接"); return; }
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (ActivityNotFoundException e) { toast("未找到可打开此链接的应用"); }
    }
    private void showConnectionError() {
        progress.setVisibility(View.GONE);
        errorPanel.setVisibility(View.VISIBLE);
        web.setVisibility(View.GONE);
    }
    private void receiveExport(String data) {
        try {
            JSONObject message = new JSONObject(data);
            switch (message.getString("action")) {
                case "start":
                    if (saving || exportStream != null) { toast("请先完成当前文件保存"); return; }
                    exportExpected = message.getLong("size");
                    if (exportExpected < 0 || exportExpected > 50L * 1024 * 1024) throw new IllegalArgumentException();
                    exportSize = 0;
                    exportFile = File.createTempFile("storehub-export-", ".tmp", getCacheDir());
                    exportStream = new FileOutputStream(exportFile);
                    exportName = message.optString("name", "StoreHub导出文件").replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
                    exportMime = message.optString("mime", "application/octet-stream");
                    break;
                case "chunk":
                    if (saving || exportStream == null) return;
                    String chunk = message.getString("data");
                    if (chunk.length() > 65536) throw new IllegalArgumentException();
                    byte[] bytes = Base64.decode(chunk, Base64.DEFAULT);
                    exportSize += bytes.length;
                    if (exportSize > exportExpected) throw new IllegalArgumentException();
                    exportStream.write(bytes);
                    break;
                case "finish":
                    if (saving || exportStream == null) return;
                    exportStream.close(); exportStream = null;
                    if (exportSize != exportExpected) throw new IllegalArgumentException();
                    saving = true;
                    Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT).setType(exportMime).addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE, exportName);
                    startActivityForResult(save, SAVE_FILE);
                    break;
                case "error":
                    if (!saving) cleanupExport();
                    toast(message.optString("message", "文件导出失败"));
                    break;
            }
        } catch (Exception e) { cleanupExport(); toast("文件导出失败，请重试"); }
    }
    private String exportName, exportMime;
    private void cleanupExport() {
        try { if (exportStream != null) exportStream.close(); } catch (Exception ignored) { }
        exportStream = null;
        if (exportFile != null) exportFile.delete();
        exportFile = null; saving = false;
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK_FILE && upload != null) {
            Uri[] selected = result == RESULT_OK ? WebChromeClient.FileChooserParams.parseResult(result, data) : null;
            if (result == RESULT_OK && selected == null && cameraFile != null && cameraFile.length() > 0) selected = new Uri[]{cameraUri};
            upload.onReceiveValue(selected); upload = null; cameraUri = null;
        }
        if (request == SAVE_FILE) {
            if (result == RESULT_OK && data != null && data.getData() != null && exportFile != null) {
                File file = exportFile;
                Uri destination = data.getData();
                // Keep disk copying off the UI thread and block overlapping exports until it completes.
                new Thread(() -> {
                    boolean success = false;
                    try (FileInputStream input = new FileInputStream(file); OutputStream output = getContentResolver().openOutputStream(destination)) {
                        if (output != null) {
                            byte[] buffer = new byte[8192]; int count;
                            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                            success = true;
                        }
                    } catch (Exception ignored) { }
                    final boolean saved = success;
                    runOnUiThread(() -> { cleanupExport(); toast(saved ? "文件已保存" : "保存失败，请重试"); });
                }).start();
            } else cleanupExport();
        }
    }
    private void toast(String message) { Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }
    private void navigateBack() {
        if (web.canGoBack()) web.goBack();
        else new AlertDialog.Builder(this).setMessage("退出 StoreHub？").setNegativeButton("取消", null).setPositiveButton("退出", (dialog, which) -> finish()).show();
    }
    @Override protected void onSaveInstanceState(Bundle state) { super.onSaveInstanceState(state); web.saveState(state); }
    @Override protected void onPause() { super.onPause(); web.onPause(); CookieManager.getInstance().flush(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
    @Override protected void onDestroy() {
        if (upload != null) upload.onReceiveValue(null);
        if (!saving) cleanupExport();
        web.destroy(); super.onDestroy();
    }
}
