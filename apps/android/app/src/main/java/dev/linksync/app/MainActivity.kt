package dev.linksync.app

import android.app.Activity
import android.app.role.RoleManager
import android.content.Intent
import android.os.Bundle
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.TextView
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import java.text.DateFormat
import java.util.Date
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private lateinit var store: CredentialStore
    private val api = LinkSyncApi()
    private var incomingUrl: String? = null
    private var pairingPayload: PairingPayload? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = CredentialStore(this)
        incomingUrl = readIncomingUrl(intent)
        render()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        incomingUrl = readIncomingUrl(intent)
        render()
    }

    override fun onDestroy() {
        worker.shutdownNow()
        super.onDestroy()
    }

    private fun render() {
        setContentView(if (store.load() == null) pairingView() else homeView())
    }

    private fun root(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(24), dp(28), dp(24), dp(28))
        addView(brandHeader(), margins().apply { bottomMargin = dp(28) })
    }

    private fun brandHeader(): View = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        addView(android.widget.ImageView(this@MainActivity).apply { setImageResource(R.mipmap.ic_launcher) }, LinearLayout.LayoutParams(dp(40), dp(40)))
        addView(Brand.wordmark(TextView(this@MainActivity)), LinearLayout.LayoutParams(-2, -2).apply { marginStart = dp(10) })
    }

    private fun pairingView(): View = scroll(root().apply {
        addView(title("Pair CrossLinks"))
        addView(copy("Scan the QR code created by your CrossLinks server, or enter its details manually."))
        val scan = primaryButton("Scan pairing QR") { scanPairingCode() }
        addView(scan, margins(top = 22))
        addView(section("Manual pairing"), margins(top = 26))
        val server = input("https://links.example.com")
        val code = input("ABCDE-FGHIJ")
        val name = input(android.os.Build.MODEL.ifBlank { "Android phone" })
        addView(label("Server URL")); addView(server)
        addView(label("Pairing code"), margins(top = 14)); addView(code)
        addView(label("Device name"), margins(top = 14)); addView(name)
        val status = statusText()
        addView(primaryButton("Pair phone") {
            runCatching { PairingPayload.manual(code.text.toString(), server.text.toString()) }
                .onSuccess { pair(it, name.text.toString(), status) }
                .onFailure { status.error(it.message ?: "Invalid pairing details") }
        }, margins(top = 20))
        addView(status, margins(top = 12))
    })

    private fun homeView(): View = scroll(root().apply {
        val credentials = store.load() ?: return@apply
        addView(title("Send with CrossLinks"))
        addView(copy("Paired as ${credentials.deviceName}"))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val roleManager = getSystemService(RoleManager::class.java)
            if (roleManager?.isRoleAvailable(RoleManager.ROLE_BROWSER) == true && !roleManager.isRoleHeld(RoleManager.ROLE_BROWSER)) {
                addView(secondaryButton("Use CrossLinks for web links") {
                    startActivityForResult(roleManager.createRequestRoleIntent(RoleManager.ROLE_BROWSER), 40)
                }, margins(top = 18))
            }
        }

        val shared = incomingUrl
        if (shared != null) {
            addView(section("Link"), margins(top = 24))
            addView(copy(shared))
        } else {
            addView(copy("Choose CrossLinks from Android's Share or Open with menu to send a URL."), margins(top = 24))
        }

        addView(section("Target browser"), margins(top = 24))
        val targets = RadioGroup(this@MainActivity).apply {
            orientation = RadioGroup.VERTICAL
            background = Brand.card(this@MainActivity)
            setPadding(dp(12), dp(6), dp(12), dp(6))
        }
        addView(targets, margins(top = 8))
        val status = statusText()
        val send = primaryButton("Send link") {
            val selected = targets.findViewById<RadioButton>(targets.checkedRadioButtonId)?.tag as? String
            if (shared == null) status.error("Open or share a URL with CrossLinks first")
            else if (selected == null) status.error("Choose a target browser")
            else send(shared, selected, status)
        }.apply { isEnabled = false }
        addView(send, margins(top = 16))
        addView(status, margins(top = 10))
        addView(secondaryButton("Check for updates") {
            status.text = "Checking versions…"
            background(
                work = { api.versions(credentials) },
                success = { versions ->
                    val app = appVersion()
                    val health = if (app == versions.android && versions.android == versions.extension) "All components match" else "A component update may be available"
                    status.text = "$health · app $app · server ${versions.server} · extension ${versions.extension}"
                },
                failure = { status.error(it.message ?: "Could not check versions") },
            )
        }, margins(top = 16))
        addView(section("Recent history"), margins(top = 28))
        val history = LinearLayout(this@MainActivity).apply {
            orientation = LinearLayout.VERTICAL
            background = Brand.card(this@MainActivity)
            setPadding(dp(16), dp(6), dp(16), dp(6))
        }
        addView(history, margins(top = 8))
        addView(secondaryButton("Forget this server") {
            store.clear(); pairingPayload = null; incomingUrl = null; render()
        }, margins(top = 28))

        background(
            work = { api.devices(credentials) to api.history(credentials) },
            success = { (devices, items) ->
                targets.removeAllViews()
                devices.forEach { device ->
                    targets.addView(Brand.tint(RadioButton(this@MainActivity)).apply {
                        minHeight = dp(48)
                        id = View.generateViewId()
                        tag = device.id
                        text = if (device.online) "${device.name} · online" else "${device.name} · offline, will queue"
                        if (device.id == store.lastTargetId) isChecked = true
                    })
                }
                if (targets.checkedRadioButtonId == -1 && targets.childCount > 0) {
                    (targets.getChildAt(0) as RadioButton).isChecked = true
                }
                send.isEnabled = devices.isNotEmpty() && shared != null
                history.removeAllViews()
                if (items.isEmpty()) history.addView(copy("Nothing sent yet."))
                items.take(12).forEach { item -> history.addView(historyRow(item)) }
            },
            failure = { status.error(it.message ?: "Could not reach the server") },
        )
    })

    private fun scanPairingCode() {
        val options = GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
            .enableAutoZoom()
            .build()
        try {
            GmsBarcodeScanning.getClient(this, options).startScan()
                .addOnSuccessListener { barcode ->
                    runCatching { PairingPayload.parse(barcode.rawValue ?: "") }
                        .onSuccess { payload ->
                            pairingPayload = payload
                            showScannedPairing(payload)
                        }
                        .onFailure { showMessage(it.message ?: "That QR code is not a CrossLinks pairing code") }
                }
                .addOnFailureListener { showMessage(it.message ?: "QR scanning failed") }
        } catch (error: RuntimeException) {
            // Google Play services can fail before returning a Task when the
            // optional scanner module is unavailable or the device has no
            // compatible Play services. Keep that device-side failure from
            // taking down the app and let the user use manual pairing.
            showMessage(error.message ?: "QR scanning is unavailable on this device")
        }
    }

    private fun showScannedPairing(payload: PairingPayload) {
        val layout = root()
        layout.addView(title("Confirm pairing"))
        layout.addView(copy("Server: ${payload.endpoints.first()}"))
        val name = input(android.os.Build.MODEL.ifBlank { "Android phone" })
        layout.addView(label("Device name"), margins(top = 20)); layout.addView(name)
        val status = statusText()
        layout.addView(primaryButton("Pair phone") { pair(payload, name.text.toString(), status) }, margins(top = 20))
        layout.addView(status, margins(top = 12))
        layout.addView(secondaryButton("Cancel") { pairingPayload = null; render() }, margins(top = 12))
        setContentView(scroll(layout))
    }

    private fun pair(payload: PairingPayload, deviceName: String, status: TextView) {
        if (deviceName.trim().isEmpty()) return status.error("Enter a device name")
        status.setText(R.string.pairing_in_progress)
        background(
            work = { api.pair(payload, deviceName.trim()) },
            success = { credentials -> store.save(credentials); pairingPayload = null; render() },
            failure = { status.error(it.message ?: "Pairing failed") },
        )
    }

    private fun send(url: String, targetId: String, status: TextView) {
        val credentials = store.load() ?: return render()
        status.setText(R.string.sending_in_progress)
        background(
            work = { api.send(credentials, url, targetId) },
            success = {
                store.lastTargetId = targetId
                status.setText(R.string.send_complete)
                incomingUrl = null
            },
            failure = { status.error(it.message ?: "Send failed") },
        )
    }

    private fun readIncomingUrl(intent: Intent): String? {
        val raw = when (intent.action) {
            Intent.ACTION_VIEW -> intent.dataString
            Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)
            else -> null
        } ?: return null
        return runCatching { validateSharedUrl(raw) }.getOrElse {
            main.post { showMessage(it.message ?: "CrossLinks only accepts complete HTTP or HTTPS URLs") }
            null
        }
    }

    private fun <T> background(work: () -> T, success: (T) -> Unit, failure: (Throwable) -> Unit) {
        worker.execute {
            runCatching(work).onSuccess { main.post { success(it) } }.onFailure { main.post { failure(it) } }
        }
    }

    private fun historyRow(item: HistoryItem): View = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(0, dp(9), 0, dp(9))
        addView(TextView(this@MainActivity).apply {
            text = item.url; maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END
            setTextColor(Brand.text(this@MainActivity))
        })
        addView(TextView(this@MainActivity).apply {
            text = getString(
                R.string.history_metadata,
                item.status,
                DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(item.createdAt)),
            )
            setTextColor(Brand.muted(this@MainActivity)); textSize = 12f
        })
    }

    private fun scroll(content: View): ScrollView = ScrollView(this).apply { addView(content) }
    private fun title(value: String) = TextView(this).apply {
        text = value; textSize = 28f; letterSpacing = -0.02f
        typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD)
        setTextColor(Brand.text(this@MainActivity)); setPadding(0, 0, 0, dp(6))
    }
    private fun section(value: String) = TextView(this).apply {
        text = value.uppercase(); textSize = 11f; letterSpacing = 0.09f
        typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD)
        setTextColor(Brand.muted(this@MainActivity))
    }
    private fun copy(value: String) = TextView(this).apply { text = value; textSize = 15f; setTextColor(Brand.muted(this@MainActivity)); setTextIsSelectable(true) }
    private fun label(value: String) = TextView(this).apply {
        text = value; textSize = 13f; setPadding(0, 0, 0, dp(6)); setTextColor(Brand.text(this@MainActivity))
        typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD)
    }
    private fun input(hintValue: String) = Brand.input(EditText(this)).apply { hint = hintValue; isSingleLine = true }
    private fun statusText() = TextView(this).apply { setTextColor(Brand.muted(this@MainActivity)); setTextIsSelectable(true) }
    private fun primaryButton(textValue: String, action: () -> Unit) = Brand.primary(Button(this)).apply { text = textValue; setOnClickListener { action() } }
    private fun secondaryButton(textValue: String, action: () -> Unit) = Brand.secondary(Button(this)).apply { text = textValue; setOnClickListener { action() } }
    private fun TextView.error(message: String) { text = message; setTextColor(Brand.danger(this@MainActivity)) }
    private fun showMessage(message: String) = android.widget.Toast.makeText(this, message, android.widget.Toast.LENGTH_LONG).show()
    private fun appVersion(): String = packageManager.getPackageInfo(packageName, 0).versionName ?: "unknown"
    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
    private fun margins(top: Int = 0): ViewGroup.MarginLayoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(top) }
}
