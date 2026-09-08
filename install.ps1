param(
    [string]$InstallRoot = '',
    [switch]$Quiet,
    [switch]$NoPath,
    [switch]$FunctionsOnly
)

function Assert-ZuvPath([string]$Root, [string]$Target) {
    $base = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    $path = [IO.Path]::GetFullPath($Target)
    if (-not $path.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) { throw 'Installation path escaped its directory.' }
    $current = $path
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked installation paths are not supported.' }
        }
        $current = Split-Path -Path $current -Parent
    }
    return $path
}

function Write-ZuvAtomic([string]$Path, [string]$Text) {
    $temporary = "$Path.$([Guid]::NewGuid().ToString('N')).tmp"
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($Text)
    $stream = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temporary, $Path, [NullString]::Value) }
    else { [IO.File]::Move($temporary, $Path) }
}

function Get-ZuvRelease {
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/asiluzunoglu1216-gif/ZuvCode/releases/latest' -Headers @{ 'User-Agent' = 'ZuvCode-Installer'; Accept = 'application/vnd.github+json' } -TimeoutSec 8
    if ($release.draft -or $release.prerelease -or $release.tag_name -notmatch '^v\d+\.\d+\.\d+$') { throw 'Invalid stable release.' }
    foreach ($name in @('zuvcode.zip', 'SHA256SUMS')) {
        $assets = @($release.assets | Where-Object { $_.name -ceq $name })
        $expected = "https://github.com/asiluzunoglu1216-gif/ZuvCode/releases/download/$($release.tag_name)/$name"
        if ($assets.Count -ne 1 -or $assets[0].browser_download_url -cne $expected) { throw "Missing or invalid release asset: $name" }
    }
    return $release
}

function Save-ZuvDownload([string]$Url, [string]$Path) {
    $uri = [Uri]$Url
    if ($uri.Scheme -ne 'https' -or $uri.Host -notin @('github.com', 'nodejs.org')) { throw 'Untrusted download source.' }
    Invoke-WebRequest -Uri $Url -OutFile $Path -UseBasicParsing -TimeoutSec 120 -Headers @{ 'User-Agent' = 'ZuvCode-Installer' }
}

function Expand-ZuvArchive([string]$Archive, [string]$Destination) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        if ($zip.Entries.Count -gt 10000) { throw 'Archive has too many files.' }
        [long]$total = 0
        foreach ($entry in $zip.Entries) {
            $total += $entry.Length
            if ($total -gt 536870912) { throw 'Archive is too large.' }
            if ($entry.FullName -match '(^[\\/]|:|(^|[\\/])\.\.([\\/]|$))' -or (($entry.ExternalAttributes -shr 16) -band 61440) -eq 40960) { throw 'Unsafe archive entry.' }
            $null = Assert-ZuvPath $Destination (Join-Path $Destination $entry.FullName)
        }
    } finally { $zip.Dispose() }
    [IO.Directory]::CreateDirectory($Destination) | Out-Null
    [IO.Compression.ZipFile]::ExtractToDirectory($Archive, $Destination)
}

function Get-ZuvRuntime([string]$Root, [string]$Stage, [string]$Version) {
    if ($Version -notmatch '^v24\.\d+\.\d+$') { throw 'Unsupported runtime version.' }
    $architecture = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'ZuvCode needs 64-bit Windows.' }
    $name = "node-$Version-win-$architecture"
    $runtime = Assert-ZuvPath $Root (Join-Path $Root "runtime/$name")
    $node = Join-Path $runtime 'node.exe'
    if (-not (Test-Path -LiteralPath $node)) {
        Save-ZuvDownload "https://nodejs.org/dist/$Version/SHASUMS256.txt" (Join-Path $Stage 'node-sha.txt')
        $sum = Get-Content -LiteralPath (Join-Path $Stage 'node-sha.txt') | Where-Object { $_ -match "^([a-fA-F0-9]{64})\s+$([Regex]::Escape($name + '.zip'))$" }
        if (@($sum).Count -ne 1) { throw 'Runtime checksum is missing.' }
        $hash = ($sum -split '\s+')[0]
        $archive = Join-Path $Stage 'node.zip'
        Save-ZuvDownload "https://nodejs.org/dist/$Version/$name.zip" $archive
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ine $hash) { throw 'Runtime checksum mismatch.' }
        $extracted = Join-Path $Stage 'node-extracted'
        Expand-ZuvArchive $archive $extracted
        [IO.Directory]::CreateDirectory((Split-Path $runtime -Parent)) | Out-Null
        $source = Assert-ZuvPath $Stage (Join-Path $extracted $name)
        $null = Assert-ZuvPath $Root $runtime
        Move-Item -LiteralPath $source -Destination $runtime
    }
    $null = Assert-ZuvPath $Root $node
    $actual = & $node --version
    if ($LASTEXITCODE -ne 0 -or $actual -cne $Version) { throw 'Runtime verification failed.' }
    return $node
}

