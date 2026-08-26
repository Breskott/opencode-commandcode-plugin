# opencode-commandcode-plugin

[![Licença: MIT](https://img.shields.io/badge/Licen%C3%A7a-MIT-yellow.svg)](LICENSE)
[![OpenCode](https://img.shields.io/badge/OpenCode-1.x%20%7C%202.x%20(beta)-blueviolet)](https://opencode.ai)
[![Command Code](https://img.shields.io/badge/Provider-Command%20Code-00A86B)](https://commandcode.ai)

> 🇬🇧 **[English version](README.md)**

Plugins que integram o gateway [Command Code](https://commandcode.ai) ao [OpenCode](https://opencode.ai) como provider nativo.

Este repositório traz **dois plugins** — um pra cada major do OpenCode:

| Arquivo | OpenCode | Status |
| --- | --- | --- |
| `commandcode-v1.ts` | **v1** (stable) | Use com OpenCode 1.x |
| `commandcode-v2.ts` | **v2** (beta) | Use com OpenCode 2.x (beta) |

> Use **apenas um** deles, de acordo com a sua versão do OpenCode. Os dois compartilham o mesmo catálogo estático de modelos (58 modelos, snapshot de 25/08/2026), mas a forma de declarar provider e capabilities mudou entre v1 e v2.

---

## O que o plugin faz

A Command Code é um gateway OpenAI-compatible focado em coding agents. Ela expõe `GET /provider/v1/models`, mas a resposta traz **só** `id`, `name` e `context_length` — não tem `capabilities` (visão, ferramentas, reasoning) nem `cost` (preço por token).

Os dois plugins fazem a mesma coisa:

1. Descobrem os modelos via `GET https://api.commandcode.ai/provider/v1/models` (cache em memória de 5 min).
2. Cruzam cada id com um **catálogo estático embutido** (capabilities + preço + context window + max output + reasoning efforts) e completam o que a API não devolve.
3. Registram o provider `commandcode` no OpenCode, com `baseURL` e `apiKey` apontando pra Command Code.

Resultado: todos os modelos da Command Code aparecem na TUI do OpenCode com capacidade de attachment correta, custo real por 1M de tokens, e seletor de reasoning effort (low / medium / high / xhigh / max) onde o modelo suporta.

---

## Pré-requisitos

- Node.js + TypeScript (ou Bun / Deno — qualquer runtime que o seu OpenCode rodar)
- Uma conta na Command Code com API key
- OpenCode instalado

---

## Instalação (Windows / PowerShell)

### 1. Defina a `CMD_API_KEY` no escopo **User** (recomendado)

O escopo **User** mantém a chave restrita ao seu usuário do Windows — não vaza pra outros usuários da máquina nem exige admin.

```powershell
$env:CMD_API_KEY = Read-Host "CMD_API_KEY" -MaskInput
[Environment]::SetEnvironmentVariable("CMD_API_KEY", $env:CMD_API_KEY, "User")
```

Reabra o terminal depois pra variável carregar nas novas sessões. Verifique com:

```powershell
[Environment]::GetEnvironmentVariable("CMD_API_KEY", "User")
```

> **Outros escopos (opcional):**
> - `Process` — vale só na sessão atual do PowerShell (`$env:CMD_API_KEY = "..."`). Some quando fecha.
> - `Machine` — vale pra todos os usuários do PC. Exige PowerShell elevado: `[Environment]::SetEnvironmentVariable("CMD_API_KEY", "...", "Machine")`. Use só se o PC é seu ou se outros usuários também vão rodar OpenCode com Command Code.

### 2. Copie o plugin pra `~/.config/opencode/plugin/`

Baixe o arquivo certo pra sua versão:

- v1 → baixe `commandcode-v1.ts`
- v2 → baixe `commandcode-v2.ts`

E coloque em:

- **Windows:** `%USERPROFILE%\.config\opencode\plugin\`
- **Linux / macOS:** `~/.config/opencode/plugin/`

O OpenCode carrega todo `.ts` / `.js` desse diretório automaticamente.

### 3. Reinicie o OpenCode

Pronto. O provider `commandcode` aparece no seletor de modelos com todos os modelos da Command Code, capabilities corretas, e variants de reasoning onde aplicável.

---

## Qual arquivo usar? v1 ou v2

| | `commandcode-v1.ts` | `commandcode-v2.ts` |
| --- | --- | --- |
| **Versão do OpenCode** | 1.x (stable) | 2.x (beta) |
| **API de import** | `import type { Config, Plugin } from "@opencode-ai/plugin"` | `import { define, type CatalogDraft } from "@opencode-ai/plugin/v2/promise"` |
| **Como registra o provider** | `config.provider[id] = {...}` direto via hook `config` | `ctx.catalog.transform(catalog => ...)` |
| **Como recarrega modelos** | Discovery dentro do `config` (cache em memória) | Discovery em background + `catalog.reload()` quando a lista muda |
| **Campo do package AI SDK** | `npm: "@ai-sdk/openai-compatible"` | `package: "aisdk:@ai-sdk/openai-compatible"` (com prefixo `aisdk:`) |
| **Bloco de attachment** | `attachment: true` + `modalities: { input: ["text","image"] }` | `capabilities: { tools, input: ["text","image"], output: ["text"] }` (sem flag `attachment`) |
| **Formato de `cost`** | Objeto `{ input, output, cache_read, cache_write }` | Array `ModelCost[]` com `{ input, output, cache: { read, write } }` |
| **`variants` (reasoning)** | Objeto nomeado `{ low: { reasoningEffort: "low" }, ... }` | Array `{ id, headers: {}, body: { reasoningEffort } }[]` |
| **`limit`** | Exige `context` E `output` | `context` obrigatório; `output` cai no default se ausente |
| **API bloqueante?** | Sim (await dentro de `config`) | Não (transform é síncrono; discovery roda em background) |

**Resumo:** o v2 troca a forma de declarar o provider (passa a usar o `catalog` oficial do opencode2 com prefixo `aisdk:`), transforma `cost` em array, e tira o `attachment` (substituído por `capabilities.input`). Comportamento de runtime (modelos, cache, capabilities, fallback estático) é idêntico.

---

## Como a API key é lida

Ambos os plugins leem a chave da env var `process.env.CMD_API_KEY`. **Não há `npm install`, `dotenv` nem `opencode.json` envolvido** — seta a variável e reinicia o OpenCode.

Se `CMD_API_KEY` não estiver definida, o plugin só loga um aviso (`provider não carregado`) e segue a vida. O OpenCode não quebra.

---

## Customização

Ambos os plugins expõem um bloco `MODEL_OVERRIDES` no topo pra você forçar capabilities de um modelo específico sem editar o catálogo:

```ts
const MODEL_OVERRIDES = {
  // "MiniMaxAI/MiniMax-M3": { input: ["text", "image"] },
}
```

No v2 o override aceita `{ input?: Modality[], tool_call?: boolean }`. No v1, aceita também `reasoning?: boolean`.

A cascata de decisão é:

1. `MODEL_OVERRIDES[id]` (seu override manual — sempre vence)
2. `CATALOG[id]` (snapshot estático embutido)
3. Prefixo do id (heurística pra modelos novos lançados depois do snapshot)

Modelos que caem no nível 3 entram com defaults conservadores (só texto, sem reasoning, custo `$0.00`) e disparam um aviso no log: `N modelo(s) fora do snapshot do catalogo`.

---

## Atualizando o catálogo

Quando a Command Code lançar modelos ou mudar preço / capabilities:

1. Confira a lista oficial em <https://commandcode.ai/models>.
2. Edite as tabelas `CATALOG`, `CONTEXT_WINDOW`, `MAX_OUTPUT` e `REASONING_EFFORTS` no arquivo da sua versão.
3. Abra um PR com a atualização (compare com a data do snapshot no comentário no topo).

---

## Mensagens do plugin no log

Os dois plugins usam `client.app.log` quando o `client` está disponível (v1) ou `console.info` / `console.warn` (v2). Você verá linhas como:

```
[commandcode] 58 modelos descobertos (44 com attachment).
[commandcode] 2 modelo(s) fora do snapshot do catalogo { ids: "modelo-novo-1, modelo-novo-2" }
[commandcode] descoberta de modelos falhou: ...
```

Se a descoberta falhar (rede fora, key inválida), o plugin **não** derruba o OpenCode — ele cai pro snapshot estático embutido e segue.

---

## Compatibilidade

- **OpenCode 1.x** → use `commandcode-v1.ts`.
- **OpenCode 2.x (beta)** → use `commandcode-v2.ts`.
- Misturar (v1 em OpenCode 2, ou v2 em OpenCode 1) **não funciona** — os tipos `Config` / `Plugin` / `define` / `CatalogDraft` são incompatíveis.

---

## Créditos

- Provider: [Command Code](https://commandcode.ai) — gateway OpenAI-compatible focado em coding agents.
- Cliente: [OpenCode](https://opencode.ai) — AI coding agent open-source.
- Mantido por **Victor Brescott** ([@Breskott](https://github.com/Breskott)).
- Licença: MIT — use à vontade.