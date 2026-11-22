# Deploys Breakline to Netlify (site breakline-ihfj). Usage:
#   .\deploy.ps1           deploy to production
#   .\deploy.ps1 login     one-time Netlify sign-in
#   .\deploy.ps1 status    show who is signed in
param([string]$Action = 'deploy')
$ErrorActionPreference = 'Stop'
$Site = '11819b30-1c28-4fdb-91d8-a6cbbf479460'   # breakline-ihfj.netlify.app

# Portable Node (the Claude app put it under its package folder; fall back to a normal install)
$node = @(
  "$env:LOCALAPPDATA\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Local\node-v26.13.1-win-x64",
  "$env:LOCALAPPDATA\node-v26.13.1-win-x64",
  "$env:ProgramFiles\nodejs"
) | Where-Object { Test-Path "$_\node.exe" } | Select-Object -First 1
if (-not $node) { throw 'Node.js not found' }
$env:Path = "$node;$env:Path"

$tools = "$env:LOCALAPPDATA\breakline-netlify"
$netlify = "$tools\node_modules\.bin\netlify.cmd"
if (-not (Test-Path $netlify)) {
  & "$node\npm.cmd" install --prefix $tools netlify-cli@latest --no-fund --no-audit
}

if ($Action -eq 'login') { & $netlify login; exit }
if ($Action -eq 'status') { & $netlify sites:list; exit }

# Stage only the app files (no server.py, scripts, docs)
$dist = Join-Path $env:TEMP 'breakline-dist'
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory $dist | Out-Null
$files = 'index.html','style.css','app.js','loran.js','solunar.js','sw.js','manifest.webmanifest','icon.svg','_redirects','_headers'
foreach ($f in $files) { Copy-Item (Join-Path $PSScriptRoot $f) $dist }
Copy-Item (Join-Path $PSScriptRoot 'vendor') $dist -Recurse
Copy-Item (Join-Path $PSScriptRoot 'data') $dist -Recurse

# --no-build: the site still has Grok's Next.js plugin enabled in the Netlify UI, which fails on plain HTML.
# Run from the staging folder so the CLI doesn't pick up netlify.toml or plugins from here.
Set-Location $dist
& $netlify deploy --prod --no-build --dir $dist --site $Site --message 'Breakline v0.2 (RipCharts-style chart)'
