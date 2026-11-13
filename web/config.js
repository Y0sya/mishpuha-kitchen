// Who lives here and which chores get tiles. Edit freely; order = order on screen.
// Colours come from the life-tracker palette (distinct in light and dark).
window.KD_CONFIG = {
  family: [
    { name: 'Mom',   color: '#2a78d6' },
    { name: 'Dad',   color: '#eb6834' },
    { name: 'Yosya', color: '#1baf7a' },
    { name: 'Guest', color: '#6250d6' },
  ],
  // The Tab S3 screen is AMOLED: a static image left on all night burns in.
  // Between these hours the screen goes black; a tap wakes it for 2 minutes.
  night: { from: 23, to: 6 },
  // Fallback lists for when Supabase isn't set up (dev in a browser).
  chores: [
    'Dishes',
    'Dishwasher',
    'Trash',
    'Recycling',
    'Laundry',
    'Sweep',
    'Counters',
    'Plants',
  ],
};
