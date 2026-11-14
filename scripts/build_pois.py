"""Build GeoMars scientific destinations (public/data/vector/pois.json).

Every destination is traceable:
  * IAU names: USGS Gazetteer of Planetary Nomenclature (planetocentric, +East).
  * Sample sites: NASA "Mars Rock Samples" table (sample name, feature, sol sealed, rock type)
    https://science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples
    located at the Perseverance position on that sol from the NASA/JPL MMGIS waypoint file
    (last recorded waypoint with sol <= sol sealed). Position is rover-scale approximate.
  * Landing site: first MMGIS waypoint (sol 13 site increment, same location as touchdown).
  * Western fan: centroid of the largest "Jezero fan 2 unit" polygon of USGS SIM 3464.
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
V = os.path.join(ROOT, "public", "data", "vector")
NASA_SAMPLES = "https://science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples"
MMGIS = "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json"
GAZ = "https://planetarynames.wr.usgs.gov/"
SIM = "https://doi.org/10.3133/sim3464"

wps = json.load(open(os.path.join(V, "waypoints_by_sol.json")))["waypoints"]


def at_sol(sol):
    best = None
    for w in wps:
        if w["sol"] <= sol:
            best = w
    return best


# (feature, [(sample no, sample name, sol, date, type, rock)], extra context sentence or None)
SAMPLES = [
    ("Rochette", [(2, "Montdenier", 194, "2021-09-06", "Rock core", "Igneous"),
                  (3, "Montagnac", 196, "2021-09-08", "Rock core", "Igneous")],
     "First rock cores of the mission, from an igneous rock on the crater floor (Máaz formation, Artuby ridge)."),
    ("Brac", [(4, "Salette", 262, "2021-11-15", "Rock core", "Igneous"),
              (5, "Coulettes", 271, "2021-11-24", "Rock core", "Igneous")],
     "Igneous rock in the Séítah region of the crater floor, reported by the mission as olivine-rich."),
    ("Issole", [(6, "Robine", 298, "2021-12-22", "Rock core", "Igneous"),
                (7, "Malay", 337, "2022-01-31", "Rock core", "Igneous")], None),
    ("Sid", [(8, "Ha'ahóni", 371, "2022-03-07", "Rock core", "Igneous"),
             (9, "Atsá", 377, "2022-03-13", "Rock core", "Igneous")], None),
    ("Skinner Ridge", [(10, "Swift Run", 490, "2022-07-07", "Rock core", "Sedimentary"),
                       (11, "Skyland", 495, "2022-07-12", "Rock core", "Sedimentary")],
     "First sedimentary cores, collected at the front of the western fan (delta)."),
    ("Wildcat Ridge", [(12, "Hazeltop", 509, "2022-07-27", "Rock core", "Sedimentary"),
                       (13, "Bearwallow", 516, "2022-08-03", "Rock core", "Sedimentary")],
     "Fine-grained sedimentary rock at the delta front; NASA reported detections of organic matter by the SHERLOC instrument in this rock (2022)."),
    ("Amalik", [(14, "Shuyak", 575, "2022-10-02", "Rock core", "Sedimentary"),
                (15, "Mageik", 619, "2022-11-16", "Rock core", "Sedimentary")], None),
    ("Hidden Harbor", [(16, "Kukaklek", 631, "2022-11-29", "Rock core", "Sedimentary")], None),
    ("Observation Mountain", [(17, "Atmo Mountain", 634, "2022-12-02", "Regolith", "Likely mixed sedimentary and igneous grains"),
                              (18, "Crosswind Lake", 639, "2022-12-07", "Regolith", "Likely mixed sedimentary and igneous grains")],
     "Regolith (loose surface material) samples."),
    ("Berea", [(19, "Melyn", 749, "2023-03-30", "Rock core", "Sedimentary")], None),
    ("Emerald Lake", [(20, "Otis Peak", 832, "2023-06-23", "Rock core", "Sedimentary")], None),
    ("Dream Lake", [(21, "Pilot Mountain", 913, "2023-09-15", "Rock core", "Sedimentary")], None),
    ("Hans Amundsen Memorial Workspace", [(22, "Pelican Point", 923, "2023-09-25", "Rock core", "Sedimentary")], None),
    ("Turquoise Bay", [(23, "Lefroy Bay", 949, "2023-10-21", "Rock core", "Sedimentary")], None),
    ("Bunsen Peak", [(24, "Comet Geyser", 1088, "2024-03-12", "Rock core", "Silica-cemented carbonate")],
     "Sample listed by NASA as a silica-cemented carbonate."),
    ("Cheyava Falls", [(25, "Sapphire Canyon", 1215, "2024-07-21", "Rock core", "Sedimentary")],
     "Rock in Neretva Vallis whose 'leopard spot' textures NASA has described as a potential biosignature that requires further study; not a confirmed detection of life."),
    ("Shallow Bay", [(26, "Silver Mountain", 1401, "2025-01-28", "Rock core", "Igneous/impactite")], None),
    ("Tablelands", [(27, "Green Gardens", 1433, "2025-03-02", "Rock core", "Serpentinite")], None),
    ("Broom Point", [(28, "Main River", 1441, "2025-03-10", "Rock core", "Igneous/impactite")], None),
]

pois = []
for feature, samples, ctx in SAMPLES:
    sol = samples[-1][2]
    w = at_sol(sol)
    names = ", ".join(f"'{s[1]}' (#{s[0]}, sol {s[2]}, {s[3]})" for s in samples)
    rock = samples[0][5]
    desc = f"{samples[0][4]} sample site. NASA lists {names} from the '{feature}' feature; rock type: {rock}."
    if ctx:
        desc += " " + ctx
    pois.append({
        "id": "sample-" + feature.lower().replace(" ", "-").replace("'", ""),
        "name": feature,
        "category": "sample",
        "lon": w["lon"], "lat": w["lat"],
        "elev_geoid_m": w["elev_geoid"],
        "description": desc,
        "samples": [{"no": s[0], "name": s[1], "sol": s[2], "date": s[3], "type": s[4], "rock": s[5]} for s in samples],
        "status": "observed",
        "location_method": f"Perseverance position on sol {w['sol']} (last MMGIS waypoint at or before sol {sol}); rover-scale approximate.",
        "sources": [NASA_SAMPLES, MMGIS],
    })

# Depot: first tube deposited 2022-12-21 (sol 653) at Three Forks per NASA
w = at_sol(653)
pois.append({
    "id": "three-forks-depot", "name": "Three Forks Sample Depot", "category": "sample",
    "lon": w["lon"], "lat": w["lat"], "elev_geoid_m": w["elev_geoid"],
    "description": "Area where Perseverance deposited a set of sample tubes on the surface (sample table lists them as 'Sample Depot'), as a backup cache for a future return mission.",
    "status": "observed",
    "location_method": f"Perseverance position on sol {w['sol']} (deposit operations began 2022-12-21); approximate.",
    "sources": [NASA_SAMPLES, MMGIS],
})

land = wps[0]
pois.append({
    "id": "landing", "name": "Octavia E. Butler Landing", "category": "landmark",
    "lon": land["lon"], "lat": land["lat"], "elev_geoid_m": land["elev_geoid"],
    "description": "Touchdown site of the Perseverance rover (18 February 2021) on the Jezero crater floor.",
    "status": "observed",
    "location_method": f"First rover waypoint in the NASA/JPL MMGIS file (sol {land['sol']}).",
    "sources": [MMGIS],
})

pois += [
    {"id": "jezero-center", "name": "Jezero Crater", "category": "landmark", "lon": 77.69, "lat": 18.41,
     "description": "Impact crater about 47.5 km in diameter (IAU) that once held a lake fed by river channels; landing site of the Mars 2020 mission.",
     "status": "observed", "location_method": "IAU feature centre (USGS Gazetteer, planetocentric +East).",
     "sources": [GAZ]},
    {"id": "neretva-vallis", "name": "Neretva Vallis", "category": "landmark", "lon": 77.20, "lat": 18.55,
     "description": "Valley that breaches the western rim of Jezero; Sun & Stack (2020) interpret the older fan unit as sourced from it.",
     "status": "observed", "location_method": "IAU feature centre (USGS Gazetteer).", "sources": [GAZ, SIM]},
    {"id": "sava-vallis", "name": "Sava Vallis", "category": "landmark", "lon": 77.13, "lat": 19.09,
     "description": "Valley entering Jezero from the north.",
     "status": "observed", "location_method": "IAU feature centre (USGS Gazetteer).", "sources": [GAZ]},
]

# Western fan centroid from SIM 3464 'Jezero fan 2 unit'
geo = json.load(open(os.path.join(V, "geology.geojson")))
best, area = None, 0
for f in geo["features"]:
    if f["properties"]["unit"] != "NHjf2":
        continue
    polys = f["geometry"]["coordinates"] if f["geometry"]["type"] == "MultiPolygon" else [f["geometry"]["coordinates"]]
    for p in polys:
        ring = p[0]
        a = 0.0
        cx = cy = 0.0
        for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
            c = x1 * y2 - x2 * y1
            a += c
            cx += (x1 + x2) * c
            cy += (y1 + y2) * c
        if abs(a) > area:
            area, best = abs(a), (cx / (3 * a), cy / (3 * a))
pois.append({
    "id": "western-fan", "name": "Jezero western fan (delta)", "category": "landmark",
    "lon": round(best[0], 5), "lat": round(best[1], 5),
    "description": "Fan-shaped sedimentary deposit at the mouth of Neretva Vallis (mapped as Jezero fan units 1 and 2 by Sun & Stack 2020), interpreted as an ancient river delta (Mangold et al., 2021).",
    "status": "derived", "location_method": "Centroid of the largest 'Jezero fan 2 unit' polygon, USGS SIM 3464.",
    "sources": [SIM, "https://doi.org/10.1126/science.abl4051"],
})

json.dump({"generated_by": "scripts/build_pois.py", "coordinate_frame": "Mars planetocentric, east-positive, degrees",
           "pois": pois}, open(os.path.join(V, "pois.json"), "w", encoding="utf8"), indent=1, ensure_ascii=False)
for p in pois:
    print(f"{p['name']:<35} {p['lat']:.5f} {p['lon']:.5f}")
