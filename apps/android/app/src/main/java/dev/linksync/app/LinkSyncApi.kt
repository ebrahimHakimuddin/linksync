package dev.linksync.app

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

class LinkSyncApi {
    fun pair(payload: PairingPayload, deviceName: String): Credentials {
        var lastError: Exception? = null
        for (endpoint in payload.endpoints) {
            try {
                val body = JSONObject()
                    .put("code", payload.code)
                    .put("name", deviceName)
                    .put("deviceKind", "android")
                val response = request(endpoint, "/api/v1/pair", "POST", body.toString(), null)
                val json = JSONObject(response)
                return Credentials(payload.endpoints, json.getString("token"), json.getString("deviceId"), deviceName)
            } catch (error: Exception) {
                lastError = error
            }
        }
        throw lastError ?: IOException("No CrossLinks endpoint was reachable")
    }

    fun devices(credentials: Credentials): List<BrowserDevice> {
        val json = JSONArray(authenticatedRequest(credentials, "/api/v1/devices", "GET"))
        return json.objects().map {
            BrowserDevice(
                id = it.getString("id"),
                name = it.getString("name"),
                online = it.getBoolean("online"),
                lastSeenAt = if (it.isNull("lastSeenAt")) null else it.getLong("lastSeenAt"),
            )
        }.toList()
    }

    fun send(credentials: Credentials, url: String, targetDeviceId: String): HistoryItem {
        val body = JSONObject()
            .put("url", validateSharedUrl(url))
            .put("targetDeviceId", targetDeviceId)
            .put("idempotencyKey", UUID.randomUUID().toString())
        val json = JSONObject(authenticatedRequest(credentials, "/api/v1/deliveries", "POST", body.toString()))
        return HistoryItem(json.getString("id"), json.getString("url"), json.getString("status"), json.getLong("created_at"))
    }

    fun history(credentials: Credentials): List<HistoryItem> {
        val json = JSONArray(authenticatedRequest(credentials, "/api/v1/history", "GET"))
        return json.objects().map {
            HistoryItem(it.getString("id"), it.getString("url"), it.getString("status"), it.getLong("created_at"))
        }.toList()
    }

    fun versions(credentials: Credentials): ReleaseVersions {
        val json = JSONObject(authenticatedRequest(credentials, "/api/v1/version", "GET"))
        return ReleaseVersions(json.getString("server"), json.getString("android"), json.getString("extension"))
    }

    private fun authenticatedRequest(
        credentials: Credentials,
        path: String,
        method: String,
        body: String? = null,
    ): String {
        var lastError: Exception? = null
        for (endpoint in credentials.endpoints) {
            try {
                return request(endpoint, path, method, body, credentials.token)
            } catch (error: Exception) {
                lastError = error
            }
        }
        throw lastError ?: IOException("No CrossLinks endpoint was reachable")
    }

    private fun request(endpoint: String, path: String, method: String, body: String?, token: String?): String {
        val connection = URL(endpoint + path).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 4_000
            connection.readTimeout = 8_000
            connection.setRequestProperty("Accept", "application/json")
            if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.bufferedWriter().use { it.write(body) }
            }
            val status = connection.responseCode
            val response = (if (status in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (status !in 200..299) {
                val message = runCatching { JSONObject(response).optString("message", JSONObject(response).optString("error")) }
                    .getOrDefault("Server returned $status")
                throw IOException(message)
            }
            return response
        } finally {
            connection.disconnect()
        }
    }
}
