$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path -LiteralPath (Join-Path -Path $PSScriptRoot -ChildPath '..')).Path
$envPath = Join-Path -Path $projectRoot -ChildPath '.env'
$adminStatePath = Join-Path -Path $projectRoot -ChildPath 'runtime\admin-state.json'

function Read-DotEnv {
  param([string] $Path)

  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*$') { continue }
    if ($line -match '^\s*#') { continue }
    if ($line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') { continue }

    $name = $Matches[1]
    $value = $Matches[2].Trim()

    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    $values[$name] = $value
  }

  return $values
}

function Send-DiscordLogMessage {
  param(
    [string] $Token,
    [string] $ChannelId,
    [string] $Content
  )

  $uri = "https://discord.com/api/v10/channels/$ChannelId/messages"
  $headers = @{
    Authorization = "Bot $Token"
    'User-Agent' = 'NetherBeacon restart script'
  }
  $body = @{
    content = $Content
    allowed_mentions = @{ parse = @() }
  } | ConvertTo-Json -Depth 4

  Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $body | Out-Null
}

function Normalize-PathForCompare {
  param([string] $Path)

  if (-not $Path) { return '' }
  return ([System.IO.Path]::GetFullPath($Path)).TrimEnd('\', '/')
}

function Assert-ContainerOrigin {
  param([string] $ContainerId, [string] $ExpectedWorkingDir, [string] $ExpectedProject)
  $raw = docker inspect $ContainerId 2>$null
  if ($LASTEXITCODE -ne 0) { throw "Cannot inspect container $ContainerId; no restart performed." }
  $container = ($raw | ConvertFrom-Json)[0]
  $labels = $container.Config.Labels
  $actual = Normalize-PathForCompare -Path $labels.'com.docker.compose.project.working_dir'
  $expected = Normalize-PathForCompare -Path $ExpectedWorkingDir
  $comparison = if ([System.IO.Path]::DirectorySeparatorChar -eq '\') { [System.StringComparison]::OrdinalIgnoreCase } else { [System.StringComparison]::Ordinal }
  if (-not $actual -or -not [string]::Equals($actual, $expected, $comparison) -or $labels.'com.docker.compose.project' -ne $ExpectedProject) {
    throw "Container $ContainerId belongs to another or unknown Compose source. Review its labels and select the correct Docker context/project. Nothing was stopped or removed."
  }
}

function Assert-ComposeOwnership {
  param([string] $ExpectedWorkingDir, [string] $ExpectedProject)
  docker info --format '{{.OSType}}' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Docker daemon unavailable.' }
  $containers = @(docker ps -a --filter "label=com.docker.compose.project=$ExpectedProject" --format '{{.ID}}')
  if ($LASTEXITCODE -ne 0) { throw 'Cannot enumerate Compose containers.' }
  foreach ($legacyName in @('nether-beacon', 'nether-beacon-muse')) {
    $legacy = @(docker ps -a --filter "name=^/$legacyName$" --format '{{.ID}}')
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect legacy container ownership.' }
    $containers += $legacy
  }
  foreach ($containerId in ($containers | Where-Object { $_ } | Select-Object -Unique)) {
    Assert-ContainerOrigin -ContainerId $containerId -ExpectedWorkingDir $ExpectedWorkingDir -ExpectedProject $ExpectedProject
  }
}

if (-not (Test-Path -LiteralPath $envPath)) {
  throw "Missing .env at $envPath"
}

$envValues = Read-DotEnv -Path $envPath
$token = $envValues['DISCORD_BOT_TOKEN']
if (-not $token) {
  throw 'Missing DISCORD_BOT_TOKEN in .env'
}

$logChannelId = ''
if (Test-Path -LiteralPath $adminStatePath) {
  $adminState = Get-Content -LiteralPath $adminStatePath -Raw | ConvertFrom-Json
  $logChannelId = [string] $adminState.logChannelId
}

Push-Location -LiteralPath $projectRoot
try {
  # Capture resolved configuration internally; never print credential-bearing config.
  $resolved = docker compose config --format json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or -not $resolved.name) { throw 'Invalid Compose configuration.' }
  Assert-ComposeOwnership -ExpectedWorkingDir $projectRoot -ExpectedProject $resolved.name
  docker compose build
  if ($LASTEXITCODE -ne 0) { throw 'Build failed; running services were not restarted.' }
  # Recheck ownership after the build, before any externally visible action.
  Assert-ComposeOwnership -ExpectedWorkingDir $projectRoot -ExpectedProject $resolved.name
$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'
$message = @"
**🟠 NetherBeacon Alpha redémarre**

Une mise à jour est en cours. Les services sélectionnés peuvent être indisponibles pendant leur redémarrage.

**Action**
- docker compose up -d --no-build

**Déclenché**
- $timestamp

Les healthchecks vérifieront Alpha et le processus Muse si le profil music est activé.
"@

if ($logChannelId) {
  try {
    Send-DiscordLogMessage -Token $token -ChannelId $logChannelId -Content $message
  } catch {
    Write-Warning "Could not send the Discord restart notice: $($_.Exception.Message)"
  }
} else {
  Write-Warning 'No runtime log channel is available; restarting without a Discord notice.'
}

  docker compose up -d --no-build --wait --wait-timeout 120
  if ($LASTEXITCODE -ne 0) { throw 'Compose startup/health verification failed. Inspect local logs.' }
} finally {
  Pop-Location
}
