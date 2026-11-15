# HANDOFF — Motor de Rutas EVA (GeoMars, rama `formula-revision`)

> Documento de traspaso para que otra IA retome y termine el trabajo. Estado verificado con
> `git status` + `grep -n` el 14/11/2026. Todo lo que sigue es real y comprobable en disco;
> lo marcado **PENDIENTE** no está hecho. Leer también las skills del repo:
> `.claude/skills/geomars-planetary-data/`, `.claude/skills/geomars-surface-routing/`,
> `.claude/skills/geomars-raster-terrain/`.

---

## 0. Verificación inicial (antes de tocar nada)

```bash
git branch --show-current        # debe ser formula-revision
git status --short               # esperado ahora:
#  M scripts/prepare_data.py
# ?? scripts/fetch_eva_data.py
# ?? public/data/grids/eva_block.u8  eva_constants.json eva_ice.u8 eva_los.u8
#    eva_magnetic.u16 eva_roughness.u8 eva_temp.i8 eva_thermal_inertia.u16 eva_wind.u8
npm test                         # 17 tests verdes en dfb8193f (V1.1) — baseline
```

- Repo privado `yagues1/GeoMars`, `gh` autenticado como `va-lentino`. Node v26.13.1, npm 12.2.2.
- **`npm audit` → 1 crítico en `maplibre-gl <=6.4.0`: NO auto-fixear, decisión pendiente del usuario.**
- Dev server (`npm run dev`, puerto 5180) fue **cancelado por un restart** → relanzar cuando haga falta.
- Spec original del usuario: está embebida en §2 de este documento. Fuente primaria (por si acaso):
  `sqlite3 /home/valen/.local/share/opencode/opencode.db "SELECT data FROM session_message WHERE length(data)=5197 AND data LIKE '%Especificaci%';"` → JSON, campo `text`.

---

## 1. Objetivo

En rama `formula-revision`, implementar la "EVA Route Engine": 4 capas estáticas de datos NASA
preprocesadas + fórmula de coste A* `Coste = d_paso·(1 + ΣW)` + restricciones duras nuevas +
telemetría de ruta (O₂, batería, anomalía magnética, radio de visibilidad), con UI en el navegador.
100 % preprocesado en `scripts/prepare_data.py` antes de arrancar el servidor (nada de descargas en runtime).

Estado global: **Fase 0 (datos) ✅ · Fase 1 (pipeline Python) ~90 % (2 patches) · Fases 2–6 (TS/UI/verif) ⬜ 0 %.**

---

## 2. Especificación original del usuario (verbatim)

