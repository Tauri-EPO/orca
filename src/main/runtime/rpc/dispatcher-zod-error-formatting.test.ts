import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { MESSAGE_TYPES } from '../orchestration/types'
import { formatZodError } from './core'
import { ORCHESTRATION_METHODS } from './methods/orchestration'

describe('RPC Zod error formatting', () => {
  it('enumerates invalid values even when the Zod locale message is generic', () => {
    const result = z.enum(['first', 'second'], { error: () => 'Invalid input' }).safeParse('typo')
    if (result.success) {
      throw new Error('Expected enum parsing to fail')
    }

    expect(formatZodError(result.error)).toBe('Invalid option: expected one of "first"|"second"')
  })

  it('uses the Zod single-value phrasing for a literal with a generic locale message', () => {
    const result = z.literal('only', { error: () => 'Invalid input' }).safeParse('typo')
    if (result.success) {
      throw new Error('Expected literal parsing to fail')
    }

    expect(formatZodError(result.error)).toBe('Invalid input: expected "only"')
  })

  it('preserves schema-authored invalid value messages', () => {
    const result = z
      .enum(['first', 'second'], { error: () => 'Choose a supported mode' })
      .safeParse('typo')
    if (result.success) {
      throw new Error('Expected enum parsing to fail')
    }

    expect(formatZodError(result.error)).toBe('Choose a supported mode')
  })

  it('uses the send schema message for valid types and the reply pointer', () => {
    const sendMethod = ORCHESTRATION_METHODS.find((method) => method.name === 'orchestration.send')
    const result = sendMethod?.params?.safeParse({ subject: 'hello', type: 'reply' })
    if (!result || result.success) {
      throw new Error('Expected orchestration.send type parsing to fail')
    }

    expect(formatZodError(result.error)).toBe(
      `Invalid --type: expected one of ${MESSAGE_TYPES.join(', ')}; to answer a worker question, use \`orchestration reply --id <msg_id>\` instead of send.`
    )
  })
})
