import { describe, it, expect } from 'vitest'
import {
  buildFleetEcho,
  FLEET_ECHO_MAX_LANES,
  type FleetEchoDispatch,
  type FleetEchoSources
} from './orchestration-fleet-echo'

const NOW = 1_000_000

function makeSources(overrides: Partial<FleetEchoSources> = {}): FleetEchoSources {
  return {
    listActiveDispatches: () => [],
    getWorkerStage: () => null,
    getTerminalSignal: () => null,
    now: () => NOW,
    ...overrides
  }
}

function dispatch(overrides: Partial<FleetEchoDispatch> = {}): FleetEchoDispatch {
  return {
    dispatchId: 'ctx_1',
    taskId: 'task_1',
    assigneeHandle: 'term_a',
    status: 'dispatched',
    dispatchedAt: NOW - 60_000,
    ...overrides
  }
}

describe('buildFleetEcho', () => {
  it('derives quiet time from the terminal last-output timestamp', () => {
    const echo = buildFleetEcho(
      'run_1',
      makeSources({
        listActiveDispatches: () => [dispatch()],
        getTerminalSignal: () => ({ lastOutputAt: NOW - 5_000, processState: 'live' })
      })
    )

    expect(echo.lanes[0].quietMs).toBe(5_000)
    expect(echo.lanes[0].processState).toBe('live')
  })

  it('reports not_accepted when the worker never reached input_accepted', () => {
    const echo = buildFleetEcho(
      'run_1',
      makeSources({
        listActiveDispatches: () => [dispatch()],
        getWorkerStage: () => 'starting'
      })
    )

    expect(echo.lanes[0].delivery).toBe('not_accepted')
  })

  it('reports accepted once the worker stage records input_accepted', () => {
    const echo = buildFleetEcho(
      'run_1',
      makeSources({
        listActiveDispatches: () => [dispatch()],
        getWorkerStage: () => 'input_accepted'
      })
    )

    expect(echo.lanes[0].delivery).toBe('accepted')
  })

  it('falls back to output-since-dispatch when there is no worker dispatch row', () => {
    const echo = buildFleetEcho(
      'run_1',
      makeSources({
        listActiveDispatches: () => [dispatch({ dispatchedAt: NOW - 60_000 })],
        // Why: the terminal spoke after the prompt landed, so a turn started.
        getTerminalSignal: () => ({ lastOutputAt: NOW - 30_000, processState: 'live' })
      })
    )

    expect(echo.lanes[0].delivery).toBe('accepted')
  })

  it('reports not_accepted when nothing was emitted after the dispatch landed', () => {
    const echo = buildFleetEcho(
      'run_1',
      makeSources({
        listActiveDispatches: () => [dispatch({ dispatchedAt: NOW - 60_000 })],
        getTerminalSignal: () => ({ lastOutputAt: NOW - 90_000, processState: 'live' })
      })
    )

    expect(echo.lanes[0].delivery).toBe('not_accepted')
  })

  it('reports unknown for a pending lane even when it looks not_accepted, without any time threshold', () => {
    // Why: 'pending' only means worker-start is in flight (setup -> worktree -> terminal ->
    // agent readiness -> authority attach); reporting anything but unknown here would tell the
    // coordinator to re-dispatch a lane that just hasn't finished starting yet.
    const echo = buildFleetEcho(
      'run_1',
      makeSources({
        listActiveDispatches: () => [
          dispatch({ status: 'pending', dispatchedAt: NOW - 10 * 60_000 })
        ],
        getWorkerStage: () => 'started',
        getTerminalSignal: () => ({ lastOutputAt: NOW - 9 * 60_000, processState: 'live' })
      })
    )

    expect(echo.lanes[0].delivery).toBe('unknown')
  })

  it('reports unknown when neither a worker stage nor a dispatch time is known', () => {
    const echo = buildFleetEcho(
      'run_1',
      makeSources({ listActiveDispatches: () => [dispatch({ dispatchedAt: null })] })
    )

    expect(echo.lanes[0].delivery).toBe('unknown')
  })

  it('prefers the worker stage over the output heuristic', () => {
    const echo = buildFleetEcho(
      'run_1',
      makeSources({
        listActiveDispatches: () => [dispatch({ dispatchedAt: NOW - 60_000 })],
        getWorkerStage: () => 'input_accepted',
        getTerminalSignal: () => ({ lastOutputAt: NOW - 90_000, processState: 'live' })
      })
    )

    expect(echo.lanes[0].delivery).toBe('accepted')
  })

  it('reports unknown signals for a lane with no resolvable terminal', () => {
    const echo = buildFleetEcho(
      'run_1',
      makeSources({
        listActiveDispatches: () => [dispatch({ assigneeHandle: null })]
      })
    )

    expect(echo.lanes[0].quietMs).toBeNull()
    expect(echo.lanes[0].processState).toBe('unknown')
  })

  it('never reports negative quiet time when a clock skews backwards', () => {
    const echo = buildFleetEcho(
      'run_1',
      makeSources({
        listActiveDispatches: () => [dispatch()],
        getTerminalSignal: () => ({ lastOutputAt: NOW + 5_000, processState: 'live' })
      })
    )

    expect(echo.lanes[0].quietMs).toBe(0)
  })

  it('clamps a caller-supplied limit to the hard cap', () => {
    const many = Array.from({ length: FLEET_ECHO_MAX_LANES + 5 }, (_unused, index) =>
      dispatch({ dispatchId: `ctx_${index}`, taskId: `task_${index}` })
    )
    const echo = buildFleetEcho('run_1', makeSources({ listActiveDispatches: () => many }), 500)

    expect(echo.lanes).toHaveLength(FLEET_ECHO_MAX_LANES)
    expect(echo.truncated).toBe(true)
  })

  it('treats an epoch-zero output timestamp as a real time, not as absent', () => {
    const echo = buildFleetEcho(
      'run_1',
      makeSources({
        listActiveDispatches: () => [dispatch({ dispatchedAt: NOW - 60_000 })],
        getTerminalSignal: () => ({ lastOutputAt: 0, processState: 'live' })
      })
    )

    expect(echo.lanes[0].quietMs).toBe(NOW)
    // Why: 0 predates the dispatch, so delivery must read it as "nothing since", not as "unknown".
    expect(echo.lanes[0].delivery).toBe('not_accepted')
  })

  it('caps lanes at the limit and flags truncation', () => {
    const many = Array.from({ length: FLEET_ECHO_MAX_LANES + 3 }, (_unused, index) =>
      dispatch({ dispatchId: `ctx_${index}`, taskId: `task_${index}` })
    )
    const echo = buildFleetEcho('run_1', makeSources({ listActiveDispatches: () => many }))

    expect(echo.lanes).toHaveLength(FLEET_ECHO_MAX_LANES)
    expect(echo.truncated).toBe(true)
  })

  it('does not flag truncation when every lane fits', () => {
    const echo = buildFleetEcho(
      'run_1',
      makeSources({ listActiveDispatches: () => [dispatch()] })
    )

    expect(echo.truncated).toBe(false)
  })
})
