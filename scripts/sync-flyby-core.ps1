$source = "C:\Git\gpx flyby\frontend\src\flybyCore.ts"
$target = "C:\Git\websites\Walking With Ember\src\lib\flybyCore.ts"

if (!(Test-Path $source)) { throw "Source not found: $source" }
Copy-Item -Force $source $target
Write-Host "Synced flyby core: $source -> $target"
