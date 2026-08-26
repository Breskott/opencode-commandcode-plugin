import { define, type CatalogDraft } from "@opencode-ai/plugin/v2/promise"

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

// Fallback SO para modelos DESCONHECIDOS (fora do CATALOG) que a Command Code
// lancar: entram com os niveis universais de reasoning em vez de ficar sem
// seletor. Modelo conhecido do CATALOG usa exatamente os efforts do ground truth
// (RE do bundle command-code@1.32.2, objeto `jR`); quem la nao tem `reasoningEfforts`
// e "auto"/nao-reasoning e fica SEM variant (o modelo decide), como no CLI oficial.
const DEFAULT_EFFORTS: readonly string[] = ["low", "medium", "high"]

// Ultimo recurso: so valem quando nem o /models nem os mapas por modelo
// (CONTEXT_WINDOW / MAX_OUTPUT, definidos abaixo) tiverem o valor.
const DEFAULT_CONTEXT_TOKENS = 200_000
const DEFAULT_OUTPUT_TOKENS = 32_000

// ---------------------------------------------------------------------------
// CATALOGO ESTATICO: capabilities (visao) + preco. Portado do commandcode.v1.
// O endpoint /models da Command Code so devolve id, name e context_length —
// nem custo nem capability vem em runtime, entao nada disso da para derivar.
// Snapshot de 58 modelos de commandcode.ai/models, verificado em 25/08/2026.
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
type Modality = "text" | "image"
type CostSpec = { input: number; output: number; cache_read?: number; cache_write?: number }
type ModelSpec = { vision: boolean; reasoning: boolean; cost: CostSpec }

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

// Context window (tokens) por modelo — snapshot commandcode.ai/models + docs do
// plano GOAT (commandcode.ai/docs/plans/goat). Fallback usado quando o /models nao
// mandar context_length. O valor da API (quando vem) SEMPRE vence este mapa; este
// mapa vence o DEFAULT chapado. Ids sem entrada aqui caem em DEFAULT_CONTEXT_TOKENS.
const CONTEXT_WINDOW: Readonly<Record<string, number>> = {
  "claude-fable-5": 1_000_000,
  "claude-haiku-4-5-20251001": 200_000,
  "claude-opus-4-7": 1_000_000,
  "claude-opus-4-8": 1_000_000,
  "claude-opus-5": 1_000_000,
  "claude-sonnet-4-6": 1_000_000,
  "claude-sonnet-5": 1_000_000,
  "deepseek/deepseek-v4-flash": 1_000_000,
  "deepseek/deepseek-v4-flash-vision-exp": 1_000_000,
  "deepseek/deepseek-v4-pro": 1_000_000,
  "google/gemini-3.1-flash-lite": 1_000_000,
  "google/gemini-3.5-flash": 1_000_000,
  "google/gemini-3.5-flash-lite": 1_000_000,
  "google/gemini-3.6-flash": 1_000_000,
  "google/gemini-3.7-flash": 1_048_576,
  "gpt-5.3-codex": 400_000,
  "gpt-5.4": 400_000,
  "gpt-5.4-mini": 400_000,
  "gpt-5.5": 400_000,
  "gpt-5.6-luna": 1_050_000,
  "gpt-5.6-sol": 1_050_000,
  "gpt-5.6-terra": 1_050_000,
  "meta/muse-spark-1.1": 1_048_576,
  "meta/muse-spark-1.2": 1_048_576,
  "meta/muse-spark-1.2-contributor": 1_048_576,
  "MiniMaxAI/MiniMax-M2.5": 200_000,
  "MiniMaxAI/MiniMax-M2.7": 200_000,
  "MiniMaxAI/MiniMax-M3": 1_000_000,
  "moonshotai/Kimi-K2.5": 256_000,
  "moonshotai/Kimi-K2.6": 256_000,
  "moonshotai/Kimi-K2.7-Code": 256_000,
  "moonshotai/Kimi-K2.7-Code-Highspeed": 262_000,
  "moonshotai/Kimi-K3": 1_000_000,
  "nvidia/nemotron-3-ultra-550b-a55b": 1_000_000,
  "poolside/laguna-s-2.1-free": 256_000,
  "Qwen/Qwen3.6-Max-Preview": 200_000,
  "Qwen/Qwen3.7-Flash": 1_000_000,
  "Qwen/Qwen3.7-Max": 1_000_000,
  "Qwen/Qwen3.7-Plus": 1_000_000,
  "Qwen/Qwen3.8-27B": 262_144,
  "Qwen/Qwen3.8-Max": 1_000_000,
  "sakana/fugu-ultra": 1_000_000,
  "stealth/ox-alpha": 1_048_576,
  "stepfun/Step-3.5-Flash": 1_000_000,
  "stepfun/Step-3.7-Flash": 256_000,
  "tencent/hy3-paid": 262_144,
  "thinkingmachines/inkling": 256_000,
  "thinkingmachines/inkling-small": 1_000_000,
  "xai/grok-4.5": 500_000,
  "xai/grok-4.6": 500_000,
  "xiaomi/mimo-v2.5": 1_000_000,
  "xiaomi/mimo-v2.5-pro": 1_000_000,
  "zai-org/GLM-5": 200_000,
  "zai-org/GLM-5.1": 200_000,
  "zai-org/GLM-5.2": 1_000_000,
  "zai-org/GLM-5.2-Fast": 1_000_000,
  "zai-org/GLM-5.3": 1_000_000,
}

