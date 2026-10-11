# Starts backend (HOST/PORT from backend/.env, default 127.0.0.1:8000) and
# frontend (PORT from frontend/.env, default 5173) in separate windows.
# Windows are minimized: clicking inside a console pauses the server (QuickEdit)
# until you press Esc.
$root = $PSScriptRoot
Start-Process powershell -WindowStyle Minimized -ArgumentList '-NoExit', '-Command', "cd '$root\backend'; .\.venv\Scripts\python -m app.serve --dev"
Start-Process powershell -WindowStyle Minimized -ArgumentList '-NoExit', '-Command', "cd '$root\frontend'; npm run dev"
