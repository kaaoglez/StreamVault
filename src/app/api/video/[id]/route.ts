import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { execSync, spawn } from 'child_process'
import { Readable } from 'stream'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ─── Concurrent transcode limit ──────────────────────────────

let activeTranscodes = 0
const MAX_CONCURRENT = 3

// ─── Check if ffmpeg is available ─────────────────────────────

let ffmpegAvailable: boolean | null = null

export function isFfmpegAvailable(): boolean {
  if (ffmpegAvailable !== null) return ffmpegAvailable
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' })
    ffmpegAvailable = true
  } catch {
    ffmpegAvailable = false
  }
  return ffmpegAvailable
}

// ─── Mime types ───────────────────────────────────────────────

const MIME_MAP: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.ogv': 'video/ogg',
  '.3gp': 'video/3gpp',
  '.ts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.mts': 'video/mp2t',
}

// Formats the browser can play natively (container-wise)
const BROWSER_NATIVE = new Set(['.mp4', '.m4v', '.webm', '.ogv', '.ogg'])

// ─── Resolve file path from ID ────────────────────────────────

async function resolveFilePath(id: string): Promise<{ filePath: string | null; error: string | null }> {
  const episode = await db.episode.findUnique({ where: { id } })
  if (episode?.filePath) return { filePath: episode.filePath, error: null }

  const movie = await db.movie.findUnique({ where: { id } })
  if (movie?.filePath) return { filePath: movie.filePath, error: null }

  return { filePath: null, error: 'Video no encontrado en la base de datos' }
}

// ─── Convert Node.js Readable to Web ReadableStream ──────────

function nodeStreamToWeb(nodeStream: fs.ReadStream): ReadableStream<Uint8Array> {
  // Use native Readable.toWeb() if available (Node.js 18+)
  // Falls back to manual conversion for compatibility
  try {
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>
    return webStream
  } catch {
    // Manual conversion fallback
    return new ReadableStream<Uint8Array>({
      start(controller) {
        nodeStream.on('data', (chunk: Buffer) => {
          try {
            controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength))
          } catch {
            // Controller already closed
          }
        })
        nodeStream.on('end', () => {
          try { controller.close() } catch { /* ignore */ }
        })
        nodeStream.on('error', (err) => {
          try { controller.error(err) } catch { /* ignore */ }
        })
      },
      cancel() {
        nodeStream.destroy()
      },
    })
  }
}

// ─── Parse Range header ───────────────────────────────────────

function parseRangeHeader(range: string | null, fileSize: number): { start: number; end: number } | null {
  if (!range) return null
  const parts = range.replace(/bytes=/, '').split('-')
  const start = parseInt(parts[0], 10)
  const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
  if (isNaN(start) || start >= fileSize) return null
  return { start, end: Math.min(end, fileSize - 1) }
}

// ─── Direct file serving (for native formats) ────────────────