```markdown
# Especificación Técnica del Motor de Rutas EVA (100 % Estático / Preprocesado)

Implementa el cálculo de rutas seguras (algoritmo A* sobre cuadrícula 2D) y telemetría de riesgo
cruzando estas 4 capas estáticas de datos de la NASA, todas preprocesadas una sola vez en
`preprocess.py` antes de arrancar el servidor:

## 1. Parámetros de Entrada Preprocesados (100 % Estáticos)

### A. Topografía (Fuente: HiRISE DEM / Slope)
- `elevation_m` (float): Altitud en metros respecto al nivel de referencia marciano.
- `slope_deg` (float): Pendiente local en grados (0° a 90°), precalculada mediante el gradiente de `elevation_m`.
- `terrain_roughness` (float): Desviación estándar de altura en un entorno de 3x3 celdas (mide la densidad de rocas y obstáculos).
- `line_of_sight_habitat` (bool): Matriz booleana precalculada (`True` / `False`) que indica si hay contacto visual directo por radio entre la antena del casco del astronauta (1.8 m) y la antena del hábitat.

### B. Térmica (Fuente: Mars Odyssey THEMIS)
- `surface_temp_c` (float): Temperatura media del suelo en °C para la ventana horaria de la misión (desde -15 °C al sol hasta -95 °C en sombras permanentes).
- `thermal_inertia` (float): Capacidad del suelo para retener calor, medida en J m^-2 K^-1 s^-1/2.
  - Valores bajos (< 150): Polvo fino o arena suelta (riesgo de atasco y mayor esfuerzo al caminar).
  - Valores altos (> 350): Roca sólida expuesta (terreno firme para caminar y óptimo para recoger muestras).

### C. Geofísica (Fuente: MGS Crustal Magnetic Field / SHARAD)
- `magnetic_field_nt` (float): Intensidad del magnetismo local en las rocas de la corteza, medida en nanoteslas (nT).
- `subsurface_ice_flag` (bool): Marca booleana (`True` / `False`) en los puntos donde el radar detecta capas subsuperficiales de interés científico.

### D. Atmósfera (Fuente: Climatología fija MEDA/REMS + TES + Relieve)
- `dust_opacity_tau` (float): Valor constante de opacidad óptica del polvo correspondiente a la estación de la misión (ej. `0.48`).
- `prevailing_wind_ms` (float) y `prevailing_wind_deg` (float): Velocidad media en m/s (ej. `4.5`) y dirección dominante en grados (ej. `315`) fijas de la zona.
- `wind_exposure_factor` (matriz 2D): Valores precalculados entre `0.0` (zona resguardada tras cráteres o escarpes) y `1.0` (crestas o cañones expuestos de lleno al viento predominante), cruzando el DEM con `prevailing_wind_deg`.
- `air_temp_c` (float), `pressure_pa` (float) y `uv_radiation_wm2` (float): Valores ambientales constantes para la ficha de telemetría.

## 2. Reglas de Seguridad y Restricciones Duras (Coste = Infinito)
En el preprocesado, cualquier celda `(x, y)` que cumpla alguna de estas tres condiciones queda bloqueada como intransitable (`Coste = np.inf`):
1. `slope_deg > 20.0` (límite físico de estabilidad con traje presurizado).
2. `surface_temp_c < -85.0` (riesgo crítico para las juntas mecánicas del traje y las baterías).
3. `terrain_roughness > umbral_rocas` (campo de bloques infranqueable a pie).

## 3. Fórmula de Coste de Paso para el Algoritmo A*
`Coste(x, y) = d_paso * (1 + W_pendiente + W_termico + W_suelo + W_atmosfera + W_comunicaciones)`
- `d_paso`: Distancia en metros entre celdas (`1.0` ortogonal, `1.414` diagonal).
- `W_pendiente`: subida (`delta_z > 0`): `((slope_deg / 20.0) ** 2) * 2.5`; bajada (`delta_z <= 0`): `((slope_deg / 20.0) ** 2) * 1.2`
- `W_termico`: si `surface_temp_c < -40.0`: `(abs(-40.0 - surface_temp_c) / 45.0) * 1.5` (si no, 0.0).
- `W_suelo`: si `thermal_inertia < 200.0`: `((200.0 - thermal_inertia) / 200.0) * 1.8` (si no, 0.0).
- `W_atmosfera`: `0.05 * prevailing_wind_ms * wind_exposure_factor[x, y] * max(0.0, cos(theta_mov - prevailing_wind_deg))`
- `W_comunicaciones`: si `line_of_sight_habitat == False`: `0.8` (si True, 0.0).

## 4. Cálculo de Consumo Vital y Alertas Estáticas de Ruta
- **`estimated_o2_cost_pct`:** Suma acumulada de `d_paso * (1 + W_pendiente + W_suelo + W_atmosfera)` escalada a la capacidad del tanque del traje.
- **`estimated_battery_cost_pct`:** duración total estimada de la caminata + gasto extra de calefacción donde `surface_temp_c < -40.0`.
- **Alerta `MAGNETIC_ANOMALY`:** si algún punto cruza celdas con `magnetic_field_nt > 500` → brújula deshabilitada, navegación visual/inercial.
- **Radio de visibilidad visual:** fijo a partir de `dust_opacity_tau` para limitar la distancia máxima entre astronauta y hábitat.
```

---

## 3. Decisiones de diseño aprobadas (no re-litigar)

