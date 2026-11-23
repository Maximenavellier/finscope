$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $root "backend"
$frontendDir = Join-Path $root "frontend"

Write-Host "Démarrage du backend FastAPI (http://127.0.0.1:8000)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$backendDir`"; .\.venv\Scripts\uvicorn.exe app.main:app --reload --port 8000"

Write-Host "Démarrage du frontend Next.js (http://localhost:3000)..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$frontendDir`"; npm.cmd run dev"
