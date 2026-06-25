'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, ChevronLeft, ChevronRight, PlayCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppStore, type Movie } from '@/store/app-store';
import { Skeleton } from '@/components/ui/skeleton';
import { TruncatedText } from '@/components/TruncatedText';

interface ContinueItem extends Movie {
  watchProgress: number;
  lastWatched: string;
  episodeId?: string;
  currentEpisodeLabel?: string;
  nextEpisode?: {
    id: string;
    seasonNumber: number;
    episodeNumber: number;
    title: string;
    label: string;
    isResume?: boolean;
  } | null;
}

export function ContinueWatchingRow() {
  const [items, setItems] = useState<ContinueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch('/api/watch-progress');
      if (res.ok) {
        const data = await res.json();
        setItems(data.movies || []);
      }
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  useEffect(() => {
    const h = () => fetchItems();
    window.addEventListener('progress-updated', h);
    window.addEventListener('movies-changed', h);
    return () => { window.removeEventListener('progress-updated', h); window.removeEventListener('movies-changed', h); };
  }, [fetchItems]);

  const checkScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setCanScrollLeft(scrollLeft > 10);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 10);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (el) { el.addEventListener('scroll', checkScroll); return () => el.removeEventListener('scroll', checkScroll); }
  }, [checkScroll, items]);

  const scroll = (dir: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const amt = scrollRef.current.clientWidth * 0.75;
    scrollRef.current.scrollTo({ left: dir === 'left' ? scrollRef.current.scrollLeft - amt : scrollRef.current.scrollLeft + amt, behavior: 'smooth' });
  };

  if (loading) {
    return (
      <section className="mb-6 md:mb-8">
        <div className="px-4 sm:px-6 lg:px-8 max-w-[1400px] mx-auto mb-3 md:mb-4">
          <h2 className="text-xl md:text-2xl font-semibold text-white">Continuar Viendo</h2>
        </div>
        <div className="flex gap-2 md:gap-3 overflow-x-auto no-scrollbar px-4 sm:px-6 lg:px-8">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="shrink-0">
              <Skeleton className="aspect-[2/3] w-[140px] md:w-[180px] rounded-lg bg-[#222]" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (items.length === 0) return null;

  return (
    <section className="mb-6 md:mb-8 relative group/row">
      {canScrollLeft && (
        <Button variant="ghost" size="icon" className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-black/70 hover:bg-black/90 text-white w-10 h-20 md:w-12 md:h-24 rounded-r-lg opacity-0 group-hover/row:opacity-100 transition-opacity duration-300 shadow-lg" onClick={() => scroll('left')} aria-label="Scroll left">
          <ChevronLeft className="h-6 w-6" />
        </Button>
      )}
      {canScrollRight && (
        <Button variant="ghost" size="icon" className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-black/70 hover:bg-black/90 text-white w-10 h-20 md:w-12 md:h-24 rounded-l-lg opacity-0 group-hover/row:opacity-100 transition-opacity duration-300 shadow-lg" onClick={() => scroll('right')} aria-label="Scroll right">
          <ChevronRight className="h-6 w-6" />
        </Button>
      )}
      <div ref={scrollRef} className="flex gap-2 md:gap-3 overflow-x-auto no-scrollbar px-4 sm:px-6 lg:px-8 max-w-[1400px] mx-auto">
        {items.map((item) => <ContinueCard key={item.id} item={item} onRemove={(id) => setItems(prev => prev.filter(i => i.id !== id))} />)}
      </div>
    </section>
  );
}

// ─── Card: matches MovieCard style (2:3 poster) + progress overlay ──

function ContinueCard({ item, onRemove }: { item: ContinueItem; onRemove: (id: string) => void }) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const { openPlayer, selectMovie } = useAppStore();

  const handleRemove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/watch-progress?movieId=${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      if (res.ok) {
        onRemove(item.id);
        window.dispatchEvent(new CustomEvent('progress-updated'));
      }
    } catch {}
  };

  const progress = Math.min(item.watchProgress, 100);
  const isSeries = item.type === 'series';
  const nextEp = item.nextEpisode;

  return (
    <div
      className="shrink-0 w-[140px] md:w-[180px] cursor-pointer group/card"
      onClick={() => selectMovie(item)}
    >
      <div className="relative rounded-lg overflow-hidden bg-[#1a1a1a]">
        {/* Poster — always fully visible, same as MovieCard */}
        <div className="relative aspect-[2/3]">
          {!imgLoaded && <Skeleton className="absolute inset-0 bg-[#222]" />}
          <img
            src={item.coverImage}
            alt={item.title}
            className={`w-full h-full object-cover transition-opacity duration-300 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
            loading="lazy"
            onLoad={() => setImgLoaded(true)}
            onError={(e) => {
              const el = e.target as HTMLImageElement;
              el.src = `https://placehold.co/400x600/1a1a1a/333?text=${encodeURIComponent(item.title)}`;
            }}
          />

          {/* X button — top right, only on hover */}
          <button
            className="absolute top-1.5 right-1.5 z-20 w-7 h-7 rounded-full bg-black/60 hover:bg-[#e50914] flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-all duration-200"
            onClick={handleRemove}
            aria-label="Eliminar de Continuar Viendo"
          >
            <X className="h-3.5 w-3.5 text-white" />
          </button>

          {/* Hover overlay — same as MovieCard */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-0 group-hover/card:opacity-100 transition-opacity duration-300">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
              <button
                className="w-12 h-12 rounded-full bg-white/90 hover:bg-white flex items-center justify-center transition-colors shadow-lg"
                onClick={(e) => { e.stopPropagation(); openPlayer(item); }}
                aria-label="Reproducir"
              >
                <Play className="h-5 w-5 text-black ml-0.5 fill-black" />
              </button>
            </div>
          </div>

          {/* ── Siguiente badge — top left ── */}
          {isSeries && nextEp && (
            <div className="absolute top-2 left-2 z-10">
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-[#e50914] text-white px-2 py-0.5 rounded shadow-lg shadow-black/40">
                <Play className="h-2.5 w-2.5 fill-white" />
                {nextEp.isResume ? 'Continuar' : 'Siguiente'}
              </span>
            </div>
          )}

          {/* ── Progress bar — bottom of poster ── */}
          <div className="absolute bottom-0 left-0 right-0">
            <div className="w-full h-[3px] bg-black/50">
              <div className="h-full bg-[#e50914] rounded-r-full" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Info below poster — matches MovieCard style ── */}
      <div className="mt-2 max-w-[160px] md:max-w-[180px]">
        <TruncatedText text={item.title} as="h3" className="text-xs font-medium text-gray-200 group-hover/card:text-white transition-colors" />
        {isSeries && nextEp && (
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[11px] text-[#e50914] font-bold">{nextEp.label}</span>
            <span className="text-gray-600 text-[10px]">·</span>
            <TruncatedText text={nextEp.title} as="span" className="text-[11px] text-gray-500" />
          </div>
        )}
        {!isSeries && (
          <span className="text-[10px] text-gray-500 mt-0.5 block">{Math.round(progress)}% visto</span>
        )}
      </div>
    </div>
  );
}