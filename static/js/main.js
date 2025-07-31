class MultiPCController {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectInterval = 1000;
        this.pcs = new Map();
        this.bootingPCs = new Map(); // 부팅 중인 PC들과 정보 추적 {pcId: {startTime, targetOS}}
        this.bootTimeoutDuration = 3 * 60 * 1000; // 3분 (밀리초)
        
        this.vms = new Map(); 
        this.vmTasks = new Map(); // VM 작업 추적
        this.vmStatuses = new Map(); // VM 상태 저장
        this.isEditing = false;
        
        // localStorage에서 부팅 상태 복원
        this.loadBootingStatusFromStorage();
        this.currentEditingPcId = null;
        
        // 현재 선택된 메뉴 타입 (pc 또는 vm)
        this.currentMenuType = 'pc';
        
        // 모니터링 상태 플래그
        this.pcMonitoringEnabled = true;  // PC 탭이 기본이므로 PC 모니터링 활성화
        this.vmMonitoringEnabled = false; // VM 모니터링은 비활성화
        
        this.initializeElements();
        this.attachEventListeners();
        this.connectWebSocket();
        
        // 초기 상태 설정 (PC 메뉴가 기본 선택)
        this.switchMenu('pc');
        this.loadPCs();
    }
    
    initializeElements() {
        // 메뉴 관련 요소들
        this.menuToggle = document.getElementById('menuToggle');
        this.sidebar = document.getElementById('sidebar');
        this.mobileOverlay = document.getElementById('mobileOverlay');
        this.container = document.querySelector('.container');
        
        // 메뉴 항목들
        this.menuItems = document.querySelectorAll('.menu-item');
        
        
        // 헤더 버튼들
        this.addPcBtn = document.getElementById('addPcBtn');
        this.addVmBtn = document.getElementById('addVmBtn');
        this.refreshAllBtn = document.getElementById('refreshAllBtn');
        
        // PC 그리드
        this.pcGrid = document.getElementById('pcGrid');
        
        // VM 그리드
        this.vmGrid = document.getElementById('vmGrid');
        
        
        // 모달 요소들
        this.pcModal = document.getElementById('pcModal');
        this.pcForm = document.getElementById('pcForm');
        this.modalTitle = document.getElementById('modalTitle');
        this.cancelBtn = document.getElementById('cancelBtn');
        this.saveBtn = document.getElementById('saveBtn');
        
        // VM 모달 요소들
        this.vmModal = document.getElementById('vmModal');
        this.vmForm = document.getElementById('vmForm');
        this.vmModalTitle = document.getElementById('vmModalTitle');
        this.vmCancelBtn = document.getElementById('vmCancelBtn');
        this.vmSaveBtn = document.getElementById('vmSaveBtn');
        
        // 삭제 모달
        this.deleteModal = document.getElementById('deleteModal');
        this.deletePcName = document.getElementById('deletePcName');
        this.cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
        this.confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
        
        // VM 삭제 모달
        this.deleteVmModal = document.getElementById('deleteVmModal');
        this.deleteVmName = document.getElementById('deleteVmName');
        this.cancelDeleteVmBtn = document.getElementById('cancelDeleteVmBtn');
        this.confirmDeleteVmBtn = document.getElementById('confirmDeleteVmBtn');
        
        // 취소 확인 모달
        this.cancelModal = document.getElementById('cancelModal');
        this.keepEditingBtn = document.getElementById('keepEditingBtn');
        this.confirmCancelBtn = document.getElementById('confirmCancelBtn');
        
        // SSH 관련 요소들
        
        // 알림 컨테이너
        this.notificationContainer = document.getElementById('notificationContainer');
    }
    
    attachEventListeners() {
        // 메뉴 토글 이벤트
        if (this.menuToggle) {
            this.menuToggle.addEventListener('click', () => this.toggleSidebar());
        }
        
        if (this.mobileOverlay) {
            this.mobileOverlay.addEventListener('click', () => this.closeSidebar());
        }
        
        // 메뉴 항목 클릭 이벤트
        this.menuItems.forEach(item => {
            item.addEventListener('click', () => this.selectMenuItem(item));
        });
        
        // 헤더 버튼 이벤트
        this.addPcBtn.addEventListener('click', () => this.openAddPcModal());
        this.addVmBtn.addEventListener('click', () => this.openAddVmModal());
        this.refreshAllBtn.addEventListener('click', () => this.refreshAll());
        
        // PC 모달 이벤트
        this.cancelBtn.addEventListener('click', () => this.showCancelConfirmation());
        this.pcForm.addEventListener('submit', (e) => this.handlePcSubmit(e));
        
        // VM 모달 이벤트
        this.vmCancelBtn.addEventListener('click', () => this.closeVmModal());
        this.vmForm.addEventListener('submit', (e) => this.handleVmSubmit(e));
        
        // PC 삭제 모달 이벤트
        this.cancelDeleteBtn.addEventListener('click', () => this.closeDeleteModal());
        this.confirmDeleteBtn.addEventListener('click', () => this.confirmDeletePc());
        
        // VM 삭제 모달 이벤트
        this.cancelDeleteVmBtn.addEventListener('click', () => this.closeDeleteVmModal());
        this.confirmDeleteVmBtn.addEventListener('click', () => this.confirmDeleteVm());
        
        // 취소 확인 모달 이벤트
        this.keepEditingBtn.addEventListener('click', () => this.closeCancelModal());
        this.confirmCancelBtn.addEventListener('click', () => this.confirmCancel());
        
        
        // SSH 관련 이벤트 리스너들
        this.initializeSSHEventListeners();
        
        // 모달 배경 클릭 시 닫기
        this.deleteModal.addEventListener('click', (e) => {
            if (e.target === this.deleteModal) this.closeDeleteModal();
        });
        
        this.deleteVmModal.addEventListener('click', (e) => {
            if (e.target === this.deleteVmModal) this.closeDeleteVmModal();
        });
        
        this.cancelModal.addEventListener('click', (e) => {
            if (e.target === this.cancelModal) this.closeCancelModal();
        });
        
        // 윈도우 리사이즈 이벤트
        window.addEventListener('resize', () => this.handleResize());
        
        // 페이지 가시성 변경 시 WebSocket 재연결
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && (!this.ws || this.ws.readyState === WebSocket.CLOSED)) {
                this.connectWebSocket();
            }
        });
    }
    
    connectWebSocket() {
        try {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            
            // 0.0.0.0을 localhost로 변환
            let host = window.location.host;
            if (host.startsWith('0.0.0.0:')) {
                host = host.replace('0.0.0.0:', 'localhost:');
            }
            
            const wsUrl = `${protocol}//${host}/ws`;
            console.log('WebSocket 연결 시도:', wsUrl);
            
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                console.log('WebSocket connected');
                this.reconnectAttempts = 0;
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleWebSocketMessage(data);
                } catch (error) {
                    console.error('WebSocket message parsing error:', error);
                }
            };
            
            this.ws.onclose = () => {
                console.log('WebSocket disconnected');
                this.scheduleReconnect();
            };
            
            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
            
        } catch (error) {
            console.error('WebSocket connection error:', error);
            this.scheduleReconnect();
        }
    }
    
    scheduleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1);
            
            setTimeout(() => {
                console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
                this.connectWebSocket();
            }, delay);
        }
    }
    
    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'status_update':
                this.updateAllStatus(data.data);
                break;
            case 'boot_start':
                this.handleBootStart(data.data);
                break;
            case 'boot_progress':
                this.handleBootProgress(data.data);
                break;
            case 'boot_complete':
                this.handleBootComplete(data.data);
                break;
            default:
                console.log('Unknown message type:', data.type);
        }
    }
    
    async loadPCs() {
        try {
            const response = await fetch('/api/pcs');
            const data = await response.json();
            
            this.pcs.clear();
            data.pcs.forEach(pc => {
                this.pcs.set(pc.id, pc);
            });
            
            this.renderPCGrid();
            
        } catch (error) {
            console.error('PC 목록 로드 실패:', error);
            this.showNotification('PC 목록을 불러오는데 실패했습니다', 'error');
        }
    }
    
    async loadVMs() {
        // VM 기능은 현재 개발 예정입니다.
        // 이 함수는 현재 아무런 동작도 하지 않습니다.
        this.renderEmptyVMState();
    }
    
    renderPCGrid() {
        if (this.pcs.size === 0) {
            this.pcGrid.innerHTML = `
                <div class="empty-state">
                    <h3>등록된 PC가 없습니다</h3>
                    <p>새 PC를 추가하여 시작하세요</p>
                </div>
            `;
            return;
        }
        
        this.pcGrid.innerHTML = '';
        
        this.pcs.forEach(pc => {
            const pcCard = this.createPCCard(pc);
            this.pcGrid.appendChild(pcCard);
            
            // 복원된 부팅 상태가 있으면 UI에 반영
            if (this.bootingPCs.has(pc.id)) {
                const bootInfo = this.bootingPCs.get(pc.id);
                this.updatePCBootStatus(pc.id, this.getBootingStatusText(bootInfo.targetOS, 'booting'), 'booting');
                
                // 부팅 중일 때 버튼 상태 업데이트
                const ubuntuBtn = document.getElementById(`ubuntu-btn-${pc.id}`);
                const windowsBtn = document.getElementById(`windows-btn-${pc.id}`);
                this.updateButtonsForState('booting', ubuntuBtn, windowsBtn);
            }
        });
    }
    
    renderEmptyVMState() {
        this.pcGrid.innerHTML = `
            <div class="empty-state">
                <h3>등록된 VM이 없습니다</h3>
                <p>VM 기능은 현재 준비 중입니다</p>
                <p>향후 업데이트를 통해 제공될 예정입니다</p>
            </div>
        `;
    }
    
    createPCCard(pc) {
        const card = document.createElement('div');
        const isDeprecated = pc.ssh_user || pc.ssh_password || pc.ssh_key_text || pc.rdp_port;
        card.className = `pc-card${isDeprecated ? ' deprecated' : ''}`;
        card.id = `pc-${pc.id}`;
        
        card.innerHTML = `
            <div class="pc-card-header">
                <div class="pc-card-title">
                    <span class="pc-status-dot" id="status-dot-${pc.id}"></span>
                    <span class="pc-name" ${pc.description ? `title="${pc.description}"` : ''}>${pc.name}</span>
                </div>
                <div class="pc-card-actions">
                    <button class="icon-btn edit-btn" onclick="app.openEditPcModal('${pc.id}')" title="편집">
                        <img src="/static/resources/edit.svg" alt="편집" class="action-icon">
                    </button>
                    <button class="icon-btn delete-btn" onclick="app.openDeleteModal('${pc.id}')" title="삭제">
                        <img src="/static/resources/trash.svg" alt="삭제" class="action-icon">
                    </button>
                </div>
            </div>
            <div class="pc-card-body">
                <div class="pc-info">
                    <div class="pc-info-item">
                        <span class="pc-info-label">IP 주소</span>
                        <span class="pc-info-value">${pc.ip_address}</span>
                    </div>
                    <div class="pc-info-item">
                        <span class="pc-info-label">MAC 주소</span>
                        <span class="pc-info-value">${pc.mac_address}</span>
                    </div>
                    <div class="pc-info-item">
                        <span class="pc-info-label">상태</span>
                        <span class="pc-info-value" id="status-text-${pc.id}">확인 중...</span>
                    </div>
                    <div class="pc-info-item">
                        <span class="pc-info-label">마지막 확인</span>
                        <span class="pc-info-value" id="last-check-${pc.id}">-</span>
                    </div>
                </div>
                <div class="pc-boot-buttons">
                    <button class="boot-btn ubuntu-btn" id="ubuntu-btn-${pc.id}" onclick="app.handleUbuntuButton('${pc.id}')">
                        ubuntu UP
                    </button>
                    <button class="boot-btn windows-btn" id="windows-btn-${pc.id}" onclick="app.handleWindowsButton('${pc.id}')">
                        windows UP
                    </button>
                </div>
            </div>
        `;
        
        return card;
    }
    
    updateAllStatus(data) {
        // PC 모니터링이 활성화된 경우에만 PC 상태 업데이트
        if (this.pcMonitoringEnabled && data.pc_statuses) {
            Object.entries(data.pc_statuses).forEach(([pcId, status]) => {
                this.updatePCStatus(pcId, status);
            });
        }
        
        // VM 모니터링이 활성화된 경우에만 VM 상태 업데이트
        if (this.vmMonitoringEnabled && data.vm_statuses) {
            Object.entries(data.vm_statuses).forEach(([vmId, status]) => {
                this.updateVMCardStatus(vmId, status);
            });
        }
    }
    
    updatePCStatus(pcId, status) {
        const statusDot = document.getElementById(`status-dot-${pcId}`);
        const statusText = document.getElementById(`status-text-${pcId}`);
        const lastCheck = document.getElementById(`last-check-${pcId}`);
        const ubuntuBtn = document.getElementById(`ubuntu-btn-${pcId}`);
        const windowsBtn = document.getElementById(`windows-btn-${pcId}`);
        
        if (!statusDot || !statusText || !lastCheck || !ubuntuBtn || !windowsBtn) {
            return;
        }
        
        // 부팅 중인 PC 타임아웃 체크
        if (this.bootingPCs.has(pcId)) {
            // PC가 부팅 중인 것으로 기록되어 있을 때
            const bootInfo = this.bootingPCs.get(pcId);
            const now = Date.now();

            if (status.state === 'ubuntu' || status.state === 'windows') {
                // 부팅이 완료된 상태(ubuntu/windows)를 받으면, 부팅 중 상태를 해제하고 상태 업데이트를 계속 진행
                this.removeBootingPC(pcId);
            } else if (now - bootInfo.startTime > this.bootTimeoutDuration) {
                // 부팅 타임아웃이 지난 경우, 부팅 상태를 해제하고 상태 업데이트를 계속 진행
                this.removeBootingPC(pcId);
                console.log(`PC ${pcId} 부팅 타임아웃: 3분 경과로 부팅 상태 해제`);
            } else {
                // 부팅이 아직 완료되지 않았고 타임아웃도 지나지 않았으면,
                // 현재 상태 업데이트를 무시하고 '부팅 중' 상태를 유지
                if (status.timestamp) {
                    lastCheck.textContent = this.formatTimestamp(status.timestamp);
                }
                // 부팅 중에는 모든 버튼 비활성화, 텍스트도 업데이트
                this.updateButtonsForState('booting', ubuntuBtn, windowsBtn);
                return; // 여기서 함수를 종료하여 '부팅 중' UI 유지
            }
        }
        
        // 상태 점 업데이트
        statusDot.className = 'pc-status-dot';
        switch (status.state) {
            case 'ubuntu':
            case 'windows':
                statusDot.classList.add('online');
                break;
            case 'off':
            default:
                statusDot.classList.add('offline');
                break;
        }
        
        // 상태 텍스트 업데이트
        statusText.textContent = this.getStateDisplayName(status.state);
        
        // 마지막 확인 시간 업데이트
        if (status.timestamp) {
            lastCheck.textContent = this.formatTimestamp(status.timestamp);
        }
        
        // 버튼 상태와 텍스트 업데이트 (상태에 따라)
        this.updateButtonsForState(status.state, ubuntuBtn, windowsBtn);
    }
    
    
    // PC 관리 메서드들
    openAddPcModal() {
        this.isEditing = false;
        this.currentEditingPcId = null;
        this.modalTitle.textContent = 'PC 추가';
        this.pcForm.reset();
        
        // 기본값 설정
        document.getElementById('ubuntuSshUser').value = 'ubuntu';
        document.getElementById('ubuntuSshPort').value = '22';
        document.getElementById('windowsSshUser').value = 'administrator';
        document.getElementById('windowsSshPort').value = '22';
        
        this.pcModal.classList.add('show');
    }
    
    openEditPcModal(pcId) {
        const pc = this.pcs.get(pcId);
        if (!pc) return;
        
        this.isEditing = true;
        this.currentEditingPcId = pcId;
        this.modalTitle.textContent = 'PC 편집';
        
        // 기본 정보 채우기
        document.getElementById('pcName').value = pc.name;
        document.getElementById('macAddress').value = pc.mac_address;
        document.getElementById('ipAddress').value = pc.ip_address;
        document.getElementById('bootCommand').value = pc.boot_command;
        document.getElementById('description').value = pc.description || '';
        
        // deprecated 표시 및 알림
        if (pc.ssh_user || pc.ssh_password || pc.ssh_key_text || pc.rdp_port) {
            this.showDeprecatedFormatAlert();
        }
        
        // Ubuntu SSH 설정
        if (pc.ubuntu_ssh) {
            document.getElementById('ubuntuSshUser').value = pc.ubuntu_ssh.user || 'ubuntu';
            document.getElementById('ubuntuSshKeyText').value = pc.ubuntu_ssh.key_text || '';
            document.getElementById('ubuntuSshPassword').value = pc.ubuntu_ssh.password || '';
            document.getElementById('ubuntuSshPort').value = pc.ubuntu_ssh.port || 22;
        } else {
            // 하위 호환성을 위한 기존 필드 사용
            document.getElementById('ubuntuSshUser').value = pc.ssh_user || 'ubuntu';
            document.getElementById('ubuntuSshKeyText').value = pc.ssh_key_text || '';
            document.getElementById('ubuntuSshPassword').value = pc.ssh_password || '';
            document.getElementById('ubuntuSshPort').value = pc.ssh_port || 22;
        }
        
        // Windows SSH 설정
        if (pc.windows_ssh) {
            document.getElementById('windowsSshUser').value = pc.windows_ssh.user || 'administrator';
            document.getElementById('windowsSshKeyText').value = pc.windows_ssh.key_text || '';
            document.getElementById('windowsSshPassword').value = pc.windows_ssh.password || '';
            document.getElementById('windowsSshPort').value = pc.windows_ssh.port || 22;
        } else {
            // 기본값 설정
            document.getElementById('windowsSshUser').value = 'administrator';
            document.getElementById('windowsSshKeyText').value = '';
            document.getElementById('windowsSshPassword').value = '';
            document.getElementById('windowsSshPort').value = 22;
        }
        
        this.pcModal.classList.add('show');
    }
    
    closePcModal() {
        this.pcModal.classList.remove('show');
        this.isEditing = false;
        this.currentEditingPcId = null;
    }
    
    async handlePcSubmit(e) {
        e.preventDefault();
        
        // 폼 검증 확인
        console.log('Checking form validity...');
        
        // MAC 주소 필드 직접 확인
        const macInput = document.getElementById('macAddress');
        console.log('MAC input value:', macInput.value);
        console.log('MAC input validity:', macInput.checkValidity());
        console.log('MAC input validation message:', macInput.validationMessage);
        console.log('MAC input pattern:', macInput.pattern);
        console.log('MAC input required:', macInput.required);
        
        // 강제로 MAC 주소 검증
        const macPattern = /^([0-9A-Fa-f]{2}:){5}([0-9A-Fa-f]{2})$/;
        if (!macPattern.test(macInput.value)) {
            console.log('Manual MAC validation failed');
            macInput.setCustomValidity('MAC 주소는 AA:BB:CC:DD:EE:FF 형식이어야 합니다');
            macInput.reportValidity();
            return;
        } else {
            macInput.setCustomValidity(''); // 유효한 경우 커스텀 메시지 제거
        }
        
        if (!this.pcForm.checkValidity()) {
            console.log('Form validation failed');
            // 각 필드의 검증 상태 확인
            const inputs = this.pcForm.querySelectorAll('input[required], input[pattern]');
            inputs.forEach(input => {
                if (!input.checkValidity()) {
                    console.log(`Invalid field: ${input.name}, value: ${input.value}, validationMessage: ${input.validationMessage}`);
                }
            });
            this.pcForm.reportValidity();
            return;
        }
        
        console.log('Form validation passed');
        
        const formData = new FormData(this.pcForm);
        
        // PC 이름에서 ID 자동 생성
        const pcName = formData.get('name');
        const pcId = this.isEditing 
            ? this.currentEditingPcId 
            : this.generatePcId(pcName);
        
        // Ubuntu SSH 설정
        const ubuntuSsh = {
            user: formData.get('ubuntu_ssh_user') || 'ubuntu',
            key_text: formData.get('ubuntu_ssh_key_text') || '',
            password: formData.get('ubuntu_ssh_password') || '',
            port: parseInt(formData.get('ubuntu_ssh_port')) || 22
        };
        
        // Windows SSH 설정 (필수)
        const windowsSsh = {
            user: formData.get('windows_ssh_user') || 'administrator',
            key_text: formData.get('windows_ssh_key_text') || '',
            password: formData.get('windows_ssh_password') || '',
            port: parseInt(formData.get('windows_ssh_port')) || 22
        };
        
        const pcData = {
            id: pcId,
            name: pcName,
            mac_address: formData.get('mac_address'),
            ip_address: formData.get('ip_address'),
            ubuntu_ssh: ubuntuSsh,
            windows_ssh: windowsSsh,
            boot_command: formData.get('boot_command'),
            description: formData.get('description')
        };
        
        // 두 OS 모두 빈 비밀번호 허용
        
        console.log('Sending PC data:', pcData);
        
        try {
            let response;
            if (this.isEditing) {
                response = await fetch(`/api/pcs/${this.currentEditingPcId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(pcData)
                });
            } else {
                response = await fetch('/api/pcs', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(pcData)
                });
            }
            
            const result = await response.json();
            
            if (response.ok) {
                this.showNotification(result.message, 'success');
                this.closePcModal();
                await this.loadPCs();
            } else {
                console.error('Server error response:', result);
                this.showNotification(result.detail || 'PC 저장에 실패했습니다', 'error');
            }
            
        } catch (error) {
            console.error('PC 저장 오류:', error);
            this.showNotification('PC 저장 중 오류가 발생했습니다', 'error');
        }
    }
    
    openDeleteModal(pcId) {
        const pc = this.pcs.get(pcId);
        if (!pc) return;
        
        this.currentEditingPcId = pcId;
        this.deletePcName.textContent = pc.name;
        this.deleteModal.classList.add('show');
    }
    
    closeDeleteModal() {
        this.deleteModal.classList.remove('show');
        this.currentEditingPcId = null;
    }
    
    async confirmDeletePc() {
        if (!this.currentEditingPcId) return;
        
        try {
            const response = await fetch(`/api/pcs/${this.currentEditingPcId}`, {
                method: 'DELETE'
            });
            
            const result = await response.json();
            
            if (response.ok) {
                this.showNotification(result.message, 'success');
                this.closeDeleteModal();
                await this.loadPCs();
            } else {
                this.showNotification(result.detail || 'PC 삭제에 실패했습니다', 'error');
            }
            
        } catch (error) {
            console.error('PC 삭제 오류:', error);
            this.showNotification('PC 삭제 중 오류가 발생했습니다', 'error');
        }
    }
    
    // 버튼 상태 업데이트 메서드
    updateButtonsForState(state, ubuntuBtn, windowsBtn) {
        if (!ubuntuBtn || !windowsBtn) return;
        
        switch (state) {
            case 'off':
                // PC가 꺼짐: 두 버튼 활성화, "ubuntu UP", "windows UP"
                ubuntuBtn.disabled = false;
                windowsBtn.disabled = false;
                ubuntuBtn.textContent = 'ubuntu UP';
                windowsBtn.textContent = 'windows UP';
                break;
            case 'ubuntu':
                // Ubuntu 실행중: "ubuntu DOWN", "windows UP" (둘 다 활성화)
                ubuntuBtn.disabled = false;
                windowsBtn.disabled = false;
                ubuntuBtn.textContent = 'ubuntu DOWN';
                windowsBtn.textContent = 'windows UP';
                break;
            case 'windows':
                // Windows 실행중: "ubuntu UP", "windows DOWN" (둘 다 활성화)
                ubuntuBtn.disabled = false;
                windowsBtn.disabled = false;
                ubuntuBtn.textContent = 'ubuntu UP';
                windowsBtn.textContent = 'windows DOWN';
                break;
            case 'booting':
            default:
                // 부팅중이거나 알 수 없는 상태: 두 버튼 비활성화, "ubuntu UP", "windows UP"
                ubuntuBtn.disabled = true;
                windowsBtn.disabled = true;
                ubuntuBtn.textContent = 'ubuntu UP';
                windowsBtn.textContent = 'windows UP';
                break;
        }
    }
    
    // 버튼 클릭 핸들러들
    async handleUbuntuButton(pcId) {
        const pc = this.pcs.get(pcId);
        if (!pc) return;
        
        // 현재 상태 확인
        const statusResponse = await fetch(`/api/pcs/${pcId}/status`);
        const statusData = await statusResponse.json();
        const currentState = statusData.state;
        
        if (currentState === 'ubuntu') {
            // Ubuntu 실행중이면 종료
            await this.shutdownUbuntu(pcId);
        } else if (currentState === 'windows') {
            // Windows 실행중이면 Ubuntu로 재부팅
            await this.rebootToUbuntu(pcId);
        } else {
            // 그 외의 경우는 Ubuntu 부팅 (WOL)
            await this.bootUbuntu(pcId);
        }
    }
    
    async handleWindowsButton(pcId) {
        const pc = this.pcs.get(pcId);
        if (!pc) return;
        
        // 현재 상태 확인
        const statusResponse = await fetch(`/api/pcs/${pcId}/status`);
        const statusData = await statusResponse.json();
        const currentState = statusData.state;
        
        if (currentState === 'windows') {
            // Windows 실행중이면 종료
            await this.shutdownWindows(pcId);
        } else if (currentState === 'windows') {
            // Windows에서 Ubuntu로 재부팅 (현재는 종료만 구현)
            await this.shutdownWindows(pcId);
        } else {
            // 그 외의 경우는 Windows 부팅
            await this.bootWindows(pcId);
        }
    }
    
    // 종료 메서드들
    async shutdownUbuntu(pcId) {
        try {
            const response = await fetch(`/api/pcs/${pcId}/shutdown/ubuntu`, {
                method: 'POST'
            });
            
            const result = await response.json();
            
            if (response.ok) {
                this.showNotification(`Ubuntu 종료를 시작했습니다`, 'info');
            } else {
                this.showNotification(result.detail || 'Ubuntu 종료 요청 실패', 'error');
            }
            
        } catch (error) {
            console.error('Ubuntu 종료 오류:', error);
            this.showNotification('Ubuntu 종료 요청 중 오류가 발생했습니다', 'error');
        }
    }
    
    async shutdownWindows(pcId) {
        try {
            const response = await fetch(`/api/pcs/${pcId}/shutdown/windows`, {
                method: 'POST'
            });
            
            const result = await response.json();
            
            if (response.ok) {
                this.showNotification(`Windows 종료를 시작했습니다`, 'info');
            } else {
                this.showNotification(result.detail || 'Windows 종료 요청 실패', 'error');
            }
            
        } catch (error) {
            console.error('Windows 종료 오류:', error);
            this.showNotification('Windows 종료 요청 중 오류가 발생했습니다', 'error');
        }
    }
    
    async rebootToUbuntu(pcId) {
        try {
            const response = await fetch(`/api/pcs/${pcId}/reboot/ubuntu`, {
                method: 'POST'
            });
            
            const result = await response.json();
            
            if (response.ok) {
                this.showNotification(`Ubuntu로 재부팅을 시작했습니다`, 'info');
            } else {
                this.showNotification(result.detail || 'Ubuntu 재부팅 요청 실패', 'error');
            }
            
        } catch (error) {
            console.error('Ubuntu 재부팅 오류:', error);
            this.showNotification('Ubuntu 재부팅 요청 중 오류가 발생했습니다', 'error');
        }
    }
    
    // 부팅 메서드들
    async bootUbuntu(pcId) {
        try {
            // 부팅 시작 전에 즉시 부팅 상태로 설정
            this.addBootingPC(pcId, 'Ubuntu');
            this.updatePCBootStatus(pcId, this.getBootingStatusText('Ubuntu', 'requesting'), 'booting');
            
            const response = await fetch(`/api/pcs/${pcId}/boot/ubuntu`, {
                method: 'POST'
            });
            
            const result = await response.json();
            
            if (response.ok) {
                this.showNotification(`Ubuntu 부팅을 시작했습니다`, 'success');
            } else {
                // 요청 실패 시 부팅 상태에서 제거
                this.removeBootingPC(pcId);
                this.showNotification(result.detail || 'Ubuntu 부팅 요청 실패', 'error');
            }
            
        } catch (error) {
            console.error('Ubuntu 부팅 오류:', error);
            // 오류 시 부팅 상태에서 제거
            this.removeBootingPC(pcId);
            this.showNotification('Ubuntu 부팅 요청 중 오류가 발생했습니다', 'error');
        }
    }
    
    async bootWindows(pcId) {
        try {
            // 부팅 시작 전에 즉시 부팅 상태로 설정
            this.addBootingPC(pcId, 'Windows');
            this.updatePCBootStatus(pcId, this.getBootingStatusText('Windows', 'requesting'), 'booting');
            
            const response = await fetch(`/api/pcs/${pcId}/boot/windows`, {
                method: 'POST'
            });
            
            const result = await response.json();
            
            if (response.ok) {
                this.showNotification(`Windows 부팅을 시작했습니다`, 'success');
            } else {
                // 요청 실패 시 부팅 상태에서 제거
                this.removeBootingPC(pcId);
                this.showNotification(result.detail || 'Windows 부팅 요청 실패', 'error');
            }
            
        } catch (error) {
            console.error('Windows 부팅 오류:', error);
            // 오류 시 부팅 상태에서 제거
            this.removeBootingPC(pcId);
            this.showNotification('Windows 부팅 요청 중 오류가 발생했습니다', 'error');
        }
    }
    
    async refreshAllPCs() {
        try {
            this.refreshAllBtn.disabled = true;
            this.refreshAllBtn.innerHTML = '<span class="loading-spinner"></span> 새로고침 중...';
            
            const response = await fetch('/api/status');
            const data = await response.json();
            
            if (data.statuses) {
                Object.entries(data.statuses).forEach(([pcId, status]) => {
                    this.updatePCStatus(pcId, status);
                });
            }
            
            this.showNotification('모든 PC 상태를 새로고침했습니다', 'success');
            
        } catch (error) {
            console.error('상태 새로고침 오류:', error);
            this.showNotification('상태 새로고침 실패', 'error');
        } finally {
            this.refreshAllBtn.disabled = false;
            this.refreshAllBtn.innerHTML = '새로고침';
        }
    }
    
    // 이벤트 핸들러들
    handleBootStart(data) {
        this.showNotification(`${data.target_os} 부팅을 시작합니다`, 'info');
        // 부팅 중인 PC로 추가 (시작 시간과 타겟 OS 함께)
        this.addBootingPC(data.pc_id, data.target_os);
        // PC 상태 텍스트 업데이트
        this.updatePCBootStatus(data.pc_id, this.getBootingStatusText(data.target_os, 'booting'), 'booting');
    }
    
    handleBootProgress(data) {
        // PC 상태 텍스트 업데이트
        this.updatePCBootStatus(data.pc_id, data.message);
    }
    
    handleBootComplete(data) {
        const type = data.success ? 'success' : 'error';
        this.showNotification(data.message, type);
        
        // 부팅 완료/실패 시 부팅 중 상태에서 제거
        this.removeBootingPC(data.pc_id);
        
        // 상태 텍스트 및 점 업데이트
        if (data.success) {
            this.updatePCBootStatus(data.pc_id, this.getBootingStatusText(data.target_os, 'completed'), 'online');
        } else {
            this.updatePCBootStatus(data.pc_id, this.getBootingStatusText(data.target_os, 'failed'), 'offline');
        }
        
        // 성공한 경우 버튼 상태도 즉시 업데이트
        if (data.success) {
            const ubuntuBtn = document.getElementById(`ubuntu-btn-${data.pc_id}`);
            const windowsBtn = document.getElementById(`windows-btn-${data.pc_id}`);
            if (ubuntuBtn && windowsBtn) {
                if (data.target_os === 'Ubuntu') {
                    this.updateButtonsForState('ubuntu', ubuntuBtn, windowsBtn);
                } else if (data.target_os === 'Windows') {
                    this.updateButtonsForState('windows', ubuntuBtn, windowsBtn);
                }
            }
        }
    }
    
    updatePCBootStatus(pcId, statusText, statusClass = null) {
        const statusTextElement = document.getElementById(`status-text-${pcId}`);
        if (statusTextElement) {
            statusTextElement.textContent = statusText;
        }

        if (statusClass) {
            const statusDot = document.getElementById(`status-dot-${pcId}`);
            if (statusDot) {
                statusDot.className = 'pc-status-dot';
                statusDot.classList.add(statusClass);
            }
        }
    }
    
    // 부팅 상태 텍스트 표준화
    getBootingStatusText(targetOS, stage = 'booting') {
        const osName = targetOS === 'Ubuntu' ? 'Ubuntu' : targetOS === 'Windows' ? 'Windows' : targetOS;
        
        switch (stage) {
            case 'requesting':
                return `${osName} 부팅 요청중`;
            case 'booting':
                return `${osName} 부팅중`;
            case 'completed':
                return `${osName} 부팅 완료`;
            case 'failed':
                return `${osName} 부팅 실패`;
            default:
                return `${osName} 부팅중`;
        }
    }
    
    // localStorage에 부팅 상태 저장
    saveBootingStatusToStorage() {
        try {
            const bootingData = {};
            this.bootingPCs.forEach((bootInfo, pcId) => {
                bootingData[pcId] = bootInfo;
            });
            localStorage.setItem('bootingPCs', JSON.stringify(bootingData));
        } catch (error) {
            console.error('부팅 상태 저장 실패:', error);
        }
    }
    
    // localStorage에서 부팅 상태 복원
    loadBootingStatusFromStorage() {
        try {
            const bootingDataStr = localStorage.getItem('bootingPCs');
            if (bootingDataStr) {
                const bootingData = JSON.parse(bootingDataStr);
                const now = Date.now();
                
                Object.entries(bootingData).forEach(([pcId, bootInfo]) => {
                    // 이전 버전 호환성 처리 (startTime이 숫자인 경우)
                    if (typeof bootInfo === 'number') {
                        bootInfo = { startTime: bootInfo, targetOS: 'Unknown' };
                    }
                    
                    // 3분이 지나지 않은 것만 복원
                    if (now - bootInfo.startTime <= this.bootTimeoutDuration) {
                        this.bootingPCs.set(pcId, bootInfo);
                        console.log(`PC ${pcId} ${bootInfo.targetOS} 부팅 상태 복원`);
                    }
                });
                
                // 복원 후 저장소 업데이트 (만료된 항목 제거)
                this.saveBootingStatusToStorage();
            }
        } catch (error) {
            console.error('부팅 상태 복원 실패:', error);
            localStorage.removeItem('bootingPCs');
        }
    }
    
    // 부팅 상태 추가 (localStorage 동기화)
    addBootingPC(pcId, targetOS = 'Unknown') {
        this.bootingPCs.set(pcId, {
            startTime: Date.now(),
            targetOS: targetOS
        });
        this.saveBootingStatusToStorage();
    }
    
    // 부팅 상태 제거 (localStorage 동기화)
    removeBootingPC(pcId) {
        this.bootingPCs.delete(pcId);
        this.saveBootingStatusToStorage();
    }
    
    // 유틸리티 메서드들
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        this.notificationContainer.appendChild(notification);
        
        // 3초 후 자동 제거
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease forwards';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }
    
    getStateDisplayName(state) {
        const stateNames = {
            'ubuntu': 'Ubuntu 동작중',
            'windows': 'Windows 동작중',
            'off': '꺼짐',
            'booting': '부팅 중',
            'unknown': '상태 불명'
        };
        return stateNames[state] || '상태 불명';
    }
    
    formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('ko-KR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }
    
    // PC 이름에서 ID 생성
    generatePcId(name) {
        // 한글과 특수문자를 영문으로 변환하고 소문자로 만들기
        let id = name.toLowerCase()
            .replace(/\s+/g, '-')           // 공백을 하이픈으로
            .replace(/[^a-z0-9\-]/g, '')    // 영문, 숫자, 하이픈만 남기기
            .replace(/\-+/g, '-')           // 연속된 하이픈을 하나로
            .replace(/^\-|\-$/g, '');       // 앞뒤 하이픈 제거
        
        // ID가 비어있으면 기본값 사용
        if (!id) {
            id = 'pc';
        }
        
        // 중복 ID 체크 및 번호 추가
        let finalId = id;
        let counter = 1;
        while (this.pcs.has(finalId)) {
            finalId = `${id}-${counter}`;
            counter++;
        }
        
        return finalId;
    }
    
    initializeSSHEventListeners() {
        // 비밀번호 토글 버튼들
        document.querySelectorAll('.password-toggle-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.togglePasswordVisibility(e));
        });
    }
    
    
    togglePasswordVisibility(event) {
        const btn = event.currentTarget;
        const targetId = btn.getAttribute('data-target');
        const passwordInput = document.getElementById(targetId);
        const icon = btn.querySelector('.eye-icon');
        
        if (passwordInput.type === 'password') {
            passwordInput.type = 'text';
            icon.src = '/static/resources/hide.svg';
            icon.alt = 'Hide Password';
        } else {
            passwordInput.type = 'password';
            icon.src = '/static/resources/show.svg';
            icon.alt = 'Show Password';
        }
    }
    
    showDeprecatedFormatAlert() {
        this.showNotification(
            '이 PC는 구 버전 포맷을 사용합니다. 새로운 Ubuntu/Windows SSH 설정으로 업데이트해주세요.', 
            'warning', 
            10000
        );
    }
    
    // 취소 확인 모달 표시
    showCancelConfirmation() {
        this.cancelModal.classList.add('show');
    }
    
    // 취소 확인 모달 닫기
    closeCancelModal() {
        this.cancelModal.classList.remove('show');
    }
    
    // 취소 확인
    confirmCancel() {
        this.closeCancelModal();
        this.closePcModal();
    }
    
    // 메뉴 관련 메서드들
    toggleSidebar() {
        const isMobile = window.innerWidth <= 768;
        
        if (isMobile) {
            // 모바일에서는 오버레이와 함께 사이드바 토글
            this.sidebar.classList.toggle('show');
            this.mobileOverlay.classList.toggle('show');
        } else {
            // 데스크톱에서는 사이드바와 컨테이너 토글
            this.sidebar.classList.toggle('show');
            this.container.classList.toggle('sidebar-open');
        }
        
        // 햄버거 메뉴 애니메이션
        this.menuToggle.classList.toggle('active');
    }
    
    closeSidebar() {
        const isMobile = window.innerWidth <= 768;
        
        if (isMobile) {
            this.sidebar.classList.remove('show');
            this.mobileOverlay.classList.remove('show');
        } else {
            this.sidebar.classList.remove('show');
            this.container.classList.remove('sidebar-open');
        }
        
        this.menuToggle.classList.remove('active');
    }
    
    selectMenuItem(selectedItem) {
        // 모든 메뉴 항목에서 active 클래스 제거
        this.menuItems.forEach(item => {
            item.classList.remove('active');
        });
        
        // 선택된 항목에 active 클래스 추가
        selectedItem.classList.add('active');
        
        // 메뉴 타입에 따른 처리
        const menuType = selectedItem.dataset.menu;
        this.currentMenuType = menuType;
        
        // switchMenu 메서드를 사용하여 일관성 있게 처리
        this.switchMenu(menuType);
        
        // 모바일에서는 메뉴 선택 후 사이드바 닫기
        if (window.innerWidth <= 768) {
            this.closeSidebar();
        }
    }
    
    showAddButton() {
        if (this.addPcBtn) {
            this.addPcBtn.style.display = 'block';
        }
    }
    
    hideAddButton() {
        if (this.addPcBtn) {
            this.addPcBtn.style.display = 'none';
        }
    }
    
    // VM과 PC 메뉴 전환
    switchMenu(menuType) {
        this.currentMenuType = menuType;
        
        // 그리드 표시/숨김 및 모니터링 최적화
        if (menuType === 'pc') {
            this.pcGrid.style.display = 'grid';
            this.vmGrid.style.display = 'none';
            this.addPcBtn.style.display = 'block';
            this.addVmBtn.style.display = 'none';
            
            // PC 탭 활성화 시: PC 상태만 업데이트
            this.enablePCMonitoring();
            this.disableVMMonitoring();
            
        } else if (menuType === 'vm') {
            this.pcGrid.style.display = 'none';
            this.vmGrid.style.display = 'grid';
            this.addPcBtn.style.display = 'none';
            this.addVmBtn.style.display = 'block';
            
            // VM 탭 활성화 시: VM 상태만 업데이트
            this.enableVMMonitoring();
            this.disablePCMonitoring();
            this.loadVMs();
        }
        
        // 서버에 탭 변경 알림
        this.notifyTabChange(menuType);
        
        // 메뉴 항목 활성화 표시
        this.menuItems.forEach(item => {
            item.classList.remove('active');
            if (item.dataset.menu === menuType) {
                item.classList.add('active');
            }
        });
    }
    
    // 전체 새로고침 (PC와 VM 모두)
    async refreshAll() {
        if (this.currentMenuType === 'pc') {
            await this.refreshAllPCs();
        } else if (this.currentMenuType === 'vm') {
            await this.refreshAllVMs();
        }
    }
    
    // VM 관련 메서드들
    async loadVMs() {
        try {
            const response = await fetch('/api/vms');
            const data = await response.json();
            
            this.vms.clear();
            data.vms.forEach(vm => {
                this.vms.set(vm.id, vm);
            });
            
            // VM 상태도 로드
            await this.loadVMStatuses();
            
            this.renderVMGrid();
        } catch (error) {
            console.error('VM 목록 로드 실패:', error);
            this.showNotification('VM 목록을 불러오는데 실패했습니다.', 'error');
        }
    }
    
    async loadVMStatuses() {
        try {
            const response = await fetch('/api/vms/status');
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            this.vmStatuses.clear();
            data.vm_statuses.forEach(status => {
                this.vmStatuses.set(status.vm_id, status);
            });
        } catch (error) {
            console.error('VM 상태 로드 실패:', error);
        }
    }
    
    renderVMGrid() {
        if (this.vms.size === 0) {
            this.renderEmptyVMState();
            return;
        }
        
        const vmCards = Array.from(this.vms.values()).map(vm => this.createVMCard(vm));
        this.vmGrid.innerHTML = vmCards.join('');
    }
    
    renderEmptyVMState() {
        this.vmGrid.innerHTML = `
            <div class="empty-state">
                <h3>등록된 VM이 없습니다</h3>
                <p>VM 추가 버튼을 클릭하여 첫 번째 VM을 등록하세요.</p>
                <button class="btn btn-primary" onclick="app.openAddVmModal()">VM 추가</button>
            </div>
        `;
    }
    
    createVMCard(vm) {
        const statusClass = this.getVMStatusClass(vm.id);
        const statusText = this.getVMStatusText(vm.id);
        const isRunning = statusText === 'running';
        
        
        return `
            <div class="vm-card" data-vm-id="${vm.id}">
                <div class="vm-card-header">
                    <div class="vm-card-title">
                        <div class="vm-status-dot ${statusClass}"></div>
                        <div>
                            <div class="vm-name">${vm.name}</div>
                            ${vm.description ? `<div class="vm-description">${vm.description}</div>` : ''}
                        </div>
                    </div>
                    <div class="vm-card-actions">
                        <button class="icon-btn" onclick="app.editVM('${vm.id}')" title="편집">
                            <img src="/static/resources/edit.svg" alt="Edit" class="action-icon">
                        </button>
                        <button class="icon-btn" onclick="app.showDeleteVMConfirmation('${vm.id}')" title="삭제">
                            <img src="/static/resources/trash.svg" alt="Delete" class="action-icon">
                        </button>
                    </div>
                </div>
                <div class="vm-card-body">
                    <div class="vm-info">
                        <div class="vm-info-item">
                            <span class="vm-info-label">타입</span>
                            <span class="vm-info-value">${vm.vm_type.toUpperCase()}</span>
                        </div>
                        <div class="vm-info-item">
                            <span class="vm-info-label">VM ID</span>
                            <span class="vm-info-value">${vm.vm_id}</span>
                        </div>
                        <div class="vm-info-item">
                            <span class="vm-info-label">노드</span>
                            <span class="vm-info-value">${vm.node_name}</span>
                        </div>
                        <div class="vm-info-item">
                            <span class="vm-info-label">상태</span>
                            <span class="vm-info-value vm-status-text">${statusText}</span>
                        </div>
                    </div>
                    <button class="vm-control-button ${isRunning ? 'down' : 'up'}" 
                            onclick="app.toggleVM('${vm.id}', ${isRunning})"
                            data-vm-id="${vm.id}">
                        ${isRunning ? 'DOWN' : 'UP'}
                    </button>
                </div>
            </div>
        `;
    }
    
    getVMStatusClass(vmId) {
        // VM 상태에 따른 CSS 클래스 반환
        const status = this.getVMStatusText(vmId);
        switch (status) {
            case 'running': return 'running';
            case 'stopped': return 'stopped';
            case 'starting': return 'starting';
            default: return 'stopped';
        }
    }
    
    getVMStatusText(vmId) {
        const status = this.vmStatuses.get(vmId);
        return status ? status.status : 'unknown';
    }
    
    async toggleVM(vmId, isRunning) {
        try {
            const action = isRunning ? 'stop' : 'start';
            const response = await fetch(`/api/vms/${vmId}/${action}`, {
                method: 'POST'
            });
            
            if (response.ok) {
                const data = await response.json();
                this.showNotification(`VM ${action} 요청이 전송되었습니다.`, 'success');
                
                // 작업 상태 추적
                if (data.task_id) {
                    this.trackVMTask(data.task_id, vmId, action);
                }
            } else {
                throw new Error(`VM ${action} 실패`);
            }
        } catch (error) {
            console.error(`VM ${isRunning ? 'stop' : 'start'} 실패:`, error);
            this.showNotification(`VM ${isRunning ? '정지' : '시작'}에 실패했습니다.`, 'error');
        }
    }
    
    async trackVMTask(taskId, vmId, action) {
        const checkInterval = setInterval(async () => {
            try {
                const response = await fetch(`/api/vm-tasks/${taskId}`);
                if (response.ok) {
                    const task = await response.json();
                    
                    if (task.status === 'completed') {
                        clearInterval(checkInterval);
                        this.showNotification(`VM ${action} 완료`, 'success');
                        this.refreshVMStatus(vmId);
                    } else if (task.status === 'failed') {
                        clearInterval(checkInterval);
                        this.showNotification(`VM ${action} 실패: ${task.message}`, 'error');
                        this.refreshVMStatus(vmId);
                    }
                }
            } catch (error) {
                console.error('VM 작업 상태 확인 실패:', error);
            }
        }, 2000);
    }
    
    async refreshVMStatus(vmId) {
        try {
            const response = await fetch(`/api/vms/${vmId}/status`);
            if (response.ok) {
                const status = await response.json();
                this.updateVMCardStatus(vmId, status);
            }
        } catch (error) {
            console.error('VM 상태 업데이트 실패:', error);
        }
    }
    
    updateVMCardStatus(vmId, status) {
        // 내부 상태 업데이트
        this.vmStatuses.set(vmId, status);
        
        const vmCard = document.querySelector(`[data-vm-id="${vmId}"]`);
        if (vmCard) {
            const statusDot = vmCard.querySelector('.vm-status-dot');
            const statusText = vmCard.querySelector('.vm-status-text');
            const controlButton = vmCard.querySelector('.vm-control-button');
            
            // 상태 도트 업데이트
            statusDot.className = `vm-status-dot ${this.getVMStatusClassFromStatus(status.status)}`;
            
            // 상태 텍스트 업데이트 (올바른 요소 선택)
            if (statusText) {
                statusText.textContent = status.status;
            } else {
                console.error(`VM ${vmId} 상태 텍스트 요소를 찾을 수 없음`);
            }
            
            // 컨트롤 버튼 업데이트
            const isRunning = status.status === 'running';
            controlButton.className = `vm-control-button ${isRunning ? 'down' : 'up'}`;
            controlButton.textContent = isRunning ? 'DOWN' : 'UP';
            controlButton.onclick = () => this.toggleVM(vmId, isRunning);
        }
    }
    
    getVMStatusClassFromStatus(status) {
        switch (status) {
            case 'running': return 'running';
            case 'stopped': return 'stopped';
            case 'starting': return 'starting';
            default: return 'stopped';
        }
    }
    
    async refreshAllVMs() {
        try {
            this.showNotification('VM 상태를 새로고침 중...', 'info');
            
            // VM 목록과 상태를 모두 새로고침
            await this.loadVMs();
            
            this.showNotification('VM 상태가 업데이트되었습니다.', 'success');
        } catch (error) {
            console.error('VM 새로고침 실패:', error);
            this.showNotification('VM 새로고침에 실패했습니다.', 'error');
        }
    }
    
    // VM 모달 관련 메서드들
    openAddVmModal() {
        this.vmModalTitle.textContent = 'VM 추가';
        this.vmForm.reset();
        this.currentEditingVmId = null;
        this.vmModal.classList.add('show');
    }
    
    editVM(vmId) {
        const vm = this.vms.get(vmId);
        if (!vm) return;
        
        this.vmModalTitle.textContent = 'VM 편집';
        this.currentEditingVmId = vmId;
        
        // 폼 필드 채우기
        document.getElementById('vmName').value = vm.name;
        document.getElementById('vmDescription').value = vm.description || '';
        document.getElementById('vmType').value = vm.vm_type;
        document.getElementById('vmId').value = vm.vm_id;
        document.getElementById('nodeName').value = vm.node_name;
        document.getElementById('nodeAddress').value = vm.node_address;
        document.getElementById('apiToken').value = vm.api_token;
        
        this.vmModal.classList.add('show');
    }
    
    closeVmModal() {
        this.vmModal.classList.remove('show');
        this.currentEditingVmId = null;
    }
    
    async handleVmSubmit(e) {
        e.preventDefault();
        
        const formData = new FormData(this.vmForm);
        const vmData = {
            id: this.currentEditingVmId || `vm-${Date.now()}`,
            name: formData.get('name'),
            description: formData.get('description'),
            vm_type: formData.get('vm_type'),
            vm_id: parseInt(formData.get('vm_id')),
            node_name: formData.get('node_name'),
            node_address: formData.get('node_address'),
            api_token: formData.get('api_token')
        };
        
        try {
            let response;
            if (this.currentEditingVmId) {
                // VM 수정
                response = await fetch(`/api/vms/${this.currentEditingVmId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(vmData)
                });
            } else {
                // VM 추가
                response = await fetch('/api/vms', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(vmData)
                });
            }
            
            if (response.ok) {
                this.showNotification(
                    this.currentEditingVmId ? 'VM이 수정되었습니다.' : 'VM이 추가되었습니다.',
                    'success'
                );
                this.closeVmModal();
                await this.loadVMs();
            } else {
                const error = await response.json();
                throw new Error(error.detail || 'VM 저장 실패');
            }
        } catch (error) {
            console.error('VM 저장 실패:', error);
            this.showNotification(error.message || 'VM 저장에 실패했습니다.', 'error');
        }
    }
    
    showDeleteVMConfirmation(vmId) {
        const vm = this.vms.get(vmId);
        if (!vm) return;
        
        this.deleteVmName.textContent = vm.name;
        this.currentDeletingVmId = vmId;
        this.deleteVmModal.classList.add('show');
    }
    
    closeDeleteVmModal() {
        this.deleteVmModal.classList.remove('show');
        this.currentDeletingVmId = null;
    }
    
    async confirmDeleteVm() {
        if (!this.currentDeletingVmId) return;
        
        try {
            const response = await fetch(`/api/vms/${this.currentDeletingVmId}`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                this.showNotification('VM이 삭제되었습니다.', 'success');
                this.closeDeleteVmModal();
                await this.loadVMs();
            } else {
                throw new Error('VM 삭제 실패');
            }
        } catch (error) {
            console.error('VM 삭제 실패:', error);
            this.showNotification('VM 삭제에 실패했습니다.', 'error');
        }
    }
    
    // 창 크기 변경 시 사이드바 상태 조정
    handleResize() {
        const isMobile = window.innerWidth <= 768;
        
        if (isMobile) {
            // 모바일로 전환 시 사이드바와 컨테이너 상태 초기화
            this.sidebar.classList.remove('show');
            this.mobileOverlay.classList.remove('show');
            this.menuToggle.classList.remove('active');
            this.container.classList.remove('sidebar-open');
        } else {
            // 데스크톱으로 전환 시 오버레이 제거
            this.mobileOverlay.classList.remove('show');
        }
    }
    
    // 모니터링 제어 메서드들
    enablePCMonitoring() {
        this.pcMonitoringEnabled = true;
    }
    
    disablePCMonitoring() {
        this.pcMonitoringEnabled = false;
    }
    
    enableVMMonitoring() {
        this.vmMonitoringEnabled = true;
    }
    
    disableVMMonitoring() {
        this.vmMonitoringEnabled = false;
    }
    
    // 서버에 탭 변경 알림
    notifyTabChange(tabType) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const message = {
                type: "tab_change",
                data: {
                    tab: tabType
                }
            };
            this.ws.send(JSON.stringify(message));
        }
    }
}

// 전역 인스턴스
let app;

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', () => {
    app = new MultiPCController();
});

// 슬라이드아웃 애니메이션 추가
const style = document.createElement('style');
style.textContent = `
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
    
    @media (max-width: 768px) {
        @keyframes slideOut {
            from {
                transform: translateY(0);
                opacity: 1;
            }
            to {
                transform: translateY(-100%);
                opacity: 0;
            }
        }
    }
`;
document.head.appendChild(style);
