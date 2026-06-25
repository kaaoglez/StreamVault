'use client';

import { useState, useEffect } from 'react';
import { Search, User, Menu, Film, Tv, List, Home, Shuffle, Loader2, LayoutGrid } from 'lucide-react';
import { SettingsPanel } from './SettingsPanel';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetClose,
} from '@/components/ui/sheet';
import { useAppStore, type AppState, type Movie } from '@/store/app-store';
import { cn } from '@/lib/utils';

const navTabs: { key: AppState['activeTab']; label: string; icon: typeof Home }[] = [
  { key: 'home', label: 'Inicio', icon: Home },
  { key: 'movies', label: 'Películas', icon: Film },
  { key: 'series', label: 'Series', icon: Tv },
  { key: 'mylist', label: 'Mi Lista', icon: List },
];

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [randomLoading, setRandomLoading] = useState(false);
  const { openSearch, activeTab, setActiveTab, openPlayer } = useAppStore();

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Scroll to top when switching tabs
  const handleTabClick = (tab: AppState['activeTab']) => {
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleRandomMovie = async () => {
    if (randomLoading) return;
    setRandomLoading(true);
    try {
      const res = await fetch('/api/movies/random');
      if (res.ok) {
        const movie: Movie = await res.json();
        openPlayer(movie);
      }
    } catch {
      // silently fail
    } finally {
      setRandomLoading(false);
    }
  };

  return (
    <nav
      className={cn(
        'fixed top-0 left-0 right-0 z-50 transition-all duration-500',
        scrolled
          ? 'bg-[#141414]/95 backdrop-blur-md shadow-lg shadow-black/20'
          : 'bg-gradient-to-b from-black/70 to-transparent'
      )}
    >
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 md:h-[68px]">
          {/* Logo + ¿Qué ver? */}
          <div className="flex items-center gap-3">
            <button
              className="flex items-center gap-2 shrink-0"
              onClick={() => handleTabClick('home')}
            >
              <span className="text-xl md:text-2xl font-bold text-[#e50914] tracking-tight">
                StreamVault
              </span>
            </button>

            {/* ¿Qué ver? Random Button */}
            <Button
              variant="ghost"
              size="sm"
              className="hidden sm:inline-flex items-center gap-1.5 text-white bg-white/10 hover:bg-white/20 hover:text-white h-9 px-3 text-xs font-medium rounded-md border border-white/10 transition-colors"
              onClick={handleRandomMovie}
              disabled={randomLoading}
              aria-label="¿Qué ver? Película aleatoria"
            >
              {randomLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Shuffle className="h-4 w-4" />
              )}
              ¿Qué ver?
            </Button>

            {/* Géneros Button */}
            <Button
              variant="ghost"
              size="sm"
              className="hidden sm:inline-flex items-center gap-1.5 text-white bg-white/10 hover:bg-white/20 hover:text-white h-9 px-3 text-xs font-medium rounded-md border border-white/10 transition-colors"
              onClick={openSearch}
              aria-label="Buscar por género"
            >
              <LayoutGrid className="h-4 w-4" />
              Géneros
            </Button>
          </div>

          {/* Desktop Nav Tabs */}
          <div className="hidden md:flex items-center gap-1 ml-8">
            {navTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => handleTabClick(tab.key)}
                  className={cn(
                    'px-3 py-1.5 text-sm font-medium rounded-md transition-colors duration-200 flex items-center gap-1.5',
                    isActive
                      ? 'text-white bg-white/10'
                      : 'text-gray-300 hover:text-white hover:bg-white/5'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Right Side Icons */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:text-white hover:bg-white/10"
              onClick={openSearch}
              aria-label="Search"
            >
              <Search className="h-5 w-5" />
            </Button>

            <SettingsPanel />

            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:text-white hover:bg-white/10 hidden sm:flex"
              aria-label="Profile"
            >
              <User className="h-5 w-5" />
            </Button>

            {/* Mobile Menu */}
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-white hover:text-white hover:bg-white/10 md:hidden"
                  aria-label="Menu"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="right"
                className="bg-[#141414] border-l border-white/10 w-72"
              >
                <div className="flex flex-col gap-2 mt-8">
                  {navTabs.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.key;
                    return (
                      <SheetClose asChild key={tab.key}>
                        <button
                          onClick={() => handleTabClick(tab.key)}
                          className={cn(
                            'flex items-center gap-3 px-4 py-3 rounded-lg text-lg transition-colors',
                            isActive
                              ? 'text-white bg-white/10'
                              : 'text-gray-300 hover:text-white hover:bg-white/5'
                          )}
                        >
                          <Icon className="h-5 w-5" />
                          {tab.label}
                        </button>
                      </SheetClose>
                    );
                  })}
                  <div className="border-t border-white/10 pt-4 mt-4">
                    <span className="text-xs text-gray-500 uppercase tracking-wider px-4">Herramientas</span>
                    <div className="mt-2">
                      <SheetClose asChild>
                        <button
                          onClick={openSearch}
                          className="flex items-center gap-3 px-4 py-3 rounded-lg text-lg text-gray-300 hover:text-white hover:bg-white/5 transition-colors w-full"
                        >
                          <LayoutGrid className="h-5 w-5" />
                          Géneros
                        </button>
                      </SheetClose>
                      <SettingsPanel />
                    </div>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </nav>
  );
}