1. **Hábitat** = sitio de aterrizaje de Perseverance (Octavia E. Butler): **77.45088572 E, 18.44462715 N**.
2. **Umbral magnético = p95 local** de la rejilla (no 500 nT de la spec: a altitud de aerobraking 500 nT jamás dispararía; p95 global MAG = 265 nT, máx 1566 nT). Umbral se guarda en `eva_constants.json`.
3. **`d_paso` en metros: 40 ortogonal / 56.5685 diagonal** (la spec dice 1.0/1.414 unidades de celda; plan aprobado por el usuario en metros).
4. **Heurística `h = distancia_recta × 1.0`** (min coste/metro = 1 → admisible). Eliminar el `/v_nom` viejo (las unidades dejan de ser segundos).
5. **Modelo de vehículo (speedFactor/tiempo/energía) SOLO como reporte** en `measure()`; fuera del coste de búsqueda. Quitar `w_E·E`, `w_c·caution`, `w_u·lowConf` del coste de búsqueda (siguen reportándose).
6. **`umbral_rocas` calibrado de la distribución real** con regla determinista en código: `ceil(p99×10)/10` → **20.0 m** (bloquea 1,32 % de celdas). Debe quedar documentada la regla, no un número mágico.
7. **`W_suelo_desconocido = 0.9`** para huecos THEMIS (= penalización de TI=100). Nunca 0.
8. **`surface_temp_c` = modelo estimado**: `clip(T_base + K_SUN·illum + K_TI·(TI/300 − 1), −95, −15)`; `T_base` de MEDA TIRS (Stefan-Boltzmann, ε=0.95); `illum = −cos(azimut_descenso)·sin(pendiente)` (sol por el sur); `K_SUN=45`, `K_TI=8` iniciales → **calibrar con datos reales** (§6). Huecos de TI/iluminación → corrección neutra (0), contados en el JSON.
9. **Desconocidos en el coste (conservador, documentado)**: TI→0,9 · viento desconocido→exposición 1,0 · LOS 255→0,8 · rugosidad desconocida→**nunca bloquea** (guard `r8 < 255`).
10. **Muestreo siempre vecino-más-cercano** (fuentes más gruesas que la rejilla; no interpolar = no inventar detalle).
11. **Consistencia de cuantización Python↔TS**: pendiente `s8>80` (0.25°), rugosidad `r8>200` (0.1 m), temp int8, exposición ×100, TI entero SI, nT entero. El bloque en Python debe ser idéntico a lo que evalúe el worker.
12. **LOS**: ambas antenas 1,8 m (la altura de la antena del hábitat no está en la spec → asumida igual, documentado); curvatura `r²/(2R)`, R=3 396 190 m; barrido polar paso radial 20 m / azimutal ~40 m en el borde.
13. **Visibilidad**: `radius = C_VIS/τ`, `C_VIS = 4800` → 10 km con τ=0,48; **estado `estimated`**.
14. **τ = 0,48** (valor de referencia de la spec; no existe producto OD estático en las colecciones PDS usadas → `estimated`, no inventar citación).
15. **Hielo**: flag `Ci ≥ 0.5`; encoding `clamp(round(Ci×100),0,100)`, 255 = nodata.
16. **UV = RDS TOP_3 (250–400 nm)** media en ventana luz-día (06–18 LMST); mapeo de bandas de la literatura: **Apestigue et al. 2022, Sensors 22(8), 2907** — TOP_1..8 = 255, 259, 250–400, 450, 650, 750, 190–1100, 950 nm; LAT todos 750 nm; LAT_1 cegado; sin mapeo en la etiqueta PDS.
17. **Convención de viento**: `prevailing_wind_deg` = dirección "de la que viene" (metereológica). `θ_mov` = rumbo de desplazamiento `atan2(Δeast, Δnorth)` en grados → `θ_mov == wind_deg` = contra viento = máximo. (Físicamente correcto con el `cos` de la spec.)

---

## 4. Estado real por fichero (verificado)

