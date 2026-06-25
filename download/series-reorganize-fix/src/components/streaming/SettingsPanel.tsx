'use client';

import { useState, useEffect, useCallback } from 'react';
import { Settings, Key, Scan, Check, Loader2, ExternalLink, Plus, Film, Tv, Trash2, AlertTriangle, FlaskConical, FolderSync } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ScanProgress {
  phase: string;
  current: number;
  total: number;
  title: string;
  message: string;
  found?: number;
  matched?: number;
  failed?: number;
  errors?: string[];
  rateLimited?: boolean;
}

interface AppConfig {
  moviesFolders: string[];
  seriesFolders: string[];
  omdbApiKey: string;
}

export function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const [moviesFolders, setMoviesFolders] = useState<string[]>(['']);
  const [seriesFolders, setSeriesFolders] = useState<string[]>(['']);
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [error, setError] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [ffmpegOk, setFfmpegOk] = useState<boolean | null>(null);
  const [reorganizing, setReorganizing] = useState(false);
  const [reorgResult, setReorgResult] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch('/api/settings')
      .then(r => r.json())
      .then((config: AppConfig) => {
        setMoviesFolders(config.moviesFolders?.length ? config.moviesFolders : ['']);
        setSeriesFolders(config.seriesFolders?.length ? config.seriesFolders : ['']);
        setApiKey(config.omdbApiKey || '');
        setFfmpegOk(config.ffmpegAvailable ? true : (config.ffmpegAvailable === false ? false : null));
      })
      .catch(() => {});
  }, [open]);

  const updateFolder = (type: 'movies' | 'series', index: number, value: string) => {
    const set = type === 'movies' ? setMoviesFolders : setSeriesFolders;
    set(prev => { const next = [...prev]; next[index] = value; return next; });
  };

  const addFolder = (type: 'movies' | 'series') => {
    const set = type === 'movies' ? setMoviesFolders : setSeriesFolders;
    set(prev => [...prev, '']);
  };

  const removeFolder = (type: 'movies' | 'series', index: number) => {
    const set = type === 'movies' ? setMoviesFolders : setSeriesFolders;
    set(prev => { if (prev.length <= 1) return ['']; return prev.filter((_, i) => i !== index); });
  };

  const saveSettings = useCallback(async () => {
    try {
      const cleanMovies = moviesFolders.filter(f => f.trim());
      const cleanSeries = seriesFolders.filter(f => f.trim());
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moviesFolders: cleanMovies, seriesFolders: cleanSeries, omdbApiKey: apiKey }),
      });
      if (res.ok) { setSaved(true); setError(''); setTimeout(() => setSaved(false), 2000); }
    } catch { setError('Error al guardar'); }
  }, [moviesFolders, seriesFolders, apiKey]);

  const cleanDatabase = useCallback(async () => {
    if (!confirm('¿Borrar todos los datos importados? Esto elimina películas, series y episodios de la base de datos.')) return;
    setCleaning(true);
    try {
      const res = await fetch('/api/scan', { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        setScanProgress(null);
        setError('');
      } else {
        setError(data.error || 'Error al limpiar');
      }
    } catch { setError('Error de conexión'); }
    setCleaning(false);
  }, []);

  const testApiKey = useCallback(async () => {
    if (!apiKey.trim()) { setTestResult({ ok: false, msg: 'Pega tu API key primero' }); return; }
    setTestingKey(true); setTestResult(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ omdbApiKey: apiKey.trim() }),
      });
      const data = await res.json();
      setTestResult({ ok: data.success, msg: data.message });
    } catch { setTestResult({ ok: false, msg: 'Error de conexión' }); }
    setTestingKey(false);
  }, [apiKey]);

  const reorganizeSeries = useCallback(async () => {
    setReorganizing(true); setReorgResult(null); setError('');
    try {
      const res = await fetch('/api/scan', { method: 'PATCH' });
      const data = await res.json();
      if (data.success) {
        let msg = data.message;
        if (data.summary) msg += '\n\n' + data.summary;
        if (data.diagnostics && data.diagnostics.length > 0) {
          msg += '\n\n--- Diagnóstico ---\n' + data.diagnostics.join('\n');
        }
        setReorgResult(msg);
        window.dispatchEvent(new CustomEvent('series-changed'));
        window.dispatchEvent(new CustomEvent('favorites-changed'));
      } else {
        let msg = data.message || 'Error al reorganizar';
        if (data.diagnostics && data.diagnostics.length > 0) {
          msg += '\n\n--- Diagnóstico ---\n' + data.diagnostics.join('\n');
        }
        setError(msg);
      }
    } catch { setError('Error de conexión'); }
    setReorganizing(false);
  }, []);

  const startScan = useCallback(async () => {
    const hasMovies = moviesFolders.some(f => f.trim());
    const hasSeries = seriesFolders.some(f => f.trim());
    if (!hasMovies && !hasSeries) { setError('Agrega al menos una carpeta'); return; }
    if (!apiKey) { setError('Configura la API key de OMDB primero'); return; }

    setScanning(true); setError(''); setScanProgress(null); setShowErrors(false);

    await saveSettings();

    try {
      const res = await fetch('/api/scan', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Error al iniciar escaneo'); setScanning(false); return; }

      const poll = setInterval(async () => {
        try {
          const pRes = await fetch('/api/scan');
          const pData = await pRes.json();
          if (pData.progress) {
            setScanProgress(pData.progress);
            if (pData.progress.phase === 'done' || pData.progress.phase === 'error') {
              clearInterval(poll); setScanning(false);
            }
          }
          if (!pData.scanning) { clearInterval(poll); setScanning(false); }
        } catch { clearInterval(poll); setScanning(false); }
      }, 1000);
    } catch { setError('Error de conexión'); setScanning(false); }
  }, [moviesFolders, seriesFolders, apiKey, saveSettings]);

  const progressPercent = scanProgress && scanProgress.total > 0
    ? Math.round((scanProgress.current / scanProgress.total) * 100) : 0;

  const isDone = scanProgress?.phase === 'done' || scanProgress?.phase === 'error';

  const renderFolderList = (type: 'movies' | 'series') => {
    const folders = type === 'movies' ? moviesFolders : seriesFolders;
    const label = type === 'movies' ? 'Peliculas' : 'Series';
    const Icon = type === 'movies' ? Film : Tv;
    const placeholder = type === 'movies' ? 'D:\\Peliculas' : 'D:\\Series';

    return (
      <div className="space-y-2">
        <label className="text-gray-300 flex items-center gap-2 text-sm font-medium">
          <Icon className="h-4 w-4" /> Carpetas de {label}
        </label>
        <p className="text-xs text-gray-500">
          Puedes agregar varias carpetas en diferentes unidades
        </p>
        <div className="space-y-2">
          {folders.map((folder, idx) => (
            <div key={idx} className="flex gap-2">
              <Input value={folder} onChange={(e) => updateFolder(type, idx, e.target.value)}
                placeholder={placeholder} className="flex-1 bg-[#222] border-gray-700 text-white text-sm" />
              {folders.length > 1 && (
                <Button variant="ghost" size="icon" onClick={() => removeFolder(type, idx)}
                  className="text-gray-500 hover:text-red-400 shrink-0" aria-label="Quitar carpeta">
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={() => addFolder(type)}
          className="text-gray-400 hover:text-white text-xs gap-1">
          <Plus className="h-3.5 w-3.5" /> Agregar otra carpeta
        </Button>
      </div>
    );
  };

  return (
    <>
      <Button variant="ghost" size="icon" onClick={() => setOpen(true)}
        className="text-gray-400 hover:text-white" aria-label="Configuración">
        <Settings className="h-5 w-5" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#1a1a1a] border-gray-800 sm:max-w-lg p-0 gap-0 h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="p-5 pb-0 shrink-0">
            <DialogTitle className="text-lg font-semibold text-white">Configuración</DialogTitle>
            <DialogDescription className="sr-only">
              Configuración de carpetas, API key y escaneo de medios
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 min-h-0">
            <div className="p-5 space-y-6">
              {renderFolderList('movies')}
              {renderFolderList('series')}

              <div className="space-y-2">
                <label className="text-gray-300 flex items-center gap-2 text-sm font-medium">
                  <Key className="h-4 w-4" /> OMDB API Key
                </label>
                <p className="text-xs text-gray-500">Gratis, solo necesitas un email:</p>
                <a href="https://www.omdbapi.com/apikey.aspx" target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-[#e50914] hover:underline">
                  omdbapi.com/apikey.aspx <ExternalLink className="h-3 w-3" />
                </a>
                <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                  placeholder="ej: abc123def" type="password" className="bg-[#222] border-gray-700 text-white" />
                <Button onClick={testApiKey} disabled={testingKey} variant="outline"
                  className="w-full border-gray-700 text-gray-300 hover:bg-white/10 hover:text-white disabled:opacity-50 text-sm">
                  {testingKey
                    ? <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> Probando...</>
                    : <><FlaskConical className="h-3.5 w-3.5 mr-2" /> Probar API Key</>}
                </Button>
                {testResult && (
                  <p className={`text-xs ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}>
                    {testResult.msg}
                  </p>
                )}
              </div>

              {/* FFmpeg status */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-[#222] border border-gray-800">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${ffmpegOk === true ? 'bg-green-400' : ffmpegOk === false ? 'bg-red-400' : 'bg-gray-500'}`} />
                  <span className="text-gray-300 text-sm">FFmpeg (transcodificación MKV/AVI)</span>
                </div>
                {ffmpegOk === false && (
                  <a
                    href="https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[#e50914] hover:underline"
                  >
                    Descargar
                  </a>
                )}
                {ffmpegOk === true && (
                  <span className="text-xs text-green-400">Instalado</span>
                )}
              </div>

              <Button onClick={saveSettings}
                className="w-full bg-[#e50914] hover:bg-[#c40812] text-white">
                {saved ? <><Check className="h-4 w-4 mr-2" /> Guardado</> : 'Guardar Configuración'}
              </Button>

              <div className="border-t border-gray-800" />

              {/* Scan */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-white">Escanear Carpetas</h3>

                <Button onClick={startScan} disabled={scanning}
                  className="w-full bg-white/10 hover:bg-white/20 text-white border border-gray-700 disabled:opacity-50">
                  {scanning
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Escaneando...</>
                    : <><Scan className="h-4 w-4 mr-2" /> Escanear e Importar Todo</>}
                </Button>

                {/* Progress */}
                {scanProgress && scanProgress.total > 0 && !isDone && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs text-gray-400">
                      <span className="truncate max-w-[250px]">{scanProgress.message}</span>
                      <span>{progressPercent}%</span>
                    </div>
                    <div className="w-full h-2 bg-[#333] rounded-full overflow-hidden">
                      <div className="h-full bg-[#e50914] rounded-full transition-all duration-500"
                        style={{ width: `${progressPercent}%` }} />
                    </div>
                  </div>
                )}

                {/* Results */}
                {isDone && (
                  <div className="space-y-2">
                    {scanProgress?.rateLimited && (
                      <div className="bg-yellow-900/30 border border-yellow-800/50 rounded-lg p-3 text-xs text-yellow-300">
                        OMDB gratis permite 1000 peticiones/día. Ya se crearon los registros con los archivos encontrados.
                        Vuelve a escanear mañana para completar los datos faltantes (no duplica).
                      </div>
                    )}
                    <p className={scanProgress?.phase === 'error' ? 'text-sm text-red-400' : 'text-sm text-green-400'}>
                      {scanProgress?.message}
                    </p>
                    {scanProgress && (scanProgress.found ?? 0) > 0 && (
                      <div className="flex gap-4 text-xs text-gray-400">
                        <span>Encontrados: <strong className="text-white">{scanProgress.found}</strong></span>
                        <span>Con datos: <strong className="text-green-400">{scanProgress.matched}</strong></span>
                        <span>Sin coincidencia: <strong className="text-yellow-400">{scanProgress.failed}</strong></span>
                      </div>
                    )}
                    {scanProgress?.errors && scanProgress.errors.length > 0 && (
                      <div>
                        <button onClick={() => setShowErrors(!showErrors)}
                          className="text-xs text-yellow-400 hover:underline flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          {showErrors ? 'Ocultar errores' : `Ver ${scanProgress.errors.length} errores`}
                        </button>
                        {showErrors && (
                          <div className="mt-2 max-h-60 overflow-y-auto space-y-1">
                            {scanProgress.errors.map((err, i) => (
                              <p key={i} className="text-xs text-yellow-300/70">{err}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="border-t border-gray-800" />

              {/* Reorganize series by folder structure */}
              <div className="space-y-2">
                <Button onClick={reorganizeSeries} disabled={reorganizing || scanning}
                  variant="outline"
                  className="w-full border-blue-900/50 text-blue-400 hover:bg-blue-900/20 hover:text-blue-300 disabled:opacity-50">
                  {reorganizing
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Reorganizando...</>
                    : <><FolderSync className="h-4 w-4 mr-2" /> Reorganizar Series por Carpetas</>}
                </Button>
                <p className="text-xs text-gray-500 text-center">Reordena episodios y fusiona series usando la estructura de carpetas. Sin llamadas a OMDB.</p>
                {reorgResult && (
                  <pre className="text-xs text-green-400 whitespace-pre-wrap break-all max-h-48 overflow-y-auto bg-black/30 rounded p-2">{reorgResult}</pre>
                )}
              </div>

              <div className="border-t border-gray-800" />

              {/* Clean DB */}
              <div className="space-y-2">
                <Button onClick={cleanDatabase} disabled={cleaning || scanning}
                  variant="outline"
                  className="w-full border-red-900/50 text-red-400 hover:bg-red-900/20 hover:text-red-300 disabled:opacity-50">
                  {cleaning
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Limpiando...</>
                    : <><Trash2 className="h-4 w-4 mr-2" /> Limpiar Base de Datos</>}
                </Button>
                <p className="text-xs text-gray-600 text-center">Borra todas las películas/series importadas y empieza de cero</p>
              </div>

              {error && <pre className="text-xs text-red-400 whitespace-pre-wrap break-all max-h-60 overflow-y-auto">{error}</pre>}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}