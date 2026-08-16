import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('sanity check infrastruttura di test', () => {
  it('jsdom + testing-library funzionano', () => {
    render(<div>ok</div>);
    expect(screen.getByText('ok')).toBeInTheDocument();
  });
});
