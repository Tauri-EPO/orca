import { createElement, forwardRef } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalWebViewHandle } from './terminal-webview-contract'

const mocks = vi.hoisted(() => ({
  postMessage: vi.fn(),
  platformOS: { value: 'ios' }
}))

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mocks.platformOS.value
    }
  },
  View: 'View',
  StyleSheet: { create: <T,>(styles: T) => styles, absoluteFillObject: {} },
  Text: 'Text',
  Pressable: 'Pressable'
}))

vi.mock('lucide-react-native', () => ({ RefreshCw: 'RefreshCw' }))

vi.mock('react-native-webview', () => ({
  WebView: forwardRef(function MockWebView(props: Record<string, unknown>, ref) {
    if (ref && typeof ref === 'object') {
      ;(ref as { current: unknown }).current = { postMessage: mocks.postMessage }
    }
    return createElement('WebView', props)
  })
}))

// Why: the real source inlines the generated xterm bundle, which is not built in unit tests.
vi.mock('./terminal-webview-html', () => ({ XTERM_WEBVIEW_SOURCE: { html: '<html></html>' } }))

import { TerminalWebView } from './TerminalWebView'
import { TERMINAL_WEBVIEW_FRAME_STYLES } from './terminal-webview-frame-styles'

function findWebView(renderer: ReactTestRenderer) {
  return renderer.root.findByType('WebView' as never)
}

function webViewIsHidden(renderer: ReactTestRenderer): boolean {
  const style = findWebView(renderer).props.style as unknown[]
  return Array.isArray(style) && style.includes(TERMINAL_WEBVIEW_FRAME_STYLES.webviewHidden)
}

function deliverMessage(renderer: ReactTestRenderer, payload: Record<string, unknown>): void {
  act(() => {
    findWebView(renderer).props.onMessage({ nativeEvent: { data: JSON.stringify(payload) } })
  })
}

describe('TerminalWebView surface readiness gate', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  function render(): { renderer: ReactTestRenderer; ref: { current: TerminalWebViewHandle | null } } {
    const ref = { current: null as TerminalWebViewHandle | null }
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(createElement(TerminalWebView, { ref } as never))
    })
    return { renderer, ref }
  }

  it('hides the surface until the document reports web-ready', () => {
    const { renderer } = render()
    expect(webViewIsHidden(renderer)).toBe(true)

    deliverMessage(renderer, { type: 'web-ready' })
    expect(webViewIsHidden(renderer)).toBe(false)
  })

  it('hides again on load start and reveals on the recovery pong', () => {
    const { renderer, ref } = render()
    deliverMessage(renderer, { type: 'web-ready' })
    expect(webViewIsHidden(renderer)).toBe(false)

    act(() => {
      findWebView(renderer).props.onLoadStart()
    })
    expect(webViewIsHidden(renderer)).toBe(true)

    deliverMessage(renderer, { type: 'web-ready' })
    act(() => {
      ref.current?.prepareForForegroundRecovery()
    })
    expect(webViewIsHidden(renderer)).toBe(true)

    // Why: the recovery ping is message id 2 here (set-theme after web-ready is id 1).
    const pingId = JSON.parse(mocks.postMessage.mock.calls.at(-1)?.[0] as string).id as number
    deliverMessage(renderer, { type: 'pong', pingId })
    expect(webViewIsHidden(renderer)).toBe(false)
  })

  it('keeps the surface visible on non-iOS foreground recovery', () => {
    mocks.platformOS.value = 'android'
    try {
      const { renderer, ref } = render()
      deliverMessage(renderer, { type: 'web-ready' })
      act(() => {
        ref.current?.prepareForForegroundRecovery()
      })
      expect(webViewIsHidden(renderer)).toBe(false)
    } finally {
      mocks.platformOS.value = 'ios'
    }
  })
})
