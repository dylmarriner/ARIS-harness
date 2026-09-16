# ARIS Harness

**ARIS Harness** is the plugin-oriented execution and integration harness for the ARIS ecosystem. This repository is derived from DeepSeek Harness and retains its everything-is-a-plugin architecture, while ARIS-specific integration is layered on top.

ARIS has a native local cognitive model of **≤1 billion parameters**. That native model is ARIS's default brain. ARIS Harness exists to help that brain and the wider ARIS runtime invoke additional capabilities without hard-coding one provider, model family or agent ecosystem.

The ≤1B limit applies only to the native ARIS model. ARIS Harness may expose or orchestrate:

- larger local models
- remote GPU-hosted models
- OpenAI-compatible endpoints
- OpenAI / Codex
- Anthropic / Claude / Claude Code
- Gemini and other API-key providers
- Ollama, `llama.cpp`, vLLM, LM Studio and other local runtimes
- OpenCode, Kilo and other CLI agents
- ACP agents
- A2A peers
- MCP tools and servers
- future agent/model protocols through plugins

## Role inside ARIS

```text
                 ARIS
          native ≤1B brain
                 │
                 ▼
          ARIS Core / Policy
                 │
                 ▼
           ARIS Harness
                 │
     ┌───────────┼────────────┐
     ▼           ▼            ▼
  Models      CLI/ACP       A2A/MCP
  & APIs       Agents       Capabilities
```

ARIS owns the task, identity, memory, policy, permissions and durable state. Harness plugins are execution/adaptation boundaries. An external model or agent can provide stronger reasoning, specialist knowledge, coding ability or remote compute, but it does not become ARIS's controlling identity.

The harness should therefore preserve:

- provider and agent replaceability
- explicit capability boundaries
- scoped context handoff
- provenance for delegated work
- cancellation/time/resource limits
- structured result and artifact return
- verification hooks
- health/fallback semantics
- local-first/offline operation where possible

## Upstream foundation

ARIS Harness is based on **DeepSeek Harness (`dsh`)**, an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It uses an **everything-is-a-plugin** architecture and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Upstream documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## Developer preview

The upstream DeepSeek Harness foundation is in _developer preview_ and iterating rapidly. **Compatibility-breaking changes are possible.** ARIS-specific integrations should avoid unnecessary coupling to unstable internals.

Review the [safety notice](SAFETY.md) before running the project.

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run from source

```sh
git clone https://github.com/dylmarriner/ARIS-harness.git
cd ARIS-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` currently uses the inherited DeepSeek Harness CLI while ARIS integration evolves.

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## Upstream project and attribution

Original project: [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
