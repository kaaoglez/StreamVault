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

// Year: 1900-2099, surrounded by separators OR at end of string
const YEAR_PATTERN = /[\.\s\-\_](\d{4})(?:[\.\s\-\_]|$)/
const YEAR_RANGE = { min: 1920, max: 2030 }

// Series patterns
const SEASON_EP_PATTERN = /[Ss](\d{1,2})[Ee](\d{1,2})/
const SEASON_ONLY = /[Ss](\d{2})(?:[\.\s\-\_]|$)/
const EP_ONLY = /[Ee](\d{1,2})(?:[\.\s\-\_]|$)/

// ─── Junk patterns to remove ────────────────────────────────────

const RESOLUTIONS = /\d{3,4}[pPiI]/g                     // 720p, 1080p, 2160p, 4K
const CODECS_VIDEO = /\b(x|h|H)\d{3,4}\b/g               // x264, h265, H265
const CODECS_AUDIO = /\b(aac|ac3|dts|flac|dd|atmos|truehd)\b/gi
const SOURCES = /\b(bluray|brrip|bdrip|webrip|web-dl|webdl|hdtv|hdrip|dvdrip|dvdscr|camrip|cam|ts|tc|scr|ppv|ppvrip|hdts|workprint)\b/gi
const TAGS = /\b(proper|repack|extended|unrated|directors?\s*cut|remastered|final|intern|subbed|sub|dubbed|dual|audio|latino|castellano|spanish|english|multi|español|ingles)\b/gi

// Words that are part of source/release tags but should NOT match inside real titles
const JUNK_WORDS = /\b(lat|spa|eng|sub|subs)\b/gi

export function cleanTitle(raw: string): string {
  let title = raw

  // Remove anything inside brackets/parens — these are always tags: [YTS], [RARBG], (2017)
  title = title.replace(/[\[\(].*?[\]\)]/g, '')

  // Remove S00E00 patterns (series markers) — already extracted before calling this
  title = title.replace(/[Ss]\d{1,2}[Ee]\d{1,2}/g, '')

  // Remove resolution: 720p, 1080p, 2160p, 4K
  title = title.replace(RESOLUTIONS, '')

  // Remove video codecs: x264, h265, HEVC (also common)
  title = title.replace(CODECS_VIDEO, '')
  title = title.replace(/\bHEVC\b/gi, '')
  title = title.replace(/\bx265\b/gi, '')
  title = title.replace(/\bAVC\b/gi, '')
  title = title.replace(/\bMPEG\b/gi, '')

  // Remove audio codecs
  title = title.replace(CODECS_AUDIO, '')

  // Remove source tags
  title = title.replace(SOURCES, '')

  // Remove release tags
  title = title.replace(TAGS, '')

  // Remove remaining common junk words (only as whole words)
  title = title.replace(JUNK_WORDS, '')

  // Remove file size patterns: 1.5GB, 700MB, 4.3Gb
  title = title.replace(/\b\d+\.?\d*\s*[GgMm][Bb]\b/g, '')

  // Remove "10bit", "8bit" color depth
  title = title.replace(/\b\d+bit\b/gi, '')

  // Replace separators with spaces
  title = title.replace(/[.\-_]/g, ' ')

  // Collapse multiple spaces
  title = title.replace(/\s+/g, ' ')

  return title.trim()
}

export function parseVideoFile(filePath: string): ParsedVideo {
  const ext = path.extname(filePath).toLowerCase()
  const fileName = path.basename(filePath, ext)
  const rawName = fileName

  // Check if it's a series (S01E02 pattern)
  const seMatch = rawName.match(SEASON_EP_PATTERN)
  const sMatch = rawName.match(SEASON_ONLY)
  const eMatch = rawName.match(EP_ONLY)

  let isSeries = false
  let season: number | null = null
  let episode: number | null = null
  let titlePart = rawName

  if (seMatch) {
    isSeries = true
    season = parseInt(seMatch[1], 10)
    episode = parseInt(seMatch[2], 10)
    titlePart = rawName.substring(0, seMatch.index!)
  } else if (sMatch) {
    isSeries = true
    season = parseInt(sMatch[1], 10)
    titlePart = rawName.substring(0, sMatch.index!)
  } else if (eMatch) {
    isSeries = true
    episode = parseInt(eMatch[1], 10)
    titlePart = rawName.substring(0, eMatch.index!)
  }

  // Extract year — now works even if year is at end of string
  const yearMatch = titlePart.match(YEAR_PATTERN)
  let year: number | null = null
  if (yearMatch) {
    const yr = parseInt(yearMatch[1], 10)
    if (yr >= YEAR_RANGE.min && yr <= YEAR_RANGE.max) {
      year = yr
      titlePart = titlePart.substring(0, yearMatch.index!)
    }
  }

  const title = cleanTitle(titlePart)

  return {
    filePath,
    fileName: rawName,
    title,
    year,
    season,
    episode,
    isSeries,
  }
}

