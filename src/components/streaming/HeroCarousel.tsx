'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Info, Star, ChevronLeft, ChevronRight, Youtube, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppStore, type Movie } from '@/store/app-store';
import { openYouTubeTrailer } from '@/lib/trailer';

// ─── Types ────────────────────────────────────────────────

interface TrendingItem {
  id: string;
  imdbId: string;
  title: string;
  description: string;
  coverImage: string;
  backdropImage: string;
  year: number;
  rating: number;
  genre: string;
  type: 'movie' | 'series';
  maturity: string;
  featured: boolean;
  local: false;
}

type HeroItem = Movie | TrendingItem;

function isExternal(item: HeroItem): item is TrendingItem {
  return !('local' in item && item.local !== false) || ('local' in item && item.local === false);
}

function getPosterImage(item: HeroItem): string {
  if (isExternal(item)) {
    return item.backdropImage || item.coverImage || '';
  }
  return item.coverImage || '';
}

// ─── Main Component ──────────────────────────────────────

export function HeroCarousel() {
  const [items, setItems] = useState<HeroItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [addingImdbId, setAddingImdbId] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { selectMovie, openPlayer } = useAppStore();

  const fetchHero = useCallback(async () => {
    try {
      const trendingRes = await fetch('/api/trending');
      if (trendingRes.ok) {
        const trendingData = await trendingRes.json();
        if (trendingData.items && trendingData.items.length > 0) {
          setItems(trendingData.items);
          setLoading(false);
          return;
        }
      }
      const res = await fetch('/api/movies?limit=5&sort=rating&local=true');
      if (res.ok) {
        const data = await res.json();
        if (data.movies && data.movies.length > 0) {
          setItems(data.movies);
          setLoading(false);
          return;
        }
      }
      const res2 = await fetch('/api/movies?limit=5&sort=rating');
      if (res2.ok) {
        const data2 = await res2.json();
        if (data2.movies && data2.movies.length > 0) {
          setItems(data2.movies);
        }
      }
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchHero(); }, [fetchHero]);

  useEffect(() => {
    const h = () => fetchHero();
    window.addEventListener('movies-changed', h);
    return () => window.removeEventListener('movies-changed', h);
  }, [fetchHero]);

  useEffect(() => {
    if (items.length <= 1) return;
    intervalRef.current = setInterval(() => {
      setCurrentIndex((p) => (p + 1) % items.length);
    }, 7000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [items.length]);

  const handleViewDetails = useCallback(async (imdbId: string) => {
    if (addingImdbId) return;
    setAddingImdbId(imdbId);
    try {
      const res = await fetch('/api/movies/add-external', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imdbId }),
      });
      const data = await res.json();
      if (!res.ok && res.status !== 409) return;
      window.dispatchEvent(new CustomEvent('movies-changed'));
      if (data.movie) {
        setTimeout(() => selectMovie(data.movie as Movie), 300);
      }
    } catch {}
    finally { setAddingImdbId(null); }
  }, [addingImdbId, selectMovie]);

  const goPrev = () => setCurrentIndex((i) => (i - 1 + items.length) % items.length);
  const goNext = () => setCurrentIndex((i) => (i + 1) % items.length);

  // ─── Loading ────────────────────────────────────────────
  if (loading) {
    return (
      <section className="relative w-full h-[85vh] min-h-[550px]" id="home">
        <Skeleton className="w-full h-full bg-[#1a1a1a]" />
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="relative w-full h-[85vh] min-h-[550px] flex items-center justify-center bg-[#0d0d0d]" id="home">
        <div className="relative z-10 text-center">
          <h1 className="text-4xl md:text-6xl font-bold text-white mb-4">Bienvenido a StreamVault</h1>
          <p className="text-gray-400 text-lg max-w-md mx-auto">
            Tu plataforma personal de streaming. Agrega películas y series para comenzar.
          </p>
        </div>
      </section>
    );
  }

  const prevIdx = (currentIndex - 1 + items.length) % items.length;
  const nextIdx = (currentIndex + 1) % items.length;
  const prevItem = items[prevIdx];
  const currentItem = items[currentIndex];
  const nextItem = items[nextIdx];

  const ext = isExternal(currentItem);
  const genres = (currentItem.genre || '').split(',').map((g: string) => g.trim()).filter(Boolean);

  return (
    <section
      className="relative w-full h-[90vh] min-h-[620px] overflow-hidden bg-[#080808]"
      id="home"
    >
      {/* ── Ambient background ── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`bg-${currentItem.id}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1 }}
          className="absolute inset-0"
        >
          {getPosterImage(currentItem) && (
            <img
              src={getPosterImage(currentItem)}
              alt=""
              aria-hidden
              className="w-full h-full object-cover scale-150"
              style={{ filter: 'blur(100px) brightness(0.2) saturate(1.5)' }}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* ── Top/bottom gradient overlays ── */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#080808]/70 via-transparent to-[#141414]" />

      {/* ── Left gradient for text readability ── */}
      <div className="absolute inset-0 bg-gradient-to-r from-[#080808] via-[#080808]/80 to-transparent z-[1]" />

      {/* ═══════════════════════════════════════════════════
          3D COVERFLOW — shifted right to make room for info
          ═══════════════════════════════════════════════════ */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ perspective: '1800px' }}
      >
        <div className="flex items-center justify-center w-full h-full" style={{ transformStyle: 'preserve-3d' }}>

          {/* ── LEFT CARD (prev, blurred) ── */}
          <motion.div
            key={`side-l-${prevItem.id}`}
            initial={{ opacity: 0, x: -80 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -80 }}
            transition={{ duration: 0.55, ease: [0.25, 0.1, 0.25, 1] }}
            className="flex-shrink-0 cursor-pointer select-none"
            style={{
              width: 'clamp(140px, 22vw, 320px)',
              height: 'clamp(210px, 62vh, 540px)',
              transform: 'rotateY(18deg) translateZ(-50px)',
              filter: 'blur(5px) brightness(0.55)',
              opacity: 0.55,
              transformStyle: 'preserve-3d',
              transition: 'transform 0.55s cubic-bezier(0.25,0.1,0.25,1), filter 0.55s ease, opacity 0.55s ease',
            }}
            onClick={goPrev}
          >
            <div className="relative w-full h-full rounded-xl overflow-hidden shadow-2xl shadow-black/50">
              <img
                src={getPosterImage(prevItem)}
                alt={prevItem.title}
                className="w-full h-full object-cover"
                draggable={false}
                onError={(e) => {
                  const el = e.target as HTMLImageElement;
                  el.src = `https://placehold.co/400x600/1a1a1a/333?text=${encodeURIComponent(prevItem.title)}`;
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
            </div>
          </motion.div>

          {/* ── CENTER CARD (focused, hero) ── */}
          <AnimatePresence mode="wait">
            <motion.div
              key={`center-${currentItem.id}`}
              initial={{ opacity: 0, scale: 0.92, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: -10 }}
              transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
              className="flex-shrink-0 mx-1 sm:mx-2 md:mx-3 relative select-none"
              style={{
                width: 'clamp(200px, 28vw, 400px)',
                height: 'clamp(300px, 72vh, 620px)',
                zIndex: 20,
              }}
            >
              {/* Glow behind card */}
              {getPosterImage(currentItem) && (
                <div
                  className="absolute -inset-8 -z-10 rounded-3xl"
                  style={{
                    background: 'radial-gradient(ellipse at center, rgba(229,9,20,0.12) 0%, transparent 70%)',
                    filter: 'blur(30px)',
                  }}
                />
              )}

              <div className="relative w-full h-full rounded-2xl overflow-hidden shadow-2xl shadow-black/70 ring-1 ring-white/[0.08]">
                <img
                  src={getPosterImage(currentItem)}
                  alt={currentItem.title}
                  className="w-full h-full object-cover"
                  draggable={false}
                  onError={(e) => {
                    const el = e.target as HTMLImageElement;
                    el.src = `https://placehold.co/400x600/1a1a1a/333?text=${encodeURIComponent(currentItem.title)}`;
                  }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent pointer-events-none" />

                {/* Rating badge */}
                {currentItem.rating > 0 && (
                  <div className="absolute top-3 right-3 flex items-center gap-1 bg-black/60 backdrop-blur-md rounded-lg px-2.5 py-1 border border-white/10">
                    <Star className="h-3.5 w-3.5 text-yellow-400 fill-yellow-400" />
                    <span className="text-xs font-bold text-white">{currentItem.rating.toFixed(1)}</span>
                  </div>
                )}

                {/* Type badge */}
                <div className="absolute top-3 left-3">
                  {ext ? (
                    <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest bg-[#e50914]/80 backdrop-blur-md text-white px-2.5 py-1 rounded-lg">
                      <TrendingUp className="h-2.5 w-2.5" />
                      Trending
                    </span>
                  ) : currentItem.type === 'series' ? (
                    <span className="text-[9px] font-bold uppercase tracking-widest bg-purple-500/70 backdrop-blur-md text-white px-2.5 py-1 rounded-lg">
                      Serie
                    </span>
                  ) : (
                    <span className="text-[9px] font-bold uppercase tracking-widest bg-white/15 backdrop-blur-md text-white px-2.5 py-1 rounded-lg">
                      Mi Colección
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          </AnimatePresence>

          {/* ── RIGHT CARD (next, blurred) ── */}
          <motion.div
            key={`side-r-${nextItem.id}`}
            initial={{ opacity: 0, x: 80 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 80 }}
            transition={{ duration: 0.55, ease: [0.25, 0.1, 0.25, 1] }}
            className="flex-shrink-0 cursor-pointer select-none"
            style={{
              width: 'clamp(140px, 22vw, 320px)',
              height: 'clamp(210px, 62vh, 540px)',
              transform: 'rotateY(-18deg) translateZ(-50px)',
              filter: 'blur(5px) brightness(0.55)',
              opacity: 0.55,
              transformStyle: 'preserve-3d',
              transition: 'transform 0.55s cubic-bezier(0.25,0.1,0.25,1), filter 0.55s ease, opacity 0.55s ease',
            }}
            onClick={goNext}
          >
            <div className="relative w-full h-full rounded-xl overflow-hidden shadow-2xl shadow-black/50">
              <img
                src={getPosterImage(nextItem)}
                alt={nextItem.title}
                className="w-full h-full object-cover"
                draggable={false}
                onError={(e) => {
                  const el = e.target as HTMLImageElement;
                  el.src = `https://placehold.co/400x600/1a1a1a/333?text=${encodeURIComponent(nextItem.title)}`;
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
            </div>
          </motion.div>
        </div>
      </div>

      {/* ── Navigation Arrows ── */}
      {items.length > 1 && (
        <div className="absolute inset-0 z-40 pointer-events-none flex items-center justify-between px-2 sm:px-6 md:px-12">
          <button
            onClick={goPrev}
            className="pointer-events-auto w-10 h-10 md:w-12 md:h-12 rounded-full bg-black/40 hover:bg-black/70 border border-white/10 hover:border-white/25 flex items-center justify-center transition-all opacity-0 hover:opacity-100 backdrop-blur-sm group"
            aria-label="Anterior"
          >
            <ChevronLeft className="h-5 w-5 md:h-6 md:w-6 text-white/70 group-hover:text-white transition-colors" />
          </button>
          <button
            onClick={goNext}
            className="pointer-events-auto w-10 h-10 md:w-12 md:h-12 rounded-full bg-black/40 hover:bg-black/70 border border-white/10 hover:border-white/25 flex items-center justify-center transition-all opacity-0 hover:opacity-100 backdrop-blur-sm group"
            aria-label="Siguiente"
          >
            <ChevronRight className="h-5 w-5 md:h-6 md:w-6 text-white/70 group-hover:text-white transition-colors" />
          </button>
        </div>
      )}

      {/* ── Left Info Panel ── */}
      <div className="absolute bottom-0 left-0 z-30 pointer-events-none pb-12 md:pb-16">
        <div className="w-full max-w-[520px] px-6 sm:px-8 lg:px-12 pointer-events-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={`info-${currentItem.id}`}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.4, delay: 0.12, ease: 'easeOut' }}
            >
              {/* Trending badge */}
              {ext && (
                <div className="flex items-center gap-2 mb-3">
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest bg-[#e50914]/30 text-[#ff6b6b] px-2.5 py-1 rounded">
                    <TrendingUp className="h-3 w-3" />
                    Trending
                  </span>
                </div>
              )}

              {/* Type + Genres */}
              <div className="flex items-center gap-2 mb-3">
                {currentItem.type === 'series' ? (
                  <span className="text-[10px] font-bold uppercase tracking-widest bg-purple-500/20 text-purple-300 px-2.5 py-0.5 rounded">Serie</span>
                ) : ext ? (
                  <span className="text-[10px] font-bold uppercase tracking-widest bg-white/10 text-gray-300 px-2.5 py-0.5 rounded">Película</span>
                ) : (
                  <span className="text-[10px] font-bold uppercase tracking-widest bg-white/10 text-gray-300 px-2.5 py-0.5 rounded">Mi Colección</span>
                )}
                {genres.slice(0, 2).map((g: string) => (
                  <span key={g} className="text-[11px] text-gray-400 uppercase tracking-wider font-medium">{g}</span>
                ))}
              </div>

              {/* Title */}
              <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black text-white leading-[0.95] tracking-tight mb-4 drop-shadow-lg">
                {currentItem.title}
              </h1>

              {/* Meta row */}
              <div className="flex items-center gap-3 mb-4">
                {currentItem.rating > 0 && (
                  <span className="inline-flex items-center gap-1 text-sm font-bold text-green-400">
                    <Star className="h-4 w-4 fill-green-400" />
                    {currentItem.rating.toFixed(1)}
                  </span>
                )}
                {currentItem.year > 0 && (
                  <>
                    <span className="text-gray-500 text-sm">·</span>
                    <span className="text-sm text-gray-300">{currentItem.year}</span>
                  </>
                )}
                {!ext && currentItem.duration && (
                  <>
                    <span className="text-gray-500 text-sm">·</span>
                    <span className="text-sm text-gray-300">{currentItem.duration}</span>
                  </>
                )}
                {currentItem.maturity && (
                  <>
                    <span className="text-gray-500 text-sm">·</span>
                    <span className="text-xs font-medium text-gray-400 bg-white/10 px-1.5 py-0.5 rounded">{currentItem.maturity}</span>
                  </>
                )}
              </div>

              {/* Description */}
              {currentItem.description && (
                <p className="text-sm md:text-[15px] text-gray-300 leading-relaxed line-clamp-3 mb-6 max-w-md">
                  {currentItem.description}
                </p>
              )}

              {/* Action Buttons */}
              <div className="flex items-center gap-3 flex-wrap">
                {!ext && (
                  <Button
                    size="lg"
                    className="bg-white text-black hover:bg-white/90 text-sm md:text-base px-7 md:px-9 h-11 md:h-12 rounded-md font-bold tracking-wide transition-colors shadow-lg shadow-white/10"
                    onClick={() => openPlayer(currentItem as Movie)}
                  >
                    <Play className="h-5 w-5 mr-2 fill-black" />
                    Reproducir
                  </Button>
                )}

                <Button
                  size="lg"
                  variant="outline"
                  className="bg-red-600/90 hover:bg-red-600 border-red-600 text-white hover:text-white text-sm md:text-base px-5 md:px-7 h-11 md:h-12 rounded-md font-semibold tracking-wide backdrop-blur-sm transition-colors shadow-lg shadow-red-600/20"
                  onClick={() => openYouTubeTrailer(currentItem.title)}
                >
                  <Youtube className="h-5 w-5 mr-2 fill-white" />
                  Trailer
                </Button>

                {!ext ? (
                  <Button
                    size="lg"
                    variant="outline"
                    className="bg-white/15 hover:bg-white/25 border-white/20 text-white hover:text-white text-sm md:text-base px-6 md:px-8 h-11 md:h-12 rounded-md font-semibold tracking-wide backdrop-blur-sm transition-colors"
                    onClick={() => selectMovie(currentItem as Movie)}
                  >
                    <Info className="h-5 w-5 mr-2" />
                    Más Info
                  </Button>
                ) : (
                  <Button
                    size="lg"
                    variant="outline"
                    className="bg-white/15 hover:bg-white/25 border-white/20 text-white hover:text-white text-sm md:text-base px-6 md:px-8 h-11 md:h-12 rounded-md font-semibold tracking-wide backdrop-blur-sm transition-colors disabled:opacity-50 disabled:cursor-wait"
                    disabled={addingImdbId === (currentItem as TrendingItem).imdbId}
                    onClick={() => handleViewDetails((currentItem as TrendingItem).imdbId)}
                  >
                    {addingImdbId === (currentItem as TrendingItem).imdbId ? (
                      <span className="inline-block w-4 h-4 mr-2 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Info className="h-5 w-5 mr-2" />
                    )}
                    Más Info
                  </Button>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* ── Dots centered under posters ── */}
      {items.length > 1 && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 pointer-events-none">
          {items.map((m, i) => (
            <button
              key={m.id}
              onClick={() => setCurrentIndex(i)}
              className={`rounded-full transition-all duration-500 pointer-events-auto ${
                i === currentIndex ? 'w-8 h-1.5 bg-white' : 'w-1.5 h-1.5 bg-white/25 hover:bg-white/45'
              }`}
              aria-label={m.title}
            />
          ))}
        </div>
      )}
    </section>
  );
}