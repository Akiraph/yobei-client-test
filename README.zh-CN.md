# 有备 Yobei

有备是面向单个保险库所有者和多台长期设备的零知识密码管理器。Windows 与 Android
客户端通过 Cloudflare Worker 和 D1 同步加密记录。服务端不会收到主密码、主密钥或
任何保险库明文。

[English](README.md)

## 组成

- `src`:SolidJS 应用界面。
- `src-tauri`:Windows 与 Android 宿主、平台集成和 IPC。
- `core`:加密、保险库存储、同步、导入导出、TOTP 和密码生成。
- `extension`:连接已解锁桌面应用的 Chromium 扩展。
- `yobei-server`:独立的 Cloudflare Worker 和 D1 服务。

## 安全模型

- 初始化时生成随机主密钥。主密码派生 KEK,KEK 与本地 Secret Key 共同派生主密钥
  包裹密钥。
- 保险库记录使用 HKDF 逐记录派生密钥,并以 AES-256-GCM 加密。
- 每台设备拥有独立的派生认证凭据。Cloudflare 只保存 SHA-256 哈希,各设备可独立撤销。
- 添加设备使用短时 P-256 ECDH 交接。加密载荷仅包含已包裹密钥区,不含明文主密钥或
  主密码。
- 生物识别解锁使用 Windows DPAPI 或 Android Keystore 保护随机本地凭据,不会保存
  主密码。
- 浏览器桥只返回元数据和按需请求的单个条目秘密,绝不把主密钥发给扩展。

## 开发

```bash
bun install
bun run dev
```

使用 `bun run build` 构建界面。在 `extension` 目录运行 `bun run build` 构建 Chromium
扩展。Rust 与 Android 构建需要对应平台工具链,与 Web 构建分开执行。

## 许可证

[AGPL-3.0](LICENSE),附[贡献者许可协议](CLA.md)。
