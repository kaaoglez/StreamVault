# StreamVault v3.0 — Descarga

## Archivo
`StreamVault-v3.0.0.zip`

## ✅ CERO API keys, CERO registros, CERO configuración extra

## Instrucciones (Windows)

### Requisitos
- **Node.js 18+** (https://nodejs.org)
- **VS Code** (recomendado)

### Pasos

1. **Extraer** el ZIP
2. **Abrir terminal** en la carpeta `streamvault`
3. `npm install`
4. `npx prisma db push`
5. `npx prisma generate`
6. `npm run dev`
7. Abrir **http://localhost:3000**
8. En **otra terminal**: `npm run db:seed`
9. **Refrescar** el navegador

## Contenido Real

| Tipo | Cantidad | Detalle |
|------|----------|---------|
| Películas | 16 | Inception, Dark Knight, Godfather, Matrix, Dune... |
| Series | 6 | Breaking Bad, GoT, Naruto, Stranger Things, The Boys, TLoU |
| Episodios | 44 | Con títulos y descripciones reales |
| Posters | 22 | Imágenes reales desde TMDB CDN |

## Player HTML5 (estilo dulo.tv)
- ✅ Play/Pausa, volumen, fullscreen
- ✅ Barra de progreso interactiva
- ✅ **"Siguiente Episodio" automático** con countdown 10s
- ✅ Lista de episodios lateral
- ✅ Atajos: Espacio, ← → ↑ ↓, F, M, Esc

## Agregar Videos Propios
1. Poner archivos .mp4 en `public/videos/`
2. Actualizar `videoUrl` en la base de datos
3. El player los reproduce automáticamente