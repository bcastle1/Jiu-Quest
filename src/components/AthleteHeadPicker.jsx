import { useId } from 'react';
import {
  ATHLETE_BEARDS, ATHLETE_FACES, ATHLETE_HAIRS, ATHLETE_HAIR_COLORS, ATHLETE_HEAD_FIELDS, athleteHeadOf,
} from '../unreal/athleteHeadOptions.js';
import { athleteHeadThumb } from '../unreal/athleteHeads.js';
import UnrealAthlete from './UnrealAthlete.jsx';
import './AthleteHeadPicker.css';

// A row of buttons with a small picture each: the faces, or the hairstyles.
function PictureChoice({ label, part, options, value, thumb, onChoose }) {
  return (
    <div className="athlete-head-group" role="group" aria-label={label} data-part={part}>
      <span className="athlete-head-label">{label}</span>
      <div className="athlete-head-options">
        {options.map((option) => {
          const picture = thumb(option.id);
          return (
            <button
              key={option.id}
              type="button"
              className={value === option.id ? 'active' : ''}
              aria-pressed={value === option.id}
              data-option={option.id}
              onClick={() => onChoose(part, option.id)}
            >
              {picture && <img src={picture} alt="" width="128" height="128" loading="lazy" draggable={false} />}
              <strong>{option.label}</strong>
              {option.detail && <small>{option.detail}</small>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// The head of the Unreal athlete in the Fighter Creator: face, hairstyle, hair
// color and beard. Every button shows or names a head that was rendered in
// Unreal Engine; the athlete on the stage changes as soon as its picture has
// loaded. The choices are saved with the fighter like the gi colors.
//
// Where the page is one column the stage has scrolled away by the time these
// buttons are reached, and the small pictures on them show neither the hair
// color nor the beard, so a copy of the athlete's head sits beside those two.
export default function AthleteHeadPicker({ fighter, belt = 'white', onChange }) {
  const head = athleteHeadOf(fighter);
  const noteId = useId();
  const choose = (part, id) => onChange({ [ATHLETE_HEAD_FIELDS[part]]: id });
  // A shaved head without a beard has no hair to color. The color can still be
  // chosen: it is kept and shows as soon as there is hair or a beard.
  const colorUsed = head.hair !== 'shaved' || head.beard !== 'none';
  return (
    <div className="athlete-head-picker">
      <PictureChoice label="Face" part="face" options={ATHLETE_FACES} value={head.face} onChoose={choose} thumb={(face) => athleteHeadThumb(face, head.hair)} />
      <PictureChoice label="Hair" part="hair" options={ATHLETE_HAIRS} value={head.hair} onChoose={choose} thumb={(hair) => athleteHeadThumb(head.face, hair)} />
      <div className="athlete-head-row">
        <span className="athlete-head-preview" aria-hidden="true">
          <UnrealAthlete fighter={fighter} belt={belt} />
        </span>
        <div className={`swatch-row athlete-hair-colors ${colorUsed ? '' : 'is-unused'}`.trim()} role="group" aria-label="Hair color" data-part="hairColor">
          <span>Hair Color</span>
          <div>
            {ATHLETE_HAIR_COLORS.map((color) => (
              <button
                key={color.id}
                type="button"
                className={`${head.hairColor === color.id ? 'active ' : ''}swatch-color-${color.swatch.replace('#', '')}`.trim()}
                style={{ background: color.swatch }}
                onClick={() => choose('hairColor', color.id)}
                aria-label={`Hair color: ${color.label}`}
                aria-pressed={head.hairColor === color.id}
                aria-describedby={colorUsed ? undefined : noteId}
                data-option={color.id}
              />
            ))}
          </div>
          {!colorUsed && <small id={noteId}>Shows once you add hair or a beard.</small>}
        </div>
        <div className="athlete-head-group athlete-beards" role="group" aria-label="Beard" data-part="beard">
          <span className="athlete-head-label">Beard</span>
          <div className="athlete-head-options text-only">
            {ATHLETE_BEARDS.map((beard) => (
              <button
                key={beard.id}
                type="button"
                className={head.beard === beard.id ? 'active' : ''}
                aria-pressed={head.beard === beard.id}
                data-option={beard.id}
                onClick={() => choose('beard', beard.id)}
              >
                <strong>{beard.label}</strong>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
