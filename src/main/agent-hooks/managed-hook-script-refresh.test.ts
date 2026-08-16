// Why (#11549 aftermath): a CLI that falls off PATH keeps its user-wide config invoking
// Orca's script while the presence gate skips install() forever. These tests pin the
// repair — existing scripts come current, missing ones are never created.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type * as osModule from 'node:os'

let isolatedUserDataDir = ''
let previousUserDataPath: string | undefined

beforeEach(() => {
  previousUserDataPath = process.env.ORCA_USER_DATA_PATH
  isolatedUserDataDir = mkdtempSync(join(tmpdir(), 'orca-hook-refresh-user-data-'))
  process.env.ORCA_USER_DATA_PATH = isolatedUserDataDir
})

afterEach(() => {
  if (previousUserDataPath === undefined) {
    delete process.env.ORCA_USER_DATA_PATH
  } else {
    process.env.ORCA_USER_DATA_PATH = previousUserDataPath
  }
  rmSync(isolatedUserDataDir, { recursive: true, force: true })
})

const { homedirMock } = vi.hoisted(() => ({
  homedirMock: vi.fn<() => string>()
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/orca-user-data'
  }
}))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof osModule>()
  return {
    ...actual,
    homedir: homedirMock.mockImplementation(actual.homedir)
  }
})

vi.mock('./windows-agent-hook-launcher', async () => {
  const { join } = await import('node:path')
  const launcherPath = () => join(homedirMock(), '.orca', 'agent-hooks', 'orca-agent-hook.exe')
  return {
    installWindowsAgentHookLauncher: launcherPath,
    installWindowsAgentHookLauncherAsync: async () => launcherPath(),
    getWindowsAgentHookCommand: (scriptPath: string) => `"${launcherPath()}" "${scriptPath}"`,
    getWindowsAgentHookCommandAsync: async (scriptPath: string) =>
      `"${launcherPath()}" "${scriptPath}"`,
    getWindowsAgentHookJsonCommand: (scriptPath: string) =>
      `"${launcherPath()}" --neutral-json "${scriptPath}"`,
    getWindowsAgentHookJsonCommandAsync: async (scriptPath: string) =>
      `"${launcherPath()}" --neutral-json "${scriptPath}"`
  }
})

import { refreshManagedScriptIfPresent } from './managed-hook-script-refresh'
import { refreshManagedHookCommandIfPresent } from './managed-hook-config-refresh'
import {
  MANAGED_AGENT_HOOK_INSTALLERS,
  MANAGED_AGENT_HOOK_SCRIPT_REFRESHERS
} from './managed-agent-hook-registry'
import { ClaudeHookService } from '../claude/hook-service'

async function withPlatform<T>(platform: NodeJS.Platform, run: () => T | Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
  try {
    return await run()
  } finally {
    if (original) {
      Object.defineProperty(process, 'platform', original)
    }
  }
}

const STALE_WINDOWS_HOOK = [
  '@echo off',
  'setlocal',
  'if "%ORCA_AGENT_HOOK_PORT%"=="" goto :orca_agent_hook_drain_stdin',
  ':orca_agent_hook_drain_stdin',
  '"%SystemRoot%\\System32\\more.com" >nul 2>nul',
  'exit /b 0',
  ''
].join('\r\n')

