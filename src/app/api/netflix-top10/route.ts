import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { searchMovie, getMovieDetails, isRateLimited } from '@/lib/omdb';

let cachedMovies: unknown[] | null = null;
let cacheTimestamp = 0;
let fetching = false;
const CACHE_TTL = 6 * 60 * 60 * 1000;

function decodeHexEscapes(s: string): string {
  return s.replace(/\\x([0-9a-fA-F]{2})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16))
  );
}

function extractTitles(html: string): string[] {
  const titles: string[] = [];
  const seen = new Set<string>();
  const re = /"title"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const d = decodeHexEscapes(m[1]);
    const l = d.trim().toLowerCase();
    if (l.includes('top 10') || l.length < 3) continue;
    if (!seen.has(l)) { seen.add(l); titles.push(d.trim()); }
  }
  return titles;
}

function poster(url: string): string {
  if (!url || url === 'N/A') return '';
  return url.replace(/_V1_[^@.]*(@)?/, '_V1_UX500_CR0,0,333,500_AL_$1');
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchAndCache() {
  if (fetching) return;
  fetching = true;
  try {
    const apiKey = getConfig().omdbApiKey;
    if (!apiKey) return;

    const res = await fetch('https://www.netflix.com/tudum/top10/api/week/us/movies', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', Accept: 'text/html,*/*' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      console.error(`[Netflix Top 10] HTTP ${res.status}`);
      return;
    }

    const html = await res.text();
    const titles = extractTitles(html).slice(0, 10);
    console.log(`[Netflix Top 10] Extracted ${titles.length} titles:`, titles);
    const movies: unknown[] = [];

    for (const title of titles) {
      if (isRateLimited()) break;
      const s = await searchMovie(title, undefined, apiKey);
      if (!s.result) { await sleep(250); continue; }

      const imdbId = s.result.imdbID;

      // Fetch full details from OMDb
      let details = null;
      if (!isRateLimited()) {
        details = await getMovieDetails(imdbId, apiKey);
        await sleep(350);
      }

      const cover = poster(s.result.Poster);
      const backdrop = details?.Poster && details.Poster !== 'N/A'
        ? details.Poster.replace(/_V1_[^@.]*(@)?/, '_V1_$1')
        : cover;

      movies.push({
        id: 'netflix-' + imdbId,
        imdbId,
        title: details?.Title || s.result.Title,
        description: details?.Plot || '',
        coverImage: cover,
        backdropImage: backdrop,
        videoUrl: null,
        filePath: null,
        year: parseInt(details?.Year || s.result.Year) || 0,
        rating: parseFloat(details?.imdbRating) || 0,
        duration: details?.Runtime || null,
        genre: details?.Genre || '',
        type: 'movie',
        maturity: details?.Rated || '',
        featured: false,
        local: false,
        director: details?.Director || null,
        actors: details?.Actors || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await sleep(250);
    }

    console.log(`[Netflix Top 10] ${movies.length} movies fetched`);
    cachedMovies = movies;
    cacheTimestamp = Date.now();
  } catch (err) {
    console.error('[Netflix Top 10] Error:', err);
  } finally {
    fetching = false;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const refresh = searchParams.get('refresh') === 'true';

  if (!refresh && cachedMovies && Date.now() - cacheTimestamp < CACHE_TTL) {
    return NextResponse.json(cachedMovies);
  }
  fetchAndCache();
  return NextResponse.json(cachedMovies || []);
}