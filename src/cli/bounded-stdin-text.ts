export async function readStdinTextWithinLimit(
  maxBytes: number,
  createTooLargeError: () => Error
): Promise<string> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    bytes += buffer.length
    if (bytes > maxBytes) {
      throw createTooLargeError()
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}
