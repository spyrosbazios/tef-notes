# Security

<!-- reviewed: 2026-11-05 -->

## The model: no sign-in, a private network

TEF Notes has **no authentication**. The migration `server/pb_migrations/1792400000_open.js` opens every collection
(notes, attachments, tasks, chats and the rest) to unauthenticated requests, and file URLs are public so a
photo needs no token. Anyone who can reach the server's port can read, write and delete everything, and the chat agent
(which has tools over your notes) is reachable the same way, as is its optional MCP endpoint (`/agent/mcp`, off
unless `TEF_NOTES_MCP=1`), which writes without confirm cards and leaves approval to the connected harness. This is deliberate: the network is the only gate. A login
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
- The link-preview and clip-image routes fetch URLs from your server. They refuse private and loopback addresses at every
  redirect hop; report any bypass.
- TEF Notes has no backups of its own. See the README's "Backups".

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: on this repository, open the **Security** tab and choose **Report a
vulnerability** (a security advisory). Please do not open a public issue for a vulnerability. There is no email address
for reports.

In scope: bypasses of the loopback-only binding or the link-preview address check, ways a web page can make the chat agent
write without confirmation, ways an MCP write escapes the `tainted` mark, key disclosure, and flaws in the `rev` write contract that lose data. Out of scope: the
absence of sign-in, which is the documented model.
