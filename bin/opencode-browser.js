#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, resolve } from "node:path"

const schemaUrl = "https://opencode.ai/config.json"
const pluginName = "opencode-browser-v2"
const legacyPluginName = "opencode-browser"
const serverName = "browsermcp"
const browserMcpVersion = "0.1.3"
const legacyBrowserMcpCommand = ["npx", "-y", "@browsermcp/mcp@latest"]
const defaultBrowserMcpConfig = {
  type: "local",
  command: ["npx", "-y", `@browsermcp/mcp@${browserMcpVersion}`],
}

function isSameCommand(actual, expected) {
  return Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
}

function printUsage() {
  console.log(`Usage: opencode-browser-v2 [init] [--project|--global|--path <file>] [--print]\n\n` +
    `Examples:\n` +
    `  npx opencode-browser-v2 init\n` +
    `  npx opencode-browser-v2 init --global\n` +
    `  npx opencode-browser-v2 init --path ./opencode.json\n` +
    `  npx opencode-browser-v2 init --print`)
}

function parseArgs(argv) {
  const args = [...argv]
  let command = "init"

  if (args[0] && !args[0].startsWith("-")) {
    command = args.shift()
  }

  const options = {
    mode: "project",
    configPath: undefined,
    printOnly: false,
  }

  while (args.length > 0) {
    const arg = args.shift()

    if (arg === "--global") {
      options.mode = "global"
      continue
    }

    if (arg === "--project") {
      options.mode = "project"
      continue
    }

    if (arg === "--path") {
      const customPath = args.shift()

      if (!customPath) {
        throw new Error("Missing value for --path")
      }

      options.configPath = customPath
      continue
    }

    if (arg === "--print") {
      options.printOnly = true
      continue
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return { command, options }
}

function loadConfig(targetPath) {
  if (!existsSync(targetPath)) {
    return {}
  }

  const raw = readFileSync(targetPath, "utf8")

  try {
    const parsed = JSON.parse(raw)

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Config must be a JSON object")
    }

    return parsed
  } catch (error) {
    throw new Error(`Unable to parse ${targetPath}: ${error.message}`)
  }
}

function ensureObject(value, fieldName) {
  if (value === undefined) {
    return {}
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`The "${fieldName}" field must be an object`)
  }

  return { ...value }
}

/**
 * V2 plugin entries are either a package name or `{ package, options }`. V1 also allowed a
 * `[package, options]` tuple, so tuples are folded into the object form on the way through.
 */
function normalizePluginEntry(entry, fieldName) {
  if (typeof entry === "string") {
    return { entry, package: entry, migrated: false }
  }

  if (Array.isArray(entry)) {
    const [packageName, packageOptions] = entry

    if (typeof packageName !== "string") {
      throw new Error(`Every "${fieldName}" tuple must start with a package name`)
    }

    return {
      entry: packageOptions === undefined
        ? packageName
        : { package: packageName, options: packageOptions },
      package: packageName,
      migrated: true,
    }
  }

  if (entry && typeof entry === "object" && typeof entry.package === "string") {
    return { entry: { ...entry }, package: entry.package, migrated: false }
  }

  throw new Error(`Every "${fieldName}" entry must be a package name, a { package, options } object, or a [package, options] tuple`)
}

function normalizePlugins(pluginField, fieldName) {
  if (pluginField === undefined) {
    return { entries: [], migrated: false }
  }

  const rawEntries = Array.isArray(pluginField) ? pluginField : [pluginField]
  const entries = []
  let migrated = false

  for (const rawEntry of rawEntries) {
    const normalized = normalizePluginEntry(rawEntry, fieldName)
    migrated = migrated || normalized.migrated

    if (entries.some((existing) => existing.package === normalized.package)) {
      continue
    }

    entries.push(normalized)
  }

  return { entries, migrated }
}

function mergePlugins(config, changes) {
  const fromV2 = normalizePlugins(config.plugins, "plugins")
  const fromV1 = normalizePlugins(config.plugin, "plugin")

  const entries = [...fromV2.entries]

  for (const candidate of fromV1.entries) {
    if (entries.some((existing) => existing.package === candidate.package)) {
      continue
    }

    entries.push(candidate)
  }

  if (config.plugin !== undefined) {
    delete config.plugin
    changes.push('migrated "plugin" to the v2 "plugins" field')
  } else if (fromV2.migrated) {
    changes.push('normalized "plugins" entries to the v2 object form')
  }

  // The v1 package does not run under OpenCode v2, so point an existing entry at this package.
  const legacy = entries.find((existing) => existing.package === legacyPluginName)

  if (legacy && !entries.some((existing) => existing.package === pluginName)) {
    legacy.package = pluginName
    legacy.entry = typeof legacy.entry === "string"
      ? pluginName
      : { ...legacy.entry, package: pluginName }
    changes.push(`replaced the v1 "${legacyPluginName}" plugin with "${pluginName}"`)
  } else if (legacy) {
    entries.splice(entries.indexOf(legacy), 1)
    changes.push(`removed the superseded v1 "${legacyPluginName}" plugin`)
  }

  if (!entries.some((existing) => existing.package === pluginName)) {
    entries.push({ entry: pluginName, package: pluginName })
    changes.push(`enabled ${pluginName} plugin`)
  }

  config.plugins = entries.map((existing) => existing.entry)
}

