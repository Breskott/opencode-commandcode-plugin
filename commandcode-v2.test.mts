import { describe, expect, test } from "bun:test"
import type { CatalogDraft, PluginContext } from "@opencode-ai/plugin/v2/promise"

import { applyCatalog, fetchModels, setupCommandCode } from "./commandcode-v2.ts"
import type { RefreshScheduler } from "./commandcode-v2.ts"

describe("fetchModels", () => {
  test("returns models from an authenticated Command Code response", async () => {
    const fetcher = async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-key")
      return Response.json({
        data: [{ id: "gpt-5.4", name: "GPT 5.4", context_length: 200_000 }],
      })
    }

    await expect(fetchModels("test-key", fetcher)).resolves.toEqual([
      { id: "gpt-5.4", name: "GPT 5.4", context_length: 200_000 },
    ])
  })

  test("rejects an unsuccessful response", async () => {
    const fetcher = async () => new Response("unauthorized", { status: 401 })

    await expect(fetchModels("bad-key", fetcher)).rejects.toThrow("HTTP 401")
  })

  test("rejects a malformed model payload", async () => {
    const fetcher = async () => Response.json({ data: [{ name: "missing id" }] })

    await expect(fetchModels("test-key", fetcher)).rejects.toThrow(
      "resposta de modelos invalida",
    )
  })
})

describe("applyCatalog", () => {
  test("registers the native provider and model metadata", () => {
    const providers = new Map<string, Record<string, unknown>>()
    const models = new Map<string, Record<string, unknown>>()
    const catalog = {
      provider: {
        list: () => [],
        get: () => undefined,
        update: (id: string, update: (provider: Record<string, unknown>) => void) => {
          const provider = { id }
          update(provider)
          providers.set(id, provider)
        },
        remove: () => { },
      },
      model: {
        get: () => undefined,
        update: (_providerID: string, id: string, update: (model: Record<string, unknown>) => void) => {
          const model = { id }
          update(model)
          models.set(id, model)
        },
        remove: () => { },
        default: { get: () => undefined, set: () => { } },
      },
    } as unknown as CatalogDraft

    applyCatalog(catalog, "test-key", [
      { id: "gpt-5.4", name: "GPT 5.4", context_length: 200_000 },
      { id: "moonshotai/Kimi-K3" },
      { id: "plain-model" },
      { id: "z-ai/glm-5.3-flash", context_length: 1_048_576 },
      { id: "claude-fable-5-1", context_length: 1_000_000 },
      { id: "Qwen/Qwen3.8-Flash", context_length: 1_000_000 },
    ])

    expect(models.get("z-ai/glm-5.3-flash")).toMatchObject({
      capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
      limit: { context: 1_048_576 },
      cost: [{ input: 0.15, output: 0.5, cache: { read: 0.03, write: 0 } }],
    })
    expect(models.get("claude-fable-5-1")).toMatchObject({
      cost: [{ input: 10, output: 50, cache: { read: 0.25, write: 12.5 } }],
    })
    expect(models.get("Qwen/Qwen3.8-Flash")).toMatchObject({
      capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
      cost: [{ input: 0.16, output: 0.47, cache: { read: 0.016, write: 0 } }],
    })
    const settings = {
      baseURL: "https://api.commandcode.ai/provider/v1",
      apiKey: "test-key",
    }
    expect(providers.get("commandcode")).toEqual({
      id: "commandcode",
      name: "Command Code",
      // top-level: lido pelo ModelResolver do opencode2
      package: "aisdk:@ai-sdk/openai-compatible",
      settings,
      // nested: shape tipado
      api: { type: "aisdk", package: "aisdk:@ai-sdk/openai-compatible", settings },
      request: { headers: {}, body: {} },
    })
    expect(models.get("gpt-5.4")).toMatchObject({
      name: "GPT 5.4",
      package: "aisdk:@ai-sdk/openai-compatible",
      settings,
      api: {
        type: "aisdk",
        package: "aisdk:@ai-sdk/openai-compatible",
        settings,
      },
      limit: { context: 200_000, output: 32_000 },
      // "aceite de arquivos" + "imagens": gpt-5.4 tem visao no snapshot.
      capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
      // "valor do uso": cost do snapshot no shape v2 (array), cache_write ausente -> 0.
      cost: [{ input: 2.5, output: 15, cache: { read: 0.25, write: 0 } }],
      variants: [
        { id: "low", headers: {}, body: { reasoningEffort: "low" } },
        { id: "medium", headers: {}, body: { reasoningEffort: "medium" } },
        { id: "high", headers: {}, body: { reasoningEffort: "high" } },
        { id: "xhigh", headers: {}, body: { reasoningEffort: "xhigh" } },
      ],
    })
    // Kimi K3 agora expoe niveis no CLI oficial. Sem context_length na resposta,
    // o contexto ainda usa o fallback local.
    expect(models.get("moonshotai/Kimi-K3")).toMatchObject({
      capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
      cost: [{ input: 3, output: 15, cache: { read: 0.3, write: 0 } }],
      limit: { context: 200_000, output: 32_000 },
      variants: [
        { id: "low", headers: {}, body: { reasoningEffort: "low" } },
        { id: "high", headers: {}, body: { reasoningEffort: "high" } },
        { id: "max", headers: {}, body: { reasoningEffort: "max" } },
      ],
    })
    // modelo fora do mapa curado -> sem visao (nao bate em VISION_PREFIXES),
    // custo 0, e conjunto padrao de efforts.
    expect(models.get("plain-model")).toMatchObject({
      name: "plain-model",
      capabilities: { tools: true, input: ["text"], output: ["text"] },
      cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
      variants: [
        { id: "low", headers: {}, body: { reasoningEffort: "low" } },
        { id: "medium", headers: {}, body: { reasoningEffort: "medium" } },
        { id: "high", headers: {}, body: { reasoningEffort: "high" } },
      ],
    })
  })
})

