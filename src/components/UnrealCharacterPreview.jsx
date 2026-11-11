import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  UNREAL_CHARACTER_RENDERS,
  UNREAL_PREVIEW_AHEAD,
  UNREAL_PREVIEW_ASSET_ROOT,
  UNREAL_PREVIEW_PATH,
  UNREAL_PREVIEW_SHOWN,
  findUnrealRender,
  unrealRenderUrl,
} from '../unreal/characterPreview.js';
import './UnrealCharacterPreview.css';

// Overview entry point. A plain link: opening the preview is a full navigation,
// so the game is not left mounted behind it.
export function UnrealPreviewCard() {
  return (
    <a className="mode-card unreal-preview-card" href={UNREAL_PREVIEW_PATH}>
      <img
        className="unreal-preview-card-thumb"
        src={`${UNREAL_PREVIEW_ASSET_ROOT}/card-thumb.webp`}
        alt=""
        width="224"
        height="224"
        decoding="async"
      />
      <span>
        <strong>Unreal Character Preview</strong>
        <small>See the new fighter in captured stills</small>
      </span>
      <ChevronRight size={28} aria-hidden="true" />
    </a>
  );
}

// This route never mounts App, reads saved progress, or writes localStorage.
// It shows captured stills only: no stream, no Unreal session and no renderer change.
export default function UnrealCharacterPreview() {
  const [selectedId, setSelectedId] = useState(UNREAL_CHARACTER_RENDERS[0].id);
  const selected = findUnrealRender(selectedId);

  useEffect(() => {
    const previous = document.title;
    document.title = 'Unreal character preview · JiuQuest';
    return () => { document.title = previous; };
  }, []);

  return (
    <main className="unreal-preview-page">
      <div className="unreal-preview-top">
        <span className="unreal-preview-brand"><span className="unreal-preview-mark" aria-hidden="true">JQ</span>JIUQUEST</span>
        <a href="/">Return to JiuQuest <span aria-hidden="true">↗</span></a>
      </div>

      <header className="unreal-preview-intro">
        <div>
          <span className="unreal-preview-eyebrow">UNREAL CHARACTER PREVIEW</span>
          <h1>A first look at the new fighter.</h1>
          <p>Unedited stills captured from the character build in Unreal Engine. They show the look we are working toward. Arena and Training still play with the current characters.</p>
        </div>
        <span className="unreal-preview-mode">CAPTURED STILLS<span>Not live gameplay</span></span>
      </header>

      <div className="unreal-preview-grid">
        <section className="unreal-preview-viewer" aria-label="Character stills">
          <figure>
            <div className="unreal-preview-frame">
              <img
                key={selected.id}
                src={unrealRenderUrl(selected)}
                alt={selected.alt}
                width={selected.width}
                height={selected.height}
                decoding="async"
              />
              <span className="unreal-preview-badge">Unreal Engine capture · still image</span>
            </div>
            <figcaption aria-live="polite">
              <strong>{selected.title}</strong>
              <span>{selected.caption}</span>
              <a href={unrealRenderUrl(selected)} target="_blank" rel="noreferrer">Open the full capture <span aria-hidden="true">↗</span></a>
            </figcaption>
          </figure>
          <div className="unreal-preview-views" role="group" aria-label="Character views">
            {UNREAL_CHARACTER_RENDERS.map((render) => (
              <button
                key={render.id}
                type="button"
                aria-pressed={render.id === selected.id}
                onClick={() => setSelectedId(render.id)}
              >
                <img src={unrealRenderUrl(render)} alt="" width={render.width} height={render.height} decoding="async" />
                <span>{render.label}</span>
              </button>
            ))}
          </div>
        </section>

        <aside className="unreal-preview-notes" aria-label="Preview status">
          <div>
            <span className="unreal-preview-eyebrow">IN THESE STILLS</span>
            <ul>
              {UNREAL_PREVIEW_SHOWN.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
          <div>
            <span className="unreal-preview-eyebrow">STILL AHEAD</span>
            <ul>
              {UNREAL_PREVIEW_AHEAD.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <p>Arena and Training keep the current characters until these are ready.</p>
          </div>
          <p className="unreal-preview-safe">Preview only. Your saved fighters, training repetitions, unlocks, and arena results stay unchanged.</p>
        </aside>
      </div>
    </main>
  );
}
