# Implementation references

Primary references consulted during implementation (accessed 2026-09-08). These support historical behavior and API/protocol choices; they do not certify this project's parity or performance.

- Microsoft, Raymond Chen, “Some files come up strange in Notepad”: https://devblogs.microsoft.com/oldnewthing/20070417-00/?p=27223 — historical Notepad encoding support and heuristics.
- Microsoft Support, “Help in Notepad”: https://support.microsoft.com/en-us/windows/apps/help-in-notepad — print header/footer commands and defaults. Current help is not treated as a complete XP specification.
- Microsoft Learn, “Using Byte Order Marks”: https://learn.microsoft.com/en-us/windows/win32/intl/using-byte-order-marks — UTF byte-order marks.
- WHATWG Encoding, Windows-1252 index: https://encoding.spec.whatwg.org/index-windows-1252.txt — portable legacy character mapping.
- W3C, WebGPU specification: https://www.w3.org/TR/webgpu/ — pipeline, buffer, texture, context, and device model.
- MDN, WebGPU API: https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API — browser integration and secure-context requirements.
- MCP 2025-11-25, Transports: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports — stdio, JSON Streamable HTTP, sessions, Origin checks, and loopback binding.
- MCP 2025-11-25, Lifecycle: https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle — initialize/initialized and version negotiation.
- MCP 2025-11-25, Tools: https://modelcontextprotocol.io/specification/2025-11-25/server/tools — discovery, calls, schemas, and tool-result semantics.

The project intentionally declares its supported MCP revisions instead of calling the pinned 2025 revision “latest.” No proprietary binaries, Windows screenshots, Microsoft artwork, or font files were copied into the application.
