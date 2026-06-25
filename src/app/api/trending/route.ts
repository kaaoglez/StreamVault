import { NextResponse } from 'next/server'
import { fetchTrendingItems, type TrendingItem } from '@/lib/trending-fetcher'
import trendingData from '@/data/trending.json'
import { db } from '@/lib/db'

// ─── In-memory cache ────────────────────────────────────────

interface CacheEntry {
  items: TrendingItem[]
  timestamp: number
  source: 'dynamic' | 'static'
}

let _cache: CacheEntry | null = null
const CACHE_TTL = 2 * 60 * 60 * 1000 // 2 hours

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const refresh = searchParams.get('refresh') === 'true'

    // Try to serve from cache (always re-filter against DB)
    if (!refresh && _cache && Date.now() - _cache.timestamp < CACHE_TTL) {
      const filtered = await filterExistingInDb(_cache.items)
      return NextResponse.json({
        items: filtered,
        source: _cache.source,
        total: _cache.items.length,
        shown: filtered.length,
        cached: true,
      })
    }

    // 1) Try dynamic fetch from IMDb + OMDB
    const dynamicItems = await fetchTrendingItems()
    if (dynamicItems.length > 0) {
      _cache = { items: dynamicItems, timestamp: Date.now(), source: 'dynamic' }
      const filtered = await filterExistingInDb(dynamicItems)
      console.log(`[Trending] Dynamic: ${dynamicItems.length} total, ${filtered.length} after DB filter`)
      return NextResponse.json({ items: filtered, source: 'dynamic', total: dynamicItems.length, shown: filtered.length, cached: false })
    }

    // 2) Fallback: static JSON
    const staticItems: TrendingItem[] = trendingData.items
    if (staticItems.length > 0) {
      _cache = { items: staticItems, timestamp: Date.now(), source: 'static' }
      const filtered = await filterExistingInDb(staticItems)
      console.log(`[Trending] Static fallback: ${staticItems.length} total, ${filtered.length} after DB filter`)
      return NextResponse.json({ items: filtered, source: 'static', total: staticItems.length, shown: filtered.length, cached: false })
    }

    return NextResponse.json({ items: [], source: 'none', total: 0, shown: 0 })
  } catch (error) {
    console.error('[Trending] Error:', error)
    return NextResponse.json({ items: [], source: 'error', error: String(error) }, { status: 500 })
  }
}

// ─── Filter: exclude items already in DB ───────────────────

async function filterExistingInDb(items: TrendingItem[]): Promise<TrendingItem[]> {
  if (items.length === 0) return items

  try {
    const allDbMovies = await db.movie.findMany({
      select: { imdbId: true, title: true, year: true },
    })

    // By imdbId
    const imdbIdSet = new Set(allDbMovies.filter(m => m.imdbId).map(m => m.imdbId))

    // By title+year (local movies without imdbId)
    const titleMap = new Map<string, Set<number>>()
    for (const m of allDbMovies) {
      const key = m.title.toLowerCase().trim()
      if (!key) continue
      if (!titleMap.has(key)) titleMap.set(key, new Set())
      titleMap.get(key)!.add(m.year)
    }

    const filtered = items.filter(item => {
      if (imdbIdSet.has(item.imdbId)) return false
      const key = item.title.toLowerCase().trim()
      const years = titleMap.get(key)
      if (years) {
        if (years.has(item.year)) return false
        if (years.has(0) && item.year > 0) return false
        if (item.year === 0 && years.size > 0) return false
      }
      return true
    })

    if (filtered.length < items.length) {
      console.log(`[Trending] Filtered ${items.length - filtered.length}/${items.length} already in DB`)
    }

    return filtered
  } catch (err) {
    console.error('[Trending] DB filter error:', err)
    return items
  }
}