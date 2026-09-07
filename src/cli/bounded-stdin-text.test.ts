import { describe, expect, it } from 'vitest'
import { readStreamBytesWithinLimit, readTextStreamWithinLimit } from './bounded-stdin-text'

const tooLarge = (): Error => new Error('too large')

async function* stream(
  chunks: (Buffer | Uint8Array | string)[]
): AsyncGenerator<Buffer | Uint8Array | string> {
  for (const chunk of chunks) {
    yield chunk
  }
}

describe('bounded stream reading', () => {
  it('preserves the bytes of a plain Uint8Array chunk', async () => {
    const bytes = new Uint8Array(Buffer.from('segundo café', 'utf8'))

    await expect(readTextStreamWithinLimit(stream([bytes]), 64, tooLarge)).resolves.toBe(
      'segundo café'
    )
  })

  it('counts a Uint8Array chunk by its byte length, not its stringified form', async () => {
    // 3 bytes stringify to "226,130,172", so a length-based limit must not see 11.
    const euro = new Uint8Array(Buffer.from('€', 'utf8'))

    await expect(readStreamBytesWithinLimit(stream([euro]), 3, tooLarge)).resolves.toEqual(
      Buffer.from('€', 'utf8')
    )
    await expect(readStreamBytesWithinLimit(stream([euro]), 2, tooLarge)).rejects.toThrow(
      'too large'
    )
  })

  it('reads a Uint8Array view without dragging in the rest of its backing buffer', async () => {
    const backing = Buffer.from('prefix-payload-suffix', 'utf8')
    const view = new Uint8Array(backing.buffer, backing.byteOffset + 7, 7)

    await expect(readTextStreamWithinLimit(stream([view]), 64, tooLarge)).resolves.toBe('payload')
  })

  it('accepts string chunks and joins multi-byte characters split across chunks', async () => {
    const cafe = Buffer.from('café', 'utf8')

    await expect(readTextStreamWithinLimit(stream(['ab', 'cd']), 64, tooLarge)).resolves.toBe(
      'abcd'
    )
    await expect(
      readTextStreamWithinLimit(stream([cafe.subarray(0, -1), cafe.subarray(-1)]), 64, tooLarge)
    ).resolves.toBe('café')
  })
})
