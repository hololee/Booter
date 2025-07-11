import sys
import traceback

print("Starting debug app...")
print(f"Python version: {sys.version}")
print(f"Current directory: {sys.path}")

try:
    print("1. Importing FastAPI...")
    from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
    from fastapi.templating import Jinja2Templates
    from fastapi.staticfiles import StaticFiles
    from fastapi.responses import HTMLResponse
    print("   ✓ FastAPI imported successfully")
    
    print("2. Importing other modules...")
    import json
    import asyncio
    import logging
    from typing import List
    print("   ✓ Standard modules imported successfully")
    
    print("3. Importing services...")
    from services.pc_controller import pc_controller
    print("   ✓ PC controller imported successfully")
    
    from services.connection_manager import connection_manager
    print("   ✓ Connection manager imported successfully")
    
    print("4. Creating FastAPI app...")
    app = FastAPI(title="WOL Dual Boot Controller", version="1.0.0")
    print("   ✓ FastAPI app created successfully")
    
    print("5. Setting up static files...")
    app.mount("/static", StaticFiles(directory="static"), name="static")
    templates = Jinja2Templates(directory="templates")
    print("   ✓ Static files and templates setup successfully")
    
    print("6. Setting up logging...")
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)
    print("   ✓ Logging setup successfully")
    
    @app.get("/", response_class=HTMLResponse)
    async def home(request: Request):
        """메인 페이지"""
        return templates.TemplateResponse("index.html", {"request": request})
    
    @app.get("/test")
    async def test():
        return {"message": "Test endpoint working"}
    
    print("7. Routes defined successfully")
    
    if __name__ == "__main__":
        print("8. Starting server...")
        import uvicorn
        uvicorn.run(app, host="127.0.0.1", port=8002)
    
except Exception as e:
    print(f"Error occurred: {e}")
    traceback.print_exc()