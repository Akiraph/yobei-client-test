# Yobei

Yobei is a zero-knowledge password manager for one vault owner and several
long-lived devices. Windows and Android clients synchronize encrypted records
through a Cloudflare Worker and D1. The service never receives a master
password, master key, or plaintext vault item.

[Simplified Chinese](README.zh-CN.md)

## Components

- `src`: SolidJS application UI.
- `src-tauri`: Windows and Android host, platform integrations, and IPC.
- `core`: encryption, vault storage, sync, import/export, TOTP, and generation.
- `extension`: Chromium extension connected to the unlocked desktop app.
- `yobei-server`: separate Cloudflare Worker and D1 service.

## Security Model

- Setup creates a random master key. The master password derives a KEK; the KEK
  and local secret key derive the key that wraps the master key.
- Vault records use AES-256-GCM keys derived per record with HKDF.
- Every device derives its own authentication credential. Cloudflare stores only
  its SHA-256 hash and can revoke devices independently.
- Adding a device uses a short-lived P-256 ECDH transfer. The encrypted payload
  contains the wrapped key store, never the plaintext master key or password.
- Biometric unlock protects a random local credential with DPAPI on Windows or
  Android Keystore. It does not store the master password.
- The browser bridge returns metadata and requested item secrets; it never sends
  the master key to the extension.

## Development

```bash
bun install
bun run dev
```

Build the UI with `bun run build`. Build the Chromium extension from
`extension` with `bun run build`. Rust and Android builds require their platform
toolchains and are intentionally separate from the web build.

## License

[AGPL-3.0](LICENSE), with a [Contributor License Agreement](CLA.md).
