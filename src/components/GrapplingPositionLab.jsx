import { useState } from 'react';
import { ArrowLeftRight, Check, Compass, Info, RotateCcw } from 'lucide-react';
import GrapplingSnapshotStage from './GrapplingSnapshotStage.jsx';
import { createArenaState } from '../arena/outcome.js';
import './GrapplingPositionLab.css';

const POSITIONS = [
  {
    id: 'standing', name: 'Standing', detail: 'Balanced grips', neutral: true,
    tip: 'Both athletes are on their feet, sharing a balanced grip exchange. Neither athlete has secured top position.',
  },
  {
    id: 'kneeling', name: 'Kneeling start', detail: 'Neutral ground start', neutral: true,
    tip: 'Both athletes begin on their knees with grips established. This is a neutral starting position, before either athlete takes control.',
  },
  {
    id: 'guard-top', name: 'Closed guard', detail: 'Legs around the waist',
    tip: 'The bottom athlete closes both legs around the other athlete’s waist. Being on top here does not mean the guard has been passed.',
  },
  {
    id: 'half-guard-top', name: 'Half guard', detail: 'One leg still trapped',
    tip: 'The bottom athlete traps one of the top athlete’s legs between both legs. That trapped leg distinguishes half guard from side control.',
  },
  {
    id: 'side-top', name: 'Side control', detail: 'Chest across the torso',
    tip: 'The top athlete is past the legs and controls the torso from the side. The bottom athlete’s legs no longer surround the top athlete.',
  },
  {
    id: 'mount-top', name: 'Mount', detail: 'Knees beside the torso',
    tip: 'The top athlete straddles the torso, with a knee on either side. This makes the top and bottom roles easy to distinguish.',
  },
  {
    id: 'back-control', name: 'Back control', detail: 'Seatbelt and inside hooks',
    tip: 'The controlling athlete sits behind the defender with chest-to-back contact, a seatbelt grip, and two inside hooks. Control is from behind rather than from above.',
  },
  {
    id: 'turtle-top', name: 'Turtle control', detail: 'Control over a compact base',
    tip: 'The defender is on knees and forearms in a compact turtle position. The other athlete controls from outside; back control has not yet been secured.',
  },
];

function roleDescription(position, side) {
  if (position.neutral) return 'Neutral position. You are the athlete on the left.';
  const subject = side === 'fighter' ? 'You' : 'Your opponent';
  if (position.id === 'back-control') return `${subject} ${side === 'fighter' ? 'control' : 'controls'} the back.`;
  if (position.id === 'turtle-top') return `${subject} ${side === 'fighter' ? 'control' : 'controls'} from outside turtle.`;
  return `${subject} ${side === 'fighter' ? 'are' : 'is'} on top.`;
}

export default function GrapplingPositionLab({ fighter, opponent, beltStatus, notify }) {
  const [positionId, setPositionId] = useState('standing');
  const [controller, setController] = useState('fighter');
  const [feedback, setFeedback] = useState('Choose a position to explore its shape and control.');
  const position = POSITIONS.find((item) => item.id === positionId);
  const state = createArenaState(position.id, controller);
  const isBackControl = position.id === 'back-control';
  const role = roleDescription(position, controller);

  const report = (message) => {
    setFeedback(message);
    notify?.(message, 'success');
  };

  const choosePosition = (nextPosition) => {
    setPositionId(nextPosition.id);
    report(`${nextPosition.name} selected. ${roleDescription(nextPosition, controller)}`);
  };

  const chooseController = (side) => {
    setController(side);
    report(`${position.name}: ${roleDescription(position, side)} Gi colors follow each athlete.`);
  };

  const reset = () => {
    setPositionId('standing');
    setController('fighter');
    report('Neutral standing position selected. You are the athlete on the left.');
  };

  return (
    <section className="grappling-lab-grid grappling-position-lab" aria-label="Grappling position lab">
      <header className="panel position-lab-header">
        <div>
          <span className="position-lab-eyebrow"><Compass size={15} aria-hidden="true" />Arena study</span>
          <h1>Position Lab</h1>
          <p>Explore eight settled grappling positions with your current appearance.</p>
        </div>
        <span className="position-lab-level">{beltStatus?.belt ? `${beltStatus.belt} belt progression` : 'Your position library'}</span>
      </header>

      <div className="panel position-lab-viewer">
        <div className="position-lab-viewer-heading">
          <div><h2>{position.name}</h2><p>{role}</p></div>
          <button className="position-lab-reset" onClick={reset} aria-label="Reset the position lab to neutral standing">
            <RotateCcw size={15} aria-hidden="true" /><span>Reset</span>
          </button>
        </div>
        <GrapplingSnapshotStage state={state} fighter={fighter} opponent={opponent} fighterBelt={beltStatus} compact />
        <div className="position-lab-observation">
          <Info size={16} aria-hidden="true" />
          <p>{position.tip}</p>
        </div>
      </div>

      <aside className="panel position-lab-controls" aria-label="Position controls">
        <div className="position-lab-control-heading"><h2>Choose a position</h2><span>{POSITIONS.length} views</span></div>
        <div className="position-lab-options">
          {POSITIONS.map((item, index) => (
            <button key={item.id} type="button" aria-pressed={positionId === item.id}
              className={`position-lab-option ${positionId === item.id ? 'is-selected' : ''}`}
              onClick={() => choosePosition(item)}>
              <span className="position-lab-number">{String(index + 1).padStart(2, '0')}</span>
              <span className="position-lab-option-copy"><span>{item.name}</span><small>{item.detail}</small></span>
              {positionId === item.id && <Check size={15} aria-hidden="true" />}
            </button>
          ))}
        </div>

        <fieldset className="position-lab-role" disabled={position.neutral}>
          <legend><ArrowLeftRight size={14} aria-hidden="true" />{position.neutral ? 'Neutral start' : isBackControl ? 'Who controls the back?' : 'Who is on top?'}</legend>
          <div>
            <button type="button" aria-pressed={controller === 'fighter' && !position.neutral}
              onClick={() => chooseController('fighter')}>
              {position.neutral ? 'You · left' : isBackControl ? 'You control' : 'You on top'}
            </button>
            <button type="button" aria-pressed={controller === 'opponent' && !position.neutral}
              onClick={() => chooseController('opponent')}>
              {position.neutral ? 'Opponent · right' : isBackControl ? 'Opponent controls' : 'Opponent on top'}
            </button>
          </div>
          {position.neutral && <p>Neutral view · you are on the left.</p>}
        </fieldset>

        <p className="position-lab-feedback" role="status" aria-live="polite" aria-atomic="true">{feedback}</p>
        <p className="position-lab-note">These snapshots show settled positions. Find technique steps and practice guidance in Training.</p>
      </aside>
    </section>
  );
}
