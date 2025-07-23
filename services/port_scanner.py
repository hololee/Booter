import socket
import asyncio
import logging
from typing import Tuple
from config import config

logger = logging.getLogger(__name__)

class PortScanner:
    """포트 스캔 서비스"""
    
    def __init__(self, pc_config: 'PCConfig'):
        from config import PCConfig
        if pc_config is None:
            raise ValueError("pc_config is required")
        self.host = pc_config.ip_address
        self.rdp_port = pc_config.rdp_port
        self.ssh_port = pc_config.ssh_port
        self.timeout = config.PORT_SCAN_TIMEOUT
    
    async def scan_port(self, port: int, timeout: int = None) -> Tuple[bool, str]:
        """
        특정 포트 스캔
        
        Args:
            port: 스캔할 포트 번호
            timeout: 타임아웃 (초)
            
        Returns:
            Tuple[bool, str]: (포트 열림 여부, 상태 메시지)
        """
        timeout = timeout or self.timeout
        
        try:
            # 비동기로 포트 스캔 실행
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, self._scan_port_sync, port, timeout)
            return result
        except Exception as e:
            logger.error(f"포트 스캔 중 오류: {e}")
            return False, f"포트 스캔 오류: {str(e)}"
    
    def _scan_port_sync(self, port: int, timeout: int) -> Tuple[bool, str]:
        """동기 포트 스캔"""
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
    
    async def is_rdp_available(self) -> bool:
        """
        RDP 포트가 열려있는지 확인
        
        Returns:
            bool: RDP 포트 열림 여부
        """
        is_open, message = await self.scan_port(self.rdp_port)
        
        if is_open:
            logger.info(f"RDP 포트 사용 가능: {message}")
            return True
        else:
            logger.debug(f"RDP 포트 사용 불가: {message}")
            return False
    
    async def is_windows_booted(self) -> bool:
        """
        윈도우가 부팅되었는지 RDP 포트로 확인
        
        Returns:
            bool: 윈도우 부팅 여부
        """
        return await self.is_rdp_available()
    
    async def scan_multiple_ports(self, ports: list, timeout: int = None) -> dict:
        """
        여러 포트를 동시에 스캔
        
        Args:
            ports: 스캔할 포트 리스트
            timeout: 타임아웃 (초)
            
        Returns:
            dict: 포트별 스캔 결과
        """
        tasks = []
        for port in ports:
            task = asyncio.create_task(self.scan_port(port, timeout))
            tasks.append((port, task))
        
        results = {}
        for port, task in tasks:
            try:
                is_open, message = await task
                results[port] = {
                    "open": is_open,
                    "message": message
                }
            except Exception as e:
                results[port] = {
                    "open": False,
                    "message": f"스캔 실패: {str(e)}"
                }
        
        return results
    
    async def quick_connectivity_test(self) -> dict:
        """
        빠른 연결성 테스트 (SSH, RDP 포트)
        
        Returns:
            dict: 연결성 테스트 결과
        """
        results = await self.scan_multiple_ports([self.ssh_port, self.rdp_port], timeout=3)
        
        return {
            "ssh_available": results.get(self.ssh_port, {}).get("open", False),
            "rdp_available": results.get(self.rdp_port, {}).get("open", False),
            "details": results
        }

# 전역 포트 스캐너 인스턴스는 제거 (PC별로 개별 생성)