import { define, type CatalogDraft } from "@opencode-ai/plugin/v2/promise"
import { promises as fs } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

declare const process: { env: Record<string, string | undefined> }

const PROVIDER_ID = "commandcode"
const PROVIDER_NAME = "Command Code"
const BASE_URL = "https://api.commandcode.ai/provider/v1"
// Pacote AI SDK para endpoints compativeis com OpenAI.
// O provider e os modelos precisam declarar `type: "aisdk"` com este `package`.
// O ModelResolver do opencode2 valida o package com `isAISDK()`, que exige o
// prefixo literal "aisdk:" (`package.startsWith("aisdk:")`). Sem o prefixo ele
// lanca `UnsupportedPackageError` e a sessao "trava" sem responder — mesmo
// sintoma de usar `type: "native"`, que aponta para um provider nativo
// inexistente chamado "commandcode".
const AISDK_PACKAGE = "aisdk:@ai-sdk/openai-compatible"
const REFRESH_MS = 5 * 60 * 1000
const REQUEST_TIMEOUT_MS = 15_000
// Menor que o da API: catalogo remoto e enriquecimento, nao pode segurar o
// startup offline por muito tempo.
const REMOTE_TIMEOUT_MS = 8_000

// ---------------------------------------------------------------------------
// CATALOGO REMOTO (auto-atualizacao), igual ao commandcode-v1. A Command Code
// publica o catalogo completo (id, nome, contexto, efforts, precos e descricao)
// dentro do pacote npm `command-code`, em
// dist/bundled/command-code-knowledge/reference/models.md. A pagina
// https://commandcode.ai/models expoe as capabilities (Vision / Reasoning) por
// modelo. O plugin busca os dois em runtime -- npm registry para a versao, CDN
// para o markdown e o site para as capabilities -- com cache de REMOTE_TTL_MS
// em disco. As tabelas estaticas abaixo sao so o fallback offline: quando o
// remoto responde, ele vence.
// ---------------------------------------------------------------------------
const CATALOG_PACKAGE = "command-code"
const CATALOG_MD_PATH = "dist/bundled/command-code-knowledge/reference/models.md"
const REGISTRY_URL = `https://registry.npmjs.org/${CATALOG_PACKAGE}/latest`
const MODELS_PAGE_URL = "https://commandcode.ai/models"
const CDN_BASES = ["https://unpkg.com", "https://cdn.jsdelivr.net/npm"] as const
const REMOTE_TTL_MS = 6 * 60 * 60 * 1000

type Modality = "text" | "image"

// Recorte do models.md que interessa ao provider. `visionHint` e um palpite
// barato extraido da coluna "Best for"; a capability real vem do site.
export interface RemoteModelSpec {
  name?: string
  context?: number
  efforts?: string[]
  cost?: CostSpec
  visionHint?: boolean
}

export interface ModelCapabilities {
  vision?: boolean
  reasoning?: boolean
}

export interface RemoteCatalog {
  version?: string
  fetchedAt: number
  catalog: Record<string, RemoteModelSpec>
  caps: Record<string, ModelCapabilities>
}

// Fallback SO para modelos DESCONHECIDOS (fora do CATALOG e do catalogo remoto)
// que a Command Code lancar: entram com os niveis universais de reasoning em vez
// de ficar sem seletor. Modelo conhecido usa exatamente os efforts do ground
// truth (catalogo remoto > REASONING_EFFORTS); quem nao tem efforts e "auto"/
// nao-reasoning e fica SEM variant (o modelo decide), como no CLI oficial.
const DEFAULT_EFFORTS: readonly string[] = ["low", "medium", "high"]

// Ultimo recurso. O /models devolve context_length para todos os modelos, entao
// DEFAULT_CONTEXT_TOKENS so entra em cena se a API mudar de shape ou se o
// provider subir pelo fallback offline (que so tem os ids).
const DEFAULT_CONTEXT_TOKENS = 200_000
const DEFAULT_OUTPUT_TOKENS = 32_000

// ---------------------------------------------------------------------------
// CATALOGO ESTATICO (fallback offline): capabilities (visao), reasoning e preco.
// Portado do commandcode.v1. O endpoint /models da Command Code so devolve id,
// name e context_length — nem custo nem capability vem em runtime. O catalogo
// remoto cobre o caso normal; esta tabela cobre offline.
// Snapshot de 70 modelos verificado em 10/09/2026 contra command-code@1.53.0.
//
// DIFERENCA v1 -> v2:
//   - No v1 `cost` era um objeto e `attachment`/`modalities` campos soltos.
//   - No v2 (ModelV2Info) `cost` e um ARRAY (ModelCost[]) e a modalidade de
//     entrada (texto/imagem) vive em `capabilities.input`. Nao existe flag
//     `attachment`: o opencode2 libera o anexo de imagem quando
//     `capabilities.input` inclui "image".
//
// `cost` segue a convencao do opencode: USD por 1 MILHAO de tokens. Modelo novo
// fora do snapshot entra com custo 0 (aparece como $0.00 na TUI) e sem visao,
// a menos que o prefixo do id bata em VISION_PREFIXES.
// ---------------------------------------------------------------------------
type CostSpec = { input: number; output: number; cache_read?: number; cache_write?: number }
type ModelSpec = { vision: boolean; reasoning: boolean; cost: CostSpec }

