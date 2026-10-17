# Registers a vlc:// URL handler for the current user so StreamForest's "Open in
# VLC" buttons launch VLC directly instead of downloading a .m3u to open by hand,
# and so VLC tells StreamForest where you got to.
#
# Served at /vlc-handler.ps1 - Settings -> VLC hands out the one-line command
# that pipes it into PowerShell. Writes to HKCU only, so no admin rights.
# Running it again replaces an older install; that is how the reporting arrived.
#
# Uninstall: reg delete "HKCU\Software\Classes\vlc" /f
#
# Keep this file pure ASCII. Windows PowerShell 5.1 pipes it through `irm`,
# which decodes a charset-less response as ISO-8859-1 - any UTF-8 byte in here
# arrives as mojibake.
$ErrorActionPreference = 'Stop'

$dst = Join-Path $env:LOCALAPPDATA 'StreamForest'
New-Item -ItemType Directory -Force -Path $dst | Out-Null
$launcher = Join-Path $dst 'vlc-open.vbs'
$reporter = Join-Path $dst 'vlc-report.ps1'

# Windows hands the whole vlc://<url> string to the registered command, and VLC
# has no idea what a vlc:// scheme is - so a launcher strips the prefix first.
# VBScript rather than a .cmd because wscript opens no console window to flash.
@'
' Launches VLC for a vlc://<url> argument, with no console window flash.
' Strips the leading "vlc://" and passes the remaining MRL on.
Dim url, vlc, fso, sh, reporter
url = WScript.Arguments(0)
url = Replace(url, "vlc://", "", 1, 1)   ' drop the scheme prefix (first match only)

' The page sends every colon as %3A - a literal one does not survive the trip:
' the browser parses vlc://https://... before dispatching, reads https: as a
' host with an empty port, and serializes the colon away. See vlcSchemeLink()
' in src/lib/vlc.ts, the other half of this contract. The Left() repairs cover
' a still-open tab running the page from before that contract existed.
url = Replace(url, "%3A", ":")
If Left(url, 7) = "https//" Then url = "https://" & Mid(url, 8)
If Left(url, 6) = "http//" Then url = "http://" & Mid(url, 7)

vlc = "C:\Program Files\VideoLAN\VLC\vlc.exe"
Set fso = CreateObject("Scripting.FileSystemObject")
If Not fso.FileExists(vlc) Then vlc = "C:\Program Files (x86)\VideoLAN\VLC\vlc.exe"

Set sh = CreateObject("WScript.Shell")
reporter = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\StreamForest\vlc-report.ps1"
' A StreamForest playlist that asks for reports goes through the reporter, which
' starts VLC itself; anything else goes straight to VLC as before.
If InStr(url, "/api/playlist/") > 0 And (InStr(url, "&r=") > 0 Or InStr(url, "?r=") > 0) And fso.FileExists(reporter) Then
  sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & reporter & """ """ & url & """", 0, False
Else
  sh.Run """" & vlc & """ """ & url & """", 0, False
End If
'@ | Set-Content -Path $launcher -Encoding ASCII

# The reporter. Starts VLC with its web interface on 127.0.0.1, behind a
# password made up for this one launch, and every ten seconds posts where
# playback is to StreamForest's /api/vlc-report. For a film from the home server
# the answer says what to tell Jellyfin, which this machine reaches and
# Cloudflare does not. When VLC closes, one last report.
#
# --no-one-instance matters: with "allow only one instance" ticked, a running
# VLC would take the file and drop every other flag, the web interface with them.
@'
param([Parameter(Mandatory = $true)][string]$Url)
$ErrorActionPreference = 'Stop'
$vlc = 'C:\Program Files\VideoLAN\VLC\vlc.exe'
if (-not (Test-Path $vlc)) { $vlc = 'C:\Program Files (x86)\VideoLAN\VLC\vlc.exe' }
if ($Url -notmatch '^https://(streamforest\.krutofv\.se|[a-z0-9-]+\.streamforest\.pages\.dev)/api/playlist/[^?]*\?(.*&)?r=') {
  Start-Process -FilePath $vlc -ArgumentList ('"' + $Url + '"')
  exit
}
$origin = $Url.Substring(0, $Url.IndexOf('/api/playlist/'))
$port = Get-Random -Minimum 49152 -Maximum 65000
$chars = [char[]]'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
$pass = -join (1..24 | ForEach-Object { $chars | Get-Random })
$vlcArgs = @('--no-one-instance', '--extraintf=http', '--http-host=127.0.0.1', "--http-port=$port", "--http-password=$pass", ('"' + $Url + '"'))
$proc = Start-Process -FilePath $vlc -ArgumentList $vlcArgs -PassThru
$auth = @{ Authorization = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes(":$pass")) }
$script:first = $true

function Find-Current($node) {
  if ($null -eq $node) { return $null }
  if ($node.current -eq 'current' -and $node.uri) { return [string]$node.uri }
  foreach ($child in @($node.children)) {
    $hit = Find-Current $child
    if ($hit) { return $hit }
  }
  return $null
}

function Send-Report($time, $length, $state, $uri, $final) {
  $body = @{ src = $Url; time = $time; length = $length; state = $state; uri = $uri; first = $script:first; final = $final } | ConvertTo-Json -Compress
  $script:first = $false
  $answer = Invoke-RestMethod -Method Post -Uri "$origin/api/vlc-report" -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 8
  $lines = ("$answer" -replace "`r", '') -split "`n"
  if ($lines.Count -ge 4 -and $lines[0] -eq 'RELAY') {
    $path = $lines[1]
    if (@('/Sessions/Playing', '/Sessions/Playing/Progress', '/Sessions/Playing/Stopped') -contains $path) {
      Invoke-RestMethod -Method Post -Uri ('https://jellyfin.krutofv.se' + $path) -Headers @{ Authorization = $lines[2] } -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($lines[3])) -TimeoutSec 8 | Out-Null
    }
  }
}

$last = $null
while (-not $proc.HasExited) {
  Start-Sleep -Seconds 10
  try {
    $st = Invoke-RestMethod -Uri "http://127.0.0.1:$port/requests/status.json" -Headers $auth -TimeoutSec 3
    $pl = Invoke-RestMethod -Uri "http://127.0.0.1:$port/requests/playlist.json" -Headers $auth -TimeoutSec 3
    $uri = Find-Current $pl
    $last = @{ time = [int]$st.time; length = [int]$st.length; uri = $uri }
    Send-Report $last.time $last.length ([string]$st.state) $uri $false
  } catch { }
}
if ($last) { try { Send-Report $last.time $last.length 'stopped' $last.uri $true } catch { } }
'@ | Set-Content -Path $reporter -Encoding ASCII

New-Item -Path 'HKCU:\Software\Classes\vlc\shell\open\command' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\Software\Classes\vlc' -Name '(Default)' -Value 'URL:VLC Protocol'
Set-ItemProperty -Path 'HKCU:\Software\Classes\vlc' -Name 'URL Protocol' -Value ''
$command = 'wscript.exe "{0}" "%1"' -f $launcher
Set-ItemProperty -Path 'HKCU:\Software\Classes\vlc\shell\open\command' -Name '(Default)' -Value $command

$vlcFound = (Test-Path 'C:\Program Files\VideoLAN\VLC\vlc.exe') -or (Test-Path 'C:\Program Files (x86)\VideoLAN\VLC\vlc.exe')
if (-not $vlcFound) { Write-Host 'VLC itself was not found - install it first: https://www.videolan.org/vlc/' }

Write-Host "Installed: vlc:// -> $launcher"
Write-Host 'Go back to StreamForest -> Settings -> VLC and press Test.'
