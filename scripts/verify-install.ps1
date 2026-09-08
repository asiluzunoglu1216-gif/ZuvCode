$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
. (Join-Path $PSScriptRoot '../install.ps1') -FunctionsOnly

function Assert-Test([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Expect-Failure([scriptblock]$Action, [string]$Pattern) {
    $caught = $false
    try { & $Action } catch { $caught = $true; if ($_.Exception.Message -notmatch $Pattern) { throw } }
    Assert-Test $caught "Expected failure: $Pattern"
}

$base = Join-Path ([IO.Path]::GetTempPath()) ('zuvcode-install-test-' + [Guid]::NewGuid().ToString('N'))
$install = Join-Path $base 'managed installation'
$project = Join-Path $base 'unrelated project'
[IO.Directory]::CreateDirectory($project) | Out-Null
$originalPath = $env:Path
$originalHome = $env:ZUVCODE_HOME
$originalAuto = $env:ZUVCODE_AUTO_UPDATE
$node = (Get-Command node).Source
$script:archive = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../artifacts/zuvcode.zip'))
$fixture = Join-Path $base 'fixture'
Expand-ZuvArchive $script:archive $fixture
$manifest = Get-Content (Join-Path $fixture 'release.json') -Raw | ConvertFrom-Json
$script:offeredVersion = $manifest.version
$script:badHash = $false
$script:offline = $false

function Get-ZuvRelease {
    if ($script:offline) { throw 'Fixture network unavailable.' }
    return @{ tag_name = "v$script:offeredVersion" }
}
function Save-ZuvDownload([string]$Url, [string]$Path) {
    if ($Url.EndsWith('/SHA256SUMS')) {
        $hash = if ($script:badHash) { '0' * 64 } else { (Get-FileHash -LiteralPath $script:archive -Algorithm SHA256).Hash }
        [IO.File]::WriteAllText($Path, "$hash  zuvcode.zip`n")
    } elseif ($Url.EndsWith('/zuvcode.zip')) { Copy-Item -LiteralPath $script:archive -Destination $Path }
    else { throw 'Unexpected test download.' }
}
# Network/runtime downloads are tested separately against the published release.
function Get-ZuvRuntime([string]$Root, [string]$Stage, [string]$Version) { return $node }

try {
    $env:ZUVCODE_HOME = Join-Path $base 'private settings'
    $env:ZUVCODE_AUTO_UPDATE = '0'
    Install-ZuvCode $install $true $true
    $currentPath = Join-Path $install 'current.json'
    $before = Get-Content $currentPath -Raw
    Assert-Test ((ConvertFrom-Json $before).version -eq $manifest.version) 'Fresh install did not activate.'
    & $node (Join-Path $PSScriptRoot 'verify-bundle.mjs') (Join-Path $install "versions/$($manifest.version)/app/index.js")
    Assert-Test ($LASTEXITCODE -eq 0) 'Portable model-to-file workflow failed.'
    Push-Location $project
    try {
        foreach ($command in @('zuv', 'zuvcode')) {
            $result = & (Join-Path $install "bin/$command.cmd") --version
            Assert-Test ($LASTEXITCODE -eq 0 -and $result -eq $manifest.version) "$command version failed."
            $env:Path = (Join-Path $install 'bin') + ';' + $originalPath
            $restricted = & powershell.exe -NoProfile -ExecutionPolicy Restricted -Command "$command --version"
            Assert-Test ($LASTEXITCODE -eq 0 -and $restricted -eq $manifest.version) "$command was blocked by PowerShell policy."
        }
        $report = & (Join-Path $install 'bin/zuv.cmd') doctor
        Assert-Test ($LASTEXITCODE -eq 0 -and ($report -join "`n").Contains('unrelated project')) ("Launch directory check failed: " + ($report -join "`n"))
        Assert-Test (Test-Path -LiteralPath (Join-Path $project '.zuvcode/state.db')) 'Fresh project state missing.'
    } finally { Pop-Location }
    [IO.Directory]::CreateDirectory($env:ZUVCODE_HOME) | Out-Null
    [IO.File]::WriteAllText((Join-Path $env:ZUVCODE_HOME 'preserve.txt'), 'User credentials and preferences stay here.')

    $script:offeredVersion = '9.9.999999'
    $script:badHash = $true
    Expect-Failure { Install-ZuvCode $install $true $true } 'checksum mismatch'
    Assert-Test ((Get-Content $currentPath -Raw) -ceq $before) 'Bad hash changed active installation.'
    $script:badHash = $false
    Expect-Failure { Install-ZuvCode $install $true $true } 'manifest mismatch'
    Assert-Test ((Get-Content $currentPath -Raw) -ceq $before) 'Bad manifest changed active installation.'
    $script:offline = $true
    Expect-Failure { Install-ZuvCode $install $true $true } 'network unavailable'
    Assert-Test ((Get-Content $currentPath -Raw) -ceq $before) 'Offline update changed active installation.'
    $script:offline = $false

    $heldLock = [IO.File]::Open((Join-Path $install 'install.lock'), [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try { Expect-Failure { Install-ZuvCode $install $true $true } 'install\.lock' } finally { $heldLock.Dispose() }

    $malicious = Join-Path $base 'unsafe.zip'
    $zip = [IO.Compression.ZipFile]::Open($malicious, [IO.Compression.ZipArchiveMode]::Create)
    try { $null = $zip.CreateEntry('../escaped.txt') } finally { $zip.Dispose() }
    Expect-Failure { Expand-ZuvArchive $malicious (Join-Path $base 'unsafe-output') } 'Unsafe archive'
    Assert-Test (-not (Test-Path -LiteralPath (Join-Path $base 'escaped.txt'))) 'ZIP traversal escaped.'

    $next = [Version]$manifest.version
    $script:offeredVersion = "$($next.Major).$($next.Minor).$($next.Build + 1)"
    $entry = Join-Path $fixture 'app/index.js'
    $code = [IO.File]::ReadAllText($entry)
    $oldPrefix = 'process.env.ZUVCODE_VERSION="' + $manifest.version + '";'
    Assert-Test ($code.Contains($oldPrefix)) 'Cannot locate baked release version.'
    [IO.File]::WriteAllText($entry, $code.Replace($oldPrefix, ('process.env.ZUVCODE_VERSION="' + $script:offeredVersion + '";')))
    $manifest.version = $script:offeredVersion
    [IO.File]::WriteAllText((Join-Path $fixture 'release.json'), ($manifest | ConvertTo-Json))
    $script:archive = Join-Path $base 'upgrade.zip'
    [IO.Compression.ZipFile]::CreateFromDirectory($fixture, $script:archive)
    $oldShim = ([IO.File]::ReadAllText((Join-Path $install 'launch.ps1'))).Replace('$root = $PSScriptRoot', '$root = Split-Path $PSScriptRoot -Parent')
    foreach ($command in @('zuv', 'zuvcode')) { [IO.File]::WriteAllText((Join-Path $install "bin/$command.ps1"), $oldShim) }
    Install-ZuvCode $install $true $true
    $after = Get-Content $currentPath -Raw | ConvertFrom-Json
    Assert-Test ($after.version -eq $script:offeredVersion) 'Upgrade did not activate.'
    Assert-Test (Test-Path -LiteralPath (Join-Path $install "versions/$((ConvertFrom-Json $before).version)/app/index.js")) 'Upgrade removed an existing version.'
    Assert-Test ((Get-Content (Join-Path $env:ZUVCODE_HOME 'preserve.txt') -Raw) -eq 'User credentials and preferences stay here.') 'Upgrade changed user data.'
    Assert-Test (Test-Path -LiteralPath (Join-Path $project '.zuvcode/state.db')) 'Upgrade removed project history.'
    foreach ($command in @('zuv', 'zuvcode')) {
        Assert-Test (-not (Test-Path -LiteralPath (Join-Path $install "bin/$command.ps1"))) 'Legacy PowerShell shim still shadows the command.'
        $restricted = & powershell.exe -NoProfile -ExecutionPolicy Restricted -Command "$command --version"
        Assert-Test ($LASTEXITCODE -eq 0 -and $restricted -eq $after.version) 'Upgraded command was blocked by PowerShell policy.'
    }

    $env:Path = ''
    $env:ZUVCODE_AUTO_UPDATE = '1'
    $ErrorActionPreference = 'Continue'
    $fallback = & $node (Join-Path $install "versions/$($after.version)/launcher.mjs") --version 2>&1
    $ErrorActionPreference = 'Stop'
    Assert-Test ($LASTEXITCODE -eq 0 -and ($fallback -join "`n").Contains($after.version)) 'Unavailable updater prevented normal startup.'
    Write-Host 'PASS: portable install, both commands under Restricted policy, legacy shim migration, cwd, atomic upgrade, retained versions/settings/history, checksum/manifest rejection, offline fallback, lock and ZIP traversal protection.'
} finally {
    $env:Path = $originalPath
    $env:ZUVCODE_HOME = $originalHome
    $env:ZUVCODE_AUTO_UPDATE = $originalAuto
    $resolved = [IO.Path]::GetFullPath($base)
    $temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($temp, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -notmatch '^zuvcode-install-test-[a-f0-9]{32}$') { throw 'Unsafe test cleanup path.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
