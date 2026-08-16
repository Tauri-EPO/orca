export const MAIL_POINTER_USER_INPUT_QUIESCE_MS = 5_000

export function remainingMailPointerTypingQuiesceMs(input: {
  lastUserInputAt: number | undefined
  isOrcaWindowFocused: boolean
  now?: number
}): number | null {
  if (!input.isOrcaWindowFocused || input.lastUserInputAt === undefined) {
    return null
  }
  const elapsed = (input.now ?? performance.now()) - input.lastUserInputAt
  if (elapsed >= MAIL_POINTER_USER_INPUT_QUIESCE_MS) {
    return null
  }
  if (elapsed < 0) {
    return MAIL_POINTER_USER_INPUT_QUIESCE_MS
  }
  return MAIL_POINTER_USER_INPUT_QUIESCE_MS - elapsed
}

export function shouldDeferMailboxPointerEnter(input: {
  lastUserInputAt: number | undefined
  isOrcaWindowFocused: boolean
  now?: number
}): boolean {
  return remainingMailPointerTypingQuiesceMs(input) !== null
}

export function deferMailboxPointerForRecentTyping(args: {
  ptyId: string
  mailboxHandle: string
  lastUserInputAt?: (ptyId: string) => number | undefined
  isOrcaWindowFocused?: () => boolean
  scheduleMailboxRetry?: (mailboxHandle: string, delayMs: number) => void
  now?: number
}): boolean {
  if (!args.scheduleMailboxRetry) {
    return false
  }
  const remaining = remainingMailPointerTypingQuiesceMs({
    lastUserInputAt: args.lastUserInputAt?.(args.ptyId),
    isOrcaWindowFocused: args.isOrcaWindowFocused?.() === true,
    now: args.now
  })
  if (remaining === null) {
    return false
  }
  args.scheduleMailboxRetry(args.mailboxHandle, Math.max(1, Math.ceil(remaining)))
  return true
}
