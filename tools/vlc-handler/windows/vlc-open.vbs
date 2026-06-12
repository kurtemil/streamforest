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
