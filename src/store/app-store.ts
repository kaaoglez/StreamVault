import { create } from "zustand";

export interface Movie {
  id: string;
  imdbId?: string | null;
  title: string;
  description: string;
  coverImage: string;
  backdropImage: string;
  videoUrl?: string | null;
  filePath?: string | null;
  year: number;
  rating: number;
  duration?: string | null;
  genre: string;
  type: string;
  maturity: string;
  featured: boolean;
  local?: boolean;
  director?: string | null;
  actors?: string | null; // Legacy — code uses relational Actor + MovieActor tables
  createdAt: string;
  updatedAt: string;
  episodes?: Episode[];
}

export interface Episode {
  id: string;
  seriesId: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  description?: string | null;
  videoUrl?: string | null;
  filePath?: string | null;
  stillImage?: string | null;
  duration?: string | null;
}

interface AppState {
  // Movie selection
  selectedMovie: Movie | null;
  isDetailOpen: boolean;
  selectMovie: (movie: Movie) => void;
  closeDetail: () => void;

  // Video player
  isPlayerOpen: boolean;
  playingMovie: Movie | null;
  playingEpisode: Episode | null;
  openPlayer: (movie: Movie, episode?: Episode | null) => void;
  closePlayer: () => void;

  // Search
  searchQuery: string;
  isSearchOpen: boolean;
  setSearch: (query: string) => void;
  openSearch: () => void;
  closeSearch: () => void;
  toggleSearch: () => void;

  // Tab navigation
  activeTab: 'home' | 'movies' | 'series' | 'mylist';
  setActiveTab: (tab: 'home' | 'movies' | 'series' | 'mylist') => void;

  // Category filter
  activeCategory: string;
  setCategory: (category: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  // Movie selection
  selectedMovie: null,
  isDetailOpen: false,
  selectMovie: (movie) =>
    set({ selectedMovie: movie, isDetailOpen: true }),
  closeDetail: () =>
    set({ selectedMovie: null, isDetailOpen: false }),

  // Video player
  isPlayerOpen: false,
  playingMovie: null,
  playingEpisode: null,
  openPlayer: (movie, episode = null) =>
    set({
      isPlayerOpen: true,
      playingMovie: movie,
      playingEpisode: episode,
    }),
  closePlayer: () =>
    set({
      isPlayerOpen: false,
      // Keep playingMovie/playingEpisode so the PlayerContent can
      // reference them during cleanup (progress save, etc.)
      // and so the component never needs to unmount.
    }),

  // Search
  searchQuery: "",
  isSearchOpen: false,
  setSearch: (query) => set({ searchQuery: query }),
  openSearch: () => set({ isSearchOpen: true, searchQuery: "" }),
  closeSearch: () => set({ isSearchOpen: false, searchQuery: "" }),
  toggleSearch: () =>
    set((state) => ({
      isSearchOpen: !state.isSearchOpen,
      searchQuery: state.isSearchOpen ? "" : state.searchQuery,
    })),

  // Tab navigation
  activeTab: 'home' as const,
  setActiveTab: (tab) => set({ activeTab: tab }),

  // Category filter
  activeCategory: "all",
  setCategory: (category) => set({ activeCategory: category }),
}));
