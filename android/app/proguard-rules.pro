# The page calls window.KitchenNative.feedback(...); keep JS-bridge methods by name.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
