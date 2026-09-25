# Kwegereza Live Class — standalone service

This is the live-class (video/audio classroom, mediasoup SFU) piece of
Kwegereza, split out from the main API into its own deployable service.

## Why this exists as a separate project

mediasoup needs to compile (or download a matching prebuilt) native C++
worker binary. Shared/cPanel-style hosting typically can't provide the
build tools that requires (a modern C++ compiler, Meson, Ninja), and in
some cases has no matching prebuilt binary at all for its kernel version.
Trying to `npm install` mediasoup as part of the main API on that kind of
host doesn't just fail to add live class — since the main API's
`server.ts` used to load mediasoup unconditionally at boot, it took the
*entire* API down with it.

The fix: live class now runs as this separate service, deployed on a VPS
(or any host with real root access), while the main API goes back to
having zero mediasoup dependency and boots cleanly anywhere.

## How it fits together

- **Same database.** This service does NOT have its own database — it
  connects to the exact same MySQL database as the main API via the same
  `DATABASE_URL`. LiveClass rows, hosts, and attendees are the same real
  Users the main API already knows about.
- **Same JWT secret.** A user logs in once, on the main API. The token
  that login issues is what the frontend then sends here too (as the
  `Authorization` header on REST calls, and as `socket.handshake.auth.token`
  on the live-class socket connection). `JWT_SECRET` here MUST be the
  exact same value as the main API's, or every request will 401 even for
  a genuinely logged-in user.
- **Its own domain.** The frontend talks to this service directly at
  whatever `VITE_LIVE_API_URL` points to (e.g.
  ` https://live_api.kwegereza.org/api`) — completely separate from
  `VITE_API_URL`, which still points at the main API for everything else.

## Deploying

1. Get a host with real root access and the ability to open a wide UDP
   port range (mediasoup needs this for WebRTC media) — a small VPS, not
   shared/cPanel hosting.
2. `cp .env.example .env` and fill in every value — especially
   `DATABASE_URL` and `JWT_SECRET`, which must match the main API exactly,
   and `MEDIASOUP_ANNOUNCED_IP`, which must be this VPS's real public IP.
3. `npm install` — this is where mediasoup actually compiles. On a real
   VPS with `build-essential`, `python3`, `meson`, and `ninja-build`
   installed, this should succeed without the pip/postinstall errors
   cPanel hit.
4. Open `MEDIASOUP_MIN_PORT`-`MEDIASOUP_MAX_PORT` (default 40000-49999)
   for both UDP and TCP in the VPS's firewall, alongside the usual `PORT`.
5. `npm run build && npm start`.
6. Point `VITE_LIVE_API_URL` (on the frontend) and `CORS_ORIGIN` (in this
   service's own `.env`) at each other correctly, then rebuild/redeploy
   the frontend.

## What's deliberately NOT here

Everything unrelated to live class -- auth, books, dars, chat, exams,
students, the admin panel, etc. -- stays on the main API. This service
only has the handful of files live class actually needs: the
liveClassController/liveClassRoutes, the mediasoup worker/room
management, the live-class socket handlers, and the shared utilities
(auth, prisma, email, notifications) those depend on.
