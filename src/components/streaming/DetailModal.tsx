'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Play, Plus, Heart, Star, Clock, HardDrive, Globe, Award, Calendar, Youtube, RefreshCw, Search, Subtitles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { useAppStore, type Movie, type Episode } from '@/store/app-store';
import { cn } from '@/lib/utils';
import { TruncatedText } from '@/components/TruncatedText';
import { openYouTubeTrailer } from '@/lib/trailer';

export function DetailModal() {
  const { selectedMovie, isDetailOpen, closeDetail, openPlayer } =
    useAppStore();
  const [movieDetails, setMovieDetails] = useState<Movie | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [userRating, setUserRating] = useState<number>(0);
  const [imdbInput, setImdbInput] = useState('');
  const [enriching, setEnriching] = useState(false);
  const [enrichMsg, setEnrichMsg] = useState('');
  const [enrichOk, setEnrichOk] = useState(false);
  const [subtLoading, setSubtLoading] = useState(false);
  const [subtMsg, setSubtMsg] = useState('');

  const fetchDetails = useCallback(async (movieId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/movies/${movieId}`);
      if (res.ok) {
        const data = await res.json();
        setMovieDetails(data);
        setEpisodes(data.episodes || []);
        setUserRating(data.userRating ?? 0);
      }
    } catch {
      setMovieDetails(selectedMovie);
      setUserRating(selectedMovie?.userRating ?? 0);
    } finally {
      setLoading(false);
    }
  }, [selectedMovie]);

  // Check favorite status
  const checkFavorite = useCallback(async (movieId: string) => {
    try {
      const res = await fetch('/api/favorites');
      if (res.ok) {
        const data = await res.json();
        const fav = (data.favorites || []).find((f: { movieId: string }) => f.movieId === movieId);
        setIsFavorited(!!fav);
      }
    } catch {}
  }, []);

  const toggleFavorite = useCallback(async (movieId: string) => {
    try {
      const res = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ movieId }),
      });
      if (res.ok) {
        const data = await res.json();
        setIsFavorited(data.favorited);
      }
    } catch {}
  }, []);

  const handleRate = useCallback(async (movieId: string, rating: number) => {
    const newRating = userRating === rating ? 0 : rating;
    setUserRating(newRating);
    try {
      await fetch(`/api/movies/${movieId}/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: newRating }),
      });
      window.dispatchEvent(new CustomEvent('ratings-changed'));
    } catch {
      // revert on error
      setUserRating(rating === newRating ? 0 : rating);
    }
  }, [userRating]);

  const handleEnrich = useCallback(async () => {
    const m = movieDetails || selectedMovie;
    if (!m || !imdbInput.trim()) return;
    const imdbId = imdbInput.trim().startsWith('tt') ? imdbInput.trim() : `tt${imdbInput.trim()}`;
    setEnriching(true);
    setEnrichMsg('');
    setEnrichOk(false);
    try {
      const res = await fetch(`/api/movies/${m.id}/enrich`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imdbId }),
      });
      const data = await res.json();
      if (res.ok) {
        setEnrichOk(true);
        setEnrichMsg(data.message || 'Actualizado correctamente');
        fetchDetails(m.id);
        window.dispatchEvent(new CustomEvent('movies-changed'));
      } else {
        setEnrichOk(false);
        setEnrichMsg(data.error || 'Error al actualizar');
      }
    } catch {
      setEnrichOk(false);
      setEnrichMsg('Error de conexión');
    } finally {
      setEnriching(false);
    }
  }, [movieDetails, selectedMovie, imdbInput, fetchDetails]);

  const handleDownloadSubtitle = useCallback(async () => {
    const m = movieDetails || selectedMovie;
    if (!m?.imdbId) return;
    setSubtLoading(true);
    setSubtMsg('');
    try {
      const res = await fetch(`/api/movies/${m.id}/subtitles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'es' }),
      });
      const data = await res.json();
      if (res.ok) {
        setSubtMsg(`${data.message}${data.release ? ` (${data.release})` : ''}`);
        // Notify player to re-check subtitles
        window.dispatchEvent(new CustomEvent('subtitle-changed'));
      } else {
        setSubtMsg(data.error || 'Error al descargar subtítulos');
      }
    } catch {
      setSubtMsg('Error de conexión');
    } finally {
      setSubtLoading(false);
    }
  }, [movieDetails, selectedMovie]);

  useEffect(() => {
    if (isDetailOpen && selectedMovie) {
      document.body.style.overflow = 'hidden';
      fetchDetails(selectedMovie.id);
      checkFavorite(selectedMovie.id);
    } else {
      document.body.style.overflow = '';
      setMovieDetails(null);
      setEpisodes([]);
      setIsFavorited(false);
      setUserRating(0);
      setImdbInput('');
      setEnriching(false);
      setEnrichMsg('');
      setEnrichOk(false);
      setSubtLoading(false);
      setSubtMsg('');
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isDetailOpen, selectedMovie, fetchDetails, checkFavorite]);

  // Sync userRating when ratings-changed event fires
  useEffect(() => {
    const handler = () => {
      if (movieDetails) {
        fetchDetails(movieDetails.id);
      }
    };
    window.addEventListener('ratings-changed', handler);
    return () => window.removeEventListener('ratings-changed', handler);
  }, [movieDetails, fetchDetails]);

  if (!isDetailOpen) return null;

  const movie = movieDetails || selectedMovie;
  if (!movie) return null;

  const genres = movie.genre.split(',').map((g) => g.trim());
  const backdropUrl = movie.backdropImage;

  // Check if movie/series will use VidCore streaming (no local file, but has imdbId)
  const hasLocalFile = !!(movie.filePath || movie.videoUrl);
  const hasEpisodesWithFile = movie.type === 'series' && episodes.some((ep) => ep.filePath || ep.videoUrl);
  const usesVidCore = !hasLocalFile && !hasEpisodesWithFile && !!movie.imdbId;

  // Group episodes by season
  const seasons: Record<number, Episode[]> = {};
  episodes.forEach((ep) => {
    if (!seasons[ep.seasonNumber]) {
      seasons[ep.seasonNumber] = [];
    }
    seasons[ep.seasonNumber].push(ep);
  });
  const sortedSeasons = Object.keys(seasons).sort(
    (a, b) => Number(a) - Number(b)
  );

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[90] overflow-y-auto"
      >
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm"
          onClick={closeDetail}
        />

        {/* Modal Content */}
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 50 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="relative min-h-screen"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close Button */}
          <button
            onClick={closeDetail}
            className="fixed top-4 right-4 z-[95] w-10 h-10 rounded-full bg-[#181818] hover:bg-[#252525] flex items-center justify-center transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5 text-white" />
          </button>

          {/* Backdrop Image — poster only, no gradients */}
          <div className="relative h-[65vh] min-h-[400px] flex items-center justify-center overflow-hidden">
            {loading ? (
              <Skeleton className="w-full h-full bg-transparent" />
            ) : (
              <img
                src={backdropUrl}
                alt=""
                aria-hidden
                className="max-h-full max-w-full object-contain"
                onError={(e) => {
                  const el = e.target as HTMLImageElement;
                  el.style.display = 'none';
                }}
              />
            )}
          </div>

          {/* Content */}
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 -mt-48 relative z-10 pb-20">
            {loading ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-3/4 bg-[#222]" />
                <Skeleton className="h-4 w-1/2 bg-[#222]" />
                <Skeleton className="h-20 w-full bg-[#222]" />
              </div>
            ) : (
              <>
                {/* Title and Meta */}
                <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-3">
                  {movie.title}
                </h1>

                <div className="flex flex-wrap items-center gap-3 mb-4 text-sm">
                  <span className="text-green-400 font-semibold flex items-center gap-1">
                    <Star className="h-4 w-4 fill-green-400 text-green-400" />
                    {movie.rating.toFixed(1)}
                  </span>
                  <span className="text-gray-400">{movie.year}</span>
                  {movie.duration && (
                    <span className="text-gray-400 flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {movie.duration}
                    </span>
                  )}
                  <Badge
                    variant="secondary"
                    className="bg-white/20 text-white text-xs hover:bg-white/30"
                  >
                    {movie.maturity}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="border-white/20 text-gray-300 text-xs bg-white/5"
                  >
                    {movie.type === 'series' ? 'Serie' : 'Película'}
                  </Badge>
                  {movie.featured && (
                    <Badge className="bg-[#e50914] text-white text-xs hover:bg-[#e50914] border-0">
                      <Award className="h-3 w-3 mr-1" />
                      Destacado
                    </Badge>
                  )}
                </div>

                {/* Genre Tags */}
                <div className="flex flex-wrap gap-2 mb-5">
                  {genres.map((genre) => (
                    <Badge
                      key={genre}
                      variant="outline"
                      className="border-white/20 text-gray-300 text-xs bg-white/5 hover:bg-white/10"
                    >
                      {genre}
                    </Badge>
                  ))}
                </div>

                {/* Star Rating Section */}
                <div className="mb-6">
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        onClick={() => movie && handleRate(movie.id, n)}
                        className="p-0.5 hover:scale-110 transition-transform"
                        aria-label={`Calificar ${n} estrellas`}
                      >
                        <Star
                          className={cn(
                            'h-6 w-6 transition-colors',
                            userRating >= n
                              ? 'text-yellow-400 fill-yellow-400'
                              : 'text-gray-600 hover:text-gray-400'
                          )}
                        />
                      </button>
                    ))}
                  </div>
                  {userRating > 0 && (
                    <p className="text-sm text-gray-400 mt-1">
                      Tu calificación: <span className="text-yellow-400 font-medium">{userRating}/5</span>
                    </p>
                  )}
                  {userRating === 0 && (
                    <p className="text-sm text-gray-500 mt-1">
                      Haz clic para calificar
                    </p>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-3 mb-6">
                  <div className="flex items-center gap-3">
                    <Button
                      size="lg"
                      className="btn-primary text-base px-8 h-12 rounded-md font-semibold"
                      onClick={() => openPlayer(movie)}
                    >
                      <Play className="h-5 w-5 mr-2 fill-white" />
                      Reproducir
                    </Button>
                    {usesVidCore && (
                      <Badge className="bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 text-xs px-2.5 py-1 gap-1.5">
                        <Globe className="h-3 w-3" />
                        Streaming Externo
                      </Badge>
                    )}
                  </div>
                  <Button
                    size="lg"
                    variant="outline"
                    className={cn(
                      "border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white px-6 h-12 rounded-md",
                      isFavorited && "bg-[#e50914]/20 border-[#e50914]"
                    )}
                    onClick={() => movie && toggleFavorite(movie.id)}
                  >
                    <Plus className={cn("h-5 w-5 mr-2", isFavorited && "fill-white")} />
                    {isFavorited ? 'En Mi Lista' : 'Mi Lista'}
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    className={cn(
                      "border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white px-6 h-12 rounded-md",
                      isFavorited && "text-[#e50914]"
                    )}
                    onClick={() => movie && toggleFavorite(movie.id)}
                  >
                    <Heart className={cn("h-5 w-5 mr-2", isFavorited && "fill-[#e50914] text-[#e50914]")} />
                    Me Gusta
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    className="border-red-500/40 bg-red-600/20 text-red-400 hover:bg-red-600/30 hover:text-red-300 hover:border-red-500/60 px-6 h-12 rounded-md"
                    onClick={() => movie && openYouTubeTrailer(movie.title)}
                  >
                    <Youtube className="h-5 w-5 mr-2 fill-red-400" />
                    Ver Trailer
                  </Button>
                </div>

                {/* Description */}
                <p className="text-gray-300 text-base md:text-lg leading-relaxed mb-6 max-w-3xl">
                  {movie.description}
                </p>

                {/* IMDb Manual Enrich */}
                <div className="mb-4 p-4 rounded-lg bg-white/5 border border-white/10 max-w-3xl">
                  <div className="flex items-center gap-2 mb-3">
                    <Search className="h-4 w-4 text-gray-400" />
                    <span className="text-sm font-medium text-gray-300">Actualizar desde IMDb</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 font-mono select-all">tt</span>
                      <input
                        type="text"
                        value={imdbInput}
                        onChange={(e) => setImdbInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleEnrich()}
                        placeholder="ej: 0133093"
                        className="w-full bg-[#222] border border-white/10 rounded-md pl-8 pr-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-[#e50914]/50 font-mono"
                      />
                    </div>
                    <Button
                      onClick={handleEnrich}
                      disabled={enriching || !imdbInput.trim()}
                      variant="outline"
                      className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white px-4 h-9 text-sm shrink-0 disabled:opacity-40"
                    >
                      {enriching ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-1.5" />
                      )}
                      Actualizar
                    </Button>
                  </div>
                  {movie.imdbId && (
                    <p className="text-xs text-gray-500 mt-2">
                      IMDb ID actual: <span className="font-mono text-gray-400">{movie.imdbId}</span>
                    </p>
                  )}
                  {enrichMsg && (
                    <p className={cn('text-xs mt-2', enrichOk ? 'text-green-400' : 'text-red-400')}>
                      {enrichMsg}
                    </p>
                  )}
                </div>

                {/* Download Subtitles */}
                {movie.imdbId && (
                  <div className="mb-4 p-4 rounded-lg bg-white/5 border border-white/10 max-w-3xl">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Subtitles className="h-4 w-4 text-gray-400" />
                        <span className="text-sm font-medium text-gray-300">Descargar Subtítulos (es)</span>
                      </div>
                      <Button
                        onClick={handleDownloadSubtitle}
                        disabled={subtLoading}
                        variant="outline"
                        size="sm"
                        className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white px-3 h-8 text-xs disabled:opacity-40"
                      >
                        {subtLoading ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Subtitles className="h-3.5 w-3.5 mr-1.5" />
                        )}
                        Descargar
                      </Button>
                    </div>
                    {subtMsg && (
                      <p className={cn('text-xs mt-2', subtMsg.startsWith('Subtítulo') ? 'text-green-400' : 'text-red-400')}>
                        {subtMsg}
                      </p>
                    )}
                  </div>
                )}

                {/* Technical Info */}
                <div className="mb-8 p-4 rounded-lg bg-white/5 border border-white/10 max-w-3xl">
                  <div className="flex items-center gap-2 mb-3">
                    {usesVidCore ? (
                      <>
                        <Globe className="h-4 w-4 text-emerald-400" />
                        <span className="text-sm font-medium text-emerald-400">
                          Streaming vía VidCore
                        </span>
                      </>
                    ) : movie.local ? (
                      <>
                        <HardDrive className="h-4 w-4 text-[#e50914]" />
                        <span className="text-sm font-medium text-gray-300">
                          Archivo Local (HD)
                        </span>
                      </>
                    ) : (
                      <>
                        <Globe className="h-4 w-4 text-blue-400" />
                        <span className="text-sm font-medium text-gray-300">
                          Contenido Remoto
                        </span>
                      </>
                    )}
                  </div>
                  {movie.filePath && (
                    <p className="text-xs text-gray-500 font-mono break-all select-all cursor-text">
                      {movie.filePath}
                    </p>
                  )}
                  {movie.videoUrl && !movie.local && (
                    <p className="text-xs text-gray-500 font-mono break-all mt-1">
                      {movie.videoUrl}
                    </p>
                  )}
                  <div className="flex items-center gap-4 mt-3 pt-3 border-t border-white/10">
                    <span className="text-xs text-gray-500 flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      Agregado: {new Date(movie.createdAt).toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </span>
                    <span className="text-xs text-gray-500">
                      Actualizado: {new Date(movie.updatedAt).toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                </div>

                {/* Episodes for Series */}
                {movie.type === 'series' && sortedSeasons.length > 0 && (
                  <div className="mb-8">
                    <h2 className="text-2xl font-bold text-white mb-4">
                      Episodios
                    </h2>
                    <Accordion type="single" collapsible defaultValue="season-1">
                      {sortedSeasons.map((seasonNum) => (
                        <AccordionItem
                          key={`season-${seasonNum}`}
                          value={`season-${seasonNum}`}
                          className="border-white/10"
                        >
                          <AccordionTrigger className="text-white hover:no-underline hover:text-white/80 py-4 text-base">
                            <span className="flex items-center gap-3">
                              <span className="text-[#e50914] font-semibold">
                                Temporada {seasonNum}
                              </span>
                              <span className="text-gray-500 text-sm">
                                {seasons[Number(seasonNum)].length} episodios
                              </span>
                            </span>
                          </AccordionTrigger>
                          <AccordionContent className="pb-4">
                            <div className="space-y-2">
                              {seasons[Number(seasonNum)]
                                .sort(
                                  (a, b) => a.episodeNumber - b.episodeNumber
                                )
                                .map((episode) => (
                                  <button
                                    key={episode.id}
                                    className="w-full flex items-center gap-4 p-3 rounded-lg bg-[#222] hover:bg-[#2a2a2a] transition-colors text-left group"
                                    onClick={() =>
                                      openPlayer(movie, episode)
                                    }
                                  >
                                    {/* Episode Number */}
                                    <span className="text-2xl font-bold text-gray-500 w-10 text-center shrink-0">
                                      {episode.episodeNumber}
                                    </span>

                                    {/* Play Icon */}
                                    <div className="w-8 h-8 rounded-full border-2 border-gray-500 group-hover:border-white flex items-center justify-center shrink-0 transition-colors">
                                      <Play className="h-3.5 w-3.5 text-gray-500 group-hover:text-white transition-colors ml-0.5" />
                                    </div>

                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2">
                                        <TruncatedText text={episode.title} as="span" className="text-sm font-medium text-white" />
                                        {episode.duration && (
                                          <span className="text-xs text-gray-500 shrink-0">
                                            {episode.duration}
                                          </span>
                                        )}
                                      </div>
                                      {episode.description && (
                                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                                          {episode.description}
                                        </p>
                                      )}
                                    </div>
                                  </button>
                                ))}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </div>
                )}
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}