import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ─── SRT → VTT conversion ──────────────────────────────────

function srtToVtt(srt: string): string {
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

// ─── Filesystem language suffixes (fallback) ────────────────

const ALL_LANGS: { suffix: string; lang: string }[] = [
  { suffix: '.vtt', lang: 'es' },
  { suffix: '.srt', lang: 'es' },
  { suffix: '.es.vtt', lang: 'es' },
  { suffix: '.es.srt', lang: 'es' },
  { suffix: '.spa.vtt', lang: 'es' },
  { suffix: '.spa.srt', lang: 'es' },
  { suffix: '.en.vtt', lang: 'en' },
  { suffix: '.en.srt', lang: 'en' },
  { suffix: '.eng.vtt', lang: 'en' },
  { suffix: '.eng.srt', lang: 'en' },
  { suffix: '.fr.vtt', lang: 'fr' },
  { suffix: '.fr.srt', lang: 'fr' },
  { suffix: '.pt.vtt', lang: 'pt' },
  { suffix: '.pt.srt', lang: 'pt' },
  { suffix: '.de.vtt', lang: 'de' },
  { suffix: '.de.srt', lang: 'de' },
]

function findSubtitleFile(
  videoPath: string,
  preferredLang?: string | null,
): { filePath: string; isSrt: boolean } | null {
  const dir = path.dirname(videoPath)
  const base = path.basename(videoPath, path.extname(videoPath))

  const langs = preferredLang
    ? ALL_LANGS.filter((c) => c.lang === preferredLang).concat(ALL_LANGS.filter((c) => c.lang !== preferredLang))
    : ALL_LANGS

  for (const c of langs) {
    const full = path.join(dir, base + c.suffix)
    if (fs.existsSync(full)) {
      return { filePath: full, isSrt: c.suffix.endsWith('.srt') }
    }
  }
  return null
}

// ─── Resolve content: DB first, then filesystem ─────────────

async function resolveSubtitleContent(id: string): Promise<{ content: string; lang: string } | null> {
  // 1. Try episode DB
  try {
    const episode = await db.episode.findUnique({ where: { id } })
    if (episode?.subtitleVtt) {
      return { content: episode.subtitleVtt, lang: episode.subtitleLang || 'es' }
    }
  } catch {
    // DB schema might not have subtitleVtt field yet
  }

  // 2. Try movie DB
  try {
    const movie = await db.movie.findUnique({ where: { id } })
    if (movie?.subtitleVtt) {
      return { content: movie.subtitleVtt, lang: movie.subtitleLang || 'es' }
    }
  } catch {
    // DB schema might not have subtitleVtt field yet
  }

  // 3. Try cache directory (fallback when DB schema isn't updated)
  try {
    const cachePath = path.join(process.cwd(), 'db', 'subtitles', `${id}.vtt`)
    if (fs.existsSync(cachePath)) {
      const content = fs.readFileSync(cachePath, 'utf-8')
      let lang = 'es'
      const langPath = path.join(process.cwd(), 'db', 'subtitles', `${id}.lang`)
      if (fs.existsSync(langPath)) lang = fs.readFileSync(langPath, 'utf-8').trim()
      return { content, lang }
    }
  } catch {}

  // 4. Try filesystem alongside video (episode first, then movie)
  try {
    const episode = await db.episode.findUnique({ where: { id }, select: { filePath: true } })
    const movie = await db.movie.findUnique({ where: { id }, select: { filePath: true } })

    if (episode?.filePath) {
      const sub = findSubtitleFile(episode.filePath)
      if (sub) {
        let content = fs.readFileSync(sub.filePath, 'utf-8')
        if (sub.isSrt) content = srtToVtt(content)
        return { content, lang: 'es' }
      }
    }
    if (movie?.filePath) {
      const sub = findSubtitleFile(movie.filePath)
      if (sub) {
        let content = fs.readFileSync(sub.filePath, 'utf-8')
        if (sub.isSrt) content = srtToVtt(content)
        return { content, lang: 'es' }
      }
    }
  } catch {}

  return null
}

// ─── GET: serve subtitle content ──────────────────────────
// Also handles HEAD requests automatically (Next.js uses GET for HEAD)

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const sub = await resolveSubtitleContent(id)
  if (!sub) {
    return NextResponse.json({ hasSubtitles: false }, { status: 404 })
  }

  return new Response(sub.content, {
    headers: {
      'Content-Type': 'text/vtt; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Subtitle-Lang': sub.lang,
    },
  })
}