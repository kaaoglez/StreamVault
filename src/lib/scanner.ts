import fs from 'fs'
import path from 'path'

// ─── Video file extensions ──────────────────────────────────────

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg'
])

// ─── Parsed video file info ─────────────────────────────────────

export interface ParsedVideo {
  filePath: string
  fileName: string
  title: string
  year: number | null
  season: number | null
  episode: number | null
  isSeries: boolean
}

// ─── Filename parsing patterns ──────────────────────────────────

const YEAR_PATTERN = /[\.\s\-\_](\d{4})(?:[\.\s\-\_]|$)/
const YEAR_RANGE = { min: 1920, max: 2030 }

const SEASON_EP_PATTERN = /[Ss](\d{1,2})[Ee](\d{1,2})/
const SEASON_EP_ALT = /(^|[\.\s\-_])(\d{1,2})[xX](\d{1,2})([\.\s\-_]|$)/  // "1x01", "2x03"
const SEASON_ONLY = /[Ss](\d{1,2})(?:[\.\s\-\_]|$)/
const EP_ONLY = /[Ee](\d{1,2})(?:[\.\s\-\_]|$)/

// ─── Junk patterns ──────────────────────────────────────────────

const RESOLUTIONS = /\d{3,4}[pPiI]/g
const CODECS_VIDEO = /\b(x|h|H)\d{3,4}\b/g
const CODECS_AUDIO = /\b(aac|ac3|dts|flac|dd|atmos|truehd)\b/gi
const SOURCES = /\b(bluray|brrip|bdrip|webrip|web-dl|webdl|hdtv|hdrip|dvdrip|dvdscr|camrip|cam|ts|tc|scr|ppv|ppvrip|hdts|workprint)\b/gi
const TAGS = /\b(proper|repack|extended|unrated|directors?\s*cut|remastered|final|intern|subbed|sub|dubbed|dual|audio|latino|castellano|spanish|english|multi|español|ingles)\b/gi
const JUNK_WORDS = /\b(lat|spa|eng|sub|subs)\b/gi
const RELEASE_GROUPS = /\b(AMZN|NF|DSNP|HMAX|ATVP|STAN|iT)\b/gi
const RELEASE_TAGS = /\b(DDP5[\.\s]*1|DDP[\.\s]*5[\.\s]*1|NTG|BONE|RARBG|YTS|YIFY|SPARKS|FGT|QOQ|RARBG|x264|x265|HEVC|HDR|DV|SDR|BluRay|WEB-DL|WEBRip|HDTV|AAC|AC3|DTS|FLAC|REMUX|PROPER|REPACK)\b/gi

export function cleanTitle(raw: string): string {
  let title = raw
  title = title.replace(/[\[\(].*?[\]\)]/g, '')
  title = title.replace(/[Ss]\d{1,2}[Ee]\d{1,2}/g, '')
  title = title.replace(RESOLUTIONS, '')
  title = title.replace(CODECS_VIDEO, '')
  title = title.replace(/\bHEVC\b/gi, '')
  title = title.replace(/\bx265\b/gi, '')
  title = title.replace(/\bAVC\b/gi, '')
  title = title.replace(/\bMPEG\b/gi, '')
  title = title.replace(CODECS_AUDIO, '')
  title = title.replace(SOURCES, '')
  title = title.replace(TAGS, '')
  title = title.replace(JUNK_WORDS, '')
  title = title.replace(RELEASE_GROUPS, '')
  title = title.replace(RELEASE_TAGS, '')
  title = title.replace(/\b\d+\.?\d*\s*[GgMm][Bb]\b/g, '')
  title = title.replace(/\b\d+bit\b/gi, '')
  title = title.replace(/[.\-_]/g, ' ')
  title = title.replace(/\s+/g, ' ')
  return title.trim()
}

