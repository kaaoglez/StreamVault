import { NextRequest, NextResponse } from 'next/server'

// Cinematic dark gradient palettes for wide backdrops (more dramatic)
const PALETTES = [
  ['#0f0c29', '#302b63', '#24243e', '#1a1a2e'], // Deep indigo
  ['#1a1a2e', '#16213e', '#0f3460', '#0a192f'], // Midnight navy
  ['#200122', '#4a0e0e', '#6f0000', '#1a0000'],  // Deep crimson
  ['#0d0d0d', '#1a1a2e', '#2d2d5e', '#0f0f23'], // Dark steel
  ['#1b0a2e', '#2d1544', '#3d1f5c', '#0f0a1a'], // Dark purple
  ['#0a1628', '#122a45', '#1a3a5c', '#0d1b2a'], // Ocean depths
  ['#1a0000', '#3a0a0a', '#5c1a1a', '#0d0505'], // Blood red
  ['#0a0f1a', '#12202e', '#1a3040', '#0d181f'], // Teal dark
  ['#141e30', '#1e2d42', '#243b55', '#0f1822'], // Gunmetal
  ['#1c1c3c', '#2a2a5e', '#3c3c6e', '#0f0f23'], // Deep violet
  ['#0d1b2a', '#152a3a', '#1e3a4a', '#0a1520'], // Dark slate
  ['#2d1b00', '#3d2a0a', '#4a3514', '#1a1000'], // Dark amber
]

// Accent colors
const ACCENTS = [
  '#e94560', '#ff6b6b', '#ffd93d', '#6bcb77',
  '#4d96ff', '#ff6b9d', '#c56cf0', '#ffb830',
  '#ff4757', '#2ed573', '#1e90ff', '#ff6348',
]

function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return Math.abs(hash)
}

function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ title: string }> }
) {
  try {
    const { title } = await params
    const decodedTitle = decodeURIComponent(title)
    const hash = hashCode(decodedTitle)
    const rand = seededRandom(hash)

    // Pick palette
    const paletteIndex = hash % PALETTES.length
    const palette = PALETTES[paletteIndex]
    const accent = ACCENTS[hash % ACCENTS.length]

    // Generate atmospheric elements
    const elements: string[] = []

    // Floating orbs
    const numOrbs = 5 + (hash % 6)
    for (let i = 0; i < numOrbs; i++) {
      const cx = rand() * 1920
      const cy = rand() * 1080
      const r = 40 + rand() * 200
      const opacity = 0.02 + rand() * 0.06
      elements.push(
        `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${r.toFixed(0)}" fill="${accent}" opacity="${opacity.toFixed(3)}" />`
      )
    }

    // Horizontal light bands
    const numBands = 2 + (hash % 3)
    for (let i = 0; i < numBands; i++) {
      const y = rand() * 1080
      const height = 50 + rand() * 200
      const opacity = 0.02 + rand() * 0.04
      elements.push(
        `<rect x="0" y="${y.toFixed(0)}" width="1920" height="${height.toFixed(0)}" fill="${accent}" opacity="${opacity.toFixed(3)}" />`
      )
    }

    // Diagonal light streak
    const angle = rand() * Math.PI * 0.5 - Math.PI * 0.25
    const cx = 960
    const cy = 540
    const len = 1400
    elements.push(
      `<line x1="${(cx + Math.cos(angle) * len).toFixed(0)}" y1="${(cy + Math.sin(angle) * len).toFixed(0)}" x2="${(cx - Math.cos(angle) * len).toFixed(0)}" y2="${(cy - Math.sin(angle) * len).toFixed(0)}" stroke="${accent}" stroke-width="2" opacity="0.08" />`
    )

    // Bottom gradient overlay (for text readability)
    const bottomOverlay = `
      <defs>
        <linearGradient id="bottomFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="black" stop-opacity="0" />
          <stop offset="60%" stop-color="black" stop-opacity="0" />
          <stop offset="100%" stop-color="black" stop-opacity="0.7" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="1920" height="1080" fill="url(#bottomFade)" />
    `

    // Build gradient
    const gradientStops = palette
      .map((color, i) => {
        const offset = Math.round((i / (palette.length - 1)) * 100)
        return `<stop offset="${offset}%" stop-color="${color}" />`
      })
      .join('')

    // Title at bottom-left area
    const displayTitle =
      decodedTitle.length > 40
        ? decodedTitle.slice(0, 38) + '…'
        : decodedTitle
    const titleLines = splitTitle(displayTitle)

    const baseY = 920
    const titleElements = titleLines
      .map((line, i) => {
        const y = baseY + i * 56
        const fontSize = i === 0 ? 52 : 40
        return `<text x="80" y="${y}" fill="white" font-family="system-ui, -apple-system, sans-serif" font-weight="800" font-size="${fontSize}" opacity="0.95">${escapeXml(line)}</text>`
      })
      .join('')

    const accentLine = `<rect x="80" y="${baseY + titleLines.length * 56 + 8}" width="120" height="4" fill="${accent}" rx="2" />`

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      ${gradientStops}
    </linearGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#bg)" />
  ${elements.join('\n  ')}
  ${bottomOverlay}
  ${titleElements}
  ${accentLine}
</svg>`

    return new NextResponse(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to generate backdrop' }, { status: 500 })
  }
}

function splitTitle(title: string): string[] {
  if (title.length <= 22) return [title]

  const words = title.split(' ')
  if (words.length === 1) {
    const mid = Math.ceil(title.length / 2)
    return [title.slice(0, mid), title.slice(mid)]
  }

  const mid = Math.ceil(words.length / 2)
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')]
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}