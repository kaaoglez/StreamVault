import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const VIDEO_EXTENSIONS = new Set([
  'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg'
])

// Image extensions for cover detection
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif'])

export async function GET(request: NextRequest) {
  const dirPath = request.nextUrl.searchParams.get('path') || ''

  if (!dirPath.trim()) {
    return NextResponse.json(
      { error: 'No se especificó una ruta' },
      { status: 400 }
    )
  }

  try {
    const normalized = path.normalize(dirPath)

    // Security: prevent path traversal
    if (normalized.includes('..')) {
      return NextResponse.json(
        { error: 'Path traversal no permitido' },
        { status: 400 }
      )
    }

    if (!fs.existsSync(normalized)) {
      return NextResponse.json(
        { error: 'Carpeta no encontrada' },
        { status: 404 }
      )
    }

    const stat = fs.statSync(normalized)

    if (!stat.isDirectory()) {
      return NextResponse.json(
        { error: 'No es una carpeta' },
        { status: 400 }
      )
    }

    const entries = fs.readdirSync(normalized, { withFileTypes: true })

    const folders: Array<{
      name: string
      path: string
      videoCount: number
      subFolderCount: number
      hasCover: boolean
    }> = []

    const files: Array<{
      name: string
      path: string
      size: number
      modifiedAt: string
      extension: string
    }> = []

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === '__MACOSX' || entry.name === 'System Volume Information') {
        continue
      }

      const fullPath = path.join(normalized, entry.name)

      try {
        const itemStat = fs.statSync(fullPath)

        if (entry.isDirectory()) {
          let videoCount = 0
          let subFolderCount = 0
          let hasCover = false

          try {
            const subEntries = fs.readdirSync(fullPath, { withFileTypes: true })
            for (const sub of subEntries) {
              if (sub.name.startsWith('.')) continue
              const ext = path.extname(sub.name).toLowerCase().replace('.', '')
              if (IMAGE_EXTENSIONS.has(ext) && (
                sub.name.toLowerCase().startsWith('cover') ||
                sub.name.toLowerCase().startsWith('poster') ||
                sub.name.toLowerCase() === 'folder.jpg' ||
                sub.name.toLowerCase() === 'folder.png'
              )) {
                hasCover = true
              }
              if (sub.isDirectory()) {
                subFolderCount++
              } else if (VIDEO_EXTENSIONS.has(ext)) {
                videoCount++
              }
            }
          } catch { /* skip unreadable */ }

          folders.push({
            name: entry.name,
            path: fullPath,
            videoCount,
            subFolderCount,
            hasCover,
          })
        } else {
          const ext = path.extname(entry.name).toLowerCase().replace('.', '')
          if (VIDEO_EXTENSIONS.has(ext)) {
            files.push({
              name: entry.name,
              path: fullPath,
              size: itemStat.size,
              modifiedAt: itemStat.mtime.toISOString(),
              extension: ext,
            })
          }
        }
      } catch { /* skip inaccessible files */ }
    }

    // Sort folders and files alphabetically
    folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))

    const totalSize = files.reduce((sum, f) => sum + f.size, 0)

    return NextResponse.json({
      path: normalized,
      parentPath: path.dirname(normalized),
      folders,
      files,
      totalFiles: files.length,
      totalFolders: folders.length,
      totalSize,
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'Error al leer carpeta', details: String(error) },
      { status: 500 }
    )
  }
}