const CATALOG: Readonly<Record<string, ModelSpec>> = {
  "claude-fable-5": { vision: true, reasoning: true, cost: { input: 10.0, output: 50.0, cache_read: 1.0, cache_write: 12.5 } },
  "claude-fable-5-1": { vision: true, reasoning: true, cost: { input: 10.0, output: 50.0, cache_read: 0.25, cache_write: 12.5 } },
  "claude-haiku-4-5-20251001": { vision: true, reasoning: false, cost: { input: 1.0, output: 5.0, cache_read: 0.1, cache_write: 1.25 } },
  "claude-opus-4-7": { vision: true, reasoning: true, cost: { input: 5.0, output: 25.0, cache_read: 0.5, cache_write: 6.25 } },
  "claude-opus-4-8": { vision: true, reasoning: true, cost: { input: 5.0, output: 25.0, cache_read: 0.5, cache_write: 6.25 } },
  "claude-opus-5": { vision: true, reasoning: true, cost: { input: 5.0, output: 25.0, cache_read: 0.5, cache_write: 6.25 } },
  "claude-sonnet-4-6": { vision: true, reasoning: true, cost: { input: 3.0, output: 15.0, cache_read: 0.3, cache_write: 3.75 } },
  "claude-sonnet-5": { vision: true, reasoning: true, cost: { input: 2.0, output: 10.0, cache_read: 0.2, cache_write: 2.5 } },
  "deepseek/deepseek-v4-flash": { vision: false, reasoning: true, cost: { input: 0.15, output: 0.6, cache_read: 0.003 } },
  "deepseek/deepseek-v4-flash-fast": { vision: false, reasoning: true, cost: { input: 0.28, output: 0.56, cache_read: 0.07 } },
  "deepseek/deepseek-v4-flash-vision-exp": { vision: true, reasoning: true, cost: { input: 0.22, output: 0.66, cache_read: 0.007 } },
  "deepseek/deepseek-v4-pro": { vision: false, reasoning: true, cost: { input: 0.66, output: 1.98, cache_read: 0.022 } },
  "deepseek/deepseek-v4.1-flash": { vision: true, reasoning: true, cost: { input: 0.15, output: 0.6, cache_read: 0.003 } },
  "google/gemini-3.1-flash-lite": { vision: true, reasoning: true, cost: { input: 0.25, output: 1.5, cache_read: 0.03 } },
  "google/gemini-3.5-flash": { vision: true, reasoning: true, cost: { input: 1.5, output: 9.0, cache_read: 0.15 } },
  "google/gemini-3.5-flash-lite": { vision: true, reasoning: true, cost: { input: 0.3, output: 2.5, cache_read: 0.03 } },
  "google/gemini-3.6-flash": { vision: true, reasoning: true, cost: { input: 1.5, output: 7.5, cache_read: 0.15 } },
  "google/gemini-3.7-flash": { vision: true, reasoning: true, cost: { input: 1.5, output: 7.5, cache_read: 0.15, cache_write: 0.08334 } },
  "google/gemini-3.8-flash": { vision: true, reasoning: true, cost: { input: 1.5, output: 7.5, cache_read: 0.15 } },
  "gpt-5.3-codex": { vision: true, reasoning: true, cost: { input: 2.0, output: 8.0, cache_read: 0.5 } },
  "gpt-5.4": { vision: true, reasoning: true, cost: { input: 2.5, output: 15.0, cache_read: 0.25 } },
  "gpt-5.4-mini": { vision: true, reasoning: true, cost: { input: 0.75, output: 4.5, cache_read: 0.075 } },
  "gpt-5.5": { vision: true, reasoning: true, cost: { input: 5.0, output: 30.0, cache_read: 0.5 } },
  "gpt-5.6-luna": { vision: true, reasoning: true, cost: { input: 0.2, output: 1.2, cache_read: 0.02, cache_write: 0.25 } },
  "gpt-5.6-sol": { vision: true, reasoning: true, cost: { input: 5.0, output: 30.0, cache_read: 0.5, cache_write: 6.25 } },
  "gpt-5.6-terra": { vision: true, reasoning: true, cost: { input: 2.0, output: 12.0, cache_read: 0.2, cache_write: 2.5 } },
  "gpt-6-astra": { vision: true, reasoning: true, cost: { input: 10.0, output: 50.0, cache_read: 1.0, cache_write: 12.5 } },
  "inclusionai/ling-3.0-flash-sante:free": { vision: false, reasoning: true, cost: { input: 0.0, output: 0.0, cache_read: 0.0 } },
  "meituan/LongCat-2.0:free": { vision: false, reasoning: true, cost: { input: 0.0, output: 0.0, cache_read: 0.0 } },
  "meta/muse-spark-1.1": { vision: true, reasoning: true, cost: { input: 1.25, output: 4.25, cache_read: 0.15 } },
  "meta/muse-spark-1.2": { vision: true, reasoning: true, cost: { input: 1.25, output: 4.25, cache_read: 0.15 } },
  "meta/muse-spark-1.2-contributor": { vision: true, reasoning: true, cost: { input: 0.1, output: 0.2, cache_read: 0.002 } },
  "meta/muse-spark-1.3": { vision: true, reasoning: true, cost: { input: 1.25, output: 4.25, cache_read: 0.15 } },
  "meta/muse-spark-1.3-contributor": { vision: true, reasoning: true, cost: { input: 0.1, output: 0.2, cache_read: 0.002 } },
  "MiniMaxAI/MiniMax-M2.5": { vision: false, reasoning: false, cost: { input: 0.3, output: 1.2, cache_read: 0.03 } },
  "MiniMaxAI/MiniMax-M2.7": { vision: false, reasoning: false, cost: { input: 0.3, output: 1.2, cache_read: 0.06 } },
  "MiniMaxAI/MiniMax-M3": { vision: true, reasoning: true, cost: { input: 0.3, output: 1.2, cache_read: 0.06 } },
  "moonshotai/Kimi-K2.5": { vision: true, reasoning: false, cost: { input: 0.6, output: 3.0, cache_read: 0.1 } },
  "moonshotai/Kimi-K2.6": { vision: true, reasoning: false, cost: { input: 0.95, output: 4.0, cache_read: 0.16 } },
  "moonshotai/Kimi-K2.7-Code": { vision: true, reasoning: true, cost: { input: 0.95, output: 4.0, cache_read: 0.19 } },
  "moonshotai/Kimi-K2.7-Code-Highspeed": { vision: true, reasoning: true, cost: { input: 1.9, output: 8.0, cache_read: 0.38 } },
  "moonshotai/Kimi-K3": { vision: true, reasoning: true, cost: { input: 3.0, output: 15.0, cache_read: 0.3 } },
  "nvidia/nemotron-3-ultra-550b-a55b": { vision: false, reasoning: true, cost: { input: 0.6, output: 2.4, cache_read: 0.12 } },
  "poolside/laguna-s-2.1-free": { vision: false, reasoning: true, cost: { input: 0.0, output: 0.0, cache_read: 0.0 } },
  "Qwen/Qwen3.6-Max-Preview": { vision: false, reasoning: true, cost: { input: 1.3, output: 7.8, cache_read: 0.26, cache_write: 1.63 } },
  "Qwen/Qwen3.6-Plus": { vision: true, reasoning: true, cost: { input: 0.5, output: 3.0, cache_read: 0.1 } },
  "Qwen/Qwen3.7-Flash": { vision: true, reasoning: true, cost: { input: 0.03, output: 0.13, cache_read: 0.006, cache_write: 0.038 } },
  "Qwen/Qwen3.7-Max": { vision: false, reasoning: true, cost: { input: 2.5, output: 7.5, cache_read: 0.5, cache_write: 3.13 } },
  "Qwen/Qwen3.7-Plus": { vision: true, reasoning: true, cost: { input: 0.4, output: 1.6, cache_read: 0.08, cache_write: 0.5 } },
  "Qwen/Qwen3.8-27B": { vision: true, reasoning: true, cost: { input: 0.4, output: 3.0, cache_read: 0.04 } },
  "Qwen/Qwen3.8-Flash": { vision: true, reasoning: true, cost: { input: 0.16, output: 0.47, cache_read: 0.016 } },
  "Qwen/Qwen3.8-Max": { vision: true, reasoning: true, cost: { input: 2.0, output: 6.0, cache_read: 0.25, cache_write: 2.5 } },
  "Qwen/Qwen3.8-Max-0902": { vision: true, reasoning: true, cost: { input: 2.0, output: 6.0, cache_read: 0.25 } },
  "sakana/fugu-ultra": { vision: true, reasoning: true, cost: { input: 5.0, output: 30.0, cache_read: 0.5 } },
  "stepfun/Step-3.5-Flash": { vision: false, reasoning: true, cost: { input: 0.1, output: 0.3, cache_read: 0.02 } },
  "stepfun/Step-3.7-Flash": { vision: true, reasoning: true, cost: { input: 0.2, output: 1.15, cache_read: 0.04 } },
  "tencent/hy3-paid": { vision: false, reasoning: true, cost: { input: 0.14, output: 0.58, cache_read: 0.035 } },
  "tencent/hy4-preview": { vision: false, reasoning: true, cost: { input: 0.834, output: 2.501, cache_read: 0.042 } },
  "thinkingmachines/inkling": { vision: true, reasoning: true, cost: { input: 1.0, output: 4.05, cache_read: 0.17 } },
  "thinkingmachines/inkling-small": { vision: true, reasoning: true, cost: { input: 0.5, output: 1.2, cache_read: 0.1 } },
  "xai/grok-4.5": { vision: true, reasoning: true, cost: { input: 2.0, output: 6.0, cache_read: 0.5 } },
  "xai/grok-4.6": { vision: true, reasoning: true, cost: { input: 2.0, output: 6.0, cache_read: 0.5 } },
  "xiaomi/mimo-v2.5": { vision: true, reasoning: false, cost: { input: 0.14, output: 0.28, cache_read: 0.0028 } },
  "xiaomi/mimo-v2.5-pro": { vision: false, reasoning: false, cost: { input: 0.435, output: 0.87, cache_read: 0.0036 } },
  "z-ai/glm-5.3-flash": { vision: true, reasoning: true, cost: { input: 0.15, output: 0.5, cache_read: 0.03 } },
  "zai-org/GLM-5": { vision: false, reasoning: false, cost: { input: 1.0, output: 3.2, cache_read: 0.2 } },
  "zai-org/GLM-5.1": { vision: false, reasoning: false, cost: { input: 1.4, output: 4.4, cache_read: 0.26 } },
  "zai-org/GLM-5.2": { vision: false, reasoning: true, cost: { input: 1.4, output: 4.4, cache_read: 0.26 } },
  "zai-org/GLM-5.2-Fast": { vision: false, reasoning: false, cost: { input: 3.0, output: 10.25, cache_read: 0.5 } },
  "zai-org/GLM-5.3": { vision: false, reasoning: true, cost: { input: 1.4, output: 4.4, cache_read: 0.26 } },
}

