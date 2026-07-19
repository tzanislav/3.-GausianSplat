# Environment contract

`.env.example` is the canonical list of environment variable names. Empty values are intentional placeholders; production values are supplied by the deployment environment and are never committed.

| Variable group                   | Used by     | Required from |
| -------------------------------- | ----------- | ------------- |
| `NODE_ENV`, `PORT`, `WEB_ORIGIN` | API         | Phase 1       |
| `MONGODB_URI`                    | API, worker | Phase 4       |
| `FIREBASE_*`, `VITE_FIREBASE_*`  | API, web    | Phase 3       |
| `AWS_*`                          | API, worker | Phase 5       |

`FIREBASE_PRIVATE_KEY` and `AWS_CLOUDFRONT_PRIVATE_KEY` may contain escaped newlines. The future config package must normalize them after parsing and must fail fast in production when a required variable is missing.
