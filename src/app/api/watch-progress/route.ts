import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET: Fetch movies/episodes with watch progress (for "Continuar Viendo")
export async function GET() {
  try {
    const progressEntries = await db.watchProgress.findMany({
      where: { progress: { gt: 0, lt: 100 } }, // 0-99% = in progress
      orderBy: { lastWatched: 'desc' },
      include: {
        movie: {
          include: {
            episodes: {
              orderBy: [{ seasonNumber: 'asc' }, { episodeNumber: 'asc' }],
            },
          },
        },
        episode: true,
      },
    })

    // Deduplicate by movieId (show latest progress per movie)
    const seen = new Map<string, typeof progressEntries[0]>()
    for (const entry of progressEntries) {
      const existing = seen.get(entry.movieId)
      if (!existing || entry.lastWatched > existing.lastWatched) {
        seen.set(entry.movieId, entry)
      }
    }

    const result = Array.from(seen.values()).map((entry) => {
      const movie = entry.movie
      const isSeries = movie.type === 'series'

      // Determine the "next episode" for series
      let nextEpisode = null
      let currentEpisodeLabel = ''

      if (isSeries && entry.episodeId && movie.episodes.length > 0) {
        const currentEp = entry.episode
        if (currentEp) {
          currentEpisodeLabel = `S${String(currentEp.seasonNumber).padStart(2, '0')}E${String(currentEp.episodeNumber).padStart(2, '0')}`

          // If progress >= 90%, the current episode is "done" → next is the real next
          // If progress < 90%, the "next" to watch IS the current one (resume)
          if (entry.progress >= 90) {
            // Find the next episode in sequence
            const currentIdx = movie.episodes.findIndex(
              (ep) => ep.id === entry.episodeId
            )
            if (currentIdx >= 0 && currentIdx < movie.episodes.length - 1) {
              const ne = movie.episodes[currentIdx + 1]
              nextEpisode = {
                id: ne.id,
                seasonNumber: ne.seasonNumber,
                episodeNumber: ne.episodeNumber,
                title: ne.title,
                label: `S${String(ne.seasonNumber).padStart(2, '0')}E${String(ne.episodeNumber).padStart(2, '0')}`,
              }
              currentEpisodeLabel = '' // Don't show current, show next instead
            }
            // If it was the last episode, no nextEpisode (series finished)
          } else {
            // Still watching current episode — "next" is the current one to resume
            nextEpisode = {
              id: currentEp.id,
              seasonNumber: currentEp.seasonNumber,
              episodeNumber: currentEp.episodeNumber,
              title: currentEp.title,
              label: `S${String(currentEp.seasonNumber).padStart(2, '0')}E${String(currentEp.episodeNumber).padStart(2, '0')}`,
              isResume: true,
            }
          }
        }
      }

      return {
        ...movie,
        episodes: undefined, // Don't send all episodes to client
        watchProgress: entry.progress,
        lastWatched: entry.lastWatched.toISOString(),
        episodeId: entry.episodeId || undefined,
        currentEpisodeLabel,
        nextEpisode,
        isFavorite: false,
      }
    })

    return NextResponse.json({ movies: result })
  } catch (error) {
    console.error('Error fetching watch progress:', error)
    return NextResponse.json(
      { error: 'Failed to fetch watch progress' },
      { status: 500 }
    )
  }
}

// POST: Save/update watch progress (supports episode-level)
export async function POST(request: NextRequest) {
  try {
    const { movieId, episodeId, progress } = await request.json()

    if (!movieId || progress === undefined) {
      return NextResponse.json(
        { error: 'movieId and progress are required' },
        { status: 400 }
      )
    }

    // Handle composite key format "movieId:episodeId" from client
    const realMovieId = movieId.includes(':') ? movieId.split(':')[0] : movieId

    // Check if movie exists
    const movie = await db.movie.findUnique({ where: { id: realMovieId } })
    if (!movie) {
      return NextResponse.json({ error: 'Movie not found' }, { status: 404 })
    }

    // If episodeId provided, validate it exists
    if (episodeId) {
      const episode = await db.episode.findUnique({ where: { id: episodeId } })
      if (!episode) {
        return NextResponse.json({ error: 'Episode not found' }, { status: 404 })
      }
    }

    // If progress is 100%, delete the progress entry (fully watched)
    if (progress >= 100) {
      await db.watchProgress.deleteMany({
        where: {
          movieId: realMovieId,
          ...(episodeId ? { episodeId } : { episodeId: null }),
        },
      })
      return NextResponse.json({ success: true, progress: 100 })
    }

    // Upsert watch progress (use realMovieId, not composite key)
    const existing = await db.watchProgress.findFirst({
      where: {
        movieId: realMovieId,
        ...(episodeId ? { episodeId } : { episodeId: null }),
      },
    })

    if (existing) {
      await db.watchProgress.update({
        where: { id: existing.id },
        data: { progress, lastWatched: new Date() },
      })
    } else {
      await db.watchProgress.create({
        data: {
          movieId: realMovieId,
          episodeId: episodeId || null,
          progress,
          lastWatched: new Date(),
        },
      })
    }

    return NextResponse.json({ success: true, progress })
  } catch (error) {
    console.error('Error updating watch progress:', error)
    return NextResponse.json(
      { error: 'Failed to update watch progress' },
      { status: 500 }
    )
  }
}

// DELETE: Remove watch progress for a movie (from "Continuar Viendo")
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const movieId = searchParams.get('movieId')

    if (!movieId) {
      return NextResponse.json(
        { error: 'movieId query parameter is required' },
        { status: 400 }
      )
    }

    await db.watchProgress.deleteMany({
      where: { movieId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting watch progress:', error)
    return NextResponse.json(
      { error: 'Failed to delete watch progress' },
      { status: 500 }
    )
  }
}