// maxOutput conhecido do snapshot. O /models da Command Code NAO devolve output
// e nem o site publica cap por modelo, entao o resto usa DEFAULT_OUTPUT_TOKENS.
const MAX_OUTPUT: Readonly<Record<string, number>> = {
  "claude-fable-5-1": 128_000,
  "gpt-6-astra": 128_000,
  "Qwen/Qwen3.8-27B": 32_768,
  "poolside/laguna-s-2.1-free": 32_768,
  "z-ai/glm-5.3-flash": 131_072,
}

// Rede de seguranca para ids que ainda nao entraram em CATALOG nem no catalogo
// remoto (novo modelo cuja descricao nao cita vision).
const VISION_PREFIXES: readonly string[] = [
  "claude-",
  "gpt-5",
  "gpt-6",
  "google/gemini",
  "moonshotai/kimi",
  "meta/muse-spark",
  "thinkingmachines/inkling",
]

// Force bruto: ganha de tudo, inclusive do catalogo remoto. Use quando a
// Command Code mudar uma capability e voce nao quiser esperar o cache/TTL.
const MODEL_OVERRIDES: Readonly<Record<string, { input?: Modality[]; tool_call?: boolean; reasoning?: boolean }>> = {
  // "MiniMaxAI/MiniMax-M3": { input: ["text", "image"] },
}

