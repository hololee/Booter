"""
Proxmox API 서비스
Proxmox VE API를 통해 VM과 LXC 컨테이너를 제어하는 서비스
"""

import asyncio
import logging
from typing import Dict, Optional
from urllib.parse import quote

import aiohttp

from config import VMConfig

logger = logging.getLogger(__name__)


class ProxmoxService:
    """Proxmox API를 통한 VM/LXC 제어 서비스"""

    def __init__(self, vm_config: VMConfig):
        self.vm_config = vm_config
        self.base_url = f"https://{vm_config.node_address}/api2/json"

        # API 토큰 형식 확인 및 URL 인코딩
        api_token = vm_config.api_token
        if not api_token.startswith("PVEAPIToken="):
            # user@pam!tokenname=uuid 형식이면 PVEAPIToken= 접두사 추가
            api_token = f"PVEAPIToken={api_token}"

        # API 토큰에서 특수문자 인코딩 (! -> %21)
        api_token = api_token.replace("!", "%21")

        self.headers = {
            "Authorization": api_token,
        }

        # POST 요청용 헤더 (JSON 본문이 있을 때만 Content-Type 설정)
        self.post_headers = {
            "Authorization": api_token,
            "Content-Type": "application/x-www-form-urlencoded",
        }

    async def get_vm_status(self) -> Optional[str]:
        """VM/LXC 상태 조회"""
        try:
            # URL 경로에서 특수문자 인코딩
            encoded_node_name = quote(self.vm_config.node_name, safe="")
            endpoint = f"/nodes/{encoded_node_name}/{self.vm_config.vm_type}/{self.vm_config.vm_id}/status/current"
            url = f"{self.base_url}{endpoint}"

            logger.info(f"Proxmox API 요청: GET {url}")
            logger.info(f"인증 헤더: {self.headers.get('Authorization', 'N/A')}")

            connector = aiohttp.TCPConnector(ssl=False)  # Proxmox는 대부분 자체 서명 인증서 사용
            async with aiohttp.ClientSession(connector=connector) as session:
                async with session.get(url, headers=self.headers, timeout=aiohttp.ClientTimeout(total=10)) as response:
                    if response.status == 200:
                        data = await response.json()
                        return data.get("data", {}).get("status", "unknown")
                    else:
                        response_text = await response.text()
                        logger.error(f"Proxmox API 오류: {response.status} - {response_text}")
                        logger.error(f"요청 URL: {url}")
                        logger.error(f"요청 헤더: {self.headers}")
                        logger.error(f"응답 헤더: {dict(response.headers)}")

                        # 401 오류의 경우 추가 정보 제공
                        if response.status == 401:
                            logger.error("=== 401 인증 오류 디버깅 정보 ===")
                            logger.error(
                                f"VM 설정: node={self.vm_config.node_name}, vm_type={self.vm_config.vm_type}, vm_id={self.vm_config.vm_id}"  # noqa: E501
                            )
                            logger.error(
                                f"API 토큰 (마스킹): {self.vm_config.api_token[:20]}...{self.vm_config.api_token[-10:]}"
                            )
                            logger.error("가능한 원인:")
                            logger.error("1. API 토큰이 만료되었거나 잘못됨")
                            logger.error("2. API 토큰에 필요한 권한이 없음 (VM.Audit, VM.PowerMgmt 필요)")
                            logger.error("3. 노드 이름이 잘못됨")
                            logger.error("4. VM ID가 존재하지 않음")

                        return None

        except asyncio.TimeoutError:
            logger.error(f"VM {self.vm_config.vm_id} 상태 조회 타임아웃")
            return None
        except Exception as e:
            logger.error(f"VM {self.vm_config.vm_id} 상태 조회 실패: {e}")
            return None

    async def start_vm(self) -> bool:
        """VM/LXC 시작"""
        try:
            encoded_node_name = quote(self.vm_config.node_name, safe="")
            endpoint = f"/nodes/{encoded_node_name}/{self.vm_config.vm_type}/{self.vm_config.vm_id}/status/start"
            url = f"{self.base_url}{endpoint}"

            logger.info(f"VM 시작 요청: POST {url}")

            connector = aiohttp.TCPConnector(ssl=False)
            async with aiohttp.ClientSession(connector=connector) as session:
                async with session.post(
                    url, headers=self.headers, timeout=aiohttp.ClientTimeout(total=30)  # Content-Type 없는 헤더 사용
                ) as response:
                    response_text = await response.text()
                    if response.status == 200:
                        logger.info(f"VM {self.vm_config.vm_id} 시작 명령 전송 성공: {response_text}")
                        return True
                    else:
                        logger.error(f"VM 시작 실패: {response.status} - {response_text}")
                        return False

        except asyncio.TimeoutError:
            logger.error(f"VM {self.vm_config.vm_id} 시작 명령 타임아웃")
            return False
        except Exception as e:
            logger.error(f"VM {self.vm_config.vm_id} 시작 실패: {e}")
            return False

    async def stop_vm(self) -> bool:
        """VM/LXC 정지"""
        try:
            encoded_node_name = quote(self.vm_config.node_name, safe="")
            endpoint = f"/nodes/{encoded_node_name}/{self.vm_config.vm_type}/{self.vm_config.vm_id}/status/stop"
            url = f"{self.base_url}{endpoint}"

            logger.info(f"VM 정지 요청: POST {url}")

            connector = aiohttp.TCPConnector(ssl=False)
            async with aiohttp.ClientSession(connector=connector) as session:
                async with session.post(
                    url, headers=self.headers, timeout=aiohttp.ClientTimeout(total=30)  # Content-Type 없는 헤더 사용
                ) as response:
                    response_text = await response.text()
                    if response.status == 200:
                        logger.info(f"VM {self.vm_config.vm_id} 정지 명령 전송 성공: {response_text}")
                        return True
                    else:
                        logger.error(f"VM 정지 실패: {response.status} - {response_text}")
                        return False

        except asyncio.TimeoutError:
            logger.error(f"VM {self.vm_config.vm_id} 정지 명령 타임아웃")
            return False
        except Exception as e:
            logger.error(f"VM {self.vm_config.vm_id} 정지 실패: {e}")
            return False

    async def get_vm_info(self) -> Optional[Dict]:
        """VM/LXC 정보 조회"""
        try:
            encoded_node_name = quote(self.vm_config.node_name, safe="")
            endpoint = f"/nodes/{encoded_node_name}/{self.vm_config.vm_type}/{self.vm_config.vm_id}/config"

            connector = aiohttp.TCPConnector(ssl=False)
            async with aiohttp.ClientSession(connector=connector) as session:
                async with session.get(
                    f"{self.base_url}{endpoint}", headers=self.headers, timeout=aiohttp.ClientTimeout(total=10)
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        return data.get("data", {})
                    else:
                        logger.error(f"VM 정보 조회 실패: {response.status} - {await response.text()}")
                        return None

        except asyncio.TimeoutError:
            logger.error(f"VM {self.vm_config.vm_id} 정보 조회 타임아웃")
            return None
        except Exception as e:
            logger.error(f"VM {self.vm_config.vm_id} 정보 조회 실패: {e}")
            return None

    async def test_connection(self) -> bool:
        """Proxmox API 연결 테스트"""
        try:
            endpoint = "/version"
            url = f"{self.base_url}{endpoint}"

            logger.info(f"Proxmox 연결 테스트: GET {url}")
            logger.info(f"인증 헤더: {self.headers.get('Authorization')}")

            connector = aiohttp.TCPConnector(ssl=False)
            async with aiohttp.ClientSession(connector=connector) as session:
                async with session.get(
                    url,
                    headers=self.headers,  # GET 요청에는 Content-Type 불필요
                    timeout=aiohttp.ClientTimeout(total=5),
                ) as response:
                    response_text = await response.text()
                    if response.status == 200:
                        logger.info(f"Proxmox API 연결 성공: {self.vm_config.node_address}")
                        data = await response.json()
                        logger.info(f"Proxmox 버전: {data}")
                        return True
                    else:
                        logger.error(f"Proxmox API 연결 실패: {response.status} - {response_text}")
                        if response.status == 401:
                            logger.error("인증 실패: API 토큰이 유효하지 않거나 권한이 부족합니다")
                        return False

        except Exception as e:
            logger.error(f"Proxmox API 연결 테스트 실패: {e}")
            return False
