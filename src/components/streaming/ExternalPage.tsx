'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { SlidersHorizontal, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MovieCard, MovieCardSkeleton } from './MovieCard';
import type { Movie } from '@/store/app-store';
import { useAppStore } from '@/store/app-store';
import { cn } from '@/lib/utils';

const SORT_OPTIONS = [
  { value: 'recent', label: 'Recientes' },
  { value: 'rating', label: 'Mejor valoradas' },
  { value: 'year', label: 'Por año' },
  { value: 'title', label: 'Por título' },
];

export function ExternalPage() {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGenre, setSelectedGenre] = useState('Todos');
  const [sortBy, setSortBy] = useState('recent');
  const [showFilters, setShowFilters] = useState(false);
  const { searchQuery } = useAppStore();

  const fetchMovies = useCallback(async () => {
    try {
      const res = await fetch('/api/movies?external=true&limit=500');
      if (res.ok) {
        const data = await res.json();
        setMovies(data.movies || []);
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMovies(); }, [fetchMovies]);

  useEffect(() => {
    const handler = () => fetchMovies();
    window.addEventListener('movies-changed', handler);
    window.addEventListener('favorites-changed', handler);
    return () => {
      window.removeEventListener('movies-changed', handler);
      window.removeEventListener('favorites-changed', handler);
    };
  }, [fetchMovies]);

  const genres = useMemo(() => {
    const genreSet = new Set<string>();
    movies.forEach((m) => {
      m.genre.split(',').forEach((g) => {
        const trimmed = g.trim();
        if (trimmed) genreSet.add(trimmed);
      });
    });
    return ['Todos', ...Array.from(genreSet).sort()];
  }, [movies]);

  const filteredMovies = useMemo(() => {
    let result = [...movies];

    if (selectedGenre !== 'Todos') {
      result = result.filter((m) =>
        m.genre.split(',').some((g) => g.trim() === selectedGenre)
      );
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((m) => m.title.toLowerCase().includes(q));
    }

    switch (sortBy) {
      case 'rating':
        result.sort((a, b) => b.rating - a.rating);
        break;
      case 'year':
        result.sort((a, b) => b.year - a.year);
        break;
      case 'title':
        result.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'recent':
      default:
        result.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        break;
    }

    return result;
  }, [movies, selectedGenre, sortBy, searchQuery]);

  return (
    <div className="min-h-[60vh]">
      {/* Header */}
      <div className="px-4 sm:px-6 lg:px-8 max-w-[1400px] mx-auto mb-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-8 h-8 rounded-lg bg-cyan-600/20 flex items-center justify-center">
            <Globe className="h-4.5 w-4.5 text-cyan-400" />
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-white">Fuente Externa</h1>
          <div className="flex-1 h-px bg-white/10 ml-2" />
          <span className="text-gray-500 text-sm">{filteredMovies.length} títulos</span>
        </div>

        {/* Filters Row */}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant={showFilters ? 'secondary' : 'outline'}
            size="sm"
            className={cn(
              'border-white/20 text-gray-300 hover:text-white',
              showFilters && 'bg-white/15 text-white border-white/30'
            )}
            onClick={() => setShowFilters(!showFilters)}
          >
            <SlidersHorizontal className="h-4 w-4 mr-1.5" />
            Filtros
          </Button>

          <div className="flex items-center gap-1.5">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSortBy(opt.value)}
                className={cn(
                  'px-2.5 py-1 text-xs rounded-md transition-colors',
                  sortBy === opt.value
                    ? 'bg-white/15 text-white'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Genre Pills */}
        {showFilters && (
          <div className="flex flex-wrap gap-2 mt-4">
            {genres.map((genre) => (
              <button
                key={genre}
                onClick={() => setSelectedGenre(genre)}
                className={cn(
                  'px-3 py-1.5 text-xs rounded-full transition-colors border',
                  selectedGenre === genre
                    ? 'bg-cyan-600 border-cyan-600 text-white'
                    : 'border-white/15 text-gray-400 hover:text-white hover:border-white/30 hover:bg-white/5'
                )}
              >
                {genre}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-3 md:gap-4 px-4 sm:px-6 lg:px-8 max-w-[1400px] mx-auto">
          {Array.from({ length: 21 }).map((_, i) => (
            <MovieCardSkeleton key={i} />
          ))}
        </div>
      ) : filteredMovies.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center px-4">
          <Globe className="h-12 w-12 text-gray-600 mb-4" />
          <h3 className="text-white text-lg font-medium mb-2">No hay películas externas</h3>
          <p className="text-gray-500 text-sm max-w-md">
            {searchQuery
              ? `No hay resultados para "${searchQuery}". Intenta con otra búsqueda.`
              : 'No hay películas de fuente externa agregadas.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-3 md:gap-4 px-4 sm:px-6 lg:px-8 max-w-[1400px] mx-auto pb-8">
          {filteredMovies.map((movie) => (
            <MovieCard key={movie.id} movie={movie} />
          ))}
        </div>
      )}
    </div>
  );
}