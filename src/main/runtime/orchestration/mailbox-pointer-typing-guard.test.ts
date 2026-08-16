import { describe, expect, it } from 'vitest'
import {
  MAIL_POINTER_USER_INPUT_QUIESCE_MS,
  deferMailboxPointerForRecentTyping,
  remainingMailPointerTypingQuiesceMs,
  shouldDeferMailboxPointerEnter
} from './mailbox-pointer-typing-guard'

describe('mailbox pointer typing guard', () => {
  it('defers only when this PTY was typed recently and an Orca window is focused', () => {
    expect(
      remainingMailPointerTypingQuiesceMs({
        lastUserInputAt: 1_000,
        isOrcaWindowFocused: true,
        now: 1_200
      })
    ).toBe(MAIL_POINTER_USER_INPUT_QUIESCE_MS - 200)
    expect(
      remainingMailPointerTypingQuiesceMs({
        lastUserInputAt: 1_000,
        isOrcaWindowFocused: false,
        now: 1_200
      })
    ).toBeNull()
    expect(
      remainingMailPointerTypingQuiesceMs({
        lastUserInputAt: 1_000,
        isOrcaWindowFocused: true,
        now: 1_000 + MAIL_POINTER_USER_INPUT_QUIESCE_MS
      })
    ).toBeNull()
    expect(
      remainingMailPointerTypingQuiesceMs({
        lastUserInputAt: undefined,
        isOrcaWindowFocused: true,
        now: 1_000
      })
    ).toBeNull()
  })

  it('does not treat the 100ms interactive-output window as quiescence', () => {
    expect(
      remainingMailPointerTypingQuiesceMs({
        lastUserInputAt: 1_000,
        isOrcaWindowFocused: true,
        now: 1_200
      })
    ).toBeGreaterThan(100)
  })

  it('skips Enter under the same predicate used before the pointer write', () => {
    expect(
      shouldDeferMailboxPointerEnter({
        lastUserInputAt: 1_000,
        isOrcaWindowFocused: true,
        now: 1_400
      })
    ).toBe(true)
    expect(
      shouldDeferMailboxPointerEnter({
        lastUserInputAt: 1_000,
        isOrcaWindowFocused: false,
        now: 1_400
      })
    ).toBe(false)
  })

  it('retries with the mailbox identity and remaining quiet time', () => {
    const scheduled: [string, number][] = []
    const deferred = deferMailboxPointerForRecentTyping({
      ptyId: 'pty-1',
      mailboxHandle: 'run:run_typing',
      lastUserInputAt: (ptyId) => (ptyId === 'pty-1' ? 1_000 : undefined),
      isOrcaWindowFocused: () => true,
      scheduleMailboxRetry: (mailboxHandle, delayMs) => scheduled.push([mailboxHandle, delayMs]),
      now: 1_250
    })
    expect(deferred).toBe(true)
    expect(scheduled).toEqual([['run:run_typing', MAIL_POINTER_USER_INPUT_QUIESCE_MS - 250]])
  })
})
