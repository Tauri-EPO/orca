import type { RuntimeTerminalSend } from '../../../../../../shared/runtime-terminal-contracts'
import type { OrcaRuntimeService } from '../../../../orca-runtime'
import { buildDispatchPreamble } from '../../../../orchestration/preamble'
import { sendStructuredWorkerPreamble } from '../../orchestration-structured-worker-session'
import { dispatchInputAcceptedEffect, dispatchInputFailedEffect } from '../dispatch-input-verdict'
import type { WorkerEffect, createStructuredWorkerSessionForWorktree } from './worker-topology'

type StructuredSession = Awaited<ReturnType<typeof createStructuredWorkerSessionForWorktree>> | null

/**
 * Hands a started worker the dispatch preamble, over whichever transport it has.
 *
 * The preamble itself is identical for both: a worker is taught the same verbs whichever mode it
 * runs in, and only the delivery differs — a PTY write returns a queued/accepted receipt, while a
 * structured turn either is acknowledged or throws.
 *
 * Why (#15958): the verdict is appended here, on both edges. A delivery that throws leaves the
 * cause only in the exception, and the Dispatch — the thing a coordinator can still read after the
 * caller is gone — keeps nothing but a stage and a message.
 */
export async function deliverWorkerDispatchPreamble(args: {
  runtime: OrcaRuntimeService
  structuredSession: StructuredSession
  terminalHandle: string
  dispatchId: string
  dispatchDepth: number
  taskId: string
  taskSpec: string
  coordinatorHandle: string
  dispatchCapability: string
  devMode: boolean | undefined
  requestId: string
  effects: WorkerEffect[]
}): Promise<RuntimeTerminalSend['prompt']> {
  const { runtime, structuredSession, terminalHandle } = args
  const preamble = buildDispatchPreamble({
    // Depth only. A worker is taught the same verbs whichever mode it runs in, so this must not
    // become a second gate: resolving the caller's worktree is what lets a structured worker
    // dispatch sub-workers exactly like a PTY one.
    canDispatchSubWorkers: args.dispatchDepth < runtime.getNestedWorkerMaxDepth(),
    taskId: args.taskId,
    dispatchId: args.dispatchId,
    taskSpec: args.taskSpec,
    coordinatorHandle: args.coordinatorHandle,
    workerHandle: terminalHandle,
    dispatchCapability: args.dispatchCapability,
    devMode: args.devMode,
    cliCommand: runtime.getTerminalOrchestrationCliCommand(terminalHandle)
  })
  try {
    if (structuredSession) {
      await sendStructuredWorkerPreamble({
        host: structuredSession.host,
        sessionId: structuredSession.identity.sessionId,
        dispatchId: args.dispatchId,
        preamble
      })
      args.effects.push(dispatchInputAcceptedEffect(terminalHandle))
      return undefined
    }
    const send = await runtime.sendTerminalAgentPrompt(terminalHandle, preamble, {
      acceptQueued: true,
      observationTimeoutMs: 0,
      requestId: args.requestId
    })
    args.effects.push(dispatchInputAcceptedEffect(terminalHandle))
    return send.prompt
  } catch (error) {
    args.effects.push(dispatchInputFailedEffect(terminalHandle, error))
    throw error
  }
}
