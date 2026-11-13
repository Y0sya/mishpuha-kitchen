import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Settings come from environment variables (GitHub Actions secrets) or, on a dev PC,
// from android/secret.properties (not in git). Keys:
//   SUPABASE_URL, SUPABASE_ANON_KEY               → baked into the app (web/env.js)
//   KEYSTORE_FILE, KEYSTORE_PASSWORD, KEY_ALIAS   → release signing (must never change,
//                                                    or the tablet refuses updates)
val local = Properties().apply {
    val f = rootProject.file("secret.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun setting(key: String): String? = System.getenv(key)?.takeIf { it.isNotBlank() } ?: local.getProperty(key)

val supabaseUrl = setting("SUPABASE_URL") ?: ""
val supabaseKey = setting("SUPABASE_ANON_KEY") ?: ""
// CI passes the run number so every push is a newer version than the last.
val buildNumber = (setting("BUILD_NUMBER") ?: "1").toInt()

// web/ is the whole UI. env.js (Supabase URL + key) is generated next to it.
val genAssets = layout.buildDirectory.dir("generated/kitchenAssets")
val bundleWeb by tasks.registering(Sync::class) {
    val url = supabaseUrl; val key = supabaseKey
    inputs.property("url", url); inputs.property("key", key)
    from(rootProject.file("../web")) { exclude("env.js") }
    into(genAssets.map { it.dir("web") })
    doLast {
        destinationDir.resolve("env.js")
            .writeText("window.KD_ENV = { supabaseUrl: \"$url\", supabaseKey: \"$key\" };\n")
    }
}

android {
    namespace = "com.mishpuha.kitchen"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.mishpuha.kitchen"
        minSdk = 26          // Galaxy Tab S3 runs Android 9 (API 28)
        targetSdk = 36
        versionCode = buildNumber
        versionName = "1.$buildNumber"
        buildConfigField("String", "UPDATE_URL",
            "\"${if (supabaseUrl.isEmpty()) "" else supabaseUrl.trimEnd('/') + "/storage/v1/object/public/app/version.json"}\"")
    }

    buildFeatures { buildConfig = true }

    sourceSets["main"].assets.srcDirs(genAssets)

    signingConfigs {
        create("release") {
            val ks = setting("KEYSTORE_FILE")
            if (ks != null) {
                storeFile = file(ks)
                storePassword = setting("KEYSTORE_PASSWORD")
                keyAlias = setting("KEY_ALIAS") ?: "kitchen"
                keyPassword = setting("KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = if (setting("KEYSTORE_FILE") != null) signingConfigs.getByName("release")
                            else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
}

tasks.named("preBuild") { dependsOn(bundleWeb) }

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}
