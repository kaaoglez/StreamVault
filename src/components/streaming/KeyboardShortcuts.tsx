'use client';

import { useEffect, useCallback } from 'react';
import { useAppStore } from '@/store/app-store';
import { openYouTubeTrailer } from '@/lib/trailer';

/**
 * Determines if the currently focused element is an input-like element
 * where keyboard shortcuts should NOT be intercepted.
 */
function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable) return true;
  return false;
}

export function KeyboardShortcuts() {
  const {
    openSearch,
    closeSearch,
    closeDetail,
    closePlayer,
    isSearchOpen,
    isDetailOpen,
    isPlayerOpen,
    selectedMovie,
  } = useAppStore();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Never intercept when typing in inputs
      if (isInputFocused()) return;

      // If any modal/player is open, don't intercept most shortcuts
      const anyOverlayOpen = isSearchOpen || isDetailOpen || isPlayerOpen;

      // "/" or Ctrl+K → open search
      if (e.key === '/' || (e.key === 'k' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        if (!isSearchOpen) {
          openSearch();
        }
        return;
      }

      // Escape → close overlays in priority order
      if (e.key === 'Escape') {
        if (isSearchOpen) {
          e.preventDefault();
          closeSearch();
          return;
        }
        if (isDetailOpen) {
          e.preventDefault();
          closeDetail();
          return;
        }
        if (isPlayerOpen) {
          e.preventDefault();
          closePlayer();
          return;
        }
      }

      // Only these shortcuts work when overlays are open (except for player shortcuts)
      // Space → toggle play/pause (only when player is open)
      if (e.key === ' ' && isPlayerOpen && !isSearchOpen && !isDetailOpen) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('player-toggle-play'));
        return;
      }

      // F → toggle fullscreen (only when player is open)
      if (
        (e.key === 'f' || e.key === 'F') &&
        isPlayerOpen &&
        !isSearchOpen &&
        !isDetailOpen
      ) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('player-toggle-fullscreen'));
        return;
      }

      // T → open trailer (only when detail is open and no search/player)
      if (
        (e.key === 't' || e.key === 'T') &&
        isDetailOpen &&
        !isSearchOpen &&
        !isPlayerOpen &&
        selectedMovie
      ) {
        e.preventDefault();
        openYouTubeTrailer(selectedMovie.title);
        return;
      }

      // Left/Right arrows → seek ±10s (only when player is open, no other overlay)
      if (
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
        isPlayerOpen &&
        !isSearchOpen &&
        !isDetailOpen
      ) {
        e.preventDefault();
        const seconds = e.key === 'ArrowLeft' ? -10 : 10;
        window.dispatchEvent(
          new CustomEvent('player-seek', { detail: { seconds } })
        );
        return;
      }
    },
    [
      openSearch,
      closeSearch,
      closeDetail,
      closePlayer,
      isSearchOpen,
      isDetailOpen,
      isPlayerOpen,
      selectedMovie,
    ]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // This component renders nothing — it only attaches event listeners
  return null;
}