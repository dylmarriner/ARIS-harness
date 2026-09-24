# Agent Note: ARIS runtime foundation and fork policy

Status: implemented

## Problem

The [Harness blueprint](../../../../docs/ARIS_HARNESS_TECHNICAL_BLUEPRINT_AND_ROADMAP.md) phase H1 requires an ARIS-owned runtime whose Executive is the only path from a plan to a tool, with strict TypeScript and invariant tests proving that denied actions never reach tools. Inherited repository gates treat every `packages/*/*` directory as a public DeepSeek release member and every in-scope document as bilingual. An ARIS package can satisfy those gates only by claiming DeepSeek publication metadata, which the blueprint forbids, or by maintaining Chinese counterparts the fork does not produce.

## Decision

[`@aris-os/harness-runtime`](../../../../packages/aris/runtime/README.md) lives at `packages/aris/runtime`, is registered in `tsconfig.host.json`, and runs under the ordinary vitest, oxlint, JSDoc, and per-file 100% coverage gates. It contains the typed contracts, `RuntimeSession`, `BeliefGraph`, `CapabilityRegistry`, `ToolRegistry`, `ModelRegistry`, `EventBus`, `MemoryAuditSink`, `ApprovalPolicyEngine`, `DshApprovalBridge`, `ImpactSimulator`, and `ARISExecutive`, plus only the ports those classes consume.

`ARISExecutive` fails closed at each pre-execution stage. A policy denial or policy exception yields `denied`; an unsafe simulation or simulation exception yields `blocked`; a resolution exception yields `failure`; none of them reach `tool.execute`. `action.execution.started` is appended to the audit sink before execution, so a failing sink rejects the goal before any tool runs. When `requiresVerification` is set, a tool's `success` becomes `success` only after the verifier returns `ok: true`; a rejecting or throwing verifier yields `unverified`. An aborted signal rejects rather than being converted to an outcome. The Executive records the goal as `active`, then `completed` or `failed`, in the session.

Fork policy is enforced in two gates:

- [`check-workspace-constraints`](../../../../scripts/check-workspace-constraints.ts) excludes `packages/aris/*` from release membership and `checkArisManifest` requires those manifests to be `private`, omit `publishConfig`, and use the `@aris-os/` scope, which is outside the name-based dsh release family.
- [`translation-pairing.manifest.json`](../../../../scripts/translation-pairing.manifest.json) excludes `packages/aris/`, the blueprint, and this note from bilingual pairing. ARIS-owned documentation is English-only; inherited documentation stays bilingual.

The H2 Linux event adapters and attention gate from the closed `feat/native-harness-skeleton` branch, and its ports without an H1 consumer, are not part of this package.

## Alternatives considered

**Set DeepSeek publication metadata on the ARIS package.** The constraints gate would pass, but the manifest would claim a `deepseek-ai/deepseek-harness` repository and public release the package does not have. The blueprint forbids falsifying repository metadata to satisfy an upstream release gate.

**Place the runtime under `packages/experimental/`.** The experimental policy already keeps packages private, but it requires the `@deepseek-ai/dsh-experimental-` name prefix and signals a prototype. The runtime is the ARIS product spine, not an upstream experiment.

**Add the runtime as a third root solution reference.** The closed skeleton branch added `packages/aris/runtime` to the root `tsconfig.json`, which is program-less by design; the host aggregate already builds and checks every host-face package, so the package joins it.

**Keep bilingual pairing for ARIS documents.** The blueprint was committed English-only, and the fork owner chose English-only ARIS documentation. Enforcing pairing would require Chinese counterparts for every ARIS document and Agent Note.

**Keep every blueprint subsystem port.** The skeleton declared roughly twenty ports with no implementation or consumer. Each would need a design owner before its phase; unused ports imply capabilities that do not exist.

## Consequences

The runtime ships with 100% statement, branch, function, and line coverage, and its specs assert through the executor that denied, blocked, unresolvable, and audit-failed actions never reach a tool. Upstream release tooling cannot publish ARIS packages, and a renamed or unprivate ARIS manifest fails `constraints`.

Each new ARIS document outside `packages/aris/` needs its own entry in the pairing manifest. State is in-process only until H3, capability health does not gate tool resolution until H5, and ids are unbranded strings; the package README lists these limitations.
