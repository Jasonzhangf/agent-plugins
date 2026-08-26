/**
 * The client-modules runtime no longer exports the hook constructor that the
 * package's old peer dependency did. Keep the 15-line uSES bridge local so
 * this plugin does not depend on a test-only package.
 */
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/shim/with-selector.js'
import type { HostObservable, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'

export function bindSnapshotSelector<T>(source: HostObservable<T>): SnapshotSelectorHook<T> {
  const subscribe = (fn: () => void): (() => void) => source.subscribe(fn)
  const getSnapshot = (): T => source.getSnapshot()
  return function useSelector<S>(selector: (s: T) => S, eq?: (a: S, b: S) => boolean): S {
    return useSyncExternalStoreWithSelector(subscribe, getSnapshot, undefined, selector, eq)
  }
}
