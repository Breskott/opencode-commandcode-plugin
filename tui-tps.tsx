/** @jsxImportSource @opentui/solid */
import { Show, createMemo, createSignal } from "solid-js"
import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import type { Plugin } from "@opencode/plugin/tui"

// Medidor de tokens por segundo (TPS) da TUI. Nao depende de nenhum outro
// plugin. Um unico modulo serve os dois runtimes:
//   - OpenCode 1.x: `tui` — slot `session_prompt_right` (lado direito da linha do modelo)
//   - OpenCode 2.x: `setup` — claim em `prompt.footer` (canto direito do rodape do prompt)
// Em ambos:
//   - durante a geracao: estimativa ao vivo (~42.5 tok/s), janela rolante de 5s
//   - turno concluido: valor exato (42.5 tok/s), tokens de saida reais / duracao

const SAMPLE_WINDOW_MS = 5_000
const LIVE_STALE_MS = 1_500
const TICK_MS = 1_000
const BYTES_PER_TOKEN = 5

type Sample = { tokens: number; at: number }
type Samples = Map<string, Sample[]>

const estimateTokens = (text: string) =>
  Math.max(1, Math.ceil(new TextEncoder().encode(text).length / BYTES_PER_TOKEN))

// Estimativa ao vivo: soma os deltas recebidos na janela rolante e divide pelo
// tempo ativo entre eles (pausas de tool call nao entram). Mesma ideia do
// opencode-tps (github.com/williamcr01/opencode-tps).
const calcLive = (samples: Samples, sessionID: string): number | undefined => {
  const list = samples.get(sessionID)
  const last = list?.at(-1)
  if (!list || !last) return
  const now = Date.now()
  if (now - last.at > LIVE_STALE_MS) return
  const fresh = list.filter((sample) => now - sample.at <= SAMPLE_WINDOW_MS)
  if (fresh.length === 0) return
  const tokens = fresh.reduce((total, sample) => total + sample.tokens, 0)
  let duration = 0
  for (let index = 1; index < fresh.length; index++) duration += Math.max(0, fresh[index].at - fresh[index - 1].at)
  duration += Math.min(now - fresh[fresh.length - 1].at, TICK_MS)
  if (tokens <= 0 || duration <= 0) return
  return (tokens / duration) * 1_000
}

const pushSample = (samples: Samples, sessionID: string, delta: string) => {
  if (delta.length === 0) return false
  const list = samples.get(sessionID) ?? []
  list.push({ tokens: estimateTokens(delta), at: Date.now() })
  samples.set(sessionID, list)
  return true
}

const pruneSamples = (samples: Samples) => {
  const now = Date.now()
  for (const [sessionID, list] of samples) {
    const fresh = list.filter((sample) => now - sample.at <= SAMPLE_WINDOW_MS)
    if (fresh.length === 0) samples.delete(sessionID)
    else samples.set(sessionID, fresh)
  }
}

const tui: TuiPlugin = async (api) => {
  const samples: Samples = new Map()
  const [version, setVersion] = createSignal(0)
  const [tick, setTick] = createSignal(0)

  const busy = (sessionID: string) => {
    const status = api.state.session.status(sessionID)
    return status !== undefined && status.type !== "idle"
  }

  // Inicio real da geracao do step: primeiro part de texto/reasoning. Cai no
  // `time.created` do step quando nao ha conteudo visivel (ex: so tool call).
  const generationStart = (messageID: string): number | undefined => {
    let start: number | undefined
    for (const part of api.state.part(messageID)) {
      if (part.type !== "text" && part.type !== "reasoning") continue
      const value = part.time?.start
      if (value === undefined) continue
      if (start === undefined || value < start) start = value
    }
    return start
  }

  // Valor exato do ultimo turno: soma os tokens.output reais dos steps
  // concluidos e divide pela duracao de geracao de cada um.
  const calcTurn = (sessionID: string): number | undefined => {
    const messages = api.state.session.messages(sessionID)
    const user = messages.findLast((message) => message.role === "user")
    if (!user) return
    let output = 0
    let duration = 0
    let steps = 0
    for (const message of messages) {
      if (message.role !== "assistant" || message.parentID !== user.id) continue
      if (message.time.completed === undefined) continue
      const start = generationStart(message.id) ?? message.time.created
      output += message.tokens.output
      duration += Math.max(0, message.time.completed - start)
      steps++
    }
    if (steps === 0 || output <= 0 || duration <= 0) return
    return (output / duration) * 1_000
  }

  const unsubDelta = api.event.on("message.part.delta", (event) => {
    const { sessionID, field, delta } = event.properties
    if (field !== "text" || typeof delta !== "string") return
    if (!busy(sessionID)) return
    if (pushSample(samples, sessionID, delta)) setVersion((value) => value + 1)
  })

  const unsubUpdated = api.event.on("message.updated", (event) => {
    const info = event.properties.info
    if (info.role !== "assistant" || info.time.completed === undefined) return
    samples.delete(info.sessionID)
    setVersion((value) => value + 1)
  })

  const interval = setInterval(() => {
    pruneSamples(samples)
    setTick((value) => value + 1)
  }, TICK_MS)

  api.lifecycle.onDispose(() => {
    unsubDelta()
    unsubUpdated()
    clearInterval(interval)
  })

  api.slots.register({
    slots: {
      session_prompt_right(ctx, props) {
        const sessionID = props.session_id
        const value = createMemo(() => {
          version()
          tick()
          if (busy(sessionID)) {
            const live = calcLive(samples, sessionID)
            return live === undefined ? undefined : `~${live.toFixed(1)} tok/s`
          }
          const turn = calcTurn(sessionID)
          return turn === undefined ? undefined : `${turn.toFixed(1)} tok/s`
        })
        return (
          <Show when={value()}>
            {(item) => <text fg={ctx.theme.current.textMuted}>{item()}</text>}
          </Show>
        )
      },
    },
  })
}

