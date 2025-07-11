# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a FastAPI-based web service for controlling multiple dual-boot PCs remotely using Wake-on-LAN (WoL). The service can boot each PC to either Ubuntu or Windows, with real-time status monitoring through WebSocket connections.

## Key Features

- **Multi-PC Support**: Manage multiple PCs from a single interface
- **Wake-on-LAN**: Boot PCs remotely using magic packets
- **Dual-boot Control**: Boot to Ubuntu directly or Windows via Ubuntu
- **Real-time Status**: WebSocket-based status updates for all PCs
- **Responsive UI**: Modern web interface for PC and mobile
- **SSH Integration**: Connect to Ubuntu via SSH for command execution
- **Port Scanning**: Monitor RDP port to detect Windows state
- **PC Management**: Add, edit, delete PC configurations via web interface

## Development Commands

```bash
# Install dependencies
uv sync

# Run the web service
uv run uvicorn app:app --host 0.0.0.0 --port 8000 --reload

# Run main.py (legacy WoL testing)
uv run python main.py
```

## Architecture

### Core Services
- `services/wol_service.py`: Wake-on-LAN packet transmission (per PC)
- `services/ssh_service.py`: SSH connection and remote command execution (per PC)
- `services/port_scanner.py`: Network port scanning (per PC)
- `services/pc_controller.py`: Main controller orchestrating all services (multi-PC)
- `services/connection_manager.py`: WebSocket connection management

### Web Interface
- `app.py`: FastAPI application with REST and WebSocket endpoints
- `templates/index.html`: Responsive HTML interface with PC management
- `static/css/style.css`: Modern CSS styling with PC grid layout
- `static/js/main.js`: Real-time WebSocket client with multi-PC support

### Configuration & Data
- `config.py`: Centralized configuration management and PC data models
- `pc_data.json`: PC configurations stored in JSON format

## Configuration

PC configurations are stored in `pc_data.json` and can be managed through the web interface. The default PC uses these environment variables:

```bash
PC_NAME="DualBoot-PC"
PC_MAC="AA:BB:CC:DD:EE:FF"
PC_IP="192.168.1.100"
SSH_USER="ubuntu"
SSH_KEY_PATH="~/.ssh/id_rsa"
SSH_PORT="22"
RDP_PORT="3389"
BOOT_COMMAND="bootWin"
```

## API Endpoints

### Multi-PC Management
- `GET /api/pcs`: Get all PCs
- `GET /api/pcs/active`: Get active PCs
- `GET /api/pcs/{pc_id}`: Get specific PC
- `POST /api/pcs`: Add new PC
- `PUT /api/pcs/{pc_id}`: Update PC
- `DELETE /api/pcs/{pc_id}`: Delete PC

### PC Control
- `POST /api/pcs/{pc_id}/boot/ubuntu`: Start Ubuntu boot for specific PC
- `POST /api/pcs/{pc_id}/boot/windows`: Start Windows boot for specific PC
- `GET /api/pcs/{pc_id}/status`: Get specific PC status
- `GET /api/status`: Get all PC statuses
- `GET /api/tasks/{task_id}`: Get boot task status

### Legacy API (for backward compatibility)
- `GET /`: Web interface
- `POST /boot/ubuntu`: Start Ubuntu boot (default PC)
- `POST /boot/windows`: Start Windows boot (default PC)
- `GET /status`: Get default PC status
- `GET /task/{task_id}`: Get boot task status
- `WebSocket /ws`: Real-time status updates

## Boot Process

1. **Ubuntu Boot**: Send WoL packet → Wait for SSH connection
2. **Windows Boot**: Send WoL packet → Wait for SSH → Execute `bootWin` command → Wait for RDP port

## PC Data Model

Each PC configuration includes:
- `id`: Unique identifier
- `name`: Display name
- `mac_address`: MAC address for WoL
- `ip_address`: IP address for connection
- `ssh_user`: SSH username
- `ssh_key_path`: Path to SSH private key
- `ssh_port`: SSH port (default: 22)
- `rdp_port`: RDP port (default: 3389)
- `boot_command`: Windows boot command (default: "bootWin")
- `description`: Optional description
- `is_active`: Whether PC is active

## Testing

The web interface is available at http://localhost:8000 when running the service. Use the web interface to add, edit, and control multiple PCs.