// Health Dashboard Logic

const services = [
    { name: 'API Gateway', endpoint: '/health/gateway' },
    { name: 'Auth Service', endpoint: '/health/auth' },
    { name: 'Database', endpoint: '/health/db' },
    { name: 'Cache', endpoint: '/health/cache' },
    { name: 'Queue', endpoint: '/health/queue' },
];

const metrics = {
    responseTime: [],
    requests: 0,
    errors: 0,
    success: 0,
};

async function fetchHealth() {
    try {
        const response = await fetch('/api/health');
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Health check failed:', error);
        return null;
    }
}

async function refreshData() {
    const health = await fetchHealth();

    if (health) {
        updateMetrics(health);
        updateServices(health.services);
        updateOverallStatus(health.status);
    }

    document.getElementById('lastUpdated').textContent = new Date().toLocaleTimeString();
}

function updateMetrics(data) {
    document.getElementById('responseTime').textContent = data.avgResponseTime || '--';
    document.getElementById('successRate').textContent = data.successRate || '--';
    document.getElementById('requestRate').textContent = data.requestRate || '--';
    document.getElementById('errorCount').textContent = data.errorCount || '--';
}

function updateServices(servicesData) {
    const list = document.getElementById('servicesList');
    list.innerHTML = services.map(service => {
        const status = servicesData?.[service.name] || 'unknown';
        const isUp = status === 'healthy' || status === 'up';
        return `
            <div class="service-item">
                <span class="service-name">${service.name}</span>
                <div class="service-status">
                    <span class="status-dot ${isUp ? 'up' : 'down'}"></span>
                    <span>${isUp ? 'Operational' : 'Down'}</span>
                </div>
            </div>
        `;
    }).join('');
}

function updateOverallStatus(status) {
    const badge = document.getElementById('overallStatus');
    badge.className = 'status-badge';

    if (status === 'healthy') {
        badge.classList.add('healthy');
        badge.textContent = '✅ All Systems Operational';
    } else if (status === 'warning') {
        badge.classList.add('warning');
        badge.textContent = '⚠️ Partial Outage';
    } else {
        badge.classList.add('critical');
        badge.textContent = '❌ Major Outage';
    }
}

// Simple chart
function drawChart() {
    const canvas = document.getElementById('trendChart');
    const ctx = canvas.getContext('2d');

    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    // Sample data
    const data = [120, 115, 130, 125, 140, 118, 122, 135, 128, 142];
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    // Draw grid
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
        const y = (height / 5) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }

    // Draw line
    const maxVal = Math.max(...data);
    const step = width / (data.length - 1);

    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.beginPath();

    data.forEach((val, i) => {
        const x = i * step;
        const y = height - (val / maxVal) * height * 0.8;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });

    ctx.stroke();

    // Fill area
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
    ctx.fill();
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    refreshData();
    drawChart();
    setInterval(refreshData, 30000); // Refresh every 30s
});
