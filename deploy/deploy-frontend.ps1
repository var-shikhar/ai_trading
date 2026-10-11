# Build the frontend on this PC and upload it to the server (building on a
# 1 GB server can run out of memory).
#
#   .\deploy\deploy-frontend.ps1 -Server deploy@203.0.113.10
#
# Needs OpenSSH (built into Windows 10+: `ssh` and `scp`) and SSH access to
# the server as a user that owns /var/www/indicator.
param(
    [Parameter(Mandatory = $true)][string]$Server,
    [string]$Path = "/var/www/indicator"
)
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

Push-Location "$root\frontend"
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Build failed" }
} finally {
    Pop-Location
}

$staging = "/tmp/indicator-dist-$([DateTimeOffset]::Now.ToUnixTimeSeconds())"
scp -r "$root\frontend\dist" "${Server}:$staging"
if ($LASTEXITCODE -ne 0) { throw "Upload failed" }

# Swap the new files in (old assets are removed so the folder doesn't grow).
ssh $Server "mkdir -p $Path && find $Path -mindepth 1 -delete && cp -r $staging/. $Path/ && rm -rf $staging"
if ($LASTEXITCODE -ne 0) { throw "Install on server failed" }
Write-Host "Frontend deployed to ${Server}:$Path"
