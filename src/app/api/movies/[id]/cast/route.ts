import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getMovieCast } from '@/lib/cast-service'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const movie = await db.movie.findUnique({
      where: { id },
      select: { imdbId: true, director: true },
    })

    if (!movie) {
      return NextResponse.json({ error: 'Película no encontrada' }, { status: 404 })
    }

    const cast = await getMovieCast(id)

    return NextResponse.json({
      cast,
      director: movie.director || null,
    })
  } catch (error) {
    console.error('[Cast API] Error:', error)
    return NextResponse.json({ error: 'Error al obtener el reparto' }, { status: 500 })
  }
}