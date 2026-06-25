// ─── Auto Trending Fetcher ─────────────────────────────────────
// Scrapes IMDb Most Popular charts via direct fetch, enriches via OMDB.

import { getMovieDetails, isRateLimited } from './omdb'
import { getConfig } from './config'

export interface TrendingItem {
  id: string
  imdbId: string
  title: string
  description: string
  coverImage: string
  backdropImage: string
  year: number
  rating: number
  genre: string
  type: 'movie' | 'series'
  maturity: string
  featured: boolean
  local: false
}

// ─── IMDb chart scraping ──────────────────────────────────────

const IMDB_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

async function scrapeImdbChart(url: string, count: number): Promise<string[]> {
  try {
    const res = await fetch(url, { headers: IMDB_HEADERS, signal: AbortSignal.timeout(15000) })
    if (!res.ok) {
      console.error(`[Trending] IMDb returned HTTP ${res.status} for ${url}`)
      return []
    }
    const html = await res.text()
    if (!html || html.length < 1000) {
      console.error(`[Trending] IMDb returned empty body for ${url}`)
      return []
    }
    const regex = /\/title\/(tt\d{7,8})\//g
    const ids = new Set<string>()
    let match: RegExpExecArray | null
    while ((match = regex.exec(html)) !== null) {
      ids.add(match[1])
      if (ids.size >= count) break
    }
    console.log(`[Trending] Scraped ${ids.size} IDs from ${url}`)
    return Array.from(ids)
  } catch (err) {
    console.error(`[Trending] Failed to scrape ${url}:`, err)
    return []
  }
}

// ─── OMDB enrichment ──────────────────────────────────────────

async function enrichFromOmdb(
  imdbId: string,
  type: 'movie' | 'series',
  apiKey: string
): Promise<TrendingItem | null> {
  if (isRateLimited()) return null

  const data = await getMovieDetails(imdbId, apiKey)
  if (!data || data.Response !== 'True') return null

  // Validate: OMDB sometimes returns wrong data for an ID
  if (data.imdbID !== imdbId) {
    console.warn(`[Trending] OMDB ID mismatch: requested ${imdbId}, got ${data.imdbID}`)
    return null
  }

  const poster = data.Poster && data.Poster !== 'N/A' ? data.Poster : ''
  const rating = parseFloat(data.imdbRating) || 0
  const year = parseInt(data.Year) || 0

  // OMDB returns small posters (e.g. _SX300). Convert to medium-high quality.
  const coverPoster = poster
    ? poster.replace(/_V1_[^@.]*(@)?/, '_V1_UX500_CR0,0,333,500_AL_$1')
    : ''
  // For backdrop: use full res so it looks sharp as hero background
  const backdropPoster = poster
    ? poster.replace(/_V1_[^@.]*(@)?/, '_V1_$1')
    : ''

  return {
    id: `imdb-${imdbId}`,
    imdbId,
    title: data.Title,
    description: data.Plot || '',
    coverImage: coverPoster,
    backdropImage: backdropPoster,
    year,
    rating,
    genre: data.Genre || '',
    type,
    maturity: data.Rated || '',
    featured: true,
    local: false,
  }
}

// ─── Main fetcher ─────────────────────────────────────────────

export async function fetchTrendingItems(): Promise<TrendingItem[]> {
  const config = getConfig()
  const apiKey = config.omdbApiKey
  if (!apiKey) {
    console.log('[Trending] No OMDB API key, skipping dynamic fetch')
    return []
  }

  console.log('[Trending] Fetching IMDb Popularity Rank...')

  const [movieIds, seriesIds] = await Promise.all([
    scrapeImdbChart('https://www.imdb.com/chart/moviemeter/', 15),
    scrapeImdbChart('https://www.imdb.com/chart/tvmeter/', 8),
  ])

  if (movieIds.length === 0 && seriesIds.length === 0) {
    console.log('[Trending] Could not scrape IMDb, returning empty (will use static fallback)')
    return []
  }

  const items: TrendingItem[] = []

  for (const id of movieIds) {
    const item = await enrichFromOmdb(id, 'movie', apiKey)
    if (item) {
      items.push(item)
      if (items.length >= 10) break
    }
  }

  for (const id of seriesIds) {
    const item = await enrichFromOmdb(id, 'series', apiKey)
    if (item) {
      items.push(item)
      if (items.length >= 18) break
    }
  }

  console.log(`[Trending] Enriched ${items.length} items`)
  return items
}