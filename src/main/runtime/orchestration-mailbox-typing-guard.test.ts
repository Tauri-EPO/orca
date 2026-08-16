import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createBoundRun,
  createDatabase,
  createRuntime,
  driveToLiveIdle,
  insertDirectRunMessage,
  pointerCount,
  PTY_ID,
  temporaryDirectories,
  TERMINAL_HANDLE,
  type MailboxNotificationHarness
} from './orchestration-mailbox-notification-test-harness'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => tmpdir()), isPackaged: false },
  BrowserWindow: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  webContents: { fromId: vi.fn(() => null) }
}))

type TypingGuardState = {
  lastUserInputAt: number | undefined
  focused: boolean
}

function installTypingGuard(harness: MailboxNotificationHarness, state: TypingGuardState): void {
  harness.runtime.setPtyController({
    write: harness.write,
    kill: vi.fn(),
    getForegroundProcess: async () => null,
    lastUserInputAt: (ptyId) => (ptyId === PTY_ID ? state.lastUserInputAt : undefined),
    isOrcaWindowFocused: () => state.focused
  } as never)
}

describe('orchestration mail pointer typing guard', () => {
  afterEach(() => {
    vi.useRealTimers()
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('defers the pointer for 5s of focused PTY typing and retries the run mailbox', async () => {
    vi.useFakeTimers()
    const db = createDatabase('orca-mailbox-typing-guard-')
    const harness = createRuntime(db)
    const state: TypingGuardState = {
      lastUserInputAt: performance.now(),
      focused: true
    }
    installTypingGuard(harness, state)
    const run = createBoundRun(db, 'Typing guard Run')
    insertDirectRunMessage(db, run.id, 'Do not clobber the draft')
    const redrive = vi.spyOn(harness.runtime, 'deliverPendingMessagesForHandle')

    await driveToLiveIdle(harness.runtime)
    expect(pointerCount(harness.write)).toBe(0)

    await vi.advanceTimersByTimeAsync(2_000)
    expect(pointerCount(harness.write)).toBe(0)

    await vi.advanceTimersByTimeAsync(3_000)
    expect(pointerCount(harness.write)).toBe(1)
    expect(redrive).toHaveBeenCalledWith(`run:${run.id}`)
    expect(redrive).not.toHaveBeenCalledWith(TERMINAL_HANDLE)

    await vi.advanceTimersByTimeAsync(500)
    expect(harness.write).toHaveBeenCalledWith(PTY_ID, '\r')
    db.close()
  })

  it('still injects when the user typed recently but Orca is unfocused', async () => {
    vi.useFakeTimers()
    const db = createDatabase('orca-mailbox-typing-unfocused-')
    const harness = createRuntime(db)
    installTypingGuard(harness, {
      lastUserInputAt: performance.now(),
      focused: false
    })
    const run = createBoundRun(db, 'Unfocused typing Run')
    insertDirectRunMessage(db, run.id, 'Deliver while alt-tabbed')

    await driveToLiveIdle(harness.runtime)
    expect(pointerCount(harness.write)).toBe(1)
    db.close()
  })

  it('still defers 200ms after the last key because the gate is 5s not 100ms', async () => {
    vi.useFakeTimers()
    const db = createDatabase('orca-mailbox-typing-200ms-')
    const harness = createRuntime(db)
    installTypingGuard(harness, {
      lastUserInputAt: performance.now() - 200,
      focused: true
    })
    const run = createBoundRun(db, '200ms typing Run')
    insertDirectRunMessage(db, run.id, 'Still typing')

    await driveToLiveIdle(harness.runtime)
    expect(pointerCount(harness.write)).toBe(0)
    db.close()
  })

  it('re-checks typing after a later keystroke during the quiet wait', async () => {
    vi.useFakeTimers()
    const db = createDatabase('orca-mailbox-typing-race-')
    const harness = createRuntime(db)
    const state: TypingGuardState = {
      lastUserInputAt: performance.now(),
      focused: true
    }
    installTypingGuard(harness, state)
    const run = createBoundRun(db, 'Typing race Run')
    insertDirectRunMessage(db, run.id, 'Keep waiting')

    await driveToLiveIdle(harness.runtime)
    await vi.advanceTimersByTimeAsync(2_000)
    state.lastUserInputAt = performance.now()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(pointerCount(harness.write)).toBe(0)

    await vi.advanceTimersByTimeAsync(2_000)
    expect(pointerCount(harness.write)).toBe(1)
    db.close()
  })

  it('skips the delayed Enter when the user starts typing after the pointer write', async () => {
    vi.useFakeTimers()
    const db = createDatabase('orca-mailbox-typing-enter-')
    const harness = createRuntime(db)
    const state: TypingGuardState = {
      lastUserInputAt: performance.now() - 10_000,
      focused: true
    }
    installTypingGuard(harness, state)
    const run = createBoundRun(db, 'Enter typing Run')
    insertDirectRunMessage(db, run.id, 'Pointer already injected')

    await driveToLiveIdle(harness.runtime)
    expect(pointerCount(harness.write)).toBe(1)
    state.lastUserInputAt = performance.now()

    await vi.advanceTimersByTimeAsync(500)
    expect(harness.write.mock.calls.filter(([, payload]) => payload === '\r')).toHaveLength(0)
    db.close()
  })
})
