package dev.mokouliszt.coupodex

import okhttp3.Dns
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.dnsoverhttps.DnsOverHttps
import java.net.InetAddress

/**
 * キャリアDNSが openai 系ドメインを解決できない環境への対策。
 * システムDNSを優先し、失敗時に Cloudflare DoH へフォールバックする。
 * （overlay-ai から流用）
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

    private val resilientDns = object : Dns {
        override fun lookup(hostname: String): List<InetAddress> =
            try { Dns.SYSTEM.lookup(hostname) } catch (e: Exception) { doh.lookup(hostname) }
    }

    fun client(builder: OkHttpClient.Builder): OkHttpClient = builder.dns(resilientDns).build()
}
