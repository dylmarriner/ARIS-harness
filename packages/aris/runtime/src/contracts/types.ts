/** Typed runtime contracts shared by every ARIS runtime subsystem. */

/** Identifier of a runtime entity; unique within its collection. */
export type EntityId = string
/** ISO-8601 timestamp string. */
export type IsoTimestamp = string

/** How strongly a belief or hypothesis is held. */
export type ConfidenceState =
  | 'known'
  | 'inferred'
  | 'suspected'
  | 'unverified'
  | 'contradicted'

/** Effect class of an action; anything other than `read` mutates or leaves the host. */
export type ImpactLevel = 'read' | 'write' | 'privileged' | 'external'
/** Goal lifecycle state. */
export type GoalStatus = 'pending' | 'active' | 'completed' | 'failed' | 'cancelled'
/**
 * Executive outcome of one action: `denied` by policy, `blocked` by
 * simulation, `failure` in resolution or execution, `unverified` when
 * required verification rejected the result.
 */
export type ActionStatus = 'success' | 'failure' | 'denied' | 'blocked' | 'unverified'
/** Capability availability; only `healthy` capabilities are routable. */
export type CapabilityHealth = 'healthy' | 'degraded' | 'unavailable' | 'unknown'
/** Event priority as reported by its source. */
export type EventPriority = 'low' | 'normal' | 'high' | 'critical'

/** Origin of a fact. */
export interface ProvenanceRef {
  /** Class of source that produced the fact. */
  readonly sourceKind:
    | 'user'
    | 'system'
    | 'tool'
    | 'model'
    | 'memory'
    | 'agent'
    | 'web'
    | 'sensor'
  /** Source identifier within its kind. */
  readonly sourceId: string
  /** When the source observed the fact. */
  readonly observedAt: IsoTimestamp
  /** Free-form source detail. */
  readonly detail?: string
}

/** One piece of evidence with its provenance. */
export interface Evidence {
  /** Evidence id. */
  readonly id: EntityId
  /** Human-readable summary. */
  readonly summary: string
  /** Where the evidence came from. */
  readonly provenance: ProvenanceRef
  /** Confidence in `[0, 1]`. */
  readonly confidence: number
}

/** Normalized observation of runtime or environment state. */
export interface Observation {
  /** Observation id. */
  readonly id: EntityId
  /** Observation kind, for example `network.link`. */
  readonly kind: string
  /** Entity the observation describes. */
  readonly subject: string
  /** Human-readable summary. */
  readonly summary: string
  /** When the observation was made. */
  readonly observedAt: IsoTimestamp
  /** Confidence in `[0, 1]`. */
  readonly confidence: number
  /** Supporting evidence. */
  readonly evidence: readonly Evidence[]
  /** Kind-specific structured attributes. */
  readonly attributes: Readonly<Record<string, unknown>>
}

/** Candidate explanation that has not been accepted as a belief. */
export interface Hypothesis {
  /** Hypothesis id. */
  readonly id: EntityId
  /** Entity the hypothesis concerns. */
  readonly subject: string
  /** Proposed statement. */
  readonly statement: string
  /** Confidence in `[0, 1]`. */
  readonly confidence: number
  /** Current confidence state. */
  readonly state: ConfidenceState
  /** Evidence ids supporting or refuting the statement. */
  readonly evidenceIds: readonly EntityId[]
}

/** Restriction a goal's plan must respect. */
export interface Constraint {
  /** Constraint id. */
  readonly id: EntityId
  /** `hard` constraints must hold; `soft` constraints are preferences. */
  readonly kind: 'hard' | 'soft'
  /** Human-readable constraint. */
  readonly description: string
  /** Who imposed the constraint. */
  readonly provenance: ProvenanceRef
}

/** Outcome the Executive pursues. */
export interface Goal {
  /** Goal id. */
  readonly id: EntityId
  /** Human-readable goal. */
  readonly description: string
  /** Priority; higher values are more urgent. */
  readonly priority: number
  /** When the goal was created. */
  readonly createdAt: IsoTimestamp
  /** Constraints the plan must respect. */
  readonly constraints: readonly Constraint[]
  /** Lifecycle state. */
  readonly status: GoalStatus
}

/** One proposed step of a plan. */
export interface Action {
  /** Action id; unique within its plan. */
  readonly id: EntityId
  /** Action kind, for example `service.restart`. */
  readonly kind: string
  /** Capability id the action requires. */
  readonly capability: string
  /** Explicit tool id; omitted actions resolve by capability. */
  readonly tool?: string
  /** Tool input. */
  readonly input: Readonly<Record<string, unknown>>
  /** Effect class used by policy and simulation. */
  readonly impact: ImpactLevel
  /** When `true`, a successful tool return is not success until verified. */
  readonly requiresVerification: boolean
  /** Whether the action runs inside a transaction. */
  readonly transactional: boolean
}

/** Ordered actions proposed for one goal. */
export interface Plan {
  /** Plan id. */
  readonly id: EntityId
  /** Goal the plan serves. */
  readonly goalId: EntityId
  /** When the plan was created. */
  readonly createdAt: IsoTimestamp
  /** Planner rationale. */
  readonly rationale: string
  /** Actions in execution order. */
  readonly actions: readonly Action[]
}

