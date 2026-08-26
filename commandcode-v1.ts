import type { Config, Plugin } from "@opencode-ai/plugin"

declare const process: { env: Record<string, string | undefined> }

const PROVIDER_ID = "commandcode"
const PROVIDER_NAME = "Command Code"
const BASE_URL = "https://api.commandcode.ai/provider/v1"

// DIFERENCA CENTRAL v2 -> v1:
// No v2 o provider e declarado com `type: "aisdk"` + `package: "aisdk:@ai-sdk/..."`
// via catalog.transform. No v1 nao existe catalogo: o provider vive dentro do
// proprio config (`config.provider[id]`), e o campo se chama `npm`, sem prefixo.
const NPM_PACKAGE = "@ai-sdk/openai-compatible"

const REQUEST_TIMEOUT_MS = 15_000
const CACHE_TTL_MS = 5 * 60 * 1000

// O schema v1 exige `context` E `output` em `limit`. O /models devolve
// context_length para todos os modelos, entao DEFAULT_CONTEXT_TOKENS so entra
// em cena se a API mudar de shape ou no fallback offline (que so tem os ids).
const DEFAULT_OUTPUT_TOKENS = 32_000
const DEFAULT_CONTEXT_TOKENS = 200_000

type Modality = "text" | "image"

// ---------------------------------------------------------------------------
// CATALOGO ESTATICO: SO o que a API nao devolve (capability de imagem, flag de
// reasoning e preco). Id, nome e context window vem sempre do /models ao vivo.
// O endpoint /models da Command Code devolve apenas id, name e context_length.
// Nao ha capability nem preco na resposta, entao nada disso da para derivar em
// runtime. Esta tabela foi extraida da pagina publica commandcode.ai/models.
// Snapshot de 58 modelos verificado em 25/08/2026, match 1:1 com os ids da API.
//
// `cost` segue a convencao do opencode: USD por 1 MILHAO de tokens. Precos de
// off-peak quando o modelo tem janela de peak, e ja com desconto promocional
// aplicado quando havia. Modelo novo fora do snapshot entra sem custo (0) e
// aparece como $0.00 na TUI ate voce atualizar a tabela.
// ---------------------------------------------------------------------------
type ModelSpec = {
  vision: boolean
  reasoning: boolean
  cost: { input: number; output: number; cache_read?: number; cache_write?: number }
}

