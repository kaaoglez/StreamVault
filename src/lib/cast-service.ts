// ─── Cast Service (OMDB-First) ───────────────────────────────
// Strategy:
//   1. OMDB actors (top 3) → fetch photos via MovieStillsDB → Wikipedia fallback
//   2. Wikipedia extras → appended after OMDB (deduplicated)
//   3. Atomic save with $transaction (never lose existing cast on failure)
//   4. If new cast would be empty, keep existing data untouched

import { execFileSync } from 'child_process'
import { db } from '@/lib/db'

// ── Delay helper to avoid rate limiting ─────────────────────
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ── HTTP helper: tries fetch, then curl ─────────────────────
async function fetchJson(url: string, timeoutMs = 8000): Promise<any> {
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

// ── Get actor photo: MovieStillsDB first, Wikipedia fallback ──
async function getActorPhoto(actorName: string): Promise<string | null> {
  // 1. MovieStillsDB — curl search page, extract TMDB profile photo URL
  try {
    const searchUrl = `https://www.moviestillsdb.com/search?query=${encodeURIComponent(actorName)}`
    const out = execFileSync('curl', [
      '-s', '--max-time', '8', searchUrl
    ], { encoding: 'utf8', timeout: 10000 })
    const match = out.match(/https:\/\/image\.tmdb\.org\/[^"']+/)
    if (match) {
      return match[0].replace(/\/w185\//, '/w400/')
    }
  } catch { /* moviestillsdb failed */ }

  // 2. Wikipedia REST API (fallback)
  try {
    const encoded = encodeURIComponent(actorName)
    const data = await fetchJson(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`
    )
    if (data?.originalimage?.source) {
      return data.originalimage.source
    }
  } catch { /* both failed */ }

  return null
}

// ── Wikipedia: search movie/series page by title + year ──────────
// 3-step fallback: "Title Year film" → "Title Year" → "Title"
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

// ── Non-actor word/phrase filters for Wikipedia cast extraction ──
// These catch descriptive text that Wikipedia puts inside <li> elements
// in the Cast section but are NOT actual actor names.
const NON_ACTOR_PATTERNS = [
  /\[edit\]/i,            // Wikipedia section edit links
  /\bcast\b/i,            // "ensemble cast", "supporting cast"
  /\bcameo\b/i,           // "cameo appearance"
  /\bappearance\b/i,      // "special appearance"
  /\bnarrator\b/i,        // narrator entries
  /\bfootage\b/i,         // "archival footage"
  /\bthe\b/i,             // "The eponymous Fellowship", "The Company", etc.
  /\bfellowship\b/i,      // specific to LOTR
  /\bensemble\b/i,         // "ensemble" references
  /\bvoice\b/i,           // "voice only", "voice of"
  /\buncredited\b/i,      // uncredited roles
  /\bdouble\b/i,          // "body double", "stunt double"
  /\bstand-in\b/i,        // stand-in references
]

function isNonActor(name: string, link: string): boolean {
  // Check link-based filters first
  if (
    link.startsWith('File:') ||
    link.startsWith('Category:') ||
    link.startsWith('Help:') ||
    link.startsWith('Wikipedia:') ||
    link.startsWith('Template:') ||
    link.startsWith('List_of') ||
    link.startsWith('List ')
  ) return true

  // Check name-based filters
  if (
    /^List\s/i.test(name) ||
    name.startsWith('[') ||
    name.length < 3 ||
    name.length > 50
  ) return true

  // Check non-actor word patterns against both name and link text
  for (const pattern of NON_ACTOR_PATTERNS) {
    if (pattern.test(name) || pattern.test(link.replace(/_/g, ' '))) {
      return true
    }
  }

  return false
}

// ── Wikipedia: extract actor names from Cast section ─────────
async function getWikiCast(pageName: string): Promise<string[]> {
  try {
    const pageData = await fetchJson(
      `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(pageName)}&prop=text&redirects=true&format=json`,
      15000
    )
    const fullHtml = pageData?.parse?.text?.['*']
    if (!fullHtml) return []

    // Find the Cast section heading
    const castHeadingRegex = /<(?:h[23])[^>]*>.*?(?:Cast|Starring).*?<\/(?:h[23])>/i
    const headingMatch = castHeadingRegex.exec(fullHtml)
    if (!headingMatch) return []

    // Extract content between Cast heading and next heading
    const afterCast = fullHtml.substring(headingMatch.index + headingMatch[0].length)
    const nextHeadingRegex = /<(?:h[23])[^>]*>/i
    const nextHeading = nextHeadingRegex.exec(afterCast)
    const castHtml = nextHeading
      ? afterCast.substring(0, nextHeading.index)
      : afterCast

    // Parse each <li>: take FIRST /wiki/ link = actor name
    // Non-greedy ([\s\S]*?) naturally consumes nested <li>s into parent match
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

      // Skip non-actor entries (NO link.includes('(') filter — actors like Hugo_Weaving_(actor) are valid)
      if (isNonActor(name, link) || seen.has(name.toLowerCase())) continue

      seen.add(name.toLowerCase())
      actors.push(name)
    }

    return actors
  } catch {
    return []
  }
}

// ── Main: populate cast for a movie (OMDB-first strategy) ─────
export async function populateMovieCast(
  movieId: string,
  imdbId: string,
  actorsFromOmdb?: string | null,
  movieTitle?: string,
  movieYear?: number,
  maxCast = 15
): Promise<CastWithActor[]> {
  const finalCast: RawCastMember[] = []
  const omdbNamesLower = new Set<string>()

  // ─── STEP 1: OMDB actors FIRST (top 3) with photos ──────
  if (actorsFromOmdb && actorsFromOmdb !== 'N/A') {
    const names = actorsFromOmdb
      .split(',')
      .map(n => n.trim())
      .filter(Boolean)
      .slice(0, 3) // Top 3 from OMDB are reliable

    if (names.length > 0) {
      console.log(`[Cast Service] OMDB actors (${names.length}): ${names.join(', ')}`)
      for (const name of names) {
        omdbNamesLower.add(name.toLowerCase())
        const photoUrl = await getActorPhoto(name)
        finalCast.push({ name, imdbId: '', photoUrl, character: '' })
        await sleep(200)
      }
      console.log(`[Cast Service] OMDB: ${finalCast.filter(c => c.photoUrl).length}/${finalCast.length} with photos`)
    }
  }

  // ─── STEP 2: Wikipedia extras (skip OMDB duplicates) ────
  if (movieTitle && movieYear && finalCast.length < maxCast) {
    console.log(`[Cast Service] Trying Wikipedia for extras: "${movieTitle}" (${movieYear})`)
    const wikiPage = await findWikiPage(movieTitle, movieYear)
    if (wikiPage) {
      console.log(`[Cast Service] Found Wikipedia page: ${wikiPage}`)
      const actorNames = await getWikiCast(wikiPage)
      // Filter out OMDB duplicates
      const extras = actorNames.filter(n => !omdbNamesLower.has(n.toLowerCase()))
      console.log(`[Cast Service] Wikipedia: ${actorNames.length} total, ${extras.length} new (after OMDB dedup)`)

      for (const name of extras.slice(0, maxCast - finalCast.length)) {
        const photoUrl = await getActorPhoto(name)
        finalCast.push({ name, imdbId: '', photoUrl, character: '' })
        await sleep(200)
      }
      console.log(`[Cast Service] Wiki extras with photos: ${extras.slice(0, maxCast - finalCast.length).filter(n => finalCast.find(c => c.name === n)?.photoUrl).length}`)
    }
  }

  // Safety: if new cast would be empty, don't touch existing data
  if (finalCast.length === 0) {
    console.log(`[Cast Service] No cast found for ${imdbId}, keeping existing data`)
    return getMovieCast(movieId)
  }

  // ─── STEP 3: Atomic save with $transaction ───────────────
  console.log(`[Cast Service] Saving ${finalCast.length} cast members for ${imdbId}...`)
  await db.$transaction(async (tx) => {
    // Delete existing cast relations
    await tx.movieActor.deleteMany({ where: { movieId } })

    // Upsert actors and create relations
    for (let i = 0; i < finalCast.length; i++) {
      const member = finalCast[i]
      let actorId: string

      if (member.imdbId) {
        await tx.actor.upsert({
          where: { imdbId: member.imdbId },
          create: { name: member.name, imdbId: member.imdbId, photoUrl: member.photoUrl },
          update: { ...(member.photoUrl ? { photoUrl: member.photoUrl } : {}) },
        })
        const actor = await tx.actor.findUnique({ where: { imdbId: member.imdbId } })
        if (!actor) continue
        actorId = actor.id
      } else {
        const existing = await tx.actor.findFirst({ where: { name: member.name } })
        if (existing) {
          if (member.photoUrl && !existing.photoUrl) {
            await tx.actor.update({ where: { id: existing.id }, data: { photoUrl: member.photoUrl } })
          }
          actorId = existing.id
        } else {
          const created = await tx.actor.create({
            data: { name: member.name, imdbId: null, photoUrl: member.photoUrl },
          })
          actorId = created.id
        }
      }

      await tx.movieActor.create({
        data: { movieId, actorId, character: member.character || null, order: i },
      })
    }
  })

  console.log(`[Cast Service] ✓ Saved ${finalCast.length} cast members for ${imdbId}`)
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