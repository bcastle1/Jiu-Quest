import { useId } from 'react';
import { UNREAL_STANCES, findStance } from '../unreal/stances.js';
import './StancePicker.css';

// The fighting stances as pictures, one of them chosen. The choice is the
// fighter's stance: it is where their standing animations begin. `note` says
// what the picture above is showing when it cannot show the chosen stance yet.
// The note is plain text: whoever changes the stance announces the change, so
// a screen reader hears it once.
export default function StancePicker({ value, onChange, note = null }) {
  const name = useId();
  const current = findStance(value);
  return (
    <div className="stance-picker">
      <p className="stance-picker-heading">
        <span>Starting stance</span>
        <strong>{current.label}</strong>
        <small>{current.copy}</small>
      </p>
      <div className="stance-picker-options" role="radiogroup" aria-label="Starting stance">
        {UNREAL_STANCES.map((option) => (
          <label key={option.stance} className={option.stance === current.stance ? 'selected' : undefined} title={`${option.label}: ${option.copy}`}>
            <input
              type="radio"
              name={name}
              value={option.stance}
              aria-label={option.label}
              checked={option.stance === current.stance}
              onChange={() => onChange(option.stance)}
            />
            <img src={option.picture} alt="" width={option.width} height={option.height} loading="lazy" decoding="async" />
          </label>
        ))}
      </div>
      {note && <p className="stance-picker-note">{note}</p>}
    </div>
  );
}
