# Validation and reproducibility

## Automated Node tests

Run `npm test` with Node.js 20 or later; no dependencies need to be installed. All 46 tests passed locally and in the first GitHub Actions deployment run on 2026-09-08:

https://github.com/wieslawsoltes/NotepadXP/actions/runs/34216577370

The suite covers persistent text-tree invariants and randomized edits, Unicode and legacy encodings, search and replacement, revision-checked atomic edits, undo/redo, print settings, the actual worker module through a Node message-port shim, MCP transports, authentication, Origin/Host checks, tab pairing, and server-enforced read-only permissions.

Node worker-module tests do not validate browser worker startup or OffscreenCanvas integration.

## Build integrity

The initial deployment assembled the uploaded source with SHA-256 checks, checked JavaScript syntax, built the standalone HTML, and verified its hash against the original delivered artifact:

```
44e40442a9369f3b25f8c36081dee70492e05feb92c59f23d2eba577b887f401  NotepadXP.html
```

The generated file is 184,514 bytes. The one-time import files were removed after verification. The permanent Pages workflow builds, tests, and publishes every push to `main`; it does not need repository contents-write permission.

## Browser checks

The original delivery completed 36 checks in Chromium using the injected, opaque-origin Canvas-fallback mode. They exercised typing, menus and dialogs, search/replace, undo/redo, Unicode round trips, stale revision rejection, unsaved-change prompts, print preparation, a 200,001-line document, a five-million-character line, and emulated mobile layout.

To reproduce against the local companion, install Playwright separately and provide your Chromium executable path:

```sh
node mcp/server.mjs
# In another terminal:
python tests/browser-smoke.py --url http://127.0.0.1:8787 --browser /path/to/chromium
```

The test writes screenshots and a browser report to `docs/`. `--injected` instead loads the standalone file into an opaque page. Reports from that mode must not be presented as WebGPU or browser-worker validation. Original screenshots and raw reports were included in the initial downloadable bundle; they are not required runtime assets.

WebGPU execution, browser-worker startup, native disk/printer completion, physical-phone IME behavior, and cross-browser parity were not validated by the original browser run. A successful Pages deployment does not change those coverage limits. Runtime state and Help → About Notepad report the actual renderer and worker status.

## CPU performance measurements

Run `npm run bench` to generate `docs/benchmark-results.json`, or pass dataset sizes directly:

```sh
node --expose-gc tests/benchmark.mjs 10 100
```

The retained report measures synthetic CPU text-engine operations only. It excludes browser rendering, worker transfer, encoding, disk I/O, and native file-dialog time. It is environment-specific, not a frame-rate or large-file memory guarantee.

See [compatibility](COMPATIBILITY.md) and [security](SECURITY.md) for further boundaries.