// maxOutput conhecido do snapshot. O /models da Command Code NAO devolve output e
// nem o site publica cap por modelo, entao o resto usa DEFAULT_OUTPUT_TOKENS.
const MAX_OUTPUT: Readonly<Record<string, number>> = {
  "Qwen/Qwen3.8-27B": 32_768,
  "poolside/laguna-s-2.1-free": 32_768,
}

// Rede de seguranca para ids que ainda nao entraram em CATALOG.
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
const MODEL_OVERRIDES: Readonly<Record<string, { input?: Modality[]; tool_call?: boolean }>> = {
  // "MiniMaxAI/MiniMax-M3": { input: ["text", "image"] },
}

/**
 * Cascata, do mais confiavel para o menos:
 *   1. MODEL_OVERRIDES (force manual)
 *   2. CATALOG (snapshot do site oficial)
 *   3. prefixo do id (modelo novo, ainda sem snapshot)
 */
function inputModalities(id: string): Modality[] {
  const override = MODEL_OVERRIDES[id]?.input
  if (override && override.length > 0) return [...new Set<Modality>(["text", ...override])]

  const known = CATALOG[id]
  if (known) return known.vision ? ["text", "image"] : ["text"]

  const lower = id.toLowerCase()
  return VISION_PREFIXES.some((prefix) => lower.startsWith(prefix)) ? ["text", "image"] : ["text"]
}

// A Command Code e um gateway focado em coding agents: tool call e universal.
function supportsTools(id: string): boolean {
  return MODEL_OVERRIDES[id]?.tool_call ?? true
}

// Converte o custo do snapshot para o shape v2 (ModelCost[]). Modelo desconhecido
// entra com custo 0 (aparece como $0.00 na TUI ate a tabela ser atualizada).
function costOf(id: string): Array<{ input: number; output: number; cache: { read: number; write: number } }> {
  const c: CostSpec = CATALOG[id]?.cost ?? { input: 0, output: 0 }
  return [{ input: c.input, output: c.output, cache: { read: c.cache_read ?? 0, write: c.cache_write ?? 0 } }]
}

export interface CommandCodeModel {
  id: string
  name?: string
  context_length?: number
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
      model.name = source.name ?? source.id
      const m = model as unknown as Record<string, unknown>
      m.package = AISDK_PACKAGE
      m.settings = settings
      model.api = { id: source.id, ...api }
      model.limit = {
        // Precedencia: valor ao vivo do /models > snapshot por modelo > default.
        context: source.context_length ?? CONTEXT_WINDOW[source.id] ?? DEFAULT_CONTEXT_TOKENS,
        output: model.limit?.output ?? MAX_OUTPUT[source.id] ?? DEFAULT_OUTPUT_TOKENS,
      }
      // "o aceite de arquivos" + "imagens": no v2 nao ha flag `attachment`; o
      // anexo de imagem e liberado quando `capabilities.input` inclui "image".
      model.capabilities = {
        tools: supportsTools(source.id),
        input: inputModalities(source.id),
        output: ["text"],
      }
      // "o valor do uso": cost virou array (ModelCost[]) no v2.
      model.cost = costOf(source.id)
      // "o nivel": modelo conhecido usa os efforts exatos do ground truth (ou
      // nenhum, se for auto/nao-reasoning); so o modelo desconhecido cai no default.
      const efforts =
        REASONING_EFFORTS[source.id] ?? (CATALOG[source.id] !== undefined ? [] : DEFAULT_EFFORTS)
      model.variants = efforts.map((effort) => ({
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

const signatureOf = (models: readonly CommandCodeModel[]): string =>
  models
    .map((model) => model.id)
    .sort()
    .join(",")

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

    // Descoberta de modelos em segundo plano. So dispara reload quando a lista
    // muda de verdade, para nao reconstruir o catalogo a toa.
    let signature = signatureOf(discovered)
    let refreshing = false
    const refresh = async () => {
      if (refreshing) return
      refreshing = true
      try {
        const next = await fetchModels(apiKey)
        const nextSignature = signatureOf(next)
        if (nextSignature === signature) return
        discovered = next
        signature = nextSignature
        await ctx.catalog.reload()
        console.info(`[commandcode] ${next.length} modelos descobertos.`)
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