const CATALOG: Readonly<Record<string, ModelSpec>> = {
  "claude-fable-5": { vision: true, reasoning: true, cost: { input: 10.0, output: 50.0, cache_read: 1.0, cache_write: 12.5 } },
  "claude-haiku-4-5-20251001": { vision: true, reasoning: false, cost: { input: 1.0, output: 5.0, cache_read: 0.1, cache_write: 1.25 } },
  "claude-opus-4-7": { vision: true, reasoning: true, cost: { input: 5.0, output: 25.0, cache_read: 0.5, cache_write: 6.25 } },
  "claude-opus-4-8": { vision: true, reasoning: true, cost: { input: 5.0, output: 25.0, cache_read: 0.5, cache_write: 6.25 } },
  "claude-opus-5": { vision: true, reasoning: true, cost: { input: 5.0, output: 25.0, cache_read: 0.5, cache_write: 6.25 } },
  "claude-sonnet-4-6": { vision: true, reasoning: true, cost: { input: 3.0, output: 15.0, cache_read: 0.3, cache_write: 3.75 } },
  "claude-sonnet-5": { vision: true, reasoning: true, cost: { input: 2.0, output: 10.0, cache_read: 0.2, cache_write: 2.5 } },
  "deepseek/deepseek-v4-flash": { vision: false, reasoning: true, cost: { input: 0.22, output: 0.66, cache_read: 0.007 } },
  "deepseek/deepseek-v4-flash-vision-exp": { vision: true, reasoning: true, cost: { input: 0.22, output: 0.66, cache_read: 0.007 } },
  "deepseek/deepseek-v4-pro": { vision: false, reasoning: true, cost: { input: 0.66, output: 1.98, cache_read: 0.022 } },
  "google/gemini-3.1-flash-lite": { vision: true, reasoning: true, cost: { input: 0.25, output: 1.5, cache_read: 0.03 } },
  "google/gemini-3.5-flash": { vision: true, reasoning: true, cost: { input: 1.5, output: 9.0, cache_read: 0.15 } },
  "google/gemini-3.5-flash-lite": { vision: true, reasoning: true, cost: { input: 0.3, output: 2.5, cache_read: 0.03 } },
  "google/gemini-3.6-flash": { vision: true, reasoning: true, cost: { input: 1.5, output: 7.5, cache_read: 0.15 } },
  "google/gemini-3.7-flash": { vision: true, reasoning: true, cost: { input: 0.75, output: 3.75, cache_read: 0.075, cache_write: 0.04167 } },
  "gpt-5.3-codex": { vision: true, reasoning: true, cost: { input: 2.0, output: 8.0, cache_read: 0.5 } },
  "gpt-5.4": { vision: true, reasoning: true, cost: { input: 2.5, output: 15.0, cache_read: 0.25 } },
  "gpt-5.4-mini": { vision: true, reasoning: true, cost: { input: 0.75, output: 4.5, cache_read: 0.075 } },
  "gpt-5.5": { vision: true, reasoning: true, cost: { input: 5.0, output: 30.0, cache_read: 0.5 } },
  "gpt-5.6-luna": { vision: true, reasoning: true, cost: { input: 0.2, output: 1.2, cache_read: 0.02, cache_write: 0.25 } },
  "gpt-5.6-sol": { vision: true, reasoning: true, cost: { input: 5.0, output: 30.0, cache_read: 0.5, cache_write: 6.25 } },
  "gpt-5.6-terra": { vision: true, reasoning: true, cost: { input: 2.0, output: 12.0, cache_read: 0.2, cache_write: 2.5 } },
  "meta/muse-spark-1.1": { vision: true, reasoning: true, cost: { input: 1.25, output: 4.25, cache_read: 0.15 } },
  "meta/muse-spark-1.2": { vision: true, reasoning: true, cost: { input: 1.25, output: 4.25, cache_read: 0.15 } },
  "meta/muse-spark-1.2-contributor": { vision: true, reasoning: true, cost: { input: 0.1, output: 0.2, cache_read: 0.002 } },
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
  "Qwen/Qwen3.8-Max": { vision: true, reasoning: true, cost: { input: 2.0, output: 6.0, cache_read: 0.25, cache_write: 2.5 } },
  "sakana/fugu-ultra": { vision: true, reasoning: true, cost: { input: 5.0, output: 30.0, cache_read: 0.5 } },
  "stealth/ox-alpha": { vision: true, reasoning: true, cost: { input: 0.0, output: 0.0, cache_read: 0.0 } },
  "stepfun/Step-3.5-Flash": { vision: false, reasoning: true, cost: { input: 0.1, output: 0.3, cache_read: 0.02 } },
  "stepfun/Step-3.7-Flash": { vision: true, reasoning: true, cost: { input: 0.2, output: 1.15, cache_read: 0.04 } },
  "tencent/hy3-paid": { vision: false, reasoning: true, cost: { input: 0.14, output: 0.58, cache_read: 0.035 } },
  "thinkingmachines/inkling": { vision: true, reasoning: true, cost: { input: 1.0, output: 4.05, cache_read: 0.17 } },
  "thinkingmachines/inkling-small": { vision: true, reasoning: true, cost: { input: 0.5, output: 1.2, cache_read: 0.1 } },
  "xai/grok-4.5": { vision: true, reasoning: true, cost: { input: 2.0, output: 6.0, cache_read: 0.5 } },
  "xai/grok-4.6": { vision: false, reasoning: true, cost: { input: 2.0, output: 6.0, cache_read: 0.5 } },
  "xiaomi/mimo-v2.5": { vision: true, reasoning: false, cost: { input: 0.14, output: 0.28, cache_read: 0.0028 } },
  "xiaomi/mimo-v2.5-pro": { vision: false, reasoning: false, cost: { input: 0.435, output: 0.87, cache_read: 0.0036 } },
  "zai-org/GLM-5": { vision: false, reasoning: false, cost: { input: 1.0, output: 3.2, cache_read: 0.2 } },
  "zai-org/GLM-5.1": { vision: false, reasoning: false, cost: { input: 1.4, output: 4.4, cache_read: 0.26 } },
  "zai-org/GLM-5.2": { vision: false, reasoning: true, cost: { input: 1.4, output: 4.4, cache_read: 0.26 } },
  "zai-org/GLM-5.2-Fast": { vision: false, reasoning: false, cost: { input: 3.0, output: 10.25, cache_read: 0.5 } },
  "zai-org/GLM-5.3": { vision: false, reasoning: true, cost: { input: 1.4, output: 4.4, cache_read: 0.26 } },
}

// maxOutput conhecido do snapshot. O /models da Command Code NAO devolve output e
// nem o site publica cap por modelo, entao o resto usa DEFAULT_OUTPUT_TOKENS.
const MAX_OUTPUT: Readonly<Record<string, number>> = {
  "Qwen/Qwen3.8-27B": 32_768,
  "poolside/laguna-s-2.1-free": 32_768,
}

