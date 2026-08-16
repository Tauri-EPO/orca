import type { FleetEcho, FleetLaneRow } from '../../shared/orchestration-fleet-echo'

// Why: a coordinator scans this at a glance; "12s"/"6m41s" reads faster than raw ms.
function formatQuietMs(quietMs: number | null): string {
  if (quietMs === null) {
    return '—'
  }
  const totalSeconds = Math.floor(quietMs / 1000)
  if (totalSeconds < 60) {
    return `${totalSeconds}s`
  }
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m${seconds}s`
}

// Why: NOT_ACCEPTED is the one value a coordinator must not skim past — the whole reason the block exists.
function formatDelivery(delivery: FleetLaneRow['delivery']): string {
  return delivery === 'not_accepted' ? 'NOT_ACCEPTED' : delivery
}

function padColumn(value: string, width: number): string {
  return value.padEnd(width)
}

export function formatFleetEcho(fleet: FleetEcho): string {
  if (fleet.lanes.length === 0) {
    return ''
  }

  const rows = fleet.lanes.map((lane) => ({
    handle: lane.handle ?? '—',
    taskId: lane.taskId,
    dispatchId: lane.dispatchId,
    lifecycle: lane.lifecycle,
    quietMs: formatQuietMs(lane.quietMs),
    delivery: formatDelivery(lane.delivery),
    // Why: a live PTY proves nothing about the agent inside it, so only dead/unknown earn a call-out.
    // 'live' is unreachable on this build (the runtime never emits it, see skill-guides/orchestration.md)
    // but stays handled since it's a valid FleetLaneProcessState member and the renderer must stay total.
    processStateTag: lane.processState === 'live' ? '' : ` (${lane.processState})`
  }))

  const widths = {
    handle: Math.max(...rows.map((row) => row.handle.length)),
    taskId: Math.max(...rows.map((row) => row.taskId.length)),
    dispatchId: Math.max(...rows.map((row) => row.dispatchId.length)),
    lifecycle: Math.max(...rows.map((row) => row.lifecycle.length)),
    quietMs: Math.max(...rows.map((row) => row.quietMs.length))
  }

  const lines = rows.map(
    (row) =>
      `  ${padColumn(row.handle, widths.handle)}  ${padColumn(row.taskId, widths.taskId)}  ` +
      `${padColumn(row.dispatchId, widths.dispatchId)}  ${padColumn(row.lifecycle, widths.lifecycle)}  ` +
      `${padColumn(row.quietMs, widths.quietMs)}  ${row.delivery}${row.processStateTag}`
  )

  const laneWord = fleet.lanes.length === 1 ? 'lane' : 'lanes'
  const header = `fleet ${fleet.runId} (${fleet.lanes.length} ${laneWord}):`
  const footer = fleet.truncated ? ['  … more lanes not shown'] : []

  return [header, ...lines, ...footer].join('\n')
}
