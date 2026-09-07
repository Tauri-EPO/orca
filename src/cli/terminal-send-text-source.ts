import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  assertTerminalInputWithinLimit,
  TERMINAL_INPUT_MAX_BYTES,
  TERMINAL_INPUT_TOO_LARGE_ERROR
} from '../shared/terminal-input'
import { readStdinBytesWithinLimit, readStreamBytesWithinLimit } from './bounded-stdin-text'
import { getOptionalStringFlag, getRequiredStringFlag } from './flags'
import { RuntimeClientError } from './runtime-client'

async function readTerminalSendTextBytes(path: string, cwd: string): Promise<Buffer> {
  const createTooLargeError = (): RuntimeClientError =>
    new RuntimeClientError('invalid_argument', TERMINAL_INPUT_TOO_LARGE_ERROR)
  if (path === '-') {
    return readStdinBytesWithinLimit(TERMINAL_INPUT_MAX_BYTES, createTooLargeError)
  }
  const resolvedPath = resolve(cwd, path)
  try {
    // Why: size first, so an oversized file is refused without streaming it into memory.
    if ((await stat(resolvedPath)).size > TERMINAL_INPUT_MAX_BYTES) {
      throw createTooLargeError()
    }
    return await readStreamBytesWithinLimit(
      createReadStream(resolvedPath),
      TERMINAL_INPUT_MAX_BYTES,
      createTooLargeError
    )
  } catch (error) {
    if (error instanceof RuntimeClientError) {
      throw error
    }
    const detail = error instanceof Error ? `: ${error.message}` : ''
    throw new RuntimeClientError('invalid_argument', `Unable to read text file "${path}"${detail}`)
  }
}

/**
 * Decodes both the file and the stdin branch. Lossy UTF-8 would replace undecodable bytes with
 * U+FFFD and hand the agent a prompt that silently differs from the source, so it is refused.
 */
function decodeTerminalSendText(bytes: Buffer, path: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new RuntimeClientError(
      'invalid_argument',
      `Text file "${path}" is not valid UTF-8, so no input was sent. Re-encode it as UTF-8 and retry.`
    )
  }
}

/**
 * Resolves `terminal send` input from `--text` or `--text-file`. The text is fully materialized
 * here, before the caller derives prompt candidacy or runs the `--retry-request` preflight, so a
 * retry ID stays bound to the exact payload that was sent.
 */
export async function getTerminalSendText(
  flags: Map<string, string | boolean>,
  cwd: string
): Promise<string | undefined> {
  if (flags.has('text') && flags.has('text-file')) {
    throw new RuntimeClientError(
      'invalid_argument',
      '--text and --text-file cannot be used together'
    )
  }
  if (!flags.has('text-file')) {
    return getOptionalStringFlag(flags, 'text')
  }
  const path = getRequiredStringFlag(flags, 'text-file')
  const text = decodeTerminalSendText(await readTerminalSendTextBytes(path, cwd), path)
  if (text.length === 0) {
    throw new RuntimeClientError('invalid_argument', `Text file "${path}" is empty.`)
  }
  assertTerminalInputWithinLimit(text)
  return text
}
