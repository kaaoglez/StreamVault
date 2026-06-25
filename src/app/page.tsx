'use client';

import { useEffect } from 'react';
import { Navbar } from '@/components/streaming/Navbar';
import { HeroCarousel } from '@/components/streaming/HeroCarousel';
import { ContinueWatchingRow } from '@/components/streaming/ContinueWatchingRow';
import { ContentRow } from '@/components/streaming/ContentRow';
import { FavoritesRow } from '@/components/streaming/FavoritesRow';
import { DetailModal } from '@/components/streaming/DetailModal';
import { VideoPlayer } from '@/components/streaming/VideoPlayer';
import { SearchOverlay } from '@/components/streaming/SearchOverlay';
import { TrailerModal } from '@/components/streaming/TrailerModal';
import { KeyboardShortcuts } from '@/components/streaming/KeyboardShortcuts';
import { Footer } from '@/components/streaming/Footer';
import { MoviesPage } from '@/components/streaming/MoviesPage';
import { SeriesPage } from '@/components/streaming/SeriesPage';
import { MyListPage } from '@/components/streaming/MyListPage';
import { useAppStore } from '@/store/app-store';
import { Film, Tv, List, FolderOpen, PlayCircle } from 'lucide-react';
import { StatsSection } from '@/components/streaming/StatsSection';

function HomePage() {
  return (
    <>
      <HeroCarousel />

      <div className="relative z-10">

        {/* CONTINUAR VIENDO — right after Hero */}
        <section className="pt-4 md:pt-8">
          <div className="px-4 sm:px-6 lg:px-8 max-w-[1400px] mx-auto mb-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-600/20 flex items-center justify-center">
                <PlayCircle className="h-4.5 w-4.5 text-blue-400" />
              </div>
              <h2 className="text-2xl md:text-3xl font-bold text-white">Continuar Viendo</h2>
              <div className="flex-1 h-px bg-white/10 ml-2" />
            </div>
          </div>
          <ContinueWatchingRow />
        </section>

        {/* MI COLECCION — todo lo importado del HD */}
        <section className="pt-8 md:pt-12">
          <div className="px-4 sm:px-6 lg:px-8 max-w-[1400px] mx-auto mb-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#e50914]/20 flex items-center justify-center">
                <FolderOpen className="h-4.5 w-4.5 text-[#e50914]" />
              </div>
              <h2 className="text-2xl md:text-3xl font-bold text-white">Mi Colección</h2>
              <div className="flex-1 h-px bg-white/10 ml-2" />
            </div>
          </div>
          <ContentRow title="Mis Películas" fetchParam="recent" fetchType="movie" localOnly showEmpty />
          <ContentRow title="Mis Series" fetchParam="recent" fetchType="series" localOnly showEmpty />
        </section>

        {/* PELICULAS */}
        <section id="movies" className="pt-8 md:pt-12">
          <div className="px-4 sm:px-6 lg:px-8 max-w-[1400px] mx-auto mb-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#e50914]/20 flex items-center justify-center">
                <Film className="h-4.5 w-4.5 text-[#e50914]" />
              </div>
              <h2 className="text-2xl md:text-3xl font-bold text-white">Películas</h2>
              <div className="flex-1 h-px bg-white/10 ml-2" />
            </div>
          </div>
          <ContentRow title="Tendencias Ahora" fetchParam="trending" fetchType="movie" />
          <ContentRow title="Acción" fetchParam="genre:Action" fetchType="movie" />
          <ContentRow title="Ciencia Ficción" fetchParam="genre:Sci-Fi" fetchType="movie" />
          <ContentRow title="Drama" fetchParam="genre:Drama" fetchType="movie" />
          <ContentRow title="Thriller" fetchParam="genre:Thriller" fetchType="movie" />
          <ContentRow title="Documentales" fetchParam="genre:Documentary" fetchType="movie" />
        </section>

        {/* SERIES */}
        <section id="series" className="pt-12 md:pt-16">
          <div className="px-4 sm:px-6 lg:px-8 max-w-[1400px] mx-auto mb-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-purple-600/20 flex items-center justify-center">
                <Tv className="h-4.5 w-4.5 text-purple-400" />
              </div>
              <h2 className="text-2xl md:text-3xl font-bold text-white">Series</h2>
              <div className="flex-1 h-px bg-white/10 ml-2" />
            </div>
          </div>
          <ContentRow title="Series de Acción" fetchParam="genre:Action" fetchType="series" />
          <ContentRow title="Series de Drama" fetchParam="genre:Drama" fetchType="series" />
          <ContentRow title="Series Populares" fetchParam="trending" fetchType="series" />
        </section>

        {/* MI LISTA */}
        <section id="mylist" className="pt-12 md:pt-16 pb-8">
          <div className="px-4 sm:px-6 lg:px-8 max-w-[1400px] mx-auto mb-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-green-600/20 flex items-center justify-center">
                <List className="h-4.5 w-4.5 text-green-400" />
              </div>
              <h2 className="text-2xl md:text-3xl font-bold text-white">Mi Lista</h2>
              <div className="flex-1 h-px bg-white/10 ml-2" />
            </div>
          </div>
          <FavoritesRow />
        </section>

        {/* ESTADÍSTICAS */}
        <StatsSection />
      </div>
    </>
  );
}

export default function Home() {
  const { activeTab } = useAppStore();

  // Apply accent color from store on mount
  useEffect(() => {
    const color = useAppStore.getState().accentColor;
    document.documentElement.style.setProperty('--accent', color);
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-[#141414]">
      <Navbar />
      <main className="flex-1">
        {activeTab === 'home' && <HomePage />}
        {activeTab === 'movies' && (
          <div className="pt-20 md:pt-24">
            <MoviesPage />
          </div>
        )}
        {activeTab === 'series' && (
          <div className="pt-20 md:pt-24">
            <SeriesPage />
          </div>
        )}
        {activeTab === 'mylist' && (
          <div className="pt-20 md:pt-24">
            <MyListPage />
          </div>
        )}

        {/* Global Keyboard Shortcuts */}
        <KeyboardShortcuts />

        {/* Modals & Overlays */}
        <DetailModal />
        <TrailerModal />
        <VideoPlayer />
        <SearchOverlay />
      </main>
      <Footer />
    </div>
  );
}