'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Tv, Folder, Play, Film, Search, ArrowLeft, ChevronUp,
  ArrowUpDown, RefreshCw, X, Maximize, Minimize, AlertTriangle,
  ExternalLink, Copy, Heart, Loader2, Monitor, Settings, MoreVertical,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────

interface FolderItem {
  name: string;
  path: string;
  videoCount: number;
  subFolderCount: number;
  hasCover: boolean;
}

interface VideoItem {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
  extension: string;
}

interface BrowseResult {
  path: string;
  parentPath: string;
  folders: FolderItem[];
  files: VideoItem[];
  totalFiles: number;
  totalFolders: number;
  totalSize: number;
}

// ─── Helpers ─────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function getStreamUrl(item: VideoItem): string {
  const ext = item.extension.toLowerCase();
  const name = item.name.toLowerCase();
  const isHevc = /hevc|h\.?265|x265|10bit/.test(name);

  // Native-playable formats (without HEVC) stream directly
  if (['mp4', 'webm', 'ogv', 'm4v'].includes(ext) && !isHevc) {
    return `/api/series/stream?path=${encodeURIComponent(item.path)}`;
  }
  // Everything else uses the transcode endpoint (existing FFmpeg pipeline)
  return `/api/video/transcode?path=${encodeURIComponent(item.path)}`;
}

// ─── Component ───────────────────────────────────────────────────

