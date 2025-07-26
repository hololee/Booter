class MultiPCController {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectInterval = 1000;
        this.pcs = new Map();
        this.bootingPCs = new Map(); // 부팅 중인 PC들과 정보 추적 {pcId: {startTime, targetOS}}
        this.bootTimeoutDuration = 3 * 60 * 1000; // 3분 (밀리초)
        this.isEditing = false;
        
        // localStorage에서 부팅 상태 복원
        this.loadBootingStatusFromStorage();
        this.currentEditingPcId = null;
        
        // 현재 선택된 메뉴 타입 (pc 또는 vm)
        this.currentMenuType = 'pc';
        
        this.initializeElements();
        this.attachEventListeners();
        this.connectWebSocket();
        
        // 초기 상태 설정 (PC 메뉴가 기본 선택)
        this.showAddButton();
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
        this.refreshAllBtn = document.getElementById('refreshAllBtn');
        
        // PC 그리드
        this.pcGrid = document.getElementById('pcGrid');
        
        
        // 모달 요소들
        this.pcModal = document.getElementById('pcModal');
        this.pcForm = document.getElementById('pcForm');
        this.modalTitle = document.getElementById('modalTitle');
        this.closeModalBtn = document.getElementById('closeModalBtn');
        this.cancelBtn = document.getElementById('cancelBtn');
        this.saveBtn = document.getElementById('saveBtn');
        
        // 삭제 모달
        this.deleteModal = document.getElementById('deleteModal');
        this.deletePcName = document.getElementById('deletePcName');
        this.closeDeleteModalBtn = document.getElementById('closeDeleteModalBtn');
        this.cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
        this.confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
        
        // 취소 확인 모달
        this.cancelModal = document.getElementById('cancelModal');
        this.closeCancelModalBtn = document.getElementById('closeCancelModalBtn');
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
        this.refreshAllBtn.addEventListener('click', () => this.refreshAllPCs());
        
        // 모달 이벤트
        this.closeModalBtn.addEventListener('click', () => this.showCancelConfirmation());
        this.cancelBtn.addEventListener('click', () => this.showCancelConfirmation());
        this.pcForm.addEventListener('submit', (e) => this.handlePcSubmit(e));
        
        // 삭제 모달 이벤트
        this.closeDeleteModalBtn.addEventListener('click', () => this.closeDeleteModal());
        this.cancelDeleteBtn.addEventListener('click', () => this.closeDeleteModal());
        this.confirmDeleteBtn.addEventListener('click', () => this.confirmDeletePc());
        
        // 취소 확인 모달 이벤트
        this.closeCancelModalBtn.addEventListener('click', () => this.closeCancelModal());
        this.keepEditingBtn.addEventListener('click', () => this.closeCancelModal());
        this.confirmCancelBtn.addEventListener('click', () => this.confirmCancel());
        
        
        // SSH 비밀번호 토글 이벤트
        document.getElementById('sshPasswordToggle').addEventListener('click', () => this.togglePasswordVisibility());
        
        // 모달 배경 클릭 시 닫기 비활성화 (PC 모달만)
        this.deleteModal.addEventListener('click', (e) => {
            if (e.target === this.deleteModal) this.closeDeleteModal();
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
            const wsUrl = `${protocol}//${window.location.host}/ws`;
            
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
        try {
            // vm_data.json 파일을 직접 요청
            const response = await fetch('/static/vm_data.json');
            
            if (!response.ok) {
                throw new Error('VM 데이터 파일을 찾을 수 없습니다');
            }
            
            const data = await response.json();
            
            this.pcs.clear();
            if (Array.isArray(data) && data.length > 0) {
                data.forEach(vm => {
                    this.pcs.set(vm.id, vm);
                });
                this.renderPCGrid();
            } else {
                this.renderEmptyVMState();
            }
            
        } catch (error) {
            console.error('VM 목록 로드 실패:', error);
            this.renderEmptyVMState();
        }
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
                
                // 부팅 중일 때 버튼 비활성화
                const ubuntuBtn = document.getElementById(`ubuntu-btn-${pc.id}`);
                const windowsBtn = document.getElementById(`windows-btn-${pc.id}`);
                if (ubuntuBtn && windowsBtn) {
                    ubuntuBtn.disabled = true;
                    windowsBtn.disabled = true;
                }
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
        card.className = 'pc-card';
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
                    <button class="boot-btn ubuntu-btn" id="ubuntu-btn-${pc.id}" onclick="app.bootUbuntu('${pc.id}')">
                        Ubuntu
                    </button>
                    <button class="boot-btn windows-btn" id="windows-btn-${pc.id}" onclick="app.bootWindows('${pc.id}')">
                        Windows
                    </button>
                </div>
            </div>
        `;
        
        return card;
    }
    
    updateAllStatus(data) {
        if (data.pc_statuses) {
            Object.entries(data.pc_statuses).forEach(([pcId, status]) => {
                this.updatePCStatus(pcId, status);
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
                // 부팅 중에는 모든 버튼 비활성화
                ubuntuBtn.disabled = true;
                windowsBtn.disabled = true;
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
        
        // 버튼 상태 업데이트 (현재 상태에 따라서만)
        ubuntuBtn.disabled = status.state === 'ubuntu' || status.state === 'windows';
        windowsBtn.disabled = status.state === 'windows';
    }
    
    
    // PC 관리 메서드들
    openAddPcModal() {
        this.isEditing = false;
        this.currentEditingPcId = null;
        this.modalTitle.textContent = 'PC 추가';
        this.pcForm.reset();
        this.pcModal.classList.add('show');
    }
    
    openEditPcModal(pcId) {
        const pc = this.pcs.get(pcId);
        if (!pc) return;
        
        this.isEditing = true;
        this.currentEditingPcId = pcId;
        this.modalTitle.textContent = 'PC 편집';
        
        // 폼에 데이터 채우기
        document.getElementById('pcName').value = pc.name;
        document.getElementById('macAddress').value = pc.mac_address;
        document.getElementById('ipAddress').value = pc.ip_address;
        document.getElementById('sshUser').value = pc.ssh_user;
        document.getElementById('sshPort').value = pc.ssh_port;
        document.getElementById('rdpPort').value = pc.rdp_port;
        document.getElementById('bootCommand').value = pc.boot_command;
        document.getElementById('description').value = pc.description || '';
        document.getElementById('isActive').checked = pc.is_active;
        
        // SSH 설정
        document.getElementById('sshPassword').value = pc.ssh_password || '';
        document.getElementById('sshKeyText').value = pc.ssh_key_text || '';
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
        
        const pcData = {
            id: pcId,
            name: pcName,
            mac_address: formData.get('mac_address'),
            ip_address: formData.get('ip_address'),
            ssh_user: formData.get('ssh_user'),
            ssh_password: formData.get('ssh_password'),
            ssh_key_text: formData.get('ssh_key_text'),
            ssh_auth_method: formData.get('ssh_key_text') ? 'key' : 'password', // 키가 있으면 key, 없으면 password
            ssh_port: parseInt(formData.get('ssh_port')),
            rdp_port: parseInt(formData.get('rdp_port')),
            boot_command: formData.get('boot_command'),
            description: formData.get('description'),
            is_active: formData.get('is_active') === 'on'
        };
        
        // SSH 비밀번호는 항상 필수
        if (!pcData.ssh_password) {
            this.showNotification('SSH 비밀번호를 입력해주세요', 'error');
            return;
        }
        
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
                    ubuntuBtn.disabled = true;
                    windowsBtn.disabled = false;
                } else if (data.target_os === 'Windows') {
                    ubuntuBtn.disabled = false;
                    windowsBtn.disabled = true;
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
    
    togglePasswordVisibility() {
        const passwordInput = document.getElementById('sshPassword');
        const toggleBtn = document.getElementById('sshPasswordToggle');
        const eyeIcon = toggleBtn.querySelector('.eye-icon');
        
        if (passwordInput.type === 'password') {
            passwordInput.type = 'text';
            eyeIcon.textContent = '👁‍🗨'; // 닫힌 눈 아이콘
        } else {
            passwordInput.type = 'password';
            eyeIcon.textContent = '👁'; // 열린 눈 아이콘
        }
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
        
        if (menuType === 'pc') {
            // PC 메뉴 선택 시 PC 목록 표시 및 추가 버튼 보이기
            this.showAddButton();
            this.loadPCs();
        } else if (menuType === 'vm') {
            // VM 메뉴 선택 시 VM 목록 표시 및 추가 버튼 숨기기
            this.hideAddButton();
            this.loadVMs();
        }
        
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
