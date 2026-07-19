# Security model

## Access modes

Owners authenticate with Firebase. The API verifies the Firebase ID token, maps the Firebase UID to a local user and checks project ownership for every private request.

Anonymous viewers authenticate only through a high-entropy share token presented to the public manifest endpoint. The database stores a one-way hash of that token, not the token itself. Share-token authentication is read-only and is never accepted by mutation endpoints.

## Asset delivery

S3 remains private with Block Public Access enabled. The API generates server-side keys and short-lived presigned PUT/GET URLs. For chunked streamed formats, a later CloudFront implementation may use signed cookies. Public clients receive temporary URLs only in a sanitized public manifest.

## Manifest separation and revocation

Owner and public manifests are separate API contracts. Public manifests omit owner identity, internal annotations, asset storage keys, upload metadata and any unredacted token. Revoking a link blocks all future manifest requests. Already-issued asset URLs remain usable until their documented short expiry; Phase 10 must set and document that expiry.

## Operational controls

Never log share tokens, authorization headers, presigned URLs, credentials or Firebase private keys. Validate extensions, MIME types, magic bytes, file size and ownership before an asset becomes `READY`. Secrets exist only in runtime environment variables and are excluded from source control.
