type ResidualResource = {
  kind?: unknown
  id?: unknown
}

/** Exact reclaim commands for the resources a failed or unknown start left behind. */
export function residualResourceRecoveryCommands(residualResources: unknown): string[] {
  if (!Array.isArray(residualResources)) {
    return []
  }
  const commands: string[] = []
  for (const resource of residualResources) {
    const command = residualResourceRecoveryCommand(resource)
    if (command !== undefined && !commands.includes(command)) {
      commands.push(command)
    }
  }
  return commands
}

function residualResourceRecoveryCommand(resource: unknown): string | undefined {
  if (resource === null || typeof resource !== 'object') {
    return undefined
  }
  const { kind, id } = resource as ResidualResource
  // Why: a terminal has one exact reclaim command; a residual worktree needs a human decision.
  return kind === 'terminal' && typeof id === 'string' && id.length > 0
    ? `orca terminal close --terminal ${id} --json`
    : undefined
}
