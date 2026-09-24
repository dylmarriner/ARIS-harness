/** Failure vocabulary shared by model providers and the router. */

import type { ModelProviderHealth } from '../contracts/types.ts'

/**
 * Why a provider call failed: `unavailable` for transport failures,
 * `timeout` when the budget elapsed, `rejected` for a non-success backend
 * status, and `invalid-response` for output that violates the wire format or
 * the requested response schema.
 */
export type ModelProviderErrorCode = 'unavailable' | 'timeout' | 'rejected' | 'invalid-response'

/** Provider call failure the router may recover from by trying another provider. */
export class ModelProviderError extends Error {
  /**
   * @param providerId - Provider that failed.
   * @param code - Failure class.
   * @param message - Failure detail.
   */
  constructor(
    readonly providerId: string,
    readonly code: ModelProviderErrorCode,
    message: string,
  ) {
    super(`${providerId}: ${message}`)
    this.name = 'ModelProviderError'
  }
}

/**
 * Combine a caller signal with the request budget's timeout.
 *
 * @param timeoutMs - Budget timeout in milliseconds.
 * @param signal - Caller signal.
 * @returns A signal that aborts on either source.
 */
export function budgetSignal(timeoutMs: number, signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout])
}

/**
 * Classify an error thrown by a transport call.
 *
 * A caller abort rethrows the caller's reason so it is never mistaken for a
 * provider failure; an elapsed budget becomes `timeout`; a
 * {@link ModelProviderError} passes through; anything else is `unavailable`.
 *
 * @param providerId - Provider that made the call.
 * @param error - Thrown value.
 * @param callerSignal - Caller signal.
 * @param budget - Signal returned by {@link budgetSignal} for the call.
 * @returns The classified provider error.
 */
export function transportError(
  providerId: string,
  error: unknown,
  callerSignal: AbortSignal | undefined,
  budget: AbortSignal,
): ModelProviderError {
  if (callerSignal?.aborted === true) throw callerSignal.reason
  if (error instanceof ModelProviderError) return error
  if (budget.aborted) return new ModelProviderError(providerId, 'timeout', 'budget timeout elapsed')
  return new ModelProviderError(providerId, 'unavailable', error instanceof Error ? error.message : String(error))
}

/**
 * Parse model text as JSON for a request that carried a response schema.
 *
 * @param providerId - Provider that produced the text.
 * @param text - Model output.
 * @returns The parsed value.
 */
export function parseStructuredOutput(providerId: string, text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new ModelProviderError(providerId, 'invalid-response', 'structured output is not valid JSON')
  }
}

/**
 * Health for a probe whose transport threw; a caller abort rethrows its reason.
 *
 * @param error - Error thrown by the Node transport.
 * @param signal - Caller signal.
 * @returns Unavailable health carrying the error message.
 */
export function unreachableHealth(error: unknown, signal: AbortSignal | undefined): ModelProviderHealth {
  if (signal?.aborted === true) throw signal.reason
  return { available: false, models: [], detail: (error as Error).message }
}