export function parseVideoFile(filePath: string): ParsedVideo {
  const ext = path.extname(filePath).toLowerCase()
  const fileName = path.basename(filePath, ext)
  const rawName = fileName

  const seMatch = rawName.match(SEASON_EP_PATTERN)
  const altMatch = rawName.match(SEASON_EP_ALT)
  const sMatch = rawName.match(SEASON_ONLY)
  const eMatch = rawName.match(EP_ONLY)

  let isSeries = false
  let season: number | null = null
  let episode: number | null = null
  let titlePart = rawName

  if (seMatch) {
    isSeries = true; season = parseInt(seMatch[1], 10); episode = parseInt(seMatch[2], 10)
    titlePart = rawName.substring(0, seMatch.index!)
  } else if (altMatch) {
    // "1x01", "2x03" format
    isSeries = true; season = parseInt(altMatch[2], 10); episode = parseInt(altMatch[3], 10)
    titlePart = rawName.substring(0, altMatch.index!)
  } else if (sMatch) {
    isSeries = true; season = parseInt(sMatch[1], 10)
    titlePart = rawName.substring(0, sMatch.index!)
  } else if (eMatch) {
    isSeries = true; episode = parseInt(eMatch[1], 10)
    titlePart = rawName.substring(0, eMatch.index!)
  }

  const yearMatch = titlePart.match(YEAR_PATTERN)
  let year: number | null = null
  if (yearMatch) {
    const yr = parseInt(yearMatch[1], 10)
    if (yr >= YEAR_RANGE.min && yr <= YEAR_RANGE.max) { year = yr; titlePart = titlePart.substring(0, yearMatch.index!) }
  }

  return { filePath, fileName: rawName, title: cleanTitle(titlePart), year, season, episode, isSeries }
}

// ─── Season folder detection ────────────────────────────────────
// Supports: "Season 1", "S1", "S01", "Temporada 1", "T1", "1", "2",
// "Season 1 - Complete", "Disc 1", "Disco 1", "DVD 1", etc.

const SEASON_FOLDER_PATTERNS: RegExp[] = [
  /^(?:season|temporada|s)\s*(\d{1,2})$/i,
  /^(?:season|temporada|s)\s*(\d{1,2})\s*[-–]\s*\d{1,2}$/i,
  /^(?:season|temporada|s)\s*(\d{1,2})\s*[-–].+$/i,
  /^t\s*(\d{1,2})$/i,
  /^t\s*(\d{1,2})\s*[-–]/i,
  /^(?:disc|disco|dvd|cd)\s*(\d{1,2})$/i,
  /^(?:disc|disco|dvd|cd)\s*(\d{1,2})\s*[-–]/i,
  /^(\d{1,2})$/,                          // bare "1", "2", etc.
  /^(\d{1,2})\s*[-–]/,                    // "1 - Complete", "2 - Extras"
]

export function isSeasonFolder(folderName: string): boolean {
  return SEASON_FOLDER_PATTERNS.some(p => p.test(folderName))
}

export function extractSeasonFromFolder(folderName: string): number | null {
  for (const pattern of SEASON_FOLDER_PATTERNS) {
    const match = folderName.match(pattern)
    if (match) return parseInt(match[1], 10)
  }
  return null
}

// Heuristic: if 2+ sub-folders are bare numbers, treat them as seasons
export function looksLikeSeasonSet(folderNames: string[]): boolean {
  if (folderNames.length < 2) return false
  const seasonLike = folderNames.filter(n =>
    /^\d{1,2}$/.test(n) || isSeasonFolder(n)
  )
  return seasonLike.length >= 2 && seasonLike.length >= folderNames.length * 0.7
}

// ─── Helpers ────────────────────────────────────────────────────

function getSortedVideoFiles(dir: string): string[] {
  const files: string[] = []
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (VIDEO_EXTENSIONS.has(ext)) files.push(path.join(dir, entry.name))
      }
    }
  } catch { /* skip */ }
  files.sort((a, b) => {
    const nA = path.basename(a).toLowerCase().match(/(\d+)/)
    const nB = path.basename(b).toLowerCase().match(/(\d+)/)
    if (nA && nB) { const d = parseInt(nA[1], 10) - parseInt(nB[1], 10); if (d !== 0) return d }
    return path.basename(a).toLowerCase().localeCompare(path.basename(b).toLowerCase())
  })
  return files
}