// Rede de seguranca para ids que ainda nao entraram em CAPABILITIES.
const VISION_PREFIXES: readonly string[] = [
  "claude-",
  "gpt-5",
  "google/gemini",
  "moonshotai/kimi",
  "meta/muse-spark",
  "thinkingmachines/inkling",
]

// Force bruto: ganha de tudo, inclusive da tabela acima. Use quando a Command
// Code mudar uma capability e voce nao quiser esperar um novo snapshot.
const MODEL_OVERRIDES: Readonly<Record<string, { input?: Modality[]; tool_call?: boolean; reasoning?: boolean }>> = {
  // "MiniMaxAI/MiniMax-M3": { input: ["text", "image"] },
}

const REASONING_EFFORTS: Readonly<Record<string, readonly string[]>> = {
  "Qwen/Qwen3.8-27B": ["low", "medium", "xhigh"],
  "Qwen/Qwen3.8-Max": ["low", "medium", "xhigh"],
  "claude-fable-5": ["low", "medium", "high", "xhigh", "max"],
  "claude-opus-4-7": ["low", "medium", "high", "xhigh", "max"],
  "claude-opus-4-8": ["low", "medium", "high", "xhigh", "max"],
  "claude-opus-5": ["low", "medium", "high", "xhigh", "max"],
  "claude-sonnet-4-6": ["low", "medium", "high", "xhigh", "max"],
  "claude-sonnet-5": ["low", "medium", "high", "xhigh", "max"],
  "deepseek/deepseek-v4-flash": ["high", "max"],
  "deepseek/deepseek-v4-pro": ["high", "max"],
  "gpt-5.3-codex": ["low", "medium", "high", "xhigh"],
  "gpt-5.4": ["low", "medium", "high", "xhigh"],
  "gpt-5.4-mini": ["low", "medium", "high"],
  "gpt-5.5": ["low", "medium", "high", "xhigh"],
  "gpt-5.6-luna": ["low", "medium", "high", "xhigh", "max"],
  "gpt-5.6-sol": ["low", "medium", "high", "xhigh", "max"],
  "gpt-5.6-terra": ["low", "medium", "high", "xhigh", "max"],
  "google/gemini-3.1-flash-lite": ["low", "medium", "high"],
  "google/gemini-3.5-flash": ["low", "medium", "high"],
  "google/gemini-3.5-flash-lite": ["low", "medium", "high"],
  "google/gemini-3.6-flash": ["low", "medium", "high"],
  "google/gemini-3.7-flash": ["low", "medium", "high"],
  "sakana/fugu-ultra": ["high", "xhigh"],
  "stealth/ox-alpha": ["low", "high", "max"],
  "xai/grok-4.5": ["low", "medium", "high"],
  "xai/grok-4.6": ["low", "medium", "high", "xhigh"],
  "zai-org/GLM-5.2": ["high", "max"],
  "zai-org/GLM-5.3": ["low", "high", "max"],
}

