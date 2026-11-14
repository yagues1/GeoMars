---
name: geomars-surface-routing
description: Use when designing, reviewing, or choosing a surface route computation for GeoMars (origin and destination routing on Martian terrain, cost functions, slope and hazard constraints, A* versus Dijkstra, uncertainty-aware costs, route time and energy estimates, alternative routes through better-documented terrain). Symptoms include "route goes through a cliff", "route is too long", "heuristic is not admissible", "which algorithm should route".
---

# GeoMars Surface Routing Guidance

## Overview

GeoMars routes are simplified, one-route answers for a crewed surface vehicle, estimated from terrain data. The algorithm is not chosen here. This skill gives the constraints and checks any routing approach must satisfy, so Opus can compare algorithms on real data.

**Core principle:** Hard constraints first (safety, data coverage), then optimize cost. Never let an optimizer route through what it cannot verify.

## Requirements (from the product brief)

- Input: one origin and one destination, selected by clicking the map.
- Output: exactly one route. Distance and estimated travel time are primary in the UI. Energy and slope are secondary.
- Criteria the engine must balance automatically: distance, time, energy, terrain slope, hazards, vehicle mobility, data availability.
- Areas above the configured safety slope limit are prohibited, not penalized.
- When data are insufficient, first try an alternative route through better-documented terrain. Only then report that no route is available.
- A Clear Route action resets the selection.

## Step 1: Build the traversal graph

- Start from a regular grid or triangulated mesh derived from the DEM (see `geomars-raster-terrain`).
- Each node has elevation, slope, hazard flag, and data confidence.
- Each edge has length in meters computed on the surface, not in the map projection.
- Mark nodes `unavailable` where data are missing. Never treat `unavailable` as traversable.

## Step 2: Cost function

Use a weighted sum of normalized terms, with weights in one documented configuration:

```text
edge_cost = w_dist * distance
          + w_time * estimated_time
          + w_energy * estimated_energy
          + w_slope * slope_penalty(slope)
          + w_hazard * hazard_penalty
          + w_uncert * (1 - confidence)
```

Rules:

- Slope above the safety limit: edge is removed (infinite cost). Not a large penalty.
- Negative edge costs are invalid. Clamp or reject them.
- Keep energy and time as `estimated` values. Their parameters come from the configurable vehicle model.
- Confidence comes from data status: observed high-resolution data scores higher than derived or sparse data.

## Step 3: Algorithm constraints

- **Dijkstra** is always correct for non-negative costs and is the reference for testing.
- **A*** requires an admissible heuristic. Straight-line distance is admissible only if every edge cost is at least its length times the minimum possible multiplier. Verify this with the chosen weights before use.
- If the heuristic could overestimate, A* can return a suboptimal route. Check this with a Dijkstra comparison on test cases.
- Opus chooses the final algorithm after evaluating real terrain. Do not hard-code one here.

## Step 4: Data-driven fallback

1. Run the search with all constraints.
2. If no route exists, check whether the failure is caused by `unavailable` nodes.
3. If so, rerun with the remaining well-documented terrain or a relaxed uncertainty weight, and label the result as an alternative route.
4. If still no route, return "no route available" with the reason. Never draw a route over unverified terrain.

## Step 5: Output

- Route geometry in the frame and projection of the display, with the coordinate convention stated.
- Distance in meters or kilometers, estimated travel time, and estimated energy.
- Status labels: distance is `derived`, time and energy are `estimated`.
- Mark any section that used lower-confidence data.

## Validation before trusting a route

- Test on a synthetic grid with a known optimal path (a wall with a known gap, a flat plain). The result must match.
- Check that no route segment crosses a node above the slope limit.
- Compare Dijkstra and A* results on the same inputs. Costs must match when the heuristic is admissible.
- Confirm the route never enters `unavailable` nodes.

## Mistakes to avoid

| Mistake | Consequence | Fix |
|---|---|---|
| Slope limit as a penalty | Route crosses unsafe terrain when the detour is long | Remove edges above the limit |
| Missing data treated as flat | Route passes through unknown terrain | Mark `unavailable` and exclude |
| Distance computed in map projection | Length errors that grow with latitude | Compute on the surface |
| Energy shown as observed | Misleads the user | Label `estimated` |
| Choosing the algorithm in this skill | Pre-empts Opus's evaluation | Document constraints only |

## Checklist

- [ ] Unavailable data excluded, not assumed traversable
- [ ] Slope limit enforced as removal
- [ ] Costs non-negative, weights documented
- [ ] Heuristic admissibility checked before using A*
- [ ] Alternative-route fallback before "no route"
- [ ] Time and energy labeled `estimated`
- [ ] Validated on a synthetic case with known answer
