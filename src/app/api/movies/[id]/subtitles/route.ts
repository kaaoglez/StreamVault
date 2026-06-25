import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { db } from '@/lib/db'
import { getConfig } from '@/lib/config'
import { searchSubtitles, getSubtitleDownloadLink, downloadSubtitleContent, srtToVtt } from '@/lib/opensubtitles'

// ─── Language code normalization ──────────────────────────────
// OpenSubtitles returns ISO 639-3 codes (spa, eng, fra, etc.)
// We normalize to 2-letter codes for display/storage

const LANG_MAP: Record<string, string> = {
  es: 'es', spa: 'es', spanish: 'es',
  en: 'en', eng: 'en', english: 'en',
  fr: 'fr', fra: 'fr', fre: 'fr', french: 'fr',
  pt: 'pt', por: 'pt', portuguese: 'pt',
  de: 'de', ger: 'de', deu: 'de', german: 'de',
  it: 'it', ita: 'it', italian: 'it',
  ja: 'ja', jpn: 'ja', japanese: 'ja',
  ko: 'ko', kor: 'ko', korean: 'ko',
  zh: 'zh', zho: 'zh', chinese: 'zh',
  ru: 'ru', rus: 'ru', russian: 'ru',
  ar: 'ar', ara: 'ar', arabic: 'ar',
  hi: 'hi', hin: 'hi', hindi: 'hi',
}