export interface CommandCodeModel {
  id: string
  name?: string
  context_length?: number
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
 *   2. CAPABILITIES (snapshot do site oficial)
 *   3. prefixo do id (modelo novo, ainda sem snapshot)
 */
function inputModalities(model: CommandCodeModel): Modality[] {
  const override = MODEL_OVERRIDES[model.id]?.input
  if (override && override.length > 0) return [...new Set<Modality>(["text", ...override])]

  const known = CATALOG[model.id]
  if (known) return known.vision ? ["text", "image"] : ["text"]

  const id = model.id.toLowerCase()
  return VISION_PREFIXES.some((prefix) => id.startsWith(prefix)) ? ["text", "image"] : ["text"]
}

function supportsReasoning(model: CommandCodeModel): boolean {
  const override = MODEL_OVERRIDES[model.id]?.reasoning
  if (override !== undefined) return override
  const known = CATALOG[model.id]
  if (known) return known.reasoning
  return (REASONING_EFFORTS[model.id] ?? []).length > 0
}

function supportsTools(model: CommandCodeModel): boolean {
  // A Command Code e um gateway focado em coding agents: tool call e universal.
  return MODEL_OVERRIDES[model.id]?.tool_call ?? true
}

// Sem catalog.reload no v1: se a descoberta falhar, o provider sobe com o
// snapshot em vez de sumir do /models.
const FALLBACK_MODELS: readonly CommandCodeModel[] = Object.keys(CATALOG).map((id) => ({ id }))

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

/**
 * Equivalente v1 do `applyCatalog`. Escreve direto em `config.provider`, com
 * merge nao destrutivo: o que estiver no opencode.json do usuario vence.
 */
export function applyConfig(
  config: Config,
  apiKey: string,
  models: readonly CommandCodeModel[],
): void {
  if (models.length === 0) return

  const providers = ((config as Record<string, unknown>).provider ??= {}) as Record<string, any>
  const existing = (providers[PROVIDER_ID] ?? {}) as Record<string, any>
  const existingModels = (existing.models ?? {}) as Record<string, any>
  const merged: Record<string, unknown> = { ...existingModels }

  for (const source of models) {
    const efforts = REASONING_EFFORTS[source.id] ?? []
    const input = inputModalities(source)

    const entry: Record<string, unknown> = {
      id: source.id,
      name: displayName(source),
      tool_call: supportsTools(source),
      reasoning: supportsReasoning(source),
      // `attachment` e o flag que libera o opencode a montar parts de imagem.
      // Sem ele o anexo e descartado no cliente e o modelo recebe so o texto.
      attachment: input.includes("image"),
      modalities: { input, output: ["text"] },
      limit: {
        // Context vem do /models (a API manda para todos os 58). O default so
        // cobre modelo vindo do fallback offline ou mudanca de shape da API.
        context: source.context_length ?? DEFAULT_CONTEXT_TOKENS,
        // A API nao expoe max output: fica o mapa curto + default.
        output: MAX_OUTPUT[source.id] ?? DEFAULT_OUTPUT_TOKENS,
      },
      // Sem `cost` o opencode multiplica os tokens por zero e a TUI mostra $0.00.
      cost: CATALOG[source.id]?.cost ?? { input: 0, output: 0 },
    }

    if (efforts.length > 0) {
      // No v1 `variants` e um objeto nomeado cujo valor vira options do modelo,
      // e nao o array `{ id, headers, body }` do v2.
      entry.variants = Object.fromEntries(efforts.map((effort) => [effort, { reasoningEffort: effort }]))
    }

    merged[source.id] = { ...entry, ...(existingModels[source.id] ?? {}) }
  }

  providers[PROVIDER_ID] = {
    npm: NPM_PACKAGE,
    name: PROVIDER_NAME,
    ...existing,
    options: { baseURL: BASE_URL, apiKey, ...(existing.options ?? {}) },
    models: merged,
  }
}

let cache: { models: CommandCodeModel[]; at: number } | undefined

type Logger = (level: "info" | "warn" | "error", message: string, extra?: Record<string, unknown>) => Promise<void>

async function discover(apiKey: string, log: Logger): Promise<CommandCodeModel[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.models
  try {
    const models = await fetchModels(apiKey)
    cache = { models, at: Date.now() }

    const vision = models.filter((model) => inputModalities(model).includes("image"))
    const unknown = models.filter((model) => !CATALOG[model.id]).map((model) => model.id)
    // Se a API parar de mandar context_length, os modelos caem no default de 200k
    // silenciosamente. Melhor gritar no log do que truncar contexto sem aviso.
    const semContexto = models.filter((model) => !model.context_length).map((model) => model.id)
    await log("info", `${models.length} modelos descobertos (${vision.length} com attachment).`)
    if (unknown.length > 0) {
      // Modelo fora do snapshot: caiu no heuristico. Vale conferir em
      // commandcode.ai/models e atualizar a tabela CAPABILITIES.
      await log("warn", `${unknown.length} modelo(s) fora do snapshot do catalogo`, { ids: unknown.join(", ") })
    }
    if (semContexto.length > 0) {
      await log("warn", `${semContexto.length} modelo(s) sem context_length na API`, { ids: semContexto.join(", ") })
    }
    return models
  } catch (error) {
    await log("warn", "descoberta de modelos falhou, usando snapshot estatico", {
      error: error instanceof Error ? error.message : String(error),
    })
    return cache?.models ?? [...FALLBACK_MODELS]
  }
}

export const CommandCodePlugin: Plugin = async ({ client }) => {
  const apiKey = process.env.CMD_API_KEY

  const log: Logger = async (level, message, extra) => {
    try {
      await client.app.log({ body: { service: "commandcode", level, message, extra } })
    } catch {
      console.warn(`[commandcode] ${message}`, extra ?? "")
    }
  }

  if (!apiKey) {
    await log("warn", "CMD_API_KEY ausente, provider nao carregado.")
    return {}
  }

  return {
    // Unico ponto de extensao de provider no v1. Roda antes da resolucao dos
    // providers e e aguardado: por isso timeout curto + fallback.
    config: async (config) => {
      applyConfig(config, apiKey, await discover(apiKey, log))
    },
  }
}

export default CommandCodePlugin