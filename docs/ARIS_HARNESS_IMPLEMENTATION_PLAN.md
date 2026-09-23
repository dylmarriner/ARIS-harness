# ARIS Harness Implementation Plan

## Objective

ARIS Harness is being evolved from a DeepSeek-derived plugin harness into the native cognitive runtime for ARIS OS: persistent, event-driven, model-agnostic, observable, recoverable and capable of coordinating local models, larger models, tools, agents, devices and distributed ARIS nodes.

The native ARIS model remains a permanently available local intelligence component, but no model is ARIS's identity or authority boundary. The runtime must continue to function if every model provider is replaced.

## Non-negotiable invariants

1. **Thinking is separate from authority.** Models and agents may propose actions; only deterministic runtime policy and permission components authorize execution.
2. **Typed boundaries.** Observations, hypotheses, constraints, goals, plans, actions, results, capabilities, events, beliefs, artifacts and provenance cross subsystem boundaries as typed structures.
3. **No implicit tool authority.** Every executable action passes policy before a tool can run.
4. **Impact is checked before execution.** Simulation/dry-run logic is mandatory for actions whose effects can alter the system, external services or user data.
5. **Verification closes the loop.** An action that requires verification cannot be accepted as successful merely because a tool returned without error.
6. **Capabilities are live state.** Models, tools, agents, devices and services are discovered and routed by capability and health, not hard-coded assumptions.
7. **Beliefs have lineage.** Persistent beliefs carry confidence, provenance and contradiction state.
8. **Secrets remain scoped.** Credentials are resolved for a specific operation and are not dumped into model context.
9. **Meaningful actions are auditable.** The runtime records what was attempted, why, under whose authority and what happened.
10. **Scheduling is not cognition.** Delayed/recurring work is owned by a scheduler, not by a model remembering a date in a prompt.
11. **Recovery is designed in.** Interrupted work, crashes and node loss have checkpoint/resume or rollback semantics.
12. **ARIS is logically singular but physically distributable.** Remote nodes expose explicit identities and capabilities while the ARIS runtime preserves one coherent task and memory model.

## Canonical runtime flow

```text
observe
  -> normalize event/observation
  -> attention gate
  -> update state/world model
  -> select or create goal
  -> build scoped context
  -> plan
  -> authorize action
  -> simulate impact
  -> execute through a registered tool/capability
  -> verify result
  -> update world model and memory
  -> reflect/evaluate
  -> audit/version/replay trace
  -> wait, schedule or continue
```

External intelligence fits inside planning/reasoning seams and never bypasses the execution pipeline.

## Package strategy

The ARIS-owned runtime starts as one workspace package at `packages/aris/runtime`. Keeping the first contracts together lets us stabilize the architecture without prematurely turning every noun into a service. Subsystems can be split later when process isolation, deployment, scaling or security boundaries justify it.

The package exposes explicit ports for:

- cognition, planning and context
- attention and scheduling
- models, routing and external agents
- tools, capabilities and artifacts
- world model, confidence and provenance
- memory, skills and reflection
- policy, permissions, secrets and identity
- sandboxing, simulation and transactions
- events, communications, presence and interrupts
- resource management, recovery and notifications
- verification, evaluations, replay, telemetry, audit and versioning

## Phase H0: upstream audit and extraction

**Goal:** know exactly which inherited DeepSeek Harness mechanisms ARIS will keep, wrap, replace or remove.

Deliverables:

- inventory existing model, agent, tool, plugin, session, workflow, authorization, credential, subprocess and telemetry seams
- mark ARIS-owned versus inherited boundaries
- identify coupling to DeepSeek-specific provider assumptions
- document compatibility constraints with Cordis and existing apps
- create migration tests for inherited behavior ARIS intends to preserve

Definition of done:

- every retained upstream subsystem has an explicit reason and owner
- ARIS runtime code does not need to fork an inherited component merely to rename it
- migration order is documented and testable

## Phase H1: native runtime foundation

**Goal:** establish the ARIS-owned contracts and deterministic controller.

Deliverables:

- typed runtime contracts
- `ARISExecutive`
- runtime session state
- dynamic capability registry
- event bus
- model registry/provider contract
- tool registry/resolution contract
- belief graph foundation
- policy, simulation, verification and audit ports
- ports for remaining first-class subsystems
- invariant tests

Current skeleton status:

- [x] typed contracts
- [x] runtime session
- [x] capability registry
- [x] event bus
- [x] belief graph
- [x] tool registry
- [x] model registry
- [x] deterministic Executive pipeline
- [x] subsystem ports
- [x] foundation invariant tests

Definition of done:

- a goal can become a plan and execute through `authorize -> simulate -> tool -> verify -> audit`
- a denied action never reaches a tool
- ambiguous tool capability resolution fails closed
- all foundation source passes strict TypeScript checks

## Phase H2: persistent OS and event runtime

**Goal:** make ARIS continuously aware of the operating system without continuously burning model inference.

Deliverables:

- event adapters for systemd, D-Bus, udev, inotify, NetworkManager, procfs, sysfs and journald
- KDE/Wayland and PipeWire adapters where stable interfaces permit them
- attention gate for filtering, coalescing and prioritizing events
- live system state service
- scheduler for one-shot and recurring jobs
- presence service for active devices/surfaces
- resource manager for CPU, RAM, VRAM, disk, network, thermal, battery and inference/API budgets
- notification policy and batching
- recovery checkpoints for interrupted tasks

