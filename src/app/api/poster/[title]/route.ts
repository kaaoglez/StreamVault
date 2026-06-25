import { NextRequest, NextResponse } from 'next/server'

// Cinematic dark gradient palettes (pairs of dark, rich colors)
const PALETTES = [
  ['#0f0c29', '#302b63', '#24243e'], // Deep indigo
  ['#1a1a2e', '#16213e', '#0f3460'], // Midnight navy
  ['#200122', '#6f0000'],             // Deep crimson
  ['#0d0d0d', '#434343', '#1a1a2e'], // Dark steel
  ['#1b0a2e', '#3d1f5c', '#7b2d8e'], // Dark purple
  ['#0a1628', '#1a3a5c', '#2d6a9f'], // Ocean depths
  ['#1a0000', '#4a0000', '#8b0000'], // Blood red
  ['#0a0f1a', '#1a2f3a', '#2d4f5f'], // Teal dark
  ['#141e30', '#243b55'],             // Gunmetal
  ['#1c1c3c', '#3c3c6e', '#0f0f23'], // Deep violet
  ['#0d1b2a', '#1b263b', '#415a77'], // Dark slate
  ['#2d1b00', '#5c3a00', '#8b6914'], // Dark amber
  ['#0b0b0b', '#1a0a2e', '#2a1a4e'], // Void purple
  ['#0a192f', '#172a45', '#1e3a5f'], // Dark cerulean
  ['#1a0a0a', '#3a1a1a', '#5c2a2a'], // Dark rose
  ['#0f2027', '#203a43', '#2c5364'], // Dark teal
]

// Accent colors for decorative elements
const ACCENTS = [
  '#e94560', '#ff6b6b', '#ffd93d', '#6bcb77',
  '#4d96ff', '#ff6b9d', '#c56cf0', '#ffb830',
  '#ff4757', '#2ed573', '#1e90ff', '#ff6348',
  '#7bed9f', '#70a1ff', '#ff4757', '#eccc68',
]

function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0 // Convert to 32-bit integer
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

    // Generate subtle decorative elements based on title
    const elements: string[] = []
    const numElements = 3 + (hash % 4)

    for (let i = 0; i < numElements; i++) {
      const x = Math.floor(rand() * 400)
      const y = Math.floor(rand() * 600)
      const r = 20 + Math.floor(rand() * 120)
      const opacity = 0.03 + rand() * 0.08
      elements.push(
        `<circle cx="${x}" cy="${y}" r="${r}" fill="${accent}" opacity="${opacity.toFixed(2)}" />`
      )
    }

    // Add a diagonal light streak
    const streakAngle = rand() * 360
    const x1 = 200 + Math.cos(streakAngle) * 300
    const y1 = 300 + Math.sin(streakAngle) * 450
    const x2 = 200 - Math.cos(streakAngle) * 300
    const y2 = 300 - Math.sin(streakAngle) * 450
    elements.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${accent}" stroke-width="1" opacity="0.1" />`
    )

    // Build the SVG
    const gradientStops = palette
      .map((color, i) => {
        const offset = Math.round((i / (palette.length - 1)) * 100)
        return `<stop offset="${offset}%" stop-color="${color}" />`
      })
      .join('')

    // Format title for display - truncate long titles
    const displayTitle =
      decodedTitle.length > 30
        ? decodedTitle.slice(0, 28) + '…'
        : decodedTitle
    const titleLines = splitTitle(displayTitle)

    const titleY = 360
    const titleElements = titleLines
      .map((line, i) => {
        const y = titleY + i * 42
        const fontSize = i === 0 ? 28 : 22
        return `<text x="200" y="${y}" text-anchor="middle" fill="white" font-family="system-ui, -apple-system, sans-serif" font-weight="700" font-size="${fontSize}" opacity="0.95">${escapeXml(line)}</text>`
      })
      .join('')

    // Add a subtle glow behind the title
    const glowFilter = `
      <defs>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          ${gradientStops}
        </linearGradient>
        <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="${accent}" stop-opacity="0" />
          <stop offset="50%" stop-color="${accent}" stop-opacity="0.3" />
          <stop offset="100%" stop-color="${accent}" stop-opacity="0" />
        </linearGradient>
      </defs>
    `

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600">
  ${glowFilter}
  <rect width="400" height="600" fill="url(#bg)" />
  <rect x="0" y="0" width="400" height="600" fill="url(#bg)" />
  ${elements.join('\n  ')}
  <rect x="80" y="${titleY + titleLines.length * 42 + 10}" width="240" height="2" fill="url(#accentGrad)" rx="1" />
  ${titleElements}
  <text x="200" y="${titleY + titleLines.length * 42 + 30}" text-anchor="middle" fill="${accent}" font-family="system-ui, -apple-system, sans-serif" font-weight="500" font-size="11" letter-spacing="4" opacity="0.7">STREAMING</text>
</svg>`

    return new NextResponse(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to generate poster' }, { status: 500 })
  }
}

function splitTitle(title: string): string[] {
  if (title.length <= 20) return [title]

  const words = title.split(' ')
  if (words.length === 1) {
    // Single long word - split at midpoint
    const mid = Math.ceil(title.length / 2)
    return [title.slice(0, mid), title.slice(mid)]
  }

  // Find the best split point
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