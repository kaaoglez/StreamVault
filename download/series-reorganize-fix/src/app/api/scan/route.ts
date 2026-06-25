import { NextResponse } from 'next/server'
import { scanMultipleFolders, scanMultipleSeriesFolders, type ParsedVideo, type ParsedSeriesGroup, isSeasonFolder, extractSeasonFromFolder, extractYearFromFolderName, cleanSeriesFolderName } from '@/lib/scanner'
import { searchMovie, searchSeries, getMovieDetails, getSeasonEpisodes, isRateLimited, resetRateLimit } from '@/lib/omdb'
import { getConfig } from '@/lib/config'
import { db } from '@/lib/db'

interface ScanProgress {
  phase: 'scanning' | 'fetching' | 'done' | 'error'
  current: number
  total: number
  title: string
  message: string
  found: number
  matched: number
  failed: number
  errors: string[]
  rateLimited: boolean
  debugSample?: string[]
}

let scanStatus: ScanProgress | null = null

export async function GET(request: Request) {
  const url = new URL(request.url)

  // Debug preview: ?action=preview shows configured roots vs actual file paths
  if (url.searchParams.get('action') === 'preview') {
    try {
      const config = getConfig()
      const seriesFolders = (config.seriesFolders || []).filter(f => f.trim())

      function normalizePath(p: string): string {
        return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
      }

      const rootEntries = seriesFolders.map(f => {
        const trimmed = f.trim()
        return {
          original: trimmed,
          normalized: normalizePath(trimmed),
          segmentCount: trimmed.replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter(Boolean).length,
        }
      })

      const allSeries = await db.movie.findMany({
        where: { type: 'series' },
        include: { episodes: true },
      })
      const episodes: { filePath: string; id: string; seriesId: string }[] = []
      for (const s of allSeries) {
        for (const ep of s.episodes) {
          if (ep.filePath) episodes.push({ filePath: ep.filePath, id: ep.id, seriesId: s.id })
        }
      }

      // Show first 10 files with match analysis
      const analyzed = episodes.slice(0, 10).map(e => {
        const normFile = normalizePath(e.filePath)
        let matched: string | null = null
        for (const root of rootEntries) {
          if (normFile.startsWith(root.normalized + '/')) {
            matched = root.original
            break
          }
        }
        return {
          filePath: e.filePath,
          normalized: normFile,
          rootMatched: matched,
        }
      })

      return NextResponse.json({
        configuredRoots: rootEntries.map(r => ({ original: r.original, normalized: r.normalized, segmentCount: r.segmentCount })),
        totalEpisodes: episodes.length,
        totalSeries: allSeries.length,
        sampleFiles: analyzed,
      })
    } catch (error) {
      return NextResponse.json({ error: String(error) }, { status: 500 })
    }
  }

  return NextResponse.json({
    scanning: scanStatus !== null && scanStatus.phase !== 'done' && scanStatus.phase !== 'error',
    progress: scanStatus,
  })
}

