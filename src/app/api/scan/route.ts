import { NextResponse } from 'next/server'
import { scanMultipleSeriesFolders, scanMultipleMovieFolders, scanSeriesWithDiagnostics, type ParsedSeriesGroup, type ParsedMovieGroup } from '@/lib/scanner'
import { searchMovie, searchSeries, getMovieDetails, getSeasonEpisodes, isRateLimited, resetRateLimit, type OmdbEpisode } from '@/lib/omdb'
import { getConfig } from '@/lib/config'
import { db } from '@/lib/db'

// ─── Title matching helper ─────────────────────────────────────────
// Normaliza un título: minúsculas, quita caracteres especiales, colapsa espacios
function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Compara si dos títulos se refieren a la misma película/serie
// Solo match si son iguales después de normalizar (sin includes)
function titlesMatch(dbTitle: string, omdbTitle: string): boolean {
  const a = normalizeTitle(dbTitle)
  const b = normalizeTitle(omdbTitle)
  return a === b
}

// ─── Shared types ────────────────────────────────────────────────

interface ScanProgress {
  phase: 'scanning' | 'fetching' | 'done' | 'error'
  operation?: 'import' | 'enrich' | 'legacy'
  current: number
  total: number
  title: string
  message: string
  found: number
  matched: number
  failed: number
  errors: string[]
  rateLimited: boolean
}

let scanStatus: ScanProgress | null = null

// ─── GET: poll scan status ───────────────────────────────────────

export async function GET() {
  return NextResponse.json({
    scanning: scanStatus !== null && scanStatus.phase !== 'done' && scanStatus.phase !== 'error',
    progress: scanStatus,
  })
}

// ─── POST: two actions ───────────────────────────────────────────
//   ?action=import   → scan HD, store in DB (NO OMDB needed)
//   ?action=enrich   → enrich existing DB entries with OMDB data
//   (default, no action) → legacy: scan + OMDB in one step

export async function POST(request: Request) {
  const url = new URL(request.url)
  const action = url.searchParams.get('action')

  if (action === 'import') {
    return handleImport()
  }
  if (action === 'enrich') {
    const force = url.searchParams.get('force') === '1'
    return handleEnrich(force)
  }

  // Legacy: scan + OMDB in one step
  return handleLegacyScan()
}

// ─── ACTION 1: Import from HD → DB (no OMDB) ─────────────────────

