import type { Action } from '../contracts/types.ts'
import type { Tool, ToolResolver } from '../ports.ts'

export class ToolRegistry implements ToolResolver {
  private readonly tools = new Map<string, Tool>()

  register(tool: Tool): void {
    if (this.tools.has(tool.id)) throw new Error(`tool already registered: ${tool.id}`)
    this.tools.set(tool.id, tool)
  }

  get(id: string): Tool | undefined {
    return this.tools.get(id)
  }

  list(): readonly Tool[] {
    return [...this.tools.values()]
  }

  resolve(action: Action): Tool {
    if (action.tool !== undefined) {
      const explicit = this.tools.get(action.tool)
      if (explicit === undefined) throw new Error(`unknown tool: ${action.tool}`)
      if (!explicit.capabilities.includes(action.capability)) {
        throw new Error(
          `tool ${explicit.id} does not expose capability ${action.capability}`,
        )
      }
      return explicit
    }

    const candidates = this.list().filter(tool =>
      tool.capabilities.includes(action.capability))
    if (candidates.length === 0) {
      throw new Error(`no tool exposes capability: ${action.capability}`)
    }
    if (candidates.length > 1) {
      throw new Error(
        `multiple tools expose capability ${action.capability}; action must name a tool`,
      )
    }
    const resolved = candidates[0]
    if (resolved === undefined) throw new Error('tool resolution invariant violated')
    return resolved
  }
}
