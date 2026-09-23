import type {
  Action,
  Artifact,
  AuditRecord,
  AuthorizationDecision,
  Capability,
  Goal,
  ModelCapabilities,
  ModelRequest,
  ModelResponse,
  Observation,
  Plan,
  RuntimeEvent,
  SimulationResult,
  ToolExecutionResult,
  VerificationResult,
} from './contracts/types.ts'
import type { SessionSnapshot } from './runtime/session.ts'

export interface ModelProvider {
  readonly id: string
  readonly capabilities: ModelCapabilities
  generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse>
}

export interface Tool {
  readonly id: string
  readonly capabilities: readonly string[]
  execute(action: Action, signal?: AbortSignal): Promise<ToolExecutionResult>
}

export interface ToolResolver {
  resolve(action: Action): Tool
}

export interface Planner {
  plan(goal: Goal, session: SessionSnapshot, signal?: AbortSignal): Promise<Plan>
}

export interface PolicyEngine {
  authorize(
    goal: Goal,
    action: Action,
    session: SessionSnapshot,
  ): Promise<AuthorizationDecision>
}

export interface Simulator {
  simulate(
    goal: Goal,
    action: Action,
    session: SessionSnapshot,
    signal?: AbortSignal,
  ): Promise<SimulationResult>
}

export interface Verifier {
  verify(
    goal: Goal,
    action: Action,
    result: ToolExecutionResult,
    session: SessionSnapshot,
    signal?: AbortSignal,
  ): Promise<VerificationResult>
}

export interface AuditSink {
  append(record: AuditRecord): Promise<void>
}

export interface AttentionGate {
  shouldProcess(event: RuntimeEvent, session: SessionSnapshot): Promise<boolean>
}

export interface ContextBuilder {
  build(goal: Goal, session: SessionSnapshot): Promise<Readonly<Record<string, unknown>>>
}

export interface MemoryStore {
  storeObservation(observation: Observation): Promise<void>
  search(query: string, limit: number): Promise<readonly Observation[]>
}

export interface Scheduler {
  schedule(jobId: string, at: Date, event: RuntimeEvent): Promise<void>
  cancel(jobId: string): Promise<void>
}

export interface RecoveryManager {
  checkpoint(session: SessionSnapshot): Promise<string>
  restore(checkpointId: string): Promise<SessionSnapshot>
}

export interface SecretStore {
  resolve(secretRef: string, purpose: string): Promise<string>
}

export interface PermissionService {
  hasPermission(subjectId: string, capability: string): Promise<boolean>
}

export interface ResourceManager {
  snapshot(): Promise<Readonly<Record<string, number | string | boolean>>>
}

export interface NotificationService {
  notify(
    severity: 'info' | 'warning' | 'critical',
    message: string,
  ): Promise<void>
}

export interface ReflectionEngine {
  reflect(goal: Goal, session: SessionSnapshot): Promise<readonly string[]>
}

export interface SkillStore {
  listCapabilities(): Promise<readonly Capability[]>
}

export interface AgentBridge {
  readonly id: string
  readonly capabilities: readonly string[]
  invoke(request: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<unknown>
}

export interface ArtifactStore {
  save(artifact: Artifact): Promise<void>
  get(id: string): Promise<Artifact | undefined>
}

export interface ReplayStore {
  append(event: RuntimeEvent): Promise<void>
}

export interface VersionStore {
  current(component: string): Promise<string | undefined>
}

export interface PresenceService {
  currentSurfaces(): Promise<readonly string[]>
}

export interface IdentityService {
  currentIdentity(): Promise<Readonly<Record<string, unknown>>>
}

export interface CommunicationBus {
  publish(event: RuntimeEvent): Promise<void>
}

export interface TransactionHandle {
  readonly id: string
  commit(): Promise<void>
  rollback(reason: string): Promise<void>
}

export interface TransactionManager {
  begin(action: Action): Promise<TransactionHandle>
}

export interface ModelRouter {
  route(capability: string, session: SessionSnapshot): Promise<ModelProvider>
}

export interface Evaluator {
  evaluate(goal: Goal, session: SessionSnapshot): Promise<Readonly<Record<string, number>>>
}
