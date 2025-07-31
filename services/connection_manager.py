import asyncio
import json
import logging
from datetime import datetime
from typing import List

from fastapi import WebSocket

from services.pc_controller import PCState, pc_controller
from services.vm_controller import vm_controller

logger = logging.getLogger(__name__)


class ConnectionManager:
    """WebSocket 연결 관리자"""

    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.status_broadcast_task = None
        self.is_broadcasting = False
        # 각 연결별 활성 탭 정보 저장
        self.client_active_tabs = {}  # {websocket: "pc" or "vm"}

    async def connect(self, websocket: WebSocket):
        """새로운 WebSocket 연결 추가"""
        await websocket.accept()
        self.active_connections.append(websocket)
        # 기본값으로 PC 탭 설정
        self.client_active_tabs[websocket] = "pc"
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
            # 활성 탭 정보도 제거
            if websocket in self.client_active_tabs:
                del self.client_active_tabs[websocket]
            logger.info(f"WebSocket 연결 제거. 총 연결 수: {len(self.active_connections)}")

        # 연결이 없으면 브로드캐스트 중지
        if len(self.active_connections) == 0 and self.is_broadcasting:
            self.stop_status_broadcast()

    def set_client_active_tab(self, websocket: WebSocket, tab_type: str):
        """클라이언트의 활성 탭 설정"""
        if websocket in self.active_connections:
            self.client_active_tabs[websocket] = tab_type
            logger.info(f"클라이언트 활성 탭 변경: {tab_type}")

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
            # 어떤 탭들이 활성화되어 있는지 확인
            active_tabs = set()
            if websocket:
                # 특정 웹소켓에 대해서만 전송하는 경우
                active_tabs.add(self.client_active_tabs.get(websocket, "pc"))
            else:
                # 모든 연결된 클라이언트의 활성 탭 확인
                for ws in self.active_connections:
                    active_tabs.add(self.client_active_tabs.get(ws, "pc"))

            all_pc_statuses = {}
            all_vm_statuses = {}
            active_tasks = {}

            # PC 탭이 활성화된 클라이언트가 있는 경우에만 PC 상태 조회
            if "pc" in active_tabs:
                all_pc_statuses = await pc_controller.get_all_pc_status()
                active_tasks = await pc_controller.get_active_tasks()

            # VM 탭이 활성화된 클라이언트가 있는 경우에만 VM 상태 조회
            if "vm" in active_tabs:
                for vm_status in vm_controller.get_all_vm_statuses():
                    all_vm_statuses[vm_status.vm_id] = vm_status.to_dict()

            message = {
                "type": "status_update",
                "data": {
                    "pc_statuses": all_pc_statuses,
                    "vm_statuses": all_vm_statuses,
                    "active_tasks": active_tasks,
                    "total_pcs": len(all_pc_statuses),
                    "total_vms": len(all_vm_statuses),
                    "timestamp": datetime.now().isoformat(),
                },
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

    async def notify_boot_start(self, task_id: str, pc_id: str, target_os: str):
        """부팅 시작 알림"""
        message = {
            "type": "boot_start",
            "data": {
                "task_id": task_id,
                "pc_id": pc_id,
                "target_os": target_os,
                "message": f"{target_os} 부팅 시작",
            },
        }
        await self.broadcast_message(message)

    async def notify_boot_progress(self, task_id: str, pc_id: str, target_os: str, message: str):
        """부팅 진행 상태 알림"""
        message = {
            "type": "boot_progress",
            "data": {
                "task_id": task_id,
                "pc_id": pc_id,
                "target_os": target_os,
                "message": message,
            },
        }
        await self.broadcast_message(message)

    async def notify_boot_complete(self, task_id: str, pc_id: str, target_os: str, success: bool, message: str):
        """부팅 완료 알림"""
        message = {
            "type": "boot_complete",
            "data": {
                "task_id": task_id,
                "pc_id": pc_id,
                "target_os": target_os,
                "success": success,
                "message": message,
            },
        }
        await self.broadcast_message(message)


# 전역 연결 관리자 인스턴스
connection_manager = ConnectionManager()


# PC 컨트롤러에 상태 변경 콜백 등록
async def on_state_change(pc_id: str, old_state: "PCState", new_state: "PCState"):
    """PC 상태 변경 시 클라이언트에 알림"""
    await connection_manager.broadcast_status()


pc_controller.add_state_change_callback(on_state_change)