### ✅ `scripts/fetch_eva_data.py` (nuevo, sin trackear, COMPLETO y ejecutado)
- Idempotente; manifiesto SHA-256 → `data/raw/manifest.json` (21 entradas con url/retrieved/sha256).
- Corregido ya: bounds THEMIS por transformada de CRS (bug grados-vs-metros) → mantiene **MC-13**, borra MC-12; buckets MEDA con `meda_bucket(sol)` (90-sol hasta sol 179, luego 120-sol desde 180).
- `MEDA_FILES`: sols 1/60/120/240 de DER_PS, DER_WS, DER_TIRS, CAL_ATS + CAL_RDS 1/120/240.
  (sol 1 de DER_WS **no existe** en el servidor — 404 esperado, sin datos ese sol.)

### ✅ `scripts/prepare_data.py` (modificado, +~400 líneas nuevas) — anclas de línea
| Símbolo | Línea | Estado |
|---|---|---|
| `routing_cells()` | 632 | ✅ refactor (fuente única de verdad de agregación 20→40 m e inválidas) usado por `step_routing` (657) y `step_eva` |
| `meda_constants()` | 779 | 🔶 |
| `col()` con guard fill `abs(v)>=1e8 → nan` | 795–800 | ✅ aplicado |
| filtro TIRS `WHEEL_OUTSIDE...` | **837** | ❌ **ROTO — ver Patch A** |
| bucle UV `RDS_TOP_{i}` (1..8) | **875** | ❌ **VIEJO — ver Patch B** |
| `eva_viewshed()` | 885 | ✅ |
| `step_eva()` | 942 | ✅ (sliding_window_view corregido a `numpy.lib.stride_tricks`, L982–986) |
| `STEPS` con `"eva"` | 1177 | ✅ |
- `b_rock` con guard `r8 < 255` y contador `n_rough_unknown`: ✅ aplicado.
- `py_compile` OK.

### 🔶 `public/data/grids/eva_*` (9 ficheros, 17:56) — **GENERADOS PERO DESACTUALIZADOS**
Se generaron con T_base=nan (temp a 0) y `wind_ms` basura (fill 999999999). **NO commitear**; regenerar tras Patches A+B.

### ⬜ Cero cambios en `src/**`, `tests/**`, `README.md`, `src/data/datasets.ts`.

### ⚠️ Refactor `routing_cells` NO validado byte a byte
`prepare_data.py routing` necesita ortho + MOLA que **no están en `data/raw/`** (faltan
`M20_JezeroCrater_CTXortho_mosaic_5m.tif` — mismo directorio planetarymaps — y la ventana MOLA vía
`scripts/fetch_trek_global.py` + conversión a GeoTIFF cuya receta el README deja vaga).
**Recomendado**: validar con un script one-off que compare el código inline viejo (de
`git show dfb8193f:scripts/prepare_data.py`) vs `routing_cells()` sobre el DEM → `np.array_equal`.

---

## 5. Los2 PENDIENTES de la Fase 1 (copy-paste listo)

### Patch A — `meda_constants()`, líneas ~834–840 (causa raíz: la columna `WHEEL_OUTSIDE_TIRS_DOWNWARD_LOOKING_FOV` está VACÍA en TODAS las filas de TODOS los sols → el filtro descarta todo → `T_base = nan` → temp=0 y bloqueo térmico 0 %)

```python
    # surface temperature from TIRS upwelling LW (Stefan-Boltzmann, epsilon assumed).
    # Filter: sun outside the FOV. The WHEEL obstruction flag is defined in the PDS label
    # but EMPTY in every row of every sol file, so it cannot be applied (documented, not guessed).
    lw, sols, lmts = [], set(), []
    for sol, r in rows("DER_TIRS"):
        if (r.get("SUN_OUTSIDE_TIRS_FOV") or "").strip() != "1":
            continue
```
(el resto del bloque — `UPWARD_LW_IRRADIANCE`, LMST, `t_c` — se queda igual)

### Patch B — `meda_constants()`, líneas ~871–883 (reemplazar el bucle UV entero; hoy promedia 8 canales mezclando muertos/broadband)

