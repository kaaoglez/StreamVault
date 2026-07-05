import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { db } from '@/lib/db';

const THUMBNAIL_DIR = path.join(process.cwd(), 'db', 'thumbnails');

// Ensure thumbnails dir exists
fs.mkdir(THUMBNAIL_DIR, { recursive: true }).catch(() => {});

export async function GET(request: NextRequest) {
  const episodeId = request.nextUrl.searchParams.get('id');

  if (!episodeId) {
    return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  }

  try {
    // Find episode in DB
    const episode = await db.episode.findUnique({
      where: { id: episodeId },
      select: {
        id: true,
        filePath: true,
        videoUrl: true,
        seriesId: true,
        seasonNumber: true,
        episodeNumber: true,
      },
    });

    if (!episode) {
      return NextResponse.json({ error: 'Episodio no encontrado' }, { status: 404 });
    }

    // Check cache first
    const cachedPath = path.join(THUMBNAIL_DIR, `${episodeId}.jpg`);
    try {
      const stat = await fs.stat(cachedPath);
      if (stat.size > 500) {
        // Return cached image
        const imageBuffer = await fs.readFile(cachedPath);
        return new NextResponse(imageBuffer, {
          headers: {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'public, max-age=604800, immutable',
            'Content-Length': String(imageBuffer.length),
          },
        });
      }
    } catch {
      // No cache, continue to extract
    }

    // Need a file path to extract from
    const videoPath = episode.filePath || null;
    if (!videoPath) {
      // No local file — return a transparent 1px placeholder so the card
      // falls back to the gradient/Play icon in the UI
      return new NextResponse(
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          'base64'
        ),
        {
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'no-cache',
          },
        }
      );
    }

    // Verify file exists
    try {
      await fs.access(videoPath);
    } catch {
      return NextResponse.json({ error: 'Archivo no encontrado' }, { status: 404 });
    }

    // Get video duration first to pick a frame at ~15%
    const duration = await getVideoDuration(videoPath);
    const seekTime = Math.max(1, (duration || 30) * 0.15);

    // Extract frame with ffmpeg — 480px wide, high quality JPEG
    await extractFrame(videoPath, cachedPath, seekTime);

    // Verify the extracted frame
    try {
      const stat = await fs.stat(cachedPath);
      if (stat.size < 500) {
        // ffmpeg produced a bad frame, try a different timestamp
        const fallbackTime = Math.max(1, (duration || 30) * 0.4);
        await extractFrame(videoPath, cachedPath, fallbackTime);
      }
    } catch {
      return NextResponse.json({ error: 'Error al extraer frame' }, { status: 500 });
    }

    // Return the extracted frame
    const imageBuffer = await fs.readFile(cachedPath);
    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=604800, immutable',
        'Content-Length': String(imageBuffer.length),
      },
    });
  } catch (error) {
    console.error('[episode-frame]', error);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

function getVideoDuration(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(
      'ffprobe',
      [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath,
      ],
      { timeout: 10000 },
      (error, stdout) => {
        if (error || !stdout) {
          resolve(null);
          return;
        }
        const dur = parseFloat(stdout.trim());
        resolve(isNaN(dur) ? null : dur);
      }
    );
  });
}

function extractFrame(
  inputPath: string,
  outputPath: string,
  seekSeconds: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'ffmpeg',
      [
        '-ss', seekSeconds.toFixed(2),
        '-i', inputPath,
        '-frames:v', '1',
        '-vf', 'scale=640:-2',
        '-q:v', '3',
        '-y',
        outputPath,
      ],
      { timeout: 15000 },
      (error) => {
        if (error) reject(error);
        else resolve();
      }
    );
  });
}