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

> Use **apenas um** deles, de acordo com a sua versão do OpenCode. Os dois diferem na forma de declarar provider e capabilities; o comportamento de runtime (descoberta ao vivo do `/models` + catálogo resolvido ao vivo do pacote npm e da página de modelos, com snapshot embutido de fallback offline) é o mesmo.

---

## O que o plugin faz

A Command Code é um gateway OpenAI-compatible focado em coding agents. Ela expõe `GET /provider/v1/models`, e a resposta traz `id`, `name` e `context_length` pra todos os modelos — mas **não** tem `capabilities` (visão, ferramentas, reasoning) nem `cost` (preço por token).

Os dois plugins fazem a mesma coisa:

1. **Descobrem os modelos ao vivo** em `GET https://api.commandcode.ai/provider/v1/models` — `id`, `name` e `context_length` vêm direto da API.
2. **Resolvem o resto do catálogo em runtime** a partir do que a própria Command Code publica:
   - **`models.md` dentro do pacote npm [`command-code`](https://www.npmjs.com/package/command-code)** — reasoning efforts, preços, janela de contexto e nomes de exibição. A versão mais recente é resolvida no registry do npm e o arquivo é servido via unpkg, com jsdelivr de fallback.
   - **<https://commandcode.ai/models>** — as capabilities `Vision` / `Reasoning` por modelo.
   - Os dois ficam em cache em disco por 6 horas (`~/.cache/opencode/commandcode-catalog.json`, respeita `XDG_CACHE_HOME`), então reiniciar não bate na rede de novo.
3. **Enriquecem cada modelo com esses dados**: custo real por 1M de tokens, capability de attachment (vision) e variants de reasoning effort (`low / medium / high / xhigh / max` onde o modelo suporta).
4. **Registram o provider `commandcode`** no OpenCode, com `baseURL` e `apiKey` apontando pra Command Code.

Resultado: todos os modelos da Command Code aparecem na TUI do OpenCode com a janela de contexto certa (vinda da API), metadados de catálogo (efforts / cost / vision) sempre frescos sem editar o plugin, e variants de reasoning onde o modelo suporta.

### O que mudou nesta versão

Antes os plugins traziam vision / cost / efforts num snapshot hardcoded que precisava ser editado na mão sempre que a Command Code mudava algo. Esse snapshot agora é **só fallback**: o plugin resolve o catálogo em runtime a partir do pacote npm e da página de modelos, então modelos novos, mudanças de preço e correções de capability se propagam sozinhos. Offline, a cadeia de fallback é: último cache em disco → snapshot `CATALOG` embutido.

O `CONTEXT_WINDOW` também deixou de existir — o contexto vem da resposta ao vivo de `/models`. Um `MAX_OUTPUT` curtinho mais o par `DEFAULT_*` continuam como último recurso, porque nem a API nem a documentação expõem max output.

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
| **Como recarrega modelos** | Discovery dentro do `config` (cache em memória de 5 min) | Discovery em background + `catalog.reload()` quando a lista enriquecida de modelos muda |
| **Resolução do catálogo** | Ao vivo: `models.md` do pacote npm `command-code` + capabilities de `commandcode.ai/models`, cache em disco de 6h | Igual |
| **Campo do package AI SDK** | `npm: "@ai-sdk/openai-compatible"` | `package: "aisdk:@ai-sdk/openai-compatible"` (com prefixo `aisdk:`, setado no nível do provider e em cada modelo) |
| **Bloco de attachment** | `attachment: true` + `modalities: { input: ["text","image"] }` | `capabilities: { tools, input: ["text","image"], output: ["text"] }` (sem flag `attachment`) |
| **Formato de `cost`** | Objeto `{ input, output, cache_read, cache_write }` | Array `ModelCost[]` com `{ input, output, cache: { read, write } }` |
| **`variants` (reasoning)** | Objeto nomeado `{ low: { reasoningEffort: "low" }, ... }` | Array `{ id, headers: {}, body: { reasoningEffort } }[]` |
| **`limit.context`** | `model.context_length` do `/models`, cai em `DEFAULT_CONTEXT_TOKENS` (200k) | Igual |
| **`limit.output`** | `MAX_OUTPUT[id]` (mapa curto) → `DEFAULT_OUTPUT_TOKENS` (32k) | Igual |
| **API bloqueante?** | Sim (await dentro de `config`) | Não (transform é síncrono; discovery roda em background a cada 5 min) |
| **Fallback quando `/models` falha** | `FALLBACK_MODELS` = `Object.keys(CATALOG)` (só os ids, sem context_length). Falha do catálogo remoto: cache em disco vencido → snapshot `CATALOG` embutido | `discovered` fica vazio; o provider registra mas nenhum modelo aparece até o próximo refresh bem-sucedido. A cadeia de fallback do catálogo é a mesma do v1 |

**Resumo:** o v2 troca a forma de declarar o provider (passa a usar o `catalog` oficial do opencode2 com prefixo `aisdk:`), transforma `cost` em array, tira o `attachment` (substituído por `capabilities.input`) e tira a discovery do caminho de boot, então o startup do OpenCode nunca trava esperando a API da Command Code. As fontes de dados (`/models` pra ids e contexto; `models.md` do npm + `commandcode.ai/models` pra efforts / cost / vision, com `CATALOG` como fallback offline) são as mesmas nos dois.

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

As duas versões aceitam `{ input?: Modality[], tool_call?: boolean, reasoning?: boolean }`.

A cascata de decisão é:

1. `MODEL_OVERRIDES[id]` (seu override manual — sempre vence)
2. Catálogo remoto (capabilities de <https://commandcode.ai/models>; efforts / cost / nomes do `models.md` do npm)
3. `CATALOG[id]` (snapshot estático embutido, fallback offline)
4. Prefixo do id (heurística pra modelos novos sem dado remoto nem embutido)

Modelos que caem no nível 4 entram com defaults conservadores (só texto, custo `$0.00`) e disparam um aviso no log: `N modelo(s) fora do snapshot do catalogo`. Reasoning efforts seguem a mesma ordem; modelo sem efforts conhecidos fica sem seletor de variant (o modelo decide) — exceto ids desconhecidos no v2, que ganham o genérico `low / medium / high`.

---

## Atualizando o catálogo

Normalmente você não precisa. Modelos novos, mudanças de preço e correções de capability são capturados automaticamente do `models.md` do npm e da página de modelos dentro da janela de cache de 6 horas.

Pra forçar um refresh imediato, apague o cache em disco (`~/.cache/opencode/commandcode-catalog.json`) e reinicie o OpenCode.

Edite o snapshot embutido só quando:

1. Você quiser manter o fallback offline atualizado — atualize `CATALOG` e `REASONING_EFFORTS` a partir de <https://commandcode.ai/models> e do `models.md` do npm, e atualize a data/versão do snapshot no comentário do topo.
2. O max output de um modelo precisa ser pinado — adicione no `MAX_OUTPUT` (nem a API nem a documentação expõem).
3. Você precisa forçar uma capability agora — use `MODEL_OVERRIDES` em vez de mexer no snapshot.

Abra um PR se atualizar o snapshot.

---

## Mensagens do plugin no log

Os dois plugins emitem as mesmas linhas de diagnóstico, só que pra destinos diferentes:

- **v1:** `client.app.log` quando o `client` tá disponível; cai pra `console.warn` caso contrário.
- **v2:** `console.info` / `console.warn`.

Você verá linhas como:

```
[commandcode] catalogo remoto 1.53.0: 70 modelos, 70 capabilities.
[commandcode] 70 modelos descobertos (50 com attachment).
[commandcode] 2 modelo(s) fora do snapshot do catalogo { ids: "modelo-novo-1, modelo-novo-2" }
[commandcode] 1 modelo(s) sem context_length na API { ids: "..." }
[commandcode] catalogo remoto indisponivel; mantendo ultimo cache.
[commandcode] descoberta de modelos falhou, usando snapshot estatico { error: ... }
```

Se a descoberta falhar na primeira chamada (v1), o plugin **não** derruba o OpenCode — ele cai pros ids do `CATALOG` e segue. No v2 o fallback é começar com a lista vazia; o próximo tick de refresh (5 minutos depois) tenta de novo. Se só o catálogo remoto estiver fora, o plugin mantém o último cache em disco (ou o snapshot embutido) e o aviso `catalogo remoto indisponivel` aparece.

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
