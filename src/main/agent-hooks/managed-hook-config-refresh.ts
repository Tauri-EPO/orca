import { randomUUID } from 'node:crypto'
import { copyFile, lstat, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  createManagedCommandMatcher,
  type HookDefinition,
  type HooksConfig
} from './installer-utils'
import { parseHooksJsonText } from './hooks-json-read'

type RefreshManagedHookCommandOptions = {
  configPath: string
  scriptFileName: string
  resolveCommand: () => Promise<string>
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function readExistingConfig(
  configPath: string
): Promise<{ config: HooksConfig; raw: string } | null> {
  try {
    const raw = await readFile(configPath, 'utf-8')
    const config = parseHooksJsonText(raw)
    return config ? { config, raw } : null
  } catch (error) {
    if (isMissingPathError(error)) {
      return null
    }
    throw error
  }
}

function replaceManagedCommand(
  definition: HookDefinition,
  matches: (command: string | undefined) => boolean,
  command: string
): HookDefinition {
  const next = { ...definition }
  const directKeys = ['command', 'bash', 'powershell'] as const
  if (directKeys.some((key) => matches(next[key]))) {
    next.command = command
    delete next.bash
    delete next.powershell
  }
  if (Array.isArray(next.hooks)) {
    next.hooks = next.hooks.map((hook) => {
      const args = Array.isArray(hook.args) ? hook.args : []
      if (!matches(hook.command) && !args.some((arg) => typeof arg === 'string' && matches(arg))) {
        return hook
      }
      const migrated = { ...hook, command }
      delete migrated.args
      return migrated
    })
  }
  return next
}

function migrateManagedCommands(
  config: HooksConfig,
  scriptFileName: string,
  command: string
): HooksConfig {
  const matches = createManagedCommandMatcher(scriptFileName)
  const hooks = Object.fromEntries(
    Object.entries(config.hooks ?? {}).map(([eventName, definitions]) => [
      eventName,
      Array.isArray(definitions)
        ? definitions.map((definition) => replaceManagedCommand(definition, matches, command))
        : definitions
    ])
  )
  return { ...config, hooks }
}

async function resolveWritePath(configPath: string): Promise<string> {
  try {
    return (await lstat(configPath)).isSymbolicLink() ? await realpath(configPath) : configPath
  } catch (error) {
    if (isMissingPathError(error)) {
      return configPath
    }
    throw error
  }
}

async function writeBackup(sourcePath: string): Promise<void> {
  const backupPath = `${sourcePath}.bak`
  try {
    if ((await lstat(backupPath)).isSymbolicLink()) {
      throw new Error(`Refusing to overwrite symlinked backup: ${backupPath}`)
    }
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error
    }
  }
  const temporaryPath = `${backupPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await copyFile(sourcePath, temporaryPath)
    await rename(temporaryPath, backupPath)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

async function writeConfigIfUnchanged(
  configPath: string,
  expectedRaw: string,
  config: HooksConfig
): Promise<boolean> {
  const writePath = await resolveWritePath(configPath)
  const currentRaw = await readFile(writePath, 'utf-8')
  if (currentRaw !== expectedRaw) {
    return false
  }
  const serialized = `${JSON.stringify(config, null, 2)}\n`
  if (serialized === currentRaw) {
    return true
  }
  const temporaryPath = join(dirname(writePath), `.${Date.now()}-${randomUUID()}.tmp`)
  try {
    const mode = (await stat(writePath)).mode
    await writeFile(temporaryPath, serialized, { encoding: 'utf-8', mode })
    if ((await readFile(writePath, 'utf-8')) !== expectedRaw) {
      return false
    }
    await writeBackup(writePath)
    await rename(temporaryPath, writePath)
    return true
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

// Why: stale user-wide configs need launcher migration even when the agent CLI is absent.
export async function refreshManagedHookCommandIfPresent(
  options: RefreshManagedHookCommandOptions
): Promise<boolean> {
  const snapshot = await readExistingConfig(options.configPath)
  if (!snapshot) {
    return false
  }
  const matches = createManagedCommandMatcher(options.scriptFileName)
  const hasManagedCommand = Object.values(snapshot.config.hooks ?? {}).some(
    (definitions) =>
      Array.isArray(definitions) &&
      definitions.some((definition) => {
        const direct =
          matches(definition.command) || matches(definition.bash) || matches(definition.powershell)
        return (
          direct ||
          (Array.isArray(definition.hooks) &&
            definition.hooks.some(
              (hook) =>
                matches(hook.command) ||
                (Array.isArray(hook.args) &&
                  hook.args.some((arg) => typeof arg === 'string' && matches(arg)))
            ))
        )
      })
  )
  if (!hasManagedCommand) {
    return false
  }
  const command = await options.resolveCommand()
  return writeConfigIfUnchanged(
    options.configPath,
    snapshot.raw,
    migrateManagedCommands(snapshot.config, options.scriptFileName, command)
  )
}
