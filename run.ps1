$ErrorActionPreference = "Stop"
$project = Split-Path -Parent $MyInvocation.MyCommand.Path

Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "Set-Location '$project\service'; python -m uvicorn service:app --port 8000 --reload"
)

Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "Set-Location '$project\server'; npm run dev"
)

Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "Set-Location '$project\client'; npm run dev"
)

Start-Sleep -Seconds 5
Start-Process "http://localhost:5173"