test("fetches before registering Command Code in every catalog context", async () => {
  const events: string[] = []
  const context = () => ({
    catalog: {
      transform: async () => {
        events.push("transform")
        return { dispose: async () => { } }
      },
      reload: async () => { },
    },
  }) as unknown as PluginContext
  const fetcher = async () => {
    events.push("fetch")
    return Response.json({ data: [{ id: "gpt-5.4", context_length: 200_000 }] })
  }
  const schedule = (() => { }) as RefreshScheduler

  await setupCommandCode(context(), "test-key", fetcher, schedule)
  await setupCommandCode(context(), "test-key", fetcher, schedule)

  expect(events).toEqual(["fetch", "transform", "fetch", "transform"])
})

// Fonte: catalogo xL do CLI oficial command-code@1.49.1 (05/09/2026).
test.each([
  ["meta/muse-spark-1.1", ["low", "medium", "high", "xhigh"]],
  ["meta/muse-spark-1.2", ["low", "medium", "high", "xhigh"]],
  ["meta/muse-spark-1.2-contributor", ["low", "medium", "high", "xhigh"]],
  ["meta/muse-spark-1.3", ["low", "medium", "high", "xhigh", "max"]],
  ["meta/muse-spark-1.3-contributor", ["low", "medium", "high", "xhigh"]],
  ["claude-fable-5-1", ["low", "medium", "high", "xhigh", "max"]],
  ["gpt-6-astra", ["low", "medium", "high", "xhigh", "max"]],
  ["Qwen/Qwen3.8-Max-0902", ["low", "medium", "xhigh"]],
  ["Qwen/Qwen3.8-Flash", ["low", "medium", "xhigh"]],
  ["deepseek/deepseek-v4-flash-fast", ["low", "high", "max"]],
  ["deepseek/deepseek-v4-flash-vision-exp", ["high", "max"]],
  ["z-ai/glm-5.3-flash", ["low", "high", "max"]],
  ["moonshotai/Kimi-K3", ["low", "high", "max"]],
  ["google/gemini-3.8-flash", ["low", "medium", "high"]],
  ["tencent/hy4-preview", ["low", "medium", "high"]],
  ["meituan/LongCat-2.0:free", []],
  ["claude-haiku-4-5-20251001", []],
] as Array<[string, string[]]>)("publishes official reasoning variants for %s", (id, efforts) => {
  const models: Array<{ variants: unknown }> = []
  const catalog = {
    provider: { update: () => {} },
    model: {
      update: (_providerID: string, _id: string, update: (model: Record<string, unknown>) => void) => {
        const model: Record<string, unknown> = { id }
        update(model)
        models.push(model as { variants: unknown })
      },
    },
  } as unknown as CatalogDraft
  applyCatalog(catalog, "test-key", [{ id }])
  expect(models[0].variants).toEqual(efforts.map((effort) => ({
    id: effort, headers: {}, body: { reasoningEffort: effort },
  })))
})
