import { ORCHESTRATION_DELIVERY_BATCH_LIMIT, type OrchestrationDb } from './db'

export type OrchestrationMessageWaiter = { typeFilter: string[] | undefined }

export function messageTypeHasOrchestrationWaiter(
  waiters: ReadonlySet<OrchestrationMessageWaiter> | undefined,
  messageType: string
): boolean {
  for (const waiter of waiters ?? []) {
    if (!waiter.typeFilter || waiter.typeFilter.includes(messageType)) {
      return true
    }
  }
  return false
}

export function hasUnfilteredOrchestrationWaiter(
  waiters: ReadonlySet<OrchestrationMessageWaiter> | undefined
): boolean {
  for (const waiter of waiters ?? []) {
    if (!waiter.typeFilter) {
      return true
    }
  }
  return false
}

export function shouldReleaseOrchestrationPointer(
  db: OrchestrationDb | null,
  mailboxHandle: string,
  messages: readonly { id: string; type: string }[],
  waiters: ReadonlySet<OrchestrationMessageWaiter> | undefined
): boolean {
  if (
    mailboxHandle.startsWith('run:') &&
    db?.hasOutstandingRunDelivery?.(mailboxHandle.slice('run:'.length))
  ) {
    return true
  }
  if (messages.some((message) => messageTypeHasOrchestrationWaiter(waiters, message.type))) {
    return true
  }
  return !(
    db?.areUnreadMessages?.(
      mailboxHandle,
      messages.map((message) => message.id)
    ) ?? true
  )
}

export function collectDeliverableMailboxPointerMessages(
  db: OrchestrationDb,
  mailboxHandle: string,
  waiters: ReadonlySet<OrchestrationMessageWaiter> | undefined,
  reservedTypes?: ReadonlySet<string>
): { id: string; type: string; sequence: number }[] {
  if (hasUnfilteredOrchestrationWaiter(waiters)) {
    return []
  }
  const excludedTypes = new Set(reservedTypes)
  for (const waiter of waiters ?? []) {
    for (const type of waiter.typeFilter ?? []) {
      excludedTypes.add(type)
    }
  }
  return db
    .getUndeliveredUnreadMessages(mailboxHandle, undefined, {
      excludeTypes: [...excludedTypes],
      limit: ORCHESTRATION_DELIVERY_BATCH_LIMIT
    })
    .filter(
      (message) =>
        !reservedTypes?.has(message.type) &&
        !messageTypeHasOrchestrationWaiter(waiters, message.type)
    )
    .slice(0, ORCHESTRATION_DELIVERY_BATCH_LIMIT)
}
