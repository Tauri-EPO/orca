import { mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import type { createReadStream as NodeCreateReadStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TERMINAL_PROMPT_DELIVERY_RUNTIME_CAPABILITY } from '../../shared/protocol-version'
import {
  TERMINAL_INPUT_MAX_BYTES,
  TERMINAL_INPUT_TOO_LARGE_ERROR
} from '../../shared/terminal-input'
import type { RuntimeClient } from '../runtime-client'
import { printHelp } from '../help'
import { COMMAND_SPECS } from '../specs'
import { TERMINAL_HANDLERS } from './terminal'

const { createReadStreamMock } = vi.hoisted(() => ({ createReadStreamMock: vi.fn() }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<
    Record<string, unknown> & { createReadStream: typeof NodeCreateReadStream }
  >()
  createReadStreamMock.mockImplementation(actual.createReadStream)
  return { ...actual, createReadStream: createReadStreamMock }
})

const ORIGINAL_EXIT_CODE = process.exitCode

describe('terminal send --text-file CLI', () => {
  const tempDirectories: string[] = []

  const promptClient = (call: ReturnType<typeof vi.fn>, getCliStatus: ReturnType<typeof vi.fn>) =>
    ({ call, getCliStatus }) as unknown as RuntimeClient

  const supportedCliStatus = () =>
    vi.fn().mockResolvedValue({
      result: {
        runtime: {
          reachable: true,
          runtimeId: 'runtime-current',
          capabilities: [TERMINAL_PROMPT_DELIVERY_RUNTIME_CAPABILITY]
        }
      }
    })

  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = ORIGINAL_EXIT_CODE
    return Promise.all(
      tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
    )
  })

  async function createTempDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'orca-terminal-send-'))
    tempDirectories.push(directory)
    return directory
  }

  it('reads multi-line UTF-8 text from a relative file', async () => {
    const cwd = await createTempDirectory()
    await writeFile(join(cwd, 'prompt.txt'), 'first line\nsegundo café', 'utf8')
    const call = vi.fn().mockResolvedValue({
      result: { send: { handle: 'term-1', accepted: true, bytesWritten: 24 } }
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await TERMINAL_HANDLERS['terminal send']({
      flags: new Map<string, string | true>([
        ['terminal', 'term-1'],
        ['text-file', 'prompt.txt']
      ]),
      client: { call } as unknown as RuntimeClient,
      cwd,
      json: true
    })

    expect(call).toHaveBeenCalledWith('terminal.send', {
      terminal: 'term-1',
      text: 'first line\nsegundo café',
      enter: false,
      interrupt: false,
      client: { id: 'orca-cli', type: 'desktop' }
    })
  })

  it('reads text from stdin when --text-file is -', async () => {
    const stdin = mockStdin(['line one\n', 'line two'])
    const call = vi.fn().mockResolvedValue({
      result: { send: { handle: 'term-1', accepted: true, bytesWritten: 17 } }
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      await TERMINAL_HANDLERS['terminal send']({
        flags: new Map<string, string | true>([
          ['terminal', 'term-1'],
          ['text-file', '-']
        ]),
        client: { call } as unknown as RuntimeClient,
        cwd: '/tmp/worktree',
        json: true
      })
    } finally {
      stdin.restore()
    }

    expect(call).toHaveBeenCalledWith(
      'terminal.send',
      expect.objectContaining({ text: 'line one\nline two' })
    )
  })

  it('rejects --text and --text-file together', async () => {
    const call = vi.fn()

    await expect(
      TERMINAL_HANDLERS['terminal send']({
        flags: new Map<string, string | true>([
          ['terminal', 'term-1'],
          ['text', 'inline'],
          ['text-file', 'prompt.txt']
        ]),
        client: { call } as unknown as RuntimeClient,
        cwd: '/tmp/worktree',
        json: true
      })
    ).rejects.toThrow('--text and --text-file cannot be used together')
    expect(call).not.toHaveBeenCalled()
  })

  it('names a missing text file in the error', async () => {
    const cwd = await createTempDirectory()
    const call = vi.fn()

    await expect(
      TERMINAL_HANDLERS['terminal send']({
        flags: new Map<string, string | true>([
          ['terminal', 'term-1'],
          ['text-file', 'missing-prompt.txt']
        ]),
        client: { call } as unknown as RuntimeClient,
        cwd,
        json: true
      })
    ).rejects.toThrow('missing-prompt.txt')
    expect(call).not.toHaveBeenCalled()
  })

  it('rejects an empty text file with an error naming the path', async () => {
    const cwd = await createTempDirectory()
    await writeFile(join(cwd, 'empty-prompt.txt'), '', 'utf8')
    const call = vi.fn()

    await expect(
      TERMINAL_HANDLERS['terminal send']({
        flags: new Map<string, string | true>([
          ['terminal', 'term-1'],
          ['text-file', 'empty-prompt.txt']
        ]),
        client: { call } as unknown as RuntimeClient,
        cwd,
        json: true
      })
    ).rejects.toMatchObject({
      code: 'invalid_argument',
      message: 'Text file "empty-prompt.txt" is empty.'
    })
    expect(call).not.toHaveBeenCalled()
  })

  it('rejects empty stdin as an empty text file', async () => {
    const stdin = mockStdin([])
    const call = vi.fn()

    try {
      await expect(
        TERMINAL_HANDLERS['terminal send']({
          flags: new Map<string, string | true>([
            ['terminal', 'term-1'],
            ['text-file', '-']
          ]),
          client: { call } as unknown as RuntimeClient,
          cwd: '/tmp/worktree',
          json: true
        })
      ).rejects.toMatchObject({
        code: 'invalid_argument',
        message: 'Text file "-" is empty.'
      })
    } finally {
      stdin.restore()
    }
    expect(call).not.toHaveBeenCalled()
  })

  it('rejects oversized text files before opening a read stream', async () => {
    const cwd = await createTempDirectory()
    const path = join(cwd, 'oversized.txt')
    const handle = await open(path, 'w')
    await handle.truncate(TERMINAL_INPUT_MAX_BYTES + 1)
    await handle.close()
    createReadStreamMock.mockClear()
    const call = vi.fn()

    await expect(
      TERMINAL_HANDLERS['terminal send']({
        flags: new Map<string, string | true>([
          ['terminal', 'term-1'],
          ['text-file', path]
        ]),
        client: { call } as unknown as RuntimeClient,
        cwd,
        json: true
      })
    ).rejects.toMatchObject({
      code: 'invalid_argument',
      message: TERMINAL_INPUT_TOO_LARGE_ERROR
    })
    expect(createReadStreamMock).not.toHaveBeenCalled()
    expect(call).not.toHaveBeenCalled()
  })

  it('reports oversized stdin with the same JSON error code', async () => {
    const stdin = mockStdin(['x'.repeat(TERMINAL_INPUT_MAX_BYTES), 'x'])
    const call = vi.fn()

    try {
      await expect(
        TERMINAL_HANDLERS['terminal send']({
          flags: new Map<string, string | true>([
            ['terminal', 'term-1'],
            ['text-file', '-']
          ]),
          client: { call } as unknown as RuntimeClient,
          cwd: '/tmp/worktree',
          json: true
        })
      ).rejects.toMatchObject({
        code: 'invalid_argument',
        message: TERMINAL_INPUT_TOO_LARGE_ERROR
      })
    } finally {
      stdin.restore()
    }
    expect(call).not.toHaveBeenCalled()
  })

  it('preserves agent prompt semantics for text-file sends', async () => {
    const cwd = await createTempDirectory()
    await writeFile(join(cwd, 'prompt.txt'), 'review', 'utf8')
    const call = vi.fn().mockResolvedValue({
      result: {
        send: {
          handle: 'term-1',
          accepted: true,
          bytesWritten: 7,
          prompt: {
            requestId: '11111111-1111-4111-8111-111111111111',
            stages: ['input_accepted'],
            provider: 'codex',
            observation: 'supported',
            processIncarnation: 'inc-1',
            generation: 1,
            baselineWorkingSequence: 0
          }
        }
      }
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await TERMINAL_HANDLERS['terminal send']({
      flags: new Map<string, string | true>([
        ['terminal', 'term-1'],
        ['text-file', 'prompt.txt'],
        ['enter', true]
      ]),
      client: promptClient(call, supportedCliStatus()),
      cwd,
      json: true
    })

    expect(call).toHaveBeenCalledWith(
      'terminal.send',
      expect.objectContaining({ text: 'review', enter: true, interrupt: false, agentPrompt: true }),
      { terminalPromptPreflight: { runtimeId: 'runtime-current' } }
    )
  })

  it('binds a retry request to the payload resolved from the file', async () => {
    const cwd = await createTempDirectory()
    await writeFile(join(cwd, 'prompt.txt'), 'retry me', 'utf8')
    const call = vi.fn().mockResolvedValue({
      result: {
        send: {
          handle: 'term-1',
          accepted: true,
          bytesWritten: 9,
          prompt: {
            requestId: '22222222-2222-4222-8222-222222222222',
            stages: ['input_accepted'],
            provider: 'codex',
            observation: 'supported',
            processIncarnation: 'inc-1',
            generation: 1,
            baselineWorkingSequence: 0
          }
        }
      }
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await TERMINAL_HANDLERS['terminal send']({
      flags: new Map<string, string | true>([
        ['terminal', 'term-1'],
        ['text-file', 'prompt.txt'],
        ['enter', true],
        ['retry-request', '22222222-2222-4222-8222-222222222222']
      ]),
      client: promptClient(call, supportedCliStatus()),
      cwd,
      json: true
    })

    expect(call).toHaveBeenCalledWith(
      'terminal.send',
      expect.objectContaining({ text: 'retry me', agentPrompt: true }),
      expect.objectContaining({
        orchestrationRequestId: '22222222-2222-4222-8222-222222222222'
      })
    )
  })

  it('fails an unreadable text file before contacting the host', async () => {
    const cwd = await createTempDirectory()
    const call = vi.fn()
    const getCliStatus = supportedCliStatus()

    await expect(
      TERMINAL_HANDLERS['terminal send']({
        flags: new Map<string, string | true>([
          ['terminal', 'term-1'],
          ['text-file', 'missing-prompt.txt'],
          ['enter', true],
          ['retry-request', '33333333-3333-4333-8333-333333333333']
        ]),
        client: promptClient(call, getCliStatus),
        cwd,
        json: true
      })
    ).rejects.toThrow('missing-prompt.txt')
    expect(getCliStatus).not.toHaveBeenCalled()
    expect(call).not.toHaveBeenCalled()
  })

  it('refuses a text file that is not valid UTF-8 instead of sending replacement characters', async () => {
    const cwd = await createTempDirectory()
    await writeFile(join(cwd, 'latin1-prompt.txt'), Buffer.from([0x68, 0x69, 0xff, 0x21]))
    const call = vi.fn()

    await expect(
      TERMINAL_HANDLERS['terminal send']({
        flags: new Map<string, string | true>([
          ['terminal', 'term-1'],
          ['text-file', 'latin1-prompt.txt']
        ]),
        client: { call } as unknown as RuntimeClient,
        cwd,
        json: true
      })
    ).rejects.toMatchObject({
      code: 'invalid_argument',
      message: expect.stringContaining('"latin1-prompt.txt" is not valid UTF-8')
    })
    expect(call).not.toHaveBeenCalled()
  })

  it('refuses stdin that is not valid UTF-8, including a split multi-byte character', async () => {
    const cafe = Buffer.from('café', 'utf8')
    const stdin = mockStdin([cafe.subarray(0, -1)])
    const call = vi.fn()

    try {
      await expect(
        TERMINAL_HANDLERS['terminal send']({
          flags: new Map<string, string | true>([
            ['terminal', 'term-1'],
            ['text-file', '-']
          ]),
          client: { call } as unknown as RuntimeClient,
          cwd: '/tmp/worktree',
          json: true
        })
      ).rejects.toMatchObject({
        code: 'invalid_argument',
        message: expect.stringContaining('"-" is not valid UTF-8')
      })
    } finally {
      stdin.restore()
    }
    expect(call).not.toHaveBeenCalled()
  })

  it('joins a multi-byte character split across stdin chunks', async () => {
    const cafe = Buffer.from('café', 'utf8')
    const stdin = mockStdin([cafe.subarray(0, -1), cafe.subarray(-1)])
    const call = vi.fn().mockResolvedValue({
      result: { send: { handle: 'term-1', accepted: true, bytesWritten: 5 } }
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      await TERMINAL_HANDLERS['terminal send']({
        flags: new Map<string, string | true>([
          ['terminal', 'term-1'],
          ['text-file', '-']
        ]),
        client: { call } as unknown as RuntimeClient,
        cwd: '/tmp/worktree',
        json: true
      })
    } finally {
      stdin.restore()
    }

    expect(call).toHaveBeenCalledWith('terminal.send', expect.objectContaining({ text: 'café' }))
  })

  it('names --text-file in the prompt-only flag requirement', async () => {
    const call = vi.fn()

    await expect(
      TERMINAL_HANDLERS['terminal send']({
        flags: new Map<string, string | true>([
          ['terminal', 'term-1'],
          ['wait-submit', '5']
        ]),
        client: { call } as unknown as RuntimeClient,
        cwd: '/tmp/worktree',
        json: true
      })
    ).rejects.toThrow('--text or --text-file')
    expect(call).not.toHaveBeenCalled()
  })

  it('documents file and stdin terminal input', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    printHelp(COMMAND_SPECS, ['terminal', 'send'])

    const help = String(log.mock.calls[0]?.[0])
    expect(help).toContain('--text-file <path|->')
  })
})

function mockStdin(chunks: (string | Uint8Array)[]): { restore: () => void } {
  const stdin = process.stdin
  const previousAsyncIterator = stdin[Symbol.asyncIterator]
  ;(stdin as unknown as Record<symbol, unknown>)[Symbol.asyncIterator] = async function* () {
    for (const chunk of chunks) {
      yield typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    }
  }
  return {
    restore: () => {
      if (previousAsyncIterator) {
        ;(stdin as unknown as Record<symbol, unknown>)[Symbol.asyncIterator] = previousAsyncIterator
      } else {
        Reflect.deleteProperty(stdin, Symbol.asyncIterator)
      }
    }
  }
}
