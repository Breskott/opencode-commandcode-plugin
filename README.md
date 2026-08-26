# opencode-commandcode-plugin

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![OpenCode](https://img.shields.io/badge/OpenCode-1.x%20%7C%202.x%20(beta)-blueviolet)](https://opencode.ai)
[![Command Code](https://img.shields.io/badge/Provider-Command%20Code-00A86B)](https://commandcode.ai)

> 🇧🇷 **[Versão em Português (Brasil)](README.pt-BR.md)**

Plugins that wire the [Command Code](https://commandcode.ai) gateway into [OpenCode](https://opencode.ai) as a first-class provider.

This repo ships **two plugins** — one for each OpenCode major:

| File | OpenCode | Status |
| --- | --- | --- |
| `commandcode-v1.ts` | **v1** (stable) | Use with OpenCode 1.x |
| `commandcode-v2.ts` | **v2** (beta) | Use with OpenCode 2.x (beta) |

> Use **only one** of them, matching your OpenCode version. They share the same static model catalog (58 models, snapshot 2026-08-25), but the way providers and capabilities are described changed between v1 and v2.

---

## What the plugin does

Command Code is an OpenAI-compatible gateway focused on coding agents. It exposes `GET /provider/v1/models`, but the response only carries `id`, `name`, and `context_length` — there is **no** `capabilities` (vision, tools, reasoning) and **no** `cost` (per-token pricing).

Both plugins do the same thing:

1. Discover the model list via `GET https://api.commandcode.ai/provider/v1/models` (5-minute in-memory cache).
2. Cross-reference each id against an **embedded static catalog** (capabilities + price + context window + max output + reasoning efforts) and fill in what the API does not return.
3. Register the `commandcode` provider in OpenCode, with `baseURL` and `apiKey` pointing at Command Code.

End result: every Command Code model shows up in the OpenCode TUI with correct attachment capability, real per-1M-token cost, and a reasoning-effort selector (low / medium / high / xhigh / max) where the model supports it.

---

## Requirements

- Node.js + TypeScript (or Bun / Deno — anything your OpenCode setup runs)
- A Command Code account with an API key
- OpenCode installed

---

## Installation (Windows / PowerShell)

### 1. Set `CMD_API_KEY` in the **User** scope (recommended)

The **User** scope keeps the key restricted to your Windows account — it does not leak to other users on the machine and does not require admin.

```powershell
$env:CMD_API_KEY = Read-Host "CMD_API_KEY" -MaskInput
[Environment]::SetEnvironmentVariable("CMD_API_KEY", $env:CMD_API_KEY, "User")
```

Open a new terminal afterwards so the variable loads into fresh sessions. Verify with:

```powershell
[Environment]::GetEnvironmentVariable("CMD_API_KEY", "User")
```

> **Other scopes (optional):**
> - `Process` — current PowerShell session only (`$env:CMD_API_KEY = "..."`). Disappears when the window closes.
> - `Machine` — all users on the PC. Requires an elevated PowerShell: `[Environment]::SetEnvironmentVariable("CMD_API_KEY", "...", "Machine")`. Only use this if the machine is yours or if other users will also run OpenCode with Command Code.

### 2. Drop the plugin into `~/.config/opencode/plugin/`

Download the file that matches your OpenCode version:

- v1 → download `commandcode-v1.ts`
- v2 → download `commandcode-v2.ts`

Place it in:

- **Windows:** `%USERPROFILE%\.config\opencode\plugin\`
- **Linux / macOS:** `~/.config/opencode/plugin/`

OpenCode auto-loads every `.ts` / `.js` in that directory.

### 3. Restart OpenCode

Done. The `commandcode` provider appears in the model picker with every Command Code model, correct capabilities, and reasoning variants where applicable.

---

## Which file should I use? v1 or v2

| | `commandcode-v1.ts` | `commandcode-v2.ts` |
| --- | --- | --- |
| **OpenCode version** | 1.x (stable) | 2.x (beta) |
| **Import API** | `import type { Config, Plugin } from "@opencode-ai/plugin"` | `import { define, type CatalogDraft } from "@opencode-ai/plugin/v2/promise"` |
| **How the provider is registered** | `config.provider[id] = {...}` directly via the `config` hook | `ctx.catalog.transform(catalog => ...)` |
| **How models reload** | Discovery runs inside `config` (in-memory cache) | Discovery runs in background + `catalog.reload()` when the list changes |
| **AI SDK package field** | `npm: "@ai-sdk/openai-compatible"` | `package: "aisdk:@ai-sdk/openai-compatible"` (with the `aisdk:` prefix) |
| **Attachment block** | `attachment: true` + `modalities: { input: ["text","image"] }` | `capabilities: { tools, input: ["text","image"], output: ["text"] }` (no `attachment` flag) |
| **`cost` shape** | Object `{ input, output, cache_read, cache_write }` | `ModelCost[]` array of `{ input, output, cache: { read, write } }` |
| **`variants` (reasoning)** | Named object `{ low: { reasoningEffort: "low" }, ... }` | Array `{ id, headers: {}, body: { reasoningEffort } }[]` |
| **`limit`** | Requires both `context` AND `output` | `context` required; `output` falls back to the default if absent |
| **Blocking API?** | Yes (await inside `config`) | No (transform is sync; discovery runs in background) |

**TL;DR:** v2 swaps how the provider is declared (uses opencode2's official `catalog` with the `aisdk:` prefix), turns `cost` into an array, and drops the `attachment` flag (replaced by `capabilities.input`). Runtime behavior (models, caching, capabilities, static fallback) is identical.

---

## How the API key is read

Both plugins read the key from `process.env.CMD_API_KEY`. **There is no `npm install`, no `dotenv`, no `opencode.json` involved** — set the variable and restart OpenCode.

If `CMD_API_KEY` is missing, the plugin just logs a warning (`provider not loaded`) and moves on. OpenCode does not crash.

---

## Customization

Both plugins expose a `MODEL_OVERRIDES` block at the top so you can force capabilities for a specific model without editing the catalog:

```ts
const MODEL_OVERRIDES = {
  // "MiniMaxAI/MiniMax-M3": { input: ["text", "image"] },
}
```

In v2 the override accepts `{ input?: Modality[], tool_call?: boolean }`. In v1 it also accepts `reasoning?: boolean`.

The decision cascade is:

1. `MODEL_OVERRIDES[id]` (your manual override — always wins)
2. `CATALOG[id]` (embedded static snapshot)
3. Id prefix (heuristic for new models Command Code launched after the snapshot)

Models that fall to tier 3 enter with conservative defaults (text-only, no reasoning, `$0.00` cost) and trigger a log warning: `N model(s) outside catalog snapshot`.

---

## Updating the catalog

When Command Code adds new models or changes pricing / capabilities:

1. Check the official list at <https://commandcode.ai/models>.
2. Edit the `CATALOG`, `CONTEXT_WINDOW`, `MAX_OUTPUT`, and `REASONING_EFFORTS` tables in your version's file.
3. Open a PR with the update (compare against the snapshot date in the header comment).

---

## Plugin log messages

Both plugins use `client.app.log` when the `client` is available (v1) or `console.info` / `console.warn` (v2). You'll see lines like:

```
[commandcode] 58 models discovered (44 with attachment).
[commandcode] 2 model(s) outside catalog snapshot { ids: "new-model-1, new-model-2" }
[commandcode] model discovery failed: ...
```

If discovery fails (network down, bad key), the plugin **does not** kill OpenCode — it falls back to the embedded static snapshot and keeps going.

---

## Compatibility

- **OpenCode 1.x** → use `commandcode-v1.ts`.
- **OpenCode 2.x (beta)** → use `commandcode-v2.ts`.
- Cross-mixing (v1 plugin on OpenCode 2, or v2 plugin on OpenCode 1) **does not work** — the `Config` / `Plugin` / `define` / `CatalogDraft` types are incompatible.

---

## Credits

- Provider: [Command Code](https://commandcode.ai) — OpenAI-compatible gateway focused on coding agents.
- Client: [OpenCode](https://opencode.ai) — open-source AI coding agent.
- Maintained by **Victor Brescott** ([@Breskott](https://github.com/Breskott)).
- License: MIT — use freely.