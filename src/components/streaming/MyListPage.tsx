'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { List, Heart, Trash2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MovieCard, MovieCardSkeleton } from './MovieCard';
import type { Movie } from '@/store/app-store';
import { useAppStore } from '@/store/app-store';
import { cn } from '@/lib/utils';

export function MyListPage() {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<'all' | 'movie' | 'series'>('all');
  const { searchQuery } = useAppStore();

  const fetchFavorites = useCallback(async () => {
    try {
      const res = await fetch('/api/favorites');
      if (res.ok) {
        const data = await res.json();
        const ids = new Set((data.favorites || []).map((f: { movieId: string }) => f.movieId));

        if (ids.size > 0) {
          const moviesRes = await fetch('/api/movies?limit=500');
          if (moviesRes.ok) {
            const moviesData = await moviesRes.json();
            const favMovies = (moviesData.movies || []).filter((m: Movie) => ids.has(m.id));
            setMovies(favMovies);
          }
        } else {
          setMovies([]);
        }
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchFavorites(); }, [fetchFavorites]);

  // Listen for favorites changes via a custom event
  useEffect(() => {
    const handler = () => fetchFavorites();
    window.addEventListener('favorites-changed', handler);
    return () => window.removeEventListener('favorites-changed', handler);
  }, [fetchFavorites]);

  const filteredMovies = useMemo(() => {
    let result = [...movies];

    if (filterType !== 'all') {
      result = result.filter((m) => m.type === filterType);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q)
      );
    }

    return result;
  }, [movies, filterType, searchQuery]);

  const movieCount = movies.filter((m) => m.type === 'movie').length;
  const seriesCount = movies.filter((m) => m.type === 'series').length;

  return (
    <div className="min-h-[60vh]">
      {/* Header */}
      <div className="px-4 sm:px-6 lg:px-8 max-w-[1400px] mx-auto mb-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-8 h-8 rounded-lg bg-green-600/20 flex items-center justify-center">
            <List className="h-4.5 w-4.5 text-green-400" />
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-white">Mi Lista</h1>
          <div className="flex-1 h-px bg-white/10 ml-2" />
          <span className="text-gray-500 text-sm">{filteredMovies.length} títulos</span>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilterType('all')}
            className={cn(
              'px-3 py-1.5 text-xs rounded-full transition-colors border',
              filterType === 'all'
                ? 'bg-white/15 border-white/30 text-white'
                : 'border-white/15 text-gray-400 hover:text-white hover:border-white/30'
            )}
          >
            Todos ({movies.length})
          </button>
          <button
            onClick={() => setFilterType('movie')}
            className={cn(
              'px-3 py-1.5 text-xs rounded-full transition-colors border',
              filterType === 'movie'
                ? 'bg-[#e50914] border-[#e50914] text-white'
                : 'border-white/15 text-gray-400 hover:text-white hover:border-white/30'
            )}
          >
            Películas ({movieCount})
          </button>
          <button
            onClick={() => setFilterType('series')}
            className={cn(
              'px-3 py-1.5 text-xs rounded-full transition-colors border',
              filterType === 'series'
                ? 'bg-purple-600 border-purple-600 text-white'
                : 'border-white/15 text-gray-400 hover:text-white hover:border-white/30'
            )}
          >
            Series ({seriesCount})
          </button>

          <div className="flex-1" />

          <Button
            variant="ghost"
            size="sm"
            className="text-gray-500 hover:text-white h-8"
            onClick={fetchFavorites}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Actualizar
          </Button>
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-3 md:gap-4 px-4 sm:px-6 lg:px-8 max-w-[1400px] mx-auto">
          {Array.from({ length: 14 }).map((_, i) => (
            <MovieCardSkeleton key={i} />
          ))}
        </div>
      ) : filteredMovies.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center px-4">
          <Heart className="h-12 w-12 text-gray-600 mb-4" />
          <h3 className="text-white text-lg font-medium mb-2">
            {movies.length === 0 ? 'Tu lista está vacía' : 'Sin resultados'}
          </h3>
          <p className="text-gray-500 text-sm max-w-md">
            {movies.length === 0
              ? 'Agrega películas y series a tu lista usando el botón + en cualquier tarjeta.'
              : searchQuery
                ? `No hay resultados para "${searchQuery}".`
                : 'No hay títulos en esta categoría.'}
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