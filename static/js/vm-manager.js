/**
 * VM 관련 기능 관리 (VM 제어, 상태 관리, 모달 등)
 */
class VMManager {
    constructor(uiManager) {
        this.uiManager = uiManager;
        this.vms = new Map();
        this.vmStatuses = new Map();
        
        // VM 관련 DOM 요소들
        this.vmGrid = null;
        this.addVmBtn = null;
        this.vmModal = null;
        this.vmForm = null;
        this.vmModalTitle = null;
        this.deleteVmModal = null;
        this.deleteVmName = null;
        
        this.currentEditingVmId = null;
        
        this.initializeElements();
        this.attachEventListeners();
    }
    
    initializeElements() {
        this.vmGrid = document.getElementById('vmGrid');
        this.addVmBtn = document.getElementById('addVmBtn');
        
        // VM 모달 요소들
        this.vmModal = document.getElementById('vmModal');
        this.vmForm = document.getElementById('vmForm');
        this.vmModalTitle = document.getElementById('vmModalTitle');
        this.vmCancelBtn = document.getElementById('vmCancelBtn');
        this.vmSaveBtn = document.getElementById('vmSaveBtn');
        
        // VM 삭제 모달
        this.deleteVmModal = document.getElementById('deleteVmModal');
        this.deleteVmName = document.getElementById('deleteVmName');
        this.cancelDeleteVmBtn = document.getElementById('cancelDeleteVmBtn');
        this.confirmDeleteVmBtn = document.getElementById('confirmDeleteVmBtn');
    }
    
