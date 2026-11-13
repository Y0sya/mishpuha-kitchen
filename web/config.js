// Fallback data for a browser with no Supabase (dev). On the tablet, people and tiles
// come from the Supabase tables `family`, `tiles` and `chores`.
window.KD_CONFIG = {
  family: [
    { name: 'Mom',   color: '#2a78d6' },
    { name: 'Dad',   color: '#eb6834' },
    { name: 'Yosya', color: '#1baf7a' },
    { name: 'Guest', color: '#6250d6' },
  ],
  // A tile is one chore, or a group:
  //   mode 'split'  → the tile is cut into halves, each its own button (dishwasher: meat | dairy)
  //   mode 'choose' → tapping asks which ones first (trash: recycling, garbage, compost)
  tiles: [
    { name: 'Dishwasher', mode: 'split', chores: [
      { name: 'Meat',  color: '#c9372f' },
      { name: 'Dairy', color: '#2a78d6' },
    ] },
    { name: 'Countertops' },
    { name: 'Sweep' },
    { name: 'Trash', mode: 'choose', chores: [
      { name: 'Recycling', color: '#2a78d6' },
      { name: 'Garbage',   color: '#52514e' },
      { name: 'Compost',   color: '#2e9e5b' },
    ] },
  ],
  // The Tab S3 screen is AMOLED: a static image left on all night burns in.
  // Between these hours the screen goes black; a tap wakes it for 2 minutes.
  night: { from: 23, to: 6 },
};
