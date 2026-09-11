// ---------------------------------------------------------------------
// Wolfie's Watch — site config
// ---------------------------------------------------------------------

// Shared schedule storage (Firebase Realtime Database — free tier, no
// login required for visitors). Paste in your database's URL here
// (e.g. "https://wolfies-watch-default-rtdb.firebaseio.com") and
// commit, so every friend's browser reads/writes the SAME schedule.
// See README.md for one-time Firebase setup steps.
window.FIREBASE_DB_URL = "https://wolfie-s-watch-default-rtdb.firebaseio.com";

// The days Wolfie needs a sitter. Edit these if the trip dates change.
window.TRIP_DAYS = [
  { date: "2026-09-14", label: "MON", sub: "Sept 14" },
  { date: "2026-09-15", label: "TUE", sub: "Sept 15" },
  { date: "2026-09-16", label: "WED", sub: "Sept 16" },
  { date: "2026-09-17", label: "THU", sub: "Sept 17" },
  { date: "2026-09-18", label: "FRI", sub: "Sept 18" },
  { date: "2026-09-19", label: "SAT", sub: "Sept 19" },
];

// Activity types shown in the "claim a quest" form and on quest cards.
window.ACTIVITY_TYPES = [
  { value: "letout", label: "Let Him Out", icon: "🚪" },
  { value: "walk", label: "Walk", icon: "🐕" },
  { value: "park", label: "Park Trip", icon: "🌳" },
  { value: "feed", label: "Feed", icon: "🍖" },
  { value: "play", label: "Playtime", icon: "🎾" },
  { value: "overnight", label: "Overnight Stay", icon: "🌙" },
  { value: "other", label: "Other Quest", icon: "⭐" },
];

// Wolfie's meal menu — edit amounts/times to match his real routine!
window.MEAL_MENU = [
  {
    course: "Sunrise Fare",
    time: "~7:00–8:00 AM",
    items: ["Sizzlin' Beggin' Strip Bacon"],
    icon: "🥣",
  },
  {
    course: "The Noon Table",
    time: "~12:00 PM (long days only)",
    items: ["Sizzlin' Beggin' Strip Bacon", "Prospector Water", "Lunch Time Kibble"],
    icon: "🦴",
  },
  {
    course: "Homestead Supper",
    time: "~5:30–6:30 PM",
    items: ["Cowboy Thanksgiving — High-Desert Roasted Turkey & Ma's Sweet Potatoes"],
    icon: "🍖",
  },
  {
    course: "Dessert Round",
    time: "after walks / good behavior",
    items: ["1–2 small treats", "no table scraps, please!"],
    icon: "🍰",
  },
];
