'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, Star, Clock, Youtube } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppStore, type Movie } from '@/store/app-store';
import { openYouTubeTrailer } from '@/lib/trailer';

export function NetflixTop10Row() {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);
  const { selectMovie } = useAppStore();

  const fetchTop10 = useCallback(async (refresh = false) => {
    try {
      const url = refresh ? '/api/netflix-top10?refresh=true' : '/api/netflix-top10';
      const res = await fetch(url);
      if (!res.ok) return;
      const data: Movie[] = await res.json();

      if (data.length > 0) {
        setMovies(data);
        setLoading(false);
        attemptRef.current = 0;
      } else if (!refresh && attemptRef.current < 12) {
        attemptRef.current++;
        retryRef.current = setTimeout(() => fetchTop10(), 3000);
      } else {
        setLoading(false);
      }
    } catch {
      if (!loading) setLoading(false);
    }
  }, [loading]);

  useEffect(() => {
    fetchTop10();
    return () => {
      if (retryRef.current) clearTimeout(retryRef.current);
    };
    }, []);

  // Same handleViewDetails as HeroCarousel — adds to DB then opens DetailModal
  const handleViewDetails = useCallback(async (imdbId: string) => {
    if (addingId) return;
    setAddingId(imdbId);
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
    finally { setAddingId(null); }
  }, [addingId, selectMovie]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setLoading(true);
    await fetchTop10(true);
    setRefreshing(false);
  };

  const checkScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setCanScrollLeft(scrollLeft > 10);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 10);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (el) {
      el.addEventListener('scroll', checkScroll);
      return () => el.removeEventListener('scroll', checkScroll);
    }
  }, [checkScroll, movies]);

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const scrollAmount = scrollRef.current.clientWidth * 0.75;
    const newScroll =
      direction === 'left'
        ? scrollRef.current.scrollLeft - scrollAmount
        : scrollRef.current.scrollLeft + scrollAmount;
    scrollRef.current.scrollTo({ left: newScroll, behavior: 'smooth' });
  };

  if (!loading && movies.length === 0) return null;

  return (
    <section className="pt-4 md:pt-8 relative group/netflix">
      {/* Section Header — Netflix branded */}
      <div className="px-4 sm:px-6 lg:px-8 max-w-[1400px] mx-auto mb-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-[#E50914] flex items-center justify-center shrink-0">
            <span className="text-white font-extrabold text-lg leading-none select-none">
              N
            </span>
          </div>
          <h2 className="text-2xl md:text-3xl font-bold text-white">
            Top 10 en Netflix
          </h2>
          <div className="flex-1 h-px bg-[#E50914] ml-2" />
          {/* Refresh button */}
          <button
            onClick={handleRefresh}
            disabled={refreshing || loading}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-wait"
            aria-label="Actualizar Top 10"
          >
            <RefreshCw className={`h-4 w-4 text-white ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Cards Row with Arrows */}
      <div className="px-4 sm:px-6 lg:px-8 max-w-[1400px] mx-auto relative">
        {/* Left Arrow */}
        {canScrollLeft && (
          <button
            className="absolute -left-10 md:-left-12 top-0 bottom-0 z-10 w-8 md:w-10 flex items-center justify-center opacity-0 group-hover/netflix:opacity-100 transition-opacity duration-300"
            onClick={() => scroll('left')}
            aria-label="Anterior"
          >
            <div className="w-8 h-16 md:w-10 md:h-20 rounded-r-md bg-black/70 hover:bg-black/90 flex items-center justify-center transition-colors shadow-lg">
              <ChevronLeft className="h-5 w-5 text-white" />
            </div>
          </button>
        )}

        {/* Right Arrow */}
        {canScrollRight && (
          <button
            className="absolute -right-10 md:-right-12 top-0 bottom-0 z-10 w-8 md:w-10 flex items-center justify-center opacity-0 group-hover/netflix:opacity-100 transition-opacity duration-300"
            onClick={() => scroll('right')}
            aria-label="Siguiente"
          >
            <div className="w-8 h-16 md:w-10 md:h-20 rounded-l-md bg-black/70 hover:bg-black/90 flex items-center justify-center transition-colors shadow-lg">
              <ChevronRight className="h-5 w-5 text-white" />
            </div>
          </button>
        )}

        {/* Scrollable Row */}
        <div
          ref={scrollRef}
          className="flex gap-2 md:gap-3 overflow-x-auto no-scrollbar"
        >
          {loading
            ? Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="shrink-0">
                  <Skeleton className="aspect-[2/3] w-[140px] md:w-[180px] rounded-lg bg-[#222]" />
                  <Skeleton className="h-3 w-[120px] mt-2 bg-[#222]" />
                </div>
              ))
            : movies.map((movie, index) => (
                <NetflixCard
                  key={movie.id}
                  movie={movie}
                  rank={index + 1}
                  onSelect={() => movie.imdbId && handleViewDetails(movie.imdbId)}
                  onTrailer={() => openYouTubeTrailer(movie.title)}
                  isLoading={addingId === movie.imdbId}
                />
              ))}
        </div>
      </div>
    </section>
  );
}

// ─── Netflix Card — Same visual as MovieCard but uses handleViewDetails ───

interface NetflixCardProps {
  movie: Movie;
  rank: number;
  onSelect: () => void;
  onTrailer: () => void;
  isLoading: boolean;
}

function NetflixCard({ movie, rank, onSelect, onTrailer, isLoading }: NetflixCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const posterUrl = movie.coverImage || `https://placehold.co/400x600/1a1a1a/333?text=${encodeURIComponent(movie.title)}`;
  const genres = movie.genre.split(',').map((g) => g.trim()).filter(g => g && g !== 'Desconocido');

  return (
    <div className="flex items-end shrink-0">
      {/* Rank number */}
      <span
        className="relative z-10 -mr-4 md:-mr-6 text-6xl md:text-7xl font-black text-[#E50914] leading-none select-none pb-1"
        style={{ textShadow: '2px 2px 8px rgba(0,0,0,0.9)' }}
      >
        {rank}
      </span>

      {/* Card */}
      <div
        className="group relative shrink-0 cursor-pointer card-hover"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={onSelect}
      >
        <div className="relative rounded-lg overflow-hidden bg-[#1a1a1a]">
          <div className="relative aspect-[2/3]">
            {!imageLoaded && <Skeleton className="absolute inset-0 bg-[#222]" />}
            <img
              src={posterUrl}
              alt={movie.title}
              className={`w-full h-full object-cover transition-opacity duration-300 ${
                imageLoaded ? 'opacity-100' : 'opacity-0'
              }`}
              loading="lazy"
              onLoad={() => setImageLoaded(true)}
              onError={(e) => {
                const el = e.target as HTMLImageElement;
                el.src = `https://placehold.co/400x600/1a1a1a/333?text=${encodeURIComponent(movie.title)}`;
              }}
            />

            {/* Maturity badge */}
            {movie.maturity && (
              <div className="absolute top-2 right-2 z-10">
                <span className="text-[10px] font-medium bg-black/70 text-white px-1.5 py-0.5 rounded">
                  {movie.maturity}
                </span>
              </div>
            )}

            {/* Loading overlay when adding to DB */}
            {isLoading && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-20">
                <span className="inline-block w-8 h-8 border-3 border-white/30 border-t-white rounded-full animate-spin" />
              </div>
            )}

            {/* Hover Overlay */}
            <div
              className={`absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent transition-opacity duration-300 ${
                isHovered && !isLoading ? 'opacity-100' : 'opacity-0'
              }`}
            >
              {/* Trailer Button */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                <button
                  className="w-12 h-12 rounded-full bg-red-600/90 hover:bg-red-600 flex items-center justify-center transition-colors shadow-lg"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTrailer();
                  }}
                  aria-label="Ver Trailer"
                >
                  <Youtube className="h-5 w-5 text-white fill-white" />
                </button>
              </div>

              {/* Info at bottom of overlay */}
              <div className="absolute bottom-0 left-0 right-0 p-3">
                <h3 className="text-sm font-semibold text-white mb-1 line-clamp-1">
                  {movie.title}
                </h3>
                <div className="flex items-center gap-2 text-xs">
                  {movie.rating > 0 && (
                    <span className="text-green-400 flex items-center gap-0.5">
                      <Star className="h-2.5 w-2.5 fill-green-400" />
                      {movie.rating.toFixed(1)}
                    </span>
                  )}
                  {movie.year > 0 && (
                    <span className="text-gray-400">{movie.year}</span>
                  )}
                  {movie.duration && (
                    <span className="text-gray-400 flex items-center gap-0.5">
                      <Clock className="h-2.5 w-2.5" />
                      {movie.duration}
                    </span>
                  )}
                </div>
                <div className="flex gap-1 mt-1.5 flex-wrap">
                  {genres.slice(0, 2).map((g) => (
                    <span
                      key={g}
                      className="text-[10px] text-gray-300 bg-white/10 rounded px-1.5 py-0.5"
                    >
                      {g}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ALWAYS VISIBLE metadata below card */}
        <div className="mt-2 max-w-[160px] md:max-w-[180px]">
          <h3 className="text-xs font-medium text-gray-200 group-hover:text-white transition-colors line-clamp-1">
            {movie.title}
          </h3>
          <div className="flex items-center gap-2 mt-0.5">
            {movie.rating > 0 && (
              <span className="text-[11px] text-green-400 flex items-center gap-0.5">
                <Star className="h-2.5 w-2.5 fill-green-400" />
                {movie.rating.toFixed(1)}
              </span>
            )}
            {movie.year > 0 && (
              <span className="text-[11px] text-gray-500">{movie.year}</span>
            )}
          </div>
          {genres.length > 0 && (
            <div className="flex gap-1 mt-1">
              <span className="text-[10px] text-gray-500 bg-white/5 rounded px-1.5 py-0.5 max-w-[160px] truncate">
                {genres.slice(0, 2).join(' · ')}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}