export function extractYearFromFolderName(folderName: string): number | null {
  const match = folderName.match(/[\.\s\-\_\(\[](\d{4})[\.\s\-\_\)\]]/)
  if (match) { const yr = parseInt(match[1], 10); if (yr >= 1920 && yr <= 2030) return yr }
  return null
}

function listSubdirs(dirPath: string): string[] {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && !['__MACOSX', 'System Volume Information'].includes(e.name))
      .map(e => e.name)
  } catch { return [] }
}

// ─── Clean folder name for series ───────────────────────────────

export function cleanSeriesFolderName(raw: string): string {
  let name = raw
  // Remove brackets content
  name = name.replace(/[\[\(].*?[\]\)]/g, '')
  // Remove season/temporada patterns
  name = name.replace(/(?:season|temporada)\s*\d{1,2}(?:\s*[-–]\s*\d{1,2})?/gi, '')
  // Remove "S01", "S02" etc. at word boundary or start
  name = name.replace(/\b[Ss]\d{1,2}\b/g, '')
  // Remove " & Extras", " + Extras"
  name = name.replace(/&\s*Extras/gi, '')
  name = name.replace(/\+\s*Extras/gi, '')
  // Remove COMPLETE/COMPLETA
  name = name.replace(/\bCOMPLETE\b/gi, '')
  name = name.replace(/\bCOMPLETA\b/gi, '')
  // Remove year
  name = name.replace(/[\s]*[\(\[]?\d{4}[\)\]]?/g, '')
  // Remove "to" ranges like "1 to 8"
  name = name.replace(/\b\d+\s*to\s*\d+/gi, '')
  // Remove release tags
  name = name.replace(RELEASE_GROUPS, '')
  name = name.replace(RELEASE_TAGS, '')
  // Remove "p RARBG" style junk
  name = name.replace(/\b\w\s+[A-Z]{2,5}$/g, '')
  // Clean with standard title cleaner
  name = cleanTitle(name)
  return name.trim()
}

// ─── Series scanner types ───────────────────────────────────────

export interface ParsedSeriesGroup {
  seriesTitle: string
  year: number | null
  episodes: ParsedVideo[]
}

export interface ScanDiagnostics {
  folderScanned: string
  autoCorrected: boolean
  originalFolder?: string
  subdirsFound: string[]
  subdirsProcessed: string[]
  seriesFound: string[]
  totalEpisodes: number
}

// ─── Process episodes from a series folder ──────────────────────
// Shared logic between scanSeriesByFolder and scanSeriesWithDiagnostics

