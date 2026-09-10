import assert from "node:assert/strict"
import test from "node:test"

import {
  applyConfig,
  CommandCodePlugin,
  mergeRemoteModels,
  parseCapabilitiesHtml,
  parseCatalogMarkdown,
  type CommandCodeModel,
  type RemoteCatalog,
} from "./commandcode-v1.ts"

const MD_MIDDLE_DOT = "\u00b7"
const MD_EM_DASH = "\u2014"

const CATALOG_MD_FIXTURE = [
  `| Id (use EXACTLY this) | Name | Context | Efforts | $/1M in/out ${MD_MIDDLE_DOT} cache read | Min plan | Best for |`,
  "|---|---|---|---|---|---|---|",
  `| \`deepseek/deepseek-v4.1-flash\` | DeepSeek V4.1 Flash | 1M | low, high, max | $0.15/$0.6 ${MD_MIDDLE_DOT} cache $0.003 | Go and above | V4.1 hybrid-attention reasoning with vision |`,
  `| \`gpt-5.6-sol\` | GPT-5.6 Sol | 1.05M | low, medium, high, xhigh, max | $5/$30 ${MD_MIDDLE_DOT} cache $0.5 (write $6.25) | GOAT and above | frontier model for complex professional work |`,
  `| \`zai-org/GLM-5.1\` | GLM-5.1 | ${MD_EM_DASH} | ${MD_EM_DASH} | $1.4/$4.4 ${MD_MIDDLE_DOT} cache $0.26 | Go and above | long-horizon autonomous coding agent |`,
  `| \`meituan/LongCat-2.0:free\` | LongCat 2.0 | 1.05M | ${MD_EM_DASH} | $0/$0 ${MD_MIDDLE_DOT} cache $0 | Go and above | trillion-parameter agentic coding with 1M context |`,
].join("\n")

const CAPABILITIES_HTML_FIXTURE = [
  '<table><tbody><tr class="border-b"><td><a class="x" href="/models/deepseek-v4-1-flash" data-discover="true"><span class="truncate text-white">DeepSeek V4.1 Flash</span></a></td>',
  '<td><button type="button" aria-label="Capabilities: Text input, Vision, Reasoning" class="x"></button></td></tr>',
  '<tr class="border-b"><td><a class="x" href="/models/grok-4-6" data-discover="true"><span class="truncate text-white">Grok 4.6</span></a></td>',
  '<td><button type="button" aria-label="Capabilities: Text input, Vision, Reasoning" class="x"></button></td></tr>',
  '<tr class="border-b"><td><a class="x" href="/models/claude-opus-5" data-discover="true"><span class="truncate text-white">Claude Opus 5</span></a></td>',
  '<td><button type="button" aria-label="Capabilities: Text input, Vision, Reasoning" class="x"></button></td></tr>',
  "</tbody></table>",
].join("")

function remoteFixture(): RemoteCatalog {
  return {
    version: "1.53.0",
    fetchedAt: Date.now(),
    catalog: parseCatalogMarkdown(CATALOG_MD_FIXTURE),
    caps: parseCapabilitiesHtml(CAPABILITIES_HTML_FIXTURE),
  }
}

test("parses the models.md catalog table", () => {
  const catalog = parseCatalogMarkdown(CATALOG_MD_FIXTURE)

  assert.deepEqual(catalog["deepseek/deepseek-v4.1-flash"], {
    name: "DeepSeek V4.1 Flash",
    context: 1_000_000,
    efforts: ["low", "high", "max"],
    cost: { input: 0.15, output: 0.6, cache_read: 0.003 },
    visionHint: true,
  })
  assert.deepEqual(catalog["gpt-5.6-sol"], {
    name: "GPT-5.6 Sol",
    context: 1_050_000,
    efforts: ["low", "medium", "high", "xhigh", "max"],
    cost: { input: 5, output: 30, cache_read: 0.5, cache_write: 6.25 },
  })
  assert.equal(catalog["zai-org/GLM-5.1"].context, undefined)
  assert.deepEqual(catalog["zai-org/GLM-5.1"].efforts, [])
  assert.deepEqual(catalog["meituan/LongCat-2.0:free"].cost, { input: 0, output: 0, cache_read: 0 })
  assert.equal(catalog["meituan/LongCat-2.0:free"].visionHint, undefined)
})

