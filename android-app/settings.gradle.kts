pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // Concentus (pure-Java Opus port used by OpusVoiceCodec) is not
        // published on Maven Central with a stable coordinate; JitPack
        // builds the jar lazily from github.com/lostromb/concentus.
        maven { url = uri("https://jitpack.io") }
    }
}

rootProject.name = "SecurityRadio"
include(":app")
