/**
 * UI 공통 기능 관리 (사이드바, 알림, 모달 공통 등)
 */
class UIManager {
    constructor() {
        this.sidebar = null;
        this.menuToggle = null;
        this.mobileOverlay = null;
        this.container = null;
        this.menuItems = null;
        this.notificationContainer = null;
        
        this.currentMenuType = 'pc';
        
        this.initializeElements();
        this.attachEventListeners();
        this.attachResizeListener();
    }
    
    initializeElements() {
        // 메뉴 관련 요소들
        this.menuToggle = document.getElementById('menuToggle');
        this.sidebar = document.getElementById('sidebar');
        this.mobileOverlay = document.getElementById('mobileOverlay');
        this.container = document.querySelector('.container');
        this.menuItems = document.querySelectorAll('.menu-item');
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

        // 비밀번호 토글 버튼
        document.querySelectorAll('.password-toggle-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.togglePasswordVisibility(e));
        });
    }
    
    attachResizeListener() {
        window.addEventListener('resize', () => {
            this.handleResize();
        });
    }
    
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
        
        // 메뉴 전환 이벤트 발생
        if (this.onMenuSwitch) {
            this.onMenuSwitch(menuType);
        }
        
        // 모바일에서는 메뉴 선택 후 사이드바 닫기
        if (window.innerWidth <= 768) {
            this.closeSidebar();
        }
    }
    
    handleResize() {
        const isMobile = window.innerWidth <= 768;
        
        if (isMobile) {
            // 모바일로 전환 시 사이드바 숨기기
            this.sidebar.classList.remove('show');
            this.mobileOverlay.classList.remove('show');
            this.menuToggle.classList.remove('active');
            this.container.classList.remove('sidebar-open');
        } else {
            // 데스크톱으로 전환 시 오버레이 제거
            this.mobileOverlay.classList.remove('show');
        }
    }
    
    // 알림 메시지 표시
    showNotification(message, type = 'info', duration = 5000) {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        
        notification.innerHTML = `
            <div class="notification-content">
                <span class="notification-message">${message}</span>
            </div>
        `;
        
        this.notificationContainer.appendChild(notification);
        
        // 자동 제거
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, duration);
    }
    
    // 모달 공통 기능
    showModal(modal) {
        if (modal) {
            modal.classList.add('show');
            document.body.style.overflow = 'hidden';
        }
    }
    
    hideModal(modal) {
        if (modal) {
            modal.classList.remove('show');
            document.body.style.overflow = '';
        }
    }
    
    // 로딩 상태 표시
    showLoading(element, text = '로딩 중...') {
        if (element) {
            element.disabled = true;
            element.classList.add('loading');
            element.textContent = text;
        }
    }
    
    hideLoading(element, originalText) {
        if (element) {
            element.disabled = false;
            element.classList.remove('loading');
            element.textContent = originalText;
        }
    }
    
    // 확인 대화상자
    showConfirmDialog(title, message, onConfirm, onCancel) {
        // 간단한 확인 대화상자 구현
        const result = confirm(`${title}\n\n${message}`);
        if (result && onConfirm) {
            onConfirm();
        } else if (!result && onCancel) {
            onCancel();
        }
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
}