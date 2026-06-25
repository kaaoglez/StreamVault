'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  ArrowLeft,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  SkipForward,
  SkipBack,
  ChevronRight,
  List,
  RotateCcw,
  Loader2,
  AlertTriangle,
  Zap,
  Clock,
  Globe,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TruncatedText } from '@/components/TruncatedText';
import { LoadingOverlay } from '@/components/streaming/LoadingOverlay';
import { useAppStore, type Movie, type Episode } from '@/store/app-store';
import {
  type VideoProgressData,
  loadFromStorage,
  saveToStorage,
  removeFromStorage,
  saveToServer,
  formatTime,
} from '@/hooks/useVideoProgress';

// ─── Types ───────────────────────────────────────────────────

interface EpisodeWithSeason extends Episode {
  seasonNumber: number;
}

interface PlayerContentProps {
  isOpen: boolean;
  playingMovie: Movie | null;
  playingEpisode: Episode | null;
  closePlayer: () => void;
}

// ─── Constants ───────────────────────────────────────────────

const BROWSER_NATIVE_EXTS = new Set(['mp4', 'webm', 'ogv', 'm4v']);
const NON_NATIVE_EXTS = new Set([
  'mkv', 'avi', 'wmv', 'flv', 'mov', 'mpg', 'mpeg', '3gp', 'ts', 'm2ts', 'mts',
]);

function isHevcFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return /hevc|h\.?265|x265|10[-_]?bit/.test(lower);
}

// Parse "1h 36m" / "45m" / "22m" → total seconds
function parseDurationToSeconds(dur: string | null | undefined): number {
  if (!dur) return 0;
  let s = 0;
  const h = dur.match(/(\d+)\s*h/i);
  const m = dur.match(/(\d+)\s*m/i);
  if (h) s += parseInt(h[1], 10) * 3600;
  if (m) s += parseInt(m[1], 10) * 60;
  return s;
}

// ─── Main VideoPlayer ───────────────────────────────────────
// CRITICAL: ALWAYS renders PlayerContent — never returns null.
// This keeps the <video> element, rAF timer, and all refs alive
// across open/close cycles. The timer NEVER resets to 0.
// The container is hidden with CSS (invisible + pointer-events-none)
// when the player is closed.

export function VideoPlayer() {
  const { isPlayerOpen, playingMovie, playingEpisode, closePlayer } =
    useAppStore();

  return (
    <PlayerContent
      isOpen={isPlayerOpen}
      playingMovie={playingMovie}
      playingEpisode={playingEpisode}
      closePlayer={closePlayer}
    />
  );
}

// ─── Player Content ──────────────────────────────────────────
// This component NEVER unmounts. Video changes are detected via
// useEffect watching videoId. The timer (rAF) runs continuously
// but only updates DOM when isOpen is true.

