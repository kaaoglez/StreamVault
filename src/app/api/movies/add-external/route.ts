import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getMovieDetails, getSeasonEpisodes } from '@/lib/omdb'
import { getConfig } from '@/lib/config'
import { populateMovieCast } from '@/lib/cast-service'

export async function POST(request: NextRequest) {
  try {
    const { imdbId } = await request.json()

    if (!imdbId || typeof imdbId !== 'string') {
      return NextResponse.json({ error: 'imdbId es requerido' }, { status: 400 })
    }

    const trimmed = imdbId.trim()
    if (!/^tt\d{5,10}$/i.test(trimmed)) {
      return NextResponse.json({ error: 'Formato de imdbId inválido (ej: tt0133093)' }, { status: 400 })
    }

    // Check if movie already exists in DB
    const existing = await db.movie.findFirst({ where: { imdbId: trimmed } })
    if (existing) {
      return NextResponse.json({ error: 'Esta película ya está en tu biblioteca', movie: existing }, { status: 409 })
    }

    const config = getConfig()
    const apiKey = config.omdbApiKey
    if (!apiKey) {
      return NextResponse.json({ error: 'Configura la API key de OMDB en ajustes' }, { status: 400 })
    }

    // Fetch full details from OMDB
    const details = await getMovieDetails(trimmed, apiKey)
    if (!details) {
      return NextResponse.json({ error: 'No se encontró en OMDB' }, { status: 404 })
    }

    // Parse fields
    const rating = parseFloat(details.imdbRating) || 0
    const year = parseInt(details.Year) || 0
    const isSeries = details.Type === 'series'

    // Map Rated → maturity
    const maturityMap: Record<string, string> = {
      'G': 'G', 'PG': 'PG', 'PG-13': 'PG-13', 'R': 'R', 'NC-17': 'NC-17',
      'TV-Y': 'TV-Y', 'TV-Y7': 'TV-Y7', 'TV-G': 'TV-G', 'TV-PG': 'TV-PG',
      'TV-14': 'TV-14', 'TV-MA': 'TV-MA', 'Approved': 'PG',
      'Not Rated': 'NR', 'Unrated': 'NR',
    }

    const coverImage = details.Poster && details.Poster !== 'N/A'
      ? details.Poster
      : '/api/poster/placeholder'

    const backdropImage = details.Poster && details.Poster !== 'N/A'
      ? details.Poster.replace(/\/w\d+\//, '/original/')
      : '/api/backdrop/placeholder'

    // Create the movie in DB
    const movie = await db.movie.create({
      data: {
        title: details.Title || 'Sin título',
        description: details.Plot || 'Sin descripción',
        coverImage,
        backdropImage,
        imdbId: trimmed,
        year,
        rating,
        duration: details.Runtime || null,
        genre: details.Genre || 'Sin género',
        type: isSeries ? 'series' : 'movie',
        maturity: maturityMap[details.Rated] || details.Rated || 'NR',
        actors: details.Actors || null,
        director: details.Director || null,
        local: false,
        featured: false,
      },
    })

    // If series, fetch and create all episodes
    let episodesCreated = 0
    if (isSeries && details.totalSeasons) {
      const totalSeasons = parseInt(details.totalSeasons) || 1

      for (let s = 1; s <= Math.min(totalSeasons, 30); s++) {
        const omdbEps = await getSeasonEpisodes(trimmed, s, apiKey)
        if (!omdbEps) continue

        for (const oe of omdbEps) {
          const epNum = parseInt(oe.Episode)
          if (!epNum) continue

          await db.episode.create({
            data: {
              seriesId: movie.id,
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

    // Populate cast from IMDb (non-blocking — doesn't fail the request)
    let castPopulated = 0
    try {
      const cast = await populateMovieCast(movie.id, trimmed, details.Actors, details.Title, year)
      castPopulated = cast.length
    } catch (err) {
      console.error('[add-external] Cast scrape failed (non-blocking):', err)
    }

    return NextResponse.json({
      success: true,
      movie,
      episodesCreated,
      castPopulated,
      message: `"${details.Title}" agregado a tu biblioteca`,
    })
  } catch (error) {
    console.error('[add-external] Error:', error)
    return NextResponse.json({ error: 'Error al agregar la película' }, { status: 500 })
  }
}