import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../../db'

describe('worker-list heartbeat freshness', () => {
  let db: OrchestrationDb | undefined

  beforeEach(() => {
    // Why: only Date is faked. Faking timers wholesale would stall the DB's own async plumbing, and
    // the reference instant these tests pin is taken from Date inside listWorkerTerminalResources.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-22T12:00:00.000Z'))
  })

  afterEach(() => {
    db?.close()
    db = undefined
    vi.useRealTimers()
  })

  function laneWithStoredStamp(stamp: string | null): {
    heartbeatState: string
    heartbeatAgeSeconds: number | null
    lastHeartbeatReceivedAt: string | null
  } {
    const database = new OrchestrationDb(':memory:')
    db = database
    const task = database.createTask({ spec: 'freshness lane' })
    const dispatch = database.createDispatchContext(
      task.id,
      'term_worker',
      'tab_worker:leaf_worker',
      'launch-hash',
      'runtime_test:term_worker:1'
    )
    if (stamp !== null) {
      ;(
        database as unknown as {
          db: { prepare: (sql: string) => { run: (...a: unknown[]) => void } }
        }
      ).db
        .prepare('UPDATE dispatch_contexts SET last_heartbeat_at = ? WHERE id = ?')
        .run(stamp, dispatch.id)
    }
    const lane = database
      .listWorkerTerminalResources()
      .find((row) => row.dispatchId === dispatch.id)
    if (!lane) {
      throw new Error('Dispatch missing from worker listing')
    }
    return lane
  }

  it('reports an ordinary past arrival as a rounded age', () => {
    expect(laneWithStoredStamp('2026-08-22 11:59:18')).toMatchObject({
      heartbeatState: 'recorded',
      heartbeatAgeSeconds: 42,
      lastHeartbeatReceivedAt: '2026-08-22T11:59:18Z'
    })
  })

  it('reports a Dispatch that never heartbeated as never, not as an age', () => {
    expect(laneWithStoredStamp(null)).toMatchObject({
      heartbeatState: 'never',
      heartbeatAgeSeconds: null
    })
  })

  it('reports a stamp it cannot parse as unreadable while still publishing it', () => {
    expect(laneWithStoredStamp('not-a-timestamp')).toMatchObject({
      heartbeatState: 'unreadable',
      heartbeatAgeSeconds: null,
      lastHeartbeatReceivedAt: 'not-a-timestamp'
    })
  })

  // Regression: the age used to be rounded in SQL before its sign was tested, and
  // CAST(ROUND(-0.49) AS INTEGER) is 0. A stamp a fraction of a second into this host's future then
  // published `heartbeat=0s` — "just reported" — for a lane whose clock evidence is broken.
  it.each([
    ['a fraction of a second ahead', '2026-08-22T12:00:00.400Z'],
    ['barely ahead', '2026-08-22T12:00:00.001Z'],
    ['far ahead', '2999-01-01 00:00:00']
  ])('reports a stamp %s of this host as unreadable', (_name, stamp) => {
    expect(laneWithStoredStamp(stamp)).toMatchObject({
      heartbeatState: 'unreadable',
      heartbeatAgeSeconds: null
    })
  })

  it('ages every lane in one listing against the same instant', () => {
    const database = new OrchestrationDb(':memory:')
    db = database
    const stamp = '2026-08-22 11:59:30'
    for (let index = 0; index < 25; index += 1) {
      const task = database.createTask({ spec: `lane ${index}` })
      const dispatch = database.createDispatchContext(
        task.id,
        `term_worker_${index}`,
        `tab_worker_${index}:leaf`,
        'launch-hash',
        `runtime_test:term_worker_${index}:1`
      )
      ;(
        database as unknown as {
          db: { prepare: (sql: string) => { run: (...a: unknown[]) => void } }
        }
      ).db
        .prepare('UPDATE dispatch_contexts SET last_heartbeat_at = ? WHERE id = ?')
        .run(stamp, dispatch.id)
    }

    const ages = new Set(
      database.listWorkerTerminalResources().map((row) => row.heartbeatAgeSeconds)
    )

    expect(ages).toEqual(new Set([30]))
  })
})
