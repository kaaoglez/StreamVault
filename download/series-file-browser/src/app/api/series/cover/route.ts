import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp'])
const COVER_NAMES = ['cover', 'poster', 'folder']

export async function GET(request: NextRequest) {
  const folderPath = request.nextUrl.searchParams.get('path') || ''

  if (!folderPath.trim()) {
    return NextResponse.json({ error: 'No se especificó ruta' }, { status: 400 })
  }

  try {
    const normalized = path.normalize(folderPath)

    if (normalized.includes('..')) {
      return NextResponse.json({ error: 'Path traversal no permitido' }, { status: 400 })
    }

    if (!fs.existsSync(normalized)) {
      return NextResponse.json({ error: 'Carpeta no encontrada' }, { status: 404 })
    }

    // Look for cover image in the folder
    const entries = fs.readdirSync(normalized, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase().replace('.', '')
      if (!IMAGE_EXTENSIONS.has(ext)) continue

      const baseName = path.basename(entry.name, `.${ext}`).toLowerCase()
      if (COVER_NAMES.some(name => baseName.startsWith(name))) {
        const imagePath = path.join(normalized, entry.name)
        const imageBuffer = fs.readFileSync(imagePath)
        const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'

        return new NextResponse(imageBuffer as unknown as ReadableStream, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(imageBuffer.length),
            'Cache-Control': 'public, max-age=3600',
          },
        })
      }
    }

    return NextResponse.json({ error: 'No se encontró carátula' }, { status: 404 })
  } catch (error) {
    return NextResponse.json(
      { error: 'Error al leer carátula', details: String(error) },
      { status: 500 }
    )
  }
}