test("parses the models page capabilities table", () => {
  const caps = parseCapabilitiesHtml(CAPABILITIES_HTML_FIXTURE)

  assert.deepEqual(caps["DeepSeek V4.1 Flash"], { vision: true, reasoning: true })
  assert.deepEqual(caps["Grok 4.6"], { vision: true, reasoning: true })
  assert.equal(Object.keys(caps).length, 3)
})

test("remote catalog drives variants, cost and vision of live models", () => {
  const remote = remoteFixture()
  const models = mergeRemoteModels(
    [
      { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", context_length: 1_000_000 },
      { id: "xai/grok-4.6", name: "Grok 4.6", context_length: 500_000 },
      { id: "meituan/LongCat-2.0:free", name: "LongCat 2.0", context_length: 1_048_576 },
    ],
    remote,
  )

  const config: any = {}
  applyConfig(config, "test-key", models)

  const deepseek = config.provider.commandcode.models["deepseek/deepseek-v4.1-flash"]
  assert.deepEqual(Object.keys(deepseek.variants), ["low", "high", "max"])
  assert.equal(deepseek.attachment, true)
  assert.equal(deepseek.cost.input, 0.15)
  assert.equal(deepseek.cost.output, 0.6)

  // O snapshot estatico dizia grok-4.6 sem vision; o site manda com vision.
  const grok = config.provider.commandcode.models["xai/grok-4.6"]
  assert.equal(grok.attachment, true)

  const longcat = config.provider.commandcode.models["meituan/LongCat-2.0:free"]
  assert.equal(longcat.reasoning, true)
  assert.ok(Object.values(longcat.variants).every((variant: any) => variant.disabled === true))
})

const EXPECTED_VARIANTS: Readonly<Record<string, readonly string[]>> = {
  "claude-fable-5-1": ["low", "medium", "high", "xhigh", "max"],
  "deepseek/deepseek-v4-flash-fast": ["low", "high", "max"],
  "deepseek/deepseek-v4-flash-vision-exp": ["high", "max"],
  "deepseek/deepseek-v4.1-flash": ["low", "high", "max"],
  "google/gemini-3.8-flash": ["low", "medium", "high"],
  "gpt-6-astra": ["low", "medium", "high", "xhigh", "max"],
  "meta/muse-spark-1.1": ["low", "medium", "high", "xhigh"],
  "meta/muse-spark-1.2": ["low", "medium", "high", "xhigh"],
  "meta/muse-spark-1.2-contributor": ["low", "medium", "high", "xhigh"],
  "meta/muse-spark-1.3": ["low", "medium", "high", "xhigh", "max"],
  "meta/muse-spark-1.3-contributor": ["low", "medium", "high", "xhigh"],
  "moonshotai/Kimi-K3": ["low", "high", "max"],
  "Qwen/Qwen3.8-Flash": ["low", "medium", "xhigh"],
  "Qwen/Qwen3.8-Max-0902": ["low", "medium", "xhigh"],
  "tencent/hy4-preview": ["low", "medium", "high"],
  "z-ai/glm-5.3-flash": ["low", "high", "max"],
}

const NEW_MODEL_SPECS = {
  "claude-fable-5-1": { attachment: true, reasoning: true, input: 10, output: 50 },
  "deepseek/deepseek-v4-flash-fast": { attachment: false, reasoning: true, input: 0.28, output: 0.56 },
  "deepseek/deepseek-v4.1-flash": { attachment: true, reasoning: true, input: 0.15, output: 0.6 },
  "google/gemini-3.8-flash": { attachment: true, reasoning: true, input: 1.5, output: 7.5 },
  "gpt-6-astra": { attachment: true, reasoning: true, input: 10, output: 50 },
  "inclusionai/ling-3.0-flash-sante:free": { attachment: false, reasoning: true, input: 0, output: 0 },
  "meituan/LongCat-2.0:free": { attachment: false, reasoning: true, input: 0, output: 0 },
  "meta/muse-spark-1.3": { attachment: true, reasoning: true, input: 1.25, output: 4.25 },
  "meta/muse-spark-1.3-contributor": { attachment: true, reasoning: true, input: 0.1, output: 0.2 },
  "Qwen/Qwen3.8-Flash": { attachment: true, reasoning: true, input: 0.16, output: 0.47 },
  "Qwen/Qwen3.8-Max-0902": { attachment: true, reasoning: true, input: 2, output: 6 },
  "tencent/hy4-preview": { attachment: false, reasoning: true, input: 0.834, output: 2.501 },
  "z-ai/glm-5.3-flash": { attachment: true, reasoning: true, input: 0.15, output: 0.5 },
} as const

function model(id: string): CommandCodeModel {
  return { id, name: id, context_length: 1_000_000 }
}

test("applies the current Command Code reasoning variants", () => {
  const config: any = {}
  applyConfig(config, "test-key", Object.keys(EXPECTED_VARIANTS).map(model))

  for (const [id, expected] of Object.entries(EXPECTED_VARIANTS)) {
    assert.deepEqual(Object.keys(config.provider.commandcode.models[id].variants ?? {}), expected, id)
  }
})

test("applies current metadata to newly published models", () => {
  const config: any = {}
  applyConfig(config, "test-key", Object.keys(NEW_MODEL_SPECS).map(model))

  for (const [id, expected] of Object.entries(NEW_MODEL_SPECS)) {
    const actual = config.provider.commandcode.models[id]
    assert.equal(actual.attachment, expected.attachment, `${id} attachment`)
    assert.equal(actual.reasoning, expected.reasoning, `${id} reasoning`)
    assert.equal(actual.cost.input, expected.input, `${id} input cost`)
    assert.equal(actual.cost.output, expected.output, `${id} output cost`)
  }
})

test("disables OpenCode variants when Command Code publishes no efforts", () => {
  const config: any = {}
  applyConfig(config, "test-key", [model("MiniMaxAI/MiniMax-M3"), model("tencent/hy3-paid")])

  for (const id of ["MiniMaxAI/MiniMax-M3", "tencent/hy3-paid"]) {
    const variants = config.provider.commandcode.models[id].variants
    assert.ok(variants, id)
    assert.deepEqual(Object.keys(variants), ["none", "thinking", "low", "medium", "high", "xhigh", "max"])
    assert.ok(Object.values(variants).every((variant: any) => variant.disabled === true), id)
  }
})

test("includes GPT-6 Astra while the live models endpoint lags", async () => {
  const originalFetch = globalThis.fetch
  const originalApiKey = process.env.CMD_API_KEY
  process.env.CMD_API_KEY = "test-key"
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        object: "list",
        data: [{ id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", context_length: 1_000_000 }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )

  try {
    const plugin = await CommandCodePlugin({ client: { app: { log: async () => undefined } } } as any)
    assert.equal(typeof plugin.config, "function")
    const config: any = {}
    await plugin.config!(config)

    const astra = config.provider.commandcode.models["gpt-6-astra"]
    assert.equal(astra.name, "GPT-6 Astra")
    assert.equal(astra.limit.context, 1_050_000)
    assert.deepEqual(Object.keys(astra.variants), ["low", "medium", "high", "xhigh", "max"])
  } finally {
    globalThis.fetch = originalFetch
    if (originalApiKey === undefined) delete process.env.CMD_API_KEY
    else process.env.CMD_API_KEY = originalApiKey
  }
})
