# Security Policy

Yobei is a zero-knowledge password manager. Security bugs are taken seriously here — this policy is for anyone who finds one.

## Reporting a vulnerability

Do **not** open a public issue for a vulnerability. Instead, email the maintainers directly. If a reporter and maintainer agree on a secure channel, encrypted reports are preferred (ask for a key).

**Preferred reporting steps**

1. Email the maintainers with a subject starting `[yobei-security]`.
2. Include the affected component (`yobei-core`, desktop, extension, server), the severity you believe it is, and — if you have one — a minimal reproduction.
3. You'll get an acknowledgment within a few days and a fix timeline. We ask for a reasonable embargo (typically 30–90 days) before public disclosure, coordinated with the fix release.

## Scope

In scope: anything in `yobei-client` (desktop app, `yobei-core`, extension) and `yobei-server`.

Out of scope: third-party dependencies you believe are compromised (report those upstream), and vulnerabilities that require already-possessing the user's master password or unlocked device.

## What we care about most

For a zero-knowledge password manager, the threat model is: **an attacker with full access to the sync server, the local vault file, or the network in between must not be able to recover the master password, master key, or plaintext vault items.**

The highest-priority findings, roughly in order:

- Weakness in key derivation (Argon2id parameters, KEK/MK derivation)
- Cryptographic misuse (reused IV/nonce, weak AEAD usage, unauthenticated ciphertext, timing side channels)
- Key or plaintext leakage (to logs, sync payloads, backups, crash dumps)
- Biometric / platform-keystore bypass on any OS
- Session, pairing, or auth-key weaknesses in the sync protocol
- CSRF/XSS issues in the extension content scripts
- Anything that lets ciphertext be silently tampered with (loss of integrity)

## Acknowledgements

Contributors who report confirmed vulnerabilities are credited in release notes (unless they prefer to stay anonymous).

## Supported

Security fixes target the current release. Older versions are not patched retroactively — upgrade to the latest.
