# Kwegereza Live Class — standalone service

This is the live-class (audio classroom + screen share) piece of
Kwegereza, split out from the main API into its own deployable service.

## Architecture

This service has **no database of its own at all**. Everything that
needs persistence -- class records, attendance, notification fan-out,
activity tracking, even re-validating that a logged-in user is still
active -- goes through the main `Kwegereza-BackEnd`'s **internal API**
(`src/utils/internalApi.ts` on this side, `src/routes/internalRoutes.ts`
on the main API's), reached purely over HTTPS with a shared secret.
There is no direct MySQL connection from this service at all, and
nothing here ever needs `DATABASE_URL`.

Real-time media (audio publish/subscribe, screen share) is handled by a
separately-hosted **LiveKit** server (self-hosted, or LiveKit Cloud) --
this service never runs that itself either, it's purely a client of it
via `livekit-server-sdk`:

- **Issuing access tokens** — when a student or host joins a class
  (`classroom:join`), this service mints a LiveKit JWT encoding exactly
  what that person is allowed to do (subscribe always; publish mic/
  screen-share only if the host has approved it, or always for the
  host). The browser then uses that token to connect to LiveKit
  *directly* — media never flows through this backend at all.
- **Host controls as real server-side grants** — approving a raised
  hand, muting someone, or approving a screen-share request calls
  LiveKit's management API (`RoomServiceClient`) to change that
  participant's actual permissions on LiveKit's own server, enforced by
  LiveKit itself.
- **Attendance, raise-hand, chat, lock/unlock, chat-moderator
  delegation, and participant presence** are still plain Socket.IO
  events against this service's own in-memory classroom state, with any
  actual persistence (attendance rows, activity events) going through
  the internal API rather than a local database write.

Camera/video has been removed entirely, per spec — this is audio +
optional screen-share only, never a camera feed.

## What calling the internal API instead of a database means

- **One real trade-off**: user re-validation (is this account still
  active, has its tokenVersion changed) used to be a direct database
  read on every request and socket connection. It's now a network call
  to the main API, cached for 20 seconds (see `src/utils/internalApi.ts`
  and `src/middleware/auth.ts`) to avoid hammering that endpoint. This
  means a block/suspend takes up to ~20 seconds to actually take effect
  here, not instantly, which is a deliberate, understood trade-off
  against this service having no database to read from directly.
- **This service going down affects nothing else** — it has no
  migrations, no schema, nothing to get out of sync. It's pure logic
  plus two HTTP clients (the main API, and LiveKit).

## How it fits together

- **Same JWT secret.** A user logs in once, on the main API. The token
  that login issues is what the frontend then sends here too (as the
  `Authorization` header on REST calls, and as `socket.handshake.auth.token`
  on the live-class socket connection). `JWT_SECRET` here MUST be the
  exact same value as the main API's.
- **Same internal API secret.** `INTERNAL_API_SECRET` here MUST match
  the main API's own exactly -- it's how the main API knows these
  server-to-server calls are genuinely from this service and not an
  open, unauthenticated backdoor into its data.
- **A separate LiveKit server.** Reached two ways: this backend calls
  its management API server-to-server (`LIVEKIT_API_HOST`), and the
  browser connects to it directly for media (`LIVEKIT_URL`, handed to
  the frontend as part of the `classroom:join` response).
- **Its own domain.** The frontend talks to THIS service directly at
  whatever `VITE_LIVE_API_URL` points to -- completely separate from
  `VITE_API_URL`, which still points at the main API for everything else.

## Deploying

1. `cp .env.example .env` and fill in every value -- especially
   `JWT_SECRET` and `INTERNAL_API_SECRET`, which must match the main API
   exactly, `MAIN_API_INTERNAL_URL` (that API's real, reachable base
   URL), and `LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`, which
   must match your actual LiveKit deployment.
2. `npm install && npm run build && npm start`. No native module to
   compile, no database to migrate -- this runs anywhere a normal Node
   process does.
3. Point `VITE_LIVE_API_URL` (on the frontend) and `CORS_ORIGIN` (in
   this service's own `.env`) at each other correctly.
4. On the main API's side, make sure `INTERNAL_API_SECRET` is set there
   too, to the exact same value.
5. Separately, stand up your LiveKit server per LiveKit's own deployment
   docs, and point `LIVEKIT_URL`/`LIVEKIT_API_HOST`/`LIVEKIT_API_KEY`/
   `LIVEKIT_API_SECRET` at it.

## What's deliberately NOT here

Everything unrelated to live class -- auth's own persistence, books,
dars, chat, exams, students, the admin panel, etc. -- stays on the main
API, which also now owns ALL the persistence this service used to have
directly (see src/controllers/internalController.ts there). This
service only has the handful of files live class actually needs: the
liveClassController/liveClassRoutes, the LiveKit token/permission
helper, the internal API client, the live-class socket handlers, and
the shared utilities (JWT verification, email) those depend on.
