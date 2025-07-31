/**
 * 메인 애플리케이션 컨트롤러
 * 모든 매니저들을 초기화하고 연결하는 역할
 */
class MultiPCController {
    constructor() {
        // 모니터링 상태 플래그
        this.pcMonitoringEnabled = true;  // PC 탭이 기본이므로 PC 모니터링 활성화
        this.vmMonitoringEnabled = false; // VM 모니터링은 비활성화
        
        // 그리드 요소들
        this.pcGrid = document.getElementById('pcGrid');
        this.vmGrid = document.getElementById('vmGrid');
        this.addPcBtn = document.getElementById('addPcBtn');
        this.addVmBtn = document.getElementById('addVmBtn');
        this.refreshAllBtn = document.getElementById('refreshAllBtn');
        
        // 매니저들 초기화
        this.uiManager = new UIManager();
        this.websocketManager = new WebSocketManager();
        this.pcManager = new PCManager(this.uiManager);
        this.vmManager = new VMManager(this.uiManager);
        
        this.setupEventHandlers();
        this.initializeApplication();
    }
    
    setupEventHandlers() {
        // UI 매니저의 메뉴 전환 콜백 설정
        this.uiManager.onMenuSwitch = (menuType) => {
            this.switchMenu(menuType);
        };
        
        // WebSocket 매니저의 콜백들 설정
        this.websocketManager.onStatusUpdate = (data) => {
            this.updateAllStatus(data);
        };
        
        this.websocketManager.onBootStart = (data) => {
            this.handleBootStart(data);
        };
        
        this.websocketManager.onBootProgress = (data) => {
            this.handleBootProgress(data);
        };
        
        this.websocketManager.onBootComplete = (data) => {
            this.handleBootComplete(data);
        };

        // 새로고침 버튼 이벤트
        if (this.refreshAllBtn) {
            this.refreshAllBtn.addEventListener('click', () => this.refreshAll());
        }
    }
    
    async initializeApplication() {
        // WebSocket 연결
        this.websocketManager.connectWebSocket();
        
        // 초기 상태 설정 (PC 메뉴가 기본 선택)
        this.switchMenu('pc');
        await this.pcManager.loadPCs();
    }
    
    // VM과 PC 메뉴 전환
    switchMenu(menuType) {
        this.uiManager.currentMenuType = menuType;
        
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
            this.vmManager.loadVMs();
        }
        
        // 서버에 탭 변경 알림
        this.websocketManager.notifyTabChange(menuType);
        
