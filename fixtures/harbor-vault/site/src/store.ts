import { useSyncExternalStore } from 'react'

export type Store<T> = { get(): T; set(patch: Partial<T>): void; subscribe(listener: () => void): () => void }

export function createStore<T>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch }
      listeners.forEach((listener) => listener())
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export const useStore = <T,>(store: Store<T>): T => useSyncExternalStore(store.subscribe, store.get)
