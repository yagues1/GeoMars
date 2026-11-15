# GeoMars Documentation Index

Welcome to the GeoMars documentation suite. Select a document based on your needs:

---

## 📚 Choose Your Document

### 1. Quick Start (2 minutes) → **QUICK_REFERENCE.md**
**For:** Anyone who wants the absolute essentials in < 2 minutes of reading.

- ✅ What's completed vs. what's pending
- ✅ Key files and their purposes
- ✅ Quick troubleshooting table
- ✅ Commands to execute
- ✅ TL;DR of all changes

**Best if you want:** Just the critical information, no fluff.

---

### 2. Executive Summary (5 minutes) → **README_EVA.md**
**For:** Team members who need context before deep diving.

- 🎯 Current status and what's done
- 📂 File structure overview  
- 🔧 Key corrections applied (CRS fix, LON/LAT arrays, wind sigma)
- 📊 Grid statistics summary table
- ⏳ Pending work checklist
- 🆘 FAQ section with common questions

**Best if you want:** Complete overview of the project state and scope.

---

### 3. Technical Deep Dive (30+ minutes) → **GEOMARS_EVA_FINAL.md**
**For:** Engineers who need implementation details to continue development.

- ✅ Detailed explanation of every correction applied with code diffs
- 📖 Complete routing cost formula breakdown (5W factors explained)
- 🗺️ Grid validation statistics and interpretations
- 🔄 Full data pipeline from NASA sources to routing costs  
- 💾 How to read/write grid binary files (Python & JavaScript)
- 🧮 Mathematical derivations for temperature, TI, wind models

**Best if you want:** Everything you need to understand and extend the system.

---

### 4. Version History → **CHANGES.md**
**For:** Developers needing git-style changelog with detailed commit history.

- 📝 Complete version history with file-by-file changes
- 🔧 Line-by-line code diffs (what changed and why)
- 🐛 Bug fixes with before/after comparisons
- 🧪 Validation statistics per grid type
- 🧩 Implementation notes for developers

**Best if you want:** Audit trail of all changes made.

---

## 🚀 Choose by Task Type

| If You Want To... | Read This First |
|-------------------|-----------------|
| **Understand what's done** | `README_EVA.md` or `QUICK_REFERENCE.md` |
| **Continue Python data processing** | `GEOMARS_EVA_FINAL.md` → Data Pipeline section |
| **Implement frontend visualization** | `README_EVA.md` → Pending section + `GEOMARS_EVA_FINAL.md` → Frontend |
| **Debug grid generation issues** | `CHANGES.md` → Validation Statistics + Troubleshooting |
| **Understand routing cost function** | `GEOMARS_EVA_FINAL.md` → Cost Formula section |
| **Read raw data files** | `GEOMARS_EVA_FINAL.md` → Reading Grids section |
| **Quick reference while working** | `QUICK_REFERENCE.md` (keep open!) |

---

## 🎯 Recommended Reading Paths

### Path A: New Developer Joining (30 min)
```
1. QUICK_REFERENCE.md (2 min) - Get oriented
2. README_EVA.md (5 min)  - Understand current state  
3. GEOMARS_EVA_FINAL.md (25 min) - Deep dive on implementation
```

### Path B: Backend/Data Engineer (45 min)
```
1. QUICK_REFERENCE.md (2 min) - Overview
2. CHANGES.md (10 min)  - What changed technically
3. GEOMARS_EVA_FINAL.md → Data Pipeline section (15 min)
4. GEOMARS_EVA_FINAL.md → Grid Reading section (10 min) - For implementation
```

### Path C: Frontend Developer (20 min)
```
1. QUICK_REFERENCE.md (2 min) - Current state
2. README_EVA.md → Pending section (5 min) - What needs building
3. GEOMARS_EVA_FINAL.md → Frontend Integration section (10 min)
4. src/routing/astar.ts (3 min) - Study existing routing implementation
```

### Path D: Quick Troubleshooting (< 5 min)
```
1. QUICK_REFERENCE.md → Troubleshooting table
2. If not resolved, search GEOMARS_EVA_FINAL.md for specific issue
```

---

## 📁 File Summary Table

| Document | Size | Best For | Reading Time |
|----------|------|----------|--------------|
| `QUICK_REFERENCE.md` | 5 KB | Quick lookup, commands | < 2 min |
| `README_EVA.md` | 7.7 KB | Executive summary, status | ~5 min |
| `GEOMARS_EVA_FINAL.md` | 19 KB | Complete technical reference | 30+ min |
| `CHANGES.md` | 13 KB | Version history, diffs | 10-15 min |
| `DOCUMENTATION_INDEX.md` | This file | Navigation helper | < 1 min |

---

## 🛠️ Tools & Scripts Reference

### Python Scripts (Data Generation)
```bash
# Generate grids from NASA/USGS data
cd scripts
.venv-geo/Scripts/python prepare_data.py     # RAW: THEMIS/CAL_ATS/MOLA
.venv-geo/Scripts/python run_eva_step.py     # Final processing
```

### JavaScript/Vite Commands (Frontend)
```bash
npm run dev          # Development server
npm run build        # TypeScript + production build  
npm run test         # Run Vitest tests
npm run typecheck    # TypeScript compilation check
```