```python
    # UV: RDS TOP_3 = 250-400 nm band. Band mapping from the instrument literature
    # (Apestigue et al. 2022, Sensors 22(8), 2907: TOP_1..8 = 255, 259, 250-400, 450,
    # 650, 750, 190-1100, 950 nm; TOP_1/2 are O3-absorbed and negligible at the surface;
    # TOP_7 is the 190-1100 nm hemispheric broadband channel). The PDS label itself has
    # no wavelength mapping. Reported as the daylight (06-18 LMST) mean — night sits at
    # the noise floor (~0.016 W/m2).
    uv, sols = [], set()
    for sol, r in rows("CAL_RDS"):
        v = col(r, "RDS_TOP_3")
        lmst = (r.get("LMST") or "")
        hour = None
        if "M" in lmst:
            try:
                hour = int(lmst.split("M")[1][:2])
            except ValueError:
                pass
        if np.isfinite(v) and hour is not None and 6 <= hour < 18:
            uv.append(v)
            sols.add(sol)
    out["uv_radiation_wm2"] = entry(uv, sols, "W/m2", "observed",
                                    "MEDA RDS TOP_3 (250-400 nm) daylight mean; band mapping "
                                    "Apestigue et al. 2022 (Sensors 22, 2907)")
    return out
```

### Después de los parches
```bash
.venv-geo/bin/python -I scripts/prepare_data.py eva    # ~25 s
```

---

## 6. Resultados de la primera ejecución (baseline) y validación esperada

**Ejecución buena (17:56) — la que hay que REPRODUCIR salvo temp/wind:**
- Rejilla 2228×2533 (5 644 724 celdas), inválidas 19 028. Runtime total 25,2 s.
- DEM (5067×4456) nodata 13 977 px, min −3504,6 max −475,8; slope mediana 4,61 p95 18,33 p99 34,70.
- Roughness: n=5 624 496, p50 2,59 · p90 7,80 · **p99 19,91** · max 351,05 → **umbral 20,0 m**, bloquea 1,32 %, roughness-unknown 0.
- LOS: **visible 4,7 %** · hidden 95,3 % · unknown 0,0 %; habitat z −2567,4 m; barrido n_az 12 831 · n_r 4 085 · r_max 81 679,9 m. (El 4,7 % es correcto: horizonte geométrico a 1,8 m ≈ 3,5 km + curvatura — esperado, no "arreglar".)
- Wind exposure: p10 0 · p50 87 · p90 100; unknown 64 770 celdas (1,15 %). (La rejilla de exposición es correcta; lo roto era solo la constante `wind_ms`.)
- Block: slope 5,72 % · temp 0,00 % ❌ · rocks 0,98 % · any 5,77 %.
- ❌ `T_base nan (TIRS n=0)` · ❌ `wind_ms = 27457822,19` (fill).

**Diagnosticos MEDA (raíces ya confirmadas):**
- TIRS con filtro solo-SUN: **143 857 / 156 525 filas pasan**; `UPWARD_LW` 92–100 W/m² → **T_base esperado ≈ −67…−70 °C**.
- WS fills `999999999`: 1374–2131 filas/archivo → ya filtrados por `col()` (✅). Media real: p50 4,10 / 3,29 / 2,25 m/s (sols 60/120/240) → `wind_ms` esperado ~3–4.
- PS: 713,91–768,50 Pa (sol 0001 solo 39 min a las16 h; sols 120/240 completos).
- ATS: 191,68–269,54 K, sols 60/120/240 completos → `air_temp_c` ≈ media de medianas.
- RDS: TOP_7 (hemisférico) 53–326 W/m²; **TOP_3 (UV) p50 0,095 · max 19,08 W/m²**.

**Checklist de validación tras regenerar:**
1. `T_base` ∈ [−75, −60] °C con n > 100 000, y el JSON parsea con `json.load` (sin `NaN` suelto).
2. `wind_ms` ∈ [1, 8] y `wind_deg` razonable (media circular, informar el valor).
3. Temp percentiles dentro del clip [−95, −15]; **bloqueo térmico > 0 % y < ~15 %**. Si ~0 % → subir `K_SUN`; si dispara → bajar; dejar el valor elegido justificado en el comentario/JSON.
4. Block: slope ~5,7 %, rocks ~1 %, `roughness_unknown` 0, counts coherentes.
5. `git status`: los `eva_*` regenerados con fecha nueva antes de commitear.

