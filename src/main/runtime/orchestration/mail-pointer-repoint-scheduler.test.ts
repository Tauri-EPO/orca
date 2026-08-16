import { afterEach, describe, expect, it, vi } from 'vitest'
import { MailPointerRepointScheduler } from './mail-pointer-repoint-scheduler'

describe('MailPointerRepointScheduler', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces default repairs at 2s and honors an explicit remaining delay', async () => {
    vi.useFakeTimers()
    const repoint = vi.fn()
    const scheduler = new MailPointerRepointScheduler(repoint)

    scheduler.schedule('run:run_a')
    scheduler.schedule('run:run_a')
    await vi.advanceTimersByTimeAsync(1_999)
    expect(repoint).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(repoint).toHaveBeenCalledOnce()
    expect(repoint).toHaveBeenCalledWith('run:run_a')

    scheduler.schedule('run:run_b', 5_000)
    scheduler.schedule('run:run_b', 2_000)
    await vi.advanceTimersByTimeAsync(4_999)
    expect(repoint).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(repoint).toHaveBeenCalledTimes(2)
    expect(repoint).toHaveBeenLastCalledWith('run:run_b')
  })
})
