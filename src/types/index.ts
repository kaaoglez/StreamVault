export interface Movie {
  id: string;
  title: string;
  description: string;
  coverImage: string;
  backdropImage: string;
  videoUrl: string | null;
  filePath: string | null;
  year: number;
  rating: number;
  duration: string | null;
  genre: string;
  type: 'movie' | 'series';
  maturity: string;
  featured: boolean;
  local: boolean;
  createdAt: string;
  updatedAt: string;
  // Computed fields (not in DB)
  isFavorite?: boolean;
  watchProgress?: number;
  episodes?: Episode[];
}

export interface Episode {
  id: string;
  seriesId: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  description: string | null;
  videoUrl: string | null;
  filePath: string | null;
  stillImage: string | null;
  duration: string | null;
  createdAt: string;
  updatedAt: string;
  watchProgress?: number;
}

export interface SeasonGroup {
  seasonNumber: number;
  episodes: Episode[];
}

export interface Favorite {
  id: string;
  movieId: string;
  createdAt: string;
}

export interface WatchProgress {
  id: string;
  movieId: string;
  episodeId: string | null;
  progress: number;
  lastWatched: string;
  createdAt: string;
  updatedAt: string;
}

export interface MovieListResponse {
  movies: Movie[];
  total: number;
}

export interface MovieDetailResponse extends Movie {
  seasons?: SeasonGroup[];
}