const REASONING_EFFORTS: Readonly<Record<string, readonly string[]>> = {
  "Qwen/Qwen3.8-27B": ["low", "medium", "xhigh"],
  "Qwen/Qwen3.8-Flash": ["low", "medium", "xhigh"],
  "Qwen/Qwen3.8-Max": ["low", "medium", "xhigh"],
  "Qwen/Qwen3.8-Max-0902": ["low", "medium", "xhigh"],
  "claude-fable-5": ["low", "medium", "high", "xhigh", "max"],
  "claude-fable-5-1": ["low", "medium", "high", "xhigh", "max"],
  "claude-opus-4-7": ["low", "medium", "high", "xhigh", "max"],
  "claude-opus-4-8": ["low", "medium", "high", "xhigh", "max"],
  "claude-opus-5": ["low", "medium", "high", "xhigh", "max"],
  "claude-sonnet-4-6": ["low", "medium", "high", "xhigh", "max"],
  "claude-sonnet-5": ["low", "medium", "high", "xhigh", "max"],
  "deepseek/deepseek-v4-flash": ["high", "max"],
  "deepseek/deepseek-v4-flash-fast": ["low", "high", "max"],
  "deepseek/deepseek-v4-flash-vision-exp": ["high", "max"],
  "deepseek/deepseek-v4-pro": ["high", "max"],
  "deepseek/deepseek-v4.1-flash": ["low", "high", "max"],
  "google/gemini-3.1-flash-lite": ["low", "medium", "high"],
  "google/gemini-3.5-flash": ["low", "medium", "high"],
  "google/gemini-3.5-flash-lite": ["low", "medium", "high"],
  "google/gemini-3.6-flash": ["low", "medium", "high"],
  "google/gemini-3.7-flash": ["low", "medium", "high"],
  "google/gemini-3.8-flash": ["low", "medium", "high"],
  "gpt-5.3-codex": ["low", "medium", "high", "xhigh"],
  "gpt-5.4": ["low", "medium", "high", "xhigh"],
  "gpt-5.4-mini": ["low", "medium", "high"],
  "gpt-5.5": ["low", "medium", "high", "xhigh"],
  "gpt-5.6-luna": ["low", "medium", "high", "xhigh", "max"],
  "gpt-5.6-sol": ["low", "medium", "high", "xhigh", "max"],
  "gpt-5.6-terra": ["low", "medium", "high", "xhigh", "max"],
  "gpt-6-astra": ["low", "medium", "high", "xhigh", "max"],
  "meta/muse-spark-1.1": ["low", "medium", "high", "xhigh"],
  "meta/muse-spark-1.2": ["low", "medium", "high", "xhigh"],
  "meta/muse-spark-1.2-contributor": ["low", "medium", "high", "xhigh"],
  "meta/muse-spark-1.3": ["low", "medium", "high", "xhigh", "max"],
  "meta/muse-spark-1.3-contributor": ["low", "medium", "high", "xhigh"],
  "moonshotai/Kimi-K3": ["low", "high", "max"],
  "sakana/fugu-ultra": ["high", "xhigh"],
  "tencent/hy4-preview": ["low", "medium", "high"],
  "xai/grok-4.5": ["low", "medium", "high"],
  "xai/grok-4.6": ["low", "medium", "high", "xhigh"],
  "z-ai/glm-5.3-flash": ["low", "high", "max"],
  "zai-org/GLM-5.2": ["high", "max"],
  "zai-org/GLM-5.3": ["low", "high", "max"],
}

