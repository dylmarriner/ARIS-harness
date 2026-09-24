/** Tools keyed by tool id, resolved by capability. */

import type { Action } from '../contracts/types.ts'
import type { Tool, ToolResolver } from '../ports.ts'

/** Registry whose resolution fails closed on unknown, mismatched, or ambiguous tools. */
export class ToolRegistry implements ToolResolver {
  private readonly tools = new Map<string, Tool>()

  /**
   * Register a tool; duplicate ids throw.
   *
   * @param tool - Tool to add.
   * @returns Disposer that removes this registration.
   */
  register(tool: Tool): () => void {
    if (this.tools.has(tool.id)) throw new Error(`tool already registered: ${tool.id}`)
    this.tools.set(tool.id, tool)
    return () => {
      this.tools.delete(tool.id)
    }
  }

  /**
   * Resolve the single tool for an action.
   *
   * A named tool must exist and expose the action's capability. An unnamed
   * action must match exactly one tool by capability.
   *
   * @param action - Action to resolve.
   * @returns The resolved tool.
   */
  resolve(action: Action): Tool {
    if (action.tool !== undefined) {
      const explicit = this.tools.get(action.tool)
      if (explicit === undefined) throw new Error(`unknown tool: ${action.tool}`)
      if (!explicit.capabilities.includes(action.capability)) {
        throw new Error(`tool ${explicit.id} does not expose capability ${action.capability}`)
      }
      return explicit
    }

    const [resolved, ...others] = [...this.tools.values()].filter(tool =>
      tool.capabilities.includes(action.capability))
    if (resolved === undefined) throw new Error(`no tool exposes capability: ${action.capability}`)
    if (others.length > 0) {
      throw new Error(`multiple tools expose capability ${action.capability}; action must name a tool`)
    }
    return resolved
  }
}
