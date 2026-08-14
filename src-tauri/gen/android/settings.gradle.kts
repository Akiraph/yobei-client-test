pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    id("org.jetbrains.kotlin.android") version "1.9.25" apply false
    id("com.android.application") version "8.11.0" apply false
    id("org.mozilla.rust-android-gradle") version "0.9.6" apply false
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

val tauriSettingsGradle = file("tauri.settings.gradle")
if (tauriSettingsGradle.isFile) {
    apply(from = tauriSettingsGradle)
}

rootProject.name = "yobei-android"
include(":app")