/**
 * Nome de exibicao. Modelo cujo id contem "free" (ex: poolside/laguna-s-2.1-free)
 * ganha o sufixo " Free", ja que a API manda o nome limpo ("Laguna S 2.1") e nao
 * da para distinguir gratuito de pago na lista da TUI. Idempotente: se a Command
 * Code passar a mandar "Free" no proprio nome, nao duplica.
 */
function displayName(model: CommandCodeModel): string {
  const base = model.name ?? model.id
  const isFree = /(^|[^a-z])free([^a-z]|$)/i.test(model.id)
  if (!isFree || /(^|\s)free(\s|$)/i.test(base)) return base
  return `${base} Free`
}

/**
 * Cascata, do mais confiavel para o menos:
 *   1. MODEL_OVERRIDES (force manual)
 *   2. capability do site / snapshot do catalogo (ja resolvidos no merge)
 *   3. prefixo do id (modelo novo, ainda sem dado remoto)
 */
function inputModalities(model: CommandCodeModel): Modality[] {
  const override = MODEL_OVERRIDES[model.id]?.input
  if (override && override.length > 0) return [...new Set<Modality>(["text", ...override])]

  const vision = model.vision ?? CATALOG[model.id]?.vision
  if (vision !== undefined) return vision ? ["text", "image"] : ["text"]

  const id = model.id.toLowerCase()
  return VISION_PREFIXES.some((prefix) => id.startsWith(prefix)) ? ["text", "image"] : ["text"]
}

// A Command Code e um gateway focado em coding agents: tool call e universal.
function supportsTools(model: CommandCodeModel): boolean {
  return MODEL_OVERRIDES[model.id]?.tool_call ?? true
}

/**
 * Efforts, do mais confiavel para o menos:
 *   1. MODEL_OVERRIDES.reasoning === false zera; === true forca DEFAULT_EFFORTS
 *   2. catalogo remoto (efforts do models.md)
 *   3. REASONING_EFFORTS estatico
 *   4. fallback: conhecido do CATALOG = sem variant (o modelo decide);
 *      desconhecido = DEFAULT_EFFORTS (niveis universais)
 */
function effortsOf(model: CommandCodeModel): readonly string[] {
  const override = MODEL_OVERRIDES[model.id]?.reasoning
  if (override === false) return []
  if (model.efforts !== undefined) return model.efforts
  const known = REASONING_EFFORTS[model.id]
  if (known) return known
  if (CATALOG[model.id] !== undefined && override !== true) return []
  return DEFAULT_EFFORTS
}

// Converte o custo (remoto ou do snapshot) para o shape v2 (ModelCost[]).
// Modelo desconhecido entra com custo 0 (aparece como $0.00 na TUI ate o
// catalogo remoto cobrir ou a tabela ser atualizada).
function costOf(model: CommandCodeModel): Array<{ input: number; output: number; cache: { read: number; write: number } }> {
  const c: CostSpec = model.cost ?? CATALOG[model.id]?.cost ?? { input: 0, output: 0 }
  return [{ input: c.input, output: c.output, cache: { read: c.cache_read ?? 0, write: c.cache_write ?? 0 } }]
}

// ---------------------------------------------------------------------------
// Parsers do catalogo remoto.
// ---------------------------------------------------------------------------

const MODEL_ID_RE = /^[A-Za-z0-9][\w./:-]*$/
const EFFORT_RE = /^[a-z][a-z0-9-]*$/
const VISION_HINT_RE = /\b(?:vision|multimodal|multimodality)\b/i

function parseNumber(value: string): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

// "1M" -> 1000000, "1.05M" -> 1050000, "262K" -> 262000, em-dash -> undefined.
function parseTokenCount(cell: string): number | undefined {
  const match = cell.match(/^([\d.]+)\s*([MK])$/i)
  if (!match) return undefined
  const n = parseNumber(match[1])
  if (n === undefined) return undefined
  return Math.round(n * (match[2].toUpperCase() === "M" ? 1_000_000 : 1_000))
}

// "$0.15/$0.6 (cache $0.003, write $2.5)" -> { input, output, cache_read, cache_write }.
function parseCost(cell: string): CostSpec | undefined {
  const io = cell.match(/\$\s*([\d.]+)\s*\/\s*\$\s*([\d.]+)/)
  if (!io) return undefined
  const input = parseNumber(io[1])
  const output = parseNumber(io[2])
  if (input === undefined || output === undefined) return undefined

  const cost: CostSpec = { input, output }
  const read = cell.match(/cache\s*\$\s*([\d.]+)/i)
  const write = cell.match(/write\s*\$\s*([\d.]+)/i)
  if (read) {
    const value = parseNumber(read[1])
    if (value !== undefined) cost.cache_read = value
  }
  if (write) {
    const value = parseNumber(write[1])
    if (value !== undefined) cost.cache_write = value
  }
  return cost
}

