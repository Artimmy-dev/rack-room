@echo off
where msedge >nul 2>nul
if %errorlevel%==0 (
  start "" msedge --app="file:///%~dp0index.html"
) else (
  start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app="file:///%~dp0index.html"
)
