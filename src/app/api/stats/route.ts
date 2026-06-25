import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const [
      totalMovies,
      totalSeries,
      totalFavorites,
      allProgress,
      allMovies,
    ] = await Promise.all([
      db.movie.count({ where: { type: 'movie' } }),
      db.movie.count({ where: { type: 'series' } }),
      db.favorite.count(),
      db.watchProgress.findMany({
        select: { movieId: true, progress: true, lastWatched: true, episodeId: true },
      }),
      db.movie.findMany({
        select: { id: true, title: true, type: true, genre: true, userRating: true, rating: true, createdAt: true },
      }),
    ])

    // Total unique movies watched (progress > 0)
    const watchedIds = new Set(allProgress.filter(p => p.progress > 0).map(p => p.movieId))
    const totalWatched = watchedIds.size

    // Genre frequency
    const genreCount: Record<string, number> = {}
    for (const m of allMovies) {
      const genres = m.genre.split(',').map(g => g.trim()).filter(Boolean)
      for (const g of genres) {
        genreCount[g] = (genreCount[g] || 0) + 1
      }
    }
    const topGenres = Object.entries(genreCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }))

    // Average user rating
    const ratedMovies = allMovies.filter(m => m.userRating !== null && m.userRating > 0)
    const avgUserRating = ratedMovies.length > 0
      ? ratedMovies.reduce((s, m) => s + (m.userRating || 0), 0) / ratedMovies.length
      : 0

    // Most watched movie (by number of progress entries)
    const watchCount: Record<string, number> = {}
    for (const p of allProgress) {
      watchCount[p.movieId] = (watchCount[p.movieId] || 0) + 1
    }
    const movieMap = new Map(allMovies.map(m => [m.id, m]))
    let mostWatched: { title: string; count: number } | null = null
    for (const [id, count] of Object.entries(watchCount)) {
      if (!mostWatched || count > mostWatched.count) {
        const m = movieMap.get(id)
        if (m) mostWatched = { title: m.title, count }
      }
    }

    // New additions (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const newAdditions = allMovies.filter(m => new Date(m.createdAt) >= sevenDaysAgo).length

    // Completed movies (progress >= 90)
    const completedIds = new Set(allProgress.filter(p => p.progress >= 90).map(p => p.movieId))
    const totalCompleted = completedIds.size

    // Total watch sessions
    const totalSessions = allProgress.length

    return NextResponse.json({
      totalMovies,
      totalSeries,
      totalFavorites,
      totalWatched,
      totalCompleted,
      totalSessions,
      ratedCount: ratedMovies.length,
      avgUserRating: Math.round(avgUserRating * 10) / 10,
      topGenres,
      mostWatched,
      newAdditions,
    })
  } catch (error) {
    console.error('Stats error:', error)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}