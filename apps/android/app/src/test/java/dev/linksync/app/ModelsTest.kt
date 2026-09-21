package dev.linksync.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ModelsTest {
    @Test
    fun parsesAndroidPairingPayload() {
        val payload = PairingPayload.parse(
            """{"version":1,"code":"ABCDE-FGHIJ","deviceKind":"android","endpoints":["https://lan.example.com","https://links.example.com"]}"""
        )
        assertEquals("ABCDE-FGHIJ", payload.code)
        assertEquals(listOf("https://lan.example.com", "https://links.example.com"), payload.endpoints)
    }

    @Test
    fun rejectsInsecurePairingEndpoint() {
        assertThrows(IllegalArgumentException::class.java) {
            PairingPayload.manual("ABCDE-FGHIJ", "http://192.168.1.4:8787")
        }
    }

    @Test
    fun preservesValidUrlAndRejectsCredentials() {
        val url = "https://example.com/path?q=1#fragment"
        assertEquals(url, validateSharedUrl(url))
        assertThrows(IllegalArgumentException::class.java) { validateSharedUrl("https://user:secret@example.com") }
        assertThrows(IllegalArgumentException::class.java) { validateSharedUrl("spotify:album:123") }
    }
}
