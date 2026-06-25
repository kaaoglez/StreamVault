import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getMovieDetails, getSeasonEpisodes } from '@/lib/omdb'
import { scrapeImdbMetadata } from '@/lib/imdb-scraper'
import { getConfig } from '@/lib/config'

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

    // ─── Fetch from both sources in parallel ──────────────
    const [omdbDetails, imdbMeta] = await Promise.all([
      apiKey ? getMovieDetails(trimmed, apiKey) : Promise.resolve(null),
      scrapeImdbMetadata(trimmed),
    ])

    console.log(`[add-external] ${trimmed} → OMDB: ${omdbDetails ? omdbDetails.Title : 'N/A'} | IMDb: ${imdbMeta?.title || 'N/A'}`)

    // ─── Use IMDb as primary source when available ───────
    if (imdbMeta) {
      // Detect OMDB data mismatch (title differs)
      if (omdbDetails && omdbDetails.Title !== imdbMeta.title && omdbDetails.Title !== imdbMeta.alternateTitle) {
        console.warn(`[add-external] ⚠ OMDB title mismatch for ${trimmed}: OMDB="${omdbDetails.Title}" vs IMDb="${imdbMeta.title}". Using IMDb data.`)
      }

      // Use IMDb poster or fallback to OMDB
      const coverImage = imdbMeta.poster
        ? imdbMeta.poster.replace(/\/V1_.*?\./, '/V1_QL75_UX380_CR0,4,380,562_.')  // poster-sized
        : (omdbDetails?.Poster && omdbDetails.Poster !== 'N/A')
          ? omdbDetails.Poster
          : '/api/poster/placeholder'

      const backdropImage = imdbMeta.poster
        ? imdbMeta.poster.replace(/\/V1_.*?\./, '/V1_.')  // full size
        : (omdbDetails?.Poster && omdbDetails.Poster !== 'N/A')
          ? omdbDetails.Poster.replace(/\/w\d+\//, '/original/')
          : '/api/backdrop/placeholder'

      const isSeries = imdbMeta.type === 'series'

      // Use OMDB maturity/rating if IMDb doesn't have it
      const maturityMap: Record<string, string> = {
        'G': 'G', 'PG': 'PG', 'PG-13': 'PG-13', 'R': 'R', 'NC-17': 'NC-17',
        'TV-Y': 'TV-Y', 'TV-Y7': 'TV-Y7', 'TV-G': 'TV-G', 'TV-PG': 'TV-PG',
        'TV-14': 'TV-14', 'TV-MA': 'TV-MA', 'Approved': 'PG',
        'Not Rated': 'NR', 'Unrated': 'NR', '18+': 'R',
      }

      const movie = await db.movie.create({
        data: {
          title: imdbMeta.title,
          description: imdbMeta.description,
          coverImage,
          backdropImage,
          imdbId: trimmed,
          year: imdbMeta.year,
          rating: imdbMeta.rating,
          duration: omdbDetails?.Runtime && omdbDetails.Runtime !== 'N/A' ? omdbDetails.Runtime : null,
          genre: imdbMeta.genre.join(', '),
          type: isSeries ? 'series' : 'movie',
          maturity: omdbDetails?.Rated ? (maturityMap[omdbDetails.Rated] || omdbDetails.Rated) : 'NR',
          local: false,
          featured: false,
        },
      })

      // If series, fetch episodes (prefer OMDB, fallback to IMDb totalSeasons)
      let episodesCreated = 0
      if (isSeries) {
        const totalSeasons = omdbDetails?.totalSeasons
          ? Math.min(parseInt(omdbDetails.totalSeasons) || 1, 30)
          : (imdbMeta.totalSeasons ? Math.min(imdbMeta.totalSeasons, 30) : 0)

        for (let s = 1; s <= totalSeasons; s++) {
          if (!apiKey) continue
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

      return NextResponse.json({
        success: true,
        movie,
        episodesCreated,
        source: 'imdb',
        message: `"${imdbMeta.title}" agregado a tu biblioteca`,
      })
    }

    // ─── Fallback: OMDB only (if IMDb scrape failed) ─────
    if (omdbDetails) {
      const rating = parseFloat(omdbDetails.imdbRating) || 0
      const year = parseInt(omdbDetails.Year) || 0
      const isSeries = omdbDetails.Type === 'series'

      const maturityMap: Record<string, string> = {
        'G': 'G', 'PG': 'PG', 'PG-13': 'PG-13', 'R': 'R', 'NC-17': 'NC-17',
        'TV-Y': 'TV-Y', 'TV-Y7': 'TV-Y7', 'TV-G': 'TV-G', 'TV-PG': 'TV-PG',
        'TV-14': 'TV-14', 'TV-MA': 'TV-MA', 'Approved': 'PG',
        'Not Rated': 'NR', 'Unrated': 'NR',
      }

      const coverImage = omdbDetails.Poster && omdbDetails.Poster !== 'N/A'
        ? omdbDetails.Poster
        : '/api/poster/placeholder'

      const backdropImage = omdbDetails.Poster && omdbDetails.Poster !== 'N/A'
        ? omdbDetails.Poster.replace(/\/w\d+\//, '/original/')
        : '/api/backdrop/placeholder'

      const movie = await db.movie.create({
        data: {
          title: omdbDetails.Title || 'Sin título',
          description: omdbDetails.Plot || 'Sin descripción',
          coverImage,
          backdropImage,
          imdbId: trimmed,
          year,
          rating,
          duration: omdbDetails.Runtime || null,
          genre: omdbDetails.Genre || 'Sin género',
          type: isSeries ? 'series' : 'movie',
          maturity: maturityMap[omdbDetails.Rated] || omdbDetails.Rated || 'NR',
          local: false,
          featured: false,
        },
      })

      let episodesCreated = 0
      if (isSeries && omdbDetails.totalSeasons) {
        const totalSeasons = parseInt(omdbDetails.totalSeasons) || 1

        for (let s = 1; s <= Math.min(totalSeasons, 30); s++) {
          const omdbEps = await getSeasonEpisodes(trimmed, s, apiKey!)
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

      return NextResponse.json({
        success: true,
        movie,
        episodesCreated,
        source: 'omdb',
        message: `"${omdbDetails.Title}" agregado a tu biblioteca`,
      })
    }

    // ─── Both sources failed ──────────────────────────────
    return NextResponse.json(
      { error: 'No se encontró en IMDb ni OMDB' },
      { status: 404 }
    )
  } catch (error) {
    console.error('[add-external] Error:', error)
    return NextResponse.json({ error: 'Error al agregar la película' }, { status: 500 })
  }
}