function Set-ZuvCommands([string]$Root, [bool]$SkipPath) {
    $bin = Assert-ZuvPath $Root (Join-Path $Root 'bin')
    [IO.Directory]::CreateDirectory($bin) | Out-Null
    $shim = @'
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$state = Get-Content -LiteralPath (Join-Path $root 'current.json') -Raw | ConvertFrom-Json
if ($state.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid ZuvCode installation.' }
& $state.nodePath (Join-Path $root "versions/$($state.version)/launcher.mjs") @args
exit $LASTEXITCODE
'@
    Write-ZuvAtomic (Assert-ZuvPath $Root (Join-Path $Root 'launch.ps1')) $shim
    foreach ($command in @('zuv', 'zuvcode')) {
        # Only CMD shims belong on PATH: PowerShell would prefer and block a sibling PS1.
        $legacy = Assert-ZuvPath $Root (Join-Path $bin "$command.ps1")
        if (Test-Path -LiteralPath $legacy) {
            $oldShim = $shim.Replace('$root = $PSScriptRoot', '$root = Split-Path $PSScriptRoot -Parent')
            if (([IO.File]::ReadAllText($legacy)).Trim() -cne $oldShim.Trim()) { throw "Unrecognized command shim: $legacy" }
            Remove-Item -LiteralPath $legacy -Force
        }
        Write-ZuvAtomic (Assert-ZuvPath $Root (Join-Path $bin "$command.cmd")) "@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"%~dp0..\launch.ps1`" %*`r`n"
    }
    if (-not $SkipPath) {
        $path = [Environment]::GetEnvironmentVariable('Path', 'User')
        $entries = @($path -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ine $bin.TrimEnd('\') })
        [Environment]::SetEnvironmentVariable('Path', (@($bin) + $entries -join ';'), 'User')
        $env:Path = "$bin;$env:Path"
    }
}

function Install-ZuvCode([string]$Root, [bool]$Silent, [bool]$SkipPath) {
    $Root = [IO.Path]::GetFullPath($Root)
    $null = Assert-ZuvPath $Root (Join-Path $Root 'current.json')
    if ((Test-Path -LiteralPath $Root) -and -not (Test-Path -LiteralPath (Join-Path $Root 'current.json'))) {
        $unexpected = @(Get-ChildItem -LiteralPath $Root -Force | Where-Object { $_.Name -notmatch '^(install\.lock|\.stage-[a-f0-9]+|versions|runtime|bin|launch\.ps1|current\.json\.[a-f0-9]+\.tmp)$' })
        if ($unexpected.Count) { throw 'The installation directory contains unrelated files. Choose an empty directory.' }
    }
    [IO.Directory]::CreateDirectory($Root) | Out-Null
    $lock = [IO.File]::Open((Join-Path $Root 'install.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $stage = $null
    try {
        $release = Get-ZuvRelease
        $version = $release.tag_name.Substring(1)
        $currentPath = Join-Path $Root 'current.json'
        if (Test-Path -LiteralPath $currentPath) {
            $current = Get-Content -LiteralPath $currentPath -Raw | ConvertFrom-Json
            if ($current.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid installed version.' }
            if ([Version]$current.version -ge [Version]$version) {
                if (-not $Silent) { Write-Host "ZuvCode $($current.version) is up to date." }
                Set-ZuvCommands $Root $SkipPath
                return
            }
        }
        $stage = Assert-ZuvPath $Root (Join-Path $Root ('.stage-' + [Guid]::NewGuid().ToString('N')))
        [IO.Directory]::CreateDirectory($stage) | Out-Null
        if (-not $Silent) { Write-Host "Installing ZuvCode $version..." }
        $baseUrl = "https://github.com/asiluzunoglu1216-gif/ZuvCode/releases/download/$($release.tag_name)"
        Save-ZuvDownload "$baseUrl/SHA256SUMS" (Join-Path $stage 'SHA256SUMS')
        $sum = Get-Content -LiteralPath (Join-Path $stage 'SHA256SUMS') -Raw
        if ($sum -notmatch '(?m)^([a-fA-F0-9]{64})[ \t]+\*?zuvcode\.zip[ \t]*\r?$') { throw 'Release checksum is missing.' }
        $expected = $Matches[1]
        $archive = Join-Path $stage 'zuvcode.zip'
        Save-ZuvDownload "$baseUrl/zuvcode.zip" $archive
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ine $expected) { throw 'Release checksum mismatch; current installation was not changed.' }
        $payload = Join-Path $stage 'payload'
        Expand-ZuvArchive $archive $payload
        $manifest = Get-Content -LiteralPath (Join-Path $payload 'release.json') -Raw | ConvertFrom-Json
        if ($manifest.format -ne 1 -or $manifest.version -cne $version -or $manifest.repository -cne 'asiluzunoglu1216-gif/ZuvCode') { throw 'Release manifest mismatch.' }
        foreach ($required in @('app/index.js', 'app/package.json', 'launcher.mjs', 'install.ps1')) {
            if (-not (Test-Path -LiteralPath (Join-Path $payload $required) -PathType Leaf)) { throw "Incomplete release: $required" }
        }
        $node = Get-ZuvRuntime $Root $stage $manifest.nodeVersion
        $result = & $node (Join-Path $payload 'app/index.js') --version
        if ($LASTEXITCODE -ne 0 -or $result -cne $version) { throw 'Application smoke test failed; current installation was not changed.' }
        $destination = Assert-ZuvPath $Root (Join-Path $Root "versions/$version")
        [IO.Directory]::CreateDirectory((Split-Path $destination -Parent)) | Out-Null
        $source = Assert-ZuvPath $stage $payload
        if (Test-Path -LiteralPath $destination) {
            # A prior process may have stopped after publishing the directory but before activating it.
            $expectedFiles = @(Get-ChildItem -LiteralPath $source -Recurse -File -Force)
            $existingFiles = @(Get-ChildItem -LiteralPath $destination -Recurse -File -Force)
            if ($expectedFiles.Count -ne $existingFiles.Count) { throw 'Existing release directory is incomplete; current version was preserved.' }
            foreach ($file in $expectedFiles) {
                $relative = $file.FullName.Substring($source.TrimEnd('\').Length + 1)
                $existing = Assert-ZuvPath $Root (Join-Path $destination $relative)
                if (-not (Test-Path -LiteralPath $existing -PathType Leaf) -or (Get-FileHash -LiteralPath $existing).Hash -ne (Get-FileHash -LiteralPath $file.FullName).Hash) { throw 'Existing release directory differs; current version was preserved.' }
            }
        } else { Move-Item -LiteralPath $source -Destination $destination }
        Set-ZuvCommands $Root $SkipPath
        Write-ZuvAtomic $currentPath (@{ format = 1; version = $version; nodePath = $node } | ConvertTo-Json)
        if (-not $Silent) { Write-Host "ZuvCode $version installed. Open a new terminal and type zuv. Automatic updates are enabled." }
    } finally {
        if ($stage -and (Test-Path -LiteralPath $stage)) {
            try {
                $cleanup = Assert-ZuvPath $Root $stage
                if ((Split-Path $cleanup -Leaf) -notmatch '^\.stage-[a-f0-9]{32}$') { throw 'Unsafe staging cleanup path.' }
                Remove-Item -LiteralPath $cleanup -Recurse -Force
            } catch { if (-not $Silent) { Write-Warning 'A temporary download directory was retained for manual cleanup.' } }
        }
        $lock.Dispose()
    }
}

if (-not $FunctionsOnly) {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    if ($env:OS -ne 'Windows_NT') { throw 'This installer supports Windows 10/11 x64 and ARM64.' }
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    if (-not $InstallRoot) {
        if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is unavailable. Specify -InstallRoot.' }
        $InstallRoot = Join-Path $env:LOCALAPPDATA 'ZuvCode'
    }
    Install-ZuvCode $InstallRoot ([bool]$Quiet) ([bool]$NoPath)
}
