import asyncio
import logging
from pathlib import Path
from typing import Tuple

import paramiko
from paramiko.ssh_exception import NoValidConnectionsError

from config import SSHConfig, config

logger = logging.getLogger(__name__)


class SSHService:
    """SSH 연결 및 원격 명령 실행 서비스"""

    def __init__(self, ssh_config: SSHConfig, host: str, boot_command: str = None):
        if ssh_config is None:
            raise ValueError("ssh_config is required")
        if not host:
            raise ValueError("host is required")

        self.host = host
        self.username = ssh_config.user
        self.key_path = Path(ssh_config.key_path).expanduser() if ssh_config.key_path else None
        self.key_text = ssh_config.key_text
        self.password = ssh_config.password
        self.port = ssh_config.port
        self.boot_command = boot_command or "grub-reboot Windows && reboot"
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
            # SSH 연결 (키가 있으면 키 우선, 없으면 비밀번호)
            if self.key_text or self.key_path:
                private_key = self._load_private_key()
                if private_key:
                    ssh.connect(
                        hostname=self.host,
                        port=self.port,
                        username=self.username,
                        pkey=private_key,
                        timeout=self.timeout,
                    )
                else:
                    # 키 로드 실패 시 비밀번호로 fallback
                    if not self.password:
                        return False, "SSH 키 로드 실패 및 비밀번호 없음"
                    ssh.connect(
                        hostname=self.host,
                        port=self.port,
                        username=self.username,
                        password=self.password,
                        timeout=self.timeout,
                    )
            else:
                # 키가 없으면 비밀번호 사용
                if not self.password:
                    return False, "SSH 비밀번호가 설정되지 않았습니다"

                ssh.connect(
                    hostname=self.host,
                    port=self.port,
                    username=self.username,
                    password=self.password,
                    timeout=self.timeout,
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
            # SSH 연결 (키가 있으면 키로 먼저 시도, 실패하면 비밀번호로 시도)
            connected = False

            # 1. 키 인증 시도
            if self.key_text or self.key_path:
                try:
                    private_key = self._load_private_key()
                    if private_key:
                        ssh.connect(
                            hostname=self.host,
                            port=self.port,
                            username=self.username,
                            pkey=private_key,
                            timeout=self.timeout,
                        )
                        connected = True
                        logger.debug(f"SSH 키 인증 성공: {self.host}")
                except Exception as e:
                    logger.debug(f"SSH 키 인증 실패: {e}")

            # 2. 키 인증이 실패했거나 키가 없으면 비밀번호로 시도
            if not connected:
                ssh.connect(
                    hostname=self.host,
                    port=self.port,
                    username=self.username,
                    password=self.password,
                    timeout=self.timeout,
                )
                logger.debug(f"SSH 비밀번호 인증 성공: {self.host}")

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
            # SSH 연결 (키가 있으면 키 우선, 없으면 비밀번호)
            if self.key_text or self.key_path:
                private_key = self._load_private_key()
                if private_key:
                    ssh.connect(
                        hostname=self.host,
                        port=self.port,
                        username=self.username,
                        pkey=private_key,
                        timeout=self.timeout,
                    )
                else:
                    # 키 로드 실패 시 비밀번호로 fallback
                    if not self.password:
                        return False, "", "SSH 키 로드 실패 및 비밀번호 없음"
                    ssh.connect(
                        hostname=self.host,
                        port=self.port,
                        username=self.username,
                        password=self.password,
                        timeout=self.timeout,
                    )
            else:
                # 키가 없으면 비밀번호 사용
                if not self.password:
                    return False, "", "SSH 비밀번호가 설정되지 않았습니다"

                ssh.connect(
                    hostname=self.host,
                    port=self.port,
                    username=self.username,
                    password=self.password,
                    timeout=self.timeout,
                )

            # sudo 명령은 항상 비밀번호 사용
            if not self.password:
                return False, "", "sudo 명령 실행을 위한 비밀번호가 필요합니다"

            if "sudo" in command:
                # sudo 명령이 포함된 경우, bash -c로 감싸서 단일 세션에서 실행
                # 첫 번째 sudo에만 비밀번호를 제공하고, sudo 세션을 유지
                escaped_command = command.replace('"', '\\"')
                full_command = f'echo "[PASSWORD]" | sudo -S bash -c "{escaped_command}"'
                actual_command = f'echo "{self.password}" | sudo -S bash -c "{escaped_command}"'
            else:
                # 명령에 sudo가 없는 경우, sudo -S 추가
                full_command = f'echo "[PASSWORD]" | sudo -S {command}'
                actual_command = f'echo "{self.password}" | sudo -S {command}'

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
            # SSH 연결 (키가 있으면 키로 먼저 시도, 실패하면 비밀번호로 시도)
            connected = False

            # 1. 키 인증 시도
            if self.key_text or self.key_path:
                try:
                    private_key = self._load_private_key()
                    if private_key:
                        ssh.connect(
                            hostname=self.host,
                            port=self.port,
                            username=self.username,
                            pkey=private_key,
                            timeout=self.timeout,
                        )
                        connected = True
                        logger.debug(f"SSH 키 인증 성공: {self.host}")
                except Exception as e:
                    logger.debug(f"SSH 키 인증 실패: {e}")

            # 2. 키 인증이 실패했거나 키가 없으면 비밀번호로 시도
            if not connected:
                ssh.connect(
                    hostname=self.host,
                    port=self.port,
                    username=self.username,
                    password=self.password,
                    timeout=self.timeout,
                )
                logger.debug(f"SSH 비밀번호 인증 성공: {self.host}")

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

    async def boot_to_windows(self) -> Tuple[bool, str]:
        """
        윈도우로 부팅 (Ubuntu에서 실행)

        Returns:
            Tuple[bool, str]: (성공 여부, 메시지)
        """
        command = self.boot_command
        # sudo 명령이 포함된 경우 execute_sudo_command 사용
        if "sudo" in command:
            success, stdout, stderr = await self.execute_sudo_command(command)
        else:
            success, stdout, stderr = await self.execute_command(command)

        if success:
            logger.info(f"윈도우 부팅 명령 실행 성공: {self.host}")
            return True, "윈도우 부팅 명령 실행됨"
        else:
            error_msg = stderr or stdout or "명령 실행 실패"
            logger.error(f"윈도우 부팅 명령 실행 실패: {error_msg}")
            return False, f"윈도우 부팅 명령 실패: {error_msg}"

    async def shutdown_ubuntu(self) -> Tuple[bool, str]:
        """
        Ubuntu 강제 종료

        Returns:
            Tuple[bool, str]: (성공 여부, 메시지)
        """
        command = "sudo shutdown -h now"
        success, stdout, stderr = await self.execute_sudo_command(command)

        if success:
            logger.info(f"Ubuntu 종료 명령 실행 성공: {self.host}")
            return True, "Ubuntu 종료 명령 실행됨"
        else:
            error_msg = stderr or stdout or "명령 실행 실패"
            logger.error(f"Ubuntu 종료 명령 실행 실패: {error_msg}")
            return False, f"Ubuntu 종료 명령 실패: {error_msg}"

    async def shutdown_windows(self) -> Tuple[bool, str]:
        """
        Windows 강제 종료

        Returns:
            Tuple[bool, str]: (성공 여부, 메시지)
        """
        command = "shutdown /s /f /t 0"
        success, stdout, stderr = await self.execute_command(command)

        if success:
            logger.info(f"Windows 종료 명령 실행 성공: {self.host}")
            return True, "Windows 종료 명령 실행됨"
        else:
            error_msg = stderr or stdout or "명령 실행 실패"
            logger.error(f"Windows 종료 명령 실행 실패: {error_msg}")
            return False, f"Windows 종료 명령 실패: {error_msg}"

    async def reboot_to_ubuntu(self) -> Tuple[bool, str]:
        """
        Ubuntu로 재부팅 (Windows에서 실행)

        Returns:
            Tuple[bool, str]: (성공 여부, 메시지)
        """
        command = "shutdown /r /f /t 0"
        success, stdout, stderr = await self.execute_command(command)

        if success:
            logger.info(f"Ubuntu 재부팅 명령 실행 성공: {self.host}")
            return True, "Ubuntu 재부팅 명령 실행됨"
        else:
            error_msg = stderr or stdout or "명령 실행 실패"
            logger.error(f"Ubuntu 재부팅 명령 실행 실패: {error_msg}")
            return False, f"Ubuntu 재부팅 명령 실패: {error_msg}"


# 전역 SSH 서비스 인스턴스는 제거 (PC별로 개별 생성)
