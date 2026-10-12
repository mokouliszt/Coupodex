package dev.mokouliszt.coupodex

import okhttp3.Dns
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.dnsoverhttps.DnsOverHttps
import java.net.InetAddress
import java.util.concurrent.TimeUnit

/**
 * キャリアDNSが openai 系ドメインを解決できない環境への対策。
 * システムDNSを優先し、失敗時に Cloudflare DoH へフォールバックする。
 * （overlay-ai から流用）
 *
 * 同梱の Codex に名前解決を代行させるローカルプロキシ（LocalProxy）も、この解決器を使う。
 */
object Net {

    private val doh: Dns by lazy {
        val bootstrap = OkHttpClient.Builder().build()
        DnsOverHttps.Builder().client(bootstrap)
            .url("https://cloudflare-dns.com/dns-query".toHttpUrl())
            .bootstrapDnsHosts(
                InetAddress.getByName("1.1.1.1"),
                InetAddress.getByName("1.0.0.1")
            )
            .build()
    }

    val dns = object : Dns {
        override fun lookup(hostname: String): List<InetAddress> =
            try { Dns.SYSTEM.lookup(hostname) } catch (e: Exception) { doh.lookup(hostname) }
    }

    fun client(builder: OkHttpClient.Builder): OkHttpClient = builder.dns(dns).build()

    /** GitHub への問い合わせ（Codex の更新確認と取得）に使う。 */
    val http: OkHttpClient by lazy {
        client(
            OkHttpClient.Builder()
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(60, TimeUnit.SECONDS)
                .retryOnConnectionFailure(true)
        )
    }

    const val USER_AGENT = "Coupodex-Android/" + BuildConfig.VERSION_NAME
}
