import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { populateMovieCast } from '@/lib/cast-service'

/**
 * POST /api/backfill-cast
 * Populates cast for all movies that have an imdbId but no cast yet.
 * Run once after refactoring to fill existing data.
 */
export async function POST() {
  try {
    // Find movies with imdbId that have no cast relations
    const movies = await db.movie.findMany({
      where: {
        imdbId: { not: null },
      },
      select: { id: true, imdbId: true, title: true },
    })

    const results: { title: string; cast: number; error?: string }[] = []
    let totalCast = 0

    for (const movie of movies) {
      // Check if this movie already has cast
      const existingCast = await db.movieActor.count({ where: { movieId: movie.id } })
      if (existingCast > 0) {
        results.push({ title: movie.title, cast: existingCast })
        totalCast += existingCast
        continue
      }

      try {
        const cast = await populateMovieCast(movie.id, movie.imdbId!)
        results.push({ title: movie.title, cast: cast.length })
        totalCast += cast.length
      } catch (err) {
        results.push({ title: movie.title, cast: 0, error: String(err) })
      }

      // Small delay to avoid rate limiting from IMDb
      await new Promise(r => setTimeout(r, 500))
    }

    return NextResponse.json({
      processed: movies.length,
      totalCast,
      results,
    })
  } catch (error) {
    console.error('[Backfill Cast] Error:', error)
    return NextResponse.json({ error: 'Error en backfill' }, { status: 500 })
  }
}