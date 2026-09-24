---
description: "ARIS runtime: typed contracts, the deterministic Executive, model providers and routing for ARIS Intelligence and ARIS OS, eventd ingestion, attention, and world-state seeding."
kind: "package-reference"
---

# @aris-os/harness-runtime

## Summary

ARIS-owned cognitive runtime (roadmap phases H1, H2, and H5 in [the Harness blueprint](../../../docs/ARIS_HARNESS_TECHNICAL_BLUEPRINT_AND_ROADMAP.md)). It defines the typed runtime contracts, in-process session and world-model state, capability, tool, and model registries, and `ARISExecutive`, the only path from a proposed plan to tool execution. It connects to the two sibling repositories: model providers reach the ARIS Intelligence llama.cpp server and ARIS OS `aris-modeld`, and `EventdIngestor` consumes ARIS OS `aris-eventd` events. The package is private under the `@aris-os/` scope; `check-workspace-constraints` keeps `packages/aris/*` out of every DeepSeek release sequence.

## Table of Contents

- [Executive action path](#executive-action-path)
- [State and registries](#state-and-registries)
- [Policy and simulation](#policy-and-simulation)
- [Model providers and routing](#model-providers-and-routing)
- [Event ingestion and attention](#event-ingestion-and-attention)
- [World state](#world-state)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="executive-action-path"></a>
## Executive action path

`ARISExecutive.executeGoal(goal, session, signal?)` asks the `Planner` for a plan, rejects a plan whose `goalId` differs from the goal, and runs each action in order through these stages:

```text
policy.authorize -> simulator.simulate -> tools.resolve -> audit(action.execution.started) -> tool.execute -> verifier.verify
```

| Stage outcome | Action status | Tool ran |
| --- | --- | --- |
| Policy returns `allowed: false` or throws | `denied` | no |
| Simulation returns `safe: false` or throws | `blocked` | no |
| Resolution throws (unknown, mismatched, or ambiguous tool) | `failure` | no |
| Tool throws or reports `failure` | `failure` | yes |
| `requiresVerification` and the verifier returns `ok: false` or throws | `unverified` | yes |
| Otherwise | `success` | yes |

Execution stops at the first non-`success` action. The session records the goal as `active`, then `completed` or `failed`, and receives the plan and every action result. Every transition appends an `AuditRecord` to the `AuditSink`. A rejected `append` rejects `executeGoal`; because `action.execution.started` is appended before `tool.execute`, an audit failure prevents execution. An aborted `signal` rejects instead of producing a `denied`, `blocked`, or `unverified` result.

-----

<a id="state-and-registries"></a>
## State and registries

- `RuntimeSession` holds goals, observations, hypotheses, and plans keyed by id, action results in completion order, and deduplicated uncertainties. `snapshot()` returns a copy that ports receive.
- `BeliefGraph` stores beliefs by id and directed edges whose endpoints must already exist; `markContradicted` sets a belief's state to `contradicted`.
- `CapabilityRegistry` returns only `healthy` capabilities from `findHealthy(tagOrId)`; `updateHealth` replaces an entry's health and timestamp.
- `ToolRegistry` resolves a named tool only when it exposes the action's capability, and an unnamed action only when exactly one tool exposes it.
- `ModelRegistry` lists providers in registration order and selects them by feature flag (`text`, `vision`, `tools`, `structuredOutput`, `embeddings`).
- `EventBus` delivers an event to type subscribers, then `*` subscribers, sequentially; a throwing subscriber rejects `publish` and later subscribers do not run.
- `MemoryAuditSink` retains the newest `maxRecords` records (default 10,000).

Every `register` and `subscribe` returns a disposer that removes the entry.

-----

<a id="policy-and-simulation"></a>
## Policy and simulation

`ApprovalPolicyEngine` allows `read` actions unless `allowReadByDefault` is `false`, then allows a standing grant from `PermissionService` scoped to the capability, then asks the `ApprovalRequester` and allows only `allowed-once`, scoped to the action id. With neither a grant nor an approval path it denies. `DshApprovalBridge` implements `ApprovalRequester` over the inherited `@deepseek-ai/dsh-user-approval` service, naming the action's tool or, when unnamed, its capability.

`ImpactSimulator` passes `read` actions without a resolver, blocks mutating actions whose capability has no registered `EffectResolver`, and otherwise reports the resolver's predicted effects.

-----

<a id="model-providers-and-routing"></a>
## Model providers and routing

A `ModelRequest` keeps runtime state structured (`context`, `history`, `tools`, `responseSchema`) and carries an explicit `budget` (`maxOutputTokens`, `timeoutMs`, optional `temperature`) plus `requestId` and `traceId` for the audit trail. Providers translate it with `toChatMessages` and return a `ModelResponse` with text, optional `reasoning` and `structured` output, proposed `toolCalls`, `finishReason`, `usage`, and `latencyMs`. A proposed tool call is evidence for the planner; no provider or the router executes it.

| Provider | Backend | Wire format |
| --- | --- | --- |
| `OpenAICompatibleModelProvider` | ARIS Intelligence llama.cpp server (`http://127.0.0.1:8080/v1`), Ollama, vLLM, LM Studio, hosted OpenAI-compatible APIs | `POST {baseUrl}/chat/completions` with `stream: false`, `tools[].function`, and `response_format.json_schema` named `aris_response`; health is `GET {baseUrl}/models` and requires the configured `model` id |
| `ModeldModelProvider` | ARIS OS `aris-modeld` on `/run/aris/modeld/modeld.sock` | HTTP over the Unix socket: `POST /v1/invoke` with the ARIS `ModelDescriptor` v1, `GET /v1/health`, and `GET /v1/models`; capabilities derive from the descriptor and are always `local` |

`requireLoopback: true` makes `OpenAICompatibleModelProvider` construction reject a non-loopback `baseUrl`, matching ARIS Intelligence offline mode. Provider failures throw `ModelProviderError` with `code` `unavailable` (transport), `timeout` (budget elapsed), `rejected` (non-success status, including modeld error bodies such as `remote_model_denied`), or `invalid-response`. A caller abort rethrows the caller's reason. Health probes resolve unavailable on transport failure instead of rejecting.

`ModelRouter` routes by `ModelRequirements` (`features`, `locality: 'local-only' | 'any'`, optional `minContextTokens`), never by brand. It tries providers in the configured `preference` order and calls only those whose `model:<providerId>` capability is `healthy`, so `refreshHealth()` must run first. On `ModelProviderError` it records the provider `unavailable` (for `unavailable`) or `degraded` (otherwise) and tries the next provider; a caller abort or any other exception rejects without fallback. Each call appends a `model.attempt` audit record, and exhausting every provider appends `model.route.failed` and rejects with `ModelRoutingError` listing every skipped or failed attempt.

-----

<a id="event-ingestion-and-attention"></a>
## Event ingestion and attention

ARIS OS `aris-eventd` owns the Linux adapters and publishes `EventEnvelope` v1 on NATS subjects `aris.v1.<type>` (stream `ARIS_EVENTS`). `EventdIngestor.consume(messages, signal?)` reads any async iterable of JSON text or bytes, validates each envelope, drops event ids repeated within `dedupeWindow`, and publishes a `RuntimeEvent` whose `type` is the eventd type, `source` is the producer, and `priority` comes from the longest matching `priorities` prefix or `defaultPriority`. The payload keeps `correlationId`, `causationId`, `sensitivity`, `confidence`, entity refs as `kind:id`, and the producer payload. Invalid messages go to `onRejected` and are counted, not thrown.

`AttentionGate.evaluate(event)` decides without inference whether an event wakes cognition. Events at or above `bypassPriority` always wake. Other events wake when they are goal-relevant (`isGoalRelevant`) or at `minPriority`, and their `keyOf` key was not admitted within `cooldownMs`. `attach(bus, onWake)` applies the gate to every bus event and delivers a `CognitionWake` for each admitted one.

-----

<a id="world-state"></a>
## World state

`loadWorldStateSnapshot(path)` reads and validates the eventd `WorldStateSnapshot` v1 checkpoint (normally `/var/lib/aris/eventd/world-state.json`) and returns `undefined` when the file does not exist. `applyWorldStateSnapshot(graph, snapshot, maxSensitivity)` upserts one `known` belief per entity attribute with id `<kind>:<id>#<attribute>`, the entity confidence, and `sensor` provenance from `aris-eventd` naming the source event ids. Entities above `maxSensitivity` are skipped.

## Model Experience

### Runtime state context message

#### What the model sees

When a `ModelRequest` carries non-empty `context`, both providers send it as a user message named `aris_state_context` whose content is `<ARIS_STATE_CONTEXT>`, a newline, the compact JSON of `context`, a newline, and `</ARIS_STATE_CONTEXT>`. The message follows the optional `system` message and precedes `history` and the final `input` user message. Structured-output requests to OpenAI-compatible servers name their JSON Schema `aris_response`. All other model-visible text comes from the caller's `system`, `input`, `history`, and `tools`.

#### Token effect

The context message costs the tokens of the serialized context plus the two tags; an empty `context` adds no message.

#### KV Cache effect

The context message precedes `history`, so any change to runtime state invalidates the cached prefix from that message onward, while unchanged `system` text stays cacheable.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **State is in-process only** — sessions, beliefs, registries, and `MemoryAuditSink` are lost on restart. Checkpoints and durable scheduling are phase H3.
- **Capability health does not gate tool resolution** — `ToolRegistry.resolve` ignores `CapabilityRegistry` health, so an unhealthy capability's tool still runs if policy and simulation pass. Model routing is health-aware; tool routing is phase H5.
- **No NATS client or service entry point** — `EventdIngestor` consumes an async iterable; connecting to NATS and running the `aris-harness.service` loop belong to the service phase (master blueprint phase 2).
- **World-state removals are not applied** — `applyWorldStateSnapshot` never removes beliefs for entities or attributes absent from a newer snapshot. Supersession is phase H7.
- **No streaming** — both providers send `stream: false`, matching modeld and ARIS Intelligence today.
- **modeld drops assistant tool calls from history** — modeld messages have no tool-call field, so prior assistant proposals reach modeld as content only; `tool` messages keep their `toolCallId`.
- **Ids are bare strings** — `EntityId` is not branded, so ids of different entity kinds are interchangeable at compile time.
- **No transactions, supersession, or verified rollback** — `Action.transactional` is carried but not acted on, and `BeliefGraph` has no supersession. These are phases H6 and H7.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Provider and ingestion tests run against real loopback HTTP and Unix-socket servers rather than mocked `fetch`.

</details>

**Runtime invariant:** No companion is published. `ARISExecutive` owns the policy-before-tool ordering it enforces, and its specs assert that ordering through the executor; `ModelRouter` owns health-gated provider selection, and its specs assert that unhealthy or unqualified providers are never called.
