import { useEffect, useState } from 'react'

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
