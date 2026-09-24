/**
 * Seeding the belief graph from the `aris-eventd` world-state checkpoint
 * (`WorldStateSnapshot` v1, normally `/var/lib/aris/eventd/world-state.json`).
 */

import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import type { Belief } from '../contracts/types.ts'
import type { EventdSensitivity } from '../events/eventd.ts'
import type { BeliefGraph } from './belief-graph.ts'

const Uuid = z.uuid()
const Timestamp = z.iso.datetime({ offset: true })
const Sensitivity = z.enum(['public', 'internal', 'sensitive', 'restricted'])

/** `WorldStateSnapshot` v1 from `@aris/contracts`. */
export const WorldStateSnapshotSchema = z.object({
  schemaVersion: z.literal('v1'),
  revision: z.number().int().nonnegative(),
  generatedAt: Timestamp,
  entities: z.array(z.object({
    schemaVersion: z.literal('v1'),
    ref: z.object({ kind: z.string().min(1).max(128), id: z.string().min(1).max(512) }),
    nodeId: Uuid.optional(),
    sensitivity: Sensitivity.default('internal'),
    attributes: z.record(z.string(), z.unknown()),
    confidence: z.number().min(0).max(1),
    observedAt: Timestamp,
    updatedAt: Timestamp,
    sourceEventIds: z.array(Uuid).min(1),
  })),
  recentEventIds: z.array(Uuid),
})

/** Validated eventd world-state snapshot. */
export type WorldStateSnapshot = z.infer<typeof WorldStateSnapshotSchema>

/** Provenance source id recorded on beliefs derived from eventd state. */
export const EVENTD_SOURCE_ID = 'aris-eventd'

const SENSITIVITY_RANK: Readonly<Record<EventdSensitivity, number>> = { public: 0, internal: 1, sensitive: 2, restricted: 3 }

/**
 * Read and validate a checkpoint file.
 *
 * @param path - Checkpoint path.
 * @returns The snapshot, or `undefined` when the file does not exist; invalid content rejects.
 */
export async function loadWorldStateSnapshot(path: string): Promise<WorldStateSnapshot | undefined> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  return WorldStateSnapshotSchema.parse(JSON.parse(text))
}

/**
 * Upsert one `known` belief per entity attribute.
 *
 * Belief ids are `<kind>:<id>#<attribute>` with subject `<kind>:<id>`, the
 * entity confidence, and `sensor` provenance naming the source event ids.
 * Entities above `maxSensitivity` are skipped so restricted state never
 * enters model-visible context. Beliefs for entities or attributes absent from
 * the snapshot are left unchanged.
 *
 * @param graph - Graph to update.
 * @param snapshot - Validated snapshot.
 * @param maxSensitivity - Most sensitive label admitted.
 * @returns Number of beliefs upserted.
 */
export function applyWorldStateSnapshot(graph: BeliefGraph, snapshot: WorldStateSnapshot, maxSensitivity: EventdSensitivity): number {
  let count = 0
  for (const entity of snapshot.entities) {
    if (SENSITIVITY_RANK[entity.sensitivity] > SENSITIVITY_RANK[maxSensitivity]) continue
    const subject = `${entity.ref.kind}:${entity.ref.id}`
    for (const [predicate, object] of Object.entries(entity.attributes)) {
      const belief: Belief = {
        id: `${subject}#${predicate}`,
        subject,
        predicate,
        object,
        state: 'known',
        confidence: entity.confidence,
        provenance: [{ sourceKind: 'sensor', sourceId: EVENTD_SOURCE_ID, observedAt: entity.observedAt, detail: entity.sourceEventIds.join(',') }],
        updatedAt: entity.updatedAt,
      }
      graph.upsertBelief(belief)
      count += 1
    }
  }
  return count
}
