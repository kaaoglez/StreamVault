// ─── IMDB Cast Scraper ──────────────────────────────────────
// Scrapes actor photos from IMDB fullcredits page using the tt# ID.

const IMDB_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
}

export interface CastMember {
  name: string
  imdbId: string       // nmXXXXXXXX
  photoUrl: string | null
  character: string
}

// In-memory cache for cast data (per movie)
const castCache = new Map<string, { data: CastMember[]; timestamp: number }>()
const CAST_CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Scrape cast list from IMDB fullcredits page.
 * Returns top N cast members with photos.
 */
export async function scrapeImdbCast(imdbId: string, maxCast = 15): Promise<CastMember[]> {
  // Check cache
  const cached = castCache.get(imdbId)
  if (cached && Date.now() - cached.timestamp < CAST_CACHE_TTL) {
    return cached.data
  }

  try {
    const url = `https://www.imdb.com/title/${imdbId}/fullcredits`
    const res = await fetch(url, { headers: IMDB_HEADERS, signal: AbortSignal.timeout(12000) })
    if (!res.ok) return []

    const html = await res.text()
    const cast: CastMember[] = []

    // Parse cast from the HTML
    // IMDB uses data-testid="title-cast-item" for each cast member
    // We'll extract from the cast list section

    // Match each cast item block: from one "title-cast-item" to the next
    const itemRegex = /data-testid="title-cast-item__actor"[^>]*>[\s\S]*?<\/a>/g
    let match: RegExpExecArray | null

    while ((match = itemRegex.exec(html)) !== null && cast.length < maxCast) {
      const block = match[0]

      // Extract actor name and nm ID from the actor link
      const nameMatch = block.match(/href="\/name\/(nm\d+)\/"[^>]*>([^<]+)/)
      if (!nameMatch) continue

      const actorImdbId = nameMatch[1]
      const name = nameMatch[2].trim()
      if (!name) continue

      // Extract character name
      const charMatch = block.match(/data-testid="title-cast-item__character"[^>]*>\s*([^<\n]+)/)
      const character = charMatch ? charMatch[1].trim().replace(/^\(/, '').replace(/\)$/, '') : ''

      // Extract photo URL — IMDB uses img tags with loadlate attribute
      let photoUrl: string | null = null
      const imgMatch = block.match(/(?:src|loadlate)="([^"]+\.jpg)"/)
      if (imgMatch) {
        photoUrl = imgMatch[1]
        // Prefer higher res version
        photoUrl = photoUrl.replace(/UY\d+/, 'UY320').replace(/UX\d+/, 'UX320')
        // Skip "nopicture" placeholders
        if (photoUrl.includes('nopicture')) photoUrl = null
      }

      cast.push({ name, imdbId: actorImdbId, photoUrl, character })
    }

    // Fallback: if no items found with the new regex, try the older HTML structure
    if (cast.length === 0) {
      // Older IMDB structure: <td class="primary_photo"> and <td class="name">
      const photoRegex = /<td class="primary_photo">[\s\S]*?<img[^>]*(?:src|loadlate)="([^"]+)"[\s\S]*?<\/td>\s*<td[^>]*>\s*<a href="\/name\/(nm\d+)\/"[^>]*>([^<]+)<\/a>[\s\S]*?<td class="character">[\s\S]*?([^<\n]*)/g

      let photoMatch: RegExpExecArray | null
      while ((photoMatch = photoRegex.exec(html)) !== null && cast.length < maxCast) {
        let photo = photoMatch[1]
        const nmId = photoMatch[2]
        const name = photoMatch[3].trim()
        const character = photoMatch[4].trim().replace(/^\(/, '').replace(/\)$/, '')

        if (!name) continue
        if (photo.includes('nopicture')) photo = null
        photo = photo ? photo.replace(/UY\d+/, 'UY320').replace(/UX\d+/, 'UX320') : null

        cast.push({ name, imdbId: nmId, photoUrl: photo, character })
      }
    }

    // Cache result
    castCache.set(imdbId, { data: cast, timestamp: Date.now() })
    console.log(`[IMDB Cast] ${imdbId}: ${cast.length} cast members found`)
    return cast
  } catch (err) {
    console.error(`[IMDB Cast] Error scraping ${imdbId}:`, err)
    return []
  }
}