---

## 7. Inventario de datos (`data/raw/`, gitignored — ya descargado ~270 MB)

| Producto | Ruta local | Fuente / URL | Formato clave |
|---|---|---|---|
| CTX DEM 20 m | `data/raw/M20_JezeroCrater_CTXDEM_20m.tif` (90 345 300 B) | `https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXDEM_20m.tif` | float, nodata, equirect Mars |
| THEMIS TI 1 km | `data/raw/themis_ti/THEMIS_TI_2026_MC13_ti_1km.tif` (7,2 MB) | Zenodo `https://zenodo.org/api/records/23527756` (Huang 2026) | uint16, nodata 65535, **scale 0.1**, eqc metros, MC-13 = 45–90 °E (Jezero 77,45 °E). Producto 100 m: doi 10.57760/sciencedb.016s5 (host USGS caído — no descargar, no escalar) |
| SWIM hielo | `data/raw/swim/SWIM4MIM_OriginalCi.tif` (71 MB) | `https://swim.psi.edu/output/SWIM4MIM/Global/Composite/SWIM4MIM_OriginalCi.tif` | ESRI:103885, 2400×7200, float32, **nodata −30**, rango −0,43..1,0 (Ci compuesta SWIM 1.0, sensación ~5 m, ~3 km) |
| MAG MGS | `data/raw/mag/mgsmag2.zip` → `mgsab.dat` | `https://mgs-mager.gsfc.nasa.gov/publications/mgsmag2.zip` | ASCII 10 col: lon lat alt br bth bph n sr sth sph; lon 0..359 (etiqueta-borde), lat −87..78, bins alt 80..190 km; bin por celda = **menor altitud**; p50 30 · p95 265 · p99 578 · máx 1566 nT |
| MEDA (18 CSV) | `data/raw/meda/` | `https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/` | buckets: sol<180→90-sol (`sol_0000_0089`, `sol_0090_0179`), sol≥180→120-sol desde 180; subdir `sol_XXXX/`; ficheros `WE__{sol}___________{PROD}__…__Pnn.CSV`; etiquetas `.xml` en el índice del directorio |
| Manifiesto | `data/raw/manifest.json` | — | 21 entradas: url, retrieved, sha256 |

Re-descarga idempotente: `.venv-geo/bin/python -I scripts/fetch_eva_data.py`.

---

## 8. Especificación de salida (lo que consume el worker TS)

Todos los `eva_*` son planos, row-major, forma (2533, 2228) = rejilla de 40 m de `routing.json`.

| Fichero | dtype | valores | nodata |
|---|---|---|---|
| `eva_roughness.u8` | u8 | valor/10 = m (cap 25,4) | 255 |
| `eva_los.u8` | u8 | 0 sin LOS · 1 LOS · 255 desconocido | 255 |
| `eva_wind.u8` | u8 | exposición×100 (0–100) | 255 |
| `eva_temp.i8` | i8 | °C redondeado, clip [−95,−15] | −128 |
| `eva_block.u8` | u8 | bitmask: 1 pendiente · 2 temperatura · 4 rocas (0 = libre) | 255 inválida |
| `eva_thermal_inertia.u16` | u16 | TI SI entera | 65535 |
| `eva_magnetic.u16` | u16 | nT | 65535 |
| `eva_ice.u8` | u8 | `clamp(round(Ci·100),0,100)`; flag = ≥50 | 255 |
| `eva_constants.json` | — | ver abajo | — |

