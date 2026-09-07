param([string] $Source)
$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('nether-beacon-restart-' + [guid]::NewGuid().ToString())
$global:NetherBeaconTestCalls = @()
$global:NetherBeaconTestScenario = 'foreign'
function docker {
  $global:NetherBeaconTestCalls += ($args -join ' ')
  $global:LASTEXITCODE = 0
  switch ($args[0]) {
    'info' { 'linux' }
    'ps' { 'fake-container' }
    'inspect' {
      $origin = if ($global:NetherBeaconTestScenario -eq 'foreign') { 'C:\unrelated-checkout' } elseif ($global:NetherBeaconTestScenario -eq 'owned') { $testRoot.ToLowerInvariant() } else { $testRoot }
      @(@{ Config = @{ Labels = @{ 'com.docker.compose.project.working_dir' = $origin; 'com.docker.compose.project' = 'nether-beacon' } } }) | ConvertTo-Json -Depth 5 -AsArray
    }
    'compose' {
      if ($args[1] -eq 'config') { '{"name":"nether-beacon"}' }
      elseif ($args[1] -eq 'build' -and $global:NetherBeaconTestScenario -eq 'build-failed') { $global:LASTEXITCODE = 1 }
    }
    default { throw "Unexpected Docker action: $($args -join ' ')" }
  }
}
try {
  New-Item -ItemType Directory -Path (Join-Path $testRoot 'scripts') | Out-Null
  $target = Join-Path $testRoot 'scripts\rebuild-restart.ps1'
  Copy-Item -LiteralPath $Source -Destination $target
  Set-Content -LiteralPath (Join-Path $testRoot '.env') -Value 'DISCORD_BOT_TOKEN=fake-offline-token'
  foreach ($scenarioName in @('foreign', 'build-failed', 'owned')) {
    $global:NetherBeaconTestScenario = $scenarioName
    $global:NetherBeaconTestCalls = @()
    $failed = $false
    try { & $target } catch { $failed = $true }
    if ($global:NetherBeaconTestCalls | Where-Object { $_ -match '^(stop|rm) ' }) { throw 'Destructive Docker call observed.' }
    $up = @($global:NetherBeaconTestCalls | Where-Object { $_ -like 'compose up*' })
    $build = @($global:NetherBeaconTestCalls | Where-Object { $_ -eq 'compose build' })
    if ($scenarioName -eq 'foreign' -and (-not $failed -or $build.Count -or $up.Count)) { throw 'Foreign source did not stop before build.' }
    if ($scenarioName -eq 'build-failed' -and (-not $failed -or $up.Count)) { throw 'Failed build restarted services.' }
    if ($scenarioName -eq 'owned' -and ($failed -or $up.Count -ne 1)) { throw 'Legitimate owned restart did not succeed.' }
  }
  Write-Output 'ownership scenarios passed'
} finally {
  $resolved = [System.IO.Path]::GetFullPath($testRoot)
  $expectedParent = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  if (-not $resolved.StartsWith($expectedParent) -or -not (Split-Path -Leaf $resolved).StartsWith('nether-beacon-restart-')) { throw 'Unsafe temporary cleanup path.' }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
