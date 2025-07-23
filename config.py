import os
import json
from pydantic import BaseModel, Field
from typing import Optional, Dict, List
from pathlib import Path

class PCConfig(BaseModel):
    """PC 설정 정보"""
    id: str = Field(..., description="PC 고유 식별자")
    name: str = Field(..., description="PC 이름")
    mac_address: str = Field(..., description="MAC 주소", pattern=r'^([0-9A-Fa-f]{2}:){5}([0-9A-Fa-f]{2})$')
    ip_address: str = Field(..., description="IP 주소")
    ssh_user: str = Field(..., description="SSH 사용자명")
    ssh_auth_method: str = Field(default="key", description="SSH 인증 방법 (key/password)")
    ssh_key_text: Optional[str] = Field(None, description="SSH 개인키 텍스트")
    ssh_key_path: Optional[str] = Field(None, description="SSH 키 파일 경로")
    ssh_password: Optional[str] = Field(None, description="SSH 비밀번호 (sudo 명령 실행 시에도 사용)")
    ssh_port: int = Field(default=22, description="SSH 포트")
    rdp_port: int = Field(default=3389, description="RDP 포트")
    boot_command: str = Field(default="grub-reboot Windows && reboot", description="Windows 부팅 명령")
    description: Optional[str] = Field(None, description="PC 설명")
    is_active: bool = Field(default=True, description="활성화 상태")
    
    class Config:
        json_schema_extra = {
            "example": {
                "id": "pc-001",
                "name": "Gaming PC",
                "mac_address": "AA:BB:CC:DD:EE:FF",
                "ip_address": "192.168.1.100",
                "ssh_user": "ubuntu",
                "ssh_key_path": "~/.ssh/id_rsa",
                "ssh_port": 22,
                "rdp_port": 3389,
                "boot_command": "bootWin",
                "description": "게임용 듀얼부팅 PC",
                "is_active": True
            }
        }

class Config:
    """애플리케이션 설정"""
    
    # PC 데이터 저장 경로
    DATA_DIR = Path("data")
    PC_DATA_FILE = DATA_DIR / "pc_data.json"
    
    
    # 타임아웃 설정
    BOOT_TIMEOUT = int(os.getenv("BOOT_TIMEOUT", "300"))  # 5분
    SSH_TIMEOUT = int(os.getenv("SSH_TIMEOUT", "10"))
    PORT_SCAN_TIMEOUT = int(os.getenv("PORT_SCAN_TIMEOUT", "5"))
    
    # 상태 확인 간격 (초)
    STATUS_CHECK_INTERVAL = int(os.getenv("STATUS_CHECK_INTERVAL", "5"))
    
    # 재시도 설정
    MAX_RETRIES = int(os.getenv("MAX_RETRIES", "3"))
    RETRY_DELAY = int(os.getenv("RETRY_DELAY", "2"))
    
    # PC 관리 설정
    MAX_PCS = int(os.getenv("MAX_PCS", "20"))  # 최대 등록 가능한 PC 수

class PCManager:
    """PC 설정 관리자"""
    
    def __init__(self):
        self.config = Config()
        self.pcs: Dict[str, PCConfig] = {}
        self.load_pcs()
    
    def load_pcs(self):
        """PC 설정 파일 로드"""
        try:
            if self.config.PC_DATA_FILE.exists():
                with open(self.config.PC_DATA_FILE, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    for pc_data in data.get('pcs', []):
                        pc_config = PCConfig(**pc_data)
                        self.pcs[pc_config.id] = pc_config
            else:
                # 초기에는 빈 PC 목록으로 시작
                self.save_pcs()
        except Exception as e:
            print(f"PC 설정 로드 실패: {e}")
            # 오류 시에도 빈 PC 목록으로 초기화
            self.pcs = {}
            self.save_pcs()
    
    def save_pcs(self):
        """PC 설정 파일 저장"""
        try:
            # data 디렉터리 생성
            self.config.DATA_DIR.mkdir(exist_ok=True)
            
            data = {
                'pcs': [pc.dict() for pc in self.pcs.values()],
                'version': '1.0'
            }
            with open(self.config.PC_DATA_FILE, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"PC 설정 저장 실패: {e}")
    
    def add_pc(self, pc_config: PCConfig) -> bool:
        """PC 추가"""
        if len(self.pcs) >= self.config.MAX_PCS:
            return False
        
        # ID 중복 확인
        if pc_config.id in self.pcs:
            return False
        
        # 이름 중복 확인
        for pc in self.pcs.values():
            if pc.name == pc_config.name:
                return False
        
        self.pcs[pc_config.id] = pc_config
        self.save_pcs()
        return True
    
    def update_pc(self, pc_id: str, pc_config: PCConfig) -> bool:
        """PC 수정"""
        if pc_id not in self.pcs:
            return False
        
        # 이름 중복 확인 (자기 자신 제외)
        for existing_id, pc in self.pcs.items():
            if existing_id != pc_id and pc.name == pc_config.name:
                return False
        
        # ID 변경 시 기존 PC 삭제하고 새로 추가
        if pc_id != pc_config.id:
            if pc_config.id in self.pcs:
                return False  # 새 ID가 이미 존재
            del self.pcs[pc_id]
        
        self.pcs[pc_config.id] = pc_config
        self.save_pcs()
        return True
    
    def delete_pc(self, pc_id: str) -> bool:
        """PC 삭제"""
        if pc_id not in self.pcs:
            return False
        
        del self.pcs[pc_id]
        self.save_pcs()
        return True
    
    def get_pc(self, pc_id: str) -> Optional[PCConfig]:
        """PC 조회"""
        return self.pcs.get(pc_id)
    
    def get_all_pcs(self) -> List[PCConfig]:
        """모든 PC 조회"""
        return list(self.pcs.values())
    
    def get_active_pcs(self) -> List[PCConfig]:
        """활성 PC 조회"""
        return [pc for pc in self.pcs.values() if pc.is_active]

# 전역 PC 관리자 인스턴스
pc_manager = PCManager()

# 하위 호환성을 위한 config 인스턴스
config = Config()