"""
VM 컨트롤러 서비스
여러 VM을 관리하고 상태를 추적하는 컨트롤러
"""

import asyncio
import logging
import uuid
from datetime import datetime
from typing import Dict, List, Optional

from config import VMConfig, vm_manager

from .proxmox_service import ProxmoxService

logger = logging.getLogger(__name__)


class VMStatus:
    """VM 상태 정보"""

    def __init__(self, vm_id: str, vm_name: str):
        self.vm_id = vm_id
        self.vm_name = vm_name
        self.status = "unknown"  # running, stopped, starting, unknown
        self.last_updated = None
        self.error_message = None

    def to_dict(self) -> Dict:
        return {
            "vm_id": self.vm_id,
            "vm_name": self.vm_name,
            "status": self.status,
            "last_updated": datetime.fromtimestamp(self.last_updated).isoformat() if self.last_updated else None,
            "error_message": self.error_message,
        }


class VMTask:
    """VM 작업 정보"""

    def __init__(self, task_id: str, vm_id: str, action: str):
        self.task_id = task_id
        self.vm_id = vm_id
        self.action = action  # start, stop
        self.status = "pending"  # pending, running, completed, failed
        self.message = ""
        self.created_at = datetime.now().timestamp()
        self.completed_at = None

    def to_dict(self) -> Dict:
        return {
            "task_id": self.task_id,
            "vm_id": self.vm_id,
            "action": self.action,
            "status": self.status,
            "message": self.message,
            "created_at": self.created_at,
            "completed_at": self.completed_at,
        }


