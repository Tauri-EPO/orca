import type { ProviderRateLimits, RateLimitWindow } from '../../shared/rate-limit-types'

// Why: a saved account's last-known percentages stay true until the window that produced them
// resets; after that the number is a guess and the row should say "unknown" instead (#14833).
function isClaudeUsageWindowLive(
  window: RateLimitWindow | null | undefined,
  updatedAt: number,
  now: number
): window is RateLimitWindow {
  if (!window) {
    return false
  }
  if (typeof window.resetsAt === 'number' && Number.isFinite(window.resetsAt)) {
    return window.resetsAt > now
  }
  // Why: without a reset time the window cannot have outlived its own length.
  return now - updatedAt < window.windowMinutes * 60_000
}

/** Drops every usage window that has already reset since `limits` was recorded. */
export function expireClaudeUsageWindows(
  limits: ProviderRateLimits,
  now: number = Date.now()
): ProviderRateLimits {
  const session = isClaudeUsageWindowLive(limits.session, limits.updatedAt, now)
    ? limits.session
    : null
  const weekly = isClaudeUsageWindowLive(limits.weekly, limits.updatedAt, now)
    ? limits.weekly
    : null
  const fableWeekly = isClaudeUsageWindowLive(limits.fableWeekly, limits.updatedAt, now)
    ? limits.fableWeekly
    : null
  if (
    session === limits.session &&
    weekly === limits.weekly &&
    fableWeekly === (limits.fableWeekly ?? null)
  ) {
    return limits
  }
  return { ...limits, session, weekly, fableWeekly }
}

export function hasClaudeUsageWindows(limits: ProviderRateLimits | null | undefined): boolean {
  return Boolean(limits && (limits.session || limits.weekly || limits.fableWeekly))
}