    attachEventListeners() {
        // VM 추가 버튼
        if (this.addVmBtn) {
            this.addVmBtn.addEventListener('click', () => this.openAddVmModal());
        }
        
        // VM 모달 이벤트
        if (this.vmCancelBtn) {
            this.vmCancelBtn.addEventListener('click', () => this.closeVmModal());
        }
        
        if (this.vmSaveBtn) {
            this.vmSaveBtn.addEventListener('click', () => this.saveVM());
        }
        
        if (this.vmForm) {
            this.vmForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.saveVM();
            });
        }
        
        // VM 삭제 모달 이벤트
        if (this.cancelDeleteVmBtn) {
            this.cancelDeleteVmBtn.addEventListener('click', () => this.uiManager.hideModal(this.deleteVmModal));
        }
        
        if (this.confirmDeleteVmBtn) {
            this.confirmDeleteVmBtn.addEventListener('click', () => this.confirmDeleteVM());
        }
    }
    
    async loadVMs() {
        try {
            const response = await fetch('/api/vms');
            const data = await response.json();
            
            this.vms.clear();
            data.vms.forEach(vm => {
                this.vms.set(vm.id, vm);
            });
            
            await this.loadVMStatuses();
            this.renderVMs();
            
        } catch (error) {
            console.error('VM 목록 로드 실패:', error);
            this.uiManager.showNotification('VM 목록을 불러오는데 실패했습니다.', 'error');
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
    
    renderVMs() {
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
                <button class="btn btn-primary" onclick="app.vmManager.openAddVmModal()">VM 추가</button>
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
                        <button class="icon-btn" onclick="app.vmManager.editVM('${vm.id}')" title="편집">
                            <img src="/static/resources/edit.svg" alt="Edit" class="action-icon">
                        </button>
                        <button class="icon-btn" onclick="app.vmManager.showDeleteVMConfirmation('${vm.id}')" title="삭제">
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
                    <div class="vm-control-section">
                        <button class="vm-control-button ${isRunning ? 'down' : 'up'}" 
                                onclick="app.vmManager.toggleVM('${vm.id}', ${isRunning})">
                            ${isRunning ? 'DOWN' : 'UP'}
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
    
    getVMStatusClass(vmId) {
        const status = this.vmStatuses.get(vmId);
        if (!status) return 'unknown';
        
        switch (status.status) {
            case 'running':
                return 'running';
            case 'stopped':
                return 'stopped';
            case 'starting':
                return 'starting';
            default:
                return 'unknown';
        }
    }
    
    getVMStatusText(vmId) {
        const status = this.vmStatuses.get(vmId);
        return status ? status.status : 'unknown';
    }
    
    async toggleVM(vmId, isRunning) {
        const vm = this.vms.get(vmId);
        if (!vm) return;
        
        const action = isRunning ? 'stop' : 'start';
        const actionText = isRunning ? '정지' : '시작';
        
        try {
            const response = await fetch(`/api/vms/${vmId}/${action}`, {
                method: 'POST'
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const result = await response.json();
            this.uiManager.showNotification(`${vm.name} VM ${actionText}을 요청했습니다.`, 'success');
            
            // 잠시 후 상태 업데이트
            setTimeout(() => {
                this.refreshVM(vmId);
            }, 2000);
            
        } catch (error) {
            console.error(`VM ${isRunning ? 'stop' : 'start'} 실패:`, error);
            this.uiManager.showNotification(`VM ${actionText}에 실패했습니다.`, 'error');
        }
    }
    
    async refreshVM(vmId) {
        try {
            const response = await fetch(`/api/vms/${vmId}/status`);
            if (response.ok) {
                const status = await response.json();
                this.vmStatuses.set(vmId, status);
                this.updateVMCardStatus(vmId, status);
            }
        } catch (error) {
            console.error('VM 상태 업데이트 실패:', error);
        }
    }
    
    updateVMCardStatus(vmId, status) {
        const vmCard = document.querySelector(`[data-vm-id="${vmId}"]`);
        if (!vmCard) return;
        
        // 상태 맵 업데이트
        this.vmStatuses.set(vmId, status);
        
        // 상태 도트 업데이트
        const statusDot = vmCard.querySelector('.vm-status-dot');
        if (statusDot) {
            statusDot.className = `vm-status-dot ${this.getVMStatusClass(vmId)}`;
        }
        
        // 상태 텍스트 업데이트 (올바른 요소 선택)
        const statusText = vmCard.querySelector('.vm-status-text');
        if (statusText) {
            statusText.textContent = status.status;
        } else {
            console.error(`VM ${vmId} 상태 텍스트 요소를 찾을 수 없음`);
        }
        
        // 컨트롤 버튼 업데이트
        const isRunning = status.status === 'running';
        const controlButton = vmCard.querySelector('.vm-control-button');
        if (controlButton) {
            controlButton.className = `vm-control-button ${isRunning ? 'down' : 'up'}`;
            controlButton.textContent = isRunning ? 'DOWN' : 'UP';
            controlButton.onclick = () => app.vmManager.toggleVM(vmId, isRunning);
        }
    }
    
    async refreshAllVMs() {
        this.uiManager.showNotification('VM 상태를 새로고침하고 있습니다...', 'info');
        
        try {
            await this.loadVMStatuses();
            
            // 각 VM 카드의 상태 업데이트
            this.vmStatuses.forEach((status, vmId) => {
                this.updateVMCardStatus(vmId, status);
            });
            
            this.uiManager.showNotification('VM 상태가 새로고침되었습니다.', 'success');
        } catch (error) {
            console.error('VM 새로고침 실패:', error);
            this.uiManager.showNotification('VM 상태 새로고침에 실패했습니다.', 'error');
        }
    }
    
    // VM 모달 관련 메서드들
    openAddVmModal() {
        this.currentEditingVmId = null;
        this.vmModalTitle.textContent = 'VM 추가';
        this.vmForm.reset();
        
        // 기본값 설정
        document.getElementById('vm_vm_type').value = 'qemu';
        document.getElementById('vm_ssh_port').value = '22';
        
        this.uiManager.showModal(this.vmModal);
        document.getElementById('vm_name').focus();
    }
    
    editVM(vmId) {
        const vm = this.vms.get(vmId);
        if (!vm) return;
        
        this.currentEditingVmId = vmId;
        this.vmModalTitle.textContent = 'VM 편집';
        
        // 폼에 VM 정보 채우기
        document.getElementById('vm_name').value = vm.name;
        document.getElementById('vm_description').value = vm.description || '';
        document.getElementById('vm_node_address').value = vm.node_address;
        document.getElementById('vm_node_name').value = vm.node_name;
        document.getElementById('vm_api_token').value = vm.api_token;
        document.getElementById('vm_vm_type').value = vm.vm_type;
        document.getElementById('vm_vm_id').value = vm.vm_id;
        document.getElementById('vm_ssh_user').value = vm.ssh_user || '';
        document.getElementById('vm_ssh_key_path').value = vm.ssh_key_path || '';
        document.getElementById('vm_ssh_port').value = vm.ssh_port || 22;
        
        this.uiManager.showModal(this.vmModal);
        document.getElementById('vm_name').focus();
    }
    
    closeVmModal() {
        this.uiManager.hideModal(this.vmModal);
        this.currentEditingVmId = null;
    }
    
    async saveVM() {
        if (!this.validateVMForm()) return;
        
        const formData = new FormData(this.vmForm);
        const vmData = {
            name: formData.get('name').trim(),
            description: formData.get('description').trim() || null,
            node_address: formData.get('node_address').trim(),
            node_name: formData.get('node_name').trim(),
            api_token: formData.get('api_token').trim(),
            vm_type: formData.get('vm_type'),
            vm_id: formData.get('vm_id').trim(),
            ssh_user: formData.get('ssh_user').trim() || null,
            ssh_key_path: formData.get('ssh_key_path').trim() || null,
            ssh_port: parseInt(formData.get('ssh_port')) || 22
        };
        
        if (this.currentEditingVmId) {
            vmData.id = this.currentEditingVmId;
        }
        
        try {
            const url = this.currentEditingVmId ? `/api/vms/${this.currentEditingVmId}` : '/api/vms';
            const method = this.currentEditingVmId ? 'PUT' : 'POST';
            
            const response = await fetch(url, {
                method: method,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(vmData)
            });
            
            const result = await response.json();
            
            if (response.ok) {
                this.uiManager.showNotification(
                    this.currentEditingVmId ? 'VM이 성공적으로 수정되었습니다.' : 'VM이 성공적으로 추가되었습니다.',
                    'success'
                );
                this.closeVmModal();
                await this.loadVMs();
            } else {
                this.uiManager.showNotification(result.detail || '저장에 실패했습니다.', 'error');
            }
            
        } catch (error) {
            console.error('VM 저장 실패:', error);
            this.uiManager.showNotification('저장 중 오류가 발생했습니다.', 'error');
        }
    }
    
    validateVMForm() {
        const form = this.vmForm;
        if (!form.checkValidity()) {
            form.reportValidity();
            return false;
        }
        return true;
    }
    
    showDeleteVMConfirmation(vmId) {
        const vm = this.vms.get(vmId);
        if (!vm) return;
        
        this.deleteVmName.textContent = vm.name;
        this.confirmDeleteVmBtn.onclick = () => this.deleteVM(vmId);
        this.uiManager.showModal(this.deleteVmModal);
    }
    
    confirmDeleteVM() {
        // confirmDeleteVmBtn의 onclick에서 설정된 함수가 실행됨
        if (this.confirmDeleteVmBtn.onclick) {
            this.confirmDeleteVmBtn.onclick();
        }
    }
    
    async deleteVM(vmId) {
        try {
            const response = await fetch(`/api/vms/${vmId}`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                this.uiManager.showNotification('VM이 성공적으로 삭제되었습니다.', 'success');
                this.uiManager.hideModal(this.deleteVmModal);
                await this.loadVMs();
            } else {
                const result = await response.json();
                this.uiManager.showNotification(result.detail || '삭제에 실패했습니다.', 'error');
            }
            
        } catch (error) {
            console.error('VM 삭제 실패:', error);
            this.uiManager.showNotification('삭제 중 오류가 발생했습니다.', 'error');
        }
    }
}