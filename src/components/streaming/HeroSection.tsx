'use client';

import { useState, useEffect, useCallback } from 'react';
import { Play, Info, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppStore, type Movie } from '@/store/app-store';

export function HeroSection() {
  const [featuredMovie, setFeaturedMovie] = useState<Movie | null>(null);
  const [loading, setLoading] = useState(true);
  const { selectMovie, openPlayer } = useAppStore();

  const fetchFeatured = useCallback(async () => {
    try {
      const res = await fetch('/api/movies?featured=true');
      if (res.ok) {
        const data = await res.json();
        if (data.movies && data.movies.length > 0) {
          setFeaturedMovie(data.movies[0]);
        }
      }
    } catch {
      // Fallback: try without featured filter
      try {
        const res = await fetch('/api/movies?limit=1');
        if (res.ok) {
          const data = await res.json();
          if (data.movies && data.movies.length > 0) {
            setFeaturedMovie(data.movies[0]);
          }
        }
      } catch {
        // No movies available yet
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFeatured();
  }, [fetchFeatured]);

  if (loading) {
    return (
      <section className="relative w-full h-[80vh] min-h-[500px]" id="home">
        <Skeleton className="w-full h-full bg-[#1a1a1a]" />
      </section>
    );
  }

  if (!featuredMovie) {
    return (
      <section
        className="relative w-full h-[80vh] min-h-[500px] flex items-center justify-center"
        id="home"
      >
        <div className="absolute inset-0 bg-gradient-to-b from-[#1a1a1a] to-[#141414]" />
        <div className="relative z-10 text-center animate-fadeIn">
          <h1 className="text-4xl md:text-6xl font-bold text-white mb-4">
            Bienvenido a StreamVault
          </h1>
          <p className="text-gray-400 text-lg max-w-md mx-auto">
            Tu plataforma personal de streaming. Agrega películas y series para
            comenzar.
          </p>
        </div>
      </section>
    );
  }

  const backdropUrl = featuredMovie.backdropImage;
  const genres = featuredMovie.genre.split(',').map((g) => g.trim());

  return (
    <section className="relative w-full h-[80vh] min-h-[500px]" id="home">
      {/* Background Image */}
      <div className="absolute inset-0">
        <img
          src={backdropUrl}
          alt={featuredMovie.title}
          className="w-full h-full object-cover"
          onError={(e) => {
            const el = e.target as HTMLImageElement;
            el.style.display = 'none';
          }}
        />
        {/* Gradient Overlay */}
        <div className="absolute inset-0 hero-gradient" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex items-end h-full pb-20 md:pb-28">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 w-full">
          <div className="max-w-xl animate-slideUp">
            {/* Genre Badge */}
            <div className="flex flex-wrap gap-2 mb-3">
              {genres.slice(0, 3).map((genre) => (
                <Badge
                  key={genre}
                  variant="outline"
                  className="text-xs border-white/30 text-gray-300 bg-white/5"
                >
                  {genre}
                </Badge>
              ))}
            </div>

            {/* Title */}
            <h1 className="text-4xl md:text-6xl font-bold text-white mb-3 leading-tight">
              {featuredMovie.title}
            </h1>

            {/* Meta Info */}
            <div className="flex items-center gap-3 mb-3 text-sm">
              <span className="text-green-400 font-semibold flex items-center gap-1">
                <Star className="h-3.5 w-3.5 fill-green-400 text-green-400" />
                {featuredMovie.rating.toFixed(1)}
              </span>
              <span className="text-gray-400">{featuredMovie.year}</span>
              {featuredMovie.duration && (
                <span className="text-gray-400">
                  {featuredMovie.duration}
                </span>
              )}
              <Badge
                variant="secondary"
                className="text-[10px] bg-white/20 text-white hover:bg-white/30 px-1.5 py-0"
              >
                {featuredMovie.maturity}
              </Badge>
            </div>

            {/* Description */}
            <p className="text-gray-300 text-sm md:text-base max-w-lg line-clamp-3 mb-6">
              {featuredMovie.description}
            </p>

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-3">
              <Button
                size="lg"
                className="btn-primary text-base px-6 md:px-8 h-11 md:h-12 rounded-md font-semibold"
                onClick={() => openPlayer(featuredMovie)}
              >
                <Play className="h-5 w-5 mr-2 fill-white" />
                Reproducir
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="btn-secondary text-base px-6 md:px-8 h-11 md:h-12 rounded-md border-white/30 text-white hover:bg-white/20 hover:text-white"
                onClick={() => selectMovie(featuredMovie)}
              >
                <Info className="h-5 w-5 mr-2" />
                Más Información
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