// ─── Folder scanner ─────────────────────────────────────────────

export async function scanFolder(folderPath: string): Promise<ParsedVideo[]> {
  const absolutePath = path.resolve(folderPath)

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Carpeta no encontrada: ${absolutePath}`)
  }

  const videos: ParsedVideo[] = []

  function walkDir(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        // Skip hidden folders and common junk folders
        if (!entry.name.startsWith('.') && !['__MACOSX', 'System Volume Information'].includes(entry.name)) {
          walkDir(fullPath)
        }
      } else {
        const ext = path.extname(fullPath).toLowerCase()
        if (VIDEO_EXTENSIONS.has(ext)) {
          videos.push(parseVideoFile(fullPath))
        }
      }
    }
  }

  walkDir(absolutePath)
  return videos
}

// ─── Scan multiple folders ──────────────────────────────────────

export async function scanMultipleFolders(folders: string[]): Promise<ParsedVideo[]> {
  const allVideos: ParsedVideo[] = []
  for (const folder of folders) {
    if (!folder.trim()) continue
    try {
      const videos = await scanFolder(folder)
      allVideos.push(...videos)
    } catch (err) {
      console.error(`Error scanning ${folder}:`, err)
    }
  }
  return allVideos
}

// ─── Folder-based series scanner ────────────────────────────────
// Instead of relying on S01E02 filename patterns, this uses folder structure:
//   series_root/
//     Serie Name/
//       Season 1/  (or Temporada 1, S01, etc.)
//         ep1.mp4  → S01E01
//         ep2.mp4  → S01E02
//       Season 2/
//         ep1.mp4  → S02E01
//
//   OR flat (no season folders):
//   series_root/
//     Serie Name/
//       ep1.mp4  → S01E01
//       ep2.mp4  → S01E02

export interface ParsedSeriesGroup {
  seriesTitle: string
  year: number | null
  episodes: ParsedVideo[]
}

const SEASON_FOLDER_PATTERNS = [
  /^(?:season|temporada|s)\s*(\d{1,2})$/i,
  /^(?:season|temporada|s)\s*(\d{1,2})\s*[-–]\s*\d{1,2}$/i,  // Season 1-12
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

function getSortedVideoFiles(dir: string): string[] {
  const files: string[] = []
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (VIDEO_EXTENSIONS.has(ext)) {
          files.push(path.join(dir, entry.name))
        }
      }
    }
  } catch { /* skip unreadable dirs */ }

  // Natural sort: extract leading numbers for proper ordering (ep1, ep2, ep10...)
  files.sort((a, b) => {
    const nameA = path.basename(a).toLowerCase()
    const nameB = path.basename(b).toLowerCase()
    const numA = nameA.match(/(\d+)/)
    const numB = nameB.match(/(\d+)/)
    if (numA && numB) {
      const diff = parseInt(numA[1], 10) - parseInt(numB[1], 10)
      if (diff !== 0) return diff
    }
    return nameA.localeCompare(nameB)
  })

  return files
}

export function extractYearFromFolderName(folderName: string): number | null {
  const match = folderName.match(/[\.\s\-\_\(\[](\d{4})[\.\s\-\_\)\]]/)
  if (match) {
    const yr = parseInt(match[1], 10)
    if (yr >= 1920 && yr <= 2030) return yr
  }
  return null
}

// ─── Aggressive folder name cleaner for series reorganization ─────
// Removes season markers, release group tags, source info that
// commonly appear in folder names but NOT in actual series titles.

export function cleanSeriesFolderName(raw: string): string {
  let name = raw

  // Remove anything in brackets/parens (tags, years, etc.)
  name = name.replace(/[\[\(].*?[\]\)]/g, '')

  // Remove season markers: "Season 1", "Season 1-12", "Temporada 1", "S01" (standalone)
  name = name.replace(/(?:season|temporada)\s*\d{1,2}(?:\s*[-–]\s*\d{1,2})?/gi, '')
  name = name.replace(/\bS\d{1,2}\b(?!\s*[Ee])/gi, '')  // S01 but NOT S01E02

  // Remove common tags found in release folders
  name = name.replace(/\bCOMPLETE\b/gi, '')
  name = name.replace(/&\s*Extras/gi, '')

  // Remove year (e.g., "(2020)", " 2020 ")
  name = name.replace(/[\s]*[\(\[]?\d{4}[\)\]]?/g, '')

  // Then run standard cleanTitle for the rest (codecs, resolution, source tags, etc.)
  name = cleanTitle(name)

  return name.trim()
}

export function scanSeriesByFolder(folderPath: string): ParsedSeriesGroup[] {
  const absolutePath = path.resolve(folderPath)

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Carpeta no encontrada: ${absolutePath}`)
  }

  const results: ParsedSeriesGroup[] = []

  const entries = fs.readdirSync(absolutePath, { withFileTypes: true })

  // Separate: directories vs video files at this level
  const dirEntries = entries.filter(e =>
    e.isDirectory() &&
    !e.name.startsWith('.') &&
    !['__MACOSX', 'System Volume Information'].includes(e.name)
  )
  const videoFilesHere = getSortedVideoFiles(absolutePath)

  // Detect if THIS folder is a season folder (Season 1, Temporada 1, S01...)
  const thisIsSeasonFolder = isSeasonFolder(path.basename(absolutePath))

  // Detect if any subdir is a season folder
  const childSeasonFolders = dirEntries.filter(e => isSeasonFolder(e.name))

  // ── CASE 1: This folder itself is a season folder ──
  // e.g. user configured: D:\Series\Breaking Bad\Season 1\
  // Treat parent folder name as series, this as a season
  if (thisIsSeasonFolder && videoFilesHere.length > 0) {
    const parentName = path.basename(path.dirname(absolutePath))
    const year = extractYearFromFolderName(parentName)
    let seriesTitle = parentName.replace(/[\.\s]*[\(\[]?\d{4}[\)\]]?/g, '')
    seriesTitle = cleanTitle(seriesTitle)
    const seasonNum = extractSeasonFromFolder(path.basename(absolutePath)) || 1

    const episodes: ParsedVideo[] = videoFilesHere.map((file, index) => ({
      filePath: file,
      fileName: path.basename(file),
      title: seriesTitle,
      year,
      season: seasonNum,
      episode: index + 1,
      isSeries: true,
    }))

    if (episodes.length > 0 && seriesTitle) {
      results.push({ seriesTitle, year, episodes })
    }
    return results
  }

  // ── CASE 2: This folder has season subfolders ──
  // e.g. user configured: D:\Series\Breaking Bad\
  //   with Season 1/, Season 2/ inside
  if (childSeasonFolders.length > 0) {
    const folderName = path.basename(absolutePath)
    const year = extractYearFromFolderName(folderName)
    let seriesTitle = folderName.replace(/[\.\s]*[\(\[]?\d{4}[\)\]]?/g, '')
    seriesTitle = cleanTitle(seriesTitle)

    const episodes: ParsedVideo[] = []

    for (const seasonDir of childSeasonFolders) {
      const seasonNum = extractSeasonFromFolder(seasonDir.name) || 1
      const seasonPath = path.join(absolutePath, seasonDir.name)
      const videos = getSortedVideoFiles(seasonPath)

      videos.forEach((file, index) => {
        episodes.push({
          filePath: file, fileName: path.basename(file),
          title: seriesTitle, year, season: seasonNum, episode: index + 1, isSeries: true,
        })
      })
    }

    // Also grab any videos sitting directly in this folder (not in season folders)
    if (videoFilesHere.length > 0) {
      videoFilesHere.forEach((file, index) => {
        episodes.push({
          filePath: file, fileName: path.basename(file),
          title: seriesTitle, year, season: 1, episode: episodes.length + 1, isSeries: true,
        })
      })
    }

    if (episodes.length > 0 && seriesTitle) {
      results.push({ seriesTitle, year, episodes })
    }
    return results
  }

  // ── CASE 3: This folder has video files directly (no season subfolders) ──
  // e.g. user configured: D:\Series\Breaking Bad\
  //   with ep1.mp4, ep2.mp4 directly inside
  if (videoFilesHere.length > 0 && dirEntries.length === 0) {
    const folderName = path.basename(absolutePath)
    const year = extractYearFromFolderName(folderName)
    let seriesTitle = folderName.replace(/[\.\s]*[\(\[]?\d{4}[\)\]]?/g, '')
    seriesTitle = cleanTitle(seriesTitle)

    const episodes: ParsedVideo[] = videoFilesHere.map((file, index) => ({
      filePath: file, fileName: path.basename(file),
      title: seriesTitle, year, season: 1, episode: index + 1, isSeries: true,
    }))

    if (episodes.length > 0 && seriesTitle) {
      results.push({ seriesTitle, year, episodes })
    }
    return results
  }

  // ── CASE 4: This folder has video files AND non-season subdirectories ──
  // e.g. user configured: D:\Series\Breaking Bad\
  //   with ep1.mp4 AND some random subfolder
  if (videoFilesHere.length > 0 && dirEntries.length > 0) {
    const folderName = path.basename(absolutePath)
    const year = extractYearFromFolderName(folderName)
    let seriesTitle = folderName.replace(/[\.\s]*[\(\[]?\d{4}[\)\]]?/g, '')
    seriesTitle = cleanTitle(seriesTitle)

    const episodes: ParsedVideo[] = videoFilesHere.map((file, index) => ({
      filePath: file, fileName: path.basename(file),
      title: seriesTitle, year, season: 1, episode: index + 1, isSeries: true,
    }))

    // Also recurse into non-season subdirs and add their videos as season 1
    for (const sub of dirEntries) {
      const subPath = path.join(absolutePath, sub.name)
      const subVideos = getSortedVideoFiles(subPath)
      subVideos.forEach((file) => {
        episodes.push({
          filePath: file, fileName: path.basename(file),
          title: seriesTitle, year, season: 1, episode: episodes.length + 1, isSeries: true,
        })
      })
    }

    if (episodes.length > 0 && seriesTitle) {
      results.push({ seriesTitle, year, episodes })
    }
    return results
  }

  // ── CASE 5: Root folder with multiple series subfolders (original logic) ──
  // e.g. user configured: D:\Series\
  //   with Breaking Bad/, Dark/, Stranger Things/ inside
  for (const entry of dirEntries) {
    const seriesPath = path.join(absolutePath, entry.name)
    const year = extractYearFromFolderName(entry.name)

    let seriesTitle = entry.name
    seriesTitle = seriesTitle.replace(/[\.\s]*[\(\[]?\d{4}[\)\]]?/g, '')
    seriesTitle = cleanTitle(seriesTitle)

    if (!seriesTitle) continue

    const episodes: ParsedVideo[] = []

    const subEntries = fs.readdirSync(seriesPath, { withFileTypes: true })
    const seasonFolders = subEntries.filter(e =>
      e.isDirectory() && isSeasonFolder(e.name)
    )

    if (seasonFolders.length > 0) {
      for (const seasonDir of seasonFolders) {
        const seasonNum = extractSeasonFromFolder(seasonDir.name) || 1
        const seasonPath = path.join(seriesPath, seasonDir.name)
        const videos = getSortedVideoFiles(seasonPath)
        videos.forEach((file, index) => {
          episodes.push({
            filePath: file, fileName: path.basename(file),
            title: seriesTitle, year, season: seasonNum, episode: index + 1, isSeries: true,
          })
        })
      }
      // Also grab videos directly in series folder
      const directVideos = getSortedVideoFiles(seriesPath)
      directVideos.forEach((file) => {
        episodes.push({
          filePath: file, fileName: path.basename(file),
          title: seriesTitle, year, season: 1, episode: episodes.length + 1, isSeries: true,
        })
      })
    } else {
      const videoFiles = getSortedVideoFiles(seriesPath)
      if (videoFiles.length > 0) {
        videoFiles.forEach((file, index) => {
          episodes.push({
            filePath: file, fileName: path.basename(file),
            title: seriesTitle, year, season: 1, episode: index + 1, isSeries: true,
          })
        })
      } else {
        const nonHiddenSubs = subEntries.filter(e =>
          e.isDirectory() && !e.name.startsWith('.')
        )
        for (const sub of nonHiddenSubs) {
          const subPath = path.join(seriesPath, sub.name)
          const subVideos = getSortedVideoFiles(subPath)
          subVideos.forEach((file) => {
            episodes.push({
              filePath: file, fileName: path.basename(file),
              title: seriesTitle, year, season: 1, episode: episodes.length + 1, isSeries: true,
            })
          })
        }
      }
    }

    if (episodes.length > 0) {
      results.push({ seriesTitle, year, episodes })
    }
  }

  return results
}

export async function scanMultipleSeriesFolders(folders: string[]): Promise<ParsedSeriesGroup[]> {
  const allSeries: ParsedSeriesGroup[] = []
  for (const folder of folders) {
    if (!folder.trim()) continue
    try {
      const groups = scanSeriesByFolder(folder)
      allSeries.push(...groups)
    } catch (err) {
      console.error(`Error scanning series folder ${folder}:`, err)
    }
  }
  return allSeries
}