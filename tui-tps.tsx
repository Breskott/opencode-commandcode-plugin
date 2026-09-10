/** @jsxImportSource @opentui/solid */
import { Show, createMemo, createSignal } from "solid-js"
import type { TuiPlugin } from "@opencode-ai/plugin/tui"

// Medidor de tokens por segundo (TPS) da TUI. Nao depende de nenhum outro
// plugin. Fica no slot `session_prompt_right` (lado direito da linha do modelo):
//   - durante a geracao: estimativa ao vivo (~42.5 tok/s), janela rolante de 5s
//   - turno concluido: valor exato (42.5 tok/s), tokens.output reais / duracao
// Registro: tui.json -> { "plugin": ["./plugins/tui-tps.tsx"] }

const SAMPLE_WINDOW_MS = 5_000
const LIVE_STALE_MS = 1_500
const TICK_MS = 1_000
const BYTES_PER_TOKEN = 5

type Sample = { tokens: number; at: number }

const tui: TuiPlugin = async (api) => {
  const samples = new Map<string, Sample[]>()
  const [version, setVersion] = createSignal(0)
  const [tick, setTick] = createSignal(0)

  const estimateTokens = (text: string) =>
    Math.max(1, Math.ceil(new TextEncoder().encode(text).length / BYTES_PER_TOKEN))

  const busy = (sessionID: string) => {
    const status = api.state.session.status(sessionID)
    return status !== undefined && status.type !== "idle"
  }

  // Estimativa ao vivo: soma os deltas de texto recebidos na janela rolante e
  // divide pelo tempo ativo entre eles (pausas de tool call nao entram).
  // Mesma ideia do opencode-tps (github.com/williamcr01/opencode-tps).
  const calcLive = (sessionID: string): number | undefined => {
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

  // Inicio real da geracao do step: primeiro part de texto/reasoning. Cai no
  // `time.created` do step quando nao ha conteudo visivel (ex: so tool call).
  const generationStart = (messageID: string): number | undefined => {
    let start: number | undefined
    for (const part of api.state.part(messageID)) {
      if (part.type !== "text" && part.type !== "reasoning") continue
      const value = part.time.start
      if (start === undefined || value < start) start = value
    }
    return start
  }

  // Valor exato do ultimo turno, no espirito do v2: soma os tokens.output
  // reais dos steps concluidos e divide pela duracao de geracao de cada um.
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
    if (field !== "text" || typeof delta !== "string" || delta.length === 0) return
    if (!busy(sessionID)) return
    const list = samples.get(sessionID) ?? []
    list.push({ tokens: estimateTokens(delta), at: Date.now() })
    samples.set(sessionID, list)
    setVersion((value) => value + 1)
  })

  const unsubUpdated = api.event.on("message.updated", (event) => {
    const info = event.properties.info
    if (info.role !== "assistant" || info.time.completed === undefined) return
    samples.delete(info.sessionID)
    setVersion((value) => value + 1)
  })

  const interval = setInterval(() => {
    const now = Date.now()
    for (const [sessionID, list] of samples) {
      const fresh = list.filter((sample) => now - sample.at <= SAMPLE_WINDOW_MS)
      if (fresh.length === 0) samples.delete(sessionID)
      else samples.set(sessionID, fresh)
    }
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
            const live = calcLive(sessionID)
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

export default {
  id: "tui-tps",
  tui,
}
