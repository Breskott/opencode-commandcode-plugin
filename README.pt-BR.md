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

> Use **apenas um** deles, de acordo com a sua versão do OpenCode. Os dois diferem na forma de declarar provider e capabilities; o comportamento de runtime (descoberta ao vivo do `/models`, catálogo embutido pra vision / cost / reasoning efforts) é o mesmo.

---

## O que o plugin faz

A Command Code é um gateway OpenAI-compatible focado em coding agents. Ela expõe `GET /provider/v1/models`, e a resposta traz `id`, `name` e `context_length` pra todos os modelos — mas **não** tem `capabilities` (visão, ferramentas, reasoning) nem `cost` (preço por token).

Os dois plugins fazem a mesma coisa:

1. **Descobrem os modelos ao vivo** em `GET https://api.commandcode.ai/provider/v1/models` — `id`, `name` e `context_length` vêm direto da API.
2. **Cruzam cada id com um catálogo estático embutido** (`CATALOG`) que guarda o que a API não devolve: `vision`, `reasoning` e `cost` (por 1M de tokens, USD).
3. **Anexam as variants de reasoning effort** a partir de `REASONING_EFFORTS`, por id de modelo, pra que os modelos com reasoning tenham o seletor `low / medium / high / xhigh / max`.
4. **Registram o provider `commandcode`** no OpenCode, com `baseURL` e `apiKey` apontando pra Command Code.

Resultado: todos os modelos da Command Code aparecem na TUI do OpenCode com a janela de contexto certa (vinda da API), a capability de attachment / tools certa (do catálogo + heurística de prefixo), o custo real por 1M de tokens (do catálogo), e variants de reasoning onde o modelo suporta.

### O que mudou nesta versão

Antes os plugins também mantinham uma tabela hardcoded `CONTEXT_WINDOW` / `MAX_OUTPUT` por id de modelo. Esses dados agora vêm da resposta ao vivo de `/models` (e de um `MAX_OUTPUT` curtinho pros dois modelos em que a API não expõe max output, mais um par `DEFAULT_*` como último recurso). Reasoning efforts, flag de vision e custo continuam precisando ser declarados manualmente porque a API não expõe nenhum dos três.

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

Pronto. O provider `commandcode` aparece no seletor de modelos com todos os modelos da Command Code, a janela de contexto certa, capabilities corretas, e variants de reasoning onde aplicável.

---

## Qual arquivo usar? v1 ou v2

| | `commandcode-v1.ts` | `commandcode-v2.ts` |
| --- | --- | --- |
| **Versão do OpenCode** | 1.x (stable) | 2.x (beta) |
| **API de import** | `import type { Config, Plugin } from "@opencode-ai/plugin"` | `import { define, type CatalogDraft } from "@opencode-ai/plugin/v2/promise"` |
| **Como registra o provider** | `config.provider[id] = {...}` direto via hook `config` | `ctx.catalog.transform(catalog => ...)` |
| **Como recarrega modelos** | Discovery dentro do `config` (cache em memória de 5 min) | Discovery em background + `catalog.reload()` quando a lista de ids muda |
| **Campo do package AI SDK** | `npm: "@ai-sdk/openai-compatible"` | `package: "aisdk:@ai-sdk/openai-compatible"` (com prefixo `aisdk:`, setado no nível do provider e em cada modelo) |
| **Bloco de attachment** | `attachment: true` + `modalities: { input: ["text","image"] }` | `capabilities: { tools, input: ["text","image"], output: ["text"] }` (sem flag `attachment`) |
| **Formato de `cost`** | Objeto `{ input, output, cache_read, cache_write }` | Array `ModelCost[]` com `{ input, output, cache: { read, write } }` |
| **`variants` (reasoning)** | Objeto nomeado `{ low: { reasoningEffort: "low" }, ... }` | Array `{ id, headers: {}, body: { reasoningEffort } }[]` |
| **`limit.context`** | `model.context_length` do `/models`, cai em `DEFAULT_CONTEXT_TOKENS` (200k) | Igual |
| **`limit.output`** | `MAX_OUTPUT[id]` (2 entradas) → `DEFAULT_OUTPUT_TOKENS` (32k) | Igual |
| **API bloqueante?** | Sim (await dentro de `config`) | Não (transform é síncrono; discovery roda em background a cada 5 min) |
| **Fallback quando `/models` falha** | `FALLBACK_MODELS` = `Object.keys(CATALOG)` (só os ids, sem context_length) | `discovered` fica vazio; o provider registra mas nenhum modelo aparece até o próximo refresh bem-sucedido |

**Resumo:** o v2 troca a forma de declarar o provider (passa a usar o `catalog` oficial do opencode2 com prefixo `aisdk:`), transforma `cost` em array, tira o `attachment` (substituído por `capabilities.input`) e tira a discovery do caminho de boot, então o startup do OpenCode nunca trava esperando a API da Command Code. As fontes de dados (`/models` pra ids e context, `CATALOG` pra vision / cost, `REASONING_EFFORTS` pra variants) são as mesmas nos dois.

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
2. Edite as tabelas `CATALOG` e `REASONING_EFFORTS` no arquivo da sua versão. O `MAX_OUTPUT` só precisa ser tocado pro modelo raro cujo max output você queira pinar (a API não expõe).
3. Abra um PR com a atualização (compare com a data do snapshot no comentário no topo).

Você **não** precisa editar nada pra lista de modelos em si nem pra janela de contexto — ambos vêm do `/models` em runtime.

---

## Mensagens do plugin no log

Os dois plugins emitem as mesmas linhas de diagnóstico, só que pra destinos diferentes:

- **v1:** `client.app.log` quando o `client` tá disponível; cai pra `console.warn` caso contrário.
- **v2:** `console.info` / `console.warn`.

Você verá linhas como:

```
[commandcode] 58 modelos descobertos (44 com attachment).
[commandcode] 2 modelo(s) fora do snapshot do catalogo { ids: "modelo-novo-1, modelo-novo-2" }
[commandcode] 1 modelo(s) sem context_length na API { ids: "..." }
[commandcode] descoberta de modelos falhou: ...
```

Se a descoberta falhar na primeira chamada (v1), o plugin **não** derruba o OpenCode — ele cai pros ids do `CATALOG` e segue. No v2 o fallback é começar com a lista vazia; o próximo tick de refresh (5 minutos depois) tenta de novo.

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
