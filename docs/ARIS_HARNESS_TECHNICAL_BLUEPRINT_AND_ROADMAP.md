# ARIS Harness Technical Blueprint and Phased Roadmap

- **Repository:** `dylmarriner/ARIS-harness`
- **Role:** Persistent cognitive runtime and integration harness for ARIS
- **Cross-repo authority:** `dylmarriner/ARIS/docs/ARIS_MASTER_TECHNICAL_BLUEPRINT.md`
- **Sibling repositories:** `dylmarriner/ARIS` (ARIS OS: eventd, modeld, system executor, memory gateway) and `dylmarriner/ARIS-intelligence` (native model, served through llama.cpp)
- **Status as of 2026-09-24:** see [§23 Cross-repository integration contracts](#23-cross-repository-integration-contracts) and [§24 Phased roadmap and status](#24-phased-roadmap-and-status)

## 1. Mission

ARIS Harness is the cognitive runtime for ARIS OS. It evolves the DeepSeek Harness/Cordis foundation into an ARIS-owned, persistent, event-driven, model-agnostic runtime that can coordinate local intelligence, larger models, tools, agents, memory and distributed nodes while keeping authority deterministic.

Harness is not the operating system, not the native-model research project and not the durable memory authority.

Its defining rule is:

> Models propose. The Executive owns task lifecycle and authority sequencing. Tools execute. Verification decides whether the intended effect occurred. Memory decides what becomes durable.

## 2. Repository strategy

This repository is a fork. The goal is not to rewrite every inherited package.

Keep ARIS-specific code concentrated under:

```text
packages/aris/
docs/ARIS_*
ARIS-specific adapters
minimal fork policy/build patches
```

Retain inherited DeepSeek/Cordis components where they provide useful, testable seams such as:

- model/provider plumbing.
- tool infrastructure.
- user approval.
- credentials.
- subprocess/sandbox support.
- ACP/subagent support.
- telemetry.
- session and workflow primitives where compatible.

Wrap or replace behaviour through ARIS contracts instead of mass-renaming inherited code.

Track upstream separately and periodically merge/rebase through an integration branch with the full ARIS regression suite.

## 3. Canonical package boundary

Initial ARIS-owned runtime lives at:

```text
packages/aris/runtime/
```

Do not prematurely split every subsystem into a network service. Stabilize contracts in-process first. Split only when security, deployment, isolation, scaling or independent lifecycle provides real value.

Canonical subsystem map:

```text
executive/
cognition/
attention/
goals/
planner/
scheduler/
context/
world-model/
state/
confidence/
models/
router/
agents/
capabilities/
tools/
artifacts/
sandbox/
transactions/
memory/
skills/
reflection/
provenance/
events/
communications/
presence/
interrupts/
policy/
permissions/
secrets/
identity/
resource-manager/
recovery/
notifications/
verification/
simulation/
evals/
replay/
telemetry/
audit/
contracts/
versioning/
```

Some of these are initially ports/contracts rather than standalone directories or services. Do not create empty folders merely to make the architecture look impressive.

## 4. ARIS Executive

The Executive is deterministic runtime code, never an LLM.

It owns:

- goal lifecycle.
- task lifecycle.
- priorities.
- action sequencing.
- authority flow.
- interruption/pre-emption.
- resource allocation.
- recovery requirements.
- verification requirements.
- runtime audit linkage.

Canonical action path:

```text
Goal
 -> Planner
 -> Action proposal
 -> constraints
 -> policy / permission
 -> impact simulation
 -> capability/tool resolution
 -> resource check
 -> execute
 -> verify
 -> update task/world state
 -> audit
 -> memory/reflection
```

A denied action must never reach a tool. Ambiguous capability resolution must fail closed.

## 5. Continuous runtime loop

Harness is persistent and event driven:

```text
observe
 -> normalize
 -> update runtime/world state
 -> attention gate
 -> determine whether cognition is required
 -> orient
 -> build scoped context
 -> reason
 -> plan
 -> authorize/simulate/execute
 -> observe result
 -> verify
 -> reflect/learn
 -> continue, schedule or wait
```

System awareness does not imply constant inference. Most events update state without waking a model.

## 6. Runtime contracts

Core typed concepts:

- `Identity`
- `Node`
- `Capability`
- `Observation`
- `Evidence`
- `Belief`
- `Hypothesis`
- `Constraint`
- `Goal`
- `Task`
- `Plan`
- `Action`
- `ActionResult`
- `Verification`
- `Artifact`
- `MemoryReference`
- `Skill`
- `RuntimeEvent`
- `Trace`
- `ModelAttempt`
- `AgentInvocation`
- `Authorization`
- `ResourceBudget`

Structured runtime state is translated to prompt/model formats only at the provider boundary.

## 7. Session and working memory

Harness owns active cognitive/session state:

- identity context.
- current goals/tasks.
- active plans.
- observations.
- hypotheses.
- working memory.
- pending actions.
- tool outputs.
- unresolved uncertainties.
- active agent/model conversations.
- checkpoints.

Long-term episodic/semantic memory belongs to SCOS Memory.

Session state should be checkpointable and resumable without replaying an entire chat transcript into a model.

## 8. World model

Harness maintains the current operational belief graph.

Entities may include:

- machines/nodes.
- services/processes.
- files/projects/repositories.
- applications.
- devices.
- users/people where authorized.
- networks.
- tasks/goals.

Every material belief should support:

- confidence.
- provenance.
- observed/updated time.
- contradiction state.
- supersession.

The world model is live operational state, not automatically permanent semantic memory.

## 9. Attention

Attention prevents event streams from becoming inference streams.

Deterministic inputs to attention include:

- priority/severity.
- novelty.
- active-goal relevance.
- task dependency.
- user presence.
- risk/security relevance.
- repetition/cooldown.
- confidence.

Critical deterministic events may bypass learned attention.

Attention emits a clean cognition wake-up signal rather than directly invoking a model.

The event stream comes from ARIS OS `aris-eventd`, not from Harness-owned OS adapters (see §23). `EventdIngestor` normalizes eventd envelopes and `AttentionGate` applies priority threshold, goal relevance, per-key cooldown and critical bypass without inference.

## 10. Scheduler

Scheduler owns:

- one-shot jobs.
- recurring jobs.
- delayed actions.
- deadlines.
- retries/backoff.
- wake-ups.
- dependency-triggered continuation.

Schedules persist independently of model context and survive runtime restart.

## 11. Capability registry

Capabilities are live state, not compile-time assumptions.

Registry entries describe:

- capability ID.
- provider/tool/agent/node.
- health.
- locality.
- impact class.
- permissions.
- cost/latency hints.
- resource requirements.
- simulation support.
- verification support.

A failed or disconnected provider becomes unhealthy and is removed from normal routing without rewriting plans by brand name.

## 12. Model provider architecture

Harness routes by required capability.

Provider interface should expose properties such as:

- text generation.
- structured/tool calls.
- vision.
- embeddings if needed.
- context limits.
- streaming.
- local/remote classification.
- privacy/cost/latency information.
- health.

Expected providers include:

- ARIS native model, reached through ARIS OS `aris-modeld` (`ModeldModelProvider`) or directly through the ARIS Intelligence llama.cpp server (`OpenAICompatibleModelProvider`).
- llama.cpp.
- Ollama.
- LM Studio.
- vLLM.
- OpenAI-compatible APIs.
- OpenAI.
- Anthropic.
- Gemini.

Do not encode provider brands into planning logic.

`ModelRouter` selects providers by required features, locality and context size, calls only providers whose `model:<id>` capability is healthy, falls back on provider failure, and audits every attempt.

## 13. Agent architecture

Agents are delegated workers rather than simple model calls.

Expected adapters:

- Codex.
- Claude Code.
- OpenCode.
- Kilo.
- Hermes.
- ACP agents.
- A2A peers.

Agent contract supports:

- capability advertisement.
- scoped task delegation.
- scoped context.
- progress events.
- artifacts.
- result.
- cancellation.
- timeout/resource constraints.
- health.

Agent output is evidence/artifact input. It does not bypass policy or verification.

## 14. Tools

Harness owns the tool registry and selection/orchestration layer.

Actual privileged Linux implementations belong to ARIS OS.

Tool metadata includes:

- schema.
- capability.
- impact.
- required permissions.
- expected artifacts/results.
- simulator.
- verifier.
- provider/node.
- health.

MCP tools are normalized into the same capability model.

## 15. Policy and permissions

Harness evaluates runtime policy but must not be the sole security boundary for host mutations.

Decision inputs include:

- identity.
- user/admin policy.
- action impact.
- target resource.
- existing grants.
- task context.
- simulation result.
- security conditions.

The ARIS OS executor independently verifies the resulting authorization before privileged execution.

## 16. Simulation and transactions

Mutating capabilities should provide simulation/dry-run where possible.

Transaction semantics support:

- snapshot.
- staged execution.
- post-step verification.
- commit.
- rollback where available.
- explicit irreversible classification.

The Executive must know when rollback is impossible.

## 17. Verification

Verification closes the action loop.

An action can declare verification as required. If required, successful tool return alone cannot transition the action/task to success.

Verifier sources may be:

- deterministic state query.
- tests/compiler.
- reread/hash.
- service health.
- network probe.
- multiple independent evidence sources.
- model-assisted judgement only when deterministic checks are insufficient.

## 18. Memory adapter

Harness owns a `MemoryPort`; SCOS Memory owns persistence.

Harness sends:

- journal events.
- retrieval queries.
- memory candidates.
- evidence/provenance.
- promotion requests where policy allows.

Harness receives:

- scoped memory results.
- semantic/episodic evidence.
- conflict/supersession metadata.
- memory health.

Temporary Memory outage uses local working state/outbox supplied through ARIS integration, not a secret second permanent database.

## 19. Skills and reflection

Reflection runs after meaningful task completion/failure.

It asks:

- what worked?
- what failed?
- which assumptions were wrong?
- what should become durable memory?
- is there a reusable procedure?

Skill pipeline:

```text
trace
 -> candidate procedure
 -> generalize
 -> declare preconditions/capabilities/verifier
 -> held-out evaluation
 -> promote/reject
 -> version
 -> monitor
 -> rollback if degraded
```

Self-improvement is gated, observable and reversible.

## 20. Replay and evaluation

Harness should measure:

- task completion rate.
- verification failure rate.
- tool failure rate.
- planner quality.
- routing quality.
- escalation rate.
- unsupported/hallucinated claims.
- latency.
- native inference passes.
- API cost.
- resource use.
- interruption/recovery success.
- learned-skill regressions.

Replay reproduces traces at contract boundaries where deterministic replay is possible and marks inherently nondeterministic inputs explicitly.

## 21. Distributed runtime

Harness treats remote machines as capability nodes.

Node communication requires:

- cryptographic identity.
- authenticated channel.
- capability advertisement.
- health/heartbeat.
- scoped authority.
- remote cancellation.
- artifact/result return.
- distributed trace correlation.

Start with one active Executive. Do not implement active-active global cognition until durable leader/fencing semantics exist.

## 22. Inherited DeepSeek boundary

For every inherited component, classify it:

- KEEP: suitable unchanged.
- WRAP: use behind ARIS contract.
- REPLACE: incompatible ownership/semantics.
- DROP: unnecessary for ARIS.

Maintain an explicit audit for:

- model providers.
- approval service.
- credentials.
- tools.
- shell/subprocess.
- sandbox.
- session.
- telemetry.
- subagents/ACP.
- workflows.
- UI apps where retained only for development.

ARIS-specific packages must be excluded from inherited DeepSeek publication rules unless deliberately published as ARIS packages. Never falsify repository metadata to satisfy an upstream release gate.

## 23. Cross-repository integration contracts

Harness integrates with contracts that already exist in code in the sibling repositories. Where the master blueprint names a contract that has no implementation yet, Harness adopts the implemented format and records the gap here instead of inventing a parallel wire format.

### 23.1 Contracts in use

| Contract | Owner | Transport | Harness consumer | State |
| --- | --- | --- | --- | --- |
| `EventEnvelope` v1 (`@aris/contracts`) | ARIS `aris-eventd` | NATS JetStream stream `ARIS_EVENTS`, subjects `aris.v1.<type>` | `EventdIngestor` | Implemented; NATS client wiring is deferred to the service phase |
| `WorldStateSnapshot` v1 | ARIS `aris-eventd` | File `/var/lib/aris/eventd/world-state.json` | `loadWorldStateSnapshot`, `applyWorldStateSnapshot` | Implemented |
| modeld invoke API (`ModelDescriptor` v1, `ModelInvocationResult`) | ARIS `aris-modeld` | HTTP over `/run/aris/modeld/modeld.sock`: `GET /v1/health`, `GET /v1/models`, `POST /v1/invoke` | `ModeldModelProvider` | Implemented |
| OpenAI chat completions | ARIS Intelligence llama.cpp server; any compatible backend | HTTP `{baseUrl}/chat/completions`, `{baseUrl}/models` | `OpenAICompatibleModelProvider` | Implemented; interim native-model protocol until ARIS Intelligence I1 publishes one |
| `ActionRequest` / `ActionExecutionResult` | ARIS `aris-system-executor` | Not defined | Planned Harness executor tool (H6) | Blocked on ARIS A2 |
| `MemoryQuery` / `JournalEvent` / `MemoryCandidate` | SCOS Memory via ARIS `aris-memory-gateway` | Not defined | Planned `MemoryPort` client (H7) | Blocked on ARIS A5 |
| Gateway task/approval/status API | Harness | Not defined | Shell via ARIS gateway | Unassigned; Harness proposes it in the service phase |

### 23.2 Reconciliation decisions

1. **Wire casing and envelope fields.** Implemented ARIS contracts use camelCase with `schemaVersion: "v1"`, `eventId`, `correlationId`, `causationId`, and `producer`. The master blueprint's snake_case `schema_version`, `request_id`, `trace_id`, `source` fields map onto those names. Harness follows the implemented format; the master blueprint should be updated to match.
2. **Linux event adapters belong to ARIS OS.** `aris-eventd` already implements procfs, systemd, journald, udev, sysfs, NetworkManager, mounts, and logind adapters and has been checked on real hardware. Harness consumes `aris.v1.>` and does not read OS sources. The adapters on the closed `feat/native-harness-skeleton` branch are retired.
3. **Native model path.** The native model is reached through `aris-modeld` when ARIS OS runs it and directly through the ARIS Intelligence llama.cpp server in development. modeld defaults its upstream to `http://127.0.0.1:11434/v1` (Ollama) while ARIS Intelligence serves llama.cpp on `http://127.0.0.1:8080`; deployments running the native model set `ARIS_MODELD_UPSTREAM_URL=http://127.0.0.1:8080/v1`.
4. **Runtime context format.** Harness sends structured context as the `aris_state_context` user message wrapped in `<ARIS_STATE_CONTEXT>`, the format ARIS's in-repo state pack already uses, so the native model sees one format regardless of caller.
5. **Escalation ownership.** Harness owns escalation across models, agents, and nodes. ARIS Intelligence compute levels (`DIRECT` through `EXHAUSTIVE`) stay within the native model; its README ladder levels L6–L9 and its `allow_web` / `allow_a2a` budget flags should defer to Harness routing.
6. **Cognition ownership.** ARIS `packages/intelligence` (router, context compiler, state pack, authorizer) and the core-api task state machine overlap with the Harness Executive and router. ARIS phase A0 migrates those responsibilities to Harness; until then ARIS contracts remain authoritative for how Harness capabilities enter ARIS.
7. **Impact vocabulary.** Harness `ImpactLevel` (`read`, `write`, `privileged`, `external`) must map onto the master blueprint classes (`READ`, `WRITE`, `PRIVILEGED`, `EXTERNAL`, `IRREVERSIBLE`) and ARIS `RiskClass` with autonomy levels 1–7 before the executor integration (H6). `IRREVERSIBLE` has no Harness equivalent yet.
8. **Memory outbox.** The durable outbox for memory outages belongs to ARIS `aris-memory-gateway`; Harness keeps no second permanent memory store.
9. **Service names.** Harness runs as `aris-harness.service` and calls the executor `aris-system-executor`, the master blueprint names; ARIS documents that say `aris-system-agent` or `aris-systemd.service` should converge on them.

## 24. Phased roadmap and status

### H0 - Upstream audit and fork policy

**Status:** partial. The `packages/aris/*` publication policy is enforced by `check-workspace-constraints`; the `upstream` remote exists. The KEEP/WRAP/REPLACE/DROP audit is not written.

- inventory inherited subsystems.
- classify KEEP/WRAP/REPLACE/DROP.
- define `packages/aris/*` non-upstream publication policy.
- establish upstream remote/integration workflow.

**Exit:** every retained inherited subsystem has an explicit reason and owner.

### H1 - Native runtime foundation

**Status:** implemented in `packages/aris/runtime` with 100% coverage; `feat/h1-runtime-foundation` awaits merge to `master`.

- typed contracts.
- RuntimeSession.
- CapabilityRegistry.
- EventBus.
- BeliefGraph.
- ToolRegistry.
- ModelRegistry.
- ARISExecutive.
- policy/simulation/verification/audit seams.

**Exit:** strict TypeScript + invariant tests; denied actions never reach tools.

### H2 - Persistent event runtime

**Status:** partial. `EventdIngestor`, `AttentionGate`, and eventd world-state seeding are implemented. The NATS subscription, a live-event state reducer, scheduler, presence and resource manager are not.

- consume `aris-eventd` envelopes from NATS `aris.v1.>` (ARIS owns the journald, systemd, NetworkManager, filesystem, D-Bus, udev, procfs and sysfs adapters).
- seed the belief graph from the eventd world-state checkpoint.
- attention/coalescing.
- state reducer that applies live events to the belief graph.
- scheduler/presence/resource manager.

**Exit:** high-volume OS awareness works without inference per event.

### H3 - Durable runtime state and recovery

**Status:** not started.

- checkpoint persistence.
- task/goal recovery.
- retry/dead-letter semantics.
- transaction/recovery metadata.
- durable scheduler.

**Exit:** crash/restart can resume or explicitly terminate prior work.

### H4 - Cognition, planning and context

**Status:** not started. Structured `ModelRequest` context, history, tools and response schemas are in place for the cognition loop to use.

- persistent cognition loop.
- dependency-aware planner.
- goal priorities/constraints.
- context builder.
- confidence/uncertainty.
- interrupts/pre-emption.

**Exit:** a local model solves useful tasks through repeated inference/tools without giant static prompts.

### H5 - Model and agent routing

**Status:** partial. `ModeldModelProvider` (ARIS OS) and `OpenAICompatibleModelProvider` (ARIS Intelligence llama.cpp and compatible backends) route through the health-aware `ModelRouter`. Agent adapters, ACP/A2A, and cost-aware routing are not started.

- native ARIS provider.
- local model backends.
- API providers.
- Codex/Claude Code/OpenCode/Kilo/Hermes.
- ACP/A2A.
- health/cost/privacy/capability-aware routing.

**Exit:** specialists can be swapped without changing Executive semantics.

### H6 - Secure execution

**Status:** not started beyond `ApprovalPolicyEngine` and `DshApprovalBridge`. Blocked on the ARIS A2 executor protocol.

- scoped permission service.
- secret references.
- simulator registry.
- transaction manager.
- artifact lifecycle.
- sandbox integration.
- ARIS OS executor adapter.

**Exit:** privileged mutations use permission, simulation, execution, verification and audit.

### H7 - Memory and world-model persistence

**Status:** not started. Blocked on the ARIS A5 memory gateway protocol.

- SCOS Memory adapter.
- provenance.
- belief persistence/reconstruction.
- contradictions/supersession.
- reflection memory candidates.

**Exit:** ARIS explains where material beliefs came from and survives runtime restart.

### H8 - Skills, replay and self-improvement

**Status:** not started.

- trace capture/replay.
- evaluation suite.
- WikiSkill extraction/generalization.
- held-out skill validation.
- versioning/rollback.

**Exit:** verified successful work can become a tested reusable procedure.

### H9 - Distributed ARIS

**Status:** not started.

- node identities.
- authenticated communication.
- remote capabilities.
- task placement.
- cancellation/reassignment.
- distributed artifacts/provenance/audit.

**Exit:** one task uses another node and returns into the same logical ARIS session without transferring global authority.

## 25. Harness v0.1 acceptance criteria

Harness v0.1 requires:

| # | Criterion | Status |
| --- | --- | --- |
| 1 | ARIS runtime included in normal workspace build/test gates. | Done on `feat/h1-runtime-foundation` (host build, vitest, oxlint, JSDoc, per-file 100% coverage). |
| 2 | Complete Executive action chain. | Done: policy → simulation → resolution → audit → execute → verify. |
| 3 | Real Linux event ingestion with attention/state updates. | Partial: eventd ingestion, attention and snapshot seeding exist; NATS wiring and the live-event reducer do not. |
| 4 | Persistent task/checkpoint recovery. | Not started (H3). |
| 5 | One native/local model provider. | Done: `ModeldModelProvider`, and `OpenAICompatibleModelProvider` against the ARIS Intelligence llama.cpp server. Not yet run against a live server. |
| 6 | One external model or agent provider through the same routing architecture. | Partial: `OpenAICompatibleModelProvider` with `locality: 'remote'` routes through `ModelRouter`; no agent adapter. |
| 7 | SCOS Memory connected through `MemoryPort`. | Blocked on ARIS A5. |
| 8 | One privileged OS action via ARIS System Executor. | Blocked on ARIS A2. |
| 9 | Trace/audit reconstruction of why the action occurred. | Partial: Executive and `model.attempt` audit records share `traceId`/`requestId`; no durable trace store. |
| 10 | Provider swap does not alter ARIS authority semantics. | Done by construction: providers return proposals only; `ModelRouter` never executes tool calls. |

## 26. First live Harness test

Target vertical slice:

```text
NetworkManager connectivity loss
 -> event runtime
 -> state update
 -> attention
 -> goal/context
 -> native reasoning
 -> inspection tools
 -> diagnosis
 -> proposed mutation
 -> policy
 -> simulation
 -> ARIS executor
 -> network verification
 -> audit
 -> memory candidate
```

This is the first proof that Harness is a cognitive runtime rather than a chat framework fork.

## 27. Immediate work sequence

1. Merge `feat/h1-runtime-foundation` and the sibling-integration work (providers, router, eventd ingestion) when green.
2. Write the H0 KEEP/WRAP/REPLACE/DROP audit of inherited packages.
3. Add the `aris-harness` service entry point: NATS subscription on `aris.v1.>`, world-state seeding at start, attention wake-ups, provider health refresh, and systemd unit alignment with ARIS phase A1.
4. Add the live-event state reducer and persistent checkpoints with a durable scheduler (H2/H3).
5. Run both model providers against a live ARIS Intelligence llama.cpp server and a live `aris-modeld`, and record the result.
6. Agree the executor `ActionRequest` protocol with ARIS A2 and the `MemoryPort` protocol with ARIS A5, then implement the Harness side (H6/H7).
7. Build the cognition loop and planner over `ModelRouter` (H4).
8. Run the first full Wi-Fi recovery vertical slice (§26).

## 28. Definition of success

This repository succeeds when ARIS can continuously understand relevant state, form and manage goals, reason through replaceable intelligence, safely invoke capabilities, verify effects, recover interrupted work, learn validated procedures and extend across machines without any model or agent becoming the system authority.
