import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const movie = await db.movie.findUnique({
      where: { id },
      include: { episodes: { orderBy: [{ seasonNumber: 'asc' }, { episodeNumber: 'asc' }] } },
    })

    if (!movie) {
      return NextResponse.json({ error: 'Movie not found' }, { status: 404 })
    }

    let seasons: { seasonNumber: number; episodes: typeof movie.episodes }[] | undefined

    if (movie.type === 'series' && movie.episodes.length > 0) {
      const seasonMap = new Map<number, typeof movie.episodes>()
      for (const ep of movie.episodes) {
        const existing = seasonMap.get(ep.seasonNumber) || []
        existing.push(ep)
        seasonMap.set(ep.seasonNumber, existing)
      }
      seasons = Array.from(seasonMap.entries())
        .map(([seasonNumber, episodes]) => ({ seasonNumber, episodes }))
        .sort((a, b) => a.seasonNumber - b.seasonNumber)
    }

    return NextResponse.json({
      ...movie,
      isFavorite: false,
      watchProgress: 0,
      seasons,
    })
  } catch (error) {
    console.error('Error fetching movie:', error)
    return NextResponse.json(
      { error: 'Failed to fetch movie' },
      { status: 500 }
    )
  }
}