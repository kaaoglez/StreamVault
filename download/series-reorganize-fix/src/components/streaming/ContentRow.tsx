'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MovieCard, MovieCardSkeleton } from './MovieCard';
import type { Movie } from '@/store/app-store';

interface ContentRowProps {
  title: string;
  fetchParam?: string;
  fetchType?: 'movie' | 'series';
  movies?: Movie[];
}

export function ContentRow({ title, fetchParam, fetchType, movies: propMovies }: ContentRowProps) {
  const [movies, setMovies] = useState<Movie[]>(propMovies || []);
  const [loading, setLoading] = useState(!propMovies);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const fetchMovies = useCallback(async () => {
    if (propMovies) return;
    if (!fetchParam) return;

    try {
      let url = `/api/movies?limit=20`;
      // Add type filter if specified
      const typeParam = fetchType || (fetchParam?.startsWith('type:') ? fetchParam.replace('type:', '') as 'movie' | 'series' : undefined);
      if (typeParam) url += `&type=${typeParam}`;

      if (fetchParam === 'continue') {
        url = `/api/watch-progress${typeParam ? `?type=${typeParam}` : ''}`;
      } else if (fetchParam === 'trending') {
        url = `/api/movies?limit=10&sort=rating${typeParam ? `&type=${typeParam}` : ''}`;
      } else if (fetchParam?.startsWith('genre:')) {
        const genre = fetchParam.replace('genre:', '');
        url = `/api/movies?limit=10&genre=${encodeURIComponent(genre)}${typeParam ? `&type=${typeParam}` : ''}`;
      }
      // Already handled by typeParam above for type: prefix

      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setMovies(data.movies || []);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [fetchParam, fetchType, propMovies]);

  useEffect(() => {
    fetchMovies();
  }, [fetchMovies]);

  // Refresh when data changes (scan, reorganize, etc.)
  useEffect(() => {
    const handler = () => fetchMovies();
    window.addEventListener('series-changed', handler);
    window.addEventListener('favorites-changed', handler);
    return () => {
      window.removeEventListener('series-changed', handler);
      window.removeEventListener('favorites-changed', handler);
    };
  }, [fetchMovies]);

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
        <h2 className="text-xl md:text-2xl font-semibold text-white mb-3 md:mb-4 px-4 sm:px-6 lg:px-8 max-w-[1400px] mx-auto">
          {title}
        </h2>
        <div className="flex gap-2 md:gap-3 overflow-x-auto no-scrollbar px-4 sm:px-6 lg:px-8">
          {Array.from({ length: 7 }).map((_, i) => (
            <MovieCardSkeleton key={i} />
          ))}
        </div>
      </section>
    );
  }

  if (movies.length === 0) return null;

  return (
    <section className="mb-6 md:mb-8 relative group/row">
      {title && (
        <div className="flex items-center justify-between mb-3 md:mb-4 px-4 sm:px-6 lg:px-8 max-w-[1400px] mx-auto">
          <h2 className="text-xl md:text-2xl font-semibold text-white">
            {title}
          </h2>
        </div>
      )}

      {/* Scroll Buttons */}
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

      {/* Cards Row */}
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