**`eva_constants.json` (esquema real):**
```
grid{width,height,cell_m,nodata{...}}
hard_constraints{slope_max_deg:20, temp_min_c:-85, roughness_max_m, block_bits{slope:1,temperature:2,rocks:4}, note}
cost{d_paso_m{orth:40,diag:56.5685}, w_suelo_desconocido:0.9, w_suelo_note}
magnetic{anomaly_threshold_nt (p95 local), threshold_note, altitude_bin_km}
visibility{dust_opacity_tau:0.48, c_vis_m:4800, formula:"C_VIS/tau", status:"estimated", note}
atmosphere{pressure_pa, prevailing_wind_ms, prevailing_wind_deg, air_temp_c, uv_radiation_wm2, dust_opacity_tau — cada uno {value,n,sols,units,status,note}}
temperature_model{t_base_c, k_sun, k_ti, ti_ref, clip_c, status:"estimated", formula, illum_neutral_cells, ti_neutral_cells, neutral_note}
surface_temp_source{value,n,sols,units,status:"derived",note}
los{habitat_lon, habitat_lat, antenna_height_m, note, curvature, sweep{n_az,n_r,r_max_m}}
ice{flag_threshold:0.5, encoding, flag_note}
roughness{window_cells:3, window_m:120, stat, min_valid_cells:4, quantile_rule:0.99, umbral_rocas_m, note}
counts{valid_cells, invalid_cells, ti_gap_cells, ice_gap_cells, magnetic_covered_cells, wind_unknown_cells, roughness_unknown_cells}
provenance{themis_ti, swim_ice, magnetic, meda, dem — urls/retrieved/sha256/product/status/notas}
```

---

## 9. Plan de trabajo restante (Fases 2–6)

### Fase 2 — Bloqueo en TS
- **`src/routing/worker.ts` `load()` (L25–45)**: ampliar `Promise.all` con `eva_block.u8`, `eva_temp.i8`, `eva_roughness.u8`, `eva_los.u8`, `eva_wind.u8`, `eva_thermal_inertia.u16`, `eva_magnetic.u16`, `eva_ice.u8` y `eva_constants.json`; pasar a `prepareGrid` o campo `grid.eva`.
- **`src/routing/astar.ts`**: extender `PreparedGrid` con `eva?: {...}` + `evaC` (constantes).
- **`src/routing/geometry.ts` `traversable()` (L23)**: celdas con bits de `eva_block` → no transitable (manteniendo lógica `maxQ` actual). Al fallar la ruta, **diagnosticar el motivo de la celda destino**: bit2 → `'blocked_by_temperature'`, bit4 → `'blocked_by_rocks'`, bit1/pendiente → motivo de pendiente ya existente. Exponer el motivo en el fallo de `computeRoute`.
- **`worker.ts` inspect (L69–86)**: añadir campos EVA (temp, rugosidad, TI, LOS, viento, mag, hielo, motivo de bloqueo) para la ficha de inspección.

### Fase 3 — Fórmula
- **NUEVO `src/routing/eva.ts`**: tipo `EvaConstants` (espejo del JSON), `edgeCostEva(...)`, y reutilizar los helpers de distancia por fila que ya usan `H`/`edgeCost` de `astar.ts` (ojo: dx Este-Oeste varía con latitud — reusar el cálculo existente, d_paso orto=40, diag=56,57).
  - `W_pendiente`: `slope = max(slope[a], slope[b])` sobre valores **cuantizados** (`×slopeScale`); subida/bajada por `delta_z = elev[b]−elev[a]`.
  - `W_termico` en celda destino `temp[b]` (i8; −128 solo en inválidas).
  - `W_suelo` en `ti[b]`; `65535` → `0.9`.
  - `W_atmosfera`: exposición `wind[b]` (`255` → `1.0`), `wind_ms/deg` de `eva_constants`, `θ_mov = atan2(Δeast, Δnorth)` en grados.
  - `W_comunicaciones`: `los[b]` `0`→0,8 · `255`→0,8 · `1`→0.
  - `coste = d_paso·(1+ΣW)`.
- **`astar.ts`**: sustituir cuerpo de `edgeCost()` (**L207**) por la fórmula EVA; heurística `H` (**L246**) → `×1.0` por metro (quitar `/v.nominalSpeedMs`); quitar pesos caution/lowConf del coste de búsqueda (siguen en `measure()`, que NO se toca: tiempo/energía solo reporte).
- **Tests**: `tests/routing.test.ts` + `tests/geometry.test.ts` (17 verdes = baseline; actualizar solo asserts dependientes del coste) + **NUEVO `tests/eva.test.ts`**: coste vs cálculo manual de la spec, A* == Dijkstra (admisible), motivos de bloqueo, telemetría.