function processSeriesEpisodes(seriesPath: string, seriesTitle: string, year: number | null): ParsedVideo[] {
  const episodes: ParsedVideo[] = []
  const subEntries = listSubdirs(seriesPath)
  let seasonFolders = subEntries.filter(n => isSeasonFolder(n))

  // Heuristic: if no season folders detected but subs look like a season set
  if (seasonFolders.length === 0 && subEntries.length >= 2 && looksLikeSeasonSet(subEntries)) {
    seasonFolders = [...subEntries]
    console.log('[Scanner]   Heuristica: carpetas numericas tratadas como temporadas: [' + subEntries.join(', ') + ']')
  }

  // NEW: If 2+ subfolders each contain video files but none match season patterns,
  // treat ALL subfolders as seasons (numbered by sort order)
  if (seasonFolders.length === 0 && subEntries.length >= 2) {
    const subsWithVideos = subEntries.filter(n => getSortedVideoFiles(path.join(seriesPath, n)).length > 0)
    if (subsWithVideos.length >= 2) {
      seasonFolders = [...subsWithVideos]
      console.log('[Scanner]   Heuristica fuerte: ' + subsWithVideos.length + ' subcarpetas con videos tratadas como temporadas: [' + subsWithVideos.join(', ') + ']')
    }
  }

  if (seasonFolders.length > 0) {
    // ── Has season folders (detected or heuristic) ──
    for (let i = 0; i < seasonFolders.length; i++) {
      const seasonName = seasonFolders[i]
      const detectedNum = extractSeasonFromFolder(seasonName)
      // Use detected number if available, otherwise use position order (1-based)
      const seasonNum = detectedNum || (i + 1)
      const seasonPath = path.join(seriesPath, seasonName)
      const videos = getSortedVideoFiles(seasonPath)
      console.log('[Scanner]   T' + seasonNum + ' ("' + seasonName + '"): ' + videos.length + ' videos')
      videos.forEach((file, index) => {
        episodes.push({
          filePath: file, fileName: path.basename(file),
          title: seriesTitle, year, season: seasonNum, episode: index + 1, isSeries: true,
        })
      })
    }
    // Videos directly in series folder → season 0 (specials/extras)
    const directVideos = getSortedVideoFiles(seriesPath)
    if (directVideos.length > 0) {
      directVideos.forEach((file, index) => {
        episodes.push({
          filePath: file, fileName: path.basename(file),
          title: seriesTitle, year, season: 0, episode: index + 1, isSeries: true,
        })
      })
      console.log('[Scanner]   Especiales en raiz: ' + directVideos.length + ' videos')
    }
  } else {
    // ── No season folders detected ──
    const videoFiles = getSortedVideoFiles(seriesPath)
    if (videoFiles.length > 0) {
      // Videos directly in series folder — try to get season/ep from filenames
      const hasFilenameInfo = videoFiles.some(f => {
        const parsed = parseVideoFile(f)
        return parsed.season !== null || parsed.episode !== null
      })

      if (hasFilenameInfo) {
        // Filenames contain season/episode info (S01E01, 1x01, etc.)
        for (const file of videoFiles) {
          const parsed = parseVideoFile(file)
          episodes.push({
            filePath: file, fileName: path.basename(file),
            title: seriesTitle, year,
            season: parsed.season || 1,
            episode: parsed.episode || 1,
            isSeries: true,
          })
        }
      } else {
        // No filename info — number sequentially as season 1
        console.log('[Scanner]   Sin info de temporada en nombres, numerando secuencialmente como T1')
        videoFiles.forEach((file, index) => {
          episodes.push({
            filePath: file, fileName: path.basename(file),
            title: seriesTitle, year, season: 1, episode: index + 1, isSeries: true,
          })
        })
      }
    } else if (subEntries.length > 0) {
      // Sub-folders exist but none look like seasons — try video filenames for season info
      const seasonEpMap = new Map<number, ParsedVideo[]>()
      for (const subName of subEntries) {
        const subPath = path.join(seriesPath, subName)
        const subVideos = getSortedVideoFiles(subPath)
        for (const file of subVideos) {
          const parsed = parseVideoFile(file)
          const sn = parsed.season || extractSeasonFromFolder(subName) || 1
          if (!seasonEpMap.has(sn)) seasonEpMap.set(sn, [])
          seasonEpMap.get(sn)!.push({ ...parsed, title: seriesTitle, isSeries: true })
        }
      }
      // Assign episode numbers per season
      for (const [seasonNum, eps] of seasonEpMap) {
        eps.forEach((ep, idx) => {
          ep.episode = ep.episode || (idx + 1)
          ep.season = seasonNum
          episodes.push(ep)
        })
      }
    }
  }

  return episodes
}

// ─── CORE: Scan a single series folder ──────────────────────────
// Auto-detects if the folder is one level too deep and corrects.

