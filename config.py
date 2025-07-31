import json
import os
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from pydantic import BaseModel, Field


class VMConfig(BaseModel):
    """VM 설정 정보"""

    id: str = Field(..., description="VM 고유 식별자")
    name: str = Field(..., description="VM 이름")
    vm_type: str = Field(..., description="VM 타입 (qemu/lxc)")
    vm_id: int = Field(..., description="Proxmox VM/LXC ID")
    node_name: str = Field(..., description="Proxmox 노드 이름")
    node_address: str = Field(..., description="Proxmox 노드 주소 (포트 포함)")
    api_token: str = Field(..., description="Proxmox API 토큰")
    description: Optional[str] = Field(None, description="VM 설명")

    class Config:
        json_schema_extra = {
            "example": {
                "id": "vm-001",
                "name": "Development Server",
                "vm_type": "qemu",
                "vm_id": 100,
                "node_name": "pve",
                "node_address": "192.168.1.10:8006",
                "api_token": "PVEAPIToken=user@pam!token=uuid",
                "description": "개발 서버",
            }
        }


class SSHConfig(BaseModel):
    """SSH 설정 정보"""

    user: str = Field(..., description="SSH 사용자명")
    key_text: Optional[str] = Field(None, description="SSH 개인키 텍스트")
    key_path: Optional[str] = Field(None, description="SSH 키 파일 경로")
    password: str = Field(..., description="SSH 비밀번호 (빈 문자열 허용)")
    port: int = Field(default=22, description="SSH 포트")


class PCConfig(BaseModel):
    """PC 설정 정보"""

    id: Optional[str] = Field(None, description="PC 고유 식별자")
    name: str = Field(..., description="PC 이름")
    mac_address: str = Field(..., description="MAC 주소", pattern=r"^([0-9A-Fa-f]{2}:){5}([0-9A-Fa-f]{2})$")
    ip_address: str = Field(..., description="IP 주소")

    # Ubuntu SSH 설정
    ubuntu_ssh: SSHConfig = Field(..., description="Ubuntu SSH 설정")

    # Windows SSH 설정 (필수)
    windows_ssh: SSHConfig = Field(..., description="Windows SSH 설정")

    boot_command: str = Field(default="grub-reboot Windows && reboot", description="Windows 부팅 명령")
    description: Optional[str] = Field(None, description="PC 설명")

    # 하위 호환성을 위한 deprecated 필드들
    ssh_user: Optional[str] = Field(None, description="[Deprecated] SSH 사용자명")
    ssh_auth_method: Optional[str] = Field(None, description="[Deprecated] SSH 인증 방법")
    ssh_key_text: Optional[str] = Field(None, description="[Deprecated] SSH 개인키 텍스트")
    ssh_key_path: Optional[str] = Field(None, description="[Deprecated] SSH 키 파일 경로")
    ssh_password: Optional[str] = Field(None, description="[Deprecated] SSH 비밀번호")
    ssh_port: Optional[int] = Field(None, description="[Deprecated] SSH 포트")
    rdp_port: Optional[int] = Field(None, description="[Deprecated] RDP 포트")

    def is_deprecated_format(self) -> bool:
        """기존 포맷 사용 여부 확인"""
        return any(
            [
                self.ssh_user is not None,
                self.ssh_auth_method is not None,
                self.ssh_key_text is not None,
                self.ssh_key_path is not None,
                self.ssh_password is not None,
                self.ssh_port is not None,
                self.rdp_port is not None,
            ]
        )

    def get_ubuntu_ssh(self) -> SSHConfig:
        """Ubuntu SSH 설정 반환 (하위 호환성 포함)"""
        if self.is_deprecated_format():
            return SSHConfig(
                user=self.ssh_user or "ubuntu",
                key_text=self.ssh_key_text,
                key_path=self.ssh_key_path,
                password=self.ssh_password or "",
                port=self.ssh_port or 22,
            )
        return self.ubuntu_ssh

    def get_windows_ssh(self) -> SSHConfig:
        """Windows SSH 설정 반환"""
        return self.windows_ssh

    class Config:
        json_schema_extra = {
            "example": {
                "id": "pc-001",
                "name": "Gaming PC",
                "mac_address": "AA:BB:CC:DD:EE:FF",
                "ip_address": "192.168.1.100",
                "ubuntu_ssh": {"user": "ubuntu", "key_path": "~/.ssh/id_rsa", "password": "", "port": 22},
                "windows_ssh": {"user": "administrator", "password": "password123", "port": 22},
                "boot_command": "grub-reboot Windows && reboot",
                "description": "게임용 듀얼부팅 PC",
            }
        }


