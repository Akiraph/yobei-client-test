# Contributing to Yobei

Thanks for wanting to contribute. Yobei is a security-focused project, so a few ground rules keep things reviewable and safe. Please also read [SECURITY.md](SECURITY.md).

## CLA

All contributions (code, docs, design) are accepted under the [Contributor License Agreement](CLA.md). By opening a pull request you agree to its terms — the reviewer will confirm your sign-off on the PR.

## Development setup

- [bun](https://bun.sh) is the package manager for both the client and the server.
- Rust toolchain (stable) for `yobei-core` and `src-tauri`.
- Desktop: `bun install && bun run tauri dev`
- Core tests: `cd core && cargo test`
- Extension: `cd extension && bun install && bun run wasm && bun run build`
- Server: `cd yobei-server && bun install && bun run db:apply:local && bun run dev`

## Branching and commits

- One logical change per branch, one per PR.
- Commit messages follow the conventional style with an English description, e.g.:
  - `feat: add save-new-login prompt`
  - `fix: auto-lock no longer fires on system lock`
  - `chore: update dependencies`
- Keep commits small and focused; rebase onto `main` before opening the PR.

## Before opening a PR

- `cd core && cargo test` passes.
- `cd extension && bun run typecheck` passes.
- `bun run tauri build` (or at least `cargo check` in `src-tauri`) is clean — no new warnings from your changes.
- The server: `cd yobei-server && bun run typecheck` passes.
## Code conventions

- **Rust** — `cargo fmt`, clippy-clean for new code. No `unwrap()` on untrusted data. Anything touching secrets should zeroize where the crate supports it.
- **TypeScript** — strict mode, no `any` leaks. Keep the crypto/WASM boundary inside `yobei-core`; the UI never reimplements crypto.
- **Secrets** — never log keys, passwords, or ciphertext. `println!`/`dbg!` in a PR will be sent back.
- **Crypto** — new cryptographic code must be reviewed by two people and ideally use audited primitives (aes-gcm, argon2, hkdf). Don't roll your own.

## Repo layout reminder

This is a **multirepo** project: `yobei-client` (app, core, extension) and `yobei-server` (backend) live in separate repositories. Client PRs never touch server code and vice versa — the whole point is that the crypto never crosses the wire.

## License

By contributing you agree that your work is licensed under [AGPL-3.0](LICENSE) per the [CLA](CLA.md).