export function scanSeriesByFolder(folderPath: string): ParsedSeriesGroup[] {
  const absolutePath = path.resolve(folderPath)
  console.log('[Scanner] scanSeriesByFolder: "' + absolutePath + '"')

  if (!fs.existsSync(absolutePath)) {
    throw new Error('Carpeta no encontrada: ' + absolutePath)
  }

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(absolutePath, { withFileTypes: true })
  } catch (err) {
    throw new Error('No se puede leer ' + absolutePath + ': ' + String(err))
  }

  const dirEntries = entries.filter(e =>
    e.isDirectory() && !e.name.startsWith('.') && !['__MACOSX', 'System Volume Information'].includes(e.name)
  )
  console.log('[Scanner] Subdirectorios (' + dirEntries.length + '): [' + dirEntries.map(e => e.name).join(', ') + ']')

  // ── AUTO-CORRECT: If ALL subdirectories are season folders, we're one level too deep ──
  if (dirEntries.length > 0) {
    const seasonCount = dirEntries.filter(e => isSeasonFolder(e.name)).length
    console.log('[Scanner] Season folders: ' + seasonCount + '/' + dirEntries.length)
    if (seasonCount === dirEntries.length && dirEntries.length >= 2) {
      const parentPath = path.dirname(absolutePath)
      console.log('[Scanner] AUTO-CORRECT: "' + absolutePath + '" -> "' + parentPath + '"')
      return scanSeriesByFolder(parentPath)
    }
  }

  // ── NORMAL SCAN: Each subdirectory is a series ──
  const results: ParsedSeriesGroup[] = []

  for (const entry of dirEntries) {
    if (isSeasonFolder(entry.name)) {
      console.log('[Scanner] SALTANDO (es temporada): "' + entry.name + '"')
      continue
    }

    const seriesPath = path.join(absolutePath, entry.name)
    const year = extractYearFromFolderName(entry.name)
    let seriesTitle = cleanSeriesFolderName(entry.name)

    if (!seriesTitle) {
      let fb = entry.name.replace(/[\[\(].*?[\]\)]/g, '')
      fb = fb.replace(/[\.\s]*\d{4}[\.\s]*/g, ' ')
      fb = fb.replace(/[.\-_]/g, ' ')
      fb = fb.replace(/\s+/g, ' ').trim()
      seriesTitle = fb || entry.name
    }

    console.log('[Scanner] Serie: "' + entry.name + '" -> "' + seriesTitle + '"')

    const episodes = processSeriesEpisodes(seriesPath, seriesTitle, year)

    if (episodes.length > 0) {
      const seasonCounts = new Map<number, number>()
      for (const ep of episodes) {
        seasonCounts.set(ep.season || 1, (seasonCounts.get(ep.season || 1) || 0) + 1)
      }
      const seasonSummary = [...seasonCounts.entries()].map(([s, c]) => 'T' + s + '(' + c + ')').join(', ')
      console.log('[Scanner] OK "' + seriesTitle + '" -> ' + episodes.length + ' eps [' + seasonSummary + ']')
      results.push({ seriesTitle, year, episodes })
    } else {
      console.log('[Scanner] SIN EPISODIOS: "' + seriesTitle + '"')
    }
  }

  console.log('[Scanner] TOTAL: ' + results.length + ' series')
  return results
}

// ─── Scan with diagnostics ──────────────────────────────────────

export function scanSeriesWithDiagnostics(folderPath: string): { groups: ParsedSeriesGroup[], diag: ScanDiagnostics } {
  const absolutePath = path.resolve(folderPath)
  const diag: ScanDiagnostics = {
    folderScanned: absolutePath,
    autoCorrected: false,
    subdirsFound: [],
    subdirsProcessed: [],
    seriesFound: [],
    totalEpisodes: 0,
  }

  if (!fs.existsSync(absolutePath)) {
    throw new Error('Carpeta no encontrada: ' + absolutePath)
  }

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(absolutePath, { withFileTypes: true })
  } catch (err) {
    throw new Error('No se puede leer ' + absolutePath + ': ' + String(err))
  }

  const dirEntries = entries.filter(e =>
    e.isDirectory() && !e.name.startsWith('.') && !['__MACOSX', 'System Volume Information'].includes(e.name)
  )

  diag.subdirsFound = dirEntries.map(e => e.name)

  // Auto-correct check
  if (dirEntries.length > 0) {
    const seasonCount = dirEntries.filter(e => isSeasonFolder(e.name)).length
    if (seasonCount === dirEntries.length && dirEntries.length >= 2) {
      const parentPath = path.dirname(absolutePath)
      diag.autoCorrected = true
      diag.originalFolder = absolutePath
      const parentResult = scanSeriesWithDiagnostics(parentPath)
      return parentResult
    }
  }

  // Normal scan
  const results: ParsedSeriesGroup[] = []

  for (const entry of dirEntries) {
    if (isSeasonFolder(entry.name)) continue

    const seriesPath = path.join(absolutePath, entry.name)
    const year = extractYearFromFolderName(entry.name)
    let seriesTitle = cleanSeriesFolderName(entry.name)

    if (!seriesTitle) {
      let fb = entry.name.replace(/[\[\(].*?[\]\)]/g, '')
      fb = fb.replace(/[\.\s]*\d{4}[\.\s]*/g, ' ')
      fb = fb.replace(/[.\-_]/g, ' ')
      fb = fb.replace(/\s+/g, ' ').trim()
      seriesTitle = fb || entry.name
    }

    diag.subdirsProcessed.push(entry.name)

    const episodes = processSeriesEpisodes(seriesPath, seriesTitle, year)

    if (episodes.length > 0) {
      results.push({ seriesTitle, year, episodes })
      diag.seriesFound.push(seriesTitle + ' (' + episodes.length + ' eps)')
      diag.totalEpisodes += episodes.length
    }
  }

  return { groups: results, diag }
}

