// Fallback data for a browser with no Supabase (dev). On the tablet, people and tiles
// come from the Supabase tables `family`, `tiles` and `chores`.
window.KD_CONFIG = {
  family: [
    { name: 'Mama',       color: '#2a78d6' },
    { name: 'Papa',       color: '#eb6834' },
    { name: 'Yosya',      color: '#1baf7a' },
    { name: 'David',      color: '#6250d6' },
    { name: 'Shmulik',    color: '#c98500' },
    { name: 'Yoni',       color: '#0f9fb5' },
    { name: 'Sara Bella', color: '#d6409f' },
  ],
  // A tile is one chore, or a group:
  //   mode 'split'  → the tile is cut into halves, each its own button (dishwasher: meat | dairy)
  //   mode 'choose' → tapping asks which ones first (trash: recycling, garbage, compost)
  // icon = a key of window.KD_ICONS (icons.js). The name is only read aloud / used as a fallback.
  tiles: [
    { name: 'Dishwasher', icon: 'dishwasher', mode: 'split', chores: [
      { name: 'Meat',  icon: 'meat',  color: '#c9372f' },
      { name: 'Dairy', icon: 'dairy', color: '#2a78d6' },
    ] },
    { name: 'Table', icon: 'table', mode: 'split', chores: [
      { name: 'Set up', icon: 'setup', color: '#1baf7a' },
      { name: 'Clean',  icon: 'clean', color: '#c98500' },
    ] },
    { name: 'Dinner', icon: 'dinner' },
    { name: 'Countertops', icon: 'countertops' },
    { name: 'Sweep', icon: 'sweep' },
    { name: 'Trash', icon: 'trash', mode: 'choose', chores: [
      { name: 'Recycling', icon: 'recycling', color: '#2a78d6' },
      { name: 'Garbage',   icon: 'garbage',   color: '#52514e' },
      { name: 'Compost',   icon: 'compost',   color: '#2e9e5b' },
    ] },
  ],
  // The Tab S3 screen is AMOLED: a static image left on all night burns in.
  // Between these hours the screen goes black; a tap wakes it for 2 minutes.
  night: { from: 23, to: 6 },
};
