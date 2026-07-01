# Agent Light

Desktop MVP for an AI-agent status companion: a Tauri v2 Win/Mac desktop app, React/TypeScript UI, local loopback API, optional Fastify cloud server, CLI wrapper, ESP32 USB RGB hardware support, and a freely movable animated desktop pet.

## Documentation

This project now follows spec-mode development. Start here:

- [Documentation index](docs/README.md)
- [MVP product spec](docs/specs/agent-light-mvp.md)
- [Acceptance matrix](docs/product/acceptance-matrix.md)
- [Architecture](docs/engineering/architecture.md)
- [ESP32 RGB hardware spec](docs/specs/esp32-rgb-hardware.md)
- [Local API](docs/engineering/api.md)
- [Testing strategy](docs/engineering/testing.md)
- [Release notes and checklist](docs/operations/release.md)
- [Runbook](docs/operations/runbook.md)

## Current scope

- Win/Mac desktop app (Tauri v2).
- Floating transparent desktop pet window, not a standalone web page. The pet window can be dragged freely around the desktop.
- Pet artwork uses PNG frame sequences under `public/assets/pet-frames/` (committed in repo; run `npm run assets:placeholder` only when those files are missing).
- Optional cloud features via `server/` (Fastify `:8787`): phone login, token leaderboard, usage sync.
- ESP32 RGB firmware lives in `firmware/agent_light_esp32_rgb` and expects the RGB LED on GPIO `1/2/3` plus `GND`.
- When the pet is away from the top edge, a temporary yellow hardware-style cube appears above its head for alignment and animation feedback. When the pet is placed near the top edge, the cube disappears so it can visually line up with the real lamp.
- Local API: `POST http://127.0.0.1:18765/api/state`.
- CLI: `agent-light state completed "Done"` when installed, or `npm run agent-light -- state completed "Done"` from this repo.
- Game entry: menu placeholder window only.

## Status values

- `standby`: blue light, waiting for work.
- `working`: yellow breathing light.
- `completed`: green completion status; the pet keeps jumping until another state is set or the pet is clicked to confirm the result was seen.
- `attention`: red pulse, user action required.

Legacy aliases are accepted by the CLI/API and normalized in responses:
`idle -> standby`, `running -> working`, `success -> completed`, `error/needs_action -> attention`.

## Development

```bash
npm install
npm run tauri dev
```

For cloud server + desktop together:

```bash
docker compose up -d mysql
npm run dev:all
```

In another terminal:

```bash
npm run agent-light -- state completed "Task finished"
curl -fsS -X POST http://127.0.0.1:18765/api/state \
  -H 'Content-Type: application/json' \
  -d '{"state":"attention","message":"Review requested"}'
```

## Verification

```bash
npm run test:all
npm run build
npm run tauri dev
npm run tauri build
```

`npm run test:all` runs frontend, shared, server Vitest, and `cargo test` in `src-tauri/`.

`npm run tauri dev` and `npm run tauri build` require a local Rust toolchain (`cargo` and `rustc`).

Platform installers:

```bash
# Windows (.exe NSIS installer)
npm run tauri:build:windows

# macOS (.dmg, must run on macOS)
npm run tauri:build:macos
```

| Platform | Command | Artifact |
| --- | --- | --- |
| Windows x64 | `npm run tauri:build:windows` | `src-tauri/target/release/bundle/nsis/*-setup.exe` |
| macOS | `npm run tauri:build:macos` | `src-tauri/target/release/bundle/dmg/*.dmg` |

macOS DMG cannot be built on Windows. Use a Mac, or push a `v*` tag to trigger the GitHub Actions `Release` workflow.

**macOS 首次打开（未 Apple 公证）**：若提示「无法验证开发者」或「已损坏」，在终端执行：

```bash
xattr -cr "/Applications/Agent Light.app"
```

然后 **Control + 点击** 应用 → **打开**（首次不要用双击）。也可运行仓库内 `bash scripts/macos-trust-agent-light.sh`。

For browser-only frontend preview, use `npm run dev`. Browser preview does not validate the Tauri WebView, window permissions, or the Rust local API.

## License

This project is licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE).

AGPL-3.0 is a strong copyleft license: you may use, modify, and distribute this software, but derivative works and network-deployed services must also release their complete corresponding source code under the same license. See [LICENSE](LICENSE) for the full text.
