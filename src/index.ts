import { Plugin } from "@opencode/plugin"
import { Error as ToolError } from "@opencode/plugin/promise/tool"
import type { Result as ToolResult } from "@opencode/plugin/promise/tool"
import type { Context } from "@opencode/plugin/promise/plugin"
import type { SessionContext } from "@opencode/plugin/promise/session"

/** One entry of the structured `content` list a tool result may carry. */
type ToolContent = Exclude<ToolResult["content"], string | undefined>[number]

interface ConnectionState {
  isConnected: boolean
  lastError?: string
  failureCount: number
}

const BROWSER_TOOL_PREFIX = "browsermcp_"

const browserSpeedGuidance = `When using Browser MCP, optimize for speed:
- Prefer direct URL navigation over click-through flows when the destination is known.
- Reuse the current tab and page state instead of repeating navigation.
- Minimize snapshots, screenshots, and waits; use them only after a page change or when visual confirmation is required.
- Prefer targeted extraction or direct actions over broad inspection.
- Finish the task in the fewest browser actions that still preserve correctness.`

const browserCompactionContext = `## Browser Automation Context

Browser MCP was used in this session. When resuming:
- Assume the current browser tab may still be useful.
- Check browser state once, then reuse it instead of repeating navigation.
- Prefer direct navigation, extraction, and targeted actions over repeated snapshots or screenshots.
- Use waits only when the page is still loading or an interaction has not settled yet.`

const browserToolHints = [
  {
    suffixes: ["_browser_navigate", "_navigate"],
    hint: "Prefer this when you already know the destination URL instead of clicking through intermediate pages.",
  },
  {
    suffixes: ["_browser_snapshot", "_snapshot"],
    hint: "This is relatively expensive. Reuse the latest snapshot unless the page changed or you need fresh element references.",
  },
  {
    suffixes: ["_browser_screenshot", "_screenshot"],
    hint: "Use only when the user needs visual confirmation. Prefer extraction or targeted checks for faster workflows.",
  },
  {
    suffixes: ["_browser_wait", "_wait"],
    hint: "Use only when content is still loading or an interaction has not settled. Avoid fixed waits when the next action can validate readiness.",
  },
] as const

const connectionErrorPatterns = [
  /econnrefused/i,
  /connection refused/i,
  /failed to connect/i,
  /could not connect/i,
  /browser\s*mcp.*(?:disconnected|unavailable|not connected)/i,
  /extension.*(?:disabled|disconnected|not connected|unavailable)/i,
  /websocket.*(?:closed|failed)/i,
  /timed out while connecting/i,
]

const isBrowserTool = (toolID: string): boolean => toolID.startsWith(BROWSER_TOOL_PREFIX)

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

const appendSection = (base: string, section: string): string => {
  const trimmedSection = section.trim()

  if (!trimmedSection) {
    return base
  }

  if (!base) {
    return trimmedSection
  }

  if (base.includes(trimmedSection)) {
    return base
  }

  return `${base.trimEnd()}\n\n${trimmedSection}`
}

const stringifyOutput = (value: unknown): string => {
  if (typeof value === "string") {
    return value
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const getFailureFlag = (value: Record<string, unknown>): boolean => {
  if (value.success === false || value.ok === false) {
    return true
  }

  if (value.isError === true || value.error === true) {
    return true
  }

  return false
}

const getConnectionErrorText = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    return value
  }

  if (!isRecord(value)) {
    return undefined
  }

  if (typeof value.error === "string") {
    return value.error
  }

  if (typeof value.stderr === "string") {
    return value.stderr
  }

  if (!getFailureFlag(value)) {
    return undefined
  }

  for (const field of ["message", "details"] as const) {
    if (typeof value[field] === "string") {
      return value[field]
    }
  }

  return undefined
}

const matchesConnectionError = (text: string | undefined): boolean => {
  if (!text) {
    return false
  }

  return connectionErrorPatterns.some((pattern) => pattern.test(text))
}

const isConnectionError = (value: unknown): boolean => matchesConnectionError(getConnectionErrorText(value))

const getToolHint = (toolID: string): string => {
  for (const { suffixes, hint } of browserToolHints) {
    if (suffixes.some((suffix) => toolID.endsWith(suffix))) {
      return hint
    }
  }

  return "Prefer the smallest action that advances the task, and avoid redundant browser calls when the current page state is already known."
}

/**
 * Tool results carry `content` as either a plain string or a list of content parts.
 * Both shapes need the hint appended without dropping any other part of the result.
 */
