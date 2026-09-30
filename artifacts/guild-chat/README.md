# Guild Chat

Guild Chat is a group-only chat app built for Cloudflare Workers. The Worker
serves the Vite-built site, stores accounts/groups/messages in D1, and uses one
Durable Object per group for live chat and online-member counts.

## Replit preview

The `web` and `worker` artifact workflows run the UI and local Cloudflare Worker.
The local D1 database is stored under `.wrangler/state` and is ignored by Git.

## Deploy to Cloudflare

Use Wrangler with a Cloudflare account that has Workers and D1 enabled:

```sh
pnpm exec wrangler login
pnpm --filter @workspace/guild-chat run cf:build
pnpm --filter @workspace/guild-chat run cf:deploy
```

The first deploy provisions the D1 database and Durable Object namespace from
`wrangler.toml`. Apply the initial schema to the newly provisioned remote D1:

```sh
pnpm --filter @workspace/guild-chat exec wrangler d1 migrations apply guild-chat --remote --config wrangler.toml
```

After that, the app is ready to serve traffic. For later schema changes, apply
the new D1 migration remotely before deploying the Worker:

```sh
pnpm --filter @workspace/guild-chat exec wrangler d1 migrations apply guild-chat --remote --config wrangler.toml
pnpm --filter @workspace/guild-chat run cf:build
pnpm --filter @workspace/guild-chat run cf:deploy
```

The Worker uses opaque, HttpOnly session cookies and PBKDF2-SHA-256 password
hashes. Signup requires a 12-character password containing uppercase,
lowercase, numeric, and symbol characters. Handles are unique and stored
without the display-only `@` prefix.