import asyncio
import logging
import uuid
from enum import Enum
from typing import Dict, Optional, Tuple
from datetime import datetime
from config import config, pc_manager, PCConfig
from services.wol_service import WOLService
from services.ssh_service import SSHService
from services.port_scanner import PortScanner

logger = logging.getLogger(__name__)

class PCState(Enum):
    """PC 상태"""
    OFF = "off"
    BOOTING = "booting"
    UBUNTU = "ubuntu"
    WINDOWS = "windows"
    UNKNOWN = "unknown"

class BootTask:
    """부팅 작업 정보"""
    def __init__(self, pc_id: str, target_os: str, task_id: str):
        self.task_id = task_id
        self.pc_id = pc_id
        self.target_os = target_os
        self.start_time = datetime.now()
        self.status = "starting"
        self.message = f"{target_os} 부팅 시작"
        self.is_completed = False
        self.is_failed = False

class PCController:
    """PC 제어 통합 컨트롤러"""
    
    def __init__(self):
        self.pc_states: Dict[str, PCState] = {}  # PC ID별 상태
        self.boot_tasks: Dict[str, BootTask] = {}
        self.state_change_callbacks = []
        self.max_boot_time = config.BOOT_TIMEOUT
        self.status_check_interval = config.STATUS_CHECK_INTERVAL
        
        # PC별 서비스 인스턴스 캐시
        self.wol_services: Dict[str, WOLService] = {}
        self.ssh_services: Dict[str, SSHService] = {}
        self.port_scanners: Dict[str, PortScanner] = {}
        
    def add_state_change_callback(self, callback):
        """상태 변경 콜백 등록"""
        self.state_change_callbacks.append(callback)
    
    async def _notify_state_change(self, pc_id: str, old_state: PCState, new_state: PCState):
        """상태 변경 알림"""
        for callback in self.state_change_callbacks:
            try:
                await callback(pc_id, old_state, new_state)
            except Exception as e:
                logger.error(f"상태 변경 콜백 실행 중 오류: {e}")
    
    def _get_or_create_services(self, pc_id: str) -> Tuple[WOLService, SSHService, PortScanner]:
        """PC별 서비스 인스턴스 가져오기 또는 생성"""
        pc_config = pc_manager.get_pc(pc_id)
        if not pc_config:
            raise ValueError(f"PC not found: {pc_id}")
        
        # WOL 서비스
        if pc_id not in self.wol_services:
            self.wol_services[pc_id] = WOLService(pc_config)
        
        # SSH 서비스
        if pc_id not in self.ssh_services:
            self.ssh_services[pc_id] = SSHService(pc_config)
        
        # 포트 스캐너
        if pc_id not in self.port_scanners:
            self.port_scanners[pc_id] = PortScanner(pc_config)
        
        return (
            self.wol_services[pc_id],
            self.ssh_services[pc_id], 
            self.port_scanners[pc_id]
        )
    
    def _clear_services_cache(self, pc_id: str):
        """PC 서비스 캐시 삭제"""
        self.wol_services.pop(pc_id, None)
        self.ssh_services.pop(pc_id, None)
        self.port_scanners.pop(pc_id, None)
    
    async def get_pc_status(self, pc_id: str) -> dict:
        """특정 PC 상태 확인"""
        try:
            wol_service, ssh_service, port_scanner = self._get_or_create_services(pc_id)
            
            # 병렬로 SSH와 RDP 연결 확인
            ssh_available = await ssh_service.is_ubuntu_booted()
            rdp_available = await port_scanner.is_windows_booted()
            
            # 상태 결정
            old_state = self.pc_states.get(pc_id, PCState.UNKNOWN)
            
            if ssh_available and rdp_available:
                # 드물지만 둘 다 열려있는 경우 (전환 중일 가능성)
                new_state = PCState.UNKNOWN
            elif ssh_available:
                new_state = PCState.UBUNTU
            elif rdp_available:
                new_state = PCState.WINDOWS
            else:
                new_state = PCState.OFF
            
            # 상태 변경 시 알림
            if old_state != new_state:
                self.pc_states[pc_id] = new_state
                await self._notify_state_change(pc_id, old_state, new_state)
            
            pc_config = pc_manager.get_pc(pc_id)
            active_tasks = [t for t in self.boot_tasks.values() if t.pc_id == pc_id and not t.is_completed]
            
            return {
                "pc_id": pc_id,
                "pc_name": pc_config.name if pc_config else "Unknown",
                "state": new_state.value,
                "ssh_available": ssh_available,
                "rdp_available": rdp_available,
                "timestamp": datetime.now().isoformat(),
                "active_tasks": len(active_tasks)
            }
            
        except Exception as e:
            logger.error(f"PC {pc_id} 상태 확인 중 오류: {e}")
            return {
                "pc_id": pc_id,
                "pc_name": "Unknown",
                "state": PCState.UNKNOWN.value,
                "ssh_available": False,
                "rdp_available": False,
                "timestamp": datetime.now().isoformat(),
                "error": str(e)
            }
    
    async def get_all_pc_status(self) -> dict:
        """모든 활성 PC 상태 확인"""
        pcs = pc_manager.get_active_pcs()
        statuses = {}
        
        # 병렬로 모든 PC 상태 확인
        tasks = []
        for pc in pcs:
            task = asyncio.create_task(self.get_pc_status(pc.id))
            tasks.append((pc.id, task))
        
        for pc_id, task in tasks:
            try:
                status = await task
                statuses[pc_id] = status
            except Exception as e:
                statuses[pc_id] = {
                    "pc_id": pc_id,
                    "state": PCState.UNKNOWN.value,
                    "error": str(e)
                }
        
        return statuses
    
    async def boot_ubuntu(self, pc_id: str) -> str:
        """우분투 부팅"""
        task_id = str(uuid.uuid4())
        task = BootTask(pc_id, "Ubuntu", task_id)
        self.boot_tasks[task_id] = task
        
        # 부팅 시작 알림
        from services.connection_manager import connection_manager
        await connection_manager.notify_boot_start(task_id, pc_id, "Ubuntu")
        
        # 백그라운드에서 부팅 프로세스 실행
        asyncio.create_task(self._boot_ubuntu_process(task))
        
        return task_id
    
    async def _boot_ubuntu_process(self, task: BootTask):
        """우분투 부팅 프로세스"""
        from services.connection_manager import connection_manager
        
        try:
            wol_service, ssh_service, port_scanner = self._get_or_create_services(task.pc_id)
            
            # 1. 현재 상태 확인
            status = await self.get_pc_status(task.pc_id)
            if status["state"] == PCState.UBUNTU.value:
                task.message = "이미 우분투가 실행 중입니다"
                task.is_completed = True
                await connection_manager.notify_boot_complete(task.task_id, task.pc_id, task.target_os, True, task.message)
                return
            
            # 2. WOL 전송
            task.message = "Wake-on-LAN 패킷 전송 중..."
            await connection_manager.notify_boot_progress(task.task_id, task.pc_id, task.target_os, task.message)
            
            success, wol_message = await wol_service.send_wol_with_retry(
                max_retries=config.MAX_RETRIES,
                retry_delay=config.RETRY_DELAY
            )
            
            if not success:
                task.message = f"WOL 전송 실패: {wol_message}"
                task.is_failed = True
                await connection_manager.notify_boot_complete(task.task_id, task.pc_id, task.target_os, False, task.message)
                return
            
            # 3. 우분투 부팅 대기
            task.message = "우분투 부팅 중..."
            await connection_manager.notify_boot_progress(task.task_id, task.pc_id, task.target_os, task.message)
            
            boot_success = await self._wait_for_ubuntu_boot(task, ssh_service)
            
            if boot_success:
                task.message = "우분투 부팅 완료"
                task.is_completed = True
                await connection_manager.notify_boot_complete(task.task_id, task.pc_id, task.target_os, True, task.message)
            else:
                task.message = "우분투 부팅 타임아웃"
                task.is_failed = True
                await connection_manager.notify_boot_complete(task.task_id, task.pc_id, task.target_os, False, task.message)
                
        except Exception as e:
            logger.error(f"우분투 부팅 프로세스 오류: {e}")
            task.message = f"부팅 오류: {str(e)}"
            task.is_failed = True
            await connection_manager.notify_boot_complete(task.task_id, task.pc_id, task.target_os, False, task.message)
    
    async def boot_windows(self, pc_id: str) -> str:
        """윈도우 부팅"""
        task_id = str(uuid.uuid4())
        task = BootTask(pc_id, "Windows", task_id)
        self.boot_tasks[task_id] = task
        
        # 부팅 시작 알림
        from services.connection_manager import connection_manager
        await connection_manager.notify_boot_start(task_id, pc_id, "Windows")
        
        # 백그라운드에서 부팅 프로세스 실행
        asyncio.create_task(self._boot_windows_process(task))
        
        return task_id
    
    async def _boot_windows_process(self, task: BootTask):
        """윈도우 부팅 프로세스"""
        from services.connection_manager import connection_manager
        
        try:
            wol_service, ssh_service, port_scanner = self._get_or_create_services(task.pc_id)
            
            # 1. 현재 상태 확인
            status = await self.get_pc_status(task.pc_id)
            if status["state"] == PCState.WINDOWS.value:
                task.message = "이미 윈도우가 실행 중입니다"
                task.is_completed = True
                await connection_manager.notify_boot_complete(task.task_id, task.pc_id, task.target_os, True, task.message)
                return
            
            # 2. 우분투가 실행 중인지 확인
            if status["state"] != PCState.UBUNTU.value:
                # 우분투가 아니면 먼저 우분투 부팅
                task.message = "우분투 부팅 중..."
                await connection_manager.notify_boot_progress(task.task_id, task.pc_id, task.target_os, task.message)
                
                success, wol_message = await wol_service.send_wol_with_retry()
                if not success:
                    task.message = f"WOL 전송 실패: {wol_message}"
                    task.is_failed = True
                    await connection_manager.notify_boot_complete(task.task_id, task.pc_id, task.target_os, False, task.message)
                    return
                
                # 우분투 부팅 대기
                boot_success = await self._wait_for_ubuntu_boot(task, ssh_service)
                if not boot_success:
                    task.message = "우분투 부팅 실패"
                    task.is_failed = True
                    await connection_manager.notify_boot_complete(task.task_id, task.pc_id, task.target_os, False, task.message)
                    return
            
            # 3. bootWin 명령 실행
            task.message = "윈도우 부팅 명령 실행 중..."
            await connection_manager.notify_boot_progress(task.task_id, task.pc_id, task.target_os, task.message)
            
            success, boot_message = await ssh_service.boot_to_windows()
            if not success:
                task.message = f"윈도우 부팅 명령 실패: {boot_message}"
                task.is_failed = True
                await connection_manager.notify_boot_complete(task.task_id, task.pc_id, task.target_os, False, task.message)
                return
            
            # 4. 윈도우 부팅 대기
            task.message = "윈도우 부팅 중..."
            await connection_manager.notify_boot_progress(task.task_id, task.pc_id, task.target_os, task.message)
            
            windows_success = await self._wait_for_windows_boot(task, port_scanner)
            
            if windows_success:
                task.message = "윈도우 부팅 완료"
                task.is_completed = True
                await connection_manager.notify_boot_complete(task.task_id, task.pc_id, task.target_os, True, task.message)
            else:
                task.message = "윈도우 부팅 타임아웃"
                task.is_failed = True
                await connection_manager.notify_boot_complete(task.task_id, task.pc_id, task.target_os, False, task.message)
                
        except Exception as e:
            logger.error(f"윈도우 부팅 프로세스 오류: {e}")
            task.message = f"부팅 오류: {str(e)}"
            task.is_failed = True
            await connection_manager.notify_boot_complete(task.task_id, task.pc_id, task.target_os, False, task.message)
    
    async def _wait_for_ubuntu_boot(self, task: BootTask, ssh_service: SSHService) -> bool:
        """우분투 부팅 대기"""
        timeout = self.max_boot_time
        start_time = asyncio.get_event_loop().time()
        
        while (asyncio.get_event_loop().time() - start_time) < timeout:
            if await ssh_service.is_ubuntu_booted():
                return True
            
            await asyncio.sleep(self.status_check_interval)
        
        return False
    
    async def _wait_for_windows_boot(self, task: BootTask, port_scanner: PortScanner) -> bool:
        """윈도우 부팅 대기"""
        timeout = self.max_boot_time
        start_time = asyncio.get_event_loop().time()
        
        while (asyncio.get_event_loop().time() - start_time) < timeout:
            if await port_scanner.is_windows_booted():
                return True
            
            await asyncio.sleep(self.status_check_interval)
        
        return False
    
    async def get_task_status(self, task_id: str) -> Optional[dict]:
        """작업 상태 조회"""
        task = self.boot_tasks.get(task_id)
        if not task:
            return None
        
        pc_config = pc_manager.get_pc(task.pc_id)
        
        return {
            "task_id": task.task_id,
            "pc_id": task.pc_id,
            "pc_name": pc_config.name if pc_config else "Unknown",
            "target_os": task.target_os,
            "status": "completed" if task.is_completed else "failed" if task.is_failed else "running",
            "message": task.message,
            "start_time": task.start_time.isoformat(),
            "is_completed": task.is_completed,
            "is_failed": task.is_failed
        }
    
    async def get_active_tasks(self) -> list:
        """활성 작업 목록 조회"""
        active_tasks = []
        for task in self.boot_tasks.values():
            if not task.is_completed:
                task_status = await self.get_task_status(task.task_id)
                if task_status:
                    active_tasks.append(task_status)
        return active_tasks
    
    async def cleanup_old_tasks(self, max_age_hours: int = 24):
        """오래된 작업 정리"""
        cutoff_time = datetime.now().timestamp() - (max_age_hours * 3600)
        
        to_remove = []
        for task_id, task in self.boot_tasks.items():
            if task.start_time.timestamp() < cutoff_time:
                to_remove.append(task_id)
        
        for task_id in to_remove:
            del self.boot_tasks[task_id]
        
        if to_remove:
            logger.info(f"오래된 작업 {len(to_remove)}개 정리됨")
    
    def remove_pc_services(self, pc_id: str):
        """PC 삭제 시 서비스 정리"""
        self._clear_services_cache(pc_id)
        self.pc_states.pop(pc_id, None)
        
        # 해당 PC의 모든 작업들 정리 (활성/비활성 모두)
        to_remove = []
        for task_id, task in self.boot_tasks.items():
            if task.pc_id == pc_id:
                if not task.is_completed:
                    task.is_failed = True
                    task.message = "PC가 삭제되었습니다"
                to_remove.append(task_id)
        
        for task_id in to_remove:
            del self.boot_tasks[task_id]
            
        logger.info(f"PC {pc_id} 서비스 정리 완료: {len(to_remove)}개 작업 제거")

# 전역 PC 컨트롤러 인스턴스
pc_controller = PCController()