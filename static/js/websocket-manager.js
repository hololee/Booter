/**
 * WebSocket 연결 및 실시간 통신 관리
 */
class WebSocketManager {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectInterval = 3000;
        this.isReconnecting = false;
        
        // 이벤트 콜백들
        this.onStatusUpdate = null;
        this.onBootStart = null;
        this.onBootProgress = null;
        this.onBootComplete = null;
    }
    
    connectWebSocket() {
        try {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            let wsUrl = `${protocol}//${window.location.host}/ws`;
            
            // 0.0.0.0을 localhost로 변경
            if (wsUrl.includes('0.0.0.0')) {
                wsUrl = wsUrl.replace('0.0.0.0', 'localhost');
            }
            
            console.log('WebSocket 연결 시도:', wsUrl);
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                console.log('WebSocket connected');
                this.reconnectAttempts = 0;
                this.isReconnecting = false;
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
                this.attemptReconnect();
            };
            
            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
            
        } catch (error) {
            console.error('WebSocket connection error:', error);
            this.attemptReconnect();
        }
    }
    
    attemptReconnect() {
        if (this.isReconnecting || this.reconnectAttempts >= this.maxReconnectAttempts) {
            return;
        }
        
        this.isReconnecting = true;
        this.reconnectAttempts++;
        
        setTimeout(() => {
            if (this.reconnectAttempts <= this.maxReconnectAttempts) {
                console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
                this.connectWebSocket();
            }
        }, this.reconnectInterval);
    }
    
    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'status_update':
                if (this.onStatusUpdate) {
                    this.onStatusUpdate(data.data);
                }
                break;
            case 'boot_start':
                if (this.onBootStart) {
                    this.onBootStart(data.data);
                }
                break;
            case 'boot_progress':
                if (this.onBootProgress) {
                    this.onBootProgress(data.data);
                }
                break;
            case 'boot_complete':
                if (this.onBootComplete) {
                    this.onBootComplete(data.data);
                }
                break;
            default:
                console.log('Unknown message type:', data.type);
        }
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
    
    // WebSocket 상태 확인
    isConnected() {
        return this.ws && this.ws.readyState === WebSocket.OPEN;
    }
    
    // WebSocket 연결 종료
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}