@echo off
REM Start the local server for the wafermap examples package.
REM   serve.cmd [port]
REM
REM This file is written into the archive with CRLF line endings by
REM scripts/build-examples-archive.mjs — cmd.exe is unreliable with LF-only
REM batch files, and the archive is built on Linux.

cd /d "%~dp0"

where py >nul 2>nul && (
  py -3 serve.py %*
  goto :eof
)

where python >nul 2>nul && (
  python serve.py %*
  goto :eof
)

where python3 >nul 2>nul && (
  python3 serve.py %*
  goto :eof
)

echo No Python found. Install Python 3 from https://python.org, or serve this
echo folder another way:
echo     npx http-server -p 8080 .
echo Do not use "npx serve" - it 404s on the .js files in dist\.
exit /b 1
