import { createElement, Fragment } from 'react';
import { stepRuns } from '../data/techniqueSteps.js';

export function RichText({ runs }) {
  return createElement(Fragment, null, ...runs.map((run, index) =>
    run.bold ? createElement('strong', { key: index }, run.text) : run.text));
}

export function TechniqueStep({ move, step }) {
  return createElement(RichText, { runs: stepRuns(move, step) });
}
