
# .\deploy.ps1 -SshKeyPath "D:\Libraries\Work\Dev\Web Development\adimari-key-pair.pem" -Activate
[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
  [string]$SshKeyPath = "D:\Libraries\Work\Dev\Web Development\adimari-key-pair.pem",
  [string]$RemoteHost = 'ec2-54-76-118-84.eu-west-1.compute.amazonaws.com',
  [string]$RemoteUser = 'ubuntu',
  [string]$RemoteRoot = '/home/ubuntu/copyParty/gaussian-viewer',
  [switch]$Activate,
  [switch]$SkipChecks
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-Native {
  param(
    [Parameter(Mandatory)]
    [string]$Command,
    [Parameter(ValueFromRemainingArguments)]
    [string[]]$Arguments,
    [string]$FailureDescription
  )

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    $description = if ($FailureDescription) { $FailureDescription } else { $Command }
    throw "Command failed ($LASTEXITCODE): $description"
  }
}

function Invoke-Pnpm {
  param([Parameter(Mandatory)][string[]]$PnpmArguments)
  Invoke-Native -Command corepack -Arguments (@('pnpm') + $PnpmArguments)
}

function ConvertTo-BashLiteral {
  param([Parameter(Mandatory)][string]$Value)
  return "'" + $Value.Replace("'", "'`"'`"'") + "'"
}

$projectRoot = $PSScriptRoot
$releaseId = "$(Get-Date -Format 'yyyyMMddHHmmss')-$(git -C $projectRoot rev-parse --short=12 HEAD)"
if ($LASTEXITCODE -ne 0) {
  throw 'Unable to determine the Git revision for this release.'
}

if ($RemoteRoot -notmatch '^/[A-Za-z0-9._/-]+$') {
  throw 'RemoteRoot must be an absolute Linux path containing only letters, digits, dot, underscore, slash and hyphen.'
}

$stagingDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "gaussian-viewer-$releaseId"
$archivePath = Join-Path ([System.IO.Path]::GetTempPath()) "gaussian-viewer-$releaseId.tgz"
$remoteArchive = "/tmp/gaussian-viewer-$releaseId.tgz"
$target = "$RemoteUser@$RemoteHost"
$sshOptions = @('-i', $SshKeyPath, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new')

try {
  if (-not $SkipChecks) {
    Write-Host 'Installing local dependencies from the lockfile...'
    Invoke-Pnpm -PnpmArguments @('install', '--frozen-lockfile')
    Write-Host 'Running quality checks and the production build...'
    Invoke-Pnpm -PnpmArguments @('run', 'lint')
    Invoke-Pnpm -PnpmArguments @('run', 'test')
    Invoke-Pnpm -PnpmArguments @('run', 'build')
  }

  New-Item -ItemType Directory -Path $stagingDirectory | Out-Null
  foreach ($path in @('apps', 'packages', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $path) -Destination $stagingDirectory -Recurse
  }

  $secretFiles = Get-ChildItem -LiteralPath $stagingDirectory -Force -Recurse -File |
    Where-Object { $_.Name -eq '.env' -or $_.Name -like '.env.*' }
  if ($secretFiles) {
    throw "Refusing to package environment files: $($secretFiles.FullName -join ', ')"
  }

  Invoke-Native -Command tar -Arguments @('-czf', $archivePath, '-C', $stagingDirectory, '.')

  Write-Host "Uploading release $releaseId..."
  Invoke-Native -Command scp -Arguments ($sshOptions + @($archivePath, "${target}:$remoteArchive"))

  $activationCommand = if ($Activate) {
    @"
if [ -e "`$root/current" ] && [ ! -L "`$root/current" ]; then
  echo "Refusing to replace a non-symlink current path: `$root/current" >&2
  exit 1
fi

public_root=/var/www/gaussian-viewer
public_release="`$public_root/releases/`$release_id"
if [ -e "`$public_release" ]; then
  echo "Refusing to replace an existing public release: `$public_release" >&2
  exit 1
fi

sudo install -d -o root -g root -m 755 "`$public_release"
sudo cp -a "`$release/apps/web/dist/." "`$public_release/"
ln -sfn "releases/`$release_id" "`$root/current"
sudo ln -sfn "`$public_release" "`$public_root/current"
sudo systemctl restart gaussian-viewer-api

for _ in {1..15}; do
  if curl --fail --silent --show-error http://127.0.0.1:3002/health; then
    break
  fi
  sleep 1
done

curl --fail --silent --show-error http://127.0.0.1:3002/health
sudo nginx -t
sudo systemctl reload nginx
curl --fail --silent --show-error http://127.0.0.1:5173/api/health
echo "Activated release: `$release_id"
"@
  } else {
    'echo "Release staged but not activated. Re-run with -Activate after the Nginx and API service setup is complete."'
  }

  $remoteScript = @"
set -euo pipefail
root=$(ConvertTo-BashLiteral $RemoteRoot)
release_id=$(ConvertTo-BashLiteral $releaseId)
archive=$(ConvertTo-BashLiteral $remoteArchive)
release="`$root/releases/`$release_id"
runtime_dir="`$root/.tools/node"
runtime_node="`$runtime_dir/bin/node"
runtime_corepack="`$runtime_dir/bin/corepack"

if [ ! -x "`$runtime_node" ] || [ ! -x "`$runtime_corepack" ]; then
  echo "Gaussian Viewer Node runtime is missing at `$runtime_dir. Install the scoped Node 22 runtime first." >&2
  exit 1
fi

export PATH="`$runtime_dir/bin:`$PATH"
export COREPACK_HOME="`$root/.corepack"

node_major="`$("`$runtime_node" -p "process.versions.node.split('.')[0]")"
if [ "`$node_major" -lt 22 ]; then
  echo "Node.js 22 or newer is required; found `$("`$runtime_node" --version)." >&2
  exit 1
fi

pnpm_version="`$("`$runtime_corepack" pnpm@11.11.0 --version)"
case "`$pnpm_version" in
  11.*) ;;
  *)
    echo "pnpm 11 is required; found `$("`$runtime_corepack" pnpm@11.11.0 --version)." >&2
    exit 1
    ;;
esac

if [ -e "`$release" ]; then
  echo "Release already exists: `$release" >&2
  exit 1
fi

mkdir -p "`$root/releases" "`$root/.pnpm-store" "`$release"
tar -xzf "`$archive" -C "`$release"
rm -f "`$archive"

cd "`$release"
"`$runtime_corepack" pnpm@11.11.0 install --prod --frozen-lockfile --store-dir "`$root/.pnpm-store"
test -f apps/api/dist/server.js
test -f apps/web/dist/index.html

$activationCommand
"@

  $remoteScriptBytes = [System.Text.Encoding]::UTF8.GetBytes($remoteScript)
  $remoteScriptBase64 = [Convert]::ToBase64String($remoteScriptBytes)
  Invoke-Native -Command ssh -Arguments ($sshOptions + @($target, "echo $remoteScriptBase64 | base64 --decode | bash")) -FailureDescription 'remote release installation'

  Write-Host "Deployment completed: $releaseId"
} finally {
  if (Test-Path -LiteralPath $stagingDirectory) {
    Remove-Item -LiteralPath $stagingDirectory -Recurse -Force
  }
  if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
  }
}
