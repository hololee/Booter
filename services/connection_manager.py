import asyncio
import json
import logging
from typing import List, Dict, Any
from datetime import datetime
from fastapi import WebSocket, WebSocketDisconnect
from services.pc_controller import pc_controller, PCState

logger = logging.getLogger(__name__)

class ConnectionManager:
    """WebSocket 연결 관리자"""
    
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.status_broadcast_task = None
        self.is_broadcasting = False
        
    async def connect(self, websocket: WebSocket):
        """새로운 WebSocket 연결 추가"""
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"새로운 WebSocket 연결 추가. 총 연결 수: {len(self.active_connections)}")
        
        # 첫 번째 연결이면 상태 브로드캐스트 시작
        if len(self.active_connections) == 1 and not self.is_broadcasting:
            await self.start_status_broadcast()
        
        # 현재 상태 즉시 전송
        await self.send_current_status(websocket)
    
    def disconnect(self, websocket: WebSocket):
        """WebSocket 연결 제거"""
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"WebSocket 연결 제거. 총 연결 수: {len(self.active_connections)}")
        
        # 연결이 없으면 브로드캐스트 중지
        if len(self.active_connections) == 0 and self.is_broadcasting:
            self.stop_status_broadcast()
    
    async def send_personal_message(self, message: dict, websocket: WebSocket):
        """개별 WebSocket에 메시지 전송"""
        try:
            await websocket.send_text(json.dumps(message))
        except Exception as e:
            logger.error(f"개별 메시지 전송 실패: {e}")
    
    async def broadcast_message(self, message: dict):
        """모든 연결된 WebSocket에 메시지 브로드캐스트"""
        if not self.active_connections:
            return
        
        message_text = json.dumps(message)
        disconnected_clients = []
        
        for connection in self.active_connections:
            try:
                await connection.send_text(message_text)
            except Exception as e:
                logger.error(f"브로드캐스트 실패: {e}")
                disconnected_clients.append(connection)
        
        # 실패한 연결들 제거
        for connection in disconnected_clients:
            self.disconnect(connection)
    
    async def send_current_status(self, websocket: WebSocket = None):
        """현재 상태 전송"""
        try:
            # 모든 PC 상태 조회
            all_statuses = await pc_controller.get_all_pc_status()
            
            # 진행 중인 작업들 추가
            active_tasks = await pc_controller.get_active_tasks()
            
            message = {
                "type": "status_update",
                "data": {
                    "pc_statuses": all_statuses,
                    "active_tasks": active_tasks,
                    "total_pcs": len(all_statuses),
                    "timestamp": datetime.now().isoformat()
                }
            }
            
            if websocket:
                await self.send_personal_message(message, websocket)
            else:
                await self.broadcast_message(message)
                
        except Exception as e:
            logger.error(f"상태 전송 실패: {e}")
    
    async def broadcast_status(self):
        """상태 브로드캐스트"""
        await self.send_current_status()
    
    async def start_status_broadcast(self):
        """주기적 상태 브로드캐스트 시작"""
        if self.is_broadcasting:
            return
        
        self.is_broadcasting = True
        self.status_broadcast_task = asyncio.create_task(self._status_broadcast_loop())
        logger.info("상태 브로드캐스트 시작")
    
    def stop_status_broadcast(self):
        """상태 브로드캐스트 중지"""
        self.is_broadcasting = False
        if self.status_broadcast_task:
            self.status_broadcast_task.cancel()
            self.status_broadcast_task = None
        logger.info("상태 브로드캐스트 중지")
    
    async def _status_broadcast_loop(self):
        """상태 브로드캐스트 루프"""
        try:
            while self.is_broadcasting:
                if self.active_connections:
                    await self.broadcast_status()
                await asyncio.sleep(5)  # 5초마다 상태 전송
        except asyncio.CancelledError:
            logger.info("상태 브로드캐스트 루프 취소됨")
        except Exception as e:
            logger.error(f"상태 브로드캐스트 루프 오류: {e}")
    
    async def notify_boot_start(self, task_id: str, target_os: str):
        """부팅 시작 알림"""
        message = {
            "type": "boot_start",
            "data": {
                "task_id": task_id,
                "target_os": target_os,
                "message": f"{target_os} 부팅 시작"
            }
        }
        await self.broadcast_message(message)
    
    async def notify_boot_progress(self, task_id: str, progress: int, message: str):
        """부팅 진행률 알림"""
        message = {
            "type": "boot_progress",
            "data": {
                "task_id": task_id,
                "progress": progress,
                "message": message
            }
        }
        await self.broadcast_message(message)
    
    async def notify_boot_complete(self, task_id: str, success: bool, message: str):
        """부팅 완료 알림"""
        message = {
            "type": "boot_complete",
            "data": {
                "task_id": task_id,
                "success": success,
                "message": message
            }
        }
        await self.broadcast_message(message)

# 전역 연결 관리자 인스턴스
connection_manager = ConnectionManager()

# PC 컨트롤러에 상태 변경 콜백 등록
async def on_state_change(pc_id: str, old_state: 'PCState', new_state: 'PCState'):
    """PC 상태 변경 시 클라이언트에 알림"""
    await connection_manager.broadcast_status()

pc_controller.add_state_change_callback(on_state_change)