---

## 🌐 Data Sources Attribution

All geographic and geophysical data from public NASA/USGS sources:

| Dataset | Source | Coverage | Projection |
|---------|--------|----------|------------|
| THEMIS Thermal Inertia | HiRISE/CTX | Jezero Crater & surroundings | EPSG:4326 (after correction) |
| MEDA/CAL_ATS Temperature | Mars Environmental Dynamics Analyzer | Gale Crater landing site | Local (WGS84 ellipsoid) |
| MOLA DEM | Mars Orbiter Laser Altimetry | Global Mars | Various, converted to EPSG:4326 |

---

## 🔗 Links Between Documents

Cross-references you'll encounter:

### `QUICK_REFERENCE.md` points to:
- README_EVA.md (executive summary)
- GEOMARS_EVA_FINAL.md (full technical details)

### `README_EVA.md` references:
- QUICK_REFERENCE.md (for quick lookups)
- GEOMARS_EVA_FINAL.md (complete documentation)
- CHANGES.md (detailed change history)

### `GEOMARS_EVA_FINAL.md` covers:
- Everything in the other docs, plus:
  - Detailed code diffs with before/after
  - Complete mathematical formulas
  - Grid file reading implementations
  - Troubleshooting guides per issue type

### `CHANGES.md` documents:
- All technical changes from earlier versions  
- Line-by-line corrections applied
- Validation statistics and testing results

---

## 📞 Quick Help Lookup

**Need to...** → **Read this section**

| Task | Documentation Location |
|------|------------------------|
| Know what grids exist and where | `README_EVA.md` → Grids Generated table |
| Understand CRS fix for THEMIS TI | `GEOMARS_EVA_FINAL.md` → Scripts Python → prepare_data.py → Line 41-50 |
| See routing cost formula in detail | `GEOMARS_EVA_FINAL.md` → Cost Formula section |
| Learn how to read grid files in Python | `GEOMARS_EVA_FINAL.md` → Reading Grid Data (Python) |
| Check temperature correlation stats | `CHANGES.md` → Validation Statistics table |
| Find pending frontend work | `README_EVA.md` → Next Steps section |
| Understand wind exposure correction | `QUICK_REFERENCE.md` → Corrections Critical OR `GEOMARS_EVA_FINAL.md` → Wind exposure post-processing |

---

## 📊 Current Project Status Summary

```
✅ GRID GENERATION: COMPLETE
   - 6 grids generated (.u8, .i8, .u16 formats)
   - All validations passed (>5 unique values, realistic ranges)
   - 1M+ valid cells across all grids

✅ PYTHON PROCESSING: COMPLETE  
   - THEMIS TI CRS corrected to EPSG:4326
   - LON/LAT array sampling implemented
   - Temperature modeled from CAL_ATS (ρ=-0.914)
   - Wind exposure sigma=10 applied
   - DEM gradient noise added for micro-topography

✅ ROUTING ALGORITHM: COMPLETE
   - Multi-factor cost function (5W) implemented in A*
   - Vehicle model updated per spec (maxSlope=20°, caution=12°)
   - Grid loading architecture prepared

⏳ FRONTEND VISUALIZATION: PENDING (non-critical for core routing)
   - Map overlays for EVA grids
   - Rover info panel widget
   - UI controls for layer toggling
   
📝 DOCUMENTATION: COMPLETE
   - 5 documentation files covering all aspects
   - Full technical specs in GEOMARS_EVA_FINAL.md
   - Quick reference in QUICK_REFERENCE.md
```

---

## 🎯 Next Steps After Reading Documentation

Once you understand what's done:

### Option A: Test Core Routing (Without UI)
1. Read `QUICK_REFERENCE.md` → JavaScript section  
2. Load grids into worker.ts manually  
3. Call `computeRoute()` in tests  
4. Verify routing with new cost function works

### Option B: Implement Frontend Visualization
1. Read `README_EVA.md` → Pending section
2. Create `EVALayers.tsx` component (maplibre overlay)
3. Create `EvaInfoPanel.tsx` component (rover stats widget)
4. Integrate grids loading in worker threads

### Option C: Extend/Modify Data Pipeline
1. Read `CHANGES.md` → What changed technically
2. Modify `prepare_data.py` for new datasets or corrections
3. Re-run `run_eva_step.py` to regenerate grids
4. Validate output matches expected statistics

---

## 📝 Document Maintenance

**Last updated:** November 15, 2026  
**Author:** GeoMars V1.0 Development Team  
**Maintainer:** Anyone with commit access to this repo  

**To add updates:**
1. Update the relevant source file (Python or TypeScript)
2. Regenerate grids if needed
3. Update CHANGES.md with version bump and changes
4. Update README_EVA.md with new status/TODOs
5. Link to full details in GEOMARS_EVA_FINAL.md if applicable

---

## 📮 Feedback & Questions

If you find unclear sections or have questions:
- Check `GEOMARS_EVA_FINAL.md` first - it has the most complete answers
- For quick lookups, use `QUICK_REFERENCE.md` troubleshooting table  
- Implementation details are in `src/routing/astar.ts` and `scripts/prepare_data.py`

---

**Choose your path. Start reading.** 🚀
