# LinkSync privacy policy template

_Replace the operator and contact placeholders before publishing._

LinkSync transfers web addresses between devices chosen by the user. The LinkSync
server stores submitted URLs, device names, delivery status, and delivery timestamps
for the retention period configured by the server owner. Undelivered items expire
after seven days by default, and delivery history is retained for 30 days by default.

LinkSync does not fetch the contents of submitted URLs, create remote previews,
sell data, serve advertising, or include analytics. Device credentials are generated
during pairing and stored as one-way hashes on the server. Android stores its device
credential encrypted with Android Keystore. Chrome stores its credential in local
extension storage.

The Android app uses Google Play services Code Scanner to scan a LinkSync pairing
QR code without requesting camera permission. Google Play services supplies the
scanner interface; image processing occurs on the device. Consult Google's privacy
documentation for the behavior of Google Play services on the user's device.

All application traffic must use HTTPS. A self-hosted LinkSync operator controls
the server, its logs, backups, retention setting, and network infrastructure. Users
may delete individual history entries or completed history through the owner console,
and may revoke any paired device.

Operator: **[name]**  
Contact: **[email or support URL]**  
Effective date: **[date]**
