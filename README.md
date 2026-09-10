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

> Use **only one** of them, matching your OpenCode version. They differ in how providers and capabilities are declared; runtime behavior (live `/models` discovery plus a catalog resolved live from the npm package and the models page, with an embedded offline snapshot) is the same.

---

## What the plugin does

Command Code is an OpenAI-compatible gateway focused on coding agents. It exposes `GET /provider/v1/models`, and the response carries `id`, `name`, and `context_length` for every model — but **no** `capabilities` (vision, tools, reasoning) and **no** `cost` (per-token pricing).

Both plugins do the same thing:

1. **Discover models live** from `GET https://api.commandcode.ai/provider/v1/models` — `id`, `name`, and `context_length` are taken straight from the API.
2. **Resolve the rest of the catalog at runtime** from what Command Code itself publishes:
   - **`models.md` shipped inside the [`command-code`](https://www.npmjs.com/package/command-code) npm package** — reasoning efforts, pricing, context window, and display names. The latest version is resolved via the npm registry and the file is served by unpkg, with jsdelivr as fallback.
   - **<https://commandcode.ai/models>** — the `Vision` / `Reasoning` capabilities per model.
   - Both are cached on disk for 6 hours (`~/.cache/opencode/commandcode-catalog.json`, honors `XDG_CACHE_HOME`), so restarts do not re-hit the network.
3. **Enrich each model with that data**: real per-1M-token cost, attachment capability (vision), and reasoning-effort variants (`low / medium / high / xhigh / max` where the model supports them).
4. **Register the `commandcode` provider** in OpenCode, with `baseURL` and `apiKey` pointing at Command Code.

End result: every Command Code model shows up in the OpenCode TUI with the right context window (from the API), fresh catalog metadata (efforts / cost / vision) resolved without editing the plugin, and reasoning-effort variants where the model supports them.

### What changed in this version

Earlier versions shipped vision / cost / efforts as a hardcoded snapshot that had to be edited by hand whenever Command Code changed something. That snapshot is now a **fallback only**: the plugin resolves the catalog at runtime from the npm package and the models page, so new models, price changes, and capability fixes propagate automatically. Offline, the fallback chain is: last disk cache → embedded `CATALOG` snapshot.

`CONTEXT_WINDOW` no longer exists either — context comes from the live `/models` response. A small `MAX_OUTPUT` map plus a `DEFAULT_*` pair remain as last-resort values because neither the API nor the docs expose a max-output cap.

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
| **How models reload** | Discovery runs inside `config` (5-minute in-memory cache) | Discovery runs in background + `catalog.reload()` when the enriched model list changes |
| **Catalog resolution** | Live: `models.md` from the `command-code` npm package + capabilities from `commandcode.ai/models`, cached on disk for 6 hours | Same |
| **AI SDK package field** | `npm: "@ai-sdk/openai-compatible"` | `package: "aisdk:@ai-sdk/openai-compatible"` (with the `aisdk:` prefix, set both at provider level and at each model level) |
| **Attachment block** | `attachment: true` + `modalities: { input: ["text","image"] }` | `capabilities: { tools, input: ["text","image"], output: ["text"] }` (no `attachment` flag) |
| **`cost` shape** | Object `{ input, output, cache_read, cache_write }` | `ModelCost[]` array of `{ input, output, cache: { read, write } }` |
| **`variants` (reasoning)** | Named object `{ low: { reasoningEffort: "low" }, ... }` | Array `{ id, headers: {}, body: { reasoningEffort } }[]` |
| **`limit.context`** | `model.context_length` from `/models`, falls back to `DEFAULT_CONTEXT_TOKENS` (200k) | Same |
| **`limit.output`** | `MAX_OUTPUT[id]` (small map) → `DEFAULT_OUTPUT_TOKENS` (32k) | Same |
| **Blocking API?** | Yes (await inside `config`) | No (transform is sync; discovery runs in background with a 5-minute interval) |
| **Fallback when `/models` fails** | `FALLBACK_MODELS` = `Object.keys(CATALOG)` (ids only, no context_length). Catalog failure chain: stale disk cache → embedded `CATALOG` snapshot | `discovered` stays empty; the provider registers but no model is listed until the next successful refresh. Catalog failure chain is the same as v1 |

**TL;DR:** v2 swaps how the provider is declared (uses opencode2's official `catalog` with the `aisdk:` prefix), turns `cost` into an array, drops the `attachment` flag (replaced by `capabilities.input`), and moves discovery off the boot path so the OpenCode startup never blocks on the Command Code API. The data sources (`/models` for ids and context; live npm `models.md` + `commandcode.ai/models` for efforts / cost / vision, with `CATALOG` as offline fallback) are the same in both.

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

Both versions accept `{ input?: Modality[], tool_call?: boolean, reasoning?: boolean }`.

The decision cascade is:

1. `MODEL_OVERRIDES[id]` (your manual override — always wins)
2. Remote catalog (capabilities from <https://commandcode.ai/models>; efforts / cost / names from the npm `models.md`)
3. `CATALOG[id]` (embedded offline snapshot)
4. Id prefix (heuristic for new models with no remote or embedded data)

Models that fall to tier 4 enter with conservative defaults (text-only, `$0.00` cost) and trigger a log warning: `N modelo(s) fora do snapshot do catalogo`. Reasoning efforts follow the same order; a model with no known efforts gets no variant selector (the model decides), except unknown ids in v2, which get the generic `low / medium / high`.

---

## Updating the catalog

You normally don't need to. New models, price changes, and capability fixes are picked up automatically from the npm `models.md` and the models page within the 6-hour cache window.

To force an immediate refresh, delete the disk cache (`~/.cache/opencode/commandcode-catalog.json`) and restart OpenCode.

Edit the embedded snapshot only when:

1. You want the offline fallback to be current — update `CATALOG` and `REASONING_EFFORTS` from <https://commandcode.ai/models> and the npm `models.md`, and bump the snapshot date/version in the header comment.
2. A model's max output needs pinning — add it to `MAX_OUTPUT` (neither the API nor the docs expose it).
3. You need to force a capability right now — use `MODEL_OVERRIDES` instead of touching the snapshot.

Open a PR if you update the snapshot.

---

## Plugin log messages

Both plugins surface the same diagnostic lines, just routed to different sinks:

- **v1:** `client.app.log` when the `client` is available; falls back to `console.warn` otherwise.
- **v2:** `console.info` / `console.warn`.

You'll see lines like:

```
[commandcode] catalogo remoto 1.53.0: 70 modelos, 70 capabilities.
[commandcode] 70 modelos descobertos (50 com attachment).
[commandcode] 2 modelo(s) fora do snapshot do catalogo { ids: "new-model-1, new-model-2" }
[commandcode] 1 modelo(s) sem context_length na API { ids: "..." }
[commandcode] catalogo remoto indisponivel; mantendo ultimo cache.
[commandcode] descoberta de modelos falhou, usando snapshot estatico { error: ... }
```

If discovery fails on the first call (v1), the plugin **does not** kill OpenCode — it falls back to the model ids in `CATALOG` and keeps going. On v2 the fallback is to start with an empty model list; the next refresh tick (5 minutes later) will retry. If only the remote catalog is unreachable, the plugin keeps the last disk cache (or the embedded snapshot) and the `catalogo remoto indisponivel` warning appears.

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
