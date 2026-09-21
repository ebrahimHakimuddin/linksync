# LinkSync

LinkSync sends a URL from Android to a selected Chrome installation and opens it
as a new tab. It consists of a self-hosted server, a Chrome Manifest V3 extension,
and an Android share target/browser handler.

See [docs/architecture.md](docs/architecture.md) for the product and security
boundaries.

## Development

Requirements: Node.js 22+, pnpm 11+, JDK 17, and the Android SDK.

```sh
pnpm install
cp .env.example .env
pnpm dev:server
```

On first start, the server prints a single-use setup URL. Production deployments
must put the server behind trusted HTTPS. LinkSync does not include or call Jev,
TypeSafe, or any other inference service at runtime.

## Run the self-hosted server

Set the HTTPS origin served by your reverse proxy, then start the container:

```sh
export LINKSYNC_PUBLIC_URL=https://links.example.com
# Optional LAN-first endpoint, also with a publicly trusted certificate:
export LINKSYNC_LAN_URL=https://links.home.example.com
docker compose up -d --build
docker compose logs linksync
```

Open the one-time setup URL from the logs. The container binds only to loopback
port `8787`; terminate TLS in Caddy, nginx, Traefik, or another reverse proxy and
proxy both ordinary HTTP requests and WebSocket upgrades. See
[docs/self-hosting.md](docs/self-hosting.md).

## Load the Chrome extension

```sh
pnpm build:extension
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and
select `apps/extension/dist`. Create a Chrome pairing code in the server console,
then enter the server URL and code in the extension settings.

## Build Android

```sh
cd apps/android
./gradlew testDebugUnitTest assembleDebug lintDebug
```

Install `app/build/outputs/apk/debug/app-debug.apk`, create an Android pairing QR
in the server console, and scan it from the app. The app can then be selected from
Android's Share and Open with surfaces.
