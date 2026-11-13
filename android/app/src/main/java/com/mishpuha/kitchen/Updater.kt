package com.mishpuha.kitchen

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Self-update. Every push to GitHub builds a new APK and uploads it with version.json
 * ({"versionCode": N, "apk": "<url>"}) to the Supabase "app" bucket. The tablet checks every
 * 30 min; as device owner it installs silently, then UpdatedReceiver reopens the app.
 */
object Updater {
    private const val TAG = "KitchenUpdate"
    @Volatile private var busy = false

    fun check(ctx: Context) {
        val url = BuildConfig.UPDATE_URL
        if (url.isEmpty() || busy) return
        busy = true
        thread(name = "update-check") {
            try {
                val info = JSONObject(get("$url?t=${System.currentTimeMillis()}").readBytes().decodeToString())
                val code = info.getInt("versionCode")
                if (code <= BuildConfig.VERSION_CODE) return@thread
                Log.i(TAG, "updating ${BuildConfig.VERSION_CODE} → $code")
                val apk = File(ctx.cacheDir, "update.apk")
                get(info.getString("apk")).use { input -> apk.outputStream().use { input.copyTo(it) } }
                install(ctx, apk)
            } catch (e: Exception) {
                Log.w(TAG, "update check failed: $e")
            } finally {
                busy = false
            }
        }
    }

    private fun get(url: String) = (URL(url).openConnection() as HttpURLConnection).run {
        connectTimeout = 15_000; readTimeout = 60_000; useCaches = false
        if (responseCode != 200) throw IllegalStateException("HTTP $responseCode for $url")
        inputStream
    }

    private fun install(ctx: Context, apk: File) {
        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(ctx.packageName)
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite("kitchen.apk", 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            val pi = PendingIntent.getBroadcast(ctx, id, Intent(ctx, InstallReceiver::class.java), flags)
            session.commit(pi.intentSender)
        }
    }
}

/** Installer result. Without device owner Android asks first; show that prompt. */
class InstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            @Suppress("DEPRECATION")
            val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
            context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } else if (status != PackageInstaller.STATUS_SUCCESS) {
            Log.w("KitchenUpdate", "install failed: ${intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)}")
        }
    }
}

/** A new version was installed: come back to the kitchen screen. */
class UpdatedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
