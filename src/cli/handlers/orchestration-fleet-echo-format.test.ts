import { describe, it, expect } from 'vitest'
import { formatFleetEcho } from './orchestration-fleet-echo-format'

describe('formatFleetEcho', () => {
  it('renders one line per lane with a header', () => {
    const text = formatFleetEcho({
      runId: 'run_1',
      truncated: false,
      lanes: [
        {
          handle: 'term_a',
          taskId: 'task_1',
          dispatchId: 'ctx_1',
          lifecycle: 'dispatched',
          quietMs: 5_000,
          delivery: 'accepted',
          processState: 'live'
        }
      ]
    })

    expect(text).toContain('fleet')
    expect(text).toContain('term_a')
    expect(text).toContain('5s')
    expect(text).toContain('accepted')
  })

  it('shouts about a lane whose prompt was never accepted', () => {
    const text = formatFleetEcho({
      runId: 'run_1',
      truncated: false,
      lanes: [
        {
          handle: 'term_c',
          taskId: 'task_3',
          dispatchId: 'ctx_3',
          lifecycle: 'dispatched',
          quietMs: 182_000,
          delivery: 'not_accepted',
          processState: 'live'
        }
      ]
    })

    expect(text).toContain('NOT_ACCEPTED')
    // Why: pins the >=60s formatQuietMs branch (182_000ms = 3m2s) so its arithmetic can't silently reformat.
    expect(text).toContain('3m2s')
  })

  it('notes truncation', () => {
    const text = formatFleetEcho({
      runId: 'run_1',
      truncated: true,
      lanes: [
        {
          handle: 'term_a',
          taskId: 'task_1',
          dispatchId: 'ctx_1',
          lifecycle: 'dispatched',
          quietMs: null,
          delivery: 'unknown',
          processState: 'unknown'
        }
      ]
    })

    expect(text).toContain('more')
  })

  it('renders nothing when there are no lanes', () => {
    expect(formatFleetEcho({ runId: 'run_1', truncated: false, lanes: [] })).toBe('')
  })
})
