// ─── OMDB API Client ───────────────────────────────────────────
// Free API: https://www.omdbapi.com/  (get key with just an email)

const OMDB_BASE = 'https://www.omdbapi.com/'

export interface OmdbMovie {
  Title: string
  Year: string
  Rated: string
  Released: string
  Runtime: string
  Genre: string
  Director: string
  Writer: string
  Actors: string
  Plot: string
  Language: string
  Country: string
  Awards: string
  Poster: string
  imdbRating: string
  imdbID: string
  Type: string
  Response: string
  Error?: string
  totalSeasons?: string
}

// OMDB returns different fields for season episodes
export interface OmdbEpisode {
  Title: string
  Episode: string
  Season: string
  Released: string
  imdbRating: string
  imdbID: string
  Plot?: string
  Poster?: string
}

export interface OmdbSearchResult {
  Title: string
  Year: string
  imdbID: string
  Type: string
  Poster: string
}

interface OmdbSearchResponse {
  Search?: OmdbSearchResult[]
  totalResults: string
  Response: string
  Error?: string
}

// ─── Rate limit tracking (with auto-reset) ─────────────────────

let rateLimitedUntil = 0 // timestamp when rate limit expires (0 = not limited)

export function isRateLimited(): boolean {
  if (rateLimitedUntil === 0) return false
  if (Date.now() > rateLimitedUntil) {
    rateLimitedUntil = 0
    return false
  }
  return true
}

export function resetRateLimit(): void {
  rateLimitedUntil = 0
}

// ─── Search ─────────────────────────────────────────────────────

export interface SearchResult {
  result: OmdbSearchResult | null
  error?: string
  rateLimited: boolean
}

export interface SearchAllResult {
  results: OmdbSearchResult[]
  totalResults: number
  error?: string
  rateLimited: boolean
}

export async function searchAll(
  title: string,
  type?: 'movie' | 'series' | null,
  apiKey?: string,
  year?: string | null
): Promise<SearchAllResult> {
  if (!apiKey) return { results: [], totalResults: 0, error: 'Sin API key', rateLimited: false }
  if (isRateLimited()) return { results: [], totalResults: 0, error: 'Rate limited (espera hasta mañana)', rateLimited: true }

  const params = new URLSearchParams({ apikey: apiKey, s: title })
  if (type && type !== 'all') params.set('type', type)
  if (year) params.set('y', year)

  try {
    const res = await fetch(`${OMDB_BASE}?${params}`)
    if (!res.ok) return { results: [], totalResults: 0, error: `HTTP ${res.status}`, rateLimited: false }
    const data: OmdbSearchResponse = await res.json()

    if (data.Error) {
      const isLimit = data.Error.toLowerCase().includes('limit')
      if (isLimit) rateLimitedUntil = Date.now() + 24 * 60 * 60 * 1000
      return { results: [], totalResults: 0, error: data.Error, rateLimited: isLimit }
    }

    return {
      results: data.Search || [],
      totalResults: parseInt(data.totalResults) || 0,
      rateLimited: false,
    }
  } catch (err) {
    return { results: [], totalResults: 0, error: `Error de red: ${String(err)}`, rateLimited: false }
  }
}

export async function searchMovie(
  title: string,
  year?: number | null,
  apiKey: string
): Promise<SearchResult> {
  if (isRateLimited()) {
    return { result: null, error: 'Rate limited (espera hasta mañana)', rateLimited: true }
  }

  const params = new URLSearchParams({
    apikey: apiKey,
    s: title,
    type: 'movie',
  })
  if (year) params.set('y', String(year))

  try {
    const res = await fetch(`${OMDB_BASE}?${params}`)
    if (!res.ok) {
      return { result: null, error: `HTTP ${res.status}`, rateLimited: false }
    }
    const data: OmdbSearchResponse = await res.json()

    if (data.Error) {
      const isLimit = data.Error.toLowerCase().includes('limit')
      if (isLimit) {
        rateLimitedUntil = Date.now() + 24 * 60 * 60 * 1000 // reset in 24h
      }
      return { result: null, error: data.Error, rateLimited: isLimit }
    }

    if (data.Response === 'True' && data.Search && data.Search.length > 0) {
      return { result: data.Search[0], rateLimited: false }
    }

    return {
      result: null,
      error: `Sin resultados para "${title}"${year ? ` (${year})` : ''}`,
      rateLimited: false,
    }
  } catch (err) {
    return { result: null, error: `Error de red: ${String(err)}`, rateLimited: false }
  }
}

export async function searchSeries(
  title: string,
  year?: number | null,
  apiKey: string
): Promise<SearchResult> {
  if (isRateLimited()) {
    return { result: null, error: 'Rate limited (espera hasta mañana)', rateLimited: true }
  }

  const params = new URLSearchParams({
    apikey: apiKey,
    s: title,
    type: 'series',
  })
  if (year) params.set('y', String(year))

  try {
    const res = await fetch(`${OMDB_BASE}?${params}`)
    if (!res.ok) {
      return { result: null, error: `HTTP ${res.status}`, rateLimited: false }
    }
    const data: OmdbSearchResponse = await res.json()

    if (data.Error) {
      const isLimit = data.Error.toLowerCase().includes('limit')
      if (isLimit) {
        rateLimitedUntil = Date.now() + 24 * 60 * 60 * 1000
      }
      return { result: null, error: data.Error, rateLimited: isLimit }
    }

    if (data.Response === 'True' && data.Search && data.Search.length > 0) {
      return { result: data.Search[0], rateLimited: false }
    }

    return {
      result: null,
      error: `Sin resultados serie "${title}"${year ? ` (${year})` : ''}`,
      rateLimited: false,
    }
  } catch (err) {
    return { result: null, error: `Error de red: ${String(err)}`, rateLimited: false }
  }
}

// ─── Details ────────────────────────────────────────────────────

export async function getMovieDetails(
  imdbId: string,
  apiKey: string
): Promise<OmdbMovie | null> {
  if (isRateLimited()) return null

  const params = new URLSearchParams({
    apikey: apiKey,
    i: imdbId,
    plot: 'full',
  })

  try {
    const res = await fetch(`${OMDB_BASE}?${params}`)
    const data: OmdbMovie = await res.json()

    if (data.Error) {
      console.error(`[OMDB] getDetails "${imdbId}": ${data.Error}`)
      if (data.Error.toLowerCase().includes('limit')) {
        rateLimitedUntil = Date.now() + 24 * 60 * 60 * 1000
      }
      return null
    }

    if (data.Response === 'True') return data
    return null
  } catch (err) {
    console.error(`[OMDB] getDetails "${imdbId}": fetch error -`, err)
    return null
  }
}

export async function getSeasonEpisodes(
  imdbId: string,
  season: number,
  apiKey: string
): Promise<OmdbEpisode[] | null> {
  if (isRateLimited()) return null

  const params = new URLSearchParams({
    apikey: apiKey,
    i: imdbId,
    season: String(season),
  })

  try {
    const res = await fetch(`${OMDB_BASE}?${params}`)
    const data = await res.json()

    if (data.Error) {
      console.error(`[OMDB] getSeason "${imdbId}" S${season}: ${data.Error}`)
      if (data.Error.toLowerCase().includes('limit')) {
        rateLimitedUntil = Date.now() + 24 * 60 * 60 * 1000
      }
      return null
    }

    if (data.Response === 'True' && data.Episodes) {
      return data.Episodes as OmdbEpisode[]
    }
    return null
  } catch (err) {
    console.error(`[OMDB] getSeason "${imdbId}" S${season}: fetch error -`, err)
    return null
  }
}