// "low, medium, xhigh" -> ["low", "medium", "xhigh"]; em-dash -> [].
function parseEfforts(cell: string): string[] {
  if (cell === "\u2014" || cell === "-" || cell.length === 0) return []
  return cell
    .split(",")
    .map((effort) => effort.trim())
    .filter((effort) => EFFORT_RE.test(effort))
}

/**
 * Le as tabelas do models.md publicado no pacote npm. Cada linha de modelo tem:
 * | `id` | Nome | Contexto | Efforts | Preco | Plano | Best for |
 */
export function parseCatalogMarkdown(markdown: string): Record<string, RemoteModelSpec> {
  const models: Record<string, RemoteModelSpec> = {}
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue
    const cells = line.split("|").map((cell) => cell.trim())
    if (cells.length < 9) continue

    const idMatch = cells[1].match(/^`([^`]+)`$/)
    if (!idMatch || !MODEL_ID_RE.test(idMatch[1])) continue

    const spec: RemoteModelSpec = {
      name: cells[2] || undefined,
      context: parseTokenCount(cells[3]),
      efforts: parseEfforts(cells[4]),
      cost: parseCost(cells[5]),
    }
    if (VISION_HINT_RE.test(cells[7])) spec.visionHint = true
    models[idMatch[1]] = spec
  }
  return models
}

function decodeEntities(text: string): string {
  return text.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
}

/**
 * Le a tabela de https://commandcode.ai/models. Cada <tr> de modelo tem o link
 * /models/<slug> com o nome de exibicao e um botao com
 * aria-label="Capabilities: Text input, Vision, Reasoning".
 */
export function parseCapabilitiesHtml(html: string): Record<string, ModelCapabilities> {
  const caps: Record<string, ModelCapabilities> = {}
  for (const row of html.split(/<tr\b/i).slice(1)) {
    const link = row.match(/href="\/models\/[^"]+"[^>]*>\s*<span[^>]*>([^<]+)<\/span>/)
    const label = row.match(/aria-label="Capabilities: ([^"]+)"/)
    if (!link || !label) continue

    const name = decodeEntities(link[1].trim())
    if (name.length === 0) continue
    caps[name] = { vision: /Vision/.test(label[1]), reasoning: /Reasoning/.test(label[1]) }
  }
  return caps
}

// ---------------------------------------------------------------------------
// Coleta e cache do catalogo remoto.
// ---------------------------------------------------------------------------

type Fetcher = typeof fetch
type Logger = (level: "info" | "warn", message: string, extra?: Record<string, unknown>) => void

async function fetchText(fetcher: Fetcher, url: string): Promise<string> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return await response.text()
}

async function fetchLatestVersion(fetcher: Fetcher): Promise<string | undefined> {
  try {
    const body: unknown = JSON.parse(await fetchText(fetcher, REGISTRY_URL))
    if (typeof body === "object" && body !== null && "version" in body && typeof body.version === "string") {
      return body.version
    }
  } catch {
    // registry fora: o markdown cai para a tag @latest do CDN
  }
  return undefined
}

// A tag @latest e resolvida no momento da requisicao (unpkg primeiro), entao o
// markdown acompanha o release novo sem precisar fixar a versao.
async function fetchCatalogMarkdown(fetcher: Fetcher): Promise<string | undefined> {
  for (const base of CDN_BASES) {
    try {
      return await fetchText(fetcher, `${base}/${CATALOG_PACKAGE}@latest/${CATALOG_MD_PATH}`)
    } catch {
      // tenta o proximo CDN
    }
  }
  return undefined
}

async function fetchCapabilities(fetcher: Fetcher): Promise<Record<string, ModelCapabilities>> {
  try {
    return parseCapabilitiesHtml(await fetchText(fetcher, MODELS_PAGE_URL))
  } catch {
    return {}
  }
}

function remoteCacheFile(): string {
  const base = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache")
  return join(base, "opencode", "commandcode-catalog.json")
}

async function readRemoteCache(): Promise<RemoteCatalog | undefined> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(remoteCacheFile(), "utf8"))
    if (
      typeof raw === "object" &&
      raw !== null &&
      "fetchedAt" in raw &&
      typeof raw.fetchedAt === "number" &&
      "catalog" in raw &&
      typeof raw.catalog === "object" &&
      raw.catalog !== null &&
      "caps" in raw &&
      typeof raw.caps === "object" &&
      raw.caps !== null
    ) {
      return raw as RemoteCatalog
    }
  } catch {
    // cache ausente ou corrompido: segue para a rede
  }
  return undefined
}

async function writeRemoteCache(data: RemoteCatalog): Promise<void> {
  try {
    const file = remoteCacheFile()
    await fs.mkdir(dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify(data), "utf8")
  } catch {
    // cache em disco e opcional
  }
}

const consoleLog: Logger = (level, message, extra) => {
  if (level === "info") console.info(`[commandcode] ${message}`)
  else console.warn(`[commandcode] ${message}`, extra ?? "")
}

let remoteCache: RemoteCatalog | undefined

/**
 * Nunca lanca: em falha de rede devolve o ultimo cache (mesmo vencido) ou um
 * catalogo vazio, e o snapshot estatico CATALOG assume o resto.
 */
async function loadRemoteCatalog(fetcher: Fetcher = fetch, log: Logger = consoleLog): Promise<RemoteCatalog> {
  if (remoteCache && Date.now() - remoteCache.fetchedAt < REMOTE_TTL_MS) return remoteCache

  const cached = await readRemoteCache()
  if (cached && Date.now() - cached.fetchedAt < REMOTE_TTL_MS) {
    remoteCache = cached
    return cached
  }

  const [version, caps, markdown] = await Promise.all([
    fetchLatestVersion(fetcher),
    fetchCapabilities(fetcher),
    fetchCatalogMarkdown(fetcher),
  ])
  if (markdown) {
    const catalog = parseCatalogMarkdown(markdown)
    if (Object.keys(catalog).length > 0) {
      const fresh: RemoteCatalog = { version, fetchedAt: Date.now(), catalog, caps }
      remoteCache = fresh
      await writeRemoteCache(fresh)
      log(
        "info",
        `catalogo remoto ${version ?? "latest"}: ${Object.keys(catalog).length} modelos, ${Object.keys(caps).length} capabilities.`,
      )
      return fresh
    }
  }

  const fallback: RemoteCatalog = cached
    ? { ...cached, caps: Object.keys(caps).length > 0 ? caps : cached.caps }
    : { fetchedAt: 0, catalog: {}, caps }
  remoteCache = fallback
  log("warn", `catalogo remoto indisponivel; mantendo ${cached ? "ultimo cache" : "snapshot local"}.`, { version })
  return fallback
}

// O catalogo remoto so enriquece os modelos que a API devolve (que ja vem
// filtrados pelo plano do usuario). A excecao e este force-include, que cobre a
// defasagem conhecida do endpoint; os metadados dele vem do catalogo remoto.
const FORCE_INCLUDED_MODELS: readonly CommandCodeModel[] = [
  { id: "gpt-6-astra", name: "GPT-6 Astra", context_length: 1_050_000 },
]

function enrichWithRemote(model: CommandCodeModel, remote: RemoteCatalog): CommandCodeModel {
  const spec = remote.catalog[model.id]
  const known = CATALOG[model.id]
  const byApiName = model.name !== undefined ? remote.caps[model.name] : undefined
  const byCatalogName = spec?.name !== undefined ? remote.caps[spec.name] : undefined
  const caps = byApiName ?? byCatalogName

  return {
    ...model,
    name: model.name ?? spec?.name,
    context_length: model.context_length ?? spec?.context,
    efforts: spec?.efforts ?? model.efforts,
    cost: spec?.cost ?? model.cost,
    // O site e a fonte mais confiavel; o snapshot cobre offline; a descricao
    // ("with vision") e o ultimo palpite antes do heuristico de prefixo.
    vision: caps?.vision ?? known?.vision ?? spec?.visionHint ?? model.vision,
    reasoning: caps?.reasoning ?? known?.reasoning ?? model.reasoning,
  }
}

export function mergeRemoteModels(
  models: readonly CommandCodeModel[],
  remote: RemoteCatalog,
): CommandCodeModel[] {
  const merged = new Map<string, CommandCodeModel>()
  for (const model of FORCE_INCLUDED_MODELS) merged.set(model.id, model)
  for (const model of models) merged.set(model.id, model)
  return [...merged.values()].map((model) => enrichWithRemote(model, remote))
}

export interface CommandCodeModel {
  id: string
  name?: string
  context_length?: number
  efforts?: readonly string[]
  cost?: CostSpec
  vision?: boolean
  reasoning?: boolean
}

export async function fetchModels(
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<CommandCodeModel[]> {
  const response = await fetcher(`${BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`Command Code: falha ao buscar modelos (HTTP ${response.status})`)
  }

  const body: unknown = await response.json()
  if (
    typeof body !== "object" ||
    body === null ||
    !("data" in body) ||
    !Array.isArray(body.data) ||
    !body.data.every(
      (model) =>
        typeof model === "object" &&
        model !== null &&
        "id" in model &&
        typeof model.id === "string" &&
        model.id.length > 0 &&
        (!("name" in model) || model.name === undefined || typeof model.name === "string") &&
        (!("context_length" in model) ||
          model.context_length === undefined ||
          (typeof model.context_length === "number" && model.context_length >= 0)),
    )
  ) {
    throw new Error("Command Code: resposta de modelos invalida")
  }
  return body.data as CommandCodeModel[]
}

