export type EntityId = string
export type IsoTimestamp = string

export type ConfidenceState =
  | 'known'
  | 'inferred'
  | 'suspected'
  | 'unverified'
  | 'contradicted'

export type ImpactLevel = 'read' | 'write' | 'privileged' | 'external'
export type GoalStatus = 'pending' | 'active' | 'completed' | 'failed' | 'cancelled'
export type ActionStatus = 'success' | 'failure' | 'denied' | 'blocked' | 'unverified'
export type CapabilityHealth = 'healthy' | 'degraded' | 'unavailable' | 'unknown'
export type EventPriority = 'low' | 'normal' | 'high' | 'critical'

export interface ProvenanceRef {
  readonly sourceKind:
    | 'user'
    | 'system'
    | 'tool'
    | 'model'
    | 'memory'
    | 'agent'
    | 'web'
    | 'sensor'
  readonly sourceId: string
  readonly observedAt: IsoTimestamp
  readonly detail?: string
}

export interface Evidence {
  readonly id: EntityId
  readonly summary: string
  readonly provenance: ProvenanceRef
  readonly confidence: number
}

export interface Observation {
  readonly id: EntityId
  readonly kind: string
  readonly subject: string
  readonly summary: string
  readonly observedAt: IsoTimestamp
  readonly confidence: number
  readonly evidence: readonly Evidence[]
  readonly attributes: Readonly<Record<string, unknown>>
}

export interface Hypothesis {
  readonly id: EntityId
  readonly subject: string
  readonly statement: string
  readonly confidence: number
  readonly state: ConfidenceState
  readonly evidenceIds: readonly EntityId[]
}

export interface Constraint {
  readonly id: EntityId
  readonly kind: 'hard' | 'soft'
  readonly description: string
  readonly provenance: ProvenanceRef
}

export interface Goal {
  readonly id: EntityId
  readonly description: string
  readonly priority: number
  readonly createdAt: IsoTimestamp
  readonly constraints: readonly Constraint[]
  readonly status: GoalStatus
}

export interface Action {
  readonly id: EntityId
  readonly kind: string
  readonly capability: string
  readonly tool?: string
  readonly input: Readonly<Record<string, unknown>>
  readonly impact: ImpactLevel
  readonly requiresVerification: boolean
  readonly transactional: boolean
}

export interface Plan {
  readonly id: EntityId
  readonly goalId: EntityId
  readonly createdAt: IsoTimestamp
  readonly rationale: string
  readonly actions: readonly Action[]
}

export interface ToolExecutionResult {
  readonly actionId: EntityId
  readonly status: 'success' | 'failure'
  readonly output: unknown
  readonly startedAt: IsoTimestamp
  readonly finishedAt: IsoTimestamp
  readonly error?: string
}

export interface ActionResult {
  readonly actionId: EntityId
  readonly status: ActionStatus
  readonly output: unknown
  readonly reason?: string
  readonly verification?: VerificationResult
}

export interface Capability {
  readonly id: string
  readonly kind: 'model' | 'tool' | 'agent' | 'device' | 'service' | 'runtime'
  readonly description: string
  readonly health: CapabilityHealth
  readonly tags: readonly string[]
  readonly metadata: Readonly<Record<string, unknown>>
  readonly updatedAt: IsoTimestamp
}

export interface RuntimeEvent<T = unknown> {
  readonly id: EntityId
  readonly type: string
  readonly source: string
  readonly occurredAt: IsoTimestamp
  readonly priority: EventPriority
  readonly payload: T
}

export interface Belief {
  readonly id: EntityId
  readonly subject: string
  readonly predicate: string
  readonly object: unknown
  readonly state: ConfidenceState
  readonly confidence: number
  readonly provenance: readonly ProvenanceRef[]
  readonly updatedAt: IsoTimestamp
}

export interface BeliefEdge {
  readonly id: EntityId
  readonly fromBeliefId: EntityId
  readonly toBeliefId: EntityId
  readonly relation: string
}

export interface ModelCapabilities {
  readonly text: boolean
  readonly vision: boolean
  readonly tools: boolean
  readonly embeddings: boolean
  readonly maxContextTokens?: number
}

export interface ModelRequest {
  readonly purpose: string
  readonly input: string
  readonly context: Readonly<Record<string, unknown>>
}

export interface ModelResponse {
  readonly providerId: string
  readonly output: string
  readonly metadata: Readonly<Record<string, unknown>>
}

export interface AuthorizationDecision {
  readonly allowed: boolean
  readonly reason: string
  readonly scope?: string
}

export interface SimulationResult {
  readonly safe: boolean
  readonly reason: string
  readonly predictedEffects: readonly string[]
}

export interface VerificationResult {
  readonly ok: boolean
  readonly reason: string
  readonly confidence: number
}

export interface AuditRecord {
  readonly id: EntityId
  readonly type: string
  readonly occurredAt: IsoTimestamp
  readonly goalId?: EntityId
  readonly actionId?: EntityId
  readonly details: Readonly<Record<string, unknown>>
}

export interface Artifact {
  readonly id: EntityId
  readonly kind: string
  readonly uri: string
  readonly createdAt: IsoTimestamp
  readonly provenance: ProvenanceRef
}