export function SeriesPage() {
  // Navigation state
  const [currentPath, setCurrentPath] = useState('');
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [libraryPaths, setLibraryPaths] = useState<string[]>([]);

  // Browse state
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [files, setFiles] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortAsc, setSortAsc] = useState(true);

  // Settings
  const [showSettings, setShowSettings] = useState(false);
  const [newPath, setNewPath] = useState('');

  // Video player
  const [currentVideo, setCurrentVideo] = useState<VideoItem | null>(null);
  const [videoError, setVideoError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);

  // Favorites
  const [favoritePaths, setFavoritePaths] = useState<Set<string>>(new Set());

  // ── Load library paths from config on mount ──
  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then((config) => {
        const paths = (config.seriesFolders || []).filter((f: string) => f.trim());
        setLibraryPaths(paths);
        if (paths.length > 0) {
          setPathHistory([paths[0]]);
          setCurrentPath(paths[0]);
        }
      })
      .catch(() => {});
  }, []);

  // ── Browse filesystem ──
  const loadMedia = useCallback(async () => {
    if (!currentPath) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/series/browse?path=${encodeURIComponent(currentPath)}`);
      if (res.ok) {
        const data: BrowseResult = await res.json();
        setFolders(data.folders || []);
        setFiles(data.files || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [currentPath]);

  useEffect(() => { loadMedia(); }, [loadMedia]);

  // ── Navigation ──
  const navigateTo = (p: string) => {
    setPathHistory(prev => [...prev, p]);
    setCurrentPath(p);
  };

  const goBack = () => {
    if (pathHistory.length > 1) {
      const h = [...pathHistory];
      h.pop();
      setPathHistory(h);
      setCurrentPath(h[h.length - 1]);
    }
  };

  const goUp = () => {
    const parent = currentPath.split(/[/\\]/).slice(0, -1).join('/') || currentPath;
    if (parent !== currentPath) navigateTo(parent);
  };

  const jumpToRoot = (p: string) => {
    setPathHistory([p]);
    setCurrentPath(p);
  };

  // ── Save library paths ──
  const savePaths = async (paths: string[]) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seriesFolders: paths }),
      });
      if (res.ok) {
        setLibraryPaths(paths);
        if (paths.length > 0 && !currentPath) {
          setPathHistory([paths[0]]);
          setCurrentPath(paths[0]);
        }
      }
    } catch { /* ignore */ }
  };

  const addPath = async () => {
    const trimmed = newPath.trim();
    if (!trimmed) return;
    if (libraryPaths.includes(trimmed)) return;
    const updated = [...libraryPaths, trimmed];
    setNewPath('');
    await savePaths(updated);
  };

  const removePath = async (p: string) => {
    const updated = libraryPaths.filter(x => x !== p);
    await savePaths(updated);
    if (updated.length > 0 && !updated.includes(currentPath)) {
      jumpToRoot(updated[0]);
    }
  };

  // ── Video player ──
  const playVideo = (item: VideoItem) => {
    setCurrentVideo(item);
    setVideoError(false);
  };

  const closeVideo = () => {
    if (videoRef.current) videoRef.current.pause();
    setCurrentVideo(null);
    setVideoError(false);
  };

  const toggleFullscreen = () => {
    if (!playerContainerRef.current) return;
    if (!document.fullscreenElement) {
      playerContainerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handleFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const copyDirectLink = (item: VideoItem) => {
    const url = `${window.location.origin}/api/series/stream?path=${encodeURIComponent(item.path)}`;
    navigator.clipboard.writeText(url);
  };

  const openInNewTab = (item: VideoItem) => {
    window.open(`/api/series/stream?path=${encodeURIComponent(item.path)}`, '_blank');
  };

  // ── Favorites (localStorage only, like reference uses DB) ──
  useEffect(() => {
    const saved = localStorage.getItem('series-favorites');
    if (saved) {
      try { setFavoritePaths(new Set(JSON.parse(saved))); } catch { /* ignore */ }
    }
  }, []);

  const toggleFavorite = (folderPath: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setFavoritePaths(prev => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      localStorage.setItem('series-favorites', JSON.stringify([...next]));
      return next;
    });
  };

  // ── Filtering ──
  const isSearching = searchQuery.trim().length > 0;
  const filteredFolders = isSearching
    ? folders.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : folders;
  const sortedFolders = sortAsc
    ? [...filteredFolders].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    : [...filteredFolders].sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' }));
  const filteredFiles = isSearching
    ? files.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : files;
  const sortedFiles = sortAsc
    ? [...filteredFiles]
    : [...filteredFiles].reverse();

  const totalSize = files.reduce((s, f) => s + f.size, 0);

  // ── Display name for video (strip extension) ──
  const displayName = currentVideo ? currentVideo.name.replace(/\.[^.]+$/, '') : '';

  // ── Render ──

  // No library paths configured
  if (libraryPaths.length === 0 && !showSettings) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center px-4 text-center">
        <div className="w-16 h-16 rounded-2xl bg-purple-600/20 flex items-center justify-center mb-4">
          <Tv className="h-8 w-8 text-purple-400" />
        </div>
        <h2 className="text-xl font-semibold text-white mb-2">Sin carpeta de series</h2>
        <p className="text-gray-500 text-sm mb-6 max-w-md">
          Configura la ruta donde tienes tus series para navegarlas directamente desde aquí.
        </p>
        <Button onClick={() => setShowSettings(true)} className="bg-purple-600 hover:bg-purple-700 text-white">
          <Settings className="h-4 w-4 mr-2" /> Configurar carpetas
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh]">
      {/* ── Video Player Overlay ── */}
      {currentVideo && (
        <div ref={playerContainerRef} className="fixed inset-0 z-50 bg-black flex flex-col">
          {/* Player header */}
          <div className="flex items-center justify-between px-4 py-2 bg-black/80 text-white absolute top-0 left-0 right-0 z-10">
            <h3 className="text-sm font-medium truncate">{displayName}</h3>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:text-white/80" title="Copiar enlace" onClick={() => copyDirectLink(currentVideo)}>
                <Copy className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:text-white/80" title="Abrir en nueva pestaña" onClick={() => openInNewTab(currentVideo)}>
                <ExternalLink className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:text-white/80" onClick={toggleFullscreen}>
                {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:text-white/80" onClick={closeVideo}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {videoError ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
              <div className="p-4 rounded-2xl bg-white/10">
                <AlertTriangle className="h-12 w-12 text-amber-400" />
              </div>
              <div className="text-center max-w-md">
                <h3 className="text-lg font-semibold text-white mb-2">Formato no soportado</h3>
                <p className="text-sm text-white/60 mb-1">{currentVideo.name}</p>
                <p className="text-xs text-white/40 mb-6">Abre el enlace directamente con VLC u otro reproductor.</p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                  <Button variant="outline" className="text-white border-white/30 hover:bg-white/10" onClick={() => openInNewTab(currentVideo)}>
                    <ExternalLink className="h-4 w-4 mr-2" />Abrir enlace directo
                  </Button>
                  <Button variant="ghost" className="text-white/60 hover:text-white" onClick={closeVideo}>Cerrar</Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="relative flex-1 flex flex-col">
              <video
                ref={videoRef}
                className="flex-1 w-full object-contain"
                autoPlay
                controls
                playsInline
                onError={() => setVideoError(true)}
                src={getStreamUrl(currentVideo)}
              />
              {/* Skip buttons */}
              <div className="flex items-center justify-end gap-2 px-4 py-2 bg-black/90">
                <Button variant="ghost" size="sm" className="h-8 text-white/70 hover:text-white hover:bg-white/10"
                  onClick={() => { if (videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10); }}>
                  -10s
                </Button>
                <Button variant="ghost" size="sm" className="h-8 text-white/70 hover:text-white hover:bg-white/10"
                  onClick={() => { if (videoRef.current) videoRef.current.currentTime = Math.min(videoRef.current.duration, videoRef.current.currentTime + 10); }}>
                  +10s
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Settings Dialog ── */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#1a1a1a] border border-gray-800 rounded-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Carpetas de Series</h2>
              <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white" onClick={() => setShowSettings(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-2">
              {libraryPaths.map((p) => (
                <div key={p} className="flex items-center gap-2 min-w-0">
                  <Monitor className="h-4 w-4 text-purple-400 flex-shrink-0" />
                  <span className="text-sm flex-1 font-mono truncate min-w-0 text-gray-300" title={p}>{p}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500 hover:text-red-400 flex-shrink-0"
                    onClick={() => removePath(p)} aria-label="Quitar carpeta">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Input
                placeholder="\\192.168.3.2\Canal\TV Shows"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addPath(); }}
                className="flex-1 bg-[#222] border-gray-700 text-white text-sm"
              />
              <Button onClick={addPath} disabled={!newPath.trim()} className="bg-purple-600 hover:bg-purple-700 text-white shrink-0">
                Agregar
              </Button>
            </div>

            <p className="text-xs text-gray-500">
              Agrega las carpetas raíz donde tienes tus series. Cada subcarpeta se mostrará como una serie.
            </p>

            {libraryPaths.length > 0 && (
              <Button onClick={() => { jumpToRoot(libraryPaths[0]); setShowSettings(false); }}
                className="w-full bg-white/10 hover:bg-white/20 text-white border border-gray-700">
                <RefreshCw className="h-4 w-4 mr-2" /> Ir a la primera carpeta
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="px-4 sm:px-6 lg:px-8 max-w-[1400px] mx-auto">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-lg bg-purple-600/20 flex items-center justify-center">
            <Tv className="h-4.5 w-4.5 text-purple-400" />
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-white">Series</h1>
          <div className="flex-1 h-px bg-white/10 ml-2" />
        </div>

        {/* Navigation bar */}
        <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center mb-4">
          <div className="flex items-center gap-1 flex-1 min-w-0 flex-wrap">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-white shrink-0"
              onClick={goBack} disabled={pathHistory.length <= 1}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-white shrink-0"
              onClick={goUp}>
              <ChevronUp className="h-4 w-4" />
            </Button>

            {/* Library path buttons */}
            {libraryPaths.map((p) => (
              <Button
                key={p}
                variant={currentPath === p ? 'secondary' : 'ghost'}
                size="sm"
                className={cn(
                  'h-8 shrink-0 text-xs max-w-[160px]',
                  currentPath === p
                    ? 'bg-purple-600/30 text-purple-300 hover:bg-purple-600/40'
                    : 'text-gray-400 hover:text-white'
                )}
                onClick={() => jumpToRoot(p)}
              >
                <Monitor className="h-3.5 w-3.5 mr-1 shrink-0" />
                <span className="truncate">{p.split(/[/\\]/).pop()}</span>
              </Button>
            ))}

            {/* Current path breadcrumb (if not a root) */}
            {!libraryPaths.includes(currentPath) && currentPath && (
              <>
                <span className="text-gray-600 text-xs">/</span>
                <span className="text-sm font-medium text-gray-300 truncate max-w-[200px]">
                  {currentPath.split(/[/\\]/).pop()}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
              <Input
                placeholder="Buscar..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-8 w-40 sm:w-48 bg-white/5 border-white/10 text-white text-sm"
              />
            </div>
            <Button variant={sortAsc ? 'secondary' : 'outline'} size="icon" className="h-8 w-8 border-white/10 text-gray-400 hover:text-white"
              onClick={() => setSortAsc(!sortAsc)} title={sortAsc ? 'A → Z' : 'Z → A'}>
              <ArrowUpDown className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8 border-white/10 text-gray-400 hover:text-white"
              onClick={() => setShowSettings(true)}>
              <Settings className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8 border-white/10 text-gray-400 hover:text-white"
              onClick={loadMedia}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Stats bar */}
        {!loading && (files.length > 0 || folders.length > 0) && (
          <div className="flex items-center gap-4 text-xs text-gray-500 mb-4 px-1">
            <span className="font-medium text-purple-400">{files.length} videos</span>
            <span>{folders.length} carpetas</span>
            {files.length > 0 && <span>{formatBytes(totalSize)}</span>}
          </div>
        )}
      </div>

      {/* ── Content ── */}
      <div className="px-4 sm:px-6 lg:px-8 max-w-[1400px] mx-auto pb-8">
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="aspect-[2/3] rounded-lg bg-white/5" />
                <Skeleton className="h-4 w-3/4 rounded bg-white/5" />
                <Skeleton className="h-3 w-1/2 rounded bg-white/5" />
              </div>
            ))}
          </div>
        ) : folders.length === 0 && files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Monitor className="h-16 w-16 text-gray-700 mb-4" />
            <h3 className="text-white text-lg font-medium mb-2">No hay videos aquí</h3>
            <p className="text-gray-500 text-sm max-w-md">
              {isSearching
                ? `No se encontró "${searchQuery}"`
                : 'Esta carpeta no contiene videos ni subcarpetas con videos.'}
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Folders grid */}
            {sortedFolders.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-400 mb-3">
                  Carpetas
                  <Badge variant="secondary" className="ml-2 text-xs bg-white/5 text-gray-400 border-none">{sortedFolders.length}</Badge>
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4">
                  {sortedFolders.map((folder) => (
                    <div
                      key={folder.path}
                      className="group cursor-pointer relative"
                      onClick={() => navigateTo(folder.path)}
                    >
                      {/* Card */}
                      <div className="rounded-lg overflow-hidden border border-white/5 group-hover:border-purple-500/30 transition-all duration-300 hover:shadow-lg hover:shadow-purple-900/20 hover:-translate-y-1">
                        {/* Cover / Folder icon */}
                        <div className="aspect-[2/3] relative bg-gradient-to-br from-[#1a1a2e] to-[#16213e] overflow-hidden">
                          {folder.hasCover ? (
                            <img
                              src={`/api/series/cover?path=${encodeURIComponent(folder.path)}`}
                              alt={folder.name}
                              className="absolute inset-0 w-full h-full object-cover"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center gap-3">
                              <Folder className="h-12 w-12 text-purple-400/40" />
                              <Tv className="h-6 w-6 text-purple-400/30" />
                            </div>
                          )}

                          {/* Play overlay */}
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center">
                            <div className="w-14 h-14 rounded-full bg-purple-600/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all scale-75 group-hover:scale-100">
                              <Play className="h-7 w-7 text-white ml-1" />
                            </div>
                          </div>

                          {/* Heart button */}
                          <button
                            className={cn(
                              'absolute top-2 left-2 z-10 p-1.5 rounded-full bg-black/50 backdrop-blur-sm transition-colors',
                              favoritePaths.has(folder.path)
                                ? 'text-rose-500'
                                : 'text-white/40 hover:text-rose-400'
                            )}
                            onClick={(e) => toggleFavorite(folder.path, e)}
                          >
                            <Heart className={cn('h-4 w-4', favoritePaths.has(folder.path) && 'fill-rose-500')} />
                          </button>

                          {/* Count badge */}
                          <div className="absolute top-2 right-2">
                            {folder.videoCount > 0 ? (
                              <Badge className="text-[10px] bg-purple-600/80 text-white border-none backdrop-blur-sm flex items-center gap-1">
                                <Play className="h-2.5 w-2.5" />
                                {folder.videoCount}
                              </Badge>
                            ) : folder.subFolderCount > 0 ? (
                              <Badge className="text-[10px] bg-amber-600/80 text-white border-none backdrop-blur-sm flex items-center gap-1">
                                <Folder className="h-2.5 w-2.5" />
                                {folder.subFolderCount}
                              </Badge>
                            ) : null}
                          </div>
                        </div>

                        {/* Name */}
                        <div className="p-3 bg-[#141414]">
                          <p className="text-sm font-medium text-white truncate">{folder.name}</p>
                          <p className="text-xs text-gray-500">
                            {folder.videoCount > 0
                              ? `${folder.videoCount} video${folder.videoCount !== 1 ? 's' : ''}`
                              : folder.subFolderCount > 0
                                ? `${folder.subFolderCount} subcarpeta${folder.subFolderCount !== 1 ? 's' : ''}`
                                : 'Vacío'}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Video files grid */}
            {sortedFiles.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-400 mb-3">
                  Videos
                  <Badge variant="secondary" className="ml-2 text-xs bg-white/5 text-gray-400 border-none">{sortedFiles.length}</Badge>
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {sortedFiles.map((file) => (
                    <div
                      key={file.path}
                      className="group cursor-pointer relative"
                      onClick={() => playVideo(file)}
                    >
                      <div className="rounded-lg overflow-hidden border border-white/5 group-hover:border-purple-500/30 transition-all duration-300 hover:shadow-lg hover:shadow-purple-900/20 hover:-translate-y-1">
                        {/* Thumbnail area */}
                        <div className="relative aspect-video bg-gradient-to-br from-[#1a1a2e] to-[#0f0f1a] flex items-center justify-center">
                          <Film className="h-12 w-12 text-white/10 group-hover:text-white/20 transition-colors" />

                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center">
                            <div className="w-12 h-12 rounded-full bg-purple-600/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all scale-75 group-hover:scale-100">
                              <Play className="h-6 w-6 text-white ml-0.5" />
                            </div>
                          </div>

                          {/* Extension badge */}
                          <Badge className="absolute top-2 right-2 text-[10px] bg-black/60 text-gray-300 border-none">
                            {file.extension.toUpperCase()}
                          </Badge>

                          {/* Action buttons */}
                          <div className="absolute top-2 left-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                            <button
                              className="p-1 rounded-full bg-black/50 backdrop-blur-sm text-white/60 hover:text-white"
                              onClick={(e) => { e.stopPropagation(); copyDirectLink(file); }}
                              title="Copiar enlace"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* File info */}
                        <div className="p-3 bg-[#141414]">
                          <h4 className="text-sm font-medium text-white truncate">{file.name.replace(/\.[^.]+$/, '')}</h4>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-xs text-gray-500">{formatBytes(file.size)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}