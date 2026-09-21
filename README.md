# LinkSync

LinkSync sends a URL from Android to a selected Chrome installation and opens it
as a new tab. It consists of a self-hosted server, a Chrome Manifest V3 extension,
and an Android share target/browser handler.

This repository is under active construction. See [docs/architecture.md](docs/architecture.md)
for the agreed product and security boundaries.

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

