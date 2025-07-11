from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
import os

app = FastAPI()

# Static files and templates
if os.path.exists("static"):
    app.mount("/static", StaticFiles(directory="static"), name="static")
    
if os.path.exists("templates"):
    templates = Jinja2Templates(directory="templates")

@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    """메인 페이지"""
    if os.path.exists("templates/index.html"):
        return templates.TemplateResponse("index.html", {"request": request})
    else:
        return HTMLResponse("""
        <html>
            <head>
                <title>WOL Controller</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 40px; }
                    .container { max-width: 800px; margin: 0 auto; }
                    .btn { padding: 10px 20px; margin: 10px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; }
                    .btn:hover { background: #0056b3; }
                    .status { padding: 20px; background: #f8f9fa; border-radius: 5px; margin: 20px 0; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>듀얼부팅 PC 컨트롤러</h1>
                    <div class="status">
                        <h2>PC 상태</h2>
                        <p>상태: <span id="status">확인 중...</span></p>
                    </div>
                    <button class="btn" onclick="bootUbuntu()">Ubuntu 부팅</button>
                    <button class="btn" onclick="bootWindows()">Windows 부팅</button>
                </div>
                <script>
                    async function bootUbuntu() {
                        try {
                            const response = await fetch('/boot/ubuntu', { method: 'POST' });
                            const data = await response.json();
                            alert(data.message || '부팅 시작');
                        } catch (error) {
                            alert('부팅 요청 실패');
                        }
                    }
                    
                    async function bootWindows() {
                        try {
                            const response = await fetch('/boot/windows', { method: 'POST' });
                            const data = await response.json();
                            alert(data.message || '부팅 시작');
                        } catch (error) {
                            alert('부팅 요청 실패');
                        }
                    }
                    
                    async function updateStatus() {
                        try {
                            const response = await fetch('/status');
                            const data = await response.json();
                            document.getElementById('status').textContent = data.state || '불명';
                        } catch (error) {
                            document.getElementById('status').textContent = '오류';
                        }
                    }
                    
                    updateStatus();
                    setInterval(updateStatus, 5000);
                </script>
            </body>
        </html>
        """)

@app.post("/boot/ubuntu")
async def boot_ubuntu():
    """우분투 부팅"""
    return {"message": "Ubuntu 부팅 요청 (데모 모드)"}

@app.post("/boot/windows")
async def boot_windows():
    """윈도우 부팅"""
    return {"message": "Windows 부팅 요청 (데모 모드)"}

@app.get("/status")
async def get_status():
    """상태 확인"""
    return {"state": "off", "message": "데모 모드"}

if __name__ == "__main__":
    import uvicorn
    print("Starting simple server on http://127.0.0.1:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000)