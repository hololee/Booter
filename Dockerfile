# Python 3.11 slim 이미지 사용
FROM python:3.11-slim

# 작업 디렉터리 설정
WORKDIR /app

# 시스템 패키지 업데이트 및 필요한 패키지 설치
RUN apt-get update && apt-get install -y \
    openssh-client \
    iputils-ping \
    net-tools \
    && rm -rf /var/lib/apt/lists/*

# uv 설치 (Python 패키지 매니저)
RUN pip install uv

# pyproject.toml과 uv.lock 복사 (의존성 설치용)
COPY pyproject.toml uv.lock* ./

# 의존성 설치
RUN uv sync --frozen

# 애플리케이션 코드 복사
COPY . .

# SSH 키 디렉터리 생성 (볼륨 마운트용)
RUN mkdir -p /app/ssh_keys

# 포트 8000 노출
EXPOSE 8000

# 애플리케이션 실행
CMD ["uv", "run", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]