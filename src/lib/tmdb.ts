const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

// Allow passing a key explicitly (from user settings) or from env
let _overrideKey: string | null = null;

export function setApiKey(key: string | null) {
  _overrideKey = key;
}

function getApiKey(): string {
  const key = _overrideKey || process.env.TMDB_API_KEY;
  if (!key || key === 'your_api_key_here') {
    throw new Error('TMDB_API_KEY no está configurada.');
  }
  return key;
}

async function tmdbFetch(endpoint: string, params: Record<string, string> = {}): Promise<any> {
  const apiKey = getApiKey();
  const url = new URL(`${TMDB_BASE_URL}${endpoint}`);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('language', 'es-ES');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url.toString(), {
    next: { revalidate: 3600 }, // Cache for 1 hour
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TMDB API error ${res.status}: ${text}`);
  }

  return res.json();
}

// ─── Image Helpers ───────────────────────────────────────────────

export function getPosterUrl(path: string | null, size: string = 'w500'): string {
  if (!path) return '/placeholder-poster.svg';
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

export function getBackdropUrl(path: string | null, size: string = 'w1280'): string {
  if (!path) return '/placeholder-backdrop.svg';
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

// ─── Movies ──────────────────────────────────────────────────────

export interface TMDBMovie {
  id: number;
  title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  vote_average: number;
  genre_ids: number[];
  adult: boolean;
  popularity: number;
}

export interface TMDBMovieDetail extends TMDBMovie {
  runtime: number;
  genres: { id: number; name: string }[];
  tagline?: string;
}

export async function getPopularMovies(page: number = 1): Promise<{ results: TMDBMovie[]; total_pages: number }> {
  return tmdbFetch('/movie/popular', { page: String(page) });
}

export async function getTopRatedMovies(page: number = 1): Promise<{ results: TMDBMovie[] }> {
  return tmdbFetch('/movie/top_rated', { page: String(page) });
}

export async function getTrendingMovies(page: number = 1): Promise<{ results: TMDBMovie[] }> {
  return tmdbFetch('/trending/movie/week', { page: String(page) });
}

export async function getMovieDetails(id: number): Promise<TMDBMovieDetail> {
  return tmdbFetch(`/movie/${id}`);
}

export async function searchMovies(query: string, page: number = 1): Promise<{ results: TMDBMovie[]; total_results: number }> {
  return tmdbFetch('/search/movie', { query, page: String(page) });
}

// ─── TV Shows ────────────────────────────────────────────────────

export interface TMDBTVShow {
  id: number;
  name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  first_air_date: string;
  vote_average: number;
  genre_ids: number[];
  origin_country: string[];
  popularity: number;
}

export interface TMDBTVDetail extends TMDBTVShow {
  number_of_seasons: number;
  number_of_episodes: number;
  genres: { id: number; name: string }[];
  seasons: TMDBSeason[];
  tagline?: string;
}

export interface TMDBSeason {
  id: number;
  season_number: number;
  name: string;
  episode_count: number;
  poster_path: string | null;
  overview: string;
}

export interface TMDBEpisode {
  id: number;
  season_number: number;
  episode_number: number;
  name: string;
  overview: string;
  still_path: string | null;
  runtime: number | null;
  air_date: string;
  vote_average: number;
}

export async function getPopularTV(page: number = 1): Promise<{ results: TMDBTVShow[]; total_pages: number }> {
  return tmdbFetch('/tv/popular', { page: String(page) });
}

export async function getTopRatedTV(page: number = 1): Promise<{ results: TMDBTVShow[] }> {
  return tmdbFetch('/tv/top_rated', { page: String(page) });
}

export async function getTrendingTV(page: number = 1): Promise<{ results: TMDBTVShow[] }> {
  return tmdbFetch('/trending/tv/week', { page: String(page) });
}

export async function getTVDetails(id: number): Promise<TMDBTVDetail> {
  return tmdbFetch(`/tv/${id}`);
}

export async function getTVSeasonDetails(tvId: number, seasonNumber: number): Promise<{ episodes: TMDBEpisode[] }> {
  return tmdbFetch(`/tv/${tvId}/season/${seasonNumber}`);
}

export async function searchTV(query: string, page: number = 1): Promise<{ results: TMDBTVShow[]; total_results: number }> {
  return tmdbFetch('/search/tv', { query, page: String(page) });
}

// ─── Genres ──────────────────────────────────────────────────────

export interface TMDBGenre {
  id: number;
  name: string;
}

export async function getMovieGenres(): Promise<{ genres: TMDBGenre[] }> {
  return tmdbFetch('/genre/movie/list');
}

export async function getTVGenres(): Promise<{ genres: TMDBGenre[] }> {
  return tmdbFetch('/genre/tv/list');
}

// ─── Multi Search ────────────────────────────────────────────────

export interface TMDBMultiResult {
  id: number;
  title?: string;
  name?: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  media_type: 'movie' | 'tv';
  release_date?: string;
  first_air_date?: string;
  vote_average: number;
  genre_ids: number[];
  popularity: number;
}

export async function multiSearch(query: string, page: number = 1): Promise<{ results: TMDBMultiResult[]; total_results: number }> {
  return tmdbFetch('/search/multi', { query, page: String(page) });
}

// ─── Now Playing (Theaters) ──────────────────────────────────

export async function getNowPlayingMovies(page: number = 1): Promise<{ results: TMDBMovie[]; total_pages: number }> {
  return tmdbFetch('/movie/now_playing', { page: String(page) });
}

export async function getNowPlayingTV(page: number = 1): Promise<{ results: TMDBTVShow[]; total_pages: number }> {
  return tmdbFetch('/tv/airing_today', { page: String(page) });
}

// ─── Videos / Trailers ──────────────────────────────────────

export interface TMDBVideo {
  id: string;
  key: string;       // YouTube key
  name: string;
  site: string;      // "YouTube"
  type: string;      // "Trailer", "Teaser", "Clip", etc.
  official: boolean;
  published_at: string;
}

export async function getMovieVideos(movieId: number): Promise<{ results: TMDBVideo[] }> {
  return tmdbFetch(`/movie/${movieId}/videos`, { language: 'es-ES' });
}

export async function getTVVideos(tvId: number): Promise<{ results: TMDBVideo[] }> {
  return tmdbFetch(`/tv/${tvId}/videos`, { language: 'es-ES' });
}

/** Get the best trailer (prefer official Trailer, fallback to Teaser, then any YouTube video) */
export function pickTrailer(videos: TMDBVideo[]): TMDBVideo | null {
  if (!videos.length) return null;
  // 1. Official Trailer
  const official = videos.find(v => v.site === 'YouTube' && v.type === 'Trailer' && v.official);
  if (official) return official;
  // 2. Any Trailer
  const anyTrailer = videos.find(v => v.site === 'YouTube' && v.type === 'Trailer');
  if (anyTrailer) return anyTrailer;
  // 3. Official Teaser
  const teaser = videos.find(v => v.site === 'YouTube' && v.type === 'Teaser' && v.official);
  if (teaser) return teaser;
  // 4. Any YouTube video
  const yt = videos.find(v => v.site === 'YouTube');
  return yt || null;
}