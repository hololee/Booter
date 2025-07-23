import socket
import asyncio
import logging
from typing import Optional, Tuple
from config import config

logger = logging.getLogger(__name__)

class WOLService:
    """Wake-on-LAN 서비스"""
    
    def __init__(self, mac_address: str = None):
        self.mac_address = mac_address
        self.broadcast_ip = "255.255.255.255"
        self.port = 9
    
    async def send_magic_packet(self, mac_address: Optional[str] = None) -> Tuple[bool, str]:
        """
        Wake-on-LAN 매직 패킷을 전송하는 비동기 함수
        
        Args:
            mac_address: 대상 MAC 주소 (없으면 설정에서 사용)
            
        Returns:
            Tuple[bool, str]: (성공 여부, 메시지)
        """
        try:
            target_mac = mac_address or self.mac_address
            
            if not target_mac:
                return False, "MAC 주소가 지정되지 않았습니다"
            
            # MAC 주소 정규화
            normalized_mac = target_mac.replace(':', '').replace('-', '').upper()
            
            if len(normalized_mac) != 12:
                return False, "MAC 주소는 12자리 16진수여야 합니다"
            
            # MAC 주소를 바이트로 변환
            mac_bytes = bytes.fromhex(normalized_mac)
            
            # 매직 패킷 생성: 6바이트의 0xFF + MAC 주소 16번 반복
            magic_packet = b'\xff' * 6 + mac_bytes * 16
            
            # 비동기 UDP 소켓 생성 및 전송
            await self._send_packet_async(magic_packet)
            
            logger.info(f"Wake-on-LAN 패킷을 {target_mac}로 전송 완료")
            return True, f"WOL 패킷 전송 성공: {target_mac}"
            
        except Exception as e:
            logger.error(f"WOL 패킷 전송 실패: {e}")
            return False, f"WOL 패킷 전송 실패: {str(e)}"
    
    async def _send_packet_async(self, magic_packet: bytes) -> None:
        """비동기로 매직 패킷 전송"""
        loop = asyncio.get_event_loop()
        
        def send_packet():
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
                sock.sendto(magic_packet, (self.broadcast_ip, self.port))
        
        # 블로킹 작업을 스레드풀에서 실행
        await loop.run_in_executor(None, send_packet)
    
    async def send_wol_with_retry(self, max_retries: int = 3, retry_delay: int = 2) -> Tuple[bool, str]:
        """
        재시도 로직이 포함된 WOL 패킷 전송
        
        Args:
            max_retries: 최대 재시도 횟수
            retry_delay: 재시도 간 지연 시간 (초)
            
        Returns:
            Tuple[bool, str]: (성공 여부, 메시지)
        """
        for attempt in range(max_retries):
            success, message = await self.send_magic_packet()
            
            if success:
                return True, message
            
            if attempt < max_retries - 1:
                logger.warning(f"WOL 전송 실패 (시도 {attempt + 1}/{max_retries}): {message}")
                await asyncio.sleep(retry_delay)
            else:
                logger.error(f"WOL 전송 최종 실패: {message}")
        
        return False, f"WOL 전송 실패 (최대 재시도 {max_retries}회 초과)"

# 전역 WOL 서비스 인스턴스
wol_service = WOLService()