import paramiko
from paramiko.ssh_exception import NoValidConnectionsError
import asyncio
import logging
from typing import Tuple
from pathlib import Path
from config import config

logger = logging.getLogger(__name__)


class SSHService:
    """SSH 연결 및 원격 명령 실행 서비스"""
    
    def __init__(self, pc_config=None):
        from config import PCConfig
        pc_config = pc_config or config.DEFAULT_PC_CONFIG
        self.host = pc_config.ip_address
        self.username = pc_config.ssh_user
        self.auth_method = pc_config.ssh_auth_method
        self.key_path = Path(pc_config.ssh_key_path).expanduser() if pc_config.ssh_key_path else None
        self.key_text = pc_config.ssh_key_text
        self.password = pc_config.ssh_password
        self.port = pc_config.ssh_port
        self.boot_command = pc_config.boot_command
        self.timeout = config.SSH_TIMEOUT
    
    async def test_connection(self) -> Tuple[bool, str]:
        """
        SSH 연결 테스트
        
        Returns:
            Tuple[bool, str]: (연결 성공 여부, 메시지)
        """
        try:
            # 비동기로 SSH 연결 테스트 실행
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, self._test_connection_sync)
            return result
        except Exception as e:
            logger.error(f"SSH 연결 테스트 중 오류: {e}")
            return False, f"SSH 연결 오류: {str(e)}"
    
    def _test_connection_sync(self) -> Tuple[bool, str]:
        """동기 SSH 연결 테스트"""
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        
        try:
            # SSH 연결 (인증 방법에 따라 분기)
            if self.auth_method == "key":
                private_key = self._load_private_key()
                if not private_key:
                    return False, "SSH 키 로드 실패"
                    
                ssh.connect(
                    hostname=self.host,
                    port=self.port,
                    username=self.username,
                    pkey=private_key,
                    timeout=self.timeout
                )
            else:  # password
                if not self.password:
                    return False, "SSH 비밀번호가 설정되지 않았습니다"
                    
                ssh.connect(
                    hostname=self.host,
                    port=self.port,
                    username=self.username,
                    password=self.password,
                    timeout=self.timeout
                )
            
            # 간단한 명령 실행으로 연결 확인
            stdin, stdout, stderr = ssh.exec_command('echo "SSH connection test"')
            output = stdout.read().decode().strip()
            
            if output == "SSH connection test":
                return True, f"SSH 연결 성공: {self.username}@{self.host}"
            else:
                return False, "SSH 연결 테스트 명령 실행 실패"
                
        except paramiko.AuthenticationException:
            return False, "SSH 인증 실패"
        except NoValidConnectionsError:
            return False, f"SSH 연결 실패: {self.host}:{self.port}에 연결할 수 없습니다"
        except paramiko.SSHException as e:
            return False, f"SSH 오류: {str(e)}"
        except Exception as e:
            return False, f"SSH 연결 중 예상치 못한 오류: {str(e)}"
        finally:
            ssh.close()
    
    def _load_private_key(self):
        """SSH 개인키 로드"""
        try:
            if self.key_text:
                # 텍스트로 입력된 키 사용
                from io import StringIO
                key_file = StringIO(self.key_text)
                return paramiko.RSAKey.from_private_key(key_file)
            elif self.key_path and self.key_path.exists():
                # 파일 경로로 입력된 키 사용
                return paramiko.RSAKey.from_private_key_file(str(self.key_path))
            else:
                return None
        except Exception as e:
            logger.error(f"SSH 키 로드 실패: {e}")
            return None
    
    async def execute_command(self, command: str) -> Tuple[bool, str, str]:
        """
        원격 명령 실행
        
        Args:
            command: 실행할 명령
            
        Returns:
            Tuple[bool, str, str]: (성공 여부, stdout, stderr)
        """
        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, self._execute_command_sync, command)
            return result
        except Exception as e:
            logger.error(f"SSH 명령 실행 중 오류: {e}")
            return False, "", f"명령 실행 오류: {str(e)}"
    
    def _execute_command_sync(self, command: str) -> Tuple[bool, str, str]:
        """동기 원격 명령 실행"""
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        
        try:
            # SSH 연결 (인증 방법에 따라 분기)
            if self.auth_method == "key":
                private_key = self._load_private_key()
                if not private_key:
                    return False, "", "SSH 키 로드 실패"
                    
                ssh.connect(
                    hostname=self.host,
                    port=self.port,
                    username=self.username,
                    pkey=private_key,
                    timeout=self.timeout
                )
            else:  # password
                if not self.password:
                    return False, "", "SSH 비밀번호가 설정되지 않았습니다"
                    
                ssh.connect(
                    hostname=self.host,
                    port=self.port,
                    username=self.username,
                    password=self.password,
                    timeout=self.timeout
                )
            
            # 명령 실행
            stdin, stdout, stderr = ssh.exec_command(command)
            
            # 출력 읽기
            stdout_data = stdout.read().decode()
            stderr_data = stderr.read().decode()
            exit_code = stdout.channel.recv_exit_status()
            
            logger.info(f"명령 실행 완료: {command} (종료 코드: {exit_code})")
            
            return exit_code == 0, stdout_data, stderr_data
            
        except Exception as e:
            logger.error(f"SSH 명령 실행 실패: {e}")
            return False, "", str(e)
        finally:
            ssh.close()
    
    async def is_ubuntu_booted(self) -> bool:
        """
        우분투가 부팅되었는지 SSH 연결로 확인
        
        Returns:
            bool: 우분투 부팅 여부
        """
        success, message = await self.test_connection()
        if success:
            logger.info("우분투 부팅 확인됨 (SSH 연결 성공)")
            return True
        else:
            logger.debug(f"우분투 부팅 확인 실패: {message}")
            return False
    
    async def boot_to_windows(self) -> Tuple[bool, str]:
        """
        bootWin 명령으로 윈도우 부팅 (.bashrc alias 사용, sudo 권한 필요)
        
        Returns:
            Tuple[bool, str]: (성공 여부, 메시지)
        """
        logger.info(f"윈도우 부팅 명령 실행: {self.boot_command}")
        
        success, stdout, stderr = await self.execute_sudo_command(self.boot_command)
        
        if success:
            return True, f"윈도우 부팅 명령 실행 성공: {stdout.strip()}"
        else:
            return False, f"윈도우 부팅 명령 실행 실패: {stderr.strip()}"
    
    async def execute_sudo_command(self, command: str) -> Tuple[bool, str, str]:
        """
        sudo 권한이 필요한 명령 실행 (.bashrc alias 포함)
        
        Args:
            command: 실행할 명령 (sudo 없이)
            
        Returns:
            Tuple[bool, str, str]: (성공 여부, stdout, stderr)
        """
        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, self._execute_sudo_command_sync, command)
            return result
        except Exception as e:
            logger.error(f"SSH sudo 명령 실행 중 오류: {e}")
            return False, "", f"sudo 명령 실행 오류: {str(e)}"
    
    def _execute_sudo_command_sync(self, command: str) -> Tuple[bool, str, str]:
        """sudo 명령 동기 실행"""
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        
        try:
            # SSH 연결
            if self.auth_method == "key":
                private_key = self._load_private_key()
                if not private_key:
                    return False, "", "SSH 키 로드 실패"
                    
                ssh.connect(
                    hostname=self.host,
                    port=self.port,
                    username=self.username,
                    pkey=private_key,
                    timeout=self.timeout
                )
            else:  # password
                if not self.password:
                    return False, "", "SSH 비밀번호가 설정되지 않았습니다"
                    
                ssh.connect(
                    hostname=self.host,
                    port=self.port,
                    username=self.username,
                    password=self.password,
                    timeout=self.timeout
                )
            
            # 명령이 이미 sudo를 포함하는지 확인
            if self.auth_method == "password" and self.password:
                if "sudo" in command:
                    # sudo 명령이 포함된 경우, bash -c로 감싸서 단일 세션에서 실행
                    # 첫 번째 sudo에만 비밀번호를 제공하고, sudo 세션을 유지
                    escaped_command = command.replace('"', '\\"')
                    full_command = f"echo \"[PASSWORD]\" | sudo -S bash -c \"{escaped_command}\""
                    actual_command = f"echo \"{self.password}\" | sudo -S bash -c \"{escaped_command}\""
                else:
                    # 명령에 sudo가 없는 경우, sudo -S 추가
                    full_command = f"echo \"[PASSWORD]\" | sudo -S {command}"
                    actual_command = f"echo \"{self.password}\" | sudo -S {command}"
            else:
                # 키 기반: passwordless sudo
                if "sudo" not in command:
                    full_command = f"sudo {command}"
                    actual_command = full_command
                else:
                    # 명령에 이미 sudo가 포함된 경우 그대로 실행
                    full_command = command
                    actual_command = command
                
            logger.info(f"sudo 명령 실행: {full_command}")  # 비밀번호 마스킹된 버전
            
            # .bashrc 오류를 무시하기 위해 2>/dev/null 추가
            if "sudo" in actual_command:
                actual_command = f"bash -c '{actual_command} 2>/dev/null || {actual_command}'"
            
            stdin, stdout, stderr = ssh.exec_command(actual_command)
            
            # 출력 읽기
            stdout_data = stdout.read().decode()
            stderr_data = stderr.read().decode()
            exit_code = stdout.channel.recv_exit_status()
            
            logger.info(f"sudo 명령 실행 완료: {command} (종료 코드: {exit_code})")
            logger.info(f"stdout: {stdout_data}")
            logger.info(f"stderr: {stderr_data}")
            
            return exit_code == 0, stdout_data, stderr_data
            
        except Exception as e:
            logger.error(f"SSH sudo 명령 실행 실패: {e}")
            return False, "", str(e)
        finally:
            ssh.close()
    
    async def execute_command_interactive(self, command: str) -> Tuple[bool, str, str]:
        """
        인터랙티브 bash 세션에서 명령 실행 (.bashrc 로드 포함)
        
        Args:
            command: 실행할 명령
            
        Returns:
            Tuple[bool, str, str]: (성공 여부, stdout, stderr)
        """
        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, self._execute_command_interactive_sync, command)
            return result
        except Exception as e:
            logger.error(f"SSH 인터랙티브 명령 실행 중 오류: {e}")
            return False, "", f"명령 실행 오류: {str(e)}"
    
    def _execute_command_interactive_sync(self, command: str) -> Tuple[bool, str, str]:
        """동기 인터랙티브 명령 실행"""
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        
        try:
            # SSH 연결 (인증 방법에 따라 분기)
            if self.auth_method == "key":
                private_key = self._load_private_key()
                if not private_key:
                    return False, "", "SSH 키 로드 실패"
                    
                ssh.connect(
                    hostname=self.host,
                    port=self.port,
                    username=self.username,
                    pkey=private_key,
                    timeout=self.timeout
                )
            else:  # password
                if not self.password:
                    return False, "", "SSH 비밀번호가 설정되지 않았습니다"
                    
                ssh.connect(
                    hostname=self.host,
                    port=self.port,
                    username=self.username,
                    password=self.password,
                    timeout=self.timeout
                )
            
            # 인터랙티브 bash 세션에서 명령 실행
            # -l 옵션으로 로그인 셸을 사용하여 .bashrc를 자동으로 로드
            bash_command = f"bash -l -c '{command}'"
            stdin, stdout, stderr = ssh.exec_command(bash_command)
            
            # 출력 읽기
            stdout_data = stdout.read().decode()
            stderr_data = stderr.read().decode()
            exit_code = stdout.channel.recv_exit_status()
            
            logger.info(f"인터랙티브 명령 실행 완료: {command} (종료 코드: {exit_code})")
            
            return exit_code == 0, stdout_data, stderr_data
            
        except Exception as e:
            logger.error(f"SSH 인터랙티브 명령 실행 실패: {e}")
            return False, "", str(e)
        finally:
            ssh.close()


# 전역 SSH 서비스 인스턴스
ssh_service = SSHService()