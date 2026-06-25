'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Youtube, Loader2 } from 'lucide-react';

interface TrailerData {
  videoId: string;
  title: string;
}

// Global singleton — only one trailer modal, triggered from anywhere
let globalSetTitle: ((title: string | null) => void) | null = null;

export function openTrailerModal(title: string) {
  if (globalSetTitle) globalSetTitle(title);
}

export function TrailerModal() {
  const [movieTitle, setMovieTitle] = useState<string | null>(null);
  const [trailer, setTrailer] = useState<TrailerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const titleRef = useRef<string | null>(null);

  const fetchTrailer = useCallback(async (title: string) => {
    try {
      const res = await fetch(`/api/trailer?title=${encodeURIComponent(title)}`);
      if (res.ok) {
        const data = await res.json();
        setTrailer(data);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const closeModal = useCallback(() => {
    setMovieTitle(null);
    setTrailer(null);
    setError(false);
    setLoading(false);
    titleRef.current = null;
  }, []);

  const openModal = useCallback((title: string | null) => {
    if (title) {
      setTrailer(null);
      setError(false);
      setLoading(true);
      setMovieTitle(title);
      titleRef.current = title;
      fetchTrailer(title);
    } else {
      closeModal();
    }
  }, [closeModal, fetchTrailer]);

  // Register global setter once
  useEffect(() => {
    globalSetTitle = openModal;
    return () => { globalSetTitle = null; };
  }, [openModal]);

  // Close on Escape
  useEffect(() => {
    if (!movieTitle && !loading) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [movieTitle, loading, closeModal]);

  // Lock body scroll when open
  useEffect(() => {
    if (movieTitle || loading) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [movieTitle, loading]);

  const isOpen = movieTitle !== null || loading;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={closeModal}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-[95vw] max-w-[960px] bg-[#0a0a0a] rounded-xl overflow-hidden shadow-2xl shadow-black/80 border border-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/80 to-transparent absolute top-0 left-0 right-0 z-10">
              <div className="flex items-center gap-2 min-w-0">
                <Youtube className="h-4 w-4 text-red-500 shrink-0" />
                <span className="text-sm text-gray-300 truncate font-medium">
                  {trailer ? trailer.title : movieTitle || 'Trailer'}
                </span>
              </div>
              <button
                onClick={closeModal}
                className="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors shrink-0"
                aria-label="Cerrar"
              >
                <X className="h-5 w-5 text-gray-300" />
              </button>
            </div>

            {/* Video area — 16:9 */}
            <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
              {loading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0a0a0a]">
                  <Loader2 className="h-10 w-10 text-white animate-spin" />
                  <span className="text-sm text-gray-400">Buscando trailer...</span>
                </div>
              )}

              {error && !loading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0a0a0a]">
                  <Youtube className="h-10 w-10 text-gray-600" />
                  <span className="text-sm text-gray-400">No se encontró el trailer</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const t = titleRef.current || movieTitle;
                      if (t) {
                        window.open(
                          `https://www.youtube.com/results?search_query=${encodeURIComponent(t + ' official trailer')}`,
                          '_blank'
                        );
                      }
                    }}
                    className="text-sm text-red-400 hover:text-red-300 underline underline-offset-2 transition-colors"
                  >
                    Buscar en YouTube
                  </button>
                </div>
              )}

              {trailer && !loading && (
                <iframe
                  src={`https://www.youtube.com/embed/${trailer.videoId}?autoplay=1&rel=0&modestbranding=1&controls=1&showinfo=0&iv_load_policy=3`}
                  title={trailer.title}
                  className="absolute inset-0 w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}