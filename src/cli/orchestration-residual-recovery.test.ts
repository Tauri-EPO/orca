import { describe, expect, it } from 'vitest'

import { residualResourceRecoveryCommands } from './orchestration-residual-recovery'

describe('residualResourceRecoveryCommands', () => {
  it('emits one terminal close per residual agent terminal', () => {
    expect(
      residualResourceRecoveryCommands([
        { kind: 'terminal', role: 'agent', action: 'created', id: 'term_a', surface: 'visible' },
        { kind: 'terminal', role: 'setup', action: 'created', id: 'term_b' }
      ])
    ).toEqual([
      'orca terminal close --terminal term_a --json',
      'orca terminal close --terminal term_b --json'
    ])
  })

  it('offers no command for a kind without an exact reclaim, such as a worktree', () => {
    expect(
      residualResourceRecoveryCommands([
        { kind: 'worktree', action: 'created_child', id: 'repo::child' }
      ])
    ).toEqual([])
  })

  it('repeats no command when the same terminal appears twice', () => {
    expect(
      residualResourceRecoveryCommands([
        { kind: 'terminal', id: 'term_a' },
        { kind: 'terminal', id: 'term_a' }
      ])
    ).toEqual(['orca terminal close --terminal term_a --json'])
  })

  it('ignores malformed entries and a non-array field', () => {
    expect(
      residualResourceRecoveryCommands([
        null,
        'term_a',
        { kind: 'terminal' },
        { kind: 'terminal', id: '' }
      ])
    ).toEqual([])
    expect(residualResourceRecoveryCommands(undefined)).toEqual([])
  })
})
