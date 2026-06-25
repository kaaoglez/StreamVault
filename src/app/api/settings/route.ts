import { NextResponse } from 'next/server'
import { execSync } from 'child_process'
import { getConfig, saveConfig, type AppConfig } from '@/lib/config'
import { searchMovie, getMovieDetails, resetRateLimit } from '@/lib/omdb'

export async function GET() {
  const config = getConfig()

  // Check if ffmpeg is available
  let ffmpegAvailable = false
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' })
    ffmpegAvailable = true
  } catch { /* not available */ }

  return NextResponse.json({ ...config, ffmpegAvailable })
}

export async function POST(request: Request) {
  try {
    const body: AppConfig = await request.json()
    saveConfig(body)
    return NextResponse.json({ success: true, config: body })
  } catch (error) {
    return NextResponse.json(
      { error: 'Error al guardar configuración', details: String(error) },
      { status: 500 }
    )
  }
}

// Test API key with a known movie
export async function PUT(request: Request) {
  try {
    const { omdbApiKey } = await request.json()
    if (!omdbApiKey) {
      return NextResponse.json({ error: 'No hay API key' }, { status: 400 })
    }

    // Reset rate limit so the test always works
    resetRateLimit()

    // Search for a movie everyone knows
    const search = await searchMovie('Inception', 2010, omdbApiKey)

    if (search.rateLimited) {
      return NextResponse.json({
        success: false,
        message: 'Límite diario alcanzado. Espera hasta mañana.',
      })
    }

    if (!search.result) {
      return NextResponse.json({
        success: false,
        message: `OMDB no encontró "Inception (2010)". Error: ${search.error || 'desconocido'}. Verifica la key.`,
      })
    }

    // Get full details to confirm everything works
    const details = await getMovieDetails(search.result.imdbID, omdbApiKey)
    if (!details) {
      return NextResponse.json({
        success: false,
        message: 'La búsqueda funciona pero no se pudieron obtener detalles (posible límite de API).',
      })
    }

    return NextResponse.json({
      success: true,
      message: `API key funciona! "${details.Title}" (${details.Year}) — Rating: ${details.imdbRating}`,
      poster: details.Poster,
      title: details.Title,
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: `Error: ${String(error)}`,
    }, { status: 500 })
  }
}