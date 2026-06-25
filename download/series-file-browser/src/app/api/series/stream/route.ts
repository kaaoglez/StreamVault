import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get('path') || ''

  if (!filePath.trim()) {
    return NextResponse.json({ error: 'No se especificó archivo' }, { status: 400 })
  }

  try {
    const normalized = path.normalize(filePath)

    if (normalized.includes('..')) {
      return NextResponse.json({ error: 'Path traversal no permitido' }, { status: 400 })
    }

    if (!fs.existsSync(normalized)) {
      return NextResponse.json({ error: 'Archivo no encontrado' }, { status: 404 })
    }

    const stat = fs.statSync(normalized)

    if (!stat.isFile()) {
      return NextResponse.json({ error: 'No es un archivo' }, { status: 400 })
    }

    const fileSize = stat.size
    const range = request.headers.get('range')

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
      const chunkSize = end - start + 1

      const fileBuffer = fs.createReadStream(normalized, { start, end })

      return new NextResponse(fileBuffer as unknown as ReadableStream, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize),
          'Content-Type': getContentType(normalized),
        },
      })
    }

    // No range header — stream the whole file
    const fileBuffer = fs.createReadStream(normalized)

    return new NextResponse(fileBuffer as unknown as ReadableStream, {
      status: 200,
      headers: {
        'Content-Length': String(fileSize),
        'Content-Type': getContentType(normalized),
        'Accept-Ranges': 'bytes',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'Error al servir archivo', details: String(error) },
      { status: 500 }
    )
  }
}

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.wmv': 'video/x-ms-wmv',
    '.flv': 'video/x-flv',
    '.webm': 'video/webm',
    '.m4v': 'video/mp4',
    '.mpg': 'video/mpeg',
    '.mpeg': 'video/mpeg',
  }
  return mimeTypes[ext] || 'application/octet-stream'
}