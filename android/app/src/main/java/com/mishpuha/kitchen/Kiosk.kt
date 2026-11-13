package com.mishpuha.kitchen

import android.app.Activity
import android.app.ActivityManager
import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings

/**
 * Kiosk mode. Works fully only when the app is the tablet's device owner (set once over adb:
 *   adb shell dpm set-device-owner com.mishpuha.kitchen/.AdminReceiver
 * ). Then the app pins itself: no home, no recents, no status bar, no lock screen.
 * The power menu stays, so restarting the tablet is the way out; after a restart the app
 * does not reopen by itself — tap its icon to start it again.
 */
object Kiosk {
    private fun dpm(ctx: Context) = ctx.getSystemService(DevicePolicyManager::class.java)
    private fun admin(ctx: Context) = ComponentName(ctx, AdminReceiver::class.java)

    fun isOwner(ctx: Context) = dpm(ctx).isDeviceOwnerApp(ctx.packageName)

    fun configure(ctx: Context) {
        if (!isOwner(ctx)) return
        val d = dpm(ctx); val a = admin(ctx)
        runCatching { d.setLockTaskPackages(a, arrayOf(ctx.packageName)) }
        if (Build.VERSION.SDK_INT >= 28) {
            runCatching { d.setLockTaskFeatures(a, DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS) }
        }
        runCatching { d.setKeyguardDisabled(a, true) }
        runCatching { d.setStatusBarDisabled(a, true) }
        // Screen stays on whenever the charger is connected (AC, USB, wireless).
        runCatching { d.setGlobalSetting(a, Settings.Global.STAY_ON_WHILE_PLUGGED_IN, "7") }
    }

    fun lock(activity: Activity) {
        val am = activity.getSystemService(ActivityManager::class.java)
        if (dpm(activity).isLockTaskPermitted(activity.packageName) &&
            am.lockTaskModeState == ActivityManager.LOCK_TASK_MODE_NONE) {
            runCatching { activity.startLockTask() }
        }
    }
}

class AdminReceiver : DeviceAdminReceiver() {
    override fun onEnabled(context: Context, intent: Intent) {
        Kiosk.configure(context)
    }
}