export async function scanMultipleSeriesFolders(folders: string[]): Promise<ParsedSeriesGroup[]> {
  const allSeries: ParsedSeriesGroup[] = []
  for (const folder of folders) {
    if (!folder.trim()) continue
    try { allSeries.push(...scanSeriesByFolder(folder)) }
    catch (err) { console.error('Error scanning series folder ' + folder + ':', err) }
  }
  return allSeries
}

// ─── Movie scanner ──────────────────────────────────────────────

export interface ParsedMovieGroup {
  movieTitle: string
  year: number | null
  files: ParsedVideo[]
}

export function scanMoviesByFolder(folderPath: string): ParsedMovieGroup[] {
  const absolutePath = path.resolve(folderPath)

  if (!fs.existsSync(absolutePath)) {
    throw new Error('Carpeta no encontrada: ' + absolutePath)
  }

  const results: ParsedMovieGroup[] = []
  const entries = fs.readdirSync(absolutePath, { withFileTypes: true })

  const dirEntries = entries.filter(e =>
    e.isDirectory() && !e.name.startsWith('.') && !['__MACOSX', 'System Volume Information'].includes(e.name)
  )

  // Flat videos in root
  for (const file of getSortedVideoFiles(absolutePath)) {
    const parsed = parseVideoFile(file)
    if (!parsed.isSeries) results.push({ movieTitle: parsed.title, year: parsed.year, files: [parsed] })
  }

  // Subdirectories
  for (const entry of dirEntries) {
    const moviePath = path.join(absolutePath, entry.name)
    const year = extractYearFromFolderName(entry.name)
    const rawTitle = entry.name.replace(/[\.\s]*[\(\[]?\d{4}[\)\]]?/g, '')
    const movieTitle = cleanTitle(rawTitle)
    if (!movieTitle) continue

    const videos: ParsedVideo[] = []
    const movieVideos = getSortedVideoFiles(moviePath)
    for (const file of movieVideos) {
      videos.push({ filePath: file, fileName: path.basename(file), title: movieTitle, year, season: null, episode: null, isSeries: false })
    }

    if (videos.length > 0) {
      results.push({ movieTitle, year, files: videos })
    } else {
      const subDirs = listSubdirs(moviePath)
      const seasonLikeSubs = subDirs.filter(n => isSeasonFolder(n))

      if (seasonLikeSubs.length >= 2) continue

      if (subDirs.length >= 3) {
        let dirsW = 0
        for (const sub of subDirs) {
          if (getSortedVideoFiles(path.join(moviePath, sub)).length >= 3) dirsW++
        }
        if (dirsW >= 3) continue
      }

      for (const sub of subDirs) {
        for (const file of getSortedVideoFiles(path.join(moviePath, sub))) {
          videos.push({ filePath: file, fileName: path.basename(file), title: movieTitle, year, season: null, episode: null, isSeries: false })
        }
      }
      if (videos.length > 0) results.push({ movieTitle, year, files: videos })
    }
  }

  return results
}

export async function scanMultipleMovieFolders(folders: string[]): Promise<ParsedMovieGroup[]> {
  const allMovies: ParsedMovieGroup[] = []
  for (const folder of folders) {
    if (!folder.trim()) continue
    try { allMovies.push(...scanMoviesByFolder(folder)) }
    catch (err) { console.error('Error scanning movie folder ' + folder + ':', err) }
  }
  return allMovies
}