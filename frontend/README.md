# Bookmarks Frontend

React frontend built with Vite, TypeScript, and Tailwind CSS.

## Quick Start

```bash
# From project root
cp .env.example .env
cd frontend
npm install
npm run dev
```

The app runs at http://localhost:5173

## Development vs Production Mode

**Dev mode** (default): Auth0 is disabled, no login required. The frontend reads from the root `.env` file. When `VITE_AUTH0_DOMAIN` is empty, dev mode is active.

**Production mode**: Configure Auth0 in the root `.env`:
```bash
VITE_AUTH0_DOMAIN=your-tenant.auth0.com
VITE_AUTH0_CLIENT_ID=your-client-id
VITE_AUTH0_AUDIENCE=https://bookmarks-api
```

See `/.env.example` for all configuration options.

## Scripts

See `package.json` for available scripts. Key ones:
- `npm run dev` - Start dev server
- `npm run build` - Production build
- `npm run test` - Run tests

## Deployment

The frontend is a static site. To deploy:

1. Set production environment variables (Auth0, API URL)
2. Run `npm run build`
3. Deploy the `dist/` directory to any static host (Vercel, Netlify, S3, etc.)

For the API URL, set `VITE_API_URL` to your deployed backend URL.
