import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const favorites = await db.favorite.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ favorites })
  } catch (error) {
    console.error('Error fetching favorites:', error)
    return NextResponse.json(
      { error: 'Failed to fetch favorites' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const { movieId } = await request.json()

    if (!movieId) {
      return NextResponse.json({ error: 'movieId is required' }, { status: 400 })
    }

    // Check if movie exists
    const movie = await db.movie.findUnique({ where: { id: movieId } })
    if (!movie) {
      return NextResponse.json({ error: 'Movie not found' }, { status: 404 })
    }

    // Check if already favorited
    const existing = await db.favorite.findFirst({ where: { movieId } })

    if (existing) {
      // Remove favorite (toggle off)
      await db.favorite.delete({ where: { id: existing.id } })
      return NextResponse.json({ favorited: false })
    } else {
      // Add favorite (toggle on)
      await db.favorite.create({ data: { movieId } })
      return NextResponse.json({ favorited: true })
    }
  } catch (error) {
    console.error('Error toggling favorite:', error)
    return NextResponse.json(
      { error: 'Failed to toggle favorite' },
      { status: 500 }
    )
  }
}