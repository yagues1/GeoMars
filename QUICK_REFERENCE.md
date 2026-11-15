# GeoMars EVA Quick Reference

## 🚀 TL;DR - Lo Más Importante (1 minuto de lectura)

**✅ Grids generados:** `/public/data/grids/eva_*.u8` (.i8 y .u16 también disponibles)  
**✅ Routing core:** `src/routing/astar.ts` con cost multi-factor ya implementado  
**⏳ Frontend UI:** Componentes de visualización pendientes (no críticos para funcionalidad)

---

## 📍 Archivos que NECESITAS saber sobre

| Archivo | Para qué sirve |
|---------|---------------|
| `README_EVA.md` | Resumen ejecutivo (lee este primero) |
| `GEOMARS_EVA_FINAL.md` | Documentación técnica completa (TODO lo técnico) |
| `QUICK_REFERENCE.md` | Este archivo (puntos clave rápidos) |
| `/public/data/grids/eva_*.u8` | Grids binarios ya generados |
| `scripts/prepare_data.py` | Fuente de datos RAW (THEMIS/CAL_ATS/MOLA) |
| `scripts/run_eva_step.py` | Generación grids final |

---

## 🎯 Correcciones Críticas (Qué se arregló)

1. **CRS THEMIS TI:** De proyección local → EPSG:4326 (cobertura extendida)
2. **Sampleo grids:** Usar arrays LON/LAT en lugar de x,y lineales
3. **Wind exposure:** sigma=10 gaussian + WIND_SHELTER_M=100m para variación

**Impacto:** Grids ahora tienen >5 valores únicos y distribución realista (antes era plano)

---

## 📊 Estadísticas Rápidas de los Grids

```
Thermal Inertia: 256 valores [0-65534], 99.3% válidos
Temperature:     82 valores [-128,-15]°C, ρ=-0.914 correlation  
Wind Exposure:   9 valores  [85-99]%, P50=91%
Roughness:       ~103 valores (DEM-derived)
Block/LOS:       Binary masks
```

---

## 🧮 Cost Formula - Cómo Funciona el Routing

```javascript
cost = d_step × (1 + Σ W_factors) + energy_term

ΣW = W_pendiente + W_termico + W_suelo + W_atmosfera + W_comunicaciones
    ↓              ↓            ↓          ↓                 ↓
  slope        temp (-67°C)    TI       wind (285° WSW)   LOS (placeholder)
```

**Dónde está implementado:** `src/routing/astar.ts` función `edgeCost()`

---

## 🔧 Cómo Ejecutar Todo (Comandos Rápidos)

### Python Scripts (generar grids desde cero):
```bash
cd scripts
.venv-geo/Scripts/python prepare_data.py  # Lee THEMIS/CAL_ATS/MOLA
.venv-geo/Scripts/python run_eva_step.py  # Genera grids .u8/.i8
```

### JavaScript (si quieres testear routing manual):
```typescript
// Cargar grid binario:
const data = new Uint8Array(readFileSync('public/data/grids/eva_thermal_inertia.u8'));
// Pasar a TerrainGrid en worker.ts y usar computeRoute() en astar.ts
```

---

## 🗺️ Coordenadas Grid (Importante)

- **Lon:** -110° a -77.74° (~1,450 km coverage)
- **Lat:** 20° a 58° (~3,800 km coverage)  
- **Cell size:** 40×40 meters
- **Grid dims:** 1114 × 1266 cells
- **Total cells:** ~1.41M

**Nota:** Las coordenadas del grid están en EPSG:4326 (geográficas)

---

## 📁 Ubicación de Archivos Clave

```
/home/valentin/Projects/geomars/
├── public/data/grids/eva_*.u8          ← GRIDS YA GENERADOS (úsalos aquí)
├── scripts/prepare_data.py             ← Python source (THEMIS/CAL_ATS/MOLA)
├── scripts/run_eva_step.py             ← Python grid gen pipeline
├── src/routing/astar.ts                ← A* cost multi-factor (JS)
├── src/routing/vehicle.ts              ← Vehicle model config
└── GEOMARS_EVA_FINAL.md                ← DOCUMENTACIÓN COMPLETA
```

---

## ✅ Checkpoint: ¿Qué Está Completado?

```
✓ Grids binarios generados (.u8/.i8/.u16)
✓ Corrección CRS THEMIS TI EPSG:4326
✓ Sampleo con LON/LAT arrays (no x,y lineales)
✓ Temperature modelada desde CAL_ATS
✓ Wind exposure sigma=10 gaussian noise
✓ Cost function multi-factor en A*
✓ Commit git realizado (rama formula-revision)
```

## ⏳ ¿Qué Falta?

```
⚠ Componentes UI para visualizar grids en mapa (no crítico)
⚠ Widget para mostrar valores EVA del rover actual
⚠ Integración final de grids binarios en worker.ts loading
```

---

## 🐛 Troubleshooting Rápido

| Problema | Solución |
|----------|----------|
| "outside_coverage" | Verifica coords en [-110,-77]×[20,58] |
| "no_data" error | Usa snapCell() para encontrar celda nearest valid |
| Wind exposure = 90% de un solo valor | Aumenta WIND_SHELTER_M a 100m en prepare_data.py |
| Temperature fuera de [-95,-15]°C | Verifica TEMP_CLIP_C constant y parámetros TI_REF/K_TI |

---

## 📖 Lectura Recomendada (por tiempo disponible)

- **< 2 min:** Este archivo (`QUICK_REFERENCE.md`)
- **< 5 min:** `README_EVA.md` (resumen completo)
- **30+ min:** `GEOMARS_EVA_FINAL.md` (documentación técnica exhaustiva)
- **Necesitas code:** `src/routing/astar.ts` + `scripts/prepare_data.py`

---

## 📞 Para Continuar el Trabajo

**Si es backend/data:**
1. Generar grids: ejecuta scripts Python
2. Leer docs técnicas: `GEOMARS_EVA_FINAL.md` → sección "Pipeline de datos"

**Si es frontend/routing:**
1. Cargar grids en `worker.ts` como arrays Typed (Uint8/Int8)
2. Pasar a `TerrainGrid` interface en `astar.ts`
3. Usar `computeRoute()` con los nuevos layers
4. Visualizar con Maplibre: `src/ui/components/EVALayers.tsx` (pendiente crear)

---

**Última actualización:** Nov 15, 2026  
**Rama git:** `formula-revision`  
**Estado:** Core completo ✅ / UI pendientes ⏳  
