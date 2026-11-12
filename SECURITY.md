# Security

<!-- reviewed: 2026-11-10 -->

## The model: no sign-in, a private network

TEF Notes has **no authentication**. The migration `server/pb_migrations/1792400000_open.js` opens every collection
(notes, attachments, tasks, chats and the rest) to unauthenticated requests, and file URLs are public so a
photo needs no token. Anyone who can reach the server's port can read, write and delete everything, and the chat agent
(which has tools over your notes) is reachable the same way. This is deliberate: the network is the only gate. A login
on every device would add friction without keeping out anyone the network does not already.

## What "private network" means in practice

- PocketBase (`PB_PORT`) and the agent (`AGENT_PORT`) are published on `127.0.0.1` only. Keep it that way; do not change
  the compose file to bind `0.0.0.0`.
- Reach the server from your devices through a reverse proxy that is itself only reachable from a network you control,
  such as a VPN or a Tailscale tailnet (the author uses Tailscale Serve over HTTPS).
- Every device that can reach that proxy, and every other service on the same network that could be compromised, can
  read and delete your notes. Share the network only with people you would hand your notes to.
- **Never** expose it publicly: no router port forward, no public reverse proxy or tunnel, no Tailscale Funnel.
- Docker's published ports are not filtered by every host firewall. Check from another machine on your LAN that the
  ports are not reachable unless you meant them to be.
- The PocketBase admin dashboard (`/_/`) has its own superuser sign-in. Set a strong password.
- Notes, photos you attach, and pages you clip go to the AI providers you configure (see the README's "AI providers");
  leave a provider's key out to keep that traffic off. Provider keys are files under `server/keys/` or the paths in
  `server/.env`, mounted read-only; keep them out of git and out of backups you share.
- Place search sends what you type in a note's Where, and the assistant's place queries, to OpenStreetMap's public
  services (Photon, Nominatim; the map's tiles by position); the place picked is kept in the note's frontmatter. A place
  typed by name alone sends nothing.
- Voice input stays on your server: the browser posts the recording to your agent, which hands it to the `stt` container
  on the compose network (no port on the host); neither keeps it, and the text goes only into the field you dictated into.
- Talk does leave your server: with a Gemini key set, what you say, and whatever the assistant reads to answer (notes,
  tasks, the notes index), goes to Google's Gemini Live API for as long as a conversation is open. No audio is stored
  on your server. A write still asks with a card, and only a tap confirms it: nothing the model heard counts. Talk's
  WebSocket has no browser preflight to keep other websites out, so the agent refuses an upgrade whose `Origin` is not
  the server's own host; a proxy in front must pass `Host` or `X-Forwarded-Host` through. Leave the key out to keep
  Talk off.
- The link-preview and clip-image routes fetch URLs from your server. They refuse private and loopback addresses at every
  redirect hop; report any bypass. The push route posts to a subscribed browser's push-service URL (https, and its name
  resolved and checked as public before every send); it stores at most 20 devices.
- TEF Notes has no backups of its own. See the README's "Backups".

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: on this repository, open the **Security** tab and choose **Report a
vulnerability** (a security advisory). Please do not open a public issue for a vulnerability. There is no email address
for reports.

In scope: bypasses of the loopback-only binding or the link-preview address check, ways a web page can make the chat agent
write without confirmation, ways a CLI write made with `TEF_NOTES_AGENT=1` escapes the `tainted` mark, key disclosure, and flaws in the `rev` write contract that lose data. Out of scope: the
absence of sign-in, which is the documented model.
