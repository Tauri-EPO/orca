import { describe, expect, it } from 'vitest'
import {
  DISPATCH_HEARTBEAT_STALE_AFTER_MS,
  projectDispatchHeartbeat
} from './orchestration-heartbeat-freshness'
import type { FleetDurableWorker } from './orchestration-fleet-projection'
import { projectOrchestrationFleetWorker } from './orchestration-fleet-worker-projection'

const NOW = Date.parse('2026-09-07T12:00:00.000Z')

function durableWorker(overrides: Partial<FleetDurableWorker> = {}): FleetDurableWorker {
  return {
    dispatchId: 'ctx_1',
    taskId: 'task_1',
    runId: 'run_1',
    parentTaskId: 'task_root',
    workerState: 'ready',
    dispatchStatus: 'dispatched',
    workerStage: 'running',
    agentTerminalHandle: 'term_1',
    paneKey: 'tab-1:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    worktreeId: 'ws_1',
    terminalState: 'active',
    resource: null,
    ...overrides
  }
}

describe('dispatch heartbeat freshness', () => {
  it('separates never-reported from reported', () => {
    expect(projectDispatchHeartbeat(null, NOW)).toEqual({
      state: 'none',
      lastReceivedAt: null,
      ageSeconds: null
    })
    expect(projectDispatchHeartbeat(NOW - 30_000, NOW)).toEqual({
      state: 'fresh',
      lastReceivedAt: NOW - 30_000,
      ageSeconds: 30
    })
  })

  it('turns stale only past the cadence the stale-dispatch warning already uses', () => {
    expect(projectDispatchHeartbeat(NOW - DISPATCH_HEARTBEAT_STALE_AFTER_MS, NOW).state).toBe(
      'fresh'
    )
    expect(projectDispatchHeartbeat(NOW - DISPATCH_HEARTBEAT_STALE_AFTER_MS - 1_000, NOW)).toEqual({
      state: 'stale',
      lastReceivedAt: NOW - DISPATCH_HEARTBEAT_STALE_AFTER_MS - 1_000,
      ageSeconds: 601
    })
  })

  // Why: rounding before the subtraction would publish "just reported" for a stamp this host
  // cannot explain. The sign has to survive into the receipt.
  it('keeps a stamp ahead of this host visible as a negative age', () => {
    expect(projectDispatchHeartbeat(NOW + 4_000, NOW).ageSeconds).toBe(-4)
  })

  it('omits the field entirely when the caller carries no arrival stamp', () => {
    expect(projectOrchestrationFleetWorker(durableWorker(), undefined, NOW)).not.toHaveProperty(
      'heartbeat'
    )
  })

  // Why: heartbeat proves the agent still reports; liveness proves the process. A lane whose
  // process is unverifiable can still be reporting, and the receipt must be able to say both.
  it('reports freshness beside an independent liveness verdict', () => {
    const projected = projectOrchestrationFleetWorker(
      durableWorker({ lastHeartbeatAt: NOW - 5_000 }),
      undefined,
      NOW
    )
    expect(projected.liveness).toEqual({ verdict: 'unverifiable', reason: 'missing_status' })
    expect(projected.heartbeat).toEqual({
      state: 'fresh',
      lastReceivedAt: NOW - 5_000,
      ageSeconds: 5
    })
  })

  it('reports none for a supplied-but-empty stamp instead of dropping the field', () => {
    expect(
      projectOrchestrationFleetWorker(durableWorker({ lastHeartbeatAt: null }), undefined, NOW)
        .heartbeat
    ).toEqual({ state: 'none', lastReceivedAt: null, ageSeconds: null })
  })
})
