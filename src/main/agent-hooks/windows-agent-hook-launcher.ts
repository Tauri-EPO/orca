import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs'
import { access, copyFile, mkdir, readFile, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

const LAUNCHER_FILE_NAME = 'orca-agent-hook.exe'

function getVersionedLauncherFileName(source: Buffer): string {
  const digest = createHash('sha256').update(source).digest('hex').slice(0, 16)
  return `orca-agent-hook-${digest}.exe`
}

function getBundledLauncherCandidatePaths(): string[] {
  return [
    ...(process.resourcesPath ? [join(process.resourcesPath, 'bin', LAUNCHER_FILE_NAME)] : []),
    ...(process.env.ORCA_DEV_REPO_ROOT
      ? [
          join(
            process.env.ORCA_DEV_REPO_ROOT,
            'native',
            'windows-agent-hook-launcher',
            '.build',
            LAUNCHER_FILE_NAME
          )
        ]
      : []),
    join(process.cwd(), 'native', 'windows-agent-hook-launcher', '.build', LAUNCHER_FILE_NAME)
  ]
}

function resolveBundledLauncherPath(): string {
  const candidates = getBundledLauncherCandidatePaths()
  const sourcePath = candidates.find((candidate) => existsSync(candidate))
  if (!sourcePath) {
    throw new Error('Missing bundled Windows agent hook launcher.')
  }
  return sourcePath
}

async function resolveBundledLauncherPathAsync(): Promise<string> {
  const candidates = getBundledLauncherCandidatePaths()
  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // Try the next packaged or development location.
    }
  }
  throw new Error('Missing bundled Windows agent hook launcher.')
}

export function installWindowsAgentHookLauncher(sourcePath = resolveBundledLauncherPath()): string {
  const source = readFileSync(sourcePath)
  const destinationPath = join(
    homedir(),
    '.orca',
    'agent-hooks',
    getVersionedLauncherFileName(source)
  )
  mkdirSync(dirname(destinationPath), { recursive: true })
  if (existsSync(destinationPath) && readFileSync(destinationPath).equals(source)) {
    return destinationPath
  }

  const temporaryPath = join(dirname(destinationPath), `.${LAUNCHER_FILE_NAME}-${randomUUID()}.tmp`)
  try {
    copyFileSync(sourcePath, temporaryPath)
    try {
      renameSync(temporaryPath, destinationPath)
    } catch (error) {
      // Why: concurrent installers can race to publish the same content-addressed launcher.
      if (!existsSync(destinationPath) || !readFileSync(destinationPath).equals(source)) {
        throw error
      }
    }
  } finally {
    if (existsSync(temporaryPath)) {
      unlinkSync(temporaryPath)
    }
  }
  return destinationPath
}

export async function installWindowsAgentHookLauncherAsync(sourcePath?: string): Promise<string> {
  const resolvedSourcePath = sourcePath ?? (await resolveBundledLauncherPathAsync())
  const source = await readFile(resolvedSourcePath)
  const destinationPath = join(
    homedir(),
    '.orca',
    'agent-hooks',
    getVersionedLauncherFileName(source)
  )
  await mkdir(dirname(destinationPath), { recursive: true })
  try {
    if ((await readFile(destinationPath)).equals(source)) {
      return destinationPath
    }
  } catch {
    // Publish the bundled launcher below.
  }

  const temporaryPath = join(dirname(destinationPath), `.${LAUNCHER_FILE_NAME}-${randomUUID()}.tmp`)
  try {
    await copyFile(resolvedSourcePath, temporaryPath)
    try {
      await rename(temporaryPath, destinationPath)
    } catch (error) {
      try {
        if ((await readFile(destinationPath)).equals(source)) {
          return destinationPath
        }
      } catch {
        // Re-throw the publication error below.
      }
      throw error
    }
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
  return destinationPath
}

function quoteWindowsCommandArgument(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`
}

export function getWindowsAgentHookCommand(
  scriptPath: string,
  launcherPath = installWindowsAgentHookLauncher()
): string {
  return `${quoteWindowsCommandArgument(launcherPath)} ${quoteWindowsCommandArgument(scriptPath)}`
}

export function getWindowsAgentHookJsonCommand(
  scriptPath: string,
  launcherPath = installWindowsAgentHookLauncher()
): string {
  return `${quoteWindowsCommandArgument(launcherPath)} --neutral-json ${quoteWindowsCommandArgument(scriptPath)}`
}

export async function getWindowsAgentHookCommandAsync(scriptPath: string): Promise<string> {
  return getWindowsAgentHookCommand(scriptPath, await installWindowsAgentHookLauncherAsync())
}

export async function getWindowsAgentHookJsonCommandAsync(scriptPath: string): Promise<string> {
  return getWindowsAgentHookJsonCommand(scriptPath, await installWindowsAgentHookLauncherAsync())
}
