import { describe, expect, it } from 'vitest'
import { formatCommandHelp } from '../help'
import { ORCHESTRATION_COMMAND_SPECS } from './orchestration'

describe('orchestration command specs', () => {
  it('lists valid message types and the reply command in send help', () => {
    const spec = ORCHESTRATION_COMMAND_SPECS.find(
      (entry) => entry.path.join(' ') === 'orchestration send'
    )
    if (!spec) {
      throw new Error('Missing orchestration send spec')
    }

    const help = formatCommandHelp(spec)

    expect(help).toContain(
      'Valid --type values: status, dispatch, worker_done, merge_ready, escalation, handoff, decision_gate, question, heartbeat.'
    )
    expect(help).toContain(
      'To answer a worker question, use `orchestration reply --id <msg_id>` instead of send.'
    )
  })
})
