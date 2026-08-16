import { randomUUID } from 'node:crypto'
import { copyFile, lstat, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  createManagedCommandMatcher,
  isPlainObject,
  type HookDefinition,
  type HooksConfig
} from './installer-utils'
import { parseHooksJsonText } from './hooks-json-read'

export type ManagedHookCommandMigration = {
  scriptFileName: string
  resolveCommand: () => Promise<string>
}

type RefreshManagedHookCommandsOptions = {
  configPath: string
  scriptFileName: string
  resolveCommand: () => Promise<string>
  additionalMigrations?: ManagedHookCommandMigration[]
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
  const statusLine = config.statusLine
  if (
    !isPlainObject(statusLine) ||
    typeof statusLine.command !== 'string' ||
    !matches(statusLine.command)
  ) {
    return { ...config, hooks }
  }
  return { ...config, hooks, statusLine: { ...statusLine, command } }
}

function configHasManagedCommand(
  config: HooksConfig,
  matches: (command: string | undefined) => boolean
): boolean {
  const statusLine = config.statusLine
  if (
    isPlainObject(statusLine) &&
    typeof statusLine.command === 'string' &&
    matches(statusLine.command)
  ) {
    return true
  }
  return Object.values(config.hooks ?? {}).some(
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
  let currentRaw: string
  try {
    currentRaw = await readFile(writePath, 'utf-8')
  } catch (error) {
    if (isMissingPathError(error)) {
      return false
    }
    throw error
  }
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
export async function refreshManagedHookCommandsIfPresent(
  options: RefreshManagedHookCommandsOptions
): Promise<boolean> {
  const snapshot = await readExistingConfig(options.configPath)
  if (!snapshot) {
    return false
  }
  const migrations = [
    { scriptFileName: options.scriptFileName, resolveCommand: options.resolveCommand },
    ...(options.additionalMigrations ?? [])
  ]
  const applicable = migrations.filter((migration) =>
    configHasManagedCommand(snapshot.config, createManagedCommandMatcher(migration.scriptFileName))
  )
  if (applicable.length === 0) {
    return false
  }
  const resolved = await Promise.all(
    applicable.map(async (migration) => ({
      scriptFileName: migration.scriptFileName,
      command: await migration.resolveCommand()
    }))
  )
  const migrated = resolved.reduce(
    (config, migration) =>
      migrateManagedCommands(config, migration.scriptFileName, migration.command),
    snapshot.config
  )
  return writeConfigIfUnchanged(options.configPath, snapshot.raw, migrated)
}
