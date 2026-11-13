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
import android.util.Log

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

    private fun step(name: String, f: () -> Unit) {
        runCatching(f).onFailure { Log.w("KitchenKiosk", "$name failed: $it") }
    }

    fun configure(ctx: Context) {
        if (!isOwner(ctx)) { Log.i("KitchenKiosk", "not device owner; kiosk off"); return }
        val d = dpm(ctx); val a = admin(ctx)
        step("lockTaskPackages") { d.setLockTaskPackages(a, arrayOf(ctx.packageName)) }
        if (Build.VERSION.SDK_INT >= 28) {
            step("lockTaskFeatures") { d.setLockTaskFeatures(a, DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS) }
        }
        step("keyguard") { d.setKeyguardDisabled(a, true) }
        step("statusBar") { d.setStatusBarDisabled(a, true) }
        // Screen stays on whenever the charger is connected (AC, USB, wireless).
        step("stayOn") { d.setGlobalSetting(a, Settings.Global.STAY_ON_WHILE_PLUGGED_IN, "7") }
        // Camera for people's selfies, granted silently (no prompt on a locked kiosk).
        step("camera") {
            d.setPermissionGrantState(a, ctx.packageName, android.Manifest.permission.CAMERA,
                DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED)
        }
    }

    fun lock(activity: Activity) {
        val am = activity.getSystemService(ActivityManager::class.java)
        val permitted = dpm(activity).isLockTaskPermitted(activity.packageName)
        if (permitted && am.lockTaskModeState == ActivityManager.LOCK_TASK_MODE_NONE) {
            step("startLockTask") { activity.startLockTask() }
        }
        Log.i("KitchenKiosk", "permitted=$permitted state=${am.lockTaskModeState}")
    }
}

class AdminReceiver : DeviceAdminReceiver() {
    override fun onEnabled(context: Context, intent: Intent) {
        Kiosk.configure(context)
    }
}