class VMController:
    """VM 컨트롤러 - 여러 VM을 관리"""

    def __init__(self):
        self.vm_statuses: Dict[str, VMStatus] = {}
        self.tasks: Dict[str, VMTask] = {}
        self.status_monitor_task = None
        self._initialize_vm_statuses()

    def _initialize_vm_statuses(self):
        """등록된 모든 VM의 상태 초기화"""
        for vm_config in vm_manager.get_all_vms():
            self.vm_statuses[vm_config.id] = VMStatus(vm_config.id, vm_config.name)

    def get_vm_status(self, vm_id: str) -> Optional[VMStatus]:
        """특정 VM 상태 조회"""
        return self.vm_statuses.get(vm_id)

    def get_all_vm_statuses(self) -> List[VMStatus]:
        """모든 VM 상태 조회"""
        return list(self.vm_statuses.values())

    async def update_vm_status(self, vm_id: str) -> bool:
        """특정 VM 상태 업데이트"""
        vm_config = vm_manager.get_vm(vm_id)
        if not vm_config:
            logger.error(f"VM {vm_id} 설정을 찾을 수 없음")
            return False

        if vm_id not in self.vm_statuses:
            self.vm_statuses[vm_id] = VMStatus(vm_id, vm_config.name)

        vm_status = self.vm_statuses[vm_id]

        try:
            proxmox_service = ProxmoxService(vm_config)

            # 첫 번째 업데이트 시에만 연결 테스트 수행
            if vm_status.last_updated is None:
                logger.info(f"VM {vm_id} 첫 연결 테스트 수행")
                connection_ok = await proxmox_service.test_connection()
                if not connection_ok:
                    logger.error(f"VM {vm_id} Proxmox 기본 연결 실패")
                    vm_status.status = "connection_error"
                    vm_status.error_message = "Proxmox 연결 실패"
                    return False

            status = await proxmox_service.get_vm_status()

            if status:
                vm_status.status = status
                vm_status.error_message = None
                vm_status.last_updated = datetime.now().timestamp()
                logger.info(f"VM {vm_id} 상태 업데이트 성공: {status}")

                # WebSocket 브로드캐스트 트리거
                self._trigger_status_broadcast()
                return True
            else:
                vm_status.status = "unknown"
                vm_status.error_message = "상태 조회 실패"
                return False

        except Exception as e:
            logger.error(f"VM {vm_id} 상태 업데이트 실패: {e}")
            vm_status.status = "unknown"
            vm_status.error_message = str(e)
            return False

    async def update_all_vm_statuses(self):
        """모든 VM 상태 업데이트"""
        tasks = []
        for vm_id in self.vm_statuses.keys():
            tasks.append(self.update_vm_status(vm_id))

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def start_vm(self, vm_id: str) -> str:
        """VM 시작"""
        vm_config = vm_manager.get_vm(vm_id)
        if not vm_config:
            raise ValueError(f"VM {vm_id}를 찾을 수 없습니다")

        task_id = str(uuid.uuid4())
        task = VMTask(task_id, vm_id, "start")
        self.tasks[task_id] = task

        # 백그라운드에서 VM 시작 작업 실행
        asyncio.create_task(self._execute_start_vm(task_id, vm_config))

        return task_id

    async def stop_vm(self, vm_id: str) -> str:
        """VM 정지"""
        vm_config = vm_manager.get_vm(vm_id)
        if not vm_config:
            raise ValueError(f"VM {vm_id}를 찾을 수 없습니다")

        task_id = str(uuid.uuid4())
        task = VMTask(task_id, vm_id, "stop")
        self.tasks[task_id] = task

        # 백그라운드에서 VM 정지 작업 실행
        asyncio.create_task(self._execute_stop_vm(task_id, vm_config))

        return task_id

    async def _execute_start_vm(self, task_id: str, vm_config: VMConfig):
        """VM 시작 작업 실행"""
        task = self.tasks[task_id]
        task.status = "running"
        task.message = "VM 시작 중..."

        try:
            # VM 상태를 starting으로 변경
            if vm_config.id in self.vm_statuses:
                self.vm_statuses[vm_config.id].status = "starting"

            proxmox_service = ProxmoxService(vm_config)

            # VM 시작 명령 전송
            success = await proxmox_service.start_vm()

            if success:
                task.status = "completed"
                task.message = "VM이 성공적으로 시작되었습니다"

                # 상태 업데이트를 위해 잠시 대기
                await asyncio.sleep(2)
                await self.update_vm_status(vm_config.id)

            else:
                task.status = "failed"
                task.message = "VM 시작에 실패했습니다"

                # 상태를 다시 확인
                await self.update_vm_status(vm_config.id)

        except Exception as e:
            logger.error(f"VM 시작 작업 실패: {e}")
            task.status = "failed"
            task.message = f"오류: {str(e)}"

            # 상태를 다시 확인
            if vm_config.id in self.vm_statuses:
                await self.update_vm_status(vm_config.id)

        finally:
            task.completed_at = datetime.now().timestamp()

    async def _execute_stop_vm(self, task_id: str, vm_config: VMConfig):
        """VM 정지 작업 실행"""
        task = self.tasks[task_id]
        task.status = "running"
        task.message = "VM 정지 중..."

        try:
            proxmox_service = ProxmoxService(vm_config)

            # VM 정지 명령 전송
            success = await proxmox_service.stop_vm()

            if success:
                task.status = "completed"
                task.message = "VM이 성공적으로 정지되었습니다"

                # 상태 업데이트를 위해 잠시 대기
                await asyncio.sleep(2)
                await self.update_vm_status(vm_config.id)

            else:
                task.status = "failed"
                task.message = "VM 정지에 실패했습니다"

                # 상태를 다시 확인
                await self.update_vm_status(vm_config.id)

        except Exception as e:
            logger.error(f"VM 정지 작업 실패: {e}")
            task.status = "failed"
            task.message = f"오류: {str(e)}"

            # 상태를 다시 확인
            if vm_config.id in self.vm_statuses:
                await self.update_vm_status(vm_config.id)

        finally:
            task.completed_at = datetime.now().timestamp()

    def get_task(self, task_id: str) -> Optional[VMTask]:
        """작업 상태 조회"""
        return self.tasks.get(task_id)

    def add_vm(self, vm_config: VMConfig):
        """새 VM 추가 시 상태 초기화"""
        self.vm_statuses[vm_config.id] = VMStatus(vm_config.id, vm_config.name)

    def remove_vm(self, vm_id: str):
        """VM 삭제 시 상태 제거"""
        if vm_id in self.vm_statuses:
            del self.vm_statuses[vm_id]

    def update_vm_name(self, vm_id: str, new_name: str):
        """VM 이름 업데이트"""
        if vm_id in self.vm_statuses:
            self.vm_statuses[vm_id].vm_name = new_name

    def _trigger_status_broadcast(self):
        """WebSocket 상태 브로드캐스트 트리거"""
        try:
            # connection_manager를 직접 import하여 순환 import 방지
            import asyncio

            from services.connection_manager import connection_manager

            # 비동기 컨텍스트에서 실행
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.create_task(connection_manager.broadcast_status())
                else:
                    asyncio.run(connection_manager.broadcast_status())
            except RuntimeError:
                # 이벤트 루프가 없는 경우는 무시
                pass
        except Exception as e:
            logger.error(f"WebSocket 브로드캐스트 트리거 실패: {e}")

    async def start_status_monitoring(self):
        """상태 모니터링 시작"""
        if self.status_monitor_task is None or self.status_monitor_task.done():
            self.status_monitor_task = asyncio.create_task(self._status_monitor_loop())

    async def stop_status_monitoring(self):
        """상태 모니터링 중지"""
        if self.status_monitor_task and not self.status_monitor_task.done():
            self.status_monitor_task.cancel()
            try:
                await self.status_monitor_task
            except asyncio.CancelledError:
                pass

    async def _status_monitor_loop(self):
        """상태 모니터링 루프"""
        logger.info("VM 상태 모니터링 시작")
        while True:
            try:
                logger.debug("VM 상태 업데이트 중...")
                await self.update_all_vm_statuses()
                await asyncio.sleep(10)  # 10초마다 상태 업데이트
            except asyncio.CancelledError:
                logger.info("VM 상태 모니터링 중지")
                break
            except Exception as e:
                logger.error(f"상태 모니터링 오류: {e}")
                await asyncio.sleep(5)


# 전역 VM 컨트롤러 인스턴스
vm_controller = VMController()
