/**
 * PC 관련 기능 관리 (부팅, 상태 관리, 모달 등)
 */
class PCManager {
    constructor(uiManager) {
        this.uiManager = uiManager;
        this.pcs = new Map();
        this.bootingPCs = new Map(); // 부팅 중인 PC들과 정보 추적 {pcId: {startTime, targetOS}}
        this.shuttingDownPCs = new Set(); // 종료 중인 PC 추적
        this.bootTimeoutDuration = 3 * 60 * 1000; // 3분 (밀리초)
        this.shutdownTimeoutDuration = 3 * 60 * 1000; // 3분 (밀리초)
        this.currentEditingPcId = null;
        
        // PC 관련 DOM 요소들
        this.pcGrid = null;
        this.addPcBtn = null;
        this.pcModal = null;
        this.pcForm = null;
        this.modalTitle = null;
        this.deleteModal = null;
        this.deletePcName = null;
        this.cancelModal = null;
        
        this.initializeElements();
        this.attachEventListeners();
        this.loadBootingStatusFromStorage();
    }
    
    initializeElements() {
        this.pcGrid = document.getElementById('pcGrid');
        this.addPcBtn = document.getElementById('addPcBtn');
        
        // PC 모달 요소들
        this.pcModal = document.getElementById('pcModal');
        this.pcForm = document.getElementById('pcForm');
        this.modalTitle = document.getElementById('modalTitle');
        this.cancelBtn = document.getElementById('cancelBtn');
        this.saveBtn = document.getElementById('saveBtn');
        
        // 삭제 모달
        this.deleteModal = document.getElementById('deleteModal');
        this.deletePcName = document.getElementById('deletePcName');
        this.cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
        this.confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
        
        // 취소 확인 모달
        this.cancelModal = document.getElementById('cancelModal');
        this.keepEditingBtn = document.getElementById('keepEditingBtn');
        this.confirmCancelBtn = document.getElementById('confirmCancelBtn');
    }
    
