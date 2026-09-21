# CrossLinks architecture

## V1 contract

- Android sends one `http` or `https` URL to one selected Chrome device.
- Android appears in both the share sheet and the ordinary “Open with” chooser.
- Chrome opens an idempotent delivery once and acknowledges it afterward.
- Delivery is near-real-time over a live channel, with polling as recovery.
- Undelivered items expire after seven days. History is retained for 30 days by
  default and remains visible after delivery or expiry.
- One owner account exists per server instance. Every client has an independently
  revocable credential.
- Pairing grants are single-use, short-lived, and represented as QR data with a
  manual code fallback.
- Clients try the configured LAN HTTPS endpoint before the public HTTPS endpoint.
  Plain HTTP is supported only for loopback development; production clients reject it.

## Trust boundaries

The server validates schemes and queue state. It never fetches a submitted URL or
page metadata. The Android client chooses the target. The extension alone performs
tab creation. A server acknowledgement cannot cause a tab to open, and a delivery
ID that the extension has already handled cannot open another tab.

Device bearer tokens and one-time pairing codes are stored as SHA-256 hashes.
The owner password is stored with Argon2id. Admin sessions use an HttpOnly,
SameSite=Strict cookie. Pairing, device revocation, and history access require an
authenticated owner session.

## Jev boundary

Jev may be used as a development aid for bounded classification or review tasks.
It is not part of LinkSync's architecture, dependencies, server, clients, or data
flow. Complex design and implementation reasoning is handled by Codex.
