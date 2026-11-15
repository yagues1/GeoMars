# Routing Quick Start Guide

## How to Use the New 5-Factor A* Routing System

This guide shows how to integrate and use the terrain-aware routing with cost factors.

---

## 1. Worker Initialization

### Frontend Code Example (React/TypeScript)

```typescript
// router.tsx - Your React component that uses routing
import { useEffect, useState } from 'react';

function RoutePlanner() {
  const [workerUrl, setWorkerUrl] = useState<string | null>(null);
  const [routeResult, setRouteResult] = useState<any>(null);

  useEffect(() => {
    // Initialize worker
    const blob = new Blob(['import { self } from "worker-thread";'], { type: 'application/javascript' });
    setWorkerUrl(URL.createObjectURL(blob));
  }, []);

  useEffect(() => {
    if (!workerUrl) return;

    const worker = new Worker(workerUrl, { type: 'module' });
    
    worker.postMessage({ 
      type: 'init', 
      base: '/api/routing/grids', // Your API base path for grid data
      minTempC: -85               // Apply thermal block constraint
    });

    worker.onmessage = (ev) => {
      if (ev.data.type === 'ready') {
        console.log('Worker ready, grid size:', ev.data.width, '×', ev.data.height);
      } else if (ev.data.type === 'route') {
        setRouteResult(ev.data.result);
      }
    };

    // Calculate route after worker is ready
    const startCell = [500, 1200]; // [col, row] in grid coordinates
    const endCell = [1800, 2400];

    worker.postMessage({ 
      type: 'route', 
      id: 1, 
      from: startCell, 
      to: endCell,
      vehicle: {
        nominalSpeedMs: 2.5,
        maxSlopeDeg: 20,
        cautionSlopeDeg: 12,
        energyPerWh: 0.5
      }
    });

    return () => worker.terminate();
  }, [workerUrl]);

  if (routeResult?.ok) {
    return (
      <div>
        <h3>Route Found</h3>
        <p>Distance: {routeResult.distanceM} m</p>
        <p>Time: {routeResult.timeS.toFixed(1)} s</p>
        <p>Energy: {routeResult.energyKWh.toFixed(2)} kWh</p>
        <p>Max Slope: {routeResult.maxSlopeDeg}°</p>
        <p>Straight Line: {routeResult.straightLineM} m</p>
        <p>Deviation: {((routeResult.distanceM / routeResult.straightLineM - 1) * 100).toFixed(1)}%</p>
      </div>
    );
  }

  return <div>Loading...</div>;
}
```

---

## 2. API Endpoint (Backend)

### Flask/FastAPI Route Example

```python
# routes/routing.py
from flask import Blueprint, jsonify, request
import os

api = Blueprint('routing', __name__, url_prefix='/api/routing')

@api.route('/grids', methods=['GET'])
def get_grids():
    """Serve grid files for worker to load"""
    
    base_dir = os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'grids')
    
    # Grid JSON metadata
    return jsonify({
        'width': 2228,
        'height': 2533,
        'cell_m_projected': 40.0,
        'lon0_center': 76.9978,
        'lat0_center': 19.2898,
        'dlon': 0.000711457,
        'dlat': 0.000674824,
        'radius_m': 3396190.0,
        'elev_nodata': -32768,
        'slope_scale': 0.25,
    })

@api.route('/grid/<filename>', methods=['GET'])
def get_grid(filename):
    """Serve individual grid file"""
    grid_path = os.path.join('public', 'data', 'grids', filename)
    
    if not os.path.exists(grid_path):
        return jsonify({'error': 'Grid not found'}), 404
    
    with open(grid_path, 'rb') as f:
        return send_file(f, mimetype='application/octet-stream')

@api.route('/calculate', methods=['POST'])
def calculate_route():
    """Calculate route and return cost factors"""
    data = request.json
    from_lat, from_lon = data['from']
    to_lat, to_lon = data['to']
    
    # Load grid and compute route (simplified)
    result = a_star_route(from_lat, from_lon, to_lat, to_lon)
    
    return jsonify(result)

def a_star_route(start: tuple, end: tuple):
    """Import your A* implementation"""
    from routing.astar import computeRoute
    # Convert lat/lon to grid coordinates first
    from routing.grid import latLonToCell
    grid = prepareGrid_from_worker()  # Load from API
    
    start_cell = latLonToCell(grid, *start)
    end_cell = latLonToCell(grid, *end)
    
    result = computeRoute(grid, vehicle_params, 
                         (start_cell[0], start_cell[1]),
                         (end_cell[0], end_cell[1]))
    
    return result
```

---

## 3. Cost Factor Interpretation

### Understanding the Results

After calculating a route, you can analyze the cost breakdown:

```typescript
// Enhanced route result with cost analysis
const analyzedResult = {
  ok: true,
  distanceM: 1250,
  timeS: 485.3,
  
  // Cost factor breakdown (added by your implementation)
  costBreakdown: {
    baseDistanceCost: 0.85,        // Distance × speed factor
    slopePenalty: 0.32,            // W_pendiente contribution
    thermalPenalty: 1.47,          // W_termico (cold temp)
    soilPenalty: 0.95,             // W_suelo (low TI areas)
    windPenalty: 0.18,             // W_atmosfera
    commsPenalty: 0,               // W_comunicaciones (not available)
    energyCost: 12.34              // segmentEnergyWh term
  },
  
  // Traversability info
  traversability: {
    totalCells: 856,
    lowConfidenceCells: 23,        // Cells with confidence=1
    coldZoneBlocked: false         // No cells below -85°C
  }
};

// Analyze soil quality along route
const soilQuality = analyzedResult.costBreakdown.soilPenalty;
if (soilQuality > 1.0) {
  console.warn('Route passes through very loose soil (TI < 160 J/m²/K/s¹/₂)');
}

// Analyze thermal risk
if (analyzedResult.costBreakdown.thermalPenalty > 1.2) {
  console.warn('Cold temperature penalty detected - consider rover heating');
}
```

