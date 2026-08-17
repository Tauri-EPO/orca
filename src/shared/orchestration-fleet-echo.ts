// Why: rides on every orchestration response, so it stays pure and bounded — no DB or runtime imports, and a hard lane cap.

export type FleetLaneLifecycle = 'pending' | 'dispatched'
export type FleetLaneDelivery = 'accepted' | 'not_accepted' | 'unknown'
/** Which observation the delivery verdict was read from; null when none was available. */
export type FleetLaneDeliveryEvidence = 'worker_stage' | 'terminal_output'
export type FleetLaneProcessState = 'live' | 'dead' | 'unknown'

export type FleetLaneRow = {
  handle: string | null
  taskId: string
  dispatchId: string
  lifecycle: FleetLaneLifecycle
  quietMs: number | null
  delivery: FleetLaneDelivery
  deliveryEvidence: FleetLaneDeliveryEvidence | null
  processState: FleetLaneProcessState
}

export type FleetEcho = {
  runId: string
  lanes: FleetLaneRow[]
  truncated: boolean
}

export type FleetEchoDispatch = {
  dispatchId: string
  taskId: string
  assigneeHandle: string | null
  status: FleetLaneLifecycle
  /** Epoch ms the prompt was handed to the terminal; null when never dispatched. */
  dispatchedAt: number | null
}

export type FleetEchoTerminalSignal = {
  lastOutputAt: number | null
  processState: FleetLaneProcessState
}

export type FleetEchoSources = {
  listActiveDispatches(): FleetEchoDispatch[]
  getWorkerStage(dispatchId: string): string | null
  getTerminalSignal(handle: string): FleetEchoTerminalSignal | null
  now(): number
}

export const FLEET_ECHO_MAX_LANES = 12

// Why: the runtime marks a worker ready only once its prompt actually started a turn.
const DELIVERED_STAGE = 'input_accepted'

// Why: two different observations answer the same question, and they are not equally strong, so the
// verdict travels with the one it was read from rather than flattening both into the same word.
// `worker_stage` exists only for worker-start (markWorkerDispatchReady) and remote attachments; a
// plain `dispatch --inject` has no worker row, so the fallback reads the terminal instead —
// silence since dispatched_at means the turn never began (#14809).
type DeliveryVerdict = {
  delivery: FleetLaneDelivery
  deliveryEvidence: FleetLaneDeliveryEvidence | null
}

function resolveDelivery(
  lifecycle: FleetLaneLifecycle,
  stage: string | null,
  dispatchedAt: number | null,
  lastOutputAt: number | null
): DeliveryVerdict {
  // Why: 'pending' only ever means worker-start in flight (setup, worktree, terminal, agent
  // readiness, authority attach) — none of those steps have written a stage or dispatch time yet,
  // so report unknown rather than the false NOT_ACCEPTED that fires for the whole launch window.
  if (lifecycle === 'pending') {
    return { delivery: 'unknown', deliveryEvidence: null }
  }
  if (stage !== null) {
    return {
      delivery: stage === DELIVERED_STAGE ? 'accepted' : 'not_accepted',
      deliveryEvidence: 'worker_stage'
    }
  }
  if (dispatchedAt === null || lastOutputAt === null) {
    return { delivery: 'unknown', deliveryEvidence: null }
  }
  return {
    delivery: lastOutputAt > dispatchedAt ? 'accepted' : 'not_accepted',
    deliveryEvidence: 'terminal_output'
  }
}

export function buildFleetEcho(
  runId: string,
  sources: FleetEchoSources,
  limit: number = FLEET_ECHO_MAX_LANES
): FleetEcho {
  const dispatches = sources.listActiveDispatches()
  const now = sources.now()
  // Why: the cap is the response contract, not a default — a caller passing a larger limit must
  // not be able to widen a block that rides on every orchestration response.
  const effectiveLimit = Math.max(0, Math.min(limit, FLEET_ECHO_MAX_LANES))
  const lanes = dispatches.slice(0, effectiveLimit).map((entry): FleetLaneRow => {
    const signal = entry.assigneeHandle ? sources.getTerminalSignal(entry.assigneeHandle) : null
    const lastOutputAt = signal?.lastOutputAt ?? null
    return {
      handle: entry.assigneeHandle,
      taskId: entry.taskId,
      dispatchId: entry.dispatchId,
      lifecycle: entry.status,
      // Why: a backwards clock must read as "just spoke", never as a negative age.
      // Null-check rather than truthiness so an epoch-zero timestamp means the same thing here as it does to resolveDelivery below.
      quietMs: lastOutputAt === null ? null : Math.max(0, now - lastOutputAt),
      ...resolveDelivery(
        entry.status,
        sources.getWorkerStage(entry.dispatchId),
        entry.dispatchedAt,
        lastOutputAt
      ),
      processState: signal?.processState ?? 'unknown'
    }
  })
  return { runId, lanes, truncated: dispatches.length > lanes.length }
}
