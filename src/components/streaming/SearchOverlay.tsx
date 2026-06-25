'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Shuffle, Film, Tv, Tag, Globe, Loader2, Plus, Check, Calendar } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useAppStore, type Movie } from '@/store/app-store';
import { MovieCard } from './MovieCard';

type SearchType = 'all' | 'movie' | 'series';

interface OmdbResult {
  Title: string;
  Year: string;
  imdbID: string;
  Type: string;
  Poster: string;
}

export function SearchOverlay() {
  const { isSearchOpen, searchQuery, setSearch, closeSearch, selectMovie } = useAppStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<Movie[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [typeFilter, setTypeFilter] = useState<SearchType>('all');
  const [genreFilter, setGenreFilter] = useState<string | null>(null);
  const [randomMovie, setRandomMovie] = useState<Movie | null>(null);
  const [loadingRandom, setLoadingRandom] = useState(false);
  const [yearFilter, setYearFilter] = useState<string>('');
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // ─── OMDB external search state ─────────────────────────
  const [omdbResults, setOmdbResults] = useState<OmdbResult[]>([]);
  const [isSearchingOmdb, setIsSearchingOmdb] = useState(false);
  const [omdbError, setOmdbError] = useState<string | null>(null);
  const [addingImdbId, setAddingImdbId] = useState<string | null>(null);
  const [addedImdbIds, setAddedImdbIds] = useState<Set<string>>(new Set());
  const omdbSearchedRef = useRef('');

  const GENRES = ['Action', 'Drama', 'Comedy', 'Thriller', 'Sci-Fi', 'Horror', 'Romance', 'Animation', 'Documentary', 'Crime', 'Fantasy', 'Mystery'];

  useEffect(() => {
    if (isSearchOpen) {
      document.body.style.overflow = 'hidden';
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      document.body.style.overflow = '';
      setResults([]);
      setRandomMovie(null);
      setTypeFilter('all');
      setGenreFilter(null);
      setYearFilter('');
      setOmdbResults([]);
      setOmdbError(null);
      setAddedImdbIds(new Set());
      omdbSearchedRef.current = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isSearchOpen]);

  // ─── OMDB search (only when local results are empty) ───
  const searchOmdb = useCallback(async (query: string) => {
    if (!query.trim() || query === omdbSearchedRef.current) return;
    omdbSearchedRef.current = query;

    setIsSearchingOmdb(true);
    setOmdbError(null);
    setOmdbResults([]);
    setAddedImdbIds(new Set());

    try {
      const body: { query: string; type?: string; year?: string } = { query: query.trim() };
      if (typeFilter !== 'all') body.type = typeFilter;
      if (yearFilter) body.year = yearFilter;

      const res = await fetch('/api/search-omdb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.status === 429) {
        setOmdbError('Límite diario alcanzado en OMDB');
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setOmdbError(data.error || 'Error al buscar externamente');
        return;
      }

      const data = await res.json();
      setOmdbResults(data.results || []);
    } catch {
      setOmdbError('Error de conexión');
    } finally {
      setIsSearchingOmdb(false);
    }
  }, [typeFilter, yearFilter]);

  // ─── Add external movie to DB ───────────────────────────
  const handleAddExternal = useCallback(async (imdbId: string) => {
    if (addingImdbId) return;
    setAddingImdbId(imdbId);

    try {
      const res = await fetch('/api/movies/add-external', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imdbId }),
      });

      const data = await res.json();

      if (res.status === 409) {
        // Already exists — select it
        if (data.movie) {
          selectMovie(data.movie as Movie);
          closeSearch();
          window.dispatchEvent(new CustomEvent('movies-changed'));
        }
        return;
      }

      if (!res.ok) {
        setOmdbError(data.error || 'Error al agregar');
        return;
      }

      // Mark as added
      setAddedImdbIds(prev => new Set(prev).add(imdbId));

      // Refresh the app
      window.dispatchEvent(new CustomEvent('movies-changed'));

      // Select and open the new movie
      if (data.movie) {
        // Small delay so the movies-changed event refreshes data
        setTimeout(() => {
          selectMovie(data.movie as Movie);
          closeSearch();
        }, 300);
      }
    } catch {
      setOmdbError('Error de conexión al agregar');
    } finally {
      setAddingImdbId(null);
    }
  }, [addingImdbId, selectMovie, closeSearch]);

  // ─── Local search ───────────────────────────────────────
  const handleSearch = useCallback((query: string) => {
    setSearch(query);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim()) {
      setGenreFilter(null);
    }

    if (!query.trim() && !genreFilter && !yearFilter) {
      setResults([]);
      setOmdbResults([]);
      setOmdbError(null);
      return;
    }

    setIsSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ limit: '20' });
        if (typeFilter !== 'all') params.set('type', typeFilter);
        if (query.trim()) params.set('search', query.trim());
        if (yearFilter) params.set('year', yearFilter);
        const res = await fetch(`/api/movies?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          const movies = data.movies || [];
          setResults(movies);

          // If no local results and there's a text query → search OMDB (not for external)
          if (movies.length === 0 && query.trim().length >= 2) {
            searchOmdb(query);
          } else {
            setOmdbResults([]);
            setOmdbError(null);
          }
        }
      } catch {
      } finally {
        setIsSearching(false);
      }
    }, 300);
  }, [setSearch, typeFilter, genreFilter, yearFilter, searchOmdb]);

  // Re-search when type or year filter changes while there's an active query or year
  useEffect(() => {
    if (searchQuery.trim() || yearFilter) {
      omdbSearchedRef.current = ''; // allow re-search OMDB
      handleSearch(searchQuery);
    }
  }, [typeFilter, yearFilter, handleSearch]);

  const handleRandomPick = useCallback(async () => {
    if (loadingRandom) return;
    setLoadingRandom(true);
    setRandomMovie(null);
    try {
      const params = new URLSearchParams();
      if (typeFilter !== 'all') {
        params.set('type', typeFilter);
      }
      const res = await fetch(`/api/movies/random?${params.toString()}`);
      if (res.ok) {
        const movie = await res.json();
        setRandomMovie(movie);
      }
    } catch {
      // silently fail
    } finally {
      setLoadingRandom(false);
    }
  }, [loadingRandom, typeFilter]);

  const handleGenreClick = useCallback(async (genre: string) => {
    const newGenre = genreFilter === genre ? null : genre;
    setGenreFilter(newGenre);
    if (newGenre) setSearch(''); // clear text search
    setIsSearching(true);
    setResults([]);
    setOmdbResults([]);
    setOmdbError(null);
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (typeFilter !== 'all') params.set('type', typeFilter);
      if (newGenre) params.set('genre', newGenre);
      const res = await fetch(`/api/movies?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setResults(data.movies || []);
      }
    } catch {} finally {
      setIsSearching(false);
    }
  }, [genreFilter, typeFilter, setSearch]);

  // Re-search when type filter changes with active genre
  useEffect(() => {
    if (genreFilter) {
      handleGenreClick(genreFilter);
    }
  }, [typeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isSearchOpen) {
        closeSearch();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearchOpen, closeSearch]);

  if (!isSearchOpen) return null;

  const filterButtons: { label: string; value: SearchType; icon: React.ReactNode }[] = [
    { label: 'Todos', value: 'all', icon: <Search className="h-3.5 w-3.5" /> },
    { label: 'Películas', value: 'movie', icon: <Film className="h-3.5 w-3.5" /> },
    { label: 'Series', value: 'series', icon: <Tv className="h-3.5 w-3.5" /> },
  ];

  const showOmdbSection = searchQuery.trim().length >= 2 && results.length === 0 && !isSearching;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[80]"
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-[#141414]/95 backdrop-blur-md"
          onClick={closeSearch}
        />

        {/* Content */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.2 }}
          className="relative z-10 max-w-4xl mx-auto px-4 pt-8 pb-20 overflow-y-auto h-full"
        >
          {/* Search Input */}
          <div className="flex items-center gap-4 mb-4">
            <Search className="h-6 w-6 text-gray-400 shrink-0" />
            <Input
              ref={inputRef}
              type="text"
              placeholder="Buscar películas, series..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="flex-1 h-14 bg-transparent border-white/20 text-white text-xl placeholder:text-gray-600 focus:border-[var(--accent,#e50914)] rounded-md"
            />
            <button
              onClick={closeSearch}
              className="shrink-0 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
              aria-label="Close search"
            >
              <X className="h-5 w-5 text-white" />
            </button>
          </div>

          {/* Type Filter Chips */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {filterButtons.map((btn) => (
              <button
                key={btn.value}
                onClick={() => setTypeFilter(btn.value)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  typeFilter === btn.value
                    ? 'bg-white text-black'
                    : 'bg-white/10 text-gray-400 hover:bg-white/20 hover:text-white'
                }`}
              >
                {btn.icon}
                {btn.label}
              </button>
            ))}

            {/* Year Filter */}
            <div className="inline-flex items-center gap-1.5 bg-white/10 rounded-full px-3 py-1.5">
              <Calendar className="h-3.5 w-3.5 text-gray-400" />
              <input
                type="number"
                min="1900"
                max="2030"
                placeholder="Año"
                value={yearFilter}
                onChange={(e) => {
                  const val = e.target.value;
                  setYearFilter(val);
                  omdbSearchedRef.current = '';
                  if (searchQuery.trim()) {
                    handleSearch(searchQuery);
                  } else {
                    // Year-only search (no text query)
                    if (debounceRef.current) clearTimeout(debounceRef.current);
                    setIsSearching(true);
                    debounceRef.current = setTimeout(async () => {
                      try {
                        const params = new URLSearchParams({ limit: '20' });
                        if (typeFilter !== 'all') params.set('type', typeFilter);
                        if (val) params.set('year', val);
                        const res = await fetch(`/api/movies?${params.toString()}`);
                        if (res.ok) {
                          const data = await res.json();
                          setResults(data.movies || []);
                        }
                      } catch {} finally {
                        setIsSearching(false);
                      }
                    }, 300);
                  }
                }}
                className="w-14 bg-transparent text-sm text-gray-300 placeholder:text-gray-600 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>

          {/* Genre Filter Chips */}
          <div className="flex items-center gap-2 mb-6 flex-wrap">
            <Tag className="h-3.5 w-3.5 text-gray-500 shrink-0" />
            {GENRES.map((genre) => (
              <button
                key={genre}
                onClick={() => handleGenreClick(genre)}
                className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  genreFilter === genre
                    ? 'bg-[var(--accent,#e50914)] text-white'
                    : 'bg-white/5 text-gray-500 hover:bg-white/15 hover:text-gray-300 border border-white/10'
                }`}
              >
                {genre}
              </button>
            ))}
          </div>

          {/* ─── Local Results ──────────────────────────── */}
          {(searchQuery.trim() || genreFilter || yearFilter) && (
            <div>
              <h3 className="text-lg font-semibold text-white mb-4">
                {isSearching
                  ? 'Buscando...'
                  : results.length > 0
                    ? genreFilter && !searchQuery.trim() && !yearFilter
                      ? `${genreFilter}`
                      : yearFilter && !searchQuery.trim() && !genreFilter
                        ? `Películas de ${yearFilter}`
                        : `Resultados para "${searchQuery}"${yearFilter ? ' (' + yearFilter + ')' : ''}`
                    : 'No se encontraron resultados'}
              </h3>

              {isSearching ? (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div
                      key={i}
                      className="aspect-[2/3] bg-[#222] rounded-lg animate-pulse"
                    />
                  ))}
                </div>
              ) : results.length > 0 ? (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                  {results.map((movie) => (
                    <MovieCard key={movie.id} movie={movie} />
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {/* ─── OMDB External Results ──────────────────── */}
          <AnimatePresence>
            {showOmdbSection && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mt-6"
              >
                <div className="flex items-center gap-2 mb-3">
                  <Globe className="h-4 w-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold text-emerald-400 uppercase tracking-wider">
                    Resultados externos
                  </h3>
                  {isSearchingOmdb && (
                    <Loader2 className="h-3.5 w-3.5 text-gray-400 animate-spin" />
                  )}
                </div>
                <p className="text-xs text-gray-500 mb-3">
                  Selecciona para agregar a tu biblioteca y reproducir vía streaming
                </p>

                {omdbError ? (
                  <div className="bg-white/5 border border-white/10 rounded-lg p-4 text-center">
                    <p className="text-gray-400 text-sm">{omdbError}</p>
                  </div>
                ) : isSearchingOmdb ? (
                  <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="h-16 bg-[#222] rounded-lg animate-pulse" />
                    ))}
                  </div>
                ) : omdbResults.length > 0 ? (
                  <div className="space-y-1.5 max-h-[60vh] overflow-y-auto no-scrollbar">
                    {omdbResults.map((item) => {
                      const isAdding = addingImdbId === item.imdbID;
                      const isAdded = addedImdbIds.has(item.imdbID);
                      const posterUrl = item.Poster && item.Poster !== 'N/A' ? item.Poster : null;

                      return (
                        <motion.button
                          key={item.imdbID}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.15 }}
                          disabled={isAdding || isAdded}
                          className={`w-full flex items-center gap-3 p-2.5 rounded-lg transition-colors text-left group ${
                            isAdded
                              ? 'bg-emerald-500/10 border border-emerald-500/20'
                              : 'bg-white/5 hover:bg-white/10 border border-transparent'
                          }`}
                          onClick={() => handleAddExternal(item.imdbID)}
                        >
                          {/* Poster thumbnail */}
                          <div className="w-10 h-14 rounded-md overflow-hidden bg-white/10 shrink-0 flex items-center justify-center">
                            {posterUrl ? (
                              <img
                                src={posterUrl}
                                alt=""
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <Film className="h-4 w-4 text-gray-600" />
                            )}
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium truncate ${isAdded ? 'text-emerald-400' : 'text-white'}`}>
                              {item.Title}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-gray-500">{item.Year}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                item.Type === 'series'
                                  ? 'bg-purple-500/20 text-purple-400'
                                  : 'bg-blue-500/20 text-blue-400'
                              }`}>
                                {item.Type === 'series' ? 'Serie' : 'Película'}
                              </span>
                              <span className="text-[10px] text-gray-600 font-mono">{item.imdbID}</span>
                            </div>
                          </div>

                          {/* Action */}
                          <div className="shrink-0">
                            {isAdding ? (
                              <Loader2 className="h-5 w-5 text-emerald-400 animate-spin" />
                            ) : isAdded ? (
                              <div className="flex items-center gap-1 text-emerald-400 text-xs font-medium">
                                <Check className="h-4 w-4" />
                                <span className="hidden sm:inline">Agregado</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 text-gray-400 group-hover:text-white transition-colors">
                                <Plus className="h-4 w-4" />
                                <span className="text-xs font-medium">Agregar</span>
                              </div>
                            )}
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="bg-white/5 border border-white/10 rounded-lg p-6 text-center">
                    <p className="text-gray-500 text-sm">
                      No se encontró &quot;{searchQuery}&quot; en IMDb
                    </p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* ─── Empty State — no query ──────────────────── */}
          {!searchQuery.trim() && !genreFilter && !yearFilter && (
            <div className="text-center py-20">
              <p className="text-gray-500 text-lg mb-8">
                Escribe algo para comenzar a buscar
              </p>

              {/* Random Pick Button */}
              <button
                onClick={handleRandomPick}
                disabled={loadingRandom}
                className="inline-flex items-center gap-2.5 px-6 py-3 rounded-full bg-white/10 hover:bg-white/20 text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loadingRandom ? (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  >
                    <Shuffle className="h-5 w-5" />
                  </motion.div>
                ) : (
                  <Shuffle className="h-5 w-5" />
                )}
                ¿Qué ver?
              </button>

              {/* Random Movie Result */}
              {randomMovie && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-6 flex flex-col items-center gap-3"
                >
                  <div
                    className="w-36 aspect-[2/3] rounded-lg bg-cover bg-center cursor-pointer hover:scale-105 transition-transform"
                    style={{ backgroundImage: `url(${randomMovie.coverImage})` }}
                    onClick={() => {
                      selectMovie(randomMovie);
                      closeSearch();
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Ver ${randomMovie.title}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        selectMovie(randomMovie);
                        closeSearch();
                      }
                    }}
                  />
                  <p className="text-white font-medium">{randomMovie.title}</p>
                  <p className="text-xs text-gray-500">{randomMovie.year} · {randomMovie.genre}</p>
                </motion.div>
              )}
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}