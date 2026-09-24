# ARIS Harness

**ARIS Harness** is the native cognitive runtime and integration harness for the ARIS ecosystem. This repository is derived from DeepSeek Harness and retains its composable plugin foundation, while ARIS-owned runtime logic is layered above inherited provider and execution seams.

ARIS has a small, permanently available local cognitive model. That model is an important native intelligence component, but it is not the runtime itself. ARIS Harness owns the persistent execution loop, typed system state, goals, authority chain, capability discovery, orchestration, verification and integration boundaries that let ARIS use whatever intelligence and tools are appropriate.

ARIS Harness may expose or orchestrate:

- native and larger local models
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
- operating-system and device capabilities
- future agent/model protocols through explicit adapters

## Role inside ARIS

```text
                         ARIS OS
                            │
                            ▼
                   ┌─────────────────┐
                   │  ARIS Harness   │
                   │                 │
                   │ Executive       │
                   │ Runtime/session │
                   │ Goals/planning  │
                   │ World model     │
                   │ Policy/verify   │
                   │ Events/memory   │
                   └────────┬────────┘
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
      Models/LLMs       Tools/OS          Agents/nodes
      local/remote      MCP/native        ACP/A2A/CLI
```

The key rule is simple: **models propose; the runtime owns authority sequencing.** A model, external agent or remote node can provide stronger reasoning, specialist knowledge, coding ability or compute, but it does not become ARIS's controlling identity and cannot bypass the deterministic execution chain.

The ARIS-owned runtime foundation is developed under `packages/aris/runtime`. The repository-specific architecture is documented in [ARIS Harness Technical Blueprint and Phased Roadmap](docs/ARIS_HARNESS_TECHNICAL_BLUEPRINT_AND_ROADMAP.md). The active implementation sequence for the native runtime is maintained alongside that architecture as implementation work lands.

The runtime preserves:

- provider and agent replaceability
- typed subsystem boundaries
- explicit capability discovery and health
- scoped context handoff
- provenance and confidence for durable beliefs
- policy and permission gates before execution
- impact simulation for meaningful mutations
- structured result and artifact return
- post-action verification
- audit/replay/recovery semantics
- cancellation/time/resource limits
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

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` currently uses the inherited DeepSeek Harness CLI while the ARIS-native runtime is integrated phase-by-phase.

## Development

Start with the [development guide](docs/development.md), [architecture documentation](docs/architecture.md), and [ARIS Harness Technical Blueprint and Phased Roadmap](docs/ARIS_HARNESS_TECHNICAL_BLUEPRINT_AND_ROADMAP.md).

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
