# Private asset bucket

Deploy `private-assets-bucket.yaml` once per development environment, supplying a globally unique
`BucketName` and the exact `WebOrigin`. The template blocks public access, enforces bucket ownership,
encrypts objects with S3-managed keys and allows only the browser headers used by the signed PUT flow.

For example:

```powershell
aws cloudformation deploy --stack-name gaussian-viewer-dev-assets --template-file infra/aws/private-assets-bucket.yaml --parameter-overrides BucketName=<unique-bucket-name> WebOrigin=http://localhost:5173
```

Set the resulting bucket name, region and a least-privilege API credential in the uncommitted `.env` as
`AWS_S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. The API credential needs
`s3:PutObject`, `s3:GetObject` and `s3:AbortMultipartUpload` for only this bucket's `projects/*` keys;
`s3:GetObject` also authorizes the API's `HeadObject` validation request. It must not
grant public ACL or bucket-policy permissions.

## Existing application bucket

For the office MVP, add the seven-day incomplete-multipart-upload rule from
`existing-bucket-lifecycle.json` to the existing bucket's lifecycle configuration. Merge this rule with any
existing lifecycle rules; `aws s3api put-bucket-lifecycle-configuration` replaces the bucket's complete
lifecycle configuration rather than appending a rule.