describe('refreshManagedScriptIfPresent', () => {
  it('rewrites an existing script and refuses to create a missing one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-hook-refresh-unit-'))
    try {
      const present = join(dir, 'present.cmd')
      writeFileSync(present, 'stale')
      expect(await refreshManagedScriptIfPresent(present, 'fresh')).toBe(true)
      expect(readFileSync(present, 'utf8')).toBe('fresh')

      if (process.platform !== 'win32') {
        chmodSync(present, 0o600)
      }
      const fixedTime = new Date(1_000)
      utimesSync(present, fixedTime, fixedTime)
      expect(await refreshManagedScriptIfPresent(present, 'fresh')).toBe(true)
      expect(statSync(present).mtimeMs).toBe(fixedTime.getTime())
      if (process.platform !== 'win32') {
        expect(statSync(present).mode & 0o777).toBe(0o755)
      }

      const missing = join(dir, 'missing.cmd')
      expect(await refreshManagedScriptIfPresent(missing, 'fresh')).toBe(false)
      expect(existsSync(missing)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('managed hook script refresh', () => {
  it('brings a stale leaking script current without touching agent config', async () => {
    const home = mkdtempSync(join(tmpdir(), 'orca-hook-refresh-'))
    homedirMock.mockReturnValue(home)
    try {
      // Why: the bug population has a script (from a past install) but no reachable
      // CLI — and possibly no config dir Orca may create. Seed only the script.
      const hooksDir = join(home, '.orca', 'agent-hooks')
      mkdirSync(hooksDir, { recursive: true })
      writeFileSync(join(hooksDir, 'claude-hook.cmd'), STALE_WINDOWS_HOOK)

      await withPlatform('win32', () => new ClaudeHookService().refreshManagedScripts())

      const refreshed = readFileSync(join(hooksDir, 'claude-hook.cmd'), 'utf8')
      expect(refreshed).toContain('if "%ORCA_AGENT_HOOK_PORT%"=="" exit /b 0')
      expect(refreshed).not.toContain('if "%ORCA_AGENT_HOOK_PORT%"=="" goto')
      // Why: refresh must not resurrect config for a CLI the user may have removed.
      expect(existsSync(join(home, '.claude'))).toBe(false)
      // Why: the statusline script was never installed here, so it must not appear.
      expect(existsSync(join(hooksDir, 'claude-statusline.cmd'))).toBe(false)
    } finally {
      homedirMock.mockImplementation(() => process.env.HOME ?? tmpdir())
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('migrates an existing Windows config even when CLI presence is unavailable', async () => {
    const home = mkdtempSync(join(tmpdir(), 'orca-hook-refresh-config-'))
    homedirMock.mockReturnValue(home)
    try {
      const hooksDir = join(home, '.orca', 'agent-hooks')
      const configDir = join(home, '.claude')
      mkdirSync(hooksDir, { recursive: true })
      mkdirSync(configDir, { recursive: true })
      const scriptPath = join(hooksDir, 'claude-hook.cmd')
      writeFileSync(scriptPath, STALE_WINDOWS_HOOK)
      writeFileSync(
        join(configDir, 'settings.json'),
        `${JSON.stringify({
          hooks: {
            UserPromptSubmit: [
              {
                hooks: [
                  {
                    type: 'command',
                    command: 'C:\\Windows\\System32\\conhost.exe',
                    args: ['--headless', 'C:\\Windows\\System32\\cmd.exe', '/d', '/c', scriptPath]
                  }
                ]
              }
            ]
          }
        })}\n`
      )

      await withPlatform('win32', () => new ClaudeHookService().refreshManagedScripts())

      const config = JSON.parse(readFileSync(join(configDir, 'settings.json'), 'utf8'))
      const hook = config.hooks.UserPromptSubmit[0].hooks[0]
      expect(hook.command).toBe(
        `"${join(hooksDir, 'orca-agent-hook.exe')}" --neutral-json "${scriptPath}"`
      )
      expect(hook.args).toBeUndefined()
    } finally {
      homedirMock.mockImplementation(() => process.env.HOME ?? tmpdir())
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('treats a concurrently deleted config as an aborted refresh', async () => {
    const home = mkdtempSync(join(tmpdir(), 'orca-hook-refresh-deleted-config-'))
    const configPath = join(home, 'settings.json')
    const scriptPath = join(home, '.orca', 'agent-hooks', 'claude-hook.cmd')
    writeFileSync(
      configPath,
      `${JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: scriptPath }] }]
        }
      })}\n`
    )
    try {
      await expect(
        refreshManagedHookCommandIfPresent({
          configPath,
          scriptFileName: 'claude-hook.cmd',
          resolveCommand: async () => {
            rmSync(configPath)
            return 'replacement'
          }
        })
      ).resolves.toBe(false)
      expect(existsSync(configPath)).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('covers every shared launcher script with a refresher', async () => {
    const home = mkdtempSync(join(tmpdir(), 'orca-hook-refresh-coverage-'))
    homedirMock.mockReturnValue(home)
    const previousGrokHome = process.env.GROK_HOME
    const previousKimiHome = process.env.KIMI_CODE_HOME
    delete process.env.GROK_HOME
    delete process.env.KIMI_CODE_HOME
    try {
      await withPlatform('win32', () => {
        for (const [, install] of MANAGED_AGENT_HOOK_INSTALLERS) {
          install()
        }
      })
      const hooksDir = join(home, '.orca', 'agent-hooks')
      const files = readdirSync(hooksDir)
      expect(files.length).toBeGreaterThan(0)
      const refresherAgents = MANAGED_AGENT_HOOK_SCRIPT_REFRESHERS.map(([agent]) => agent)
      // Why: an installer that writes a shared launcher but skips the refresher list would
      // recreate the frozen-stale-script class this suite exists to prevent.
      for (const file of files) {
        expect(
          refresherAgents.some((agent) => file.startsWith(`${agent}-`)),
          `${file} is written to ~/.orca/agent-hooks but no refresher owns it`
        ).toBe(true)
      }
      // Why: the reverse direction — a refresher naming an agent that writes nothing is a
      // stale registry entry, likely a renamed script file.
      for (const agent of refresherAgents) {
        expect(
          files.some((file) => file.startsWith(`${agent}-`)),
          `refresher for ${agent} matches no installed script`
        ).toBe(true)
      }
    } finally {
      homedirMock.mockImplementation(() => process.env.HOME ?? tmpdir())
      if (previousGrokHome === undefined) {
        delete process.env.GROK_HOME
      } else {
        process.env.GROK_HOME = previousGrokHome
      }
      if (previousKimiHome === undefined) {
        delete process.env.KIMI_CODE_HOME
      } else {
        process.env.KIMI_CODE_HOME = previousKimiHome
      }
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('creates nothing anywhere when no managed scripts exist', async () => {
    const home = mkdtempSync(join(tmpdir(), 'orca-hook-refresh-empty-'))
    homedirMock.mockReturnValue(home)
    try {
      await withPlatform('win32', async () => {
        for (const [agent, refresh] of MANAGED_AGENT_HOOK_SCRIPT_REFRESHERS) {
          await expect(refresh(), `${agent} refresh on empty home`).resolves.toBeUndefined()
        }
      })
      // Why: a refresh pass on a machine with no prior installs must be a strict no-op.
      expect(readdirSync(home)).toEqual([])
    } finally {
      homedirMock.mockImplementation(() => process.env.HOME ?? tmpdir())
      rmSync(home, { recursive: true, force: true })
    }
  })
})
