'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MovieCard, MovieCardSkeleton } from './MovieCard';
import type { Movie } from '@/store/app-store';

export function FavoritesRow() {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);
  const [favoritedIds, setFavoritedIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const fetchFavorites = useCallback(async () => {
    try {
      const res = await fetch('/api/favorites');
      if (res.ok) {
        const data = await res.json();
        const ids = new Set((data.favorites || []).map((f: { movieId: string }) => f.movieId));
        setFavoritedIds(ids);

        // Fetch full movie data for each favorite
        if (ids.size > 0) {
          const moviesRes = await fetch('/api/movies?limit=100');
          if (moviesRes.ok) {
            const moviesData = await moviesRes.json();
            const favMovies = (moviesData.movies || []).filter((m: Movie) => ids.has(m.id));
            setMovies(favMovies);
          }
        }
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFavorites();
  }, [fetchFavorites]);

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

  if (loading) {
    return (
      <section className="mb-6 md:mb-8">
        <h2 className="text-xl md:text-2xl font-semibold text-white mb-3 md:mb-4 px-4 sm:px-6 lg:px-8 max-w-[1400px] mx-auto flex items-center gap-2">
          <Heart className="h-5 w-5 text-[#e50914]" />
          Mi Lista
        </h2>
        <div className="flex gap-2 md:gap-3 overflow-x-auto no-scrollbar px-4 sm:px-6 lg:px-8">
          {Array.from({ length: 7 }).map((_, i) => (
            <MovieCardSkeleton key={i} />
          ))}
        </div>
      </section>
    );
  }

  if (movies.length === 0) {
    return (
      <section className="mb-6 md:mb-8 px-4 sm:px-6 lg:px-8 max-w-[1400px] mx-auto">
        <h2 className="text-xl md:text-2xl font-semibold text-white mb-3 md:mb-4 flex items-center gap-2">
          <Heart className="h-5 w-5 text-[#e50914]" />
          Mi Lista
        </h2>
        <p className="text-gray-500 text-sm py-8 text-center">
          Agrega películas y series a tu lista usando el botón +
        </p>
      </section>
    );
  }

  return (
    <section className="mb-6 md:mb-8 relative group/row">
      <div className="flex items-center justify-between mb-3 md:mb-4 px-4 sm:px-6 lg:px-8 max-w-[1400px] mx-auto">
        <h2 className="text-xl md:text-2xl font-semibold text-white flex items-center gap-2">
          <Heart className="h-5 w-5 text-[#e50914]" />
          Mi Lista
        </h2>
      </div>

      {canScrollLeft && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-black/70 hover:bg-black/90 text-white w-10 h-20 md:w-12 md:h-24 rounded-r-lg opacity-0 group-hover/row:opacity-100 transition-opacity duration-300 shadow-lg"
          onClick={() => scroll('left')}
          aria-label="Scroll left"
        >
          <ChevronLeft className="h-6 w-6" />
        </Button>
      )}
      {canScrollRight && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-black/70 hover:bg-black/90 text-white w-10 h-20 md:w-12 md:h-24 rounded-l-lg opacity-0 group-hover/row:opacity-100 transition-opacity duration-300 shadow-lg"
          onClick={() => scroll('right')}
          aria-label="Scroll right"
        >
          <ChevronRight className="h-6 w-6" />
        </Button>
      )}

      <div
        ref={scrollRef}
        className="flex gap-2 md:gap-3 overflow-x-auto no-scrollbar px-4 sm:px-6 lg:px-8 max-w-[1400px] mx-auto"
      >
        {movies.map((movie) => (
          <div key={movie.id} className="shrink-0 w-[140px] md:w-[180px]">
            <MovieCard movie={movie} />
          </div>
        ))}
      </div>
    </section>
  );
}