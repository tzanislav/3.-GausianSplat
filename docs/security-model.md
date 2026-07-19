# Security model

## Access modes

Owners authenticate with Firebase. The API verifies the Firebase ID token, maps the Firebase UID to a local user and checks project ownership for every private request.

Anonymous viewers authenticate only through a high-entropy share token presented to the public manifest endpoint. The database stores a one-way hash of that token, not the token itself. Share-token authentication is read-only and is never accepted by mutation endpoints.

## Asset delivery

S3 remains private with Block Public Access enabled. The API generates server-side keys and short-lived presigned PUT/GET URLs. For chunked streamed formats, a later CloudFront implementation may use signed cookies. Public clients receive temporary URLs only in a sanitized public manifest.

## Manifest separation and revocation

Owner and public manifests are separate API contracts. Public manifests omit owner identity, internal annotations,
project/scene/asset identifiers, upload metadata, filename fields and any unredacted token. Revoking, disabling or
regenerating a link blocks all future manifest requests. Already-issued asset URLs remain usable only until their
five-minute presigned-GET expiry.

## Operational controls

Never log share tokens, authorization headers, presigned URLs, credentials or Firebase private keys. The public
manifest error path deliberately omits the requested URL, because it contains the bearer token. Validate extensions,
MIME types, magic bytes, file size and ownership before an asset becomes `READY`. Secrets exist only in runtime
environment variables and are excluded from source control.
