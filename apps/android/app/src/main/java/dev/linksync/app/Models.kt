package dev.linksync.app

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI

data class Credentials(
    val endpoints: List<String>,
    val token: String,
    val deviceId: String,
    val deviceName: String,
)

data class BrowserDevice(
    val id: String,
    val name: String,
    val online: Boolean,
    val lastSeenAt: Long?,
)

data class HistoryItem(
    val id: String,
    val url: String,
    val status: String,
    val createdAt: Long,
)

data class ReleaseVersions(
    val server: String,
    val android: String,
    val extension: String,
)

data class PairingPayload(
    val code: String,
    val endpoints: List<String>,
) {
    companion object {
        fun parse(raw: String): PairingPayload {
            val json = JSONObject(raw)
            require(json.optInt("version") == 1) { "Unsupported pairing code version" }
            require(json.optString("deviceKind") == "android") { "This pairing code is not for Android" }
            val code = json.getString("code").trim().uppercase()
            require(code.matches(Regex("[A-Z2-9]{5}-[A-Z2-9]{5}"))) { "Invalid pairing code" }
            val endpointsJson = json.getJSONArray("endpoints")
            val endpoints = buildList {
                for (index in 0 until endpointsJson.length()) add(requireSecureEndpoint(endpointsJson.getString(index)))
            }.distinct()
            require(endpoints.isNotEmpty()) { "Pairing code has no server endpoints" }
            return PairingPayload(code, endpoints)
        }

        fun manual(code: String, serverUrl: String): PairingPayload {
            val normalizedCode = code.trim().uppercase()
            require(normalizedCode.matches(Regex("[A-Z2-9]{5}-[A-Z2-9]{5}"))) { "Enter the full pairing code" }
            return PairingPayload(normalizedCode, listOf(requireSecureEndpoint(serverUrl)))
        }

        private fun requireSecureEndpoint(raw: String): String {
            val uri = URI(raw.trim())
            require(uri.scheme == "https" && !uri.host.isNullOrBlank()) { "Server endpoints must use HTTPS" }
            require(uri.userInfo == null && uri.query == null && uri.fragment == null) { "Server endpoint must be an HTTPS origin" }
            val port = if (uri.port == -1 || uri.port == 443) "" else ":${uri.port}"
            return "https://${uri.host}$port"
        }
    }
}

fun validateSharedUrl(raw: String): String {
    val value = raw.trim()
    require(value.length in 1..16_384) { "Link is empty or too long" }
    val uri = URI(value)
    require(uri.scheme == "http" || uri.scheme == "https") { "Only HTTP and HTTPS links are supported" }
    require(!uri.host.isNullOrBlank()) { "Link must include a host" }
    require(uri.userInfo == null) { "Links containing usernames or passwords are not supported" }
    return value
}

fun JSONArray.objects(): Sequence<JSONObject> = sequence {
    for (index in 0 until length()) yield(getJSONObject(index))
}
