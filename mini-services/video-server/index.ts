import express from 'express'
import path from 'path'
import { PrismaClient } from '@prisma/client'
import { spawn } from 'child_process'

const app = express()
const PORT = 3001

// CORS for video requests from the main app
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'Range')
  res.header('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges')
  next()
})

// Use the same SQLite database as the main app
const dbPath = path.resolve(process.cwd(), '../db/streamvault.db')
const db = new PrismaClient({
  datasources: { db: { url: `file:${dbPath}` } },
})

// ─── Check ffmpeg ────────────────────────────────────────────

let ffmpegAvailable = false
try {
  const result = spawn('ffmpeg', ['-version'], { stdio: 'ignore' })
  ffmpegAvailable = true
  result.kill()
} catch { /* not available */ }

// ─── MIME types ──────────────────────────────────────────────

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.wmv': 'video/x-ms-wmv', '.flv': 'video/x-flv', '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
}
const BROWSER_NATIVE = new Set(['.mp4', '.m4v', '.webm', '.ogv'])

// ─── Resolve file path from ID ───────────────────────────────

async function getFilePath(id: string): Promise<string | null> {
  const episode = await db.episode.findUnique({ where: { id } })
  if (episode?.filePath) return episode.filePath

  const movie = await db.movie.findUnique({ where: { id } })
  if (movie?.filePath) return movie.filePath

  return null
}

// ─── GET /video/:id ──────────────────────────────────────────
// Direct serve for native formats, transcode for others

app.get('/video/:id', async (req, res) => {
  const { id } = req.params
  const transcode = req.query.transcode === 'true'

  try {
    const filePath = await getFilePath(id)
    if (!filePath) {
      return res.status(404).json({ error: 'Video no encontrado' })
    }

    const fs = await import('fs')
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `Archivo no encontrado: ${path.basename(filePath)}` })
    }

    const ext = path.extname(filePath).toLowerCase()
    const isNative = BROWSER_NATIVE.has(ext)

    // Non-native format + transcode requested or non-native + ffmpeg available
    if ((!isNative || transcode) && ffmpegAvailable) {
      return transcodeFile(req, res, filePath)
    }

    // Non-native + no ffmpeg
    if (!isNative && !ffmpegAvailable) {
      return res.status(422).json({
        error: `Formato .${ext.replace('.', '')} no soportado. Instala ffmpeg.`,
        needsFfmpeg: true,
        format: ext,
      })
    }

    // Native format → direct serve (Express handles range requests automatically)
    res.setHeader('Content-Type', MIME[ext] || 'video/mp4')
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error('[VIDEO] Send error:', err)
        if (!res.headersSent) {
          res.status(500).json({ error: 'Error al servir video' })
        }
      }
    })
  } catch (error) {
    console.error('[VIDEO] Error:', error)
    res.status(500).json({ error: String(error) })
  }
})

// ─── Transcode with ffmpeg ───────────────────────────────────

function transcodeFile(req: express.Request, res: express.Response, filePath: string) {
  console.log(`[VIDEO] Transcoding: ${path.basename(filePath)}`)

  res.setHeader('Content-Type', 'video/mp4')
  res.setHeader('Cache-Control', 'no-cache')

  const args = [
    '-i', filePath,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ac', '2',
    '-f', 'mp4',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-profile:v', 'baseline',
    '-level', '3.1',
    'pipe:1',
  ]

  const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })

  ffmpeg.stdout.pipe(res)

  ffmpeg.stderr.on('data', (data: Buffer) => {
    const msg = data.toString().trim()
    if (msg && !msg.includes('frame=') && !msg.includes('speed=') && !msg.includes('size=')) {
      console.error('[FFMPEG]', msg)
    }
  })

  ffmpeg.on('error', (err) => {
    console.error('[FFMPEG] Error:', err)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error de transcodificación' })
    }
  })

  req.on('close', () => {
    ffmpeg.kill('SIGTERM')
  })
}

// ─── Health check ────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ ok: true, ffmpeg: ffmpegAvailable })
})

// ─── Start ───────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Video server on port ${PORT} (ffmpeg: ${ffmpegAvailable ? 'yes' : 'no'})`)
})