function serveDirect(filePath: string, range: string | null) {
  const stat = fs.statSync(filePath)
  const fileSize = stat.size
  const ext = path.extname(filePath).toLowerCase()
  const mime = MIME_MAP[ext] || 'video/mp4'

  if (range) {
    const parsed = parseRangeHeader(range, fileSize)
    if (!parsed) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${fileSize}` },
      })
    }
    const { start, end } = parsed
    const chunkSize = end - start + 1

    const nodeStream = fs.createReadStream(filePath, {
      start,
      end,
      highWaterMark: 2 * 1024 * 1024, // 2MB chunks for smoother seeking
    })

    return new Response(nodeStreamToWeb(nodeStream), {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize.toString(),
        'Content-Type': mime,
        'Cache-Control': 'public, max-age=86400',
      },
    })
  }

  const nodeStream = fs.createReadStream(filePath, {
    highWaterMark: 2 * 1024 * 1024,
  })
  return new Response(nodeStreamToWeb(nodeStream), {
    headers: {
      'Content-Length': fileSize.toString(),
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}

// ─── FFmpeg transcoding stream (improved from reference repo) ─

function serveTranscoded(filePath: string, startTime?: number, signal?: AbortSignal) {
  let ffmpegProc: ReturnType<typeof spawn> | null = null
  let killed = false

  const cleanup = () => {
    if (!killed) {
      killed = true
      activeTranscodes = Math.max(0, activeTranscodes - 1)
    }
    if (ffmpegProc && !ffmpegProc.killed) {
      ffmpegProc.kill('SIGTERM')
      ffmpegProc = null
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Improved FFmpeg args from reference repo analysis:
      // - hide_banner/loglevel: cleaner logs
      // - threads 2: resource management
      // - ultrafast + fastdecode: fast transcoding for real-time playback
      // - high/4.1: better compatibility than baseline/3.1
      // - yuv420p: ensures browser compatibility
      // - scale with trunc: ensures even dimensions (avoids ffmpeg error)
      // - g 60/keyint_min 60: keyframes every 2s at 30fps for smooth seeking
      const args = [
        '-hide_banner',
        '-loglevel', 'warning',
        '-threads', '2',
        // Input analysis (higher = faster start for streaming)
        '-analyzeduration', '10M',
        '-probesize', '10M',
      ]

      // Seek before input for fast, accurate positioning (for resume)
      if (startTime && startTime > 0) {
        args.push('-ss', String(Math.floor(startTime)))
      }

      // Input
      args.push(
        '-i', filePath,
        // Video: H.264
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'fastdecode',
        '-crf', '23',
        '-profile:v', 'high',
        '-level', '4.1',
        '-pix_fmt', 'yuv420p',
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        // Keyframes every 2 seconds for smooth seeking
        '-g', '60',
        '-keyint_min', '60',
        '-sc_threshold', '0',
        // Audio: AAC
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ac', '2',
        '-ar', '48000',
        // Streaming format
        '-movflags', '+frag_keyframe+empty_moov+default_base_moof',
        '-f', 'mp4',
        'pipe:1',
      )

      ffmpegProc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })

      ffmpegProc.stdout?.on('data', (chunk: Buffer) => {
        try {
          controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength))
        } catch {
          // Controller already closed
        }
      })

      ffmpegProc.stderr?.on('data', (data: Buffer) => {
        const msg = data.toString().trim()
        // Only log non-progress FFmpeg output
        if (msg && !msg.includes('frame=') && !msg.includes('speed=') && !msg.includes('size=')) {
          console.error(`[FFMPEG] ${msg}`)
        }
      })

      ffmpegProc.on('error', (err) => {
        console.error('[FFMPEG] Spawn error:', err)
        cleanup()
        try { controller.error(err) } catch { /* ignore */ }
      })

      ffmpegProc.on('close', (code) => {
        cleanup()
        if (code !== 0 && code !== null) {
          console.error(`[FFMPEG] Exited with code ${code} for ${path.basename(filePath)}`)
        }
        try { controller.close() } catch { /* already closed */ }
      })
    },
    cancel() {
      cleanup()
    },
  })

  // Kill FFmpeg when client disconnects
  if (signal) {
    signal.addEventListener('abort', () => {
      console.log(`[FFMPEG] Client disconnected, killing transcode for ${path.basename(filePath)}`)
      cleanup()
    }, { once: true })
  }

  return new Response(stream, {
    headers: {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'none',
      'Cache-Control': 'no-cache',
      'X-Transcoded': 'true',
      'X-Start-Offset': String(startTime || 0),
    },
  })
}

// ─── HEAD: Pre-flight check for transcode slot availability ──

export async function HEAD(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const { filePath, error } = await resolveFilePath(id)
  if (!filePath) {
    return new NextResponse(null, { status: 404 })
  }

  if (!fs.existsSync(filePath)) {
    return new NextResponse(null, { status: 404 })
  }

  // Check concurrent transcode limit
  if (activeTranscodes >= MAX_CONCURRENT) {
    return new NextResponse(null, { status: 429 })
  }

  return new NextResponse(null, {
    status: 200,
    headers: { 'X-Ffmpeg-Available': isFfmpegAvailable().toString() },
  })
}

// ─── Main GET handler ─────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const forceTranscode = request.nextUrl.searchParams.get('transcode') === 'true'

  try {
    const { filePath, error: resolveError } = await resolveFilePath(id)
    if (!filePath) {
      console.error(`[VIDEO] ${resolveError} (id: ${id})`)
      return NextResponse.json({ error: resolveError }, { status: 404 })
    }

    if (!fs.existsSync(filePath)) {
      console.error(`[VIDEO] File not found: ${filePath}`)
      return NextResponse.json(
        { error: `Archivo no encontrado: ${path.basename(filePath)}` },
        { status: 404 }
      )
    }

    const ext = path.extname(filePath).toLowerCase()
    const isNativeFormat = BROWSER_NATIVE.has(ext)

    // Force transcode requested, or format not natively supported
    if (forceTranscode || !isNativeFormat) {
      if (!isFfmpegAvailable()) {
        if (!isNativeFormat) {
          return NextResponse.json(
            {
              error: `Formato .${ext.replace('.', '').toUpperCase()} no soportado. Instala ffmpeg para transcodificar.`,
              needsFfmpeg: true,
              format: ext,
            },
            { status: 422 }
          )
        }
        // Native format but transcode requested — fall through to direct
      } else {
        // Check concurrent transcode limit
        if (activeTranscodes >= MAX_CONCURRENT) {
          return NextResponse.json(
            { error: `Máximo ${MAX_CONCURRENT} transcodificaciones simultáneas. Espera un momento.` },
            { status: 429 }
          )
        }

        const startTime = request.nextUrl.searchParams.get('start')
        const startOffset = startTime ? parseFloat(startTime) : undefined
        if (startOffset && startOffset > 0) {
          console.log(`[VIDEO] Transcoding with seek: ${path.basename(filePath)} from ${Math.floor(startOffset)}s`)
        } else {
          console.log(`[VIDEO] Transcoding: ${path.basename(filePath)} (active: ${activeTranscodes + 1}/${MAX_CONCURRENT})`)
        }
        activeTranscodes++
        return serveTranscoded(filePath, startOffset, request.signal)
      }
    }

    // Direct serve for native formats (MP4, WebM, etc.)
    const range = request.headers.get('range')
    console.log(`[VIDEO] Direct serve: ${path.basename(filePath)} (range: ${range ? 'yes' : 'no'})`)
    return serveDirect(filePath, range)
  } catch (error) {
    console.error('[VIDEO] Serve error:', error)
    return NextResponse.json({ error: `Error: ${String(error)}` }, { status: 500 })
  }
}