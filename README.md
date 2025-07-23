# WOL Manager

FastAPI-based web service for controlling multiple dual-boot PCs remotely using Wake-on-LAN.

## 기능

- **Multi-PC Support**: 여러 PC를 단일 웹 인터페이스에서 관리
- **Wake-on-LAN**: 원격으로 PC 부팅
- **Dual-boot Control**: Ubuntu 또는 Windows로 부팅 선택
- **Real-time Status**: WebSocket을 통한 실시간 상태 업데이트
- **Responsive UI**: PC와 모바일에서 모두 사용 가능

## Docker로 실행 (권장)

```bash
# SSH 키 디렉터리 생성 (선택사항)
mkdir -p ssh_keys
cp ~/.ssh/id_rsa ssh_keys/

# 프로덕션 환경으로 실행
docker-compose -f docker-compose.prod.yml up -d

# 웹 인터페이스 접속
# http://localhost 또는 http://your-server-ip
```

## 개발 환경

```bash
# 의존성 설치
uv sync

# 개발 서버 실행
uv run uvicorn app:app --host 0.0.0.0 --port 8000 --reload

# 웹 인터페이스 접속
# http://localhost:8000
```

## 사용법

1. 웹 인터페이스에서 "PC 추가" 버튼 클릭
2. PC 정보 입력 (이름, MAC 주소, IP 주소, SSH 설정 등)
3. Ubuntu 부팅 또는 Windows 부팅 버튼으로 PC 제어
4. 실시간으로 PC 상태 확인
