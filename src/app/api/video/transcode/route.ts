import { NextRequest, NextResponse } from 'next/server'
import { spawn, execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

let ffmpegAvailable: boolean | null = null

function isFfmpegAvailable(): boolean {
  if (ffmpegAvailable !== null) return ffmpegAvailable
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' })
    ffmpegAvailable = true
  } catch {
    ffmpegAvailable = false
  }
  return ffmpegAvailable
}

export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get('path') || ''

  if (!filePath.trim()) {
    return NextResponse.json({ error: 'No se especificó archivo' }, { status: 400 })
  }

  if (!isFfmpegAvailable()) {
    return NextResponse.json({ error: 'FFmpeg no está instalado' }, { status: 500 })
  }

  const normalized = path.normalize(filePath)

  if (normalized.includes('..')) {
    return NextResponse.json({ error: 'Path traversal no permitido' }, { status: 400 })
  }

  if (!fs.existsSync(normalized) || !fs.statSync(normalized).isFile()) {
    return NextResponse.json({ error: 'Archivo no encontrado' }, { status: 404 })
  }

  const ffmpeg = spawn('ffmpeg', [
    '-i', normalized,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'fastdecode',
    '-profile:v', 'high',
    '-level', '4.1',
    '-pix_fmt', 'yuv420p',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ac', '2',
    '-movflags', '+faststart+frag_keyframe+empty_moov',
    '-f', 'mp4',
    '-loglevel', 'error',
    'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'pipe'] })

  // Handle client disconnect
  request.signal.addEventListener('abort', () => {
    ffmpeg.kill('SIGTERM')
  })

  const stream = new ReadableStream({
    start(controller) {
      ffmpeg.stdout.on('data', (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk))
      })
      ffmpeg.stdout.on('end', () => controller.close())
      ffmpeg.stderr.on('data', () => {})
      ffmpeg.on('error', () => controller.close())
      ffmpeg.on('close', () => controller.close())
    },
    cancel() {
      ffmpeg.kill('SIGTERM')
    },
  })

  return new NextResponse(stream, {
    status: 200,
    headers: {
      'Content-Type': 'video/mp4',
    },
  })
}