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
  } | ConvertTo-Json -Depth 4

  Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $body | Out-Null
}

function Normalize-PathForCompare {
  param([string] $Path)

  if (-not $Path) { return '' }
  return ([System.IO.Path]::GetFullPath($Path)).TrimEnd('\', '/')
}

function Remove-WrongOriginContainer {
  param(
    [string] $ContainerName,
    [string] $ExpectedWorkingDir
  )

  $actualWorkingDir = docker inspect $ContainerName --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $actualWorkingDir) {
    return
  }

  $expected = Normalize-PathForCompare -Path $ExpectedWorkingDir
  $actual = Normalize-PathForCompare -Path $actualWorkingDir
  if ($actual -eq $expected) {
    return
  }

  Write-Warning "Removing $ContainerName because it was created from '$actualWorkingDir' instead of '$ExpectedWorkingDir'."
  docker stop $ContainerName | Out-Null
  docker rm $ContainerName | Out-Null
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

$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'
$message = @"
**🟠 NetherBeacon Alpha redémarre**

Une mise à jour est en cours. Alpha et Bravo peuvent disparaître quelques secondes.

**Action**
- `docker compose up -d --build`

**Déclenché**
- $timestamp

Le healthcheck Docker vérifiera le retour des deux bots.
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

Push-Location -LiteralPath $projectRoot
try {
  Remove-WrongOriginContainer -ContainerName 'nether-beacon' -ExpectedWorkingDir $projectRoot
  docker compose up -d --build --wait --wait-timeout 120
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} finally {
  Pop-Location
}
