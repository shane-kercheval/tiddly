# Bookmarks Frontend

React frontend for the Bookmarks application, built with Vite, TypeScript, and Tailwind CSS.

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Start development server
npm run dev
```

The app will be available at http://localhost:5173

## Development Mode

When Auth0 environment variables are not configured (empty in `.env`), the app runs in **dev mode**:
- No authentication required
- Redirects directly to dashboard
- Shows "Dev Mode" indicator in the UI

For dev mode to work, the backend must also have `DEV_MODE=true`.

## Production Mode

Configure Auth0 in `.env`:

```bash
VITE_AUTH0_DOMAIN=your-tenant.auth0.com
VITE_AUTH0_CLIENT_ID=your-client-id
VITE_AUTH0_AUDIENCE=https://bookmarks-api
```

## Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm run preview` - Preview production build locally
- `npm run lint` - Run ESLint
- `npm run test` - Run tests in watch mode
- `npm run test:run` - Run tests once

## Project Structure

```
src/
├── components/     # Reusable components
│   ├── AuthProvider.tsx
│   ├── Layout.tsx
│   └── ProtectedRoute.tsx
├── pages/          # Page components
│   ├── Dashboard.tsx
│   └── LandingPage.tsx
├── services/       # API and external services
│   └── api.ts
├── hooks/          # Custom React hooks
├── test/           # Test setup and utilities
├── config.ts       # App configuration
├── App.tsx         # Main app with routing
└── main.tsx        # Entry point
```

## Tech Stack

- **React 19** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Tailwind CSS v4** - Styling
- **React Router v7** - Routing
- **Auth0 React SDK** - Authentication
- **Axios** - HTTP client
- **Vitest** - Testing
