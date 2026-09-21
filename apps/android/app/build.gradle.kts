plugins {
    id("com.android.application")
}

val releaseKeystore = rootProject.file("release-key.jks")
val releasePasswordFile = rootProject.file(".release-password")
val hasReleaseSigning = releaseKeystore.isFile && releasePasswordFile.isFile

android {
    namespace = "dev.linksync.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.linksync.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"

        testInstrumentationRunner = "android.test.InstrumentationTestRunner"
    }

    buildFeatures {
        buildConfig = false
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = releaseKeystore
                storePassword = releasePasswordFile.readText().trim()
                keyAlias = "linksync"
                keyPassword = storePassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            if (hasReleaseSigning) signingConfig = signingConfigs.getByName("release")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20260814")
}