export function applyCatalog(
  catalog: CatalogDraft,
  apiKey: string,
  models: readonly CommandCodeModel[],
): void {
  const settings = { baseURL: BASE_URL, apiKey }
  const api = { type: "aisdk" as const, package: AISDK_PACKAGE, settings }

  catalog.provider.update(PROVIDER_ID, (provider) => {
    provider.name = PROVIDER_NAME
    // O ModelResolver do opencode2 le `package` e `settings` no NIVEL DO TOPO
    // do descritor do modelo (`p.package` / `p.settings`), nao dentro de `api`.
    // Se so preenchermos `api`, o `package` chega vazio no resolver e a sessao
    // morre com UnsupportedPackageError sem responder. Por isso setamos os dois:
    // top-level (que o resolver le) + `api` (shape tipado, herdado pelos modelos).
    const p = provider as unknown as Record<string, unknown>
    p.package = AISDK_PACKAGE
    p.settings = settings
    provider.api = api
    provider.request = { headers: {}, body: {} }
  })

  for (const source of models) {
    catalog.model.update(PROVIDER_ID, source.id, (model) => {
      model.name = displayName(source)
      const m = model as unknown as Record<string, unknown>
      m.package = AISDK_PACKAGE
      m.settings = settings
      model.api = { id: source.id, ...api }
      model.limit = {
        // Context vem do /models (que manda para todos). O default so cobre
        // modelo vindo do fallback offline ou mudanca de shape da API.
        context: source.context_length ?? DEFAULT_CONTEXT_TOKENS,
        // A API nao expoe max output: fica o mapa curto + default.
        output: model.limit?.output ?? MAX_OUTPUT[source.id] ?? DEFAULT_OUTPUT_TOKENS,
      }
      // "o aceite de arquivos" + "imagens": no v2 nao ha flag `attachment`; o
      // anexo de imagem e liberado quando `capabilities.input` inclui "image".
      model.capabilities = {
        tools: supportsTools(source),
        input: inputModalities(source),
        output: ["text"],
      }
      // "o valor do uso": cost virou array (ModelCost[]) no v2.
      model.cost = costOf(source)
      // "o nivel": catalogo remoto > REASONING_EFFORTS > fallback. Modelo sem
      // efforts conhecidos fica SEM variant (o modelo decide), como no CLI.
      model.variants = effortsOf(source).map((effort) => ({
        id: effort,
        headers: {},
        body: { reasoningEffort: effort },
      }))
    })
  }
}