        // 메뉴 항목 활성화 표시
        this.uiManager.menuItems.forEach(item => {
            item.classList.remove('active');
            if (item.dataset.menu === menuType) {
                item.classList.add('active');
            }
        });
    }
    
    // 전체 새로고침 (PC와 VM 모두)
    async refreshAll() {
        if (this.uiManager.currentMenuType === 'pc') {
            await this.pcManager.refreshAllPCs();
        } else if (this.uiManager.currentMenuType === 'vm') {
            await this.vmManager.refreshAllVMs();
        }
    }
    
    updateAllStatus(data) {
        // PC 모니터링이 활성화된 경우에만 PC 상태 업데이트
        if (this.pcMonitoringEnabled && data.pc_statuses) {
            Object.entries(data.pc_statuses).forEach(([pcId, status]) => {
                this.pcManager.updatePCStatus(pcId, status);
            });
        }
        
        // VM 모니터링이 활성화된 경우에만 VM 상태 업데이트
        if (this.vmMonitoringEnabled && data.vm_statuses) {
            Object.entries(data.vm_statuses).forEach(([vmId, status]) => {
                // VM 매니저의 상태 맵도 업데이트
                this.vmManager.vmStatuses.set(vmId, status);
                this.vmManager.updateVMCardStatus(vmId, status);
            });
        }
    }
    
    handleBootStart(data) {
        // PC 부팅 상태 업데이트
        this.pcManager.updatePCBootStatus(data.pc_id, this.pcManager.getBootingStatusText(data.target_os, 'booting'), 'booting');
    }
    
    handleBootProgress(data) {
        // PC 상태 텍스트 업데이트
        this.pcManager.updatePCBootStatus(data.pc_id, data.message);
    }
    
    handleBootComplete(data) {
        const pcId = data.pc_id;
        const type = data.success ? 'success' : 'error';

        // PC가 종료 중이었는지 확인
        if (this.pcManager.shuttingDownPCs.has(pcId)) {
            this.pcManager.removeShuttingDownPC(pcId);
            if (data.success) {
                this.uiManager.showNotification(`${data.target_os} 종료가 완료되었습니다.`, 'success');
                this.pcManager.updatePCStatus(pcId, { state: 'off' });
            } else {
                this.uiManager.showNotification(`${data.target_os} 종료에 실패했습니다.`, 'error');
                // 실패 시 상태를 이전 상태로 되돌릴 수 있도록 상태를 다시 확인하는 것이 좋을 수 있습니다.
                // 여기서는 간단하게 그냥 둡니다.
            }
            return;
        }

        // 기존 부팅 완료 로직
        this.uiManager.showNotification(data.message, type);
        
        // 부팅 완료/실패 시 부팅 중 상태에서 제거
        this.pcManager.removeBootingPC(data.pc_id);
        
        // 상태 텍스트 및 점 업데이트
        if (data.success) {
            this.pcManager.updatePCBootStatus(data.pc_id, this.pcManager.getBootingStatusText(data.target_os, 'completed'), 'online');
        } else {
            this.pcManager.updatePCBootStatus(data.pc_id, this.pcManager.getBootingStatusText(data.target_os, 'failed'), 'offline');
        }
        
        // 성공한 경우 버튼 상태도 즉시 업데이트
        if (data.success) {
            const ubuntuBtn = document.getElementById(`ubuntu-btn-${data.pc_id}`);
            const windowsBtn = document.getElementById(`windows-btn-${data.pc_id}`);
            if (ubuntuBtn && windowsBtn) {
                if (data.target_os === 'Ubuntu') {
                    this.pcManager.updateButtonsForState('ubuntu', ubuntuBtn, windowsBtn);
                } else if (data.target_os === 'Windows') {
                    this.pcManager.updateButtonsForState('windows', ubuntuBtn, windowsBtn);
                }
            }
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
    
    // PC 전역 메서드들 (HTML onclick에서 호출)
    async handleUbuntuButton(pcId) {
        const pc = this.pcManager.pcs.get(pcId);
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
            await this.pcManager.bootUbuntu(pcId);
        }
    }
    
    async handleWindowsButton(pcId) {
        const pc = this.pcManager.pcs.get(pcId);
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
            await this.pcManager.bootWindows(pcId);
        }
    }
    
    // 종료 및 재부팅 메서드들
    async shutdownUbuntu(pcId) {
        this.pcManager.setShuttingDownState(pcId);
        try {
            const response = await fetch(`/api/pcs/${pcId}/shutdown/ubuntu`, {
                method: 'POST'
            });
            
            const result = await response.json();
            
            if (response.ok) {
                this.uiManager.showNotification(`Ubuntu 종료를 시작했습니다`, 'info');
            } else {
                this.uiManager.showNotification(result.detail || 'Ubuntu 종료 요청 실패', 'error');
                this.pcManager.removeShuttingDownPC(pcId);
            }
            
        } catch (error) {
            console.error('Ubuntu 종료 오류:', error);
            this.uiManager.showNotification('Ubuntu 종료 요청 중 오류가 발생했습니다', 'error');
            this.pcManager.removeShuttingDownPC(pcId);
        }
    }
    
    async shutdownWindows(pcId) {
        this.pcManager.setShuttingDownState(pcId);
        try {
            const response = await fetch(`/api/pcs/${pcId}/shutdown/windows`, {
                method: 'POST'
            });
            
            const result = await response.json();
            
            if (response.ok) {
                this.uiManager.showNotification(`Windows 종료를 시작했습니다`, 'info');
            } else {
                this.uiManager.showNotification(result.detail || 'Windows 종료 요청 실패', 'error');
                this.pcManager.removeShuttingDownPC(pcId);
            }
            
        } catch (error) {
            console.error('Windows 종료 오류:', error);
            this.uiManager.showNotification('Windows 종료 요청 중 오류가 발생했습니다', 'error');
            this.pcManager.removeShuttingDownPC(pcId);
        }
    }
    
    async rebootToUbuntu(pcId) {
        try {
            const response = await fetch(`/api/pcs/${pcId}/reboot/ubuntu`, {
                method: 'POST'
            });
            
            const result = await response.json();
            
            if (response.ok) {
                this.uiManager.showNotification(`Ubuntu로 재부팅을 시작했습니다`, 'info');
            } else {
                this.uiManager.showNotification(result.detail || 'Ubuntu 재부팅 요청 실패', 'error');
            }
            
        } catch (error) {
            console.error('Ubuntu 재부팅 오류:', error);
            this.uiManager.showNotification('Ubuntu 재부팅 요청 중 오류가 발생했습니다', 'error');
        }
    }
    
    // PC 모달 관련 전역 메서드들
    openAddPcModal() {
        this.pcManager.openAddModal();
    }
    
    openEditPcModal(pcId) {
        this.pcManager.editPC(pcId);
    }
    
    openDeleteModal(pcId) {
        this.pcManager.showDeletePCConfirmation(pcId);
    }

    // VM 모달 관련 전역 메서드들
    openAddVmModal() {
        this.vmManager.openAddVmModal();
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