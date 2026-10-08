# Starts backend (port 8000) and frontend (port 5173) in separate windows.
# Windows are minimized: clicking inside a console pauses the server (QuickEdit)
# until you press Esc.
$root = $PSScriptRoot
Start-Process powershell -WindowStyle Minimized -ArgumentList '-NoExit', '-Command', "cd '$root\backend'; .\.venv\Scripts\uvicorn app.main:app --reload --port 8000"
Start-Process powershell -WindowStyle Minimized -ArgumentList '-NoExit', '-Command', "cd '$root\frontend'; npm run dev"
