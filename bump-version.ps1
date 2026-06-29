param(
  [string]$Version
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Get-CurrentVersion {
  $appJsPath = Join-Path $repoRoot "app.js"
  $content = Get-Content -LiteralPath $appJsPath -Raw
  $match = [regex]::Match($content, 'const APP_VERSION = "([^"]+)"')
  if (-not $match.Success) {
    throw "Could not find APP_VERSION in app.js"
  }
  return $match.Groups[1].Value
}

function Get-NextVersion([string]$CurrentVersion) {
  $today = Get-Date -Format "yyyy-MM-dd"
  $match = [regex]::Match($CurrentVersion, '^(\d{4}-\d{2}-\d{2})-(\d+)$')
  if ($match.Success -and $match.Groups[1].Value -eq $today) {
    $nextNumber = [int]$match.Groups[2].Value + 1
    return "$today-$nextNumber"
  }
  return "$today-1"
}

function Replace-InFile([string]$Path, [string]$Pattern, [string]$Replacement) {
  $content = Get-Content -LiteralPath $Path -Raw
  if (-not [regex]::IsMatch($content, $Pattern)) {
    throw "Pattern not found in $Path"
  }
  $updated = [regex]::Replace($content, $Pattern, $Replacement, 1)
  if ($content -eq $updated) {
    return
  }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $updated, $utf8NoBom)
}

if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = Get-NextVersion (Get-CurrentVersion)
}

Replace-InFile (Join-Path $repoRoot "app.js") 'const APP_VERSION = "[^"]+"' ('const APP_VERSION = "' + $Version + '"')
Replace-InFile (Join-Path $repoRoot "sw.js") 'const APP_VERSION = "[^"]+"' ('const APP_VERSION = "' + $Version + '"')
Replace-InFile (Join-Path $repoRoot "index.html") 'meta name="wa-build" content="[^"]+"' ('meta name="wa-build" content="' + $Version + '"')
Replace-InFile (Join-Path $repoRoot "index.html") 'manifest\.webmanifest(?:\?v=[^"]+)?' ('manifest.webmanifest?v=' + $Version)
Replace-InFile (Join-Path $repoRoot "index.html") 'app\.js(?:\?v=[^"]+)?' ('app.js?v=' + $Version)
Replace-InFile (Join-Path $repoRoot "manifest.webmanifest") '"start_url": "\./index\.html(?:\?v=[^"]+)?"' ('"start_url": "./index.html?v=' + $Version + '"')

Write-Output "Updated app version to $Version"