// Estado no escopo do modulo: o transform registrado le sempre a versao mais
// recente de `discovered`, entao um `catalog.reload()` apos o fetch faz os
// modelos aparecerem sem precisar re-registrar nada.
let discovered: CommandCodeModel[] = []
let started = false

// A assinatura cobre os campos que mudam o resultado do catalogo (nao so ids):
// assim uma mudanca de preco/vision/efforts publicada no catalogo remoto tambem
// dispara o reload.
const signatureOf = (models: readonly CommandCodeModel[]): string =>
  models
    .map((model) =>
      JSON.stringify([model.id, model.name, model.context_length, model.efforts, model.cost, model.vision, model.reasoning]),
    )
    .sort()
    .join("|")

export default define({
  id: PROVIDER_ID,
  setup: async (ctx) => {
    const apiKey = process.env.CMD_API_KEY
    if (!apiKey) {
      console.warn("[commandcode] CMD_API_KEY ausente, provider nao carregado.")
      return
    }

    // Evita empilhar transforms/timers caso o setup rode mais de uma vez no
    // mesmo processo (recarga de config, etc).
    if (started) return
    started = true

    // Registra o transform de forma sincrona e nao-bloqueante: ele apenas
    // aplica o que ja esta em `discovered` (vazio no primeiro boot). Nada de
    // I/O de rede aqui dentro, entao o boot do OpenCode nunca congela esperando
    // a API da Command Code responder.
    await ctx.catalog.transform((catalog) => {
      applyCatalog(catalog, apiKey, discovered)
    })

    // Descoberta de modelos em segundo plano: API + catalogo remoto em paralelo.
    // So dispara reload quando algo muda de verdade (ids, custo, vision, efforts).
    let signature = signatureOf(discovered)
    let refreshing = false
    const refresh = async () => {
      if (refreshing) return
      refreshing = true
      try {
        const [apiModels, remote] = await Promise.all([fetchModels(apiKey), loadRemoteCatalog()])
        const next = mergeRemoteModels(apiModels, remote)
        const nextSignature = signatureOf(next)
        if (nextSignature === signature) return
        discovered = next
        signature = nextSignature
        await ctx.catalog.reload()
        const semContexto = next.filter((model) => !model.context_length).map((model) => model.id)
        console.info(`[commandcode] ${next.length} modelos descobertos.`)
        // Se a API parar de mandar context_length, os modelos caem no default de
        // 200k silenciosamente. Melhor gritar no log do que truncar sem aviso.
        if (semContexto.length > 0) {
          console.warn(`[commandcode] ${semContexto.length} modelo(s) sem context_length:`, semContexto.join(", "))
        }
        const fora = next.filter((model) => !CATALOG[model.id] && !remote.catalog[model.id]).map((model) => model.id)
        if (fora.length > 0) {
          console.warn(`[commandcode] ${fora.length} modelo(s) fora do snapshot e do catalogo remoto:`, fora.join(", "))
        }
      } catch (error) {
        console.warn("[commandcode] descoberta de modelos falhou:", error)
      } finally {
        refreshing = false
      }
    }

    // Primeira descoberta imediata (sem await, para nao bloquear o setup) e
    // depois periodica. O intervalo vive junto com o processo do servidor.
    void refresh()
    setInterval(() => void refresh(), REFRESH_MS)
  },
})
