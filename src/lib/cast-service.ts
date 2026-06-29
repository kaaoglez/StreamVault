// ─── Cast Service ─────────────────────────────────────────
// Populates cast using Wikipedia: gets full cast list from movie page,
// then fetches actor photos (MovieStillsDB → Wikipedia fallback).
// Falls back to OMDB names (no photos) if Wikipedia fails.

import { execFileSync } from 'child_process'
import { db } from '@/lib/db'

// ── Delay helper to avoid Wikipedia rate limiting ─────────
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ── HTTP helper: tries fetch, then curl (works on any OS) ─────
async function fetchJson(url: string, timeoutMs = 8000): Promise<any> {
  // 1. Try native fetch
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.ok) return await res.json()
  } catch { /* fetch failed */ }

  // 2. Fallback: curl via execFileSync (no shell = no & interpretation issues on Windows)
  try {
    const out = execFileSync('curl', [
      '-s', '--max-time', String(Math.ceil(timeoutMs / 1000)), url
    ], { encoding: 'utf8', timeout: timeoutMs + 2000 })
    return JSON.parse(out)
  } catch { /* curl also failed */ }

  return null
}

// ── Public types ──────────────────────────────────────────────
export interface CastWithActor {
  id: string
  name: string
  imdbId: string | null
  photoUrl: string | null
  character: string | null
  order: number
}

interface RawCastMember {
  name: string
  imdbId: string
  photoUrl: string | null
  character: string
}

