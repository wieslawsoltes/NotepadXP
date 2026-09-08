# Notepad XP Web Edition

A Windows XP Service Pack 3-style Notepad built with plain HTML, CSS, and JavaScript. WebGPU renders the text viewport; a Canvas 2D fallback keeps the editor usable without a compatible GPU. No runtime framework, CDN, or npm dependencies.

**[Open Notepad XP](https://wieslawsoltes.github.io/NotepadXP/)** · **[Standalone HTML](https://wieslawsoltes.github.io/NotepadXP/NotepadXP.html)** · **[Deployment status](https://github.com/wieslawsoltes/NotepadXP/actions/workflows/pages.yml)**

## Run locally

Use Node.js 20 or later:

```sh
git clone https://github.com/wieslawsoltes/NotepadXP.git
cd NotepadXP
node mcp/server.mjs
```

Open the complete localhost URL printed by the server. There is no `npm install` step. Alternatively, download `NotepadXP.html` and open it as a self-contained editor, or serve the repository as a static website.

## Features

- XP-style Luna window, menus, scrollbars, status bar, Find, Replace, Go To, Font, file, Page Setup, Help, and About dialogs.
- Plain-text editing, keyboard navigation, selection, clipboard, grouped undo/redo, directional literal search, Replace All, time/date insertion, and unsaved-change prompts.
- ANSI code pages, UTF-8, UTF-16 LE/BE, BOM handling, line-ending preservation, drag-and-drop opening, and `.LOG` timestamps.
- Word Wrap, document-wide font settings, paginated printing, margins, paper orientation, and header/footer commands.
- Touch scrolling, long-press word selection, draggable selection handles, and mobile dialog layouts.
- A persistent AVL text rope, bounded input proxy, viewport-only rendering, cached WebGPU text runs, and background worker operations.

## MCP agent control

GitHub Pages hosts the editor, **not a network MCP server**. External MCP clients use the included local companion. The browser app refuses external agent pairing outside localhost.

Start `node mcp/server.mjs`, open its printed URL, and choose **Help → AI Agent Control → Enable Control**. Choose read-only inspection or full document/app control. Authorization is explicit and per tab; access tokens are generated locally, not committed to this repository.

For a stdio MCP client, let the client launch the server instead of running a second process on the same port:

```json
{
  "mcpServers": {
    "notepad-xp": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/NotepadXP/mcp/server.mjs", "--stdio"]
    }
  }
}
```

The companion exposes 24 tools for document reads and edits, revision-checked edit batches, search, selection, view settings, menus/dialogs, metrics, and viewport PNG capture. It supports stdio and JSON-response Streamable HTTP, negotiating MCP 2025-11-25, 2025-06-18, or 2025-03-26. It does not expose arbitrary shell commands or unrestricted filesystem access. Native browser/OS dialogs still require user interaction.

## Build and test

```sh
npm test
npm run build
```

The Node suite contains 46 automated tests covering the text engine, encodings, worker module, MCP transports, and authorization. Building regenerates the dependency-free `NotepadXP.html` from the modular source.

Every push to `main` runs syntax checks, builds the standalone HTML, runs the tests, and deploys the static editor through GitHub Actions. Only `index.html`, `NotepadXP.html`, `src/`, `assets/`, `.nojekyll`, and deployment metadata are included in the Pages artifact. `version.json` identifies the deployed source commit.

## Compatibility and validation limits

This is an independent recreation, not a claim of certified 100% Win32 behavior or pixel parity. Font metrics depend on installed fonts; browser file/printer dialogs differ from XP; mobile touch targets are intentionally adapted. Native system menu options and complex bidirectional caret behavior have limitations.

WebGPU uses Canvas to rasterize newly encountered font runs into atlas tiles, then composites cached text, selection, and caret with the GPU. Check **Help → About Notepad** for the actual renderer and worker status. WebGPU availability depends on browser/device support and the security context; the fallback is intentional.

The original validation included 36 browser checks in a Canvas-fallback environment. That run did not validate WebGPU execution, browser-worker startup, physical-phone IME behavior, or native disk/printer completion. Synthetic CPU text-engine timings are not disk-open times or GPU frame-rate guarantees.

## License

MIT; see [LICENSE](LICENSE). Windows and Notepad are Microsoft trademarks. This project is not affiliated with or endorsed by Microsoft. The repository contains original code and vector assets, not extracted Windows fonts or artwork.
