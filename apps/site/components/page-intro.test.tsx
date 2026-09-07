import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { League } from '../lib/types';
import { PageIntro } from './page-intro';

const league: League = { season: '2026', week: 1, maxWeek: 18, rosterPositions: [] };

describe('PageIntro', () => {
  it('renders the page title before the uppercase-styled season label', () => {
    const markup = renderToStaticMarkup(<PageIntro title="Standings" league={league} />);

    expect(markup).toMatch(/data-page-intro="true"><h1>Standings<\/h1><p[^>]*>2026 season<\/p><\/div>/u);
    expect(markup).not.toContain('The league, at a glance.');
  });
});
