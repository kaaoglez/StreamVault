import { NextResponse } from 'next/server'
import { getConfig } from '@/lib/config'
import { setApiKey, getNowPlayingMovies, getNowPlayingTV, getPosterUrl, getBackdropUrl, getMovieVideos, getTVVideos, pickTrailer, type TMDBVideo } from '@/lib/tmdb'

// GET /api/now-playing — Movies & TV currently in theaters/airing
export async function GET() {
  try {
    const config = getConfig()

    if (!config.tmdbApiKey) {
      return NextResponse.json({ movies: [], hasTmdbKey: false })
    }

    setApiKey(config.tmdbApiKey)

    // Fetch now playing movies (page 1)
    const [moviesData, tvData] = await Promise.allSettled([
      getNowPlayingMovies(1),
      getNowPlayingTV(1),
    ])

    const movies = moviesData.status === 'fulfilled' ? moviesData.value.results || [] : []
    const tvShows = tvData.status === 'fulfilled' ? tvData.value.results || [] : []

    // Enrich each movie with its trailer
    const enrichedMovies = await Promise.all(
      movies.slice(0, 10).map(async (m) => {
        let trailer: TMDBVideo | null = null
        try {
          const vids = await getMovieVideos(m.id)
          trailer = pickTrailer(vids.results || [])
        } catch {}
        return {
          id: String(m.id),
          tmdbId: m.id,
          title: m.title,
          description: m.overview || '',
          coverImage: getPosterUrl(m.poster_path, 'w500'),
          backdropImage: getBackdropUrl(m.backdrop_path, 'w1280'),
          year: m.release_date ? parseInt(m.release_date.substring(0, 4)) : 0,
          rating: m.vote_average || 0,
          genre: '',
          type: 'movie' as const,
          maturity: 'PG-13',
          trailer: trailer ? { key: trailer.key, name: trailer.name } : null,
        }
      }),
    )

    // Enrich each TV show with its trailer
    const enrichedTV = await Promise.all(
      tvShows.slice(0, 5).map(async (t) => {
        let trailer: TMDBVideo | null = null
        try {
          const vids = await getTVVideos(t.id)
          trailer = pickTrailer(vids.results || [])
        } catch {}
        return {
          id: String(t.id),
          tmdbId: t.id,
          title: t.name,
          description: t.overview || '',
          coverImage: getPosterUrl(t.poster_path, 'w500'),
          backdropImage: getBackdropUrl(t.backdrop_path, 'w1280'),
          year: t.first_air_date ? parseInt(t.first_air_date.substring(0, 4)) : 0,
          rating: t.vote_average || 0,
          genre: '',
          type: 'series' as const,
          maturity: 'TV-14',
          trailer: trailer ? { key: trailer.key, name: trailer.name } : null,
        }
      }),
    )

    return NextResponse.json({
      movies: [...enrichedMovies, ...enrichedTV],
      hasTmdbKey: true,
    })
  } catch (error) {
    console.error('Now Playing error:', error)
    return NextResponse.json(
      { movies: [], hasTmdbKey: true, error: String(error) },
      { status: 500 },
    )
  }
}