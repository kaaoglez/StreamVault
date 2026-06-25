// ─── IMDb Page Scraper ─────────────────────────────────────────
// Extracts movie metadata from IMDb's JSON-LD structured data.
// Used as primary source when OMDB has incorrect data.

import ZAI from 'z-ai-web-dev-sdk'

export interface ImdbMetadata {
  title: string          // IMDb's primary name (e.g. "Venganza")
  alternateTitle: string // English title if different (e.g. "Revenge")
  year: number
  rating: number
  ratingCount: number
  genre: string[]        // ["Action", "Crime", "Thriller"]
  description: string
  poster: string         // High-res poster URL
  director: string[]     // ["Rodrigo Valdes"]
  actors: string[]       // ["Omar Chaparro", "Alejandro Speitzer", ...]
  datePublished: string  // "2026-04-17"
  type: 'movie' | 'series'
  totalSeasons?: number
}

let zaiInstance: Awaited<ReturnType<typeof ZAI.create>> | null = null

async function getZai() {
  if (!zaiInstance) {
    zaiInstance = await ZAI.create()
  }
  return zaiInstance
}

export async function scrapeImdbMetadata(imdbId: string): Promise<ImdbMetadata | null> {
  try {
    const zai = await getZai()
    const url = `https://www.imdb.com/title/${imdbId}/`

    const result = await zai.functions.invoke('page_reader', { url })

    if (result.code !== 200 || !result.data?.html) {
      console.error(`[imdb-scraper] Failed to fetch ${imdbId}: status ${result.code}`)
      return null
    }

    const html = result.data.html

    // Extract JSON-LD from the page
    // IMDb embeds structured data in <script type="application/ld+json">
    const jsonLdMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i)
    if (!jsonLdMatch) {
      console.error(`[imdb-scraper] No JSON-LD found for ${imdbId}`)
      return null
    }

    let jsonData: Record<string, unknown>
    try {
      jsonData = JSON.parse(jsonLdMatch[1])
    } catch {
      console.error(`[imdb-scraper] Failed to parse JSON-LD for ${imdbId}`)
      return null
    }

    // Handle @graph (some pages wrap in array)
    const movieData = jsonData['@type'] === 'Movie' || jsonData['@type'] === 'TVSeries'
      ? jsonData
      : Array.isArray(jsonData['@graph'])
        ? jsonData['@graph'].find(
            (item: Record<string, unknown>) =>
              item['@type'] === 'Movie' || item['@type'] === 'TVSeries'
          )
        : null

    if (!movieData) {
      console.error(`[imdb-scraper] No Movie/TVSeries found in JSON-LD for ${imdbId}`)
      return null
    }

    const type = movieData['@type'] === 'TVSeries' ? 'series' : 'movie'

    // Title - use "name" as primary, "alternateName" as secondary
    const title = String(movieData['name'] || 'Sin título')
    const alternateTitle = String(movieData['alternateName'] || title)

    // Year from datePublished
    const datePublished = String(movieData['datePublished'] || '')
    const year = datePublished ? parseInt(datePublished.substring(0, 4)) : 0

    // Rating from aggregateRating
    const aggRating = movieData['aggregateRating'] as Record<string, unknown> | undefined
    const rating = aggRating ? parseFloat(String(aggRating['ratingValue'] || '0')) : 0
    const ratingCount = aggRating ? parseInt(String(aggRating['ratingCount'] || '0')) : 0

    // Genre
    const genre = Array.isArray(movieData['genre'])
      ? movieData['genre'].map(String)
      : typeof movieData['genre'] === 'string'
        ? [movieData['genre']]
        : []

    // Description
    const description = String(movieData['description'] || 'Sin descripción')

    // Poster
    const poster = String(movieData['image'] || '')

    // Director
    const director = extractNames(movieData['director'])

    // Actors
    const actors = extractNames(movieData['actor'])

    // Total seasons (for series)
    const totalSeasons = type === 'series' && movieData['numberOfSeasons']
      ? parseInt(String(movieData['numberOfSeasons']))
      : undefined

    return {
      title,
      alternateTitle,
      year,
      rating,
      ratingCount,
      genre,
      description,
      poster,
      director,
      actors,
      datePublished,
      type,
      totalSeasons,
    }
  } catch (error) {
    console.error(`[imdb-scraper] Error scraping ${imdbId}:`, error)
    return null
  }
}

function extractNames(field: unknown): string[] {
  if (!field) return []
  if (Array.isArray(field)) {
    return field
      .map((item: Record<string, unknown>) => String(item['name'] || ''))
      .filter(Boolean)
  }
  if (typeof field === 'object' && field !== null) {
    const name = (field as Record<string, unknown>)['name']
    return name ? [String(name)] : []
  }
  return []
}