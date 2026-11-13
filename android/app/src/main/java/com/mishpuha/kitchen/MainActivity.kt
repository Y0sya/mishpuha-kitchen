package com.mishpuha.kitchen

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import java.io.File
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * The whole app: one full-screen WebView showing the UI bundled in the APK (assets/web).
 * Nothing is loaded from a website; the page only talks to Supabase for data.
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private val handler = Handler(Looper.getMainLooper())
    private val updateCheck = object : Runnable {
        override fun run() {
            Updater.check(applicationContext)
            handler.postDelayed(this, 30 * 60 * 1000L)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true          // offline outbox + cache
            settings.allowFileAccess = true
            settings.mediaPlaybackRequiresUserGesture = false
            isHapticFeedbackEnabled = false
            isLongClickable = false
            setOnLongClickListener { true }            // no text-selection popups
            // Let the page use the camera (Settings → People). Only our own bundled page runs here.
            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest) {
                    val ok = request.resources.filter { it == PermissionRequest.RESOURCE_VIDEO_CAPTURE }
                    if (ok.isNotEmpty() && request.origin.toString().startsWith("file:")) request.grant(ok.toTypedArray())
                    else request.deny()
                }
            }
            webViewClient = object : WebViewClient() {
                // Never navigate away from the bundled page.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) =
                    !request.url.toString().startsWith("file:///android_asset/")
            }
        }
        // Feedback also goes to a plain file, readable over USB:
        //   adb shell cat /sdcard/Android/data/com.mishpuha.kitchen/files/feedback.jsonl
        web.addJavascriptInterface(object {
            @JavascriptInterface
            fun feedback(json: String) {
                runCatching { File(getExternalFilesDir(null), "feedback.jsonl").appendText(json + "\n") }
            }
        }, "KitchenNative")
        setContentView(web)
        web.loadUrl("file:///android_asset/web/index.html")

        Kiosk.configure(this)
        handler.postDelayed(updateCheck, 60 * 1000L)
    }

    override fun onResume() {
        super.onResume()
        hideBars()
        Kiosk.configure(this)   // cheap and idempotent; a device-owner app is rarely restarted
        Kiosk.lock(this)
        // Not device owner (e.g. a test install): ask for the camera the normal way.
        if (checkSelfPermission(android.Manifest.permission.CAMERA) != android.content.pm.PackageManager.PERMISSION_GRANTED &&
            !Kiosk.isOwner(this)) {
            requestPermissions(arrayOf(android.Manifest.permission.CAMERA), 1)
        }
        web.onResume()
    }

    override fun onPause() {
        web.onPause()
        super.onPause()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideBars()
    }

    @Deprecated("Back does nothing on the kitchen screen")
    @Suppress("MissingSuperCall")
    override fun onBackPressed() { /* stay put */ }

    @Suppress("DEPRECATION")
    private fun hideBars() {
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            or View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)
    }
}