function normalizeLang(code: string): string {
  return LANG_MAP[code?.toLowerCase()] || code?.toLowerCase() || ''
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ─── POST: Fetch subtitle from OpenSubtitles, save to DB + optionally filesystem ──

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { language = 'es' } = await request.json().catch(() => ({}))

    // 1. Get movie from DB
    const movie = await db.movie.findUnique({ where: { id } })
    if (!movie) {
      return NextResponse.json({ error: 'Película no encontrada' }, { status: 404 })
    }

    // 2. Need imdbId to search OpenSubtitles
    const imdbId = movie.imdbId?.trim()
    if (!imdbId) {
      return NextResponse.json(
        { error: 'La película no tiene IMDb ID. Actualízala primero con OMDB.' },
        { status: 400 },
      )
    }

    // 3. Get API key
    const config = getConfig()
    const apiKey = config.opensubtitlesApiKey
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Configura la API key de OpenSubtitles en ajustes' },
        { status: 400 },
      )
    }

    // 4. Search subtitles
    const search = await searchSubtitles(imdbId, apiKey, language)
    if (search.error) {
      return NextResponse.json({ error: search.error }, { status: 400 })
    }
    if (search.results.length === 0) {
      return NextResponse.json(
        { error: `No se encontraron subtítulos en ${language} para ${movie.title}` },
        { status: 404 },
      )
    }

    // 5. Pick the best result — STRICT language matching with clear fallbacks
    const normRequested = normalizeLang(language)

    console.log(`[SUBTITLES] Picking from ${search.results.length} results for "${movie.title}" (requested: ${normRequested})`)

    // Filter out: foreign-parts-only, AI translated, auto-translated, machine-translated
    const goodResults = search.results.filter((r) =>
      !r.attributes.foreign_parts_only &&
      !r.attributes.ai_translated &&
      !r.attributes.auto_translation &&
      !r.attributes.machine_translated
    )

    // Sort by download count (best first)
    goodResults.sort((a, b) => b.attributes.download_count - a.attributes.download_count)

    // Step 1: Best result with correct language among good results (no AI/machine)
    let best = goodResults.find((r) => normalizeLang(r.attributes.language) === normRequested)

    // Step 2: Correct language even if AI/machine translated (better than wrong language)
    if (!best) {
      best = search.results
        .filter((r) => normalizeLang(r.attributes.language) === normRequested)
        .sort((a, b) => b.attributes.download_count - a.attributes.download_count)[0]
      if (best) {
        console.warn(`[SUBTITLES] ⚠️ Solo se encontraron subtítulos ${normRequested} traducidos por IA/máquina para "${movie.title}"`)
      }
    }

    // Step 3: No results at all in requested language
    if (!best) {
      const availableLangs = [...new Set(search.results.map(r => r.attributes.language))].join(', ')
      return NextResponse.json({
        error: `No se encontraron subtítulos en ${normRequested} para "${movie.title}". Idiomas disponibles: ${availableLangs}`,
      }, { status: 404 })
    }

    console.log(`[SUBTITLES] Selected: lang=${best.attributes.language} file="${best.attributes.file_name}" (requested: ${normRequested})`)

    // 6. Get download link (use the result's 'id' as file_id)
    const dl = await getSubtitleDownloadLink(best.id, apiKey)
    if (dl.error || !dl.file) {
      return NextResponse.json({ error: dl.error || 'No se pudo obtener el enlace de descarga' }, { status: 400 })
    }

    // 7. Download subtitle content
    const dlContent = await downloadSubtitleContent(dl.file.link)
    if (dlContent.error || !dlContent.content) {
      return NextResponse.json({ error: dlContent.error || 'No se pudo descargar el archivo' }, { status: 400 })
    }

    // 8. Convert SRT → VTT if needed
    const fileName = dl.file.file_name || 'subtitle.srt'
    const isSrt = fileName.endsWith('.srt') || !fileName.endsWith('.vtt')
    const vttContent = isSrt ? srtToVtt(dlContent.content) : dlContent.content

    // 9. Save to DATABASE (always — works for all movies)
    const actualLang = normalizeLang(best.attributes.language) || language
    let dbSaved = false
    try {
      await db.movie.update({
        where: { id },
        data: { subtitleVtt: vttContent, subtitleLang: actualLang },
      })
      dbSaved = true
    } catch (dbErr) {
      console.error('[SUBTITLES] DB save failed (run db:push):', dbErr)
    }

    // 9b. Fallback: save to a local cache file if DB save failed
    if (!dbSaved) {
      try {
        const cacheDir = path.join(process.cwd(), 'db', 'subtitles')
        if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true })
        fs.writeFileSync(path.join(cacheDir, `${id}.vtt`), vttContent, 'utf-8')
        // Also save lang metadata
        fs.writeFileSync(path.join(cacheDir, `${id}.lang`), actualLang, 'utf-8')
      } catch (cacheErr) {
        console.error('[SUBTITLES] Cache save failed:', cacheErr)
      }
    }

    // 10. Also save alongside video file if filePath exists
    let savedPath: string | null = null
    if (movie.filePath) {
      savedPath = saveSubtitleFile(movie.filePath, vttContent, language)
    }

    // 11. For series, save subtitle to all episodes in DB too
    let episodesCount = 0
    if (movie.type === 'series') {
      const episodes = await db.episode.findMany({
        where: { seriesId: id },
        select: { id: true, filePath: true },
      })
      for (const ep of episodes) {
        try {
          await db.episode.update({
            where: { id: ep.id },
            data: { subtitleVtt: vttContent, subtitleLang: actualLang },
          })
        } catch {
          // Schema might not be updated — use cache fallback below
        }
        // Cache fallback for episodes too
        if (!dbSaved) {
          try {
            const cacheDir = path.join(process.cwd(), 'db', 'subtitles')
            if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true })
            fs.writeFileSync(path.join(cacheDir, `${ep.id}.vtt`), vttContent, 'utf-8')
          } catch {}
        }
        if (ep.filePath) {
          saveSubtitleFile(ep.filePath, vttContent, language)
        }
        episodesCount++
      }
    }

    return NextResponse.json({
      success: true,
      message: `Subtítulo ${actualLang} descargado: ${best.attributes.file_name}`,
      requestedLanguage: language,
      actualLanguage: actualLang,
      release: best.attributes.release,
      downloadCount: best.attributes.download_count,
      savedPath: savedPath || 'database',
      episodesCount,
      aiTranslated: best.attributes.ai_translated || best.attributes.machine_translated || best.attributes.auto_translation || false,
    })
  } catch (error) {
    console.error('[SUBTITLES] Error:', error)
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { error: `Error al descargar subtítulos: ${msg}` },
      { status: 500 },
    )
  }
}

// ─── Save VTT content alongside the video file (filesystem) ──────────────────

function saveSubtitleFile(
  videoPath: string,
  vttContent: string,
  lang: string = 'es',
): string | null {
  try {
    if (!fs.existsSync(videoPath)) return null
    const dir = path.dirname(videoPath)
    const base = path.basename(videoPath, path.extname(videoPath))
    const vttPath = path.join(dir, `${base}.${lang}.vtt`)
    fs.writeFileSync(vttPath, vttContent, 'utf-8')
    return vttPath
  } catch {
    return null
  }
}