function PlayerContent({
  isOpen,
  playingMovie,
  playingEpisode,
  closePlayer,
}: PlayerContentProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const progressSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── State ─────────────────────────────────────────────
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showEpisodeList, setShowEpisodeList] = useState(false);
  const [episodes, setEpisodes] = useState<EpisodeWithSeason[]>([]);
  const [showEndScreen, setShowEndScreen] = useState(false);
  const [showNextUpPreview, setShowNextUpPreview] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [needsFfmpeg, setNeedsFfmpeg] = useState(false);
  const [isTranscoding, setIsTranscoding] = useState(false);
  const [errorType, setErrorType] = useState<'format' | 'rateLimit' | 'network' | 'ffmpeg'>('format');
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [savedProgress, setSavedProgress] = useState<VideoProgressData | null>(null);
  const [hasSubtitles, setHasSubtitles] = useState(false);
  const [subtitlesOn, setSubtitlesOn] = useState(true);
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(false);
  const [isComingSoon, setIsComingSoon] = useState(false);

  // ─── Refs: transcode mode ──────────────────────────────
  const currentModeRef = useRef<'native' | 'transcode'>('native');
  const hasTriedNativeRef = useRef(false);
  const hasTriedTranscodeRef = useRef(false);
  const retryCountRef = useRef(0);

  // ─── Refs: offset & video tracking ─────────────────────
  // seekOffsetRef: When FFmpeg uses -ss, the browser's currentTime starts from 0
  // but represents offset+currentTime of the real file.
  const seekOffsetRef = useRef(0);
  // pendingSeekRef: For native formats, we set video.currentTime after metadata loads.
  const pendingSeekRef = useRef(0);
  // Track current video to detect changes without unmounting
  const currentVideoIdRef = useRef('');
  const currentProgressKeyRef = useRef('');
  const currentEpisodeIdRef = useRef<string | null>(null);
  // Real duration from DB (e.g. "22m" → 1320s). Used for Next Up timing
  // because video.duration is unreliable for transcoded streams.
  const knownDurationRef = useRef(0);
  // Track isOpen in a ref for the rAF loop (avoids recreating the loop)
  const isOpenRef = useRef(false);

  // ─── Refs: cached position for cleanup saves ───────────
  const lastKnownPositionRef = useRef(0);
  const lastKnownDurationRef = useRef(0);

  // ─── Refs: auto-advance ────────────────────────────────
  const autoAdvanceDisabledRef = useRef(false);
  const showNextUpPreviewRef = useRef(false);
  const nextEpisodeRef = useRef<EpisodeWithSeason | null>(null);

  // ─── Refs: iframe/VidCore wall-clock tracking ─────────
  const iframeStartTimeRef = useRef<number | null>(null);

  // ─── Refs: DOM elements updated by rAF (zero React re-renders) ──
  const progressFillRef = useRef<HTMLDivElement>(null);
  const progressThumbRef = useRef<HTMLDivElement>(null);
  const bufferedFillRef = useRef<HTMLDivElement>(null);
  const timeDisplayRef = useRef<HTMLSpanElement>(null);
  const seekInputRef = useRef<HTMLInputElement>(null);
  const nextUpCountdownRef = useRef<HTMLSpanElement>(null);
  const nextUpProgressRef = useRef<HTMLDivElement>(null);

  const { openPlayer } = useAppStore();

  // ─── Derived values ────────────────────────────────────
  const videoId = playingEpisode?.filePath
    ? playingEpisode.id
    : playingMovie?.filePath
      ? playingMovie.id
      : null;

  const progressKey = playingEpisode
    ? `${playingMovie?.id || ''}:${playingEpisode.id}`
    : playingMovie?.id || '';

  const filePath = playingEpisode?.filePath || playingMovie?.filePath || '';
  const fileExt = filePath.split('.').pop()?.toLowerCase() || '';
  const fileName = filePath.split(/[\\/]/).pop() || '';
  const isHevc = isHevcFile(fileName);
  const isClearlyNonNative = NON_NATIVE_EXTS.has(fileExt);
  const initialTranscode =
    isClearlyNonNative || (BROWSER_NATIVE_EXTS.has(fileExt) && isHevc);

  const videoBaseUrl = videoId ? `/api/video/${videoId}` : null;
  const subtitleUrl = videoId ? `/api/subtitle/${videoId}` : null;
  const hasVideo =
    !!videoBaseUrl || !!playingEpisode?.videoUrl || !!playingMovie?.videoUrl;
  const isSeries = playingMovie?.type === 'series';

  // ─── VidCore iframe fallback ──────────────────────────
  // When no local video exists but we have an imdbId, stream via vidcore.net
  const imdbId = playingMovie?.imdbId;
  const vidcoreUrl = !hasVideo && imdbId
    ? isSeries && playingEpisode
      ? `https://vidcore.net/tv/${imdbId}/${playingEpisode.seasonNumber}/${playingEpisode.episodeNumber}?autoPlay=true`
      : `https://vidcore.net/movie/${imdbId}?autoPlay=true`
    : null;
  const isIframeMode = !!vidcoreUrl;

  // ─── Episode list & next episode ────────────────────────
  const currentEpisodeIndex = playingEpisode
    ? episodes.findIndex(
        (ep) =>
          ep.seasonNumber === playingEpisode.seasonNumber &&
          ep.episodeNumber === playingEpisode.episodeNumber,
      )
    : -1;

  const nextEpisode =
    currentEpisodeIndex >= 0 && currentEpisodeIndex < episodes.length - 1
      ? episodes[currentEpisodeIndex + 1]
      : null;

  useEffect(() => {
    nextEpisodeRef.current = nextEpisode;
  }, [nextEpisode]);

  // Keep isOpenRef in sync (used by rAF loop)
  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  // ─── Build video URL ───────────────────────────────────
  const buildUrl = useCallback(
    (mode: 'native' | 'transcode', startOffset: number = 0) => {
      let url = playingEpisode?.videoUrl || playingMovie?.videoUrl || '';
      if (videoBaseUrl) {
        url =
          mode === 'transcode'
            ? `${videoBaseUrl}?transcode=true`
            : videoBaseUrl;
        if (startOffset > 0 && mode === 'transcode') {
          url += `&start=${Math.floor(startOffset)}`;
        }
      }
      return url;
    },
    [videoBaseUrl, playingEpisode?.videoUrl, playingMovie?.videoUrl],
  );

  // ─── Save current progress (offset-aware) ──────────────
  const saveCurrentProgress = useCallback(() => {
    const video = videoRef.current;
    const key = currentProgressKeyRef.current;
    if (!video || !key) return;

    const offset = seekOffsetRef.current;
    const position = video.currentTime + offset;
    const duration = (isFinite(video.duration) ? video.duration : 0) + offset;

    lastKnownPositionRef.current = position;
    lastKnownDurationRef.current = duration;

    if (position < 2 || duration === 0) return;

    const realMovieId = key.includes(':') ? key.split(':')[0] : key;
    const epId = currentEpisodeIdRef.current;

    if (position >= duration - 2) {
      removeFromStorage(key);
      saveToServer(realMovieId, epId, 100);
      return;
    }

    saveToStorage(key, position, duration);
    saveToServer(realMovieId, epId, (position / duration) * 100);
    window.dispatchEvent(new CustomEvent('progress-updated'));
  }, []);

  // ─── Save iframe/VidCore progress (wall-clock) ──────
  const saveIframeProgress = useCallback(() => {
    const start = iframeStartTimeRef.current;
    const key = currentProgressKeyRef.current;
    if (!start || !key) return;

    const elapsed = (Date.now() - start) / 1000;
    const dur = knownDurationRef.current || (isSeries ? 2700 : 7200);
    const position = Math.min(elapsed, dur);

    if (position < 5) return;

    const realMovieId = key.includes(':') ? key.split(':')[0] : key;
    const epId = currentEpisodeIdRef.current;

    if (position >= dur - 5) {
      removeFromStorage(key);
      saveToServer(realMovieId, epId, 100);
    } else {
      saveToStorage(key, position, dur);
      saveToServer(realMovieId, epId, (position / dur) * 100);
    }
    window.dispatchEvent(new CustomEvent('progress-updated'));
  }, [isSeries]);

  // ─── handleClose: save → pause → reset → close ────────
  // This is called by ALL close buttons and keyboard shortcuts.
  // It saves progress BEFORE calling the store's closePlayer.
  const handleClose = useCallback(() => {
    saveCurrentProgress();
    if (isIframeMode) saveIframeProgress();
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    if (progressSaveTimerRef.current) {
      clearInterval(progressSaveTimerRef.current);
      progressSaveTimerRef.current = null;
    }
    iframeStartTimeRef.current = null;
    currentVideoIdRef.current = '';
    setIsPlaying(false);
    setShowResumePrompt(false);
    setShowEndScreen(false);
    setShowNextUpPreview(false);
    showNextUpPreviewRef.current = false;
    setShowControls(true);
    setShowLoadingOverlay(false);
    setIsComingSoon(false);
    closePlayer();
  }, [closePlayer, saveCurrentProgress, saveIframeProgress, isIframeMode]);

  // ─── Load video source with optional start offset ──────
  const loadVideoSource = useCallback(
    (startOffset: number = 0) => {
      const video = videoRef.current;
      if (!video || !hasVideo) return;

      video.pause();
      if (progressSaveTimerRef.current) {
        clearInterval(progressSaveTimerRef.current);
        progressSaveTimerRef.current = null;
      }

      hasTriedNativeRef.current = false;
      hasTriedTranscodeRef.current = false;
      retryCountRef.current = 0;

      if (initialTranscode) {
        currentModeRef.current = 'transcode';
        hasTriedNativeRef.current = true;
      } else {
        currentModeRef.current = 'native';
      }

      if (currentModeRef.current === 'transcode' && startOffset > 0) {
        seekOffsetRef.current = startOffset;
        pendingSeekRef.current = 0;
      } else {
        seekOffsetRef.current = 0;
        pendingSeekRef.current = startOffset;
      }

      const url = buildUrl(currentModeRef.current, startOffset);
      video.src = url;
      video.volume = volume;
      video.load();

      const tryAutoPlay = () => {
        video.play().catch(() => {});
      };
      video.addEventListener('canplay', tryAutoPlay, { once: true });
      if (video.readyState >= 3) tryAutoPlay();
    },
    [hasVideo, initialTranscode, buildUrl, volume],
  );

  // ─── Video change detection (THE KEY EFFECT) ───────────
  // Only fires when isOpen is true and videoId changes.
  // Component persists — no unmount/remount cycle.
  useEffect(() => {
    if (!isOpen) return;

    const newVideoId = videoId || '';
    if (!newVideoId || !hasVideo) return;
    if (newVideoId === currentVideoIdRef.current) return;

    // ── Save old progress before switching ──
    if (currentVideoIdRef.current && videoRef.current) {
      const video = videoRef.current;
      const oldOffset = seekOffsetRef.current;
      const pos = video.currentTime + oldOffset;
      const dur = (isFinite(video.duration) ? video.duration : 0) + oldOffset;
      const oldKey = currentProgressKeyRef.current;
      const oldEpId = currentEpisodeIdRef.current;

      if (pos > 2 && dur > 0 && oldKey) {
        const realMovieId = oldKey.includes(':') ? oldKey.split(':')[0] : oldKey;
        if (pos >= dur - 2) {
          removeFromStorage(oldKey);
          saveToServer(realMovieId, oldEpId, 100);
        } else {
          saveToStorage(oldKey, pos, dur);
          saveToServer(realMovieId, oldEpId, (pos / dur) * 100);
        }
      }

      if (progressSaveTimerRef.current) {
        clearInterval(progressSaveTimerRef.current);
        progressSaveTimerRef.current = null;
      }
    }

    // ── Update tracking refs ──
    currentVideoIdRef.current = newVideoId;
    currentProgressKeyRef.current = progressKey;
    currentEpisodeIdRef.current = playingEpisode?.id || null;
    knownDurationRef.current = parseDurationToSeconds(
      playingEpisode?.duration || playingMovie?.duration,
    );

    // ── Reset state and check for saved progress ──
    queueMicrotask(() => {
      setIsPlaying(false);
      setShowEndScreen(false);
      setShowNextUpPreview(false);
      setVideoError(null);
      setNeedsFfmpeg(false);
      setIsTranscoding(false);
      autoAdvanceDisabledRef.current = false;
      showNextUpPreviewRef.current = false;
      setHasSubtitles(false);
      setSubtitlesOn(true);

      // Check localStorage for saved position (Resume)
      const progress = loadFromStorage(progressKey);
      if (
        progress &&
        progress.position > 30 &&
        isFinite(progress.duration) &&
        progress.duration > 0
      ) {
        setSavedProgress(progress);
        setShowResumePrompt(true);
        setShowLoadingOverlay(false);
      } else {
        setSavedProgress(null);
        setShowResumePrompt(false);
        setShowLoadingOverlay(true);
        loadVideoSource(0);
      }
    });
  }, [isOpen, videoId, progressKey, hasVideo, playingEpisode?.id, loadVideoSource]);

  // ─── Iframe/VidCore mode: init tracking + resume prompt ──
  useEffect(() => {
    if (!isOpen || !isIframeMode) return;

    const iframeKey = playingMovie?.id || '';
    if (!iframeKey) return;
    if (iframeKey === currentVideoIdRef.current) return;

    // Mark as current
    currentVideoIdRef.current = iframeKey;
    currentProgressKeyRef.current = progressKey;
    currentEpisodeIdRef.current = playingEpisode?.id || null;
    knownDurationRef.current = parseDurationToSeconds(
      playingEpisode?.duration || playingMovie?.duration,
    );

    // Check for saved progress and show resume prompt
    const progress = loadFromStorage(progressKey);
    queueMicrotask(() => {
      setIsComingSoon(false);
      if (
        progress &&
        progress.position > 30 &&
        isFinite(progress.duration) &&
        progress.duration > 0
      ) {
        setSavedProgress(progress);
        setShowResumePrompt(true);
        setShowLoadingOverlay(false);
      } else {
        // No saved progress — show loading overlay, then start wall-clock timer
        iframeStartTimeRef.current = Date.now();
        setSavedProgress(null);
        setShowResumePrompt(false);
        setShowLoadingOverlay(true);
      }
    });
  }, [isOpen, isIframeMode, playingMovie?.id, progressKey, playingEpisode?.id, playingEpisode?.duration, playingMovie?.duration]);

  // ─── Periodic save for iframe mode (every 30s) ─────────
  useEffect(() => {
    if (!isOpen || !isIframeMode || !iframeStartTimeRef.current) return;

    const timer = setInterval(() => {
      saveIframeProgress();
    }, 30000);

    return () => clearInterval(timer);
  }, [isOpen, isIframeMode, saveIframeProgress]);

  // ─── Auto-dismiss LoadingOverlay for iframe mode ─────────
  // Since we can't detect iframe load (cross-domain), use a fixed delay.
  const iframeLoadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (iframeLoadingTimerRef.current) {
      clearTimeout(iframeLoadingTimerRef.current);
      iframeLoadingTimerRef.current = null;
    }
    if (!isOpen || !isIframeMode || !showLoadingOverlay) return;
    iframeLoadingTimerRef.current = setTimeout(() => {
      setShowLoadingOverlay(false);
    }, 2500);
    return () => {
      if (iframeLoadingTimerRef.current) {
        clearTimeout(iframeLoadingTimerRef.current);
        iframeLoadingTimerRef.current = null;
      }
    };
  }, [isOpen, isIframeMode, showLoadingOverlay]);

  // ─── Fetch episodes for series ─────────────────────────
  useEffect(() => {
    if (!isSeries || !playingMovie?.id) return;
    fetch(`/api/movies/${playingMovie.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.episodes) setEpisodes(data.episodes);
      })
      .catch(() => {});
  }, [isSeries, playingMovie?.id]);

  // ─── Body overflow lock (only when open) ───────────────
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // ─── rAF: ALL visual updates via direct DOM ────────────
  // Runs continuously but only updates DOM when isOpen.
  // This NEVER stops — the timer is always alive.
  useEffect(() => {
    let rafId: number;
    const tick = () => {
      if (isOpenRef.current) {
        const video = videoRef.current;
        if (video && video.duration > 0 && pendingSeekRef.current <= 0) {
          const offset = seekOffsetRef.current;
          const realCurrent = offset + video.currentTime;
          const realDuration = offset + video.duration;
          const pct = realDuration > 0 ? (realCurrent / realDuration) * 100 : 0;

          if (progressFillRef.current)
            progressFillRef.current.style.width = `${pct}%`;
          if (progressThumbRef.current)
            progressThumbRef.current.style.left = `calc(${pct}% - 6px)`;
          if (timeDisplayRef.current) {
            timeDisplayRef.current.textContent = `${formatTime(realCurrent)} / ${formatTime(realDuration)}`;
          }
          if (video.buffered.length > 0 && bufferedFillRef.current) {
            const bufEnd =
              offset + video.buffered.end(video.buffered.length - 1);
            bufferedFillRef.current.style.width = `${
              realDuration > 0 ? (bufEnd / realDuration) * 100 : 0
            }%`;
          }
          if (
            seekInputRef.current &&
            document.activeElement !== seekInputRef.current
          ) {
            seekInputRef.current.max = String(realDuration);
            seekInputRef.current.value = String(realCurrent);
          }

          // Next Up — uses knownDurationRef (from DB) so timing is correct
          // even when video.duration is wrong (transcoded MKV/AVI).
          const knownDur = knownDurationRef.current;
          if (showNextUpPreviewRef.current && knownDur > 0) {
            const nRem = Math.max(0, Math.ceil(knownDur - realCurrent));
            if (nextUpCountdownRef.current)
              nextUpCountdownRef.current.textContent = `Siguiente en ${nRem}s`;
            if (nextUpProgressRef.current)
              nextUpProgressRef.current.style.width = `${Math.max(0, 100 - (nRem / 45) * 100)}%`;
          }

          // Next Up detection (one-time trigger)
          const ep = nextEpisodeRef.current;
          if (
            ep &&
            !autoAdvanceDisabledRef.current &&
            knownDur > 60 &&
            realCurrent > 0
          ) {
            const nRem = knownDur - realCurrent;
            if (nRem <= 45 && nRem > 0 && !showNextUpPreviewRef.current) {
              showNextUpPreviewRef.current = true;
              setShowNextUpPreview(true);
            }
          }

          // Cache position for cleanup
          lastKnownPositionRef.current = realCurrent;
          lastKnownDurationRef.current = realDuration;
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []); // Empty deps — loop runs forever, reads isOpenRef

  // ─── beforeunload: save progress when leaving page ────
  useEffect(() => {
    const handleBeforeUnload = () => {
      saveCurrentProgress();
      if (isIframeMode) saveIframeProgress();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [saveCurrentProgress, saveIframeProgress, isIframeMode]);

  // ─── Subtitle detection ────────────────────────────────
  // HEAD request to check if subtitle file exists for current video.
  useEffect(() => {
    if (!isOpen || !videoId) return;
    fetch(`/api/subtitle/${videoId}`, { method: 'HEAD' })
      .then((r) => setHasSubtitles(r.ok))
      .catch(() => setHasSubtitles(false));
  }, [isOpen, videoId]);

  // ─── Error handling ────────────────────────────────────

  const abortStream = useCallback((video: HTMLVideoElement) => {
    try {
      video.pause();
      video.removeAttribute('src');
      video.load();
    } catch {
      /* ignore */
    }
    if (progressSaveTimerRef.current) {
      clearInterval(progressSaveTimerRef.current);
      progressSaveTimerRef.current = null;
    }
  }, []);

  const switchToTranscode = useCallback(() => {
    if (hasTriedTranscodeRef.current) return;
    const video = videoRef.current;
    if (!video) return;

    abortStream(video);
    hasTriedTranscodeRef.current = true;
    currentModeRef.current = 'transcode';
    retryCountRef.current++;

    const url = buildUrl('transcode');
    video.src = url;
    setIsTranscoding(true);
    setVideoError(null);
    setNeedsFfmpeg(false);
    video.load();
    video.play().catch(() => {});
  }, [buildUrl, abortStream]);

  const handleVideoError = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const vError = video.error;
    const errorCode = vError?.code || 0;
    if (errorCode === 1) return;

    setShowLoadingOverlay(false);

    if (errorCode === 2) {
      setErrorType('network');
      setVideoError('Error de red. Verifica que el archivo sea accesible.');
      return;
    }

    if (errorCode === 3 || errorCode === 4) {
      if (
        currentModeRef.current === 'native' &&
        !hasTriedTranscodeRef.current
      ) {
        switchToTranscode();
        return;
      }
      setErrorType('format');
      setVideoError(
        'No se pudo reproducir el video. El formato o codec no es compatible.',
      );
      return;
    }

    const currentUrl = video.src;
    if (currentUrl) {
      fetch(currentUrl, { method: 'HEAD' })
        .then((r) => {
          if (r.status === 422) return r.json();
          return null;
        })
        .then((data) => {
          if (data?.needsFfmpeg) {
            setErrorType('ffmpeg');
            setNeedsFfmpeg(true);
            setVideoError(
              `Formato .${(data.format || fileExt).replace('.', '').toUpperCase()} requiere ffmpeg.`,
            );
          } else if (
            currentModeRef.current === 'native' &&
            !hasTriedTranscodeRef.current
          ) {
            switchToTranscode();
          } else {
            setErrorType('format');
            setVideoError('No se pudo cargar el video.');
          }
        })
        .catch(() => {
          setErrorType('network');
          setVideoError(
            'No se pudo cargar el video. Verifica que el archivo exista.',
          );
        });
    }
  }, [fileExt, switchToTranscode]);

  const handleRetry = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    abortStream(video);
    hasTriedNativeRef.current = true;
    currentModeRef.current = 'transcode';
    retryCountRef.current++;
    const url = buildUrl('transcode');
    video.src = url;
    setVideoError(null);
    setNeedsFfmpeg(false);
    setIsTranscoding(true);
    video.load();
    video.play().catch(() => {});
  }, [buildUrl, abortStream]);

  // ─── Resume callbacks ──────────────────────────────────

  const handleResumeFromSaved = useCallback(() => {
    if (isIframeMode) {
      // Set start time so wall-clock elapsed ≈ saved position
      if (savedProgress) {
        iframeStartTimeRef.current = Date.now() - savedProgress.position * 1000;
      }
      setShowLoadingOverlay(true);
    } else if (savedProgress) {
      setShowLoadingOverlay(true);
      loadVideoSource(Math.floor(savedProgress.position));
    }
    setShowResumePrompt(false);
    setSavedProgress(null);
  }, [savedProgress, loadVideoSource, isIframeMode]);

  const handleStartFromBeginning = useCallback(() => {
    if (isIframeMode) {
      iframeStartTimeRef.current = Date.now();
      setShowLoadingOverlay(true);
    } else {
      setShowLoadingOverlay(true);
      loadVideoSource(0);
    }
    setShowResumePrompt(false);
    setSavedProgress(null);
  }, [loadVideoSource, isIframeMode]);

  // ─── Next Up / End Screen ──────────────────────────────

  const playNextEpisodeNow = useCallback(() => {
    const ep = nextEpisodeRef.current;
    if (!ep || !playingMovie) return;
    setShowEndScreen(false);
    setShowNextUpPreview(false);
    autoAdvanceDisabledRef.current = false;
    showNextUpPreviewRef.current = false;
    openPlayer(playingMovie, ep);
  }, [openPlayer, playingMovie]);

  const dismissNextUpPreview = useCallback(() => {
    autoAdvanceDisabledRef.current = true;
    showNextUpPreviewRef.current = false;
    setShowNextUpPreview(false);
  }, []);

  const replayEpisode = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.currentTime = 0;
      video.play().catch(() => {});
      setShowEndScreen(false);
      setIsPlaying(true);
    }
  }, []);

  // ─── Video event handlers ──────────────────────────────

  const handleVideoPlay = useCallback(() => {
    setIsPlaying(true);
    setVideoError(null);
    setIsTranscoding(false);
    if (progressSaveTimerRef.current)
      clearInterval(progressSaveTimerRef.current);
    progressSaveTimerRef.current = setInterval(saveCurrentProgress, 5000);
  }, [saveCurrentProgress]);

  const handleVideoPause = useCallback(() => {
    setIsPlaying(false);
    if (progressSaveTimerRef.current) {
      clearInterval(progressSaveTimerRef.current);
      progressSaveTimerRef.current = null;
    }
    saveCurrentProgress();
  }, [saveCurrentProgress]);

  const handleVideoEnded = useCallback(() => {
    setIsPlaying(false);
    showNextUpPreviewRef.current = false;
    setShowNextUpPreview(false);
    if (progressSaveTimerRef.current) {
      clearInterval(progressSaveTimerRef.current);
      progressSaveTimerRef.current = null;
    }
    const key = currentProgressKeyRef.current;
    const epId = currentEpisodeIdRef.current;
    if (key) {
      const realMovieId = key.includes(':') ? key.split(':')[0] : key;
      removeFromStorage(key);
      saveToServer(realMovieId, epId, 100);
    }
    const ep = nextEpisodeRef.current;
    if (ep && !autoAdvanceDisabledRef.current && playingMovie) {
      openPlayer(playingMovie, ep);
    } else if (ep) {
      setShowEndScreen(true);
    }
  }, [playingMovie, openPlayer]);

  const handleVideoSeeked = useCallback(() => {
    if (pendingSeekRef.current > 0) {
      pendingSeekRef.current = 0;
    }
    saveCurrentProgress();
  }, [saveCurrentProgress]);

  const handleLoadedMetadata = useCallback(() => {
    setVideoError(null);
    const video = videoRef.current;
    if (video) {
      video.volume = volume;
      // For native formats, seek to resume position after metadata loads
      if (pendingSeekRef.current > 0) {
        video.currentTime = pendingSeekRef.current;
      }
    }
  }, [volume]);

  // ─── Controls auto-hide ────────────────────────────────

  const resetControlsTimeout = useCallback(() => {
    if (!isOpenRef.current) return;
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isOpenRef.current && isPlaying) setShowControls(false);
    }, 3000);
  }, [isPlaying]);

  // ─── User interactions ─────────────────────────────────

  const togglePlay = () => {
    if (!videoRef.current || !hasVideo) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const handleSkip = (seconds: number) => {
    if (videoRef.current) videoRef.current.currentTime += seconds;
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
      setIsMuted(!isMuted);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.volume = vol;
      setVolume(vol);
      setIsMuted(vol === 0);
    }
  };

  const toggleSubtitles = () => {
    const video = videoRef.current;
    if (!video || video.textTracks.length === 0) return;
    const track = video.textTracks[0];
    const next = track.mode === 'showing' ? 'hidden' : 'showing';
    track.mode = next;
    setSubtitlesOn(next === 'showing');
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const realTime = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = realTime - seekOffsetRef.current;
    }
  };

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch {
      /* ignore */
    }
  };

  // ─── Fullscreen change listener ────────────────────────

  useEffect(() => {
    const handleFsChange = () =>
      setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFsChange);
    return () =>
      document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  // ─── Keyboard shortcuts ────────────────────────────────
  // Only active when player is open

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpenRef.current) return;
      if (isIframeMode) return; // VidCore handles its own keyboard events
      if (showResumePrompt) return;
      if (showEndScreen && e.key === 'Escape') {
        e.preventDefault();
        handleClose();
        return;
      }
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handleSkip(-10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleSkip(10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (videoRef.current) {
            const v = Math.min(1, videoRef.current.volume + 0.1);
            videoRef.current.volume = v;
            setVolume(v);
          }
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (videoRef.current) {
            const v = Math.max(0, videoRef.current.volume - 0.1);
            videoRef.current.volume = v;
            setVolume(v);
          }
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        case 'Escape':
          if (!isFullscreen) handleClose();
          break;
      }
      resetControlsTimeout();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    togglePlay,
    handleSkip,
    toggleFullscreen,
    toggleMute,
    handleClose,
    isFullscreen,
    showEndScreen,
    showResumePrompt,
    resetControlsTimeout,
    isIframeMode,
  ]);

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════
  // The container is ALWAYS in the DOM. When closed, it's
  // invisible and non-interactive (invisible + pointer-events-none).
  // The <video> element is ALWAYS rendered.

  return (
    <div
      ref={containerRef}
      className={`fixed inset-0 z-[100] bg-black select-none transition-opacity duration-200 ${
        isOpen ? 'opacity-100' : 'opacity-0 invisible pointer-events-none'
      }`}
      style={{ cursor: showControls ? 'default' : 'none' }}
      onMouseMove={resetControlsTimeout}
      onClick={(e) => {
        if (
          (e.target as HTMLElement).tagName !== 'INPUT' &&
          (e.target as HTMLElement).tagName !== 'BUTTON'
        ) {
          resetControlsTimeout();
        }
      }}
    >
      {/* ── Transcoding indicator ── */}
      {hasVideo && isTranscoding && !videoError && !needsFfmpeg && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 pointer-events-none">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-10 w-10 text-amber-400 animate-spin" />
            <p className="text-white text-sm font-medium">
              Transcodificando video
            </p>
            <p className="text-white/50 text-xs">
              Convirtiendo {fileExt.toUpperCase()} a formato compatible...
            </p>
          </div>
        </div>
      )}

      {/* ── FFmpeg missing error ── */}
      {needsFfmpeg && (
        <div className="absolute inset-0 flex items-center justify-center z-10 bg-black/60">
          <div className="bg-[#1a1a1a] border border-red-800 rounded-xl px-8 py-6 text-center max-w-md mx-4">
            <AlertTriangle className="h-10 w-10 text-red-400 mx-auto mb-3" />
            <p className="text-white text-sm font-medium mb-2">
              FFmpeg no encontrado
            </p>
            <p className="text-gray-400 text-xs mb-4">
              Los archivos .{fileExt.toUpperCase()} necesitan ffmpeg para
              transcodificar al vuelo.
            </p>
            <a
              href="https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 bg-[#e50914] hover:bg-[#c40812] text-white text-sm px-4 py-2 rounded-lg transition-colors"
            >
              Descargar FFmpeg (Windows)
            </a>
            <p className="text-gray-600 text-xs mt-3">
              Instala y agrega ffmpeg.exe al PATH del sistema, luego reinicia
              StreamVault.
            </p>
          </div>
        </div>
      )}

      {/* ── Video load error ── */}
      {videoError && !needsFfmpeg && (
        <div className="absolute inset-0 flex items-center justify-center z-10 bg-black/70">
          <div className="bg-[#1a1a1a] border border-white/10 rounded-xl px-8 py-6 text-center max-w-md mx-4">
            <p className="text-red-300 text-sm font-medium mb-1">
              Error de reproducción
            </p>
            <p className="text-gray-400 text-xs mb-5">{videoError}</p>
            <div className="flex gap-3 justify-center">
              {errorType !== 'rateLimit' && (
                <Button
                  className="bg-[#e50914] hover:bg-[#c40812] text-white"
                  onClick={handleRetry}
                >
                  <Zap className="h-4 w-4 mr-2" />
                  Reintentar
                </Button>
              )}
              <Button
                variant="outline"
                className="border-white/20 text-white hover:bg-white/10"
                onClick={handleClose}
              >
                <X className="h-4 w-4 mr-2" />
                Cerrar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Resume Prompt (z-20, shown BEFORE video loads) ── */}
      <AnimatePresence>
        {showResumePrompt && savedProgress && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 flex items-center justify-center z-[20] bg-black/50 backdrop-blur-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-[#181818] border border-white/15 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
              <p className="text-white font-medium text-center mb-1">
                ¿Continuar viendo?
              </p>
              <p className="text-gray-400 text-xs text-center mb-5">
                Te quedaste en {formatTime(savedProgress.position)} de{' '}
                {formatTime(savedProgress.duration)}
              </p>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1 bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStartFromBeginning();
                  }}
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Desde el inicio
                </Button>
                <Button
                  className="flex-1 bg-[#e50914] hover:bg-[#c40812] text-white"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleResumeFromSaved();
                  }}
                >
                  <Play className="h-4 w-4 mr-2 fill-white" />
                  Continuar
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Video Element — ALWAYS RENDERED, never unmounted ── */}
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        onPlay={handleVideoPlay}
        onPause={handleVideoPause}
        onEnded={handleVideoEnded}
        onSeeked={handleVideoSeeked}
        onLoadedMetadata={handleLoadedMetadata}
        onCanPlay={() => {
          setVideoError(null);
          setNeedsFfmpeg(false);
          setIsTranscoding(false);
          setShowLoadingOverlay(false);
        }}
        onError={handleVideoError}
        playsInline
      >
        {subtitleUrl && (
          <track
            kind="subtitles"
            src={subtitleUrl}
            srcLang="es"
            label="Español"
            default
            key={`sub-${videoId}`}
          />
        )}
      </video>

      {/* ── Loading Overlay (dulo.tv style) ── */}
      <AnimatePresence>
        {isOpen && showLoadingOverlay && playingMovie && (
          <LoadingOverlay
            title={playingMovie.title}
            subtitle={
              playingEpisode
                ? `T${playingEpisode.seasonNumber}:E${playingEpisode.episodeNumber} — ${playingEpisode.title}`
                : undefined
            }
            statusText="Cargando"
            onCancel={handleClose}
            visible={showLoadingOverlay}
          />
        )}
      </AnimatePresence>

      {/* ── No video placeholder (no local file AND no imdbId) ── */}
      {isOpen && !hasVideo && !isIframeMode && playingMovie && (
        <div className="absolute inset-0 flex items-center justify-center">
          <img
            src={playingMovie.backdropImage}
            alt=""
            className="w-full h-full object-cover opacity-30 blur-sm"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative z-10 text-center px-8">
            <Play className="h-16 w-16 text-white/40 mx-auto mb-4" />
            <p className="text-white/60 text-lg">
              {isSeries && playingEpisode
                ? `${playingMovie.title} - ${playingEpisode.title}`
                : playingMovie.title}
            </p>
            <p className="text-white/30 text-sm mt-2">
              Sin video disponible. Asigna un IMDb ID para streaming externo.
            </p>
          </div>
        </div>
      )}

      {/* ── Próximamente (source not found on VidCore) ── */}
      <AnimatePresence>
        {isOpen && isIframeMode && isComingSoon && playingMovie && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-0 z-20 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Backdrop image */}
            <img
              src={playingMovie.backdropImage}
              alt=""
              className="absolute inset-0 w-full h-full object-cover opacity-20 blur-md"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
            <div className="absolute inset-0 bg-black/70" />

            {/* Top bar */}
            <div
              className="relative z-10 flex items-center px-4 md:px-8 pt-4 md:pt-6"
              style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
            >
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/10 h-9 w-9"
                onClick={handleClose}
                aria-label="Volver"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </div>

            {/* Content */}
            <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-8">
              <div className="flex flex-col items-center text-center max-w-md">
                {/* Cover image */}
                <div className="w-32 h-48 md:w-40 md:h-60 rounded-xl overflow-hidden mb-6 shadow-2xl border border-white/10">
                  <img
                    src={playingMovie.coverImage}
                    alt={playingMovie.title}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>

                <p className="text-[#e50914] text-xs md:text-sm font-bold uppercase tracking-[0.2em] mb-3">
                  Próximamente
                </p>

                <h2 className="text-white text-xl md:text-3xl font-bold mb-2">
                  {playingMovie.title}
                </h2>

                <p className="text-white/40 text-sm mb-1">
                  {playingMovie.year}
                  {playingMovie.genre && ` · ${playingMovie.genre}`}
                  {playingMovie.duration && ` · ${playingMovie.duration}`}
                </p>

                {playingEpisode && (
                  <p className="text-white/30 text-xs mt-1">
                    T{playingEpisode.seasonNumber}:E{playingEpisode.episodeNumber} — {playingEpisode.title}
                  </p>
                )}

                <p className="text-white/50 text-sm mt-4 max-w-sm">
                  Este título aún no está disponible en fuentes externas.
                </p>

                <Button
                  variant="outline"
                  className="mt-8 border-white/20 text-white hover:bg-white/10"
                  onClick={handleClose}
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Volver
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── VidCore iframe fallback (no local video, but has imdbId) ── */}
      {isOpen && isIframeMode && vidcoreUrl && !showResumePrompt && !isComingSoon && (
        <iframe
          key={vidcoreUrl}
          src={vidcoreUrl}
          className="absolute inset-0 w-full h-full border-0"
          allowFullScreen
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          style={{ zIndex: 1 }}
        />
      )}

      {/* ── VidCore floating top bar (above iframe, doesn't block interaction) ── */}
      {isOpen && isIframeMode && !showLoadingOverlay && !showResumePrompt && (
        <div
          className="absolute top-14 left-0 right-0 z-[5] pointer-events-none"
          style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
        >
          <div className="flex items-center justify-between px-4 md:px-8">
            <div className="flex items-center gap-3 pointer-events-auto bg-black/60 backdrop-blur-md rounded-lg px-3 py-2 hover:bg-black/80 transition-colors">
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/10 h-8 w-8"
                onClick={handleClose}
                aria-label="Volver"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-0 border-l border-white/20 pl-3">
                <TruncatedText text={playingMovie?.title || ''} as="h2" className="text-white text-sm font-medium max-w-[40vw] md:max-w-[50vw]" />
                {playingEpisode && (
                  <TruncatedText text={`T${playingEpisode.seasonNumber}:E${playingEpisode.episodeNumber} - ${playingEpisode.title}`} as="p" className="text-gray-400 text-[11px]" />
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 pointer-events-auto">
              {isSeries && episodes.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={`text-white hover:bg-white/10 h-8 w-8 bg-black/60 backdrop-blur-md rounded-lg hover:bg-black/80 transition-colors ${showEpisodeList ? 'bg-white/20' : ''}`}
                  onClick={() => setShowEpisodeList(!showEpisodeList)}
                  aria-label="Lista de episodios"
                >
                  <List className="h-4 w-4" />
                </Button>
              )}
              <span className="bg-black/60 backdrop-blur-md rounded-lg px-2.5 py-1.5 text-[10px] text-gray-400 font-medium tracking-wider uppercase">
                VidCore
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/10 h-8 w-8 bg-black/60 backdrop-blur-md rounded-lg hover:bg-black/80 transition-colors"
                onClick={handleClose}
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── VidCore episode list sidebar ── */}
      <AnimatePresence>
        {isOpen && isIframeMode && showEpisodeList && isSeries && (
          <>
            <div
              className="absolute inset-0 z-[6]"
              onClick={() => setShowEpisodeList(false)}
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{
                type: 'spring',
                damping: 25,
                stiffness: 300,
              }}
              className="absolute top-0 right-0 bottom-0 w-80 max-w-[85vw] bg-[#181818]/95 backdrop-blur-md border-l border-white/10 overflow-y-auto no-scrollbar z-[7]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-white font-semibold text-lg">
                    Episodios
                  </h3>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-gray-400 hover:text-white h-8 w-8"
                    onClick={() => setShowEpisodeList(false)}
                    aria-label="Cerrar lista"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="space-y-1">
                  {episodes.map((ep, idx) => {
                    const isCurrent =
                      playingEpisode &&
                      ep.seasonNumber ===
                        playingEpisode.seasonNumber &&
                      ep.episodeNumber ===
                        playingEpisode.episodeNumber;
                    return (
                      <button
                        key={ep.id}
                        className={`w-full flex items-start gap-3 p-3 rounded-lg transition-colors text-left group ${isCurrent ? 'bg-white/15' : 'hover:bg-white/10'}`}
                        onClick={() => {
                          if (playingMovie) {
                            openPlayer(playingMovie, ep);
                            setShowEpisodeList(false);
                          }
                        }}
                      >
                        <span className="text-lg font-bold text-gray-500 w-7 text-center shrink-0 pt-0.5">
                          {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <TruncatedText text={ep.title} as="p" className={`text-sm font-medium ${isCurrent ? 'text-[#e50914]' : 'text-white'}`} />
                          <p className="text-xs text-gray-500 mt-0.5">
                            T{ep.seasonNumber}:E{ep.episodeNumber}
                            {ep.duration && ` · ${ep.duration}`}
                          </p>
                          {ep.description && (
                            <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                              {ep.description}
                            </p>
                          )}
                        </div>
                        {isCurrent && (
                          <div className="shrink-0 mt-1">
                            <div className="w-2 h-2 rounded-full bg-[#e50914] animate-pulse" />
                          </div>
                        )}
                        {!isCurrent && (
                          <ChevronRight className="h-4 w-4 text-gray-600 group-hover:text-white shrink-0 mt-1 transition-colors" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* CONTROLS OVERLAY                                      */}
      {/* ═══════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showControls &&
          !showEndScreen &&
          !showNextUpPreview &&
          !showResumePrompt &&
          !isIframeMode && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 z-10"
            >
              {/* Top Bar */}
              <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/80 via-black/40 to-transparent px-4 md:px-8 pt-3 pb-12">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-white hover:bg-white/10 h-9 w-9"
                      onClick={handleClose}
                      aria-label="Volver"
                    >
                      <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div className="min-w-0">
                      <TruncatedText text={playingMovie?.title || ''} as="h2" className="text-white text-sm md:text-base font-medium max-w-[50vw] md:max-w-[60vw]" />
                      {playingEpisode && (
                        <TruncatedText text={`T${playingEpisode.seasonNumber}:E${playingEpisode.episodeNumber} - ${playingEpisode.title}`} as="p" className="text-gray-400 text-xs" />
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isSeries && episodes.length > 0 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`text-white hover:bg-white/10 h-9 w-9 ${showEpisodeList ? 'bg-white/20' : ''}`}
                        onClick={() => setShowEpisodeList(!showEpisodeList)}
                        aria-label="Lista de episodios"
                      >
                        <List className="h-5 w-5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-white hover:bg-white/10 h-9 w-9"
                      onClick={handleClose}
                      aria-label="Cerrar"
                    >
                      <X className="h-5 w-5" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Center Play Button */}
              {!isPlaying && hasVideo && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <button
                    className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-sm flex items-center justify-center transition-all pointer-events-auto"
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePlay();
                    }}
                    aria-label="Reproducir"
                  >
                    <Play className="h-7 w-7 md:h-9 md:w-9 text-white ml-1 fill-white" />
                  </button>
                </div>
              )}

              {/* Bottom Controls */}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-4 md:px-8 pb-4 pt-16">
                {/* Progress Bar */}
                <div className="group/progress mb-3 relative h-6 flex items-center">
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-white/20 rounded-full overflow-hidden">
                    <div
                      ref={bufferedFillRef}
                      className="h-full bg-white/30 rounded-full"
                      style={{ width: 0 }}
                    />
                  </div>
                  <input
                    ref={seekInputRef}
                    type="range"
                    min={0}
                    step={0.1}
                    defaultValue={0}
                    onChange={handleSeek}
                    className="absolute left-0 w-full h-1 opacity-0 cursor-pointer z-10"
                    style={{ height: '20px', marginTop: '-8px' }}
                  />
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-white/20 rounded-full overflow-hidden pointer-events-none">
                    <div
                      ref={progressFillRef}
                      className="h-full bg-[#e50914] rounded-full"
                      style={{ width: 0 }}
                    />
                    <div
                      ref={progressThumbRef}
                      className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-[#e50914] rounded-full shadow-lg opacity-0 group-hover/progress:opacity-100 transition-opacity"
                      style={{ left: '-6px' }}
                    />
                  </div>
                </div>

                {/* Control Buttons */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 md:gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-white hover:bg-white/10 h-9 w-9"
                      onClick={() => handleSkip(-10)}
                      aria-label="Retroceder 10s"
                    >
                      <SkipBack className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-white hover:bg-white/10 h-10 w-10"
                      onClick={togglePlay}
                      aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
                    >
                      {isPlaying ? (
                        <Pause className="h-5 w-5 fill-white" />
                      ) : (
                        <Play className="h-5 w-5 ml-0.5 fill-white" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-white hover:bg-white/10 h-9 w-9"
                      onClick={() => handleSkip(10)}
                      aria-label="Adelantar 10s"
                    >
                      <SkipForward className="h-4 w-4" />
                    </Button>

                    <div className="hidden sm:flex items-center gap-1 ml-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-white hover:bg-white/10 h-9 w-9"
                        onClick={toggleMute}
                        aria-label={isMuted ? 'Activar sonido' : 'Silenciar'}
                      >
                        {isMuted || volume === 0 ? (
                          <VolumeX className="h-4 w-4" />
                        ) : (
                          <Volume2 className="h-4 w-4" />
                        )}
                      </Button>
                      <div className="relative w-20 h-6 flex items-center">
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={isMuted ? 0 : volume}
                          onChange={handleVolumeChange}
                          className="absolute w-full h-1 accent-white cursor-pointer"
                        />
                      </div>
                    </div>

                    {hasSubtitles && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-white hover:bg-white/10 h-9 w-9"
                        onClick={toggleSubtitles}
                        aria-label={subtitlesOn ? 'Ocultar subtítulos' : 'Mostrar subtítulos'}
                      >
                        <span className={`text-[10px] font-bold tracking-wide ${subtitlesOn ? 'text-[#e50914]' : 'text-white/40'}`}>
                          CC
                        </span>
                      </Button>
                    )}

                    <span
                      ref={timeDisplayRef}
                      className="text-white/70 text-xs ml-3 tabular-nums"
                    >
                      0:00 / 0:00
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    {nextEpisode && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-white hover:bg-white/10 h-9 px-2 gap-1 text-xs"
                        onClick={playNextEpisodeNow}
                      >
                        <SkipForward className="h-4 w-4" />
                        <span className="hidden md:inline">Siguiente</span>
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-white hover:bg-white/10 h-9 w-9"
                      onClick={toggleFullscreen}
                      aria-label={
                        isFullscreen
                          ? 'Salir de pantalla completa'
                          : 'Pantalla completa'
                      }
                    >
                      {isFullscreen ? (
                        <Minimize className="h-4 w-4" />
                      ) : (
                        <Maximize className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {/* ── Episode List Sidebar ── */}
              {showEpisodeList && isSeries && (
                <>
                  <div
                    className="absolute inset-0 z-10"
                    onClick={() => setShowEpisodeList(false)}
                  />
                  <motion.div
                    initial={{ x: '100%' }}
                    animate={{ x: 0 }}
                    exit={{ x: '100%' }}
                    transition={{
                      type: 'spring',
                      damping: 25,
                      stiffness: 300,
                    }}
                    className="absolute top-0 right-0 bottom-0 w-80 max-w-[85vw] bg-[#181818]/95 backdrop-blur-md border-l border-white/10 overflow-y-auto no-scrollbar z-20"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-white font-semibold text-lg">
                          Episodios
                        </h3>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-gray-400 hover:text-white h-8 w-8"
                          onClick={() => setShowEpisodeList(false)}
                          aria-label="Cerrar lista"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="space-y-1">
                        {episodes.map((ep, idx) => {
                          const isCurrent =
                            playingEpisode &&
                            ep.seasonNumber ===
                              playingEpisode.seasonNumber &&
                            ep.episodeNumber ===
                              playingEpisode.episodeNumber;
                          return (
                            <button
                              key={ep.id}
                              className={`w-full flex items-start gap-3 p-3 rounded-lg transition-colors text-left group ${isCurrent ? 'bg-white/15' : 'hover:bg-white/10'}`}
                              onClick={() => {
                                if (playingMovie) {
                                  openPlayer(playingMovie, ep);
                                  setShowEpisodeList(false);
                                }
                              }}
                            >
                              <span className="text-lg font-bold text-gray-500 w-7 text-center shrink-0 pt-0.5">
                                {idx + 1}
                              </span>
                              <div className="flex-1 min-w-0">
                                <TruncatedText text={ep.title} as="p" className={`text-sm font-medium ${isCurrent ? 'text-[#e50914]' : 'text-white'}`} />
                                <p className="text-xs text-gray-500 mt-0.5">
                                  T{ep.seasonNumber}:E{ep.episodeNumber}
                                  {ep.duration && ` · ${ep.duration}`}
                                </p>
                                {ep.description && (
                                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                                    {ep.description}
                                  </p>
                                )}
                              </div>
                              {isCurrent && (
                                <div className="shrink-0 mt-1">
                                  <div className="w-2 h-2 rounded-full bg-[#e50914] animate-pulse" />
                                </div>
                              )}
                              {!isCurrent && (
                                <ChevronRight className="h-4 w-4 text-gray-600 group-hover:text-white shrink-0 mt-1 transition-colors" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </motion.div>
                </>
              )}
            </motion.div>
          )}
      </AnimatePresence>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* NEXT UP PREVIEW (60s before end)                     */}
      {/* ═══════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showNextUpPreview && nextEpisode && isPlaying && (
          <motion.div
            initial={{ opacity: 0, x: 40, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="absolute right-3 md:right-6 bottom-24 md:bottom-28 w-72 md:w-80 z-30 pointer-events-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative rounded-2xl border border-white/[0.06] bg-black/85 backdrop-blur-xl shadow-2xl overflow-hidden">
              <div className="h-1 bg-white/5">
                <div
                  ref={nextUpProgressRef}
                  className="h-full bg-[#e50914] transition-all duration-1000 ease-linear"
                  style={{ width: '0%' }}
                />
              </div>
              <div className="p-3 flex gap-3">
                <div
                  className="relative w-24 md:w-28 shrink-0 aspect-video rounded-lg overflow-hidden bg-white/5 cursor-pointer"
                  onClick={playNextEpisodeNow}
                >
                  {nextEpisode.stillImage ? (
                    <img
                      src={nextEpisode.stillImage}
                      alt={nextEpisode.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Play className="h-6 w-6 text-white/30" />
                    </div>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/50 transition-colors">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e50914]/90 shadow-lg">
                      <Play className="h-4 w-4 text-white fill-white ml-0.5" />
                    </div>
                  </div>
                </div>
                <div className="flex flex-col justify-between min-w-0 flex-1 py-0.5">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-[#e50914] flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      <span ref={nextUpCountdownRef}>
                        Siguiente en 60s
                      </span>
                    </p>
                    <p className="text-xs text-white/50 mt-0.5">
                      T{nextEpisode.seasonNumber}:E
                      {nextEpisode.episodeNumber}
                    </p>
                    <TruncatedText text={nextEpisode.title} as="p" className="text-sm font-semibold text-white mt-0.5" />
                  </div>
                  <div className="flex items-center gap-1.5 mt-2">
                    <button
                      className="flex items-center gap-1.5 rounded-lg bg-[#e50914] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#f40612] active:brightness-90 transition-all"
                      onClick={playNextEpisodeNow}
                    >
                      <Play className="h-3 w-3 fill-white" />
                      Reproducir
                    </button>
                    <button
                      className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-white/50 hover:text-white/80 hover:bg-white/10 transition-colors"
                      onClick={dismissNextUpPreview}
                      aria-label="Cancelar auto-avance"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* END SCREEN                                            */}
      {/* ═══════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showEndScreen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-0 z-30 flex flex-col bg-black/95"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="shrink-0 px-4 md:px-8 pt-4 md:pt-6 pb-3"
              style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium uppercase tracking-widest text-white/50 mb-1">
                    Acabas de ver
                  </p>
                  <TruncatedText text={playingMovie?.title || ''} as="h2" className="text-lg md:text-xl font-bold text-white" />
                  {playingEpisode && (
                    <TruncatedText text={`T${playingEpisode.seasonNumber}:E${playingEpisode.episodeNumber} - ${playingEpisode.title}`} as="p" className="text-gray-400 text-sm" />
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-4">
                  <button
                    className="flex items-center gap-2 rounded-lg bg-white/10 px-3 md:px-4 py-2 text-sm font-medium text-white hover:bg-white/20 active:bg-white/30 transition-colors"
                    onClick={replayEpisode}
                  >
                    <RotateCcw className="h-4 w-4" />
                    <span className="hidden sm:inline">Repetir</span>
                  </button>
                  {nextEpisode && (
                    <button
                      className="flex items-center gap-2 rounded-lg bg-[#e50914] px-3 md:px-4 py-2 text-sm font-semibold text-white hover:brightness-110 active:brightness-90 transition-all"
                      onClick={playNextEpisodeNow}
                    >
                      <SkipForward className="h-4 w-4" />
                      <span className="hidden sm:inline">
                        T{nextEpisode.seasonNumber}:E
                        {nextEpisode.episodeNumber}
                      </span>
                      <span className="sm:hidden">Siguiente</span>
                    </button>
                  )}
                  <button
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 active:bg-white/20 transition-colors"
                    onClick={handleClose}
                    aria-label="Volver"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>

            <div
              className="flex-1 min-h-0 overflow-y-auto px-4 md:px-8 pb-6"
              style={{
                paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
              }}
            >
              {episodes.length > 0 ? (
                <>
                  <h3 className="text-sm md:text-base font-semibold text-white mb-3 md:mb-4">
                    {nextEpisode ? 'Otros episodios' : 'Episodios'}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {episodes.map((ep) => {
                      const isCurrent = playingEpisode?.id === ep.id;
                      return (
                        <button
                          key={ep.id}
                          className={`group flex items-start gap-3 p-3 rounded-xl text-left transition-colors ${isCurrent ? 'bg-white/10' : 'bg-white/5 hover:bg-white/10'}`}
                          onClick={() => {
                            if (playingMovie) {
                              setShowEndScreen(false);
                              openPlayer(playingMovie, ep);
                            }
                          }}
                        >
                          {ep.stillImage ? (
                            <div className="relative w-28 aspect-video rounded-lg overflow-hidden bg-white/5 shrink-0">
                              <img
                                src={ep.stillImage}
                                alt={ep.title}
                                className="h-full w-full object-cover"
                                loading="lazy"
                              />
                              <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors">
                                <Play className="h-8 w-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                              </div>
                            </div>
                          ) : (
                            <div className="w-28 aspect-video rounded-lg bg-white/10 shrink-0 flex items-center justify-center">
                              <Play className="h-6 w-6 text-white/30" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0 py-0.5">
                            <p className="text-xs font-semibold text-white line-clamp-2 leading-snug">
                              {ep.title}
                            </p>
                            <p className="text-[10px] text-white/50 mt-1">
                              T{ep.seasonNumber}:E{ep.episodeNumber}
                              {ep.duration && ` · ${ep.duration}`}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-16">
                  <p className="text-white/40 text-sm">
                    No hay más episodios disponibles.
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}