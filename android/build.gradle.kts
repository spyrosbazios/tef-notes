// Kotlin itself is the Android plugin's (built in since AGP 9); the Compose compiler plugin sets its version.
plugins {
    id("com.android.application") version "9.5.0" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.21" apply false
}
