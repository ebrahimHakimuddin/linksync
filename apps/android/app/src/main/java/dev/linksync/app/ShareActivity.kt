package dev.linksync.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.Window
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.util.concurrent.Executors

/** A compact share target: sending a link should not open the full dashboard. */
class ShareActivity : Activity() {
    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private lateinit var store: CredentialStore
    private val api = LinkSyncApi()
    private lateinit var content: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestWindowFeature(Window.FEATURE_NO_TITLE)
        store = CredentialStore(this)
        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(22), dp(24), dp(18))
            background = Brand.card(this@ShareActivity, 24)
        }
        setContentView(content)
        window.setBackgroundDrawableResource(android.R.color.transparent)
        window.setLayout((resources.displayMetrics.widthPixels * .92f).toInt(), -2)
        window.setGravity(Gravity.CENTER)
        setFinishOnTouchOutside(true)
        render()
    }

    override fun onDestroy() {
        worker.shutdownNow()
        super.onDestroy()
    }

    private fun render() {
        val url = readUrl() ?: return finishWithMessage("CrossLinks only accepts HTTP or HTTPS links")
        val credentials = store.load() ?: return showPairPrompt(url)
        content.removeAllViews()
        content.addView(TextView(this).apply {
            text = "Send with CrossLinks"
            textSize = 22f
            typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD)
            setTextColor(Brand.text(this@ShareActivity))
        })
        content.addView(TextView(this).apply {
            text = url
            textSize = 14f
            maxLines = 2
            ellipsize = android.text.TextUtils.TruncateAt.END
            setTextColor(Brand.muted(this@ShareActivity))
            setPadding(0, dp(8), 0, dp(16))
        })
        val status = TextView(this).apply { setTextColor(Brand.muted(this@ShareActivity)) }
        content.addView(status)
        background(
            work = { api.devices(credentials) },
            success = { devices ->
                content.removeView(status)
                if (devices.isEmpty()) {
                    status.text = "No Chrome devices are paired yet."
                    content.addView(status, 2)
                } else {
                    devices.forEach { device ->
                        content.addView(Brand.primary(Button(this)).apply {
                            text = if (device.online) "${device.name}  ·  online" else "${device.name}  ·  queued"
                            setOnClickListener {
                                isEnabled = false
                                text = "Sending…"
                                background(
                                    work = { api.send(credentials, url, device.id) },
                                    success = { finish() },
                                    failure = { error -> isEnabled = true; text = device.name; status.text = error.message ?: "Could not send link" },
                                )
                            }
                        }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
                    }
                    content.addView(Brand.secondary(Button(this)).apply {
                        text = "Cancel"
                        setOnClickListener { finish() }
                    }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
                }
            },
            failure = { error -> status.text = error.message ?: "Could not reach CrossLinks" },
        )
    }

    private fun showPairPrompt(url: String) {
        content.removeAllViews()
        content.addView(TextView(this).apply { text = "CrossLinks isn't paired"; textSize = 21f; setTextColor(Brand.text(this@ShareActivity)) })
        content.addView(TextView(this).apply { text = "Open CrossLinks to pair this phone before sending."; setTextColor(Brand.muted(this@ShareActivity)); setPadding(0, dp(8), 0, dp(12)) })
        content.addView(Brand.primary(Button(this)).apply {
            text = "Open CrossLinks"
            setOnClickListener { startActivity(Intent(this@ShareActivity, MainActivity::class.java).putExtra(Intent.EXTRA_TEXT, url)); finish() }
        })
        content.addView(Brand.secondary(Button(this)).apply { text = "Cancel"; setOnClickListener { finish() } }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
    }

    private fun readUrl(): String? = runCatching {
        val raw = when (intent.action) {
            Intent.ACTION_VIEW -> intent.dataString
            Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)
            else -> null
        } ?: return null
        validateSharedUrl(raw)
    }.getOrNull()

    private fun finishWithMessage(message: String) {
        android.widget.Toast.makeText(this, message, android.widget.Toast.LENGTH_LONG).show()
        finish()
    }

    private fun <T> background(work: () -> T, success: (T) -> Unit, failure: (Throwable) -> Unit) {
        worker.execute { runCatching(work).onSuccess { main.post { success(it) } }.onFailure { main.post { failure(it) } } }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
