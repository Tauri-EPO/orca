import { describe, expect, it } from 'vitest'

import { workerStartRecovery } from './orchestration-residual-recovery'

const AGENT_TERMINAL = {
  kind: 'terminal',
  role: 'agent',
  action: 'created',
  id: 'term_agent',
  surface: 'visible'
}

const failedReceipt = (overrides: Record<string, unknown> = {}) => ({
  runId: 'run_1',
  taskId: 'task_1',
  dispatchId: 'ctx_1',
  state: 'failed',
  failedStage: 'dispatch_input',
  effects: [],
  residualResources: [AGENT_TERMINAL],
  ...overrides
})

describe('workerStartRecovery', () => {
  it('routes reclaim of a failed start through its Dispatch, not the terminal handle', () => {
    const recovery = workerStartRecovery(failedReceipt())

    expect(recovery?.commands).toEqual([
      'orca orchestration worker-release --dispatch ctx_1 --json'
    ])
    expect(recovery?.note).toContain('preserves the output')
    expect(JSON.stringify(recovery)).not.toContain('terminal close')
  })

  it('treats the agent terminal of an agent-first worktree as created by this start', () => {
    const recovery = workerStartRecovery(
      failedReceipt({
        residualResources: [
          { kind: 'worktree', action: 'created_child', id: 'repo::child' },
          { ...AGENT_TERMINAL, action: 'reused_agent_terminal' }
        ]
      })
    )

    expect(recovery?.commands).toEqual([
      'orca orchestration worker-release --dispatch ctx_1 --json'
    ])
  })

  it('offers nothing while the start outcome is unknown, because the worker may be live', () => {
    expect(workerStartRecovery(failedReceipt({ state: 'outcome_unknown' }))).toBeUndefined()
  })

  it('offers nothing for a ready worker, whose residual terminal is the live worker', () => {
    expect(workerStartRecovery(failedReceipt({ state: 'ready' }))).toBeUndefined()
  })

  it('offers nothing for setup and configured-tab terminals a new worktree left running', () => {
    expect(
      workerStartRecovery(
        failedReceipt({
          residualResources: [
            { kind: 'terminal', role: 'setup', action: 'created', id: 'term_setup' },
            { kind: 'terminal', role: 'configured_tab', action: 'created', id: 'term_tab' },
            { kind: 'worktree', action: 'created_top_level', id: 'repo::wt' },
            { kind: 'setup', action: 'run', state: 'running', terminalId: 'term_setup' }
          ]
        })
      )
    ).toBeUndefined()
  })

  it('offers nothing for a terminal this start adopted instead of creating', () => {
    expect(
      workerStartRecovery(
        failedReceipt({ residualResources: [{ ...AGENT_TERMINAL, action: 'reused' }] })
      )
    ).toBeUndefined()
  })

  it('keeps a federated residual on its worker server instead of the Run home', () => {
    const recovery = workerStartRecovery(
      failedReceipt({ server: { environmentId: 'env_win', name: 'windows' } })
    )

    expect(recovery?.commands).toEqual(['orca orchestration worker-show --dispatch ctx_1 --json'])
    expect(recovery?.note).toContain('worker server windows')
    expect(JSON.stringify(recovery)).not.toContain('worker-release')
  })

  it('reclaims an SSH-backed worktree through the same Dispatch that owns its host', () => {
    // Why: an SSH worktree has no worker server of its own; this runtime still routes the host.
    const recovery = workerStartRecovery(
      failedReceipt({
        residualResources: [{ ...AGENT_TERMINAL, id: 'term_ssh_agent' }]
      })
    )

    expect(recovery?.commands).toEqual([
      'orca orchestration worker-release --dispatch ctx_1 --json'
    ])
  })

  it('defers to a host that shipped its own commands', () => {
    expect(
      workerStartRecovery(
        failedReceipt({
          nextCommands: ['orca orchestration worker-abandon --dispatch ctx_1 --json']
        })
      )
    ).toBeUndefined()
    expect(
      workerStartRecovery(failedReceipt({ recoveryCommands: ['orca something --json'] }))
    ).toBeUndefined()
  })

  it('offers nothing when a differently-versioned host shapes the residual another way', () => {
    expect(
      workerStartRecovery(
        failedReceipt({ residualResources: [{ kind: 'terminal', id: 'term_agent' }] })
      )
    ).toBeUndefined()
    expect(
      workerStartRecovery(
        failedReceipt({ residualResources: [{ ...AGENT_TERMINAL, action: 'provisioned' }] })
      )
    ).toBeUndefined()
    expect(
      workerStartRecovery(failedReceipt({ residualResources: [{ ...AGENT_TERMINAL, id: '' }] }))
    ).toBeUndefined()
    expect(workerStartRecovery(failedReceipt({ residualResources: {} }))).toBeUndefined()
    expect(workerStartRecovery(failedReceipt({ dispatchId: '' }))).toBeUndefined()
    expect(workerStartRecovery(undefined)).toBeUndefined()
  })
})
