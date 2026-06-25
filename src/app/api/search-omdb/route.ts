import { NextRequest, NextResponse } from 'next/server'
import { searchAll } from '@/lib/omdb'
import { getConfig } from '@/lib/config'

export async function POST(request: NextRequest) {
  try {
    const { query, type, year } = await request.json()

    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return NextResponse.json({ error: 'Query debe tener al menos 2 caracteres' }, { status: 400 })
    }

    const config = getConfig()
    const apiKey = config.omdbApiKey
    if (!apiKey) {
      return NextResponse.json({ error: 'Configura la API key de OMDB en ajustes' }, { status: 400 })
    }

    let result = await searchAll(query.trim(), type || null, apiKey, year || null)

    // Double-filter by year as safety net (OMDB sometimes returns nearby years)
    if (result.results.length > 0 && year) {
      const y = String(year)
      result = {
        ...result,
        results: result.results.filter(r => r.Year === y),
      }
    }

    if (result.rateLimited) {
      return NextResponse.json({ error: result.error, rateLimited: true }, { status: 429 })
    }

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 404 })
    }

    return NextResponse.json({
      results: result.results,
      totalResults: result.totalResults,
    })
  } catch (error) {
    console.error('[search-omdb] Error:', error)
    return NextResponse.json({ error: 'Error al buscar en OMDB' }, { status: 500 })
  }
}