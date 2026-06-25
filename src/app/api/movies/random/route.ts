import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') // "movie" or "series" or null for any

    const where: any = {}
    if (type) where.type = type

    // Get all movie IDs that have local files (can be played)
    const playable = await db.movie.findMany({
      where: {
        ...where,
        OR: [
          { filePath: { not: null } },
          { videoUrl: { not: null } },
        ],
      },
      select: { id: true },
    })

    if (playable.length === 0) {
      return NextResponse.json({ error: 'No playable movies found' }, { status: 404 })
    }

    const randomId = playable[Math.floor(Math.random() * playable.length)].id
    const movie = await db.movie.findUnique({ where: { id: randomId } })

    if (!movie) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Get favorite status
    const fav = await db.favorite.findFirst({ where: { movieId: movie.id } })

    return NextResponse.json({ ...movie, isFavorite: !!fav })
  } catch (error) {
    console.error('Random movie error:', error)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}