    attachEventListeners() {
        // PC 추가 버튼
        if (this.addPcBtn) {
            this.addPcBtn.addEventListener('click', () => this.openAddModal());
        }
        
        // PC 모달 이벤트
        if (this.cancelBtn) {
            this.cancelBtn.addEventListener('click', () => this.handleCancelClick());
        }
        
        if (this.saveBtn) {
            this.saveBtn.addEventListener('click', () => this.savePC());
        }
        
        if (this.pcForm) {
            this.pcForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.savePC();
            });
        }
        
        // 삭제 모달 이벤트
        if (this.cancelDeleteBtn) {
            this.cancelDeleteBtn.addEventListener('click', () => this.uiManager.hideModal(this.deleteModal));
        }
        
        if (this.confirmDeleteBtn) {
            this.confirmDeleteBtn.addEventListener('click', () => this.confirmDelete());
        }
        
        // 취소 확인 모달 이벤트
        if (this.keepEditingBtn) {
            this.keepEditingBtn.addEventListener('click', () => this.uiManager.hideModal(this.cancelModal));
        }
        
        if (this.confirmCancelBtn) {
            this.confirmCancelBtn.addEventListener('click', () => this.confirmCancel());
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
            
            this.renderPCs();
            
        } catch (error) {
            console.error('PC 목록 로드 실패:', error);
            this.uiManager.showNotification('PC 목록을 불러오는데 실패했습니다.', 'error');
        }
    }
    
    renderPCs() {
        if (this.pcs.size === 0) {
            this.renderEmptyState();
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
    
    renderEmptyState() {
        this.pcGrid.innerHTML = `
            <div class="empty-state">
                <h3>등록된 PC가 없습니다</h3>
                <p>PC 추가 버튼을 클릭하여 첫 번째 PC를 등록하세요.</p>
                <button class="btn btn-primary" onclick="app.pcManager.openAddModal()">PC 추가</button>
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
    
    updatePCStatus(pcId, status) {
        const statusDot = document.getElementById(`status-dot-${pcId}`);
        const statusText = document.getElementById(`status-text-${pcId}`);
        const lastCheck = document.getElementById(`last-check-${pcId}`);
        const ubuntuBtn = document.getElementById(`ubuntu-btn-${pcId}`);
        const windowsBtn = document.getElementById(`windows-btn-${pcId}`);
        
        if (!statusDot || !statusText || !lastCheck || !ubuntuBtn || !windowsBtn) {
            return;
        }
        
        // 부팅 중인 PC는 상태 업데이트 무시
        if (this.bootingPCs.has(pcId)) {
            const bootInfo = this.bootingPCs.get(pcId);
            if (Date.now() - bootInfo.startTime < this.bootTimeoutDuration) {
                if (status.state === 'ubuntu' || status.state === 'windows') {
                    this.removeBootingPC(pcId);
                } else {
                    return; // 부팅 중 상태 유지
                }
            } else {
                this.removeBootingPC(pcId); // 타임아웃
            }
        }

        // 종료 중인 PC는 상태 업데이트 무시
        if (this.shuttingDownPCs.has(pcId)) {
            if (status.state === 'off') {
                this.removeShuttingDownPC(pcId);
            } else {
                return; // 종료 중 상태 유지
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
        
        // 버튼 상태 업데이트
        this.updateButtonsForState(status.state, ubuntuBtn, windowsBtn);
    }
    
    // 유틸리티 메서드들
    getStateDisplayName(state) {
        const stateNames = {
            'ubuntu': 'Ubuntu 동작중',
            'windows': 'Windows 동작중',
            'off': '꺼짐',
            'booting': '부팅 중',
            'shutting-down': '종료 중',
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
    
    // 부팅 상태 관련 메서드들
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
                return `${osName} ${stage}`;
        }
    }
    
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
                // Ubuntu 실행 중: Ubuntu DOWN, Windows UP
                ubuntuBtn.disabled = false;
                windowsBtn.disabled = false;
                ubuntuBtn.textContent = 'ubuntu DOWN';
                windowsBtn.textContent = 'windows UP';
                break;
            case 'windows':
                // Windows 실행 중: Ubuntu UP, Windows DOWN
                ubuntuBtn.disabled = false;
                windowsBtn.disabled = false;
                ubuntuBtn.textContent = 'ubuntu UP';
                windowsBtn.textContent = 'windows DOWN';
                break;
            case 'booting':
                // 부팅 중: 두 버튼 비활성화
                ubuntuBtn.disabled = true;
                windowsBtn.disabled = true;
                ubuntuBtn.textContent = '부팅 중...';
                windowsBtn.textContent = '부팅 중...';
                break;
            case 'shutting-down':
                // 종료 중: 두 버튼 비활성화
                ubuntuBtn.disabled = true;
                windowsBtn.disabled = true;
                ubuntuBtn.textContent = '종료 중...';
                windowsBtn.textContent = '종료 중...';
                break;
            default:
                // 기본값
                ubuntuBtn.disabled = false;
                windowsBtn.disabled = false;
                ubuntuBtn.textContent = 'ubuntu UP';
                windowsBtn.textContent = 'windows UP';
        }
    }
    
    // PC 부팅 관련 메서드들
    async bootUbuntu(pcId) {
        try {
            // 부팅 상태 UI 먼저 업데이트
            this.setBootingState(pcId, 'Ubuntu');
            this.updatePCBootStatus(pcId, this.getBootingStatusText('Ubuntu', 'requesting'), 'booting');
            
            const response = await fetch(`/api/pcs/${pcId}/boot/ubuntu`, {
                method: 'POST'
            });
            
            const result = await response.json();
            
            if (response.ok) {
                this.uiManager.showNotification(`Ubuntu 부팅을 시작했습니다`, 'success');
            } else {
                this.uiManager.showNotification(result.detail || 'Ubuntu 부팅 요청 실패', 'error');
                // 실패 시 부팅 상태 해제
                this.removeBootingPC(pcId);
            }
            
        } catch (error) {
            console.error('Ubuntu 부팅 오류:', error);
            this.uiManager.showNotification('Ubuntu 부팅 요청 중 오류가 발생했습니다', 'error');
            this.removeBootingPC(pcId);
        }
    }
    
    async bootWindows(pcId) {
        try {
            // 부팅 상태 UI 먼저 업데이트
            this.setBootingState(pcId, 'Windows');
            this.updatePCBootStatus(pcId, this.getBootingStatusText('Windows', 'requesting'), 'booting');
            
            const response = await fetch(`/api/pcs/${pcId}/boot/windows`, {
                method: 'POST'
            });
            
            const result = await response.json();
            
            if (response.ok) {
                this.uiManager.showNotification(`Windows 부팅을 시작했습니다`, 'success');
            } else {
                this.uiManager.showNotification(result.detail || 'Windows 부팅 요청 실패', 'error');
                // 실패 시 부팅 상태 해제
                this.removeBootingPC(pcId);
            }
            
        } catch (error) {
            console.error('Windows 부팅 오류:', error);
            this.uiManager.showNotification('Windows 부팅 요청 중 오류가 발생했습니다', 'error');
            this.removeBootingPC(pcId);
        }
    }
    
    setBootingState(pcId, targetOS) {
        this.bootingPCs.set(pcId, {
            startTime: Date.now(),
            targetOS: targetOS
        });
        this.saveBootingStatusToStorage();
        
        // 3분 후 자동으로 부팅 상태 해제
        setTimeout(() => {
            if (this.bootingPCs.has(pcId)) {
                console.log(`PC ${pcId} 부팅 타임아웃: 3분 경과로 부팅 상태 해제`);
                this.removeBootingPC(pcId);
            }
        }, this.bootTimeoutDuration);
    }
    
    removeBootingPC(pcId) {
        this.bootingPCs.delete(pcId);
        this.saveBootingStatusToStorage();
    }

    setShuttingDownState(pcId) {
        this.shuttingDownPCs.add(pcId);
        this.updatePCBootStatus(pcId, '종료 중...', 'shutting-down');
        const ubuntuBtn = document.getElementById(`ubuntu-btn-${pcId}`);
        const windowsBtn = document.getElementById(`windows-btn-${pcId}`);
        this.updateButtonsForState('shutting-down', ubuntuBtn, windowsBtn);

        setTimeout(() => {
            if (this.shuttingDownPCs.has(pcId)) {
                this.removeShuttingDownPC(pcId);
            }
        }, this.shutdownTimeoutDuration);
    }

    removeShuttingDownPC(pcId) {
        this.shuttingDownPCs.delete(pcId);
    }
    
    clearBootingState(pcId) {
        // 호환성을 위해 removeBootingPC 호출
        this.removeBootingPC(pcId);
    }
    
    saveBootingStatusToStorage() {
        try {
            const bootingStatus = {};
            this.bootingPCs.forEach((bootInfo, pcId) => {
                bootingStatus[pcId] = bootInfo;
            });
            localStorage.setItem('bootingStatus', JSON.stringify(bootingStatus));
        } catch (error) {
            console.error('부팅 상태 저장 실패:', error);
        }
    }
    
    loadBootingStatusFromStorage() {
        try {
            const stored = localStorage.getItem('bootingStatus');
            if (stored) {
                const bootingStatus = JSON.parse(stored);
                const currentTime = Date.now();
                
                Object.entries(bootingStatus).forEach(([pcId, bootInfo]) => {
                    // 3분 이내의 부팅 상태만 복원
                    if (currentTime - bootInfo.startTime < this.bootTimeoutDuration) {
                        this.bootingPCs.set(pcId, bootInfo);
                        console.log(`PC ${pcId} ${bootInfo.targetOS} 부팅 상태 복원`);
                    }
                });
            }
        } catch (error) {
            console.error('부팅 상태 복원 실패:', error);
        }
    }
    
    // PC 모달 관련 메서드들
    openAddModal() {
        this.currentEditingPcId = null;
        this.modalTitle.textContent = 'PC 추가';
        this.pcForm.reset();
        this.uiManager.showModal(this.pcModal);
        document.getElementById('name').focus();
    }
    
    editPC(pcId) {
        const pc = this.pcs.get(pcId);
        if (!pc) return;
        
        this.currentEditingPcId = pcId;
        this.modalTitle.textContent = 'PC 편집';
        
        // 폼에 PC 정보 채우기
        document.getElementById('name').value = pc.name;
        document.getElementById('description').value = pc.description || '';
        document.getElementById('mac_address').value = pc.mac_address;
        document.getElementById('ip_address').value = pc.ip_address;
        document.getElementById('ssh_user').value = pc.ssh_user;
        document.getElementById('ssh_key_path').value = pc.ssh_key_path || '';
        document.getElementById('ssh_port').value = pc.ssh_port || 22;
        document.getElementById('rdp_port').value = pc.rdp_port || 3389;
        document.getElementById('boot_command').value = pc.boot_command || 'bootWin';
        document.getElementById('is_active').checked = pc.is_active !== false;
        
        this.uiManager.showModal(this.pcModal);
        document.getElementById('name').focus();
    }
    
    handleCancelClick() {
        if (this.isFormDirty()) {
            this.uiManager.showModal(this.cancelModal);
        } else {
            this.closePcModal();
        }
    }
    
    isFormDirty() {
        const formData = new FormData(this.pcForm);
        
        if (!this.currentEditingPcId) {
            // 새 PC 추가 시 - 하나라도 입력되어 있으면 dirty
            for (let [key, value] of formData.entries()) {
                if (key !== 'is_active' && value.trim()) {
                    return true;
                }
            }
            return false;
        } else {
            // PC 편집 시 - 원본과 다르면 dirty
            const pc = this.pcs.get(this.currentEditingPcId);
            if (!pc) return false;
            
            const currentValues = {
                name: formData.get('name').trim(),
                description: formData.get('description').trim(),
                mac_address: formData.get('mac_address').trim(),
                ip_address: formData.get('ip_address').trim(),
                ssh_user: formData.get('ssh_user').trim(),
                ssh_key_path: formData.get('ssh_key_path').trim(),
                ssh_port: parseInt(formData.get('ssh_port')) || 22,
                rdp_port: parseInt(formData.get('rdp_port')) || 3389,
                boot_command: formData.get('boot_command').trim(),
                is_active: formData.has('is_active')
            };
            
            return (
                currentValues.name !== pc.name ||
                currentValues.description !== (pc.description || '') ||
                currentValues.mac_address !== pc.mac_address ||
                currentValues.ip_address !== pc.ip_address ||
                currentValues.ssh_user !== pc.ssh_user ||
                currentValues.ssh_key_path !== (pc.ssh_key_path || '') ||
                currentValues.ssh_port !== (pc.ssh_port || 22) ||
                currentValues.rdp_port !== (pc.rdp_port || 3389) ||
                currentValues.boot_command !== (pc.boot_command || 'bootWin') ||
                currentValues.is_active !== (pc.is_active !== false)
            );
        }
    }
    
    confirmCancel() {
        this.uiManager.hideModal(this.cancelModal);
        this.closePcModal();
    }
    
    closePcModal() {
        this.uiManager.hideModal(this.pcModal);
        this.currentEditingPcId = null;
    }
    
    async savePC() {
        if (!this.validateForm()) return;
        
        const formData = new FormData(this.pcForm);
        const pcData = {
            name: formData.get('name').trim(),
            description: formData.get('description').trim() || null,
            mac_address: formData.get('mac_address').trim(),
            ip_address: formData.get('ip_address').trim(),
            ssh_user: formData.get('ssh_user').trim(),
            ssh_key_path: formData.get('ssh_key_path').trim() || null,
            ssh_port: parseInt(formData.get('ssh_port')) || 22,
            rdp_port: parseInt(formData.get('rdp_port')) || 3389,
            boot_command: formData.get('boot_command').trim() || 'bootWin',
            is_active: formData.has('is_active')
        };
        
        if (this.currentEditingPcId) {
            pcData.id = this.currentEditingPcId;
        }
        
        try {
            const url = this.currentEditingPcId ? `/api/pcs/${this.currentEditingPcId}` : '/api/pcs';
            const method = this.currentEditingPcId ? 'PUT' : 'POST';
            
            const response = await fetch(url, {
                method: method,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(pcData)
            });
            
            const result = await response.json();
            
            if (response.ok) {
                this.uiManager.showNotification(
                    this.currentEditingPcId ? 'PC가 성공적으로 수정되었습니다.' : 'PC가 성공적으로 추가되었습니다.',
                    'success'
                );
                this.closePcModal();
                await this.loadPCs();
            } else {
                this.uiManager.showNotification(result.detail || '저장에 실패했습니다.', 'error');
            }
            
        } catch (error) {
            console.error('PC 저장 오류:', error);
            this.uiManager.showNotification('저장 중 오류가 발생했습니다.', 'error');
        }
    }
    
    validateForm() {
        const form = this.pcForm;
        if (!form.checkValidity()) {
            form.reportValidity();
            return false;
        }
        
        // MAC 주소 추가 검증
        const macInput = document.getElementById('mac_address');
        const macPattern = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
        
        if (!macPattern.test(macInput.value)) {
            macInput.setCustomValidity('올바른 MAC 주소 형식을 입력해주세요. (예: AA:BB:CC:DD:EE:FF)');
            macInput.reportValidity();
            return false;
        } else {
            macInput.setCustomValidity('');
        }
        
        return true;
    }
    
    showDeletePCConfirmation(pcId) {
        const pc = this.pcs.get(pcId);
        if (!pc) return;
        
        this.deletePcName.textContent = pc.name;
        this.confirmDeleteBtn.onclick = () => this.deletePC(pcId);
        this.uiManager.showModal(this.deleteModal);
    }
    
    async deletePC(pcId) {
        try {
            const response = await fetch(`/api/pcs/${pcId}`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                this.uiManager.showNotification('PC가 성공적으로 삭제되었습니다.', 'success');
                this.uiManager.hideModal(this.deleteModal);
                await this.loadPCs();
            } else {
                const result = await response.json();
                this.uiManager.showNotification(result.detail || '삭제에 실패했습니다.', 'error');
            }
            
        } catch (error) {
            console.error('PC 삭제 오류:', error);
            this.uiManager.showNotification('삭제 중 오류가 발생했습니다.', 'error');
        }
    }
    
    async refreshAllPCs() {
        this.uiManager.showNotification('PC 상태를 새로고침하고 있습니다...', 'info');
        
        try {
            const response = await fetch('/api/status');
            if (response.ok) {
                this.uiManager.showNotification('PC 상태가 새로고침되었습니다.', 'success');
            } else {
                throw new Error('새로고침 실패');
            }
        } catch (error) {
            console.error('상태 새로고침 오류:', error);
            this.uiManager.showNotification('상태 새로고침에 실패했습니다.', 'error');
        }
    }
}