# Registers a vlc:// URL handler for the current user so StreamForest's "Open in
# VLC" buttons launch VLC directly instead of downloading a .m3u to open by hand.
#
# Served at /vlc-handler.ps1 - Settings -> VLC hands out the one-line command
# that pipes it into PowerShell. Writes to HKCU only, so no admin rights.
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

# Windows hands the whole vlc://<url> string to the registered command, and VLC
# has no idea what a vlc:// scheme is - so a launcher strips the prefix first.
# VBScript rather than a .cmd because wscript opens no console window to flash.
@'
' Launches VLC for a vlc://<url> argument, with no console window flash.
' Strips the leading "vlc://" and passes the remaining MRL to VLC.
Dim url, vlc, fso, sh
url = WScript.Arguments(0)
url = Replace(url, "vlc://", "", 1, 1)   ' drop the scheme prefix (first match only)

vlc = "C:\Program Files\VideoLAN\VLC\vlc.exe"
Set fso = CreateObject("Scripting.FileSystemObject")
If Not fso.FileExists(vlc) Then vlc = "C:\Program Files (x86)\VideoLAN\VLC\vlc.exe"

Set sh = CreateObject("WScript.Shell")
sh.Run """" & vlc & """ """ & url & """", 0, False
'@ | Set-Content -Path $launcher -Encoding ASCII

New-Item -Path 'HKCU:\Software\Classes\vlc\shell\open\command' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\Software\Classes\vlc' -Name '(Default)' -Value 'URL:VLC Protocol'
Set-ItemProperty -Path 'HKCU:\Software\Classes\vlc' -Name 'URL Protocol' -Value ''
$command = 'wscript.exe "{0}" "%1"' -f $launcher
Set-ItemProperty -Path 'HKCU:\Software\Classes\vlc\shell\open\command' -Name '(Default)' -Value $command

$vlcFound = (Test-Path 'C:\Program Files\VideoLAN\VLC\vlc.exe') -or (Test-Path 'C:\Program Files (x86)\VideoLAN\VLC\vlc.exe')
if (-not $vlcFound) { Write-Host 'VLC itself was not found - install it first: https://www.videolan.org/vlc/' }

Write-Host "Installed: vlc:// -> $launcher"
Write-Host 'Go back to StreamForest -> Settings -> VLC and press Test.'