export async function POST(request: Request) {
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

    // Reset rate limit at start of new scan so user can retry
    resetRateLimit()

    runScan(config.omdbApiKey, config.moviesFolders, config.seriesFolders).catch((err) => {
      console.error('Scan failed:', err)
    })

    return NextResponse.json({ success: true, message: 'Escaneo iniciado' })
  } catch (error) {
    scanStatus = null
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    // Support ?dryRun=1 to preview without making changes
    const url = new URL(request.url)
    const dryRun = url.searchParams.get('dryRun') === '1'

    const allSeries = await db.movie.findMany({
      where: { type: 'series' },
      include: { episodes: true },
    })

    if (allSeries.length === 0) {
      return NextResponse.json({ success: false, message: 'No hay series en la base de datos' })
    }

    const config = getConfig()
    const seriesFolders = (config.seriesFolders || []).filter(f => f.trim())

    if (seriesFolders.length === 0) {
      return NextResponse.json({ success: false, message: 'No hay carpetas de series configuradas. Ve a Configuración y agrega la carpeta raíz de tus series.' })
    }

    // Collect all episodes
    interface EpData {
      id: string
      seriesId: string
      filePath: string
    }
    const allEps: EpData[] = []
    for (const s of allSeries) {
      for (const ep of s.episodes) {
        if (ep.filePath) {
          allEps.push({ id: ep.id, seriesId: s.id, filePath: ep.filePath })
        }
      }
    }

    if (allEps.length === 0) {
      return NextResponse.json({ success: false, message: 'No hay episodios con ruta de archivo' })
    }

    // ── Path normalization: convert to forward-slash, strip trailing slash, lowercase ──
    function normalizePath(p: string): string {
      return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    }

    // ── Split path into segments preserving original case ──
    function toSegments(p: string): string[] {
      return p.replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter(Boolean)
    }

    // ── Pre-compute normalized roots (sorted longest first for greedy matching) ──
    const roots = seriesFolders.map(f => {
      const trimmed = f.trim()
      const norm = normalizePath(trimmed)
      const segs = toSegments(trimmed)
      return { original: trimmed, normalized: norm, segmentCount: segs.length }
    }).sort((a, b) => b.normalized.length - a.normalized.length) // longest first

    // ── Match a file path to a configured root, return segment count of the root ──
    function findRootSegments(filePath: string): { rootOriginal: string; segmentCount: number } | null {
      const normFile = normalizePath(filePath)
      for (const root of roots) {
        // Must match as a path prefix: root + "/" must be a prefix of the file path
        if (normFile === root.normalized || normFile.startsWith(root.normalized + '/')) {
          return { rootOriginal: root.original, segmentCount: root.segmentCount }
        }
      }
      return null
    }

    // ── Parse a file path → series name, season, etc. ──
    const diagnostics: string[] = []
    const unmatchedSamples: string[] = []

    function parsePath(filePath: string): { seriesName: string; season: number; fileName: string; folderPath: string } | null {
      const allSegs = toSegments(filePath)
      const fileName = allSegs.pop()!

      // Match against configured root
      const rootMatch = findRootSegments(filePath)
      if (!rootMatch) {
        // No configured root matches this file path
        if (unmatchedSamples.length < 5) {
          unmatchedSamples.push(filePath)
        }
        return null
      }

      // Everything after the root = the series/season/file structure
      const dirSegments = allSegs.slice(rootMatch.segmentCount)

      if (dirSegments.length === 0) {
        // File is directly in the root folder — derive name from filename
        const name = cleanSeriesFolderName(fileName.replace(/\.[^.]+$/, ''))
        return name ? { seriesName: name, season: 1, fileName, folderPath: allSegs.join('/') } : null
      }

      // Walk backwards from file's parent dirs, skip season folders
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

      // Everything from start up to (and including) the series name folder = the series
      const seriesRaw = dirSegments.slice(0, seriesNameEnd + 1).join(' ')
      // Use aggressive folder name cleaner (removes Season 1, S01, COMPLETE, etc.)
      const seriesName = cleanSeriesFolderName(seriesRaw)
      const folderPath = allSegs.slice(0, rootMatch.segmentCount + seriesNameEnd + 1).join('/')

      if (!seriesName) return null

      return { seriesName, season, fileName, folderPath }
    }

    // ── Group episodes by parsed series name ──
    // Strategy: folder structure is the source of truth.
    // We do NOT match against DB titles (they may be corrupted from previous reorganize attempts).
    // Instead, we pick the primary series by counting which old series has the most episodes.
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

    // ── Assign primary series: the old series with MOST episodes wins (preserves OMDB data) ──
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
      diagnostics.push(`Ejemplos de rutas sin match:`)
      for (const s of unmatchedSamples) {
        diagnostics.push(`  → ${s}`)
      }
      diagnostics.push('Verifica que la carpeta de series en Configuración coincida con la ruta real de los archivos.')
    }
    if (matchLog.length > 0) {
      diagnostics.push(`Nombres corregidos por match con DB:`)
      for (const log of matchLog) {
        diagnostics.push(`  ${log}`)
      }
    }
    diagnostics.push(`Series finales: ${groups.size}`)

    if (groups.size === 0) {
      return NextResponse.json({
        success: false,
        message: 'No se pudo determinar la estructura de carpetas. Ninguna ruta de archivo coincide con las carpetas configuradas.',
        diagnostics,
      })
    }

    if (dryRun) {
      const summary = [...groups.values()].map(g =>
        `${g.seriesName} (${g.episodes.length} eps)`
      ).join('\n')
      return NextResponse.json({
        success: true, dryRun: true,
        message: `MODO VISTA PREVIA - Sin cambios realizados\n${groups.size} series detectadas, ${allEps.length - skipped} episodios procesados`,
        stats: { totalGroups: groups.size, updatedEps: 0, mergedEps: 0, deletedSeries: 0, skipped },
        summary,
        diagnostics,
      })
    }

    // ── Sort episodes within each group: by season, then natural sort by filename ──
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

    // Update series titles and reassign episodes
    for (const [key, group] of groups) {
      const primaryId = groupPrimaryId.get(key)!
      const primary = allSeries.find(s => s.id === primaryId)

      // Always update title to the CLEAN folder name
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

    const msg = `Reorganizado: ${groups.size} series, ${updatedEps} episodios actualizados, ${mergedEps} fusionados, ${deletedSeries} eliminadas.${skipped > 0 ? ` (${skipped} sin coincidencia de ruta)` : ''}`

    return NextResponse.json({
      success: true, message: msg,
      stats: { totalGroups: groups.size, updatedEps, mergedEps, deletedSeries, skipped },
      summary,
      diagnostics,
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

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

async function runScan(apiKey: string, moviesFolders: string[], seriesFolders: string[]) {
  const errors: string[] = []
  let found = 0
  let matched = 0
  let failed = 0
  const debugSample: string[] = [] // First 5 search queries for debugging

  try {
    scanStatus = {
      phase: 'scanning', current: 0, total: 0, title: '', message: 'Escaneando carpetas...',
      found: 0, matched: 0, failed: 0, errors: [], rateLimited: false,
    }

    // Scan movies folders
    const movieFiles: ParsedVideo[] = []
    for (const folder of moviesFolders) {
      if (!folder.trim()) continue
      try {
        const videos = await scanMultipleFolders([folder])
        for (const v of videos) movieFiles.push({ ...v, isSeries: false })
      } catch (err) {
        const msg = `Carpeta "${folder}": ${String(err)}`
        errors.push(msg)
      }
    }

    // Scan series folders using folder-based detection
    const seriesGroups: ParsedSeriesGroup[] = []
    for (const folder of seriesFolders) {
      if (!folder.trim()) continue
      try {
        const groups = await scanMultipleSeriesFolders([folder])
        seriesGroups.push(...groups)
      } catch (err) {
        const msg = `Carpeta series "${folder}": ${String(err)}`
        errors.push(msg)
      }
    }

    // Count total series episodes
    const totalSeriesEpisodes = seriesGroups.reduce((sum, g) => sum + g.episodes.length, 0)
    found = movieFiles.length + totalSeriesEpisodes

    scanStatus = {
      ...scanStatus!, total: found, found,
      message: `Encontrados: ${movieFiles.length} películas, ${seriesGroups.length} series (${totalSeriesEpisodes} episodios)`,
    }

    if (found === 0) {
      scanStatus = {
        phase: 'done', current: 0, total: 0, title: '',
        message: 'No se encontraron videos. Verifica las rutas.',
        found: 0, matched: 0, failed: 0, errors, rateLimited: false,
      }
      return
    }

    const totalItems = movieFiles.length + seriesGroups.length
    let processed = 0

    // ── Process movies ──
    scanStatus = { ...scanStatus!, phase: 'fetching', message: 'Buscando datos de películas...' }

    for (const video of movieFiles) {
      // Check rate limit BEFORE making request
      if (isRateLimited()) {
        errors.push(`Límite de OMDB alcanzado. Se procesaron ${matched} de ${found} archivos.`)
        break
      }

      const searchQuery = `"${video.title}"${video.year ? ` (${video.year})` : ''}`

      // Collect first 5 queries for debugging
      if (debugSample.length < 5) {
        debugSample.push(searchQuery)
      }

      scanStatus = {
        ...scanStatus!, current: processed + 1,
        title: video.title, message: `Buscando: ${searchQuery}`,
        matched, failed, errors: [...errors], rateLimited: false,
      }

      try {
        const searchResult = await searchMovie(video.title, video.year, apiKey)

        if (searchResult.rateLimited) {
          errors.push(`Límite de OMDB alcanzado. Se procesaron ${matched} de ${found} archivos.`)
          break
        }

        if (searchResult.result) {
          const sr = searchResult.result
          // Use poster from search result (saves 1 API call!)
          const poster = (sr.Poster && sr.Poster !== 'N/A')
            ? sr.Poster
            : '/posters/default.svg'

          // Only fetch details for description/rating (1 extra call)
          let description = ''
          let rating = 0
          let year = video.year || parseInt(sr.Year) || 2024
          let genre = 'Drama'
          let duration: string | null = null
          let maturity = 'TV-MA'

          const details = await getMovieDetails(sr.imdbID, apiKey)
          if (details) {
            description = details.Plot && details.Plot !== 'N/A' ? details.Plot : ''
            rating = parseFloat(details.imdbRating) || 0
            year = parseInt(details.Year) || year
            genre = details.Genre && details.Genre !== 'N/A' ? details.Genre : 'Drama'
            duration = details.Runtime && details.Runtime !== 'N/A' ? details.Runtime : null
            maturity = details.Rated && details.Rated !== 'N/A' ? details.Rated : 'TV-MA'
          }

          matched++

          const existing = await db.movie.findFirst({ where: { title: sr.Title } })
          if (existing) {
            await db.movie.update({
              where: { id: existing.id },
              data: { filePath: video.filePath, coverImage: poster, backdropImage: poster, local: true },
            })
          } else {
            await db.movie.create({
              data: {
                title: sr.Title, description, coverImage: poster, backdropImage: poster,
                filePath: video.filePath, year, rating, duration, genre,
                type: 'movie', maturity, local: true,
              },
            })
          }
        } else {
          failed++
          // Log the actual OMDB error for first 10 failures
          const omdbErr = searchResult.error || 'sin respuesta'
          if (failed <= 10) {
            errors.push(`${searchQuery} → ${omdbErr}`)
          }

          const existing = await db.movie.findFirst({ where: { title: video.title } })
          if (!existing) {
            await db.movie.create({
              data: {
                title: video.title, description: '',
                coverImage: '/posters/default.svg', backdropImage: '/posters/default.svg',
                filePath: video.filePath, year: video.year || 2024,
                rating: 0, genre: 'Desconocido', type: 'movie', local: true,
              },
            })
          }
        }
      } catch (err) {
        failed++
        errors.push(`"${video.title}": ${String(err)}`)
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
        const searchResult = await searchSeries(seriesGroup.seriesTitle, seriesGroup.year, apiKey)

        if (searchResult.rateLimited) {
          errors.push(`Límite de OMDB alcanzado. Series restantes sin datos.`)
          break
        }

        if (searchResult.result) {
          const sr = searchResult.result
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

          let series = await db.movie.findFirst({ where: { title: sr.Title, type: 'series' } })
          if (series) {
            series = await db.movie.update({
              where: { id: series.id },
              data: { coverImage: poster, backdropImage: poster, local: true },
            })
          } else {
            series = await db.movie.create({
              data: {
                title: sr.Title, description, coverImage: poster, backdropImage: poster,
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
                } catch { /* skip episode details */ }
              }

              await db.episode.create({
                data: {
                  seriesId: series.id, seasonNumber: seasonNum, episodeNumber: episodeNum,
                  title: epTitle, description: epDesc, filePath: file.filePath,
                },
              })
            }
          }
        } else {
          failed++
          const omdbErr = searchResult.error || 'sin respuesta'
          if (failed <= 10) {
            errors.push(`Serie "${seriesGroup.seriesTitle}" → ${omdbErr}`)
          }

          const existingSeries = await db.movie.findFirst({ where: { title: seriesGroup.seriesTitle, type: 'series' } })
          if (!existingSeries) {
            const series = await db.movie.create({
              data: {
                title: seriesGroup.seriesTitle, description: '',
                coverImage: '/posters/default.svg', backdropImage: '/posters/default.svg',
                year: seriesGroup.year || 2024, rating: 0, genre: 'Desconocido',
                type: 'series', local: true,
              },
            })
            for (const file of files) {
              await db.episode.create({
                data: {
                  seriesId: series.id, seasonNumber: file.season || 1,
                  episodeNumber: file.episode || 1, title: `Episodio ${file.episode || 1}`,
                  filePath: file.filePath,
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

    // Final message
    const rateLimitedNow = isRateLimited()
    let msg: string
    if (rateLimitedNow) {
      msg = `Límite diario de OMDB alcanzado. ${matched} con datos, ${failed} sin coincidencia. Vuelve a escanear mañana para completar.`
    } else if (matched === 0) {
      msg = `${found} archivos encontrados, 0 con datos de OMDB. Revisa los errores abajo para ver qué envió el escáner.`
    } else {
      msg = `Listo! ${found} archivos → ${matched} con datos de OMDB, ${failed} sin coincidencia.`
    }

    scanStatus = {
      phase: 'done', current: processed, total: totalItems,
      title: '', message: msg,
      found, matched, failed, errors, rateLimited: rateLimitedNow,
      debugSample,
    }

  } catch (error) {
    scanStatus = {
      phase: 'error', current: 0, total: 0, title: '',
      message: `Error: ${String(error)}`,
      found, matched, failed, errors: [...errors, String(error)], rateLimited: false,
    }
  }
}