import { NextRequest, NextResponse } from 'next/server'

// Cache: title → { videoId, title, expiry }
const cache = new Map<string, { videoId: string; title: string; expiry: number }>()
const CACHE_TTL = 30 * 60 * 1000 // 30 min

async function findTrailer(title: string): Promise<{ videoId: string; title: string } | null> {
  const query = `${title} official trailer`

  try {
    const res = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(10000),
      }
    )

    if (!res.ok) return null

    const html = await res.text()

    // Extract all unique video IDs in order
    const idMatches = html.matchAll(/"videoId":"([^"]+)"/g)
    const seenIds = new Set<string>()
    const videoIds: string[] = []

    for (const match of idMatches) {
      const id = match[1]
      if (!seenIds.has(id)) {
        seenIds.add(id)
        videoIds.push(id)
      }
      if (videoIds.length >= 10) break
    }

    if (videoIds.length === 0) return null

    // Try to find titles for the videos to pick the best one
    const titles: { id: string; title: string }[] = []
    // YouTube stores titles in different formats, try to extract
    const titlePatterns = [
      /"title":\s*\{"runs":\s*\[\s*\{"text":\s*"([^"]+)"/g,
      /"title":\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g,
    ]

    // Simple approach: get video IDs and check if any known trailer patterns match
    // Since we search for "official trailer", the first result is usually correct
    // Return the first video ID as the trailer
    return { videoId: videoIds[0], title: `${title} - Trailer` }
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const title = req.nextUrl.searchParams.get('title')
  if (!title || title.trim().length === 0) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  const key = title.trim().toLowerCase()

  // Check cache
  const cached = cache.get(key)
  if (cached && cached.expiry > Date.now()) {
    return NextResponse.json(cached)
  }

  const result = await findTrailer(title.trim())

  if (!result) {
    return NextResponse.json({ error: 'Trailer not found' }, { status: 404 })
  }

  // Cache result
  cache.set(key, { ...result, expiry: Date.now() + CACHE_TTL })

  return NextResponse.json(result)
}