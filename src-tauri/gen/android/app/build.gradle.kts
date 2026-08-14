plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.mozilla.rust-android-gradle.rust-android")
}

android {
    namespace = "com.akiraph.yobei"
    compileSdk = 36
    ndkVersion = "29.0.14206865"

    defaultConfig {
        applicationId = "com.akiraph.yobei"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        manifestPlaceholders["usesCleartextTraffic"] = "false"
    }

    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
        }
        getByName("release") {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    kotlinOptions {
        jvmTarget = "1.8"
    }
}

cargo {
    module = "../.."
    libname = "yobei_client_lib"
    targets = listOf("arm", "arm64", "x86", "x86_64")
    profile = if (gradle.startParameter.taskNames.any { it.contains("Release", ignoreCase = true) }) {
        "release"
    } else {
        "debug"
    }
}

tasks.configureEach {
    if (name == "preBuild") {
        dependsOn("cargoBuild")
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
}

val tauriBuildGradle = file("tauri.build.gradle.kts")
if (tauriBuildGradle.isFile) {
    apply(from = tauriBuildGradle)
}
