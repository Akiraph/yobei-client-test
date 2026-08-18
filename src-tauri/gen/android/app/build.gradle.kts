plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val defaultAbiList = listOf("arm64-v8a", "armeabi-v7a", "x86", "x86_64")
val abiList = (findProperty("abiList") as? String)?.split(',') ?: defaultAbiList
val defaultArchList = listOf("arm64", "arm", "x86", "x86_64")

android {
    namespace = "com.akiraph.yobei"
    compileSdk = 36
    ndkVersion = "29.0.14206865"

    flavorDimensions += "abi"
    productFlavors {
        create("universal") {
            dimension = "abi"
            ndk { abiFilters += abiList }
        }
        defaultArchList.forEachIndexed { index, arch ->
            create(arch) {
                dimension = "abi"
                ndk { abiFilters += defaultAbiList[index] }
            }
        }
    }

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
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }

    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    kotlinOptions {
        jvmTarget = "1.8"
    }

    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
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
