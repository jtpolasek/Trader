Act as an expert Senior React & Tailwind CSS Frontend Developer. 

I need you to refactor my existing crypto wallet copy trading website UI. The backend state handles the data; your task is to build a high-performance, beautiful, Web3-native frontend presentation layer using React and Tailwind CSS.

### 1. Visual Theme & Layout Architecture
- Create a modern, dashboard grid layout using a strict obsidian dark theme (e.g., bg-slate-950 or bg-[#020617]).
- Use text-slate-400 for secondary text, text-emerald-400 for positive gains/buys, and text-rose-500 for losses/sells.
- Structure the page using a main wrapper: `<div className="min-h-screen bg-slate-950 text-slate-100 font-sans">`

### 2. Main Layout Components (Build as modular React components)

A. Navigation Bar (<Navbar />):
- Use `flex justify-between items-center px-6 py-4 border-b border-slate-800 bg-slate-900/50 backdrop-blur-md`.
- Left: Logo and clickable NavLinks ([Leaderboard], [My Copies], [Analytics]) using `hover:text-teal-400 transition-colors`.
- Right: A sleek Web3 wallet button state (`px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 font-semibold transition-all`). Include a small green pulsing circle inside it (`animate-pulse`).

B. Top Section: Leaderboard Table (<LeaderboardTable />):
- Display a clean custom `<table>` layout inside a rounded card structure (`bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden`).
- Columns to map over mock data array: Wallet Address, 7D ROI, Win Rate, Risk Score, and Copy Action.
- Add an interactive "One-Click Copy" button on each row. Use a local React `useState` array to track which wallets are actively being clicked, turning the button into a spinning loading spinner or an active pulsing state when toggled.
- Mask wallet addresses using a helper function like `${address.slice(0, 6)}...${address.slice(-4)}` styled with `font-mono`.

C. Split Bottom Layout Section (`grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6`):
- Left Columns (Occupies `lg:col-span-2` for <ActivePositions />): 
  * A responsive card-grid container mapping active copied wallets.
  * Each card needs simple control toggles: Pause/Resume (`text-amber-500 hover:bg-amber-500/10`), Custom Slippage Input field, and a Stop button (`text-rose-500 hover:bg-rose-500/10`).
- Right Column (Occupies `lg:col-span-1` for <LiveActivityFeed />):
  * A scrollable live ticker widget (`max-h-[400px] overflow-y-auto`).
  * Use a React `useEffect` interval hook to systematically push fresh transaction notifications into the feed every 3-5 seconds to mimic active live blockchain streaming activity.
  * Badges must feature bright background opacities (`bg-emerald-500/10 text-emerald-400` for BUY or `bg-rose-500/10 text-rose-400` for SELL).

### 3. Component Details & Micro-Interactions
- Ensure smooth animations using simple Tailwind transition classes (`transition-all duration-300 ease-in-out`).
- All table rows must highlight on hover using `hover:bg-slate-900/60 cursor-pointer`.

Please rewrite the frontend dashboard layout, utilizing completely native React state hooks and utility Tailwind styles. Ensure the code is production-ready, clean, and beautifully organized.
