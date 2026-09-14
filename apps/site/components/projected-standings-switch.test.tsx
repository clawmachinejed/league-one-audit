import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProjectedStandingsSwitch } from './projected-standings-switch';

describe('Projected standings switch accessibility', () => {
  it.each([
    { checked: false, status: 'Week 1 · Off' },
    { checked: true, status: 'Week 1 · Live' },
  ])('announces its stable name, $checked state, and current status', ({ checked, status }) => {
    const html = renderToStaticMarkup(<ProjectedStandingsSwitch checked={checked} onChange={() => {}} status={status} />);
    expect(html).toMatch(/^<button type="button"[^>]*role="switch"/u);
    expect(html).toContain('aria-label="Projected standings"');
    expect(html).toContain(`aria-checked="${checked}"`);
    const statusId = /aria-describedby="([^"]+)"/u.exec(html)?.[1];
    expect(statusId).toBeTruthy();
    expect(html).toContain(`id="${statusId}"`);
    expect(html).toContain(`aria-live="polite" aria-atomic="true">${status}</span>`);
    expect(html).toContain('>Projected standings</span>');
  });
});
