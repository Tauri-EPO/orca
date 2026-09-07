/** Dispatch heartbeat freshness: the agent still reporting on the orchestration protocol.
 *  Complementary to `FleetLiveness`, which reads `agent_status`/the execution host to decide
 *  whether the *process* is alive. A live process whose agent stopped reporting is exactly the
 *  lane a coordinator loses, and neither signal can be derived from the other. */

// Why: 10 min = documented heartbeat cadence (5 min) x 2, so one missed heartbeat is the earliest
// a Dispatch can look stale. Shared with warnStaleDispatches so both surfaces agree on the word.
export const DISPATCH_HEARTBEAT_STALE_AFTER_MS = 10 * 60 * 1000

export type FleetHeartbeat = {
  /** `none` = this Dispatch has never reported; it is not a claim about the process. */
  state: 'none' | 'fresh' | 'stale'
  /** Epoch ms at which this host recorded the heartbeat, never a stamp the worker chose. */
  lastReceivedAt: number | null
  ageSeconds: number | null
}

/** `lastReceivedAt` is arrival time on the Run home, so the age is a single-clock subtraction. */
export function projectDispatchHeartbeat(
  lastReceivedAt: number | null,
  now: number
): FleetHeartbeat {
  if (lastReceivedAt === null) {
    return { state: 'none', lastReceivedAt: null, ageSeconds: null }
  }
  const ageMs = now - lastReceivedAt
  // Round the subtraction, never the operands: a stamp ahead of this host's clock stays visible
  // as a negative age instead of collapsing into a reassuring "just reported" zero.
  return {
    state: ageMs > DISPATCH_HEARTBEAT_STALE_AFTER_MS ? 'stale' : 'fresh',
    lastReceivedAt,
    ageSeconds: Math.round(ageMs / 1000)
  }
}
