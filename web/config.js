// Fallback data for a browser with no Supabase (dev). On the tablet, people and tiles
// come from the Supabase tables `family`, `tiles` and `chores`.
window.KD_CONFIG = {
  // initials: what shows in the coloured circle (default: first letter of the name).
  family: [
    { name: 'Mama',       color: '#2a78d6' },
    { name: 'Papa',       color: '#eb6834' },
    { name: 'Yosya',      color: '#1baf7a', initials: 'Y' },
    { name: 'David',      color: '#6250d6', initials: 'DY' },
    { name: 'Shmulik',    color: '#c98500' },
    { name: 'Yoni',       color: '#0f9fb5', initials: 'YS' },
    { name: 'Sara Bella', color: '#d6409f', initials: 'SB' },
  ],
  // A tile is one chore, or a group:
  //   mode 'split'  → the tile is cut into halves, each its own button (dishwasher: meat | dairy)
  //   mode 'choose' → tapping asks which ones first (trash: recycling, garbage, compost)
  // icon = a key of window.KD_ICONS (icons.js). The name is only read aloud / used as a fallback.
  tiles: [
    { name: 'Dishwasher', icon: 'dishwasher', mode: 'split', chores: [
      // actions: asked first (plus "Both"), one log row per action.
      { name: 'Meat',  icon: 'meat',  color: '#c9372f', actions: ['Unload', 'Reload'] },
      { name: 'Dairy', icon: 'dairy', color: '#2a78d6', actions: ['Unload', 'Reload'] },
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
  // Candle lighting and havdalah times from hebcal.com. 6173577 = Vaughan, Ontario.
  hebcal: { geonameid: 6173577 },
  // Where the sky is drawn from (stars and moon in their real positions).
  place: { lat: 43.8361, lon: -79.4983 },
  // PIN for the gear (Settings). Only keeps little fingers out; this file is public.
  settingsPin: '0905',
  // The Tab S3 screen is AMOLED: a static image left on all night burns in.
  // Between these hours the screen goes black; a tap wakes it for 2 minutes.
  night: { from: 23, to: 6 },
};
