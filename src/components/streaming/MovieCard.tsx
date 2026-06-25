'use client';

import { useState } from 'react';
import { Play, Plus, Star, Check, Clock, Youtube } from 'lucide-react';
import { useAppStore, type Movie } from '@/store/app-store';
import { Skeleton } from '@/components/ui/skeleton';
import { TruncatedText } from '@/components/TruncatedText';
import { openYouTubeTrailer } from '@/lib/trailer';

interface MovieCardProps {
  movie: Movie;
}

function isNewMovie(createdAt: string): boolean {
  return new Date(createdAt) >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
}

async function rateMovie(movieId: string, rating: number) {
  try {
    await fetch(`/api/movies/${movieId}/rate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating }),
    });
    window.dispatchEvent(new CustomEvent('ratings-changed'));
  } catch {
    // silently fail
  }
}

export function MovieCard({ movie }: MovieCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isFav, setIsFav] = useState(false);
  const { selectMovie, openPlayer } = useAppStore();

  const posterUrl = movie.coverImage || `https://placehold.co/400x600/1a1a1a/333?text=${encodeURIComponent(movie.title)}`;
  const genres = movie.genre.split(',').map((g) => g.trim()).filter(g => g && g !== 'Desconocido');
  const showNewBadge = !movie.featured && isNewMovie(movie.createdAt);

  const toggleFav = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ movieId: movie.id }),
      });
      if (res.ok) {
        const data = await res.json();
        setIsFav(data.favorited);
        window.dispatchEvent(new CustomEvent('favorites-changed'));
      }
    } catch {}
  };

  const handleStarClick = (e: React.MouseEvent, rating: number) => {
    e.stopPropagation();
    const newRating = movie.userRating === rating ? 0 : rating;
    rateMovie(movie.id, newRating);
  };

  return (
    <div
      className="group relative shrink-0 cursor-pointer card-hover"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => selectMovie(movie)}
    >
      {/* Card Container */}
      <div className="relative rounded-lg overflow-hidden bg-[#1a1a1a]">
        {/* Aspect Ratio 2:3 */}
        <div className="relative aspect-[2/3]">
          {!imageLoaded && (
            <Skeleton className="absolute inset-0 bg-[#222]" />
          )}
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

          {/* Featured Badge — always visible top-left */}
          {movie.featured && (
            <div className="absolute top-2 left-2 z-10">
              <span className="text-[10px] font-semibold bg-[#e50914] text-white px-2 py-0.5 rounded">
                DESTACADO
              </span>
            </div>
          )}

          {/* NUEVO Badge — only if not featured and created within 7 days */}
          {showNewBadge && (
            <div className="absolute top-2 left-2 z-10">
              <span className="bg-amber-500 text-black text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded">
                NUEVO
              </span>
            </div>
          )}

          {/* Maturity badge — always visible top-right */}
          <div className="absolute top-2 right-2 z-10">
            <span className="text-[10px] font-medium bg-black/70 text-white px-1.5 py-0.5 rounded">
              {movie.maturity}
            </span>
          </div>

          {/* Hover Overlay */}
          <div
            className={`absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent transition-opacity duration-300 ${
              isHovered ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {/* Play Button */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-3">
              <button
                className="w-12 h-12 rounded-full bg-white/90 hover:bg-white flex items-center justify-center transition-colors shadow-lg"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  openPlayer(movie);
                }}
                aria-label="Reproducir"
              >
                <Play className="h-5 w-5 text-black ml-0.5 fill-black" />
              </button>
              <button
                className="w-12 h-12 rounded-full bg-red-600/90 hover:bg-red-600 flex items-center justify-center transition-colors shadow-lg"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  openYouTubeTrailer(movie.title);
                }}
                aria-label="Ver Trailer"
              >
                <Youtube className="h-5 w-5 text-white fill-white" />
              </button>
            </div>

            {/* Add to List Button */}
            <button
              className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center transition-colors"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); toggleFav(); }}
              aria-label="Agregar a mi lista"
            >
              {isFav ? (
                <Check className="h-4 w-4 text-[#e50914]" />
              ) : (
                <Plus className="h-4 w-4 text-white" />
              )}
            </button>

            {/* Info at bottom of overlay */}
            <div className="absolute bottom-0 left-0 right-0 p-3">
              <TruncatedText text={movie.title} as="h3" className="text-sm font-semibold text-white mb-1" />
              <div className="flex items-center gap-2 text-xs">
                <span className="text-green-400 flex items-center gap-0.5">
                  <Star className="h-2.5 w-2.5 fill-green-400" />
                  {movie.rating.toFixed(1)}
                </span>
                <span className="text-gray-400">{movie.year}</span>
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

              {/* Star Rating on Hover */}
              <div className="flex items-center gap-0.5 mt-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={(e) => handleStarClick(e, n)}
                    className="p-0.5 hover:scale-125 transition-transform"
                    aria-label={`Calificar ${n} estrellas`}
                  >
                    <Star
                      className={`h-3 w-3 ${
                        (movie.userRating ?? 0) >= n
                          ? 'text-yellow-400 fill-yellow-400'
                          : 'text-gray-500'
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ALWAYS VISIBLE metadata below card */}
      <div className="mt-2 max-w-[160px] md:max-w-[180px]">
        {/* Title */}
        <TruncatedText text={movie.title} as="h3" className="text-xs font-medium text-gray-200 group-hover:text-white transition-colors" />

        {/* Rating + Year + Duration — always visible */}
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
          {movie.duration && (
            <span className="text-[11px] text-gray-500 flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />
              {movie.duration}
            </span>
          )}
        </div>

        {/* Genre — always visible */}
        {genres.length > 0 && (
          <div className="flex gap-1 mt-1">
            <TruncatedText text={genres.slice(0, 2).join(' · ')} as="span" className="text-[10px] text-gray-500 bg-white/5 rounded px-1.5 py-0.5 max-w-[160px]" />
          </div>
        )}
      </div>
    </div>
  );
}

export function MovieCardSkeleton() {
  return (
    <div className="shrink-0">
      <Skeleton className="aspect-[2/3] w-[140px] md:w-[180px] rounded-lg bg-[#222]" />
      <Skeleton className="h-3 w-[120px] mt-2 bg-[#222]" />
      <div className="flex gap-2 mt-1">
        <Skeleton className="h-2.5 w-8 bg-[#222]" />
        <Skeleton className="h-2.5 w-10 bg-[#222]" />
      </div>
    </div>
  );
}