class Config:
    """애플리케이션 설정"""

    # 데이터 저장 경로
    DATA_DIR = Path("data")
    PC_DATA_FILE = DATA_DIR / "pc_data.json"
    VM_DATA_FILE = DATA_DIR / "vm_data.json"

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
                with open(self.config.PC_DATA_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    for pc_data in data.get("pcs", []):
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

            data = {"pcs": [pc.dict() for pc in self.pcs.values()], "version": "1.0"}
            with open(self.config.PC_DATA_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"PC 설정 저장 실패: {e}")

    def add_pc(self, pc_config: PCConfig) -> Tuple[bool, str]:
        """PC 추가"""
        if len(self.pcs) >= self.config.MAX_PCS:
            return False, "MAX_PCS_REACHED"

        # ID 중복 확인
        if pc_config.id in self.pcs:
            return False, "ID_EXISTS"

        # 이름 중복 확인
        for pc in self.pcs.values():
            if pc.name == pc_config.name:
                return False, "NAME_EXISTS"

        self.pcs[pc_config.id] = pc_config
        self.save_pcs()
        return True, "SUCCESS"

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
        return list(self.pcs.values())


class VMManager:
    """VM 설정 관리자"""

    def __init__(self):
        self.config = Config()
        self.vms: Dict[str, VMConfig] = {}
        self.load_vms()

    def load_vms(self):
        """VM 설정 파일 로드"""
        try:
            if self.config.VM_DATA_FILE.exists():
                with open(self.config.VM_DATA_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    for vm_data in data.get("vms", []):
                        vm_config = VMConfig(**vm_data)
                        self.vms[vm_config.id] = vm_config
            else:
                # 초기에는 빈 VM 목록으로 시작
                self.save_vms()
        except Exception as e:
            print(f"VM 설정 로드 실패: {e}")
            # 오류 시에도 빈 VM 목록으로 초기화
            self.vms = {}
            self.save_vms()

    def save_vms(self):
        """VM 설정 파일 저장"""
        try:
            # data 디렉터리 생성
            self.config.DATA_DIR.mkdir(exist_ok=True)

            data = {"vms": [vm.dict() for vm in self.vms.values()], "version": "1.0"}
            with open(self.config.VM_DATA_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"VM 설정 저장 실패: {e}")

    def add_vm(self, vm_config: VMConfig) -> bool:
        """VM 추가"""
        # ID 중복 확인
        if vm_config.id in self.vms:
            return False

        # 이름 중복 확인
        for vm in self.vms.values():
            if vm.name == vm_config.name:
                return False

        # VM ID 중복 확인 (같은 노드에서)
        for vm in self.vms.values():
            if vm.node_name == vm_config.node_name and vm.vm_id == vm_config.vm_id:
                return False

        self.vms[vm_config.id] = vm_config
        self.save_vms()
        return True

    def update_vm(self, vm_id: str, vm_config: VMConfig) -> bool:
        """VM 수정"""
        if vm_id not in self.vms:
            return False

        # 이름 중복 확인 (자기 자신 제외)
        for existing_id, vm in self.vms.items():
            if existing_id != vm_id and vm.name == vm_config.name:
                return False

        # VM ID 중복 확인 (자기 자신 제외, 같은 노드에서)
        for existing_id, vm in self.vms.items():
            if existing_id != vm_id and vm.node_name == vm_config.node_name and vm.vm_id == vm_config.vm_id:
                return False

        # ID 변경 시 기존 VM 삭제하고 새로 추가
        if vm_id != vm_config.id:
            if vm_config.id in self.vms:
                return False  # 새 ID가 이미 존재
            del self.vms[vm_id]

        self.vms[vm_config.id] = vm_config
        self.save_vms()
        return True

    def delete_vm(self, vm_id: str) -> bool:
        """VM 삭제"""
        if vm_id not in self.vms:
            return False

        del self.vms[vm_id]
        self.save_vms()
        return True

    def get_vm(self, vm_id: str) -> Optional[VMConfig]:
        """VM 조회"""
        return self.vms.get(vm_id)

    def get_all_vms(self) -> List[VMConfig]:
        """모든 VM 조회"""
        return list(self.vms.values())


# 전역 관리자 인스턴스
pc_manager = PCManager()
vm_manager = VMManager()

# 하위 호환성을 위한 config 인스턴스
config = Config()
