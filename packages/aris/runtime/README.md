---
description: "ARIS runtime foundation: typed contracts, in-process state, registries, and the deterministic Executive action path."
kind: "package-reference"
---

# @aris-os/harness-runtime

## Summary

ARIS-owned runtime foundation (roadmap phase H1 in [the Harness blueprint](../../../docs/ARIS_HARNESS_TECHNICAL_BLUEPRINT_AND_ROADMAP.md)). It defines the typed runtime contracts, in-process session and world-model state, capability, tool, and model registries, and `ARISExecutive`, the only path from a proposed plan to tool execution. The package is private under the `@aris-os/` scope; `check-workspace-constraints` keeps `packages/aris/*` out of every DeepSeek release sequence.

## Table of Contents

- [Executive action path](#executive-action-path)
- [State and registries](#state-and-registries)
- [Policy and simulation](#policy-and-simulation)
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
- `ModelRegistry` selects providers by feature flag (`text`, `vision`, `tools`, `embeddings`).
- `EventBus` delivers an event to type subscribers, then `*` subscribers, sequentially; a throwing subscriber rejects `publish` and later subscribers do not run.
- `MemoryAuditSink` retains the newest `maxRecords` records (default 10,000).

Every `register` and `subscribe` returns a disposer that removes the entry.

-----

<a id="policy-and-simulation"></a>
## Policy and simulation

`ApprovalPolicyEngine` allows `read` actions unless `allowReadByDefault` is `false`, then allows a standing grant from `PermissionService` scoped to the capability, then asks the `ApprovalRequester` and allows only `allowed-once`, scoped to the action id. With neither a grant nor an approval path it denies. `DshApprovalBridge` implements `ApprovalRequester` over the inherited `@deepseek-ai/dsh-user-approval` service, naming the action's tool or, when unnamed, its capability.

`ImpactSimulator` passes `read` actions without a resolver, blocks mutating actions whose capability has no registered `EffectResolver`, and otherwise reports the resolver's predicted effects.

## Model Experience

None, as this package registers no prompt, tool schema, or model-facing text; `ModelProvider` is a port and no provider is implemented here.

#### KV Cache effect

No direct effect; the package issues no model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **State is in-process only** — sessions, beliefs, registries, and `MemoryAuditSink` are lost on restart. Checkpoints and durable scheduling are phase H3.
- **Capability health does not gate tool resolution** — `ToolRegistry.resolve` ignores `CapabilityRegistry` health, so an unhealthy capability's tool still runs if policy and simulation pass. Health-aware routing is phase H5.
- **No event ingestion or attention** — `EventBus` has no OS event sources and no attention gate. Linux adapters (journald, NetworkManager, filesystem) are phase H2; a prior implementation is on the `feat/native-harness-skeleton` branch.
- **Ids are bare strings** — `EntityId` is not branded, so ids of different entity kinds are interchangeable at compile time.
- **No transactions, supersession, or verified rollback** — `Action.transactional` is carried but not acted on, and `BeliefGraph` has no supersession. These are phases H6 and H7.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. `ARISExecutive` owns the policy-before-tool ordering it enforces, and its specs assert that ordering through the executor.
