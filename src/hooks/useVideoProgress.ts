'use client';

// ─── Video Progress Utilities ──────────────────────────────────
// Pure functions for localStorage + server persistence.
// The VideoPlayer component manages the lifecycle (when to check,
// when to save, when to start/stop the save timer).

export interface VideoProgressData {
  position: number;
  duration: number;
  updatedAt: string;
}

const STORAGE_KEY_PREFIX = 'sv_progress_';

export function getStorageKey(videoId: string): string {
  return STORAGE_KEY_PREFIX + videoId;
}

export function loadFromStorage(videoId: string): VideoProgressData | null {
  try {
    const raw = localStorage.getItem(getStorageKey(videoId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VideoProgressData;
    if (parsed.updatedAt) {
      const age = Date.now() - new Date(parsed.updatedAt).getTime();
      if (age > 30 * 24 * 60 * 60 * 1000) return null; // 30-day TTL
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveToStorage(videoId: string, position: number, duration: number): void {
  try {
    localStorage.setItem(getStorageKey(videoId), JSON.stringify({
      position,
      duration,
      updatedAt: new Date().toISOString(),
    }));
  } catch { /* storage full or unavailable */ }
}

export function removeFromStorage(videoId: string): void {
  try {
    localStorage.removeItem(getStorageKey(videoId));
  } catch { /* ignore */ }
}

export async function saveToServer(movieId: string, episodeId: string | null | undefined, progress: number) {
  try {
    await fetch('/api/watch-progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ movieId, episodeId, progress }),
    });
  } catch { /* ignore network errors */ }
}

export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}