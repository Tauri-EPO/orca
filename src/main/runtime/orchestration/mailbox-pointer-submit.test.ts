import { describe, expect, it, vi } from 'vitest'
import type { OrchestrationMailboxLeaf } from './mailbox-owner'
import { OrchestrationMailboxPointerState } from './mailbox-pointer-state'
import { submitOrchestrationMailboxPointer } from './mailbox-pointer-submit'
import { MAIL_POINTER_USER_INPUT_QUIESCE_MS } from './mailbox-pointer-typing-guard'

const PTY_ID = 'pty-enter-guard'
const MAILBOX = 'run:run_enter_guard'
const LEAF_KEY = 'tab-enter:leaf-enter'
const LEAF: OrchestrationMailboxLeaf = {
  tabId: 'tab-enter',
  leafId: 'leaf-enter',
  ptyId: PTY_ID,
  writable: true,
  lastAgentStatus: 'idle',
  lastAgentStatusObservedLive: true,
  lastOscTitle: 'Codex done'
}

function submitWithTypingGuard(options?: {
  lastUserInputAt?: number
  focused?: boolean
  scheduleMailboxRetry?: (mailboxHandle: string, delayMs: number) => void
}) {
  const state = new OrchestrationMailboxPointerState()
  const flight = state.beginFlight(PTY_ID)
  state.setWatermark(MAILBOX, 1, PTY_ID, LEAF_KEY)
  const markAsUndelivered = vi.fn()
  const writePty = vi.fn(async () => true)
  const settle = vi.fn()
  const redrive = vi.fn()
  const scheduleMailboxRetry = options?.scheduleMailboxRetry ?? vi.fn()
  submitOrchestrationMailboxPointer(
    {
      mailboxOwner: { resolve: () => MAILBOX } as never,
      state,
      getDb: () =>
        ({
          hasOutstandingRunDelivery: () => false,
          areUnreadMessages: () => true,
          markAsUndelivered
        }) as never,
      getLeaf: () => LEAF,
      getLeafKey: () => LEAF_KEY,
      getMessageWaiters: () => undefined,
      isLeafPtyProvenAbsent: async () => false,
      lastUserInputAt: () => options?.lastUserInputAt,
      isOrcaWindowFocused: () => options?.focused === true,
      writePty,
      settle,
      redrive,
      scheduleMailboxRetry
    },
    {
      leaf: LEAF,
      mailboxHandle: MAILBOX,
      messages: [{ id: 'msg_1', type: 'status' }],
      newestSequence: 1,
      ptyId: PTY_ID,
      flight
    }
  )
  return { state, flight, markAsUndelivered, writePty, settle, redrive, scheduleMailboxRetry }
}

describe('submitOrchestrationMailboxPointer typing guard', () => {
  it('deactivates the watermark without undelivering, submitting, or clearing when Enter is deferred', async () => {
    const scheduled: [string, number][] = []
    const harness = submitWithTypingGuard({
      lastUserInputAt: performance.now(),
      focused: true,
      scheduleMailboxRetry: (mailboxHandle, delayMs) => scheduled.push([mailboxHandle, delayMs])
    })

    await vi.waitFor(() => {
      expect(harness.settle).toHaveBeenCalled()
    })

    expect(harness.writePty).not.toHaveBeenCalled()
    expect(harness.markAsUndelivered).not.toHaveBeenCalled()
    expect(harness.state.hasActiveWatermark(MAILBOX)).toBe(false)
    expect(harness.state.releaseSupersededWatermark(MAILBOX, 1, PTY_ID, LEAF_KEY)).toBe(false)
    expect(harness.state.releaseSupersededWatermark(MAILBOX, 2, PTY_ID, LEAF_KEY)).toBe(true)
    expect(harness.redrive).toHaveBeenCalledWith(MAILBOX, false)
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0][0]).toBe(MAILBOX)
    expect(scheduled[0][1]).toBeGreaterThan(MAIL_POINTER_USER_INPUT_QUIESCE_MS - 250)
    expect(scheduled[0][1]).toBeLessThanOrEqual(MAIL_POINTER_USER_INPUT_QUIESCE_MS)
    expect(harness.settle).toHaveBeenCalledWith(PTY_ID, harness.flight)
  })
})
