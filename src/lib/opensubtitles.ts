// ─── OpenSubtitles API v1 (opensubtitles.com) ──────────────────────
// Search subtitles by IMDb ID and download .srt files.
// Free tier: 5 requests/second, 5 downloads/day.

const BASE_URL = 'https://api.opensubtitles.com/api/v1'
const USER_AGENT = 'StreamVault v1.0'

// OpenSubtitles API uses ISO 639-3 (3-letter codes: spa, eng, fra)
const API_LANG_MAP: Record<string, string> = {
  es: 'spa', spanish: 'spa',
  en: 'eng', english: 'eng',
  fr: 'fra', french: 'fra',
  pt: 'por', portuguese: 'por',
  de: 'deu', german: 'deu',
  it: 'ita', italian: 'ita',
  ja: 'jpn', japanese: 'jpn',
  ko: 'kor', korean: 'kor',
  zh: 'zho', chinese: 'zho',
  ru: 'rus', russian: 'rus',
  ar: 'ara', arabic: 'ara',
  hi: 'hin', hindi: 'hin',
}

function toApiLang(code: string): string {
  const c = code?.toLowerCase() || ''
  // Already a 3-letter code known to the API
  if (Object.values(API_LANG_MAP).includes(c)) return c
  // 2-letter or full name → convert
  return API_LANG_MAP[c] || c
}

interface SubtitleSearchResult {
  id: string
  type: string
  features: {
    moviehash_match?: boolean
    upload_date: string
    uploader: { name: string }
  }
  attributes: {
    subtitle_id: string
    language: string
    download_count: number
    release: string
    comments: string
    legacy_subtitle_id: number
    uploader_id: number
    from_trusted: boolean
    foreign_parts_only: boolean
    auto_translation: boolean
    ai_translated: boolean
    machine_translated: boolean
    upload_date: string
    hearing_impaired: boolean
    hd: boolean
    fps: number
    votes: number
    points: number
    ratings: number
    legacy_file_id: number
    file_name: string
    size: number
  }
  url: string
  related_links: { img_url: string; url: string; label: string }[]
}

interface SubtitleFile {
  link: string
  file_name: string
}

// ─── Search subtitles by IMDb ID ──────────────────────────────────

export async function searchSubtitles(
  imdbId: string,
  apiKey: string,
  language = 'es',
): Promise<{ results: SubtitleSearchResult[]; error?: string }> {
  try {
    const apiLang = toApiLang(language)
    const url = `${BASE_URL}/subtitles?imdb_id=${imdbId}&languages=${apiLang}&order_by=download_count&order_direction=desc`
    console.log(`[OPENSUBTITLES] Search URL: ${url}`)

    const res = await fetch(url, {
      headers: {
        'Api-Key': apiKey,
        'User-Agent': USER_AGENT,
      },
    })

    if (res.status === 401) {
      return { results: [], error: 'API key inválida' }
    }

    if (res.status === 406) {
      return { results: [], error: 'Límite diario alcanzado (5 descargas/día gratis)' }
    }

    if (!res.ok) {
      const body = await res.text()
      return { results: [], error: `Error API: ${res.status} ${body}` }
    }

    const data = await res.json()
    const results: SubtitleSearchResult[] = data.data || []

    // Log ALL returned results to verify language filter is working
    console.log(`[OPENSUBTITLES] Returned ${results.length} results (requested: ${language}, sent: ${apiLang})`)
    for (const r of results.slice(0, 10)) {
      console.log(`  → lang="${r.attributes.language}" file="${r.attributes.file_name}" dl=${r.attributes.download_count} ai=${r.attributes.ai_translated} machine=${r.attributes.machine_translated}`)
    }

    return { results }
  } catch (err) {
    return { results: [], error: `Error de conexión: ${String(err)}` }
  }
}

// ─── Get download link for a subtitle ────────────────────────────

export async function getSubtitleDownloadLink(
  subtitleFileId: string,
  apiKey: string,
): Promise<{ file: SubtitleFile | null; error?: string }> {
  try {
    // Request temporary download link
    const res = await fetch(`${BASE_URL}/download`, {
      method: 'POST',
      headers: {
        'Api-Key': apiKey,
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file_id: subtitleFileId }),
    })

    if (res.status === 406) {
      return { file: null, error: 'Límite diario alcanzado (5 descargas/día gratis)' }
    }

    if (!res.ok) {
      const body = await res.text()
      return { file: null, error: `Error descarga: ${res.status} ${body}` }
    }

    const data = await res.json()
    // API returns { link: "https://...", file_name: "..." } or { data: { link: ... } }
    const linkData = data.data || data
    const link = typeof linkData?.link === 'string' ? linkData.link : null
    const fileName = typeof linkData?.file_name === 'string' ? linkData.file_name : 'subtitle.srt'
    if (!link) {
      return { file: null, error: `Respuesta inesperada de OpenSubtitles: ${JSON.stringify(data).slice(0, 200)}` }
    }
    return { file: { link, file_name: fileName } }
  } catch (err) {
    return { file: null, error: `Error de conexión: ${String(err)}` }
  }
}

// ─── Download subtitle content ───────────────────────────────────

export async function downloadSubtitleContent(
  url: string,
): Promise<{ content: string; error?: string }> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
    })
    if (!res.ok) {
      return { content: '', error: `Error descargando archivo: ${res.status}` }
    }
    const content = await res.text()
    return { content }
  } catch (err) {
    return { content: '', error: `Error de conexión: ${String(err)}` }
  }
}

// ─── SRT → VTT conversion ────────────────────────────────────────

export function srtToVtt(srt: string): string {
  const lines = srt.split(/\r?\n/)
  const out: string[] = ['WEBVTT', '']
  for (const raw of lines) {
    if (/^\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/.test(raw)) {
      out.push(raw.replace(/,/g, '.'))
    } else {
      out.push(raw)
    }
  }
  return out.join('\n')
}