import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ─── POST: receive VTT content and save to cache ─────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const vtt = await request.text()
    if (!vtt.trim().startsWith('WEBVTT')) {
      return NextResponse.json({ error: 'Archivo no es VTT válido' }, { status: 400 })
    }

    // Save to cache directory
    const cacheDir = path.join(process.cwd(), 'db', 'subtitles')
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true })
    fs.writeFileSync(path.join(cacheDir, `${id}.vtt`), vtt, 'utf-8')
    fs.writeFileSync(path.join(cacheDir, `${id}.lang`), 'local', 'utf-8')

    // Also try to save to DB (non-blocking, ignore if schema not updated)
    try {
      const { db } = await import('@/lib/db')
      await db.movie.update({ where: { id }, data: { subtitleVtt: vtt, subtitleLang: 'local' } }).catch(() => {})
      await db.episode.update({ where: { id }, data: { subtitleVtt: vtt, subtitleLang: 'local' } }).catch(() => {})
    } catch {}

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[SUBTITLE UPLOAD]', err)
    return NextResponse.json({ error: 'Error al guardar subtítulo' }, { status: 500 })
  }
}