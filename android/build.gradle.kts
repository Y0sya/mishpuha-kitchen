plugins {
    id("com.android.application") version "8.13.2" apply false
    id("org.jetbrains.kotlin.android") version "2.2.21" apply false
}

// Set KITCHEN_BUILD_DIR to keep build output out of a synced folder (e.g. SynologyDrive).
System.getenv("KITCHEN_BUILD_DIR")?.let { out ->
    allprojects { layout.buildDirectory.set(File(out, name)) }
}
