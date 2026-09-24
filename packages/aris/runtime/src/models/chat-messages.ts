/** Translation of a structured `ModelRequest` into an ordered chat transcript. */

import type { ModelMessage, ModelRequest } from '../contracts/types.ts'

/** Participant name of the message that carries serialized runtime context. */
export const STATE_CONTEXT_MESSAGE_NAME = 'aris_state_context'

/**
 * Build the chat transcript a provider sends.
 *
 * Order: optional `system` instructions, the serialized `context` as a user
 * message named {@link STATE_CONTEXT_MESSAGE_NAME} wrapped in
 * `<ARIS_STATE_CONTEXT>` tags when `context` has entries, `history`, then
 * `input` as the final user message. The context wrapping matches the ARIS
 * state-pack message so ARIS-trained models see one format.
 *
 * @param request - Structured request.
 * @returns Messages in send order.
 */
export function toChatMessages(request: ModelRequest): readonly ModelMessage[] {
  const messages: ModelMessage[] = []
  if (request.system !== undefined) messages.push({ role: 'system', content: request.system })
  if (Object.keys(request.context).length > 0) {
    messages.push({
      role: 'user',
      name: STATE_CONTEXT_MESSAGE_NAME,
      content: `<ARIS_STATE_CONTEXT>\n${JSON.stringify(request.context)}\n</ARIS_STATE_CONTEXT>`,
    })
  }
  messages.push(...(request.history ?? []))
  messages.push({ role: 'user', content: request.input })
  return messages
}
