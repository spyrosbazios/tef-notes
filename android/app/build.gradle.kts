import javax.inject.Inject
import org.gradle.process.ExecOperations

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

// The repository's one version (scripts/version.sh): the git tag, or TEF_NOTES_VERSION. A pre-release suffix is the
// name's only: Android orders installs by the code.
val tefVersion: String = providers.exec { commandLine("sh", rootDir.resolve("../scripts/version.sh").path) }
    .standardOutput.asText.get().trim()
val (major, minor, patch) = tefVersion.substringBefore("-").split(".").map(String::toInt)

android {
    namespace = "app.tefnotes.companion"
    compileSdk = 37

    defaultConfig {
        applicationId = "app.tefnotes.companion"
        minSdk = 34
        // Not 37 yet: an app targeting it must ask for a new permission at run time before it may reach a server on the
        // local network (Android 17's ACCESS_LOCAL_NETWORK), and that has to be built and tried on a phone first.
        targetSdk = 36
        versionCode = major * 1_000_000 + minor * 1_000 + patch
        versionName = tefVersion
    }

    // Signed with your own keystore when TEF_NOTES_KEYSTORE names one (a file path), else with the debug key, so a fork
    // with no secrets still builds. An update installs only over a build signed with the same key.
    signingConfigs {
        System.getenv("TEF_NOTES_KEYSTORE")?.let { store ->
            create("release") {
                storeFile = file(store)
                storePassword = System.getenv("TEF_NOTES_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("TEF_NOTES_KEY_ALIAS")
                keyPassword = System.getenv("TEF_NOTES_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    buildFeatures { compose = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // Every warning about this code fails the build. Not the ones that fire because the world moved on rather than the
    // code (a newer library or Android exists): those would break an unchanged build from one day to the next, and
    // targetSdk is held back on purpose (above). ObsoleteLintCustomCheck is about a library's own bundled lint rules
    // (androidx.lifecycle's, built for an older lint), not about anything here.
    lint {
        warningsAsErrors = true
        abortOnError = true
        disable += setOf("GradleDependency", "NewerVersionAvailable", "OldTargetApi", "ObsoleteLintCustomCheck")
    }
}

/** Runs scripts/generate.ts: the colours, icons and brand mark as resources, from packages/core and lucide. */
abstract class GenerateTefNotes : DefaultTask() {
    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val sources: ConfigurableFileCollection

    @get:Internal
    abstract val workDir: DirectoryProperty

    @get:OutputDirectory
    abstract val res: DirectoryProperty

    @get:Inject
    abstract val exec: ExecOperations

    @TaskAction
    fun generate() {
        exec.exec {
            workingDir = workDir.get().asFile
            commandLine("bun", "scripts/generate.ts", res.get().asFile.path)
        }
    }
}

androidComponents {
    onVariants { variant ->
        val generate = tasks.register<GenerateTefNotes>("generateTefNotes${variant.name.replaceFirstChar(Char::uppercase)}") {
            val core = rootDir.resolve("../packages/core/src")
            sources.from(
                rootDir.resolve("scripts"), rootDir.resolve("bun.lock"), rootDir.resolve("../assets/fonts"),
                core.resolve("theme.ts"), core.resolve("brand.ts"), core.resolve("companion.ts"),
            )
            workDir.set(rootDir)
        }
        variant.sources.res?.addGeneratedSourceDirectory(generate, GenerateTefNotes::res)
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.19.1")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.glance:glance-appwidget:1.2.0")
    implementation("androidx.work:work-runtime:2.12.0")

    testImplementation("junit:junit:4.13.2")
    // The JSON classes the app uses are the platform's; on the JVM the tests need the library they came from.
    testImplementation("org.json:json:20260814")
}
