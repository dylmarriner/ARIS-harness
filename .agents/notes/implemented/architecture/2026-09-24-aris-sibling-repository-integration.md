# Agent Note: ARIS sibling-repository integration

Status: implemented

## Problem

The [Harness blueprint](../../../../docs/ARIS_HARNESS_TECHNICAL_BLUEPRINT_AND_ROADMAP.md) makes Harness the cognitive runtime for ARIS OS (`dylmarriner/ARIS`) and the consumer of the native model developed in `dylmarriner/ARIS-intelligence`. After [the runtime foundation](2026-09-24-aris-runtime-foundation.md), `ModelProvider` was a port with no implementation, `ModelRequest` carried only `purpose`, `input`, and `context`, and the runtime had no event source. The blueprint's H2 phase also assigned journald, NetworkManager, and filesystem adapters to Harness, while ARIS `aris-eventd` already implements those adapters and has been checked on real hardware.

The only implemented cross-repository wire formats are ARIS `aris-modeld` (HTTP over `/run/aris/modeld/modeld.sock`), ARIS `EventEnvelope` v1 on NATS subjects `aris.v1.<type>`, the eventd `WorldStateSnapshot` v1 checkpoint, and the OpenAI chat-completions API of the llama.cpp server ARIS Intelligence targets. The master blueprint names further contracts (`ActionRequest`, `MemoryQuery`, `InferenceRequest`) with no schema in any repository.

## Decision

[`@aris-os/harness-runtime`](../../../../packages/aris/runtime/README.md) implements Harness against the implemented formats only:

- `ModelRequest` gains `requestId`, `traceId`, optional `system`, `history`, `tools`, `responseSchema`, and a required `budget` (`maxOutputTokens`, `timeoutMs`, optional `temperature`). `ModelResponse` gains `modelId`, `reasoning`, `structured`, `toolCalls`, `finishReason`, `usage`, and `latencyMs`. `ModelProvider` gains `health()`, and `ModelCapabilities` gains `structuredOutput` and `locality`.
- `toChatMessages` serializes `context` as the `aris_state_context` user message wrapped in `<ARIS_STATE_CONTEXT>`, the format ARIS's in-repo state pack already sends.
- `OpenAICompatibleModelProvider` serves the ARIS Intelligence llama.cpp server and other compatible backends; `ModeldModelProvider` sends the ARIS `ModelDescriptor` v1 to modeld and derives capabilities from it. Both classify failures as `ModelProviderError` (`unavailable`, `timeout`, `rejected`, `invalid-response`) and rethrow a caller abort unchanged.
- `ModelRouter` selects providers by `ModelRequirements`, calls only providers whose `model:<id>` capability is `healthy`, falls back on `ModelProviderError`, and audits `model.attempt` and `model.route.failed`.
- `EventdIngestor` validates eventd envelopes from any async iterable, suppresses redelivered event ids, assigns priority by longest type prefix, and publishes to `EventBus`. `AttentionGate` decides cognition wake-ups without inference. `applyWorldStateSnapshot` seeds the `BeliefGraph` from the eventd checkpoint and skips entities above a sensitivity ceiling.

The blueprint gains §23 (cross-repository contracts and nine reconciliation decisions), per-phase status in §24, a status table for the v0.1 acceptance criteria, and a revised immediate work sequence. H2 now consumes eventd instead of owning OS adapters. ARIS-owned documents stay English-only, so `translation-pairing.manifest.json` excludes `packages/aris/`, the blueprint, and both ARIS Agent Notes, as the runtime-foundation note intended.

## Alternatives considered

**Define a Harness-native `InferenceRequest` protocol now.** ARIS Intelligence has no server and its roadmap phase I1 (provider protocol) has not started. A Harness-invented protocol would need a server nobody runs; the OpenAI-compatible wire is what the native model's llama.cpp server speaks today.

**Keep Harness-owned Linux adapters.** Two implementations of journald and NetworkManager parsing would diverge, and eventd already carries sensitivity labels, correlation ids, and a world-state checkpoint that the skeleton adapters lacked.

**Depend on `@nats-io/transport-node` in the runtime package.** `EventdIngestor` accepts an async iterable, so a NATS subscription adapts in one generator at service composition. The NATS connection, reconnection, and consumer policy belong to the `aris-harness` service entry point, which does not exist yet.

**Mock `fetch` in provider tests.** Tests run real loopback HTTP and Unix-socket servers so timeout, abort, and socket behavior are exercised through Node's transports.

## Consequences

Both native-model paths and eventd ingestion are exercised by 82 runtime tests at per-file 100% coverage, but neither provider has run against a live server yet. The runtime still has no service entry point, NATS client, live-event state reducer, checkpoints, executor tool, or `MemoryPort`; the blueprint's §23.1 table and §27 sequence list them with their ARIS dependencies (A1, A2, A5). The package README's Model Experience section is now structured because the state-context message is package-owned model-visible text.
