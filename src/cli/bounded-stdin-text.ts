type BoundedStreamChunk = Buffer | Uint8Array | string

export async function readStreamBytesWithinLimit(
  input: AsyncIterable<BoundedStreamChunk>,
  maxBytes: number,
  createTooLargeError: () => Error
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of input) {
    // Why: a plain Uint8Array has to be wrapped, not stringified, or its bytes become decimal text.
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : typeof chunk === 'string'
        ? Buffer.from(chunk, 'utf8')
        : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > maxBytes) {
      throw createTooLargeError()
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

export async function readTextStreamWithinLimit(
  input: AsyncIterable<BoundedStreamChunk>,
  maxBytes: number,
  createTooLargeError: () => Error
): Promise<string> {
  return (await readStreamBytesWithinLimit(input, maxBytes, createTooLargeError)).toString('utf8')
}

export function readStdinBytesWithinLimit(
  maxBytes: number,
  createTooLargeError: () => Error
): Promise<Buffer> {
  return readStreamBytesWithinLimit(process.stdin, maxBytes, createTooLargeError)
}

export function readStdinTextWithinLimit(
  maxBytes: number,
  createTooLargeError: () => Error
): Promise<string> {
  return readTextStreamWithinLimit(process.stdin, maxBytes, createTooLargeError)
}
