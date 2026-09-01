export function transactionTypeLabel(value: string) {
  const normalized = value.replace(/_/g, ' ');
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function transactionDateLabel(value: string | null) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })} · ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })} ET`;
}

export function transactionMovementClass(label: string) {
  if (/^add(?:ed)?$/i.test(label) || /(?:^|\s)receive(?:d|s)?$/i.test(label)) return 'movement-add';
  if (/^drop(?:ped)?$/i.test(label) || /(?:^|\s)(?:send(?:s)?|sent)$/i.test(label)) return 'movement-drop';
  return '';
}
