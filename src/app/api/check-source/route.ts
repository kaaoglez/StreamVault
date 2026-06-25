import { NextRequest, NextResponse } from 'next/server'

const VIDCORE_BASE = 'https://vidcore.net'
const CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

// In-memory cache (survives between requests in the same process)
const cache = new Map<string, { available: boolean; timestamp: number }>()

function getCacheKey(imdbId: string, season?: number, episode?: number): string {
  if (season && episode) return `tv:${imdbId}:${season}:${episode}`
  return `movie:${imdbId}`
}

function buildVidcoreUrl(imdbId: string, season?: number, episode?: number): string {
  if (season && episode) {
    return `${VIDCORE_BASE}/tv/${imdbId}/${season}/${episode}`
  }
  return `${VIDCORE_BASE}/movie/${imdbId}`
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const imdbId = searchParams.get('imdbId')
    const season = searchParams.get('season')
    const episode = searchParams.get('episode')

    if (!imdbId) {
      return NextResponse.json(
        { error: 'imdbId is required' },
        { status: 400 },
      )
    }

    const sNum = season ? parseInt(season, 10) : undefined
    const eNum = episode ? parseInt(episode, 10) : undefined
    const cacheKey = getCacheKey(imdbId, sNum, eNum)

    // Check memory cache
    const cached = cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return NextResponse.json({ available: cached.available, cached: true })
    }

    // Fetch VidCore page server-side
    const url = buildVidcoreUrl(imdbId, sNum, eNum)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000) // 10s timeout

    let response: Response
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          Accept: 'text/html',
        },
        redirect: 'follow',
      })
    } catch (err) {
      clearTimeout(timeout)
      // Network error or timeout — assume unavailable
      console.error(`[check-source] Fetch error for ${cacheKey}:`, err)
      cache.set(cacheKey, { available: false, timestamp: Date.now() })
      return NextResponse.json({ available: false })
    }
    clearTimeout(timeout)

    if (response.status === 404) {
      cache.set(cacheKey, { available: false, timestamp: Date.now() })
      return NextResponse.json({ available: false })
    }

    if (response.status !== 200) {
      cache.set(cacheKey, { available: false, timestamp: Date.now() })
      return NextResponse.json({ available: false })
    }

    // Check the HTML content for indicators of an actual video source
    const html = await response.text()

    // VidCore pages with actual content typically contain:
    // - An iframe (embedded video player)
    // - Or specific container elements for the player
    // Pages without content may show "not found", "404", or have very short HTML
    const hasIframe = /<iframe/i.test(html)
    const hasProviderEmbed =
      new RegExp(VIDCORE_BASE.replace(/\./g, '\\.'), 'i').test(html) ||
      /vidsrc\.(to|cc|me)/i.test(html) ||
      /autoembed\.(cc|com)/i.test(html) ||
      /multimovies/i.test(html) ||
      /2embed/i.test(html) ||
      /moviesapi\./i.test(html) ||
      /smashystream/i.test(html) ||
      /vidplay/i.test(html) ||
      /m3u8/i.test(html) ||
      /\/embed\//i.test(html)

    // If the page has very little content (likely an error/placeholder page)
    const isShortPage = html.length < 2000

    // Common "not found" indicators
    const hasNotFound =
      /(?:not\s*found|no\s*found|no\s*results|content\s*unavailable|page\s*not\s*found|404\s*not\s*found|sin\s*resultados|no\s*disponible)/i.test(
        html,
      )

    const available =
      !isShortPage && !hasNotFound && (hasIframe || hasProviderEmbed)

    cache.set(cacheKey, { available, timestamp: Date.now() })

    return NextResponse.json({ available })
  } catch (error) {
    console.error('[check-source] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Failed to check source' },
      { status: 500 },
    )
  }
}