### Fase 4 — Telemetría (`RouteSuccess`)
- `o2CostPct` = Σ `d_paso·(1+W_pend+W_suelo+W_atm)` de la ruta / `O2_TANK_EQUIV_M ×100` (constante documentada en `eva.ts`, p. ej. 24 km plano ≈ EVA de 8 h — **estimada**, justificar comentario).
- `batteryCostPct` = Σ tiempo·(`P_BASE` + calefacción extra solo donde `temp < −40`) / `BATT_WH` (constantes documentadas en `eva.ts`).
- `magneticAnomaly` = `max(mag)` en celdas de la ruta vs `eva_constants.magnetic.anomaly_threshold_nt` → flag + valor.
- `visibilityRadiusM` = `c_vis_m / dust_opacity_tau` (≈10 km con τ=0,48).

### Fase 5 — UI
- **`src/ui/components/PlanningPanel.tsx`**: bloque EVA de telemetría (O₂ %, batería %, alerta magnética, radio de visibilidad con nota τ) + mostrar motivo de fallo (`blocked_by_temperature`/`blocked_by_rocks`).
- Ficha de inspección con campos EVA (unidades + estados provenance).
- **`src/ui/components/LayersMenu.tsx`** (opcional): toggles para `eva_los`/`eva_block`/`eva_wind` (mirar cómo se montan las capas ráster existentes).
- **`src/data/datasets.ts`**: +7–8 entradas (THEMIS Zenodo, SWIM PSI, MGS MAG, MEDA PDS4…) con url/status `observed|derived|estimated` por skill.
- **`README.md`**: sección del modelo de rutas nueva (fórmula, restricciones, telemetría), **arreglar el drift V1.1** de post-procesado, fila(s) de datos nuevos.

### Fase 6 — Verificación
1. `npm test` todo verde · 2. `npm run build` · 3. `npm run dev` (puerto 5180; el proceso anterior fue cancelado) → validación manual: ruta A→B, telemetría visible, bloqueo con motivo, inspección, consola limpia.
4. Checklists de las tres skills del repo. 5. Commit en `formula-revision` (`data/raw/` gitignored; `public/data/grids/eva_*` SÍ se commitea regenerados).

---

## 10. Infra y comandos

```bash
# venv: .venv-geo (Python 3.14.10; rasterio 1.5.2, numpy 2.x, pillow, pyproj, scipy)
.venv-geo/bin/python -I scripts/fetch_eva_data.py      # idempotente
.venv-geo/bin/python -I scripts/prepare_data.py eva    # ~25 s → public/data/grids/eva_*
npm run dev      # http://localhost:5180
npm test         # baseline 17/17
npm run build
```
- **Gotcha numpy 2.x**: `np.lib.sliding_window_view` no existe → `numpy.lib.stride_tricks.sliding_window_view` (ya corregido en L982).
- Downloads autorizados por el usuario solo para implementación (ya hechos); skills prohíben descargar en fases de diseño.

---

## 11. Riesgos y confianza honesta

1. **Fases 2–4 = el grueso** (~600–900 líneas TS + tests). Todo está especificado arriba, pero hay que leer `astar.ts`/`geometry.ts` completos antes de tocar (el suavizado V1.1 de `geometry.ts` NO se rompe).
2. **Calibración de `K_SUN`** es iterativa contra la distribución real de temperaturas (§6.3).
3. **El refactor `routing_cells` está sin probar** en ejecución (solo `py_compile` + extracción verbatim) — validar con el script de equivalencia (§4).
4. **LOS 4,7 % visible es correcto**, pero implica `W_comunicaciones≈0,8` casi en todas partes: revisar que la UI lo comunique bien (es información, no bug).
5. **No commitear los `eva_*` actuales** (temp a 0 y wind_ms basura) — regenerar primero.
6. Estado git verificado: rama correcta, árbol limpio salvo `prepare_data.py` (M), `fetch_eva_data.py` y `eva_*` (??).