const setup: Plugin.Definition["setup"] = (context) => {
  const samples: Samples = new Map()
  const [version, setVersion] = createSignal(0)
  const [tick, setTick] = createSignal(0)

  const busy = (sessionID: string) => context.data.session.status(sessionID) === "running"

  // Valor exato do ultimo turno no v2, mesmo calculo do rodape nativo de
  // tok/s: para cada step assistant do turno, tokens.output reais divididos
  // pela janela de geracao (time.streamed - time.created). Se algum step do
  // turno ainda nao terminou de streamar, cai para a estimativa ao vivo.
  const calcTurn = (sessionID: string): number | undefined => {
    const messages = context.data.session.message.list(sessionID)
    let boundary = -1
    for (let index = messages.length - 1; index >= 0; index--) {
      const type = messages[index].type
      if (type === "user" || type === "synthetic") {
        boundary = index
        break
      }
    }
    const assistants = messages.slice(boundary + 1).filter((message) => message.type === "assistant")
    if (assistants.length === 0) return
    let output = 0
    let duration = 0
    for (const message of assistants) {
      if (message.time.streamed === undefined) return
      output += message.tokens?.output ?? 0
      duration += Math.max(0, message.time.streamed - message.time.created)
    }
    if (output <= 0 || duration <= 0) return
    return (output / duration) * 1_000
  }

  const collect = (sessionID: string, delta: string) => {
    if (!busy(sessionID)) return
    if (!pushSample(samples, sessionID, delta)) return
    setVersion((value) => value + 1)
  }

  // No OpenCode 2 os fragmentos de stream chegam como eventos efemeros
  // session.{text,reasoning,tool.input}.delta — todos sao tokens de saida.
  const offText = context.data.on("session.text.delta", (event) => collect(event.data.sessionID, event.data.delta))
  const offReasoning = context.data.on("session.reasoning.delta", (event) =>
    collect(event.data.sessionID, event.data.delta),
  )
  const offTool = context.data.on("session.tool.input.delta", (event) =>
    collect(event.data.sessionID, event.data.delta),
  )

  const interval = setInterval(() => {
    pruneSamples(samples)
    setTick((value) => value + 1)
  }, TICK_MS)

  const release = context.ui.slot({
    append: "prompt.footer",
    render: (props) => {
      const value = createMemo(() => {
        const sessionID = props.sessionID
        if (sessionID === undefined) return undefined
        version()
        tick()
        if (busy(sessionID)) {
          const live = calcLive(samples, sessionID)
          return live === undefined ? undefined : `~${live.toFixed(1)} tok/s`
        }
        const turn = calcTurn(sessionID)
        return turn === undefined ? undefined : `${turn.toFixed(1)} tok/s`
      })
      return (
        <Show when={value()}>
          {(item) => (
            <text fg={context.theme.text.subdued} wrapMode="none">
              {item()}
            </text>
          )}
        </Show>
      )
    },
  })

  return () => {
    release()
    offText()
    offReasoning()
    offTool()
    clearInterval(interval)
  }
}

export default {
  id: "tui-tps",
  tui,
  setup,
}