/** What a tool reports after executing an action. */
export interface ToolExecutionResult {
  /** Executed action id. */
  readonly actionId: EntityId
  /** Tool-reported outcome; `success` does not imply verification. */
  readonly status: 'success' | 'failure'
  /** Tool output. */
  readonly output: unknown
  /** Execution start. */
  readonly startedAt: IsoTimestamp
  /** Execution end. */
  readonly finishedAt: IsoTimestamp
  /** Failure detail when `status` is `failure`. */
  readonly error?: string
}

/** Executive-owned outcome of one action. */
export interface ActionResult {
  /** Action id. */
  readonly actionId: EntityId
  /** Executive outcome. */
  readonly status: ActionStatus
  /** Tool output, or `null` when no tool ran. */
  readonly output: unknown
  /** Why the action did not succeed. */
  readonly reason?: string
  /** Verification verdict when verification ran. */
  readonly verification?: VerificationResult
}

/** Live capability entry. */
export interface Capability {
  /** Capability id. */
  readonly id: string
  /** What provides the capability. */
  readonly kind: 'model' | 'tool' | 'agent' | 'device' | 'service' | 'runtime'
  /** Human-readable description. */
  readonly description: string
  /** Current health. */
  readonly health: CapabilityHealth
  /** Tags usable as lookup keys. */
  readonly tags: readonly string[]
  /** Provider-specific metadata. */
  readonly metadata: Readonly<Record<string, unknown>>
  /** When health or metadata last changed. */
  readonly updatedAt: IsoTimestamp
}

/** Event carried by the runtime event bus. */
export interface RuntimeEvent<T = unknown> {
  /** Event id. */
  readonly id: EntityId
  /** Event type used for subscription. */
  readonly type: string
  /** Emitting source. */
  readonly source: string
  /** When the event occurred. */
  readonly occurredAt: IsoTimestamp
  /** Source-reported priority. */
  readonly priority: EventPriority
  /** Type-specific payload. */
  readonly payload: T
}

/** Subject–predicate–object belief in the operational world model. */
export interface Belief {
  /** Belief id. */
  readonly id: EntityId
  /** Entity the belief describes. */
  readonly subject: string
  /** Relation or property name. */
  readonly predicate: string
  /** Relation target or property value. */
  readonly object: unknown
  /** Confidence state. */
  readonly state: ConfidenceState
  /** Confidence in `[0, 1]`. */
  readonly confidence: number
  /** Sources supporting the belief. */
  readonly provenance: readonly ProvenanceRef[]
  /** When the belief last changed. */
  readonly updatedAt: IsoTimestamp
}

/** Directed relation between two beliefs. */
export interface BeliefEdge {
  /** Edge id. */
  readonly id: EntityId
  /** Source belief id. */
  readonly fromBeliefId: EntityId
  /** Target belief id. */
  readonly toBeliefId: EntityId
  /** Relation name. */
  readonly relation: string
}

/** Model provider feature flags. */
export interface ModelCapabilities {
  /** Text generation. */
  readonly text: boolean
  /** Image input. */
  readonly vision: boolean
  /** Structured tool calls. */
  readonly tools: boolean
  /** Embedding output. */
  readonly embeddings: boolean
  /** Context window in tokens, when known. */
  readonly maxContextTokens?: number
}

/** Structured model request; providers translate it to their wire format. */
export interface ModelRequest {
  /** Why the model is being called. */
  readonly purpose: string
  /** Primary input. */
  readonly input: string
  /** Scoped structured context. */
  readonly context: Readonly<Record<string, unknown>>
}

/** Model output. */
export interface ModelResponse {
  /** Provider that produced the output. */
  readonly providerId: string
  /** Generated output. */
  readonly output: string
  /** Provider-specific metadata such as usage. */
  readonly metadata: Readonly<Record<string, unknown>>
}

/** Policy decision for one action. */
export interface AuthorizationDecision {
  /** Whether the action may proceed to simulation. */
  readonly allowed: boolean
  /** Decision rationale. */
  readonly reason: string
  /** Scope the grant covers: a capability id for standing grants, an action id for one-shot approval. */
  readonly scope?: string
}

/** Simulation verdict for one action. */
export interface SimulationResult {
  /** Whether the action may proceed to execution. */
  readonly safe: boolean
  /** Verdict rationale. */
  readonly reason: string
  /** Effects the simulator predicts. */
  readonly predictedEffects: readonly string[]
}

/** Verification verdict for one executed action. */
export interface VerificationResult {
  /** Whether the intended effect was observed. */
  readonly ok: boolean
  /** Verdict rationale. */
  readonly reason: string
  /** Confidence in `[0, 1]`. */
  readonly confidence: number
}

/** One Executive audit entry. */
export interface AuditRecord {
  /** Record id. */
  readonly id: EntityId
  /** Record type, for example `action.denied`. */
  readonly type: string
  /** When the record was written. */
  readonly occurredAt: IsoTimestamp
  /** Goal the record concerns. */
  readonly goalId?: EntityId
  /** Action the record concerns. */
  readonly actionId?: EntityId
  /** Type-specific details. */
  readonly details: Readonly<Record<string, unknown>>
}

/** Produced file or object. */
export interface Artifact {
  /** Artifact id. */
  readonly id: EntityId
  /** Artifact kind. */
  readonly kind: string
  /** Location of the artifact content. */
  readonly uri: string
  /** When the artifact was produced. */
  readonly createdAt: IsoTimestamp
  /** Producer of the artifact. */
  readonly provenance: ProvenanceRef
}
