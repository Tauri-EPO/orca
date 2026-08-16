import { refreshManagedHookCommandsIfPresent } from '../agent-hooks/managed-hook-config-refresh'
import { refreshManagedScriptIfPresent } from '../agent-hooks/managed-hook-script-refresh'
import {
  getConfigPath,
  getManagedScriptPath,
  getStatusLineScriptPath,
  getWindowsManagedCommandMigrations,
  type ClaudeCompatibleHookSettings
} from './hook-settings'
import { getManagedStatusLineScript } from './statusline-script'

export async function refreshClaudeManagedScripts(
  settings: ClaudeCompatibleHookSettings,
  lifecycleScript: string
): Promise<void> {
  const lifecycleScriptPresent = await refreshManagedScriptIfPresent(
    getManagedScriptPath(settings),
    lifecycleScript
  )
  const statusLineScriptPresent = await refreshManagedScriptIfPresent(
    getStatusLineScriptPath(settings),
    getManagedStatusLineScript('local')
  )
  if (process.platform !== 'win32') {
    return
  }
  const [migration, ...additionalMigrations] = getWindowsManagedCommandMigrations(
    settings,
    lifecycleScriptPresent,
    statusLineScriptPresent
  )
  if (!migration) {
    return
  }
  await refreshManagedHookCommandsIfPresent({
    configPath: getConfigPath(settings),
    ...migration,
    additionalMigrations
  })
}
