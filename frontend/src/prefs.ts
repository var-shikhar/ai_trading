import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

// Per-browser conveniences only (layout, last symbols, theme); the app works
// without them, so every access is guarded.
export function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function usePref<T>(key: string, fallback: T | (() => T)) {
  const [value, setValue] = useState<T>(() =>
    loadPref(key, typeof fallback === 'function' ? (fallback as () => T)() : fallback),
  )
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // storage unavailable (private mode etc.)
    }
  }, [key, value])
  return [value, setValue] as const
}

// Shared prefs: every component using the same key sees the same value
// (e.g. the active watchlist, chosen on one screen and used by another).
const shared = new Map<string, { value: unknown; listeners: Set<() => void> }>()

function sharedEntry<T>(key: string, fallback: T) {
  let entry = shared.get(key)
  if (!entry) {
    entry = { value: loadPref(key, fallback), listeners: new Set() }
    shared.set(key, entry)
  }
  return entry
}

function writeShared(key: string, value: unknown) {
  const entry = shared.get(key)
  if (!entry) return
  entry.value = value
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage unavailable
  }
  entry.listeners.forEach((fn) => fn())
}

function subscribeShared(key: string, fn: () => void) {
  const listeners = shared.get(key)!.listeners
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function useSharedPref<T>(key: string, fallback: T) {
  sharedEntry(key, fallback)
  const value = useSyncExternalStore(
    useCallback((fn: () => void) => subscribeShared(key, fn), [key]),
    () => shared.get(key)!.value as T,
  )
  const set = useCallback((next: T) => writeShared(key, next), [key])
  return [value, set] as const
}
