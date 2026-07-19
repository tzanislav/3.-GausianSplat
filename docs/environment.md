# Environment contract

`.env.example` is the canonical list of environment variable names. Empty values are intentional placeholders; production values are supplied by the deployment environment and are never committed.

| Variable group                   | Used by         | Required from |
| -------------------------------- | --------------- | ------------- |
| `NODE_ENV`, `PORT`, `WEB_ORIGIN` | API             | Phase 1       |
| `MONGODB_URI`                    | API, worker     | Phase 4       |
| `FIREBASE_*`, `VITE_FIREBASE_*`  | API, web        | Phase 3       |
| `AWS_*`                          | API, worker     | Phase 5       |
| `LOCAL_DEV_IP`                   | Vite dev server | Optional      |

`FIREBASE_PRIVATE_KEY` and `AWS_CLOUDFRONT_PRIVATE_KEY` may contain escaped newlines. The future config package must normalize them after parsing and must fail fast in production when a required variable is missing.

For phone testing, set `LOCAL_DEV_IP` in the uncommitted root `.env` to the computer's LAN IPv4 address, then restart
`pnpm dev` and browse to `http://<LOCAL_DEV_IP>:5173` from the phone. Vite binds to all local interfaces only when this
opt-in variable is set; its API proxy still talks to the API over loopback. If Google sign-in is used on the phone, add
the LAN IP to Firebase Authentication's authorized domains first.
