import { describe, expect, it, vi } from 'vitest'
import type { DetectedWorktree } from '../../../../shared/worktree/types'
import type { WorkspaceSessionState } from '../../../../shared/workspace-session-state-types'
import { getDefaultWorkspaceSession } from '../../../../shared/constants'
import { buildValidWorktreeIdsForSessionHydration } from './degraded-repo-worktree-validity'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))

// @ts-expect-error -- mocked browser preload API
globalThis.window = { api: {} }

const { createTestStore, makeTab } = await import('./store-test-helpers')

const REPO_ID = 'repo1'
const VISIBLE_ID = `${REPO_ID}::/repo/main`
// A lane an agent CLI created with `git worktree add` under the repo's scratch container.
const HIDDEN_ID = `${REPO_ID}::/repo/.claude/worktrees/lane-a`
const DELETED_ID = `${REPO_ID}::/repo/.claude/worktrees/gone`
const HIDDEN_TAB_ID = 'terminal-lane-a'
const HIDDEN_GROUP_ID = 'group-lane-a'

function detected(id: string, visible: boolean): DetectedWorktree {
  return {
    id,
    repoId: REPO_ID,
    path: id.split('::')[1]!,
    head: 'abc123',
    branch: 'refs/heads/lane',
    isBare: false,
    isMainWorktree: false,
    displayName: 'lane',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    linkedGitLabMR: null,
    linkedGitLabIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    ownership: visible ? 'orca-managed' : 'agent-scratch',
    selectedCheckout: false,
    visible
  } as DetectedWorktree
}

const DETECTED = [detected(VISIBLE_ID, true), detected(HIDDEN_ID, false)]

function catalog() {
  return {
    repos: [{ id: REPO_ID }],
    // Mirrors the real store: worktreesByRepo carries only the rows the sidebar shows.
    worktreesByRepo: {
      [REPO_ID]: DETECTED.filter((worktree) => worktree.visible).map(({ id }) => ({ id }))
    },
    detectedWorktreesByRepo: {
      [REPO_ID]: {
        repoId: REPO_ID,
        authoritative: true,
        source: 'git' as const,
        worktrees: DETECTED
      }
    }
  }
}

describe('session hydration for worktrees hidden from the sidebar', () => {
  it('keeps a hidden-but-detected worktree valid so its persisted panes survive a restart', () => {
    expect(buildValidWorktreeIdsForSessionHydration(catalog(), [HIDDEN_ID]).has(HIDDEN_ID)).toBe(
      true
    )
  })

  it('still drops a persisted worktree an authoritative scan no longer detects', () => {
    expect(buildValidWorktreeIdsForSessionHydration(catalog(), [DELETED_ID]).has(DELETED_ID)).toBe(
      false
    )
  })

  it('leaves the visible worktree valid', () => {
    expect(buildValidWorktreeIdsForSessionHydration(catalog(), [VISIBLE_ID]).has(VISIBLE_ID)).toBe(
      true
    )
  })

  it('restores the terminal tab of a hidden worktree through a full hydration pass', () => {
    const session: WorkspaceSessionState = {
      ...getDefaultWorkspaceSession(),
      activeRepoId: REPO_ID,
      activeWorktreeId: HIDDEN_ID,
      activeTabId: HIDDEN_TAB_ID,
      tabsByWorktree: {
        [HIDDEN_ID]: [makeTab({ id: HIDDEN_TAB_ID, worktreeId: HIDDEN_ID })]
      },
      unifiedTabs: {
        [HIDDEN_ID]: [
          {
            id: HIDDEN_TAB_ID,
            entityId: HIDDEN_TAB_ID,
            groupId: HIDDEN_GROUP_ID,
            worktreeId: HIDDEN_ID,
            contentType: 'terminal',
            label: 'Terminal',
            customLabel: null,
            color: null,
            sortOrder: 0,
            createdAt: 1
          }
        ]
      },
      tabGroups: {
        [HIDDEN_ID]: [
          {
            id: HIDDEN_GROUP_ID,
            worktreeId: HIDDEN_ID,
            activeTabId: HIDDEN_TAB_ID,
            tabOrder: [HIDDEN_TAB_ID],
            recentTabIds: [HIDDEN_TAB_ID]
          }
        ]
      },
      activeGroupIdByWorktree: { [HIDDEN_ID]: HIDDEN_GROUP_ID }
    }

    const store = createTestStore()
    store.setState({
      repos: [
        { id: REPO_ID, path: '/repo', displayName: 'Repo', badgeColor: '#000', addedAt: 0 }
      ],
      // The authoritative scan sees both; only the visible one reaches worktreesByRepo.
      worktreesByRepo: { [REPO_ID]: DETECTED.filter((w) => w.visible) },
      detectedWorktreesByRepo: {
        [REPO_ID]: {
          repoId: REPO_ID,
          authoritative: true,
          source: 'git',
          worktrees: DETECTED
        }
      }
    })
    store.getState().hydrateTabsSession(session)

    expect(store.getState().unifiedTabsByWorktree[HIDDEN_ID]?.map((tab) => tab.id)).toEqual([
      HIDDEN_TAB_ID
    ])
  })
})
