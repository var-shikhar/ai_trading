# Starts backend (port 8000) and frontend (port 5173) in separate windows.
$root = $PSScriptRoot
Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd '$root\backend'; .\.venv\Scripts\uvicorn app.main:app --reload --port 8000"
Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd '$root\frontend'; npm run dev"
