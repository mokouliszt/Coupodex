import java.net.URI
import java.security.MessageDigest
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// 署名は keystore.properties（gitignore対象）または環境変数から読む。
// 無ければ未署名でビルドする。
val keystorePropsFile = rootProject.file("keystore.properties")
val keystoreProps = Properties().apply {
    if (keystorePropsFile.exists()) keystorePropsFile.inputStream().use { load(it) }
}
fun secret(key: String, env: String): String? =
    keystoreProps.getProperty(key) ?: System.getenv(env)

val releaseStoreFile = secret("storeFile", "COUPODEX_KEYSTORE")
val hasReleaseSigning = releaseStoreFile != null && rootProject.file(releaseStoreFile).exists()

// ---- 公式 Codex（Apache-2.0）を同梱する ----
// app-server は、code mode を実行する codex-code-mode-host を「自分と同じフォルダ」から探す。
// 現行のモデルは web 検索も code mode 経由で呼ぶので、2つを同じ場所に置かないと検索できない。
// ネイティブライブラリの置き場には lib*.so という名前のファイルしか展開されないため、
//   - codex-code-mode-host は libcodex_code_mode_host.so として入れ、インストール時に展開させる
//     （arm64 以外の端末にインストールできないのもこのため）
//   - codex-app-server は assets に入れ、初回起動時に filesDir/codex-bin/<版>/ へ展開し、
//     隣に host へのシンボリックリンクを置く（CodexUpdater.prepare）
// 新しいリリースは端末側で取得する（CodexUpdater）。ここで固定するのは初回起動用の版。
val codexVersion = "0.162.1"
val codexRelease = "https://github.com/openai/codex/releases/download/rust-v$codexVersion"
// 展開した実行ファイルの SHA-256
val codexServerSha256 = "fb15e4f4a6993ff1aeb03d1858759e1197eacf973029f06850767e865a8e8bb0"
val codexHostSha256 = "f6477b0357a8cc2291d628962876ecb1a2beb872f71a1e2734363c81ff21700d"
val codexDownloads = layout.buildDirectory.dir("codex")
val codexAssetsRoot = layout.buildDirectory.dir("generated/codexAssets")
val codexJniRoot = layout.buildDirectory.dir("generated/codexJniLibs")
// オフラインでビルドするときは、手元のバイナリを
// -PcodexBinary=/path/to/codex-app-server -PcodexHostBinary=/path/to/codex-code-mode-host で指定する
val codexLocal = (project.findProperty("codexBinary") as String?)?.let { file(it) }
val codexHostLocal = (project.findProperty("codexHostBinary") as String?)?.let { file(it) }

fun sha256(f: File): String {
    val md = MessageDigest.getInstance("SHA-256")
    f.inputStream().use { input ->
        val buf = ByteArray(1 shl 16)
        while (true) { val n = input.read(buf); if (n <= 0) break; md.update(buf, 0, n) }
    }
    return md.digest().joinToString("") { "%02x".format(it) }
}

fun download(url: String, f: File) {
    if (f.exists() && f.length() > 0) return
    f.parentFile.mkdirs()
    val tmp = File(f.parentFile, f.name + ".part")
    URI(url).toURL().openStream().use { input -> tmp.outputStream().use { input.copyTo(it) } }
    check(tmp.renameTo(f)) { "could not move $tmp" }
}

/** リリースアーカイブ（または手元のバイナリ）から [entry] を取り出して [target] に置き、照合する。 */
fun Project.placeCodex(local: File?, tgz: File, entry: String, target: File, expected: String) {
    target.parentFile.mkdirs()
    if (local != null) {
        local.copyTo(target, overwrite = true)
    } else {
        copy {
            from(tarTree(resources.gzip(tgz))) {
                include(entry)
                rename { target.name }
            }
            into(target.parentFile)
        }
    }
    val actual = sha256(target)
    check(actual == expected) { "${target.name} が公式のリリースと一致しません: $actual" }
}

val downloadCodex by tasks.registering {
    description = "公式 Codex の app-server と code-mode-host のリリースアーカイブを取得する"
    inputs.property("version", codexVersion)
    val out = codexDownloads
    outputs.dir(out)
    doLast {
        val dir = out.get().asFile
        if (codexLocal == null) {
            download("$codexRelease/codex-app-server-aarch64-unknown-linux-musl.tar.gz",
                File(dir, "app-server-$codexVersion.tar.gz"))
        }
        if (codexHostLocal == null) {
            download("$codexRelease/codex-code-mode-host-aarch64-unknown-linux-musl.tar.gz",
                File(dir, "code-mode-host-$codexVersion.tar.gz"))
        }
    }
}

val prepareCodex by tasks.registering {
    description = "app-server を assets に、code-mode-host を jniLibs に置く"
    dependsOn(downloadCodex)
    inputs.property("version", codexVersion)
    val downloads = codexDownloads
    val assetsOut = codexAssetsRoot
    val jniOut = codexJniRoot
    outputs.dir(assetsOut)
    outputs.dir(jniOut)
    doLast {
        val assetsDir = assetsOut.get().asFile.apply { deleteRecursively() }
        val jniDir = jniOut.get().asFile.apply { deleteRecursively() }
        val dl = downloads.get().asFile
        project.placeCodex(codexLocal, File(dl, "app-server-$codexVersion.tar.gz"),
            "codex-app-server-aarch64-unknown-linux-musl",
            File(assetsDir, "codex/codex-app-server"), codexServerSha256)
        project.placeCodex(codexHostLocal, File(dl, "code-mode-host-$codexVersion.tar.gz"),
            "codex-code-mode-host-aarch64-unknown-linux-musl",
            File(jniDir, "arm64-v8a/libcodex_code_mode_host.so"), codexHostSha256)
    }
}

android {
    namespace = "dev.mokouliszt.coupodex"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.mokouliszt.coupodex"
        minSdk = 26
        // 28 は意図的。targetSdk 29 以上のアプリは、ダウンロードした実行ファイルを起動できない。
        // アプリ内で Codex を更新する（CodexUpdater）ために必要。Termux と同じ判断。
        targetSdk = 28
        versionCode = 5
        versionName = "1.1.0"
        // 同梱する Codex が aarch64 版のみのため
        ndk { abiFilters += "arm64-v8a" }
        buildConfigField("String", "CODEX_VERSION", "\"$codexVersion\"")
        buildConfigField("String", "CODEX_SHA256", "\"$codexServerSha256\"")
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = rootProject.file(releaseStoreFile!!)
                storePassword = secret("storePassword", "COUPODEX_STORE_PW")
                keyAlias = secret("keyAlias", "COUPODEX_KEY_ALIAS")
                keyPassword = secret("keyPassword", "COUPODEX_KEY_PW")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (hasReleaseSigning) signingConfig = signingConfigs.getByName("release")
        }
    }

    sourceSets["main"].jniLibs.srcDir(codexJniRoot)
    sourceSets["main"].assets.srcDir(codexAssetsRoot)

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    packaging {
        // 実行するには端末上で実ファイルになっている必要がある
        jniLibs {
            useLegacyPackaging = true
            keepDebugSymbols += "**/libcodex_code_mode_host.so"
        }
        resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    }

    buildFeatures { buildConfig = true }

    lint {
        // targetSdk 28 は意図的（defaultConfig 参照）。Google Play では配布しない。
        disable += "ExpiredTargetSdkVersion"
    }
}

tasks.named("preBuild") { dependsOn(prepareCodex) }

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.browser:browser:1.8.0")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("androidx.exifinterface:exifinterface:1.3.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:okhttp-dnsoverhttps:4.12.0")
}
