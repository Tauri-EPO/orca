import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type * as osModule from 'node:os'

const { homedirMock } = vi.hoisted(() => ({
  homedirMock: vi.fn<() => string>()
}))

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof osModule>('node:os')
  return { ...actual, homedir: homedirMock }
})

import {
  getWindowsAgentHookCommand,
  getWindowsAgentHookJsonCommand,
  installWindowsAgentHookLauncher,
  installWindowsAgentHookLauncherAsync
} from './windows-agent-hook-launcher'

describe('Windows agent hook launcher', () => {
  let homeDir: string

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'orca-hook-launcher-home-'))
    homedirMock.mockReturnValue(homeDir)
  })

  afterEach(() => {
    vi.clearAllMocks()
    rmSync(homeDir, { recursive: true, force: true })
  })

  it('installs the bundled launcher under the shared hook directory', () => {
    const sourcePath = join(homeDir, 'source.exe')
    writeFileSync(sourcePath, Buffer.from([0x4d, 0x5a, 0x01, 0x02]))

    const installedPath = installWindowsAgentHookLauncher(sourcePath)

    expect(dirname(installedPath)).toBe(join(homeDir, '.orca', 'agent-hooks'))
    expect(basename(installedPath)).toMatch(/^orca-agent-hook-[a-f0-9]{16}\.exe$/)
    expect(readFileSync(installedPath)).toEqual(readFileSync(sourcePath))
  })

  it('reuses the content-addressed launcher across repeated installs', async () => {
    const sourcePath = join(homeDir, 'source.exe')
    writeFileSync(sourcePath, Buffer.from([0x4d, 0x5a, 0x03, 0x04]))

    const firstPath = installWindowsAgentHookLauncher(sourcePath)
    const secondPath = installWindowsAgentHookLauncher(sourcePath)
    const asyncPath = await installWindowsAgentHookLauncherAsync(sourcePath)

    expect(secondPath).toBe(firstPath)
    expect(asyncPath).toBe(firstPath)
    expect(readdirSync(dirname(firstPath))).toEqual([basename(firstPath)])
  })

  it('quotes launcher and script paths without adding a shell layer', () => {
    const command = getWindowsAgentHookCommand(
      'C:\\Users\\Jorge Silva\\.orca\\agent-hooks\\cursor-hook.cmd',
      'C:\\Users\\Jorge Silva\\.orca\\agent-hooks\\orca-agent-hook.exe'
    )

    expect(command).toBe(
      '"C:\\Users\\Jorge Silva\\.orca\\agent-hooks\\orca-agent-hook.exe" ' +
        '"C:\\Users\\Jorge Silva\\.orca\\agent-hooks\\cursor-hook.cmd"'
    )
    expect(command).not.toContain('powershell')
    expect(command).not.toContain('conhost')
  })

  it('requests neutral JSON for Claude-compatible lifecycle hooks', () => {
    const command = getWindowsAgentHookJsonCommand(
      'C:\\Users\\Jorge Silva\\.orca\\agent-hooks\\claude-hook.cmd',
      'C:\\Users\\Jorge Silva\\.orca\\agent-hooks\\orca-agent-hook.exe'
    )

    expect(command).toBe(
      '"C:\\Users\\Jorge Silva\\.orca\\agent-hooks\\orca-agent-hook.exe" --neutral-json ' +
        '"C:\\Users\\Jorge Silva\\.orca\\agent-hooks\\claude-hook.cmd"'
    )
  })
})
