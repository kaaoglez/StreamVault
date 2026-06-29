import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getMovieDetails, getSeasonEpisodes } from '@/lib/omdb'
import { getConfig } from '@/lib/config'
import { populateMovieCast } from '@/lib/cast-service'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { imdbId } = await request.json()

    if (!imdbId || typeof imdbId !== 'string') {
      return NextResponse.json({ error: 'imdbId es requerido' }, { status: 400 })
    }

    // Validate imdbId format (tt1234567)
    if (!/^tt\d{5,10}$/i.test(imdbId.trim())) {
      return NextResponse.json({ error: 'Formato de imdbId inválido (ej: tt0133093)' }, { status: 400 })
    }

    const movie = await db.movie.findUnique({ where: { id } })
    if (!movie) {
      return NextResponse.json({ error: 'Película no encontrada' }, { status: 404 })
    }

    const config = getConfig()
    const apiKey = config.omdbApiKey
    if (!apiKey) {
      return NextResponse.json({ error: 'Configura la API key de OMDB en ajustes' }, { status: 400 })
    }

    // Fetch details from OMDB
    const details = await getMovieDetails(imdbId.trim(), apiKey)
    if (!details) {
      return NextResponse.json({ error: 'No se encontró en OMDB con ese imdbId' }, { status: 404 })
    }

    // Parse rating
    const rating = parseFloat(details.imdbRating) || 0

    // Parse year
    const year = parseInt(details.Year) || movie.year

    // Map Rated → maturity
    const maturityMap: Record<string, string> = {
      'G': 'G', 'PG': 'PG', 'PG-13': 'PG-13', 'R': 'R', 'NC-17': 'NC-17',
      'TV-Y': 'TV-Y', 'TV-Y7': 'TV-Y7', 'TV-G': 'TV-G', 'TV-PG': 'TV-PG',
      'TV-14': 'TV-14', 'TV-MA': 'TV-MA', 'Approved': 'PG',
      'Not Rated': 'NR', 'Unrated': 'NR',
    }
    const maturity = maturityMap[details.Rated] || details.Rated || movie.maturity

    // Get poster — prefer OMDB poster, fallback to N/A check
    let coverImage = details.Poster && details.Poster !== 'N/A' ? details.Poster : movie.coverImage
    let backdropImage = movie.backdropImage

    // Always update backdrop from OMDB poster when available
    if (details.Poster && details.Poster !== 'N/A') {
      backdropImage = details.Poster.replace(/\/w\d+\//, '/original/')
    }

    // Update the movie
    const updated = await db.movie.update({
      where: { id },
      data: {
        imdbId: imdbId.trim(),
        title: details.Title || movie.title,
        description: details.Plot || movie.description,
        coverImage,
        backdropImage,
        year,
        rating,
        duration: details.Runtime || movie.duration,
        genre: details.Genre || movie.genre,
        maturity,
        actors: details.Actors || null,
        director: details.Director || null,
      },
      include: { episodes: { orderBy: [{ seasonNumber: 'asc' }, { episodeNumber: 'asc' }] } },
    })

    // If it's a series, fetch and create episodes
    let episodesCreated = 0
    if (movie.type === 'series' && details.totalSeasons) {
      const totalSeasons = parseInt(details.totalSeasons) || 1

      // Delete old episodes only if we had none before or if user explicitly wants refresh
      // We'll keep existing episodes that have filePaths (local files)
      const existingEps = await db.episode.findMany({
        where: { seriesId: id },
        select: { id: true, seasonNumber: true, episodeNumber: true, filePath: true },
      })

      const existingEpMap = new Map<string, string>()
      for (const ep of existingEps) {
        existingEpMap.set(`${ep.seasonNumber}-${ep.episodeNumber}`, ep.id)
      }

      for (let s = 1; s <= Math.min(totalSeasons, 30); s++) {
        const omdbEps = await getSeasonEpisodes(imdbId.trim(), s, apiKey)
        if (!omdbEps) continue

        for (const oe of omdbEps) {
          const epNum = parseInt(oe.Episode)
          if (!epNum) continue

          const key = `${s}-${epNum}`
          if (existingEpMap.has(key)) {
            // Update existing episode metadata but keep filePath
            await db.episode.update({
              where: { id: existingEpMap.get(key)! },
              data: {
                title: oe.Title || `Episodio ${epNum}`,
                description: oe.Plot || null,
                stillImage: (oe.Poster && oe.Poster !== 'N/A') ? oe.Poster : null,
                duration: null, // OMDB episodes don't have runtime
              },
            })
          } else {
            // Create new episode (no local file, just metadata)
            await db.episode.create({
              data: {
                seriesId: id,
                seasonNumber: s,
                episodeNumber: epNum,
                title: oe.Title || `Episodio ${epNum}`,
                description: oe.Plot || null,
                stillImage: (oe.Poster && oe.Poster !== 'N/A') ? oe.Poster : null,
              },
            })
            episodesCreated++
          }
        }
      }
    }

    // Populate cast from IMDb (non-blocking)
    let castPopulated = 0
    try {
      const cast = await populateMovieCast(id, imdbId.trim(), details.Actors, details.Title || movie.title, parseInt(details.Year) || movie.year)
      castPopulated = cast.length
    } catch (err) {
      console.error('[Enrich] Cast scrape failed (non-blocking):', err)
    }

    return NextResponse.json({
      success: true,
      movie: updated,
      episodesCreated,
      castPopulated,
      message: `"${details.Title}" actualizado correctamente desde IMDb`,
    })
  } catch (error) {
    console.error('[Enrich] Error:', error)
    return NextResponse.json(
      { error: 'Error al actualizar desde IMDb' },
      { status: 500 }
    )
  }
}