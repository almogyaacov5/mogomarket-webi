# MogoMarket Web

The web version of the MogoMarket Android app. It uses the **same Firebase project**, so the same
account, watchlist and price alerts work on the web and on the phone.

**Stage 1 (this version):** sign in (email or Google), live charts with candle sizes from 1 minute to
1 week (including 65 / 90 minutes, 2h, 4h), volume, MA 20/50/200, Bollinger Bands, RSI and MACD panes,
drawing tools (horizontal line, trend line, Fibonacci), price alerts from the chart, and the watchlist.

Coming in the next stages: portfolio and trading journal, the paper-trading simulator with challenges
and leaderboard, CSV export, AI trade analysis, installable-app polish.

## Run it locally

```bash
npm install
npm run dev
```

Open the address Vite prints. In development `/api/yahoo/*` and `/api/binance/*` are proxied by Vite.

## Deploy on Cloudflare Pages

1. Cloudflare dashboard, Workers & Pages, Create, Pages, Connect to Git, choose this repository.
2. Build command: `npm run build`. Build output directory: `dist`. No environment variables are needed.
3. The `functions/` folder is picked up automatically. `functions/api/[[path]].ts` is a small
   allow-listed proxy for Yahoo Finance and Binance market data (browsers cannot call Yahoo directly).

## Firebase setup (one time)

- **Authorized domains:** Firebase console, Authentication, Settings, Authorized domains, add your
  `*.pages.dev` address (and your own domain if you use one). Without it Google sign-in is refused.
- **Web API key:** `src/firebase-config.ts` holds the project's public web configuration. If sign-in
  fails with "API key not valid" or a referrer error, the key is restricted to Android. Register a Web
  app (Project settings, Your apps, Web) and paste its config into that file.
- **Rules:** the app reads and writes `users/{uid}/watchlist-stocks`. Your Realtime Database rules
  should only let a signed-in user access their own `users/{uid}` node.

## Notes

- Market data comes from Yahoo Finance (stocks, forex, commodities) and Binance (crypto). Intraday
  history is limited by the providers: 1 minute about 5 days, up to 30 minutes about 1 month, 1 hour and
  above about 1 year. The visible range is clamped automatically.
- Drawings are stored in the browser (`localStorage`) per symbol. Alerts are stored in Firebase.
- Not investment advice.
