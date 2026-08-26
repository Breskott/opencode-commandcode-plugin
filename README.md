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

> Use **only one** of them, matching your OpenCode version. They differ in how providers and capabilities are declared; runtime behavior (live `/models` discovery, embedded catalog for vision / cost / reasoning efforts) is the same.

---

## What the plugin does

Command Code is an OpenAI-compatible gateway focused on coding agents. It exposes `GET /provider/v1/models`, and the response carries `id`, `name`, and `context_length` for every model — but **no** `capabilities` (vision, tools, reasoning) and **no** `cost` (per-token pricing).

Both plugins do the same thing:

1. **Discover models live** from `GET https://api.commandcode.ai/provider/v1/models` — `id`, `name`, and `context_length` are taken straight from the API.
2. **Cross-reference each id against an embedded static catalog** (`CATALOG`) that holds the fields the API does not return: `vision`, `reasoning`, and `cost` (per 1M tokens, USD).
3. **Attach reasoning-effort variants** from `REASONING_EFFORTS`, per model id, so reasoning-capable models get a `low / medium / high / xhigh / max` selector.
4. **Register the `commandcode` provider** in OpenCode, with `baseURL` and `apiKey` pointing at Command Code.

End result: every Command Code model shows up in the OpenCode TUI with the right context window (from the API), the right attachment / tools capability (from the catalog + prefix heuristic), real per-1M-token cost (from the catalog), and reasoning-effort variants where the model supports them.

### What changed in this version

Previously the plugins also kept a hardcoded `CONTEXT_WINDOW` / `MAX_OUTPUT` table per model id. That data is now sourced from the live `/models` response (and a small `MAX_OUTPUT` map for the two models where the API does not expose a max output, plus a `DEFAULT_*` pair as last-resort fallback). Reasoning efforts, vision flags, and cost still have to be declared manually because the API does not expose them.

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

Done. The `commandcode` provider appears in the model picker with every Command Code model, the right context window, correct capabilities, and reasoning variants where applicable.

---

## Which file should I use? v1 or v2

| | `commandcode-v1.ts` | `commandcode-v2.ts` |
| --- | --- | --- |
| **OpenCode version** | 1.x (stable) | 2.x (beta) |
| **Import API** | `import type { Config, Plugin } from "@opencode-ai/plugin"` | `import { define, type CatalogDraft } from "@opencode-ai/plugin/v2/promise"` |
| **How the provider is registered** | `config.provider[id] = {...}` directly via the `config` hook | `ctx.catalog.transform(catalog => ...)` |
| **How models reload** | Discovery runs inside `config` (5-minute in-memory cache) | Discovery runs in background + `catalog.reload()` when the list of ids changes |
| **AI SDK package field** | `npm: "@ai-sdk/openai-compatible"` | `package: "aisdk:@ai-sdk/openai-compatible"` (with the `aisdk:` prefix, set both at provider level and at each model level) |
| **Attachment block** | `attachment: true` + `modalities: { input: ["text","image"] }` | `capabilities: { tools, input: ["text","image"], output: ["text"] }` (no `attachment` flag) |
| **`cost` shape** | Object `{ input, output, cache_read, cache_write }` | `ModelCost[]` array of `{ input, output, cache: { read, write } }` |
| **`variants` (reasoning)** | Named object `{ low: { reasoningEffort: "low" }, ... }` | Array `{ id, headers: {}, body: { reasoningEffort } }[]` |
| **`limit.context`** | `model.context_length` from `/models`, falls back to `DEFAULT_CONTEXT_TOKENS` (200k) | Same |
| **`limit.output`** | `MAX_OUTPUT[id]` (2 entries) → `DEFAULT_OUTPUT_TOKENS` (32k) | Same |
| **Blocking API?** | Yes (await inside `config`) | No (transform is sync; discovery runs in background with a 5-minute interval) |
| **Fallback when `/models` fails** | `FALLBACK_MODELS` = `Object.keys(CATALOG)` (ids only, no context_length) | `discovered` stays empty; the provider registers but no model is listed until the next successful refresh |

**TL;DR:** v2 swaps how the provider is declared (uses opencode2's official `catalog` with the `aisdk:` prefix), turns `cost` into an array, drops the `attachment` flag (replaced by `capabilities.input`), and moves discovery off the boot path so the OpenCode startup never blocks on the Command Code API. The data sources (`/models` for ids and context, `CATALOG` for vision / cost, `REASONING_EFFORTS` for variants) are the same in both.

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
2. Edit the `CATALOG` and `REASONING_EFFORTS` tables in your version's file. `MAX_OUTPUT` only needs touching for the rare model whose max output you want to pin (the API does not expose it).
3. Open a PR with the update (compare against the snapshot date in the header comment).

You do **not** need to edit anything for the model list itself or for the context window — both come from `/models` at runtime.

---

## Plugin log messages

Both plugins surface the same diagnostic lines, just routed to different sinks:

- **v1:** `client.app.log` when the `client` is available; falls back to `console.warn` otherwise.
- **v2:** `console.info` / `console.warn`.

You'll see lines like:

```
[commandcode] 58 modelos descobertos (44 com attachment).
[commandcode] 2 model(s) outside catalog snapshot { ids: "new-model-1, new-model-2" }
[commandcode] 1 model(s) without context_length in /models { ids: "..." }
[commandcode] model discovery failed: ...
```

If discovery fails on the first call (v1), the plugin **does not** kill OpenCode — it falls back to the model ids in `CATALOG` and keeps going. On v2 the fallback is to start with an empty model list; the next refresh tick (5 minutes later) will retry.

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
