# ARIS Native Runtime

`@aris-os/harness-runtime` is the ARIS-owned cognitive runtime boundary inside ARIS Harness. It turns the inherited plugin harness into a persistent, event-driven, model-agnostic system runtime without making any model, provider, or external agent the controlling identity.

## Runtime rule

Models propose. The Executive authorizes orchestration. Tools execute. Verification checks results. Memory decides what survives.

The current execution path is deliberately deterministic:

```text
goal
  -> planner
  -> action
  -> policy authorization
  -> impact simulation
  -> tool resolution
  -> execution
  -> verification
  -> audit
  -> session state
```

A model provider is never an authority boundary and never receives implicit permission to execute tools.

## Foundation included in this package

The first runtime slice implements:

- typed contracts for observations, hypotheses, constraints, goals, plans, actions, results, capabilities, events, beliefs, provenance, artifacts and audit records
- persistent in-process runtime session state
- a dynamic, health-aware capability registry
- a typed event bus
- a provenance/confidence-aware belief graph
- explicit tool capability resolution
- model provider registration by capability
- subsystem ports for the broader ARIS runtime
- the deterministic `ARISExecutive` action pipeline
- invariant tests covering capability health, event delivery, belief integrity and authority separation

## Target subsystem skeleton

The runtime is intentionally one ARIS-owned package while the contracts are stabilizing. Subsystems can be split into services later without changing their public seams.

```text
packages/aris/runtime/
├── contracts          typed runtime language
├── executive          deterministic controller
├── runtime            session/task state
├── cognition          reasoning loop
├── attention          event relevance and wake-up gate
├── goals              persistent goal lifecycle
├── planner            plan construction
├── scheduler          delayed and recurring work
├── context            scoped context assembly
├── world-model        beliefs and relationships
├── state              live OS/environment state
├── confidence         uncertainty semantics
├── models             model providers
├── router             capability/cost-aware model routing
├── agents             ACP/A2A/CLI-agent adapters
├── capabilities       live capability registry
├── tools              tool contracts and resolution
├── artifacts          produced-file/object lifecycle
├── sandbox            isolated execution
├── transactions       commit/rollback coordination
├── memory             Hybrid Memory interface
├── skills             persistent learned procedures
├── reflection         post-task learning
├── provenance         evidence lineage
├── events             internal and OS event stream
├── communications     node/agent/human message bus
├── presence           active surfaces/devices
├── interrupts         pre-emption and resume
├── policy             deterministic action policy
├── permissions        scoped authority
├── secrets            credential references and access
├── identity           ARIS/user/node identities
├── resource-manager   CPU/RAM/VRAM/network/token budgets
├── recovery           checkpoints and interrupted-task recovery
├── notifications      user-facing escalation/batching
├── verification       post-action verification
├── simulation         pre-action impact checks
├── evals              runtime quality/regression evaluation
├── replay             trace replay
├── telemetry          metrics/traces
├── audit              meaningful action ledger
└── versioning         runtime/skill/policy/schema versions
```

The non-foundation subsystems already have explicit TypeScript ports in `src/ports.ts`. They are implemented phase-by-phase instead of existing as empty directories that imply functionality they do not yet provide.

## Architectural invariants

1. Models are replaceable providers, not ARIS identity.
2. Meaningful runtime objects cross boundaries as typed structures, not loose prompt text.
3. Every executable action crosses policy before tool invocation.
4. Impactful actions cross simulation before execution.
5. Actions that require verification cannot become successful without verification.
6. Capability availability is dynamic and health-aware.
7. Beliefs carry confidence and provenance.
8. Secrets are referenced by scope and purpose, not copied wholesale into model context.
9. Meaningful actions are auditable and eventually replayable.
10. The scheduler is independent from model cognition.
11. Recovery and interruption semantics are runtime responsibilities, not prompt instructions.
12. Distributed ARIS nodes communicate through explicit capability and identity contracts.

See `docs/ARIS_HARNESS_IMPLEMENTATION_PLAN.md` for the canonical implementation sequence.
