import asyncio
import logging
import socket
from typing import Tuple

from config import config
from services.ssh_service import SSHService

logger = logging.getLogger(__name__)


class WindowsStatusChecker:
    """SSH 기반 윈도우 상태 확인 서비스"""

    def __init__(self, pc_config):
        if pc_config is None:
            raise ValueError("pc_config is required")
        self.host = pc_config.ip_address
        self.ubuntu_ssh = pc_config.get_ubuntu_ssh()
        self.windows_ssh = pc_config.get_windows_ssh()
        self.timeout = config.PORT_SCAN_TIMEOUT

    async def check_ubuntu_status(self) -> Tuple[bool, str]:
        """
        Ubuntu SSH 연결 상태 확인

        Returns:
            Tuple[bool, str]: (연결 가능 여부, 상태 메시지)
        """
        try:
            ssh_service = SSHService(self.ubuntu_ssh, self.host)
            success, stdout, stderr = await ssh_service.execute_command("echo 'Ubuntu connected'")

            if success:
                logger.info(f"Ubuntu SSH 연결 성공: {self.host}")
                return True, "Ubuntu SSH 연결 가능"
            else:
                error_msg = stderr or stdout or "연결 실패"
                logger.debug(f"Ubuntu SSH 연결 실패: {error_msg}")
                return False, f"Ubuntu SSH 연결 실패: {error_msg}"

        except Exception as e:
            logger.error(f"Ubuntu SSH 상태 확인 중 오류: {e}")
            return False, f"Ubuntu SSH 상태 확인 오류: {str(e)}"

    async def check_windows_status(self) -> Tuple[bool, str]:
        """
        Windows SSH 연결 상태 확인

        Returns:
            Tuple[bool, str]: (연결 가능 여부, 상태 메시지)
        """
        # Windows SSH는 이제 필수이므로 항상 존재

        try:
            ssh_service = SSHService(self.windows_ssh, self.host)
            success, stdout, stderr = await ssh_service.execute_command("echo 'Windows connected'")

            if success:
                logger.info(f"Windows SSH 연결 성공: {self.host}")
                return True, "Windows SSH 연결 가능"
            else:
                error_msg = stderr or stdout or "연결 실패"
                logger.debug(f"Windows SSH 연결 실패: {error_msg}")
                return False, f"Windows SSH 연결 실패: {error_msg}"

        except Exception as e:
            logger.error(f"Windows SSH 상태 확인 중 오류: {e}")
            return False, f"Windows SSH 상태 확인 오류: {str(e)}"

    async def is_windows_booted(self) -> bool:
        """
        윈도우가 부팅되었는지 SSH로 확인

        Returns:
            bool: 윈도우 부팅 여부
        """
        is_booted, message = await self.check_windows_status()
        return is_booted

    async def scan_port(self, port: int, timeout: int = None) -> Tuple[bool, str]:
        """
        특정 포트 스캔 (하위 호환성을 위해 유지)

        Args:
            port: 스캔할 포트 번호
            timeout: 타임아웃 (초)

        Returns:
            Tuple[bool, str]: (포트 열림 여부, 상태 메시지)
        """
        timeout = timeout or self.timeout

        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, self._scan_port_sync, port, timeout)
            return result
        except Exception as e:
            logger.error(f"포트 스캔 중 오류: {e}")
            return False, f"포트 스캔 오류: {str(e)}"

    def _scan_port_sync(self, port: int, timeout: int) -> Tuple[bool, str]:
        """동기 포트 스캔 (하위 호환성을 위해 유지)"""
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)

        try:
            result = sock.connect_ex((self.host, port))

            if result == 0:
                logger.info(f"포트 {port} 열림: {self.host}:{port}")
                return True, f"포트 {port} 열림 (open)"
            else:
                logger.debug(f"포트 {port} 닫힘: {self.host}:{port}")
                return False, f"포트 {port} 닫힘 (closed)"

        except socket.timeout:
            logger.debug(f"포트 {port} 타임아웃: {self.host}:{port}")
            return False, f"포트 {port} 필터링됨 (filtered)"
        except socket.gaierror as e:
            logger.error(f"호스트 이름 해석 실패: {e}")
            return False, f"호스트 이름 해석 실패: {str(e)}"
        except Exception as e:
            logger.error(f"포트 스캔 실패: {e}")
            return False, f"포트 스캔 실패: {str(e)}"
        finally:
            sock.close()

    async def quick_connectivity_test(self) -> dict:
        """
        빠른 연결성 테스트 (SSH 기반)

        Returns:
            dict: 연결성 테스트 결과
        """
        ubuntu_available, ubuntu_msg = await self.check_ubuntu_status()
        windows_available, windows_msg = await self.check_windows_status()

        return {
            "ubuntu_available": ubuntu_available,
            "windows_available": windows_available,
            "ubuntu_message": ubuntu_msg,
            "windows_message": windows_msg,
        }


# 하위 호환성을 위한 별칭
PortScanner = WindowsStatusChecker

# 전역 인스턴스는 제거 (PC별로 개별 생성)