/**
 * V2 nests servers under `mcp.servers`; V1 put them directly on `mcp`. Anything on `mcp` other
 * than the two v2 keys is therefore a v1 server entry that needs relocating.
 */
function mergeMcp(config, changes) {
  const mcp = ensureObject(config.mcp, "mcp")
  const servers = ensureObject(mcp.servers, "mcp.servers")
  const legacyNames = Object.keys(mcp).filter((key) => key !== "servers" && key !== "timeout")

  for (const name of legacyNames) {
    servers[name] = { ...servers[name], ...ensureObject(mcp[name], `mcp.${name}`) }
    delete mcp[name]
  }

  if (legacyNames.length > 0) {
    changes.push(`moved ${legacyNames.length} MCP server${legacyNames.length === 1 ? "" : "s"} under "mcp.servers"`)
  }

  const browsermcp = ensureObject(servers[serverName], `mcp.servers.${serverName}`)

  if (browsermcp.type === undefined) {
    browsermcp.type = defaultBrowserMcpConfig.type
    changes.push("set Browser MCP type")
  }

  if (browsermcp.command === undefined) {
    browsermcp.command = [...defaultBrowserMcpConfig.command]
    changes.push("set Browser MCP command")
  } else if (isSameCommand(browsermcp.command, legacyBrowserMcpCommand)) {
    browsermcp.command = [...defaultBrowserMcpConfig.command]
    changes.push("pinned Browser MCP command version")
  }

  // V2 replaced the `enabled` flag with `disabled`; servers are enabled by default.
  if (browsermcp.enabled !== undefined) {
    const wasEnabled = browsermcp.enabled !== false
    delete browsermcp.enabled

    if (wasEnabled) {
      delete browsermcp.disabled
    } else {
      browsermcp.disabled = true
    }

    changes.push('replaced the v1 "enabled" flag with the v2 "disabled" flag')
  }

  servers[serverName] = browsermcp
  mcp.servers = servers
  config.mcp = mcp
}

function mergeAgents(config, changes) {
  if (config.agent === undefined) {
    return
  }

  const legacyAgents = ensureObject(config.agent, "agent")
  const agents = ensureObject(config.agents, "agents")

  for (const [name, definition] of Object.entries(legacyAgents)) {
    if (agents[name] === undefined) {
      agents[name] = definition
    }
  }

  delete config.agent
  config.agents = agents
  changes.push('migrated "agent" to the v2 "agents" field')
}

function mergeConfig(config) {
  const nextConfig = { ...config }
  const changes = []

  if (!nextConfig.$schema) {
    nextConfig.$schema = schemaUrl
    changes.push("added OpenCode schema")
  }

  mergePlugins(nextConfig, changes)
  mergeMcp(nextConfig, changes)
  mergeAgents(nextConfig, changes)

  return { nextConfig, changes }
}

function getTargetPath(mode, customPath) {
  if (customPath) {
    return resolve(customPath)
  }

  if (mode === "global") {
    return resolve(homedir(), ".config/opencode/opencode.json")
  }

  return resolve(process.cwd(), "opencode.json")
}

async function main() {
  try {
    const { command, options } = parseArgs(process.argv.slice(2))

    if (options.help) {
      printUsage()
      return
    }

    if (command !== "init") {
      throw new Error(`Unknown command: ${command}`)
    }

    const targetPath = getTargetPath(options.mode, options.configPath)
    const hadExistingConfig = existsSync(targetPath)
    const config = loadConfig(targetPath)
    const { nextConfig, changes } = mergeConfig(config)
    const output = `${JSON.stringify(nextConfig, null, 2)}\n`

    if (options.printOnly) {
      process.stdout.write(output)
      return
    }

    mkdirSync(dirname(targetPath), { recursive: true })
    writeFileSync(targetPath, output)

    const action = hadExistingConfig ? "Updated" : "Created"
    console.log(`${action} ${targetPath}`)

    if (changes.length === 0) {
      console.log("No changes were needed; Browser MCP is already configured.")
      return
    }

    console.log(`Applied ${changes.length} change${changes.length === 1 ? "" : "s"}:`)
    for (const change of changes) {
      console.log(`- ${change}`)
    }
  } catch (error) {
    console.error(`[opencode-browser-v2] ${error.message}`)
    printUsage()
    process.exitCode = 1
  }
}

await main()