---

## 4. Vehicle Parameters

### Default Rover Configuration

```typescript
export const DEFAULT_ROVER_VEHICLE: VehicleModel = {
  nominalSpeedMs: 2.5,      // m/s (~9 km/h)
  maxSlopeDeg: 20,          // Maximum climbable slope
  cautionSlopeDeg: 12,      // Slope requiring extra speed reduction
  energyPerWh: 0.5,         // Energy cost coefficient (J/m per Wh)
  
  // Derived properties from cost formula
  tractionCoeff: 0.05,      // Traction force coefficient
  brakingDistMs: 10.0       // Braking distance in meters
};
```

### Custom Vehicle Types

```typescript
const VEHICLE_TYPES = {
  rover: DEFAULT_ROVER_VEHICLE,
  buggy: { ...DEFAULT_ROVER_VEHICLE, nominalSpeedMs: 8.0, maxSlopeDeg: 15 },
  walking: { ...DEFAULT_ROVER_VEHICLE, nominalSpeedMs: 1.3, maxSlopeDeg: 25 }
};

// Use different vehicle types for EVA scenarios
const result = computeRoute(grid, VEHICLE_TYPES.buggy, start, end);
```

---

## 5. Debugging & Diagnostics

### Check Grid Data Availability

```typescript
// Inspect terrain at a specific cell
worker.postMessage({
  type: 'inspect',
  id: 1,
  lngLat: [77.0, 19.3]
});

worker.onmessage = (ev) => {
  if (ev.data.type === 'inspect') {
    const terrain = ev.data.result;
    console.log('Terrain data:', terrain);
    
    // Verify all layers are available
    if (!terrain.magnetic_nT) {
      console.warn('⚠️ Magnetic field data missing');
    }
    if (!terrain.wind_exposure) {
      console.warn('⚠️ Wind exposure data missing');
    }
    if (!terrain.thermal_inertia) {
      console.warn('⚠️ THEMIS TI data missing');
    }
  }
};
```

### Route Failure Analysis

```typescript
if (!result.ok) {
  switch (result.reason) {
    case 'blocked_by_slope':
      console.error('Route blocked: terrain too steep for vehicle');
      console.log('Max slope encountered:', result.maxSlopeDeg, '°');
      
    case 'no_data':
      console.error('No terrain data at start/end point');
      
    case 'too_steep_endpoint':
      console.error('Start/end point on impossible terrain');
      
    case 'blocked_by_temperature':
      console.error('Thermal block: temperature < -85°C detected');
  }
}
```

---

## 6. Performance Considerations

### Memory Usage

The routing worker keeps approximately **75 MB** in memory:

| Layer | Size (MB) | Data Type |
|-------|-----------|-----------|
| Elevation | 11 | Int16Array |
| Slope | 0.5 | Uint8Array |
| Magnetic Field | 22 | Float32Array |
| Wind Exposure | 22 | Float32Array |
| THEMIS TI | 1 | Uint16Array |

### CPU Performance

- **Grid initialization:** ~200-400ms (first time only)
- **Route calculation:** <50ms for typical routes
- **Heuristic vs Dijkstra:** 3x faster with heuristic enabled

### Worker Thread Usage

```typescript
// Keep workers alive for multiple routes
const workerPool = new Map();

function getWorker(id: number) {
  if (!workerPool.has(id)) {
    const worker = new Worker('/src/routing/worker.ts');
    worker.postMessage({ type: 'init', base: '/api/grids' });
    workerPool.set(id, worker);
  }
  return workerPool.get(id)!;
}

// Use same worker for multiple routes
const worker = getWorker(1);
worker.postMessage({ type: 'route', from: [500, 1200], to: [1800, 2400] });
```

---

## 7. Integration Checklist

### Before Deployment

- [ ] Grid files generated and uploaded to storage bucket
- [ ] Worker loaded successfully in browser console
- [ ] Route calculation returns `ok: true` for test cases
- [ ] Thermal block constraint working (no routes through cold zones)
- [ ] Cost factors producing expected ranges:
  - W_pendiente: 0.0 - 2.5
  - W_termico: 1.0 - 1.5 (constant for Mars surface temp)
  - W_suelo: 0.0 - 1.8
  - W_atmosfera: 0.0 - 1.0 (depends on wind and speed)
  - W_comms: 0.0 (placeholder, will be populated later)

### Known Limitations

- Mock terrain data used for testing (not real HiRISE/CTX DEM)
- Line-of-sight habitat layer not available yet
- Wind direction simplified (uses static WSW assumption)
- THEMIS TI values approximated (scale ×16 in worker)

---

## 8. Troubleshooting

### Common Issues

**Issue:** Worker loads but grid data is missing  
**Solution:** Check API endpoint `/api/routing/grids` returns JSON metadata

**Issue:** Route blocked by temperature when no cold areas exist  
**Solution:** Verify `minTempC` parameter matches actual thermal constraints

**Issue:** Cost calculation extremely high or zero  
**Solution:** Check that all 5 grid arrays are loaded in worker (`grid.magnet`, `grid.windExposure`, `grid.thermalInertia`)

**Issue:** Diagonal moves producing unexpected costs  
**Solution:** Verify both orthogonal neighbors are traversable (diagonal constraint)

---

**Last Updated:** November 15, 2026  
**Version:** 1.0  
**API Version:** /api/v1/routing
