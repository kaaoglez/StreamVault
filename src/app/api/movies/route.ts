import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')
    const genre = searchParams.get('genre')
    const search = searchParams.get('search')
    const featured = searchParams.get('featured')
    const sort = searchParams.get('sort')
    const limit = searchParams.get('limit')
    const local = searchParams.get('local')
    const year = searchParams.get('year')

    const where: Prisma.MovieWhereInput = {}

    if (type) {
      where.type = type
    }

    if (local === 'true') {
      where.local = true
    }

    if (year) {
      where.year = parseInt(year, 10)
    }

    if (genre) {
      where.genre = { contains: genre }
    }

    if (search) {
      where.OR = [
        { title: { contains: search } },
        { description: { contains: search } },
      ]
    }

    if (featured === 'true') {
      where.featured = true
    }

    let orderBy: Prisma.MovieOrderByWithRelationInput = { createdAt: 'desc' }
    if (sort === 'rating') {
      orderBy = { rating: 'desc' }
    } else if (sort === 'userRating') {
      orderBy = { userRating: 'desc' }
    } else if (sort === 'recent') {
      orderBy = { createdAt: 'desc' }
    } else if (sort === 'year') {
      orderBy = { year: 'desc' }
    }

    const take = limit ? parseInt(limit, 10) : undefined

    const movies = await db.movie.findMany({
      where,
      orderBy,
      take,
    })

    // Check favorites for all movies (no auth, use in-memory set)
    const favorites = await db.favorite.findMany({
      select: { movieId: true },
    })
    const favoriteIds = new Set(favorites.map(f => f.movieId))

    // Check watch progress for all movies
    const progressRecords = await db.watchProgress.findMany({
      select: { movieId: true, progress: true },
    })
    const progressMap = new Map<string, number>()
    for (const p of progressRecords) {
      if (!progressMap.has(p.movieId) || progressMap.get(p.movieId)! < p.progress) {
        progressMap.set(p.movieId, p.progress)
      }
    }

    const result = movies.map((movie) => ({
      ...movie,
      isFavorite: favoriteIds.has(movie.id),
      watchProgress: progressMap.get(movie.id) || 0,
    }))

    return NextResponse.json({ movies: result, total: result.length })
  } catch (error) {
    console.error('Error fetching movies:', error)
    return NextResponse.json(
      { error: 'Failed to fetch movies' },
      { status: 500 }
    )
  }
}