'use client';

import { useEffect, useState } from 'react';
import {
  Film,
  Tv,
  Heart,
  Play,
  CheckCircle,
  Sparkles,
  Star,
  TrendingUp,
  Loader2,
} from 'lucide-react';
import { useAppStore } from '@/store/app-store';

interface Stats {
  totalMovies: number;
  totalSeries: number;
  totalFavorites: number;
  totalWatched: number;
  totalCompleted: number;
  totalSessions: number;
  ratedCount: number;
  avgUserRating: number;
  topGenres: { name: string; count: number }[];
  mostWatched: { title: string; count: number } | null;
  newAdditions: number;
}

const GENRE_COLORS: Record<string, string> = {
  Action: 'bg-red-500/20 text-red-400 border border-red-500/30',
  'Sci-Fi': 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30',
  Horror: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
  Drama: 'bg-purple-500/20 text-purple-400 border border-purple-500/30',
  Thriller: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  Romance: 'bg-pink-500/20 text-pink-400 border border-pink-500/30',
  Comedy: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  Documentary: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
  Animation: 'bg-violet-500/20 text-violet-400 border border-violet-500/30',
  Crime: 'bg-rose-500/20 text-rose-400 border border-rose-500/30',
  Fantasy: 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30',
  Mystery: 'bg-teal-500/20 text-teal-400 border border-teal-500/30',
};

const DEFAULT_GENRE = 'bg-white/10 text-gray-300 border border-white/10';

export function StatsSection() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/stats')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setStats(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
  return () => {
      cancelled = true;
    };
  }, []);

  const statCards = stats
    ? [
        { label: 'Películas', value: stats.totalMovies, icon: Film, color: 'text-red-400' },
        { label: 'Series', value: stats.totalSeries, icon: Tv, color: 'text-purple-400' },
        { label: 'En Mi Lista', value: stats.totalFavorites, icon: Heart, color: 'text-green-400' },
        { label: 'Vistas', value: stats.totalWatched, icon: Play, color: 'text-blue-400' },
        { label: 'Completadas', value: stats.totalCompleted, icon: CheckCircle, color: 'text-emerald-400' },
        { label: 'Nuevas', value: stats.newAdditions, icon: Sparkles, color: 'text-amber-400' },
      ]
    : [];

  return (
    <section id="stats" className="pt-12 md:pt-16 pb-8">
      <div className="px-4 sm:px-6 lg:px-8 max-w-[1400px] mx-auto">
        {/* Section Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
            <TrendingUp className="h-4.5 w-4.5 text-white" />
          </div>
          <h2 className="text-2xl md:text-3xl font-bold text-white">Estadísticas</h2>
          <div className="flex-1 h-px bg-white/10 ml-2" />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 text-gray-500 animate-spin" />
          </div>
        ) : stats ? (
          <div className="space-y-6">
            {/* Stat Cards Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {statCards.map((card) => (
                <div
                  key={card.label}
                  className="bg-[#1a1a1a] border border-white/10 rounded-xl p-4 flex flex-col items-center text-center gap-2"
                >
                  <card.icon className={`h-5 w-5 ${card.color}`} />
                  <span className="text-2xl md:text-3xl font-bold text-white">
                    {card.value}
                  </span>
                  <span className="text-xs text-gray-500 uppercase tracking-wide">
                    {card.label}
                  </span>
                </div>
              ))}
            </div>

            {/* Bottom Row: Genres, Rating, Most Watched */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Top Genres */}
              <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
                  Top Géneros
                </h3>
                <div className="flex flex-wrap gap-2">
                  {stats.topGenres.length > 0 ? (
                    stats.topGenres.map((g) => (
                      <span
                        key={g.name}
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                          GENRE_COLORS[g.name] || DEFAULT_GENRE
                        }`}
                      >
                        {g.name}
                        <span className="ml-1.5 opacity-60">{g.count}</span>
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-gray-600">Sin datos</span>
                  )}
                </div>
              </div>

              {/* Average Rating */}
              <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
                  Calificación Promedio
                </h3>
                <div className="flex items-center gap-3">
                  <Star className="h-6 w-6 text-amber-400 fill-amber-400" />
                  <span className="text-3xl font-bold text-white">
                    {stats.avgUserRating > 0 ? stats.avgUserRating.toFixed(1) : '—'}
                  </span>
                  <span className="text-lg text-gray-500">/5</span>
                </div>
                {stats.ratedCount > 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    {stats.ratedCount} {stats.ratedCount === 1 ? 'calificación' : 'calificaciones'}
                  </p>
                )}
              </div>

              {/* Most Watched */}
              <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
                  Más Visto
                </h3>
                {stats.mostWatched ? (
                  <div>
                    <p className="text-lg font-semibold text-white truncate">
                      {stats.mostWatched.title}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {stats.mostWatched.count} {stats.mostWatched.count === 1 ? 'sesión' : 'sesiones'}
                    </p>
                  </div>
                ) : (
                  <span className="text-sm text-gray-600">Sin datos</span>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}