import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { League } from '../lib/types';
import { PageIntro } from './page-intro';

const league: League = { season: '2026', week: 1, maxWeek: 18, rosterPositions: [] };

describe('PageIntro', () => {
  it.each(['Matchups', 'Standings', 'Managers'])('renders the %s title before the uppercase-styled season label', (title) => {
    const markup = renderToStaticMarkup(<PageIntro title={title} league={league} />);

    expect(markup).toContain(`data-page-intro="true"><h1>${title}</h1>`);
    expect(markup).toMatch(/<\/h1><p[^>]*>2026 season<\/p><\/div>/u);
    expect(markup).not.toContain('The league, at a glance.');
    expect(markup).not.toContain('The people and teams of');
  });
});