// ── Get actor photo: MovieStillsDB first (100% success), Wikipedia fallback ──
async function getActorPhoto(actorName: string): Promise<string | null> {
  // 1. MovieStillsDB — curl search page, extract TMDB profile photo URL
  //    Most reliable: no API key, no rate limit, professional headshots
  try {
    const searchUrl = `https://www.moviestillsdb.com/search?query=${encodeURIComponent(actorName)}`
    const out = execFileSync('curl', [
      '-s', '--max-time', '8', searchUrl
    ], { encoding: 'utf8', timeout: 10000 })
    const match = out.match(/https:\/\/image\.tmdb\.org\/[^"']+/)
    if (match) {
      return match[0].replace(/\/w185\//, '/w400/')
    }
  } catch { /* moviestillsdb failed, try wiki */ }

  // 2. Wikipedia REST API (fallback)
  try {
    const encoded = encodeURIComponent(actorName)
    const data = await fetchJson(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`
    )
    if (data?.originalimage?.source) {
      return data.originalimage.source // full-size image, never fails
    }
  } catch { /* both failed */ }

  return null
}

// ── Wikipedia: search movie/series page by title + year ──────────
// Tries multiple search queries in order until one returns results:
//   1. "Title Year film"    (e.g. "Oppenheimer 2023 film")
//   2. "Title Year"          (e.g. "The Sopranos 1999")
//   3. "Title"               (e.g. "The Usual Suspects")
async function findWikiPage(title: string, year: number): Promise<string | null> {
  const queries = [
    `${title} ${year} film`,
    `${title} ${year}`,
    title,
  ]

  for (const query of queries) {
    try {
      const search = encodeURIComponent(query)
      const data = await fetchJson(
        `https://en.wikipedia.org/w/api.php?action=opensearch&search=${search}&limit=5&format=json`
      )
      if (!data || !data[1] || data[1].length === 0) continue

      // Pick the best match — prefer the one that includes the year
      let page = data[1][0]
      for (const candidate of data[1]) {
        if (candidate.includes(String(year)) || candidate.toLowerCase().includes(title.toLowerCase())) {
          page = candidate
          break
        }
      }

      console.log(`[findWikiPage] Query "${query}" → "${page}"`)
      return page.replace(/ /g, '_')
    } catch {
      continue
    }
  }

  console.log(`[findWikiPage] No Wikipedia page found for "${title}" (${year})`)
  return null
}

// ── Wikipedia: extract actor names from Cast section ─────────
// Uses a SINGLE request for full page text, then parses locally.
// This avoids rate limiting from multiple API calls.
async function getWikiCast(pageName: string): Promise<string[]> {
  try {
    // Get full page HTML in ONE request (follows redirects automatically)
    const pageData = await fetchJson(
      `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(pageName)}&prop=text&redirects=true&format=json`,
      15000 // full page text can be large, need more time
    )
    const fullHtml = pageData?.parse?.text?.['*']
    if (!fullHtml) return []

    // Find the Cast section: look for <h2> or <h3> heading containing "Cast" or "Starring"
    const castHeadingRegex = /<(?:h[23])[^>]*>.*?(?:Cast|Starring).*?<\/(?:h[23])>/i
    const headingMatch = castHeadingRegex.exec(fullHtml)
    if (!headingMatch) return []

    // Extract everything after the Cast heading until the next heading of same or higher level
    const afterCast = fullHtml.substring(headingMatch.index + headingMatch[0].length)
    const nextHeadingRegex = /<(?:h[23])[^>]*>/i
    const nextHeading = nextHeadingRegex.exec(afterCast)
    const castHtml = nextHeading
      ? afterCast.substring(0, nextHeading.index)
      : afterCast

    // Extract actor names from Cast section
    // Pattern: each <li> starts with actor link, e.g.:
    //   <li><a href="/wiki/Name">Name</a> as <a>Character</a>...
    // Strategy: for each <li>, take ONLY the FIRST /wiki/ link = the actor name
    const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi
    const seen = new Set<string>()
    const actors: string[] = []
    let liMatch: RegExpExecArray | null

    while ((liMatch = liRegex.exec(castHtml)) !== null) {
      const liContent = liMatch[1]
      // Remove reference links like [1], [citation needed]
      const cleanContent = liContent.replace(/<sup[^>]*>[\s\S]*?<\/sup>/g, '')
      const linkMatch = /href="\/wiki\/([^"#]+)"[^>]*>([^<]+)<\/a>/.exec(cleanContent)
      if (!linkMatch) continue

      const link = linkMatch[1]
      const name = linkMatch[2].trim()

      // Skip non-people links
      if (
        link.startsWith('File:') ||
        link.startsWith('Category:') ||
        link.startsWith('Help:') ||
        link.startsWith('Wikipedia:') ||
        link.startsWith('Template:') ||
        link.startsWith('List_of') ||
        link.startsWith('List ') ||
        /^List\s/i.test(name) ||
        link.includes('(') ||  // disambiguation/qualifier
        name.startsWith('[') ||
        name.length < 3 ||
        name.length > 50 ||
        seen.has(name.toLowerCase())
      ) continue

      seen.add(name.toLowerCase())
      actors.push(name)
    }

    return actors
  } catch {
    return []
  }
}

// ── Main: populate cast for a movie ───────────────────────────
export async function populateMovieCast(
  movieId: string,
  imdbId: string,
  actorsFromOmdb?: string | null,
  movieTitle?: string,
  movieYear?: number,
  maxCast = 15
): Promise<CastWithActor[]> {
  // 1. Try Wikipedia (full cast list + photos)
  let castList: RawCastMember[] = []
  if (movieTitle && movieYear) {
    console.log(`[Cast Service] Trying Wikipedia for "${movieTitle}" (${movieYear})`)
    const wikiPage = await findWikiPage(movieTitle, movieYear)
    if (wikiPage) {
      console.log(`[Cast Service] Found Wikipedia page: ${wikiPage}`)
      const actorNames = await getWikiCast(wikiPage)
      if (actorNames.length > 0) {
        console.log(`[Cast Service] Wikipedia cast: ${actorNames.length} actors, fetching photos sequentially...`)
        castList = []
        // Fetch photos ONE BY ONE with delay to avoid rate limiting
        for (const name of actorNames.slice(0, maxCast)) {
          const photoUrl = await getActorPhoto(name)
          castList.push({ name, imdbId: '', photoUrl, character: '' })
          await sleep(200) // moviestillsdb has no rate limit, wiki fallback is rare
        }
        console.log(`[Cast Service] Wikipedia: ${castList.filter(c => c.photoUrl).length} with photos, ${castList.length} total`)
      }
    }
  }

  // 2. Fallback: OMDB actor names only, no photos (limited to ~3, not worth fetching)
  if (castList.length === 0 && actorsFromOmdb && actorsFromOmdb !== 'N/A') {
    const names = actorsFromOmdb
      .split(',')
      .map(n => n.trim())
      .filter(Boolean)
      .slice(0, maxCast)

    console.log(`[Cast Service] OMDB fallback: ${names.length} actors, no photos`)
    castList = names.map(name => ({ name, imdbId: '', photoUrl: null, character: '' }))
  }

  if (castList.length === 0) return []

  // 3. Delete existing cast relations (handles re-enrich)
  await db.movieActor.deleteMany({ where: { movieId } })

  // 4. Upsert actors and create relations
  for (let i = 0; i < castList.length; i++) {
    const member = castList[i]
    let actorId: string

    if (member.imdbId) {
      await db.actor.upsert({
        where: { imdbId: member.imdbId },
        create: { name: member.name, imdbId: member.imdbId, photoUrl: member.photoUrl },
        update: { ...(member.photoUrl ? { photoUrl: member.photoUrl } : {}) },
      })
      const actor = await db.actor.findUnique({ where: { imdbId: member.imdbId } })
      if (!actor) continue
      actorId = actor.id
    } else {
      const existing = await db.actor.findFirst({ where: { name: member.name } })
      if (existing) {
        if (member.photoUrl && !existing.photoUrl) {
          await db.actor.update({ where: { id: existing.id }, data: { photoUrl: member.photoUrl } })
        }
        actorId = existing.id
      } else {
        const created = await db.actor.create({
          data: { name: member.name, imdbId: null, photoUrl: member.photoUrl },
        })
        actorId = created.id
      }
    }

    await db.movieActor.create({
      data: { movieId, actorId, character: member.character || null, order: i },
    })
  }

  console.log(`[Cast Service] Saved ${castList.length} cast members for ${imdbId}`)
  return getMovieCast(movieId)
}

// ── Query: get cast from DB ───────────────────────────────────
export async function getMovieCast(movieId: string): Promise<CastWithActor[]> {
  const relations = await db.movieActor.findMany({
    where: { movieId },
    include: { actor: true },
    orderBy: { order: 'asc' },
  })
  return relations.map((r) => ({
    id: r.actor.id,
    name: r.actor.name,
    imdbId: r.actor.imdbId,
    photoUrl: r.actor.photoUrl,
    character: r.character,
    order: r.order,
  }))
}

// ── Query: all movies for an actor ─────────────────────────────
export async function getActorMovies(actorId: string) {
  return db.movieActor.findMany({
    where: { actorId },
    include: { movie: { select: { id: true, title: true, coverImage: true, year: true, rating: true, type: true } } },
    orderBy: { order: 'asc' },
  })
}