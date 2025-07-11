class MultiPCController {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectInterval = 1000;
        this.pcs = new Map();
        this.activeTasks = new Map();
        this.isEditing = false;
        this.currentEditingPcId = null;
        
        this.initializeElements();
        this.attachEventListeners();
        this.connectWebSocket();
        this.loadPCs();
    }
    
    initializeElements() {
        // 헤더 버튼들
        this.addPcBtn = document.getElementById('addPcBtn');
        this.refreshAllBtn = document.getElementById('refreshAllBtn');
        
        // PC 그리드
        this.pcGrid = document.getElementById('pcGrid');
        
        // 작업 관련 요소들
        this.tasksCard = document.getElementById('tasksCard');
        this.tasksList = document.getElementById('tasksList');
        this.taskCount = document.getElementById('taskCount');
        
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
        
        // SSH 인증 방법 관련 요소들
        this.sshAuthMethod = document.getElementById('sshAuthMethod');
        this.sshKeyGroup = document.getElementById('sshKeyGroup');
        this.sshPasswordGroup = document.getElementById('sshPasswordGroup');
        
        // 알림 컨테이너
        this.notificationContainer = document.getElementById('notificationContainer');
    }
    
    attachEventListeners() {
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
        
        // SSH 인증 방법 변경 이벤트
        this.sshAuthMethod.addEventListener('change', () => this.toggleSshAuthMethod());
        
        // 모달 배경 클릭 시 닫기 비활성화 (PC 모달만)
        this.deleteModal.addEventListener('click', (e) => {
            if (e.target === this.deleteModal) this.closeDeleteModal();
        });
        
        this.cancelModal.addEventListener('click', (e) => {
            if (e.target === this.cancelModal) this.closeCancelModal();
        });
        
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
    
    renderPCGrid() {
        if (this.pcs.size === 0) {
            this.pcGrid.innerHTML = `
                <div class="empty-state">
                    <h3>등록된 PC가 없습니다</h3>
                    <p>새 PC를 추가하여 시작하세요</p>
                    <button class="btn btn-primary" onclick="app.openAddPcModal()">PC 추가</button>
                </div>
            `;
            return;
        }
        
        this.pcGrid.innerHTML = '';
        
        this.pcs.forEach(pc => {
            const pcCard = this.createPCCard(pc);
            this.pcGrid.appendChild(pcCard);
        });
    }
    
    createPCCard(pc) {
        const card = document.createElement('div');
        card.className = 'pc-card';
        card.id = `pc-${pc.id}`;
        
        card.innerHTML = `
            <div class="pc-card-header">
                <div class="pc-card-title">
                    <span class="pc-status-dot" id="status-dot-${pc.id}"></span>
                    <span class="pc-name">${pc.name}</span>
                </div>
                <div class="pc-card-actions">
                    <button class="btn btn-small btn-secondary" onclick="app.openEditPcModal('${pc.id}')">편집</button>
                    <button class="btn btn-small btn-danger" onclick="app.openDeleteModal('${pc.id}')">삭제</button>
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
                        Ubuntu 부팅
                    </button>
                    <button class="boot-btn windows-btn" id="windows-btn-${pc.id}" onclick="app.bootWindows('${pc.id}')">
                        Windows 부팅
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
        
        if (data.active_tasks) {
            this.updateActiveTasks(data.active_tasks);
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
        
        // 상태 점 업데이트
        statusDot.className = 'pc-status-dot';
        switch (status.state) {
            case 'ubuntu':
                statusDot.classList.add('ubuntu');
                break;
            case 'windows':
                statusDot.classList.add('windows');
                break;
            case 'off':
                statusDot.classList.add('offline');
                break;
            default:
                statusDot.classList.add('offline');
        }
        
        // 상태 텍스트 업데이트
        statusText.textContent = this.getStateDisplayName(status.state);
        
        // 마지막 확인 시간 업데이트
        if (status.timestamp) {
            lastCheck.textContent = this.formatTimestamp(status.timestamp);
        }
        
        // 버튼 상태 업데이트
        const hasActiveTasks = status.active_tasks > 0;
        ubuntuBtn.disabled = hasActiveTasks || status.state === 'ubuntu';
        windowsBtn.disabled = hasActiveTasks || status.state === 'windows';
        
        // 로딩 상태 표시
        if (hasActiveTasks) {
            ubuntuBtn.classList.add('loading');
            windowsBtn.classList.add('loading');
        } else {
            ubuntuBtn.classList.remove('loading');
            windowsBtn.classList.remove('loading');
        }
    }
    
    updateActiveTasks(tasks) {
        this.activeTasks.clear();
        
        tasks.forEach(task => {
            this.activeTasks.set(task.task_id, task);
        });
        
        if (tasks.length > 0) {
            this.taskCount.textContent = tasks.length;
            this.tasksCard.style.display = 'block';
            
            this.tasksList.innerHTML = '';
            tasks.forEach(task => {
                const taskElement = this.createTaskElement(task);
                this.tasksList.appendChild(taskElement);
            });
        } else {
            this.tasksCard.style.display = 'none';
        }
    }
    
    createTaskElement(task) {
        const taskElement = document.createElement('div');
        taskElement.className = 'task-item';
        taskElement.id = `task-${task.task_id}`;
        
        taskElement.innerHTML = `
            <div class="task-info">
                <div class="task-title">${task.pc_name} - ${task.target_os} 부팅</div>
                <div class="task-message">${task.message}</div>
            </div>
            <div class="task-progress">${task.progress}%</div>
        `;
        
        return taskElement;
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
        
        // SSH 인증 방법 설정
        document.getElementById('sshAuthMethod').value = pc.ssh_auth_method || 'key';
        if (pc.ssh_auth_method === 'password') {
            document.getElementById('sshPassword').value = pc.ssh_password || '';
        } else {
            document.getElementById('sshKeyText').value = pc.ssh_key_text || '';
        }
        
        this.toggleSshAuthMethod();
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
            ssh_auth_method: formData.get('ssh_auth_method'),
            ssh_port: parseInt(formData.get('ssh_port')),
            rdp_port: parseInt(formData.get('rdp_port')),
            boot_command: formData.get('boot_command'),
            description: formData.get('description'),
            is_active: formData.get('is_active') === 'on'
        };
        
        // SSH 인증 방법에 따라 필드 추가
        if (pcData.ssh_auth_method === 'password') {
            pcData.ssh_password = formData.get('ssh_password');
            if (!pcData.ssh_password) {
                this.showNotification('SSH 비밀번호를 입력해주세요', 'error');
                return;
            }
        } else {
            pcData.ssh_key_text = formData.get('ssh_key_text');
            if (!pcData.ssh_key_text) {
                this.showNotification('SSH 키를 입력해주세요', 'error');
                return;
            }
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
            const response = await fetch(`/api/pcs/${pcId}/boot/ubuntu`, {
                method: 'POST'
            });
            
            const result = await response.json();
            
            if (response.ok) {
                this.showNotification(`Ubuntu 부팅을 시작했습니다`, 'success');
            } else {
                this.showNotification(result.detail || 'Ubuntu 부팅 요청 실패', 'error');
            }
            
        } catch (error) {
            console.error('Ubuntu 부팅 오류:', error);
            this.showNotification('Ubuntu 부팅 요청 중 오류가 발생했습니다', 'error');
        }
    }
    
    async bootWindows(pcId) {
        try {
            const response = await fetch(`/api/pcs/${pcId}/boot/windows`, {
                method: 'POST'
            });
            
            const result = await response.json();
            
            if (response.ok) {
                this.showNotification(`Windows 부팅을 시작했습니다`, 'success');
            } else {
                this.showNotification(result.detail || 'Windows 부팅 요청 실패', 'error');
            }
            
        } catch (error) {
            console.error('Windows 부팅 오류:', error);
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
            this.refreshAllBtn.innerHTML = '전체 새로고침';
        }
    }
    
    // 이벤트 핸들러들
    handleBootStart(data) {
        this.showNotification(`${data.target_os} 부팅을 시작합니다`, 'info');
    }
    
    handleBootProgress(data) {
        const taskElement = document.getElementById(`task-${data.task_id}`);
        if (taskElement) {
            const messageElement = taskElement.querySelector('.task-message');
            const progressElement = taskElement.querySelector('.task-progress');
            
            if (messageElement) messageElement.textContent = data.message;
            if (progressElement) progressElement.textContent = `${data.progress}%`;
        }
    }
    
    handleBootComplete(data) {
        const type = data.success ? 'success' : 'error';
        this.showNotification(data.message, type);
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
            'ubuntu': 'Ubuntu',
            'windows': 'Windows',
            'off': '꺼짐',
            'booting': '부팅 중',
            'unknown': '불명'
        };
        return stateNames[state] || '불명';
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
    
    // SSH 인증 방법 변경 처리
    toggleSshAuthMethod() {
        const authMethod = this.sshAuthMethod.value;
        
        if (authMethod === 'password') {
            this.sshKeyGroup.style.display = 'none';
            this.sshPasswordGroup.style.display = 'block';
            document.getElementById('sshKeyText').required = false;
            document.getElementById('sshPassword').required = true;
        } else {
            this.sshKeyGroup.style.display = 'block';
            this.sshPasswordGroup.style.display = 'none';
            document.getElementById('sshKeyText').required = true;
            document.getElementById('sshPassword').required = false;
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