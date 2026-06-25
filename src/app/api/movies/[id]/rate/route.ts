import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const rating = parseFloat(body.rating)

    if (isNaN(rating) || rating < 0 || rating > 5) {
      return NextResponse.json({ error: 'Rating must be 0-5' }, { status: 400 })
    }

    const movie = await db.movie.update({
      where: { id },
      data: { userRating: rating === 0 ? null : rating },
    })

    return NextResponse.json({ userRating: movie.userRating })
  } catch (error) {
    console.error('Error rating movie:', error)
    return NextResponse.json({ error: 'Failed to rate' }, { status: 500 })
  }
}