async function handleImport() {
  try {
    const config = getConfig()
    const hasMovies = config.moviesFolders.some(f => f.trim())
    const hasSeries = config.seriesFolders.some(f => f.trim())

    if (!hasMovies && !hasSeries) {
      return NextResponse.json({ error: 'No hay carpetas configuradas' }, { status: 400 })
    }

    // Run import in background
    runImport(config.moviesFolders, config.seriesFolders).catch(err => {
      console.error('Import failed:', err)
    })

    return NextResponse.json({ success: true, message: 'Importación desde HD iniciada' })
  } catch (error) {
    scanStatus = null
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

async function runImport(moviesFolders: string[], seriesFolders: string[]) {
  const errors: string[] = []
  let added = 0
  let updated = 0
  let removed = 0
  let unchanged = 0

  try {
    scanStatus = {
      phase: 'scanning', current: 0, total: 0, title: '', message: 'Escaneando carpetas desde HD...', operation: 'import',
      found: 0, matched: 0, failed: 0, errors: [], rateLimited: false,
    }

    // ================================================================
    // PHASE 1: Scan HD folders
    // ================================================================

    const movieGroups: ParsedMovieGroup[] = []
    for (const folder of moviesFolders) {
      if (!folder.trim()) continue
      try { movieGroups.push(...await scanMultipleMovieFolders([folder])) }
      catch (err) { errors.push('Peliculas "' + folder + '": ' + String(err)) }
    }

    const seriesGroups: ParsedSeriesGroup[] = []
    const diagMessages: string[] = []
    for (const folder of seriesFolders) {
      if (!folder.trim()) continue
      try {
        const { groups, diag } = scanSeriesWithDiagnostics(folder)
        seriesGroups.push(...groups)
        if (diag.autoCorrected) diagMessages.push('Auto-corregido a: ' + diag.folderScanned)
        if (diag.subdirsFound.length === 0) diagMessages.push('Carpeta vacia: ' + folder)
        else {
          const names = groups.map(g => g.seriesTitle + ' (' + g.episodes.length + ' eps)').join(', ')
          diagMessages.push('Series: ' + (names || 'ninguna'))
        }
      } catch (err) { errors.push('Series "' + folder + '": ' + String(err)) }
    }

    const diagInfo = diagMessages.length > 0 ? ' [' + diagMessages.join(' | ') + ']' : ''
    const totalItems = movieGroups.length + seriesGroups.length

    scanStatus = {
      ...scanStatus!,
      total: totalItems,
      message: 'Escaneado: ' + movieGroups.length + ' peliculas, ' + seriesGroups.length + ' series. Sincronizando...' + diagInfo,
    }

    // ================================================================
    // PHASE 2: Load current DB state for sync comparison
    // ================================================================

    console.log('[Sync] Cargando estado actual de la DB...')
    const existingMovies = await db.movie.findMany({ where: { type: 'movie', local: true } })
    const existingSeries = await db.movie.findMany({
      where: { type: 'series', local: true },
      include: { episodes: { select: { id: true, filePath: true, seasonNumber: true, episodeNumber: true, title: true } } },
    })

    // filePath -> movie record
    const movieByPath = new Map<string, typeof existingMovies[0]>()
    for (const m of existingMovies) { if (m.filePath) movieByPath.set(m.filePath, m) }

    // filePath -> { seriesId, episodeId, seasonNumber, episodeNumber, title }
    const epPathToInfo = new Map<string, { seriesId: string; episodeId: string; seasonNumber: number; episodeNumber: number; title: string }>()
    for (const s of existingSeries) {
      for (const ep of s.episodes) {
        if (ep.filePath) epPathToInfo.set(ep.filePath, { seriesId: s.id, episodeId: ep.id, seasonNumber: ep.seasonNumber, episodeNumber: ep.episodeNumber, title: ep.title })
      }
    }

    // title -> movie record (for fallback matching when filePath changed)
    const movieByTitle = new Map<string, typeof existingMovies[0]>()
    for (const m of existingMovies) { movieByTitle.set(m.title.toLowerCase(), m) }

    // seriesId -> { series record, episodes keyed by "SxE" }
    const seriesById = new Map<string, { record: typeof existingSeries[0], epByKey: Map<string, typeof existingSeries[0]['episodes'][0]> }>()
    for (const s of existingSeries) {
      const epByKey = new Map<string, typeof existingSeries[0]['episodes'][0]>()
      for (const ep of s.episodes) {
        epByKey.set(s.id + ':' + ep.seasonNumber + ':' + ep.episodeNumber, ep)
      }
      seriesById.set(s.id, { record: s, epByKey })
    }

    // seriesTitle (lower) -> seriesId (for fallback matching when filePath changed)
    const seriesIdByTitle = new Map<string, string>()
    for (const s of existingSeries) { seriesIdByTitle.set(s.title.toLowerCase(), s.id) }

    console.log('[Sync] DB actual: ' + existingMovies.length + ' peliculas, ' + existingSeries.length + ' series, ' + epPathToInfo.size + ' episodios')

    // Track which DB records were matched (by any method)
    const matchedMovieIds = new Set<string>()
    const matchedEpisodeIds = new Set<string>()
    const matchedSeriesIds = new Set<string>()

    // ================================================================
    // PHASE 3: Sync movies
    // ================================================================

    console.log('[Sync] Sincronizando ' + movieGroups.length + ' peliculas...')
    for (let i = 0; i < movieGroups.length; i++) {
      const group = movieGroups[i]
      scanStatus = { ...scanStatus!, current: i + 1, title: group.movieTitle, message: 'Pelicula ' + (i + 1) + '/' + movieGroups.length + ': ' + group.movieTitle, errors: [...errors] }

      try {
        for (const file of group.files) {
          // METHOD 1: Match by filePath (exact)
          let existing = movieByPath.get(file.filePath)

          if (existing) {
            // File path unchanged — mark as matched, done
            matchedMovieIds.add(existing.id)
            unchanged++
          } else {
            // METHOD 2: Match by title (file was renamed/moved)
            existing = movieByTitle.get(file.title.toLowerCase())

            if (existing && !matchedMovieIds.has(existing.id)) {
              // Found by title but not by path → file was renamed/moved
              // Update filePath to new location, PRESERVE all OMDB data
              await db.movie.update({
                where: { id: existing.id },
                data: { filePath: file.filePath },
              })
              matchedMovieIds.add(existing.id)
              updated++
              console.log('[Sync]   ~ Pelicula relocalizada: "' + existing.title + '" (path actualizado)')
            } else if (!existing) {
              // METHOD 3: Brand new movie
              await db.movie.create({
                data: {
                  title: file.title, description: '', coverImage: '/posters/default.svg',
                  backdropImage: '/posters/default.svg', filePath: file.filePath,
                  year: file.year || 2024, rating: 0, genre: 'Desconocido',
                  type: 'movie', maturity: 'TV-MA', local: true,
                },
              })
              added++
              console.log('[Sync]   + Pelicula nueva: ' + file.title)
            } else {
              // Title matched but already claimed by another file path — treat as new
              await db.movie.create({
                data: {
                  title: file.title, description: '', coverImage: '/posters/default.svg',
                  backdropImage: '/posters/default.svg', filePath: file.filePath,
                  year: file.year || 2024, rating: 0, genre: 'Desconocido',
                  type: 'movie', maturity: 'TV-MA', local: true,
                },
              })
              added++
              console.log('[Sync]   + Pelicula nueva (duplicado de titulo): ' + file.title)
            }
          }
        }
      } catch (err) { errors.push('Pelicula "' + group.movieTitle + '": ' + String(err)) }
    }

    // Delete movies NOT matched by any method
    for (const movie of existingMovies) {
      if (!matchedMovieIds.has(movie.id)) {
        await db.movie.delete({ where: { id: movie.id } })
        removed++
        console.log('[Sync]   - Pelicula eliminada (ya no existe en HD): ' + movie.title)
      }
    }

    // ================================================================
    // PHASE 4: Sync series & episodes
    // ================================================================

    console.log('[Sync] Sincronizando ' + seriesGroups.length + ' series...')
    for (let i = 0; i < seriesGroups.length; i++) {
      const group = seriesGroups[i]
      scanStatus = { ...scanStatus!, current: movieGroups.length + i + 1, title: group.seriesTitle, message: 'Serie ' + (i + 1) + '/' + seriesGroups.length + ': ' + group.seriesTitle, errors: [...errors] }

      try {
        // ── Find or create the series record ──

        let seriesId: string | null = null

        // METHOD 1: Check if any episode filePath already matches
        for (const ep of group.episodes) {
          if (ep.filePath && epPathToInfo.has(ep.filePath)) {
            seriesId = epPathToInfo.get(ep.filePath)!.seriesId
            break
          }
        }

        // METHOD 2: Match by title (series folder was renamed)
        if (!seriesId) {
          seriesId = seriesIdByTitle.get(group.seriesTitle.toLowerCase()) || null
        }

        let isNewSeries = false
        if (!seriesId) {
          // METHOD 3: Create new series
          const created = await db.movie.create({
            data: {
              title: group.seriesTitle, description: '', coverImage: '/posters/default.svg',
              backdropImage: '/posters/default.svg', year: group.year || 2024,
              rating: 0, genre: 'Desconocido', type: 'series', maturity: 'TV-MA', local: true,
            },
          })
          seriesId = created.id
          isNewSeries = true
          added++
          console.log('[Sync]   + Serie nueva: ' + group.seriesTitle)
        } else {
          matchedSeriesIds.add(seriesId)
          // Update year if we have a better one and no OMDB data
          if (!isNewSeries) {
            const existing = seriesById.get(seriesId)?.record
            if (existing && group.year && (!existing.year || existing.year === 2024) && !existing.imdbId) {
              await db.movie.update({ where: { id: seriesId }, data: { year: group.year } })
            }
          }
        }

        // ── Sync episodes ──
        const seriesData = seriesById.get(seriesId)
        const epByKey = seriesData?.epByKey || new Map()

        let epAdded = 0
        let epUpdated = 0
        let epUnchanged = 0

        for (const ep of group.episodes) {
          const newSeason = ep.season || 1
          const newEpNum = ep.episode || 1
          const epKey = seriesId + ':' + newSeason + ':' + newEpNum

          // METHOD 1: Match by filePath (exact)
          const existingByPath = epPathToInfo.get(ep.filePath)

          if (existingByPath && existingByPath.seriesId === seriesId) {
            // Exact path match — mark as matched
            matchedEpisodeIds.add(existingByPath.episodeId)

            // Check if season/episode numbers changed
            if (existingByPath.seasonNumber !== newSeason || existingByPath.episodeNumber !== newEpNum) {
              // Numbers changed → old title was for a different episode, reset it
              // so next OMDB enrich will assign the correct title
              await db.episode.update({
                where: { id: existingByPath.episodeId },
                data: {
                  seasonNumber: newSeason,
                  episodeNumber: newEpNum,
                  title: 'Episodio ' + newEpNum,
                  description: null,
                },
              })
              epUpdated++
              console.log('[Sync]     Ep renumerado: S' + existingByPath.seasonNumber + 'E' + existingByPath.episodeNumber + ' → S' + newSeason + 'E' + newEpNum + ' (título reseteado)')
            } else {
              epUnchanged++
            }
          } else {
            // METHOD 2: Match by (seriesId, season, episode) — file was renamed/moved
            const existingByKey = epByKey.get(epKey)

            if (existingByKey && !matchedEpisodeIds.has(existingByKey.id)) {
              // Found by position but not by path → file was renamed/moved
              // Update filePath and numbers, reset title if numbers changed
              const numbersChanged = existingByKey.seasonNumber !== newSeason || existingByKey.episodeNumber !== newEpNum
              await db.episode.update({
                where: { id: existingByKey.id },
                data: {
                  filePath: ep.filePath,
                  seasonNumber: newSeason,
                  episodeNumber: newEpNum,
                  ...(numbersChanged ? { title: 'Episodio ' + newEpNum, description: null } : {}),
                },
              })
              matchedEpisodeIds.add(existingByKey.id)
              epUpdated++
              if (numbersChanged) {
                console.log('[Sync]     Ep relocalizado+renumerado: S' + existingByKey.seasonNumber + 'E' + existingByKey.episodeNumber + ' → S' + newSeason + 'E' + newEpNum + ' (título reseteado)')
              }
            } else {
              // METHOD 3: Brand new episode
              await db.episode.create({
                data: {
                  seriesId: seriesId,
                  seasonNumber: newSeason,
                  episodeNumber: newEpNum,
                  title: 'Episodio ' + newEpNum,
                  filePath: ep.filePath,
                },
              })
              matchedEpisodeIds.add('new:' + ep.filePath) // track so we don't try to match it again
              epAdded++
            }
          }
        }

        const totalEps = epAdded + epUpdated + epUnchanged
        if (epAdded > 0 || epUpdated > 0) {
          console.log('[Sync]   ' + group.seriesTitle + ': +' + epAdded + ' nuevos, ~' + epUpdated + ' relocalizados, ' + epUnchanged + ' sin cambios')
          added += epAdded
          updated += epUpdated
          unchanged += epUnchanged
        } else {
          unchanged += totalEps
        }
      } catch (err) { errors.push('Serie "' + group.seriesTitle + '": ' + String(err)) }
    }

    // Delete episodes NOT matched by any method
    let epsRemoved = 0
    for (const [filePath, info] of epPathToInfo) {
      if (!matchedEpisodeIds.has(info.episodeId)) {
        await db.episode.delete({ where: { id: info.episodeId } })
        epsRemoved++
      }
    }
    removed += epsRemoved

    // Delete series with 0 remaining episodes
    const emptySeries = await db.movie.findMany({
      where: { type: 'series', local: true },
      include: { _count: { select: { episodes: true } } },
    })
    for (const s of emptySeries) {
      if (s._count.episodes === 0) {
        await db.movie.delete({ where: { id: s.id } })
        removed++
        console.log('[Sync]   - Serie eliminada (sin episodios): ' + s.title)
      }
    }

    // ================================================================
    // Done
    // ================================================================

    const finalMovies = await db.movie.count({ where: { type: 'movie', local: true } })
    const finalSeries = await db.movie.count({ where: { type: 'series', local: true } })
    const finalEps = await db.episode.count()

    console.log('[Sync] RESULTADO: +' + added + ' nuevos, ~' + updated + ' relocalizados/actualizados, ' + unchanged + ' sin cambios, -' + removed + ' eliminados')
    console.log('[Sync] Total en DB: ' + finalMovies + ' peliculas, ' + finalSeries + ' series, ' + finalEps + ' episodios')

    scanStatus = {
      phase: 'done',
      current: totalItems, total: totalItems,
      title: '',
      message: 'Sync: +' + added + ' nuevos, ~' + updated + ' actualizados, ' + unchanged + ' sin cambios, -' + removed + ' eliminados. Total: ' + finalMovies + ' peliculas, ' + finalSeries + ' series (' + finalEps + ' eps).' + diagInfo,
      found: added, matched: updated, failed: removed, errors, rateLimited: false,
    }
  } catch (error) {
    scanStatus = {
      phase: 'error', current: 0, total: 0, title: '',
      message: 'Error: ' + String(error),
      found: added, matched: updated, failed: removed, errors: [...errors, String(error)], rateLimited: false,
    }
  }
}


// ─── ACTION 2: Enrich existing DB entries with OMDB ──────────────

async function handleEnrich(force: boolean = false) {
  try {
    const config = getConfig()
    if (!config.omdbApiKey) {
      return NextResponse.json({ error: 'Configura la API key de OMDB primero' }, { status: 400 })
    }

    resetRateLimit()

    runEnrich(config.omdbApiKey, force).catch(err => {
      console.error('Enrich failed:', err)
    })

    return NextResponse.json({ success: true, message: force ? 'Re-certificación forzada con OMDB iniciada' : 'Certificación con OMDB iniciada' })
  } catch (error) {
    scanStatus = null
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

async function runEnrich(apiKey: string, force: boolean = false) {
  const errors: string[] = []
  let found = 0
  let matched = 0
  let failed = 0

  try {
    // ── Build the WHERE clause ──
    // Normal: find entries that need enrichment (missing poster, desc, imdbId, or genre)
    // Force: process ALL local entries
    // Also: always include series that have episodes with wrong/placeholder titles
    const normalWhere = {
      local: true,
      OR: [
        { imdbId: null },
        { description: '' },
        { coverImage: '/posters/default.svg' },
        { genre: 'Desconocido' },
      ],
    }

    let movies: Awaited<ReturnType<typeof db.movie.findMany>>

    if (force) {
      // Force mode: ALL local entries
      movies = await db.movie.findMany({ where: { local: true } })
      console.log(`[Enrich] MODO FORZADO: procesando TODOS los ${movies.length} títulos locales`)
    } else {
      // Normal mode: entries that need enrichment
      movies = await db.movie.findMany({ where: normalWhere })

      // ALSO include series whose episodes have wrong titles (all same title, or placeholder "Episodio N")
      if (!isRateLimited()) {
        const allSeries = await db.movie.findMany({
          where: { local: true, type: 'series', imdbId: { not: null } },
          include: {
            episodes: {
              select: { id: true, title: true, seasonNumber: true, episodeNumber: true },
              orderBy: [{ seasonNumber: 'asc' }, { episodeNumber: 'asc' }],
            },
          },
        })

        const alreadyIncluded = new Set(movies.map(m => m.id))
        for (const s of allSeries) {
          if (alreadyIncluded.has(s.id)) continue
          if (s.episodes.length === 0) continue

          // Detect episodes with wrong titles:
          // 1. All episodes have the same title (sign of the old bug)
          // 2. Episode titles match the series title (scanner placeholder)
          // 3. Episode titles start with "Episodio " (import placeholder)
          const needsFix = s.episodes.some(ep =>
            ep.title.startsWith('Episodio ') || ep.title === s.title
          )

          // Check if all episodes in a season share the same title
          if (!needsFix) {
            const bySeason = new Map<number, typeof s.episodes[0][]>()
            for (const ep of s.episodes) {
              const sn = ep.seasonNumber
              if (!bySeason.has(sn)) bySeason.set(sn, [])
              bySeason.get(sn)!.push(ep)
            }
            for (const [sn, eps] of bySeason) {
              if (eps.length >= 2) {
                const allSameTitle = eps.every(ep => ep.title === eps[0].title)
                if (allSameTitle) {
                  console.log(`[Enrich] Serie "${s.title}" T${sn}: ${eps.length} episodios con el mismo título "${eps[0].title}" — necesita re-certificación`)
                  break
                }
              }
            }
            // Re-check after loop
            const allSameInAnySeason = [...bySeason.values()].some(eps =>
              eps.length >= 2 && eps.every(ep => ep.title === eps[0].title)
            )
            if (allSameInAnySeason) {
              movies.push(s)
              alreadyIncluded.add(s.id)
              continue
            }
          } else {
            movies.push(s)
            alreadyIncluded.add(s.id)
            continue
          }
        }
      }

      console.log(`[Enrich] Certificación OMDB: ${movies.length} títulos necesitan datos`)
    }

    found = movies.length
    console.log(`[Enrich] Resumen de la DB:`)
    const allLocal = await db.movie.findMany({ where: { local: true } })
    const withPoster = allLocal.filter(m => m.coverImage && !m.coverImage.includes('default')).length
    const withDesc = allLocal.filter(m => m.description && m.description.length > 0).length
    const withImdb = allLocal.filter(m => m.imdbId).length
    console.log(`[Enrich]   Total local: ${allLocal.length}, con poster: ${withPoster}, con descripción: ${withDesc}, con imdbId: ${withImdb}`)

    scanStatus = {
      phase: 'fetching', current: 0, total: found, operation: 'enrich',
      title: '', message: `Certificando ${found} títulos con OMDB${force ? ' (FORZADO)' : ''}...`,
      found, matched: 0, failed: 0, errors: [], rateLimited: false,
    }

    for (let i = 0; i < movies.length; i++) {
      const movie = movies[i]

      if (isRateLimited()) {
        errors.push(`Límite de OMDB alcanzado. Se certificaron ${matched} de ${found} títulos.`)
        break
      }

      scanStatus = {
        ...scanStatus!,
        current: i + 1,
        title: movie.title,
        message: `Certificando ${i + 1}/${found}: ${movie.title}`,
        matched, failed, errors: [...errors], rateLimited: false,
      }

      try {
        const isSeries = movie.type === 'series'
        let imdbId = movie.imdbId || null
        let sr = null // search result

        // ── STEP A: Search OMDB (skip if we already have imdbId) ──
        let verifiedDetails: Awaited<ReturnType<typeof getMovieDetails>> | null = null
        if (imdbId) {
          // Verificar que el imdbId existente realmente corresponde a esta película
          verifiedDetails = await getMovieDetails(imdbId, apiKey)
          if (verifiedDetails && verifiedDetails.Title && !titlesMatch(movie.title, verifiedDetails.Title)) {
            console.log(`[Enrich] "${movie.title}" tiene imdbId=${imdbId} pero corresponde a "${verifiedDetails.Title}" — limpiando imdbId incorrecto`)
            await db.movie.update({ where: { id: movie.id }, data: { imdbId: null } })
            imdbId = null
            verifiedDetails = null
          } else {
            console.log(`[Enrich] "${movie.title}" ya tiene imdbId=${imdbId}, verificado OK`)
          }
        }

        if (!imdbId) {
          let searchResult = isSeries
            ? await searchSeries(movie.title, movie.year || undefined, apiKey)
            : await searchMovie(movie.title, movie.year || undefined, apiKey)

          // If search fails and we used a year, retry without year
          if (!searchResult.result && !searchResult.rateLimited && movie.year) {
            console.log(`[Enrich] "${movie.title}" sin resultado con año ${movie.year}, reintentando sin año`)
            searchResult = isSeries
              ? await searchSeries(movie.title, undefined, apiKey)
              : await searchMovie(movie.title, undefined, apiKey)
          }

          if (searchResult.rateLimited) {
            errors.push(`Límite de OMDB alcanzado. Se certificaron ${matched} de ${found} títulos.`)
            break
          }

          if (searchResult.result) {
            sr = searchResult.result
            // ── TITLE MATCH CHECK ──
            if (!titlesMatch(movie.title, sr.Title)) {
              console.log(`[Enrich] "${movie.title}" → OMDB devolvió "${sr.Title}" — NO coinciden, saltando`)
              failed++
              if (failed <= 10) {
                errors.push(`"${movie.title}" → OMDB devolvió "${sr.Title}" (título diferente)`)
              }
              await new Promise(r => setTimeout(r, 200))
              continue
            }
            imdbId = sr.imdbID
            console.log(`[Enrich] "${movie.title}" → encontrado: "${sr.Title}" (${sr.imdbID})`)
          } else {
            failed++
            const omdbErr = searchResult.error || 'sin respuesta'
            console.log(`[Enrich] "${movie.title}" → NO ENCONTRADO: ${omdbErr}`)
            if (failed <= 10) {
              errors.push(`"${movie.title}" → ${omdbErr}`)
            }
            await new Promise(r => setTimeout(r, 200))
            continue
          }
        }

        // ── STEP B: Get full details from OMDB ──
        if (!imdbId) {
          console.log(`[Enrich] "${movie.title}" sin imdbId, saltando details`)
          failed++
          continue
        }

        // Skip getMovieDetails if already enriched (unless force mode)
        // Reuse verifiedDetails from step A if available (avoids duplicate API call)
        let details: Awaited<ReturnType<typeof getMovieDetails>> | null = verifiedDetails || null
        const needsDetailsUpdate = force || !movie.description || movie.coverImage === '/posters/default.svg' || movie.genre === 'Desconocido'

        if (needsDetailsUpdate && !details) {
          details = await getMovieDetails(imdbId, apiKey)
          if (!details) {
            console.log(`[Enrich] "${movie.title}" getMovieDetails("${imdbId}") falló`)
            // Still save imdbId so next time we know it was searched
            if (!movie.imdbId) {
              await db.movie.update({ where: { id: movie.id }, data: { imdbId } })
            }
            // Don't fail — we can still process episodes
            console.log(`[Enrich] "${movie.title}" details fallaron, intentando episodios de todas formas...`)
          }
        }

        // ── STEP C: Build update data from OMDB details ──
        if (details) {
          let description = details.Plot && details.Plot !== 'N/A' ? details.Plot : movie.description
          let rating = details.imdbRating && details.imdbRating !== 'N/A' ? parseFloat(details.imdbRating) || 0 : movie.rating
          let year = details.Year ? parseInt(details.Year) || movie.year : movie.year
          let genre = details.Genre && details.Genre !== 'N/A' ? details.Genre : movie.genre
          let maturity = details.Rated && details.Rated !== 'N/A' ? details.Rated : movie.maturity
          let duration: string | null = details.Runtime && details.Runtime !== 'N/A' ? details.Runtime : movie.duration

          // Poster: prefer details.Poster (full), fallback to search.Poster, fallback to current
          let poster = movie.coverImage
          if (details.Poster && details.Poster !== 'N/A') {
            poster = details.Poster
          } else if (sr && sr.Poster && sr.Poster !== 'N/A') {
            poster = sr.Poster
          }

          console.log(`[Enrich] "${movie.title}" → poster: ${poster === movie.coverImage ? '(sin cambio)' : poster.substring(0, 60) + '...'}, desc: ${description ? description.length + ' chars' : '(vacía)'}`)

          // ── STEP D: Update movie in DB ──
          await db.movie.update({
            where: { id: movie.id },
            data: {
              title: movie.title, // NUNCA sobreescribir el título de la DB con el de OMDB
              imdbId,
              description,
              coverImage: poster,
              backdropImage: poster,
              year, rating, genre, maturity, duration,
            },
          })
        }

        // ── STEP E: Fetch episode details for series ──
        // ALWAYS process episodes for series, even if the series record is already enriched
        if (isSeries && imdbId && !isRateLimited()) {
          const episodes = await db.episode.findMany({
            where: { seriesId: movie.id },
            orderBy: [{ seasonNumber: 'asc' }, { episodeNumber: 'asc' }],
          })
          const seasons = new Set(episodes.map(e => e.seasonNumber))
          console.log(`[Enrich] Serie "${movie.title}": ${episodes.length} episodios en ${seasons.size} temporadas`)

          // Check if episodes actually need updating
          let episodesNeedUpdate = force
          if (!episodesNeedUpdate) {
            // Detect any season where all episodes share the same title (the bug pattern)
            const bySeason = new Map<number, typeof episodes[0][]>()
            for (const ep of episodes) {
              const sn = ep.seasonNumber
              if (!bySeason.has(sn)) bySeason.set(sn, [])
              bySeason.get(sn)!.push(ep)
            }
            for (const [sn, eps] of bySeason) {
              if (eps.length >= 2 && eps.every(ep => ep.title === eps[0].title)) {
                console.log(`[Enrich]   DETECTADO: T${sn} tiene ${eps.length} episodios con mismo título "${eps[0].title}" — se re-procesarán`)
                episodesNeedUpdate = true
                break
              }
            }
            // Also check for placeholder titles
            if (!episodesNeedUpdate) {
              episodesNeedUpdate = episodes.some(ep =>
                ep.title.startsWith('Episodio ') || ep.title === movie.title
              )
            }
          }

          if (episodesNeedUpdate) {
            for (const seasonNum of seasons) {
              try {
                const omdbEps = await getSeasonEpisodes(imdbId, seasonNum, apiKey)
                if (omdbEps) {
                  console.log(`[Enrich]   T${seasonNum}: OMDB devolvió ${omdbEps.length} episodios`)
                  const seasonEps = episodes.filter(e => e.seasonNumber === seasonNum)
                  // Track which OMDB episodes have been matched to avoid duplicates
                  const matchedOmdbEps = new Set<number>()
                  let epUpdated = 0
                  for (const ep of seasonEps) {
                    const omdbEp = omdbEps.find(e => {
                      const epNum = parseInt(e.Episode, 10)
                      return epNum === ep.episodeNumber && !matchedOmdbEps.has(epNum)
                    })
                    if (omdbEp) {
                      const epNum = parseInt(omdbEp.Episode, 10)
                      matchedOmdbEps.add(epNum)
                      const omdbTitle = omdbEp.Title || ep.title
                      const omdbPlot = omdbEp.Plot
                      await db.episode.update({
                        where: { id: ep.id },
                        data: {
                          title: omdbTitle,
                          description: omdbPlot && omdbPlot !== 'N/A' ? omdbPlot : ep.description,
                        },
                      })
                      epUpdated++
                      console.log(`[Enrich]     Ep ${ep.episodeNumber}: "${ep.title}" → "${omdbTitle}"`)
                    } else {
                      console.log(`[Enrich]     Ep ${ep.episodeNumber}: sin coincidencia en OMDB (manteniendo "${ep.title}")`)
                    }
                  }
                  console.log(`[Enrich]   T${seasonNum}: ${epUpdated}/${seasonEps.length} episodios actualizados`)
                } else {
                  console.log(`[Enrich]   T${seasonNum}: OMDB no devolvió datos`)
                }
              } catch (seasonErr) {
                console.log(`[Enrich]   T${seasonNum}: error - ${String(seasonErr)}`)
              }
            }
          } else {
            console.log(`[Enrich] Serie "${movie.title}": episodios ya correctos, saltando`)
          }
        }

        matched++
      } catch (err) {
        failed++
        console.log(`[Enrich] ERROR "${movie.title}": ${String(err)}`)
        errors.push(`"${movie.title}": ${String(err)}`)
      }

      await new Promise(r => setTimeout(r, 200))
    }

    const rateLimitedNow = isRateLimited()
    let msg: string
    if (rateLimitedNow) {
      msg = `Límite diario alcanzado. ${matched} certificados, ${failed} sin coincidencia. Vuelve mañana.`
    } else if (matched === 0) {
      msg = `${found} títulos en DB, 0 con datos de OMDB. Revisa errores y el log del servidor.`
    } else {
      msg = `Certificación completa: ${matched} con datos OMDB, ${failed} sin coincidencia.`
    }

    console.log(`[Enrich] RESULTADO: ${msg}`)
    scanStatus = {
      phase: 'done', current: movies.length, total: found,
      title: '', message: msg,
      found, matched, failed, errors, rateLimited: rateLimitedNow,
    }
  } catch (error) {
    console.log(`[Enrich] ERROR FATAL: ${String(error)}`)
    scanStatus = {
      phase: 'error', current: 0, total: 0, title: '',
      message: `Error: ${String(error)}`,
      found, matched, failed, errors: [...errors, String(error)], rateLimited: false,
    }
  }
}

// ─── Legacy: scan + OMDB in one step (kept for compatibility) ─────

async function handleLegacyScan() {
  try {
    const config = getConfig()
    const hasMovies = config.moviesFolders.some(f => f.trim())
    const hasSeries = config.seriesFolders.some(f => f.trim())

    if (!hasMovies && !hasSeries) {
      return NextResponse.json({ error: 'No hay carpetas configuradas' }, { status: 400 })
    }
    if (!config.omdbApiKey) {
      return NextResponse.json({ error: 'No hay API key de OMDB' }, { status: 400 })
    }

    resetRateLimit()

    runLegacyScan(config.omdbApiKey, config.moviesFolders, config.seriesFolders).catch(err => {
      console.error('Scan failed:', err)
    })

    return NextResponse.json({ success: true, message: 'Escaneo iniciado' })
  } catch (error) {
    scanStatus = null
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

async function runLegacyScan(apiKey: string, moviesFolders: string[], seriesFolders: string[]) {
  const errors: string[] = []
  let found = 0
  let matched = 0
  let failed = 0
  try {
    scanStatus = {
      phase: 'scanning', current: 0, total: 0, title: '', message: 'Escaneando carpetas...',
      found: 0, matched: 0, failed: 0, errors: [], rateLimited: false,
    }

    // Scan movies using folder-based detection
    const movieGroups: ParsedMovieGroup[] = []
    for (const folder of moviesFolders) {
      if (!folder.trim()) continue
      try {
        const groups = await scanMultipleMovieFolders([folder])
        movieGroups.push(...groups)
      } catch (err) {
        errors.push(`Carpeta "${folder}": ${String(err)}`)
      }
    }

    // Scan series using folder-based detection
    const seriesGroups: ParsedSeriesGroup[] = []
    for (const folder of seriesFolders) {
      if (!folder.trim()) continue
      try {
        const groups = await scanMultipleSeriesFolders([folder])
        seriesGroups.push(...groups)
      } catch (err) {
        errors.push(`Carpeta series "${folder}": ${String(err)}`)
      }
    }

    const totalSeriesEpisodes = seriesGroups.reduce((sum, g) => sum + g.episodes.length, 0)
    found = movieGroups.length + totalSeriesEpisodes

    scanStatus = {
      ...scanStatus!, total: found, found,
      message: `Encontrados: ${movieGroups.length} películas, ${seriesGroups.length} series (${totalSeriesEpisodes} episodios)`,
    }

    if (found === 0) {
      scanStatus = {
        phase: 'done', current: 0, total: 0, title: '',
        message: 'No se encontraron videos. Verifica las rutas.',
        found: 0, matched: 0, failed: 0, errors, rateLimited: false,
      }
      return
    }

    const totalItems = movieGroups.length + seriesGroups.length
    let processed = 0

    // ── Process movies ──
    scanStatus = { ...scanStatus!, phase: 'fetching', message: 'Buscando datos de películas...' }

    for (const group of movieGroups) {
      if (isRateLimited()) {
        errors.push(`Límite de OMDB alcanzado. Se procesaron ${matched} de ${found} archivos.`)
        break
      }

      const searchQuery = `"${group.movieTitle}"${group.year ? ` (${group.year})` : ''}`

      scanStatus = {
        ...scanStatus!, current: processed + 1,
        title: group.movieTitle, message: `Buscando: ${searchQuery}`,
        matched, failed, errors: [...errors], rateLimited: false,
      }

      try {
        const searchResult = await searchMovie(group.movieTitle, group.year || undefined, apiKey)

        if (searchResult.rateLimited) {
          errors.push(`Límite de OMDB alcanzado.`)
          break
        }

        if (searchResult.result) {
          const sr = searchResult.result

          // ── TITLE MATCH CHECK (movies legacy) ──
          if (!titlesMatch(group.movieTitle, sr.Title)) {
            console.log(`[Legacy] "${group.movieTitle}" → OMDB devolvió "${sr.Title}" — NO coinciden, creando con título original`)
            await db.movie.create({
              data: {
                title: group.movieTitle,
                filePath: group.files[0]?.filePath || null,
                year: group.year || 2024,
                type: 'movie', local: true,
              },
            })
            matched++
            continue
          }

          let description = ''
          let rating = 0
          let year = group.year || parseInt(sr.Year) || 2024
          let genre = 'Drama'
          let duration: string | null = null
          let maturity = 'TV-MA'
          let poster = '/posters/default.svg'

          const details = await getMovieDetails(sr.imdbID, apiKey)
          if (details) {
            description = details.Plot && details.Plot !== 'N/A' ? details.Plot : ''
            rating = parseFloat(details.imdbRating) || 0
            year = parseInt(details.Year) || year
            genre = details.Genre && details.Genre !== 'N/A' ? details.Genre : 'Drama'
            duration = details.Runtime && details.Runtime !== 'N/A' ? details.Runtime : null
            maturity = details.Rated && details.Rated !== 'N/A' ? details.Rated : 'TV-MA'
            // FIX: Use details poster (full resolution)
            if (details.Poster && details.Poster !== 'N/A') poster = details.Poster
          }
          // Fallback to search poster
          if (poster === '/posters/default.svg' && sr.Poster && sr.Poster !== 'N/A') {
            poster = sr.Poster
          }

          matched++

          const existing = await db.movie.findFirst({ where: { title: group.movieTitle, type: 'movie' } })
          if (existing) {
            await db.movie.update({
              where: { id: existing.id },
              data: { filePath: group.files[0]?.filePath || existing.filePath, coverImage: poster, backdropImage: poster, imdbId: sr.imdbID, local: true },
            })
          } else {
            await db.movie.create({
              data: {
                title: group.movieTitle, imdbId: sr.imdbID, description, coverImage: poster, backdropImage: poster,
                filePath: group.files[0]?.filePath || null, year, rating, duration, genre,
                type: 'movie', maturity, local: true,
              },
            })
          }
        } else {
          failed++
          const omdbErr = searchResult.error || 'sin respuesta'
          if (failed <= 10) {
            errors.push(`${searchQuery} → ${omdbErr}`)
          }

          const existing = await db.movie.findFirst({ where: { title: group.movieTitle, type: 'movie' } })
          if (!existing) {
            await db.movie.create({
              data: {
                title: group.movieTitle, description: '',
                coverImage: '/posters/default.svg', backdropImage: '/posters/default.svg',
                filePath: group.files[0]?.filePath || null, year: group.year || 2024,
                rating: 0, genre: 'Desconocido', type: 'movie', local: true,
              },
            })
          }
        }
      } catch (err) {
        failed++
        errors.push(`"${group.movieTitle}": ${String(err)}`)
      }

      processed++
      await new Promise(r => setTimeout(r, 200))
    }

    // ── Process series ──
    for (const seriesGroup of seriesGroups) {
      const files = seriesGroup.episodes
      if (isRateLimited()) {
        errors.push(`Límite de OMDB alcanzado. Series restantes sin datos.`)
        break
      }

      scanStatus = {
        ...scanStatus!, current: processed + 1,
        title: seriesGroup.seriesTitle, message: `Buscando serie: ${seriesGroup.seriesTitle}`,
        matched, failed, errors: [...errors],
      }

      try {
        const searchResult = await searchSeries(seriesGroup.seriesTitle, seriesGroup.year || undefined, apiKey)

        if (searchResult.rateLimited) {
          errors.push(`Límite de OMDB alcanzado.`)
          break
        }

        if (searchResult.result) {
          const sr = searchResult.result

          // ── TITLE MATCH CHECK (series legacy) ──
          if (!titlesMatch(seriesGroup.seriesTitle, sr.Title)) {
            console.log(`[Legacy] "${seriesGroup.seriesTitle}" → OMDB devolvió "${sr.Title}" — NO coinciden, creando con título original`)
            const newSeries = await db.movie.create({
              data: {
                title: seriesGroup.seriesTitle,
                year: seriesGroup.year || 2024,
                genre: 'Drama', type: 'series', maturity: 'TV-MA', local: true,
              },
            })
            for (const file of files) {
              const seasonNum = file.season || 1
              const episodeNum = file.episode || 1
              const existingEp = await db.episode.findFirst({
                where: { seriesId: newSeries.id, seasonNumber: seasonNum, episodeNumber: episodeNum },
              })
              if (!existingEp) {
                await db.episode.create({
                  data: {
                    seriesId: newSeries.id, seasonNumber: seasonNum, episodeNumber: episodeNum,
                    title: file.episode ? `Episodio ${file.episode}` : file.title,
                    description: null, filePath: file.filePath,
                  },
                })
              }
            }
            matched++
            continue
          }

          const poster = (sr.Poster && sr.Poster !== 'N/A')
            ? sr.Poster
            : '/posters/default.svg'

          let description = ''
          let rating = 0
          let year = seriesGroup.year || parseInt(sr.Year) || 2024
          let genre = 'Drama'
          let maturity = 'TV-MA'

          const details = await getMovieDetails(sr.imdbID, apiKey)
          if (details) {
            description = details.Plot && details.Plot !== 'N/A' ? details.Plot : ''
            rating = parseFloat(details.imdbRating) || 0
            year = parseInt(details.Year) || year
            genre = details.Genre && details.Genre !== 'N/A' ? details.Genre : 'Drama'
            maturity = details.Rated && details.Rated !== 'N/A' ? details.Rated : 'TV-MA'
          }

          matched++

          let series = await db.movie.findFirst({ where: { title: seriesGroup.seriesTitle, type: 'series' } })
          if (series) {
            series = await db.movie.update({
              where: { id: series.id },
              data: { coverImage: poster, backdropImage: poster, imdbId: sr.imdbID, local: true },
            })
          } else {
            series = await db.movie.create({
              data: {
                title: seriesGroup.seriesTitle, imdbId: sr.imdbID, description, coverImage: poster, backdropImage: poster,
                year, rating, genre, type: 'series', maturity, local: true,
              },
            })
          }

          for (const file of files) {
            const seasonNum = file.season || 1
            const episodeNum = file.episode || 1

            const existingEp = await db.episode.findFirst({
              where: { seriesId: series.id, seasonNumber: seasonNum, episodeNumber: episodeNum },
            })

            if (!existingEp) {
              let epTitle = file.episode ? `Episodio ${file.episode}` : file.title
              let epDesc: string | null = null

              if (!isRateLimited()) {
                try {
                  const omdbEps = await getSeasonEpisodes(sr.imdbID, seasonNum, apiKey)
                  if (omdbEps) {
                    const omdbEp = omdbEps.find(e => parseInt(e.Episode, 10) === episodeNum)
                    if (omdbEp) {
                      epTitle = omdbEp.Title || epTitle
                      epDesc = omdbEp.Plot && omdbEp.Plot !== 'N/A' ? omdbEp.Plot : null
                    }
                  }
                } catch { /* skip */ }
              }

              await db.episode.create({
                data: {
                  seriesId: series.id, seasonNumber: seasonNum, episodeNumber: episodeNum,
                  title: epTitle, description: epDesc, filePath: file.filePath,
                },
              })
            }
          }
        }
      } catch (err) {
        failed++
        errors.push(`Serie "${seriesGroup.seriesTitle}": ${String(err)}`)
      }

      processed++
      await new Promise(r => setTimeout(r, 200))
    }

    const rateLimitedNow = isRateLimited()
    let msg: string
    if (rateLimitedNow) {
      msg = `Límite diario de OMDB alcanzado. ${matched} con datos, ${failed} sin coincidencia. Vuelve mañana.`
    } else if (matched === 0) {
      msg = `${found} archivos encontrados, 0 con datos de OMDB.`
    } else {
      msg = `Listo! ${found} archivos → ${matched} con datos de OMDB, ${failed} sin coincidencia.`
    }

    scanStatus = {
      phase: 'done', current: processed, total: totalItems,
      title: '', message: msg,
      found, matched, failed, errors, rateLimited: rateLimitedNow,
    }
  } catch (error) {
    scanStatus = {
      phase: 'error', current: 0, total: 0, title: '',
      message: `Error: ${String(error)}`,
      found, matched, failed, errors: [...errors, String(error)], rateLimited: false,
    }
  }
}

// ─── PATCH: Reorganize by folder structure ────────────────────────
//   ?type=series  → reorganize series (default)
//   ?type=movies  → reorganize movies
//   ?dryRun=1     → preview only

export async function PATCH(request: Request) {
  try {
    const url = new URL(request.url)
    const type = url.searchParams.get('type') || 'series'
    const dryRun = url.searchParams.get('dryRun') === '1'

    if (type === 'movies') {
      return handleReorganizeMovies(dryRun)
    }
    return handleReorganizeSeries(dryRun)
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

// ─── Reorganize Series ────────────────────────────────────────────

async function handleReorganizeSeries(dryRun: boolean) {
  const allSeries = await db.movie.findMany({
    where: { type: 'series' },
    include: { episodes: true },
  })

  if (allSeries.length === 0) {
    return NextResponse.json({ success: false, message: 'No hay series en la base de datos. Primero importa desde HD.' })
  }

  const config = getConfig()
  const seriesFolders = (config.seriesFolders || []).filter(f => f.trim())

  if (seriesFolders.length === 0) {
    return NextResponse.json({ success: false, message: 'No hay carpetas de series configuradas.' })
  }

  // Collect all episodes
  interface EpData { id: string; seriesId: string; filePath: string }
  const allEps: EpData[] = []
  for (const s of allSeries) {
    for (const ep of s.episodes) {
      if (ep.filePath) {
        allEps.push({ id: ep.id, seriesId: s.id, filePath: ep.filePath })
      }
    }
  }

  if (allEps.length === 0) {
    return NextResponse.json({ success: false, message: 'No hay episodios con ruta de archivo. Primero importa desde HD.' })
  }

  // ── Path normalization ──
  function normalizePath(p: string): string {
    return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  }

  function toSegments(p: string): string[] {
    return p.replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter(Boolean)
  }

  // ── Pre-compute normalized roots (longest first) ──
  const roots = seriesFolders.map(f => {
    const trimmed = f.trim()
    const norm = normalizePath(trimmed)
    const segs = toSegments(trimmed)
    return { original: trimmed, normalized: norm, segmentCount: segs.length }
  }).sort((a, b) => b.normalized.length - a.normalized.length)

  function findRootSegments(filePath: string): { rootOriginal: string; segmentCount: number } | null {
    const normFile = normalizePath(filePath)
    for (const root of roots) {
      if (normFile === root.normalized || normFile.startsWith(root.normalized + '/')) {
        return { rootOriginal: root.original, segmentCount: root.segmentCount }
      }
    }
    return null
  }

  // ── Parse file path → series name, season ──
  const diagnostics: string[] = []
  const unmatchedSamples: string[] = []

  function parsePath(filePath: string): { seriesName: string; season: number; fileName: string; folderPath: string } | null {
    const allSegs = toSegments(filePath)
    const fileName = allSegs.pop()!

    const rootMatch = findRootSegments(filePath)
    if (!rootMatch) {
      if (unmatchedSamples.length < 5) unmatchedSamples.push(filePath)
      return null
    }

    const dirSegments = allSegs.slice(rootMatch.segmentCount)

    if (dirSegments.length === 0) {
      const name = cleanTitle(fileName.replace(/\.[^.]+$/, ''))
      return name ? { seriesName: name, season: 1, fileName, folderPath: allSegs.join('/') } : null
    }

    // Walk backwards, skip season folders
    let season = 1
    let seriesNameEnd = dirSegments.length - 1

    for (let i = dirSegments.length - 1; i >= 0; i--) {
      if (isSeasonFolder(dirSegments[i])) {
        season = extractSeasonFromFolder(dirSegments[i]) || 1
        seriesNameEnd = i - 1
      } else {
        break
      }
    }

    if (seriesNameEnd < 0) seriesNameEnd = 0

    const seriesRaw = dirSegments.slice(0, seriesNameEnd + 1).join(' ')
    const seriesName = cleanSeriesFolderName(seriesRaw)
    const folderPath = allSegs.slice(0, rootMatch.segmentCount + seriesNameEnd + 1).join('/')

    if (!seriesName) return null
    return { seriesName, season, fileName, folderPath }
  }

  // ── Group episodes by parsed series name ──
  interface Group {
    seriesName: string
    year: number | null
    episodes: { epId: string; oldSeriesId: string; fileName: string; season: number }[]
  }

  const groups = new Map<string, Group>()
  let skipped = 0

  for (const ep of allEps) {
    const parsed = parsePath(ep.filePath)
    if (!parsed) { skipped++; continue }

    const key = parsed.seriesName.toLowerCase()
    const existing = groups.get(key)

    if (existing) {
      existing.episodes.push({
        epId: ep.id, oldSeriesId: ep.seriesId,
        fileName: parsed.fileName, season: parsed.season,
      })
    } else {
      const folderName = parsed.folderPath.split('/').pop() || ''
      const year = extractYearFromFolderName(folderName)
      groups.set(key, {
        seriesName: parsed.seriesName, year,
        episodes: [{
          epId: ep.id, oldSeriesId: ep.seriesId,
          fileName: parsed.fileName, season: parsed.season,
        }],
      })
    }
  }

  // ── Assign primary series ──
  const matchLog: string[] = []
  const groupPrimaryId = new Map<string, string>()

  for (const [key, group] of groups) {
    const counts = new Map<string, number>()
    for (const ep of group.episodes) {
      counts.set(ep.oldSeriesId, (counts.get(ep.oldSeriesId) || 0) + 1)
    }
    let bestId = group.episodes[0].oldSeriesId
    let bestCount = 0
    for (const [id, count] of counts) {
      if (count > bestCount) { bestCount = count; bestId = id }
    }
    groupPrimaryId.set(key, bestId)

    const bestSeries = allSeries.find(s => s.id === bestId)
    if (bestSeries && bestSeries.title.toLowerCase() !== key) {
      matchLog.push(`"${bestSeries.title}" → "${group.seriesName}" (${group.episodes.length} eps de ${counts.size} series)`)
    }
  }

  // ── Build diagnostics ──
  diagnostics.push(`Carpetas configuradas: ${seriesFolders.map(f => `"${f.trim()}"`).join(', ')}`)
  diagnostics.push(`Total episodios: ${allEps.length}`)
  diagnostics.push(`Episodios procesados: ${allEps.length - skipped}`)
  if (skipped > 0) {
    diagnostics.push(`Episodios sin coincidencia: ${skipped}`)
    diagnostics.push('Ejemplos de rutas sin match:')
    for (const s of unmatchedSamples) diagnostics.push(`  → ${s}`)
  }
  if (matchLog.length > 0) {
    diagnostics.push('Nombres corregidos:')
    for (const log of matchLog) diagnostics.push(`  ${log}`)
  }
  diagnostics.push(`Series finales: ${groups.size}`)

  if (groups.size === 0) {
    return NextResponse.json({
      success: false,
      message: 'No se pudo determinar la estructura. Verifica las rutas en Configuración.',
      diagnostics,
    })
  }

  if (dryRun) {
    const summary = [...groups.values()].map(g => `${g.seriesName} (${g.episodes.length} eps)`).join('\n')
    return NextResponse.json({
      success: true, dryRun: true,
      message: `VISTA PREVIA - ${groups.size} series, ${allEps.length - skipped} episodios`,
      stats: { totalGroups: groups.size, updatedEps: 0, mergedEps: 0, deletedSeries: 0, skipped },
      summary, diagnostics,
    })
  }

  // ── Sort episodes within each group ──
  for (const group of groups.values()) {
    group.episodes.sort((a, b) => {
      if (a.season !== b.season) return a.season - b.season
      const numA = a.fileName.match(/(\d+)/)
      const numB = b.fileName.match(/(\d+)/)
      if (numA && numB) {
        const diff = parseInt(numA[1], 10) - parseInt(numB[1], 10)
        if (diff !== 0) return diff
      }
      return a.fileName.localeCompare(b.fileName)
    })
  }

  // ── Apply to database ──
  let mergedEps = 0
  let updatedEps = 0

  for (const [key, group] of groups) {
    const primaryId = groupPrimaryId.get(key)!
    const primary = allSeries.find(s => s.id === primaryId)

    if (primary) {
      await db.movie.update({ where: { id: primaryId }, data: { title: group.seriesName } })
    }

    if (group.year && primary && (!primary.year || primary.year === 2024)) {
      await db.movie.update({ where: { id: primaryId }, data: { year: group.year } })
    }

    const seasonCounter = new Map<number, number>()

    for (const ep of group.episodes) {
      const cnt = (seasonCounter.get(ep.season) || 0) + 1
      seasonCounter.set(ep.season, cnt)

      if (ep.oldSeriesId !== primaryId) {
        await db.episode.update({
          where: { id: ep.epId },
          data: { seriesId: primaryId, seasonNumber: ep.season, episodeNumber: cnt, title: `Episodio ${cnt}` },
        })
        mergedEps++
      } else {
        await db.episode.update({
          where: { id: ep.epId },
          data: { seasonNumber: ep.season, episodeNumber: cnt },
        })
      }
      updatedEps++
    }
  }

  // Delete empty series
  const remaining = await db.movie.findMany({ where: { type: 'series' }, include: { episodes: true } })
  let deletedSeries = 0
  for (const s of remaining) {
    if (s.episodes.length === 0) {
      await db.movie.delete({ where: { id: s.id } })
      deletedSeries++
    }
  }

  const summary = [...groups.values()].map(g => {
    const pid = groupPrimaryId.get(g.seriesName.toLowerCase())!
    const p = allSeries.find(s => s.id === pid)
    const omdb = p?.coverImage && !p.coverImage.includes('default') ? ' ✓' : ''
    return `${g.seriesName} (${g.episodes.length} eps)${omdb}`
  }).join(', ')

  const msg = `Reorganizado: ${groups.size} series, ${updatedEps} episodios, ${mergedEps} fusionados, ${deletedSeries} eliminadas.${skipped > 0 ? ` (${skipped} sin ruta)` : ''}`

  return NextResponse.json({
    success: true, message: msg,
    stats: { totalGroups: groups.size, updatedEps, mergedEps, deletedSeries, skipped },
    summary, diagnostics,
  })
}

// ─── Reorganize Movies ────────────────────────────────────────────

async function handleReorganizeMovies(dryRun: boolean) {
  const allMovies = await db.movie.findMany({
    where: { type: 'movie', local: true },
  })

  if (allMovies.length === 0) {
    return NextResponse.json({ success: false, message: 'No hay películas locales en la base de datos. Primero importa desde HD.' })
  }

  const config = getConfig()
  const moviesFolders = (config.moviesFolders || []).filter(f => f.trim())

  if (moviesFolders.length === 0) {
    return NextResponse.json({ success: false, message: 'No hay carpetas de películas configuradas.' })
  }

  // ── Path normalization ──
  function normalizePath(p: string): string {
    return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  }

  function toSegments(p: string): string[] {
    return p.replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter(Boolean)
  }

  // ── Pre-compute normalized roots (longest first) ──
  const roots = moviesFolders.map(f => {
    const trimmed = f.trim()
    const norm = normalizePath(trimmed)
    const segs = toSegments(trimmed)
    return { original: trimmed, normalized: norm, segmentCount: segs.length }
  }).sort((a, b) => b.normalized.length - a.normalized.length)

  function findRootSegments(filePath: string): { rootOriginal: string; segmentCount: number } | null {
    const normFile = normalizePath(filePath)
    for (const root of roots) {
      if (normFile === root.normalized || normFile.startsWith(root.normalized + '/')) {
        return { rootOriginal: root.original, segmentCount: root.segmentCount }
      }
    }
    return null
  }

  // ── Parse file path → movie name ──
  const diagnostics: string[] = []
  const unmatchedSamples: string[] = []

  interface MovieGroup {
    movieName: string
    year: number | null
    movieIds: string[]
  }

  const groups = new Map<string, MovieGroup>()
  let skipped = 0

  for (const movie of allMovies) {
    const filePath = movie.filePath
    if (!filePath) { skipped++; continue }

    const rootMatch = findRootSegments(filePath)
    if (!rootMatch) {
      if (unmatchedSamples.length < 5) unmatchedSamples.push(filePath)
      skipped++
      continue
    }

    const allSegs = toSegments(filePath)
    const fileName = allSegs.pop()!
    const dirSegments = allSegs.slice(rootMatch.segmentCount)

    // The movie name comes from the parent folder name (or filename if flat)
    let movieRaw: string
    if (dirSegments.length > 0) {
      // Use the last non-season folder name
      movieRaw = dirSegments[dirSegments.length - 1]
    } else {
      movieRaw = fileName.replace(/\.[^.]+$/, '')
    }

    const year = extractYearFromFolderName(dirSegments.length > 0 ? dirSegments[dirSegments.length - 1] : fileName)
    const movieName = cleanTitle(movieRaw)

    if (!movieName) { skipped++; continue }

    const key = movieName.toLowerCase()
    const existing = groups.get(key)

    if (existing) {
      if (!existing.movieIds.includes(movie.id)) {
        existing.movieIds.push(movie.id)
      }
    } else {
      groups.set(key, { movieName, year, movieIds: [movie.id] })
    }
  }

  // ── Assign primary movie ──
  const matchLog: string[] = []
  const groupPrimaryId = new Map<string, string>()

  for (const [key, group] of groups) {
    // Pick the one with a real cover if possible
    let bestId = group.movieIds[0]
    for (const id of group.movieIds) {
      const m = allMovies.find(m => m.id === id)
      if (m && m.coverImage && !m.coverImage.includes('default')) {
        bestId = id
        break
      }
    }
    groupPrimaryId.set(key, bestId)

    for (const id of group.movieIds) {
      if (id !== bestId) {
        const m = allMovies.find(m => m.id === id)
        if (m) {
          matchLog.push(`"${m.title}" → "${group.movieName}" (fusionada)`)
        }
      }
    }
  }

  diagnostics.push(`Carpetas configuradas: ${moviesFolders.map(f => `"${f.trim()}"`).join(', ')}`)
  diagnostics.push(`Total películas locales: ${allMovies.length}`)
  diagnostics.push(`Películas procesadas: ${allMovies.length - skipped}`)
  if (skipped > 0) {
    diagnostics.push(`Películas sin coincidencia: ${skipped}`)
    for (const s of unmatchedSamples) diagnostics.push(`  → ${s}`)
  }
  if (matchLog.length > 0) {
    diagnostics.push('Fusiones:')
    for (const log of matchLog) diagnostics.push(`  ${log}`)
  }
  diagnostics.push(`Películas finales: ${groups.size}`)

  if (groups.size === 0) {
    return NextResponse.json({
      success: false,
      message: 'No se pudo determinar la estructura. Verifica las rutas.',
      diagnostics,
    })
  }

  if (dryRun) {
    const summary = [...groups.values()].map(g => `${g.movieName} (${g.movieIds.length} entries)`).join('\n')
    return NextResponse.json({
      success: true, dryRun: true,
      message: `VISTA PREVIA - ${groups.size} películas`,
      stats: { totalGroups: groups.size, mergedMovies: 0, deletedMovies: 0, skipped },
      summary, diagnostics,
    })
  }

  // ── Apply to database ──
  let mergedMovies = 0
  let deletedMovies = 0

  for (const [key, group] of groups) {
    const primaryId = groupPrimaryId.get(key)!
    const primary = allMovies.find(m => m.id === primaryId)

    // Update title
    if (primary) {
      await db.movie.update({ where: { id: primaryId }, data: { title: group.movieName } })
    }

    // Update year
    if (group.year && primary && (!primary.year || primary.year === 2024)) {
      await db.movie.update({ where: { id: primaryId }, data: { year: group.year } })
    }

    // Merge duplicates into primary
    for (const id of group.movieIds) {
      if (id !== primaryId) {
        // Reassign episodes (unlikely for movies but just in case)
        await db.episode.updateMany({
          where: { seriesId: id },
          data: { seriesId: primaryId },
        })
        // Reassign favorites
        await db.favorite.updateMany({
          where: { movieId: id },
          data: { movieId: primaryId },
        })
        // Reassign watch progress
        await db.watchProgress.updateMany({
          where: { movieId: id },
          data: { movieId: primaryId },
        })
        // Delete duplicate
        await db.movie.delete({ where: { id } })
        mergedMovies++
      }
    }
  }

  const summary = [...groups.values()].map(g => {
    const pid = groupPrimaryId.get(g.movieName.toLowerCase())!
    const p = allMovies.find(m => m.id === pid)
    const omdb = p?.coverImage && !p.coverImage.includes('default') ? ' ✓' : ''
    return `${g.movieName}${omdb}`
  }).join(', ')

  const msg = `Reorganizado: ${groups.size} películas, ${mergedMovies} fusionadas.${skipped > 0 ? ` (${skipped} sin ruta)` : ''}`

  return NextResponse.json({
    success: true, message: msg,
    stats: { totalGroups: groups.size, mergedMovies, deletedMovies, skipped },
    summary, diagnostics,
  })
}

// ─── DELETE: Clean database ───────────────────────────────────────

export async function DELETE() {
  try {
    const deletedEps = await db.episode.deleteMany({})
    const deletedFavs = await db.favorite.deleteMany({})
    const deletedProgress = await db.watchProgress.deleteMany({})
    const deletedMovies = await db.movie.deleteMany({})
    return NextResponse.json({
      success: true,
      message: `Eliminados: ${deletedMovies.count} títulos, ${deletedEps.count} episodios`,
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}