Definition of done:

- high-volume OS events can be observed without waking a model for every event
- scheduled work survives runtime restarts
- resource pressure can suppress or reroute expensive cognition
- interrupted tasks have a durable recovery record

## Phase H3: cognition, planning and routing

**Goal:** implement the persistent cognitive loop while keeping reasoning replaceable.

Deliverables:

- `observe -> orient -> reason -> act -> verify -> learn` loop
- planner with dependency-aware action graphs
- goal lifecycle and priority management
- constraint engine for hard and soft constraints
- context builder that retrieves only task-relevant state
- confidence/uncertainty tracking
- interrupt/pre-emption handling
- model router based on capability, health, privacy, cost, latency and available compute
- local test-time-compute strategies for the native ARIS model

Definition of done:

- the native model can solve a task through repeated inference and tools without needing a giant static prompt
- routing can escalate to another model/agent without transferring ARIS authority
- urgent events can interrupt lower-priority work and later resume it

## Phase H4: Hybrid Memory and world model

**Goal:** make ARIS knowledge durable, inspectable and correctable.

Deliverables:

- adapter to ARIS/SCOS Hybrid Memory
- provenance store
- belief graph persistence
- contradiction and supersession handling
- structured world entities for machines, services, files, applications, people, projects and devices
- reflection pipeline that proposes durable memories only after successful/verified work
- schema and memory versioning

Definition of done:

- ARIS can explain where a material belief came from
- stale/contradicted beliefs are not silently treated as current truth
- restarting the runtime does not erase task-relevant world state

## Phase H5: secure execution and external intelligence

**Goal:** safely broaden what ARIS can do and who it can ask for help.

Deliverables:

- permission service with scoped, time-bounded authority
- secret references and purpose-bound credential access
- execution sandbox
- transaction manager and rollback hooks
- action simulation/dry-run implementations for OS/config/network/file operations
- adapters for MCP, ACP and A2A
- Codex, Claude Code, Gemini CLI, Hermes and other CLI-agent adapters
- Ollama, llama.cpp, LM Studio, vLLM and API-provider adapters as needed
- artifact lifecycle for generated code, configs, documents, patches and data

Definition of done:

- an external agent can contribute reasoning or artifacts without obtaining implicit host authority
- privileged mutations are permission checked, simulated where supported and auditable
- secret material is never broadly copied into prompts or logs

## Phase H6: skills, evaluation and self-improvement

**Goal:** turn successful task traces into reusable capability without uncontrolled self-modification.

Deliverables:

- execution trace capture
- replay engine
- evaluation framework and regression suite
- reflection-to-skill candidate pipeline
- WikiSkill-style extraction/generalization
- held-out validation before skill promotion
- provenance and versioning for every learned skill
- rollback to earlier skill versions
- runtime metrics for completion rate, tool failure, verification failure, cost, latency and routing quality

Definition of done:

- ARIS can propose a learned procedure from a successful trace
- proposed skills are tested before activation
- a degraded learned skill can be identified and rolled back

## Phase H7: distributed ARIS

**Goal:** preserve one logical ARIS across multiple execution nodes.

Deliverables:

- cryptographic node identity
- node capability advertisements and health
- authenticated communications bus
- task placement based on hardware, locality, permissions and availability
- remote interruption/cancellation semantics
- artifact and result return contracts
- distributed provenance and audit correlation
- graceful node loss and reassignment

Target nodes include Linux desktops, the development laptop, Raspberry Pi systems, phones where practical and cloud/GPU workers.

Definition of done:

- a task can begin on one ARIS surface, use capabilities on another node and return a verified result into the same logical session
- loss of a remote node cannot silently mark a task successful

## Acceptance criteria for ARIS Harness v0.1

ARIS Harness v0.1 is reached when:

1. the ARIS-owned runtime package is part of the normal workspace build/test gates
2. the Executive can run a complete goal through policy, simulation, tool execution, verification and audit
3. the runtime can consume real Linux events and maintain live capability/state information
4. at least one local model provider and one external intelligence provider use the same model/agent routing boundary
5. Hybrid Memory is connected through the runtime memory port
6. at least one privileged OS action is demonstrated with permission, simulation, execution and verification
7. crashes/interruption can resume or safely terminate a persisted task
8. traces and audit records can reconstruct why a material action occurred
9. the runtime remains functional when the configured model provider is swapped
10. no model or external agent can bypass the deterministic execution authority chain

## Immediate implementation sequence

The next engineering slice after this skeleton is:

1. wire `packages/aris/runtime` into repository project references/build gates
2. implement concrete policy, audit and simulation providers using existing Harness authorization/credential/process seams where suitable
3. adapt the existing DeepSeek Harness tool layer behind `ToolRegistry`
4. adapt existing LLM providers behind `ModelProvider`
5. implement the first Linux event adapters: systemd/journald, NetworkManager and filesystem changes
6. add persistent runtime checkpoints
7. connect the Hybrid Memory service
8. run the first live ARIS loop on linnyux

This document is the canonical implementation sequence for the ARIS-native Harness runtime. Architectural changes should update this plan and the runtime contracts together so the repository does not acquire two competing definitions of ARIS.
