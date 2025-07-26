import logging

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from config import PCConfig, pc_manager
from services.connection_manager import connection_manager
from services.pc_controller import pc_controller

app = FastAPI(title="WOL Dual Boot Controller", version="1.0.0")

# Static files and templates
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# 로깅 설정
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# 검증 오류 핸들러 추가
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.error(f"Validation error: {exc.errors()}")
    return JSONResponse(status_code=422, content={"detail": exc.errors(), "body": exc.body})


@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    """메인 페이지"""
    return templates.TemplateResponse("index.html", {"request": request})


# PC 관리 API
@app.get("/api/pcs")
async def get_all_pcs():
    """모든 PC 목록 조회"""
    pcs = pc_manager.get_all_pcs()
    return {"pcs": [pc.dict() for pc in pcs]}


@app.get("/api/pcs/active")
async def get_active_pcs():
    """활성 PC 목록 조회"""
    pcs = pc_manager.get_active_pcs()
    return {"pcs": [pc.dict() for pc in pcs]}


@app.get("/api/pcs/{pc_id}")
async def get_pc(pc_id: str):
    """특정 PC 조회"""
    pc = pc_manager.get_pc(pc_id)
    if not pc:
        raise HTTPException(status_code=404, detail="PC not found")
    return pc.dict()


@app.post("/api/pcs")
async def add_pc(pc_config: PCConfig):
    """PC 추가"""
    logger.info(f"Adding PC: {pc_config.dict()}")

    # 이름 중복 확인
    for pc in pc_manager.get_all_pcs():
        if pc.name == pc_config.name:
            raise HTTPException(status_code=400, detail="같은 이름의 PC가 이미 존재합니다")

    if pc_manager.add_pc(pc_config):
        return {"status": "success", "message": "PC가 성공적으로 추가되었습니다"}
    else:
        raise HTTPException(status_code=400, detail="PC 추가 실패 (ID 중복 또는 최대 개수 초과)")


@app.put("/api/pcs/{pc_id}")
async def update_pc(pc_id: str, pc_config: PCConfig):
    """PC 수정"""
    # 이름 중복 확인 (자기 자신 제외)
    for pc in pc_manager.get_all_pcs():
        if pc.id != pc_id and pc.name == pc_config.name:
            raise HTTPException(status_code=400, detail="같은 이름의 PC가 이미 존재합니다")

    if pc_manager.update_pc(pc_id, pc_config):
        return {"status": "success", "message": "PC가 성공적으로 수정되었습니다"}
    else:
        raise HTTPException(status_code=404, detail="PC를 찾을 수 없습니다")


@app.delete("/api/pcs/{pc_id}")
async def delete_pc(pc_id: str):
    """PC 삭제"""
    if pc_manager.delete_pc(pc_id):
        # PC 컨트롤러에서 해당 PC 관련 서비스 정리
        pc_controller.remove_pc_services(pc_id)
        return {"status": "success", "message": "PC deleted successfully"}
    else:
        raise HTTPException(status_code=404, detail="PC not found")


# PC 제어 API
@app.post("/api/pcs/{pc_id}/boot/ubuntu")
async def boot_ubuntu(pc_id: str):
    """우분투 부팅 시작"""
    pc = pc_manager.get_pc(pc_id)
    if not pc:
        raise HTTPException(status_code=404, detail="PC not found")

    result = await pc_controller.boot_ubuntu(pc_id)
    return {"status": "success", "message": "Ubuntu boot initiated", "task_id": result}


@app.post("/api/pcs/{pc_id}/boot/windows")
async def boot_windows(pc_id: str):
    """윈도우 부팅 시작"""
    pc = pc_manager.get_pc(pc_id)
    if not pc:
        raise HTTPException(status_code=404, detail="PC not found")

    result = await pc_controller.boot_windows(pc_id)
    return {"status": "success", "message": "Windows boot initiated", "task_id": result}


@app.get("/api/pcs/{pc_id}/status")
async def get_pc_status(pc_id: str):
    """PC 상태 확인"""
    pc = pc_manager.get_pc(pc_id)
    if not pc:
        raise HTTPException(status_code=404, detail="PC not found")

    status = await pc_controller.get_pc_status(pc_id)
    return status


@app.get("/api/status")
async def get_all_status():
    """모든 PC 상태 확인"""
    pcs = pc_manager.get_active_pcs()
    statuses = {}

    for pc in pcs:
        try:
            status = await pc_controller.get_pc_status(pc.id)
            statuses[pc.id] = status
        except Exception as e:
            statuses[pc.id] = {"error": str(e)}

    return {"statuses": statuses}


@app.get("/api/tasks/{task_id}")
async def get_task_status(task_id: str):
    """작업 상태 확인"""
    task_status = await pc_controller.get_task_status(task_id)
    if task_status:
        return task_status
    else:
        raise HTTPException(status_code=404, detail="Task not found")


# 하위 호환성을 위한 기존 API (기본 PC 사용)
@app.post("/boot/ubuntu")
async def boot_ubuntu_legacy():
    """우분투 부팅 시작 (기본 PC)"""
    default_pc = pc_manager.get_pc("default-pc")
    if not default_pc:
        raise HTTPException(status_code=404, detail="Default PC not found")

    result = await pc_controller.boot_ubuntu("default-pc")
    return {"status": "success", "message": "Ubuntu boot initiated", "task_id": result}


@app.post("/boot/windows")
async def boot_windows_legacy():
    """윈도우 부팅 시작 (기본 PC)"""
    default_pc = pc_manager.get_pc("default-pc")
    if not default_pc:
        raise HTTPException(status_code=404, detail="Default PC not found")

    result = await pc_controller.boot_windows("default-pc")
    return {"status": "success", "message": "Windows boot initiated", "task_id": result}


@app.get("/status")
async def get_status_legacy():
    """현재 PC 상태 확인 (기본 PC)"""
    default_pc = pc_manager.get_pc("default-pc")
    if not default_pc:
        raise HTTPException(status_code=404, detail="Default PC not found")

    status = await pc_controller.get_pc_status("default-pc")
    return status


@app.get("/task/{task_id}")
async def get_task_status_legacy(task_id: str):
    """작업 상태 확인 (기존 API)"""
    task_status = await pc_controller.get_task_status(task_id)
    if task_status:
        return task_status
    else:
        raise HTTPException(status_code=404, detail="Task not found")


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """실시간 상태 업데이트 WebSocket"""
    await connection_manager.connect(websocket)
    try:
        while True:
            # 클라이언트로부터 메시지 수신
            _ = await websocket.receive_text()
            # 상태 업데이트 브로드캐스트
            await connection_manager.broadcast_status()
    except WebSocketDisconnect:
        connection_manager.disconnect(websocket)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
