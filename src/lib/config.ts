import fs from 'fs'
import path from 'path'

// ─── Config file (streamvault-config.json) ──────────────────────

export interface AppConfig {
  moviesFolders: string[]
  seriesFolders: string[]
  omdbApiKey: string
  opensubtitlesApiKey: string
}

const CONFIG_FILE = path.join(process.cwd(), 'streamvault-config.json')

const DEFAULT_CONFIG: AppConfig = {
  moviesFolders: [],
  seriesFolders: [],
  omdbApiKey: '',
  opensubtitlesApiKey: '',
}

export function getConfig(): AppConfig {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    // Migrate old single-folder format
    if (parsed.moviesFolder && !parsed.moviesFolders) {
      parsed.moviesFolders = parsed.moviesFolder ? [parsed.moviesFolder] : []
      delete parsed.moviesFolder
    }
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveConfig(config: AppConfig): void {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8')
}