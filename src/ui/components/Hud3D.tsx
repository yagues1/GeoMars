import { useEffect, useState } from 'react';
import { useStore } from '../../state/store';
import { ENHANCED_3D_DISCLOSURE, immersive, type CameraPreset } from '../../immersive/state';
import { QUALITY } from '../../immersive/quality';

const VIEWS: { id: CameraPreset; label: string; title: string }[] = [
  { id: 'overview', label: 'Overview', title: 'Whole Jezero crater from above the rim' },
  { id: 'terrain', label: 'Terrain', title: 'Elevated 3D view of the area in the centre of the screen' },
  { id: 'ground', label: 'Ground', title: 'Close terrain inspection at eye level' },
];

/** Enhanced 3D overlay: camera views, active quality, synthetic-detail disclosure, optional stats (Shift+P). */
export function Hud3D() {
  const render3d = useStore((s) => s.render3d);
  const quality = useStore((s) => s.quality3d);
  const mode = useStore((s) => s.appMode);
  const [stats, setStats] = useState<string | null>(null);
  const [showStats, setShowStats] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.shiftKey && (e.key === 'P' || e.key === 'p')) setShowStats((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!showStats || render3d !== 'on') {
      setStats(null);
      return;
    }
    const t = window.setInterval(() => {
      const s = immersive.api?.stats();
      if (!s) return;
      setStats(
        `${s.fps} fps · ${s.cpuMsPerFrame} ms CPU · ${s.quality} (adapt ${s.adaptiveLevel}, px ${s.pixelRatio})\n` +
          `${s.drawCalls} draws · ${Number(s.triangles).toLocaleString()} tris · ${s.chunksDisplayed}/${s.chunksCached} chunks · ${s.chunksLoading} loading\n` +
          `${s.rocks} rocks · ${s.pebbles} pebbles · ${s.textures} tex · ${s.geometries} geo · heap ${s.heapMB} MB`,
      );
    }, 500);
    return () => window.clearInterval(t);
  }, [showStats, render3d]);

  if (render3d === 'off' || render3d === 'fallback') return null;
  return (
    <>
      <div className="gm-3d-hud">
        {render3d === 'loading' ? (
          <div className="gm-3d-loading glass-lite" role="status">Preparing enhanced 3D terrain…</div>
        ) : (
          mode === 'planning' && (
            <div className="gm-3d-views glass-lite" role="group" aria-label="3D camera views">
              {VIEWS.map((v) => (
                <button key={v.id} onClick={() => immersive.api?.preset(v.id)} title={v.title}>
                  {v.label}
                </button>
              ))}
              <span className="gm-3d-q" title="3D visual quality (Layers panel)">{QUALITY[quality].label}</span>
            </div>
          )
        )}
        <p className="gm-3d-note">{ENHANCED_3D_DISCLOSURE}</p>
      </div>
      {stats && <div className="gm-3d-stats glass-lite">{stats}</div>}
    </>
  );
}