const appendResultSection = (result: ToolResult, section: string): ToolResult => {
  const { content } = result

  if (content === undefined) {
    return { ...result, content: section }
  }

  if (typeof content === "string") {
    return { ...result, content: appendSection(content, section) }
  }

  const alreadyPresent = content.some((part: ToolContent) => part.type === "text" && part.text.includes(section))

  if (alreadyPresent) {
    return result
  }

  return { ...result, content: [...content, { type: "text", text: section }] }
}

/**
 * A tool result is a success shape, so connection failures surface either as a
 * thrown `ToolError` or as an error-flavoured payload inside the result.
 */
const resultHasConnectionError = (result: ToolResult): boolean => {
  if (isConnectionError(result.output)) {
    return true
  }

  const { content } = result

  if (content === undefined) {
    return false
  }

  if (typeof content === "string") {
    return matchesConnectionError(content)
  }

  return content.some((part: ToolContent) => part.type === "text" && matchesConnectionError(part.text))
}

export default Plugin.define({
  id: "opencode-browser-v2",
  async setup(ctx: Context) {
    const browserSessions = new Set<string>()
    const connectionStates = new Map<string, ConnectionState>()
    const controller = new AbortController()

    const getConnectionState = (sessionID: string): ConnectionState => {
      const existingState = connectionStates.get(sessionID)

      if (existingState) {
        return existingState
      }

      const nextState: ConnectionState = {
        isConnected: true,
        failureCount: 0,
      }

      connectionStates.set(sessionID, nextState)
      return nextState
    }

    const markConnectionFailed = (sessionID: string, error: unknown) => {
      const connectionState = getConnectionState(sessionID)
      connectionState.isConnected = false
      connectionState.failureCount += 1
      connectionState.lastError = stringifyOutput(error)
      return connectionState
    }

    const resetConnectionState = (sessionID: string) => {
      const connectionState = getConnectionState(sessionID)
      connectionState.isConnected = true
      connectionState.failureCount = 0
      connectionState.lastError = undefined
    }

    const disconnectedHint = (failureCount: number): string =>
      failureCount === 1
        ? "[Browser MCP] The browser connection looks unavailable. Re-enable the Browser MCP extension or browser, then retry. The plugin skips delayed backoff so the next attempt can run immediately."
        : `[Browser MCP] Browser connection is still unavailable (failure ${failureCount}). Retry as soon as the extension is ready.`

    const restoredHint = "[Browser MCP] Connection restored. Continuing without extra retry delay."

    /**
     * Applied to every model-request kind that carries tools, so the guidance and the
     * per-tool performance hints reach the model no matter which loop is running.
     */
    const applyBrowserContext = (event: SessionContext) => {
      const last = event.system.length - 1

      if (last >= 0) {
        const part = event.system[last]

        if (!part.text.includes(browserSpeedGuidance)) {
          event.system[last] = { ...part, text: appendSection(part.text, browserSpeedGuidance) }
        }
      } else {
        event.system.push({ type: "text", text: browserSpeedGuidance })
      }

      for (const [toolID, definition] of Object.entries(event.tools)) {
        if (!isBrowserTool(toolID)) {
          continue
        }

        definition.description = appendSection(definition.description, `Performance: ${getToolHint(toolID)}`)
      }
    }

    await ctx.session.hook("context", applyBrowserContext)
    await ctx.session.hook("generate", applyBrowserContext)

    await ctx.tool.hook("execute.after", (event) => {
      if (!isBrowserTool(event.tool)) {
        return
      }

      browserSessions.add(event.sessionID)
      const connectionState = getConnectionState(event.sessionID)

      if (event.status === "error") {
        if (!matchesConnectionError(event.error.message)) {
          return
        }

        const { failureCount } = markConnectionFailed(event.sessionID, event.error.message)

        event.error = new ToolError({
          message: appendSection(event.error.message, disconnectedHint(failureCount)),
          error: event.error.error,
          metadata: event.error.metadata,
        })
        return
      }

      if (resultHasConnectionError(event.result)) {
        const { failureCount } = markConnectionFailed(event.sessionID, event.result.output ?? event.result.content)
        event.result = appendResultSection(event.result, disconnectedHint(failureCount))
        return
      }

      if (!connectionState.isConnected) {
        resetConnectionState(event.sessionID)
        event.result = appendResultSection(event.result, restoredHint)
      }
    })

    await ctx.session.hook("compaction", (event) => {
      if (browserSessions.has(event.sessionID)) {
        event.system.push({ type: "text", text: browserCompactionContext })
      }
    })

    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          if (event.type !== "session.deleted") {
            continue
          }

          browserSessions.delete(event.data.sessionID)
          connectionStates.delete(event.data.sessionID)
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          throw error
        }
      }
    })()

    return () => {
      controller.abort()
      browserSessions.clear()
      connectionStates.clear()
    }
  },
})
